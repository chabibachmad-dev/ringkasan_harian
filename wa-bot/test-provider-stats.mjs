// Tes statistik penyedia AI (/penyedia): provider-stats.js + perintah Telegram.
//   node test-provider-stats.mjs
import { createProviderStats, parseProviderCommand, scrubError, relativeTime } from "./provider-stats.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };

// ---- parser
{
  check(parseProviderCommand("/penyedia")?.reset === false, "parse: /penyedia");
  check(parseProviderCommand("/Penyedia reset")?.reset === true && parseProviderCommand("/provider ulang")?.reset === true, "parse: reset / alias provider");
  check(parseProviderCommand("penyedia") === null && parseProviderCommand("/penyediaan") === null, "parse: bukan perintah bila tak diawali /penyedia");
}

// ---- pembersih galat
{
  const s = scrubError("401: Incorrect API key AIzaSyA1234567890abcdefghij dan gsk_abcdefghijklmnop serta sk-or-v1-abcdefghijklmnop");
  check(!s.includes("AIza") && !s.includes("gsk_abcdef") && !s.includes("sk-or-v1-abc"), "scrub: key Gemini/Groq/OpenRouter dibuang dari galat");
  check(scrubError("a".repeat(500)).length <= 140 && !scrubError("x".repeat(40)).includes("xxxx"), "scrub: dipotong dan string panjang acak disamarkan");
  check(scrubError("baris\nbaru   ganda") === "baris baru ganda", "scrub: spasi/baris baru dirapikan");
}

// ---- waktu relatif
{
  const t = 1_000_000_000;
  check(relativeTime(t - 10_000, t) === "baru saja" && relativeTime(t - 5 * 60_000, t) === "5 mnt lalu" && relativeTime(t - 125 * 60_000, t) === "2 jam 5 mnt lalu", "relativeTime: baru saja / menit / jam");
}

// ---- pencatatan & ikon
{
  let t = 1_700_000_000_000;
  const st = createProviderStats({ now: () => t });
  check(st.format().includes("Belum ada penyedia"), "format: kosong -> pesan ramah");

  st.record({ provider: "gemini", kind: "error", error: "HTTP 503" });
  for (let i = 0; i < 9; i++) st.record({ provider: "gemini", kind: "success", model: "gemini-x", keyHint: "AAAA" });
  t += 120_000;
  let snap = st.snapshot().find((x) => x.name === "gemini");
  check(snap.ok === 9 && snap.fail === 1 && snap.health === "ok", "gemini: 9 ok + 1 gagal = lancar");

  st.record({ provider: "groq", kind: "success", model: "llama" });
  st.record({ provider: "groq", kind: "exhausted", keyHint: "BBBB", untilMs: t + 3_600_000, error: "429 Too Many Requests sk-or-v1-abcdefghijklmnopqrstuv" });
  snap = st.snapshot().find((x) => x.name === "groq");
  check(snap.health === "warn" && snap.resting.length === 1, "groq: gagal terakhir -> kuning, 1 key istirahat");

  for (let i = 0; i < 3; i++) st.record({ provider: "openrouter", kind: "error", error: "timeout" });
  check(st.snapshot().find((x) => x.name === "openrouter").health === "down", "openrouter: 3 gagal beruntun -> merah");

  st.record({ provider: "groq", kind: "success", model: "llama", keyHint: "BBBB" });
  check(st.snapshot().find((x) => x.name === "groq").resting.length === 0, "groq: berhasil lagi -> status istirahat key itu dihapus");

  st.record({ provider: "foo", kind: "bukan-jenis" });
  st.record({ provider: "", kind: "success" });
  st.record(null);
  check(!st.snapshot().some((x) => x.name === "foo" || x.name === ""), "record: kejadian tak valid diabaikan tanpa error");

  const text = st.format({ configured: ["gemini", "groq", "openrouter", "ollama"], formatClock: () => "14:05 WITA" });
  check(text.includes("🟢 Gemini — 9 berhasil, 1 gagal") && text.includes("🔴 OpenRouter") && text.includes("⚪ Ollama — belum dipakai"), "format: ikon, hitungan, dan penyedia yang diatur tapi belum dipakai");
  check(text.indexOf("Gemini") < text.indexOf("Groq") && text.indexOf("Groq") < text.indexOf("OpenRouter") && text.indexOf("OpenRouter") < text.indexOf("Ollama"), "format: urutan Gemini, Groq, OpenRouter, Ollama");
  check(!/sk-or-v1/.test(text) && !/AIza/.test(text), "format: tidak membocorkan key");
  check(text.includes("terakhir berhasil 2 mnt lalu (gemini-x)"), "format: waktu & model berhasil terakhir");

  st.record({ provider: "groq", kind: "rejected", keyHint: "CCCC", untilMs: t + 3_600_000, error: "401" });
  check(st.format({ formatClock: () => "14:05 WITA" }).includes("⏳ 1 key istirahat, yang terdekat pulih 14:05 WITA"), "format: key istirahat + jam pulih");

  // jendela: hanya N kejadian terakhir yang menentukan ikon
  const w = createProviderStats({ now: () => t, recent: 5 });
  for (let i = 0; i < 5; i++) w.record({ provider: "ollama", kind: "error", error: "x" });
  for (let i = 0; i < 5; i++) w.record({ provider: "ollama", kind: "success" });
  const ws = w.snapshot()[0];
  check(ws.recentTotal === 5 && ws.recentOk === 5 && ws.health === "ok" && ws.fail === 5, "jendela: ikon dinilai dari kejadian terbaru, total tetap utuh");

  st.reset();
  check(st.snapshot().length === 0, "reset: statistik kosong lagi");
}

// ---- Telegram /penyedia
{
  const sent = [];
  const f = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    if (method === "sendMessage") sent.push(body.text);
    return { status: 200, json: async () => ({ ok: true, result: method === "getMe" ? { username: "b" } : { message_id: 1 } }) };
  };
  const cfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const calls = [];
  const providers = { report: (o) => { calls.push(o); return o.reset ? "RESET-OK" : "LAPORAN"; } };
  const tg = createTelegram({ config: cfg, deps: { chat: async () => "ai-biasa", providers }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/penyedia");
  await tg.handleOwnerText("111", "/penyedia reset");
  check(sent[0] === "LAPORAN" && sent[1] === "RESET-OK" && calls[0].reset === false && calls[1].reset === true, "telegram: /penyedia dan /penyedia reset");
  const none = createTelegram({ config: cfg, deps: { chat: async () => "x" }, fetchImpl: f, log: silent });
  await none.handleOwnerText("111", "/penyedia");
  check(sent[2].includes("belum tersedia"), "telegram: tanpa modul -> pesan ramah, bukan galat");
  const boom = createTelegram({ config: cfg, deps: { chat: async () => "x", providers: { report: () => { throw new Error("rusak"); } } }, fetchImpl: f, log: silent });
  await boom.handleOwnerText("111", "/penyedia");
  check(sent[3].includes("gagal dibuat") && sent[3].includes("rusak"), "telegram: galat modul dilaporkan, tidak menjatuhkan bot");
  await tg.handleOwnerText("999", "/penyedia").catch(() => {});
  check(!sent.some((t) => t === "LAPORAN" && sent.indexOf(t) > 1), "telegram: bukan pemilik tidak mendapat laporan");
}

console.log(fails === 0 ? "\nSemua tes provider-stats lulus." : `\n${fails} tes provider-stats GAGAL.`);
process.exit(fails === 0 ? 0 : 1);
