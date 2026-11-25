// Uji logika murni ruangkita.js (tanpa peramban).
import assert from "node:assert";
import {
  readRuangkitaConfig, createLimiter, pickDelayMs, jadulkan, pickJoke, JOKE_BANK,
  createPersona, parseCommand, withinActiveHours, createRuangkita, pickRiddle, RIDDLE_BANK,
} from "./ruangkita.js";

let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };
const stubDriver = () => ({ login: async () => ({ ok: true }), readFeed: async () => [], setBio: async () => ({ ok: true }), postStatus: async () => ({ ok: true }), scanPosts: async () => [], likePost: async () => ({ ok: true }), commentOnPost: async () => ({ ok: true }), readComments: async () => [], readInbox: async () => [], readNotifications: async () => [], close: async () => {}, isOpen: () => true });

// --- config ---
{
  const c = readRuangkitaConfig({});
  assert.equal(c.enabled, false); assert.equal(c.url, "https://temandulu.site");
  assert.equal(c.minGapMin, 3); assert.equal(c.maxPerHour, 8); assert.equal(c.postPerDay, 3);
  const c2 = readRuangkitaConfig({ RUANGKITA_ENABLED: "1", RUANGKITA_MIN_GAP_MIN: "0", RUANGKITA_MAX_PER_HOUR: "999", RUANGKITA_URL: "https://x.test/" });
  assert.equal(c2.enabled, true); assert.equal(c2.minGapMin, 1, "clamp bawah"); assert.equal(c2.maxPerHour, 60, "clamp atas"); assert.equal(c2.url, "https://x.test");
  ok("readRuangkitaConfig: default & clamp");
}

// --- limiter: jeda minimum ---
{
  let t = 1_000_000_000_000;
  const lim = createLimiter({ minGapMs: 3 * 60_000, maxPerHour: 8, postPerDay: 3, now: () => t });
  assert.equal(lim.canAct("post"), true);
  lim.record("post");
  assert.equal(lim.canAct("post"), false, "kena jeda minimum");
  t += 3 * 60_000 + 1;
  assert.equal(lim.canAct("post"), true, "lewat jeda minimum");
  ok("limiter: jeda minimum antar aksi");
}

// --- limiter: batas per jam ---
{
  let t = 1_700_000_000_000;
  const lim = createLimiter({ minGapMs: 0, maxPerHour: 3, postPerDay: 99, now: () => t });
  for (let i = 0; i < 3; i++) { assert.equal(lim.canAct("any"), true); lim.record("any"); t += 1000; }
  assert.equal(lim.canAct("any"), false, "3/jam tercapai");
  t += 3600_001;
  assert.equal(lim.canAct("any"), true, "jam bergeser, kuota pulih");
  ok("limiter: batas per jam");
}

// --- limiter: batas post per hari (WITA) ---
{
  // 2026-11-23 02:00 UTC = 10:00 WITA
  let t = Date.parse("2026-11-23T02:00:00Z");
  const lim = createLimiter({ minGapMs: 0, maxPerHour: 99, postPerDay: 2, now: () => t });
  lim.record("post"); t += 60_000; lim.record("post"); t += 60_000;
  assert.equal(lim.canAct("post"), false, "2 post hari ini, batas tercapai");
  assert.equal(lim.canAct("reply"), true, "aksi non-post tetap boleh");
  t = Date.parse("2026-11-24T02:00:00Z");
  assert.equal(lim.canAct("post"), true, "hari lokal baru, kuota post pulih");
  ok("limiter: batas post per hari zona WITA");
}

// --- jitter ---
{
  for (const r of [0, 0.5, 0.999]) {
    const ms = pickDelayMs(3, () => r);
    assert.ok(ms >= 3 * 60_000 && ms <= 7.5 * 60_000, `delay dalam rentang (${ms})`);
  }
  ok("pickDelayMs: dalam rentang & acak");
}

// --- jam aktif ---
{
  const cfg = { activeFrom: 6, activeTo: 23 };
  assert.equal(withinActiveHours(cfg, Date.parse("2026-11-23T00:30:00Z")), true, "08:30 WITA aktif"); // 00:30 UTC=08:30 WITA
  assert.equal(withinActiveHours(cfg, Date.parse("2026-11-22T20:00:00Z")), false, "04:00 WITA tidur"); // 20:00 UTC=04:00 WITA
  const malam = { activeFrom: 22, activeTo: 2 };
  assert.equal(withinActiveHours(malam, Date.parse("2026-11-22T17:00:00Z")), true, "01:00 WITA dalam rentang lintas tengah malam");
  ok("withinActiveHours: termasuk rentang lintas tengah malam");
}

// --- persona: jadulkan + fallback bank ---
{
  assert.equal(jadulkan("mantap 😂👍"), "mantap :)) (Y)");
  assert.ok(!/[😀-🙏]/u.test(jadulkan("halo 🥹🎉 dunia")), "emoji sisa dibuang");
  assert.ok(JOKE_BANK.includes(pickJoke(() => 0)));
  const p = createPersona({ generate: null }); // tanpa LLM -> fallback
  const st = await p.status();
  assert.ok(st.length > 5 && !/["]/.test(st), "status fallback terisi");
  const rp = await p.reply({ author: "Tangerine", text: "aq sedih" });
  assert.ok(rp.length > 3, "reply fallback terisi");
  ok("persona: jadulkan & fallback tanpa LLM");
}

// --- persona: pakai LLM palsu ---
{
  const fake = async ({ messages }) => ({ text: "Hujan gini enaknya tidur 😴 bukan mikirin dia 👍" });
  const p = createPersona({ generate: fake });
  const st = await p.status();
  assert.ok(/:\)|\(Y\)|tidur/i.test(st) && !/[😴👍]/u.test(st), "teks LLM di-jadul-kan");
  ok("persona: output LLM diproses jadul");
}

// --- parser perintah ---
{
  assert.equal(parseCommand("").kind, "status");
  assert.equal(parseCommand("on").kind, "on");
  assert.equal(parseCommand("MATI").kind, "off");
  assert.equal(parseCommand("uji").kind, "uji");
  assert.deepEqual(parseCommand("post halo semua"), { kind: "post", text: "halo semua" });
  assert.equal(parseCommand("jeda 7").min, 7);
  assert.equal(parseCommand("batas 10").n, 10);
  assert.equal(parseCommand("bio aku bot").text, "aku bot");
  assert.equal(parseCommand("ngawur").kind, "unknown");
  ok("parseCommand: semua cabang");
}

// --- orkestrator: on tanpa kredensial ditolak, state persist ---
{
  const kv = new Map();
  const state = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => void kv.set(k, v) };
  const stubDriver = () => ({ login: async () => ({ ok: true }), readFeed: async () => [], setBio: async () => ({ ok: true }), postStatus: async () => ({ ok: true }), scanPosts: async () => [], likePost: async () => ({ ok: true }), commentOnPost: async () => ({ ok: true }), readComments: async () => [], readInbox: async () => [], readNotifications: async () => [], close: async () => {}, isOpen: () => true });
  const rk = createRuangkita({ config: readRuangkitaConfig({}), generate: null, state, driverFactory: stubDriver });
  const r1 = await rk.handle("on");
  assert.match(r1, /Isi dulu RUANGKITA_USERNAME/, "on ditolak tanpa kredensial");
  ok("orkestrator: on butuh kredensial");

  const kv2 = new Map();
  const state2 = { get: async (k) => kv2.get(k) ?? null, set: async (k, v) => void kv2.set(k, v) };
  let posted = null;
  const rk2 = createRuangkita({
    config: readRuangkitaConfig({ RUANGKITA_USERNAME: "wak", RUANGKITA_PASSWORD: "x" }),
    generate: async () => ({ text: "status uji" }), state: state2,
    driverFactory: () => ({ login: async () => ({ ok: true, already: false }), readFeed: async () => ["a"], setBio: async () => ({ ok: true }), postStatus: async (t) => { posted = t; return { ok: true }; }, scanPosts: async () => [], likePost: async () => ({ ok: true }), commentOnPost: async () => ({ ok: true }), readComments: async () => [], readInbox: async () => [], readNotifications: async () => [], close: async () => {}, isOpen: () => true }),
  });
  const ron = await rk2.handle("on");
  assert.match(ron, /AKTIF/);
  const rp = await rk2.handle("post tes");
  assert.match(rp, /Diposting/); assert.equal(posted, "status uji");
  assert.ok(kv2.get("ruangkita")?.enabled === true, "state tersimpan");
  ok("orkestrator: on + post + state persist");
}

// --- balas komentar di status sendiri: dedupe + hanya status mine ---
{
  const kv = new Map();
  const state = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => void kv.set(k, v) };
  const comments = []; let scanCalls = 0;
  const driver = {
    login: async () => ({ ok: true }), setBio: async () => ({ ok: true }), postStatus: async () => ({ ok: true }),
    readFeed: async () => [], close: async () => {}, isOpen: () => true,
    scanPosts: async () => { scanCalls++; return [{ idx: 0, author: "Wak", mine: true, text: "status saya", liked: false }, { idx: 1, author: "Bob", mine: false, text: "halo dunia", liked: false }]; },
    readComments: async (idx) => (idx === 0 ? [{ who: "Alice", text: "keren wak" }, { who: "Wak", text: "makasih" }] : []),
    likePost: async () => ({ ok: true }),
    commentOnPost: async (idx, text) => { comments.push({ idx, text }); return { ok: true }; },
    readInbox: async () => [], readNotifications: async () => [],
  };
  const rk = createRuangkita({
    config: { ...readRuangkitaConfig({ RUANGKITA_USERNAME: "wak", RUANGKITA_PASSWORD: "x" }), displayName: "Wak" },
    generate: async () => ({ text: "hehe bisa aja" }), state, driverFactory: () => driver,
    sleep: async () => {}, random: () => 0.9,
  });
  // perlu login sekali (set driver aktif)
  await rk.handle("uji").catch(() => {});
  const done = await rk._internal.replyOwnComments(5);
  assert.equal(done, 1, "membalas 1 komentar (punya orang lain di status sendiri)");
  assert.equal(comments.length, 1); assert.equal(comments[0].idx, 0);
  assert.ok(!/["]/.test(comments[0].text), "teks balasan sudah di-jadul-kan");
  // tidak membalas komentar dari diri sendiri ("Wak")
  // panggil lagi: komentar yang sama tidak dibalas dua kali (dedupe)
  const again = await rk._internal.replyOwnComments(5);
  assert.equal(again, 0, "dedupe: komentar sama tak dibalas ulang");
  ok("replyOwnComments: balas sekali, lewati diri sendiri, dedupe");
}

// --- engageOthers: suka status orang lain + dedupe, hormati batas ---
{
  const kv = new Map();
  const state = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => void kv.set(k, v) };
  const likes = [], coms = [];
  const driver = {
    login: async () => ({ ok: true }), setBio: async () => ({ ok: true }), postStatus: async () => ({ ok: true }),
    readFeed: async () => [], close: async () => {}, isOpen: () => true,
    scanPosts: async () => [{ idx: 0, author: "Wak", mine: true, text: "x", liked: false }, { idx: 1, author: "Bob", mine: false, text: "halo", liked: false }, { idx: 2, author: "Cici", mine: false, text: "pagi", liked: false }],
    readComments: async () => [], likePost: async (idx) => { likes.push(idx); return { ok: true }; },
    commentOnPost: async (idx, t) => { coms.push({ idx, t }); return { ok: true }; },
    readInbox: async () => [], readNotifications: async () => [],
  };
  let clock = 2_000_000_000_000;
  const rk = createRuangkita({
    config: { ...readRuangkitaConfig({ RUANGKITA_USERNAME: "wak", RUANGKITA_PASSWORD: "x", RUANGKITA_ENGAGE_PER_HOUR: "5" }), displayName: "Wak" },
    generate: async () => ({ text: "mantap" }), state, driverFactory: () => driver,
    sleep: async () => {}, random: () => 0.99, now: () => clock, // >0.34 -> tidak komentar, hanya like
  });
  await rk.handle("uji").catch(() => {});
  const d1 = await rk._internal.engageOthers(5);
  assert.equal(d1, 1, "1 like per siklus (jeda minimum berlaku)");
  clock += 4 * 60_000;
  const d2 = await rk._internal.engageOthers(5);
  assert.equal(d2, 1, "like kedua setelah jeda");
  assert.deepEqual(likes.sort(), [1, 2], "hanya status orang lain yang disuka, bukan milik sendiri");
  assert.equal(coms.length, 0, "random 0.99 -> tidak komentar");
  clock += 4 * 60_000;
  const d3 = await rk._internal.engageOthers(5);
  assert.equal(d3, 0, "dedupe: tidak menyukai ulang");
  ok("engageOthers: like orang lain (berjeda), lewati milik sendiri, dedupe");
}

// --- tebak-tebakan: format & command ---
{
  assert.equal(parseCommand("tebak").kind, "tebak");
  assert.equal(parseCommand("tebakan").kind, "tebak");
  assert.ok(RIDDLE_BANK.includes(pickRiddle(() => 0)));
  const p = createPersona({ generate: null }); // fallback
  const r = await p.riddle();
  assert.ok(r.startsWith("Wak Kaji punya tebakan:"), "awalan tebakan benar");
  assert.ok(r.includes("...") || r.includes("…"), "ada pemisah pertanyaan-jawaban");
  assert.ok(!/["]/.test(r), "tanpa tanda kutip");
  const p2 = createPersona({ generate: async () => ({ text: "Apa yg loading terus? ...Perasaanmu 😅" }) });
  const r2 = await p2.riddle();
  assert.ok(r2.startsWith("Wak Kaji punya tebakan:") && !/[😅]/u.test(r2), "LLM dibungkus awalan + jadul");
  ok("tebak-tebakan: awalan, fallback, command");
}

// --- doPost mode tebak memakai persona.riddle ---
{
  const kv = new Map();
  const state = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => void kv.set(k, v) };
  let posted = "";
  const rk = createRuangkita({
    config: { ...readRuangkitaConfig({ RUANGKITA_USERNAME: "wak", RUANGKITA_PASSWORD: "x" }), riddleRatio: 1 },
    generate: async ({ messages }) => ({ text: String(messages[0].content).includes("TEBAK") ? "Apa yg makin diisi makin kosong? ...Pulsa" : "status biasa" }),
    state, driverFactory: () => ({ login: async () => ({ ok: true }), setBio: async () => ({ ok: true }), postStatus: async (t) => { posted = t; return { ok: true }; }, readFeed: async () => [], scanPosts: async () => [], likePost: async () => ({ ok: true }), commentOnPost: async () => ({ ok: true }), readComments: async () => [], readInbox: async () => [], readNotifications: async () => [], close: async () => {}, isOpen: () => true }),
    sleep: async () => {},
  });
  await rk.handle("uji").catch(() => {});
  await rk.handle("tebak");
  assert.ok(posted.startsWith("Wak Kaji punya tebakan:"), "perintah tebak memposting format tebakan");
  ok("doPost mode tebak");
}

// --- perintah fitur on/off ---
{
  const kv = new Map();
  const state = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => void kv.set(k, v) };
  const rk = createRuangkita({ config: readRuangkitaConfig({}), generate: null, state, driverFactory: stubDriver });
  assert.equal(rk._internal.flags.likeOthers, true);
  const r = await rk.handle("fitur suka off");
  assert.match(r, /dimatikan/); assert.equal(rk._internal.flags.likeOthers, false);
  await rk.handle("fitur suka on");
  assert.equal(rk._internal.flags.likeOthers, true);
  ok("perintah /ruangkita fitur suka on|off");
}

console.log(`\nSEMUA LULUS (${n} grup assert) ✅`);
