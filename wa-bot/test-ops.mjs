// Tes perintah laptop (ops.js): konfirmasi, daftar putih, penyaringan rahasia, restart/deploy/migrasi, integrasi Telegram.
//   node test-ops.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOps, readOpsConfig, maskSecrets, cleanOutput, runCommand } from "./ops.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-"));
const auditFile = path.join(tmp, "audit.log");

// ---- konfigurasi
{
  const d = readOpsConfig({}, "/x/proyek/wa-bot");
  check(d.enabled === false && d.pm2Name === "wa-bot" && d.projectDir === "/x/proyek" && d.functions.join() === "chat,study" && d.confirmTtlSec === 60, "config: mati bawaan, folder proyek = induk wa-bot");
  const c = readOpsConfig({ OPS_ENABLED: "true", OPS_FUNCTIONS: "chat, study;rm, ok_1", OPS_TELEGRAM_IDS: "111, abc, 222", OPS_CONFIRM_TTL_SEC: "5", OPS_PM2_NAME: "bot2" }, "/x/wa-bot");
  check(c.enabled && c.functions.join() === "chat,ok_1" && c.allowIds.join() === "111,222" && c.confirmTtlSec === 15 && c.pm2Name === "bot2", "config: nama fungsi tak valid dibuang, id non-angka dibuang, TTL dibatasi");
}

// ---- penyaringan
{
  check(cleanOutput("\u001b[31mmerah\u001b[0m `x` \r\n") .includes("merah") && !cleanOutput("\u001b[31mmerah\u001b[0m `x`").includes("\u001b") && !cleanOutput("`x`").includes("`"), "clean: ANSI dan backtick dibuang");
  const env = { GEMINI_API_KEYS: "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAA1,AIzaSyBBBBBBBBBBBBBBBBBBBBBBBB2", TELEGRAM_BOT_TOKEN: "123456:ABCDEFGHIJ", PATH: "/usr/bin", SHORT_KEY: "abc" };
  const m = maskSecrets("k1=AIzaSyAAAAAAAAAAAAAAAAAAAAAAAA1 t=123456:ABCDEFGHIJ path=/usr/bin short=abc Bearer abcdefghijklmnop12345 postgresql://u:rahasia@h/db sk-abcdefghijklmnopqrstuv", env);
  check(!m.includes("AIzaSy") && !m.includes("123456:ABC") && !m.includes("abcdefghijklmnop12345") && !m.includes("rahasia") && !m.includes("sk-abcd"), "mask: key env, token, Bearer, URL database, pola sk- disamarkan");
  check(m.includes("/usr/bin") && m.includes("short=abc"), "mask: yang bukan rahasia tetap utuh");
}

// ---- pembantu
function makeOps(over = {}) {
  const calls = [];
  const store = new Map();
  const restarts = [];
  const env = { GEMINI_API_KEYS: "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAA1", ...(over.env || {}) };
  const run = over.run || (async (cmd, args, o) => {
    calls.push({ cmd, args, cwd: o?.cwd, timeoutMs: o?.timeoutMs });
    if (cmd === "pm2" && args[0] === "jlist") return { code: 0, stdout: JSON.stringify([{ name: "wa-bot", pm2_env: { status: "online", pm_uptime: 1_000_000 - 3 * 3600_000, restart_time: 2 }, monit: { memory: 150 * 1048576 } }, { name: "x", pm2_env: { status: "errored" }, monit: {} }]), stderr: "" };
    if (cmd === "df") return { code: 0, stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100000000 40000000 55000000 42% /", stderr: "" };
    if (cmd === "pm2" && args[0] === "logs") return { code: 0, stdout: `\u001b[32mlog baris\u001b[0m key=AIzaSyAAAAAAAAAAAAAAAAAAAAAAAA1 \`x\``, stderr: "" };
    return { code: 0, stdout: `ok ${args.join(" ")}`, stderr: "" };
  });
  const clock = { t: 1_000_000 };
  const ops = createOps({
    config: { ...readOpsConfig({ OPS_ENABLED: "true", ...(over.cfg || {}) }, tmp), auditFile, projectDir: "/proj" },
    deps: { run, restartSelf: (n) => restarts.push(n), state: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) }, memInfo: () => ({ totalMB: 7500, availableMB: 3000, swapUsedMB: 500 }), ollama: async () => ({ ok: true, models: ["qwen2.5:3b"] }) },
    env, now: () => clock.t, rand: () => 0.5, log: silent
  });
  const sent = [];
  const send = async (t) => void sent.push(t);
  return { ops, calls, sent, send, store, restarts, clock, h: (name, arg = "", o = {}) => ops.handle(name, arg, { chatId: 111, send, ...o }) };
}

// ---- mati / izin
{
  const { ops, calls, h } = makeOps({ cfg: { OPS_ENABLED: "false" } });
  const r = await h("restart");
  check(/OPS_ENABLED=true/.test(r) && calls.length === 0 && !ops.enabled(), "mati: pesan petunjuk, tidak ada yang dijalankan");
}
{
  const { calls, h } = makeOps({ cfg: { OPS_TELEGRAM_IDS: "222" } });
  check(/tidak diizinkan/.test(await h("sistem")) && calls.length === 0, "OPS_TELEGRAM_IDS: chat lain ditolak");
  const m = makeOps();
  check(/tidak bisa lewat pesan suara/.test(await m.h("restart", "", { viaVoice: true })) && m.calls.length === 0, "suara: ditolak");
  check((await m.ops.handle("tidakada", "", { chatId: 1 })) === undefined, "perintah bukan milik ops: undefined");
}

// ---- /sistem /log
{
  const { h, calls } = makeOps();
  const r = await h("sistem");
  check(r.includes("🟢 wa-bot — online, hidup 3j 0m, restart 2x, 150 MB") && r.includes("🔴 x — errored"), "sistem: daftar pm2");
  check(r.includes("Disk: 38.1 GB terpakai, 52.5 GB sisa (42%)") && r.includes("RAM: 3000 MB tersedia dari 7500 MB") && r.includes("swap terpakai 500 MB") && r.includes("qwen2.5:3b"), "sistem: disk, RAM+swap, Ollama");
  check(calls.find((c) => c.cmd === "df").args.join() === "-Pk,/proj", "sistem: df memakai folder proyek");
}
{
  const { h, calls } = makeOps();
  const r = await h("log", "40 error");
  const c = calls.find((x) => x.args[0] === "logs");
  check(c.args.join(" ") === "logs wa-bot --nostream --lines 40 --err", "log: argumen pm2 (jumlah + --err)");
  check(r.includes("log baris") && !r.includes("AIzaSy") && r.includes("••••") && !r.includes("\u001b"), "log: rahasia disamarkan, ANSI dibuang");
  await h("log", "9999");
  check(calls.filter((x) => x.args[0] === "logs")[1].args.includes("80"), "log: jumlah dibatasi 80");
  await h("log", "");
  check(calls.filter((x) => x.args[0] === "logs")[2].args.includes("25"), "log: bawaan 25 baris");
}

// ---- /restart + konfirmasi
{
  const { ops, h, restarts, store, clock, sent, send } = makeOps();
  const q = await h("restart");
  check(q.includes("/ya 5500") && restarts.length === 0, "restart: minta konfirmasi, belum jalan");
  check(/Kode tidak cocok/.test(await h("ya", "1234")) && restarts.length === 0, "restart: kode salah -> batal");
  check(/Tidak ada perintah/.test(await h("ya", "5500")), "restart: setelah salah, kode benar pun sudah tidak berlaku");
  await h("restart");
  clock.t += 61_000;
  check(/kedaluwarsa/.test(await h("ya", "5500")) && restarts.length === 0, "restart: kedaluwarsa");
  await h("restart");
  check(/Tidak ada perintah/.test(await ops.handle("ya", "5500", { chatId: 999, send })), "restart: chat lain tidak bisa mengonfirmasi");
  await h("ya", "5500");
  check(restarts.join() === "wa-bot" && sent.some((t) => t.includes("Memulai ulang")) && JSON.parse(store.get("ops_restart_notice")).chatId === "111", "restart: dijalankan sekali, catatan pesan 'menyala lagi' disimpan");
  check(/Tidak ada perintah/.test(await h("ya", "5500")) && restarts.length === 1, "restart: kode sekali pakai");

  const told = [];
  check(await ops.announceStartup(async (c, t) => void told.push([c, t])) === true && told[0][0] === "111" && told[0][1].includes("menyala lagi"), "startup: pemilik dikabari setelah restart");
  check(await ops.announceStartup(async () => {}) === false, "startup: tidak dikabari dua kali");
  store.set("ops_restart_notice", JSON.stringify({ chatId: "111", at: clock.t - 20 * 60_000 }));
  check(await ops.announceStartup(async () => {}) === false, "startup: catatan lama (>10 menit) diabaikan");
}

// ---- /deploy
{
  const { ops, h, calls, sent, send } = makeOps();
  check(/tidak ada di daftar/.test(await h("deploy", "chat; rm -rf /")) && /tidak ada di daftar/.test(await h("deploy", "../x")) && /tidak ada di daftar/.test(await h("deploy", "admin")), "deploy: nama di luar daftar putih / injeksi ditolak");
  check(/Pakai: \/deploy/.test(await h("deploy")), "deploy: tanpa argumen -> petunjuk");
  check(calls.length === 0, "deploy: penolakan tidak menjalankan apa pun");
  const q = await h("deploy", "chat");
  check(q.includes("deploy fungsi chat") && calls.length === 0, "deploy: minta konfirmasi dulu");
  await h("ya", "5500");
  await ops.whenIdle();
  const c = calls.find((x) => x.cmd === "npx");
  check(c && c.args.join(" ") === "supabase functions deploy chat" && c.cwd === "/proj" && c.timeoutMs === 240_000, "deploy: npx supabase functions deploy chat di folder proyek, batas waktu");
  check(sent[0].includes("Menjalankan") && sent.at(-1).startsWith("✅ Deploy chat selesai") && ops.isBusy() === null, "deploy: kabar mulai + selesai, tidak lagi sibuk");
}
{
  const run = async (cmd, args) => (args.includes("study") ? { code: 1, stdout: "", stderr: "Error: token AIzaSyAAAAAAAAAAAAAAAAAAAAAAAA1 invalid" } : { code: null, timedOut: true, stdout: "", stderr: "" });
  const { ops, h, sent } = makeOps({ run });
  await h("deploy", "study"); await h("ya", "5500"); await ops.whenIdle();
  check(sent.at(-1).startsWith("❌") && sent.at(-1).includes("kode 1") && !sent.at(-1).includes("AIzaSy"), "deploy gagal: ❌ + keluaran tersaring");
  await h("deploy", "chat"); await h("ya", "5500"); await ops.whenIdle();
  check(sent.at(-1).includes("lewat 240 detik"), "deploy: timeout dilaporkan");
}
{
  let release;
  const gate = new Promise((r) => (release = r));
  const run = async () => { await gate; return { code: 0, stdout: "", stderr: "" }; };
  const { ops, h, sent } = makeOps({ run });
  await h("deploy", "chat"); await h("ya", "5500");
  check(ops.isBusy() === "deploy fungsi chat", "sibuk: pekerjaan berjalan terdeteksi");
  check(/Masih ada pekerjaan/.test(await h("restart")) && /Masih ada pekerjaan/.test(await h("deploy", "study")), "sibuk: restart/deploy lain ditolak selama ada pekerjaan");
  release(); await ops.whenIdle();
  check(ops.isBusy() === null && sent.at(-1).startsWith("✅"), "sibuk: bebas lagi setelah selesai");
}

// ---- /migrasi
{
  const { ops, h, calls, sent } = makeOps();
  const pv = await h("migrasi");
  const c = calls.find((x) => x.cmd === "npx");
  check(c.args.join(" ") === "supabase db push --dry-run" && pv.includes("Pratinjau") && pv.includes("/migrasi terapkan"), "migrasi: pratinjau = db push --dry-run, tanpa konfirmasi");
  check(/Pakai: \/migrasi/.test(await h("migrasi", "hapus semua")), "migrasi: argumen aneh ditolak");
  const q = await h("migrasi", "terapkan");
  check(q.includes("/ya 5500") && calls.filter((x) => x.cmd === "npx").length === 1, "migrasi terapkan: minta konfirmasi");
  await h("ya", "5500"); await ops.whenIdle();
  check(calls.filter((x) => x.cmd === "npx")[1].args.join(" ") === "supabase db push" && sent.at(-1).startsWith("✅ Migrasi selesai"), "migrasi terapkan: db push dijalankan setelah konfirmasi");
}

// ---- audit
{
  const log = fs.readFileSync(auditFile, "utf8");
  check(/MINTA-KONFIRMASI restart wa-bot/.test(log) && /JALAN deploy fungsi chat/.test(log) && /KODE-SALAH/.test(log) && /DITOLAK/.test(log) && !/AIzaSy/.test(log), "audit: tercatat, tanpa rahasia");
}

// ---- runCommand sungguhan (tanpa shell)
{
  const r = await runCommand("echo", ["a;touch " + path.join(tmp, "pwned"), "$(id)"], {});
  check(r.code === 0 && r.stdout.includes("a;touch") && r.stdout.includes("$(id)") && !fs.existsSync(path.join(tmp, "pwned")), "run: argumen tidak ditafsirkan shell");
  const nf = await runCommand("perintah-yang-tidak-ada-xyz", [], {});
  check(nf.error && nf.error.includes("tidak ditemukan"), "run: perintah tidak ada -> galat jelas");
  const t0 = Date.now();
  const to = await runCommand("sleep", ["30"], { timeoutMs: 300 });
  check(to.timedOut && Date.now() - t0 < 5000, "run: timeout membunuh proses");
}

// ---- integrasi Telegram
{
  const sent = [];
  const f = async (url, init) => { const b = init?.body ? JSON.parse(init.body) : {}; if (String(url).endsWith("sendMessage")) sent.push(b.text); return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
  const seen = [];
  const ops = { handle: async (name, arg, o) => { seen.push({ name, arg, chatId: o.chatId, viaVoice: o.viaVoice }); await o.send("kabar"); return name === "ya" ? undefined : `balasan ${name}`; } };
  const simab = { enabled: true, hasSession: () => true, run: async () => "simab-jalan" };
  const cfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: cfg, deps: { chat: async () => "ai", ops, simab }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/restart");
  await tg.handleOwnerText("111", "/ya 5500");
  check(seen.map((s) => s.name).join() === "restart,ya" && seen[1].arg === "5500" && seen[0].chatId === "111", "telegram: /restart dan /ya diteruskan ke ops (bahkan saat sesi SiMAB aktif)");
  check(sent.join("|") === "kabar|balasan restart|kabar", "telegram: balasan ops dikirim; undefined tidak dikirim");
  await tg.handleOwnerText("111", "/deploy chat", { viaVoice: true });
  check(seen[2].viaVoice === true, "telegram: penanda viaVoice ikut diteruskan");
  const tg2 = createTelegram({ config: cfg, deps: { chat: async () => "ai" }, fetchImpl: f, log: silent });
  const n = sent.length;
  await tg2.handleOwnerText("111", "/restart");
  check(sent[n].includes("tidak dikenal"), "telegram: tanpa ops terpasang -> perintah tidak dikenal");
  await tg.handleUpdate({ update_id: 5, message: { chat: { id: 222, type: "private" }, text: "/restart" } });
  check(seen.length === 3, "telegram: non-pemilik tidak bisa memicu ops");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails === 0 ? "\nSEMUA TES LULUS" : `\n${fails} TES GAGAL`);
process.exit(fails === 0 ? 0 : 1);
