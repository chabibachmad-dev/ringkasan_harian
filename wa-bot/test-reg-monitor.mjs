// Tes pemantau peraturan (pencarian, AI, penyimpanan, pengiriman semuanya palsu; tanpa jaringan).
//   node test-reg-monitor.mjs
import {
  readRegMonitorConfig, normalizeUrl, isOfficial, currentSlot, parseAiVerdicts, splitMessage, createRegMonitor, DEFAULT_TOPICS
} from "./reg-monitor.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { warn() {}, log() {}, error() {} };

// --- config
{
  const c = readRegMonitorConfig(() => undefined);
  check(c.enabled && c.day === 1 && c.hour === 7 && c.recent === "month" && c.maxItems === 8 && c.officialDomains.join() === "go.id" && c.topics.length === DEFAULT_TOPICS.length, "config bawaan: aktif, Senin 07:00, sebulan terakhir, 8 butir, .go.id, topik bendahara");
  const e = { REG_MONITOR_TOPICS: "Halal|aturan halal BPJPH {year}; polos tanpa label", REG_MONITOR_DAY: "5", REG_MONITOR_HOUR: "99", REG_MONITOR_RECENT: "week", REG_MONITOR_ENABLED: "false", REG_MONITOR_OFFICIAL_DOMAINS: ".go.id, bpk.go.id" };
  const c2 = readRegMonitorConfig((n) => e[n]);
  check(c2.topics.length === 2 && c2.topics[0].label === "Halal" && c2.topics[1].label === "polos tanpa label" && c2.day === 5 && c2.hour === 23 && c2.recent === "week" && !c2.enabled && c2.officialDomains.length === 2, "config kustom: topik 'Label|kata', jam dijepit 0-23, recent, enabled=false");
}
// --- URL & domain
check(normalizeUrl("https://www.Kemenkeu.go.id/a/b/?utm_source=x&id=3#bagian") === "kemenkeu.go.id/a/b?id=3" && normalizeUrl("https://kemenkeu.go.id/a/b") === "kemenkeu.go.id/a/b" && normalizeUrl("bukan url") === "", "normalizeUrl: utm/hash/www/garis miring dibuang, id tetap");
check(isOfficial("https://jdih.kemenkeu.go.id/x", ["go.id"]) && !isOfficial("https://go.id.palsu.com/x", ["go.id"]) && !isOfficial("https://berita.com/go.id", ["go.id"]) && !isOfficial("rusak", ["go.id"]), "isOfficial: hanya domain yang benar-benar berakhiran .go.id");
// --- jadwal
{
  const tz = "Asia/Jakarta";
  const ms = (iso) => Date.parse(iso);
  // Senin 5 Okt 2026 07:30 WIB = 00:30 UTC. 2026-10-05 adalah Senin.
  check(currentSlot(ms("2026-10-05T00:30:00Z"), tz, 1, 7) === "2026-10-05", "slot: Senin 07:30 -> slot hari itu");
  check(currentSlot(ms("2026-10-04T23:00:00Z"), tz, 1, 7) === "2026-10-05" ? false : currentSlot(ms("2026-10-04T23:00:00Z"), tz, 1, 7) === "2026-09-28", "slot: Senin 06:00 WIB (belum jam 7) -> slot Senin minggu lalu");
  check(currentSlot(ms("2026-10-08T05:00:00Z"), tz, 1, 7) === "2026-10-05", "slot: Kamis -> slot Senin yang baru lewat (bot mati lalu hidup tetap menjalankan)");
}
// --- parse AI
{
  const good = '```json\n{"items":[{"n":1,"relevan":true,"ringkasan":"PMK baru tentang X."},{"n":2,"relevan":false,"ringkasan":""},{"n":9,"relevan":true,"ringkasan":"di luar daftar"}]}\n```';
  const m = parseAiVerdicts(good, 3);
  check(m && m.get(1).relevan && m.get(1).ringkasan.startsWith("PMK") && m.get(2).relevan === false && !m.has(9), "parseAi: pagar kode dibuang, nomor di luar daftar diabaikan");
  check(parseAiVerdicts('Tentu! {"items":[{"n":1,"relevan":true,"ringkasan":"ok"}]} semoga membantu', 2)?.get(1)?.ringkasan === "ok", "parseAi: teks pembuka/penutup di luar JSON ditoleransi");
  check(parseAiVerdicts("bukan json sama sekali", 2) === null && parseAiVerdicts('{"items":"salah"}', 2) === null && parseAiVerdicts("", 2) === null, "parseAi: sampah -> null (jatuh ke daftar tanpa penyaringan)");
}
check(splitMessage("a".repeat(100), 3500).length === 1 && splitMessage(["x".repeat(2000), "y".repeat(2000)].join("\n\n"), 3500).length === 2, "splitMessage: dipotong di batas paragraf");

// --- alur utama
const NOW = Date.parse("2026-10-05T01:00:00Z"); // Senin 08:00 WIB
function setup({ rows = {}, aiReply = null, aiThrows = false, available = true, cfg = {} } = {}) {
  const store = new Map();
  const sent = [];
  const searches = [];
  let t = NOW;
  const config = { ...readRegMonitorConfig(() => undefined), ...cfg };
  const mon = createRegMonitor({
    config,
    search: async (q, max, opts) => {
      searches.push({ q, max, opts });
      const r = typeof rows === "function" ? rows(q) : rows[q] ?? rows["*"] ?? [];
      if (r instanceof Error) throw r;
      return r;
    },
    searchAvailable: () => available,
    ai: aiThrows ? async () => { throw new Error("ai mati"); } : aiReply === null ? null : async (sys, user) => (typeof aiReply === "function" ? aiReply(sys, user) : aiReply),
    state: { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } },
    send: async (x) => { sent.push(x); },
    now: () => t,
    timeZone: "Asia/Jakarta",
    log: silent
  });
  return { mon, store, sent, searches, advance: (ms) => { t += ms; }, config };
}
const R = (title, url, snippet = "cuplikan") => ({ title, url, snippet });

// 1) Resmi dipisah dari berita, AI menyaring & merangkum, query memakai tahun & recent
{
  const rows = { "*": [R("PMK 99/2026 tentang X", "https://jdih.kemenkeu.go.id/pmk-99"), R("Berita PMK baru", "https://kontan.co.id/pmk"), R("Jasa konsultan murah", "https://spam.com/iklan")] };
  const ai = (sys, user) => {
    if (!/Daftar hasil pencarian/.test(user)) return "{}";
    // butir 1,2,3 sesuai urutan kandidat: resmi dulu, lalu berita
    return JSON.stringify({ items: [{ n: 1, relevan: true, ringkasan: "Mengatur tata cara X." }, { n: 2, relevan: true, ringkasan: "Media melaporkan PMK baru." }, { n: 3, relevan: false, ringkasan: "" }] });
  };
  const s = setup({ rows, aiReply: ai });
  const r = await s.mon.build();
  check(r.text.includes("🏛️ *Sumber resmi") && r.text.includes("📰 *Berita") && r.text.indexOf("Sumber resmi") < r.text.indexOf("Berita &"), "laporan: sumber resmi tampil lebih dulu dari berita");
  check(r.text.includes("https://jdih.kemenkeu.go.id/pmk-99") && r.text.includes("Mengatur tata cara X.") && !r.text.includes("spam.com"), "laporan: URL + ringkasan AI ikut, butir tak relevan dibuang");
  check(s.searches.length === s.config.topics.length && s.searches.every((x) => x.opts.recent === "month") && s.searches[0].q.includes("2026") && !s.searches[0].q.includes("{year}"), "pencarian: satu per topik, recent=month, {year} diganti 2026");
}
// 2) Dedupe antar topik (URL sama muncul di banyak topik hanya sekali) dan antar minggu
{
  const rows = { "*": [R("PMK 99", "https://jdih.kemenkeu.go.id/pmk-99?utm_source=a")] };
  const ai = () => JSON.stringify({ items: [{ n: 1, relevan: true, ringkasan: "Ringkas." }] });
  const s = setup({ rows, aiReply: ai });
  await s.mon.check();
  const first = s.sent.join("\n");
  check((first.match(/pmk-99/g) || []).length === 1, "dedupe: URL sama di 4 topik hanya muncul sekali");
  check(s.store.get("reg_monitor_slot") === "2026-10-05", "jadwal: slot ditandai sudah dijalankan");
  s.sent.length = 0;
  await s.mon.check();
  check(s.sent.length === 0, "check() kedua di slot yang sama tidak mengirim lagi");
  s.advance(7 * 86400_000);
  await s.mon.check();
  const next = s.sent.join("\n");
  check(next.includes("Tidak ada kabar peraturan baru") && !next.includes("pmk-99"), "minggu berikutnya: butir yang sama tidak dilaporkan lagi -> pesan 'tidak ada kabar baru'");
}
// 3) AI gagal / JSON rusak / tanpa AI -> tetap kirim daftar apa adanya dengan catatan
for (const [name, opts] of [["AI melempar error", { aiThrows: true }], ["AI balas sampah", { aiReply: "maaf saya tidak bisa" }], ["tanpa AI", {}]]) {
  const s = setup({ rows: { "*": [R("PMK 5/2026", "https://jdih.kemenkeu.go.id/pmk-5", "Mengatur belanja negara.")] }, ...opts });
  const r = await s.mon.build();
  check(r.text.includes("PMK 5/2026") && r.text.includes("belum disaring") && r.text.includes("Mengatur belanja negara."), `fallback (${name}): daftar tetap dikirim, ditandai belum disaring`);
}
// 4) Tanpa key pencarian: check() diam; /peraturan memberi tahu
{
  const s = setup({ available: false, rows: { "*": [R("x", "https://a.go.id/x")] } });
  await s.mon.check();
  check(s.sent.length === 0 && s.searches.length === 0, "tanpa key API: jadwal dilewati diam-diam (tanpa pencarian)");
  const r = await s.mon.runNow();
  check(!r.ok && s.sent.length === 1 && /key API pencarian/.test(s.sent[0]), "tanpa key API: perintah manual menjelaskan apa yang kurang");
}
// 5) Pencarian kosong semua -> coba lagi (maks 3x), lalu lapor
{
  const s = setup({ rows: {}, aiReply: "{}" });
  await s.mon.check();
  check(s.sent.length === 0 && !s.store.has("reg_monitor_slot"), "semua pencarian kosong (percobaan 1): belum kirim, belum menandai slot");
  await s.mon.check();
  check(s.searches.length === s.config.topics.length, "percobaan ulang menunggu jeda 30 menit");
  s.advance(31 * 60_000); await s.mon.check();
  check(s.sent.length === 0, "percobaan 2: masih menunggu");
  s.advance(31 * 60_000); await s.mon.check();
  check(s.sent.length === 1 && /tidak mengembalikan data/.test(s.sent[0]) && s.store.get("reg_monitor_slot") === "2026-10-05", "percobaan 3: lapor 'pencarian tak mengembalikan data' lalu menandai slot");
}
// 6) Error pencarian di satu topik tidak menggagalkan topik lain
{
  const s = setup({ rows: (q) => (q.includes("Peraturan Menteri") ? new Error("boom") : [R("Aturan DIPA", "https://djpbn.kemenkeu.go.id/dipa")]), aiReply: () => JSON.stringify({ items: [{ n: 1, relevan: true, ringkasan: "ok" }] }) });
  const r = await s.mon.build();
  check(r.text.includes("djpbn.kemenkeu.go.id/dipa"), "satu topik error: topik lain tetap dilaporkan");
}
// 7) Batas butir & jatah resmi
{
  const many = Array.from({ length: 12 }, (_, i) => R(`Resmi ${i}`, `https://x${i}.go.id/a`)).concat(Array.from({ length: 12 }, (_, i) => R(`Berita ${i}`, `https://media${i}.com/a`)));
  const s = setup({ rows: { "*": many }, cfg: { maxItems: 10 } });
  const r = await s.mon.build();
  check(r.candidates.length === 10 && r.candidates.filter((c) => c.official).length === 7, "maxItems=10: 7 resmi + 3 berita");
}
// 8) Perintah manual "semua" mengabaikan riwayat & tidak menandai
{
  const rows = { "*": [R("PMK 1", "https://jdih.kemenkeu.go.id/pmk-1")] };
  const s = setup({ rows });
  await s.mon.runNow();
  const after = s.store.get("reg_monitor_seen");
  check(after && after.includes("jdih.kemenkeu.go.id/pmk-1"), "runNow biasa: menandai butir sebagai sudah dilaporkan");
  s.sent.length = 0;
  await s.mon.runNow({ all: true });
  check(s.sent.join("\n").includes("pmk-1") && s.store.get("reg_monitor_seen") === after, "runNow(all): menampilkan lagi semua & tidak mengubah riwayat");
}
// 9) Riwayat lama (>150 hari) dibersihkan
{
  const s = setup({ rows: { "*": [R("Baru", "https://a.go.id/baru")] } });
  s.store.set("reg_monitor_seen", JSON.stringify({ "lama.go.id/x": NOW - 200 * 86400_000, "segar.go.id/y": NOW - 10 * 86400_000 }));
  await s.mon.runNow();
  const seen = JSON.parse(s.store.get("reg_monitor_seen"));
  check(!("lama.go.id/x" in seen) && "segar.go.id/y" in seen && "a.go.id/baru" in seen, "riwayat: entri >150 hari dibuang, yang segar dipertahankan");
}
// 10) enabled=false
{
  const s = setup({ cfg: { enabled: false }, rows: { "*": [R("x", "https://a.go.id/x")] } });
  await s.mon.check();
  check(s.sent.length === 0 && s.searches.length === 0 && s.mon.describe() === "mati", "enabled=false: tidak berjalan");
}

console.log(fails ? `\n${fails} FAIL` : "\nsemua ok");
process.exit(fails ? 1 : 0);
