// Tes lapisan "manusiawi" Ayyubi (manusiawi.js + sambungannya di humor.js): gaya grup, kepekaan suasana, reaksi emoji, ritme pesan,
// mode latihan (persetujuan pemilik), pembelajaran dari tanggapan grup, ingatan anggota opt-in, momen khusus, diam sementara.
// Jalankan: node test-manusiawi.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { FEEDBACK_KEY, STATE_KEY, STYLE_KEY, createHumor, parseHumorArg, readHumorConfig } from "./humor.js";
import {
  REACTION_ALLOW, addressedToOther, balasEngagementFactor, describeStyle, detectMood, emptyFeedback, emptyStyle, fewShotNote, isDuoChat, kindWeights, occasionsFor,
  parseBirthday, parseMemoryCmd, parseReactionOutput, pickReaction, pushExample, sanitizeFact, splitBubbles, updateStyle
} from "./manusiawi.js";

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
const T_NOON = Date.UTC(2026, 9, 5, 4, 0); // Senin 5 Okt 2026 12:00 WITA
const JID = "111@g.us";
const KEY = `main|${JID}`;

function rig(over = {}) {
  const st = over.state || mem();
  const sent = [];
  const reacts = [];
  const reviews = [];
  let t = over.t0 ?? T_NOON;
  const timers = [];
  const aiCalls = [];
  let counter = 0;
  let rnd = over.rnd ?? 0.99;
  let seq = [];
  const aiOut = over.aiOut ?? (() => `Menurut kalian hari ini lebih enak ngopi atau ngeteh, versi ke-${(counter += 1)}? ☕`);
  const h = createHumor({
    state: st,
    ai: over.noAi ? null : async (c) => (aiCalls.push(c), typeof aiOut === "function" ? aiOut(c, aiCalls.length) : aiOut),
    send: async (a, jid, text, o) => void sent.push({ a, jid, text, o, at: t }),
    react: over.noReact ? null : async (a, jid, msg, emoji) => void reacts.push({ a, jid, msg, emoji, at: t }),
    review: over.noReview ? null : async (p) => void reviews.push(p),
    sleep: async () => {},
    listGroups: async () => [{ id: JID, subject: "Keluarga Besar", allowed: true }, { id: "222@g.us", subject: "Arisan RT 05", allowed: true }],
    secondEnabled: false,
    timeZone: "Asia/Makassar",
    config: readHumorConfig({ WA_BALAS_CHANCE: "0.5", WA_ENERGI_HARIAN: "off", WA_GAYA_ALAMI: "off", ...(over.env || {}) }),
    now: () => t,
    random: over.random || (() => (seq.length ? seq.shift() : rnd)),
    log: silent,
    timer: (fn, ms) => timers.push({ fn, ms })
  });
  return { h, st, sent, reacts, reviews, timers, aiCalls, setRnd: (v) => void (rnd = v), setSeq: (a) => void (seq = [...a]), tick: (ms) => void (t += ms), setNow: (x) => void (t = x), now: () => t };
}
const say = (r, name, text, extra = {}) => {
  r.tick(extra.gap ?? 20_000);
  const msg = { key: { id: `m-${r.now()}-${name}` }, name, text };
  if (extra.rnd !== undefined) r.setRnd(extra.rnd);
  if (extra.seq) r.setSeq(extra.seq);
  const res = r.h.observe("main", JID, { name, ids: [`id-${name}`], text, msg, ...extra.opts });
  r.setRnd(0.99);
  r.setSeq([]);
  return { res, msg };
};
const NAMES = ["Budi", "Sari", "Rudi"];
const warm = (r, k = 6) => {
  for (let i = 0; i < k; i += 1) say(r, NAMES[i % 3], `kita ngobrol soal kegiatan hari minggu nomor ${i}`);
};
const flush = () => new Promise((x) => setImmediate(x));

// ================================================================ bagian murni
await ok("gaya grup: hanya hitungan (tanpa teks), ringkasan baru muncul setelah ≥ 20 pesan, meluruh bila sangat banyak", () => {
  const s = emptyStyle();
  for (let i = 0; i < 19; i += 1) updateStyle(s, "wkwk iya nih mas 😂");
  assert.equal(describeStyle(s), "", "belum cukup data");
  updateStyle(s, "siap dong kak 🙏 nanti kukabari ya");
  const d = describeStyle(s);
  assert.match(d, /chat biasanya pendek/);
  assert.match(d, /sering pakai emoji \(😂/);
  assert.match(d, /"wkwk"/);
  assert.match(d, /"nih"/);
  assert.match(d, /sapaan umum "mas"/);
  assert.match(d, /nada santai/);
  assert.doesNotMatch(JSON.stringify(s), /kukabari|siap dong/, "teks pesan tidak ikut tersimpan");
  const f = emptyStyle();
  for (let i = 0; i < 30; i += 1) updateStyle(f, "Mohon izin Bapak/Ibu, terima kasih atas perhatiannya selamat pagi");
  assert.match(describeStyle(f), /agak formal/);
  for (let i = 0; i < 450; i += 1) updateStyle(f, "ok");
  assert.ok(f.n <= 400, "peluruhan menjaga angka tetap kecil");
  updateStyle(f, "x".repeat(700));
  assert.ok(f.n <= 400, "pesan sangat panjang (pengumuman) tidak dihitung");
});

await ok("suasana & reaksi: sedih/kesal → diam; tawa/kabar baik/terima kasih/capek/ulang tahun → emoji yang pas; keluaran AI 'REAKSI:' divalidasi", () => {
  const cases = { "aku sedih banget hari ini": "sedih", "kesel deh sama kerjaan": "kesal", "hbd ya Sari!": "ulangtahun", "capek banget lembur lagi": "lelah", "alhamdulillah lulus akhirnya": "senang", "makasih ya semuanya": "terimakasih", "wkwk ngakak parah": "tawa", "bingung nih gimana ya": "bingung", "rapat jam 9 ya": null };
  for (const [text, mood] of Object.entries(cases)) assert.equal(detectMood(text), mood, text);
  assert.equal(pickReaction("tawa"), "😂");
  assert.equal(pickReaction("senang"), "👏");
  assert.equal(pickReaction("terimakasih"), "🙏");
  assert.equal(pickReaction("ulangtahun"), "🎉");
  assert.equal(pickReaction("lelah"), "💪");
  assert.equal(pickReaction("sedih"), null);
  assert.equal(pickReaction("kesal"), null);
  assert.equal(pickReaction(null), null);
  assert.equal(parseReactionOutput("REAKSI: 😂"), "😂");
  assert.equal(parseReactionOutput("reaksi:👍"), "👍");
  assert.equal(parseReactionOutput("REAKSI: ❤"), "❤️", "varian tanpa selektor tetap dikenali");
  assert.equal(parseReactionOutput("REAKSI: 💩"), null, "emoji di luar daftar ditolak");
  assert.equal(parseReactionOutput("aku suka ini"), null);
  assert.ok(REACTION_ALLOW.every((e) => e.length >= 1));
});

await ok("membaca situasi: dua orang ngobrol berdua, pesan ditujukan ke orang lain", () => {
  const H = (name, text) => ({ name, ids: [`id-${name}`], text });
  const duo = [H("Budi", "a"), H("Sari", "b"), H("Budi", "c"), H("Sari", "d"), H("Budi", "e"), H("Sari", "f")];
  assert.equal(isDuoChat(duo, "iya betul"), true);
  assert.equal(isDuoChat(duo, "menurut kalian gimana?"), false, "bertanya ke seluruh grup bukan obrolan berdua");
  assert.equal(isDuoChat([...duo, H("Rudi", "halo")], "iya"), false, "ada pihak ketiga");
  assert.equal(isDuoChat(duo.slice(0, 3), "iya"), false, "terlalu sedikit pesan");
  assert.equal(addressedToOther("Budi, udah makan belum?", ["Budi Santoso", "Sari"]), true);
  assert.equal(addressedToOther("mas Budi tolong cek ya", ["Budi"]), true);
  assert.equal(addressedToOther("kalau Budi mau ikut silakan", ["Budi"]), false, "nama di tengah kalimat bukan sapaan");
  assert.equal(addressedToOther("halo semuanya apa kabar", ["Budi"]), false);
});

await ok("ritme: dua baris = dua gelembung; teks panjang kadang dipecah di batas kalimat; pendek tetap satu", () => {
  assert.deepEqual(splitBubbles("Wah seru tuh!\nKapan berangkatnya?"), ["Wah seru tuh!", "Kapan berangkatnya?"]);
  assert.deepEqual(splitBubbles("Iya betul banget 😄"), ["Iya betul banget 😄"]);
  const long = "Aku setuju sekali dengan rencana akhir pekan itu, kayaknya seru banget buat semuanya. Nanti kalau sudah fix, kabari ya supaya yang lain bisa menyesuaikan jadwal masing-masing.";
  const two = splitBubbles(long, { random: () => 0 });
  assert.equal(two.length, 2);
  assert.equal(two.join(" "), long);
  assert.deepEqual(splitBubbles(long, { random: () => 0.9 }), [long], "peluang tidak lolos: tetap satu");
});

await ok("momen: hari khusus tetap, tambahan dari pemilik, ritme pekan & bulan", () => {
  assert.deepEqual(occasionsFor({ day: "2026-10-28", weekday: "Rabu" }), ["Hari Sumpah Pemuda", "akhir bulan"]);
  assert.ok(occasionsFor({ day: "2026-10-02", weekday: "Jumat" }).includes("Hari Batik Nasional"));
  assert.ok(occasionsFor({ day: "2026-10-02", weekday: "Jumat" }).includes("hari Jumat, menjelang akhir pekan"));
  assert.ok(occasionsFor({ day: "2026-03-19", weekday: "Kamis" }, "03-19=Hari Raya Nyepi; 12-01=Lain").includes("Hari Raya Nyepi"));
  assert.ok(!occasionsFor({ day: "2026-03-20", weekday: "Jumat" }, "03-19=Hari Raya Nyepi").includes("Hari Raya Nyepi"));
  assert.ok(occasionsFor({ day: "2026-10-05", weekday: "Senin" }).includes("awal pekan (Senin)"));
});

await ok("ingatan anggota: perintah, penyaring data sensitif, ulang tahun tanpa tahun lahir", () => {
  assert.deepEqual(parseMemoryCmd("bot ingat aku suka kopi hitam"), { cmd: "remember", fact: "aku suka kopi hitam" });
  assert.equal(parseMemoryCmd("ayyubi, tolong ingat ya bahwa saya lagi belajar gitar!").cmd, "remember");
  assert.deepEqual(parseMemoryCmd("bot panggil aku Mas Bro"), { cmd: "nick", nick: "Mas Bro" });
  assert.equal(parseMemoryCmd("bot kamu ingat apa tentang aku?").cmd, "show");
  assert.equal(parseMemoryCmd("bot lupakan aku").cmd, "forget");
  assert.equal(parseMemoryCmd("bot hapus ingatanmu tentang aku").cmd, "forget");
  assert.equal(parseMemoryCmd("bot jangan roasting aku"), null);
  assert.equal(parseMemoryCmd("bot jangan balas chatku"), null);
  assert.equal(parseMemoryCmd("tolong ingat rapat jam 9"), null, "tanpa memanggil bot");
  assert.equal(sanitizeFact("aku suka kopi hitam").ok, true);
  for (const bad of ["aku punya diabetes", "gajiku 12 juta", "aku pilih partai X", "anakku sakit", "nomor rekeningku 12345678", "alamat rumahku di jalan mawar", "Budi itu suka kopi"]) assert.equal(sanitizeFact(bad).ok, false, bad);
  assert.deepEqual(parseBirthday("ulang tahunku 12 Oktober"), { d: 12, m: 10 });
  assert.deepEqual(parseBirthday("ultah saya tanggal 3 agustus ya"), { d: 3, m: 8 });
  assert.equal(parseBirthday("ulang tahunku 31 februari lah"), null, "tanggal yang tidak ada di kalender ditolak");
  assert.equal(parseBirthday("aku suka kopi"), null);
});

await ok("pembelajaran: bobot jenis pesan dari tanggapan grup, faktor balasan, contoh disukai/ditolak", () => {
  const fb = emptyFeedback();
  fb.kinds["sapa:tanya"] = { sent: 10, eng: 8 };
  fb.kinds["sapa:fakta"] = { sent: 10, eng: 0 };
  const w = kindWeights(fb, ["sapa:tanya", "sapa:fakta", "sapa:receh"]);
  assert.ok(w["sapa:tanya"] > w["sapa:receh"] && w["sapa:receh"] > w["sapa:fakta"], JSON.stringify(w));
  assert.ok(w["sapa:fakta"] >= 0.15, "tidak pernah benar-benar dimatikan");
  assert.equal(balasEngagementFactor(emptyFeedback()), 1);
  assert.equal(balasEngagementFactor({ kinds: { balas: { sent: 10, eng: 0 } } }), 1, "kurang dari 15: belum dihitung");
  assert.equal(balasEngagementFactor({ kinds: { balas: { sent: 20, eng: 0 } } }), 0.5);
  assert.equal(balasEngagementFactor({ kinds: { balas: { sent: 20, eng: 20 } } }), 1.5);
  const g = [];
  for (let i = 0; i < 14; i += 1) pushExample(g, `contoh ${i}`);
  assert.equal(g.length, 10);
  pushExample(g, "contoh 5");
  assert.equal(g[0], "contoh 5");
  assert.equal(g.filter((x) => x === "contoh 5").length, 1, "tidak ganda");
  assert.match(fewShotNote({ good: ["a b c"], bad: ["x y z"] }), /DISUKAI[\s\S]*"a b c"[\s\S]*DITOLAK[\s\S]*"x y z"/);
  assert.equal(fewShotNote(emptyFeedback()), "");
});

await ok("perintah /humor baru: latihan, diam, lanjut, profil", () => {
  assert.deepEqual(parseHumorArg("latihan on keluarga"), { kind: "set", flags: ["latihan"], value: true, target: "keluarga", account: null });
  assert.equal(parseHumorArg("on 2").flags.includes("latihan"), false, "on tidak otomatis menyalakan mode latihan");
  assert.deepEqual(parseHumorArg("diam 3 keluarga besar"), { kind: "mute", hours: 3, target: "keluarga besar", account: null });
  assert.equal(parseHumorArg("diam semua").kind, "error");
  assert.equal(parseHumorArg("diam 2 semua").target, "*");
  assert.equal(parseHumorArg("diam 999 2").kind, "error", "maksimal 168 jam");
  assert.deepEqual(parseHumorArg("lanjut 2"), { kind: "unmute", target: "2", account: null });
  assert.deepEqual(parseHumorArg("profil keluarga"), { kind: "profile", target: "keluarga", account: null });
});

// ================================================================ terpadu di createHumor
await ok("reaksi emoji: pesan lucu/kabar baik/terima kasih diberi reaksi (bukan teks); sedih tidak; jeda & jatah harian dihormati", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r, 3);
  const x = say(r, "Budi", "wkwk ngakak parah liat video tadi", { seq: [0.99, 0.01, 0.5] });
  assert.equal(x.res.kind, "reaksi", JSON.stringify(x.res));
  assert.equal(r.reacts.length, 0, "belum terkirim sebelum jeda");
  assert.ok(r.timers.at(-1).ms >= 2000 && r.timers.at(-1).ms <= 9000);
  await r.timers.at(-1).fn();
  assert.equal(r.reacts.length, 1);
  assert.equal(r.reacts[0].emoji, "😂");
  assert.equal(r.reacts[0].msg, x.msg, "reaksi menempel di pesan orangnya");
  assert.equal(r.sent.length, 0, "tidak ada teks");
  // jeda 45 detik
  r.tick(10_000);
  assert.equal(say(r, "Sari", "hahaha iya lucu banget", { seq: [0.99, 0.01, 0.5], gap: 1000 }).res?.kind, undefined, "masih dalam jeda reaksi");
  // terima kasih -> 🙏
  r.tick(2 * MIN);
  say(r, "Sari", "makasih ya udah bantuin", { seq: [0.99, 0.01, 0.5] });
  await r.timers.at(-1).fn();
  assert.equal(r.reacts.at(-1).emoji, "🙏");
  // sedih: diam, dan sesudahnya pun tidak ada reaksi "ceria"
  r.tick(2 * MIN);
  assert.equal(say(r, "Rudi", "aku sedih banget hari ini", { seq: [0.01, 0.01, 0.5] }).res?.kind, undefined);
  r.tick(2 * MIN);
  assert.equal(say(r, "Sari", "makasih ya udah dengerin", { seq: [0.01, 0.01, 0.5] }).res?.kind, undefined);
  assert.equal(r.reacts.length, 2);
  // jatah harian
  const r2 = rig({ env: { WA_REAKSI_MAX_PER_DAY: "1", WA_REAKSI_GAP_SEC: "5" } });
  await r2.h.load();
  await r2.h.handle("balas on keluarga");
  warm(r2, 3);
  say(r2, "Budi", "wkwk ngakak parah liat video tadi", { seq: [0.99, 0.01, 0.5] });
  await r2.timers.at(-1).fn();
  r2.tick(MIN);
  assert.equal(say(r2, "Sari", "hahaha iya lucu banget", { seq: [0.99, 0.01, 0.5] }).res?.kind, undefined, "jatah reaksi habis");
  // tanpa react (sambungan tidak ada) -> tidak error
  const r3 = rig({ noReact: true });
  await r3.h.load();
  await r3.h.handle("balas on keluarga");
  warm(r3, 3);
  assert.equal(say(r3, "Budi", "wkwk ngakak parah", { seq: [0.99, 0.01, 0.5] }).res?.kind, undefined);
});

await ok("AI boleh memilih 'REAKSI: emoji' sebagai balasan; dua baris dari AI dikirim sebagai dua gelembung (yang pertama me-reply)", async () => {
  let r = rig({ aiOut: "REAKSI: 🔥" });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  let x = say(r, "Budi", "tadi aku berhasil memasak nasi goreng enak sebelum jam siang", { rnd: 0 });
  assert.equal(x.res.ok, true, JSON.stringify(x.res));
  await r.timers.at(-1).fn();
  assert.equal(r.sent.length, 0);
  assert.deepEqual(r.reacts.map((e) => e.emoji), ["🔥"]);
  assert.match(r.aiCalls.at(-1).system, /REAKSI/);
  // dua baris
  r = rig({ aiOut: "Wah mantap, selamat ya!\nBesok traktir kopi dong 😄" });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  x = say(r, "Budi", "tadi aku berhasil memasak nasi goreng enak sebelum jam siang", { rnd: 0 });
  await r.timers.at(-1).fn();
  assert.equal(r.sent.length, 2);
  assert.equal(r.sent[0].o.quoted, x.msg);
  assert.equal(r.sent[1].o.quoted, undefined, "gelembung kedua tidak me-reply lagi");
  assert.equal(r.sent[0].text, "Wah mantap, selamat ya!");
  assert.equal(r.sent[1].text, "Besok traktir kopi dong 😄");
  // tanpa kemampuan react, prompt tidak menawarkan REAKSI
  const r2 = rig({ noReact: true });
  await r2.h.load();
  await r2.h.handle("balas on keluarga");
  warm(r2);
  say(r2, "Budi", "tadi aku berhasil memasak nasi goreng enak sebelum jam siang", { rnd: 0 });
  await r2.timers.at(-1).fn();
  assert.doesNotMatch(r2.aiCalls.at(-1).system, /REAKSI: <satu emoji/);
});

await ok("kepekaan: sedih/kesal → bot diam; ditujukan ke orang lain → diam; obrolan berdua → peluang turun; capek → catatan empati ke AI", async () => {
  let r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  assert.match(say(r, "Budi", "aku lagi sedih banget nih hari ini", { rnd: 0 }).res.reason, /serius|sedih\/kesal/);
  r.tick(5 * MIN);
  assert.match(say(r, "Sari", "yang sabar ya, semoga lekas membaik", { rnd: 0 }).res.reason, /serius|sedih\/kesal/, "pesan sesudahnya pun tidak disela");
  // suasana kesal yang tidak ada di daftar "serius" lama tetap membuat bot diam (lapisan kepekaan baru)
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  assert.equal(say(r, "Budi", "bete banget deh sama macetnya hari ini", { rnd: 0 }).res.reason, "suasana sedih/kesal: bot memilih diam");
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  assert.equal(say(r, "Sari", "Budi, kamu udah makan siang belum hari ini?", { rnd: 0 }).res.reason, "pesan ditujukan ke orang lain");
  // obrolan berdua: peluang 0.5*0.35 ≈ 0.18 → rnd 0.3 gagal, tapi pada obrolan ramai (peluang 0.5) lolos
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  for (let i = 0; i < 6; i += 1) say(r, i % 2 ? "Sari" : "Budi", `lanjut ngobrolin rencana liburan nomor ${i} ya`);
  assert.equal(say(r, "Sari", "iya betul juga sih menurutku", { rnd: 0.3 }).res.reason, "dua orang sedang ngobrol berdua");
  r.tick(5 * MIN);
  assert.equal(say(r, "Rudi", "gimana kalau kita pesan makanan dulu", { rnd: 0.3 }).res.ok, true, "orang ketiga bergabung: peluang normal");
  // capek -> catatan empati
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  warm(r);
  say(r, "Budi", "capek banget hari ini lembur sampai malam terus", { rnd: 0 });
  await r.timers.at(-1).fn();
  assert.match(r.aiCalls.at(-1).user, /Catatan suasana: .*capek\/lelah.*empati/);
});

await ok("gaya grup dipelajari dari obrolan lalu dipakai di prompt; tersimpan antar-restart (hanya angka)", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  for (let i = 0; i < 24; i += 1) say(r, NAMES[i % 3], `wkwk iya nih mas, rahasia keluarga nomor ${i} 😂`);
  await r.h.check();
  const saved = r.st.m.get(STYLE_KEY);
  assert.ok(saved, "gaya tersimpan");
  assert.doesNotMatch(saved, /rahasia keluarga/, "isi chat tidak ikut tersimpan");
  r.tick(10 * MIN);
  say(r, "Budi", "kalian suka kopi atau teh sih sebenarnya?", { rnd: 0 });
  await r.timers.at(-1).fn();
  assert.match(r.aiCalls.at(-1).system, /Gaya grup ini[\s\S]*sering pakai emoji \(😂\)[\s\S]*"wkwk"/);
  const r2 = rig({ state: r.st });
  await r2.h.load();
  assert.equal(r2.h._debug.styles()[KEY].n >= 24, true, "terbaca lagi setelah restart");
});

await ok("mode latihan: draf dikirim ke pemilik (bukan grup); ✅ mengirim & jadi contoh disukai; ❌ membuang & jadi contoh ditolak; contoh dipakai di prompt", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  assert.match(await r.h.handle("latihan on keluarga"), /Mode latihan: draf .* Telegram/);
  warm(r);
  const x = say(r, "Budi", "kalian suka kopi atau teh sih sebenarnya?", { rnd: 0 });
  await r.timers.at(-1).fn();
  assert.equal(r.sent.length, 0, "tidak ada yang masuk grup");
  assert.equal(r.reviews.length, 1);
  const p = r.reviews[0];
  assert.equal(p.kind, "balas");
  assert.equal(p.group, "Keluarga Besar");
  assert.equal(p.targetName, "Budi");
  assert.match(p.text, /ngopi atau ngeteh/);
  // ✅
  assert.match(await r.h.decide(`ok:${p.id}`), /Terkirim ke grup/);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].o.quoted, x.msg, "tetap me-reply pesan aslinya");
  assert.equal(r.h._debug.feedbacks()[KEY].good.length, 1);
  assert.match(await r.h.decide(`ok:${p.id}`), /kedaluwarsa|sudah diproses/, "tidak bisa dua kali");
  // ❌ pada draf berikutnya
  r.tick(10 * MIN);
  say(r, "Sari", "ada yang tahu tempat servis laptop yang bagus?", { rnd: 0 });
  await r.timers.at(-1).fn();
  assert.equal(r.reviews.length, 2);
  assert.match(await r.h.decide(`no:${r.reviews[1].id}`), /Dibuang/);
  assert.equal(r.sent.length, 1, "yang dibuang tidak terkirim");
  assert.equal(r.h._debug.feedbacks()[KEY].bad.length, 1);
  // contoh dipakai di prompt berikutnya
  r.tick(10 * MIN);
  say(r, "Rudi", "kalian pilih nasi goreng atau mie goreng buat makan malam?", { rnd: 0 });
  await r.timers.at(-1).fn();
  assert.match(r.aiCalls.at(-1).system, /DISUKAI pemilik[\s\S]*DITOLAK pemilik/);
  // tersimpan
  await r.h.check();
  assert.match(r.st.m.get(FEEDBACK_KEY), /good/);
  // kedaluwarsa
  r.tick(10 * MIN);
  say(r, "Budi", "kalian suka makan bakso atau soto sebenarnya?", { rnd: 0 });
  await r.timers.at(-1).fn();
  const pid = r.reviews.at(-1).id;
  r.tick(50 * MIN);
  assert.match(await r.h.decide(`ok:${pid}`), /kedaluwarsa/);
  // tes manual lewat langsung (tidak lewat tinjauan)
  const before = r.sent.length;
  await r.h.handle("tes sapa keluarga");
  assert.equal(r.sent.length, before + 1, "/humor tes selalu kirim langsung");
  // latihan dimatikan -> kirim langsung lagi
  await r.h.handle("latihan off keluarga");
  const nrev = r.reviews.length;
  r.tick(10 * MIN);
  say(r, "Sari", "kalian lebih suka hujan atau panas sih sebenarnya?", { rnd: 0 });
  await r.timers.at(-1).fn();
  assert.equal(r.reviews.length, nrev, "tidak ada draf baru");
  assert.ok(r.sent.length >= before + 2);
});

await ok("mode latihan: chat otomatis (sapa) juga lewat tinjauan; tanpa jalur tinjauan, tidak ada yang bocor ke grup", async () => {
  const r = rig({ t0: Date.UTC(2026, 9, 5, 16, 0), random: () => 0.5 });
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  await r.h.handle("latihan on keluarga");
  await r.h.check();
  const plan = () => JSON.parse(r.st.m.get("wa_group_humor_sched")).sapa[KEY];
  r.setNow(plan().nextAt + MIN);
  await r.h.check();
  assert.equal(r.sent.length, 0);
  assert.equal(r.reviews.length, 1);
  assert.equal(r.reviews[0].kind.startsWith("sapa:"), true);
  assert.equal(plan().count, 1, "jadwal tetap berjalan");
  // pemilik tidak punya jalur tinjauan -> pesan tidak dikirim ke grup
  const r2 = rig({ t0: Date.UTC(2026, 9, 5, 16, 0), random: () => 0.5, noReview: true });
  await r2.h.load();
  await r2.h.handle("sapa on keluarga");
  await r2.h.handle("latihan on keluarga");
  await r2.h.check();
  r2.setNow(JSON.parse(r2.st.m.get("wa_group_humor_sched")).sapa[KEY].nextAt + MIN);
  await r2.h.check();
  assert.equal(r2.sent.length, 1, "tanpa jalur tinjauan bot mengirim langsung (peringatan sudah ditampilkan saat /humor latihan on)");
  assert.match(await r2.h.handle("latihan on keluarga"), /belum tersedia/);
});

await ok("belajar dari tanggapan grup: balasan/chat yang ditanggapi menaikkan bobot jenisnya; tersimpan; tampil di /humor profil", async () => {
  const r = rig({ t0: Date.UTC(2026, 9, 5, 16, 0), random: () => 0.5, aiOut: (c, i) => `Pertanyaan iseng nomor ${i}: lebih suka hujan atau panas?` });
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  await r.h.handle("balas on keluarga");
  await r.h.check();
  const plan = () => JSON.parse(r.st.m.get("wa_group_humor_sched")).sapa[KEY];
  r.setNow(plan().nextAt + MIN);
  await r.h.check();
  assert.equal(r.sent.length, 1);
  const kind = r.h._debug.lastBot.get(KEY).kind;
  assert.match(kind, /^sapa:/);
  // anggota membalas langsung ke bot dalam 2 menit
  r.tick(30_000);
  r.h.observe("main", JID, { name: "Budi", ids: ["id-Budi"], text: "hujan dong, enak buat rebahan", msg: {}, repliedToBot: true });
  const k = r.h._debug.feedbacks()[KEY].kinds[kind];
  assert.deepEqual([k.sent, k.eng], [1, 1], "balasan langsung ke bot = 1");
  // pesan berikutnya tidak dihitung dua kali
  r.h.observe("main", JID, { name: "Sari", ids: ["id-Sari"], text: "aku juga hujan sih", msg: {} });
  assert.equal(r.h._debug.feedbacks()[KEY].kinds[kind].eng, 1);
  // tidak ada tanggapan -> tidak dihitung
  r.tick(30 * MIN);
  const before = r.h._debug.feedbacks()[KEY].kinds[kind].eng;
  r.h._debug.lastBot.set(KEY, { ts: r.now() - 10 * MIN, kind, counted: false });
  r.h.observe("main", JID, { name: "Rudi", ids: ["id-Rudi"], text: "baru lihat nih tadi", msg: {} });
  assert.equal(r.h._debug.feedbacks()[KEY].kinds[kind].eng, before, "tanggapan terlambat (>2 menit, bukan reply) tidak dihitung");
  await r.h.check();
  assert.match(r.st.m.get(FEEDBACK_KEY), /"eng":1/);
  const prof = await r.h.handle("profil keluarga");
  assert.match(prof, /Profil belajar Ayyubi/);
  assert.match(prof, /Tanggapan grup per jenis pesan/);
  assert.match(prof, new RegExp(`${kind.replace(":", ":")}: 1 terkirim, 100% ditanggapi`));
});

await ok("ingatan anggota (opt-in): disimpan atas permintaan, dipakai di prompt, panggilan, hal sensitif ditolak, bisa dilihat & dihapus", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  const pref = (text, name = "Budi") => r.h.handlePreference("main", JID, { name, ids: [`id-${name}`], text });
  assert.match((await pref("bot ingat aku suka kopi hitam")).reply, /kuingat: "aku suka kopi hitam"/);
  assert.match((await pref("bot ingat gajiku 12 juta")).reply, /tidak kusimpan/);
  assert.match((await pref("bot ingat aku punya diabetes")).reply, /tidak kusimpan/);
  assert.match((await pref("bot panggil aku Bro Budi")).reply, /kupanggil kamu Bro Budi/);
  assert.match((await pref("bot kamu ingat apa tentang aku")).reply, /panggilanmu "Bro Budi".*aku suka kopi hitam/);
  assert.match((await pref("bot ingat ulang tahunku 6 Oktober")).reply, /ulang tahunmu 6\/10 kucatat/);
  assert.equal((await r.h.handlePreference("main", JID, { name: "Sari", ids: ["id-Sari"], text: "bot kamu ingat apa tentang aku" })).reply.includes("belum ada yang kuingat"), true, "ingatan per orang");
  // tersimpan di bot_state (hanya yang diminta), tanpa chat lain
  const saved = JSON.parse(r.st.m.get(STATE_KEY));
  assert.equal(Object.values(saved.members[KEY])[0].facts[0].t, "aku suka kopi hitam");
  // dipakai di prompt balasan
  warm(r);
  say(r, "Budi", "enaknya ngapain ya sore-sore begini sambil nunggu hujan", { rnd: 0 });
  await r.timers.at(-1).fn();
  const prompt = r.aiCalls.at(-1).user;
  assert.match(prompt, /Pesan yang dibalas -- Bro Budi:/);
  assert.match(prompt, /Yang kamu ingat tentang orang ini[\s\S]*minta kamu ingat: aku suka kopi hitam/);
  // orang lain tidak membawa ingatan Budi
  r.tick(10 * MIN);
  say(r, "Sari", "aku juga bingung mau ngapain sore ini nih", { rnd: 0 });
  await r.timers.at(-1).fn();
  assert.doesNotMatch(r.aiCalls.at(-1).user, /kopi hitam/);
  // lupakan
  assert.match((await pref("bot lupakan aku")).reply, /sudah kuhapus/);
  assert.equal(JSON.parse(r.st.m.get(STATE_KEY)).members[KEY], undefined);
  assert.match((await pref("bot kamu ingat apa tentang aku")).reply, /belum ada yang kuingat/);
  // tidak aktif di grup yang humornya mati
  assert.equal(await r.h.handlePreference("main", "222@g.us", { name: "Budi", ids: ["id-Budi"], text: "bot ingat aku suka kopi" }), null);
});

await ok("ulang tahun (opt-in): ucapan sekali setahun mulai pukul 06:00, tidak sebelum itu, tidak berulang", async () => {
  const bd = Date.UTC(2026, 9, 5, 22, 0); // 06 Okt 06:00 WITA (Selasa)
  const r = rig({ t0: bd - 3 * 3_600_000, random: () => 0.5 }); // 03:00 WITA
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  await r.h.handlePreference("main", JID, { name: "Budi Santoso", ids: ["id-Budi"], text: "bot ingat ulang tahunku 6 Oktober" });
  await r.h.check();
  assert.equal(r.sent.length, 0, "03:00: belum waktunya");
  r.setNow(bd + 5 * MIN);
  await r.h.check();
  const greet = r.sent.filter((s) => /ulang tahun|ultah|🎂/i.test(s.text));
  assert.equal(greet.length >= 1, true, JSON.stringify(r.sent.map((s) => s.text)));
  assert.match(r.sent[0].text, /Budi/);
  const total = r.sent.length;
  r.tick(5 * MIN);
  await r.h.check();
  assert.equal(r.sent.filter((s) => /ulang tahun|🎂/i.test(s.text)).length, greet.length, "tidak diulang pada hari yang sama");
  assert.equal(JSON.parse(r.st.m.get(STATE_KEY)).members[KEY]["id-Budi"].bdayYear, 2026);
  void total;
});

await ok("momen hari ini ikut jadi bahan chat otomatis; ingatan anggota bisa jadi bahan 'sapa' yang personal", async () => {
  const r = rig({ t0: Date.UTC(2026, 9, 28, 1, 0), random: () => 0.5 }); // 28 Okt 09:00 WITA (Rabu, Sumpah Pemuda)
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  await r.h.handlePreference("main", JID, { name: "Budi", ids: ["id-Budi"], text: "bot ingat aku suka kopi hitam" });
  await r.h.check();
  const plan = () => JSON.parse(r.st.m.get("wa_group_humor_sched")).sapa[KEY];
  r.setNow(plan().nextAt + MIN);
  await r.h.check();
  assert.match(r.aiCalls.at(-1).user, /Momen hari ini: Hari Sumpah Pemuda/);
  // cadangan: pemilik menambah hari khusus lokal
  const r2 = rig({ t0: Date.UTC(2026, 2, 19, 1, 0), env: { WA_HARI_KHUSUS: "03-19=Hari Raya Nyepi" }, random: () => 0.5 });
  await r2.h.load();
  await r2.h.handle("sapa on keluarga");
  await r2.h.check();
  r2.setNow(JSON.parse(r2.st.m.get("wa_group_humor_sched")).sapa[KEY].nextAt + MIN);
  await r2.h.check();
  assert.match(r2.aiCalls.at(-1).user, /Hari Raya Nyepi/);
});

await ok("diam sementara: tidak bicara sendiri / tidak membalas acak / tidak pantun selama diam; lanjut atau habis waktu → kembali normal", async () => {
  const r = rig({ t0: Date.UTC(2026, 9, 5, 16, 0), random: () => 0.5 });
  await r.h.load();
  await r.h.handle("on keluarga");
  assert.match(await r.h.handle("diam 3 keluarga"), /Ayyubi diam .* 3 jam/);
  await r.h.check();
  const plan = () => JSON.parse(r.st.m.get("wa_group_humor_sched")).sapa?.[KEY];
  r.tick(2 * 3_600_000);
  await r.h.check();
  assert.equal(r.sent.length, 0, "2 jam: masih diam");
  warm(r);
  assert.equal(say(r, "Budi", "kalian suka kopi atau teh sih sebenarnya?", { rnd: 0 }).res.reason, "sedang didiamkan pemilik");
  assert.match(await r.h.handle(""), /🤫 diam sampai/);
  r.tick(2 * 3_600_000);
  await r.h.check();
  assert.ok(plan(), "setelah 3 jam jadwal berjalan lagi");
  assert.match(await r.h.handle("lanjut keluarga"), /boleh bicara lagi/);
  assert.equal(r.h._debug.data().groups[KEY].muteUntil, undefined);
  assert.match(await r.h.handle("diam 1 arisan"), /Tidak ada grup yang humornya menyala/);
});

await ok("privasi: bot_state hanya memuat pengaturan, jadwal, hitungan gaya, contoh pesan BOT, dan ingatan yang diminta anggota", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("sapa on keluarga");
  await r.h.handle("latihan on keluarga");
  for (let i = 0; i < 30; i += 1) say(r, NAMES[i % 3], `isi obrolan pribadi nomor ${i} yang tidak boleh bocor`);
  say(r, "Budi", "kalian suka kopi atau teh sih sebenarnya?", { rnd: 0 });
  await r.timers.at(-1).fn();
  await r.h.decide(`ok:${r.reviews[0].id}`);
  await r.h.check();
  assert.doesNotMatch(JSON.stringify([...r.st.m.entries()]), /obrolan pribadi|tidak boleh bocor/);
  assert.equal(r.h._debug.ctxBuf.get(KEY).length <= 23, true);
  assert.doesNotMatch(r.st.m.get(FEEDBACK_KEY), /kopi atau teh sih sebenarnya\?/, "teks anggota tidak masuk umpan balik (hanya balasan bot)");
});

await ok("terintegrasi: index.js, telegram.js (tombol hr:), dokumentasi, .env.example, package.json", () => {
  const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const idx = read("./index.js");
  const tg = read("./telegram.js");
  assert.match(idx, /react: reactHumorGroup/);
  assert.match(idx, /review: reviewHumorDraft/);
  assert.match(idx, /react: \{ text: emoji, key: msg\.key \}/);
  assert.match(idx, /callback_data: `hr:ok:\$\{id\}`/);
  assert.match(idx, /humorReview: \{ decide: \(arg\) => humor\.decide\(arg\) \}/);
  assert.match(idx, /repliedToBot: repliedToOwn/);
  assert.match(tg, /data\.startsWith\("hr:"\)/);
  assert.match(tg, /async function sendOwner\(text, \{ markup = null \} = \{\}\)/);
  assert.match(read("./README.md"), /Ayyubi lebih manusiawi/);
  assert.match(read("./.env.example"), /WA_REAKSI_CHANCE/);
  assert.match(read("./.env.example"), /WA_HARI_KHUSUS/);
  assert.match(read("./.env.example"), /WA_PERSONA_NOTE/);
  assert.match(read("./package.json"), /test-manusiawi\.mjs/);
  void flush;
});

console.log(`\nSemua ${n} kelompok tes manusiawi lulus.`);
