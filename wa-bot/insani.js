// Pelatihan "makin manusiawi" tahap 2 untuk Ayyubi. Semua fungsi MURNI (tanpa jaringan/penyimpanan/waktu sistem) supaya mudah dites;
// pemakaian dan penyimpanannya ada di createHumor (humor.js).
//
//   energi    -> suasana hati harian + ritme jam + kelelahan: peluang & jeda membalas tidak datar sepanjang hari
//   naturalize-> merapikan balasan AI supaya terdengar seperti gaya tulis grup (huruf kecil, "udah/aja/gak", tanpa titik akhir,
//                tawa ikut-ikutan, emoji secukupnya, sesekali salah ketik yang langsung dikoreksi)
//   ingatan   -> mengambil hal ringan yang DIA CERITAKAN SENDIRI ("aku suka kopi hitam", "besok aku ke pantai"), tanpa hal sensitif
//   reaksi    -> memilih emoji reaksi dari isi pesan, bukan hanya dari suasana
//
// Prinsip tetap: natural, bukan menyamar. Tidak ada kalimat yang mengaku manusia atau mengarang pengalaman fisik.

import { sanitizeFact } from "./manusiawi.js";

// ---------------------------------------------------------------- bilangan acak deterministik (tanpa Math.random)
/** Teks -> angka stabil 0..1 (FNV-1a). Dipakai agar "suasana hati hari ini" sama sepanjang hari tetapi beda antar hari/grup. */
export function hash01(text) {
  let h = 2166136261;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// ---------------------------------------------------------------- energi & suasana hati
/**
 * Suasana hati bot di grup ini pada hari ini (stabil sepanjang hari).
 * -> { level: "kalem"|"biasa"|"semangat", chance, gap, delay, hint }
 */
export function dayEnergy(key, day) {
  const r = hash01(`${key}|${day}|energi`);
  if (r < 0.22) {
    return { level: "kalem", chance: 0.7, gap: 1.5, delay: 1.3, hint: "Hari ini kamu agak kalem: jawab lebih singkat dan tenang, tidak perlu heboh." };
  }
  if (r > 0.8) {
    return { level: "semangat", chance: 1.35, gap: 0.75, delay: 0.85, hint: "Hari ini kamu lagi semangat: boleh sedikit lebih ekspresif dan hangat." };
  }
  return { level: "biasa", chance: 1, gap: 1, delay: 1, hint: "" };
}

/** Ritme sepanjang hari: pagi sibuk-ringan, makan siang agak sepi, habis makan siang ngantuk, sore-malam ramai. minutes = menit sejak 00:00. */
export function hourFactor(minutes) {
  const h = minutes / 60;
  if (h < 5) return 0.6;
  if (h < 7) return 0.8;
  if (h < 11) return 1.1;
  if (h < 13) return 0.9;
  if (h < 15) return 0.8;
  if (h < 20) return 1.15;
  if (h < 22) return 1.0;
  return 0.7;
}

/** Kelelahan: makin sering bot bicara sendiri dalam setengah jam terakhir, makin kecil peluang membalas lagi. n = jumlah ucapan spontan. */
export function fatigueFactor(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  return Math.max(0.35, 0.85 ** k);
}

/** Jeda minimal antar-balasan dibuat berubah-ubah (0.8x - 1.6x) tetapi STABIL untuk satu ucapan terakhir (seed = waktu ucapan itu). */
export function jitterGap(baseMs, seed) {
  return Math.round(baseMs * (0.8 + hash01(`gap|${seed}`) * 0.8));
}

/**
 * Peluang dasar dikali: energi hari ini x ritme jam x kelelahan x keadilan (orang yang baru saja dibalas lebih jarang dibalas lagi)
 * x pesan yang ditujukan ke orang lain. Hasil dibatasi 0..0.9.
 */
export function replyChance(base, { energy = 1, hour = 1, fatigue = 1, fairness = 1, toOther = false } = {}) {
  const p = base * energy * hour * fatigue * fairness * (toOther ? 0.15 : 1);
  return Math.max(0, Math.min(0.9, p));
}

// ---------------------------------------------------------------- gaya tulis alami
const EMOJI_G = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

const FORMAL_TO_CASUAL = [
  [/\bsangat\s+(\p{L}+)/giu, "$1 banget"],
  [/\bsudah\b/gi, "udah"],
  [/\bsaja\b/gi, "aja"],
  [/\btidak\b/gi, "nggak"],
  [/\bbagaimana\b/gi, "gimana"],
  [/\bmengapa\b/gi, "kenapa"],
  [/\btetapi\b/gi, "tapi"],
  [/\bsedang\b/gi, "lagi"],
  [/\bsungguh\b/gi, "beneran"],
  [/\bapakah\s+/gi, ""],
  [/\bsilakan\b/gi, "yuk"]
];

function matchCase(from, to) {
  return from[0] === from[0].toUpperCase() && from[0] !== from[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to;
}

/** Seberapa santai gaya grup (0..1)? null bila datanya belum cukup (kurang dari 20 pesan). Memakai hitungan gaya dari manusiawi.js. */
export function informality(style) {
  if (!style || !style.n || style.n < 20) return null;
  const lower = (style.lower || 0) / style.n;
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const slang = (sum(style.particles) + sum(style.laugh)) / style.n;
  const formal = (style.formal || 0) / style.n;
  return Math.max(0, Math.min(1, lower * 0.5 + Math.min(1, slang) * 0.6 - formal));
}

const topKey = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

/**
 * Rapikan balasan AI supaya mengikuti gaya tulis grup. -> { text, fix? }  (fix = koreksi salah ketik, dikirim sebagai gelembung kedua)
 * opsi: random, typoChance (0 = tidak pernah salah ketik), keep (kata yang tidak boleh diubah huruf besarnya, mis. nama), serious (tanpa tawa/typo).
 */
export function naturalize(text, style, { random = Math.random, typoChance = 0.03, keep = [], serious = false } = {}) {
  let t = String(text ?? "").replace(/[ \t]+/g, " ").trim();
  if (!t) return { text: t };
  const inf = informality(style);
  const casual = inf !== null && inf >= 0.45;
  const n = style?.n || 0;

  // emoji: paling banyak satu; grup yang jarang pakai emoji -> sering dibuang
  const emos = t.match(EMOJI_G) || [];
  if (emos.length) {
    const emojiRate = n >= 20 ? (style.emojiTotal || 0) / n : 0.3;
    if (emos.length > 1) {
      let seen = 0;
      t = t.replace(EMOJI_G, (m) => (++seen === 1 ? m : "")).replace(/\s{2,}/g, " ").trim();
    }
    if (emojiRate < 0.05 && random() < 0.7) t = t.replace(EMOJI_G, "").replace(/\s{2,}/g, " ").trim();
  }
  t = t.replace(/!{2,}/g, "!").replace(/\?{2,}/g, "?");

  if (casual) {
    for (const [re, to] of FORMAL_TO_CASUAL) t = t.replace(re, (m, ...a) => (to === "" ? "" : to.includes("$1") ? to.replace("$1", a[0]) : matchCase(m, to)));
    // titik di akhir kalimat terakhir terasa kaku di chat (tiga titik dibiarkan)
    t = t.replace(/(?<!\.)\.(\s*)$/u, "").trim();
    // huruf kecil di awal bila grup umumnya menulis huruf kecil
    if ((style.lower || 0) / n >= 0.6) {
      const first = t.split(/\s+/)[0] || "";
      const protectedWord = keep.some((k) => String(k).toLowerCase() === first.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()) || /^[A-Z]{2,}\b/.test(first) || /^\p{Lu}\p{Ll}*\p{Lu}/u.test(first);
      if (!protectedWord && /^\p{Lu}/u.test(t)) t = t[0].toLowerCase() + t.slice(1);
    }
    // huruf memanjang di ujung ("iya" -> "iyaa") bila grup memang begitu
    const stretchRate = n ? (style.stretch || 0) / n : 0;
    if (stretchRate >= 0.05 && random() < 0.3) t = t.replace(/\b(iya|ya|oke|sip|siap|mantap)(?=[\s.!?,]*(?:\p{Extended_Pictographic}|$))/iu, (m) => `${m}${m.slice(-1)}`);
    // ikut tertawa seperti grupnya
    const laugh = topKey(style.laugh);
    if (!serious && laugh && (style.laugh[laugh] || 0) / n >= 0.08 && !/\b(?:wk|ha(?:ha)+|he(?:he)+|xi(?:xi)+|kw(?:kw)+|lol)\w*/i.test(t) && t.length < 90 && random() < 0.2 && !/[?]\s*$/.test(t)) {
      t = `${t} ${random() < 0.5 ? laugh : laugh + laugh.slice(-2)}`;
    }
  }

  // salah ketik kecil yang langsung dikoreksi ("*maksudnya") -- jarang sekali, hanya di grup santai, hanya teks wajar
  let fix;
  if (casual && !serious && typoChance > 0 && t.length >= 30 && !/https?:|\d{3,}/.test(t) && random() < typoChance) {
    const words = [...t.matchAll(/\p{L}{5,}/gu)].filter((m) => m.index > 0 && !keep.some((k) => String(k).toLowerCase() === m[0].toLowerCase()));
    if (words.length) {
      const w = words[Math.floor(random() * words.length)];
      const i = 1 + Math.floor(random() * (w[0].length - 3));
      const a = w[0];
      const typo = a.slice(0, i) + a[i + 1] + a[i] + a.slice(i + 2);
      if (typo !== a) {
        t = t.slice(0, w.index) + typo + t.slice(w.index + a.length);
        fix = `*${a}`;
      }
    }
  }
  return fix ? { text: t, fix } : { text: t };
}

// ---------------------------------------------------------------- ingatan ringan dari cerita anggota sendiri
const SUBJ = "(?:aku|saya|gue|gw|gua|sy)";
const END = "(?=[.,;!?\\n]|$)";
const clip = (s) => String(s).replace(/\s+/g, " ").replace(/\b(?:ya|dong|sih|nih|deh|lho|loh|kok|kan|aja|saja)\s*$/i, "").trim();

const FACT_RES = [
  { kind: "suka", ttlDays: 0, re: new RegExp(`\\b${SUBJ}\\s+(?:paling\\s+|sangat\\s+|banget\\s+)?(?:suka|doyan|demen|gemar|senang)\\s+(\\p{L}[\\p{L}\\p{N} ]{2,40}?)${END}`, "iu"), make: (m) => `aku suka ${clip(m[1])}` },
  { kind: "hobi", ttlDays: 0, re: new RegExp(`\\bhobi(?:ku|\\s+${SUBJ})\\s*(?:itu|adalah|yaitu|:)?\\s*(\\p{L}[\\p{L}\\p{N} ]{2,40}?)${END}`, "iu"), make: (m) => `hobiku ${clip(m[1])}` },
  { kind: "punya", ttlDays: 0, re: new RegExp(`\\b${SUBJ}\\s+punya\\s+((?:kucing|anjing|kelinci|hamster|burung|ikan)(?:\\s+\\p{L}+){0,2}?)${END}`, "iu"), make: (m) => `aku punya ${clip(m[1])}` },
  { kind: "lagi", ttlDays: 1, re: new RegExp(`\\b${SUBJ}\\s+lagi\\s+((?:di\\s+|nonton\\s+|main\\s+|baca\\s+|belajar\\s+|masak\\s+|nyetir\\s+|ngerjain\\s+|dengerin\\s+|makan\\s+|ngopi\\s+)\\p{L}[\\p{L}\\p{N} ]{1,30}?)${END}`, "iu"), make: (m) => `aku lagi ${clip(m[1])}` },
  { kind: "rencana", ttlDays: 3, re: new RegExp(`\\b${SUBJ}\\s+(besok|lusa|nanti|minggu depan|akhir pekan|weekend)\\s+(?:mau\\s+|akan\\s+)?((?:ke|pergi|liburan|nonton|main|mancing|naik|jalan|pulang|ngumpul|futsal|badminton)\\s*\\p{L}?[\\p{L}\\p{N} ]{1,30}?)${END}`, "iu"), make: (m) => `aku ${m[1].toLowerCase()} ${clip(m[2])}` },
  { kind: "rencana", ttlDays: 3, re: new RegExp(`\\b(besok|lusa|nanti|minggu depan|akhir pekan|weekend)\\s+${SUBJ}\\s+(?:mau\\s+|akan\\s+)?((?:ke|pergi|liburan|nonton|main|mancing|naik|jalan|pulang|ngumpul|futsal|badminton)\\s*\\p{L}?[\\p{L}\\p{N} ]{1,30}?)${END}`, "iu"), make: (m) => `aku ${m[1].toLowerCase()} ${clip(m[2])}` }
];

/**
 * Hal ringan yang anggota ceritakan tentang dirinya sendiri. -> [{ t, kind, ttlDays }]  (ttlDays 0 = permanen sampai dilupakan)
 * Hal sensitif (kesehatan, uang, agama, keluarga, dll), pertanyaan, dan tautan/nomor ditolak oleh sanitizeFact.
 */
export function extractSelfFacts(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 220 || /\?/.test(raw) || /https?:|www\./i.test(raw)) return [];
  const out = [];
  for (const { kind, ttlDays, re, make } of FACT_RES) {
    const m = re.exec(raw);
    if (!m) continue;
    const v = sanitizeFact(make(m));
    if (!v.ok) continue;
    out.push({ t: v.text, kind, ttlDays });
  }
  return out;
}

/** Berapa hari sejak ts (ms)? */
export const daysSince = (ts, nowMs) => Math.floor(Math.max(0, nowMs - ts) / 86_400_000);

// ---------------------------------------------------------------- reaksi dari isi pesan
const REACTION_CUES = [
  [/\b(?:alhamdulillah|syukur|puji tuhan|terima ?kasih|makasih|mksh|thanks?|thx|tks|trims)\b/i, "🙏"],
  [/\b(?:selamat|congrats?|lulus|lolos|diterima|berhasil|menang|juara|naik pangkat|wisuda)\b/i, "🎉"],
  [/\b(?:keren|gokil|jos|mantul|luar biasa|top banget|hebat)\b/i, "🔥"],
  [/\b(?:mantap|sip|oke siap|siap|bagus|setuju|noted|siap laksanakan)\b/i, "👍"],
  [/\b(?:semangat|ayo|gas|pasti bisa|jangan nyerah|fighting)\b/i, "💪"],
  [/\b(?:wk(?:wk)+|haha+h?|hehe+|xixi+|kwkw+|ngakak|kocak|lucu banget|receh)\b/i, "😂"],
  [/\b(?:kangen|rindu|sayang kalian|love you)\b/i, "❤️"],
  [/\b(?:astaga|ya ampun|ya allah|gila sih)\b/i, "😮"]
];

/** Emoji reaksi dari isi pesan (kata kunci), atau null. Urutan = prioritas. */
export function reactionFromText(text) {
  const t = String(text ?? "");
  if (t.length < 3 || t.length > 200) return null;
  for (const [re, e] of REACTION_CUES) if (re.test(t)) return e;
  return null;
}

// ---------------------------------------------------------------- tanpa tawaran bantuan
/** Aturan untuk semua prompt balasan WhatsApp: jangan menawarkan bantuan. */
export const NO_OFFER_NOTE = `JANGAN menawarkan bantuan atau mengundang bertanya: tidak ada "Ada yang bisa dibantu?", "Ada yang bisa kubantu lagi?", "Silakan tanya kalau butuh bantuan", "Jangan ragu bertanya", "Semoga membantu", "Kabari ya kalau ada yang kurang". Orang akan bertanya sendiri bila memang ingin bertanya; jawab apa yang ditanyakan lalu berhenti, seperti teman, bukan petugas layanan.`;

const OFFER_RES = [
  /\b(?:ada|apa|masih ada|ada lagi)\s+(?:yang|yg|hal)\s+(?:lain\s+|lagi\s+)?(?:bisa|dapat|boleh|perlu|butuh|mau|ingin)\s+(?:saya\s+|aku\s+|gue\s+|kami\s+|kita\s+|ayyubi\s+)?(?:bantu|dibantu|kubantu|kubantuin|dibantuin|dibantukan|bantuan|dibantu lagi)/i,
  /\b(?:apa|ada)\s+(?:yang|yg)\s+(?:bisa|dapat|boleh)\s+(?:saya|aku|gue|kami|ayyubi)\s+(?:bantu|lakukan|kerjakan)/i,
  /\bbisa\s+(?:saya|aku|gue|ayyubi)\s+bantu\b/i,
  /\b(?:bisa|boleh)\s+(?:kubantu|kubantuin)\b/i,
  /\b(?:ada|apa)\s+(?:yang\s+)?(?:perlu|butuh|mau)\s+(?:kubantu|aku bantu|saya bantu|dibantu|bantuan)/i,
  /\b(?:mau|perlu|butuh|ingin)\s+(?:dibantu|bantuan)\s*(?:apa|lagi|lain|lebih lanjut|nih|ya|\?|$)/i,
  /\b(?:siap|senang|dengan senang hati|selalu siap)\s+(?:untuk\s+)?(?:membantu|bantu|menolong|mendengarkan|dengerin|mendengar)\b/i,
  /\b(?:jangan|gak usah|nggak usah|tidak perlu)\s+(?:ragu|sungkan|malu|segan)\b/i,
  /\b(?:silakan|silahkan|boleh|monggo)\s+(?:bertanya|tanya|tanyakan|bilang|kabari|hubungi|minta|panggil)\b[^.!?]{0,50}\b(?:lagi|kapan saja|kapan pun|bila|kalau|jika|aja|saja|ya)\b/i,
  /\b(?:kalau|jika|bila|apabila)\s+(?:masih\s+|ada\s+)?(?:ada\s+)?(?:pertanyaan|yang kurang jelas|yang belum jelas|hal lain|yang ingin ditanyakan|yang mau ditanyakan|butuh|perlu)\b[^.!?]{0,60}\b(?:tanya|tanyakan|bilang|kabari|hubungi|panggil|kasih tahu|beri tahu|bantu|bantuan|silakan|silahkan|jangan)/i,
  /\b(?:semoga|moga-moga)\s+(?:ini\s+|jawaban(?:ku| ini)?\s+)?(?:membantu|bermanfaat|menjawab|cukup jelas|jelas)\b/i,
  /\b(?:lagi\s+)?ada\s+yang\s+(?:butuh|perlu|mau)\s+(?:teman|temen)\s+(?:ngobrol|cerita|curhat)/i,
  /\bhappy to help\b|\bfeel free to (?:ask|reach)\b|\blet me know if\b|\banything else\b|\bhow can i (?:help|assist)\b/i
];
const isOffer = (s) => s.length <= 150 && OFFER_RES.some((re) => re.test(s));

function stripSegment(text) {
  const sentences = text.match(/\n+|[^.!?\n]+(?:[.!?]+|$)[ \t]*/g) || [text];
  const kept = [];
  for (const sent of sentences) {
    const core = sent.trim();
    if (!core) {
      kept.push(sent);
      continue;
    }
    // "Jawabannya 12, ada lagi yang bisa kubantu?" -> buang ekor tawaran setelah koma/strip, jawabannya dipertahankan
    const cuts = [];
    for (const m of core.matchAll(/[,;]| [-–—] /g)) cuts.push(m.index);
    let handled = false;
    for (const cut of cuts.reverse()) {
      if (cut < 3) continue;
      const tail = core.slice(cut).replace(/^[\s,;\-–—]+(?:dan|atau|oh ya|btw)?\s*/i, "");
      if (!isOffer(tail)) continue;
      const head = core.slice(0, cut).trim();
      if (isOffer(head) || /^(?:kalau|jika|bila|apabila)\b/i.test(head)) {
        handled = true; // kepala kalimat hanyalah syarat/tawaran ("Kalau ada pertanyaan lain, silakan tanya"): seluruh kalimat dibuang
        break;
      }
      const mark = /^(?:halo|hai|hi|hei|hey|selamat|assalamualaikum|permisi)\b/i.test(head) || /!\s*$/.test(core) ? "!" : ".";
      kept.push(`${head}${/[.!?]$/.test(head) ? "" : mark}${sent.slice(sent.trimEnd().length)}`);
      handled = true;
      break;
    }
    if (handled) continue;
    if (isOffer(core)) continue; // seluruh kalimat adalah tawaran
    kept.push(sent);
  }
  return kept.join("");
}

/**
 * Buang tawaran bantuan dari balasan ("Ada yang bisa dibantu?", "Jangan ragu bertanya", "Semoga membantu", ...). Blok kode tidak disentuh.
 * Bila seluruh balasan ternyata hanya tawaran, kembalikan `fallback` (bawaan "Iya?"; "" = tidak ada balasan).
 */
export function stripHelpOffers(text, { fallback = "Iya?" } = {}) {
  const raw = String(text ?? "");
  if (!raw.trim()) return raw;
  const parts = raw.split(/(```[\s\S]*?```)/g);
  let out = parts.map((p, i) => (i % 2 === 1 ? p : stripSegment(p))).join("");
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (!out.replace(/[\s\p{P}\p{S}]/gu, "")) return fallback;
  return out;
}
