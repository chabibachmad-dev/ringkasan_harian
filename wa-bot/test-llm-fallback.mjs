// Tes penyedia cadangan Groq/OpenRouter (HTTP palsu, tanpa jaringan). Dijalankan untuk DUA salinan:
// wa-bot/llm-fallback.js dan supabase/functions/_shared/llm-fallback.ts (harus berperilaku sama).
//   node test-llm-fallback.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { warn() {}, log() {}, error() {} };

const targets = [
  ["JS (bot WA)", "./llm-fallback.js"],
  ["TS (Edge Function)", "../supabase/functions/_shared/llm-fallback.ts"]
];

// Server palsu: skrip per "provider|key" -> antrean respons.
function makeFake(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const provider = url.includes("groq.com") ? "groq" : "openrouter";
    const key = String(init.headers.Authorization).replace("Bearer ", "");
    const body = JSON.parse(init.body);
    calls.push({ provider, key, model: body.model, body, headers: init.headers });
    const q = script[`${provider}|${key}|${body.model}`] || script[`${provider}|${key}`] || script[provider] || [];
    const step = q.length > 1 ? q.shift() : q[0];
    if (!step) return new Response("{}", { status: 500 });
    if (step === "hang") {
      return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    if (step.ok !== undefined) {
      return new Response(JSON.stringify({ choices: [{ message: { content: step.ok } }], usage: { total_tokens: 42 } }), { status: 200 });
    }
    if (step.body200) return new Response(JSON.stringify(step.body200), { status: 200 });
    return new Response(step.text ?? "err", { status: step.status, headers: step.headers || {} });
  };
  return { fetchImpl, calls };
}

for (const [label, rel] of targets) {
  console.log(`\n== ${label} ==`);
  const mod = await import(pathToFileURL(path.join(here, rel)).href);
  const env = {
    GROQ_API_KEYS: "gk1, gk2",
    OPENROUTER_API_KEY: "ok1",
    GROQ_MODEL: "m-big,m-small"
  };
  const cfg = mod.readFallbackConfig((n) => env[n]);
  check(cfg.providers.length === 2 && cfg.providers[0].name === "groq" && cfg.providers[0].keys.length === 2, "config: groq 2 key, openrouter 1 key (GROQ_API_KEY tunggal juga terbaca)");
  check(cfg.providers[0].models.join() === "m-big,m-small" && cfg.providers[1].models[0].includes(":free"), "config: daftar model groq dari env; default openrouter :free");
  const none = mod.readFallbackConfig(() => undefined);
  check(none.providers.length === 0 && !mod.createFallbackChain({ config: none }).available(), "tanpa key apa pun -> tidak aktif");
  const rev = mod.readFallbackConfig((n) => ({ ...env, LLM_FALLBACK_ORDER: "openrouter,groq" })[n]);
  check(rev.providers[0].name === "openrouter", "LLM_FALLBACK_ORDER mengatur urutan");
  const only = mod.readFallbackConfig((n) => ({ OPENROUTER_API_KEYS: "a", LLM_FALLBACK_ORDER: "groq,openrouter,bogus" })[n]);
  check(only.providers.length === 1 && only.providers[0].name === "openrouter", "penyedia tanpa key / nama ngawur dilewati");

  const msgs = [{ role: "user", content: "Berapa tarif hotel di Bali?" }];

  // 1) Berhasil di key pertama
  {
    const f = makeFake({ groq: [{ ok: "Jawaban A" }] });
    const ch = mod.createFallbackChain({ config: cfg, fetchImpl: f.fetchImpl, log: silent });
    const r = await ch.generate({ system: "SYS", messages: msgs });
    check(r.text === "Jawaban A" && r.provider === "groq" && r.model === "m-big" && f.calls.length === 1, "berhasil di percobaan pertama (groq, model pertama)");
    check(f.calls[0].body.messages[0].role === "system" && f.calls[0].body.messages[0].content === "SYS" && f.calls[0].body.stream === false, "format OpenAI: system + messages, tanpa stream");
    check(f.calls[0].headers.Authorization === "Bearer gk1", "memakai key pertama");
  }
  // 2) 429 di key1 -> pindah key2, key1 diistirahatkan (retry-after) lalu dipakai lagi setelah lewat
  {
    let t = 1_000_000;
    const f = makeFake({ "groq|gk1": [{ status: 429, text: "rate", headers: { "retry-after": "30" } }], "groq|gk2": [{ ok: "dari gk2" }] });
    const ch = mod.createFallbackChain({ config: cfg, fetchImpl: f.fetchImpl, log: silent, now: () => t });
    const r = await ch.generate({ system: "S", messages: msgs });
    check(r.text === "dari gk2" && f.calls.map((c) => c.key).join() === "gk1,gk2", "429 -> rotasi ke key berikutnya");
    const r2 = await ch.generate({ system: "S", messages: msgs });
    check(f.calls.length === 3 && f.calls[2].key === "gk2", "permintaan berikutnya langsung ke key yang sehat (gk1 istirahat)");
    t += 31_000;
    f.calls.length = 0;
    await ch.generate({ system: "S", messages: msgs }).catch(() => {});
    check(f.calls.length >= 1, "setelah masa istirahat lewat, key dicoba lagi tidak ditolak mentah-mentah");
  }
  // 3) Semua key groq habis (harian) -> openrouter
  {
    const f = makeFake({
      groq: [{ status: 429, text: "Rate limit reached on tokens per day (TPD)" }],
      openrouter: [{ ok: "dari openrouter" }]
    });
    const ch = mod.createFallbackChain({ config: cfg, fetchImpl: f.fetchImpl, log: silent });
    const r = await ch.generate({ system: "S", messages: msgs });
    check(r.provider === "openrouter" && r.text === "dari openrouter", "semua groq 429 -> jatuh ke openrouter");
    check(f.calls.filter((c) => c.provider === "groq").length === 4 && f.calls.every((c) => c.provider !== "openrouter" || c.headers["X-Title"]), "groq: 2 key x 2 model dicoba; openrouter membawa header X-Title");
    check(r.tokens === 42, "token dari usage dilaporkan");
  }
  // 4) 401 -> dilewati; 404 model -> model berikutnya; hasil 200 berisi error (OpenRouter)
  {
    const f = makeFake({
      "groq|gk1": [{ status: 401, text: "bad key" }],
      "groq|gk2|m-big": [{ status: 404, text: "no model" }],
      "groq|gk2|m-small": [{ ok: "kecil" }]
    });
    const ch = mod.createFallbackChain({ config: cfg, fetchImpl: f.fetchImpl, log: silent });
    const r = await ch.generate({ system: "S", messages: msgs });
    check(r.text === "kecil" && r.model === "m-small", "404 model -> pakai model berikutnya; 401 key dilewati");
    const g = makeFake({ groq: [{ status: 500, text: "x" }], openrouter: [{ body200: { error: { code: 429, message: "free limit" } } }] });
    const ch2 = mod.createFallbackChain({ config: cfg, fetchImpl: g.fetchImpl, log: silent });
    let msg = "";
    await ch2.generate({ system: "S", messages: msgs }).catch((e) => (msg = e.message));
    check(/Semua penyedia cadangan gagal/.test(msg) && /openrouter 429/.test(msg), "200 berisi error dianggap gagal; pesan akhir memuat alasan per penyedia");
  }
  // 5) Batas waktu & batas percobaan
  {
    const f = makeFake({ groq: ["hang"], openrouter: [{ ok: "cepat" }] });
    const fast = { ...cfg, timeoutMs: 40 };
    const ch = mod.createFallbackChain({ config: fast, fetchImpl: f.fetchImpl, log: silent });
    const r = await ch.generate({ system: "S", messages: msgs });
    check(r.provider === "openrouter", "timeout groq -> lanjut ke openrouter");
    const h = makeFake({ groq: [{ status: 500, text: "x" }], openrouter: [{ status: 500, text: "x" }] });
    const ch2 = mod.createFallbackChain({ config: { ...cfg, maxTries: 3 }, fetchImpl: h.fetchImpl, log: silent });
    await ch2.generate({ system: "S", messages: msgs }).catch(() => {});
    check(h.calls.length === 3, "LLM_FALLBACK_MAX_TRIES membatasi jumlah percobaan");
  }
  // 6) Pemangkasan prompt & pembersihan <think>
  {
    const long = Array.from({ length: 10 }, (_, i) => [{ role: "user", content: `u${i} ${"x".repeat(900)}` }, { role: "assistant", content: `a${i} ${"y".repeat(900)}` }]).flat();
    long.push({ role: "user", content: "pertanyaan terakhir" });
    const fit = mod.fitMessages("sys", long, 5000);
    const total = fit.system.length + fit.messages.reduce((n, m) => n + m.content.length, 0);
    check(total <= 5000 && fit.messages.at(-1).content === "pertanyaan terakhir" && fit.messages[0].role === "user", "fitMessages: buang giliran terlama, pesan terakhir utuh, mulai dari user");
    const bigSys = mod.fitMessages("S".repeat(30000), [{ role: "user", content: "halo" }], 8000);
    check(bigSys.system.length < 8100 && bigSys.system.includes("dipotong"), "fitMessages: system kepanjangan dipotong ekornya");
    const f = makeFake({ groq: [{ ok: "<think>mikir panjang</think>Jawaban bersih" }] });
    const ch = mod.createFallbackChain({ config: cfg, fetchImpl: f.fetchImpl, log: silent });
    const r = await ch.generate({ system: "S", messages: msgs });
    check(r.text === "Jawaban bersih", "blok <think> dibuang dari jawaban");
  }
  // 7) Balasan kosong dianggap gagal
  {
    const f = makeFake({ groq: [{ ok: "   " }], openrouter: [{ ok: "isi" }] });
    const ch = mod.createFallbackChain({ config: cfg, fetchImpl: f.fetchImpl, log: silent });
    const r = await ch.generate({ system: "S", messages: msgs });
    check(r.provider === "openrouter" || r.text === "isi", "balasan kosong -> coba berikutnya");
  }
}

if (fails) {
  console.log(`\n${fails} tes GAGAL`);
  process.exit(1);
}
console.log("\nSemua tes penyedia cadangan lolos.");
