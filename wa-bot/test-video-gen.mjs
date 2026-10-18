// Tes pembuat video gratis (video-gen.js). Jalankan: node test-video-gen.mjs
// Perakitan memakai ffmpeg ASLI bila tersedia (gambar & suara palsu dibuat oleh ffmpeg sendiri); tanpa ffmpeg bagian itu dilewati.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  detectVideoRequest, sceneCount, buildScriptPrompt, parseScript, fallbackScript, wrapSubtitle, sceneDurations, motionExpr, clipArgs,
  readVideoConfig, createVideoGen, videoSentNote, VIDEO_TEXT, LEAD_SEC, TAIL_SEC, MIN_SCENE_SEC
} from "./video-gen.js";
import { createTelegram } from "./telegram.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
// Perakitan video sungguhan itu lambat (laptop kantor: menit). Tes otomatis (/tes, /ya) hanya menjalankan yang inti;
// jalankan VIDEO_TEST_FULL=1 node <berkas tes> untuk semua kasus render.
const FULL = process.env.VIDEO_TEST_FULL === "1";
const okHeavy = (name) => (FULL ? ok(name) : console.log(`  - (dilewati; VIDEO_TEST_FULL=1 untuk menjalankan) ${name}`));
const silent = { log() {}, warn() {}, error() {} };
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) }; };

// --- pengenalan permintaan
const P = (t) => detectVideoRequest(t)?.prompt;
assert.equal(P("buatkan video kancil dan buaya"), "kancil dan buaya");
assert.equal(P("Tolong buatin video tentang siklus air"), "siklus air");
assert.equal(P("bikin vidio tentang kemerdekaan"), "kemerdekaan");
assert.equal(P("buatkan bideo kucing lucu"), "kucing lucu");
assert.equal(P("buat sebuah video pendek pembuka acara"), "pendek pembuka acara");
assert.equal(P("/video robot belajar menari"), "robot belajar menari");
assert.equal(P("/video@AyyubiBot robot belajar menari"), "robot belajar menari");
assert.equal(P("bisa buatkan klip video promosi kopi?"), "promosi kopi?");
assert.equal(P("create video about volcano"), "volcano"); // "about" dibuang cleanPrompt
ok("penguraian permintaan video (Indonesia, ejaan lain, /video)");

assert.deepEqual(detectVideoRequest("buatkan video 30 detik tentang siklus air"), { prompt: "siklus air", seconds: 30 });
assert.deepEqual(detectVideoRequest("/video siklus air durasi 1 menit"), { prompt: "siklus air", seconds: 60 });
assert.deepEqual(detectVideoRequest("buatkan video"), { prompt: "", seconds: 0 });
assert.deepEqual(detectVideoRequest("/video"), { prompt: "", seconds: 0 });
assert.deepEqual(detectVideoRequest("buatkan videonya"), { prompt: "", seconds: 0 });
assert.deepEqual(detectVideoRequest("buatkan video ini"), { prompt: "", seconds: 0 });
ok("durasi diminta dibaca; tanpa deskripsi -> prompt kosong");

for (const t of [
  "video ini lucu banget", "kirim videonya dong", "tonton video tadi", "aku suka nonton video", "buatkan laporan kas", "bikin kopi", "halo apa kabar", "",
  "buatkan gambar kucing", "video apa itu?", "jelaskan cara membuat video di HP"
]) assert.equal(detectVideoRequest(t), null, `bukan permintaan: ${t}`);
ok("kalimat biasa / permintaan gambar tidak dianggap permintaan video");

// --- jumlah adegan
{
  const cfg = readVideoConfig({});
  assert.equal(cfg.scenes, 5);
  assert.equal(cfg.maxScenes, 6);
  assert.equal(sceneCount(0, cfg), 5);
  assert.equal(sceneCount(10, cfg), 3);
  assert.equal(sceneCount(30, cfg), 5);
  assert.equal(sceneCount(600, cfg), 6);
  assert.equal(sceneCount(0, readVideoConfig({ VIDEO_SCENES: "4" })), 4);
  assert.equal(readVideoConfig({ VIDEO_ENABLED: "0" }).enabled, false);
  assert.equal(readVideoConfig({ VIDEO_MAX_SCENES: "8" }).maxScenes, 8);
}
ok("jumlah adegan dari durasi/bawaan, dibatasi 3..maks; VIDEO_ENABLED=0");

// --- naskah
{
  const p = buildScriptPrompt("kancil", 5, 620);
  assert.match(p.system, /Exactly 5 scenes/);
  assert.match(p.system, /NO text/);
  const raw = 'Berikut naskahnya:\n```json\n' + JSON.stringify({ title: "Kancil 🐭 Cerdik", style: "watercolor", scenes: [
    { visual: "a small mouse deer by a river", narration: "Suatu hari 😀 si Kancil ingin menyeberang." },
    { visual: "crocodiles waiting in water", narration: "Buaya menunggu." },
    { visual: "x", narration: "terlalu pendek visualnya" },
    { visual: "mouse deer crossing on backs", narration: "Kancil selamat sampai seberang." }
  ] }) + "\n```";
  const s = parseScript(raw, 5);
  assert.equal(s.scenes.length, 3, "adegan dengan visual terlalu pendek dibuang");
  assert.equal(s.title, "Kancil Cerdik");
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(JSON.stringify(s)), "emoji dibuang");
  assert.equal(parseScript("bukan json", 5), null);
  assert.equal(parseScript('{"scenes":[{"visual":"hanya satu adegan"}]}', 5), null);
  assert.equal(parseScript('{"scenes":"salah"}', 5), null);
  // narasi terlalu panjang dipotong merata di batas kata
  const long = parseScript(JSON.stringify({ scenes: [1, 2, 3, 4].map((i) => ({ visual: `scene number ${i} description`, narration: "kata ".repeat(100).trim() })) }), 4, 400);
  assert.ok(long.scenes.reduce((a, x) => a + x.narration.length, 0) <= 420);
  const fb = fallbackScript("naga terbang", 4);
  assert.equal(fb.scenes.length, 4);
  assert.equal(fb.scenes[0].narration, "naga terbang");
  assert.equal(fb.scenes[1].narration, "");
  assert.ok(fb.scenes.every((x) => x.visual.includes("naga terbang")));
  assert.equal(fb.fallback, true);
}
ok("naskah: JSON dari balasan AI dibaca, emoji/visual buruk dibuang, narasi dibatasi, cadangan tersedia");

// --- subtitle & durasi & gerak
{
  const w = wrapSubtitle("Suatu hari, si Kancil yang cerdik ingin menyeberangi sungai yang lebar dan penuh buaya lapar.", 30, 3);
  assert.ok(w.split("\n").every((l) => l.length <= 31));
  assert.equal(wrapSubtitle("kata ".repeat(80), 30, 2).split("\n").length, 2);
  assert.ok(wrapSubtitle("kata ".repeat(80), 30, 2).endsWith("…"));
  assert.equal(wrapSubtitle("", 30, 2), "");
  const sc = [{ narration: "a".repeat(100) }, { narration: "b".repeat(50) }, { narration: "" }];
  const d = sceneDurations(sc, 20);
  assert.ok(d[0] > d[1] && d[1] >= MIN_SCENE_SEC);
  assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - (20 + LEAD_SEC + TAIL_SEC)) < 6, "total mendekati panjang suara (+ batas minimum)");
  const nosound = sceneDurations([{ narration: "pendek" }, { narration: "x".repeat(300) }], 0);
  assert.equal(nosound[0], 4);
  assert.equal(nosound[1], 9);
  assert.notEqual(motionExpr(0, 100).z, motionExpr(1, 100).z);
  assert.equal(motionExpr(3, 100).z, motionExpr(0, 100).z);
  const a = clipArgs({ image: "/x/i.png", out: "/x/o.mp4", dur: 4, index: 0, textFile: "/x/s.txt", font: "/f/font.ttf" });
  assert.ok(a.some((x) => String(x).includes("drawtext=fontfile='/f/font.ttf':textfile='/x/s.txt':expansion=none")));
  assert.ok(!clipArgs({ image: "/x/i.png", out: "/x/o.mp4", dur: 4, index: 1 }).some((x) => String(x).includes("drawtext")));
  assert.equal(a[a.indexOf("-frames:v") + 1], "100");
}
ok("subtitle dibungkus, durasi adegan proporsional, gerak bergantian, argumen ffmpeg");

// --- catatan riwayat
assert.match(videoSentNote('kancil "cerdik"'), /^🎬 \[BOT mengirim VIDEO buatan AI sesuai permintaan: "kancil 'cerdik'"\]$/);
ok("catatan riwayat video");

// --- jatah
{
  const st = mem();
  const imageGen = { available: () => true, problem: () => null, generate: async () => { throw Object.assign(new Error("habis"), { kind: "quota" }); } };
  const g = createVideoGen({ imageGen, state: st, config: readVideoConfig({ VIDEO_PERSON_DAILY: "1", VIDEO_GROUP_DAILY: "2", VIDEO_OWNER_DAILY: "1" }), log: silent });
  const r1 = await g.reserve("group", "a");
  assert.ok(r1.ok);
  assert.equal((await g.reserve("group", "a")).ok, false, "satu orang satu video");
  assert.ok((await g.reserve("group", "b")).ok);
  const r3 = await g.reserve("group", "c");
  assert.equal(r3.ok, false);
  assert.match(r3.reason, /semua grup/);
  await r1.release();
  assert.ok((await g.reserve("group", "a")).ok, "jatah dikembalikan");
  assert.ok((await g.reserve("owner")).ok);
  assert.equal((await g.reserve("owner")).ok, false);
  assert.equal(st.m.get("wa_video_quota").owner, 1);
  // pulih setelah restart (hari sama)
  const g2 = createVideoGen({ imageGen, state: st, config: readVideoConfig({ VIDEO_OWNER_DAILY: "1" }), log: silent });
  await g2.load();
  assert.equal((await g2.reserve("owner")).ok, false);
  // saklar grup
  assert.equal(g2.groupEnabled(), true);
  await g2.setGroup(false);
  assert.equal(g2.groupEnabled(), false);
  const g3 = createVideoGen({ imageGen, state: st, config: readVideoConfig({}), log: silent });
  await g3.load();
  assert.equal(g3.groupEnabled(), false, "saklar grup tersimpan");
  assert.deepEqual(g3.parseCommand("grup on"), { kind: "group", value: true });
  assert.deepEqual(g3.parseCommand(""), { kind: "status" });
  assert.deepEqual(g3.parseCommand("40 detik tentang planet"), { kind: "prompt", prompt: "planet", seconds: 40 });
}
ok("jatah harian per orang/grup/pemilik, pengembalian, penyimpanan, saklar grup, parseCommand");

// --- penolakan awal
{
  const base = { available: () => true, problem: () => null, generate: async () => ({ buffer: Buffer.alloc(10), mime: "image/png" }) };
  const g = createVideoGen({ imageGen: base, config: readVideoConfig({}), log: silent });
  assert.equal((await g.make("", "owner")).kind, "empty");
  assert.equal((await g.make("video ktp palsu", "owner")).kind, "refused");
  const off = createVideoGen({ imageGen: base, config: readVideoConfig({ VIDEO_ENABLED: "0" }), log: silent });
  assert.equal(off.available(), false);
  assert.equal((await off.make("kucing", "owner")).kind, "off");
  const noimg = createVideoGen({ imageGen: { ...base, available: () => false }, config: readVideoConfig({}), log: silent });
  assert.equal((await noimg.make("kucing", "owner")).kind, "nokey");
  const noff = createVideoGen({ imageGen: base, config: readVideoConfig({ FFMPEG_PATH: "/tidak/ada/ffmpeg" }), log: silent });
  const r = await noff.make("kucing", "owner");
  assert.equal(r.kind, "noffmpeg");
  assert.equal(r.error, VIDEO_TEXT.noffmpeg);
  assert.equal((await noff.make("kucing", "owner")).kind, "noffmpeg", "jatah tidak terpakai bila ffmpeg tak ada");
}
ok("penolakan: kosong, konten terlarang, mati, tanpa pembuat gambar, tanpa ffmpeg");

// --- perakitan sungguhan dengan ffmpeg
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const hasZoompan = hasFfmpeg && /zoompan/.test(execFileSync("ffmpeg", ["-hide_banner", "-filters"]).toString());
if (!hasFfmpeg || !hasZoompan) {
  console.log("  - ffmpeg/ffprobe/zoompan tidak ada: tes perakitan dilewati");
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vtest-"));
  const ff = (...args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  const png = path.join(tmp, "src.png");
  ff("-f", "lavfi", "-i", "testsrc2=s=1024x1024:d=1", "-frames:v", "1", png);
  const png2 = path.join(tmp, "wide.png"); // bukan persegi: tetap harus bisa
  ff("-f", "lavfi", "-i", "testsrc2=s=1344x768:d=1", "-frames:v", "1", png2);
  const ogg = path.join(tmp, "s.ogg");
  ff("-f", "lavfi", "-i", "sine=frequency=300:duration=14", "-c:a", "libopus", ogg);
  const probe = (f) => {
    const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", f]).toString());
    return { v: j.streams.find((s) => s.codec_type === "video"), a: j.streams.find((s) => s.codec_type === "audio"), dur: Number(j.format.duration) };
  };
  const script = JSON.stringify({ title: "Uji", style: "flat", scenes: [
    { visual: "scene one description here", narration: "Ini adegan pertama, dengan teks subtitle yang cukup panjang supaya terbungkus ke dua baris." },
    { visual: "scene two description here", narration: "Adegan kedua. 100% aman: 'tanda kutip' dan %{expand} tidak boleh merusak." },
    { visual: "scene three description here", narration: "Adegan ketiga sebagai penutup." }
  ] });
  const mkImage = (fail = []) => {
    let i = 0;
    const calls = [];
    return { calls, available: () => true, problem: () => null, generate: async (prompt) => {
      const k = i++;
      calls.push(prompt);
      if (fail.includes(k)) throw Object.assign(new Error("gambar gagal"), { kind: "unavailable" });
      return { buffer: fs.readFileSync(k % 2 ? png2 : png), mime: "image/png" };
    } };
  };
  const speaker = { available: () => true, speak: async (t) => ({ ogg: fs.readFileSync(ogg), text: t }) };
  const stages = [];

  {
    const gen = mkImage();
    const g = createVideoGen({ imageGen: gen, speaker, writeScript: async () => script, config: readVideoConfig({}), log: silent, tmpRoot: tmp });
    const r = await g.make("kancil dan buaya", "group", "orang1", { onStage: (s) => stages.push(s) });
    assert.ok(r.video, r.error);
    assert.deepEqual(stages, ["script", "images", "voice", "render"]);
    assert.equal(r.video.scenes, 3);
    assert.equal(r.video.silent, false);
    assert.equal(r.video.title, "Uji");
    assert.ok(gen.calls.every((c) => /^flat\. scene/.test(c) && /No text/.test(c)), "gaya bersama ikut di setiap prompt gambar");
    const f = path.join(tmp, "out.mp4");
    fs.writeFileSync(f, r.video.buffer);
    const pr = probe(f);
    assert.equal(pr.v.codec_name, "h264");
    assert.equal(pr.v.width, 1280);
    assert.equal(pr.v.height, 720);
    assert.equal(pr.v.pix_fmt, "yuv420p");
    assert.equal(pr.a.codec_name, "aac");
    assert.ok(pr.dur > 14 && pr.dur < 20, `durasi ${pr.dur}`);
    assert.ok(Math.abs(pr.dur - r.video.seconds) <= 1.5);
    assert.ok(r.video.buffer.length < 3_000_000);
    assert.deepEqual(fs.readdirSync(tmp).filter((x) => x.startsWith("vid-")), [], "folder sementara dibersihkan");
  }
  ok("perakitan nyata: H.264 1280x720 + AAC, durasi mengikuti suara, subtitle aman (kutip/persen), folder sementara bersih");

  if (FULL) {
    const g = createVideoGen({ imageGen: mkImage(), speaker: null, writeScript: async () => script, config: readVideoConfig({}), log: silent, tmpRoot: tmp });
    const r = await g.make("tanpa suara", "owner");
    assert.ok(r.video, r.error);
    assert.equal(r.video.silent, true);
    const f = path.join(tmp, "silent.mp4");
    fs.writeFileSync(f, r.video.buffer);
    const pr = probe(f);
    assert.equal(pr.a, undefined);
    assert.ok(pr.dur >= 11, `durasi ${pr.dur}`);
  }
  okHeavy("tanpa suara (TTS tidak ada): video tetap jadi, dengan subtitle");

  if (FULL) {
    const badSpeaker = { available: () => true, speak: async () => { throw new Error("kuota suara habis"); } };
    const g = createVideoGen({ imageGen: mkImage(), speaker: badSpeaker, writeScript: async () => script, config: readVideoConfig({}), log: silent, tmpRoot: tmp });
    const r = await g.make("suara gagal", "owner");
    assert.ok(r.video && r.video.silent, "TTS gagal -> tetap video tanpa suara");
  }
  okHeavy("TTS gagal tidak menggagalkan video");

  if (FULL) {
    const g = createVideoGen({ imageGen: mkImage(), speaker, writeScript: async () => { throw new Error("AI mati"); }, config: readVideoConfig({}), log: silent, tmpRoot: tmp });
    const r = await g.make("naga terbang", "owner");
    assert.ok(r.video, r.error);
    assert.equal(r.video.fallback, true);
    assert.equal(r.video.scenes, 5);
  }
  if (FULL) {
    const g = createVideoGen({ imageGen: mkImage(), speaker, writeScript: async () => "bukan json sama sekali", config: readVideoConfig({}), log: silent, tmpRoot: tmp });
    const r = await g.make("naga terbang", "owner");
    assert.equal(r.video?.fallback, true);
  }
  okHeavy("AI naskah mati / balasan rusak -> naskah cadangan, video tetap jadi");

  if (FULL) {
    // adegan ke-2 gagal dua kali -> memakai gambar sebelumnya; video tetap jadi
    const g = createVideoGen({ imageGen: mkImage([1, 2]), speaker, writeScript: async () => script, config: readVideoConfig({}), log: silent, tmpRoot: tmp });
    const r = await g.make("gambar tengah gagal", "owner");
    assert.ok(r.video, r.error);
    // adegan pertama gagal total -> galat + jatah dikembalikan
    const st = mem();
    const g2 = createVideoGen({ imageGen: mkImage([0, 1]), speaker, writeScript: async () => script, state: st, config: readVideoConfig({ VIDEO_OWNER_DAILY: "1" }), log: silent, tmpRoot: tmp });
    const r2 = await g2.make("gambar pertama gagal", "owner");
    assert.ok(r2.error);
    assert.equal(r2.kind, "unavailable");
    assert.equal(st.m.get("wa_video_quota").owner, 0, "jatah dikembalikan");
    assert.equal(g2.stats().fail, 1);
    // galat kuota gambar diteruskan apa adanya (untuk pemberitahuan pemilik)
    const quotaImg = { available: () => true, problem: () => null, generate: async () => { throw Object.assign(new Error("Kuota pembuat gambar sedang habis."), { kind: "quota", detail: "x" }); } };
    const g3 = createVideoGen({ imageGen: quotaImg, speaker, writeScript: async () => script, config: readVideoConfig({}), log: silent, tmpRoot: tmp });
    const r3 = await g3.make("kuota", "owner");
    assert.equal(r3.kind, "quota");
    assert.match(r3.error, /Kuota pembuat gambar/);
  }
  okHeavy("gambar tengah gagal -> pakai gambar sebelumnya; adegan pertama gagal -> galat + jatah kembali; kuota gambar diteruskan");

  if (FULL) {
    // antrean: satu dirakit, satu menunggu, sisanya "sibuk"
    let release;
    const gate = new Promise((r) => (release = r));
    let started = 0;
    const slow = { available: () => true, problem: () => null, generate: async () => { started++; await gate; return { buffer: fs.readFileSync(png), mime: "image/png" }; } };
    const g = createVideoGen({ imageGen: slow, speaker: null, writeScript: async () => script, config: readVideoConfig({ VIDEO_QUEUE: "1", VIDEO_PERSON_DAILY: "0", VIDEO_GROUP_DAILY: "0" }), log: silent, tmpRoot: tmp });
    const a = g.make("pertama", "group", "a");
    await new Promise((r) => setTimeout(r, 400));
    const b = g.make("kedua", "group", "b");
    await new Promise((r) => setTimeout(r, 100));
    const c = await g.make("ketiga", "group", "c");
    assert.equal(c.kind, "busy");
    assert.equal(c.error, VIDEO_TEXT.busy);
    assert.equal(started, 1, "hanya satu video diproses");
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.ok(ra.video && rb.video);
  }
  okHeavy("antrean: satu video dirakit, satu menunggu, sisanya diberi tahu sibuk");

  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- Telegram /video
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const form = init?.body instanceof FormData;
    calls.push({ method, form, body: init?.body && !form ? JSON.parse(init.body) : {}, fd: form ? init.body : null });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const video = {
    available: () => true,
    describe: () => "Status: aktif",
    parseCommand: (a) => (a ? (/^grup (on|off)$/.test(a) ? { kind: "group", value: a.endsWith("on") } : { kind: "prompt", prompt: a, seconds: 0 }) : { kind: "status" }),
    setGroup: async (v) => ({ on: v, saved: true }),
    make: async (prompt) => (prompt === "gagal" ? { error: "Kuota habis", kind: "quota" } : { video: { buffer: Buffer.from("mp4data-mp4data"), mime: "video/mp4", seconds: 20 } })
  };
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => "x", video }, fetchImpl: fakeFetch, log: silent });
  let id = 0;
  const say = async (text) => {
    const before = calls.length;
    await tg.handleUpdate({ update_id: ++id, message: { chat: { id: 111, type: "private" }, text } });
    return calls.slice(before);
  };
  const texts = (cs) => cs.filter((c) => c.method === "sendMessage").map((c) => c.body.text).join("\n");
  assert.match(texts(await say("/video")), /Pembuat video/);
  const r1 = await say("/video kancil dan buaya");
  const vid = r1.find((c) => c.method === "sendVideo");
  assert.ok(vid && vid.form, "dikirim lewat sendVideo");
  assert.equal(vid.fd.get("video").size, 15);
  assert.match(texts(r1), /Sedang membuat video/);
  assert.ok(r1.some((c) => c.method === "sendChatAction" && c.body.action === "upload_video"), "indikator 'mengirim video'");
  const r2 = await say("/video gagal");
  assert.match(texts(r2), /Kuota habis/);
  assert.ok(!r2.some((c) => c.method === "sendVideo"));
  assert.match(texts(await say("/video grup off")), /MATI/);
  assert.match(texts(await say("/vid")), /Pembuat video/);
  const none = createTelegram({ config: tcfg, deps: { chat: async () => "x", video: { available: () => false } }, fetchImpl: fakeFetch, log: silent });
  const b = calls.length;
  await none.handleUpdate({ update_id: 99, message: { chat: { id: 111, type: "private" }, text: "/video halo" } });
  assert.match(calls.slice(b).filter((c) => c.method === "sendMessage").map((c) => c.body.text).join(""), /belum aktif/);
}
ok("Telegram: /video status, buat (sendVideo), galat, saklar grup, belum aktif");

console.log(`\n${n} kelompok tes video lulus.`);
