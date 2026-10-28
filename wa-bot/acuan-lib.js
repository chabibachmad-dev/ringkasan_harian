// ================================================================
// Perpustakaan ACUAN PUBLIK: peraturan yang memang terbuka untuk umum (mis. PMK 32/2025 tentang SBM TA 2026)
// dimasukkan SELURUH halamannya ke indeks, lengkap dengan "[Halaman n]" untuk kutipan.
//
//   <DOC_DIR>/acuan-publik/*.pdf   (atau .md/.txt ber-penanda "[Halaman n]"; boleh subfolder)
//
// Bedanya dengan folder peraturan-pdf (dokumen/lokal):
//   - id = "acuan:<nama-berkas>"  -> BUKAN "local:", jadi boleh dicari oleh jalur cloud (Gemini/Groq/OpenRouter)
//     dan boleh di-embed/di-rerank Jina (pencarian hibrida).
//   - Taruh di sini HANYA dokumen publik. Dokumen internal (mis. Komitmen Bersama PPK) tempatnya peraturan-pdf/ (lokal).
//   - Nama berkas dipakai sebagai judul kutipan -> beri nama yang jelas, mis. "PMK 32 Tahun 2025 SBM TA 2026.pdf".
// Bot hanya MEMBACA folder ini; tidak mengubah/menghapus berkas. Tidak ada yang naik ke Supabase.
// ================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pdfBufferToPages } from "./pdf-chat.js";
import { listFiles } from "./doc-folder.js";
import { parsePageMarkers } from "./kb-index.js";

const flag = (v, d) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? !["false", "0", "off", "no", "tidak", "mati"].includes(s) : d;
};
const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? "").trim() !== "" && Number(v) > 0 ? Number(v) : d);

export function readAcuanConfig(env = process.env, baseDir = process.cwd()) {
  const root = env.DOC_DIR ? path.resolve(env.DOC_DIR) : path.resolve(baseDir, "..", "dokumen");
  return {
    enabled: flag(env.ACUAN_ENABLED, true),
    dir: env.ACUAN_DIR ? path.resolve(env.ACUAN_DIR) : path.join(root, "acuan-publik"),
    pollMs: num(env.ACUAN_POLL_MS, 60_000),
    settleMs: num(env.ACUAN_SETTLE_MS, 4000),
    maxPages: Math.min(2000, num(env.ACUAN_MAX_PAGES, 1000))
  };
}

export const acuanId = (rel) => `acuan:${rel}`;
const titleOf = (rel) => path.posix.basename(rel).replace(/\.(pdf|md|txt)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function createAcuanLibrary(deps, overrides = {}) {
  const { index, log = console, onIndexed = null, now = () => Date.now(), toPages = pdfBufferToPages } = deps;
  const cfg = { ...readAcuanConfig(deps.env || process.env, deps.baseDir || process.cwd()), ...overrides };
  const seen = new Map(); // id -> { size, mtimeMs, hash }
  const pendingSince = new Map(); // rel -> { size, mtimeMs, since }
  const stats = { docs: 0, lastError: null, lastScanAt: null };
  let timer = null;
  let scanning = false;

  const files = () => [...listFiles(cfg.dir, ".pdf"), ...listFiles(cfg.dir, ".md"), ...listFiles(cfg.dir, ".txt")].sort();

  async function indexOne(rel, buf) {
    const id = acuanId(rel);
    const title = titleOf(rel);
    let pages;
    let note = "";
    if (/\.pdf$/i.test(rel)) {
      const r = await toPages(buf, { maxPages: cfg.maxPages });
      if (r.scanned) throw new Error("PDF hasil scan (tidak ada teks). Konversi/OCR dulu lewat menu \"PDF → MD\", lalu taruh .md-nya di sini.");
      pages = r.pages;
      if (r.truncated) note = ` (hanya ${r.pages.length} dari ${r.total} halaman — naikkan ACUAN_MAX_PAGES)`;
    } else {
      pages = parsePageMarkers(buf.toString("utf8"));
    }
    pages = pages.filter((p) => String(p.text || "").trim());
    if (pages.length === 0) throw new Error("tidak ada teks");
    const res = index.upsertDoc({ id, title, filename: rel, pages });
    log.log?.(`📚 Acuan publik: ${rel} → ${res.pages ?? pages.length} hlm, ${res.chunks} potongan${note}.`);
    return res;
  }

  /** Satu putaran: indeks berkas baru/berubah, buang dokumen acuan yang berkasnya hilang. */
  async function scan() {
    if (scanning || !cfg.enabled) return { added: 0, removed: 0 };
    scanning = true;
    let added = 0;
    let removed = 0;
    try {
      const present = new Set();
      const inIndex = new Set(index.listDocs().map((d) => d.id));
      for (const rel of files()) {
        const id = acuanId(rel);
        present.add(id);
        let st;
        try {
          st = fs.statSync(path.join(cfg.dir, rel));
        } catch {
          continue;
        }
        const prev = seen.get(id);
        if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs && (inIndex.has(id) || prev.hash === "gagal")) continue;
        // tunggu sampai berkas selesai disalin (ukuran/mtime stabil selama settleMs)
        const p = pendingSince.get(rel);
        if (!p || p.size !== st.size || p.mtimeMs !== st.mtimeMs) {
          pendingSince.set(rel, { size: st.size, mtimeMs: st.mtimeMs, since: now() });
          if (cfg.settleMs > 0) continue;
        } else if (now() - p.since < cfg.settleMs) continue;
        try {
          const buf = fs.readFileSync(path.join(cfg.dir, rel));
          const h = sha(buf);
          if (prev && prev.hash === h && inIndex.has(id)) {
            seen.set(id, { size: st.size, mtimeMs: st.mtimeMs, hash: h });
          } else {
            await indexOne(rel, buf);
            seen.set(id, { size: st.size, mtimeMs: st.mtimeMs, hash: h });
            added += 1;
          }
          pendingSince.delete(rel);
          stats.lastError = null;
        } catch (e) {
          stats.lastError = `${rel}: ${e?.message || e}`;
          log.error?.(`📚 Acuan publik: gagal membaca ${rel}: ${e?.message || e}`);
          seen.set(id, { size: st.size, mtimeMs: st.mtimeMs, hash: "gagal" }); // jangan diulang tiap putaran sampai berkasnya berubah
          pendingSince.delete(rel);
        }
      }
      for (const id of inIndex) {
        if (id.startsWith("acuan:") && !present.has(id)) {
          index.removeDoc(id);
          seen.delete(id);
          removed += 1;
        }
      }
      stats.docs = index.listDocs().filter((d) => d.id.startsWith("acuan:")).length;
      stats.lastScanAt = now();
      if (added || removed) {
        log.log?.(`📚 Acuan publik: indeks disamakan (+${added} / -${removed}).`);
        try {
          onIndexed?.({ added, removed });
        } catch {
          /* abaikan */
        }
      }
    } finally {
      scanning = false;
    }
    return { added, removed };
  }

  async function start() {
    if (!cfg.enabled) return;
    try {
      fs.mkdirSync(cfg.dir, { recursive: true });
    } catch {
      /* folder mungkin read-only: tidak apa-apa */
    }
    await scan().catch((e) => log.error?.(`📚 Acuan publik: ${e?.message || e}`));
    timer = setInterval(() => scan().catch((e) => log.error?.(`📚 Acuan publik: ${e?.message || e}`)), cfg.pollMs);
    timer.unref?.();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  const status = () => ({ enabled: cfg.enabled, dir: cfg.dir, ...stats });
  return { start, stop, scan, status, cfg };
}

export const defaultAcuanBaseDir = () => fileURLToPath(new URL(".", import.meta.url));
