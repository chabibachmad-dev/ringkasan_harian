// Membuat isi video dari topik: prompt JSON ke AI, validasi per templat, pemeriksaan hitungan, coba ulang.
// `llm` = fungsi async (prompt:string) => string. Pasang dari router AI yang sudah ada di bot.
import { ambilTemplat } from "./templates/index.js";
import { potong } from "./engine.js";

const HOOK_DEFAULT = {
  "kuis-kilat": "Kuis kilat! Siap?", "hitung-langkah": "Bisa hitung ini?", "fakta-angka": "Tahukah kamu?",
  "perbandingan-bar": "Siapa paling hebat?", "proses-tahapan": "Pernah penasaran?", "mitos-fakta": "Mitos atau fakta?",
  "pola-angka": "Tebak angka berikutnya!", "lingkaran-pi": "Kenapa π hampir 3,14?"
};

/** Ambil objek JSON pertama dari balasan AI (boleh dibungkus ```json ... ```). */
export function ekstrakJson(teks) {
  const s = String(teks ?? "");
  const pagar = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const sumber = pagar ? pagar[1] : s;
  const awal = sumber.search(/[\[{]/); if (awal < 0) throw new Error("tidak ada JSON");
  const buka = sumber[awal], tutup = buka === "{" ? "}" : "]";
  let dalam = 0, str = false, esc = false;
  for (let i = awal; i < sumber.length; i++) {
    const c = sumber[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === buka) dalam++; else if (c === tutup && --dalam === 0) return JSON.parse(sumber.slice(awal, i + 1));
  }
  throw new Error("JSON tidak lengkap");
}

export function promptIsi({ templatId, topik, kelas = "SD kelas 1-6" }) {
  const t = ambilTemplat(templatId);
  return [
    `Kamu penulis konten edukasi Short YouTube berbahasa Indonesia untuk anak ${kelas}.`,
    `Topik hari ini: "${topik}". Format video: "${t.nama}".`,
    `Balas HANYA dengan satu objek JSON (tanpa teks lain, tanpa markdown) berbentuk:`,
    t.petunjukIsi,
    `Tambahkan dua kolom di objek yang sama: "hook" (kalimat pancingan 3-6 kata, maks 38 huruf, memancing rasa penasaran, tanpa emoji) dan "dasar" (satu kalimat: dasar/sumber fakta atau rumus yang dipakai, untuk dicek pemilik).`,
    `Aturan: bahasa Indonesia baku yang santai dan mudah dipahami anak; kalimat pendek; fakta dan angka HARUS benar dan dapat diverifikasi, jangan mengarang angka; kalau kamu tidak yakin pada sebuah angka, pakai angka yang lebih umum atau topik lain yang kamu yakini; semua hitungan harus benar; jangan memakai emoji; jangan menyebut merek atau tokoh nyata.`
  ].join("\n");
}

// ---------- pemeriksaan hitungan deterministik ----------
const OPS = { "+": (a, b) => a + b, "-": (a, b) => a - b, "−": (a, b) => a - b, "×": (a, b) => a * b, "x": (a, b) => a * b, "*": (a, b) => a * b, "÷": (a, b) => a / b, "/": (a, b) => a / b, ":": (a, b) => a / b };
const angka = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));
/** "24 ÷ 4 = 6" -> true/false; null bila bentuknya tidak dikenali (tidak diperiksa). */
export function cekSatuHitungan(ekspresi) {
  const m = String(ekspresi).replace(/\s+/g, " ").trim().match(/^(-?[\d.,]+) ?([+\-−×x*÷/:]) ?(-?[\d.,]+) ?= ?(-?[\d.,]+)$/);
  if (!m) return null;
  const [a, op, b, c] = [angka(m[1]), m[2], angka(m[3]), angka(m[4])];
  const r = OPS[op](a, b); return Math.abs(r - c) < 1e-9 * Math.max(1, Math.abs(c)) + 1e-9;
}
/** Verifikasi aturan deret sederhana: "+3", "-2", "×2", "÷2". null bila aturan tidak dikenali. */
export function cekPola(deret, aturan, berikutnya) {
  const m = String(aturan).replace(/\s+/g, "").match(/^([+\-−×x*÷/])(-?[\d.,]+)$/); if (!m) return null;
  const f = OPS[m[1]], k = angka(m[2]), d = [...deret, berikutnya].map(angka); if (d.some((x) => !Number.isFinite(x))) return null;
  for (let i = 1; i < d.length; i++) if (Math.abs(f(d[i - 1], k) - d[i]) > 1e-9) return false;
  return true;
}
/** Pemeriksaan khusus templat; mengembalikan daftar galat (kosong = lolos). */
export function periksaIsi(templatId, isi) {
  const gal = [];
  if (templatId === "hitung-langkah") isi.langkah.forEach((l, i) => { if (cekSatuHitungan(l.ekspresi) === false) gal.push(`langkah ${i + 1}: hitungan salah ("${l.ekspresi}")`); });
  if (templatId === "pola-angka" && cekPola(isi.deret, isi.aturan, isi.berikutnya) === false) gal.push("deret tidak sesuai aturan");
  if (templatId === "kuis-kilat") { const j = isi.pilihan[isi.jawaban]; if (new Set(isi.pilihan.map((p) => p.toLowerCase())).size !== isi.pilihan.length) gal.push("ada pilihan kembar"); if (!j) gal.push("jawaban tidak ada"); }
  return gal;
}

/**
 * Minta AI membuat isi, validasi, ulang bila perlu (galat dikirim balik ke AI).
 * Mengembalikan { isi, hook, dasar, narasi, percobaan }. Melempar Error bila semua percobaan gagal.
 */
export async function buatIsi({ llm, templatId, topik, kelas, maksCoba = 3 }) {
  const t = ambilTemplat(templatId);
  let prompt = promptIsi({ templatId, topik, kelas }), galTerakhir = [];
  for (let n = 1; n <= maksCoba; n++) {
    let mentah;
    try { mentah = ekstrakJson(await llm(prompt)); } catch (e) { galTerakhir = [`balasan bukan JSON valid (${e.message})`]; prompt += `\n\nPERBAIKI: ${galTerakhir[0]}. Balas hanya JSON.`; continue; }
    const r = t.rapikan(mentah);
    const gal = r.ok ? periksaIsi(templatId, r.isi) : r.galat;
    if (gal.length === 0) {
      const hook = potong(mentah.hook || HOOK_DEFAULT[templatId] || "Tahukah kamu?", 38);
      return { isi: r.isi, hook, dasar: potong(mentah.dasar || "", 160), narasi: t.narasi(r.isi), percobaan: n };
    }
    galTerakhir = gal; prompt += `\n\nPERBAIKI, jawaban sebelumnya bermasalah: ${gal.join("; ")}. Balas hanya JSON yang sudah benar.`;
  }
  throw new Error(`Gagal membuat isi (${templatId}): ${galTerakhir.join("; ")}`);
}
export { HOOK_DEFAULT };
