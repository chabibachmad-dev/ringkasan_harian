// Membaca isi berkas untuk agent: teks biasa, .docx, .xlsx, dan PDF (pdftotext bila ada, cadangan pembaca sederhana).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { readZip } from "./zip-lite.js";

export const TEXT_EXT = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".log", ".xml", ".html", ".htm", ".js", ".mjs", ".ts", ".py", ".ini", ".cfg", ".yml", ".yaml", ".bat", ".ps1", ".sql", ".css", ".srt", ".env.example"]);

const decodeEntities = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** document.xml (Word) -> teks, paragraf per baris, sel tabel dipisah tab. */
export function docxXmlToText(xml) {
  return decodeEntities(
    String(xml)
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:p>|<w:br\/>|<\/w:tr>/g, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function colIndex(ref) {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] || "") n = n * 26 + ch.charCodeAt(0) - 64;
  return Math.max(0, n - 1);
}

/** Buku kerja .xlsx -> teks tab-delimited per lembar (hasil rumus yang tersimpan dibaca, bukan rumusnya). */
export function xlsxToText(buf, { maxRows = 400 } = {}) {
  const files = new Map(readZip(buf).map((e) => [e.name, e]));
  const get = (n) => files.get(n)?.read().toString("utf8") || "";
  const strings = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  const wb = get("xl/workbook.xml");
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
  const sheets = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const out = [];
  sheets.forEach((sn, idx) => {
    out.push(`## Lembar: ${names[idx] || `Sheet${idx + 1}`}`);
    const rows = [...get(sn).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].slice(0, maxRows);
    for (const r of rows) {
      const cells = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1] || "A1";
        const type = /t="(\w+)"/.exec(c[1])?.[1] || "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || "")?.[1] ?? "";
        const inl = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2] || "")?.[1];
        cells[colIndex(ref)] = type === "s" ? strings[Number(v)] ?? "" : type === "inlineStr" ? decodeEntities(inl ?? "") : decodeEntities(v);
      }
      out.push(Array.from(cells, (x) => x ?? "").join("\t"));
    }
  });
  return out.join("\n");
}

const run = (cmd, args, timeout = 30_000) =>
  new Promise((resolve) => execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout))));

/** Cadangan: ambil teks dari aliran PDF yang terkompres Flate (cukup untuk PDF sederhana; PDF hasil scan/font khusus tidak terbaca). */
export function pdfBasicText(buf) {
  const s = buf.toString("latin1");
  const parts = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let data = Buffer.from(m[1], "latin1");
    try {
      data = zlib.inflateSync(data);
    } catch {
      /* mungkin tidak terkompres */
    }
    const t = data.toString("latin1");
    if (!/\b(?:Tj|TJ)\b/.test(t)) continue;
    const lines = [];
    for (const blk of t.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*Tj/g)) {
      const src = blk[1] ?? blk[2] ?? "";
      const txt = [...src.matchAll(/\(((?:[^)\\]|\\.)*)\)/g)].map((x) => x[1]).join("") || (blk[2] ?? "");
      lines.push(txt.replace(/\\([()\\])/g, "$1").replace(/\\n/g, " "));
    }
    parts.push(lines.join("\n"));
  }
  return parts.join("\n").replace(/[^\S\n]+/g, " ").trim();
}

/** Berkas -> { text, kind, truncated }. Melempar galat berbahasa Indonesia bila tidak bisa dibaca. */
export async function readFileText(file, { maxChars = 12_000, maxBytes = 20 * 1024 * 1024, exec = run } = {}) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error("Itu bukan berkas.");
  if (st.size > maxBytes) throw new Error(`Berkas terlalu besar (${Math.round(st.size / 1048576)} MB, batas ${Math.round(maxBytes / 1048576)} MB).`);
  const ext = path.extname(file).toLowerCase();
  let text;
  let kind = "teks";
  if (ext === ".docx") {
    const e = readZip(fs.readFileSync(file)).find((x) => x.name === "word/document.xml");
    if (!e) throw new Error("Berkas .docx tidak berisi dokumen.");
    text = docxXmlToText(e.read().toString("utf8"));
    kind = "Word";
  } else if (ext === ".xlsx") {
    text = xlsxToText(fs.readFileSync(file));
    kind = "Excel";
  } else if (ext === ".pdf") {
    kind = "PDF";
    text = (await exec("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"])) || "";
    if (text.trim().length < 20) text = pdfBasicText(fs.readFileSync(file));
    if (text.trim().length < 20) throw new Error("Teks PDF tidak terbaca (mungkin hasil scan/gambar, atau perlu pdftotext dari Poppler).");
  } else if (TEXT_EXT.has(ext) || ext === "") {
    const head = fs.readFileSync(file).subarray(0, 4096);
    if (head.includes(0)) throw new Error("Berkas ini biner, bukan teks.");
    text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } else {
    throw new Error(`Jenis berkas ${ext} belum bisa dibaca (bisa: teks, .docx, .xlsx, .pdf).`);
  }
  const truncated = text.length > maxChars;
  return { text: truncated ? text.slice(0, maxChars) : text, kind, truncated, total: text.length };
}
