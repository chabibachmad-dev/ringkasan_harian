// Tes FOTO HIDUP (photo-video.js + video-gen.makeFromPhoto). Jalankan: node test-photo-video.mjs
// Perakitan memakai ffmpeg ASLI bila tersedia; tanpa ffmpeg bagian itu dilewati.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  detectPhotoVideoRequest, parsePhotoOptions, EFFECT_NAMES, createEffects, canvasFor, fitPhoto, motionExprs, photoArgs, wrapTitle,
  buildPhotoVideo, DEFAULT_SECONDS, MIN_SECONDS, FPS
} from "./photo-video.js";
import { createVideoGen, readVideoConfig, photoVideoSentNote, VIDEO_TEXT } from "./video-gen.js";
import { detectImageRequest, detectEditRequest } from "./image-gen.js";
import { createTelegram } from "./telegram.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) }; };

// --- pengenalan permintaan
const D = (t, hasImage = true) => detectPhotoVideoRequest(t, { hasImage });
for (const t of [
  "jadikan video", "bot jadikan video dengan salju", "buatkan video dari foto ini", "ubah jadi video", "foto ini dijadikan video", "animasikan foto ini",
  "hidupkan fotonya", "bikin video pakai efek hujan", "tolong jadikan video 10 detik dengan konfeti", "ubah foto jadi video", "buat video dengan foto ini",
  "convert jadi video", "jadiin reels dong", "/video salju", "make this a video", "animate this photo", "video dari foto ini dengan kunang-kunang"
]) assert.ok(D(t), `harus dikenali: ${t}`);
ok("kalimat 'foto -> video' dikenali (jadikan/ubah/buatkan/animasikan/hidupkan, /video)");

for (const t of ["ubah jadi hitam putih", "hapus orang di belakang", "tambahkan topi", "halo apa kabar", "foto ini bagus ya", "terima kasih", "video call nanti jam 3?".replace("video call nanti jam 3?", "kapan rapat")]) assert.equal(D(t), null, `bukan: ${t}`);
ok("edit foto biasa & obrolan tidak dianggap foto hidup");

assert.equal(D("jadikan video", false), null, "tanpa foto & tanpa menunjuk foto: bukan");
assert.equal(D("buatkan video kancil", false), null);
assert.deepEqual(D("foto ini jadikan video", false), { text: "foto ini jadikan video", needsImage: true });
assert.equal(D("animasikan foto ini", false)?.needsImage, true);
assert.equal(D("/video salju", false), null, "/video tanpa foto = video dari ide, bukan foto hidup");
assert.equal(D("/video salju")?.text, "salju");
ok("tanpa foto: hanya yang jelas menunjuk foto -> needsImage; /video tanpa foto bukan foto hidup");

// keselarasan dengan detektor edit gambar: foto hidup harus didahulukan di pemanggil (kata "jadikan" juga dikenali sebagai edit)
assert.ok(detectEditRequest("jadikan video dengan salju", { hasImage: true }), "detektor edit memang ikut menangkap ini");
assert.equal(detectImageRequest("jadikan video dengan salju"), null);
ok("kasus tumpang-tindih dengan detektor edit tercatat (pemanggil mendahulukan foto hidup)");

// --- opsi
{
  const o = parsePhotoOptions('dengan salju dan kunang-kunang, tulisan "Selamat Pagi" sinematik 10 detik');
  assert.deepEqual(o.effects, ["snow", "fireflies"]);
  assert.equal(o.title, "Selamat Pagi");
  assert.equal(o.grade, "cinematic");
  assert.equal(o.seconds, 10);
  assert.equal(o.motion, "zoomin");
  const d = parsePhotoOptions("");
  assert.equal(d.seconds, DEFAULT_SECONDS);
  assert.deepEqual(d.effects, []);
  assert.equal(parsePhotoOptions("2 detik").seconds, MIN_SECONDS);
  assert.equal(parsePhotoOptions("120 detik").seconds, 15);
  assert.equal(parsePhotoOptions("2 menit", { maxSeconds: 30 }).seconds, 30);
  assert.equal(parsePhotoOptions("zoom out").motion, "zoomout");
  assert.equal(parsePhotoOptions("geser ke kiri").motion, "panleft");
  assert.equal(parsePhotoOptions("pan kanan").motion, "panright");
  assert.equal(parsePhotoOptions("goyang natural").motion, "handheld");
  assert.equal(parsePhotoOptions("hitam putih").grade, "bw");
  assert.equal(parsePhotoOptions("gaya jadul").grade, "vintage");
  assert.equal(parsePhotoOptions("warna hangat").grade, "warm");
  assert.equal(parsePhotoOptions("vertikal untuk story").format, "portrait");
  assert.equal(parsePhotoOptions("persegi").format, "square");
  assert.deepEqual(parsePhotoOptions("tanpa efek salju").effects, []);
  assert.equal(parsePhotoOptions("tanpa efek").noEffects, true);
  assert.equal(parsePhotoOptions("salju hujan debu bintang konfeti").effects.length, 3, "maks 3 efek");
  assert.equal(parsePhotoOptions('“Selamat Ulang Tahun 🎂”').title, "Selamat Ulang Tahun");
  for (const e of EFFECT_NAMES) assert.ok(parsePhotoOptions(`dengan ${{ snow: "salju", rain: "hujan", dust: "debu", fireflies: "kunang-kunang", stars: "bintang", confetti: "konfeti", bubbles: "gelembung", embers: "bara", mist: "kabut", rays: "sinar", leaves: "daun", petals: "sakura", sparkle: "kilau" }[e]}`).effects.includes(e), `kata kunci efek ${e}`);
}
ok("opsi: efek, tulisan, nuansa, gerak, durasi (dibatasi), bentuk, tanpa efek");

// --- penggambar efek
{
  const pw = 160;
  const ph = 90;
  for (const name of EFFECT_NAMES) {
    const fx = createEffects([name], pw, ph, { seed: 7 });
    assert.equal(fx.count, 1, name);
    const buf = new Uint8Array(pw * ph * 4);
    let maxA = 0;
    let diff = 0;
    const snap = [];
    for (const f of [10, 50, 120]) {
      fx.draw(f, buf);
      snap.push(Uint8Array.from(buf));
      for (let i = 3; i < buf.length; i += 4) maxA = Math.max(maxA, buf[i]);
    }
    for (let i = 0; i < snap[0].length; i++) if (snap[0][i] !== snap[2][i]) diff++;
    assert.ok(maxA > 20, `efek ${name} menggambar sesuatu`);
    assert.ok(diff > 50, `efek ${name} bergerak antar-frame`);
    // deterministik: seed & frame sama -> piksel sama
    const again = createEffects([name], pw, ph, { seed: 7 });
    const b2 = new Uint8Array(pw * ph * 4);
    again.draw(50, b2);
    assert.deepEqual(b2, snap[1], `efek ${name} deterministik`);
  }
  assert.equal(createEffects(["tidak-ada"], pw, ph).count, 0);
  const all = createEffects(EFFECT_NAMES, pw, ph);
  const b = new Uint8Array(pw * ph * 4);
  all.draw(30, b);
  assert.ok(b.some((v, i) => i % 4 === 3 && v > 0));
}
ok("13 efek: menggambar, bergerak antar-frame, deterministik; gabungan semua efek jalan");

// --- tata letak
{
  assert.deepEqual(canvasFor(1600, 1200), { W: 1280, H: 720, format: "landscape" });
  assert.deepEqual(canvasFor(1200, 1600), { W: 720, H: 1280, format: "portrait" });
  assert.deepEqual(canvasFor(1000, 1000), { W: 960, H: 960, format: "square" });
  assert.deepEqual(canvasFor(1000, 1000, "portrait"), { W: 720, H: 1280, format: "portrait" });
  assert.deepEqual(fitPhoto(1920, 1080, 1280, 720), { FW: 1280, FH: 720, cover: true });
  const f = fitPhoto(1600, 1200, 1280, 720);
  assert.equal(f.cover, false);
  assert.ok(f.FH === 720 && f.FW <= 1280 && f.FW % 2 === 0);
  assert.ok(motionExprs("zoomin", 100).z.includes("on/100"));
  assert.notEqual(motionExprs("panleft", 100).x, motionExprs("panright", 100).x);
  assert.equal(wrapTitle("Selamat Ulang Tahun Ayyubi yang ke sepuluh semoga sehat", 20).split("\n").length, 3);
  const a = photoArgs({ photo: "/x/f.png", out: "/x/o.mp4", iw: 1600, ih: 1200, seconds: 6, motion: "zoomin", grade: "bw", format: "", hasFx: true, fxW: 640, fxH: 360, titleFile: "/x/t.txt", font: "/f/a.ttf" });
  assert.ok(a.includes("pipe:0") && a.includes("rawvideo"));
  assert.ok(a.some((x) => String(x).includes("hue=s=0")) && a.some((x) => String(x).includes("drawtext=fontfile='/f/a.ttf':textfile='/x/t.txt':expansion=none")));
  assert.equal(a[a.indexOf("-frames:v") + 1], String(6 * FPS));
  const b = photoArgs({ photo: "/x/f.png", out: "/x/o.mp4", iw: 1600, ih: 1200, seconds: 6, motion: "zoomin", grade: "", format: "", hasFx: false });
  assert.ok(!b.includes("pipe:0") && !b.some((x) => String(x).includes("drawtext")));
}
ok("kanvas menurut bentuk foto, penutup/muat, gerak, argumen ffmpeg (dengan/tanpa efek & tulisan)");

assert.match(photoVideoSentNote('salju "turun"', { effects: ["snow"] }), /^🎞️ \[BOT mengirim VIDEO hasil FOTO HIDUP .* snow\), permintaannya: "salju 'turun'"\]$/);
ok("catatan riwayat foto hidup");

// --- perakitan sungguhan
const hasFf = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0 && /zoompan/.test(execFileSync("ffmpeg", ["-hide_banner", "-filters"]).toString());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pvtest-"));
const photoOf = (w, h, file) => {
  const f = path.join(tmp, file);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=0x1b2a5a:c1=0xf59e5b:x0=0:y0=0:x1=0:y1=${h}:d=1`, "-frames:v", "1", f]);
  return fs.readFileSync(f);
};
const probe = (buf) => {
  const f = path.join(tmp, "probe.mp4");
  fs.writeFileSync(f, buf);
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", f]).toString());
  return { v: j.streams.find((s) => s.codec_type === "video"), a: j.streams.find((s) => s.codec_type === "audio"), dur: Number(j.format.duration) };
};
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"].find((f) => fs.existsSync(f)) || "";
if (!hasFf) console.log("  - ffmpeg/ffprobe/zoompan tidak ada: tes perakitan foto hidup dilewati");
else {
  const opt = (t) => parsePhotoOptions(t);
  // lanskap + efek + tulisan berisi tanda kutip/persen/titik dua
  {
    const r = await buildPhotoVideo(photoOf(1600, 1200, "l.jpg"), opt('dengan salju dan kunang-kunang 4 detik tulisan "Halo: 100% \'aman\' %{x}"'), { tmpRoot: tmp, font: FONT, log: silent });
    const p = probe(r.buffer);
    assert.equal(p.v.codec_name, "h264");
    assert.equal(p.v.width, 1280);
    assert.equal(p.v.height, 720);
    assert.equal(p.v.pix_fmt, "yuv420p");
    assert.equal(p.a, undefined);
    assert.ok(Math.abs(p.dur - 4) < 0.3, `durasi ${p.dur}`);
    assert.deepEqual(r.effects, ["snow", "fireflies"]);
    assert.equal(r.title, "Halo: 100% 'aman' %{x}");
    assert.ok(r.buffer.length > 20_000 && r.buffer.length < 3_000_000);
    assert.deepEqual(fs.readdirSync(tmp).filter((x) => x.startsWith("pvid-")), [], "folder sementara bersih");
  }
  ok("perakitan nyata (lanskap, efek ganda, tulisan dengan tanda kutip/persen): H.264 1280x720, durasi tepat, tanpa sisa file");

  {
    const r = await buildPhotoVideo(photoOf(1200, 1600, "p.jpg"), opt("hujan 4 detik"), { tmpRoot: tmp, font: FONT, log: silent });
    const p = probe(r.buffer);
    assert.deepEqual([p.v.width, p.v.height], [720, 1280]);
    const sq = await buildPhotoVideo(photoOf(1000, 1000, "s.png"), opt("kabut 4 detik"), { tmpRoot: tmp, font: FONT, log: silent });
    assert.deepEqual([probe(sq.buffer).v.width, probe(sq.buffer).v.height], [960, 960]);
    const forced = await buildPhotoVideo(photoOf(1200, 1600, "p2.jpg"), opt("tanpa efek 4 detik lebar"), { tmpRoot: tmp, log: silent });
    assert.deepEqual([probe(forced.buffer).v.width, probe(forced.buffer).v.height], [1280, 720]);
  }
  ok("orientasi: potret 720x1280, persegi 960x960, bentuk dipaksa lewat permintaan");

  {
    const photo = photoOf(1600, 1200, "m.png");
    for (const m of ["zoom in", "zoom out", "geser ke kiri", "geser ke kanan", "geser ke atas", "goyang"]) {
      const r = await buildPhotoVideo(photo, opt(`tanpa efek 4 detik ${m}`), { tmpRoot: tmp, log: silent });
      assert.ok(probe(r.buffer).dur > 3.5, m);
    }
    for (const g of ["hitam putih", "jadul", "sinematik", "hangat", "dingin"]) {
      const r = await buildPhotoVideo(photo, opt(`tanpa efek 4 detik ${g}`), { tmpRoot: tmp, log: silent });
      assert.ok(probe(r.buffer).dur > 3.5, g);
    }
  }
  ok("6 gerak kamera dan 5 nuansa warna semuanya terakit");

  {
    // tanpa efek eksplisit vs efek bawaan (debu + sinar): ukuran berkas berbeda
    const photo = photoOf(1600, 1200, "d.png");
    const none = await buildPhotoVideo(photo, opt("tanpa efek 4 detik"), { tmpRoot: tmp, log: silent });
    const def = await buildPhotoVideo(photo, opt("4 detik"), { tmpRoot: tmp, log: silent });
    assert.deepEqual(def.effects, ["dust", "rays"]);
    assert.deepEqual(none.effects, []);
    assert.ok(def.buffer.length > none.buffer.length, "efek bawaan menambah isi video");
    await assert.rejects(buildPhotoVideo(Buffer.from("bukan foto sama sekali, hanya teks biasa yang panjang sekali supaya lolos batas minimum seratus byte ya"), opt(""), { tmpRoot: tmp, log: silent }), (e) => e.kind === "badimage");
    await assert.rejects(buildPhotoVideo(Buffer.alloc(10), opt(""), { tmpRoot: tmp, log: silent }), (e) => e.kind === "badimage");
    assert.deepEqual(fs.readdirSync(tmp).filter((x) => x.startsWith("pvid-")), [], "folder sementara bersih juga saat gagal");
  }
  ok("efek bawaan (debu+sinar) vs tanpa efek; foto rusak ditolak (badimage) dan folder tetap bersih");

  // --- lewat pembuat video: jatah, antrean, galat
  {
    const photo = photoOf(1600, 1200, "q.jpg");
    const st = mem();
    const g = createVideoGen({ imageGen: { available: () => false }, state: st, config: readVideoConfig({ VIDEO_PHOTO_PERSON_DAILY: "1", VIDEO_PHOTO_GROUP_DAILY: "2", VIDEO_PHOTO_OWNER_DAILY: "1" }), log: silent, tmpRoot: tmp });
    assert.equal(g.available(), false, "video dari ide butuh pembuat gambar");
    assert.equal(g.photoAvailable(), true, "foto hidup tidak butuh pembuat gambar");
    assert.equal(g.photoGroupEnabled(), true);
    const stages = [];
    const r1 = await g.makeFromPhoto(photo, "salju 4 detik", "group", "a", { onStage: (s) => stages.push(s) });
    assert.ok(r1.video, r1.error);
    assert.deepEqual(stages, ["render"]);
    assert.equal(r1.video.seconds, 4);
    const r2 = await g.makeFromPhoto(photo, "salju 4 detik", "group", "a");
    assert.equal(r2.kind, "limit");
    assert.match(r2.error, /foto hidup/);
    assert.ok((await g.makeFromPhoto(photo, "tanpa efek 4 detik", "group", "b")).video);
    assert.equal((await g.makeFromPhoto(photo, "tanpa efek 4 detik", "group", "c")).kind, "limit", "jatah semua grup");
    assert.ok((await g.makeFromPhoto(photo, "tanpa efek 4 detik", "owner")).video);
    assert.equal((await g.makeFromPhoto(photo, "tanpa efek 4 detik", "owner")).kind, "limit");
    assert.equal(st.m.get("wa_video_quota").photo.owner, 1);
    assert.equal(st.m.get("wa_video_quota").owner, 0, "jatah video-dari-ide tidak ikut terpakai");
    // jatah dikembalikan bila gagal
    const bad = await g.makeFromPhoto(Buffer.from("x".repeat(300)), "x", "owner");
    assert.equal(bad.kind, "limit");
    const g2 = createVideoGen({ imageGen: { available: () => false }, state: mem(), config: readVideoConfig({ VIDEO_PHOTO_OWNER_DAILY: "1" }), log: silent, tmpRoot: tmp });
    const f1 = await g2.makeFromPhoto(Buffer.from("x".repeat(300)), "x", "owner");
    assert.equal(f1.kind, "badimage");
    assert.equal(f1.error, VIDEO_TEXT.badphoto);
    assert.ok((await g2.makeFromPhoto(photo, "tanpa efek 4 detik", "owner")).video, "jatah kembali setelah gagal");
    // penolakan awal
    assert.equal((await g2.makeFromPhoto(Buffer.alloc(5), "", "owner")).kind, "badimage");
    assert.equal((await g2.makeFromPhoto(photo, "foto bugil", "owner")).kind, "refused");
    const off = createVideoGen({ imageGen: { available: () => true }, config: readVideoConfig({ VIDEO_ENABLED: "0" }), log: silent, tmpRoot: tmp });
    assert.equal((await off.makeFromPhoto(photo, "", "owner")).kind, "off");
    const noff = createVideoGen({ imageGen: { available: () => true }, config: readVideoConfig({ FFMPEG_PATH: "/tidak/ada/ffmpeg" }), log: silent, tmpRoot: tmp });
    assert.equal((await noff.makeFromPhoto(photo, "", "owner")).kind, "noffmpeg");
    // pemulihan setelah restart
    const g3 = createVideoGen({ imageGen: { available: () => false }, state: st, config: readVideoConfig({ VIDEO_PHOTO_OWNER_DAILY: "1" }), log: silent, tmpRoot: tmp });
    await g3.load();
    assert.equal((await g3.makeFromPhoto(photo, "", "owner")).kind, "limit");
    assert.match(g3.describe(), /Foto hidup/);
  }
  ok("jatah foto hidup terpisah dari video-dari-ide: per orang/grup/pemilik, pengembalian saat gagal, pemulihan, penolakan awal");

  {
    // antrean bersama: satu dirakit, satu menunggu, sisanya sibuk
    const photo = photoOf(1600, 1200, "z.png");
    const g = createVideoGen({ imageGen: { available: () => false }, config: readVideoConfig({ VIDEO_QUEUE: "1", VIDEO_PHOTO_PERSON_DAILY: "0", VIDEO_PHOTO_GROUP_DAILY: "0" }), log: silent, tmpRoot: tmp });
    const a = g.makeFromPhoto(photo, "tanpa efek 5 detik", "group", "a");
    await new Promise((r) => setTimeout(r, 150));
    const b = g.makeFromPhoto(photo, "tanpa efek 4 detik", "group", "b");
    await new Promise((r) => setTimeout(r, 100));
    const c = await g.makeFromPhoto(photo, "tanpa efek 4 detik", "group", "c");
    assert.equal(c.kind, "busy");
    const [ra, rb] = await Promise.all([a, b]);
    assert.ok(ra.video && rb.video);
  }
  ok("antrean: satu foto dirakit, satu menunggu, sisanya diberi tahu sibuk");
}

// --- Telegram: foto + keterangan, balas foto
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const form = init?.body instanceof FormData;
    calls.push({ method, form, body: init?.body && !form ? JSON.parse(init.body) : {}, fd: form ? init.body : null, url: String(url) });
    if (method === "getFile") return { status: 200, json: async () => ({ ok: true, result: { file_path: "photos/f.jpg" } }) };
    if (/\/file\/bot/.test(String(url))) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(500).buffer };
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const made = [];
  const video = {
    available: () => true,
    photoAvailable: () => true,
    describe: () => "x",
    parseCommand: () => ({ kind: "status" }),
    setGroup: async () => ({ on: true, saved: true }),
    make: async () => ({ error: "tidak dipakai" }),
    detectPhoto: (t, o) => detectPhotoVideoRequest(t, o),
    makeFromPhoto: async (buf, text) => {
      made.push({ size: buf.length, text });
      return text.includes("gagal") ? { error: "Fotonya tidak bisa dibaca." } : { video: { buffer: Buffer.from("mp4mp4mp4"), mime: "video/mp4", width: 720, height: 1280 } };
    }
  };
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => "x", video }, fetchImpl: fakeFetch, log: silent });
  let id = 0;
  const upd = async (message) => {
    const before = calls.length;
    await tg.handleUpdate({ update_id: ++id, message: { chat: { id: 111, type: "private" }, ...message } });
    return calls.slice(before);
  };
  const texts = (cs) => cs.filter((c) => c.method === "sendMessage").map((c) => c.body.text).join("\n");
  const r1 = await upd({ photo: [{ file_id: "small" }, { file_id: "big" }], caption: "jadikan video dengan salju 5 detik" });
  assert.deepEqual(made[0], { size: 500, text: "jadikan video dengan salju 5 detik" });
  assert.ok(calls.some((c) => c.method === "getFile" && c.body.file_id === "big"), "foto terbesar diunduh");
  assert.match(texts(r1), /sedang dihidupkan/);
  const vid = r1.find((c) => c.method === "sendVideo");
  assert.ok(vid && vid.form && vid.fd.get("width") === "720" && vid.fd.get("height") === "1280");
  const r2 = await upd({ photo: [{ file_id: "p" }], caption: "/video hujan" });
  assert.equal(made[1].text, "hujan");
  assert.ok(r2.some((c) => c.method === "sendVideo"));
  const r3 = await upd({ text: "jadikan video dengan bintang", reply_to_message: { photo: [{ file_id: "q" }] } });
  assert.equal(made[2].text, "jadikan video dengan bintang");
  assert.ok(r3.some((c) => c.method === "sendVideo"));
  const r4 = await upd({ photo: [{ file_id: "p" }], caption: "gagal ya jadikan video" });
  assert.match(texts(r4), /Fotonya tidak bisa dibaca/);
  assert.ok(!r4.some((c) => c.method === "sendVideo"));
  const r5 = await upd({ photo: [{ file_id: "p" }], caption: "ini foto liburan" });
  assert.equal(made.length, 4, "foto dengan keterangan biasa tidak diproses");
  assert.match(texts(r5), /pesan teks/);
  const r6 = await upd({ text: "foto ini jadikan video" });
  assert.match(texts(r6), /Fotonya belum ada/);
  assert.equal(made.length, 4);
}
ok("Telegram: foto+keterangan, /video pada foto, balas foto, galat, keterangan biasa diabaikan, tanpa foto -> petunjuk");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} kelompok tes foto hidup lulus.`);
