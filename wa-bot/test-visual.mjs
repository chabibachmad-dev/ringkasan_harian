// Tes jam tidur + kemampuan melihat (gambar & stiker). Jalankan: node test-visual.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTelegram } from "./telegram.js";
import { createHumor, parseHumorArg, readHumorConfig, STIKER_KEY } from "./humor.js";
import { inNightWindow, parseNightWindow, readNgobrolConfig } from "./ngobrol.js";
import { parseStickerOutput, STICKER_REPLY_TAGS, addToLibrary, cleanImageDescription, guessTagFromText, looksLikeImageQuestion, parseStickerTag, pickStickerFor, readVisualConfig, webpFirstFrame } from "./visual.js";

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
const T_2AM = Date.UTC(2026, 9, 4, 18, 0); // Senin 02:00 WITA
const JID = "111@g.us";
const IMG = Buffer.from("gambar-palsu-1");
const STK = (i) => Buffer.from(`stiker-palsu-${i}`);

function rig(over = {}) {
  const st = over.state || mem();
  const sent = [];
  const stickersSent = [];
  const reacts = [];
  const visionCalls = [];
  const files = over.files || new Map();
  let t = over.t0 ?? T_NOON;
  const timers = [];
  let rnd = 0.99;
  const aiCalls = [];
  const media =
    over.noMedia
      ? null
      : {
          fetch: async (msg, kind) => (msg?.buf ? { buffer: msg.buf, mime: kind === "stiker" ? "image/webp" : "image/jpeg" } : null),
          vision: async (c) => {
            visionCalls.push(c);
            if (over.visionFail) throw new Error("kuota habis");
            return typeof over.visionOut === "function" ? over.visionOut(c) : over.visionOut ?? (c.system.includes("STIKER") ? "tawa | kucing tertawa terbahak" : "Sepiring nasi goreng dengan telur mata sapi di atas meja");
          },
          sendSticker: async (a, jid, buffer, o) => void stickersSent.push({ a, jid, buffer, o, at: t }),
          store: { put: async (name, buf) => void files.set(name, buf), get: async (name) => files.get(name) ?? null, del: async (name) => void files.delete(name) }
        };
  const h = createHumor({
    state: st,
    ai: async (c) => (aiCalls.push(c), over.aiOut ?? "Wah nasi gorengnya menggoda banget, itu buat makan malam ya? 😋"),
    send: async (a, jid, text, o) => void sent.push({ a, jid, text, o, at: t }),
    react: async (a, jid, msg, emoji) => void reacts.push({ jid, emoji }),
    media,
    listGroups: async () => [{ id: JID, subject: "Keluarga Besar", allowed: true }],
    secondEnabled: Boolean(over.second),
    sleep: async () => {},
    timeZone: "Asia/Makassar",
    config: readHumorConfig({ WA_BALAS_CHANCE: "0.5", WA_REAKSI_CHANCE: "0", WA_ENERGI_HARIAN: "off", WA_GAYA_ALAMI: "off", ...(over.env || {}) }),
    now: () => t,
    random: over.random || (() => rnd),
    log: process.env.DBG ? console : silent,
    timer: (fn, ms) => timers.push({ fn, ms })
  });
  return { h, st, sent, stickersSent, reacts, visionCalls, aiCalls, files, timers, setRnd: (v) => void (rnd = v), tick: (ms) => void (t += ms), setNow: (x) => void (t = x), now: () => t };
}
async function runTimers(r) {
  while (r.timers.length) {
    const x = r.timers.shift();
    await x.fn();
    await new Promise((res) => setImmediate(res));
  }
}
const text = (r, name, body, extra = {}) => {
  r.tick(extra.gap ?? 20_000);
  return r.h.observe("main", JID, { name, ids: [`id-${name}`], text: body, msg: { key: { id: `t${r.now()}` } } });
};
const photo = (r, name, extra = {}) => {
  r.tick(extra.gap ?? 20_000);
  return r.h.observeMedia("main", JID, { name, ids: [`id-${name}`], kind: "gambar", caption: extra.caption || "", msg: { key: { id: `p${r.now()}` }, buf: extra.buf || IMG }, repliedToBot: extra.repliedToBot });
};
const sticker = (r, name, buf, extra = {}) => {
  r.tick(extra.gap ?? 20_000);
  return r.h.observeMedia("main", JID, { name, ids: [`id-${name}`], kind: "stiker", msg: { key: { id: `s${r.now()}` }, buf }, repliedToBot: extra.repliedToBot });
};
async function settle(r) {
  for (let i = 0; i < 6; i += 1) await new Promise((res) => setImmediate(res));
  await runTimers(r);
  for (let i = 0; i < 6; i += 1) await new Promise((res) => setImmediate(res));
}
const chat = (r) => {
  text(r, "Budi", "tadi siang makan apa nih kalian");
  text(r, "Sari", "aku makan soto ayam enak banget");
  text(r, "Rudi", "wah kok nggak ngajak ngajak");
};

// ---------------------------------------------------------------- jam tidur
await ok("jam tidur: bawaan 22:30-05:00, bisa diatur/dimatikan, melewati tengah malam", () => {
  const d = parseNightWindow("");
  assert.deepEqual(d, { from: 1350, to: 300 });
  assert.equal(inNightWindow(23 * 60, d), true);
  assert.equal(inNightWindow(2 * 60, d), true);
  assert.equal(inNightWindow(4 * 60 + 59, d), true);
  assert.equal(inNightWindow(5 * 60, d), false);
  assert.equal(inNightWindow(12 * 60, d), false);
  assert.equal(inNightWindow(22 * 60 + 29, d), false);
  assert.equal(parseNightWindow("off"), null);
  assert.equal(inNightWindow(2 * 60, null), false, "tanpa jam tidur");
  assert.deepEqual(parseNightWindow("23:00-04:00"), { from: 1380, to: 240 });
  assert.deepEqual(parseNightWindow("ngawur"), { from: 1350, to: 300 });
  assert.deepEqual(parseNightWindow("01:00-05:00"), { from: 60, to: 300 }, "rentang biasa juga boleh");
  assert.equal(inNightWindow(2 * 60, { from: 60, to: 300 }), true);
  const c = readNgobrolConfig({ WA_JAM_TIDUR: "off" });
  assert.equal(c.tidurWindow, null);
  assert.deepEqual(readNgobrolConfig({}).sapaWindow, { from: 360, to: 1290 });
});

await ok("jam tidur: chat otomatis (sapa) TIDAK PERNAH jalan jam 22:30-05:00 meski jendela sapa dibuka 24 jam; jatah 10×/hari tetap tercapai di siang", async () => {
  for (const env of [{}, { WA_SAPA_WINDOW: "00:00-23:59" }]) {
    const r = rig({ t0: Date.UTC(2026, 9, 5, 16, 0), env, random: () => 0.5 }); // 00:00 WITA
    await r.h.load();
    await r.h.handle("sapa on keluarga");
    for (let i = 0; i < 24 * 12; i += 1) {
      await r.h.check();
      r.tick(5 * MIN);
    }
    assert.ok(r.sent.length >= 9, `jatah hampir tercapai (${r.sent.length})`);
    for (const s of r.sent) {
      const hh = new Date(s.at + 8 * 3_600_000).getUTCHours() * 60 + new Date(s.at + 8 * 3_600_000).getUTCMinutes();
      assert.ok(hh >= 300 && hh < 1350, `bukan jam tidur (jam ${Math.floor(hh / 60)}:${hh % 60})`);
    }
  }
});

await ok("jam tidur: balas hanya saat obrolan ramai (>=4 chat dari >=2 orang dalam 10 menit) dan dengan peluang kecil", async () => {
  // sepi: satu orang saja -> tidak membalas walau peluang lolos
  let r = rig({ t0: T_2AM });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  text(r, "Budi", "belum tidur juga nih ada yang bangun gak");
  const lone = r.h.evaluateBalas("main", JID, r.h._debug.ctxBuf.get(`main|${JID}`).at(-1), { ignoreChance: true });
  assert.equal(lone.ok, false);
  // ramai di jam tidur: lolos pengecekan layak, tapi peluangnya dikali 0.2
  r = rig({ t0: T_2AM, env: { WA_BALAS_CHANCE: "0.5" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  text(r, "Budi", "belum tidur juga nih ada yang bangun gak");
  text(r, "Sari", "aku bangun nih gabisa tidur kepikiran besok");
  text(r, "Rudi", "sama aku lagi nonton bola ternyata seru");
  text(r, "Budi", "wah iya skornya lagi ketat banget malam ini");
  const last = r.h._debug.ctxBuf.get(`main|${JID}`).at(-1);
  assert.equal(r.h.evaluateBalas("main", JID, last, { ignoreChance: true }).ok, true, "obrolan ramai: boleh ikut");
  r.setRnd(0.15); // 0.15 < 0.5*1.3 normal (lolos) tapi > 0.5*1.3*0.2=0.13 (tidak lolos di jam tidur)
  assert.equal(r.h.evaluateBalas("main", JID, last).ok, false, "jam tidur: peluang dikali 0.2");
  const r2 = rig({ t0: T_NOON, env: { WA_BALAS_CHANCE: "0.5" } });
  await r2.h.load();
  await r2.h.handle("balas on keluarga");
  text(r2, "Budi", "belum tidur juga nih ada yang bangun gak");
  text(r2, "Sari", "aku bangun nih gabisa tidur kepikiran besok");
  text(r2, "Rudi", "sama aku lagi nonton bola ternyata seru");
  text(r2, "Budi", "wah iya skornya lagi ketat banget malam ini");
  r2.setRnd(0.15);
  assert.equal(r2.h.evaluateBalas("main", JID, r2.h._debug.ctxBuf.get(`main|${JID}`).at(-1)).ok, true, "siang hari: peluang normal");
});

await ok("jam tidur dimatikan (WA_JAM_TIDUR=off): sapa & balas boleh kapan saja", async () => {
  const r = rig({ t0: T_2AM, env: { WA_JAM_TIDUR: "off", WA_SAPA_WINDOW: "00:00-23:59" }, random: () => 0.5 });
  await r.h.load();
  await r.h.handle("sapa on keluarga");
  for (let i = 0; i < 24 * 12; i += 1) {
    await r.h.check();
    r.tick(5 * MIN);
  }
  assert.ok(r.sent.some((s) => new Date(s.at + 8 * 3_600_000).getUTCHours() < 5), "ada yang terkirim dini hari");
});

// ---------------------------------------------------------------- penyaring murni
await ok("deskripsi gambar: satu kalimat, SENSITIF ditolak, tautan/nomor ditolak", () => {
  assert.deepEqual(cleanImageDescription("Sepiring nasi goreng dengan telur. Terlihat enak sekali."), { ok: true, desc: "Sepiring nasi goreng dengan telur" });
  assert.equal(cleanImageDescription("SENSITIF").reason, "sensitif");
  assert.equal(cleanImageDescription("sensitif.").reason, "sensitif");
  assert.equal(cleanImageDescription("Foto kartu dengan nomor 3201234567890123").ok, false);
  assert.equal(cleanImageDescription("lihat https://x.com/a").ok, false);
  assert.equal(cleanImageDescription("").ok, false);
  assert.equal(cleanImageDescription("  \"Kucing tidur di sofa\"  ").desc, "Kucing tidur di sofa");
});

await ok("label stiker: format 'label | deskripsi', label asing jadi 'lain', SENSITIF dibuang", () => {
  assert.deepEqual(parseStickerTag("tawa | kucing tertawa"), { tag: "tawa", desc: "kucing tertawa" });
  assert.deepEqual(parseStickerTag("Senang: anak kecil melompat"), { tag: "senang", desc: "anak kecil melompat" });
  assert.equal(parseStickerTag("marah-marah | orang berteriak").tag, "lain");
  assert.equal(parseStickerTag("lain | SENSITIF").sensitive, true);
  assert.equal(parseStickerTag(""), null);
  assert.equal(parseStickerTag("ngawur tanpa format yang benar"), null);
});

await ok("memilih stiker balasan: label cocok, bukan stiker yang sama, hindari yang baru dipakai, sedih/kesal -> diam", () => {
  const lib = [
    { id: "a", tag: "tawa", uses: 0 },
    { id: "b", tag: "senang", uses: 3 },
    { id: "c", tag: "sedih", uses: 0 },
    { id: "d", tag: "tawa", uses: 1 }
  ];
  for (const rnd of [() => 0, () => 0.5, () => 0.999]) {
    const p1 = pickStickerFor(lib, "tawa", { excludeIds: ["a"], random: rnd });
    assert.ok(p1 && p1.id !== "a" && ["tawa", "senang"].includes(p1.tag), "tidak memakai stiker yang sama dengan yang diterima");
    const p2 = pickStickerFor(lib, "tawa", { avoidIds: ["a", "d"], random: rnd });
    assert.equal(p2.id, "b", "menghindari yang baru dipakai");
    const p3 = pickStickerFor(lib, "tawa", { avoidIds: ["a", "b", "d"], random: rnd });
    assert.ok(["a", "b", "d"].includes(p3.id), "kalau semua baru dipakai, boleh ulang");
  }
  const rnd = () => 0;
  assert.equal(pickStickerFor(lib, "sedih", { random: rnd }), null, "suasana sedih: tidak membalas stiker");
  assert.equal(pickStickerFor(lib, "kesal", { random: rnd }), null);
  assert.equal(pickStickerFor([{ id: "x", tag: "", uses: 0 }], "tawa", { random: rnd }), null, "stiker tanpa label tidak dipakai");
  assert.deepEqual(STICKER_REPLY_TAGS.sedih, []);
});

await ok("perpustakaan stiker: tambah, hitung kemunculan, penuh -> yang jarang & lama dibuang", () => {
  const lib = [];
  assert.equal(addToLibrary(lib, { id: "a", ts: 1 }, 3).added, true);
  assert.equal(addToLibrary(lib, { id: "a", ts: 2 }, 3).added, false);
  assert.equal(lib[0].seen, 2);
  addToLibrary(lib, { id: "b", ts: 3 }, 3);
  addToLibrary(lib, { id: "c", ts: 4 }, 3);
  const r = addToLibrary(lib, { id: "d", ts: 5 }, 3);
  assert.equal(r.evicted.id, "b", "paling jarang terlihat & paling lama");
  assert.equal(lib.length, 3);
  assert.ok(lib.some((x) => x.id === "a"), "yang sering muncul bertahan");
});

await ok("pertanyaan ke bot tentang gambar: dikenali, pertanyaan lain tidak", () => {
  assert.equal(looksLikeImageQuestion(""), true);
  assert.equal(looksLikeImageQuestion("ini gambar apa?"), true);
  assert.equal(looksLikeImageQuestion("bacain tulisannya dong"), true);
  assert.equal(looksLikeImageQuestion("jam berapa sekarang"), false);
  assert.equal(looksLikeImageQuestion("berapa tarif PPh 21 untuk gaji 10 juta rupiah per bulan"), false);
});

await ok("konfigurasi melihat: bawaan wajar dan batas", () => {
  const c = readVisualConfig({});
  assert.equal(c.visiPerDay, 30);
  assert.equal(c.stikerLibMax, 40);
  assert.equal(c.gambarMaxBytes, 4 * 1024 * 1024);
  assert.equal(readVisualConfig({ WA_STIKER_MAX_PER_DAY: "0" }).stikerMaxPerDay, 0);
  assert.equal(readVisualConfig({ WA_STIKER_CHANCE: "9" }).stikerBalasChance, 1);
  assert.equal(readHumorConfig({}).stikerLibMax, 40, "ikut di konfigurasi humor");
});

// ---------------------------------------------------------------- perintah
await ok("perintah /humor lihat: terpisah dari on/semua, ada peringatan bila AI penglihatan belum ada", async () => {
  assert.deepEqual(parseHumorArg("lihat on keluarga").flags, ["lihat"]);
  assert.deepEqual(parseHumorArg("stiker off keluarga").flags, ["lihat"]);
  assert.equal(parseHumorArg("on keluarga").flags.includes("lihat"), false, "/humor on tidak menyalakan lihat (gambar dikirim ke AI luar)");
  assert.equal(parseHumorArg("semua on").flags.includes("lihat"), false);
  let r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  const msg = await r.h.handle("lihat on keluarga");
  assert.match(msg, /baca gambar/i);
  assert.match(msg, /TIDAK DISIMPAN/);
  assert.equal(r.h.settings("main", JID).lihat, true);
  assert.match(await r.h.handle("profil keluarga"), /Stiker tersimpan: 0/);
  assert.match(await r.h.handle(""), /baca gambar\/stiker/);
  await r.h.handle("lihat off keluarga");
  assert.equal(r.h.settings("main", JID).lihat, undefined);
  r = rig({ noMedia: true });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  assert.match(await r.h.handle("lihat on keluarga"), /belum terpasang/);
});

// ---------------------------------------------------------------- membaca gambar
await ok("gambar: tidak dibaca bila /humor lihat mati (tidak ada panggilan AI penglihatan)", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  chat(r);
  assert.equal(photo(r, "Sari"), null);
  await settle(r);
  assert.equal(r.visionCalls.length, 0);
});

await ok("gambar: dibaca lewat AI penglihatan, deskripsi masuk konteks, balasan menanggapi isi foto (reply ke fotonya), gambar tidak disimpan", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  r.tick(5 * MIN);
  r.setRnd(0.01);
  const res = photo(r, "Sari", { caption: "makan malam" });
  assert.equal(res.ok, true, JSON.stringify(res));
  r.setRnd(0.99);
  await settle(r);
  assert.equal(r.visionCalls.length, 1, "satu kali baca gambar");
  assert.deepEqual(r.visionCalls[0].image.buffer, IMG);
  assert.match(r.visionCalls[0].user, /makan malam/);
  assert.equal(r.sent.length, 1);
  assert.ok(r.sent[0].o.quoted, "reply ke fotonya");
  const prompt = r.aiCalls.at(-1).user;
  assert.match(prompt, /\[foto: Sepiring nasi goreng/);
  assert.match(prompt, /FOTO/);
  assert.match(prompt, /makan malam/, "keterangan ikut");
  // privasi: tidak ada gambar/deskripsi di penyimpanan
  const all = [...r.st.m.values()].join("\n");
  assert.ok(!/nasi goreng/i.test(all), "deskripsi tidak disimpan");
  assert.ok(!all.includes("gambar-palsu"), "gambar tidak disimpan");
  assert.equal(r.files.size, 0, "tidak ada berkas gambar");
});

await ok("gambar: sensitif / AI penglihatan gagal / jatah habis -> bot diam (tidak mengarang)", async () => {
  let r = rig({ visionOut: "SENSITIF" });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  r.tick(5 * MIN);
  r.setRnd(0.01);
  photo(r, "Sari");
  await settle(r);
  assert.equal(r.sent.length, 0, "gambar sensitif tidak dikomentari");
  r = rig({ visionFail: true });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  r.tick(5 * MIN);
  r.setRnd(0.01);
  photo(r, "Sari");
  await settle(r);
  assert.equal(r.sent.length, 0, "AI gagal: diam");
  r = rig({ env: { WA_LIHAT_PER_DAY: "1" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  r.tick(5 * MIN);
  r.setRnd(0.01);
  photo(r, "Sari");
  await settle(r);
  r.tick(20 * MIN);
  photo(r, "Rudi", { buf: Buffer.from("gambar-lain") });
  await settle(r);
  assert.equal(r.visionCalls.length, 1, "jatah 1×/hari: gambar kedua tidak dibaca");
});

await ok("gambar: orang yang menolak dibalas, mode bisu, dan suasana sedih tidak dibaca/dibalas", async () => {
  let r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  await r.h.handlePreference("main", JID, { name: "Sari", ids: ["id-Sari"], text: "bot jangan balas chatku ya" });
  r.tick(5 * MIN);
  r.setRnd(0.01);
  photo(r, "Sari");
  await settle(r);
  assert.equal(r.visionCalls.length, 0, "penolak tidak dibaca gambarnya");
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  await r.h.handle("diam 2 keluarga");
  chat(r);
  r.tick(5 * MIN);
  r.setRnd(0.01);
  photo(r, "Sari");
  await settle(r);
  assert.equal(r.sent.length, 0);
});

// ---------------------------------------------------------------- stiker
await ok("stiker: disimpan ke perpustakaan grup (berkas + indeks), diberi label sekali, masuk konteks sebagai [stiker: ...]", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  assert.equal(sticker(r, "Sari", STK(1)).ok, true);
  await settle(r);
  assert.equal(r.files.size, 1);
  const lib = r.h._debug.stickers()[`main|${JID}`];
  assert.equal(lib.length, 1);
  assert.equal(lib[0].tag, "tawa");
  assert.match(lib[0].desc, /kucing/);
  assert.equal(r.visionCalls.length, 1);
  const ctx = r.h._debug.ctxBuf.get(`main|${JID}`);
  assert.match(ctx.at(-1).text, /^\[stiker: kucing tertawa/);
  // stiker yang sama dikirim lagi: tidak diunduh ulang ke berkas baru, tidak dilabeli ulang
  sticker(r, "Budi", STK(1));
  await settle(r);
  assert.equal(r.files.size, 1);
  assert.equal(r.visionCalls.length, 1, "sudah berlabel: tidak memanggil AI lagi");
  assert.equal(r.h._debug.stickers()[`main|${JID}`][0].seen, 2);
  // indeks tersimpan, berkas stiker TIDAK masuk bot_state
  await r.h.check();
  const saved = JSON.parse(r.st.m.get(STIKER_KEY));
  assert.equal(saved[`main|${JID}`].length, 1);
  assert.ok(!r.st.m.get(STIKER_KEY).includes("stiker-palsu"), "isi stiker tidak ada di database");
});

await ok("stiker: dibalas stiker lain yang cocok (reply ke stikernya) dengan jeda; batas harian & jeda; tidak mengirim stiker yang sama", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  // perpustakaan awal: dua stiker lucu
  r.setRnd(0.99);
  sticker(r, "Budi", STK(1));
  await settle(r);
  sticker(r, "Rudi", STK(2));
  await settle(r);
  assert.equal(r.stickersSent.length, 0, "peluang tidak lolos");
  r.tick(15 * MIN);
  r.setRnd(0.01);
  const res = sticker(r, "Sari", STK(1)); // stiker yang sudah ada dikirim lagi -> balas dengan yang lain
  assert.equal(res.ok, true);
  await settle(r);
  assert.equal(r.stickersSent.length, 1);
  const s = r.stickersSent[0];
  assert.deepEqual(s.buffer, STK(2), "bukan stiker yang sama dengan yang diterima");
  assert.ok(s.o.quoted, "reply ke stiker anggota");
  // jeda 10 menit antar-stiker
  r.tick(2 * MIN);
  sticker(r, "Rudi", STK(2));
  await settle(r);
  assert.equal(r.stickersSent.length, 1, "masih dalam jeda");
  // jatah harian
  const r2 = rig({ env: { WA_STIKER_MAX_PER_DAY: "1", WA_STIKER_GAP_MIN: "1" } });
  await r2.h.load();
  await r2.h.handle("balas on keluarga");
  await r2.h.handle("lihat on keluarga");
  chat(r2);
  r2.setRnd(0.01);
  for (let i = 1; i <= 3; i += 1) {
    sticker(r2, "Budi", STK(i), { gap: 3 * MIN });
    await settle(r2);
  }
  sticker(r2, "Sari", STK(1), { gap: 3 * MIN });
  await settle(r2);
  sticker(r2, "Sari", STK(2), { gap: 3 * MIN });
  await settle(r2);
  assert.ok(r2.stickersSent.length <= 1, `jatah 1×/hari (${r2.stickersSent.length})`);
});

await ok("stiker: dibalas stiker bila stikernya me-reply bot (peluang tinggi); sedih/kesal, mode latihan, jam tidur, bisu -> tidak dikirim", async () => {
  const mk = async (over = {}, pre = async () => {}) => {
    const r = rig({ ...over });
    await r.h.load();
    await r.h.handle("balas on keluarga");
    await r.h.handle("lihat on keluarga");
    await pre(r);
    chat(r);
    r.setRnd(0.99);
    sticker(r, "Budi", STK(1));
    await settle(r);
    sticker(r, "Rudi", STK(2));
    await settle(r);
    r.tick(15 * MIN);
    r.setRnd(0.5);
    return r;
  };
  // me-reply bot: p=0.7 > 0.5
  let r = await mk();
  sticker(r, "Sari", STK(1), { repliedToBot: true });
  await settle(r);
  assert.equal(r.stickersSent.length, 1, "balasan ke bot dibalas stiker");
  // chat biasa (p=0.12 < 0.5): tidak
  r = await mk();
  sticker(r, "Sari", STK(1));
  await settle(r);
  assert.equal(r.stickersSent.length, 0);
  // suasana sedih
  r = await mk();
  text(r, "Sari", "aku lagi sedih banget hari ini ditinggal");
  sticker(r, "Sari", STK(1), { repliedToBot: true });
  await settle(r);
  assert.equal(r.stickersSent.length, 0, "suasana sedih: diam");
  // mode latihan
  r = await mk();
  await r.h.handle("latihan on keluarga");
  sticker(r, "Sari", STK(1), { repliedToBot: true });
  await settle(r);
  assert.equal(r.stickersSent.length, 0, "latihan: stiker tidak otomatis dikirim");
  // bisu
  r = await mk();
  await r.h.handle("diam 2 keluarga");
  sticker(r, "Sari", STK(1), { repliedToBot: true });
  await settle(r);
  assert.equal(r.stickersSent.length, 0);
  // jam tidur (bukan reply ke bot)
  r = await mk({ t0: T_2AM });
  sticker(r, "Sari", STK(1));
  await settle(r);
  assert.equal(r.stickersSent.length, 0, "jam tidur: tidak kirim stiker");
});

await ok("stiker: sensitif dibuang dari perpustakaan; penolak dibalas tidak disimpan; tanpa AI penglihatan tidak ada yang terjadi", async () => {
  let r = rig({ visionOut: "lain | SENSITIF" });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  sticker(r, "Sari", STK(9));
  await settle(r);
  assert.equal((r.h._debug.stickers()[`main|${JID}`] || []).length, 0);
  assert.equal(r.files.size, 0, "berkasnya juga dihapus");
  r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  await r.h.handlePreference("main", JID, { name: "Sari", ids: ["id-Sari"], text: "bot jangan balas chatku" });
  sticker(r, "Sari", STK(3));
  await settle(r);
  assert.equal(r.files.size, 0, "penolak: stikernya tidak disimpan");
  r = rig({ visionFail: true });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  sticker(r, "Sari", STK(4));
  await settle(r);
  assert.equal(r.stickersSent.length, 0, "stiker tanpa label tidak dipakai");
  assert.equal(r.visionCalls.length, 1);
});

await ok("perpustakaan penuh: stiker lama dibuang beserta berkasnya", async () => {
  const r = rig({ env: { WA_STIKER_MAX: "5" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  for (let i = 1; i <= 8; i += 1) {
    sticker(r, "Budi", STK(i), { gap: 11 * MIN });
    await settle(r);
  }
  assert.equal(r.h._debug.stickers()[`main|${JID}`].length, 5);
  assert.equal(r.files.size, 5, "berkas yang dibuang ikut terhapus");
});

await ok("label stiker: toleran pada gaya AI (**tebal**, 'Label: x | Deskripsi: y', dua baris, huruf besar)", () => {
  assert.deepEqual(parseStickerTag("**tawa** | kucing tertawa terbahak"), { tag: "tawa", desc: "kucing tertawa terbahak" });
  assert.deepEqual(parseStickerTag("Label: kaget | Deskripsi: kucing terkejut"), { tag: "kaget", desc: "kucing terkejut" });
  assert.deepEqual(parseStickerTag("Label: setuju\nDeskripsi: jempol terangkat"), { tag: "setuju", desc: "jempol terangkat" });
  assert.deepEqual(parseStickerTag("`senang` | anak kecil melompat"), { tag: "senang", desc: "anak kecil melompat" });
  assert.deepEqual(parseStickerTag("TAWA: orang ngakak"), { tag: "tawa", desc: "orang ngakak" });
  assert.deepEqual(parseStickerTag("tawa"), { tag: "tawa", desc: "" });
  assert.equal(parseStickerTag("Stiker ini menampilkan seekor kucing yang sedang tertawa").tag, "tawa", "kalimat bebas: label ditebak dari katanya");
  assert.equal(parseStickerTag("Seorang anak menangis sambil tertawa").tag, "sedih", "sedih diperiksa lebih dulu daripada ceria");
  assert.equal(parseStickerTag("Gambar kotak berwarna biru di latar putih"), null, "tanpa petunjuk perasaan: tidak ditebak");
  assert.equal(guessTagFromText("orang marah besar"), "kesal");
  assert.equal(parseStickerTag("lain | SENSITIF").sensitive, true);
  assert.equal(parseStickerTag("**SENSITIF**").sensitive, true);
});

await ok("stiker: bereaksi emoji sesuai label (tawa -> 😂); sedih/kesal tidak direaksi dan tidak dibalas teks", async () => {
  let r = rig({ env: { WA_REAKSI_CHANCE: "1", WA_REAKSI_GAP_SEC: "5" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  r.tick(5 * MIN);
  sticker(r, "Sari", STK(1));
  await settle(r);
  assert.deepEqual(r.reacts.map((x) => x.emoji), ["😂"]);
  r = rig({ env: { WA_REAKSI_CHANCE: "1", WA_REAKSI_GAP_SEC: "5" }, visionOut: "sedih | anak kecil menangis" });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  r.tick(5 * MIN);
  r.setRnd(0.01);
  sticker(r, "Sari", STK(1));
  await settle(r);
  assert.equal(r.reacts.length, 0, "stiker sedih tidak direaksi");
  assert.equal(r.sent.length, 0, "stiker sedih tidak ditanggapi teks");
  assert.equal(r.stickersSent.length, 0);
});

await ok("stiker: kadang ditanggapi satu kalimat (dengan makna stiker di prompt), reply ke stikernya", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  r.tick(5 * MIN);
  r.setRnd(0.01);
  sticker(r, "Sari", STK(1));
  await settle(r);
  assert.equal(r.sent.length, 1, "ditanggapi dengan kalimat");
  assert.ok(r.sent[0].o.quoted);
  const prompt = r.aiCalls.at(-1).user;
  assert.match(prompt, /\[stiker: kucing tertawa/);
  assert.match(prompt, /STIKER/);
  // peluang tidak lolos: diam
  const r2 = rig();
  await r2.h.load();
  await r2.h.handle("balas on keluarga");
  await r2.h.handle("lihat on keluarga");
  chat(r2);
  r2.tick(5 * MIN);
  sticker(r2, "Sari", STK(1));
  await settle(r2);
  assert.equal(r2.sent.length, 0);
});

await ok("/humor profil: menampilkan stiker terbaru yang sudah dibaca (label + deskripsi)", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  sticker(r, "Sari", STK(1));
  await settle(r);
  const prof = await r.h.handle("profil keluarga");
  assert.match(prof, /Stiker tersimpan: 1 \(berlabel 1\)/);
  assert.match(prof, /tawa: kucing tertawa terbahak/);
});

// stiker animasi WebP palsu: RIFF/WEBP + VP8X + ANIM + 2 bingkai ANMF
function animWebp() {
  const le = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const chunk = (id, data) => Buffer.concat([Buffer.from(id, "ascii"), le(data.length), data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  const frame = (payload) => chunk("ANMF", Buffer.concat([Buffer.alloc(16), chunk("VP8L", payload)]));
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), chunk("VP8X", Buffer.alloc(10)), chunk("ANIM", Buffer.alloc(6)), frame(Buffer.from("PERTAMA")), frame(Buffer.from("KEDUA"))]);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), le(body.length), body]);
}

await ok("stiker animasi: bingkai pertama diambil jadi WebP statis yang sah; stiker statis & bukan WebP tidak diubah", () => {
  const a = animWebp();
  const r = webpFirstFrame(a);
  assert.equal(r.animated, true);
  assert.equal(r.buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(r.buffer.toString("ascii", 8, 12), "WEBP");
  assert.equal(r.buffer.readUInt32LE(4), r.buffer.length - 8, "ukuran RIFF benar");
  assert.equal(r.buffer.toString("ascii", 12, 16), "VP8L");
  assert.equal(r.buffer.subarray(20, 27).toString(), "PERTAMA", "isi bingkai pertama, bukan kedua");
  assert.ok(!r.buffer.includes(Buffer.from("KEDUA")));
  const stat = Buffer.concat([Buffer.from("RIFF"), Buffer.from([8, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(4)]);
  assert.equal(webpFirstFrame(stat).buffer, stat);
  assert.equal(webpFirstFrame(stat).animated, false);
  const junk = Buffer.from("bukan webp sama sekali, hanya teks biasa");
  assert.equal(webpFirstFrame(junk).buffer, junk);
  assert.equal(webpFirstFrame(null).animated, false);
});

await ok("stiker animasi dikirim ke AI penglihatan hanya bingkai pertamanya, tapi berkas yang disimpan tetap asli", async () => {
  const r = rig();
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  const a = animWebp();
  sticker(r, "Sari", a);
  await settle(r);
  assert.equal(r.visionCalls.length, 1);
  assert.ok(r.visionCalls[0].image.buffer.length < a.length, "bingkai pertama saja");
  assert.ok(![...r.files.values()].some((b) => b.length !== a.length), "berkas yang disimpan = stiker asli (animasi tetap utuh)");
  assert.equal(r.h._debug.stickers()[`main|${JID}`][0].tag, "tawa");
});

await ok("pelabelan stiker gagal: alasan tampil di /humor profil; setelah 3 kali gagal berhenti mencoba (hemat jatah) lalu pulih bila berhasil", async () => {
  let mode = "error";
  const r = rig({ visionOut: () => { if (mode === "error") throw new Error("Gemini API error 400: bad"); if (mode === "ngawur") return "hmm entahlah"; return "tawa | kucing tertawa"; } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  chat(r);
  for (let i = 0; i < 5; i += 1) {
    sticker(r, "Sari", STK(1), { gap: MIN });
    await settle(r);
  }
  assert.equal(r.visionCalls.length, 3, "berhenti setelah 3 kali gagal");
  let prof = await r.h.handle("profil keluarga");
  assert.match(prof, /Stiker tersimpan: 1 \(berlabel 0\)/);
  assert.match(prof, /Pelabelan terakhir gagal: AI penglihatan gagal: Gemini API error 400/);
  // 6 jam kemudian boleh mencoba lagi; jawaban ngawur dicatat apa adanya
  r.tick(7 * 3_600_000);
  mode = "ngawur";
  sticker(r, "Sari", STK(1));
  await settle(r);
  prof = await r.h.handle("profil keluarga");
  assert.match(prof, /jawaban AI tidak bisa dibaca sebagai label: "hmm entahlah"/);
  r.tick(7 * 3_600_000);
  mode = "ok";
  sticker(r, "Sari", STK(1));
  await settle(r);
  prof = await r.h.handle("profil keluarga");
  assert.match(prof, /berlabel 1/);
  assert.ok(!/Pelabelan terakhir gagal/.test(prof), "pulih: peringatan hilang");
});

// ---------------------------------------------------------------- koleksi stiker pemilik + balas dengan stiker
const tagByBuf = (c) => {
  const t = c.image.buffer.toString();
  if (c.system.includes("STIKER")) return t.includes("sedih") ? "sedih | anak menangis" : t.includes("kaget") ? "kaget | kucing terkejut" : "tawa | kucing tertawa terbahak";
  return "Sepiring nasi goreng";
};
const KOL = { tawa: Buffer.from("koleksi-tawa-1"), tawa2: Buffer.from("koleksi-tawa-2"), kaget: Buffer.from("koleksi-kaget-1"), sedih: Buffer.from("koleksi-sedih-1") };

await ok("perintah /humor koleksi: daftar, hapus <no>, label <no> <label>", () => {
  assert.deepEqual(parseHumorArg("koleksi"), { kind: "koleksi", action: "list", account: null });
  assert.deepEqual(parseHumorArg("koleksi hapus 3"), { kind: "koleksi", action: "hapus", index: 3, account: null });
  assert.deepEqual(parseHumorArg("koleksi label 2 TAWA"), { kind: "koleksi", action: "label", index: 2, tag: "tawa", account: null });
  assert.equal(parseHumorArg("koleksi hapus").kind, "error");
  assert.equal(parseHumorArg("koleksi label 2").kind, "error");
  assert.equal(parseHumorArg("koleksi wa2").account, "wa2");
});

await ok("koleksi: stiker pemilik disimpan + dilabeli AI; duplikat dikenali; sensitif ditolak; penuh ditolak; tanpa AI tersimpan tanpa label", async () => {
  let r = rig({ visionOut: tagByBuf, env: { WA_KOLEKSI_MAX: "5" } });
  await r.h.load();
  const a = await r.h.addToKoleksi("main", KOL.tawa);
  assert.equal(a.ok, true);
  assert.equal(a.added, true);
  assert.equal(a.item.tag, "tawa");
  assert.equal(a.index, 1);
  assert.equal(r.files.size, 1);
  const dup = await r.h.addToKoleksi("main", KOL.tawa);
  assert.equal(dup.dup, true);
  assert.equal(dup.index, 1);
  assert.equal(r.files.size, 1);
  assert.equal(r.visionCalls.length, 1, "duplikat tidak dibaca ulang");
  // tersimpan di bot_state sebagai indeks (tanpa isi stiker)
  const saved = JSON.parse(r.st.m.get(STIKER_KEY));
  assert.equal(saved["koleksi|main"].length, 1);
  assert.ok(!r.st.m.get(STIKER_KEY).includes("koleksi-tawa"));
  // sensitif
  const r2 = rig({ visionOut: "lain | SENSITIF" });
  await r2.h.load();
  const bad = await r2.h.addToKoleksi("main", KOL.tawa);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /tidak pantas/);
  assert.equal(r2.files.size, 0);
  // penuh
  for (const k of ["tawa2", "kaget", "sedih"]) await r.h.addToKoleksi("main", KOL[k]);
  await r.h.addToKoleksi("main", Buffer.from("koleksi-lagi-5"));
  const full = await r.h.addToKoleksi("main", Buffer.from("koleksi-lagi-6"));
  assert.equal(full.ok, false);
  assert.match(full.reason, /penuh/);
  // tanpa AI penglihatan: tersimpan tanpa label + alasan
  const r3 = rig({ visionFail: true });
  await r3.h.load();
  const nl = await r3.h.addToKoleksi("main", KOL.tawa);
  assert.equal(nl.ok, true);
  assert.equal(nl.item.tag, "");
  assert.match(nl.labelErr, /AI penglihatan gagal/);
  const r4 = rig({ noMedia: true });
  await r4.h.load();
  assert.equal((await r4.h.addToKoleksi("main", KOL.tawa)).ok, false);
  // label manual saat menyimpan
  const r5 = rig({ visionFail: true });
  await r5.h.load();
  assert.equal((await r5.h.addToKoleksi("main", KOL.tawa, { label: "setuju" })).item.tag, "setuju");
});

await ok("koleksi: /humor koleksi menampilkan daftar, mengubah label, menghapus (berkas ikut terhapus); status menyebut jumlahnya", async () => {
  const r = rig({ visionOut: tagByBuf });
  await r.h.load();
  assert.match(await r.h.handle("koleksi"), /masih kosong[\s\S]*Pesan untuk diri sendiri/);
  await r.h.addToKoleksi("main", KOL.tawa);
  await r.h.addToKoleksi("main", KOL.kaget);
  const list = await r.h.handle("koleksi");
  assert.match(list, /1\. tawa — kucing tertawa terbahak/);
  assert.match(list, /2\. kaget — kucing terkejut/);
  assert.match(await r.h.handle("koleksi label 2 senang"), /berlabel "senang"/);
  assert.match(await r.h.handle("koleksi"), /2\. senang/);
  assert.match(await r.h.handle("koleksi label 9 tawa"), /tidak ada/);
  assert.match(await r.h.handle("koleksi label 1 ngawur"), /Label harus salah satu/);
  assert.match(await r.h.handle("koleksi hapus 1"), /dihapus/);
  assert.equal(r.files.size, 1);
  assert.match(await r.h.handle("koleksi"), /1\. senang/);
  assert.match(await r.h.handle(""), /Koleksi stiker .*: 1/);
});

await ok("koleksi nomor 2: kosong -> petunjuk menyalin; /humor koleksi wa2 salin [semua|nomor] menyalin dari nomor utama (label ikut, duplikat dilewati), lalu bisa dites ke grup", async () => {
  assert.deepEqual(parseHumorArg("koleksi wa2 salin semua"), { kind: "koleksi", action: "salin", indexes: null, account: "wa2" });
  assert.deepEqual(parseHumorArg("koleksi wa2 salin 1 3 1"), { kind: "koleksi", action: "salin", indexes: [1, 3], account: "wa2" });
  assert.deepEqual(parseHumorArg("koleksi salin"), { kind: "koleksi", action: "salin", indexes: null, account: null });
  assert.equal(parseHumorArg("koleksi wa2 salin abc").kind, "error");
  const r = rig({ visionOut: tagByBuf, second: true });
  await r.h.load();
  const kosong = await r.h.handle("koleksi wa2");
  assert.match(kosong, /masih kosong[\s\S]*\/humor koleksi wa2 salin semua/);
  assert.match(kosong, /juga masih kosong/, "koleksi utama juga kosong -> diberi tahu");
  assert.match(await r.h.handle("koleksi wa2 salin semua"), /tidak ada yang bisa disalin/);
  await r.h.addToKoleksi("main", KOL.tawa);
  await r.h.addToKoleksi("main", KOL.kaget);
  await r.h.addToKoleksi("main", KOL.sedih);
  assert.match(await r.h.handle("koleksi wa2 salin 9"), /Nomor 9 tidak ada/);
  assert.match(await r.h.handle("koleksi wa2 salin 2"), /1 stiker disalin dari .* ke .*Nomor 2.*sekarang 1 stiker/);
  assert.match(await r.h.handle("koleksi wa2"), /1\. kaget/);
  const lagi = await r.h.handle("koleksi wa2 salin semua");
  assert.match(lagi, /2 stiker disalin.*1 sudah ada.*sekarang 3 stiker/);
  assert.equal((await r.h.handle("koleksi")).includes("1. tawa"), true, "koleksi utama tidak berubah");
  const filesBefore = r.files.size;
  assert.equal(filesBefore, 6, "berkas koleksi utama (3) + salinan nomor 2 (3)");
  // uji kirim dari nomor 2 (grup milik nomor 2)
  const lib2 = await r.h.handle("koleksi wa2 tes keluarga");
  assert.ok(/terkirim|Stiker #/.test(lib2) || /Tidak ada grup/.test(lib2), lib2);
  // nomor 2 dimatikan di bot -> pesan jelas
  const r1 = rig({ visionOut: tagByBuf });
  await r1.h.load();
  await r1.h.addToKoleksi("main", KOL.tawa);
  assert.match(await r1.h.handle("koleksi wa2 salin semua"), /belum dinyalakan/);
});

await ok("/humor koleksi tes [nomor] <grup>: mengirim stiker koleksi ke grup walau jam tidur/jatah habis, tanpa memakai jatah", async () => {
  assert.deepEqual(parseHumorArg("koleksi tes keluarga"), { kind: "koleksi", action: "tes", index: null, target: "keluarga", account: null });
  assert.deepEqual(parseHumorArg("koleksi tes 2 keluarga"), { kind: "koleksi", action: "tes", index: 2, target: "keluarga", account: null });
  assert.equal(parseHumorArg("koleksi tes 1").target, "1"); // satu angka = nomor grup
  assert.equal(parseHumorArg("koleksi tes").kind, "error");
  const r = rig({ visionOut: tagByBuf });
  await r.h.load();
  assert.match(await r.h.handle("koleksi tes keluarga"), /masih kosong/);
  await r.h.addToKoleksi("main", KOL.tawa);
  await r.h.addToKoleksi("main", KOL.kaget);
  const out = await r.h.handle("koleksi tes 2 keluarga");
  assert.match(out, /Stiker #2 \(kaget\) terkirim ke "Keluarga/);
  assert.equal(r.stickersSent.length, 1);
  assert.deepEqual(r.stickersSent[0].buffer, KOL.kaget);
  assert.match(await r.h.handle("koleksi tes 9 keluarga"), /tidak ada di koleksi/);
  assert.match(await r.h.handle("koleksi tes grupgaib"), /Tidak ada grup/);
  assert.equal(r.stickersSent.length, 1);
  await r.h.handle("koleksi tes keluarga");
  assert.equal(r.stickersSent.length, 2, "tanpa nomor = pilih acak");
});

await ok("balas dengan stiker: AI memilih 'STIKER: tawa' -> stiker dari koleksi (reply ke pesannya), tanpa perlu /humor lihat; teks+stiker juga bisa", async () => {
  const mk = async (aiOut, env = {}) => {
    const r = rig({ aiOut, visionOut: tagByBuf, env });
    await r.h.load();
    await r.h.handle("balas on keluarga"); // lihat TIDAK dinyalakan
    await r.h.addToKoleksi("main", KOL.tawa);
    await r.h.addToKoleksi("main", KOL.kaget);
    chat(r);
    r.tick(5 * MIN);
    r.setRnd(0.01);
    text(r, "Sari", "akhirnya gajian hari ini senang banget nih rasanya");
    r.setRnd(0.99);
    await settle(r);
    return r;
  };
  let r = await mk("STIKER: tawa");
  assert.equal(r.stickersSent.length, 1);
  assert.deepEqual(r.stickersSent[0].buffer, KOL.tawa);
  assert.ok(r.stickersSent[0].o.quoted, "stiker saja: reply ke pesannya");
  assert.equal(r.sent.length, 0, "tidak ada teks");
  assert.match(r.aiCalls.at(-1).system, /STIKER: <label>, label dari: tawa, kaget/, "AI diberi tahu label yang tersedia (hanya yang ada di koleksi)");
  r = await mk("Wah selamat ya, mantap!\nSTIKER: tawa");
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0].text, /selamat/);
  assert.equal(r.stickersSent.length, 1);
  assert.equal(r.stickersSent[0].o.quoted, undefined, "teks + stiker: stikernya menyusul tanpa reply ganda");
  // label yang tidak ada di koleksi / sedih: stiker tidak dikirim
  r = await mk("STIKER: semangat");
  assert.equal(r.stickersSent.length, 0);
  r = await mk("STIKER: sedih");
  assert.equal(r.stickersSent.length, 0);
  // batas harian
  r = await mk("STIKER: tawa", { WA_STIKER_MAX_PER_DAY: "-1" });
  assert.equal(r.stickersSent.length, 0);
  assert.ok(!/STIKER: </.test(r.aiCalls.at(-1)?.system || ""), "jatah 0: AI tidak ditawari stiker");
});

await ok("balas dengan stiker: tidak ditawarkan saat tanpa koleksi, mode latihan, bisu, jam tidur, atau suasana sedih", async () => {
  const mk = async (opt = {}) => {
    const r = rig({ aiOut: "STIKER: tawa", visionOut: tagByBuf, t0: opt.t0 });
    await r.h.load();
    await r.h.handle("balas on keluarga");
    if (!opt.empty) await r.h.addToKoleksi("main", KOL.tawa);
    if (opt.latihan) await r.h.handle("latihan on keluarga");
    if (opt.diam) await r.h.handle("diam 2 keluarga");
    const people = ["Budi", "Sari", "Rudi"];
    for (const n of people) text(r, n, opt.t0 ? "belum tidur juga nih ada yang bangun gak" : "tadi siang makan apa nih kalian");
    text(r, "Budi", opt.t0 ? "wah iya skornya lagi ketat banget malam ini" : "aku makan soto ayam enak banget");
    if (opt.sedih) text(r, "Sari", "aku lagi sedih banget hari ini ditinggal");
    r.tick(5 * MIN);
    r.setRnd(0.01);
    text(r, "Rudi", opt.sedih ? "turut sedih ya semoga cepat membaik" : "akhirnya gajian hari ini senang banget nih rasanya");
    r.setRnd(0.99);
    await settle(r);
    return r;
  };
  for (const opt of [{ empty: true }, { latihan: true }, { diam: true }, { t0: T_2AM }, { sedih: true }]) {
    const r = await mk(opt);
    assert.equal(r.stickersSent.length, 0, `tanpa stiker: ${JSON.stringify(opt)}`);
    if (r.aiCalls.length) assert.ok(!/STIKER: </.test(r.aiCalls.at(-1).system), `AI tidak ditawari stiker: ${JSON.stringify(opt)}`);
  }
});

await ok("balas stiker orang: memakai koleksi pemilik walau grup belum punya stiker sendiri", async () => {
  const r = rig({ random: undefined, visionOut: tagByBuf });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.handle("lihat on keluarga");
  await r.h.addToKoleksi("main", KOL.tawa2);
  chat(r);
  r.tick(15 * MIN);
  r.setRnd(0.01);
  sticker(r, "Sari", STK(7)); // dibaca "tawa" -> dibalas stiker dari koleksi
  await settle(r);
  assert.equal(r.stickersSent.length, 1);
  assert.deepEqual(r.stickersSent[0].buffer, KOL.tawa2);
  assert.ok(r.stickersSent[0].o.quoted);
});

await ok("koleksi: pemakaian dicatat dan stiker tidak diulang beruntun", async () => {
  const r = rig({ aiOut: "STIKER: tawa", visionOut: tagByBuf, env: { WA_STIKER_GAP_MIN: "1" } });
  await r.h.load();
  await r.h.handle("balas on keluarga");
  await r.h.addToKoleksi("main", KOL.tawa);
  await r.h.addToKoleksi("main", KOL.tawa2);
  const used = [];
  for (let i = 0; i < 2; i += 1) {
    chat(r);
    r.tick(5 * MIN);
    r.setRnd(0.01);
    text(r, "Sari", `akhirnya gajian hari ini senang banget nih rasanya ${i}`);
    r.setRnd(0.99);
    await settle(r);
    r.tick(30 * MIN);
  }
  assert.equal(r.stickersSent.length, 2);
  assert.notDeepEqual(r.stickersSent[0].buffer, r.stickersSent[1].buffer, "stiker bergantian");
  assert.match(await r.h.handle("koleksi"), /dipakai 1×/);
  void used;
});

await ok("koleksi kosong: menyebut jalur cadangan Telegram + info diagnosa penerimaan stiker dari WhatsApp", async () => {
  const r = rig({ visionOut: tagByBuf });
  await r.h.load();
  const t = await r.h.handle("koleksi");
  assert.match(t, /Telegram/);
});

await ok("Telegram: stiker dari pemilik masuk koleksi; stiker animasi ditolak sopan; bukan pemilik diabaikan", async () => {
  const sent = [];
  const added = [];
  const f = async (url, init) => {
    const method = String(url).split("/").pop();
    if (String(url).includes("/file/bot")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6]).buffer };
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (method === "sendMessage") sent.push(body.text);
    if (method === "getFile") return { status: 200, json: async () => ({ ok: true, result: { file_path: "stickers/a.webp" } }) };
    return { status: 200, json: async () => ({ ok: true, result: true }) };
  };
  const quiet = { log() {}, warn() {}, error() {} };
  const tg = createTelegram({
    config: { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true },
    deps: { chat: async () => "x", stickers: { add: async (b) => { added.push(b.length); return { ok: true, added: true, index: added.length, item: { tag: "tawa" } }; } } },
    fetchImpl: f, log: quiet, sleep: async () => {}
  });
  const upd = (chat, sticker) => ({ update_id: 1, message: { chat: { id: chat, type: "private" }, sticker } });
  await tg.handleUpdate(upd(111, { file_id: "S1", is_animated: false, is_video: false }));
  assert.deepEqual(added, [10]);
  assert.ok(sent.some((t) => /Stiker tersimpan di koleksi \(#1\): tawa/.test(t)), sent.join("|"));
  await tg.handleUpdate(upd(111, { file_id: "S2", is_animated: true }));
  assert.equal(added.length, 1);
  assert.ok(sent.some((t) => /animasi/.test(t)));
  await tg.handleUpdate(upd(999, { file_id: "S3" }));
  assert.equal(added.length, 1);
});

// ---------------------------------------------------------------- integrasi
await ok("terintegrasi: index.js (gambar/stiker/AI penglihatan), dokumentasi, .env.example, package.json", () => {
  const idx = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(idx, /humor\.observeMedia\(/);
  assert.match(idx, /media:\s*humorMedia/);
  assert.match(idx, /sendMessage\(jid, \{ sticker:/);
  assert.match(idx, /inline_data/);
  assert.match(idx, /addOwnerSticker\(/);
  assert.match(idx, /stk && isSelfChat/);
  assert.match(idx, /botStickerIds/);
  assert.match(idx, /type !== "append"/, "stiker bertipe append ikut diproses");
  assert.match(idx, /deviceSentMessage\?\.message/);
  assert.match(idx, /stickerIntakeInfo/);
  assert.match(idx, /stickers: \{\s*add:/);
  const readme = fs.readFileSync(new URL("./README.md", import.meta.url), "utf8");
  assert.match(readme, /Jam tidur/i);
  assert.match(readme, /\/humor lihat on/);
  assert.match(readme, /Koleksi stiker/);
  assert.match(readme, /Pesan untuk diri sendiri/);
  const env = fs.readFileSync(new URL("./.env.example", import.meta.url), "utf8");
  for (const k of ["WA_JAM_TIDUR", "WA_LIHAT_PER_DAY", "WA_STIKER_CHANCE", "WA_STIKER_MAX_PER_DAY", "WA_KOLEKSI_MAX", "WA_STIKER_DARI_PEMILIK"]) assert.match(env, new RegExp(k));
  const pkg = fs.readFileSync(new URL("./package.json", import.meta.url), "utf8");
  assert.match(pkg, /test-visual\.mjs/);
});

console.log(`\nSemua ${n} kelompok tes melihat & jam tidur lulus.`);
