// Tes STOP MOTION dari foto (stopmotion-video.js + video-gen.makeStopMotion + sesi /stopmotion di Telegram).
// Jalankan: node test-stopmotion-video.mjs   (perakitan memakai ffmpeg ASLI dengan foto kecil, beberapa detik saja)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DEFAULT_STOP_FPS, MAX_STOP_FPS, MIN_STOP_PHOTOS, parseStopMotionOptions, stopMotionSeconds, stopMotionArgs, buildStopMotion
} from "./stopmotion-video.js";
import { createVideoGen, readVideoConfig, stopMotionSentNote, VIDEO_TEXT } from "./video-gen.js";
import { createTelegram } from "./telegram.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smtest-"));

// foto sintetis: kotak kuning bergeser tiap jepretan
const frame = (i, w = 320, h = 240) => {
  const f = path.join(tmp, `f${i}-${w}x${h}.jpg`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x3060a0:s=${w}x${h},drawbox=x=${10 + i * 20}:y=${Math.round(h / 3)}:w=${Math.round(w / 6)}:h=${Math.round(w / 6)}:color=yellow:t=fill`, "-frames:v", "1", f]);
  return fs.readFileSync(f);
};
const probe = (buf) => {
  const f = path.join(tmp, "probe.mp4");
  fs.writeFileSync(f, buf);
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", f]).toString());
  return { v: j.streams.find((s) => s.codec_type === "video"), a: j.streams.find((s) => s.codec_type === "audio"), dur: Number(j.format.duration) };
};

// --- opsi
{
  assert.deepEqual(parseStopMotionOptions(""), { fps: DEFAULT_STOP_FPS, title: "", deflicker: true, boomerang: false, format: "", hold: 1.2 });
  assert.equal(parseStopMotionOptions("10 fps").fps, 10);
  assert.equal(parseStopMotionOptions("12 gambar per detik").fps, 12);
  assert.equal(parseStopMotionOptions("12 gambar/detik").fps, 12);
  assert.equal(parseStopMotionOptions("99 fps").fps, MAX_STOP_FPS, "dibatasi batas atas");
  assert.equal(parseStopMotionOptions("99 fps", { maxFps: 15 }).fps, 15, "batas dari konfigurasi");
  assert.equal(parseStopMotionOptions("1 fps").fps, 2, "batas bawah");
  const t = parseStopMotionOptions('tulisan "Lego Rumah" bolak-balik potret tanpa deflicker');
  assert.equal(t.title, "Lego Rumah");
  assert.equal(t.boomerang, true);
  assert.equal(t.format, "portrait");
  assert.equal(t.deflicker, false);
  assert.equal(parseStopMotionOptions('judul: "Pagi Hari"').title, "Pagi Hari");
  assert.equal(parseStopMotionOptions('"Tanpa Awalan"').title, "Tanpa Awalan");
  assert.equal(parseStopMotionOptions("boomerang").boomerang, true);
  assert.equal(parseStopMotionOptions("persegi").format, "square");
  assert.equal(parseStopMotionOptions("lanskap").format, "landscape");
  assert.equal(parseStopMotionOptions("pelan-pelan saja").boomerang, false);
}
ok("opsi: fps (batas bawah/atas/konfigurasi), judul, bolak-balik, bentuk, tanpa deflicker");

// --- argumen ffmpeg (murni)
{
  assert.equal(stopMotionSeconds(16, 8, 1.2), 3.2);
  const a = stopMotionArgs({ dir: "/x", n: 10, ow: 1200, oh: 900, fps: 8, out: "/o.mp4" });
  const s = a.args.join(" ");
  assert.match(s, /-framerate 8 -i \/x\/s%d\.png/);
  assert.match(s, /deflicker=mode=pm:size=5/);
  assert.match(s, /tpad=stop_mode=clone:stop_duration=1\.20/);
  assert.ok(!/drawtext/.test(s));
  assert.equal(a.W, 1280);
  assert.equal(a.H, 720);
  assert.ok(Math.abs(a.seconds - 2.45) < 1e-9);
  const b = stopMotionArgs({ dir: "/x", n: 10, ow: 900, oh: 1200, fps: 10, deflicker: false, title: "t", titleFile: "/x/judul.txt", font: "/f/a.ttf", out: "/o.mp4" }).args.join(" ");
  assert.ok(!/deflicker/.test(b));
  assert.match(b, /drawtext=fontfile='\/f\/a\.ttf':textfile='\/x\/judul\.txt'/);
  assert.match(b, /-r 25 -t 2\.20/);
}
ok("stopMotionArgs: framerate, deflicker, tahan gambar akhir, judul, ukuran kanvas");

// --- perakitan asli
{
  const photos = [0, 1, 2, 3, 4, 5].map((i) => frame(i));
  const stages = [];
  const r = await buildStopMotion(photos, parseStopMotionOptions("10 fps"), { tmpRoot: tmp, log: silent, onStage: (s, i, k) => stages.push([s, i, k]) });
  assert.equal(r.photos, 6);
  assert.equal(r.frames, 6);
  assert.equal(r.skipped, 0);
  assert.equal(r.fps, 10);
  assert.ok(Math.abs(r.seconds - 1.8) < 1e-6);
  const p = probe(r.buffer);
  assert.equal(p.v.width, 1280);
  assert.equal(p.v.height, 720);
  assert.ok(Math.abs(p.dur - 1.8) < 0.15, `durasi ${p.dur}`);
  assert.equal(p.a, undefined, "tanpa suara");
  assert.deepEqual(stages.filter((s) => s[0] === "prepare").map((s) => s[1]), [1, 2, 3, 4, 5, 6]);
  assert.equal(stages.at(-1)[0], "render");
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith("stopmo-")), [], "folder sementara dibersihkan");

  // foto rusak dilewati; foto lain bentuknya beda dipotong; bolak-balik; judul; potret
  const mixed = [photos[0], Buffer.from("bukan gambar ".repeat(20)), photos[1], frame(2, 400, 400), photos[3], photos[4]];
  const m = await buildStopMotion(mixed, parseStopMotionOptions('8 fps bolak-balik potret tulisan "Uji"'), { tmpRoot: tmp, log: silent });
  assert.equal(m.photos, 5);
  assert.equal(m.skipped, 1);
  assert.equal(m.frames, 5 + 3, "5 maju + 3 mundur (ujung tidak diulang)");
  assert.equal(m.height > m.width, true);
  assert.ok(Math.abs(probe(m.buffer).dur - (8 / 8 + 1.2)) < 0.15);

  await assert.rejects(() => buildStopMotion(photos.slice(0, 2), parseStopMotionOptions(""), { tmpRoot: tmp, log: silent }), (e) => e.kind === "toofew");
  await assert.rejects(() => buildStopMotion([Buffer.alloc(300, 1), Buffer.alloc(300, 2), Buffer.alloc(300, 3)], parseStopMotionOptions(""), { tmpRoot: tmp, log: silent }), (e) => e.kind === "badimage");
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith("stopmo-")), []);
}
ok("buildStopMotion: durasi & ukuran benar, foto rusak dilewati, bolak-balik, judul, potret, galat toofew/badimage, folder bersih");

// --- makeStopMotion (jatah, batas)
{
  const mem = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, JSON.parse(JSON.stringify(v))), m }; };
  const photos = [0, 1, 2, 3].map((i) => frame(i));
  const state = mem();
  const vg = createVideoGen({ imageGen: { available: () => false }, config: { ...readVideoConfig({}), photoOwnerDaily: 2, stopMaxPhotos: 6 }, state, log: silent, tmpRoot: tmp });
  assert.equal(readVideoConfig({}).stopMaxPhotos, 60);
  assert.equal(readVideoConfig({}).ownerDaily, 0, "pemilik tanpa batas bawaan");
  assert.equal(readVideoConfig({}).photoOwnerDaily, 0);
  assert.equal(readVideoConfig({ VIDEO_STOP_MAX_PHOTOS: "5000" }).stopMaxPhotos, 120);
  assert.equal(readVideoConfig({ VIDEO_STOP_MAX_FPS: "99" }).stopMaxFps, MAX_STOP_FPS);
  assert.deepEqual(vg.stopLimits(), { maxPhotos: 6, maxFps: 15 });
  const r1 = await vg.makeStopMotion(photos, '12 fps tulisan "Halo"', "owner");
  assert.ok(r1.video, r1.error);
  assert.equal(r1.video.fps, 12);
  assert.equal(r1.video.title, "Halo");
  assert.equal((await state.get("wa_video_quota")).photo.owner, 1, "memakai jatah foto hidup pemilik");
  assert.equal((await state.get("wa_video_quota")).owner, 0, "bukan jatah video AI");
  assert.equal((await vg.makeStopMotion(photos, "99 fps", "owner")).video.fps, 15, "fps dibatasi konfigurasi");
  const r3 = await vg.makeStopMotion(photos, "", "owner");
  assert.equal(r3.kind, "limit");
  assert.match(r3.error, /Jatah foto hidup pemilik hari ini \(2\)/);
  assert.equal((await vg.makeStopMotion(photos.slice(0, 2), "", "owner")).kind, "toofew");
  assert.equal((await vg.makeStopMotion(photos.concat(photos, photos), "", "owner")).kind, "toomany");
  // gagal membaca foto -> jatah dikembalikan
  const vg2 = createVideoGen({ imageGen: { available: () => false }, config: { ...readVideoConfig({}), photoOwnerDaily: 1 }, state: mem(), log: silent, tmpRoot: tmp });
  const bad = await vg2.makeStopMotion([Buffer.alloc(300, 1), Buffer.alloc(300, 2), Buffer.alloc(300, 3)], "", "owner");
  assert.equal(bad.kind, "badimage");
  assert.ok((await vg2.makeStopMotion(photos, "", "owner")).video, "jatah dikembalikan setelah gagal");
  // dimatikan
  const off = createVideoGen({ imageGen: { available: () => false }, config: { ...readVideoConfig({}), enabled: false }, log: silent, tmpRoot: tmp });
  assert.equal((await off.makeStopMotion(photos, "", "owner")).kind, "off");
  assert.match(vg.describe(), /Stop motion \(foto berurutan/);
  assert.match(stopMotionSentNote({ photos: 5, fps: 8, title: 'Ju"dul' }), /5 foto berurutan.*8 gambar per detik.*Ju'dul/);
  assert.match(VIDEO_TEXT.stoptoofew, new RegExp(String(MIN_STOP_PHOTOS)));
}
ok("makeStopMotion: jatah foto hidup (terpisah dari video AI), dikembalikan saat gagal, batas foto/fps, dimatikan, catatan & status");

// --- gaya stop motion pada animasi karakter: perintah sampai ke vd.make
{
  const vg = createVideoGen({ imageGen: { available: () => false }, config: readVideoConfig({}), log: silent, tmpRoot: tmp });
  assert.deepEqual(vg.parseCommand("animasi stop motion ayah dan anak ke taman"), { kind: "prompt", prompt: "ayah dan anak ke taman", seconds: 0, mode: "karakter", style: "stopmotion" });
  assert.equal(vg.parseCommand("animasi ayah dan anak ke taman").style, undefined);
  const d = vg.detect("buatkan animasi potongan kertas kancil dan buaya");
  assert.equal(d.style, "stopmotion");
  assert.equal(d.mode, "karakter");
  assert.ok(!/potongan kertas/i.test(d.prompt));
}
ok("perintah animasi bergaya stop motion membawa style (Telegram & WhatsApp)");

// --- Telegram: sesi /stopmotion
{
  const calls = [];
  const downloads = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const form = init?.body instanceof FormData;
    const body = init?.body && !form ? JSON.parse(init.body) : {};
    calls.push({ method, form, body, fd: form ? init.body : null });
    if (method === "getFile") {
      downloads.push(body.file_id);
      return { status: 200, json: async () => ({ ok: true, result: { file_path: `photos/${body.file_id}.jpg` } }) };
    }
    if (/\/file\/bot/.test(String(url))) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(500).buffer };
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const made = [];
  const video = {
    available: () => true,
    storyAvailable: () => true,
    photoAvailable: () => true,
    describe: () => "x",
    parseCommand: () => ({ kind: "status" }),
    setGroup: async () => ({ on: true, saved: true }),
    make: async () => ({ error: "tidak dipakai" }),
    detectPhoto: () => null,
    detectMorph: () => null,
    makeFromPhoto: async () => ({ error: "foto hidup tidak boleh terpanggil" }),
    stopAckMs: 15,
    stopLimits: () => ({ maxPhotos: 5, maxFps: 15 }),
    makeStopMotion: async (bufs, text) => {
      made.push({ count: bufs.length, text });
      if (/gagal/.test(text)) return { error: "Jatah foto hidup pemilik hari ini (2) sudah habis. Reset 00.00 WITA." };
      return { video: { buffer: Buffer.from("mp4mp4mp4"), width: 1280, height: 720, photos: bufs.length, fps: 8, seconds: 2.45, skipped: 0 } };
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const photoMsg = (fid) => ({ photo: [{ file_id: `${fid}-kecil` }, { file_id: fid }] });

  // tanpa sesi: foto tanpa keterangan tidak memicu apa pun
  assert.match(texts(await upd({ text: "/stopmotion jadi" })), /Belum ada sesi/);
  assert.match(texts(await upd({ text: "/stopmotion status" })), /Belum ada sesi/);
  assert.match(texts(await upd({ text: "/stopmotion batal" })), /Tidak ada sesi/);

  // mulai
  const s1 = await upd({ text: '/stopmotion 10 fps tulisan "Uji"' });
  assert.match(texts(s1), /Sesi stop motion dimulai/);
  assert.match(texts(s1), /maksimal 5/);

  // foto datang berurutan (sinkron, tanpa menunggu) -> satu pesan "masuk" (debounce), urutan terjaga
  const before = calls.length;
  await Promise.all([upd(photoMsg("a")), upd(photoMsg("b")), upd({ document: { file_id: "c", mime_type: "image/png" } }), upd({ document: { file_id: "zip", mime_type: "application/zip" } }).catch(() => {})]);
  await wait(60);
  const acks = calls.slice(before).filter((c) => c.method === "sendMessage" && /foto masuk/.test(c.body.text));
  assert.equal(acks.length, 1, "pemberitahuan digabung");
  assert.match(acks[0].body.text, /3 foto masuk/);
  assert.ok(!downloads.length, "foto baru diunduh saat /stopmotion jadi, bukan saat dikirim");
  assert.match(texts(await upd({ text: "/stopmotion status" })), /3 foto terkumpul.*opsi: 10 fps tulisan "Uji"/);

  // terlalu sedikit
  await upd({ text: "/stopmotion hapus" });
  assert.match(texts(await upd({ text: "/stopmotion jadi" })), /Baru 2 foto; butuh minimal 3/);
  assert.equal(made.length, 0);
  await upd(photoMsg("d"));
  await upd(photoMsg("e"));
  await upd(photoMsg("f")); // sudah 5 (c dihapus tadi)
  const over = await upd(photoMsg("x")); // ke-6 > batas 5
  const over2 = await upd(photoMsg("y"));
  assert.match(texts(over), /Sudah 5 foto \(batas\)/);
  assert.ok(!/Sudah 5 foto/.test(texts(over2)), "peringatan batas hanya sekali");
  await wait(60);
  assert.match(texts(await upd({ text: "/stopmotion status" })), /5 foto terkumpul/);

  // jadi: unduh berurutan, gabung opsi preset + opsi jadi, kirim video, sesi ditutup
  const r = await upd({ text: "/stopmotion jadi bolak-balik" });
  assert.deepEqual(downloads, ["a", "b", "d", "e", "f"], "urutan foto = urutan kiriman (ukuran terbesar; yang dihapus tidak ikut)");
  assert.deepEqual(made[0], { count: 5, text: 'bolak-balik 10 fps tulisan "Uji"' });
  assert.match(texts(r), /5 foto diterima/);
  const vid = r.find((c) => c.method === "sendVideo");
  assert.ok(vid && vid.fd.get("width") === "1280");
  assert.match(String(vid.fd.get("caption")), /5 foto · 8 gambar\/dtk · 2\.5 dtk/);
  assert.match(texts(await upd({ text: "/stopmotion status" })), /Belum ada sesi/);

  // galat: sesi tetap tersimpan supaya bisa dicoba lagi
  await upd({ text: "/stopmotion" });
  for (const f of ["g", "h", "i"]) await upd(photoMsg(f));
  const bad = await upd({ text: "/stopmotion jadi gagal" });
  assert.match(texts(bad), /Jatah foto hidup pemilik/);
  assert.match(texts(bad), /tetap tersimpan/);
  assert.ok(!bad.some((c) => c.method === "sendVideo"));
  assert.match(texts(await upd({ text: "/stopmotion status" })), /3 foto terkumpul/);
  const again = await upd({ text: "/stopmotion jadi" });
  assert.ok(again.some((c) => c.method === "sendVideo"));

  // batal, mulai ulang membuang sesi lama, opsi saja saat sesi berjalan
  await upd({ text: "/stopmotion mulai" });
  await upd(photoMsg("j"));
  assert.match(texts(await upd({ text: "/stopmotion 12 fps" })), /1 foto terkumpul.*12 fps/);
  assert.match(texts(await upd({ text: "/stopmotion batal" })), /dibatalkan \(1 foto dibuang\)/);
  assert.match(texts(await upd({ text: "/stopmotion status" })), /Belum ada sesi/);
  await upd({ text: "/stopmotion baru" });
  await upd(photoMsg("k"));
  await upd({ text: "/stopmotion baru" });
  assert.match(texts(await upd({ text: "/stopmotion status" })), /0 foto terkumpul/);

  // foto biasa di luar sesi tidak ditangkap
  await upd({ text: "/stopmotion batal" });
  const out = await upd(photoMsg("z"));
  assert.ok(!out.some((c) => c.method === "sendVideo"));
  assert.equal(made.length, 3, "tiga perakitan: berhasil, gagal, berhasil");
}
ok("Telegram /stopmotion: mulai, foto berurutan (termasuk berkas gambar) dengan pemberitahuan digabung, batas foto, jadi, galat menyimpan sesi, batal/hapus/baru");

// --- pemasangan
{
  const idx = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(idx, /makeStopMotion: async \(buffers, text, opts = \{\}\) =>[\s\S]{0,200}videoGen\.makeStopMotion\(buffers, text, "owner", ""/);
  assert.match(idx, /stopLimits: \(\) => videoGen\.stopLimits\(\)/);
  assert.equal((idx.match(/kind: isOwnerSender\(msg, false\) \? "owner" : "group"/g) || []).length, 2, "pemilik di grup WA memakai jatah pemilik (video & foto hidup)");
  assert.match(idx, /style: story \? req\.style \|\| "" : ""/);
  const tg = fs.readFileSync(new URL("./telegram.js", import.meta.url), "utf8");
  assert.match(tg, /vd\.make\(c\.prompt, \{ seconds: c\.seconds, mode: c\.mode, \.\.\.\(c\.style \? \{ style: c\.style \} : \{\}\) \}\)/);
  assert.match(tg, /if \(isStopPhoto\(m\)\) return true;/, "foto sesi diproses langsung agar urutan terjaga");
  assert.match(tg, /"stopmotion", "stop_motion"\]\);/, "perintah dijalankan langsung (FAST_COMMANDS)");
  assert.ok(tg.indexOf("if (isStopPhoto(m)) {") < tg.indexOf("deps.video?.makeFromPhoto"), "sesi stop motion dicek sebelum foto hidup/morf");
  const env = fs.readFileSync(new URL("./env-edit.js", import.meta.url), "utf8");
  assert.match(env, /VIDEO_STOP_MAX_PHOTOS/);
  assert.match(env, /VIDEO_STOP_MAX_FPS/);
  assert.ok(!/stopmotion/i.test(tg.slice(tg.indexOf("const HELP = ["), tg.indexOf("].join", tg.indexOf("const HELP = [")))), "teks /start tidak ditambah (sudah mendekati batas Telegram)");
}
ok("index.js/telegram.js/env-edit.js: terpasang; teks /start tidak ditambah");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} kelompok tes stop motion lulus ✅`);
