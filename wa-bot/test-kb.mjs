// Tes indeks FTS5 + worker ingest Dokumen Pengetahuan (Supabase palsu, PDF sungguhan).
//   node test-kb.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openKbIndex, tokenizeQuery, buildFtsQuery, splitPageText, parsePageMarkers } from "./kb-index.js";
import { createKbIngestWorker, detectTools, convertFile, pagesToText, readKbConfig } from "./kb-ingest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => fs.readFileSync(path.join(here, "test-fixtures", n));
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, error() {} };

// ---------- util ----------
check(JSON.stringify(tokenizeQuery("Berapa tarif hotel di Yogyakarta?")) === '["tarif","hotel","yogyakarta"]', "tokenizeQuery buang stopword");
check(buildFtsQuery(["pph", "tarif"]) === '"pph" OR "tarif"*', "buildFtsQuery awalan untuk kata >=4 huruf");
{
  const long = Array.from({ length: 60 }, (_, i) => `baris nomor ${i} berisi teks`).join("\n");
  const parts = splitPageText(long, 300);
  check(parts.length > 3 && parts.every((p) => p.length <= 300) && parts.join("\n") === long, "splitPageText <= maks & tidak ada teks hilang");
  check(splitPageText("x".repeat(2500), 1000).every((p) => p.length <= 1000), "baris super panjang tetap dipotong");
}
check(JSON.stringify(parsePageMarkers("[Halaman 1]\nA\n[Halaman 2]\nB").map((p) => p.page)) === "[1,2]", "parsePageMarkers");

// ---------- indeks ----------
const idx = await openKbIndex({ file: ":memory:", log: silent });
{
  idx.upsertDoc({
    id: "d1", title: "PMK Perjalanan Dinas", filename: "pmk.pdf",
    pages: [
      { page: 1, text: "Ketentuan umum perjalanan dinas jabatan." },
      { page: 2, text: "Tarif penginapan Yogyakarta golongan III sebesar Rp1.200.000 per malam." },
      { page: 3, text: "Uang harian Surabaya Rp420.000 per hari." }
    ]
  });
  idx.upsertDoc({ id: "d2", title: "Aturan Pajak", pages: [{ page: 1, text: "Bendahara wajib menyetor pajak paling lambat tanggal 10 bulan berikutnya." }] });
  const r = idx.search("berapa tarif penginapan di Yogyakarta", { budgetChars: 3000 });
  check(r.length > 0 && r[0].title === "PMK Perjalanan Dinas" && r[0].page === 2 && r[0].text.startsWith("[Halaman 2]"), "search: potongan benar + nomor halaman");
  const r2 = idx.search("kapan bendahara setor pajak");
  check(r2[0]?.title === "Aturan Pajak", "search antar dokumen");
  check(idx.search("zzzxyzqq").length === 0, "search tanpa hasil -> []");
  check(idx.getDocText("d1").includes("[Halaman 3]\nUang harian"), "getDocText membawa penanda halaman");
  check(idx.stats().docs === 2 && idx.hasDocs(), "stats");
  idx.upsertDoc({ id: "d2", title: "Aturan Pajak v2", pages: [{ page: 1, text: "Isi baru sama sekali." }] });
  check(idx.search("bendahara pajak").length === 0 && idx.search("isi baru")[0]?.title === "Aturan Pajak v2", "upsert menimpa potongan lama (FTS ikut bersih)");
  idx.removeDoc("d2");
  check(idx.listDocs().length === 1 && idx.search("isi baru").length === 0, "removeDoc membersihkan FTS");
}
// dokumen besar tanpa batas: 3000 halaman
{
  const pages = Array.from({ length: 3000 }, (_, i) => ({ page: i + 1, text: `Halaman ${i + 1}. ${i === 2345 ? "Ketentuan khusus kapal tongkang pasal 77." : "Teks pengisi biasa."} `.repeat(8) }));
  const t0 = Date.now();
  const res = idx.upsertDoc({ id: "big", title: "Dokumen raksasa", pages });
  const r = idx.search("kapal tongkang");
  check(res.pages === 3000 && r[0]?.page === 2346, `3000 halaman terindeks & ketemu di hlm 2346 (${Date.now() - t0} ms)`);
  idx.removeDoc("big");
}

// ---------- Supabase palsu ----------
function makeSupabase(tables, storage) {
  const from = (name) => {
    const st = { filters: [], order: null, limit: null, op: "select", payload: null, wantSel: false, single: false };
    const rows = () => (tables[name] ??= []);
    const match = (r) => st.filters.every((f) => (f.k === "eq" ? r[f.c] === f.v : f.k === "notnull" ? r[f.c] != null : true));
    const pick = (r, cols) => (cols ? Object.fromEntries(cols.split(",").map((c) => c.trim()).map((c) => [c, r[c]])) : r);
    let cols = null;
    const run = () => {
      const t = rows();
      if (st.op === "select") {
        let out = t.filter(match);
        if (st.order) out = [...out].sort((a, b) => (a[st.order.c] > b[st.order.c] ? 1 : -1) * (st.order.asc ? 1 : -1));
        if (st.limit) out = out.slice(0, st.limit);
        out = out.map((r) => pick(r, cols));
        return { data: st.single ? out[0] ?? null : out, error: null };
      }
      if (st.op === "update") {
        const hit = t.filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return { data: st.wantSel ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
    };
    const b = {
      select(c) { if (st.op === "select") cols = c; else st.wantSel = true; return b; },
      eq(c, v) { st.filters.push({ k: "eq", c, v }); return b; },
      not(c, op, v) { if (op === "is" && v === null) st.filters.push({ k: "notnull", c }); return b; },
      order(c, o) { st.order = { c, asc: o?.ascending !== false }; return b; },
      limit(n) { st.limit = n; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      maybeSingle() { st.single = true; return b; },
      then(res, rej) { try { return Promise.resolve(run()).then(res, rej); } catch (e) { return Promise.reject(e).catch(rej); } }
    };
    return b;
  };
  return {
    from,
    storage: {
      from: () => ({
        download: async (p) => (storage.has(p) ? { data: new Blob([storage.get(p)]), error: null } : { data: null, error: { message: "Object not found" } }),
        remove: async (ps) => { ps.forEach((p) => storage.delete(p)); return { data: [], error: null }; }
      })
    }
  };
}

const realTools = await detectTools();
console.log("tools:", JSON.stringify(realTools));
check(realTools.pdftotext, "pdftotext tersedia di mesin tes");

function setup(files, over = {}, run) {
  const storage = new Map();
  const tables = { knowledge_documents: [] };
  let n = 0;
  for (const [name, buf, extra] of files) {
    const id = `doc-${++n}`;
    const sp = `${id}/source.${name.split(".").pop()}`;
    storage.set(sp, buf);
    tables.knowledge_documents.push({ id, title: name, content: "", char_count: 0, original_filename: name, status: "queued", storage_path: sp, uploaded_at: `2026-01-01T00:00:0${n}Z`, on_laptop: false, ...(extra || {}) });
  }
  const index = over.index;
  const pushes = [];
  const w = createKbIngestWorker(
    { supabase: makeSupabase(tables, storage), index, log: silent, notify: async (p) => { pushes.push(p); }, run },
    { reconcileMs: 1e12, ...(over.cfg || {}) }
  );
  return { tables, storage, w, pushes, index };
}

// ---------- ingest PDF teks ----------
{
  const index = await openKbIndex({ file: ":memory:", log: silent });
  const { tables, storage, w, pushes } = setup([["tarif.pdf", fx("text.pdf")]], { index });
  await w.tick();
  const row = tables.knowledge_documents[0];
  check(row.status === "ready" && row.on_laptop && row.page_count === 3 && row.char_count > 100, "PDF teks: status ready, 3 halaman");
  check(row.content.includes("[Halaman 3]") && row.content.includes("Pasal 9"), "PDF teks: salinan teks untuk Gemini berpenanda halaman");
  check(storage.size === 0 && row.storage_path === null, "inbox dibersihkan setelah selesai");
  const r = index.search("pasal 9 setor pajak tanggal berapa");
  check(r[0]?.page === 3, "PDF teks: pencarian menemukan halaman 3");
  check(pushes.length === 1 && /siap/i.test(pushes[0].title), "push 'dokumen siap' terkirim");
  await w.tick();
  check(w.status().docs === 1, "tick kedua tanpa antrean tidak melakukan apa-apa");
}

// ---------- ingest: batas salinan Gemini, indeks tetap utuh ----------
{
  const index = await openKbIndex({ file: ":memory:", log: silent });
  const bigTxt = Buffer.from(Array.from({ length: 4000 }, (_, i) => `Baris ${i} berisi data penting nomor ${i}.`).join("\n"));
  const { tables, w } = setup([["besar.txt", bigTxt]], { index, cfg: { syncMaxChars: 20000 } });
  await w.tick();
  const row = tables.knowledge_documents[0];
  check(row.status === "ready" && row.truncated === true && row.content.length < 21000, "salinan Supabase dipotong & ditandai truncated");
  check(row.char_count > 100000 && index.search("nomor 3999")[0]?.text.includes("3999"), "indeks laptop memuat SELURUH dokumen (baris 3999 ketemu)");
}

// ---------- OCR ----------
{
  const index = await openKbIndex({ file: ":memory:", log: silent });
  const { tables, w } = setup([["campur.pdf", fx("mixed.pdf")], ["scan.pdf", fx("scanonly.pdf")]], { index });
  await w.tick(); await w.tick();
  const [mixed, scan] = tables.knowledge_documents;
  if (realTools.tesseract && realTools.pdftoppm) {
    check(mixed.status === "ready" && mixed.ocr_pages === 1, "PDF campuran: 1 halaman di-OCR");
    check(index.search("Bandung hotel")[0]?.page === 2 && index.search("Surabaya")[0]?.page === 1, "PDF campuran: teks asli + hasil OCR sama-sama ketemu");
    check(scan.status === "ready" && scan.ocr_pages === 1, "PDF scan murni: berhasil lewat OCR");
  } else {
    check(mixed.status === "ready" && mixed.ocr_pages === 0 && /dilewati/.test(mixed.status_detail || ""), "tanpa tesseract: halaman scan dilewati dengan keterangan");
    check(scan.status === "error" && /tesseract/i.test(scan.error), "tanpa tesseract: PDF scan murni gagal dengan petunjuk pemasangan");
  }
}

// ---------- error: alat tidak ada, lalu coba lagi ----------
{
  const index = await openKbIndex({ file: ":memory:", log: silent });
  const noTools = async (cmd) => { const e = new Error("spawn"); e.code = "ENOENT"; throw e; };
  const { tables, storage, w, pushes } = setup([["x.pdf", fx("text.pdf")]], { index }, noTools);
  await w.tick();
  const row = tables.knowledge_documents[0];
  check(row.status === "error" && /poppler-utils/.test(row.error), "pdftotext tidak ada -> error dengan perintah pemasangan");
  check(storage.size === 1 && row.storage_path, "file mentah TETAP di inbox saat error (bisa dicoba ulang)");
  check(pushes.length === 1 && /gagal/i.test(pushes[0].title), "push gagal terkirim");
}
{
  const index = await openKbIndex({ file: ":memory:", log: silent });
  const { tables, w } = setup([["rusak.pdf", Buffer.from("bukan pdf sama sekali")]], { index });
  await w.tick();
  check(tables.knowledge_documents[0].status === "error" && !!tables.knowledge_documents[0].error, "PDF rusak -> error, bukan crash");
}

// ---------- rekonsiliasi ----------
{
  const index = await openKbIndex({ file: ":memory:", log: silent });
  index.upsertDoc({ id: "hantu", title: "Sudah dihapus di app", pages: [{ page: 1, text: "teks hantu" }] });
  const storage = new Map();
  const tables = {
    knowledge_documents: [
      { id: "lama", title: "Dok lama", content: "[Halaman 1]\nTarif lama golongan IV.", original_filename: "lama.pdf", status: "ready", on_laptop: false },
      { id: "baru", title: "Antre", content: "", status: "queued", storage_path: null }
    ]
  };
  const w = createKbIngestWorker({ supabase: makeSupabase(tables, storage), index, log: silent }, { reconcileMs: 0 });
  const r = await w.reconcile();
  check(r.removed === 1 && r.added === 1, "rekonsiliasi: hapus yang sudah tak ada, tambah dokumen lama");
  check(index.search("tarif golongan")[0]?.title === "Dok lama" && tables.knowledge_documents[0].on_laptop === true, "dokumen lama hasil upload browser kini bisa dicari");
  check(index.listDocs().every((d) => d.id !== "hantu"), "dokumen hantu terbuang dari indeks");
}

// ---------- config ----------
{
  const c = readKbConfig({ KB_SYNC_MAX_CHARS: "1000", KB_OCR: "off" }, "/x");
  check(c.syncMaxChars === 1000 && c.ocr === false && c.indexFile === "/x/kb/kb.sqlite", "readKbConfig");
}

console.log(fails ? `\n${fails} GAGAL` : "\nsemua OK");
process.exit(fails ? 1 : 0);
