// ================================================================
// PDF di chat (pribadi maupun grup) -> indeks SEMENTARA per berkas, jawaban dikutip per HALAMAN.
//
// Dulu: teks PDF dipotong di 60 halaman pertama lalu dipilih lewat kata kunci -- PMK 110 halaman hanya terbaca ±22%,
// halaman 61 ke atas hilang. Sekarang: SEMUA halaman (sampai WA_PDF_MAX_PAGES) dimasukkan ke indeks SQLite di memori
// (kb-index.js: BM25 + batang kata, potongan ber-halaman), lalu pertanyaan mengambil potongan yang cocok lengkap dengan
// "[Halaman n]". Pertanyaan umum ("ringkas") memakai cuplikan merata dari teks ber-penanda halaman.
//
// Privasi: indeks sementara ini hanya BM25 lokal -- isi PDF dari chat TIDAK dikirim ke Jina. Dibuang setelah TTL.
// ================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKbIndex } from "./kb-index.js";
import { run as defaultRun, PDF_MAX_BYTES } from "./pdf-extract.js";
import { buildPdfContext, sanitizePdfText } from "./pdf-qa.js";

export const PDF_CHAT_MAX_PAGES = 400;

/** Buffer PDF -> { pages: [{ page, text }], total, truncated, scanned }. Melempar Error ber-.kind seperti pdfBufferToMarkdown. */
export async function pdfBufferToPages(buf, { maxPages = 300, exec = defaultRun, tmpDir = os.tmpdir() } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw Object.assign(new Error("bukan PDF"), { kind: "badpdf" });
  if (buf.length > PDF_MAX_BYTES) throw Object.assign(new Error("PDF terlalu besar"), { kind: "toobig" });
  const dir = fs.mkdtempSync(path.join(tmpDir, "wa-pdfchat-"));
  const file = path.join(dir, "in.pdf");
  try {
    fs.writeFileSync(file, buf);
    let pageCount = 0;
    try {
      const info = await exec("pdfinfo", [file], { timeoutMs: 15_000 });
      pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]) || 0;
    } catch (e) {
      if (e?.code === "ENOENT") throw Object.assign(new Error("pdftotext belum terpasang"), { kind: "notool" });
    }
    let text;
    try {
      text = await exec("pdftotext", ["-layout", "-enc", "UTF-8", "-l", String(maxPages), file, "-"], { timeoutMs: 120_000 });
    } catch (e) {
      if (e?.code === "ENOENT") throw Object.assign(new Error("pdftotext belum terpasang"), { kind: "notool" });
      if (e?.killed || e?.signal === "SIGTERM") throw Object.assign(new Error("pdftotext kelamaan"), { kind: "timeout" });
      throw Object.assign(new Error(`pdftotext gagal: ${String(e?.stderr || e?.message || e).slice(0, 200)}`), { kind: "badpdf" });
    }
    const raw = text.split("\f");
    if (raw.length && raw[raw.length - 1].trim() === "") raw.pop();
    const pages = raw.map((t, i) => ({ page: i + 1, text: t }));
    const chars = pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
    const total = pageCount || pages.length;
    return { pages, total, truncated: total > maxPages, scanned: chars < Math.max(30, pages.length * 15) };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* abaikan */
    }
  }
}

const withMarkers = (pages) => pages.map((p) => `[Halaman ${p.page}]\n${String(p.text).replace(/[ \t]+$/gm, "").trim()}`).join("\n\n");

/** Pertanyaan umum (bukan mencari fakta tertentu): ringkas, isi, tentang apa. */
const OVERVIEW_RE = /\b(?:ringkas(?:kan)?|ringkasan|rangkum(?:kan)?|intisari|inti|simpul(?:kan)?|kesimpulan|tentang\s+apa|isi(?:nya)?|gambaran|overview|summar\w*|jelaskan\s+(?:pdf|dokumen|file|berkas|ini)|apa\s+(?:ini|itu))\b/i;
const PLACEHOLDER = /^\(menandai/;
/** Permintaan luas atas seluruh dokumen (membandingkan, matriks, rekap, perubahan): tidak bisa dicari lewat kata kunci, pakai cuplikan merata. */
const BROAD_RE = /\b(?:bandingkan|membandingkan|dibandingkan|banding|perbandingan|komparasi|matriks|matrix|rekap(?:itulasi)?|perubahan|berubah|perbedaan|beda|selisih|seluruh\s+isi|semua\s+isi|keseluruhan|secara\s+lengkap|poin[-\s]?poin\s+(?:utama|penting))\b/i;
export const isBroadRequest = (q) => BROAD_RE.test(String(q ?? ""));

const CLEAN_STOP = new Set(
  "yang dan di ke dari untuk dengan pada ini itu atau adalah akan bisa tolong bot dong ya yah nih sih aja saja dalam oleh sebagai juga ada apa siapa kapan berapa mana kenapa mengapa bagaimana gimana buatkan buat bikin bikinkan antara tentang pdf file berkas dokumen kmk pmk perpres permen peraturan keputusan menteri keuangan tahun nomor no nomer".split(" ")
);
/** Kueri dibersihkan dari kata sambung dan nomor peraturan/tahun supaya BM25 tidak tersesat oleh "KMK 296/2026". */
export function cleanQuery(q) {
  return String(q ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !CLEAN_STOP.has(w))
    .join(" ");
}

export function createPdfChatStore({ ttlMs = 30 * 60_000, max = 8, now = () => Date.now(), openIndex = openKbIndex } = {}) {
  const cache = new Map(); // key -> { at, entry }

  function evict() {
    const t = now();
    for (const [k, v] of cache) if (t - v.at > ttlMs) drop(k);
    while (cache.size > max) drop(cache.keys().next().value);
  }
  function drop(k) {
    const v = cache.get(k);
    cache.delete(k);
    try {
      v?.entry?.index?.close?.();
    } catch {
      /* abaikan */
    }
  }

  /** pages: [{page,text}] -> entry { name, total, readPages, truncated, index, fullText, chars }. */
  async function build(key, { name, pages, total, truncated }) {
    evict();
    const index = await openIndex({ file: ":memory:", log: { log() {}, error() {} } });
    index.upsertDoc({ id: "pdf", title: String(name || "dokumen.pdf").slice(0, 120), pages });
    const entry = { name, total: total || pages.length, readPages: pages.length, truncated: Boolean(truncated), index, fullText: sanitizePdfText(withMarkers(pages)), chars: pages.reduce((n, p) => n + p.text.length, 0) };
    if (key) {
      drop(key);
      cache.set(key, { at: now(), entry });
      evict();
    }
    return entry;
  }

  function get(key) {
    const v = key ? cache.get(key) : null;
    if (!v || now() - v.at > ttlMs) return null;
    v.at = now();
    return v.entry;
  }

  /**
   * Teks yang dikirim ke AI untuk satu pertanyaan.
   * -> { text, mode: "full"|"retrieved"|"sampled"|"none", totalChars, shownChars, coverage, pages: [nomor halaman yang disertakan] }
   * mode "none" = pertanyaan spesifik tetapi tidak ada bagian PDF yang cocok -> AI harus menjawab "tidak ditemukan di PDF".
   */
  function contextFor(entry, question, { maxChars = 36_000 } = {}) {
    const q = String(question ?? "").trim();
    const total = entry.fullText.length;
    const broad = isBroadRequest(q);
    if (total <= maxChars) return { text: entry.fullText, mode: "full", totalChars: total, shownChars: total, coverage: 1, pages: [], broad };
    const overview = !q || PLACEHOLDER.test(q) || OVERVIEW_RE.test(q) || broad;
    if (!overview) {
      const search = (k) => entry.index.search(k, { budgetChars: maxChars, maxChunks: 12, excludeLocal: false });
      let blocks = search(q);
      if (blocks.length === 0) {
        const cleaned = cleanQuery(q);
        if (cleaned && cleaned !== q.toLowerCase()) blocks = search(cleaned);
      }
      if (blocks.length > 0) {
        const text = blocks.map((b) => b.text).join("\n\n[… bagian lain dilewati …]\n\n");
        const pages = [...new Set([...text.matchAll(/\[Halaman (\d+)\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
        return { text, mode: "retrieved", totalChars: total, shownChars: text.length, coverage: Math.min(1, text.length / total), pages };
      }
      return { text: "(tidak ada bagian PDF yang cocok dengan pertanyaan ini)", mode: "none", totalChars: total, shownChars: 0, coverage: 0, pages: [] };
    }
    // kueri dikosongkan: buildPdfContext tidak boleh memilih "relevan" dari kata kunci permintaan luas
    const c = buildPdfContext(entry.fullText, broad ? "" : q, { maxChars });
    const pages = [...new Set([...c.text.matchAll(/\[Halaman (\d+)\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    return { ...c, mode: "sampled", pages, broad };
  }

  /** PDF lain di obrolan yang sama ("<jid>|<id pesan>") yang masih tersimpan, terbaru dulu; tanpa memperpanjang TTL. */
  function siblings(key) {
    const k = String(key ?? "");
    const i = k.lastIndexOf("|");
    if (i < 0) return [];
    const prefix = k.slice(0, i + 1);
    const t = now();
    return [...cache]
      .filter(([ck, v]) => ck !== k && ck.startsWith(prefix) && t - v.at <= ttlMs)
      .sort((a, b) => b[1].at - a[1].at)
      .map(([, v]) => v.entry);
  }

  return { build, get, contextFor, siblings, size: () => cache.size, clear: () => [...cache.keys()].forEach(drop) };
}
