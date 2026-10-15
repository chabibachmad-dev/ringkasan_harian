// Tes uji Meta AI (meta-ai.js). Jalankan: node test-meta-ai.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { unsafeTarget, isMetaAiJid, describeMessage, hasBotMetadata, createMetaAi, parseMetaAiArg, readMetaAiConfig, DEFAULT_META_AI_JIDS, DEFAULT_TEST_PROMPT } from "./meta-ai.js";
import { createTelegram } from "./telegram.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };

// --- alamat
assert.equal(isMetaAiJid("13135550002@s.whatsapp.net"), true);
assert.equal(isMetaAiJid("13135550002@c.us"), true);
assert.equal(isMetaAiJid("131655500123@s.whatsapp.net"), false, "pola 131655500xx hanya 2 digit akhir");
assert.equal(isMetaAiJid("13165550012@s.whatsapp.net"), true);
assert.equal(isMetaAiJid("867051314767696@bot"), true);
assert.equal(isMetaAiJid("628123456789@s.whatsapp.net"), false);
assert.equal(isMetaAiJid("120363@g.us"), false);
assert.equal(isMetaAiJid("999@s.whatsapp.net", ["999@s.whatsapp.net"]), true, "alamat yang diatur sendiri");
assert.equal(isMetaAiJid("", []), false);
assert.deepEqual(readMetaAiConfig({}).jids, DEFAULT_META_AI_JIDS);
assert.deepEqual(readMetaAiConfig({ META_AI_JIDS: "1@bot, rusak ,2@s.whatsapp.net" }).jids, ["1@bot", "2@s.whatsapp.net"]);
ok("pengenalan alamat Meta AI + konfigurasi .env");

// --- isi pesan
assert.deepEqual(describeMessage({ message: { conversation: "halo" } }), { type: "conversation", text: "halo", image: false });
assert.equal(describeMessage({ message: { messageContextInfo: {}, imageMessage: { caption: "kucing" } } }).image, true);
assert.equal(describeMessage({ message: { messageContextInfo: {}, imageMessage: { caption: "kucing" } } }).text, "kucing");
assert.equal(describeMessage({}).type, "kosong");
assert.equal(hasBotMetadata({ message: { messageContextInfo: { botMetadata: {} } } }), true);
assert.equal(hasBotMetadata({ message: { conversation: "x" } }), false);
ok("ringkasan isi pesan & penanda metadata bot");

// --- observe di luar uji
{
  const m = createMetaAi({ log: silent });
  assert.equal(m.observe({ key: { remoteJid: "13135550002@s.whatsapp.net" }, message: { conversation: "hi" } }), true, "dari Meta AI -> dihentikan");
  assert.equal(m.observe({ key: { remoteJid: "628111@s.whatsapp.net", fromMe: true }, message: { conversation: "hi" } }), false);
  assert.equal(m.observe({ key: { remoteJid: "628111@s.whatsapp.net" }, message: { conversation: "hi" } }), false);
  assert.equal(m.observe({ key: { remoteJid: "120363@g.us" }, message: { conversation: "hi" } }), false);
  assert.equal(m.observe({ key: { remoteJid: "628111@s.whatsapp.net" }, message: { messageContextInfo: { botMetadata: {} }, conversation: "x" } }), true);
  assert.equal(m.observe(null), false);
}
ok("observe: Meta AI selalu dihentikan, kontak biasa & grup lolos");

// --- uji: jam palsu
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => void (t += ms), at: () => t }; };

{ // balasan teks + gambar (jam palsu; balasan disuntikkan lewat sleep)
  const c = clock(); const sent = [];
  let meta;
  const script = new Map([[3000, (jid) => meta.observe({ key: { remoteJid: jid }, message: { conversation: "Tentu, sedang membuat…" } })], [8000, (jid) => meta.observe({ key: { remoteJid: jid }, message: { imageMessage: { caption: "ini kucingnya" } } })]]);
  let target = null;
  meta = createMetaAi({ now: c.now, sleep: async (ms) => { c.sleep(ms); for (const [t, fn] of [...script]) if (c.at() >= t && target) { script.delete(t); fn(target); } }, log: silent });
  const r = await meta.run({ send: async (jid, text) => { sent.push([jid, text]); target = jid; } });
  assert.deepEqual(sent, [[DEFAULT_META_AI_JIDS[0], DEFAULT_TEST_PROMPT]], "tepat SATU pesan terkirim");
  assert.equal(r.found, true);
  assert.equal(r.images.length, 1);
  assert.match(r.text, /2 balasan dari 13135550002/);
  assert.match(r.text, /conversation: "Tentu/);
  assert.match(r.text, /Kesimpulan: jalurnya BISA/);
  assert.equal(meta.isBusy(), false);
}
ok("uji: satu pesan terkirim, balasan teks+gambar terekam, kesimpulan 'BISA'");

{ // tanpa balasan
  const c = clock(); const sent = [];
  const meta = createMetaAi({ now: c.now, sleep: c.sleep, log: silent });
  const r = await meta.run({ send: async (jid, t) => void sent.push(jid), jids: ["1@bot", "2@bot"], waitMs: 5000 });
  assert.equal(sent.length, 2, "alamat kedua dicoba bila pertama diam");
  assert.equal(r.found, false);
  assert.match(r.text, /tidak ada balasan dalam 5 detik/);
  assert.match(r.text, /Kesimpulan: belum ada balasan/);
  assert.match(r.text, /\/metaai cari/);
}
ok("uji: tanpa balasan -> alamat berikutnya dicoba, kesimpulan jelas");

{ // hanya teks
  const c = clock(); let meta; let tgt = null; let done = false;
  meta = createMetaAi({ now: c.now, sleep: async (ms) => { await c.sleep(ms); if (tgt && !done && c.at() > 2000) { done = true; meta.observe({ key: { remoteJid: tgt }, message: { conversation: "Maaf, belum bisa" } }); } }, log: silent });
  const r = await meta.run({ send: async (j) => void (tgt = j) });
  assert.equal(r.found, true);
  assert.equal(r.images.length, 0);
  assert.match(r.text, /belum terbukti bisa mengirim gambar/);
}
ok("uji: balasan hanya teks -> kesimpulan belum terbukti bisa gambar");

{ // kirim gagal, dan pesan kontak lain selama uji tercatat
  const c = clock(); let meta; let tgt = null; let done = false;
  const bad = createMetaAi({ now: c.now, sleep: c.sleep, log: silent });
  const r1 = await bad.run({ send: async () => { throw new Error("not-acceptable"); }, jids: ["x@bot"] });
  assert.match(r1.text, /gagal mengirim: not-acceptable/);
  meta = createMetaAi({ now: c.now, sleep: async (ms) => { await c.sleep(ms); if (tgt && !done) { done = true; meta.observe({ key: { remoteJid: "6281234567890@s.whatsapp.net" }, message: { conversation: "p" } }); } }, log: silent });
  const r2 = await meta.run({ send: async (j) => void (tgt = j), waitMs: 4000 });
  assert.match(r2.text, /1 pesan dari kontak lain: 628…7890@s\.whatsapp\.net/, "nomor kontak disamarkan");
}
ok("uji: galat kirim dilaporkan; pesan kontak lain selama uji tercatat dengan nomor disamarkan");

{ // mode cari: menangkap alamat dari pesan keluar HP
  const c = clock(); let meta; let fired = false;
  meta = createMetaAi({ now: c.now, sleep: async (ms) => { await c.sleep(ms); if (!fired && c.at() >= 5000) { fired = true; meta.observe({ key: { remoteJid: "867051314767696@bot", fromMe: true }, message: { conversation: "halo meta" } }); } }, log: silent });
  const r = await meta.run({ listenMs: 20000 });
  assert.equal(r.found, true);
  assert.match(r.text, /867051314767696@bot .*tampak seperti Meta AI/);
  assert.match(r.text, /\/metaai tes <alamat/);
  const cn = clock();
  const none = await createMetaAi({ now: cn.now, sleep: cn.sleep, log: silent }).run({ listenMs: 3000 });
  assert.equal(none.found, false);
  assert.match(none.text, /Tidak ada pesan keluar/);
  // sedang berjalan -> permintaan kedua ditolak
  const c2 = clock(); let release; const gate = new Promise((r) => (release = r));
  const busy = createMetaAi({ now: c2.now, sleep: async (ms) => { await gate; c2.sleep(ms); }, log: silent });
  const first = busy.run({ listenMs: 2000 });
  await Promise.resolve();
  assert.equal(busy.isBusy(), true);
  assert.match((await busy.run({ listenMs: 1000 })).text, /masih berjalan/);
  release();
  await first;
  assert.equal(busy.isBusy(), false);
}
ok("mode cari: alamat dari pesan keluar HP tertangkap; tidak bisa dijalankan ganda");

// --- argumen
assert.deepEqual(parseMetaAiArg(""), { kind: "help" });
assert.deepEqual(parseMetaAiArg("tes"), { kind: "tes", jid: null, force: false, prompt: DEFAULT_TEST_PROMPT });
assert.deepEqual(parseMetaAiArg("tes 867051314767696@bot buatkan gambar rumah"), { kind: "tes", jid: "867051314767696@bot", force: false, prompt: "buatkan gambar rumah" });
assert.deepEqual(parseMetaAiArg("uji 13135550002"), { kind: "tes", jid: "13135550002@s.whatsapp.net", force: false, prompt: DEFAULT_TEST_PROMPT });
assert.deepEqual(parseMetaAiArg("tes halo apa kabar"), { kind: "tes", jid: null, force: false, prompt: "halo apa kabar" });
assert.deepEqual(parseMetaAiArg("tes 6285604512090@s.whatsapp.net yakin"), { kind: "tes", jid: "6285604512090@s.whatsapp.net", force: true, prompt: DEFAULT_TEST_PROMPT });
assert.deepEqual(parseMetaAiArg("tes 628560@s.whatsapp.net paksa halo"), { kind: "tes", jid: "628560@s.whatsapp.net", force: true, prompt: "halo" });
assert.deepEqual(parseMetaAiArg("CARI"), { kind: "cari" });
assert.deepEqual(parseMetaAiArg("entah"), { kind: "help" });
ok("penguraian /metaai (tes, alamat, pesan, cari, bantuan)");

// --- pengaman alamat uji
assert.equal(unsafeTarget(null), null, "tanpa alamat khusus = pakai daftar bawaan");
assert.equal(unsafeTarget("13135550002@s.whatsapp.net"), null);
assert.equal(unsafeTarget("867051314767696@bot"), null);
assert.equal(unsafeTarget("999@s.whatsapp.net", { known: ["999@s.whatsapp.net"] }), null, "alamat di META_AI_JIDS dipercaya");
const w = unsafeTarget("6285604512090@s.whatsapp.net");
assert.match(w, /TIDAK tampak seperti alamat Meta AI/);
assert.match(w, /TIDAK dikirim/);
assert.match(w, /\/metaai tes 6285604512090@s\.whatsapp\.net yakin/);
assert.equal(unsafeTarget("6285604512090@s.whatsapp.net", { force: true }), null);
ok("pengaman: nomor telepon biasa tidak diuji kecuali ditambah kata 'yakin'");

// --- Telegram
{
  const calls = [];
  const fakeFetch = async (url, init) => { calls.push({ method: String(url).split("/").pop(), body: init?.body && !(init.body instanceof FormData) ? JSON.parse(init.body) : {} }); return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
  const got = [];
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => "AI", metaAi: { handle: async (a) => (got.push(a), "hasil uji") } }, fetchImpl: fakeFetch, log: silent });
  await tg.handleUpdate({ update_id: 1, message: { chat: { id: 111, type: "private" }, text: "/metaai tes halo" } });
  assert.deepEqual(got, ["tes halo"]);
  assert.equal(calls.filter((c) => c.method === "sendMessage").at(-1).body.text, "hasil uji");
  const tg2 = createTelegram({ config: tcfg, deps: { chat: async () => "AI" }, fetchImpl: fakeFetch, log: silent });
  await tg2.handleUpdate({ update_id: 2, message: { chat: { id: 111, type: "private" }, text: "/metaai" } });
  assert.match(calls.filter((c) => c.method === "sendMessage").at(-1).body.text, /tidak tersedia/);
}
ok("Telegram: /metaai diteruskan ke penguji, tanpa fitur -> pesan jelas");

// --- pemasangan di index.js
{
  const idx = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const body = idx.slice(idx.indexOf("async function handleIncoming"));
  const obs = body.indexOf("metaAi.observe(msg)");
  assert.ok(obs > 0 && obs < body.indexOf("const isSelfChat"), "pemblokir Meta AI paling awal, sebelum jalur apa pun");
  assert.match(body.slice(obs - 5, obs + 60), /if \(metaAi\.observe\(msg\)\) return;/);
  assert.match(idx, /send: \(jid, text\) => sock\.sendMessage\(jid, \{ text \}\)/, "uji mengirim lewat nomor utama (currentSock)");
  assert.ok(!/metaAi\.run\([^)]*groupJid/.test(idx), "belum terhubung ke grup");
  const hdl = idx.slice(idx.indexOf("metaAi: {\n      handle"));
  assert.ok(hdl.indexOf("unsafeTarget(") > 0 && hdl.indexOf("unsafeTarget(") < hdl.indexOf("metaAi.run({ send"), "pengaman alamat sebelum pengiriman");
}
ok("index.js: pesan Meta AI dihentikan sebelum jalur apa pun; uji lewat nomor utama; belum ke grup");

console.log(`\n${n} kelompok tes lulus ✅`);
