// Tes mesin video Adobe Stock (latar gerak loop): perintah, katalog, rencana, render kecil, loop mulus, pemeriksa spesifikasi, alur WA.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
import { VIDEO, SPEK, renderVideo, periksaVideo, ambilBingkai, namaBerkasVideo, _gambarDesain } from "./stok-adobe/video-mesin.mjs";
import { periksaBaris, bersihkanKataKunci, bersihkanJudul } from "./stok-adobe/metadata.js";
import * as S from "./stok-adobe/stok-adobe.js";

let fails = 0;
const check = (ok, nama) => { console.log(`${ok ? "ok  " : "GAGAL"} ${nama}`); if (!ok) fails++; };
const ada = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
if (!ada) { console.log("lewati: ffmpeg/ffprobe tidak terpasang"); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvid-"));
const k = S.kenaliPerintahStok;

// 1. perintah
{
  const a = k("/adobe video ramadan 3");
  check(a.aksi === "rencana" && a.jenis === "video" && a.jumlahVideo === 3 && a.jumlahIkon === 0 && a.jumlahLatar === 0 && a.tema === "ramadan" && !a.vertikal, "perintah: video ramadan 3");
  check(k("/adobe video ramadan 2 vertikal").vertikal === true && k("/adobe video ramadan 2 vertikal").tema === "ramadan", "perintah: vertikal");
  check(k("/adobe video 9:16 batik").vertikal === true && k("/adobe video 9:16 batik").jumlahVideo === 2 && k("/adobe video 9:16 batik").tema === "batik", "perintah: 9:16 tidak dibaca sebagai jumlah");
  const g = k("/adobe latar gerak batik 2");
  check(g.jenis === "video" && g.jumlahLatar === 0 && g.jumlahVideo === 2 && g.tema === "batik", "perintah: 'latar gerak' = video");
  const c = k("/adobe ikon ramadan 4 dan 2 video");
  check(c.jenis === "ikon" && c.jumlahIkon === 4 && c.jumlahVideo === 2, "perintah: ikon + video");
  check(k("/adobe video 99").jumlahVideo === 4 && k("/adobe video").jumlahVideo === 2 && k("/adobe video").tema === "umum", "perintah: batas 4 dan bawaan 2, tema umum");
  check(k("/adobe latar batik").jumlahVideo === 0 && k("/adobe ikon ramadan 3").jumlahVideo === 0, "perintah lama tidak memicu video");
}
// 2. katalog
{
  check(new Set(VIDEO.map((v) => v.nama)).size === VIDEO.length && VIDEO.length >= 6, "katalog: nama unik");
  check(VIDEO.every((v) => namaBerkasVideo(v.nama, true).length <= 30), "katalog: nama berkas (+ -v) <= 30");
  const galat = VIDEO.flatMap((v) => periksaBaris({ berkas: namaBerkasVideo(v.nama, false), judul: bersihkanJudul(v.judul), kata: bersihkanKataKunci(v.kata) }));
  check(galat.length === 0, `katalog: judul dan kata kunci lolos aturan CSV ${galat.join("; ")}`);
  check(VIDEO.every((v) => v.judul.length <= 70 && bersihkanJudul(v.judul) === v.judul), "katalog: judul <= 70 dan bersih");
  check(S.SUDAH_DIUNGGAH.video.includes("bintang-islami-emas"), "contoh yang sudah diunggah tercatat");
}
// 3. rencana
{
  const kosong = { paket: [] }, katalog = [];
  let r = await S.susunRencana({ perintah: k("/adobe video ramadan 3"), riwayat: kosong, llm: null, katalog, tanggal: "2026-11-02" });
  check(r.video.length === 3 && !r.video.some((v) => v.nama === "bintang-islami-emas") && r.ikon.length === 0 && r.latar.length === 0, "rencana: melewati desain yang sudah diunggah, tanpa ikon/latar");
  r = await S.susunRencana({ perintah: k("/adobe video ramadan 4 paksa"), riwayat: kosong, llm: null, katalog, tanggal: "2026-11-02" });
  check(r.video.some((v) => v.nama === "bintang-islami-emas") && r.video.length === 4, "rencana: paksa mengikutkan desain lama");
  r = await S.susunRencana({ perintah: k("/adobe video batik 2"), riwayat: kosong, llm: null, katalog, tanggal: "2026-11-02" });
  check(r.video.length === 1 && r.video[0].nama === "kawung-bergulir" && r.catatan.some((c) => /Hanya 1 video/.test(c)), "rencana: tema batik");
  r = await S.susunRencana({ perintah: k("/adobe video idul adha 3"), riwayat: kosong, llm: null, katalog, tanggal: "2026-11-02" });
  check(r.video.every((v) => ["gradien-cair", "bokeh-emas"].includes(v.nama)) && r.video.length === 2, "rencana: tema baru memakai desain umum");
  r = await S.susunRencana({ perintah: k("/adobe video ramadan 1 vertikal"), riwayat: kosong, llm: null, katalog, tanggal: "2026-11-02" });
  check(r.vertikal && r.catatan.some((c) => /vertikal/.test(c)) && /Video vertikal/.test(S.teksRencana(r)) && /Balas \/adobe setuju/.test(S.teksRencana(r)), "rencana vertikal: catatan dan teks");
  r = await S.susunRencana({ perintah: k("/adobe video ramadan 1"), riwayat: { paket: [{ tanggal: "2026-11-01", video: ["lentera-melayang", "bulan-bintang-malam", "bokeh-emas"] }] }, llm: null, katalog, tanggal: "2026-11-02" });
  check(r.video.length === 0 && /Tidak ada yang bisa dibuat/.test(S.teksRencana(r)), "rencana: riwayat video mencegah pengulangan");
}
// 3b. diagnosis tema baru tanpa katalog
{
  let r = await S.susunRencana({ perintah: k("/adobe ikon 3d natal 3"), riwayat: { paket: [] }, llm: null, katalog: [], tanggal: "2026-11-02" });
  check(r.ikon.length === 0 && r.catatan.some((c) => /belum tersambung/.test(c)), "diagnosis: tanpa llm dijelaskan");
  r = await S.susunRencana({ perintah: k("/adobe ikon natal 3"), riwayat: { paket: [] }, llm: async () => "maaf, tidak bisa", katalog: [], tanggal: "2026-11-02" });
  check(r.ikon.length === 0 && r.catatan.some((c) => /tidak ada usulan ikon yang valid/.test(c)), "diagnosis: jawaban AI tidak valid dijelaskan");
  r = await S.susunRencana({ perintah: k("/adobe ikon natal 3"), riwayat: { paket: [] }, llm: async () => { throw new Error("kuota habis"); }, katalog: [], tanggal: "2026-11-02" });
  check(r.catatan.some((c) => /kuota habis/.test(c)), "diagnosis: galat AI ditampilkan");
}
// 4. render kecil semua desain
const kecil = { detik: 1, fps: 24, lebar: 320, tinggi: 180, crf: 30 };
for (const v of VIDEO) {
  try {
    const f = path.join(tmp, `${v.nama}.mp4`); await renderVideo(v.nama, f, kecil);
    const pk = periksaVideo(f, { longgar: true }), fr = ambilBingkai(f, path.join(tmp, `${v.nama}.jpg`), 0.3);
    check(pk.ok && pk.info.lebar === 320 && pk.info.fps === 24 && pk.info.kodek === "h264" && !pk.info.audio && fs.statSync(fr).size > 500, `render: ${v.nama}`);
  } catch (e) { check(false, `render ${v.nama}: ${e.message}`); }
}
{
  const f = path.join(tmp, "v.mp4"); await renderVideo("lentera-melayang", f, { ...kecil, vertikal: true, lebar: 180, tinggi: 320 });
  const pk = periksaVideo(f, { longgar: true }); check(pk.ok && pk.info.tinggi === 320, "render: vertikal");
  const ketat = periksaVideo(f); check(!ketat.ok && ketat.masalah.some((m) => /durasi/.test(m)) && ketat.masalah.some((m) => /resolusi/.test(m)), "pemeriksa: klip mini ditolak (durasi/resolusi)");
  const rusak = path.join(tmp, "rusak.mp4"); fs.writeFileSync(rusak, "bukan video"); check(periksaVideo(rusak).ok === false, "pemeriksa: berkas rusak ditolak");
  let g = null; try { await renderVideo("tidak-ada", path.join(tmp, "x.mp4"), kecil); } catch (e) { g = e; } check(g && /tidak dikenal/.test(g.message), "render: desain tidak dikenal ditolak");
}
// 5. loop mulus: frame u=0 dan u=1 harus identik
for (const v of VIDEO) {
  const W = 192, H = 108, c = createCanvas(W, H), g = c.getContext("2d"), gambar = _gambarDesain(v.nama, W, H);
  gambar(g, 0); const a = Buffer.from(g.getImageData(0, 0, W, H).data); gambar(g, 1); const b = Buffer.from(g.getImageData(0, 0, W, H).data);
  gambar(g, 0.5); const t = Buffer.from(g.getImageData(0, 0, W, H).data);
  let d1 = 0, d2 = 0; for (let i = 0; i < a.length; i++) { d1 += Math.abs(a[i] - b[i]); d2 += Math.abs(a[i] - t[i]); }
  check(d1 / a.length < 0.8 && d2 / a.length > d1 / a.length, `loop mulus: ${v.nama} (selisih u0-u1 ${(d1 / a.length).toFixed(2)}, u0-u0.5 ${(d2 / a.length).toFixed(2)})`);
}
// 6. spesifikasi penuh (lama; aktif dengan STOK_TES_VIDEO_PENUH=1)
if (process.env.STOK_TES_VIDEO_PENUH === "1") {
  const f = path.join(tmp, "penuh.mp4"); await renderVideo("gradien-cair", f, { detik: 5, fps: 30 });
  const pk = periksaVideo(f); check(pk.ok && pk.info.lebar === 1920 && pk.info.tinggi === 1080 && pk.info.detik >= 4.95 && pk.info.fps === 30, `spesifikasi penuh 1920x1080 5 dtk lolos ${JSON.stringify(pk.masalah)}`);
} else console.log("lewati: tes spesifikasi penuh (set STOK_TES_VIDEO_PENUH=1)");
// 7. alur WA
{
  const log = { teks: [], dok: [], gambar: [] };
  const dasar = { chatId: "v1", adalahPemilik: true, folder: path.join(tmp, "bot"), tanggal: "2026-11-02", deps: { llm: null }, konfig: { maksPekan: 9, videoOpsi: { ...kecil, longgar: true } },
    kirimTeks: async (t) => log.teks.push(t), kirimDokumen: async (b, n, kt) => log.dok.push({ b, n, kt, ada: fs.existsSync(b) }), kirimGambar: async (b, n) => log.gambar.push(n) };
  await S.tanganiStokWa({ ...dasar, teks: "/adobe video ramadan 1 paksa" });
  check(/Rencana paket/.test(log.teks.at(-1)) && /Video \(1\)/.test(log.teks.at(-1)), "WA: rencana video tanpa mesin ikon");
  await S.tanganiStokWa({ ...dasar, teks: "/adobe setuju" });
  const z = log.dok[0]; const isi = spawnSync("python3", ["-m", "zipfile", "-l", z.b], { encoding: "utf8" }).stdout;
  check(z && z.ada && /video\/bintang-islami-emas\.mp4/.test(isi) && /metadata-video\.csv/.test(isi) && /metadata-video\.txt/.test(isi) && /1 video/.test(z.kt) && log.gambar.length === 1, "WA: zip berisi MP4 + CSV + txt, pratinjau terkirim");
  check(S.muatRiwayat(dasar.folder).paket.at(-1).video[0] === "bintang-islami-emas" && !fs.readdirSync(dasar.folder).some((n) => n.startsWith("_pr-")), "WA: riwayat video tersimpan, bingkai sementara dibersihkan");
  const txt = (() => { const d = spawnSync("python3", ["-c", `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.read('metadata-video.txt').decode()+z.read('PETUNJUK.txt').decode())`, z.b], { encoding: "utf8" }); return d.stdout; })();
  check(/Judul: Seamless loop/.test(txt) && /Created using generative AI tools/.test(txt) && /VIDEO \(folder video\//.test(txt), "WA: metadata-video.txt dan petunjuk video");
  await S.tanganiStokWa({ ...dasar, teks: "/adobe video ramadan 1 vertikal paksa" }); await S.tanganiStokWa({ ...dasar, teks: "/adobe setuju" });
  const z2 = log.dok[1]; const isi2 = spawnSync("python3", ["-m", "zipfile", "-l", z2.b], { encoding: "utf8" }).stdout;
  const csv2 = spawnSync("python3", ["-c", `import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read('metadata-video.csv').decode())`, z2.b], { encoding: "utf8" }).stdout;
  check(/video\/bintang-islami-emas-v\.mp4/.test(isi2) && /^bintang-islami-emas-v\.mp4,Vertical /m.test(csv2) && /vertical video/.test(csv2), "WA: klip vertikal bernama -v, judul berawalan Vertical, kata kunci vertical");
  await S.tanganiStokWa({ ...dasar, teks: "/adobe riwayat" }); check(/\d+ video\./.test(log.teks.at(-1)), "WA: riwayat menyebut jumlah video");
  // klip yang tidak memenuhi syarat (tanpa longgar) tidak masuk paket
  const strict = { ...dasar, chatId: "v2", folder: path.join(tmp, "bot2"), konfig: { maksPekan: 9, videoOpsi: kecil } };
  await S.tanganiStokWa({ ...strict, teks: "/adobe video ramadan 1" }); await S.tanganiStokWa({ ...strict, teks: "/adobe setuju" });
  check(log.dok.length === 3 && /0 video/.test(log.dok[2].kt) && /tidak memenuhi syarat Adobe/.test(log.dok[2].kt), "WA: klip di luar spesifikasi dibuang dan dilaporkan");
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} tes GAGAL` : "\nSemua tes video-stok lolos");
process.exit(fails ? 1 : 0);
