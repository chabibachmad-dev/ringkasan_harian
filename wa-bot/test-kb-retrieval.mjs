// Tes jalur Gemini -> indeks laptop: Edge Function (requestLaptopChunks, salinan TS ditranspilasi)
// menaruh permintaan, worker bot (kb-retrieval.js) menjawab dari indeks FTS5, dengan Supabase palsu di memori.
//   node test-kb-retrieval.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { openKbIndex } from "./kb-index.js";
import { createKbRetrievalWorker } from "./kb-retrieval.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, error() {} };

// ---- Supabase palsu (cukup untuk query yang dipakai kedua sisi) ----
function makeDb(seed = {}) {
  const tables = { kb_retrievals: [], agent_worker_status: [], ...seed };
  let n = 0;
  const from = (name) => {
    const t = tables[name];
    const st = { op: "select", filters: [], order: null, limit: null, payload: null, single: false, maybe: false, wantRows: false };
    const run = () => {
      let rows = t.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === "insert") {
        const row = { id: `id-${++n}`, status: "pending", created_at: new Date().toISOString(), ...st.payload };
        t.push(row);
        return { data: st.single ? row : [row], error: null };
      }
      if (st.op === "update") {
        rows.forEach((r) => Object.assign(r, st.payload));
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      if (st.op === "delete") {
        const keep = t.filter((r) => !rows.includes(r));
        t.length = 0;
        t.push(...keep);
        return { data: null, error: null };
      }
      if (st.order) rows = [...rows].sort((a, b) => (a[st.order] > b[st.order] ? 1 : -1));
      if (st.limit) rows = rows.slice(0, st.limit);
      if (st.single || st.maybe) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; },
      insert(p) { st.op = "insert"; st.payload = p; return q; },
      update(p) { st.op = "update"; st.payload = p; return q; },
      delete() { st.op = "delete"; return q; },
      eq(k, v) { st.filters.push((r) => r[k] === v); return q; },
      in(k, vs) { st.filters.push((r) => vs.includes(r[k])); return q; },
      lt(k, v) { st.filters.push((r) => r[k] < v); return q; },
      order(k) { st.order = k; return q; },
      limit(x) { st.limit = x; return q; },
      single() { st.single = true; return q; },
      maybeSingle() { st.maybe = true; return q; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    return q;
  };
  return { from, tables };
}

// ---- salinan TS Edge Function ----
const out = path.join(os.tmpdir(), `laptop-kb-${process.pid}.mjs`);
execFileSync(path.join(here, "..", "node_modules", ".bin", "esbuild"), [path.join(here, "..", "supabase", "functions", "_shared", "laptop-kb.ts"), "--format=esm", `--outfile=${out}`, "--log-level=error"]);
const { requestLaptopChunks } = await import(pathToFileURL(out).href);
fs.rmSync(out, { force: true });

const index = await openKbIndex({ file: ":memory:", log: silent });
index.upsertDoc({ id: "d1", title: "PMK Bendahara", pages: [
  { page: 4, text: "Bendahara pengeluaran wajib melakukan penyetoran pajak yang telah dipungut ke kas negara paling lambat tanggal 10 bulan berikutnya." },
  { page: 9, text: "Perjalanan dinas dalam negeri dibayarkan secara lumpsum sesuai standar biaya masukan." }
] });

const fresh = () => new Date().toISOString();
{
  const db = makeDb({ agent_worker_status: [{ id: "ollama", last_seen: fresh(), extra: { kb: { docs: 1 } } }] });
  const worker = createKbRetrievalWorker({ supabase: db, index, log: silent, env: {} });
  const timer = setInterval(() => worker.tick(), 50);
  const r = await requestLaptopChunks(db, { chatDate: "freeform-x", query: "bagaimana cara menyetor pajak?", pollMs: 40, timeoutMs: 5000 });
  clearInterval(timer);
  check(r.ok && r.chunks.length > 0 && r.chunks[0].page === 4 && /penyetoran/.test(r.chunks[0].text), "alur lengkap: permintaan -> worker -> potongan hlm 4 (imbuhan menyetor~penyetoran)");
  check(r.ok && r.chunks[0].title === "PMK Bendahara" && typeof r.chunks[0].score === "number", "hasil memuat judul & skor");
  check(db.tables.kb_retrievals[0].status === "done" && db.tables.kb_retrievals[0].stats.docs === 1, "baris ditandai done + statistik");
}
{
  const db = makeDb({ agent_worker_status: [{ id: "ollama", last_seen: fresh(), extra: { kb: { docs: 1 } } }] });
  const worker = createKbRetrievalWorker({ supabase: db, index, log: silent, env: {} });
  const timer = setInterval(() => worker.tick(), 50);
  const r = await requestLaptopChunks(db, { chatDate: "x", query: "xylophone zeppelin", pollMs: 40, timeoutMs: 5000 });
  clearInterval(timer);
  check(r.ok && r.chunks.length === 0, "tidak ada yang cocok -> ok dengan 0 blok (bukan error)");
}
{
  const db = makeDb({ agent_worker_status: [{ id: "ollama", last_seen: new Date(Date.now() - 5 * 60_000).toISOString(), extra: { kb: { docs: 1 } } }] });
  const r = await requestLaptopChunks(db, { chatDate: "x", query: "pajak", pollMs: 20, timeoutMs: 200 });
  check(!r.ok && /tidak aktif/.test(r.reason) && db.tables.kb_retrievals.length === 0, "bot mati -> langsung gagal tanpa membuat permintaan");
}
{
  const db = makeDb({ agent_worker_status: [{ id: "ollama", last_seen: fresh(), extra: { kb: { docs: 0 } } }] });
  const r = await requestLaptopChunks(db, { chatDate: "x", query: "pajak", pollMs: 20, timeoutMs: 200 });
  check(!r.ok && /kosong/.test(r.reason), "indeks laptop kosong -> gagal (pakai cloud)");
}
{
  const db = makeDb({ agent_worker_status: [{ id: "ollama", last_seen: fresh(), extra: { kb: { docs: 1 } } }] });
  const r = await requestLaptopChunks(db, { chatDate: "x", query: "pajak", pollMs: 20, timeoutMs: 250 });
  check(!r.ok && /tepat waktu/.test(r.reason) && db.tables.kb_retrievals[0].status === "failed", "bot tidak menjawab -> waktu habis, baris ditutup 'failed'");
}
{
  const db = makeDb();
  db.tables.kb_retrievals.push({ id: "old", status: "done", created_at: new Date(Date.now() - 3 * 86400_000).toISOString() });
  db.tables.kb_retrievals.push({ id: "new", status: "pending", question: "penyetoran pajak", budget_chars: 99999999, max_chunks: 999, created_at: fresh() });
  const worker = createKbRetrievalWorker({ supabase: db, index, log: silent, env: {} });
  await worker.tick();
  const row = db.tables.kb_retrievals.find((x) => x.id === "new");
  check(row.status === "done" && row.chunks.reduce((n, c) => n + c.text.length, 0) <= 30000 + 1500, "anggaran permintaan dibatasi KB_RETRIEVAL_MAX_BUDGET_CHARS");
  check(!db.tables.kb_retrievals.some((x) => x.id === "old"), "baris > 1 hari dibersihkan");
}
{
  const db = makeDb();
  db.tables.kb_retrievals.push({ id: "r", status: "pending", question: "pajak", created_at: fresh() });
  const empty = await openKbIndex({ file: ":memory:", log: silent });
  const worker = createKbRetrievalWorker({ supabase: db, index: empty, log: silent, env: {} });
  await worker.tick();
  check(db.tables.kb_retrievals[0].status === "done" && db.tables.kb_retrievals[0].chunks.length === 0, "indeks kosong di sisi bot -> done dengan 0 blok");
}
console.log(fails ? `\n${fails} GAGAL` : "\nsemua OK");
process.exit(fails ? 1 : 0);
