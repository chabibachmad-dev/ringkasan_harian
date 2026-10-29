// Tes pembaca tabel PDF (-> Excel/Word) dan sambungan perintah grup. Jalankan: node test-pdf-extract.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { layoutPagesToMarkdown, pdfBufferToMarkdown, sliceTable, PDF_MAX_BYTES } from "./pdf-extract.js";
import { buildPdf } from "./pdf-doc.js";
import { buildXlsx, sheetsFromMarkdown } from "./office-doc.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;

// --- tabel dari teks -layout
const PAGE1 = [
  "Daftar Kegiatan Tahun 2026",
  "",
  "Berikut kegiatan yang dibiayai dari DIPA.",
  "",
  " No   Uraian Kegiatan                  Unit     Anggaran",
  " 1    Pendampingan halal                Seksi A  1.500.000",
  " 2    Rapat koordinasi                  Seksi B  2.250.000",
  "      lanjutan uraian",
  " 3    Pelatihan auditor internal        Seksi A  3.000.000",
  "",
  "Catatan: angka dalam rupiah."
].join("\n");
{
  const r = layoutPagesToMarkdown([PAGE1]);
  assert.equal(r.tables, 1);
  const lines = r.markdown.split("\n");
  assert.ok(lines.includes("| No | Uraian Kegiatan | Unit | Anggaran |"));
  assert.ok(lines.includes("| 1 | Pendampingan halal | Seksi A | 1.500.000 |"));
  assert.ok(lines.includes("| 2 | Rapat koordinasi lanjutan uraian | Seksi B | 2.250.000 |"), "baris lanjutan digabung ke baris di atasnya");
  assert.match(r.markdown, /Berikut kegiatan yang dibiayai dari DIPA\./);
  assert.match(r.markdown, /Catatan: angka dalam rupiah\./);
  const x = sheetsFromMarkdown(r.markdown);
  assert.equal(x.length, 1);
  assert.equal(x[0].rows.length, 4);
}
ok("tabel dari teks -layout: judul kolom, baris data, baris lanjutan digabung; teks di luar tabel tetap paragraf");

// --- bukan tabel: paragraf biasa, formulir "Nama:   Budi", daftar isi
{
  const prose = ["Pasal 1", "", "Setiap pelaku usaha wajib memiliki sertifikat halal untuk", "produk yang diedarkan di wilayah Indonesia sesuai ketentuan", "peraturan perundang-undangan yang berlaku.", "", "1. Pertama", "2. Kedua"].join("\n");
  const r = layoutPagesToMarkdown([prose]);
  assert.equal(r.tables, 0);
  assert.match(r.markdown, /Setiap pelaku usaha wajib memiliki sertifikat halal untuk produk yang diedarkan di wilayah Indonesia sesuai ketentuan peraturan perundang-undangan yang berlaku\./, "baris yang dibungkus layar disambung");
  assert.match(r.markdown, /^1\. Pertama$/m);
  const form = ["Nama      :  Budi", "Alamat    :  Jalan Mawar 1", "Tanggal   :  2 Januari 2026"].join("\n");
  assert.equal(layoutPagesToMarkdown([form]).tables, 1, "3 baris berkolom rata dianggap tabel (diakui: bisa meleset untuk formulir)");
  assert.equal(layoutPagesToMarkdown([["Nama   Budi", "Alamat   Mawar"].join("\n")]).tables, 0, "kurang dari 3 baris bukan tabel");
}
ok("bukan tabel: paragraf disambung, daftar bernomor dipertahankan, 2 baris saja tidak dianggap tabel");

// --- tabel gambar dengan "|" & garis
{
  const art = ["==========================================", " LEVEL      | SHIMANO      | SRAM", "==========================================", " Entry      | Claris       | -", "            | Sora         | Apex", "------------+--------------+------------", " Mid        | Tiagra       | Apex AXS", " High       | Ultegra      | Force", "=========================================="].join("\n");
  const r = layoutPagesToMarkdown([art]);
  assert.equal(r.tables, 1);
  assert.match(r.markdown, /\| LEVEL \| SHIMANO \| SRAM \|/);
  assert.match(r.markdown, /\| Mid \| Tiagra \| Apex AXS \|/);
  assert.ok(!r.markdown.includes("==="), "garis pemisah dibuang");
}
ok("tabel 'gambar' (garis ===, ---+---, kolom |) dibaca sebagai tabel");

// --- tabel berlanjut antar halaman, footer halaman dibuang
{
  const mk = (from, to, head) => [head ? " No   Uraian                      Unit" : "", ...Array.from({ length: to - from + 1 }, (_, i) => ` ${from + i}    Kegiatan nomor ${from + i}          Seksi ${i % 3}`), "", "Halaman 1 dari 2"].filter((x) => x !== "").join("\n");
  const p1 = mk(1, 5, true);
  const p2 = [" No   Uraian                      Unit", ...Array.from({ length: 5 }, (_, i) => ` ${6 + i}    Kegiatan nomor ${6 + i}          Seksi ${i % 3}`), "Halaman 2 dari 2"].join("\n");
  const r = layoutPagesToMarkdown([p1, p2]);
  assert.equal(r.tables, 1, "judul kolom yang berulang di halaman 2 = tabel yang sama");
  assert.equal((r.markdown.match(/^\| No \|/gm) || []).length, 1);
  assert.equal((r.markdown.match(/^\| \d+ \|/gm) || []).length, 10);
  assert.ok(!/Halaman \d/.test(r.markdown), "footer halaman dibuang");
}
ok("tabel yang terpotong antar halaman digabung (judul kolom berulang dibuang); 'Halaman 1 dari 2' dibuang");

// --- sliceTable: tolak yang meragukan
{
  assert.equal(sliceTable(["satu dua", "tiga empat"]), null);
  assert.equal(sliceTable([]), null);
}
ok("sliceTable menolak masukan terlalu kecil");

// --- pdfBufferToMarkdown dengan exec tiruan
{
  const pdfHead = Buffer.from("%PDF-1.4\n%fake\n");
  const exec = async (cmd) => (cmd === "pdfinfo" ? "Pages:          2\n" : `${PAGE1}\f\f`);
  const r = await pdfBufferToMarkdown(pdfHead, { exec });
  assert.equal(r.tables, 1);
  assert.equal(r.pages, 2);
  assert.equal(r.scanned, false);
  const scanned = await pdfBufferToMarkdown(pdfHead, { exec: async (cmd) => (cmd === "pdfinfo" ? "Pages: 3\n" : "\f\f\f") });
  assert.equal(scanned.scanned, true, "tanpa teks = hasil scan");
  await assert.rejects(pdfBufferToMarkdown(Buffer.from("bukan pdf"), { exec }), (e) => e.kind === "badpdf");
  await assert.rejects(pdfBufferToMarkdown(Buffer.concat([pdfHead, Buffer.alloc(PDF_MAX_BYTES)]), { exec }), (e) => e.kind === "toobig");
  const noTool = async () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); };
  await assert.rejects(pdfBufferToMarkdown(pdfHead, { exec: noTool }), (e) => e.kind === "notool");
  const slow = async (cmd) => { if (cmd === "pdfinfo") return "Pages: 1\n"; throw Object.assign(new Error("t"), { killed: true, signal: "SIGTERM" }); };
  await assert.rejects(pdfBufferToMarkdown(pdfHead, { exec: slow }), (e) => e.kind === "timeout");
  const trunc = await pdfBufferToMarkdown(pdfHead, { exec: async (c) => (c === "pdfinfo" ? "Pages: 200\n" : PAGE1) });
  assert.equal(trunc.truncated, true);
}
ok("pdfBufferToMarkdown: hasil scan, bukan PDF, terlalu besar, pdftotext tak ada, kelamaan, dipotong 60 halaman — semua dikenali");

// --- PDF sungguhan (bila pdftotext ada): buatan sendiri -> dibaca kembali -> Excel
if (has("pdftotext") && has("pdfinfo")) {
  const rows = Array.from({ length: 70 }, (_, i) => `| ${i + 1} | Kegiatan nomor ${i + 1} yang cukup panjang untuk membungkus baris | Seksi ${i % 7} | ${(i + 1) * 1500} |`);
  const pdf = buildPdf(["# Daftar Kegiatan", "", "Paragraf pembuka.", "", "| No | Uraian | Unit | Anggaran |", "|---|---|---|---|", ...rows, "", "Penutup."].join("\n"));
  const r = await pdfBufferToMarkdown(pdf);
  assert.equal(r.scanned, false);
  assert.equal(r.tables, 1, "tabel 2 halaman jadi satu tabel");
  assert.ok(r.pages >= 2);
  const xl = sheetsFromMarkdown(r.markdown);
  assert.equal(xl[0].rows.length, 71, "judul + 70 baris");
  assert.deepEqual(xl[0].rows[70].slice(0, 1), ["70"]);
  assert.equal(buildXlsx(r.markdown).subarray(0, 2).toString(), "PK");
  // PDF kosong teks (halaman hanya garis) bukan tabel
  const blank = buildPdf("---");
  const rb = await pdfBufferToMarkdown(blank);
  assert.equal(rb.tables, 0);
}
ok("PDF sungguhan 2 halaman (pdftotext): tabel 70 baris utuh, satu tabel, bisa dijadikan Excel");

// --- index.js: sambungan perintah grup
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /const docAttached = groupAudio \|\| photo \? null : content\.documentMessage/);
  assert.match(src, /const officeReq = groupAudio \? null : detectOfficeRequest\(text\)/);
  assert.match(src, /const pdfReq = groupAudio \|\| officeReq \? null : detectPdfRequest\(text\)/);
  assert.match(src, /if \(docAttached && !readPdf && !docEdit && !\(fileReq && fileReq\.format !== "pdf"\)\) return;/, "dokumen (selain PDF yang ditanyakan) tanpa perintah Excel/Word/ubah isi diabaikan");
  const iDoc = src.indexOf('if (fileReq && fileReq.format !== "pdf" && (docAttached || quotedDoc))');
  const iOnly = src.indexOf("if (fileReq?.only)");
  const iImg = src.indexOf("const imageReq = imageGen.detectIntent(text");
  const iAI = src.indexOf("result = await generateAutoReply(groupJid);");
  assert.ok(iDoc > 0 && iDoc < iOnly && iOnly < iImg && iImg < iAI, "urutan: konversi dokumen -> 'jadikan X' -> gambar -> AI");
  assert.match(src, /fileQuotaOk\(msg\.key\.participant \|\| sender\)/);
  assert.ok(src.indexOf("fileQuotaOk(msg.key.participant") < iDoc, "jatah dicek sebelum pekerjaan berat");
  assert.match(src, /flags\.wantFile = fileReq \? fileReq\.format : ""/);
  assert.match(src, /!ctxFlags\?\.wantFile\) imageNote = IMAGE_PROMPT_NOTE/, "catatan gambar tidak dikirim saat membuat berkas (AI jangan promosi perintah gambar)");
  const cg = src.slice(src.indexOf("async function convertGroupDocument"));
  assert.match(cg, /runFileJob\(/, "konversi berjalan satu per satu");
  assert.match(cg, /pdfBufferToMarkdown\(buffer\)/);
  assert.match(cg, /raw: true/, "isi PDF tidak dibersihkan seperti jawaban AI");
  assert.match(cg, /r\.scanned/);
  assert.match(cg, /bukan PDF/);
  assert.match(cg, /Mohon dicek ulang/);
  assert.match(src, /WA_GROUP_FILE_MAX_PER_DAY/);
}
ok("index.js: urutan penanganan benar, jatah harian sebelum kerja berat, konversi satu per satu, pesan jelas untuk PDF scan/bukan PDF");

// --- surat resmi: sel yang dibungkus di baris terakhir tabel tidak hilang; blok tanda tangan rata-kanan tidak menyatu
{
  const page = [
    "                                    SURAT KETERANGAN",
    "",
    "  Yang bertanda tangan di bawah ini,",
    "",
    "   Nama                               :   I Ketut Arimbawa",
    "",
    "   NIP                                :   196902241989121001",
    "",
    "   Jabatan                            :   Kepala Kantor Pelayanan Kekayaan Negara dan Lelang",
    "                                          Denpasar",
    "",
    "  menyatakan dengan sungguh-sungguh bahwa:",
    "",
    "  Surat pernyataan ini dibuat dengan sebenarnya dan tanpa tekanan pihak manapun untuk dapat",
    "  digunakan sebagaimana mestinya.",
    "",
    "                                                                     Denpasar, 23 Agustus 2026",
    "                                                                     Kepala Kantor Pelayanan Kekayaan",
    "                                                                     Ditandatangani secara elektronik",
    "                                                                     I Ketut Arimbawa"
  ].join("\n");
  const r = layoutPagesToMarkdown([page]);
  const md = typeof r === "string" ? r : r.markdown;
  assert.ok(md.includes("| Jabatan | : | Kepala Kantor Pelayanan Kekayaan Negara dan Lelang Denpasar |"), md);
  assert.ok(md.includes("untuk dapat digunakan sebagaimana mestinya."), "paragraf biasa tetap digabung");
  for (const line of ["Denpasar, 23 Agustus 2026", "Kepala Kantor Pelayanan Kekayaan", "Ditandatangani secara elektronik", "I Ketut Arimbawa"]) assert.ok(md.split("\n").includes(line), `baris sendiri: ${line}\n${md}`);
  assert.ok(!md.includes("mestinya. Denpasar"), "blok tanda tangan tidak menempel ke paragraf di atasnya");
}
ok("surat resmi: lanjutan sel di baris terakhir tabel ikut, blok tanda tangan rata-kanan berdiri sendiri");

console.log(`\nSemua ${n} kelompok tes pembaca PDF lulus ✅`);
