// Tes konverter peraturan PDF -> Markdown (pdf-md.js). Jalankan: node test-pdf-md.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildRegulationMarkdown, markdownToPages, markdownTitle, cleanPages, extractMeta, slugify } from "./pdf-md.js";

let fails = 0;
const check = (ok, name) => {
  if (ok) console.log("ok:", name);
  else {
    fails++;
    console.log("FAIL:", name);
  }
};
const NOW = new Date("2026-10-14T00:00:00Z");
const build = (texts, o = {}) => buildRegulationMarkdown(texts.map((text, i) => ({ page: i + 1, text })), { filename: "x.pdf", now: NOW, ...o });

// ---- slug
check(slugify("PMK No. 12/2020 (Perjalanan Dinas).pdf") === "PMK-No.-12-2020-Perjalanan-Dinas", "slug: aman untuk nama file");
check(slugify("") === "dokumen" && slugify("../../etc/passwd").indexOf("/") === -1, "slug: kosong & traversal");

// ---- metadata
{
  const m = extractMeta(["PERATURAN MENTERI KEUANGAN", "REPUBLIK INDONESIA", "NOMOR 12 TAHUN 2020", "TENTANG", "PERJALANAN DINAS DALAM NEGERI", "", "DENGAN RAHMAT"], "a.pdf");
  check(m.jenis === "Peraturan Menteri Keuangan" && m.nomor === "12" && m.tahun === 2020, "meta: jenis/nomor/tahun");
  check(m.tentang === "Perjalanan Dinas dalam Negeri", "meta: tentang berhuruf judul (kata sambung kecil)");
  check(m.judul === "Peraturan Menteri Keuangan Nomor 12 Tahun 2020 tentang Perjalanan Dinas dalam Negeri", "meta: judul lengkap");
  const u = extractMeta(["UNDANG-UNDANG REPUBLIK INDONESIA", "NOMOR 33 TAHUN 2014", "TENTANG", "JAMINAN PRODUK HALAL"], "uu.pdf");
  check(u.jenis === "Undang-Undang" && u.judul.includes("Jaminan Produk Halal"), "meta: undang-undang");
  const none = extractMeta(["Surat biasa tanpa nomor"], "Rencana_Kerja-2026.pdf");
  check(none.judul === "Rencana Kerja 2026" && none.nomor === "" && none.tahun === null, "meta: tanpa nomor -> judul dari nama file");
}

// ---- header/footer
{
  const pg = (n, body) => `PRESIDEN\nREPUBLIK INDONESIA\n\n${body}\n\n- ${n} -\nwww.peraturan.go.id`;
  const cl = cleanPages([1, 2, 3, 4].map((n) => ({ page: n, text: pg(n, `Isi halaman ${n}.`) })));
  check(cl.every((l, i) => l.join("\n").trim() === `Isi halaman ${i + 1}.`), "bersih: header berulang, nomor halaman, URL dibuang");
  const cj = cleanPages([1, 2, 3, 4].map((n) => ({ page: n, text: `Pasal ${n}\nCukup jelas.` })));
  check(cj.every((l, i) => l.join("\n") === `Pasal ${i + 1}\nCukup jelas.`), "bersih: 'Cukup jelas.' & Pasal di tepi halaman TIDAK dianggap header");
  const cl2 = cleanPages([{ page: 1, text: "Isi\n- 7 -" }]);
  check(cl2[0].join("\n").trim() === "Isi", "bersih: nomor halaman dibuang walau dokumen pendek");
  const keep = cleanPages([{ page: 1, text: "Tahun\n2020\nPasal 5" }]);
  check(keep[0].join("\n").includes("Pasal 5"), "bersih: isi tidak ikut terbuang");
}

// ---- struktur dasar
{
  const r = build([
    "BAB I\nKETENTUAN UMUM\n\nPasal 1\nDalam Undang-Undang ini yang dimaksud dengan:\n1. Halal adalah sesuai syariat Islam.\n2. Produk adalah barang\n   dan/atau jasa.\n\nPasal 2\n(1) Produk wajib bersertifikat.\n(2) Kewajiban sebagaimana dimaksud pada ayat (1) meliputi:\n    a. makanan; dan\n    b. minuman.\n\nPasal 3\nTidak ada ayat."
  ]);
  const md = r.markdown;
  check(/^## BAB I — KETENTUAN UMUM$/m.test(md), "struktur: BAB + judul di baris berikutnya");
  check(/^### Pasal 1$/m.test(md) && /^### Pasal 2$/m.test(md) && /^### Pasal 3$/m.test(md), "struktur: Pasal jadi judul satu tingkat di bawah BAB");
  check(/^- 1\. Halal adalah sesuai syariat Islam\.$/m.test(md), "daftar: angka dipertahankan nomor aslinya");
  check(/^- 2\. Produk adalah barang dan\/atau jasa\.$/m.test(md), "daftar: baris terpotong digabung");
  check(/^- \(1\) Produk wajib bersertifikat\.$/m.test(md) && /^  - a\. makanan; dan$/m.test(md) && /^  - b\. minuman\.$/m.test(md), "daftar: ayat -> huruf bertingkat");
  check(r.stats.bab === 1 && r.stats.pasal === 3 && r.stats.ayat === 2, "statistik: bab/pasal/ayat");
  check(/^jumlah_pasal: 3$/m.test(md), "kepala: jumlah_pasal");
}

// ---- Pasal sebagai rujukan di tengah kalimat BUKAN judul
{
  const r = build(["Pasal 7\nSetiap orang wajib mematuhi ketentuan sebagaimana dimaksud dalam\nPasal 5\ndan Pasal 6 Undang-Undang ini."]);
  check(/^## Pasal 7$/m.test(r.markdown), "rujukan: Pasal 7 di awal tetap judul");
  check(!/^#+ Pasal 5$/m.test(r.markdown), "rujukan: 'Pasal 5' di tengah kalimat bukan judul");
  check(r.markdown.includes("dalam Pasal 5 dan Pasal 6"), "rujukan: kalimat tetap utuh");
}

// ---- sambung kata & antarhalaman
{
  const r = build(["Pasal 1\nPelaku usaha wajib memenuhi ketentuan undang-\nundang dan peraturan yang", "berlaku di Indonesia.\n\nPasal 2\nCukup jelas."]);
  check(r.markdown.includes("undang-undang dan peraturan yang berlaku di Indonesia."), "gabung: tanda hubung & kalimat antarhalaman");
  const marks = r.markdown.match(/<!-- hlm \d+ -->/g) || [];
  check(marks.length === 2 && r.markdown.indexOf("<!-- hlm 2 -->") > r.markdown.indexOf("berlaku di Indonesia."), "halaman: kalimat antarhalaman utuh, penanda hlm 2 sebelum blok yang mulai di hlm 2");
}

// ---- tabel
{
  const t = "No.    Uraian          Tarif\n1      Sewa            100.000\n2      Listrik         200.000\n3      Air             50.000";
  const r = build([`Pasal 1\nTarif sebagai berikut:\n\n${t}\n\nDemikian.`]);
  check(r.markdown.includes("| No. | Uraian | Tarif |") && r.markdown.includes("| --- | --- | --- |") && r.markdown.includes("| 2 | Listrik | 200.000 |"), "tabel: jadi tabel Markdown");
  check(r.stats.tabel === 1, "tabel: terhitung");
  const fake = build(["Pasal 1\na.     isi huruf a\nb.     isi huruf b\nc.     isi huruf c"]);
  check(!fake.markdown.includes("| --- |"), "tabel: daftar huruf berspasi lebar bukan tabel");
  const two = build(["Pasal 1\nKata   kata\nlagi   lagi"]);
  check(!two.markdown.includes("| --- |"), "tabel: 2 baris saja bukan tabel");
  const pipe = build(["Pasal 1\nA   B   C\nx|y   2   3\nq   w   e"]);
  check(pipe.markdown.includes("x\\|y"), "tabel: tanda | di dalam sel di-escape");
  const irregular = build(["Pasal 1\nA   B   C\nd   e\nf   g   h   i\nj   k   l\nm   n"]);
  check(irregular.markdown.includes("```text"), "tabel: sangat tak beraturan -> blok teks, isi tidak hilang");
}

// ---- Penjelasan, Bagian, Paragraf
{
  const r = build([
    "BAB II\nPENDAFTARAN\n\nBagian Kesatu\nUmum\n\nParagraf 1\nPermohonan\n\nPasal 4\nIsi.\n\nPENJELASAN\nATAS\nUNDANG-UNDANG NOMOR 1 TAHUN 2020\nTENTANG\nHAL INI\n\nI. UMUM\nUmum saja.\nII. PASAL DEMI PASAL\n\nPasal 4\nCukup jelas."
  ]);
  const md = r.markdown;
  check(/^### Bagian Kesatu — Umum$/m.test(md) && /^#### Paragraf 1 — Permohonan$/m.test(md), "struktur: Bagian & Paragraf dengan judul");
  check(/^##### Pasal 4$/m.test(md), "struktur: Pasal di bawah Paragraf = tingkat 5");
  check(/^## PENJELASAN ATAS UNDANG-UNDANG NOMOR 1 TAHUN 2020 TENTANG HAL INI$/m.test(md), "penjelasan: judul digabung");
  check(/^#### Pasal 4 \(Penjelasan\)$/m.test(md), "penjelasan: Pasal diberi label agar tak tertukar dengan batang tubuh");
  check(r.stats.pasal === 1, "penjelasan: tidak menggandakan hitungan Pasal");
}

// ---- catatan mutu
{
  const r = build(["Teks bebas tanpa pasal."], { badPages: [1], ocrPages: 1 });
  check(r.markdown.includes("Tidak ditemukan judul 'Pasal'") && r.markdown.includes("OCR") && r.markdown.includes("Teks berantakan"), "catatan: peringatan mutu masuk kepala");
  check(r.markdown.includes("Teks bebas tanpa pasal."), "catatan: teks tak berstruktur tetap dipertahankan");
}
check(build([""]).markdown.includes("judul:"), "kosong: tidak error");

// ---- markdown -> halaman untuk indeks
{
  const r = build(["Pasal 1\nSatu.", "Pasal 2\nDua."]);
  const pages = markdownToPages(r.markdown);
  check(pages.length === 3 || pages.length === 2, "balik: dipecah per penanda halaman");
  check(pages.some((p) => p.page === 2 && p.text.includes("Pasal 2")) && !pages.some((p) => /^---/.test(p.text)), "balik: kepala YAML tidak ikut diindeks");
  check(markdownTitle(r.markdown) === r.title, "balik: judul dari kepala");
  check(markdownTitle("# Judul Tangan\n\nisi") === "Judul Tangan", "balik: judul dari # pertama bila tanpa kepala");
  check(markdownToPages("tanpa penanda\nsaja")[0].page === null, "balik: md tulisan tangan tanpa penanda -> satu halaman");
}

// ---- PDF nyata lewat pdftotext (dilewati bila alat tidak ada)
{
  let raw = null;
  try {
    raw = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", new URL("./test-fixtures/peraturan.pdf", import.meta.url).pathname, "-"], { encoding: "utf8" });
  } catch {
    console.log("lewati: pdftotext tidak terpasang, tes PDF nyata dilewati");
  }
  if (raw) {
    const parts = raw.split("\f");
    if (parts[parts.length - 1].trim() === "") parts.pop();
    const r = buildRegulationMarkdown(parts.map((text, i) => ({ page: i + 1, text })), { filename: "peraturan.pdf", now: NOW });
    const md = r.markdown;
    check(r.meta.nomor === "12" && r.meta.tahun === 2020 && r.meta.jenis === "Peraturan Menteri Keuangan", "PDF nyata: metadata");
    check(r.stats.bab === 2 && r.stats.bagian === 1 && r.stats.pasal === 4 && r.stats.tabel === 1, "PDF nyata: 2 BAB, 1 Bagian, 4 Pasal, 1 tabel");
    check(!md.includes("www.peraturan.go.id") && !/^- ?\d ?-$/m.test(md) && !/PRESIDEN/.test(md), "PDF nyata: header, footer, URL bersih");
    check(md.includes("  - b. perjalanan dinas pindah."), "PDF nyata: butir yang menyambung ke halaman berikutnya tetap di daftar yang sama");
    check(/^- a\. bahwa untuk tertib administrasi perjalanan dinas, perlu mengatur standar biaya;$/m.test(md), "PDF nyata: Menimbang a. jadi butir");
    check(md.includes("| 3 | DI Yogyakarta | 420.000 | 170.000 |"), "PDF nyata: baris tabel utuh");
    check(/^#### Pasal 3 \(Penjelasan\)$/m.test(md), "PDF nyata: Penjelasan");
    check(md.includes("PERJALANAN DINAS DALAM NEGERI BAGI PEJABAT NEGARA") && /^## PENJELASAN ATAS/m.test(md), "PDF nyata: judul Penjelasan lengkap");
  }
}

if (fails) {
  console.log(`\n${fails} GAGAL`);
  process.exit(1);
}
console.log("\nsemua ok");
