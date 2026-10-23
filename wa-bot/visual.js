// Bagian murni untuk kemampuan "melihat" di mode humor grup: membaca gambar & stiker, perpustakaan stiker per grup, dan pemilihan stiker balasan.
// Logika berstatus ada di createHumor (humor.js); pemanggilan AI penglihatan & pengiriman stiker disuntikkan dari index.js.
//
// Aturan privasi: gambar TIDAK pernah disimpan -- hanya dikirim sekali ke AI untuk dideskripsikan (1 kalimat), deskripsinya cuma di memori.
// Stiker (bukan foto orang) disimpan sebagai berkas kecil per grup untuk dipakai membalas; dibatasi jumlahnya dan hanya bila pemilik menyalakan "lihat" di grup itu.

const num = (v, d, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(hi, Math.max(lo, n)) : d;
};

export function readVisualConfig(env = process.env) {
  return {
    gambarMaxBytes: Math.floor(num(env.WA_LIHAT_GAMBAR_MAX_MB, 4, 0.2, 15) * 1024 * 1024), // gambar lebih besar dari ini tidak dibaca
    stikerMaxBytes: 600 * 1024,
    visiPerDay: Math.floor(num(env.WA_LIHAT_PER_DAY, 30, 0, 500)), // jatah panggilan AI penglihatan per grup per hari (deskripsi gambar + label stiker)
    stikerLibMax: Math.floor(num(env.WA_STIKER_MAX, 40, 5, 200)), // jumlah stiker tersimpan per grup
    stikerBalasChance: num(env.WA_STIKER_CHANCE, 0.12, 0, 1), // peluang membalas stiker orang dengan stiker
    stikerGapMs: Math.floor(num(env.WA_STIKER_GAP_MIN, 10, 1, 24 * 60)) * 60_000,
    stikerMaxPerDay: Math.floor(num(env.WA_STIKER_MAX_PER_DAY, 10, 0, 200)), // 0 = bot tidak pernah mengirim stiker
    fotoBalasFactor: num(env.WA_FOTO_BALAS_FACTOR, 1.5, 0, 5) // foto lebih menarik dikomentari daripada chat biasa
  };
}

// ---------------------------------------------------------------- label stiker
export const STICKER_TAGS = ["tawa", "senang", "sedih", "kaget", "kesal", "setuju", "terimakasih", "semangat", "bingung", "lain"];

/** Stiker yang diterima dengan label X -> label stiker yang pantas dijadikan balasan. Kosong = bot diam (suasana berat). */
export const STICKER_REPLY_TAGS = {
  tawa: ["tawa", "senang"],
  senang: ["senang", "tawa", "semangat"],
  terimakasih: ["senang", "setuju"],
  kaget: ["kaget", "tawa"],
  setuju: ["setuju", "senang"],
  semangat: ["semangat", "senang"],
  bingung: ["bingung", "tawa"],
  lain: ["tawa", "senang", "setuju"],
  sedih: [],
  kesal: []
};

const clean1 = (s, n) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/^["“”'`*\-\s]+|["“”'`*\s]+$/g, "").trim().slice(0, n);
const HAS_LINK_OR_MENTION = /https?:\/\/|www\.|@\d{4,}|\b\d{8,}\b/i;

// ---------------------------------------------------------------- prompt & penyaring: GAMBAR
export const IMAGE_SYSTEM = `Kamu membantu bot grup WhatsApp memahami sebuah gambar. Jawab dengan SATU kalimat bahasa Indonesia (maks 120 karakter) yang menjelaskan apa adanya isi gambar: objek utama, suasana, dan tulisan yang jelas terbaca. ATURAN: jangan menyebut atau menebak nama/identitas orang dari wajahnya; jangan menebak hal yang tidak terlihat; jangan menyalin nomor/data pribadi. Jika gambar berisi tubuh telanjang, kekerasan/luka, dokumen identitas, kartu/rekening, atau layar berisi data pribadi, jawab persis satu kata: SENSITIF.`;

export function buildImageUserPrompt(caption = "") {
  const c = clean1(caption, 120);
  return c ? `Gambar ini dikirim di grup dengan keterangan: "${c}". Jelaskan isinya.` : "Jelaskan isi gambar ini.";
}

/** Jawaban AI -> { ok: true, desc } | { ok: false, reason }. */
export function cleanImageDescription(raw) {
  const t = clean1(raw, 400);
  if (!t) return { ok: false, reason: "kosong" };
  if (/^sensitif\b/i.test(t)) return { ok: false, reason: "sensitif" };
  if (/\bsensitif\b/i.test(t) && t.length < 25) return { ok: false, reason: "sensitif" };
  if (HAS_LINK_OR_MENTION.test(t)) return { ok: false, reason: "memuat data pribadi/tautan" };
  const desc = t.split(/(?<=[.!?])\s+/)[0].slice(0, 140).replace(/[.!?]+$/, "");
  if ((desc.match(/\p{L}/gu) || []).length < 4) return { ok: false, reason: "terlalu pendek" };
  return { ok: true, desc };
}

// ---------------------------------------------------------------- prompt & penyaring: STIKER
export const STICKER_SYSTEM = `Kamu membantu bot grup WhatsApp memahami sebuah STIKER. Jawab dalam SATU baris persis berformat:
<label> | <deskripsi>
<label> HARUS salah satu dari: ${STICKER_TAGS.join(", ")}. <deskripsi> = maks 60 karakter bahasa Indonesia: apa yang digambarkan dan perasaannya (contoh: "kucing tertawa terbahak-bahak"). Jangan menyebut nama orang dari wajah. Jika stiker bertuliskan kata kasar/SARA/vulgar atau menggambarkan hal tidak pantas, jawab persis: lain | SENSITIF`;

/** "tawa | kucing tertawa" -> { tag, desc } | null. Label di luar daftar -> "lain". Stiker SENSITIF -> { sensitive: true }. */
export function parseStickerTag(raw) {
  const line = clean1(String(raw ?? "").split(/\r?\n/).find((l) => l.trim()) || "", 200);
  if (!line) return null;
  const m = /^([A-Za-z]+)\s*[|:–-]\s*(.+)$/.exec(line);
  if (!m) {
    const only = line.toLowerCase().replace(/[^a-z]/g, "");
    return STICKER_TAGS.includes(only) && only === line.toLowerCase() ? { tag: only, desc: "" } : null; // tanpa format: hanya label tunggal yang diterima
  }
  const tagRaw = m[1].toLowerCase();
  const tag = STICKER_TAGS.includes(tagRaw) ? tagRaw : "lain";
  const desc = clean1(m[2], 80);
  if (/sensitif/i.test(desc)) return { sensitive: true, tag: "lain", desc: "" };
  if (HAS_LINK_OR_MENTION.test(desc)) return { tag, desc: "" };
  return { tag, desc };
}

// ---------------------------------------------------------------- perpustakaan stiker
/**
 * Pilih stiker balasan dari perpustakaan: label cocok dengan label stiker yang diterima, bukan stiker yang sama dengan yang diterima,
 * bukan yang baru dipakai. Yang jarang dipakai bot diutamakan. -> item | null
 */
export function pickStickerFor(library, receivedTag, { excludeIds = [], avoidIds = [], random = Math.random } = {}) {
  const wanted = STICKER_REPLY_TAGS[receivedTag] ?? STICKER_REPLY_TAGS.lain;
  if (!wanted.length) return null;
  const pool = (library || []).filter((s) => s && s.tag && wanted.includes(s.tag) && !excludeIds.includes(s.id));
  if (!pool.length) return null;
  const fresh = pool.filter((s) => !avoidIds.includes(s.id));
  const from = fresh.length ? fresh : pool;
  const weights = from.map((s) => 1 / (1 + (s.uses || 0)) + (wanted[0] === s.tag ? 0.5 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < from.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return from[i];
  }
  return from[from.length - 1];
}

/** Tambah/perbarui stiker di perpustakaan (in-place). Penuh -> yang paling jarang muncul & paling lama dibuang. -> { added, evicted? } */
export function addToLibrary(library, item, max) {
  const hit = library.find((s) => s.id === item.id);
  if (hit) {
    hit.seen = (hit.seen || 1) + 1;
    hit.ts = item.ts;
    if (!hit.tag && item.tag) {
      hit.tag = item.tag;
      hit.desc = item.desc || "";
    }
    return { added: false };
  }
  let evicted = null;
  if (library.length >= max) {
    let worst = 0;
    const score = (s) => (s.seen || 1) * 1000 + (s.uses || 0) * 10 + (s.ts || 0) / 1e12; // jarang terlihat + lama = dibuang
    library.forEach((s, i) => {
      if (score(s) < score(library[worst])) worst = i;
    });
    evicted = library.splice(worst, 1)[0];
  }
  library.push({ id: item.id, tag: item.tag || "", desc: item.desc || "", seen: 1, uses: 0, ts: item.ts });
  return { added: true, evicted };
}

// ---------------------------------------------------------------- pertanyaan ke bot tentang gambar/stiker
const IMAGE_QUESTION_RE = /\b(?:gambar|foto|stiker|sticker|pic|screenshot|ss|ini apa|itu apa|ini siapa|apa ini|apa itu|tulisan|bacain|baca(?:kan)?|jelasin|jelaskan|artinya|maksud(?:nya)?|lihat|liat|lucu|kenapa|kok)\b/i;

/** Teks pemanggil bot yang sepertinya bertanya tentang gambar/stiker (kosong juga dihitung: "@bot" + balas gambar). */
export function looksLikeImageQuestion(text) {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (t.length > 200) return false;
  return IMAGE_QUESTION_RE.test(t);
}

export const IMAGE_QA_SYSTEM = `Kamu Ayyubi, asisten grup WhatsApp yang ramah dan singkat. Kamu diminta melihat sebuah gambar/stiker. Jawab dalam bahasa Indonesia santai, maksimal 3 kalimat pendek, berdasarkan APA YANG TERLIHAT saja. Jika ada tulisan, bacakan bagian yang relevan. ATURAN: jangan menyebut atau menebak identitas orang dari wajah; jangan menebak hal yang tidak terlihat (katakan kalau tidak yakin); jangan menyalin nomor rekening/NIK/data pribadi; kalau gambarnya berisi hal sensitif (tubuh telanjang, kekerasan, dokumen identitas, data rekening) tolak halus dengan satu kalimat. Tanpa tautan atau mention.`;

export function buildImageQaPrompt(question) {
  const q = clean1(question, 200);
  return q ? `Pertanyaan/permintaan: "${q}". Jawab berdasarkan gambar.` : "Tidak ada pertanyaan khusus. Ceritakan singkat apa isi gambar ini dengan gaya santai.";
}
