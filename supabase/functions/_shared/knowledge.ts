// Pemilihan potongan "Dokumen Pengetahuan" yang relevan (RAG sederhana, tanpa
// embedding/vector DB) + pencarian web cadangan lewat Bing, dipakai Edge
// Function `chat` saat Google Search (tool bawaan Gemini) tidak tersedia.
//
// Logikanya SENGAJA sama dengan yang di bot WA (wa-bot/index.js) -- kalau salah
// satu diubah, ubah yang lain juga:
//   - dokumen dipotong per paragraf (+ tabel panjang dipecah per baris/jendela
//     karakter), judul tabel ("Tabel 30 ...") menempel di potongan-potongannya;
//   - skor berbobot kelangkaan kata (IDF), minimal 2 kata pertanyaan berbeda
//     harus cocok, singkatan umum ("ppk", "honor") diperluas ke istilah resmi.

export interface KbDoc {
  title: string;
  content: string;
}

export interface KbChunk {
  title: string;
  text: string;
  score: number;
  distinct: number;
}

const CHUNK_SIZE_CHARS = 700;

const ID_STOPWORDS = new Set([
  "yang", "untuk", "dengan", "pada", "dari", "dan", "atau", "ini", "itu",
  "ke", "di", "adalah", "akan", "juga", "saja", "bisa", "ada", "tidak",
  "apa", "apakah", "bagaimana", "kalau", "jika", "karena", "sebagai",
  "oleh", "dalam", "para", "sudah", "belum", "lebih", "kurang", "agar",
  "supaya", "hal", "nya", "mu", "ku", "saya", "kamu", "anda", "kita",
  "mereka", "dia", "tersebut", "begitu", "maka", "namun", "tetapi", "serta",
  "antara", "tiap", "setiap", "banyak", "sedikit", "satu", "dua", "tiga",
  "tolong", "mohon", "coba", "gimana", "kenapa", "siapa", "dimana", "kapan",
  "berapa"
]);

// Ejaan/singkatan yang beda antara cara orang menulis & dokumen resmi --
// disamakan di kedua sisi (pertanyaan & potongan dokumen).
const ID_ALIASES: Record<string, string> = {
  jogja: "yogyakarta",
  jogjakarta: "yogyakarta",
  yogya: "yogyakarta",
  jogyakarta: "yogyakarta",
  diy: "yogyakarta",
  gol: "golongan"
};

// Perluasan KHUSUS sisi pertanyaan: kata yang diketik orang -> istilah yang
// kemungkinan tertulis di dokumen (alternatif, bukan tambahan wajib).
const QUERY_EXPANSIONS: Record<string, string[]> = {
  ppk: ["pejabat", "pembuat", "komitmen"],
  pptk: ["pejabat", "pelaksana", "teknis", "kegiatan"],
  kpa: ["kuasa", "pengguna", "anggaran"],
  bpp: ["bendahara", "pengeluaran", "pembantu"],
  honor: ["honorarium"],
  honorer: ["honorarium"],
  uh: ["uang", "harian"],
  sbm: ["standar", "biaya", "masukan"],
  sbk: ["standar", "biaya", "keluaran"],
  perdin: ["perjalanan", "dinas"],
  spj: ["pertanggungjawaban"]
};

export function tokenizeForScoring(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => ID_ALIASES[w] ?? w)
    .filter((w) => w.length > 2 && !ID_STOPWORDS.has(w));
}

// Satu paragraf yang jauh lebih panjang dari ukuran potongan (mis. tabel tarif
// hasil ekstrak PDF tanpa baris kosong) dipecah per baris, dan baris yang
// kepanjangan dipotong per jendela karakter yang tumpang-tindih sedikit.
function splitOversizedText(text: string, size: number): string[] {
  if (text.length <= size * 2) return [text];
  const overlap = Math.min(200, Math.floor(size / 4));
  const out: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (line.length > size * 2) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < line.length; i += size - overlap) out.push(line.slice(i, i + size));
      continue;
    }
    if (buf && buf.length + line.length + 1 > size) {
      out.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

const HEADING_RE = /^(tabel|lampiran|bab)\b/i;

export function chunkDocumentText(text: string, chunkSize = CHUNK_SIZE_CHARS): string[] {
  // Baris-baris tabel di potongan ke-2 dst. tidak memuat judul tabelnya, jadi
  // judul digabung ke paragraf isi di bawahnya & tiap potongan lanjutan diberi
  // awalan "(Lanjutan dari: <judul>…)".
  let lastHeading = "";
  let carry = "";
  const paragraphs: string[] = [];
  for (const raw of (text || "").split(/\n{2,}/)) {
    let p = raw.trim();
    if (!p) continue;
    if (p.length <= 200 && HEADING_RE.test(p)) {
      carry = carry ? `${carry} ${p.replace(/\s+/g, " ")}` : p.replace(/\s+/g, " ");
      lastHeading = carry;
      continue;
    }
    if (carry) {
      p = `${carry}\n${p}`;
      carry = "";
    }
    const parts = splitOversizedText(p, chunkSize);
    if (parts.length === 1) {
      paragraphs.push(parts[0]);
      continue;
    }
    const head = p.slice(0, 160).replace(/\s+/g, " ");
    const ctx = lastHeading && !head.startsWith(lastHeading.slice(0, 40)) ? `${lastHeading} | ${head}` : head;
    parts.forEach((part, i) => paragraphs.push(i === 0 ? part : `(Lanjutan dari: ${ctx}…)\n${part}`));
  }
  if (carry) paragraphs.push(carry);

  const chunks: string[] = [];
  let buffer = "";
  for (const p of paragraphs) {
    if (buffer && buffer.length + p.length + 2 > chunkSize) {
      chunks.push(buffer);
      buffer = p;
    } else {
      buffer = buffer ? `${buffer}\n\n${p}` : p;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

export interface SelectOptions {
  budgetChars?: number;
  maxChunks?: number;
  maxChunkChars?: number;
}

// Pilih potongan dokumen paling relevan dgn `query`, dibatasi budget (BUKAN
// seluruh dokumen). Array kosong kalau tidak ada yang cocok.
export function selectKnowledgeChunks(docs: KbDoc[], query: string, opts: SelectOptions = {}): KbChunk[] {
  const budgetChars = opts.budgetChars ?? 9000;
  const maxChunks = opts.maxChunks ?? 6;
  const maxChunkChars = opts.maxChunkChars ?? 2500;

  const baseTokens = [...new Set(tokenizeForScoring(query))];
  if (baseTokens.length === 0) return [];
  // Tiap kata pertanyaan = 1 "grup" alternatif (kata itu sendiri + perluasannya).
  const groups = baseTokens.map((w) => [w, ...(QUERY_EXPANSIONS[w] ?? [])]);
  const groupWords = new Set(groups.flat());

  const chunks: { title: string; text: string; counts: Map<string, number> }[] = [];
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const text of chunkDocumentText(doc.content)) {
      const counts = new Map<string, number>();
      for (const w of tokenizeForScoring(text)) {
        if (groupWords.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
      }
      chunks.push({ title: doc.title, text, counts });
      for (const w of counts.keys()) df.set(w, (df.get(w) || 0) + 1);
    }
  }
  if (chunks.length === 0) return [];
  const n = chunks.length;
  const minDistinct = Math.min(2, groups.length);

  const scored: KbChunk[] = [];
  for (const ch of chunks) {
    let distinct = 0;
    let score = 0;
    for (const group of groups) {
      let best = 0;
      for (const w of group) {
        const c = ch.counts.get(w);
        if (!c) continue;
        const s = Math.log(1 + n / (df.get(w) || 1)) * (1 + 0.1 * Math.min(c - 1, 4));
        if (s > best) best = s;
      }
      if (best > 0) {
        distinct++;
        score += best;
      }
    }
    if (distinct >= minDistinct) scored.push({ title: ch.title, text: ch.text, score, distinct });
  }
  scored.sort((a, b) => b.score - a.score);

  const picked: KbChunk[] = [];
  let used = 0;
  for (const item of scored) {
    if (picked.length >= maxChunks || used >= budgetChars) break;
    const text = item.text.length > maxChunkChars ? `${item.text.slice(0, maxChunkChars)}...` : item.text;
    picked.push({ ...item, text });
    used += text.length;
  }
  return picked;
}

// ---------------- Pencarian web cadangan (Bing) ----------------

const WEB_QUESTION_WORDS =
  /\b(apa|apakah|siapa|berapa|kapan|dimana|di mana|kemana|bagaimana|gimana|kenapa|mengapa|tarif|aturan|peraturan|harga|berita|terbaru|update|pmk|sbm|uu|perpres|jadwal|link|tautan|honor|honorarium)\b/i;

// Query pencarian dari pesan user TERAKHIR (+ sebelumnya kalau pendek/lanjutan).
// "" = tidak usah cari (basa-basi/pesan sangat pendek).
export function buildWebQuery(userTexts: string[]): string {
  const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  const wordCount = (s: string) => (s ? s.split(" ").length : 0);
  const looksLikeQuestion = (s: string) => wordCount(s) >= 3 && (s.includes("?") || WEB_QUESTION_WORDS.test(s));
  const last = clean(userTexts[userTexts.length - 1]);
  const prev = clean(userTexts[userTexts.length - 2]);
  if (!last || last.startsWith("[")) return "";
  const prevUsable = prev && !prev.startsWith("[");
  if (!looksLikeQuestion(last)) {
    if (wordCount(last) <= 4 && prevUsable && looksLikeQuestion(prev)) return `${prev} ${last}`.slice(0, 200);
    return "";
  }
  return (wordCount(last) < 8 && prevUsable ? `${prev} ${last}` : last).slice(0, 200);
}

// Query untuk mencari di DOKUMEN (lebih longgar dari pencarian web: user
// mengetik langsung ke asistennya, jadi "honor ppk" 2 kata pun sah). Sampai 3
// pesan user terakhir kalau yang terakhir pendek.
export function buildKbQuery(userTexts: string[]): string {
  const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  const last = clean(userTexts[userTexts.length - 1]);
  if (!last || last.startsWith("[")) return "";
  const parts = [last];
  for (let i = userTexts.length - 2; i >= 0 && parts.join(" ").split(" ").length < 8 && parts.length < 3; i--) {
    const t = clean(userTexts[i]);
    if (t && !t.startsWith("[")) parts.unshift(t);
  }
  return parts.join(" ").slice(0, 300);
}

// Pengguna minta sesuatu yang menyangkut SELURUH dokumen (ringkas/rangkum
// dokumen) -- pemilihan potongan tidak cocok untuk ini.
export function wantsWholeDocument(text: string): boolean {
  return /\b(ringkas|rangkum|ringkasan|rangkuman|seluruh dokumen|isi dokumen|dokumen ini|jelaskan dokumen|semua dokumen)\b/i.test(text || "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => {
      const code = Number(d);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// Parse halaman hasil Bing (bing.com/search): tiap hasil di <li class="b_algo">,
// judul di <h2>, cuplikan di ".b_caption p" (fallback beberapa pola lain).
export function parseBingResults(html: string, maxResults: number, snippetMax = 300): { title: string; snippet: string }[] {
  const results: { title: string; snippet: string }[] = [];
  const blockRe = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) && results.length < maxResults) {
    const block = m[1];
    const title = stripTags(block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "");
    let snippet = stripTags(
      block.match(/class="[^"]*\bb_caption\b[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ??
        block.match(/class="b_lineclamp\d*[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/)?.[1] ??
        block.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ??
        ""
    );
    if (snippet.length > snippetMax) snippet = `${snippet.slice(0, snippetMax)}...`;
    if (title || snippet) results.push({ title, snippet });
  }
  return results;
}

export async function searchBing(query: string, maxResults = 5, timeoutMs = 7000): Promise<{ title: string; snippet: string }[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      signal: controller.signal
    });
    if (!res.ok) return [];
    return parseBingResults(await res.text(), maxResults);
  } catch (err) {
    console.warn("Web search (Bing) gagal, lanjut tanpa hasil web:", err instanceof Error ? err.message : String(err));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Sisipkan potongan hasil web ke teks pertanyaan terakhir.
export function buildWebGroundedMessage(originalText: string, results: { title: string; snippet: string }[]): string {
  if (results.length === 0) return originalText;
  const webBlock = results.map((r, i) => `${i + 1}. ${r.title} -- ${r.snippet}`).join("\n");
  return `HASIL PENCARIAN WEB (dicarikan otomatis, mungkin relevan -- kalau tidak relevan, abaikan):\n${webBlock}\n\nPertanyaan dari pengguna: ${originalText}`;
}
