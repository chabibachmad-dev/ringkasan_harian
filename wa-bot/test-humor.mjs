// Tes mode humor grup (humor.js): pantun harian acak, roasting aman, penolakan, perintah /humor. Jalankan: node test-humor.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  FALLBACK_PANTUN, HUMOR_CHAT_NOTE, SCHED_KEY, STATE_KEY, buildPantunPrompt, buildRoastPrompt, cleanPantunLines, createHumor, detectRoastPref, endSound,
  hasBannedWord, hasCasualCue, isSeriousChat, localParts, parseHumorArg, parseWindow, pickPantunMinute, readHumorConfig, validatePantun, validateRoast
} from "./humor.js";

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

await ok("konfigurasi dari .env + batas wajar", () => {
  const d = readHumorConfig({});
  assert.deepEqual(d.pantunWindow, { from: 480, to: 1200 });
  assert.equal(d.roastMaxPerDay, 5);
  assert.equal(d.roastOwner, false);
  const c = readHumorConfig({ WA_HUMOR_PANTUN_WINDOW: "09:30-11:00", WA_HUMOR_ROAST_MAX_PER_DAY: "2", WA_HUMOR_ROAST_CHANCE: "5", WA_HUMOR_ROAST_OWNER: "true", WA_HUMOR_ROAST_COOLDOWN_MIN: "10" });
  assert.deepEqual(c.pantunWindow, { from: 570, to: 660 });
  assert.equal(c.roastMaxPerDay, 2);
  assert.equal(c.roastChance, 1, "dibatasi 0-1");
  assert.equal(c.roastOwner, true);
  assert.equal(c.roastCooldownMs, 600_000);
  assert.deepEqual(parseWindow("20:00-08:00", null), null, "rentang terbalik ditolak");
  assert.deepEqual(parseWindow("10:00-10:10", null), null, "rentang < 30 menit ditolak");
  assert.deepEqual(parseWindow("25:00-26:00", null), null);
  assert.deepEqual(readHumorConfig({ WA_HUMOR_PANTUN_WINDOW: "ngawur" }).pantunWindow, { from: 480, to: 1200 });
});

await ok("waktu setempat & pemilihan jam pantun acak", () => {
  // 2026-10-04 06:30 UTC = 14:30 WITA (Minggu)
  const lp = localParts(Date.UTC(2026, 9, 4, 6, 30), "Asia/Makassar");
  assert.equal(lp.day, "2026-10-04");
  assert.equal(lp.minutes, 14 * 60 + 30);
  assert.equal(lp.weekday, "Minggu");
  // lewat tengah malam lokal
  assert.equal(localParts(Date.UTC(2026, 9, 4, 16, 30), "Asia/Makassar").day, "2026-10-05");
  const win = { from: 480, to: 1200 };
  assert.equal(pickPantunMinute(win, 0, () => 0), 480, "pagi buta: mulai dari awal rentang");
  assert.equal(pickPantunMinute(win, 0, () => 0.999999) < 1200, true);
  assert.equal(pickPantunMinute(win, 600, () => 0), 605, "tidak kurang dari 5 menit lagi");
  assert.equal(pickPantunMinute(win, 1199, () => 0), null, "sudah mepet akhir rentang");
  assert.equal(pickPantunMinute(win, 1300, () => 0), null);
  // acak benar-benar menyebar
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) seen.add(pickPantunMinute(win, 0));
  assert.ok(seen.size > 20);
});

await ok("validasi pantun: 4 baris, rima a-b-a-b, aman", () => {
  assert.equal(endSound("Buah duku buah manggis,"), "is");
  assert.equal(endSound("Kerja terus jangan menangis"), "is");
  assert.equal(endSound("Dimakan enak waktu siang."), "ang");
  for (const p of FALLBACK_PANTUN) assert.equal(validatePantun(p).ok, true, p);
  assert.equal(validatePantun("satu\ndua\ntiga").ok, false);
  assert.match(validatePantun("Buah duku buah manggis\nDimakan enak waktu siang\nKerja terus jangan menangis\nSebentar lagi sampai rumah mama").reason, /rima/);
  const wrapped = "Berikut pantunnya:\n1. Buah duku buah manggis,\n2. Dimakan enak waktu siang.\n3. Kerja terus jangan menangis,\n4. Sebentar lagi waktunya pulang.\n";
  assert.equal(validatePantun(wrapped).ok, true, "awalan, nomor dibuang");
  assert.deepEqual(cleanPantunLines('"Baris satu"\n**Baris dua**').length, 2);
  const kasar = "Buah duku buah manggis,\nDimakan enak waktu siang.\nDasar kamu itu tolol manggis,\nSebentar lagi waktunya pulang.";
  assert.match(validatePantun(kasar).reason, /terlarang/);
  assert.equal(validatePantun("Lihat di https://x.id sekarang juga,\nDimakan enak waktu siang.\nKerja terus jangan menangis,\nSebentar lagi waktunya pulang.").ok, false);
  const { system, user } = buildPantunPrompt({ theme: "kopi", weekday: "Senin", part: "pagi", avoid: ["Baris A\nBaris B"] });
  assert.match(system, /TANPA SARA/);
  assert.match(user, /kopi/);
  assert.match(user, /Baris A/);
});

await ok("penyaring kata: kasar/politik selalu, fisik/agama/suku/keluarga/uang/kesehatan khusus roast", () => {
  assert.equal(hasBannedWord("kamu tolol banget"), true);
  assert.equal(hasBannedWord("pilpres tahun depan"), true);
  assert.equal(hasBannedWord("kopi pagi bikin semangat"), false);
  assert.equal(hasBannedWord("Budi badannya gendut", { roast: false }), false, "pantun biasa tidak seketat roast");
  for (const bad of ["Budi gendut banget", "Sari digendutin kopi", "Rudi pelit amat", "Tono lagi sakit ya", "Dewi jomblo terus", "Eko kayak orang Jawa", "ibumu pasti bangga", "Ani lupa agama", "gajimu kecil"]) {
    assert.equal(hasBannedWord(bad, { roast: true }), true, bad);
  }
  for (const good of ["Budi balasnya lama banget, sinyalnya lagi liburan ya 😄", "Sari ketawanya wkwk terus, sehat nggak tuh 😆"]) assert.equal(hasBannedWord(good, { roast: true }), false, good);
  assert.equal(hasBannedWord("kayak mau lewat", { roast: true }), false, "tidak salah kena 'kaya'");
  assert.equal(hasBannedWord("tolong matikan lampu", { roast: true }), true, "boleh berlebihan menyaring (matikan -> mati)");
});

await ok("validasi roast: satu kalimat, menyebut nama, bersih, SKIP dihormati", () => {
  assert.equal(validateRoast("Budi, balasnya lama banget, lagi nunggu sinyal turun gunung ya? 😄", { targetName: "Budi Santoso" }).ok, true);
  assert.equal(validateRoast("SKIP", { targetName: "Budi" }).ok, false);
  assert.match(validateRoast("skip, tidak ada bahan", { targetName: "Budi" }).reason, /SKIP/);
  assert.match(validateRoast("Ayyubi: Orang itu ketawanya kebanyakan wkwk deh", { targetName: "Budi" }).reason, /nama/);
  assert.match(validateRoast("Budi gendut ya kamu sekarang lucu banget", { targetName: "Budi" }).reason, /terlarang/);
  assert.match(validateRoast("Budi cek https://x.id dulu deh ya biar tahu", { targetName: "Budi" }).reason, /tautan/);
  assert.match(validateRoast("Budi.", { targetName: "Budi" }).reason, /panjang/);
  assert.match(validateRoast("Budi ngetik lama. Mikir lama. Kirim lama. Bales lama. Aduh.", { targetName: "Budi" }).reason, /kalimat/);
  assert.equal(validateRoast('"Budi ngetiknya cepat tapi balasnya kok lama ya 😅"\nCatatan: ini candaan', { targetName: "Budi" }).ok, true, "hanya baris pertama, tanda kutip dibuang");
  const { system, user } = buildRoastPrompt({ target: { name: "Budi" }, messages: [{ name: "Budi", text: "wkwk" }, { name: "Sari", text: "lapar" }] });
  assert.match(system, /DILARANG menyinggung/);
  assert.match(system, /SKIP/);
  assert.match(user, /Budi: wkwk/);
  assert.match(user, /Sasaran godaan: Budi/);
});

await ok("obrolan serius/sedih/resmi terdeteksi; santai dikenali", () => {
  for (const s of ["innalillahi, bapaknya Rudi meninggal", "lagi di rumah sakit nih", "tolong bantu dong, error terus", "Mohon izin Bapak/Ibu rapat dipindah", "gimana cara isi form ini?", "cek https://contoh.id ya", "aku sedih banget hari ini", "x".repeat(250)]) {
    assert.equal(isSeriousChat([{ text: s }]), true, s);
  }
  assert.equal(isSeriousChat([{ text: "wkwk lapar nih" }, { text: "ngopi yuk" }]), false);
  assert.equal(hasCasualCue([{ text: "wkwkwk ngakak" }]), true);
  assert.equal(hasCasualCue([{ text: "ok siap" }]), false);
});

await ok("menolak / mengizinkan roasting dikenali dari kalimat", () => {
  for (const s of ["bot jangan roasting aku", "jangan roast saya dong", "bot, gak usah ngeroast gue ya", "aku nggak mau diroasting", "stop roasting aku", "jgn diledekin aku", "bot jangan bercandain aku"]) {
    assert.equal(detectRoastPref(s), "out", s);
  }
  for (const s of ["bot boleh roasting aku lagi", "silakan roast saya", "gas roasting gue"]) assert.equal(detectRoastPref(s), "in", s);
  for (const s of ["jangan lupa rapat besok", "roasting kopi itu enak", "bot jangan roasting dia", "kemarin Budi diroasting lucu banget", "aku mau pulang"]) assert.equal(detectRoastPref(s), null, s);
});

// ---------------------------------------------------------------- inti
const T0 = Date.UTC(2026, 9, 5, 2, 0); // Senin 10:00 WITA
const KEY = "main|111@g.us";
function rig(over = {}) {
  const st = over.state || mem();
  const sent = [];
  let t = over.t0 ?? T0;
  const timers = [];
  const aiCalls = [];
  const aiOut = over.aiOut ?? ((c) => (c.system.includes("pantun") ? FALLBACK_PANTUN[0] : `${/Sasaran godaan: (\S+)/.exec(c.user)[1]}, balasnya lama banget, lagi nunggu sinyal turun gunung ya? 😄`));
  const h = createHumor({
    state: st,
    ai: over.noAi ? null : async (c) => (aiCalls.push(c), typeof aiOut === "function" ? aiOut(c, aiCalls.length) : aiOut),
    send: async (a, jid, text, o) => {
      if (over.sendFail?.()) throw new Error("WhatsApp putus");
      sent.push({ a, jid, text, o });
    },
    listGroups: async (a) => ({ main: [{ id: "111@g.us", subject: "Keluarga Besar", allowed: true }, { id: "222@g.us", subject: "Arisan RT 05", allowed: true }, { id: "999@g.us", subject: "Grup Lain", allowed: false }], wa2: [{ id: "444@g.us", subject: "Kantor Wongso", allowed: true }] }[a]),
    labels: { main: "Nomor utama", wa2: "Wongsobot" },
    secondEnabled: true,
    timeZone: "Asia/Makassar",
    config: { ...readHumorConfig({ WA_HUMOR_ROAST_CHANCE: "1", ...(over.env || {}) }) },
    now: () => t,
    random: over.random || (() => 0.5),
    log: silent,
    timer: (fn, ms) => timers.push({ fn, ms })
  });
  return { h, st, sent, timers, aiCalls, tick: (ms) => void (t += ms), setNow: (x) => void (t = x), now: () => t };
}
const chat = (r, lines, { account = "main", jid = "111@g.us", gap = 20_000 } = {}) => {
  let last;
  for (const [name, text, extra] of lines) {
    r.tick(gap);
    last = r.h.observe(account, jid, { name, ids: [`id-${name}`], text, ...extra });
  }
  return last;
};
const CASUAL = [["Budi", "wkwk lapar nih"], ["Sari", "ngopi yuk gabut banget"], ["Budi", "hahaha boleh"], ["Rudi", "gas, wkwk"]];

await ok("pengaturan: bawaan MATI; /humor on menyalakan, tersimpan, dan dibaca ulang", async () => {
  const r = rig();
  await r.h.load();
  assert.equal(r.h.settings("main", "111@g.us"), null);
  assert.equal(r.h.anyEnabled(), false);
  assert.match(await r.h.handle("on 1"), /Dinyalakan: humor.*"Arisan RT 05"|Dinyalakan: humor.*"Keluarga Besar"/s);
  assert.equal(r.h.anyEnabled(), true);
  const saved = JSON.parse(r.st.m.get(STATE_KEY));
  assert.equal(Object.keys(saved.groups).length, 1);
  const r2 = rig({ state: r.st });
  await r2.h.load();
  assert.equal(r2.h.anyEnabled(), true, "bertahan setelah restart");
});

await ok("perintah: nomor, nama, semua, sebagian, jam, wa2, galat", async () => {
  const r = rig();
  await r.h.load();
  const status0 = await r.h.handle("");
  assert.match(status0, /1\. Arisan RT 05/, "diurutkan abjad");
  assert.match(status0, /2\. Keluarga Besar/);
  assert.match(status0, /3\. Kantor Wongso/);
  assert.doesNotMatch(status0, /Grup Lain/, "grup yang tidak diizinkan tidak ditawarkan");
  assert.match(await r.h.handle("on keluarga"), /Dinyalakan.*"Keluarga Besar"/s);
  assert.equal(r.h.settings("main", "111@g.us").roast, true);
  assert.match(await r.h.handle("roast off keluarga"), /Dimatikan: roasting ringan/);
  assert.equal(r.h.settings("main", "111@g.us").roast, false);
  assert.equal(r.h.settings("main", "111@g.us").pantun, true);
  assert.match(await r.h.handle("gaya off 2"), /Dimatikan: gaya jawaban/);
  assert.match(await r.h.handle("semua on"), /semua grup \(3\)/);
  assert.equal(r.h.settings("wa2", "444@g.us").pantun, true);
  assert.match(await r.h.handle("semua off"), /Dimatikan/);
  assert.equal(r.h.anyEnabled(), false);
  assert.match(await r.h.handle("on wa2 kantor"), /Kantor Wongso/);
  assert.equal(r.h.settings("wa2", "444@g.us").chat, true);
  assert.match(await r.h.handle("jam 09:00-10:00 kantor"), /09:00–10:00/);
  assert.match(await r.h.handle("jam reset kantor"), /bawaan 08:00–20:00/);
  assert.match(await r.h.handle("on grup lain"), /Tidak ada grup yang dijawab bot/, "grup tak diizinkan ditolak");
  assert.match(await r.h.handle("on 9"), /Tidak ada grup nomor 9/);
  assert.match(await r.h.handle("on ar"), /terlalu pendek/);
  assert.match(await r.h.handle("on r"), /terlalu pendek/);
  assert.match(await r.h.handle("on a"), /terlalu pendek/);
  assert.match(await r.h.handle("on"), /Sebutkan grupnya/);
  assert.match(await r.h.handle("hapus semua"), /tidak dikenali/);
  assert.match(await r.h.handle("jam 9-10 keluarga"), /Format jam/);
  assert.equal(parseHumorArg("semua on wa2").account, "wa2");
  assert.equal(parseHumorArg("pantun on 3").flags[0], "pantun");
});

await ok("database terganggu saat start: perubahan ditunda, pengaturan lama tidak tertimpa", async () => {
  let bad = true;
  const st = mem({ [STATE_KEY]: JSON.stringify({ groups: { [KEY]: { name: "Keluarga Besar", chat: true, pantun: true, roast: false } }, optout: {} }) });
  const strict = { get: async (k) => { if (bad) throw new Error("db down"); return st.get(k); }, set: st.set };
  const r = rig({ state: strict });
  await r.h.load();
  assert.equal(r.h.settings("main", "111@g.us"), null, "belum terbaca: fitur ditahan");
  assert.match(await r.h.handle("on 2"), /belum bisa dibaca/);
  bad = false;
  assert.match(await r.h.handle("on 2"), /Dinyalakan/);
  assert.equal(r.h.settings("main", "111@g.us").pantun, true, "pengaturan lama utuh");
});

await ok("pantun harian: jam acak dipilih sekali per hari, dikirim sekali, bertahan setelah restart", async () => {
  const r = rig({ t0: Date.UTC(2026, 9, 5, 0, 0), random: () => 0.25 }); // 08:00 WITA
  await r.h.load();
  await r.h.handle("pantun on keluarga");
  await r.h.check();
  const st = r.h.sched?.() ?? r.h._debug.sched().pantun[KEY];
  const rec = r.h._debug.sched().pantun[KEY];
  assert.equal(rec.day, "2026-10-05");
  assert.ok(rec.at >= 485 && rec.at < 1200, `jam ${rec.at}`);
  assert.equal(r.sent.length, 0, "belum waktunya");
  r.tick(60_000 * 30);
  await r.h.check();
  assert.equal(r.sent.length, 0, "masih sebelum jam acak");
  r.setNow(Date.UTC(2026, 9, 5, 0, 0) + (rec.at - 480 + 1) * 60_000);
  await r.h.check();
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0].text, /^🎋 Pantun (pagi|siang|sore|malam), Senin:/);
  assert.equal(r.sent[0].jid, "111@g.us");
  assert.equal(r.sent[0].a, "main");
  r.tick(60_000 * 120);
  await r.h.check();
  await r.h.check();
  assert.equal(r.sent.length, 1, "sehari sekali");
  // restart di hari yang sama: tidak kirim lagi
  const r2 = rig({ state: r.st, t0: r.now() });
  await r2.h.load();
  await r2.h.check();
  assert.equal(r2.sent.length, 0);
  // hari berikutnya: jam baru dipilih dan kirim lagi
  r2.setNow(Date.UTC(2026, 9, 6, 0, 0));
  await r2.h.check();
  const rec2 = r2.h._debug.sched().pantun[KEY];
  assert.equal(rec2.day, "2026-10-06");
  r2.setNow(Date.UTC(2026, 9, 6, 0, 0) + 12 * 60 * 60_000 - 1);
  await r2.h.check();
  assert.equal(r2.sent.length, 1);
});

await ok("pantun: tiap grup punya jam sendiri (acak berbeda), grup yang mati tidak dikirimi", async () => {
  let k = 0;
  const seq = [0.1, 0.9, 0.5, 0.3, 0.7, 0.2];
  const r = rig({ t0: Date.UTC(2026, 9, 5, 0, 0), random: () => seq[k++ % seq.length] });
  await r.h.load();
  await r.h.handle("pantun on keluarga");
  await r.h.handle("pantun on arisan");
  await r.h.check();
  const s = r.h._debug.sched().pantun;
  assert.notEqual(s["main|111@g.us"].at, s["main|222@g.us"].at);
  r.tick(11 * 3600_000 + 59 * 60_000);
  await r.h.check();
  assert.equal(r.sent.length, 2);
  assert.deepEqual(r.sent.map((x) => x.jid).sort(), ["111@g.us", "222@g.us"]);
  assert.equal(r.sent.some((x) => x.jid === "444@g.us"), false);
});

await ok("pantun: AI invalid -> coba lagi -> cadangan tetap; hasil AI valid dipakai; tanpa AI pakai cadangan; tidak berulang", async () => {
  const good = "Buah duku buah manggis,\nDimakan enak waktu siang.\nKerja terus jangan menangis,\nSebentar lagi waktunya pulang.";
  const r = rig({ t0: Date.UTC(2026, 9, 5, 0, 0), aiOut: () => "pantun ngawur satu baris" });
  await r.h.load();
  await r.h.handle("tes keluarga");
  assert.equal(r.aiCalls.length, 2, "dua kali percobaan");
  assert.equal(r.sent.length, 1);
  assert.ok(FALLBACK_PANTUN.some((p) => r.sent[0].text.includes(p)), "memakai cadangan");
  const r2 = rig({ aiOut: good });
  await r2.h.load();
  assert.match(await r2.h.handle("tes keluarga"), /dibuat AI/);
  assert.ok(r2.sent[0].text.includes(good));
  const r3 = rig({ noAi: true });
  await r3.h.load();
  assert.match(await r3.h.handle("tes keluarga"), /dari cadangan/);
  // dua tes berurutan tidak mengirim pantun yang sama (cadangan bergilir)
  await r3.h.handle("tes keluarga");
  assert.notEqual(r3.sent[0].text, r3.sent[1].text);
  // pantun AI yang sama dengan terakhir ditolak
  const r4 = rig({ aiOut: good });
  await r4.h.load();
  await r4.h.handle("tes keluarga");
  await r4.h.handle("tes keluarga");
  assert.ok(FALLBACK_PANTUN.some((p) => r4.sent[1].text.includes(p)), "tidak mengulang pantun sebelumnya");
  // AI melempar galat: cadangan, tidak melempar
  const r5 = rig({ aiOut: () => { throw new Error("kuota habis"); } });
  await r5.h.load();
  assert.match(await r5.h.handle("tes keluarga"), /terkirim/);
});

await ok("pantun gagal kirim: dicoba lagi 10 menit kemudian, menyerah setelah 3 kali", async () => {
  let fail = true;
  const r = rig({ t0: Date.UTC(2026, 9, 5, 0, 0), random: () => 0, sendFail: () => fail });
  await r.h.load();
  await r.h.handle("pantun on keluarga");
  await r.h.check();
  r.tick(60_000 * 10);
  await r.h.check();
  const rec = () => r.h._debug.sched().pantun[KEY];
  assert.equal(rec().tries, 1);
  await r.h.check();
  assert.equal(rec().tries, 1, "belum 10 menit");
  r.tick(60_000 * 11);
  await r.h.check();
  assert.equal(rec().tries, 2);
  fail = false;
  r.tick(60_000 * 11);
  await r.h.check();
  assert.equal(r.sent.length, 1);
  assert.equal(rec().sent, true);
  // menyerah
  fail = true;
  const r2 = rig({ t0: Date.UTC(2026, 9, 5, 0, 0), random: () => 0, sendFail: () => fail });
  await r2.h.load();
  await r2.h.handle("pantun on keluarga");
  for (let i = 0; i < 6; i += 1) {
    await r2.h.check();
    r2.tick(60_000 * 11);
  }
  assert.equal(r2.h._debug.sched().pantun[KEY].tries, 3);
  assert.equal(r2.h._debug.sched().pantun[KEY].sent, true);
});

await ok("pantun: bot baru hidup lewat rentang jam -> tidak dikirim larut malam; rentang kustom per grup", async () => {
  const r = rig({ t0: Date.UTC(2026, 9, 5, 14, 0) }); // 22:00 WITA
  await r.h.load();
  await r.h.handle("pantun on keluarga");
  await r.h.check();
  assert.equal(r.sent.length, 0);
  assert.equal(r.h._debug.sched().pantun[KEY].at, null);
  const r2 = rig({ t0: Date.UTC(2026, 9, 5, 0, 0), random: () => 0 });
  await r2.h.load();
  await r2.h.handle("pantun on keluarga");
  await r2.h.handle("jam 13:00-14:00 keluarga");
  await r2.h.check();
  assert.ok(r2.h._debug.sched().pantun[KEY].at >= 780 && r2.h._debug.sched().pantun[KEY].at < 840);
});

await ok("roast: obrolan santai & ramai -> terkirim (dibalas ke pesan sasaran), jatah & jeda berlaku", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("roast on keluarga");
  const res = chat(r, CASUAL, {});
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.target, "Rudi");
  assert.equal(r.timers.length, 1);
  assert.ok(r.timers[0].ms >= 4000 && r.timers[0].ms <= 18_000, "jeda alami");
  await r.timers[0].fn();
  await new Promise((x) => setImmediate(x));
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0].text, /Rudi/);
  assert.equal(r.aiCalls.length >= 1, true);
  // jeda: obrolan ramai lagi segera setelahnya -> tidak
  const again = chat(r, CASUAL, {});
  assert.equal(again.reason, "masih dalam jeda");
});

await ok("roast: jatah harian 5x, jeda antar-roast, reset hari berikutnya", async () => {
  const r = rig({ aiOut: (c) => `${/Sasaran godaan: (\w+)/.exec(c.user)[1]}, balasnya lama banget, lagi nunggu sinyal ya? 😄`, env: { WA_HUMOR_ROAST_COOLDOWN_MIN: "1" } });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  let count = 0;
  for (let i = 0; i < 8; i += 1) {
    r.tick(5 * 60_000);
    const names = i % 2 ? ["Anto", "Dewi"] : ["Wati", "Joko"];
    const res = chat(r, [[names[0], "wkwk lapar"], [names[1], "ngopi yuk gabut"], [names[0], "hahaha"], [names[1], "gas wkwk"]], {});
    if (res?.ok) {
      await r.timers.pop().fn();
      await new Promise((x) => setImmediate(x));
      count += 1;
    }
    if (r.sent.length >= 5) break;
  }
  assert.equal(r.sent.length, 5);
  r.tick(5 * 60_000);
  assert.equal(chat(r, CASUAL, {}).reason, "jatah hari ini habis");
  r.setNow(r.now() + 24 * 3600_000);
  assert.equal(chat(r, [["Tia", "wkwk lapar"], ["Edo", "ngopi yuk"], ["Tia", "hahaha"], ["Edo", "gas wkwk"]], {}).ok, true, "hari baru: jatah baru");
  // jatah bertahan setelah restart
  const r2 = rig({ state: r.st, t0: r.now() - 24 * 3600_000 + 1000 });
  await r2.h.load();
  assert.equal(r2.h._debug.sched().roast[KEY].count, 5);
});

await ok("roast: dilewati bila serius / belum ramai / satu orang / basi / di luar jam / baru dipanggil / roast mati", async () => {
  const mk = async () => {
    const r = rig();
    await r.h.load();
    await r.h.handle("roast on keluarga");
    return r;
  };
  let r = await mk();
  assert.equal(chat(r, [["Budi", "wkwk lapar"], ["Sari", "innalillahi pak Rudi meninggal"], ["Budi", "hahaha"], ["Rudi", "wkwk"]]).reason, "obrolan serius");
  r = await mk();
  assert.equal(chat(r, [["Budi", "wkwk lapar"], ["Sari", "ngopi yuk"]]).reason, "belum ramai");
  r = await mk();
  assert.equal(chat(r, [["Budi", "wkwk lapar"], ["Budi", "ngopi yuk"], ["Budi", "hahaha"], ["Budi", "gas wkwk"]]).reason, "hanya satu orang");
  r = await mk();
  assert.equal(chat(r, [["Budi", "ok"], ["Sari", "siap"], ["Budi", "yoi"], ["Rudi", "oke"]]).reason, "belum terdengar santai");
  r = await mk();
  assert.equal(chat(r, [["Budi", "wkwk"], ["Sari", "hahaha"], ["Budi", "hehe"], ["Rudi", "wkwk"]], { gap: 5 * 60_000 }).reason, "belum ramai", "obrolan renggang: pesan lama keluar dari jendela 10 menit");
  r = await mk();
  r.h.observe("main", "111@g.us", { name: "Budi", ids: ["id-Budi"], text: "wkwk" });
  chat(r, CASUAL.slice(0, 3), { gap: 1000 });
  r.tick(3 * 60_000);
  assert.equal(r.h.evaluate("main", "111@g.us").reason, "obrolan sudah lewat");
  r = rig({ t0: Date.UTC(2026, 9, 5, 15, 0) }); // 23:00 WITA
  await r.h.load();
  await r.h.handle("roast on keluarga");
  assert.equal(chat(r, CASUAL).reason, "di luar jam aktif");
  r = await mk();
  r.h.noteTriggered("main", "111@g.us");
  assert.equal(chat(r, CASUAL).reason, "bot baru saja dipanggil");
  r = rig();
  await r.h.load();
  await r.h.handle("pantun on keluarga");
  assert.equal(chat(r, CASUAL), null, "roast mati: tidak ada yang disimpan");
  assert.equal(r.h._debug.buffers.size, 0);
  r = rig({ env: { WA_HUMOR_ROAST_MAX_PER_DAY: "0" } });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  assert.equal(chat(r, CASUAL).reason, "jatah 0");
});

await ok("roast: peluang acak dihormati; bukan semua pesan memicu", async () => {
  const r = rig({ env: { WA_HUMOR_ROAST_CHANCE: "0.15" }, random: () => 0.9 });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  assert.equal(chat(r, CASUAL).reason, "tidak terpilih (acak)");
  assert.equal(r.timers.length, 0);
});

await ok("roast: pemilik tidak jadi sasaran (kecuali diizinkan); sasaran bergeser ke orang lain", async () => {
  let r = rig();
  await r.h.load();
  await r.h.handle("roast on keluarga");
  const withOwner = [["Budi", "wkwk lapar"], ["Sari", "ngopi yuk gabut"], ["Bos", "hahaha boleh", { isOwner: true }], ["Bos", "gas wkwk", { isOwner: true }]];
  // dua pesan terakhir milik pemilik -> mundur ke pengirim sebelumnya
  const ids = (name) => [`id-${name}`];
  let res = chat(r, withOwner);
  assert.equal(res.ok, true);
  assert.equal(res.target, "Sari");
  r = rig({ env: { WA_HUMOR_ROAST_OWNER: "true" } });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  res = chat(r, withOwner);
  assert.equal(res.target, "Bos");
  void ids;
});

await ok("roast: orang yang menolak tidak pernah jadi sasaran; mencabut penolakan; berlaku per grup", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("on keluarga");
  await r.h.handle("on arisan");
  const out = await r.h.handlePreference("main", "111@g.us", { name: "Rudi Hartono", ids: ["id-Rudi"], text: "bot jangan roasting aku" });
  assert.equal(out.pref, "out");
  assert.match(out.reply, /Siap Rudi/);
  assert.deepEqual(JSON.parse(r.st.m.get(STATE_KEY)).optout[KEY], ["id-Rudi"]);
  // Rudi pengirim terakhir tapi menolak -> sasaran bergeser
  const res = chat(r, CASUAL);
  assert.equal(res.ok, true);
  assert.notEqual(res.target, "Rudi");
  // di grup lain Rudi tidak menolak
  assert.equal(r.h.evaluate("main", "222@g.us").ok, false);
  const back = await r.h.handlePreference("main", "111@g.us", { name: "Rudi", ids: ["id-Rudi"], text: "bot boleh roasting aku lagi" });
  assert.equal(back.pref, "in");
  assert.equal(JSON.parse(r.st.m.get(STATE_KEY)).optout[KEY], undefined);
  // tidak berlaku di grup tanpa humor
  assert.equal(await r.h.handlePreference("main", "999@g.us", { name: "Rudi", ids: ["id-Rudi"], text: "bot jangan roasting aku" }), null);
  // kalimat biasa tidak ditangani
  assert.equal(await r.h.handlePreference("main", "111@g.us", { name: "Rudi", ids: ["id-Rudi"], text: "bot apa kabar" }), null);
  // jika semua orang di obrolan menolak -> tidak ada sasaran
  const r2 = rig();
  await r2.h.load();
  await r2.h.handle("roast on keluarga");
  for (const nm of ["Budi", "Sari", "Rudi"]) await r2.h.handlePreference("main", "111@g.us", { name: nm, ids: [`id-${nm}`], text: "jangan roasting aku" });
  assert.equal(chat(r2, CASUAL).reason, "tidak ada sasaran yang pantas");
});

await ok("roast: AI memilih SKIP / keluaran tidak lolos -> tidak ada yang dikirim; setelah jeda dibatalkan bila bot dipanggil", async () => {
  let r = rig({ aiOut: "SKIP" });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  chat(r, CASUAL);
  await r.timers[0].fn();
  await new Promise((x) => setImmediate(x));
  assert.equal(r.sent.length, 0);
  assert.equal(r.aiCalls.length, 1, "SKIP tidak diulang");
  r = rig({ aiOut: "Rudi itu gendut banget ya, makan terus" });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  chat(r, CASUAL);
  await r.timers[0].fn();
  await new Promise((x) => setImmediate(x));
  assert.equal(r.sent.length, 0, "kata terlarang disaring");
  assert.equal(r.aiCalls.length, 2, "dicoba sekali lagi lalu menyerah");
  assert.equal(r.h._debug.sched().roast[KEY], undefined, "tidak menghabiskan jatah");
  r = rig();
  await r.h.load();
  await r.h.handle("roast on keluarga");
  chat(r, CASUAL);
  r.h.noteTriggered("main", "111@g.us");
  await r.timers[0].fn();
  await new Promise((x) => setImmediate(x));
  assert.equal(r.sent.length, 0, "ada yang memanggil bot selama jeda -> batal");
  r = rig({ aiOut: () => { throw new Error("AI mati"); } });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  chat(r, CASUAL);
  await r.timers[0].fn();
  await new Promise((x) => setImmediate(x));
  assert.equal(r.sent.length, 0, "AI gagal: diam saja, tanpa roast cadangan");
});

await ok("privasi: obrolan hanya di memori (tidak masuk bot_state), dibatasi 10 pesan, dibuang saat dipanggil/dimatikan", async () => {
  const r = rig({ aiOut: "SKIP" });
  await r.h.load();
  await r.h.handle("roast on keluarga");
  const many = [];
  for (let i = 0; i < 15; i += 1) many.push([i % 2 ? "Budi" : "Sari", `pesan rahasia nomor ${i}`]);
  chat(r, many, { gap: 1000 });
  assert.equal(r.h._debug.buffers.get(KEY).length, 10);
  const dump = JSON.stringify([...r.st.m.values()]);
  assert.doesNotMatch(dump, /rahasia/, "isi chat tidak pernah ditulis ke penyimpanan");
  r.h.noteTriggered("main", "111@g.us");
  assert.equal(r.h._debug.buffers.has(KEY), false);
  chat(r, many.slice(0, 3), { gap: 1000 });
  await r.h.handle("roast off keluarga");
  assert.equal(r.h._debug.buffers.has(KEY), false);
  // pesan kosong / spasi diabaikan
  await r.h.handle("roast on keluarga");
  assert.equal(r.h.observe("main", "111@g.us", { name: "A", ids: ["a"], text: "   " }), null);
});

await ok("gaya jawaban: catatan prompt hanya bila gaya menyala dan topik tidak serius", async () => {
  const r = rig();
  await r.h.load();
  assert.equal(r.h.chatNote("main", "111@g.us", { text: "apa itu SBM?" }), "");
  await r.h.handle("gaya on keluarga");
  const note = r.h.chatNote("main", "111@g.us", { text: "apa itu SBM?" });
  assert.equal(note, HUMOR_CHAT_NOTE);
  assert.match(note, /HARUS tetap akurat/);
  assert.match(note, /JANGAN bercanda bila topiknya duka/);
  assert.equal(r.h.chatNote("main", "111@g.us", { text: "pak Rudi meninggal dunia, innalillahi" }), "", "topik duka: tanpa gaya humor");
  assert.equal(r.h.chatNote("main", "222@g.us", { text: "halo" }), "", "grup lain tidak terpengaruh");
  assert.equal(r.h.chatNote("wa2", "111@g.us", { text: "halo" }), "", "nomor lain tidak terpengaruh");
});

await ok("dua nomor WhatsApp: pengaturan terpisah per nomor", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("on wa2 kantor");
  assert.equal(r.h.settings("wa2", "444@g.us").roast, true);
  assert.equal(r.h.settings("main", "444@g.us"), null);
  assert.match(await r.h.handle("wa2"), /Kantor Wongso/);
  assert.doesNotMatch(await r.h.handle("wa2"), /Arisan RT/);
});

await ok("terintegrasi di index.js, telegram.js, dan dokumentasi", () => {
  const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const idx = read("./index.js");
  const tg = read("./telegram.js");
  assert.match(idx, /from "\.\/humor\.js"/);
  assert.match(idx, /createHumor\(/);
  assert.match(idx, /humor\.check\(\)/, "penjadwal pantun jalan tiap menit");
  assert.match(idx, /humor\.observe\(/, "obrolan santai dibaca sebelum return untuk pesan tanpa pemicu");
  assert.match(idx, /humor\.handlePreference\(/);
  assert.match(idx, /humor\.noteTriggered\(/);
  assert.match(idx, /humor\.chatNote\(/);
  assert.match(idx, /humor: \{ handle: \(arg\) => humor\.handle/, "diteruskan ke telegram");
  assert.ok(idx.indexOf("humor.observe(") < idx.indexOf("offerAgendaFromChat(sock, msg, groupJid, rawText)"), "pembacaan obrolan terjadi sebelum return untuk pesan tanpa pemicu");
  assert.ok(idx.indexOf("humor.noteTriggered(") > idx.indexOf("tapi grup ini tidak ada di WA_GROUP_ALLOWED_NAMES/JIDS"), "noteTriggered setelah pemeriksaan izin grup");
  assert.match(tg, /name === "humor"/);
  assert.match(tg, /command: "humor"/);
  assert.match(read("./README.md"), /Mode humor/);
  assert.match(read("./.env.example"), /WA_HUMOR_ROAST_MAX_PER_DAY/);
  void SCHED_KEY;
});

console.log(`\nSemua ${n} kelompok tes humor lulus.`);
