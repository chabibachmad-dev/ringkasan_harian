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

import { guardDocAnswer } from "./docguard.js";

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
    // Saat dokumen/lampiran ikut dibaca, prompt sudah besar (prompt-eval di CPU
    // lambat ~20 token/dtk): riwayat dipangkas supaya jawaban tidak berlama-lama.
    docHistoryLimit: num(env.OLLAMA_DOC_HISTORY_LIMIT, 4),
    docHistoryClipChars: num(env.OLLAMA_DOC_HISTORY_CLIP_CHARS, 700),
    ragBudgetChars: num(env.OLLAMA_CHAT_RAG_BUDGET_CHARS, 5000),
    docChunkChars: num(env.OLLAMA_DOC_CHUNK_CHARS, 5000),
    docMaxChunks: num(env.OLLAMA_DOC_MAX_CHUNKS, 6),
    docNoteTokens: num(env.OLLAMA_DOC_NOTE_TOKENS, 220),
    // Suhu rendah saat membaca dokumen: jawaban kaku & patuh pada teks, bukan berimajinasi (0 s.d. ~0.3).
    docTemperature: Number.isFinite(Number(env.OLLAMA_DOC_TEMPERATURE)) && env.OLLAMA_DOC_TEMPERATURE !== undefined && env.OLLAMA_DOC_TEMPERATURE !== "" ? Math.min(1, Math.max(0, Number(env.OLLAMA_DOC_TEMPERATURE))) : 0.1,
    // Lampiran sangat pendek (total karakter <= ini) disisipkan UTUH ke prompt.
    attachInlineChars: num(env.OLLAMA_ATTACH_INLINE_CHARS, 6000),
    // Kirim push ke HP kalau job selesai lebih lama dari ini (detik) -- yang cepat
    // tidak perlu, pengguna masih menatap layar. 0 = selalu kirim.
    notifyMinSeconds: Number.isFinite(Number(env.APP_AGENT_NOTIFY_MIN_SECONDS)) ? Math.max(0, Number(env.APP_AGENT_NOTIFY_MIN_SECONDS)) : 20
  };
}

const SYSTEM_PROMPT = `Namamu Ayyubi. Kamu adalah asisten pribadi di dalam aplikasi "Ayyubi" milik satu pengguna saja. Kamu berjalan sebagai model AI LOKAL di laptop pengguna (BUKAN di internet) dan TIDAK punya akses pencarian web.
Jawab dengan ramah, jelas, dan seringkas mungkin tanpa kehilangan inti jawaban. Gunakan Bahasa Indonesia kecuali pengguna jelas menulis/minta bahasa lain. Boleh memakai format markdown sederhana (daftar, **tebal**, blok kode).
Kadang di pesan terakhir ada blok "KONTEKS DOKUMEN" yang dicarikan otomatis dari dokumen yang diupload pengguna. Jadikan itu sumber utama bila relevan dan sebut judul dokumennya. Kalau jawabannya tidak ada di konteks itu, katakan terus terang; untuk istilah/aturan/angka resmi yang spesifik dan kamu tidak yakin, JANGAN mengarang -- akui belum bisa memastikan dan sarankan cek sumber resmi.`;

// Aturan ketat anti-halusinasi, ditambahkan ke prompt sistem bila dokumen/lampiran ikut dibaca
// (toggle "Pakai Dokumen Pengetahuan" aktif atau ada lampiran).
export const STRICT_DOC_RULES = `ATURAN DOKUMEN (WAJIB):
- Untuk pertanyaan tentang isi dokumen/lampiran, jawab HANYA berdasarkan teks di blok KONTEKS DOKUMEN / LAMPIRAN. Jangan menebak dan jangan memakai pengetahuan luar untuk fakta, angka, pasal, istilah, atau daftar.
- Kalau jawabannya tidak ada di teks itu, tulis persis: "Informasi tidak ada di dokumen." Boleh ditambah satu kalimat tentang apa yang ADA di potongan yang ditemukan.
- Sebut judul dokumen dan nomor halaman ([Halaman n]) untuk setiap fakta yang kamu ambil.
- Kalau diminta daftar (rukun, wajib, syarat, langkah): tuliskan SEMUA butir yang benar-benar tertulis di teks, jangan menambah dan jangan mengurangi. Bila potongan tampak terpotong atau daftar belum lengkap, katakan "daftar di potongan ini mungkin belum lengkap".
- Kalau potongan yang ditemukan hanya berupa daftar isi atau judul bab tanpa isinya, katakan isi bagian itu belum terbaca.
- Sapaan atau obrolan umum yang tidak menyangkut dokumen: jawab seperti biasa.`;

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

// Riwayat ringkas untuk mode dokumen: hanya `limit` pesan terakhir; balasan lama
// asisten dipotong (jawaban panjang sebelumnya paling banyak menambah token).
// Pesan terakhir (pertanyaan sekarang) selalu utuh.
export function compactHistory(history, limit, clipChars) {
  const tail = history.slice(-Math.max(1, limit));
  return tail.map((m, i) => (i < tail.length - 1 && m.role === "assistant" ? { ...m, content: clip(m.content, clipChars) } : m));
}

export function createAppAgentWorker(deps, overrides = {}) {
  const cfg = { ...readAppAgentConfig(), ...overrides };
  const {
    supabase,
    callOllamaChat,
    enqueueOllamaCall,
    fetchRelevantKnowledgeChunks,
    rankKnowledgeChunks, // (docs, question, budgetChars) -> [{score,title,text}]
    chunkDocumentText,
    currentDateLine,
    ollamaBaseUrl,
    ollamaModel,
    notify, // async ({ title, body, url, tag }) -> void (push ke HP); opsional
    kbIndex, // indeks dokumen di laptop (kb-index.js); opsional
    getExtra, // () -> { waConnected, extra }; opsional (untuk halaman Status sistem)
    log = console
  } = deps;
  const startedAtIso = new Date().toISOString();

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
    let ex = {};
    try {
      ex = (typeof getExtra === "function" ? getExtra() : null) || {};
    } catch {
      /* info tambahan best-effort */
    }
    const row = {
      id: "ollama",
      last_seen: new Date().toISOString(),
      ollama_ok: ollamaOk,
      model: ollamaModel,
      busy: working,
      detail: ollamaOk ? null : chk.detail,
      started_at: startedAtIso,
      ...(typeof ex.waConnected === "boolean" ? { wa_connected: ex.waConnected } : {}),
      ...(ex.extra ? { extra: ex.extra } : {})
    };
    let { error } = await supabase.from("agent_worker_status").upsert(row);
    // Migrasi 0016 (kolom started_at/wa_connected/extra) belum dijalankan: ulangi tanpa kolom baru
    // supaya denyut dasar tetap jalan.
    if (error && /started_at|wa_connected|extra/i.test(error.message || "")) {
      const { started_at, wa_connected, extra, ...basic } = row;
      ({ error } = await supabase.from("agent_worker_status").upsert(basic));
    }
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

  // Chat di aplikasi = prioritas tertinggi (0): didahulukan dari balasan WA & pekerjaan latar.
  const ollamaCall = (messages, opts) =>
    enqueueOllamaCall(
      () => callOllamaChat(messages, { timeoutMs: cfg.timeoutMs, numCtx: cfg.numCtx, temperature: 0.4, ...opts }),
      { priority: 0, label: "app-chat" }
    );

  async function setProgress(jobId, text) {
    await supabase.from("agent_jobs").update({ progress: text }).eq("id", jobId);
  }

  // Peta-lalu-ringkas atas seluruh Dokumen Pengetahuan. Mengembalikan teks
  // catatan (atau null kalau tidak ada dokumen).
  async function loadKbDocs() {
    // Dokumen yang diindeks di laptop: pakai teks LENGKAP dari sana (salinan di
    // Supabase bisa dipotong untuk Gemini).
    if (kbIndex && kbIndex.hasDocs()) return kbIndex.getAllDocs();
    const { data: docs, error } = await supabase.from("knowledge_documents").select("title, content").neq("content", "");
    if (error) throw new Error(`Gagal baca dokumen: ${error.message}`);
    return docs ?? [];
  }

  async function loadAttachments(chatDate) {
    const { data, error } = await supabase
      .from("chat_attachments")
      .select("name, content, created_at")
      .eq("chat_date", chatDate)
      .order("created_at", { ascending: true })
      .limit(3);
    // Tabel belum ada (migrasi 0016 belum jalan) -> anggap tidak ada lampiran.
    if (error) return [];
    return (data ?? []).map((a) => ({ title: `Lampiran: ${a.name}`, content: a.content }));
  }

  async function mapDocuments(job, docs) {
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
        { maxTokens: cfg.docNoteTokens, temperature: cfg.docTemperature }
      );
      const trimmed = note.trim();
      if (trimmed && trimmed !== "-") notes.push(`[${part.title} — bagian ${i + 1}]\n${trimmed}`);
    }
    return { notes, total: all.length, read: picked.length, partial };
  }

  async function answerJob(job) {
    let history = await loadHistory(job.chat_date, job.question);
    const useKb = await threadUsesKb(job.chat_date);
    const attachments = await loadAttachments(job.chat_date);
    if (useKb || attachments.length > 0) history = compactHistory(history, cfg.docHistoryLimit, cfg.docHistoryClipChars);
    const strictDocs = useKb || attachments.length > 0;
    const system = `${SYSTEM_PROMPT}${strictDocs ? `\n\n${STRICT_DOC_RULES}` : ""}\n\n${currentDateLine()}`;
    const lastIdx = history.length - 1;
    const addContext = (label, body) => {
      history[lastIdx] = { role: "user", content: `${history[lastIdx].content}\n\n---\n${label}\n${body}` };
    };
    const formatChunks = (chunks) => {
      const titles = [...new Set(chunks.map((c) => c.title))];
      return titles
        .map((t) => `=== Dokumen: "${t}" ===\n${chunks.filter((c) => c.title === t).map((c) => c.text).join("\n\n---\n\n")}`)
        .join("\n\n");
    };
    let docNote = "";
    let guardChunks = []; // potongan yang BENAR-BENAR dikirim ke model (untuk memeriksa kutipan/halaman di jawabannya)
    const whole = wantsWholeDocument(job.question);
    const attChars = attachments.reduce((n, a) => n + a.content.length, 0);

    if (attachments.length > 0 && attChars <= cfg.attachInlineChars) {
      // Lampiran pendek: sisipkan utuh. KB (kalau aktif) tetap dicari relevan.
      addContext("LAMPIRAN dari pengguna (utuh):", attachments.map((a) => `=== ${a.title} ===\n${a.content}`).join("\n\n"));
      if (useKb && !whole) {
        await setProgress(job.id, "Mencari bagian dokumen yang relevan");
        const chunks = await fetchRelevantKnowledgeChunks(job.question, cfg.ragBudgetChars);
        if (chunks.length > 0) {
          guardChunks = chunks;
          addContext("KONTEKS DOKUMEN (potongan relevan dari dokumen pengetahuan):", formatChunks(chunks));
        }
      }
    } else if (attachments.length > 0 && whole) {
      // Permintaan menyeluruh atas lampiran panjang: baca per bagian.
      const mapped = await mapDocuments(job, attachments);
      if (mapped) {
        await setProgress(job.id, "Menyusun jawaban dari catatan lampiran");
        addContext("KONTEKS LAMPIRAN (catatan hasil membaca file yang dilampirkan pengguna):", mapped.notes.length > 0 ? mapped.notes.join("\n\n") : "(tidak ada bagian yang tampak relevan)");
        if (mapped.partial) {
          docNote = `\n\n_Catatan: model lokal hanya membaca ${mapped.read} dari ${mapped.total} bagian lampiran (dipilih merata) agar tidak terlalu lama — untuk file panjang, hasilnya bisa belum lengkap._`;
        }
      }
    } else if (attachments.length > 0) {
      // Pertanyaan spesifik atas lampiran panjang: potongan paling relevan (+ KB bila aktif).
      await setProgress(job.id, "Mencari bagian lampiran yang relevan");
      let chunks = rankKnowledgeChunks(attachments, job.question, cfg.ragBudgetChars);
      if (!chunks.some((c) => c.title.startsWith("Lampiran:"))) {
        // Tidak ada kata yang cocok ("apa isi file ini?"): ambil awal lampiran.
        const head = [];
        let used = 0;
        for (const a of attachments) {
          for (const text of chunkDocumentText(a.content, cfg.docChunkChars)) {
            if (used >= cfg.ragBudgetChars) break;
            head.push({ title: a.title, text });
            used += text.length;
          }
        }
        chunks = [...head, ...chunks];
        docNote = "\n\n_Catatan: pertanyaan tidak spesifik, jadi yang dibaca model hanya bagian awal lampiran._";
      }
      if (useKb) {
        const kb = await fetchRelevantKnowledgeChunks(job.question, Math.floor(cfg.ragBudgetChars / 2));
        chunks = [...chunks, ...kb];
      }
      guardChunks = chunks;
      addContext("KONTEKS LAMPIRAN/DOKUMEN (potongan paling relevan; bukan seluruh isi):", formatChunks(chunks));
    } else if (useKb && whole) {
      const mapped = await mapDocuments(job, await loadKbDocs());
      if (mapped) {
        await setProgress(job.id, "Menyusun jawaban dari catatan dokumen");
        addContext("KONTEKS DOKUMEN (catatan hasil membaca dokumen yang diupload pengguna):", mapped.notes.length > 0 ? mapped.notes.join("\n\n") : "(tidak ada bagian yang tampak relevan)");
        if (mapped.partial) {
          docNote = `\n\n_Catatan: model lokal hanya membaca ${mapped.read} dari ${mapped.total} bagian dokumen (dipilih merata) agar tidak terlalu lama — untuk dokumen panjang, hasilnya bisa belum lengkap._`;
        }
      }
    } else if (useKb) {
      await setProgress(job.id, "Mencari bagian dokumen yang relevan");
      const chunks = await fetchRelevantKnowledgeChunks(job.question, cfg.ragBudgetChars);
      if (chunks.length > 0) {
        guardChunks = chunks;
        addContext("KONTEKS DOKUMEN (potongan paling relevan dari dokumen yang diupload pengguna; bukan seluruh dokumen):", formatChunks(chunks));
      }
      else addContext("KONTEKS DOKUMEN:", "(Tidak ditemukan bagian dokumen yang cocok dengan pertanyaan ini.)");
    }

    await setProgress(job.id, "Menulis jawaban");
    // Laporkan kemajuan (maks. tiap 5 dtk) supaya terlihat masih bekerja, bukan macet.
    let lastPush = 0;
    const onToken = (n) => {
      const now = Date.now();
      if (now - lastPush < 5000) return;
      lastPush = now;
      setProgress(job.id, `Menulis jawaban (${n} token)`).catch(() => {});
    };
    const reply = await ollamaCall([{ role: "system", content: system }, ...history], {
      maxTokens: cfg.maxOutputTokens,
      onToken,
      ...(strictDocs ? { temperature: cfg.docTemperature } : {})
    });
    // Kutipan «…» / nomor halaman yang tak ada di potongan yang dikirim ke model diberi catatan peringatan.
    const guarded = guardChunks.length > 0 ? guardDocAnswer(reply.trim(), guardChunks) : null;
    if (guarded?.flagged) log.log(`🛡️ Job ${job.id.slice(0, 8)}: jawaban ditandai (kutipan tak terbukti ${guarded.badQuotes.length}, halaman tak ada ${guarded.badPages.length}).`);
    return `${guarded ? guarded.reply : reply.trim()}${docNote}`;
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
      const secs = Math.round((Date.now() - t0) / 1000);
      log.log(`🦙 Job ${job.id.slice(0, 8)} selesai dalam ${secs} dtk.`);
      await pushNotice(job, secs, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`🦙 Job ${job.id.slice(0, 8)} gagal: ${msg}`);
      await supabase
        .from("agent_jobs")
        .update({ status: "failed", error: clip(msg, 500), progress: null, finished_at: new Date().toISOString() })
        .eq("id", job.id);
      await pushNotice(job, Math.round((Date.now() - t0) / 1000), false);
    }
  }

  // Push ke HP saat job (yang cukup lama) selesai/gagal. Isi jawaban TIDAK ikut
  // dikirim lewat push -- hanya pemberitahuan + tautan ke obrolannya.
  async function pushNotice(job, secs, ok) {
    if (typeof notify !== "function" || secs < cfg.notifyMinSeconds) return;
    try {
      await notify({
        title: ok ? "Jawaban Ollama sudah siap" : "Ollama gagal menjawab",
        body: ok ? "Ketuk untuk membuka obrolan." : "Ketuk untuk membuka obrolan, lalu coba lagi atau pilih Gemini.",
        url: `./#d/${job.chat_date}`,
        tag: `ollama-${job.id}`
      });
    } catch (err) {
      log.error("🦙 Push notifikasi gagal:", err instanceof Error ? err.message : String(err));
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
