// Cadangan otomatis data penting bot yang HANYA ada di laptop: catatan (/ingat), pengingat, skill, dan sesi WhatsApp.
// Tiap malam disalin ke folder bertanggal; yang lama dirotasi. Tidak ada layanan luar dan tidak ada biaya.
//
// Yang dicadangkan (sumber diatur di index.js):
//   memori.sqlite, pengingat.sqlite   disalin dengan VACUUM INTO (salinan konsisten walau bot sedang menulis) lalu diperiksa integritasnya
//   skills/                           resep skill (.md)
//   auth_session/                     sesi WhatsApp (tanpa ini harus pairing ulang); creds.json diperiksa utuh, bila terbaca setengah ditulis disalin ulang
//   .env                              HANYA bila BACKUP_INCLUDE_ENV=true (berisi key rahasia; bawaan tidak ikut)
//
// Cara kerja yang aman:
//   - Disalin ke folder sementara (.tmp-...) dulu, baru diganti nama jadi AAAA-BB-HH_JJMM bila SEMUA sumber berhasil.
//     Bila ada yang gagal, cadangan lama tidak disentuh dan pemilik diberi tahu.
//   - Rotasi hanya menghapus folder yang namanya berpola tanggal dan berisi manifest.json di dalam folder cadangan ini sendiri.
//   - Folder cadangan dibuat 0700 (berisi sesi WhatsApp: jangan dibagikan atau dimasukkan ke Git).
//   - Tidak bergantung pada Supabase: "sudah ada cadangan hari ini" dibaca dari isi folder.
//
// Konfigurasi (.env):
//   BACKUP_ENABLED=true     BACKUP_TIME=02:30 (zona WA_TIMEZONE)     BACKUP_KEEP=7
//   BACKUP_DIR=~/cadangan-ayyubi   (bisa diarahkan ke disk lain atau folder yang disinkronkan)
//   BACKUP_INCLUDE_ENV=false       BACKUP_NOTIFY_OK=false (true = kabari tiap cadangan sukses)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTime } from "./market-brief.js";

export const NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{4}(?:-\d+)?$/;
const MAX_ATTEMPTS = 3;
const RETRY_GAP_MS = 30 * 60_000;
const FALSE_RE = /^(0|false|off|no|tidak|mati)$/i;
const TRUE_RE = /^(1|true|on|yes|ya|aktif)$/i;

export function readBackupConfig(env = process.env, { homeDir = os.homedir() } = {}) {
  const keep = Math.floor(Number(env.BACKUP_KEEP));
  let dir = String(env.BACKUP_DIR || "").trim();
  if (dir.startsWith("~")) dir = path.join(homeDir, dir.slice(1));
  return {
    enabled: !FALSE_RE.test(String(env.BACKUP_ENABLED ?? "true").trim()),
    atMinutes: parseTime(env.BACKUP_TIME, 2 * 60 + 30),
    keep: Number.isFinite(keep) && keep >= 1 ? Math.min(60, keep) : 7,
    dir: path.resolve(dir || path.join(homeDir, "cadangan-ayyubi")),
    includeEnv: TRUE_RE.test(String(env.BACKUP_INCLUDE_ENV ?? "false").trim()),
    notifyOk: TRUE_RE.test(String(env.BACKUP_NOTIFY_OK ?? "false").trim())
  };
}

/** Kenali /cadangan [sekarang] (alias /backup). null bila bukan perintah. */
export function parseBackupCommand(text) {
  const m = /^\s*\/(?:cadangan|backup)(?:@\w+)?(?:\s+(sekarang|now|buat|jalankan|run))?\s*$/i.exec(String(text ?? ""));
  return m ? { now: !!m[1] } : null;
}

export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
  if (v < 1024 * 1024) return `${nf.format(v / 1024)} KB`;
  if (v < 1024 * 1024 * 1024) return `${nf.format(v / 1024 / 1024)} MB`;
  return `${nf.format(v / 1024 / 1024 / 1024)} GB`;
}

function dirStats(p) {
  let bytes = 0;
  let files = 0;
  const walk = (cur) => {
    const st = fs.lstatSync(cur);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(cur)) walk(path.join(cur, e));
    } else if (st.isFile()) {
      bytes += st.size;
      files += 1;
    }
  };
  walk(p);
  return { bytes, files };
}

const isInside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

function localParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hhmm: `${g("hour")}${g("minute")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}

/**
 * sources: [{ name, kind: "sqlite"|"dir"|"file"|"auth", path, optional? }]  (optional bawaan true: tidak ada = dilewati)
 * deps: config, now() -> ms, timeZone, tzLabel, notify(text), log, sleep(ms), projectDir (untuk peringatan)
 */
export function createBackup({ config, sources = [], now = () => Date.now(), timeZone = "Asia/Jakarta", tzLabel = "WIB", notify = null, log = console, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), projectDir = null } = {}) {
  let running = false;
  let attempts = { date: null, count: 0, lastMs: 0, notified: false };
  let doneDate = null; // tanggal lokal yang sudah punya cadangan (hindari baca folder tiap menit)
  let lastRun = null; // { at, ok, error?, name? }

  async function copySqlite(src, dest) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(src);
    try {
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    const chk = new DatabaseSync(dest);
    try {
      const rows = chk.prepare("PRAGMA integrity_check").all();
      if (!(rows.length === 1 && Object.values(rows[0])[0] === "ok")) throw new Error("salinan basis data gagal pemeriksaan integritas");
    } finally {
      chk.close();
    }
  }

  async function copyAuth(src, dest) {
    const credsOk = () => {
      const f = path.join(dest, "creds.json");
      if (!fs.existsSync(path.join(src, "creds.json"))) return true; // sesi kosong: tidak ada yang diperiksa
      try {
        JSON.parse(fs.readFileSync(f, "utf8"));
        return true;
      } catch {
        return false;
      }
    };
    fs.cpSync(src, dest, { recursive: true, dereference: false, force: true });
    if (credsOk()) return;
    await sleep(1500); // bot mungkin sedang menulis creds.json
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true, dereference: false, force: true });
    if (!credsOk()) throw new Error("creds.json sesi WhatsApp tidak utuh (bot sedang menulis?), coba lagi");
  }

  function checkSpace(estimate) {
    try {
      const st = fs.statfsSync(config.dir);
      const free = Number(st.bavail) * Number(st.bsize);
      if (free < estimate * 1.5 + 20 * 1024 * 1024) throw new Error(`Ruang disk tidak cukup di folder cadangan (sisa ${formatBytes(free)}, perlu sekitar ${formatBytes(estimate * 1.5)}).`);
    } catch (e) {
      if (/Ruang disk/.test(String(e?.message))) throw e;
      /* statfs tidak tersedia: lanjut */
    }
  }

  function list() {
    let names = [];
    try {
      names = fs.readdirSync(config.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && NAME_RE.test(d.name)).map((d) => d.name);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names.sort().reverse()) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(config.dir, name, "manifest.json"), "utf8"));
        out.push({ name, bytes: Number(m.bytes) || 0, createdAt: Number(m.createdAt) || 0, items: m.items || [], reason: m.reason || "" });
      } catch {
        /* tanpa manifest = belum lengkap, tidak dihitung */
      }
    }
    return out;
  }

  function rotate() {
    const all = list();
    for (const b of all.slice(config.keep)) {
      const target = path.join(config.dir, b.name);
      if (NAME_RE.test(b.name) && isInside(target, config.dir) && path.resolve(target) !== path.resolve(config.dir)) fs.rmSync(target, { recursive: true, force: true });
    }
  }

  function cleanupTemp() {
    try {
      for (const e of fs.readdirSync(config.dir)) if (e.startsWith(".tmp-")) fs.rmSync(path.join(config.dir, e), { recursive: true, force: true });
    } catch {
      /* folder belum ada */
    }
  }

  /** Buat cadangan sekarang. @returns {Promise<{ok:true,name,bytes,items}|{ok:false,error}>} */
  async function run({ reason = "manual" } = {}) {
    if (running) return { ok: false, error: "Cadangan lain sedang berjalan." };
    running = true;
    let tmp = null;
    try {
      const t = now();
      const lp = localParts(t, timeZone);
      const active = sources.filter((s) => s && s.path);
      for (const s of active) {
        if (s.kind !== "file" && isInside(config.dir, s.path)) throw new Error(`Folder cadangan (${config.dir}) berada di dalam sumber "${s.name}". Pindahkan BACKUP_DIR ke luar folder itu.`);
      }
      fs.mkdirSync(config.dir, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(config.dir, 0o700);
      } catch {
        /* sistem berkas tanpa izin Unix */
      }
      cleanupTemp();
      let estimate = 0;
      for (const s of active) {
        if (!fs.existsSync(s.path)) continue;
        try {
          estimate += s.kind === "dir" || s.kind === "auth" ? dirStats(s.path).bytes : fs.statSync(s.path).size;
        } catch {
          /* dihitung saat disalin */
        }
      }
      checkSpace(estimate);

      tmp = path.join(config.dir, `.tmp-${lp.date}_${lp.hhmm}-${process.pid}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { mode: 0o700 });

      const items = [];
      for (const s of active) {
        if (!fs.existsSync(s.path)) {
          if (s.optional === false) throw new Error(`Sumber wajib "${s.name}" tidak ditemukan (${s.path}).`);
          items.push({ name: s.name, skipped: "belum ada" });
          continue;
        }
        const dest = path.join(tmp, s.destName || path.basename(s.path));
        try {
          if (s.kind === "sqlite") await copySqlite(s.path, dest);
          else if (s.kind === "auth") await copyAuth(s.path, dest);
          else if (s.kind === "dir") fs.cpSync(s.path, dest, { recursive: true, dereference: false, force: true });
          else fs.copyFileSync(s.path, dest);
          if (s.kind === "file") fs.chmodSync(dest, 0o600);
        } catch (e) {
          throw new Error(`${s.name}: ${String(e?.message || e).slice(0, 160)}`);
        }
        const st = s.kind === "dir" || s.kind === "auth" ? dirStats(dest) : { bytes: fs.statSync(dest).size, files: 1 };
        items.push({ name: s.name, bytes: st.bytes, files: st.files });
      }
      const bytes = items.reduce((a, i) => a + (i.bytes || 0), 0);
      fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify({ createdAt: t, reason, bytes, items }, null, 2), { mode: 0o600 });

      let name = `${lp.date}_${lp.hhmm}`;
      for (let n = 2; fs.existsSync(path.join(config.dir, name)); n++) name = `${lp.date}_${lp.hhmm}-${n}`;
      fs.renameSync(tmp, path.join(config.dir, name));
      tmp = null;
      rotate();
      lastRun = { at: t, ok: true, name };
      log.log?.(`💾 Cadangan selesai: ${name} (${formatBytes(bytes)})`);
      return { ok: true, name, bytes, items };
    } catch (e) {
      const error = String(e?.message || e).slice(0, 300);
      lastRun = { at: now(), ok: false, error };
      log.error?.(`💾 Cadangan gagal: ${error}`);
      return { ok: false, error };
    } finally {
      if (tmp) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
          /* sisa sementara dibersihkan pada run berikutnya */
        }
      }
      running = false;
    }
  }

  function formatRun(r) {
    if (!r.ok) return `⚠️ Cadangan GAGAL: ${r.error}\nCadangan sebelumnya tidak diubah. Coba lagi: /cadangan sekarang`;
    const lines = [`💾 Cadangan selesai: ${r.name} — ${formatBytes(r.bytes)}`];
    for (const i of r.items) lines.push(i.skipped ? `• ${i.name}: dilewati (${i.skipped})` : `• ${i.name}: ${formatBytes(i.bytes)}${i.files > 1 ? `, ${i.files} berkas` : ""}`);
    lines.push(`Folder: ${config.dir} (simpan ${config.keep} terakhir)`);
    return lines.join("\n");
  }

  async function runAndFormat() {
    return formatRun(await run({ reason: "manual" }));
  }

  function status() {
    const hh = `${String(Math.floor(config.atMinutes / 60)).padStart(2, "0")}:${String(config.atMinutes % 60).padStart(2, "0")}`;
    const all = list();
    const lines = [config.enabled ? `💾 Cadangan otomatis: AKTIF tiap hari ${hh} ${tzLabel}, simpan ${config.keep} terakhir` : "💾 Cadangan otomatis: MATI (BACKUP_ENABLED=true untuk menyalakan; /cadangan sekarang tetap bisa dipakai)"];
    lines.push(`Folder: ${config.dir}`);
    if (projectDir && isInside(config.dir, projectDir)) lines.push("⚠️ Folder cadangan ada di dalam folder proyek: berisi sesi WhatsApp, JANGAN sampai ikut ke Git. Sebaiknya pindahkan BACKUP_DIR ke luar proyek.");
    if (all.length === 0) lines.push("Belum ada cadangan. Buat sekarang: /cadangan sekarang");
    else {
      const total = all.reduce((a, b) => a + b.bytes, 0);
      lines.push(`${all.length} cadangan (${formatBytes(total)}):`);
      for (const b of all.slice(0, 5)) lines.push(`• ${b.name} — ${formatBytes(b.bytes)} (${b.items.filter((i) => !i.skipped).map((i) => i.name).join(", ")})`);
      if (all.length > 5) lines.push(`… dan ${all.length - 5} lainnya`);
    }
    if (lastRun && !lastRun.ok) lines.push(`⚠️ Percobaan terakhir GAGAL: ${lastRun.error}`);
    lines.push("", "Buat sekarang: /cadangan sekarang", "Cadangan berisi sesi WhatsApp: jangan dibagikan. Cara memulihkan ada di README.");
    return lines.join("\n");
  }

  /** Dipanggil berkala: jalankan cadangan harian bila sudah lewat jamnya dan hari ini belum ada. */
  async function check() {
    if (!config.enabled || running) return false;
    const t = now();
    const lp = localParts(t, timeZone);
    if (lp.minutes < config.atMinutes || doneDate === lp.date) return false;
    if (attempts.date !== lp.date) attempts = { date: lp.date, count: 0, lastMs: 0, notified: false };
    if (attempts.count >= MAX_ATTEMPTS) return false;
    if (attempts.count > 0 && t - attempts.lastMs < RETRY_GAP_MS) return false;
    if (list().some((b) => b.name.slice(0, 10) === lp.date)) {
      doneDate = lp.date;
      return false;
    }
    attempts.count += 1;
    attempts.lastMs = t;
    const r = await run({ reason: "jadwal" });
    if (r.ok) {
      doneDate = lp.date;
      if (config.notifyOk && notify) await Promise.resolve(notify(formatRun(r))).catch(() => {});
      return true;
    }
    if (attempts.count >= MAX_ATTEMPTS && !attempts.notified && notify) {
      attempts.notified = true;
      await Promise.resolve(notify(`💾 *Cadangan otomatis gagal* ${MAX_ATTEMPTS} kali hari ini.\n${r.error}\nCadangan sebelumnya aman. Coba: /cadangan sekarang`)).catch(() => {});
    }
    return false;
  }

  const describe = () => (config.enabled ? `AKTIF (tiap hari ${String(Math.floor(config.atMinutes / 60)).padStart(2, "0")}:${String(config.atMinutes % 60).padStart(2, "0")}, simpan ${config.keep}; ${list().length} tersimpan; /cadangan)` : "mati (BACKUP_ENABLED=true untuk menyalakan)");

  return { run, runAndFormat, status, check, list, describe, formatRun };
}
