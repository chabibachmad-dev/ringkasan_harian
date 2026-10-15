// Balasan SUARA untuk grup WhatsApp, diatur dari Telegram:  /voice wag on  |  /voice wag off
//
//   wag on  -> bot membalas di grup dengan VOICE NOTE saja (tanpa teks / transkrip yang ikut terkirim).
//   wag off -> balasan grup berupa teks (bawaan).
//
// Pengaturan disimpan di tabel bot_state (kunci wa_group_voice) sehingga bertahan setelah restart; tidak perlu menyentuh .env.
// Suara dibuat oleh voice-output.js (Gemini TTS + ffmpeg), sama dengan balasan suara Telegram.
//
// Voice note TIDAK dipakai (balasan tetap dikirim sebagai teks) bila:
//   - jawabannya memuat tautan, blok kode, atau tabel (tidak bisa "dibacakan" dengan benar),
//   - jawabannya lebih panjang dari WA_GROUP_VOICE_MAX_CHARS (suara akan terpotong, sedangkan teks utuh),
//   - suara gagal dibuat (ffmpeg belum ada, kuota suara habis, lewat batas waktu) -- jawaban TIDAK PERNAH hilang; pemilik diberi tahu sekali.
//
// .env (semua opsional):
//   WA_GROUP_VOICE_MAX_CHARS=600     batas panjang jawaban yang dibacakan (80-1500; juga dibatasi TTS_MAX_CHARS)
//   WA_GROUP_VOICE_TIMEOUT_MS=30000  batas waktu membuat suara; lewat itu -> kirim teks

import { speakableText } from "./voice-output.js";

export const STATE_KEY = "wa_group_voice";

export function readGroupVoiceConfig(env = process.env, ttsMax = 700) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    maxChars: Math.max(80, Math.min(Math.floor(num(env.WA_GROUP_VOICE_MAX_CHARS, 600)), 1500, ttsMax)),
    timeoutMs: Math.max(5000, Math.min(Math.floor(num(env.WA_GROUP_VOICE_TIMEOUT_MS, 30_000)), 120_000))
  };
}

/**
 * "/voice ..." -> { kind, ... } :
 *   { kind: "status" }                       /voice
 *   { kind: "wag", value: "on"|"off"|null }  /voice wag [on|off]   (null = hanya lihat)
 *   { kind: "tg", arg }                      /voice tg auto|on|off  (sama dengan /suara)
 *   { kind: "error", error }
 */
export function parseVoiceArg(arg) {
  const text = String(arg ?? "").trim().toLowerCase();
  if (!text) return { kind: "status" };
  const [target, ...rest] = text.split(/\s+/);
  const value = rest.join(" ");
  const ON = /^(on|aktif|nyala|hidup|ya|1)$/;
  const OFF = /^(off|mati|matikan|tidak|0)$/;
  if (/^(wag|wa|grup|group)$/.test(target)) {
    if (!value) return { kind: "wag", value: null };
    if (ON.test(value)) return { kind: "wag", value: "on" };
    if (OFF.test(value)) return { kind: "wag", value: "off" };
    return { kind: "error", error: `"${value}" tidak dikenali. Pakai: /voice wag on  atau  /voice wag off` };
  }
  if (/^(tg|telegram)$/.test(target)) return { kind: "tg", arg: value };
  return { kind: "error", error: `"${target}" tidak dikenali. Pakai: /voice wag on | /voice wag off | /voice (lihat status)` };
}

/** Haruskah balasan ini dibacakan? -> { voice: boolean, reason?: string }. */
export function decideGroupVoice(reply, { maxChars = 600 } = {}) {
  const text = String(reply ?? "");
  if (!text.trim()) return { voice: false, reason: "kosong" };
  if (/https?:\/\/|\bwww\.[a-z0-9-]+\./i.test(text)) return { voice: false, reason: "memuat tautan" };
  if (/```/.test(text)) return { voice: false, reason: "memuat kode" };
  if ((text.match(/^\s*\|.*\|\s*$/gm) || []).length >= 2) return { voice: false, reason: "memuat tabel" };
  const say = speakableText(text, 100_000);
  if (!say) return { voice: false, reason: "tidak ada yang bisa dibacakan" };
  if (say.length > maxChars) return { voice: false, reason: `terlalu panjang (${say.length} huruf)` };
  return { voice: true };
}

/**
 * deps: { state: {get,set}, speak(text) -> Promise<{ogg}|null> | null, check() -> Promise<{ok,reason?}>,
 *         notify(text) -> Promise (kabari pemilik), config: { maxChars, timeoutMs }, log, now }
 */
export function createGroupVoice({ state = null, speak = null, check = null, notify = null, config = readGroupVoiceConfig({}), log = console, now = () => Date.now() } = {}) {
  let on = false;
  const noticeAt = new Map(); // jenis masalah -> waktu pemberitahuan terakhir ke pemilik

  async function load() {
    if (!state) return on;
    try {
      on = (await state.get(STATE_KEY)) === "on";
    } catch (e) {
      log.warn?.(`🔊 [Suara grup] gagal membaca pengaturan tersimpan (anggap mati): ${e instanceof Error ? e.message : e}`);
    }
    return on;
  }

  const enabled = () => on;

  /** Ubah pengaturan. -> { on, saved, warning } ; warning bila suara belum bisa dibuat sekarang. */
  async function set(value) {
    on = Boolean(value);
    let saved = true;
    try {
      await state?.set(STATE_KEY, on ? "on" : "off");
    } catch {
      saved = false; // hanya berlaku sampai bot restart
    }
    let warning = "";
    if (on) {
      const vc = check ? await check().catch(() => ({ ok: false, reason: "pengecekan gagal" })) : { ok: Boolean(speak), reason: "suara belum diatur di bot (GEMINI_API_KEYS)" };
      if (!vc.ok) warning = vc.reason || "suara belum bisa dibuat";
    }
    return { on, saved, warning };
  }

  function describe() {
    return on ? "SUARA (voice note saja, tanpa teks)" : "teks";
  }

  async function tell(kind, everyMs, text) {
    if (!notify) return;
    if (now() - (noticeAt.get(kind) || 0) < everyMs) return;
    noticeAt.set(kind, now());
    await notify(text).catch(() => {});
  }

  /** Buat voice note untuk balasan grup. -> { ogg } atau null (artinya: kirim sebagai teks). Tidak pernah melempar galat. */
  async function tryVoice(reply) {
    if (!on || !speak) return null;
    const d = decideGroupVoice(reply, { maxChars: config.maxChars });
    if (!d.voice) {
      log.log?.(`🔊 [Suara grup] dikirim sebagai teks: ${d.reason}.`);
      return null;
    }
    let timer;
    try {
      const out = await Promise.race([
        speak(reply),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(Object.assign(new Error("pembuatan suara terlalu lama"), { timedOut: true })), config.timeoutMs);
        })
      ]);
      if (!out?.ogg) return null;
      return { ogg: out.ogg };
    } catch (e) {
      if (e?.code === "ffmpeg") await tell("ffmpeg", 6 * 3600_000, `🔇 Balasan suara di grup WhatsApp belum bisa: ${e.message} Pasang dengan: sudo apt install ffmpeg. Sementara balasan grup dikirim teks.`);
      else if (e?.quota) await tell("quota", 2 * 3600_000, "🔇 Kuota suara Gemini sedang habis, jadi balasan grup WhatsApp dikirim teks dulu. Suara aktif lagi otomatis saat kuota pulih.");
      else log.error?.(`🔊 [Suara grup] gagal, kirim teks: ${e instanceof Error ? e.message : e}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return { load, enabled, set, describe, tryVoice };
}
