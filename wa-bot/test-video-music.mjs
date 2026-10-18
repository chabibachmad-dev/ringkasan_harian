// Tes musik latar video. Jalankan: node test-video-music.mjs  (render sungguhan butuh ffmpeg; ditambah VIDEO_TEST_FULL=1 untuk uji lewat createVideoGen)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MUSIC_EXTS, createMusic, listTracks, mixArgs, parseMusicRequest, pickTrack, queryTags, synthArgs, synthExpr, synthStyleFor } from "./video-music.js";
import { createVideoGen, readVideoConfig } from "./video-gen.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

// --- membaca permintaan
{
  const a = parseMusicRequest("jadikan video dengan salju pakai musik dj");
  assert.equal(a.on, true);
  assert.equal(a.query, "dj");
  assert.equal(a.text, "jadikan video dengan salju");
  assert.equal(parseMusicRequest("buat video pakai musik jedag jedug 10 detik").query, "jedag jedug");
  assert.equal(parseMusicRequest("buat video pakai musik jedag jedug 10 detik").text, "buat video 10 detik");
  const b = parseMusicRequest('stop motion 10 fps pakai musik tulisan "Liburan"');
  assert.equal(b.on, true);
  assert.equal(b.query, "", "berhenti di kata 'tulisan'");
  assert.equal(b.text, 'stop motion 10 fps tulisan "Liburan"');
  assert.equal(parseMusicRequest("morf siang jadi malam, pakai musik tenang").query, "tenang");
  assert.equal(parseMusicRequest("video kancil dengan musik").on, true);
  assert.equal(parseMusicRequest("video kancil dengan musik").query, "");
  assert.equal(parseMusicRequest("video kancil + musik ceria").query, "ceria");
  const off = parseMusicRequest("buat video kancil tanpa musik");
  assert.equal(off.off, true);
  assert.equal(off.on, false);
  assert.equal(off.text, "buat video kancil");
  // bukan permintaan musik
  for (const t of ["buat video tentang musik gamelan", "video konser musik rock", "lagu apa ini", "buat video kancil"]) {
    const r = parseMusicRequest(t);
    assert.equal(r.on, false, t);
    assert.equal(r.text, t);
  }
  assert.equal(parseMusicRequest("").on, false);
  assert.equal(parseMusicRequest(null).text, "");
}
ok("membaca permintaan: pakai/dengan/+ musik, kata kunci maks 3 kata, berhenti di tulisan/angka, 'tanpa musik', bukan permintaan");

// --- kata kunci & pemilihan lagu
{
  assert.ok(queryTags("jedag jedug").includes("dj"));
  assert.ok(queryTags("EDM").includes("dugem"));
  assert.ok(queryTags("lofi").includes("tenang"));
  assert.deepEqual(queryTags(""), []);
  assert.equal(synthStyleFor("jedag jedug"), "dj");
  assert.equal(synthStyleFor(""), "dj");
  assert.equal(synthStyleFor("santai"), "tenang");
  assert.equal(synthStyleFor("sedih"), "tenang");
  const mk = (name) => ({ file: "/m/" + name, name, label: name, search: ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ")} ` });
  const tracks = [mk("dj/Party Night.mp3"), mk("dj/Bass Drop.mp3"), mk("tenang/Piano Pagi.mp3"), mk("Lagu Biasa.mp3")];
  const r1 = pickTrack(tracks, "jedag jedug", () => 0);
  assert.equal(r1.matched, true);
  assert.match(r1.track.name, /^dj\//);
  assert.match(pickTrack(tracks, "tenang", () => 0.99).track.name, /tenang/);
  const r3 = pickTrack(tracks, "gamelan", () => 0.5);
  assert.equal(r3.matched, false, "tak ada yang cocok -> acak dari semua");
  assert.ok(tracks.includes(r3.track));
  assert.equal(pickTrack([], "dj"), null);
  assert.equal(pickTrack(tracks, "", () => 0).matched, false);
}
ok("kata kunci dan padanan (jedag jedug = dj), pilih lagu yang cocok, acak bila tak cocok / tanpa kata kunci");

// --- memindai folder
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musik-tes-"));
  fs.mkdirSync(path.join(dir, "dj"));
  fs.mkdirSync(path.join(dir, "tenang"));
  fs.writeFileSync(path.join(dir, "a.mp3"), "x");
  fs.writeFileSync(path.join(dir, "catatan.txt"), "x");
  fs.writeFileSync(path.join(dir, ".tersembunyi.mp3"), "x");
  fs.writeFileSync(path.join(dir, "dj", "Lagu Satu.WAV"), "x");
  fs.writeFileSync(path.join(dir, "tenang", "piano.m4a"), "x");
  const list = listTracks(dir);
  assert.deepEqual(list.map((t) => t.name), ["a.mp3", "dj/Lagu Satu.WAV", "tenang/piano.m4a"]);
  assert.ok(list[1].search.includes(" dj "), "nama subfolder ikut dicari");
  assert.deepEqual(listTracks(path.join(dir, "tidak-ada")), []);
  assert.ok(MUSIC_EXTS.includes(".mp3"));
  fs.rmSync(dir, { recursive: true, force: true });
}
ok("memindai folder: subfolder satu tingkat, abaikan berkas tersembunyi/bukan musik, folder hilang -> kosong");

// --- argumen ffmpeg
{
  const dj = synthExpr("dj");
  assert.match(dj, /exp\(-28\*mod\(t,0\.468750\)\)/, "kick 128 bpm");
  assert.ok(!/[\n"]/.test(dj));
  const args = synthArgs("dj", 5.2, "/tmp/b.wav");
  assert.ok(args.some((a) => a.startsWith("aevalsrc=exprs='") && a.endsWith(":d=7")), "durasi dibulatkan + 1 detik");
  const sil = mixArgs({ video: "v.mp4", music: "m.mp3", out: "o.mp4", seconds: 10, hasAudio: false, volume: 0.6 }).join(" ");
  assert.match(sil, /-stream_loop -1 -i m\.mp3/);
  assert.match(sil, /afade=t=out:st=8\.50:d=1\.5/);
  assert.match(sil, /volume=0\.600/);
  assert.ok(!/sidechaincompress/.test(sil));
  assert.match(sil, /-c:v copy/);
  const nar = mixArgs({ video: "v.mp4", music: "m.mp3", out: "o.mp4", seconds: 10, hasAudio: true, volume: 0.6 }).join(" ");
  assert.match(nar, /sidechaincompress/, "narasi: musik mengalah");
  assert.match(nar, /volume=0\.270/);
  assert.match(nar, /amix=inputs=2:duration=first/);
}
ok("argumen ffmpeg: ketukan buatan, tempel musik (video disalin), narasi memicu pengecilan musik");

// --- render sungguhan
if (hasFfmpeg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musik-render-"));
  const run = (args) => assert.equal(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]).status, 0);
  run(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "bisu.mp4")]);
  run(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=4", "-f", "lavfi", "-i", "sine=frequency=500:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, "narasi.mp4")]);
  const musikDir = path.join(dir, "musik");
  fs.mkdirSync(path.join(musikDir, "dj"), { recursive: true });
  run(["-f", "lavfi", "-i", "sine=frequency=330:duration=1", path.join(musikDir, "dj", "Tes Beat.wav")]); // lebih pendek dari video: harus diulang
  const probe = (f) => spawnSync("ffmpeg", ["-hide_banner", "-i", f], { encoding: "utf8" }).stderr;
  const asFile = (buf, name) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, buf);
    return f;
  };

  const m1 = createMusic({ dir: musikDir, volume: 0.6, tmpRoot: dir, rand: () => 0, log: silent });
  assert.equal(m1.count(), 1);
  const r1 = await m1.add(fs.readFileSync(path.join(dir, "bisu.mp4")), { query: "jedag jedug" });
  assert.equal(r1.source, "berkas");
  assert.equal(r1.label, "Tes Beat");
  assert.equal(r1.matched, true);
  const p1 = probe(asFile(r1.buffer, "hasil1.mp4"));
  assert.match(p1, /Duration: 00:00:04\.0\d/, "panjang video tetap");
  assert.match(p1, /Video: h264/);
  assert.match(p1, /Audio: aac/, "audio ditambahkan");

  const r2 = await m1.add(fs.readFileSync(path.join(dir, "narasi.mp4")), { query: "" });
  assert.equal(r2.narrated, true);
  assert.match(probe(asFile(r2.buffer, "hasil2.mp4")), /Audio: aac/);

  // folder kosong -> ketukan buatan
  const m2 = createMusic({ dir: path.join(dir, "kosong"), tmpRoot: dir, log: silent });
  assert.equal(m2.count(), 0);
  const r3 = await m2.add(fs.readFileSync(path.join(dir, "bisu.mp4")), { query: "dj" });
  assert.equal(r3.source, "buatan");
  assert.match(r3.label, /jedag-jedug/);
  const f3 = asFile(r3.buffer, "hasil3.mp4");
  assert.match(probe(f3), /Audio: aac/);
  const vol = spawnSync("ffmpeg", ["-hide_banner", "-i", f3, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol)?.[1]);
  assert.ok(mean > -40, `ketukan buatan terdengar (rata-rata ${mean} dB)`);
  const r4 = await m2.add(fs.readFileSync(path.join(dir, "bisu.mp4")), { query: "tenang" });
  assert.match(r4.label, /lembut/);

  // berkas video rusak -> galat, folder sementara dibersihkan
  await assert.rejects(() => m2.add(Buffer.from("bukan video"), {}));
  assert.equal(fs.readdirSync(dir).filter((x) => x.startsWith("ayyubi-musik-")).length, 0, "folder sementara dibersihkan");

  // lewat createVideoGen (foto hidup): hanya bila VIDEO_TEST_FULL=1
  if (process.env.VIDEO_TEST_FULL === "1") {
    run(["-f", "lavfi", "-i", "testsrc=size=640x480:rate=1:duration=1", "-frames:v", "1", path.join(dir, "foto.png")]);
    const cfg = { ...readVideoConfig({ VIDEO_MUSIC_DIR: musikDir }), photoOwnerDaily: 0 };
    const vg = createVideoGen({ imageGen: null, config: cfg, log: silent, tmpRoot: dir });
    const out = await vg.makeFromPhoto(fs.readFileSync(path.join(dir, "foto.png")), "dengan salju 5 detik pakai musik dj", "owner", "x");
    assert.ok(!out.error, out.error);
    assert.equal(out.video.music, "Tes Beat");
    assert.match(probe(asFile(out.video.buffer, "foto-hidup.mp4")), /Audio: aac/);
    const out2 = await vg.makeFromPhoto(fs.readFileSync(path.join(dir, "foto.png")), "dengan salju 5 detik tanpa musik", "owner", "x");
    assert.ok(!out2.error, out2.error);
    assert.equal(out2.video.music, undefined);
    assert.doesNotMatch(probe(asFile(out2.video.buffer, "foto-bisu.mp4")), /Audio:/);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  ok("render sungguhan: lagu diulang sepanjang video, narasi dipertahankan, folder kosong -> ketukan buatan, video rusak ditolak & bersih");
} else {
  console.log("  (lewati render: ffmpeg tidak ada)");
}

// --- sambungan di kode
{
  const vg = fs.readFileSync(new URL("./video-gen.js", import.meta.url), "utf8");
  assert.equal((vg.match(/splitMusic\(/g) || []).length, 5, "didefinisikan sekali + dipakai di make, foto hidup, morf, stop motion");
  assert.equal((vg.match(/applyMusic\(/g) || []).length, 5);
  assert.match(vg, /musicInfo: \(\) => music\.info\(\)/);
  const cfg = readVideoConfig({});
  assert.match(cfg.musicDir.replace(/\\/g, "/"), /wa-bot\/musik$/);
  assert.equal(cfg.musicVolume, 0.6);
  assert.equal(cfg.musicDefault, false);
  assert.equal(readVideoConfig({ VIDEO_MUSIC_DEFAULT: "1", VIDEO_MUSIC_VOLUME: "30" }).musicVolume, 0.3);
  const tg = fs.readFileSync(new URL("./telegram.js", import.meta.url), "utf8");
  assert.match(tg, /name === "musik"/);
  assert.match(tg, /command: "musik"/);
  const ix = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(ix, /musicInfo: \(\) => videoGen\.musicInfo\(\)/);
  assert.match(ix, /caption: `🎵 \$\{v\.music\}`/);
}
ok("sambungan: video-gen (4 jalur), konfigurasi, /musik di Telegram, keterangan lagu di WhatsApp");

console.log(`\nSemua ${n} kelompok tes musik latar lulus ✅`);
