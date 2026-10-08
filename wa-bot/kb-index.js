// ================================================================
// Indeks pencarian Dokumen Pengetahuan di LAPTOP (SQLite + FTS5, peringkat BM25).
//
// Teks lengkap dokumen (tanpa batas ukuran) disimpan di file SQLite lokal
// (default wa-bot/kb/kb.sqlite), dipecah per halaman -> potongan ±1200
// karakter (dengan overlap ±150 karakter antar-potongan di halaman yang sama),
// dan diindeks FTS5. Ollama tidak "membaca semua": tiap pertanyaan dicarikan
// beberapa potongan paling relevan (lengkap dengan nomor halaman).
//
// Anti-halusinasi saat mencari:
//   - potongan yang tampak seperti DAFTAR ISI diturunkan peringkatnya (kata kunci
//     padat di daftar isi membuat BM25 sering memilihnya, padahal tidak berisi jawaban);
//   - potongan tepat sesudah/sebelum hasil teratas ikut disertakan (daftar rukun/
//     syarat sering berlanjut ke potongan berikutnya) selama anggaran karakter cukup.
//
// Driver: pakai `node:sqlite` bawaan Node >= 22.5; kalau tidak ada, jatuh ke
// paket opsional `better-sqlite3`.
// ================================================================

import fs from "node:fs";
import path from "node:path";
import { stemCandidates, stemText } from "./id-stem.js";
import { despaceLetters, cleanBoilerplate, assessPageText } from "./text-clean.js";

const STOPWORDS = new Set(
  (
    "yang dan di ke dari untuk dengan pada adalah ini itu atau juga dalam akan sudah telah " +
    "oleh sebagai karena agar bagi para apa siapa kapan dimana mana bagaimana berapa kenapa mengapa " +
    "ada tidak bukan saya aku kamu anda kami kita mereka dia nya lah kah pun saja hanya lebih " +
    "sangat dapat bisa harus perlu boleh jika bila maka sehingga serta tentang terhadap antara " +
    "the and of to in is are for with on at by an be as it this that " +
    "jelaskan sebutkan uraikan tolong mohon minta coba secara rinci lengkap singkat informasi"
  ).split(/\s+/)
);

// Ejaan/singkatan sehari-hari -> istilah resmi di dokumen (sama dengan ID_ALIASES / QUERY_EXPANSIONS
// di index.js & supabase/functions/_shared/knowledge.ts).
const QUERY_ALIASES = { jogja: "yogyakarta", jogjakarta: "yogyakarta", yogya: "yogyakarta", jogyakarta: "yogyakarta", diy: "yogyakarta", gol: "golongan" };
const QUERY_EXPANSIONS = {
  ppk: ["pejabat", "pembuat", "komitmen"],
  pptk: ["pejabat", "pelaksana", "teknis", "kegiatan"],
  kpa: ["kuasa", "pengguna", "anggaran"],
  bpp: ["bendahara", "pengeluaran", "pembantu"],
  honor: ["honorarium"],
  honorer: ["honorarium"],
  uh: ["uang", "harian"],
  sbm: ["standar", "biaya", "masukan"],
  sbk: ["standar", "biaya", "keluaran"],
  perdin: ["perjalanan", "dinas"],
  spj: ["pertanggungjawaban"],
  // istilah fikih: terjemahan berbeda-beda ("rukun wudhu" di satu buku = "fardhu wudhu" di buku lain)
  rukun: ["fardhu", "fardu"],
  fardhu: ["rukun", "fardu"],
  fardu: ["rukun", "fardhu"]
};

export function tokenizeQuery(text) {
  const all = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  const useful = all.filter((w) => !STOPWORDS.has(w));
  const base = (useful.length > 0 ? useful : all).map((w) => QUERY_ALIASES[w] ?? w);
  const out = [...new Set(base)].slice(0, 20);
  for (const w of [...out]) for (const e of QUERY_EXPANSIONS[w] ?? []) if (!out.includes(e) && out.length < 26) out.push(e);
  return out;
}

// Kata -> ekspresi FTS5. Kata >= 4 huruf dicocokkan sebagai awalan supaya
// "perjalanan" ~ "perjalanannya", "tarif" ~ "tarifnya".
export function buildFtsQuery(tokens) {
  return tokens.map((w) => (w.length >= 4 ? `"${w}"*` : `"${w}"`)).join(" OR ");
}

// Kata -> ekspresi FTS5 atas kolom stem: semua kandidat batang kata tiap kata (kata persis, tanpa awalan).
export function buildStemQuery(tokens) {
  const terms = new Set();
  for (const w of tokens) {
    if (/^[a-z]+$/.test(w)) for (const c of stemCandidates(w)) terms.add(c);
    else terms.add(w);
  }
  return [...terms].slice(0, 80).map((t) => `"${t}"`).join(" OR ");
}

// Pecah teks satu halaman jadi potongan <= maxChars, memotong di batas baris.
export function splitPageText(text, maxChars = 1200) {
  const out = [];
  const clean = String(text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return out;
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (const rawLine of clean.split("\n")) {
    let line = rawLine;
    while (line.length > maxChars) {
      // baris super panjang: potong di spasi terdekat
      let cut = line.lastIndexOf(" ", maxChars);
      if (cut < maxChars * 0.5) cut = maxChars;
      if (cur) flush();
      out.push(line.slice(0, cut).trim());
      line = line.slice(cut).trimStart();
    }
    if (cur.length + line.length + 1 > maxChars) flush();
    cur += (cur ? "\n" : "") + line;
  }
  flush();
  return out;
}

// "[Halaman 3]\n...teks..." -> [{page, text}]
export function parsePageMarkers(text) {
  const parts = String(text || "").split(/^\[Halaman (\d+)\]\s*$/m);
  const pages = [];
  if (parts.length === 1) return [{ page: null, text: parts[0] }];
  if (parts[0].trim()) pages.push({ page: null, text: parts[0] });
  for (let i = 1; i < parts.length; i += 2) pages.push({ page: Number(parts[i]), text: parts[i + 1] || "" });
  return pages;
}

// Potongan beroverlap: tiap potongan (kecuali yang pertama di halaman) diawali ekor
// potongan sebelumnya (≤ overlapChars, dipotong di batas baris/spasi). Mengembalikan
// [{ text, ov }] dengan ov = panjang awalan overlap (supaya teks utuh bisa dirakit ulang
// tanpa duplikat, lihat getDocText). Panjang tiap potongan tetap <= maxChars.
export function splitPageChunks(text, maxChars = 1000, overlapChars = 150) {
  const ov = Math.max(0, Math.min(overlapChars, Math.floor(maxChars / 3)));
  const base = splitPageText(text, maxChars - ov);
  return base.map((piece, i) => {
    if (i === 0 || ov === 0) return { text: piece, ov: 0 };
    const prev = base[i - 1];
    let tail = prev.slice(-ov);
    // mulai di batas baris/kata, bukan di tengah kata
    const nl = tail.indexOf("\n");
    if (nl >= 0 && nl < tail.length - 1) tail = tail.slice(nl + 1);
    else {
      const sp = tail.indexOf(" ");
      if (sp >= 0 && sp < tail.length - 1 && prev.length > ov) tail = tail.slice(sp + 1);
    }
    tail = tail.trim();
    if (!tail) return { text: piece, ov: 0 };
    return { text: `${tail}\n${piece}`, ov: tail.length + 1 };
  });
}

// Apakah potongan ini tampak seperti DAFTAR ISI / indeks? (baris berpola "judul ..... 12",
// "judul    12", atau judul bagian "DAFTAR ISI"). Dipakai untuk menurunkan peringkat saat mencari.
const TOC_ENTRY_RE = /(\.{3,}|(?:\.\s){3,}\.?|…{1,}|·{3,}|_{3,}|\s{3,})\s*(\d{1,4}|[ivxlc]{1,6})\s*$/i;
const TOC_LEADER_RE = /(?:\.\s?){5,}|…{2,}|·{4,}/; // titik pengantar "........" / ". . . . ." di tengah/akhir baris
export function looksLikeToc(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const entries = lines.filter((l) => TOC_ENTRY_RE.test(l) && /\p{L}{3,}/u.test(l)).length;
  const leaders = lines.filter((l) => TOC_LEADER_RE.test(l) && /\p{L}{3,}/u.test(l)).length;
  const heading = /^(daftar\s+isi|table\s+of\s+contents|daftar\s+(tabel|gambar|lampiran))\b/im.test(text);
  if (heading && Math.max(entries, leaders) >= 2) return true;
  if (leaders >= 3 && leaders / lines.length >= 0.4) return true; // judul bab yang dibungkus ke baris kedua
  return lines.length >= 4 && entries / lines.length >= 0.6;
}

// ---------------- Tabel: kepala kolom & fokus baris ----------------
// Tabel panjang (mis. tarif per provinsi) terpecah jadi banyak potongan, dan potongan ke-2 dst. tak memuat
// judul/kepala kolomnya -> angka tak bisa dibaca, atau model memilih baris yang salah. Karena itu:
//   - kepala tabel (judul + baris nomor kolom "(1) (2) (3) ...") disimpan per potongan (kolom `head`) dan
//     disisipkan di depan blok hasil pencarian;
//   - bila pertanyaan menyebut nama baris tertentu ("papua"), baris yang tak cocok disembunyikan.
const AMOUNT_RE = /(?:Rp\.?\s?\d[\d.,]*|\b\d{1,3}(?:[.,]\d{3})+\b)/g;
export function isDataRow(line) {
  return (String(line).match(AMOUNT_RE) || []).length >= 2;
}

const COLNUM_RE = /^\s*\(\s*1\s*\)\s+\(\s*2\s*\)/;
export function findTableHead(pageText, maxChars = 1600) {
  const lines = String(pageText || "").split("\n");
  const idx = lines.findIndex((l, i) => i < 45 && COLNUM_RE.test(l));
  if (idx < 0) return null;
  const head = lines.slice(0, idx + 1).filter((l) => l.trim());
  const indent = Math.min(...head.map((l) => l.match(/^\s*/)[0].length));
  const out = head.map((l) => l.slice(indent).replace(/\s+$/, "")).join("\n");
  return out.length > 0 && out.length <= maxChars ? out : null;
}

function wordsOf(line) {
  return String(line || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Sembunyikan baris data tabel yang tidak menyebut nama/kata kunci pertanyaan. Tak berubah bila tabelnya
// pendek (< 6 baris), tak ada baris yang cocok, atau hampir semua baris cocok.
export function focusTableRows(text, tokens) {
  const lines = String(text).split("\n");
  const rowIdx = lines.map((l, i) => (isDataRow(l) ? i : -1)).filter((i) => i >= 0);
  if (rowIdx.length < 6) return text;
  const rowWords = new Map(rowIdx.map((i) => [i, wordsOf(lines[i])]));
  const matches = (words, tok) => words.some((w) => w === tok || (tok.length >= 3 && w.startsWith(tok)) || stemCandidates(w).includes(tok));
  // kata yang cocok ke > 60% baris (mis. "oh", "satuan") tidak membedakan baris
  const useful = tokens.filter((t) => {
    const n = rowIdx.filter((i) => matches(rowWords.get(i), t)).length;
    return n > 0 && n <= rowIdx.length * 0.6;
  });
  if (useful.length === 0) return text;
  const keepRow = new Set(rowIdx.filter((i) => useful.some((t) => matches(rowWords.get(i), t))));
  if (keepRow.size === 0 || keepRow.size >= rowIdx.length * 0.8) return text;
  const out = [];
  let skipping = false;
  lines.forEach((l, i) => {
    const isRow = rowWords.has(i);
    if (isRow && !keepRow.has(i)) {
      if (!skipping) out.push("[… baris tabel lain tidak ditampilkan …]");
      skipping = true;
      return;
    }
    skipping = false;
    out.push(l);
  });
  return out.join("\n");
}

// Berapa kata kunci pertanyaan yang tercakup teks ini (kata persis, awalan, atau batang kata yang sama).
export function coverageOf(text, tokens) {
  const words = wordsOf(text);
  const stems = new Set();
  for (const w of words) for (const c of stemCandidates(w)) stems.add(c);
  let n = 0;
  for (const t of tokens) {
    if (stems.has(t) || stemCandidates(t).some((c) => stems.has(c)) || (t.length >= 4 && words.some((w) => w.startsWith(t)))) n += 1;
  }
  return n;
}

async function loadDriver() {
  try {
    const m = await import("node:sqlite");
    if (m.DatabaseSync) return { name: "node:sqlite", open: (f) => new m.DatabaseSync(f) };
  } catch (_e) {
    // lanjut
  }
  try {
    const m = await import("better-sqlite3");
    const Database = m.default || m;
    return { name: "better-sqlite3", open: (f) => new Database(f) };
  } catch (_e) {
    // lanjut
  }
  throw new Error(
    "Tidak ada driver SQLite: pakai Node >= 22.5 (node:sqlite) atau jalankan `npm install better-sqlite3` di folder wa-bot."
  );
}

const TOC_QUERY_RE = /\b(daftar isi|table of contents|daftar (tabel|gambar|lampiran))\b/i;
const SCHEMA_VERSION = 5; // 2 = potongan beroverlap + penanda daftar isi; 3 = kolom batang kata (stem) + FTS kedua; 4 = huruf terpisah disatukan + kepala tabel per potongan; 5 = penanda halaman berantakan + pembersihan boilerplate

export async function openKbIndex({ file, log = console, chunkChars = 1000, overlapChars = 150, reindex = false } = {}) {
  const envCov = Number(process.env.KB_MIN_COVERAGE);
  const defaults = { chunkChars, overlapChars, minCoverage: process.env.KB_MIN_COVERAGE !== undefined && process.env.KB_MIN_COVERAGE !== "" && envCov >= 0 && envCov <= 1 ? envCov : 0.5 };
  const driver = await loadDriver();
  if (file && file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = driver.open(file || ":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    create table if not exists docs (
      id text primary key,
      title text not null,
      filename text,
      pages integer,
      chars integer not null default 0,
      chunks integer not null default 0,
      ocr_pages integer not null default 0,
      indexed_at text not null
    );
    create table if not exists chunks (
      id integer primary key,
      doc_id text not null,
      seq integer not null,
      page integer,
      text text not null
    );
    create index if not exists chunks_doc_idx on chunks(doc_id, seq);
    create virtual table if not exists chunks_fts using fts5(
      text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    create trigger if not exists chunks_ai after insert on chunks begin
      insert into chunks_fts(rowid, text) values (new.id, new.text);
    end;
    create trigger if not exists chunks_ad after delete on chunks begin
      insert into chunks_fts(chunks_fts, rowid, text) values ('delete', old.id, old.text);
    end;
  `);

  // Migrasi skema ringan: kolom ov (panjang awalan overlap) & toc (potongan mirip daftar isi).
  const cols = new Set(db.prepare("pragma table_info(chunks)").all().map((c) => c.name));
  if (!cols.has("ov")) db.exec("alter table chunks add column ov integer not null default 0");
  if (!cols.has("toc")) db.exec("alter table chunks add column toc integer not null default 0");
  if (!cols.has("stem")) db.exec("alter table chunks add column stem text not null default ''");
  if (!cols.has("head")) db.exec("alter table chunks add column head text not null default ''");
  if (!cols.has("bad")) db.exec("alter table chunks add column bad integer not null default 0");
  // FTS kedua di atas kolom `stem` (kandidat batang kata): menjembatani imbuhan Indonesia
  // ("menyetor" ~ "penyetoran" ~ "setoran"). Teks asli tetap dicari lewat chunks_fts (awalan).
  db.exec(`
    create virtual table if not exists chunks_stem_fts using fts5(
      stem, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    create trigger if not exists chunks_si after insert on chunks begin
      insert into chunks_stem_fts(rowid, stem) values (new.id, new.stem);
    end;
    create trigger if not exists chunks_sd after delete on chunks begin
      insert into chunks_stem_fts(chunks_stem_fts, rowid, stem) values ('delete', old.id, old.stem);
    end;
  `);
  const schemaVersion = Number(db.prepare("pragma user_version").get().user_version) || 0;

  const q = {
    delChunks: db.prepare("delete from chunks where doc_id = ?"),
    delDoc: db.prepare("delete from docs where id = ?"),
    insChunk: db.prepare("insert into chunks (doc_id, seq, page, text, ov, toc, stem, head, bad) values (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    insDoc: db.prepare(
      "insert or replace into docs (id, title, filename, pages, chars, chunks, ocr_pages, indexed_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    listDocs: db.prepare("select id, title, filename, pages, chars, chunks, ocr_pages, indexed_at from docs order by indexed_at desc"),
    getDoc: db.prepare("select id, title, filename, pages, chars, chunks, ocr_pages from docs where id = ?"),
    docChunks: db.prepare("select page, text, ov from chunks where doc_id = ? order by seq"),
    neighbor: db.prepare("select c.doc_id as doc_id, d.title as title, c.page as page, c.seq as seq, c.text as text, c.ov as ov, c.toc as toc, c.head as head, c.bad as bad from chunks c join docs d on d.id = c.doc_id where c.doc_id = ? and c.seq = ?"),
    search: db.prepare(
      `select c.doc_id as doc_id, d.title as title, c.page as page, c.seq as seq, c.text as text, c.ov as ov, c.toc as toc, c.head as head, c.bad as bad, bm25(chunks_fts) as score
       from chunks_fts join chunks c on c.id = chunks_fts.rowid join docs d on d.id = c.doc_id
       where chunks_fts match ? order by bm25(chunks_fts) limit ?`
    ),
    searchStem: db.prepare(
      `select c.doc_id as doc_id, d.title as title, c.page as page, c.seq as seq, c.text as text, c.ov as ov, c.toc as toc, c.head as head, c.bad as bad, bm25(chunks_stem_fts) as score
       from chunks_stem_fts join chunks c on c.id = chunks_stem_fts.rowid join docs d on d.id = c.doc_id
       where chunks_stem_fts match ? order by bm25(chunks_stem_fts) limit ?`
    ),
    totals: db.prepare("select (select count(*) from docs) as docs, (select count(*) from chunks) as chunks, (select coalesce(sum(chars),0) from docs) as chars")
  };

  function inTx(fn) {
    db.exec("BEGIN");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch (_e) {
        // abaikan
      }
      throw e;
    }
  }

  // pages: [{ page: number|null, text: string }]
  function upsertDoc({ id, title, filename = null, pages, ocrPages = 0, chunkChars = defaults.chunkChars, overlapChars = defaults.overlapChars }) {
    return inTx(() => {
      q.delChunks.run(id);
      q.delDoc.run(id);
      let seq = 0;
      let chars = 0;
      let carryHead = null; // kepala tabel yang berlaku untuk halaman lanjutan (tabel bersambung antarhalaman)
      for (const p of pages) {
        const pageText = cleanBoilerplate(despaceLetters(p.text)); // "B A N T E N" -> "BANTEN"; buang URL penanda air & "SK No …"
        const pageBad = assessPageText(pageText).bad ? 1 : 0; // teks berantakan: diturunkan peringkatnya saat mencari
        const ownHead = findTableHead(pageText);
        const hasRows = pageText.split("\n").filter(isDataRow).length >= 3;
        if (ownHead) carryHead = ownHead;
        else if (!hasRows) carryHead = null;
        const pageHead = ownHead || (hasRows ? carryHead : null);
        for (const piece of splitPageChunks(pageText, chunkChars, overlapChars)) {
          // potongan yang sudah memuat baris nomor kolom tak perlu kepala tambahan
          const head = pageHead && !piece.text.split("\n").some((l) => COLNUM_RE.test(l)) && piece.text.split("\n").some(isDataRow) ? pageHead : "";
          q.insChunk.run(id, seq++, p.page ?? null, piece.text, piece.ov, looksLikeToc(piece.text) ? 1 : 0, stemText(`${head}\n${piece.text}`), head, pageBad);
          chars += piece.text.length - piece.ov;
        }
      }
      const pageNums = pages.map((p) => p.page).filter((n) => Number.isFinite(n));
      const pageCount = pageNums.length > 0 ? Math.max(...pageNums) : null;
      q.insDoc.run(id, title, filename, pageCount, chars, seq, ocrPages, new Date().toISOString());
      return { chunks: seq, chars, pages: pageCount };
    });
  }

  function upsertDocFromText({ id, title, filename = null, text }) {
    return upsertDoc({ id, title, filename, pages: parsePageMarkers(text) });
  }

  function removeDoc(id) {
    inTx(() => {
      q.delChunks.run(id);
      q.delDoc.run(id);
    });
  }

  function listDocs() {
    return q.listDocs.all();
  }

  function hasDocs() {
    return Number(q.totals.get().docs) > 0;
  }

  // Teks lengkap dokumen (dengan penanda [Halaman n]), untuk peringkasan menyeluruh.
  function getDocText(id) {
    const rows = q.docChunks.all(id);
    let out = "";
    let lastPage = Symbol("none");
    for (const r of rows) {
      if (r.page !== lastPage) {
        out += `${out ? "\n\n" : ""}${r.page != null ? `[Halaman ${r.page}]\n` : ""}`;
        lastPage = r.page;
      } else {
        out += "\n";
      }
      out += r.ov > 0 ? r.text.slice(r.ov) : r.text; // buang awalan overlap (sudah ada di potongan sebelumnya)
    }
    return out;
  }

  function getAllDocs() {
    return q.listDocs.all().map((d) => ({ id: d.id, title: d.title, content: getDocText(d.id) }));
  }

  // Cari potongan paling relevan. Mengembalikan [{ docId, title, text, page, score }].
  // `text` sudah diawali "[Halaman n]" supaya model bisa menyebut halaman.
  //   1. potongan mirip daftar isi dibuang (kecuali pertanyaannya memang soal daftar isi);
  //   2. hasil teratas mengisi ±65% anggaran, lalu potongan SESUDAH/SEBELUM 3 hasil teratas
  //      (dan 2 potongan sesudah hasil #1) ikut disertakan (daftar yang berlanjut ke potongan berikutnya tidak terpotong);
  //   3. potongan yang bersebelahan digabung jadi satu blok berurutan (awalan overlap dibuang).
  function search(question, { budgetChars = 5000, maxChunks = 8, neighbors = true, minCoverage = defaults.minCoverage } = {}) {
    const tokens = tokenizeQuery(question);
    if (tokens.length === 0) return [];
    // Dua pencarian digabung dengan Reciprocal Rank Fusion:
    //   A. teks asli (kata persis / awalan) -- tepat untuk istilah, nomor pasal, angka;
    //   B. batang kata (stem) -- menjembatani imbuhan: menyetor ~ setoran ~ penyetoran.
    const limit = Math.max(maxChunks * 5, 30);
    let rowsA = [];
    let rowsB = [];
    try {
      rowsA = q.search.all(buildFtsQuery(tokens), limit);
    } catch (e) {
      log.error?.("KB: pencarian FTS gagal:", e.message);
    }
    try {
      const stemQ = buildStemQuery(tokens);
      if (stemQ) rowsB = q.searchStem.all(stemQ, limit);
    } catch (e) {
      log.error?.("KB: pencarian stem gagal:", e.message);
    }
    const fused = new Map();
    const fuse = (list, tag) =>
      list.forEach((r, i) => {
        const k = `${r.doc_id}#${r.seq}`;
        const cur = fused.get(k) || { ...r, rrf: 0, bm: -Infinity, inA: false, inB: false };
        cur.rrf += 1 / (60 + i + 1);
        cur.bm = Math.max(cur.bm, -Number(r.score));
        cur[tag] = true;
        fused.set(k, cur);
      });
    fuse(rowsA, "inA");
    fuse(rowsB, "inB");
    const rows = [...fused.values()]
      .map((r) => ({ ...r, score: -r.rrf })) // kecil = baik (dipakai di bawah)
      .sort((a, b) => a.score - b.score);
    if (rows.length === 0) return [];
    const wantToc = TOC_QUERY_RE.test(String(question || ""));

    // Cakupan kata: pertanyaan panjang (>= 5 kata penting) harus tercakup minimal 50% (KB_MIN_COVERAGE, 0 = mati) oleh potongan (kata dicocokkan
    // lewat batang kata, kepala tabel ikut dihitung). Bila tak ada potongan yang memenuhi -> tidak ada hasil, sehingga
    // model diberi tahu "tidak ditemukan" alih-alih disodori potongan yang kebetulan memuat 1-2 kata umum.
    let candidates = rows;
    if (minCoverage > 0 && tokens.length >= 5) {
      const need = Math.max(2, Math.ceil(tokens.length * minCoverage));
      candidates = rows.filter((r) => coverageOf(`${r.head || ""}\n${r.text}`, tokens) >= need);
      if (candidates.length === 0) return [];
    }

    const nonToc = candidates.filter((r) => !r.toc);
    const good = nonToc.filter((r) => !r.bad);
    // Halaman berantakan (OCR rusak) hanya mengisi sisa tempat sesudah potongan yang bersih.
    const pool = wantToc ? candidates : good.length > 0 ? [...good, ...nonToc.filter((r) => r.bad)] : nonToc.length > 0 ? nonToc : candidates;

    const keyOf = (r) => `${r.doc_id}#${r.seq}`;
    const cost = (r) => r.text.length - (r.ov || 0);
    const sel = new Map();
    let used = 0;
    const primaryBudget = neighbors ? Math.floor(budgetChars * 0.65) : budgetChars;
    let primaries = 0;
    for (const r of pool) {
      if (primaries >= maxChunks) break;
      if (sel.size > 0 && used + cost(r) > primaryBudget) continue;
      sel.set(keyOf(r), r);
      used += cost(r);
      primaries += 1;
    }
    const tops = [...sel.values()].slice(0, 3);
    if (neighbors) {
      // Hasil teratas: sesudah, sebelum, lalu dua potongan sesudahnya (daftar panjang bisa menyambung
      // ke beberapa potongan); hasil ke-2/3: hanya sesudah & sebelum.
      tops.forEach((p, rank) => {
        for (const off of rank === 0 ? [1, -1, 2] : [1, -1]) {
          const nb = q.neighbor.get(p.doc_id, p.seq + off);
          if (!nb || sel.has(keyOf(nb)) || (nb.toc && !wantToc)) continue;
          if (used + cost(nb) > budgetChars) continue;
          sel.set(keyOf(nb), { ...nb, score: p.score, neighbor: true });
          used += cost(nb);
        }
      });
      // sisa anggaran: hasil berikutnya yang belum terpilih
      for (const r of pool) {
        if (primaries >= maxChunks) break;
        if (sel.has(keyOf(r)) || used + cost(r) > budgetChars) continue;
        sel.set(keyOf(r), r);
        used += cost(r);
        primaries += 1;
      }
    }

    // Susun blok: per dokumen, urut seq, gabungkan potongan yang bersambung.
    const byDoc = new Map();
    for (const r of sel.values()) {
      if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, []);
      byDoc.get(r.doc_id).push(r);
    }
    const blocks = [];
    for (const list of byDoc.values()) {
      list.sort((a, b) => a.seq - b.seq);
      let run = [];
      const flush = () => {
        if (run.length === 0) return;
        let text = "";
        let lastPage = null;
        const headSrc = run.some((r) => r.text.split("\n").some((l) => COLNUM_RE.test(l))) ? null : run.find((r) => r.head);
        run.forEach((r, i) => {
          const body = i > 0 && r.ov > 0 ? r.text.slice(r.ov) : r.text;
          if (i === 0) text = `${r.page != null ? `[Halaman ${r.page}] ` : ""}${headSrc ? `(Judul & kepala kolom tabel ini:)\n${headSrc.head}\n(lanjutan tabel:)\n` : ""}${body}`;
          else text += `${r.page != null && r.page !== lastPage ? `\n[Halaman ${r.page}] ` : "\n"}${body}`;
          lastPage = r.page;
        });
        text = focusTableRows(text, tokens);
        const hits = run.filter((r) => !r.neighbor);
        const best = (hits.length > 0 ? hits : run).reduce((m, r) => (Number(r.score) < Number(m.score) ? r : m)); // bm25: makin kecil makin baik
        blocks.push({ docId: run[0].doc_id, title: run[0].title, page: best.page, text, score: Number.isFinite(best.bm) ? best.bm : 0, rrf: -Number(best.score), bad: !!best.bad });
        run = [];
      };
      for (const r of list) {
        if (run.length > 0 && r.seq !== run[run.length - 1].seq + 1) flush();
        run.push(r);
      }
      flush();
    }
    blocks.sort((a, b) => Number(a.bad) - Number(b.bad) || b.rrf - a.rrf); // halaman berantakan di belakang
    return blocks;
  }

  function stats() {
    const t = q.totals.get();
    return { docs: Number(t.docs), chunks: Number(t.chunks), chars: Number(t.chars), driver: driver.name };
  }

  function close() {
    try {
      db.close();
    } catch (_e) {
      // abaikan
    }
  }

  // Susun ulang potongan semua dokumen dari teks tersimpan (indeks versi lama tanpa overlap/penanda
  // daftar isi, atau KB_REINDEX=true setelah mengganti ukuran potongan). Tanpa OCR ulang.
  if (reindex || schemaVersion < SCHEMA_VERSION) {
    const docs = q.listDocs.all();
    // Baris lama belum pernah masuk FTS stem; "delete" atas baris yang tak terindeks merusak FTS5.
    // Jadi pemicu hapus stem dimatikan selama penyusunan ulang pertama, lalu dipasang lagi.
    const firstStem = schemaVersion < 3;
    if (firstStem) db.exec("drop trigger if exists chunks_sd");
    for (const d of docs) {
      upsertDoc({ id: d.id, title: d.title, filename: d.filename, pages: parsePageMarkers(getDocText(d.id)), ocrPages: d.ocr_pages });
    }
    if (firstStem) {
      db.exec("insert into chunks_stem_fts(chunks_stem_fts) values ('rebuild')"); // sapu entri basah bila proses sempat terhenti
      db.exec(`create trigger if not exists chunks_sd after delete on chunks begin
        insert into chunks_stem_fts(chunks_stem_fts, rowid, stem) values ('delete', old.id, old.stem);
      end;`);
    }
    db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
    if (docs.length > 0) log.log?.(`📚 Indeks dokumen disusun ulang (${docs.length} dokumen): potongan ${defaults.chunkChars} karakter + overlap ${defaults.overlapChars}.`);
  }

  return { upsertDoc, upsertDocFromText, removeDoc, listDocs, hasDocs, getDocText, getAllDocs, search, stats, close, driver: driver.name };
}
