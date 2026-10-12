// Tes pengubah teks PDF hasil belajar (src/study-text.js).
//   node test-study-text.mjs
import { pdfSafeText, studyPdfFileName } from "../src/study-text.js";

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

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
