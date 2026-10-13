// ================================================================
// Balasan SUARA untuk Telegram: teks -> suara natural (Gemini TTS) -> OGG/Opus (ffmpeg) -> dikirim sebagai "voice note".
//
// Kenapa ffmpeg? Telegram hanya menampilkan voice note (gelembung bergelombang yang bisa diputar) untuk OGG/Opus; Gemini TTS
// menghasilkan WAV/PCM. ffmpeg (dengan libopus) di laptop mengubahnya. Tanpa ffmpeg, bot tetap membalas teks.
//   Pasang:  sudo apt install ffmpeg      Cek: ffmpeg -version
//
// SALINAN logika supabase/functions/_shared/gemini.ts (synthesizeSpeech) untuk Node -- kalau mengubah di sana, ubah juga di sini.
//
// .env (semua opsional; memakai GEMINI_API_KEYS yang sama dengan bot):
//   GEMINI_TTS_MODELS=...      daftar model suara dicoba berurutan (kosong = bawaan di bawah)
//   TELEGRAM_TTS_VOICE=Sulafat nama suara Gemini (Aoede, Achird, Zephyr, Puck, Kore, ...); GEMINI_TTS_VOICE juga dibaca
//   TTS_MAX_CHARS=700          batas panjang teks yang DIUCAPKAN (jawaban lebih panjang: teks tetap lengkap, suara memotong di akhir kalimat)
//   FFMPEG_PATH=ffmpeg         lokasi ffmpeg bila tidak ada di PATH
// ================================================================

import { spawn } from "node:child_process";

export const DEFAULT_TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
const DEFAULT_VOICE = "Sulafat";
const DEFAULT_STYLE = "warm, friendly and relaxed, like a good friend chatting; natural conversational pace with small pauses";

const splitList = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function readTtsConfig(env = process.env) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const models = splitList(env.GEMINI_TTS_MODELS);
  return {
    geminiKeys: splitList(env.GEMINI_API_KEYS || env.GEMINI_API_KEY),
    models: models.length ? models : DEFAULT_TTS_MODELS,
    voice: String(env.TELEGRAM_TTS_VOICE || env.GEMINI_TTS_VOICE || DEFAULT_VOICE).trim(),
    maxChars: Math.max(80, Math.min(1500, Math.floor(num(env.TTS_MAX_CHARS, 700)))),
    ffmpeg: String(env.FFMPEG_PATH || "ffmpeg").trim(),
    timeoutMs: num(env.TTS_TIMEOUT_MS, 40_000)
  };
}

// ---------------------------------------------------------------- teks -> teks yang enak DIUCAPKAN
/** Buang yang tidak layak dibaca keras (kode, tautan, tanda markdown, emoji) lalu potong di akhir kalimat. "" bila tak ada yang bisa diucapkan. */
export function speakableText(text, max = 700) {
  let t = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^[ \t]*(?:[-*•]|#{1,6}|>)[ \t]+/gm, "")
    .replace(/[*~]+/g, "")
    .replace(/(^|\s)_+|_+(?=\s|$)/g, "$1")
    .replace(/[#>|]+/g, " ")
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return "";
  if (t.length > max) {
    const head = t.slice(0, max);
    const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("… "));
    t = cut > max * 0.4 ? head.slice(0, cut + 1) : head.slice(0, head.lastIndexOf(" ") > max * 0.4 ? head.lastIndexOf(" ") : max);
  }
  return t.trim();
}

// ---------------------------------------------------------------- audio
function pcmToWav(pcm, sampleRate = 24000) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

/** Ambil audio dari jawaban Gemini (bentuk Interactions maupun generateContent). -> Buffer WAV, atau null bila tak ada audio. */
export function extractTtsWav(data) {
  const found = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const inline = node.inlineData ?? node.inline_data;
    if (inline && typeof inline.data === "string") found.push({ data: inline.data, mime: String(inline.mimeType ?? inline.mime_type ?? "") });
    else if (typeof node.data === "string" && node.data.length > 200) found.push({ data: node.data, mime: String(node.mime_type ?? node.mimeType ?? "") });
    for (const k of Object.keys(node)) if (k !== "data" && k !== "inlineData" && k !== "inline_data") walk(node[k], depth + 1);
  };
  walk(data, 0);
  const hit = found.find((f) => f.data.length > 200);
  if (!hit) return null;
  const bytes = Buffer.from(hit.data, "base64");
  if (bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF") return bytes;
  const rate = Number(/rate=(\d+)/i.exec(hit.mime)?.[1] ?? 24000) || 24000;
  return pcmToWav(bytes, rate);
}

class TtsHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Waktu istirahat key setelah 429: dibaca dari "retry in 19h38m36s" bila ada; kuota harian -> lama. */
export function restMsFor429(message, daily = /PerDay|per day|harian/i.test(String(message))) {
  const m = /retry in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i.exec(String(message));
  let ms = 0;
  if (m) ms = ((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)) * 1000;
  if (!ms) ms = daily ? 6 * 3600_000 : 60_000;
  return Math.min(Math.max(ms, 30_000), 24 * 3600_000);
}

export function createSpeaker({ config = readTtsConfig(), fetchImpl = globalThis.fetch, spawnImpl = spawn, log = console, now = () => Date.now() } = {}) {
  const restUntil = new Map(); // "model|key" -> boleh dipakai lagi
  const deadUntil = new Map(); // model tak dikenal (404) -> dilewati sementara
  let ffmpegState = null; // null belum dicek | "ok" | "missing" | "noopus"
  let ffmpegCheckedAt = 0; // kegagalan hanya diingat 60 detik, supaya setelah ffmpeg dipasang tak perlu restart

  const hint = (k) => `...${String(k).slice(-4)}`;
  const available = () => config.geminiKeys.length > 0;

  function run(cmd, args, { input = null, timeoutMs = 20_000 } = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
      } catch (e) {
        return reject(e);
      }
      const out = [];
      const err = [];
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* abaikan */
        }
        reject(new Error("ffmpeg terlalu lama"));
      }, timeoutMs);
      child.stdout?.on("data", (d) => out.push(d));
      child.stderr?.on("data", (d) => err.push(d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(out));
        else reject(new Error(`ffmpeg keluar dengan kode ${code}: ${Buffer.concat(err).toString("utf8").slice(0, 200)}`));
      });
      child.stdin?.on("error", () => {});
      if (input) child.stdin?.end(input);
      else child.stdin?.end();
    });
  }

  /** "ok" bila ffmpeg + libopus tersedia. Hasil di-cache; panggil resetFfmpegCheck() bila baru memasang ffmpeg. */
  async function checkFfmpeg() {
    if (ffmpegState === "ok" || (ffmpegState && now() - ffmpegCheckedAt < 60_000)) return ffmpegState;
    ffmpegCheckedAt = now();
    try {
      const enc = await run(config.ffmpeg, ["-hide_banner", "-encoders"], { timeoutMs: 8000 });
      ffmpegState = /libopus/.test(enc.toString("utf8")) ? "ok" : "noopus";
    } catch {
      ffmpegState = "missing";
    }
    return ffmpegState;
  }

  async function toOggOpus(wav) {
    return run(config.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", "-application", "voip", "-f", "ogg", "pipe:1"], { input: wav });
  }

  async function request(url, key, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
    try {
      const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: ctrl.signal });
      const raw = await res.text();
      if (!res.ok) throw new TtsHttpError(res.status, raw.slice(0, 400));
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error("Jawaban TTS bukan JSON.");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Teks -> WAV (Buffer) lewat Gemini TTS. Melempar Error dengan .quota=true bila semua key/model kehabisan kuota. */
  async function synthWav(text) {
    if (config.geminiKeys.length === 0) throw new Error("Tidak ada GEMINI_API_KEYS untuk suara.");
    const voice = config.voice;
    const style = DEFAULT_STYLE;
    let lastErr = null;
    let sawQuota = false;
    let tried = false;
    for (const model of config.models) {
      if (now() < (deadUntil.get(model) ?? 0)) continue;
      const keys = config.geminiKeys.filter((k) => now() >= (restUntil.get(`${model}|${k}`) ?? 0));
      if (keys.length === 0) {
        sawQuota = true;
        continue;
      }
      for (const key of keys) {
        tried = true;
        const attempts = [
          () =>
            request("https://generativelanguage.googleapis.com/v1beta/interactions", key, {
              model,
              input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style }] }] }],
              response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
              generation_config: { speech_config: [{ voice }] }
            }),
          () =>
            request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, key, {
              contents: [{ role: "user", parts: [{ text: `Say this in a ${style} voice: ${text}` }] }],
              generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
            })
        ];
        let quota = false;
        let dead = false;
        for (let i = 0; i < attempts.length; i++) {
          try {
            const wav = extractTtsWav(await attempts[i]());
            if (!wav) throw new Error("Jawaban TTS tanpa audio.");
            if (wav.length < 6000) throw new Error("Audio TTS terlalu pendek/kosong.");
            return wav;
          } catch (e) {
            lastErr = e;
            const st = e?.status;
            if (st === 429) {
              quota = true;
              sawQuota = true;
              restUntil.set(`${model}|${key}`, now() + restMsFor429(e.message));
              break;
            }
            if (st === 401 || st === 403) {
              restUntil.set(`${model}|${key}`, now() + 30 * 60_000);
              break;
            }
            if (st === 404) {
              if (i === attempts.length - 1) dead = true;
              continue;
            }
            log.warn?.(`🔊 TTS ${model} ${hint(key)} gagal: ${String(e?.message || e).slice(0, 140)}`);
          }
        }
        if (dead) {
          deadUntil.set(model, now() + 30 * 60_000);
          log.warn?.(`🔊 TTS model "${model}" tidak ditemukan (404 di dua bentuk permintaan); dilewati 30 menit. Periksa GEMINI_TTS_MODELS.`);
          break;
        }
        if (quota) log.warn?.(`🔊 TTS ${model} ${hint(key)} kena batas kuota; diistirahatkan.`);
      }
    }
    const err = new Error(sawQuota && (!tried || /429|quota|exhaust/i.test(String(lastErr?.message || ""))) ? "Kuota suara Gemini sedang habis." : `Suara gagal dibuat: ${String(lastErr?.message || "semua model tidak tersedia").slice(0, 160)}`);
    err.quota = sawQuota;
    throw err;
  }

  /**
   * Teks -> voice note Telegram. Mengembalikan { ogg: Buffer, text } (text = yang benar-benar diucapkan) atau null bila tak ada yang bisa diucapkan.
   * Melempar Error dengan .code = "ffmpeg" (ffmpeg/libopus belum terpasang), atau .quota = true (kuota habis).
   */
  async function speak(text) {
    const say = speakableText(text, config.maxChars);
    if (!say) return null;
    const ff = await checkFfmpeg();
    if (ff !== "ok") {
      const e = new Error(ff === "noopus" ? "ffmpeg ada tapi tanpa libopus." : "ffmpeg belum terpasang.");
      e.code = "ffmpeg";
      throw e;
    }
    const wav = await synthWav(say);
    const ogg = await toOggOpus(wav);
    if (!ogg || ogg.length < 500) throw new Error("Konversi audio menghasilkan berkas kosong.");
    return { ogg, text: say };
  }

  return { available, speak, checkFfmpeg, resetFfmpegCheck: () => (ffmpegState = null), ffmpegState: () => ffmpegState };
}
