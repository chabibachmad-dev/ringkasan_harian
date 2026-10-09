// ================================================================
// Pencarian web untuk bot WA: API pencarian (Tavily, Serper, Brave) dengan rotasi key,
// dan Bing (scraping HTML) sebagai cadangan terakhir. Hasil membawa URL supaya jawaban bisa
// menyebut sumber.
//
// SALINAN dari supabase/functions/_shared/web-search.ts (Edge Function chat) -- kalau mengubah
// logika di sini, ubah juga di sana.
//
// Konfigurasi (.env / secret Supabase), semuanya opsional:
//   TAVILY_API_KEYS=tvly-xxx,tvly-yyy     (boleh TAVILY_API_KEY satu saja)
//   SERPER_API_KEYS=xxx                    (hasil Google lewat serper.dev)
//   BRAVE_API_KEYS=xxx                     (Brave Search API)
//   SEARCH_ORDER=tavily,serper,brave       (urutan penyedia; yang tak punya key dilewati)
//   SEARCH_BING_FALLBACK=true              (false = jangan pakai Bing saat semua API gagal)
//   SEARCH_TIMEOUT_MS=8000
// Jatah gratis tiap penyedia berbeda-beda dan bisa berubah; cek di situs masing-masing.
// ================================================================

const PROVIDERS = ["tavily", "serper", "brave"];

const splitList = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// env: objek seperti process.env (atau fungsi nama -> nilai, seperti di salinan TypeScript).
export function readSearchConfig(env = process.env) {
  const get = typeof env === "function" ? env : (n) => env[n];
  const order = splitList(get("SEARCH_ORDER") || PROVIDERS.join(",")).map((x) => x.toLowerCase());
  const providers = [];
  for (const name of order) {
    if (!PROVIDERS.includes(name) || providers.some((p) => p.name === name)) continue;
    const upper = name.toUpperCase();
    const keys = splitList(get(`${upper}_API_KEYS`) || get(`${upper}_API_KEY`));
    if (keys.length > 0) providers.push({ name, keys });
  }
  const timeoutMs = Number(get("SEARCH_TIMEOUT_MS")) > 0 ? Number(get("SEARCH_TIMEOUT_MS")) : 8000;
  const bingFallback = String(get("SEARCH_BING_FALLBACK") ?? "true").trim().toLowerCase() !== "false";
  return { providers, timeoutMs, bingFallback };
}

export class SearchHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SearchHttpError";
    this.status = status;
  }
}

const stripTags = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function clip(text, max) {
  const t = stripTags(text);
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

// Satu panggilan ke satu API pencarian -> [{ title, snippet, url }]
// recent: "week" | "month" | "year" (opsional) = hanya hasil dengan tanggal terbaru -- dipakai pemantau peraturan.
const RECENT_TBS = { week: "qdr:w", month: "qdr:m", year: "qdr:y" };
const RECENT_BRAVE = { week: "pw", month: "pm", year: "py" };
async function callProvider({ name, apiKey, query, maxResults, snippetChars, timeoutMs, fetchImpl, recent = "" }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
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
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new SearchHttpError(502, `${name}: respons bukan JSON`);
    }
    let rows = [];
    if (name === "tavily") rows = (json.results || []).map((r) => ({ title: r.title, snippet: r.content, url: r.url }));
    else if (name === "serper") rows = (json.organic || []).map((r) => ({ title: r.title, snippet: r.snippet, url: r.link }));
    else rows = (json.web?.results || []).map((r) => ({ title: r.title, snippet: r.description, url: r.url }));
    return rows
      .map((r) => ({ title: stripTags(r.title), snippet: clip(r.snippet, snippetChars), url: r.url ? String(r.url) : undefined }))
      .filter((r) => r.title || r.snippet)
      .slice(0, maxResults);
  } catch (e) {
    if (e instanceof SearchHttpError) throw e;
    throw new SearchHttpError(0, e?.name === "AbortError" ? `${name}: waktu habis` : `${name}: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
}

// bing(query, maxResults) -> [{title, snippet}] : fungsi cadangan (scraping Bing) dari pemanggil.
// onEvent(e) (opsional): dipanggil tiap ada kejadian penting untuk monitoring, TANPA key asli:
//   { provider, keyHint, kind: "success"|"exhausted"|"rejected"|"error", untilMs?, error? }
// "success" = satu permintaan terpakai (walau hasilnya kosong). Kegagalan onEvent tidak pernah menggagalkan pencarian.
export function createWebSearch({ config = readSearchConfig(), fetchImpl = globalThis.fetch, bing = null, log = console, now = () => Date.now(), onEvent = null } = {}) {
  const restUntil = new Map(); // "provider|key" -> ms
  const cursor = new Map();
  const emit = (e) => {
    try {
      const r = onEvent?.(e);
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {
      /* pelaporan tidak boleh menggagalkan pencarian */
    }
  };

  const available = () => config.providers.length > 0;
  const describe = () =>
    [...config.providers.map((p) => `${p.name} (${p.keys.length} key)`), ...(config.bingFallback && bing ? ["bing"] : [])].join(" > ") || "bing";

  // Return [{ title, snippet, url? }] (kosong = tidak ada hasil / semua gagal; tidak pernah melempar error).
  async function search(query, maxResults = 5, { snippetChars = 320, recent = "" } = {}) {
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
          const status = e?.status ?? 0;
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
            error: String(e?.message || e).slice(0, 300)
          });
          log.warn?.(`🔎 Pencarian ${hint} gagal (${quota ? "jatah habis" : bad ? "key ditolak" : "error"}): ${String(e?.message || e).slice(0, 160)}`);
        }
      }
    }
    // Bing (scraping) tidak bisa menyaring tanggal: kalau diminta hasil terbaru, jangan pakai Bing.
    if (config.bingFallback && bing && !recent) {
      try {
        return await bing(q, maxResults);
      } catch (e) {
        log.warn?.(`🔎 Pencarian Bing gagal: ${e?.message || e}`);
      }
    }
    return [];
  }

  return { search, available, describe };
}
