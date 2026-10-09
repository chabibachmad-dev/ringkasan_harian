// ================================================================
// Penyedia AI CADANGAN (Groq, OpenRouter) untuk Edge Function `chat` -- dipakai HANYA setelah semua key
// Gemini gagal/habis kuota. Keduanya memakai format "OpenAI-compatible" (chat/completions).
//
// SALINAN dari wa-bot/llm-fallback.js (bot WA) -- kalau mengubah logika di sini, ubah juga di sana.
//
// Secret Supabase (semua opsional):
//   GROQ_API_KEYS=gsk_xxx,gsk_yyy              (boleh GROQ_API_KEY satu saja)
//   GROQ_MODEL=llama-3.3-70b-versatile,llama-3.1-8b-instant
//   OPENROUTER_API_KEYS=sk-or-xxx,sk-or-yyy    (boleh OPENROUTER_API_KEY)
//   OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
//   LLM_FALLBACK_ORDER=groq,openrouter
//   LLM_FALLBACK_MAX_INPUT_CHARS=14000, LLM_FALLBACK_TIMEOUT_MS=30000, LLM_FALLBACK_MAX_TRIES=6
// ================================================================

type ProviderName = "groq" | "openrouter";
export interface FallbackProvider {
  name: ProviderName;
  keys: string[];
  models: string[];
}
export interface FallbackConfig {
  providers: FallbackProvider[];
  maxInputChars: number;
  timeoutMs: number;
  maxTries: number;
}
export interface FallbackMessage {
  role: "user" | "assistant";
  content: string;
}
export interface FallbackEvent {
  provider: string;
  model: string;
  keyHint: string; // 4 karakter terakhir key -- key asli tidak pernah keluar dari sini
  kind: "success" | "exhausted" | "rejected" | "error";
  untilMs?: number;
  error?: string;
}
export interface FallbackResult {
  text: string;
  provider: string;
  model: string;
  tokens: number;
}

const ENDPOINTS: Record<ProviderName, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions"
};
const DEFAULT_MODELS: Record<ProviderName, string> = {
  groq: "llama-3.3-70b-versatile,llama-3.1-8b-instant",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free"
};

const splitList = (s: string | undefined | null): string[] =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function readFallbackConfig(get: (name: string) => string | undefined = (n) => Deno.env.get(n)): FallbackConfig {
  const order = splitList(get("LLM_FALLBACK_ORDER") || "groq,openrouter").map((x) => x.toLowerCase());
  const providers: FallbackProvider[] = [];
  for (const name of order) {
    if (!(name in ENDPOINTS) || providers.some((p) => p.name === name)) continue;
    const n = name as ProviderName;
    const upper = n.toUpperCase();
    const keys = splitList(get(`${upper}_API_KEYS`) || get(`${upper}_API_KEY`));
    if (keys.length === 0) continue;
    const models = splitList(get(`${upper}_MODEL`) || get(`${upper}_MODELS`) || DEFAULT_MODELS[n]);
    providers.push({ name: n, keys, models });
  }
  const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);
  return {
    providers,
    maxInputChars: num(get("LLM_FALLBACK_MAX_INPUT_CHARS"), 14000),
    timeoutMs: num(get("LLM_FALLBACK_TIMEOUT_MS"), 30000),
    maxTries: num(get("LLM_FALLBACK_MAX_TRIES"), 6)
  };
}

export class FallbackHttpError extends Error {
  status: number;
  retryAfterMs: number;
  constructor(status: number, message: string, retryAfterMs = 0) {
    super(message);
    this.name = "FallbackHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Potong prompt supaya muat di batas karakter: buang giliran terlama dulu (pesan terakhir selalu dipertahankan);
// kalau system-nya sendiri kepanjangan, potong ekornya (biasanya konteks dokumen).
export function fitMessages(system: string, messages: FallbackMessage[], maxChars: number): { system: string; messages: FallbackMessage[] } {
  const msgs = messages.map((m) => ({ role: m.role, content: String(m.content ?? "") }));
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
    if (msgs[0].content.length > room) msgs[0] = { ...msgs[0], content: msgs[0].content.slice(-room) };
  }
  return { system: sys, messages: msgs };
}

function cleanReply(text: unknown): string {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

// Berapa lama key+model ini diistirahatkan setelah 429.
function cooldownFromResponse(res: Response, bodyText: string): number {
  const ra = Number(res.headers.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 6 * 3600_000);
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > Date.now()) return Math.min(reset - Date.now(), 24 * 3600_000);
  return /per[- ]?day|daily|free-models-per-day|TPD|RPD/i.test(bodyText) ? 3600_000 : 60_000;
}

async function callOpenAiCompatible(args: {
  name: ProviderName;
  apiKey: string;
  model: string;
  system: string;
  messages: FallbackMessage[];
  temperature: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ text: string; tokens: number }> {
  const { name, apiKey, model, system, messages, temperature, timeoutMs, fetchImpl } = args;
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (name === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/ringkasan-harian";
    headers["X-Title"] = "Ringkasan Harian";
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(ENDPOINTS[name], {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({ model, temperature, stream: false, messages: [{ role: "system", content: system }, ...messages] })
    });
  } catch (e) {
    const err = e as Error;
    throw new FallbackHttpError(0, err?.name === "AbortError" ? `waktu habis (${timeoutMs} ms)` : `jaringan: ${err?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await res.text();
  if (!res.ok) {
    throw new FallbackHttpError(res.status, `${name} ${res.status}: ${bodyText.slice(0, 300)}`, res.status === 429 ? cooldownFromResponse(res, bodyText) : 0);
  }
  // deno-lint-ignore no-explicit-any
  let json: any;
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

// Pelapor bersama untuk rantai milik Edge Function (diisi chat/index.ts per permintaan, seperti
// setGeminiKeyReporter di gemini.ts).
let reporter: ((e: FallbackEvent) => Promise<void> | void) | null = null;
export function setFallbackReporter(fn: ((e: FallbackEvent) => Promise<void> | void) | null): void {
  reporter = fn;
}

interface Logger {
  warn?: (...a: unknown[]) => void;
}

// State (key mana lagi istirahat, giliran key) hidup selama isolate Edge Function masih "hangat".
export function createFallbackChain(
  opts: {
    config?: FallbackConfig;
    fetchImpl?: typeof fetch;
    log?: Logger;
    now?: () => number;
    // Dipanggil tiap ada kejadian penting untuk monitoring (tanpa key asli). Kegagalannya tidak pernah
    // menggagalkan jawaban.
    onEvent?: ((e: FallbackEvent) => Promise<void> | void) | null;
  } = {}
) {
  const config = opts.config ?? readFallbackConfig();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? console;
  const now = opts.now ?? (() => Date.now());
  const restUntil = new Map<string, number>();
  const cursor = new Map<string, number>();
  const id = (p: string, m: string, k: string) => `${p}|${m}|${k}`;
  const emit = (e: FallbackEvent) => {
    try {
      const r = (opts.onEvent ?? reporter)?.(e);
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch {
      /* pelaporan tidak boleh menggagalkan jawaban */
    }
  };

  const available = () => config.providers.length > 0;
  const has = (name: string) => config.providers.some((p) => p.name === name);
  const describe = () => config.providers.map((p) => `${p.name}: ${p.keys.length} key, model ${p.models.join(" > ")}`).join(" | ");

  async function generate(input: { system: string; messages: FallbackMessage[]; temperature?: number; only?: string }): Promise<FallbackResult> {
    if (!available()) throw new Error("Tidak ada penyedia cadangan yang dikonfigurasi.");
    const chosen = input.only ? config.providers.filter((p) => p.name === input.only) : config.providers;
    if (chosen.length === 0) throw new Error(`Penyedia "${input.only}" tidak dikonfigurasi.`);
    const temperature = input.temperature ?? 0.4;
    const fitted = fitMessages(input.system, input.messages, config.maxInputChars);
    const reasons: string[] = [];
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
            cursor.set(p.name, p.keys.indexOf(key));
            emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "success" });
            return { text: r.text, provider: p.name, model, tokens: r.tokens };
          } catch (e) {
            const err = e as FallbackHttpError;
            const status = err?.status ?? 0;
            const hint = `${p.name}/${model}/…${key.slice(-4)}`;
            reasons.push(`${hint}: ${err?.message || e}`);
            if (status === 429) {
              const rest = err.retryAfterMs || 60_000;
              restUntil.set(id(p.name, model, key), now() + rest);
              cursor.set(p.name, (p.keys.indexOf(key) + 1) % p.keys.length);
              emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "exhausted", untilMs: now() + rest, error: String(err.message).slice(0, 300) });
              log.warn?.(`Cadangan ${hint} kena batas (429), diistirahatkan ${Math.round(rest / 1000)} dtk.`);
            } else if (status === 401 || status === 403) {
              restUntil.set(id(p.name, model, key), now() + 3600_000);
              emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "rejected", untilMs: now() + 3600_000, error: String(err.message).slice(0, 300) });
              log.warn?.(`Cadangan ${hint} ditolak (${status}) -- key salah/dicabut? Dilewati 1 jam.`);
            } else if (status === 404) {
              for (const k of p.keys) restUntil.set(id(p.name, model, k), now() + 3600_000);
              emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "error", error: `model "${model}" tidak ditemukan` });
              log.warn?.(`Cadangan ${p.name}: model "${model}" tidak ditemukan -- cek ${p.name.toUpperCase()}_MODEL.`);
              break;
            } else {
              emit({ provider: p.name, model, keyHint: key.slice(-4), kind: "error", error: String(err?.message || e).slice(0, 300) });
              log.warn?.(`Cadangan ${hint} gagal: ${err?.message || e}`);
            }
          }
        }
      }
    }
    throw new Error(`Semua penyedia cadangan gagal (${reasons.length ? reasons.join(" ; ").slice(0, 700) : "semua key sedang istirahat"}).`);
  }

  return { available, has, describe, generate };
}

// Satu rantai bersama untuk Edge Function (dibangun malas supaya secret terbaca saat dipakai).
let shared: ReturnType<typeof createFallbackChain> | null = null;
export function getFallbackChain() {
  if (!shared) shared = createFallbackChain();
  return shared;
}
