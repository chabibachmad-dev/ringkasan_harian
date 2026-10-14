// Tes penjaga kesehatan bot: health.js + perintah Telegram.
//   node test-health.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupCheck, createHealth, createRestartTracker, databaseCheck, diskCheck, memoryCheck, ollamaCheck, parseHealthCommand, readHealthConfig, whatsappCheck } from "./health.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };
const GB = 1024 ** 3;

// ---- konfigurasi & perintah
{
  const d = readHealthConfig({});
  check(d.enabled && d.intervalMin === 5 && d.diskMinGb === 3 && d.memMinMb === 300 && d.waDownMin === 10 && d.restarts === 5 && d.ollama, "config: bawaan");
  const c = readHealthConfig({ HEALTH_ENABLED: "false", HEALTH_INTERVAL_MIN: "0", HEALTH_DISK_MIN_GB: "10", HEALTH_MEM_MIN_MB: "9", HEALTH_RESTARTS: "1", HEALTH_OLLAMA: "no" });
  check(c.enabled === false && c.intervalMin === 5 && c.diskMinGb === 10 && c.memMinMb === 50 && c.restarts === 2 && c.ollama === false, "config: nilai dibaca & dibatasi");
  check(parseHealthCommand("/kesehatan") && parseHealthCommand("/Sehat") && parseHealthCommand("/health@bot") && parseHealthCommand("/kesehatan x") === null && parseHealthCommand("kesehatan") === null, "perintah: /kesehatan /sehat /health");
}

// ---- pemeriksaan siap pakai
{
  const f = (res) => async () => { if (res instanceof Error) throw res; return res; };
  const ok = await ollamaCheck({ baseUrl: "http://x:11434/", fetchImpl: f({ ok: true, json: async () => ({ version: "0.5.1" }) }) }).run();
  check(ok.ok && ok.detail === "versi 0.5.1", "ollama: menjawab");
  const urls = [];
  await ollamaCheck({ baseUrl: "http://x:11434/", fetchImpl: async (u) => { urls.push(u); return { ok: true, json: async () => ({}) }; } }).run();
  check(urls[0] === "http://x:11434/api/version", "ollama: alamat /api/version");
  const down = await ollamaCheck({ baseUrl: "http://x", fetchImpl: f(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } })) }).run();
  check(!down.ok && down.detail.includes("ECONNREFUSED"), "ollama: ditolak koneksi");
  const to = await ollamaCheck({ baseUrl: "http://x", fetchImpl: f(Object.assign(new Error("t"), { name: "TimeoutError" })) }).run();
  check(!to.ok && to.detail.includes("tidak menjawab"), "ollama: timeout");
  const h500 = await ollamaCheck({ baseUrl: "http://x", fetchImpl: f({ ok: false, status: 500 }) }).run();
  check(!h500.ok && h500.detail.includes("500"), "ollama: HTTP 500");

  const st = (free, total = 100) => ({ bavail: free, bsize: GB, blocks: total, bfree: free });
  const d1 = await diskCheck({ paths: ["/a", "/b"], minGb: 3, statfs: (p) => (p === "/a" ? st(50) : st(2)) }).run();
  check(!d1.ok && d1.detail.includes("2 GB") && d1.detail.includes("di bawah batas 3 GB"), "disk: yang paling sempit menentukan");
  const d2 = await diskCheck({ paths: ["/a", "/tidak-ada"], minGb: 3, statfs: (p) => { if (p === "/a") return st(50); throw new Error("ENOENT"); } }).run();
  check(d2.ok && d2.detail.includes("50 GB") && d2.detail.includes("50%"), "disk: folder yang belum ada dilewati; ok");
  check((await diskCheck({ paths: ["/x"], minGb: 3, statfs: () => { throw new Error("x"); } }).run()).ok, "disk: tak terbaca -> tidak memberi alarm palsu");

  check((await memoryCheck({ read: () => ({ totalMB: 8000, availableMB: 200 }), minMb: 300 }).run()).ok === false && (await memoryCheck({ read: () => ({ totalMB: 8000, availableMB: 2000 }), minMb: 300 }).run()).ok === true && (await memoryCheck({ read: () => null, minMb: 300 }).run()).ok === true, "memori: rendah -> gagal; cukup / tak terbaca -> ok");

  let t = 0;
  let conn = false;
  const wa = whatsappCheck({ isConnected: () => conn, downMin: 10, now: () => t });
  check((await wa.run()).ok === true, "wa: baru putus -> masih wajar (menyambung ulang)");
  t += 9 * 60_000;
  check((await wa.run()).ok === true, "wa: 9 menit masih wajar");
  t += 2 * 60_000;
  const w = await wa.run();
  check(!w.ok && w.detail.includes("putus sudah 11 menit"), "wa: lewat 10 menit -> gagal");
  conn = true;
  check((await wa.run()).ok === true, "wa: tersambung -> pulih");
  conn = false;
  t += 60_000;
  check((await wa.run()).ok === true, "wa: putus lagi -> hitungan mulai dari nol");

  check((await databaseCheck({ ping: async () => null }).run()).ok === true, "database: terjangkau");
  const dbx = await databaseCheck({ ping: async () => { throw new Error("fetch failed"); } }).run();
  check(!dbx.ok && dbx.detail.includes("fetch failed"), "database: gagal");
  const dbh = await databaseCheck({ ping: () => new Promise(() => {}), timeoutMs: 20 }).run();
  check(!dbh.ok && dbh.detail.includes("tidak menjawab"), "database: menggantung -> dianggap gagal");

  const now0 = Date.UTC(2026, 9, 14, 12, 0);
  const bc = (latest, extra = {}) => backupCheck({ enabled: true, latest: () => latest, startedAt: now0 - 10 * 3600_000, now: () => now0, ...extra }).run();
  check((await bc(now0 - 5 * 3600_000)).ok && !(await bc(now0 - 40 * 3600_000)).ok && !(await bc(null)).ok, "cadangan: baru ok; 40 jam gagal; tak pernah ada gagal");
  check((await bc(null, { startedAt: now0 - 3600_000 })).ok && (await bc(null, { enabled: false })).ok, "cadangan: bot baru menyala diberi waktu; dimatikan dilewati");
}

// ---- pelacak restart
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));
  const file = path.join(dir, "sub", "starts.json");
  let t = Date.UTC(2026, 9, 14, 12, 0);
  const tr = createRestartTracker({ file, now: () => t, windowMs: 15 * 60_000, max: 5 });
  check((await tr.check.run()).ok, "restart: belum ada catatan -> ok");
  for (let i = 0; i < 4; i++) { tr.recordStart(); t += 60_000; }
  check((await tr.check.run()).ok, "restart: 4 kali dalam 15 menit masih ok");
  tr.recordStart();
  const r = await tr.check.run();
  check(!r.ok && r.detail.includes("5 kali"), "restart: 5 kali dalam 15 menit -> gagal");
  t += 20 * 60_000;
  check((await tr.check.run()).ok, "restart: lewat jendela waktu -> pulih sendiri");
  fs.writeFileSync(file, "bukan json");
  check((await tr.check.run()).ok, "restart: berkas rusak -> tidak error");
  tr.recordStart();
  check(Array.isArray(JSON.parse(fs.readFileSync(file, "utf8"))), "restart: berkas rusak ditimpa dengan daftar baru");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- penjaga: peringatan, pulih, anti-berisik
function makeHealth(over = {}) {
  const clock = { t: Date.UTC(2026, 9, 14, 12, 0) };
  const sent = [];
  let a = { ok: true, detail: "baik" };
  let b = { ok: true, detail: "baik" };
  const h = createHealth({
    config: { enabled: true, intervalMin: 5, ...(over.cfg || {}) },
    checks: [
      { id: "a", label: "Ollama", failAfter: 2, hint: "nyalakan", run: async () => a },
      { id: "b", label: "Disk", failAfter: 1, run: async () => b }
    ],
    notify: over.notify || (async (t) => void sent.push(t)),
    now: () => clock.t,
    log: silent
  });
  return { h, clock, sent, set: (x, y) => { if (x) a = x; if (y) b = y; } };
}
{
  const m = makeHealth();
  check((await m.h.tick()) === 0 && m.sent.length === 0, "penjaga: semua baik -> diam");
  m.set({ ok: false, detail: "mati" });
  check((await m.h.tick()) === 0 && m.sent.length === 0, "penjaga: gagal 1x (butuh 2x) -> belum memberi tahu");
  m.clock.t += 300_000;
  check((await m.h.tick()) === 1 && m.sent.length === 1 && m.sent[0].includes("⚠️ *Ollama*: mati") && m.sent[0].includes("nyalakan"), "penjaga: gagal 2x berturut-turut -> satu peringatan + saran");
  m.clock.t += 300_000;
  check((await m.h.tick()) === 0 && m.sent.length === 1, "penjaga: masih bermasalah -> tidak mengulang");
  m.clock.t += 6 * 3600_000;
  check((await m.h.tick()) === 1 && m.sent.length === 2, "penjaga: masih bermasalah setelah 6 jam -> diingatkan sekali lagi");
  m.set({ ok: true, detail: "versi 1" });
  m.clock.t += 300_000;
  check((await m.h.tick()) === 1 && m.sent[2].includes("✅ Ollama pulih") && m.sent[2].includes("sempat bermasalah"), "penjaga: pulih -> satu pesan pulih");
  check((await m.h.tick()) === 0 && m.sent.length === 3, "penjaga: setelah pulih diam lagi");
  // gagal sesekali (1x lalu ok) tidak pernah memberi tahu
  m.set({ ok: false, detail: "kedip" });
  await m.h.tick();
  m.set({ ok: true, detail: "baik" });
  await m.h.tick();
  m.set({ ok: false, detail: "kedip" });
  await m.h.tick();
  check(m.sent.length === 3, "penjaga: gagal selang-seling tidak dihitung berturut-turut");
}
{
  // gabung dalam satu pesan
  const m = makeHealth();
  m.set({ ok: false, detail: "mati" });
  await m.h.tick(); // Ollama gagal 1x: belum cukup
  m.clock.t += 300_000;
  m.set(null, { ok: false, detail: "sisa 1 GB" });
  await m.h.tick(); // Ollama 2x + Disk 1x: keduanya matang di putaran yang sama
  check(m.sent.length === 1 && m.sent[0].includes("Ollama") && m.sent[0].includes("Disk") && m.sent[0].split("🩺").length === 2, "penjaga: dua masalah -> satu pesan gabungan");
}
{
  // kirim gagal -> dicoba lagi, tidak dianggap sudah dikabari
  let fail = true;
  const sent = [];
  const m = makeHealth({ notify: async (t) => { if (fail) throw new Error("WA & Telegram putus"); sent.push(t); } });
  m.set(null, { ok: false, detail: "penuh" });
  check((await m.h.tick()) === 0, "kirim gagal: tidak terhitung terkirim");
  fail = false;
  m.clock.t += 300_000;
  check((await m.h.tick()) === 1 && sent.length === 1 && sent[0].includes("penuh"), "kirim gagal: peringatan dicoba lagi dan akhirnya terkirim");
  // pemeriksaan yang melempar galat = gagal dengan alasan, bukan menjatuhkan penjaga
  const boom = createHealth({ config: { enabled: true, intervalMin: 5 }, checks: [{ id: "x", label: "X", failAfter: 1, run: async () => { throw new Error("meledak"); } }], notify: async (t) => void sent.push(t), now: () => 1, log: silent });
  await boom.tick();
  check(sent.at(-1).includes("pemeriksaan gagal dijalankan: meledak"), "penjaga: pemeriksaan yang melempar galat dilaporkan, penjaga tetap hidup");
  const off = makeHealth({ cfg: { enabled: false } });
  off.set(null, { ok: false, detail: "x" });
  check((await off.h.tick()) === 0 && off.sent.length === 0 && off.h.describe().includes("mati"), "penjaga: dimatikan -> tidak memeriksa");
}
{
  const m = makeHealth();
  m.set({ ok: false, detail: "mati" }, { ok: true, detail: "sisa 20 GB (40%)" });
  const r = await m.h.report();
  check(r.includes("⚠️ Ollama: mati") && r.includes("nyalakan") && r.includes("✅ Disk: sisa 20 GB") && r.includes("1 hal perlu perhatian"), "laporan: papan status ✅/⚠️ + saran");
  check((await m.h.tick()) === 0 && m.sent.length === 0, "laporan: /kesehatan tidak mengubah hitungan gagal (tidak memicu peringatan)");
  m.set({ ok: true, detail: "baik" });
  check((await m.h.report()).includes("Semua baik.") && m.h.describe().includes("AKTIF (tiap 5 menit: a, b"), "laporan: semua baik; describe");
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
  const tg = createTelegram({ config: tcfg, deps: { chat: async (h) => { cloud.push(h); return "cloud"; }, health: { report: async () => "PAPAN-KESEHATAN" } }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/kesehatan");
  await tg.handleOwnerText("111", "/sehat");
  await tg.handleOwnerText("111", "/health");
  check(sent.join("|") === "PAPAN-KESEHATAN|PAPAN-KESEHATAN|PAPAN-KESEHATAN" && cloud.length === 0, "telegram: /kesehatan /sehat /health -> papan status, tidak ke AI cloud");
  const none = createTelegram({ config: tcfg, deps: { chat: async () => "x" }, fetchImpl: f, log: silent });
  await none.handleOwnerText("111", "/kesehatan");
  check(sent.at(-1).includes("belum aktif"), "telegram: tanpa modul -> pesan ramah");
  const boom = createTelegram({ config: tcfg, deps: { chat: async () => "x", health: { report: async () => { throw new Error("rusak"); } } }, fetchImpl: f, log: silent });
  await boom.handleOwnerText("111", "/kesehatan");
  check(sent.at(-1).includes("Pemeriksaan kesehatan gagal") && sent.at(-1).includes("rusak"), "telegram: galat dilaporkan");
}

console.log(fails === 0 ? "\nSemua tes kesehatan lulus." : `\n${fails} tes kesehatan GAGAL.`);
process.exit(fails === 0 ? 0 : 1);
