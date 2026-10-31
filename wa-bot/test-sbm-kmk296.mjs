// Tes pencarian SBM KMK 296/2026 (sbm-kmk296.js) dengan data ASLI data/kmk-296-2026/.
//   node test-sbm-kmk296.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSbmKmk296, isCostQuestion, isRuleQuestion, tokenize, KMK296_TITLE } from "./sbm-kmk296.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const s = createSbmKmk296({ dir: path.join(here, "data", "kmk-296-2026") });
const ctx = (q) => s.contextFor(q);
const text = (q) => ctx(q).chunks.map((c) => c.text).join("\n");

// ---- pemuatan data
check(s.stats.rows === 8207, `8.207 baris dimuat (${s.stats.rows})`);
check(s.stats.sections >= 20, `bagian penjelasan dimuat (${s.stats.sections})`);
check(tokenize("Berapa, HONOR-nya?!").includes("honorarium"), "normalisasi huruf kecil, tanda baca dibuang, alias honor -> honorarium");

// ---- 10 pertanyaan dengan jawaban yang diketahui (dari data resmi)
const known = [
  ["berapa honorarium kuasa pengguna anggaran nilai pagu s.d. Rp1 miliar", "Rp630.000 per OB (Orang/Bulan)", "Kode 1.1.1", "Halaman 3"],
  ["honorarium kuasa pengguna anggaran pagu di atas Rp1 miliar s.d. Rp10 miliar", "Rp1.180.000", "Kode 1.1.2", "Halaman 3"],
  ["uang harian perjalanan dinas luar kota Aceh", "Rp360.000 per OH (Orang/Hari)", "Kode 25.1.1", "Halaman 23"],
  ["uang harian luar kota Bali", "Rp480.000 per OH", "Kode 25.1.17", "Halaman 23"],
  ["uang harian diklat Bali", "Rp140.000 per OH", "Kode 25.1.17", "Halaman 23"],
  ["honorarium narasumber pejabat eselon I", "Rp1.400.000 per OJ (Orang/Jam)", "Kode 9.1.2", "Halaman 6"],
  ["honorarium narasumber eselon II", "Rp1.000.000 per OJ", "Kode 9.1.3", "Halaman 6"],
  ["honor narasumber eselon III ke bawah", "Rp900.000 per OJ", "Kode 9.1.4", "Halaman 6"],
  ["honorarium pembuat artikel jurnal", "Rp200.000 per Per Halaman", "Kode", "Halaman 16"],
  ["honorarium pembimbing kuliah kerja nyata KKN", "Rp600.000 per OK (Orang/Kali)", "Kode 11.3.8.1", "Halaman 14"]
];
for (const [q, ...parts] of known) {
  const r = ctx(q);
  const t = text(q);
  check(r.kind === "angka" && r.chunks[0]?.title === KMK296_TITLE && parts.every((p) => t.includes(p)), `"${q}" -> ${parts.join(" | ")}`);
}
{
  const n = text("uang harian luar kota Aceh").split("\n").filter((l) => l.startsWith("- KMK 296/2026")).length;
  check(n >= 5 && n <= 8, `5-8 baris teratas disisipkan (${n})`);
  check(text("uang harian luar kota Aceh").includes("belum bisa memastikan"), "aturan menjawab ikut disisipkan (kutip persis, jangan mengarang)");
}

// ---- tanpa jawaban
{
  const none = ctx("berapa uang harian astronot di bulan zzyzx");
  check(none.kind === "angka" && /Tidak ada baris data KMK 296\/2026 yang cocok/.test(none.chunks[0].text) && /belum bisa memastikan/.test(none.chunks[0].text) && !/Rp\d/.test(none.chunks[0].text), "tanpa baris cocok -> pesan 'tidak ada' + 'belum bisa memastikan', tanpa angka");
}

// ---- pertanyaan non-biaya tidak memicu pencarian
for (const q of ["apa kabar hari ini", "tolong buatkan puisi tentang hujan", "jam berapa sholat dzuhur", "biaya kuliah anak saya berapa", "aturan main kartu remi"]) {
  const r = ctx(q);
  check(r.kind === null && r.chunks.length === 0, `tidak memicu: "${q}"`);
}
check(isCostQuestion("tarif honorarium") && !isCostQuestion("selamat pagi"), "isCostQuestion");
check(isRuleQuestion("aturan standar biaya yang dapat dilampaui") && !isRuleQuestion("aturan main kartu"), "isRuleQuestion");

// ---- pertanyaan aturan -> penjelasan.md
{
  const r = ctx("apa ketentuan standar biaya masukan yang dapat dilampaui");
  check(r.kind === "aturan" && r.chunks[0].title === KMK296_TITLE && /\[Halaman \d+\]/.test(r.chunks[0].text) && !/Rp\d/.test(r.chunks[0].text.split("\n")[0]), "pertanyaan ketentuan memakai teks penjelasan, bukan baris angka");
  const r2 = ctx("berapa tarif honorarium narasumber");
  check(r2.kind === "angka", "kata 'berapa/tarif' tetap jalur angka");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua lolos.");
