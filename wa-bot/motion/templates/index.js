// Daftar templat dan pemilihan templat per hari. Satu hari satu templat, jadi tampilan channel berganti-ganti.
import kuis from "./kuis-kilat.js";
import hitung from "./hitung-langkah.js";
import fakta from "./fakta-angka.js";
import bar from "./perbandingan-bar.js";
import proses from "./proses-tahapan.js";
import mitos from "./mitos-fakta.js";
import pola from "./pola-angka.js";
import pi from "./lingkaran-pi.js";

export const SEMUA = [kuis, hitung, fakta, bar, proses, mitos, pola, pi];
export const HARIAN = SEMUA.filter((t) => t.hari !== null);
export const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function ambilTemplat(id) {
  const t = SEMUA.find((x) => x.id === id);
  if (!t) throw new Error(`Templat tidak dikenal: ${id}`);
  return t;
}
/** Templat untuk sebuah tanggal (Date atau "YYYY-MM-DD"), berdasarkan hari dalam pekan. */
export function templatUntuk(tanggal) {
  const d = tanggal instanceof Date ? tanggal : new Date(`${tanggal}T12:00:00`);
  const hari = d.getDay();
  return HARIAN.find((t) => t.hari === hari);
}
