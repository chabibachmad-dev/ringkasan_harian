// ================================================================
// Pembuat VIDEO gratis (teks -> video bernarasi), dirakit sendiri di laptop bot dengan ffmpeg.
//
// Cara kerja (tanpa API video berbayar):
//   1. Naskah  : AI teks (Groq/OpenRouter/Gemini) memecah ide jadi 3-6 adegan: deskripsi gambar (Inggris) + narasi singkat.
//   2. Gambar  : tiap adegan digambar oleh pembuat gambar yang sama dengan /gambar (Cloudflare FLUX gratis).
//   3. Suara   : seluruh narasi dibacakan SEKALI (Gemini TTS), durasi tiap adegan mengikuti panjang kalimatnya.
//   4. Rakit   : ffmpeg memberi gerak halus (zoom/geser) pada tiap gambar, latar blur 16:9, subtitle, fade, lalu
//                menggabungkan semuanya + suara menjadi MP4 (H.264/AAC) yang langsung bisa diputar di WhatsApp.
//
// Dipakai di:
//   - grup WhatsApp   : "bot, buatkan video kancil dan buaya"   (bisa dimatikan: /video grup off di Telegram)
//   - chat WA pemilik : "buatkan video ..." atau "/video ..."
//   - Telegram        : /video <deskripsi>
//
// Batas harian (hari WITA, tersimpan di bot_state "wa_video_quota"); satu video = beberapa gambar, jadi jatahnya kecil:
//   VIDEO_OWNER_DAILY=5   pemilik     VIDEO_GROUP_DAILY=3   seluruh grup     VIDEO_PERSON_DAILY=1   per orang di grup
// .env (semua opsional):
//   VIDEO_ENABLED=1 (0 = mati)   VIDEO_SCENES=5 (bawaan) VIDEO_MAX_SCENES=6   VIDEO_FONT=/path/font.ttf
//   VIDEO_NARRATION_CHARS=620 (batas total huruf yang dibacakan)   FFMPEG_PATH=ffmpeg
// Hanya SATU video dirakit pada satu waktu (CPU laptop); permintaan lain mengantre (maks VIDEO_QUEUE=2).
// ================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanPrompt, editPromptProblem, promptProblem } from "./image-gen.js";
import { buildMorphPrompt, buildMorphVideo, detectMorphRequest, parseMorphOptions, parseMorphPlan } from "./morph-video.js";
import { MAX_STOP_FPS, MIN_STOP_PHOTOS, buildStopMotion, parseStopMotionOptions } from "./stopmotion-video.js";
import { buildPhotoVideo, detectPhotoVideoRequest, parsePhotoOptions } from "./photo-video.js";
import { CAM_ZOOM, buildStoryPrompt, detectStoryMode, detectStoryStyle, stripStoryStyle, fallbackStory, makeCharacter, parseStoryScript, renderSceneClip, writeBackground } from "./story-video.js";

export const STATE_KEY = "wa_video_gen";
export const QUOTA_KEY = "wa_video_quota";
export const OUT_W = 1280;
export const OUT_H = 720;
export const FPS = 25;
export const LEAD_SEC = 0.4; // jeda sebelum narasi mulai
export const TAIL_SEC = 0.9; // jeda setelah narasi selesai
export const MIN_SCENE_SEC = 2.8;
export const SEC_PER_SCENE = 6; // dipakai menerjemahkan "video 30 detik" -> jumlah adegan
export const MAX_FILE_BYTES = 15 * 1024 * 1024; // batas video WhatsApp 16 MB

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf"
];

export function readVideoConfig(env = process.env) {
  const num = (v, d, min = 0) => (Number.isFinite(Number(v)) && String(v ?? "").trim() !== "" && Number(v) >= min ? Math.floor(Number(v)) : d);
  const maxScenes = Math.max(3, Math.min(8, num(env.VIDEO_MAX_SCENES, 6)));
  return {
    enabled: !/^(0|off|false|mati|no)$/i.test(String(env.VIDEO_ENABLED ?? "1").trim()),
    scenes: Math.max(3, Math.min(maxScenes, num(env.VIDEO_SCENES, 5))),
    maxScenes,
    ownerDaily: num(env.VIDEO_OWNER_DAILY, 5),
    groupDaily: num(env.VIDEO_GROUP_DAILY, 3),
    personDaily: num(env.VIDEO_PERSON_DAILY, 1),
    // Foto hidup (foto -> video dengan efek): tanpa AI/kuota gambar, hanya CPU laptop, jadi jatahnya lebih longgar.
    photoOwnerDaily: num(env.VIDEO_PHOTO_OWNER_DAILY, 15),
    photoGroupDaily: num(env.VIDEO_PHOTO_GROUP_DAILY, 8),
    photoPersonDaily: num(env.VIDEO_PHOTO_PERSON_DAILY, 2),
    photoMaxSeconds: Math.max(5, Math.min(30, num(env.VIDEO_PHOTO_MAX_SEC, 15))),
    narrationChars: Math.max(200, Math.min(1200, num(env.VIDEO_NARRATION_CHARS, 620))),
    queue: num(env.VIDEO_QUEUE, 2),
    ffmpeg: String(env.FFMPEG_PATH || "ffmpeg").trim(),
    font: String(env.VIDEO_FONT || "").trim(),
    stepTimeoutMs: Math.max(30_000, num(env.VIDEO_STEP_TIMEOUT_MS, 240_000)),
    // Morf foto (prototipe, hanya pemilik): tiap video = N edit foto AI (jatah Cloudflare) + ffmpeg.
    morphOwnerDaily: num(env.VIDEO_MORPH_OWNER_DAILY, 4),
    morphSteps: Math.max(2, Math.min(8, num(env.VIDEO_MORPH_STEPS, 5))),
    morphMaxSteps: Math.max(2, Math.min(8, num(env.VIDEO_MORPH_MAX_STEPS, 8))),
    morphSeconds: Math.max(4, Math.min(14, num(env.VIDEO_MORPH_SECONDS, 8))),
    morphMaxSeconds: Math.max(4, Math.min(20, num(env.VIDEO_MORPH_MAX_SEC, 14))),
    morphChain: /^(1|on|true|ya)$/i.test(String(env.VIDEO_MORPH_CHAIN ?? "0").trim()),
    // Stop motion dari foto (hanya CPU; memakai jatah "foto hidup" pemilik)
    stopMaxPhotos: Math.max(6, Math.min(120, num(env.VIDEO_STOP_MAX_PHOTOS, 60))),
    stopMaxFps: Math.max(4, Math.min(MAX_STOP_FPS, num(env.VIDEO_STOP_MAX_FPS, 15))),
    promptMax: 400
  };
}

// ---------------------------------------------------------------- mengenali permintaan video
const NOUN = "video|vidio|bideo|vidéo|klip(?:\\s+video)?|film\\s+pendek|animasi|short\\s+video|short|reels?";
const VERB = "buat(?:kan|in|lah)?|bikin(?:kan|in)?|generate|create|ciptakan|render|produksi|produce|make";
const FILLER = "(?:tolong|coba|bisa|dong|ya|yah|please|pls|kak|bro|min|bang|mas|mbak|bisa tolong|bisakah|boleh)";
const REQUEST_RE = new RegExp(
  `^(?:${FILLER}[\\s,]+)*(?:${VERB})\\s+(?:(?:sebuah|satu|1|a|an|me|aku|saya|kami|kita|untuk(?:ku| saya| aku)?|dong|ya)\\s+)*(${NOUN})(nya)?\\b(.*)$`,
  "is"
);
const SLASH_RE = /^\/(?:video|vidio|vid)(?:@\w+)?(?:\s+(.*))?$/is;

/**
 * Teks pengguna -> { prompt, seconds } bila ini permintaan membuat video (prompt "" = belum ada deskripsi), selain itu null.
 * Sengaja KETAT: "video ini lucu" / "kirim videonya" / "tonton video tadi" bukan permintaan membuat video.
 * seconds = durasi yang diminta ("video 30 detik"), 0 bila tidak disebut.
 */
export function detectVideoRequest(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const slash = SLASH_RE.exec(t);
  let rest;
  if (slash) rest = slash[1] || "";
  else {
    const m = REQUEST_RE.exec(t);
    if (!m) return null;
    rest = m[3] || "";
    // "buatkan videonya" / "buatkan video ini" -> merujuk video lain, bukan deskripsi baru
    if (m[2] || /^\s*(?:ini|itu|tadi)\b/i.test(rest)) rest = "";
    // "buatkan animasi/short/klip" tanpa konteks video: tetap dianggap permintaan video
  }
  let seconds = 0;
  const dur = /\b(?:durasi\s+)?(?:selama\s+|sekitar\s+|kira-?kira\s+)?(\d{1,3})\s*(detik|dtk|second|sec|menit|min)\b/i.exec(rest);
  if (dur) {
    const v = Number(dur[1]);
    seconds = /^(menit|min)/i.test(dur[2]) ? v * 60 : v;
    rest = (rest.slice(0, dur.index) + " " + rest.slice(dur.index + dur[0].length)).replace(/\s+/g, " ");
  }
  return { prompt: cleanPrompt(rest), seconds };
}

/** Jumlah adegan: dari durasi yang diminta (~6 dtk/adegan) atau bawaan; selalu 3..maxScenes. */
export function sceneCount(seconds, config) {
  const base = seconds > 0 ? Math.round(seconds / SEC_PER_SCENE) : config.scenes;
  return Math.max(3, Math.min(config.maxScenes, base));
}

// ---------------------------------------------------------------- naskah
export function buildScriptPrompt(idea, n, maxChars) {
  const perScene = Math.max(60, Math.floor(maxChars / n) - 10);
  return {
    system:
      `You write short explainer/story video scripts. Reply with ONE JSON object only (no markdown, no commentary):\n` +
      `{"title":"...","style":"...","scenes":[{"visual":"...","narration":"..."}]}\n` +
      `Rules:\n` +
      `- Exactly ${n} scenes that tell a clear story from start to end (hook, development, ending).\n` +
      `- "style": ONE English phrase for the shared visual style of ALL images (e.g. "soft watercolor children's book illustration, warm colors").\n` +
      `- "visual": English description of ONE still image for that scene (subject, action, setting, camera). Repeat the full look of recurring characters in EVERY scene so they stay consistent (species, colors, clothes). NO text, letters, logos or captions inside the image. No real people, celebrities or brands.\n` +
      `- "narration": what the narrator says during the scene, in the SAME language as the user's idea (Indonesian if unclear), natural spoken sentence(s), max ${perScene} characters, no emoji, no scene numbers.\n` +
      `- "title": max 6 words, same language as the narration.\n` +
      `- Keep it family-friendly.`,
    user: `Video idea: ${idea}`
  };
}

const stripEmoji = (s) => String(s ?? "").replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

/** Jawaban AI -> { title, style, scenes:[{visual,narration}] } atau null bila tidak bisa dipakai. */
export function parseScript(raw, n, maxChars = 620) {
  const text = String(raw ?? "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let j;
  try {
    j = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!j || !Array.isArray(j.scenes)) return null;
  const scenes = j.scenes
    .map((s) => ({ visual: stripEmoji(s?.visual).slice(0, 320), narration: stripEmoji(s?.narration).slice(0, 220) }))
    .filter((s) => s.visual.length >= 8)
    .slice(0, n);
  if (scenes.length < 2) return null;
  // total narasi dibatasi (batas TTS): potong per adegan secara merata, di batas kata
  let total = scenes.reduce((x, s) => x + s.narration.length, 0);
  if (total > maxChars) {
    const per = Math.floor(maxChars / scenes.length);
    for (const s of scenes) if (s.narration.length > per) s.narration = cutAtWord(s.narration, per);
    total = scenes.reduce((x, s) => x + s.narration.length, 0);
  }
  return { title: stripEmoji(j.title).slice(0, 60), style: stripEmoji(j.style).slice(0, 120), scenes };
}

function cutAtWord(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  const base = sp > max * 0.5 ? cut.slice(0, sp) : cut;
  return base.replace(/[,;:\-–\s]+$/, "") + (/[.!?]$/.test(base) ? "" : ".");
}

const SHOTS = ["wide establishing shot of", "close-up of", "medium shot of", "dramatic low angle view of", "cinematic final shot of", "detailed view of", "sunny wide view of", "calm closing shot of"];
/** Cadangan bila AI naskah tidak tersedia: satu ide, beberapa sudut pandang, tanpa narasi (subtitle = ide pada adegan pertama). */
export function fallbackScript(idea, n) {
  const p = String(idea).slice(0, 300);
  return {
    title: "",
    style: "cinematic illustration, rich colors, soft lighting",
    scenes: Array.from({ length: n }, (_, i) => ({ visual: `${SHOTS[i % SHOTS.length]} ${p}`, narration: i === 0 ? p : "" })),
    fallback: true
  };
}

// ---------------------------------------------------------------- bantu ffmpeg
/** Bungkus teks subtitle: baris <= width huruf, maks maxLines baris (sisanya dipotong). */
export function wrapSubtitle(text, width = 46, maxLines = 3) {
  const words = stripEmoji(text).split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[,;:.\s]*$/, "") + "…";
    return kept.join("\n");
  }
  return lines.join("\n");
}

/** Durasi tiap adegan (detik). narrSec = panjang audio narasi (0 = tanpa suara). */
export function sceneDurations(scenes, narrSec) {
  if (!(narrSec > 0)) return scenes.map((s) => Math.max(4, Math.min(9, s.narration.length / 13 + 1.2)));
  const w = scenes.map((s) => Math.max(s.narration.length, 24));
  const sum = w.reduce((a, b) => a + b, 0);
  const d = w.map((x) => Math.max(MIN_SCENE_SEC, (narrSec * x) / sum));
  d[0] += LEAD_SEC;
  d[d.length - 1] += TAIL_SEC;
  return d.map((x) => Math.round(x * 100) / 100);
}

/** Ekspresi zoompan bergantian: zoom-in, zoom-out, geser. frames = jumlah frame adegan. */
export function motionExpr(i, frames) {
  const N = Math.max(2, frames);
  switch (i % 3) {
    case 0:
      return { z: `1+0.16*on/${N}`, x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)/2" };
    case 1:
      return { z: `1.16-0.16*on/${N}`, x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)/2" };
    default:
      return { z: "1.14", x: `(iw-iw/zoom)*on/${N}`, y: "(ih-ih/zoom)/2" };
  }
}

/** Argumen ffmpeg untuk satu klip adegan (gambar -> klip bergerak). */
export function clipArgs({ image, out, dur, index, textFile = null, font = "" }) {
  const frames = Math.max(2, Math.round(dur * FPS));
  const m = motionExpr(index, frames);
  const sq = 720;
  const esc = (p) => String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  let chain =
    `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},boxblur=luma_radius=28:luma_power=2,eq=brightness=-0.12:saturation=1.1,setsar=1[bg];` +
    `[1:v]scale=2160:2160:force_original_aspect_ratio=increase,crop=2160:2160,zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${sq}x${sq}:fps=${FPS},setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:0,format=yuv420p`;
  if (textFile) {
    chain += `,drawtext=${font ? `fontfile='${esc(font)}':` : ""}textfile='${esc(textFile)}':expansion=none:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=16:line_spacing=8:x=(w-text_w)/2:y=h-text_h-46`;
  }
  const fo = Math.max(0, dur - 0.25).toFixed(2);
  chain += `,fade=t=in:st=0:d=0.25,fade=t=out:st=${fo}:d=0.25[v]`;
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-framerate", String(FPS), "-t", dur.toFixed(2), "-i", image,
    "-i", image,
    "-filter_complex", chain,
    "-map", "[v]", "-frames:v", String(frames), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-profile:v", "main", "-pix_fmt", "yuv420p", "-an",
    out
  ];
}

function runProc(cmd, args, { timeoutMs = 120_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return reject(e);
    }
    const err = [];
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* abaikan */
      }
      reject(Object.assign(new Error("ffmpeg terlalu lama"), { code: "timeout" }));
    }, timeoutMs);
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", (d) => {
      err.push(d);
      if (err.length > 400) err.splice(0, 200);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr: Buffer.concat(err).toString("utf8") });
    });
  });
}

/** Panjang berkas audio (detik) dengan ffmpeg: dekode ke null, ambil "time=" terakhir. */
export async function audioSeconds(ffmpeg, file, opts = {}) {
  const r = await runProc(ffmpeg, ["-hide_banner", "-nostdin", "-i", file, "-vn", "-f", "null", "-"], { timeoutMs: 30_000, ...opts });
  let last = null;
  for (const m of r.stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)) last = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return last && last > 0 ? last : 0;
}

// ---------------------------------------------------------------- pembuat video
function hariWita(ms) {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

export const VIDEO_TEXT = {
  stoptoofew: `Stop motion butuh minimal ${MIN_STOP_PHOTOS} foto berurutan. Kirim fotonya satu per satu (atau beberapa sekaligus), lalu /stopmotion jadi.`,
  nomorph: "Morf foto butuh pembuat edit foto: isi CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (gratis) lewat /env, dan jangan mematikan Cloudflare di IMAGE_PROVIDERS.",
  morphempty: "Mau diubah jadi apa? Contoh: morf siang jadi malam bersalju (boleh tambah: 8 detik, 5 tahap, halus).",
  noimage: "Video butuh pembuat gambar, dan itu belum aktif: isi CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (gratis) atau GEMINI_API_KEYS di .env bot.",
  noffmpeg: "Video belum bisa dibuat: ffmpeg belum terpasang di laptop bot (sudo apt install ffmpeg). Pemilik sudah diberi tahu.",
  busy: "Pembuat video sedang sibuk dengan banyak permintaan. Coba lagi beberapa menit lagi ya.",
  fail: "Maaf, videonya gagal dirakit. Coba lagi sebentar lagi ya.",
  off: "Pembuat video sedang dimatikan.",
  badphoto: "Fotonya tidak bisa dibaca. Coba kirim ulang fotonya (JPG/PNG), lalu minta lagi.",
  nophoto: "Fotonya belum ada. Kirim foto dengan keterangan, mis. \"bot, jadikan video dengan salju turun\", atau balas (reply) foto yang mau dihidupkan dengan: bot, jadikan video.",
  empty: "Mau dibuatkan video tentang apa? Contoh: bot, buatkan video kancil dan buaya (atau tambah durasi: video 30 detik tentang siklus air)."
};

export const photoVideoSentNote = (prompt, v = {}) =>
  `🎞️ [BOT mengirim VIDEO hasil FOTO HIDUP (foto yang dikirim penanya digerakkan + efek${v.effects?.length ? " " + v.effects.join(", ") : ""}), permintaannya: "${String(prompt ?? "").replace(/\s+/g, " ").replace(/"/g, "'").slice(0, 160)}"]`;

export const morphSentNote = (prompt) =>
  `🧬 [BOT mengirim VIDEO hasil MORF FOTO (foto yang dikirim pemilik diedit AI bertahap lalu disambung), perubahannya: "${String(prompt ?? "").replace(/\s+/g, " ").replace(/"/g, "'").slice(0, 160)}"]`;

export const stopMotionSentNote = (v = {}) =>
  `🧱 [BOT mengirim VIDEO STOP MOTION dari ${v.photos || "beberapa"} foto berurutan kiriman pemilik (${v.fps || "?"} gambar per detik${v.title ? `, judul "${String(v.title).replace(/"/g, "'").slice(0, 60)}"` : ""})]`;

export const storySentNote = (prompt) =>
  `🎭 [BOT mengirim ANIMASI karakter tanpa wajah buatan sendiri (tokoh bergerak + narasi + subtitle) sesuai permintaan: "${String(prompt ?? "").replace(/\s+/g, " ").replace(/"/g, "'").slice(0, 200)}"]`;

export const videoSentNote = (prompt) =>
  `🎬 [BOT mengirim VIDEO buatan AI sesuai permintaan: "${String(prompt ?? "").replace(/\s+/g, " ").replace(/"/g, "'").slice(0, 200)}"]`;

/**
 * deps: { imageGen:{available,generate,problem}, speaker?:{available,speak}, writeScript?:({system,user})=>Promise<string>,
 *         state?, config, spawnImpl?, log?, now?, tmpRoot? }
 */
export function createVideoGen({ imageGen, speaker = null, writeScript = null, editImage = null, state = null, config = readVideoConfig({}), spawnImpl = spawn, log = console, now = () => Date.now(), tmpRoot = os.tmpdir() } = {}) {
  let groupsOn = true;
  const freshQuota = (day) => ({ day, owner: 0, group: 0, people: {}, photo: { owner: 0, group: 0, people: {} }, morph: { owner: 0 } });
  let quota = freshQuota(hariWita(now()));
  let running = 0;
  const waiters = [];
  let ffState = null; // "ok" | "missing"
  let ffAt = 0;
  const stats = { ok: 0, fail: 0, lastOkAt: 0, lastError: "", lastSeconds: 0 };

  const available = () => config.enabled && Boolean(imageGen?.available?.());
  const groupEnabled = () => groupsOn && available();
  // Foto hidup tidak butuh pembuat gambar/AI: cukup ffmpeg di laptop.
  const photoAvailable = () => config.enabled;
  const photoGroupEnabled = () => groupsOn && photoAvailable();
  // Animasi karakter: cukup ffmpeg (latar gambar AI bersifat opsional).
  const storyAvailable = () => config.enabled;
  const storyGroupEnabled = () => groupsOn && storyAvailable();
  // Morf foto: butuh pembuat edit foto (Cloudflare) + ffmpeg. Prototipe: hanya pemilik.
  const morphAvailable = () => config.enabled && typeof editImage === "function" && (imageGen?.canEdit ? Boolean(imageGen.canEdit()) : true);

  async function load() {
    if (!state) return groupsOn;
    try {
      groupsOn = (await state.get(STATE_KEY)) !== "off";
      const q = await state.get(QUOTA_KEY);
      if (q && typeof q === "object" && q.day === hariWita(now())) {
        const p = q.photo && typeof q.photo === "object" ? q.photo : {};
        quota = { day: q.day, owner: q.owner | 0, group: q.group | 0, people: { ...(q.people || {}) }, photo: { owner: p.owner | 0, group: p.group | 0, people: { ...(p.people || {}) } }, morph: { owner: (q.morph && q.morph.owner) | 0 } };
      }
    } catch (e) {
      log.warn?.(`🎬 [Video] gagal membaca pengaturan tersimpan: ${e instanceof Error ? e.message : e}`);
    }
    return groupsOn;
  }

  async function setGroup(value) {
    groupsOn = Boolean(value);
    let saved = true;
    try {
      await state?.set(STATE_KEY, groupsOn ? "on" : "off");
    } catch {
      saved = false;
    }
    return { on: groupsOn, saved };
  }

  function rollDay() {
    const d = hariWita(now());
    if (quota.day !== d) quota = freshQuota(d);
  }
  async function saveQuota() {
    try {
      await state?.set(QUOTA_KEY, quota);
    } catch {
      /* hanya berlaku sampai bot restart */
    }
  }

  /** pool "ai" = video dari ide (butuh gambar AI); pool "photo" = foto hidup (hanya CPU). */
  async function reserve(kind, who = "", pool = "ai") {
    rollDay();
    if (pool === "morph") {
      if (kind !== "owner") return { ok: false, reason: "Morf foto masih percobaan: baru bisa dipakai pemilik (lewat Telegram atau chat pribadi WhatsApp)." };
      if (config.morphOwnerDaily > 0 && quota.morph.owner >= config.morphOwnerDaily) return { ok: false, reason: `Jatah morf foto hari ini (${config.morphOwnerDaily}) sudah habis. Reset 00.00 WITA.` };
      quota.morph.owner += 1;
      await saveQuota();
      let done = false;
      return {
        ok: true,
        release: async () => {
          if (done) return;
          done = true;
          rollDay();
          quota.morph.owner = Math.max(0, quota.morph.owner - 1);
          await saveQuota();
        }
      };
    }
    const photo = pool === "photo";
    const q = photo ? quota.photo : quota;
    const lim = photo ? { owner: config.photoOwnerDaily, group: config.photoGroupDaily, person: config.photoPersonDaily } : { owner: config.ownerDaily, group: config.groupDaily, person: config.personDaily };
    const what = photo ? "foto hidup" : "video";
    if (kind === "owner") {
      if (lim.owner > 0 && q.owner >= lim.owner) return { ok: false, reason: `Jatah ${what} pemilik hari ini (${lim.owner}) sudah habis. Reset 00.00 WITA.` };
      q.owner += 1;
    } else {
      if (lim.group > 0 && q.group >= lim.group) return { ok: false, reason: `Jatah ${what} untuk semua grup hari ini (${lim.group}) sudah habis. Coba lagi besok ya.` };
      const key = String(who || "?");
      if (lim.person > 0 && (q.people[key] || 0) >= lim.person) return { ok: false, reason: `Jatah ${what}mu hari ini (${lim.person}) sudah habis. Coba lagi besok ya.` };
      q.group += 1;
      q.people[key] = (q.people[key] || 0) + 1;
    }
    await saveQuota();
    let released = false;
    return {
      ok: true,
      release: async () => {
        if (released) return;
        released = true;
        rollDay();
        const qq = photo ? quota.photo : quota;
        if (kind === "owner") qq.owner = Math.max(0, qq.owner - 1);
        else {
          qq.group = Math.max(0, qq.group - 1);
          const key = String(who || "?");
          qq.people[key] = Math.max(0, (qq.people[key] || 0) - 1);
        }
        await saveQuota();
      }
    };
  }

  async function checkFfmpeg() {
    if (ffState === "ok" || (ffState && now() - ffAt < 60_000)) return ffState;
    ffAt = now();
    try {
      const r = await runProc(config.ffmpeg, ["-hide_banner", "-version"], { timeoutMs: 10_000, spawnImpl });
      ffState = r.code === 0 ? "ok" : "missing";
    } catch {
      ffState = "missing";
    }
    return ffState;
  }

  /** Giliran rakit: satu per satu. -> release() atau null bila antrean penuh. */
  async function acquire() {
    if (running < 1) {
      running += 1;
      return release;
    }
    if (waiters.length >= config.queue) return null;
    await new Promise((resolve) => waiters.push(resolve));
    return release;
  }
  function release() {
    const next = waiters.shift();
    if (next) next();
    else running = Math.max(0, running - 1);
  }

  function pickFont() {
    if (config.font && fs.existsSync(config.font)) return config.font;
    return FONT_CANDIDATES.find((f) => {
      try {
        return fs.existsSync(f);
      } catch {
        return false;
      }
    }) || "";
  }

  async function makeScript(idea, n) {
    if (writeScript) {
      try {
        const p = buildScriptPrompt(idea, n, config.narrationChars);
        const sc = parseScript(await writeScript(p), n, config.narrationChars);
        if (sc) return sc;
        log.warn?.("🎬 [Video] naskah AI tidak bisa dibaca, pakai cadangan.");
      } catch (e) {
        log.warn?.(`🎬 [Video] naskah AI gagal (${e instanceof Error ? e.message : e}), pakai cadangan.`);
      }
    }
    return fallbackScript(idea, n);
  }

  /** Bangun video. -> { buffer, seconds, scenes, silent, title, fallback } atau melempar Error (.kind). */
  async function build(idea, n, { onStage = () => {} } = {}) {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "vid-"));
    try {
      onStage("script");
      const script = await makeScript(idea, n);
      const scenes = script.scenes;
      const style = script.style || "cinematic illustration";

      // ---- gambar tiap adegan
      onStage("images");
      const files = [];
      let lastGood = null;
      let firstErr = null;
      for (let i = 0; i < scenes.length; i++) {
        let img = null;
        const prompt = `${style}. ${scenes[i].visual}. No text, no letters, no watermark.`.slice(0, 560);
        for (let attempt = 0; attempt < 2 && !img; attempt++) {
          try {
            img = await imageGen.generate(prompt);
          } catch (e) {
            if (!firstErr) firstErr = e;
            log.warn?.(`🎬 [Video] gambar adegan ${i + 1} gagal (percobaan ${attempt + 1}): ${String(e?.message || e).slice(0, 120)}`);
            if (e?.kind === "quota" || e?.kind === "billing" || e?.kind === "auth") break;
          }
        }
        if (!img && lastGood) img = lastGood; // pakai gambar sebelumnya (gerak kamera berbeda)
        if (!img) {
          // adegan pertama gagal sama sekali: tidak ada bahan
          throw Object.assign(new Error(firstErr?.message || "Gambar gagal dibuat."), { kind: firstErr?.kind || "unavailable", detail: firstErr?.detail || "" });
        }
        lastGood = img;
        const ext = /jpe?g/i.test(img.mime || "") ? "jpg" : /webp/i.test(img.mime || "") ? "webp" : "png";
        const f = path.join(dir, `img${i}.${ext}`);
        fs.writeFileSync(f, img.buffer);
        files.push(f);
      }

      // ---- suara (sekali untuk seluruh narasi)
      let narrFile = null;
      let narrSec = 0;
      const narration = scenes.map((s) => s.narration).join(" ").replace(/\s+/g, " ").trim();
      if (narration && speaker?.available?.()) {
        onStage("voice");
        try {
          const sp = await speaker.speak(narration);
          if (sp?.ogg?.length) {
            narrFile = path.join(dir, "narasi.ogg");
            fs.writeFileSync(narrFile, sp.ogg);
            narrSec = await audioSeconds(config.ffmpeg, narrFile, { spawnImpl });
            if (!(narrSec > 1)) narrFile = null;
          }
        } catch (e) {
          log.warn?.(`🎬 [Video] suara gagal, video dibuat tanpa suara: ${String(e?.message || e).slice(0, 120)}`);
          narrFile = null;
        }
      }

      // ---- rakit
      onStage("render");
      const durs = sceneDurations(scenes, narrFile ? narrSec : 0);
      const font = pickFont();
      const clips = [];
      for (let i = 0; i < scenes.length; i++) {
        const out = path.join(dir, `clip${i}.mp4`);
        const sub = scenes[i].narration ? wrapSubtitle(scenes[i].narration) : "";
        let textFile = null;
        if (sub) {
          textFile = path.join(dir, `sub${i}.txt`);
          fs.writeFileSync(textFile, sub, "utf8");
        }
        let r = await runProc(config.ffmpeg, clipArgs({ image: files[i], out, dur: durs[i], index: i, textFile, font }), { timeoutMs: config.stepTimeoutMs, spawnImpl });
        if (r.code !== 0 && textFile) {
          log.warn?.(`🎬 [Video] drawtext gagal, adegan ${i + 1} tanpa subtitle: ${r.stderr.slice(-160)}`);
          r = await runProc(config.ffmpeg, clipArgs({ image: files[i], out, dur: durs[i], index: i }), { timeoutMs: config.stepTimeoutMs, spawnImpl });
        }
        if (r.code !== 0) throw Object.assign(new Error(`ffmpeg adegan ${i + 1}: ${r.stderr.slice(-200)}`), { kind: "render" });
        clips.push(out);
      }
      const list = path.join(dir, "list.txt");
      fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
      const total = durs.reduce((a, b) => a + b, 0);
      const final = path.join(dir, "video.mp4");
      const base = ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list];
      const args = narrFile
        ? [...base, "-i", narrFile, "-filter_complex", `[1:a]adelay=${Math.round(LEAD_SEC * 1000)}:all=1,apad[a]`, "-map", "0:v", "-map", "[a]", "-t", total.toFixed(2), "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-movflags", "+faststart", final]
        : [...base, "-c:v", "copy", "-an", "-movflags", "+faststart", final];
      const rm = await runProc(config.ffmpeg, args, { timeoutMs: config.stepTimeoutMs, spawnImpl });
      if (rm.code !== 0) throw Object.assign(new Error(`ffmpeg gabung: ${rm.stderr.slice(-200)}`), { kind: "render" });

      let buffer = fs.readFileSync(final);
      if (buffer.length > MAX_FILE_BYTES) {
        const small = path.join(dir, "kecil.mp4");
        const rs = await runProc(config.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", final, "-vf", "scale=854:480", "-c:v", "libx264", "-preset", "veryfast", "-crf", "34", "-c:a", "copy", "-movflags", "+faststart", small], { timeoutMs: config.stepTimeoutMs, spawnImpl });
        if (rs.code === 0) buffer = fs.readFileSync(small);
      }
      if (buffer.length < 2000) throw Object.assign(new Error("Video hasil rakitan kosong."), { kind: "render" });
      return { buffer, mime: "video/mp4", seconds: Math.round(total), scenes: scenes.length, silent: !narrFile, title: script.title, fallback: Boolean(script.fallback) };
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* sisa folder sementara tidak fatal */
      }
    }
  }

  async function makeStoryScript(idea, n) {
    if (writeScript) {
      try {
        const sc = parseStoryScript(await writeScript(buildStoryPrompt(idea, n, config.narrationChars)), n, config.narrationChars);
        if (sc) return sc;
        log.warn?.("🎭 [Animasi] naskah AI tidak bisa dibaca, pakai cadangan.");
      } catch (e) {
        log.warn?.(`🎭 [Animasi] naskah AI gagal (${e instanceof Error ? e.message : e}), pakai cadangan.`);
      }
    }
    return fallbackStory(idea, n);
  }

  /** Suara narasi sekali jalan -> { narrFile, narrSec } (narrFile null bila tanpa suara). */
  async function makeVoice(dir, scenes, onStage) {
    const narration = scenes.map((s) => s.narration).join(" ").replace(/\s+/g, " ").trim();
    if (!narration || !speaker?.available?.()) return { narrFile: null, narrSec: 0 };
    onStage("voice");
    try {
      const sp = await speaker.speak(narration);
      if (sp?.ogg?.length) {
        const narrFile = path.join(dir, "narasi.ogg");
        fs.writeFileSync(narrFile, sp.ogg);
        const narrSec = await audioSeconds(config.ffmpeg, narrFile, { spawnImpl });
        if (narrSec > 1) return { narrFile, narrSec };
      }
    } catch (e) {
      log.warn?.(`🎬 [Video] suara gagal, video dibuat tanpa suara: ${String(e?.message || e).slice(0, 120)}`);
    }
    return { narrFile: null, narrSec: 0 };
  }

  /** Gabung klip + suara -> { buffer, total }. Video >15 MB dikecilkan ke 854x480. */
  async function joinClips(dir, clips, durs, narrFile) {
    const list = path.join(dir, "list.txt");
    fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
    const total = durs.reduce((a, b) => a + b, 0);
    const final = path.join(dir, "video.mp4");
    const base = ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list];
    const args = narrFile
      ? [...base, "-i", narrFile, "-filter_complex", `[1:a]adelay=${Math.round(LEAD_SEC * 1000)}:all=1,apad[a]`, "-map", "0:v", "-map", "[a]", "-t", total.toFixed(2), "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-movflags", "+faststart", final]
      : [...base, "-c:v", "copy", "-an", "-movflags", "+faststart", final];
    const rm = await runProc(config.ffmpeg, args, { timeoutMs: config.stepTimeoutMs, spawnImpl });
    if (rm.code !== 0) throw Object.assign(new Error(`ffmpeg gabung: ${rm.stderr.slice(-200)}`), { kind: "render" });
    let buffer = fs.readFileSync(final);
    if (buffer.length > MAX_FILE_BYTES) {
      const small = path.join(dir, "kecil.mp4");
      const rs = await runProc(config.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", final, "-vf", "scale=854:480", "-c:v", "libx264", "-preset", "veryfast", "-crf", "34", "-c:a", "copy", "-movflags", "+faststart", small], { timeoutMs: config.stepTimeoutMs, spawnImpl });
      if (rs.code === 0) buffer = fs.readFileSync(small);
    }
    if (buffer.length < 2000) throw Object.assign(new Error("Video hasil rakitan kosong."), { kind: "render" });
    return { buffer, total };
  }

  /** ANIMASI KARAKTER: naskah (tokoh + aksi) -> latar (gambar AI atau buatan kode) -> suara -> frame digambar kode -> rakit. */
  async function buildStory(idea, n, { onStage = () => {}, style = "" } = {}) {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "ani-"));
    try {
      onStage("script");
      const script = await makeStoryScript(idea, n);
      const scenes = script.scenes;
      const castMap = new Map(script.cast.map((c, i) => [String(c.id), makeCharacter(c, i)]));

      // ---- latar tiap adegan: gambar AI bila ada (deskripsi sama dipakai ulang), kalau gagal latar buatan kode
      onStage("images");
      const cache = new Map();
      let aiOff = !imageGen?.available?.();
      const bgFiles = [];
      for (let i = 0; i < scenes.length; i++) {
        const desc = scenes[i].bg;
        let img = null;
        if (!aiOff && desc) {
          const key = desc.toLowerCase();
          if (cache.has(key)) img = cache.get(key);
          else {
            const prompt = `Flat 2D vector cartoon illustration, simple shapes, soft bright colors, wide landscape background. ${desc}. Empty scene with open ground in the lower third. No people, no characters, no animals, no text, no letters, no watermark.`.slice(0, 560);
            try {
              img = await imageGen.generate(prompt);
            } catch (e) {
              log.warn?.(`🎭 [Animasi] latar adegan ${i + 1} gagal, pakai latar buatan kode: ${String(e?.message || e).slice(0, 120)}`);
              if (e?.kind === "quota" || e?.kind === "billing" || e?.kind === "auth") aiOff = true;
            }
            cache.set(key, img);
          }
        }
        bgFiles.push(writeBackground(dir, `bg${i}`, img, scenes[i].setting, 100 + i));
      }

      const { narrFile, narrSec } = await makeVoice(dir, scenes, onStage);

      // ---- gambar frame per adegan + rakit
      onStage("render");
      const durs = sceneDurations(scenes, narrFile ? narrSec : 0);
      const font = pickFont();
      const clips = [];
      for (let i = 0; i < scenes.length; i++) {
        const out = path.join(dir, `clip${i}.mp4`);
        const sub = scenes[i].narration ? wrapSubtitle(scenes[i].narration, 52, 2) : "";
        let textFile = null;
        if (sub) {
          textFile = path.join(dir, `sub${i}.txt`);
          fs.writeFileSync(textFile, sub, "utf8");
        }
        const zoomIn = i % 2 === 0;
        const r = await renderSceneClip({
          scene: scenes[i], castMap, bgFile: bgFiles[i], out, dur: durs[i], textFile, font,
          camFrom: zoomIn ? 1 : 1 + CAM_ZOOM, camTo: zoomIn ? 1 + CAM_ZOOM : 1, style,
          ffmpeg: config.ffmpeg, spawnImpl, timeoutMs: config.stepTimeoutMs, log
        });
        if (r.code !== 0) throw Object.assign(new Error(`ffmpeg animasi adegan ${i + 1}: ${r.stderr.slice(-200)}`), { kind: "render" });
        clips.push(out);
      }
      const { buffer, total } = await joinClips(dir, clips, durs, narrFile);
      return { buffer, mime: "video/mp4", seconds: Math.round(total), scenes: scenes.length, silent: !narrFile, title: script.title, fallback: Boolean(script.fallback), mode: "karakter", style, cast: castMap.size };
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* sisa folder sementara tidak fatal */
      }
    }
  }

  /**
   * Satu paket untuk pemanggil: cek -> jatah -> antre -> bangun.
   * -> { video:{buffer,mime,seconds,scenes,silent,title} } atau { error, kind }.
   * opts.seconds = durasi yang diminta; opts.onStage(stage) dipanggil: "script"|"images"|"voice"|"render".
   */
  async function make(prompt, kind = "owner", who = "", opts = {}) {
    if (!config.enabled) return { error: VIDEO_TEXT.off, kind: "off" };
    const p = cleanPrompt(prompt);
    if (!p) return { error: VIDEO_TEXT.empty, kind: "empty" };
    const bad = promptProblem(p);
    if (bad) return { error: bad.replace("gambar", "video"), kind: "refused" };
    if (imageGen?.problem) {
      const b2 = imageGen.problem(p);
      if (b2) return { error: b2.replace("gambar", "video"), kind: "refused" };
    }
    const story = opts.mode === "karakter";
    // animasi karakter tidak wajib punya pembuat gambar (latar cadangan digambar kode); video gambar biasa wajib
    if (!story && !imageGen?.available?.()) return { error: VIDEO_TEXT.noimage, kind: "nokey" };
    if ((await checkFfmpeg()) !== "ok") return { error: VIDEO_TEXT.noffmpeg, kind: "noffmpeg" };
    const slot = await reserve(kind, who);
    if (!slot.ok) return { error: slot.reason, kind: "limit" };
    const done = await acquire();
    if (!done) {
      await slot.release().catch(() => {});
      return { error: VIDEO_TEXT.busy, kind: "busy" };
    }
    const t0 = now();
    try {
      const n = sceneCount(opts.seconds || 0, config);
      const video = await (story ? buildStory : build)(p.slice(0, config.promptMax), n, { onStage: opts.onStage || (() => {}), style: story ? opts.style || "" : "" });
      stats.ok += 1;
      stats.lastOkAt = now();
      stats.lastSeconds = Math.round((now() - t0) / 1000);
      return { video };
    } catch (e) {
      stats.fail += 1;
      stats.lastError = String(e?.message || e).slice(0, 160);
      await slot.release().catch(() => {});
      const k = e?.kind || "unavailable";
      const text = k === "render" ? VIDEO_TEXT.fail : e instanceof Error ? e.message : String(e);
      log.warn?.(`🎬 [Video] gagal (${k}): ${stats.lastError}`);
      return { error: text, kind: k, detail: e?.detail || (k === "render" ? stats.lastError : "") };
    } finally {
      done();
    }
  }

  /**
   * FOTO HIDUP: foto (Buffer) + kalimat permintaan ("dengan salju 10 detik tulisan 'Selamat Pagi'") -> video MP4.
   * -> { video:{buffer,mime,seconds,width,height,effects,motion,grade,title} } atau { error, kind }. Tanpa AI/kuota gambar.
   */
  async function makeFromPhoto(photo, text = "", kind = "owner", who = "", opts = {}) {
    if (!config.enabled) return { error: VIDEO_TEXT.off, kind: "off" };
    if (!Buffer.isBuffer(photo) || photo.length < 100) return { error: VIDEO_TEXT.badphoto, kind: "badimage" };
    const bad = promptProblem(String(text ?? ""));
    if (bad) return { error: bad.replace("gambar", "video"), kind: "refused" };
    if ((await checkFfmpeg()) !== "ok") return { error: VIDEO_TEXT.noffmpeg, kind: "noffmpeg" };
    const options = parsePhotoOptions(text, { maxSeconds: config.photoMaxSeconds });
    const slot = await reserve(kind, who, "photo");
    if (!slot.ok) return { error: slot.reason, kind: "limit" };
    const done = await acquire();
    if (!done) {
      await slot.release().catch(() => {});
      return { error: VIDEO_TEXT.busy, kind: "busy" };
    }
    const t0 = now();
    try {
      const video = await buildPhotoVideo(photo, options, { ffmpeg: config.ffmpeg, spawnImpl, tmpRoot, font: pickFont(), log, stepTimeoutMs: config.stepTimeoutMs, onStage: opts.onStage || (() => {}) });
      stats.ok += 1;
      stats.lastOkAt = now();
      stats.lastSeconds = Math.round((now() - t0) / 1000);
      return { video };
    } catch (e) {
      stats.fail += 1;
      stats.lastError = String(e?.message || e).slice(0, 160);
      await slot.release().catch(() => {});
      const k = e?.kind || "unavailable";
      const text2 = k === "render" ? VIDEO_TEXT.fail : k === "badimage" ? VIDEO_TEXT.badphoto : e instanceof Error ? e.message : String(e);
      log.warn?.(`🎞️ [FotoHidup] gagal (${k}): ${stats.lastError}`);
      return { error: text2, kind: k, detail: e?.detail || (k === "render" ? stats.lastError : "") };
    } finally {
      done();
    }
  }

  /**
   * MORF FOTO (prototipe, pemilik): foto + "siang jadi malam bersalju 8 detik 5 tahap [halus]" -> video yang berubah.
   * -> { video:{buffer,mime,seconds,width,height,frames,planned,smooth,steps,fallback} } atau { error, kind }.
   */
  async function makeMorph(photo, text = "", kind = "owner", who = "", opts = {}) {
    if (!config.enabled) return { error: VIDEO_TEXT.off, kind: "off" };
    if (!Buffer.isBuffer(photo) || photo.length < 100) return { error: VIDEO_TEXT.badphoto, kind: "badimage" };
    if (!morphAvailable()) return { error: VIDEO_TEXT.nomorph, kind: "noedit" };
    const options = parseMorphOptions(text, { defaultSteps: config.morphSteps, maxSteps: config.morphMaxSteps, maxSeconds: config.morphMaxSeconds, defaultSeconds: config.morphSeconds });
    if (!options.prompt) return { error: VIDEO_TEXT.morphempty, kind: "empty" };
    const bad = promptProblem(options.prompt) || editPromptProblem(options.prompt);
    if (bad) return { error: bad.replace("gambar", "video"), kind: "refused" };
    if ((await checkFfmpeg()) !== "ok") return { error: VIDEO_TEXT.noffmpeg, kind: "noffmpeg" };
    const slot = await reserve(kind, who, "morph");
    if (!slot.ok) return { error: slot.reason, kind: "limit" };
    const done = await acquire();
    if (!done) {
      await slot.release().catch(() => {});
      return { error: VIDEO_TEXT.busy, kind: "busy" };
    }
    const t0 = now();
    try {
      const n = options.steps;
      let plan = { steps: parseMorphPlan("", n, options.prompt).steps, fallback: true };
      if (writeScript) {
        try {
          const p = buildMorphPrompt(options.prompt, n);
          plan = parseMorphPlan(await writeScript(p), n, options.prompt);
        } catch (e) {
          log.warn?.(`🧬 [Morf] rencana AI gagal, pakai cadangan: ${e instanceof Error ? e.message : e}`);
        }
      }
      // tiap instruksi ikut disaring seperti edit foto biasa (mis. tidak boleh melepas pakaian)
      const worst = plan.steps.map((st) => editPromptProblem(st) || promptProblem(st)).find(Boolean);
      if (worst) throw Object.assign(new Error(worst), { kind: "refused" });
      const video = await buildMorphVideo(photo, plan.steps, options, { editImage, ffmpeg: config.ffmpeg, spawnImpl, tmpRoot, log, stepTimeoutMs: config.stepTimeoutMs, onStage: opts.onStage || (() => {}), chain: config.morphChain });
      stats.ok += 1;
      stats.lastOkAt = now();
      stats.lastSeconds = Math.round((now() - t0) / 1000);
      return { video: { ...video, steps: plan.steps, fallback: plan.fallback, prompt: options.prompt } };
    } catch (e) {
      stats.fail += 1;
      stats.lastError = String(e?.message || e).slice(0, 160);
      await slot.release().catch(() => {});
      const k = e?.kind || "unavailable";
      const text2 = k === "render" ? VIDEO_TEXT.fail : k === "badimage" ? VIDEO_TEXT.badphoto : e instanceof Error ? e.message : String(e);
      log.warn?.(`🧬 [Morf] gagal (${k}): ${stats.lastError}`);
      return { error: text2, kind: k, detail: e?.detail || (k === "render" ? stats.lastError : "") };
    } finally {
      done();
    }
  }

  /**
   * STOP MOTION: foto-foto berurutan (array Buffer) + "10 fps bolak-balik tulisan 'Judul'" -> video MP4 (pemilik; jatah foto hidup).
   * -> { video:{buffer,mime,seconds,width,height,frames,photos,skipped,fps,title} } atau { error, kind }.
   */
  async function makeStopMotion(photos, text = "", kind = "owner", who = "", opts = {}) {
    if (!config.enabled) return { error: VIDEO_TEXT.off, kind: "off" };
    const list = (Array.isArray(photos) ? photos : []).filter((b) => Buffer.isBuffer(b) && b.length >= 100);
    if (list.length < MIN_STOP_PHOTOS) return { error: VIDEO_TEXT.stoptoofew, kind: "toofew" };
    if (list.length > config.stopMaxPhotos) return { error: `Maksimal ${config.stopMaxPhotos} foto per stop motion (kamu mengirim ${list.length}).`, kind: "toomany" };
    const options = parseStopMotionOptions(text, { maxFps: config.stopMaxFps });
    const bad = options.title ? promptProblem(options.title) : null;
    if (bad) return { error: bad.replace("gambar", "video"), kind: "refused" };
    if ((await checkFfmpeg()) !== "ok") return { error: VIDEO_TEXT.noffmpeg, kind: "noffmpeg" };
    const slot = await reserve(kind, who, "photo");
    if (!slot.ok) return { error: slot.reason, kind: "limit" };
    const done = await acquire();
    if (!done) {
      await slot.release().catch(() => {});
      return { error: VIDEO_TEXT.busy, kind: "busy" };
    }
    const t0 = now();
    try {
      const video = await buildStopMotion(list, options, { ffmpeg: config.ffmpeg, spawnImpl, tmpRoot, font: pickFont(), log, stepTimeoutMs: config.stepTimeoutMs, onStage: opts.onStage || (() => {}) });
      stats.ok += 1;
      stats.lastOkAt = now();
      stats.lastSeconds = Math.round((now() - t0) / 1000);
      return { video: { ...video, title: options.title } };
    } catch (e) {
      stats.fail += 1;
      stats.lastError = String(e?.message || e).slice(0, 160);
      await slot.release().catch(() => {});
      const k = e?.kind || "unavailable";
      const text2 = k === "render" ? VIDEO_TEXT.fail : k === "toofew" ? VIDEO_TEXT.stoptoofew : e instanceof Error ? e.message : String(e);
      log.warn?.(`🧱 [StopMotion] gagal (${k}): ${stats.lastError}`);
      return { error: text2, kind: k, detail: e?.detail || (k === "render" ? stats.lastError : "") };
    } finally {
      done();
    }
  }

  function describe() {
    return [
      `Status: ${available() ? "aktif" : config.enabled ? "belum bisa (pembuat gambar belum aktif)" : "dimatikan (VIDEO_ENABLED=0)"}; grup WA: ${groupsOn ? "boleh" : "mati"}`,
      `Adegan: ${config.scenes} (maks ${config.maxScenes}); satu video ≈ ${config.scenes} gambar + 1 suara`,
      `Jatah harian: pemilik ${config.ownerDaily || "tanpa batas"}, semua grup ${config.groupDaily || "tanpa batas"}, per orang di grup ${config.personDaily || "tanpa batas"}`,
      `Animasi karakter tanpa wajah (cerita bertokoh, digambar kode): ${imageGen?.available?.() ? "latar gambar AI" : "latar buatan kode (pembuat gambar belum aktif)"}; memakai jatah video yang sama`,
      `Foto hidup (foto -> video + efek, tanpa AI): jatah pemilik ${config.photoOwnerDaily || "tanpa batas"}, semua grup ${config.photoGroupDaily || "tanpa batas"}, per orang ${config.photoPersonDaily || "tanpa batas"}; hari ini pemilik ${quota.photo.owner}, grup ${quota.photo.group}`,
      `Morf foto (percobaan, pemilik saja; foto + deskripsi -> ${config.morphSteps} edit AI -> video): ${morphAvailable() ? "aktif" : "belum aktif (butuh Cloudflare untuk edit foto)"}; jatah ${config.morphOwnerDaily || "tanpa batas"}/hari, hari ini ${quota.morph.owner}`,
      `Stop motion (foto berurutan -> video, sesi /stopmotion di Telegram, pemilik; memakai jatah foto hidup): maks ${config.stopMaxPhotos} foto, ${config.stopMaxFps} gambar/dtk`,
      `Hari ini: pemilik ${quota.owner}, grup ${quota.group}; berhasil ${stats.ok}, gagal ${stats.fail}${stats.lastSeconds ? `, rakit terakhir ${stats.lastSeconds} dtk` : ""}${stats.lastError ? `\nGalat terakhir: ${stats.lastError}` : ""}`
    ].join("\n");
  }

  function parseCommand(arg) {
    const a = String(arg ?? "").trim();
    if (!a || /^(?:status|info)$/i.test(a)) return { kind: "status" };
    const m = /^(?:grup|group|wag)\s+(on|off|aktif|mati|nyala)$/i.exec(a);
    if (m) return { kind: "group", value: /^(?:on|aktif|nyala)$/i.test(m[1]) };
    const mo = detectMorphRequest(`/video ${a}`, { hasImage: false });
    if (mo) return { kind: "morph", text: mo.text };
    const d = detectVideoRequest(`/video ${a}`);
    const res = { kind: "prompt", prompt: d?.prompt ?? "", seconds: d?.seconds ?? 0 };
    // "/video animasi kancil dan buaya" / "/video kartun ..." -> animasi karakter
    const lead = /^(?:animasi|animation|kartun|cartoon|karakter)\b[:,]?\s*(.*)$/is.exec(a);
    const style = detectStoryStyle(a); // "stopmotion" = gaya potongan kertas, ±8 gambar/dtk
    if (lead) {
      const d2 = detectVideoRequest(`/video ${style ? stripStoryStyle(lead[1]) : lead[1]}`);
      return { kind: "prompt", prompt: d2?.prompt ?? "", seconds: d2?.seconds ?? 0, mode: "karakter", ...(style ? { style } : {}) };
    }
    if (detectStoryMode(a)) {
      res.mode = "karakter";
      if (style) {
        res.style = style;
        res.prompt = stripStoryStyle(res.prompt);
      }
    }
    return res;
  }

  function reconfigure(next) {
    config = next;
  }

  /** Seperti detectVideoRequest, tetapi menandai mode "karakter" bila kalimatnya meminta animasi/kartun. */
  function detect(text) {
    const r = detectVideoRequest(text);
    if (r && detectStoryMode(text)) {
      const style = detectStoryStyle(text);
      return { ...r, mode: "karakter", ...(style ? { style, prompt: stripStoryStyle(r.prompt) } : {}) };
    }
    return r;
  }

  return { available, groupEnabled, storyAvailable, storyGroupEnabled, morphAvailable, detectMorph: detectMorphRequest, makeMorph, makeStopMotion, stopLimits: () => ({ maxPhotos: config.stopMaxPhotos, maxFps: config.stopMaxFps }), photoAvailable, photoGroupEnabled, load, setGroup, reserve, make, makeFromPhoto, detectPhoto: detectPhotoVideoRequest, describe, parseCommand, reconfigure, detect, checkFfmpeg, stats: () => ({ ...stats }) };
}
