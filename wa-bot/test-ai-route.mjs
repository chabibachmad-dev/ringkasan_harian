// Tes urutan AI dua jalur (ai-route.js) + batas waktu/percobaan per panggilan di llm-fallback.js.  node test-ai-route.mjs
import { DEFAULT_ROUTES, classifyRoute, createAiRoute, normalizeOrder, parseOrderText, parseRouteCommand } from "./ai-route.js";
import { createFallbackChain, readFallbackConfig } from "./llm-fallback.js";

let fails = 0;
const check = (c, m) => {
  if (!c) {
    fails++;
    console.log("FAIL:", m);
  } else console.log("ok:", m);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const silent = { warn() {}, log() {}, error() {} };

// ---- normalisasi & parsing
check(same(normalizeOrder(["Groq", "gemini", "groq", "x", "ollama", "openrouter"]), ["groq", "gemini", "openrouter", "ollama"]), "normalizeOrder: huruf kecil, tanpa duplikat, nama asing dibuang, Ollama ke ujung");
check(same(normalizeOrder(null), []), "normalizeOrder: bukan array -> kosong");
{
  const r = parseOrderText("gemini > groq, ollama openrouter");
  check(same(r.order, ["gemini", "groq", "openrouter", "ollama"]) && r.movedOllama && r.unknown.length === 0, "parseOrderText: pemisah campur, Ollama dipindah ke akhir & ditandai");
  const r2 = parseOrderText("groq, bard");
  check(r2.unknown.join() === "bard", "parseOrderText: nama tidak dikenal dilaporkan");
  const r3 = parseOrderText("groq,gemini,ollama");
  check(!r3.movedOllama, "parseOrderText: Ollama sudah di akhir -> tidak ditandai dipindah");
}

// ---- klasifikasi jalur
const RE = /\d|\b(tarif|biaya|harga|berapa|pmk|sbm|aturan|peraturan|anggaran)\b|%/i;
check(classifyRoute({ text: "Belajar kau ya sm suhu @268813530575034", accurateRe: RE }) === "santai", "obrolan dengan mention (angka ID) tetap santai");
check(classifyRoute({ text: "jgn ngambek kau", accurateRe: RE }) === "santai", "obrolan biasa -> santai");
check(classifyRoute({ text: "Eh ada yg terbaru tuh. KMK 278 2021", accurateRe: RE }) === "akurat", "menyebut peraturan/angka -> akurat");
check(classifyRoute({ text: "halo", webQuery: "aturan ppspm" , accurateRe: RE }) === "akurat", "butuh pencarian web -> akurat");
check(classifyRoute({ text: "halo", docChunks: 2, accurateRe: RE }) === "akurat", "ada potongan dokumen -> akurat");
check(classifyRoute({ text: "halo", pinnedDocs: true, accurateRe: RE }) === "akurat", "grup dokumen terkunci -> akurat");
check(classifyRoute({ text: "tarif berapa?", accurateRe: RE }) === "akurat", "kata kunci tarif/berapa -> akurat");

// ---- perintah
check(parseRouteCommand("/urutan")?.arg === "" && parseRouteCommand("/urutan santai groq,gemini")?.arg === "santai groq,gemini", "parseRouteCommand: /urutan dengan & tanpa argumen");
check(parseRouteCommand("/route reset")?.arg === "reset" && parseRouteCommand("!urutan")?.arg === "", "parseRouteCommand: alias /route dan awalan !");
check(parseRouteCommand("urutan") === null && parseRouteCommand("/urutanku") === null, "parseRouteCommand: bukan perintah -> null");

// ---- pengaturan + penyimpanan
const store = new Map();
const state = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) };
const avail = { groq: true, gemini: true, openrouter: false, ollama: true };
{
  const r = createAiRoute({ state, available: (n) => avail[n], log: silent });
  await r.load();
  check(same(r.orderFor("santai"), DEFAULT_ROUTES.santai) && same(r.orderFor("akurat"), DEFAULT_ROUTES.akurat), "bawaan: santai=Groq>Gemini>OpenRouter>Ollama, akurat=Gemini>Groq>OpenRouter>Ollama");
  check(r.orderFor("tidak-ada").join() === DEFAULT_ROUTES.akurat.join(), "jalur tak dikenal diperlakukan sebagai akurat (aman)");
  const show = await r.handle("");
  check(/santai/.test(show) && /akurat/.test(show) && /belum aktif \(dilewati\): openrouter/.test(show), "/urutan tanpa isi: tampil kedua jalur + penyedia yang belum aktif");
  const a = await r.handle("santai gemini,groq");
  check(same(r.orderFor("santai"), ["gemini", "groq"]) && same(r.orderFor("akurat"), DEFAULT_ROUTES.akurat) && /diperbarui/.test(a), "ubah hanya jalur santai");
  check(JSON.parse(store.get("ai_route")).santai.join() === "gemini,groq", "pengaturan tersimpan di bot_state sebagai JSON");
  const b = await r.handle("semua groq,ollama,gemini");
  check(same(r.orderFor("santai"), ["groq", "gemini", "ollama"]) && same(r.orderFor("akurat"), ["groq", "gemini", "ollama"]) && /paling akhir/.test(b), "'semua' mengubah dua jalur; Ollama dipindah ke akhir");
  check(/tidak dikenal/.test(await r.handle("santai groq,bard")) && same(r.orderFor("santai"), ["groq", "gemini", "ollama"]), "nama asing ditolak, urutan lama utuh");
  check(/minimal satu/i.test(await r.handle("akurat ollama")), "Ollama saja ditolak");
  check(/Format/.test(await r.handle("ngawur")), "format salah -> bantuan");
  const c = await r.handle("reset");
  check(same(r.orderFor("santai"), DEFAULT_ROUTES.santai) && /bawaan/.test(c), "reset kembali ke bawaan");
  await r.handle("akurat gemini,openrouter");
  const r2 = createAiRoute({ state, available: (n) => avail[n], log: silent });
  await r2.load();
  check(same(r2.orderFor("akurat"), ["gemini", "openrouter"]), "setelah bot dinyalakan ulang, pengaturan dibaca dari bot_state");
  const bad = createAiRoute({ state: { get: async () => "{rusak", set: async () => {} }, log: silent });
  await bad.load();
  check(same(bad.orderFor("santai"), DEFAULT_ROUTES.santai), "data tersimpan rusak -> pakai bawaan, tidak crash");
}

// ---- llm-fallback: timeoutMs & maxTries per panggilan (untuk jalur balasan WA)
{
  const cfg = readFallbackConfig({ GROQ_API_KEYS: "k1,k2,k3,k4", GROQ_MODEL: "m1", LLM_FALLBACK_MAX_TRIES: "6", LLM_FALLBACK_TIMEOUT_MS: "30000" });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init);
    return new Response("{}", { status: 500 });
  };
  const chain = createFallbackChain({ config: cfg, fetchImpl, log: silent });
  await chain.generate({ system: "s", messages: [{ role: "user", content: "hi" }], maxTries: 2, timeoutMs: 5000 }).catch(() => {});
  check(seen.length === 2, `maxTries per panggilan dihormati (2 percobaan, dapat ${seen.length})`);
  const chain2 = createFallbackChain({ config: cfg, fetchImpl: async (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" })))), log: silent });
  const t0 = Date.now();
  const err = await chain2.generate({ system: "s", messages: [{ role: "user", content: "hi" }], maxTries: 1, timeoutMs: 80 }).catch((e) => e);
  check(Date.now() - t0 < 1500 && /waktu habis \(80 ms\)/.test(String(err.message)), "timeoutMs per panggilan dihormati (macet 80 ms -> gagal cepat)");
  const seen2 = [];
  const chain3 = createFallbackChain({ config: cfg, fetchImpl: async (u, init) => (seen2.push(1), new Response("{}", { status: 500 })), log: silent });
  await chain3.generate({ system: "s", messages: [{ role: "user", content: "hi" }] }).catch(() => {});
  check(seen2.length === 4, "tanpa override: batas bawaan tetap (4 key x 1 model = 4 percobaan)");
}

if (fails) {
  console.log(`\n${fails} tes gagal`);
  process.exit(1);
}
console.log("\nsemua ok");
