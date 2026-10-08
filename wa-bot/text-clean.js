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
