// Lapisan "manusiawi" untuk Ayyubi di grup WhatsApp: gaya grup, kepekaan suasana, reaksi emoji, ritme pesan, ingatan anggota (opt-in),
// momen/hari khusus, dan pembelajaran dari umpan balik. Semua fungsi di sini MURNI (tanpa jaringan/penyimpanan) supaya mudah dites;
// penyimpanan dan pengiriman ada di createHumor (humor.js).
//
// Prinsip: natural, bukan menyamar. Ayyubi tidak mengaku manusia dan tidak mengarang pengalaman fisik; ia hanya lebih peka,
// lebih ringkas, dan lebih pas waktu.

// ---------------------------------------------------------------- gaya grup (hanya hitungan, tanpa menyimpan isi chat)
const PARTICLES = ["nih", "dong", "sih", "deh", "lah", "kok", "banget", "bgt", "aja", "aj", "yuk", "yok", "mah", "tuh", "loh", "lho", "kan", "gaes", "guys", "gan", "kuy", "cuy", "wes", "rek", "ya", "yaa"];
const HONORIFICS = ["kak", "kakak", "mas", "mbak", "mba", "bang", "abang", "bu", "ibu", "pak", "bapak", "om", "tante", "bos", "bro", "sis", "gan", "beb"];
const LAUGHS = [
  ["wkwk", /\bw(?:k|w)*k+(?:w|k)*\b|\bwk{2,}/i],
  ["haha", /\bha(?:ha)+h?\b|\bhah+a+\b/i],
  ["hehe", /\bhe(?:he)+h?\b/i],
  ["xixi", /\bxi(?:xi)+\b/i],
  ["kwkw", /\bkw(?:kw)+\b/i],
  ["lol", /\blo+l\b/i]
];
const FORMAL_RE = /\b(mohon|izin|dimohon|bersama ini|terima kasih atas|selamat (?:pagi|siang|sore|malam)|rekan-rekan|bapak\/ibu|yth)\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export const emptyStyle = () => ({ n: 0, words: 0, emoji: {}, emojiTotal: 0, particles: {}, honorifics: {}, laugh: {}, formal: 0, excl: 0, lower: 0 });

const bump = (obj, k, by = 1) => {
  obj[k] = (obj[k] || 0) + by;
};
const topKeys = (obj, k) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, k).map(([key]) => key);
function trimCounts(obj, keep) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  for (const [k] of entries.slice(keep)) delete obj[k];
}

/** Perbarui hitungan gaya dari satu pesan (hanya penghitung; teksnya tidak disimpan). Mengubah `style` di tempat. */
export function updateStyle(style, text) {
  const t = String(text ?? "").trim();
  if (!t || t.length > 600) return style; // pengumuman panjang tidak mewakili gaya ngobrol
  style.n += 1;
  const lower = t.toLowerCase();
  const words = lower.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  style.words += words.length;
  for (const w of words) {
    if (PARTICLES.includes(w)) bump(style.particles, w);
    if (HONORIFICS.includes(w)) bump(style.honorifics, w);
  }
  for (const [name, re] of LAUGHS) if (re.test(t)) bump(style.laugh, name);
  const emos = t.match(EMOJI_RE) || [];
  for (const e of emos) bump(style.emoji, e);
  style.emojiTotal += emos.length;
  if (FORMAL_RE.test(t)) style.formal += 1;
  if (/!/.test(t)) style.excl += 1;
  if (t === lower) style.lower += 1;
  trimCounts(style.emoji, 12);
  trimCounts(style.particles, 12);
  trimCounts(style.honorifics, 8);
  if (style.n > 400) {
    // peluruhan: gaya terbaru lebih berpengaruh daripada gaya berbulan-bulan lalu
    for (const k of ["n", "words", "emojiTotal", "formal", "excl", "lower"]) style[k] = Math.floor(style[k] / 2);
    for (const group of ["emoji", "particles", "honorifics", "laugh"]) {
      for (const k of Object.keys(style[group])) {
        style[group][k] = Math.floor(style[group][k] / 2);
        if (style[group][k] <= 0) delete style[group][k];
      }
    }
  }
  return style;
}

/** Ringkasan gaya untuk prompt, atau "" bila datanya belum cukup (< 20 pesan). */
export function describeStyle(style) {
  if (!style || style.n < 20) return "";
  const avg = style.words / style.n;
  const parts = [];
  parts.push(avg < 6 ? `chat biasanya pendek (±${Math.max(1, Math.round(avg))} kata)` : avg < 14 ? `chat biasanya sedang (±${Math.round(avg)} kata)` : `chat biasanya panjang (±${Math.round(avg)} kata)`);
  const rate = style.emojiTotal / style.n;
  const topEmoji = topKeys(style.emoji, 3);
  if (rate >= 0.25 && topEmoji.length) parts.push(`sering pakai emoji (${topEmoji.join(" ")})`);
  else if (rate < 0.08) parts.push("jarang pakai emoji");
  const laugh = topKeys(style.laugh, 1)[0];
  if (laugh) parts.push(`tawa khasnya "${laugh}"`);
  const particles = topKeys(style.particles, 4);
  if (particles.length) parts.push(`sering memakai kata ${particles.map((p) => `"${p}"`).join(", ")}`);
  const hon = topKeys(style.honorifics, 2);
  if (hon.length) parts.push(`sapaan umum ${hon.map((p) => `"${p}"`).join(" / ")}`);
  parts.push(style.formal / style.n > 0.15 ? "nada agak formal/kantoran" : "nada santai");
  if (style.lower / style.n > 0.7) parts.push("kebanyakan huruf kecil semua");
  return `Gaya grup ini (dipelajari dari obrolan mereka -- ikuti nadanya, jangan berlebihan): ${parts.join("; ")}.`;
}

// ---------------------------------------------------------------- suasana hati
const MOOD_RES = [
  ["sedih", /\b(sedih|nangis|menangis|galau|kecewa|patah hati|putus asa|stres|stress|depresi|down banget|menyerah|kehilangan|ditinggal|berduka|dukacita|innalillahi|meninggal|wafat)\b/i],
  ["kesal", /\b(kesal|kesel|sebel|sebal|jengkel|marah|emosi|bete|ngeselin|menyebalkan|muak|dongkol)\b/i],
  ["ulangtahun", /\b(ulang tahun|ultah|hbd|happy birthday|milad)\b/i],
  ["lelah", /\b(capek|cape|capai|lelah|ngantuk|lembur|begadang|penat|pegel|sibuk banget|kurang tidur)\b/i],
  ["senang", /\b(alhamdulillah|senang|seneng|bahagia|lulus|diterima|promosi|berhasil|sukses|menang|juara|akhirnya|cair|gajian|lolos|selamat ya|congrats|yeay|yey)\b/i],
  ["terimakasih", /\b(makasih|terima kasih|thanks|thank you|thx|tengkyu|trims)\b/i],
  ["bingung", /\b(bingung|gimana ya|gmn ya|nggak ngerti|ga ngerti|gak ngerti|nyasar)\b/i],
  ["tawa", /\b(wk(?:wk)+|haha+|hehe+|ngakak|kocak|lucu banget|xixi|lol)\b/i]
];

/** Suasana pesan: sedih | kesal | ulangtahun | lelah | senang | terimakasih | bingung | tawa | null. */
export function detectMood(text) {
  const t = String(text ?? "");
  for (const [mood, re] of MOOD_RES) if (re.test(t)) return mood;
  return null;
}

/** Suasana yang membuat Ayyubi sebaiknya DIAM (tidak bercanda, tidak menyela). */
export const SILENT_MOODS = new Set(["sedih", "kesal"]);

const MOOD_HINTS = {
  lelah: "Pesan ini bernada capek/lelah: tanggapi dengan empati hangat yang singkat (mis. semangat, istirahat sebentar), jangan bercanda yang meremehkan.",
  senang: "Pesan ini kabar baik/senang: ikut senang dan beri selamat dengan tulus.",
  terimakasih: "Pesan ini ucapan terima kasih: balas ramah dan sangat singkat.",
  ulangtahun: "Pesan ini soal ulang tahun: ucapkan selamat/doa baik dengan hangat.",
  tawa: "Pesan ini bernada tawa/lucu: boleh ikut tertawa atau menimpali singkat.",
  bingung: "Pesan ini bernada bingung: tanggapi menenangkan dan singkat; bila butuh info pasti, ajak orangnya memanggilmu."
};
export const moodHint = (mood) => MOOD_HINTS[mood] || "";

// ---------------------------------------------------------------- reaksi emoji
export const REACTION_ALLOW = ["👍", "😂", "🙏", "🎉", "👏", "💪", "❤️", "😮", "🔥"];
const MOOD_REACTION = { ulangtahun: "🎉", senang: "👏", terimakasih: "🙏", tawa: "😂", lelah: "💪" };

/** Emoji reaksi yang pas untuk suasana pesan (aturan murni, tanpa AI), atau null. */
export function pickReaction(mood) {
  return MOOD_REACTION[mood] || null;
}

/** Keluaran AI "REAKSI: 😂" -> emoji yang diizinkan, atau null. */
export function parseReactionOutput(raw) {
  const m = /^\s*REAKSI\s*[:：]?\s*(\S+)/i.exec(String(raw ?? ""));
  if (!m) return null;
  const e = m[1].replace(/️/g, "");
  return REACTION_ALLOW.find((x) => x.replace(/️/g, "") === e) || null;
}

// ---------------------------------------------------------------- membaca situasi percakapan
const GROUP_ADDRESS_RE = /\b(ada yang|siapa (?:yang|di sini)|menurut kalian|teman-teman|temen-temen|guys|gaes|semua(?:nya)?|kalian|rek|bapak\/ibu|rekan-rekan|ada yg)\b/i;

/** Dua orang sedang ngobrol berdua (6 chat manusia terakhir = tepat 2 pengirim, bergantian)? Pesan yang menyapa "kalian/ada yang" dikecualikan. */
export function isDuoChat(humans, latestText = "") {
  const last = humans.slice(-6);
  if (last.length < 4) return false;
  const senders = new Map();
  for (const m of last) {
    const id = (m.ids && m.ids[0]) || m.name || "?";
    senders.set(id, (senders.get(id) || 0) + 1);
  }
  if (senders.size !== 2) return false;
  if ([...senders.values()].some((c) => c < 2)) return false;
  return !GROUP_ADDRESS_RE.test(String(latestText));
}

/** Pesan ditujukan ke orang tertentu lain di grup ("Budi, udah makan?" / "mas Budi ...")? */
export function addressedToOther(text, otherNames = []) {
  const names = [...new Set(otherNames.map((n) => String(n || "").trim().split(/\s+/)[0].toLowerCase()).filter((n) => n.length >= 2))];
  if (!names.length) return false;
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`^\\s*(?:(?:mas|mbak|mba|kak|kakak|bang|pak|bu|ibu|bapak|om|tante|dik|dek)\\s+(?:${esc})\\b|(?:${esc})\\b\\s*[,:!?])`, "i");
  return re.test(String(text ?? ""));
}

// ---------------------------------------------------------------- ritme pesan
/** Pecah balasan menjadi 1-2 gelembung. Dua baris dari AI = dua gelembung; teks panjang kadang dipecah di batas kalimat. */
export function splitBubbles(text, { random = Math.random } = {}) {
  const raw = String(text ?? "").trim();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) return [lines[0], lines.slice(1).join(" ")].filter((x) => x.length >= 2);
  if (raw.length >= 100 && random() < 0.35) {
    const mid = Math.floor(raw.length / 2);
    const cuts = [];
    for (const m of raw.matchAll(/[.!?]+\s+/g)) cuts.push(m.index + m[0].length);
    const best = cuts.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    if (best && best > 25 && raw.length - best > 20) return [raw.slice(0, best).trim(), raw.slice(best).trim()];
  }
  return [raw];
}

// ---------------------------------------------------------------- hari & momen khusus
const FIXED_DAYS = {
  "01-01": "Tahun Baru Masehi",
  "04-21": "Hari Kartini",
  "05-01": "Hari Buruh",
  "05-02": "Hari Pendidikan Nasional",
  "05-20": "Hari Kebangkitan Nasional",
  "06-01": "Hari Lahir Pancasila",
  "08-17": "HUT Kemerdekaan RI",
  "10-02": "Hari Batik Nasional",
  "10-28": "Hari Sumpah Pemuda",
  "11-10": "Hari Pahlawan",
  "11-25": "Hari Guru Nasional",
  "12-22": "Hari Ibu"
};

/** Momen hari ini untuk bahan obrolan: hari khusus tetap + hari khusus dari pemilik (WA_HARI_KHUSUS="MM-DD=Teks;...") + ritme pekan/bulan. */
export function occasionsFor({ day, weekday }, extra = "") {
  const out = [];
  const md = String(day || "").slice(5);
  if (FIXED_DAYS[md]) out.push(FIXED_DAYS[md]);
  for (const part of String(extra || "").split(";")) {
    const m = /^\s*(\d{2}-\d{2})\s*=\s*(.{2,60})\s*$/.exec(part);
    if (m && m[1] === md) out.push(m[2].trim());
  }
  const dom = Number(String(day || "").slice(8, 10)) || 0;
  if (weekday === "Senin") out.push("awal pekan (Senin)");
  else if (weekday === "Jumat") out.push("hari Jumat, menjelang akhir pekan");
  else if (weekday === "Sabtu" || weekday === "Minggu") out.push("akhir pekan");
  if (dom >= 26) out.push("akhir bulan");
  else if (dom >= 1 && dom <= 2) out.push("awal bulan");
  return out;
}

// ---------------------------------------------------------------- ingatan anggota (opt-in, hanya yang diminta sendiri)
const SELF_RE = /\b(aku|saya|gue|gw|gua|sy|ane)\b|\b\w{2,}ku\b/i;
const SENSITIVE_RE = new RegExp(
  "\\b(?:sakit|penyakit|diabetes|kanker|jantung|darah tinggi|depresi|cemas|obat|dokter|operasi|hamil|gaji|penghasilan|utang|hutang|pinjam|pinjol|cicilan|kredit|pajak|rekening|saldo|nik|ktp|paspor|password|sandi|pin|otp|agama|politik|partai|pilkada|pilpres|cerai|selingkuh|pacar|mantan|suami|istri|anak|orang tua|ortu|alamat|rumah di|tinggal di|nomor|no hp|email|suku|ras|gay|lgbt|lesbi|trans|narkoba|judi|slot|toto)(?:ku|mu|nya)?\\b",
  "i"
);
export const MEMORY_MAX_FACTS = 5;
export const MEMORY_REFUSE_TEXT = "yang itu tidak kusimpan ya (aku hanya menyimpan hal ringan seperti hobi, makanan/minuman favorit, atau panggilan)";

const MONTHS = { januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12 };

/** "ulang tahunku 12 Oktober" -> { d: 12, m: 10 } | null (tanpa tahun lahir/umur). */
export function parseBirthday(text) {
  const m = /\b(?:ulang tahun|ultah)\w*\s*(?:aku|saya|ku)?\s*(?:itu|tanggal|tgl|yaitu|:)?\s*(\d{1,2})\s+([a-z]{3,9})\b/i.exec(String(text ?? ""));
  if (!m) return null;
  const d = Number(m[1]);
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo || d < 1 || d > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]) return null;
  return { d, m: mo };
}

/** Perintah ingatan dari anggota ke bot. -> { cmd: "remember"|"forget"|"show"|"nick", ... } | null */
export function parseMemoryCmd(text) {
  const t = String(text ?? "").trim();
  if (!t || t.length > 220) return null;
  const NAME = "(?:bot|ayyubi)";
  let m = new RegExp(`\\b${NAME}\\b[,:\\s]+(?:tolong\\s+|coba\\s+)?panggil\\s+(?:aku|saya|gue|gw)\\s+(?:dengan\\s+|jadi\\s+)?([\\p{L}][\\p{L}\\p{N} ]{1,20})\\s*$`, "iu").exec(t);
  if (m) return { cmd: "nick", nick: m[1].trim() };
  if (new RegExp(`\\b${NAME}\\b[^.!?\\n]{0,30}\\b(?:ingat|tahu)\\s+apa\\b[^.!?\\n]{0,30}\\b(?:tentang|soal)\\s+(?:aku|saya|gue|gw)\\b`, "i").test(t)) return { cmd: "show" };
  if (new RegExp(`\\b${NAME}\\b[^.!?\\n]{0,25}\\b(?:lupa(?:kan)?|hapus(?:kan)?)\\b[^.!?\\n]{0,40}\\b(?:aku|saya|gue|gw)\\b`, "i").test(t) && !/roast|balas|chat/i.test(t)) return { cmd: "forget" };
  m = new RegExp(`\\b${NAME}\\b[,:\\s]+(?:tolong\\s+|coba\\s+)?(?:ingat(?:kan)?|catat)(?:\\s+ya)?[,:\\s]+(?:bahwa\\s+)?(.{3,140})$`, "i").exec(t);
  if (m) return { cmd: "remember", fact: m[1].trim().replace(/[.!\s]+$/, "") };
  return null;
}

/** Fakta layak disimpan? -> { ok, text } | { ok: false, reason } */
export function sanitizeFact(fact) {
  let t = String(fact ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 4) return { ok: false, reason: "terlalu pendek" };
  if (t.length > 120) return { ok: false, reason: "terlalu panjang" };
  if (/https?:|www\.|@\w|\d{6,}/.test(t)) return { ok: false, reason: "memuat tautan/nomor" };
  if (!SELF_RE.test(t)) return { ok: false, reason: "bukan tentang dirinya sendiri" };
  if (SENSITIVE_RE.test(t)) return { ok: false, reason: "sensitif" };
  t = t.replace(/\b(?:ya|dong)\b[!. ]*$/i, "").trim();
  return { ok: true, text: t };
}

// ---------------------------------------------------------------- pembelajaran dari umpan balik
export const emptyFeedback = () => ({ good: [], bad: [], kinds: {} });

/** Bobot jenis pesan dari tingkat respons grup: (respons+1)/(terkirim+2), tidak pernah di bawah 0.15 supaya tetap dicoba. */
export function kindWeights(feedback, ids) {
  const out = {};
  for (const id of ids) {
    const k = feedback?.kinds?.[id];
    const w = k ? (k.eng + 1) / (k.sent + 2) : 0.5;
    out[id] = Math.max(0.15, w);
  }
  return out;
}

/** Pengali peluang balasan dari tingkat respons grup terhadap balasan bot (≥ 15 balasan baru dihitung). */
export function balasEngagementFactor(feedback) {
  const k = feedback?.kinds?.balas;
  if (!k || k.sent < 15) return 1;
  const rate = k.eng / k.sent;
  return Math.min(1.5, Math.max(0.5, 0.5 + rate * 2));
}

export function pushExample(list, text, max = 10) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!t) return list;
  const idx = list.indexOf(t);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(t);
  while (list.length > max) list.pop();
  return list;
}

export function fewShotNote(feedback) {
  if (!feedback) return "";
  const parts = [];
  if (feedback.good?.length) parts.push(`Contoh pesan yang DISUKAI pemilik (tiru nada dan panjangnya, jangan disalin): ${feedback.good.slice(0, 4).map((x) => `"${x}"`).join(" | ")}`);
  if (feedback.bad?.length) parts.push(`Contoh pesan yang DITOLAK pemilik (hindari gaya seperti ini): ${feedback.bad.slice(0, 3).map((x) => `"${x}"`).join(" | ")}`);
  return parts.join("\n");
}
