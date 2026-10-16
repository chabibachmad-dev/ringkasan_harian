// Tes pembuat Word (.docx) & Excel (.xlsx) tanpa pustaka. Jalankan: node test-office-doc.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildDocx, buildXlsx, asNumber, officeFileName, sheetsFromMarkdown, MIME_DOCX, MIME_XLSX } from "./office-doc.js";
import { readZip } from "./zip-lite.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "office-"));
const save = (buf, name) => { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; };
const entry = (buf, name) => { const e = readZip(buf).find((x) => x.name === name); assert.ok(e, `bagian ${name} tidak ada`); return e.read().toString("utf8"); };
const py = (code) => spawnSync("python3", ["-I", "-c", code], { encoding: "utf8" });
const hasPy = (mod) => py(`import ${mod}`).status === 0;

const md = [
  "# Perbandingan",
  "",
  "Ringkasan **penting** & _miring_ dengan `kode` <tag>. Arab: مرحبا 😀",
  "",
  "## Grupset Road",
  "",
  "| Level | Shimano | SRAM | Harga | Jumlah |",
  "|---|---|---|---|---|",
  "| Entry | Claris | - | Rp 3,5 - 4,5 Juta | 1.250 |",
  "| | Sora | Apex | Rp 4,5 - 7,5 Juta | 3,5 |",
  "| Mid | =SUM(A1) | 0812345 | **tebal** | 007 |",
  "",
  "## Catatan",
  "",
  "- Entry: Deore",
  "  - sub item",
  "1. satu",
  "2. dua",
  "",
  "```",
  "kode  baris",
  "```",
  "",
  "---",
  "Penutup.",
  "",
  "## MTB",
  "",
  "| A | B |",
  "|---|---|",
  "| 1 | 2 |"
].join("\n");

// --- angka
{
  const yes = { "1234": 1234, "-12": -12, "0": 0, "1.234": 1234, "1.234.567": 1234567, "1.234,5": 1234.5, "3,5": 3.5, "3.5": 3.5, "1,234,567.89": 1234567.89, "1,234.50": 1234.5, "0,75": 0.75, "1.5": 1.5 };
  for (const [k, v] of Object.entries(yes)) assert.equal(asNumber(k), v, `${k} harus ${v}`);
  for (const k of ["1,234", "0812345", "007", "Rp 1.000", "12%", "2026-01-05", "=A1", "", "abc", "1e5", "12345678901234567890", "+62812", "1.2.3", "1,5,5"]) assert.equal(asNumber(k), null, `${k} harus tetap teks`);
}
ok("asNumber: angka murni (titik/koma ribuan & desimal) jadi angka; nol di depan, Rp, %, tanggal, rumus, '1,234' ambigu tetap teks");

// --- struktur zip & isi XLSX
{
  const buf = buildXlsx(md);
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const names = readZip(buf).map((e) => e.name);
  for (const x of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) assert.ok(names.includes(x), x);
  assert.ok(!names.includes("xl/worksheets/sheet3.xml"), "hanya 2 tabel = 2 lembar");
  const wb = entry(buf, "xl/workbook.xml");
  assert.match(wb, /name="Grupset Road"/);
  assert.match(wb, /name="MTB"/);
  const s1 = entry(buf, "xl/worksheets/sheet1.xml");
  assert.match(s1, /<c r="E2" s="3"><v>1250<\/v><\/c>/, "1.250 -> angka 1250");
  assert.match(s1, /<c r="E3" s="3"><v>3.5<\/v><\/c>/);
  assert.match(s1, /<c r="B4"[^>]*t="inlineStr"><is><t xml:space="preserve">=SUM\(A1\)<\/t>/, "'=SUM' disimpan sebagai teks, bukan rumus");
  assert.ok(!/<f>/.test(s1), "tidak ada rumus");
  assert.match(s1, /<t xml:space="preserve">0812345<\/t>/);
  assert.match(s1, /<t xml:space="preserve">tebal<\/t>/, "** dibuang");
  assert.match(s1, /<pane ySplit="1"/, "judul kolom dibekukan");
  assert.match(s1, /<c r="A3" s="2"\/>/, "sel kosong tetap ada");
}
ok("XLSX: bagian wajib ada, 1 tabel = 1 lembar bernama dari judul, angka numerik, rumus/0812 tetap teks, judul kolom dibekukan");

{
  const sheets = sheetsFromMarkdown("Halo dunia.\n\n- satu\n- dua\n\n1. tiga\n\nSelesai.");
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, "Teks");
  assert.deepEqual(sheets[0].rows.map((r) => r[0]), ["Halo dunia.", "", "• satu", "• dua", "", "1. tiga", "", "Selesai."]);
  const named = sheetsFromMarkdown("## Data: [A]/B*?\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n## Data: [A]/B*?\n\n| x | y |\n|---|---|\n| 3 | 4 |\n\n| p | q |\n|---|---|\n| 5 | 6 |");
  assert.deepEqual(named.map((s) => s.name), ["Data A B", "Data A B 2", "Tabel 3"]);
  assert.ok(named.every((s) => s.name.length <= 31 && !/[\[\]:*?/\\]/.test(s.name)));
  assert.deepEqual(sheetsFromMarkdown("Berikut adalah tabel perbandingan yang sangat panjang sekali:\n\n| x | y |\n|---|---|\n| 1 | 2 |").map((x) => x.name), ["Tabel 1"], "kalimat panjang bukan nama lembar");
  assert.deepEqual(sheetsFromMarkdown("Harga barang:\n\n| x | y |\n|---|---|\n| 1 | 2 |").map((x) => x.name), ["Harga barang"], "paragraf pendek jadi nama lembar");
  const bytes = buildXlsx("");
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
}
ok("XLSX tanpa tabel: lembar 'Teks' per baris; nama lembar bersih (tanpa []:*?/\\), unik, maks 31 huruf; kosong tetap sah");

// --- DOCX
{
  const buf = buildDocx(md, { title: "Perbandingan grupset", subtitle: "Dibuat oleh Ayyubi" });
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const doc = entry(buf, "word/document.xml");
  assert.match(doc, /w:pStyle w:val="Title"/);
  assert.match(doc, /w:pStyle w:val="Heading2"/);
  assert.equal((doc.match(/<w:tbl>/g) || []).length, 2, "dua tabel Word sungguhan");
  assert.match(doc, /<w:tblHeader\/>/, "judul kolom berulang di tiap halaman");
  assert.match(doc, /مرحبا/, "huruf Arab tetap ada (Unicode penuh)");
  assert.match(doc, /&lt;tag&gt;/, "karakter XML di-escape");
  assert.match(doc, /Courier New/, "blok kode berfont monospasi");
  assert.ok(!/w:orient="landscape"/.test(doc), "tabel 5 kolom: halaman tegak");
  assert.ok(!doc.includes("**") && !doc.includes("|---"), "penanda markdown tidak bocor");
  const wide = buildDocx("| a | b | c | d | e | f | g |\n|---|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 |", { title: "Lebar" });
  assert.match(entry(wide, "word/document.xml"), /w:orient="landscape"/, "tabel >= 6 kolom: halaman mendatar");
  const sizes = [...entry(buf, "word/document.xml").matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= 7 && sizes.every((w) => w >= 600));
  assert.equal(buildDocx("").subarray(0, 2).toString(), "PK");
  assert.equal(entry(buildDocx("x\u0001y\u0008z"), "word/document.xml").includes("\u0001"), false, "karakter kontrol dibuang");
}
ok("DOCX: judul/heading bergaya, tabel Word sungguhan berjudul-kolom-berulang, Unicode & escape XML aman, kode monospasi, tabel lebar -> mendatar");

// --- dibuka oleh aplikasi sungguhan (bila tersedia)
{
  const x = save(buildXlsx(md), "uji.xlsx");
  const d = save(buildDocx(md, { title: "Perbandingan grupset" }), "uji.docx");
  let checked = 0;
  if (hasPy("openpyxl")) {
    const r = py(`import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1] if len(sys.argv)>1 else ${JSON.stringify(x)})\nws=wb.worksheets[0]\nprint(wb.sheetnames, ws['E2'].value, type(ws['E2'].value).__name__, ws['B4'].value, ws['B4'].data_type, ws.freeze_panes)`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\['Grupset Road', 'MTB'\] 1250 int =SUM\(A1\) s A2/);
    checked++;
  }
  if (hasPy("docx")) {
    const r = py(`import docx\nd=docx.Document(${JSON.stringify(d)})\nprint(len(d.tables), d.tables[0].rows[1].cells[4].text, d.paragraphs[0].style.name)`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 1\.250 Title/);
    checked++;
  }
  const soffice = spawnSync("sh", ["-c", "command -v soffice"]).status === 0;
  if (soffice && process.env.OFFICE_TEST_SOFFICE) {
    const r = spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", tmp, d, x], { timeout: 120000 });
    assert.equal(r.status, 0);
    checked++;
  }
  console.log(`    (dibuka oleh ${checked} aplikasi pembaca sungguhan)`);
}
ok("berkas dibuka dengan benar oleh openpyxl & python-docx (bila terpasang)");

// --- nama berkas & jenis
{
  assert.equal(officeFileName("Tabel perbandingan hierarki grupset", "xlsx"), "Tabel-perbandingan-hierarki-grupset.xlsx");
  assert.equal(officeFileName("한국어", "docx"), "Jawaban.docx");
  assert.ok(MIME_XLSX.endsWith("spreadsheetml.sheet") && MIME_DOCX.endsWith("wordprocessingml.document"));
}
ok("nama berkas ASCII aman; jenis MIME benar");

// --- index.js: sambungan
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const dg = src.slice(src.indexOf("async function deliverGroupFile"), src.indexOf("async function convertGroupDocument"));
  assert.match(dg, /buildXlsx\(clean\)/);
  assert.match(dg, /buildDocx\(clean, \{ title \}\)/);
  assert.match(dg, /mimetype = MIME_XLSX/);
  assert.match(dg, /mimetype = MIME_DOCX/);
  assert.match(dg, /raw \? String\(markdown \?\? ""\) : cleanAnswerForFile\(markdown\)/, "jawaban AI dibersihkan, hasil konversi PDF tidak");
}
ok("index.js: Excel & Word dikirim lewat jalur yang sama dengan PDF (mimetype benar; jawaban AI dibersihkan, konversi PDF apa adanya)");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nSemua ${n} kelompok tes Word/Excel lulus ✅`);
