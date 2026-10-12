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
// ================================================================

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
  "",
  "Perintah:",
  "/simab <perintah>  — SiMAB (pagu, cek, perjadin, sbm, rpd, rekam). Boleh juga tulis \"simab ...\" tanpa garis miring.",
  "Selama perekaman/ubah/hapus SiMAB, pilihan muncul sebagai tombol di bawah pesan (mengetik angka/kata tetap bisa).",
  "/status  — kondisi bot: WhatsApp, key Gemini, token hari ini, Ollama, dokumen",
  "/ringkasan  — ringkasan percakapan WhatsApp hari ini",
  "/peraturan  — pantau peraturan terbaru (\"/peraturan semua\" = tampilkan semua hasil)",
  "/baru  — mulai obrolan baru (lupakan konteks sebelumnya)",
  "/id  — tampilkan id chat ini"
].join("\n");

// ---------------------------------------------------------------- modul
/**
 * deps = {
 *   chat(history, userText)           -> Promise<string>   jawaban AI (history = [{role:"user"|"model", text}] sudah termasuk userText)
 *   simab?: { enabled, hasSession(key), run(text, {notify, sessionKey}) -> Promise<string> }
 *   summary?()                        -> Promise<string>   teks ringkasan harian
 *   status?()                         -> Promise<string>   teks kondisi bot (/status)
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

  async function withTyping(chatId, fn) {
    const tick = () => api("sendChatAction", { chat_id: chatId, action: "typing" }, { timeoutMs: 8000 }).catch(() => {});
    tick();
    const timer = setInterval(tick, 4500);
    try {
      return await fn();
    } finally {
      clearInterval(timer);
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

  /** Satu pesan dari pemilik -> balasan. Dipisah dari polling supaya mudah dites. */
  async function handleOwnerText(chatId, rawText) {
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

    // obrolan biasa dengan AI
    pushHistory(chatId, "user", text);
    try {
      const answer = await withTyping(chatId, () => deps.chat([...(histories.get(chatId) || [])], text));
      const out = String(answer ?? "").trim();
      if (!out) throw new Error("jawaban kosong");
      pushHistory(chatId, "model", out);
      await reply(out);
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
    if (typeof m.text !== "string") {
      await send(chatId, "Untuk sekarang bot hanya membaca pesan teks.").catch(() => {});
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
          { command: "baru", description: "Mulai obrolan baru" },
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

  return { enabled, mirror: config.mirror, start, stop, send, sendOwner, handleOwnerText, handleUpdate, describe, hasOwners: () => owners.size > 0 };
}
