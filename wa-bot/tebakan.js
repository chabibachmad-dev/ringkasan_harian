// Gudang pengetahuan umum + permainan tebak-tebakan di grup WhatsApp.
//
// Disimpan di SQLite LOKAL (pengetahuan.sqlite): jenis tebakan|fakta|candaan|istilah, status aktif|menunggu|ditolak.
// Tanpa model AI: isi catatan hanya DATA yang ditampilkan apa adanya (tidak pernah disisipkan ke prompt, tidak dikarang tambahannya).
// Pencarian memakai FTS5 + bm25 (pembantu tokenisasi/stem dari kb-index.js dan id-stem.js, tanpa indeks ganda).
//
// Memasukkan data:
//   berkas awal   data/tebakan-awal.txt  ->  kategori | pertanyaan | jawaban | petunjuk   (jawaban alternatif dipisah "/", # = komentar)
//   Telegram      /tebak tambah|impor|impor-awal|daftar|hapus|menunggu   (hanya pemilik; usulan punya tombol Setujui/Tolak)
//   Grup          pemilik terverifikasi membalas pesan dengan "simpan"/"catat tebakan ini" -> langsung aktif;
//                 orang lain -> status "menunggu" sampai pemilik menyetujui. Isi grup TIDAK disimpan otomatis.
// Privasi: catatan yang memuat nomor telepon/NIK/rekening/alamat/email/rahasia ditolak. Panjang tiap kolom dibatasi.
import fs from "node:fs";
import path from "node:path";
import { loadDriver, tokenizeQuery } from "./kb-index.js";
import { stemCandidates, stemText } from "./id-stem.js";
import { looksLikeSecret } from "./owner-memory.js";

export const MAX_LEN = { kategori: 30, pertanyaan: 300, jawaban: 120, petunjuk: 150 };
export const JENIS = ["tebakan", "fakta", "candaan", "istilah"];
export const SUMBER = ["awal", "telegram", "grup"];
const DEFAULT_TTL_MIN = 15;
const QA_MIN_MATCHED = 2;

// ---------------------------------------------------------------- normalisasi & privasi
/** Huruf kecil, tanpa diakritik/tanda baca, spasi tunggal. */
export function normText(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Kunci idempoten: pertanyaan ternormalisasi. */
export const keyOf = (pertanyaan) => normText(pertanyaan);

const PII = [
  /(?:\+?62|\b0)[\s.-]?8\d[\d\s.-]{7,12}\d/, // telepon seluler
  /\b\d{16}\b/, // NIK
  /\b\d{3,}[\s.-]\d{3,}[\s.-]\d{3,}(?:[\s.-]\d+)?\b/, // nomor panjang bersekat (telepon/rekening)
  /\b(?:rek(?:ening)?|no\.?\s*rek|nik|npwp|ktp|kk)\b[^\n]{0,20}\d{6,}/i,
  /\b\d{9,}\b/, // deretan angka panjang (rekening/nomor identitas)
  /\b(?:jl|jln|jalan|gg|gang|perum|komplek|kompleks)\.?\s+[a-z]+[^\n]{0,40}\b(?:no\.?|nomor)\s*\d+/i, // alamat
  /\b(?:rt|rw)\s*\.?\s*\d{1,3}\s*[/,]?\s*(?:rt|rw)?\s*\.?\s*\d{0,3}\b[^\n]{0,30}\b(?:kel|kec|desa|kelurahan|kecamatan)\b/i,
  /[\w.+-]+@[\w-]+\.[\w.-]+/ // email
];

/** true bila teks tampak memuat data pribadi atau rahasia. */
export function hasPersonalData(text) {
  const t = String(text ?? "");
  return looksLikeSecret(t) || PII.some((re) => re.test(t));
}

const cleanField = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮]/g, "")
    .replace(/\[\[[^\]]*\]\]/g, "") // penanda internal bot tak boleh ikut
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Jawaban "a/b/c" -> ["a","b","c"] (alternatif yang sama-sama benar). */
export const alternatives = (jawaban) => String(jawaban ?? "").split("/").map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- penguraian baris
/** "kategori | pertanyaan | jawaban | petunjuk" -> objek atau null (baris rusak). */
export function parseAwalLine(line) {
  const raw = String(line ?? "").trim();
  if (!raw || raw.startsWith("#")) return null;
  const p = raw.split("|").map((x) => x.trim());
  if (p.length < 3 || !p[1] || !p[2]) return { error: "kolom kurang" };
  return { kategori: p[0], pertanyaan: p[1], jawaban: p[2], petunjuk: p.slice(3).join(" | ") };
}

/** "tanya | jawab [| petunjuk]" -> objek atau {error}. */
export function parseTanyaJawab(line) {
  const p = String(line ?? "").split("|").map((x) => x.trim());
  if (p.length < 2 || !p[0] || !p[1]) return { error: "format: pertanyaan | jawaban [| petunjuk]" };
  return { kategori: "", pertanyaan: p[0], jawaban: p[1], petunjuk: p.slice(2).join(" | ") };
}

/**
 * Isi pesan yang dikutip di grup -> {pertanyaan, jawaban, petunjuk} atau null.
 * Dikenali: "tanya | jawab", atau pertanyaan dengan baris "Jawaban: x" (termasuk format pesan bot sendiri).
 */
export function parseQuotedTebakan(text) {
  const t = String(text ?? "").replace(/\r/g, "").trim();
  if (!t) return null;
  if (t.includes("|")) {
    const r = parseTanyaJawab(t.replace(/\n+/g, " "));
    return r.error ? null : r;
  }
  const m = /^([\s\S]*?)\n?\s*(?:✅\s*)?jawaban(?:nya)?\s*[:=-]\s*([^\n]+)(?:\n[^\n]*?petunjuk\s*[:=-]\s*([^\n]+))?/i.exec(t);
  if (!m) return null;
  const pertanyaan = m[1].replace(/^[❓\s]+/, "").replace(/\s+/g, " ").trim();
  if (!pertanyaan || !m[2].trim()) return null;
  return { kategori: "", pertanyaan, jawaban: m[2].trim(), petunjuk: (m[3] || "").trim() };
}

// ---------------------------------------------------------------- pencocokan jawaban
const FILLER = new Set("ah oh eh wah nah lah deh dong sih nih ya yah kok loh itu ini adalah jawabannya jawaban kayaknya kayanya sepertinya mungkin pasti bukan apa si yang dari itulah tuh kali bos bot kak mas mbak om catat catet catatkan catetin tolong hampir hampiiir hampiir".split(" "));
const lev = (a, b) => {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
};
const squash = (s) => normText(s).replace(/(.)\1{2,}/g, "$1$1").replace(/\s+/g, "");
const rootOf = (w) => stemCandidates(w).reduce((a, b) => (b.length >= 4 && b.length < a.length ? b : a));

/** Tebakan satu alternatif jawaban vs. pesan -> "benar" | "hampir" | null. */
export function judgeOne(message, answer) {
  const ansTokens = normText(answer).split(" ").filter(Boolean);
  if (!ansTokens.length) return null;
  let words = normText(message).split(" ").filter(Boolean);
  if (!words.length) return null;
  const stripped = words.filter((w) => !FILLER.has(w));
  if (stripped.length) words = stripped;
  if (words.length > ansTokens.length + 4) return null; // kalimat panjang = bukan jawaban
  const target = ansTokens.join("");
  let best = Infinity;
  const n = ansTokens.length;
  for (let size = Math.max(1, n - 1); size <= n + 1; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      const cand = words.slice(i, i + size).join("");
      const d = cand === target ? 0 : squash(cand) === squash(target) ? 0 : lev(squash(cand), squash(target));
      // imbuhan: bandingkan juga batang kata ("menari" ~ "tari")
      const dRoot = size === n && n === 1 ? lev(rootOf(words[i]), rootOf(ansTokens[0])) : Infinity;
      best = Math.min(best, d, dRoot);
    }
  }
  const len = squash(answer).length;
  if (best === 0) return "benar";
  if (len >= 5 && best <= Math.max(1, Math.floor(len * 0.2))) return "benar"; // salah ketik ringan ("Kangturu" ~ "Kanguru")
  if (len >= 5 && best <= Math.ceil(len * 0.3)) return "hampir";
  // sebagian kata dari jawaban majemuk ("paus" untuk "paus biru") = hampir
  if (n > 1 && ansTokens.some((t) => t.length >= 4 && words.includes(t))) return "hampir";
  return null;
}

/** pesan vs. semua alternatif -> "benar" | "hampir" | null */
export function judgeAnswer(message, jawaban) {
  let res = null;
  for (const alt of alternatives(jawaban)) {
    const r = judgeOne(message, alt);
    if (r === "benar") return "benar";
    if (r === "hampir") res = "hampir";
  }
  return res;
}

// ---------------------------------------------------------------- perintah grup
const SAVE_RE = /^\s*(?:bot[,\s]+)?(?:tolong\s+|mohon\s+)?(?:simpan(?:kan)?|catat(?:kan)?|catet(?:in)?)(?:\s+(?:tebakan|tebak-?tebakan|teka-?teki))?(?:\s+(?:ini|itu|ya|dong|aja|saja|nih))*\s*[.!]*\s*$/i;
const START_RE = /(?:\btebak-?\s?tebakan\b|\bteka-?teki\b|\btebakan\b)/i;
const START_BLOCK_RE = /\b(?:simpan|catat|catet|hapus|daftar|tambah|usul)\b/i;
const GIVEUP_RE = /\b(?:nyerah|menyerah|aku\s+nyerah|nyerah\s+deh|jawabannya\s+apa|apa\s+jawabannya|apa\s+sih\s+jawabannya|kasih\s+tau\s+jawabannya|kasih\s+tahu\s+jawabannya|buka\s+jawabannya|bocorin\s+jawabannya|nggak\s+tau\s+jawabannya|gak\s+tau\s+jawabannya|ga\s+tau\s+jawabannya)\b/i;
const HINT_RE = /\b(?:petunjuk|clue|hint|bocoran|kasih\s+kode|minta\s+kode|kodenya)\b/i;

/**
 * Teks pesan (tanpa sapaan bot) -> {kind:"save"|"start"} atau null.
 * "save" hanya bila ada pesan yang dikutip; selebihnya biarkan ke jalur lain (jadwal, AI).
 */
export function parseGroupCommand(text, { quotedText = "" } = {}) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (SAVE_RE.test(t) && quotedText && parseQuotedTebakan(quotedText)) return { kind: "save" };
  if (START_RE.test(t) && !START_BLOCK_RE.test(t) && t.split(" ").length <= 9 && !/\?\s*$/.test(t.replace(/(?:dong|donk|nih|yuk)\??$/i, ""))) return { kind: "start" };
  return null;
}

// ---------------------------------------------------------------- toko
export async function openPengetahuan({ file, log = console, now = () => Date.now(), ttlMin = DEFAULT_TTL_MIN, maxNotes = 5000 } = {}) {
  let driver;
  try {
    driver = await loadDriver();
  } catch (e) {
    log.warn?.(`🎲 Gudang pengetahuan tidak aktif: ${e?.message || e}`);
    return null;
  }
  const target = file || ":memory:";
  if (target !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  const db = driver.open(target);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    create table if not exists pengetahuan (
      id integer primary key autoincrement,
      jenis text not null default 'tebakan',
      kategori text not null default '',
      pertanyaan text not null,
      jawaban text not null,
      petunjuk text not null default '',
      sumber text not null default 'telegram',
      grup text not null default '',
      dicatat_oleh text not null default '',
      status text not null default 'aktif',
      dibuat text not null,
      dipakai_n integer not null default 0,
      terakhir_dipakai text,
      kunci text not null,
      stem text not null default ''
    );
    create unique index if not exists pengetahuan_kunci on pengetahuan(kunci);
    create table if not exists tebakan_dipakai (grup text not null, id integer not null, at text not null, primary key (grup, id));
    create virtual table if not exists pengetahuan_fts using fts5(
      pertanyaan, stem, content='pengetahuan', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    create trigger if not exists pengetahuan_ai after insert on pengetahuan begin
      insert into pengetahuan_fts(rowid, pertanyaan, stem) values (new.id, new.pertanyaan, new.stem);
    end;
    create trigger if not exists pengetahuan_ad after delete on pengetahuan begin
      insert into pengetahuan_fts(pengetahuan_fts, rowid, pertanyaan, stem) values ('delete', old.id, old.pertanyaan, old.stem);
    end;
    create trigger if not exists pengetahuan_au after update of pertanyaan, stem on pengetahuan begin
      insert into pengetahuan_fts(pengetahuan_fts, rowid, pertanyaan, stem) values ('delete', old.id, old.pertanyaan, old.stem);
      insert into pengetahuan_fts(rowid, pertanyaan, stem) values (new.id, new.pertanyaan, new.stem);
    end;
  `);
  const iso = () => new Date(now()).toISOString();
  const st = {
    byKey: db.prepare("select id, status from pengetahuan where kunci = ?"),
    ins: db.prepare("insert into pengetahuan (jenis, kategori, pertanyaan, jawaban, petunjuk, sumber, grup, dicatat_oleh, status, dibuat, kunci, stem) values (?,?,?,?,?,?,?,?,?,?,?,?)"),
    get: db.prepare("select * from pengetahuan where id = ?"),
    del: db.prepare("delete from pengetahuan where id = ?"),
    setStatus: db.prepare("update pengetahuan set status = ? where id = ?"),
    count: db.prepare("select count(*) as n from pengetahuan"),
    byStatus: db.prepare("select * from pengetahuan where status = ? order by id desc limit ?"),
    list: db.prepare("select * from pengetahuan where status = 'aktif' order by id desc limit ? offset ?"),
    counts: db.prepare("select status, count(*) as n from pengetahuan group by status"),
    used: db.prepare("insert or ignore into tebakan_dipakai (grup, id, at) values (?,?,?)"),
    touch: db.prepare("update pengetahuan set dipakai_n = dipakai_n + 1, terakhir_dipakai = ? where id = ?"),
    pickFresh: db.prepare("select * from pengetahuan where status = 'aktif' and jenis = 'tebakan' and id not in (select id from tebakan_dipakai where grup = ?) order by dipakai_n asc, random() limit 1"),
    pickAny: db.prepare("select count(*) as n from pengetahuan where status = 'aktif' and jenis = 'tebakan'"),
    resetUsed: db.prepare("delete from tebakan_dipakai where grup = ?"),
    search: db.prepare(
      "select p.*, bm25(pengetahuan_fts) as skor from pengetahuan_fts join pengetahuan p on p.id = pengetahuan_fts.rowid where pengetahuan_fts match ? and p.status = 'aktif' order by skor limit 8"
    )
  };

  /**
   * Tambah satu catatan. status "aktif" | "menunggu". Hasil: {ok, id, status} | {ok:false, reason: "duplikat"|"kosong"|"pribadi"|"penuh", id?}
   */
  function add({ jenis = "tebakan", kategori = "", pertanyaan, jawaban, petunjuk = "" }, { sumber = "telegram", grup = "", oleh = "", status = "aktif" } = {}) {
    const row = {
      jenis: JENIS.includes(jenis) ? jenis : "tebakan",
      kategori: cleanField(kategori, MAX_LEN.kategori),
      pertanyaan: cleanField(pertanyaan, MAX_LEN.pertanyaan),
      jawaban: cleanField(jawaban, MAX_LEN.jawaban),
      petunjuk: cleanField(petunjuk, MAX_LEN.petunjuk)
    };
    if (!row.pertanyaan || !row.jawaban) return { ok: false, reason: "kosong" };
    if (String(pertanyaan).length > MAX_LEN.pertanyaan * 2 || String(jawaban).length > MAX_LEN.jawaban * 2) return { ok: false, reason: "terlalu_panjang" };
    if (hasPersonalData(`${row.pertanyaan} ${row.jawaban} ${row.petunjuk}`)) return { ok: false, reason: "pribadi" };
    const kunci = keyOf(row.pertanyaan);
    if (!kunci) return { ok: false, reason: "kosong" };
    const dup = st.byKey.get(kunci);
    if (dup) return { ok: false, reason: "duplikat", id: Number(dup.id) };
    if (Number(st.count.get().n) >= maxNotes) return { ok: false, reason: "penuh" };
    const r = st.ins.run(row.jenis, row.kategori, row.pertanyaan, row.jawaban, row.petunjuk, SUMBER.includes(sumber) ? sumber : "telegram", String(grup || "").slice(0, 120), String(oleh || "").slice(0, 60), status === "menunggu" ? "menunggu" : "aktif", iso(), kunci, stemText(`${row.pertanyaan} ${row.kategori}`));
    return { ok: true, id: Number(r.lastInsertRowid), status: status === "menunggu" ? "menunggu" : "aktif" };
  }

  /** Impor teks berformat berkas awal. Hasil {masuk, dilewati, rusak, pribadi} (dilewati = sudah ada). */
  function importLines(text, { sumber = "telegram", grup = "", oleh = "", format = "awal" } = {}) {
    const out = { masuk: 0, dilewati: 0, rusak: 0, pribadi: 0 };
    db.exec("begin");
    try {
      for (const line of String(text ?? "").replace(/\r/g, "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const p = format === "awal" ? parseAwalLine(trimmed) : parseTanyaJawab(trimmed);
        if (!p || p.error) {
          out.rusak++;
          continue;
        }
        const r = add(p, { sumber, grup, oleh });
        if (r.ok) out.masuk++;
        else if (r.reason === "duplikat") out.dilewati++;
        else if (r.reason === "pribadi") out.pribadi++;
        else out.rusak++;
      }
      db.exec("commit");
    } catch (e) {
      db.exec("rollback");
      throw e;
    }
    return out;
  }

  function importFile(file) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      return { error: `Berkas tidak terbaca: ${e?.code || e?.message || e}` };
    }
    return importLines(text, { sumber: "awal", format: "awal" });
  }

  const get = (id) => st.get.get(Number(id)) || null;
  const remove = (id) => st.del.run(Number(id)).changes > 0;
  const setStatus = (id, status) => st.setStatus.run(status, Number(id)).changes > 0;
  const pending = (limit = 20) => st.byStatus.all("menunggu", limit);
  const list = (limit = 20, offset = 0) => st.list.all(limit, offset);
  const counts = () => Object.fromEntries(st.counts.all().map((r) => [r.status, Number(r.n)]));

  /** Cari catatan aktif yang cocok dengan pertanyaan bebas: BM25 untuk kandidat, lalu ambang cakupan kata. null bila tak cukup cocok. */
  function lookup(question) {
    const tokens = tokenizeQuery(question);
    const stems = [...new Set(stemText(tokens.join(" ")).split(" ").filter(Boolean))];
    if (!stems.length) return null;
    const q = stems.slice(0, 40).map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    let rows;
    try {
      rows = st.search.all(q);
    } catch {
      return null;
    }
    const qSet = new Set(tokens.map((w) => rootOf(w)));
    for (const r of rows) {
      const rTokens = tokenizeQuery(r.pertanyaan).map(rootOf);
      const rSet = new Set(rTokens);
      const matched = [...qSet].filter((w) => rSet.has(w)).length;
      const cover = matched / Math.max(1, qSet.size);
      const coverNote = matched / Math.max(1, rSet.size);
      if (matched >= QA_MIN_MATCHED && cover >= 0.7 && coverNote >= 0.5) return r;
    }
    return null;
  }

  // ---------------------------------------------------------------- permainan
  const games = new Map(); // grup -> {acct, row, startedAt, hints, asker}
  const ttlMs = Math.max(1, Number(ttlMin) || DEFAULT_TTL_MIN) * 60_000;
  const activeGame = (grup) => {
    const g = games.get(grup);
    if (!g) return null;
    if (now() - g.startedAt > ttlMs) return null;
    return g;
  };

  const questionText = (row) => `🎲 Tebak-tebakan${row.kategori ? ` (${row.kategori})` : ""}:\n${row.pertanyaan}\n\nJawab langsung di grup ya. Ketik "petunjuk" kalau butuh bantuan atau "nyerah" untuk membuka jawabannya.`;
  const revealText = (row) => `✅ Jawaban: ${row.jawaban}`;
  const hintOf = (row) => (row.petunjuk ? `💡 Petunjuk: ${row.petunjuk}` : `💡 Petunjuk: jawabannya ${normText(alternatives(row.jawaban)[0]).replace(/\s/g, "").length} huruf, diawali "${alternatives(row.jawaban)[0][0]}".`);

  function expire(grup) {
    const g = games.get(grup);
    if (g && now() - g.startedAt > ttlMs) {
      games.delete(grup);
      return g;
    }
    return null;
  }

  /** Mulai tebakan baru di grup. Satu permainan aktif per grup. Hasil {reply} (atau {reply, started}). */
  function startGame(grup, { acct = "", asker = "" } = {}) {
    expire(grup);
    const cur = activeGame(grup);
    if (cur) return { reply: `Masih ada tebakan yang belum terjawab ya:\n${cur.row.pertanyaan}\n(ketik "nyerah" untuk membuka jawabannya)`, started: false };
    let row = st.pickFresh.get(grup);
    if (!row) {
      if (!Number(st.pickAny.get().n)) return { reply: "Gudang tebakan masih kosong. Pemilik bisa mengisinya lewat /tebak di Telegram.", started: false };
      st.resetUsed.run(grup); // semua sudah pernah keluar di grup ini: putar ulang dari awal
      row = st.pickFresh.get(grup);
    }
    st.used.run(grup, row.id, iso());
    st.touch.run(iso(), row.id);
    games.set(grup, { acct, row, startedAt: now(), hints: 0, asker });
    return { reply: questionText(row), started: true, id: Number(row.id) };
  }

  const stripLead = (t) => String(t ?? "").replace(/^\s*(?:bot[,\s]+)?(?:hampir+|hampiiir+)?[\s.,!…]*(?:tolong\s+)?(?:catat(?:kan)?|catet(?:in)?)\s*(?:ya|dong|nih)?\s*(?:bos|bro|kak)?\s*[,:\-–]?\s*/i, "");

  /**
   * Periksa satu pesan anggota terhadap permainan aktif di grup.
   * Hasil: null (tidak ada permainan / bukan jawaban -> jangan ganggu) atau {reply, finished}.
   * claimed: true bila pesan ini terjawab sebagai jawaban (pemanggil jangan lanjut ke "catat untuk pemilik"/AI).
   */
  function checkMessage(grup, text, { acct = "", name = "" } = {}) {
    const ex = expire(grup);
    if (ex) return { reply: `⌛ Waktu tebak-tebakan habis. ${revealText(ex.row)}`, finished: true, claimed: false, expired: true };
    const g = activeGame(grup);
    if (!g) return null;
    if (g.acct && acct && g.acct !== acct) return null; // hanya akun yang memulai yang menanggapi
    const raw = String(text ?? "").trim();
    if (!raw) return null;
    const body = stripLead(raw);
    if (GIVEUP_RE.test(raw)) {
      games.delete(grup);
      return { reply: `Yah, menyerah ya 😄\n${revealText(g.row)}`, finished: true, claimed: true };
    }
    if (HINT_RE.test(raw) && raw.split(/\s+/).length <= 6) {
      g.hints += 1;
      return { reply: hintOf(g.row), finished: false, claimed: true };
    }
    const verdict = judgeAnswer(body, g.row.jawaban);
    const who = name ? ` ${name}` : "";
    if (verdict === "benar") {
      games.delete(grup);
      return { reply: `🎉 Benar!${who ? ` Selamat${who}!` : ""}\n${revealText(g.row)}`, finished: true, claimed: true, winner: name };
    }
    if (verdict === "hampir") {
      g.hints += 1;
      return { reply: `Hampir!${who ? ` ${name.split(" ")[0]},` : ""} sedikit lagi 😉${g.hints >= 2 ? `\n${hintOf(g.row)}` : ""}`, finished: false, claimed: true };
    }
    return null;
  }

  function endGame(grup) {
    return games.delete(grup);
  }

  return {
    db,
    add,
    importLines,
    importFile,
    get,
    remove,
    setStatus,
    pending,
    list,
    counts,
    lookup,
    startGame,
    checkMessage,
    endGame,
    activeGame,
    hasGame: (grup) => games.has(grup), // termasuk yang baru kedaluwarsa dan belum dilaporkan
    parseGroupCommand,
    close: () => db.close?.()
  };
}

// ---------------------------------------------------------------- Telegram (/tebak) + alur grup
export const TEBAK_HELP = [
  "🎲 Gudang tebak-tebakan & pengetahuan:",
  "/tebak tambah <tanya> | <jawab> [| petunjuk]  — tambah satu (aktif)",
  "/tebak impor  + baris-baris \"tanya | jawab | petunjuk\"  — tambah banyak sekaligus",
  "/tebak impor-awal  — ulang impor dari data/tebakan-awal.txt (tidak menggandakan)",
  "/tebak daftar [halaman]  — catatan aktif   •   /tebak hapus <id>",
  "/tebak menunggu  — usulan dari grup (tombol Setujui/Tolak)",
  "Di grup: \"bot, tebak-tebakan dong\". Balas tebakan dengan \"simpan\" untuk menyimpan (usulan orang lain menunggu persetujuanmu)."
].join("\n");

const REASON = { duplikat: "sudah ada", kosong: "kosong", pribadi: "memuat data pribadi", terlalu_panjang: "terlalu panjang", penuh: "gudang penuh" };
const short = (s, n = 70) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const rowLine = (r) => `#${r.id} [${r.kategori || r.jenis}] ${short(r.pertanyaan)} → ${short(r.jawaban, 40)}${r.status !== "aktif" ? ` (${r.status})` : ""}`;

export function formatImport(r, title = "Impor") {
  return `📥 ${title}: ${r.masuk} masuk, ${r.dilewati} dilewati (sudah ada)${r.rusak ? `, ${r.rusak} baris rusak` : ""}${r.pribadi ? `, ${r.pribadi} ditolak (data pribadi)` : ""}.`;
}

/** Perintah Telegram (hanya pemilik; pemanggil sudah memeriksa). Hasil {text, markup?}. */
export function handleTebakCommand(store, arg, { awalFile } = {}) {
  if (!store) return { text: "Gudang tebakan belum aktif di bot ini." };
  const m = /^(\S+)?\s*([\s\S]*)$/.exec(String(arg ?? "").trim());
  const sub = (m[1] || "").toLowerCase();
  const rest = (m[2] || "").trim();
  if (!sub || sub === "bantuan" || sub === "help") {
    const c = store.counts();
    return { text: `${TEBAK_HELP}\n\nIsi gudang: ${c.aktif || 0} aktif, ${c.menunggu || 0} menunggu.` };
  }
  if (sub === "tambah") {
    const p = parseTanyaJawab(rest);
    if (p.error) return { text: `Format: /tebak tambah <pertanyaan> | <jawaban> [| petunjuk]` };
    const r = store.add(p, { sumber: "telegram", oleh: "pemilik" });
    return { text: r.ok ? `✅ Tersimpan #${r.id}.` : `Tidak disimpan: ${REASON[r.reason] || r.reason}${r.id ? ` (#${r.id})` : ""}.` };
  }
  if (sub === "impor") {
    if (!rest) return { text: "Tulis baris-barisnya setelah /tebak impor, satu per baris:\ntanya | jawab | petunjuk" };
    return { text: formatImport(store.importLines(rest, { sumber: "telegram", oleh: "pemilik", format: "tanya" })) };
  }
  if (sub === "impor-awal" || sub === "imporawal") {
    const r = store.importFile(awalFile);
    return { text: r.error ? `⚠️ ${r.error}` : formatImport(r, "Impor awal") };
  }
  if (sub === "daftar" || sub === "list") {
    const page = Math.max(1, Math.floor(Number(rest) || 1));
    const per = 15;
    const rows = store.list(per, (page - 1) * per);
    if (!rows.length) return { text: page > 1 ? "Tidak ada lagi catatan." : "Gudang masih kosong. Isi dengan /tebak tambah atau /tebak impor-awal." };
    const total = store.counts().aktif || 0;
    return { text: `🎲 Catatan aktif (${total}), halaman ${page}:\n${rows.map(rowLine).join("\n")}${total > page * per ? `\n\nBerikutnya: /tebak daftar ${page + 1}` : ""}` };
  }
  if (sub === "hapus") {
    const id = Number(rest.replace(/^#/, ""));
    if (!Number.isInteger(id) || id <= 0) return { text: "Format: /tebak hapus <id>" };
    return { text: store.remove(id) ? `🗑️ #${id} dihapus.` : `Tidak ada catatan #${id}.` };
  }
  if (sub === "menunggu" || sub === "usulan") {
    const rows = store.pending(10);
    if (!rows.length) return { text: "Tidak ada usulan yang menunggu." };
    return {
      text: `🕓 Usulan menunggu (${rows.length}):\n${rows.map((r) => `${rowLine(r)}\n   dari ${r.dicatat_oleh || "?"}${r.grup ? ` @ ${r.grup}` : ""}`).join("\n")}`,
      markup: rows.map((r) => [
        { text: `✅ Setujui #${r.id}`, callback_data: `tb:ok:${r.id}` },
        { text: `❌ Tolak #${r.id}`, callback_data: `tb:no:${r.id}` }
      ])
    };
  }
  return { text: TEBAK_HELP };
}

/** Tombol "tb:ok:<id>" / "tb:no:<id>" (tanpa awalan "tb:"). */
export function decideUsulan(store, data) {
  const m = /^(ok|no):(\d+)$/.exec(String(data ?? ""));
  if (!store || !m) return "";
  const row = store.get(Number(m[2]));
  if (!row) return `Usulan #${m[2]} sudah tidak ada.`;
  if (row.status !== "menunggu") return `Usulan #${row.id} sudah diproses (${row.status}).`;
  store.setStatus(row.id, m[1] === "ok" ? "aktif" : "ditolak");
  return m[1] === "ok" ? `✅ Usulan #${row.id} disetujui dan sekarang aktif.` : `❌ Usulan #${row.id} ditolak.`;
}

/**
 * Simpan dari grup: pesan yang dikutip -> catatan. Pemilik terverifikasi = aktif; orang lain = menunggu.
 * Hasil {reply, usulan?: row} (usulan = baris baru berstatus menunggu, untuk memberi tahu pemilik).
 */
export function saveFromGroup(store, quotedText, { isOwner = false, sender = "", grup = "" } = {}) {
  const p = parseQuotedTebakan(quotedText);
  if (!p) return { reply: "Format pesannya belum terbaca. Tulis \"pertanyaan | jawaban\" lalu balas dengan \"simpan\"." };
  const r = store.add(p, { sumber: "grup", grup, oleh: sender, status: isOwner ? "aktif" : "menunggu" });
  if (!r.ok) {
    if (r.reason === "pribadi") return { reply: "Tidak saya simpan: tampaknya memuat data pribadi (nomor, alamat, atau rekening)." };
    if (r.reason === "duplikat") return { reply: "Tebakan itu sudah ada di gudang 👍" };
    return { reply: `Tidak saya simpan: ${REASON[r.reason] || r.reason}.` };
  }
  if (isOwner) return { reply: `✅ Tersimpan di gudang (#${r.id}).` };
  return { reply: "Terima kasih, usulannya saya teruskan ke pemilik untuk disetujui dulu ya 🙏", usulan: store.get(r.id) };
}

export function usulanNotice(row) {
  return {
    text: `🕓 Usulan tebakan baru #${row.id} dari ${row.dicatat_oleh || "anggota grup"}${row.grup ? ` (${row.grup})` : ""}:\n${row.pertanyaan}\n→ ${row.jawaban}${row.petunjuk ? `\n💡 ${row.petunjuk}` : ""}`,
    markup: [[{ text: "✅ Setujui", callback_data: `tb:ok:${row.id}` }, { text: "❌ Tolak", callback_data: `tb:no:${row.id}` }]]
  };
}

/** Jawaban tanya-jawab dari gudang (tanpa menambah kalimat karangan), atau null bila tak cocok. */
export function answerFromStore(store, question) {
  const r = store?.lookup(question);
  if (!r) return null;
  const j = r.jawaban.split("/").map((x) => x.trim()).filter(Boolean).join(" / ");
  return r.jenis === "tebakan" ? `${r.pertanyaan}\nJawabannya: ${j}` : j;
}
