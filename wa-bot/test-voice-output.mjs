// Tes balasan suara (voice-output.js): teks yang enak diucapkan, ekstraksi audio Gemini, rotasi key/model, ffmpeg.
//   node test-voice-output.mjs
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createSpeaker, extractTtsWav, readTtsConfig, restMsFor429, speakableText } from "./voice-output.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };

// ---- konfigurasi
{
  const d = readTtsConfig({});
  check(d.geminiKeys.length === 0 && d.models.length >= 3 && d.voice === "Sulafat" && d.maxChars === 700 && d.ffmpeg === "ffmpeg", "config: bawaan");
  const c = readTtsConfig({ GEMINI_API_KEYS: "a, b", GEMINI_TTS_MODELS: " m1 , m2 ", TELEGRAM_TTS_VOICE: "Puck", TTS_MAX_CHARS: "5", FFMPEG_PATH: "/usr/bin/ffmpeg" });
  check(c.geminiKeys.join() === "a,b" && c.models.join() === "m1,m2" && c.voice === "Puck" && c.maxChars === 80 && c.ffmpeg === "/usr/bin/ffmpeg", "config: key, model, suara, batas panjang (min 80), ffmpeg");
  check(readTtsConfig({ GEMINI_TTS_VOICE: "Aoede" }).voice === "Aoede", "config: GEMINI_TTS_VOICE juga dibaca");
}

// ---- teks yang diucapkan
{
  check(speakableText("Halo *dunia*, ini `kode` ya! 😀") === "Halo dunia, ini kode ya!", "ucap: markdown & emoji dibuang");
  check(speakableText("Lihat https://contoh.id/a?b=1 ya") === "Lihat ya", "ucap: URL dibuang");
  check(speakableText("[Teks tautan](https://x.id) bagus") === "Teks tautan bagus", "ucap: tautan markdown -> teksnya");
  check(speakableText("Jawabannya:\n```js\nconsole.log(1)\n```\nSelesai.") === "Jawabannya: Selesai.", "ucap: blok kode dibuang");
  check(speakableText("- satu\n- dua\n# Judul") === "satu dua Judul", "ucap: penanda daftar/judul dibuang");
  check(speakableText("😀😀 ```x``` ***") === "", "ucap: tak ada yang bisa diucapkan -> kosong");
  const long = "Kalimat pertama itu panjang sekali. ".repeat(40);
  const cut = speakableText(long, 200);
  check(cut.length <= 200 && cut.endsWith("."), "ucap: dipotong di akhir kalimat (" + cut.length + ")");
  check(speakableText("a".repeat(500) + " b c", 100).length <= 100, "ucap: tanpa spasi tetap dipotong");
}

// ---- audio dari jawaban Gemini
{
  const pcm = Buffer.alloc(20000, 1);
  const b64 = (b) => b.toString("base64");
  const a = extractTtsWav({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: b64(pcm) } }] } }] });
  check(a && a.toString("latin1", 0, 4) === "RIFF" && a.readUInt32LE(24) === 24000 && a.length === 44 + 20000, "audio: PCM dibungkus header WAV 24 kHz");
  const riff = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(20000, 2)]);
  check(extractTtsWav({ outputs: [{ type: "audio", data: b64(riff), mime_type: "audio/wav" }] }).equals(riff), "audio: bentuk Interactions (WAV berheader) dipakai apa adanya");
  check(extractTtsWav({ x: 1 }) === null && extractTtsWav(null) === null, "audio: tanpa audio -> null");
}

// ---- istirahat key setelah 429
{
  check(restMsFor429("Please retry in 19h38m36.7s.") === (19 * 3600 + 38 * 60 + 36.7) * 1000, "429: waktu tunggu dibaca dari pesan");
  check(restMsFor429("quota PerDay exceeded") === 6 * 3600_000, "429: kuota harian tanpa petunjuk -> 6 jam");
  check(restMsFor429("rate limit") === 60_000, "429: tanpa petunjuk -> 1 menit");
}

// ---- ffmpeg & Gemini palsu
function fakeSpawn({ encoders = "... libopus ...", missing = false, calls = [] } = {}) {
  const f = (cmd, args) => {
    calls.push({ cmd, args });
    if (missing) throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    const ee = new EventEmitter();
    ee.stdout = new PassThrough();
    ee.stderr = new PassThrough();
    ee.stdin = new PassThrough();
    ee.kill = () => {};
    const chunks = [];
    ee.stdin.on("data", (d) => chunks.push(d));
    if (args.includes("-encoders")) setImmediate(() => { ee.stdout.end(encoders); ee.emit("close", 0); });
    else ee.stdin.on("end", () => setImmediate(() => { f.input = Buffer.concat(chunks); ee.stdout.end(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(900, 3)])); ee.emit("close", 0); }));
    return ee;
  };
  return f;
}
const wavBody = () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: Buffer.alloc(20000, 5).toString("base64") } }] } }] });
function fakeGemini(plan) {
  const calls = [];
  const f = async (url, init) => {
    const key = init.headers["x-goog-api-key"];
    const body = JSON.parse(init.body);
    const kind = String(url).includes("/interactions") ? "inter" : "classic";
    const model = kind === "inter" ? body.model : /models\/([^:]+):/.exec(url)[1];
    calls.push({ url: String(url), key, kind, model, body });
    const r = plan(key, kind, model, calls.length);
    return { ok: r.status === 200, status: r.status, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})) };
  };
  f.calls = calls;
  return f;
}
const cfg = (o = {}) => ({ geminiKeys: ["k1", "k2"], models: ["m1", "m2"], voice: "Sulafat", maxChars: 700, ffmpeg: "ffmpeg", timeoutMs: 5000, ...o });

{
  const sp = [];
  const g = fakeGemini(() => ({ status: 200, body: wavBody() }));
  const s = createSpeaker({ config: cfg(), fetchImpl: g, spawnImpl: fakeSpawn({ calls: sp }), log: quiet });
  check(s.available() === true && createSpeaker({ config: cfg({ geminiKeys: [] }), log: quiet }).available() === false, "speaker: available mengikuti ada tidaknya key");
  const out = await s.speak("Hello *there*! 😀 How are you?");
  check(out && out.ogg.toString("latin1", 0, 4) === "OggS" && out.text === "Hello there! How are you?", "speaker: hasil OGG + teks yang diucapkan");
  check(g.calls.length === 1 && g.calls[0].kind === "inter" && g.calls[0].model === "m1" && g.calls[0].key === "k1", "speaker: bentuk Interactions dulu, model & key pertama");
  check(g.calls[0].body.generation_config.speech_config[0].voice === "Sulafat" && /Hello there/.test(g.calls[0].body.input[0].content[0].text), "speaker: suara & teks terkirim");
  const conv = sp.find((c) => c.args.includes("pipe:0"));
  check(conv && conv.args.includes("libopus") && conv.args.includes("ogg") && conv.args.includes("-ac"), "speaker: ffmpeg dipanggil ke OGG/Opus mono");
  check(await s.speak("😀 ```x```") === null, "speaker: tak ada yang bisa diucapkan -> null tanpa memanggil Gemini (" + g.calls.length + " panggilan)");
}
{
  // bentuk Interactions 404 -> bentuk klasik
  const g = fakeGemini((k, kind) => (kind === "inter" ? { status: 404, body: "no" } : { status: 200, body: wavBody() }));
  const s = createSpeaker({ config: cfg(), fetchImpl: g, spawnImpl: fakeSpawn(), log: quiet });
  const out = await s.speak("Hi there friend");
  check(out && g.calls.length === 2 && g.calls[1].kind === "classic" && /Say this in a/.test(g.calls[1].body.contents[0].parts[0].text), "speaker: Interactions 404 -> bentuk generateContent klasik");
}
{
  // 429 di key pertama -> key kedua; key pertama diistirahatkan
  let t = 1000;
  const g = fakeGemini((k) => (k === "k1" ? { status: 429, body: "Please retry in 30m0s. PerDay" } : { status: 200, body: wavBody() }));
  const s = createSpeaker({ config: cfg(), fetchImpl: g, spawnImpl: fakeSpawn(), log: quiet, now: () => t });
  await s.speak("Hello there");
  check(g.calls.map((c) => c.key).join() === "k1,k2", "speaker: key kena 429 -> pindah key");
  g.calls.length = 0;
  await s.speak("Hello again");
  check(g.calls.length === 1 && g.calls[0].key === "k2", "speaker: key yang kena 429 tidak dicoba lagi");
}
{
  // semua kuota habis -> galat bertanda quota
  const g = fakeGemini(() => ({ status: 429, body: "quota exceeded" }));
  const s = createSpeaker({ config: cfg(), fetchImpl: g, spawnImpl: fakeSpawn(), log: quiet });
  let err = null;
  try { await s.speak("Hello there"); } catch (e) { err = e; }
  check(err && err.quota === true && /Kuota suara/.test(err.message), "speaker: semua key/model kena kuota -> galat .quota");
  let err2 = null;
  try { await s.speak("Hello again"); } catch (e) { err2 = e; }
  check(err2 && err2.quota === true, "speaker: berikutnya tetap kena kuota tanpa menembak API lagi");
}
{
  // model 404 di dua bentuk -> dilewati, model berikut dipakai
  const g = fakeGemini((k, kind, model) => (model === "m1" ? { status: 404, body: "x" } : { status: 200, body: wavBody() }));
  const s = createSpeaker({ config: cfg(), fetchImpl: g, spawnImpl: fakeSpawn(), log: quiet });
  const out = await s.speak("Hello there");
  check(out && g.calls[g.calls.length - 1].model === "m2", "speaker: model yang tidak ada dilewati, model berikut dipakai");
  g.calls.length = 0;
  await s.speak("Once more");
  check(g.calls.every((c) => c.model === "m2"), "speaker: model mati diingat (tidak dicoba lagi)");
}
{
  // audio terlalu pendek ditolak
  const short = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: Buffer.alloc(900).toString("base64").padEnd(400, "A") } }] } }] };
  const g = fakeGemini(() => ({ status: 200, body: short }));
  const s = createSpeaker({ config: cfg({ geminiKeys: ["k1"], models: ["m1"] }), fetchImpl: g, spawnImpl: fakeSpawn(), log: quiet });
  let err = null;
  try { await s.speak("Hello there"); } catch (e) { err = e; }
  check(err && !err.quota, "speaker: audio kosong/pendek -> galat biasa");
}
{
  // ffmpeg tidak ada / tanpa libopus
  let t = 0;
  const g = fakeGemini(() => ({ status: 200, body: wavBody() }));
  const s = createSpeaker({ config: cfg(), fetchImpl: g, spawnImpl: fakeSpawn({ missing: true }), log: quiet, now: () => t });
  let err = null;
  try { await s.speak("Hello there"); } catch (e) { err = e; }
  check(err && err.code === "ffmpeg" && /ffmpeg belum terpasang/.test(err.message) && g.calls.length === 0, "speaker: ffmpeg tak ada -> galat code=ffmpeg, Gemini tidak dipanggil");
  check((await s.checkFfmpeg()) === "missing", "speaker: status ffmpeg 'missing'");
  const s2 = createSpeaker({ config: cfg(), fetchImpl: g, spawnImpl: fakeSpawn({ encoders: "aac mp3" }), log: quiet });
  let e2 = null;
  try { await s2.speak("Hello there"); } catch (e) { e2 = e; }
  check(e2 && e2.code === "ffmpeg" && /libopus/.test(e2.message), "speaker: ffmpeg tanpa libopus -> pesan jelas");
  // gagal hanya diingat 60 detik: setelah ffmpeg dipasang, tanpa restart
  let installed = false;
  const dyn = (c, a) => fakeSpawn({ missing: !installed })(c, a);
  const s3 = createSpeaker({ config: cfg(), fetchImpl: g, spawnImpl: dyn, log: quiet, now: () => t });
  check((await s3.checkFfmpeg()) === "missing", "speaker: awalnya tak ada");
  installed = true;
  t += 30_000;
  check((await s3.checkFfmpeg()) === "missing", "speaker: kegagalan diingat < 60 detik");
  t += 40_000;
  check((await s3.checkFfmpeg()) === "ok", "speaker: setelah >60 detik dicek ulang dan berhasil (tanpa restart)");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
