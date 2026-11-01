// Menyiapkan FOTO ASLI untuk diunggah ke situs stok (Shutterstock): cek syarat teknis dan perbesar bila di bawah 4 megapiksel.
// Syarat Shutterstock (Okt 2026, laman bantuan kontributor): JPEG/TIFF, minimal 4 MP (lebar x tinggi, mis. 2000x2000), disarankan 5 MP+,
// ukuran berkas maksimal 50 MB, ruang warna sRGB. "4" itu MEGAPIKSEL, bukan megabita. Shutterstock tidak menerima konten buatan AI dari kontributor.
// Memakai ffmpeg/ffprobe (sudah dibutuhkan modul motion). Tanpa pustaka tambahan.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SYARAT = { minMP: 4, targetMP: 5, maksMB: 50, maksFaktor: 2.5, faktorWaspada: 1.6, maksMasukMB: 40 };

export function bacaGambar(berkas, { ffprobe = "ffprobe" } = {}) {
  const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name", "-of", "csv=p=0", berkas], { encoding: "utf8" });
  const [kodek, w, h] = String(r.stdout || "").trim().split(",");
  const lebar = Number(w), tinggi = Number(h);
  if (r.status !== 0 || !(lebar > 0) || !(tinggi > 0)) throw Object.assign(new Error("Berkas bukan gambar yang bisa dibaca"), { ramah: "Berkas itu bukan gambar yang bisa dibaca. Kirim foto JPEG/PNG/TIFF sebagai dokumen." });
  return { lebar, tinggi, mp: (lebar * tinggi) / 1e6, kodek, ukuranMB: fs.statSync(berkas).size / 1048576 };
}

/** Hitung rencana pembesaran. Tidak menyentuh berkas. */
export function rencanaUpscale({ lebar, tinggi }, o = {}) {
  const { minMP, targetMP, maksFaktor, faktorWaspada } = { ...SYARAT, ...o };
  const mp = (lebar * tinggi) / 1e6, peringatan = [];
  if (mp >= minMP) return { perlu: false, bisa: true, faktor: 1, lebarBaru: lebar, tinggiBaru: tinggi, mpBaru: mp, peringatan };
  const faktor = Math.sqrt((targetMP * 1e6) / (lebar * tinggi));
  if (faktor > maksFaktor) return { perlu: true, bisa: false, faktor, lebarBaru: lebar, tinggiBaru: tinggi, mpBaru: mp, peringatan: [`Gambar terlalu kecil (${mp.toFixed(2)} MP). Perlu diperbesar ${faktor.toFixed(1)} kali, hasilnya buram dan hampir pasti ditolak karena kualitas. Pakai berkas asli dari kamera.`] };
  let lebarBaru = Math.ceil(lebar * faktor), tinggiBaru = Math.ceil(tinggi * faktor);
  while (lebarBaru * tinggiBaru < minMP * 1e6 * 1.02) { lebarBaru += 2; tinggiBaru = Math.ceil((tinggi * lebarBaru) / lebar); }
  if (faktor > faktorWaspada) peringatan.push(`Diperbesar ${faktor.toFixed(1)} kali: detail tidak bertambah, hasil bisa tampak lembut. Pembesaran sebaiknya di bawah ${faktorWaspada} kali.`);
  else peringatan.push("Pembesaran tidak menambah detail asli; bila reviewer menilai kurang tajam, foto bisa ditolak. Selalu utamakan berkas asli beresolusi penuh.");
  return { perlu: true, bisa: true, faktor, lebarBaru, tinggiBaru, mpBaru: (lebarBaru * tinggiBaru) / 1e6, peringatan };
}

/** Daftar periksa syarat teknis untuk satu berkas. */
export function periksaStok(info) {
  return [
    { ok: info.mp >= SYARAT.minMP, teks: `Resolusi ${info.lebar}x${info.tinggi} = ${info.mp.toFixed(2)} MP (minimal ${SYARAT.minMP} MP)` },
    { ok: info.mp >= SYARAT.targetMP, lunak: true, teks: `Disarankan ${SYARAT.targetMP} MP atau lebih` },
    { ok: info.ukuranMB <= SYARAT.maksMB, teks: `Ukuran ${info.ukuranMB.toFixed(1)} MB (maksimal ${SYARAT.maksMB} MB)` }
  ];
}

/**
 * Siapkan satu foto: JPEG kualitas tertinggi, >= 4 MP. Bila sudah memenuhi syarat dan sudah JPEG, berkas disalin apa adanya.
 * @returns {{berkas, lebar, tinggi, mp, ukuranMB, faktor, diubah, peringatan:string[]}}
 */
export function siapkanUntukStok({ masuk, keluar, ffmpeg = "ffmpeg", ffprobe = "ffprobe", ...opsi }) {
  const info = bacaGambar(masuk, { ffprobe });
  const rc = rencanaUpscale(info, opsi);
  if (!rc.bisa) throw Object.assign(new Error(rc.peringatan[0]), { ramah: rc.peringatan[0] });
  const jpeg = info.kodek === "mjpeg";
  fs.mkdirSync(path.dirname(keluar), { recursive: true });
  const peringatan = [...rc.peringatan];
  if (!rc.perlu && jpeg) { fs.copyFileSync(masuk, keluar); }
  else {
    const vf = rc.perlu ? `scale=${rc.lebarBaru}:${rc.tinggiBaru}:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.45:5:5:0.0` : "null";
    const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", masuk, "-frames:v", "1", "-vf", vf, "-q:v", "1", "-pix_fmt", "yuvj420p", keluar], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`ffmpeg gagal: ${String(r.stderr).slice(-200)}`);
    if (!rc.perlu) peringatan.push("Format diubah ke JPEG (Shutterstock menyarankan JPEG).");
  }
  const hasil = bacaGambar(keluar, { ffprobe });
  if (hasil.mp < SYARAT.minMP) throw new Error(`Hasil masih ${hasil.mp.toFixed(2)} MP, di bawah ${SYARAT.minMP} MP`);
  if (hasil.ukuranMB > SYARAT.maksMB) throw new Error(`Hasil ${hasil.ukuranMB.toFixed(0)} MB, melebihi batas ${SYARAT.maksMB} MB`);
  if (info.mp < 1.2) peringatan.push("Gambar sumber sangat kecil. Bila dikirim lewat WhatsApp sebagai foto, WhatsApp sudah mengecilkannya; kirim ulang sebagai DOKUMEN.");
  return { berkas: keluar, lebar: hasil.lebar, tinggi: hasil.tinggi, mp: hasil.mp, ukuranMB: hasil.ukuranMB, faktor: rc.faktor, diubah: rc.perlu || !jpeg, peringatan };
}

export const CATATAN_AI = "Catatan: Shutterstock tidak menerima gambar buatan AI dari kontributor (kebijakan 2025). Unggah hanya foto/ilustrasi karya sendiri yang bisa dibuktikan kepemilikannya; orang dan properti yang dikenali butuh surat izin (release).";

// ---------- perintah WhatsApp ----------
/** Kenali perintah: "upscale", "perbesar foto", "naikkan resolusi", "siap shutterstock", "cek shutterstock", "/stok". */
export function kenaliPerintahGambar(teks) {
  const s = String(teks || "").replace(/[‎‏]/g, "").trim().replace(/^(?:@\S+\s*)+/, "");
  if (!s) return null;
  const slash = /^\/(?:stok|upscale|shutterstock)\b\s*(.*)$/i.exec(s);
  const alami = /\b(?:upscale|up-scale|perbesar\s+(?:gambar|foto|resolusi)|naikkan\s+resolusi|siap(?:kan)?\s+(?:untuk\s+)?(?:shutterstock|stok)|cek\s+(?:shutterstock|syarat\s+stok|resolusi))\b/i.test(s);
  if (!slash && !alami) return null;
  return { slash: !!slash, cek: /\bcek\b|^\/\w+\s+cek\b/i.test(s), bantuan: !!slash && /^(bantuan|help|\?)$/i.test(slash[1].trim()) };
}
export function teksBantuanGambar() {
  return [
    "Menyiapkan foto untuk Shutterstock:",
    "1. Kirim fotonya sebagai DOKUMEN (bukan foto biasa), karena WhatsApp mengecilkan foto biasa.",
    "2. Beri keterangan: upscale  (atau: cek shutterstock untuk hanya memeriksa syarat).",
    "Saya perbesar bila di bawah 4 megapiksel (target 5 MP) dan kirim balik sebagai dokumen JPEG.",
    "Ingat: syaratnya 4 MEGAPIKSEL (mis. 2000x2000), bukan 4 MB. Pembesaran tidak menambah detail asli.",
    CATATAN_AI
  ].join("\n");
}
let urutan = 0;
const lanjutDari = (p) => (/\.(jpe?g|png|webp|heic|heif|tiff?|bmp)$/i.test(p) ? path.extname(p).toLowerCase() : ".jpg");

/**
 * Penangan satu pintu untuk pesan WA: kembalikan true bila pesan sudah ditangani.
 * @param {object} o  teks, adalahPemilik, grup, disebut, adaGambar, unduhGambar():Promise<Buffer>, namaBerkas, kirimTeks(t), kirimDokumen(berkas,namaFile,keterangan),
 *                    antrean (opsional, dari perintah-wa.buatAntrean), folder, konfig {izinSemua}
 */
export async function tanganiGambarWa(o) {
  const { teks, adalahPemilik = false, grup = null, disebut = false, adaGambar = false, unduhGambar, namaBerkas = "foto.jpg", kirimTeks, kirimDokumen, antrean, folder = path.join(os.tmpdir(), "ayyubi-stok"), konfig = {} } = o;
  const p = kenaliPerintahGambar(teks);
  if (!p) return false;
  if (grup && !disebut && !p.slash) return false;
  if (!adalahPemilik && !konfig.izinSemua) { await kirimTeks("Maaf, fitur ini hanya untuk pemilik bot."); return true; }
  if (p.bantuan) { await kirimTeks(teksBantuanGambar()); return true; }
  if (!adaGambar || typeof unduhGambar !== "function") { await kirimTeks("Kirim fotonya sebagai DOKUMEN dengan keterangan \"upscale\" (atau \"cek shutterstock\"). Ketik /stok bantuan untuk penjelasan."); return true; }
  fs.mkdirSync(folder, { recursive: true });
  const id = `${Date.now()}-${++urutan}`, masuk = path.join(folder, `in-${id}${lanjutDari(namaBerkas)}`), keluar = path.join(folder, `stok-${id}.jpg`);
  const kerja = async () => {
    const buf = await unduhGambar();
    if (buf.length > SYARAT.maksMasukMB * 1048576) throw Object.assign(new Error("terlalu besar"), { ramah: `Berkasnya terlalu besar (maksimal ${SYARAT.maksMasukMB} MB).` });
    fs.writeFileSync(masuk, buf);
    if (p.cek) {
      const info = bacaGambar(masuk), rc = rencanaUpscale(info);
      const baris = ["Hasil pemeriksaan:", ...periksaStok(info).map((c) => `${c.ok ? "OK " : c.lunak ? "Saran " : "Belum "} ${c.teks}`)];
      if (rc.perlu) baris.push(rc.bisa ? `Perlu diperbesar sekitar ${rc.faktor.toFixed(2)} kali ke ${rc.lebarBaru}x${rc.tinggiBaru}. Kirim ulang dengan keterangan "upscale".` : rc.peringatan[0]);
      baris.push("", CATATAN_AI); return { teks: baris.join("\n") };
    }
    const r = siapkanUntukStok({ masuk, keluar });
    const nama = path.basename(namaBerkas).replace(/\.[^.]+$/, "") + "_stok.jpg";
    const ket = [`${r.lebar}x${r.tinggi} (${r.mp.toFixed(2)} MP), ${r.ukuranMB.toFixed(1)} MB${r.faktor > 1 ? `, diperbesar ${r.faktor.toFixed(2)} kali` : ""}.`, ...r.peringatan, "", CATATAN_AI].join("\n");
    return { berkas: r.berkas, nama, ket };
  };
  await kirimTeks(p.cek ? "Memeriksa..." : "Siap, sedang diproses...");
  try {
    const h = antrean ? await antrean.jalankan(kerja) : await kerja();
    if (h.teks) await kirimTeks(h.teks); else await kirimDokumen(h.berkas, h.nama, h.ket);
  } catch (e) {
    await kirimTeks(e.ramah || `Maaf, gagal memproses gambar (${String(e.message).slice(0, 120)}).`);
  } finally {
    for (const f of [masuk, keluar]) { try { fs.unlinkSync(f); } catch {} }
  }
  return true;
}
