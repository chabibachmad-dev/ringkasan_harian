// Tes worker agen aplikasi dengan Supabase & Ollama palsu (tanpa jaringan sungguhan).
//   node test-app-agent.mjs
import http from "node:http";
import { createAppAgentWorker, wantsWholeDocument, pickEvenly } from "./app-agent.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// ---- Supabase palsu (in-memory, hanya fitur yang dipakai worker) ----
function makeDb(tables) {
  let idc = 0;
  const from = (name) => {
    const st = { name, filters: [], neqs: [], order: null, limit: null, op: "select", payload: null, wantSel: false, single: false };
    const rows = () => (tables[name] ??= []);
    const match = (r) => st.filters.every(([c, v]) => r[c] === v) && st.neqs.every(([c, v]) => r[c] !== v);
    const run = () => {
      const t = rows();
      if (st.op === "select") {
        let out = t.filter(match);
        if (st.order) out = [...out].sort((a, b) => (a[st.order.c] > b[st.order.c] ? 1 : -1) * (st.order.asc ? 1 : -1));
        if (st.limit) out = out.slice(0, st.limit);
        return { data: st.single ? out[0] ?? null : out, error: null };
      }
      if (st.op === "insert") {
        const row = { id: `id-${++idc}`, created_at: new Date(Date.now() + idc).toISOString(), ...st.payload };
        t.push(row);
        return { data: st.single ? { id: row.id } : [{ id: row.id }], error: null };
      }
      if (st.op === "update") {
        const hit = t.filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return { data: st.wantSel ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (st.op === "upsert") {
        const ex = t.find((r) => r.id === st.payload.id);
        if (ex) Object.assign(ex, st.payload); else t.push({ ...st.payload });
        return { data: null, error: null };
      }
    };
    const b = {
      select() { if (st.op === "select") st.op = "select"; else st.wantSel = true; return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      neq(c, v) { st.neqs.push([c, v]); return b; },
      order(c, o) { st.order = { c, asc: o?.ascending !== false }; return b; },
      limit(n) { st.limit = n; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      upsert(p) { st.op = "upsert"; st.payload = p; return b; },
      single() { st.single = true; return b; },
      maybeSingle() { st.single = true; return b; },
      then(res, rej) { try { return Promise.resolve(run()).then(res, rej); } catch (e) { return Promise.reject(e).catch(rej); } }
    };
    return b;
  };
  return { from };
}

// ---- Ollama palsu (/api/tags) ----
let tagsBody = { models: [{ name: "qwen2.5:3b" }] };
const srv = http.createServer((req, res) => {
  if (req.url === "/api/tags") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(tagsBody)); } else { res.statusCode = 404; res.end(); }
});
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;

const chunker = (text, size) => { const out = []; for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size)); return out; };
const silent = { log() {}, error() {} };
const pushes = [];

function setup(over = {}) {
  const tables = {
    chat_messages: [
      { id: "m1", chat_date: "freeform-x", role: "user", content: "halo", created_at: "2026-01-01T00:00:01Z" },
      { id: "m2", chat_date: "freeform-x", role: "assistant", content: "hai", created_at: "2026-01-01T00:00:02Z" },
      { id: "m3", chat_date: "freeform-x", role: "user", content: "pertanyaan baru", created_at: "2026-01-01T00:00:03Z" }
    ],
    chat_thread_meta: [{ id: "freeform-x", use_kb: false }],
    knowledge_documents: [{ title: "Dok A", content: "A".repeat(2500) + "B".repeat(2500) + "C".repeat(2500) + "D".repeat(2500) }],
    agent_jobs: [{ id: "job-1", chat_date: "freeform-x", agent: "ollama", question: "pertanyaan baru", status: "pending", created_at: "2026-01-01T00:00:04Z" }],
    agent_worker_status: []
  };
  const calls = [];
  const w = createAppAgentWorker(
    {
      supabase: makeDb(tables),
      kbIndex: over.kbIndex,
      callOllamaChat: async (messages, opts) => { calls.push({ messages, opts }); if (over.fail) throw new Error("Ollama mati"); return over.reply ? over.reply(messages) : "jawaban lokal"; },
      enqueueOllamaCall: (fn) => fn(),
      fetchRelevantKnowledgeChunks: async () => [{ title: "Dok A", text: "isi potongan relevan" }],
      rankKnowledgeChunks: (docs, q) => {
        const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const out = [];
        for (const d of docs) for (const text of chunker(d.content, 400)) {
          const score = words.filter((w) => text.toLowerCase().includes(w)).length;
          if (score > 0) out.push({ score, title: d.title, text });
        }
        return out.sort((a, b) => b.score - a.score).slice(0, 2);
      },
      notify: async (p) => { pushes.push(p); },
      getExtra: () => ({ waConnected: true, extra: { pausedChats: 2 } }),
      chunkDocumentText: chunker,
      currentDateLine: () => "Waktu sekarang: tes.",
      ollamaBaseUrl: base,
      ollamaModel: "qwen2.5:3b",
      log: silent
    },
    { docChunkChars: 2500, docMaxChunks: 3, attachInlineChars: 300, notifyMinSeconds: 0, ...(over.cfg || {}) }
  );
  return { tables, calls, w };
}

// 1. Util
check(wantsWholeDocument("tolong ringkas dokumen ini") && wantsWholeDocument("Analisis PMK") && !wantsWholeDocument("berapa tarif hotel di Jogja"), "deteksi permintaan menyeluruh");
check(JSON.stringify(pickEvenly([1,2,3,4,5,6,7,8,9,10], 3)) === "[1,6,10]" && pickEvenly([1,2],5).length === 2, "pickEvenly merata & menyertakan ujung");

// 2. Chat biasa (tanpa KB)
{
  const { tables, calls, w } = setup();
  await w.tick();
  const job = tables.agent_jobs[0];
  check(job.status === "done" && job.assistant_message_id, "job biasa selesai");
  const reply = tables.chat_messages.find((m) => m.id === job.assistant_message_id);
  check(reply?.role === "assistant" && reply.agent === "ollama" && reply.content === "jawaban lokal", "balasan tersimpan dgn agent=ollama");
  check(calls.length === 1 && calls[0].messages[0].role === "system" && calls[0].messages.at(-1).content === "pertanyaan baru", "prompt: system + riwayat, pertanyaan terakhir");
  check(!calls[0].messages.at(-1).content.includes("KONTEKS DOKUMEN"), "tanpa KB tidak ada konteks dokumen");
  check(calls[0].opts.numCtx === 8192 && calls[0].opts.maxTokens === 700, "num_ctx 8192 & max output 700 utk chat aplikasi");
}

// 3. RAG (KB aktif, pertanyaan spesifik)
{
  const { tables, calls, w } = setup();
  tables.chat_thread_meta[0].use_kb = true;
  await w.tick();
  check(calls.length === 1 && calls[0].messages.at(-1).content.includes("isi potongan relevan"), "RAG: potongan relevan disisipkan");
  check(tables.agent_jobs[0].status === "done", "RAG: job selesai");
}

// 4. Peta-lalu-ringkas (permintaan menyeluruh) + catatan sebagian
{
  const { tables, calls, w } = setup({ reply: (m) => (m[0].content.startsWith("Kamu membaca") ? "- poin" : "RINGKASAN AKHIR") });
  tables.chat_thread_meta[0].use_kb = true;
  tables.agent_jobs[0].question = "tolong ringkas dokumen ini";
  tables.chat_messages[2].content = "tolong ringkas dokumen ini";
  await w.tick();
  check(calls.length === 4, `map: 3 bagian + 1 jawaban akhir (aktual ${calls.length})`);
  check(calls.at(-1).messages.at(-1).content.includes("[Dok A — bagian 1]"), "reduce: catatan bagian dimasukkan");
  const reply = tables.chat_messages.find((m) => m.id === tables.agent_jobs[0].assistant_message_id);
  check(reply.content.startsWith("RINGKASAN AKHIR") && /hanya membaca 3 dari 4 bagian/.test(reply.content), "jawaban memuat catatan 'sebagian dokumen'");
}

// 4b. Indeks laptop (kbIndex): RAG pakai FTS, ringkas pakai teks lengkap dari indeks
{
  const fakeIndex = {
    hasDocs: () => true,
    getAllDocs: () => [{ id: "x", title: "Dok Besar", content: "Z".repeat(5000) + "Y".repeat(5000) }]
  };
  const t2 = setup({ reply: (m) => (m[0].content.startsWith("Kamu membaca") ? "- poin" : "RINGKASAN"), kbIndex: fakeIndex });
  t2.tables.chat_thread_meta[0].use_kb = true;
  t2.tables.agent_jobs[0].question = "tolong ringkas dokumen ini";
  t2.tables.chat_messages[2].content = "tolong ringkas dokumen ini";
  await t2.w.tick();
  check(t2.calls.slice(0, -1).every((c) => /Dok Besar/.test(c.messages.at(-1).content)), "ringkas: bagian dibaca dari teks LENGKAP di indeks laptop, bukan salinan Supabase");
}

// 5. Gagal -> status failed + pesan error
{
  const { tables, w } = setup({ fail: true });
  await w.tick();
  const job = tables.agent_jobs[0];
  check(job.status === "failed" && /Ollama mati/.test(job.error), "gagal tercatat di job");
  check(!tables.chat_messages.some((m) => m.role === "assistant" && m.agent === "ollama"), "tidak ada balasan palsu saat gagal");
}

// 6. Klaim: job non-pending / bukan ollama diabaikan; antrean berurutan
{
  const { tables, calls, w } = setup();
  tables.agent_jobs.push({ id: "job-2", chat_date: "freeform-x", agent: "ollama", question: "kedua", status: "running", created_at: "2026-01-01T00:00:05Z" });
  tables.agent_jobs.push({ id: "job-3", chat_date: "freeform-x", agent: "gemini", question: "x", status: "pending", created_at: "2026-01-01T00:00:06Z" });
  await w.tick();
  check(tables.agent_jobs[0].status === "done" && tables.agent_jobs[1].status === "running" && tables.agent_jobs[2].status === "pending" && calls.length === 1, "hanya job pending milik ollama yang diambil");
}


// 9. Lampiran: pendek -> utuh
{
  const { tables, calls, w } = setup();
  tables.chat_attachments = [{ id: "a1", chat_date: "freeform-x", name: "kecil.txt", content: "ISI LAMPIRAN KECIL", created_at: "2026-01-01T00:00:00Z" }];
  await w.tick();
  const last = calls.at(-1).messages.at(-1).content;
  check(last.includes("LAMPIRAN dari pengguna (utuh)") && last.includes("ISI LAMPIRAN KECIL"), "lampiran pendek disisipkan utuh");
}
// 10. Lampiran panjang + pertanyaan spesifik -> potongan relevan
{
  const long = "x".repeat(1500) + " tarif penginapan golongan tiga adalah 900000 " + "y".repeat(1500);
  const { tables, calls, w } = setup();
  tables.chat_attachments = [{ id: "a1", chat_date: "freeform-x", name: "besar.pdf", content: long, created_at: "2026-01-01T00:00:00Z" }];
  tables.agent_jobs[0].question = "berapa tarif penginapan golongan tiga";
  tables.chat_messages[2].content = "berapa tarif penginapan golongan tiga";
  await w.tick();
  const last = calls.at(-1).messages.at(-1).content;
  check(last.includes("KONTEKS LAMPIRAN/DOKUMEN") && last.includes("tarif penginapan"), "lampiran panjang: potongan relevan");
  check(calls.length === 1, "satu panggilan Ollama utk pertanyaan spesifik");
}
// 11. Lampiran panjang + tanpa kata cocok -> awal lampiran + catatan
{
  const { tables, calls, w } = setup({ reply: () => "ok" });
  tables.chat_attachments = [{ id: "a1", chat_date: "freeform-x", name: "besar.pdf", content: "AWAL-DOKUMEN " + "z".repeat(3000), created_at: "2026-01-01T00:00:00Z" }];
  tables.agent_jobs[0].question = "apa ini";
  tables.chat_messages[2].content = "apa ini";
  await w.tick();
  const reply = tables.chat_messages.find((m) => m.id === tables.agent_jobs[0].assistant_message_id);
  check(calls.at(-1).messages.at(-1).content.includes("AWAL-DOKUMEN") && /hanya bagian awal lampiran/.test(reply.content), "tanpa kata cocok: bagian awal + catatan jujur");
}
// 12. Lampiran panjang + ringkas -> peta-lalu-ringkas hanya atas lampiran (bukan KB)
{
  const { tables, calls, w } = setup({ reply: (m) => (m[0].content.startsWith("Kamu membaca") ? "- poin" : "RINGKAS") });
  tables.chat_thread_meta[0].use_kb = true;
  tables.chat_attachments = [{ id: "a1", chat_date: "freeform-x", name: "laporan.pdf", content: "L".repeat(5000), created_at: "2026-01-01T00:00:00Z" }];
  tables.agent_jobs[0].question = "tolong ringkas file ini";
  tables.chat_messages[2].content = "tolong ringkas file ini";
  await w.tick();
  const mapCalls = calls.filter((c) => c.messages[0].content.startsWith("Kamu membaca"));
  check(mapCalls.length === 2 && mapCalls.every((c) => c.messages[1].content.includes("Lampiran: laporan.pdf")), "ringkas lampiran: 2 bagian dibaca, bukan KB");
  check(calls.at(-1).messages.at(-1).content.includes("KONTEKS LAMPIRAN (catatan"), "reduce memakai catatan lampiran");
}
// 13. Push notifikasi
{
  pushes.length = 0;
  const { w } = setup();
  await w.tick();
  check(pushes.length === 1 && pushes[0].url === "./#d/freeform-x" && /siap/i.test(pushes[0].title) && pushes[0].tag === "ollama-job-1", "push saat selesai membuka obrolan yang benar");
  check(!JSON.stringify(pushes[0]).includes("jawaban lokal"), "isi jawaban TIDAK ikut dikirim lewat push");
  pushes.length = 0;
  const f = setup({ fail: true }); await f.w.tick();
  check(pushes.length === 1 && /gagal/i.test(pushes[0].title), "push saat gagal");
  pushes.length = 0;
  const q = setup({ cfg: { notifyMinSeconds: 60 } }); await q.w.tick();
  check(pushes.length === 0, "job cepat (< ambang) tidak memicu push");
}
// 14. Denyut membawa info tambahan
{
  const { tables, w } = setup();
  tagsBody = { models: [{ name: "qwen2.5:3b" }] };
  await w.heartbeat();
  const st = tables.agent_worker_status[0];
  check(st.wa_connected === true && st.extra?.pausedChats === 2 && !!st.started_at, "denyut memuat wa_connected/extra/started_at");
}

// 7. Denyut
{
  const { tables, w } = setup();
  await w.heartbeat();
  const st = tables.agent_worker_status[0];
  check(st?.id === "ollama" && st.ollama_ok === true && st.model === "qwen2.5:3b", "denyut: Ollama hidup");
  tagsBody = { models: [{ name: "llama3:8b" }] };
  await w.heartbeat();
  check(tables.agent_worker_status[0].ollama_ok === false && /belum ada di Ollama/.test(tables.agent_worker_status[0].detail), "denyut: model belum di-pull terdeteksi");
  srv.close();
  await w.heartbeat();
  check(tables.agent_worker_status[0].ollama_ok === false && /tidak menjawab/.test(tables.agent_worker_status[0].detail), "denyut: Ollama mati terdeteksi");
}

// 8. start(): job 'running' sisa proses lama ditutup gagal
{
  const { tables, w } = setup();
  tables.agent_jobs.push({ id: "job-old", chat_date: "freeform-x", agent: "ollama", question: "lama", status: "running", created_at: "2026-01-01T00:00:00Z" });
  await w.start();
  await w.stop();
  check(tables.agent_jobs.find((j) => j.id === "job-old").status === "failed", "start(): job 'running' lama ditutup gagal");
  check(tables.agent_worker_status[0].ollama_ok === false, "stop(): ditandai offline");
}

console.log(fails ? `GAGAL (${fails})` : "SEMUA OK");
process.exit(fails ? 1 : 0);
