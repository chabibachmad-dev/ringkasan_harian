// ================================================================
// PDF (berkas yang dibagikan di grup) -> markdown ber-TABEL, untuk dijadikan Excel/Word.
//
// Tanpa AI dan tanpa pustaka: teks diambil dengan `pdftotext -layout` (alat yang sama dengan Dokumen Pengetahuan),
// lalu tabel dikenali dari KOLOM yang rata (spasi lebar) di beberapa baris berurutan.
//
//   layoutPagesToMarkdown(pages)          pure, bisa dites: halaman[] (teks -layout) -> { markdown, tables, chars }
//   pdfBufferToMarkdown(buf, opts)        jalankan pdftotext lalu layoutPagesToMarkdown
//
// Batas jujur: PDF hasil scan (gambar) tidak punya teks -> { scanned: true }. Tabel tanpa garis/kolom rapat bisa meleset;
// hasilnya selalu perlu dicek manusia.
// ================================================================
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanPages } from "./pdf-md.js";

export const PDF_MAX_BYTES = 15 * 1024 * 1024;
export const PDF_MAX_PAGES = 60;

const RULE_RE = /^[\s=\-+_|─│┼═╪╫·.]+$/;
const cellsOf = (line) => line.trim().split(/\s{2,}/).filter((c) => c !== "");
const isTabLine = (line) => line.trim() !== "" && !RULE_RE.test(line) && cellsOf(line).length >= 2;
const isRule = (line) => line.trim() !== "" && RULE_RE.test(line) && line.trim().length >= 3;
const startOffsets = (line) => {
  const out = new Set();
  const re = /\S+/g;
  let m;
  let prevEnd = -10;
  while ((m = re.exec(line))) {
    if (m.index - prevEnd >= 2) out.add(m.index);
    prevEnd = m.index + m[0].length;
  }
  return out;
};

/** Baris-baris satu blok tabel -> { headers, rows } atau null (bukan tabel yang meyakinkan). */
export function sliceTable(rawLines) {
  let lines = rawLines.filter((l) => l.trim() !== "" && !isRule(l)).map((l) => l.replace(/\t/g, "    ").replace(/\s+$/, ""));
  if (lines.length < 3) return null;
  // tabel "gambar" dengan "|": pemisah kolom = |
  if (lines.filter((l) => l.includes("|")).length >= lines.length * 0.7) lines = lines.map((l) => l.replace(/\|/g, " "));
  const width = Math.max(...lines.map((l) => l.length));
  const padded = lines.map((l) => l.padEnd(width, " "));
  // Judul kolom sering rata-kiri sementara angka rata-kanan (tidak sejajar): kolom ditentukan dari BARIS ISI, judul dipasangkan sesudahnya.
  const basis = padded.length >= 4 ? padded.slice(1) : padded;
  const occ = new Array(width).fill(0);
  for (const l of basis) for (let x = 0; x < width; x++) if (l[x] !== " ") occ[x]++;
  const tol = basis.length >= 12 ? Math.floor(basis.length * 0.08) : 0;
  // pemisah kolom: rentang x dengan kepadatan <= tol selebar >= 2
  const seps = [];
  let x = 0;
  while (x < width) {
    if (occ[x] <= tol) {
      let y = x;
      while (y < width && occ[y] <= tol) y++;
      if (y - x >= 2 && x > 0 && y < width) seps.push([x, y]);
      x = y;
    } else x++;
  }
  if (!seps.length) return null;
  const bounds = [0, ...seps.flatMap(([a, b]) => [a, b]), width];
  const spans = [];
  for (let i = 0; i < bounds.length; i += 2) spans.push([bounds[i], bounds[i + 1]]);
  const sliceRow = (l) => spans.map(([a, b]) => l.slice(a, b).trim());
  let rows = padded.map(sliceRow);
  if (padded.length >= 4) {
    // judul kolom: tiap sel judul masuk ke kolom yang paling tumpang-tindih dengannya
    const head = new Array(spans.length).fill("");
    for (const m of padded[0].matchAll(/\S+(?:[ ]\S+)*/g)) {
      const a = m.index;
      const b = m.index + m[0].length;
      let best = 0;
      let bestOv = -1;
      spans.forEach(([x, y], i) => {
        const ov = Math.min(b, y) - Math.max(a, x);
        if (ov > bestOv) {
          bestOv = ov;
          best = i;
        }
      });
      head[best] = head[best] ? `${head[best]} ${m[0]}` : m[0];
    }
    rows[0] = head;
  }
  // buang kolom yang kosong semua
  const keep = spans.map((_s, c) => rows.some((r) => r[c] !== ""));
  rows = rows.map((r) => r.filter((_c, i) => keep[i]));
  const cols = rows[0].length;
  if (cols < 2) return null;
  // baris lanjutan (isi bungkus di satu kolom): gabung ke baris di atasnya
  const merged = [];
  const maxFilled = Math.max(1, Math.floor(cols / 3));
  for (const r of rows) {
    const filled = r.filter((c) => c !== "").length;
    if (merged.length > 1 && r[0] === "" && filled <= maxFilled && filled > 0) {
      const prev = merged[merged.length - 1];
      r.forEach((c, i) => {
        if (c) prev[i] = prev[i] ? `${prev[i]} ${c}` : c;
      });
    } else merged.push(r.slice());
  }
  if (merged.length < 2) return null;
  // tabel sungguhan: mayoritas baris punya >= 2 sel terisi
  const solid = merged.filter((r) => r.filter((c) => c !== "").length >= 2).length;
  if (solid < merged.length * 0.6) return null;
  return { headers: merged[0], rows: merged.slice(1) };
}


/** Buang baris pembuka/penutup yang bukan bagian tabel (mis. kalimat berspasi lebar di atas tabel): jumlah selnya jauh dari yang lazim. */
function trimRun(run) {
  const counts = run.filter(isTabLine).map((l) => cellsOf(l).length);
  if (counts.length < 3) return run;
  const freq = new Map();
  for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
  const mode = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const fits = (l) => (isTabLine(l) ? Math.abs(cellsOf(l).length - mode) <= 1 : false);
  let a = 0;
  let b = run.length;
  while (a < b && !fits(run[a])) a++;
  while (b > a && !fits(run[b - 1])) b--;
  return run.slice(a, b);
}

const sameHeaders = (a, b) => a.length === b.length && a.every((x, i) => x.trim().toLowerCase() === b[i].trim().toLowerCase());
const PAGE_FOOTER = /(?:^|\s)(?:halaman|hal\.?|page)\s*\d+(?:\s*(?:dari|of|\/)\s*\d+)?\s*$/i;
const mdCell = (c) => String(c ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const tableMd = (t) => [`| ${t.headers.map(mdCell).join(" | ")} |`, `|${t.headers.map(() => "---").join("|")}|`, ...t.rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n");

const LIST_START = /^(?:[-•*▪●○]\s+|\d{1,3}[.)]\s+|[a-zA-Z][.)]\s+|\(\d{1,3}\)\s+)/;
const TERMINAL = /[.;:!?)"”']$/;
const isShout = (t) => t.length >= 4 && t.length <= 80 && /\p{L}{3}/u.test(t) && t === t.toUpperCase() && !/[.:;,]$/.test(t);

/** Baris non-tabel -> paragraf (baris yang dibungkus layar digabung kembali). */
function proseToMarkdown(lines) {
  const out = [];
  let cur = "";
  const flush = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  const longest = Math.max(1, ...lines.map((l) => l.trim().length));
  for (const raw of lines) {
    const t = raw.trim().replace(/\s{2,}/g, " ");
    if (!t) {
      flush();
      out.push("");
      continue;
    }
    if (isShout(t)) {
      flush();
      out.push(`## ${t}`, "");
      continue;
    }
    if (LIST_START.test(t)) {
      flush();
      cur = /^\d{1,3}[.)]\s/.test(t) ? t : /^[-•*▪●○]\s/.test(t) ? `- ${t.replace(LIST_START, "")}` : t;
      continue;
    }
    if (!cur) {
      cur = t;
      continue;
    }
    const prevShort = cur.length < longest * 0.5 && TERMINAL.test(cur);
    if (prevShort) {
      flush();
      cur = t;
    } else if (/[a-z]-$/.test(cur) && /^[a-z]/.test(t)) cur = cur.slice(0, -1) + t;
    else cur = `${cur} ${t}`;
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Halaman[] (string hasil `pdftotext -layout`) -> markdown. */
export function layoutPagesToMarkdown(pages) {
  const cleaned = cleanPages(pages.map((p, i) => ({ page: i + 1, text: typeof p === "string" ? p : p.text })));
  const all = [];
  let tables = 0;
  let chars = 0;
  for (const rawLines of cleaned) {
    const lines = rawLines.filter((l) => !PAGE_FOOTER.test(l.trim()) || l.trim().length >= 60);
    chars += lines.join("").replace(/\s/g, "").length;
    const blocks = [];
    let prose = [];
    const flushProse = () => {
      if (prose.some((l) => l.trim())) blocks.push(proseToMarkdown(prose));
      prose = [];
    };
    for (let i = 0; i < lines.length; ) {
      if (isTabLine(lines[i]) || (isRule(lines[i]) && i + 1 < lines.length && isTabLine(lines[i + 1]))) {
        // kumpulkan blok: baris bertab, garis pemisah, baris lanjutan (mulai di tepi kolom), maksimal 1 baris kosong di antaranya
        const run = [];
        const starts = new Set();
        let j = i;
        let tabCount = 0;
        let blanks = 0;
        while (j < lines.length) {
          const l = lines[j];
          if (l.trim() === "") {
            if (blanks >= 1 || !(j + 1 < lines.length && isTabLine(lines[j + 1]))) break;
            blanks++;
            j++;
            continue;
          }
          blanks = 0;
          if (isTabLine(l)) {
            run.push(l);
            tabCount++;
            startOffsets(l).forEach((o) => starts.add(o));
          } else if (isRule(l)) run.push(l);
          else if (tabCount >= 1 && l.trim().length < 70 && starts.has(l.length - l.trimStart().length)) run.push(l);
          else break;
          j++;
        }
        const table = tabCount >= 3 ? sliceTable(trimRun(run)) : null;
        if (table) {
          flushProse();
          blocks.push({ table });
          tables++;
          i = j;
          continue;
        }
        // bukan tabel: perlakukan sebagai teks biasa
        prose.push(lines[i]);
        i++;
        continue;
      }
      prose.push(lines[i]);
      i++;
    }
    flushProse();
    // tabel yang berlanjut ke halaman berikutnya dengan judul kolom diulang: satukan
    let k = all.length - 1;
    while (k >= 0 && !all[k].table && typeof all[k] === "string" && all[k].length <= 90 && !all[k].includes("\n")) k--;
    const prev = k >= 0 ? all[k] : null;
    if (blocks[0]?.table && prev?.table && sameHeaders(prev.table.headers, blocks[0].table.headers)) {
      prev.table.rows.push(...blocks[0].table.rows);
      blocks.shift();
      tables--;
    }
    all.push(...blocks);
  }
  const parts = all.map((b) => (b.table ? tableMd(b.table) : b)).filter((x) => String(x).trim());
  return { markdown: parts.join("\n\n").trim(), tables, chars };
}

function run(cmd, args, { timeoutMs = 40_000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else resolve(stdout);
    });
  });
}

/**
 * Buffer PDF -> { markdown, tables, pages, chars, scanned, truncated }.
 * Melempar Error dengan .kind: "notool" (pdftotext tidak ada) | "toobig" | "badpdf" | "timeout".
 */
export async function pdfBufferToMarkdown(buf, { maxPages = PDF_MAX_PAGES, exec = run, tmpDir = os.tmpdir() } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw Object.assign(new Error("bukan PDF"), { kind: "badpdf" });
  if (buf.length > PDF_MAX_BYTES) throw Object.assign(new Error("PDF terlalu besar"), { kind: "toobig" });
  const dir = fs.mkdtempSync(path.join(tmpDir, "wa-pdf-"));
  const file = path.join(dir, "in.pdf");
  try {
    fs.writeFileSync(file, buf);
    let pageCount = 0;
    try {
      const info = await exec("pdfinfo", [file], { timeoutMs: 15_000 });
      pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]) || 0;
    } catch (e) {
      if (e?.code === "ENOENT") throw Object.assign(new Error("pdftotext belum terpasang"), { kind: "notool" });
      // pdfinfo gagal tapi pdftotext mungkin tetap bisa: lanjut
    }
    let text;
    try {
      text = await exec("pdftotext", ["-layout", "-enc", "UTF-8", "-l", String(maxPages), file, "-"]);
    } catch (e) {
      if (e?.code === "ENOENT") throw Object.assign(new Error("pdftotext belum terpasang"), { kind: "notool" });
      if (e?.killed || e?.signal === "SIGTERM") throw Object.assign(new Error("pdftotext kelamaan"), { kind: "timeout" });
      throw Object.assign(new Error(`pdftotext gagal: ${String(e?.stderr || e?.message || e).slice(0, 200)}`), { kind: "badpdf" });
    }
    const pages = text.split("\f");
    if (pages.length && pages[pages.length - 1].trim() === "") pages.pop();
    const { markdown, tables, chars } = layoutPagesToMarkdown(pages);
    const total = pageCount || pages.length;
    return { markdown, tables, pages: total, chars, scanned: chars < Math.max(30, pages.length * 15), truncated: total > maxPages };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* abaikan */
    }
  }
}
