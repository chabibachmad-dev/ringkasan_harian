// Tes balasan suara grup WhatsApp (/voice wag on|off). Jalankan: node test-group-voice.mjs
import assert from "node:assert/strict";
import { parseVoiceArg, decideGroupVoice, createGroupVoice, readGroupVoiceConfig, STATE_KEY, LANG_STATE_KEY, parseLangWord, detectRequestedLang, detectTextOnlyRequest, langInstruction, VOICE_LANGS } from "./group-voice.js";
import fs from "node:fs";
import { createTelegram } from "./telegram.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) }; };

// --- perintah
assert.deepEqual(parseVoiceArg(""), { kind: "status" });
assert.deepEqual(parseVoiceArg("wag on"), { kind: "wag", value: "on" });
assert.deepEqual(parseVoiceArg("WAG OFF"), { kind: "wag", value: "off" });
assert.deepEqual(parseVoiceArg("wag"), { kind: "wag", value: null });
assert.deepEqual(parseVoiceArg("grup aktif"), { kind: "wag", value: "on" });
assert.deepEqual(parseVoiceArg("wag mati"), { kind: "wag", value: "off" });
assert.equal(parseVoiceArg("wag mungkin").kind, "error");
assert.equal(parseVoiceArg("xyz").kind, "error");
assert.deepEqual(parseVoiceArg("tg off"), { kind: "tg", arg: "off" });
ok("penguraian /voice (wag on/off, status, tg, galat)");

// --- keputusan suara vs teks
assert.deepEqual(decideGroupVoice("Halo, besok rapat jam sembilan ya."), { voice: true });
assert.equal(decideGroupVoice("Lihat https://contoh.go.id/aturan").voice, false);
assert.equal(decideGroupVoice("Lihat www.contoh.go.id untuk detail").voice, false);
assert.equal(decideGroupVoice("Contoh:\n```js\nconsole.log(1)\n```").voice, false);
assert.equal(decideGroupVoice("| a | b |\n|---|---|\n| 1 | 2 |").voice, false);
assert.equal(decideGroupVoice("   ").voice, false);
assert.equal(decideGroupVoice("🙂🙂🙂").voice, false);
assert.equal(decideGroupVoice("kata ".repeat(200), { maxChars: 600 }).voice, false);
assert.equal(decideGroupVoice("kata ".repeat(20), { maxChars: 600 }).voice, true);
const cfg = readGroupVoiceConfig({}, 700);
assert.deepEqual([cfg.maxChars, cfg.timeoutMs], [600, 30000]);
assert.equal(readGroupVoiceConfig({ WA_GROUP_VOICE_MAX_CHARS: "1400" }, 700).maxChars, 700, "dibatasi TTS_MAX_CHARS");
assert.equal(readGroupVoiceConfig({ WA_GROUP_VOICE_MAX_CHARS: "5" }, 700).maxChars, 80);
ok("keputusan: kalimat pendek disuarakan; tautan/kode/tabel/panjang/kosong tetap teks; batas dari .env");

// --- pengaturan tersimpan + pembuatan suara
{
  const st = mem(); const spoke = []; const notes = [];
  let behaviour = "ok";
  const gv = createGroupVoice({
    state: st, log: silent, config: { maxChars: 600, timeoutMs: 200 },
    speak: async (t) => {
      spoke.push(t);
      if (behaviour === "ffmpeg") throw Object.assign(new Error("ffmpeg belum terpasang."), { code: "ffmpeg" });
      if (behaviour === "quota") throw Object.assign(new Error("Kuota suara Gemini sedang habis."), { quota: true });
      if (behaviour === "slow") await new Promise((r) => setTimeout(r, 1000));
      if (behaviour === "boom") throw new Error("meledak");
      if (behaviour === "none") return null;
      return { ogg: Buffer.from("OGG"), text: t };
    },
    check: async () => ({ ok: behaviour !== "ffmpeg", reason: "ffmpeg belum terpasang (sudo apt install ffmpeg)" }),
    notify: async (t) => void notes.push(t)
  });
  assert.equal(gv.enabled(), false, "bawaan: teks");
  assert.equal(await gv.tryVoice("Halo semua"), null, "mati -> tidak membuat suara");
  assert.equal(spoke.length, 0);
  let r = await gv.set(true);
  assert.deepEqual([r.on, r.saved, r.warning], [true, true, ""]);
  assert.equal(st.m.get(STATE_KEY), "on");
  assert.match(gv.describe(), /SUARA/);
  const v = await gv.tryVoice("Halo semua, rapat jam sembilan.");
  assert.equal(v.ogg.toString(), "OGG");
  assert.equal(await gv.tryVoice("Lihat https://x.id"), null, "tautan -> teks, speak tidak dipanggil");
  assert.equal(spoke.length, 1);

  behaviour = "ffmpeg";
  assert.equal(await gv.tryVoice("Halo semua"), null);
  assert.equal(await gv.tryVoice("Halo lagi"), null);
  assert.equal(notes.length, 1, "pemilik diberi tahu SEKALI soal ffmpeg");
  assert.match(notes[0], /ffmpeg/);
  behaviour = "quota";
  assert.equal(await gv.tryVoice("Halo semua"), null);
  assert.equal(notes.length, 2);
  assert.match(notes[1], /Kuota suara/);
  behaviour = "slow";
  const t0 = Date.now();
  assert.equal(await gv.tryVoice("Halo pelan"), null, "terlalu lama -> teks");
  assert.ok(Date.now() - t0 < 800);
  for (const b of ["boom", "none"]) { behaviour = b; assert.equal(await gv.tryVoice("Halo ya"), null); }

  r = await gv.set(false);
  assert.equal(r.on, false);
  assert.equal(st.m.get(STATE_KEY), "off");
  behaviour = "ffmpeg";
  r = await gv.set(true);
  assert.match(r.warning, /ffmpeg/, "peringatan saat menyalakan bila suara belum bisa");

  // dimuat ulang dari penyimpanan
  const gv2 = createGroupVoice({ state: st, log: silent, speak: async () => ({ ogg: Buffer.from("x") }) });
  assert.equal(await gv2.load(), true);
  st.m.set(STATE_KEY, "off");
  assert.equal(await gv2.load(), false);
  const dead = mem(); dead.get = async () => { throw new Error("db mati"); };
  assert.equal(await createGroupVoice({ state: dead, log: silent }).load(), false, "galat basis data -> mati");
  const noSave = mem(); noSave.set = async () => { throw new Error("db mati"); };
  assert.equal((await createGroupVoice({ state: noSave, log: silent }).set(true)).saved, false);
  assert.equal(await createGroupVoice({ log: silent }).tryVoice("Halo"), null, "tanpa pembuat suara -> teks");
}
ok("pengaturan tersimpan, suara dibuat, ffmpeg/kuota diberi tahu sekali, lambat/gagal -> teks, muat ulang, galat basis data");

// --- Telegram: /voice
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    calls.push({ method, body: init?.body && !(init.body instanceof FormData) ? JSON.parse(init.body) : {} });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const st = mem();
  const gv = createGroupVoice({ state: st, log: silent, speak: async () => ({ ogg: Buffer.from("x") }), check: async () => ({ ok: true }) });
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => "x", groupVoice: gv, voiceCheck: async () => ({ ok: true }), speak: async () => null }, fetchImpl: fakeFetch, log: silent });
  const say = async (text, id) => { await tg.handleUpdate({ update_id: id, message: { chat: { id: 111, type: "private" }, text } }); return calls.filter((c) => c.method === "sendMessage").at(-1).body.text; };
  let t = await say("/voice", 1);
  assert.ok(/Grup WhatsApp: teks/.test(t) && /Telegram/.test(t));
  t = await say("/voice wag on", 2);
  assert.ok(/voice note saja/.test(t) && gv.enabled() && st.m.get(STATE_KEY) === "on");
  t = await say("/voice", 3);
  assert.ok(/SUARA/.test(t));
  t = await say("/voice wag", 4);
  assert.ok(/SUARA/.test(t), "tanpa nilai = lihat status");
  t = await say("/voice wag off", 5);
  assert.ok(/teks/.test(t) && !gv.enabled() && st.m.get(STATE_KEY) === "off");
  t = await say("/voice wag entah", 6);
  assert.ok(/tidak dikenali/.test(t));
  assert.equal(gv.enabled(), false);
  t = await say("/voice tg off", 7);
  assert.ok(/Balasan suara/.test(t), "/voice tg meneruskan ke /suara");

  const bad = createGroupVoice({ state: st, log: silent, speak: async () => null, check: async () => ({ ok: false, reason: "ffmpeg belum terpasang (sudo apt install ffmpeg)" }) });
  const tg2 = createTelegram({ config: tcfg, deps: { chat: async () => "x", groupVoice: bad }, fetchImpl: fakeFetch, log: silent });
  await tg2.handleUpdate({ update_id: 10, message: { chat: { id: 111, type: "private" }, text: "/voice wag on" } });
  t = calls.filter((c) => c.method === "sendMessage").at(-1).body.text;
  assert.ok(/belum bisa dibuat sekarang/.test(t) && /ffmpeg/.test(t) && bad.enabled(), "tetap menyala, tetapi diberi peringatan");

  const tg3 = createTelegram({ config: tcfg, deps: { chat: async () => "x" }, fetchImpl: fakeFetch, log: silent });
  await tg3.handleUpdate({ update_id: 11, message: { chat: { id: 111, type: "private" }, text: "/voice wag on" } });
  assert.ok(/belum aktif/.test(calls.filter((c) => c.method === "sendMessage").at(-1).body.text));
}
ok("Telegram: /voice, /voice wag on|off, status, nilai salah, /voice tg, peringatan, tanpa fitur");

// --- bahasa suara grup
{
  assert.deepEqual(parseVoiceArg("wag kor"), { kind: "wag", value: null, lang: "ko" });
  assert.deepEqual(parseVoiceArg("wag ARB"), { kind: "wag", value: null, lang: "ar" });
  assert.deepEqual(parseVoiceArg("wag jawa"), { kind: "wag", value: null, lang: "jv" });
  assert.deepEqual(parseVoiceArg("wag eng"), { kind: "wag", value: null, lang: "en" });
  assert.deepEqual(parseVoiceArg("wag id"), { kind: "wag", value: null, lang: "id" });
  assert.deepEqual(parseVoiceArg("wag auto"), { kind: "wag", value: null, lang: "auto" });
  assert.deepEqual(parseVoiceArg("wag on"), { kind: "wag", value: "on" }, "on tetap on");
  assert.equal(parseVoiceArg("wag klingon").kind, "error");
  assert.match(parseVoiceArg("wag klingon").error, /kor/);
  assert.equal(parseLangWord("korean"), "ko");
  assert.equal(parseLangWord("Jowo"), "jv");
  assert.equal(parseLangWord("ya"), null);
  assert.equal(Object.keys(VOICE_LANGS).length, 5);
  for (const c of Object.keys(VOICE_LANGS)) assert.match(langInstruction(c), /WAJIB/);
  assert.equal(langInstruction("xx"), "");
  assert.match(langInstruction("ko"), /Hangul/);
  assert.match(langInstruction("ar"), /aksara Arab/);
  assert.match(langInstruction("jv"), /Jawa/);
}
ok("bahasa suara: kata perintah (id/eng/kor/arb/jawa/auto), instruksi prompt per bahasa");

{
  const yes = { "bot, jawab pakai bahasa Korea ya": "ko", "tolong balas dalam bahasa Arab": "ar", "reply in Arabic please": "ar", "ngomong pakai bahasa jawa dong": "jv", "bicara boso jowo": "jv", "jawab dengan bahasa Inggris": "en", "answer in Korean": "ko", "pakai bahasa indonesia aja": "id" };
  for (const [t, c] of Object.entries(yes)) assert.equal(detectRequestedLang(t), c, t);
  for (const t of ["apa bahasa Korea dari terima kasih?", "terjemahkan ke bahasa arab", "artinya apa dalam bahasa Korea", "bot jam berapa buka?", "", null]) assert.equal(detectRequestedLang(t), null, String(t));
}
ok("permintaan bahasa di pesan grup dikenali; pertanyaan terjemahan dan chat biasa bukan permintaan");

{
  const st = mem();
  const gv = createGroupVoice({ state: st, log: silent, speak: async () => ({ ogg: Buffer.from("x") }), check: async () => ({ ok: true }) });
  assert.equal(gv.lang(), null, "bawaan otomatis");
  assert.match(gv.describe(), /otomatis/);
  assert.deepEqual(await gv.setLang("ko"), { lang: "ko", saved: true });
  assert.equal(gv.lang(), "ko");
  assert.equal(st.m.get(LANG_STATE_KEY), "ko");
  await gv.set(true);
  assert.match(gv.describe(), /SUARA.*Korea/);
  const gv2 = createGroupVoice({ state: st, log: silent });
  await gv2.load();
  assert.equal(gv2.lang(), "ko", "bahasa bertahan setelah restart");
  assert.equal((await gv2.setLang("auto")).lang, "auto");
  assert.equal(gv2.lang(), null);
  assert.equal((await gv2.setLang("klingon")).lang, "auto", "kode tak dikenal -> otomatis");
  const bad = mem(); bad.set = async () => { throw new Error("db mati"); };
  const gv3 = createGroupVoice({ state: bad, log: silent });
  assert.equal((await gv3.setLang("ar")).saved, false);
  assert.equal(gv3.lang(), "ar", "tetap berlaku sementara");
  const junk = mem(); junk.m.set(LANG_STATE_KEY, "zz");
  const gv4 = createGroupVoice({ state: junk, log: silent }); await gv4.load();
  assert.equal(gv4.lang(), null, "nilai rusak diabaikan");
}
ok("pengaturan bahasa tersimpan, dimuat ulang, gagal simpan tetap berlaku, nilai rusak diabaikan");

{
  const calls = [];
  const fakeFetch = async (url, init) => { calls.push({ method: String(url).split("/").pop(), body: init?.body && !(init.body instanceof FormData) ? JSON.parse(init.body) : {} }); return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
  const st = mem();
  const gv = createGroupVoice({ state: st, log: silent, speak: async () => ({ ogg: Buffer.from("x") }), check: async () => ({ ok: true }) });
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => "x", groupVoice: gv, voiceCheck: async () => ({ ok: true }), speak: async () => null }, fetchImpl: fakeFetch, log: silent });
  const say = async (text, id) => { await tg.handleUpdate({ update_id: id, message: { chat: { id: 111, type: "private" }, text } }); return calls.filter((c) => c.method === "sendMessage").at(-1).body.text; };
  let t = await say("/voice wag kor", 1);
  assert.ok(/Korea/.test(t) && /dinyalakan/.test(t), "memilih bahasa menyalakan suara");
  assert.equal(gv.enabled(), true);
  assert.equal(gv.lang(), "ko");
  t = await say("/voice", 2);
  assert.ok(/Korea/.test(t) && /kor/.test(t), "status memuat bahasa dan petunjuk");
  t = await say("/voice wag jawa", 3);
  assert.ok(/Jawa/.test(t) && !/dinyalakan/.test(t), "sudah menyala: tidak diumumkan lagi");
  t = await say("/voice wag auto", 4);
  assert.ok(/otomatis/.test(t));
  assert.equal(gv.lang(), null);
  assert.equal(gv.enabled(), true, "auto tidak mematikan suara");
  await say("/voice wag off", 5);
  t = await say("/voice wag arb", 6);
  assert.ok(gv.enabled() && /Arab/.test(t));
  assert.ok(await say("/voice wag klingon", 7) && /tidak dikenali/.test(calls.filter((c) => c.method === "sendMessage").at(-1).body.text));
}
ok("Telegram: /voice wag kor|arb|jawa|eng|id|auto memilih bahasa (menyalakan suara bila mati), status, nilai salah");

{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /detectRequestedLang\(text\) \|\| groupVoice\.lang\(\)/);
  assert.match(src, /acctCtx\.replyLang = wantedLang/);
  assert.match(src, /waAccountContext\.getStore\(\)\?\.replyLang/);
  assert.match(src, /langInstruction\(replyLang\)/);
  const i = src.indexOf("acctCtx.replyLang = wantedLang");
  assert.ok(i > 0 && i < src.indexOf("result = await generateAutoReply(groupJid);"), "bahasa diatur SEBELUM jawaban dibuat");
  assert.ok(src.slice(i - 400, i).includes("groupVoice.enabled()"), "hanya bila balasan grup berupa suara");
}
ok("index.js: bahasa diatur sebelum AI menjawab, hanya saat suara grup menyala");

// --- "jawab pakai teks" -> bukan suara
for (const t of ["bot, jawab pakai teks ya", "teks saja dong", "jangan pakai suara", "jangan pake voice", "tanpa voice", "bukan voice", "reply in text", "text only please", "buatkan prompt, jawab pakai teks"]) {
  assert.equal(detectTextOnlyRequest(t), true, `harus teks: ${t}`);
}
for (const t of ["jelaskan alur halal", "apa itu teks proklamasi", "bot kirim suara dong", "", null, undefined]) {
  assert.equal(detectTextOnlyRequest(t), false, `bukan permintaan teks: ${t}`);
}
ok("detectTextOnlyRequest: 'jawab pakai teks', 'jangan pakai suara', 'text only' dikenali; pertanyaan biasa tidak");

{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /const textOnly = !groupAudio && detectTextOnlyRequest\(text\)/);
  assert.match(src, /groupVoice\.enabled\(\) && !textOnly && !fileReq\) \{\n    const wantedLang/, "bahasa suara tidak diatur bila minta teks");
  assert.match(src, /groupVoice\.enabled\(\) && !textOnly && !fileReq\) \{\n    sock\.sendPresenceUpdate\("recording"/, "jalur suara dilewati bila minta teks/berkas");
  const i = src.indexOf("groupVoice.enabled() && !textOnly && !fileReq) {\n    sock.sendPresenceUpdate(\"recording\"");
  assert.ok(i > src.indexOf("result = await generateAutoReply(groupJid);"), "keputusan suara sesudah jawaban dibuat");
  assert.match(src, /TEXT_PROMPT_NOTE/);
  assert.ok(src.slice(i, i + 900).includes("deliverAutoReplyText") || src.indexOf("deliverAutoReplyText(", i) > i, "jatuh ke balasan teks");
}
ok("index.js: permintaan teks melewati jalur suara (hanya untuk pesan itu), AI diberi catatan tanpa tabel/pdf");

console.log(`\nSemua ${n} kelompok tes suara grup lulus.`);
