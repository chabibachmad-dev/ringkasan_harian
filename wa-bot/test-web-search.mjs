// Tes pencarian web (API Tavily/Serper/Brave + Bing cadangan), HTTP palsu tanpa jaringan.
// Dijalankan untuk DUA salinan: wa-bot/web-search.js dan supabase/functions/_shared/web-search.ts.
//   node test-web-search.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { warn() {}, log() {}, error() {} };

const targets = [
  ["JS (bot WA)", "./web-search.js"],
  ["TS (Edge Function)", "../supabase/functions/_shared/web-search.ts"]
];

// script: "provider|key" atau "provider" -> antrean langkah {status,json,text} | "hang"
function makeFake(script) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const provider = url.includes("tavily") ? "tavily" : url.includes("serper") ? "serper" : "brave";
    const h = init.headers || {};
    const key = provider === "tavily" ? String(h.Authorization).replace("Bearer ", "") : provider === "serper" ? h["X-API-KEY"] : h["X-Subscription-Token"];
    calls.push({ provider, key, url, init });
    const q = script[`${provider}|${key}`] || script[provider] || [];
    const step = q.length > 1 ? q.shift() : q[0];
    if (!step) return new Response("{}", { status: 500 });
    if (step === "hang") return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    return new Response(step.json ? JSON.stringify(step.json) : step.text ?? "err", { status: step.status ?? 200 });
  };
  return { fetchImpl, calls };
}

const tav = (n) => ({ json: { results: Array.from({ length: n }, (_, i) => ({ title: `T${i}`, content: `isi ${i} `.repeat(100), url: `https://t.example/${i}` })) } });
const ser = { json: { organic: [{ title: "S0", snippet: "<b>snip</b> &amp; x", link: "https://s.example/0" }] } };
const bra = { json: { web: { results: [{ title: "B0", description: "desk", url: "https://b.example/0" }] } } };

for (const [label, rel] of targets) {
  console.log(`\n== ${label} ==`);
  const mod = await import(pathToFileURL(path.join(here, rel)).href);
  const env = { TAVILY_API_KEYS: "tk1, tk2", SERPER_API_KEY: "sk1", BRAVE_API_KEYS: "bk1" };
  const cfg = mod.readSearchConfig((n) => env[n]);
  check(cfg.providers.map((p) => p.name).join() === "tavily,serper,brave" && cfg.providers[0].keys.length === 2, "config: urutan bawaan tavily,serper,brave; key dipisah koma; *_API_KEY tunggal terbaca");
  check(cfg.bingFallback === true && cfg.timeoutMs === 8000, "config: Bing cadangan aktif & timeout 8000 bawaan");
  const none = mod.readSearchConfig(() => undefined);
  check(none.providers.length === 0 && !mod.createWebSearch({ config: none }).available(), "tanpa key -> available() false");
  const ord = mod.readSearchConfig((n) => ({ ...env, SEARCH_ORDER: "brave,bogus,tavily,brave", SEARCH_BING_FALLBACK: "false", SEARCH_TIMEOUT_MS: "1500" })[n]);
  check(ord.providers.map((p) => p.name).join() === "brave,tavily" && ord.bingFallback === false && ord.timeoutMs === 1500, "SEARCH_ORDER, nama ngawur/ganda dibuang, Bing bisa dimatikan, timeout dari env");

  // 1) Tavily berhasil: URL ikut, snippet dipotong, jumlah dibatasi
  {
    const f = makeFake({ tavily: [tav(8)] });
    const s = mod.createWebSearch({ config: cfg, fetchImpl: f.fetchImpl, log: silent });
    const rows = await s.search("harga emas", 3, { snippetChars: 50 });
    check(rows.length === 3 && rows[0].url === "https://t.example/0" && rows[0].snippet.length <= 53, "tavily: 3 hasil, URL terbawa, snippet dipotong");
    const body = JSON.parse(f.calls[0].init.body);
    check(body.query === "harga emas" && body.max_results === 3, "tavily: body berisi query & max_results");
    check(f.calls[0].init.headers.Authorization === "Bearer tk1", "tavily: header Bearer");
  }
  // 2) Serper: HTML dibersihkan, memakai field link
  {
    const f = makeFake({ serper: [ser] });
    const s = mod.createWebSearch({ config: mod.readSearchConfig((n) => ({ SERPER_API_KEYS: "sk1" })[n]), fetchImpl: f.fetchImpl, log: silent });
    const rows = await s.search("x", 5);
    check(rows[0].snippet === "snip & x" && rows[0].url === "https://s.example/0", "serper: tag HTML dibuang, URL dari field link");
    const body = JSON.parse(f.calls[0].init.body);
    check(body.q === "x" && body.gl === "id" && f.calls[0].init.headers["X-API-KEY"] === "sk1", "serper: body & header benar");
  }
  // 3) Brave: GET dengan query string + header token
  {
    const f = makeFake({ brave: [bra] });
    const s = mod.createWebSearch({ config: mod.readSearchConfig((n) => ({ BRAVE_API_KEYS: "bk1" })[n]), fetchImpl: f.fetchImpl, log: silent });
    const rows = await s.search("kurs dolar", 4);
    check(rows[0].title === "B0" && rows[0].url === "https://b.example/0", "brave: hasil terbaca");
    check(f.calls[0].url.includes("q=kurs+dolar") && f.calls[0].url.includes("count=4") && f.calls[0].init.headers["X-Subscription-Token"] === "bk1", "brave: query string & header token");
  }
  // 4) Rotasi: key pertama 429 -> key kedua; key pertama diistirahatkan di panggilan berikutnya
  {
    let t = 1_000_000;
    const f = makeFake({ "tavily|tk1": [{ status: 429, text: "limit" }], "tavily|tk2": [tav(2)] });
    const s = mod.createWebSearch({ config: cfg, fetchImpl: f.fetchImpl, log: silent, now: () => t });
    const r1 = await s.search("a", 2);
    check(r1.length === 2 && f.calls.map((c) => c.key).join() === "tk1,tk2", "429 di key 1 -> pindah ke key 2");
    await s.search("b", 2);
    check(f.calls.map((c) => c.key).join() === "tk1,tk2,tk2", "key yang kena 429 tidak dicoba lagi (istirahat)");
    t += 3600_000 + 1;
    await s.search("c", 2);
    check(f.calls.length === 4 && f.calls[3].key === "tk2", "setelah masa istirahat, tetap memakai key yang sehat (kursor) ");
  }
  // 5) Semua key Tavily gagal -> Serper dipakai; 401 diistirahatkan; 402/432 dianggap jatah habis
  {
    const f = makeFake({ "tavily|tk1": [{ status: 401, text: "bad" }], "tavily|tk2": [{ status: 432, text: "plan" }], serper: [ser] });
    const s = mod.createWebSearch({ config: cfg, fetchImpl: f.fetchImpl, log: silent });
    const rows = await s.search("q", 5);
    check(rows[0].title === "S0" && f.calls.map((c) => c.provider).join() === "tavily,tavily,serper", "Tavily habis semua -> Serper menjawab");
    await s.search("q2", 5);
    check(f.calls.filter((c) => c.provider === "tavily").length === 2, "dua key Tavily yang gagal tidak dicoba ulang di panggilan berikutnya");
  }
  // 6) Hasil kosong -> penyedia berikutnya (key tidak dihukum)
  {
    const f = makeFake({ tavily: [{ json: { results: [] } }], serper: [ser] });
    const s = mod.createWebSearch({ config: cfg, fetchImpl: f.fetchImpl, log: silent });
    const rows = await s.search("q", 5);
    check(rows[0].title === "S0", "hasil kosong dari Tavily -> lanjut ke Serper");
    await s.search("q", 5);
    check(f.calls.filter((c) => c.provider === "tavily").length === 2, "key Tavily yang hasilnya kosong tetap boleh dipakai lagi");
  }
  // 7) Semua API gagal -> Bing; bila Bing dimatikan / tidak ada -> []
  {
    const f = makeFake({ tavily: [{ status: 500 }], serper: [{ status: 500 }], brave: [{ status: 500 }] });
    let bingCalls = 0;
    const bing = async (q, n) => { bingCalls++; return [{ title: "Bing", snippet: `q=${q} n=${n}` }]; };
    const s = mod.createWebSearch({ config: cfg, fetchImpl: f.fetchImpl, bing, log: silent });
    const rows = await s.search("zz", 4);
    check(rows[0].title === "Bing" && rows[0].snippet === "q=zz n=4" && bingCalls === 1, "semua API gagal -> Bing cadangan");
    const off = mod.createWebSearch({ config: { ...cfg, bingFallback: false }, fetchImpl: f.fetchImpl, bing, log: silent });
    check((await off.search("zz", 4)).length === 0 && bingCalls === 1, "Bing dimatikan -> kosong, Bing tidak dipanggil");
    const throwing = mod.createWebSearch({ config: none, fetchImpl: f.fetchImpl, bing: async () => { throw new Error("blok"); }, log: silent });
    check((await throwing.search("zz")).length === 0, "Bing melempar error -> [] (tidak pernah melempar)");
    const noKeys = mod.createWebSearch({ config: none, bing, log: silent });
    check((await noKeys.search("pakai bing saja", 2))[0].title === "Bing", "tanpa key sama sekali: langsung Bing (perilaku lama)");
    check(noKeys.describe() === "bing" && s.describe().startsWith("tavily (2 key) > serper (1 key) > brave (1 key) > bing"), "describe() menyebut urutan penyedia");
  }
  // 8) Timeout & body bukan JSON tidak membuat error keluar
  {
    const f = makeFake({ tavily: ["hang"], serper: [{ text: "<html>" }], brave: [bra] });
    const s = mod.createWebSearch({ config: { ...cfg, timeoutMs: 40 }, fetchImpl: f.fetchImpl, log: silent });
    const t0 = Date.now();
    const rows = await s.search("q", 5);
    check(rows[0].title === "B0" && Date.now() - t0 < 2000, "Tavily menggantung + Serper bukan JSON -> Brave menjawab, tanpa menunggu lama");
  }
  check((await mod.createWebSearch({ config: cfg, fetchImpl: async () => { throw new Error("x"); }, log: silent }).search("   ")).length === 0, "query kosong -> []");
}

console.log(fails ? `\n${fails} FAIL` : "\nsemua ok");
process.exit(fails ? 1 : 0);
