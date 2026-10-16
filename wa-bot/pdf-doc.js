// ================================================================
// Pembuat PDF tanpa pustaka tambahan (hanya zlib bawaan Node) untuk jawaban bot yang diminta "jadikan PDF".
//
//   buildPdf(markdown, { title, subtitle }) -> Buffer (A4, huruf Helvetica; teks Latin saja)
//
// Mendukung: judul (# ## ###), paragraf, daftar (- • 1.), tabel markdown (kolom otomatis, baris membungkus, header diulang tiap halaman),
// blok kode (```), garis (---), tebal (**x** atau *x*), miring (_x_), `kode`. Nomor halaman di kaki.
// Batas: font bawaan PDF hanya Latin (aksara Arab/Korea/emoji diganti "?"/dibuang).
// ================================================================

import zlib from "node:zlib";
import { parseTableAt } from "./wa-format.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 54; // margin
const BODY_W = PAGE_W - 2 * M;
const FOOT_Y = 30;

// ---- lebar huruf (per 1000 em), kode 32..126
const W_HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];
const FONTS = { R: { name: "Helvetica", key: "F1", w: W_HELV }, B: { name: "Helvetica-Bold", key: "F2", w: W_BOLD }, I: { name: "Helvetica-Oblique", key: "F3", w: W_HELV }, C: { name: "Courier", key: "F4", w: null } };

// ---- Unicode -> kode WinAnsi
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2030: 0x89, 0x2039: 0x8b, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2122: 0x99, 0x203a: 0x9b };
function encode(str) {
  const out = [];
  for (const ch of String(str ?? "")) {
    const cp = ch.codePointAt(0);
    if (cp === 0x09) out.push(32, 32);
    else if (cp >= 32 && cp <= 126) out.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else if (CP1252[cp]) out.push(CP1252[cp]);
    else if (cp === 0xa0 || cp === 0x200b || cp === 0xfe0f || cp === 0x200d) continue;
    else if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2190 && cp <= 0x21ff)) {
      if (cp === 0x2192) out.push(45, 62); // →
      continue; // emoji / simbol: dibuang
    } else if (cp === 0x2212) out.push(45);
    else if (cp < 32) continue;
    else out.push(63); // ?
  }
  return out;
}
const charW = (code, fontKey) => {
  const f = FONTS[fontKey];
  if (!f.w) return 600;
  if (code >= 32 && code <= 126) return f.w[code - 32];
  if (code === 0x95) return 350;
  if (code === 0x96) return 556;
  if (code === 0x97) return 1000;
  if (code === 0x91 || code === 0x92) return 222;
  if (code === 0x93 || code === 0x94) return 333;
  if (code === 0x85) return 1000;
  return fontKey === "B" ? 611 : 556;
};
const textW = (codes, fontKey, size) => (codes.reduce((a, c) => a + charW(c, fontKey), 0) * size) / 1000;

// ---- penguraian inline -> runs [{ bytes, f }]
const INLINE_RE = /(\*\*(?=\S)[^*\n]+?(?<=\S)\*\*|(?<![\w*])\*(?![\s*])[^*\n]+?(?<![\s*])\*(?![\w*])|(?<![\w_])_(?![\s_])[^_\n]+?(?<![\s_])_(?![\w_])|`[^`\n]+`)/g;
function inlineRuns(text, base = "R") {
  const runs = [];
  let last = 0;
  const s = String(text ?? "");
  for (const m of s.matchAll(INLINE_RE)) {
    if (m.index > last) runs.push({ t: s.slice(last, m.index), f: base });
    const tok = m[0];
    if (tok.startsWith("**")) runs.push({ t: tok.slice(2, -2), f: "B" });
    else if (tok.startsWith("*")) runs.push({ t: tok.slice(1, -1), f: "B" });
    else if (tok.startsWith("_")) runs.push({ t: tok.slice(1, -1), f: base === "B" ? "B" : "I" });
    else runs.push({ t: tok.slice(1, -1), f: "C" });
    last = m.index + tok.length;
  }
  if (last < s.length) runs.push({ t: s.slice(last), f: base });
  return runs.filter((r) => r.t !== "");
}

/** runs -> kata-kata [{ codes, f, space(sebelum) }] */
function toWords(runs) {
  const words = [];
  let spaceBefore = false;
  for (const r of runs) {
    const parts = r.t.split(/(\s+)/);
    for (const p of parts) {
      if (p === "") continue;
      if (/^\s+$/.test(p)) {
        spaceBefore = true;
        continue;
      }
      words.push({ codes: encode(p), f: r.f, space: spaceBefore && words.length > 0 });
      spaceBefore = false;
    }
  }
  return words;
}

/** Bungkus kata ke lebar tertentu -> baris [{ items:[{x, codes, f}], w }] ; kata terlalu panjang dipotong per huruf. */
function wrap(words, width, size) {
  const lines = [];
  let cur = { items: [], w: 0 };
  const spaceW = (f) => (charW(32, f) * size) / 1000;
  const push = () => {
    lines.push(cur);
    cur = { items: [], w: 0 };
  };
  for (const w0 of words) {
    let w = w0;
    // pecah kata yang lebih lebar dari kolom
    const pieces = [];
    if (textW(w.codes, w.f, size) > width) {
      let part = [];
      let pw = 0;
      for (const c of w.codes) {
        const cw = (charW(c, w.f) * size) / 1000;
        if (pw + cw > width && part.length) {
          pieces.push(part);
          part = [];
          pw = 0;
        }
        part.push(c);
        pw += cw;
      }
      if (part.length) pieces.push(part);
    } else pieces.push(w.codes);
    pieces.forEach((codes, pi) => {
      const ww = textW(codes, w.f, size);
      const sp = pi === 0 && w.space && cur.items.length ? spaceW(w.f) : 0;
      if (cur.items.length && cur.w + sp + ww > width + 0.01) push();
      const gap = cur.items.length && pi === 0 && w.space ? spaceW(w.f) : 0;
      cur.items.push({ x: cur.w + gap, codes, f: w.f, w: ww });
      cur.w += gap + ww;
    });
  }
  if (cur.items.length || lines.length === 0) push();
  return lines;
}

const esc = (codes) => {
  let s = "";
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += "\\" + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += "\\" + c.toString(8).padStart(3, "0");
    else s += String.fromCharCode(c);
  }
  return s;
};
const num = (n) => (Math.round(n * 100) / 100).toString();

class Page {
  constructor() {
    this.ops = [];
  }
  text(x, y, items, size, gray = 0) {
    for (const it of items) this.ops.push(`BT ${num(gray)} g /${FONTS[it.f].key} ${num(size)} Tf ${num(x + it.x)} ${num(y)} Td (${esc(it.codes)}) Tj ET`);
    if (gray) this.ops.push("0 g");
  }
  rect(x, y, w, h, { fill = null, stroke = null, lw = 0.5 } = {}) {
    const parts = [];
    if (fill !== null) parts.push(`${num(fill)} g`);
    if (stroke !== null) parts.push(`${num(stroke)} G ${num(lw)} w`);
    parts.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${fill !== null && stroke !== null ? "B" : fill !== null ? "f" : "S"}`);
    parts.push("0 g 0 G");
    this.ops.push(parts.join(" "));
  }
  line(x1, y1, x2, y2, gray = 0.6, lw = 0.6) {
    this.ops.push(`${num(gray)} G ${num(lw)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S 0 G`);
  }
}

class Layout {
  constructor() {
    this.pages = [];
    this.newPage();
  }
  newPage() {
    this.page = new Page();
    this.pages.push(this.page);
    this.y = PAGE_H - M;
    return this.page;
  }
  ensure(h) {
    if (this.y - h < M) {
      this.newPage();
      return true;
    }
    return false;
  }
  /** Baris-baris teks dengan indentasi; kembali setelah menaruh semuanya (pindah halaman otomatis). */
  lines(lines, { size = 11, indent = 0, lead = 1.38, gray = 0, bullet = null } = {}) {
    const lh = size * lead;
    lines.forEach((ln, i) => {
      this.ensure(lh);
      const baseline = this.y - size;
      if (i === 0 && bullet) this.page.text(M + indent - bullet.w - 4, baseline, [{ x: 0, codes: bullet.codes, f: bullet.f }], size, gray);
      this.page.text(M + indent, baseline, ln.items, size, gray);
      this.y -= lh;
    });
  }
  gap(h) {
    this.y -= h;
    if (this.y < M) this.newPage();
  }
}

function drawTable(L, headers, rows) {
  const size = 9.5;
  const padX = 4;
  const padY = 3.2;
  const lead = 1.3;
  const n = headers.length;
  const cellWords = (txt, base) => toWords(inlineRuns(txt, base));
  const hw = headers.map((h) => cellWords(h, "B"));
  const bw = rows.map((r) => r.map((c) => cellWords(c, "R")));
  const nat = Array.from({ length: n }, () => 0);
  const min = Array.from({ length: n }, () => 0);
  const measure = (words, c) => {
    const total = words.reduce((a, w, i) => a + textW(w.codes, w.f, size) + (i && w.space ? (charW(32, w.f) * size) / 1000 : 0), 0);
    nat[c] = Math.max(nat[c], total);
    for (const w of words) min[c] = Math.max(min[c], Math.min(textW(w.codes, w.f, size), 90));
  };
  hw.forEach((w, c) => measure(w, c));
  bw.forEach((r) => r.forEach((w, c) => measure(w, c)));
  const extra = 2 * padX + 0.5;
  let widths = nat.map((v) => v + extra);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  if (sum(widths) <= BODY_W) {
    const k = BODY_W / sum(widths);
    widths = widths.map((v) => v * Math.min(k, 1.35));
    const s = sum(widths);
    if (s < BODY_W && s > BODY_W * 0.8) widths = widths.map((v) => (v * BODY_W) / s);
  } else {
    const mins = min.map((v) => v + extra);
    let base = mins;
    if (sum(base) > BODY_W) base = mins.map((v) => (v * BODY_W) / sum(mins));
    const remain = BODY_W - sum(base);
    const wants = nat.map((v, c) => Math.max(0, v + extra - base[c]));
    const totalWant = sum(wants) || 1;
    widths = base.map((v, c) => v + (remain * wants[c]) / totalWant);
  }
  const xs = [];
  let ax = M;
  for (const w of widths) {
    xs.push(ax);
    ax += w;
  }
  const lh = size * lead;
  const layoutRow = (cells) => {
    const wrapped = cells.map((words, c) => wrap(words, widths[c] - 2 * padX, size));
    const maxLines = Math.max(...wrapped.map((w) => w.length));
    return { wrapped, h: maxLines * lh + 2 * padY };
  };
  const drawRow = (lay, { header = false } = {}) => {
    const top = L.y;
    lay.wrapped.forEach((ls, c) => {
      L.page.rect(xs[c], top - lay.h, widths[c], lay.h, { fill: header ? 0.9 : null, stroke: 0.55, lw: 0.5 });
      ls.forEach((ln, i) => L.page.text(xs[c] + padX, top - padY - size - i * lh + (lh - size) * 0.2, ln.items, size));
    });
    L.y -= lay.h;
  };
  const headLay = layoutRow(hw);
  L.ensure(headLay.h + 30);
  drawRow(headLay, { header: true });
  for (const r of bw) {
    let lay = layoutRow(r);
    const body = PAGE_H - 2 * M - headLay.h;
    if (lay.h > body) {
      // baris lebih tinggi dari satu halaman: potong baris teksnya
      const keep = Math.max(1, Math.floor((body - 2 * padY) / lh));
      lay = { wrapped: lay.wrapped.map((w) => w.slice(0, keep)), h: keep * lh + 2 * padY };
    }
    if (L.y - lay.h < M) {
      L.newPage();
      drawRow(headLay, { header: true });
    }
    drawRow(lay);
  }
  L.gap(8);
}

/** Markdown/teks WhatsApp -> blok. */
function parseBlocks(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lines: code });
      continue;
    }
    const t = parseTableAt(lines, i);
    if (t) {
      blocks.push({ type: "table", headers: t.headers, rows: t.rows });
      i = t.end;
      continue;
    }
    if (line.trim() === "") {
      blocks.push({ type: "gap" });
      i++;
      continue;
    }
    let m;
    if ((m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))) blocks.push({ type: "heading", level: Math.min(3, m[1].length), text: m[2] });
    else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) blocks.push({ type: "hr" });
    else if ((m = /^(\s*)[-*•]\s+(.+)$/.exec(line))) blocks.push({ type: "bullet", level: Math.min(3, Math.floor(m[1].length / 2)), text: m[2] });
    else if ((m = /^(\s*)(\d{1,3})[.)]\s+(.+)$/.exec(line))) blocks.push({ type: "number", level: Math.min(3, Math.floor(m[1].length / 2)), n: m[2], text: m[3] });
    else if ((m = /^\s*\*([^*\n]{2,80})\*\s*$/.exec(line))) blocks.push({ type: "heading", level: 3, text: m[1] }); // baris *Judul* ala WhatsApp
    else blocks.push({ type: "para", text: line.trim() });
    i++;
  }
  return blocks;
}

const slug = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "Jawaban";

/** Judul dokumen dari isi: heading pertama, atau baris pertama (maks 70 huruf). */
export function titleFromText(text, fallback = "Jawaban Ayyubi") {
  for (const b of parseBlocks(text)) {
    if (b.type === "heading") return b.text.replace(/[*_`]/g, "").slice(0, 70);
    if (b.type === "para" || b.type === "bullet" || b.type === "number") {
      const t = b.text.replace(/[*_`]/g, "").trim();
      if (t) return t.length > 70 ? `${t.slice(0, 67)}...` : t;
    }
  }
  return fallback;
}

export const pdfFileName = (title) => `${slug(title)}.pdf`;

export function buildPdf(markdown, { title = "", subtitle = "", footer = "Ayyubi" } = {}) {
  const docTitle = String(title || titleFromText(markdown)).trim() || "Jawaban Ayyubi";
  const blocks = parseBlocks(markdown);
  // heading pertama yang sama dengan judul: tidak diulang
  if (blocks[0]?.type === "heading" && blocks[0].text.replace(/[*_`]/g, "").slice(0, 70) === docTitle) blocks.shift();
  const L = new Layout();

  // kepala dokumen
  L.lines(wrap(toWords([{ t: docTitle, f: "B" }]), BODY_W, 18), { size: 18, lead: 1.25 });
  if (subtitle) L.lines(wrap(toWords([{ t: subtitle, f: "R" }]), BODY_W, 9.5), { size: 9.5, gray: 0.45 });
  L.gap(4);
  L.page.line(M, L.y, PAGE_W - M, L.y, 0.7, 0.8);
  L.gap(12);

  let prevGap = true;
  for (const b of blocks) {
    if (b.type === "gap") {
      if (!prevGap) L.gap(5);
      prevGap = true;
      continue;
    }
    prevGap = false;
    if (b.type === "heading") {
      const size = b.level === 1 ? 15 : b.level === 2 ? 13 : 11.5;
      L.gap(b.level === 3 ? 4 : 8);
      L.ensure(size * 2.6);
      L.lines(wrap(toWords(inlineRuns(b.text, "B")), BODY_W, size), { size, lead: 1.3 });
      L.gap(2);
    } else if (b.type === "hr") {
      L.gap(4);
      L.ensure(10);
      L.page.line(M, L.y, PAGE_W - M, L.y);
      L.gap(8);
    } else if (b.type === "code") {
      const size = 9;
      const cw = (600 * size) / 1000;
      const per = Math.max(10, Math.floor((BODY_W - 12) / cw));
      const lines = [];
      for (const raw of b.lines.length ? b.lines : [""]) {
        const codes = encode(raw.replace(/\t/g, "  "));
        if (!codes.length) lines.push({ items: [], w: 0 });
        for (let i = 0; i < codes.length; i += per) lines.push({ items: [{ x: 0, codes: codes.slice(i, i + per), f: "C" }], w: 0 });
      }
      const lh = size * 1.3;
      let idx = 0;
      while (idx < lines.length) {
        L.ensure(lh * 2 + 10);
        const fit = Math.max(1, Math.min(lines.length - idx, Math.floor((L.y - M - 8) / lh)));
        const chunk = lines.slice(idx, idx + fit);
        L.page.rect(M, L.y - chunk.length * lh - 8, BODY_W, chunk.length * lh + 8, { fill: 0.95, stroke: 0.8 });
        L.y -= 4;
        L.lines(chunk, { size, lead: 1.3, indent: 6 });
        L.y -= 4;
        idx += fit;
      }
      L.gap(6);
    } else if (b.type === "table") {
      drawTable(L, b.headers, b.rows);
    } else {
      const indent = b.type === "bullet" || b.type === "number" ? 14 + b.level * 14 : 0;
      const wordsAll = toWords(inlineRuns(b.text, "R"));
      const lines = wrap(wordsAll, BODY_W - indent, 11);
      const bullet = b.type === "bullet" ? { codes: [0x95], f: "R", w: (350 * 11) / 1000 } : b.type === "number" ? { codes: encode(`${b.n}.`), f: "R", w: textW(encode(`${b.n}.`), "R", 11) } : null;
      L.lines(lines, { size: 11, indent, bullet });
      L.gap(1.5);
    }
  }

  // ---- susun berkas PDF
  const total = L.pages.length;
  const objs = []; // { body: Buffer | string }
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add("");
  const pagesRoot = add("");
  const fontIds = {};
  for (const k of ["R", "B", "I", "C"]) fontIds[FONTS[k].key] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[k].name} /Encoding /WinAnsiEncoding >>`);
  const pageIds = [];
  L.pages.forEach((pg, i) => {
    const footText = `${footer ? `${footer}  •  ` : ""}Halaman ${i + 1} dari ${total}`;
    const codes = encode(footText);
    const w = textW(codes, "R", 8);
    pg.text((PAGE_W - w) / 2, FOOT_Y, [{ x: 0, codes, f: "R" }], 8, 0.5);
    const content = Buffer.from(pg.ops.join("\n"), "latin1");
    const z = zlib.deflateSync(content);
    const cid = add(Buffer.concat([Buffer.from(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), z, Buffer.from("\nendstream", "latin1")]));
    const pid = add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << ${Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(" ")} >> >> /Contents ${cid} 0 R >>`);
    pageIds.push(pid);
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objs[pagesRoot - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  const infoTitle = esc(encode(docTitle).filter((c) => c >= 32 && c <= 126));
  const info = add(`<< /Title (${infoTitle}) /Producer (Ayyubi) /Creator (Ayyubi) >>`);

  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [];
  let pos = chunks[0].length;
  objs.forEach((body, i) => {
    offsets.push(pos);
    const head = Buffer.from(`${i + 1} 0 obj\n`, "latin1");
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1");
    const tail = Buffer.from("\nendobj\n", "latin1");
    chunks.push(head, b, tail);
    pos += head.length + b.length + tail.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}
