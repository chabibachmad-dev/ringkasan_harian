// Tes Short harian + agenda mingguan dua kanal (Telegram & WhatsApp). Jam, LLM, pencarian, suara, render, YouTube: PALSU (tanpa jaringan).
//   node test-shorts-harian.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEdu, readEduConfig } from "./edu-channel.js";
import { createMotion, readMotionConfig } from "./edu-motion.js";
import { createShortsHarian, readShortsConfig } from "./shorts-harian.js";
import { silentWav, wavSeconds, beatSeconds } from "./edu-board.js";
import { muatState, simpanState, usulkanMinggu, BANK_TEMA } from "./motion/tema-mingguan.js";
import { templatUntuk, temaMinggu } from "./motion/templates/index.js";
import { metaShorts } from "./motion/youtube-meta.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };
const TZ = "Asia/Makassar";
const wita = (tgl, hhmm) => Date.parse(`${tgl}T${hhmm}:00+08:00`);
const RABU = "2026-10-28";

// ---- konfigurasi
{
  const c = readShortsConfig({});
  check(c.aktif && c.jam === "12:00" && c.maksCoba === 2, "bawaan: aktif, jam 12:00, 2 percobaan");
  check(readShortsConfig({ SHORTS_JAM: "09:30", SHORTS_AKTIF: "0" }).jam === "09:30" && readShortsConfig({ SHORTS_AKTIF: "0" }).aktif === false, "SHORTS_JAM dan SHORTS_AKTIF dibaca");
  check(readShortsConfig({ SHORTS_JAM: "25:99" }).jam === "12:00", "jam tak valid -> 12:00");
  check(readEduConfig({}).shortsPublishTime === "18:00" && readEduConfig({ SHORTS_TAYANG: "19:15" }).shortsPublishTime === "19:15", "SHORTS_TAYANG dibaca");
}

// ---- alat uji
function setup(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-"));
  const clock = { t: wita(RABU, "11:00") };
  const sent = { tg: [], wa: [] };
  const sendText = async (text, o) => {
    if (o?.kecuali !== "telegram" && (!o?.hanya || o.hanya === "telegram")) sent.tg.push({ text, markup: o?.markup });
    if (o?.kecuali !== "wa" && (!o?.hanya || o.hanya === "wa")) sent.wa.push(text);
    return 1;
  };
  const rec = { isi: [], tts: [], render: [], antrean: 0, search: 0, ttsKosong: false, gagal: new Set(), gagalSemua: false, infra: false };
  const speaker = { available: () => true, async speakWav(text) { return { wav: silentWav(Math.min(14, 1 + text.length / 14)), text }; } };
  const temaFile = path.join(dir, "tema.json");
  const motion = createMotion({
    config: { ...readMotionConfig(over.motionEnv || {}), temaFile, channelName: "Belajar Bareng", style: "ramah" },
    tz: TZ, llm: async () => { throw new Error("llm palsu"); }, speaker, now: () => clock.t, log: quiet, sendText
  });
  const config = readEduConfig({ EDU_ENABLED: "true", EDU_MODE: "papan", EDU_DIR: path.join(dir, "edu"), WA_TIMEZONE: TZ, ...(over.env || {}) });
  const renderer = {
    async render({ beats, wavs, outFile }) {
      fs.writeFileSync(outFile, Buffer.alloc(40_000, 2));
      let t = 0; const timeline = beats.map((b, i) => { const d = beatSeconds(wavs[i] ? wavSeconds(wavs[i]) : 0, b.hold || 0); const e = { section: b.section, firstOfSection: !!b.firstOfSection, start: t, dur: d }; t += d; return e; });
      return { file: outFile, seconds: t, timeline, overflowClears: 0 };
    }
  };
  const yt = { uploads: [], available: () => true, status: () => ({ broken: null }), setThumbnail: async () => ({ ok: true }) };
  yt.upload = async (o) => { yt.uploads.push(o); const id = `vid${yt.uploads.length}`; return { id, url: `https://youtu.be/${id}`, studioUrl: `https://studio/${id}`, publishAt: new Date(o.publishAt).toISOString() }; };
  const edu = createEdu({
    config, speaker, renderer, youtube: yt, motion,
    thumbnail: async ({ outFile }) => { fs.writeFileSync(outFile, Buffer.alloc(2000, 2)); return outFile; },
    sendText, sendFile: async (file, caption) => { (sent.files ||= []).push({ file, caption }); return 1; },
    loadCards: () => JSON.parse(fs.readFileSync(new URL("./data/edu-sains.json", import.meta.url), "utf8")),
    now: () => clock.t, log: quiet
  });
  const SUMBER = [
    { judul: "Britannica", url: "https://www.britannica.com/a" }, { judul: "NASA", url: "https://science.nasa.gov/b" },
    { judul: "NASA 2", url: "https://science.nasa.gov/c" }, { judul: "Wiki", url: "https://id.wikipedia.org/d" }, { judul: "Lain", url: "https://example.org/e" }
  ];
  const antrean = { jalankan: (fn) => { rec.antrean += 1; return fn(); } };
  const shorts = createShortsHarian({
    config: { ...readShortsConfig(over.shortsEnv || {}), channelName: "Belajar Bareng", skala: 1.5 }, edu, motion, llm: async () => "x",
    cari: async () => { rec.search += 1; return []; }, antrean, sendText, dir: config.dir, tz: TZ, now: () => clock.t, log: quiet,
    tts: async (teks) => { rec.tts.push(teks); if (rec.ttsKosong) return null; const f = path.join(dir, `n${rec.tts.length}.wav`); fs.writeFileSync(f, silentWav(3)); return f; },
    lib: {
      buatIsiFaktaCadangan: async (a) => {
        rec.isi.push(a);
        if (rec.infra) throw new Error("fetch failed");
        if (rec.gagalSemua || rec.gagal.has(a.topik)) throw new Error(`Sumber kurang untuk "${a.topik}" (butuh 2 situs berbeda)`);
        return { isi: { judul: `Fakta ${a.topik}`, sumberTeks: "", inti: "x" }, hook: "Tahukah kamu?", dasar: `Dasar ${a.topik}`, narasi: `Narasi ${a.topik}.`, sumber: SUMBER, templatId: over.templatId || a.templatId };
      },
      renderVideo: async (a) => { rec.render.push(a); fs.writeFileSync(a.keluar, Buffer.alloc(40_000, 1)); return { berkas: a.keluar, durasi: 22, templat: a.templatId, lebar: 1620, tinggi: 2880 }; }
    }
  });
  return { dir, temaFile, clock, sent, rec, motion, edu, shorts, yt, config, SUMBER };
}
/** Agenda pekan 26 Okt - 1 Nov yang sudah disetujui; topik Rabu bisa diatur. */
async function agenda(temaFile, { status = "disetujui", rabu = "Tinggi Gunung Everest", pelajaran = "Siklus air" } = {}) {
  const u = await usulkanMinggu({ llm: null, senen: "2026-10-26" });
  u.status = status;
  const h = u.hari.find((x) => x.tanggal === RABU); h.topik = rabu; h.pelajaran = { topik: pelajaran, sumber: "owner" };
  simpanState(temaFile, { usulan: u, temaOwner: [], riwayat: [] });
  return h;
}
const tpl = templatUntuk(RABU);

// ---- agenda dua kanal: Telegram + WhatsApp, keputusan pertama berlaku
{
  const { clock, sent, motion, temaFile } = setup();
  clock.t = wita("2026-10-31", "08:00"); await motion.tickTema();
  check(sent.tg.length === 1 && /Usulan tema pekan/.test(sent.tg[0].text) && sent.tg[0].markup, "Sabtu 08:00: usulan ke Telegram dengan tombol");
  check(sent.wa.length === 1 && /Usulan tema pekan/.test(sent.wa[0]), "Sabtu 08:00: usulan juga ke WhatsApp pemilik");

  let r = await motion.teks("ganti 3: Planet Mars", { kanal: "wa" });
  check(r.handled && muatState(temaFile).usulan.hari[2].topik === "Planet Mars", "WA: 'ganti 3: topik' diterapkan");
  check(sent.tg.some((t) => /lewat WhatsApp/.test(t.text) && /Planet Mars/.test(t.text)), "Telegram dikabari perubahan dari WhatsApp");
  r = await motion.teks("pelajaran 4: Magnet", { kanal: "wa" });
  check(r.handled && muatState(temaFile).usulan.hari[3].pelajaran.topik === "Magnet", "WA: 'pelajaran 4: topik' diterapkan");
  const t0 = muatState(temaFile).usulan.hari.map((x) => x.topik);
  r = await motion.teks("tukar 1 2", { kanal: "telegram" });
  const t1 = muatState(temaFile).usulan.hari.map((x) => x.topik);
  check(r.handled && t1[0] === t0[1] && t1[1] === t0[0], "Telegram: 'tukar 1 2' diterapkan");
  check(sent.wa.some((t) => /lewat Telegram/.test(t)), "WA dikabari perubahan dari Telegram");
  r = await motion.teks("tema: Gunung berapi; Hewan laut", { kanal: "wa" });
  check(r.handled && muatState(temaFile).temaOwner.length === 2, "WA: 'tema: ...' masuk antrean tema");
  r = await motion.teks("halo apa kabar", { kanal: "wa" });
  check(r.handled === false, "WA: obrolan biasa tidak dicegat");
  r = await motion.teks("ok", { kanal: "wa" });
  check(r.handled === false, "WA: 'ok' biasa tidak dicegat");

  const nTg = sent.tg.length;
  r = await motion.teks("setuju", { kanal: "wa" });
  const u = muatState(temaFile).usulan;
  check(r.handled && u.status === "disetujui" && u.disetujuiLewat === "wa", "WA: 'setuju' diterima, tercatat lewat WA");
  check(sent.tg.slice(nTg).some((t) => /lewat WhatsApp/.test(t.text) && /disetujui/.test(t.text)), "Telegram dikabari persetujuan dari WhatsApp");
  const out = await motion.callback("tema:setuju:2026-11-02", { kanal: "telegram" });
  check(/sudah disetujui lewat WhatsApp/.test(out), "tombol Setuju di Telegram sesudahnya: 'sudah disetujui lewat WhatsApp'");
  const out2 = await motion.callback("tema:ulang:2026-11-02", { kanal: "telegram" });
  check(/sudah disetujui/.test(out2) && muatState(temaFile).usulan.hari[2].topik === "Planet Mars", "tombol Usul ulang sesudah disetujui ditolak, tema tetap");
  r = await motion.teks("usul ulang", { kanal: "wa" });
  check(r.handled && muatState(temaFile).usulan.status === "disetujui", "WA 'usul ulang' sesudah disetujui ditolak");
  clock.t = wita("2026-11-01", "21:00"); const n = sent.wa.length; await motion.tickTema();
  check(sent.wa.length === n && muatState(temaFile).usulan.disetujuiOleh === "owner", "Minggu 21:00: tidak ada persetujuan otomatis lagi");
}
{
  // Telegram menang lebih dulu, WA menyusul
  const { clock, sent, motion, temaFile } = setup();
  clock.t = wita("2026-10-31", "08:00"); await motion.tickTema();
  const out = await motion.callback("tema:setuju:2026-11-02", { kanal: "telegram" });
  check(/disetujui/.test(out) && muatState(temaFile).usulan.disetujuiLewat === "telegram", "Telegram setuju lebih dulu");
  check(sent.wa.some((t) => /lewat Telegram/.test(t)), "WA dikabari persetujuan dari Telegram");
  const nWa = sent.wa.length;
  const r = await motion.teks("setuju", { kanal: "wa" });
  check(r.handled && sent.wa.length === nWa + 1 && /sudah disetujui lewat Telegram/.test(sent.wa.at(-1)), "WA 'setuju' menyusul: 'sudah disetujui lewat Telegram'");
}
{
  // pengingat & persetujuan otomatis ke kedua kanal; TEMA_OTOMATIS=0 mematikan
  const { clock, sent, motion, temaFile } = setup();
  for (const [d, j] of [["2026-10-31", "08:00"], ["2026-11-01", "18:00"], ["2026-11-01", "21:00"]]) { clock.t = wita(d, j); await motion.tickTema(); }
  check(sent.wa.length === 3 && sent.tg.length === 3, "usulan, pengingat, dan persetujuan otomatis masuk ke kedua kanal");
  check(muatState(temaFile).usulan.disetujuiOleh === "otomatis", "Minggu 21:00: disetujui otomatis");
  const o = setup({ motionEnv: { TEMA_OTOMATIS: "0" } });
  for (const [d, j] of [["2026-10-31", "08:00"], ["2026-11-01", "21:30"]]) { o.clock.t = wita(d, j); await o.motion.tickTema(); }
  check(muatState(o.temaFile).usulan.status === "diusulkan", "TEMA_OTOMATIS=0: tidak disetujui otomatis");
}

// ---- Short harian: jalur normal
{
  const { clock, sent, rec, temaFile, edu, shorts, yt, SUMBER } = setup();
  await agenda(temaFile);
  // video pelajaran hari itu sudah terunggah -> tautannya masuk deskripsi Short
  clock.t = wita(RABU, "03:00"); await edu.check(); await edu.idle();
  const pel = edu.load().items[0];
  check(pel && pel.kind !== "motion" && pel.kind !== "short", "video pelajaran 16:9 tetap dibuat (papan tulis) pada pukul 03:00");
  check(pel.pemetaan && /Siklus air/i.test(pel.pemetaan.diminta) && /Siklus Air/.test(pel.pemetaan.dipakai) && pel.key === "sains:siklus-air", "topik pelajaran dari agenda dipetakan ke materi bank (Siklus Air)");
  await edu.decide(`ok:${pel.id}`); await edu.idle();
  const linkPel = edu.load().items[0].ytUrl;
  check(!!linkPel, "video pelajaran terunggah");

  clock.t = wita(RABU, "11:59"); await shorts.check(); await shorts.idle();
  check(rec.isi.length === 0, "11:59: Short belum dibuat");
  clock.t = wita(RABU, "12:00"); await shorts.check(); await shorts.idle();
  check(rec.isi.length === 1 && rec.isi[0].topik === "Tinggi Gunung Everest" && rec.isi[0].templatId === tpl.id, "12:00: topik dari agenda + templat dari templatUntuk(hari ini)");
  check(rec.tts[0] === "Narasi Tinggi Gunung Everest.", "narasi dari r.narasi dikirim ke TTS");
  const rd = rec.render[0];
  check(rd.templatId === tpl.id && rd.hook === "Tahukah kamu?" && rd.teaser === "Siklus air" && rd.teaserLabel === "TONTON JUGA" && rd.skala === 1.5, "render: templat, hook, teaser pelajaran, label 'TONTON JUGA', skala 1,5");
  check(rd.tema === temaMinggu(tpl, RABU), "render: tema = temaMinggu(templat, tanggal)");
  check(rd.isi.sumberTeks === "Sumber: britannica.com, science.nasa.gov, id.wikipedia.org", "sumberTeks: maks 3 domain unik");
  check(rec.antrean === 1, "render lewat antrean bersama");
  const it = edu.load().items.find((i) => i.kind === "short");
  check(it && it.status === "awaiting" && yt.uploads.length === 1, "Short menunggu persetujuan; belum ada unggahan");
  const kirim = sent.tg.at(-1).text;
  check(sent.files?.length >= 1 && /Short/.test(sent.files.at(-1).caption), "video Short dikirim ke pemilik (Telegram)");
  check(/Dasar fakta: Dasar Tinggi/.test(kirim) && SUMBER.slice(0, 2).every((s) => kirim.includes(s.url)) && kirim.includes("Britannica"), "Telegram: dasar + daftar sumber (judul + URL)");
  check(sent.wa.some((t) => /Short 2026-10-28 siap diperiksa/.test(t) && t.includes(SUMBER[0].url)), "WA: ringkasan + sumber");
  check(it.description.includes(linkPel), "deskripsi memuat tautan video pelajaran hari itu");
  await shorts.check(); await shorts.idle();
  check(rec.isi.length === 1, "tidak dibuat dua kali pada hari yang sama");

  // setuju -> unggah
  const msg = await edu.decide(`ok:${it.id}`); await edu.idle();
  const up = yt.uploads.at(-1);
  check(yt.uploads.length === 2 && up.madeForKids === true && up.aiDisclosure === true, "setelah disetujui: diunggah dengan madeForKids & containsSyntheticMedia");
  check(up.title === metaShorts({ templatId: tpl.id, isi: { judul: "Fakta Tinggi Gunung Everest" }, hook: "Tahukah kamu?", topik: "Tinggi Gunung Everest" }).judul && /#Shorts/.test(up.title), "judul Short sesuai metaShorts");
  check(new Date(up.publishAt).toISOString() === new Date(wita("2026-10-28", "18:00")).toISOString(), "tayang pukul SHORTS_TAYANG (18:00 WITA), terpisah dari video pelajaran (16:00)");
  const jadwalPel = new Date(yt.uploads[0].publishAt).getTime();
  check(jadwalPel !== new Date(up.publishAt).getTime(), "slot Short tidak menggeser slot video pelajaran");
  check(muatState(temaFile).riwayat.includes("Tinggi Gunung Everest"), "catatRiwayat dipanggil setelah posting");
  void msg;
}

// ---- kegagalan: topik cadangan, lewati, infrastruktur
{
  const a = setup();
  await agenda(a.temaFile);
  a.rec.gagal.add("Tinggi Gunung Everest");
  a.clock.t = wita(RABU, "12:00"); await a.shorts.check(); await a.shorts.idle();
  const bank = a.rec.isi[1]?.topik;
  check(a.rec.isi.length === 2 && BANK_TEMA[tpl.id].includes(bank), "topik agenda gagal -> SATU topik cadangan dari BANK_TEMA");
  check(a.edu.load().items.some((i) => i.kind === "short" && i.topic === bank) && a.sent.tg.some((t) => /topik cadangan/.test(t.text)) || a.sent.wa.some((t) => /topik cadangan/.test(t)), "Short cadangan diajukan + pemilik diberi tahu");

  const b = setup();
  await agenda(b.temaFile);
  b.rec.gagalSemua = true;
  b.clock.t = wita(RABU, "12:00"); await b.shorts.check(); await b.shorts.idle();
  check(b.rec.isi.length === 2 && b.rec.render.length === 0, "semua gagal: tepat dua percobaan (agenda + 1 cadangan), tidak ada render");
  check(!b.edu.load().items.some((i) => i.kind === "short") && b.sent.tg.some((t) => /dilewati/.test(t.text)) && b.sent.wa.some((t) => /dilewati/.test(t)), "hari dilewati + pemilik diberi tahu di kedua kanal");
  b.clock.t = wita(RABU, "14:00"); await b.shorts.check(); await b.shorts.idle();
  check(b.rec.isi.length === 2, "hari yang dilewati tidak dicoba lagi");
  b.clock.t = wita("2026-10-29", "12:00"); b.rec.gagalSemua = false; await b.shorts.check(); await b.shorts.idle();
  check(b.rec.isi.length === 3 && b.edu.load().items.some((i) => i.kind === "short"), "hari berikutnya berjalan normal");

  // tanpa agenda: langsung topik bank; infrastruktur mati: dicoba lagi lalu dilewati
  const c = setup();
  c.clock.t = wita(RABU, "12:00"); await c.shorts.check(); await c.shorts.idle();
  check(c.rec.isi.length === 1 && BANK_TEMA[tpl.id].includes(c.rec.isi[0].topik) && c.rec.render.length === 1, "tanpa agenda: topik dari BANK_TEMA");

  const d = setup();
  await agenda(d.temaFile);
  d.rec.infra = true;
  d.clock.t = wita(RABU, "12:00"); await d.shorts.check(); await d.shorts.idle();
  check(d.rec.isi.length === 1, "pencarian/LLM mati: topik cadangan tidak dibuang percuma");
  d.clock.t = wita(RABU, "12:10"); await d.shorts.check(); await d.shorts.idle();
  check(d.rec.isi.length === 1, "dicoba lagi paling cepat 20 menit kemudian");
  d.clock.t = wita(RABU, "12:25"); await d.shorts.check(); await d.shorts.idle();
  check(d.rec.isi.length === 2 && d.sent.tg.some((t) => /dilewati setelah 2 percobaan/.test(t.text)), "setelah maksCoba: dilewati + pemberitahuan");

  const e = setup();
  await agenda(e.temaFile);
  e.rec.ttsKosong = true;
  e.clock.t = wita(RABU, "12:00"); await e.shorts.check(); await e.shorts.idle();
  check(e.rec.render.length === 0 && !e.edu.load().items.some((i) => i.kind === "short"), "TTS kosong: tidak merender, tidak mengajukan");
}

// ---- Short tidak mengganggu video pelajaran; buat ulang; jeda
{
  const s = setup({ shortsEnv: { SHORTS_JAM: "09:00" } });
  await agenda(s.temaFile);
  s.clock.t = wita(RABU, "08:59"); await s.shorts.check(); await s.shorts.idle();
  check(s.rec.isi.length === 0, "SHORTS_JAM=09:00: 08:59 belum jalan");
  s.clock.t = wita(RABU, "09:00"); await s.shorts.check(); await s.shorts.idle();
  check(s.rec.isi.length === 1, "SHORTS_JAM=09:00: 09:00 jalan");
  const it = s.edu.load().items.find((i) => i.kind === "short");
  const hasil = await s.edu.decide(`again:${it.id}`); await s.shorts.idle();
  const baru = s.edu.load().items.filter((i) => i.kind === "short" && i.status === "awaiting");
  check(/Membuat pengganti/.test(hasil) && baru.length === 1 && baru[0].topic === it.topic && baru[0].id !== it.id, "'Buat ulang': Short pengganti dengan topik sama");
  const buang = await s.edu.decide(`no:${baru[0].id}`);
  check(/dibuang/.test(buang), "Short bisa dibuang");
  // lesson produksi tidak terblokir oleh Short yang menunggu
  const lesson = setup({ env: { EDU_MAX_PENDING: "1" } });
  await agenda(lesson.temaFile);
  lesson.clock.t = wita(RABU, "03:00"); await lesson.edu.check(); await lesson.edu.idle();
  check(lesson.edu.load().items.filter((i) => i.kind !== "short").length === 1, "video pelajaran dibuat sesuai EDU_RENDER_TIME");
  const off = setup({ shortsEnv: { SHORTS_AKTIF: "0" } });
  off.clock.t = wita(RABU, "12:00"); await off.shorts.check(); await off.shorts.idle();
  check(off.rec.isi.length === 0, "SHORTS_AKTIF=0: tidak ada Short");
}
// pemetaan pelajaran: topik tak dikenal -> rotasi biasa + keterangan jujur
{
  const s = setup();
  await agenda(s.temaFile, { pelajaran: "Bilangan genap dan ganjil" });
  s.clock.t = wita(RABU, "03:00"); await s.edu.check(); await s.edu.idle();
  const pel = s.edu.load().items[0];
  check(pel.pemetaan && pel.pemetaan.dipakai === "" && pel.kind, "topik pelajaran di luar bank: rotasi biasa, pemetaan dicatat");
  check(s.sent.tg.some((t) => /Agenda: "Bilangan genap dan ganjil" belum ada di bank materi/.test(t.text)), "pemilik diberi tahu keterbatasan pemetaan");
}

console.log(fails ? `\n${fails} GAGAL` : "\nsemua lolos");
process.exit(fails ? 1 : 0);
