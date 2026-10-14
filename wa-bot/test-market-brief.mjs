// Tes pemeriksaan pasar pagi (IHSG, emas, kurs): market-brief.js + perintah Telegram.
//   node test-market-brief.mjs
import { createMarketBrief, createMarketData, formatBrief, parseChart, parseDays, parseErApi, parseStooqCsv, parseTime, parseMarketCommand, parseXaus, readMarketBriefConfig, TROY_OZ_GRAMS } from "./market-brief.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };

// ---- fixture bentuk respons Yahoo (chart.result[0].meta / timestamp / indicators.quote[0].close)
const D = 86400;
const t0 = Date.UTC(2026, 9, 9, 8, 0) / 1000; // Jumat 9 Okt 2026
const chartJson = (symbol, closes, price, extra = {}) => ({
  chart: {
    result: [{
      meta: { symbol, currency: "X", regularMarketPrice: price, chartPreviousClose: closes[0], regularMarketTime: t0 + (closes.length - 1) * D, ...extra },
      timestamp: closes.map((_, i) => t0 + i * D),
      indicators: { quote: [{ close: closes }] }
    }],
    error: null
  }
});

// ---- konfigurasi & parser kecil
{
  const d = readMarketBriefConfig({});
  check(d.enabled === true && d.atMinutes === 450 && d.days.join() === "1,2,3,4,5" && d.lateMin === 180 && d.ihsg === "^JKSE" && d.gold === "GC=F" && d.fx === "IDR=X", "config: bawaan aktif 07:30 Sen-Jum, simbol Yahoo");
  check(d.ihsgStooq === "^jci" && d.goldStooq === "xauusd" && d.fxStooq === "usdidr", "config: simbol Stooq bawaan");
  const c = readMarketBriefConfig({ MARKET_BRIEF_ENABLED: "false", MARKET_BRIEF_TIME: "6.05", MARKET_BRIEF_DAYS: "0,6", MARKET_BRIEF_LATE_MIN: "5", MARKET_TIMEOUT_MS: "999999", MARKET_IHSG_STOOQ: "^xyz" });
  check(c.enabled === false && c.atMinutes === 365 && c.days.join() === "0,6" && c.lateMin === 30 && c.timeoutMs === 60000 && c.ihsgStooq === "^xyz", "config: nilai dibaca & dibatasi");
  check(parseTime("25:00") === 450 && parseTime("abc") === 450 && parseTime("09:15") === 555, "waktu: tak valid -> bawaan");
  check(parseDays("1-5").join() === "1,2,3,4,5" && parseDays("5-1").join() === "0,1,5,6" && parseDays("x").join() === "1,2,3,4,5" && parseDays("2,2,3").join() === "2,3", "hari: rentang, rentang melingkar, tak valid -> bawaan, duplikat");
  check(parseMarketCommand("/pasar").diagnose === false && parseMarketCommand("/Emas").diagnose === false && parseMarketCommand("/ihsg@bot").diagnose === false && parseMarketCommand("/pasar x") === null && parseMarketCommand("pasar") === null && parseMarketCommand("/pasaran") === null, "perintah: /pasar /emas /ihsg saja");
  check(parseMarketCommand("/pasar tes").diagnose === true && parseMarketCommand("/pasar DIAGNOSA").diagnose === true && parseMarketCommand("/emas uji").diagnose === true, "perintah: /pasar tes -> diagnosis");
}

// ---- parseChart
{
  const a = parseChart(chartJson("^JKSE", [7400, 7450, 7500], 7500));
  check(a.price === 7500 && a.prev === 7450, "parse: harga sekarang = penutupan terakhir -> pembanding = penutupan sebelumnya");
  const b = parseChart(chartJson("^JKSE", [7400, 7450, 7500], 7520));
  check(b.price === 7520 && b.prev === 7500, "parse: harga berjalan beda dari penutupan terakhir -> pembanding = penutupan terakhir");
  const c = parseChart(chartJson("X", [null, 7450, null, 7500], 7500));
  check(c.price === 7500 && c.prev === 7450, "parse: nilai null di deret dilewati");
  const d = parseChart(chartJson("X", [7500], 7500, { previousClose: 7480 }));
  check(d.prev === 7480, "parse: deret satu titik -> pakai meta.previousClose");
  check(parseChart(chartJson("X", [7500], 7500)).prev === null, "parse: tak ada pembanding -> null");
  const e = parseChart({ chart: { result: [{ meta: {}, timestamp: [t0], indicators: { quote: [{ close: [7123.4] }] } }] } });
  check(e.price === 7123.4, "parse: tanpa regularMarketPrice -> penutupan terakhir");
  const thrown = (j) => { try { parseChart(j); return ""; } catch (x) { return x.message; } };
  check(thrown({ chart: { result: null, error: { description: "No data found" } } }).includes("No data found") && thrown({}).includes("tidak berisi data") && thrown({ chart: { result: [{ meta: {}, timestamp: [], indicators: { quote: [{ close: [] }] } }] } }).includes("harga tidak terbaca"), "parse: galat sumber / kosong / tanpa harga -> pesan jelas");
}

// ---- parser sumber cadangan
{
  const csv = "Date,Open,High,Low,Close,Volume\n2026-10-07,7390,7420,7380,7400,0\n2026-10-08,7400,7460,7395,7450,0\n2026-10-09,7450,7510,7440,7500,0\n";
  const a = parseStooqCsv(csv);
  check(a.price === 7500 && a.prev === 7450 && a.asOfMs === Date.UTC(2026, 9, 9, 12), "stooq: baris terakhir = harga, sebelumnya = pembanding, tanggal terbaca");
  check(parseStooqCsv("Date,Open,High,Low,Close\n2026-10-09,1,2,3,4500.5\n").prev === null, "stooq: satu baris -> tanpa pembanding");
  const thrown = (fn) => { try { fn(); return ""; } catch (x) { return x.message; } };
  check(thrown(() => parseStooqCsv("No data")).includes("tidak ada data") && thrown(() => parseStooqCsv("")).includes("tidak ada data") && thrown(() => parseStooqCsv("Date,Open\n2026-10-09,1")).includes("kolom") && thrown(() => parseStooqCsv("Date,Close\nx,N/D")).includes("tidak ada baris"), "stooq: kosong / bukan CSV / kolom hilang / N/D -> pesan jelas");

  const x = parseXaus({ spot_usd_oz: 4112.5, price_as_of: "2026-10-12T00:00:00Z", data_state: { status: "live" } });
  check(x.price === 4112.5 && x.prev === null && x.asOfMs === Date.UTC(2026, 9, 12) && x.stale === false, "xaus: harga & waktu terbaca");
  check(parseXaus({ xau: { currency: "USD", price: 4000 } }).price === 4000 && parseXaus({ spot_usd_oz: 1, data_state: { status: "stale" } }).stale === true, "xaus: bentuk alternatif + penanda data lama");
  check(thrown(() => parseXaus({ data_state: { status: "unavailable" } })).includes("tidak tersedia") && thrown(() => parseXaus({})).includes("tidak terbaca"), "xaus: tidak tersedia / kosong -> pesan jelas");

  const e = parseErApi({ result: "success", time_last_update_unix: 1760227200, rates: { IDR: 16250.5 } });
  check(e.price === 16250.5 && e.asOfMs === 1760227200000 && e.prev === null, "er-api: kurs IDR terbaca");
  check(thrown(() => parseErApi({ result: "error", "error-type": "quota-reached" })).includes("quota-reached") && thrown(() => parseErApi({ result: "success", rates: {} })).includes("tidak ada"), "er-api: ditolak / tanpa IDR -> pesan jelas");
}

// ---- pengambilan (fetch palsu, banyak sumber)
const YAHOO_DEFAULT = {
  "^JKSE": chartJson("^JKSE", [7400, 7450, 7500], 7500),
  "GC=F": chartJson("GC=F", [4090, 4125, 4112.5], 4112.5),
  "IDR=X": chartJson("IDR=X", [16200, 16225, 16250], 16250)
};
const STOOQ_DEFAULT = {
  "^jci": "Date,Open,High,Low,Close,Volume\n2026-10-08,1,1,1,7450,0\n2026-10-09,1,1,1,7500,0\n",
  xauusd: "Date,Open,High,Low,Close,Volume\n2026-10-08,1,1,1,4125,0\n2026-10-09,1,1,1,4112.5,0\n",
  usdidr: "Date,Open,High,Low,Close,Volume\n2026-10-08,1,1,1,16225,0\n2026-10-09,1,1,1,16250,0\n"
};
const XAUS_DEFAULT = { spot_usd_oz: 4112.5, price_as_of: "2026-10-09T08:00:00Z", data_state: { status: "live" } };
const ERAPI_DEFAULT = { result: "success", time_last_update_unix: Math.floor(Date.UTC(2026, 9, 9) / 1000), rates: { IDR: 16250 } };

/**
 * over: kunci "yahoo:^JKSE" | "stooq:^jci" | "xaus" | "erapi" | "yahoo:*" ... -> angka (status HTTP) | Error | nilai pengganti
 * Nilai default tiap sumber memberi angka yang sama supaya hasil mudah dibandingkan.
 */
const multiFetch = (over = {}) => {
  const calls = [];
  const f = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, headers: init?.headers });
    let key;
    let body;
    if (u.includes("finance.yahoo.com")) {
      const sym = decodeURIComponent(u.match(/chart\/([^?]+)/)[1]);
      key = `yahoo:${sym}`;
      body = YAHOO_DEFAULT[sym];
    } else if (u.includes("stooq.com")) {
      const sym = decodeURIComponent(u.match(/[?&]s=([^&]+)/)[1]);
      key = `stooq:${sym}`;
      body = STOOQ_DEFAULT[sym];
    } else if (u.includes("xaus.com")) {
      key = "xaus";
      body = XAUS_DEFAULT;
    } else if (u.includes("open.er-api.com")) {
      key = "erapi";
      body = ERAPI_DEFAULT;
    } else throw new Error(`URL tak dikenal di tes: ${u}`);
    const group = key.includes(":") ? `${key.split(":")[0]}:*` : key;
    const o = key in over ? over[key] : group in over ? over[group] : undefined;
    if (o instanceof Error) throw o;
    if (typeof o === "number") return { ok: false, status: o, text: async () => "Too Many Requests", json: async () => ({}) };
    const val = o !== undefined ? o : body;
    return { ok: true, status: 200, json: async () => val, text: async () => (typeof val === "string" ? val : JSON.stringify(val)) };
  };
  f.calls = calls;
  f.count = (needle) => calls.filter((c) => c.url.includes(needle)).length;
  return f;
};
const cfg = readMarketBriefConfig({});
const mkData = (fetchImpl, extra = {}) => createMarketData({ config: cfg, fetchImpl, sleep: async () => {}, ...extra });

{
  const f = multiFetch();
  const all = await mkData(f).fetchAll();
  check(all.ihsg.ok && all.gold.ok && all.fx.ok && all.ihsg.quote.price === 7500, "ambil: tiga data terbaca");
  check(all.gold.quote.source === "xaus" && all.fx.quote.source === "erapi" && all.ihsg.quote.source === "yahoo", "ambil: emas dari xaus.com, kurs dari ExchangeRate-API, IHSG dari Yahoo (sumber utama)");
  check(f.count("finance.yahoo.com") === 1 && f.count("xaus.com") === 1 && f.count("open.er-api.com") === 1 && f.count("stooq.com") === 0, "ambil: Yahoo hanya dipanggil untuk IHSG (emas & kurs tidak membebani Yahoo)");
  check(f.calls.some((c) => c.url.includes("query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?")) && /Mozilla/.test(f.calls.find((c) => c.url.includes("yahoo")).headers["User-Agent"]), "ambil: alamat Yahoo benar (^ di-encode) + User-Agent");

  // semua Yahoo 429 -> IHSG jatuh ke Stooq; emas & kurs tidak terpengaruh
  const f2 = multiFetch({ "yahoo:*": 429 });
  const r2 = await mkData(f2).fetchAll();
  check(r2.ihsg.ok && r2.ihsg.quote.source === "stooq" && r2.ihsg.quote.price === 7500 && r2.ihsg.quote.prev === 7450 && r2.gold.ok && r2.fx.ok, "ambil: Yahoo 429 -> IHSG memakai Stooq, emas & kurs tetap terbaca");
  check(f2.count("query1") === 1 && f2.count("query2") === 1, "ambil: Yahoo 429 -> host cadangan dicoba sekali");

  // semua sumber IHSG gagal -> pesan berisi alasan tiap sumber
  const f3 = multiFetch({ "yahoo:*": 429, "stooq:*": 503 });
  const r3 = await mkData(f3).fetchAll();
  check(!r3.ihsg.ok && r3.ihsg.error.includes("yahoo: HTTP 429") && r3.ihsg.error.includes("stooq: HTTP 503") && r3.ihsg.error.includes("Too Many Requests") && r3.gold.ok && r3.fx.ok, "ambil: semua sumber IHSG gagal -> alasan tiap sumber tampil, bagian lain jalan");

  // emas: xaus gagal -> Yahoo; xaus+Yahoo gagal -> Stooq
  const g1 = await mkData(multiFetch({ xaus: 500 })).fetchAll();
  check(g1.gold.ok && g1.gold.quote.source === "yahoo", "emas: xaus gagal -> Yahoo");
  const g2 = await mkData(multiFetch({ xaus: 500, "yahoo:GC=F": 429 })).fetchAll();
  check(g2.gold.ok && g2.gold.quote.source === "stooq", "emas: xaus & Yahoo gagal -> Stooq");
  const k1 = await mkData(multiFetch({ erapi: new Error("fetch failed"), "yahoo:*": 429 })).fetchAll();
  check(k1.fx.ok && k1.fx.quote.source === "stooq", "kurs: ExchangeRate-API & Yahoo gagal -> Stooq");

  // sumber yang terakhir berhasil dicoba lebih dulu (cache dimatikan)
  const f4 = multiFetch({ xaus: 500 });
  const md4 = mkData(f4, { cacheMs: 0 });
  await md4.fetchAll();
  const before = f4.count("xaus.com");
  await md4.fetchAll();
  check(f4.count("xaus.com") === before, "urutan: sumber yang terakhir berhasil (Yahoo) dipakai duluan, xaus yang rusak tidak dicoba lagi");

  // cache 5 menit: panggilan kedua tidak ke jaringan
  const f5 = multiFetch();
  let clock = 1_000_000;
  const md5 = createMarketData({ config: cfg, fetchImpl: f5, sleep: async () => {}, now: () => clock });
  await md5.fetchAll();
  const n1 = f5.calls.length;
  await md5.fetchAll();
  check(f5.calls.length === n1, "cache: panggilan kedua dalam 5 menit tidak ke jaringan");
  clock += 6 * 60_000;
  await md5.fetchAll();
  check(f5.calls.length === n1 * 2, "cache: lewat 5 menit ambil ulang");

  // jaringan putus di query1 -> query2 menyelamatkan
  let n = 0;
  const flaky = async (url, init) => { if (String(url).includes("query1") && n++ < 3) throw new Error("fetch failed"); return multiFetch()(url, init); };
  const r6 = await mkData(flaky).fetchAll();
  check(r6.ihsg.ok && r6.ihsg.quote.source === "yahoo", "ambil: query1 gagal jaringan -> host cadangan query2 menyelamatkan");

  // waktu habis
  const slow = async (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const r7 = await createMarketData({ config: { ...cfg, timeoutMs: 20 }, fetchImpl: slow, sleep: async () => {} }).fetchAll();
  check(!r7.ihsg.ok && r7.ihsg.error.includes("waktu habis") && !r7.gold.ok && !r7.fx.ok, "ambil: lewat batas waktu -> pesan jelas, tidak menggantung");

  // angka tak masuk akal ditolak, lalu sumber berikutnya dipakai
  const r8 = await mkData(multiFetch({ "yahoo:^JKSE": chartJson("^JKSE", [7400, 7450, 7500], 5) })).fetchAll();
  check(r8.ihsg.ok && r8.ihsg.quote.source === "stooq", "ambil: angka tak masuk akal dari satu sumber ditolak, sumber berikutnya dipakai");
  const r9 = await mkData(multiFetch({ "yahoo:^JKSE": chartJson("^JKSE", [7400, 7450, 7500], 5), "stooq:*": "Date,Close\n2026-10-09,3\n" })).fetchAll();
  check(!r9.ihsg.ok && r9.ihsg.error.includes("tidak masuk akal"), "ambil: semua angka tak masuk akal -> gagal, bukan dilaporkan");
}

// ---- Yahoo diantre dengan jeda (anti-429)
{
  const sleeps = [];
  let clock = 5_000_000;
  const fails = multiFetch({ xaus: 500, erapi: 500 }); // paksa emas & kurs ikut ke Yahoo
  const md = createMarketData({ config: cfg, fetchImpl: fails, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, now: () => clock, yahooGapMs: 1200 });
  const r = await md.fetchAll();
  check(r.ihsg.ok && r.gold.ok && r.fx.ok && fails.count("finance.yahoo.com") === 3, "antre: tiga permintaan Yahoo berurutan, semuanya berhasil");
  check(sleeps.length >= 2 && sleeps.every((ms) => ms > 0 && ms <= 1200), "antre: ada jeda antar permintaan Yahoo (tidak serentak)");
}

// ---- diagnosis
{
  const f = multiFetch({ "yahoo:*": 429, "stooq:^jci": new Error("fetch failed") });
  const text = await mkData(f).diagnose();
  check(text.includes("*IHSG*") && text.includes("*Emas dunia*") && text.includes("*USD/IDR*"), "diagnosis: tiga bagian");
  check(text.includes("Yahoo Finance (^JKSE): GAGAL HTTP 429") && text.includes("Stooq (^jci): GAGAL fetch failed") && text.includes("xaus.com: OK 4112.5") && text.includes("ExchangeRate-API: OK 16250"), "diagnosis: tiap sumber dilaporkan sendiri (OK/GAGAL + alasan)");
  check(f.count("xaus.com") === 1 && f.count("stooq.com") === 3 && f.count("finance.yahoo.com") >= 3, "diagnosis: SEMUA sumber dicoba, tidak berhenti di yang pertama berhasil");
  check(!text.includes("TOKEN") && text.includes("Kirim hasil ini"), "diagnosis: ada petunjuk kirim hasil");
}

// ---- format
{
  const data = await mkData(multiFetch()).fetchAll();
  const nowMs = Date.UTC(2026, 9, 12, 0, 0); // Senin 12 Okt 2026 07:00 WIB
  // xaus & er-api tidak punya penutupan sebelumnya: isi manual agar format perubahan diuji
  data.gold.quote.prev = 4125;
  data.fx.quote.prev = 16225;
  const text = formatBrief(data, { nowMs, timeZone: "Asia/Jakarta" });
  check(text.includes("Pasar pagi") && text.includes("Senin"), "format: judul + hari ini");
  check(text.includes("*IHSG* 7.500,00 ▲ +50,00 (+0,67%)"), "format: IHSG, format angka Indonesia, naik");
  check(text.includes("*Emas dunia* US$ 4.112,50/oz ▼ -12,50 (-0,30%)"), "format: emas dunia turun");
  const perGram = (4112.5 * 16250) / TROY_OZ_GRAMS;
  const prevGram = (4125 * 16225) / TROY_OZ_GRAMS;
  check(text.includes(`*Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(perGram)}/gram*`) && perGram > 2_000_000 && perGram < 2_200_000, "format: konversi ke Rp/gram benar (4.112,5 x 16.250 / 31,1035)");
  check(text.includes(`${perGram > prevGram ? "▲" : "▼"}`) && text.includes("acuan harga dunia, harga jual Antam biasanya lebih tinggi"), "format: ada catatan bahwa ini bukan harga Antam");
  check(text.includes("*USD/IDR* Rp 16.250 ▲ +25 (+0,15%)"), "format: kurs");
  check(text.includes("Bukan saran investasi") && text.includes("data penutupan"), "format: sumber + penafian + tanggal data");
  check(text.includes("Sumber: Yahoo Finance, xaus.com, ExchangeRate-API (exchangerate-api.com)"), "format: daftar sumber mengikuti sumber yang benar-benar dipakai (+ atribusi ExchangeRate-API)");

  const part = formatBrief({ ...data, ihsg: { ok: false, error: "yahoo: HTTP 429" }, fx: { ok: false, error: "waktu habis" } }, { nowMs, timeZone: "Asia/Jakarta" });
  check(part.includes("*IHSG*: data tidak terbaca (yahoo: HTTP 429)") && part.includes("konversi ke Rp/gram tidak bisa") && part.includes("*USD/IDR*: data tidak terbaca") && part.includes("US$ 4.112,50") && !part.includes("Yahoo Finance,"), "format: bagian yang gagal dijelaskan, yang berhasil tetap tampil");
  const none = formatBrief({ ihsg: { ok: false, error: "a" }, gold: { ok: false, error: "b" }, fx: { ok: false, error: "c" } }, { nowMs, timeZone: "Asia/Jakarta" });
  check(none.includes("tidak ada yang terbaca"), "format: semua gagal -> sumber 'tidak ada yang terbaca'");

  const flat = formatBrief({ ...data, ihsg: { ok: true, quote: { ...data.ihsg.quote, prev: data.ihsg.quote.price } } }, { nowMs, timeZone: "Asia/Jakarta" });
  check(flat.includes("▬ tidak berubah"), "format: tidak berubah");
  const old = formatBrief({ ...data, ihsg: { ok: true, quote: { ...data.ihsg.quote, lastCloseMs: nowMs - 6 * 86400_000 } } }, { nowMs, timeZone: "Asia/Jakarta" });
  check(old.includes("⚠️ sudah lama"), "format: data lebih dari 4 hari diberi peringatan (libur panjang/tertunda)");
  const st = formatBrief({ ...data, gold: { ok: true, quote: { ...data.gold.quote, stale: true } } }, { nowMs, timeZone: "Asia/Jakarta" });
  check(st.includes("⚠️ data lama"), "format: sumber menandai data lama -> peringatan");
  const nop = formatBrief({ ...data, ihsg: { ok: true, quote: { ...data.ihsg.quote, prev: null } } }, { nowMs, timeZone: "Asia/Jakarta" });
  check(nop.includes("*IHSG* 7.500,00\n"), "format: tanpa pembanding -> hanya angka");
  const pn = formatBrief({ ...data, gold: { ok: true, quote: { ...data.gold.quote, prevNote: Date.UTC(2026, 9, 9, 12) } } }, { nowMs, timeZone: "Asia/Jakarta" });
  check(pn.includes("Selisih emas dibanding laporan terakhir (9 Okt)"), "format: selisih dari laporan terakhir diberi keterangan");
}

// ---- penjadwal
function makeBrief(over = {}) {
  const store = new Map(over.store ? [...over.store] : []);
  const sent = [];
  const clock = { t: Date.UTC(2026, 9, 12, 0, 40) }; // Senin 07:40 WIB (setelah 07:30)
  const fetchImpl = over.fetchImpl || multiFetch();
  const mb = createMarketBrief({
    config: { ...readMarketBriefConfig({ MARKET_BRIEF_TIME: "07:30" }), ...(over.cfg || {}) },
    data: createMarketData({ config: cfg, fetchImpl, sleep: async () => {}, now: () => clock.t, cacheMs: 0 }),
    state: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) },
    send: over.send || (async (t) => void sent.push(t)),
    now: () => clock.t,
    timeZone: "Asia/Jakarta",
    log: silent
  });
  return { mb, store, sent, clock, fetchImpl };
}
{
  const m = makeBrief();
  m.clock.t = Date.UTC(2026, 9, 11, 23, 0); // Senin 06:00 WIB: belum waktunya
  check((await m.mb.check()) === false && m.sent.length === 0, "jadwal: sebelum jam kirim tidak mengirim");
  m.clock.t = Date.UTC(2026, 9, 12, 0, 40);
  check((await m.mb.check()) === true && m.sent.length === 1 && m.sent[0].includes("Pasar pagi") && m.store.get("market_brief_date") === "2026-10-12", "jadwal: lewat jam kirim -> terkirim sekali, tanggal dicatat");
  check((await m.mb.check()) === false && m.sent.length === 1, "jadwal: tidak mengirim dua kali di hari yang sama");
  const saved = JSON.parse(m.store.get("market_last"));
  check(saved.ihsg.price === 7500 && saved.gold.price === 4112.5 && saved.fx.price === 16250 && saved.gold.date === "2026-10-12", "jadwal: angka terkirim disimpan untuk pembanding besok");
  m.clock.t = Date.UTC(2026, 9, 13, 0, 40);
  check((await m.mb.check()) === true && m.sent.length === 2, "jadwal: besoknya terkirim lagi");
  check(m.sent[1].includes("Selisih emas, kurs dibanding laporan terakhir (12 Okt)") && m.sent[1].includes("*Emas dunia* US$ 4.112,50/oz ▬ tidak berubah"), "jadwal: besoknya emas/kurs (tanpa penutupan sebelumnya) dibandingkan dengan laporan kemarin");
}
{
  // pembanding tersimpan: laporan manual di hari yang sama dengan laporan terakhir TIDAK membandingkan dengan dirinya sendiri
  const seed = new Map([["market_last", JSON.stringify({ gold: { price: 4000, date: "2026-10-09" }, fx: { price: 16000, date: "2026-10-12" } })]]);
  const m = makeBrief({ store: seed });
  const r = await m.mb.report();
  check(r.text.includes("US$ 4.112,50/oz ▲ +112,50 (+2,81%)") && r.text.includes("(9 Okt)"), "report: emas dibandingkan dengan laporan terakhir (hari lain)");
  check(r.text.includes("*USD/IDR* Rp 16.250\n") || /\*USD\/IDR\* Rp 16\.250(\n|$)/.test(r.text), "report: angka tersimpan dari hari yang sama tidak dipakai sebagai pembanding");
  const bad = makeBrief({ store: new Map([["market_last", "{rusak"]]) });
  check((await bad.mb.report()).anyOk, "report: data tersimpan rusak tidak menggagalkan laporan");
}
{
  const m = makeBrief();
  m.clock.t = Date.UTC(2026, 9, 17, 0, 40); // Sabtu
  check((await m.mb.check()) === false && m.sent.length === 0, "jadwal: Sabtu (di luar MARKET_BRIEF_DAYS) tidak mengirim");
  const w = makeBrief({ cfg: { enabled: false } });
  check((await w.mb.check()) === false && w.sent.length === 0, "jadwal: dimatikan -> tidak mengirim");
  const late = makeBrief();
  late.clock.t = Date.UTC(2026, 9, 12, 6, 0); // 13:00 WIB: lewat 180 menit dari 07:30
  check((await late.mb.check()) === false && late.sent.length === 0 && late.store.get("market_brief_date") === "2026-10-12", "jadwal: bot baru menyala terlambat -> hari ini dilewati dan dicatat");
}
{
  const down = makeBrief({ fetchImpl: async () => { throw new Error("fetch failed"); } });
  check((await down.mb.check()) === false && down.sent.length === 0 && !down.store.has("market_brief_date"), "jadwal: semua sumber gagal -> belum dikirim, belum dicatat (akan dicoba lagi)");
  check((await down.mb.check()) === false, "jadwal: percobaan ulang menunggu 30 menit");
  down.clock.t += 31 * 60_000;
  await down.mb.check();
  down.clock.t += 31 * 60_000;
  check((await down.mb.check()) === true && down.sent.length === 1 && down.sent[0].includes("semua sumber data gagal") && down.sent[0].includes("/pasar tes") && down.store.has("market_brief_date") && !down.store.has("market_last"), "jadwal: gagal 3x -> satu pemberitahuan gagal (menyebut /pasar tes) lalu berhenti hari itu");
  const part = makeBrief({ fetchImpl: multiFetch({ "yahoo:*": 500, "stooq:*": 500, xaus: new Error("x"), "yahoo:GC=F": 500 }) });
  check((await part.mb.check()) === true && part.sent[0].includes("IHSG*: data tidak terbaca") && part.sent[0].includes("*USD/IDR* Rp 16.250"), "jadwal: sebagian gagal tetap dikirim dengan penjelasan");
  const sendFail = makeBrief({ send: async () => { throw new Error("WA putus"); } });
  check((await sendFail.mb.check()) === false && !sendFail.store.has("market_brief_date") && !sendFail.store.has("market_last"), "jadwal: gagal kirim -> tidak dicatat sebagai terkirim (dicoba lagi)");
  const rep = await makeBrief().mb.report();
  check(rep.anyOk && rep.text.includes("IHSG"), "report: laporan sesuai permintaan");
  check((await makeBrief().mb.diagnose()).includes("Uji sumber data pasar"), "diagnose: diteruskan dari penjadwal");
  check(makeBrief().mb.describe().includes("AKTIF (07:30, hari Sen Sel Rab Kam Jum"), "describe: ringkasan jadwal");
}

// ---- Telegram /pasar
{
  const sent = [];
  const f = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    if (method === "sendMessage") sent.push(body.text);
    return { status: 200, json: async () => ({ ok: true, result: method === "getMe" ? { username: "b" } : { message_id: 1 } }) };
  };
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const cloud = [];
  const tg = createTelegram({ config: tcfg, deps: { chat: async (h) => { cloud.push(h); return "cloud"; }, market: { report: async () => "LAPORAN-PASAR", diagnose: async () => "HASIL-UJI" } }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/pasar");
  await tg.handleOwnerText("111", "/emas");
  await tg.handleOwnerText("111", "/ihsg");
  check(sent.join("|") === "LAPORAN-PASAR|LAPORAN-PASAR|LAPORAN-PASAR" && cloud.length === 0, "telegram: /pasar /emas /ihsg -> laporan, tidak ke AI cloud");
  await tg.handleOwnerText("111", "/pasar tes");
  check(sent.at(-1) === "HASIL-UJI" && cloud.length === 0, "telegram: /pasar tes -> hasil uji tiap sumber");
  const boom = createTelegram({ config: tcfg, deps: { chat: async () => "x", market: { report: async () => { throw new Error("rusak"); } } }, fetchImpl: f, log: silent });
  await boom.handleOwnerText("111", "/pasar");
  check(sent.at(-1).includes("Gagal mengambil data pasar") && sent.at(-1).includes("rusak"), "telegram: galat dilaporkan");
  const none = createTelegram({ config: tcfg, deps: { chat: async () => "x" }, fetchImpl: f, log: silent });
  await none.handleOwnerText("111", "/pasar");
  check(sent.at(-1).includes("belum aktif"), "telegram: tanpa modul -> pesan ramah");
}

console.log(fails === 0 ? "\nSemua tes market-brief lulus." : `\n${fails} tes market-brief GAGAL.`);
process.exit(fails === 0 ? 0 : 1);
