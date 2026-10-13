// Tes suara WhatsApp (wa-voice.js): konfigurasi, deteksi audio, sesi tutor /speak untuk pemilik.
//   node test-wa-voice.mjs
import { audioOf, createWaTutor, parseSpeakArg, readWaVoiceConfig } from "./wa-voice.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };

// ---- konfigurasi
{
  const d = readWaVoiceConfig({});
  check(d.speakMaxTurns === 30 && d.speakIdleMin === 60 && d.fromOthers === true && d.inGroups === true, "config: bawaan");
  const c = readWaVoiceConfig({ WA_SPEAK_MAX_TURNS: "999", WA_SPEAK_IDLE_MIN: "1", WA_VOICE_FROM_OTHERS: "false", WA_VOICE_IN_GROUPS: "off" });
  check(c.speakMaxTurns === 100 && c.speakIdleMin === 5 && c.fromOthers === false && c.inGroups === false, "config: dibatasi, false/off mematikan");
}

// ---- audioOf
{
  const a = audioOf({ audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 7, fileLength: "12345", ptt: true } });
  check(a && a.mime === "audio/ogg" && a.seconds === 7 && a.bytes === 12345, "audioOf: mime tanpa parameter, detik, ukuran");
  check(audioOf({ conversation: "halo" }) === null && audioOf(null) === null, "audioOf: bukan audio -> null");
  check(audioOf({ audioMessage: {} }).mime === "audio/ogg", "audioOf: mime bawaan");
}

// ---- /speak argumen
{
  check(JSON.stringify(parseSpeakArg("")) === '{"lang":"en","topic":""}', "speak: kosong = Inggris tanpa topik");
  check(JSON.stringify(parseSpeakArg("id soal liburan")) === '{"lang":"id","topic":"soal liburan"}', "speak: id + topik");
  check(JSON.stringify(parseSpeakArg("ordering coffee")) === '{"lang":"en","topic":"ordering coffee"}', "speak: topik Inggris");
}

// ---- sesi tutor
function harness({ speak = async () => ({ ogg: Buffer.from("ogg-data") }), tutor, voiceCheck = async () => ({ ok: true }), maxTurns = 30, clock, cfgOver = {} } = {}) {
  const sent = [];
  const voices = [];
  const busy = [];
  const io = { send: async (t) => { sent.push(t); }, voice: async (b) => { voices.push(b.length); }, busy: (k) => { busy.push(k); return () => busy.push(`stop:${k}`); } };
  const calls = [];
  const t = tutor ?? (async (a) => { calls.push(a); return { reply: a.userText ? `Nice, ${a.userText}` : "Hello! What did you do today?", correction: a.userText ? "I go -> I went" : "", tip: "" }; });
  const tutorFn = async (a) => { calls.push(a); return t(a); };
  const w = createWaTutor({ tutor: tutorFn, speak, voiceCheck, hasTranscriber: true, config: { speakMaxTurns: maxTurns, speakIdleMin: 60, speakText: true, ...cfgOver }, log: quiet, now: clock });
  return { w, sent, voices, busy, io, calls };
}
const J = "628111@s.whatsapp.net";

{
  const h = harness();
  check((await h.w.handle(J, "halo apa kabar", h.io)) === false, "tutor: tanpa sesi, teks biasa bukan urusan tutor");
  check((await h.w.handle(J, "/ringkasan", h.io)) === false, "tutor: perintah lain dilewatkan");
  check((await h.w.handle(J, "/speak ordering coffee", h.io)) === true && h.w.active(J), "tutor: /speak memulai sesi");
  check(h.sent[0].includes("Mode Speaking aktif") && h.sent[0].includes("ordering coffee"), "tutor: pesan pembuka memuat topik");
  check(h.sent.some((t) => t.includes("Hello!")) && h.voices.length === 1, "tutor: sapaan pertama dikirim teks + voice note");
  check(h.calls[0].topic === "ordering coffee" && h.calls[0].lang === "en", "tutor: topik & bahasa diteruskan");
  check(JSON.stringify(h.w.sttOptions(J).language) === '"en"', "tutor: STT mengikuti sesi (en)");
  check((await h.w.handle(J, "I go to cafe yesterday", h.io)) === true, "tutor: selama sesi, teks = ucapan untuk tutor");
  check(h.sent.at(-1).includes("✏️") || h.sent.some((t) => t.includes("I go -> I went")), "tutor: koreksi ikut dikirim");
  check(h.voices.length === 2, "tutor: tiap giliran dibalas voice note");
  check(h.busy.includes("typing") && h.busy.includes("voice") && h.busy.filter((x) => x.startsWith("stop:")).length >= 2, "tutor: indikator mengetik/merekam dinyalakan lalu dimatikan");
  check((await h.w.handle(J, "/selesai", h.io)) === true && !h.w.active(J) && h.sent.at(-1).includes("Sesi Speaking selesai"), "tutor: /selesai mengakhiri");
  check(h.w.sttOptions(J) === null, "tutor: tanpa sesi tidak ada pilihan STT khusus");
  check((await h.w.handle(J, "/selesai", h.io)) === true && h.sent.at(-1).includes("Tidak ada sesi"), "tutor: /selesai tanpa sesi -> pemberitahuan");
}
{
  const h = harness();
  await h.w.handle(J, "/speak id soal liburan", h.io);
  check(h.w.sttOptions(J).language === "id", "tutor id: STT bahasa Indonesia");
  await h.w.handle(J, "Aku baru pulang dari Bali", h.io);
  check(!h.sent.some((t) => t.includes("✏️")), "tutor id: tanpa koreksi");
  await h.w.handle(J, "Oke sampai jumpa ya", h.io);
  check(!h.w.active(J) && h.sent.at(-1).includes("Sesi ngobrol selesai"), "tutor id: ucapan pamit mengakhiri sesi");
}
{
  const h = harness();
  await h.w.handle(J, "/speak", h.io);
  await h.w.handle(J, "Goodbye, see you tomorrow", h.io);
  check(!h.w.active(J), "tutor en: goodbye mengakhiri sesi setelah balasan penutup");
  check(h.calls.at(-1).farewell === true, "tutor en: model diminta menutup dengan salam");
}
{
  const h = harness({ maxTurns: 3 });
  await h.w.handle(J, "/speak", h.io);
  for (let i = 0; i < 3; i++) await h.w.handle(J, `sentence ${i}`, h.io);
  check(!h.w.active(J) && h.sent.at(-1).includes("Batas 3 giliran"), "tutor: batas giliran mengakhiri sesi");
}
{
  let t = 1_000_000;
  const h = harness({ clock: () => t });
  await h.w.handle(J, "/speak", h.io);
  t += 61 * 60_000;
  check(h.w.active(J) === false && (await h.w.handle(J, "hello again", h.io)) === false, "tutor: kedaluwarsa setelah diam > 60 menit");
}
{
  // suara gagal -> tetap teks, pemberitahuan hanya sekali
  const quota = Object.assign(new Error("habis"), { quota: true });
  const h = harness({ speak: async () => { throw quota; } });
  await h.w.handle(J, "/speak", h.io);
  await h.w.handle(J, "I like tea", h.io);
  await h.w.handle(J, "And coffee", h.io);
  const notes = h.sent.filter((t) => t.includes("Kuota suara Gemini"));
  check(notes.length === 1 && h.voices.length === 0, "suara: kuota habis -> teks saja, pemberitahuan sekali");
  const ff = harness({ speak: async () => { throw Object.assign(new Error("ffmpeg belum terpasang."), { code: "ffmpeg" }); } });
  await ff.w.handle(J, "/speak", ff.io);
  check(ff.sent.some((t) => t.includes("sudo apt install ffmpeg")), "suara: ffmpeg hilang -> petunjuk pasang");
  const vc = harness({ voiceCheck: async () => ({ ok: false, reason: "ffmpeg belum terpasang" }) });
  await vc.w.handle(J, "/speak", vc.io);
  check(vc.sent[0].includes("Suara tutor belum bisa dibuat"), "suara: voiceCheck gagal -> dicantumkan di pembuka");
}
{
  // model gagal -> pesan galat, sesi tetap hidup untuk dicoba lagi
  let n = 0;
  const h = harness({ tutor: async (a) => { if (a.userText && n++ === 0) throw new Error("kuota"); return { reply: "ok", correction: "", tip: "" }; } });
  await h.w.handle(J, "/speak", h.io);
  await h.w.handle(J, "first try", h.io);
  check(h.w.active(J) && h.sent.at(-1).includes("gagal membalas"), "tutor: galat model -> pemberitahuan, sesi tetap hidup");
  await h.w.handle(J, "second try", h.io);
  check(h.sent.at(-1).includes("ok"), "tutor: percobaan berikutnya berhasil");
  const none = createWaTutor({ tutor: null, config: { speakMaxTurns: 30, speakIdleMin: 60 }, log: quiet });
  const s = [];
  await none.handle(J, "/speak", { send: async (t) => { s.push(t); } });
  check(s[0].includes("belum tersedia") && !none.active(J), "tutor: tanpa AI -> belum tersedia");
}
{
  // sesi terpisah per chat
  const h = harness();
  await h.w.handle(J, "/speak", h.io);
  check(h.w.active(J) && !h.w.active("628999@s.whatsapp.net"), "tutor: sesi per chat");
}

// ---- suara saja (bawaan): tanpa teks balasan & tanpa echo; teks hanya sebagai cadangan
{
  const h = harness({ cfgOver: { speakText: false } });
  await h.w.handle(J, "/speak ordering coffee", h.io);
  check(h.sent.length === 1 && h.sent[0].includes("Mode suara saja") && h.voices.length === 1, "suara-saja: hanya pembuka + 1 voice (tanpa teks sapaan)");
  check(h.w.showText(J) === false, "suara-saja: transkrip tidak di-echo");
  await h.w.handle(J, "I go to cafe yesterday", h.io);
  check(h.sent.length === 1 && h.voices.length === 2, "suara-saja: giliran dibalas voice saja, tanpa teks");
  await h.w.handle(J, "/koreksi", h.io);
  check(h.sent.at(-1).includes("I go -> I went"), "suara-saja: /koreksi menampilkan koreksi terakhir");
  await h.w.handle(J, "/teks on", h.io);
  check(h.w.showText(J) === true && h.sent.at(-1).includes("juga ditulis"), "suara-saja: /teks on menyalakan teks");
  const n = h.sent.length;
  await h.w.handle(J, "next", h.io);
  check(h.sent.length === n + 1 && h.voices.length === 3, "teks on: teks + voice");
  await h.w.handle(J, "/teks", h.io);
  check(h.w.showText(J) === false, "/teks tanpa argumen = bolak-balik");
  await h.w.handle(J, "/selesai", h.io);
  await h.w.handle(J, "/koreksi", h.io);
  check(h.sent.at(-1).includes("Tidak ada sesi"), "/koreksi tanpa sesi -> pemberitahuan");
}
{
  const h = harness({ cfgOver: { speakText: false }, speak: async () => { throw Object.assign(new Error("habis"), { quota: true }); } });
  await h.w.handle(J, "/speak", h.io);
  check(h.sent.some((t) => t.includes("Hello!")), "suara-saja: suara gagal -> teks sapaan jadi cadangan");
  await h.w.handle(J, "I go to cafe yesterday", h.io);
  check(h.sent.some((t) => t.includes("✏️")), "suara-saja: suara gagal -> teks + koreksi jadi cadangan");
}
{
  check(readWaVoiceConfig({}).speakText === false && readWaVoiceConfig({ WA_SPEAK_TEXT: "true" }).speakText === true, "config: WA_SPEAK_TEXT");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
