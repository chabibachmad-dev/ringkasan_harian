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
import { URUTAN_PALET } from "./ikon3d.mjs";
import { render3dPilih } from "./ikon3d-pilih.mjs";
import { VIDEO, renderVideo, ambilBingkai, periksaVideo, namaBerkasVideo } from "./video-mesin.mjs";

const SINI = path.dirname(fileURLToPath(import.meta.url));
export const MESIN_IKON = path.join(SINI, "ikon-mesin.py");
// yang SUDAH diunggah pemilik pada paket pertama (supaya bot tidak membuat ulang gambar yang sama; Adobe menolak konten mirip)
export const SUDAH_DIUNGGAH = {
  ikon: ["hilal", "hilal-bintang", "masjid", "menara", "lentera", "ketupat", "kurma", "tasbih", "sajadah", "bedug", "alquran", "peci", "hadiah", "bintang-8", "minuman", "buka-puasa", "jam", "kalender", "amplop-thr", "kotak-donasi", "koin-hilal", "sahur", "weker-sahur", "kembang-api"],
  ikon3d: ["masjid", "hilal-bintang", "lentera", "menara", "ketupat", "hilal"],
  video: ["bintang-islami-emas"],
  latar: ["batik-kawung-sogan", "batik-truntum-biru", "pola-islami-hijau-emas", "latar-malam-ramadan", "latar-lebaran-ketupat", "latar-abstrak-gradien"]
};
export const BATAS_PAKET = { ikon: 24, latar: 6, video: 4 };
const KATA_VERTIKAL = "vertical video,vertical background,vertical,9:16,portrait,mobile background";
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
  const sisa = m[1].trim(); let kecil = sisa.toLowerCase();
  if (!kecil || /^(bantuan|help|\?)$/.test(kecil)) return { aksi: "bantuan" };
  if (/^(setuju|ya|ok|oke|lanjut)\b/.test(kecil)) return { aksi: "setuju" };
  if (/^(batal|tidak|cancel)\b/.test(kecil)) return { aksi: "batal" };
  if (/^riwayat\b/.test(kecil)) return { aksi: "riwayat" };
  kecil = kecil.replace(/\b(latar|pola|background)\s+(gerak|bergerak|animasi)\b/g, " video ");
  const ikon = /\bikon|icon/.test(kecil), latar = /\blatar|pola|background|backdrop/.test(kecil), video = /\b(video|klip|animasi)\b|\bgerak\b/.test(kecil), vertikal = video && /\b(vertikal|vertical|portrait)\b|\b9\s*:\s*16\b/.test(kecil);
  if (!ikon && !latar && !video) return { aksi: "bantuan" };
  const paksa = /\bpaksa\b/.test(kecil), tiga = ikon && /\b3\s*d\b|tiga\s*dimensi/.test(kecil);
  const polos = kecil.replace(/\b3\s*d\b/g, " "), nLatar = /(\d+)\s*(?:latar|pola|background)/.exec(polos), nIkon = /(\d+)\s*(?:ikon|icon)/.exec(polos) || (ikon ? /(\d+)/.exec(polos) : null), nVideo = /(\d+)\s*(?:video|klip)/.exec(polos) || (video && !ikon && !latar ? /(\d+)/.exec(polos.replace(/\b9\s*:\s*16\b/g, " ")) : null);
  const temaTeks = polos.replace(/\b\d+\s*:\s*\d+\b/g, " ").replace(/\b(paksa|dan|ikon|icon|latar|pola|background|backdrop|tema|untuk|buat|buatkan|paket|tiga\s*dimensi|video|klip|animasi|gerak|bergerak|vertikal|vertical|portrait|loop)\b/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  const jumlahIkon = ikon ? Math.min(BATAS_PAKET.ikon, Math.max(1, Number((nIkon || [])[1]) || 12)) : 0;
  const jumlahLatar = latar ? Math.min(BATAS_PAKET.latar, Math.max(1, Number((nLatar || [])[1]) || 3)) : 0;
  const jumlahVideo = video ? Math.min(BATAS_PAKET.video, Math.max(1, Number((nVideo || [])[1]) || 2)) : 0;
  return { aksi: "rencana", jenis: video && !ikon && !latar ? "video" : ikon && latar ? "keduanya" : ikon ? "ikon" : "latar", tema: normalisasiTema(temaTeks), temaAsli: temaTeks || "umum", jumlahIkon, jumlahLatar, jumlahVideo, vertikal, paksa, tiga };
}
export function teksBantuanStok() {
  return [
    "Paket Adobe Stock (hanya pemilik):",
    "/adobe ikon dan latar ramadan 12 ikon 3 latar  -> bot menyusun rencana",
    "/adobe ikon 3d ramadan 6  -> ikon 3D (render relief membulat, JPEG ilustrasi)",
    "/adobe ikon idul adha 8  -> tema baru: ikon disusun AI (eksperimental, cek pratinjau)",
    "/adobe video ramadan 3  -> latar gerak loop 10 detik (MP4 1080p, tanpa suara); tambah kata vertikal untuk 1080x1920",
    "/adobe setuju  -> bot membuat paket (zip: ikon SVG + latar JPEG + video MP4 + CSV + pratinjau)",
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
  const ikon = new Set(SUDAH_DIUNGGAH.ikon), latar = new Set(SUDAH_DIUNGGAH.latar), ikon3d = new Set(SUDAH_DIUNGGAH.ikon3d), video = new Set(SUDAH_DIUNGGAH.video);
  for (const p of r.paket || []) { (p.video || []).forEach((x) => video.add(x)); (p.ikon || []).forEach((x) => ikon.add(x)); (p.latar || []).forEach((x) => latar.add(x)); (p.ikon3d || []).forEach((x) => ikon3d.add(x)); }
  return { ikon, latar, ikon3d, video };
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
  const tiga = !!perintah.tiga, rencana = { tema, temaAsli: perintah.temaAsli, jenis, tiga, vertikal: !!perintah.vertikal, ikon: [], latar: [], video: [], catatan: [], tanggal };
  const pakaiIkon = tiga ? ada.ikon3d : ada.ikon;
  if (jenis !== "latar" && jenis !== "video") {
    const cocok = (katalog || []).filter((k) => k.tema === tema && (paksa || !pakaiIkon.has(k.nama)));
    rencana.ikon = cocok.slice(0, perintah.jumlahIkon).map((k) => ({ nama: k.nama, judul: k.judul, kata: k.kata, sumber: "katalog" }));
    const kurang = perintah.jumlahIkon - rencana.ikon.length;
    if (kurang > 0 && typeof llm !== "function") rencana.catatan.push("Model AI belum tersambung ke fitur ini (deps.llm kosong), jadi hanya ikon dari katalog yang bisa dipakai. Pakai tema katalog (mis. ramadan) atau minta penyambungan model AI.");
    if (kurang > 0 && typeof llm === "function") {
      try {
        const ai = await usulIkonAi({ llm, tema: perintah.temaAsli, n: kurang, sudah: new Set([...pakaiIkon, ...(katalog || []).map((k) => k.nama)]) });
        rencana.ikon.push(...ai);
        if (ai.length) rencana.catatan.push(`${ai.length} ikon disusun AI (eksperimental): periksa lembar pratinjau sebelum mengunggah.`);
        else rencana.catatan.push("Model AI menjawab, tetapi tidak ada usulan ikon yang valid (jawaban bukan JSON yang sesuai atau semua nama bentrok). Coba ulangi atau perkecil jumlah ikon.");
      } catch (e) { rencana.catatan.push(`Gagal meminta usulan ikon dari AI (${String(e && e.message || e).slice(0, 100)}).`); }
    }
    if (tiga && rencana.ikon.length) rencana.catatan.push("Ikon 3D memakai bentuk yang sama dengan ikon datar yang sudah kamu unggah. Adobe menilai variasi kecil dari desain yang sama sebagai mirip (maks 3 versi). Mulai dengan sedikit (4-6) lalu lihat hasil review; untuk lebih aman pilih subjek yang belum ada versi datarnya.");
    if (rencana.ikon.length < perintah.jumlahIkon) rencana.catatan.push(`Hanya ${rencana.ikon.length} ikon tersedia untuk tema ini (${perintah.jumlahIkon} diminta).`);
  }
  if (jenis !== "ikon" && jenis !== "video") {
    const grup = LATAR.filter((l) => l.tema.includes(tema) || (tema !== "ramadan" && tema !== "batik" && l.tema.includes("umum")));
    const pilih = grup.filter((l) => paksa || !ada.latar.has(l.nama));
    rencana.latar = pilih.slice(0, perintah.jumlahLatar).map((l) => ({ nama: l.nama, judul: l.judul, kata: l.kata }));
    if (rencana.latar.length < perintah.jumlahLatar) rencana.catatan.push(`Hanya ${rencana.latar.length} latar baru untuk tema ini; yang lain sudah pernah dibuat (Adobe menolak konten mirip).`);
  }
  if (perintah.jumlahVideo > 0) {
    const grup = VIDEO.filter((v) => v.tema.includes(tema) || (tema !== "ramadan" && tema !== "batik" && v.tema.includes("umum")));
    const pilih = grup.filter((v) => paksa || !ada.video.has(v.nama));
    rencana.video = pilih.slice(0, perintah.jumlahVideo).map((v) => ({ nama: v.nama, judul: v.judul, kata: v.kata }));
    if (rencana.video.length < perintah.jumlahVideo) rencana.catatan.push(`Hanya ${rencana.video.length} video baru untuk tema ini; desain lain sudah pernah dibuat (Adobe menolak konten mirip, maks 3 versi).`);
    if (rencana.vertikal && rencana.video.length) rencana.catatan.push("Versi vertikal dari desain yang sama dengan klip horizontal dihitung mirip oleh Adobe; utamakan desain yang belum pernah kamu unggah.");
    if (rencana.video.length) rencana.catatan.push("Render video butuh beberapa menit per klip (hasil: MP4 H.264 10 dtk, 30 fps, tanpa suara, loop mulus).");
  }
  return rencana;
}
export function teksRencana(r) {
  const b = [`Rencana paket Adobe Stock - tema: ${r.temaAsli}`];
  if (r.ikon.length) b.push(`Ikon${r.tiga ? " 3D" : ""} (${r.ikon.length}): ${r.ikon.map((i) => i.nama + (i.sumber === "ai" ? "*" : "")).join(", ")}`);
  if (r.latar.length) b.push(`Latar (${r.latar.length}): ${r.latar.map((l) => l.nama).join(", ")}`);
  if ((r.video || []).length) b.push(`Video${r.vertikal ? " vertikal" : ""} (${r.video.length}): ${r.video.map((v) => v.nama).join(", ")}`);
  b.push(...r.catatan.map((c) => `- ${c}`));
  b.push(r.ikon.length + r.latar.length + (r.video || []).length ? "Balas /adobe setuju untuk membuat, atau /adobe batal." : "Tidak ada yang bisa dibuat untuk permintaan ini.");
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
export const PETUNJUK_VIDEO = `
VIDEO (folder video/, MP4 tanpa suara, loop mulus)
- Unggah lewat Contributor Portal > Upload. Pilih label "Created using generative AI tools" (konsisten dengan konten lain). Tanpa model/property release karena tidak ada orang atau properti.
- Judul dan kata kunci ada di metadata-video.txt (dan metadata-video.csv bila portal menyediakan Upload CSV untuk video; bila tidak, ketik atau salin manual). Klip vertikal sudah memuat kata "vertical".
- Spesifikasi sudah diperiksa bot dengan ffprobe: H.264 MP4, 5-60 detik, frame rate dan resolusi yang diterima Adobe. Jangan ubah ukuran atau frame rate-nya.
- Moderasi video bisa berminggu-minggu. Jangan unggah banyak variasi dari desain yang sama (maks 3 versi).
`;

export async function buatPaket({ rencana, llm, folder, python, tanggal, videoOpsi = {} }) {
  const id = `${tanggal}-${Date.now().toString(36)}`, kerja = path.join(folder, `paket-${id}`);
  const dIkon = path.join(kerja, "ikon"), dLatar = path.join(kerja, "latar"); fs.mkdirSync(kerja, { recursive: true });
  const lapor = { ikon: [], ikon3d: [], latar: [], video: [], gagal: [], info: [] }, pratinjau = [], dIkon3d = path.join(kerja, "ikon3d");
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
          const r3 = await render3dPilih({ svg: fs.readFileSync(h.berkas, "utf8"), keluar: berkas3, palet: URUTAN_PALET[i3 % URUTAN_PALET.length], bahan: i3 % 2 ? "kilap" : "clay" });
          if (r3.catatan) lapor.info.push(`${h.nama}: ${r3.catatan}`);
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
  const dVideo = path.join(kerja, "video"), dPr = path.join(folder, `_pr-${id}`);
  for (const v of rencana.video || []) {
    try {
      const nm = namaBerkasVideo(v.nama, rencana.vertikal), berkas = path.join(dVideo, nm);
      await renderVideo(v.nama, berkas, { vertikal: rencana.vertikal, detik: videoOpsi.detik, fps: videoOpsi.fps, lebar: videoOpsi.lebar, tinggi: videoOpsi.tinggi });
      const pk = periksaVideo(berkas, { longgar: !!videoOpsi.longgar });
      if (!pk.ok) throw new Error(`tidak memenuhi syarat Adobe: ${pk.masalah.join("; ")}`);
      const bingkai = ambilBingkai(berkas, path.join(dPr, `${v.nama}.jpg`), Math.min(3, (videoOpsi.detik || 10) / 3));
      const meta = await metadataUntuk({ llm, berkas: nm, subjek: v.judul, jenis: "video", tema: rencana.temaAsli, judulBawaan: rencana.vertikal ? `Vertical ${v.judul}` : v.judul, kataBawaan: rencana.vertikal ? `${KATA_VERTIKAL},${v.kata}` : v.kata });
      lapor.video.push({ ...meta, nama: v.nama, jalur: berkas, info: pk.info }); pratinjau.push({ nama: `v-${v.nama}`, berkas: bingkai });
    } catch (e) { lapor.gagal.push(`${v.nama} (video): ${String(e.message).slice(0, 140)}`); }
  }
  if (lapor.ikon.length) fs.writeFileSync(path.join(kerja, "metadata-ikon.csv"), buatCsv(lapor.ikon.map((m) => ({ berkas: m.berkas, judul: m.judul, kata: m.kata }))));
  if (lapor.ikon3d.length) fs.writeFileSync(path.join(kerja, "metadata-ikon3d.csv"), buatCsv(lapor.ikon3d.map((m) => ({ berkas: m.berkas, judul: m.judul, kata: m.kata }))));
  if (lapor.latar.length) fs.writeFileSync(path.join(kerja, "metadata-latar.csv"), buatCsv(lapor.latar.map((m) => ({ berkas: m.berkas, judul: m.judul, kata: m.kata }))));
  if (lapor.video.length) {
    fs.writeFileSync(path.join(kerja, "metadata-video.csv"), buatCsv(lapor.video.map((m) => ({ berkas: m.berkas, judul: m.judul, kata: m.kata }))));
    fs.writeFileSync(path.join(kerja, "metadata-video.txt"), lapor.video.map((m) => `Berkas: ${m.berkas}\nJudul: ${m.judul}\nKata kunci: ${m.kata.join(", ")}\nKategori: Graphic Resources\nLabel: Created using generative AI tools\nSpesifikasi: ${m.info.lebar}x${m.info.tinggi}, ${m.info.fps} fps, ${m.info.detik} dtk, ${m.info.kodek}, ${m.info.ukuranMB} MB\n`).join("\n"));
  }
  fs.writeFileSync(path.join(kerja, "PETUNJUK.txt"), PETUNJUK + (lapor.video.length ? PETUNJUK_VIDEO : ""));
  const zip = path.join(folder, `paket-adobe-${id}.zip`); zipkan(kerja, zip, python);
  const png = pratinjau.length ? await buatPratinjau(pratinjau, path.join(folder, `pratinjau-${id}.png`)) : null;
  fs.rmSync(dPr, { recursive: true, force: true });
  return { id, folder: kerja, zip, pratinjau: png, lapor, ikon: lapor.ikon.map((m) => m.nama), ikon3d: lapor.ikon3d.map((m) => m.nama), latar: lapor.latar.map((m) => m.nama), video: lapor.video.map((m) => m.nama) };
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
    const a = sudahAda(riwayat); await kirimTeks(`Sudah dibuat/diunggah: ${a.ikon.size} ikon, ${a.ikon3d.size} ikon 3D, ${a.latar.size} latar, ${a.video.size} video. Paket 7 hari terakhir: ${jumlahPaketPekanIni(riwayat, tanggal)} (batas ${konfig.maksPekan ?? 2}).`); return true;
  }
  if (p.aksi === "rencana") {
    const maks = konfig.maksPekan ?? 2;
    if (!p.paksa && jumlahPaketPekanIni(riwayat, tanggal) >= maks) { await kirimTeks(`Batas ${maks} paket per 7 hari sudah tercapai (agar tidak menumpuk konten dan melewati batas pengiriman Adobe). Tambahkan kata "paksa" bila memang perlu.`); return true; }
    let katalog = []; if (p.jumlahIkon > 0) try { katalog = katalogIkon({ python }); } catch (e) { await kirimTeks(`Mesin ikon belum siap (${String(e.message).slice(0, 100)}). Pasang: pip install skia-pathops`); return true; }
    const rencana = await susunRencana({ perintah: p, riwayat, llm: deps.llm, katalog, tanggal });
    if (!rencana.ikon.length && !rencana.latar.length && !(rencana.video || []).length) { await kirimTeks(teksRencana(rencana)); return true; }
    tunda.set(chatId, { rencana, waktu: Date.now() }); await kirimTeks(teksRencana(rencana)); return true;
  }
  if (p.aksi === "setuju") {
    const t = tunda.get(chatId);
    if (!t || Date.now() - t.waktu > 30 * 60 * 1000) { tunda.delete(chatId); await kirimTeks("Tidak ada rencana yang menunggu (atau sudah lewat 30 menit). Ketik /adobe ikon ... lagi."); return true; }
    tunda.delete(chatId); await kirimTeks("Siap, paket sedang dibuat...");
    const kerja = () => buatPaket({ rencana: t.rencana, llm: deps.llm, folder, python, tanggal, videoOpsi: konfig.videoOpsi || {} });
    try {
      const h = antrean ? await antrean.jalankan(kerja) : await kerja();
      riwayat.paket.push({ tanggal, tema: t.rencana.temaAsli, ikon: h.ikon, ikon3d: h.ikon3d, latar: h.latar, video: h.video }); simpanRiwayat(folder, riwayat);
      if (h.pratinjau) await (kirimGambar || kirimDokumen)(h.pratinjau, path.basename(h.pratinjau), "Pratinjau: periksa dulu sebelum mengunggah.");
      const ket = [`Paket siap: ${h.ikon.length} ikon, ${h.ikon3d.length} ikon 3D, ${h.latar.length} latar, ${h.video.length} video. Kata kunci: ${[...h.lapor.ikon, ...h.lapor.ikon3d, ...h.lapor.latar, ...h.lapor.video].filter((m) => m.sumber === "ai").length} dari AI, sisanya dari katalog.`, ...(h.lapor.gagal.length ? [`Gagal: ${h.lapor.gagal.join("; ")}`] : []), ...((h.lapor.info || []).length ? [`Info 3D: ${[...new Set(h.lapor.info.map((x) => x.split(": ").slice(1).join(": ")))].join("; ")}`] : []), "Unggah dan Submit kamu kerjakan sendiri (petunjuk ada di dalam zip)."].join("\n");
      await kirimDokumen(h.zip, path.basename(h.zip), ket);
    } catch (e) { await kirimTeks(`Maaf, paket gagal dibuat (${String(e.message).slice(0, 140)}).`); }
    return true;
  }
  return false;
}
