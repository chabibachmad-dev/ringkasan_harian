// Perender video: templat -> frame (kanvas Node) -> ffmpeg. Tidak butuh Chromium.
// Struktur video Shorts: [hook ~1,7 dtk] + [templat, diregangkan mengikuti narasi] + [penutup ~2,4 dtk].
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { W, H, THEMES, siapkanFont } from "./engine.js";
import { ambilTemplat } from "./templates/index.js";
import { DUR_HOOK, DUR_OUTRO, gambarHook, gambarOutro, efekHook, efekOutro } from "./shorts.js";
import { sintesisAudio, tulisWav } from "./audio.js";

export function durasiBerkas(berkas, ffprobe = "ffprobe") {
  const r = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", berkas], { encoding: "utf8" });
  const d = parseFloat(r.stdout); return Number.isFinite(d) ? d : 0;
}

/** Hitung rencana waktu: faktor regang k membuat templat cukup panjang untuk narasi. */
export function rencanaWaktu({ durTemplat, durNarasi = 0, withHook = true, withOutro = true }) {
  const h = withHook ? DUR_HOOK : 0, o = withOutro ? DUR_OUTRO : 0;
  const k = durNarasi > 0 ? Math.max(1, (durNarasi + 0.3 + 1.0 - h) / durTemplat) : 1;
  return { k: Math.min(k, 2.2), hook: h, outro: o, total: h + durTemplat * Math.min(k, 2.2) + o };
}

/**
 * Render satu video.
 * @param {object} o  templatId, isi (sudah lolos rapikan), keluar (.mp4), narasi (berkas audio, opsional),
 *                    hook (teks pancingan), teaser (teks "Besok: ..."), kanal, skala (1 = 720x1280, 1.5 = 1080x1920), fps
 */
export async function renderVideo(o) {
  const tpl = ambilTemplat(o.templatId), th = THEMES[tpl.tema];
  const { skala = 1.5, fps = 30, ffmpeg = "ffmpeg", ffprobe = "ffprobe" } = o;
  const canvasLib = await import("@napi-rs/canvas");
  await siapkanFont(canvasLib);
  const spec = tpl.bangun(o.isi || {});
  const durNarasi = o.narasi ? durasiBerkas(o.narasi, ffprobe) : 0;
  const hookTeks = o.hook || null;
  const rw = rencanaWaktu({ durTemplat: spec.durasi, durNarasi, withHook: !!hookTeks, withOutro: o.outro !== false });
  const { k, hook, outro, total } = rw;

  // audio
  const efekAll = [];
  if (hookTeks) efekAll.push(...efekHook(hookTeks));
  for (const e of spec.efek || []) efekAll.push({ ...e, t: hook + e.t * k });
  if (outro) efekAll.push(...efekOutro().map((e) => ({ ...e, t: hook + spec.durasi * k + e.t })));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-"));
  const wav = path.join(tmp, "musik.wav");
  tulisWav(wav, sintesisAudio({ durasi: total, musik: tpl.musik, efek: efekAll }));

  const pw = Math.round(W * skala), ph = Math.round(H * skala);
  const sementara = o.keluar.replace(/\.mp4$/i, "") + ".part.mp4";
  const args = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${pw}x${ph}`, "-r", String(fps), "-i", "-", "-i", wav];
  let filter;
  if (o.narasi) {
    args.push("-i", o.narasi);
    filter = "[2:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=300|300,volume=1.5,asplit=2[n1][n2];" +
      "[1:a][n1]sidechaincompress=threshold=0.03:ratio=9:attack=15:release=400[md];" +
      "[md][n2]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]";
  } else filter = "[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]";
  args.push("-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "160k", "-t", total.toFixed(3), "-movflags", "+faststart", sementara);
  const ff = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
  let galatFF = ""; ff.stderr.on("data", (d) => { galatFF += d; });
  const selesai = new Promise((res, rej) => { ff.on("error", rej); ff.on("close", (kode) => (kode === 0 ? res() : rej(new Error(`ffmpeg gagal (${kode}): ${galatFF.slice(-400)}`)))); });
  ff.stdin.on("error", () => {});

  const cv = canvasLib.createCanvas(pw, ph), g = cv.getContext("2d");
  const nFrame = Math.round(total * fps), tTpl0 = hook, tTpl1 = hook + spec.durasi * k;
  try {
    for (let i = 0; i < nFrame; i++) {
      const T = i / fps;
      g.setTransform(skala, 0, 0, skala, 0, 0); g.globalAlpha = 1; g.textAlign = "left"; g.textBaseline = "alphabetic";
      if (hook && T < tTpl0) gambarHook(g, T, hookTeks, th);
      else if (T < tTpl1) {
        spec.gambar(g, (T - tTpl0) / k);
        const f = T - tTpl0; if (hook && f < 0.15) { g.fillStyle = `rgba(11,22,38,${0.6 * (1 - f / 0.15)})`; g.fillRect(0, 0, W, H); }
      } else gambarOutro(g, T - tTpl1, { teaser: o.teaser, kanal: o.kanal }, th);
      const buf = cv.data();
      if (!ff.stdin.write(buf)) await once(ff.stdin, "drain");
      if (o.onProgress && i % 30 === 0) o.onProgress(i / nFrame);
    }
    ff.stdin.end(); await selesai;
    fs.renameSync(sementara, o.keluar);
  } catch (e) { try { ff.kill("SIGKILL"); } catch {} try { fs.rmSync(sementara, { force: true }); } catch {} throw e; }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { berkas: o.keluar, durasi: total, templat: tpl.id, regang: k, lebar: pw, tinggi: ph };
}
