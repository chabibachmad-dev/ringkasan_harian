// Tes folder dokumen lokal (doc-folder.js): PDF -> .md -> indeks khusus Ollama. node test-doc-folder.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openKbIndex } from "./kb-index.js";
import { createDocFolderWorker, readDocFolderConfig, listFiles } from "./doc-folder.js";
import { createKbIngestWorker } from "./kb-ingest.js";
import { detectTools } from "./kb-ingest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (c, m) => {
  if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m);
};
const silent = { log() {}, error() {} };
const keep = setInterval(() => {}, 1000); // AbortSignal.timeout tidak menahan proses

// ---- konfigurasi
{
  const c = readDocFolderConfig({}, "/home/u/ringkasan_harian/wa-bot");
  check(c.root === "/home/u/ringkasan_harian/dokumen" && c.pdfDir.endsWith("/dokumen/peraturan-pdf") && c.mdDir.endsWith("/dokumen/peraturan-md"), "config: bawaan = ../dokumen dari folder bot");
  const d = readDocFolderConfig({ DOC_DIR: "/data/dok", DOC_FOLDER_ENABLED: "false" }, "/x");
  check(d.root === "/data/dok" && d.enabled === false, "config: DOC_DIR & DOC_FOLDER_ENABLED");
}

// ---- helper
const fakePages = (extra = "") => [
  { page: 1, text: "PERATURAN MENTERI KEUANGAN\nREPUBLIK INDONESIA\nNOMOR 12 TAHUN 2020\nTENTANG\nPERJALANAN DINAS\n\nMenimbang : a. bahwa perlu diatur;\n" },
  { page: 2, text: `BAB I\nKETENTUAN UMUM\n\nPasal 1\n(1) Uang harian dibayarkan per hari kerja.${extra}\n(2) Besarannya ditetapkan Menteri.` }
];
function setup(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docf-"));
  const calls = { n: 0 };
  let clock = 1_000_000;
  const advance = (ms) => (clock += ms);
  return (async () => {
    const index = await openKbIndex({ file: ":memory:", log: silent });
    const w = createDocFolderWorker(
      { index, log: silent, now: () => clock, env: { DOC_DIR: root }, convert: async () => { calls.n++; return { pages: fakePages(calls.extra || ""), ocrPages: 0, badPages: [] }; }, ...over.deps },
      { settleMs: 1000, ...over.cfg }
    );
    fs.mkdirSync(w.config.pdfDir, { recursive: true });
    fs.mkdirSync(w.config.mdDir, { recursive: true });
    return { root, w, index, calls, advance, pdf: (n, body = "%PDF-1.4 isi") => fs.writeFileSync(path.join(w.config.pdfDir, n), body) };
  })();
}

// ---- alur utama: PDF baru -> .md -> indeks
{
  const s = await setup();
  s.pdf("PMK 12 Tahun 2020.pdf");
  check((await s.w.scanFolder()) === false && s.calls.n === 0, "folder: penampakan pertama hanya dicatat (tunggu ukuran stabil)");
  s.advance(1500);
  check((await s.w.scanFolder()) === true && s.calls.n === 1, "folder: setelah stabil, PDF dikonversi");
  const md = path.join(s.w.config.mdDir, "PMK-12-Tahun-2020.md");
  check(fs.existsSync(md) && fs.readFileSync(md, "utf8").includes("### Pasal 1"), "folder: .md tertulis di peraturan-md/");
  check(s.index.listDocs().some((d) => d.id === "local:PMK-12-Tahun-2020.md" && d.title.includes("Nomor 12 Tahun 2020")), "indeks: dokumen 'local:' dengan judul dari kepala");
  const hit = s.index.search("uang harian per hari kerja", { budgetChars: 3000 });
  check(hit.length > 0 && hit[0].text.includes("Pasal 1"), "indeks: pertanyaan Ollama menemukan Pasal");
  check(hit[0].page === 2 || hit.some((h) => h.page === 2), "indeks: halaman PDF asli tercatat");
  check(s.index.search("uang harian per hari kerja", { budgetChars: 3000, excludeLocal: true }).length === 0, "PRIVASI: pencarian cloud (excludeLocal) tidak melihat dokumen lokal");
  check(s.index.search("uang harian", { excludeLocal: true, titles: ["pmk"] }).length === 0, "PRIVASI: excludeLocal juga berlaku bersama filter judul");

  s.advance(5000);
  await s.w.scanFolder();
  check(s.calls.n === 1, "folder: tidak dikonversi ulang bila tidak berubah");

  // disentuh saja (isi sama) -> tidak konversi ulang
  const f = path.join(s.w.config.pdfDir, "PMK 12 Tahun 2020.pdf");
  const t = new Date(Date.now() + 60000);
  fs.utimesSync(f, t, t);
  await s.w.scanFolder(); s.advance(1500); await s.w.scanFolder();
  check(s.calls.n === 1, "folder: disalin ulang dengan isi sama tidak memicu konversi");

  // disunting tangan -> diindeks ulang, tidak ditimpa
  fs.appendFileSync(md, "\nCatatan tambahanku: tarif khusus Yogyakarta.\n");
  const r = s.w.syncIndex();
  check(r.added === 1 && s.index.search("tarif khusus Yogyakarta").length > 0, "sunting: perubahan .md langsung diindeks ulang");
  s.calls.extra = " Ditambah teks versi baru.";
  fs.writeFileSync(f, "%PDF-1.4 isi berubah");
  await s.w.scanFolder(); s.advance(1500); await s.w.scanFolder();
  check(s.calls.n === 2, "ganti PDF: dikonversi ulang");
  check(fs.readFileSync(md, "utf8").includes("Catatan tambahanku"), "ganti PDF: suntinganmu TIDAK ditimpa");
  const baru = path.join(s.w.config.mdDir, "PMK-12-Tahun-2020.baru.md");
  check(fs.existsSync(baru) && fs.readFileSync(baru, "utf8").includes("Ditambah teks versi baru"), "ganti PDF: hasil baru disimpan sebagai .baru.md");
  check(!s.index.listDocs().some((d) => d.id.includes(".baru")), ".baru.md tidak ikut diindeks");
  // PDF tanpa suntingan -> ditimpa
  fs.writeFileSync(md, fs.readFileSync(baru, "utf8")); fs.rmSync(baru);
  s.w.syncIndex();

  // .md dihapus -> keluar dari indeks; PDF tetap aman
  fs.rmSync(md);
  const rm = s.w.syncIndex();
  check(rm.removed === 1 && s.index.search("uang harian").length === 0 && fs.existsSync(f), "hapus .md: keluar dari indeks, PDF sumber tidak disentuh");
}

// ---- .md tulisan tangan yang ditaruh langsung di peraturan-md/
{
  const s = await setup();
  fs.writeFileSync(path.join(s.w.config.mdDir, "catatan.md"), "# Catatan Halal\n\nSertifikat halal berlaku empat tahun.\n");
  s.w.syncIndex();
  check(s.index.search("sertifikat halal berlaku")[0]?.title === "Catatan Halal", ".md buatan sendiri ikut terindeks");
}

// ---- PDF gagal / scan tanpa teks
{
  const s = await setup({ deps: { convert: async () => ({ pages: [{ page: 1, text: "  " }], ocrMissing: true }) } });
  s.pdf("scan.pdf");
  await s.w.scanFolder(); s.advance(1500);
  await s.w.scanFolder();
  check(s.w.status().lastError?.includes("hasil scan"), "scan tanpa OCR: pesan jelas");
  check(!fs.existsSync(path.join(s.w.config.mdDir, "scan.md")), "scan tanpa OCR: tidak menulis .md kosong");
  await s.w.scanFolder(); s.advance(5000); await s.w.scanFolder();
  check(s.w.status().docs === 0, "scan tanpa OCR: tidak diulang tiap putaran");
}

// ---- Ollama sibuk -> ditunda
{
  let busy = true;
  const s = await setup({ deps: { isBusy: () => busy } });
  s.pdf("a.pdf");
  await s.w.scanFolder(); s.advance(1500);
  check((await s.w.scanFolder()) === false && s.calls.n === 0, "sibuk: konversi ditunda saat Ollama bekerja");
  busy = false;
  await s.w.scanFolder();
  check(s.calls.n === 1, "sibuk: lanjut setelah Ollama bebas");
}

// ---- subfolder & berkas tersembunyi
{
  const s = await setup();
  fs.mkdirSync(path.join(s.w.config.pdfDir, "keuangan"), { recursive: true });
  fs.writeFileSync(path.join(s.w.config.pdfDir, "keuangan", "x.pdf"), "a");
  fs.writeFileSync(path.join(s.w.config.pdfDir, ".tersembunyi.pdf"), "a");
  fs.writeFileSync(path.join(s.w.config.pdfDir, "~$sementara.pdf"), "a");
  check(JSON.stringify(listFiles(s.w.config.pdfDir, ".pdf")) === '["keuangan/x.pdf"]', "listFiles: subfolder ya; tersembunyi/sementara tidak");
  await s.w.scanFolder(); s.advance(1500); await s.w.scanFolder();
  check(fs.existsSync(path.join(s.w.config.mdDir, "keuangan", "x.md")), "subfolder dicerminkan ke peraturan-md/");
}

// ---- rekonsiliasi Dokumen Pengetahuan TIDAK menghapus dokumen lokal
{
  const s = await setup();
  s.index.upsertDoc({ id: "local:a.md", title: "Lokal", pages: [{ page: 1, text: "isi lokal rahasia" }] });
  s.index.upsertDoc({ id: "uuid-x", title: "Yang dihapus di aplikasi", pages: [{ page: 1, text: "isi awan" }] });
  const sb = { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) };
  const kb = createKbIngestWorker({ supabase: sb, index: s.index, log: silent, env: {}, baseDir: os.tmpdir() });
  const r = await kb.reconcile();
  check(r.removed === 1 && s.index.listDocs().map((d) => d.id).join() === "local:a.md", "rekonsiliasi: dokumen aplikasi yang hilang dibuang, dokumen 'local:' aman");
}

// ---- antrean dari aplikasi (Supabase palsu)
function makeSb(tables, storage) {
  const from = (name) => {
    const st = { filters: [], op: "select", payload: null, wantSel: false, limit: null };
    const rows = () => (tables[name] ??= []);
    const match = (r) => st.filters.every((f) => (f.k === "eq" ? r[f.c] === f.v : f.k === "notnull" ? r[f.c] != null : true));
    const run = () => {
      const t = rows();
      if (st.op === "insert") { const row = { id: `r${t.length + 1}`, ...st.payload }; t.push(row); return { data: [row], error: null }; }
      if (st.op === "update") { const hit = t.filter(match); hit.forEach((r) => Object.assign(r, st.payload)); return { data: st.wantSel ? hit.map((r) => ({ id: r.id })) : null, error: null }; }
      let out = t.filter(match); if (st.limit) out = out.slice(0, st.limit);
      return { data: out.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() { if (st.op !== "select") st.wantSel = true; return b; },
      eq(c, v) { st.filters.push({ k: "eq", c, v }); return b; },
      not(c, op, v) { if (op === "is" && v === null) st.filters.push({ k: "notnull", c }); return b; },
      order() { return b; }, limit(n) { st.limit = n; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    return b;
  };
  return { from, storage: { from: () => ({ download: async (p) => (storage.has(p) ? { data: new Blob([storage.get(p)]), error: null } : { data: null, error: { message: "Object not found" } }), remove: async (ps) => { ps.forEach((p) => storage.delete(p)); return { data: [], error: null }; } }) } };
}
{
  const tables = { pdf_md_jobs: [{ id: "j1", source: "app", filename: "Permen Baru.pdf", status: "queued", storage_path: "md/j1/source.pdf", created_at: "2026-10-14T00:00:00Z" }] };
  const storage = new Map([["md/j1/source.pdf", Buffer.from("%PDF isi unggahan")]]);
  const pushes = [];
  const s = await setup({ deps: { supabase: makeSb(tables, storage), notify: async (p) => { pushes.push(p); } } });
  await s.w.tick();
  const j = tables.pdf_md_jobs[0];
  check(j.status === "done" && j.pasal_count === 1 && j.bab_count === 1 && j.md_name === "Permen-Baru.md", "aplikasi: tugas selesai + statistik");
  check(fs.existsSync(path.join(s.w.config.pdfDir, "Permen-Baru.pdf")) && fs.existsSync(path.join(s.w.config.mdDir, "Permen-Baru.md")), "aplikasi: PDF disalin ke peraturan-pdf/ dan .md ditulis");
  check(storage.size === 0 && j.storage_path === null, "aplikasi: file mentah di inbox dibersihkan");
  check(pushes.length === 1 && pushes[0].title.includes("sudah jadi"), "aplikasi: notifikasi dikirim");
  check(s.index.search("uang harian").length > 0 && s.index.search("uang harian", { excludeLocal: true }).length === 0, "aplikasi: terindeks, hanya untuk Ollama");
  s.advance(5000); await s.w.scanFolder(); s.advance(5000); await s.w.scanFolder();
  check(s.calls.n === 1, "aplikasi: pemantau folder tidak mengonversi ulang berkas yang baru diproses");

  // nama sama isi berbeda -> -2
  tables.pdf_md_jobs.push({ id: "j2", source: "app", filename: "Permen Baru.pdf", status: "queued", storage_path: "md/j2/source.pdf", created_at: "2026-10-14T01:00:00Z" });
  storage.set("md/j2/source.pdf", Buffer.from("%PDF isi lain"));
  await s.w.tick();
  check(fs.existsSync(path.join(s.w.config.pdfDir, "Permen-Baru-2.pdf")) && tables.pdf_md_jobs[1].status === "done", "aplikasi: nama sama isi beda -> Permen-Baru-2.pdf");

  // gagal -> status error + pesan
  tables.pdf_md_jobs.push({ id: "j3", source: "app", filename: "hilang.pdf", status: "queued", storage_path: "md/j3/source.pdf", created_at: "2026-10-14T02:00:00Z" });
  await s.w.tick();
  check(tables.pdf_md_jobs[2].status === "error" && /mengunduh/i.test(tables.pdf_md_jobs[2].error), "aplikasi: file tak ada di inbox -> error jelas");
}

// ---- hasil folder dilaporkan sebagai baris 'folder'
{
  const tables = { pdf_md_jobs: [] };
  const s = await setup({ deps: { supabase: makeSb(tables, new Map()) } });
  s.pdf("peraturan-x.pdf");
  await s.w.scanFolder(); s.advance(1500); await s.w.scanFolder();
  const row = tables.pdf_md_jobs.find((r) => r.source === "folder");
  check(row && row.filename === "peraturan-x.pdf" && row.status === "done" && row.md_name === "peraturan-x.md", "laporan: hasil folder tampil di daftar aplikasi");
  s.calls.extra = " lagi";
  s.pdf("peraturan-x.pdf", "%PDF isi lain lagi");
  await s.w.scanFolder(); s.advance(1500); await s.w.scanFolder();
  check(tables.pdf_md_jobs.filter((r) => r.source === "folder").length === 1, "laporan: satu baris per file (diperbarui, tidak digandakan)");
}

// ---- PDF nyata end-to-end (pdftotext sungguhan)
{
  const tools = await detectTools();
  if (!tools.pdftotext) console.log("lewati: pdftotext tidak ada");
  else {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docf-real-"));
    const index = await openKbIndex({ file: ":memory:", log: silent });
    const w = createDocFolderWorker({ index, log: silent, env: { DOC_DIR: root }, baseDir: here }, { settleMs: 0 });
    fs.mkdirSync(w.config.pdfDir, { recursive: true });
    fs.copyFileSync(path.join(here, "test-fixtures", "peraturan.pdf"), path.join(w.config.pdfDir, "PMK-12-2020.pdf"));
    await w.scanFolder();
    await w.scanFolder();
    const md = fs.readFileSync(path.join(w.config.mdDir, "PMK-12-2020.md"), "utf8");
    check(md.includes("jumlah_pasal: 4") && md.includes("#### Pasal 3") && md.includes("| 2 | Sumatera Utara | 370.000 | 150.000 |"), "PDF nyata: .md terstruktur");
    const r = index.search("berapa uang harian untuk DI Yogyakarta", { budgetChars: 4000 });
    check(r.length > 0 && /420\.000/.test(r.map((x) => x.text).join("\n")), "PDF nyata: pertanyaan menemukan baris tabel Yogyakarta");
  }
}

clearInterval(keep);
if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
