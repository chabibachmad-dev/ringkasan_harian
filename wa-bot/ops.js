// Perintah laptop dari Telegram: status sistem, log, restart bot, deploy Edge Function, migrasi.
//
// KEAMANAN (baca dulu):
//   - Mati secara bawaan. Aktifkan dengan OPS_ENABLED=true di .env bot.
//   - TIDAK ADA shell bebas. Hanya perintah tetap di bawah ini; argumen divalidasi terhadap daftar putih
//     dan perintah dijalankan tanpa shell (spawn dengan array argumen), jadi tidak ada penyisipan perintah.
//   - Hanya dari chat pribadi pemilik di Telegram (sudah dijaga telegram.js). Bisa dipersempit dengan OPS_TELEGRAM_IDS.
//   - Tidak lewat pesan suara (salah dengar = salah perintah), tidak lewat WhatsApp.
//   - Perintah yang mengubah sesuatu (/restart, /deploy, /migrasi terapkan) minta konfirmasi: bot memberi kode
//     acak 4 digit, balas "/ya <kode>" dalam 60 detik. Kode sekali pakai dan terikat ke perintah + chat itu.
//   - Satu pekerjaan berat pada satu waktu. Setiap perintah dicatat di wa-bot/ops-audit.log.
//   - Keluaran disaring: nilai variabel .env yang berisi KEY/TOKEN/SECRET/PASSWORD diganti ••••.
//
// Perintah:
//   /sistem                    pm2, disk, memori, beban, Ollama
//   /log [jumlah] [error]      baris terakhir log bot (maks 80)
//   /restart                   pm2 restart <nama> --update-env   (konfirmasi)
//   /deploy chat|study         npx supabase functions deploy <fungsi>   (konfirmasi)
//   /migrasi                   pratinjau migrasi yang belum diterapkan (db push --dry-run)
//   /migrasi terapkan          npx supabase db push   (konfirmasi)
//   /ya <kode>                 konfirmasi perintah yang menunggu
//   /ops                       bantuan singkat
//
// Patch & Git (OPS_PATCH_ENABLED / OPS_GIT_ENABLED, bawaan ikut OPS_ENABLED):
//   kirim berkas patch*.zip      zip diperiksa (ops-patch.js), ringkasan perubahan ditampilkan, terapkan setelah /ya <kode>;
//                                file lama dicadangkan di <proyek>/.ops-backup/ — .env, auth_session, dokumen/, kb/ tidak pernah disentuh
//   /urungkan                  kembalikan patch terakhir dari cadangan (konfirmasi)
//   /tes                       npm test di folder wa-bot
//   /git                       status ringkas, commit terakhir, jumlah commit belum di-push
//   /commit <pesan>            git add -A + git commit (konfirmasi; ditolak bila ada file sensitif)
//   /push                      git push (konfirmasi; tidak pernah --force)
//   /rilis <pesan>             commit + push sekaligus (satu konfirmasi)

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZipError, readZip } from "./zip-lite.js";
import { applyPatch, isProtectedPath, latestPatchBackup, planPatch, resolvePlan, sha256, suggestNextSteps, undoPatch } from "./ops-patch.js";

export const OPS_COMMANDS = ["sistem", "log", "restart", "deploy", "migrasi", "ya", "ops", "tes", "git", "commit", "push", "rilis", "urungkan"];

const flag = (v, d = false) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "") return d;
  return ["1", "true", "ya", "on", "yes"].includes(s);
};

export function readOpsConfig(env = process.env, baseDir = process.cwd()) {
  const num = (v, d, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== undefined && v !== "" ? Math.max(lo, Math.min(hi, n)) : d;
  };
  return {
    enabled: flag(env.OPS_ENABLED, false),
    projectDir: env.OPS_PROJECT_DIR ? path.resolve(env.OPS_PROJECT_DIR) : path.resolve(baseDir, ".."),
    pm2Name: String(env.OPS_PM2_NAME || "wa-bot").trim(),
    functions: String(env.OPS_FUNCTIONS || "chat,study")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[a-z0-9_-]{1,40}$/i.test(s)),
    allowIds: String(env.OPS_TELEGRAM_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^-?\d+$/.test(s)),
    botDir: path.resolve(baseDir),
    // argumen tambahan untuk `supabase db push` (mis. "--yes" bila CLI-mu bertanya konfirmasi); hanya opsi sederhana yang diterima
    dbPushArgs: String(env.OPS_DB_PUSH_ARGS || "").split(/\s+/).filter((x) => /^--?[a-z][a-z0-9-]*(=[A-Za-z0-9_.:-]+)?$/i.test(x)),
    patchEnabled: flag(env.OPS_PATCH_ENABLED, true),
    gitEnabled: flag(env.OPS_GIT_ENABLED, true),
    patchPrefix: (String(env.OPS_PATCH_PREFIX || "patch").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "patch"),
    patchConfirmTtlSec: num(env.OPS_PATCH_CONFIRM_TTL_SEC, 180, 30, 900),
    testTimeoutSec: num(env.OPS_TEST_TIMEOUT_SEC, 300, 30, 1200),
    gitTimeoutSec: num(env.OPS_GIT_TIMEOUT_SEC, 120, 15, 600),
    confirmTtlSec: num(env.OPS_CONFIRM_TTL_SEC, 60, 15, 600),
    deployTimeoutSec: num(env.OPS_DEPLOY_TIMEOUT_SEC, 240, 30, 900),
    auditFile: env.OPS_AUDIT_FILE ? path.resolve(env.OPS_AUDIT_FILE) : path.join(baseDir, "ops-audit.log")
  };
}

/** Buang kode warna ANSI, karakter kontrol, dan backtick (supaya aman ditaruh di blok kode). */
export function cleanOutput(text) {
  return String(text ?? "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/`/g, "'");
}

/** Ganti nilai rahasia (dari env) dan pola kunci umum dengan ••••. */
export function maskSecrets(text, env = process.env) {
  let out = String(text ?? "");
  const secrets = Object.entries(env)
    .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD|PASSWD|SERVICE_ROLE/i.test(k) && typeof v === "string" && v.trim().length >= 8)
    .flatMap(([, v]) => v.split(",").map((x) => x.trim()))
    .filter((v) => v.length >= 8)
    .sort((a, b) => b.length - a.length);
  for (const s of secrets) out = out.split(s).join("••••");
  out = out
    .replace(/\b(AIza[0-9A-Za-z_-]{20,}|gsk_[0-9A-Za-z]{20,}|sk-[0-9A-Za-z_-]{20,}|sbp_[0-9a-f]{20,}|tvly-[0-9A-Za-z_-]{10,}|ghp_[0-9A-Za-z]{20,})/g, "••••")
    .replace(/\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/g, "••••")
    .replace(/(Bearer\s+)[0-9A-Za-z._~+/=-]{12,}/gi, "$1••••")
    .replace(/\bgithub_pat_[0-9A-Za-z_]{20,}/g, "••••")
    .replace(/((?:postgres(?:ql)?|https?):\/\/[^:\s\/@]+:)[^@\s]+@/gi, "$1••••@");
  return out;
}

function tail(text, maxChars) {
  const t = String(text);
  return t.length <= maxChars ? t : `…${t.slice(t.length - maxChars)}`;
}

/** Jalankan perintah TANPA shell. Mengembalikan { code, stdout, stderr, timedOut, error }. */
export function runCommand(cmd, args, { cwd, timeoutMs = 30_000, env = process.env, maxBytes = 200_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, code: null, error: null, ...r });
    };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (e) {
      return resolve({ stdout, stderr, timedOut, code: null, error: e.message });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref?.();
      } catch {
        /* sudah selesai */
      }
    }, timeoutMs);
    const add = (which) => (d) => {
      const s = d.toString("utf8");
      if (which === "out") stdout = tail(stdout + s, maxBytes);
      else stderr = tail(stderr + s, maxBytes);
    };
    child.stdout.on("data", add("out"));
    child.stderr.on("data", add("err"));
    child.on("error", (e) => done({ error: e.code === "ENOENT" ? `perintah '${cmd}' tidak ditemukan di PATH bot` : e.message }));
    child.on("close", (code) => done({ code }));
  });
}

function fmtUptime(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d}h ${h}j` : h > 0 ? `${h}j ${m % 60}m` : `${m}m`;
}

/**
 * deps:
 *   run(cmd, args, {cwd, timeoutMs}) -> {code, stdout, stderr, timedOut, error}   (bawaan runCommand)
 *   restartSelf(name)                -> menjadwalkan pm2 restart (bawaan: spawn terlepas, 1,5 detik lagi)
 *   state { get, set }               -> untuk pesan "sudah menyala lagi" setelah restart
 *   memInfo()                        -> {totalMB, availableMB, swapUsedMB} | null
 *   ollama()                         -> Promise<{ok, models:[...], error?}>
 *   env, now(), rand(), log
 */
export function createOps({ config, deps = {}, env = process.env, now = () => Date.now(), rand = Math.random, log = console } = {}) {
  const run = deps.run || ((cmd, args, o) => runCommand(cmd, args, { env, ...o }));
  const pending = new Map(); // chatId -> { action, code, expires, label }
  let busy = null; // teks pekerjaan yang sedang jalan
  const jobs = new Set();

  const enabled = () => config.enabled === true;
  const allowed = (chatId) => config.allowIds.length === 0 || config.allowIds.includes(String(chatId));
  const mask = (t) => maskSecrets(cleanOutput(t), env);

  function audit(chatId, line) {
    try {
      fs.appendFileSync(config.auditFile, `${new Date(now()).toISOString()} chat=${chatId} ${line}\n`);
    } catch (e) {
      log.error?.(`🛠️ [Ops] gagal menulis audit: ${e.message}`);
    }
  }

  const block = (t) => "```\n" + t.trim() + "\n```";

  function ask(chatId, action, label, { ttlSec = config.confirmTtlSec, detail = "" } = {}) {
    const code = String(1000 + Math.floor(rand() * 9000));
    pending.set(String(chatId), { action, code, label, expires: now() + ttlSec * 1000 });
    audit(chatId, `MINTA-KONFIRMASI ${label.split("\n")[0]}`);
    return `⚠️ Akan menjalankan: ${label}${detail ? `\n${detail}` : ""}\nBalas */ya ${code}* dalam ${ttlSec} detik untuk melanjutkan. Abaikan untuk membatalkan.`;
  }

  // ------------------------------------------------------------ perintah
  async function cmdSistem() {
    const lines = ["🖥️ *Laptop bot*"];
    const l = os.loadavg().map((x) => x.toFixed(2)).join(" ");
    lines.push(`Menyala ${fmtUptime(os.uptime() * 1000)} • beban ${l} (${os.cpus().length} inti)`);
    const mem = deps.memInfo?.();
    if (mem) lines.push(`RAM: ${mem.availableMB} MB tersedia dari ${mem.totalMB} MB${mem.swapUsedMB > 200 ? ` • swap terpakai ${mem.swapUsedMB} MB ⚠️` : ""}`);

    const df = await run("df", ["-Pk", config.projectDir], { timeoutMs: 10_000 });
    const dfLine = String(df.stdout).trim().split("\n")[1];
    if (dfLine) {
      const p = dfLine.trim().split(/\s+/);
      if (p.length >= 5) lines.push(`Disk: ${(Number(p[2]) / 1048576).toFixed(1)} GB terpakai, ${(Number(p[3]) / 1048576).toFixed(1)} GB sisa (${p[4]})`);
    }

    const pm = await run("pm2", ["jlist"], { timeoutMs: 15_000 });
    let list = null;
    if (!pm.error) {
      try {
        const raw = String(pm.stdout);
        list = JSON.parse(raw.slice(raw.indexOf("[")));
      } catch {
        list = null;
      }
    }
    if (list) {
      lines.push("", "*pm2*");
      if (list.length === 0) lines.push("(tidak ada proses)");
      for (const p of list) {
        const e = p.pm2_env || {};
        const up = e.status === "online" && e.pm_uptime ? fmtUptime(now() - e.pm_uptime) : "-";
        lines.push(`${e.status === "online" ? "🟢" : "🔴"} ${p.name} — ${e.status}, hidup ${up}, restart ${e.restart_time ?? 0}x, ${Math.round((p.monit?.memory || 0) / 1048576)} MB`);
      }
    } else {
      lines.push("", `pm2: tidak terbaca${pm.error ? ` (${pm.error})` : ""}`);
    }

    if (deps.ollama) {
      try {
        const o = await deps.ollama();
        lines.push("", o.ok ? `🦙 Ollama aktif${o.models?.length ? ` • di RAM: ${o.models.join(", ")}` : " • tidak ada model di RAM"}` : `🦙 Ollama tidak merespons${o.error ? ` (${String(o.error).slice(0, 80)})` : ""}`);
      } catch (e) {
        lines.push("", `🦙 Ollama tidak merespons (${String(e.message || e).slice(0, 80)})`);
      }
    }
    return lines.join("\n");
  }

  async function cmdLog(arg) {
    const err = /\b(error|err|galat)\b/i.test(arg);
    const n = Math.max(5, Math.min(80, Number((/\b(\d{1,5})\b/.exec(arg) || [])[1]) || 25));
    const args = ["logs", config.pm2Name, "--nostream", "--lines", String(n), ...(err ? ["--err"] : [])];
    const r = await run("pm2", args, { timeoutMs: 20_000 });
    if (r.error) return `⚠️ Gagal membaca log: ${r.error}`;
    const text = mask(`${r.stdout}\n${r.stderr}`).trim();
    if (!text) return "Log kosong.";
    return `📜 Log ${config.pm2Name}${err ? " (error)" : ""}, ${n} baris:\n${block(tail(text, 3400))}`;
  }

  async function execJob({ chatId, label, cmd, args, timeoutSec, send, okText }) {
    busy = label;
    audit(chatId, `JALAN ${label}`);
    try {
      const r = await run(cmd, args, { cwd: config.projectDir, timeoutMs: timeoutSec * 1000 });
      const out = mask(`${r.stdout}\n${r.stderr}`).trim();
      const ok = r.code === 0 && !r.error && !r.timedOut;
      audit(chatId, `SELESAI ${label} kode=${r.code}${r.timedOut ? " TIMEOUT" : ""}${r.error ? ` galat=${r.error}` : ""}`);
      if (ok) await send(`✅ ${okText}${out ? `\n${block(tail(out, 1500))}` : ""}`);
      else await send(`❌ ${label} gagal${r.timedOut ? ` (lewat ${timeoutSec} detik)` : r.error ? `: ${r.error}` : ` (kode ${r.code})`}${out ? `\n${block(tail(out, 1800))}` : ""}`);
    } catch (e) {
      audit(chatId, `GALAT ${label} ${e.message}`);
      await send(`❌ ${label} gagal: ${String(e.message || e).slice(0, 200)}`);
    } finally {
      busy = null;
    }
  }

  function startJob(job) {
    const p = execJob(job).finally(() => jobs.delete(p));
    jobs.add(p);
    return p;
  }

  /** Pekerjaan umum: fn() -> { ok, text }. Menandai sibuk, mencatat audit, melaporkan hasil lewat send. */
  function startFnJob({ chatId, label, send, fn }) {
    busy = label;
    audit(chatId, `JALAN ${label.split("\n")[0]}`);
    const p = (async () => {
      try {
        const r = await fn();
        audit(chatId, `SELESAI ${label.split("\n")[0]} ${r.ok ? "ok" : "gagal"}`);
        await send(r.text);
      } catch (e) {
        audit(chatId, `GALAT ${label.split("\n")[0]} ${e.message}`);
        await send(`❌ ${label.split("\n")[0]} gagal: ${mask(String(e.message || e)).slice(0, 300)}`);
      } finally {
        busy = null;
      }
    })().finally(() => jobs.delete(p));
    jobs.add(p);
    return p;
  }

  // ------------------------------------------------------------ git
  const gitEnv = { ...env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes", LC_ALL: "C", LANG: "C" };
  const git = (args, timeoutSec = config.gitTimeoutSec) => run("git", args, { cwd: config.projectDir, timeoutMs: timeoutSec * 1000, env: gitEnv });
  const gitFail = (r) => (r.error ? r.error : r.timedOut ? "waktu habis" : mask(`${r.stderr}\n${r.stdout}`).trim().slice(-600) || `kode ${r.code}`);

  /** Perubahan di working tree: [{ code, file }] */
  async function gitChanges() {
    const r = await git(["status", "--porcelain=v1", "-z", "-uall"], 30);
    if (r.error || r.code !== 0) return { error: gitFail(r) };
    const items = String(r.stdout).split("\0").filter(Boolean);
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const code = items[i].slice(0, 2);
      out.push({ code: code.trim() || "?", file: items[i].slice(3) });
      if (code[0] === "R" || code[0] === "C") i++; // entri berikut = nama lama
    }
    return { changes: out };
  }

  async function gitUpstream() {
    const b = await git(["rev-parse", "--abbrev-ref", "HEAD"], 15);
    const branch = b.code === 0 ? b.stdout.trim() : "?";
    const u = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 15);
    const upstream = u.code === 0 ? u.stdout.trim() : null;
    const c = upstream ? await git(["rev-list", "--count", "@{u}..HEAD"], 15) : await git(["rev-list", "--count", "HEAD", "--not", "--remotes"], 15);
    return { branch, upstream, ahead: c.code === 0 ? Number(c.stdout.trim()) || 0 : 0 };
  }

  const changeLines = (changes, max = 15) => changes.slice(0, max).map((c) => `${c.code} ${c.file}`).join("\n") + (changes.length > max ? `\n… dan ${changes.length - max} lainnya` : "");

  async function cmdGit() {
    const ch = await gitChanges();
    if (ch.error) return `⚠️ Git bermasalah: ${ch.error}`;
    const up = await gitUpstream();
    const lg = await git(["log", "-3", "--pretty=format:%h %s (%cr)"], 15);
    const lines = [`🌿 *Git* — cabang ${up.branch}${up.upstream ? ` → ${up.upstream}` : " (belum punya upstream)"}`];
    lines.push(ch.changes.length ? `${ch.changes.length} file berubah, belum di-commit:` : "Tidak ada perubahan yang belum di-commit.");
    if (ch.changes.length) lines.push(block(changeLines(ch.changes)));
    lines.push(up.ahead > 0 ? `⬆️ ${up.ahead} commit belum di-push (/push atau /rilis).` : "Semua commit sudah di-push.");
    if (lg.code === 0 && lg.stdout.trim()) lines.push("", "Commit terakhir:", block(mask(lg.stdout)));
    return lines.join("\n");
  }

  async function doCommit(message) {
    const add = await git(["add", "-A"], 60);
    if (add.error || add.code !== 0) return { ok: false, text: `❌ git add gagal: ${gitFail(add)}` };
    const staged = await git(["diff", "--cached", "--name-only", "-z"], 30);
    const names = String(staged.stdout).split("\0").filter(Boolean);
    const bad = names.filter(isProtectedPath);
    if (bad.length) {
      await git(["reset", "-q"], 30);
      return { ok: false, text: `❌ Dibatalkan: file sensitif ikut ter-stage:\n${block(bad.slice(0, 10).join("\n"))}\nTambahkan ke .gitignore dulu. Tidak ada yang di-commit.` };
    }
    if (names.length === 0) return { ok: false, text: "Tidak ada perubahan untuk di-commit." };
    const c = await git(["commit", "-m", message], 60);
    if (c.error || c.code !== 0) return { ok: false, text: `❌ git commit gagal:\n${block(gitFail(c))}` };
    const first = mask(c.stdout).trim().split("\n")[0];
    return { ok: true, text: `✅ Commit dibuat (${names.length} file): ${first}`, files: names.length };
  }

  async function doPush(up) {
    const args = up.upstream ? ["push"] : ["push", "-u", "origin", "HEAD"];
    const r = await git(args, config.gitTimeoutSec);
    const out = mask(`${r.stdout}\n${r.stderr}`).trim();
    if (r.error || r.code !== 0 || r.timedOut) return { ok: false, text: `❌ git push gagal${r.timedOut ? " (waktu habis; mungkin meminta kata sandi)" : ""}:\n${block(tail(r.error || out || `kode ${r.code}`, 1200))}\nBila ditolak karena remote lebih baru, gabungkan dulu secara manual (git pull). Bot tidak pernah memaksa push.` };
    return { ok: true, text: `✅ Push selesai${out ? `:\n${block(tail(out, 800))}` : "."}` };
  }

  function cleanMessage(a) {
    return String(a || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  async function prepareCommit(chatId, a, { withPush }, send) {
    const message = cleanMessage(a);
    const ch = await gitChanges();
    if (ch.error) return `⚠️ Git bermasalah: ${ch.error}`;
    const up = await gitUpstream();
    const hasChanges = ch.changes.length > 0;
    if (!hasChanges && !(withPush && up.ahead > 0)) return up.ahead > 0 ? `Tidak ada perubahan untuk di-commit. Ada ${up.ahead} commit belum di-push: pakai /push.` : "Tidak ada perubahan untuk di-commit.";
    if (hasChanges && message.length < 3) return withPush ? "Pakai: /rilis <pesan commit>   contoh: /rilis tambah perintah dokumen" : "Pakai: /commit <pesan commit>   contoh: /commit tambah perintah dokumen";
    const bad = ch.changes.filter((c) => isProtectedPath(c.file));
    if (bad.length) return `❌ Ditolak: file sensitif akan ikut ter-commit:\n${block(bad.slice(0, 10).map((c) => c.file).join("\n"))}\nTambahkan ke .gitignore dulu.`;
    const parts = [];
    if (hasChanges) parts.push(`commit ${ch.changes.length} file «${message}»`);
    if (withPush) parts.push(up.upstream ? `push ke ${up.upstream}` : `push cabang ${up.branch} ke origin (-u)`);
    const label = parts.join(" lalu ");
    const detail = hasChanges ? changeLines(ch.changes) : `${up.ahead} commit belum di-push`;
    return ask(chatId, async (snd) => {
      await snd("⏳ Menjalankan git…");
      startFnJob({
        chatId,
        label: withPush ? "rilis (commit + push)" : "commit",
        send: snd,
        fn: async () => {
          const texts = [];
          if (hasChanges) {
            const c = await doCommit(message);
            texts.push(c.text);
            if (!c.ok) return { ok: false, text: texts.join("\n") };
          }
          if (withPush) {
            const fresh = await gitUpstream();
            if (fresh.upstream && fresh.ahead === 0) texts.push("Tidak ada commit untuk di-push.");
            else {
              const pu = await doPush(fresh);
              texts.push(pu.text);
              return { ok: pu.ok, text: texts.join("\n") };
            }
          }
          return { ok: true, text: texts.join("\n") };
        }
      });
    }, label, { detail: block(detail) });
  }

  async function preparePush(chatId, send) {
    const up = await gitUpstream();
    if (up.upstream && up.ahead === 0) return "Tidak ada commit yang perlu di-push.";
    if (!up.upstream && up.ahead === 0) return "Tidak ada commit yang perlu di-push (cabang ini belum punya upstream dan tidak ada commit baru).";
    const label = up.upstream ? `push ${up.ahead} commit ke ${up.upstream}` : `push cabang ${up.branch} ke origin (-u), ${up.ahead} commit`;
    return ask(chatId, async (snd) => {
      await snd("⏳ Push ke GitHub…");
      startFnJob({ chatId, label: "push", send: snd, fn: () => doPush(up) });
    }, label);
  }

  async function cmdTes(chatId, send) {
    send && (await send("⏳ Menjalankan tes (npm test)… bisa beberapa menit."));
    startFnJob({
      chatId,
      label: "tes otomatis",
      send,
      fn: async () => {
        // Lingkungan BERSIH: tes tidak butuh rahasia, dan nilai .env bot (mis. TUTOR_AI_ORDER, WA_SPEAK_TEXT) bisa mengubah hasil tes.
        const testEnv = {};
        for (const k of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TZ", "NVM_DIR", "NVM_BIN", "NODE_PATH"]) if (env[k] !== undefined) testEnv[k] = env[k];
        const r = await run("npm", ["test"], { cwd: config.botDir, timeoutMs: config.testTimeoutSec * 1000, env: testEnv });
        const out = mask(`${r.stdout}\n${r.stderr}`);
        // Tes mencetak ratusan baris "ok: ..." (sebagian berisi kata "gagal" sebagai nama tes). Buang baris "ok:" dan
        // tampilkan sisanya: baris FAIL di depan, lalu ekor keluaran (jejak galat, ringkasan, pesan npm).
        const rest = out.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() && !/^ok:/.test(l));
        const fails = rest.filter((l) => /^FAIL\b/.test(l)).slice(0, 10);
        const tailLines = rest.filter((l) => !fails.includes(l)).slice(-18);
        const ok = r.code === 0 && !r.error && !r.timedOut;
        if (ok) return { ok, text: `✅ Semua tes lulus.\n${block(tail(out.trim().split("\n").filter(Boolean).slice(-3).join("\n"), 300))}` };
        return { ok, text: `❌ Tes gagal${r.timedOut ? ` (lewat ${config.testTimeoutSec} detik)` : r.error ? `: ${r.error}` : ` (kode ${r.code})`}.\n${block(tail([...fails, ...(fails.length && tailLines.length ? ["…"] : []), ...tailLines].join("\n"), 2400))}\nJangan /restart dulu; /urungkan mengembalikan patch terakhir.` };
      }
    });
    return undefined;
  }

  // ------------------------------------------------------------ patch zip
  async function handleDocument({ chatId, fileName, size, download, send } = {}) {
    const name = String(fileName || "");
    const lower = name.toLowerCase();
    if (!lower.endsWith(".zip")) return undefined;
    if (!enabled()) return "🛠️ Perintah laptop dimatikan (OPS_ENABLED=true untuk mengaktifkan penerapan patch dari Telegram).";
    if (!allowed(chatId)) {
      audit(chatId, `DITOLAK (id tidak diizinkan) zip ${name.slice(0, 60)}`);
      return "Chat ini tidak diizinkan memakai perintah laptop (OPS_TELEGRAM_IDS).";
    }
    if (!config.patchEnabled) return "Penerapan patch dari Telegram dimatikan (OPS_PATCH_ENABLED=false).";
    if (!lower.startsWith(config.patchPrefix)) return `Nama berkas zip harus diawali "${config.patchPrefix}" (mis. ${config.patchPrefix}-ops.zip) supaya tidak salah terapkan. Ganti namanya lalu kirim ulang.`;
    if (busy) return `Masih ada pekerjaan berjalan (${busy}). Tunggu selesai dulu.`;
    if (Number(size) > 19 * 1024 * 1024) return "Zip terlalu besar untuk bot Telegram (maks 20 MB).";
    audit(chatId, `PATCH diterima ${name.slice(0, 80)} (${size || "?"} byte)`);

    let buf;
    try {
      buf = await download();
    } catch (e) {
      return `⚠️ Gagal mengunduh zip dari Telegram: ${String(e.message || e).slice(0, 200)}`;
    }
    let plan;
    try {
      plan = planPatch(readZip(buf), config.projectDir);
      if (plan.rejected.length === 0) resolvePlan(plan, config.projectDir);
    } catch (e) {
      audit(chatId, `PATCH ditolak: ${e.message}`);
      return e instanceof ZipError ? `⚠️ Zip ditolak: ${e.message}` : `⚠️ Zip tidak bisa diproses: ${String(e.message || e).slice(0, 200)}`;
    }
    if (plan.rejected.length) {
      audit(chatId, `PATCH ditolak: ${plan.rejected.length} path tidak aman/dilindungi`);
      const list = plan.rejected.slice(0, 8).map((r) => `• ${String(r.name).slice(0, 80)} (${r.reason})`).join("\n");
      return `❌ Zip ditolak seluruhnya, ada path yang tidak boleh disentuh:\n${list}${plan.rejected.length > 8 ? `\n… dan ${plan.rejected.length - 8} lainnya` : ""}`;
    }
    if (plan.files.length === 0) return "Zip tidak berisi berkas.";
    const created = plan.files.filter((f) => f.status === "new");
    const changed = plan.files.filter((f) => f.status === "changed");
    const same = plan.files.filter((f) => f.status === "same");
    if (created.length + changed.length === 0) return `Semua ${same.length} berkas di zip sudah sama persis dengan yang ada di laptop. Tidak ada yang perlu diterapkan.`;

    const list = (arr, mark) => arr.slice(0, 12).map((f) => `${mark} ${f.rel}`).join("\n") + (arr.length > 12 ? `\n… +${arr.length - 12} lainnya` : "");
    const detail = [created.length ? list(created, "+") : "", changed.length ? list(changed, "~") : ""].filter(Boolean).join("\n");
    const zipSha = sha256(buf);
    const touchesOps = plan.files.some((f) => f.status !== "same" && /^wa-bot\/(ops|ops-patch|zip-lite|telegram)\.js$/.test(f.rel));
    const label = `terapkan ${name} (${created.length} baru, ${changed.length} berubah${same.length ? `, ${same.length} sama` : ""}) — sha256 ${zipSha.slice(0, 12)}`;
    const warn = touchesOps ? "\n⚠️ Patch ini mengubah modul perintah laptop/Telegram. Pastikan zip memang darimu." : "";
    return ask(chatId, async (snd) => {
      startFnJob({
        chatId,
        label: "menerapkan patch",
        send: snd,
        fn: async () => {
          const r = applyPatch(plan, config.projectDir, { zipSha, name, now: () => new Date(now()) });
          const rels = [...r.written, ...r.created];
          audit(chatId, `PATCH diterapkan ${name.slice(0, 60)}: ${r.created.length} baru, ${r.written.length} berubah, cadangan ${path.basename(r.dir)}`);
          const steps = suggestNextSteps(rels, config.functions);
          return { ok: true, text: `✅ Patch diterapkan: ${r.created.length} baru, ${r.written.length} berubah.\nCadangan file lama: .ops-backup/${path.basename(r.dir)} (batalkan dengan /urungkan).\n\nLangkah berikutnya:\n${steps.map((x) => `• ${x}`).join("\n")}` };
        }
      });
    }, label, { ttlSec: config.patchConfirmTtlSec, detail: `${block(detail)}${warn}` });
  }

  function prepareUndo(chatId) {
    const last = latestPatchBackup(config.projectDir);
    if (!last) return "Tidak ada patch yang bisa diurungkan.";
    const m = last.manifest;
    const label = `urungkan patch ${m.zip || last.name} (${m.written.length} file dikembalikan, ${m.created.length} file baru dihapus)`;
    return ask(chatId, async (snd) => {
      startFnJob({
        chatId,
        label: "mengurungkan patch",
        send: snd,
        fn: async () => {
          const r = undoPatch(last.dir, config.projectDir);
          audit(chatId, `PATCH diurungkan ${last.name}: ${r.restored} dikembalikan, ${r.removed} dihapus`);
          return { ok: true, text: `↩️ Patch diurungkan: ${r.restored} file dikembalikan, ${r.removed} file baru dihapus.${m.written.concat(m.created).some((x) => x.startsWith("wa-bot/")) ? "\nJalankan /restart agar bot memakai kode yang dikembalikan." : ""}` };
        }
      });
    }, label);
  }

  function actionRestart(chatId) {
    return async (send) => {
      audit(chatId, `JALAN restart ${config.pm2Name}`);
      try {
        await deps.state?.set?.("ops_restart_notice", JSON.stringify({ chatId: String(chatId), at: now() }));
      } catch {
        /* pesan "menyala lagi" opsional */
      }
      await send(`🔄 Memulai ulang ${config.pm2Name}… tunggu sekitar setengah menit, aku kabari kalau sudah menyala.`);
      if (deps.restartSelf) deps.restartSelf(config.pm2Name);
      else {
        setTimeout(() => {
          try {
            const c = spawn("pm2", ["restart", config.pm2Name, "--update-env"], { detached: true, stdio: "ignore", shell: false });
            c.on("error", (e) => log.error?.(`🛠️ [Ops] pm2 restart gagal: ${e.message}`));
            c.unref();
          } catch (e) {
            log.error?.(`🛠️ [Ops] pm2 restart gagal: ${e.message}`);
          }
        }, 1500).unref?.();
      }
    };
  }

  /**
   * Pintu konfirmasi untuk fitur lain yang mengubah sesuatu di laptop (mis. kelola skill dari Telegram):
   * memakai izin, mode suara, penguncian, audit, dan "/ya <kode>" yang sama dengan perintah laptop.
   * action() dijalankan HANYA setelah kode benar dan mengembalikan teks balasan.
   */
  function confirmAction(chatId, { label, detail = "", action, viaVoice = false, ttlSec } = {}) {
    if (!enabled()) return "🛠️ Perintah laptop dimatikan. Isi OPS_ENABLED=true di .env bot lalu restart bot untuk mengaktifkannya.";
    if (!allowed(chatId)) {
      audit(chatId, `DITOLAK (id tidak diizinkan) ${String(label).slice(0, 60)}`);
      return "Chat ini tidak diizinkan memakai perintah laptop (OPS_TELEGRAM_IDS).";
    }
    if (viaVoice) return "Perubahan ini tidak bisa lewat pesan suara. Ketik perintahnya.";
    if (busy) return `Masih ada pekerjaan berjalan (${busy}). Tunggu selesai dulu.`;
    return ask(
      chatId,
      async () => {
        try {
          const text = await action();
          audit(chatId, `SELESAI ${String(label).split("\n")[0]}`);
          return text;
        } catch (e) {
          audit(chatId, `GALAT ${String(label).split("\n")[0]} ${e?.message || e}`);
          return `⚠️ Gagal: ${String(e?.message || e).slice(0, 200)}`;
        }
      },
      label,
      { detail, ...(ttlSec ? { ttlSec } : {}) }
    );
  }

  // ------------------------------------------------------------ pintu masuk
  /** @returns {Promise<string|null>} teks balasan langsung (atau null bila balasan dikirim lewat send) */
  async function handle(name, arg, { chatId, viaVoice = false, send } = {}) {
    const cmd = String(name || "").toLowerCase();
    const a = String(arg || "").trim();
    if (!OPS_COMMANDS.includes(cmd)) return undefined;
    if (!enabled()) return "🛠️ Perintah laptop dimatikan. Isi OPS_ENABLED=true di .env bot lalu restart bot untuk mengaktifkannya.";
    if (!allowed(chatId)) {
      audit(chatId, `DITOLAK (id tidak diizinkan) /${cmd}`);
      return "Chat ini tidak diizinkan memakai perintah laptop (OPS_TELEGRAM_IDS).";
    }
    if (viaVoice) return "Perintah laptop tidak bisa lewat pesan suara. Ketik perintahnya.";

    if (cmd === "ops") {
      return [
        "🛠️ *Perintah laptop*",
        "/sistem — pm2, disk, RAM, Ollama",
        "/log [jumlah] [error] — log bot terakhir",
        "/restart — mulai ulang bot (konfirmasi)",
        `/deploy ${config.functions.join("|")} — deploy Edge Function (konfirmasi)`,
        "/migrasi — pratinjau migrasi;  /migrasi terapkan — jalankan (konfirmasi)",
        `📦 Kirim berkas ${config.patchPrefix}*.zip — periksa lalu terapkan ke folder proyek (konfirmasi);  /urungkan — batalkan patch terakhir`,
        "/tes — npm test",
        "/git — status;  /commit <pesan>;  /push;  /rilis <pesan> = commit + push (konfirmasi)",
        "/ya <kode> — konfirmasi"
      ].join("\n");
    }

    if (cmd === "ya") {
      const p = pending.get(String(chatId));
      if (!p) return "Tidak ada perintah yang menunggu konfirmasi.";
      if (now() > p.expires) {
        pending.delete(String(chatId));
        return "Konfirmasi sudah kedaluwarsa. Ulangi perintahnya.";
      }
      if (a !== p.code) {
        pending.delete(String(chatId));
        audit(chatId, `KODE-SALAH untuk ${p.label}`);
        return "Kode tidak cocok. Perintah dibatalkan; ulangi dari awal bila masih mau.";
      }
      pending.delete(String(chatId));
      if (busy) return `Masih ada pekerjaan berjalan (${busy}). Tunggu selesai dulu.`;
      return p.action(send);
    }

    if (busy && cmd !== "sistem" && cmd !== "log") return `Masih ada pekerjaan berjalan (${busy}). Tunggu selesai dulu.`;

    audit(chatId, `PERINTAH /${cmd}${a ? ` ${a.slice(0, 60)}` : ""}`);

    if (cmd === "sistem") return cmdSistem();
    if (cmd === "log") return cmdLog(a);

    if (cmd === "urungkan") return config.patchEnabled ? prepareUndo(chatId) : "Fitur patch dimatikan (OPS_PATCH_ENABLED=false).";
    if (cmd === "tes") return cmdTes(chatId, send);
    if (["git", "commit", "push", "rilis"].includes(cmd)) {
      if (!config.gitEnabled) return "Fitur git dimatikan (OPS_GIT_ENABLED=false).";
      if (cmd === "git") return cmdGit();
      if (cmd === "commit") return prepareCommit(chatId, a, { withPush: false }, send);
      if (cmd === "rilis") return prepareCommit(chatId, a, { withPush: true }, send);
      return preparePush(chatId, send);
    }

    if (cmd === "restart") return ask(chatId, actionRestart(chatId), `restart ${config.pm2Name}`);

    if (cmd === "deploy") {
      const fn = a.toLowerCase();
      if (!fn) return `Pakai: /deploy ${config.functions.join(" atau /deploy ")}`;
      if (!config.functions.includes(fn)) return `Fungsi '${fn.slice(0, 30)}' tidak ada di daftar yang diizinkan (${config.functions.join(", ")}).`;
      const label = `deploy fungsi ${fn}`;
      return ask(chatId, async (snd) => {
        await snd(`⏳ Menjalankan ${label}… (bisa 1–3 menit)`);
        startJob({ chatId, label, cmd: "npx", args: ["supabase", "functions", "deploy", fn], timeoutSec: config.deployTimeoutSec, send: snd, okText: `Deploy ${fn} selesai` });
      }, label);
    }

    if (cmd === "migrasi") {
      if (/^terapkan$/i.test(a)) {
        return ask(chatId, async (snd) => {
          await snd("⏳ Menerapkan migrasi (db push)…");
          startJob({ chatId, label: "migrasi db push", cmd: "npx", args: ["supabase", "db", "push", ...config.dbPushArgs], timeoutSec: config.deployTimeoutSec, send: snd, okText: "Migrasi selesai" });
        }, "terapkan migrasi (npx supabase db push)");
      }
      if (a) return "Pakai: /migrasi (pratinjau) atau /migrasi terapkan.";
      await send?.("⏳ Memeriksa migrasi yang belum diterapkan…");
      busy = "pratinjau migrasi";
      try {
        const r = await run("npx", ["supabase", "db", "push", "--dry-run", ...config.dbPushArgs], { cwd: config.projectDir, timeoutMs: config.deployTimeoutSec * 1000 });
        const out = mask(`${r.stdout}\n${r.stderr}`).trim();
        audit(chatId, `PRATINJAU migrasi kode=${r.code}`);
        if (r.error) return `⚠️ Gagal: ${r.error}`;
        return `${r.code === 0 ? "🔎 Pratinjau migrasi:" : `⚠️ Pratinjau gagal (kode ${r.code}):`}\n${block(tail(out || "(tanpa keluaran)", 2500))}\nUntuk menerapkan: /migrasi terapkan`;
      } finally {
        busy = null;
      }
    }
    return undefined;
  }

  /** Dipanggil sekali setelah bot menyala: kabari pemilik bila baru saja minta /restart. */
  async function announceStartup(sendTo) {
    if (!enabled() || !deps.state) return false;
    try {
      const raw = await deps.state.get("ops_restart_notice");
      if (!raw) return false;
      await deps.state.set("ops_restart_notice", "");
      const n = JSON.parse(raw);
      if (!n?.chatId || now() - Number(n.at) > 10 * 60_000) return false;
      await sendTo(n.chatId, `✅ ${config.pm2Name} menyala lagi (restart selesai dalam ${Math.max(1, Math.round((now() - Number(n.at)) / 1000))} detik).`);
      audit(n.chatId, "SELESAI restart (bot menyala lagi)");
      return true;
    } catch {
      return false;
    }
  }

  return { enabled, commands: OPS_COMMANDS, handle, handleDocument, confirmAction, announceStartup, whenIdle: () => Promise.all([...jobs]), isBusy: () => busy, _pending: pending };
}
