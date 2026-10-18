// ================================================================
// STOP MOTION DARI FOTO: foto-foto berurutan (hasil jepretanmu sendiri) -> video 6-12 gambar per detik.
//
//   - tiap foto dibakukan seukuran foto pertama (diputar sesuai EXIF, dipotong tipis bila bentuknya beda),
//   - kedipan cahaya antar-foto diredam (ffmpeg deflicker), dipasang di kanvas 16:9 / 9:16 / persegi (latar blur bila perlu),
//   - opsi: kecepatan (fps), bolak-balik (maju lalu mundur), tulisan judul, tahan gambar terakhir.
//
// Tanpa AI dan tanpa GPU: hanya ffmpeg. Pengumpulan foto (sesi /stopmotion di Telegram) ada di telegram.js;
// kuota/antrean ada di video-gen.js (makeStopMotion).
// ================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FPS, canvasFor, fitPhoto, probeSize, runProc, wrapTitle } from "./photo-video.js";

export const DEFAULT_STOP_FPS = 8;
export const MIN_STOP_FPS = 2;
export const MAX_STOP_FPS = 24;
export const MIN_STOP_PHOTOS = 3;
const MAX_SIDE = 1600;

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Sisa kalimat "/stopmotion jadi ..." -> { fps, title, deflicker, boomerang, format, hold }.
 *   "10 fps" | "12 gambar per detik"  kecepatan (2-24, bawaan 8)
 *   "bolak-balik" | "boomerang"       maju lalu mundur
 *   "tanpa deflicker"                 jangan redam kedipan cahaya
 *   "potret" | "persegi" | "lanskap"  bentuk video (bawaan menurut foto pertama)
 *   "tulisan/judul "Lego Rumah""      judul di awal video (di dalam tanda kutip)
 */
export function parseStopMotionOptions(text, { maxFps = MAX_STOP_FPS } = {}) {
  let t = clean(text);
  let fps = DEFAULT_STOP_FPS;
  const f = /\b(\d{1,2})\s*(?:fps|gambar\s*(?:per|\/)\s*detik|frame\s*(?:per|\/)\s*(?:detik|second))\b/i.exec(t);
  if (f) {
    fps = Math.max(MIN_STOP_FPS, Math.min(maxFps, Number(f[1])));
    t = clean(t.slice(0, f.index) + " " + t.slice(f.index + f[0].length));
  }
  let title = "";
  const q = /(?:\b(?:tulisan|judul|teks|title)\s*:?\s*)?["“”'‘’]([^"“”'‘’]{1,80})["“”'‘’]/i.exec(t);
  if (q) {
    title = clean(q[1]);
    t = clean(t.slice(0, q.index) + " " + t.slice(q.index + q[0].length));
  }
  const boomerang = /\b(?:bolak[\s-]?balik|boomerang|ping[\s-]?pong|maju\s+mundur)\b/i.test(t);
  const deflicker = !/\btanpa\s+(?:deflicker|redam|peredam)\b/i.test(t);
  let format = "";
  if (/\b(?:potret|portrait|vertikal|tegak)\b/i.test(t)) format = "portrait";
  else if (/\b(?:persegi|square|kotak)\b/i.test(t)) format = "square";
  else if (/\b(?:lanskap|landscape|horizontal)\b/i.test(t)) format = "landscape";
  return { fps, title, deflicker, boomerang, format, hold: 1.2 };
}

const esc = (p) => String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

/** Lama video (detik): jumlah gambar / fps + tahan gambar terakhir. */
export function stopMotionSeconds(n, fps, hold = 1.2) {
  return n / fps + hold;
}

/** Argumen ffmpeg: dir/s1.png..sN.png (seukuran ow x oh) -> MP4 25 fps. */
export function stopMotionArgs({ dir, n, ow, oh, fps, hold = 1.2, deflicker = true, format = "", title = "", titleFile = null, font = "", out }) {
  const { W, H } = canvasFor(ow, oh, format);
  const { FW, FH, cover } = fitPhoto(ow, oh, W, H);
  const seconds = stopMotionSeconds(n, fps, hold);
  const fitFg = cover ? `scale=${W}:${H}` : `scale=${FW}:${FH}`;
  const pre = [`format=yuv420p`];
  if (deflicker) pre.push("deflicker=mode=pm:size=5");
  pre.push(`tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}`, "setsar=1");
  const parts = [
    `[0:v]${pre.join(",")},split[a][b]`,
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=30:luma_power=2,eq=brightness=-0.1:saturation=1.1,setsar=1[bg]`,
    `[b]${fitFg},setsar=1[fg]`
  ];
  let tail = `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p`;
  if (titleFile) {
    const size = Math.round(Math.min(W, H) * 0.062);
    tail += `,drawtext=${font ? `fontfile='${esc(font)}':` : ""}textfile='${esc(titleFile)}':expansion=none:fontsize=${size}:fontcolor=white:borderw=${Math.max(2, Math.round(size / 14))}:bordercolor=black@0.55:shadowx=2:shadowy=2:shadowcolor=black@0.4:line_spacing=10:x=(w-text_w)/2:y=h*0.80-text_h/2:alpha='min(1,max(0,(t-0.3)/0.6))*min(1,max(0,(${(seconds - 0.4).toFixed(2)}-t)/0.4))'`;
  }
  tail += `,fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, seconds - 0.5).toFixed(2)}:d=0.5[v]`;
  parts.push(tail);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(fps), "-i", path.join(dir, "s%d.png"), "-filter_complex", parts.join(";"), "-map", "[v]", "-r", String(FPS), "-t", seconds.toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out];
  return { args, W, H, seconds };
}

/**
 * photos (array Buffer, urutan = urutan foto) -> { buffer, mime, seconds, width, height, frames, skipped, fps }.
 * Foto yang tidak terbaca dilewati (butuh >= MIN_STOP_PHOTOS yang terbaca). Error.kind = "badimage" | "render".
 * onStage("prepare", i, n) per foto; onStage("render").
 */
export async function buildStopMotion(photos, options, { ffmpeg = "ffmpeg", spawnImpl = spawn, tmpRoot, font = "", log = console, stepTimeoutMs = 240_000, onStage = () => {} } = {}) {
  const list = (Array.isArray(photos) ? photos : []).filter((b) => Buffer.isBuffer(b) && b.length >= 100);
  if (list.length < MIN_STOP_PHOTOS) throw Object.assign(new Error(`Stop motion butuh minimal ${MIN_STOP_PHOTOS} foto.`), { kind: "toofew" });
  const dir = fs.mkdtempSync(path.join(tmpRoot, "stopmo-"));
  try {
    const norm = async (src, dst, vf) => {
      const r = await runProc(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-frames:v", "1", "-vf", vf, dst], { timeoutMs: 60_000, spawnImpl });
      return r.code === 0 && fs.existsSync(dst);
    };
    // foto pertama menentukan ukuran semua foto
    let ow = 0;
    let oh = 0;
    let count = 0;
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      onStage("prepare", i + 1, list.length);
      const raw = path.join(dir, `raw${i}.bin`);
      fs.writeFileSync(raw, list[i]);
      const dst = path.join(dir, `s${count + 1}.png`);
      let ok;
      if (count === 0) {
        ok = await norm(raw, dst, `scale=w='min(${MAX_SIDE},iw)':h='min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`);
        if (ok) {
          const size = await probeSize(ffmpeg, dst, { spawnImpl });
          if (!size || size.w < 16 || size.h < 16) ok = false;
          else {
            ow = size.w;
            oh = size.h;
          }
        }
      } else {
        ok = await norm(raw, dst, `scale=${ow}:${oh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${ow}:${oh},setsar=1`);
      }
      try {
        fs.rmSync(raw, { force: true });
      } catch {
        /* abaikan */
      }
      if (ok) count += 1;
      else {
        skipped += 1;
        try {
          fs.rmSync(dst, { force: true });
        } catch {
          /* abaikan */
        }
        log.warn?.(`🧱 [StopMotion] foto ke-${i + 1} tidak terbaca, dilewati`);
      }
    }
    if (count < MIN_STOP_PHOTOS) throw Object.assign(new Error("Foto-fotonya tidak bisa dibaca. Kirim ulang sebagai foto (JPG/PNG)."), { kind: "badimage" });

    let n = count;
    if (options.boomerang) {
      // maju lalu mundur (tanpa mengulang gambar paling ujung dua kali)
      for (let i = count - 1; i >= 2; i--) {
        fs.copyFileSync(path.join(dir, `s${i}.png`), path.join(dir, `s${++n}.png`));
      }
    }
    let titleFile = null;
    if (options.title) {
      titleFile = path.join(dir, "judul.txt");
      const { W } = canvasFor(ow, oh, options.format);
      fs.writeFileSync(titleFile, wrapTitle(options.title, W > 1000 ? 30 : 20), "utf8");
    }
    onStage("render");
    const out = path.join(dir, "stopmotion.mp4");
    const base = { dir, n, ow, oh, fps: options.fps || DEFAULT_STOP_FPS, hold: options.hold ?? 1.2, deflicker: options.deflicker !== false, format: options.format || "", out, font };
    const run = (tf) => stopMotionArgs({ ...base, titleFile: tf });
    let { args, W, H, seconds } = run(titleFile);
    let r = await runProc(ffmpeg, args, { timeoutMs: stepTimeoutMs, spawnImpl });
    if (r.code !== 0 && titleFile) {
      log.warn?.(`🧱 [StopMotion] drawtext gagal, dibuat tanpa judul: ${r.stderr.slice(-160)}`);
      ({ args } = run(null));
      r = await runProc(ffmpeg, args, { timeoutMs: stepTimeoutMs, spawnImpl });
    }
    if (r.code !== 0 && base.deflicker) {
      log.warn?.(`🧱 [StopMotion] deflicker gagal, dibuat tanpa peredam kedip: ${r.stderr.slice(-160)}`);
      base.deflicker = false;
      ({ args } = stopMotionArgs({ ...base, titleFile: null }));
      r = await runProc(ffmpeg, args, { timeoutMs: stepTimeoutMs, spawnImpl });
    }
    if (r.code !== 0) throw Object.assign(new Error(`ffmpeg stop motion: ${r.stderr.replace(/\s+/g, " ").slice(-220)}`), { kind: "render" });
    let buffer = fs.readFileSync(out);
    if (buffer.length > 15 * 1024 * 1024) {
      const small = path.join(dir, "kecil.mp4");
      const rs = await runProc(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", out, "-vf", `scale=${Math.round((W * 0.66) / 2) * 2}:-2`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-an", "-movflags", "+faststart", small], { timeoutMs: stepTimeoutMs, spawnImpl });
      if (rs.code === 0) buffer = fs.readFileSync(small);
    }
    if (buffer.length < 2000) throw Object.assign(new Error("Video hasil kosong."), { kind: "render" });
    return { buffer, mime: "video/mp4", seconds, width: W, height: H, frames: n, photos: count, skipped, fps: base.fps, deflicker: base.deflicker };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* sisa folder sementara tidak fatal */
    }
  }
}
