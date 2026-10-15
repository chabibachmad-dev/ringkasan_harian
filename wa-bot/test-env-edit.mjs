// Tes /env (env-edit.js). Jalankan: node test-env-edit.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnvArg, createEnvEditor, ENV_KEYS, maskValue } from "./env-edit.js";
import { createImageGen, readImageConfig } from "./image-gen.js";
import { createTelegram } from "./telegram.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "envtest-"));
const envPath = path.join(tmp, ".env");
const ORIGINAL = "# komentar awal\nSUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=rahasia-supabase\nTELEGRAM_BOT_TOKEN=123:ABC\n\nIMAGE_GROUP_DAILY=10\n# GEMINI_IMAGE_MODELS=lama\n";
const fresh = () => { fs.writeFileSync(envPath, ORIGINAL); for (const f of fs.readdirSync(tmp)) if (f !== ".env") fs.unlinkSync(path.join(tmp, f)); };

// --- penguraian
assert.deepEqual(parseEnvArg(""), { kind: "status" });
assert.deepEqual(parseEnvArg("status"), { kind: "status" });
assert.deepEqual(parseEnvArg("IMAGE_GROUP_DAILY=5"), { kind: "set", key: "IMAGE_GROUP_DAILY", value: "5" });
assert.deepEqual(parseEnvArg("set image_group_daily = 5"), { kind: "set", key: "IMAGE_GROUP_DAILY", value: "5" });
assert.deepEqual(parseEnvArg("IMAGE_GROUP_DAILY 7"), { kind: "set", key: "IMAGE_GROUP_DAILY", value: "7" });
assert.deepEqual(parseEnvArg('CLOUDFLARE_API_TOKEN="abc12345"'), { kind: "set", key: "CLOUDFLARE_API_TOKEN", value: "abc12345" }, "kutip pembungkus dibuang");
assert.deepEqual(parseEnvArg("hapus IMAGE_GROUP_DAILY"), { kind: "unset", key: "IMAGE_GROUP_DAILY" });
assert.deepEqual(parseEnvArg("urungkan"), { kind: "undo" });
assert.equal(parseEnvArg("???").kind, "error");
assert.equal(parseEnvArg("KEYSAJA").kind, "error");
assert.equal(maskValue("abcdefgh1234", true), "••••1234");
assert.equal(maskValue("", true), "(kosong)");
assert.equal(maskValue("5", false), "5");
ok("penguraian /env");

// --- pengubahan .env
{
  fresh();
  const env = { IMAGE_GROUP_DAILY: "10" };
  const changes = [];
  const ed = createEnvEditor({ envPath, env, onChange: (k) => changes.push(k) });

  let r = await ed.handle("IMAGE_GROUP_DAILY=5");
  assert.match(r.text, /✅ IMAGE_GROUP_DAILY = 5/);
  assert.equal(r.secret, false);
  assert.equal(env.IMAGE_GROUP_DAILY, "5");
  assert.deepEqual(changes.at(-1), ["IMAGE_GROUP_DAILY"]);
  let txt = fs.readFileSync(envPath, "utf8");
  assert.ok(txt.includes("IMAGE_GROUP_DAILY=5\n") && !txt.includes("IMAGE_GROUP_DAILY=10"));
  assert.ok(txt.includes("SUPABASE_SERVICE_ROLE_KEY=rahasia-supabase") && txt.includes("# komentar awal") && txt.includes("# GEMINI_IMAGE_MODELS=lama"), "baris lain tidak tersentuh");

  // kunci baru ditambahkan di akhir, dan token disamarkan + ditandai rahasia
  r = await ed.handle("CLOUDFLARE_API_TOKEN=cfTOKEN_abcdef123456");
  assert.equal(r.secret, true);
  assert.match(r.text, /••••3456/);
  assert.ok(!r.text.includes("cfTOKEN_abcdef"), "token tidak pernah ditampilkan utuh");
  txt = fs.readFileSync(envPath, "utf8");
  assert.ok(txt.endsWith("CLOUDFLARE_API_TOKEN=cfTOKEN_abcdef123456\n"));
  assert.equal(env.CLOUDFLARE_API_TOKEN, "cfTOKEN_abcdef123456");
  assert.equal((fs.statSync(envPath).mode & 0o777).toString(8), "600", "izin berkas tetap tertutup");

  // daftar: rahasia disamarkan, tidak memuat kunci non-whitelist
  r = await ed.handle("");
  assert.match(r.text, /CLOUDFLARE_API_TOKEN = ••••3456/);
  assert.match(r.text, /IMAGE_GROUP_DAILY = 5/);
  assert.ok(!/SUPABASE|TELEGRAM_BOT_TOKEN/.test(r.text));
  assert.ok(!r.text.includes("cfTOKEN_abcdef"));

  // hapus
  r = await ed.handle("hapus IMAGE_GROUP_DAILY");
  assert.match(r.text, /dihapus/);
  assert.ok(!fs.readFileSync(envPath, "utf8").includes("IMAGE_GROUP_DAILY"));
  assert.equal(env.IMAGE_GROUP_DAILY, undefined);

  // urungkan: kembali ke keadaan sebelum perubahan terakhir (hapus tadi)
  r = await ed.handle("urungkan");
  assert.match(r.text, /dikembalikan/);
  assert.ok(fs.readFileSync(envPath, "utf8").includes("IMAGE_GROUP_DAILY=5"));
  assert.equal(env.IMAGE_GROUP_DAILY, "5");
  // urungkan lagi = mengulang
  await ed.handle("urungkan");
  assert.ok(!fs.readFileSync(envPath, "utf8").includes("IMAGE_GROUP_DAILY"));
}
ok("ubah/tambah/hapus/urungkan .env: baris lain utuh, token disamarkan, izin 600, env proses ikut berubah");

// --- penolakan
{
  fresh();
  const env = {};
  const ed = createEnvEditor({ envPath, env });
  const before = fs.readFileSync(envPath, "utf8");
  for (const [arg, re] of [
    ["SUPABASE_SERVICE_ROLE_KEY=baru", /tidak boleh diubah dari Telegram/],
    ["TELEGRAM_BOT_TOKEN=9:XYZ", /tidak boleh diubah dari Telegram/],
    ["WA_OWNER_NUMBER=0812", /tidak boleh/],
    ["PATH=/tmp", /tidak boleh/],
    ["IMAGE_GROUP_DAILY=banyak", /harus bilangan bulat/],
    ["IMAGE_GROUP_DAILY=99999999", /harus bilangan bulat/],
    ["CLOUDFLARE_ACCOUNT_ID=pendek", /ID akun/],
    ["CLOUDFLARE_API_TOKEN=ada spasi disini", /ditolak/],
    ["CLOUDFLARE_API_TOKEN=abc#komentar123", /ditolak/],
    ["CLOUDFLARE_API_TOKEN=abc$(rm -rf)", /ditolak/],
    ["CLOUDFLARE_ACCOUNTS=rusak", /format/],
    ["GEMINI_IMAGE_MODELS=satu dua", /ditolak/],
    ["IMAGE_PROVIDERS=facebook", /ditolak/]
  ]) {
    const r = await ed.handle(arg);
    assert.match(r.text, re, arg);
  }
  assert.equal(fs.readFileSync(envPath, "utf8"), before, ".env tidak berubah sama sekali oleh permintaan yang ditolak");
  assert.ok(!fs.existsSync(`${envPath}.bak`), "tidak ada cadangan bila tidak ada perubahan");
  assert.deepEqual(env, {});
  // percobaan mengubah kunci rahasia non-whitelist: pesan tetap ditandai rahasia agar dihapus dari chat
  assert.equal((await ed.handle("SUPABASE_SERVICE_ROLE_KEY=baru")).secret, true);
  // nilai rahasia yang ditolak juga ditandai rahasia
  assert.equal((await ed.handle("CLOUDFLARE_API_TOKEN=ada spasi disini")).secret, true);
  assert.equal((await ed.handle("CLOUDFLARE_API_TOKEN=abc#komentar123")).secret, true);
  // .env tidak ada
  const none = createEnvEditor({ envPath: path.join(tmp, "tidak-ada", ".env"), env: {} });
  assert.match((await none.handle("IMAGE_GROUP_DAILY=5")).text, /tidak ditemukan/);
  assert.match((await none.handle("urungkan")).text, /Belum ada cadangan/);
}
ok("penolakan: kunci di luar daftar putih, nilai salah/berbahaya; .env utuh; .env hilang ditangani");

// --- IMAGE_PROVIDERS dan jatah 0 (tanpa batas) bisa diatur dan berlaku langsung
{
  fresh();
  const env = {};
  const ed = createEnvEditor({ envPath, env });
  assert.match((await ed.handle("IMAGE_PROVIDERS=cloudflare,gemini")).text, /tersimpan/);
  assert.match((await ed.handle("IMAGE_OWNER_DAILY=0")).text, /tersimpan/);
  assert.equal(env.IMAGE_PROVIDERS, "cloudflare,gemini");
  const cfg = readImageConfig(env);
  assert.deepEqual(cfg.providers, ["cloudflare", "gemini"]);
  assert.equal(cfg.ownerDaily, 0);
}
ok("IMAGE_PROVIDERS dan IMAGE_OWNER_DAILY=0 dapat diatur lewat /env");

// --- kunci yang diizinkan hanya pembuat gambar
assert.deepEqual(Object.keys(ENV_KEYS).filter((k) => !/^(CLOUDFLARE_|GEMINI_IMAGE|OPENROUTER_IMAGE|IMAGE_)/.test(k)), []);
ok("daftar putih hanya berisi kunci pembuat gambar");

// --- berlaku langsung pada pembuat gambar
{
  fresh();
  const env = {};
  const img = createImageGen({ config: readImageConfig(env), fetchImpl: async () => ({ status: 200, ok: true, text: async () => "{}" }), log: silent });
  assert.equal(img.available(), false);
  const ed = createEnvEditor({ envPath, env, onChange: () => img.reconfigure(readImageConfig(env)) });
  await ed.handle("CLOUDFLARE_ACCOUNT_ID=abcd1234efgh5678");
  assert.equal(img.available(), false, "baru ID, belum ada token");
  await ed.handle("CLOUDFLARE_API_TOKEN=tokenrahasia123");
  assert.equal(img.available(), true, "aktif langsung tanpa restart");
  assert.match(img.describe(), /Cloudflare/);
  await ed.handle("hapus CLOUDFLARE_API_TOKEN");
  assert.equal(img.available(), false);
  await ed.handle("CLOUDFLARE_ACCOUNTS=aaaa1111:t1t1t1t1,bbbb2222:t2t2t2t2");
  assert.match(img.describe(), /\(2 akun\)/);
  // galat saat menerapkan -> tetap tersimpan, ada petunjuk /restart
  const bad = createEnvEditor({ envPath, env, onChange: () => { throw new Error("x"); } });
  assert.match((await bad.handle("IMAGE_TIMEOUT_MS=60000")).text, /kirim \/restart/);
}
ok("perubahan berlaku langsung pada pembuat gambar (tanpa restart); galat terapan memberi petunjuk /restart");

// --- Telegram
{
  fresh();
  const calls = [];
  const fakeFetch = async (url, init) => { calls.push({ method: String(url).split("/").pop(), body: init?.body && !(init.body instanceof FormData) ? JSON.parse(init.body) : {} }); return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
  const env = {};
  const ed = createEnvEditor({ envPath, env });
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => "AI", env: { handle: (a) => ed.handle(a) } }, fetchImpl: fakeFetch, log: silent });
  await tg.handleUpdate({ update_id: 1, message: { message_id: 77, chat: { id: 111, type: "private" }, text: "/env CLOUDFLARE_API_TOKEN=tokenrahasia123" } });
  assert.ok(calls.some((c) => c.method === "deleteMessage" && c.body.message_id === 77 && c.body.chat_id === "111"), "pesan berisi token dihapus");
  const last = calls.filter((c) => c.method === "sendMessage").at(-1).body.text;
  assert.match(last, /••••a123/);
  assert.match(last, /sudah kuhapus/);
  assert.ok(!last.includes("tokenrahasia"));
  const before = calls.length;
  await tg.handleUpdate({ update_id: 2, message: { message_id: 78, chat: { id: 111, type: "private" }, text: "/env" } });
  assert.ok(!calls.slice(before).some((c) => c.method === "deleteMessage"), "perintah tanpa rahasia tidak menghapus apa pun");
  assert.match(calls.filter((c) => c.method === "sendMessage").at(-1).body.text, /Pengaturan yang bisa diubah/);
  // bukan pemilik: diabaikan
  const b2 = calls.length;
  await tg.handleUpdate({ update_id: 3, message: { message_id: 79, chat: { id: 999, type: "private" }, text: "/env IMAGE_GROUP_DAILY=1" } });
  assert.equal(calls.length, b2);
  assert.ok(!fs.readFileSync(envPath, "utf8").includes("IMAGE_GROUP_DAILY=1\n"));
  // tanpa fitur
  const tg2 = createTelegram({ config: tcfg, deps: { chat: async () => "AI" }, fetchImpl: fakeFetch, log: silent });
  await tg2.handleUpdate({ update_id: 4, message: { message_id: 80, chat: { id: 111, type: "private" }, text: "/env" } });
  assert.match(calls.filter((c) => c.method === "sendMessage").at(-1).body.text, /tidak tersedia/);
}
ok("Telegram: /env menghapus pesan berisi token, perintah biasa tidak, bukan pemilik diabaikan, tanpa fitur");

// --- pemasangan di index.js
{
  const idx = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(idx, /createEnvEditor\(\{\s+envPath: fileURLToPath\(new URL\("\.\/\.env", import\.meta\.url\)\)/);
  assert.match(idx, /imageGen\.reconfigure\(readImageConfig\(process\.env\)\)/);
  assert.match(idx, /env: \{ handle: \(arg\) => envEditor\.handle\(arg\) \}/);
  const gi = fs.readFileSync(new URL("./.gitignore", import.meta.url), "utf8");
  assert.ok(/^\.env\.bak$/m.test(gi), "cadangan .env tidak boleh masuk git");
  const tel = fs.readFileSync(new URL("./telegram.js", import.meta.url), "utf8");
  assert.match(tel, /if \(viaVoice\) return void \(await reply\("⛔ \/env tidak bisa lewat pesan suara/);
}
ok("index.js, .gitignore, dan pemblokir lewat suara terpasang");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} kelompok tes lulus ✅`);
