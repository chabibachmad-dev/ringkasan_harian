// Pembersih teks hasil ekstraksi PDF.
//
// Sel tabel yang rata-kanan-kiri (justified) sering diekstrak sebagai huruf terpisah-pisah:
// "B A N T E N", "P A P U A", "A C E H". Pencarian "banten"/"papua" lalu tidak menemukan barisnya
// (dan model menjawab "tidak ada di dokumen" atau memakai baris lain). Di sini rangkaian >= 3 huruf KAPITAL
// yang dipisah 1-2 spasi disatukan kembali. Jarak antarkolom tabel biasanya >= 3 spasi, jadi tidak ikut tergabung.
const SPACED_RE = /(?<![\p{L}\p{N}])(?=\p{Script=Latin})\p{Lu}(?: {1,2}\p{Lu}){2,}(?![\p{L}\p{N}])/gu;

export function despaceLetters(text) {
  return String(text || "").replace(SPACED_RE, (m) => m.replace(/ +/g, ""));
}

// Buang "sampah" yang berulang di setiap halaman hasil unduhan JDIH/peraturan.go.id dan perbaiki salah-baca OCR umum.
//   - URL penanda air (http://www.jdih.kemenkeu.go.id/fullText/...) dan "SK No 115576 A" di kaki halaman;
//   - "4,5o/o" (OCR atas "4,5%") -> "4,5%".
export function cleanBoilerplate(text) {
  return String(text || "")
    .replace(/https?:\/\/(?:www\.)?(?:jdih|peraturan|bpk)\.[^\s]*/gi, "")
    .replace(/\bSK No \d{5,}\s*[A-Z]?(?![A-Za-z])/g, "")
    .replace(/(\d)\s?o\/o(?![A-Za-z])/gi, "$1%")
    .replace(/[ \t]{2,}$/gm, "");
}

// Penilaian mutu teks satu halaman (hasil pdftotext/OCR): teks berantakan membuat model
// bingung dan memicu halusinasi. Mengembalikan { bad, score, reason }; score 0 = bersih,
// makin besar makin berantakan. Halaman pendek (< 60 huruf) tidak dinilai.
// Kata fungsi paling umum (Indonesia + Inggris). Teks normal selalu memuat ±20-40% kata seperti ini;
// lapisan teks hasil scan yang rusak ("yarg", "dar", "unluk"…) hampir tak memuatnya sama sekali.
const COMMON_WORDS = new Set(
  (
    "yang dan di ke dari untuk dengan pada adalah ini itu atau juga dalam akan sudah telah oleh sebagai karena agar " +
    "bagi para tidak dapat harus tersebut bahwa kepada serta jika maka tentang atas dalam ada bukan lebih setiap " +
    "the and of to in is are for with on at by be as it this that or not from was were has have an a"
  ).split(/\s+/)
);

export function assessPageText(text) {
  const s = despaceLetters(String(text || "")); // "B A N T E N" di sel tabel bukan tanda teks rusak
  const letters = (s.match(/\p{Script=Latin}/gu) || []).length;
  if (letters < 60) return { bad: false, score: 0, reason: null };
  const nonSpace = s.replace(/\s+/g, "");
  const junk = (s.match(/[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000E-\u001F]/g) || []).length;
  const odd = (nonSpace.match(/[^\p{L}\p{M}\p{N}.,;:()\-/%'"?!&@+=\[\]•–—_*#°…،؛؟]/gu) || []).length;
  const tokens = s.split(/\s+/).filter(Boolean);
  // Hanya kata beraksara LATIN yang dinilai (kata Arab/aksara lain tak punya huruf hidup Latin: bukan tanda rusak).
  const words = tokens.filter((w) => /^\p{Script=Latin}{4,}$/u.test(w) && w !== w.toUpperCase());
  const noVowel = words.filter((w) => !/[aeiouáéíóúàèìòùâêîôûäëïöü]/i.test(w)).length;
  const singles = tokens.filter((w) => /^\p{Script=Latin}$/u.test(w)).length;

  const junkRatio = junk / Math.max(1, nonSpace.length);
  const oddRatio = odd / Math.max(1, nonSpace.length);
  const noVowelRatio = words.length >= 20 ? noVowel / words.length : 0;
  const singleRatio = tokens.length >= 30 ? singles / tokens.length : 0;

  // Cakupan kata umum: hanya dinilai bila ada cukup kata Latin (>= 50) supaya tabel/daftar nama tidak keliru.
  const alpha = tokens.map((w) => w.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter((w) => /^\p{Script=Latin}{2,}$/u.test(w));
  const common = alpha.filter((w) => COMMON_WORDS.has(w)).length;
  // Halaman tabel/angka (>= 25% baris berisi >= 3 angka) memang miskin kata umum: tidak dinilai dengan ukuran ini.
  const lines = s.split("\n").filter((l) => l.trim());
  const numericLines = lines.filter((l) => (l.match(/\d[\d.,]*/g) || []).length >= 3).length;
  const tabular = lines.length >= 6 && numericLines / lines.length >= 0.25;
  const commonRatio = alpha.length >= 50 && !tabular ? common / alpha.length : 1;

  const parts = [
    { v: 0.05 / Math.max(commonRatio, 0.01), why: "hampir tak ada kata umum (teks tampak rusak)" },
    { v: junkRatio / 0.01, why: "karakter rusak" },
    { v: oddRatio / 0.25, why: "banyak simbol aneh" },
    { v: noVowelRatio / 0.3, why: "kata tanpa huruf hidup" },
    { v: singleRatio / 0.4, why: "huruf terpisah-pisah" }
  ];
  const worst = parts.reduce((m, p) => (p.v > m.v ? p : m));
  return { bad: worst.v >= 1, score: Number(worst.v.toFixed(2)), reason: worst.v >= 1 ? worst.why : null };
}

