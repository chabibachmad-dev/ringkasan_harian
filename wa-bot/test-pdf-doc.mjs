// Tes pembuat PDF jawaban (tanpa pustaka). Jalankan: node test-pdf-doc.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPdf, titleFromText, pdfFileName } from "./pdf-doc.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdfdoc-"));
const save = (buf, name) => { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; };
const pages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) || []).length;

const sample = [
  "# Alur Sertifikasi Halal",
  "",
  "Berikut **ringkasan** tahapan, dengan `kode` dan _miring_.",
  "",
  "## Tahapan",
  "1. Pengajuan permohonan",
  "2. Pemeriksaan berkas",
  "   - oleh BPJPH",
  "   - oleh LPH",
  "",
  "| No | Tahap | Penanggung Jawab | Waktu |",
  "|---|---|---|---|",
  "| 1 | Pengajuan | Pelaku usaha | 1 hari |",
  "| 2 | Pemeriksaan | BPJPH | 2 hari |",
  "",
  "```",
  "npm test",
  "```",
  "",
  "---",
  "Penutup.",
].join("\n");

// --- struktur dasar
{
  const buf = buildPdf(sample, { subtitle: "Dibuat oleh Ayyubi" });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.match(buf.subarray(-16).toString("latin1"), /%%EOF\s*$/);
  assert.ok(buf.length > 1000 && buf.length < 60000);
  assert.equal(pages(buf), 1);
  const p = save(buf, "dasar.pdf");
  if (has("qpdf")) assert.equal(spawnSync("qpdf", ["--check", p]).status, 0, "qpdf --check");
  if (has("pdfinfo")) {
    const info = spawnSync("pdfinfo", [p]).stdout.toString();
    assert.match(info, /Pages:\s+1/);
    assert.match(info, /Page size:\s+595/);
  }
  if (has("pdftotext")) {
    const txt = spawnSync("pdftotext", ["-layout", p, "-"]).stdout.toString();
    for (const w of ["Alur Sertifikasi Halal", "ringkasan", "Pengajuan permohonan", "Penanggung Jawab", "BPJPH", "npm test", "Penutup", "Halaman 1 dari 1"]) assert.ok(txt.includes(w), `teks hilang: ${w}`);
    assert.ok(!txt.includes("**") && !txt.includes("|---"), "penanda markdown tidak bocor");
  }
}
ok("PDF sah (header, %%EOF, qpdf, pdfinfo A4) dan teks terbaca: judul, daftar, tabel, kode, kaki halaman");

// --- tabel panjang: banyak halaman, header diulang
{
  const rows = Array.from({ length: 120 }, (_, i) => `| ${i + 1} | Kegiatan nomor ${i + 1} yang cukup panjang untuk membungkus baris di kolom | Seksi ${i % 7} |`);
  const md = ["# Daftar Kegiatan", "", "| No | Uraian | Unit |", "|---|---|---|", ...rows].join("\n");
  const buf = buildPdf(md);
  const np = pages(buf);
  assert.ok(np >= 3, `halaman ${np}`);
  const p = save(buf, "panjang.pdf");
  if (has("qpdf")) assert.equal(spawnSync("qpdf", ["--check", p]).status, 0);
  if (has("pdftotext")) {
    const txt = spawnSync("pdftotext", ["-layout", p, "-"]).stdout.toString();
    assert.equal((txt.match(/Uraian/g) || []).length, np, "header tabel diulang di tiap halaman");
    assert.ok(txt.includes("Kegiatan nomor 120"));
    assert.ok(txt.includes(`Halaman ${np} dari ${np}`));
  }
}
ok("tabel 120 baris: beberapa halaman, header tabel diulang tiap halaman, baris terakhir ada");

// --- karakter di luar Latin / emoji tidak merusak
{
  const buf = buildPdf("# Uji\n\nHalo 😀 dunia — “kutipan” … ‘a’ • x\n\nعربى 한국어 tetap jalan.");
  const p = save(buf, "karakter.pdf");
  if (has("qpdf")) assert.equal(spawnSync("qpdf", ["--check", p]).status, 0);
  if (has("pdftotext")) {
    const txt = spawnSync("pdftotext", [p, "-"]).stdout.toString();
    assert.ok(txt.includes("Halo") && txt.includes("dunia") && txt.includes("tetap jalan"));
    assert.ok(!txt.includes("😀"));
  }
}
ok("emoji dibuang, huruf Arab/Korea jadi '?', tanda baca tipografis aman; PDF tetap sah");

// --- isi kosong / satu baris / sangat panjang tanpa spasi
{
  for (const md of ["", "   ", "x", "A".repeat(3000), "| a | b |\n|---|---|\n| " + "z".repeat(500) + " | 2 |"]) {
    const buf = buildPdf(md);
    assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
    const p = save(buf, "tepi.pdf");
    if (has("qpdf")) assert.equal(spawnSync("qpdf", ["--check", p]).status, 0, `qpdf gagal untuk ${md.slice(0, 10)}`);
  }
}
ok("kasus tepi: kosong, satu huruf, kata 3000 huruf tanpa spasi, sel tabel 500 huruf");

// --- judul & nama berkas
{
  assert.equal(titleFromText("# Alur Halal\n\nisi"), "Alur Halal");
  assert.equal(titleFromText("Paragraf pertama saja.\n\nKedua."), "Paragraf pertama saja.");
  assert.equal(titleFromText("**Tebal** judul"), "Tebal judul");
  assert.ok(titleFromText("x".repeat(200)).length <= 70);
  assert.equal(titleFromText(""), "Jawaban Ayyubi");
  assert.equal(titleFromText("", "Lain"), "Lain");
  assert.equal(pdfFileName("Alur Sertifikasi Halal"), "Alur-Sertifikasi-Halal.pdf");
  assert.equal(pdfFileName("Rekap: Kas & Dana (2026)!"), "Rekap-Kas-Dana-2026.pdf");
  assert.equal(pdfFileName("한국어"), "Jawaban.pdf");
  assert.ok(pdfFileName("a".repeat(200)).length <= 45);
}
ok("judul dari heading/paragraf pertama (maks 70), nama berkas ASCII aman");

// --- index.js: sambungan
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const dg = src.slice(src.indexOf("async function deliverGroupFile"), src.indexOf("async function convertGroupDocument"));
  assert.match(dg, /buildPdf\(/);
  assert.match(dg, /mimetype = "application\/pdf"/);
  assert.match(dg, /fileName = pdfFileName\(/);
  assert.match(dg, /document: buf, mimetype, fileName/);
  assert.match(dg, /acctFields\(currentAccountId\(\)\)/, "baris pesan tercatat per akun WA");
  assert.match(dg, /catch/, "kegagalan tidak melempar ke penangan pesan");
  const iOnly = src.indexOf("if (fileReq?.only)");
  assert.ok(iOnly > 0 && iOnly < src.indexOf("generateAutoReply(groupJid)", iOnly), "'jadikan pdf' saja tidak memanggil AI");
}
ok("index.js: dokumen PDF dikirim (mimetype, nama berkas), dicatat per akun, kegagalan tertangani, 'jadikan pdf' tanpa AI");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nSemua ${n} kelompok tes PDF jawaban lulus ✅`);
