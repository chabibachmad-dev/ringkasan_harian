// Bagian "ngobrol" dari mode humor grup: (1) BALAS -- bot sesekali nimbrung membalas chat orang (di-reply) setelah membaca 15 chat sebelumnya;
// (2) SAPA -- bot mengobrol sendiri di grup minimal N kali sehari (bawaan 10), jam menyebar sepanjang hari.
// Bagian murni (konfigurasi, prompt, penyaring, daftar cadangan) ada di sini; logika berstatus ada di createHumor (humor.js).
// Tidak ada pembatasan jam secara bawaan (24 jam); bisa dibatasi lewat WA_BALAS_WINDOW / WA_SAPA_WINDOW.

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
    balasMaxPerDay: Math.floor(num(env.WA_BALAS_MAX_PER_DAY, 40, 0, 500)), // 0 = tidak pernah membalas
    balasWindow: windowOrDefault(env.WA_BALAS_WINDOW, ALL_DAY),
    sapaPerDay: Math.floor(num(env.WA_SAPA_PER_DAY, 10, 10, 48)), // minimal 10
    sapaMinGapMs: Math.floor(num(env.WA_SAPA_MIN_GAP_MIN, 10, 1, 24 * 60)) * 60_000,
    sapaWindow: windowOrDefault(env.WA_SAPA_WINDOW, ALL_DAY)
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
  let t = String(raw ?? "").replace(/```[a-z]*/gi, "").trim();
  t = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" ");
  t = t.replace(/^(?:ayyubi|bot|balasan|jawaban|saya|aku)\s*:\s*/i, "").replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  return t;
}

/** Balasan valid = pendek, nyambung, tanpa tautan/mention, tanpa kata terlarang. SKIP = AI memilih diam. -> { ok, text?, reason? } */
export function validateChat(raw, { maxLen = 260, recent = [] } = {}) {
  const t = cleanChat(raw);
  if (!t) return { ok: false, reason: "kosong" };
  if (/^skip\b/i.test(t)) return { ok: false, reason: "AI memilih SKIP" };
  if (t.length < 4 || t.length > maxLen) return { ok: false, reason: "panjang tidak wajar" };
  if (/https?:|www\.|@\d|@\w|#\w/.test(t)) return { ok: false, reason: "memuat tautan/mention/tagar" };
  if ((t.match(/[.!?]+(?:\s|$)/g) || []).length > 4) return { ok: false, reason: "terlalu panjang (lebih dari empat kalimat)" };
  if (hasBannedWord(t)) return { ok: false, reason: "memuat kata terlarang" };
  if (/\b(?:sebagai (?:ai|model|asisten)|saya adalah (?:ai|model)|large language model|chatgpt|gemini|claude|openai)\b/i.test(t)) return { ok: false, reason: "membocorkan identitas model" };
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (recent.some((r) => norm(r) === norm(t))) return { ok: false, reason: "sama dengan yang baru dikirim" };
  return { ok: true, text: t };
}

const PERSONA = `Kamu Ayyubi, bot yang ikut nimbrung di grup WhatsApp seperti anggota grup yang ramah, santai, dan jenaka. Bahasa Indonesia sehari-hari yang mengikuti gaya grup (boleh singkatan umum), bukan bahasa baku kaku.`;

const SAFETY = `ATURAN KERAS: tanpa SARA, politik, ejekan fisik, keluarga, pasangan, uang/gaji, kesehatan; tanpa kata kasar; jangan menyudutkan atau menggurui siapa pun; jangan mengarang fakta, angka, atau aturan; jangan mengaku punya pengalaman fisik (makan, tidur, bepergian) atau tubuh; jangan menyebut dirimu AI/model/nama produk kecuali ditanya; jangan memakai tautan, mention (@), atau tagar.`;

export function buildReplyPrompt({ target, context = [], botName = "Ayyubi" }) {
  const system = `${PERSONA}
Tugas: baca obrolan sebelumnya, lalu balas SATU pesan terakhir dengan nyambung ke konteksnya, seperti teman yang kebetulan lewat dan ikut menimpali.
${SAFETY}
Gaya balasan: 1-2 kalimat pendek (maksimal 35 kata), boleh satu emoji, boleh bercanda ringan atau menimpali/bertanya balik. Untuk pertanyaan teknis/hukum/keuangan yang butuh jawaban pasti dan kamu tidak yakin, jangan menebak: balas singkat dan ajak "panggil namaku ya kalau mau jawaban lengkap".
Jawab persis SKIP bila: obrolan serius/sedih/resmi/pertengkaran, bahasan agama atau politik, pesan itu ditujukan khusus ke orang lain, atau kamu tidak punya tambahan yang wajar. Keluarkan HANYA teks balasan (atau SKIP), tanpa tanda kutip dan tanpa penjelasan.`;
  const lines = context.map((m) => `${m.isBot ? `${botName} (kamu)` : m.name || "?"}: ${String(m.text).slice(0, 220)}`).join("\n");
  const user = `${context.length ? `Obrolan sebelumnya (${context.length} chat terakhir):\n${lines}\n\n` : ""}Pesan yang dibalas -- ${target.name || "seseorang"}: ${String(target.text).slice(0, 300)}`;
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
  { id: "lanjut", prompt: "melanjutkan atau menimpali topik yang terakhir dibahas anggota grup (lihat obrolan terakhir); bila tidak ada topik yang pas, jawab persis SKIP", needsContext: true }
];

export function pickSapaKind(random = Math.random, { hasContext = false, avoid = [] } = {}) {
  const pool = SAPA_KINDS.filter((k) => (!k.needsContext || hasContext) && !avoid.includes(k.id));
  const list = pool.length ? pool : SAPA_KINDS.filter((k) => !k.needsContext);
  return list[Math.floor(random() * list.length)];
}

export function buildSapaPrompt({ kind, weekday, part, context = [], avoid = [], botName = "Ayyubi" }) {
  const system = `${PERSONA}
Tugas: kamu memulai obrolan sendiri di grup (tidak ada yang bertanya padamu). Tulis SATU pesan pembuka yang natural, ${kind.prompt}.
${SAFETY}
Panjang 1-3 kalimat pendek (maksimal 45 kata), boleh satu-dua emoji, jangan terdengar seperti iklan atau pengumuman, jangan memakai "Selamat pagi semuanya" berulang-ulang. Keluarkan HANYA teks pesannya, tanpa tanda kutip dan tanpa penjelasan.`;
  const lines = context.map((m) => `${m.isBot ? `${botName} (kamu)` : m.name || "?"}: ${String(m.text).slice(0, 200)}`).join("\n");
  const user = `Hari ${weekday}, waktu ${part}.${context.length ? `\n\nObrolan terakhir di grup:\n${lines}` : ""}${avoid.length ? `\n\nJangan mirip dengan pesanmu sebelumnya:\n${avoid.slice(0, 5).map((x) => `- ${String(x).slice(0, 120)}`).join("\n")}` : ""}`;
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
  "Lagi ada yang butuh teman ngobrol? Aku siap dengerin receh-receh kalian 😄",
  "Satu kata untuk menggambarkan harimu sejauh ini? Aku mulai: \"lancar\" 😌"
];

export function pickFallbackSapa(avoid = [], random = Math.random) {
  const fresh = FALLBACK_SAPA.filter((p) => !avoid.includes(p));
  const pool = fresh.length ? fresh : FALLBACK_SAPA;
  return pool[Math.floor(random() * pool.length)];
}
