// Tes pengubah teks PDF hasil belajar (src/study-text.js).
//   node test-study-text.mjs
import { pdfSafeText, studyPdfFileName, studyCardFileName, splitFences, materialBlocks, materialPdfFileName, pointsFormula } from "../src/study-text.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const eq = (a, b, m) => { const c = a === b; if (!c) console.log("   dapat:", JSON.stringify(a), "\n   harap:", JSON.stringify(b)); check(c, m); };

eq(pdfSafeText("Jika Nilai $\\ge 80$ maka $A \\rightarrow B$."), "Jika Nilai >= 80 maka A -> B.", "LaTeX inline: \\ge dan \\rightarrow");
eq(pdfSafeText("Hasil $\\frac{3}{4} + \\frac{1}{4} = 1$"), "Hasil (3)/(4) + (1)/(4) = 1", "LaTeX: pecahan");
eq(pdfSafeText("$$x = \\sqrt{16} = 4$$"), "x = akar(16) = 4", "LaTeX blok: akar");
eq(pdfSafeText("Luas = $\\pi r^{2}$ dan $a_{1}$"), "Luas = pi r^(2) dan a_(1)", "LaTeX: pi, pangkat, indeks");
eq(pdfSafeText("x² + y² ≥ √16 → ∞"), "x² + y² >= akar 16 -> tak hingga", "Unicode matematika dipetakan (² tetap karena ada di Latin-1)");
eq(pdfSafeText("Harganya $5 dan $10 saja"), "Harganya $5 dan $10 saja", "uang tidak dianggap rumus");
eq(pdfSafeText("Bacaan: بِسْمِ اللَّهِ الرَّحْمَٰنِ ini"), "Bacaan: [teks Arab] ini", "teks Arab -> penanda");
eq(pdfSafeText("Rumus α + β = γ"), "Rumus alfa + beta = gamma", "huruf Yunani -> nama");
eq(pdfSafeText("Dia berkata “halo” — ya…"), 'Dia berkata "halo" - ya...', "tanda kutip dan strip tipografis -> ASCII");
eq(pdfSafeText("**Tebal** dan `kode` serta [tautan](https://a.id)"), "Tebal dan kode serta tautan (https://a.id)", "markdown dibersihkan");
eq(pdfSafeText("Emoji 😀 hilang, é tetap"), "Emoji hilang, é tetap", "emoji dibuang, Latin-1 dipertahankan");
eq(pdfSafeText(null), "", "null -> kosong");
check(!/[^\n\t -~ -ÿ]/.test(pdfSafeText("a​b\u0007c ∮ ⊕ 中文")), "keluaran hanya berisi karakter Latin-1");
check(studyPdfFileName("Ali Ünal", "IPA (Sains)", new Date("2026-10-12T05:00:00Z")) === "Hasil_Ali_Unal_IPA_Sains_2026-10-12.pdf", "nama berkas aman");
check(studyPdfFileName("", "", new Date("2026-10-12T05:00:00Z")) === "Hasil_pemain_pelajaran_2026-10-12.pdf", "nama berkas bawaan");

// ---- materi: Markdown -> blok PDF
check(materialPdfFileName("IPA (Sains)", "Siklus Air: Hujan & Awan", new Date("2026-10-12T05:00:00Z")) === "Materi_IPA_Sains_Siklus_Air_Hujan_Awan_2026-10-12.pdf", "nama berkas materi aman");
check(materialPdfFileName("", "", new Date("2026-10-12T05:00:00Z")) === "Materi_pelajaran_materi_2026-10-12.pdf", "nama berkas materi bawaan");
{
  const md = "## Tujuan\n- paham $a^2+b^2=c^2$\n- bisa **menghitung**\n\n### Sub\nBaris satu\nbaris dua.\n\n1. langkah\n   - bersarang\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nkode √\n```\n> kutipan\n---\nAkhir";
  const b = materialBlocks(md);
  const types = b.map((x) => x.type).join(",");
  check(types === "h2,li,li,h3,p,li,li,table,table,code,quote,p", "urutan jenis blok: " + types);
  check(b[1].text === "paham a^2+b^2=c^2" && b[2].text === "bisa menghitung", "markdown & LaTeX di butir dirapikan");
  check(b[4].text === "Baris satu baris dua.", "baris berurutan digabung jadi satu paragraf");
  check(b[5].num === "1" && b[6].level === 1, "daftar bernomor dan bersarang");
  check(b[7].text === "a | b" && b[8].text === "1 | 2", "tabel jadi baris, pemisah |---| dibuang");
  check(b[9].text === "kode ?", "kode: karakter non-Latin-1 diganti ?");
  check(materialBlocks("").length === 0 && materialBlocks(null).length === 0, "kosong -> tanpa blok");
  check(materialBlocks("# Judul\nIsi").map((x) => x.type).join(",") === "h2,p", "H1 diperlakukan sebagai judul bagian");
  check(materialBlocks("```\ntanpa penutup").map((x) => x.type).join(",") === "code", "code fence tanpa penutup tetap diproses");
}

{
  const L = (k, v = {}) => ({
    study_formula_new: "Poin = {perq} x {correct} benar x {weight}%",
    study_formula_bonus: "x {b}% (bonus)",
    study_formula_class: "x {p}% (kelas)",
    study_pdf_formula: "Poin = {base} x {correct}/{total} x {weight}%"
  })[k].replace(/\{(\w+)\}/g, (_m, n) => v[n]);
  eq(pointsFormula({ perQuestionPoints: 10, correct: 8, total: 10, weightPercent: 100, bonusPercent: 0 }, L), "Poin = 10 x 8 benar x 100%", "rumus baru tanpa bonus");
  eq(pointsFormula({ perQuestionPoints: 10, correct: 10, total: 10, weightPercent: 120, bonusPercent: 10 }, L), "Poin = 10 x 10 benar x 120% x 110% (bonus)", "rumus baru dengan bonus sempurna");
  eq(pointsFormula({ perQuestionPoints: 10, correct: 8, total: 10, weightPercent: 100, bonusPercent: 0, classPercent: 120 }, L), "Poin = 10 x 8 benar x 100% x 120% (kelas)", "rumus memuat bobot kelas bila bukan 100%");
  eq(pointsFormula({ perQuestionPoints: 10, correct: 8, total: 10, weightPercent: 100, bonusPercent: 0, classPercent: 100 }, L), "Poin = 10 x 8 benar x 100%", "bobot kelas 100% tidak ditampilkan");
  eq(pointsFormula({ perQuestionPoints: null, basePoints: 100, correct: 8, total: 10, weightPercent: 100 }, L), "Poin = 100 x 8/10 x 100%", "pelajaran lama memakai rumus lama");
}

{
  const d = new Date("2026-10-12T05:00:00Z");
  eq(studyCardFileName("Ali Ünal", "IPA (Sains)", d), "Kartu_Ali_Unal_IPA_Sains_2026-10-12.png", "nama berkas kartu gambar");
  eq(studyCardFileName("", "", d), "Kartu_hasil_pelajaran_2026-10-12.png", "nama berkas kartu bawaan");
  const parts = splitFences("Perhatikan kode:\n```vb\nFor i = 1 To 3\n    Console.WriteLine(i)\nNext\n```\nApa keluarannya?");
  eq(parts.map((x) => x.type).join(","), "text,code,text", "splitFences: teks, kode, teks");
  eq(parts[1].text, "For i = 1 To 3\n    Console.WriteLine(i)\nNext", "splitFences: kode tetap berbaris + berindentasi");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
