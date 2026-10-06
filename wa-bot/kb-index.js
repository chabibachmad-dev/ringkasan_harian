// ================================================================
// Indeks pencarian Dokumen Pengetahuan di LAPTOP (SQLite + FTS5, peringkat BM25).
//
// Teks lengkap dokumen (tanpa batas ukuran) disimpan di file SQLite lokal
// (default wa-bot/kb/kb.sqlite), dipecah per halaman -> potongan ±1200
// karakter, dan diindeks FTS5. Ollama tidak "membaca semua": tiap pertanyaan
// dicarikan beberapa potongan paling relevan (lengkap dengan nomor halaman).
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

export async function openKbIndex({ file, log = console } = {}) {
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

  const q = {
    delChunks: db.prepare("delete from chunks where doc_id = ?"),
    delDoc: db.prepare("delete from docs where id = ?"),
    insChunk: db.prepare("insert into chunks (doc_id, seq, page, text) values (?, ?, ?, ?)"),
    insDoc: db.prepare(
      "insert or replace into docs (id, title, filename, pages, chars, chunks, ocr_pages, indexed_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    listDocs: db.prepare("select id, title, filename, pages, chars, chunks, ocr_pages, indexed_at from docs order by indexed_at desc"),
    getDoc: db.prepare("select id, title, filename, pages, chars, chunks, ocr_pages from docs where id = ?"),
    docChunks: db.prepare("select page, text from chunks where doc_id = ? order by seq"),
    search: db.prepare(
      `select c.doc_id as doc_id, d.title as title, c.page as page, c.seq as seq, c.text as text, bm25(chunks_fts) as score
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
  function upsertDoc({ id, title, filename = null, pages, ocrPages = 0, chunkChars = 1200 }) {
    return inTx(() => {
      q.delChunks.run(id);
      q.delDoc.run(id);
      let seq = 0;
      let chars = 0;
      for (const p of pages) {
        for (const piece of splitPageText(p.text, chunkChars)) {
          q.insChunk.run(id, seq++, p.page ?? null, piece);
          chars += piece.length;
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
      out += r.text;
    }
    return out;
  }

  function getAllDocs() {
    return q.listDocs.all().map((d) => ({ id: d.id, title: d.title, content: getDocText(d.id) }));
  }

  // Cari potongan paling relevan. Mengembalikan [{ title, text, page, score }].
  // `text` sudah diawali "[Halaman n]" supaya model bisa menyebut halaman.
  function search(question, { budgetChars = 5000, maxChunks = 8 } = {}) {
    const tokens = tokenizeQuery(question);
    if (tokens.length === 0) return [];
    let rows;
    try {
      rows = q.search.all(buildFtsQuery(tokens), Math.max(maxChunks * 4, 20));
    } catch (e) {
      log.error?.("KB: pencarian FTS gagal:", e.message);
      return [];
    }
    const picked = [];
    let used = 0;
    for (const r of rows) {
      if (picked.length >= maxChunks) break;
      if (picked.length > 0 && used + r.text.length > budgetChars) continue;
      picked.push({
        docId: r.doc_id,
        title: r.title,
        page: r.page,
        text: `${r.page != null ? `[Halaman ${r.page}] ` : ""}${r.text}`,
        score: -Number(r.score)
      });
      used += r.text.length;
    }
    return picked;
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

  return { upsertDoc, upsertDocFromText, removeDoc, listDocs, hasDocs, getDocText, getAllDocs, search, stats, close, driver: driver.name };
}
