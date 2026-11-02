// Penyiap PAKET Adobe Stock lewat WhatsApp: ikon SVG + latar/pola JPEG + CSV metadata + lembar pratinjau, dikirim sebagai zip.
// Bot hanya MENYIAPKAN; mengunggah dan menekan Submit tetap dilakukan pemilik di Contributor Portal (Adobe tidak punya API publik untuk unggah).
// Semua sambungan (llm, kirim*, antrean) disuntikkan; tidak menyentuh Baileys.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { LATAR, renderLatar } from "./latar-mesin.mjs";
import { buatCsv, metadataUntuk, bersihkanJudul, bersihkanKataKunci } from "./metadata.js";
import { render3d, URUTAN_PALET } from "./ikon3d.mjs";

const SINI = path.dirname(fileURLToPath(import.meta.url));
export const MESIN_IKON = path.join(SINI, "ikon-mesin.py");
// yang SUDAH diunggah pemilik pada paket pertama (supaya bot tidak membuat ulang gambar yang sama; Adobe menolak konten mirip)
export const SUDAH_DIUNGGAH = {
  ikon: ["hilal", "hilal-bintang", "masjid", "menara", "lentera", "ketupat", "kurma", "tasbih", "sajadah", "bedug", "alquran", "peci", "hadiah", "bintang-8", "minuman", "buka-puasa", "jam", "kalender", "amplop-thr", "kotak-donasi", "koin-hilal", "sahur", "weker-sahur", "kembang-api"],
  ikon3d: [],
  latar: ["batik-kawung-sogan", "batik-truntum-biru", "pola-islami-hijau-emas", "latar-malam-ramadan", "latar-lebaran-ketupat", "latar-abstrak-gradien"]
};
export const BATAS_PAKET = { ikon: 24, latar: 6 };
const KATA_IKON = "icon,icons,vector icon,glyph,silhouette,solid icon,symbol,sign,pictogram,flat design,minimal,simple,web icon,app icon,ui,design element,black and white,isolated,transparent";
const KATA_RAMADAN = "eid mubarak,islamic,ramadan kareem";
const KATA_3D = "3d icon,3d render,3d illustration,rendered,glossy,clay render,rounded,soft shadow,isolated on light background,web design,ui element,app,minimal";
const tambahKata3d = (kata, tema) => [kata, KATA_3D, tema === "ramadan" ? KATA_RAMADAN : ""].filter(Boolean).join(",");
const tambahKata = (kata, tema) => [kata, KATA_IKON, tema === "ramadan" ? KATA_RAMADAN : ""].filter(Boolean).join(",");

// ---------- perintah ----------
export function normalisasiTema(t) {
  const s = String(t || "").toLowerCase();
  if (/ramad|puasa|lebaran|idul\s*fitri|eid|hari\s*raya|islam|masjid|sahur/.test(s)) return "ramadan";
  if (/batik|kawung|truntum|nusantara|kerajinan|tenun/.test(s)) return "batik";
  return s.replace(/\s+/g, " ").trim() || "umum";
}
/** "/adobe ikon dan latar ramadan 12 ikon 3 latar", "/adobe ikon 3d ramadan 6", "/adobe ikon idul adha 8", "/adobe setuju", "/adobe batal", "/adobe bantuan". */
export function kenaliPerintahStok(teks) {
  const s = String(teks || "").replace(/[‎‏]/g, "").trim().replace(/^(?:@\S+\s*)+/, "");
  const m = /^\/adobe\b\s*(.*)$/is.exec(s);
  if (!m) return null;
  const sisa = m[1].trim(), kecil = sisa.toLowerCase();
  if (!kecil || /^(bantuan|help|\?)$/.test(kecil)) return { aksi: "bantuan" };
  if (/^(setuju|ya|ok|oke|lanjut)\b/.test(kecil)) return { aksi: "setuju" };
  if (/^(batal|tidak|cancel)\b/.test(kecil)) return { aksi: "batal" };
  if (/^riwayat\b/.test(kecil)) return { aksi: "riwayat" };
  const ikon = /\bikon|icon/.test(kecil), latar = /\blatar|pola|background|backdrop/.test(kecil);
  if (!ikon && !latar) return { aksi: "bantuan" };
  const paksa = /\bpaksa\b/.test(kecil), tiga = ikon && /\b3\s*d\b|tiga\s*dimensi/.test(kecil);
  const polos = kecil.replace(/\b3\s*d\b/g, " "), nLatar = /(\d+)\s*(?:latar|pola|background)/.exec(polos), nIkon = /(\d+)\s*(?:ikon|icon)/.exec(polos) || (ikon ? /(\d+)/.exec(polos) : null);
  const temaTeks = polos.replace(/\b(paksa|dan|ikon|icon|latar|pola|background|backdrop|tema|untuk|buat|buatkan|paket|tiga\s*dimensi)\b/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  const jumlahIkon = ikon ? Math.min(BATAS_PAKET.ikon, Math.max(1, Number((nIkon || [])[1]) || 12)) : 0;
  const jumlahLatar = latar ? Math.min(BATAS_PAKET.latar, Math.max(1, Number((nLatar || [])[1]) || 3)) : 0;
  return { aksi: "rencana", jenis: ikon && latar ? "keduanya" : ikon ? "ikon" : "latar", tema: normalisasiTema(temaTeks), temaAsli: temaTeks || "umum", jumlahIkon, jumlahLatar, paksa, tiga };
}
export function teksBantuanStok() {
  return [
    "Paket Adobe Stock (hanya pemilik):",
    "/adobe ikon dan latar ramadan 12 ikon 3 latar  -> bot menyusun rencana",
    "/adobe ikon 3d ramadan 6  -> ikon 3D (render relief membulat, JPEG ilustrasi)",
    "/adobe ikon idul adha 8  -> tema baru: ikon disusun AI (eksperimental, cek pratinjau)",
    "/adobe setuju  -> bot membuat paket (zip: ikon SVG + latar JPEG + CSV + pratinjau)",
    "/adobe batal   |   /adobe riwayat",
    "Unggah dan Submit tetap kamu kerjakan sendiri di contributor.stock.adobe.com (Upload CSV setelah berkasnya terunggah).",
    "Aturan penting: jangan unggah gambar yang mirip (maks 3 versi), patuhi batas pengiriman mingguan, dan putuskan label AI secara konsisten."
  ].join("\n");
}

// ---------- riwayat ----------
export function muatRiwayat(folder) {
  try { return JSON.parse(fs.readFileSync(path.join(folder, "riwayat.json"), "utf8")); } catch { return { paket: [] }; }
}
export function simpanRiwayat(folder, r) {
  fs.mkdirSync(folder, { recursive: true }); const p = path.join(folder, "riwayat.json"), t = p + ".part";
  fs.writeFileSync(t, JSON.stringify(r, null, 1)); fs.renameSync(t, p);
}
export function sudahAda(r) {
  const ikon = new Set(SUDAH_DIUNGGAH.ikon), latar = new Set(SUDAH_DIUNGGAH.latar), ikon3d = new Set(SUDAH_DIUNGGAH.ikon3d);
  for (const p of r.paket || []) { (p.ikon || []).forEach((x) => ikon.add(x)); (p.latar || []).forEach((x) => latar.add(x)); (p.ikon3d || []).forEach((x) => ikon3d.add(x)); }
  return { ikon, latar, ikon3d };
}
export const hariLalu = (tgl, n) => { const d = new Date(`${tgl}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
export function jumlahPaketPekanIni(r, tanggal) { const batas = hariLalu(tanggal, 6); return (r.paket || []).filter((p) => p.tanggal >= batas && p.tanggal <= tanggal).length; }

// ---------- katalog ikon (dari mesin Python) ----------
export function jalankanPython(args, { python = process.env.STOK_PYTHON || "python3", masuk, timeout = 120000 } = {}) {
  const r = spawnSync(python, [MESIN_IKON, ...args], { input: masuk, encoding: "utf8", timeout, maxBuffer: 20 << 20 });
  if (r.error || r.status !== 0) throw new Error(`mesin ikon gagal: ${(r.stderr || r.error?.message || "").toString().slice(-300)}`);
  return JSON.parse(r.stdout);
}
export function katalogIkon(opsi) { return jalankanPython(["daftar"], opsi); }

// ---------- ikon baru disusun AI (DSL JSON), WAJIB dicek manual lewat pratinjau ----------
export function promptIkonBaru({ tema, n, sudah }) {
  return `You design simple solid vector icons on a 64x64 grid for a stock-icon set about: "${tema}".
Propose ${n} DIFFERENT icon subjects (not in this list: ${[...sudah].slice(0, 60).join(", ") || "none"}). No brands, no logos, no people's faces, no text.
Each icon is a JSON shape tree. Allowed node types ("t"):
 circle{cx,cy,r} ellipse{cx,cy,rx,ry,rot} rect{x,y,w,h,r} poly{pts:[[x,y],...]} star{cx,cy,R,n,inner,rot} line{pts:[[x,y],...],w} arch{x,y,w,h} ring{cx,cy,r1,r2}
 crescent{cx,cy,r,geser,rr,ang} union{a:[nodes]} diff{a:node,b:[nodes]} inter{a:node,b:node}
Rules: everything must stay inside 2..62 on both axes; build the silhouette with union, then cut details with diff (thin cuts about 1.6-2.2 wide); simple, readable at small size, max about 25 nodes.
Return ONLY JSON: {"ikon":[{"nama":"lowercase-ascii-slug","judul":"English title ending with icon","kata":"10 comma separated english keywords","spek":{...}}]}`;
}
function ekstrakJson(t) { const s = String(t || ""), a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; } }
export async function usulIkonAi({ llm, tema, n, sudah }) {
  const j = ekstrakJson(await llm(promptIkonBaru({ tema, n, sudah })));
  const out = [];
  for (const it of j?.ikon || []) {
    const nama = String(it.nama || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
    if (!nama || sudah.has(nama) || !it.spek || out.some((o) => o.nama === nama)) continue;
    out.push({ nama, judul: bersihkanJudul(it.judul || `${nama} icon`), kata: String(it.kata || ""), spek: it.spek, sumber: "ai" });
    if (out.length >= n) break;
  }
  return out;
}

// ---------- rencana ----------
export async function susunRencana({ perintah, riwayat, llm, katalog, tanggal }) {
  const ada = sudahAda(riwayat); const { jenis, tema, paksa } = perintah;
  const tiga = !!perintah.tiga, rencana = { tema, temaAsli: perintah.temaAsli, jenis, tiga, ikon: [], latar: [], catatan: [], tanggal };
  const pakaiIkon = tiga ? ada.ikon3d : ada.ikon;
  if (jenis !== "latar") {
    const cocok = (katalog || []).filter((k) => k.tema === tema && (paksa || !pakaiIkon.has(k.nama)));
    rencana.ikon = cocok.slice(0, perintah.jumlahIkon).map((k) => ({ nama: k.nama, judul: k.judul, kata: k.kata, sumber: "katalog" }));
    const kurang = perintah.jumlahIkon - rencana.ikon.length;
    if (kurang > 0 && typeof llm === "function") {
      try {
        const ai = await usulIkonAi({ llm, tema: perintah.temaAsli, n: kurang, sudah: new Set([...pakaiIkon, ...(katalog || []).map((k) => k.nama)]) });
        rencana.ikon.push(...ai); if (ai.length) rencana.catatan.push(`${ai.length} ikon disusun AI (eksperimental): periksa lembar pratinjau sebelum mengunggah.`);
      } catch { rencana.catatan.push("Gagal meminta usulan ikon dari AI."); }
    }
    if (tiga && rencana.ikon.length) rencana.catatan.push("Ikon 3D memakai bentuk yang sama dengan ikon datar yang sudah kamu unggah. Adobe menilai variasi kecil dari desain yang sama sebagai mirip (maks 3 versi). Mulai dengan sedikit (4-6) lalu lihat hasil review; untuk lebih aman pilih subjek yang belum ada versi datarnya.");
    if (rencana.ikon.length < perintah.jumlahIkon) rencana.catatan.push(`Hanya ${rencana.ikon.length} ikon tersedia untuk tema ini (${perintah.jumlahIkon} diminta).`);
  }
  if (jenis !== "ikon") {
    const grup = LATAR.filter((l) => l.tema.includes(tema) || (tema !== "ramadan" && tema !== "batik" && l.tema.includes("umum")));
    const pilih = grup.filter((l) => paksa || !ada.latar.has(l.nama));
    rencana.latar = pilih.slice(0, perintah.jumlahLatar).map((l) => ({ nama: l.nama, judul: l.judul, kata: l.kata }));
    if (rencana.latar.length < perintah.jumlahLatar) rencana.catatan.push(`Hanya ${rencana.latar.length} latar baru untuk tema ini; yang lain sudah pernah dibuat (Adobe menolak konten mirip).`);
  }
  return rencana;
}
export function teksRencana(r) {
  const b = [`Rencana paket Adobe Stock - tema: ${r.temaAsli}`];
  if (r.ikon.length) b.push(`Ikon${r.tiga ? " 3D" : ""} (${r.ikon.length}): ${r.ikon.map((i) => i.nama + (i.sumber === "ai" ? "*" : "")).join(", ")}`);
  if (r.latar.length) b.push(`Latar (${r.latar.length}): ${r.latar.map((l) => l.nama).join(", ")}`);
  b.push(...r.catatan.map((c) => `- ${c}`));
  b.push(r.ikon.length + r.latar.length ? "Balas /adobe setuju untuk membuat, atau /adobe batal." : "Tidak ada yang bisa dibuat untuk permintaan ini.");
  return b.join("\n");
}

// ---------- lembar pratinjau ----------
export async function buatPratinjau(items, keluar) {
  const kol = Math.min(6, Math.max(1, items.length)), sel = 230, baris = Math.ceil(items.length / kol), W = kol * sel, H = baris * sel;
  const c = createCanvas(W, H), g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < items.length; i++) {
    const x = (i % kol) * sel, y = Math.floor(i / kol) * sel;
    try {
      const img = await loadImage(fs.readFileSync(items[i].berkas)), k = Math.min((sel - 28) / img.width, (sel - 28) / img.height);
      g.drawImage(img, x + (sel - img.width * k) / 2, y + 10 + (sel - 28 - img.height * k) / 2, img.width * k, img.height * k);
    } catch { g.fillStyle = "#c00"; g.fillRect(x + 20, y + 20, 40, 40); g.fillStyle = "#fff"; }
    g.fillStyle = "#555"; g.font = "13px sans-serif"; g.fillText(`${i + 1}. ${items[i].nama}`.slice(0, 30), x + 8, y + sel - 8);
    g.strokeStyle = "#e5e7eb"; g.strokeRect(x + 0.5, y + 0.5, sel - 1, sel - 1);
  }
  fs.writeFileSync(keluar, c.toBuffer("image/png")); return keluar;
}

// ---------- membuat paket ----------
function zipkan(folder, namaZip, python = process.env.STOK_PYTHON || "python3") {
  const r = spawnSync(python, ["-m", "zipfile", "-c", namaZip, ...fs.readdirSync(folder)], { cwd: folder, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`zip gagal: ${String(r.stderr).slice(-200)}`);
}
export const PETUNJUK = `PAKET ADOBE STOCK
1. Buka contributor.stock.adobe.com > Upload. Unggah SATU batch dulu (folder ikon/ ATAU ikon3d/ ATAU latar/), tunggu muncul di tab New.
2. Klik Upload CSV, pilih metadata-ikon.csv (atau metadata-ikon3d.csv / metadata-latar.csv) yang sesuai batchnya, lalu Refresh.
3. Ikon SVG (folder ikon/): centang "This is an icon" > "Single icon". Ikon 3D (folder ikon3d/, JPEG) dan latar (folder latar/): tipe Illustration, JANGAN centang "This is an icon". Pilih kategori.
4. Label AI: putuskan dan konsisten (saran aman: centang "Created using generative AI tools").
5. Periksa beberapa berkas, lalu Submit. Jangan unggah gambar yang mirip; patuhi batas pengiriman mingguan.
Bot tidak mengunggah apa pun.
`;

export async function buatPaket({ rencana, llm, folder, python, tanggal }) {
  const id = `${tanggal}-${Date.now().toString(36)}`, kerja = path.join(folder, `paket-${id}`);
  const dIkon = path.join(kerja, "ikon"), dLatar = path.join(kerja, "latar"); fs.mkdirSync(kerja, { recursive: true });
  const lapor = { ikon: [], ikon3d: [], latar: [], gagal: [] }, pratinjau = [], dIkon3d = path.join(kerja, "ikon3d");
  if (rencana.ikon.length) {
    const dSvg = rencana.tiga ? path.join(kerja, "_svg") : dIkon;
    const hasil = jalankanPython(["render", "--keluar", dSvg], { python, masuk: JSON.stringify({ ikon: rencana.ikon.map((i) => ({ nama: i.nama, spek: i.spek })) }) });
    let nomor = 0;
    for (const h of hasil) {
      const it = rencana.ikon.find((i) => i.nama === h.nama); if (!it) continue;
      if (!h.ok) { lapor.gagal.push(`${h.nama}: ${h.galat}`); continue; }
      if (rencana.tiga) {
        try {
          const nama3 = h.nama.slice(0, 23), berkas3 = path.join(dIkon3d, `3d-${nama3}.jpg`), i3 = nomor++;
          await render3d({ svg: fs.readFileSync(h.berkas, "utf8"), keluar: berkas3, palet: URUTAN_PALET[i3 % URUTAN_PALET.length], bahan: i3 % 2 ? "kilap" : "clay" });
          const meta = await metadataUntuk({ llm, berkas: path.basename(berkas3), subjek: `3D ${it.judul}`, jenis: "ikon3d", tema: rencana.temaAsli, judulBawaan: `3D ${it.judul}`, kataBawaan: tambahKata3d(it.kata, rencana.tema) });
          lapor.ikon3d.push({ ...meta, nama: h.nama, jalur: berkas3 }); pratinjau.push({ nama: `3d-${h.nama}`, berkas: berkas3 });
        } catch (e) { lapor.gagal.push(`${h.nama} (3D): ${String(e.message).slice(0, 100)}`); }
        continue;
      }
      const meta = await metadataUntuk({ llm, berkas: path.basename(h.berkas), subjek: it.judul, jenis: "ikon", tema: rencana.temaAsli, judulBawaan: it.judul, kataBawaan: tambahKata(it.kata, rencana.tema) });
      lapor.ikon.push({ ...meta, nama: it.nama, jalur: h.berkas }); pratinjau.push({ nama: it.nama, berkas: h.berkas });
    }
    if (rencana.tiga) fs.rmSync(dSvg, { recursive: true, force: true });
  }
  for (const l of rencana.latar) {
    try {
      const berkas = path.join(dLatar, `${l.nama}.jpg`); if (path.basename(berkas).length > 30) throw new Error("nama berkas melebihi 30 karakter");
      await renderLatar(l.nama, berkas);
      const meta = await metadataUntuk({ llm, berkas: path.basename(berkas), subjek: l.judul, jenis: "latar", tema: rencana.temaAsli, judulBawaan: l.judul, kataBawaan: l.kata });
      lapor.latar.push({ ...meta, nama: l.nama, jalur: berkas }); pratinjau.push({ nama: l.nama, berkas });
    } catch (e) { lapor.gagal.push(`${l.nama}: ${String(e.message).slice(0, 120)}`); }
  }
  if (lapor.ikon.length) fs.writeFileSync(path.join(kerja, "metadata-ikon.csv"), buatCsv(lapor.ikon.map((m) => ({ berkas: m.berkas, judul: m.judul, kata: m.kata }))));
  if (lapor.ikon3d.length) fs.writeFileSync(path.join(kerja, "metadata-ikon3d.csv"), buatCsv(lapor.ikon3d.map((m) => ({ berkas: m.berkas, judul: m.judul, kata: m.kata }))));
  if (lapor.latar.length) fs.writeFileSync(path.join(kerja, "metadata-latar.csv"), buatCsv(lapor.latar.map((m) => ({ berkas: m.berkas, judul: m.judul, kata: m.kata }))));
  fs.writeFileSync(path.join(kerja, "PETUNJUK.txt"), PETUNJUK);
  const zip = path.join(folder, `paket-adobe-${id}.zip`); zipkan(kerja, zip, python);
  const png = pratinjau.length ? await buatPratinjau(pratinjau, path.join(folder, `pratinjau-${id}.png`)) : null;
  return { id, folder: kerja, zip, pratinjau: png, lapor, ikon: lapor.ikon.map((m) => m.nama), ikon3d: lapor.ikon3d.map((m) => m.nama), latar: lapor.latar.map((m) => m.nama) };
}

// ---------- penangan WhatsApp ----------
const tunda = new Map(); // chatId -> { rencana, waktu }
export const _tunda = tunda;
/**
 * @param {object} o teks, chatId, adalahPemilik, grup, disebut, deps:{llm}, kirimTeks, kirimDokumen, kirimGambar?, antrean?, folder, konfig:{maksPekan}, tanggal, python?
 * @returns {Promise<boolean>} true bila pesan sudah ditangani
 */
export async function tanganiStokWa(o) {
  const { teks, chatId = "default", adalahPemilik = false, grup = null, deps = {}, kirimTeks, kirimDokumen, kirimGambar, antrean, folder = path.join(os.tmpdir(), "ayyubi-adobe"), konfig = {}, python } = o;
  const tanggal = o.tanggal || new Date().toISOString().slice(0, 10);
  const p = kenaliPerintahStok(teks); if (!p) return false;
  if (!adalahPemilik) { await kirimTeks("Maaf, fitur ini hanya untuk pemilik bot."); return true; }
  if (p.aksi === "bantuan") { await kirimTeks(teksBantuanStok()); return true; }
  if (p.aksi === "batal") { tunda.delete(chatId); await kirimTeks("Rencana dibatalkan."); return true; }
  const riwayat = muatRiwayat(folder);
  if (p.aksi === "riwayat") {
    const a = sudahAda(riwayat); await kirimTeks(`Sudah dibuat/diunggah: ${a.ikon.size} ikon, ${a.ikon3d.size} ikon 3D, ${a.latar.size} latar. Paket 7 hari terakhir: ${jumlahPaketPekanIni(riwayat, tanggal)} (batas ${konfig.maksPekan ?? 2}).`); return true;
  }
  if (p.aksi === "rencana") {
    const maks = konfig.maksPekan ?? 2;
    if (!p.paksa && jumlahPaketPekanIni(riwayat, tanggal) >= maks) { await kirimTeks(`Batas ${maks} paket per 7 hari sudah tercapai (agar tidak menumpuk konten dan melewati batas pengiriman Adobe). Tambahkan kata "paksa" bila memang perlu.`); return true; }
    let katalog = []; try { katalog = katalogIkon({ python }); } catch (e) { await kirimTeks(`Mesin ikon belum siap (${String(e.message).slice(0, 100)}). Pasang: pip install skia-pathops`); return true; }
    const rencana = await susunRencana({ perintah: p, riwayat, llm: deps.llm, katalog, tanggal });
    if (!rencana.ikon.length && !rencana.latar.length) { await kirimTeks(teksRencana(rencana)); return true; }
    tunda.set(chatId, { rencana, waktu: Date.now() }); await kirimTeks(teksRencana(rencana)); return true;
  }
  if (p.aksi === "setuju") {
    const t = tunda.get(chatId);
    if (!t || Date.now() - t.waktu > 30 * 60 * 1000) { tunda.delete(chatId); await kirimTeks("Tidak ada rencana yang menunggu (atau sudah lewat 30 menit). Ketik /adobe ikon ... lagi."); return true; }
    tunda.delete(chatId); await kirimTeks("Siap, paket sedang dibuat...");
    const kerja = () => buatPaket({ rencana: t.rencana, llm: deps.llm, folder, python, tanggal });
    try {
      const h = antrean ? await antrean.jalankan(kerja) : await kerja();
      riwayat.paket.push({ tanggal, tema: t.rencana.temaAsli, ikon: h.ikon, ikon3d: h.ikon3d, latar: h.latar }); simpanRiwayat(folder, riwayat);
      if (h.pratinjau) await (kirimGambar || kirimDokumen)(h.pratinjau, path.basename(h.pratinjau), "Pratinjau: periksa dulu sebelum mengunggah.");
      const ket = [`Paket siap: ${h.ikon.length} ikon, ${h.ikon3d.length} ikon 3D, ${h.latar.length} latar. Kata kunci: ${[...h.lapor.ikon, ...h.lapor.ikon3d, ...h.lapor.latar].filter((m) => m.sumber === "ai").length} dari AI, sisanya dari katalog.`, ...(h.lapor.gagal.length ? [`Gagal: ${h.lapor.gagal.join("; ")}`] : []), "Unggah dan Submit kamu kerjakan sendiri (petunjuk ada di dalam zip)."].join("\n");
      await kirimDokumen(h.zip, path.basename(h.zip), ket);
    } catch (e) { await kirimTeks(`Maaf, paket gagal dibuat (${String(e.message).slice(0, 140)}).`); }
    return true;
  }
  return false;
}
