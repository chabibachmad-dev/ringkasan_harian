// Tes "ngobrol" mode humor grup (ngobrol.js + bagian balas/sapa di humor.js). Jalankan: node test-ngobrol.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { STATE_KEY, SCHED_KEY, createHumor, parseHumorArg, readHumorConfig } from "./humor.js";
import { FALLBACK_SAPA, buildReplyPrompt, buildSapaPrompt, detectReplyPref, isReplyWorthy, pickSapaKind, readNgobrolConfig, validateChat } from "./ngobrol.js";

let n = 0;
async function ok(name, fn) {
  await fn();
  n += 1;
  console.log(`ok: ${name}`);
}
const silent = { log() {}, warn() {}, error() {} };
const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
};
const MIN = 60_000;
const T_NOON = Date.UTC(2026, 9, 5, 4, 0); // Senin 12:00 WITA
const T_MIDNIGHT = Date.UTC(2026, 9, 5, 16, 0); // Selasa 00:00 WITA
const JID = "111@g.us";

function rig(over = {}) {
  const st = over.state || mem();
  const sent = [];
  let t = over.t0 ?? T_NOON;
  const timers = [];
  const aiCalls = [];
  let counter = 0;
  let rnd = 0.99; // bawaan: peluang tidak pernah lolos, kecuali tes memintanya
  const aiOut = over.aiOut ?? (() => `Menurut kalian hari ini lebih enak ngopi atau ngeteh, versi ke-${(counter += 1)}? ☕`);
  const h = createHumor({
    state: st,
    ai: over.noAi ? null : async (c) => (aiCalls.push(c), typeof aiOut === "function" ? aiOut(c, aiCalls.length) : aiOut),
    send: async (a, jid, text, o) => {
      if (over.sendFail?.()) throw new Error("WhatsApp putus");
      sent.push({ a, jid, text, o, at: t });
    },
    listGroups: async () => [{ id: JID, subject: "Keluarga Besar", allowed: true }, { id: "222@g.us", subject: "Arisan RT 05", allowed: true }],
    secondEnabled: false,
    sleep: async () => {},
    react: over.react,
    review: over.review,
    timeZone: "Asia/Makassar",
    config: readHumorConfig({ WA_BALAS_CHANCE: "0.5", ...(over.env || {}) }),
    now: () => t,
    random: over.random || (() => rnd),
    log: silent,
    timer: (fn, ms) => timers.push({ fn, ms })
  });
  return { h, st, sent, timers, aiCalls, setRnd: (v) => void (rnd = v), tick: (ms) => void (t += ms), setNow: (x) => void (t = x), now: () => t };
}
const say = (r, name, text, extra = {}) => {
  r.tick(extra.gap ?? 20_000);
  const msg = { key: { id: `m-${r.now()}` }, name, text };
  if (extra.rnd !== undefined) r.setRnd(extra.rnd);
  const res = r.h.observe("main", JID, { name, ids: [`id-${name}`], text, msg, ...extra.opts });
  r.setRnd(0.99);
  return { res, msg };
};
const NAMES = ["Budi", "Sari", "Rudi"];

await ok("konfigurasi ngobrol: bawaan 15 chat, 24 jam, minimal 10 sapa/hari; batas wajar", () => {
  const d = readNgobrolConfig({});
  assert.equal(d.contextSize, 15);
  assert.deepEqual(d.balasWindow, { from: 0, to: 1439 }, "tanpa batas jam");
  assert.deepEqual(d.sapaWindow, { from: 0, to: 1439 });
  assert.equal(d.sapaPerDay, 10);
  assert.equal(readNgobrolConfig({ WA_SAPA_PER_DAY: "3" }).sapaPerDay, 10, "tidak bisa di bawah 10");
  assert.equal(readNgobrolConfig({ WA_SAPA_PER_DAY: "20" }).sapaPerDay, 20);
  assert.equal(readNgobrolConfig({ WA_SAPA_PER_DAY: "999" }).sapaPerDay, 48);
  assert.equal(readNgobrolConfig({ WA_BALAS_CHANCE: "9" }).balasChance, 1);
  assert.equal(readNgobrolConfig({ WA_BALAS_MAX_PER_DAY: "0" }).balasMaxPerDay, 0);
  assert.deepEqual(readNgobrolConfig({ WA_BALAS_WINDOW: "08:00-22:00" }).balasWindow, { from: 480, to: 1320 });
  assert.deepEqual(readNgobrolConfig({ WA_BALAS_WINDOW: "ngawur" }).balasWindow, { from: 0, to: 1439 });
  assert.equal(readHumorConfig({}).contextSize, 15, "ikut di konfigurasi humor");
});

await ok("penolakan 'bot jangan balas chatku' dan pencabutannya", () => {
  for (const s of ["bot jangan balas chatku", "ayyubi jangan nimbrung chat aku ya", "bot gak usah balas pesan saya", "bot jangan nyamber aku"]) assert.equal(detectReplyPref(s), "out", s);
  for (const s of ["bot boleh balas chatku lagi", "ayyubi silakan nimbrung chat aku lagi"]) assert.equal(detectReplyPref(s), "in", s);
  for (const s of ["jangan balas dulu ya", "tolong balas chat dia", "bot, jam berapa sekarang?", "aku jangan dibalas siapa-siapa", "bot jangan roasting aku"]) assert.equal(detectReplyPref(s), null, s);
});

await ok("pesan yang layak dibalas: bukan sapaan sepatah, tautan saja, mention, perintah bot lain, pengumuman panjang", () => {
  assert.equal(isReplyWorthy("siapa yang mau ikut makan siang bareng?"), true);
  for (const s of ["ok", "👍👍", "https://youtu.be/abcd", "@6281234567890 tolong cek ya", "/menu", "x".repeat(450), "hahaha"]) assert.equal(isReplyWorthy(s), false, s);
  assert.equal(isReplyWorthy("lihat ini dong https://contoh.com/artikel menarik banget isinya"), true, "tautan + komentar tetap boleh");
});

await ok("penyaring balasan: SKIP, tautan, kata kasar, identitas model, pengulangan", () => {
  assert.equal(validateChat("Wah iya, aku juga penasaran rasanya 😄").ok, true);
  assert.equal(validateChat("SKIP").reason, "AI memilih SKIP");
  assert.equal(validateChat("cek https://contoh.com ya").ok, false);
  assert.equal(validateChat("@Budi setuju").ok, false);
  assert.equal(validateChat("dasar anjing kamu").ok, false);
  assert.equal(validateChat("Sebagai AI, saya tidak punya pendapat.").ok, false);
  assert.equal(validateChat("Aku Gemini dari Google").ok, false);
  assert.equal(validateChat("Setuju banget 😄", { recent: ["setuju banget!"] }).ok, false, "tidak mengulang pesan yang baru dikirim");
  assert.equal(validateChat("a. b. c. d. e. f.").ok, false, "lebih dari empat kalimat");
  assert.equal(validateChat("Ayyubi: halo semua, semoga harinya menyenangkan").text, "halo semua, semoga harinya menyenangkan", "awalan nama dibuang");
});

await ok("prompt balasan memuat 15 chat sebelumnya + pesan yang dibalas, dengan aturan aman", () => {
  const ctx = Array.from({ length: 15 }, (_, i) => ({ name: `N${i}`, text: `pesan ${i}`, isBot: i === 14 }));
  const { system, user } = buildReplyPrompt({ target: { name: "Budi", text: "mau makan apa?" }, context: ctx });
  assert.match(user, /15 chat terakhir/);
  assert.match(user, /N0: pesan 0/);
  assert.match(user, /Ayyubi \(kamu\): pesan 14/);
  assert.match(user, /Pesan yang dibalas -- Budi: mau makan apa\?/);
  assert.match(system, /SKIP/);
  assert.match(system, /tanpa SARA/);
  assert.match(system, /jangan mengarang fakta/);
  const sp = buildSapaPrompt({ kind: pickSapaKind(() => 0), weekday: "Senin", part: "pagi", avoid: ["pesan lama"] });
  assert.match(sp.user, /Senin/);
  assert.match(sp.user, /pesan lama/);
  assert.ok(FALLBACK_SAPA.length >= 20 && new Set(FALLBACK_SAPA).size === FALLBACK_SAPA.length);
  for (const f of FALLBACK_SAPA) assert.equal(validateChat(f, { maxLen: 320 }).ok, true, `cadangan harus lolos penyaring: ${f}`);
});

await ok("perintah /humor: balas & sapa bisa dinyalakan terpisah; on/semua = semua fitur; tes sapa/balas", () => {
  assert.deepEqual(parseHumorArg("balas on 2"), { kind: "set", flags: ["balas"], value: true, target: "2", account: null });
  assert.deepEqual(parseHumorArg("sapa off keluarga"), { kind: "set", flags: ["sapa"], value: false, target: "keluarga", account: null });
  assert.deepEqual(parseHumorArg("ngobrol on 3").flags, ["sapa"]);
  assert.deepEqual(parseHumorArg("on 2").flags, ["chat", "pantun", "roast", "balas", "sapa"]);
  assert.deepEqual(parseHumorArg("semua on").flags.length, 5);
  assert.equal(parseHumorArg("tes sapa 2").what, "sapa");
  assert.equal(parseHumorArg("tes balas keluarga besar").target, "keluarga besar");
  assert.equal(parseHumorArg("tes 2").what, "pantun");
  assert.equal(parseHumorArg("tes sapa").kind, "error", "tanpa grup");
});

await ok("balas: membaca 15 chat sebelumnya lalu membalas (reply) pesan orang, tanpa batas jam", async () => {
  const r = rig({ t0: Date.UTC(2026, 9, 5, 19, 0) }); // 03:00 WITA dini hari
  await r.h.load();
  assert.match(await r.h.handle("balas on keluarga"), /Dinyalakan: balas chat acak/);
  for (let i = 0; i < 20; i += 1) say(r, NAMES[i % 3], `obrolan nomor ${i} tentang rencana akhir pekan kita`, { opts: {} });
  const { res, msg } = say(r, "Budi", "ada yang tahu tempat makan enak dekat sini?", { rnd: 0 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.scheduled, true);
  assert.equal(r.timers.length >= 1, true);
  const last = r.timers.at(-1);
  assert.ok(last.ms >= 2500 && last.ms <= 21_000, "jeda manusiawi 2,5-21 detik");
  assert.equal(r.sent.length, 0, "belum terkirim sebelum jeda habis");
  await last.fn();
  await new Promise((x) => setImmediate(x));
  assert.equal(r.sent.length, 1, "terkirim pukul 03:00 (tanpa batas jam)");
  assert.equal(r.sent[0].o.quoted, msg, "dibalas sebagai reply ke pesan orangnya");
  const prompt = r.aiCalls.at(-1).user;
  assert.match(prompt, /15 chat terakhir/);
  const used = (prompt.match(/obrolan nomor \d+/g) || []).length;
  assert.equal(used, 15, "tepat 15 chat sebelumnya");
  assert.match(prompt, /obrolan nomor 19/);
  assert.doesNotMatch(prompt, /obrolan nomor 4 /, "chat yang lebih lama dari 15 tidak ikut");
  assert.match(prompt, /Pesan yang dibalas -- Budi: ada yang tahu tempat makan enak/);
});

await ok("balas: jeda antar-balasan, jatah harian, jendela jam bila diatur, obrolan serius, penolak, SKIP, kata terlarang", async () => {
  const warm = async (r, jid = JID) => {
    for (let i = 0; i < 5; i += 1) say(r, NAMES[i % 3], `kita ngobrol soal kegiatan hari minggu ${i}`);
  };
  // jeda: balasan kedua langsung setelah yang pertama ditolak
  let r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await warm(r);
  let x = say(r, "Budi", "kalian suka kopi atau teh sih?", { rnd: 0 });
  assert.equal(x.res.ok, true);
  await r.timers.at(-1).fn();
  assert.equal(r.sent.length, 1);
  x = say(r, "Sari", "aku sih teh manis hangat kalau pagi");
  assert.equal(x.res.reason, "bot baru saja bicara");
  r.tick(4 * MIN);
  x = say(r, "Rudi", "kalau aku kopi hitam tanpa gula", { rnd: 0 });
  assert.equal(x.res.ok, true, "sesudah jeda 3 menit boleh lagi");
  // jatah harian
  r = rig({ env: { WA_BALAS_MAX_PER_DAY: "1" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await warm(r);
  x = say(r, "Budi", "kalian suka kopi atau teh sih?", { rnd: 0 });
  await r.timers.at(-1).fn();
  r.tick(10 * MIN);
  x = say(r, "Sari", "kalau aku lebih suka teh biasa saja");
  assert.equal(x.res.reason, "jatah hari ini habis");
  // jendela jam (bila diatur)
  r = rig({ env: { WA_BALAS_WINDOW: "08:00-22:00" }, t0: Date.UTC(2026, 9, 5, 19, 0) });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await warm(r);
  x = say(r, "Budi", "kalian suka kopi atau teh sih?", { rnd: 0 });
  assert.equal(x.res.reason, "di luar jam aktif");
  // serius
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await warm(r);
  say(r, "Sari", "innalillahi bapaknya Budi meninggal tadi pagi");
  r.tick(2 * MIN);
  x = say(r, "Rudi", "turut berduka cita ya semuanya");
  assert.equal(x.res.reason, "obrolan serius");
  // penolak
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  const pref = await r.h.handlePreference("main", JID, { name: "Budi", ids: ["id-Budi"], text: "bot jangan balas chatku" });
  assert.equal(pref.pref, "noreply");
  assert.match(pref.reply, /tidak akan kubalas/);
  await warm(r);
  x = say(r, "Budi", "kalian suka kopi atau teh sih?", { rnd: 0 });
  assert.equal(x.res.reason, "orang ini menolak dibalas");
  x = say(r, "Sari", "aku kopi dong tiap pagi", { rnd: 0 });
  assert.equal(x.res.ok, true, "orang lain tetap bisa dibalas");
  assert.equal((await r.h.handlePreference("main", JID, { name: "Budi", ids: ["id-Budi"], text: "bot boleh balas chatku lagi" })).pref, "reply-ok");
  assert.equal(JSON.parse(r.st.m.get(STATE_KEY)).noreply[`main|${JID}`], undefined, "pencabutan tersimpan");
  // AI memilih SKIP / keluaran terlarang -> diam
  for (const out of ["SKIP", "dasar anjing, bukan urusanmu", "Sebagai AI aku tidak punya selera"]) {
    r = rig({ aiOut: out });
    await r.h.load();
    await r.h.handle("balas on keluarga");
    await warm(r);
    x = say(r, "Budi", "kalian suka kopi atau teh sih?", { rnd: 0 });
    assert.equal(x.res.ok, true);
    await r.timers.at(-1).fn();
    assert.equal(r.sent.length, 0, `tidak terkirim untuk: ${out}`);
  }
  // pesan tidak layak
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await warm(r);
  assert.equal(say(r, "Budi", "ok").res.reason, "pesan tidak layak dibalas");
  // bot dipanggil di pesan itu: hanya konteks, tidak dibalas acak
  const t = say(r, "Budi", "bot, tolong jelaskan apa itu SPBy", { opts: { triggered: true } });
  assert.equal(t.res.reason, "bot dipanggil");
  assert.equal(r.timers.length, 0);
  // belum ada konteks
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  assert.equal(say(r, "Budi", "ada yang tahu tempat makan enak?").res.reason, "belum ada konteks");
});

await ok("balas: dibatalkan bila ada yang memanggil bot / pesan spontan lain muncul selama jeda; grup lain & fitur mati tidak dibaca", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  for (let i = 0; i < 5; i += 1) say(r, NAMES[i % 3], `kita ngobrol soal kegiatan hari minggu ${i}`);
  const x = say(r, "Budi", "kalian suka kopi atau teh sih?", { rnd: 0 });
  assert.equal(x.res.ok, true);
  r.h.noteTriggered("main", JID); // bot dipanggil selama jeda
  await r.timers.at(-1).fn();
  assert.equal(r.sent.length, 0, "dibatalkan");
  // fitur mati / grup lain: tidak ada yang disimpan
  assert.equal(r.h.observe("main", "222@g.us", { name: "X", ids: ["x"], text: "halo semuanya apa kabar" }), null);
  assert.equal(r.h._debug.ctxBuf.has("main|222@g.us"), false);
  await r.h.handle("balas off keluarga");
  assert.equal(r.h._debug.ctxBuf.has(`main|${JID}`), false, "dimatikan: obrolan yang tersimpan dibuang");
});

await ok("sapa: minimal 10 kali sehari, jam menyebar 24 jam, jarak wajar, tidak dobel setelah restart", async () => {
  for (const rnd of [() => 0.5, () => 0.99, () => 0.01, Math.random]) {
    const r = rig({ t0: T_MIDNIGHT, random: rnd });
    await r.h.load();
    await r.h.handle("sapa on keluarga");
    for (let i = 0; i < 24 * 12; i += 1) {
      await r.h.check();
      r.tick(5 * MIN);
    }
    assert.ok(r.sent.length >= 10, `minimal 10 pesan sehari (didapat ${r.sent.length})`);
    assert.ok(r.sent.length <= 12, `tidak berlebihan (didapat ${r.sent.length})`);
    for (let i = 1; i < r.sent.length; i += 1) assert.ok(r.sent[i].at - r.sent[i - 1].at >= 10 * MIN - 1, "jarak minimal 10 menit");
    const hours = new Set(r.sent.map((s) => Math.floor(((s.at - T_MIDNIGHT) / 3_600_000) % 24)));
    assert.ok(hours.size >= 7, `menyebar sepanjang hari (jam berbeda: ${hours.size})`);
    assert.ok(r.sent.every((s) => s.jid === JID && !s.o?.quoted), "chat sendiri, bukan reply");
    assert.equal(new Set(r.sent.map((s) => s.text)).size, r.sent.length, "tidak ada pesan kembar");
  }
  // restart di tengah hari: jadwal & hitungan terbaca ulang, tidak mengulang dari nol
  let r = rig({ t0: T_MIDNIGHT, random: () => 0.5 });
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  for (let i = 0; i < 12 * 12; i += 1) {
    await r.h.check();
    r.tick(5 * MIN);
  }
  const before = r.sent.length;
  assert.ok(before >= 3 && before < 10);
  const r2 = rig({ state: r.st, t0: r.now(), random: () => 0.5 });
  await r2.h.load();
  for (let i = 0; i < 12 * 12; i += 1) {
    await r2.h.check();
    r2.tick(5 * MIN);
  }
  assert.ok(before + r2.sent.length >= 10 && before + r2.sent.length <= 12, `total sehari tetap ~10 setelah restart (${before}+${r2.sent.length})`);
});

await ok("sapa: bot mati berjam-jam -> jarak merapat supaya jatah tetap terkejar; hari pertama siang hari menyesuaikan sisa hari", async () => {
  let r = rig({ t0: T_MIDNIGHT, random: () => 0.5 });
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  await r.h.check(); // jadwal dibuat 00:00
  r.tick(14 * 60 * MIN); // bot "mati" sampai 14:00
  for (let i = 0; i < 10 * 12; i += 1) {
    await r.h.check();
    r.tick(5 * MIN);
  }
  assert.ok(r.sent.length >= 6, `mengejar ketertinggalan sisa hari (${r.sent.length})`);
  // dinyalakan pukul 18:00 -> jatah hari itu proporsional (sekitar 10 x 6/24), bukan 10 sekaligus
  r = rig({ t0: Date.UTC(2026, 9, 6, 2, 0) - 0, random: () => 0.5 }); // 10:00 WITA
  r.setNow(Date.UTC(2026, 9, 5, 10, 0)); // 18:00 WITA
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  await r.h.check();
  const plan = JSON.parse(r.st.m.get(SCHED_KEY)).sapa[`main|${JID}`];
  assert.equal(plan.target, 3, "18:00 -> sisa ~6 jam -> 3 pesan");
});

await ok("sapa: menunda saat obrolan serius/sedang ramai, tetap mengirim saat sepi; tanpa AI memakai cadangan tanpa pengulangan", async () => {
  const r = rig({ t0: T_MIDNIGHT, random: () => 0.5, noAi: true, env: { WA_SAPA_MIN_GAP_MIN: "1" } });
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  await r.h.check();
  const plan = () => JSON.parse(r.st.m.get(SCHED_KEY)).sapa[`main|${JID}`];
  r.setNow(plan().nextAt + MIN);
  // sedang ada obrolan duka -> ditunda 15 menit
  r.h.observe("main", JID, { name: "Sari", ids: ["s"], text: "innalillahi nenek Budi meninggal tadi malam", msg: {} });
  r.tick(40_000);
  await r.h.check();
  assert.equal(r.sent.length, 0, "tidak menyela obrolan duka");
  r.tick(20 * MIN);
  await r.h.check();
  assert.equal(r.sent.length, 0, "20 menit kemudian duka masih terlalu baru (jendela 30 menit)");
  r.tick(15 * MIN);
  await r.h.check();
  assert.equal(r.sent.length, 1, "setelah obrolan duka reda, terkirim");
  assert.ok(FALLBACK_SAPA.includes(r.sent[0].text), "tanpa AI -> cadangan");
  // sedang ada yang mengetik baru saja -> tunda 1 menit
  const r2 = rig({ t0: T_MIDNIGHT, random: () => 0.5, noAi: true });
  await r2.h.load();
  await r2.h.handle("sapa on keluarga");
  await r2.h.check();
  r2.setNow(JSON.parse(r2.st.m.get(SCHED_KEY)).sapa[`main|${JID}`].nextAt + MIN);
  r2.h.observe("main", JID, { name: "Budi", ids: ["b"], text: "nah itu dia maksudku tadi", msg: {} });
  r2.tick(10_000);
  await r2.h.check();
  assert.equal(r2.sent.length, 0, "ada chat 10 detik lalu -> tunggu");
  r2.tick(2 * MIN);
  await r2.h.check();
  assert.equal(r2.sent.length, 1);
});

await ok("sapa: kegagalan kirim dicoba lagi nanti (tidak macet, tidak dobel); AI SKIP/terlarang jatuh ke cadangan", async () => {
  let fail = true;
  const r = rig({ t0: T_MIDNIGHT, random: () => 0.5, sendFail: () => fail, aiOut: "SKIP" });
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  await r.h.check();
  const plan = () => JSON.parse(r.st.m.get(SCHED_KEY)).sapa[`main|${JID}`];
  r.setNow(plan().nextAt + MIN);
  await r.h.check();
  assert.equal(r.sent.length, 0);
  assert.equal(plan().count, 0);
  assert.ok(plan().tries >= 1 && plan().nextAt > r.now(), "dijadwalkan ulang beberapa menit lagi");
  fail = false;
  r.setNow(plan().nextAt + MIN);
  await r.h.check();
  assert.equal(r.sent.length, 1);
  assert.ok(FALLBACK_SAPA.includes(r.sent[0].text), "AI mengembalikan SKIP -> cadangan");
  assert.equal(plan().count, 1);
});

await ok("tes manual: /humor tes sapa & tes balas; tidak menghabiskan jatah", async () => {
  const r = rig({ t0: T_NOON });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("sapa on keluarga");
  const s = await r.h.handle("tes sapa keluarga");
  assert.match(s, /Chat otomatis percobaan terkirim/);
  assert.equal(r.sent.length, 1);
  assert.equal(JSON.parse(r.st.m.get(SCHED_KEY)).sapa[`main|${JID}`].count ?? 0, 0, "percobaan tidak dihitung");
  for (let i = 0; i < 4; i += 1) say(r, NAMES[i % 3], `ngobrol soal rencana liburan nomor ${i}`);
  const b = await r.h.handle("tes balas keluarga");
  assert.match(b, /Balasan percobaan terkirim/);
  assert.equal(r.sent.at(-1).o.quoted !== undefined, true);
  assert.match(r.aiCalls.at(-1).user, /Ayyubi \(kamu\)/, "pesan sapa bot sebelumnya ikut jadi konteks");
});

await ok("status: menampilkan balas & sapa dengan hitungan hari ini", async () => {
  const r = rig({ t0: T_MIDNIGHT });
  await r.h.load();
  await r.h.handle("on keluarga");
  await r.h.check();
  const st = await r.h.handle("");
  assert.match(st, /balas ✅/);
  assert.match(st, /sapa ✅ \(0\/10 hari ini, berikut ±\d\d:\d\d\)/);
  assert.match(st, /minimal 10×\/hari\/grup/);
  assert.match(st, /membaca 15 chat sebelumnya/);
});

await ok("privasi: isi obrolan tidak pernah masuk penyimpanan (bot_state), hanya pengaturan & jadwal", async () => {
  const r = rig({ t0: T_NOON });
  await r.h.load();
  await r.h.handle("on keluarga");
  for (let i = 0; i < 8; i += 1) say(r, NAMES[i % 3], `rahasia obrolan keluarga nomor ${i} jangan bocor`);
  await r.h.check();
  const stored = JSON.stringify([...r.st.m.entries()]);
  assert.doesNotMatch(stored, /rahasia obrolan/);
  assert.ok(r.h._debug.ctxBuf.get(`main|${JID}`).length <= 23, "konteks dibatasi");
  // restart: konteks hilang
  const r2 = rig({ state: r.st });
  await r2.h.load();
  assert.equal(r2.h._debug.ctxBuf.size, 0);
});

await ok("roast tidak menyusul pesan spontan bot yang baru saja terkirim", async () => {
  const r = rig({ env: { WA_HUMOR_ROAST_CHANCE: "1" } });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  await r.h.handle("sapa on keluarga");
  // bot baru saja bicara sendiri (lewat sapa uji)
  await r.h.handle("tes sapa keluarga");
  for (const [nm, tx] of [["Budi", "wkwk lapar nih"], ["Sari", "ngopi yuk gabut banget"], ["Budi", "hahaha boleh"], ["Rudi", "gas, wkwk"]]) say(r, nm, tx);
  const e = r.h.evaluate("main", JID, { ignoreChance: true });
  assert.equal(e.ok, false);
  assert.equal(e.reason, "bot baru saja bicara sendiri");
});

await ok("terintegrasi di index.js, telegram/dokumentasi, .env.example, package.json", () => {
  const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const idx = read("./index.js");
  assert.match(idx, /humor\.observe\(humorAcct, groupJid, \{[^}]*triggered, repliedToBot: repliedToOwn \}\)/, "semua pesan grup (termasuk yang memanggil bot) jadi konteks");
  assert.match(idx, /humor\.noteBotSaid\(/, "jawaban bot ikut jadi konteks");
  assert.ok(idx.indexOf("humor.observe(") < idx.indexOf("offerAgendaFromChat(sock, msg, groupJid, rawText)"));
  assert.match(read("./README.md"), /Balas chat acak/);
  assert.match(read("./README.md"), /WA_SAPA_PER_DAY/);
  assert.match(read("./.env.example"), /WA_SAPA_PER_DAY/);
  assert.match(read("./.env.example"), /WA_BALAS_CHANCE/);
  assert.match(read("./package.json"), /test-ngobrol\.mjs/);
});

console.log(`\nSemua ${n} kelompok tes ngobrol lulus.`);
