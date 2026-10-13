// Tes batas waktu & penandaan "key habis" di jalur Gemini untuk Edge Function study (supabase/functions/_shared/gemini.ts).
// Butuh Node 22.18+ (mengimpor berkas .ts langsung), seperti test-study.mjs.
//   node test-gemini-deadline.mjs
const keepAlive = setInterval(() => {}, 1000);
const env = { GEMINI_MODEL: "m1", GEMINI_MODEL_FALLBACK: "m2", STUDY_GEMINI_BUDGET_MS: "1200" };
globalThis.Deno = { env: { get: (k) => env[k] } };
const { generateJsonText, primeStudyKeysExhausted } = await import("../supabase/functions/_shared/gemini.ts");

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
let calls = 0;
let mode = "ok";
globalThis.fetch = async (url, init) => {
  calls++;
  if (mode === "hang") return new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
  if (mode === "503") return new Response("busy", { status: 503 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }), { status: 200 });
};

{
  mode = "hang"; calls = 0;
  const t0 = Date.now();
  let err = null;
  try { await generateJsonText("s", "p", ["k1", "k2", "k3"], { engine: "gemini" }); } catch (e) { err = e; }
  const dt = Date.now() - t0;
  check(err && /terlalu lama/.test(err.message) && calls === 1 && dt < 3000, `Gemini macet: dilepas setelah ±batas waktu (${dt} ms), tidak mencoba semua key/model (${calls} panggilan)`);
}
{
  mode = "503"; calls = 0;
  const t0 = Date.now();
  let err = null;
  try { await generateJsonText("s", "p", ["k1"], { engine: "gemini", budgetMs: 1500 }); } catch (e) { err = e; }
  const dt = Date.now() - t0;
  check(err && dt < 3500, `503 berulang: jeda retry (3 dtk) tidak melewati batas waktu (${dt} ms)`);
}
{
  mode = "ok"; calls = 0;
  const r = await generateJsonText("s", "p", ["k1", "k2"], { engine: "gemini" });
  check(r.text === '{"ok":1}' && calls === 1, "normal: jawaban Gemini tetap diterima");
}
{
  mode = "ok"; calls = 0;
  primeStudyKeysExhausted(["k1", "k2"], Date.now() + 3_600_000);
  let err = null;
  try { await generateJsonText("s", "p", ["k1", "k2"], { engine: "gemini" }); } catch (e) { err = e; }
  check(calls === 0 && err && /kuota/.test(err.message), "semua key ditandai habis (dari catatan database): nol permintaan ke Gemini");
}
clearInterval(keepAlive);
if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
process.exit(0);
