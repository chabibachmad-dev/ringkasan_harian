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

const STOPWORDS = new Set(
  (
    "yang dan di ke dari untuk dengan pada adalah ini itu atau juga dalam akan sudah telah " +
    "oleh sebagai karena agar bagi para apa siapa kapan dimana mana bagaimana berapa kenapa mengapa " +
    "ada tidak bukan saya aku kamu anda kami kita mereka dia nya lah kah pun saja hanya lebih " +
    "sangat dapat bisa harus perlu boleh jika bila maka sehingga serta tentang terhadap antara " +
    "the and of to in is are for with on at by an be as it this that"
  ).split(/\s+/)
);

export function tokenizeQuery(text) {
  const all = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  const useful = all.filter((w) => !STOPWORDS.has(w));
  return [...new Set(useful.length > 0 ? useful : all)].slice(0, 24);
}

// Kata -> ekspresi FTS5. Kata >= 4 huruf dicocokkan sebagai awalan supaya
// "perjalanan" ~ "perjalanannya", "tarif" ~ "tarifnya".
export function buildFtsQuery(tokens) {
  return tokens.map((w) => (w.length >= 4 ? `"${w}"*` : `"${w}"`)).join(" OR ");
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
const TOC_ENTRY_RE = /(\.{3,}|…{1,}|\s{3,})\s*(\d{1,4}|[ivxlc]{1,6})\s*$/i;
export function looksLikeToc(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const entries = lines.filter((l) => TOC_ENTRY_RE.test(l) && /\p{L}{3,}/u.test(l)).length;
  const heading = /^(daftar\s+isi|table\s+of\s+contents|daftar\s+(tabel|gambar|lampiran))\b/im.test(text);
  if (heading && entries >= 2) return true;
  return lines.length >= 4 && entries / lines.length >= 0.6;
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
const SCHEMA_VERSION = 2; // 2 = potongan beroverlap + penanda daftar isi

export async function openKbIndex({ file, log = console, chunkChars = 1000, overlapChars = 150, reindex = false } = {}) {
  const defaults = { chunkChars, overlapChars };
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
  const schemaVersion = Number(db.prepare("pragma user_version").get().user_version) || 0;

  const q = {
    delChunks: db.prepare("delete from chunks where doc_id = ?"),
    delDoc: db.prepare("delete from docs where id = ?"),
    insChunk: db.prepare("insert into chunks (doc_id, seq, page, text, ov, toc) values (?, ?, ?, ?, ?, ?)"),
    insDoc: db.prepare(
      "insert or replace into docs (id, title, filename, pages, chars, chunks, ocr_pages, indexed_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    listDocs: db.prepare("select id, title, filename, pages, chars, chunks, ocr_pages, indexed_at from docs order by indexed_at desc"),
    getDoc: db.prepare("select id, title, filename, pages, chars, chunks, ocr_pages from docs where id = ?"),
    docChunks: db.prepare("select page, text, ov from chunks where doc_id = ? order by seq"),
    neighbor: db.prepare("select c.doc_id as doc_id, d.title as title, c.page as page, c.seq as seq, c.text as text, c.ov as ov, c.toc as toc from chunks c join docs d on d.id = c.doc_id where c.doc_id = ? and c.seq = ?"),
    search: db.prepare(
      `select c.doc_id as doc_id, d.title as title, c.page as page, c.seq as seq, c.text as text, c.ov as ov, c.toc as toc, bm25(chunks_fts) as score
       from chunks_fts join chunks c on c.id = chunks_fts.rowid join docs d on d.id = c.doc_id
       where chunks_fts match ? order by bm25(chunks_fts) limit ?`
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
      for (const p of pages) {
        for (const piece of splitPageChunks(p.text, chunkChars, overlapChars)) {
          q.insChunk.run(id, seq++, p.page ?? null, piece.text, piece.ov, looksLikeToc(piece.text) ? 1 : 0);
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
  function search(question, { budgetChars = 5000, maxChunks = 8, neighbors = true } = {}) {
    const tokens = tokenizeQuery(question);
    if (tokens.length === 0) return [];
    let rows;
    try {
      rows = q.search.all(buildFtsQuery(tokens), Math.max(maxChunks * 5, 30));
    } catch (e) {
      log.error?.("KB: pencarian FTS gagal:", e.message);
      return [];
    }
    const wantToc = TOC_QUERY_RE.test(String(question || ""));
    const nonToc = rows.filter((r) => !r.toc);
    const pool = wantToc || nonToc.length === 0 ? rows : nonToc;

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
        run.forEach((r, i) => {
          const body = i > 0 && r.ov > 0 ? r.text.slice(r.ov) : r.text;
          if (i === 0) text = `${r.page != null ? `[Halaman ${r.page}] ` : ""}${body}`;
          else text += `${r.page != null && r.page !== lastPage ? `\n[Halaman ${r.page}] ` : "\n"}${body}`;
          lastPage = r.page;
        });
        const hits = run.filter((r) => !r.neighbor);
        const best = (hits.length > 0 ? hits : run).reduce((m, r) => (Number(r.score) < Number(m.score) ? r : m)); // bm25: makin kecil makin baik
        blocks.push({ docId: run[0].doc_id, title: run[0].title, page: best.page, text, score: -Number(best.score) });
        run = [];
      };
      for (const r of list) {
        if (run.length > 0 && r.seq !== run[run.length - 1].seq + 1) flush();
        run.push(r);
      }
      flush();
    }
    blocks.sort((a, b) => b.score - a.score);
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
    for (const d of docs) {
      upsertDoc({ id: d.id, title: d.title, filename: d.filename, pages: parsePageMarkers(getDocText(d.id)), ocrPages: d.ocr_pages });
    }
    db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
    if (docs.length > 0) log.log?.(`📚 Indeks dokumen disusun ulang (${docs.length} dokumen): potongan ${defaults.chunkChars} karakter + overlap ${defaults.overlapChars}.`);
  }

  return { upsertDoc, upsertDocFromText, removeDoc, listDocs, hasDocs, getDocText, getAllDocs, search, stats, close, driver: driver.name };
}
