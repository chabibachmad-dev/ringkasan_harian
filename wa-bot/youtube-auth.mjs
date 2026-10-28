// Sekali jalan: membuat YT_REFRESH_TOKEN untuk channel YouTube-mu dan MENULISNYA LANGSUNG ke file .env
// (token tidak pernah dicetak penuh dan tidak perlu kamu salin/tempel ke mana pun).
//
//   Prasyarat (.env sudah berisi):  YT_CLIENT_ID=...   YT_CLIENT_SECRET=...
//     -> dibuat di Google Cloud Console: aktifkan "YouTube Data API v3", buat "OAuth client ID" jenis *Desktop app*.
//   Jalankan:  cd wa-bot && node youtube-auth.mjs
//   1. Buka alamat yang dicetak di browser (boleh di HP), masuk dengan akun Google pemilik channel, setujui izin unggah.
//   2. Setelah setuju, browser menuju alamat "http://127.0.0.1:8765/?code=..." dan mungkin menampilkan "tidak bisa dibuka"
//      (wajar bila browser bukan di komputer ini). SALIN ALAMAT LENGKAP itu dari kolom alamat, tempel di terminal, Enter.
//      (Kalau browser-nya di komputer yang sama, skrip menangkapnya otomatis.)
//   3. Restart bot.  Cek dengan /edu youtube di Telegram.
// Izin yang diminta HANYA: https://www.googleapis.com/auth/youtube.upload
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const PORT = 8765;
export const REDIRECT = `http://127.0.0.1:${PORT}`;

export function pkcePair(rand = crypto.randomBytes(48)) {
  const verifier = rand.toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl({ clientId, challenge, state, redirect = REDIRECT, scope = SCOPE }) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scope);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  return u.toString();
}

/** Alamat hasil pengalihan (atau hanya kodenya) -> { code, state, error }. */
export function parseRedirect(input) {
  const s = String(input || "").trim();
  if (!s) return { error: "kosong" };
  try {
    const u = new URL(s.startsWith("http") ? s : `${REDIRECT}/?${s.replace(/^\?/, "")}`);
    const error = u.searchParams.get("error");
    if (error) return { error };
    const code = u.searchParams.get("code");
    if (code) return { code, state: u.searchParams.get("state") || "" };
  } catch {
    /* jatuh ke bawah */
  }
  if (/^[\w\-./]{20,}$/.test(s)) return { code: s, state: "" };
  return { error: "tidak ada code di teks itu" };
}

export async function exchangeCode({ clientId, clientSecret, code, verifier, redirect = REDIRECT, fetchImpl = globalThis.fetch }) {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect });
  const res = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google menolak (${res.status}): ${j.error || ""} ${j.error_description || ""}`.trim());
  if (!j.refresh_token) throw new Error("Google tidak memberi refresh_token. Cabut akses lama di https://myaccount.google.com/permissions lalu ulangi.");
  return j;
}

/** Tulis KEY=value ke berkas .env (ganti baris lama; tambah bila belum ada). Izin berkas tidak diubah. */
export function setEnvVar(file, key, value) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    /* berkas baru */
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  const next = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next, { mode: fs.existsSync(file) ? fs.statSync(file).mode : 0o600 });
  fs.renameSync(tmp, file);
}

function readEnvFile(file) {
  const out = {};
  try {
    for (const l of fs.readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
      if (m && !l.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* tidak ada */
  }
  return out;
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envFile = path.join(here, ".env");
  const env = { ...readEnvFile(envFile), ...process.env };
  const clientId = env.YT_CLIENT_ID;
  const clientSecret = env.YT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("YT_CLIENT_ID dan YT_CLIENT_SECRET belum ada di .env. Isi dulu (lihat komentar di atas skrip ini).");
    process.exit(2);
  }
  const { verifier, challenge } = pkcePair();
  const state = crypto.randomBytes(16).toString("hex");
  const url = buildAuthUrl({ clientId, challenge, state });
  console.log("\n1) Buka alamat ini di browser dan setujui izin:\n\n" + url + "\n");
  console.log(`2) Setelah setuju, salin ALAMAT LENGKAP halaman berikutnya (http://127.0.0.1:${PORT}/?code=...) dan tempel di sini, lalu Enter.\n   (Bila browser ada di komputer ini, skrip menangkapnya sendiri.)\n`);

  const result = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { server.close(); } catch { /* abaikan */ }
      rl.close();
      resolve(v);
    };
    const server = http.createServer((req, res) => {
      const r = parseRedirect(`${REDIRECT}${req.url}`);
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(r.code ? "Berhasil. Kamu boleh menutup halaman ini dan kembali ke terminal." : "Gagal: " + (r.error || ""));
      if (r.code || r.error) finish(r);
    });
    server.on("error", () => { /* port dipakai: andalkan tempel manual */ });
    try { server.listen(PORT, "127.0.0.1"); } catch { /* abaikan */ }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Tempel alamat di sini > ", (ans) => finish(parseRedirect(ans)));
  });
  if (result.error) {
    console.error("Gagal: " + result.error);
    process.exit(1);
  }
  if (result.state && result.state !== state) {
    console.error("Gagal: kode 'state' tidak cocok (alamat dari sesi lain). Ulangi dari awal.");
    process.exit(1);
  }
  const tok = await exchangeCode({ clientId, clientSecret, code: result.code, verifier });
  setEnvVar(envFile, "YT_REFRESH_TOKEN", tok.refresh_token);
  console.log(`\nSelesai. YT_REFRESH_TOKEN (…${tok.refresh_token.slice(-4)}) sudah ditulis ke ${envFile}.\nIzin: ${tok.scope}\nRestart bot, lalu kirim /edu youtube di Telegram untuk memeriksa.`);
  console.log("\nPENTING: bila proyek Google Cloud-mu berstatus 'Testing' (layar persetujuan OAuth), token ini kedaluwarsa dalam 7 hari.\nUbah ke 'In production' (boleh tanpa verifikasi untuk pemakaian pribadi) supaya token tidak cepat mati.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("Gagal:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
