// ================================================================
// Mengganti kata di PDF TANPA merusak tampilannya: kotak putih di atas kata lama + teks baru di posisi yang sama.
//
//   overlayReplacePdf(buf, [{from,to}]) -> { buf, counts, notes, signed, multiline }   (buf = null bila tidak ada yang cocok)
//
// Cara kerja (tanpa pustaka tambahan, memakai poppler yang sudah dipakai fitur PDF lain):
//   1. `pdftotext -bbox-layout` memberi koordinat tiap kata  -> letak kata yang dicari
//   2. `pdftohtml -xml`          memberi jenis/ukuran/warna huruf di tempat itu (opsional)
//   3. PDF asli TIDAK ditulis ulang: perubahan ditambahkan di akhir berkas sebagai "pembaruan inkremental"
//      (halaman yang sama + satu aliran isi baru). Semua yang lain (kop, logo, QR, halaman lain) tetap byte demi byte.
//
// Batas yang disengaja:
//   - Teks lama TETAP ada di bawah kotak putih (pencarian/salin masih menemukannya): ini bukan penghapusan aman.
//   - Huruf baru = huruf standar PDF yang paling mirip (Helvetica / Times / Courier), bukan huruf asli.
//   - Kata yang terbelah di dua baris tidak ditangani (multiline = true -> pemanggil boleh membuat ulang dari isi).
//   - Hanya PDF tak terenkripsi, halaman tidak diputar. Latar berwarna akan tampak kotak putih.
//   - PDF yang memuat tanda tangan elektronik diberi cap merah "REVISI" di tiap halaman.
// ================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { baseFontName, fontKeyFor, textWidth, toWinAnsi } from "./pdf-metrics.js";
import { hasESignature } from "./doc-edit.js";

export const OVERLAY_MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 100;
const STAMP_TEXT = "REVISI - bukan dokumen asli. Tanda tangan elektronik pada dokumen asli tidak berlaku pada salinan ini.";

const fail = (kind, message) => Object.assign(new Error(message), { kind });

// ---------------------------------------------------------------- objek PDF
export class Name {
  constructor(v) {
    this.v = v;
  }
}
export class Ref {
  constructor(n, g = 0) {
    this.n = n;
    this.g = g;
  }
}
export class Str {
  constructor(v) {
    this.v = v;
  }
}
const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
const isDelim = (c) => "()<>[]{}/%".includes(c);

function skipWs(s, i) {
  for (;;) {
    while (i < s.length && isWs(s[i])) i++;
    if (s[i] === "%") {
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
    } else return i;
  }
}

/** Membaca satu nilai PDF di posisi i. -> [nilai, posisiBerikutnya] */
export function parseValue(s, i = 0, depth = 0) {
  if (depth > 60) throw fail("badpdf", "struktur terlalu dalam");
  i = skipWs(s, i);
  const c = s[i];
  if (c === undefined) throw fail("badpdf", "berakhir tiba-tiba");
  if (c === "<" && s[i + 1] === "<") {
    const m = new Map();
    i += 2;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === ">" && s[i + 1] === ">") return [m, i + 2];
      if (s[i] !== "/") throw fail("badpdf", "kamus rusak");
      const [k, ni] = parseValue(s, i, depth + 1);
      const [v, nj] = parseValue(s, ni, depth + 1);
      m.set(k.v, v);
      i = nj;
    }
  }
  if (c === "<") {
    const j = s.indexOf(">", i);
    if (j < 0) throw fail("badpdf", "string hex rusak");
    let hex = s.slice(i + 1, j).replace(/\s+/g, "");
    if (hex.length % 2) hex += "0";
    let out = "";
    for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
    return [new Str(out), j + 1];
  }
  if (c === "(") {
    let out = "";
    let nest = 1;
    i++;
    while (i < s.length && nest > 0) {
      const ch = s[i];
      if (ch === "\\") {
        const n = s[i + 1];
        if (/[0-7]/.test(n)) {
          let o = n;
          let k = i + 2;
          while (o.length < 3 && /[0-7]/.test(s[k])) o += s[k++];
          out += String.fromCharCode(parseInt(o, 8) & 255);
          i = k;
          continue;
        }
        const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
        if (n === "\r" || n === "\n") {
          i += n === "\r" && s[i + 2] === "\n" ? 3 : 2;
          continue;
        }
        out += map[n] ?? n;
        i += 2;
        continue;
      }
      if (ch === "(") nest++;
      else if (ch === ")") {
        nest--;
        if (nest === 0) {
          i++;
          break;
        }
      }
      out += ch;
      i++;
    }
    return [new Str(out), i];
  }
  if (c === "[") {
    const arr = [];
    i++;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === "]") return [arr, i + 1];
      const [v, ni] = parseValue(s, i, depth + 1);
      arr.push(v);
      i = ni;
    }
  }
  if (c === "/") {
    let j = i + 1;
    while (j < s.length && !isWs(s[j]) && !isDelim(s[j])) j++;
    const raw = s.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    return [new Name(raw), j];
  }
  const m = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 40));
  if (m) {
    const num = Number(m[0]);
    let j = i + m[0].length;
    if (/^\d+$/.test(m[0])) {
      const r = /^\s+(\d+)\s+R(?![A-Za-z0-9])/.exec(s.slice(j, j + 24));
      if (r) return [new Ref(num, Number(r[1])), j + r[0].length];
    }
    return [num, j];
  }
  const kw = /^(true|false|null)(?![A-Za-z0-9])/.exec(s.slice(i, i + 6));
  if (kw) return [kw[1] === "true" ? true : kw[1] === "false" ? false : null, i + kw[1].length];
  throw fail("badpdf", `token tak dikenal di ${i}`);
}

const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000));
export function serialize(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Name) return `/${[...v.v].map((ch) => (ch.charCodeAt(0) < 33 || ch.charCodeAt(0) > 126 || isDelim(ch) || ch === "#" ? `#${ch.charCodeAt(0).toString(16).padStart(2, "0")}` : ch)).join("")}`;
  if (v instanceof Ref) return `${v.n} ${v.g} R`;
  if (v instanceof Str) return `<${[...v.v].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("")}>`;
  if (Array.isArray(v)) return `[${v.map(serialize).join(" ")}]`;
  if (v instanceof Map) return `<<${[...v].map(([k, val]) => `${serialize(new Name(k))} ${serialize(val)}`).join(" ")}>>`;
  throw fail("badpdf", "nilai tak bisa ditulis");
}

// ---------------------------------------------------------------- dokumen: xref, objek, halaman
function pngUnpredict(data, columns, colors = 1, bpc = 8) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const row = Math.ceil((columns * colors * bpc) / 8);
  const out = Buffer.alloc(Math.floor(data.length / (row + 1)) * row);
  let prev = Buffer.alloc(row);
  for (let r = 0, o = 0; r + row + 1 <= data.length; r += row + 1, o += row) {
    const f = data[r];
    const cur = out.subarray(o, o + row);
    for (let x = 0; x < row; x++) {
      const raw = data[r + 1 + x];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v;
      if (f === 0) v = raw;
      else if (f === 1) v = raw + a;
      else if (f === 2) v = raw + b;
      else if (f === 3) v = raw + Math.floor((a + b) / 2);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
    prev = Buffer.from(cur);
  }
  return out;
}

class PdfDoc {
  constructor(buf) {
    this.buf = buf;
    this.s = buf.toString("latin1");
    this.xref = new Map(); // n -> { type: 0|1|2, off, gen | stm, idx }
    this.trailer = null;
    this.kind = "table";
    this.cache = new Map();
    this.objStreams = new Map();
    this.loadXref();
    if (this.trailer.has("Encrypt")) throw fail("encrypted", "PDF terenkripsi");
  }

  loadXref() {
    const { s } = this;
    const tail = s.lastIndexOf("startxref");
    if (tail < 0) throw fail("badpdf", "startxref tidak ada");
    let off = Number(/^startxref\s+(\d+)/.exec(s.slice(tail, tail + 40))?.[1]);
    if (!Number.isFinite(off)) throw fail("badpdf", "startxref rusak");
    const seen = new Set();
    let first = true;
    while (Number.isFinite(off) && !seen.has(off)) {
      seen.add(off);
      const sec = this.readSection(off);
      for (const [n, e] of sec.entries) if (!this.xref.has(n)) this.xref.set(n, e);
      if (sec.xrefStm !== undefined && !seen.has(sec.xrefStm)) {
        seen.add(sec.xrefStm);
        const hyb = this.readSection(sec.xrefStm);
        for (const [n, e] of hyb.entries) if (!this.xref.has(n)) this.xref.set(n, e);
      }
      if (first) {
        this.trailer = sec.trailer;
        this.kind = sec.kind;
        first = false;
      }
      off = sec.prev;
    }
    if (!this.trailer?.has("Root")) throw fail("badpdf", "Root tidak ada");
    this.size = Math.max(Number(this.trailer.get("Size")) || 0, ...[...this.xref.keys()].map((n) => n + 1));
  }

  readSection(off) {
    const { s } = this;
    let i = skipWs(s, off);
    if (s.startsWith("xref", i)) {
      i += 4;
      const entries = new Map();
      const re = /\s*(\d+)\s+(\d+)\s+([nf])/y;
      for (;;) {
        i = skipWs(s, i);
        if (s.startsWith("trailer", i)) break;
        const head = /(\d+)\s+(\d+)/y;
        head.lastIndex = i;
        const m = head.exec(s);
        if (!m) throw fail("badpdf", "xref rusak");
        let n = Number(m[1]);
        const count = Number(m[2]);
        i = head.lastIndex;
        for (let k = 0; k < count; k++, n++) {
          re.lastIndex = i;
          const e = re.exec(s);
          if (!e) throw fail("badpdf", "entri xref rusak");
          i = re.lastIndex;
          if (!entries.has(n)) entries.set(n, e[3] === "n" ? { type: 1, off: Number(e[1]), gen: Number(e[2]) } : { type: 0 });
        }
      }
      const [trailer] = parseValue(s, i + 7);
      return { entries, trailer, kind: "table", prev: trailer.has("Prev") ? Number(trailer.get("Prev")) : undefined, xrefStm: trailer.has("XRefStm") ? Number(trailer.get("XRefStm")) : undefined };
    }
    // aliran xref
    const objHead = /(\d+)\s+(\d+)\s+obj/y;
    objHead.lastIndex = i;
    const oh = objHead.exec(s);
    if (!oh) throw fail("badpdf", "xref tidak ditemukan");
    const st = this.parseIndirectAt(objHead.lastIndex);
    if (!st.dict || st.dict.get("Type")?.v !== "XRef") throw fail("badpdf", "bukan aliran xref");
    const data = this.decode(st);
    const W = st.dict.get("W").map(Number);
    const size = Number(st.dict.get("Size"));
    const index = (st.dict.get("Index") || [0, size]).map(Number);
    const rowLen = W[0] + W[1] + W[2];
    const rd = (pos, w) => {
      let v = 0;
      for (let k = 0; k < w; k++) v = v * 256 + data[pos + k];
      return v;
    };
    const entries = new Map();
    let pos = 0;
    for (let k = 0; k + 1 < index.length; k += 2) {
      for (let n = index[k]; n < index[k] + index[k + 1]; n++, pos += rowLen) {
        if (pos + rowLen > data.length) break;
        const type = W[0] ? rd(pos, W[0]) : 1;
        const f2 = rd(pos + W[0], W[1]);
        const f3 = rd(pos + W[0] + W[1], W[2]);
        if (!entries.has(n)) entries.set(n, type === 1 ? { type: 1, off: f2, gen: f3 } : type === 2 ? { type: 2, stm: f2, idx: f3 } : { type: 0 });
      }
    }
    return { entries, trailer: st.dict, kind: "stream", prev: st.dict.has("Prev") ? Number(st.dict.get("Prev")) : undefined };
  }

  /** Setelah "n g obj": nilai, dan bila ada "stream": { dict, raw }. */
  parseIndirectAt(pos) {
    const { s } = this;
    const [v, ni] = parseValue(s, pos);
    const j = skipWs(s, ni);
    if (v instanceof Map && s.startsWith("stream", j)) {
      let st = j + 6;
      if (s[st] === "\r" && s[st + 1] === "\n") st += 2;
      else if (s[st] === "\n" || s[st] === "\r") st += 1;
      let len = v.get("Length");
      if (len instanceof Ref) len = this.resolve(len);
      let end;
      if (Number.isFinite(len) && s.startsWith("endstream", skipWs(s, st + len))) end = st + len;
      else {
        end = s.indexOf("endstream", st);
        if (end < 0) throw fail("badpdf", "endstream tidak ada");
        if (s[end - 1] === "\n") end--;
        if (s[end - 1] === "\r") end--;
      }
      return { dict: v, raw: this.buf.subarray(st, end) };
    }
    return v;
  }

  decode(st) {
    let filters = st.dict.get("Filter");
    let parms = st.dict.get("DecodeParms");
    if (filters instanceof Ref) filters = this.resolve(filters);
    const fl = filters === undefined ? [] : Array.isArray(filters) ? filters : [filters];
    const pl = parms === undefined ? [] : Array.isArray(parms) ? parms : [parms];
    let data = st.raw;
    fl.forEach((f, k) => {
      const name = f?.v;
      if (name !== "FlateDecode" && name !== "Fl") throw fail("unsupported", `filter ${name} tidak didukung`);
      try {
        data = zlib.inflateSync(data);
      } catch {
        data = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      }
      let p = pl[k];
      if (p instanceof Ref) p = this.resolve(p);
      if (p instanceof Map && Number(p.get("Predictor")) >= 10) data = pngUnpredict(data, Number(p.get("Columns") ?? 1), Number(p.get("Colors") ?? 1), Number(p.get("BitsPerComponent") ?? 8));
    });
    return data;
  }

  getObject(n) {
    if (this.cache.has(n)) return this.cache.get(n);
    const e = this.xref.get(n);
    let v = null;
    if (e?.type === 1) {
      const re = /(\d+)\s+(\d+)\s+obj/y;
      re.lastIndex = skipWs(this.s, e.off);
      const m = re.exec(this.s);
      if (!m || Number(m[1]) !== n) throw fail("badpdf", `objek ${n} tidak ada di offset`);
      v = this.parseIndirectAt(re.lastIndex);
    } else if (e?.type === 2) {
      let os = this.objStreams.get(e.stm);
      if (!os) {
        const st = this.getObject(e.stm);
        if (!st?.dict) throw fail("badpdf", "aliran objek rusak");
        const text = this.decode(st).toString("latin1");
        const N = Number(st.dict.get("N"));
        const First = Number(st.dict.get("First"));
        const nums = [];
        let pos = 0;
        for (let k = 0; k < N; k++) {
          const a = /\s*(\d+)\s+(\d+)/y;
          a.lastIndex = pos;
          const m = a.exec(text);
          if (!m) break;
          nums.push([Number(m[1]), Number(m[2])]);
          pos = a.lastIndex;
        }
        os = { text, First, nums };
        this.objStreams.set(e.stm, os);
      }
      const hit = os.nums.find(([num]) => num === n);
      if (hit) v = parseValue(os.text, os.First + hit[1])[0];
    }
    this.cache.set(n, v);
    return v;
  }

  resolve(v, depth = 0) {
    while (v instanceof Ref && depth++ < 20) v = this.getObject(v.n);
    return v;
  }

  /** Daftar halaman dengan atribut yang diwariskan. */
  pages() {
    const root = this.resolve(this.trailer.get("Root"));
    const out = [];
    const walk = (ref, inh, depth) => {
      if (depth > 30 || out.length > 5000) throw fail("badpdf", "pohon halaman terlalu dalam");
      const node = this.resolve(ref);
      if (!(node instanceof Map)) return;
      const next = { ...inh };
      for (const k of ["Resources", "MediaBox", "CropBox", "Rotate"]) if (node.has(k)) next[k] = node.get(k);
      const kids = this.resolve(node.get("Kids"));
      if (Array.isArray(kids) && node.get("Type")?.v !== "Page") for (const kid of kids) walk(kid, next, depth + 1);
      else out.push({ num: ref instanceof Ref ? ref.n : -1, dict: node, inh: next });
    };
    walk(root.get("Pages"), {}, 0);
    return out;
  }
}

// ---------------------------------------------------------------- penulis pembaruan inkremental
class IncrementalWriter {
  constructor(doc) {
    this.doc = doc;
    this.next = doc.size;
    this.objs = []; // { num, body: Buffer }
  }
  alloc() {
    return this.next++;
  }
  put(num, value) {
    this.objs.push({ num, body: Buffer.from(serialize(value), "latin1") });
    return new Ref(num);
  }
  add(value) {
    return this.put(this.alloc(), value);
  }
  addStream(dict, data) {
    const num = this.alloc();
    const d = new Map(dict);
    d.set("Length", data.length);
    this.objs.push({ num, body: Buffer.concat([Buffer.from(`${serialize(d)}\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]) });
    return new Ref(num);
  }
  build() {
    const { doc } = this;
    const chunks = [doc.buf];
    let len = doc.buf.length;
    const push = (b) => {
      chunks.push(b);
      len += b.length;
    };
    if (doc.buf[doc.buf.length - 1] !== 0x0a) push(Buffer.from("\n"));
    const offs = new Map();
    for (const o of this.objs) {
      offs.set(o.num, len);
      push(Buffer.concat([Buffer.from(`${o.num} 0 obj\n`, "latin1"), o.body, Buffer.from("\nendobj\n", "latin1")]));
    }
    const prev = Number(/^startxref\s+(\d+)/.exec(doc.s.slice(doc.s.lastIndexOf("startxref"), doc.s.lastIndexOf("startxref") + 40))[1]);
    const t = doc.trailer;
    const common = new Map([["Root", t.get("Root")]]);
    if (t.has("Info")) common.set("Info", t.get("Info"));
    if (t.has("ID")) common.set("ID", t.get("ID"));
    const groups = (nums) => {
      const sorted = [...nums].sort((a, b) => a - b);
      const out = [];
      for (const n of sorted) {
        const last = out[out.length - 1];
        if (last && n === last[0] + last[1]) last[1]++;
        else out.push([n, 1]);
      }
      return out;
    };
    if (doc.kind === "stream") {
      const xnum = this.alloc();
      const xoff = len;
      const nums = [...offs.keys(), xnum];
      offs.set(xnum, xoff);
      const idx = groups(nums);
      const rows = [];
      for (const [start, count] of idx) {
        for (let n = start; n < start + count; n++) {
          const o = offs.get(n);
          rows.push(Buffer.from([1, (o >>> 24) & 255, (o >>> 16) & 255, (o >>> 8) & 255, o & 255, 0, 0]));
        }
      }
      const data = Buffer.concat(rows);
      const d = new Map([["Type", new Name("XRef")], ["Size", Math.max(doc.size, this.next)], ["W", [1, 4, 2]], ["Index", idx.flat()], ...common, ["Prev", prev], ["Length", data.length]]);
      push(Buffer.concat([Buffer.from(`${xnum} 0 obj\n${serialize(d)}\nstream\n`, "latin1"), data, Buffer.from("\nendstream\nendobj\n", "latin1")]));
      push(Buffer.from(`startxref\n${xoff}\n%%EOF\n`));
    } else {
      const xoff = len;
      let table = "xref\n";
      for (const [start, count] of groups(offs.keys())) {
        table += `${start} ${count}\n`;
        for (let n = start; n < start + count; n++) table += `${String(offs.get(n)).padStart(10, "0")} 00000 n \n`;
      }
      const tr = new Map([["Size", Math.max(doc.size, this.next)], ...common, ["Prev", prev]]);
      push(Buffer.from(`${table}trailer\n${serialize(tr)}\nstartxref\n${xoff}\n%%EOF\n`, "latin1"));
    }
    return Buffer.concat(chunks);
  }
}

// ---------------------------------------------------------------- koordinat kata (poppler)
const unent = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");

/** Keluaran `pdftotext -bbox-layout` -> halaman[] { w, h, lines[] { words[] { x0,y0,x1,y1,text } } } */
export function parseBboxLayout(html) {
  const pages = [];
  for (const pm of html.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
    const lines = [];
    for (const bm of pm[3].matchAll(/<block [^>]*>([\s\S]*?)<\/block>/g)) {
      const blockLines = [];
      for (const lm of bm[1].matchAll(/<line [^>]*>([\s\S]*?)<\/line>/g)) {
        const words = [...lm[1].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)].map((w) => ({ x0: Number(w[1]), y0: Number(w[2]), x1: Number(w[3]), y1: Number(w[4]), text: unent(w[5]) }));
        if (words.length) blockLines.push({ words, block: lines.length ? lines[lines.length - 1].block + 1 : 0 });
      }
      const id = (lines.at(-1)?.block ?? -1) + 1;
      for (const l of blockLines) lines.push({ words: l.words, block: id });
    }
    pages.push({ w: Number(pm[1]), h: Number(pm[2]), lines });
  }
  return pages;
}

/** Keluaran `pdftohtml -xml` -> halaman[] { chunks[] { top,left,width,height,font:{size,family,color}, bold, italic } } */
export function parseFontXml(xml) {
  const pages = [];
  for (const pm of xml.matchAll(/<page number="\d+"[^>]*>([\s\S]*?)<\/page>/g)) {
    const fonts = new Map();
    for (const f of pm[1].matchAll(/<fontspec id="(\d+)" size="([\d.]+)" family="([^"]*)" color="([^"]*)"\/>/g)) fonts.set(f[1], { size: Number(f[2]), family: f[3], color: f[4] });
    const chunks = [];
    for (const c of pm[1].matchAll(/<text top="(-?[\d.]+)" left="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" font="(\d+)">([\s\S]*?)<\/text>/g)) {
      const font = fonts.get(c[5]);
      if (!font || !c[6].replace(/<[^>]+>/g, "").trim()) continue;
      chunks.push({ top: Number(c[1]), left: Number(c[2]), width: Number(c[3]), height: Number(c[4]), font, bold: /^<b>/.test(c[6]), italic: /^(?:<b>)?<i>/.test(c[6]) });
    }
    pages.push({ chunks });
  }
  return pages;
}

const norm = (t) => String(t).replace(/[ \s]+/g, " ").trim().toLowerCase();

/** Semua kemunculan frasa (dalam satu baris) di satu halaman. */
export function findPhrase(page, phrase) {
  const needle = norm(phrase);
  const hits = [];
  if (!needle) return hits;
  for (const [li, line] of page.lines.entries()) {
    let text = "";
    const spans = []; // karakter -> kata
    line.words.forEach((w, wi) => {
      if (text) text += " ";
      const start = text.length;
      text += w.text.toLowerCase();
      spans.push({ wi, start, end: text.length });
    });
    for (let from = 0; ; ) {
      const a = text.indexOf(needle, from);
      if (a < 0) break;
      const b = a + needle.length;
      from = b;
      const wA = spans.find((s) => a >= s.start && a < s.end);
      const wB = spans.find((s) => b > s.start && b <= s.end);
      if (!wA || !wB) continue; // jatuh di spasi
      const posIn = (w, span, k) => {
        const word = line.words[span.wi];
        const t = word.text;
        const off = Math.min(Math.max(k - span.start, 0), t.length);
        const total = textWidth(t, "helv.r", 1) || 1;
        return word.x0 + ((word.x1 - word.x0) * textWidth(t.slice(0, off), "helv.r", 1)) / total;
      };
      const x0 = a === wA.start ? line.words[wA.wi].x0 : posIn(null, wA, a);
      const x1 = b === wB.end ? line.words[wB.wi].x1 : posIn(null, wB, b);
      const used = line.words.slice(wA.wi, wB.wi + 1);
      const rest = line.words.slice(wB.wi + 1);
      hits.push({
        li,
        x0,
        x1,
        y0: Math.min(...used.map((w) => w.y0)),
        y1: Math.max(...used.map((w) => w.y1)),
        nextX: b !== wB.end ? x1 + 3 : rest.length ? rest[0].x0 : null, // frasa berhenti di tengah kata (mis. "Santoso,"): sisa kata menempel di x1
        alone: a === 0 && b === text.length,
        lineX0: line.words[0].x0,
        lineX1: line.words.at(-1).x1
      });
    }
  }
  return hits;
}

/** Frasa terpotong antar-baris dalam satu blok? (untuk memberi tahu pemanggil) */
function existsAcrossLines(page, phrase) {
  const needle = norm(phrase);
  const byBlock = new Map();
  for (const l of page.lines) byBlock.set(l.block, `${byBlock.get(l.block) || ""} ${l.words.map((w) => w.text).join(" ")}`);
  return [...byBlock.values()].some((t) => norm(t).includes(needle));
}

// ---------------------------------------------------------------- gambar di halaman
const pdfStr = (bytes) => {
  let out = "(";
  for (const b of bytes) out += b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b);
  return `${out})`;
};
const rgb = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
};
const n4 = (n) => fmtNum(Math.round(n * 100) / 100);

function run(cmd, args, { timeoutMs = 40_000, maxBuffer = 128 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else resolve(stdout);
    });
  });
}

const normBox = (b) => {
  const a = (Array.isArray(b) ? b : []).map(Number);
  if (a.length !== 4 || a.some((x) => !Number.isFinite(x))) return null;
  return { llx: Math.min(a[0], a[2]), lly: Math.min(a[1], a[3]), urx: Math.max(a[0], a[2]), ury: Math.max(a[1], a[3]) };
};

/**
 * Ganti kata di PDF dengan kotak putih + teks baru. pairs = [{ from, to }].
 * -> { buf|null, counts[], notes[], signed, multiline[] }. Melempar Error ber-.kind: "notool" | "badpdf" | "encrypted" | "unsupported" | "toobig" | "timeout".
 */
export async function overlayReplacePdf(buf, pairs, { exec = run, tmpDir = os.tmpdir(), stamp = null } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw fail("badpdf", "bukan PDF");
  if (buf.length > OVERLAY_MAX_BYTES) throw fail("toobig", "PDF terlalu besar");
  let doc;
  try {
    doc = new PdfDoc(buf);
  } catch (e) {
    if (e?.kind) throw e;
    throw fail("badpdf", `struktur PDF tidak terbaca: ${e?.message || e}`);
  }
  const pageList = doc.pages();
  if (pageList.length === 0) throw fail("badpdf", "tidak ada halaman");

  const dir = fs.mkdtempSync(path.join(tmpDir, "wa-ovl-"));
  const file = path.join(dir, "in.pdf");
  let layout;
  let fontPages = [];
  try {
    fs.writeFileSync(file, buf);
    try {
      layout = parseBboxLayout(await exec("pdftotext", ["-bbox-layout", "-enc", "UTF-8", "-l", String(MAX_PAGES), file, "-"]));
    } catch (e) {
      if (e?.code === "ENOENT") throw fail("notool", "pdftotext belum terpasang");
      if (e?.killed || e?.signal === "SIGTERM") throw fail("timeout", "pdftotext kelamaan");
      throw fail("badpdf", `pdftotext gagal: ${String(e?.stderr || e?.message || e).slice(0, 160)}`);
    }
    try {
      fontPages = parseFontXml(await exec("pdftohtml", ["-xml", "-zoom", "1", "-i", "-stdout", "-l", String(MAX_PAGES), file]));
    } catch {
      fontPages = []; // tanpa info huruf: pakai Helvetica ukuran dari tinggi kata
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const allText = layout.map((p) => p.lines.map((l) => l.words.map((w) => w.text).join(" ")).join("\n")).join("\n");
  const signedDigital = /\/ByteRange\s*\[/.test(doc.s);
  const signed = signedDigital || hasESignature(allText);
  const doStamp = stamp === null ? signed : Boolean(stamp);

  const counts = pairs.map(() => 0);
  const notes = [];
  const multiline = [];
  const perPage = new Map(); // indeks halaman -> { rects[], texts[] }
  const used = new Set(); // kunci huruf yang dipakai

  pairs.forEach((pair, pi) => {
    let foundAny = false;
    layout.slice(0, pageList.length).forEach((pg, idx) => {
      const hits = findPhrase(pg, pair.from);
      if (!hits.length) return;
      foundAny = true;
      const pageInfo = pageList[idx];
      const rot = Number(doc.resolve(pageInfo.inh.Rotate) ?? 0);
      if (rot % 360 !== 0) throw fail("unsupported", "halaman diputar (rotate)");
      const media = normBox(doc.resolve(pageInfo.inh.MediaBox));
      const crop = normBox(doc.resolve(pageInfo.inh.CropBox));
      const fits = (b) => b && Math.abs(b.urx - b.llx - pg.w) < 1.5 && Math.abs(b.ury - b.lly - pg.h) < 1.5;
      const box = fits(media) ? media : fits(crop) ? crop : null;
      if (!box) throw fail("unsupported", "ukuran halaman tidak cocok dengan kotak halaman");
      const ops = perPage.get(idx) || { rects: [], texts: [], box, w: pg.w };
      perPage.set(idx, ops);
      const fp = fontPages[idx]?.chunks || [];
      for (const h of hits) {
        const cx = (h.x0 + h.x1) / 2;
        const cy = (h.y0 + h.y1) / 2;
        const chunk = fp.find((c) => cy >= c.top - 1.5 && cy <= c.top + c.height + 1.5 && cx >= c.left - 1.5 && cx <= c.left + c.width + 1.5);
        const H = h.y1 - h.y0;
        const key = chunk ? fontKeyFor(chunk.font.family, { bold: chunk.bold, italic: chunk.italic }) : "helv.r";
        const size = chunk?.font.size && Math.abs(chunk.font.size * 1.12 - H) < H * 0.35 ? chunk.font.size : H / 1.12;
        const color = chunk ? rgb(chunk.font.color) : [0, 0, 0];
        // lebar yang tersedia & perataan
        const centered = h.alone && Math.abs(cx - pg.w / 2) < 8;
        const avail = centered ? pg.w - 72 : (h.nextX !== null ? h.nextX - 3 : Math.max(h.x1, pg.w - 36)) - h.x0;
        const text = String(pair.to ?? "");
        let s = size;
        let w = text ? textWidth(text, key, s) : 0;
        if (w > avail && text) {
          s = (size * avail) / w;
          if (s < size * 0.6) {
            notes.push(`"${pair.to}" terlalu panjang untuk ruang yang ada (tidak diganti di satu tempat).`);
            continue;
          }
          w = textWidth(text, key, s);
          notes.push(`"${pair.to}" dikecilkan agar muat.`);
        }
        const enc = toWinAnsi(text);
        if (enc.lossy) notes.push(`Ada karakter di "${pair.to}" yang tidak ada di huruf standar PDF (diganti "?").`);
        const xText = centered ? cx - w / 2 : h.x0;
        const rectL = centered ? Math.min(h.x0, xText) : h.x0;
        const rectR = centered ? Math.max(h.x1, xText + w) : h.x1;
        used.add(key);
        // kotak sedikit melebihi kotak kata (huruf tinggi seperti "K", "b", "A" sering menembus tinggi yang dilaporkan),
        // tapi tidak sampai menimpa baris di atas/bawahnya
        let above = -Infinity;
        let below = Infinity;
        for (const [li, l] of pg.lines.entries()) {
          if (li === h.li) continue;
          const lx0 = l.words[0].x0;
          const lx1 = l.words.at(-1).x1;
          if (lx1 < rectL || lx0 > rectR) continue;
          const ly0 = Math.min(...l.words.map((w) => w.y0));
          const ly1 = Math.max(...l.words.map((w) => w.y1));
          if (ly1 <= cy) above = Math.max(above, ly1);
          else if (ly0 >= cy) below = Math.min(below, ly0);
        }
        const top = Math.min(h.y0 + 0.06 * H, Math.max(h.y0 - 0.16 * H, above + 0.3));
        const bottom = Math.max(h.y1 + 0.6 - 0.6, Math.min(h.y1 + 0.1 * H, below - 0.3));
        ops.rects.push({ x: box.llx + rectL - 0.8, y: box.ury - bottom, w: rectR - rectL + 1.6, h: bottom - top });
        if (text) ops.texts.push({ key, size: s, color, x: box.llx + xText, y: box.ury - (h.y1 - 0.21 * size), bytes: enc.bytes });
        counts[pi]++;
      }
    });
    if (!foundAny && layout.some((pg) => existsAcrossLines(pg, pair.from))) multiline.push(pair.from);
  });

  if (!counts.some((c) => c > 0)) return { buf: null, counts, notes, signed, multiline };

  // ---- tulis pembaruan inkremental
  const w = new IncrementalWriter(doc);
  const fontRefs = new Map();
  const stampKey = "helv.b";
  if (doStamp) used.add(stampKey);
  for (const key of used) fontRefs.set(key, w.add(new Map([["Type", new Name("Font")], ["Subtype", new Name("Type1")], ["BaseFont", new Name(baseFontName(key))], ["Encoding", new Name("WinAnsiEncoding")]])));
  const fontName = (key) => `FoV${[...used].indexOf(key)}`;
  const preRef = w.addStream(new Map(), Buffer.from("q\n", "latin1"));
  const targets = doStamp ? pageList.map((_p, i) => i) : [...perPage.keys()];
  for (const idx of targets) {
    const page = pageList[idx];
    const ops = perPage.get(idx);
    const box = ops?.box || normBox(doc.resolve(page.inh.MediaBox));
    if (!box) continue;
    let rot = Number(doc.resolve(page.inh.Rotate) ?? 0);
    if (rot % 360 !== 0) continue;
    let c = "Q\nq\n";
    if (ops) {
      c += "1 1 1 rg\n";
      for (const r of ops.rects) c += `${n4(r.x)} ${n4(r.y)} ${n4(r.w)} ${n4(r.h)} re f\n`;
      for (const t of ops.texts) c += `BT\n/${fontName(t.key)} ${n4(t.size)} Tf\n${t.color.map((v) => n4(v)).join(" ")} rg\n${n4(t.x)} ${n4(t.y)} Td\n${pdfStr(t.bytes)} Tj\nET\n`;
    }
    if (doStamp) {
      const pw = box.urx - box.llx;
      let ss = 6.5;
      const sw = textWidth(STAMP_TEXT, stampKey, ss);
      if (sw > pw - 40) ss = (ss * (pw - 40)) / sw;
      c += `BT\n/${fontName(stampKey)} ${n4(ss)} Tf\n0.78 0 0 rg\n${n4(box.llx + (pw - textWidth(STAMP_TEXT, stampKey, ss)) / 2)} ${n4(box.ury - 12)} Td\n${pdfStr(toWinAnsi(STAMP_TEXT).bytes)} Tj\nET\n`;
    }
    c += "Q\n";
    const postRef = w.addStream(new Map(), Buffer.from(c, "latin1"));
    const dict = new Map(page.dict);
    const cur = page.dict.get("Contents");
    let orig = [];
    if (cur instanceof Ref) {
      const r = doc.resolve(cur);
      orig = Array.isArray(r) ? r : [cur];
    } else if (Array.isArray(cur)) orig = cur;
    dict.set("Contents", [preRef, ...orig, postRef]);
    const baseRes = doc.resolve(page.dict.get("Resources") ?? page.inh.Resources);
    const res = new Map(baseRes instanceof Map ? baseRes : []);
    const fontDict = doc.resolve(res.get("Font"));
    const fonts = new Map(fontDict instanceof Map ? fontDict : []);
    for (const [key, ref] of fontRefs) fonts.set(fontName(key), ref);
    res.set("Font", fonts);
    dict.set("Resources", res);
    if (page.num < 0) throw fail("unsupported", "objek halaman tidak bisa dialamati");
    w.put(page.num, dict);
  }
  return { buf: w.build(), counts, notes, signed, multiline };
}
