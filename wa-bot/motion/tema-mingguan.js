// Usulan tema satu pekan, DUA jalur per hari:
//   - Shorts fakta dunia (9:16, tiap hari templat berbeda)  -> hari[i].topik
//   - Video pelajaran (16:9, alur papan tulis yang sudah ada) -> hari[i].pelajaran.topik
// Pemilik bisa setuju, mengganti, menukar, mengulang, atau menyumbang tema sendiri.
// Murni logika + penyimpanan berkas. Pengiriman pesan Telegram dan penjadwalan dipasang di luar modul ini.
import fs from "node:fs";
import path from "node:path";
import { HARIAN } from "./templates/index.js";
import { ekstrakJson } from "./content.js";
import { potong } from "./engine.js";

export const NAMA_HARI_ID = { 1: "Senin", 2: "Selasa", 3: "Rabu", 4: "Kamis", 5: "Jumat", 6: "Sabtu", 7: "Minggu" };
export const HARI_ALIAS = { senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6, minggu: 7, ahad: 7 };
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Cadangan bila AI gagal. Topik fakta ramah keluarga, urut menurut templat; pelajaran untuk SD.
export const BANK_TEMA = {
  "fakta-angka": ["Tinggi gunung tertinggi di dunia", "Jarak Bumi ke Bulan", "Jumlah tulang manusia dewasa", "Kecepatan cahaya", "Umur pohon tertua di dunia", "Dalamnya palung laut terdalam"],
  peringkat: ["Hewan tercepat di dunia", "Hewan terbesar di dunia", "Gunung berapi tertinggi", "Sungai terpanjang di dunia", "Planet terbesar di tata surya", "Burung yang terbang paling jauh"],
  "mitos-fakta": ["Wortel dan mata", "Kelelawar itu buta", "Petir tidak menyambar tempat yang sama dua kali", "Kita hanya memakai 10 persen otak", "Rambut dan kuku tumbuh setelah meninggal", "Lidah punya daerah rasa yang terpisah"],
  "perbandingan-bar": ["Kecepatan berbagai kendaraan", "Ukuran planet di tata surya", "Tinggi hewan darat", "Panjang sungai terkenal", "Berat hewan besar", "Umur hewan yang panjang umur"],
  "proses-tahapan": ["Terbentuknya hujan", "Siklus hidup kupu-kupu", "Fotosintesis pada tumbuhan", "Terjadinya siang dan malam", "Dari biji menjadi pohon", "Terbentuknya pelangi"],
  "garis-waktu": ["Perjalanan manusia ke Bulan", "Sejarah penemuan listrik", "Sejarah pesawat terbang", "Sejarah komputer", "Penemuan benua dan pelayaran dunia", "Sejarah sepeda"],
  "cerita-fakta": ["Kenapa langit berwarna biru", "Kenapa laut terasa asin", "Kenapa kita menguap", "Kenapa pelangi melengkung", "Kenapa bulan terlihat berubah bentuk", "Kenapa es mengapung di air"],
  // di luar rotasi harian (dipakai bila templat tambahan diaktifkan)
  "kuis-kilat": ["Perkalian 6, 7, 8, dan 9", "Pecahan senilai"], "hitung-langkah": ["Soal cerita penjumlahan", "Membagi rata"], "pola-angka": ["Pola tambah 3", "Pola kali 2"]
};
export const BANK_PELAJARAN = ["Perkalian dan pembagian", "Pecahan senilai", "Mengenal bangun datar", "Satuan panjang dan berat", "Bilangan genap dan ganjil", "Jam dan waktu", "Keliling dan luas", "Soal cerita penjumlahan dan pengurangan", "Siklus air", "Bagian tubuh tumbuhan", "Wujud benda", "Magnet", "Energi dan sumber energi", "Rantai makanan"];

// ---------- tanggal ----------
export const tanggalISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dariISO = (iso) => new Date(`${iso}T12:00:00`);
/** Senin berikutnya (selalu setelah hari ini; bila hari ini Senin, Senin pekan depan). */
export function senenBerikut(dari = new Date()) {
  const d = new Date(dari.getFullYear(), dari.getMonth(), dari.getDate(), 12); const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add); return tanggalISO(d);
}
/** Tujuh hari mulai Senin `senenISO`, lengkap dengan templat Shorts harian. */
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
function dariBank(daftar, dipakai) { return daftar.find((x) => !dipakai.has(norm(x))) || daftar[0]; }
const bankFakta = (templatId) => BANK_TEMA[templatId] || BANK_TEMA["fakta-angka"];
async function topikDariAI({ llm, hari, butuhFakta, butuhPelajaran, kelas, hindari }) {
  const baris = hari.map((h) => `${h.hari}. ${h.nama}: format Shorts "${h.templatNama}"`).join("\n");
  const prompt = [
    `Susun topik konten YouTube berbahasa Indonesia untuk penonton keluarga dan anak ${kelas}. Tiap hari ada DUA konten:`,
    `(a) "fakta": Short 20 detik berisi fakta dunia yang menarik dan jarang diketahui, ramah keluarga, mudah diverifikasi dari sumber terpercaya (hindari kesehatan, politik, agama, konspirasi);`,
    `(b) "pelajaran": video pelajaran SD 1-2 menit (matematika atau sains dasar).`,
    `Format Shorts tiap hari berbeda:`, baris,
    `Topik fakta harus cocok dengan formatnya (Peringkat = hal yang bisa diurutkan; Garis Waktu = ada urutan tahun; Mitos atau Fakta = anggapan keliru populer; dst).`,
    hindari.length ? `Jangan ulangi topik berikut: ${hindari.slice(0, 40).join("; ")}.` : "",
    `Balas HANYA JSON array: [{"hari":1,"fakta":"...","pelajaran":"..."}] untuk hari ${hari.map((h) => h.hari).join(", ")}. Tiap topik 2-8 kata.`
  ].filter(Boolean).join("\n");
  const arr = ekstrakJson(await llm(prompt));
  if (!Array.isArray(arr)) throw new Error("bukan array");
  const hasil = new Map();
  for (const x of arr) {
    const n = Number(x?.hari); if (!hari.some((h) => h.hari === n)) continue;
    hasil.set(n, { fakta: butuhFakta ? potong(x?.fakta, 60) : "", pelajaran: butuhPelajaran ? potong(x?.pelajaran, 60) : "" });
  }
  return hasil;
}
const topikOwner = (o) => potong(o.teks ?? o, 60);

/**
 * Buat usulan satu pekan. Prioritas topik tiap jalur: tema pemilik (antrean) -> AI -> bank cadangan.
 * temaOwner: [{teks, jalur?:"fakta"|"pelajaran"}] (default jalur fakta).
 * @returns usulan {minggu, status:'diusulkan', hari:[{tanggal,hari,nama,templat,templatNama,topik,sumber,pelajaran:{topik,sumber}}]}
 */
export async function usulkanMinggu({ llm = null, senen, kelas = "SD kelas 1-6", riwayat = [], temaOwner = [], sekarang = new Date() }) {
  const hari = susunMinggu(senen).map((h) => ({ ...h, topik: "", sumber: "", pelajaran: { topik: "", sumber: "" } }));
  const dipakai = new Set(riwayat.map(norm));
  const antreF = temaOwner.filter((o) => (o.jalur || "fakta") === "fakta"), antreP = temaOwner.filter((o) => o.jalur === "pelajaran");
  for (const h of hari) {
    const f = antreF.shift(); if (f) { h.topik = topikOwner(f); h.sumber = "owner"; dipakai.add(norm(h.topik)); }
    const p = antreP.shift(); if (p) { h.pelajaran = { topik: topikOwner(p), sumber: "owner" }; dipakai.add(norm(h.pelajaran.topik)); }
  }
  const kosong = hari.filter((h) => !h.topik || !h.pelajaran.topik);
  if (kosong.length && llm) {
    try {
      const m = await topikDariAI({ llm, hari: kosong, butuhFakta: true, butuhPelajaran: true, kelas, hindari: [...dipakai].slice(-40) });
      for (const h of kosong) {
        const x = m.get(h.hari); if (!x) continue;
        if (!h.topik && x.fakta && !dipakai.has(norm(x.fakta))) { h.topik = x.fakta; h.sumber = "ai"; dipakai.add(norm(x.fakta)); }
        if (!h.pelajaran.topik && x.pelajaran && !dipakai.has(norm(x.pelajaran))) { h.pelajaran = { topik: x.pelajaran, sumber: "ai" }; dipakai.add(norm(x.pelajaran)); }
      }
    } catch { /* jatuh ke bank */ }
  }
  for (const h of hari) {
    if (!h.topik) { h.topik = dariBank(bankFakta(h.templat), dipakai); h.sumber = "bank"; dipakai.add(norm(h.topik)); }
    if (!h.pelajaran.topik) { h.pelajaran = { topik: dariBank(BANK_PELAJARAN, dipakai), sumber: "bank" }; dipakai.add(norm(h.pelajaran.topik)); }
  }
  return { minggu: senen, status: "diusulkan", dibuat: sekarang.toISOString(), hari };
}

// ---------- perintah dari pemilik ----------
function hariDari(token) {
  const t = String(token).toLowerCase().replace(/[^a-z0-9']/g, "");
  if (/^[1-7]$/.test(t)) return Number(t);
  return HARI_ALIAS[t] || null;
}
/**
 * Terjemahkan balasan pemilik jadi perintah terstruktur.
 * aksi: setuju|ulang|ganti|gantiPelajaran|tukar|hapus|tema|daftarTema|bebas
 */
export function parsePerintah(teks) {
  const s = String(teks ?? "").trim();
  if (!s) return { aksi: "bebas", teks: s };
  let m;
  if (/^(setuju|oke?|ok|lanjut|acc|siap|gas)\b/i.test(s) && s.length < 40) return { aksi: "setuju" };
  if (/^(ulang|usul(kan)? ulang|acak|ganti semua)\b/i.test(s)) return { aksi: "ulang" };
  if (/^(daftar tema|tema saya|lihat tema)\s*$/i.test(s)) return { aksi: "daftarTema" };
  if ((m = s.match(/^(?:pelajaran|video)\s+(\S+)\s*[:=\-–]?\s*(.+)$/i)) && hariDari(m[1])) return { aksi: "gantiPelajaran", hari: hariDari(m[1]), topik: m[2].trim() };
  if ((m = s.match(/^ganti\s+(\S+)\s*[:=\-–]?\s*(.+)$/i)) && hariDari(m[1])) return { aksi: "ganti", hari: hariDari(m[1]), topik: m[2].trim() };
  if ((m = s.match(/^tukar\s+(\S+)\s+(?:dengan|dan|ke|<->|↔)?\s*(\S+)\s*$/i)) && hariDari(m[1]) && hariDari(m[2])) return { aksi: "tukar", a: hariDari(m[1]), b: hariDari(m[2]) };
  if ((m = s.match(/^hapus\s+(\S+)\s*$/i)) && hariDari(m[1])) return { aksi: "hapus", hari: hariDari(m[1]) };
  if ((m = s.match(/^tema\s+(pelajaran|video)\s*[:=\-–]\s*([\s\S]+)$/i))) return { aksi: "tema", jalur: "pelajaran", daftar: m[2].split(/[;\n]+/).map((x) => x.trim()).filter(Boolean) };
  if ((m = s.match(/^tema(?:\s+baru|\s+saya)?\s*[:=\-–]\s*([\s\S]+)$/i))) return { aksi: "tema", jalur: "fakta", daftar: m[1].split(/[;\n]+/).map((x) => x.trim()).filter(Boolean) };
  return { aksi: "bebas", teks: s };
}

/**
 * Terapkan perintah ke state. state = {usulan, temaOwner:[{teks,jalur,tgl}], riwayat:[]}. Tidak mengubah argumen.
 * @returns {{state, pesan, berubah}}
 */
export async function terapkan({ state, perintah, llm = null, sekarang = new Date(), kelas = "SD kelas 1-6" }) {
  const st = JSON.parse(JSON.stringify(state || {})); st.temaOwner ||= []; st.riwayat ||= [];
  const u = st.usulan, p = perintah;
  const tanpaUsulan = () => ({ state: st, pesan: "Belum ada usulan tema yang aktif. Tunggu usulan berikutnya, atau ketik: tema: topik saya (untuk menambah ke daftar).", berubah: false });
  if (p.aksi === "tema") {
    const jalur = p.jalur || "fakta", baru = p.daftar.map((x) => ({ teks: potong(x, 60), jalur, tgl: sekarang.toISOString() }));
    st.temaOwner.push(...baru);
    const cara = jalur === "pelajaran" ? `pelajaran ${3}: ${baru[0].teks}` : `ganti 3: ${baru[0].teks}`;
    return { state: st, pesan: `Tersimpan ${baru.length} tema ${jalur === "pelajaran" ? "pelajaran" : "fakta"} Bapak: ${baru.map((x) => x.teks).join("; ")}. Dipakai lebih dulu pada usulan pekan berikutnya. Mau dipakai pekan ini? Ketik: ${cara}`, berubah: true };
  }
  if (p.aksi === "daftarTema") {
    const f = st.temaOwner.filter((x) => (x.jalur || "fakta") === "fakta"), pl = st.temaOwner.filter((x) => x.jalur === "pelajaran");
    return { state: st, pesan: st.temaOwner.length ? ["Antrean tema Bapak:", f.length ? "Fakta: " + f.map((x) => x.teks).join("; ") : "", pl.length ? "Pelajaran: " + pl.map((x) => x.teks).join("; ") : ""].filter(Boolean).join("\n") : "Antrean tema Bapak masih kosong. Tambah dengan: tema: topik; topik lain  (atau: tema pelajaran: topik)", berubah: false };
  }
  if (!u) return tanpaUsulan();
  const h = (n) => u.hari.find((x) => x.hari === n);
  if (p.aksi === "setuju") { u.status = "disetujui"; u.disetujui = sekarang.toISOString(); u.disetujuiOleh = "owner"; return { state: st, pesan: `Siap, tema pekan ${rentangTeks(u.minggu)} disetujui. Short dan video pelajaran dibuat otomatis tiap hari sesuai daftar.`, berubah: true }; }
  if (p.aksi === "ganti") {
    const x = h(p.hari); if (!x) return { state: st, pesan: "Hari tidak dikenali (pakai 1–7 atau nama hari).", berubah: false };
    x.topik = potong(p.topik, 60); x.sumber = "owner"; return { state: st, pesan: `Short ${x.nama} diganti menjadi: ${x.topik} (format ${x.templatNama}).`, berubah: true };
  }
  if (p.aksi === "gantiPelajaran") {
    const x = h(p.hari); if (!x) return { state: st, pesan: "Hari tidak dikenali (pakai 1–7 atau nama hari).", berubah: false };
    x.pelajaran = { topik: potong(p.topik, 60), sumber: "owner" }; return { state: st, pesan: `Video pelajaran ${x.nama} diganti menjadi: ${x.pelajaran.topik}.`, berubah: true };
  }
  if (p.aksi === "tukar") {
    const a = h(p.a), b = h(p.b); if (!a || !b) return { state: st, pesan: "Hari tidak dikenali.", berubah: false };
    [a.topik, b.topik] = [b.topik, a.topik]; [a.sumber, b.sumber] = [b.sumber, a.sumber];
    return { state: st, pesan: `Topik Short ${a.nama} dan ${b.nama} ditukar. Format video tetap mengikuti harinya.`, berubah: true };
  }
  if (p.aksi === "hapus") {
    const x = h(p.hari); if (!x) return { state: st, pesan: "Hari tidak dikenali.", berubah: false };
    const dipakai = new Set([...st.riwayat, ...u.hari.flatMap((y) => [y.topik, y.pelajaran?.topik])].filter(Boolean).map(norm)); let baru = "", sumber = "bank";
    if (llm) { try { const m = await topikDariAI({ llm, hari: [x], butuhFakta: true, butuhPelajaran: false, kelas, hindari: [...dipakai] }); baru = m.get(x.hari)?.fakta || ""; if (baru) sumber = "ai"; } catch {} }
    if (!baru) baru = dariBank(bankFakta(x.templat), dipakai);
    x.topik = baru; x.sumber = sumber; return { state: st, pesan: `Short ${x.nama} diganti topik baru: ${baru}.`, berubah: true };
  }
  if (p.aksi === "ulang") {
    const lama = u.hari.filter((x) => x.sumber !== "owner").map((x) => x.topik).concat(u.hari.filter((x) => x.pelajaran?.sumber !== "owner").map((x) => x.pelajaran?.topik));
    const baru = await usulkanMinggu({ llm, senen: u.minggu, kelas, riwayat: [...st.riwayat, ...lama.filter(Boolean)], temaOwner: [], sekarang });
    u.hari.forEach((x, i) => {
      if (x.sumber !== "owner") { x.topik = baru.hari[i].topik; x.sumber = baru.hari[i].sumber; }
      if (x.pelajaran?.sumber !== "owner") x.pelajaran = baru.hari[i].pelajaran;
    });
    u.status = "diusulkan"; return { state: st, pesan: "Usulan diulang (tema dari Bapak tetap dipertahankan).", berubah: true };
  }
  // bebas: minta AI menerapkan instruksi pemilik
  if (!llm) return { state: st, pesan: "Perintah belum dikenali. Pakai: setuju | ganti 3: topik | pelajaran 3: topik | tukar 2 5 | hapus 4 | ulang | tema: topik", berubah: false };
  const daftar = u.hari.map((x) => `${x.hari}. ${x.nama} (Short ${x.templatNama}): ${x.topik} | pelajaran: ${x.pelajaran?.topik}`).join("\n");
  try {
    const arr = ekstrakJson(await llm([`Daftar topik konten YouTube pekan ini (fakta untuk Short, dan pelajaran SD untuk video):`, daftar, `Instruksi pemilik: "${p.teks}"`, `Terapkan instruksi itu. Balas HANYA JSON array hari yang BERUBAH: [{"hari":3,"fakta":"...","pelajaran":"..."}] (cantumkan kolom yang berubah saja). Bila tidak ada yang berubah, balas [].`].join("\n")));
    let n = 0;
    for (const x of Array.isArray(arr) ? arr : []) {
      const t = h(Number(x?.hari)); if (!t) continue;
      if (x.fakta) { t.topik = potong(x.fakta, 60); t.sumber = "owner"; n++; }
      if (x.pelajaran) { t.pelajaran = { topik: potong(x.pelajaran, 60), sumber: "owner" }; n++; }
    }
    return n ? { state: st, pesan: `Siap, ${n} topik diperbarui sesuai permintaan.`, berubah: true } : { state: st, pesan: "Belum ada yang saya ubah. Coba tulis lebih spesifik, misalnya: ganti 3: planet Mars.", berubah: false };
  } catch { return { state: st, pesan: "Maaf, saya belum paham permintaannya. Pakai: setuju | ganti 3: topik | pelajaran 3: topik | tukar 2 5 | hapus 4 | ulang | tema: topik", berubah: false }; }
}

// ---------- tampilan ----------
export function formatUsulan(u) {
  const baris = u.hari.map((x) => `${x.nama}\n  Short (${x.templatNama}): ${x.topik}${x.sumber === "owner" ? " (dari Bapak)" : ""}\n  Video pelajaran: ${x.pelajaran?.topik}${x.pelajaran?.sumber === "owner" ? " (dari Bapak)" : ""}`);
  return [`Usulan tema pekan ${rentangTeks(u.minggu)}${u.status === "disetujui" ? " (sudah disetujui)" : ""}:`, "", ...baris, "", 'Balas: "setuju", "ganti 3: topik Short", "pelajaran 3: topik video", "tukar 2 5", "hapus 4", "ulang", atau "tema: topik saya" (tambah "tema pelajaran: ..." untuk video pelajaran) untuk menambah ke antrean tema Bapak.'].join("\n");
}
/** Tombol inline Telegram untuk pesan usulan. callback_data diawali "tema:". */
export function tombolUsulan(minggu) {
  return { inline_keyboard: [[{ text: "Setuju", callback_data: `tema:setuju:${minggu}` }, { text: "Usul ulang", callback_data: `tema:ulang:${minggu}` }], [{ text: "Revisi (balas pesan ini)", callback_data: `tema:revisi:${minggu}` }]] };
}

// ---------- penyimpanan & pemakaian harian ----------
export function muatState(berkas) { try { return JSON.parse(fs.readFileSync(berkas, "utf8")); } catch { return { usulan: null, temaOwner: [], riwayat: [] }; } }
export function simpanState(berkas, state) { fs.mkdirSync(path.dirname(berkas), { recursive: true }); const tmp = berkas + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, berkas); }
/** Tema untuk tanggal tertentu: {templat, topik (Short fakta), pelajaran:{topik}, status}. status: 'disetujui' | 'diusulkan' | 'tidak-ada'. */
export function temaUntuk(state, tanggal) {
  const u = state?.usulan; const x = u?.hari?.find((y) => y.tanggal === tanggal);
  return x ? { ...x, status: u.status } : { status: "tidak-ada" };
}
/** Pemilik belum membalas setelah batas waktu? Pakai usulan apa adanya (bot memberi tahu pemilik). */
export function setujuiOtomatis(state, sekarang = new Date()) {
  const st = JSON.parse(JSON.stringify(state)); if (st.usulan && st.usulan.status === "diusulkan") { st.usulan.status = "disetujui"; st.usulan.disetujui = sekarang.toISOString(); st.usulan.disetujuiOleh = "otomatis"; } return st;
}
export function catatRiwayat(state, topik) { const st = JSON.parse(JSON.stringify(state)); st.riwayat ||= []; st.riwayat.push(topik); st.riwayat = st.riwayat.slice(-160); return st; }
/** Topik Short fakta besok (untuk teaser di penutup). */
export function teaserBesok(state, tanggal) {
  const d = dariISO(tanggal); d.setDate(d.getDate() + 1); const x = state?.usulan?.hari?.find((y) => y.tanggal === tanggalISO(d)); return x ? x.topik : "";
}
/** Topik video pelajaran hari ini (untuk ajakan menonton di penutup Short). */
export function teaserPelajaran(state, tanggal) { return state?.usulan?.hari?.find((y) => y.tanggal === tanggal)?.pelajaran?.topik || ""; }
