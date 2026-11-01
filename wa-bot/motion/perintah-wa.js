// Pembuatan video motion graphic atas permintaan lewat WhatsApp (chat pribadi maupun grup).
// Modul ini tidak menyentuh Baileys: semua sambungan ke bot (llm, cari, tts, kirimTeks, kirimVideo) disuntikkan,
// jadi mudah dites dan pemasangannya ke penangan pesan bot cukup satu panggilan: tanganiPesanWa(...).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ambilTemplat, templatUntuk, temaMinggu } from "./templates/index.js";
import { buatIsi, buatIsiFaktaCadangan, periksaRamahKeluarga, KATA_TIDAK_RAMAH } from "./content.js";
import { renderVideo } from "./render.js";
import { metaShorts } from "./youtube-meta.js";

// ---------- pengenalan perintah ----------
const JENIS = [
  ["mitos-fakta", /\b(mitos|hoaks|hoax)\b/i],
  ["perbandingan-bar", /\b(bandingkan|perbandingan|banding|versus|vs)\b/i],
  ["peringkat", /\b(peringkat|ranking|top\s*\d)\b/i],
  ["garis-waktu", /\b(garis\s*waktu|timeline|sejarah|kronologi)\b/i],
  ["proses-tahapan", /\b(proses|tahapan|tahap|siklus|cara\s*kerja)\b/i],
  ["cerita-fakta", /\b(cerita|kisah)\b/i],
  ["kuis-kilat", /\b(kuis|quiz|tebak-?tebakan)\b/i],
  ["hitung-langkah", /\b(soal\s*cerita|hitung|matematika)\b/i],
  ["pola-angka", /\b(pola|deret)\b/i],
  ["fakta-angka", /\b(fakta|angka)\b/i]
];
const MAKS_TOPIK = 160;

/**
 * Kenali permintaan video dari teks pesan.
 * Contoh: "buatkan video peringkat tentang hewan tercepat", "/video mitos: makan wortel bikin mata tajam",
 *         "bikin video motion graphic soal siklus air tanpa suara hd".
 * @returns null bila bukan permintaan video; selain itu {templatId|null, topik, suara, hd, slash, bantuan, panjangKelebihan}
 */
export function kenaliPerintah(teksMentah, { namaBot = "" } = {}) {
  let s = String(teksMentah || "").replace(/[‎‏]/g, "").trim();
  if (!s) return null;
  s = s.replace(/^(?:@\S+\s*)+/, "");
  if (namaBot) s = s.replace(new RegExp(`^${namaBot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,:]?\\s*`, "i"), "");
  let slash = false, sisa;
  let m = s.match(/^\/(?:video|motion|short)\b\s*(.*)$/is);
  if (m) { slash = true; sisa = m[1]; }
  else {
    m = s.match(/\b(?:buat(?:kan|in)?|bikin(?:kan|in)?|generate|render|tolong\s+buat)\b[^\n]{0,40}?\b(?:video|shorts?|motion\s*graphics?)\b(.*)$/is);
    if (!m) return null;
    sisa = m[1];
  }
  sisa = sisa.trim();
  if (/^(bantuan|help|\?|menu|contoh)$/i.test(sisa)) return { bantuan: true, slash, topik: "", templatId: null, suara: true, hd: false };

  let suara = true, hd = false;
  sisa = sisa.replace(/\btanpa\s+(?:suara|narasi|narator|musik)\b/gi, () => { suara = false; return " "; })
    .replace(/\b(?:hd|full\s*hd|resolusi\s*tinggi)\b/gi, () => { hd = true; return " "; });
  sisa = sisa.replace(/^\s*(?:motion\s*graphics?|video|shorts?|pendek|singkat)\b/gi, " ").replace(/^\s*(?:motion\s*graphics?|video)\b/gi, " ").trim();

  let kepala = "", topik = sisa;
  const sep = sisa.match(/^(.*?)(?:\b(?:tentang|mengenai|soal|seputar|dengan\s+topik|topik)\b\s*:?|:)\s*(.+)$/is);
  if (sep) { kepala = sep[1]; topik = sep[2]; }
  let templatId = null;
  const cariDi = sep ? kepala : sisa;
  for (const [id, re] of JENIS) {
    const mm = cariDi.match(re);
    if (mm) { templatId = id; if (!sep && id !== "fakta-angka") topik = sisa.replace(mm[0], " "); break; }
  }
  topik = topik.replace(/\b(?:ya|dong|deh|donk|please|tolong|nih)\b\s*[.!?]*\s*$/gi, "").replace(/^[\s:,.\-–]+|[\s:,.\-–]+$/g, "").replace(/\s+/g, " ").trim();
  return { templatId, topik, suara, hd, slash, bantuan: false, kepanjangan: topik.length > MAKS_TOPIK };
}

export function teksBantuan() {
  return [
    "Cara minta video motion graphic (vertikal 9:16, sekitar 20-25 detik, ada suara narasi):",
    "• buatkan video tentang gunung tertinggi di dunia",
    "• /video peringkat: 3 hewan tercepat",
    "• /video mitos: makan wortel bikin mata tajam",
    "• /video proses: terjadinya hujan",
    "• /video kuis: perkalian 7 dan 8",
    "Jenis yang dikenal: fakta, peringkat, mitos, bandingkan, proses, sejarah (garis waktu), cerita, kuis, hitung, pola.",
    "Tambahan: \"tanpa suara\" untuk video tanpa narasi, \"hd\" untuk resolusi 1080x1920 (lebih lama dibuat).",
    "Untuk fakta, saya mencari sumber di web dulu; bila sumber kurang, video tidak dibuat supaya tidak mengarang."
  ].join("\n");
}

// ---------- izin, batas pemakaian, antrean ----------
/** Konfigurasi dari environment. WA_VIDEO_SEMUA=1 (semua orang boleh), WA_VIDEO_GRUP=jid1,jid2, WA_VIDEO_PENGIRIM=jid1,jid2. */
export function konfigDariEnv(env = process.env) {
  const daftar = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    izinSemua: env.WA_VIDEO_SEMUA === "1",
    izinGrup: daftar(env.WA_VIDEO_GRUP),
    izinPengirim: daftar(env.WA_VIDEO_PENGIRIM),
    selangMenit: Number(env.WA_VIDEO_SELANG_MENIT || 10),
    maksHarian: Number(env.WA_VIDEO_MAKS_HARIAN || 3),
    maksAntrean: Number(env.WA_VIDEO_MAKS_ANTREAN || 3)
  };
}
/** Pemilik selalu boleh. Selain pemilik: harus di grup yang diizinkan, pengirim yang diizinkan, atau izinSemua. */
export function izinVideo({ adalahPemilik, grup = null, pengirim = "", konfig = {} }) {
  if (adalahPemilik) return { ok: true, bebasBatas: true };
  const { izinSemua = false, izinGrup = [], izinPengirim = [] } = konfig;
  if (izinSemua || (grup && izinGrup.includes(grup)) || izinPengirim.includes(pengirim)) return { ok: true, bebasBatas: false };
  return { ok: false, alasan: "Maaf, pembuatan video saat ini hanya untuk pemilik bot dan grup/nomor yang sudah diizinkan." };
}
const hariWita = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
/** Pembatas per pengirim: jarak minimal antar-permintaan dan jumlah maksimal per hari (WITA). */
export function buatPembatas({ selangMenit = 10, maksHarian = 3 } = {}) {
  const data = new Map(); // kunci -> {hari, n, terakhir}
  return {
    cek(kunci, sekarang = Date.now()) {
      const d = data.get(kunci);
      if (!d) return { ok: true };
      const hari = hariWita(sekarang), n = d.hari === hari ? d.n : 0;
      if (n >= maksHarian) return { ok: false, alasan: `Jatahmu hari ini sudah habis (${maksHarian} video per hari). Coba lagi besok ya.` };
      const tunggu = Math.ceil((d.terakhir + selangMenit * 60e3 - sekarang) / 60e3);
      if (tunggu > 0) return { ok: false, alasan: `Tunggu sekitar ${tunggu} menit lagi sebelum minta video berikutnya ya.` };
      return { ok: true };
    },
    catat(kunci, sekarang = Date.now()) {
      const hari = hariWita(sekarang), d = data.get(kunci);
      data.set(kunci, { hari, n: (d && d.hari === hari ? d.n : 0) + 1, terakhir: sekarang });
    }
  };
}
/** Antrean satu-per-satu (render memakai CPU berat). Pasang satu instans yang sama untuk job terjadwal dan permintaan WA. */
export function buatAntrean({ maksTunggu = 3 } = {}) {
  let jalan = false; const q = [];
  const pompa = async () => {
    if (jalan || !q.length) return;
    jalan = true;
    const { fn, res, rej } = q.shift();
    try { res(await fn()); } catch (e) { rej(e); }
    jalan = false; pompa();
  };
  return {
    get panjang() { return q.length + (jalan ? 1 : 0); },
    penuh() { return q.length >= maksTunggu; },
    jalankan(fn) { return new Promise((res, rej) => { q.push({ fn, res, rej }); pompa(); }); }
  };
}

// ---------- pembuatan video ----------
/**
 * @param {object} o  perintah (hasil kenaliPerintah), llm, cari, tts (opsional: async (teks)=>berkas audio), folder, tanggal ("YYYY-MM-DD"),
 *                    skala (default 1 = 720x1280; hd => 1.5), renderFn (untuk tes)
 * @returns {{berkas, durasi, judul, dasar, sumber, templatId, catatan:string[]}}
 */
export async function buatVideoWa({ perintah, llm, cari, tts, folder = path.join(os.tmpdir(), "ayyubi-video"), tanggal = hariWita(Date.now()), skala, renderFn = renderVideo }) {
  const topik = String(perintah.topik || "").trim();
  if (topik.length < 3) throw Object.assign(new Error("topik kosong"), { ramah: "Topiknya belum ada. Contoh: /video peringkat: 3 hewan tercepat" });
  if (KATA_TIDAK_RAMAH.test(topik)) throw Object.assign(new Error("topik tidak ramah keluarga"), { ramah: "Maaf, topik itu tidak cocok untuk video ramah keluarga. Coba topik lain ya." });
  // Tanpa jenis eksplisit: coba templat hari ini, lalu cadangan serbaguna (cerita-fakta, fakta-angka) bila isinya tak cocok dengan topik.
  const kandidat = perintah.templatId ? [perintah.templatId] : [...new Set([templatUntuk(tanggal).id, "cerita-fakta", "fakta-angka"])];
  let templatId = kandidat[0], t = ambilTemplat(templatId);
  const catatan = [];
  let hasil;
  if (t.jalur === "fakta") {
    if (typeof cari !== "function") throw Object.assign(new Error("pencarian web belum tersambung"), { ramah: "Pencarian web belum tersambung, jadi video fakta belum bisa dibuat. Coba jenis kuis/hitung/pola dulu." });
    let galat;
    for (const id of kandidat) {
      try { hasil = await buatIsiFaktaCadangan({ llm, cari, templatId: id, topik }); templatId = hasil.templatId; t = ambilTemplat(templatId); break; }
      catch (e) { galat = e; if (/Sumber (kurang|tidak cukup)/i.test(e.message)) break; }
    }
    if (!hasil) throw galat;
  } else {
    hasil = await buatIsi({ llm, templatId, topik });
    hasil.sumber = [];
    const gal = periksaRamahKeluarga(hasil.isi);
    if (gal.length) throw Object.assign(new Error(`isi tidak ramah keluarga: ${gal.join("; ")}`), { ramah: "Maaf, hasilnya kurang cocok untuk keluarga, jadi tidak saya buat. Coba topik lain ya." });
    catatan.push("Isi dibuat AI tanpa pencarian web; hitungan sudah dicek otomatis, tetap periksa sebelum dipakai belajar.");
  }
  let narasi = null;
  if (perintah.suara !== false && typeof tts === "function") {
    try { narasi = await tts(hasil.narasi); } catch (e) { catatan.push("Suara narasi gagal dibuat, video dikirim dengan musik saja."); }
  }
  if (hasil.sumber?.length && hasil.isi && typeof hasil.isi === "object" && !Array.isArray(hasil.isi)) {
    const dom = [...new Set(hasil.sumber.map((x) => { try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean))].slice(0, 3);
    if (dom.length && "sumberTeks" in hasil.isi) hasil.isi.sumberTeks = `Sumber: ${dom.join(", ")}`;
  }
  fs.mkdirSync(folder, { recursive: true });
  const keluar = path.join(folder, `wa-${Date.now()}-${templatId}.mp4`);
  try {
    const r = await renderFn({ templatId, isi: hasil.isi, hook: hasil.hook, narasi: narasi || undefined, tema: t.hari !== null ? temaMinggu(t, tanggal) : t.tema, keluar, skala: skala ?? (perintah.hd ? 1.5 : 1) });
    const meta = metaShorts({ templatId, isi: hasil.isi, hook: hasil.hook, topik, sumber: hasil.sumber });
    return { berkas: r.berkas || keluar, durasi: r.durasi, judul: meta.judul.replace(/\s*#Shorts$/i, ""), dasar: hasil.dasar || "", sumber: hasil.sumber, templatId, catatan };
  } finally {
    if (narasi && fs.existsSync(narasi)) { try { fs.unlinkSync(narasi); } catch {} }
  }
}

export function formatKeterangan(h) {
  const baris = [h.judul];
  if (h.dasar) baris.push("", h.dasar);
  if (h.sumber?.length) baris.push("", "Sumber:", ...h.sumber.slice(0, 3).map((s) => `• ${s.judul || s.url} - ${s.url}`));
  if (h.catatan?.length) baris.push("", ...h.catatan.map((c) => `(${c})`));
  return baris.join("\n");
}

function pesanGalat(e) {
  if (e?.ramah) return e.ramah;
  const m = String(e?.message || e);
  if (/Sumber (kurang|tidak cukup)/i.test(m)) return "Maaf, saya tidak menemukan sumber yang cukup kuat untuk topik itu, jadi videonya tidak saya buat supaya tidak mengarang. Coba topik yang lebih spesifik atau lebih umum ya.";
  return `Maaf, video gagal dibuat (${m.slice(0, 140)}). Coba lagi sebentar lagi atau ganti topiknya.`;
}

/**
 * Penangan satu pintu untuk pesan WhatsApp. Panggil di awal penangan pesan bot; bila mengembalikan true, pesan sudah ditangani
 * (jangan diproses lagi sebagai percakapan biasa). Bila false, lanjutkan alur bot seperti biasa.
 * @param {object} o
 *   teks, pengirim (jid), adalahPemilik (bool), grup (jid grup atau null), disebut (bot di-mention / dibalas; wajib true di grup kecuali memakai "/video"),
 *   deps {llm, cari, tts}, kirimTeks(teks), kirimVideo(berkas, keterangan), antrean, pembatas, konfig, namaBot, folder, sekarang, skala, renderFn
 */
export async function tanganiPesanWa(o) {
  const { teks, pengirim = "", adalahPemilik = false, grup = null, disebut = false, deps = {}, kirimTeks, kirimVideo, antrean, pembatas, konfig = {}, namaBot, folder, skala, renderFn } = o;
  const sekarang = o.sekarang ?? Date.now();
  const p = kenaliPerintah(teks, { namaBot });
  if (!p) return false;
  if (grup && !disebut && !p.slash) return false; // di grup jangan menyela obrolan
  const izin = izinVideo({ adalahPemilik, grup, pengirim, konfig });
  if (!izin.ok) { await kirimTeks(izin.alasan); return true; }
  if (p.bantuan || (p.slash && !p.topik)) { await kirimTeks(teksBantuan()); return true; }
  if (!p.topik) { await kirimTeks("Topiknya apa? Contoh: buatkan video tentang gunung tertinggi di dunia. Ketik /video bantuan untuk contoh lain."); return true; }
  if (p.kepanjangan) { await kirimTeks(`Topiknya terlalu panjang (maksimal ${MAKS_TOPIK} huruf). Ringkas dulu ya.`); return true; }
  if (KATA_TIDAK_RAMAH.test(p.topik)) { await kirimTeks("Maaf, topik itu tidak cocok untuk video ramah keluarga. Coba topik lain ya."); return true; }
  const kunci = pengirim || "anon";
  if (!izin.bebasBatas && pembatas) {
    const c = pembatas.cek(kunci, sekarang);
    if (!c.ok) { await kirimTeks(c.alasan); return true; }
  }
  if (antrean.penuh()) { await kirimTeks("Antrean pembuatan video sedang penuh. Coba lagi beberapa menit lagi ya."); return true; }
  const posisi = antrean.panjang;
  await kirimTeks(posisi ? `Siap, antreanmu nomor ${posisi + 1}. Videonya dibuat setelah yang di depan selesai.` : "Siap, videonya sedang dibuat. Biasanya sekitar 1-2 menit.");
  let hasil = null;
  try {
    hasil = await antrean.jalankan(() => buatVideoWa({ perintah: p, ...deps, folder, skala, renderFn, tanggal: hariWita(sekarang) }));
    await kirimVideo(hasil.berkas, formatKeterangan(hasil));
    if (!izin.bebasBatas && pembatas) pembatas.catat(kunci, sekarang); // jatah hanya terpakai bila video berhasil terkirim
  } catch (e) {
    await kirimTeks(pesanGalat(e));
  } finally {
    if (hasil?.berkas && fs.existsSync(hasil.berkas)) { try { fs.unlinkSync(hasil.berkas); } catch {} }
  }
  return true;
}
