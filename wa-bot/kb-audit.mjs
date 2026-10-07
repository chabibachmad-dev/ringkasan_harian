#!/usr/bin/env node
// Audit kualitas pencarian & teks Dokumen Pengetahuan di laptop (tidak mengubah isi indeks).
//
//   node kb-audit.mjs --docs                         # mutu teks tiap dokumen (halaman berantakan, potongan daftar isi)
//   node kb-audit.mjs "apa rukun wudhu" "tarif hotel Jogja"
//   node kb-audit.mjs --file pertanyaan.txt          # satu pertanyaan per baris
//        format baris:  pertanyaan | hal=37 | dok=Fiqih | teks=niat
//        (hal/dok/teks opsional = jawaban yang diharapkan; dipakai untuk menghitung hit-rate)
//   opsi: --budget 5000  --max 8  --no-neighbors  --index /path/kb.sqlite
//
// Keluaran: potongan yang AKAN diterima model (judul, halaman, skor, penanda daftar isi, cuplikan).
// Kalau potongan yang benar tidak muncul di sini, masalahnya di pencarian/chunking/OCR -- bukan di model.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openKbIndex, parsePageMarkers } from "./kb-index.js";
import { readKbConfig, assessPageText } from "./kb-ingest.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, d) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const optNames = new Set(["--budget", "--max", "--file", "--index"]);
const questions = [];
for (let i = 0; i < args.length; i += 1) {
  if (optNames.has(args[i])) {
    i += 1;
    continue;
  }
  if (args[i].startsWith("--")) continue;
  questions.push({ q: args[i] });
}
if (opt("--file")) {
  for (const line of fs.readFileSync(opt("--file"), "utf8").split("\n")) {
    const parts = line.split("|").map((s) => s.trim());
    if (!parts[0] || parts[0].startsWith("#")) continue;
    const item = { q: parts[0] };
    for (const p of parts.slice(1)) {
      const m = p.match(/^(hal|dok|teks)\s*=\s*(.+)$/i);
      if (m) item[m[1].toLowerCase()] = m[2];
    }
    questions.push(item);
  }
}

const baseDir = fileURLToPath(new URL(".", import.meta.url));
const cfg = readKbConfig(process.env, baseDir);
const file = opt("--index", cfg.indexFile);
if (!fs.existsSync(file)) {
  console.error(`Indeks tidak ditemukan: ${file}`);
  process.exit(1);
}
const index = await openKbIndex({ file, chunkChars: cfg.chunkChars, overlapChars: cfg.chunkOverlap, log: { log() {}, error: console.error } });
const st = index.stats();
console.log(`Indeks: ${file}\n${st.docs} dokumen • ${st.chunks} potongan • ${st.chars.toLocaleString("id-ID")} karakter • driver ${st.driver}\n`);

if (flag("--docs") || (questions.length === 0 && !opt("--file"))) {
  console.log("== Mutu teks per dokumen ==");
  for (const d of index.listDocs()) {
    const pages = parsePageMarkers(index.getDocText(d.id));
    let withText = 0;
    const bad = [];
    for (const p of pages) {
      if (p.text.replace(/\s+/g, "").length < 25) continue;
      withText += 1;
      const a = assessPageText(p.text);
      if (a.bad) bad.push(`${p.page ?? "?"}(${a.reason})`);
    }
    const ratio = withText ? bad.length / withText : 0;
    const flagTxt = ratio >= 0.3 ? "❌ BANYAK berantakan" : ratio >= 0.1 ? "⚠️  sebagian berantakan" : bad.length > 0 ? "• sedikit" : "✅ bersih";
    console.log(`${flagTxt}  ${d.title}  — ${d.pages ?? "?"} hlm, ${d.ocr_pages} hlm OCR, berantakan ${bad.length}/${withText}${bad.length ? ` [${bad.slice(0, 8).join(", ")}${bad.length > 8 ? ", …" : ""}]` : ""}`);
  }
  console.log("");
}

let hits = 0;
let judged = 0;
const budgetChars = Number(opt("--budget", 5000));
const maxChunks = Number(opt("--max", 8));
for (const item of questions) {
  const blocks = index.search(item.q, { budgetChars, maxChunks, neighbors: !flag("--no-neighbors") });
  const total = blocks.reduce((n, b) => n + b.text.length, 0);
  console.log(`== ${item.q}\n   ${blocks.length} blok • ${total} karakter (≈ ${Math.round(total / 3.5)} token)`);
  blocks.forEach((b, i) => {
    console.log(`   ${i + 1}. [${b.title}] hlm ${b.page ?? "?"} • skor ${b.score.toFixed(2)}\n      ${b.text.replace(/\s+/g, " ").slice(0, 170)}…`);
  });
  if (blocks.length === 0) console.log("   (tidak ada potongan yang cocok)");
  if (item.hal || item.dok || item.teks) {
    judged += 1;
    const ok = blocks.some(
      (b) =>
        (!item.hal || b.text.includes(`[Halaman ${item.hal}]`)) &&
        (!item.dok || b.title.toLowerCase().includes(item.dok.toLowerCase())) &&
        (!item.teks || b.text.toLowerCase().includes(item.teks.toLowerCase()))
    );
    if (ok) hits += 1;
    console.log(`   ${ok ? "✅ HIT" : "❌ MISS"} (harapan: ${[item.dok && `dok~${item.dok}`, item.hal && `hlm ${item.hal}`, item.teks && `teks~"${item.teks}"`].filter(Boolean).join(", ")})`);
  }
  console.log("");
}
if (judged > 0) console.log(`Hit-rate: ${hits}/${judged} (${Math.round((100 * hits) / judged)}%)`);
index.close();
