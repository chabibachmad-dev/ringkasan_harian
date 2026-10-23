// Tes pelatihan "makin manusiawi" tahap 2: energi harian, gaya tulis alami, ingatan ringan, lanjutan obrolan, reply selektif, tanpa jatah harian.
// Jalankan: node test-insani.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { STATE_KEY, createHumor, parseHumorArg, readHumorConfig } from "./humor.js";
import { dayEnergy, extractSelfFacts, fatigueFactor, hash01, hourFactor, informality, jitterGap, naturalize, reactionFromText, replyChance } from "./insani.js";
import { emptyStyle, updateStyle } from "./manusiawi.js";

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
const DAY = 24 * 60 * MIN;
const T_NOON = Date.UTC(2026, 9, 5, 4, 0); // Senin 5 Okt 2026 12:00 WITA
const JID = "111@g.us";
const KEY = `main|${JID}`;

function rig(over = {}) {
  const st = over.state || mem();
  const sent = [];
  const reacts = [];
  let t = over.t0 ?? T_NOON;
  const timers = [];
  const aiCalls = [];
  let rnd = over.rnd ?? 0.99;
  const h = createHumor({
    state: st,
    ai: async (c) => (aiCalls.push(c), typeof over.aiOut === "function" ? over.aiOut(c, aiCalls.length) : over.aiOut ?? `Wah seru banget, nanti ceritain ya? (${aiCalls.length})`),
    send: async (a, jid, text, o) => void sent.push({ a, jid, text, o, at: t }),
    react: async (a, jid, msg, emoji) => void reacts.push({ a, jid, msg, emoji, at: t }),
    sleep: async () => {},
    listGroups: async () => [{ id: JID, subject: "Keluarga Besar", allowed: true }],
    secondEnabled: false,
    timeZone: "Asia/Makassar",
    config: readHumorConfig({ WA_BALAS_CHANCE: "0.5", WA_ENERGI_HARIAN: "off", WA_GAYA_ALAMI: "off", WA_TYPO_CHANCE: "0", ...(over.env || {}) }),
    now: () => t,
    random: () => rnd,
    log: silent,
    timer: (fn, ms) => timers.push({ fn, ms })
  });
  return { h, st, sent, reacts, timers, aiCalls, setRnd: (v) => void (rnd = v), tick: (ms) => void (t += ms), setNow: (x) => void (t = x), now: () => t };
}
const say = (r, name, text, extra = {}) => {
  r.tick(extra.gap ?? 20_000);
  const msg = { key: { id: `m-${r.now()}-${name}` }, name, text };
  if (extra.rnd !== undefined) r.setRnd(extra.rnd);
  const res = r.h.observe("main", JID, { name, ids: [`id-${name}`], text, msg, ...extra.opts });
  r.setRnd(0.99);
  return { res, msg };
};
const NAMES = ["Budi", "Sari", "Rudi"];
const warm = (r, k = 6) => {
  for (let i = 0; i < k; i += 1) say(r, NAMES[i % 3], `kita ngobrol soal kegiatan hari minggu nomor ${i}`);
};
const runLast = async (r) => {
  const tm = r.timers.pop();
  assert.ok(tm, "ada balasan yang dijadwalkan");
  await tm.fn();
  r.timers.length = 0;
};

// ================================================================ bagian murni
await ok("energi harian: stabil sepanjang hari, beda antar hari/grup, ketiga tingkat muncul; ritme jam, kelelahan, jeda berubah-ubah", () => {
  assert.equal(hash01("a"), hash01("a"));
  assert.notEqual(hash01("a"), hash01("b"));
  assert.deepEqual(dayEnergy("k", "2026-10-05"), dayEnergy("k", "2026-10-05"));
  const levels = new Set();
  for (let i = 0; i < 80; i += 1) levels.add(dayEnergy("main|g", `2026-10-${String(i).padStart(2, "0")}`).level);
  assert.deepEqual([...levels].sort(), ["biasa", "kalem", "semangat"]);
  const kalem = dayEnergy("x", [...Array(200).keys()].map((i) => `d${i}`).find((d) => dayEnergy("x", d).level === "kalem"));
  assert.ok(kalem.chance < 1 && kalem.gap > 1 && kalem.hint);
  assert.ok(hourFactor(3 * 60) < hourFactor(9 * 60) && hourFactor(14 * 60) < hourFactor(17 * 60));
  assert.equal(fatigueFactor(0), 1);
  assert.ok(fatigueFactor(2) < fatigueFactor(1) && fatigueFactor(50) === 0.35);
  const gaps = new Set([1, 2, 3, 4, 5, 6].map((s) => jitterGap(180_000, s)));
  assert.ok(gaps.size > 1);
  for (const g of gaps) assert.ok(g >= 144_000 && g <= 288_000);
  assert.equal(jitterGap(180_000, 7), jitterGap(180_000, 7), "stabil untuk seed sama");
  assert.equal(replyChance(5), 0.9);
  assert.ok(replyChance(0.5, { toOther: true }) < replyChance(0.5) / 5);
  assert.ok(replyChance(0.4, { fairness: 0.5 }) < replyChance(0.4));
});

const casualStyle = () => {
  const s = emptyStyle();
  for (let i = 0; i < 40; i += 1) updateStyle(s, i % 3 === 0 ? "wkwk iyaaa nih bro" : "gas dong udah aja lah");
  return s;
};
await ok("gaya tulis alami: grup santai -> huruf kecil, udah/aja/nggak, tanpa titik akhir, 1 emoji; grup formal tidak diubah gayanya", () => {
  const st = casualStyle();
  assert.ok(informality(st) >= 0.45);
  const out = naturalize("Sangat menarik! Saya tidak tahu bagaimana kamu sudah selesai saja.", st, { random: () => 0.9 }).text;
  assert.equal(out, "menarik banget! Saya nggak tahu gimana kamu udah selesai aja");
  assert.equal(naturalize("Selamat ya Budi 🎉🎉", st, { random: () => 0.9, keep: ["Budi"] }).text, "selamat ya Budi 🎉");
  assert.equal(naturalize("Budi, nanti kabari ya.", st, { random: () => 0.9, keep: ["Budi"] }).text, "Budi, nanti kabari ya", "nama tetap kapital");
  assert.equal(naturalize("NASA mengumumkan hasilnya.", st, { random: () => 0.9 }).text, "NASA mengumumkan hasilnya", "singkatan tetap");
  assert.ok(naturalize("Siap, nanti aku cek ya.", st, { random: () => 0.99 }).text.length > 5);
  const formal = emptyStyle();
  for (let i = 0; i < 40; i += 1) updateStyle(formal, "Mohon izin Bapak/Ibu, terima kasih atas perhatian dan kerja samanya");
  assert.equal(informality(formal), 0);
  assert.equal(naturalize("Baik, Bapak. Saya tidak keberatan.", formal, { random: () => 0.01 }).text, "Baik, Bapak. Saya tidak keberatan.");
  assert.equal(naturalize("Halo semuanya.", emptyStyle(), { random: () => 0.5 }).text, "Halo semuanya.", "data gaya belum cukup: tidak diubah");
  assert.equal(naturalize("", casualStyle()).text, "");
});

await ok("gaya tulis alami: ikut tertawa seperti grup, huruf memanjang; salah ketik hanya sesekali dan selalu dikoreksi; mati bila serius/typoChance 0", () => {
  const st = casualStyle();
  const withLaugh = naturalize("Wah itu lucu juga ya", st, { random: () => 0.01, typoChance: 0 });
  assert.match(withLaugh.text, /wkwk/);
  assert.equal(withLaugh.fix, undefined);
  assert.doesNotMatch(naturalize("Wah itu lucu juga ya", st, { random: () => 0.01, typoChance: 0, serious: true }).text, /wkwk/);
  assert.doesNotMatch(naturalize("Itu beneran terjadi kemarin?", st, { random: () => 0.01, typoChance: 0 }).text, /wkwk/, "pertanyaan tidak ditutup tawa");
  assert.match(naturalize("Oke, nanti aku kabari ya", st, { random: () => 0.1, typoChance: 0 }).text, /yaa/);
  const typo = naturalize("Menurutku rencana itu bagus sekali untuk kita semua", st, { random: () => 0.01, typoChance: 1 });
  assert.match(typo.fix, /^\*\p{L}{5,}$/u);
  const orig = typo.fix.slice(1);
  assert.ok(!typo.text.includes(orig), "kata aslinya diganti kata yang salah ketik");
  assert.equal(naturalize("Menurutku rencana itu bagus sekali untuk kita semua", st, { random: () => 0.01, typoChance: 0 }).fix, undefined);
  assert.equal(naturalize("Menurutku rencana itu bagus sekali untuk kita semua", st, { random: () => 0.01, typoChance: 1, serious: true }).fix, undefined);
  assert.equal(naturalize("pendek aja", st, { random: () => 0.01, typoChance: 1 }).fix, undefined, "teks pendek tidak diberi typo");
});

await ok("statistik gaya: kata memanjang dihitung (bukan tawa)", () => {
  const s = emptyStyle();
  updateStyle(s, "iyaaa deh");
  updateStyle(s, "wkwkwkwk lucu");
  updateStyle(s, "enaaak banget");
  assert.equal(s.stretch, 2);
});

await ok("ingatan ringan: hanya hal yang diceritakan sendiri; sensitif, pertanyaan, tautan ditolak; rencana/aktivitas punya masa berlaku", () => {
  assert.deepEqual(extractSelfFacts("aku suka kopi hitam"), [{ t: "aku suka kopi hitam", kind: "suka", ttlDays: 0 }]);
  assert.equal(extractSelfFacts("hobiku mancing di sungai")[0].t, "hobiku mancing di sungai");
  assert.equal(extractSelfFacts("aku punya kucing oren")[0].kind, "punya");
  assert.deepEqual(extractSelfFacts("aku lagi nonton drakor nih").map((x) => [x.kind, x.ttlDays]), [["lagi", 1]]);
  assert.deepEqual(extractSelfFacts("besok aku mau ke pantai").map((x) => [x.t, x.ttlDays]), [["aku besok ke pantai", 3]]);
  assert.deepEqual(extractSelfFacts("aku mau ke pantai besok").length, 0, "pola tak dikenal: tidak ditebak");
  for (const bad of ["aku suka judi slot", "aku suka gaji besar", "aku lagi di rumah sakit", "aku suka partai itu", "kamu suka kopi?", "aku suka kopi https://x.id", "aku punya anak dua", "bu Sari suka kopi"]) assert.deepEqual(extractSelfFacts(bad), [], bad);
});

await ok("reaksi dari isi pesan (kata kunci), bukan hanya suasana", () => {
  assert.equal(reactionFromText("alhamdulillah akhirnya lulus"), "🙏");
  assert.equal(reactionFromText("selamat ya pak atas pelantikannya"), "🎉");
  assert.equal(reactionFromText("mantap pak siap"), "👍");
  assert.equal(reactionFromText("keren banget hasilnya"), "🔥");
  assert.equal(reactionFromText("semangat ya kawan"), "💪");
  assert.equal(reactionFromText("wkwk ngakak parah"), "😂");
  assert.equal(reactionFromText("rapat jam 9 di ruang A"), null);
  assert.equal(reactionFromText("x"), null);
});

// ================================================================ perilaku di grup
await ok("tanpa jatah harian: bawaan WA_BALAS_MAX_PER_DAY=0 (tak terbatas) tetap diatur peluang & jeda; angka tertentu masih bisa membatasi", async () => {
  assert.equal(readHumorConfig({}).balasMaxPerDay, 0);
  assert.equal(readHumorConfig({}).reaksiMaxPerDay, 0);
  assert.equal(readHumorConfig({}).stikerMaxPerDay, 0);
  const run = async (env) => {
    const r = rig({ env });
    await r.h.load();
    await r.h.handle("balas on keluarga");
    warm(r);
    for (let i = 0; i < 6; i += 1) {
      r.tick(40 * MIN);
      say(r, NAMES[i % 3], `enaknya ngapain ya sore-sore begini nomor ${i} sambil nunggu hujan`, { rnd: 0 });
      if (r.timers.length) await runLast(r);
    }
    return r.sent.length;
  };
  assert.equal(await run({}), 6, "enam balasan dalam sehari: tidak dibatasi");
  assert.equal(await run({ WA_BALAS_MAX_PER_DAY: "2" }), 2, "bila pemilik mengisi batas, batas dihormati");
});

await ok("lanjutan obrolan: orang yang baru dibalas menulis lagi -> disahut walau jeda belum lewat (maks 2 kali beruntun); orang lain tetap kena jeda", async () => {
  const r = rig({ env: { WA_LANJUT_CHANCE: "0.9" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  say(r, "Budi", "enaknya ngapain ya sore-sore begini sambil nunggu hujan", { rnd: 0 });
  await runLast(r);
  assert.equal(r.sent.length, 1);
  const a = say(r, "Sari", "iya nih pengen yang hangat hangat kayaknya", { rnd: 0, gap: 30_000 });
  assert.equal(a.res?.ok, false, "orang lain: masih dalam jeda");
  const b = say(r, "Budi", "kopi hitam kayaknya cocok sambil dengerin hujan", { rnd: 0, gap: 30_000 });
  assert.equal(b.res?.ok, true, "Budi menulis lagi: disahut");
  await runLast(r);
  assert.equal(r.sent.length, 2);
  assert.match(r.aiCalls.at(-1).user, /sambung obrolannya|baru kamu balas/);
  const c = say(r, "Budi", "terus nanti malam enaknya makan apa ya kira kira", { rnd: 0, gap: 30_000 });
  assert.equal(c.res?.ok, true, "sahutan kedua");
  await runLast(r);
  assert.equal(r.sent.length, 3);
  const d = say(r, "Budi", "wah kamu rame juga ya malam ini ceritanya panjang", { rnd: 0, gap: 30_000 });
  assert.equal(d.res?.ok, false, "tidak ping-pong terus: maksimal 2 sahutan beruntun");
  const e = rig({ env: { WA_LANJUT_MAKS: "0" } });
  await e.h.load();
  await e.h.handle("balas on keluarga");
  warm(e);
  say(e, "Budi", "enaknya ngapain ya sore-sore begini sambil nunggu hujan", { rnd: 0 });
  await runLast(e);
  assert.equal(say(e, "Budi", "kopi hitam kayaknya cocok sambil dengerin hujan", { rnd: 0, gap: 30_000 }).res?.ok, false, "WA_LANJUT_MAKS=0 mematikan lanjutan");
});

await ok("pesan yang me-reply orang lain jarang disahut; bergantian antar-orang (orang yang baru dibalas lebih jarang dibalas lagi)", async () => {
  const r = rig({ env: { WA_BALAS_CHANCE: "0.5" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  const txt = "enaknya ngapain ya sore-sore begini sambil nunggu hujan";
  const other = say(r, "Budi", txt, { rnd: 0.3, opts: { quotedOther: true } });
  assert.equal(other.res?.ok, false);
  assert.match(other.res?.reason, /menjawab orang lain/);
  const plain = say(r, "Budi", txt, { rnd: 0.3 });
  assert.equal(plain.res?.ok, true, "tanpa kutipan ke orang lain: peluang normal");
  // pertanyaan ke semua tetap boleh walau me-reply orang lain
  const r2 = rig();
  await r2.h.load();
  await r2.h.handle("balas on keluarga");
  warm(r2);
  assert.equal(say(r2, "Budi", "menurut kalian enaknya ngapain ya sore-sore begini", { rnd: 0.3, opts: { quotedOther: true } }).res?.ok, true);
  // bergantian: sesudah Budi dibalas, 10 menit kemudian Budi lebih jarang dibalas lagi dibanding Sari yang belum
  const r3 = rig({ env: { WA_BALAS_CHANCE: "0.4" } });
  await r3.h.load();
  await r3.h.handle("balas on keluarga");
  warm(r3);
  say(r3, "Budi", "enaknya ngapain ya sore-sore begini sambil nunggu hujan", { rnd: 0 });
  await runLast(r3);
  const again = say(r3, "Budi", "kopi hitam kayaknya cocok sambil dengerin hujan sore", { rnd: 0.3, gap: 10 * MIN });
  const fresh = say(r3, "Sari", "aku juga pengen kopi hitam kayaknya cocok sambil dengerin hujan", { rnd: 0.3, gap: 20_000 });
  assert.equal(again.res?.ok, false, "yang baru dibalas: peluang dikurangi");
  assert.equal(fresh.res?.ok, true, "yang belum dibalas: peluang normal");
});

await ok("kutipan pesan yang dibalas orang menjadi konteks prompt balasan", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  say(r, "Budi", "kayaknya aku ikut deh yang itu, asal ada yang jemput", { rnd: 0, opts: { quotedText: "besok ada yang mau ikut ke pantai?" } });
  await runLast(r);
  assert.match(r.aiCalls.at(-1).user, /membalas\/mengutip: "besok ada yang mau ikut ke pantai\?"/);
});

await ok("balasan lewat deliver dirapikan mengikuti gaya grup (WA_GAYA_ALAMI), salah ketik dikoreksi di gelembung terpisah, mati dengan off", async () => {
  const mk = async (env) => {
    const r = rig({ env: { WA_GAYA_ALAMI: "on", ...env }, aiOut: "Sangat menarik, saya tidak tahu bagaimana kamu sudah menemukan tempat sebagus itu." });
    await r.h.load();
    await r.h.handle("balas on keluarga");
    for (let i = 0; i < 40; i += 1) say(r, NAMES[i % 3], i % 3 === 0 ? "wkwk iyaaa nih bro lucu banget" : "gas dong udah aja lah ya");
    r.tick(30 * MIN);
    say(r, "Budi", "tadi aku nemu tempat makan baru enak banget loh di dekat kantor", { rnd: 0 });
    await runLast(r);
    return r;
  };
  const a = await mk({});
  assert.equal(a.sent.length >= 1, true);
  assert.match(a.sent[0].text, /^menarik banget, saya nggak tahu gimana kamu udah menemukan tempat sebagus itu$/);
  const b = await mk({ WA_GAYA_ALAMI: "off" });
  assert.equal(b.sent[0].text, "Sangat menarik, saya tidak tahu bagaimana kamu sudah menemukan tempat sebagus itu.");
  const c = await mk({ WA_TYPO_CHANCE: "0.2" });
  assert.ok(c.sent.length >= 1);
});

await ok("energi harian: masuk ke /humor profil dan prompt; WA_ENERGI_HARIAN=off menetralkan", async () => {
  const on = rig({ env: { WA_ENERGI_HARIAN: "on" } });
  await on.h.load();
  await on.h.handle("balas on keluarga");
  assert.match(await on.h.handle("profil keluarga"), /Suasana hari ini: (kalem|biasa|semangat)/);
  const off = rig();
  await off.h.load();
  await off.h.handle("balas on keluarga");
  assert.match(await off.h.handle("profil keluarga"), /Suasana hari ini: biasa .*\(energi dimatikan\)/);
  // cari tanggal berenergi "kalem" untuk grup ini lalu pastikan petunjuknya masuk prompt
  let t0 = T_NOON;
  for (let i = 0; i < 120; i += 1) {
    const d = new Date(t0 + i * DAY).toLocaleDateString("en-CA", { timeZone: "Asia/Makassar" });
    if (dayEnergy(KEY, d).level === "kalem") {
      t0 += i * DAY;
      break;
    }
  }
  const r = rig({ env: { WA_ENERGI_HARIAN: "on", WA_BALAS_CHANCE: "1" }, t0 });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  say(r, "Budi", "enaknya ngapain ya sore-sore begini sambil nunggu hujan", { rnd: 0 });
  await runLast(r);
  assert.match(r.aiCalls.at(-1).user, /agak kalem/);
});

await ok("/humor ingat on: mencatat cerita sendiri, dipakai di prompt (sesekali), 'ingat apa tentang aku', kedaluwarsa, sensitif tidak dicatat", async () => {
  assert.deepEqual(parseHumorArg("ingat on keluarga"), { kind: "set", flags: ["ingat"], value: true, target: "keluarga", account: null });
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  say(r, "Budi", "aku suka kopi hitam banget");
  assert.equal(JSON.parse(r.st.m.get(STATE_KEY) || "{}").members?.[KEY], undefined, "ingat mati: tidak ada yang dicatat");
  const on = await r.h.handle("ingat on keluarga");
  assert.match(on, /mencatat HAL RINGAN/);
  say(r, "Budi", "aku suka kopi hitam banget");
  say(r, "Budi", "besok aku mau ke pantai sama temen");
  say(r, "Budi", "aku suka judi slot");
  say(r, "Sari", "aku lagi nonton drakor nih");
  await r.h.check();
  const saved = JSON.parse(r.st.m.get(STATE_KEY));
  const budi = Object.values(saved.members[KEY]).find((m) => m.ids.includes("id-Budi"));
  assert.deepEqual(budi.facts.map((f) => f.t), ["aku suka kopi hitam banget", "aku besok ke pantai sama temen"]);
  assert.ok(budi.facts.every((f) => f.auto === true) && budi.facts[1].until > r.now());
  warm(r);
  say(r, "Budi", "enaknya ngapain ya sore-sore begini sambil nunggu hujan", { rnd: 0 });
  await runLast(r);
  const prompt = r.aiCalls.at(-1).user;
  assert.match(prompt, /ceritakan sendiri di grup: aku suka kopi hitam banget; aku besok ke pantai sama temen/);
  assert.match(prompt, /sesekali saja/);
  const show = await r.h.handlePreference("main", JID, { name: "Budi", ids: ["id-Budi"], text: "bot kamu ingat apa tentang aku" });
  assert.match(show.reply, /"aku suka kopi hitam banget" \(kamu cerita sendiri\)/);
  // rencana kedaluwarsa dalam 3 hari, hal suka tetap
  r.tick(4 * DAY);
  say(r, "Rudi", "kita ngobrol soal kegiatan hari minggu nomor 99");
  warm(r);
  say(r, "Budi", "enaknya ngapain ya sore-sore begini sambil nunggu hujan lagi", { rnd: 0 });
  await runLast(r);
  const p2 = r.aiCalls.at(-1).user;
  assert.doesNotMatch(p2, /ke pantai/);
  assert.match(p2, /aku suka kopi hitam banget/);
  assert.match(p2, /baru muncul lagi setelah sekitar 4 hari tidak terlihat ngobrol/, "menyapa orang yang lama tak muncul");
});

await ok("'bot lupakan aku' menghapus dan menghentikan pencatatan otomatis sampai orangnya minta diingat lagi", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("ingat on keluarga");
  say(r, "Budi", "aku suka kopi hitam banget");
  const f = await r.h.handlePreference("main", JID, { name: "Budi", ids: ["id-Budi"], text: "bot lupakan aku" });
  assert.match(f.reply, /tidak akan mencatat lagi/);
  say(r, "Budi", "hobiku mancing di sungai");
  const saved = JSON.parse(r.st.m.get(STATE_KEY));
  assert.equal(saved.members?.[KEY], undefined);
  assert.deepEqual(saved.nolearn[KEY], ["id-Budi"]);
  await r.h.handlePreference("main", JID, { name: "Budi", ids: ["id-Budi"], text: "bot ingat aku suka teh manis" });
  assert.equal(JSON.parse(r.st.m.get(STATE_KEY)).nolearn?.[KEY], undefined, "minta diingat lagi -> pencatatan boleh lagi");
  say(r, "Budi", "hobiku mancing di sungai");
  await r.h.check();
  const m = Object.values(JSON.parse(r.st.m.get(STATE_KEY)).members[KEY])[0];
  assert.deepEqual(m.facts.map((x) => x.t), ["aku suka teh manis", "hobiku mancing di sungai"]);
  assert.equal(m.facts[0].auto, undefined);
});

await ok("reaksi: isi pesan menentukan emoji; tanpa batas harian bawaan; stiker tetap memakai emoji labelnya", async () => {
  const r = rig({ env: { WA_REAKSI_CHANCE: "1", WA_REAKSI_GAP_SEC: "5", WA_BALAS_CHANCE: "0" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  for (let i = 0; i < 4; i += 1) {
    r.tick(MIN);
    say(r, "Sari", `alhamdulillah akhirnya lulus ujian ${i}`, { rnd: 0 });
    if (r.timers.length) await runLast(r);
  }
  assert.deepEqual(r.reacts.map((x) => x.emoji), ["🙏", "🙏", "🙏", "🙏"], "empat reaksi dalam sehari: tidak dibatasi");
  assert.equal(r.sent.length, 0);
});

await ok("terintegrasi: index.js (cooldown 0, kutipan ke orang lain), dokumentasi, .env.example, package.json", () => {
  const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const idx = read("./index.js");
  assert.match(idx, /WA_GROUP_COOLDOWN_SEC \?\? 0\)/);
  assert.match(idx, /quotedOther, quotedText:/);
  const readme = read("./README.md");
  assert.match(readme, /Makin manusiawi \(tahap 2\)/);
  assert.match(readme, /\/humor ingat on/);
  const env = read("./.env.example");
  for (const k of ["WA_ENERGI_HARIAN", "WA_GAYA_ALAMI", "WA_TYPO_CHANCE", "WA_LANJUT_CHANCE", "WA_LANJUT_MENIT", "WA_LANJUT_MAKS", "WA_INGAT_HARI"]) assert.match(env, new RegExp(k));
  assert.match(read("./package.json"), /test-insani\.mjs/);
});

console.log(`\nSemua ${n} kelompok tes makin-manusiawi tahap 2 lulus.`);
