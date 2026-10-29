// Penjaga balasan: dipakai SEBELUM teks dikirim ke WhatsApp/Telegram.
//  1. Membuang tag kontrol yang bocor ("[SEARCH] ... [/SEARCH]", "[[TANYA_BOS]]", dst.).
//  2. Membuang URL yang TIDAK ada di daftar sumber yang benar-benar diberikan ke model (anti link karangan).
//  3. Menyediakan aturan prompt "jangan mengarang angka/link" untuk disisipkan ke system prompt.
// Murni fungsi, tanpa efek samping, tanpa dependensi.

const URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/gi;
const TRAIL_RE = /[.,;:!?)\]}"'»”’]+$/;

/** Rapikan URL untuk perbandingan: huruf kecil pada host, tanpa tanda baca ujung, tanpa "/" penutup, tanpa #fragmen. */
export function normalizeUrl(u) {
  let s = String(u || "").trim().replace(TRAIL_RE, "");
  try {
    const x = new URL(s);
    x.hash = "";
    let out = `${x.protocol}//${x.host.toLowerCase()}${x.pathname}${x.search}`;
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

/** Ambil semua URL dari baris "Sumber: URL" pada teks konteks (satu atau banyak string). */
export function allowedUrlsFromContext(...texts) {
  const out = new Set();
  for (const t of texts.flat()) {
    for (const m of String(t || "").matchAll(/Sumber:\s*(https?:\/\/\S+)/gi)) out.add(normalizeUrl(m[1]));
  }
  return [...out];
}

/** Ambil kueri dari "[SEARCH] kueri [/SEARCH]" (atau tanpa penutup). null bila tidak ada. */
export function extractSearchRequest(text) {
  const t = String(text || "");
  const m = t.match(/\[\s*SEARCH\s*\]\s*([\s\S]*?)\s*(?:\[\s*\/\s*SEARCH\s*\]|$)/i);
  const q = m?.[1]?.replace(/\s+/g, " ").trim();
  return q || null;
}

/**
 * Buang tag kontrol dari teks yang akan dikirim.
 * @param {string} text
 * @param {{ doubleBracket?: boolean }} [opts] doubleBracket=true juga membuang "[[HURUF_BESAR]]" (pakai hanya SETELAH tag itu diproses).
 */
export function stripControlTags(text, opts = {}) {
  let t = String(text ?? "");
  t = t.replace(/\[\s*SEARCH\s*\][\s\S]*?\[\s*\/\s*SEARCH\s*\]/gi, " "); // pasangan lengkap beserta isinya
  t = t.replace(/\[\s*\/?\s*SEARCH\s*\][^\n]*$/gim, " ");               // tag yatim di ujung baris
  t = t.replace(/\[\s*\/?\s*(?:SEARCH|WEB|CARI|TOOL|FUNC(?:TION)?)\s*\]/gi, " ");
  if (opts.doubleBracket) t = t.replace(/\[\[\s*[A-Z][A-Z0-9_]{2,}\s*(?::[^\]]*)?\]\]/g, " ");
  return t.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Hapus URL yang tidak ada di daftar yang diizinkan. Kalimat tetap dipertahankan.
 * allowed = undefined → URL tidak disentuh (mis. jalur Google Search yang sumbernya tidak kita pegang).
 * allowed = []        → semua URL dibuang.
 * @returns {{ text: string, removed: string[] }}
 */
export function filterUrls(text, allowed) {
  const src = String(text ?? "");
  if (allowed == null) return { text: src, removed: [] };
  const ok = new Set([...allowed].map(normalizeUrl));
  const removed = [];
  let t = src.replace(URL_RE, (u) => {
    if (ok.has(normalizeUrl(u))) return u;
    removed.push(u.replace(TRAIL_RE, ""));
    return "";
  });
  if (removed.length) {
    t = t
      .replace(/\b(?:dapat|bisa|silakan)\s+(?:diakses|dilihat|dibuka|diunduh|dicek|cek|lihat|akses)\s+(?:di\s+sini|di|pada|lewat|melalui)?\s*:?\s*(?=[.,;!?]|\n|$)/gi, "")
      .replace(/\s*(?:di sini|berikut|link(?:nya)?|tautan(?:nya)?)\s*:\s*(?=[.,;!?]|\n|$)/gi, "")
      .replace(/[ \t]{2,}/g, " ").replace(/ +([.,;!?])/g, "$1").replace(/\n{3,}/g, "\n\n").trim()
      .replace(/[,;:]\s*$/, ".");
  }
  return { text: t, removed };
}

// Penanda riwayat gambar ("🖼️ [BOT mengirim GAMBAR ...]", "[GAMBAR ...]") HANYA boleh dibuat sistem saat gambar sungguh terkirim.
// Balasan model tidak pernah membawa gambar, jadi penanda atau klaim "berikut gambarnya" dari model selalu palsu.
const MARKER_LINE_RE = /^[ \t>*_-]*(?:🖼️?)[^\n]*$|^[ \t>*_-]*[\[(【]\s*GAMBAR\b[^\n]*$/gim;
const MARKER_INLINE_RE = /(?:🖼️?)\s*[\[(【][^\])】\n]*[\])】]|[\[(【]\s*GAMBAR\b[^\])】\n]*[\])】]|🖼️?/gi;
const CLAIM_RE = /\b(?:berikut|nih|ini\s+dia)\s+(?:adalah\s+)?(?:gambar|logo|poster|ilustrasi|desain)(?:nya)?\b|\b(?:gambar|logo|poster|ilustrasi|desain)(?:nya)?\s+(?:sudah|telah|udah)\s+(?:ku|saya\s+|aku\s+)?(?:kirim|buat|bikin|terkirim|selesai|jadi)|\b(?:sudah|telah|udah)\s+(?:ku|saya\s+|aku\s+)?(?:kirim|buat|bikin)(?:kan)?\s+(?:gambar|logo|poster|ilustrasi|desain)/i;
export const NO_IMAGE_SENT_TEXT = "Aku belum membuat atau mengirim gambar apa pun di sini. Kalau mau digambarkan, tulis: bot, buatkan gambar <deskripsi>.";

/** Buang penanda gambar palsu dan kalimat yang mengaku sudah mengirim gambar. -> { text, imageClaim } */
export function stripFakeImageClaims(text) {
  const src = String(text ?? "");
  let t = src.replace(MARKER_LINE_RE, "").replace(MARKER_INLINE_RE, "");
  let imageClaim = t !== src;
  if (CLAIM_RE.test(t)) {
    imageClaim = true;
    const kept = t.split(/\n/).map((line) => line.split(/(?<=[.!?…])\s+/).filter((sent) => !CLAIM_RE.test(sent)).join(" ")).join("\n");
    t = kept;
  }
  if (!imageClaim) return { text: src, imageClaim: false };
  t = t.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: t ? `${t}\n\n${NO_IMAGE_SENT_TEXT}` : NO_IMAGE_SENT_TEXT, imageClaim: true };
}

/**
 * Satu pintu: bersihkan tag + saring URL.
 * @param {string} text
 * @param {{ allowedUrls?: string[], doubleBracket?: boolean }} [opts]
 * @returns {{ text: string, removedUrls: string[], hadTags: boolean }}
 */
export function guardReply(text, opts = {}) {
  const raw = String(text ?? "");
  const noTags = stripControlTags(raw, { doubleBracket: opts.doubleBracket });
  const hadTags = noTags !== raw.trim() && /\[\s*\/?\s*(?:SEARCH|WEB|CARI|TOOL|FUNC)/i.test(raw);
  const { text: urlOk, removed } = filterUrls(noTags, opts.allowedUrls);
  const { text: out, imageClaim } = stripFakeImageClaims(urlOk);
  return { text: out, removedUrls: removed, hadTags, imageClaim };
}

/** Teks kosong setelah disaring (model hanya mengirim tag)? Pakai ini untuk memutuskan perlu memanggil ulang model. */
export const isEmptyAfterGuard = (r) => !r || !String(r.text || "").replace(/[\s.,;:!?-]/g, "");

/** Aturan untuk ditempel ke system prompt (semua jalur: Gemini, Groq, OpenRouter). */
export const NO_FABRICATION_RULES = [
  "ATURAN KEJUJURAN FAKTA:",
  "- Jangan pernah menulis kode kontrol seperti [SEARCH] di jawaban akhir.",
  "- Angka/data yang spesifik dan bisa berubah (jumlah pegawai, harga, tarif, nama pejabat, alamat, nomor telepon, tanggal) HANYA boleh disebut kalau tertulis di konteks/hasil pencarian yang diberikan. Kalau tidak ada, jawab terus terang: \"Saya belum bisa memastikan angkanya\" dan sarankan bertanya ke kantor/situs resmi yang bersangkutan.",
  "- Jangan menyebut \"situs resmi\", \"data terbaru\", atau \"menurut data\" kalau tidak ada sumbernya di konteks.",
  "- Jangan mengarang link. Hanya URL yang tertulis persis di baris \"Sumber:\" atau yang ditulis pengguna yang boleh disebut.",
  "- Jangan menulis \"berikut gambarnya\", \"gambar sudah kukirim\", atau penanda seperti \"🖼️ (...)\" dan \"[GAMBAR ...]\" di jawabanmu. Gambar hanya terkirim lewat pembuat gambar sistem; penanda riwayat dibuat sistem, bukan kamu. Kalau tidak ada gambar yang terkirim, jangan mengaku sudah membuat atau mengirimnya."
].join("\n");
