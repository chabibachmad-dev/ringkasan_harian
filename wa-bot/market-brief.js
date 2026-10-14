// Pemeriksaan pasar tiap pagi: IHSG, harga emas dunia (dikonversi ke Rp/gram), dan kurs USD/IDR.
// Dikirim ke pemilik (WhatsApp + Telegram) pada jam tertentu di hari kerja, dan bisa diminta kapan saja lewat /pasar.
//
// Tiap data punya BEBERAPA sumber cadangan (semuanya tanpa API key); bila satu gagal (mis. Yahoo membalas HTTP 429),
// sumber berikutnya dicoba, dan sumber yang terakhir berhasil dicoba lebih dulu di panggilan berikutnya:
//   IHSG        Yahoo Finance (^JKSE)  ->  Stooq (^jci)
//   Emas dunia  xaus.com (spot)  ->  Yahoo Finance (GC=F)  ->  Stooq (xauusd)          US$ per troy ounce
//   Kurs USD/IDR  ExchangeRate-API (open.er-api.com, harian)  ->  Yahoo (IDR=X)  ->  Stooq (usdidr)
// Rp/gram = US$/oz x kurs / 31,1035. Itu ACUAN harga emas dunia, bukan harga jual/buyback Antam (Antam biasanya lebih tinggi).
// Semua sumber ini tidak resmi/gratis: bisa tertunda atau berubah. Bila semuanya gagal, bot mengatakannya terus terang
// (dengan alasan tiap sumber), tidak menebak angka. `/pasar tes` menampilkan hasil tiap sumber untuk diagnosis.
// Bukan saran investasi.
//
// Konfigurasi (.env):
//   MARKET_BRIEF_ENABLED=true        MARKET_BRIEF_TIME=07:30     (zona waktu WA_TIMEZONE)
//   MARKET_BRIEF_DAYS=1-5            (0=Minggu ... 6=Sabtu; bisa "1-5" atau "1,2,3,4,5")
//   MARKET_BRIEF_LATE_MIN=180        (bot baru menyala lewat jam kirim: masih dikirim sampai sekian menit; lewat itu dilewati)
//   MARKET_IHSG_SYMBOL=^JKSE  MARKET_GOLD_SYMBOL=GC=F  MARKET_FX_SYMBOL=IDR=X             (simbol Yahoo)
//   MARKET_IHSG_STOOQ=^jci    MARKET_GOLD_STOOQ=xauusd  MARKET_FX_STOOQ=usdidr            (simbol Stooq)
//   MARKET_TIMEOUT_MS=15000

export const TROY_OZ_GRAMS = 31.1035;
const STATE_KEY = "market_brief_date";
const LAST_KEY = "market_last";
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const MAX_ATTEMPTS = 3;
const RETRY_GAP_MS = 30 * 60_000;
const DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const FALSE_RE = /^(0|false|off|no|tidak|mati)$/i;

export function parseTime(raw, fallback = 7 * 60 + 30) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return h * 60 + min;
}

export function parseDays(raw, fallback = [1, 2, 3, 4, 5]) {
  const out = new Set();
  for (const part of String(raw ?? "").split(",")) {
    const p = part.trim();
    if (!p) continue;
    const range = /^([0-6])\s*-\s*([0-6])$/.exec(p);
    if (range) {
      let a = Number(range[1]);
      const b = Number(range[2]);
      for (let i = 0; i < 7; i++) {
        out.add(a);
        if (a === b) break;
        a = (a + 1) % 7;
      }
    } else if (/^[0-6]$/.test(p)) out.add(Number(p));
  }
  return out.size ? [...out].sort() : fallback;
}

export function readMarketBriefConfig(env = process.env) {
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const sym = (v, d) => String(v || d).trim();
  return {
    enabled: !FALSE_RE.test(String(env.MARKET_BRIEF_ENABLED ?? "true").trim()),
    atMinutes: parseTime(env.MARKET_BRIEF_TIME),
    days: parseDays(env.MARKET_BRIEF_DAYS),
    lateMin: num(env.MARKET_BRIEF_LATE_MIN, 180, 30, 720),
    ihsg: sym(env.MARKET_IHSG_SYMBOL, "^JKSE"),
    gold: sym(env.MARKET_GOLD_SYMBOL, "GC=F"),
    fx: sym(env.MARKET_FX_SYMBOL, "IDR=X"),
    ihsgStooq: sym(env.MARKET_IHSG_STOOQ, "^jci"),
    goldStooq: sym(env.MARKET_GOLD_STOOQ, "xauusd"),
    fxStooq: sym(env.MARKET_FX_STOOQ, "usdidr"),
    timeoutMs: num(env.MARKET_TIMEOUT_MS, 15000, 3000, 60000),
    userAgent: String(env.MARKET_USER_AGENT || DEFAULT_UA)
  };
}

/** Kenali /pasar, /emas, /ihsg (+ "tes" untuk diagnosis sumber). null bila bukan perintah. */
export function parseMarketCommand(text) {
  const m = /^\s*\/(?:pasar|emas|ihsg)(?:@\w+)?(?:\s+(tes|uji|debug|diagnosa))?\s*$/i.exec(String(text ?? ""));
  return m ? { diagnose: !!m[1] } : null;
}

// ------------------------------------------------------------ penguraian respons
class HttpError extends Error {
  constructor(status, snippet = "") {
    super(`HTTP ${status}${snippet ? ` ${snippet}` : ""}`);
    this.status = status;
  }
}

const cleanSnippet = (t) =>
  String(t ?? "")
    .replace(/\s+/g, " ")
    .replace(/(AIza[\w-]{10,}|gsk_[\w-]{10,}|sk-[\w-]{10,})/g, "…")
    .trim()
    .slice(0, 70);

/** Urai respons chart Yahoo -> { price, prev, asOfMs, lastCloseMs } atau melempar Error berisi alasan. */
export function parseChart(json, symbol = "") {
  const r = json?.chart?.result?.[0];
  if (!r) {
    const desc = json?.chart?.error?.description;
    throw new Error(desc ? `sumber menolak: ${String(desc).slice(0, 80)}` : "respons tidak berisi data");
  }
  const meta = r.meta || {};
  const closes = r.indicators?.quote?.[0]?.close || [];
  const ts = r.timestamp || [];
  const series = [];
  for (let i = 0; i < closes.length; i++) {
    const c = Number(closes[i]);
    if (closes[i] !== null && closes[i] !== undefined && Number.isFinite(c) && c > 0) series.push({ t: Number(ts[i]) * 1000 || 0, c });
  }
  const price = Number.isFinite(Number(meta.regularMarketPrice)) && Number(meta.regularMarketPrice) > 0 ? Number(meta.regularMarketPrice) : series.at(-1)?.c;
  if (!Number.isFinite(price) || price <= 0) throw new Error("harga tidak terbaca");
  let prev = null;
  if (series.length > 0) {
    const last = series[series.length - 1];
    const sameAsPrice = Math.abs(last.c - price) / price < 1e-6;
    prev = sameAsPrice ? (series.length >= 2 ? series[series.length - 2].c : null) : last.c;
  }
  if (prev === null && Number(meta.previousClose) > 0) prev = Number(meta.previousClose);
  const asOfMs = Number(meta.regularMarketTime) > 0 ? Number(meta.regularMarketTime) * 1000 : series.at(-1)?.t || 0;
  return { symbol: meta.symbol || symbol, price, prev, asOfMs, lastCloseMs: series.at(-1)?.t || asOfMs };
}

/** CSV harian Stooq (Date,Open,High,Low,Close,Volume) -> { price, prev, asOfMs, lastCloseMs }. */
export function parseStooqCsv(text) {
  const lines = String(text ?? "").trim().split(/\r?\n/);
  if (lines.length < 2 || !/^date\s*,/i.test(lines[0])) throw new Error("tidak ada data (simbol salah atau sumber menolak)");
  const head = lines[0].toLowerCase().split(",");
  const iDate = head.indexOf("date");
  const iClose = head.indexOf("close");
  if (iDate < 0 || iClose < 0) throw new Error("kolom CSV tidak dikenali");
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const c = Number(cells[iClose]);
    const t = Date.parse(`${String(cells[iDate]).trim()}T12:00:00Z`);
    if (Number.isFinite(c) && c > 0 && Number.isFinite(t)) rows.push({ t, c });
  }
  if (rows.length === 0) throw new Error("tidak ada baris harga");
  const last = rows[rows.length - 1];
  return { price: last.c, prev: rows.length >= 2 ? rows[rows.length - 2].c : null, asOfMs: last.t, lastCloseMs: last.t };
}

/** Respons xaus.com /api/v1/spot -> harga emas US$/oz. */
export function parseXaus(json) {
  if (json?.data_state?.status === "unavailable") throw new Error("sumber melaporkan data tidak tersedia");
  const price = Number(json?.spot_usd_oz ?? (json?.xau?.currency === "USD" ? json?.xau?.price : NaN));
  if (!Number.isFinite(price) || price <= 0) throw new Error("harga tidak terbaca");
  const asOf = Date.parse(json.price_as_of || json.updated_at || "") || 0;
  return { price, prev: null, asOfMs: asOf, lastCloseMs: asOf, stale: json?.data_state?.status === "stale" || json?.stale === true };
}

/** Respons open.er-api.com /v6/latest/USD -> rupiah per 1 US$. */
export function parseErApi(json) {
  if (json?.result !== "success") throw new Error(`sumber menolak${json?.["error-type"] ? `: ${String(json["error-type"]).slice(0, 40)}` : ""}`);
  const price = Number(json?.rates?.IDR);
  if (!Number.isFinite(price) || price <= 0) throw new Error("kurs IDR tidak ada");
  const asOf = Number(json.time_last_update_unix) > 0 ? Number(json.time_last_update_unix) * 1000 : 0;
  return { price, prev: null, asOfMs: asOf, lastCloseMs: asOf };
}

const SANE = { ihsg: [100, 100000], gold: [100, 100000], fx: [1000, 100000] };
function ensureSane(kind, q) {
  const [lo, hi] = SANE[kind];
  if (!(q.price >= lo && q.price <= hi)) throw new Error(`angka tidak masuk akal (${q.price})`);
  if (q.prev !== null && !(q.prev >= lo && q.prev <= hi)) q.prev = null;
  return q;
}

const LABELS = { yahoo: "Yahoo Finance", stooq: "Stooq", xaus: "xaus.com", erapi: "ExchangeRate-API (exchangerate-api.com)" };
const KIND_NAMES = { ihsg: "IHSG", gold: "Emas dunia", fx: "USD/IDR" };

// ------------------------------------------------------------ pengambilan data
export function createMarketData({ config, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), yahooGapMs = 1200, cacheMs = 5 * 60_000 } = {}) {
  const cache = new Map(); // "kind|sumber|simbol" -> { at, quote }
  const lastGood = new Map(); // kind -> indeks sumber yang terakhir berhasil
  let yahooChain = Promise.resolve();
  let yahooLast = 0;

  async function httpGet(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal, headers: { "User-Agent": config.userAgent, Accept: "application/json,text/csv,*/*", "Accept-Language": "en-US,en;q=0.9" } });
      if (!res.ok) {
        let snippet = "";
        try {
          snippet = cleanSnippet(await res.text());
        } catch {
          /* tanpa isi */
        }
        throw new HttpError(res.status, snippet);
      }
      return res;
    } catch (e) {
      if (e?.name === "AbortError") throw new Error(`waktu habis (${Math.round(config.timeoutMs / 1000)} dtk)`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Yahoo membatasi permintaan beruntun dari satu IP: semua panggilan Yahoo diantre dengan jeda.
  function yahoo(symbol) {
    const run = async () => {
      const wait = yahooLast + yahooGapMs - now();
      if (wait > 0) await sleep(wait);
      let lastErr = null;
      for (const host of YAHOO_HOSTS) {
        try {
          yahooLast = now();
          const res = await httpGet(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d`);
          return parseChart(await res.json(), symbol);
        } catch (e) {
          lastErr = e;
          if (!(e instanceof HttpError) && !/fetch failed|waktu habis|network|ECONN|ETIMEDOUT|ENOTFOUND/i.test(String(e?.message))) break;
        }
      }
      throw lastErr || new Error("gagal");
    };
    const p = yahooChain.then(run, run);
    yahooChain = p.catch(() => {});
    return p;
  }

  async function stooq(symbol) {
    const d = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
    const res = await httpGet(`https://stooq.com/q/d/l/?s=${encodeURIComponent(String(symbol).toLowerCase())}&i=d&d1=${d(now() - 14 * 86400_000)}&d2=${d(now() + 86400_000)}`);
    return parseStooqCsv(await res.text());
  }
  const xaus = async () => parseXaus(await (await httpGet("https://xaus.com/api/v1/spot")).json());
  const erapi = async () => parseErApi(await (await httpGet("https://open.er-api.com/v6/latest/USD")).json());

  const plan = () => ({
    ihsg: [["yahoo", config.ihsg, () => yahoo(config.ihsg)], ["stooq", config.ihsgStooq, () => stooq(config.ihsgStooq)]],
    gold: [["xaus", "", xaus], ["yahoo", config.gold, () => yahoo(config.gold)], ["stooq", config.goldStooq, () => stooq(config.goldStooq)]],
    fx: [["erapi", "", erapi], ["yahoo", config.fx, () => yahoo(config.fx)], ["stooq", config.fxStooq, () => stooq(config.fxStooq)]]
  });

  async function oneKind(kind, sources) {
    const order = sources.map((_, i) => i);
    const first = lastGood.get(kind);
    if (first !== undefined && first > 0) order.splice(order.indexOf(first), 1), order.unshift(first);
    const errors = [];
    for (const i of order) {
      const [id, sym, run] = sources[i];
      const ck = `${kind}|${id}|${sym}`;
      const hit = cache.get(ck);
      if (hit && now() - hit.at < cacheMs) {
        lastGood.set(kind, i);
        return { ok: true, quote: { ...hit.quote } };
      }
      try {
        const q = ensureSane(kind, { ...(await run()), source: id });
        cache.set(ck, { at: now(), quote: q });
        lastGood.set(kind, i);
        return { ok: true, quote: { ...q } };
      } catch (e) {
        errors.push(`${id}: ${String(e?.message || e).slice(0, 90)}`);
      }
    }
    return { ok: false, error: errors.join("; ").slice(0, 260) };
  }

  /** Ketiga data, masing-masing dengan sumber cadangannya; tiap data bisa gagal sendiri-sendiri. */
  async function fetchAll() {
    const p = plan();
    const [ihsg, gold, fx] = await Promise.all([oneKind("ihsg", p.ihsg), oneKind("gold", p.gold), oneKind("fx", p.fx)]);
    return { ihsg, gold, fx };
  }

  /** Coba SEMUA sumber satu per satu (tanpa cache) dan laporkan hasil tiap sumber, untuk diagnosis. */
  async function diagnose() {
    const lines = ["🔧 Uji sumber data pasar (tiap sumber dicoba sendiri-sendiri)"];
    const p = plan();
    for (const kind of ["ihsg", "gold", "fx"]) {
      lines.push("", `*${KIND_NAMES[kind]}*`);
      for (const [id, sym, run] of p[kind]) {
        try {
          const q = ensureSane(kind, await run());
          lines.push(`• ${LABELS[id].split(" (")[0]}${sym ? ` (${sym})` : ""}: OK ${q.price}${q.prev ? ` (sebelumnya ${q.prev})` : ""}`);
        } catch (e) {
          lines.push(`• ${LABELS[id].split(" (")[0]}${sym ? ` (${sym})` : ""}: GAGAL ${String(e?.message || e).slice(0, 110)}`);
        }
      }
    }
    lines.push("", "Kirim hasil ini bila ada yang GAGAL semua, supaya sumbernya bisa diganti.");
    return lines.join("\n");
  }
  return { fetchAll, diagnose };
}

// ------------------------------------------------------------ format
const nf = (digits) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const N0 = nf(0);
const N2 = nf(2);

function changeText(price, prev, digits) {
  if (prev === null || prev === undefined || !(prev > 0)) return "";
  const diff = price - prev;
  const pct = (diff / prev) * 100;
  if (Math.abs(pct) < 0.005) return "▬ tidak berubah";
  const f = digits === 0 ? N0 : N2;
  const s = diff > 0 ? "+" : "-";
  return `${diff > 0 ? "▲" : "▼"} ${s}${f.format(Math.abs(diff))} (${s}${N2.format(Math.abs(pct))}%)`;
}

const dayLabel = (ms, timeZone) => new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "short", timeZone }).format(new Date(ms));
const shortDay = (ms, timeZone) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone }).format(new Date(ms));

/** Teks laporan. data = hasil fetchAll() (boleh sudah diisi prev dari laporan sebelumnya: quote.prevNote = ms). */
export function formatBrief(data, { nowMs = Date.now(), timeZone = "Asia/Jakarta" } = {}) {
  const lines = [`📈 *Pasar pagi — ${dayLabel(nowMs, timeZone)}*`, ""];
  const stale = (q) => q.stale || nowMs - q.lastCloseMs > 4 * 86400_000;
  const used = new Set();
  const noted = [];
  const note = (name, q) => {
    used.add(q.source);
    if (q.prevNote) noted.push({ name, ms: q.prevNote });
  };

  if (data.ihsg.ok) {
    const q = data.ihsg.quote;
    note("IHSG", q);
    lines.push(`*IHSG* ${N2.format(q.price)} ${changeText(q.price, q.prev, 2)}`.trim());
    lines.push(`   data penutupan ${dayLabel(q.lastCloseMs, timeZone)}${stale(q) ? " ⚠️ sudah lama (libur panjang atau data tertunda)" : ""}`);
  } else lines.push(`*IHSG*: data tidak terbaca (${data.ihsg.error})`);
  lines.push("");

  if (data.gold.ok) {
    const g = data.gold.quote;
    note("emas", g);
    lines.push(`*Emas dunia* US$ ${N2.format(g.price)}/oz ${changeText(g.price, g.prev, 2)}${stale(g) ? " ⚠️ data lama" : ""}`.trim());
    if (data.fx.ok) {
      const fx = data.fx.quote;
      const perGram = (g.price * fx.price) / TROY_OZ_GRAMS;
      const prevGram = g.prev !== null && fx.prev !== null && g.prev !== undefined && fx.prev !== undefined ? (g.prev * fx.prev) / TROY_OZ_GRAMS : null;
      lines.push(`   ≈ *Rp ${N0.format(perGram)}/gram* ${changeText(perGram, prevGram, 0)}`.trimEnd());
      lines.push(`   (kurs Rp ${N0.format(fx.price)}; acuan harga dunia, harga jual Antam biasanya lebih tinggi)`);
    } else lines.push(`   konversi ke Rp/gram tidak bisa (kurs tidak terbaca)`);
  } else lines.push(`*Emas dunia*: data tidak terbaca (${data.gold.error})`);
  lines.push("");

  if (data.fx.ok) {
    const fx = data.fx.quote;
    note("kurs", fx);
    lines.push(`*USD/IDR* Rp ${N0.format(fx.price)} ${changeText(fx.price, fx.prev, 0)}${stale(fx) ? " ⚠️ data lama" : ""}`.trim());
  } else lines.push(`*USD/IDR*: data tidak terbaca (${data.fx.error})`);

  if (noted.length) lines.push("", `Selisih ${noted.map((n) => n.name).join(", ")} dibanding laporan terakhir (${shortDay(noted[0].ms, timeZone)}).`);
  const labels = [...used].map((u) => LABELS[u]).filter(Boolean);
  lines.push("", `Sumber: ${labels.length ? labels.join(", ") : "tidak ada yang terbaca"} (tidak resmi, bisa tertunda). Bukan saran investasi.`);
  return lines.join("\n");
}

// ------------------------------------------------------------ penjadwal
const localDate = (ms, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(ms));
function localParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * deps: config, data { fetchAll, diagnose }, state { get, set }, send(text), now(), timeZone, log
 */
export function createMarketBrief({ config, data, state, send, now = () => Date.now(), timeZone = "Asia/Jakarta", log = console } = {}) {
  let running = false;
  let attempts = { date: null, count: 0, lastMs: 0 };

  const describe = () =>
    config.enabled
      ? `AKTIF (${String(Math.floor(config.atMinutes / 60)).padStart(2, "0")}:${String(config.atMinutes % 60).padStart(2, "0")}, hari ${config.days.map((d) => ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"][d]).join(" ")}; /pasar untuk sekarang)`
      : "mati (MARKET_BRIEF_ENABLED=true untuk menyalakan; /pasar tetap bisa dipakai)";

  async function loadLast() {
    try {
      const j = JSON.parse((await state.get(LAST_KEY)) || "{}");
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }

  /** Laporan sekarang (untuk /pasar dan kiriman pagi). Sumber yang tak punya "penutupan sebelumnya" memakai angka laporan terakhir. */
  async function report() {
    const d = await data.fetchAll();
    const last = await loadLast();
    const today = localDate(now(), timeZone);
    for (const kind of ["ihsg", "gold", "fx"]) {
      const q = d[kind].ok ? d[kind].quote : null;
      const stored = last[kind];
      if (q && (q.prev === null || q.prev === undefined) && stored && Number(stored.price) > 0 && stored.date && stored.date !== today) {
        q.prev = Number(stored.price);
        q.prevNote = Date.parse(`${stored.date}T12:00:00Z`) || now();
      }
    }
    return { text: formatBrief(d, { nowMs: now(), timeZone }), anyOk: d.ihsg.ok || d.gold.ok || d.fx.ok, data: d };
  }

  async function remember(d, today) {
    try {
      const last = await loadLast();
      for (const kind of ["ihsg", "gold", "fx"]) if (d[kind].ok) last[kind] = { price: d[kind].quote.price, date: today };
      await state.set(LAST_KEY, JSON.stringify(last));
    } catch (e) {
      log.warn?.(`📈 gagal menyimpan angka laporan (selisih besok mungkin kosong): ${e?.message || e}`);
    }
  }

  async function check() {
    if (!config.enabled || running) return false;
    const t = now();
    const today = localDate(t, timeZone);
    const { day, minutes } = localParts(t, timeZone);
    if (!config.days.includes(day) || minutes < config.atMinutes) return false;
    if (attempts.date !== today) attempts = { date: today, count: 0, lastMs: 0 };
    if (attempts.count >= MAX_ATTEMPTS + 2) return false;
    if (t - attempts.lastMs < RETRY_GAP_MS && attempts.count > 0) return false;
    if ((await state.get(STATE_KEY)) === today) return false;
    if (minutes > config.atMinutes + config.lateMin) {
      // bot baru menyala terlambat: lewati hari ini daripada mengirim "pagi" di tengah hari
      await state.set(STATE_KEY, today).catch(() => {});
      log.log?.(`📈 Pasar pagi dilewati hari ini (bot baru menyala lewat batas ${config.lateMin} menit dari jam kirim).`);
      return false;
    }
    running = true;
    attempts.count += 1;
    attempts.lastMs = t;
    try {
      const r = await report();
      if (!r.anyOk && attempts.count < MAX_ATTEMPTS) {
        log.warn?.(`📈 Pasar pagi: semua sumber gagal (percobaan ${attempts.count}/${MAX_ATTEMPTS}), coba lagi 30 menit lagi.`);
        return false;
      }
      await send(r.anyOk ? r.text : `📈 *Pasar pagi*: semua sumber data gagal dibaca setelah ${MAX_ATTEMPTS} percobaan (jaringan atau sumber bermasalah). Ketik /pasar tes untuk melihat alasan tiap sumber.`);
      if (r.anyOk) await remember(r.data, today);
      await state.set(STATE_KEY, today);
      log.log?.(`📈 Pasar pagi terkirim${r.anyOk ? "" : " (hanya pemberitahuan gagal)"}.`);
      return true;
    } catch (e) {
      log.error?.(`📈 Pasar pagi gagal (dicoba lagi nanti): ${e?.message || e}`);
      return false;
    } finally {
      running = false;
    }
  }

  return { check, report, describe, diagnose: () => data.diagnose() };
}
