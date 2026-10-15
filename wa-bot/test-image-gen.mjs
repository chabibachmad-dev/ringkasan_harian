// Tes pembuat gambar (image-gen.js). Jalankan: node test-image-gen.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { detectImageRequest, promptProblem, parseImageResponse, createImageGen, readImageConfig, DEFAULT_IMAGE_MODELS, STATE_KEY, QUOTA_KEY } from "./image-gen.js";
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
  assert.match(createImageGen({ config: { ...cfg(), orKeys: ["o"], orModels: ["m"] }, log: silent }).describe(), /OpenRouter: m/);
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
  assert.ok(/Pembuat gambar/.test(t) && /grup: AKTIF/.test(t) && /Sisa jatah/.test(t));
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
  assert.match(calls.filter((c) => c.method === "sendMessage").at(-1).body.text, /GEMINI_API_KEYS/);
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
