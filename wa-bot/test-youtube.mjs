// Tes klien YouTube (youtube.js) & skrip otorisasi (youtube-auth.mjs) dengan fetch palsu — tidak menyentuh jaringan.
//   node test-youtube.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createYoutube, readYoutubeConfig, cleanTitle, cleanDescription, cleanTags, classifyYoutubeError, rfc3339, YoutubeError } from "./youtube.js";
import { pkcePair, buildAuthUrl, parseRedirect, setEnvVar, exchangeCode, SCOPE } from "./youtube-auth.mjs";
import crypto from "node:crypto";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };
const cfg = readYoutubeConfig({ YT_CLIENT_ID: "cid", YT_CLIENT_SECRET: "sec", YT_REFRESH_TOKEN: "rt-1234567890abcd" });

// ---- konfigurasi & pembersih
check(cfg.madeForKids === true && cfg.aiDisclosure === true && cfg.categoryId === "27", "bawaan: untuk anak, label AI aktif, kategori Pendidikan");
check(readYoutubeConfig({ YT_MADE_FOR_KIDS: "false", YT_AI_DISCLOSURE: "off" }).madeForKids === false, "bisa dimatikan lewat .env");
check(cleanTitle("<b>Halo</b>   dunia ".repeat(20)).length <= 100 && !/[<>]/.test(cleanTitle("<x>")), "judul ≤100 huruf tanpa < >");
check(Buffer.byteLength(cleanDescription("é".repeat(5000)), "utf8") <= 5000, "deskripsi ≤5000 byte");
check(cleanTags(["a,b", "A b", "x".repeat(500), "ok"]).join("|") === "a b|ok" || cleanTags(["a,b", "A b", "ok"]).length === 2, "tag dibersihkan & unik");
check(rfc3339(new Date("2026-10-28T08:00:00Z")) === "2026-10-28T08:00:00.000Z" && rfc3339("x") === null && rfc3339(null) === null, "rfc3339");
check(classifyYoutubeError(403, JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } })).kind === "quota", "klasifikasi quotaExceeded");
check(classifyYoutubeError(400, JSON.stringify({ error: "invalid_grant" })).kind === "auth", "klasifikasi invalid_grant -> auth");
check(classifyYoutubeError(403, JSON.stringify({ error: { errors: [{ reason: "uploadLimitExceeded" }] } })).kind === "limit", "klasifikasi uploadLimitExceeded");
check(classifyYoutubeError(503, "").kind === "server", "klasifikasi 5xx");

// ---- fetch palsu
function fake(handlers) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [re, fn] of handlers) if (re.test(String(url))) return fn(url, init, calls);
    throw new Error("tak terduga: " + url);
  };
  f.calls = calls;
  return f;
}
const J = (status, obj, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)), json: async () => (typeof obj === "string" ? JSON.parse(obj) : obj) });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yt-"));
const mp4 = path.join(tmp, "v.mp4"); fs.writeFileSync(mp4, Buffer.alloc(5000, 7));

{
  const f = fake([
    [/oauth2\.googleapis\.com\/token/, () => J(200, { access_token: "AT1", expires_in: 3600, scope: SCOPE })],
    [/upload\/youtube\/v3\/videos\?/, () => J(200, {}, { location: "https://upload.example/abc" })],
    [/upload\.example\/abc/, () => J(200, { id: "VID123" })]
  ]);
  let t = 1_000_000;
  const yt = createYoutube({ config: cfg, fetchImpl: f, now: () => t, sleep: async () => {}, log: silent });
  const r = await yt.upload({ file: mp4, title: "Judul <x>", description: "Deskripsi", tags: ["a", "b"], publishAt: new Date("2026-10-28T08:00:00Z") });
  check(r.id === "VID123" && r.url === "https://youtu.be/VID123", "unggah berhasil -> id & tautan");
  const init = f.calls.find((c) => /videos\?/.test(c.url));
  const meta = JSON.parse(init.init.body);
  check(meta.status.privacyStatus === "private" && meta.status.publishAt === "2026-10-28T08:00:00.000Z", "dijadwalkan: privat + publishAt");
  check(meta.status.selfDeclaredMadeForKids === true && meta.status.containsSyntheticMedia === true && meta.snippet.categoryId === "27", "untuk anak + label sintetis + kategori");
  check(!/[<>]/.test(meta.snippet.title), "judul bersih");
  check(init.init.headers.authorization === "Bearer AT1" && init.init.headers["x-upload-content-length"] === "5000", "header Bearer & ukuran berkas");
  const put = f.calls.find((c) => /upload\.example/.test(c.url));
  check(put.init.method === "PUT" && put.init.body.length === 5000, "berkas dikirim utuh lewat PUT");
  await yt.upload({ file: mp4, title: "lagi" });
  check(f.calls.filter((c) => /oauth2\.googleapis\.com\/token/.test(c.url)).length === 1, "token dipakai ulang selama belum kedaluwarsa");
  t += 4_000_000;
  await yt.upload({ file: mp4, title: "nanti" });
  check(f.calls.filter((c) => /oauth2\.googleapis\.com\/token/.test(c.url)).length === 2, "token diperbarui setelah kedaluwarsa");
  const noPub = f.calls.filter((c) => /videos\?/.test(c.url)).map((c) => JSON.parse(c.init.body));
  check(noPub[1].status.publishAt === undefined && noPub[1].status.privacyStatus === "private", "tanpa jadwal: hanya privat (tanpa publishAt)");
}
{
  const yt = createYoutube({ config: readYoutubeConfig({}), fetchImpl: fake([]), log: silent });
  let e; try { await yt.upload({ file: mp4, title: "x" }); } catch (x) { e = x; }
  check(e instanceof YoutubeError && e.kind === "config" && !yt.available(), "tanpa .env: galat 'config' yang jelas");
}
{
  const yt = createYoutube({ config: cfg, fetchImpl: fake([[/oauth2\.googleapis\.com\/token/, () => J(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." })]]), log: silent });
  let e; try { await yt.upload({ file: mp4, title: "x" }); } catch (x) { e = x; }
  check(e?.kind === "auth" && /youtube-auth/.test(e.message) && yt.status().broken, "token ditolak -> galat auth + petunjuk ulangi youtube-auth");
}
{
  let puts = 0;
  const f = fake([
    [/oauth2\.googleapis\.com\/token/, () => J(200, { access_token: "AT", expires_in: 3600 })],
    [/upload\/youtube\/v3\/videos\?/, () => J(200, {}, { location: "https://upload.example/x" })],
    [/upload\.example\/x/, () => (++puts < 3 ? J(503, "") : J(200, { id: "OK1" }))]
  ]);
  const yt = createYoutube({ config: cfg, fetchImpl: f, sleep: async () => {}, log: silent });
  const r = await yt.upload({ file: mp4, title: "x" });
  check(r.id === "OK1" && puts === 3, "gangguan 5xx sesaat: diulang sampai berhasil");
}
{
  const f = fake([
    [/oauth2\.googleapis\.com\/token/, () => J(200, { access_token: "AT", expires_in: 3600 })],
    [/upload\/youtube\/v3\/videos\?/, () => J(403, { error: { errors: [{ reason: "quotaExceeded" }], message: "q" } })]
  ]);
  const yt = createYoutube({ config: cfg, fetchImpl: f, log: silent });
  let e; try { await yt.upload({ file: mp4, title: "x" }); } catch (x) { e = x; }
  check(e?.kind === "quota", "kuota harian habis -> galat quota");
}
{
  const f = fake([
    [/oauth2\.googleapis\.com\/token$/, () => J(200, { access_token: "AT", expires_in: 3600 })],
    [/thumbnails\/set/, () => J(403, { error: { errors: [{ reason: "forbidden" }], message: "verify" } })]
  ]);
  const yt = createYoutube({ config: cfg, fetchImpl: f, log: silent });
  const r = await yt.setThumbnail("V1", mp4);
  check(r.ok === false && r.reason, "sampul ditolak -> tidak melempar, mengembalikan alasan");
}
{
  const f = fake([
    [/oauth2\.googleapis\.com\/token$/, () => J(200, { access_token: "AT", expires_in: 3600, scope: SCOPE })],
    [/tokeninfo/, () => J(200, { scope: SCOPE, expires_in: "3000" })]
  ]);
  const yt = createYoutube({ config: cfg, fetchImpl: f, log: silent });
  const v = await yt.verify();
  check(v.ok && v.canUpload, "verify(): izin unggah terbaca dari tokeninfo");
  check(!JSON.stringify(yt.status()).includes("rt-1234567890abcd"), "status() tidak membocorkan refresh token");
}

// ---- skrip otorisasi
{
  const { verifier, challenge } = pkcePair(Buffer.alloc(48, 1));
  check(challenge === crypto.createHash("sha256").update(verifier).digest("base64url"), "PKCE: challenge = SHA256(verifier)");
  const url = new URL(buildAuthUrl({ clientId: "cid", challenge, state: "st" }));
  check(url.searchParams.get("scope") === "https://www.googleapis.com/auth/youtube.upload" && url.searchParams.get("access_type") === "offline" && url.searchParams.get("prompt") === "consent" && url.searchParams.get("code_challenge_method") === "S256", "URL otorisasi: hanya izin unggah, offline, PKCE");
  check(parseRedirect("http://127.0.0.1:8765/?code=4%2F0AbCdEf&state=xyz&scope=s").code === "4/0AbCdEf", "parseRedirect: ambil code dari alamat lengkap");
  check(parseRedirect("http://127.0.0.1:8765/?error=access_denied").error === "access_denied", "parseRedirect: penolakan");
  check(parseRedirect("4/0AbCdEfGhIjKlMnOpQrSt").code === "4/0AbCdEfGhIjKlMnOpQrSt", "parseRedirect: kode saja diterima");
  check(parseRedirect("asal").error, "parseRedirect: teks asal -> galat");
  const f = fake([[/oauth2\.googleapis\.com\/token/, (u, init) => J(200, { refresh_token: "RT", access_token: "A", scope: SCOPE, _body: String(init.body) })]]);
  const t = await exchangeCode({ clientId: "cid", clientSecret: "sec", code: "C", verifier: "V", fetchImpl: f });
  check(t.refresh_token === "RT" && /code_verifier=V/.test(String(f.calls[0].init.body)) && /grant_type=authorization_code/.test(String(f.calls[0].init.body)), "pertukaran kode memakai code_verifier");
  let e; try { await exchangeCode({ clientId: "c", clientSecret: "s", code: "C", verifier: "V", fetchImpl: fake([[/token/, () => J(200, { access_token: "A" })]]) }); } catch (x) { e = x; }
  check(/refresh_token/.test(e?.message || ""), "tanpa refresh_token -> pesan petunjuk cabut akses lama");
  const envf = path.join(tmp, ".env");
  fs.writeFileSync(envf, "A=1\nYT_REFRESH_TOKEN=lama\nB=2", { mode: 0o600 });
  setEnvVar(envf, "YT_REFRESH_TOKEN", "baru");
  check(fs.readFileSync(envf, "utf8") === "A=1\nYT_REFRESH_TOKEN=baru\nB=2", ".env: baris lama diganti, lainnya utuh");
  setEnvVar(envf, "NEW_KEY", "x");
  check(/B=2\nNEW_KEY=x\n$/.test(fs.readFileSync(envf, "utf8")), ".env: kunci baru ditambahkan di akhir");
  check((fs.statSync(envf).mode & 0o777) === 0o600, ".env: izin berkas tidak berubah");
}
fs.rmSync(tmp, { recursive: true, force: true });
if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua tes YouTube lulus.");
