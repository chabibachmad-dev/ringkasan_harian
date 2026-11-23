// Uji logika murni ruangkita.js (tanpa peramban).
import assert from "node:assert";
import {
  readRuangkitaConfig, createLimiter, pickDelayMs, jadulkan, pickJoke, JOKE_BANK,
  createPersona, parseCommand, withinActiveHours, createRuangkita,
} from "./ruangkita.js";

let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };

// --- config ---
{
  const c = readRuangkitaConfig({});
  assert.equal(c.enabled, false); assert.equal(c.url, "https://ruangkita.online");
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
  const rk = createRuangkita({ config: readRuangkitaConfig({}), generate: null, state, driverFactory: () => ({ login: async () => ({ ok: true }), readFeed: async () => [], setBio: async () => ({ ok: true }), postStatus: async () => ({ ok: true }), close: async () => {}, isOpen: () => true }) });
  const r1 = await rk.handle("on");
  assert.match(r1, /Isi dulu RUANGKITA_USERNAME/, "on ditolak tanpa kredensial");
  ok("orkestrator: on butuh kredensial");

  const kv2 = new Map();
  const state2 = { get: async (k) => kv2.get(k) ?? null, set: async (k, v) => void kv2.set(k, v) };
  let posted = null;
  const rk2 = createRuangkita({
    config: readRuangkitaConfig({ RUANGKITA_USERNAME: "wak", RUANGKITA_PASSWORD: "x" }),
    generate: async () => ({ text: "status uji" }), state: state2,
    driverFactory: () => ({ login: async () => ({ ok: true, already: false }), readFeed: async () => ["a"], setBio: async () => ({ ok: true }), postStatus: async (t) => { posted = t; return { ok: true }; }, close: async () => {}, isOpen: () => true }),
  });
  const ron = await rk2.handle("on");
  assert.match(ron, /AKTIF/);
  const rp = await rk2.handle("post tes");
  assert.match(rp, /Diposting/); assert.equal(posted, "status uji");
  assert.ok(kv2.get("ruangkita")?.enabled === true, "state tersimpan");
  ok("orkestrator: on + post + state persist");
}

console.log(`\nSEMUA LULUS (${n} grup assert) ✅`);
