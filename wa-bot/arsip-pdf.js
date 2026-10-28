// ================================================================
// ARSIP PDF GRUP: PDF yang diunggah di grup WhatsApp diunduh, dibaca, dan disimpan PERMANEN di laptop (tanpa diminta),
// supaya pertanyaan berikutnya (tanpa melampirkan PDF) bisa dijawab dari arsip.
//
// Penyimpanan  : <ARSIP_DIR>/<sha256>.pdf (berkas asli) + <ARSIP_DIR>/indeks.sqlite (openKbIndex + tabel metadata).
// Dedup        : berdasarkan sha256 -- berkas yang sama dikirim lagi hanya menambah baris asal-usul, tanpa mengindeks ulang.
// Privasi      : - isi arsip hanya dicari dengan BM25 lokal. Dokumen diindeks dengan id 'local:arsip:<sha>' sehingga kb-index
//                  tidak pernah membuat/menerima vektor untuknya (tak mungkin sampai ke Jina atau layanan embedding mana pun);
//                - arsip suatu grup HANYA dipakai menjawab di grup yang sama (docIds per grup di setiap pencarian);
//                  pemilik (Telegram, /arsip) boleh mencari lintas grup.
// Tanpa jaringan: modul ini tidak mengimpor Baileys; pengunduhan & penyaringan pesan diurus index.js (download() dioper masuk).
// ================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openKbIndex, loadDriver, parsePageMarkers, coverageOf, tokenizeQuery } from "./kb-index.js";
import { pdfBufferToPages, isBroadRequest } from "./pdf-chat.js";
import { PDF_MAX_BYTES } from "./pdf-extract.js";

const FLAGS_ON = new Set(["1", "true", "ya", "on", "yes"]);
const FLAGS_OFF = new Set(["0", "false", "tidak", "off", "no"]);

/** ARSIP_ENABLED (bawaan true), ARSIP_DIR (bawaan arsip-dokumen), ARSIP_PEMBERITAHUAN (bawaan on). */
export function arsipConfig(env = process.env, baseDir = ".") {
  const flag = (v, dflt) => {
    const s = String(v ?? "").trim().toLowerCase();
    return FLAGS_ON.has(s) ? true : FLAGS_OFF.has(s) ? false : dflt;
  };
  const dirRaw = String(env.ARSIP_DIR ?? "").trim() || "arsip-dokumen";
  return { enabled: flag(env.ARSIP_ENABLED, true), dir: path.resolve(baseDir, dirRaw), notice: flag(env.ARSIP_PEMBERITAHUAN, true) };
}

export const ARSIP_NOTICE_TEXT = "PDF yang dibagikan di grup ini disimpan di komputer kantor agar bisa dibaca ulang. Mau dihapus? Hubungi pemilik bot.";

const SHA_RE = /^[0-9a-f]{64}$/;
const docIdOf = (sha) => `local:arsip:${sha}`;
const normWords = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---------------------------------------------------------------- pengenalan acuan dokumen dalam pertanyaan
const KIND_ALIASES = { permenkeu: "pmk", permen: "permen", perdirjen: "perdirjen" };
const REF_RE = /\b(kmk|pmk|permenkeu|permen|perpres|perdirjen|perban|kepmen|keppres|inpres|perda|pp|uu)\b[^\d\n]{0,12}?(\d{1,4})\b/gi;
const looksLikeYear = (n) => /^(19|20)\d\d$/.test(n);

/** "KMK 296/2026", "PMK nomor 32" -> [{ kind: "kmk", num: "296" }]. Angka tahun saja tidak dianggap nomor. */
export function refsOf(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(REF_RE)) {
    const kind = KIND_ALIASES[m[1].toLowerCase()] || m[1].toLowerCase();
    const num = String(Number(m[2]));
    if (looksLikeYear(m[2])) continue;
    if (!out.some((r) => r.kind === kind && r.num === num)) out.push({ kind, num });
  }
  return out;
}

function haystackMatchesRef(hay, { kind, num }) {
  const kinds = kind === "pmk" ? "(?:pmk|permenkeu)" : kind;
  const n = `0*${num}`;
  // "kmk 296", "kmk nomor 296", "296 kmk 05 2026" (hasil normalisasi "296/KMK.05/2026"): jarak paling jauh 3 kata
  return new RegExp(`\\b${kinds}\\s(?:\\w+\\s){0,3}${n}\\b|\\b${n}\\s(?:\\w+\\s){0,3}${kinds}\\b`).test(hay);
}

const GENERIC_NAME_WORDS = new Set("pdf file berkas dokumen peraturan tentang nomor no tahun salinan scan final revisi copy".split(" "));
const ASK_STOP = new Set("bot tolong dong ya yah nih sih aja saja yang dan di ke dari untuk dengan pada ini itu atau adalah akan bisa dalam oleh sebagai juga ada apa siapa kapan berapa mana kenapa mengapa bagaimana gimana tadi minta buka lihat baca cek cari".split(" "));
const ASK_GENERIC = new Set("peraturan aturan dokumen pdf berkas file pasal ayat lampiran ketentuan isi isinya".split(" "));
const DOC_ASK_RE = /\b(peraturan|aturan|dokumen|pdf|berkas|file|pasal|ayat|lampiran|ketentuan|kmk|pmk|permenkeu|permen|perpres|perdirjen|juknis|petunjuk teknis|surat edaran|dibagikan|diunggah)\b/i;

const distinctWords = (s, stop) => [...new Set(normWords(s).split(" ").filter((w) => w.length >= 3 && !stop.has(w)))];

// ---------------------------------------------------------------- modul
/**
 * deps:
 *   dir          folder arsip (wajib)
 *   state        { get(key), set(key, value) } -- penyimpanan status bot (bot_state); dipakai untuk "pemberitahuan sekali per grup"
 *   notice       false = tak pernah memberi pemberitahuan (ARSIP_PEMBERITAHUAN=off)
 *   maxBytes, maxPages, timeZone, now(), log
 *   openIndex / readPages / loadDb   -- bisa diganti saat tes
 */
export async function createArsip({ dir, state = null, notice = true, maxBytes = PDF_MAX_BYTES, maxPages = 300, timeZone = "Asia/Jakarta", now = () => new Date(), log = console, openIndex = openKbIndex, readPages = pdfBufferToPages, loadDb = loadDriver } = {}) {
  if (!dir) throw new Error("ARSIP_DIR kosong");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "indeks.sqlite");
  const silent = { log() {}, error() {} };
  const index = await openIndex({ file, log: silent });
  const driver = await loadDb();
  const db = driver.open(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    create table if not exists arsip_berkas (
      sha256 text primary key,
      nama text not null,
      ukuran integer not null,
      halaman integer,
      status text not null,
      catatan text,
      diarsipkan text not null
    );
    create table if not exists arsip_asal (
      id integer primary key,
      sha256 text,
      nama text not null,
      ukuran integer,
      status text not null,
      grup_jid text not null,
      grup_nama text,
      pengirim_nama text,
      pengirim_jid text,
      id_pesan text,
      waktu text not null,
      unique (grup_jid, id_pesan)
    );
    create index if not exists arsip_asal_sha on arsip_asal(sha256);
    create index if not exists arsip_asal_grup on arsip_asal(grup_jid);
  `);
  const q = {
    berkas: db.prepare("select * from arsip_berkas where sha256 = ?"),
    insBerkas: db.prepare("insert or replace into arsip_berkas (sha256, nama, ukuran, halaman, status, catatan, diarsipkan) values (?, ?, ?, ?, ?, ?, ?)"),
    delBerkas: db.prepare("delete from arsip_berkas where sha256 = ?"),
    asalPesan: db.prepare("select id from arsip_asal where grup_jid = ? and id_pesan = ?"),
    insAsal: db.prepare("insert or ignore into arsip_asal (sha256, nama, ukuran, status, grup_jid, grup_nama, pengirim_nama, pengirim_jid, id_pesan, waktu) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    updAsalStatus: db.prepare("update arsip_asal set status = ? where sha256 = ?"),
    delAsal: db.prepare("delete from arsip_asal where sha256 = ?"),
    asalOf: db.prepare("select * from arsip_asal where sha256 = ? order by waktu, id"),
    all: db.prepare("select * from arsip_berkas order by diarsipkan, sha256"),
    groupsSha: db.prepare("select distinct a.sha256 as sha from arsip_asal a join arsip_berkas b on b.sha256 = a.sha256 where a.grup_jid = ? and b.status = 'terindeks'")
  };

  const log2 = (...a) => log?.error?.(...a);
  let chain = Promise.resolve();
  const serial = (fn) => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };

  const filePath = (sha) => path.join(dir, `${sha}.pdf`);
  const fmtDate = (iso) => {
    try {
      return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone }).format(new Date(iso));
    } catch {
      return String(iso || "").slice(0, 10);
    }
  };

  // ------------------------------------------------------------ masuk
  /**
   * Arsipkan satu PDF dari grup. Tidak pernah melempar galat.
   * args: { download: () => Promise<Buffer>, fileName, size, groupJid, groupName, senderName, senderJid, messageId }
   * -> { status: "terindeks"|"scan"|"gagal"|"terlalu besar"|"duplikat-pesan", sha?, pages?, duplicate?, stored, firstForGroup }
   */
  function ingest(args) {
    return serial(() => ingestNow(args)).catch((e) => {
      log2("📦 [Arsip] gagal mengarsipkan:", e instanceof Error ? e.message : String(e));
      return { status: "gagal", stored: false, error: String(e?.message || e) };
    });
  }

  async function ingestNow({ download, fileName, size = 0, groupJid, groupName = "", senderName = "", senderJid = "", messageId = "" }) {
    const name = String(fileName || "dokumen.pdf").slice(0, 200);
    if (messageId && q.asalPesan.get(groupJid, messageId)) return { status: "duplikat-pesan", stored: false };
    const firstForGroup = !db.prepare("select 1 as x from arsip_asal where grup_jid = ? and sha256 is not null limit 1").get(groupJid);
    const waktu = now().toISOString();
    const addOrigin = (sha, status, sizeNow) => q.insAsal.run(sha, name, sizeNow ?? size, status, groupJid, groupName || null, senderName || null, senderJid || null, messageId || null, waktu);

    if (Number(size) > maxBytes) {
      addOrigin(null, "terlalu besar");
      return { status: "terlalu besar", stored: false, firstForGroup: false };
    }
    let buffer;
    try {
      buffer = await download();
    } catch (e) {
      addOrigin(null, "gagal", size);
      log2(`📦 [Arsip] unduh "${name}" gagal:`, e instanceof Error ? e.message : String(e));
      return { status: "gagal", stored: false, firstForGroup: false };
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      addOrigin(null, "gagal", size);
      return { status: "gagal", stored: false, firstForGroup: false };
    }
    if (buffer.length > maxBytes) {
      addOrigin(null, "terlalu besar", buffer.length);
      return { status: "terlalu besar", stored: false, firstForGroup: false };
    }
    const sha = crypto.createHash("sha256").update(buffer).digest("hex");
    const existing = q.berkas.get(sha);
    if (existing && existing.status !== "gagal") {
      // berkas yang sama: cukup tambah asal-usul (tanpa membaca/mengindeks ulang)
      addOrigin(sha, existing.status, existing.ukuran);
      return { status: existing.status, sha, pages: existing.halaman, duplicate: true, stored: true, firstForGroup };
    }
    const isPdf = buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    if (isPdf && !fs.existsSync(filePath(sha))) {
      const tmp = `${filePath(sha)}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, filePath(sha));
    }
    let status;
    let pagesTotal = null;
    let note = null;
    try {
      const r = await readPages(buffer, { maxPages });
      pagesTotal = r.total;
      if (r.scanned) {
        status = "scan"; // gambar saja: dicatat, tidak diindeks
        note = "hasil scan, tanpa teks";
      } else {
        index.upsertDoc({ id: docIdOf(sha), title: name.slice(0, 120), filename: name, pages: r.pages });
        status = "terindeks";
        if (r.truncated) note = `hanya ${r.pages.length} dari ${r.total} halaman diindeks`;
      }
    } catch (e) {
      status = "gagal";
      note = String(e?.kind || e?.message || e).slice(0, 120);
      log2(`📦 [Arsip] "${name}" tidak terbaca (${note})`);
    }
    q.insBerkas.run(sha, name, buffer.length, pagesTotal, status, note, waktu);
    q.updAsalStatus.run(status, sha); // asal-usul lama dari kiriman yang dulu gagal ikut diperbarui
    addOrigin(sha, status, buffer.length);
    return { status, sha, pages: pagesTotal, duplicate: Boolean(existing), stored: status !== "gagal" && isPdf, firstForGroup: firstForGroup && status !== "gagal" };
  }

  // ------------------------------------------------------------ pemberitahuan sekali per grup
  /** true = kirim pemberitahuan SEKARANG (belum pernah untuk grup ini). Tercatat dulu, jadi tak pernah dobel; gagal baca status = tidak kirim. */
  async function claimNotice(groupJid) {
    if (!notice || !state || !groupJid) return false;
    const key = `arsip_notice:${groupJid}`;
    try {
      if (await state.get(key)) return false;
      await state.set(key, now().toISOString());
      return true;
    } catch (e) {
      log2("📦 [Arsip] status pemberitahuan tak terbaca (dilewati):", e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  // ------------------------------------------------------------ baca
  const asalInGroup = (sha, groupJid) => {
    const rows = q.asalOf.all(sha);
    return (groupJid ? rows.filter((r) => r.grup_jid === groupJid) : rows)[0] || rows[0] || null;
  };

  /** Berkas terindeks milik satu grup (groupJid = null: semua grup, khusus pemilik). */
  function filesFor(groupJid = null) {
    const rows = q.all.all().filter((b) => b.status === "terindeks");
    if (!groupJid) return rows;
    const ok = new Set(q.groupsSha.all(groupJid).map((r) => r.sha));
    return rows.filter((b) => ok.has(b.sha256));
  }

  const pagesOf = (sha) => parsePageMarkers(index.getDocText(docIdOf(sha))).filter((p) => p.page != null).map((p) => ({ page: p.page, text: p.text }));

  const describe = (b, groupJid) => {
    const a = asalInGroup(b.sha256, groupJid);
    return { sha: b.sha256, name: b.nama, total: b.halaman || 0, sender: a?.pengirim_nama || "anggota grup", date: a ? fmtDate(a.waktu) : "", sharedAt: a?.waktu || "", groupName: a?.grup_nama || "", groupJid: a?.grup_jid || "", pages: pagesOf(b.sha256) };
  };

  /** BM25 lokal di arsip. groupJid wajib untuk pemakaian di grup; null = lintas grup (pemilik). Daftar docIds kosong -> tak ada hasil. */
  function search(question, { groupJid = null, budgetChars = 3500, maxChunks = 8 } = {}) {
    const docIds = filesFor(groupJid).map((b) => docIdOf(b.sha256));
    if (docIds.length === 0) return [];
    return index.search(question, { budgetChars, maxChunks, docIds, excludeLocal: false });
  }

  /**
   * Cari dokumen arsip GRUP INI yang dimaksud pertanyaan (tanpa PDF terlampir).
   * Urutan: (1) nomor peraturan ("KMK 296") dicocokkan ke nama berkas & halaman pertama; (2) nama berkas disebut;
   * (3) bila jelas bertanya soal dokumen, BM25 di arsip grup. Permintaan membandingkan -> sampai 2 dokumen.
   * -> { docs: [{ sha, name, total, sender, date, groupName, pages }], via } atau null.
   */
  function lookup(groupJid, question, { max = 2 } = {}) {
    const text = String(question ?? "").trim();
    if (!groupJid || !text) return null;
    const files = filesFor(groupJid);
    if (files.length === 0) return null;
    const picked = [];
    const add = (b) => {
      if (b && !picked.some((p) => p.sha256 === b.sha256)) picked.push(b);
    };
    const hayOf = (b) => normWords(`${b.nama} ${index.getDocText(docIdOf(b.sha256)).slice(0, 2500)}`);

    const refs = refsOf(text);
    let via = null;
    if (refs.length > 0) {
      for (const r of refs) {
        const hits = files.filter((b) => haystackMatchesRef(hayOf(b), r));
        hits.sort((a, b) => Number(haystackMatchesRef(normWords(b.nama), r)) - Number(haystackMatchesRef(normWords(a.nama), r))); // nama berkas cocok didahulukan
        add(hits[0]);
      }
      if (picked.length > 0) via = "nomor";
    }
    if (picked.length === 0) {
      const qNorm = ` ${normWords(text)} `;
      const qWords = new Set(distinctWords(text, ASK_STOP));
      const scored = [];
      for (const b of files) {
        const base = normWords(b.nama.replace(/\.pdf$/i, ""));
        const bw = distinctWords(base, GENERIC_NAME_WORDS);
        if (bw.length === 0) continue;
        const hit = bw.filter((w) => qWords.has(w)).length;
        const exact = base.length >= 6 && qNorm.includes(` ${base} `);
        if (exact || (hit >= 2 && hit / bw.length >= 0.5) || (bw.length === 1 && hit === 1 && bw[0].length >= 6)) scored.push({ b, s: exact ? 100 : hit });
      }
      scored.sort((a, b) => b.s - a.s);
      scored.slice(0, max).forEach((x) => add(x.b));
      if (picked.length > 0) via = "nama";
    }
    if (picked.length === 0 && DOC_ASK_RE.test(text)) {
      const tokens = tokenizeQuery(text).filter((w) => !ASK_STOP.has(w) && !ASK_GENERIC.has(w));
      if (tokens.length >= 2) {
        const blocks = search(tokens.join(" "), { groupJid, budgetChars: 3000, maxChunks: 6 });
        const need = Math.min(2, tokens.length);
        for (const bl of blocks) {
          if (coverageOf(bl.text, tokens) < need) continue;
          add(files.find((b) => docIdOf(b.sha256) === bl.docId));
          if (picked.length >= (isBroadRequest(text) ? 2 : 1)) break;
        }
        if (picked.length > 0) via = "isi";
      }
    }
    if (picked.length === 0) return null;
    return { docs: picked.slice(0, max).map((b) => describe(b, groupJid)), via };
  }

  // ------------------------------------------------------------ pemilik (Telegram /arsip)
  const mb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  function stats() {
    const rows = q.all.all();
    const asal = db.prepare("select * from arsip_asal").all();
    const byGroup = new Map();
    for (const a of asal) {
      if (!a.sha256) continue;
      const g = byGroup.get(a.grup_jid) || { jid: a.grup_jid, nama: a.grup_nama || a.grup_jid, shas: new Set() };
      g.shas.add(a.sha256);
      if (a.grup_nama) g.nama = a.grup_nama;
      byGroup.set(a.grup_jid, g);
    }
    const size = new Map(rows.map((b) => [b.sha256, b.ukuran]));
    const groups = [...byGroup.values()].map((g) => ({ jid: g.jid, nama: g.nama, files: g.shas.size, bytes: [...g.shas].reduce((n, s) => n + (size.get(s) || 0), 0) })).sort((a, b) => b.files - a.files);
    return {
      files: rows.length,
      bytes: rows.reduce((n, b) => n + b.ukuran, 0),
      indexed: rows.filter((b) => b.status === "terindeks").length,
      scan: rows.filter((b) => b.status === "scan").length,
      failed: rows.filter((b) => b.status === "gagal").length + asal.filter((a) => !a.sha256 && a.status === "gagal").length,
      tooBig: asal.filter((a) => a.status === "terlalu besar").length,
      groups
    };
  }

  function statusLine() {
    const s = stats();
    return `📦 Arsip PDF grup: ${s.files} berkas, ${mb(s.bytes)}${s.scan ? ` • ${s.scan} scan (tak diindeks)` : ""}${s.failed ? ` • ${s.failed} gagal` : ""}`;
  }

  /** Daftar bernomor (urutan tetap: lama -> baru). term = potongan nama grup atau nama berkas (opsional). */
  function list(term = "") {
    const t = normWords(term);
    const rows = q.all.all().map((b, i) => ({ no: i + 1, b, a: asalInGroup(b.sha256, null) }));
    return t ? rows.filter((r) => normWords(`${r.b.nama} ${q.asalOf.all(r.b.sha256).map((a) => a.grup_nama || "").join(" ")}`).includes(t)) : rows;
  }

  const rowLine = ({ no, b, a }) => `${no}. ${b.nama} — ${b.halaman ?? "?"} hlm, ${mb(b.ukuran)}, ${b.status}\n   ${a?.grup_nama || "grup ?"} • ${a?.pengirim_nama || "?"} • ${a ? fmtDate(a.waktu) : ""}`;

  const pending = new Map(); // chatId -> { sha, no, at }

  function remove(sha) {
    if (!SHA_RE.test(sha)) throw new Error("sha256 tidak valid");
    try {
      index.removeDoc(docIdOf(sha));
    } catch {
      /* belum terindeks */
    }
    q.delAsal.run(sha);
    q.delBerkas.run(sha);
    fs.rmSync(filePath(sha), { force: true });
  }

  /** Perintah /arsip: tanpa argumen = ringkasan; daftar [grup]; cari <kata>; hapus <no> [ya]. -> teks balasan */
  function handle(arg = "", { chatId = "", onRemove = null } = {}) {
    const a = String(arg ?? "").trim();
    const [cmd = "", ...restArr] = a.split(/\s+/);
    const rest = restArr.join(" ").trim();
    const c = cmd.toLowerCase();
    if (a === "" || c === "ringkasan" || c === "status") {
      const s = stats();
      if (s.files === 0 && s.tooBig === 0 && s.failed === 0) return "📦 Arsip PDF grup masih kosong. PDF yang dibagikan di grup akan tersimpan otomatis di sini.";
      const lines = [`📦 Arsip PDF grup: ${s.files} berkas, ${mb(s.bytes)}`, `Terindeks ${s.indexed} • scan (tak diindeks) ${s.scan} • gagal ${s.failed} • terlalu besar ${s.tooBig}`];
      if (s.groups.length) lines.push("", "Per grup:", ...s.groups.map((g) => `• ${g.nama}: ${g.files} berkas, ${mb(g.bytes)}`));
      lines.push("", "/arsip daftar [grup] • /arsip cari <kata> • /arsip hapus <no>");
      return lines.join("\n");
    }
    if (c === "daftar" || c === "list" || c === "ls") {
      const rows = list(rest);
      if (rows.length === 0) return rest ? `Tidak ada berkas arsip yang cocok dengan "${rest}".` : "📦 Arsip masih kosong.";
      const lines = rows.slice(0, 30).map(rowLine);
      if (rows.length > 30) lines.push(`… dan ${rows.length - 30} lainnya (persempit dengan nama grup: /arsip daftar <grup>)`);
      return [`📦 ${rows.length} berkas:`, ...lines].join("\n");
    }
    if (c === "cari" || c === "find") {
      if (!rest) return "Tulis kata kuncinya: /arsip cari <kata>";
      const blocks = search(rest, { groupJid: null, budgetChars: 4000, maxChunks: 8 });
      const byName = list(rest).slice(0, 5);
      if (blocks.length === 0 && byName.length === 0) return `🔎 Tidak ada yang cocok dengan "${rest}" di arsip.`;
      const out = [`🔎 Hasil untuk "${rest}":`];
      for (const r of byName) out.push(`📄 ${rowLine(r)}`);
      const seen = new Set();
      for (const bl of blocks.slice(0, 6)) {
        const b = q.berkas.get(String(bl.docId).replace(/^local:arsip:/, ""));
        if (!b) continue;
        const no = list().find((r) => r.b.sha256 === b.sha256)?.no;
        const key = `${b.sha256}#${bl.page}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = asalInGroup(b.sha256, null);
        out.push(`• [${no}] ${b.nama}${bl.page != null ? `, hlm ${bl.page}` : ""} (${a?.grup_nama || "grup ?"}): ${bl.text.replace(/^\[Halaman \d+\]\s*/, "").replace(/\s+/g, " ").slice(0, 160)}…`);
      }
      return out.join("\n");
    }
    if (c === "hapus" || c === "delete" || c === "rm") {
      const m = /^(\d+)(?:\s+(ya|yes|y))?$/i.exec(rest);
      if (!m) return "Pakai nomor dari /arsip daftar: /arsip hapus <no>";
      const no = Number(m[1]);
      const row = list().find((r) => r.no === no);
      if (!row) return `Tidak ada berkas bernomor ${no}. Lihat /arsip daftar.`;
      if (!m[2]) {
        pending.set(String(chatId), { sha: row.b.sha256, no, at: Date.now() });
        return `⚠️ Hapus PERMANEN berkas asli, indeks, dan catatannya?\n${rowLine(row)}\n\nKetik: /arsip hapus ${no} ya`;
      }
      const p = pending.get(String(chatId));
      if (!p || p.sha !== row.b.sha256 || Date.now() - p.at > 5 * 60_000) return `Konfirmasi kedaluwarsa atau nomornya bergeser. Ulangi: /arsip hapus ${no}`;
      pending.delete(String(chatId));
      remove(row.b.sha256);
      try {
        onRemove?.(row.b.sha256);
      } catch {
        /* abaikan */
      }
      return `🗑️ Dihapus: ${row.b.nama} (berkas asli, indeks, dan catatan asal-usulnya). Nomor di daftar bergeser.`;
    }
    return "Perintah arsip: /arsip • /arsip daftar [grup] • /arsip cari <kata> • /arsip hapus <no>";
  }

  function close() {
    try {
      db.close();
    } catch {
      /* abaikan */
    }
    index.close?.();
  }

  return { ingest, claimNotice, filesFor, lookup, search, stats, statusLine, list, handle, remove, close, index, dir, noticeText: ARSIP_NOTICE_TEXT, fileOf: filePath };
}

/** Catatan untuk prompt: cara mengutip dokumen arsip. docs = hasil lookup().docs */
export function arsipCitationNote(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return "";
  const list = docs.map((d) => `"${String(d.name).slice(0, 80)}" (dibagikan ${d.sender}${d.date ? ` tgl ${d.date}` : ""}${d.total ? `, ${d.total} halaman` : ""})`).join("; ");
  const ex = docs[0];
  return (
    `\n\nARSIP PDF GRUP: dokumen yang dimaksud penanya tidak dilampirkan, tetapi tersimpan di arsip grup ini: ${list}. ` +
    `Jawab hanya dari isinya. Tutup jawaban dengan sitasi berformat persis: "(dari ${String(ex.name).slice(0, 60)}, dibagikan ${ex.sender}${ex.date ? ` tgl ${ex.date}` : ""}, hlm N)" -- N = nomor halaman yang tertulis [Halaman n] di blok. ` +
    `Kalau memakai dua dokumen, sitasi masing-masing terpisah.`
  );
}
