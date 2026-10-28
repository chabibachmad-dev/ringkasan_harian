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
import { parseVoiceArg } from "./group-voice.js";
import { sampleText } from "./persona-voice.js";
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
  "🎙️ Latihan Inggris: /speak [topik] — kirim suara berbahasa Inggris, tutor membalas dengan SUARA SAJA (/koreksi = koreksi terakhir, /teks on = dengan teks). Santai berbahasa Indonesia: /speak id [topik]. Akhiri: /selesai.",
  "",
  "Perintah:",
  "/simab <perintah>  — SiMAB (pagu, cek, perjadin, sbm, rpd, rekam). Boleh juga tulis \"simab ...\" tanpa garis miring.",
  "Pilihan SiMAB muncul sebagai tombol (mengetik angka/kata tetap bisa).",
  "/status  — kondisi bot: WhatsApp, key Gemini, token, Ollama, dokumen, arsip",
  "/ringkasan  — ringkasan percakapan WhatsApp hari ini",
  "/peraturan  — pantau peraturan terbaru (\"/peraturan semua\" = tampilkan semua hasil)",
  "/dokumen <pertanyaan>  — tanya dari dokumen lokal di laptop, dijawab Ollama. \"/dokumen\" saja = daftar dokumen",
  "/arsip  — arsip PDF grup WA di laptop: ringkasan; daftar [grup]; cari <kata>; hapus <no>",
  "/pasar  — IHSG, emas dunia (Rp/gram), dan kurs USD/IDR (alias /emas, /ihsg); otomatis tiap pagi hari kerja",
  "/ingatkan <waktu> <teks>  — pengingat pribadi (contoh: /ingatkan besok 09:00 kirim SPJ);  /pengingat  — daftar / batal <nomor>;  /ibadah  — juz harian, hadits, ayat",
  "/kesehatan  — periksa Ollama, disk, memori, WhatsApp, basis data, dan cadangan sekarang",
  "/edu  — channel YouTube edukasi (setujui draf video; /edu bantuan)",
  "/voice wag on|off|id|eng|kor|arb|jawa  — balasan grup WA berupa suara/teks + bahasa suara",
  "/wa2  — nomor WhatsApp kedua (status, kode, qr)",
  "/grup  — grup WA yang dijawab bot: lihat, semua, tambah, hapus",
  "/humor  — humor per grup WA: pantun harian, roasting ringan, balas chat acak, chat otomatis, mode latihan",
  "/gambar <deskripsi>  — buat gambar; /gambar grup on|off = izinkan di grup WA\n/video <deskripsi>  — video bernarasi; kirim FOTO + keterangan \"jadikan video salju\" = foto hidup\n/env  — ubah kunci gambar (token Cloudflare, jatah) dari sini",
  "/kas  — laporan kas bulanan: konfirmasi angka, submit, simpan (/kas bantuan)",
  "/nodin  — konsep Nota Dinas LPJ (PDF + Word), otomatis tiap tanggal 1 (/nodin cek)",
  "/urutan  — lihat/ubah urutan AI balasan WhatsApp & grup (contoh: /urutan santai groq,gemini,ollama;  /urutan reset)",
  "/cadangan  — status cadangan otomatis (memori, pengingat, skill, sesi WhatsApp);  /cadangan sekarang  — buat sekarang",
  "/lokal <pesan>  — ngobrol dengan Ollama LOKAL (alias /tanya), tidak keluar dari laptop;  /lokal baru  — lupakan percakapan",
  "/skill  — daftar skill buatanmu;  /skill <nama> <teks>  — jalankan (Ollama lokal);  /skill baru|lihat|hapus <nama>",
  "/penyedia  — status tiap penyedia AI (Gemini, Groq, OpenRouter, Ollama): berhasil/gagal, key yang istirahat",
  "/ingat <teks>  — simpan catatan pribadi (hanya di laptop);  /catatan [kata]  — daftar/cari;  /lupa <nomor|semua>  — hapus",
  "/sistem  — kondisi laptop bot (pm2, disk, RAM, Ollama); /log /restart /deploy /migrasi: lihat /ops (OPS_ENABLED=true)",
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
 *   ops?: { handle(name, arg, {chatId, viaVoice, send}) -> Promise<string|undefined> }   perintah laptop (ops.js)
 *   localDocs?: { ask(q)->Promise<{reply}>, list()->string }   tanya-jawab dokumen lokal (/dokumen), dijawab Ollama
 *   arsip?: { handle(arg, {chatId}) -> string }   arsip PDF grup WhatsApp di laptop (arsip-pdf.js, /arsip)
 *   memory?: { handle({name:"ingat"|"catatan"|"lupa", arg}) -> string }   catatan pribadi pemilik (owner-memory.js), hanya dibaca Ollama lokal
 *   reminders?: { handle({name:"ingatkan"|"pengingat", arg}) -> string }   pengingat pribadi (reminders.js)
 *   health?: { report() -> Promise<string> }   papan kesehatan bot (health.js)
 *   env?: { handle(arg) -> Promise<{text, secret}> }   ubah kunci .env tertentu dari Telegram (env-edit.js, /env)
 *   metaAi?: { handle(arg) -> Promise<string> }   uji ngobrol dengan Meta AI (meta-ai.js, /metaai)
 *   video?: { available(), describe(), parseCommand(arg), setGroup(bool), make(prompt, {seconds}) -> Promise<{video:{buffer,mime,seconds}}|{error}> }   pembuat video (video-gen.js, /video)
 *   image?: { available(), describe(), parseCommand(arg), setGroup(bool) -> Promise<{on,saved}>, make(prompt) -> Promise<{image:{buffer,mime}}|{error}> }   pembuat gambar (image-gen.js, /gambar)
 *   groupVoice?: { enabled(), set(bool) -> Promise<{on,saved,warning}>, describe() }   balasan suara di grup WhatsApp (group-voice.js, /voice wag)
 *   groups?: { handle(arg) -> Promise<string> }   daftar grup yang dijawab (/grup)
 *   humor?: { handle(arg) -> Promise<string> }   mode humor per grup WhatsApp: pantun harian, roasting ringan (humor.js, /humor)
 *   wa2?: { describe() -> string, code() -> Promise<string>, qr() -> Promise<{data,name,mime,photo}> }   nomor WhatsApp kedua (/wa2, /wa2 kode)
 *   kas?: { handle(arg) -> Promise<{ok,text,files?,caption?}> }   laporan kas bulanan (kas.js, /kas)
 *   nodin?: { compose(arg) -> Promise<{ok,text,caption?,files?}> }   konsep nota dinas bulanan (nodin.js, /nodin)
 *   aiRoute?: { handle(arg) -> Promise<string> }   urutan penyedia AI balasan WA/grup (ai-route.js, /urutan)
 *   backup?: { status() -> string, run() -> Promise<string> }   cadangan lokal (backup.js)
 *   market?: { report() -> Promise<string>, diagnose?() -> Promise<string> }   /pasar (/emas /ihsg): IHSG, emas dunia, kurs USD/IDR (market-brief.js)
 *   skillAdmin?: { handle(sub, rest, {chatId, viaVoice}) -> string }   /skill baru|lihat|hapus (skills.js); perubahan lewat konfirmasi ops
 *   localChat?: { handle(key, arg)->Promise<string>, reset(key) }   obrolan dengan Ollama lokal (/lokal, /tanya; local-chat.js), tidak lewat Gemini
 *   skills?: { list()->string, ask(name, input)->Promise<{reply}> }   skill pemilik (file .md di wa-bot/skills), dijawab Ollama lokal (skills.js)
 *   providers?: { report({reset}) -> string }   status penyedia AI (/penyedia, provider-stats.js)
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

  /** Keterangan musik latar pada video jadi ("" bila tidak ada). */
  const musicCaption = (v) => (v?.music ? `🎵 ${v.music}${v.musicSource === "buatan" ? " (musik buatan bot)" : ""}${v.musicMatched === false ? " — tidak ada lagu yang cocok dengan permintaan, dipilih acak" : ""}` : v?.musicError ? `⚠️ Musik gagal ditempel (${v.musicError}); video dikirim tanpa musik.` : "");

  // ---- STOP MOTION: sesi kumpul foto berurutan (/stopmotion ... /stopmotion jadi) ----
  const STOP_IDLE_MS = 30 * 60_000;
  const stopSessions = new Map(); // chatId -> { photos:[{fileId}], preset, last, busy, ackTimer, fullTold }
  const stopLimits = () => ({ maxPhotos: 60, maxFps: 15, ...(deps.video?.stopLimits?.() || {}) });
  function stopSession(chatId) {
    const s = stopSessions.get(chatId);
    if (!s) return null;
    if (!s.busy && Date.now() - s.last > STOP_IDLE_MS) {
      clearTimeout(s.ackTimer);
      stopSessions.delete(chatId);
      return null;
    }
    return s;
  }
  const stopIntro = () => {
    const lim = stopLimits();
    return `🧱 Sesi stop motion dimulai. Kirim foto-fotonya BERURUTAN (satu per satu atau beberapa sekaligus; boleh dikirim sebagai "file" supaya tidak dikompres). Minimal 3, maksimal ${lim.maxPhotos}.\n\nTips: HP/kamera diam (tripod atau disandarkan), cahaya sama, geser bendanya sedikit demi sedikit tiap jepretan.\n\nKalau sudah: /stopmotion jadi\nOpsi (boleh ditulis di sana): 10 fps, bolak-balik, tulisan "Judul", potret / persegi, tanpa deflicker\nHapus foto terakhir: /stopmotion hapus · Batal: /stopmotion batal · Cek: /stopmotion status`;
  };
  const stopStatusText = (s) => `🧱 Sesi stop motion: ${s.photos.length} foto terkumpul${s.preset ? ` · opsi: ${s.preset}` : ""}. ${s.photos.length < 3 ? `Butuh minimal 3 foto.` : "Kirim lagi atau /stopmotion jadi."}`;
  /** Dipanggil SINKRON (tanpa await) supaya urutan foto = urutan kiriman. */
  function addStopPhoto(chatId, fileId) {
    const s = stopSession(chatId);
    if (!s) return false;
    const lim = stopLimits();
    s.last = Date.now();
    if (s.photos.length >= lim.maxPhotos) {
      if (!s.fullTold) {
        s.fullTold = true;
        send(chatId, `🧱 Sudah ${lim.maxPhotos} foto (batas). Foto berikutnya diabaikan — kirim /stopmotion jadi.`).catch(() => {});
      }
      return true;
    }
    s.photos.push({ fileId });
    clearTimeout(s.ackTimer);
    s.ackTimer = setTimeout(() => {
      send(chatId, `📸 ${s.photos.length} foto masuk. ${s.photos.length < 3 ? "Butuh minimal 3." : "Lanjut kirim, atau /stopmotion jadi."}`).catch(() => {});
    }, Number(deps.video?.stopAckMs ?? 1200));
    s.ackTimer.unref?.();
    return true;
  }
  const isStopImageDoc = (m) => Boolean(m?.document && /^image\/(?:jpe?g|png|webp)/i.test(String(m.document.mime_type || "")));
  const isStopPhoto = (m) => Boolean(m && stopSession(String(m.chat?.id)) && ((Array.isArray(m.photo) && m.photo.length) || isStopImageDoc(m)));

  async function handleStopMotion(chatId, arg, reply) {
    const vd = deps.video;
    if (!vd?.makeStopMotion) return void (await reply("Stop motion tidak tersedia di versi bot ini."));
    const a = String(arg ?? "").trim();
    const m = /^(\S+)\s*([\s\S]*)$/.exec(a);
    const word = m ? m[1].toLowerCase() : "";
    const rest = m ? m[2].trim() : "";
    const cur = stopSession(chatId);
    if (/^(?:batal|cancel|buang|reset|keluar)$/.test(word)) {
      if (!cur) return void (await reply("Tidak ada sesi stop motion yang berjalan."));
      if (cur.busy) return void (await reply("🧱 Videonya sedang dirakit, tunggu sebentar ya."));
      clearTimeout(cur.ackTimer);
      stopSessions.delete(chatId);
      return void (await reply(`🧱 Sesi stop motion dibatalkan (${cur.photos.length} foto dibuang).`));
    }
    if (/^(?:hapus|undo|mundur)$/.test(word)) {
      if (!cur || !cur.photos.length) return void (await reply("Belum ada foto di sesi stop motion."));
      cur.photos.pop();
      cur.last = Date.now();
      cur.fullTold = false;
      return void (await reply(`🧱 Foto terakhir dihapus. ${stopStatusText(cur)}`));
    }
    if (/^(?:status|info|cek)$/.test(word)) return void (await reply(cur ? stopStatusText(cur) : "Belum ada sesi stop motion. Mulai dengan /stopmotion."));
    if (/^(?:jadi|selesai|buat|render|proses|done|bikin)$/.test(word)) {
      if (!cur) return void (await reply("Belum ada sesi stop motion. Mulai dengan /stopmotion, kirim fotonya, lalu /stopmotion jadi."));
      if (cur.busy) return void (await reply("🧱 Videonya sedang dirakit, tunggu sebentar ya."));
      if (cur.photos.length < 3) return void (await reply(`🧱 Baru ${cur.photos.length} foto; butuh minimal 3. Kirim lagi fotonya.`));
      clearTimeout(cur.ackTimer);
      cur.busy = true;
      try {
        await reply(`🧱 ${cur.photos.length} foto diterima, sedang dirakit jadi video — biasanya setengah sampai dua menit. Kukirim begitu selesai.`);
        const buffers = [];
        let failed = 0;
        for (const p of cur.photos) {
          try {
            buffers.push(await withAction(chatId, "upload_video", () => downloadFile(p.fileId)));
          } catch (e) {
            failed += 1;
            log.warn?.(`🧱 [StopMotion] foto gagal diunduh: ${e?.message || e}`);
          }
        }
        if (buffers.length < 3) return void (await reply(`⚠️ Foto yang berhasil diunduh hanya ${buffers.length}. Sesi tetap tersimpan; coba /stopmotion jadi lagi.`));
        const out = await withAction(chatId, "upload_video", () => vd.makeStopMotion(buffers, `${rest} ${cur.preset || ""}`.trim()));
        if (out.error) return void (await reply(`⚠️ ${out.error}\nFoto di sesi tetap tersimpan; /stopmotion jadi untuk mencoba lagi atau /stopmotion batal.`));
        const v = out.video;
        stopSessions.delete(chatId);
        await sendFiles(chatId, [{ data: v.buffer, name: "stopmotion.mp4", mime: "video/mp4", video: true, width: v.width, height: v.height }], `🧱 ${v.photos} foto · ${v.fps} gambar/dtk · ${Math.round(v.seconds * 10) / 10} dtk${v.skipped || failed ? ` · ${(v.skipped || 0) + failed} foto dilewati` : ""}${musicCaption(v) ? `\n${musicCaption(v)}` : ""}`);
      } finally {
        cur.busy = false;
        cur.last = Date.now();
      }
      return;
    }
    // "/stopmotion", "/stopmotion mulai", atau opsi saja ("/stopmotion 10 fps bolak-balik")
    const fresh = /^(?:mulai|baru|start)$/.test(word);
    const preset = fresh ? rest : a;
    if (cur && !fresh) {
      if (preset) cur.preset = preset;
      cur.last = Date.now();
      return void (await reply(stopStatusText(cur)));
    }
    if (cur) {
      if (cur.busy) return void (await reply("🧱 Videonya sedang dirakit, tunggu sebentar ya."));
      clearTimeout(cur.ackTimer);
    }
    stopSessions.set(chatId, { photos: [], preset, last: Date.now(), busy: false, ackTimer: null, fullTold: false });
    await reply(stopIntro());
  }
  const voiceNoteAt = new Map(); // jenis catatan -> kapan terakhir dikirim (supaya tidak berisik)
  let running = false;
  let stopped = false;
  let offset = 0;

  // Galat jaringan sesaat ("fetch failed", ECONNRESET, DNS) di laptop rumahan: permintaan umumnya belum sampai ke Telegram,
  // jadi aman diulang. Timeout (abort) TIDAK diulang karena pesan bisa saja sudah terkirim.
  function isTransientNetworkError(e) {
    if (!e || e.status || e.name === "AbortError") return false;
    const code = e.cause?.code || e.code;
    return e instanceof TypeError || ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code);
  }

  async function api(method, payload = {}, opts = {}) {
    const maxRetries = method === "getUpdates" ? 0 : 2; // polling punya backoff sendiri
    for (let attempt = 0; ; attempt++) {
      try {
        return await apiOnce(method, payload, opts);
      } catch (e) {
        if (attempt >= maxRetries || !isTransientNetworkError(e)) throw e;
        log.warn?.(`✈️ [Telegram] ${method}: ${describeError(e)} — mencoba lagi (${attempt + 1}/${maxRetries})`);
        await sleep(600 * (attempt + 1) ** 2);
      }
    }
  }

  async function apiOnce(method, payload = {}, { timeoutMs = 20_000 } = {}) {
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
  async function sendOwner(text, { markup = null } = {}) {
    if (!enabled || owners.size === 0) return 0;
    let ok = 0;
    for (const id of owners) {
      try {
        await send(id, text, markup ? { markup } : {});
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

  /** Kirim berkas (dokumen) ke satu chat. caption memakai format WhatsApp (diubah ke HTML Telegram, maks 1024 huruf). */
  async function sendDocument(chatId, file, caption = "") {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("document", new Blob([file.data], { type: file.mime || "application/octet-stream" }), file.name);
    if (caption) {
      form.append("caption", waToTelegramHtml(caption).slice(0, 1000));
      form.append("parse_mode", "HTML");
    }
    return apiForm("sendDocument", form, { timeoutMs: 120_000 });
  }

  /** Kirim gambar sebagai foto (tampil langsung, bisa dipindai). */
  async function sendPhoto(chatId, file, caption = "") {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new Blob([file.data], { type: file.mime || "image/png" }), file.name);
    if (caption) {
      form.append("caption", waToTelegramHtml(caption).slice(0, 1000));
      form.append("parse_mode", "HTML");
    }
    return apiForm("sendPhoto", form, { timeoutMs: 120_000 });
  }

  /** Kirim video MP4 (tampil langsung & bisa diputar). */
  async function sendVideo(chatId, file, caption = "") {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("video", new Blob([file.data], { type: file.mime || "video/mp4" }), file.name);
    form.append("supports_streaming", "true");
    form.append("width", String(file.width || 1280));
    form.append("height", String(file.height || 720));
    if (caption) {
      form.append("caption", waToTelegramHtml(caption).slice(0, 1000));
      form.append("parse_mode", "HTML");
    }
    return apiForm("sendVideo", form, { timeoutMs: 180_000 });
  }

  /** Kirim beberapa berkas ke satu chat; keterangan menempel di berkas pertama. */
  async function sendFiles(chatId, files, caption = "") {
    let i = 0;
    for (const f of files) {
      try {
        if (f.video) await sendVideo(chatId, f, i === 0 ? caption : "");
        else if (f.photo) await sendPhoto(chatId, f, i === 0 ? caption : "");
        else await sendDocument(chatId, f, i === 0 ? caption : "");
      } catch (e) {
        // keterangan berformat ditolak (HTML)? kirim ulang tanpa keterangan berformat
        if (i === 0 && caption && e.status === 400 && /parse entities|can't parse/i.test(e.message)) await sendDocument(chatId, f, "");
        else throw e;
      }
      i += 1;
    }
  }

  /** Kirim berkas ke semua pemilik. Mengembalikan jumlah pemilik yang menerima. */
  async function sendOwnerFiles(files, caption = "") {
    if (!enabled || owners.size === 0) return 0;
    let ok = 0;
    for (const id of owners) {
      try {
        await sendFiles(id, files, caption);
        ok += 1;
      } catch (e) {
        log.error?.(`✈️ [Telegram] gagal kirim berkas ke ${id}: ${e?.message || e}`);
      }
    }
    return ok;
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

  /** Contoh suara (untuk memilih suara/gaya bot). Tidak menyimpan apa pun. */
  async function sendVoiceSample(chatId, { who = null, voice = null, style = "", text = "" } = {}) {
    const pv = deps.personaVoice;
    if (!deps.speak) return void (await send(chatId, "Suara belum aktif di bot ini (butuh GEMINI_API_KEYS dan ffmpeg)."));
    const cfg = voice ? { voice, style } : pv.get(who);
    const say = text || sampleText(who ? pv.label(who) : "");
    const desc = `${cfg.voice || "suara bawaan"}${cfg.style ? ` — gaya: ${cfg.style}` : ""}`;
    try {
      const out = await withAction(chatId, "record_voice", () => deps.speak(say, { voice: cfg.voice, style: cfg.style }));
      if (!out?.ogg) return void (await send(chatId, "Tidak ada yang bisa diucapkan dari teks contoh itu."));
      await send(chatId, `🔊 Contoh: ${desc}`);
      await sendVoice(chatId, out.ogg);
    } catch (e) {
      if (e?.code === "ffmpeg") await send(chatId, `🔇 Suara belum bisa: ${e.message} Pasang dengan: sudo apt install ffmpeg`);
      else if (e?.quota) await send(chatId, "🔇 Kuota suara Gemini sedang habis. Coba lagi nanti.");
      else await send(chatId, `🔇 Contoh suara gagal dibuat: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** /suara daftar | coba | pakai | reset | <nama bot>: suara & gaya bicara per bot (persona-voice.js). */
  async function handlePersonaVoice(chatId, cmd) {
    const pv = deps.personaVoice;
    if (cmd.kind === "error") return void (await send(chatId, cmd.error));
    if (cmd.kind === "list") return void (await send(chatId, pv.listText()));
    if (cmd.kind === "show") return void (await send(chatId, `🔊 Suara bot\n${pv.line(cmd.who)}\n\nCoba: /suara coba ${pv.label(cmd.who).split(/\s+/)[0].toLowerCase()}\nUbah: /suara pakai ${pv.label(cmd.who).split(/\s+/)[0].toLowerCase()} <NamaSuara> [gaya]  •  Daftar: /suara daftar`));
    if (cmd.kind === "reset") {
      const r = await pv.reset(cmd.who);
      return void (await send(chatId, `🔊 Suara ${pv.label(cmd.who)} dikembalikan ke bawaan${r.saved ? "." : " (gagal disimpan: berlaku sampai bot restart)."}`));
    }
    if (cmd.kind === "glist") return void (await send(chatId, `🔊 Suara khusus grup\n${pv.describeGroups()}\n\nTambah: /suara grup wanita <nama grup>  •  Hapus: /suara grup hapus <nama grup>\nGrup yang tidak terdaftar memakai suara bot (/suara ayyubi).`));
    if (cmd.kind === "gdel") {
      const r = await pv.removeGroup(cmd.label);
      return void (await send(chatId, r.removed ? `🔊 Aturan suara grup "${cmd.label}" dihapus; grup itu kembali memakai suara bot.${r.saved ? "" : " (gagal disimpan: berlaku sampai bot restart)."}` : `Tidak ada aturan suara untuk grup "${cmd.label}". Lihat daftar: /suara grup`));
    }
    if (cmd.kind === "gset") {
      let r;
      try {
        r = await pv.setGroup(cmd.label, cmd.voice, cmd.style);
      } catch (e) {
        return void (await send(chatId, `⚠️ ${e instanceof Error ? e.message : String(e)}`));
      }
      await send(chatId, `🔊 Grup yang namanya mengandung "${cmd.label}" sekarang memakai suara ${cmd.voice}${cmd.style ? ` — gaya: ${cmd.style}` : ""}.${r.saved ? " Langsung berlaku (tanpa restart); grup lain tetap memakai suara bot." : "\n⚠️ Gagal disimpan; berlaku sampai bot restart."}`);
      return void (await sendVoiceSample(chatId, { voice: cmd.voice, style: cmd.style }));
    }
    if (cmd.kind === "set") {
      const r = await pv.set(cmd.who, cmd.voice, cmd.style);
      await send(chatId, `🔊 Suara ${pv.label(cmd.who)} sekarang: ${cmd.voice}${cmd.style ? ` — gaya: ${cmd.style}` : ""}.${r.saved ? " Langsung berlaku di grup WhatsApp (tanpa restart)." : "\n⚠️ Gagal disimpan; berlaku sampai bot restart."}`);
      return void (await sendVoiceSample(chatId, { who: cmd.who }));
    }
    return void (await sendVoiceSample(chatId, cmd));
  }

  async function handleVoiceCommand(chatId, arg) {
    const pcmd = deps.personaVoice ? deps.personaVoice.parse(arg) : null;
    if (pcmd) return handlePersonaVoice(chatId, pcmd);
    const a = arg.toLowerCase();
    const map = { on: "on", aktif: "on", nyala: "on", selalu: "on", off: "off", mati: "off", matikan: "off", auto: "auto", otomatis: "auto" };
    const mode = map[a];
    const label = { auto: "otomatis (dibalas suara bila kamu kirim suara)", on: "selalu dibalas suara", off: "mati (hanya teks)" };
    if (!mode) {
      const cur = await getVoiceMode(chatId);
      return void (await send(chatId, `🔊 Balasan suara: ${label[cur]}.

Ubah: /suara auto • /suara on • /suara off

Suara tiap bot (Ayyubi/Wongsobot): /suara daftar • /suara coba <NamaSuara> [gaya] • /suara pakai <bot> <NamaSuara> [gaya]
Suara khusus satu grup: /suara grup wanita <nama grup> • /suara grup (daftar) • /suara grup hapus <nama grup>`));
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

  /** /voice: pusat pengaturan suara. /voice wag on|off = balasan grup WhatsApp suara/teks; /voice tg ... = sama dengan /suara. */
  async function handleVoiceHub(chatId, arg) {
    const cmd = parseVoiceArg(arg);
    const gv = deps.groupVoice;
    if (cmd.kind === "error") return void (await send(chatId, cmd.error));
    if (cmd.kind === "tg") return handleVoiceCommand(chatId, cmd.arg);
    if (!gv) return void (await send(chatId, "Fitur balasan suara grup belum aktif di bot ini."));
    if ((cmd.kind === "status" || cmd.value === null) && !cmd.lang) {
      const tg = await getVoiceMode(chatId);
      const tgLabel = { auto: "otomatis", on: "selalu suara", off: "teks saja" }[tg] || tg;
      return void (await send(chatId, `🔊 *Pengaturan suara*\n• Grup WhatsApp: ${gv.describe()}\n• Telegram: ${tgLabel}${deps.personaVoice ? `\n\n*Suara bot*\n${deps.personaVoice.describe()}\n(ubah: /suara daftar)` : ""}\n\nUbah: /voice wag on • /voice wag off\nBahasa suara grup: /voice wag auto • id • eng • kor • arb • jawa\n/voice tg auto|on|off`));
    }
    if (cmd.lang) {
      const l = await gv.setLang(cmd.lang);
      let extra = "";
      if (l.lang !== "auto" && !gv.enabled()) {
        const r2 = await gv.set(true);
        extra = `\nSuara grup sekarang *dinyalakan*.${r2.warning ? `\n⚠️ Tapi suara belum bisa dibuat sekarang: ${r2.warning}.` : ""}`;
      }
      const note = l.lang === "auto" ? "Bahasa suara grup: *otomatis* — mengikuti bahasa penanya." : `Bahasa suara grup: *${gv.describeLang()}* — semua balasan suara di grup dijawab dalam bahasa ini.`;
      return void (await send(chatId, `🔊 ${note}${extra}\nAnggota grup juga bisa meminta langsung di chat, mis. "bot, jawab pakai bahasa Korea" (berlaku untuk pesan itu saja).${l.saved ? "" : "\n\n⚠️ Pengaturan gagal disimpan; berlaku sampai bot restart."}`));
    }
    const r = await gv.set(cmd.value === "on");
    if (r.on) {
      await send(
        chatId,
        `🔊 Grup WhatsApp: balasan sekarang *voice note saja* (tanpa teks).\nJawaban yang panjang, berisi tautan, kode, atau tabel tetap dikirim sebagai teks supaya tidak terpotong. Kalau suara gagal dibuat, jawaban dikirim teks.${r.warning ? `\n\n⚠️ Tapi suara belum bisa dibuat sekarang: ${r.warning}. Sampai beres, balasan grup tetap teks.` : ""}${r.saved ? "" : "\n\n⚠️ Pengaturan gagal disimpan; berlaku sampai bot restart."}`
      );
    } else {
      await send(chatId, `💬 Grup WhatsApp: balasan kembali berupa *teks*.${r.saved ? "" : "\n\n⚠️ Pengaturan gagal disimpan; berlaku sampai bot restart."}`);
    }
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
    if (data.startsWith("hr:") && deps.humorReview) {
      // tombol draf mode latihan (humor.js): hr:ok:<id> kirim / hr:no:<id> buang
      await clearKeyboard(chatId, cb.message.message_id);
      let out;
      try {
        out = await deps.humorReview.decide(data.slice(3));
      } catch (e) {
        out = `⚠️ ${String(e?.message || e).slice(0, 300)}`;
      }
      if (out) await send(chatId, out).catch(() => {});
      return;
    }
    if (data.startsWith("ed:") && deps.edu) {
      // tombol draf video edukasi (edu-channel.js): ed:ok:<id> setujui / ed:again:<id> buat ulang / ed:no:<id> buang
      await clearKeyboard(chatId, cb.message.message_id);
      let out;
      try {
        out = await deps.edu.decide(data.slice(3));
      } catch (e) {
        out = `⚠️ ${String(e?.message || e).slice(0, 300)}`;
      }
      if (out) await send(chatId, out).catch(() => {});
      return;
    }
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
  /** Stiker Telegram dari pemilik -> koleksi stiker bot WhatsApp (jalur cadangan; hanya stiker statis .webp). */
  async function handleOwnerSticker(chatId, st) {
    if (st.is_animated || st.is_video) return void (await send(chatId, "🎭 Stiker animasi/video Telegram belum bisa disimpan (formatnya beda dengan WhatsApp). Kirim stiker statis, atau kirim stikernya lewat WhatsApp ke \"Pesan untuk diri sendiri\".").catch(() => {}));
    try {
      const buffer = await withAction(chatId, "typing", () => downloadFile(st.file_id));
      const r = await deps.stickers.add(buffer);
      if (!r.ok) return void (await send(chatId, `🎭 Stiker tidak disimpan: ${r.reason}`));
      if (r.dup) return void (await send(chatId, `🎭 Stiker itu sudah ada di koleksi (#${r.index}${r.item?.tag ? `, ${r.item.tag}` : ""}).`));
      await send(chatId, `🎭 Stiker tersimpan di koleksi (#${r.index}): ${r.item?.tag || "belum berlabel"}.${r.labelErr ? `\n⚠️ Label otomatis gagal: ${r.labelErr}` : ""}\nLihat/kelola: /humor koleksi`);
    } catch (e) {
      await send(chatId, `🎭 Stiker gagal disimpan: ${String(e?.message || e).slice(0, 200)}`).catch(() => {});
    }
  }

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

  /** Foto Telegram -> video hidup (gerak kamera + efek). */
  async function handleOwnerPhotoVideo(chatId, photo, text) {
    if (deps.video?.photoAvailable && !deps.video.photoAvailable()) return void (await send(chatId, "Pembuat video sedang dimatikan."));
    let buffer;
    try {
      buffer = await withAction(chatId, "upload_video", () => downloadFile(photo.file_id));
    } catch (e) {
      return void (await send(chatId, `⚠️ Fotonya gagal diunduh: ${String(e?.message || e).slice(0, 160)}`).catch(() => {}));
    }
    await send(chatId, "🎞️ Fotonya sedang dihidupkan (gerak kamera + efek) — biasanya setengah sampai dua menit. Kukirim begitu selesai.").catch(() => {});
    const out = await withAction(chatId, "upload_video", () => deps.video.makeFromPhoto(buffer, text));
    if (out.error) return void (await send(chatId, `⚠️ ${out.error}`).catch(() => {}));
    await sendFiles(chatId, [{ data: out.video.buffer, name: "foto-hidup.mp4", mime: "video/mp4", video: true, width: out.video.width, height: out.video.height }], musicCaption(out.video));
  }

  /** Foto Telegram -> morf (diedit AI bertahap lalu disambung). Percobaan, pemilik saja. */
  async function handleOwnerPhotoMorph(chatId, photo, text) {
    if (!deps.video.makeMorph) return void (await send(chatId, "Morf foto tidak tersedia di versi bot ini."));
    if (deps.video.morphAvailable && !deps.video.morphAvailable()) return void (await send(chatId, "Morf foto butuh pembuat edit foto: isi CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (gratis) lewat /env, dan jangan mematikan Cloudflare di IMAGE_PROVIDERS."));
    let buffer;
    try {
      buffer = await withAction(chatId, "upload_video", () => downloadFile(photo.file_id));
    } catch (e) {
      return void (await send(chatId, `⚠️ Fotonya gagal diunduh: ${String(e?.message || e).slice(0, 160)}`).catch(() => {}));
    }
    let told = false;
    const out = await withAction(chatId, "upload_video", () =>
      deps.video.makeMorph(buffer, text, {
        onStage: (stage, i, n) => {
          if (told || stage !== "edit") return;
          told = true;
          send(chatId, `🧬 Fotonya diubah bertahap (${n} edit AI lalu disambung jadi video) — biasanya 3–8 menit. Kukirim begitu selesai.`).catch(() => {});
        }
      })
    );
    if (out.error) return void (await send(chatId, `⚠️ ${out.error}`).catch(() => {}));
    const v = out.video;
    await sendFiles(chatId, [{ data: v.buffer, name: "morf.mp4", mime: "video/mp4", video: true, width: v.width, height: v.height }], `🧬 ${v.frames} gambar kunci${v.fallback ? " (rencana cadangan, AI teks tidak menjawab)" : ""}${v.smooth ? ", interpolasi gerak" : ""}${musicCaption(v) ? `\n${musicCaption(v)}` : ""}`);
  }

  /** Foto Telegram + instruksi ("ubah jadi hitam putih", "/edit tambah salju") -> foto hasil edit (Cloudflare FLUX, gratis). */
  async function handleOwnerPhotoEdit(chatId, photo, prompt) {
    const im = deps.image;
    if (!im?.editPhoto) return void (await send(chatId, "Edit foto tidak tersedia di versi bot ini."));
    if (im.canEdit && !im.canEdit()) return void (await send(chatId, "Edit foto butuh pembuat gambar Cloudflare: isi CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (gratis) lewat /env, dan jangan mematikan Cloudflare di IMAGE_PROVIDERS."));
    let buffer;
    try {
      buffer = await withAction(chatId, "upload_photo", () => downloadFile(photo.file_id));
    } catch (e) {
      return void (await send(chatId, `⚠️ Fotonya gagal diunduh: ${String(e?.message || e).slice(0, 160)}`).catch(() => {}));
    }
    const out = await withAction(chatId, "upload_photo", () => im.editPhoto(buffer, prompt));
    if (out.error) return void (await send(chatId, `⚠️ ${out.error}`).catch(() => {}));
    const ext = /jpe?g/i.test(out.image.mime) ? "jpg" : /webp/i.test(out.image.mime) ? "webp" : "png";
    await sendFiles(chatId, [{ data: out.image.buffer, name: `edit.${ext}`, mime: out.image.mime || "image/png", photo: true }], "");
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
  async function handleOwnerText(chatId, rawText, { viaVoice = false, messageId = null } = {}) {
    const text = String(rawText ?? "").trim();
    if (!text) return;
    const key = `tg:${chatId}`;
    const reply = (t) => send(chatId, t);
    const cmd = /^\/([a-z_][a-z0-9_]*)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    const name = cmd ? cmd[1].toLowerCase() : "";
    const arg = cmd ? (cmd[2] || "").trim() : "";

    if (name === "start" || name === "help") return void (await reply(HELP));
    if (name === "id") return void (await reply(`Id chat ini: ${chatId}`));
    if (name === "baru") {
      histories.delete(chatId);
      deps.localChat?.reset?.(key);
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
    if (name === "voice") return handleVoiceHub(chatId, arg);
    if (name === "env") {
      if (!deps.env) return void (await reply("Pengaturan .env dari Telegram tidak tersedia di versi bot ini."));
      if (viaVoice) return void (await reply("⛔ /env tidak bisa lewat pesan suara. Ketik perintahnya."));
      const out = await deps.env.handle(arg);
      // pesan yang memuat token dihapus dari chat (bila Telegram mengizinkan) supaya tidak tertinggal di riwayat
      if (out.secret && messageId) await api("deleteMessage", { chat_id: chatId, message_id: messageId }, { timeoutMs: 8000 }).catch(() => {});
      return void (await reply(out.text + (out.secret && messageId ? "\n🧹 Pesanmu yang berisi token sudah kuhapus dari chat." : "")));
    }
    if (name === "metaai") {
      if (!deps.metaAi) return void (await reply("Uji Meta AI tidak tersedia di versi bot ini."));
      return void (await reply(await withAction(chatId, "typing", () => deps.metaAi.handle(arg))));
    }
    if (name === "gambar" || name === "image" || name === "img") {
      const im = deps.image;
      if (!im) return void (await reply("Pembuat gambar tidak tersedia di versi bot ini."));
      if (!im.available()) return void (await reply("Pembuat gambar belum aktif: isi CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (gratis) atau GEMINI_API_KEYS di .env bot."));
      const c = im.parseCommand(arg);
      if (c.kind === "status") {
        return void (await reply(`🖼️ Pembuat gambar\n${im.describe()}\n\nPakai: /gambar <deskripsi>\nDi grup WA: ketik "bot, buatkan gambar ...".\nSaklar grup: /gambar grup on atau /gambar grup off`));
      }
      if (c.kind === "group") {
        const r = await im.setGroup(c.value);
        return void (await reply(r.on ? "🖼️ Gambar di grup WA: AKTIF. Anggota grup yang diizinkan bisa minta \"bot, buatkan gambar ...\" (dibatasi jatah harian)." : "🖼️ Gambar di grup WA: MATI. Permintaan gambar di grup dijawab seperti pertanyaan biasa." + (r.saved ? "" : "\n⚠️ Gagal disimpan di database; berlaku sampai bot restart.")));
      }
      if (!c.prompt) return void (await reply("Mau digambar apa? Contoh: /gambar kucing memakai topi astronot"));
      const out = await withAction(chatId, "upload_photo", () => im.make(c.prompt));
      if (out.error) return void (await reply(`⚠️ ${out.error}`));
      const ext = /jpe?g/i.test(out.image.mime) ? "jpg" : /webp/i.test(out.image.mime) ? "webp" : "png";
      return void (await sendFiles(chatId, [{ data: out.image.buffer, name: `gambar.${ext}`, mime: out.image.mime || "image/png", photo: true }], ""));
    }
    if (name === "stopmotion" || name === "stop_motion") return handleStopMotion(chatId, arg, reply);
    if (name === "musik" || name === "music") return reply(deps.video?.musicInfo ? deps.video.musicInfo() : "Musik latar tidak tersedia di versi bot ini.");
    if (name === "video" || name === "vidio" || name === "vid") {
      const vd = deps.video;
      if (!vd) return void (await reply("Pembuat video tidak tersedia di versi bot ini."));
      if (!vd.available() && !vd.storyAvailable?.()) return void (await reply("Pembuat video belum aktif: ia memakai pembuat gambar (isi CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN gratis di /env) dan ffmpeg (sudo apt install ffmpeg)."));
      const c = vd.parseCommand(arg);
      if (c.kind === "status") {
        return void (await reply(`🎬 Pembuat video (gratis, dirakit ffmpeg)\n${vd.describe()}\n\nPakai: /video <deskripsi>  (contoh: /video 30 detik tentang siklus air)\nAnimasi tokoh tanpa wajah: /video animasi <cerita>  (contoh: /video animasi ayah dan anak ke taman)\nMorf foto (percobaan): kirim foto + keterangan "/video morf siang jadi malam bersalju"\nDi grup WA: ketik "bot, buatkan video ...".\nSaklar grup: /video grup on atau /video grup off`));
      }
      if (c.kind === "morph") return void (await reply("🧬 Morf foto butuh FOTO: kirim foto dengan keterangan \"/video morf siang jadi malam bersalju\" (boleh tambah: 8 detik, 5 tahap, halus), atau balas (reply) foto yang mau diubah dengan perintah itu."));
      if (c.kind === "group") {
        const r = await vd.setGroup(c.value);
        return void (await reply(r.on ? "🎬 Video di grup WA: AKTIF. Anggota grup yang diizinkan bisa minta \"bot, buatkan video ...\" (dibatasi jatah harian)." : "🎬 Video di grup WA: MATI." + (r.saved ? "" : "\n⚠️ Gagal disimpan di database; berlaku sampai bot restart.")));
      }
      if (!c.prompt) return void (await reply("Mau dibuatkan video tentang apa? Contoh: /video kancil dan buaya  atau  /video 30 detik tentang siklus air"));
      if (c.mode !== "karakter" && !vd.available()) return void (await reply("Video gambar biasa butuh pembuat gambar (isi CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN di /env). Animasi karakter tetap bisa tanpa itu: /video animasi <cerita>"));
      await reply(c.mode === "karakter" ? `🎭 Sedang membuat animasi${c.style === "stopmotion" ? " bergaya stop motion (potongan kertas)" : ""} (naskah, latar, suara, menggambar tokoh bergerak) — biasanya 2–5 menit. Kukirim begitu selesai.` : "🎬 Sedang membuat video (naskah, gambar, suara, rakit) — biasanya 1–3 menit. Kukirim begitu selesai.");
      const out = await withAction(chatId, "upload_video", () => vd.make(c.prompt, { seconds: c.seconds, mode: c.mode, ...(c.style ? { style: c.style } : {}) }));
      if (out.error) return void (await reply(`⚠️ ${out.error}`));
      return void (await sendFiles(chatId, [{ data: out.video.buffer, name: "video.mp4", mime: "video/mp4", video: true }], musicCaption(out.video)));
    }
    if (name === "humor" || name === "lucu") {
      if (!deps.humor) return void (await reply("Mode humor tidak tersedia di versi bot ini."));
      return void (await reply(await withAction(chatId, "typing", () => deps.humor.handle(arg))));
    }
    if (name === "grup" || name === "group") {
      if (!deps.groups) return void (await reply("Pengaturan grup tidak tersedia di versi bot ini."));
      return void (await reply(await withAction(chatId, "typing", () => deps.groups.handle(arg))));
    }
    if (name === "wa2" || name === "nomor2") {
      const w = deps.wa2;
      if (!w) return void (await reply("Nomor kedua tidak tersedia di versi bot ini."));
      if (/^(kode|code|tautkan|pair)$/i.test(arg.trim())) {
        try {
          return void (await reply(await withAction(chatId, "typing", () => w.code())));
        } catch (e) {
          return void (await reply(`⚠️ ${e instanceof Error ? e.message : e}`));
        }
      }
      if (/^(qr|barcode)$/i.test(arg.trim())) {
        try {
          const img = await withAction(chatId, "upload_photo", () => w.qr());
          return void (await sendFiles(chatId, [img], "QR penautan Nomor 2. Di HP nomor 2: WhatsApp → Perangkat Tertaut → Tautkan Perangkat → pindai QR ini dari HP/laptop lain (bukan dari HP yang sama). QR berlaku ±1 menit; kalau gagal kirim /wa2 qr lagi."));
        } catch (e) {
          return void (await reply(`⚠️ ${e instanceof Error ? e.message : e}`));
        }
      }
      return void (await reply(w.describe()));
    }

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

    if (name === "arsip") {
      const ar = deps.arsip;
      if (!ar) return void (await reply("Arsip PDF grup belum aktif di bot ini (ARSIP_ENABLED=false atau gagal dibuka — lihat log)."));
      try {
        return void (await reply(await ar.handle(arg, { chatId })));
      } catch (e) {
        return void (await reply(`⚠️ Arsip gagal dibaca: ${String(e?.message || e).slice(0, 200)}`));
      }
    }

    if (name === "edu" || name === "channel" || name === "yt") {
      const edu = deps.edu;
      if (!edu) return void (await reply("Channel edukasi belum terpasang di bot ini."));
      try {
        return void (await reply(await withTyping(chatId, () => edu.handle(arg))));
      } catch (e) {
        return void (await reply(`⚠️ Channel edukasi: ${String(e?.message || e).slice(0, 300)}`));
      }
    }

    if (name === "pasar" || name === "emas" || name === "ihsg") {
      if (!deps.market) return void (await reply("Fitur pemeriksaan pasar belum aktif di bot ini."));
      try {
        if (/^(tes|uji|debug|diagnosa)$/i.test(String(arg || "").trim()) && deps.market.diagnose) return void (await reply(await withTyping(chatId, () => deps.market.diagnose())));
        return void (await reply(await withTyping(chatId, () => deps.market.report())));
      } catch (e) {
        return void (await reply(`⚠️ Gagal mengambil data pasar: ${String(e?.message || e).slice(0, 200)}`));
      }
    }
    if (name === "lokal" || name === "tanya") {
      const lc = deps.localChat;
      if (!lc) return void (await reply("Fitur obrolan lokal belum aktif di bot ini."));
      try {
        return void (await reply(await withTyping(chatId, () => lc.handle(key, arg))));
      } catch (e) {
        return void (await reply(`⚠️ Ollama lokal gagal menjawab: ${String(e?.message || e).slice(0, 200)}\nPastikan Ollama berjalan di laptop.`));
      }
    }
    if (name === "skill" || name === "skil") {
      const sk = deps.skills;
      if (!sk) return void (await reply("Fitur skill belum aktif di bot ini."));
      const first = /^(\S+)(?:\s+([\s\S]*))?$/.exec(arg);
      if (!first || /^(daftar|list|ls)$/i.test(arg)) return void (await reply(sk.list()));
      if (/^(baru|tambah|buat|lihat|hapus|bantuan|help)$/i.test(first[1])) {
        const admin = deps.skillAdmin;
        if (!admin) return void (await reply("Mengelola skill dari Telegram belum aktif di bot ini. Buat file .md di wa-bot/skills/ atau kirim zip patch."));
        const verb = first[1].toLowerCase();
        const sub = verb === "tambah" || verb === "buat" ? "baru" : verb === "help" || verb === "bantuan" ? "" : verb;
        try {
          return void (await reply(await admin.handle(sub, (first[2] ?? "").trim(), { chatId, viaVoice })));
        } catch (e) {
          return void (await reply(`⚠️ Gagal mengelola skill: ${String(e?.message || e).slice(0, 200)}`));
        }
      }
      try {
        const out = await withTyping(chatId, () => sk.ask(first[1].toLowerCase().replace(/^\/+/, ""), (first[2] ?? "").trim()));
        await reply(out.reply);
      } catch (e) {
        await reply(`⚠️ Skill gagal dijalankan: ${String(e?.message || e).slice(0, 200)}\nPastikan Ollama berjalan di laptop.`);
      }
      return;
    }
    if (name === "ingat" || name === "catatan" || name === "lupa" || name === "memori" || name === "note") {
      if (!deps.memory) return void (await reply("Fitur catatan belum aktif di bot ini."));
      try {
        const memName = name === "memori" || name === "note" ? "catatan" : name;
        return void (await reply(deps.memory.handle({ name: memName, arg })));
      } catch (e) {
        return void (await reply(`⚠️ Catatan gagal diproses: ${String(e?.message || e).slice(0, 200)}`));
      }
    }
    if (name === "ingatkan" || name === "remind" || name === "pengingat" || name === "reminder" || name === "ibadah") {
      if (!deps.reminders) return void (await reply("Fitur pengingat belum aktif di bot ini."));
      try {
        const remName = name === "ibadah" ? "ibadah" : name === "ingatkan" || name === "remind" ? "ingatkan" : "pengingat";
        return void (await reply(deps.reminders.handle({ name: remName, arg })));
      } catch (e) {
        return void (await reply(`⚠️ Pengingat gagal diproses: ${String(e?.message || e).slice(0, 200)}`));
      }
    }
    if (name === "urutan" || name === "route" || name === "rute") {
      if (!deps.aiRoute) return void (await reply("Pengaturan urutan AI belum aktif di bot ini."));
      try {
        return void (await reply(await deps.aiRoute.handle(arg)));
      } catch (e) {
        return void (await reply(`⚠️ Urutan AI gagal diproses: ${String(e?.message || e).slice(0, 200)}`));
      }
    }
    if (name === "nodin" || name === "notadinas") {
      if (!deps.nodin) return void (await reply("Fitur konsep nota dinas belum aktif di bot ini."));
      try {
        const r = await withAction(chatId, "upload_document", () => deps.nodin.compose(arg));
        if (!r.ok || !r.files?.length) return void (await reply(r.text));
        return void (await sendFiles(chatId, r.files, r.caption));
      } catch (e) {
        return void (await reply(`⚠️ Konsep nota dinas gagal dibuat: ${String(e?.message || e).slice(0, 200)}`));
      }
    }
    if (name === "kas" || name === "laporankas") {
      if (!deps.kas) return void (await reply("Fitur laporan kas belum aktif di bot ini."));
      try {
        const r = await withAction(chatId, "typing", () => deps.kas.handle(arg));
        if (r.text) await reply(r.text);
        if (r.files?.length) await sendFiles(chatId, r.files, r.caption);
        return;
      } catch (e) {
        return void (await reply(`⚠️ Perintah kas gagal diproses: ${String(e?.message || e).slice(0, 200)}`));
      }
    }
    if (name === "kesehatan" || name === "sehat" || name === "health") {
      if (!deps.health) return void (await reply("Fitur penjaga kesehatan belum aktif di bot ini."));
      try {
        return void (await reply(await withTyping(chatId, () => deps.health.report())));
      } catch (e) {
        return void (await reply(`⚠️ Pemeriksaan kesehatan gagal: ${String(e?.message || e).slice(0, 200)}`));
      }
    }
    if (name === "cadangan" || name === "backup") {
      if (!deps.backup) return void (await reply("Fitur cadangan belum aktif di bot ini."));
      try {
        const now = /^(sekarang|now|buat|jalankan|run)$/i.test(String(arg || "").trim());
        return void (await reply(await withTyping(chatId, () => (now ? deps.backup.run() : deps.backup.status()))));
      } catch (e) {
        return void (await reply(`⚠️ Cadangan gagal diproses: ${String(e?.message || e).slice(0, 200)}`));
      }
    }
    if (name === "penyedia" || name === "provider") {
      if (!deps.providers) return void (await reply("Status penyedia belum tersedia."));
      try {
        return void (await reply(deps.providers.report({ reset: /^(reset|ulang|nol|bersihkan)$/i.test(arg) })));
      } catch (e) {
        return void (await reply(`⚠️ Status penyedia gagal dibuat: ${String(e?.message || e).slice(0, 200)}`));
      }
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
    // sesi /stopmotion aktif: foto (atau berkas gambar) = bingkai berikutnya. Sinkron supaya urutannya terjaga.
    if (isStopPhoto(m)) {
      const fileId = Array.isArray(m.photo) && m.photo.length ? m.photo.at(-1).file_id : m.document.file_id;
      addStopPhoto(chatId, fileId);
      return;
    }
    if (m.sticker && deps.stickers?.add) return handleOwnerSticker(chatId, m.sticker);
    if (m.voice || m.audio) return handleOwnerVoice(chatId, m.voice || m.audio);
    if (m.document && deps.ops?.handleDocument) return handleOwnerDocument(chatId, m.document);
    // FOTO HIDUP: foto + keterangan ("/video salju", "jadikan video dengan hujan") atau membalas foto dengan perintah itu
    if (deps.video?.makeFromPhoto) {
      const own = Array.isArray(m.photo) && m.photo.length ? m.photo : null;
      const replied = !own && Array.isArray(m.reply_to_message?.photo) && m.reply_to_message.photo.length ? m.reply_to_message.photo : null;
      const caption = own ? String(m.caption ?? "") : typeof m.text === "string" ? m.text : "";
      const morph = own || replied ? deps.video.detectMorph?.(caption, { hasImage: true }) : null;
      if (morph) return handleOwnerPhotoMorph(chatId, (own || replied).at(-1), morph.text);
      const anim = own || replied ? deps.video.detectPhoto?.(caption, { hasImage: true }) : null;
      if (anim) return handleOwnerPhotoVideo(chatId, (own || replied).at(-1), anim.text);
      if (!own && !replied && typeof m.text === "string") {
        const need = deps.video.detectPhoto?.(m.text, { hasImage: false });
        if (need?.needsImage) return void (await send(chatId, "Fotonya belum ada. Kirim foto dengan keterangan, mis. \"jadikan video dengan salju turun\", atau balas (reply) foto yang mau dihidupkan dengan: jadikan video.").catch(() => {}));
      }
    }
    // EDIT FOTO: foto + keterangan ("ubah jadi hitam putih" atau "/edit tambah salju"), atau balas foto dengan instruksi itu
    if (deps.image?.editPhoto) {
      const own = Array.isArray(m.photo) && m.photo.length ? m.photo : null;
      const replied = !own && Array.isArray(m.reply_to_message?.photo) && m.reply_to_message.photo.length ? m.reply_to_message.photo : null;
      const raw = (own ? String(m.caption ?? "") : typeof m.text === "string" ? m.text : "").trim();
      const slash = /^\/(?:edit|ubah)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(raw);
      if (own || replied) {
        const prompt = slash ? String(slash[1] || "").trim() : deps.image.detectEdit?.(raw, { hasImage: true })?.prompt;
        if (slash && !prompt) return void (await send(chatId, "Mau diedit jadi apa? Contoh: /edit ubah jadi hitam putih  atau  /edit tambahkan salju").catch(() => {}));
        if (prompt) return handleOwnerPhotoEdit(chatId, (own || replied).at(-1), prompt);
      } else if (slash) {
        return void (await send(chatId, "Edit foto butuh FOTO: kirim foto dengan keterangan \"/edit ubah jadi hitam putih\", atau balas (reply) foto yang mau diedit dengan perintah itu.").catch(() => {}));
      }
    }
    if (typeof m.text !== "string") {
      await send(chatId, "Bot membaca pesan teks dan pesan suara (tahan tombol mikrofon).").catch(() => {});
      return;
    }
    await handleOwnerText(chatId, m.text, { messageId: m.message_id });
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

  const HANDLER_DEADLINE_MS = 10 * 60_000;
  const FAST_COMMANDS = new Set(["dokumen", "dok", "doc", "arsip", "status", "id", "help", "start", "ingat", "catatan", "lupa", "memori", "note", "penyedia", "provider", "skill", "skil", "lokal", "tanya", "pasar", "emas", "ihsg", "ingatkan", "remind", "pengingat", "reminder", "cadangan", "backup", "kesehatan", "sehat", "health", "urutan", "route", "rute", "nodin", "notadinas", "kas", "laporankas", "voice", "wa2", "nomor2", "grup", "group", "gambar", "image", "img", "video", "vidio", "vid", "metaai", "env", "stopmotion", "stop_motion", "edit", "ubah", "musik", "music", "edu", "channel", "yt"]);
  function isFastUpdate(u) {
    const m = u?.message;
    if (!m) return false;
    if (isStopPhoto(m)) return true; // hanya menambah ke daftar (tanpa await), jadi aman jalan langsung dan urutannya terjaga
    if (m.document && deps.ops?.handleDocument) return true;
    const c = typeof m.text === "string" ? /^\/([a-z_][a-z0-9_]*)/i.exec(m.text) : null;
    if (!c) return false;
    const name = c[1].toLowerCase();
    return FAST_COMMANDS.has(name) || (deps.ops?.commands || []).includes(name);
  }

  const chains = new Map(); // chatId -> rantai penanganan pesan biasa (berurutan)
  function dispatchUpdate(u) {
    const run = () => handleUpdate(u).catch((e) => log.error?.(`✈️ [Telegram] gagal memproses pesan: ${e?.message || e}`));
    if (isFastUpdate(u)) return void run();
    const key = String(u?.message?.chat?.id ?? u?.callback_query?.message?.chat?.id ?? "x");
    const guarded = () => {
      // Batas pengaman: satu penanganan yang macet tidak boleh menahan pesan berikutnya selamanya.
      let timer;
      return Promise.race([
        run(),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            log.error?.("✈️ [Telegram] penanganan pesan melewati batas waktu 10 menit; lanjut ke pesan berikutnya.");
            resolve();
          }, HANDLER_DEADLINE_MS);
          timer.unref?.();
        })
      ]).finally(() => clearTimeout(timer));
    };
    const next = (chains.get(key) || Promise.resolve()).then(guarded);
    chains.set(key, next);
    next.finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  }

  async function pollLoop() {
    log.log?.(`✈️ [Telegram] mulai menerima pesan (offset ${offset}).`);
    let backoff = 2000;
    while (!stopped) {
      try {
        const updates = await api("getUpdates", { offset, timeout: config.pollTimeoutSec, allowed_updates: ["message", "callback_query"] }, { timeoutMs: (config.pollTimeoutSec + 15) * 1000 });
        backoff = 2000;
        for (const u of updates) {
          if (stopped) break;
          offset = Math.max(offset, u.update_id + 1);
          // Polling TIDAK menunggu penanganan pesan: pesan biasa antre berurutan per chat (urutan percakapan terjaga),
          // sedangkan /restart, /sistem, /log, /ya, /dokumen, zip patch, dll. jalan langsung. Dulu semuanya dijalankan satu per satu
          // di dalam loop polling, jadi satu jawaban AI/dokumen yang lambat (atau jaringan buruk) membuat bot terasa "beku".
          dispatchUpdate(u);
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
        log.warn?.(`✈️ [Telegram] polling gagal (${describeError(e)}), coba lagi ${Math.round(backoff / 1000)} detik.`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  async function start() {
    if (!enabled || running) return false;
    running = true;
    // Jaringan sering belum siap tepat saat bot baru menyala (mis. setelah /restart): coba lagi beberapa menit.
    // Token ditolak (401/404) langsung menyerah. Dulu satu "fetch failed" saja mematikan Telegram sampai restart berikutnya.
    const MAX_CONNECT_TRIES = 12;
    let connected = false;
    for (let attempt = 1; attempt <= MAX_CONNECT_TRIES && !stopped; attempt++) {
      try {
        const me = await apiOnce("getMe");
        log.log?.(`✈️ Telegram: bot @${me.username} terhubung${owners.size ? ` (pemilik: ${[...owners].join(", ")})` : " -- MODE PAIRING: kirim pesan apa saja ke bot untuk melihat id chat-mu, lalu isi TELEGRAM_OWNER_IDS di .env"}.`);
        connected = true;
        break;
      } catch (e) {
        const fatal = e?.status === 401 || e?.status === 404;
        if (fatal || attempt === MAX_CONNECT_TRIES) {
          log.error?.(`✈️ [Telegram] gagal terhubung: ${describeError(e)}. Telegram tidak aktif sampai bot di-restart.`);
          running = false;
          return false;
        }
        const wait = Math.min(2000 * 2 ** (attempt - 1), 30_000);
        log.warn?.(`✈️ [Telegram] belum bisa terhubung (${describeError(e)}); percobaan ${attempt}/${MAX_CONNECT_TRIES}, ulangi ${Math.round(wait / 1000)} detik lagi.`);
        await sleep(wait);
      }
    }
    if (!connected) {
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
          { command: "arsip", description: "Arsip PDF grup WhatsApp di laptop (ringkasan, daftar, cari, hapus)" },
          { command: "ingatkan", description: "Pengingat pribadi: /ingatkan besok 09:00 kirim SPJ; /pengingat" },
          { command: "ibadah", description: "Pengingat ibadah: juz harian, hadits, ayat (/ibadah mulai juz 2)" },
          { command: "edu", description: "Channel YouTube edukasi: draf video, setujui, jadwal tayang" },
          { command: "kesehatan", description: "Periksa kesehatan bot: Ollama, disk, memori, WhatsApp, cadangan" },
          { command: "voice", description: "Balasan grup WhatsApp: suara (on) atau teks (off)" },
          { command: "grup", description: "Grup WhatsApp yang dijawab bot: lihat, tambah, hapus" },
          { command: "humor", description: "Mode humor grup WA: pantun, roasting ringan, balas chat acak, chat otomatis" },
          { command: "gambar", description: "Buat gambar dari deskripsi (Gemini); /gambar grup on|off" },
          { command: "video", description: "Buat video bernarasi dari deskripsi (gratis); /video grup on|off" },
          { command: "stopmotion", description: "Foto-foto berurutan jadi video stop motion" },
          { command: "musik", description: "Musik latar video: daftar lagu & cara minta" },
          { command: "wa2", description: "Nomor WhatsApp kedua: status dan kode tautan" },
          { command: "kas", description: "Laporan kas bulanan (Saldo Rekening & Register Kas)" },
          { command: "nodin", description: "Konsep Nota Dinas LPJ Bendahara (PDF + Word)" },
          { command: "urutan", description: "Urutan AI untuk balasan WhatsApp & grup (santai/akurat)" },
          { command: "cadangan", description: "Status cadangan otomatis; /cadangan sekarang" },
          { command: "pasar", description: "IHSG, harga emas dunia, dan kurs USD/IDR sekarang" },
          { command: "lokal", description: "Ngobrol dengan Ollama lokal (privat, memakai catatan pribadi)" },
          { command: "skill", description: "Jalankan skill buatanmu (file .md), dijawab Ollama lokal" },
          { command: "penyedia", description: "Status penyedia AI: Gemini, Groq, OpenRouter, Ollama" },
          { command: "ingat", description: "Simpan catatan pribadi (hanya Ollama lokal); /catatan, /lupa" },
          { command: "sistem", description: "Kondisi laptop bot; /ops untuk restart, deploy, log" },
          { command: "baru", description: "Mulai obrolan baru" },
          { command: "speak", description: "Ngobrol dengan tutor suara: Inggris, atau \"/speak id\" Indonesia" },
          { command: "selesai", description: "Akhiri sesi Speaking" },
          { command: "suara", description: "Balasan suara + pilih suara tiap bot (daftar/coba/pakai)" },
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

  return { enabled, mirror: config.mirror, start, stop, send, sendOwner, sendOwnerFiles, handleOwnerText, handleOwnerVoice, handleUpdate, describe, hasOwners: () => owners.size > 0 };
}
