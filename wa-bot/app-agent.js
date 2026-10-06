// ================================================================
// Worker "agen Ollama" untuk chat di APLIKASI (bukan WhatsApp).
//
// Edge Function di cloud tidak bisa menjangkau Ollama di laptop, jadi aplikasi
// menaruh permintaan di tabel `agent_jobs` (status 'pending'); modul ini --
// jalan di dalam proses bot yang sama -- mengambilnya, menjalankan Ollama
// lokal, menulis balasan ke `chat_messages` (agent='ollama'), lalu menandai job
// 'done'. Tidak ada port yang dibuka ke internet, dan tidak ada pesan WhatsApp
// yang dikirim ke siapa pun.
//
// Tiap ~15 detik worker juga menulis "denyut" ke `agent_worker_status` supaya
// Edge Function tahu laptop/bot/Ollama sedang hidup (dan menolak memilih
// Ollama dengan pesan jelas kalau tidak).
//
// Modul ini sengaja TIDAK mengimpor index.js (yang langsung menjalankan bot saat
// di-import): semua yang dibutuhkan disuntik lewat `deps`, jadi gampang dites
// dengan mock (lihat test-app-agent.mjs).
//
// Analisis dokumen ("Pakai Dokumen Pengetahuan" aktif di obrolan itu):
//   - Pertanyaan biasa -> RAG: potongan dokumen paling relevan disisipkan ke
//     prompt (cepat, cocok buat laptop CPU-only).
//   - Permintaan menyeluruh ("ringkas dokumen ini", "analisis ...") -> peta-
//     lalu-ringkas: dokumen dipecah beberapa bagian, tiap bagian dicatat poin
//     relevannya, lalu catatan digabung jadi jawaban akhir. Dibatasi
//     OLLAMA_DOC_MAX_CHUNKS bagian (dipilih merata) supaya tidak berjam-jam.
// ================================================================

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function readAppAgentConfig(env = process.env) {
  return {
    enabled: (env.APP_AGENT_ENABLED || "true").toLowerCase() !== "false",
    pollMs: num(env.APP_AGENT_POLL_MS, 4000),
    heartbeatMs: num(env.APP_AGENT_HEARTBEAT_MS, 15000),
    numCtx: num(env.OLLAMA_CHAT_NUM_CTX, 8192),
    maxOutputTokens: num(env.OLLAMA_CHAT_MAX_OUTPUT_TOKENS, 700),
    timeoutMs: num(env.OLLAMA_CHAT_TIMEOUT_MS, 600000),
    historyLimit: num(env.OLLAMA_CHAT_HISTORY_LIMIT, 12),
    ragBudgetChars: num(env.OLLAMA_CHAT_RAG_BUDGET_CHARS, 5000),
    docChunkChars: num(env.OLLAMA_DOC_CHUNK_CHARS, 5000),
    docMaxChunks: num(env.OLLAMA_DOC_MAX_CHUNKS, 6),
    docNoteTokens: num(env.OLLAMA_DOC_NOTE_TOKENS, 220)
  };
}

const SYSTEM_PROMPT = `Kamu adalah asisten pribadi di dalam aplikasi "Daily Insider" milik satu pengguna saja. Kamu berjalan sebagai model AI LOKAL di laptop pengguna (BUKAN di internet) dan TIDAK punya akses pencarian web.
Jawab dengan ramah, jelas, dan seringkas mungkin tanpa kehilangan inti jawaban. Gunakan Bahasa Indonesia kecuali pengguna jelas menulis/minta bahasa lain. Boleh memakai format markdown sederhana (daftar, **tebal**, blok kode).
Kadang di pesan terakhir ada blok "KONTEKS DOKUMEN" yang dicarikan otomatis dari dokumen yang diupload pengguna. Jadikan itu sumber utama bila relevan dan sebut judul dokumennya. Kalau jawabannya tidak ada di konteks itu, katakan terus terang; untuk istilah/aturan/angka resmi yang spesifik dan kamu tidak yakin, JANGAN mengarang -- akui belum bisa memastikan dan sarankan cek sumber resmi.`;

// Permintaan yang menyangkut SELURUH dokumen (bukan satu fakta spesifik).
const WHOLE_DOC_RE = /\b(ringkas(an)?|rangkum(an)?|simpulkan|kesimpulan|analisis|analisa|menganalisis|review|tinjau|poin[- ]poin utama|isi (dokumen|file|pdf)|seluruh|keseluruhan|semua (isi|bagian|pasal))\b/i;

export function wantsWholeDocument(text) {
  return WHOLE_DOC_RE.test(text || "");
}

// Ambil `max` elemen tersebar merata (selalu menyertakan awal & akhir).
export function pickEvenly(items, max) {
  if (items.length <= max) return items;
  if (max <= 1) return [items[0]];
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

const clip = (s, n) => (typeof s === "string" && s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function createAppAgentWorker(deps, overrides = {}) {
  const cfg = { ...readAppAgentConfig(), ...overrides };
  const {
    supabase,
    callOllamaChat,
    enqueueOllamaCall,
    fetchRelevantKnowledgeChunks,
    chunkDocumentText,
    currentDateLine,
    ollamaBaseUrl,
    ollamaModel,
    log = console
  } = deps;

  let pollTimer = null;
  let hbTimer = null;
  let working = false; // lagi mengerjakan job -> panggilan berikutnya menunggu
  let stopped = false;
  let warnedMissingTable = false;

  // ---------------- denyut ----------------
  async function checkOllama() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: ctrl.signal });
      if (!res.ok) return { ok: false, detail: `Ollama membalas HTTP ${res.status}` };
      const data = await res.json();
      const names = (data?.models ?? []).map((m) => String(m.name || m.model || ""));
      const want = ollamaModel;
      const has = names.some((n) => n === want || n === `${want}:latest` || n.startsWith(`${want}:`) || want.startsWith(`${n}:`));
      if (!has) return { ok: false, detail: `Model "${want}" belum ada di Ollama (jalankan: ollama pull ${want})` };
      return { ok: true, detail: null };
    } catch (err) {
      return { ok: false, detail: `Ollama tidak menjawab (${err?.name === "AbortError" ? "timeout" : err instanceof Error ? err.message : String(err)})` };
    } finally {
      clearTimeout(timer);
    }
  }

  async function heartbeat() {
    const chk = await checkOllama();
    // Saat sedang generate, CPU penuh & /api/tags bisa lambat -- kalau kita
    // sendiri sedang memanggil Ollama, anggap hidup.
    const ollamaOk = chk.ok || working;
    const { error } = await supabase.from("agent_worker_status").upsert({
      id: "ollama",
      last_seen: new Date().toISOString(),
      ollama_ok: ollamaOk,
      model: ollamaModel,
      busy: working,
      detail: ollamaOk ? null : chk.detail
    });
    if (error) noteDbError(error);
  }

  function noteDbError(error) {
    if (/agent_(jobs|worker_status)/i.test(error.message || "") && !warnedMissingTable) {
      warnedMissingTable = true;
      log.error('🦙 Agen aplikasi: tabel agent_jobs/agent_worker_status belum ada -- jalankan migrasi supabase/migrations/0015_agent_jobs.sql.');
    } else if (!warnedMissingTable) {
      log.error("🦙 Agen aplikasi: error database:", error.message);
    }
  }

  // ---------------- membangun prompt ----------------
  async function loadHistory(chatDate, question) {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("chat_date", chatDate)
      .order("created_at", { ascending: false })
      .limit(cfg.historyLimit);
    if (error) throw new Error(`Gagal baca riwayat: ${error.message}`);
    const msgs = (data ?? [])
      .reverse()
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    // Pastikan pertanyaan job ini ada di ujung (mis. pesan sempat dihapus).
    if (!(msgs.length > 0 && msgs[msgs.length - 1].role === "user")) msgs.push({ role: "user", content: question });
    return msgs;
  }

  async function threadUsesKb(chatDate) {
    const { data } = await supabase.from("chat_thread_meta").select("use_kb").eq("id", chatDate).maybeSingle();
    return !!data?.use_kb;
  }

  const ollamaCall = (messages, opts) =>
    enqueueOllamaCall(() =>
      callOllamaChat(messages, { timeoutMs: cfg.timeoutMs, numCtx: cfg.numCtx, temperature: 0.4, ...opts })
    );

  async function setProgress(jobId, text) {
    await supabase.from("agent_jobs").update({ progress: text }).eq("id", jobId);
  }

  // Peta-lalu-ringkas atas seluruh Dokumen Pengetahuan. Mengembalikan teks
  // catatan (atau null kalau tidak ada dokumen).
  async function mapDocuments(job) {
    const { data: docs, error } = await supabase.from("knowledge_documents").select("title, content");
    if (error) throw new Error(`Gagal baca dokumen: ${error.message}`);
    if (!docs || docs.length === 0) return null;

    const all = [];
    for (const doc of docs) {
      for (const text of chunkDocumentText(doc.content, cfg.docChunkChars)) all.push({ title: doc.title, text });
    }
    if (all.length === 0) return null;
    const picked = pickEvenly(all, cfg.docMaxChunks);
    const partial = picked.length < all.length;

    const notes = [];
    for (let i = 0; i < picked.length; i += 1) {
      const part = picked[i];
      await setProgress(job.id, `Membaca dokumen: bagian ${i + 1} dari ${picked.length}`);
      const note = await ollamaCall(
        [
          {
            role: "system",
            content:
              "Kamu membaca satu bagian dokumen untuk membantu menjawab permintaan pengguna. Tulis hanya poin-poin PENTING dari bagian ini yang relevan dengan permintaan (maks 5 butir, ringkas, pertahankan angka/nama/pasal persis). Kalau tidak ada yang relevan, tulis satu tanda minus: -"
          },
          { role: "user", content: `Permintaan pengguna: ${job.question}\n\n=== Bagian dokumen "${part.title}" ===\n${part.text}` }
        ],
        { maxTokens: cfg.docNoteTokens, temperature: 0.2 }
      );
      const trimmed = note.trim();
      if (trimmed && trimmed !== "-") notes.push(`[${part.title} — bagian ${i + 1}]\n${trimmed}`);
    }
    return { notes, total: all.length, read: picked.length, partial };
  }

  async function answerJob(job) {
    const history = await loadHistory(job.chat_date, job.question);
    const useKb = await threadUsesKb(job.chat_date);
    const system = `${SYSTEM_PROMPT}\n\n${currentDateLine()}`;
    let docNote = "";

    if (useKb && wantsWholeDocument(job.question)) {
      const mapped = await mapDocuments(job);
      if (mapped) {
        await setProgress(job.id, "Menyusun jawaban dari catatan dokumen");
        const lastIdx = history.length - 1;
        const notesText = mapped.notes.length > 0 ? mapped.notes.join("\n\n") : "(tidak ada bagian yang tampak relevan)";
        history[lastIdx] = {
          role: "user",
          content: `${history[lastIdx].content}\n\n---\nKONTEKS DOKUMEN (catatan hasil membaca dokumen yang diupload pengguna):\n${notesText}`
        };
        if (mapped.partial) {
          docNote = `\n\n_Catatan: model lokal hanya membaca ${mapped.read} dari ${mapped.total} bagian dokumen (dipilih merata) agar tidak terlalu lama — untuk dokumen panjang, hasilnya bisa belum lengkap._`;
        }
      }
    } else if (useKb) {
      await setProgress(job.id, "Mencari bagian dokumen yang relevan");
      const chunks = await fetchRelevantKnowledgeChunks(job.question, cfg.ragBudgetChars);
      if (chunks.length > 0) {
        const titles = [...new Set(chunks.map((c) => c.title))];
        const ctx = titles
          .map((t) => `=== Dokumen: "${t}" ===\n${chunks.filter((c) => c.title === t).map((c) => c.text).join("\n\n---\n\n")}`)
          .join("\n\n");
        const lastIdx = history.length - 1;
        history[lastIdx] = {
          role: "user",
          content: `${history[lastIdx].content}\n\n---\nKONTEKS DOKUMEN (potongan paling relevan dari dokumen yang diupload pengguna; bukan seluruh dokumen):\n${ctx}`
        };
      }
    }

    await setProgress(job.id, "Menulis jawaban");
    const reply = await ollamaCall([{ role: "system", content: system }, ...history], { maxTokens: cfg.maxOutputTokens });
    return `${reply.trim()}${docNote}`;
  }

  // ---------------- pemrosesan job ----------------
  async function claimNext() {
    const { data, error } = await supabase
      .from("agent_jobs")
      .select("id, chat_date, question")
      .eq("status", "pending")
      .eq("agent", "ollama")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) {
      noteDbError(error);
      return null;
    }
    const job = data?.[0];
    if (!job) return null;
    // Klaim atomik: hanya berhasil kalau masih 'pending'.
    const { data: claimed, error: claimErr } = await supabase
      .from("agent_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), progress: "Memulai" })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id");
    if (claimErr || !claimed || claimed.length === 0) return null;
    return job;
  }

  async function processJob(job) {
    const t0 = Date.now();
    log.log(`🦙 Job aplikasi ${job.id.slice(0, 8)}: "${clip(job.question, 60)}"`);
    try {
      const reply = await answerJob(job);
      if (!reply) throw new Error("Ollama mengembalikan jawaban kosong.");
      const { data: row, error: insErr } = await supabase
        .from("chat_messages")
        .insert({ chat_date: job.chat_date, role: "assistant", content: reply, agent: "ollama" })
        .select("id")
        .single();
      if (insErr) throw new Error(`Gagal simpan balasan: ${insErr.message}`);
      await supabase
        .from("agent_jobs")
        .update({ status: "done", assistant_message_id: row?.id ?? null, progress: null, error: null, finished_at: new Date().toISOString() })
        .eq("id", job.id);
      log.log(`🦙 Job ${job.id.slice(0, 8)} selesai dalam ${Math.round((Date.now() - t0) / 1000)} dtk.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`🦙 Job ${job.id.slice(0, 8)} gagal: ${msg}`);
      await supabase
        .from("agent_jobs")
        .update({ status: "failed", error: clip(msg, 500), progress: null, finished_at: new Date().toISOString() })
        .eq("id", job.id);
    }
  }

  async function tick() {
    if (stopped || working) return;
    working = true;
    try {
      // Kuras antrean satu per satu (Ollama CPU-only: tidak paralel).
      for (let guard = 0; guard < 20 && !stopped; guard += 1) {
        const job = await claimNext();
        if (!job) break;
        await processJob(job);
      }
    } catch (err) {
      log.error("🦙 Agen aplikasi: error tak terduga:", err instanceof Error ? err.message : String(err));
    } finally {
      working = false;
    }
  }

  return {
    tick,
    heartbeat,
    processJob,
    answerJob,
    async start() {
      if (!cfg.enabled) {
        log.log("🦙 Agen Ollama untuk chat aplikasi dimatikan (APP_AGENT_ENABLED=false).");
        return;
      }
      // Job 'running' sisa proses sebelumnya (bot mati/restart) tidak akan
      // pernah selesai -- tutup sebagai gagal supaya aplikasi tidak menunggu.
      const { error } = await supabase
        .from("agent_jobs")
        .update({ status: "failed", error: "Bot dimulai ulang saat job ini diproses.", finished_at: new Date().toISOString() })
        .eq("status", "running");
      if (error) noteDbError(error);
      await heartbeat().catch((e) => log.error("🦙 heartbeat gagal:", e instanceof Error ? e.message : String(e)));
      hbTimer = setInterval(() => heartbeat().catch(() => {}), cfg.heartbeatMs);
      pollTimer = setInterval(() => tick().catch(() => {}), cfg.pollMs);
      log.log(`🦙 Agen Ollama untuk chat aplikasi aktif (model ${ollamaModel}, ctx ${cfg.numCtx}, cek antrean tiap ${Math.round(cfg.pollMs / 1000)} dtk).`);
    },
    async stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (hbTimer) clearInterval(hbTimer);
      // Tandai offline supaya aplikasi langsung tahu (bukan menunggu 60 dtk).
      try {
        await supabase.from("agent_worker_status").upsert({ id: "ollama", last_seen: new Date(0).toISOString(), ollama_ok: false, busy: false, detail: "Bot dihentikan" });
      } catch {
        /* best-effort */
      }
    }
  };
}
