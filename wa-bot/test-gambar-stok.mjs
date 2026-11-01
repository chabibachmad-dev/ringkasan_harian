// Tes modul persiapan foto stok (Shutterstock).   node test-gambar-stok.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SYARAT, bacaGambar, rencanaUpscale, periksaStok, siapkanUntukStok, kenaliPerintahGambar, tanganiGambarWa, CATATAN_AI, teksBantuanGambar } from "./media/gambar-stok.js";
import { buatAntrean } from "./motion/perintah-wa.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// 1. hitungan rencana
{
  const a = rencanaUpscale({ lebar: 2400, tinggi: 2000 });
  check(!a.perlu && a.bisa && a.faktor === 1, "4,8 MP: tidak perlu diperbesar");
  const b = rencanaUpscale({ lebar: 1600, tinggi: 1200 });
  check(b.perlu && b.bisa && b.mpBaru >= 4.08 && b.mpBaru < 6, `1600x1200 -> ${b.lebarBaru}x${b.tinggiBaru} (>=4 MP)`);
  check(Math.abs(b.lebarBaru / b.tinggiBaru - 4 / 3) < 0.01, "rasio tetap");
  const c = rencanaUpscale({ lebar: 600, tinggi: 400 });
  check(c.perlu && !c.bisa && /terlalu kecil/i.test(c.peringatan[0]), "600x400 ditolak (faktor terlalu besar)");
  const d = rencanaUpscale({ lebar: 1900, tinggi: 1500 });
  check(d.bisa && d.faktor < 1.6 && d.peringatan.length === 1, "faktor kecil: satu catatan saja");
  const e = rencanaUpscale({ lebar: 1500, tinggi: 1000 });
  check(e.bisa && e.faktor > 1.6 && /lembut/.test(e.peringatan[0]), "faktor di atas 1,6: peringatan lembut");
  check(periksaStok({ lebar: 1000, tinggi: 1000, mp: 1, ukuranMB: 1 })[0].ok === false, "periksaStok: 1 MP belum lolos");
  check(periksaStok({ lebar: 2500, tinggi: 2000, mp: 5, ukuranMB: 60 })[2].ok === false, "periksaStok: 60 MB melebihi batas");
}

// 2. pengenalan perintah
{
  const k = kenaliPerintahGambar;
  check(k("upscale") && !k("upscale").slash, "upscale dikenali");
  check(k("/stok") && k("/stok").slash, "/stok dikenali");
  check(k("/stok bantuan").bantuan, "/stok bantuan");
  check(k("tolong perbesar foto ini") !== null, "perbesar foto");
  check(k("naikkan resolusi") !== null, "naikkan resolusi");
  check(k("siapkan untuk shutterstock") !== null, "siapkan untuk shutterstock");
  check(k("cek shutterstock").cek === true, "cek shutterstock -> mode cek");
  check(k("@62812345 upscale") !== null, "mention di depan diabaikan");
  check(k("selamat pagi") === null && k("") === null && k(undefined) === null, "bukan perintah -> null");
  check(k("buatkan video tentang gunung") === null, "perintah video tidak ikut terambil");
}

// 3. proses berkas nyata
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stok-"));
const ff = (args) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
const bikin = (nama, w, h, ekstra = []) => { const p = path.join(dir, nama); const r = ff(["-f", "lavfi", "-i", `testsrc2=s=${w}x${h}:d=1`, "-frames:v", "1", ...ekstra, p]); if (r.status !== 0) throw new Error(r.stderr); return p; };
const adaFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
if (!adaFfmpeg) console.log("ffmpeg tidak ada: bagian berkas dilewati");
else {
  const kecil = bikin("kecil.jpg", 1600, 1200, ["-q:v", "2"]);
  const besar = bikin("besar.jpg", 2400, 2000, ["-q:v", "2"]);
  const mungil = bikin("mungil.jpg", 600, 400, ["-q:v", "2"]);
  const png = bikin("foto.png", 3000, 2000);
  check(bacaGambar(kecil).lebar === 1600 && bacaGambar(kecil).kodek === "mjpeg", "bacaGambar JPEG");
  let r = siapkanUntukStok({ masuk: kecil, keluar: path.join(dir, "o1.jpg") });
  check(r.mp >= 4 && r.diubah && r.faktor > 1, `1600x1200 diperbesar jadi ${r.lebar}x${r.tinggi}`);
  check(bacaGambar(r.berkas).kodek === "mjpeg", "hasil berupa JPEG");
  r = siapkanUntukStok({ masuk: besar, keluar: path.join(dir, "o2.jpg") });
  check(!r.diubah && r.lebar === 2400 && fs.readFileSync(besar).equals(fs.readFileSync(r.berkas)), "JPEG sudah memenuhi syarat: disalin apa adanya");
  let galat = null; try { siapkanUntukStok({ masuk: mungil, keluar: path.join(dir, "o3.jpg") }); } catch (e) { galat = e; }
  check(galat && galat.ramah, "600x400 ditolak dengan pesan ramah");
  r = siapkanUntukStok({ masuk: png, keluar: path.join(dir, "o4.jpg") });
  check(r.lebar === 3000 && r.tinggi === 2000 && r.diubah && bacaGambar(r.berkas).kodek === "mjpeg", "PNG besar dikonversi ke JPEG tanpa diperbesar");
  galat = null; try { fs.writeFileSync(path.join(dir, "bukan.jpg"), "bukan gambar"); bacaGambar(path.join(dir, "bukan.jpg")); } catch (e) { galat = e; }
  check(!!galat, "berkas bukan gambar -> galat");

  // 4. alur WA
  const bufKecil = fs.readFileSync(kecil), bufMungil = fs.readFileSync(mungil);
  const mk = (ekstra = {}) => { const log = { teks: [], dok: [] }; return { log, o: { teks: "upscale", adalahPemilik: true, adaGambar: true, namaBerkas: "pantai.jpg", unduhGambar: async () => bufKecil, kirimTeks: async (t) => log.teks.push(t), kirimDokumen: async (b, n, k) => log.dok.push({ b, n, k, ada: fs.existsSync(b) }), folder: path.join(dir, "kerja"), ...ekstra } }; };
  let m = mk(); let h = await tanganiGambarWa(m.o);
  check(h === true && m.log.dok.length === 1 && m.log.dok[0].ada, "alur upscale: dokumen terkirim");
  check(m.log.dok[0].n === "pantai_stok.jpg", "nama berkas hasil");
  check(m.log.dok[0].k.includes(CATATAN_AI) && /Shutterstock tidak menerima/.test(m.log.dok[0].k), "keterangan memuat catatan AI");
  check(!fs.existsSync(m.log.dok[0].b), "berkas sementara dihapus setelah kirim");
  m = mk({ teks: "cek shutterstock" }); h = await tanganiGambarWa(m.o);
  check(h && m.log.dok.length === 0 && m.log.teks.some((t) => /Hasil pemeriksaan/.test(t) && /Perlu diperbesar/.test(t)), "mode cek: hanya laporan teks");
  m = mk({ unduhGambar: async () => bufMungil }); h = await tanganiGambarWa(m.o);
  check(h && m.log.dok.length === 0 && m.log.teks.some((t) => /terlalu kecil/i.test(t)), "gambar mungil: pesan penolakan");
  m = mk({ adalahPemilik: false }); h = await tanganiGambarWa(m.o);
  check(h && m.log.teks.some((t) => /hanya untuk pemilik/.test(t)) && m.log.dok.length === 0, "bukan pemilik ditolak");
  m = mk({ adalahPemilik: false, konfig: { izinSemua: true } }); h = await tanganiGambarWa(m.o);
  check(h && m.log.dok.length === 1, "izinSemua mengizinkan orang lain");
  m = mk({ adaGambar: false }); h = await tanganiGambarWa(m.o);
  check(h && m.log.teks.some((t) => /DOKUMEN/.test(t)), "tanpa gambar: petunjuk");
  m = mk({ teks: "/stok bantuan" }); h = await tanganiGambarWa(m.o);
  check(h && m.log.teks[0] === teksBantuanGambar(), "bantuan");
  m = mk({ teks: "selamat pagi" }); h = await tanganiGambarWa(m.o);
  check(h === false && m.log.teks.length === 0, "bukan perintah: false, tidak membalas");
  m = mk({ grup: "123@g.us", disebut: false }); h = await tanganiGambarWa(m.o);
  check(h === false, "di grup tanpa mention (non-slash): diabaikan");
  m = mk({ grup: "123@g.us", disebut: true }); h = await tanganiGambarWa(m.o);
  check(h && m.log.dok.length === 1, "di grup dengan mention: diproses");
  m = mk({ unduhGambar: async () => Buffer.alloc(41 * 1048576) }); h = await tanganiGambarWa(m.o);
  check(h && m.log.teks.some((t) => /terlalu besar/.test(t)), "berkas > 40 MB ditolak");
  m = mk({ unduhGambar: async () => { throw new Error("jaringan putus"); } }); h = await tanganiGambarWa(m.o);
  check(h && m.log.teks.some((t) => /gagal memproses/.test(t)), "galat unduh dilaporkan");
  const antrean = buatAntrean({ maksTunggu: 3 });
  const a = mk(), b = mk({ teks: "upscale" });
  await Promise.all([tanganiGambarWa({ ...a.o }), tanganiGambarWa({ ...b.o })]);
  check(a.log.dok.length === 1 && b.log.dok.length === 1, "dua permintaan paralel tanpa antrean tetap jalan (nama berkas tidak bentrok)");
  const c1 = mk({ antrean }), c2 = mk({ antrean });
  await Promise.all([tanganiGambarWa(c1.o), tanganiGambarWa(c2.o)]);
  check(c1.log.dok.length === 1 && c2.log.dok.length === 1, "lewat antrean bersama: keduanya selesai");
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} tes GAGAL` : "\nSemua tes gambar stok lolos");
process.exit(fails ? 1 : 0);
