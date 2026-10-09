// ================================================================
// Pemantau perubahan peraturan: tiap minggu mencari kabar terbaru lewat API pencarian web
// (Tavily/Serper/Brave -- Bing TIDAK dipakai karena tak bisa menyaring tanggal), membuang yang sudah pernah
// dilaporkan, memisahkan sumber resmi (.go.id) dari berita, meminta AI menyaring & merangkum, lalu
// mengirim ringkasannya lewat WhatsApp ke nomor pemilik.
//
// Modul ini tidak tahu apa-apa soal WhatsApp/Supabase/Ollama: semuanya disuntikkan dari index.js
// (search, ai, state, send), jadi bisa dites dengan data palsu (test-reg-monitor.mjs).
//
// Konfigurasi (.env), semuanya opsional:
//   REG_MONITOR_ENABLED=true                 (false = mati)
//   REG_MONITOR_TOPICS=Label|kata pencarian;Label lain|kata pencarian   ({year} diganti tahun berjalan)
//   REG_MONITOR_DAY=1                        (0=Minggu ... 6=Sabtu; bawaan Senin)
//   REG_MONITOR_HOUR=7                       (jam lokal WA_TIMEZONE)
//   REG_MONITOR_RECENT=month                 (week | month | year: seberapa baru hasil yang dicari)
//   REG_MONITOR_MAX_ITEMS=8                  (maks butir per laporan)
//   REG_MONITOR_OFFICIAL_DOMAINS=go.id       (akhiran domain yang dianggap sumber resmi, dipisah koma)
// ================================================================

export const DEFAULT_TOPICS = [
  { label: "PMK & perbendaharaan", query: "Peraturan Menteri Keuangan terbaru perbendaharaan negara {year}" },
  { label: "Bendahara pengeluaran", query: "aturan baru bendahara pengeluaran pelaksanaan anggaran belanja {year}" },
  { label: "Pajak belanja pemerintah", query: "ketentuan baru pemungutan pajak bendahara pemerintah PPh PPN {year}" },
  { label: "Anggaran & DIPA", query: "peraturan Direktur Jenderal Perbendaharaan terbaru DIPA revisi anggaran {year}" }
];

const splitList = (s, sep = ",") =>
  String(s || "")
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);

export function readRegMonitorConfig(env = process.env) {
  const get = typeof env === "function" ? env : (n) => env[n];
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && String(v ?? "").trim() !== "" ? Math.min(hi, Math.max(lo, Math.floor(Number(v)))) : d);
  let topics = splitList(get("REG_MONITOR_TOPICS"), ";")
    .map((x) => {
      const i = x.indexOf("|");
      return i > 0 ? { label: x.slice(0, i).trim(), query: x.slice(i + 1).trim() } : { label: x.slice(0, 40), query: x };
    })
    .filter((t) => t.query);
  if (topics.length === 0) topics = DEFAULT_TOPICS.map((t) => ({ ...t }));
  const recentRaw = String(get("REG_MONITOR_RECENT") || "month").trim().toLowerCase();
  return {
    enabled: String(get("REG_MONITOR_ENABLED") ?? "true").trim().toLowerCase() !== "false",
    topics,
    day: num(get("REG_MONITOR_DAY"), 1, 0, 6),
    hour: num(get("REG_MONITOR_HOUR"), 7, 0, 23),
    recent: ["week", "month", "year"].includes(recentRaw) ? recentRaw : "month",
    maxItems: num(get("REG_MONITOR_MAX_ITEMS"), 8, 1, 20),
    officialDomains: splitList(get("REG_MONITOR_OFFICIAL_DOMAINS") || "go.id").map((d) => d.toLowerCase().replace(/^\./, ""))
  };
}

// URL yang sama ditulis beda (utm, #, garis miring akhir, www) dianggap satu.
export function normalizeUrl(url) {
  try {
    const u = new URL(String(url));
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "";
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return "";
  }
}

export function isOfficial(url, domains) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function zonedParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(new Date(ms));
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return { year: Number(o.year), month: Number(o.month), day: Number(o.day), hour: Number(o.hour) };
}

// Jadwal mingguan: "slot" = tanggal lokal kemunculan terakhir (hari + jam yang diatur) yang sudah lewat.
// Bot mati saat jadwal -> begitu hidup lagi, slot itu tetap dijalankan (sekali).
export function currentSlot(nowMs, timeZone, day, hour) {
  const p = zonedParts(nowMs, timeZone);
  const base = Date.UTC(p.year, p.month - 1, p.day);
  const weekday = new Date(base).getUTCDay();
  let back = (weekday - day + 7) % 7;
  if (back === 0 && p.hour < hour) back = 7;
  return new Date(base - back * 86400_000).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function formatDateId(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

const AI_SYSTEM = `Kamu menyaring hasil pencarian web untuk seorang bendahara pengeluaran instansi pemerintah Indonesia yang ingin tahu ada peraturan atau ketentuan BARU (atau perubahannya) di bidang keuangan negara.
Kamu diberi daftar butir bernomor (judul, cuplikan, domain). Untuk tiap butir tentukan "relevan":
- true HANYA kalau butir itu tentang peraturan/ketentuan/surat edaran/kebijakan keuangan negara yang baru terbit atau berubah dan berguna bagi bendahara.
- false untuk iklan, jasa konsultan, opini, tutorial umum, lowongan, berita yang tidak terkait, atau yang jelas peraturan lama.
Untuk yang relevan, tulis "ringkasan" SATU kalimat bahasa Indonesia (maks 200 karakter) HANYA berdasarkan judul dan cuplikan. Jangan menambah nomor peraturan, angka, tanggal, atau isi yang tidak tertulis di cuplikan. Kalau cuplikan tidak cukup menjelaskan isinya, tulis "Perlu dibuka sumbernya untuk detailnya."
Balas HANYA dengan JSON, tanpa teks lain, bentuk: {"items":[{"n":1,"relevan":true,"ringkasan":"..."}]}`;

// Ambil JSON dari balasan AI yang kadang dibungkus ```json atau ditambah kalimat pembuka.
export function parseAiVerdicts(text, count) {
  let raw = String(text || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let json;
  try {
    json = JSON.parse(raw.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(json?.items)) return null;
  const out = new Map();
  for (const it of json.items) {
    const n = Number(it?.n);
    if (!Number.isInteger(n) || n < 1 || n > count) continue;
    out.set(n, { relevan: it.relevan === true, ringkasan: String(it.ringkasan || "").replace(/\s+/g, " ").trim().slice(0, 260) });
  }
  return out.size > 0 ? out : null;
}

// Potong pesan panjang di batas paragraf (batas aman WhatsApp ±4000 karakter).
export function splitMessage(text, max = 3500) {
  if (text.length <= max) return [text];
  const chunks = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if (cur && (cur + "\n\n" + para).length > max) {
      chunks.push(cur);
      cur = para;
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const SEEN_KEY = "reg_monitor_seen";
const SLOT_KEY = "reg_monitor_slot";
const SEEN_KEEP_MS = 150 * 86400_000;
const RETRY_GAP_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;

// Deps (semua disuntikkan):
//   search(query, max, {recent, snippetChars}) -> [{title, snippet, url}]   (webSearch.search)
//   searchAvailable() -> boolean (ada key API pencarian?)
//   ai(system, user) -> string | throws   (boleh null = tanpa AI)
//   state: { get(key) -> string|null, set(key, value) }
//   send(text) -> Promise (kirim ke pemilik)
export function createRegMonitor({ config, search, searchAvailable, ai = null, state, send, now = () => Date.now(), timeZone = "Asia/Jakarta", log = console }) {
  let running = false;
  let attempts = { slot: null, count: 0, lastMs: 0 };
  let warnedNoSearch = false;

  const describe = () =>
    config.enabled
      ? `AKTIF (tiap ${["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][config.day]} ${String(config.hour).padStart(2, "0")}:00, ${config.topics.length} topik, hasil ${config.recent === "week" ? "seminggu" : config.recent === "month" ? "sebulan" : "setahun"} terakhir)`
      : "mati";

  async function loadSeen() {
    try {
      const j = JSON.parse((await state.get(SEEN_KEY)) || "{}");
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }

  // Satu putaran: cari -> saring -> rangkum -> teks. Return { text, candidates, rawCount, seenAfter } (tidak mengirim).
  async function build({ ignoreSeen = false } = {}) {
    const year = zonedParts(now(), timeZone).year;
    const seen = ignoreSeen ? {} : await loadSeen();
    const byKey = new Map();
    let rawCount = 0;
    for (const topic of config.topics) {
      const query = topic.query.replaceAll("{year}", String(year));
      let rows = [];
      try {
        rows = await search(query, 8, { recent: config.recent, snippetChars: 300 });
      } catch (e) {
        log.warn?.(`📜 Pantauan peraturan: pencarian "${topic.label}" gagal: ${e?.message || e}`);
      }
      rawCount += rows.length;
      for (const r of rows) {
        const key = normalizeUrl(r.url);
        if (!key || seen[key] || byKey.has(key)) continue;
        byKey.set(key, { key, title: r.title || r.url, snippet: r.snippet || "", url: r.url, topic: topic.label, official: isOfficial(r.url, config.officialDomains) });
      }
    }
    // Resmi dulu, lalu berita; dibatasi maxItems (sebagian besar jatah untuk sumber resmi).
    const all = [...byKey.values()];
    const officialItems = all.filter((x) => x.official).slice(0, Math.ceil(config.maxItems * 0.7));
    const otherItems = all.filter((x) => !x.official).slice(0, config.maxItems - officialItems.length);
    const candidates = [...officialItems, ...otherItems];

    let verdicts = null;
    let aiNote = "";
    if (candidates.length > 0 && ai) {
      const list = candidates
        .map((c, i) => `${i + 1}. Judul: ${c.title}\n   Cuplikan: ${c.snippet || "(kosong)"}\n   Domain: ${(() => { try { return new URL(c.url).hostname; } catch { return "?"; } })()}`)
        .join("\n\n");
      try {
        verdicts = parseAiVerdicts(await ai(AI_SYSTEM, `Daftar hasil pencarian:\n\n${list}`), candidates.length);
        if (!verdicts) aiNote = "_(Penyaringan AI gagal dibaca, daftar di bawah belum disaring.)_";
      } catch (e) {
        log.warn?.(`📜 Pantauan peraturan: AI gagal: ${e?.message || e}`);
        aiNote = "_(AI sedang tidak tersedia, daftar di bawah belum disaring.)_";
      }
    } else if (candidates.length > 0 && !ai) {
      aiNote = "_(Belum ada AI untuk menyaring, daftar di bawah belum disaring.)_";
    }

    const kept = candidates
      .map((c, i) => ({ ...c, verdict: verdicts?.get(i + 1) }))
      // Dengan AI: buang yang dinilai tidak relevan (butir yang tak disebut AI dianggap tak relevan).
      .filter((c) => (verdicts ? c.verdict?.relevan === true : true));

    const fmt = (c, i) => {
      const sum = c.verdict?.ringkasan ? `\n   ${c.verdict.ringkasan}` : c.snippet && !verdicts ? `\n   ${c.snippet.slice(0, 160)}` : "";
      return `${i + 1}. *${c.title.replace(/\s+/g, " ").slice(0, 140)}*${sum}\n   🔗 ${c.url}`;
    };
    const keptOfficial = kept.filter((c) => c.official);
    const keptOther = kept.filter((c) => !c.official);
    const header = `📜 *Pantauan peraturan* — ${formatDateId(now(), timeZone)}\nTopik: keuangan negara / bendahara`;
    const footer = "_Hasil pencarian otomatis, bukan nasihat hukum. Baca peraturan aslinya sebelum dipakai._";
    let text;
    if (kept.length === 0) {
      text = `${header}\n\nTidak ada kabar peraturan baru yang ditemukan${rawCount > 0 ? " (yang muncul sudah pernah dilaporkan atau tidak relevan)" : ""}.\n\n${footer}`;
    } else {
      const blocks = [header];
      if (aiNote) blocks.push(aiNote);
      if (keptOfficial.length) blocks.push(`🏛️ *Sumber resmi (${config.officialDomains.map((d) => `.${d}`).join(", ")})*\n\n${keptOfficial.map(fmt).join("\n\n")}`);
      if (keptOther.length) blocks.push(`📰 *Berita & pendukung (belum tentu resmi)*\n\n${keptOther.map((c, i) => fmt(c, i)).join("\n\n")}`);
      blocks.push(footer);
      text = blocks.join("\n\n");
    }
    return { text, candidates, kept, rawCount };
  }

  async function markSeen(candidates) {
    const seen = await loadSeen();
    const t = now();
    for (const c of candidates) seen[c.key] = t;
    for (const [k, v] of Object.entries(seen)) if (t - Number(v) > SEEN_KEEP_MS) delete seen[k];
    await state.set(SEEN_KEY, JSON.stringify(seen));
  }

  // Perintah manual dari pemilik. all=true: abaikan "sudah pernah dilaporkan" dan jangan menandai (buat tes).
  async function runNow({ all = false } = {}) {
    if (running) return { ok: false, reason: "sedang berjalan" };
    if (!searchAvailable()) {
      await send("📜 Pantauan peraturan butuh key API pencarian (TAVILY_API_KEYS / SERPER_API_KEYS / BRAVE_API_KEYS di .env bot). Bing saja tidak cukup karena tak bisa menyaring tanggal.");
      return { ok: false, reason: "tanpa key" };
    }
    running = true;
    try {
      await send("⏳ Mencari kabar peraturan terbaru…");
      const r = await build({ ignoreSeen: all });
      for (const part of splitMessage(r.text)) await send(part);
      if (!all) await markSeen(r.candidates);
      return { ok: true, count: r.kept.length };
    } catch (e) {
      log.error?.(`📜 Pantauan peraturan (manual) gagal: ${e?.message || e}`);
      await send(`⚠️ Pantauan peraturan gagal: ${String(e?.message || e).slice(0, 200)}`).catch(() => {});
      return { ok: false, reason: String(e?.message || e) };
    } finally {
      running = false;
    }
  }

  // Dipanggil tiap menit dari index.js. Menjalankan jadwal mingguan (sekali per slot).
  async function check() {
    if (!config.enabled || running) return;
    const slot = currentSlot(now(), timeZone, config.day, config.hour);
    if (attempts.slot !== slot) attempts = { slot, count: 0, lastMs: 0 };
    if (attempts.count >= MAX_ATTEMPTS * 2) return; // gagal terus (mis. kirim WA error): berhenti sampai slot berikutnya
    if (now() - attempts.lastMs < RETRY_GAP_MS) return;
    if ((await state.get(SLOT_KEY)) === slot) return;
    if (!searchAvailable()) {
      if (!warnedNoSearch) {
        warnedNoSearch = true;
        log.warn?.("📜 Pantauan peraturan dilewati: belum ada key API pencarian (TAVILY_API_KEYS / SERPER_API_KEYS / BRAVE_API_KEYS).");
      }
      return;
    }
    running = true;
    attempts.count += 1;
    attempts.lastMs = now();
    try {
      const r = await build();
      // Semua pencarian kosong = kemungkinan gangguan: coba lagi nanti (maks 3x), baru lapor "tak ada hasil".
      if (r.rawCount === 0 && attempts.count < MAX_ATTEMPTS) {
        log.warn?.(`📜 Pantauan peraturan: semua pencarian kosong (percobaan ${attempts.count}/${MAX_ATTEMPTS}), coba lagi 30 menit lagi.`);
        return;
      }
      const text = r.rawCount === 0 ? "📜 *Pantauan peraturan*: pencarian minggu ini tidak mengembalikan data sama sekali (kemungkinan jatah/layanan pencarian bermasalah). Cek menu Status Sistem di aplikasi." : r.text;
      for (const part of splitMessage(text)) await send(part);
      await markSeen(r.candidates);
      await state.set(SLOT_KEY, slot);
      log.log?.(`📜 Pantauan peraturan terkirim (${r.kept.length} butir).`);
    } catch (e) {
      log.error?.(`📜 Pantauan peraturan gagal (dicoba lagi nanti): ${e?.message || e}`);
    } finally {
      running = false;
    }
  }

  return { check, runNow, describe, build };
}
