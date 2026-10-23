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
    stikerMaxPerDay: Math.floor(num(env.WA_STIKER_MAX_PER_DAY, 0, -1, 5000)), // 0 = tanpa batas harian (diatur peluang & jeda); -1 = bot tidak pernah mengirim stiker
    fotoBalasFactor: num(env.WA_FOTO_BALAS_FACTOR, 1.5, 0, 5), // foto lebih menarik dikomentari daripada chat biasa
    koleksiMax: Math.floor(num(env.WA_KOLEKSI_MAX, 100, 5, 300)), // jumlah stiker koleksi pemilik
    stikerDariPemilik: /^(1|true|ya|yes|on|aktif)$/i.test(String(env.WA_STIKER_DARI_PEMILIK ?? "").trim()), // otomatis menyimpan stiker yang KAMU kirim dari HP ke koleksi
    stikerTeksFactor: num(env.WA_STIKER_TEKS_FACTOR, 0.5, 0, 3) // stiker berlabel kadang ditanggapi dengan kalimat (pengali WA_BALAS_CHANCE)
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

/** Emoji reaksi untuk stiker berlabel X (sedih/kesal tidak direaksi: suasana berat). */
export const STICKER_REACTION = { tawa: "😂", senang: "😊", kaget: "😮", setuju: "👍", terimakasih: "🙏", semangat: "💪", bingung: "🤔", lain: "👍" };

const stripDeskripsi = (t) => t.replace(/^deskripsi\s*[:=-]\s*/i, "").trim();

/**
 * Jawaban AI -> { tag, desc } | { sensitive: true } | null. Toleran terhadap gaya AI: **tebal**, "Label: x | Deskripsi: y", dua baris,
 * label asing -> "lain". Jawaban tanpa format dan tanpa label yang dikenal -> null.
 */
export function parseStickerTag(raw) {
  const text = String(raw ?? "").replace(/[*_`#>]+/g, " ");
  const lines = text.split(/\r?\n/).map((l) => clean1(l, 200)).filter(Boolean);
  if (!lines.length) return null;
  if (/\bsensitif\b/i.test(lines.join(" "))) return { sensitive: true, tag: "lain", desc: "" };
  const first = lines[0];
  const finish = (tagRaw, descRaw) => {
    const t = String(tagRaw).toLowerCase().replace(/[^a-z]/g, "");
    const tag = STICKER_TAGS.includes(t) ? t : "lain";
    let desc = clean1(stripDeskripsi(clean1(descRaw, 200)), 80);
    if (!desc) {
      const dl = lines.slice(1).find((l) => /^deskripsi\s*[:=-]/i.test(l)) || lines[1] || "";
      desc = clean1(stripDeskripsi(dl), 80);
    }
    if (HAS_LINK_OR_MENTION.test(desc)) desc = "";
    return { tag, desc };
  };
  // "Label: kaget | Deskripsi: kucing terkejut" / "label = kaget"
  const lab = /^label\s*[:=-]\s*([A-Za-z]+)\s*(?:[|;,-]\s*(.*))?$/i.exec(first);
  if (lab) return finish(lab[1], lab[2] || "");
  const m = /^([A-Za-z]+)\s*[|:–—-]\s*(.+)$/.exec(first);
  if (m) return finish(m[1], m[2]);
  const only = first.toLowerCase().replace(/[^a-z]/g, "");
  if (STICKER_TAGS.includes(only) && only === first.toLowerCase()) return finish(only, "");
  // AI menjawab kalimat bebas ("Stiker ini menampilkan kucing yang sedang tertawa"): label ditebak dari katanya; tak ada petunjuk = tidak ditebak
  const guess = guessTagFromText(lines.join(" "));
  return guess ? { tag: guess, desc: clean1(lines[0], 80) } : null;
}

const TAG_HINTS = [
  ["kesal", /\b(marah|kesal|jengkel|emosi|geram|benci)\b/i],
  ["sedih", /\b(sedih|menangis|nangis|air mata|kecewa|murung|galau)\b/i],
  ["tawa", /\b(tertawa|tawa|ngakak|terbahak|tertawa|lucu|cekikikan|menertawakan)\b/i],
  ["kaget", /\b(kaget|terkejut|shock|syok|melongo|terperanjat)\b/i],
  ["terimakasih", /\b(terima kasih|makasih|bersyukur|berterima)\b/i],
  ["setuju", /\b(setuju|jempol|acungan|oke|mengangguk|menyetujui)\b/i],
  ["semangat", /\b(semangat|menyemangati|berjuang|kuat|otot)\b/i],
  ["bingung", /\b(bingung|heran|bertanya-tanya|garuk kepala|tanda tanya|berpikir)\b/i],
  ["senang", /\b(senang|bahagia|gembira|tersenyum|senyum|cinta|hati|melompat|bersorak)\b/i]
];
/** Tebak label dari kalimat deskripsi. Sedih/kesal diperiksa lebih dulu supaya tidak salah dianggap ceria. -> label | null */
export function guessTagFromText(text) {
  const t = String(text ?? "");
  for (const [tag, re] of TAG_HINTS) if (re.test(t)) return tag;
  return null;
}

// ---------------------------------------------------------------- stiker animasi
/**
 * Stiker animasi WebP -> WebP statis dari bingkai pertama (AI penglihatan & ffmpeg sering gagal membaca yang animasi).
 * Stiker statis dikembalikan apa adanya. -> { buffer, animated }
 */
export function webpFirstFrame(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return { buffer: buf, animated: false };
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    const end = start + size;
    if (end > buf.length) break;
    if (id === "ANMF") {
      let p = start + 16; // 16 byte: posisi, ukuran, durasi, flag bingkai
      while (p + 8 <= end) {
        const sid = buf.toString("ascii", p, p + 4);
        const ssz = buf.readUInt32LE(p + 4);
        if (p + 8 + ssz > end) break;
        if (sid === "VP8 " || sid === "VP8L") {
          const data = buf.subarray(p + 8, p + 8 + ssz);
          const pad = ssz & 1 ? Buffer.alloc(1) : Buffer.alloc(0);
          const head = Buffer.alloc(8);
          head.write(sid, 0, "ascii");
          head.writeUInt32LE(ssz, 4);
          const body = Buffer.concat([Buffer.from("WEBP", "ascii"), head, data, pad]);
          const riff = Buffer.alloc(8);
          riff.write("RIFF", 0, "ascii");
          riff.writeUInt32LE(body.length, 4);
          return { buffer: Buffer.concat([riff, body]), animated: true };
        }
        p += 8 + ssz + (ssz & 1);
      }
      return { buffer: buf, animated: true };
    }
    off = end + (size & 1);
  }
  return { buffer: buf, animated: false };
}

// ---------------------------------------------------------------- AI memilih stiker sebagai balasan
/** Label yang boleh dipilih AI sebagai balasan (suasana sedih/kesal: bot tidak membalas dengan stiker). */
export const STICKER_PICK_TAGS = ["tawa", "senang", "kaget", "setuju", "terimakasih", "semangat", "bingung"];

/**
 * Keluaran AI dengan baris "STIKER: <label>" -> { tag, rest }. tag null bila label tidak dikenal/tidak tersedia (baris itu dibuang, sisanya jadi teks).
 * rest = teks lain di keluaran itu (boleh kosong = balas dengan stiker saja). Tanpa baris STIKER -> null.
 */
export function parseStickerOutput(raw, allowed = STICKER_PICK_TAGS) {
  const lines = String(raw ?? "").split(/\r?\n/);
  let tag = null;
  let found = false;
  const keep = [];
  for (const l of lines) {
    const m = /^\s*STIKER\s*[:：]\s*([A-Za-z]+)\s*$/i.exec(l);
    if (m) {
      found = true;
      const t = m[1].toLowerCase();
      if (!tag && allowed.includes(t)) tag = t;
    } else keep.push(l);
  }
  if (!found) return null;
  return { tag, rest: keep.join("\n").trim() };
}

// ---------------------------------------------------------------- perpustakaan stiker
/**
 * Pilih stiker balasan dari perpustakaan: label cocok dengan label stiker yang diterima, bukan stiker yang sama dengan yang diterima,
 * bukan yang baru dipakai. Yang jarang dipakai bot diutamakan. -> item | null
 */
export function pickStickerFor(library, receivedTag, { excludeIds = [], avoidIds = [], random = Math.random, exact = false } = {}) {
  const wanted = exact ? [receivedTag] : STICKER_REPLY_TAGS[receivedTag] ?? STICKER_REPLY_TAGS.lain;
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
