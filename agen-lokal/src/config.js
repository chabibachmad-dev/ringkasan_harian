// Membaca pengaturan dari berkas .env (tanpa pustaka) + variabel lingkungan.
import fs from "node:fs";
import path from "node:path";
import { expandHome } from "./safety.js";

/** Isi .env -> objek. Mendukung komentar (#), tanda kutip, dan CRLF Windows. */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, "");
    out[key] = val;
  }
  return out;
}

export function loadEnvFile(file) {
  try {
    return parseEnv(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

const num = (v, def, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || String(v ?? "").trim() === "") return def;
  return Math.max(min, Math.min(max, n));
};

/** env -> konfigurasi siap pakai. Tidak melempar galat; masalah dilaporkan lewat config.problems. */
export function readConfig(env = {}) {
  const problems = [];
  const splitList = (s) => String(s ?? "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  const roots = splitList(env.AGENT_ROOTS).map((r) => path.resolve(expandHome(r)));
  const workdir = String(env.AGENT_WORKDIR || "").trim() ? path.resolve(expandHome(String(env.AGENT_WORKDIR).trim())) : roots[0] || "";
  if (!roots.length) problems.push("AGENT_ROOTS kosong: isi folder yang boleh diakses agent (Linux: /home/kamu/dokumen atau ~/dokumen; Windows: C:\\Users\\Kamu\\Documents).");
  if (roots.some((r) => path.parse(r).root === r)) problems.push("AGENT_ROOTS tidak boleh berupa akar disk (/ atau C:\\). Pilih folder tertentu saja.");
  const cmp = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  if (workdir && roots.length && !roots.some((r) => cmp(workdir) === cmp(r) || cmp(workdir).startsWith(cmp(r) + path.sep))) {
    problems.push("AGENT_WORKDIR harus berada di dalam salah satu AGENT_ROOTS.");
  }
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) problems.push("TELEGRAM_BOT_TOKEN kosong.");
  const mode = /^(baca|read|readonly)$/i.test(String(env.AGENT_MODE || "")) ? "baca" : "tanya";
  return {
    token,
    owners: new Set(String(env.TELEGRAM_OWNER_IDS || "").split(/[;,\s]+/).filter((x) => /^\d+$/.test(x))),
    ollamaUrl: String(env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, ""),
    model: String(env.OLLAMA_MODEL || "qwen2.5:7b").trim(),
    numCtx: num(env.OLLAMA_NUM_CTX, 8192, 2048, 65536),
    keepAlive: String(env.OLLAMA_KEEP_ALIVE || "30m").trim(),
    roots,
    workdir,
    mode,
    approvalTimeoutMs: num(env.AGENT_APPROVAL_TIMEOUT_SEC, 300, 10, 3600) * 1000,
    maxSteps: num(env.AGENT_MAX_STEPS, 8, 1, 20),
    commandTimeoutMs: num(env.AGENT_COMMAND_TIMEOUT_SEC, 60, 5, 600) * 1000,
    requestTimeoutMs: num(env.OLLAMA_TIMEOUT_SEC, 600, 30, 3600) * 1000,
    problems
  };
}
