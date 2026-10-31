// Pembantu validasi isi templat. Semua fungsi menambah pesan ke array `gal` bila isi tidak layak.
import { potong } from "../engine.js";

export function S(raw, k, maks, gal, wajib = true) {
  const v = raw?.[k];
  if (v == null || String(v).trim() === "") { if (wajib) gal.push(`"${k}" kosong`); return ""; }
  return potong(v, maks);
}
export function L(raw, k, min, maks, maksLen, gal) {
  const a = raw?.[k];
  if (!Array.isArray(a)) { gal.push(`"${k}" harus berupa daftar`); return []; }
  const h = a.map((x) => potong(x, maksLen)).filter(Boolean);
  if (h.length < min) gal.push(`"${k}" minimal ${min} butir`);
  return h.slice(0, maks);
}
export function N(raw, k, gal) {
  const v = Number(String(raw?.[k]).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(v)) { gal.push(`"${k}" bukan angka`); return 0; }
  return v;
}
export function hasil(isi, gal) { return gal.length ? { ok: false, galat: gal, isi: null } : { ok: true, galat: [], isi }; }
