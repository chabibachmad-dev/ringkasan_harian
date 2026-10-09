// Tes routing agent di Edge Function (generateChatReply options.engine), HTTP palsu tanpa jaringan.
//   node test-engine-routing.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

const env = { GROQ_API_KEYS: "gk1", OPENROUTER_API_KEYS: "ok1", GROQ_MODEL: "gm", OPENROUTER_MODEL: "om", TAVILY_API_KEYS: "tk1" };
globalThis.Deno = { env: { get: (n) => env[n] } };

let calls = [];
let script = {};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const host = u.includes("generativelanguage") ? "gemini" : u.includes("groq.com") ? "groq" : u.includes("openrouter.ai") ? "openrouter" : u.includes("tavily") ? "tavily" : u.includes("bing.com") ? "bing" : "other";
  calls.push({ host, url: u, body: init.body ? String(init.body) : "" });
  const step = script[host];
  if (!step) return new Response("{}", { status: 500 });
  if (host === "gemini") return new Response(JSON.stringify(step.json ?? { candidates: [{ content: { parts: [{ text: step.text }] } }], usageMetadata: { totalTokenCount: 10 } }), { status: step.status ?? 200 });
  if (host === "tavily") return new Response(JSON.stringify({ results: [{ title: "Berita", content: "isi berita", url: "https://contoh.id/a" }] }), { status: 200 });
  return new Response(JSON.stringify({ choices: [{ message: { content: step.text } }], usage: { total_tokens: 5 } }), { status: step.status ?? 200 });
};

const mod = await import(pathToFileURL(path.join(here, "../supabase/functions/_shared/gemini.ts")).href);
const messages = [{ role: "user", content: "Berapa kurs dolar hari ini di Indonesia?" }];
const run = (opts, keys = ["gem1"]) => mod.generateChatReply(messages, keys, [], opts);
const hosts = () => [...new Set(calls.map((c) => c.host))].join(",");
const reset = (s) => { calls = []; script = s; };

// Groq eksplisit: tidak menyentuh Gemini, hasil web (dengan URL) masuk prompt
reset({ groq: { text: "jawab groq" }, tavily: {} });
let r = await run({ engine: "groq" });
check(r.reply === "jawab groq" && r.provider.startsWith("groq/") && r.tokensUsed === 0, "engine=groq: dijawab Groq, token 0");
check(!hosts().includes("gemini") && !hosts().includes("openrouter"), "engine=groq: Gemini & OpenRouter tidak dipanggil");
const groqBody = calls.find((c) => c.host === "groq").body;
check(groqBody.includes("https://contoh.id/a") && groqBody.includes("Sumber:"), "engine=groq: hasil pencarian Tavily + URL masuk prompt");

// OpenRouter eksplisit
reset({ openrouter: { text: "jawab or" }, groq: { text: "x" } });
r = await run({ engine: "openrouter" });
check(r.provider.startsWith("openrouter/") && !hosts().includes("groq") && !hosts().includes("gemini"), "engine=openrouter: hanya OpenRouter");

// Groq eksplisit gagal -> error, tidak pindah ke Gemini/OpenRouter
reset({ groq: { status: 500 }, openrouter: { text: "x" }, gemini: { text: "x" } });
let err = "";
try { await run({ engine: "groq" }); } catch (e) { err = String(e.message); }
check(err.length > 0 && !hosts().includes("openrouter") && !hosts().includes("gemini"), "engine=groq gagal -> error, tanpa pindah penyedia");

// Gemini eksplisit gagal -> error, tanpa cadangan
reset({ gemini: { status: 400, json: { error: { message: "bad" } } }, groq: { text: "x" } });
err = "";
try { await run({ engine: "gemini" }); } catch (e) { err = String(e.message); }
check(err.length > 0 && !hosts().includes("groq"), "engine=gemini gagal -> error, cadangan TIDAK dipakai");

// Gemini eksplisit tanpa key
reset({});
err = "";
try { await run({ engine: "gemini" }, []); } catch (e) { err = String(e.message); }
check(err.includes("Gemini"), "engine=gemini tanpa key -> error jelas");

// Penyedia tidak dikonfigurasi (secret hilang) -- rantai bersama sudah terbentuk, jadi uji lewat pesan dari has()
// Auto: Gemini sukses -> cadangan tidak dipanggil
reset({ gemini: { text: "jawab gemini" }, groq: { text: "x" } });
r = await run({ engine: "auto" });
check(r.reply === "jawab gemini" && !r.provider && !hosts().includes("groq"), "engine=auto: Gemini menjawab, cadangan diam");

// Auto: Gemini gagal -> Groq
reset({ gemini: { status: 400, json: { error: { message: "bad" } } }, groq: { text: "jawab cadangan" } });
r = await run({});
check(r.provider?.startsWith("groq/"), "tanpa engine (=auto): Gemini gagal -> Groq menjawab");

console.log(fails ? `\n${fails} FAIL` : "\nsemua ok");
process.exit(fails ? 1 : 0);
