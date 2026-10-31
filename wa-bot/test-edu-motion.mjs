// Tes penghubung motion graphic ke channel edukasi (edu-motion.js + edu-channel.js): jadwal tema mingguan,
// penanganan tombol/balasan/perintah, pembuatan video, fallback papan tulis. Jam, AI, suara, render, YouTube, Telegram: PALSU.
//   node test-edu-motion.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEdu, readEduConfig } from "./edu-channel.js";
import { createMotion, readMotionConfig } from "./edu-motion.js";
import { silentWav, wavSeconds, beatSeconds } from "./edu-board.js";
import { muatState, simpanState, senenBerikut } from "./motion/tema-mingguan.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };
const TZ = "Asia/Makassar"; // UTC+8
const utc = (s) => Date.parse(s);
// 2026-10-31 = Sabtu, 2026-11-01 = Minggu, 2026-11-02 = Senin. Jam WITA ditulis sebagai UTC-8 jam.
const wita = (tgl, hhmm) => utc(`${tgl}T${hhmm}:00+08:00`);

// ---- konfigurasi
{
  const c = readMotionConfig({});
  check(c.mode === "motion" && c.temaOtomatis === true && c.skala === 1.5, "bawaan: EDU_MODE=motion, TEMA_OTOMATIS aktif, skala 1,5");
  check(readMotionConfig({ EDU_MODE: "papan", TEMA_OTOMATIS: "0" }).mode === "papan" && readMotionConfig({ TEMA_OTOMATIS: "0" }).temaOtomatis === false, "EDU_MODE=papan dan TEMA_OTOMATIS=0 dibaca");
  check(readMotionConfig({ EDU_MODE: "apa saja" }).mode === "motion", "nilai EDU_MODE tak dikenal -> motion");
  check(readEduConfig({}).mode === "motion" && readEduConfig({ EDU_MODE: "PAPAN" }).mode === "papan", "readEduConfig memuat mode");
}

// ---- alat uji
const ISI = { pertanyaan: "Berapa 7 x 8?", judul: "Fakta", soal: "Soal", mitos: "Mitos" };
function setup(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edumo-"));
  const clock = { t: wita("2026-10-28", "03:00") }; // Rabu 03:00 WITA
  const sent = { text: [], files: [] };
  const rec = { llm: 0, buatIsi: [], render: [], tts: [] , failRender: false, failIsi: false };
  const llm = async () => { rec.llm += 1; if (over.llmFail !== false) throw new Error("llm palsu tidak menjawab"); return "[]"; };
  const speaker = {
    available: () => true,
    async speakWav(text) { rec.tts.push(text); return { wav: silentWav(Math.min(14, 1 + text.length / 14)), text }; }
  };
  const temaFile = path.join(dir, "tema.json");
  const cfgMotion = { ...readMotionConfig(over.motionEnv || {}), temaFile, channelName: "Belajar Bareng", voice: undefined, style: "ramah" };
  const motion = createMotion({
    config: cfgMotion, tz: TZ, llm, speaker, now: () => clock.t, log: quiet,
    sendText: async (text, o) => { sent.text.push({ text, markup: o?.markup }); return 1; },
    lib: {
      buatIsi: async (a) => { rec.buatIsi.push(a); if (rec.failIsi) throw new Error("isi gagal"); return { isi: ISI, hook: "Siap menebak?", dasar: "Tabel perkalian", narasi: `Narasi tentang ${a.topik}.`, percobaan: 1 }; },
      renderVideo: async (a) => { rec.render.push(a); if (rec.failRender) throw new Error("render gagal"); fs.writeFileSync(a.keluar, Buffer.alloc(40_000, 1)); return { berkas: a.keluar, durasi: 24, templat: a.templatId, lebar: 1080, tinggi: 1920 }; }
    }
  });
  const config = readEduConfig({ EDU_ENABLED: "true", EDU_DIR: path.join(dir, "edu"), WA_TIMEZONE: TZ, EDU_MIN_SEC: "60", EDU_MAX_SEC: "120", ...(over.env || {}) });
  const renderer = {
    renders: 0,
    async render({ beats, wavs, outFile }) {
      this.renders += 1;
      fs.writeFileSync(outFile, Buffer.alloc(40_000, 2));
      let t = 0;
      const timeline = beats.map((b, i) => { const d = beatSeconds(wavs[i] ? wavSeconds(wavs[i]) : 0, b.hold || 0); const e = { section: b.section, firstOfSection: !!b.firstOfSection, start: t, dur: d }; t += d; return e; });
      return { file: outFile, seconds: t, timeline, overflowClears: 0 };
    }
  };
  const yt = { uploads: [], available: () => true, status: () => ({ broken: null }), setThumbnail: async () => ({ ok: true }) };
  yt.upload = async (o) => { yt.uploads.push(o); const id = `vid${yt.uploads.length}`; return { id, url: `https://youtu.be/${id}`, studioUrl: `https://studio/${id}`, publishAt: new Date(o.publishAt).toISOString() }; };
  const edu = createEdu({
    config, speaker, renderer, youtube: yt, motion: over.noMotion ? null : motion,
    thumbnail: async ({ outFile }) => { fs.writeFileSync(outFile, Buffer.alloc(2000, 2)); return outFile; },
    sendText: async (text, o) => { sent.text.push({ text, markup: o?.markup }); return 1; },
    sendFile: async (file, caption) => { sent.files.push({ file, caption }); return 1; },
    loadCards: () => JSON.parse(fs.readFileSync(new URL("./data/edu-sains.json", import.meta.url), "utf8")),
    now: () => clock.t, log: quiet
  });
  return { dir, temaFile, clock, sent, rec, motion, edu, yt, config };
}
const buttons = (m) => m.markup?.flat().map((b) => b.callback_data) || [];

// ---- jadwal tema mingguan
{
  const { clock, sent, motion, temaFile } = setup();
  const cek = async (tgl, jam) => { clock.t = wita(tgl, jam); await motion.tickTema(); };
  await cek("2026-10-30", "09:00"); // Jumat
  check(sent.text.length === 0 && !muatState(temaFile).usulan, "Jumat: belum ada usulan");
  await cek("2026-10-31", "07:59");
  check(sent.text.length === 0, "Sabtu 07:59: belum ada usulan");
  await cek("2026-10-31", "08:00");
  const u = muatState(temaFile).usulan;
  check(u && u.minggu === "2026-11-02" && u.status === "diusulkan" && u.hari.length === 7, "Sabtu 08:00: usulan untuk Senin 2026-11-02 tersimpan");
  check(sent.text.length === 1 && /Usulan tema pekan/.test(sent.text[0].text) && buttons(sent.text[0]).join() === "tema:setuju:2026-11-02,tema:ulang:2026-11-02,tema:revisi:2026-11-02", "usulan + tombol setuju/ulang/revisi terkirim ke pemilik");
  await cek("2026-10-31", "08:01"); await cek("2026-10-31", "20:00");
  check(sent.text.length === 1, "usulan tidak dikirim berulang pada hari yang sama");
  await cek("2026-11-01", "17:59");
  check(sent.text.length === 1, "Minggu 17:59: belum ada pengingat");
  await cek("2026-11-01", "18:00");
  check(sent.text.length === 2 && /Pengingat/.test(sent.text[1].text) && buttons(sent.text[1]).length === 3, "Minggu 18:00: pengingat dengan tombol");
  await cek("2026-11-01", "18:30");
  check(sent.text.length === 2, "pengingat hanya sekali");
  await cek("2026-11-01", "20:59");
  check(muatState(temaFile).usulan.status === "diusulkan", "Minggu 20:59: belum disetujui otomatis");
  await cek("2026-11-01", "21:00");
  const s2 = muatState(temaFile);
  check(s2.usulan.status === "disetujui" && s2.usulan.disetujuiOleh === "otomatis", "Minggu 21:00: disetujui otomatis");
  check(sent.text.length === 3 && /setujui otomatis/.test(sent.text[2].text), "pemilik diberi tahu persetujuan otomatis");
  await cek("2026-11-01", "21:30");
  check(sent.text.length === 3, "tidak diberi tahu dua kali");
  await cek("2026-11-02", "10:00");
  check(sent.text.length === 3, "Senin: jadwal tema tidak berjalan");
}

// ---- TEMA_OTOMATIS=0, pemilik sudah setuju, dan usulan terlambat (bot baru hidup hari Minggu)
{
  const a = setup({ motionEnv: { TEMA_OTOMATIS: "0" } });
  for (const [d, j] of [["2026-10-31", "08:00"], ["2026-11-01", "18:00"], ["2026-11-01", "21:30"]]) { a.clock.t = wita(d, j); await a.motion.tickTema(); }
  check(muatState(a.temaFile).usulan.status === "diusulkan", "TEMA_OTOMATIS=0: tidak pernah disetujui otomatis");
  check(/Pengingat/.test(a.sent.text[1].text) && !/otomatis pukul 21:00/.test(a.sent.text[1].text), "pengingat tanpa janji persetujuan otomatis");

  const b = setup();
  b.clock.t = wita("2026-10-31", "08:00"); await b.motion.tickTema();
  const out = await b.motion.callback("tema:setuju:2026-11-02");
  for (const [d, j] of [["2026-11-01", "18:00"], ["2026-11-01", "21:00"]]) { b.clock.t = wita(d, j); await b.motion.tickTema(); }
  check(/disetujui/.test(out) && b.sent.text.length === 1, "sudah disetujui pemilik: tidak ada pengingat / persetujuan otomatis");
  check(muatState(b.temaFile).usulan.disetujuiOleh === "owner", "persetujuan pemilik tidak ditimpa 'otomatis'");

  const c = setup();
  c.clock.t = wita("2026-11-01", "10:00"); await c.motion.tickTema();
  check(muatState(c.temaFile).usulan?.minggu === "2026-11-02", "bot baru hidup Minggu pagi: usulan tetap dibuat");
}

// ---- topik pemilik dipakai lebih dulu lalu keluar dari antrean; riwayat menghindari pengulangan
{
  const { clock, motion, temaFile } = setup();
  await motion.perintah("tambah Gunung berapi; Siklus air");
  check(muatState(temaFile).temaOwner.length === 2, "/tema tambah menyimpan dua topik");
  clock.t = wita("2026-10-31", "08:00"); await motion.tickTema();
  const s = muatState(temaFile);
  check(s.usulan.hari[0].topik === "Gunung berapi" && s.usulan.hari[1].topik === "Siklus air" && s.usulan.hari[0].sumber === "owner", "dua hari pertama memakai tema pemilik");
  check(s.temaOwner.length === 0, "tema pemilik yang terpakai keluar dari antrean");
}

// ---- tombol dan balasan pemilik
{
  const { clock, sent, motion, temaFile } = setup();
  clock.t = wita("2026-10-31", "08:00"); await motion.tickTema(); sent.text.length = 0;
  check(/tidak dikenal/.test(await motion.callback("tema:aneh:2026-11-02")), "callback tak dikenal ditolak");
  check((await motion.callback("tema:setuju:2020-01-06")) === "" && /tidak berlaku/.test(sent.text.at(-1).text), "callback minggu lama: pemilik dikirimi usulan terbaru");
  check(muatState(temaFile).usulan.status === "diusulkan", "callback minggu lama tidak menyetujui apa pun");
  sent.text.length = 0;

  // pesan biasa tidak dicegat
  for (const t of ["ok", "setuju", "ulang", "halo apa kabar"]) {
    check((await motion.teks(t)).handled === false, `pesan biasa "${t}" tidak dicegat`);
  }
  // perintah tegas dicegat tanpa perlu membalas
  const r = await motion.teks("ganti 3: planet Mars");
  const s = muatState(temaFile);
  check(r.handled && s.usulan.hari[2].topik === "planet Mars" && s.usulan.hari[2].sumber === "owner", "ganti 3: topik -> diterapkan & disimpan");
  check(sent.text.length === 2 && /diganti/.test(sent.text[0].text) && /Usulan tema pekan/.test(sent.text[1].text) && buttons(sent.text[1]).length === 3, "pemilik dikirimi konfirmasi + usulan terbaru dengan tombol");
  const t2 = s.usulan.hari[1].topik, t5 = s.usulan.hari[4].topik;
  await motion.teks("tukar 2 5");
  const s3 = muatState(temaFile);
  check(s3.usulan.hari[1].topik === t5 && s3.usulan.hari[4].topik === t2, "tukar 2 5 menukar topik");

  // revisi: tombol -> balasan bebas diteruskan; tanpa tombol / tanpa membalas tidak
  sent.text.length = 0;
  const pesanRevisi = await motion.callback("tema:revisi:2026-11-02");
  check(/balas/i.test(pesanRevisi) && muatState(temaFile).menunggu, "tombol Revisi menyiagakan balasan");
  const rb = await motion.teks("ok siap");
  check(rb.handled && muatState(temaFile).usulan.status === "disetujui", "setelah Revisi, balasan 'ok siap' dibaca sebagai setuju");
  check(!muatState(temaFile).menunggu, "siaga revisi dibersihkan setelah dipakai");

  // membalas pesan usulan
  const d = setup();
  d.clock.t = wita("2026-10-31", "08:00"); await d.motion.tickTema();
  check((await d.motion.teks("setuju", { replyText: "Obrolan lain" })).handled === false, "membalas pesan lain: tidak dicegat");
  check((await d.motion.teks("setuju", { replyText: d.sent.text[0].text })).handled && muatState(d.temaFile).usulan.status === "disetujui", "membalas pesan usulan: 'setuju' diterapkan");
  check((await d.motion.teks("ok", { replyText: d.sent.text[0].text })).handled && /sudah disetujui/.test(d.sent.text.at(-1).text), "setuju kedua: dijawab 'sudah disetujui'");

  // ulang lewat tombol mempertahankan tema pemilik
  const e = setup();
  e.clock.t = wita("2026-10-31", "08:00"); await e.motion.tickTema();
  await e.motion.teks("ganti 1: topik saya");
  e.sent.text.length = 0;
  const sebelum = muatState(e.temaFile).usulan.hari[3].topik;
  check((await e.motion.callback("tema:ulang:2026-11-02")) === "", "tombol ulang selesai");
  const sesudah = muatState(e.temaFile).usulan;
  check(sesudah.hari[0].topik === "topik saya" && sesudah.status === "diusulkan" && e.sent.text.length === 2, "ulang: tema pemilik dipertahankan, usulan baru dikirim");
  void sebelum;
}

// ---- perintah /tema
{
  const { clock, sent, motion, temaFile } = setup();
  check(/Belum ada usulan/.test(await motion.perintah("")), "/tema tanpa usulan: petunjuk");
  check(/Tersimpan 2 tema/.test(await motion.perintah("tambah A; B")), "/tema tambah A; B");
  clock.t = wita("2026-10-29", "10:00");
  check((await motion.perintah("usul")) === "" && muatState(temaFile).usulan?.minggu === "2026-11-02", "/tema usul membuat usulan sekarang (pekan depan)");
  sent.text.length = 0;
  check((await motion.perintah("")) === "" && /Usulan tema pekan/.test(sent.text[0].text) && buttons(sent.text[0]).length === 3, "/tema menampilkan usulan aktif dengan tombol");
  check((await motion.perintah("setuju")) === "" && muatState(temaFile).usulan.status === "disetujui", "/tema setuju");
  check(senenBerikut(new Date(2026, 9, 31, 12)) === "2026-11-02" && senenBerikut(new Date(2026, 10, 1, 12)) === "2026-11-02", "senenBerikut: Sabtu & Minggu -> Senin berikutnya");
}

// ---- pembuatan video harian (mode motion)
{
  const s = setup();
  const { clock, sent, rec, edu, yt, temaFile } = s;
  // tema disetujui untuk Rabu 28 Okt
  simpanState(temaFile, { usulan: { minggu: "2026-10-26", status: "disetujui", hari: [
    { tanggal: "2026-10-28", hari: 3, nama: "Rabu", templat: "fakta-angka", templatNama: "Fakta Angka", topik: "Tinggi Everest", sumber: "ai" },
    { tanggal: "2026-10-29", hari: 4, nama: "Kamis", templat: "perbandingan-bar", templatNama: "Perbandingan", topik: "Kecepatan kendaraan", sumber: "ai" }] }, temaOwner: [], riwayat: [] });
  await edu.check(); await edu.idle();
  const it = edu.load().items[0];
  check(it && it.mode === "motion" && it.status === "awaiting" && it.topic === "Tinggi Everest", "03:00: draf motion dibuat dari tema disetujui hari ini");
  const a = rec.buatIsi[0], r = rec.render[0];
  check(a.templatId === "fakta-angka" && a.topik === "Tinggi Everest" && typeof a.llm === "function", "buatIsi: templat Rabu + topik tema + llm");
  check(rec.tts[0] === "Narasi tentang Tinggi Everest.", "TTS memakai narasi dari buatIsi");
  check(r.templatId === "fakta-angka" && r.hook === "Siap menebak?" && r.teaser === "Kecepatan kendaraan" && r.skala === 1.5 && /\.wav$/.test(r.narasi) && r.keluar.endsWith("edu-1.mp4"), "renderVideo: hook, teaser besok, skala 1,5, narasi, berkas keluar");
  check(sent.files.length === 1 && sent.files[0].file.width === 1080 && sent.files[0].file.height === 1920 && /Draf Short #1/.test(sent.files[0].caption), "video 1080x1920 dikirim untuk persetujuan");
  const m = sent.text.at(-1);
  check(/Dasar fakta: Tabel perkalian/.test(m.text) && buttons(m).join() === "ed:ok:1,ed:again:1,ed:no:1", "baris 'Dasar fakta' + tombol setuju/ulang/buang yang sudah ada");
  check(it.title.endsWith("#Shorts") && it.aiDisclosure === true && it.madeForKids === true, "judul Shorts & penanda anak/sintetis");

  await edu.decide("ok:1"); await edu.idle();
  const up = yt.uploads[0];
  check(up && up.madeForKids === true && up.aiDisclosure === true && up.title === it.title && up.tags.includes("shorts"), "unggah: madeForKids & containsSyntheticMedia true, memakai metaShorts");
  check(up.publishAt === wita("2026-10-28", "16:00"), "jadwal tayang 16:00 WITA");
  check(muatState(temaFile).riwayat.includes("Tinggi Everest"), "topik dicatat ke riwayat setelah disetujui");
  check(/\/edu naskah/.test(sent.text.find((t) => /Dasar fakta/.test(t.text)).text), "tautan naskah tetap ada");
}

// ---- tema belum disetujui / tidak ada -> topik dari bank edu
{
  const a = setup();
  simpanState(a.temaFile, { usulan: { minggu: "2026-10-26", status: "diusulkan", hari: [{ tanggal: "2026-10-28", hari: 3, templat: "fakta-angka", topik: "Belum disetujui", sumber: "ai" }] }, temaOwner: [], riwayat: [] });
  await a.edu.check(); await a.edu.idle();
  const it = a.edu.load().items[0];
  check(it.mode === "motion" && it.topic !== "Belum disetujui" && it.topic.length > 2 && a.rec.buatIsi[0].templatId === "fakta-angka", "tema belum disetujui: topik dari bank edu, templat tetap menurut hari");
  check(a.edu.load().history.length === 1, "topik bank tercatat di riwayat bank agar tidak berulang");

  const b = setup();
  await b.edu.check(); await b.edu.idle();
  check(b.edu.load().items[0]?.mode === "motion", "tanpa berkas tema sama sekali: tetap jalan dengan topik bank");
}

// ---- gagal -> jatuh ke papan tulis + pemilik diberi tahu
{
  const a = setup();
  a.rec.failRender = true;
  await a.edu.check(); await a.edu.idle();
  const it = a.edu.load().items[0];
  check(it && it.mode !== "motion" && it.kind !== "motion", "render gagal: draf papan tulis dibuat sebagai cadangan");
  check(a.sent.text.some((t) => /motion graphic gagal/.test(t.text) && /render gagal/.test(t.text)), "pemilik diberi tahu kegagalan motion");
  check(a.sent.files.length === 1, "video cadangan tetap dikirim untuk disetujui");

  const b = setup();
  b.rec.failIsi = true;
  await b.edu.check(); await b.edu.idle();
  check(b.edu.load().items[0]?.kind !== "motion" && b.sent.text.some((t) => /isi gagal/.test(t.text)), "buatIsi gagal: jatuh ke papan tulis + pemberitahuan");
  check(b.edu.load().seq === 1, "nomor draf tidak terloncat oleh percobaan motion yang gagal");
}

// ---- EDU_MODE=papan, tanpa motion, dan permintaan manual berjenis
{
  const a = setup({ env: { EDU_MODE: "papan" } });
  await a.edu.check(); await a.edu.idle();
  check(a.rec.buatIsi.length === 0 && a.edu.load().items[0].kind !== "motion", "EDU_MODE=papan: pipeline lama saja");
  a.clock.t = wita("2026-10-31", "08:00"); await a.edu.check();
  check(!fs.existsSync(a.temaFile), "EDU_MODE=papan: jadwal tema tidak berjalan");
  check(/hanya aktif pada EDU_MODE=motion/.test(await a.edu.temaPerintah("")), "/tema menjelaskan bila mode papan");
  check((await a.edu.temaTeks("ganti 1: x")).handled === false, "mode papan: teks tidak dicegat");

  const b = setup({ noMotion: true });
  await b.edu.check(); await b.edu.idle();
  check(b.edu.load().items[0].kind !== "motion", "tanpa modul motion: papan tulis");

  const c = setup();
  await c.edu.handle("buat matematika kelas 3"); await c.edu.idle();
  check(c.rec.buatIsi.length === 0 && c.edu.load().items[0].kind === "math", "/edu buat matematika kelas 3: papan tulis sesuai permintaan");
}

// ---- jadwal lewat check() dan 'buat ulang' draf motion
{
  const a = setup();
  a.clock.t = wita("2026-10-31", "08:00");
  await a.edu.check(); await a.edu.idle();
  check(muatState(a.temaFile).usulan?.minggu === "2026-11-02", "edu.check() menjalankan jadwal usulan tema");
  const b = setup();
  await b.edu.check(); await b.edu.idle();
  const it = b.edu.load().items[0];
  const out = await b.edu.decide(`again:${it.id}`); await b.edu.idle();
  const baru = b.edu.load().items.at(-1);
  check(/Membuat pengganti/.test(out) && baru.id !== it.id && baru.mode === "motion" && baru.topic === it.topic && baru.templatId === it.templatId, "buat ulang draf motion: topik & templat sama");
  const c = setup();
  const cb = await c.edu.temaCallback("tema:setuju:2026-11-02");
  check(/Belum ada usulan/.test(cb), "temaCallback tanpa usulan: pesan jelas");
}

console.log(fails ? `\n${fails} GAGAL` : "\nsemua lolos");
process.exit(fails ? 1 : 0);
