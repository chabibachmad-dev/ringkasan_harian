// ================================================================
// Suara di WhatsApp: tutor /speak untuk pemilik + bantuan membaca voice note.
// Tanpa efek samping ke jaringan (semua lewat dependensi yang disuntikkan), jadi mudah dites: test-wa-voice.mjs.
//
//   readWaVoiceConfig(env)  -> { speakMaxTurns, speakIdleMin, fromOthers, inGroups }
//   audioOf(content)        -> { seconds, mime, bytes } bila pesan berisi audio/voice note, selain itu null
//   createWaTutor({ tutor, speak, voiceCheck, config, log })
//       .active(jid) .sttOptions(jid) .handle(jid, text, io) .start(jid, arg, io) .end(jid, io)
//   io = { send(text), voice(ogg Buffer), busy(kind) -> stop() }   (kind: "typing" | "voice")
//
// Aturan emas: yang diproses hanya pesan PEMILIK untuk tutor. Voice note orang lain hanya diubah jadi teks
// (lalu masuk jalur auto-reply biasa), tidak pernah memulai /speak.
// ================================================================
import { isFarewellFor, formatTutorMessage, TUTOR_STT_HINT, TUTOR_STT_HINT_ID, TUTOR_TEXT_MAX, TUTOR_TEXT_MAX_ID } from "./tutor.js";

const num = (v, d) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : d;
};
const flag = (v, d) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return d;
  return !["false", "0", "off", "no", "tidak", "mati"].includes(s);
};

export function readWaVoiceConfig(env = process.env) {
  return {
    speakMaxTurns: Math.max(3, Math.min(100, Math.floor(num(env.WA_SPEAK_MAX_TURNS, 30)))),
    speakIdleMin: Math.max(5, Math.min(1440, Math.floor(num(env.WA_SPEAK_IDLE_MIN, 60)))),
    fromOthers: flag(env.WA_VOICE_FROM_OTHERS, true), // voice note kontak lain diubah jadi teks lalu dijawab auto-reply
    inGroups: flag(env.WA_VOICE_IN_GROUPS, true) // voice note di grup yang membalas (reply) pesan bot
  };
}

/** Voice note / audio dari isi pesan yang sudah dibuka bungkusnya. */
export function audioOf(content) {
  const a = content?.audioMessage;
  if (!a) return null;
  const mime = String(a.mimetype || "audio/ogg").split(";")[0].trim() || "audio/ogg";
  return { seconds: Number(a.seconds) || 0, mime, bytes: Number(a.fileLength) || 0 };
}

export function parseSpeakArg(arg) {
  const m = /^(id|indonesia|indo|en|inggris|english)\b[\s:,-]*([\s\S]*)$/i.exec(String(arg || "").trim());
  if (!m) return { lang: "en", topic: String(arg || "").trim() };
  return { lang: /^(id|indonesia|indo)$/i.test(m[1]) ? "id" : "en", topic: m[2].trim() };
}

export function createWaTutor({ tutor, speak = null, voiceCheck = null, hasTranscriber = false, config, log = console, now = () => Date.now() }) {
  const sessions = new Map(); // jid -> { lang, topic, turns, userTurns, lastAt }
  const noteAt = new Map();

  function active(jid) {
    const s = sessions.get(jid);
    if (!s) return false;
    if (now() - s.lastAt > config.speakIdleMin * 60_000) {
      sessions.delete(jid);
      return false;
    }
    return true;
  }

  /** Pilihan pengenalan suara selama sesi (bahasa ucapan mengikuti sesi); null bila tak ada sesi. */
  function sttOptions(jid) {
    if (!active(jid)) return null;
    return sessions.get(jid).lang === "id" ? { language: "id", hint: TUTOR_STT_HINT_ID } : { language: "en", hint: TUTOR_STT_HINT };
  }

  async function noteOnce(io, jid, kind, text, everyMs) {
    const k = `${jid}|${kind}`;
    if (now() - (noteAt.get(k) || 0) < everyMs) return;
    noteAt.set(k, now());
    await io.send(text).catch(() => {});
  }

  async function trySpeak(jid, text, io) {
    if (!speak) return false;
    const stop = io.busy?.("voice");
    try {
      const out = await speak(text);
      if (!out?.ogg) return false;
      await io.voice(out.ogg);
      return true;
    } catch (e) {
      if (e?.code === "ffmpeg") await noteOnce(io, jid, "ffmpeg", `🔇 Balasan suara belum bisa: ${e.message} Pasang dengan: sudo apt install ffmpeg (lalu tunggu semenit). Sementara tutor membalas teks saja.`, 6 * 3600_000);
      else if (e?.quota) await noteOnce(io, jid, "quota", "🔇 Kuota suara Gemini sedang habis, jadi kali ini tutor membalas teks saja. Coba lagi nanti.", 30 * 60_000);
      else log.error?.(`💬 [WA/Speak] suara gagal dikirim: ${e?.message || e}`);
      return false;
    } finally {
      stop?.();
    }
  }

  async function start(jid, arg, io) {
    if (!tutor) return void (await io.send("Mode Speaking belum tersedia: isi GEMINI_API_KEYS di .env bot lalu restart."));
    const { lang, topic } = parseSpeakArg(arg);
    const id = lang === "id";
    const session = { lang, topic: topic.slice(0, 100), turns: [], userTurns: 0, lastAt: now() };
    const vc = voiceCheck ? await voiceCheck().catch(() => ({ ok: false, reason: "pengecekan gagal" })) : { ok: !!speak, reason: "suara belum diatur di bot" };
    const intro = [
      id ? `🎙️ Mode ngobrol bahasa Indonesia aktif${session.topic ? ` — topik: ${session.topic}` : ""}.` : `🎙️ Mode Speaking aktif${session.topic ? ` — topik: ${session.topic}` : ""}.`,
      id
        ? hasTranscriber ? "Balas dengan voice note (tahan ikon mikrofon), atau ketik. Aku membalas dengan suara, tanpa koreksi." : "Ketik pesanmu (suara masuk belum aktif: isi GROQ_API_KEYS). Aku membalas dengan teks."
        : hasTranscriber ? "Balas dengan voice note berbahasa Inggris (tahan ikon mikrofon), atau ketik. Aku membalas dengan suara + koreksi singkat." : "Ketik jawabanmu dalam bahasa Inggris (suara masuk belum aktif: isi GROQ_API_KEYS). Aku membalas dengan koreksi singkat.",
      id ? "Akhiri dengan /selesai atau ucapkan perpisahan (sampai jumpa, dadah, aku pamit dulu)." : "Akhiri dengan /selesai atau ucapkan goodbye.",
      vc.ok ? "" : `🔇 Suara tutor belum bisa dibuat: ${vc.reason}. Sementara tutor membalas teks.`
    ]
      .filter((x) => x !== "")
      .join("\n");
    await io.send(intro).catch(() => {});
    const stop = io.busy?.("typing");
    try {
      const out = await tutor({ topic: session.topic, lang, history: [], userText: null, farewell: false });
      session.turns.push({ role: "ai", body: out.reply });
      session.lastAt = now();
      sessions.set(jid, session);
      stop?.();
      await io.send(formatTutorMessage({ reply: out.reply, correction: "", tip: "" }));
      await trySpeak(jid, out.reply, io);
    } catch (e) {
      stop?.();
      log.error?.(`💬 [WA/Speak] gagal memulai: ${e?.message || e}`);
      await io.send(`⚠️ Tutor gagal memulai: ${String(e?.message || e).slice(0, 300)}\nCoba /speak${id ? " id" : ""} lagi sebentar lagi.`).catch(() => {});
    }
  }

  async function end(jid, io, note = null) {
    const s = sessions.get(jid);
    sessions.delete(jid);
    if (!s) return void (await io.send("Tidak ada sesi Speaking yang sedang berjalan. Mulai dengan /speak."));
    await io.send(note || (s.lang === "id" ? `🏁 Sesi ngobrol selesai (${s.userTurns} giliran). Seru! /speak id untuk mulai lagi.` : `🏁 Sesi Speaking selesai (${s.userTurns} giliran). Mantap! /speak untuk mulai lagi.`));
  }

  async function turn(jid, text, io) {
    const s = sessions.get(jid);
    if (!s) return;
    const id = s.lang === "id";
    const clean = String(text).replace(/\s+/g, " ").trim().slice(0, id ? TUTOR_TEXT_MAX_ID : TUTOR_TEXT_MAX);
    if (!clean) return;
    const farewell = isFarewellFor(clean, s.lang);
    const stop = io.busy?.("typing");
    try {
      let out = await tutor({ topic: s.topic, lang: s.lang, history: [...s.turns], userText: clean, farewell });
      stop?.();
      if (id) out = { reply: out.reply, correction: "", tip: "" };
      s.turns.push({ role: "user", body: clean }, { role: "ai", body: out.reply });
      s.userTurns += 1;
      s.lastAt = now();
      await io.send(formatTutorMessage(out));
      await trySpeak(jid, out.reply, io);
      if (farewell) return void (await end(jid, io));
      if (s.userTurns >= config.speakMaxTurns) return void (await end(jid, io, `🏁 Batas ${config.speakMaxTurns} giliran tercapai, sesi selesai. ${id ? "Seru! /speak id" : "Hebat! /speak"} untuk mulai sesi baru.`));
    } catch (e) {
      stop?.();
      log.error?.(`💬 [WA/Speak] gagal membalas: ${e?.message || e}`);
      await io.send(`⚠️ ${id ? "Rani" : "Tutor"} gagal membalas: ${String(e?.message || e).slice(0, 300)}\nKirim lagi ucapanmu, atau /selesai.`).catch(() => {});
    }
  }

  /**
   * Pesan teks PEMILIK (sudah berupa teks, termasuk hasil voice note). true = ditangani tutor (jangan diproses lagi).
   * Perintah: /speak [id|en] [topik], /selesai, /stop. Selama sesi aktif, teks biasa = ucapan untuk tutor.
   */
  async function handle(jid, rawText, io) {
    const text = String(rawText ?? "").trim();
    if (!text) return false;
    const cmd = /^\/(speak|selesai|stop)\b[\s:,-]*([\s\S]*)$/i.exec(text);
    if (cmd) {
      const name = cmd[1].toLowerCase();
      if (name === "speak") await start(jid, cmd[2], io);
      else await end(jid, io);
      return true;
    }
    if (/^\//.test(text)) return false; // perintah lain (/ringkasan, dst.) tetap milik jalurnya
    if (active(jid)) {
      await turn(jid, text, io);
      return true;
    }
    return false;
  }

  return { active, sttOptions, handle, start, end, turn };
}
