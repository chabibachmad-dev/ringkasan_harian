// Gambar pixel di kanvas 2D (bisa dipakai di browser maupun @napi-rs/canvas): tabel periodik, kartu unsur, kartu hasil racik.
// Semua fungsi hanya memakai ctx.fillRect/fillStyle, jadi hasilnya tajam dan sama di semua perangkat.
import { UNSUR, KATEGORI } from "./data.js";
import { gambarTeks, gambarRumus, ukurTeks, skalaMuat, bungkus, TINGGI_HURUF } from "./font.js";
import { gelapkan } from "./core.js";

export const WARNA = { latar: "#1b1b2f", panel: "#2a2a4a", panel2: "#34345e", tinta: "#1b1b2f", teks: "#f4f1de", redup: "#9aa0c8", merah: "#ff8787", hijau: "#8ce99a", kuning: "#ffd43b", biru: "#74c0fc" };

export const TEKS_RENDER = {
  id: {
    judulTabel: "TABEL PERIODIK", subTabel: "118 unsur kimia", unsurKimia: "UNSUR KIMIA",
    nomorAtom: "NOMOR ATOM", massaAtom: "MASSA ATOM", periodeGolongan: "PERIODE / GOLONGAN", kategori: "KATEGORI", wujud: "WUJUD PADA SUHU KAMAR",
    radioaktif: "Unsur radioaktif", tidakRadioaktif: "Tidak radioaktif", blokF: "blok-f",
    padat: "Padat", cair: "Cair", gas: "Gas", "tak-diketahui": "Belum diketahui",
    nyata: "SENYAWA NYATA", fiksi: "ZAT KHAYALAN", unsur: "UNSUR", warna: "Warna", massaRumus: "Massa rumus", proton: "Jumlah proton", kode: "Kode", simbol: "Simbol",
    bahaya: "Berbahaya di dunia nyata. Jangan dicoba di rumah; hanya ahli di laboratorium.",
    footNyata: "Hasil simulasi, bukan resep percobaan.", footFiksi: "Zat khayalan dari permainan, tidak ada di dunia nyata.", footUnsur: "Laboratorium Kimia",
    catatanMassa: "( ) = nomor massa isotop paling stabil", kelipatan: "kali", wujudLabel: "Wujud",
  },
  en: {
    judulTabel: "PERIODIC TABLE", subTabel: "118 chemical elements", unsurKimia: "CHEMICAL ELEMENT",
    nomorAtom: "ATOMIC NUMBER", massaAtom: "ATOMIC MASS", periodeGolongan: "PERIOD / GROUP", kategori: "CATEGORY", wujud: "STATE AT ROOM TEMPERATURE",
    radioaktif: "Radioactive element", tidakRadioaktif: "Not radioactive", blokF: "f-block",
    padat: "Solid", cair: "Liquid", gas: "Gas", "tak-diketahui": "Unknown",
    nyata: "REAL COMPOUND", fiksi: "IMAGINARY SUBSTANCE", unsur: "ELEMENT", warna: "Colour", massaRumus: "Formula mass", proton: "Total protons", kode: "Code", simbol: "Symbol",
    bahaya: "Dangerous in real life. Do not try at home; experts in a laboratory only.",
    footNyata: "A simulation, not an experiment recipe.", footFiksi: "An imaginary substance from a game, not found in real life.", footUnsur: "Chemistry Lab",
    catatanMassa: "( ) = mass number of the most stable isotope", kelipatan: "x", wujudLabel: "State",
  },
};
const tr = (b) => TEKS_RENDER[b] || TEKS_RENDER.id;
const fmtMassa = (u) => (u.massaTetap ? `(${u.massa})` : String(u.massa));

/** Ubin pixel: sudut dipotong, tepi terang di kiri-atas dan gelap di kanan-bawah. */
export function ubin(ctx, x, y, s, warna, tebal = 2) {
  const t = tebal;
  ctx.fillStyle = warna; ctx.fillRect(x + t, y, s - 2 * t, s); ctx.fillRect(x, y + t, s, s - 2 * t);
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(x + t, y, s - 2 * t, t); ctx.fillRect(x, y + t, t, s - 2 * t);
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(x + t, y + s - t, s - 2 * t, t); ctx.fillRect(x + s - t, y + t, t, s - 2 * t);
}
function panel(ctx, x, y, w, h, warna, t = 4) {
  ctx.fillStyle = warna; ctx.fillRect(x + t, y, w - 2 * t, h); ctx.fillRect(x, y + t, w, h - 2 * t);
}
/** Gambar sprite 16x16 dengan skala bulat. */
export function gambarSprite(ctx, sprite, ox, oy, skala = 8) {
  for (let y = 0; y < sprite.tinggi; y++) for (let x = 0; x < sprite.lebar; x++) {
    const c = sprite.sel[y][x]; if (!c) continue;
    ctx.fillStyle = c; ctx.fillRect(ox + x * skala, oy + y * skala, skala, skala);
  }
}

// ---------- tabel periodik penuh ----------
const T = 40, G = 4, P = T + G, ML = 36, MR = 24, GT = 96;
export const UKURAN_TABEL = { lebar: ML + 18 * P - G + MR, tinggi: 690 };
function yBaris(b) { return b <= 7 ? GT + (b - 1) * P : GT + 7 * P + 20 + (b - 9) * P; }

export function gambarTabel(ctx, bahasa = "id") {
  const { lebar, tinggi } = UKURAN_TABEL, t = tr(bahasa);
  ctx.fillStyle = WARNA.latar; ctx.fillRect(0, 0, lebar, tinggi);
  gambarTeks(ctx, t.judulTabel, Math.floor(lebar / 2), 14, 5, WARNA.teks, "tengah");
  gambarTeks(ctx, t.subTabel, Math.floor(lebar / 2), 58, 2, WARNA.redup, "tengah");
  for (let g = 1; g <= 18; g++) gambarTeks(ctx, String(g), ML + (g - 1) * P + Math.floor(T / 2), 82, 1, WARNA.redup, "tengah");
  for (let p = 1; p <= 7; p++) gambarTeks(ctx, String(p), 16, yBaris(p) + Math.floor((T - TINGGI_HURUF) / 2), 1, WARNA.redup, "tengah");
  for (const u of UNSUR) {
    const x = ML + (u.kolom - 1) * P, y = yBaris(u.baris), w = KATEGORI[u.kategori].warna;
    ubin(ctx, x, y, T, w);
    gambarTeks(ctx, String(u.z), x + 3, y + 3, 1, WARNA.tinta);
    gambarTeks(ctx, u.simbol, x + Math.floor(T / 2), y + 14, 3, WARNA.tinta, "tengah");
  }
  for (const [b, teks, kat] of [[6, "57-71", "lantanida"], [7, "89-103", "aktinida"]]) {
    const x = ML + 2 * P, y = yBaris(b);
    ubin(ctx, x, y, T, gelapkan(KATEGORI[kat].warna, 0.6));
    gambarTeks(ctx, teks, x + Math.floor(T / 2), y + Math.floor((T - TINGGI_HURUF) / 2), 1, WARNA.tinta, "tengah");
  }
  // legenda 3 kolom
  const ks = Object.entries(KATEGORI), kolW = Math.floor((lebar - 2 * 18) / 3);
  ks.forEach(([id, k], i) => {
    const x = 18 + (i % 3) * kolW, y = 538 + Math.floor(i / 3) * 26;
    ubin(ctx, x, y, 16, k.warna, 2);
    gambarTeks(ctx, k.nama[bahasa] || k.nama.id, x + 22, y + 1, 2, WARNA.teks);
  });
  gambarTeks(ctx, t.catatanMassa, 28, 660, 1, WARNA.redup);
}

// ---------- kartu satu unsur ----------
export const UKURAN_KARTU_UNSUR = { lebar: 360, tinggi: 480 };
export function gambarKartuUnsur(ctx, u, bahasa = "id") {
  const { lebar, tinggi } = UKURAN_KARTU_UNSUR, t = tr(bahasa), w = KATEGORI[u.kategori].warna;
  ctx.fillStyle = WARNA.latar; ctx.fillRect(0, 0, lebar, tinggi);
  panel(ctx, 8, 8, lebar - 16, tinggi - 16, WARNA.panel, 6);
  gambarTeks(ctx, t.unsurKimia, lebar / 2, 24, 2, WARNA.redup, "tengah");
  const S = 176, x0 = (lebar - S) / 2, y0 = 48;
  ubin(ctx, x0, y0, S, w, 8);
  gambarTeks(ctx, String(u.z), x0 + 14, y0 + 14, 3, WARNA.tinta);
  gambarTeks(ctx, u.simbol, lebar / 2, y0 + Math.floor((S - 63) / 2) + 8, 9, WARNA.tinta, "tengah");
  const nama = u.nama[bahasa] || u.nama.id;
  gambarTeks(ctx, nama, lebar / 2, 240, skalaMuat(nama, 320, 4), WARNA.teks, "tengah");
  const baris = [
    [t.nomorAtom, String(u.z)],
    [t.massaAtom, fmtMassa(u)],
    [t.periodeGolongan, `${u.periode} / ${u.golongan ?? t.blokF}`],
    [t.kategori, KATEGORI[u.kategori].nama[bahasa] || KATEGORI[u.kategori].nama.id],
    [t.wujud, t[u.wujud]],
  ];
  let y = 280;
  for (const [lab, val] of baris) {
    gambarTeks(ctx, lab, 28, y, 1, WARNA.redup);
    gambarTeks(ctx, val, 28, y + 11, skalaMuat(val, 304, 2), WARNA.teks);
    y += 30;
  }
  gambarTeks(ctx, u.radioaktif ? t.radioaktif : t.tidakRadioaktif, 28, y + 2, 1, u.radioaktif ? WARNA.kuning : WARNA.redup);
}

// ---------- kartu hasil racik ----------
const LEBAR_HASIL = 400;
const stub = { fillRect() {}, set fillStyle(v) {} };
function tataHasil(ctx, h, bahasa, mulai) {
  const t = tr(bahasa), c = LEBAR_HASIL;
  const wTipe = { nyata: WARNA.hijau, fiksi: WARNA.kuning, unsur: WARNA.biru }[h.tipe];
  gambarTeks(ctx, t[h.tipe], c / 2, 22, 2, wTipe, "tengah");
  const sx = (c - 240) / 2;
  if (mulai) panel(ctx, sx, 46, 240, 240, WARNA.panel2, 8);
  if (mulai) gambarSprite(ctx, h.sprite, sx + 8, 54, 14);
  let y = 302;
  const nama = h.nama.id === h.nama.en ? h.nama.id : (h.nama[bahasa] || h.nama.id);
  gambarTeks(ctx, nama, c / 2, y, skalaMuat(nama, 360, 4), WARNA.teks, "tengah"); y += 36;
  gambarRumus(ctx, h.pecah, c / 2, y, 3, WARNA.biru, "tengah", WARNA.kuning); y += 34;
  if (h.kelipatan > 1) { gambarTeks(ctx, `(${h.kelipatan} ${t.kelipatan} ${h.rumusDasar})`, c / 2, y, 2, WARNA.redup, "tengah"); y += 20; }
  y += 6;
  const wujud = t[h.wujud] || h.wujud, warna = h.warnaNama[bahasa] || h.warnaNama.id;
  const info = [[t.wujudLabel, wujud], [t.warna, warna], [t.massaRumus, String(h.mr)], [t.proton, String(h.proton)]];
  if (h.tipe === "fiksi") { info.push([t.kode, h.kode]); info.push([t.simbol, h.simbolFiksi]); }
  for (const [lab, val] of info) { gambarTeks(ctx, lab + ":", 28, y, 2, WARNA.redup); gambarTeks(ctx, val, 28 + ukurTeks(lab + ": ", 2), y, 2, WARNA.teks); y += 20; }
  y += 8;
  for (const l of bungkus(h.deskripsi[bahasa] || h.deskripsi.id, 30)) { gambarTeks(ctx, l, 28, y, 2, WARNA.teks); y += 18; }
  if (h.bahaya) { y += 6; for (const l of bungkus(t.bahaya, 30)) { gambarTeks(ctx, l, 28, y, 2, WARNA.merah); y += 18; } }
  y += 10;
  gambarTeks(ctx, h.tipe === "fiksi" ? t.footFiksi : h.tipe === "nyata" ? t.footNyata : t.footUnsur, c / 2, y, 1, WARNA.redup, "tengah"); y += 20;
  return y;
}
export function ukuranKartuHasil(h, bahasa = "id") { return { lebar: LEBAR_HASIL, tinggi: tataHasil(stub, h, bahasa, false) + 8 }; }
export function gambarKartuHasil(ctx, h, bahasa = "id") {
  const { lebar, tinggi } = ukuranKartuHasil(h, bahasa);
  ctx.fillStyle = WARNA.latar; ctx.fillRect(0, 0, lebar, tinggi);
  panel(ctx, 8, 8, lebar - 16, tinggi - 16, WARNA.panel, 6);
  tataHasil(ctx, h, bahasa, true);
}
