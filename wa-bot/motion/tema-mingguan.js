// Usulan tema satu pekan: bot mengusulkan 7 tema (satu per hari, tiap hari templat berbeda),
// pemilik bisa setuju, mengganti, menukar, mengulang, atau menyumbang tema sendiri.
// Murni logika + penyimpanan berkas. Pengiriman pesan Telegram dan penjadwalan dipasang di luar modul ini.
import fs from "node:fs";
import path from "node:path";
import { HARIAN, ambilTemplat } from "./templates/index.js";
import { ekstrakJson } from "./content.js";
import { potong } from "./engine.js";

export const NAMA_HARI_ID = { 1: "Senin", 2: "Selasa", 3: "Rabu", 4: "Kamis", 5: "Jumat", 6: "Sabtu", 7: "Minggu" };
export const HARI_ALIAS = { senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6, minggu: 7, ahad: 7 };
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Cadangan bila AI gagal: topik aman untuk anak SD, urut menurut templat.
export const BANK_TEMA = {
  "kuis-kilat": ["Perkalian 6, 7, 8, dan 9", "Pecahan senilai", "Mengenal bangun datar", "Satuan panjang dan berat", "Bilangan genap dan ganjil", "Jam dan waktu"],
  "hitung-langkah": ["Soal cerita penjumlahan dan pengurangan", "Soal cerita perkalian", "Membagi rata", "Uang kembalian di warung", "Keliling persegi panjang", "Pecahan sederhana"],
  "fakta-angka": ["Tinggi gunung tertinggi di dunia", "Jarak Bumi ke Bulan", "Jumlah tulang manusia dewasa", "Kecepatan cahaya", "Umur pohon tertua", "Dalamnya palung laut terdalam"],
  "perbandingan-bar": ["Kecepatan berbagai kendaraan", "Ukuran planet di tata surya", "Tinggi hewan darat", "Panjang sungai terkenal", "Berat hewan besar", "Umur hewan yang panjang umur"],
  "proses-tahapan": ["Terbentuknya hujan", "Siklus hidup kupu-kupu", "Fotosintesis pada tumbuhan", "Cara tubuh mencerna makanan", "Terjadinya siang dan malam", "Dari biji menjadi pohon"],
  "mitos-fakta": ["Wortel dan mata", "Makan permen dan gigi berlubang", "Petir menyambar dua kali", "Kita hanya memakai 10 persen otak", "Kelelawar itu buta", "Lidah punya daerah rasa yang terpisah"],
  "pola-angka": ["Pola tambah 3", "Pola kelipatan dua", "Pola berkurang 5", "Pola bilangan kuadrat", "Pola kali 2", "Pola naik turun"]
};

// ---------- tanggal ----------
export const tanggalISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dariISO = (iso) => new Date(`${iso}T12:00:00`);
/** Senin berikutnya (selalu setelah hari ini; bila hari ini Senin, Senin pekan depan). */
export function senenBerikut(dari = new Date()) {
  const d = new Date(dari.getFullYear(), dari.getMonth(), dari.getDate(), 12); const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add); return tanggalISO(d);
}
/** Tujuh hari mulai Senin `senenISO`, lengkap dengan templat harian. */
export function susunMinggu(senenISO) {
  const out = [], mulai = dariISO(senenISO);
  for (let i = 0; i < 7; i++) {
    const d = new Date(mulai); d.setDate(mulai.getDate() + i);
    const tpl = HARIAN.find((t) => t.hari === d.getDay());
    out.push({ tanggal: tanggalISO(d), hari: i + 1, nama: NAMA_HARI_ID[i + 1], templat: tpl.id, templatNama: tpl.nama });
  }
  return out;
}
export function rentangTeks(senenISO) {
  const a = dariISO(senenISO), b = new Date(a); b.setDate(a.getDate() + 6);
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${BULAN[b.getMonth()]} ${b.getFullYear()}` : `${a.getDate()} ${BULAN[a.getMonth()]} – ${b.getDate()} ${BULAN[b.getMonth()]} ${b.getFullYear()}`;
}

// ---------- usulan ----------
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
function dariBank(templatId, dipakai) {
  const daftar = BANK_TEMA[templatId] || BANK_TEMA["fakta-angka"];
  return daftar.find((x) => !dipakai.has(norm(x))) || daftar[0];
}
async function topikDariAI({ llm, hariKosong, kelas, hindari }) {
  const baris = hariKosong.map((h) => `${h.hari}. ${h.nama}: format "${h.templatNama}"`).join("\n");
  const prompt = [
    `Susun topik video Short edukasi berbahasa Indonesia untuk anak ${kelas}, satu topik per hari. Tiap hari punya format video berbeda:`, baris,
    `Topik harus sesuai format (misal Kuis Kilat = soal yang bisa dijawab cepat; Mitos atau Fakta = anggapan keliru populer; Pola Angka = deret bilangan), menarik, dan pasti bisa dijelaskan dengan benar dalam 20 detik.`,
    hindari.length ? `Jangan ulangi topik berikut: ${hindari.slice(0, 40).join("; ")}.` : "",
    `Balas HANYA JSON array: [{"hari":1,"topik":"..."}] dengan nomor hari seperti di atas. Topik 2-8 kata.`
  ].filter(Boolean).join("\n");
  const arr = ekstrakJson(await llm(prompt));
  if (!Array.isArray(arr)) throw new Error("bukan array");
  const hasil = new Map();
  for (const x of arr) { const n = Number(x?.hari), tp = potong(x?.topik, 60); if (hariKosong.some((h) => h.hari === n) && tp) hasil.set(n, tp); }
  return hasil;
}

/**
 * Buat usulan satu pekan. Urutan prioritas topik per hari: tema dari pemilik (antrean) -> AI -> bank cadangan.
 * @returns usulan {minggu, status:'diusulkan', hari:[{tanggal,hari,nama,templat,templatNama,topik,sumber}]}
 */
export async function usulkanMinggu({ llm = null, senen, kelas = "SD kelas 1-6", riwayat = [], temaOwner = [], sekarang = new Date() }) {
  const hari = susunMinggu(senen).map((h) => ({ ...h, topik: "", sumber: "" }));
  const dipakai = new Set(riwayat.map(norm));
  const antre = [...temaOwner];
  for (const h of hari) { const o = antre.shift(); if (o) { h.topik = potong(o.teks ?? o, 60); h.sumber = "owner"; dipakai.add(norm(h.topik)); } }
  const kosong = hari.filter((h) => !h.topik);
  if (kosong.length && llm) {
    try {
      const m = await topikDariAI({ llm, hariKosong: kosong, kelas, hindari: [...dipakai].slice(-40) });
      for (const h of kosong) if (m.has(h.hari) && !dipakai.has(norm(m.get(h.hari)))) { h.topik = m.get(h.hari); h.sumber = "ai"; dipakai.add(norm(h.topik)); }
    } catch { /* jatuh ke bank */ }
  }
  for (const h of hari) if (!h.topik) { h.topik = dariBank(h.templat, dipakai); h.sumber = "bank"; dipakai.add(norm(h.topik)); }
  return { minggu: senen, status: "diusulkan", dibuat: sekarang.toISOString(), hari };
}

// ---------- perintah dari pemilik ----------
function hariDari(token) {
  const t = String(token).toLowerCase().replace(/[^a-z0-9']/g, "");
  if (/^[1-7]$/.test(t)) return Number(t);
  return HARI_ALIAS[t] || null;
}
/** Menerjemahkan balasan pemilik menjadi perintah terstruktur. aksi: setuju|ulang|ganti|tukar|hapus|tema|daftarTema|bebas */
export function parsePerintah(teks) {
  const s = String(teks ?? "").trim();
  if (!s) return { aksi: "bebas", teks: s };
  let m;
  if (/^(setuju|oke?|ok|lanjut|acc|siap|gas)\b/i.test(s) && s.length < 40) return { aksi: "setuju" };
  if (/^(ulang|usul(kan)? ulang|acak|ganti semua)\b/i.test(s)) return { aksi: "ulang" };
  if (/^(daftar tema|tema saya|lihat tema)\s*$/i.test(s)) return { aksi: "daftarTema" };
  if ((m = s.match(/^ganti\s+(\S+)\s*[:=\-–]?\s*(.+)$/i)) && hariDari(m[1])) return { aksi: "ganti", hari: hariDari(m[1]), topik: m[2].trim() };
  if ((m = s.match(/^tukar\s+(\S+)\s+(?:dengan|dan|ke|<->|↔)?\s*(\S+)\s*$/i)) && hariDari(m[1]) && hariDari(m[2])) return { aksi: "tukar", a: hariDari(m[1]), b: hariDari(m[2]) };
  if ((m = s.match(/^hapus\s+(\S+)\s*$/i)) && hariDari(m[1])) return { aksi: "hapus", hari: hariDari(m[1]) };
  if ((m = s.match(/^tema(?:\s+baru|\s+saya)?\s*[:=\-–]\s*([\s\S]+)$/i))) return { aksi: "tema", daftar: m[1].split(/[;\n]+/).map((x) => x.trim()).filter(Boolean) };
  return { aksi: "bebas", teks: s };
}

/**
 * Terapkan perintah ke state. state = {usulan, temaOwner:[{teks,tgl}], riwayat:[]}. Tidak mengubah argumen; mengembalikan {state, pesan, berubah}.
 */
export async function terapkan({ state, perintah, llm = null, sekarang = new Date(), kelas }) {
  const st = JSON.parse(JSON.stringify(state || {})); st.temaOwner ||= []; st.riwayat ||= [];
  const u = st.usulan; const p = perintah;
  const butuhUsulan = () => ({ state: st, pesan: "Belum ada usulan tema yang aktif. Tunggu usulan berikutnya, atau ketik: tema: topik saya (untuk menambah ke daftar).", berubah: false });
  if (p.aksi === "tema") {
    const baru = p.daftar.map((x) => ({ teks: potong(x, 60), tgl: sekarang.toISOString() }));
    st.temaOwner.push(...baru);
    return { state: st, pesan: `Tersimpan ${baru.length} tema Bapak: ${baru.map((x) => x.teks).join("; ")}. Akan dipakai lebih dulu pada usulan pekan berikutnya. Mau dipakai pekan ini? Ketik: ganti 3: ${baru[0].teks}`, berubah: true };
  }
  if (p.aksi === "daftarTema") return { state: st, pesan: st.temaOwner.length ? "Antrean tema Bapak:\n" + st.temaOwner.map((x, i) => `${i + 1}. ${x.teks}`).join("\n") : "Antrean tema Bapak masih kosong. Tambah dengan: tema: topik; topik lain", berubah: false };
  if (!u) return butuhUsulan();
  const h = (n) => u.hari.find((x) => x.hari === n);
  if (p.aksi === "setuju") { u.status = "disetujui"; u.disetujui = sekarang.toISOString(); u.disetujuiOleh = "owner"; return { state: st, pesan: `Siap, tema pekan ${rentangTeks(u.minggu)} disetujui. Video dibuat otomatis tiap hari sesuai daftar.`, berubah: true }; }
  if (p.aksi === "ganti") {
    const x = h(p.hari); if (!x) return { state: st, pesan: "Hari tidak dikenali (pakai 1–7 atau nama hari).", berubah: false };
    x.topik = potong(p.topik, 60); x.sumber = "owner"; return { state: st, pesan: `${x.nama} diganti menjadi: ${x.topik} (format ${x.templatNama}).`, berubah: true };
  }
  if (p.aksi === "tukar") {
    const a = h(p.a), b = h(p.b); if (!a || !b) return { state: st, pesan: "Hari tidak dikenali.", berubah: false };
    [a.topik, b.topik] = [b.topik, a.topik]; [a.sumber, b.sumber] = [b.sumber, a.sumber];
    return { state: st, pesan: `Topik ${a.nama} dan ${b.nama} ditukar. Format video tetap mengikuti harinya.`, berubah: true };
  }
  if (p.aksi === "hapus") {
    const x = h(p.hari); if (!x) return { state: st, pesan: "Hari tidak dikenali.", berubah: false };
    const dipakai = new Set([...st.riwayat, ...u.hari.map((y) => y.topik)].map(norm)); let baru = "", sumber = "bank";
    if (llm) { try { const m = await topikDariAI({ llm, hariKosong: [x], kelas: kelas || "SD kelas 1-6", hindari: [...dipakai] }); baru = m.get(x.hari) || ""; if (baru) sumber = "ai"; } catch {} }
    if (!baru) baru = dariBank(x.templat, dipakai);
    x.topik = baru; x.sumber = sumber; return { state: st, pesan: `${x.nama} diganti topik baru: ${baru}.`, berubah: true };
  }
  if (p.aksi === "ulang") {
    const baru = await usulkanMinggu({ llm, senen: u.minggu, kelas, riwayat: [...st.riwayat, ...u.hari.filter((x) => x.sumber !== "owner").map((x) => x.topik)], temaOwner: [], sekarang });
    u.hari.forEach((x, i) => { if (x.sumber !== "owner") { x.topik = baru.hari[i].topik; x.sumber = baru.hari[i].sumber; } });
    u.status = "diusulkan"; return { state: st, pesan: "Usulan diulang (tema dari Bapak tetap dipertahankan).", berubah: true };
  }
  // bebas: minta AI menerapkan instruksi pemilik
  if (!llm) return { state: st, pesan: "Perintah belum dikenali. Pakai: setuju | ganti 3: topik | tukar 2 5 | hapus 4 | ulang | tema: topik", berubah: false };
  const daftar = u.hari.map((x) => `${x.hari}. ${x.nama} (${x.templatNama}): ${x.topik}`).join("\n");
  try {
    const arr = ekstrakJson(await llm([`Daftar topik video edukasi anak SD pekan ini:`, daftar, `Instruksi pemilik: "${p.teks}"`, `Terapkan instruksi itu. Balas HANYA JSON array hari yang BERUBAH: [{"hari":3,"topik":"..."}]. Bila tidak ada yang berubah, balas [].`].join("\n")));
    let n = 0; for (const x of Array.isArray(arr) ? arr : []) { const t = h(Number(x?.hari)); if (t && x.topik) { t.topik = potong(x.topik, 60); t.sumber = "owner"; n++; } }
    return n ? { state: st, pesan: `Siap, ${n} hari diperbarui sesuai permintaan.`, berubah: true } : { state: st, pesan: "Belum ada yang saya ubah. Coba tulis lebih spesifik, misalnya: ganti 3: planet Mars.", berubah: false };
  } catch { return { state: st, pesan: "Maaf, saya belum paham permintaannya. Pakai: setuju | ganti 3: topik | tukar 2 5 | hapus 4 | ulang | tema: topik", berubah: false }; }
}

// ---------- tampilan ----------
export function formatUsulan(u) {
  const baris = u.hari.map((x) => `${x.nama} — ${x.templatNama}: ${x.topik}${x.sumber === "owner" ? " (dari Bapak)" : ""}`);
  return [`Usulan tema pekan ${rentangTeks(u.minggu)}${u.status === "disetujui" ? " (sudah disetujui)" : ""}:`, "", ...baris, "", 'Balas: "setuju", "ganti 3: topik baru", "tukar 2 5", "hapus 4", "ulang", atau "tema: topik saya" untuk menambah ke antrean tema Bapak.'].join("\n");
}
/** Tombol inline Telegram untuk pesan usulan. callback_data diawali "tema:". */
export function tombolUsulan(minggu) {
  return { inline_keyboard: [[{ text: "Setuju", callback_data: `tema:setuju:${minggu}` }, { text: "Usul ulang", callback_data: `tema:ulang:${minggu}` }], [{ text: "Revisi (balas pesan ini)", callback_data: `tema:revisi:${minggu}` }]] };
}

// ---------- penyimpanan & pemakaian harian ----------
export function muatState(berkas) { try { return JSON.parse(fs.readFileSync(berkas, "utf8")); } catch { return { usulan: null, temaOwner: [], riwayat: [] }; } }
export function simpanState(berkas, state) { fs.mkdirSync(path.dirname(berkas), { recursive: true }); const tmp = berkas + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, berkas); }
/** Tema untuk tanggal tertentu. status: 'disetujui' | 'diusulkan' | 'tidak-ada'. */
export function temaUntuk(state, tanggal) {
  const u = state?.usulan; const x = u?.hari?.find((y) => y.tanggal === tanggal);
  return x ? { ...x, status: u.status } : { status: "tidak-ada" };
}
/** Pemilik belum membalas setelah batas waktu? Pakai usulan apa adanya (bot memberi tahu pemilik). */
export function setujuiOtomatis(state, sekarang = new Date()) {
  const st = JSON.parse(JSON.stringify(state)); if (st.usulan && st.usulan.status === "diusulkan") { st.usulan.status = "disetujui"; st.usulan.disetujui = sekarang.toISOString(); st.usulan.disetujuiOleh = "otomatis"; } return st;
}
export function catatRiwayat(state, topik) { const st = JSON.parse(JSON.stringify(state)); st.riwayat ||= []; st.riwayat.push(topik); st.riwayat = st.riwayat.slice(-120); return st; }
export function teaserBesok(state, tanggal) {
  const d = dariISO(tanggal); d.setDate(d.getDate() + 1); const x = state?.usulan?.hari?.find((y) => y.tanggal === tanggalISO(d)); return x ? x.topik : "";
}
