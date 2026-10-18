// ================================================================
// MORF FOTO (prototipe): foto + deskripsi perubahan -> beberapa "kunci gambar" hasil edit AI -> video yang berubah halus.
//
//   1. AI teks menyusun N tahap perubahan (instruksi edit, dari perubahan tipis sampai selesai).
//   2. Tiap tahap diedit dari FOTO ASLI oleh pembuat edit foto (Cloudflare FLUX, gratis), sehingga wajah/komposisi tidak
//      menumpuk penyimpangan; N edit per video, bukan 25 per detik.
//   3. ffmpeg menyambung foto asli + hasil edit menjadi video 25 fps: lebur halus (xfade, cepat) atau interpolasi gerak
//      (minterpolate, lebih lambat dan kadang melengkung bila perbedaan antar gambar besar).
//
// Cocok untuk perubahan suasana/gaya/benda (siang -> malam, musim, salju, warna). BUKAN untuk gerak tubuh yang tepat.
// File ini hanya mesin; kuota, antrean, dan perintah ada di video-gen.js.
// ================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FPS, canvasFor, fitPhoto, probeSize, runProc } from "./photo-video.js";

export const MORPH_SECONDS = 8;
export const MIN_MORPH_SECONDS = 4;
const MAX_SIDE = 1600; // foto asli dibakukan: maks sisi terpanjang (hemat unggah ke pembuat edit)

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- mengenali perintah
// "morf siang jadi malam", "/video morf ...", "/morf ...", "morph ...", "transformasi ..."
const MORPH_RE = /^\s*(?:\/(?:video|vidio|vid)(?:@\w+)?\s+)?(?:\/)?(?:morf(?:ing)?|morph(?:ing)?|transformasi)\b[:,]?\s*(.*)$/is;
const SLASH_MORPH_RE = /^\s*\/(?:(?:video|vidio|vid)(?:@\w+)?\s+(?:morf|morph|transformasi)|morf|morph)\b/i;

/** Teks -> { text } bila meminta morf foto, selain itu null. needsImage = bentuk berawalan garis miring (jelas perintah). */
export function detectMorphRequest(text, { hasImage = false } = {}) {
  const t = clean(text);
  if (!t) return null;
  const m = MORPH_RE.exec(t);
  if (!m) return null;
  if (!hasImage && !SLASH_MORPH_RE.test(t)) return null; // kata "morf" biasa tanpa foto bukan perintah
  return { text: m[1] || "", needsImage: !hasImage };
}

/** Sisa kalimat -> { prompt, seconds, steps, smooth }. */
export function parseMorphOptions(text, { defaultSteps = 5, maxSteps = 8, maxSeconds = 14, defaultSeconds = MORPH_SECONDS } = {}) {
  let t = clean(text);
  let seconds = defaultSeconds;
  let steps = defaultSteps;
  let smooth = false;
  const dur = /\b(?:selama\s+|sekitar\s+)?(\d{1,2})\s*(?:detik|dtk|sec|s)\b/i.exec(t);
  if (dur) {
    seconds = Math.max(MIN_MORPH_SECONDS, Math.min(maxSeconds, Number(dur[1])));
    t = clean(t.slice(0, dur.index) + " " + t.slice(dur.index + dur[0].length));
  }
  const st = /\b(\d{1,2})\s*(?:tahap|langkah|kunci|keyframes?|steps?)\b/i.exec(t);
  if (st) {
    steps = Math.max(2, Math.min(maxSteps, Number(st[1])));
    t = clean(t.slice(0, st.index) + " " + t.slice(st.index + st[0].length));
  }
  if (/\b(?:halus|mulus|interpolasi|smooth|mci)\b/i.test(t)) {
    smooth = true;
    t = clean(t.replace(/\b(?:halus|mulus|interpolasi|smooth|mci)\b/gi, " "));
  }
  t = t.replace(/^[\s:,.-]+|[\s:,.-]+$/g, "").replace(/^["'“”]+|["'“”]+$/g, "");
  return { prompt: t.slice(0, 300), seconds, steps: Math.min(steps, maxSteps), smooth };
}

// ---------------------------------------------------------------- rencana tahap oleh AI
export function buildMorphPrompt(desc, n) {
  return {
    system:
      `You plan a gradual photo transformation as a sequence of image-edit instructions. Reply with ONE JSON object only (no markdown, no commentary):\n` +
      `{"steps":["...","..."]}\n` +
      `Rules:\n` +
      `- Exactly ${n} strings. Each is an English instruction applied to the ORIGINAL photo, describing how the photo looks at that stage.\n` +
      `- Stage 1 is a SUBTLE first change; the last stage is the fully completed transformation; the stages in between progress evenly.\n` +
      `- Each instruction is self-contained (never "continue" or "more"), starts with an imperative verb, max 220 characters.\n` +
      `- Change ONLY what the user's description asks. Keep the people, their faces, pose, clothes, composition and camera exactly as in the original photo.\n` +
      `- No text, letters, logos or captions in the image.`,
    user: `Transformation: ${desc}\nStages: ${n}`
  };
}

/** Cadangan bila AI tidak menjawab: deskripsi yang sama dengan takaran perubahan bertahap. */
export function fallbackMorphPlan(desc, n) {
  const d = clean(desc) || "apply the described change";
  return Array.from({ length: n }, (_, i) => {
    const pct = Math.round(((i + 1) / n) * 100);
    return pct >= 100
      ? `${d}. The change is fully complete. Keep everything else identical.`
      : `${d}. Apply only about ${pct}% of the change, as an early stage of a gradual transformation. Keep everything else identical.`;
  });
}

/** Jawaban AI -> array n instruksi (dilengkapi cadangan bila kurang/rusak). { steps, fallback } */
export function parseMorphPlan(raw, n, desc) {
  const text = String(raw ?? "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  let list = null;
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(text.slice(a, b + 1));
      if (Array.isArray(j?.steps)) list = j.steps.map((s) => clean(s).slice(0, 300)).filter((s) => s.length >= 8);
    } catch {
      list = null;
    }
  }
  if (!list || list.length < Math.max(2, Math.ceil(n / 2))) return { steps: fallbackMorphPlan(desc, n), fallback: true };
  if (list.length > n) list = list.slice(0, n);
  if (list.length < n) {
    const fb = fallbackMorphPlan(desc, n);
    list = [...list, ...fb.slice(list.length)];
  }
  return { steps: list, fallback: false };
}

// ---------------------------------------------------------------- argumen ffmpeg
const esc = (p) => String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

/** Pembagian waktu peleburan: n gambar, total detik -> { hold, fade }. hold = lama tiap gambar termasuk peleburan. */
export function morphTiming(n, seconds) {
  const gaps = Math.max(1, n - 1);
  const fade = Math.max(0.4, Math.min(1.2, (seconds / gaps) * 0.6));
  const hold = (seconds + gaps * fade) / n;
  return { hold, fade: Math.min(fade, hold * 0.85) };
}

/**
 * Argumen ffmpeg: n berkas dir/n0.png..n(n-1).png (sudah seukuran ow x oh) -> MP4 W x H.
 * smooth=false: lebur halus; smooth=true: interpolasi gerak (minterpolate).
 */
export function morphArgs({ dir, n, ow, oh, seconds, smooth = false, format = "", out }) {
  const { W, H } = canvasFor(ow, oh, format);
  const { FW, FH, cover } = fitPhoto(ow, oh, W, H);
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  const parts = [];
  let mixed;
  if (smooth) {
    const seg = seconds / Math.max(1, n - 1);
    // minterpolate membuang interval terakhir, jadi gambar akhir diperpanjang satu interval (dipangkas lagi oleh trim)
    args.push("-framerate", (1 / seg).toFixed(5), "-i", path.join(dir, "n%d.png"));
    parts.push(`[0:v]format=yuv420p,tpad=stop_mode=clone:stop_duration=${seg.toFixed(3)},minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,tpad=stop_mode=clone:stop_duration=3,trim=duration=${seconds.toFixed(2)},setpts=PTS-STARTPTS,setsar=1[mix]`);
    mixed = "mix";
  } else {
    const { hold, fade } = morphTiming(n, seconds);
    for (let i = 0; i < n; i++) args.push("-loop", "1", "-framerate", String(FPS), "-t", hold.toFixed(3), "-i", path.join(dir, `n${i}.png`));
    for (let i = 0; i < n; i++) parts.push(`[${i}:v]format=yuv420p,setsar=1[s${i}]`);
    let prev = "s0";
    for (let i = 1; i < n; i++) {
      const next = i === n - 1 ? "mix" : `x${i}`;
      parts.push(`[${prev}][s${i}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${(i * (hold - fade)).toFixed(3)}[${next}]`);
      prev = next;
    }
    mixed = "mix";
  }
  const fitFg = cover ? `scale=${W}:${H}` : `scale=${FW}:${FH}`;
  parts.push(`[${mixed}]split[a][b]`);
  parts.push(`[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=30:luma_power=2,eq=brightness=-0.1:saturation=1.1,setsar=1[bg]`);
  parts.push(`[b]${fitFg},setsar=1[fg]`);
  parts.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=${Math.max(0, seconds - 0.6).toFixed(2)}:d=0.6[v]`);
  const total = Math.round(seconds * FPS);
  args.push("-filter_complex", parts.join(";"), "-map", "[v]", "-frames:v", String(total), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out);
  return { args, W, H };
}

// ---------------------------------------------------------------- perakitan
/**
 * photo (Buffer foto asli) + steps (instruksi) -> { buffer, mime, seconds, width, height, frames, planned, smooth }.
 * editImage(instruction, sourceBuffer) -> Promise<Buffer> (Error dengan .kind/.message siap tampil bila gagal).
 * Tahap pertama gagal -> lempar galat; tahap tengah gagal -> berhenti di situ (butuh >= 2 gambar).
 * onStage("edit", i, n) tiap tahap; onStage("render") sebelum ffmpeg. Error.kind = "badimage" | "render" | kind pembuat edit.
 */
export async function buildMorphVideo(photo, steps, options, { editImage, ffmpeg = "ffmpeg", spawnImpl = spawn, tmpRoot, log = console, stepTimeoutMs = 240_000, onStage = () => {}, chain = false } = {}) {
  if (!Buffer.isBuffer(photo) || photo.length < 100) throw Object.assign(new Error("Fotonya kosong."), { kind: "badimage" });
  if (typeof editImage !== "function") throw Object.assign(new Error("Pembuat edit foto belum aktif."), { kind: "noedit" });
  const dir = fs.mkdtempSync(path.join(tmpRoot, "morf-"));
  try {
    const norm = async (src, dst, vf) => {
      const r = await runProc(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-frames:v", "1", "-vf", vf, dst], { timeoutMs: 60_000, spawnImpl });
      return r.code === 0 && fs.existsSync(dst);
    };
    // foto asli: diputar sesuai EXIF, maks MAX_SIDE, ukuran genap -> n0.png
    const raw = path.join(dir, "asli.bin");
    fs.writeFileSync(raw, photo);
    const first = path.join(dir, "n0.png");
    const okFirst = await norm(raw, first, `scale=w='min(${MAX_SIDE},iw)':h='min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`);
    const size = okFirst ? await probeSize(ffmpeg, first, { spawnImpl }) : null;
    if (!size || size.w < 16 || size.h < 16) throw Object.assign(new Error("Fotonya tidak bisa dibaca."), { kind: "badimage" });
    const { w: ow, h: oh } = size;
    const baseBuffer = fs.readFileSync(first);

    let last = baseBuffer;
    let count = 1;
    let firstError = null;
    for (let i = 0; i < steps.length; i++) {
      onStage("edit", i + 1, steps.length);
      try {
        const edited = await editImage(steps[i], chain ? last : baseBuffer);
        const buf = Buffer.isBuffer(edited) ? edited : edited?.buffer;
        if (!Buffer.isBuffer(buf) || buf.length < 100) throw new Error("hasil edit kosong");
        const src = path.join(dir, `e${i}.bin`);
        fs.writeFileSync(src, buf);
        const dst = path.join(dir, `n${count}.png`);
        // seukuran foto asli (tepi dipotong tipis bila bentuknya sedikit berbeda), supaya semua gambar identik ukurannya
        if (!(await norm(src, dst, `scale=${ow}:${oh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${ow}:${oh},setsar=1`))) throw new Error("hasil edit tidak bisa dibaca");
        last = fs.readFileSync(dst);
        count += 1;
      } catch (e) {
        log.warn?.(`🧬 [Morf] tahap ${i + 1}/${steps.length} gagal: ${e instanceof Error ? e.message : e}`);
        if (count === 1) firstError = e;
        break;
      }
    }
    if (count < 2) {
      const e = firstError || new Error("Edit foto gagal.");
      throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { kind: e?.kind || "edit", detail: e?.detail || "" });
    }

    onStage("render");
    const out = path.join(dir, "morf.mp4");
    const seconds = Math.max(MIN_MORPH_SECONDS, options.seconds || MORPH_SECONDS);
    let used = Boolean(options.smooth) && count >= 2;
    let { args, W, H } = morphArgs({ dir, n: count, ow, oh, seconds, smooth: used, out });
    let r = await runProc(ffmpeg, args, { timeoutMs: stepTimeoutMs, spawnImpl });
    if (r.code !== 0 && used) {
      log.warn?.(`🧬 [Morf] interpolasi gagal, pakai lebur halus: ${r.stderr.slice(-160)}`);
      used = false;
      ({ args, W, H } = morphArgs({ dir, n: count, ow, oh, seconds, smooth: false, out }));
      r = await runProc(ffmpeg, args, { timeoutMs: stepTimeoutMs, spawnImpl });
    }
    if (r.code !== 0) throw Object.assign(new Error(`ffmpeg morf: ${r.stderr.replace(/\s+/g, " ").slice(-220)}`), { kind: "render" });
    let buffer = fs.readFileSync(out);
    if (buffer.length > 15 * 1024 * 1024) {
      const small = path.join(dir, "kecil.mp4");
      const rs = await runProc(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", out, "-vf", `scale=${Math.round((W * 0.66) / 2) * 2}:-2`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-an", "-movflags", "+faststart", small], { timeoutMs: stepTimeoutMs, spawnImpl });
      if (rs.code === 0) buffer = fs.readFileSync(small);
    }
    if (buffer.length < 2000) throw Object.assign(new Error("Video hasil kosong."), { kind: "render" });
    return { buffer, mime: "video/mp4", seconds, width: W, height: H, frames: count, planned: steps.length + 1, smooth: used };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* sisa folder sementara tidak fatal */
    }
  }
}
