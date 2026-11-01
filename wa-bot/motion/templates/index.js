// Daftar templat dan pemilihan templat per hari. Shorts fakta: satu hari satu templat, jadi tampilan channel berganti-ganti.
// Templat berjalur "pelajaran" (kuis, hitung, pola) tersedia sebagai tambahan di luar rotasi harian.
import fakta from "./fakta-angka.js";
import peringkat from "./peringkat.js";
import mitos from "./mitos-fakta.js";
import bar from "./perbandingan-bar.js";
import proses from "./proses-tahapan.js";
import waktu from "./garis-waktu.js";
import cerita from "./cerita-fakta.js";
import kuis from "./kuis-kilat.js";
import hitung from "./hitung-langkah.js";
import pola from "./pola-angka.js";
import pi from "./lingkaran-pi.js";
import { THEMES } from "../engine.js";
import { GAYA } from "../penjelas-gaya.js";

// Rotasi harian memakai versi BERGAMBAR (penjelas-gaya.js, id sama). Versi teks lama tetap ada dengan akhiran "-teks" sebagai cadangan
// (dipakai bila AI gagal menyusun adegan bergambar) dan berada di luar rotasi (hari = null).
const LAMA = [fakta, peringkat, mitos, bar, proses, waktu, cerita];
const BERGAMBAR = GAYA.map((g) => ({ ...g, musik: LAMA.find((l) => l.id === g.id).musik }));
const TEKS = LAMA.map((t) => ({ ...t, id: `${t.id}-teks`, nama: `${t.nama} (teks)`, hari: null }));
export const SEMUA = [...BERGAMBAR, ...TEKS, kuis, hitung, pola, pi];
export const HARIAN = SEMUA.filter((t) => t.hari !== null);
export const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function ambilTemplat(id) {
  const t = SEMUA.find((x) => x.id === id);
  if (!t) throw new Error(`Templat tidak dikenal: ${id}`);
  return t;
}
/** Templat Shorts untuk sebuah tanggal (Date atau "YYYY-MM-DD"), berdasarkan hari dalam pekan. */
export function templatUntuk(tanggal) {
  const d = tanggal instanceof Date ? tanggal : new Date(`${tanggal}T12:00:00`);
  return HARIAN.find((t) => t.hari === d.getDay());
}
/**
 * Warna tema berputar tiap pekan: templat yang sama tampil dengan warna berbeda dari pekan ke pekan,
 * tetapi dalam satu pekan tiap hari tetap berwarna beda. Mengembalikan nama tema (kunci THEMES).
 */
export function temaMinggu(templat, tanggal) {
  const d = tanggal instanceof Date ? tanggal : new Date(`${tanggal}T12:00:00`);
  const hariKe = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  const minggu = Math.floor((hariKe + 3) / 7); // pekan mulai Senin
  const kunci = Object.keys(THEMES), i = kunci.indexOf(templat.tema);
  return kunci[(i + minggu) % kunci.length];
}
