// Tes /wa1 (tautkan ulang nomor utama lewat Telegram). Tanpa jaringan.   node test-wa1.mjs
import { createMainRelink, relinkState, QR_CAPTION } from "./wa-main-relink.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };

// ---- keadaan
{
  check(relinkState({}, true) === "tersambung", "keadaan: terbuka = tersambung");
  check(relinkState({}, false) === "menyambung", "keadaan: putus biasa (belum logout) = menyambung");
  check(relinkState({ loggedOutAt: 5 }, false) === "logout", "keadaan: loggedOutAt terisi = logout");
  check(relinkState({ loggedOutAt: 5, relinkAt: 9 }, false) === "menunggu-pindai", "keadaan: sesi baru lebih baru dari logout = menunggu pindai");
  check(relinkState({ loggedOutAt: 12, relinkAt: 9 }, false) === "logout", "keadaan: logout lagi setelah sesi baru = logout");
}

function buat({ acct, open = false, moved = "auth_session_lama_x", qrAt = null } = {}) {
  let t = 1_000_000; const calls = { moved: 0, start: 0 }; const st = { open };
  const r = createMainRelink({
    acct, isOpen: () => st.open, userId: () => "6285719965097",
    startConnect: async () => { calls.start++; if (qrAt !== null) setTimeout(() => {}, 0); },
    moveAuthDir: () => { calls.moved++; return moved; },
    qrToPng: async (q) => Buffer.from("PNG:" + q), now: () => t, wait: async (ms) => { t += ms; if (qrAt !== null && t >= 1_000_000 + qrAt) acct.lastQr = { qr: "QR-BARU", at: t }; }, maxWaitMs: 30_000, log: quiet
  });
  return { r, calls, st };
}

// ---- describe
{
  check(/tersambung/.test(buat({ acct: {}, open: true }).r.describe()) && /6285719965097/.test(buat({ acct: {}, open: true }).r.describe()), "describe: tersambung menyebut nomor");
  check(/logout/.test(buat({ acct: { loggedOutAt: 1 } }).r.describe()) && /\/wa1 qr/.test(buat({ acct: { loggedOutAt: 1 } }).r.describe()), "describe: logout menyarankan /wa1 qr");
  check(/belum tercatat logout/.test(buat({ acct: {} }).r.describe()), "describe: putus biasa tidak menyuruh menautkan ulang");
}

// ---- qr: keselamatan sesi
{
  const a = {}; const { r, calls } = buat({ acct: a });
  let msg = ""; try { await r.qr(); } catch (e) { msg = e.message; }
  check(/belum tercatat logout/.test(msg) && calls.moved === 0 && calls.start === 0, "qr: putus biasa DITOLAK dan sesi tidak disentuh");
  const b = buat({ acct: { loggedOutAt: 1 }, open: true }); msg = ""; try { await b.r.qr(); } catch (e) { msg = e.message; }
  check(/sudah tersambung/.test(msg) && b.calls.moved === 0, "qr: sudah tersambung ditolak, sesi tidak disentuh");
}

// ---- qr: alur logout -> QR
{
  const a = { loggedOutAt: 1 }; const { r, calls } = buat({ acct: a, qrAt: 4000 });
  const png = await r.qr();
  check(calls.moved === 1 && calls.start === 1, "qr: logout -> sesi lama dipindah (bukan dihapus) dan sesi baru dimulai");
  check(String(png) === "PNG:QR-BARU" && a.relinkAt > 0, "qr: QR baru diubah menjadi gambar");
  const png2 = await r.qr();
  check(calls.moved === 1 && calls.start === 1 && String(png2).startsWith("PNG:"), "qr: dipanggil lagi saat menunggu pindai TIDAK memindahkan sesi lagi");
  a.loggedOutAt = a.relinkAt + 50; // logout lagi
  await r.qr();
  check(calls.moved === 2 && calls.start === 2, "qr: logout lagi setelah sesi baru -> boleh ulang");
}
{
  const a = { loggedOutAt: 1 }; const { r } = buat({ acct: a }); let msg = "";
  try { await r.qr(); } catch (e) { msg = e.message; }
  check(/QR belum muncul/.test(msg), "qr: QR tak kunjung muncul -> pesan jelas, bukan menggantung");
}

// ---- perintah Telegram
const cfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
const msg = (chat, text) => ({ update_id: 1, message: { chat: { id: Number(chat), type: "private" }, text } });
function fakeApi() {
  const calls = []; const f = async (url, init) => { const method = String(url).split("/").pop(); calls.push({ method, body: init?.body }); return { status: 200, json: async () => (method === "getMe" ? { ok: true, result: { username: "x" } } : { ok: true, result: { message_id: 1 } }) }; };
  f.calls = calls; f.texts = () => calls.filter((c) => c.method === "sendMessage").map((c) => JSON.parse(c.body).text); return f;
}
{
  const f = fakeApi(); let qrCalls = 0;
  const tg = createTelegram({ config: cfg, deps: { chat: async () => "x", wa1: { describe: () => "status-utama", qr: async () => { qrCalls++; return { data: Buffer.from("png"), name: "qr-nomor-utama.png", mime: "image/png", photo: true }; } } }, fetchImpl: f, log: quiet });
  await tg.handleUpdate(msg(111, "/wa1"));
  check(f.texts().includes("status-utama"), "/wa1 menampilkan status");
  await tg.handleUpdate(msg(111, "/wa1 qr"));
  check(qrCalls === 1 && f.calls.some((c) => c.method === "sendPhoto" || c.method === "sendDocument"), "/wa1 qr mengirim gambar QR ke Telegram");
  await tg.handleUpdate(msg(999, "/wa1 qr"));
  check(qrCalls === 1, "/wa1 qr dari orang lain (bukan pemilik) tidak menjalankan apa pun");
}
{
  const f = fakeApi(); const tg = createTelegram({ config: cfg, deps: { chat: async () => "x", wa1: { describe: () => "s", qr: async () => { throw new Error("belum logout"); } } }, fetchImpl: f, log: quiet });
  await tg.handleUpdate(msg(111, "/wa1 qr"));
  check(f.texts().some((t) => /belum logout/.test(t)), "/wa1 qr galat -> pesan jelas ke pemilik");
  const f2 = fakeApi(); const tg2 = createTelegram({ config: cfg, deps: { chat: async () => "x" }, fetchImpl: f2, log: quiet });
  await tg2.handleUpdate(msg(111, "/wa1"));
  check(/tidak tersedia/.test(f2.texts()[0]), "/wa1 tanpa modul: pesan jelas");
}
check(/Perangkat Tertaut/.test(QR_CAPTION) && /LAIN/.test(QR_CAPTION), "keterangan QR memuat petunjuk");
console.log(fails ? `\n${fails} GAGAL` : "\nsemua ok"); process.exit(fails ? 1 : 0);
