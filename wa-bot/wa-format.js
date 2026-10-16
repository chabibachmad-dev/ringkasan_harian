// ================================================================
// Perapian teks balasan untuk WhatsApp + pengenalan permintaan "jadikan PDF".
//
//   formatForWhatsApp(text)   Tabel markdown -> tampilan yang terbaca di gelembung WhatsApp, plus **tebal** -> *tebal*, "## Judul" -> *Judul*.
//   detectPdfRequest(text)    "bot, jelaskan X dalam bentuk PDF" / "bot, jadikan pdf" -> { only, rest } atau null.
//   parseTableAt(lines, i)    pembaca tabel markdown (dipakai juga oleh pdf-doc.js).
//
// WhatsApp TIDAK punya tabel. Aturan tampilan:
//   - Tabel sempit (lebar total <= WA_MONO_MAX huruf): blok monospace berkolom rata (```...```), tetap terlihat seperti tabel.
//   - Tabel lebar: tiap baris jadi "kartu" -- judul tebal dari kolom pertama, lalu baris "Kolom: nilai". Tidak ada yang terpotong/membungkus acak.
// ================================================================

export const WA_MONO_MAX = 34; // lebar monospace aman di layar HP (huruf)

const FENCE_RE = /^\s*```/;
const SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const ROW_RE = /^\s*\|.*\|\s*$|^[^|\n]+\|[^\n]*$/;

/** Pecah satu baris tabel menjadi sel (menghormati \| dan membuang | di ujung). */
export function splitRow(line) {
  let s = String(line ?? "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells.map((x) => x.replace(/<br\s*\/?>/gi, " / "));
}

/**
 * Tabel markdown mulai di baris i? -> { headers, rows, end } (end = indeks baris SETELAH tabel) atau null.
 * Syarat: baris header ber-"|" lalu baris pemisah (---).
 */
export function parseTableAt(lines, i) {
  const head = lines[i];
  const sep = lines[i + 1];
  if (head === undefined || sep === undefined) return null;
  if (!/\|/.test(head) || !ROW_RE.test(head) || !SEP_RE.test(sep) || !/\|/.test(sep) && !/^\s*:?-{3,}/.test(sep)) return null;
  const headers = splitRow(head);
  if (headers.length < 2) return null;
  const rows = [];
  let j = i + 2;
  while (j < lines.length && lines[j].trim() !== "" && /\|/.test(lines[j]) && !FENCE_RE.test(lines[j])) {
    const cells = splitRow(lines[j]);
    while (cells.length < headers.length) cells.push("");
    rows.push(cells.slice(0, headers.length).map((c) => c));
    j++;
  }
  if (rows.length === 0) return null;
  return { headers, rows, end: j };
}

const plain = (s) =>
  String(s ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
const boldWa = (s) => String(s ?? "").trim().replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "*$1*");
const len = (s) => [...s].length;
const pad = (s, n) => s + " ".repeat(Math.max(0, n - len(s)));

/** Satu tabel -> teks WhatsApp. */
export function renderTableForWhatsApp(headers, rows, { monoMax = WA_MONO_MAX } = {}) {
  let h = headers.map(plain);
  let r = rows.map((row) => row.map((c) => String(c ?? "")));
  let numbered = false;
  if (h.length >= 3 && /^(?:no\.?|nomor|#)$/i.test(h[0])) {
    numbered = true;
    r = r.map((row) => row.slice(0));
  }
  // --- tabel sempit: blok monospace berkolom
  const pr = r.map((row) => row.map(plain));
  const widths = h.map((x, c) => Math.max(len(x), ...pr.map((row) => len(row[c] || ""))));
  const total = widths.reduce((a, b) => a + b, 0) + 3 * (widths.length - 1);
  if (total <= monoMax) {
    const line = (cells) => cells.map((x, c) => pad(x, widths[c])).join(" | ").trimEnd();
    const rule = widths.map((w) => "-".repeat(w)).join("-+-");
    return ["```", line(h), rule, ...pr.map((row) => line(row)), "```"].join("\n");
  }
  // --- dua kolom: daftar "• *A* — B"
  if (h.length === 2) {
    const out = [`_${h[0]} → ${h[1]}_`];
    for (const row of r) out.push(`• *${plain(row[0]) || "-"}* — ${boldWa(row[1]) || "-"}`);
    return out.join("\n");
  }
  // --- tabel lebar: kartu per baris
  const start = numbered ? 1 : 0;
  const cards = [];
  r.forEach((row, idx) => {
    const title = plain(row[start]) || "-";
    const lines = [`*${numbered ? `${plain(row[0]) || idx + 1}. ` : ""}${title}*`];
    for (let c = start + 1; c < h.length; c++) {
      const v = boldWa(row[c]);
      if (!v) continue;
      lines.push(`• ${h[c]}: ${v}`);
    }
    cards.push(lines.join("\n"));
  });
  return cards.join("\n\n");
}

/** Bagian di luar blok kode: **tebal** -> *tebal*, "## Judul" -> *Judul*, garis --- dibuang, [teks](url) -> teks (url). */
function normalizeInline(text) {
  return text
    .split("\n")
    .map((line) => {
      let l = line;
      const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
      if (heading) return `*${heading[1].replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1")}*`;
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)) return "";
      l = l.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "*$1*");
      l = l.replace(/(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/g, "*$1*");
      l = l.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");
      return l;
    })
    .join("\n");
}

/** Balasan AI -> teks yang rapi di WhatsApp. Blok kode (```) tidak disentuh. */
export function formatForWhatsApp(text) {
  const src = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!src) return src;
  const lines = src.split("\n");
  const out = [];
  let buf = [];
  const flush = () => {
    if (buf.length) out.push(normalizeInline(buf.join("\n")));
    buf = [];
  };
  let inFence = false;
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      if (!inFence) flush();
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }
    const t = parseTableAt(lines, i);
    if (t) {
      flush();
      out.push(renderTableForWhatsApp(t.headers, t.rows));
      i = t.end;
      continue;
    }
    buf.push(line);
    i++;
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------- permintaan "jadikan PDF"
const PDF_PHRASE_RE = /\b(?:(?:dalam|dengan|pakai|pake|jadi|menjadi|ke|sebagai|via|lewat)\s+)?(?:(?:bentuk|format|versi|file|berkas|dokumen)\s+)?pdf(?:-?nya|-?kan)?\b/gi;
const PDF_ASK_RES = [
  /\b(?:jadi(?:kan)?|menjadi|ubah(?:lah)?|convert|konversi|export|ekspor|simpan|cetak|print|jawab|balas|sajikan|buat(?:kan|in|lah)?|bikin(?:kan|in)?|tulis(?:kan)?)\b[^.!?\n]{0,40}?\bpdf\b/i,
  /\b(?:dalam|dengan|pakai|pake|sebagai|via|lewat)\s+(?:(?:bentuk|format|versi|file|berkas|dokumen)\s+)?pdf\b/i,
  /\b(?:bentuk|format|versi)\s+pdf\b/i,
  /\bpdf(?:-?nya|-?kan)\s*(?:dong|ya|aja|saja|please|pls|kak)?\s*[.!?]*$/i,
  /^\s*(?:tolong\s+)?pdf(?:\s+(?:dong|ya|aja|saja|please|pls))?\s*[.!?]*$/i
];
const PDF_FILLER = /\b(?:jadikan|jadi|menjadi|ubah|ubahlah|convert|konversi|export|ekspor|simpan|cetak|print|jawab|balas|sajikan|buat|buatkan|buatin|buatlah|bikin|bikinkan|bikinin|tulis|tuliskan|dalam|dengan|pakai|pake|bentuk|format|versi|file|berkas|dokumen|pdf|pdfnya|pdfkan|kan|nya|ini|itu|tadi|dong|ya|yah|aja|saja|deh|tolong|please|pls|kak|bot|jawaban|jawabannya|hasil|hasilnya|isinya|tersebut|ke|di|sebagai|via|lewat|kirim|kirimkan|dan|lalu|terus)\b/gi;

/**
 * Teks pengguna -> { only, rest } bila meminta hasil berbentuk PDF, selain itu null.
 *   only = true : hanya "jadikan pdf" (tanpa pertanyaan baru) -> ubah jawaban yang DIBALAS menjadi PDF.
 *   rest        : teks tanpa frasa PDF (pertanyaan yang diteruskan ke AI bila only = false).
 */
export function detectPdfRequest(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || /^\//.test(t) || !/\bpdf\b/i.test(t)) return null;
  if (/\b(?:apa itu|apa arti|singkatan|kepanjangan)\b[^.!?]{0,20}\bpdf\b/i.test(t)) return null;
  if (!PDF_ASK_RES.some((re) => re.test(t))) return null;
  const dangling = /(?:\s*(?:dan|lalu|terus|kemudian|,))*\s*\b(?:tolong\s+)?(?:jadikan|jadi|menjadi|ubah|ubahlah|convert|simpan|cetak|print|jawab|balas|sajikan|tulis|tuliskan|buatkan|buatin|buat|bikinkan|bikinin|bikin|kirimkan|kirim)\s*$/i;
  let rest = t.replace(PDF_PHRASE_RE, " ").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  for (let i = 0; i < 3; i++) rest = rest.replace(dangling, "").replace(/(?:\s*(?:dan|lalu|terus|kemudian|,))+\s*$/i, "").trim();
  const leftover = t.replace(PDF_FILLER, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return { only: leftover === "", rest: rest.replace(/^[,\s]+|[,\s]+$/g, "") };
}
