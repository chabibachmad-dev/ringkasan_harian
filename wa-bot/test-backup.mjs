// Tes cadangan otomatis: backup.js + perintah Telegram.
//   node test-backup.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackup, formatBytes, NAME_RE, parseBackupCommand, readBackupConfig } from "./backup.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };
const root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
let n = 0;
const fresh = () => {
  const d = path.join(root, `case${++n}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ---- konfigurasi & perintah
{
  const d = readBackupConfig({}, { homeDir: "/home/u" });
  check(d.enabled && d.atMinutes === 150 && d.keep === 7 && d.dir === "/home/u/cadangan-ayyubi" && d.includeEnv === false && d.notifyOk === false, "config: bawaan 02:30, simpan 7, ~/cadangan-ayyubi, .env tidak ikut");
  const c = readBackupConfig({ BACKUP_ENABLED: "false", BACKUP_TIME: "23.15", BACKUP_KEEP: "500", BACKUP_DIR: "~/yedek", BACKUP_INCLUDE_ENV: "true", BACKUP_NOTIFY_OK: "ya" }, { homeDir: "/home/u" });
  check(c.enabled === false && c.atMinutes === 1395 && c.keep === 60 && c.dir === "/home/u/yedek" && c.includeEnv && c.notifyOk, "config: nilai dibaca, ~ diperluas, batas 60");
  check(readBackupConfig({ BACKUP_KEEP: "0" }).keep === 7 && readBackupConfig({ BACKUP_KEEP: "abc" }).keep === 7, "config: simpan tak valid -> 7");
  check(parseBackupCommand("/cadangan").now === false && parseBackupCommand("/Cadangan sekarang").now === true && parseBackupCommand("/backup@bot now").now === true && parseBackupCommand("/cadangan x") === null && parseBackupCommand("cadangan") === null, "perintah: /cadangan [sekarang]");
  check(formatBytes(500) === "500 B" && formatBytes(2048) === "2 KB" && formatBytes(5 * 1024 * 1024) === "5 MB", "format ukuran");
}

// ---- fixture sumber
function makeSources(base) {
  const mem = path.join(base, "memori.sqlite");
  const db = new DatabaseSync(mem);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)");
  db.prepare("INSERT INTO notes (text) VALUES (?)").run("klien PT Maju");
  db.prepare("INSERT INTO notes (text) VALUES (?)").run("SPJ tiap tanggal 25");
  fs.mkdirSync(path.join(base, "skills"));
  fs.writeFileSync(path.join(base, "skills", "ringkas.md"), "# ringkas");
  fs.mkdirSync(path.join(base, "auth_session"));
  fs.writeFileSync(path.join(base, "auth_session", "creds.json"), JSON.stringify({ me: "x" }));
  fs.writeFileSync(path.join(base, "auth_session", "app-state-sync-key-1.json"), "{}");
  fs.writeFileSync(path.join(base, ".env"), "SECRET=1");
  return {
    db,
    sources: [
      { name: "catatan", kind: "sqlite", path: mem },
      { name: "pengingat", kind: "sqlite", path: path.join(base, "pengingat.sqlite") }, // belum ada
      { name: "skill", kind: "dir", path: path.join(base, "skills") },
      { name: "sesi WhatsApp", kind: "auth", path: path.join(base, "auth_session") }
    ]
  };
}
const TZ = "Asia/Jakarta";
const clk = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 7, mi); // waktu WIB -> UTC
function make(over = {}) {
  const base = fresh();
  const { sources, db } = makeSources(base);
  const clock = { t: clk(2026, 10, 14, 3, 0) };
  const notes = [];
  const cfg = { ...readBackupConfig({}, { homeDir: base }), dir: path.join(base, "out"), keep: 7, ...(over.cfg || {}) };
  const b = createBackup({ config: cfg, sources: over.sources || sources, now: () => clock.t, timeZone: TZ, tzLabel: "WIB", notify: async (t) => void notes.push(t), log: silent, sleep: over.sleep || (async () => {}), projectDir: over.projectDir });
  return { b, base, cfg, clock, notes, db, sources };
}

// ---- cadangan berhasil
{
  const { b, cfg, db, base } = make();
  const r = await b.run();
  check(r.ok && NAME_RE.test(r.name) && r.name === "2026-10-14_0300", "run: berhasil, nama berpola tanggal-jam lokal");
  const dir = path.join(cfg.dir, r.name);
  check(fs.existsSync(path.join(dir, "memori.sqlite")) && fs.existsSync(path.join(dir, "skills", "ringkas.md")) && fs.existsSync(path.join(dir, "auth_session", "creds.json")) && fs.existsSync(path.join(dir, "manifest.json")), "run: semua sumber tersalin + manifest");
  const copy = new DatabaseSync(path.join(dir, "memori.sqlite"));
  const rows = copy.prepare("SELECT text FROM notes ORDER BY id").all().map((x) => x.text);
  copy.close();
  check(rows.join("|") === "klien PT Maju|SPJ tiap tanggal 25", "run: salinan sqlite berisi data lengkap (walau sumber mode WAL & masih terbuka)");
  check(r.items.find((i) => i.name === "pengingat").skipped === "belum ada" && !fs.existsSync(path.join(dir, "pengingat.sqlite")), "run: sumber opsional yang belum ada dilewati");
  check(!fs.readdirSync(cfg.dir).some((e) => e.startsWith(".tmp-")), "run: tidak ada sisa folder sementara");
  check(!fs.existsSync(path.join(dir, ".env")), "run: .env tidak ikut secara bawaan");
  if (process.platform !== "win32") check((fs.statSync(cfg.dir).mode & 0o077) === 0, "run: folder cadangan 0700 (hanya pemilik)");
  const r2 = await b.run();
  check(r2.ok && r2.name === "2026-10-14_0300-2", "run: dua kali di menit yang sama -> nama diberi akhiran, tidak menimpa");
  check(b.list().length === 2 && b.list()[0].name === "2026-10-14_0300-2", "list: terbaru di atas");
  db.close();

  // sumber .env hanya bila diminta
  const withEnv = make();
  const r3 = await createBackup({ config: { ...withEnv.cfg }, sources: [...withEnv.sources, { name: ".env", kind: "file", path: path.join(withEnv.base, ".env") }], now: () => withEnv.clock.t, timeZone: TZ, log: silent }).run();
  check(r3.ok && fs.readFileSync(path.join(withEnv.cfg.dir, r3.name, ".env"), "utf8") === "SECRET=1", "run: .env ikut bila dimasukkan sebagai sumber");
  if (process.platform !== "win32") check((fs.statSync(path.join(withEnv.cfg.dir, r3.name, ".env")).mode & 0o077) === 0, "run: salinan .env 0600");
  withEnv.db.close();
}

// ---- gagal: tidak merusak yang lama
{
  const { b, cfg, sources, db } = make();
  const ok = await b.run();
  const bad = createBackup({ config: cfg, sources: [{ name: "wajib", kind: "file", path: path.join(cfg.dir, "../tidak-ada"), optional: false }, ...sources], now: () => Date.UTC(2026, 9, 15, 0, 0), timeZone: TZ, log: silent });
  const r = await bad.run();
  check(!r.ok && r.error.includes("wajib") && fs.existsSync(path.join(cfg.dir, ok.name, "manifest.json")) && fs.readdirSync(cfg.dir).length === 1, "gagal: sumber wajib hilang -> error jelas, cadangan lama utuh, tanpa folder setengah jadi");
  const corrupt = path.join(path.dirname(cfg.dir), "rusak.sqlite");
  fs.writeFileSync(corrupt, "ini bukan sqlite sama sekali, hanya teks acak yang panjang........................................");
  const bad2 = createBackup({ config: cfg, sources: [{ name: "catatan", kind: "sqlite", path: corrupt }], now: () => Date.UTC(2026, 9, 15, 0, 0), timeZone: TZ, log: silent });
  const r2 = await bad2.run();
  check(!r2.ok && r2.error.startsWith("catatan:") && b.list().length === 1 && !fs.readdirSync(cfg.dir).some((e) => e.startsWith(".tmp-")), "gagal: berkas sqlite rusak -> gagal, nama sumber disebut, sisa sementara dibersihkan");
  const inside = createBackup({ config: { ...cfg, dir: path.join(sources[3].path, "yedek") }, sources, now: () => Date.UTC(2026, 9, 15, 0, 0), timeZone: TZ, log: silent });
  const r3 = await inside.run();
  check(!r3.ok && r3.error.includes("di dalam sumber"), "gagal: folder cadangan di dalam sumber ditolak (hindari salin tak berujung)");
  db.close();
}

// ---- sesi WhatsApp: creds.json setengah ditulis
{
  const { b, base, db, sources } = make({ sleep: null });
  db.close();
  const creds = path.join(base, "auth_session", "creds.json");
  fs.writeFileSync(creds, '{"me": "x", "noise');
  let slept = 0;
  const ok = createBackup({ config: readBackupConfig({}, { homeDir: base }), sources: [sources[3]], now: () => Date.UTC(2026, 9, 14, 0, 0), timeZone: TZ, log: silent, sleep: async () => { slept++; fs.writeFileSync(creds, '{"me":"x"}'); } });
  const r = await ok.run();
  check(r.ok && slept === 1, "sesi: creds.json terbaca setengah -> tunggu, salin ulang, berhasil");
  fs.writeFileSync(creds, '{"rusak');
  const bad = createBackup({ config: { ...readBackupConfig({}, { homeDir: base }), dir: path.join(base, "out2") }, sources: [sources[3]], now: () => Date.UTC(2026, 9, 14, 0, 0), timeZone: TZ, log: silent, sleep: async () => {} });
  const r2 = await bad.run();
  check(!r2.ok && r2.error.includes("creds.json") && bad.list().length === 0, "sesi: creds.json tetap rusak -> gagal, tidak menyimpan salinan rusak");
}

// ---- rotasi
{
  const { b, cfg, clock, db } = make({ cfg: { keep: 2 } });
  fs.mkdirSync(cfg.dir, { recursive: true });
  fs.mkdirSync(path.join(cfg.dir, "foto-pribadi"));
  fs.writeFileSync(path.join(cfg.dir, "foto-pribadi", "a.jpg"), "x");
  fs.mkdirSync(path.join(cfg.dir, "2020-01-01_0100")); // mirip cadangan tapi tanpa manifest: bukan milik kita, jangan disentuh
  const names = [];
  for (const day of [10, 11, 12, 13]) {
    clock.t = clk(2026, 10, day, 3, 0);
    names.push((await b.run()).name);
  }
  check(b.list().map((x) => x.name).join() === `${names[3]},${names[2]}`, "rotasi: hanya 2 terbaru yang disimpan");
  check(fs.existsSync(path.join(cfg.dir, "foto-pribadi", "a.jpg")) && fs.existsSync(path.join(cfg.dir, "2020-01-01_0100")), "rotasi: folder lain di situ tidak pernah dihapus");
  db.close();
}

// ---- penjadwal
{
  const { b, clock, notes, db, cfg } = make({ cfg: { notifyOk: false } });
  clock.t = clk(2026, 10, 14, 1, 0);
  check((await b.check()) === false && b.list().length === 0, "jadwal: sebelum 02:30 tidak jalan");
  clock.t = clk(2026, 10, 14, 2, 31);
  check((await b.check()) === true && b.list().length === 1 && notes.length === 0, "jadwal: lewat 02:30 -> jalan, sukses tanpa berisik");
  check((await b.check()) === false && b.list().length === 1, "jadwal: hari ini sudah ada -> tidak mengulang");
  clock.t = clk(2026, 10, 14, 14, 0);
  check((await b.check()) === false, "jadwal: siang hari yang sama tetap tidak mengulang");
  clock.t = clk(2026, 10, 15, 2, 31);
  check((await b.check()) === true && b.list().length === 2, "jadwal: besoknya jalan lagi");
  // bot baru menyala siang hari dan belum ada cadangan hari ini -> langsung dicadangkan
  clock.t = clk(2026, 10, 16, 15, 0);
  check((await b.check()) === true && b.list()[0].name.startsWith("2026-10-16"), "jadwal: bot baru menyala lewat jam kirim & belum ada cadangan -> langsung jalan");
  db.close();

  // gagal terus -> 3 kali, jeda 30 menit, satu pemberitahuan
  const bad = make({ sources: [{ name: "wajib", kind: "file", path: "/tidak/ada/sama/sekali", optional: false }] });
  bad.clock.t = clk(2026, 10, 14, 3, 0);
  check((await bad.b.check()) === false && bad.notes.length === 0, "gagal: percobaan 1 diam (akan dicoba lagi)");
  check((await bad.b.check()) === false, "gagal: menunggu 30 menit");
  bad.clock.t += 31 * 60_000;
  await bad.b.check();
  bad.clock.t += 31 * 60_000;
  await bad.b.check();
  check(bad.notes.length === 1 && bad.notes[0].includes("3 kali") && bad.notes[0].includes("wajib"), "gagal: setelah 3 kali satu pemberitahuan berisi alasan");
  bad.clock.t += 31 * 60_000;
  await bad.b.check();
  check(bad.notes.length === 1, "gagal: tidak mengulang pemberitahuan di hari yang sama");
  bad.db.close();

  const loud = make({ cfg: { notifyOk: true } });
  loud.clock.t = clk(2026, 10, 14, 3, 0);
  await loud.b.check();
  check(loud.notes.length === 1 && loud.notes[0].includes("Cadangan selesai"), "jadwal: BACKUP_NOTIFY_OK=true -> kabari tiap sukses");
  loud.db.close();

  const off = make({ cfg: { enabled: false } });
  off.clock.t = clk(2026, 10, 14, 3, 0);
  check((await off.b.check()) === false && off.b.list().length === 0 && off.b.describe().includes("mati"), "jadwal: dimatikan -> tidak jalan");
  check((await off.b.run()).ok, "jadwal: dimatikan tetap bisa manual lewat run()");
  off.db.close();
}

// ---- status
{
  const { b, db, base, cfg } = make({ projectDir: null });
  check(b.status().includes("Belum ada cadangan") && b.status().includes("AKTIF tiap hari 02:30 WIB"), "status: kosong");
  await b.run();
  const s = b.status();
  check(s.includes("1 cadangan") && s.includes("2026-10-14_0300") && s.includes("catatan, skill, sesi WhatsApp") && s.includes("jangan dibagikan"), "status: daftar + isi + peringatan sesi");
  const warn = createBackup({ config: cfg, sources: [], now: () => Date.now(), log: silent, projectDir: base });
  check(warn.status().includes("JANGAN sampai ikut ke Git"), "status: folder di dalam proyek diberi peringatan");
  db.close();
}

// ---- Telegram
{
  const sent = [];
  const f = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    if (method === "sendMessage") sent.push(body.text);
    return { status: 200, json: async () => ({ ok: true, result: method === "getMe" ? { username: "b" } : { message_id: 1 } }) };
  };
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const cloud = [];
  const tg = createTelegram({ config: tcfg, deps: { chat: async (h) => { cloud.push(h); return "cloud"; }, backup: { status: () => "STATUS-CADANGAN", run: async () => "HASIL-CADANGAN" } }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/cadangan");
  await tg.handleOwnerText("111", "/cadangan sekarang");
  await tg.handleOwnerText("111", "/backup now");
  check(sent.join("|") === "STATUS-CADANGAN|HASIL-CADANGAN|HASIL-CADANGAN" && cloud.length === 0, "telegram: /cadangan -> status; 'sekarang' -> jalankan; tidak ke AI cloud");
  const none = createTelegram({ config: tcfg, deps: { chat: async () => "x" }, fetchImpl: f, log: silent });
  await none.handleOwnerText("111", "/cadangan");
  check(sent.at(-1).includes("belum aktif"), "telegram: tanpa modul -> pesan ramah");
  const boom = createTelegram({ config: tcfg, deps: { chat: async () => "x", backup: { status: () => { throw new Error("rusak"); }, run: async () => "" } }, fetchImpl: f, log: silent });
  await boom.handleOwnerText("111", "/cadangan");
  check(sent.at(-1).includes("Cadangan gagal diproses") && sent.at(-1).includes("rusak"), "telegram: galat dilaporkan");
}

fs.rmSync(root, { recursive: true, force: true });
console.log(fails === 0 ? "\nSemua tes cadangan lulus." : `\n${fails} tes cadangan GAGAL.`);
process.exit(fails === 0 ? 0 : 1);
