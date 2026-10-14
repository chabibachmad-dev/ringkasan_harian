// ================================================================
// Peraturan PDF -> Markdown TERSTRUKTUR (tanpa jaringan, tanpa AI; murni aturan teks sehingga mudah dites).
//
// Masukan: halaman hasil `convertFile` (kb-ingest.js): [{ page, text, ocr }], teks dari `pdftotext -layout` atau OCR.
// Keluaran: Markdown dengan
//   - kepala YAML (judul, jenis, nomor, tahun, tentang, sumber, jumlah halaman, tanggal konversi, catatan mutu),
//   - BAB -> ##, Bagian -> ###, Paragraf -> ####, Pasal -> satu tingkat di bawah yang sedang terbuka,
//   - ayat (1), huruf a., angka 1. -> daftar bertingkat (nomor aslinya DIPERTAHANKAN, tidak dinomori ulang),
//   - tabel berkolom -> tabel Markdown (atau blok teks bila terlalu tak beraturan),
//   - header/footer yang berulang di tiap halaman & nomor halaman dibuang, baris yang terpotong digabung,
//   - penanda halaman `<!-- hlm N -->` supaya kutipan bisa menyebut halaman PDF asli.
//
// Prinsip: tidak pernah mengubah ISI kalimat (tidak meringkas, tidak menebak); hanya menata. Bagian yang tak dikenali
// tetap jadi paragraf biasa, jadi kegagalan deteksi struktur tidak pernah menghilangkan teks.
// ================================================================
import { despaceLetters, cleanBoilerplate } from "./text-clean.js";

const TERMINAL = /[.;:!?)"”']$/;
const ACRONYMS = new Set(["RI", "APBN", "APBD", "BUMN", "BUMD", "PNBP", "SPPD", "PPN", "NPWP", "UMKM", "KUR", "TNI", "POLRI", "ASN", "PNS", "PPPK", "LPH", "BPJPH", "SNI", "OJK", "BPK", "DPR", "DPD", "MPR", "BI", "PPh", "KPPN", "KPKNL", "SKPD", "OPD", "BLU", "BLUD", "SAKTI", "SPM", "SP2D", "DIPA", "RKA", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII"]);
const SMALL = new Set(["dan", "atau", "yang", "di", "ke", "dari", "untuk", "pada", "dengan", "tentang", "dalam", "oleh", "bagi", "serta", "atas", "sebagai", "terhadap", "kepada", "antara"]);

export function slugify(name) {
  return (
    String(name || "")
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 120) || "dokumen"
  );
}

function titleCase(s) {
  const letters = String(s).replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (letters.length === 0 || upper / letters.length < 0.7) return String(s).trim(); // sudah campuran: biarkan
  return String(s)
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z0-9]/g, "");
      if (ACRONYMS.has(bare) || ACRONYMS.has(bare.toUpperCase())) return w;
      const lower = w.toLowerCase();
      if (i > 0 && SMALL.has(bare.toLowerCase())) return lower;
      return lower.replace(/(^|-)([^a-z0-9]*)([a-z])/g, (_m, h, a, b) => h + a + b.toUpperCase());
    })
    .join(" ");
}

const yamlStr = (v) => `"${String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim()}"`;

// ---------------------------------------------------------------- 1. pembersihan halaman
const PAGE_NO = /^[-–—\s]*(?:halaman\s+)?\d{1,4}(?:\s*(?:dari|of|\/)\s*\d{1,4})?[-–—\s]*$/i;
const URL_LINE = /^(?:www\.|https?:\/\/)\S+$/i;
const norm = (s) => s.trim().toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ");

/** Buang nomor halaman, URL penanda air, dan header/footer yang berulang di banyak halaman. Mengembalikan baris per halaman. */
export function cleanPages(pages) {
  const pageLines = pages.map((p) => cleanBoilerplate(despaceLetters(String(p.text || ""))).replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, "")));
  const edge = (lines) => {
    const idx = [];
    lines.forEach((l, i) => l.trim() && idx.push(i));
    return [...idx.slice(0, 3), ...idx.slice(-3)];
  };
  const counts = new Map();
  if (pages.length >= 4) {
    for (const lines of pageLines) {
      const seen = new Set();
      for (const i of edge(lines)) {
        const k = norm(lines[i]);
        // Kalimat isi ("Cukup jelas.") dan judul struktur (Pasal/BAB/butir) tidak pernah dianggap header berulang.
        if (k.length >= 3 && k.length <= 90 && !/[.;:,]$/.test(k) && !isStructural(lines[i].trim()) && !isMarker(lines[i].trim()) && !seen.has(k)) {
          seen.add(k);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      }
    }
  }
  const need = Math.max(3, Math.ceil(pages.length * 0.4));
  const repeated = new Set([...counts].filter(([, c]) => c >= need).map(([k]) => k));
  return pageLines.map((lines) => {
    const drop = new Set();
    for (const i of edge(lines)) {
      const t = lines[i].trim();
      if (PAGE_NO.test(t) || URL_LINE.test(t) || repeated.has(norm(t))) drop.add(i);
    }
    return lines.filter((_l, i) => !drop.has(i));
  });
}

// ---------------------------------------------------------------- 2. metadata
export function extractMeta(firstLines, filename = "") {
  const flat = firstLines.join(" ").replace(/\s+/g, " ");
  const m = /NOMOR\s+([A-Za-z0-9./-]+)\s+TAHUN\s+(\d{4})/i.exec(flat);
  let jenis = "";
  if (m) {
    const prefix = flat.slice(0, m.index);
    const j = /(UNDANG-UNDANG|PERATURAN|KEPUTUSAN|SURAT\s+EDARAN|INSTRUKSI)/i.exec(prefix);
    if (j) jenis = titleCase(prefix.slice(j.index).replace(/REPUBLIK\s+INDONESIA/gi, "").replace(/\s+/g, " ").trim()).slice(0, 120);
  }
  let tentang = "";
  const ti = firstLines.findIndex((l) => /^TENTANG\b/i.test(l.trim()));
  if (ti >= 0) {
    const parts = [firstLines[ti].trim().replace(/^TENTANG\s*:?\s*/i, "")];
    for (let i = ti + 1; i < firstLines.length && parts.join(" ").length < 300; i++) {
      const t = firstLines[i].trim();
      if (!t) {
        if (parts.join("").trim()) break;
        continue;
      }
      parts.push(t);
    }
    tentang = titleCase(parts.join(" ").replace(/\s+/g, " ").trim()).slice(0, 300);
  }
  const nomor = m ? m[1] : "";
  const tahun = m ? Number(m[2]) : null;
  const judul = jenis && nomor && tahun ? `${jenis} Nomor ${nomor} Tahun ${tahun}${tentang ? ` tentang ${tentang}` : ""}` : tentang || String(filename).replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_-]+/g, " ").trim() || "Dokumen";
  return { judul, jenis, nomor, tahun, tentang };
}

// ---------------------------------------------------------------- 3. tabel
const GAP = /\s{3,}/;
const BARE_MARKER = /^(\(\d{1,3}[a-z]?\)|[a-z][.)]|\d{1,3}[.)])$/;

function cellsOf(text) {
  return text.trim().split(GAP).map((c) => c.trim()).filter((c) => c !== "");
}
function isRowLike(text) {
  if (!GAP.test(text.trim())) return false;
  const cells = cellsOf(text);
  if (cells.length < 2) return false;
  if (cells.length === 2 && BARE_MARKER.test(cells[0])) return false; // "a.     isi ayat" bukan tabel
  return true;
}
const mode = (arr) => {
  const c = new Map();
  for (const x of arr) c.set(x, (c.get(x) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
};

/** Ubah blok baris berkolom jadi tabel Markdown. null bila terlalu tak beraturan. */
function renderTable(rows) {
  const counts = rows.map((r) => cellsOf(r).length);
  const [cols, n] = mode(counts);
  if (cols < 2) return null;
  const consistent = n / rows.length;
  const esc = (s) => s.replace(/\|/g, "\\|");
  if (consistent >= 0.7) {
    const lines = rows.map((r) => {
      const cells = cellsOf(r).map(esc);
      while (cells.length < cols) cells.push("");
      if (cells.length > cols) cells.splice(cols - 1, cells.length - cols + 1, cells.slice(cols - 1).join(" "));
      return `| ${cells.join(" | ")} |`;
    });
    lines.splice(1, 0, `| ${Array(cols).fill("---").join(" | ")} |`);
    return { md: lines.join("\n"), kind: "table" };
  }
  if (rows.length >= 4) return { md: ["```text", ...rows.map((r) => r.trimEnd()), "```"].join("\n"), kind: "text" };
  return null;
}

// ---------------------------------------------------------------- 4. penanda daftar
const RE = {
  bab: /^BAB\s+([IVXLCDM]+|\d+)\b\s*(.*)$/,
  bagian: /^Bagian\s+(Ke[a-z]+(?:\s?[a-z]+)?|Pertama|\d+)\b\s*(.*)$/i,
  paragraf: /^Paragraf\s+(\d+)\b\s*(.*)$/i,
  pasal: /^Pasal\s+(\d+[A-Z]?)\s*$/,
  penjelasan: /^PENJELASAN\b/,
  umum: /^(I\.\s+UMUM|II\.\s+PASAL\s+DEMI\s+PASAL)\s*$/,
  lampiran: /^LAMPIRAN\b/,
  front: /^(Menimbang|Mengingat|Memperhatikan|Menetapkan)\s*:\s*(.*)$/i,
  memutuskan: /^MEMUTUSKAN\s*:?\s*$/,
  ayat: /^\((\d{1,3}[a-z]?)\)\s*(.*)$/,
  huruf: /^([a-z])([.)])\s+(\S.*)$/,
  angka: /^(\d{1,3})([.)])\s+(\S.*)$/
};

const isStructural = (t) => RE.bab.test(t) || RE.bagian.test(t) || RE.paragraf.test(t) || RE.pasal.test(t) || RE.penjelasan.test(t) || RE.umum.test(t) || RE.front.test(t) || RE.memutuskan.test(t);
const isMarker = (t) => RE.ayat.test(t) || RE.huruf.test(t) || RE.angka.test(t);
const upperRatio = (s) => {
  const l = s.replace(/[^A-Za-z]/g, "");
  return l ? l.replace(/[^A-Z]/g, "").length / l.length : 0;
};

// ---------------------------------------------------------------- 5. pembangun utama
/**
 * @param {Array<{page:number|null,text:string,ocr?:boolean}>} pages
 * @param {{filename?:string, now?:Date, badPages?:number[], ocrPages?:number}} opts
 * @returns {{markdown:string, meta:object, stats:object, title:string}}
 */
export function buildRegulationMarkdown(pages, { filename = "", now = new Date(), badPages = [], ocrPages = 0 } = {}) {
  const cleaned = cleanPages(pages);
  const firstLines = cleaned.slice(0, 2).flat();
  const meta = extractMeta(firstLines, filename);

  // Datar semua baris dengan penanda halaman.
  const toks = [];
  cleaned.forEach((lines, i) => {
    const n = pages[i].page ?? i + 1;
    toks.push({ page: n });
    for (const raw of lines) toks.push({ raw, text: raw.trim(), blank: raw.trim() === "" });
  });

  const out = [];
  const stats = { bab: 0, bagian: 0, pasal: 0, ayat: 0, tabel: 0, halaman: pages.length };
  let curPage = null; // halaman tempat baris yang sedang dibaca berada
  let lastMarked = null; // halaman terakhir yang sudah diberi penanda
  let cur = null; // blok terbuka { kind:'para'|'item', depth, prefix, text }
  let stack = [];
  let lastKind = null; // 'item' | 'other'
  let level = 0; // tingkat judul struktural terdalam yang terbuka (2 BAB, 3 Bagian, 4 Paragraf)
  let inPenj = false;
  let seenBody = false;
  let prevBlank = true;
  let pageStart = false;

  const emit = (line, kind, page = curPage) => {
    // Penanda halaman dipasang di blok pertama yang MULAI di halaman itu (kalimat yang menyambung antarhalaman tetap utuh).
    if (page != null && page !== lastMarked) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`<!-- hlm ${page} -->`, "");
      lastMarked = page;
      lastKind = "other";
    }
    if (kind === "item") {
      if (lastKind !== "item" && out.length && out[out.length - 1] !== "") out.push("");
      out.push(line);
    } else {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(line, "");
    }
    lastKind = kind;
  };
  const flush = () => {
    if (!cur) return;
    const text = cur.text.replace(/\s+/g, " ").trim();
    if (cur.kind === "item") emit(`${"  ".repeat(cur.depth)}- ${cur.prefix ? `${cur.prefix} ` : ""}${text}`.trimEnd(), "item", cur.page);
    else if (text) emit(text, "other", cur.page);
    cur = null;
  };
  const heading = (lvl, text) => {
    flush();
    stack = [];
    emit(`${"#".repeat(Math.min(lvl, 6))} ${text.replace(/\s+/g, " ").trim()}`, "other");
  };
  const place = (type, value) => {
    if (type === "ayat") {
      stack = ["ayat"];
      return 0;
    }
    const i = stack.lastIndexOf(type);
    const restart = value === "a" || value === "1";
    if (i === -1 || (restart && i < stack.length - 1)) {
      stack.push(type);
      return stack.length - 1;
    }
    stack.length = i + 1;
    return i;
  };
  const joinText = (base, add) => (/-$/.test(base) && /^[a-z]/.test(add) ? base + add : `${base} ${add}`);
  /** Teks judul pada baris-baris berikut (BAB: huruf kapital; Bagian/Paragraf: baris pendek tanpa titik). */
  const takeTitle = (i, upperOnly) => {
    const parts = [];
    let j = i;
    while (j < toks.length && parts.length < 3) {
      const tk = toks[j];
      if (tk.page != null) {
        j++;
        continue;
      }
      if (tk.blank) {
        if (parts.length === 0) {
          j++;
          continue;
        }
        break;
      }
      const t = tk.text;
      if (isStructural(t) || isMarker(t) || t.length > 110 || /[.;:]$/.test(t) || (upperOnly && upperRatio(t) < 0.6)) break;
      if (isRowLike(t)) break;
      parts.push(t);
      j++;
    }
    return { text: parts.join(" "), next: parts.length ? j : i };
  };

  let i = 0;
  while (i < toks.length) {
    const tk = toks[i];
    if (tk.page != null) {
      curPage = tk.page;
      pageStart = true;
      i++;
      continue;
    }
    if (tk.blank) {
      prevBlank = true;
      i++;
      continue;
    }
    const t = tk.text;
    const wasBlank = prevBlank || pageStart;
    const prevText = cur ? cur.text : "";
    prevBlank = false;
    pageStart = false;

    // --- tabel: deretan >= 3 baris berkolom
    if (isRowLike(t)) {
      let j = i;
      const rows = [];
      let gapBlank = 0;
      while (j < toks.length) {
        const x = toks[j];
        if (x.page != null) {
          j++;
          continue;
        }
        if (x.blank) {
          gapBlank++;
          if (gapBlank > 1) break;
          j++;
          continue;
        }
        if (!isRowLike(x.text)) break;
        gapBlank = 0;
        rows.push(x.raw);
        j++;
      }
      if (rows.length >= 3) {
        const tbl = renderTable(rows);
        if (tbl) {
          flush();
          stack = [];
          emit(tbl.md, "other");
          if (tbl.kind === "table") stats.tabel += 1;
          i = j;
          prevBlank = true;
          continue;
        }
      }
    }

    // --- struktur
    let m;
    if (RE.bab.test(t) && /^BAB/.test(t)) {
      m = RE.bab.exec(t);
      let title = m[2].trim();
      let next = i + 1;
      if (!title) {
        const tt = takeTitle(i + 1, true);
        title = tt.text;
        next = tt.next;
      }
      stats.bab += 1;
      seenBody = true;
      level = 2;
      heading(2, `BAB ${m[1]}${title ? ` — ${title}` : ""}`);
      i = next;
      prevBlank = true;
      continue;
    }
    if (seenBody && (m = RE.bagian.exec(t)) && wasBlank) {
      let title = m[2].trim();
      let next = i + 1;
      if (!title) {
        const tt = takeTitle(i + 1, false);
        title = tt.text;
        next = tt.next;
      }
      stats.bagian += 1;
      level = 3;
      heading(3, `Bagian ${m[1]}${title ? ` — ${title}` : ""}`);
      i = next;
      prevBlank = true;
      continue;
    }
    if (seenBody && (m = RE.paragraf.exec(t)) && wasBlank) {
      let title = m[2].trim();
      let next = i + 1;
      if (!title) {
        const tt = takeTitle(i + 1, false);
        title = tt.text;
        next = tt.next;
      }
      level = 4;
      heading(4, `Paragraf ${m[1]}${title ? ` — ${title}` : ""}`);
      i = next;
      prevBlank = true;
      continue;
    }
    if ((m = RE.pasal.exec(t)) && (wasBlank || TERMINAL.test(prevText.trim()) || !cur)) {
      seenBody = true;
      stats.pasal += inPenj ? 0 : 1;
      heading(Math.min((inPenj ? 3 : level || 1) + 1, 6), `Pasal ${m[1]}${inPenj ? " (Penjelasan)" : ""}`);
      i++;
      continue;
    }
    if (RE.penjelasan.test(t) && wasBlank && seenBody) {
      inPenj = true;
      level = 2;
      // judul penjelasan bisa 2-3 baris ("PENJELASAN ATAS ... TENTANG ...")
      const lines = [t];
      let j = i + 1;
      while (j < toks.length && lines.length < 7) {
        const x = toks[j];
        if (x.page != null) {
          j++;
          continue;
        }
        if (x.blank || isStructural(x.text) || isMarker(x.text) || upperRatio(x.text) < 0.6) break;
        lines.push(x.text);
        j++;
      }
      heading(2, lines.join(" "));
      i = j;
      prevBlank = true;
      continue;
    }
    if ((m = RE.umum.exec(t)) && inPenj) {
      level = 2;
      heading(3, t);
      i++;
      continue;
    }
    if (!seenBody && (m = RE.front.exec(t))) {
      const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      heading(2, name);
      stack = [];
      if (m[2].trim()) {
        // sisa baris ("Menimbang : a. bahwa …") diproses sebagai baris biasa supaya butir a. tetap jadi daftar
        toks[i] = { raw: m[2], text: m[2].trim(), blank: false };
        prevBlank = true;
      } else i++;
      continue;
    }
    if (!seenBody && RE.memutuskan.test(t)) {
      heading(2, "MEMUTUSKAN");
      i++;
      continue;
    }
    if (RE.lampiran.test(t) && wasBlank && upperRatio(t) > 0.8 && seenBody) {
      level = 2;
      inPenj = false;
      heading(2, t);
      i++;
      continue;
    }

    // --- penanda daftar
    let mk = null;
    if ((m = RE.ayat.exec(t))) mk = { type: "ayat", value: m[1], label: `(${m[1]})`, body: m[2] };
    else if ((m = RE.huruf.exec(t))) mk = { type: "huruf", value: m[1], label: `${m[1]}${m[2]}`, body: m[3] };
    else if ((m = RE.angka.exec(t))) mk = { type: "angka", value: m[1], label: `${m[1]}${m[2]}`, body: m[3] };
    // "a." di tengah kalimat yang terpotong bukan butir: butir harus diawali baris kosong, akhir kalimat, atau butir lain
    if (mk && !(wasBlank || !cur || TERMINAL.test(prevText.trim()) || cur.kind === "item")) mk = null;
    if (mk) {
      flush();
      if (mk.type === "ayat") stats.ayat += 1;
      const depth = place(mk.type, mk.value);
      cur = { kind: "item", depth, prefix: mk.label, text: mk.body, page: curPage };
      i++;
      continue;
    }

    // --- baris biasa: lanjutan blok terbuka atau paragraf baru
    if (cur && !wasBlank) {
      cur.text = joinText(cur.text, t);
    } else if (cur && wasBlank && !TERMINAL.test(cur.text.trim()) && /^[a-z(]/.test(t)) {
      cur.text = joinText(cur.text, t); // kalimat yang terputus oleh pergantian halaman/kolom
    } else {
      flush();
      stack = [];
      cur = { kind: "para", depth: 0, prefix: "", text: t, page: curPage };
    }
    i++;
  }
  flush();

  // --- kepala YAML + judul
  const notes = [];
  if (badPages.length) notes.push(`Teks berantakan di ${badPages.filter((x) => x != null).length} halaman (hlm ${badPages.filter((x) => x != null).slice(0, 8).join(", ")}${badPages.length > 8 ? ", …" : ""}); periksa hasil di bagian itu.`);
  if (ocrPages > 0) notes.push(`${ocrPages} halaman dibaca lewat OCR (mungkin ada salah baca huruf/angka).`);
  if (stats.pasal === 0) notes.push("Tidak ditemukan judul 'Pasal': dokumen ini mungkin bukan peraturan berpasal, atau PDF-nya hasil scan buram.");
  const fm = [
    "---",
    `judul: ${yamlStr(meta.judul)}`,
    `jenis: ${yamlStr(meta.jenis)}`,
    `nomor: ${yamlStr(meta.nomor)}`,
    `tahun: ${meta.tahun ?? '""'}`,
    `tentang: ${yamlStr(meta.tentang)}`,
    `sumber_file: ${yamlStr(filename)}`,
    `halaman: ${pages.length}`,
    `jumlah_bab: ${stats.bab}`,
    `jumlah_pasal: ${stats.pasal}`,
    `dikonversi: ${now.toISOString().slice(0, 10)}`,
    `catatan: ${notes.length ? `\n${notes.map((n) => `  - ${yamlStr(n)}`).join("\n")}` : "[]"}`,
    "---",
    ""
  ];
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const markdown = `${fm.join("\n")}\n# ${meta.judul}\n\n${body}\n`;
  return { markdown, meta, stats: { ...stats, catatan: notes }, title: meta.judul };
}

// ---------------------------------------------------------------- 6. balik: Markdown -> halaman untuk indeks
/** Pecah .md (hasil di atas, atau yang sudah kamu sunting tangan) menjadi halaman untuk indeks pencarian. */
export function markdownToPages(md) {
  const text = String(md || "").replace(/\r/g, "").replace(/^---\n[\s\S]*?\n---\n/, "");
  const parts = text.split(/^<!-- hlm (\d+) -->\s*$/m);
  const pages = [];
  const first = parts[0].trim();
  if (parts.length === 1) return first ? [{ page: null, text: first }] : [];
  if (first) pages.push({ page: null, text: first });
  for (let k = 1; k < parts.length; k += 2) {
    const body = (parts[k + 1] || "").trim();
    if (body) pages.push({ page: Number(parts[k]), text: body });
  }
  return pages;
}

/** Judul dari kepala YAML (judul:) atau baris "# ..." pertama; null bila tak ada. */
export function markdownTitle(md) {
  const s = String(md || "");
  const y = /^judul:\s*"((?:[^"\\]|\\.)*)"/m.exec(s);
  if (y && y[1].trim()) return y[1].replace(/\\(["\\])/g, "$1").trim();
  const h = /^#\s+(.+)$/m.exec(s);
  return h ? h[1].trim() : null;
}
