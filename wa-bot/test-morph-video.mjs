// Tes MORF FOTO (morph-video.js + video-gen.makeMorph + Telegram). Jalankan: node test-morph-video.mjs
// Perakitan memakai ffmpeg ASLI (foto kecil, singkat); mode interpolasi gerak hanya bila VIDEO_TEST_FULL=1.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  detectMorphRequest, parseMorphOptions, buildMorphPrompt, parseMorphPlan, fallbackMorphPlan, morphTiming, morphArgs, buildMorphVideo, MORPH_SECONDS
} from "./morph-video.js";
import { createVideoGen, readVideoConfig, morphSentNote, VIDEO_TEXT } from "./video-gen.js";
import { createTelegram } from "./telegram.js";
import fsx from "node:fs";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const FULL = process.env.VIDEO_TEST_FULL === "1";
const silent = { log() {}, warn() {}, error() {} };

// --- mengenali perintah
assert.deepEqual(detectMorphRequest("morf siang jadi malam", { hasImage: true }), { text: "siang jadi malam", needsImage: false });
assert.equal(detectMorphRequest("/video morf siang jadi malam bersalju", { hasImage: true }).text, "siang jadi malam bersalju");
assert.equal(detectMorphRequest("/video@AyyubiBot morf musim hujan", { hasImage: true }).text, "musim hujan");
assert.equal(detectMorphRequest("/morf jadi kartun", { hasImage: true }).text, "jadi kartun");
assert.equal(detectMorphRequest("Morph: dari musim panas ke salju", { hasImage: true }).text, "dari musim panas ke salju");
assert.equal(detectMorphRequest("transformasi jadi lukisan", { hasImage: true }).text, "jadi lukisan");
assert.equal(detectMorphRequest("/video morf siang jadi malam", { hasImage: false }).needsImage, true, "perintah garis miring tanpa foto -> minta foto");
assert.equal(detectMorphRequest("morf siang jadi malam", { hasImage: false }), null, "kata biasa tanpa foto bukan perintah");
assert.equal(detectMorphRequest("morfologi kata", { hasImage: true }), null);
assert.equal(detectMorphRequest("buatkan video morf", { hasImage: true }), null);
assert.equal(detectMorphRequest("ini foto liburan", { hasImage: true }), null);
assert.equal(detectMorphRequest("", { hasImage: true }), null);
ok("perintah morf dikenali (morf/morph/transformasi, /video morf, /morf); kata biasa tanpa foto diabaikan");

// --- opsi
{
  const d = parseMorphOptions("siang jadi malam bersalju");
  assert.deepEqual(d, { prompt: "siang jadi malam bersalju", seconds: MORPH_SECONDS, steps: 5, smooth: false });
  const o = parseMorphOptions("siang jadi malam 10 detik 6 tahap halus");
  assert.deepEqual(o, { prompt: "siang jadi malam", seconds: 10, steps: 6, smooth: true });
  assert.equal(parseMorphOptions("x 99 detik", { maxSeconds: 14 }).seconds, 14, "durasi dibatasi");
  assert.equal(parseMorphOptions("x 1 detik").seconds, 4, "durasi minimal 4");
  assert.equal(parseMorphOptions("x 50 tahap", { maxSteps: 8 }).steps, 8);
  assert.equal(parseMorphOptions("x 1 tahap").steps, 2);
  assert.equal(parseMorphOptions('"jadi kartun"').prompt, "jadi kartun");
  assert.equal(parseMorphOptions("", {}).prompt, "");
  assert.equal(parseMorphOptions("jadi malam", { defaultSteps: 3, defaultSeconds: 6 }).steps, 3);
}
ok("opsi: durasi, tahap, halus, batas atas/bawah, kutipan dibuang, bawaan dari konfigurasi");

// --- rencana tahap
{
  const p = buildMorphPrompt("siang jadi malam", 5);
  assert.match(p.system, /Exactly 5 strings/);
  assert.match(p.system, /ORIGINAL photo/);
  assert.match(p.system, /faces/);
  assert.match(p.user, /siang jadi malam/);
  const good = parseMorphPlan('```json\n{"steps":["Make the sky slightly darker","Make the sky orange dusk","Make it dark blue evening","Make it night with stars","Make it deep night with a moon"]}\n```', 5, "x");
  assert.equal(good.fallback, false);
  assert.equal(good.steps.length, 5);
  const few = parseMorphPlan('{"steps":["Make the sky slightly darker","Make it fully night"]}', 5, "siang jadi malam");
  assert.equal(few.fallback, true, "terlalu sedikit -> rencana cadangan penuh");
  const mid = parseMorphPlan('{"steps":["Make the sky slightly darker","Make the sky orange","Make it night"]}', 5, "siang jadi malam");
  assert.equal(mid.fallback, false);
  assert.equal(mid.steps.length, 5, "kekurangan dilengkapi cadangan");
  assert.match(mid.steps[4], /fully complete/);
  assert.equal(parseMorphPlan("bukan json", 4, "x").fallback, true);
  assert.equal(parseMorphPlan('{"steps":"bukan larik"}', 4, "x").steps.length, 4);
  const fb = fallbackMorphPlan("buat jadi malam", 4);
  assert.equal(fb.length, 4);
  assert.match(fb[0], /25%/);
  assert.match(fb[3], /fully complete/);
  assert.equal(parseMorphPlan('{"steps":["a","b","c","d","e","f","g","h"]}', 3, "x").fallback, true, "instruksi terlalu pendek dibuang");
  const long = parseMorphPlan(JSON.stringify({ steps: Array.from({ length: 9 }, (_, i) => `Make the sky darker step number ${i}`) }), 4, "x");
  assert.equal(long.steps.length, 4, "kelebihan dipotong");
}
ok("rencana: prompt AI, JSON berpagar, kekurangan dilengkapi, rusak -> cadangan bertakaran bertahap");

// --- waktu & argumen ffmpeg
{
  const t = morphTiming(6, 8);
  assert.ok(t.hold > t.fade && t.fade >= 0.4 && t.fade <= 1.2);
  assert.ok(Math.abs(6 * t.hold - 5 * t.fade - 8) < 1e-9, "total durasi persis sesuai permintaan");
  const t2 = morphTiming(2, 4);
  assert.ok(Math.abs(2 * t2.hold - 1 * t2.fade - 4) < 1e-9);
  const a = morphArgs({ dir: "/tmp/x", n: 4, ow: 1000, oh: 750, seconds: 8, out: "/tmp/o.mp4" });
  assert.equal(a.W, 1280);
  assert.equal(a.H, 720);
  const s = a.args.join(" ");
  assert.equal((s.match(/-loop 1/g) || []).length, 4, "satu masukan per gambar");
  assert.equal((s.match(/xfade=transition=fade/g) || []).length, 3);
  assert.match(s, /boxblur/, "foto 4:3 di kanvas 16:9 -> latar blur");
  assert.ok(!/minterpolate/.test(s));
  assert.match(s, /-frames:v 200/, "8 detik x 25 fps");
  const c = morphArgs({ dir: "/tmp/x", n: 3, ow: 1280, oh: 720, seconds: 6, out: "/tmp/o.mp4" });
  assert.match(c.args.join(" "), /\[b\]scale=1280:720/, "bentuk sama dengan kanvas -> penuh");
  const sm = morphArgs({ dir: "/tmp/x", n: 4, ow: 720, oh: 1280, seconds: 9, smooth: true, out: "/tmp/o.mp4" });
  const ss = sm.args.join(" ");
  assert.equal(sm.W, 720);
  assert.match(ss, /minterpolate=fps=25:mi_mode=mci/);
  assert.match(ss, /tpad=stop_mode=clone:stop_duration=3\.000/, "interval terakhir diperpanjang (minterpolate membuangnya)");
  assert.match(ss, /-framerate 0\.33333 -i \/tmp\/x\/n%d\.png/);
  assert.ok(!/xfade/.test(ss));
}
ok("morphTiming dan argumen ffmpeg: xfade berantai, interpolasi gerak, kanvas menurut bentuk foto, total frame");

// --- perakitan nyata (foto kecil)
const hasFf = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0 && /xfade/.test(execFileSync("ffmpeg", ["-hide_banner", "-filters"]).toString());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "morftest-"));
const photoOf = (w, h, file = "p.png") => {
  const f = path.join(tmp, file);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=0x87ceeb:c1=0x3a7d44:x0=0:y0=0:x1=0:y1=${h}:d=1`, "-frames:v", "1", f]);
  return fs.readFileSync(f);
};
const probe = (buf) => {
  const f = path.join(tmp, "probe.mp4");
  fs.writeFileSync(f, buf);
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", f]).toString());
  return { v: j.streams.find((s) => s.codec_type === "video"), a: j.streams.find((s) => s.codec_type === "audio"), dur: Number(j.format.duration) };
};
// pembuat edit palsu: menggelapkan foto sedikit demi sedikit (dari foto asli) dan menyimpan instruksi yang diterimanya
const fakeEditor = (log = []) => {
  let k = 0;
  return async (instruction, src) => {
    k += 1;
    log.push({ instruction, srcLen: src.length });
    const a = path.join(tmp, `ed-src-${k}.bin`);
    const b = path.join(tmp, `ed-out-${k}.png`);
    fs.writeFileSync(a, src);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", a, "-vf", `eq=brightness=${(-0.15 * k).toFixed(2)}`, "-frames:v", "1", b]);
    return fs.readFileSync(b);
  };
};
if (!hasFf) console.log("  - ffmpeg/ffprobe/xfade tidak ada: tes perakitan morf dilewati");
else {
  { // 4:3 -> kanvas lanskap, durasi tepat
    const stages = [];
    const calls = [];
    const r = await buildMorphVideo(photoOf(320, 240), ["step one dark", "step two darker", "step three darkest"], { seconds: 4 }, { editImage: fakeEditor(calls), tmpRoot: tmp, onStage: (...a) => stages.push(a.join(":")) });
    const p = probe(r.buffer);
    assert.equal(p.v.codec_name, "h264");
    assert.equal(p.v.width, 1280);
    assert.equal(p.v.height, 720);
    assert.ok(Math.abs(p.dur - 4) < 0.15, `durasi ${p.dur}`);
    assert.equal(p.a, undefined);
    assert.equal(r.frames, 4);
    assert.equal(r.planned, 4);
    assert.equal(r.smooth, false);
    assert.deepEqual(stages, ["edit:1:3", "edit:2:3", "edit:3:3", "render"]);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => c.srcLen === calls[0].srcLen), "tiap tahap diedit dari foto ASLI yang sama (tidak menumpuk)");
    assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith("morf-")), [], "folder sementara bersih");
  }
  { // potret + mode berantai
    const calls = [];
    const r = await buildMorphVideo(photoOf(240, 400, "pot.png"), ["one dark", "two darker"], { seconds: 4 }, { editImage: fakeEditor(calls), tmpRoot: tmp, chain: true });
    const p = probe(r.buffer);
    assert.equal(p.v.width, 720);
    assert.equal(p.v.height, 1280);
    assert.notEqual(calls[1].srcLen, calls[0].srcLen, "mode berantai: tahap kedua diedit dari hasil tahap pertama");
  }
  { // hasil edit berbeda ukuran/bentuk dengan foto asli: tetap jadi
    const base = fakeEditor();
    const odd = async (i, s) => {
      const b = await base(i, s);
      const f = path.join(tmp, "odd.png");
      fs.writeFileSync(f, b);
      const o = path.join(tmp, "odd2.png");
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", f, "-vf", "scale=512:512", o]);
      return fs.readFileSync(o);
    };
    const r = await buildMorphVideo(photoOf(320, 240, "o.png"), ["x one dark", "y two dark"], { seconds: 4 }, { editImage: odd, tmpRoot: tmp });
    assert.equal(probe(r.buffer).v.width, 1280);
  }
  { // tahap pertama gagal -> galat dengan kind dari pembuat edit; tahap tengah gagal -> berhenti, tetap jadi (>= 2 gambar)
    await assert.rejects(buildMorphVideo(photoOf(320, 240, "g.png"), ["a b c d e f g h", "x y z w v u t s"], { seconds: 4 }, { editImage: async () => { throw Object.assign(new Error("Kuota habis"), { kind: "quota" }); }, tmpRoot: tmp, log: silent }), (e) => e.kind === "quota" && /Kuota habis/.test(e.message));
    const ed = fakeEditor();
    let i = 0;
    const flaky = async (a, b) => {
      i += 1;
      if (i === 3) throw new Error("rusak");
      return ed(a, b);
    };
    const r = await buildMorphVideo(photoOf(320, 240, "h.png"), ["one dark", "two darker", "three bad", "four last"], { seconds: 4 }, { editImage: flaky, tmpRoot: tmp, log: silent });
    assert.equal(r.frames, 3, "foto asli + 2 edit berhasil, sisanya dilewati");
    assert.equal(r.planned, 5);
    await assert.rejects(buildMorphVideo(Buffer.alloc(10), ["a"], { seconds: 4 }, { editImage: async () => Buffer.alloc(200), tmpRoot: tmp }), (e) => e.kind === "badimage");
    await assert.rejects(buildMorphVideo(Buffer.from("bukan gambar sama sekali, hanya teks biasa yang panjang"), ["a"], { seconds: 4 }, { editImage: async () => Buffer.alloc(200), tmpRoot: tmp }), (e) => e.kind === "badimage");
    await assert.rejects(buildMorphVideo(photoOf(320, 240, "n.png"), ["a"], { seconds: 4 }, { tmpRoot: tmp }), (e) => e.kind === "noedit");
    await assert.rejects(buildMorphVideo(photoOf(320, 240, "k.png"), ["a b"], { seconds: 4 }, { editImage: async () => Buffer.alloc(10), tmpRoot: tmp, log: silent }), (e) => /hasil edit kosong/.test(e.message), "hasil edit kosong dianggap gagal");
  }
  if (FULL) { // interpolasi gerak sungguhan
    const r = await buildMorphVideo(photoOf(320, 240, "s.png"), ["one dark", "two darker", "three darkest"], { seconds: 6, smooth: true }, { editImage: fakeEditor(), tmpRoot: tmp });
    assert.equal(r.smooth, true);
    assert.ok(Math.abs(probe(r.buffer).dur - 6) < 0.2, "interpolasi gerak: durasi tetap tepat");
  }
  // interpolasi gagal -> kembali ke lebur halus
  {
    const real = (await import("node:child_process")).spawn;
    const spawnImpl = (cmd, args, o) => real(cmd, args.map((x) => (typeof x === "string" ? x.replace("minterpolate=fps=25:mi_mode=mci", "minterpolate=fps=25:mi_mode=nope") : x)), o);
    const r = await buildMorphVideo(photoOf(320, 240, "f.png"), ["one dark", "two darker"], { seconds: 4, smooth: true }, { editImage: fakeEditor(), tmpRoot: tmp, spawnImpl, log: silent });
    assert.equal(r.smooth, false, "interpolasi gagal -> lebur halus, video tetap jadi");
  }
  ok("perakitan nyata: 4:3 -> 1280x720 tepat 4 dtk, tiap tahap dari foto asli, potret, bentuk hasil edit berbeda, galat, berhenti di tengah, folder bersih, cadangan interpolasi");
}

// --- lewat pembuat video: jatah, penolakan, rencana AI
if (hasFf) {
  const mem = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, JSON.parse(JSON.stringify(v))), m }; };
  const photo = photoOf(320, 240, "v.png");
  const plans = [];
  const mk = (extra = {}) => createVideoGen({
    imageGen: { available: () => true, canEdit: () => true },
    editImage: fakeEditor(),
    writeScript: async (p) => { plans.push(p); return '{"steps":["Make the sky slightly darker","Make the sky orange","Make it dark blue","Make it night with stars","Make it deep night"]}'; },
    config: { ...readVideoConfig({}), morphOwnerDaily: 2, morphSteps: 3, morphSeconds: 4, ...extra.config },
    state: extra.state, log: silent, tmpRoot: tmp, ...extra.deps
  });
  const state = mem();
  const vg = mk({ state });
  assert.equal(vg.morphAvailable(), true);
  const r1 = await vg.makeMorph(photo, "siang jadi malam", "owner");
  assert.ok(r1.video, r1.error);
  assert.equal(r1.video.frames, 4, "3 tahap + foto asli");
  assert.equal(r1.video.steps.length, 3);
  assert.equal(r1.video.fallback, false);
  assert.equal(r1.video.prompt, "siang jadi malam");
  assert.match(plans[0].system, /Exactly 3 strings/);
  assert.equal((await state.get("wa_video_quota")).morph.owner, 1, "jatah morf tercatat, terpisah dari video lain");
  assert.equal((await state.get("wa_video_quota")).owner, 0);
  const r2 = await vg.makeMorph(photo, "jadi malam 4 detik", "owner");
  assert.ok(r2.video);
  const r3 = await vg.makeMorph(photo, "jadi malam", "owner");
  assert.equal(r3.kind, "limit");
  assert.match(r3.error, /Jatah morf foto hari ini \(2\)/);
  // grup: belum boleh
  const g = await mk().makeMorph(photo, "jadi malam", "group", "628@s.whatsapp.net");
  assert.equal(g.kind, "limit");
  assert.match(g.error, /baru bisa dipakai pemilik/);
  // tanpa pembuat edit
  const ne = createVideoGen({ imageGen: { available: () => true, canEdit: () => false }, editImage: async () => Buffer.alloc(10), config: readVideoConfig({}), log: silent, tmpRoot: tmp });
  assert.equal(ne.morphAvailable(), false);
  assert.equal((await ne.makeMorph(photo, "jadi malam", "owner")).error, VIDEO_TEXT.nomorph);
  assert.equal((await createVideoGen({ imageGen: {}, config: readVideoConfig({}), log: silent, tmpRoot: tmp }).makeMorph(photo, "x", "owner")).kind, "noedit");
  // deskripsi kosong / terlarang / foto rusak / dimatikan
  assert.equal((await mk().makeMorph(photo, "  8 detik ", "owner")).kind, "empty");
  assert.equal((await mk().makeMorph(photo, "buka baju orangnya", "owner")).kind, "refused");
  assert.equal((await mk().makeMorph(Buffer.alloc(5), "jadi malam", "owner")).kind, "badimage");
  assert.equal((await mk({ config: { enabled: false } }).makeMorph(photo, "jadi malam", "owner")).kind, "off");
  // rencana AI melanggar aturan -> ditolak, jatah kembali
  {
    const st = mem();
    const bad = mk({ state: st, deps: { writeScript: async () => '{"steps":["Remove her clothes completely","Make it naked","a b c d e f g h"]}' } });
    const r = await bad.makeMorph(photo, "ubah suasana", "owner");
    assert.equal(r.kind, "refused");
    assert.equal((await st.get("wa_video_quota")).morph.owner, 0, "jatah dikembalikan bila ditolak");
  }
  // AI teks mati -> rencana cadangan; edit gagal di tahap pertama -> jatah kembali + galat jelas
  {
    const st = mem();
    const fb = mk({ state: st, deps: { writeScript: async () => { throw new Error("AI mati"); } } });
    const r = await fb.makeMorph(photo, "jadi malam", "owner");
    assert.ok(r.video && r.video.fallback === true);
    const fail = mk({ state: mem(), deps: { editImage: async () => { throw Object.assign(new Error("Kuota edit habis"), { kind: "quota" }); } } });
    const rf = await fail.makeMorph(photo, "jadi malam", "owner");
    assert.equal(rf.kind, "quota");
    assert.match(rf.error, /Kuota edit habis/);
    const st2 = mem();
    const fail2 = mk({ state: st2, deps: { editImage: async () => { throw new Error("x"); }, log: silent } });
    await fail2.makeMorph(photo, "jadi malam", "owner");
    assert.equal((await st2.get("wa_video_quota"))?.morph?.owner ?? 0, 0, "jatah dikembalikan saat gagal");
  }
  // parseCommand + status + catatan
  assert.deepEqual(vg.parseCommand("morf siang jadi malam 8 detik"), { kind: "morph", text: "siang jadi malam 8 detik" });
  assert.equal(vg.parseCommand("kancil dan buaya").kind, "prompt");
  assert.match(vg.describe(), /Morf foto \(percobaan, pemilik saja.*aktif.*jatah 2\/hari, hari ini 2/);
  assert.match(morphSentNote('siang "jadi" malam'), /^🧬 \[BOT mengirim VIDEO hasil MORF FOTO .* "siang 'jadi' malam"\]$/);
  // sedang sibuk: dua morf bersamaan -> yang kedua menunggu giliran, ketiga ditolak sibuk (antrean dibagi dengan video lain)
  {
    let release;
    const gate = new Promise((r) => (release = r));
    const slow = mk({ deps: { editImage: async (i, s) => { await gate; return fakeEditor()(i, s); } }, config: { morphOwnerDaily: 0, queue: 0 } });
    const a = slow.makeMorph(photo, "jadi malam", "owner");
    await new Promise((r) => setTimeout(r, 300));
    const b = await slow.makeMorph(photo, "jadi malam", "owner");
    assert.equal(b.kind, "busy");
    release();
    assert.ok((await a).video);
  }
  ok("makeMorph: jatah terpisah & dikembalikan, grup belum boleh, tanpa edit foto, deskripsi kosong/terlarang, rencana AI melanggar, cadangan, sibuk, status");
}

// --- Telegram
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const form = init?.body instanceof FormData;
    calls.push({ method, form, body: init?.body && !form ? JSON.parse(init.body) : {}, fd: form ? init.body : null });
    if (method === "getFile") return { status: 200, json: async () => ({ ok: true, result: { file_path: "photos/f.jpg" } }) };
    if (/\/file\/bot/.test(String(url))) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(500).buffer };
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const made = [];
  let morphOn = true;
  const vg = createVideoGen({ imageGen: { available: () => true, canEdit: () => true }, editImage: async () => Buffer.alloc(10), config: readVideoConfig({}), log: silent });
  const video = {
    available: () => true,
    storyAvailable: () => true,
    photoAvailable: () => true,
    describe: () => "x",
    parseCommand: (a) => vg.parseCommand(a),
    setGroup: async () => ({ on: true, saved: true }),
    make: async () => ({ error: "tidak dipakai" }),
    detectPhoto: () => null,
    makeFromPhoto: async () => ({ error: "foto hidup tidak boleh terpanggil" }),
    morphAvailable: () => morphOn,
    detectMorph: (t, o) => vg.detectMorph(t, o),
    makeMorph: async (buf, text, opts) => {
      made.push({ size: buf.length, text });
      opts.onStage("edit", 1, 5);
      opts.onStage("edit", 2, 5);
      return text.includes("gagal") ? { error: "Kuota edit habis" } : { video: { buffer: Buffer.from("mp4mp4mp4"), mime: "video/mp4", width: 1280, height: 720, frames: 6, smooth: /halus/.test(text), fallback: false } };
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
  const r1 = await upd({ photo: [{ file_id: "small" }, { file_id: "big" }], caption: "/video morf siang jadi malam 5 tahap" });
  assert.deepEqual(made[0], { size: 500, text: "siang jadi malam 5 tahap" });
  assert.ok(calls.some((c) => c.method === "getFile" && c.body.file_id === "big"));
  assert.equal(texts(r1).match(/diubah bertahap/g).length, 1, "pemberitahuan hanya sekali");
  assert.match(texts(r1), /5 edit AI/);
  const vid = r1.find((c) => c.method === "sendVideo");
  assert.ok(vid && vid.fd.get("width") === "1280");
  assert.match(String(vid.fd.get("caption")), /6 gambar kunci/);
  const r2 = await upd({ photo: [{ file_id: "p" }], caption: "morf jadi lukisan halus" });
  assert.equal(made[1].text, "jadi lukisan halus");
  assert.match(String(r2.find((c) => c.method === "sendVideo").fd.get("caption")), /interpolasi gerak/);
  const r3 = await upd({ text: "/video morf jadi malam", reply_to_message: { photo: [{ file_id: "q" }] } });
  assert.equal(made[2].text, "jadi malam");
  assert.ok(r3.some((c) => c.method === "sendVideo"));
  const r4 = await upd({ photo: [{ file_id: "p" }], caption: "/video morf gagal total" });
  assert.match(texts(r4), /Kuota edit habis/);
  assert.ok(!r4.some((c) => c.method === "sendVideo"));
  const r5 = await upd({ text: "/video morf siang jadi malam" });
  assert.match(texts(r5), /butuh FOTO/);
  assert.equal(made.length, 4);
  const r6 = await upd({ photo: [{ file_id: "p" }], caption: "ini foto liburan" });
  assert.equal(made.length, 4, "keterangan biasa tidak diproses");
  morphOn = false;
  const r7 = await upd({ photo: [{ file_id: "p" }], caption: "/video morf jadi malam" });
  assert.match(texts(r7), /butuh pembuat edit foto/);
  assert.equal(made.length, 4);
}
ok("Telegram: foto+/video morf, balas foto, galat, tanpa foto -> petunjuk, tanpa edit foto -> penjelasan, keterangan biasa diabaikan");

// --- pemasangan di index.js
{
  const idx = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(idx, /editImage: async \(instruction, buffer\) => \(await imageGen\.editImage\(instruction, await prepareEditInput\(buffer\)\)\)\.buffer/);
  assert.match(idx, /photoSource && req\.morph/);
  assert.match(idx, /videoGen\.makeMorph\(dl\.buffer, req\.prompt \|\| "", kind, who/);
  assert.match(idx, /makeMorph: async \(buffer, text, opts = \{\}\) =>/);
  assert.match(idx, /const morph = videoGen\.detectMorph\(caption, \{ hasImage: true \}\);[\s\S]{0,400}morph: true/);
  assert.ok(idx.indexOf("videoGen.detectMorph(caption, { hasImage: true })") < idx.indexOf("videoGen.detectPhoto(caption, { hasImage: true })"), "morf dicek sebelum foto hidup");
  assert.ok(!/kind: "group"[^\n]*morph/.test(idx), "morf belum terhubung ke grup");
}
ok("index.js: pembuat edit foto terpasang, morf dicek sebelum foto hidup, hanya pemilik");

fsx.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} kelompok tes morf foto lulus ✅`);
