// Tes pembuat gambar (image-gen.js). Jalankan: node test-image-gen.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCfAccounts, detectImageRequest, promptProblem, parseImageResponse, createImageGen, readImageConfig, DEFAULT_IMAGE_MODELS, STATE_KEY, QUOTA_KEY } from "./image-gen.js";
import { qrToPng } from "./qr-png.js";
import { createTelegram } from "./telegram.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) }; };

const png = qrToPng("contoh gambar untuk tes", { scale: 8 });
assert.ok(png.length > 400);
const b64 = Buffer.from(png).toString("base64");
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

// --- pengenalan permintaan
const P = (t) => detectImageRequest(t)?.prompt;
assert.equal(P("buatkan gambar kucing memakai topi"), "kucing memakai topi");
assert.equal(P("Tolong buatin gambar pemandangan gunung saat senja"), "pemandangan gunung saat senja");
assert.equal(P("bikin gambar tentang persahabatan"), "persahabatan");
assert.equal(P("buat sebuah gambar rumah adat"), "rumah adat");
assert.equal(P("buatkan logo kopi susu"), "logo kopi susu");
assert.equal(P("bisa buatkan poster seminar keuangan?"), "poster seminar keuangan?");
assert.equal(P("/gambar naga terbang di atas laut"), "naga terbang di atas laut");
assert.equal(P("/gambar@AyyubiBot robot lucu"), "robot lucu");
assert.equal(P("generate an image of a red bicycle"), "a red bicycle");
ok("penguraian permintaan Indonesia & /gambar");

assert.equal(P("create image a red bicycle"), "a red bicycle");
assert.equal(P("draw me a cat in space"), "cat in space");
assert.deepEqual(detectImageRequest("buatkan gambar"), { prompt: "" });
assert.deepEqual(detectImageRequest("/gambar"), { prompt: "" });
assert.deepEqual(detectImageRequest("buatkan logo"), { prompt: "" });
assert.deepEqual(detectImageRequest("buatkan gambarnya"), { prompt: "" });
ok("tanpa deskripsi -> prompt kosong (bot minta deskripsi)");

for (const t of [
  "gambar ini apa ya?", "kirim gambarnya dong", "jelaskan gambaran ekonomi tahun ini", "gambarkan situasi di kantor",
  "kemarin dia buat laporan keuangan", "buatkan laporan kas bulan ini", "bikin surat dinas", "halo apa kabar", "", "foto itu bagus banget",
  "aku suka gambar anime", "buat kopi dong"
]) assert.equal(detectImageRequest(t), null, `bukan permintaan: ${t}`);
ok("kalimat biasa / pertanyaan tentang gambar tidak dianggap permintaan");

// --- filter
assert.ok(promptProblem("gambar wanita telanjang"));
assert.ok(promptProblem("foto bugil artis"));
assert.ok(promptProblem("buat kwitansi palsu 5 juta"));
assert.ok(promptProblem("stempel instansi palsu"));
assert.ok(promptProblem("ktp palsu"));
assert.equal(promptProblem("kucing lucu bermain di taman"), null);
assert.equal(promptProblem("kuitansi pembelian ATK yang rapi sebagai ilustrasi infografis"), null);
ok("filter: konten dewasa & dokumen/bukti palsu ditolak, permintaan wajar lolos");

// --- membaca respons
{
  const interactions = { steps: [{ type: "thought", summary: [{ type: "image", mime_type: "image/png", data: Buffer.alloc(900, 1).toString("base64") }] }, { type: "model_output", content: [{ type: "text", text: "Ini gambarnya" }, { type: "image", mime_type: "image/png", data: b64 }] }] };
  const r = parseImageResponse(interactions);
  assert.deepEqual([...r.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(r.mime, "image/png");
  assert.equal(r.text, "Ini gambarnya");
  const gen = { candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: b64 } }] } }] };
  assert.ok(parseImageResponse(gen).buffer.equals(r.buffer));
  const snake = { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: b64 } }] } }] };
  assert.ok(parseImageResponse(snake).buffer);
  assert.equal(parseImageResponse({ candidates: [{ finishReason: "SAFETY" }] }).buffer, null);
  assert.equal(parseImageResponse({}).buffer, null);
}
ok("respons Interactions & generateContent terbaca (gambar 'thought' diabaikan)");

const cfg = (over = {}) => ({ ...readImageConfig({ GEMINI_API_KEYS: "k1,k2" }), ...over });

// --- konfigurasi
{
  const c = readImageConfig({});
  assert.deepEqual([c.keys.length, c.models, c.ownerDaily, c.groupDaily, c.personDaily], [0, DEFAULT_IMAGE_MODELS, 30, 10, 3]);
  const d = readImageConfig({ GEMINI_API_KEYS: "a, b", GEMINI_IMAGE_MODELS: "m1,m2", IMAGE_GROUP_DAILY: "0", IMAGE_PERSON_DAILY: "5", IMAGE_TIMEOUT_MS: "1" });
  assert.deepEqual([d.keys, d.models, d.groupDaily, d.personDaily, d.timeoutMs], [["a", "b"], ["m1", "m2"], 0, 5, 10000]);
}
ok("konfigurasi .env + bawaan");

// --- generate: jalur Interactions berhasil
{
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), key: init.headers["x-goog-api-key"] }); return res(200, { steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: b64 }] }] }); };
  const g = createImageGen({ config: cfg(), fetchImpl, log: silent });
  const out = await g.generate("kucing");
  assert.equal(out.model, DEFAULT_IMAGE_MODELS[0]);
  assert.ok(out.buffer.length > 400);
  assert.match(calls[0].url, /\/v1beta\/interactions$/);
  assert.equal(calls[0].body.model, DEFAULT_IMAGE_MODELS[0]);
  assert.deepEqual(calls[0].body.input, [{ type: "text", text: "kucing" }]);
  assert.equal(calls.length, 1);
}
ok("jalur Interactions: permintaan benar, gambar dikembalikan");

// --- jalur Interactions ditolak (404) -> generateContent, lalu diingat
{
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    if (/interactions/.test(url)) return res(404, { error: { message: "not found" } });
    const body = JSON.parse(init.body);
    assert.deepEqual(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
    return res(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: b64 } }] } }] });
  };
  const g = createImageGen({ config: cfg({ keys: ["k1"] }), fetchImpl, log: silent });
  await g.generate("a");
  assert.equal(urls.length, 2);
  urls.length = 0;
  await g.generate("b");
  assert.equal(urls.length, 1);
  assert.match(urls[0], /:generateContent$/, "jalur yang berhasil diingat");
}
ok("cadangan generateContent + mengingat jalur yang berhasil");

// --- kuota habis di key pertama -> key kedua; semua habis -> model berikutnya; semua habis -> galat quota
{
  const seen = [];
  const fetchImpl = async (url, init) => {
    const key = init.headers["x-goog-api-key"]; const model = JSON.parse(init.body).model;
    seen.push(`${model}:${key}`);
    if (model === "m1") return res(429, { error: { status: "RESOURCE_EXHAUSTED" } });
    if (key === "k1") return res(429, "quota");
    return res(200, { steps: [{ type: "model_output", content: [{ type: "image", data: b64, mime_type: "image/png" }] }] });
  };
  const g = createImageGen({ config: cfg({ models: ["m1", "m2"] }), fetchImpl, log: silent });
  const out = await g.generate("x");
  assert.equal(out.model, "m2");
  assert.ok(seen.includes("m1:k1") && seen.includes("m1:k2") && seen.includes("m2:k2"));

  const allQuota = createImageGen({ config: cfg(), fetchImpl: async () => res(429, "RESOURCE_EXHAUSTED"), log: silent });
  await assert.rejects(allQuota.generate("x"), (e) => e.kind === "quota" && /habis/.test(e.message));
}
ok("rotasi key & model saat kuota habis; semua habis -> kind quota");

// --- ditolak keamanan, tanpa gambar, auth, billing, server
{
  const blocked = createImageGen({ config: cfg(), fetchImpl: async () => res(200, { candidates: [{ finishReason: "IMAGE_SAFETY" }] }), log: silent });
  await assert.rejects(blocked.generate("x"), (e) => e.kind === "blocked");
  const textOnly = createImageGen({ config: cfg(), fetchImpl: async () => res(200, { steps: [{ type: "model_output", content: [{ type: "text", text: "Maaf saya tidak bisa membuat itu" }] }] }), log: silent });
  await assert.rejects(textOnly.generate("x"), (e) => e.kind === "blocked");
  const auth = createImageGen({ config: cfg(), fetchImpl: async () => res(403, { error: { status: "PERMISSION_DENIED", message: "API key not valid" } }), log: silent });
  await assert.rejects(auth.generate("x"), (e) => e.kind === "auth");
  const billing = createImageGen({ config: cfg(), fetchImpl: async () => res(403, { error: { message: "This model is only available on paid tier. Enable billing." } }), log: silent });
  await assert.rejects(billing.generate("x"), (e) => e.kind === "billing");
  const down = createImageGen({ config: cfg(), fetchImpl: async () => res(503, "overloaded"), log: silent });
  await assert.rejects(down.generate("x"), (e) => e.kind === "unavailable");
  const boom = createImageGen({ config: cfg(), fetchImpl: async () => { throw new Error("socket hang up"); }, log: silent });
  await assert.rejects(boom.generate("x"), (e) => e.kind === "unavailable");
  const nokey = createImageGen({ config: readImageConfig({}), fetchImpl: async () => res(200, {}), log: silent });
  assert.equal(nokey.available(), false);
  assert.equal(nokey.groupEnabled(), false);
  await assert.rejects(nokey.generate("x"), (e) => e.kind === "nokey");
}
ok("galat: ditolak filter, tanpa gambar, kunci ditolak, butuh billing, server mati, tanpa kunci");

// --- jatah harian
{
  let t = Date.parse("2026-10-15T01:00:00Z");
  const st = mem();
  const g = createImageGen({ state: st, config: cfg({ ownerDaily: 2, groupDaily: 3, personDaily: 2 }), fetchImpl: async () => res(200, {}), log: silent, now: () => t });
  assert.ok((await g.reserve("group", "a")).ok);
  assert.ok((await g.reserve("group", "a")).ok);
  const third = await g.reserve("group", "a");
  assert.equal(third.ok, false);
  assert.match(third.reason, /gambarmu/);
  const b = await g.reserve("group", "b");
  assert.ok(b.ok);
  const full = await g.reserve("group", "c");
  assert.equal(full.ok, false);
  assert.match(full.reason, /semua grup/);
  await b.release();
  assert.ok((await g.reserve("group", "c")).ok, "dikembalikan saat gagal");
  assert.ok((await g.reserve("owner")).ok);
  assert.ok((await g.reserve("owner")).ok);
  assert.equal((await g.reserve("owner")).ok, false);
  assert.equal(st.m.get(QUOTA_KEY).owner, 2);
  // hari berikutnya (WITA): reset
  t += 24 * 3600_000;
  assert.ok((await g.reserve("owner")).ok);
  assert.ok((await g.reserve("group", "a")).ok);
  // dimuat ulang di hari yang sama: jatah ikut terbaca
  const g2 = createImageGen({ state: st, config: cfg({ ownerDaily: 2 }), fetchImpl: async () => res(200, {}), log: silent, now: () => t });
  await g2.load();
  assert.ok((await g2.reserve("owner")).ok);
  assert.equal((await g2.reserve("owner")).ok, false, "restart bot tidak mengosongkan jatah");
  // 0 = tanpa batas
  const unl = createImageGen({ config: cfg({ groupDaily: 0, personDaily: 0 }), fetchImpl: async () => res(200, {}), log: silent });
  for (let i = 0; i < 50; i++) assert.ok((await unl.reserve("group", "z")).ok);
}
ok("jatah harian: per orang, semua grup, pemilik, pengembalian, reset hari WITA, tahan restart, 0 = tanpa batas");

// --- make(): satu paket
{
  const ok200 = async () => res(200, { steps: [{ type: "model_output", content: [{ type: "image", data: b64, mime_type: "image/png" }] }] });
  const g = createImageGen({ config: cfg({ personDaily: 1 }), fetchImpl: ok200, log: silent });
  assert.equal((await g.make("")).kind, "empty");
  assert.equal((await g.make("gambar bugil")).kind, "refused");
  const a = await g.make("kucing lucu", "group", "u1");
  assert.ok(a.image.buffer.length > 400);
  const b = await g.make("kucing lucu", "group", "u1");
  assert.equal(b.kind, "limit");
  // gagal membuat -> jatah dikembalikan
  let fail = true;
  const g2 = createImageGen({ config: cfg({ personDaily: 1 }), fetchImpl: async () => (fail ? res(503, "x") : ok200()), log: silent });
  const f = await g2.make("rumah", "group", "u2");
  assert.equal(f.kind, "unavailable");
  fail = false;
  assert.ok((await g2.make("rumah", "group", "u2")).image, "jatah tidak terpakai oleh percobaan yang gagal");
  assert.equal((await createImageGen({ config: readImageConfig({}), log: silent }).make("rumah")).kind, "nokey");
}
ok("make(): deskripsi kosong/ditolak/batas/gagal -> jatah dikembalikan");

// --- saklar grup + perintah
{
  const st = mem();
  const g = createImageGen({ state: st, config: cfg(), fetchImpl: async () => res(200, {}), log: silent });
  await g.load();
  assert.equal(g.groupEnabled(), true, "bawaan aktif");
  assert.deepEqual(await g.setGroup(false), { on: false, saved: true });
  assert.equal(st.m.get(STATE_KEY), "off");
  assert.equal(g.groupEnabled(), false);
  const g2 = createImageGen({ state: st, config: cfg(), fetchImpl: async () => res(200, {}), log: silent });
  await g2.load();
  assert.equal(g2.groupEnabled(), false, "tersimpan lewat restart");
  assert.match(g2.describe(), /grup: mati/);
  assert.deepEqual(g.parseCommand(""), { kind: "status" });
  assert.deepEqual(g.parseCommand("grup off"), { kind: "group", value: false });
  assert.deepEqual(g.parseCommand("on"), { kind: "group", value: true });
  assert.deepEqual(g.parseCommand("wag aktif"), { kind: "group", value: true });
  assert.deepEqual(g.parseCommand("kucing lucu"), { kind: "prompt", prompt: "kucing lucu" });
  const broken = createImageGen({ state: { get: async () => { throw new Error("db"); }, set: async () => { throw new Error("db"); } }, config: cfg(), fetchImpl: async () => res(200, {}), log: silent });
  await broken.load();
  assert.equal(broken.groupEnabled(), true);
  assert.equal((await broken.setGroup(false)).saved, false);
}
ok("saklar grup tersimpan, perintah /gambar, DB galat tidak merusak");

// --- keamanan sumber: kunci API tidak ditulis ke log / URL
{
  const src = fs.readFileSync(new URL("./image-gen.js", import.meta.url), "utf8");
  assert.ok(!/[?&]key=/.test(src), "kunci dikirim lewat header, bukan URL");
  assert.ok(!/console\.\w+\([^)]*\bkey\b/.test(src));
}
ok("kunci API lewat header (bukan URL) dan tidak dicetak");

// --- Cloudflare Workers AI (gratis, penyedia pertama)
{
  const cfCfg = (over = {}) => ({ ...cfg(), cfAccounts: [{ account: "acc123", token: "tok" }], cfModels: ["@cf/black-forest-labs/flux-1-schnell"], providers: ["cloudflare", "gemini", "openrouter"], ...over });
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7)]).toString("base64");
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return res(200, { result: { image: jpg }, success: true, errors: [], messages: [] });
  };
  const translated = [];
  const g = createImageGen({ config: cfCfg(), fetchImpl, log: silent, translate: async (t) => { translated.push(t); return "a cat wearing an astronaut hat"; } });
  const out = await g.generate("kucing memakai topi astronot");
  assert.equal(out.model, "cloudflare:@cf/black-forest-labs/flux-1-schnell");
  assert.equal(out.mime, "image/jpeg");
  assert.equal(seen.length, 1, "Gemini tidak dipanggil bila Cloudflare berhasil");
  assert.equal(seen[0].url, "https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/black-forest-labs/flux-1-schnell");
  assert.equal(seen[0].init.headers.authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(seen[0].init.body), { prompt: "a cat wearing an astronaut hat", steps: 4 });
  assert.deepEqual(translated, ["kucing memakai topi astronot"]);
  // terjemahan gagal -> deskripsi asli
  const g2 = createImageGen({ config: cfCfg(), fetchImpl, log: silent, translate: async () => { throw new Error("groq mati"); } });
  seen.length = 0;
  await g2.generate("rumah adat");
  assert.equal(JSON.parse(seen[0].init.body).prompt, "rumah adat");
  // hanya Cloudflare (tanpa kunci lain) sudah cukup
  const only = createImageGen({ config: readImageConfig({ CLOUDFLARE_ACCOUNT_ID: "acc12345", CLOUDFLARE_API_TOKEN: "token12345" }), fetchImpl, log: silent });
  assert.equal(only.available(), true);
  assert.match(only.describe(), /GRATIS: Cloudflare flux-1-schnell/);
  // jatah harian Cloudflare habis -> Gemini; keduanya habis -> kind quota
  const urls = [];
  const fb = createImageGen({
    config: cfCfg({ keys: ["k1"] }),
    fetchImpl: async (u) => {
      urls.push(u);
      if (/cloudflare/.test(u)) return res(429, { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] });
      return res(200, { steps: [{ type: "model_output", content: [{ type: "image", data: b64, mime_type: "image/png" }] }] });
    },
    log: silent
  });
  const o2 = await fb.generate("x");
  assert.match(o2.model, /^gemini/);
  assert.ok(/cloudflare/.test(urls[0]) && /googleapis/.test(urls[1]));
  const bothOut = createImageGen({ config: cfCfg(), fetchImpl: async () => res(400, { errors: [{ code: 4006, message: "daily free allocation of neurons used up" }] }), log: silent });
  await assert.rejects(bothOut.generate("x"), (e) => e.kind === "quota" && /Cloudflare/.test(e.detail));
  // ditolak moderasi -> blocked, penyedia lain tidak dicoba
  const nsfwUrls = [];
  const nsfw = createImageGen({ config: cfCfg({ keys: ["k1"] }), fetchImpl: async (u) => { nsfwUrls.push(u); return res(400, { errors: [{ message: "NSFW content flagged" }] }); }, log: silent });
  await assert.rejects(nsfw.generate("x"), (e) => e.kind === "blocked");
  assert.equal(nsfwUrls.length, 1);
  // token tidak bocor ke log/URL
  const src = fs.readFileSync(new URL("./image-gen.js", import.meta.url), "utf8");
  assert.ok(!/log\.\w+\?\.\([^)]*(?:cfToken|acc\.token)/.test(src));
}
ok("Cloudflare: penyedia pertama, terjemahan prompt, jatah habis -> Gemini, moderasi -> ditolak, cukup tanpa kunci lain");

// --- penyedia: otomatis hanya Cloudflare bila terisi; IMAGE_PROVIDERS mengatur manual
{
  assert.deepEqual(readImageConfig({}).providers, []);
  assert.deepEqual(readImageConfig({ IMAGE_PROVIDERS: "Cloudflare, gemini ,ngawur" }).providers, ["cloudflare", "gemini"]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7)]).toString("base64");
  const urls = [];
  const quotaCf = async (u) => { urls.push(u); return /cloudflare/.test(u) ? res(429, { errors: [{ code: 4006, message: "daily free allocation of neurons used up" }] }) : res(200, { result: { image: jpg } }); };
  // Cloudflare terisi + kunci Gemini/OpenRouter ada, tanpa IMAGE_PROVIDERS -> HANYA Cloudflare
  const base = readImageConfig({ CLOUDFLARE_ACCOUNT_ID: "acc12345", CLOUDFLARE_API_TOKEN: "token12345", GEMINI_API_KEYS: "k1", OPENROUTER_API_KEYS: "or1" });
  const only = createImageGen({ config: base, fetchImpl: quotaCf, log: silent });
  await assert.rejects(only.generate("x"), (e) => e.kind === "quota" && /jatah gratis pulih/.test(e.message) && !/Gemini/.test(e.message));
  assert.ok(urls.every((u) => /cloudflare/.test(u)), "Gemini/OpenRouter tidak pernah dipanggil");
  // tanpa Cloudflare -> Gemini/OpenRouter seperti semula
  assert.equal(createImageGen({ config: readImageConfig({ GEMINI_API_KEYS: "k1" }), fetchImpl: quotaCf, log: silent }).monitor().providers[0], "gemini");
  // IMAGE_PROVIDERS memaksa: cloudflare saja walau tak ada kunci lain; hanya gemini walau Cloudflare ada
  assert.equal(createImageGen({ config: { ...base, providers: ["gemini"] }, fetchImpl: quotaCf, log: silent }).monitor().providers.join(), "gemini");
  assert.equal(createImageGen({ config: readImageConfig({ IMAGE_PROVIDERS: "cloudflare", GEMINI_API_KEYS: "k1" }), fetchImpl: quotaCf, log: silent }).available(), false, "dipaksa Cloudflare tetapi tak terisi -> belum aktif");
}
ok("penyedia: otomatis hanya Cloudflare bila terisi; IMAGE_PROVIDERS memaksa; tanpa Cloudflare tetap Gemini/OpenRouter");

// --- pemantauan
{
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7)]).toString("base64");
  let t = Date.parse("2026-10-15T10:00:00Z");
  const st = mem();
  let mode = "ok";
  const fetchImpl = async () => (mode === "ok" ? res(200, { result: { image: jpg } }) : mode === "quota" ? res(429, { errors: [{ code: 4006, message: "daily free allocation of neurons used up" }] }) : res(500, "boom"));
  const mk = () => createImageGen({ state: st, config: { ...cfg({ keys: [] }), cfAccounts: [{ account: "aaaa1111", token: "t1t1t1t1" }], cfModels: ["@cf/m"] }, fetchImpl, log: silent, now: () => t });
  let g = mk();
  for (let i = 0; i < 5; i++) await g.generate("x");
  mode = "err";
  await assert.rejects(g.generate("x"));
  let m = g.monitor();
  assert.deepEqual(m.providers, ["cloudflare"]);
  assert.equal(m.today.byProvider.cloudflare.ok, 5);
  assert.equal(m.today.byProvider.cloudflare.fail, 1);
  assert.equal(m.cloudflare[0].id, "…1111");
  assert.equal(m.cloudflare[0].ok, 5);
  assert.equal(m.cloudflare[0].usedNeurons, 288, "5 x 57,6 neuron");
  assert.equal(m.cloudflare[0].imagesLeft, Math.floor((10000 - 288) / 57.6));
  assert.equal(m.cloudflare[0].resting, false);
  assert.match(m.lastError, /cloudflare 1111: HTTP 500 server/);
  assert.equal(m.resetAt, Date.parse("2026-10-16T00:00:00Z"));
  const txt = g.monitorText((ms) => new Date(ms).toISOString().slice(11, 16));
  assert.match(txt, /cloudflare • grup aktif • hari ini 5 berhasil, 1 gagal/);
  assert.match(txt, /Cloudflare …1111: 5 gambar ≈ 288\/10\.000 neuron \(sisa ±\d+ gambar\), reset 00:00/);
  assert.match(txt, /Galat terakhir: cloudflare 1111/);
  assert.ok(!txt.includes("aaaa1111") && !txt.includes("t1t1t1t1"), "ID penuh dan token tidak tampil");
  // jatah habis -> status 'JATAH HABIS (pulih ...)'
  mode = "quota";
  await assert.rejects(g.generate("x"));
  assert.match(g.monitorText((ms) => new Date(ms).toISOString().slice(11, 16)), /JATAH HABIS \(pulih 00:00\)/);
  assert.equal(g.monitor().cloudflare[0].resting, true);
  // tersimpan: instance baru di hari yang sama membaca hitungan
  await new Promise((r) => setTimeout(r, 5));
  g = mk();
  await g.load();
  assert.equal(g.monitor().cloudflare[0].ok, 5);
  // ganti hari UTC: hitungan nol lagi, tetapi galat terakhir tetap diingat
  t = Date.parse("2026-10-16T00:00:05Z");
  m = g.monitor();
  assert.equal(m.cloudflare[0].ok, 0);
  assert.equal(m.cloudflare[0].imagesLeft, Math.floor(10000 / 57.6));
  assert.equal(m.today.day, "2026-10-16");
  // describe memuat jatah buatan bot + pemantauan
  assert.match(g.describe(), /Jatah hari ini \(batas buatan bot\)/);
  assert.match(g.describe(), /Cloudflare …1111/);
  // mati: petunjuk
  assert.match(createImageGen({ config: readImageConfig({}), log: silent }).monitorText(), /mati \(isi CLOUDFLARE/);
  // DB galat tidak mengganggu pemantauan
  const bad = createImageGen({ state: { get: async () => { throw new Error("db"); }, set: async () => { throw new Error("db"); } }, config: { ...cfg({ keys: [] }), cfAccounts: [{ account: "aaaa1111", token: "t1t1t1t1" }], cfModels: ["@cf/m"] }, fetchImpl: async () => res(200, { result: { image: jpg } }), log: silent });
  await bad.generate("x");
  assert.equal(bad.monitor().today.byProvider.cloudflare.ok, 1);
}
ok("pemantauan: hitungan per penyedia & akun, perkiraan neuron, reset 00:00 UTC, tersimpan, tahan DB galat, tanpa rahasia");

// --- Gemini "limit: 0": berhenti mencoba, rincian tanpa baris ganda
{
  let calls = 0; let t = Date.parse("2026-10-15T10:00:00Z");
  const fetchImpl = async () => { calls++; return res(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Rate limit exceeded for model x (limit: 0 requests per day on Free Tier)." } }); };
  const g = createImageGen({ config: cfg({ models: ["m1", "m2"] }), fetchImpl, log: silent, now: () => t });
  await assert.rejects(g.generate("x"), (e) => {
    const lines = e.detail.split("\n");
    assert.equal(new Set(lines).size, lines.length, "tidak ada baris rincian ganda");
    return e.kind === "quota";
  });
  assert.equal(calls, 1, "setelah 'limit: 0' pertama, sisa key/model/jalur tidak dicoba lagi");
  calls = 0;
  await assert.rejects(g.generate("y"), (e) => /dilewati/.test(e.detail));
  assert.equal(calls, 0, "6 jam berikutnya Gemini tidak dipanggil sama sekali");
  t += 6 * 3600_000 + 1000;
  await assert.rejects(g.generate("z"));
  assert.equal(calls, 1, "setelah 6 jam dicoba lagi");
  // reconfigure (mis. dari /env) membersihkan istirahat
  calls = 0;
  g.reconfigure(cfg({ models: ["m1"] }));
  await assert.rejects(g.generate("z"));
  assert.equal(calls, 1);
  // 429 biasa (bukan limit 0) tetap merotasi key
  let n429 = 0;
  const g2 = createImageGen({ config: cfg(), fetchImpl: async () => { n429++; return res(429, "RESOURCE_EXHAUSTED rate limit"); }, log: silent });
  await assert.rejects(g2.generate("x"));
  assert.ok(n429 >= 2, "kuota sementara: semua key dicoba");
}
ok("Gemini 'limit: 0': dilewati 6 jam, rincian tanpa baris ganda, /env membersihkan, 429 biasa tetap rotasi");

// --- Cloudflare: banyak akun (rotasi)
{
  assert.deepEqual(parseCfAccounts({}), []);
  assert.deepEqual(parseCfAccounts({ CLOUDFLARE_ACCOUNT_ID: "abc12345", CLOUDFLARE_API_TOKEN: "tokenpanjang1" }), [{ account: "abc12345", token: "tokenpanjang1" }]);
  assert.deepEqual(
    parseCfAccounts({ CLOUDFLARE_ACCOUNT_ID: "abc12345", CLOUDFLARE_API_TOKEN: "tokenpanjang1", CLOUDFLARE_ACCOUNTS: "abc12345:tokenpanjang1, def67890:tok-dua_xyz:aneh ,rusak,:x,ghi:pendek" }),
    [{ account: "abc12345", token: "tokenpanjang1" }, { account: "def67890", token: "tok-dua_xyz:aneh" }],
    "duplikat dibuang, entri rusak/terlalu pendek diabaikan, titik dua di token dipertahankan"
  );
  assert.equal(readImageConfig({ CLOUDFLARE_ACCOUNTS: "abc12345:tokenpanjang1" }).cfAccounts.length, 1);

  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7)]).toString("base64");
  let t = Date.parse("2026-10-15T10:00:00Z");
  const used = [];
  const exhausted = new Set();
  const fetchImpl = async (url, init) => {
    const acc = /accounts\/(\w+)\//.exec(url)[1];
    used.push(acc);
    if (exhausted.has(acc)) return res(429, { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] });
    return res(200, { result: { image: jpg }, success: true });
  };
  const config = { ...cfg({ keys: [] }), cfAccounts: [{ account: "aaaa1111", token: "t1t1t1t1" }, { account: "bbbb2222", token: "t2t2t2t2" }, { account: "cccc3333", token: "t3t3t3t3" }], cfModels: ["@cf/m"] };
  const g = createImageGen({ config, fetchImpl, log: silent, now: () => t });
  // rotasi bergilir antar akun
  for (let i = 0; i < 3; i++) await g.generate("x");
  assert.deepEqual([...new Set(used)].sort(), ["aaaa1111", "bbbb2222", "cccc3333"], "ketiga akun dipakai bergantian");
  assert.match(g.describe(), /\(3 akun\)/);
  // akun pertama habis -> pindah ke berikutnya dan diistirahatkan sampai 00:00 UTC
  used.length = 0; exhausted.add("aaaa1111"); exhausted.add("bbbb2222");
  const out = await g.generate("x");
  assert.equal(out.model, "cloudflare:@cf/m");
  assert.equal(used.at(-1), "cccc3333");
  used.length = 0;
  for (let i = 0; i < 4; i++) await g.generate("x");
  assert.ok(!used.includes("aaaa1111") && !used.includes("bbbb2222"), "akun yang habis tidak dipanggil lagi hari ini");
  // semua habis -> kind quota, tanpa memanggil siapa pun lagi
  exhausted.add("cccc3333");
  await assert.rejects(g.generate("x"), (e) => e.kind === "quota");
  used.length = 0;
  await assert.rejects(g.generate("x"), (e) => e.kind === "quota" && /semua akun sedang istirahat/.test(e.detail));
  assert.equal(used.length, 0);
  // lewat 00:00 UTC: semua akun dicoba lagi
  exhausted.clear();
  t = Date.parse("2026-10-16T00:00:05Z");
  used.length = 0;
  await g.generate("x");
  assert.equal(used.length, 1);
  // token ditolak (401) -> akun diistirahatkan 1 jam, akun lain tetap jalan
  const bad = new Set(["aaaa1111"]);
  const g2 = createImageGen({
    config,
    fetchImpl: async (url) => { const acc = /accounts\/(\w+)\//.exec(url)[1]; used.push(acc); return bad.has(acc) ? res(403, { errors: [{ message: "Authentication error" }] }) : res(200, { result: { image: jpg } }); },
    log: silent,
    now: () => t
  });
  used.length = 0;
  for (let i = 0; i < 5; i++) await g2.generate("x");
  assert.equal(used.filter((a) => a === "aaaa1111").length, 1, "akun bertoken salah dicoba sekali lalu diistirahatkan");
  // ID akun hanya 4 digit terakhir di rincian
  const g3 = createImageGen({ config: { ...config, cfAccounts: [{ account: "aaaa1111", token: "t1t1t1t1" }] }, fetchImpl: async () => res(500, "boom"), log: silent, now: () => t });
  await assert.rejects(g3.generate("x"), (e) => /…1111/.test(e.detail) && !/aaaa1111/.test(e.detail) && !/t1t1t1t1/.test(e.detail));
}
ok("Cloudflare banyak akun: parsing, rotasi, istirahat saat jatah habis (pulih 00:00 UTC), token ditolak, ID disamarkan");

// --- cadangan OpenRouter
{
  const dataUrl = `data:image/png;base64,${b64}`;
  const orOk = { choices: [{ message: { role: "assistant", content: "ok", images: [{ type: "image_url", image_url: { url: dataUrl } }] } }] };
  assert.ok(parseImageResponse(orOk).buffer, "data URL OpenRouter terbaca");
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    if (/googleapis/.test(url)) return res(429, "RESOURCE_EXHAUSTED");
    assert.equal(init.headers.authorization, "Bearer or1");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.modalities, ["image", "text"]);
    assert.equal(body.model, "google/gemini-2.5-flash-image");
    return res(200, orOk);
  };
  const g = createImageGen({ config: { ...cfg({ keys: ["k1"] }), orKeys: ["or1"], orModels: ["google/gemini-2.5-flash-image"] }, fetchImpl, log: silent });
  const out = await g.generate("kucing");
  assert.equal(out.model, "openrouter:google/gemini-2.5-flash-image");
  assert.ok(seen.some((u) => /openrouter\.ai/.test(u)) && seen.some((u) => /googleapis/.test(u)));
  // tanpa kunci Gemini, hanya OpenRouter
  const only = createImageGen({ config: readImageConfig({ OPENROUTER_API_KEYS: "or1" }), fetchImpl, log: silent });
  assert.equal(only.available(), true);
  assert.equal((await only.generate("x")).model, "openrouter:google/gemini-2.5-flash-image");
  // OpenRouter kehabisan kredit -> billing; Gemini ditolak filter -> OpenRouter tidak dicoba
  const noCredit = createImageGen({ config: { ...cfg({ keys: [] }), orKeys: ["or1"], orModels: ["m"] }, fetchImpl: async () => res(402, "Insufficient credits"), log: silent });
  await assert.rejects(noCredit.generate("x"), (e) => e.kind === "billing");
  // Gemini kuota habis + OpenRouter butuh saldo $1 (kasus nyata): kind billing, rincian untuk pemilik, pesan grup tanpa jargon
  const both = createImageGen({
    config: { ...cfg({ keys: ["k1"] }), orKeys: ["or1"], orModels: ["google/gemini-2.5-flash-image"] },
    fetchImpl: async (u) => (/googleapis/.test(u) ? res(429, { error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded, limit: 0" } }) : res(402, { error: { message: "This request requires at least $1.00 in balance for image or video output", code: 402 } })),
    log: silent
  });
  const r2 = await both.make("kucing", "group", "u");
  assert.equal(r2.kind, "billing");
  assert.match(r2.detail, /Gemini .*429 quota/);
  assert.match(r2.detail, /OpenRouter .*402 billing.*\$1\.00/);
  assert.ok(!/OpenRouter|\$1/.test(r2.error), "pesan untuk grup tidak berisi jargon penyedia");
  const orCalls = [];
  const blocked = createImageGen({ config: { ...cfg({ keys: ["k1"] }), orKeys: ["or1"], orModels: ["m"] }, fetchImpl: async (u) => { orCalls.push(u); return res(200, { candidates: [{ finishReason: "IMAGE_SAFETY" }] }); }, log: silent });
  await assert.rejects(blocked.generate("x"), (e) => e.kind === "blocked");
  assert.ok(!orCalls.some((u) => /openrouter/.test(u)));
  assert.match(createImageGen({ config: { ...cfg(), orKeys: ["o"], orModels: ["m"] }, log: silent }).describe(), /OpenRouter m/);
}
ok("cadangan OpenRouter: dipakai saat Gemini habis/tanpa kunci, 402 = billing, ditolak filter tidak dicoba ulang");

// --- Telegram /gambar
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const form = init?.body instanceof FormData;
    calls.push({ method, form, body: init?.body && !form ? JSON.parse(init.body) : {}, fd: form ? init.body : null });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const st = mem();
  const ok200 = async () => res(200, { steps: [{ type: "model_output", content: [{ type: "image", data: b64, mime_type: "image/png" }] }] });
  const ig = createImageGen({ state: st, config: cfg(), fetchImpl: ok200, log: silent });
  const deps = { chat: async () => "x", image: { available: () => ig.available(), describe: () => ig.describe(), parseCommand: (a) => ig.parseCommand(a), setGroup: (v) => ig.setGroup(v), make: (p) => ig.make(p, "owner") } };
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps, fetchImpl: fakeFetch, log: silent });
  const say = async (text, id) => { await tg.handleUpdate({ update_id: id, message: { chat: { id: 111, type: "private" }, text } }); return calls.filter((c) => c.method === "sendMessage").at(-1)?.body.text; };
  let t = await say("/gambar", 1);
  assert.ok(/Pembuat gambar/.test(t) && /grup: AKTIF/.test(t) && /Jatah hari ini/.test(t));
  t = await say("/gambar grup off", 2);
  assert.ok(/MATI/.test(t) && !ig.groupEnabled() && st.m.get(STATE_KEY) === "off");
  t = await say("/gambar grup on", 3);
  assert.ok(/AKTIF/.test(t) && ig.groupEnabled());
  const before = calls.length;
  await say("/gambar kucing memakai topi astronot", 4);
  const photo = calls.slice(before).find((c) => c.method === "sendPhoto");
  assert.ok(photo && photo.form, "dikirim sebagai foto");
  assert.ok(photo.fd.get("photo").size > 400);
  assert.equal(calls.slice(before).filter((c) => c.method === "sendChatAction").length > 0, true, "indikator 'mengirim foto'");
  t = await say("/gambar gambar bugil", 5);
  assert.match(t, /tidak bisa saya buat/);
  const tg2 = createTelegram({ config: tcfg, deps: { chat: async () => "x" }, fetchImpl: fakeFetch, log: silent });
  await tg2.handleUpdate({ update_id: 9, message: { chat: { id: 111, type: "private" }, text: "/gambar kucing" } });
  assert.match(calls.filter((c) => c.method === "sendMessage").at(-1).body.text, /tidak tersedia/);
  const noKey = createImageGen({ config: readImageConfig({}), log: silent });
  const tg3 = createTelegram({ config: tcfg, deps: { chat: async () => "x", image: { available: () => noKey.available() } }, fetchImpl: fakeFetch, log: silent });
  await tg3.handleUpdate({ update_id: 10, message: { chat: { id: 111, type: "private" }, text: "/gambar kucing" } });
  assert.match(calls.filter((c) => c.method === "sendMessage").at(-1).body.text, /CLOUDFLARE_API_TOKEN/);
}
ok("Telegram: /gambar status, saklar grup, kirim foto, deskripsi ditolak, tanpa fitur/kunci");

// --- pemasangan di index.js (pemeriksaan teks sumber)
{
  const idx = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const grp = idx.slice(idx.indexOf("async function handleGroupMessage"), idx.indexOf("async function deliverAutoReplyVoice"));
  assert.match(grp, /imageGen\.groupEnabled\(\)/, "grup: hanya bila diizinkan");
  assert.ok(grp.indexOf("isAutoReplyEnabledForContact") < grp.indexOf("imageGen.detect"), "grup: setelah cek izin kontak & jeda");
  assert.ok(grp.indexOf("imageGen.detect") < grp.indexOf("generateAutoReply(groupJid)"), "gambar ditangani sebelum AI percakapan");
  assert.match(grp, /kind: "group"/);
  const own = idx.slice(idx.indexOf("handleWaKasCommand(sock, jid, text))) return;"), idx.indexOf("Tutor suara (/speak"));
  assert.match(own, /isOwnerSender\(msg, isSelfChat\) && !isGroupJid\(jid\) && \(await handleWaImageCommand/, "chat pribadi: hanya pemilik");
  assert.match(idx, /handleImageRequestWa\(sock, jid, req, \{ kind: "owner"/);
  assert.ok(!/image: buffer[^\n]*caption/.test(idx), "gambar dikirim tanpa keterangan");
}
ok("index.js: grup (diizinkan, setelah cek kontak, sebelum AI), chat pribadi hanya pemilik, tanpa keterangan");

console.log(`\n${n} kelompok tes lulus ✅`);
