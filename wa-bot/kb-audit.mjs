#!/usr/bin/env node
// Audit kualitas pencarian & teks Dokumen Pengetahuan di laptop (tidak mengubah isi indeks).
//
//   node kb-audit.mjs --docs                         # mutu teks tiap dokumen (halaman berantakan, potongan daftar isi)
//   node kb-audit.mjs --pages [--dok Fiqih]         # daftar HALAMAN berantakan beserta alasan & cuplikan teksnya
//   node kb-audit.mjs "apa rukun wudhu" "tarif hotel Jogja"
//   node kb-audit.mjs --file pertanyaan.txt          # satu pertanyaan per baris
//        format baris:  pertanyaan | hal=37 | dok=Fiqih | teks=niat
//        (hal/dok/teks opsional = jawaban yang diharapkan; dipakai untuk menghitung hit-rate)
//   node kb-audit.mjs --file pertanyaan.txt --ask   # + tanya MODEL (Ollama lokal) dengan konteks yang sama, lalu periksa jawabannya
//        kunci tambahan:  tidak=Rp5.109.000  (konteks TIDAK boleh memuat teks ini)
//                         kosong=ya          (pertanyaan TANPA jawaban di dokumen: pencarian harus mengembalikan 0 blok)
//                         jawab=Rp5.725.000  (jawaban model harus memuat teks ini; hanya dengan --ask)
//                         bukan=Rp5.109.000  (jawaban model tidak boleh memuat teks ini; hanya dengan --ask)
//   opsi: --budget 5000  --max 8  --no-neighbors  --index /path/kb.sqlite
//   Kode keluar 1 bila ada yang MISS/GAGAL (bisa dipakai di skrip).
//
// Keluaran: potongan yang AKAN diterima model (judul, halaman, skor, penanda daftar isi, cuplikan).
// Kalau potongan yang benar tidak muncul di sini, masalahnya di pencarian/chunking/OCR -- bukan di model.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { openKbIndex, parsePageMarkers } from "./kb-index.js";
import { readKbConfig, assessPageText } from "./kb-ingest.js";
import { STRICT_DOC_RULES, readAppAgentConfig } from "./app-agent.js";
import { guardDocAnswer } from "./docguard.js";
import { ollamaChatStream } from "./ollama-http.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, d) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const optNames = new Set(["--budget", "--max", "--file", "--index", "--dok"]);
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
      const m = p.match(/^(hal|dok|teks|tidak|jawab|bukan|kosong)\s*=\s*(.+)$/i);
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

if (flag("--pages")) {
  const only = (opt("--dok", "") || "").toLowerCase();
  console.log("== Halaman berantakan (yang tetap rusak setelah OCR) ==");
  let n = 0;
  for (const d of index.listDocs()) {
    if (only && !d.title.toLowerCase().includes(only)) continue;
    for (const p of parsePageMarkers(index.getDocText(d.id))) {
      if (p.text.replace(/\s+/g, "").length < 25) continue;
      const a = assessPageText(p.text);
      if (!a.bad) continue;
      n += 1;
      console.log(`• [${d.title}] hlm ${p.page ?? "?"} — ${a.reason} (skor ${a.score})\n    ${p.text.replace(/\s+/g, " ").trim().slice(0, 200)}…`);
    }
  }
  console.log(n === 0 ? "(tidak ada)" : `\nTotal ${n} halaman. Untuk memperbaiki: hapus dokumennya di aplikasi lalu unggah ulang (agar OCR dicoba ulang), atau unggah PDF yang lebih bersih.`);
  console.log("");
}

if (flag("--docs") || (questions.length === 0 && !opt("--file") && !flag("--pages"))) {
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
let bad = 0;
const budgetChars = Number(opt("--budget", 5000));
const maxChunks = Number(opt("--max", 8));
const ask = flag("--ask");
const appCfg = readAppAgentConfig(process.env);
const ollamaBase = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const SYS = `Kamu adalah asisten pribadi. Jawab dengan Bahasa Indonesia, singkat dan jelas.\n\n${STRICT_DOC_RULES}`;
const lc = (x) => String(x || "").toLowerCase();
let asked = 0;
let askOk = 0;
for (const item of questions) {
  const blocks = index.search(item.q, { budgetChars, maxChunks, neighbors: !flag("--no-neighbors") });
  const total = blocks.reduce((n, b) => n + b.text.length, 0);
  console.log(`== ${item.q}\n   ${blocks.length} blok • ${total} karakter (≈ ${Math.round(total / 3.5)} token)`);
  blocks.forEach((b, i) => {
    console.log(`   ${i + 1}. [${b.title}] hlm ${b.page ?? "?"} • skor ${b.score.toFixed(2)}\n      ${b.text.replace(/\s+/g, " ").slice(0, 170)}…`);
  });
  if (blocks.length === 0) console.log("   (tidak ada potongan yang cocok)");
  const ctxAll = lc(blocks.map((b) => b.text).join("\n"));
  if (item.hal || item.dok || item.teks || item.tidak || item.kosong) {
    judged += 1;
    const found = blocks.some(
      (b) =>
        (!item.hal || b.text.includes(`[Halaman ${item.hal}]`)) &&
        (!item.dok || lc(b.title).includes(lc(item.dok))) &&
        (!item.teks || lc(b.text).includes(lc(item.teks)))
    );
    const forbidden = item.tidak && ctxAll.includes(lc(item.tidak));
    const ok = (item.hal || item.dok || item.teks ? found : true) && !forbidden && (!item.kosong || blocks.length === 0);
    if (ok) hits += 1;
    else bad += 1;
    console.log(
      `   ${ok ? "✅ HIT" : "❌ MISS"} (harapan: ${[item.dok && `dok~${item.dok}`, item.hal && `hlm ${item.hal}`, item.teks && `teks~"${item.teks}"`, item.tidak && `tanpa "${item.tidak}"${forbidden ? " ← MUNCUL" : ""}`, item.kosong && `0 blok${blocks.length ? ` ← ADA ${blocks.length}` : ""}`].filter(Boolean).join(", ")})`
    );
  }
  if (ask) {
    asked += 1;
    const titles = [...new Set(blocks.map((b) => b.title))];
    const context = blocks.length
      ? titles.map((t) => `=== Dokumen: "${t}" ===\n${blocks.filter((b) => b.title === t).map((b) => b.text).join("\n\n---\n\n")}`).join("\n\n")
      : "(Tidak ditemukan bagian dokumen yang cocok dengan pertanyaan ini.)";
    const t0 = Date.now();
    try {
      const r = await ollamaChatStream({
        baseUrl: ollamaBase,
        timeoutMs: 15 * 60_000,
        body: {
          model: ollamaModel,
          messages: [
            { role: "system", content: SYS },
            { role: "user", content: `${item.q}\n\n---\nKONTEKS DOKUMEN (potongan paling relevan; bukan seluruh dokumen):\n${context}` }
          ],
          options: { temperature: appCfg.docTemperature, num_ctx: appCfg.numCtx, num_predict: appCfg.maxOutputTokens },
          keep_alive: "10m"
        }
      });
      const guarded = guardDocAnswer(r.content.trim(), blocks);
      const answer = guarded.reply;
      console.log(`   🤖 ${ollamaModel} (${Math.round((Date.now() - t0) / 1000)} dtk):\n${answer.split("\n").map((l) => `      ${l}`).join("\n")}`);
      if (item.jawab || item.bukan) {
        const okYes = !item.jawab || lc(answer).includes(lc(item.jawab));
        const okNo = !item.bukan || !lc(answer).includes(lc(item.bukan));
        if (okYes && okNo) askOk += 1;
        else bad += 1;
        console.log(`   ${okYes && okNo ? "✅ JAWABAN BENAR" : "❌ JAWABAN SALAH"} (${[item.jawab && `harus memuat "${item.jawab}"${okYes ? "" : " ← TIDAK ADA"}`, item.bukan && `tak boleh memuat "${item.bukan}"${okNo ? "" : " ← MUNCUL"}`].filter(Boolean).join(", ")})`);
      }
    } catch (e) {
      bad += 1;
      console.log(`   ❌ Ollama gagal: ${e.message}`);
    }
  }
  console.log("");
}
if (judged > 0) console.log(`Pencarian — hit-rate: ${hits}/${judged} (${Math.round((100 * hits) / judged)}%)`);
if (asked > 0) console.log(`Jawaban model — benar: ${askOk}/${questions.filter((q) => q.jawab || q.bukan).length}`);
index.close();
process.exit(bad > 0 ? 1 : 0);
