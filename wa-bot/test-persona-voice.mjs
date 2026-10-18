// Tes suara & gaya per bot (Ayyubi / Wongsobot). Jalankan: node test-persona-voice.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPersonaVoice, findVoice, cleanStyle, sampleText, ALL_VOICES, MALE_VOICES, FEMALE_VOICES, STYLE_MAX } from "./persona-voice.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) }; };

// --- daftar & pencarian
{
  assert.equal(ALL_VOICES.length, 30);
  assert.equal(MALE_VOICES.length, 16);
  assert.equal(FEMALE_VOICES.length, 14);
  assert.equal(new Set(ALL_VOICES).size, 30);
  assert.equal(findVoice("puck"), "Puck");
  assert.equal(findVoice(" CHARON "), "Charon");
  assert.equal(findVoice("zubenelgenubi"), "Zubenelgenubi");
  assert.equal(findVoice("Budi"), null);
  assert.equal(findVoice(""), null);
  assert.equal(findVoice(null), null);
  assert.equal(cleanStyle("  [shouting]  <b>x</b>\n\"kutip\"  baris  "), "shouting bx/b kutip baris");
  assert.equal(cleanStyle("a".repeat(500)).length, STYLE_MAX);
  assert.match(sampleText("Ayyubi"), /aku Ayyubi/);
  assert.match(sampleText(), /contoh suaranya/);
}
ok("30 suara (16 pria, 14 wanita), pencarian tak peka huruf besar, gaya dibersihkan & dibatasi");

// --- penguraian perintah
{
  const pv = createPersonaVoice({ state: mem(), env: {}, secondName: "Wongsobot", log: silent });
  assert.equal(pv.parse(""), null);
  assert.equal(pv.parse("on"), null, "on/off/auto bukan urusan modul ini");
  assert.equal(pv.parse("auto"), null);
  assert.equal(pv.parse("nyala"), null);
  assert.deepEqual(pv.parse("daftar"), { kind: "list" });
  assert.deepEqual(pv.parse("ayyubi"), { kind: "show", who: "main" });
  assert.deepEqual(pv.parse("wongsobot"), { kind: "show", who: "wa2" });
  assert.deepEqual(pv.parse("coba Puck anak laki-laki ceria"), { kind: "try", who: null, voice: "Puck", style: "anak laki-laki ceria", text: "" });
  assert.deepEqual(pv.parse("coba puck | Halo semua"), { kind: "try", who: null, voice: "Puck", style: "", text: "Halo semua" });
  assert.deepEqual(pv.parse("coba wongsobot"), { kind: "try", who: "wa2", voice: null, style: "", text: "" });
  assert.deepEqual(pv.parse("coba ayyubi"), { kind: "try", who: "main", voice: null, style: "", text: "" });
  assert.deepEqual(pv.parse("pakai ayyubi puck anak laki-laki ceria, bicara cepat"), { kind: "set", who: "main", voice: "Puck", style: "anak laki-laki ceria, bicara cepat" });
  assert.deepEqual(pv.parse("pakai wongsobot Charon"), { kind: "set", who: "wa2", voice: "Charon", style: "" });
  assert.deepEqual(pv.parse("reset ayyubi"), { kind: "reset", who: "main" });
  for (const bad of ["coba", "coba Budi", "pakai", "pakai ayyubi", "pakai ayyubi Budi", "pakai budi Puck", "reset", "reset budi"]) assert.equal(pv.parse(bad).kind, "error", bad);
  assert.equal(pv.whoFromWord("WA2"), "wa2");
  assert.equal(pv.whoFromWord("Wongsobot"), "wa2");
  assert.equal(pv.whoFromWord("utama"), "main");
  assert.equal(pv.whoFromWord("siapa"), null);
  // nomor kedua belum aktif
  const solo = createPersonaVoice({ state: mem(), env: {}, secondName: "", log: silent });
  assert.match(solo.parse("pakai wa2 Puck").error, /belum aktif/);
  assert.match(solo.parse("coba wa2").error, /belum aktif/);
  assert.ok(!solo.describe().includes("Nomor 2"));
  assert.ok(pv.describe().includes("Wongsobot"));
}
ok("penguraian: daftar, tampil, coba (+teks sendiri), pakai, reset, nama bot dikenali, salah ketik ditolak, nomor kedua nonaktif");

// --- penyimpanan & bawaan .env
{
  const st = mem();
  const pv = createPersonaVoice({ state: st, env: { WA_VOICE: "algenib", WA_VOICE_STYLE: "tenang", WA2_VOICE: "NgawurBanget" }, secondName: "Wongsobot", log: silent });
  assert.deepEqual(pv.get("main"), { voice: "Algenib", style: "tenang" }, "bawaan dari .env");
  assert.deepEqual(pv.get("wa2"), { voice: null, style: "" }, "nama suara .env yang salah diabaikan");
  assert.deepEqual(pv.get("anything"), pv.get("main"), "akun tak dikenal = nomor utama");
  const r = await pv.set("main", "puck", "anak laki-laki ceria");
  assert.equal(r.saved, true);
  assert.deepEqual(pv.get("main"), { voice: "Puck", style: "anak laki-laki ceria" }, "simpanan menang atas .env");
  assert.deepEqual(JSON.parse(st.m.get("persona_voice:main")), { voice: "Puck", style: "anak laki-laki ceria" });
  // dimuat ulang setelah restart
  const pv2 = createPersonaVoice({ state: st, env: {}, secondName: "Wongsobot", log: silent });
  assert.equal(pv2.get("main").voice, null, "sebelum load: belum tahu");
  await pv2.load();
  assert.deepEqual(pv2.get("main"), { voice: "Puck", style: "anak laki-laki ceria" });
  assert.equal(pv2.get("wa2").voice, null);
  await pv2.reset("main");
  assert.equal(pv2.get("main").voice, null);
  const pv3 = createPersonaVoice({ state: st, env: {}, secondName: "Wongsobot", log: silent });
  await pv3.load();
  assert.equal(pv3.get("main").voice, null, "reset bertahan setelah restart");
  await assert.rejects(pv.set("main", "Budi"), /tidak dikenal/);
}
ok("tersimpan di bot_state, dimuat ulang saat restart, reset bertahan, simpanan menang atas .env, .env salah diabaikan");

{
  const bad = { get: async () => { throw new Error("db mati"); }, set: async () => { throw new Error("db mati"); } };
  const pv = createPersonaVoice({ state: bad, env: {}, secondName: "W", log: silent });
  await pv.load();
  const r = await pv.set("main", "Puck", "x");
  assert.equal(r.saved, false);
  assert.equal(pv.get("main").voice, "Puck", "gagal simpan: tetap berlaku sampai restart");
  const junk = mem();
  junk.m.set("persona_voice:main", "{bukan json");
  junk.m.set("persona_voice:wa2", JSON.stringify({ voice: "Ngawur" }));
  const pv2 = createPersonaVoice({ state: junk, env: {}, secondName: "W", log: silent });
  await pv2.load();
  assert.equal(pv2.get("main").voice, null);
  assert.equal(pv2.get("wa2").voice, null);
}
ok("database mati / data simpanan rusak tidak membuat bot gagal");

// --- suara khusus per grup
{
  const st = mem();
  const pv = createPersonaVoice({ state: st, env: {}, secondName: "Wongsobot", log: silent });
  await pv.load();
  await pv.set("main", "Charon", "");
  assert.deepEqual(pv.parse("grup"), { kind: "glist" });
  assert.deepEqual(pv.parse("grup wanita Keluarga Besar"), { kind: "gset", label: "Keluarga Besar", voice: "Sulafat", style: "" });
  assert.deepEqual(pv.parse("grup cewek Alumni SMA | ceria"), { kind: "gset", label: "Alumni SMA", voice: "Sulafat", style: "ceria" });
  assert.equal(pv.parse("grup Kore Arisan RT 05").voice, "Kore");
  assert.deepEqual(pv.parse("grup hapus Keluarga Besar"), { kind: "gdel", label: "Keluarga Besar" });
  assert.equal(pv.parse("grup wanita").kind, "error", "tanpa nama grup");
  assert.equal(pv.parse("grup wanita ab").kind, "error", "nama terlalu pendek");
  assert.equal(pv.parse("grup ngawur Keluarga").kind, "error", "suara tidak dikenal");
  const r = await pv.setGroup("Keluarga Besar", "Sulafat");
  assert.equal(r.saved, true);
  assert.equal(pv.get("main", "Keluarga Besar 2024 🏡").voice, "Sulafat", "cocok sebagian nama, abaikan emoji/huruf besar");
  assert.equal(pv.get("main", "Grup Kantor").voice, "Charon", "grup lain memakai suara bot (cowok)");
  assert.equal(pv.get("main").voice, "Charon", "tanpa nama grup = suara bot");
  assert.equal(pv.get("main", "").voice, "Charon");
  // nama paling panjang menang
  await pv.setGroup("Keluarga", "Puck");
  assert.equal(pv.get("main", "Keluarga Besar").voice, "Sulafat");
  assert.equal(pv.get("main", "Keluarga Kecil").voice, "Puck");
  // berlaku untuk akun mana pun yang menjawab di grup itu
  assert.equal(pv.get("wa2", "Keluarga Besar").voice, "Sulafat");
  // ganti suara grup yang sama = timpa, tidak dobel
  const r2 = await pv.setGroup("keluarga besar", "Kore", "lembut");
  assert.equal(r2.replaced, true);
  assert.deepEqual(pv.get("main", "Keluarga Besar"), { voice: "Kore", style: "lembut" });
  assert.equal(pv.describeGroups().split("\n").length, 2);
  // muat ulang setelah restart
  const pv2 = createPersonaVoice({ state: st, env: {}, secondName: "Wongsobot", log: silent });
  await pv2.load();
  assert.deepEqual(pv2.get("main", "Keluarga Besar"), { voice: "Kore", style: "lembut" });
  // hapus
  assert.equal((await pv2.removeGroup("Keluarga Besar")).removed, true);
  assert.equal((await pv2.removeGroup("Keluarga Besar")).removed, false);
  assert.equal(pv2.get("main", "Keluarga Besar").voice, "Puck", "jatuh ke aturan lain yang masih cocok (Keluarga)");
  await assert.rejects(() => pv2.setGroup("xx", "Kore"), /terlalu pendek/);
  await assert.rejects(() => pv2.setGroup("Nama Bagus", "Ngawur"), /tidak dikenal/);
  // data simpanan rusak tidak membuat gagal
  const junk = mem();
  junk.m.set("persona_voice_groups", "{rusak");
  const pv3 = createPersonaVoice({ state: junk, env: {}, secondName: "W", log: silent });
  await pv3.load();
  assert.equal(pv3.get("main", "Apa Saja").voice, null);
}
ok("suara per grup: perintah, cocok nama sebagian (terpanjang menang), simpan/muat, hapus, data rusak");

// --- Telegram: /suara grup
{
  const { createTelegram } = await import("./telegram.js");
  const pv = createPersonaVoice({ state: mem(), env: {}, secondName: "", log: silent });
  await pv.load();
  const calls = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const form = init?.body instanceof FormData;
    const body = init?.body && !form ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const spoken = [];
  const deps = { chat: async () => "x", personaVoice: pv, speak: async (t, o) => (spoken.push(o), { ogg: Buffer.from("x") }) };
  const tg = createTelegram({ config: { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true }, deps, fetchImpl: fakeFetch, log: silent });
  let id = 0;
  const say = async (text) => {
    const before = calls.length;
    await tg.handleUpdate({ update_id: ++id, message: { chat: { id: 111, type: "private" }, text } });
    return calls.slice(before).filter((c) => c.method === "sendMessage").map((c) => c.body.text).join("\n");
  };
  assert.match(await say("/suara grup"), /belum ada/);
  const t1 = await say("/suara grup wanita Keluarga Besar");
  assert.match(t1, /Keluarga Besar/);
  assert.match(t1, /Sulafat/);
  assert.equal(pv.get("main", "Keluarga Besar 2024").voice, "Sulafat");
  assert.ok(spoken.some((o) => o?.voice === "Sulafat"), "contoh suara dibuat");
  assert.match(await say("/suara grup"), /Keluarga Besar/);
  assert.match(await say("/suara grup wanita ab"), /minimal/);
  assert.match(await say("/suara grup hapus Keluarga Besar"), /dihapus/);
  assert.equal(pv.get("main", "Keluarga Besar").voice, null);
  assert.match(await say("/suara grup hapus Tidak Ada"), /Tidak ada aturan/);
}
ok("Telegram: /suara grup (tambah, daftar, hapus, salah ketik)");

// --- index.js: sambungan
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /createPersonaVoice\(\{ state: botStateStore/);
  assert.match(src, /speaker\.speak\(text, personaVoice\.get\(currentAccountId\(\), waAccountContext\.getStore\(\)\?\.groupSubject \|\| ""\)\)/, "suara grup mengikuti bot (akun) yang sedang menjawab + aturan per grup");
  assert.match(src, /personaVoice,\n\s+voiceCheck: checkVoiceOutput/, "Telegram diberi akses pengaturan suara");
  assert.ok(src.indexOf("const personaVoice = createPersonaVoice") < src.indexOf("const groupVoice = createGroupVoice"), "dibuat sebelum dipakai");
  assert.match(src, /speak: speaker\.available\(\) \? \(text, opts\) => speaker\.speak\(text, opts\) : null,\n\s+personaVoice/, "Telegram meneruskan suara & gaya contoh");
  assert.match(src, /flags\.groupSubject = subject \|\| ""/, "nama grup dicatat untuk pemilihan suara");
  // tutor dan Telegram biasa tetap suara bawaan
  assert.ok(src.includes("speak: speaker.available() ? (text) => speaker.speak(text) : null,\n  voiceCheck: checkVoiceOutput,\n  hasTranscriber"), "tutor WA tidak berubah");
}
ok("index.js: suara grup memakai suara bot yang menjawab; Telegram dapat perintah pengaturan; tutor tidak berubah");

console.log(`\nSemua ${n} kelompok tes suara per bot lulus ✅`);
