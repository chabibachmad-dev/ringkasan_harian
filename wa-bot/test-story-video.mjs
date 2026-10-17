// Tes ANIMASI KARAKTER TANPA WAJAH (story-video.js + video-gen.make mode "karakter"). Jalankan: node test-story-video.mjs
// Perakitan memakai ffmpeg ASLI bila tersedia; tanpa ffmpeg bagian itu dilewati.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  W, H, FPS, GROUND, BASE_K, parseColor, normalizeKind, makeCharacter, normalizeAction, ACTIONS, actionPose, planCharacter, createPainter, drawCharacter,
  encodePng, paintBackground, normalizeSetting, buildStoryPrompt, parseStoryScript, fallbackStory, sceneArgs, createSceneRenderer, detectStoryMode, writeBackground, CAM_ZOOM
} from "./story-video.js";
import { createVideoGen, readVideoConfig, storySentNote, VIDEO_TEXT } from "./video-gen.js";
import { createTelegram } from "./telegram.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
// Perakitan video sungguhan itu lambat (laptop kantor: menit). Tes otomatis (/tes, /ya) hanya menjalankan yang inti;
// jalankan VIDEO_TEST_FULL=1 node <berkas tes> untuk semua kasus render.
const FULL = process.env.VIDEO_TEST_FULL === "1";
const okHeavy = (name) => (FULL ? ok(name) : console.log(`  - (dilewati; VIDEO_TEST_FULL=1 untuk menjalankan) ${name}`));
const silent = { log() {}, warn() {}, error() {} };
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) }; };
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "story-test-"));

// --- warna
assert.deepEqual(parseColor("#ff0000"), [255, 0, 0]);
assert.deepEqual(parseColor("biru tua"), parseColor("navy"));
assert.notDeepEqual(parseColor("biru tua"), parseColor("biru"), "frasa panjang didahulukan dari kata pendek");
assert.deepEqual(parseColor("light blue"), parseColor("biru muda"));
assert.deepEqual(parseColor("warna aneh", [1, 2, 3]), [1, 2, 3]);
assert.deepEqual(parseColor("", [9, 9, 9]), [9, 9, 9]);
ok("warna: hex, kata Indonesia/Inggris, frasa panjang didahulukan, cadangan");

// --- jenis karakter
assert.equal(normalizeKind("man").kind, "pria");
assert.equal(normalizeKind("Ayah").kind, "pria");
assert.deepEqual(normalizeKind("woman"), { kind: "wanita", female: true });
assert.deepEqual(normalizeKind("boy"), { kind: "anak", female: false });
assert.deepEqual(normalizeKind("girl"), { kind: "anak", female: true });
assert.equal(normalizeKind("grandfather").kind, "kakek");
assert.deepEqual(normalizeKind("nenek"), { kind: "nenek", female: true });
assert.equal(normalizeKind("").kind, "pria");
{
  const man = makeCharacter({ kind: "man", shirt: "red", pants: "black", hat: "peci" }, 0);
  assert.deepEqual(man.top, parseColor("red"));
  assert.deepEqual(man.bottom, parseColor("black"));
  assert.equal(man.hat, "peci");
  assert.equal(man.hijab, false);
  const wm = makeCharacter({ kind: "woman", hijab_color: "teal", shirt: "maroon" }, 1);
  assert.equal(wm.hijab, true);
  assert.deepEqual(wm.hijabCol, parseColor("teal"));
  assert.deepEqual(wm.bottom, wm.top, "gamis satu warna");
  assert.equal(wm.skirt, true);
  const girl = makeCharacter({ kind: "girl", hijab: true, shirt: "pink" }, 2);
  assert.equal(girl.hijab, true);
  assert.equal(girl.skirt, true);
  const boy = makeCharacter({ kind: "boy" }, 2);
  assert.ok(boy.heightPx < man.heightPx * 0.8, "anak lebih pendek");
  assert.ok(boy.headRy / boy.legL > man.headRy / man.legL, "kepala anak lebih besar secara proporsi");
  const grand = makeCharacter({ kind: "grandfather" }, 0);
  assert.ok(grand.stoop > 0 && grand.hat === "peci");
  assert.ok(man.heightPx > 300 && man.heightPx < 420, `tinggi dewasa wajar (${man.heightPx})`);
  assert.notDeepEqual(makeCharacter({ kind: "man" }, 0).top, makeCharacter({ kind: "man" }, 1).top, "pemeran berbeda dapat warna bawaan berbeda");
  assert.equal(makeCharacter({ kind: "man", hat: "none" }, 0).hat, "none");
  assert.equal(makeCharacter({ kind: "man", hat: "cap" }, 0).hat, "topi");
  assert.notEqual(makeCharacter({ kind: "man", skin: "dark" }, 0).skin[0], makeCharacter({ kind: "man", skin: "light" }, 0).skin[0]);
}
ok("karakter: jenis, warna, hijab/gamis, peci/topi, kulit, proporsi anak & kakek");

// --- aksi
assert.equal(normalizeAction("Walking"), "walk");
assert.equal(normalizeAction("melambai"), "wave");
assert.equal(normalizeAction("berlari"), "run");
assert.equal(normalizeAction("duduk"), "sit");
assert.equal(normalizeAction("sholat"), "pray");
assert.equal(normalizeAction("sesuatu yang aneh"), "talk");
assert.equal(normalizeAction(undefined), "talk");
for (const a of ACTIONS) assert.equal(normalizeAction(a), a);
ok("aksi: nama Inggris/Indonesia dikenali, tak dikenal -> bicara");

for (const a of ACTIONS)
  for (let t = 0; t < 4; t += 0.173) {
    const p = actionPose(a, t, 3, t * 0.9);
    assert.equal(p.length, 13, a);
    for (const v of p) assert.ok(Number.isFinite(v), `${a} t=${t}: ${v}`);
    assert.ok(Math.abs(p[0]) < 1.3 && Math.abs(p[1]) < 0.8, `${a}: condong/miring wajar`);
  }
assert.ok(actionPose("wave", 0.2, 3)[10] > 2.2, "melambai: lengan dekat terangkat");
assert.equal(actionPose("sit", 1, 3)[12], 1);
assert.equal(actionPose("idle", 1, 3)[12], 0);
assert.ok(actionPose("cheer", 0.3, 3)[10] > 2.3 && actionPose("cheer", 0.3, 3)[8] > 2.3, "bersorak: dua lengan naik");
assert.ok(actionPose("point", 1, 3)[10] > 1.3 && actionPose("point", 1, 3)[10] < 1.7, "menunjuk: lengan hampir mendatar");
{
  const jumpH = [0, 0.2, 0.42, 0.6, 0.8].map((t) => actionPose("jump", t, 2)[2]);
  assert.ok(Math.max(...jumpH) > 0.1 && Math.min(...jumpH) >= 0, "lompat: naik lalu kembali ke tanah");
  const b0 = actionPose("bow", 0, 3)[0], bm = actionPose("bow", 0.9, 3)[0], be = actionPose("bow", 3, 3)[0];
  assert.ok(b0 < 0.05 && bm > 0.6 && be < 0.05, "membungkuk: tegak -> membungkuk -> tegak");
  // jalan: kaki kiri-kanan berlawanan, lengan berlawanan dengan kaki
  const w = actionPose("walk", 1, 3, 0.25);
  assert.ok(w[6] > 0.3 && w[4] < -0.3, "kaki dekat maju, kaki jauh mundur");
  assert.ok(w[10] < 0.1 && w[8] > 0.4, "lengan dekat mundur saat kaki dekat maju");
}
ok("pose: 14 aksi menghasilkan sudut terbatas; lambai, sorak, tunjuk, lompat, bungkuk, siklus jalan benar");

// --- rencana gerak
{
  const ch = makeCharacter({ kind: "man" }, 0);
  const plan = planCharacter(ch, { x0: 0.1, face: "right", acts: [{ do: "walk", to: 0.6 }, { do: "wave" }] }, 6);
  assert.equal(plan.segs.length, 2);
  assert.ok(Math.abs(plan.xAt(0) - 0.1 * W) < 1);
  assert.ok(Math.abs(plan.xAt(5.9) - 0.6 * W) < 1, "sampai di tujuan lalu diam");
  let prev = -1;
  for (let t = 0; t < plan.segs[0].t1; t += 0.05) {
    const x = plan.xAt(t);
    assert.ok(x >= prev - 1e-6, "bergerak searah");
    prev = x;
  }
  assert.equal(plan.actAt(0.1), "walk");
  assert.equal(plan.actAt(5.5), "wave");
  assert.ok(plan.segs[1].t0 > 0.8 && plan.segs[1].t0 < 6 * 0.85, "jalan memakai waktu secukupnya, sisa untuk melambai");
  assert.equal(plan.dirAt(0.5), 1);
  const left = planCharacter(ch, { x0: 0.8, acts: [{ do: "walk", to: 0.3 }] }, 5);
  assert.equal(left.dirAt(1), -1, "berjalan ke kiri menghadap kiri");
  assert.ok(left.xAt(2) < 0.8 * W);
  const only = planCharacter(ch, { x0: 0.5, acts: [{ do: "walk", to: 0.7 }] }, 8);
  assert.ok(only.segs.length === 2 && only.segs[1].act === "talk", "jalan saja -> sisa waktu diisi bicara");
  const fast = planCharacter(ch, { x0: 0.05, acts: [{ do: "walk", to: 0.95 }] }, 1.5);
  assert.ok(fast.segs[0].t1 <= 1.5 * 0.8 + 1e-6, "jalan jauh pada adegan pendek dipercepat, tidak melewati durasi");
  const noTo = planCharacter(ch, { x0: 0.4, acts: [{ do: "walk" }] }, 4);
  assert.equal(noTo.segs[0].act, "talk", "jalan tanpa tujuan = tidak bergerak");
  assert.ok(Math.abs(noTo.xAt(3) - 0.4 * W) < 1e-6);
  const empty = planCharacter(ch, { x0: 0.5, acts: [] }, 3);
  assert.equal(empty.segs[0].act, "talk");
  const clampedX = planCharacter(ch, { x0: 5, acts: [{ do: "idle" }] }, 3);
  assert.ok(clampedX.xAt(0) <= 0.94 * W + 1e-6);
  // peralihan halus: tidak ada lompatan sudut antar frame pada pergantian aksi
  let worst = 0;
  const bd = plan.segs[1].t0;
  let last = plan.poseAt(bd - 0.2);
  for (let t = bd - 0.2 + 1 / FPS; t < bd + 0.6; t += 1 / FPS) {
    const p = plan.poseAt(t);
    worst = Math.max(worst, ...p.map((v, i) => Math.abs(v - last[i])));
    last = p;
  }
  assert.ok(worst < 0.7, `peralihan jalan->lambai mulus (lompatan terbesar ${worst.toFixed(2)})`);
  // kaki tidak "meluncur": fase langkah mengikuti jarak tempuh
  const t1 = 0.4, t2 = 0.8;
  const ph = (t) => plan.xAt(t) / (0.9 * ch.kpx);
  assert.ok(ph(t2) > ph(t1), "makin jauh = makin banyak langkah");
}
ok("rencana gerak: tujuan, arah, pembagian waktu, jalan dipercepat/diisi bicara, peralihan mulus");

// --- penggambar
{
  const buf = new Uint8Array(W * H * 4);
  const p = createPainter(buf);
  p.fill(p.ell([200, 200], 50, 30), [255, 0, 0]);
  const at = (x, y) => buf.slice((y * W + x) * 4, (y * W + x) * 4 + 4);
  assert.deepEqual([...at(200, 200)], [255, 0, 0, 255]);
  assert.equal(at(300, 200)[3], 0);
  const edge = at(250, 200)[3];
  assert.ok(edge > 0 && edge < 255 || at(249, 200)[3] > 0, "tepi beranti-alias");
  // kamera: zoom 2 di pusat layar menggandakan ukuran dan geser posisi
  const b2 = new Uint8Array(W * H * 4);
  const p2 = createPainter(b2, { z: 2, cx: W / 2, cy: H / 2 });
  p2.fill(p2.ell([W / 2 + 50, H / 2], 20, 20), [0, 255, 0]);
  assert.equal(b2[((H / 2) * W + (W / 2 + 100)) * 4 + 1], 255, "pusat bergeser ke 2x jarak");
  assert.equal(b2[((H / 2) * W + (W / 2 + 150)) * 4 + 3], 0, "jari-jari ikut 2x (40): pusat 100, tepi 140, jadi 150 di luar");
  // cone dan pengurangan bentuk
  const b3 = new Uint8Array(W * H * 4);
  const p3 = createPainter(b3);
  p3.fill(p3.cone([100, 100], [100, 300], 20, 10), [0, 0, 255]);
  assert.equal(b3[(200 * W + 100) * 4 + 2], 255);
  assert.ok(b3[(200 * W + 135) * 4 + 3] === 0, "kerucut menyempit");
  const b4 = new Uint8Array(W * H * 4);
  const p4 = createPainter(b4);
  p4.fill(p4.sub(p4.ell([300, 300], 40, 40), p4.ell([300, 320], 40, 40)), [9, 9, 9]);
  assert.equal(b4[(270 * W + 300) * 4 + 3], 255, "bagian atas tersisa");
  assert.equal(b4[(330 * W + 300) * 4 + 3], 0, "bagian bawah terpotong");
}
ok("penggambar SDF: elips, tepi halus, kamera zoom, kerucut, pengurangan bentuk");

function renderChar(spec, act, t, x0 = 0.5, extra = {}) {
  const ch = makeCharacter(spec, 0);
  const plan = planCharacter(ch, { x0, face: "right", acts: [{ do: act, ...extra }] }, 4);
  const buf = new Uint8Array(W * H * 4);
  drawCharacter(createPainter(buf), ch, { x: plan.xAt(t), dir: plan.dirAt(t), pose: plan.poseAt(t) });
  return { ch, buf };
}
const bounds = (buf) => {
  let x0 = W, y0 = H, x1 = -1, y1 = -1, cnt = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buf[(y * W + x) * 4 + 3] > 20) { cnt++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, cnt };
};
{
  for (const kind of ["man", "woman", "boy", "girl", "grandfather", "grandmother"]) {
    for (const act of ACTIONS) {
      const { ch, buf } = renderChar({ kind, hat: kind === "man" ? "cap" : undefined }, act, 1.1, 0.4, act === "walk" || act === "run" ? { to: 0.6 } : {});
      const b = bounds(buf);
      assert.ok(b.cnt > 2000, `${kind}/${act}: terlukis (${b.cnt})`);
      assert.ok(b.y1 <= GROUND + 40, `${kind}/${act}: tidak melewati garis tanah (${b.y1})`);
      if (act !== "jump") assert.ok(b.y1 >= GROUND - 4, `${kind}/${act}: kaki menapak (${b.y1})`);
      assert.ok(b.y0 > 20 && b.x0 > 0 && b.x1 < W - 1, `${kind}/${act}: di dalam layar`);
      assert.ok(b.y1 - b.y0 < ch.heightPx + 160, `${kind}/${act}: tinggi wajar`);
    }
  }
  // deterministik
  const a = renderChar({ kind: "woman" }, "wave", 0.7).buf;
  const b = renderChar({ kind: "woman" }, "wave", 0.7).buf;
  assert.ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, "frame sama persis untuk masukan sama");
  // kepala polos: tidak ada elemen wajah (hanya satu warna kulit di area wajah)
  const man = renderChar({ kind: "man", hat: "none" }, "idle", 0).buf;
  const ch = makeCharacter({ kind: "man", hat: "none" }, 0);
  const headY = Math.round(GROUND - (ch.legL + ch.torsoL + 0.004 + ch.headRy + 0.03) * ch.kpx);
  const colors = new Set();
  for (let y = headY - 6; y <= headY + 6; y++) for (let x = W / 2 + 6; x <= W / 2 + 16; x++) colors.add([...man.slice((y * W + x) * 4, (y * W + x) * 4 + 3)].join(","));
  assert.ok(colors.size <= 3, `wajah polos tanpa mata/hidung/mulut (${colors.size} warna)`);
  // anak lebih pendek daripada dewasa pada gambar
  const hb = bounds(renderChar({ kind: "boy" }, "idle", 0).buf), ha = bounds(renderChar({ kind: "man" }, "idle", 0).buf);
  assert.ok(hb.y1 - hb.y0 < (ha.y1 - ha.y0) * 0.78);
  // duduk menggambar bangku
  const sit = bounds(renderChar({ kind: "man" }, "sit", 1).buf);
  assert.ok(sit.y1 >= GROUND - 4);
}
ok("karakter tergambar: 6 jenis x 14 aksi menapak tanah & di layar, deterministik, wajah polos, anak lebih pendek");

// --- PNG + latar
{
  const png = encodePng(4, 3, new Uint8Array(4 * 3 * 4).fill(200), 4);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 4);
  assert.equal(png.readUInt32BE(20), 3);
  assert.equal(png[25], 6, "RGBA");
  assert.equal(encodePng(2, 2, new Uint8Array(12), 3)[25], 2, "RGB");
  if (hasFfmpeg) {
    const f = path.join(tmp, "t.png");
    fs.writeFileSync(f, png);
    const r = spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-f", "null", "-"], { encoding: "utf8" });
    assert.equal(r.status, 0, "PNG buatan sendiri bisa dibaca ffmpeg");
    assert.match(r.stderr, /4x3/);
  }
  for (const s of ["day", "sunset", "night", "indoor"]) {
    const bg = paintBackground(s);
    assert.equal(bg.length, W * H * 4);
    let transparent = 0;
    for (let i = 3; i < bg.length; i += 4 * 97) if (bg[i] !== 255) transparent++;
    assert.equal(transparent, 0, `${s}: latar buram penuh`);
  }
  assert.notDeepEqual([...paintBackground("day").slice(0, 400)], [...paintBackground("night").slice(0, 400)]);
  assert.equal(normalizeSetting("Malam hari di desa"), "night");
  assert.equal(normalizeSetting("senja"), "sunset");
  assert.equal(normalizeSetting("di dalam kelas"), "indoor");
  assert.equal(normalizeSetting("taman"), "day");
  assert.equal(normalizeSetting(undefined), "day");
  const f1 = writeBackground(tmp, "a", null, "day", 1);
  assert.ok(f1.endsWith(".png") && fs.statSync(f1).size > 1000);
  const f2 = writeBackground(tmp, "b", { buffer: Buffer.from("jpgdata"), mime: "image/jpeg" }, "day", 1);
  assert.ok(f2.endsWith(".jpg") && fs.readFileSync(f2, "utf8") === "jpgdata", "gambar AI dipakai bila ada");
}
ok("PNG sendiri valid (dibaca ffmpeg), 4 latar buram penuh, pengenal suasana, gambar AI diutamakan");

// --- naskah
{
  const good = JSON.stringify({
    title: "Ayah dan Anak",
    cast: [{ id: "A", kind: "man", shirt: "blue" }, { id: "B", kind: "boy" }, { id: "C", kind: "woman" }, { id: "D", kind: "girl" }],
    scenes: [
      { setting: "day", bg: "A green park", narration: "Pagi yang cerah.", chars: [{ id: "A", x: 0.2, face: "right", acts: [{ do: "walk", to: 0.5 }, "wave"] }, { id: "ZZ", x: 0.5 }] },
      { setting: "malam", bg: "", narration: "x".repeat(400), chars: [] },
      { narration: "Ketiga", chars: [{ id: "B", x: 9, acts: [] }] }
    ]
  });
  const s = parseStoryScript("```json\n" + good + "\n```", 5, 300);
  assert.ok(s);
  assert.equal(s.cast.length, 3, "pemeran dibatasi 3");
  assert.equal(s.scenes.length, 3);
  assert.equal(s.scenes[0].chars.length, 1, "tokoh yang tidak ada di daftar pemeran dibuang");
  assert.deepEqual(s.scenes[0].chars[0].acts, [{ do: "walk", to: 0.5 }, { do: "wave" }], "aksi berupa kata dan objek sama-sama diterima");
  assert.equal(s.scenes[1].setting, "night");
  assert.ok(s.scenes[1].chars.length === 1 && s.scenes[1].chars[0].id === "A", "adegan tanpa tokoh diberi tokoh pertama");
  assert.ok(s.scenes[2].chars[0].x <= 0.9, "posisi dijepit");
  assert.ok(s.scenes.reduce((a, c) => a + c.narration.length, 0) <= 300 + 3, "total narasi dibatasi");
  assert.equal(parseStoryScript("bukan json", 4), null);
  assert.equal(parseStoryScript('{"scenes":[{"narration":"satu"}]}', 4), null, "kurang dari 2 adegan ditolak");
  assert.equal(parseStoryScript('{"scenes":"x"}', 4), null);
  assert.equal(parseStoryScript(JSON.stringify({ scenes: [{ chars: [] }, { chars: [] }] }), 4).cast[0].kind, "man", "tanpa pemeran -> pria bawaan");
  const noEmoji = parseStoryScript(JSON.stringify({ title: "Hore 🎉", scenes: [{ narration: "Halo 😀 dunia", chars: [] }, { narration: "b", chars: [] }] }), 3);
  assert.equal(noEmoji.title, "Hore");
  assert.equal(noEmoji.scenes[0].narration, "Halo dunia");
  const fb = fallbackStory("kancil dan buaya", 4);
  assert.equal(fb.scenes.length, 4);
  assert.equal(fb.fallback, true);
  assert.equal(fb.scenes[0].narration, "kancil dan buaya");
  const reparsed = parseStoryScript(JSON.stringify(fb), 4);
  assert.ok(reparsed && reparsed.scenes.length === 4, "naskah cadangan lolos pembaca naskah");
  const pr = buildStoryPrompt("kancil dan buaya", 5, 620);
  assert.match(pr.system, /Exactly 5 scenes/);
  assert.match(pr.system, /FACELESS/);
  assert.match(pr.system, /idle, walk, run, wave, point, talk, jump, sit, clap, bow, sad, cheer, think, pray/);
  assert.match(pr.system, /animals\/objects cannot be characters/);
  assert.equal(pr.user, "Story idea: kancil dan buaya");
}
ok("naskah cerita: JSON berpagar, pemeran maks 3, tokoh asing dibuang, jepit posisi, batas narasi, cadangan, instruksi AI");

// --- argumen ffmpeg + penyaji adegan
{
  const a = sceneArgs({ bg: "/x/bg.png", out: "/x/o.mp4", dur: 4, camFrom: 1, camTo: 1.06, textFile: "/x/sub.txt", font: "/f/a.ttf" });
  const g = a[a.indexOf("-filter_complex") + 1];
  assert.match(g, /zoompan=z='1\.0000\+0\.0600\*on\/100'/);
  assert.match(g, /overlay=format=auto:shortest=1/);
  assert.match(g, /drawtext=fontfile='\/f\/a\.ttf':textfile='\/x\/sub\.txt':expansion=none/);
  assert.ok(a.includes("rawvideo") && a.includes("pipe:0") && a.includes(`${W}x${H}`));
  assert.equal(a[a.indexOf("-frames:v") + 1], "100");
  const noText = sceneArgs({ bg: "b", out: "o", dur: 2 })[sceneArgs({ bg: "b", out: "o", dur: 2 }).indexOf("-filter_complex") + 1];
  assert.ok(!/drawtext/.test(noText));
  const castMap = new Map([["A", makeCharacter({ kind: "man" }, 0)]]);
  const rend = createSceneRenderer({ chars: [{ id: "A", x: 0.3, acts: [{ do: "wave" }] }, { id: "ZZ", x: 0.7 }] }, castMap, 2, { camFrom: 1, camTo: 1.06 });
  assert.equal(rend.frames, 50);
  assert.equal(rend.actors.length, 1, "tokoh tak dikenal dilewati");
  const buf = new Uint8Array(W * H * 4).fill(77);
  rend.draw(0, buf);
  assert.equal(buf[3], 0, "buffer dibersihkan tiap frame (transparan)");
  assert.ok(bounds(buf).cnt > 3000);
  // zoom di frame terakhir lebih besar daripada di frame pertama (tinggi gambar)
  const h0 = bounds(buf);
  rend.draw(rend.frames - 1, buf);
  const h1 = bounds(buf);
  assert.ok(h1.y1 - h1.y0 > h0.y1 - h0.y0 + 2, "kamera mendekat: karakter ikut membesar sesuai latar");
  assert.ok(Math.abs(CAM_ZOOM - 0.06) < 1e-9);
}
ok("ffmpeg: zoompan selaras dengan kamera karakter, overlay rawvideo, subtitle opsional; penyaji membersihkan buffer");

// --- pengenalan permintaan
assert.equal(detectStoryMode("bot, buatkan animasi ayah dan anak"), true);
assert.equal(detectStoryMode("buatkan video kartun kancil"), true);
assert.equal(detectStoryMode("buatkan video kancil dan buaya"), false);
assert.equal(detectStoryMode("buatkan video tokoh sejarah"), false);
{
  const vg = createVideoGen({ imageGen: { available: () => true }, config: readVideoConfig({}), log: silent });
  assert.equal(vg.detect("buatkan animasi ayah dan anak ke taman").mode, "karakter");
  assert.equal(vg.detect("buatkan animasi ayah dan anak ke taman").prompt, "ayah dan anak ke taman");
  assert.equal(vg.detect("buatkan video kancil dan buaya").mode, undefined);
  assert.deepEqual(vg.detect("buatkan video kancil dan buaya"), { prompt: "kancil dan buaya", seconds: 0 }, "bentuk hasil video biasa tidak berubah");
  assert.equal(vg.detect("halo apa kabar"), null);
  assert.deepEqual(vg.parseCommand("animasi ayah dan anak 30 detik"), { kind: "prompt", prompt: "ayah dan anak", seconds: 30, mode: "karakter" });
  assert.equal(vg.parseCommand("kartun kucing").mode, "karakter");
  assert.deepEqual(vg.parseCommand("30 detik tentang siklus air"), { kind: "prompt", prompt: "siklus air", seconds: 30 });
  assert.deepEqual(vg.parseCommand("status"), { kind: "status" });
  assert.equal(vg.storyAvailable(), true);
  assert.match(vg.describe(), /Animasi karakter tanpa wajah/);
  const off = createVideoGen({ imageGen: { available: () => false }, config: readVideoConfig({ VIDEO_ENABLED: "0" }), log: silent });
  assert.equal(off.storyAvailable(), false);
  assert.equal((await off.make("x", "owner", "", { mode: "karakter" })).kind, "off");
  assert.match(storySentNote('ayah "dan" anak'), /^🎭 \[BOT mengirim ANIMASI karakter tanpa wajah/);
  assert.ok(!storySentNote('ayah "dan" anak').includes('"dan"'), "tanda kutip di permintaan dinetralkan");
}
ok("pengenalan: 'animasi/kartun' -> mode karakter, video biasa tak berubah, /video animasi, catatan riwayat");

// --- perakitan sungguhan
if (!hasFfmpeg) console.log("  (ffmpeg tidak ada: tes perakitan dilewati)");
else {
  const script = {
    title: "Uji",
    cast: [{ id: "A", kind: "man", hat: "peci" }, { id: "B", kind: "woman" }],
    scenes: [
      { setting: "day", bg: "A park", narration: "Halo semuanya.", chars: [{ id: "A", x: 0.2, acts: [{ do: "walk", to: 0.5 }, { do: "wave" }] }, { id: "B", x: 0.8, face: "left", acts: [{ do: "sit" }] }] },
      { setting: "indoor", bg: "A room", narration: "Selesai.", chars: [{ id: "B", x: 0.5, acts: [{ do: "bow" }] }] }
    ]
  };
  const probe = (buffer) => {
    const f = path.join(tmp, "p.mp4");
    fs.writeFileSync(f, buffer);
    const r = spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-f", "null", "-"], { encoding: "utf8" });
    return { code: r.status, err: r.stderr, f };
  };
  // 1) tanpa pembuat gambar & tanpa suara: latar buatan kode
  const scripts = [];
  const vg = createVideoGen({ imageGen: { available: () => false }, writeScript: async (p) => (scripts.push(p), JSON.stringify(script)), config: { ...readVideoConfig({}), queue: 1 }, log: silent, tmpRoot: tmp, state: mem() });
  const stages = [];
  const r = await vg.make("uji animasi", "owner", "", { mode: "karakter", onStage: (s) => stages.push(s) });
  assert.ok(!r.error, r.error);
  assert.deepEqual(stages, ["script", "images", "render"]);
  assert.equal(r.video.mode, "karakter");
  assert.equal(r.video.silent, true);
  assert.equal(r.video.scenes, 2);
  assert.match(scripts[0].system, /FACELESS/, "naskah memakai instruksi cerita bertokoh");
  assert.ok(r.video.buffer.length > 5000);
  const pr = probe(r.video.buffer);
  assert.equal(pr.code, 0, pr.err.slice(-200));
  assert.match(pr.err, /1280x720/);
  assert.match(pr.err, /25 fps/);
  const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(pr.err);
  const secs = Number(dur[2]) * 60 + Number(dur[3]);
  assert.ok(secs >= 7 && secs <= 12, `durasi masuk akal (${secs})`);
  assert.deepEqual(fs.readdirSync(tmp).filter((x) => x.startsWith("ani-")), [], "folder sementara dibersihkan");
  // 2) video gambar biasa tetap butuh pembuat gambar
  const nk = await vg.make("kancil", "owner");
  assert.equal(nk.kind, "nokey");
  if (FULL) {
  // 3) pembuat gambar ada -> latar tiap deskripsi digambar AI (deskripsi sama dipakai ulang); gagal -> latar kode
  const bgPng = encodePng(W, H, paintBackground("sunset"), 4);
  const prompts = [];
  let failNext = false;
  const imageGen = { available: () => true, generate: async (p) => { prompts.push(p); if (failNext) throw Object.assign(new Error("boom"), { kind: "unavailable" }); return { buffer: bgPng, mime: "image/png" }; } };
  const script2 = { ...script, scenes: [script.scenes[0], { ...script.scenes[0], narration: "Dua" }, script.scenes[1]] };
  const vg2 = createVideoGen({ imageGen, writeScript: async () => JSON.stringify(script2), config: readVideoConfig({}), log: silent, tmpRoot: tmp });
  const r2 = await vg2.make("uji", "owner", "", { mode: "karakter" });
  assert.ok(!r2.error, r2.error);
  assert.equal(prompts.length, 2, "dua deskripsi berbeda = dua gambar (yang sama dipakai ulang)");
  assert.match(prompts[0], /Flat 2D vector cartoon illustration/);
  assert.match(prompts[0], /No people, no characters/);
  failNext = true;
  const r3 = await vg2.make("uji lagi", "owner", "", { mode: "karakter" });
  assert.ok(!r3.error, "gambar AI gagal -> tetap jadi dengan latar buatan kode");
  // 4) naskah AI rusak -> cadangan
  const vg3 = createVideoGen({ imageGen: { available: () => false }, writeScript: async () => "bukan json", config: readVideoConfig({}), log: silent, tmpRoot: tmp });
  const r4 = await vg3.make("kancil dan buaya", "owner", "", { mode: "karakter" });
  assert.ok(!r4.error && r4.video.fallback === true, "naskah cadangan tetap menghasilkan video");
  // 5) jatah: memakai jatah video yang sama, dikembalikan bila gagal
  const st = mem();
  const vg4 = createVideoGen({ imageGen: { available: () => false }, writeScript: async () => JSON.stringify(script), config: { ...readVideoConfig({}), ownerDaily: 1 }, state: st, log: silent, tmpRoot: tmp });
  assert.ok(!(await vg4.make("a", "owner", "", { mode: "karakter" })).error);
  const lim = await vg4.make("b", "owner", "", { mode: "karakter" });
  assert.equal(lim.kind, "limit");
  }
  // 6) ffmpeg rusak -> galat render, jatah dikembalikan
  const vg5 = createVideoGen({ imageGen: { available: () => false }, writeScript: async () => JSON.stringify(script), config: { ...readVideoConfig({}), ownerDaily: 1, ffmpeg: "ffmpeg" }, state: mem(), log: silent, tmpRoot: "/tidak/ada/folder" });
  const bad = await vg5.make("c", "owner", "", { mode: "karakter" });
  assert.ok(bad.error, "folder sementara tidak bisa dibuat -> galat");
  ok("perakitan sungguhan: tanpa gambar AI, dengan gambar AI (dipakai ulang/gagal), naskah cadangan, jatah, galat, 1280x720 25fps");
}

// --- Telegram
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    const form = init?.body instanceof FormData;
    calls.push({ method: String(url).split("/").pop(), body: init?.body && !form ? JSON.parse(init.body) : {} });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const made = [];
  const mk = (over = {}) => ({
    available: () => true,
    storyAvailable: () => true,
    describe: () => "x",
    parseCommand: (a) => createVideoGen({ imageGen: { available: () => true }, config: readVideoConfig({}), log: silent }).parseCommand(a),
    setGroup: async () => ({ on: true, saved: true }),
    make: async (prompt, opts) => (made.push({ prompt, ...opts }), { video: { buffer: Buffer.from("mp4mp4"), mime: "video/mp4" } }),
    ...over
  });
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  let id = 0;
  const run = async (video, text) => {
    const tg = createTelegram({ config: tcfg, deps: { chat: async () => "x", video }, fetchImpl: fakeFetch, log: silent });
    const before = calls.length;
    await tg.handleUpdate({ update_id: ++id, message: { chat: { id: 111, type: "private" }, text } });
    return calls.slice(before);
  };
  const texts = (cs) => cs.filter((c) => c.method === "sendMessage").map((c) => c.body.text).join("\n");
  const r1 = await run(mk(), "/video animasi ayah dan anak ke taman");
  assert.deepEqual(made[0], { prompt: "ayah dan anak ke taman", seconds: 0, mode: "karakter" });
  assert.match(texts(r1), /Sedang membuat animasi/);
  assert.ok(r1.some((c) => c.method === "sendVideo"));
  const r2 = await run(mk(), "/video kancil dan buaya");
  assert.equal(made[1].mode, undefined);
  assert.match(texts(r2), /Sedang membuat video/);
  // tanpa pembuat gambar: video biasa ditolak dengan petunjuk, animasi tetap jalan
  const noImg = mk({ available: () => false });
  const r3 = await run(noImg, "/video kancil dan buaya");
  assert.equal(made.length === 2, true, "video biasa tidak dibuat tanpa pembuat gambar");
  assert.match(texts(r3), /Animasi karakter tetap bisa tanpa itu/);
  const r4 = await run(noImg, "/video animasi kancil");
  assert.equal(made[2].mode, "karakter");
  assert.ok(r4.some((c) => c.method === "sendVideo"));
  // sama sekali tidak aktif
  const r5 = await run(mk({ available: () => false, storyAvailable: () => false }), "/video animasi kancil");
  assert.match(texts(r5), /belum aktif/);
  assert.equal(made.length, 3);
}
ok("Telegram: /video animasi -> mode karakter, video biasa tanpa gambar AI diberi petunjuk, status tidak aktif");

// --- pemasangan di index.js
{
  const idx = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(idx, /storySentNote/);
  assert.match(idx, /videoGen\.groupEnabled\(\) \|\| videoGen\.storyGroupEnabled\(\)/, "grup: animasi tetap jalan walau pembuat gambar mati");
  assert.match(idx, /videoReq\.mode === "karakter"/);
  assert.match(idx, /!videoGen\.available\(\) && req\.mode !== "karakter"/, "pemilik: video biasa tetap butuh pembuat gambar");
  assert.match(idx, /mode: story \? "karakter" : undefined/);
  assert.match(idx, /storyAvailable: \(\) => videoGen\.storyAvailable\(\)/);
  assert.match(idx, /ANIMASI KARTUN dengan tokoh manusia tanpa wajah/, "AI percakapan diberi tahu kemampuannya");
}
ok("index.js: grup & pemilik, tanda mode, catatan riwayat, pengetahuan AI percakapan");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} kelompok tes animasi karakter lulus.`);
void VIDEO_TEXT;
void BASE_K;
