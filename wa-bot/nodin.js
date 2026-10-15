// Konsep Nota Dinas "Penyampaian Laporan Pertanggungjawaban Bendahara Pengeluaran" bulanan.
//
// Templat Word (templates/nota-dinas-lpj.docx) memuat penanda:
//   [Bulan_Laporan]  [Tahun_Laporan]  -> diisi bot (bulan SEBELUM tanggal surat: surat 1 November -> Oktober 2026)
//   [Nomor_ND]       [Tanggal_ND]     -> SENGAJA dibiarkan; diisi sistem persuratan saat naskah dibuat
// QR tanda tangan tidak ada di konsep (dibuat sistem persuratan di atas tulisan "Ditandatangani secara elektronik").
//
// Tiap tanggal 1 (pukul NODIN_TIME) bot mengirim konsep (PDF + Word) ke pemilik lewat WhatsApp dan Telegram.
// Terlewat (bot mati)? Dikejar sampai NODIN_LATE_DAYS hari. Manual kapan saja: /nodin, /nodin november, /nodin oktober 2026.
//
// PDF dibuat LibreOffice (perintah soffice/libreoffice, tanpa tampilan). Tidak ada? Word saja yang dikirim.
//
// Konfigurasi (.env, semua opsional):
//   NODIN_ENABLED=true  NODIN_DAY=1  NODIN_TIME=07:00  NODIN_LATE_DAYS=5
//   NODIN_TEMPLATE=/jalur/ke/templat.docx   NODIN_SOFFICE=/usr/bin/soffice   NODIN_PDF=true

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readZip } from "./zip-lite.js";
import { tzParts } from "./reminders.js";

export const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const PH_BULAN = "[Bulan_Laporan]";
export const PH_TAHUN = "[Tahun_Laporan]";
export const STATE_KEY = "nodin_last";

export const MONTH_WORDS = {
  januari: 1, jan: 1, februari: 2, feb: 2, pebruari: 2, maret: 3, mar: 3, april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  agustus: 8, agu: 8, agt: 8, ags: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, nop: 11, desember: 12, des: 12
};

// ---------------------------------------------------------------- konfigurasi & periode (murni)
const bool = (v, d) => (v === undefined || v === "" ? d : !/^(false|0|no|tidak|mati|off)$/i.test(String(v).trim()));

export function readNodinConfig(env = process.env, botDir = ".") {
  const tm = String(env.NODIN_TIME || "07:00").match(/^(\d{1,2})[:.](\d{2})$/);
  const hour = tm && Number(tm[1]) < 24 && Number(tm[2]) < 60 ? Number(tm[1]) : 7;
  const minute = tm && Number(tm[1]) < 24 && Number(tm[2]) < 60 ? Number(tm[2]) : 0;
  const day = Number(env.NODIN_DAY);
  const late = Number(env.NODIN_LATE_DAYS);
  return {
    enabled: bool(env.NODIN_ENABLED, true),
    day: Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1,
    hour,
    minute,
    lateDays: Number.isInteger(late) && late >= 1 && late <= 27 ? late : 5,
    template: env.NODIN_TEMPLATE ? path.resolve(env.NODIN_TEMPLATE) : path.join(botDir, "templates", "nota-dinas-lpj.docx"),
    soffice: String(env.NODIN_SOFFICE || "").trim(),
    pdf: bool(env.NODIN_PDF, true)
  };
}

/** Bulan sebelum (y, m) -> { y, m }. */
export function previousMonth(y, m) {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}
export const periodKey = (p) => `${p.y}-${String(p.m).padStart(2, "0")}`;
export const periodLabel = (p) => `${BULAN[p.m - 1]} ${p.y}`;
/** Bulan laporan untuk surat bertanggal "sekarang": bulan sebelumnya. */
export const defaultPeriod = (nowParts) => previousMonth(nowParts.y, nowParts.m);
/** Tanggal surat yang lazim untuk laporan bulan p: tanggal 1 bulan berikutnya. */
export function letterMonth(p) {
  return p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 };
}

/** "/nodin [bulan] [tahun]" (alias /notadinas) -> { arg } atau null. */
export function parseNodinCommand(text) {
  const m = String(text ?? "")
    .trim()
    .match(/^[/!](nodin|notadinas)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return m ? { arg: String(m[2] || "").trim() } : null;
}

/**
 * Argumen perintah -> { kind: "default" | "status" | "period" | "error", period?, error? }.
 * Bulan tanpa tahun: tahun berjalan; bila bulan itu belum lewat (mis. "desember" di bulan Oktober), tahun lalu.
 */
export function parseNodinArg(arg, nowParts) {
  const text = String(arg || "").trim().toLowerCase();
  if (!text) return { kind: "default", period: defaultPeriod(nowParts) };
  if (/^(status|info|jadwal)$/.test(text)) return { kind: "status" };
  if (/^(cek|periksa|diagnosa|tes|test)$/.test(text)) return { kind: "check" };
  let month = 0;
  let year = 0;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})$/);
  const num = text.match(/^(\d{1,2})[-/\s](\d{4})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
  } else if (num) {
    month = Number(num[1]);
    year = Number(num[2]);
  } else {
    const toks = text.split(/[\s,/-]+/).filter(Boolean);
    for (const t of toks) {
      if (MONTH_WORDS[t]) month = MONTH_WORDS[t];
      else if (/^\d{4}$/.test(t)) year = Number(t);
      else if (/^\d{1,2}$/.test(t) && !month) month = Number(t);
      else return { kind: "error", error: `Tidak mengerti "${t}". Contoh: /nodin, /nodin november, /nodin oktober 2026, /nodin status` };
    }
  }
  if (!(month >= 1 && month <= 12)) return { kind: "error", error: "Bulan tidak dikenal. Contoh: /nodin oktober 2026 (atau /nodin 10 2026)" };
  if (!year) year = month <= nowParts.m ? nowParts.y : nowParts.y - 1;
  if (year < 2000 || year > 2100) return { kind: "error", error: "Tahun tidak masuk akal (2000-2100)." };
  return { kind: "period", period: { y: year, m: month } };
}

// ---------------------------------------------------------------- Word: isi penanda
const xmlEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlUnescape = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Word kadang memecah satu penanda ke beberapa <w:r> saat templat disunting. Untuk paragraf yang mengandung penanda
 * tetapi tidak ada satu <w:t> pun yang memuatnya utuh, seluruh teks paragraf digabung ke <w:t> pertama
 * (gaya huruf campuran di paragraf itu hilang; paragraf lain tidak disentuh).
 */
export function repairSplitPlaceholders(xml, placeholders = [PH_BULAN, PH_TAHUN]) {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => {
    const ts = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    if (ts.length < 2) return p;
    const joined = ts.map((t) => xmlUnescape(t[1])).join("");
    const needs = placeholders.some((ph) => joined.includes(ph) && !ts.some((t) => xmlUnescape(t[1]).includes(ph)));
    if (!needs) return p;
    let first = true;
    return p.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g, (_m, attrs) => {
      if (first) {
        first = false;
        return `<w:t xml:space="preserve">${xmlEscape(joined)}</w:t>`;
      }
      return `<w:t${attrs || ""}></w:t>`;
    });
  });
}

/** Isi [Bulan_Laporan] & [Tahun_Laporan] di templat .docx (Buffer) -> Buffer .docx baru. [Nomor_ND]/[Tanggal_ND] tidak disentuh. */
export function fillDocx(templateBuf, { bulan, tahun }) {
  const entries = readZip(templateBuf);
  const out = [];
  let replaced = 0;
  for (const e of entries) {
    if (e.isDir) continue;
    let data = e.read();
    if (/^(word\/[^/]+|docProps\/[^/]+)\.xml$/.test(e.name)) {
      let xml = data.toString("utf8");
      if (e.name === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(e.name)) xml = repairSplitPlaceholders(xml);
      const n = xml.split(PH_BULAN).length - 1;
      replaced += n;
      xml = xml.split(PH_BULAN).join(xmlEscape(bulan)).split(PH_TAHUN).join(xmlEscape(String(tahun)));
      data = Buffer.from(xml, "utf8");
    }
    out.push({ name: e.name, data });
  }
  if (replaced === 0) throw new Error(`Templat tidak memuat penanda ${PH_BULAN}. Pasang templat yang benar di folder templates/ (atau NODIN_TEMPLATE).`);
  return buildZip(out);
}

// ---------------------------------------------------------------- penulis ZIP minimal (deflate), tanpa dependensi
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data: Buffer }] -> Buffer zip. [Content_Types].xml dipindah ke depan (disukai Word). */
export function buildZip(entries, date = new Date()) {
  const list = [...entries].sort((a, b) => (a.name === "[Content_Types].xml" ? -1 : b.name === "[Content_Types].xml" ? 1 : 0));
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of list) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cen.writeUInt16LE(dosTime, 12);
    cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const cenBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(list.length, 8);
  eocd.writeUInt16LE(list.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cenBuf, eocd]);
}

// ---------------------------------------------------------------- PDF lewat LibreOffice
function run(cmd, args, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || "").slice(0, 300);
        return reject(err);
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

/** Cari perintah LibreOffice yang bisa dijalankan. -> string (perintah) atau "" bila tidak ada. */
export async function findSoffice(preferred = "", exec = run) {
  for (const cmd of [preferred, "soffice", "libreoffice"].filter(Boolean)) {
    try {
      await exec(cmd, ["--version"], { timeoutMs: 20_000 });
      return cmd;
    } catch {
      /* coba berikutnya */
    }
  }
  return "";
}

/**
 * Folder kerja untuk konversi, dicoba berurutan. LibreOffice hasil "snap" (bawaan banyak Ubuntu) berjalan terkurung: ia TIDAK
 * bisa membaca /tmp milik kita dan tidak bisa masuk folder tersembunyi (awalan titik), sehingga "selesai" tanpa membuat PDF.
 * Karena itu folder biasa di dalam folder bot / folder rumah dicoba sebagai cadangan.
 */
export function defaultWorkDirs() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [os.tmpdir(), path.join(here, "nodin-tmp"), path.join(os.homedir(), "nodin-tmp")];
}

const oneLine = (t, n = 160) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);

/** .docx (Buffer) -> .pdf (Buffer). Memakai profil LibreOffice sementara supaya tidak bentrok dengan LibreOffice yang sedang terbuka. */
export async function docxToPdf(docxBuf, { soffice, exec = run, timeoutMs = 120_000, baseDirs = defaultWorkDirs(), ext = "docx" } = {}) {
  const problems = [];
  // Percobaan kedua di folder yang sama memaksa penyaring impor Word, bila LibreOffice gagal mengenali berkasnya.
  const variants = ext === "docx" ? [[], ["--infilter=MS Word 2007 XML"]] : [[]];
  for (const base of baseDirs) {
    for (const extra of variants) {
      let dir = "";
      try {
        fs.mkdirSync(base, { recursive: true });
        dir = fs.mkdtempSync(path.join(base, "nodin-"));
        const input = path.join(dir, `nota.${ext}`);
        fs.writeFileSync(input, docxBuf);
        const profile = `file://${path.join(dir, "profil").split(path.sep).join("/")}`;
        const r = await exec(soffice, [`-env:UserInstallation=${profile}`, "--headless", "--norestore", ...extra, "--convert-to", "pdf", "--outdir", dir, input], { timeoutMs });
        const out = path.join(dir, "nota.pdf");
        if (fs.existsSync(out)) return fs.readFileSync(out);
        const said = oneLine(`${r?.stdout || ""} ${r?.stderr || ""}`);
        problems.push(`${base}${extra.length ? " (penyaring Word)" : ""}: PDF tidak terbentuk${said ? ` (${said})` : ""}`);
      } catch (e) {
        problems.push(`${base}: ${oneLine(e?.stderr || e?.message || e)}`);
      } finally {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  const all = problems.join(" | ");
  const hint = /no export filter|writer|could not be loaded/i.test(all)
    ? "Komponen Writer LibreOffice kemungkinan belum terpasang/rusak (ketik /nodin cek untuk pemeriksaan)"
    : "Ketik /nodin cek untuk pemeriksaan LibreOffice";
  throw new Error(`${hint}. Rincian: ${all}`.slice(0, 420));
}

// ---------------------------------------------------------------- layanan
const sizeKb = (b) => `${Math.max(1, Math.round(b.length / 1024))} KB`;

/**
 * deps: { state: {get,set}, sendFiles(files, caption) -> Promise (kirim ke pemilik), send(text) -> Promise,
 *         timeZone, tzLabel, now(), log, convert(docxBuf)->Promise<Buffer> (opsional; bawaan LibreOffice), soffice }
 */
export function createNodin({ config, state, sendFiles, send, timeZone = "Asia/Jakarta", tzLabel = "WIB", now = () => Date.now(), log = console, convert = null, soffice = "", exec = run } = {}) {
  let sofficeCmd = soffice;
  let detected = Boolean(soffice) || Boolean(convert);
  let running = false;
  const attempts = new Map(); // "periode|tanggal" -> { n, nextAt }

  async function detect() {
    if (!detected) {
      sofficeCmd = await findSoffice(config.soffice, exec);
      detected = true;
    }
    return sofficeCmd;
  }

  const nowParts = () => tzParts(now(), timeZone);

  function readTemplate() {
    if (!fs.existsSync(config.template)) throw new Error(`Templat tidak ditemukan: ${config.template}`);
    return fs.readFileSync(config.template);
  }

  /** Buat berkas untuk satu periode. -> { name, label, files: [{name, data, mime}], pdfError } */
  async function generate(period) {
    const label = periodLabel(period);
    const docx = fillDocx(readTemplate(), { bulan: BULAN[period.m - 1], tahun: period.y });
    const base = `Konsep_ND_LPJ_Bendahara_${BULAN[period.m - 1]}_${period.y}`;
    const files = [];
    let pdfError = "";
    if (config.pdf) {
      try {
        const cmd = convert ? "" : await detect();
        if (!convert && !cmd) throw new Error("LibreOffice tidak ditemukan di laptop (pasang: sudo apt install libreoffice-writer)");
        const pdf = convert ? await convert(docx) : await docxToPdf(docx, { soffice: cmd, exec });
        files.push({ name: `${base}.pdf`, data: pdf, mime: "application/pdf" });
      } catch (e) {
        pdfError = String(e?.stderr || e?.message || e).slice(0, 420);
      }
    }
    files.push({ name: `${base}.docx`, data: docx, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    return { label, base, files, pdfError };
  }

  function captionFor(period, auto) {
    const lm = letterMonth(period);
    return [
      `📄 *Konsep Nota Dinas LPJ Bendahara Pengeluaran*`,
      `Bulan laporan: *${periodLabel(period)}*${auto ? ` (untuk surat tanggal 1 ${BULAN[lm.m - 1]} ${lm.y})` : ""}`,
      `Penanda ${"`[Nomor_ND]`"} dan ${"`[Tanggal_ND]`"} sengaja dibiarkan untuk diisi sistem persuratan; QR tanda tangan ditambahkan sistem.`
    ].join("\n");
  }

  /** Untuk perintah /nodin. -> { ok, text, caption?, files? } */
  async function compose(arg = "") {
    const cmd = parseNodinArg(arg, nowParts());
    if (cmd.kind === "error") return { ok: false, text: cmd.error };
    if (cmd.kind === "status") return { ok: true, text: await status() };
    if (cmd.kind === "check") return { ok: true, text: await diagnose() };
    const r = await generate(cmd.period);
    const caption = [captionFor(cmd.period, cmd.kind === "default"), r.pdfError ? `⚠️ PDF tidak dibuat (${r.pdfError}). Word tetap dikirim; buka dan ekspor ke PDF dari Word/LibreOffice.` : ""].filter(Boolean).join("\n");
    return { ok: true, text: `${caption}\n${r.files.map((f) => `• ${f.name} (${sizeKb(f.data)})`).join("\n")}`, caption, files: r.files };
  }

  /** /nodin cek: periksa LibreOffice di laptop dan coba ubah dua berkas (Word & teks biasa) jadi PDF; hasilnya dijelaskan. */
  async function diagnose() {
    const lines = ["🔎 *Pemeriksaan PDF nota dinas*"];
    const cmd = await findSoffice(config.soffice, exec);
    sofficeCmd = cmd;
    detected = true;
    if (!cmd) {
      lines.push("❌ LibreOffice tidak ditemukan (perintah soffice/libreoffice tidak ada).", "Pasang di laptop: sudo apt install libreoffice-writer");
      return lines.join("\n");
    }
    let where = cmd;
    try {
      const w = oneLine((await exec("which", [cmd], { timeoutMs: 10_000 })).stdout);
      if (w) where = fs.realpathSync(w);
    } catch {
      /* biarkan nama perintah */
    }
    let version = "?";
    try {
      version = oneLine((await exec(cmd, ["--version"], { timeoutMs: 30_000 })).stdout, 80) || "?";
    } catch {
      /* abaikan */
    }
    let writer = "tidak diketahui";
    try {
      const d = (await exec("dpkg", ["-s", "libreoffice-writer"], { timeoutMs: 10_000 })).stdout;
      writer = /Status:\s*install ok installed/.test(d) ? "terpasang" : "TIDAK terpasang";
    } catch {
      writer = "TIDAK terpasang lewat apt (atau bukan sistem apt)";
    }
    lines.push(`• Perintah: ${where}${/\/snap\//.test(where) ? " (versi snap)" : ""}`, `• Versi: ${version}`, `• Paket libreoffice-writer: ${writer}`);
    const attempt = async (buf, ext) => {
      try {
        const pdf = await docxToPdf(buf, { soffice: cmd, exec, ext, timeoutMs: 90_000 });
        return { ok: true, note: `${sizeKb(pdf)}` };
      } catch (e) {
        return { ok: false, note: oneLine(String(e?.message || e).replace(/^.*?Rincian:\s*/, ""), 260) };
      }
    };
    const a = await attempt(fillDocx(readTemplate(), { bulan: "Oktober", tahun: 2026 }), "docx");
    const b = await attempt(Buffer.from("Tes PDF nota dinas.\n"), "txt");
    lines.push(`• Uji ubah Word ke PDF: ${a.ok ? `✅ berhasil (${a.note})` : `❌ gagal (${a.note})`}`, `• Uji ubah teks biasa ke PDF: ${b.ok ? `✅ berhasil (${b.note})` : `❌ gagal (${b.note})`}`);
    if (a.ok) lines.push("", "✅ PDF bisa dibuat. Bot akan mengirim PDF + Word.");
    else if (!b.ok) lines.push("", "Dua-duanya gagal, jadi LibreOffice-nya yang bermasalah (Writer belum terpasang/rusak atau LibreOffice tidak bisa jalan tanpa tampilan).", "Di laptop kantor jalankan: sudo apt install --reinstall libreoffice-writer libreoffice-core", "Lalu ketik /nodin cek lagi. Sementara itu bot tetap mengirim Word.");
    else lines.push("", "Teks biasa berhasil tetapi Word gagal. Kirim pesan ini ke saya untuk dicarikan penyebabnya. Sementara itu bot tetap mengirim Word.");
    return lines.join("\n");
  }

  const timeText = () => `${String(config.hour).padStart(2, "0")}.${String(config.minute).padStart(2, "0")} ${tzLabel}`;

  function describe() {
    if (!config.enabled) return "mati (NODIN_ENABLED=false)";
    const tpl = fs.existsSync(config.template) ? "templat ada" : "TEMPLAT TIDAK ADA";
    return `AKTIF (tiap tanggal ${config.day} pukul ${timeText()}, laporan bulan sebelumnya; ${tpl}; PDF: ${config.pdf ? (sofficeCmd ? `LibreOffice (${sofficeCmd})` : detected ? "LibreOffice TIDAK ada, Word saja" : "memeriksa LibreOffice") : "mati"}; /nodin untuk sekarang)`;
  }

  async function status() {
    await detect().catch(() => {});
    const p = nowParts();
    const due = defaultPeriod(p);
    let last = null;
    try {
      last = await state.get(STATE_KEY);
    } catch {
      /* abaikan */
    }
    return [
      "📄 *Konsep Nota Dinas LPJ Bendahara*",
      `Jadwal: ${config.enabled ? `otomatis tiap tanggal ${config.day} pukul ${timeText()}` : "otomatis MATI"}; bila terlewat dikejar sampai tanggal ${config.day + config.lateDays - 1}.`,
      `Laporan bulan ini (bulan sebelumnya): ${periodLabel(due)}. Terakhir terkirim otomatis: ${last ? periodLabel({ y: Number(last.slice(0, 4)), m: Number(last.slice(5, 7)) }) : "belum pernah"}.`,
      `Templat: ${fs.existsSync(config.template) ? "ada" : "TIDAK ADA"} (${path.basename(config.template)}). PDF: ${config.pdf ? (sofficeCmd ? "bisa (LibreOffice)" : "TIDAK bisa (LibreOffice tidak ditemukan), Word saja") : "dimatikan"}.`,
      "Manual: /nodin (bulan lalu), /nodin november, /nodin oktober 2026, /nodin cek (periksa PDF)"
    ].join("\n");
  }

  /** Dipanggil tiap menit. Mengirim konsep sekali per bulan laporan pada/sesudah NODIN_DAY. true = ada yang terkirim. */
  async function check() {
    if (!config.enabled || running) return false;
    const p = nowParts();
    if (p.d < config.day || p.d >= config.day + config.lateDays) return false;
    if (p.d === config.day && p.h * 60 + p.mi < config.hour * 60 + config.minute) return false;
    const period = defaultPeriod(p);
    const key = periodKey(period);
    let last = null;
    try {
      last = await state.get(STATE_KEY);
    } catch {
      return false; // basis data belum bisa dibaca: coba lagi menit berikutnya, jangan kirim dobel
    }
    if (last === key) return false;
    const tryKey = `${key}|${p.y}-${p.m}-${p.d}`;
    const a = attempts.get(tryKey) || { n: 0, nextAt: 0 };
    if (a.n >= 3 || now() < a.nextAt) return false;
    running = true;
    try {
      a.n += 1;
      a.nextAt = now() + 30 * 60_000;
      attempts.set(tryKey, a);
      const r = await generate(period);
      const caption = [captionFor(period, true), r.pdfError ? `⚠️ PDF tidak dibuat (${r.pdfError}); Word dikirim.` : ""].filter(Boolean).join("\n");
      await sendFiles(r.files, caption);
      await state.set(STATE_KEY, key).catch((e) => log.warn?.(`📄 [Nota dinas] terkirim tetapi penanda gagal disimpan: ${e?.message || e}`));
      log.log?.(`📄 [Nota dinas] konsep ${periodLabel(period)} terkirim (${r.files.map((f) => f.name).join(", ")}).`);
      return true;
    } catch (e) {
      log.error?.(`📄 [Nota dinas] gagal (percobaan ${a.n}/3): ${e?.message || e}`);
      if (a.n >= 3) await send?.(`⚠️ Konsep nota dinas bulan ${periodLabel(period)} gagal dibuat/dikirim 3 kali: ${String(e?.message || e).slice(0, 200)}\nKetik /nodin untuk mencoba lagi sekarang.`).catch(() => {});
      return false;
    } finally {
      running = false;
    }
  }

  /** .docx (Buffer) -> .pdf (Buffer) lewat LibreOffice yang sudah terdeteksi; melempar galat berisi alasan bila gagal. Dipakai modul lain (kas.js). */
  async function toPdf(docxBuf) {
    if (convert) return convert(docxBuf);
    const cmd = await detect();
    if (!cmd) throw new Error("LibreOffice tidak ditemukan di laptop (pasang: sudo apt install libreoffice-writer)");
    return docxToPdf(docxBuf, { soffice: cmd, exec });
  }

  return { check, compose, generate, describe, status, detect, diagnose, toPdf };
}
