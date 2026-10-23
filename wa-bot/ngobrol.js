// Bagian "ngobrol" dari mode humor grup: (1) BALAS -- bot sesekali nimbrung membalas chat orang (di-reply) setelah membaca 15 chat sebelumnya;
// (2) SAPA -- bot mengobrol sendiri di grup minimal N kali sehari (bawaan 10), jam menyebar sepanjang hari.
// Bagian murni (konfigurasi, prompt, penyaring, daftar cadangan) ada di sini; logika berstatus ada di createHumor (humor.js).
// Jam tidur (bawaan 22:30-05:00, WA_JAM_TIDUR): bot TIDAK membuka obrolan sendiri; membalas hanya bila obrolan sedang ramai dan dengan peluang kecil.
// Chat otomatis (sapa) bawaannya hanya 06:00-21:30; bisa diubah lewat WA_BALAS_WINDOW / WA_SAPA_WINDOW.

import { NO_OFFER_NOTE, stripHelpOffers } from "./insani.js";

import { hasBannedWord } from "./humor.js";

const ALL_DAY = { from: 0, to: 24 * 60 - 1 };

function windowOrDefault(text, fallback) {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(text ?? ""));
  if (!m) return fallback;
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59 || to - from < 30) return fallback;
  return { from, to };
}

const DEFAULT_TIDUR = { from: 22 * 60 + 30, to: 5 * 60 };

/** "22:30-05:00" (boleh melewati tengah malam) -> { from, to }; "off"/"mati" -> null (tanpa jam tidur); selain itu bawaan. */
export function parseNightWindow(text, fallback = DEFAULT_TIDUR) {
  const t = String(text ?? "").trim();
  if (!t) return fallback;
  if (/^(off|mati|tidak|tanpa|0|none)$/i.test(t)) return null;
  const m = /^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/.exec(t);
  if (!m || Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59) return fallback;
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  if (from === to) return fallback;
  return { from, to };
}

/** Apakah menit-ke-N dalam sehari (0-1439) termasuk jam tidur? Mendukung rentang yang melewati tengah malam. */
export function inNightWindow(minutes, night) {
  if (!night) return false;
  return night.from < night.to ? minutes >= night.from && minutes < night.to : minutes >= night.from || minutes < night.to;
}

export function readNgobrolConfig(env = process.env) {
  const num = (v, d, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    contextSize: Math.floor(num(env.WA_BALAS_CONTEXT, 15, 5, 30)), // jumlah chat sebelumnya yang dibaca sebelum membalas
    contextMaxAgeMs: Math.floor(num(env.WA_BALAS_CONTEXT_MAX_HOURS, 12, 1, 72)) * 3_600_000, // chat yang lebih tua dari ini tidak dianggap konteks
    balasChance: num(env.WA_BALAS_CHANCE, 0.2, 0, 1), // peluang tiap pesan orang dibalas
    balasGapMs: Math.floor(num(env.WA_BALAS_GAP_MIN, 3, 1, 24 * 60)) * 60_000, // jarak minimal sejak bot terakhir bicara di grup itu
    balasMaxPerDay: Math.floor(num(env.WA_BALAS_MAX_PER_DAY, 0, 0, 5000)), // 0 = TANPA batas harian (diatur peluang, jeda, energi & kelelahan); isi angka bila ingin dibatasi
    balasWindow: windowOrDefault(env.WA_BALAS_WINDOW, ALL_DAY),
    sapaPerDay: Math.floor(num(env.WA_SAPA_PER_DAY, 10, 10, 48)), // minimal 10
    sapaMinGapMs: Math.floor(num(env.WA_SAPA_MIN_GAP_MIN, 10, 1, 24 * 60)) * 60_000,
    sapaWindow: windowOrDefault(env.WA_SAPA_WINDOW, { from: 6 * 60, to: 21 * 60 + 30 }),
    tidurWindow: parseNightWindow(env.WA_JAM_TIDUR), // null = tanpa jam tidur
    tidurBalasFactor: num(env.WA_TIDUR_BALAS_FACTOR, 0.2, 0, 1), // jam tidur: peluang membalas dikali ini (dan hanya bila obrolan sedang ramai)
    reaksiChance: num(env.WA_REAKSI_CHANCE, 0.3, 0, 1), // peluang pesan bernuansa (lucu/kabar baik/terima kasih) diberi reaksi emoji
    reaksiGapMs: Math.floor(num(env.WA_REAKSI_GAP_SEC, 45, 5, 3600)) * 1000,
    reaksiMaxPerDay: Math.floor(num(env.WA_REAKSI_MAX_PER_DAY, 0, 0, 5000)), // 0 = tanpa batas harian
    energi: !/^(0|false|off|mati|tidak)$/i.test(String(env.WA_ENERGI_HARIAN ?? "on").trim()), // suasana hati harian + ritme jam + kelelahan
    naturalize: !/^(0|false|off|mati|tidak)$/i.test(String(env.WA_GAYA_ALAMI ?? "on").trim()), // balasan dirapikan mengikuti gaya tulis grup
    tanyaOn: !/^(0|false|off|mati|tidak)$/i.test(String(env.WA_TANYA_TANPA_MENTION ?? "on").trim()), // pertanyaan di grup dijawab walau bot tidak di-mention
    tanyaChance: num(env.WA_TANYA_CHANCE, 0.85, 0, 1), // peluang menjawab pertanyaan yang tidak ditujukan ke orang tertentu
    tanyaGapMs: Math.floor(num(env.WA_TANYA_GAP_SEC, 15, 3, 600)) * 1000, // jeda minimal sejak bot terakhir bicara (lebih pendek dari balasan acak)
    typoChance: num(env.WA_TYPO_CHANCE, 0.03, 0, 0.2), // salah ketik kecil lalu dikoreksi (0 = tidak pernah)
    followUpChance: num(env.WA_LANJUT_CHANCE, 0.55, 0, 0.9), // peluang menyahut orang yang BARU dibalas bot dan menulis lagi
    followUpMs: Math.floor(num(env.WA_LANJUT_MENIT, 4, 1, 30)) * 60_000,
    followUpMax: Math.floor(num(env.WA_LANJUT_MAKS, 2, 0, 6)), // maksimal sahutan beruntun ke orang yang sama (0 = tanpa lanjutan)
    ingatHari: Math.floor(num(env.WA_INGAT_HARI, 60, 1, 365)), // hal ringan yang diceritakan sendiri dilupakan setelah sekian hari tanpa disebut lagi
    hariKhusus: String(env.WA_HARI_KHUSUS || ""), // "MM-DD=Teks;MM-DD=Teks" hari khusus tambahan (mis. hari raya setempat)
    reviewTtlMs: 45 * 60_000 // draf mode latihan kedaluwarsa setelah ini
  };
}

// ---------------------------------------------------------------- penolakan "jangan balas chatku"
const SELF = "(?:aku|saya|gue|gw|gua|ane|sy)";
const NO_REPLY_RES = [
  new RegExp(`\\b(?:bot|ayyubi)\\b[^.!?\\n]{0,20}?\\b(?:jangan|gak usah|ga usah|nggak usah|enggak usah|tidak usah)\\b[^.!?\\n]{0,12}?\\b(?:balas|bales|nimbrung|nyamber|nyahut|ikut campur|ikut nimbrung)\\w*\\b[^.!?\\n]{0,20}?(?:chat|pesan|omongan)?\\w*\\s*(?:ku|${SELF})\\b`, "i"),
  new RegExp(`\\b(?:bot|ayyubi)\\b[^.!?\\n]{0,20}?\\b(?:jangan|gak usah|ga usah|nggak usah)\\b[^.!?\\n]{0,12}?\\b(?:balas|bales|nimbrung|nyamber|nyahut)\\w*\\s+(?:chat|pesan)\\w*\\s*(?:ku|${SELF})\\b`, "i")
];
const REPLY_OK_RE = new RegExp(`\\b(?:bot|ayyubi)\\b[^.!?\\n]{0,20}?\\b(?:boleh|silakan|silahkan|monggo)\\b[^.!?\\n]{0,12}?\\b(?:balas|bales|nimbrung|nyamber|nyahut)\\w*\\b[^.!?\\n]{0,20}?(?:chat|pesan)?\\w*\\s*(?:ku|${SELF})?\\s*(?:lagi)\\b`, "i");

/** "bot jangan balas chatku" -> "out"; "bot boleh balas chatku lagi" -> "in"; selain itu null. */
export function detectReplyPref(text) {
  const t = String(text ?? "");
  if (t.length > 160) return null;
  if (REPLY_OK_RE.test(t)) return "in";
  if (NO_REPLY_RES.some((re) => re.test(t))) return "out";
  return null;
}

// ---------------------------------------------------------------- pertanyaan di grup (dijawab walau bot tidak di-mention)
const Q_START = /^(?:apa|apakah|siapa|siapakah|kapan|dimana|di mana|kemana|ke mana|darimana|dari mana|kenapa|knp|mengapa|bagaimana|gimana|gmn|berapa|brp|mana|kok|emang|emangnya|bisa|boleh|ada|adakah|masa|yang mana|tau|tahu|ngerti|kira-kira|kira2)\b/i;
const DIRECTED_START = /^(?:kamu|km|kau|lu|lo|loe|elu|anda|dirimu|dek|mas|mbak|mba|kak|kakak|bang|abang|pak|bu|ibu|bapak|om|tante|bro|sis)\b/i;
const GRAVE_RE = /\b(?:innalillahi|inalillahi|meninggal|wafat|duka|berduka|belasungkawa|almarhum\w*|sakit|opname|operasi|kecelakaan|musibah|bencana|kehilangan|sedih|menangis|nangis|stres|depresi|marah|kesal|kecewa|komplain|protes|cerai|phk|dipecat|pecat|polisi|hamil|gaji|utang|hutang|pinjol)\b/i;

/** Pertanyaan yang pantas dijawab bot walau tidak di-mention: berupa pertanyaan (tanda tanya / kata tanya di awal), cukup panjang, tidak ditujukan ke satu orang. */
export function isGroupQuestion(text) {
  const t = String(text ?? "").replace(/@\d{5,}/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 10 || t.length > 320) return false;
  if ((t.match(/\p{L}/gu) || []).length < 7) return false;
  if (/https?:\/\/|www\./i.test(t)) return false;
  if (/^[/!.#]\w/.test(t)) return false;
  const asks = /\?\s*(?:[\p{Extended_Pictographic}\s]*)$/u.test(t) || (Q_START.test(t) && t.length >= 14);
  if (!asks) return false;
  if (/^(?:w[kw]{2,}|(?:ha){2,}|(?:he){2,}|lol\b|xi(?:xi)+)/i.test(t)) return false; // diawali tawa = biasanya retoris
  if (DIRECTED_START.test(t)) return false; // "kamu udah makan?" / "mas, ..." : biasanya untuk satu orang
  return true;
}

/** Topik berat (duka, sakit, konflik, uang/gaji/utang, hamil): pertanyaan tentang ini TIDAK dijawab otomatis. */
export const isGraveTopic = (text) => GRAVE_RE.test(String(text ?? ""));

// ---------------------------------------------------------------- kelayakan target balasan
/** Pesan yang tidak pantas dibalas acak: terlalu pendek, hanya tautan, menyebut orang lain (@), atau perintah ke bot lain. */
export function isReplyWorthy(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 6) return false;
  if (t.length > 400) return false; // pesan panjang = pengumuman/curhat; jangan disambar
  if (/^[\p{P}\p{S}\s]+$/u.test(t)) return false;
  if (/https?:\/\/|www\./i.test(t) && t.replace(/https?:\/\/\S+|www\.\S+/gi, "").trim().length < 12) return false;
  if (/@\d{5,}/.test(t)) return false;
  if (/^[/!.#]\w/.test(t)) return false; // perintah bot lain
  if (/^(?:(?:wk)+w?k*|(?:ha)+h?|(?:he)+h?|(?:hi)+h?|k{3,}|lo+l|lmao|xi+xi+\w*|ok+e*|sip+|siap|mantap|makasih|thanks?|terima kasih)[\s!.,]*$/i.test(t)) return false; // tawa/ucapan sepatah
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters < 4) return false;
  return true;
}

// ---------------------------------------------------------------- prompt & penyaring: BALAS
export function cleanChat(raw) {
  let t = stripHelpOffers(String(raw ?? "").replace(/```[a-z]*/gi, "").trim(), { fallback: "" });
  t = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2).join("\n"); // dua baris = dua gelembung pesan
  t = t.replace(/^(?:ayyubi|bot|balasan|jawaban|saya|aku)\s*:\s*/i, "").replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  return t;
}

/** Balasan valid = pendek, nyambung, tanpa tautan/mention, tanpa kata terlarang. SKIP = AI memilih diam. -> { ok, text?, reason? } */
export function validateChat(raw, { maxLen = 260, recent = [] } = {}) {
  const multi = cleanChat(raw);
  const t = multi.replace(/\n+/g, " ");
  if (!t) return { ok: false, reason: "kosong" };
  if (/^skip\b/i.test(t)) return { ok: false, reason: "AI memilih SKIP" };
  if (t.length < 4 || t.length > maxLen) return { ok: false, reason: "panjang tidak wajar" };
  if (/https?:|www\.|@\d|@\w|#\w/.test(t)) return { ok: false, reason: "memuat tautan/mention/tagar" };
  if ((t.match(/[.!?]+(?:\s|$)/g) || []).length > 4) return { ok: false, reason: "terlalu panjang (lebih dari empat kalimat)" };
  if (hasBannedWord(t)) return { ok: false, reason: "memuat kata terlarang" };
  if (/\b(?:sebagai (?:ai|model|asisten)|saya adalah (?:ai|model)|large language model|chatgpt|gemini|claude|openai)\b/i.test(t)) return { ok: false, reason: "membocorkan identitas model" };
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (recent.some((r) => norm(r) === norm(t) || norm(r) === norm(multi))) return { ok: false, reason: "sama dengan yang baru dikirim" };
  return { ok: true, text: multi };
}

export const PERSONA_BASE = `Kamu Ayyubi, bot yang ikut nimbrung di grup WhatsApp seperti anggota grup yang ramah, peka, santai, dan jenaka. Bahasa Indonesia sehari-hari yang mengikuti gaya grup (boleh singkatan umum), bukan bahasa baku kaku. Kamu bot yang tahu dirimu bot: bila ada yang bertanya "kamu bot ya?", akui dengan santai (mis. "iya, aku Ayyubi, bot grup ini 😄") tanpa canggung, dan jangan pernah berpura-pura manusia.`;
const personaExtra = () => (process.env.WA_PERSONA_NOTE ? `\nCiri tambahan dari pemilik: ${String(process.env.WA_PERSONA_NOTE).slice(0, 400)}` : "");
const persona = () => `${PERSONA_BASE}${personaExtra()}`;

const SAFETY = `${NO_OFFER_NOTE}
ATURAN KERAS: tanpa SARA, politik, ejekan fisik, keluarga, pasangan, uang/gaji, kesehatan; tanpa kata kasar; jangan menyudutkan atau menggurui siapa pun; jangan mengarang fakta, angka, atau aturan; jangan mengaku punya pengalaman fisik (makan, tidur, bepergian) atau tubuh; jangan menyebut dirimu AI/model/nama produk kecuali ditanya; jangan memakai tautan, mention (@), atau tagar.`;

export function buildReplyPrompt({ target, context = [], botName = "Ayyubi", styleNote = "", memberNote = "", fewShot = "", moodHint = "", allowReaction = true, stickerTags = [], question = false, after = [] }) {
  const system = `${persona()}
Tugas: baca obrolan sebelumnya, lalu balas SATU pesan terakhir dengan nyambung ke konteksnya, seperti teman yang kebetulan lewat dan ikut menimpali.
${SAFETY}
${question ? `PESAN TERAKHIR ADALAH PERTANYAAN di grup (tidak memanggilmu, tapi kamu anggota yang tahu). Jawab langsung pertanyaannya sesuai konteks obrolan sebelumnya, padat dan akurat, 1-3 kalimat (maksimal 60 kata), tanpa basa-basi pembuka, tanpa tautan, dan tanpa menawarkan bantuan. Jangan mengarang fakta, angka, atau aturan: bila tidak yakin, jawab persis SKIP. Jawab SKIP juga bila pertanyaan itu jelas ditujukan ke orang tertentu, sudah dijawab orang lain di chat sesudahnya, butuh data pribadi seseorang, atau topiknya duka/sakit/uang/politik/agama.` : "Gaya balasan: 1-2 kalimat pendek (maksimal 35 kata), boleh satu emoji, boleh bercanda ringan atau menimpali/bertanya balik."} Kalau perlu dua gelembung pesan (mis. menimpali lalu bertanya), tulis di dua baris terpisah. Untuk pertanyaan teknis/hukum/keuangan yang butuh jawaban pasti dan kamu tidak yakin, jangan menebak dan jangan mengajak bertanya: cukup balas singkat seadanya, atau SKIP.
${allowReaction ? "Bila cukup memberi reaksi saja (pesan lucu, kabar baik, ucapan terima kasih), jawab persis: REAKSI: <satu emoji dari 👍 😂 🙏 🎉 👏 💪 ❤️ 😮 🔥>.\n" : ""}${stickerTags.length ? `Kamu punya koleksi stiker. Sesekali (jangan tiap balasan) boleh membalas dengan stiker saja bila lebih pas daripada kata-kata (lucu, kabar baik, terima kasih, setuju): tulis satu baris persis STIKER: <label>, label dari: ${stickerTags.join(", ")}. Boleh juga satu kalimat pendek lalu baris STIKER: di bawahnya.\n` : ""}Jawab persis SKIP bila: obrolan serius/sedih/resmi/pertengkaran, bahasan agama atau politik, pesan itu ditujukan khusus ke orang lain, atau kamu tidak punya tambahan yang wajar. Keluarkan HANYA teks balasan (atau REAKSI/SKIP), tanpa tanda kutip dan tanpa penjelasan.${styleNote ? `\n${styleNote}` : ""}${fewShot ? `\n${fewShot}` : ""}`;
  const lines = context.map((m) => `${m.isBot ? `${botName} (kamu)` : m.name || "?"}: ${String(m.text).slice(0, 220)}`).join("\n");
  const user = `${context.length ? `Obrolan sebelumnya (${context.length} chat terakhir):\n${lines}\n\n` : ""}${after.length ? `Chat sesudah pertanyaan itu (bila sudah ada yang menjawab, jawab SKIP):\n${after.map((m) => `${m.name || "?"}: ${String(m.text).slice(0, 160)}`).join("\n")}\n\n` : ""}Pesan yang dibalas -- ${target.name || "seseorang"}: ${String(target.text).slice(0, 300)}${target.quoted ? `\n(pesan itu sendiri membalas/mengutip: "${String(target.quoted).replace(/\s+/g, " ").slice(0, 160)}")` : ""}${moodHint ? `\n\nCatatan suasana: ${moodHint}` : ""}${memberNote ? `\n\n${memberNote}` : ""}`;
  return { system, user };
}

// ---------------------------------------------------------------- prompt & cadangan: SAPA
export const SAPA_KINDS = [
  { id: "sapa", prompt: "sapaan hangat sesuai waktu dan hari ini, selipkan satu candaan ringan" },
  { id: "tanya", prompt: "satu pertanyaan ringan pemancing obrolan yang mudah dijawab siapa saja (mis. pilih A atau B, kebiasaan sehari-hari, makanan, hobi, film, musik)" },
  { id: "fakta", prompt: "satu fakta unik/receh yang benar dan umum diketahui (sains, alam, sejarah ringan), lalu ajak anggota berkomentar" },
  { id: "receh", prompt: "satu lelucon receh atau permainan kata yang lucu ringan" },
  { id: "semangat", prompt: "satu kalimat penyemangat ringan sesuai hari/waktu, tidak menggurui" },
  { id: "tip", prompt: "satu tips kecil sehari-hari yang aman (produktivitas, merapikan kerja, kebiasaan baik) dalam satu-dua kalimat" },
  { id: "lanjut", prompt: "melanjutkan atau menimpali topik yang terakhir dibahas anggota grup (lihat obrolan terakhir); bila tidak ada topik yang pas, jawab persis SKIP", needsContext: true },
  { id: "momen", prompt: "menyinggung momen hari ini (lihat 'Momen hari ini') dengan hangat dan tidak menggurui, lalu ajak anggota menanggapi", needsOccasion: true },
  { id: "ingat", prompt: "menyapa satu anggota dengan ramah dengan merujuk hal ringan yang IA SENDIRI minta kamu ingat (lihat 'Yang kamu ingat'), seperti teman yang perhatian; jangan terdengar mengawasi", needsMember: true }
];

export function pickSapaKind(random = Math.random, { hasContext = false, hasOccasion = false, hasMember = false, avoid = [], weights = null } = {}) {
  const ok = (k) => (!k.needsContext || hasContext) && (!k.needsOccasion || hasOccasion) && (!k.needsMember || hasMember);
  const pool = SAPA_KINDS.filter((k) => ok(k) && !avoid.includes(k.id));
  const list = pool.length ? pool : SAPA_KINDS.filter((k) => !k.needsContext && !k.needsOccasion && !k.needsMember);
  // momen hari ini & ingatan anggota dibuat lebih sering terpilih saat tersedia (mereka yang paling terasa "manusiawi")
  const w = (k) => (weights?.[k.id] ?? 0.5) * (k.needsOccasion ? 3 : k.needsMember ? 2 : 1);
  const total = list.reduce((a, k) => a + w(k), 0);
  let r = random() * total;
  for (const k of list) {
    r -= w(k);
    if (r < 0) return k;
  }
  return list[list.length - 1];
}

export function buildSapaPrompt({ kind, weekday, part, context = [], avoid = [], botName = "Ayyubi", occasions = [], memberNote = "", styleNote = "", fewShot = "" }) {
  const system = `${persona()}
Tugas: kamu memulai obrolan sendiri di grup (tidak ada yang bertanya padamu). Tulis SATU pesan pembuka yang natural, ${kind.prompt}.
${SAFETY}
Panjang 1-3 kalimat pendek (maksimal 45 kata), boleh satu-dua emoji, jangan terdengar seperti iklan atau pengumuman, jangan memakai "Selamat pagi semuanya" berulang-ulang. Boleh dua baris bila ingin dua gelembung pesan. Keluarkan HANYA teks pesannya (atau SKIP bila diminta), tanpa tanda kutip dan tanpa penjelasan.${styleNote ? `\n${styleNote}` : ""}${fewShot ? `\n${fewShot}` : ""}`;
  const lines = context.map((m) => `${m.isBot ? `${botName} (kamu)` : m.name || "?"}: ${String(m.text).slice(0, 200)}`).join("\n");
  const user = `Hari ${weekday}, waktu ${part}.${occasions.length ? `\nMomen hari ini: ${occasions.join("; ")}.` : ""}${memberNote ? `\n${memberNote}` : ""}${context.length ? `\n\nObrolan terakhir di grup:\n${lines}` : ""}${avoid.length ? `\n\nJangan mirip dengan pesanmu sebelumnya:\n${avoid.slice(0, 5).map((x) => `- ${String(x).slice(0, 120)}`).join("\n")}` : ""}`;
  return { system, user };
}

/** Cadangan bila AI tidak tersedia/gagal. Aman untuk semua grup; bukan klaim fakta yang bisa salah. */
export const FALLBACK_SAPA = [
  "Mau tanya yang ringan: tim nasi uduk atau tim lontong sayur kalau sarapan? 😄",
  "Kalau cuma boleh pilih satu untuk sisa hari ini: kopi atau teh? ☕🍵",
  "Pertanyaan iseng: lagu apa yang paling sering kalian putar akhir-akhir ini? 🎧",
  "Hayo, siapa yang hari ini sudah minum air putih cukup? Angkat tangan 🙌",
  "Kalau besok libur dadakan, kalian pilih rebahan seharian atau jalan-jalan? 😎",
  "Fakta receh: kalau kita bilang \"sebentar lagi\", rata-rata artinya antara 5 menit sampai 2 jam 😅",
  "Lagi gabut nih. Ada rekomendasi film atau serial yang seru ditonton akhir pekan? 🍿",
  "Tebak-tebakan receh: kenapa kalender suka sedih? Karena harinya selalu dicoret-coret 😂",
  "Makanan favorit apa yang nggak pernah bikin bosan walau dimakan tiap minggu? 🍛",
  "Ingat, kerjaan boleh banyak tapi jangan lupa selingi napas dan tarik bahu sebentar ya 🙂",
  "Pilih salah satu: hujan-hujan makan mie rebus atau panas-panas minum es teh? 🍜🧊",
  "Siapa di sini yang jadwalnya hari ini penuh? Semangat ya, pelan-pelan juga tetap jalan 💪",
  "Kalau ada satu keahlian yang bisa langsung kalian kuasai besok pagi, kalian pilih apa? ✨",
  "Hal kecil apa yang bikin mood kalian naik hari ini? Boleh yang receh banget 😄",
  "Kuis santai: lebih enak bubur diaduk atau tidak diaduk? Silakan berdebat dengan damai 🥣",
  "Ada yang punya kebiasaan unik sebelum mulai kerja? Aku penasaran 🤭",
  "Pengingat ramah dari Ayyubi: cek lagi botol minummu, mungkin sudah waktunya diisi 💧",
  "Kalau grup ini punya lagu tema, kira-kira lagunya apa ya? 🎶",
  "Kopi dulu atau sarapan dulu? Ini penting untuk perdamaian dunia ☕",
  "Siapa yang lagi nungguin jam pulang? Aku temani dengan semangat virtual 🕒",
  "Hari ini ada kabar baik, sekecil apa pun? Bagi dong biar grupnya ikut senang 🌟",
  "Tantangan santai: sebut satu makanan khas daerahmu yang wajib dicoba orang lain 🍲",
  "Lagi santai nih. Cerita receh apa yang paling bikin kalian ketawa minggu ini? 😄",
  "Satu kata untuk menggambarkan harimu sejauh ini? Aku mulai: \"lancar\" 😌"
];

export function pickFallbackSapa(avoid = [], random = Math.random) {
  const fresh = FALLBACK_SAPA.filter((p) => !avoid.includes(p));
  const pool = fresh.length ? fresh : FALLBACK_SAPA;
  return pool[Math.floor(random() * pool.length)];
}
