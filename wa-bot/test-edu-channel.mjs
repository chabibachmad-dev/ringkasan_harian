// Tes pengatur channel edukasi (edu-channel.js) dengan suara, perakit video, YouTube, dan Telegram PALSU.
//   node test-edu-channel.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEdu, readEduConfig, nextPublishAt, zonedToMs, localDay, buildDescription } from "./edu-channel.js";
import { silentWav, wavSeconds, beatSeconds } from "./edu-board.js";
import { YoutubeError } from "./youtube.js";
import { buildMathPlan } from "./edu-bank.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };
const TZ = "Asia/Makassar"; // UTC+8
const utc = (s) => Date.parse(s);

// ---- konfigurasi
{
  const c = readEduConfig({});
  check(c.enabled === false && c.renderTime === "02:00" && c.publishTime === "16:00" && c.maxPending === 3, "bawaan: mati, buat 02:00, tayang 16:00");
  const d = readEduConfig({ EDU_ENABLED: "true", EDU_GRADES: "2, 5,9,x", EDU_MIX: "math:1,sains:1", EDU_RENDER_TIME: "7:30", EDU_PUBLISH_TIME: "99:99", EDU_MIN_SEC: "70", EDU_MAX_SEC: "20" });
  check(d.enabled && d.grades.join() === "2,5" && d.mix.sains === 1 && d.renderTime === "07:30" && d.publishTime === "16:00", "EDU_* dibaca & dibersihkan");
  check(d.maxSec >= d.minSec + 10, "maks selalu > min");
}

// ---- waktu & slot tayang
{
  check(zonedToMs(2026, 10, 28, 16, 0, TZ) === utc("2026-10-28T08:00:00Z"), "16:00 WITA = 08:00 UTC");
  check(localDay(utc("2026-10-27T17:00:00Z"), TZ) === "2026-10-28", "17:00 UTC sudah tanggal 28 di WITA");
  const slot = (now, taken = []) => nextPublishAt({ now: utc(now), publishTime: "16:00", tz: TZ, taken: taken.map(utc) });
  check(slot("2026-10-27T06:00:00Z") === utc("2026-10-27T08:00:00Z"), "14:00 WITA → hari ini 16:00");
  check(slot("2026-10-27T07:50:00Z") === utc("2026-10-28T08:00:00Z"), "kurang dari 30 mnt lagi → besok");
  check(slot("2026-10-27T10:00:00Z") === utc("2026-10-28T08:00:00Z"), "malam hari → besok 16:00");
  check(slot("2026-10-27T06:00:00Z", ["2026-10-27T08:00:00Z", "2026-10-28T08:00:00Z"]) === utc("2026-10-29T08:00:00Z"), "hari yang terisi dilewati (satu video per hari)");
  check(slot("2026-12-31T06:00:00Z", ["2026-12-31T08:00:00Z"]) === utc("2027-01-01T08:00:00Z"), "pergantian tahun");
  const ny = nextPublishAt({ now: utc("2026-03-08T12:00:00Z"), publishTime: "16:00", tz: "America/New_York", taken: [] });
  check(new Date(ny).toISOString() === "2026-03-08T20:00:00.000Z", "zona dengan DST (New York 16:00 EDT)");
}

// ---- alat uji
function setup(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edu-"));
  const env = { EDU_ENABLED: "true", EDU_DIR: dir, WA_TIMEZONE: TZ, EDU_MIN_SEC: "60", EDU_MAX_SEC: "120", ...(over.env || {}) };
  const config = readEduConfig(env);
  const clock = { t: utc("2026-10-27T19:00:00Z") }; // 03:00 WITA tanggal 28
  const sent = { text: [], files: [] };
  const sp = { calls: 0, perChar: 14, quotaAfter: Infinity };
  const speaker = {
    available: () => true,
    async speakWav(text) {
      sp.calls += 1;
      if (sp.calls > sp.quotaAfter) throw Object.assign(new Error("kuota habis"), { quota: true });
      return { wav: silentWav(Math.min(14, 1 + text.length / sp.perChar)), text };
    }
  };
  const renderer = {
    renders: 0,
    async render({ beats, wavs, outFile }) {
      this.renders += 1;
      fs.writeFileSync(outFile, Buffer.alloc(40_000, 1));
      let t = 0;
      const timeline = beats.map((b, i) => { const d = beatSeconds(wavs[i] ? wavSeconds(wavs[i]) : 0, b.hold || 0); const e = { section: b.section, firstOfSection: !!b.firstOfSection, start: t, dur: d }; t += d; return e; });
      return { file: outFile, seconds: t, timeline, overflowClears: 0 };
    }
  };
  const yt = over.youtube === undefined ? makeYt() : over.youtube;
  const edu = createEdu({
    config, speaker, renderer,
    thumbnail: async ({ outFile }) => { fs.writeFileSync(outFile, Buffer.alloc(2000, 2)); return outFile; },
    youtube: yt,
    sendText: async (text, o) => { sent.text.push({ text, markup: o?.markup }); return 1; },
    sendFile: async (file, caption) => { sent.files.push({ file, caption }); return 1; },
    loadCards: () => JSON.parse(fs.readFileSync(new URL("./data/edu-sains.json", import.meta.url), "utf8")),
    now: () => clock.t, log: quiet
  });
  return { dir, config, clock, sent, sp, speaker, renderer, yt, edu };
}
function makeYt() {
  const y = { ok: true, uploads: [], thumbs: [], failWith: null, _avail: true, _broken: null };
  y.available = () => y._avail;
  y.status = () => ({ broken: y._broken });
  y.upload = async (o) => {
    if (y.failWith) { const e = y.failWith; y.failWith = null; throw e; }
    y.uploads.push(o);
    const id = `vid${y.uploads.length}`;
    return { id, url: `https://youtu.be/${id}`, studioUrl: `https://studio.youtube.com/video/${id}/edit`, publishAt: new Date(o.publishAt).toISOString() };
  };
  y.setThumbnail = async (id, f) => { y.thumbs.push([id, f]); return { ok: true }; };
  y.verify = async () => ({ ok: true, scopes: ["https://www.googleapis.com/auth/youtube.upload"], canUpload: true });
  return y;
}
const tick = async (e) => { await e.check(); await e.idle(); };

// ---- alur utama: buat → setujui → unggah terjadwal
{
  const { clock, sent, edu, yt, speaker } = setup();
  await tick(edu);
  const items = edu.load().items;
  check(items.length === 1 && items[0].status === "awaiting", "pukul 03:00 (≥ 02:00): satu draf dibuat");
  check(sent.files.length === 1 && sent.files[0].file.video === true && sent.files[0].file.data.length === 40_000, "video terkirim ke Telegram");
  const m = sent.text.at(-1);
  check(m.markup?.flat().map((b) => b.callback_data).join() === `ed:ok:${items[0].id},ed:again:${items[0].id},ed:no:${items[0].id}`, "tombol setujui / ulang / buang");
  check(/Kunci jawaban/.test(m.text) && /\/edu naskah/.test(m.text), "kunci jawaban & tautan naskah ikut dikirim");
  const it = items[0];
  check(it.seconds >= 55 && it.seconds <= 125, `durasi ${it.seconds} dtk dalam rentang 60–120`);
  check(/suara sintetis/.test(it.description) && /#/.test(it.description), "deskripsi memuat keterangan AI & tagar");
  await tick(edu);
  check(edu.load().items.length === 1, "satu video per hari: pemeriksaan berikutnya tidak membuat lagi");

  const reply = await edu.decide(`ok:${it.id}`);
  await edu.idle();
  const up = yt.uploads[0];
  check(/Disetujui/.test(reply) && up, "disetujui → diunggah");
  check(up.publishAt === utc("2026-10-28T08:00:00Z") || up.publishAt === utc("2026-10-29T08:00:00Z"), "jadwal tayang jam 16:00 WITA");
  check(up.publishAt >= clock.t + 30 * 60_000, "jadwal paling cepat 30 menit ke depan");
  check(yt.thumbs.length === 1 && yt.thumbs[0][0] === "vid1", "sampul dipasang");
  check(edu.load().items[0].status === "scheduled" && /terjadwal/.test(sent.text.at(-1).text) && /studio\.youtube\.com/.test(sent.text.at(-1).text), "status terjadwal + tautan Studio");
  check(/sudah berstatus/.test(await edu.decide(`ok:${it.id}`)), "setuju dua kali tidak mengunggah dua kali");
  check(yt.uploads.length === 1, "hanya satu unggahan");

  // hari berikutnya → draf kedua; jadwalnya tidak bentrok
  clock.t += 24 * 3600_000;
  await tick(edu);
  const it2 = edu.load().items[1];
  check(it2 && it2.status === "awaiting" && it2.key !== it.key, "hari berikutnya: draf baru, materi berbeda");
  await edu.decide(`ok:${it2.id}`);
  await edu.idle();
  check(yt.uploads[1].publishAt !== yt.uploads[0].publishAt && yt.uploads[1].publishAt - yt.uploads[0].publishAt === 24 * 3600_000, "jadwal video kedua tepat sehari setelah yang pertama");
  void speaker;
}

// ---- batas draf menunggu, jeda, dan mati
{
  const { clock, edu, sent } = setup({ env: { EDU_MAX_PENDING: "2" } });
  for (let d = 0; d < 4; d++) { await tick(edu); clock.t += 24 * 3600_000; }
  check(edu.load().items.filter((i) => i.status === "awaiting").length === 2, "berhenti membuat setelah 2 draf belum diputuskan");
  const before = sent.files.length;
  await edu.handle("jeda");
  const b = setup();
  await b.edu.handle("jeda");
  await tick(b.edu);
  check(b.edu.load().items.length === 0, "dijeda: tidak membuat");
  await b.edu.handle("lanjut");
  await tick(b.edu);
  check(b.edu.load().items.length === 1, "dilanjutkan: membuat");
  void before;
  const off = setup({ env: { EDU_ENABLED: "false" } });
  await tick(off.edu);
  check(off.edu.load().items.length === 0 && /belum aktif/.test(await off.edu.handle("")), "EDU_ENABLED=false: diam");
  const early = setup();
  early.clock.t = utc("2026-10-27T17:00:00Z"); // 01:00 WITA
  await tick(early.edu);
  check(early.edu.load().items.length === 0, "sebelum jam buat (01:00 < 02:00): menunggu");
}

// ---- buat ulang & buang
{
  const { edu, sent } = setup();
  const r = await edu.handle("buat kelas 4 matematika");
  await edu.idle();
  const it = edu.load().items[0];
  check(/Membuat draf kelas 4/.test(r) && it.grade === 4 && it.kind === "math", "/edu buat kelas 4 matematika");
  const rr = await edu.decide(`again:${it.id}`);
  await edu.idle();
  const items = edu.load().items;
  check(/dibuang/.test(rr) && items[0].status === "rejected" && !fs.existsSync(items[0].file) && items[1].status === "awaiting" && items[1].grade === 4 && items[1].kind === "math", "buat ulang: lama dibuang, baru kelas & jenis sama");
  check(items[1].key !== items[0].key || items[1].title !== items[0].title, "pengganti bukan materi yang sama persis");
  await edu.decide(`no:${items[1].id}`);
  check(edu.load().items[1].status === "rejected", "buang lewat tombol");
  check(/tidak ditemukan/.test(await edu.handle("naskah 999")) && /Naskah/.test(await edu.handle("naskah 2")), "naskah");
  void sent;
  const bad = await edu.handle("buat kelas 9");
  check(/1 sampai 6/.test(bad), "kelas di luar 1-6 ditolak");
}

// ---- tanpa YouTube / izin rusak / kegagalan unggah
{
  const s = setup({ youtube: makeYt() });
  s.yt._avail = false;
  await tick(s.edu);
  const it = s.edu.load().items[0];
  const r = await s.edu.decide(`ok:${it.id}`);
  await s.edu.idle();
  check(/belum tersambung/.test(r) && s.edu.load().items[0].status === "approved" && s.yt.uploads.length === 0, "tanpa YouTube: disetujui & disimpan");
  s.yt._avail = true;
  await tick(s.edu);
  check(s.yt.uploads.length === 1 && s.edu.load().items[0].status === "scheduled", "begitu YouTube siap, diunggah otomatis");

  const a = setup();
  await tick(a.edu);
  a.yt.failWith = new YoutubeError("auth", "Token ditolak");
  await a.edu.decide(`ok:${a.edu.load().items[0].id}`);
  await a.edu.idle();
  check(a.edu.load().items[0].status === "failed" && /youtube-auth\.mjs/.test(a.sent.text.at(-1).text), "izin ditolak → gagal + petunjuk youtube-auth.mjs");
  const id = a.edu.load().items[0].id;
  check(/Mengunggah ulang/.test(await a.edu.handle(`ulang ${id}`)), "/edu ulang");
  await a.edu.idle();
  check(a.edu.load().items[0].status === "scheduled", "unggah ulang berhasil");

  const n = setup();
  await tick(n.edu);
  n.yt.failWith = new YoutubeError("network", "putus");
  await n.edu.decide(`ok:${n.edu.load().items[0].id}`);
  await n.edu.idle();
  const it2 = n.edu.load().items[0];
  check(it2.status === "approved" && it2.retryAt > n.clock.t, "gangguan jaringan → dicoba lagi nanti");
  await tick(n.edu);
  check(n.edu.load().items[0].status === "approved", "belum waktunya ulang");
  n.clock.t += 11 * 60_000;
  await tick(n.edu);
  check(n.edu.load().items[0].status === "scheduled", "setelah 10 menit diulang & berhasil");

  const q = setup();
  await tick(q.edu);
  q.yt.failWith = new YoutubeError("quota", "quotaExceeded");
  await q.edu.decide(`ok:${q.edu.load().items[0].id}`);
  await q.edu.idle();
  check(q.edu.load().items[0].retryAt - q.clock.t >= 19 * 3600_000, "jatah habis → coba lagi besok");
}

// ---- suara: kuota habis → cache dipakai ulang
{
  const s = setup();
  s.sp.quotaAfter = 4;
  await tick(s.edu);
  check(s.edu.load().items.length === 0 && /Gagal membuat video/.test(s.sent.text.at(-1).text) && /Kuota suara/.test(s.sent.text.at(-1).text), "kuota habis: pemilik diberi tahu");
  const cached = fs.readdirSync(path.join(s.dir, "tts-cache")).length;
  check(cached === 4, "empat potong suara pertama tersimpan di cache");
  const msgs = s.sent.text.length;
  await tick(s.edu);
  check(s.sent.text.length === msgs && s.edu.load().items.length === 0, "belum 90 menit: tidak mencoba lagi");
  s.sp.quotaAfter = Infinity;
  s.clock.t += 95 * 60_000;
  const callsBefore = s.sp.calls;
  await tick(s.edu);
  check(s.edu.load().items.length === 1, "setelah 90 menit: selesai");
  check(s.sp.calls - callsBefore > 0, "sisa potong suara diminta");
  // potongan yang sudah di-cache tidak diminta lagi
  const texts = new Set();
  const s2 = setup();
  s2.speaker.speakWav = async (t) => { texts.add(t); return { wav: silentWav(4) }; };
  await tick(s2.edu);
  const n1 = texts.size;
  check(n1 > 5, "tiap adegan = satu permintaan suara");
}

// ---- panjang video: terlalu pendek diperpanjang, terlalu panjang dipangkas
{
  const short = setup();
  short.sp.perChar = 200; // suara sangat cepat → klip pendek
  await short.edu.handle("buat kelas 3 matematika");
  await short.edu.idle();
  const a = short.edu.load().items[0];
  check(a && a.seconds >= 45, `suara pendek tetap ≥ 45 dtk (${a?.seconds})`);
  const long = setup();
  long.sp.perChar = 11;
  await long.edu.handle("buat kelas 6 matematika");
  await long.edu.idle();
  const b = long.edu.load().items[0];
  check(b ? b.seconds <= 135 : /di luar batas|Gagal/.test(long.sent.text.at(-1).text), `suara panjang dipangkas atau ditolak (${b?.seconds ?? "ditolak"})`);
}

// ---- tanpa suara → gagal jelas
{
  const s = setup();
  s.speaker.available = () => false;
  await s.edu.handle("buat");
  await s.edu.idle();
  check(s.edu.load().items.length === 0 && /Suara narasi belum aktif/.test(s.sent.text.at(-1).text), "tanpa Gemini TTS: pesan jelas");
}

// ---- keadaan tersimpan & pembersihan
{
  const s = setup();
  await tick(s.edu);
  const it = s.edu.load().items[0];
  it.status = "uploading";
  fs.writeFileSync(path.join(s.dir, "state.json"), JSON.stringify(s.edu.load()));
  const again = createEdu({ config: s.config, speaker: s.speaker, renderer: s.renderer, youtube: null, now: () => s.clock.t, log: quiet });
  check(again.load().items.length === 1 && again.load().items[0].status === "approved", "dimuat ulang dari berkas; 'uploading' yang terputus jadi 'approved'");
  fs.writeFileSync(path.join(s.dir, "state.json"), "{rusak");
  const bad = createEdu({ config: s.config, speaker: s.speaker, renderer: s.renderer, youtube: null, now: () => s.clock.t, log: quiet });
  check(bad.load().items.length === 0 && fs.readdirSync(s.dir).some((f) => f.startsWith("state.json.rusak")), "state rusak dipindah, mulai baru");

  const c = setup();
  await tick(c.edu);
  const x = c.edu.load().items[0];
  await c.edu.decide(`ok:${x.id}`);
  await c.edu.idle();
  const file = x.file;
  c.clock.t += 20 * 86400_000;
  await c.edu.check();
  await c.edu.idle();
  check(!fs.existsSync(file), "video terjadwal yang lewat 14 hari dihapus dari disk");
  check(/terjadwal/.test(c.edu.describe()), "describe() memuat jumlah terjadwal");
}

// ---- perintah
{
  const s = setup();
  check(/aktif/.test(s.edu.describe()) && /YouTube siap/.test(s.edu.describe()), "describe");
  check(/Antrean kosong/.test(await s.edu.handle("antrean")), "antrean kosong");
  check(/tersambung/.test(await s.edu.handle("youtube")), "/edu youtube");
  s.yt._avail = false;
  check(/belum diatur/.test(await s.edu.handle("youtube")), "/edu youtube tanpa kunci");
  check(/\/edu buat/.test(await s.edu.handle("bantuan")), "bantuan");
  check(/Sebutkan nomornya/.test(await s.edu.handle("setuju")), "setuju tanpa nomor");
}

// ---- deskripsi
{
  const p = buildMathPlan({ gen: "addSmall", grade: 1, seed: 5, practice: 1 });
  const d = buildDescription(p, { chapters: "0:00 Pembukaan\n0:20 Contoh soal\n0:50 Latihan", channelName: "Belajar Bareng" });
  check(/Kelas 1 SD/.test(d) && /0:00 Pembukaan/.test(d) && /suara sintetis/.test(d) && d.length < 2500, "deskripsi lengkap");
}

console.log(fails ? `\n${fails} GAGAL` : "\nSemua tes channel edukasi lolos.");
process.exit(fails ? 1 : 0);
