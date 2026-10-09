// ================================================================
// Pencarian web untuk Edge Function `chat`: API pencarian (Tavily, Serper, Brave) dengan rotasi key,
// dan Bing (scraping HTML) sebagai cadangan terakhir. Hasil membawa URL supaya jawaban bisa
// menyebut sumber.
//
// SALINAN dari wa-bot/web-search.js (bot WA) -- kalau mengubah logika di sini, ubah juga di sana.
//
// Secret Supabase (semua opsional):
//   TAVILY_API_KEYS=tvly-xxx,tvly-yyy     (boleh TAVILY_API_KEY satu saja)
//   SERPER_API_KEYS=xxx                    (hasil Google lewat serper.dev)
//   BRAVE_API_KEYS=xxx                     (Brave Search API)
//   SEARCH_ORDER=tavily,serper,brave       (urutan penyedia; yang tak punya key dilewati)
//   SEARCH_BING_FALLBACK=true              (false = jangan pakai Bing saat semua API gagal)
//   SEARCH_TIMEOUT_MS=8000
// Jatah gratis tiap penyedia berbeda-beda dan bisa berubah; cek di situs masing-masing.
// ================================================================

type SearchProviderName = "tavily" | "serper" | "brave";
const PROVIDERS: SearchProviderName[] = ["tavily", "serper", "brave"];

export interface SearchProvider {
  name: SearchProviderName;
  keys: string[];
}
export interface SearchConfig {
  providers: SearchProvider[];
  timeoutMs: number;
  bingFallback: boolean;
}
export interface SearchRow {
  title: string;
  snippet: string;
  url?: string;
}

const splitList = (s: string | undefined | null): string[] =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function readSearchConfig(get: (name: string) => string | undefined = (n) => Deno.env.get(n)): SearchConfig {
  const order = splitList(get("SEARCH_ORDER") || PROVIDERS.join(",")).map((x) => x.toLowerCase());
  const providers: SearchProvider[] = [];
  for (const name of order) {
    if (!(PROVIDERS as string[]).includes(name) || providers.some((p) => p.name === name)) continue;
    const n = name as SearchProviderName;
    const upper = n.toUpperCase();
    const keys = splitList(get(`${upper}_API_KEYS`) || get(`${upper}_API_KEY`));
    if (keys.length > 0) providers.push({ name: n, keys });
  }
  const timeoutMs = Number(get("SEARCH_TIMEOUT_MS")) > 0 ? Number(get("SEARCH_TIMEOUT_MS")) : 8000;
  const bingFallback = String(get("SEARCH_BING_FALLBACK") ?? "true").trim().toLowerCase() !== "false";
  return { providers, timeoutMs, bingFallback };
}

export class SearchHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SearchHttpError";
    this.status = status;
  }
}

const stripTags = (s: unknown): string =>
  String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function clip(text: unknown, max: number): string {
  const t = stripTags(text);
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

// Satu panggilan ke satu API pencarian -> [{ title, snippet, url }]
// recent: "week" | "month" | "year" (opsional) = hanya hasil dengan tanggal terbaru -- dipakai pemantau peraturan.
const RECENT_TBS: Record<string, string> = { week: "qdr:w", month: "qdr:m", year: "qdr:y" };
const RECENT_BRAVE: Record<string, string> = { week: "pw", month: "pm", year: "py" };
async function callProvider(args: {
  name: SearchProviderName;
  apiKey: string;
  query: string;
  maxResults: number;
  snippetChars: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  recent?: string;
}): Promise<SearchRow[]> {
  const { name, apiKey, query, maxResults, snippetChars, timeoutMs, fetchImpl } = args;
  const recent = args.recent ?? "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response;
    if (name === "tavily") {
      res = await fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic", include_answer: false, ...(RECENT_TBS[recent] ? { time_range: recent } : {}) }),
        signal: ctrl.signal
      });
    } else if (name === "serper") {
      res = await fetchImpl("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({ q: query, gl: "id", hl: "id", num: maxResults, ...(RECENT_TBS[recent] ? { tbs: RECENT_TBS[recent] } : {}) }),
        signal: ctrl.signal
      });
    } else {
      const u = new URL("https://api.search.brave.com/res/v1/web/search");
      u.searchParams.set("q", query);
      u.searchParams.set("count", String(maxResults));
      u.searchParams.set("country", "ID");
      u.searchParams.set("search_lang", "id");
      if (RECENT_BRAVE[recent]) u.searchParams.set("freshness", RECENT_BRAVE[recent]);
      res = await fetchImpl(u.toString(), { headers: { Accept: "application/json", "X-Subscription-Token": apiKey }, signal: ctrl.signal });
    }
    const text = await res.text();
    if (!res.ok) throw new SearchHttpError(res.status, `${name} ${res.status}: ${text.slice(0, 200)}`);
    // deno-lint-ignore no-explicit-any
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new SearchHttpError(502, `${name}: respons bukan JSON`);
    }
    // deno-lint-ignore no-explicit-any
    let rows: any[] = [];
    if (name === "tavily") rows = (json.results || []).map((r: any) => ({ title: r.title, snippet: r.content, url: r.url }));
    else if (name === "serper") rows = (json.organic || []).map((r: any) => ({ title: r.title, snippet: r.snippet, url: r.link }));
    else rows = (json.web?.results || []).map((r: any) => ({ title: r.title, snippet: r.description, url: r.url }));
    return rows
      .map((r) => ({ title: stripTags(r.title), snippet: clip(r.snippet, snippetChars), url: r.url ? String(r.url) : undefined }))
      .filter((r) => r.title || r.snippet)
      .slice(0, maxResults);
  } catch (e) {
    if (e instanceof SearchHttpError) throw e;
    const err = e as Error;
    throw new SearchHttpError(0, err?.name === "AbortError" ? `${name}: waktu habis` : `${name}: ${err?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
}

interface Logger {
  warn?: (...a: unknown[]) => void;
}

// Kejadian untuk monitoring (tanpa key asli). "success" = satu permintaan terpakai (walau hasilnya kosong).
export interface SearchEvent {
  provider: string;
  model?: string;
  keyHint: string;
  kind: "success" | "exhausted" | "rejected" | "error";
  untilMs?: number;
  error?: string;
}

// Pelapor bersama untuk pencari milik Edge Function (diisi chat/index.ts per permintaan, seperti setFallbackReporter).
let reporter: ((e: SearchEvent) => Promise<void> | void) | null = null;
export function setSearchReporter(fn: ((e: SearchEvent) => Promise<void> | void) | null): void {
  reporter = fn;
}

// bing(query, maxResults) -> [{title, snippet}] : fungsi cadangan (scraping Bing) dari pemanggil.
export function createWebSearch(
  opts: {
    config?: SearchConfig;
    fetchImpl?: typeof fetch;
    bing?: ((q: string, max: number) => Promise<SearchRow[]>) | null;
    log?: Logger;
    now?: () => number;
    onEvent?: ((e: SearchEvent) => Promise<void> | void) | null;
  } = {}
) {
  const config = opts.config ?? readSearchConfig();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const bing = opts.bing ?? null;
  const log = opts.log ?? console;
  const now = opts.now ?? (() => Date.now());
  const restUntil = new Map<string, number>(); // "provider|key" -> ms
  const cursor = new Map<string, number>();
  const emit = (e: SearchEvent) => {
    try {
      const r = (opts.onEvent ?? reporter)?.(e);
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch {
      /* pelaporan tidak boleh menggagalkan pencarian */
    }
  };

  const available = () => config.providers.length > 0;
  const describe = () =>
    [...config.providers.map((p) => `${p.name} (${p.keys.length} key)`), ...(config.bingFallback && bing ? ["bing"] : [])].join(" > ") || "bing";

  // Return [{ title, snippet, url? }] (kosong = tidak ada hasil / semua gagal; tidak pernah melempar error).
  async function search(query: string, maxResults = 5, o: { snippetChars?: number; recent?: string } = {}): Promise<SearchRow[]> {
    const snippetChars = o.snippetChars ?? 320;
    const recent = o.recent ?? "";
    const q = String(query || "").trim();
    if (!q) return [];
    for (const p of config.providers) {
      const start = cursor.get(p.name) || 0;
      for (let i = 0; i < p.keys.length; i++) {
        const key = p.keys[(start + i) % p.keys.length];
        const id = `${p.name}|${key}`;
        if (now() < (restUntil.get(id) || 0)) continue;
        try {
          const rows = await callProvider({ name: p.name, apiKey: key, query: q, maxResults, snippetChars, timeoutMs: config.timeoutMs, fetchImpl, recent });
          cursor.set(p.name, p.keys.indexOf(key));
          emit({ provider: p.name, keyHint: key.slice(-4), kind: "success" });
          if (rows.length > 0) return rows;
          break; // hasil kosong dari penyedia ini: coba penyedia berikutnya, key tidak dihukum
        } catch (e) {
          const err = e as SearchHttpError;
          const status = err?.status ?? 0;
          const hint = `${p.name}/…${key.slice(-4)}`;
          // 429 / 402 / 432 / 433 = jatah habis; 401 / 403 = key salah: istirahat 1 jam. Lainnya: 1 menit.
          const quota = [402, 429, 432, 433].includes(status);
          const bad = status === 401 || status === 403;
          restUntil.set(id, now() + (quota || bad ? 3600_000 : 60_000));
          if (quota || bad) cursor.set(p.name, (p.keys.indexOf(key) + 1) % p.keys.length);
          emit({
            provider: p.name,
            keyHint: key.slice(-4),
            kind: quota ? "exhausted" : bad ? "rejected" : "error",
            untilMs: quota || bad ? now() + 3600_000 : undefined,
            error: String(err?.message || e).slice(0, 300)
          });
          log.warn?.(`Pencarian ${hint} gagal (${quota ? "jatah habis" : bad ? "key ditolak" : "error"}): ${String(err?.message || e).slice(0, 160)}`);
        }
      }
    }
    // Bing (scraping) tidak bisa menyaring tanggal: kalau diminta hasil terbaru, jangan pakai Bing.
    if (config.bingFallback && bing && !recent) {
      try {
        return await bing(q, maxResults);
      } catch (e) {
        log.warn?.(`Pencarian Bing gagal: ${(e as Error)?.message || e}`);
      }
    }
    return [];
  }

  return { search, available, describe };
}

// Satu pencari bersama untuk Edge Function (dibangun malas supaya secret terbaca saat dipakai).
let shared: ReturnType<typeof createWebSearch> | null = null;
export function getWebSearch(bing: ((q: string, max: number) => Promise<SearchRow[]>) | null) {
  if (!shared) shared = createWebSearch({ bing });
  return shared;
}
