// Tes perapian balasan WhatsApp (tabel, tebal, judul) + pengenalan "jadikan PDF". Jalankan: node test-wa-format.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatForWhatsApp, detectPdfRequest, parseTableAt, splitRow, renderTableForWhatsApp, WA_MONO_MAX } from "./wa-format.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;

// --- pembaca tabel
assert.deepEqual(splitRow("| a | b \\| c | d |"), ["a", "b | c", "d"]);
assert.deepEqual(splitRow("x | y"), ["x", "y"]);
{
  const t = parseTableAt(["| A | B |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |", "", "teks"], 0);
  assert.deepEqual(t.headers, ["A", "B"]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.end, 4);
  assert.equal(parseTableAt(["| A | B |", "teks biasa"], 0), null);
  assert.equal(parseTableAt(["| A | B |", "|---|---|"], 0), null, "tanpa baris isi bukan tabel");
  assert.equal(parseTableAt(["satu kolom", "---", "x"], 0), null);
}
ok("pembaca tabel: sel, \\|, akhir tabel, bukan-tabel");

// --- tabel sempit -> blok monospace
{
  const out = formatForWhatsApp("| Hari | Jam |\n|---|---|\n| Senin | 08.00 |\n| Selasa | 09.30 |");
  assert.ok(out.startsWith("```\n") && out.endsWith("\n```"), out);
  const body = out.split("\n").slice(1, -1);
  assert.equal(body.length, 4);
  assert.ok(body.every((l) => [...l].length <= WA_MONO_MAX));
  assert.match(body[0], /^Hari\s+\| Jam$/);
  assert.match(body[1], /^-+-\+-+$/);
  const bars = body.filter((l) => l.includes("|")).map((l) => l.indexOf("|"));
  assert.equal(new Set(bars).size, 1, "garis tegak rata");
}
ok("tabel sempit: blok monospace berkolom rata, tidak melebihi lebar layar");

// --- dua kolom lebar -> daftar
{
  const out = formatForWhatsApp("| Istilah | Penjelasan |\n|---|---|\n| **Halal** | Sesuai syariat dan telah bersertifikat resmi dari BPJPH |\n| Haram | Dilarang menurut syariat Islam secara tegas |");
  assert.match(out, /^_Istilah → Penjelasan_/);
  assert.match(out, /• \*Halal\* — Sesuai syariat/);
  assert.match(out, /• \*Haram\* — Dilarang/);
  assert.ok(!out.includes("|"));
}
ok("tabel dua kolom lebar: daftar '• *A* — B'");

// --- tabel lebar -> kartu, kolom No dipakai untuk penomoran
{
  const md = "| No | Tahap | Penanggung Jawab | Waktu |\n|---|---|---|---|\n| 1 | Pengajuan permohonan sertifikasi | Pelaku usaha | 1 hari |\n| 2 | Pemeriksaan **kelengkapan** berkas | BPJPH | 2 hari |";
  const out = formatForWhatsApp(md);
  assert.match(out, /\*1\. Pengajuan permohonan sertifikasi\*\n• Penanggung Jawab: Pelaku usaha\n• Waktu: 1 hari/);
  assert.match(out, /\*2\. Pemeriksaan kelengkapan berkas\*/);
  assert.ok(!out.includes("|") && !out.includes("**"));
  const out2 = formatForWhatsApp("| Nama | Peran | Catatan panjang sekali |\n|---|---|---|\n| Andi | Ketua | Bertanggung jawab atas keseluruhan kegiatan tahunan |");
  assert.match(out2, /^\*Andi\*\n• Peran: Ketua\n• Catatan panjang sekali: Bertanggung/);
}
ok("tabel lebar: kartu per baris, kolom 'No' jadi nomor, **tebal** di sel dirapikan");

// --- teks sekitar tabel, judul, tebal, tautan, garis
{
  const out = formatForWhatsApp("## Ringkasan\n\nIni **penting** sekali.\n\n---\n\nLihat [situs](https://halal.go.id) ya.\n\n\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nSelesai.");
  assert.match(out, /^\*Ringkasan\*\n\nIni \*penting\* sekali\./);
  assert.ok(!out.includes("---\n\nLihat") && !out.includes("\n\n\n"));
  assert.match(out, /situs \(https:\/\/halal\.go\.id\)/);
  assert.match(out, /```[\s\S]*A \| B[\s\S]*```\n\nSelesai\.$/);
}
ok("judul → *Judul*, **tebal** → *tebal*, garis dibuang, tautan, jeda baris berlebih");

// --- blok kode tidak disentuh
{
  const src = "Contoh:\n```\n| a | b |\n|---|---|\n| **1** | 2 |\n## bukan judul\n```\nSetelah.";
  assert.equal(formatForWhatsApp(src), src);
}
ok("isi blok kode (``` ... ```) tidak diubah sama sekali");

// --- idempoten, tanpa tabel lewat apa adanya
{
  const plainTxt = "Halo, ini jawaban biasa.\n\n• satu\n• dua\n\n_miring_ dan *tebal*.";
  assert.equal(formatForWhatsApp(plainTxt), plainTxt);
  const md = "| No | Tahap | Penanggung Jawab | Waktu |\n|---|---|---|---|\n| 1 | Ajukan berkas lengkap | Pelaku usaha | 1 hari |";
  const once = formatForWhatsApp(md);
  assert.equal(formatForWhatsApp(once), once);
  assert.equal(formatForWhatsApp(""), "");
  assert.equal(formatForWhatsApp(null), "");
  assert.equal(formatForWhatsApp("a\r\nb"), "a\nb");
}
ok("tanpa tabel lewat apa adanya; hasilnya idempoten; kosong/null aman");

// --- permintaan PDF
{
  const d = detectPdfRequest("jelaskan alur sertifikasi halal dalam bentuk PDF");
  assert.equal(d.only, false);
  assert.equal(d.rest, "jelaskan alur sertifikasi halal");
  assert.deepEqual(detectPdfRequest("jadikan pdf"), { only: true, rest: "" });
  assert.equal(detectPdfRequest("tolong jadikan pdf dong").only, true);
  assert.equal(detectPdfRequest("pdf-kan").only, true);
  assert.equal(detectPdfRequest("buatkan tabel perbandingan lalu jadikan pdf").rest, "buatkan tabel perbandingan");
  assert.equal(detectPdfRequest("buatkan tabel perbandingan lalu jadikan pdf").only, false);
  assert.equal(detectPdfRequest("rangkum aturan cuti dengan format pdf").rest, "rangkum aturan cuti");
  assert.equal(detectPdfRequest("jelaskan PPN, kirim sebagai PDF")?.only, false);
}
ok("detectPdfRequest: 'dalam bentuk PDF', 'jadikan pdf' (hanya), 'lalu jadikan pdf'");

for (const t of ["apa itu pdf?", "baca pdf ini", "kirim pdf peraturan PMK 62", "/pdf jadikan", "isi pdf tadi apa", "halo semua", "", null]) {
  assert.equal(detectPdfRequest(t), null, `harus null: ${t}`);
}
ok("detectPdfRequest: pertanyaan tentang PDF, baca/kirim file PDF, perintah slash, teks biasa → bukan permintaan");

// --- index.js: sambungan
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /formatForWhatsApp\(result\.reply\)/);
  const dTxt = src.slice(src.indexOf("async function deliverAutoReplyText"), src.indexOf("async function deliverAutoReplyVoice"));
  assert.match(dTxt, /formatForWhatsApp\(result\.reply\)/, "balasan teks dirapikan sebelum dikirim");
  assert.match(dTxt, /catch/, "bila perapian gagal, balasan mentah tetap terkirim");
  assert.match(dTxt, /rememberReplySource\(/, "sumber balasan diingat untuk 'jadikan pdf'");
}
ok("index.js: balasan teks dirapikan (dengan cadangan bila gagal) dan sumbernya diingat");

console.log(`\nSemua ${n} kelompok tes format WhatsApp lulus ✅`);
