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
  if (detectOfficeRequest(t)) return null; // "convert pdf ini ke excel" = permintaan Excel, bukan PDF
  if (/\b(?:apa itu|apa arti|singkatan|kepanjangan)\b[^.!?]{0,20}\bpdf\b/i.test(t)) return null;
  if (!PDF_ASK_RES.some((re) => re.test(t))) return null;
  const dangling = /(?:\s*(?:dan|lalu|terus|kemudian|,))*\s*\b(?:tolong\s+)?(?:jadikan|jadi|menjadi|ubah|ubahlah|convert|simpan|cetak|print|jawab|balas|sajikan|tulis|tuliskan|buatkan|buatin|buat|bikinkan|bikinin|bikin|kirimkan|kirim)\s*$/i;
  let rest = t.replace(PDF_PHRASE_RE, " ").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  for (let i = 0; i < 3; i++) rest = rest.replace(dangling, "").replace(/(?:\s*(?:dan|lalu|terus|kemudian|,))+\s*$/i, "").trim();
  const leftover = t.replace(PDF_FILLER, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return { only: leftover === "", rest: rest.replace(/^[,\s]+|[,\s]+$/g, "") };
}

// ---------------------------------------------------------------- permintaan "jadikan Excel / Word"
const OFFICE_FMT = "(?:ms\\s+|microsoft\\s+)?(excel|xlsx|word|docx|spreadsheet)";
const OFFICE_VERB = "(?:jadi(?:kan)?|menjadi|ubah(?:lah)?|convert|konversi(?:kan)?|ekspor(?:t)?|export|simpan(?:kan)?|salin|bikin(?:kan|in)?|buat(?:kan|in|lah)?|tulis(?:kan)?|kirim(?:kan)?|sajikan|jawab|balas|tuangkan)";
const OFFICE_ASK_RES = [
  new RegExp(`\\b${OFFICE_VERB}\\b[^.!?\\n]{0,40}?\\b(?:ke|jadi|menjadi|dalam|sebagai|pakai|pake|dengan|via|lewat)\\s+(?:(?:bentuk|format|versi|file|berkas|dokumen|lembar|aplikasi|program)\\s+)*${OFFICE_FMT}\\b`, "i"),
  new RegExp(`\\b(?:dalam|dengan|pakai|pake|sebagai|via|lewat|ke)\\s+(?:(?:bentuk|format|versi|file|berkas|dokumen)\\s+)+${OFFICE_FMT}\\b`, "i"),
  new RegExp(`\\b(?:jadikan|ubah|convert|konversi|ekspor|export)\\s+(?:(?:ke|jadi|menjadi)\\s+)?${OFFICE_FMT}\\b`, "i"),
  new RegExp(`^\\s*(?:tolong\\s+)?${OFFICE_FMT}(?:\\s+(?:dong|ya|aja|saja|please|pls))?\\s*[.!?]*$`, "i"),
  new RegExp(`\\b${OFFICE_FMT}(?:-?nya|-?kan)\\s*(?:dong|ya|aja|saja)?\\s*[.!?]*$`, "i")
];
const OFFICE_PHRASE_RE = new RegExp(`\\b(?:(?:dalam|dengan|pakai|pake|jadi|menjadi|ke|sebagai|via|lewat)\\s+)?(?:(?:bentuk|format|versi|file|berkas|dokumen|lembar|aplikasi|program)\\s+)*${OFFICE_FMT}(?:-?nya|-?kan)?\\b`, "gi");
const OFFICE_FILLER = new RegExp(PDF_FILLER.source.replace(/\|pdf\|/, "|pdf|excel|xlsx|xls|word|docx|spreadsheet|microsoft|ms|office|lembar|aplikasi|program|"), "gi");
const OFFICE_HOWTO = /\b(?:cara|bagaimana|gimana|rumus|apa itu|apa bedanya|beda|kenapa|mengapa|tutorial|fungsi|shortcut)\b/i;

/**
 * Teks pengguna -> { format: "xlsx"|"docx", only, rest } bila meminta hasil berbentuk Excel/Word, selain itu null.
 * only = true: hanya "jadikan excel" (tanpa pertanyaan baru) -> ubah dokumen/jawaban yang DIBALAS.
 */
export function detectOfficeRequest(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || /^\//.test(t) || !/\b(?:excel|xlsx|word|docx|spreadsheet)\b|(?:excel|xlsx|word|docx)(?:-?nya|-?kan)\b/i.test(t)) return null;
  if (OFFICE_HOWTO.test(t)) return null;
  const hit = OFFICE_ASK_RES.map((re) => re.exec(t)).find(Boolean);
  if (!hit) return null;
  const fmtWord = String(hit[1] || "").toLowerCase();
  const format = /excel|xlsx|spreadsheet/.test(fmtWord) ? "xlsx" : "docx";
  const dangling = /(?:\s*(?:dan|lalu|terus|kemudian|,))*\s*\b(?:tolong\s+)?(?:jadikan|jadi|menjadi|ubah|ubahlah|convert|konversi|konversikan|ekspor|export|simpan|simpankan|salin|cetak|jawab|balas|sajikan|tulis|tuliskan|buatkan|buatin|buat|bikinkan|bikinin|bikin|kirimkan|kirim|tuangkan)\s*$/i;
  let rest = t.replace(OFFICE_PHRASE_RE, " ").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  for (let i = 0; i < 3; i++) rest = rest.replace(dangling, "").replace(/(?:\s*(?:dan|lalu|terus|kemudian|,))+\s*$/i, "").trim();
  const leftover = t.replace(OFFICE_PHRASE_RE, " ").replace(OFFICE_FILLER, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return { format, only: leftover === "", rest: rest.replace(/^[,\s]+|[,\s]+$/g, "") };
}

// ---------------------------------------------------------------- merapikan jawaban AI sebelum dijadikan berkas
const RULE_ONLY_RE = /^[\s=\-+_|─│┼═╪╫]+$/;

/**
 * Blok kode yang isinya tabel "gambar" (garis ===, ---+---, kolom dipisah |) -> tabel markdown sungguhan.
 * Blok kode lain tidak disentuh.
 */
export function liftAsciiTables(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_RE.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !FENCE_RE.test(lines[j])) j++;
    const body = lines.slice(i + 1, j);
    const data = body.filter((l) => l.trim() && !RULE_ONLY_RE.test(l));
    const piped = data.filter((l) => /\|/.test(l));
    if (data.length >= 3 && piped.length >= data.length * 0.8) {
      // Tepi "|" hanya dibuang bila SEMUA baris berpagar; kalau tidak, "|" pertama = pemisah kolom (kolom pertama boleh kosong).
      const fenced = data.every((l) => l.trim().startsWith("|"));
      const rows = data.map((l) => (fenced ? splitRow(l) : l.split("|").map((x) => x.trim())));
      const cols = Math.max(...rows.map((r) => r.length));
      if (cols >= 2 && cols <= 12) {
        const norm = rows.map((r) => {
          const c = r.slice(0, cols);
          while (c.length < cols) c.push("");
          return c.map((x) => x.replace(/\|/g, "\\|"));
        });
        // baris lanjutan (kolom pertama kosong) tetap jadi baris sendiri; tabel tidak digabung-gabung
        out.push(`| ${norm[0].join(" | ")} |`, `|${norm[0].map(() => "---").join("|")}|`, ...norm.slice(1).map((r) => `| ${r.join(" | ")} |`));
        i = j;
        continue;
      }
    }
    out.push(...lines.slice(i, Math.min(j + 1, lines.length)));
    i = j;
  }
  return out.join("\n");
}

const GREETING_RE = /^(?:halo|hai|hi|hello|assalamu['’]?alaikum|selamat\s+(?:pagi|siang|sore|malam))\b[^.!\n]{0,45}[!.]\s*/i;
const SELF_PROMO_RE = /mengenai gambar|bisa (?:langsung )?membuatkan(?:nya)? gambar|buatkan gambar \[|bot,\s*buatkan gambar|bot,\s*jadikan/i;

/** Jawaban AI -> isi dokumen yang bersih: tabel gambar diangkat, sapaan pembuka & promosi perintah bot di ujung dibuang. */
export function cleanAnswerForFile(text) {
  let s = liftAsciiTables(String(text ?? "").replace(/\r\n?/g, "\n")).trim();
  if (!s) return s;
  // sapaan di awal ("Halo Abu Ayyub! ...")
  const lines = s.split("\n");
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && !/^\s*#/.test(lines[first])) {
    const stripped = lines[first].replace(GREETING_RE, "");
    if (stripped !== lines[first]) {
      lines[first] = stripped.charAt(0).toUpperCase() + stripped.slice(1);
      if (!lines[first].trim()) lines.splice(first, 1);
    }
    s = lines.join("\n");
  }
  // promosi perintah bot di ujung ("Mengenai gambarnya, ... bot, buatkan gambar ...")
  const all = s.split("\n");
  const from = all.length - 10;
  const idx = all.findIndex((l, i) => i >= Math.max(0, from) && SELF_PROMO_RE.test(l));
  if (idx > 0) {
    let start = idx;
    while (start > 0 && all[start - 1].trim() !== "") start--;
    const kept = all.slice(0, start).join("\n").trim();
    if (kept.length >= 60 || kept.length >= s.length * 0.4) s = kept;
  }
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Judul dokumen: heading pertama; kalau tidak ada, dari permintaan penanya (bila ada); kalau tidak, kalimat pertama. */
export function titleForFile(markdown, hint = "", fallback = "Jawaban Ayyubi") {
  const clip = (t, n = 70) => {
    const x = String(t ?? "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().replace(/[.,:;!?\s]+$/, "");
    if (x.length <= n) return x;
    const cut = x.slice(0, n - 1);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim()}…`;
  };
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  for (const l of String(markdown ?? "").split("\n")) {
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) return cap(clip(m[1]));
    if (l.trim() && !FENCE_RE.test(l)) break;
  }
  const h = clip(
    String(hint ?? "")
      .replace(/^\s*(?:bot|ayyubi)\b[\s,:!-]*/i, "")
      .replace(/^(?:tolong\s+)?(?:buatkan|buatin|bikinkan|bikinin|bikin|buat|jelaskan|tuliskan|tulis|carikan|cari|rangkum|ringkas|sebutkan|tampilkan|berikan|kasih|beri)\s+(?:saya\s+|aku\s+|kami\s+)?/i, "")
  );
  if (h.length >= 6) return cap(h);
  for (const l of String(markdown ?? "").split("\n")) {
    const t = l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!t || FENCE_RE.test(t) || /^[|#]/.test(t)) continue;
    const sentence = /^(.+?[.!?])(?:\s|$)/.exec(t)?.[1] || t;
    const c = clip(sentence);
    if (c.length >= 4) return cap(c);
  }
  return fallback;
}
