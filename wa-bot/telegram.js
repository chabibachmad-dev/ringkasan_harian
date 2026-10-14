// ================================================================
// Telegram untuk PEMILIK: perintah (simab, /ringkasan, /peraturan), obrolan dengan AI, dan penerima notifikasi.
//
// Cara kerja: long polling ke Bot API resmi (getUpdates) dari proses bot yang sudah jalan -- tanpa webhook, tanpa
// port terbuka, tanpa server tambahan. MATI kalau TELEGRAM_BOT_TOKEN kosong; bot WhatsApp tidak terpengaruh apa pun.
//
// Keamanan: hanya chat yang id-nya ada di TELEGRAM_OWNER_IDS yang dilayani. Pesan dari chat lain diabaikan diam-diam
// (hanya dicatat di log). Selama TELEGRAM_OWNER_IDS masih kosong bot berada di "mode pairing": ia HANYA membalas dengan
// id chat pengirim supaya bisa disalin ke .env -- tidak menjalankan perintah apa pun.
//
// Modul ini tidak tahu apa-apa soal WhatsApp/Supabase/Gemini: semuanya disuntikkan dari index.js (lihat parameter
// `deps`), jadi bisa dites dengan Telegram palsu (test-telegram.mjs).
//
// Konfigurasi (.env), semuanya opsional kecuali token:
//   TELEGRAM_BOT_TOKEN=123456:ABC...        (dari @BotFather; kosong = mati)
//   TELEGRAM_OWNER_IDS=123456789            (id chat pemilik, boleh beberapa dipisah koma)
//   TELEGRAM_MIRROR_NOTIFICATIONS=true      (false = notifikasi tidak ikut dikirim ke Telegram)
//   TELEGRAM_HISTORY_LIMIT=12               (jumlah pesan terakhir yang dikirim ke AI sebagai konteks obrolan)
//   VOICE_MAX_SECONDS=180                   (pesan suara lebih panjang dari ini ditolak; lihat voice-input.js untuk kunci STT)
//   TELEGRAM_SPEAK_TEXT=false  (bawaan: tutor /speak SUARA SAJA; true = balasan juga ditulis)   TELEGRAM_SPEAK_MAX_TURNS=30             (batas giliran satu sesi /speak)   TELEGRAM_SPEAK_IDLE_MIN=60 (sesi /speak kedaluwarsa bila diam sekian menit)
// Balasan suara (voice note) & tutor Inggris: lihat voice-output.js (butuh ffmpeg) dan tutor.js.
// ================================================================

import { voiceToCommand, describeError } from "./voice-input.js";
import { isFarewellFor, formatTutorMessage, TUTOR_STT_HINT, TUTOR_STT_HINT_ID, TUTOR_TEXT_MAX, TUTOR_TEXT_MAX_ID } from "./tutor.js";

const API = "https://api.telegram.org";
const MAX_TEXT = 3500; // batas Telegram 4096; disisakan ruang untuk tag HTML hasil konversi

const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? "").trim() !== "" ? Number(v) : d);

export function readTelegramConfig(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const ownerIds = String(env.TELEGRAM_OWNER_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^-?\d+$/.test(x));
  return {
    token,
    enabled: token.length > 0,
    ownerIds,
    mirror: String(env.TELEGRAM_MIRROR_NOTIFICATIONS ?? "true").trim().toLowerCase() !== "false",
    historyLimit: Math.max(2, Math.min(40, Math.floor(num(env.TELEGRAM_HISTORY_LIMIT, 12)))),
    voiceMaxSeconds: Math.max(5, Math.min(600, Math.floor(num(env.VOICE_MAX_SECONDS, 180)))),
    speakMaxTurns: Math.max(3, Math.min(100, Math.floor(num(env.TELEGRAM_SPEAK_MAX_TURNS, 30)))),
    speakIdleMin: Math.max(5, Math.min(1440, Math.floor(num(env.TELEGRAM_SPEAK_IDLE_MIN, 60)))),
    speakText: !["", "false", "0", "off", "no", "tidak", "mati"].includes(String(env.TELEGRAM_SPEAK_TEXT ?? "").trim().toLowerCase()), // bawaan false = tutor SUARA SAJA
    pollTimeoutSec: 30
  };
}

// ---------------------------------------------------------------- format
/** Pecah teks panjang jadi potongan <= max, utamakan batas paragraf/baris. Blok kode ``` yang terbelah ditutup & dibuka lagi. */
export function splitMessage(text, max = MAX_TEXT) {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  if (src.length <= max) return src.trim() ? [src] : [];
  const parts = [];
  let rest = src;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest.trim()) parts.push(rest);
  // jaga blok kode: bila sebuah potongan berisi jumlah ``` ganjil, tutup di sini dan buka lagi di potongan berikutnya
  let open = false;
  for (let i = 0; i < parts.length; i++) {
    if (open) parts[i] = "```\n" + parts[i];
    const fences = (parts[i].match(/```/g) || []).length;
    open = fences % 2 === 1;
    if (open && i < parts.length - 1) parts[i] += "\n```";
  }
  return parts.filter((p) => p.trim());
}

const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Format WhatsApp (*tebal*, _miring_, ```kode```, `kode`) -> HTML Telegram yang aman. */
export function waToTelegramHtml(text) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = String(text ?? "");
  s = s.replace(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/g, (_, code) => keep(`<pre>${escHtml(code.replace(/\n$/, ""))}</pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escHtml(code)}</code>`));
  s = escHtml(s);
  s = s.replace(/(^|[\s(])\*([^*\n]+?)\*(?=$|[\s).,!?:;])/g, (_, pre, t) => `${pre}<b>${t}</b>`);
  s = s.replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s).,!?:;])/g, (_, pre, t) => `${pre}<i>${t}</i>`);
  s = s.replace(/(^|[\s(])~([^~\n]+?)~(?=$|[\s).,!?:;])/g, (_, pre, t) => `${pre}<s>${t}</s>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}


// ---------------------------------------------------------------- tombol pilihan (alur "simab rekam/ubah/hapus")
const CMD_LABELS = {
  lanjut: "⏭ Lanjut",
  balik: "⏮ Balik",
  semua: "📋 Semua",
  kembali: "↩️ Kembali",
  "ya hapus": "🗑 Ya, hapus",
  ya: "✅ Ya, simpan",
  ubah: "✏️ Ubah",
  hapus: "🗑 Hapus",
  batal: "✖️ Batal"
};
const CMD_ORDER = ["lanjut", "balik", "semua", "kembali", "ya", "ya hapus", "ubah", "hapus", "batal"];

/**
 * Susun tombol dari TEKS balasan SiMAB (bukan dari data internalnya, jadi alur SiMAB tidak diubah):
 *  - daftar bernomor ("3. *kode* ...") jadi satu tombol per baris, HANYA bila teksnya meminta "Balas *angka*";
 *  - kata perintah tebal di 6 baris terakhir (*lanjut*, *kembali*, *ya*, *batal* ...) jadi tombol perintah.
 * Menekan tombol sama dengan mengetik katanya. "*cari <kata>*" tetap diketik. Mengembalikan inline_keyboard atau null.
 */
export function simabKeyboard(text) {
  const lines = String(text ?? "").split("\n");
  const rows = [];
  if (/\*angka\*/.test(text)) {
    for (const line of lines) {
      const m = /^(\d{1,3})\.\s+(.*)$/.exec(line);
      if (!m) continue;
      let label = m[2].replace(/\*/g, "").trim();
      if (label.length > 40) label = `${label.slice(0, 39)}…`;
      rows.push([{ text: `${m[1]}. ${label}`, callback_data: `sm:${m[1]}` }]);
    }
  }
  const tail = lines.slice(-6).join("\n");
  const found = new Set();
  for (const m of tail.matchAll(/\*(lanjut|balik|semua|kembali|ya hapus|ya|ubah|hapus|batal)\*/gi)) found.add(m[1].toLowerCase());
  const cmds = CMD_ORDER.filter((c) => found.has(c));
  for (let i = 0; i < cmds.length; i += 3) rows.push(cmds.slice(i, i + 3).map((c) => ({ text: CMD_LABELS[c], callback_data: `sm:${c}` })));
  return rows.length ? rows : null;
}

const HELP = [
  "Halo, ini Ayyubi di Telegram.",
  "",
  "Ketik biasa untuk ngobrol dengan AI (Gemini, bisa cari web & Dokumen Pengetahuan).",
  "🎤 Kirim PESAN SUARA (tahan tombol mikrofon) untuk ngobrol atau merekam SiMAB: bot menuliskan apa yang ia dengar, lalu menjalankannya seperti pesan teks. Contoh saat merekam: \"Pembelian ATK, tanggal 5 Oktober 2026, jumlah satu juta lima ratus ribu rupiah\".",
  "🔊 Balasan suara: /suara auto (default: dibalas suara bila kamu kirim suara), /suara on (selalu), /suara off. Butuh ffmpeg di laptop bot.",
  "🎙️ Latihan ngobrol Inggris: /speak [topik] — kirim suara berbahasa Inggris, tutor membalas dengan SUARA SAJA (tanpa teks; /koreksi menampilkan koreksi terakhir, /teks on bila mau teks juga). Ngobrol santai berbahasa Indonesia: /speak id [topik]. Akhiri dengan /selesai atau ucapkan perpisahan (goodbye / sampai jumpa).",
  "",
  "Perintah:",
  "/simab <perintah>  — SiMAB (pagu, cek, perjadin, sbm, rpd, rekam). Boleh juga tulis \"simab ...\" tanpa garis miring.",
  "Selama perekaman/ubah/hapus SiMAB, pilihan muncul sebagai tombol di bawah pesan (mengetik angka/kata tetap bisa).",
  "/status  — kondisi bot: WhatsApp, key Gemini, token hari ini, Ollama, dokumen",
  "/ringkasan  — ringkasan percakapan WhatsApp hari ini",
  "/peraturan  — pantau peraturan terbaru (\"/peraturan semua\" = tampilkan semua hasil)",
  "/dokumen <pertanyaan>  — tanya dari dokumen lokal di laptop (hasil PDF → MD), dijawab Ollama. \"/dokumen\" saja = daftar dokumen",
  "/sistem  — kondisi laptop bot (pm2, disk, RAM, Ollama); /log, /restart, /deploy, /migrasi: ketik /ops (perlu OPS_ENABLED=true)",
  "/baru  — mulai obrolan baru (lupakan konteks sebelumnya)",
  "/speak [topik]  — mulai latihan ngobrol Inggris dengan tutor (suara)   /speak id [topik]  — ngobrol santai bahasa Indonesia   /selesai  — akhiri",
  "/suara [auto|on|off]  — atur balasan suara untuk obrolan biasa",
  "/id  — tampilkan id chat ini"
].join("\n");

// ---------------------------------------------------------------- modul
/**
 * deps = {
 *   chat(history, userText)           -> Promise<string>   jawaban AI (history = [{role:"user"|"model", text}] sudah termasuk userText)
 *   simab?: { enabled, hasSession(key), run(text, {notify, sessionKey}) -> Promise<string> }
 *   summary?()                        -> Promise<string>   teks ringkasan harian
 *   status?()                         -> Promise<string>   teks kondisi bot (/status)
 *   ops?: { handle(name, arg, {chatId, viaVoice, send}) -> Promise<string|undefined> }   perintah laptop (ops.js)
 *   localDocs?: { ask(q)->Promise<{reply}>, list()->string }   tanya-jawab dokumen lokal (/dokumen), dijawab Ollama
 *   regNow?({ all, sendTo })          -> Promise            jalankan pantauan peraturan, kirim lewat sendTo(text)
 *   state?: { get(key), set(key, value) }                   penyimpan offset (supaya restart tidak memproses ulang)
 * }
 */
export function createTelegram({ config, deps = {}, fetchImpl = globalThis.fetch, log = console, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const enabled = config.enabled === true;
  const owners = new Set(config.ownerIds.map(String));
  const histories = new Map(); // chatId -> [{role, text}]
  const pairingSeen = new Map(); // chatId -> waktu balasan pairing terakhir
  const ignoredLogged = new Set();
  const lastKeyboard = new Map(); // chatId -> message_id pesan yang masih membawa tombol
  const voiceModes = new Map(); // chatId -> "auto" | "on" | "off" (balasan suara untuk obrolan biasa)
  const tutorSessions = new Map(); // chatId -> { topic, turns:[{role,body}], userTurns, lastAt }
  const voiceNoteAt = new Map(); // jenis catatan -> kapan terakhir dikirim (supaya tidak berisik)
  let running = false;
  let stopped = false;
  let offset = 0;

  async function api(method, payload = {}, { timeoutMs = 20_000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${API}/bot${config.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* bukan JSON */
      }
      if (!data || data.ok !== true) {
        const err = new Error(`Telegram ${method}: ${data?.description || `HTTP ${res.status}`}`);
        err.status = data?.error_code || res.status;
        err.retryAfter = data?.parameters?.retry_after;
        throw err;
      }
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Panggilan Bot API dengan berkas (multipart), mis. sendVoice. */
  async function apiForm(method, form, { timeoutMs = 45_000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${API}/bot${config.token}/${method}`, { method: "POST", body: form, signal: ctrl.signal });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* bukan JSON */
      }
      if (!data || data.ok !== true) {
        const err = new Error(`Telegram ${method}: ${data?.description || `HTTP ${res.status}`}`);
        err.status = data?.error_code || res.status;
        throw err;
      }
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendPart(chatId, part, markup = null) {
    const base = { chat_id: chatId, link_preview_options: { is_disabled: true }, ...(markup ? { reply_markup: { inline_keyboard: markup } } : {}) };
    try {
      return await api("sendMessage", { ...base, text: waToTelegramHtml(part), parse_mode: "HTML" });
    } catch (e) {
      if (e.status === 429 && e.retryAfter) {
        await sleep(Math.min(Number(e.retryAfter), 30) * 1000);
        return api("sendMessage", { ...base, text: waToTelegramHtml(part), parse_mode: "HTML" });
      }
      // HTML ditolak (tag/entitas tak terduga): kirim apa adanya sebagai teks polos
      if (e.status === 400 && /parse entities|can't parse/i.test(e.message)) return api("sendMessage", { ...base, text: part });
      throw e;
    }
  }

  async function send(chatId, text, { markup = null } = {}) {
    const parts = splitMessage(text);
    let last = null;
    for (let i = 0; i < parts.length; i++) last = await sendPart(chatId, parts[i], i === parts.length - 1 ? markup : null);
    if (markup && last?.message_id) lastKeyboard.set(String(chatId), last.message_id);
    return parts.length;
  }

  // Tombol lama dihapus saat ada pilihan baru / setelah ditekan, supaya tidak ada tombol basi yang bisa terpencet.
  async function clearKeyboard(chatId, messageId = null) {
    const id = messageId ?? lastKeyboard.get(String(chatId));
    if (!id) return;
    if (messageId == null || lastKeyboard.get(String(chatId)) === id) lastKeyboard.delete(String(chatId));
    await api("editMessageReplyMarkup", { chat_id: chatId, message_id: id, reply_markup: { inline_keyboard: [] } }, { timeoutMs: 8000 }).catch(() => {});
  }

  /** Kirim ke semua pemilik. Mengembalikan jumlah pemilik yang berhasil menerima (0 = tidak ada / semua gagal). */
  async function sendOwner(text) {
    if (!enabled || owners.size === 0) return 0;
    let ok = 0;
    for (const id of owners) {
      try {
        await send(id, text);
        ok += 1;
      } catch (e) {
        log.error?.(`✈️ [Telegram] gagal kirim ke ${id}: ${e?.message || e}`);
      }
    }
    return ok;
  }

  const pushHistory = (chatId, role, text) => {
    const list = histories.get(chatId) || [];
    list.push({ role, text });
    while (list.length > config.historyLimit) list.shift();
    histories.set(chatId, list);
  };

  const withTyping = (chatId, fn) => withAction(chatId, "typing", fn);
  async function withAction(chatId, action, fn) {
    const tick = () => api("sendChatAction", { chat_id: chatId, action }, { timeoutMs: 8000 }).catch(() => {});
    tick();
    const timer = setInterval(tick, 4500);
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }

  // ---------------------------------------------------------------- balasan SUARA (voice note)
  async function sendVoice(chatId, ogg) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("voice", new Blob([ogg], { type: "audio/ogg" }), "voice.ogg");
    return apiForm("sendVoice", form);
  }

  async function noteOnce(chatId, kind, text, everyMs) {
    const k = `${chatId}|${kind}`;
    if (Date.now() - (voiceNoteAt.get(k) || 0) < everyMs) return;
    voiceNoteAt.set(k, Date.now());
    await send(chatId, text).catch(() => {});
  }

  /** Ucapkan `text` sebagai voice note. true bila terkirim; false bila tidak (teks sudah terkirim terpisah, jadi tidak fatal). */
  async function trySpeak(chatId, text) {
    if (!deps.speak) return false;
    try {
      const out = await withAction(chatId, "record_voice", () => deps.speak(text));
      if (!out?.ogg) return false;
      await sendVoice(chatId, out.ogg);
      return true;
    } catch (e) {
      if (e?.code === "ffmpeg") await noteOnce(chatId, "ffmpeg", `🔇 Balasan suara belum bisa: ${e.message} Pasang dengan: sudo apt install ffmpeg (lalu tunggu semenit). Sementara saya balas teks saja.`, 6 * 3600_000);
      else if (e?.quota) await noteOnce(chatId, "quota", "🔇 Kuota suara Gemini sedang habis, jadi kali ini saya balas teks saja. Coba lagi nanti.", 30 * 60_000);
      else log.error?.(`✈️ [Telegram] suara gagal dikirim: ${e?.message || e}`);
      return false;
    }
  }

  async function getVoiceMode(chatId) {
    if (voiceModes.has(chatId)) return voiceModes.get(chatId);
    let mode = "auto";
    try {
      const v = await deps.state?.get?.(`telegram_voice:${chatId}`);
      if (v === "on" || v === "off" || v === "auto") mode = v;
    } catch {
      /* pakai bawaan */
    }
    voiceModes.set(chatId, mode);
    return mode;
  }

  async function handleVoiceCommand(chatId, arg) {
    const a = arg.toLowerCase();
    const map = { on: "on", aktif: "on", nyala: "on", selalu: "on", off: "off", mati: "off", matikan: "off", auto: "auto", otomatis: "auto" };
    const mode = map[a];
    const label = { auto: "otomatis (dibalas suara bila kamu kirim suara)", on: "selalu dibalas suara", off: "mati (hanya teks)" };
    if (!mode) {
      const cur = await getVoiceMode(chatId);
      return void (await send(chatId, `🔊 Balasan suara: ${label[cur]}.

Ubah: /suara auto • /suara on • /suara off`));
    }
    voiceModes.set(chatId, mode);
    try {
      await deps.state?.set?.(`telegram_voice:${chatId}`, mode);
    } catch {
      /* hanya berlaku sampai restart */
    }
    let extra = "";
    if (mode !== "off") {
      const vc = deps.voiceCheck ? await deps.voiceCheck().catch(() => ({ ok: false, reason: "pengecekan gagal" })) : { ok: !!deps.speak, reason: "suara belum diatur di bot" };
      if (!vc.ok) extra = `

⚠️ Tapi suara belum bisa dibuat sekarang: ${vc.reason}. Sampai beres saya balas teks saja.`;
    }
    await send(chatId, `🔊 Balasan suara: ${label[mode]}.${extra}`);
  }

  // ---------------------------------------------------------------- tutor Inggris (/speak)
  function tutorActive(chatId) {
    const s = tutorSessions.get(chatId);
    if (!s) return false;
    if (Date.now() - s.lastAt > config.speakIdleMin * 60_000) {
      tutorSessions.delete(chatId);
      return false;
    }
    return true;
  }

  /** "/speak id soal liburan" -> { lang: "id", topic: "soal liburan" }; "/speak ordering coffee" -> { lang: "en", topic: "ordering coffee" }. */
  function parseSpeakArg(arg) {
    const m = /^(id|indonesia|indo|en|inggris|english)\b[\s:,-]*([\s\S]*)$/i.exec(String(arg || "").trim());
    if (!m) return { lang: "en", topic: String(arg || "").trim() };
    return { lang: /^(id|indonesia|indo)$/i.test(m[1]) ? "id" : "en", topic: m[2].trim() };
  }

  /** Kirim balasan tutor. Suara saja bila sesi tidak minta teks; bila suara gagal, teks dikirim sebagai cadangan. */
  async function deliverTutor(chatId, s, out) {
    const text = formatTutorMessage(out);
    s.fix = out.correction ? { correction: out.correction, tip: out.tip || "" } : null;
    if (s.text) {
      await send(chatId, text);
      await trySpeak(chatId, out.reply);
      return;
    }
    const spoke = await trySpeak(chatId, out.reply);
    if (!spoke) await send(chatId, text);
  }

  async function startTutor(chatId, arg) {
    if (!deps.tutor) return void (await send(chatId, "Mode Speaking belum tersedia: isi GEMINI_API_KEYS di .env bot lalu restart."));
    const { lang, topic } = parseSpeakArg(arg);
    const id = lang === "id";
    const session = { lang, topic: topic.slice(0, 100), turns: [], userTurns: 0, lastAt: Date.now(), text: !!config.speakText, fix: null };
    const vc = deps.voiceCheck ? await deps.voiceCheck().catch(() => ({ ok: false, reason: "pengecekan gagal" })) : { ok: !!deps.speak, reason: "suara belum diatur di bot" };
    const intro = [
      id ? `🎙️ Mode ngobrol bahasa Indonesia aktif${session.topic ? ` — topik: ${session.topic}` : ""}.` : `🎙️ Mode Speaking aktif${session.topic ? ` — topik: ${session.topic}` : ""}.`,
      id
        ? deps.transcribe ? "Balas dengan pesan suara (tahan tombol mikrofon), atau ketik. Aku membalas dengan suara, tanpa koreksi." : "Ketik pesanmu (suara masuk belum aktif: isi GROQ_API_KEYS). Aku membalas dengan teks."
        : deps.transcribe ? "Balas dengan pesan suara berbahasa Inggris (tahan tombol mikrofon), atau ketik. Aku membalas dengan suara + koreksi singkat." : "Ketik jawabanmu dalam bahasa Inggris (suara masuk belum aktif: isi GROQ_API_KEYS). Aku membalas dengan koreksi singkat.",
      id ? "Akhiri dengan /selesai atau ucapkan perpisahan (sampai jumpa, dadah, aku pamit dulu)." : "Akhiri dengan /selesai atau ucapkan goodbye.",
      vc.ok ? (session.text ? "" : id ? "Mode suara saja: balasanku tidak ditulis. /teks on bila mau teks juga." : "Mode suara saja: balasanku tidak ditulis. /teks on bila mau teks juga, /koreksi untuk koreksi terakhir.") : `🔇 Suara tutor belum bisa dibuat: ${vc.reason}. Sementara tutor membalas teks.`
    ]
      .filter((x) => x !== "")
      .join("\n");
    await send(chatId, intro).catch(() => {});
    try {
      const out = await withTyping(chatId, () => deps.tutor({ topic: session.topic, lang, history: [], userText: null, farewell: false }));
      session.turns.push({ role: "ai", body: out.reply });
      session.lastAt = Date.now();
      tutorSessions.set(chatId, session);
      await deliverTutor(chatId, session, { reply: out.reply, correction: "", tip: "" });
    } catch (e) {
      log.error?.(`✈️ [Telegram/Speak] gagal memulai: ${e?.message || e}`);
      await send(chatId, `⚠️ Tutor gagal memulai: ${String(e?.message || e).slice(0, 300)}\nCoba /speak${id ? " id" : ""} lagi sebentar lagi.`).catch(() => {});
    }
  }

  async function endTutor(chatId, note = null) {
    const s = tutorSessions.get(chatId);
    tutorSessions.delete(chatId);
    if (!s) return void (await send(chatId, "Tidak ada sesi Speaking yang sedang berjalan. Mulai dengan /speak."));
    await send(chatId, note || (s.lang === "id" ? `🏁 Sesi ngobrol selesai (${s.userTurns} giliran). Seru! /speak id untuk mulai lagi.` : `🏁 Sesi Speaking selesai (${s.userTurns} giliran). Mantap! /speak untuk mulai lagi.`));
  }

  async function handleTutorTurn(chatId, text) {
    const s = tutorSessions.get(chatId);
    if (!s) return;
    const id = s.lang === "id";
    const clean = String(text).replace(/\s+/g, " ").trim().slice(0, id ? TUTOR_TEXT_MAX_ID : TUTOR_TEXT_MAX);
    if (!clean) return;
    const farewell = isFarewellFor(clean, s.lang);
    try {
      let out = await withTyping(chatId, () => deps.tutor({ topic: s.topic, lang: s.lang, history: [...s.turns], userText: clean, farewell }));
      if (id) out = { reply: out.reply, correction: "", tip: "" }; // ngobrol Indonesia: tidak ada koreksi
      s.turns.push({ role: "user", body: clean }, { role: "ai", body: out.reply });
      s.userTurns += 1;
      s.lastAt = Date.now();
      await deliverTutor(chatId, s, out);
      if (farewell) return void (await endTutor(chatId));
      if (s.userTurns >= config.speakMaxTurns) return void (await endTutor(chatId, `🏁 Batas ${config.speakMaxTurns} giliran tercapai, sesi selesai. ${id ? "Seru! /speak id" : "Hebat! /speak"} untuk mulai sesi baru.`));
    } catch (e) {
      log.error?.(`✈️ [Telegram/Speak] gagal membalas: ${e?.message || e}`);
      await send(chatId, `⚠️ ${id ? "Rani" : "Tutor"} gagal membalas: ${String(e?.message || e).slice(0, 300)}\nKirim lagi ucapanmu, atau /selesai.`).catch(() => {});
    }
  }

  /** Jalankan satu baris untuk SiMAB; bila sesi masih berlanjut, pilihannya dilampirkan sebagai tombol. */
  async function runSimab(chatId, line) {
    const simab = deps.simab;
    const key = `tg:${chatId}`;
    const reply = (t) => send(chatId, t);
    try {
      const out = await withTyping(chatId, () => simab.run(line, { notify: reply, sessionKey: key }));
      if (out) {
        await clearKeyboard(chatId);
        const markup = simab.hasSession?.(key) ? simabKeyboard(out) : null;
        await send(chatId, out, { markup });
      }
    } catch (e) {
      log.error?.(`✈️ [Telegram/SiMAB] gagal: ${e?.message || e}`);
      await reply(`⚠️ SiMAB: ${String(e?.message || e).slice(0, 300)}`);
    }
  }

  /** Penekanan tombol = pemilik mengetik katanya. Hanya dari pemilik, hanya tombol buatan bot ("sm:..."). */
  async function handleCallback(cb) {
    await api("answerCallbackQuery", { callback_query_id: cb.id }, { timeoutMs: 8000 }).catch(() => {});
    const chat = cb.message?.chat;
    const chatId = chat ? String(chat.id) : "";
    if (owners.size === 0 || !chat || chat.type !== "private" || !owners.has(chatId) || !owners.has(String(cb.from?.id))) return;
    const data = String(cb.data || "");
    if (!data.startsWith("sm:")) return;
    await clearKeyboard(chatId, cb.message.message_id);
    const simab = deps.simab;
    if (!simab?.enabled || !simab.hasSession?.(`tg:${chatId}`)) {
      await send(chatId, "Sesi SiMAB sudah berakhir. Mulai lagi dengan /simab rekam <seksi>.").catch(() => {});
      return;
    }
    await runSimab(chatId, data.slice(3));
  }

  /** Unduh berkas Telegram (suara/dokumen) ke Buffer. Batas Bot API: 20 MB. Gangguan jaringan sesaat dicoba ulang (maks 3 kali). */
  async function downloadFile(fileId) {
    let info = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3 && !info; attempt++) {
      try {
        info = await api("getFile", { file_id: fileId }, { timeoutMs: 15_000 });
      } catch (e) {
        lastErr = e;
        if (e?.status && e.status < 500 && e.status !== 429) break; // 4xx: percuma diulang
        if (attempt < 2) await sleep(700 * (attempt + 1));
      }
    }
    if (!info) throw new Error(`gagal meminta berkas ke Telegram: ${describeError(lastErr)}`);
    if (!info.file_path) throw new Error("berkas tidak ditemukan di Telegram");
    lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      try {
        const res = await fetchImpl(`${API}/file/bot${config.token}/${info.file_path}`, { signal: ctrl.signal });
        if (!res.ok) {
          const err = new Error(`unduh berkas gagal (HTTP ${res.status})`);
          err.status = res.status;
          throw err;
        }
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        lastErr = e;
        if (e?.status && e.status < 500 && e.status !== 429) break;
        if (attempt < 2) await sleep(700 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`unduh berkas dari Telegram gagal: ${describeError(lastErr)}`);
  }

  /** Pesan suara pemilik: ubah jadi teks, tampilkan apa yang terdengar, lalu proses seperti pesan teks (obrolan / SiMAB). */
  /** Berkas (mis. patch*.zip) dari pemilik: diserahkan ke ops.js; bila bukan urusannya, balasan umum. */
  async function handleOwnerDocument(chatId, doc) {
    try {
      const out = await withTyping(chatId, () =>
        deps.ops.handleDocument({ chatId, fileName: doc.file_name, size: doc.file_size, download: () => downloadFile(doc.file_id), send: (t) => send(chatId, t) })
      );
      if (typeof out === "string" && out) return void (await send(chatId, out));
    } catch (e) {
      return void (await send(chatId, `⚠️ Berkas gagal diproses: ${String(e?.message || e).slice(0, 200)}`).catch(() => {}));
    }
    await send(chatId, "Bot membaca pesan teks dan pesan suara (tahan tombol mikrofon). Untuk menerapkan patch, kirim zip bernama patch*.zip (perlu OPS_ENABLED=true).").catch(() => {});
  }

  async function handleOwnerVoice(chatId, voice) {
    if (!deps.transcribe) return void (await send(chatId, "Pesan suara belum aktif: isi GROQ_API_KEYS (atau GEMINI_API_KEYS) di .env bot lalu restart."));
    if (Number(voice.duration) > config.voiceMaxSeconds) return void (await send(chatId, `Pesan suaranya terlalu panjang (${voice.duration} dtk). Maksimal ${config.voiceMaxSeconds} detik; pecah jadi beberapa pesan.`));
    if (Number(voice.file_size) > 19 * 1024 * 1024) return void (await send(chatId, "Berkas suaranya terlalu besar (maks 20 MB)."));
    let heard = "";
    const simabKey = `tg:${chatId}`;
    const inTutor = tutorActive(chatId) && !(deps.simab?.enabled && deps.simab.hasSession?.(simabKey));
    const tutorLang = inTutor ? tutorSessions.get(chatId).lang : null;
    try {
      const out = await withTyping(chatId, async () => {
        const buffer = await downloadFile(voice.file_id);
        // sesi /speak: bahasa ucapan mengikuti sesi (Inggris, atau "id" = Indonesia tanpa kosakata SiMAB)
        const mime = voice.mime_type || "audio/ogg";
        return deps.transcribe(buffer, inTutor ? (tutorLang === "id" ? { mime, language: "id", hint: TUTOR_STT_HINT_ID } : { mime, language: "en", hint: TUTOR_STT_HINT }) : { mime });
      });
      heard = String(out?.text ?? "").trim();
    } catch (e) {
      log.error?.(`✈️ [Telegram] suara gagal diubah jadi teks: ${e?.message || e}`);
      return void (await send(chatId, `⚠️ ${String(e?.message || e).slice(0, 300)}`).catch(() => {}));
    }
    if (!heard) return void (await send(chatId, "🎤 Suaranya tidak terdengar jelas. Coba rekam lagi lebih dekat ke mikrofon."));
    if (inTutor) {
      if (tutorSessions.get(chatId)?.text) await send(chatId, `🎤 “${heard}”`).catch(() => {});
      return handleTutorTurn(chatId, heard);
    }
    const key = `tg:${chatId}`;
    const inSession = !!(deps.simab?.enabled && deps.simab.hasSession?.(key));
    const cmd = voiceToCommand(heard, { inSession });
    const shown = cmd.changed && cmd.text ? `🎤 “${heard}”\n➡️ ${cmd.text.replace(/\n/g, " ⏎ ")}` : `🎤 “${heard}”`;
    await send(chatId, shown).catch(() => {});
    if (!cmd.text) return;
    return handleOwnerText(chatId, cmd.text, { viaVoice: true });
  }

  /** Satu pesan dari pemilik -> balasan. Dipisah dari polling supaya mudah dites. */
  async function handleOwnerText(chatId, rawText, { viaVoice = false } = {}) {
    const text = String(rawText ?? "").trim();
    if (!text) return;
    const key = `tg:${chatId}`;
    const reply = (t) => send(chatId, t);
    const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    const name = cmd ? cmd[1].toLowerCase() : "";
    const arg = cmd ? (cmd[2] || "").trim() : "";

    if (name === "start" || name === "help") return void (await reply(HELP));
    if (name === "id") return void (await reply(`Id chat ini: ${chatId}`));
    if (name === "baru") {
      histories.delete(chatId);
      return void (await reply("Oke, obrolan baru. Konteks sebelumnya dilupakan."));
    }

    if (name === "speak") return startTutor(chatId, arg);
    if (name === "selesai" || name === "stop") return endTutor(chatId);
    if (name === "teks" || name === "koreksi") {
      if (!tutorActive(chatId)) return void (await reply("Tidak ada sesi Speaking yang sedang berjalan. Mulai dengan /speak."));
      const s = tutorSessions.get(chatId);
      if (name === "koreksi") return void (await reply(s.fix ? `✏️ Lebih baik: ${s.fix.correction}${s.fix.tip ? `\n💡 ${s.fix.tip}` : ""}` : "Belum ada koreksi dari giliran terakhir. Ucapanmu sudah bagus!"));
      const a = arg.toLowerCase();
      if (["on", "aktif", "nyala", "ya"].includes(a)) s.text = true;
      else if (["off", "mati", "tidak"].includes(a)) s.text = false;
      else s.text = !s.text;
      return void (await reply(s.text ? "📝 Balasan tutor sekarang juga ditulis. /teks off untuk suara saja." : "🔊 Balasan tutor sekarang suara saja. /teks on bila mau teks juga."));
    }
    if (name === "suara") return handleVoiceCommand(chatId, arg);

    if (name === "dokumen" || name === "dok" || name === "doc") {
      const ld = deps.localDocs;
      if (!ld) return void (await reply("Fitur dokumen lokal belum aktif di bot ini."));
      if (arg === "" || /^(daftar|list|ls)$/i.test(arg)) return void (await reply(ld.list()));
      try {
        const out = await withTyping(chatId, () => ld.ask(arg));
        await reply(out.reply);
      } catch (e) {
        await reply(`⚠️ Gagal menjawab dari dokumen lokal: ${String(e?.message || e).slice(0, 200)}\nPastikan Ollama berjalan di laptop.`);
      }
      return;
    }

    // Perintah laptop (/sistem /log /restart /deploy /migrasi /ya): lihat ops.js. Sebelum blok SiMAB supaya "/ya <kode>" tidak tertelan sesi SiMAB.
    if (deps.ops && (deps.ops.commands || ["sistem", "log", "restart", "deploy", "migrasi", "ya", "ops"]).includes(name)) {
      try {
        const out = await deps.ops.handle(name, arg, { chatId, viaVoice, send: (t) => send(chatId, t) });
        if (typeof out === "string" && out) await reply(out);
      } catch (e) {
        await reply(`⚠️ Perintah laptop gagal: ${String(e?.message || e).slice(0, 200)}`);
      }
      return;
    }

    // SiMAB: "/simab ..." atau "simab ..." atau lanjutan sesi "simab rekam" yang sedang aktif
    const simab = deps.simab;
    const isSimabText = name === "simab" || /^simab\b/i.test(text);
    if (isSimabText || (simab?.enabled && simab.hasSession?.(key))) {
      if (!simab?.enabled) return void (await reply("Fitur SiMAB belum aktif: isi SIMAB_SUPABASE_URL, SIMAB_SUPABASE_ANON_KEY, SIMAB_BOT_EMAIL, SIMAB_BOT_PASSWORD di .env lalu restart bot."));
      return runSimab(chatId, name === "simab" ? `simab ${arg}`.trim() : text);
    }

    if (name === "status") {
      if (!deps.status) return void (await reply("Status belum tersedia."));
      try {
        await reply(await withTyping(chatId, () => deps.status()));
      } catch (e) {
        await reply(`⚠️ Status gagal dibuat: ${String(e?.message || e).slice(0, 300)}`);
      }
      return;
    }

    if (name === "ringkasan") {
      if (!deps.summary) return void (await reply("Ringkasan belum tersedia."));
      try {
        await reply("⏳ Membuat ringkasan hari ini...");
        await reply(await withTyping(chatId, () => deps.summary()));
      } catch (e) {
        await reply(`⚠️ Ringkasan gagal dibuat: ${String(e?.message || e).slice(0, 300)}`);
      }
      return;
    }

    if (name === "peraturan") {
      if (!deps.regNow) return void (await reply("Pantauan peraturan belum tersedia."));
      await withTyping(chatId, () => deps.regNow({ all: /^semua$/i.test(arg), sendTo: reply }));
      return;
    }

    if (cmd && name) return void (await reply(`Perintah /${name} tidak dikenal.\n\n${HELP}`));

    // latihan Speaking sedang berjalan: pesan biasa = ucapan untuk tutor
    if (tutorActive(chatId)) return handleTutorTurn(chatId, text);

    // obrolan biasa dengan AI
    pushHistory(chatId, "user", text);
    try {
      const answer = await withTyping(chatId, () => deps.chat([...(histories.get(chatId) || [])], text));
      const out = String(answer ?? "").trim();
      if (!out) throw new Error("jawaban kosong");
      pushHistory(chatId, "model", out);
      await reply(out);
      const mode = await getVoiceMode(chatId);
      if (mode === "on" || (mode === "auto" && viaVoice)) await trySpeak(chatId, out);
    } catch (e) {
      // buang pesan pengguna yang gagal dijawab supaya riwayat tidak berakhir di giliran "user" ganda
      const h = histories.get(chatId) || [];
      if (h.length && h[h.length - 1].role === "user") h.pop();
      log.error?.(`✈️ [Telegram] AI gagal: ${e?.message || e}`);
      await reply(`⚠️ Gagal membalas: ${String(e?.message || e).slice(0, 300)}`);
    }
  }

  async function handleUpdate(u) {
    if (u.callback_query) return handleCallback(u.callback_query);
    const m = u.message;
    if (!m || !m.chat) return;
    const chatId = String(m.chat.id);
    const isPrivate = m.chat.type === "private";

    if (owners.size === 0) {
      // mode pairing: hanya tunjukkan id chat
      if (!isPrivate) return;
      const last = pairingSeen.get(chatId) || 0;
      if (Date.now() - last < 30_000) return;
      pairingSeen.set(chatId, Date.now());
      await send(chatId, `Id chat kamu: ${chatId}\n\nIsi TELEGRAM_OWNER_IDS=${chatId} di .env bot, lalu restart bot (pm2 restart wa-bot --update-env). Sebelum itu bot belum menjalankan perintah apa pun.`).catch(() => {});
      return;
    }
    if (!owners.has(chatId) || !isPrivate) {
      if (!ignoredLogged.has(chatId)) {
        ignoredLogged.add(chatId);
        log.warn?.(`✈️ [Telegram] pesan dari chat ${chatId} diabaikan (bukan pemilik).`);
      }
      return;
    }
    if (m.voice || m.audio) return handleOwnerVoice(chatId, m.voice || m.audio);
    if (m.document && deps.ops?.handleDocument) return handleOwnerDocument(chatId, m.document);
    if (typeof m.text !== "string") {
      await send(chatId, "Bot membaca pesan teks dan pesan suara (tahan tombol mikrofon).").catch(() => {});
      return;
    }
    await handleOwnerText(chatId, m.text);
  }

  async function loadOffset() {
    try {
      const v = await deps.state?.get?.("telegram_offset");
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) offset = n;
    } catch {
      /* mulai dari 0: Telegram hanya mengirim yang belum dikonfirmasi */
    }
  }

  async function pollLoop() {
    let backoff = 2000;
    while (!stopped) {
      try {
        const updates = await api("getUpdates", { offset, timeout: config.pollTimeoutSec, allowed_updates: ["message", "callback_query"] }, { timeoutMs: (config.pollTimeoutSec + 15) * 1000 });
        backoff = 2000;
        for (const u of updates) {
          if (stopped) break;
          offset = Math.max(offset, u.update_id + 1);
          try {
            await handleUpdate(u);
          } catch (e) {
            log.error?.(`✈️ [Telegram] gagal memproses pesan: ${e?.message || e}`);
          }
        }
        if (updates.length > 0) {
          try {
            await deps.state?.set?.("telegram_offset", String(offset));
          } catch {
            /* gagal simpan offset: paling buruk satu pesan terproses ulang setelah restart */
          }
        }
      } catch (e) {
        if (stopped) break;
        if (e.status === 401) {
          log.error?.("✈️ [Telegram] token ditolak (401). Periksa TELEGRAM_BOT_TOKEN. Telegram dimatikan sampai bot di-restart.");
          return;
        }
        if (e.status === 409) {
          log.error?.("✈️ [Telegram] konflik (409): ada proses lain yang memakai bot ini (mis. dua instance bot jalan). Coba lagi 30 detik.");
          await sleep(30_000);
          continue;
        }
        log.warn?.(`✈️ [Telegram] polling gagal (${e?.message || e}), coba lagi ${Math.round(backoff / 1000)} detik.`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  async function start() {
    if (!enabled || running) return false;
    running = true;
    try {
      const me = await api("getMe");
      log.log?.(`✈️ Telegram: bot @${me.username} terhubung${owners.size ? ` (pemilik: ${[...owners].join(", ")})` : " -- MODE PAIRING: kirim pesan apa saja ke bot untuk melihat id chat-mu, lalu isi TELEGRAM_OWNER_IDS di .env"}.`);
    } catch (e) {
      log.error?.(`✈️ [Telegram] gagal terhubung: ${e?.message || e}. Telegram tidak aktif sampai bot di-restart.`);
      running = false;
      return false;
    }
    // webhook yang tersisa akan membuat getUpdates ditolak (409)
    await api("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
    if (owners.size > 0) {
      await api("setMyCommands", {
        commands: [
          { command: "simab", description: "SiMAB: pagu, cek, perjadin, sbm, rpd, rekam" },
          { command: "status", description: "Kondisi bot: WhatsApp, key Gemini, token, Ollama" },
          { command: "ringkasan", description: "Ringkasan percakapan WhatsApp hari ini" },
          { command: "peraturan", description: "Pantau peraturan terbaru" },
          { command: "dokumen", description: "Tanya dari dokumen lokal di laptop (dijawab Ollama)" },
          { command: "sistem", description: "Kondisi laptop bot; /ops untuk restart, deploy, log" },
          { command: "baru", description: "Mulai obrolan baru" },
          { command: "speak", description: "Ngobrol dengan tutor suara: Inggris, atau \"/speak id\" Indonesia" },
          { command: "selesai", description: "Akhiri sesi Speaking" },
          { command: "suara", description: "Atur balasan suara: auto / on / off" },
          { command: "help", description: "Bantuan" }
        ]
      }).catch(() => {});
    }
    await loadOffset();
    pollLoop().catch((e) => log.error?.(`✈️ [Telegram] loop berhenti: ${e?.message || e}`));
    return true;
  }

  function stop() {
    stopped = true;
  }

  const describe = () => (!enabled ? "mati (isi TELEGRAM_BOT_TOKEN di .env buat menyalakan)" : owners.size === 0 ? "AKTIF tapi mode pairing (isi TELEGRAM_OWNER_IDS)" : `AKTIF (${owners.size} pemilik, notifikasi ${config.mirror ? "ikut dikirim" : "tidak dikirim"} ke Telegram)`);

  return { enabled, mirror: config.mirror, start, stop, send, sendOwner, handleOwnerText, handleOwnerVoice, handleUpdate, describe, hasOwners: () => owners.size > 0 };
}
