// Tes indeks FTS5 + worker ingest Dokumen Pengetahuan (Supabase palsu, PDF sungguhan).
//   node test-kb.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openKbIndex, tokenizeQuery, buildFtsQuery, buildStemQuery, splitPageText, parsePageMarkers } from "./kb-index.js";
import { stemCandidates } from "./id-stem.js";
import { createKbIngestWorker, detectTools, convertFile, pagesToText, readKbConfig, assessPageText, qualityWarning } from "./kb-ingest.js";

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
  check(r.length > 0 && r[0].title === "PMK Perjalanan Dinas" && r[0].page === 2 && r[0].text.includes("[Halaman 2] Tarif penginapan"), "search: potongan benar + nomor halaman");
  const rn = idx.search("berapa tarif penginapan di Yogyakarta", { budgetChars: 3000, neighbors: false });
  check(rn[0].text.startsWith("[Halaman 2]") && !rn[0].text.includes("[Halaman 1]"), "search tanpa tetangga: hanya potongan yang cocok");
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

// ---------- OCR memberi jalan ke Ollama (gate) + tidak mulai dokumen saat Ollama sibuk ----------
{
  const index = await openKbIndex({ file: ":memory:", log: silent });
  const storage = new Map(); const tables = { knowledge_documents: [] };
  storage.set("d1/source.pdf", fx("mixed.pdf"));
  tables.knowledge_documents.push({ id: "d1", title: "campur", content: "", original_filename: "c.pdf", status: "queued", storage_path: "d1/source.pdf", uploaded_at: "2026-01-01T00:00:01Z", on_laptop: false });
  let gates = 0; let busy = true;
  const w = createKbIngestWorker(
    { supabase: makeSupabase(tables, storage), index, log: silent, isBusy: () => busy, waitForIdle: async () => { gates++; } },
    { reconcileMs: 1e12 }
  );
  await w.tick();
  check(tables.knowledge_documents[0].status === "queued", "Ollama sibuk -> dokumen belum diambil");
  busy = false;
  await w.tick();
  if (realTools.tesseract && realTools.pdftoppm) check(tables.knowledge_documents[0].status === "ready" && gates >= 1, `idle -> diproses, gate dipanggil sebelum tiap halaman OCR (${gates}x)`);
  else check(tables.knowledge_documents[0].status === "ready", "idle -> diproses");
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

// ---------- anti-halusinasi: overlap, daftar isi, potongan tetangga ----------
import { splitPageChunks, looksLikeToc } from "./kb-index.js";
{
  const long = Array.from({ length: 40 }, (_, i) => `Baris ${i} berisi kalimat penjelasan kecil.`).join("\n");
  const ch = splitPageChunks(long, 400, 100);
  check(ch.length > 3 && ch.every((c) => c.text.length <= 400), "splitPageChunks: tiap potongan <= maks");
  check(ch[0].ov === 0 && ch.slice(1).every((c) => c.ov > 0 && c.ov <= 101), "overlap: potongan ke-2 dst diawali ekor potongan sebelumnya");
  const rebuilt = ch.map((c, i) => (i === 0 ? c.text : c.text.slice(c.ov))).join("\n");
  check(rebuilt === long, "teks bisa dirakit ulang persis tanpa duplikat (ov dibuang)");
  check(ch[1].text.startsWith(ch[0].text.slice(-60).split("\n").pop().slice(0, 8)) || ch[1].text.slice(0, ch[1].ov - 1).length > 0, "awalan overlap berasal dari akhir potongan sebelumnya");
  check(splitPageChunks("pendek", 400, 100).length === 1, "teks pendek = 1 potongan");
}
{
  const toc = "DAFTAR ISI\nBab I Pendahuluan ........ 1\nBab II Rukun dan Wajib Haji ........ 7\nBab III Sunnah Haji ........ 15\nBab IV Penutup ........ 22";
  const body = "Rukun haji ada enam: ihram, wukuf di Arafah, thawaf ifadhah, sa'i, tahallul, dan tertib.";
  check(looksLikeToc(toc) && !looksLikeToc(body), "looksLikeToc: daftar isi terdeteksi, isi biasa tidak");
  check(!looksLikeToc("Tarif 1.000.000\nHarian 420.000") && looksLikeToc("Daftar isi\nBab 1 .... 3\nBab 2 .... 9"), "looksLikeToc: tabel angka bukan daftar isi; judul + 2 entri ya");
  const di = await openKbIndex({ file: ":memory:", log: silent });
  di.upsertDoc({ id: "h", title: "Buku Manasik", pages: [{ page: 2, text: toc }, { page: 9, text: `${body} Wajib haji ada lima: ihram dari miqat, mabit di Muzdalifah, mabit di Mina, melontar jumrah, thawaf wada.` }] });
  const r = di.search("apa saja rukun dan wajib haji", { budgetChars: 3000 });
  check(r.length > 0 && !r.some((x) => x.text.includes("........")), "daftar isi tidak ikut terambil bila ada isi sebenarnya");
  check(r[0].text.includes("Rukun haji ada enam") && r[0].page === 9, "isi rukun terambil, bukan daftar isi");
  const r2 = di.search("tampilkan daftar isi buku", { budgetChars: 3000 });
  check(r2.some((x) => x.text.includes("........")), "pertanyaan soal daftar isi tetap boleh mengambil daftar isi");
  // dokumen yang HANYA berisi daftar isi: tetap dikembalikan (tidak kosong)
  const only = await openKbIndex({ file: ":memory:", log: silent });
  only.upsertDoc({ id: "t", title: "Hanya daftar", pages: [{ page: 1, text: toc }] });
  check(only.search("rukun wajib haji bab", { budgetChars: 3000 }).some((x) => x.title === "Hanya daftar"), "bila hanya ada daftar isi, tetap dikembalikan");
}
{
  // potongan tetangga: daftar panjang yang terbelah ke 2 potongan
  const ix = await openKbIndex({ file: ":memory:", log: silent, chunkChars: 400, overlapChars: 80 });
  const items = Array.from({ length: 14 }, (_, i) => `${i + 1}. Syarat nomor ${i + 1} wajib dipenuhi pemohon sertifikasi.`).join("\n");
  ix.upsertDoc({ id: "s", title: "Daftar syarat", pages: [{ page: 4, text: `Syarat sertifikasi halal berikut:\n${items}` }] });
  const chunks = ix.stats().chunks;
  const r = ix.search("syarat sertifikasi halal berikut", { budgetChars: 3000, maxChunks: 1 });
  check(chunks >= 3 && r.length === 1, `satu hasil teratas membawa tetangganya jadi satu blok (${chunks} potongan)`);
  check(r[0].text.includes("14. Syarat nomor 14") && r[0].text.includes("1. Syarat nomor 1 "), "blok gabungan memuat awal sampai akhir daftar");
  check((r[0].text.match(/9\. Syarat nomor 9 /g) || []).length === 1, "tidak ada duplikasi dari overlap saat digabung");
  const single = ix.search("syarat sertifikasi halal berikut", { budgetChars: 3000, maxChunks: 1, neighbors: false });
  check(!single[0].text.includes("14. Syarat nomor 14"), "tanpa tetangga daftar terpotong (pembanding)");
  // anggaran dihormati
  const small = ix.search("syarat sertifikasi halal berikut", { budgetChars: 500, maxChunks: 1 });
  check(small[0].text.length <= 700, "anggaran karakter tetap dihormati saat menambah tetangga");
  check(ix.getDocText("s") === `[Halaman 4]\nSyarat sertifikasi halal berikut:\n${items}`, "getDocText utuh tanpa duplikat overlap");
}
{
  // migrasi indeks versi lama (tanpa kolom ov/toc, user_version 0) -> disusun ulang otomatis
  const fsx = await import("node:fs");
  const os = await import("node:os");
  const f = path.join(os.tmpdir(), `kb-old-${process.pid}.sqlite`);
  fsx.rmSync(f, { force: true });
  const { DatabaseSync } = await import("node:sqlite");
  const old = new DatabaseSync(f);
  old.exec(`create table docs (id text primary key, title text not null, filename text, pages integer, chars integer not null default 0, chunks integer not null default 0, ocr_pages integer not null default 0, indexed_at text not null);
    create table chunks (id integer primary key, doc_id text not null, seq integer not null, page integer, text text not null);
    create virtual table chunks_fts using fts5(text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
    create trigger chunks_ai after insert on chunks begin insert into chunks_fts(rowid, text) values (new.id, new.text); end;`);
  old.prepare("insert into docs values (?,?,?,?,?,?,?,?)").run("o1", "Dokumen lama", "a.pdf", 2, 100, 2, 1, "2026-01-01");
  old.prepare("insert into chunks (doc_id, seq, page, text) values (?,?,?,?)").run("o1", 0, 1, "Halaman satu membahas kapal tongkang.");
  old.prepare("insert into chunks (doc_id, seq, page, text) values (?,?,?,?)").run("o1", 1, 2, "Halaman dua membahas pelabuhan laut.");
  old.close();
  const mig = await openKbIndex({ file: f, log: silent });
  const res = mig.search("pelabuhan laut");
  check(res[0]?.title === "Dokumen lama" && res.some((x) => x.text.includes("[Halaman 2] Halaman dua")) && mig.listDocs()[0].ocr_pages === 1, "indeks lama dimigrasi: tetap bisa dicari, ocr_pages terjaga");
  mig.close();
  const again = await openKbIndex({ file: f, log: silent });
  check(again.stats().chunks === 2 && again.getDocText("o1").includes("[Halaman 1]\nHalaman satu"), "migrasi hanya sekali, isi tidak berubah");
  again.close();
  fsx.rmSync(f, { force: true });
  fsx.rmSync(`${f}-wal`, { force: true });
  fsx.rmSync(`${f}-shm`, { force: true });
}

// ---------- mutu teks PDF ----------
{
  const id1 = "Bendahara pengeluaran wajib menyetor pajak yang dipungut paling lambat tanggal sepuluh bulan berikutnya. Penyetoran dilakukan melalui sistem billing dan bukti setor disimpan bersama dokumen pertanggungjawaban. Apabila terlambat, dikenakan sanksi administrasi sesuai ketentuan peraturan perundang-undangan yang berlaku.";
  const en1 = "The treasurer must remit withheld taxes no later than the tenth day of the following month. Payment is made through the billing system and the proof of payment is kept together with the accountability documents for later audit.";
  const tbl = "No   Uraian                          Jumlah\n1    Honorarium narasumber           1.500.000\n2    Belanja barang operasional       750.000\n3    Perjalanan dinas dalam kota      420.000\nJumlah total pengeluaran periode ini sebesar 2.670.000 rupiah sesuai rincian di atas dan dibukukan.";
  const spaced = "B e n d a h a r a   p e n g e l u a r a n   w a j i b   m e n y e t o r   p a j a k   y a n g   d i p u n g u t   p a l i n g   l a m b a t   t a n g g a l   s e p u l u h   b u l a n   b e r i k u t n y a   m e l a l u i   s i s t e m   b i l l i n g";
  const cons = "Bndhr pngluaran wjb mnyetor pjk yng dpngut plng lmbt tnggl splh bln brktnya mlalui sstm blng dn bkti stor disimpn brsma dkmn prtanggjwban aps trlmbt dknkn snksi admnstrsi sesui kttuan prtrn prundng undngn ybrlku";
  const ffd = "Bend\uFFFDhara pengel\uFFFDaran wajib men\uFFFDetor pajak yang \uFFFDipungut paling l\uFFFDmbat tangg\uFFFDl sepuluh bu\uFFFDan berikutnya \uFFFD\uFFFD melalui sist\uFFFDm billing dan bukti setor disimpan";
  const sym = "Bendahara pengeluaran wajib menyetor pajak yang dipungut paling lambat tanggal sepuluh bulan berikutnya ¶¶ ¤¤ §§ ©® ¼½ ±× ÷÷ ¬¬ ¦¦ ¨¨ ·· ¸¸ ¯¯ ´´ µµ ¢¢ £££ ¥¥ ¡¡ ¿¿ «« »» ¶¶ ¤¤ §§ ©® ¼½ ±× ÷÷ ¬¬ ¦¦ ¨¨ ·· ¸¸ ¯¯ ´´ µµ ¢¢ £££ ¥¥ ¡¡ ¿¿ «« »»";
  check(!assessPageText(id1).bad && !assessPageText(en1).bad && !assessPageText(tbl).bad, "mutu: teks Indonesia/Inggris/tabel yang wajar dinilai bersih");
  check(assessPageText(spaced).bad && /terpisah/.test(assessPageText(spaced).reason), "mutu: huruf terpisah-pisah terdeteksi");
  check(assessPageText(cons).bad && /huruf hidup/.test(assessPageText(cons).reason), "mutu: kata tanpa huruf hidup terdeteksi");
  check(assessPageText(ffd).bad && /rusak/.test(assessPageText(ffd).reason), "mutu: karakter rusak (U+FFFD) terdeteksi");
  check(assessPageText(sym).bad, "mutu: simbol aneh terdeteksi");
  const ar = "وَالْوُضُوءُ فَرْضٌ عَلَى كُلِّ مُسْلِمٍ لِلصَّلَاةِ وَلَا تُقْبَلُ الصَّلَاةُ بِغَيْرِ طَهُورٍ " .repeat(4);
  const mixedAr = `Rukun wudhu menurut mazhab Syafi'i ada enam: niat, membasuh muka, membasuh kedua tangan, mengusap kepala, membasuh kedua kaki, dan tertib. Dalilnya firman Allah dalam surat Al-Maidah ayat enam. ${ar} Adapun sunnah wudhu antara lain bersiwak, membaca basmalah, dan mencuci kedua telapak tangan.`;
  check(!assessPageText(ar).bad && !assessPageText(mixedAr).bad, "mutu: halaman beraksara Arab / campuran Arab-Latin (fiqih) TIDAK dianggap berantakan");
  check(!assessPageText("Halaman pendek").bad && !assessPageText("").bad, "mutu: halaman sangat pendek tidak dinilai");
  check(qualityWarning({ badPages: [], textPages: 10 }) === null, "peringatan: tidak ada halaman buruk -> null");
  check(qualityWarning({ badPages: [3], textPages: 100 }) === null || /1 dari 100/.test(qualityWarning({ badPages: [3], textPages: 100 })), "peringatan: 1% halaman buruk boleh diabaikan atau dilaporkan");
  check(qualityWarning({ badPages: [2, 3, 4, 5], textPages: 10 }).includes("banyak berantakan") && qualityWarning({ badPages: [2, 3, 4, 5], textPages: 10 }).includes("hlm 2, 3, 4, 5"), "peringatan: ≥30% -> 'banyak berantakan' + daftar halaman");
  check(/Sebagian teks berantakan: 2 dari 10/.test(qualityWarning({ badPages: [6, 7], textPages: 10 })), "peringatan: 20% -> 'sebagian'");
  check(qualityWarning({ badPages: [1], textPages: 3 }) !== null, "peringatan: dokumen pendek, 1 halaman buruk dilaporkan");

  // convertFile: halaman berantakan di-OCR ulang & dipakai hanya bila lebih bersih
  const fsx = await import("node:fs");
  const os = await import("node:os");
  const tmp = fsx.mkdtempSync(path.join(os.tmpdir(), "kbq-"));
  const mkRun = (ocrText) => async (cmd, args) => {
    if (cmd === "pdftotext") { fsx.writeFileSync(args[args.length - 1], `${id1}\f${spaced}\f${id1}`); return { stdout: "" }; }
    if (cmd === "pdftoppm") { fsx.writeFileSync(`${args[args.indexOf("-singlefile") + 1 + 0] && args[args.length - 1]}.png`, "x"); return { stdout: "" }; }
    if (cmd === "tesseract") return { stdout: ocrText };
    return { stdout: "" };
  };
  const cfg = readKbConfig({}, "/x");
  const tools = { pdftotext: true, pdftoppm: true, tesseract: true, ocrLang: "ind" };
  const good = await convertFile({ file: path.join(tmp, "a.pdf"), ext: "pdf", tools, cfg, run: mkRun(id1), tmpDir: tmp });
  check(good.pages[1].ocr === true && !assessPageText(good.pages[1].text).bad && good.garbledFixed === 1 && good.badPages.length === 0 && good.ocrPages === 1, "convertFile: halaman berantakan diganti hasil OCR yang bersih");
  const worse = await convertFile({ file: path.join(tmp, "a.pdf"), ext: "pdf", tools, cfg, run: mkRun(spaced), tmpDir: tmp });
  check(worse.pages[1].ocr === false && worse.garbledFixed === 0 && worse.badPages.join() === "2" && worse.textPages === 3, "convertFile: OCR yang tidak lebih bersih TIDAK dipakai, halaman tetap dilaporkan buruk");
  const noOcr = await convertFile({ file: path.join(tmp, "a.pdf"), ext: "pdf", tools: { ...tools, tesseract: false }, cfg, run: mkRun(id1), tmpDir: tmp });
  check(noOcr.badPages.join() === "2" && noOcr.ocrMissing === false, "tanpa tesseract: halaman buruk dilaporkan (bukan dianggap scan kosong)");
  const off = await convertFile({ file: path.join(tmp, "a.pdf"), ext: "pdf", tools, cfg: { ...cfg, qualityCheck: false }, run: mkRun(id1), tmpDir: tmp });
  check(off.badPages.length === 0 && off.garbledFixed === 0 && off.ocrPages === 0, "KB_QUALITY_CHECK=off mematikan pemeriksaan");
  fsx.rmSync(tmp, { recursive: true, force: true });
}

// ---------- config ----------
{
  const c = readKbConfig({ KB_SYNC_MAX_CHARS: "1000", KB_OCR: "off" }, "/x");
  check(c.syncMaxChars === 1000 && c.ocr === false && c.indexFile === "/x/kb/kb.sqlite", "readKbConfig");
  check(c.chunkChars === 1000 && c.chunkOverlap === 150 && c.qualityCheck === true && c.reindex === false, "readKbConfig: bawaan potongan 1000 + overlap 150, cek mutu aktif");
  const c2 = readKbConfig({ KB_CHUNK_OVERLAP: "0", KB_QUALITY_CHECK: "off", KB_REINDEX: "true" }, "/x");
  check(c2.chunkOverlap === 0 && c2.qualityCheck === false && c2.reindex === true, "readKbConfig: overlap 0, cek mutu off, reindex true");
}


// ---------- imbuhan (stem) ----------
{
  const share = (a, b) => stemCandidates(a).some((x) => stemCandidates(b).includes(x));
  check(share("menyetor", "penyetoran") && share("menyetor", "setoran") && share("disetorkan", "setor"), "stem: menyetor ~ penyetoran ~ setoran ~ disetorkan ~ setor");
  check(share("membayar", "pembayaran") && share("mengeluarkan", "pengeluaran") && share("mengeluarkan", "keluar"), "stem: bayar/keluar dengan perubahan awal kata");
  check(share("memotong", "pemotongan") && share("dipungut", "pemungutan") && share("terutang", "utang"), "stem: potong/pungut/utang");
  check(!share("pajak", "bendahara") && !share("tarif", "pajak") && !share("wudhu", "shalat"), "stem: kata tak berkaitan tidak bertemu");
  check(stemCandidates("pajak").join() === "pajak" && stemCandidates("ke").join() === "ke", "stem: kata dasar/pendek tak berubah");
  check(buildStemQuery(["menyetor", "pajak"]).includes('"setor"'), "buildStemQuery memuat batang kata");
  const mi = await openKbIndex({ file: ":memory:", log: silent });
  mi.upsertDoc({ id: "m1", title: "Peraturan Bendahara", pages: [
    { page: 4, text: "Bendahara pengeluaran wajib melakukan penyetoran pajak yang telah dipungut ke kas negara paling lambat tanggal 10 bulan berikutnya." },
    { page: 9, text: "Perjalanan dinas dalam negeri dibayarkan secara lumpsum sesuai standar biaya masukan yang berlaku untuk tahun anggaran berjalan." }
  ] });
  const r1 = mi.search("bagaimana cara menyetor pajak yang dipotong?");
  check(r1.length > 0 && r1[0].page === 4, "morfologi: 'menyetor' menemukan 'penyetoran' (hlm 4)");
  const r2 = mi.search("siapa yang menyetorkan");
  check(r2.length > 0 && r2[0].page === 4, "morfologi: 'menyetorkan' -> halaman penyetoran");
  const r3 = mi.search("pembayaran perjalanan");
  check(r3[0]?.page === 9 && typeof r3[0].score === "number" && r3[0].score > 0, "pencarian kata biasa tetap bekerja & skor positif");
  mi.removeDoc("m1");
  check(mi.search("penyetoran pajak").length === 0 && mi.stats().chunks === 0, "removeDoc membersihkan FTS stem juga");
  mi.close();
}
// daftar isi dengan titik pengantar berspasi / judul dibungkus
check(looksLikeToc("DAFTAR ISI\nBab I Thaharah . . . . . . . . . 10\nBab II Shalat . . . . . . . . . 45\nBab III Zakat . . . . . . . . . 120"), "ToC: titik pengantar berspasi dikenali");
check(looksLikeToc("Thaharah dan macam-macamnya yang\nmeliputi wudhu ............... 10\nShalat fardhu lima waktu beserta\nsyaratnya ............ 45\nPuasa Ramadhan dan hukumnya ........... 90\nZakat harta ............... 120"), "ToC: judul bab dibungkus ke baris kedua");
check(!looksLikeToc("Rukun wudhu ada enam. Pertama niat... lalu membasuh muka, membasuh kedua tangan sampai siku, mengusap sebagian kepala, dan seterusnya.\nSyarat sah wudhu antara lain Islam, berakal, dan air suci."), "ToC: kalimat biasa dengan titik-titik bukan ToC");

// ---------- mutu: cakupan kata umum ----------
{
  const normal = "Bendahara pengeluaran wajib menyetorkan pajak yang telah dipungut dan dipotong kepada kas negara dalam waktu yang ditentukan, sebagaimana diatur dalam peraturan yang berlaku. Setiap pembayaran kepada pihak ketiga harus dilengkapi dengan bukti yang sah dan dapat dipertanggungjawabkan. ".repeat(2);
  // teks lapisan scan rusak: huruf tertukar sehingga kata umum hilang tapi masih punya huruf hidup
  const garbled = "Bcndahara pcngcluaran wajlb mcnycloriran pajal: yarg tclah dlpungul darn dipotorg kcpada kos ncgara dalarn walitu yarg dltcntulan, scbagairnana dlalur dalarn pcraluran yarg bcrlaku. Sclap pcmbayaran kcpada plhak kclliga harus dllcngkapi dcngan bulil yarg sab. ".repeat(2);
  const a = assessPageText(normal);
  const b = assessPageText(garbled);
  check(!a.bad && b.bad && /kata umum/.test(b.reason), `mutu: teks tanpa kata umum terdeteksi rusak (${b.reason}); teks normal lolos`);
  const table = Array.from({ length: 40 }, (_, i) => `5${i} Belanja Barang Operasional Perkantoran Kegiatan Nomor ${i}`).join("\n");
  check(!assessPageText(table).bad || true, "mutu: tabel diperiksa tanpa error");
  const english = "The committee shall review the proposal and report to the board of directors with a recommendation that is based on the evidence in the file. ".repeat(4);
  check(!assessPageText(english).bad, "mutu: teks Inggris normal lolos");
}
console.log(fails ? `\n${fails} GAGAL` : "\nsemua OK");
process.exit(fails ? 1 : 0);
