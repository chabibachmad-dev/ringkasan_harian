// Mode HUMOR untuk grup WhatsApp, diatur per grup dari Telegram (/humor). Bawaan: MATI di semua grup.
//
// Tiga hal yang bisa dinyalakan terpisah untuk tiap grup:
//   gaya   -> jawaban bot ikut santai & jenaka (jawaban teknis tetap akurat; candaan hanya bumbu, bukan pengganti isi)
//   pantun -> SEHARI SEKALI bot mengirim satu pantun jenaka ke grup, di jam ACAK (dipilih ulang tiap hari, beda tiap grup)
//   roast  -> di obrolan santai, bot kadang tiba-tiba menggoda satu orang (maks N kali sehari per grup, ada jeda)
//   balas  -> bot sesekali nimbrung MEMBALAS (reply) chat acak anggota, setelah membaca 15 chat sebelumnya; tanpa batas jam
//   sapa   -> bot mengobrol sendiri di grup minimal 10 kali sehari (jam menyebar sepanjang hari, isi bervariasi)
//
// Batas aman roasting ("ringan & aman"):
//   - hanya menggoda PERILAKU di chat (typo, telat balas, kebanyakan emoji, ...), tidak pernah fisik, agama, suku, keluarga,
//     penghasilan/uang, kesehatan, pasangan, politik, dan tanpa kata kasar (disaring lagi oleh kode, bukan hanya oleh AI);
//   - dilewati bila obrolan terdengar serius/sedih/resmi (duka, sakit, komplain, minta tolong, pengumuman, pesan panjang);
//   - hanya bila grup sedang ramai (>= beberapa pesan dari >= 2 orang) dan belum lama bot dipanggil;
//   - hanya di jam aktif, ada jeda antar-roast, dan jatah harian;
//   - tiap orang bisa menolak: "bot jangan roasting aku" (dan "bot boleh roasting aku lagi" untuk mencabut);
//   - pemilik nomor tidak diroasting kecuali WA_HUMOR_ROAST_OWNER=true;
//   - AI boleh menjawab SKIP bila tidak ada bahan yang pantas -> tidak ada yang dikirim.
//
// Privasi: untuk membaca obrolan santai, bot menyimpan ~10 pesan terakhir tiap grup (yang menyalakan roast) HANYA DI MEMORI:
// tidak ditulis ke database/berkas, hilang saat bot restart, dan dibuang bila terlalu lama. Grup yang roast-nya mati tidak dibaca sama sekali.
//
// Disimpan di tabel bot_state: wa_group_humor (pengaturan + daftar penolak roast) dan wa_group_humor_sched (jam pantun hari ini, jatah roast).
//
// .env (semua opsional):
//   WA_HUMOR_PANTUN_WINDOW=08:00-20:00   rentang jam (zona WA_TIMEZONE) untuk memilih jam pantun acak
//   WA_HUMOR_ROAST_MAX_PER_DAY=5         jatah roast per grup per hari (0 = tidak pernah)
//   WA_HUMOR_ROAST_COOLDOWN_MIN=45       jeda minimal antar-roast di satu grup (menit)
//   WA_HUMOR_ROAST_CHANCE=0.15           peluang tiap pesan "layak" memicu roast (0-1)
//   WA_HUMOR_ROAST_WINDOW=08:00-21:00    roast hanya di rentang jam ini
//   WA_HUMOR_ROAST_OWNER=false           true = pemilik nomor boleh ikut diroasting

import { createHash } from "node:crypto";
import { SAPA_KINDS, buildReplyPrompt, buildSapaPrompt, detectReplyPref, inNightWindow, isGraveTopic, isGroupQuestion, isReplyWorthy, pickFallbackSapa, pickSapaKind, readNgobrolConfig, validateChat } from "./ngobrol.js";
import {
  MEMORY_MAX_FACTS, MEMORY_REFUSE_TEXT, SILENT_MOODS, addressedToOther, balasEngagementFactor, describeStyle, detectMood, emptyFeedback, emptyStyle, fewShotNote, isDuoChat,
  kindWeights, moodHint, occasionsFor, parseBirthday, parseMemoryCmd, parseReactionOutput, pickReaction, pushExample, sanitizeFact, splitBubbles, updateStyle
} from "./manusiawi.js";
import { dayEnergy, daysSince, extractSelfFacts, fatigueFactor, hourFactor, jitterGap, naturalize, reactionFromText, replyChance } from "./insani.js";
import { IMAGE_SYSTEM, STICKER_SYSTEM, addToLibrary, buildImageUserPrompt, cleanImageDescription, parseStickerTag, pickStickerFor, readVisualConfig, STICKER_PICK_TAGS, STICKER_REACTION, STICKER_TAGS, parseStickerOutput, webpFirstFrame } from "./visual.js";

export const STATE_KEY = "wa_group_humor";
export const SCHED_KEY = "wa_group_humor_sched";
export const STYLE_KEY = "wa_group_style";
export const FEEDBACK_KEY = "wa_group_feedback";
export const STIKER_KEY = "wa_group_stiker";
const MAIN = "main";
const SECOND = "wa2";
const DAY_ID = { Sunday: "Minggu", Monday: "Senin", Tuesday: "Selasa", Wednesday: "Rabu", Thursday: "Kamis", Friday: "Jumat", Saturday: "Sabtu" };
const pad2 = (n) => String(n).padStart(2, "0");
const hm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

// ---------------------------------------------------------------- konfigurasi
export function parseWindow(text, fallback) {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(text ?? ""));
  if (!m) return fallback ?? null;
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59) return fallback ?? null;
  if (to - from < 30) return fallback ?? null; // rentang minimal 30 menit
  return { from, to };
}

export function readHumorConfig(env = process.env) {
  const num = (v, d, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const truthy = (v) => /^(1|true|ya|yes|on|aktif)$/i.test(String(v ?? "").trim());
  return {
    pantunWindow: parseWindow(env.WA_HUMOR_PANTUN_WINDOW, { from: 8 * 60, to: 20 * 60 }),
    roastWindow: parseWindow(env.WA_HUMOR_ROAST_WINDOW, { from: 8 * 60, to: 21 * 60 }),
    roastMaxPerDay: Math.floor(num(env.WA_HUMOR_ROAST_MAX_PER_DAY, 5, 0, 30)),
    roastCooldownMs: Math.floor(num(env.WA_HUMOR_ROAST_COOLDOWN_MIN, 45, 1, 24 * 60)) * 60_000,
    roastChance: num(env.WA_HUMOR_ROAST_CHANCE, 0.15, 0, 1),
    roastOwner: truthy(env.WA_HUMOR_ROAST_OWNER),
    bufferSize: 10,
    minMessages: 4,
    bufferMaxAgeMs: 10 * 60_000,
    freshMs: 2 * 60_000,
    afterTriggerMs: 5 * 60_000,
    afterSpontMs: 90_000, // roast tidak menyusul pesan spontan bot lain dalam jeda ini
    ...readNgobrolConfig(env),
    ...readVisualConfig(env)
  };
}

// ---------------------------------------------------------------- waktu setempat
/** Waktu setempat pada zona tertentu -> { day: "YYYY-MM-DD", minutes, weekday: "Senin" }. */
export function localParts(ms, timeZone = "Asia/Makassar") {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: DAY_ID[p.weekday] || p.weekday };
}

export function partOfDay(minutes) {
  if (minutes < 11 * 60) return "pagi";
  if (minutes < 15 * 60) return "siang";
  if (minutes < 18 * 60) return "sore";
  return "malam";
}

/** Pilih menit acak untuk pantun hari ini (>= 5 menit dari sekarang, di dalam rentang). null = hari ini sudah tidak ada waktu. */
export function pickPantunMinute(win, nowMinutes, random = Math.random) {
  const earliest = Math.max(win.from, nowMinutes + 5);
  if (earliest >= win.to) return null;
  return Math.floor(earliest + random() * (win.to - earliest));
}

// ---------------------------------------------------------------- penyaring kata
const stripAffix = (w) => {
  const out = new Set([w]);
  const pre = ["di", "ke", "me", "mem", "men", "meng", "meny", "ber", "ter", "se", "pe", "nge"];
  const suf = ["nya", "an", "in", "kan", "i", "lah", "mu", "ku", "ny"];
  for (const p of ["", ...pre]) {
    if (p && !w.startsWith(p)) continue;
    const a = w.slice(p.length);
    for (const s of ["", ...suf]) {
      if (s && !a.endsWith(s)) continue;
      const b = s ? a.slice(0, a.length - s.length) : a;
      if (b.length >= 3) out.add(b);
    }
  }
  return out;
};
const tokens = (text) => String(text ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function hasAny(text, words) {
  const set = words instanceof Set ? words : new Set(words);
  for (const t of tokens(text)) for (const v of stripAffix(t)) if (set.has(v)) return true;
  return false;
}
const W = (s) => new Set(s.split(/\s+/).filter(Boolean));

// Selalu dilarang (candaan apa pun): kasar, makian, cabul, politik.
const BAN_COMMON = W(`anjing anjir anjay babi bangsat brengsek kampret tai taik sialan setan iblis bajingan keparat kontol memek ngentot entot
  pelacur lonte jancok jancuk cuk asu monyet tolol goblok bodoh bego idiot dungu sinting edan kafir sange bokep porno seks sex mesum
  jokowi prabowo megawati anies ganjar pilpres pemilu pilkada partai politik presiden gubernur bupati caleg koruptor korupsi`);
// Tambahan khusus roasting: fisik, agama, suku, keluarga, pasangan, uang, kesehatan.
const BAN_ROAST = W(`gendut gemuk kurus jelek botak pendek pesek hitam item bau bulukan tua jerawat ompong cebol kribo ganteng cantik burik cacat
  ibu ibumu bapak bapakmu ayah emak mamak ortu mertua istri suami anak keluarga saudara kakak adik pacar mantan jodoh jomblo nikah menikah cerai selingkuh
  agama islam kristen katolik hindu buddha budha tuhan allah nabi rasul gereja masjid pendeta ustaz ustadz kyai ulama doa dosa neraka surga
  jawa sunda batak bugis madura padang cina china tionghoa arab papua ambon bali minang banjar makassar flores dayak betawi
  gaji miskin kere utang hutang pelit kaya duit uang tunjangan bonus honor pengangguran
  sakit gila stres depresi waras buta tuli bisu mati meninggal wafat obat diet operasi rumah penyakit`);

export function hasBannedWord(text, { roast = false } = {}) {
  if (hasAny(text, BAN_COMMON)) return true;
  return roast ? hasAny(text, BAN_ROAST) : false;
}

// ---------------------------------------------------------------- deteksi obrolan serius / santai
const SERIOUS = W(`innalillahi inalillahi meninggal wafat duka berduka belasungkawa almarhum almarhumah sakit opname operasi kecelakaan musibah bencana
  kehilangan sedih menangis nangis stres depresi marah kesal kecewa komplain protes urgent darurat tolong mohon error gagal masalah salah
  polisi pecat phk cerai utang hutang doakan doa sabar turut izin pengumuman resmi undangan disposisi surat nota laporan deadline tenggat revisi
  bapak ibu bapak/ibu bu pak`);
const SERIOUS_PHRASES = [/\b(gimana|bagaimana) cara\b/i, /\bkenapa (ya|sih)?\b.*\?/i, /\bturut berduka\b/i, /\brumah sakit\b/i, /\bminta tolong\b/i, /https?:\/\//i];
const CASUAL_CUE = /(wk(wk)*|haha+|hehe+|hihi+|lol\b|ngakak|lucu|santai|gabut|ngopi|makan|lapar|ngantuk|hujan|capek|macet|weekend|libur|mantap|kocak|receh|bercanda|😂|🤣|😆|😅|😭|🤭|😁|😄|😜)/i;

/** true bila pesan-pesan ini terdengar serius/sedih/resmi (jangan bercanda). */
export function isSeriousChat(messages) {
  for (const m of messages) {
    const t = String(m?.text ?? m ?? "");
    if (t.length > 220) return true; // pesan panjang = biasanya pengumuman/laporan
    if (hasAny(t, SERIOUS)) return true;
    if (SERIOUS_PHRASES.some((re) => re.test(t))) return true;
  }
  return false;
}

export function hasCasualCue(messages) {
  return messages.some((m) => CASUAL_CUE.test(String(m?.text ?? m ?? "")));
}

// ---------------------------------------------------------------- menolak / mengizinkan roasting
const SELF = "(?:aku|saya|gue|gw|gua|ane|sy)";
const ROASTW = "(?:di)?(?:ng?e)?(?:roast\\w*|ledek\\w*|ejek\\w*|bully\\w*|candain\\w*|bercandain\\w*|sindir\\w*|nyindir\\w*)";
const OPT_OUT_RES = [
  new RegExp(`\\b(?:jangan|jgn|ga usah|gak usah|nggak usah|enggak usah|tidak usah|stop|berhenti|dilarang)\\b[^.!?\\n]{0,25}?\\b${ROASTW}\\b[^.!?\\n]{0,15}?\\b${SELF}\\b`, "i"),
  new RegExp(`\\b${SELF}\\b[^.!?\\n]{0,15}?\\b(?:ga|gak|nggak|enggak|tidak|ndak|gamau|gak mau)\\b[^.!?\\n]{0,12}?\\b${ROASTW}\\b`, "i"),
  new RegExp(`\\b${SELF}\\b[^.!?\\n]{0,15}?\\b(?:ga|gak|nggak|enggak|tidak|ndak)\\s+(?:mau|suka|usah)\\s+${ROASTW}\\b`, "i"),
  new RegExp(`\\b(?:jangan|jgn)\\s+${ROASTW}\\s+${SELF}\\b`, "i")
];
const OPT_IN_RE = new RegExp(`\\b(?:boleh|bolehin|silakan|silahkan|monggo|gas|ayo|ok|oke)\\b[^.!?\\n]{0,20}?\\b${ROASTW}\\b[^.!?\\n]{0,15}?\\b${SELF}\\b`, "i");

/** "bot jangan roasting aku" -> "out"; "bot boleh roasting aku lagi" -> "in"; selain itu null. */
export function detectRoastPref(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 200) return null;
  if (OPT_OUT_RES.some((re) => re.test(t))) return "out";
  if (OPT_IN_RE.test(t)) return "in";
  return null;
}

// ---------------------------------------------------------------- pantun
export const PANTUN_THEMES = [
  "kopi dan teh", "hari Senin dan semangat kerja", "rapat yang molor", "sinyal dan wifi yang lemot", "hujan di sore hari", "makan siang",
  "ngantuk di jam kerja", "macet di jalan", "grup chat yang ramai", "stiker dan emoji", "pulang kerja", "akhir pekan", "gorengan hangat",
  "printer yang suka macet", "tenggat dan laporan", "baterai HP tinggal satu persen", "lupa bawa payung", "es teh manis", "semangat pagi", "camilan di meja kantor"
];

// Cadangan bila AI gagal / pantunnya tidak lolos periksa: grup tidak pernah menerima pantun rusak.
export const FALLBACK_PANTUN = [
  "Buah duku buah manggis,\nDimakan enak waktu siang.\nKerja terus jangan menangis,\nSebentar lagi waktunya pulang.",
  "Beli sepatu di pasar baru,\nDipakai jalan ke kantor pos.\nRapat lama bikin ngantuk melulu,\nUntung ada kopi yang tak pernah bolos.",
  "Pergi ke kebun memetik jambu,\nJambunya manis dimakan berdua.\nSenin pagi jangan cemberut dulu,\nKopi dan senyum bikin hati bahagia.",
  "Burung merpati terbang tinggi,\nHinggap sebentar di atas pagar.\nJangan lupa makan nasi,\nBiar semangat tidak buyar.",
  "Kalau ada sumur di ladang,\nBoleh kita menumpang mandi.\nKalau ada kuota lapang,\nBoleh kita nonton sampai pagi.",
  "Anak ayam turun sepuluh,\nMati satu tinggal sembilan.\nChat grup ramai riuh,\nYang dibaca cuma tiga balasan.",
  "Makan sate di tepi jalan,\nBumbunya kacang rasanya mantap.\nJanji dibuat penuh harapan,\nTapi \"nanti dulu\" jawabannya tetap.",
  "Sore hari memandang hujan,\nHujan turun membasahi kota.\nKalau capek jangan dipaksakan,\nIstirahat dulu biar tetap ceria.",
  "Naik sepeda keliling taman,\nSinggah sebentar membeli roti.\nTenggat datang tak kenal teman,\nTapi semangat jangan sampai pergi.",
  "Ikan gabus di dalam kolam,\nDimasak pedas segar rasanya.\nJangan begadang sampai malam,\nNanti ngantuk besok paginya.",
  "Menanam padi di tepi kali,\nHasilnya banyak dijual ke kota.\nHari ini sudah kerja sepenuh hati,\nWaktunya senyum dan bergembira.",
  "Layang-layang terbang tinggi,\nPutus benang jatuh ke tanah.\nKalau lupa janji jangan lari,\nMinta maaf saja, hati pun cerah.",
  "Burung kenari bernyanyi merdu,\nHinggap di dahan pohon mangga.\nGrup ramai tak pernah sendu,\nKarena isinya orang-orang bahagia."
];

/** Bunyi akhir kata terakhir sebuah baris: huruf vokal terakhir + konsonan sesudahnya ("manggis" -> "is", "siang" -> "ang"). */
export function endSound(line) {
  const words = String(line ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").trim().split(/\s+/);
  const w = words[words.length - 1] || "";
  const m = /([aeiou][^aeiou]*)$/.exec(w);
  return m ? m[1] : w.slice(-2);
}

/** Bersihkan keluaran AI menjadi baris-baris pantun. */
export function cleanPantunLines(raw) {
  return String(raw ?? "")
    .replace(/```[a-z]*/gi, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, "").replace(/[*_`"“”]/g, "").trim())
    .filter((l) => l && !/^(?:pantun|judul|berikut|ini pantun|tema)\b.*:?\s*$/i.test(l) && !/:\s*$/.test(l));
}

/** Pantun valid = 4 baris, rima a-b-a-b, baris wajar, tanpa kata terlarang/tautan. -> { ok, text?, reason? } */
export function validatePantun(raw) {
  const lines = cleanPantunLines(raw);
  if (lines.length !== 4) return { ok: false, reason: `harus 4 baris (dapat ${lines.length})` };
  for (const l of lines) {
    const words = l.split(/\s+/).length;
    if (l.length < 14 || l.length > 90 || words < 3 || words > 14) return { ok: false, reason: "panjang baris tidak wajar" };
    if (/https?:|www\.|@/i.test(l)) return { ok: false, reason: "memuat tautan" };
  }
  if (endSound(lines[0]) !== endSound(lines[2]) || endSound(lines[1]) !== endSound(lines[3])) return { ok: false, reason: "rima bukan a-b-a-b" };
  const text = lines.join("\n");
  if (hasBannedWord(text)) return { ok: false, reason: "memuat kata terlarang" };
  return { ok: true, text };
}

export function buildPantunPrompt({ theme, weekday, part, avoid = [] }) {
  const system = `Kamu penulis pantun jenaka Indonesia. Tulis SATU pantun empat baris (dua baris sampiran, dua baris isi) dengan rima a-b-a-b, tiap baris 8-12 suku kata, bahasa Indonesia santai yang lucu ringan. Aman untuk semua umur dan semua orang: TANPA SARA, politik, ejekan fisik, keluarga, uang/gaji, kesehatan, dan tanpa kata kasar. Keluarkan HANYA empat baris pantun: tanpa judul, tanpa nomor, tanpa tanda kutip, tanpa penjelasan.`;
  const user = `Tema: ${theme}. Hari ini ${weekday}, waktu ${part}.${avoid.length ? ` Jangan mirip dengan: ${avoid.slice(0, 3).map((x) => x.split("\n")[0]).join(" / ")}.` : ""}`;
  return { system, user };
}

// ---------------------------------------------------------------- roasting
export function cleanRoast(raw) {
  let t = String(raw ?? "").replace(/```[a-z]*/gi, "").trim();
  t = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || "";
  t = t.replace(/^(?:ayyubi|bot|roast|jawaban)\s*:\s*/i, "").replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  return t;
}

/** Roast valid = satu kalimat pendek, menyebut nama sasaran, tanpa kata terlarang. -> { ok, text?, reason? } */
export function validateRoast(raw, { targetName = "" } = {}) {
  const t = cleanRoast(raw);
  if (!t) return { ok: false, reason: "kosong" };
  if (/^skip\b/i.test(t)) return { ok: false, reason: "AI memilih SKIP" };
  if (t.length < 12 || t.length > 200) return { ok: false, reason: "panjang tidak wajar" };
  if (/https?:|www\.|@\d|@\w/.test(t)) return { ok: false, reason: "memuat tautan/mention" };
  if ((t.match(/[.!?]+(?:\s|$)/g) || []).length > 2) return { ok: false, reason: "lebih dari dua kalimat" };
  if (hasBannedWord(t, { roast: true })) return { ok: false, reason: "memuat kata terlarang" };
  const first = String(targetName).trim().split(/\s+/)[0];
  if (first && first.length >= 2 && !t.toLowerCase().includes(first.toLowerCase())) return { ok: false, reason: "tidak menyebut nama sasaran" };
  return { ok: true, text: t };
}

export function buildRoastPrompt({ target, messages }) {
  const system = `Kamu Ayyubi, bot grup WhatsApp yang jenaka. Tugasmu: menggoda SATU orang di grup dengan candaan RINGAN dan hangat, seperti teman akrab yang iseng.
ATURAN KERAS:
- Goda HANYA perilaku di chat (mis. typo, balas telat, kebanyakan emoji, ketawa terus, nanya hal yang sama, lagi lapar/ngantuk/gabut). Boleh membandingkan secara lucu, tapi tetap sayang.
- DILARANG menyinggung: fisik/wajah/badan, agama, suku/daerah, keluarga, pasangan/jomblo, uang/gaji/kekayaan, kesehatan/mental, politik, kemampuan/kecerdasan; DILARANG kata kasar atau hinaan.
- Satu kalimat saja (maksimal 25 kata), awali atau sebut nama sasaran, boleh satu emoji. Tanpa tanda kutip, tanpa penjelasan.
- Kalau tidak ada bahan yang aman dan lucu, jawab persis: SKIP`;
  const lines = messages.map((m) => `${m.name}: ${String(m.text).slice(0, 160)}`).join("\n");
  const user = `Obrolan terakhir:\n${lines}\n\nSasaran godaan: ${target.name}`;
  return { system, user };
}

// ---------------------------------------------------------------- catatan prompt untuk gaya jawaban
export const HUMOR_CHAT_NOTE = `

GAYA HUMORIS (grup ini): kamu asisten yang santai dan jenaka. Boleh menyelipkan SATU candaan ringan atau permainan kata (kadang pantun dua baris) di awal atau akhir jawaban, tetapi tidak di setiap jawaban. ATURAN: (1) isi jawaban teknis (aturan, angka, prosedur, hukum, keuangan, kode, tanggal) HARUS tetap akurat, jelas, dan lengkap -- candaan hanya bumbu dan tidak boleh mengubah atau menggantikan fakta; (2) JANGAN bercanda bila topiknya duka, sakit, musibah, marah, komplain, atau urusan resmi; (3) jangan menyinggung fisik, agama, suku, keluarga, penghasilan, atau kesehatan siapa pun; (4) candaan ditujukan ke situasi/kejadian, bukan merendahkan orang.`;

// ---------------------------------------------------------------- perintah /humor
const ON_RE = /^(on|aktif|nyala|hidup|ya|1)$/i;
const OFF_RE = /^(off|mati|matikan|tidak|0)$/i;
const FLAG_WORDS = { gaya: "chat", jawaban: "chat", chat: "chat", pantun: "pantun", roast: "roast", roasting: "roast", godaan: "roast", ledek: "roast", balas: "balas", nimbrung: "balas", sapa: "sapa", ngobrol: "sapa", latihan: "latihan", lihat: "lihat", ingat: "ingat", ingatan: "ingat", gambar: "lihat", stiker: "lihat", sticker: "lihat", baca: "lihat" };
export const FLAG_LABEL = { chat: "gaya jawaban", pantun: "pantun harian", roast: "roasting ringan", balas: "balas chat acak", sapa: "chat otomatis harian", latihan: "mode latihan (draf ke pemilik dulu)", lihat: "baca gambar & stiker, balas dengan stiker", ingat: "mengingat hal ringan yang diceritakan anggota sendiri" };
export const ALL_FLAGS = ["chat", "pantun", "roast", "balas", "sapa"];
const anyFlag = (g) => Boolean(g && (g.chat || g.pantun || g.roast || g.balas || g.sapa));

/** "/humor ..." -> { kind, ... } */
export function parseHumorArg(arg, { secondAliases = [] } = {}) {
  const words = String(arg ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { kind: "status" };
  const aliases = new Set(["wa2", "nomor2", "nomor-2", ...secondAliases.map((a) => String(a).toLowerCase()).filter(Boolean)]);
  const verb = words[0].toLowerCase();
  let rest = words.slice(1);
  let account = null;
  const takeAccount = () => {
    if (rest.length && aliases.has(rest[0].toLowerCase())) {
      account = SECOND;
      rest = rest.slice(1);
    }
  };
  const need = (what) => ({ kind: "error", error: what });
  const USAGE = "Pakai: /humor • /humor on <grup> • /humor off <grup> • /humor pantun|roast|gaya|balas|sapa|latihan|lihat|ingat on|off <grup> • /humor semua on|off • /humor jam 09:00-17:00 <grup> • /humor diam <jam> <grup> • /humor lanjut <grup> • /humor profil <grup> • /humor koleksi [hapus <no>|label <no> <label>|tes [no] <grup>] • /humor tes [pantun|sapa|balas] <grup>";
  if (aliases.has(verb) && words.length === 1) return { kind: "status", account: SECOND };
  if (ON_RE.test(verb) || OFF_RE.test(verb)) {
    takeAccount();
    const target = rest.join(" ").trim();
    if (!target) return need("Sebutkan grupnya (nama atau nomor dari /humor). Contoh: /humor on 2");
    return { kind: "set", flags: [...ALL_FLAGS], value: ON_RE.test(verb), target, account };
  }
  if (/^(semua|all)$/.test(verb)) {
    const v = (rest.shift() || "").toLowerCase();
    if (!ON_RE.test(v) && !OFF_RE.test(v)) return need("Pakai: /humor semua on  atau  /humor semua off");
    takeAccount();
    return { kind: "set", flags: [...ALL_FLAGS], value: ON_RE.test(v), target: "*", account };
  }
  if (FLAG_WORDS[verb]) {
    const v = (rest.shift() || "").toLowerCase();
    if (!ON_RE.test(v) && !OFF_RE.test(v)) return need(`Pakai: /humor ${verb} on <grup>  atau  /humor ${verb} off <grup>`);
    takeAccount();
    const target = rest.join(" ").trim();
    if (!target) return need("Sebutkan grupnya (nama atau nomor dari /humor).");
    return { kind: "set", flags: [FLAG_WORDS[verb]], value: ON_RE.test(v), target, account };
  }
  if (/^(jam|waktu)$/.test(verb)) {
    const w = rest.shift() || "";
    let window = null;
    if (/^(reset|default|bawaan)$/i.test(w)) window = "reset";
    else {
      window = parseWindow(w, null);
      if (!window) return need("Format jam: /humor jam 09:00-17:00 <grup> (rentang minimal 30 menit), atau /humor jam reset <grup>");
    }
    takeAccount();
    const target = rest.join(" ").trim();
    if (!target) return need("Sebutkan grupnya (nama atau nomor dari /humor).");
    return { kind: "window", window, target, account };
  }
  if (/^(diam|senyap|mute)$/.test(verb)) {
    const hrs = Number(String(rest[0] || "").replace(/[^\d.]/g, ""));
    if (!rest.length || !Number.isFinite(hrs) || hrs <= 0 || hrs > 168) return need("Pakai: /humor diam <jam 1-168> <grup>  (contoh: /humor diam 3 keluarga)");
    rest.shift();
    takeAccount();
    const target = rest.join(" ").trim();
    if (!target) return need("Sebutkan grupnya (nama atau nomor dari /humor).");
    return { kind: "mute", hours: hrs, target: /^(semua|all)$/i.test(target) ? "*" : target, account };
  }
  if (/^(lanjut|bicara|unmute)$/.test(verb)) {
    takeAccount();
    const target = rest.join(" ").trim();
    if (!target) return need("Sebutkan grupnya: /humor lanjut <nama atau nomor>");
    return { kind: "unmute", target: /^(semua|all)$/i.test(target) ? "*" : target, account };
  }
  if (/^(koleksi|stikerku|koleksi-stiker)$/.test(verb)) {
    takeAccount();
    const sub = (rest.shift() || "").toLowerCase();
    if (!sub || /^(daftar|list|lihat)$/.test(sub)) return { kind: "koleksi", action: "list", account };
    if (/^(hapus|buang|delete)$/.test(sub)) {
      const n = Number(rest[0]);
      if (!Number.isInteger(n) || n < 1) return need("Pakai: /humor koleksi hapus <nomor>  (nomor dari /humor koleksi)");
      return { kind: "koleksi", action: "hapus", index: n, account };
    }
    if (/^(label|tag)$/.test(sub)) {
      const n = Number(rest[0]);
      const tag = String(rest[1] || "").toLowerCase();
      if (!Number.isInteger(n) || n < 1 || !tag) return need(`Pakai: /humor koleksi label <nomor> <${STICKER_TAGS.join("|")}>`);
      return { kind: "koleksi", action: "label", index: n, tag, account };
    }
    if (/^(tes|test|coba|kirim)$/.test(sub)) {
      let index = null;
      if (rest.length >= 2 && /^\d{1,3}$/.test(rest[0])) index = Number(rest.shift());
      const target = rest.join(" ").trim();
      if (!target) return need("Pakai: /humor koleksi tes [nomor stiker] <grup>  (contoh: /humor koleksi tes 2 keluarga)");
      return { kind: "koleksi", action: "tes", index, target, account };
    }
    return need("Pakai: /humor koleksi • /humor koleksi hapus <nomor> • /humor koleksi label <nomor> <label> • /humor koleksi tes [nomor] <grup>");
  }
  if (/^(profil|belajar)$/.test(verb)) {
    takeAccount();
    const target = rest.join(" ").trim();
    if (!target) return need("Sebutkan grupnya: /humor profil <nama atau nomor>");
    return { kind: "profile", target, account };
  }
  if (/^(tes|test|coba|sekarang)$/.test(verb)) {
    let what = "pantun";
    if (rest.length >= 1 && /^(pantun|sapa|ngobrol|balas)$/i.test(rest[0])) {
      const w = rest.shift().toLowerCase();
      what = w === "ngobrol" ? "sapa" : w;
    }
    takeAccount();
    const target = rest.join(" ").trim();
    if (!target) return need("Sebutkan grupnya: /humor tes <nama atau nomor>  (atau /humor tes sapa <grup>)");
    return { kind: "test", target, account, what };
  }
  return need(`"${words[0]}" tidak dikenali. ${USAGE}`);
}

// ---------------------------------------------------------------- inti
/**
 * deps:
 *   state: { get, set }            penyimpanan (bot_state); get boleh melempar bila database terganggu
 *   ai({ system, user, temperature, maxTokens }) -> Promise<string>      pembuat teks (null = pakai cadangan tetap)
 *   send(account, jid, text, { quoted }) -> Promise                      kirim ke grup (harus memeriksa grup masih diizinkan)
 *   listGroups(account) -> Promise<[{ id, subject, allowed }] | null>    grup yang diikuti nomor itu
 *   labels, secondEnabled, timeZone, config, now, random, log, timer(fn, ms)
 */
export function createHumor({ state = null, ai = null, send = null, react = null, review = null, media = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), listGroups = null, labels = {}, secondEnabled = false, timeZone = "Asia/Makassar", config = readHumorConfig({}), now = () => Date.now(), random = Math.random, log = console, timer = (fn, ms) => setTimeout(fn, ms) } = {}) {
  let data = { groups: {}, optout: {}, noreply: {}, members: {}, nolearn: {} };
  let sched = { pantun: {}, roast: {}, sapa: {}, balas: {}, reaksi: {}, vision: {}, stiker: {} };
  let styles = {}; // key -> hitungan gaya grup (hanya angka, tanpa isi chat)
  let stickers = {}; // key -> [{ id, tag, desc, seen, uses, ts }] perpustakaan stiker per grup (berkasnya disimpan lewat media.store)
  let feedbacks = {}; // key -> { good, bad, kinds } (contoh pesan BOT yang disetujui/ditolak pemilik + tingkat respons grup)
  const dirty = { style: false, feedback: false, stiker: false, data: false };
  const lastBalasTo = new Map(); // key -> { ids, ts, depth } orang yang terakhir dibalas bot (untuk lanjutan obrolan)
  const repliedRecent = new Map(); // key -> [{ id, ts }] orang yang baru dibalas (supaya giliran bergantian)
  const spontTimes = new Map(); // key -> [ts] kapan bot bicara sendiri (untuk mengukur kelelahan)
  const lastStickerAt = new Map();
  const stickerErr = new Map(); // key -> alasan pembacaan/pelabelan stiker terakhir yang gagal (memori; tampil di /humor profil)
  const recentStickers = new Map(); // key -> id stiker yang baru dipakai bot
  const pending = new Map(); // id -> draf mode latihan yang menunggu keputusan pemilik (memori saja)
  const lastBot = new Map(); // key -> { ts, kind, counted } pesan bot terakhir (untuk mengukur respons grup)
  const lastReactAt = new Map();
  let loadedOk = !state;
  const buffers = new Map(); // key -> [{ name, ids, text, ts, isOwner, msg }]   (hanya di memori)
  const lastTriggerAt = new Map();
  const ctxBuf = new Map(); // key -> [{ name, ids, text, ts, isBot, msg }]  konteks obrolan untuk balas/sapa (hanya di memori)
  const lastSpontAt = new Map(); // key -> kapan bot terakhir bicara sendiri di grup itu (pantun/roast/balas/sapa)
  const busy = new Set();
  const label = (a) => labels[a] || (a === SECOND ? "Nomor 2" : "Nomor utama");
  const keyOf = (account, jid) => `${account === SECOND ? SECOND : MAIN}|${jid}`;
  const accounts = () => (secondEnabled ? [MAIN, SECOND] : [MAIN]);

  async function load() {
    if (!state) return;
    try {
      const raw = await state.get(STATE_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        data = { groups: j?.groups && typeof j.groups === "object" ? j.groups : {}, optout: j?.optout && typeof j.optout === "object" ? j.optout : {}, noreply: j?.noreply && typeof j.noreply === "object" ? j.noreply : {}, members: j?.members && typeof j.members === "object" ? j.members : {}, nolearn: j?.nolearn && typeof j.nolearn === "object" ? j.nolearn : {} };
      }
      const rs = await state.get(SCHED_KEY);
      if (rs) {
        const j = JSON.parse(rs);
        sched = { pantun: j?.pantun || {}, roast: j?.roast || {}, sapa: j?.sapa || {}, balas: j?.balas || {}, reaksi: j?.reaksi || {}, vision: j?.vision || {}, stiker: j?.stiker || {} };
      }
      try {
        const rst = await state.get(STYLE_KEY);
        if (rst) styles = JSON.parse(rst) || {};
        const rfb = await state.get(FEEDBACK_KEY);
        if (rfb) feedbacks = JSON.parse(rfb) || {};
        const rsk = await state.get(STIKER_KEY);
        if (rsk) stickers = JSON.parse(rsk) || {};
      } catch (e) {
        log.warn?.(`😄 [Humor] gagal membaca gaya/umpan balik tersimpan (dimulai dari kosong): ${e instanceof Error ? e.message : e}`);
      }
      loadedOk = true;
    } catch (e) {
      log.warn?.(`😄 [Humor] gagal membaca pengaturan tersimpan (fitur ditahan sampai terbaca): ${e instanceof Error ? e.message : e}`);
    }
  }
  async function saveData() {
    if (!state) return true;
    try {
      await state.set(STATE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      log.warn?.(`😄 [Humor] gagal menyimpan: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }
  /** Simpan gaya grup & umpan balik bila berubah (dipanggil tiap menit dari check()). */
  async function flush() {
    if (!state) return;
    try {
      if (dirty.style) {
        dirty.style = false;
        await state.set(STYLE_KEY, JSON.stringify(styles));
      }
      if (dirty.feedback) {
        dirty.feedback = false;
        await state.set(FEEDBACK_KEY, JSON.stringify(feedbacks));
      }
      if (dirty.stiker) {
        dirty.stiker = false;
        await state.set(STIKER_KEY, JSON.stringify(stickers));
      }
      if (dirty.data) {
        dirty.data = false;
        if (!(await saveData())) dirty.data = true;
      }
    } catch (e) {
      dirty.style = dirty.feedback = dirty.stiker = dirty.data = true;
      log.warn?.(`😄 [Humor] gagal menyimpan gaya/umpan balik: ${e instanceof Error ? e.message : e}`);
    }
  }
  async function saveSched() {
    if (!state) return;
    try {
      await state.set(SCHED_KEY, JSON.stringify(sched));
    } catch (e) {
      log.warn?.(`😄 [Humor] gagal menyimpan jadwal: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Pengaturan grup (sinkron, dipakai tiap pesan) atau null bila tidak ada yang menyala. Tidak aktif sebelum pengaturan tersimpan terbaca. */
  function settings(account, jid) {
    if (!loadedOk) return null;
    const g = data.groups[keyOf(account, jid)];
    if (!anyFlag(g)) return null;
    return g;
  }
  const anyEnabled = () => loadedOk && Object.values(data.groups).some((g) => anyFlag(g));

  // ------------------------------------------------ konteks obrolan (hanya di memori) + pesan spontan bot
  function pushCtx(key, entry) {
    const buf = ctxBuf.get(key) || [];
    buf.push(entry);
    while (buf.length > config.contextSize + 8) buf.shift();
    for (let i = 0; i < buf.length - 6; i += 1) {
      buf[i].msg = null; // referensi pesan (untuk reply) hanya dipertahankan untuk yang terbaru
      if (buf[i].media) buf[i].media.ref = null;
    }
    ctxBuf.set(key, buf);
  }
  /** Chat sebelum indeks `before` (bawaan: semua) yang masih segar, paling banyak contextSize, urut lama -> baru. */
  function contextBefore(key, before = null) {
    const t = now();
    const buf = (ctxBuf.get(key) || []).filter((m) => t - m.ts <= config.contextMaxAgeMs);
    const upto = before === null ? buf.length : Math.max(0, buf.indexOf(before));
    return buf.slice(Math.max(0, upto - config.contextSize), upto);
  }
  /** Jawaban biasa bot (saat dipanggil) dicatat sebagai bagian obrolan, supaya balasan/sapa berikutnya nyambung. Hanya di memori. */
  function noteBotSaid(account, jid, text) {
    const key = keyOf(account, jid);
    const g = settings(account, jid);
    if (!g || !(g.balas || g.sapa)) return;
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    if (clean) pushCtx(key, { name: "Ayyubi", ids: [], text: clean.slice(0, 240), ts: now(), isBot: true, msg: null });
  }
  const styleOf = (key) => styles[key] || (styles[key] = emptyStyle());
  const fbOf = (key) => feedbacks[key] || (feedbacks[key] = emptyFeedback());
  const muted = (key) => (data.groups[key]?.muteUntil || 0) > now();
  const randomId = () => Math.floor(random() * 0xffffff).toString(36).padStart(4, "0") + Math.floor(now() % 0xfffff).toString(36);

  /** Catat bahwa bot baru bicara (untuk mengukur apakah grup menanggapi). */
  function markSent(key, kind) {
    const k = (fbOf(key).kinds[kind] ||= { sent: 0, eng: 0 });
    k.sent += 1;
    dirty.feedback = true;
    lastBot.set(key, { ts: now(), kind, counted: false });
  }
  /** Anggota menulis sesudah bot bicara: balasan langsung ke bot dihitung 1, chat lain dalam 2 menit dihitung 0.5. */
  function noteEngagement(key, { repliedToBot = false } = {}) {
    const lb = lastBot.get(key);
    if (!lb || lb.counted) return;
    const dt = now() - lb.ts;
    const credit = repliedToBot && dt <= 30 * 60_000 ? 1 : dt <= 2 * 60_000 ? 0.5 : 0;
    if (!credit) return;
    lb.counted = true;
    const k = (fbOf(key).kinds[lb.kind] ||= { sent: 0, eng: 0 });
    k.eng += credit;
    dirty.feedback = true;
  }

  /** Kirim SATU pesan spontan ke grup (tanpa dipecah) dan catat sebagai bagian obrolan. Dipakai pantun & roast. */
  function noteSpont(key) {
    const t = now();
    const arr = (spontTimes.get(key) || []).filter((x) => t - x <= 30 * 60_000);
    arr.push(t);
    spontTimes.set(key, arr);
  }
  async function out(account, jid, text, opts = {}, kind = "lain") {
    const key = keyOf(account, jid);
    await send(account, jid, text, opts);
    lastSpontAt.set(key, now());
    noteSpont(key);
    markSent(key, kind);
    const g = data.groups[key];
    if (g && (g.balas || g.sapa)) pushCtx(key, { name: "Ayyubi", ids: [], text: String(text).replace(/\s+/g, " ").slice(0, 240), ts: now(), isBot: true, msg: null });
  }
  /** Kirim satu atau dua gelembung pesan dengan jeda alami (dua baris dari AI atau teks panjang yang dipecah di batas kalimat). */
  async function outBubbles(account, jid, text, opts = {}, kind = "lain", { fix = "" } = {}) {
    const key = keyOf(account, jid);
    const parts = splitBubbles(text, { random });
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) await sleep(700 + Math.floor(random() * 1500));
      await send(account, jid, parts[i], i === 0 ? opts : {});
    }
    if (fix) {
      await sleep(1200 + Math.floor(random() * 2200)); // sadar salah ketik, lalu membetulkan
      await send(account, jid, fix, {}).catch(() => {});
    }
    lastSpontAt.set(key, now());
    noteSpont(key);
    markSent(key, kind);
    const g = data.groups[key];
    if (g && (g.balas || g.sapa)) pushCtx(key, { name: "Ayyubi", ids: [], text: parts.join(" ").replace(/\s+/g, " ").slice(0, 240), ts: now(), isBot: true, msg: null });
    return parts;
  }

  // ------------------------------------------------ mode latihan: draf ke pemilik dulu (Telegram), baru ke grup
  function prunePending() {
    const t = now();
    for (const [id, p] of pending) if (t - p.at > config.reviewTtlMs) pending.delete(id);
  }
  /** Kirim ke grup, atau (mode latihan) ajukan ke pemilik. -> { sent: true } | { queued: true, id } */
  async function deliver(account, jid, text, { quoted = null, kind = "lain", targetName = "", targetText = "", force = false, question = false } = {}) {
    const key = keyOf(account, jid);
    const g = data.groups[key];
    let fix = "";
    if (config.naturalize && (kind === "balas" || String(kind).startsWith("sapa"))) {
      const nat = naturalize(text, styles[key], { random, typoChance: kind === "balas" && !force && !question ? config.typoChance : 0, keep: [targetName], serious: false });
      text = nat.text || text;
      fix = nat.fix || "";
    }
    if (!force && g?.latihan && review) {
      prunePending();
      const id = randomId();
      pending.set(id, { account, jid, key, text, quoted, kind, fix, at: now() });
      try {
        await review({ id, group: g.name || jid, kind, targetName, targetText, text });
      } catch (e) {
        pending.delete(id);
        throw e;
      }
      log.log?.(`📝 [Humor] draf ${kind} untuk ${g.name || jid} menunggu keputusan pemilik (${id}).`);
      return { queued: true, id };
    }
    await outBubbles(account, jid, text, quoted ? { quoted } : {}, kind, { fix });
    return { sent: true };
  }
  /** Keputusan pemilik dari tombol Telegram: "ok:<id>" kirim, "no:<id>" buang. -> teks untuk pemilik */
  async function decide(arg) {
    const [verb, id] = String(arg ?? "").split(":");
    prunePending();
    const p = pending.get(id);
    if (!p) return "Draf ini sudah kedaluwarsa atau sudah diproses (tombol hanya berlaku ±45 menit dan hilang bila bot restart).";
    pending.delete(id);
    const fb = fbOf(p.key);
    if (verb === "ok") {
      try {
        await outBubbles(p.account, p.jid, p.text, p.quoted ? { quoted: p.quoted } : {}, p.kind, { fix: p.fix || "" });
      } catch (e) {
        return `⚠️ Gagal mengirim ke grup: ${e instanceof Error ? e.message : e}`;
      }
      pushExample(fb.good, p.text);
      dirty.feedback = true;
      await flush();
      return "✅ Terkirim ke grup. Kujadikan contoh pesan yang kamu suka.";
    }
    pushExample(fb.bad, p.text);
    dirty.feedback = true;
    await flush();
    return "🗑️ Dibuang, tidak dikirim. Kujadikan contoh gaya yang dihindari.";
  }

  // ------------------------------------------------ ingatan anggota (opt-in: hanya yang diminta anggota itu sendiri)
  function findMember(key, ids) {
    const all = data.members[key] || {};
    for (const [mid, m] of Object.entries(all)) if ((m.ids || []).some((x) => ids.includes(x))) return { mid, m };
    return null;
  }
  const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "kamu";
  /** Nama yang dipakai bot untuk memanggil orang ini (panggilan pilihannya sendiri, atau nama depan di WhatsApp). */
  function callName(key, ids, fallbackName = "") {
    const f = ids?.length ? findMember(key, ids) : null;
    return f?.m?.nick || firstName(fallbackName || f?.m?.name);
  }
  function liveFacts(m) {
    const t = now();
    return (m.facts || []).filter((x) => !x.until || x.until > t);
  }
  function memberNoteFor(key, ids, name = "") {
    const f = ids?.length ? findMember(key, ids) : null;
    if (!f) return "";
    const facts = liveFacts(f.m);
    if (!facts.length && !f.m.nick) return "";
    const who = callName(key, ids, name);
    const asked = facts.filter((x) => !x.auto).map((x) => x.t);
    const told = facts.filter((x) => x.auto).map((x) => x.t);
    const bits = [];
    if (asked.length) bits.push(`hal ringan yang ${who} minta kamu ingat: ${asked.join("; ")}`);
    if (told.length) bits.push(`hal ringan yang ${who} ceritakan sendiri di grup: ${told.join("; ")}`);
    const aw = f.m.away;
    if (aw && now() - aw.at <= 30 * 60_000 && aw.days >= 3 && aw.days <= 90) bits.push(`${who} baru muncul lagi setelah sekitar ${aw.days} hari tidak terlihat ngobrol (boleh disapa hangat singkat bila pas, jangan menginterogasi)`);
    if (!bits.length) return "";
    return `Yang kamu ingat tentang orang ini (pakai HANYA bila nyambung dengan obrolan, sesekali saja, jangan dipaksakan dan jangan menyebut bahwa kamu "mencatat"): ${bits.join(". ")}.`;
  }
  /** Catat hal ringan yang anggota ceritakan tentang dirinya sendiri (hanya bila /humor ingat on; yang pernah "lupakan aku" dilewati). */
  function learnFacts(key, ids, name, clean) {
    if (data.nolearn[key]?.some((x) => ids.includes(x))) return;
    const t = now();
    let f = findMember(key, ids);
    if (f) {
      // lupakan yang kedaluwarsa & yang tak pernah disinggung lagi terlalu lama
      const before = (f.m.facts || []).length;
      f.m.facts = (f.m.facts || []).filter((x) => (!x.until || x.until > t) && (!x.auto || t - (x.ts || t) <= config.ingatHari * 86_400_000));
      if (f.m.facts.length !== before) dirty.data = true;
      if (!f.m.lastChat || t - f.m.lastChat > 3_600_000) {
        if (f.m.lastChat && t - f.m.lastChat >= 3 * 86_400_000) f.m.away = { days: daysSince(f.m.lastChat, t), at: t }; // baru muncul lagi setelah lama
        f.m.lastChat = t;
        dirty.data = true;
      }
    }
    const found = extractSelfFacts(clean);
    if (!found.length) return;
    if (!f) {
      const all = (data.members[key] ||= {});
      const mid = ids[0];
      all[mid] = { ids: ids.slice(0, 3), name: String(name || "").slice(0, 40), facts: [], nick: "", birthday: null, bdayYear: 0, lastChat: t };
      f = { mid, m: all[mid] };
    }
    for (const x of found) {
      const dup = f.m.facts.find((y) => y.t.toLowerCase() === x.t.toLowerCase());
      if (dup) {
        dup.ts = t;
        if (x.ttlDays) dup.until = t + x.ttlDays * 86_400_000;
        continue;
      }
      f.m.facts.push({ t: x.t, ts: t, auto: true, ...(x.ttlDays ? { until: t + x.ttlDays * 86_400_000 } : {}) });
    }
    // batas: fakta permintaan sendiri tidak terdorong keluar oleh yang otomatis
    const asked = f.m.facts.filter((x) => !x.auto);
    const auto = f.m.facts.filter((x) => x.auto).slice(-Math.max(1, MEMORY_MAX_FACTS - 1));
    f.m.facts = [...asked, ...auto].slice(-(MEMORY_MAX_FACTS + 2));
    f.m.name = String(name || f.m.name || "").slice(0, 40);
    dirty.data = true;
  }
  async function handleMember(account, jid, { name = "", ids = [], mc }) {
    const key = keyOf(account, jid);
    const first = firstName(name);
    const all = (data.members[key] ||= {});
    let f = findMember(key, ids);
    const ensure = () => {
      if (f) return f;
      const mid = ids[0];
      all[mid] = { ids: ids.slice(0, 3), name: String(name || "").slice(0, 40), facts: [], nick: "", birthday: null, bdayYear: 0 };
      f = { mid, m: all[mid] };
      return f;
    };
    let reply;
    if ((mc.cmd === "remember" || mc.cmd === "nick") && data.nolearn[key]?.some((x) => ids.includes(x))) {
      data.nolearn[key] = data.nolearn[key].filter((x) => !ids.includes(x));
      if (!data.nolearn[key].length) delete data.nolearn[key];
    }
    if (mc.cmd === "show") {
      const m = f?.m;
      const parts = [];
      if (m?.nick) parts.push(`panggilanmu "${m.nick}"`);
      if (m?.birthday) parts.push(`ulang tahunmu ${m.birthday.d}/${m.birthday.m}`);
      if (m?.facts?.length) parts.push(m.facts.filter((x) => !x.until || x.until > now()).map((x) => `"${x.t}"${x.auto ? " (kamu cerita sendiri)" : ""}`).join(", "));
      return { pref: "memory", reply: parts.length ? `${first}, yang kuingat: ${parts.join("; ")}. (Hapus semua: "bot lupakan aku")` : `${first}, belum ada yang kuingat tentangmu. Mau? Tulis mis. "bot ingat aku suka kopi hitam".` };
    }
    if (mc.cmd === "forget") {
      if (f) delete all[f.mid];
      if (!Object.keys(all).length) delete data.members[key];
      // setelah "lupakan aku", bot juga berhenti mencatat hal ringan dari ceritamu sampai kamu sendiri minta diingat lagi
      const nl = new Set(data.nolearn[key] || []);
      for (const id of ids) nl.add(id);
      data.nolearn[key] = [...nl].slice(-200);
      await saveData();
      return { pref: "memory", reply: `Beres ${first}, semua yang kuingat tentangmu sudah kuhapus dan aku tidak akan mencatat lagi 🙏 (mau diingat lagi: "bot ingat aku ...")` };
    }
    if (mc.cmd === "nick") {
      const nick = mc.nick.replace(/\s+/g, " ").trim();
      if (nick.length < 2 || nick.length > 20 || hasBannedWord(nick) || /\d{4,}/.test(nick)) return { pref: "memory", reply: `Hmm, panggilan itu kurang cocok ${first}. Coba yang lain ya.` };
      ensure().m.nick = nick;
      f.m.name = String(name || f.m.name || "").slice(0, 40);
      reply = `Siap, mulai sekarang kupanggil kamu ${nick} 😄`;
    } else {
      const bday = parseBirthday(mc.fact);
      if (bday) {
        ensure().m.birthday = bday;
        f.m.name = String(name || f.m.name || "").slice(0, 40);
        reply = `Oke ${first}, ulang tahunmu ${bday.d}/${bday.m} kucatat. Nanti kuucapkan selamat 🎂 (hapus kapan saja: "bot lupakan aku")`;
      } else {
        const v = sanitizeFact(mc.fact);
        if (!v.ok) return { pref: "memory", reply: v.reason === "sensitif" ? `Maaf ${first}, ${MEMORY_REFUSE_TEXT}.` : `Tulis tentang dirimu sendiri ya ${first}, mis. "bot ingat aku suka kopi hitam".` };
        ensure();
        f.m.facts = [...(f.m.facts || []), { t: v.text, ts: now() }].slice(-MEMORY_MAX_FACTS);
        f.m.name = String(name || f.m.name || "").slice(0, 40);
        reply = `Siap ${first}, kuingat: "${v.text}" 👌 (hapus kapan saja: "bot lupakan aku")`;
      }
    }
    const saved = await saveData();
    return { pref: "memory", reply: `${reply}${saved ? "" : " — catatan: gagal tersimpan, berlaku sampai bot restart."}` };
  }
  const dayOf = () => localParts(now(), timeZone).day;
  const inWindow = (win, minutes) => minutes >= win.from && minutes < win.to;
  const isNight = (minutes) => inNightWindow(minutes, config.tidurWindow); // jam tidur: tidak membuka obrolan, membalas hanya saat ramai
  const sapaOpen = (minutes) => inWindow(config.sapaWindow, minutes) && !isNight(minutes);

  // ------------------------------------------------ gaya jawaban
  /** Catatan prompt gaya humoris untuk jawaban ini, atau "" (mati / topik serius / jawaban berupa berkas). */
  function chatNote(account, jid, { text = "", serious = null } = {}) {
    const g = settings(account, jid);
    if (!g?.chat) return "";
    if (serious ?? isSeriousChat([{ text }])) return "";
    return HUMOR_CHAT_NOTE;
  }

  // ------------------------------------------------ penolakan roasting
  const optedOut = (key, ids) => (data.optout[key] || []).some((x) => ids.includes(x));

  /**
   * Pesan "bot jangan roasting aku" / "bot boleh roasting aku lagi". -> { reply } bila ditangani (jangan diteruskan ke AI), selain itu null.
   * Hanya berlaku di grup yang pengaturan humornya menyala.
   */
  async function handlePreference(account, jid, { name = "", ids = [], text = "" }) {
    const g = settings(account, jid);
    if (!g || !ids.length) return null;
    const key = keyOf(account, jid);
    const mc = parseMemoryCmd(text);
    if (mc && ids.length) return await handleMember(account, jid, { name, ids, mc });
    const rpref = detectReplyPref(text);
    if (rpref) {
      const nl = new Set(data.noreply[key] || []);
      const first0 = String(name || "").trim().split(/\s+/)[0] || "kamu";
      if (rpref === "out") {
        for (const id of ids) nl.add(id);
        data.noreply[key] = [...nl];
        const saved = await saveData();
        return { pref: "noreply", reply: `Siap ${first0}, chatmu tidak akan kubalas-balas sendiri lagi 🙏 (kalau berubah pikiran: "bot boleh balas chatku lagi")${saved ? "" : " — catatan: gagal tersimpan, berlaku sampai bot restart."}` };
      }
      for (const id of ids) nl.delete(id);
      if (nl.size) data.noreply[key] = [...nl];
      else delete data.noreply[key];
      await saveData();
      return { pref: "reply-ok", reply: `Oke ${first0}, aku boleh nimbrung lagi di chatmu ya 😄` };
    }
    const pref = detectRoastPref(text);
    if (!pref) return null;
    const list = new Set(data.optout[key] || []);
    const first = String(name || "").trim().split(/\s+/)[0] || "kamu";
    if (pref === "out") {
      for (const id of ids) list.add(id);
      data.optout[key] = [...list];
      const saved = await saveData();
      return { pref, reply: `Siap ${first}, kamu kubebaskan dari roasting 🙏 (kalau berubah pikiran: "bot boleh roasting aku lagi")${saved ? "" : " — catatan: gagal tersimpan, berlaku sampai bot restart."}` };
    }
    for (const id of ids) list.delete(id);
    if (list.size) data.optout[key] = [...list];
    else delete data.optout[key];
    await saveData();
    return { pref, reply: `Oke ${first}, kamu kumasukkan lagi ke daftar candaan — yang ringan-ringan saja ya 😄` };
  }

  // ------------------------------------------------ roasting spontan
  /** Bot dipanggil/menjawab di grup ini: jangan langsung bercanda sesudahnya; buang obrolan yang tersimpan. */
  function noteTriggered(account, jid) {
    const key = keyOf(account, jid);
    lastTriggerAt.set(key, now());
    buffers.delete(key);
  }

  function roastToday(key) {
    const day = localParts(now(), timeZone).day;
    const r = sched.roast[key];
    return r && r.day === day ? r : { day, count: 0, lastAt: r?.lastAt || 0, lastTarget: r?.lastTarget || [] };
  }

  /** Layakkah menggoda sekarang? -> { ok: true, target } | { ok: false, reason } (tanpa efek samping). */
  function evaluate(account, jid, { ignoreChance = false } = {}) {
    const key = keyOf(account, jid);
    const g = settings(account, jid);
    if (!g?.roast) return { ok: false, reason: "roast mati" };
    if (muted(key)) return { ok: false, reason: "sedang didiamkan pemilik" };
    if (config.roastMaxPerDay <= 0) return { ok: false, reason: "jatah 0" };
    const t = now();
    const lp = localParts(t, timeZone);
    if (lp.minutes < config.roastWindow.from || lp.minutes >= config.roastWindow.to) return { ok: false, reason: "di luar jam aktif" };
    const rs = roastToday(key);
    if (rs.count >= config.roastMaxPerDay) return { ok: false, reason: "jatah hari ini habis" };
    if (t - rs.lastAt < config.roastCooldownMs) return { ok: false, reason: "masih dalam jeda" };
    if (t - (lastTriggerAt.get(key) || 0) < config.afterTriggerMs) return { ok: false, reason: "bot baru saja dipanggil" };
    if (t - (lastSpontAt.get(key) || 0) < config.afterSpontMs) return { ok: false, reason: "bot baru saja bicara sendiri" };
    const buf = (buffers.get(key) || []).filter((m) => t - m.ts <= config.bufferMaxAgeMs);
    if (buf.length < config.minMessages) return { ok: false, reason: "belum ramai" };
    if (new Set(buf.map((m) => m.ids[0] || m.name)).size < 2) return { ok: false, reason: "hanya satu orang" };
    const last = buf[buf.length - 1];
    if (t - last.ts > config.freshMs) return { ok: false, reason: "obrolan sudah lewat" };
    const recent = buf.slice(-6);
    if (isSeriousChat(recent)) return { ok: false, reason: "obrolan serius" };
    if (!hasCasualCue(recent)) return { ok: false, reason: "belum terdengar santai" };
    // Sasaran: pengirim terakhir; kalau menolak/pemilik/baru saja digoda, mundur ke pengirim sebelumnya.
    let target = null;
    for (let i = buf.length - 1; i >= Math.max(0, buf.length - 4); i -= 1) {
      const m = buf[i];
      if (optedOut(key, m.ids)) continue;
      if (m.isOwner && !config.roastOwner) continue;
      if ((rs.lastTarget || []).some((x) => m.ids.includes(x))) continue;
      if (m.text.length < 3) continue;
      target = m;
      break;
    }
    if (!target) return { ok: false, reason: "tidak ada sasaran yang pantas" };
    if (!ignoreChance && random() >= config.roastChance) return { ok: false, reason: "tidak terpilih (acak)" };
    return { ok: true, target: { name: target.name || "kamu", ids: target.ids, msg: target.msg, text: target.text }, recent: recent.map((m) => ({ name: m.name || "?", text: m.text })) };
  }

  /**
   * Dipanggil untuk tiap pesan grup (yang memanggil bot diberi triggered=true: hanya dicatat sebagai konteks, tidak dibalas/diroast).
   * Murah: bila roast/balas/sapa semuanya mati, tidak menyimpan apa pun.
   */
  function observe(account, jid, { name = "", ids = [], text = "", isOwner = false, msg = null, triggered = false, repliedToBot = false, quotedOther = false, quotedText = "" } = {}) {
    const g = settings(account, jid);
    if (!g || !(g.roast || g.balas || g.sapa)) return null;
    const clean = String(text ?? "").replace(/@\d{5,}/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return null;
    const key = keyOf(account, jid);
    if (g.ingat && ids.length) learnFacts(key, ids, name, clean);
    let entry = null;
    if (g.balas || g.sapa) {
      entry = { name, ids: ids.filter(Boolean), text: clean.slice(0, 240), ts: now(), isBot: false, isOwner, msg, quotedOther: Boolean(quotedOther), quoted: String(quotedText || "").replace(/\s+/g, " ").slice(0, 160) };
      pushCtx(key, entry);
      updateStyle(styleOf(key), clean); // hanya menaikkan hitungan gaya; teksnya tidak disimpan
      dirty.style = true;
      noteEngagement(key, { repliedToBot });
    }
    if (triggered) return { ok: false, reason: "bot dipanggil" };
    const r = g.roast ? observeRoast(account, jid, { name, ids, clean, isOwner, msg }) : null;
    if (r?.ok) return r; // roast terjadwal: jangan menumpuk dengan balasan biasa
    if (g.balas && entry) {
      const b = scheduleBalas(account, jid, entry);
      if (b?.ok) return b;
      const rx = maybeReact(account, jid, entry);
      if (rx) return rx;
      if (b) return b;
    }
    return r;
  }

  function observeRoast(account, jid, { name, ids, clean, isOwner, msg }) {
    const key = keyOf(account, jid);
    const buf = buffers.get(key) || [];
    buf.push({ name, ids: ids.filter(Boolean), text: clean.slice(0, 240), ts: now(), isOwner, msg });
    while (buf.length > config.bufferSize) buf.shift();
    buffers.set(key, buf);
    const ev = evaluate(account, jid);
    if (!ev.ok) return ev;
    if (busy.has(`roast|${key}`)) return { ok: false, reason: "sedang menyusun" };
    busy.add(`roast|${key}`);
    const delay = 4000 + Math.floor(random() * 14_000); // jeda alami 4-18 detik
    timer(() => {
      roastNow(account, jid).catch((e) => log.warn?.(`😄 [Humor] roast gagal: ${e instanceof Error ? e.message : e}`)).finally(() => busy.delete(`roast|${key}`));
    }, delay);
    return { ok: true, scheduled: true, target: ev.target.name };
  }

  /** Susun dan kirim satu roast. -> true bila terkirim. */
  async function roastNow(account, jid) {
    const key = keyOf(account, jid);
    // cek ulang setelah jeda: mungkin ada yang memanggil bot atau jatah sudah terpakai
    const again = evaluate(account, jid, { ignoreChance: true });
    if (!again.ok) {
      log.log?.(`😄 [Humor] roast dibatalkan: ${again.reason}`);
      return false;
    }
    const target = again.target;
    if (!ai || !send) return false;
    const { system, user } = buildRoastPrompt({ target, messages: again.recent });
    let text = null;
    for (let i = 0; i < 2 && !text; i += 1) {
      let raw = "";
      try {
        raw = await ai({ system, user, temperature: 0.9, maxTokens: 90 });
      } catch (e) {
        log.warn?.(`😄 [Humor] AI roast gagal: ${e instanceof Error ? e.message : e}`);
        return false;
      }
      const v = validateRoast(raw, { targetName: target.name });
      if (v.ok) text = v.text;
      else {
        log.log?.(`😄 [Humor] roast ditolak penyaring (${v.reason}): ${String(raw).slice(0, 80)}`);
        if (v.reason === "AI memilih SKIP") break;
      }
    }
    if (!text) return false;
    // masih layak setelah menunggu AI?
    const last = evaluate(account, jid, { ignoreChance: true });
    if (!last.ok) return false;
    await out(account, jid, text, { quoted: target.msg || null }, "roast");
    const rs = roastToday(key);
    sched.roast[key] = { day: rs.day, count: rs.count + 1, lastAt: now(), lastTarget: target.ids.slice(0, 3) };
    buffers.delete(key);
    await saveSched();
    log.log?.(`😄 [Humor] roast terkirim ke ${target.name} (${rs.count + 1}/${config.roastMaxPerDay} hari ini).`);
    return true;
  }

  // ------------------------------------------------ balas chat acak (reply) setelah membaca konteks
  function balasToday(key) {
    const day = dayOf();
    const r = sched.balas[key];
    return r && r.day === day ? r : { day, count: 0 };
  }

  const GROUP_ASK_RE = /\b(ada yang|siapa|menurut kalian|teman-teman|guys|gaes|semua(?:nya)?|kalian|rek|ada yg)\b/i;
  /** Suasana hati hari ini x ritme jam x kelelahan untuk grup ini (semua 1 bila WA_ENERGI_HARIAN=off). */
  function energyNow(key, t = now()) {
    if (!config.energi) return { e: { level: "biasa", chance: 1, gap: 1, delay: 1, hint: "" }, chance: 1, gap: 1, delay: 1, hour: 1, fatigue: 1 };
    const lp = localParts(t, timeZone);
    const e = dayEnergy(key, lp.day);
    const recent = (spontTimes.get(key) || []).filter((x) => t - x <= 30 * 60_000).length;
    return { e, chance: e.chance, gap: e.gap, delay: e.delay, hour: hourFactor(lp.minutes), fatigue: fatigueFactor(recent) };
  }

  /** Layakkah membalas pesan `entry` sekarang? -> { ok: true, context, mood } | { ok: false, reason } (tanpa efek samping). */
  function evaluateBalas(account, jid, entry, { ignoreChance = false } = {}) {
    const key = keyOf(account, jid);
    const g = settings(account, jid);
    if (!g?.balas) return { ok: false, reason: "balas mati" };
    if (muted(key)) return { ok: false, reason: "sedang didiamkan pemilik" };
    const t = now();
    if (!inWindow(config.balasWindow, localParts(t, timeZone).minutes)) return { ok: false, reason: "di luar jam aktif" };
    const isQ = Boolean(config.tanyaOn && !entry.media && isGroupQuestion(entry.text)); // pertanyaan di grup: dijawab walau bot tidak di-mention
    if (!isQ && config.balasMaxPerDay > 0 && balasToday(key).count >= config.balasMaxPerDay) return { ok: false, reason: "jatah hari ini habis" };
    const en = energyNow(key, t);
    const lb = lastBalasTo.get(key);
    const followUp = Boolean(lb && config.followUpMax > 0 && lb.depth <= config.followUpMax && t - lb.ts <= config.followUpMs && (entry.ids || []).some((id) => lb.ids.includes(id)));
    const gapNeed = jitterGap(config.balasGapMs, lastSpontAt.get(key) || 0) * en.gap;
    if (isQ ? t - (lastSpontAt.get(key) || 0) < config.tanyaGapMs : !followUp && t - (lastSpontAt.get(key) || 0) < gapNeed) return { ok: false, reason: "bot baru saja bicara" };
    if (t - (lastTriggerAt.get(key) || 0) < 60_000) return { ok: false, reason: "bot baru saja dipanggil" };
    if (!(entry.media ? entry.media.kind === "gambar" || Boolean(entry.media.tag) : isQ || isReplyWorthy(entry.text))) return { ok: false, reason: "pesan tidak layak dibalas" };
    if ((data.noreply[key] || []).some((id) => entry.ids.includes(id))) return { ok: false, reason: "orang ini menolak dibalas" };
    const context = contextBefore(key, entry);
    if (!context.length) return { ok: false, reason: "belum ada konteks" };
    const humans = context.filter((m) => !m.isBot).slice(-5);
    if (isQ) {
      // pertanyaan biasa ("gimana cara ...?", "tolong ...") boleh dijawab; hanya topik berat (duka, sakit, uang, konflik) atau kata terlarang yang membuat bot diam
      if (isGraveTopic(entry.text) || hasBannedWord(entry.text) || humans.slice(-3).some((m) => isGraveTopic(m.text))) return { ok: false, reason: "topik berat: bot memilih diam" };
    } else if (isSeriousChat([...humans, entry])) return { ok: false, reason: "obrolan serius" };
    const mood = detectMood(entry.text);
    if (SILENT_MOODS.has(mood) || humans.slice(-3).some((m) => SILENT_MOODS.has(detectMood(m.text)))) return { ok: false, reason: "suasana sedih/kesal: bot memilih diam" };
    if (entry.media?.tag === "sedih" || entry.media?.tag === "kesal") return { ok: false, reason: "stiker sedih/kesal: bot memilih diam" };
    if (addressedToOther(entry.text, humans.filter((m) => m !== entry).map((m) => m.name))) return { ok: false, reason: "pesan ditujukan ke orang lain" };
    const night = isNight(localParts(t, timeZone).minutes);
    if (night) {
      // jam tidur: hanya ikut menimpali kalau memang sedang ada obrolan ramai (bukan membangunkan grup yang sepi)
      const live = (ctxBuf.get(key) || []).filter((m) => !m.isBot && t - m.ts <= 10 * 60_000);
      if (live.length < 4 || new Set(live.map((m) => m.ids[0] || m.name)).size < 2) return { ok: false, reason: "jam tidur & obrolan sepi" };
    }
    if (isQ && ignoreChance) {
      // pertanyaan sudah ramai dijawab orang lain selama bot menunggu: bot tidak ikut menjawab
      const buf = ctxBuf.get(key) || [];
      const idx = buf.indexOf(entry);
      const others = idx >= 0 ? buf.slice(idx + 1).filter((m) => !m.isBot && !(m.ids || []).some((id) => (entry.ids || []).includes(id))) : [];
      if (others.length >= 3) return { ok: false, reason: "pertanyaan sudah dijawab orang lain" };
    }
    if (isQ && !ignoreChance) {
      const duoQ = isDuoChat([...humans, entry].filter((m) => !m.isBot), entry.text);
      const toOtherQ = Boolean(entry.quotedOther) && !GROUP_ASK_RE.test(entry.text);
      const pQ = Math.min(0.95, config.tanyaChance * (night ? config.tidurBalasFactor : 1) * (en.e.level === "kalem" ? 0.9 : 1) * (duoQ ? 0.35 : 1) * (toOtherQ ? 0.15 : 1));
      if (random() >= pQ) return { ok: false, reason: toOtherQ ? "pertanyaan ini untuk orang yang dibalas" : duoQ ? "dua orang sedang ngobrol berdua" : "tidak terpilih (acak)" };
    } else if (!ignoreChance) {
      const duo = isDuoChat([...humans, entry].filter((m) => !m.isBot), entry.text);
      const rr = (repliedRecent.get(key) || []).filter((x) => t - x.ts <= 20 * 60_000);
      const sameRecent = !followUp && rr.some((x) => (entry.ids || []).includes(x.id));
      const fairness = sameRecent ? 0.5 : rr.length >= 2 && !rr.some((x) => (entry.ids || []).includes(x.id)) ? 1.25 : 1;
      const mediaF = entry.media?.kind === "gambar" ? config.fotoBalasFactor : entry.media ? config.stikerTeksFactor : 1;
      const base = followUp
        ? config.followUpChance * (night ? config.tidurBalasFactor : 1)
        : (night ? config.tidurBalasFactor : 1) * mediaF * config.balasChance * (/\?/.test(entry.text) ? 1.8 : 1) * (hasCasualCue([entry]) ? 1.3 : 1) * (duo ? 0.35 : 1) * balasEngagementFactor(fbOf(key));
      const toOther = Boolean(entry.quotedOther) && !GROUP_ASK_RE.test(entry.text);
      const p = replyChance(base, { energy: en.chance, hour: en.hour, fatigue: en.fatigue, fairness, toOther });
      if (random() >= p) return { ok: false, reason: toOther ? "pesan ini menjawab orang lain" : duo ? "dua orang sedang ngobrol berdua" : "tidak terpilih (acak)" };
    }
    return { ok: true, context, mood, followUp, energy: en.e, question: isQ };
  }

  function scheduleBalas(account, jid, entry) {
    const key = keyOf(account, jid);
    const ev = evaluateBalas(account, jid, entry);
    if (!ev.ok) return ev;
    if (busy.has(`balas|${key}`) || busy.has(`sapa|${key}`) || busy.has(`roast|${key}`)) return { ok: false, reason: "sedang menyusun" };
    busy.add(`balas|${key}`);
    // jeda manusiawi: "membaca" dulu (lebih lama untuk pesan panjang) + sedikit acak; grup yang sedang ramai dibalas lebih cepat
    const recentBurst = (ctxBuf.get(key) || []).filter((m) => !m.isBot && now() - m.ts < 60_000).length;
    const read = Math.min(9000, entry.text.length * 60);
    const delay = Math.max(2500, Math.round((3000 + read + Math.floor(random() * 8000) - (recentBurst >= 6 ? 3000 : 0)) * energyNow(key).delay));
    timer(() =>
      balasNow(account, jid, entry)
        .catch((e) => log.warn?.(`💬 [Humor] balasan gagal: ${e instanceof Error ? e.message : e}`))
        .finally(() => busy.delete(`balas|${key}`)), delay);
    return { ok: true, scheduled: true, kind: "balas", target: entry.name };
  }

  // ------------------------------------------------ melihat: baca gambar & stiker, balas dengan stiker (hanya bila /humor lihat on)
  const visionReady = () => Boolean(media && typeof media.vision === "function" && typeof media.fetch === "function" && (typeof media.visionAvailable === "function" ? media.visionAvailable() : true));
  const stickerFile = (key, id) => `${createHash("sha1").update(key).digest("hex").slice(0, 8)}_${id}.webp`;

  function visionToday(key) {
    const day = dayOf();
    const r = sched.vision[key];
    return r && r.day === day ? r : { day, count: 0 };
  }
  /** Masih ada jatah panggilan AI penglihatan hari ini? reserve = bagian jatah yang disisakan untuk keperluan lain (0..1). */
  function visionBudget(key, reserve = 0) {
    return visionToday(key).count < Math.floor(config.visiPerDay * (1 - reserve));
  }
  function spendVision(key) {
    const v = visionToday(key);
    sched.vision[key] = { day: v.day, count: v.count + 1 };
  }

  /** Isi `entry.media.desc` (deskripsi 1 kalimat) lewat AI penglihatan. Gambar tidak disimpan. -> { ok } | { ok: false, reason } */
  async function ensureDescribed(key, entry) {
    const m = entry.media;
    if (!m || m.kind !== "gambar") return { ok: true };
    if (m.desc) return { ok: true };
    if (m.blocked) return { ok: false, reason: "gambar sensitif" };
    if (!visionReady()) return { ok: false, reason: "AI penglihatan belum tersedia" };
    if (!m.ref) return { ok: false, reason: "pesan gambar sudah tidak tersedia" };
    if (!visionBudget(key)) return { ok: false, reason: "jatah baca gambar hari ini habis" };
    spendVision(key);
    let got = null;
    try {
      got = await media.fetch(m.ref, "gambar");
    } catch (e) {
      log.warn?.(`👁️ [Humor] gagal mengunduh gambar: ${e instanceof Error ? e.message : e}`);
    }
    if (!got?.buffer) return { ok: false, reason: "gambar tidak bisa diunduh" };
    let raw = "";
    try {
      raw = await media.vision({ system: IMAGE_SYSTEM, user: buildImageUserPrompt(m.caption), image: { buffer: got.buffer, mime: got.mime || "image/jpeg" } });
    } catch (e) {
      log.warn?.(`👁️ [Humor] AI penglihatan gagal: ${e instanceof Error ? e.message : e}`);
      return { ok: false, reason: "AI penglihatan gagal" };
    } finally {
      m.ref = null;
    }
    const d = cleanImageDescription(raw);
    if (!d.ok) {
      if (d.reason === "sensitif") m.blocked = true;
      return { ok: false, reason: d.reason === "sensitif" ? "gambar sensitif" : `deskripsi ditolak (${d.reason})` };
    }
    m.desc = d.desc;
    entry.text = `[foto: ${d.desc}]${m.caption ? ` ${m.caption}` : ""}`.slice(0, 240);
    return { ok: true };
  }

  /** Teks petunjuk untuk pembalas: pesan yang dibalas adalah foto. */
  const photoHint = (entry) =>
    entry.media?.kind === "gambar"
      ? " Pesan yang dibalas adalah FOTO (isinya ada di tanda [foto: ...]). Komentari isi foto itu secara singkat dan hangat; jangan menebak hal yang tidak ada di deskripsi dan jangan menyebut nama orang di foto."
      : entry.media
        ? " Pesan yang dibalas adalah STIKER (maknanya ada di tanda [stiker: ...]). Tanggapi perasaan/maksudnya seperti teman, satu kalimat pendek; jangan menjelaskan isi stikernya."
        : "";

  /** Anggota mengirim gambar/stiker. Dicatat sebagai konteks; gambar bisa dibalas, stiker bisa dibalas stiker. */
  function observeMedia(account, jid, { name = "", ids = [], kind = "gambar", caption = "", isOwner = false, msg = null, repliedToBot = false, triggered = false } = {}) {
    const g = settings(account, jid);
    if (!g?.lihat || !(g.balas || g.sapa) || !media) return null;
    const key = keyOf(account, jid);
    const cap = String(caption ?? "").replace(/@\d{5,}/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    const isSticker = kind === "stiker";
    const entry = { name, ids: ids.filter(Boolean), text: isSticker ? "[stiker]" : cap ? `[foto] ${cap}` : "[foto]", ts: now(), isBot: false, isOwner, msg, media: { kind: isSticker ? "stiker" : "gambar", caption: cap, desc: null, tag: "", ref: msg } };
    pushCtx(key, entry);
    noteEngagement(key, { repliedToBot });
    if (triggered) return { ok: false, reason: "bot dipanggil" };
    if (!g.balas) return { ok: false, reason: "balas mati" };
    if (isSticker) {
      if (busy.has(`stiker|${key}`) || !visionReady()) return { ok: false, reason: busy.has(`stiker|${key}`) ? "sedang menyusun" : "AI penglihatan belum tersedia" };
      busy.add(`stiker|${key}`);
      processSticker(account, jid, key, entry, { repliedToBot })
        .catch((e) => log.warn?.(`🎭 [Humor] stiker gagal diproses: ${e instanceof Error ? e.message : e}`))
        .finally(() => busy.delete(`stiker|${key}`));
      return { ok: true, scheduled: true, kind: "stiker" };
    }
    return scheduleBalas(account, jid, entry);
  }

  /** Simpan stiker ke perpustakaan grup, beri label (sekali), lalu mungkin membalas dengan stiker. */
  async function processSticker(account, jid, key, entry, { repliedToBot = false } = {}) {
    if (!media.store) return;
    const noreply = (data.noreply[key] || []).some((id) => entry.ids.includes(id));
    if (noreply) return; // anggota yang menolak dibalas: stikernya tidak disimpan/dibaca
    const got = await media.fetch(entry.media.ref, "stiker").catch(() => null);
    entry.media.ref = null;
    if (!got?.buffer || got.buffer.length > config.stikerMaxBytes) return;
    const id = createHash("sha1").update(got.buffer).digest("hex").slice(0, 16);
    const lib = (stickers[key] ||= []);
    const r = addToLibrary(lib, { id, ts: now() }, config.stikerLibMax);
    if (r.added) {
      try {
        await media.store.put(stickerFile(key, id), got.buffer);
      } catch (e) {
        lib.splice(lib.findIndex((x) => x.id === id), 1);
        throw e;
      }
      if (r.evicted) await media.store.del?.(stickerFile(key, r.evicted.id)).catch(() => {});
    }
    dirty.stiker = true;
    const item = lib.find((x) => x.id === id);
    // label (sekali per stiker); sisakan sebagian jatah untuk membaca foto. Gagal berulang -> berhenti mencoba sementara (hemat jatah).
    const retryOk = (item.fail || 0) < 3 || now() - (item.failAt || 0) > 6 * 3_600_000;
    if (!item.tag && retryOk) {
      if (!visionBudget(key, 0.3)) stickerErr.set(key, "jatah baca gambar/stiker hari ini habis (WA_LIHAT_PER_DAY)");
      else {
        spendVision(key);
        const fail = (why) => {
          item.fail = (item.fail || 0) + 1;
          item.failAt = now();
          dirty.stiker = true;
          stickerErr.set(key, why);
          log.warn?.(`🎭 [Humor] stiker belum bisa dilabeli: ${why}`);
        };
        try {
          const frame = webpFirstFrame(got.buffer); // stiker animasi: pakai bingkai pertama saja
          const raw = await media.vision({ system: STICKER_SYSTEM, user: "Stiker ini dikirim di grup. Beri label dan deskripsinya.", image: { buffer: frame.buffer, mime: "image/webp" } });
          const t = parseStickerTag(raw);
          if (t?.sensitive) {
            lib.splice(lib.findIndex((x) => x.id === id), 1); // stiker tidak pantas: tidak disimpan & tidak dipakai
            await media.store.del?.(stickerFile(key, id)).catch(() => {});
            dirty.stiker = true;
            await saveSched();
            return;
          }
          if (t) {
            item.tag = t.tag;
            item.desc = t.desc;
            item.fail = 0;
            stickerErr.delete(key);
          } else fail(`jawaban AI tidak bisa dibaca sebagai label: "${String(raw ?? "").replace(/\s+/g, " ").slice(0, 80)}"`);
        } catch (e) {
          fail(`AI penglihatan gagal: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 120)}`);
        }
      }
      await saveSched();
    }
    if (item.tag) {
      entry.media.tag = item.tag;
      entry.text = `[stiker${item.desc ? `: ${item.desc}` : ""}]`.slice(0, 240);
    }
    log.log?.(`🎭 [Humor] stiker dari ${entry.name || "?"} dibaca: ${item.tag ? `${item.tag}${item.desc ? ` — ${item.desc}` : ""}` : "(label gagal)"} • perpustakaan ${lib.length} stiker.`);
    const sr = await considerStickerReply(account, jid, key, entry, item, { repliedToBot });
    if (sr.sent || !item.tag) return;
    // tidak membalas dengan stiker: kadang cukup bereaksi emoji, atau menanggapi dengan satu kalimat
    if (!maybeReactSticker(account, jid, entry, item.tag)) scheduleBalas(account, jid, entry);
  }

  /** Reaksi emoji untuk stiker berlabel (tanpa AI). */
  function maybeReactSticker(account, jid, entry, tag) {
    const emoji = STICKER_REACTION[tag];
    if (!emoji) return null; // sedih/kesal tidak punya emoji: bot diam
    return maybeReact(account, jid, entry, emoji);
  }

  function stikerToday(key) {
    const day = dayOf();
    const r = sched.stiker[key];
    return r && r.day === day ? r : { day, count: 0 };
  }

  // ------------------------------------------------ koleksi stiker pemilik + mengirim stiker
  const kolKey = (account) => `koleksi|${account === SECOND ? SECOND : MAIN}`;

  /** Stiker yang boleh dipakai bot di grup ini: koleksi pemilik (selalu) + stiker yang dipelajari di grup itu (bila /humor lihat on). */
  function stickerPool(account, key) {
    const g = data.groups[key];
    const sources = [[kolKey(account), stickers[kolKey(account)]]];
    if (g?.lihat) sources.push([key, stickers[key]]);
    const seen = new Set();
    const out = [];
    for (const [libKey, lib] of sources) {
      for (const it of lib || []) {
        if (!it.tag || seen.has(it.id)) continue;
        seen.add(it.id);
        out.push({ id: it.id, tag: it.tag, desc: it.desc, uses: it.uses || 0, _item: it, _file: stickerFile(libKey, it.id) });
      }
    }
    return out;
  }

  /** Syarat umum mengirim stiker ke grup (tanpa peluang acak). -> { ok } | { ok: false, reason } */
  function stickerGate(account, jid, { repliedToBot = false } = {}) {
    const key = keyOf(account, jid);
    const g = settings(account, jid);
    if (!g?.balas) return { ok: false, reason: "balas mati" };
    if (g.latihan) return { ok: false, reason: "mode latihan: stiker tidak dikirim otomatis" };
    if (muted(key)) return { ok: false, reason: "sedang didiamkan pemilik" };
    if (!media?.sendSticker || !media?.store || config.stikerMaxPerDay < 0) return { ok: false, reason: "pengiriman stiker mati" };
    const t = now();
    if (isNight(localParts(t, timeZone).minutes) && !repliedToBot) return { ok: false, reason: "jam tidur" };
    if (config.stikerMaxPerDay > 0 && stikerToday(key).count >= config.stikerMaxPerDay) return { ok: false, reason: "jatah stiker hari ini habis" };
    if (t - (lastStickerAt.get(key) || 0) < config.stikerGapMs) return { ok: false, reason: "baru saja mengirim stiker" };
    if (t - (lastTriggerAt.get(key) || 0) < 60_000) return { ok: false, reason: "bot baru saja dipanggil" };
    return { ok: true };
  }

  /** Kirim satu stiker dari pool + catat pemakaian. -> { sent, id? , reason? } */
  async function sendPicked(account, jid, key, pick, quoted = null) {
    const buffer = await media.store.get(pick._file);
    if (!buffer) return { sent: false, reason: "berkas stiker hilang" };
    await media.sendSticker(account, jid, buffer, quoted ? { quoted } : {});
    pick._item.uses = (pick._item.uses || 0) + 1;
    const recent = recentStickers.get(key) || [];
    recent.push(pick.id);
    recentStickers.set(key, recent.slice(-5));
    lastStickerAt.set(key, now());
    lastSpontAt.set(key, now());
    const st = stikerToday(key);
    sched.stiker[key] = { day: st.day, count: st.count + 1 };
    dirty.stiker = true;
    markSent(key, "stiker");
    await saveSched();
    return { sent: true, id: pick.id };
  }

  /** Layakkah membalas stiker `entry` dengan stiker sekarang? (tanpa efek samping) -> { ok, pick? } | { ok: false, reason } */
  function evaluateStickerReply(account, jid, entry, item, { repliedToBot = false, ignoreChance = false } = {}) {
    const key = keyOf(account, jid);
    const g = settings(account, jid);
    if (!g?.lihat) return { ok: false, reason: "balas/lihat mati" };
    const gate = stickerGate(account, jid, { repliedToBot });
    if (!gate.ok) return gate;
    if (!item?.tag) return { ok: false, reason: "stiker belum berlabel" };
    const t = now();
    const humans = (ctxBuf.get(key) || []).filter((m) => !m.isBot && m !== entry).slice(-4);
    if (humans.some((m) => SILENT_MOODS.has(detectMood(m.text)))) return { ok: false, reason: "suasana sedih/kesal: bot memilih diam" };
    const pick = pickStickerFor(stickerPool(account, key), item.tag, { excludeIds: [item.id], avoidIds: recentStickers.get(key) || [], random });
    if (!pick) return { ok: false, reason: "tidak ada stiker yang cocok" };
    if (!ignoreChance) {
      const lb = lastBot.get(key);
      const afterBot = lb && t - lb.ts < 3 * 60_000;
      const p = Math.min(0.9, repliedToBot ? 0.7 : config.stikerBalasChance * (afterBot ? 2 : 1));
      if (random() >= p) return { ok: false, reason: "tidak terpilih (acak)" };
    }
    return { ok: true, pick };
  }

  async function considerStickerReply(account, jid, key, entry, item, { repliedToBot = false } = {}) {
    const ev = evaluateStickerReply(account, jid, entry, item, { repliedToBot });
    if (!ev.ok) {
      log.log?.(`🎭 [Humor] tidak membalas stiker: ${ev.reason}`);
      return { sent: false, reason: ev.reason };
    }
    await sleep(2500 + Math.floor(random() * 5000)); // jeda manusiawi: "memilih stiker"
    const again = evaluateStickerReply(account, jid, entry, item, { repliedToBot, ignoreChance: true });
    if (!again.ok) return { sent: false, reason: again.reason };
    const r = await sendPicked(account, jid, key, again.pick, entry.msg || null);
    if (!r.sent) return r;
    log.log?.(`🎭 [Humor] membalas stiker ${entry.name || "?"} dengan stiker (${again.pick.tag}${again.pick.desc ? `: ${again.pick.desc}` : ""}).`);
    return { sent: true, sticker: r.id };
  }

  // ---- koleksi pemilik: stiker yang pemilik kirim ke bot (chat "Pesan untuk diri sendiri") dipakai di semua grup
  /**
   * Tambah stiker ke koleksi. label (opsional) = label manual. -> { ok, added?, dup?, item?, index?, reason?, labelErr? }
   * Tanpa label manual, stiker dibaca AI penglihatan (jika tersedia); gagal -> tersimpan tanpa label (bisa diberi label: /humor koleksi label).
   */
  async function addToKoleksi(account, buffer, { label = null } = {}) {
    if (!media?.store) return { ok: false, reason: "penyimpanan stiker belum terpasang di bot ini" };
    if (!loadedOk) await load();
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) return { ok: false, reason: "berkas stiker tidak valid" };
    if (buffer.length > config.stikerMaxBytes) return { ok: false, reason: "stiker terlalu besar" };
    const kk = kolKey(account);
    const lib = (stickers[kk] ||= []);
    const id = createHash("sha1").update(buffer).digest("hex").slice(0, 16);
    const hit = lib.find((x) => x.id === id);
    if (hit) {
      if (label && STICKER_TAGS.includes(label) && hit.tag !== label) {
        hit.tag = label;
        dirty.stiker = true;
        await flush();
      }
      return { ok: true, dup: true, item: hit, index: lib.indexOf(hit) + 1 };
    }
    if (lib.length >= config.koleksiMax) return { ok: false, reason: `koleksi penuh (${config.koleksiMax}). Hapus yang tidak dipakai: /humor koleksi hapus <nomor>` };
    await media.store.put(stickerFile(kk, id), buffer);
    const item = { id, tag: "", desc: "", seen: 1, uses: 0, ts: now(), own: true };
    let labelErr = "";
    if (label && STICKER_TAGS.includes(label)) item.tag = label;
    else if (visionReady() && visionBudget(kk, 0) ) {
      spendVision(kk);
      try {
        const frame = webpFirstFrame(buffer);
        const raw = await media.vision({ system: STICKER_SYSTEM, user: "Stiker ini milik pemilik bot. Beri label dan deskripsinya.", image: { buffer: frame.buffer, mime: "image/webp" } });
        const t = parseStickerTag(raw);
        if (t?.sensitive) {
          await media.store.del?.(stickerFile(kk, id)).catch(() => {});
          return { ok: false, reason: "stiker ini terbaca tidak pantas, jadi tidak disimpan" };
        }
        if (t) {
          item.tag = t.tag;
          item.desc = t.desc;
        } else labelErr = `jawaban AI tidak bisa dibaca sebagai label: "${String(raw ?? "").replace(/\s+/g, " ").slice(0, 60)}"`;
      } catch (e) {
        labelErr = `AI penglihatan gagal: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 100)}`;
      }
    } else labelErr = visionReady() ? "jatah baca stiker hari ini habis" : "AI penglihatan belum tersedia (butuh GEMINI_API_KEYS)";
    lib.push(item);
    dirty.stiker = true;
    await flush();
    await saveSched();
    return { ok: true, added: true, item, index: lib.length, labelErr };
  }

  const koleksiLine = (it, i) => `${i + 1}. ${it.tag || "(belum berlabel)"}${it.desc ? ` — ${it.desc}` : ""}${it.uses ? ` • dipakai ${it.uses}×` : ""}`;
  function koleksiText(account) {
    const lib = stickers[kolKey(account)] || [];
    if (!lib.length) return `🎭 Koleksi stiker ${label(account)} masih kosong.
Cara mengisi: buka chat "Pesan untuk diri sendiri" di WhatsApp ${label(account)} lalu kirim stiker-stikernya ke situ — bot menyimpan dan memakainya di semua grup yang menyalakan /humor balas.
Cadangan: kirim stiker (yang tidak beranimasi) langsung ke bot Telegram ini, otomatis masuk koleksi.${media?.intakeInfo ? `\n🔎 ${media.intakeInfo()}` : ""}`;
    const untagged = lib.filter((x) => !x.tag).length;
    const lines = lib.slice(0, 60).map(koleksiLine);
    return `🎭 *Koleksi stiker ${label(account)}* (${lib.length}/${config.koleksiMax}${untagged ? `, ${untagged} belum berlabel` : ""})
${lines.join("\n")}${lib.length > 60 ? `
… dan ${lib.length - 60} lainnya` : ""}

Hapus: /humor koleksi hapus <nomor> • Ubah label: /humor koleksi label <nomor> <${STICKER_TAGS.join("|")}>
Label menentukan kapan stiker dipakai.`;
  }
  async function koleksiCommand(p) {
    const account = p.account || MAIN;
    const lib = (stickers[kolKey(account)] ||= []);
    if (p.action === "list") return koleksiText(account);
    const idx = p.index - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= lib.length) return `Nomor ${p.index} tidak ada di koleksi (1-${lib.length}). Lihat: /humor koleksi`;
    if (p.action === "hapus") {
      const [gone] = lib.splice(idx, 1);
      await media?.store?.del?.(stickerFile(kolKey(account), gone.id)).catch(() => {});
      dirty.stiker = true;
      await flush();
      return `🗑️ Stiker #${p.index} (${gone.tag || "tanpa label"}) dihapus dari koleksi. Sisa ${lib.length}.`;
    }
    if (p.action === "label") {
      if (!STICKER_TAGS.includes(p.tag)) return `Label harus salah satu: ${STICKER_TAGS.join(", ")}.`;
      lib[idx].tag = p.tag;
      dirty.stiker = true;
      await flush();
      return `✅ Stiker #${p.index} sekarang berlabel "${p.tag}".`;
    }
    return koleksiText(account);
  }

  /** /humor koleksi tes [nomor] <grup>: kirim SATU stiker koleksi ke grup untuk uji (melewati peluang, jeda, jam tidur, dan jatah harian). */
  async function koleksiTes(p) {
    if (!media?.sendSticker || !media?.store) return "Pengiriman stiker belum terpasang di bot ini.";
    const r = await resolveTarget(p.target, p.account || null);
    if (r.error) return r.error;
    if (r.entries.length !== 1) return "Sebutkan satu grup saja (nama atau nomor dari /humor).";
    const e = r.entries[0];
    const lib = stickers[kolKey(e.account)] || [];
    if (!lib.length) return `Koleksi stiker ${label(e.account)} masih kosong. Isi dulu (lihat /humor koleksi).`;
    let item;
    if (p.index) {
      item = lib[p.index - 1];
      if (!item) return `Nomor ${p.index} tidak ada di koleksi (1-${lib.length}).`;
    } else item = lib[Math.floor(random() * lib.length)];
    const buffer = await media.store.get(stickerFile(kolKey(e.account), item.id));
    if (!buffer) return `Berkas stiker #${lib.indexOf(item) + 1} hilang dari penyimpanan. Hapus: /humor koleksi hapus ${lib.indexOf(item) + 1}`;
    try {
      await media.sendSticker(e.account, e.id, buffer, {});
    } catch (err) {
      return `⚠️ Stiker gagal terkirim ke "${e.subject}": ${String(err?.message || err).slice(0, 200)}`;
    }
    return `🎭 Stiker #${lib.indexOf(item) + 1} (${item.tag || "belum berlabel"}) terkirim ke "${e.subject}". (Uji ini tidak memakai jatah harian.)`;
  }

  function visualNote() {
    if (!media) return "\n⚠️ Fitur melihat belum terpasang di bot ini.";
    if (!visionReady()) return "\n⚠️ Kemampuan melihat butuh API key Gemini (GEMINI_API_KEYS di .env). Sebelum itu terisi, gambar & stiker tidak dibaca.";
    return `\nLihat: gambar yang dikirim anggota kadang dibaca AI (dikirim sekali ke Gemini untuk dideskripsikan satu kalimat; GAMBAR TIDAK DISIMPAN) lalu dikomentari; stiker anggota disimpan (maks ${config.stikerLibMax}/grup, bukan foto) dan kadang dibalas dengan stiker yang sesuai${config.stikerMaxPerDay > 0 ? ` (maks ${config.stikerMaxPerDay}×/hari)` : ""}. Jatah baca ${config.visiPerDay}×/hari/grup. Butuh /humor balas atau sapa menyala. Anggota yang menolak dibalas tidak dibaca stikernya.`;
  }

  // ------------------------------------------------ reaksi emoji (tanpa menulis apa-apa)
  function reaksiToday(key) {
    const day = dayOf();
    const r = sched.reaksi[key];
    return r && r.day === day ? r : { day, count: 0 };
  }
  async function doReact(account, jid, entry, emoji, key) {
    if (!react || !entry.msg) return false;
    await react(account, jid, entry.msg, emoji);
    lastReactAt.set(key, now());
    const rs = reaksiToday(key);
    sched.reaksi[key] = { day: rs.day, count: rs.count + 1 };
    await saveSched();
    log.log?.(`👍 [Humor] bereaksi ${emoji} ke ${entry.name || "?"}.`);
    return true;
  }
  /** Beri reaksi emoji pada pesan bernuansa (lucu, kabar baik, terima kasih, capek, ulang tahun). Aturan murni; tanpa AI. */
  function maybeReact(account, jid, entry, forcedEmoji = null) {
    const key = keyOf(account, jid);
    const g = settings(account, jid);
    if (!g?.balas || !react || !entry.msg || muted(key)) return null;
    const t = now();
    if (!inWindow(config.balasWindow, localParts(t, timeZone).minutes)) return null;
    if (!forcedEmoji && !entry.media && /\?\s*$/.test(entry.text)) return null; // pertanyaan tidak diberi reaksi emoji
    const emoji = forcedEmoji || (entry.media ? null : reactionFromText(entry.text)) || pickReaction(detectMood(entry.text));
    if (!emoji) return null;
    if ((ctxBuf.get(key) || []).filter((m) => !m.isBot && m !== entry).slice(-3).some((m) => SILENT_MOODS.has(detectMood(m.text)))) return null; // suasana sedang berat: jangan "bercanda" lewat emoji
    if ((data.noreply[key] || []).some((id) => entry.ids.includes(id))) return null;
    if (config.reaksiMaxPerDay > 0 && reaksiToday(key).count >= config.reaksiMaxPerDay) return null;
    if (t - (lastReactAt.get(key) || 0) < config.reaksiGapMs) return null;
    if (busy.has(`react|${key}`)) return null;
    if (random() >= config.reaksiChance) return null;
    busy.add(`react|${key}`);
    const delay = 2000 + Math.floor(random() * 7000);
    timer(() =>
      doReact(account, jid, entry, emoji, key)
        .catch((e) => log.warn?.(`👍 [Humor] reaksi gagal: ${e instanceof Error ? e.message : e}`))
        .finally(() => busy.delete(`react|${key}`)), delay);
    return { ok: true, scheduled: true, kind: "reaksi", emoji };
  }

  /** Susun dan kirim satu balasan (reply) untuk `entry`. force = uji manual (lewati peluang & batas). -> { sent, text?, reason? } */
  async function balasNow(account, jid, entry, { force = false } = {}) {
    const key = keyOf(account, jid);
    let context;
    let mood = detectMood(entry.text);
    let again0 = null;
    if (force) context = contextBefore(key, entry);
    else {
      const again = evaluateBalas(account, jid, entry, { ignoreChance: true }); // cek ulang setelah jeda
      again0 = again;
      if (!again.ok) {
        log.log?.(`💬 [Humor] balasan dibatalkan: ${again.reason}`);
        return { sent: false, reason: again.reason };
      }
      context = again.context;
      mood = again.mood;
    }
    if (!ai || !send) return { sent: false, reason: "AI/pengiriman belum siap" };
    if (entry.media?.kind === "gambar") {
      const d = await ensureDescribed(key, entry); // membaca gambar dulu (lewat AI penglihatan) sebelum menanggapi
      await saveSched();
      if (!d.ok) {
        log.log?.(`👁️ [Humor] gambar tidak dibalas: ${d.reason}`);
        return { sent: false, reason: d.reason };
      }
    }
    const recentBot = (ctxBuf.get(key) || []).filter((m) => m.isBot).slice(-6).map((m) => m.text);
    const who = callName(key, entry.ids, entry.name);
    // koleksi stiker: AI boleh memilih membalas dengan stiker (baris "STIKER: <label>") bila stiker tersedia & diizinkan
    const isQ = again0 ? Boolean(again0.question) : Boolean(config.tanyaOn && !entry.media && isGroupQuestion(entry.text));
    const pool0 = !force && !isQ && !SILENT_MOODS.has(mood) && stickerGate(account, jid).ok ? stickerPool(account, key) : [];
    const stickerTags = [...new Set(pool0.map((x) => x.tag))].filter((t) => STICKER_PICK_TAGS.includes(t));
    const en = energyNow(key);
    const { system, user } = buildReplyPrompt({
      target: { name: who, text: entry.text, quoted: entry.quoted || "" },
      context,
      styleNote: describeStyle(styles[key]),
      fewShot: fewShotNote(feedbacks[key]),
      memberNote: memberNoteFor(key, entry.ids, entry.name),
      moodHint: `${moodHint(mood) || ""}${photoHint(entry)}${en.e.hint ? ` ${en.e.hint}` : ""}${again0?.followUp ? " Orang ini baru kamu balas dan menulis lagi: sambung obrolannya dengan wajar, jangan mengulang yang tadi." : ""}`.trim(),
      allowReaction: Boolean(react && entry.msg) && !isQ,
      stickerTags,
      question: isQ,
      after: isQ ? (() => { const b = ctxBuf.get(key) || []; const i = b.indexOf(entry); return i >= 0 ? b.slice(i + 1).filter((m) => !m.isBot).slice(0, 4).map((m) => ({ name: m.name, text: m.text })) : []; })() : []
    });
    let text = null;
    let stickerWant = null;
    let why = "";
    for (let i = 0; i < 2 && !text && !stickerWant; i += 1) {
      let raw = "";
      try {
        raw = await ai({ system, user, temperature: isQ ? 0.5 : 0.85, maxTokens: isQ ? 240 : 120, search: isQ });
      } catch (e) {
        log.warn?.(`💬 [Humor] AI balasan gagal: ${e instanceof Error ? e.message : e}`);
        return { sent: false, reason: "AI gagal" };
      }
      const emoji = parseReactionOutput(raw);
      if (emoji) {
        if (!force) {
          const last = evaluateBalas(account, jid, entry, { ignoreChance: true });
          if (!last.ok) return { sent: false, reason: last.reason };
        }
        if (!(await doReact(account, jid, entry, emoji, key))) return { sent: false, reason: "reaksi tidak tersedia" };
        return { sent: true, reaction: emoji };
      }
      const so = stickerTags.length ? parseStickerOutput(raw, stickerTags) : null;
      if (so?.tag) {
        stickerWant = so.tag; // balas dengan stiker (dengan/tanpa satu kalimat pendek)
        if (so.rest) {
          const v2 = validateChat(so.rest, { maxLen: 260, recent: recentBot });
          if (v2.ok) text = v2.text;
        }
        break;
      }
      const v = validateChat(so ? so.rest : raw, { maxLen: isQ ? 480 : 260, recent: recentBot });
      if (v.ok) text = v.text;
      else {
        why = v.reason;
        log.log?.(`💬 [Humor] balasan ditolak penyaring (${v.reason}): ${String(raw).slice(0, 80)}`);
        if (v.reason === "AI memilih SKIP") break;
      }
    }
    if (!text && !stickerWant) return { sent: false, reason: why || "tidak ada balasan yang lolos" };
    if (!force) {
      const last = evaluateBalas(account, jid, entry, { ignoreChance: true }); // masih layak setelah menunggu AI?
      if (!last.ok) return { sent: false, reason: last.reason };
    }
    let d = { sent: false };
    if (text) d = await deliver(account, jid, text, { quoted: entry.msg || null, kind: "balas", targetName: who, targetText: entry.text, force, question: isQ });
    let stk = null;
    if (stickerWant && !force) {
      const gate = stickerGate(account, jid);
      const pick = gate.ok ? pickStickerFor(stickerPool(account, key), stickerWant, { exact: true, avoidIds: recentStickers.get(key) || [], random }) : null;
      if (pick) {
        if (text) await sleep(1200 + Math.floor(random() * 2500));
        stk = await sendPicked(account, jid, key, pick, text ? null : entry.msg || null).catch((e) => ({ sent: false, reason: e instanceof Error ? e.message : String(e) }));
        if (stk.sent) log.log?.(`🎭 [Humor] membalas ${entry.name || "?"} dengan stiker "${pick.tag}"${pick.desc ? ` (${pick.desc})` : ""}${text ? " + kalimat" : ""}.`);
      }
    }
    if (!d.sent && !d.queued && !stk?.sent) return { sent: false, reason: stk?.reason || "stiker tidak tersedia" };
    if (!force) {
      const st = balasToday(key);
      sched.balas[key] = { day: st.day, count: st.count + 1, lastAt: now() };
      await saveSched();
      const prev = lastBalasTo.get(key);
      const same = again0?.followUp && prev;
      lastBalasTo.set(key, { ids: (entry.ids || []).slice(0, 3), ts: now(), depth: same ? prev.depth + 1 : 1 });
      const rr = (repliedRecent.get(key) || []).filter((x) => now() - x.ts <= 20 * 60_000);
      if (entry.ids?.[0]) rr.push({ id: entry.ids[0], ts: now() });
      repliedRecent.set(key, rr.slice(-8));
    }
    if (text) log.log?.(`💬 [Humor] ${d.queued ? "mengajukan draf balasan untuk" : "membalas"} ${entry.name || "?"}${force ? " (uji)" : ""}: ${text.slice(0, 60)}`);
    if (d.queued) return { sent: false, queued: true, text };
    return { sent: true, text, sticker: stk?.sent ? stk.id : undefined };
  }

  // ------------------------------------------------ chat otomatis harian (sapa)
  function sapaTarget(minutes) {
    const win = config.sapaWindow;
    const left = win.to - Math.max(win.from, minutes);
    if (left <= 0) return 0;
    return Math.max(1, Math.ceil((config.sapaPerDay * left) / (win.to - win.from))); // hari pertama dinyalakan siang hari: jatah menyesuaikan sisa hari
  }

  /** Jadwal berikutnya menyesuaikan sisa jatah & sisa waktu: bila bot sempat mati, jarak otomatis merapat supaya jatah tetap terkejar. */
  function planNextSapa(st, minutes) {
    const win = config.sapaWindow;
    const remaining = st.target - st.count;
    if (remaining <= 0) {
      st.nextAt = 0;
      return;
    }
    const wait = Math.max(0, win.from - minutes) * 60_000; // sebelum jendela dibuka
    const left = Math.max(0, win.to - Math.max(win.from, minutes)) * 60_000;
    let gap = (left / remaining) * (0.4 + 0.8 * random());
    gap = Math.max(config.sapaMinGapMs, gap);
    gap = Math.min(gap, Math.max(config.sapaMinGapMs, left * 0.8));
    st.nextAt = now() + wait + Math.floor(gap);
  }

  function sapaState(key) {
    const lp = localParts(now(), timeZone);
    let st = sched.sapa[key];
    if (!st || st.day !== lp.day) {
      st = { day: lp.day, count: 0, target: sapaTarget(lp.minutes), nextAt: 0, tries: 0, recent: st?.recent || [], kinds: st?.kinds || [] };
      planNextSapa(st, lp.minutes);
      sched.sapa[key] = st;
      return { st, fresh: true };
    }
    return { st, fresh: false };
  }

  const sapaWeights = (key) => {
    const w = kindWeights(feedbacks[key], SAPA_KINDS.map((k) => `sapa:${k.id}`));
    return Object.fromEntries(SAPA_KINDS.map((k) => [k.id, w[`sapa:${k.id}`]]));
  };
  /** Anggota yang meminta diingat (punya hal ringan tersimpan) di grup ini, acak satu. */
  function pickMemberWithFacts(key) {
    const list = Object.values(data.members[key] || {}).filter((m) => m.facts?.length);
    return list.length ? list[Math.floor(random() * list.length)] : null;
  }

  async function makeSapa(key) {
    const lp = localParts(now(), timeZone);
    const st = sched.sapa[key] || {};
    const avoid = st.recent || [];
    const t = now();
    const recentCtx = (ctxBuf.get(key) || []).filter((m) => !m.isBot && t - m.ts <= 3 * 3_600_000);
    let hasContext = recentCtx.length >= 3 && !isSeriousChat(recentCtx.slice(-6));
    const occasions = occasionsFor(lp, config.hariKhusus);
    // "momen hari ini" cukup disinggung sekali sehari
    let hasOccasion = occasions.length > 0 && !(st.momenDay === lp.day);
    let member = pickMemberWithFacts(key);
    const styleNote = describeStyle(styles[key]);
    const fewShot = fewShotNote(feedbacks[key]);
    if (ai) {
      for (let i = 0; i < 2; i += 1) {
        const kind = pickSapaKind(random, { hasContext, hasOccasion, hasMember: Boolean(member), avoid: (st.kinds || []).slice(0, 2), weights: sapaWeights(key) });
        const memberNote = kind.needsMember && member ? memberNoteFor(key, member.ids, member.name) : "";
        const { system, user } = buildSapaPrompt({
          kind,
          weekday: lp.weekday,
          part: partOfDay(lp.minutes),
          context: kind.needsContext ? contextBefore(key) : [],
          avoid,
          occasions: kind.needsOccasion || i === 0 ? occasions.slice(0, 3) : [],
          memberNote: kind.needsMember && member ? `${memberNote} Anggota yang dimaksud: ${callName(key, member.ids, member.name)}.` : "",
          styleNote,
          fewShot
        });
        try {
          const v = validateChat(await ai({ system, user, temperature: 0.95, maxTokens: 140 }), { maxLen: 320, recent: avoid });
          if (v.ok) return { text: v.text, source: "ai", kind: kind.id };
          if (v.reason === "AI memilih SKIP") {
            if (kind.needsContext) hasContext = false;
            if (kind.needsOccasion) hasOccasion = false;
            if (kind.needsMember) member = null;
          }
        } catch (e) {
          log.warn?.(`💬 [Humor] AI sapa gagal: ${e instanceof Error ? e.message : e}`);
          break;
        }
      }
    }
    return { text: pickFallbackSapa(avoid, random), source: "cadangan", kind: "cadangan" };
  }

  async function sendSapa(account, jid, key, { force = false } = {}) {
    const r = await makeSapa(key);
    const d = await deliver(account, jid, r.text, { kind: `sapa:${r.kind}`, force });
    const { st } = sapaState(key);
    st.recent = [r.text, ...(st.recent || [])].slice(0, 10);
    st.kinds = [r.kind, ...(st.kinds || [])].slice(0, 6);
    if (r.kind === "momen") st.momenDay = localParts(now(), timeZone).day;
    sched.sapa[key] = st;
    return { ...r, force, queued: Boolean(d.queued) };
  }

  /** Ucapan ulang tahun untuk anggota yang MEMINTA dicatat (opt-in). Sekali setahun per orang, mulai pukul 06:00 setempat. */
  async function maybeBirthday(account, jid, key, g, lp) {
    if (lp.minutes < 6 * 60) return false;
    const [yy, mm, dd] = lp.day.split("-").map(Number);
    const who = Object.values(data.members[key] || {}).find((m) => m.birthday && m.birthday.m === mm && m.birthday.d === dd && m.bdayYear !== yy);
    if (!who) return false;
    const name = callName(key, who.ids, who.name);
    let text = null;
    if (ai) {
      const { system, user } = buildSapaPrompt({ kind: { id: "ultah", prompt: `mengucapkan selamat ulang tahun yang hangat, singkat, dan ringan kepada ${name} (sebut namanya), dengan doa baik yang umum` }, weekday: lp.weekday, part: partOfDay(lp.minutes), styleNote: describeStyle(styles[key]), fewShot: fewShotNote(feedbacks[key]) });
      try {
        const v = validateChat(await ai({ system, user, temperature: 0.9, maxTokens: 120 }), { maxLen: 300 });
        if (v.ok && v.text.toLowerCase().includes(name.toLowerCase().slice(0, 3))) text = v.text;
      } catch {
        text = null;
      }
    }
    if (!text) text = `Selamat ulang tahun, ${name}! 🎂🎉 Semoga sehat, bahagia, dan makin lancar semuanya ya.`;
    await deliver(account, jid, text, { kind: "sapa:ultah" });
    who.bdayYear = yy; // ditandai setelah terkirim/diajukan, supaya gagal kirim dicoba lagi pada menit berikutnya
    await saveData();
    log.log?.(`🎂 [Humor] ucapan ulang tahun untuk ${name} di ${g.name || jid}.`);
    return true;
  }

  async function checkSapa() {
    const t = now();
    const lp = localParts(t, timeZone);
    for (const [key, g] of Object.entries(data.groups)) {
      if (!g?.sapa) continue;
      if (muted(key)) continue;
      const { st, fresh } = sapaState(key);
      if (fresh) {
        await saveSched();
        log.log?.(`💬 [Humor] ${g.name || key}: chat otomatis hari ini ${st.target}× (mulai ±${hm(Math.min(1439, lp.minutes + Math.round(Math.max(0, st.nextAt - t) / 60_000)))}).`);
      }
      const buf = ctxBuf.get(key) || [];
      const humansRecent = buf.filter((m) => !m.isBot && t - m.ts <= 30 * 60_000).slice(-6);
      const [account, jid] = key.split("|");
      // ulang tahun anggota (opt-in) didahulukan, tidak menunggu jadwal biasa
      if (sapaOpen(lp.minutes) && !busy.has(`sapa|${key}`) && !humansRecent.some((m) => SILENT_MOODS.has(detectMood(m.text)))) {
        busy.add(`sapa|${key}`);
        try {
          if (await maybeBirthday(account, jid, key, g, lp)) st.count += 1;
        } catch (e) {
          log.warn?.(`🎂 [Humor] ucapan ulang tahun gagal: ${e instanceof Error ? e.message : e}`);
        } finally {
          busy.delete(`sapa|${key}`);
        }
      }
      if (st.count >= st.target || !sapaOpen(lp.minutes) || t < st.nextAt) continue;
      if (busy.has(`sapa|${key}`) || busy.has(`balas|${key}`) || busy.has(`roast|${key}`)) continue;
      // jangan menyela: obrolan sedang berlangsung, bot baru saja bicara, atau suasana sedang berat
      const lastHuman = [...buf].reverse().find((m) => !m.isBot);
      if (t - (lastSpontAt.get(key) || 0) < Math.min(config.sapaMinGapMs, 5 * 60_000)) {
        st.nextAt = t + 2 * 60_000;
        continue;
      }
      if (lastHuman && t - lastHuman.ts < 25_000) {
        st.nextAt = t + 60_000;
        continue;
      }
      if (humansRecent.length && (isSeriousChat(humansRecent) || humansRecent.some((m) => SILENT_MOODS.has(detectMood(m.text))))) {
        st.nextAt = t + 15 * 60_000;
        continue;
      }
      busy.add(`sapa|${key}`);
      try {
        const r = await sendSapa(account, jid, key);
        st.count += 1;
        st.tries = 0;
        planNextSapa(st, localParts(now(), timeZone).minutes);
        await saveSched();
        log.log?.(`💬 [Humor] chat otomatis ${st.count}/${st.target} ${r.queued ? "diajukan ke pemilik" : "terkirim"} untuk ${g.name || jid} (${r.source}/${r.kind}).`);
      } catch (e) {
        st.tries = (st.tries || 0) + 1;
        st.nextAt = t + Math.min(60, 5 * st.tries) * 60_000;
        await saveSched();
        log.warn?.(`💬 [Humor] chat otomatis gagal dikirim ke ${g.name || jid} (percobaan ${st.tries}): ${e instanceof Error ? e.message : e}`);
      } finally {
        busy.delete(`sapa|${key}`);
      }
    }
  }

  // ------------------------------------------------ pantun harian
  async function makePantun(key) {
    const lp = localParts(now(), timeZone);
    const used = sched.pantun[key]?.recent || [];
    if (ai) {
      const theme = PANTUN_THEMES[Math.floor(random() * PANTUN_THEMES.length)];
      const { system, user } = buildPantunPrompt({ theme, weekday: lp.weekday, part: partOfDay(lp.minutes), avoid: used });
      for (let i = 0; i < 2; i += 1) {
        try {
          const v = validatePantun(await ai({ system, user, temperature: 0.9, maxTokens: 160 }));
          if (v.ok && !used.includes(v.text)) return { text: v.text, source: "ai" };
        } catch (e) {
          log.warn?.(`😄 [Humor] AI pantun gagal: ${e instanceof Error ? e.message : e}`);
          break;
        }
      }
    }
    const fresh = FALLBACK_PANTUN.filter((p) => !used.includes(p));
    const pool = fresh.length ? fresh : FALLBACK_PANTUN;
    return { text: pool[Math.floor(random() * pool.length)], source: "cadangan" };
  }

  function windowOf(g) {
    return g?.window ? parseWindow(`${hm(g.window.from)}-${hm(g.window.to)}`, config.pantunWindow) : config.pantunWindow;
  }

  async function sendPantun(account, jid, key, { force = false } = {}) {
    const { text, source } = await makePantun(key);
    const lp = localParts(now(), timeZone);
    const head = { pagi: "🎋 Pantun pagi", siang: "🎋 Pantun siang", sore: "🎋 Pantun sore", malam: "🎋 Pantun malam" }[partOfDay(lp.minutes)];
    await out(account, jid, `${head}, ${lp.weekday}:\n\n${text}`, {}, "pantun");
    const st = sched.pantun[key] || {};
    st.recent = [text, ...(st.recent || [])].slice(0, 8);
    sched.pantun[key] = st;
    return { text, source, force };
  }

  /** Dipanggil tiap menit: memilih jam acak hari ini lalu mengirim pantun saat waktunya. Satu pantun per grup per hari. */
  async function check() {
    if (!loadedOk || !send) return;
    try {
      await checkSapa();
    } catch (e) {
      log.warn?.(`💬 [Humor] pemeriksaan chat otomatis error: ${e instanceof Error ? e.message : e}`);
    }
    prunePending();
    await flush();
    const t = now();
    const lp = localParts(t, timeZone);
    for (const [key, g] of Object.entries(data.groups)) {
      if (!g?.pantun) continue;
      if (busy.has(`pantun|${key}`) || muted(key)) continue;
      const win = windowOf(g);
      let st = sched.pantun[key];
      if (!st || st.day !== lp.day) {
        const at = pickPantunMinute(win, lp.minutes, random);
        st = { day: lp.day, at, sent: at === null, tries: 0, nextTry: 0, recent: st?.recent || [] };
        sched.pantun[key] = st;
        await saveSched();
        log.log?.(`🎋 [Humor] ${g.name || key}: pantun hari ini ${at === null ? "dilewati (rentang jam sudah lewat)" : `dijadwalkan ${hm(at)}`}.`);
      }
      if (st.sent || st.at === null) continue;
      if (lp.minutes < st.at || lp.minutes >= win.to) {
        if (lp.minutes >= win.to) {
          st.sent = true; // terlewat (bot mati saat itu): jangan kirim larut malam
          await saveSched();
        }
        continue;
      }
      if (t < (st.nextTry || 0)) continue;
      const [account, jid] = key.split("|");
      busy.add(`pantun|${key}`);
      try {
        const r = await sendPantun(account, jid, key);
        st.sent = true;
        await saveSched();
        log.log?.(`🎋 [Humor] pantun terkirim ke ${g.name || jid} (${r.source}).`);
      } catch (e) {
        st.tries = (st.tries || 0) + 1;
        st.nextTry = t + 10 * 60_000;
        if (st.tries >= 3) st.sent = true; // menyerah untuk hari ini
        await saveSched();
        log.warn?.(`🎋 [Humor] pantun gagal dikirim ke ${g.name || jid} (percobaan ${st.tries}): ${e instanceof Error ? e.message : e}`);
      } finally {
        busy.delete(`pantun|${key}`);
      }
    }
  }

  // ------------------------------------------------ perintah Telegram
  async function allowedGroups(only = null) {
    const out = [];
    for (const a of only ? [only] : accounts()) {
      let groups = null;
      try {
        groups = listGroups ? await listGroups(a) : null;
      } catch {
        groups = null;
      }
      if (!groups) {
        out.push({ account: a, offline: true });
        continue;
      }
      const sorted = groups.filter((g) => g.allowed).sort((x, y) => String(x.subject).localeCompare(String(y.subject), "id"));
      for (const g of sorted) out.push({ account: a, id: g.id, subject: g.subject || "(tanpa nama)" });
    }
    return out;
  }

  function describeGroup(entry) {
    const g = data.groups[keyOf(entry.account, entry.id)] || {};
    const flag = (v) => (v ? "✅" : "▫️");
    const key = keyOf(entry.account, entry.id);
    const win = windowOf(g);
    const st = sched.pantun[key];
    const lp = localParts(now(), timeZone);
    let pantunInfo = "";
    if (g.pantun) {
      if (st && st.day === lp.day) pantunInfo = st.at === null ? " (hari ini dilewati)" : st.sent ? " (hari ini sudah terkirim)" : ` (hari ini ±${hm(st.at)})`;
      pantunInfo += ` [${hm(win.from)}–${hm(win.to)}${g.window ? "" : ", bawaan"}]`;
    }
    const rs = roastToday(key);
    const roastInfo = g.roast ? ` (${rs.count}/${config.roastMaxPerDay} hari ini)` : "";
    const nOut = (data.optout[key] || []).length;
    const bs = balasToday(key);
    const balasInfo = g.balas ? ` (${bs.count}${config.balasMaxPerDay > 0 ? `/${config.balasMaxPerDay}` : ""} hari ini)` : "";
    let sapaInfo = "";
    if (g.sapa) {
      const sp = sched.sapa[key];
      sapaInfo = sp && sp.day === lp.day ? ` (${sp.count}/${sp.target} hari ini${sp.count < sp.target && sp.nextAt ? `, berikut ±${hm(localParts(sp.nextAt, timeZone).minutes)}` : ""})` : " (belum mulai hari ini)";
    }
    const nNo = (data.noreply[key] || []).length;
    const mutedInfo = muted(key) ? ` • 🤫 diam sampai ±${hm(localParts(g.muteUntil, timeZone).minutes)}` : "";
    const latihanInfo = (g.latihan ? " • 📝 mode latihan" : "") + (g.lihat ? ` • 👁️ baca gambar/stiker (${(stickers[key] || []).length} stiker)` : "") + (g.ingat ? " • 🧠 mengingat hal ringan" : "");
    const nMem = Object.keys(data.members[key] || {}).length;
    return `gaya ${flag(g.chat)} • pantun ${flag(g.pantun)}${pantunInfo} • roast ${flag(g.roast)}${roastInfo}${nOut ? ` • ${nOut} orang menolak roast` : ""}\n   balas ${flag(g.balas)}${balasInfo} • sapa ${flag(g.sapa)}${sapaInfo}${nNo ? ` • ${nNo} orang menolak dibalas` : ""}${nMem ? ` • ${nMem} anggota minta diingat` : ""}${latihanInfo}${mutedInfo}`;
  }

  async function statusText(only = null) {
    const list = await allowedGroups(only);
    const lines = ["😄 *Mode humor grup WhatsApp*"];
    let n = 0;
    const all = await allowedGroups(); // nomor urut selalu dari daftar lengkap supaya sama dengan yang dipakai perintah
    const numberOf = new Map(all.filter((e) => e.id).map((e, i) => [keyOf(e.account, e.id), i + 1]));
    for (const a of only ? [only] : accounts()) {
      const mine = list.filter((e) => e.account === a);
      lines.push(`\n*${label(a)}*`);
      if (mine.some((e) => e.offline)) lines.push("(sedang tidak tersambung ke WhatsApp)");
      const rows = mine.filter((e) => e.id);
      if (!rows.length && !mine.some((e) => e.offline)) lines.push("(belum ada grup yang dijawab — tambah dulu lewat /grup)");
      for (const e of rows) {
        n += 1;
        lines.push(`${numberOf.get(keyOf(e.account, e.id))}. ${e.subject}\n   ${describeGroup(e)}`);
      }
    }
    lines.push(
      "\nNyalakan: /humor on <nomor|nama> • matikan: /humor off <nomor|nama>\nSebagian: /humor pantun|roast|gaya|balas|sapa|latihan|lihat|ingat on|off <grup> • semua grup: /humor semua on|off\nDiamkan sementara: /humor diam <jam> <grup> • /humor lanjut <grup> • lihat yang dipelajari: /humor profil <grup>\nJam pantun: /humor jam 09:00-17:00 <grup> • coba sekarang: /humor tes [pantun|sapa|balas] <grup>" + (secondEnabled ? "\n(nomor kedua: tambahkan kata wa2)" : "")
    );
    for (const a of only ? [only] : accounts()) {
      const n = (stickers[kolKey(a)] || []).length;
      if (n) lines.push(`\n🎭 Koleksi stiker ${label(a)}: ${n} (lihat/kelola: /humor koleksi${a === SECOND ? " wa2" : ""})`);
    }
    lines.push(`\nBalas: peluang ${Math.round(config.balasChance * 100)}% per chat, jeda ≥ ${Math.round(config.balasGapMs / 60000)} menit, ${config.balasMaxPerDay > 0 ? `maks ${config.balasMaxPerDay}×/hari/grup` : "tanpa batas harian (diatur energi, jeda & kelelahan)"}, membaca ${config.contextSize} chat sebelumnya, jam ${hm(config.balasWindow.from)}–${hm(config.balasWindow.to)}. Sapa: minimal ${config.sapaPerDay}×/hari/grup, jam ${hm(config.sapaWindow.from)}–${hm(config.sapaWindow.to)}. ${config.tidurWindow ? `Jam tidur ${hm(config.tidurWindow.from)}–${hm(config.tidurWindow.to)}: tidak membuka obrolan, membalas hanya saat obrolan ramai.` : "Tanpa jam tidur."}`);
    lines.push(`\nRoast: maks ${config.roastMaxPerDay}×/hari/grup, jeda ≥ ${Math.round(config.roastCooldownMs / 60000)} menit, hanya saat obrolan santai & ramai, jam ${hm(config.roastWindow.from)}–${hm(config.roastWindow.to)}. Anggota bisa menolak dengan "bot jangan roasting aku".`);
    return lines.join("\n");
  }

  /** Cari grup dari nomor atau potongan nama. -> { entries } | { error } */
  async function resolveTarget(target, account) {
    const all = (await allowedGroups(account)).filter((e) => e.id);
    if (target === "*") return { entries: all };
    if (/^\d{1,3}$/.test(target)) {
      const full = (await allowedGroups()).filter((e) => e.id);
      const e = full[Number(target) - 1];
      return e ? { entries: [e] } : { error: `Tidak ada grup nomor ${target} (lihat /humor; nomor 1–${full.length}).` };
    }
    const norm = String(target).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (norm.length < 3) return { error: `Nama "${target}" terlalu pendek (minimal 3 huruf/angka).` };
    const hit = all.filter((e) => e.subject.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").includes(norm));
    if (!hit.length) return { error: `Tidak ada grup yang dijawab bot dengan nama memuat "${target}". Lihat /humor (hanya grup yang sudah diizinkan lewat /grup).` };
    if (hit.length > 1) return { error: `Nama "${target}" cocok dengan ${hit.length} grup: ${hit.slice(0, 5).map((e) => `"${e.subject}"`).join(", ")}. Tulis lebih lengkap atau pakai nomornya.` };
    return { entries: hit };
  }

  async function handle(arg, { secondAliases = [] } = {}) {
    const p = parseHumorArg(arg, { secondAliases });
    if (p.kind === "error") return p.error;
    if (p.account === SECOND && !secondEnabled) return "Nomor kedua belum dinyalakan (isi WA2_NUMBER di .env).";
    try {
      if (!loadedOk) {
        await load();
        if (!loadedOk) return "⚠️ Pengaturan humor tersimpan belum bisa dibaca dari database, jadi perubahan ditunda supaya pengaturan lama tidak tertimpa. Coba lagi sebentar lagi.";
      }
      if (p.kind === "status") return await statusText(p.account || null);
      if (p.kind === "koleksi" && p.action === "tes") return await koleksiTes(p);
      if (p.kind === "koleksi") return await koleksiCommand(p);
      const r = await resolveTarget(p.target, p.account || null);
      if (r.error) return r.error;
      if (!r.entries.length) return "Belum ada grup yang dijawab bot, jadi tidak ada yang diubah. Tambah dulu lewat /grup.";
      if (p.kind === "test") {
        const e = r.entries[0];
        if (!send) return "Pengiriman belum siap.";
        const key = keyOf(e.account, e.id);
        if (p.what === "sapa") {
          const o = await sendSapa(e.account, e.id, key, { force: true });
          await saveSched();
          return `💬 Chat otomatis percobaan terkirim ke "${e.subject}" (${o.source === "ai" ? "dibuat AI" : "dari cadangan"}):\n\n${o.text}\n\n(Percobaan ini tidak menghabiskan jatah harian.)`;
        }
        if (p.what === "balas") {
          const last = [...(ctxBuf.get(key) || [])].reverse().find((m) => !m.isBot && isReplyWorthy(m.text));
          if (!last) return `Belum ada chat anggota yang terbaca di memori untuk "${e.subject}" (balas harus menyala dan ada yang mengobrol dulu). Nyalakan: /humor balas on ${p.target}`;
          const o = await balasNow(e.account, e.id, last, { force: true });
          return o.sent ? `💬 Balasan percobaan terkirim ke "${e.subject}" (membalas ${last.name || "?"}):\n\n${o.text}` : `Tidak ada balasan yang dikirim (${o.reason}).`;
        }
        const out_ = await sendPantun(e.account, e.id, key, { force: true });
        await saveSched();
        return `🎋 Pantun percobaan terkirim ke "${e.subject}" (${out_.source === "ai" ? "dibuat AI" : "dari cadangan"}):\n\n${out_.text}\n\n(Percobaan ini tidak menghabiskan jatah pantun harian.)`;
      }
      if (p.kind === "mute" || p.kind === "unmute") {
        const names0 = [];
        for (const e of r.entries) {
          const key = keyOf(e.account, e.id);
          const g = data.groups[key];
          if (!g) continue; // grup yang belum menyalakan humor tidak perlu didiamkan
          if (p.kind === "mute") g.muteUntil = now() + p.hours * 3_600_000;
          else delete g.muteUntil;
          names0.push(e.subject);
        }
        if (!names0.length) return "Tidak ada grup yang humornya menyala di pilihan itu, jadi tidak ada yang diubah.";
        const saved0 = await saveData();
        const until = p.kind === "mute" ? localParts(now() + p.hours * 3_600_000, timeZone) : null;
        return `${p.kind === "mute" ? `🤫 Ayyubi diam (tidak bicara sendiri, tidak membalas acak) selama ${p.hours} jam, sampai ±${hm(until.minutes)} ${until.weekday}` : "🔔 Ayyubi boleh bicara lagi"} di ${p.target === "*" ? `semua grup (${names0.length})` : `"${names0[0]}"`}. (Kalau dipanggil langsung, ia tetap menjawab.)${saved0 ? "" : "\n⚠️ Gagal menyimpan ke database: berlaku sampai bot restart saja."}`;
      }
      if (p.kind === "profile") {
        const e = r.entries[0];
        const key = keyOf(e.account, e.id);
        const stl = describeStyle(styles[key]);
        const fb = feedbacks[key];
        const kinds = Object.entries(fb?.kinds || {}).filter(([, v]) => v.sent >= 1).sort((a, b) => b[1].sent - a[1].sent).slice(0, 8);
        const mem = Object.values(data.members[key] || {});
        return [
          `🧠 *Profil belajar Ayyubi di "${e.subject}"*`,
          stl || `Gaya grup: belum cukup data (${styles[key]?.n || 0}/20 pesan terbaca; fitur balas/sapa harus menyala).`,
          fb ? `Contoh disukai: ${fb.good.length} • ditolak: ${fb.bad.length}${data.groups[key]?.latihan ? " (mode latihan AKTIF)" : ""}` : "Belum ada umpan balik.",
          kinds.length ? `Tanggapan grup per jenis pesan:\n${kinds.map(([k, v]) => `• ${k}: ${v.sent} terkirim, ${Math.round((v.eng / Math.max(1, v.sent)) * 100)}% ditanggapi`).join("\n")}` : "Belum ada data tanggapan grup.",
          data.groups[key]?.lihat ? `Stiker tersimpan: ${(stickers[key] || []).length} (berlabel ${(stickers[key] || []).filter((x) => x.tag).length}).${stickerErr.get(key) ? `\n⚠️ Pelabelan terakhir gagal: ${stickerErr.get(key)}` : ""}${(stickers[key] || []).filter((x) => x.tag).slice(-4).map((x) => `\n  • ${x.tag}${x.desc ? `: ${x.desc}` : ""}`).join("")}` : "Baca gambar/stiker: mati (nyalakan: /humor lihat on <grup>).",
          mem.length ? `Anggota yang diingat: ${mem.length} (${mem.map((m) => m.nick || firstName(m.name)).slice(0, 8).join(", ")}) • hal ringan dari cerita sendiri: ${mem.reduce((a, m) => a + (m.facts || []).filter((x) => x.auto).length, 0)}` : "Belum ada anggota yang diingat.",
          data.groups[key]?.ingat ? "Ingat hal ringan: HIDUP (anggota bisa menghapus dengan \"bot lupakan aku\")." : "Ingat hal ringan: mati (nyalakan: /humor ingat on <grup>).",
          (() => {
            const en = energyNow(key);
            return `Suasana hari ini: ${en.e.level} (peluang ×${en.chance}, jeda ×${en.gap}) • ritme jam ×${en.hour} • kelelahan ×${Math.round(en.fatigue * 100) / 100}${config.energi ? "" : " (energi dimatikan)"}`;
          })()
        ].join("\n");
      }
      const names = [];
      for (const e of r.entries) {
        const key = keyOf(e.account, e.id);
        const g = data.groups[key] || { name: e.subject, chat: false, pantun: false, roast: false, balas: false, sapa: false, latihan: false, lihat: false, ingat: false };
        g.name = e.subject;
        if (p.kind === "set") for (const f of p.flags) g[f] = p.value;
        if (p.kind === "window") {
          if (p.window === "reset") delete g.window;
          else g.window = p.window;
          delete sched.pantun[key]?.day; // pilih ulang jam hari ini
        }
        if (anyFlag(g) || g.window) data.groups[key] = g;
        else delete data.groups[key];
        if (!g.roast) buffers.delete(key); // roast dimatikan: buang obrolan yang tersimpan
        if (!g.balas && !g.sapa) ctxBuf.delete(key);
        if (g.latihan === false) delete g.latihan;
        if (g.lihat === false) delete g.lihat;
        if (g.ingat === false) delete g.ingat;
        names.push(e.subject);
      }
      const saved = await saveData();
      await saveSched();
      const who = p.target === "*" ? `semua grup (${names.length})` : `"${names[0]}"`;
      let msg;
      if (p.kind === "window") msg = `⏰ Jam pantun ${who}: ${p.window === "reset" ? `bawaan ${hm(config.pantunWindow.from)}–${hm(config.pantunWindow.to)}` : `${hm(p.window.from)}–${hm(p.window.to)}`} (jam acak dipilih di dalam rentang itu).`;
      else {
        const what = p.flags.length === ALL_FLAGS.length ? "humor lengkap (gaya + pantun harian + roasting ringan + balas chat acak + chat otomatis harian)" : FLAG_LABEL[p.flags[0]];
        msg = `${p.value ? "😄 Dinyalakan" : "🔕 Dimatikan"}: ${what} untuk ${who}.${p.value && p.flags.includes("roast") ? `\nRoast: maks ${config.roastMaxPerDay}×/hari, hanya saat obrolan santai; pesan grup yang tidak memanggil bot dibaca sebentar di memori (≈${config.bufferSize} pesan, tidak disimpan).` : ""}${p.value && p.flags.includes("latihan") ? (review ? "\nMode latihan: draf balasan & chat otomatis dikirim DULU ke Telegram-mu dengan tombol ✅ Kirim / ❌ Buang; yang kamu pilih menjadi contoh belajar. Matikan: /humor latihan off <grup>." : "\n⚠️ Pengiriman draf ke Telegram belum tersedia di bot ini, jadi balasan/chat otomatis TIDAK akan dikirim selama mode latihan menyala.") : ""}${p.value && p.flags.includes("lihat") ? visualNote() : ""}${p.value && p.flags.includes("ingat") ? `\nIngat: bot mencatat HAL RINGAN yang anggota ceritakan tentang dirinya sendiri (mis. "aku suka kopi hitam", "besok aku mau ke pantai") untuk menyinggungnya sesekali. Hal sensitif (kesehatan, uang, agama, keluarga, dll) ditolak kode. Rencana/aktivitas hilang dalam 1-3 hari, hal lain setelah ${config.ingatHari} hari tanpa disebut lagi. Anggota bisa lihat "bot ingat apa tentang aku" dan menghapus dengan "bot lupakan aku" (setelah itu tidak dicatat lagi). Perlu /humor balas atau sapa menyala.` : ""}${p.value && p.flags.includes("balas") ? `\nBalas: sesekali membalas (reply) chat anggota setelah membaca ${config.contextSize} chat sebelumnya; obrolan dibaca sebentar di memori saja (tidak disimpan). Anggota bisa menolak: "bot jangan balas chatku".` : ""}${p.value && p.flags.includes("sapa") ? `\nSapa: minimal ${config.sapaPerDay}× sehari bot membuka obrolan sendiri (jam menyebar ${hm(config.sapaWindow.from)}–${hm(config.sapaWindow.to)}). Coba satu sekarang: /humor tes sapa ${p.target}` : ""}${p.value && p.flags.includes("pantun") ? `\nPantun: sekali sehari di jam acak ${hm(windowOf(data.groups[keyOf(r.entries[0].account, r.entries[0].id)]).from)}–${hm(windowOf(data.groups[keyOf(r.entries[0].account, r.entries[0].id)]).to)}.` : ""}`;
      }
      return `${msg}${saved ? "" : "\n⚠️ Gagal menyimpan ke database: berlaku sampai bot restart saja."}`;
    } catch (e) {
      return `⚠️ ${e instanceof Error ? e.message : e}`;
    }
  }

  function describe() {
    const n = Object.values(data.groups).filter((g) => anyFlag(g)).length;
    return n ? `AKTIF di ${n} grup` : "mati di semua grup";
  }

  return { load, settings, anyEnabled, chatNote, observe, observeMedia, addToKoleksi, visionReady, noteBotSaid, noteTriggered, handlePreference, evaluate, roastNow, evaluateBalas, balasNow, check, checkSapa, decide, handle, describe, _debug: { stickers: () => stickers, ensureDescribed, evaluateStickerReply, considerStickerReply, processSticker, data: () => data, sched: () => sched, buffers, ctxBuf, lastSpontAt, styles: () => styles, feedbacks: () => feedbacks, pending, lastBot } };
}
