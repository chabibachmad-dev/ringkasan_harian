// Tes perakit video papan tulis (edu-board.js): tata letak, filter, dan render NYATA dengan ffmpeg (suara hening).
//   node test-edu-board.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createBoardRenderer, renderThumbnail, flattenPlan, layoutBeats, silentWav, wavSeconds, beatSeconds, chapterText, findFonts, W, H } from "./edu-board.js";
import { buildMathPlan, buildSainsPlan } from "./edu-bank.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// ---- WAV
const w = silentWav(2);
check(Math.abs(wavSeconds(w) - 2) < 0.01 && wavSeconds(Buffer.from("bukan wav")) === 0, "wavSeconds membaca durasi, 0 untuk data rusak");
check(beatSeconds(0) === 2.2 && beatSeconds(5, 0) > 5 && beatSeconds(5, 7) > beatSeconds(5, 0), "beatSeconds: minimal 2,2 dtk; jeda berpikir lebih panjang");

// ---- rencana → beat → tata letak
const plan = buildMathPlan({ gen: "addStack", grade: 2, seed: 11, practice: 1 });
const beats = flattenPlan(plan);
check(beats.length >= 5 && beats[0].section === "Pembukaan" && beats.at(-1).section === "Penutup", "flattenPlan: pembukaan … penutup");
check(flattenPlan(plan, { dropParts: [1] }).length < beats.length, "dropParts membuang bagian latihan");
const { frames } = layoutBeats(beats);
check(frames.length === beats.length && frames.every((f) => f.every((l) => l.y >= 0 && l.y < H)), "tiap baris papan berada di dalam bingkai");

// ---- render nyata
const ff = spawnSync("ffmpeg", ["-version"]);
const fonts = findFonts();
if (ff.status !== 0 || !fonts.bold) {
  console.log("lewati render nyata: ffmpeg atau font tidak ada");
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eduboard-"));
  const renderer = createBoardRenderer({ channelName: "Belajar Bareng", log: { log() {}, error() {} } });
  for (const [name, p] of [["matematika", plan], ["sains", buildSainsPlan(JSON.parse(fs.readFileSync(new URL("./data/edu-sains.json", import.meta.url), "utf8"))[0])]]) {
    const bs = flattenPlan(p);
    const wavs = bs.map(() => silentWav(1.2));
    const out = path.join(dir, `${name}.mp4`);
    const r = await renderer.render({ beats: bs, wavs, outFile: out, tmpDir: path.join(dir, `tmp-${name}`) });
    const pr = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration", "-of", "json", out], { encoding: "utf8" });
    const j = JSON.parse(pr.stdout || "{}");
    const v = (j.streams || []).find((s) => s.codec_type === "video");
    const a = (j.streams || []).find((s) => s.codec_type === "audio");
    check(v && a && v.width === W && v.height === H, `${name}: video ${W}x${H} berisi gambar dan suara`);
    check(fs.statSync(out).size > 20_000, `${name}: ukuran wajar (${Math.round(fs.statSync(out).size / 1024)} KB)`);
    const real = Number(v?.duration);
    check(Math.abs(real - r.seconds) < 1.5, `${name}: durasi nyata ${real.toFixed(1)} dtk ≈ perhitungan ${r.seconds.toFixed(1)} dtk`);
    check(r.timeline.length === bs.length, `${name}: linimasa per adegan`);
  }
  const thumb = path.join(dir, "t.png");
  await renderThumbnail({ kelas: "Kelas 2 SD", title: "Penjumlahan Bersusun dua angka", outFile: thumb, tmpDir: path.join(dir, "tt"), channelName: "Belajar Bareng" });
  check(fs.existsSync(thumb) && fs.statSync(thumb).size > 3000, "sampul PNG dibuat");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- bab
const tl = [
  { section: "Pembukaan", firstOfSection: true, start: 0, dur: 12 },
  { section: "Contoh soal", firstOfSection: true, start: 12, dur: 30 },
  { section: "Contoh soal", firstOfSection: false, start: 42, dur: 10 },
  { section: "Latihan", firstOfSection: true, start: 52, dur: 25 },
  { section: "Penutup", firstOfSection: true, start: 77, dur: 11 }
];
const ch = chapterText(tl);
check(ch.startsWith("0:00 Pembukaan") && /0:12 Contoh soal/.test(ch) && /0:52 Latihan/.test(ch), "chapterText benar");
check(chapterText([{ section: "A", firstOfSection: true, start: 0, dur: 5 }, { section: "B", firstOfSection: true, start: 5, dur: 5 }]) === "", "bab terlalu sedikit/pendek → tanpa bab");

console.log(fails ? `\n${fails} GAGAL` : "\nSemua tes papan tulis lolos.");
process.exit(fails ? 1 : 0);
