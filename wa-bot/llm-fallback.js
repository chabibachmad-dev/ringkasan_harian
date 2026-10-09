// ================================================================
// Penyedia AI CADANGAN (Groq, OpenRouter) untuk bot WA -- dipakai HANYA setelah semua key
// Gemini gagal/habis kuota. Keduanya memakai format "OpenAI-compatible" (chat/completions).
//
// SALINAN dari supabase/functions/_shared/llm-fallback.ts (Edge Function chat) -- kalau mengubah
// logika di sini, ubah juga di sana.
//
// Konfigurasi (.env):
//   GROQ_API_KEYS=gsk_xxx,gsk_yyy          (boleh GROQ_API_KEY satu saja)
//   GROQ_MODEL=llama-3.3-70b-versatile,llama-3.1-8b-instant      (daftar, dicoba berurutan)
//   OPENROUTER_API_KEYS=sk-or-xxx,sk-or-yyy (boleh OPENROUTER_API_KEY)
//   OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free      (daftar, dicoba berurutan)
//   LLM_FALLBACK_ORDER=groq,openrouter      (urutan penyedia; nama yang tidak ada key-nya dilewati)
//   LLM_FALLBACK_MAX_INPUT_CHARS=14000      (batas panjang prompt; jatah gratis mereka kecil)
//   LLM_FALLBACK_TIMEOUT_MS=30000           (batas waktu per percobaan)
//   LLM_FALLBACK_MAX_TRIES=6                (maks percobaan total per permintaan)
// ================================================================

const ENDPOINTS = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions"
};
const DEFAULT_MODELS = {
  groq: "llama-3.3-70b-versatile,llama-3.1-8b-instant",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free"
};

const splitList = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// env: objek seperti process.env (atau fungsi nama -> nilai, seperti di salinan TypeScript).
export function readFallbackConfig(env = process.env) {
  const get = typeof env === "function" ? env : (n) => env[n];
  const order = splitList(get("LLM_FALLBACK_ORDER") || "groq,openrouter").map((x) => x.toLowerCase());
  const providers = [];
  for (const name of order) {
    if (!ENDPOINTS[name] || providers.some((p) => p.name === name)) continue;
    const upper = name.toUpperCase();
    const keys = splitList(get(`${upper}_API_KEYS`) || get(`${upper}_API_KEY`));
    if (keys.length === 0) continue;
    const models = splitList(get(`${upper}_MODEL`) || get(`${upper}_MODELS`) || DEFAULT_MODELS[name]);
    providers.push({ name, keys, models });
  }
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    providers,
    maxInputChars: num(get("LLM_FALLBACK_MAX_INPUT_CHARS"), 14000),
    timeoutMs: num(get("LLM_FALLBACK_TIMEOUT_MS"), 30000),
    maxTries: num(get("LLM_FALLBACK_MAX_TRIES"), 6)
  };
}

export class FallbackHttpError extends Error {
  constructor(status, message, retryAfterMs = 0) {
    super(message);
    this.name = "FallbackHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Potong prompt supaya muat di batas karakter: buang giliran terlama dulu (pesan terakhir selalu dipertahankan);
// kalau system-nya sendiri kepanjangan, potong ekornya (biasanya konteks dokumen).
export function fitMessages(system, messages, maxChars) {
  let msgs = messages.map((m) => ({ role: m.role, content: String(m.content ?? "") }));
  const size = () => system.length + msgs.reduce((n, m) => n + m.content.length, 0);
  while (msgs.length > 1 && size() > maxChars) msgs.shift();
  while (msgs.length > 1 && msgs[0].role !== "user") msgs.shift(); // giliran pertama harus user
  let sys = system;
  if (size() > maxChars) {
    const room = Math.max(2000, maxChars - msgs.reduce((n, m) => n + m.content.length, 0));
    if (sys.length > room) sys = `${sys.slice(0, room)}\n\n[...dipotong karena terlalu panjang...]`;
  }
  if (size() > maxChars && msgs.length === 1) {
    const room = Math.max(1000, maxChars - sys.length);
    if (msgs[0].content.length > room) msgs[0] = { ...msgs[0], content: `${msgs[0].content.slice(-room)}` };
  }
  return { system: sys, messages: msgs };
}

function cleanReply(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

// Berapa lama key+model ini diistirahatkan setelah 429.
function cooldownFromResponse(res, bodyText) {
  const ra = Number(res.headers.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 6 * 3600_000);
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > Date.now()) return Math.min(reset - Date.now(), 24 * 3600_000);
  return /per[- ]?day|daily|free-models-per-day|TPD|RPD/i.test(bodyText) ? 3600_000 : 60_000;
}

async function callOpenAiCompatible({ name, apiKey, model, system, messages, temperature, timeoutMs, fetchImpl }) {
  const url = ENDPOINTS[name];
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (name === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/ringkasan-harian";
    headers["X-Title"] = "Ringkasan Harian";
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature,
        stream: false,
        messages: [{ role: "system", content: system }, ...messages]
      })
    });
  } catch (e) {
    throw new FallbackHttpError(0, e?.name === "AbortError" ? `waktu habis (${timeoutMs} ms)` : `jaringan: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await res.text();
  if (!res.ok) {
    throw new FallbackHttpError(res.status, `${name} ${res.status}: ${bodyText.slice(0, 300)}`, res.status === 429 ? cooldownFromResponse(res, bodyText) : 0);
  }
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new FallbackHttpError(502, `${name}: respons bukan JSON`);
  }
  // OpenRouter kadang membalas 200 dengan {error:{code,message}} (mis. model sibuk / jatah habis).
  if (json?.error) {
    const code = Number(json.error.code) || 502;
    throw new FallbackHttpError(code, `${name} ${code}: ${String(json.error.message || "").slice(0, 300)}`, code === 429 ? 60_000 : 0);
  }
  const text = cleanReply(json?.choices?.[0]?.message?.content);
  if (!text) throw new FallbackHttpError(502, `${name}: balasan kosong`);
  return { text, tokens: json?.usage?.total_tokens ?? 0 };
}

// Fabrik: state (key mana lagi istirahat, giliran key) hidup selama proses.
// onEvent(e) (opsional): dipanggil tiap ada kejadian penting untuk monitoring, TANPA key asli:
//   { provider, model, keyHint, kind: "success"|"exhausted"|"rejected"|"error", untilMs?, error? }
// Kegagalan onEvent tidak pernah menggagalkan jawaban.
export function createFallbackChain({ config = readFallbackConfig(), fetchImpl = globalThis.fetch, log = console, now = () => Date.now(), onEvent = null } = {}) {
  const restUntil = new Map(); // "provider|model|key" -> ms
  const cursor = new Map(); // "provider" -> indeks key berikutnya
  const id = (p, m, k) => `${p}|${m}|${k}`;
  const emit = (e) => {
    try {
      const r = onEvent?.(e);
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {
      /* pelaporan tidak boleh menggagalkan jawaban */
    }
  };

  function available() {
    return config.providers.length > 0;
  }
  const has = (name) => config.providers.some((p) => p.name === name);
  function describe() {
    return config.providers.map((p) => `${p.name}: ${p.keys.length} key, model ${p.models.join(" > ")}`).join(" | ");
  }

  // system: string; messages: [{role:"user"|"assistant", content}]. Return { text, provider, model, tokens }
  // atau melempar Error (gabungan alasan semua percobaan).
  async function generate({ system, messages, temperature = 0.4, only = "" }) {
    if (!available()) throw new Error("Tidak ada penyedia cadangan yang dikonfigurasi.");
    const chosen = only ? config.providers.filter((p) => p.name === only) : config.providers;
    if (chosen.length === 0) throw new Error(`Penyedia "${only}" tidak dikonfigurasi.`);
    const fitted = fitMessages(system, messages, config.maxInputChars);
    const reasons = [];
    let tries = 0;
    for (const p of chosen) {
      for (const model of p.models) {
        const start = cursor.get(p.name) || 0;
        for (let i = 0; i < p.keys.length; i++) {
          if (tries >= config.maxTries) break;
          const key = p.keys[(start + i) % p.keys.length];
          if (now() < (restUntil.get(id(p.name, model, key)) || 0)) continue;
          tries += 1;
          try {
            const r = await callOpenAiCompatible({
              name: p.name,
              apiKey: key,
              model,
              system: fitted.system,
              messages: fitted.messages,
              temperature,
              timeoutMs: config.timeoutMs,
              fetchImpl
            });
            cursor.set(p.name, p.keys.indexOf(key)); // key yang berhasil dipakai lagi
            emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "success" });
            return { text: r.text, provider: p.name, model, tokens: r.tokens };
          } catch (e) {
            const status = e?.status ?? 0;
            const hint = `${p.name}/${model}/…${key.slice(-4)}`;
            reasons.push(`${hint}: ${e?.message || e}`);
            if (status === 429) {
              restUntil.set(id(p.name, model, key), now() + (e.retryAfterMs || 60_000));
              cursor.set(p.name, (p.keys.indexOf(key) + 1) % p.keys.length);
              emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "exhausted", untilMs: now() + (e.retryAfterMs || 60_000), error: String(e.message).slice(0, 300) });
              log.warn?.(`⚠️  Cadangan ${hint} kena batas (429), diistirahatkan ${Math.round((e.retryAfterMs || 60_000) / 1000)} dtk.`);
            } else if (status === 401 || status === 403) {
              restUntil.set(id(p.name, model, key), now() + 3600_000);
              emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "rejected", untilMs: now() + 3600_000, error: String(e.message).slice(0, 300) });
              log.warn?.(`⚠️  Cadangan ${hint} ditolak (${status}) -- key salah/dicabut? Dilewati 1 jam.`);
            } else if (status === 404) {
              // model tidak ada: lewati model ini untuk SEMUA key di penyedia ini
              for (const k of p.keys) restUntil.set(id(p.name, model, k), now() + 3600_000);
              emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "error", error: `model "${model}" tidak ditemukan` });
              log.warn?.(`⚠️  Cadangan ${p.name}: model "${model}" tidak ditemukan -- cek ${p.name.toUpperCase()}_MODEL.`);
              break;
            } else {
              emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "error", error: String(e?.message || e).slice(0, 300) });
              log.warn?.(`⚠️  Cadangan ${hint} gagal: ${e?.message || e}`);
            }
          }
        }
      }
    }
    throw new Error(`Semua penyedia cadangan gagal (${reasons.length ? reasons.join(" ; ").slice(0, 700) : "semua key sedang istirahat"}).`);
  }

  return { available, has, describe, generate };
}
