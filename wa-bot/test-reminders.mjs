// Tes pengingat pribadi: reminders.js + perintah Telegram.
//   node test-reminders.mjs
import { createReminders, describeRepeat, formatWhen, nextOccurrence, openReminderStore, parseReminder, parseReminderCommand, tzParts, zonedToUtc } from "./reminders.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };
const TZ = "Asia/Jakarta";
const at = (y, m, d, h = 0, mi = 0) => zonedToUtc(y, m, d, h, mi, TZ);
const NOW = at(2026, 10, 14, 10, 0); // Rabu 14 Okt 2026 10:00 WIB
const P = (s, now = NOW) => parseReminder(s, { now, timeZone: TZ });
const when = (r) => (r.ok ? formatWhen(r.dueMs, TZ) : `ERR:${r.error}`);

// ---- zona waktu
{
  check(new Date(NOW).toISOString() === "2026-10-14T03:00:00.000Z", "zona: 10:00 WIB = 03:00 UTC");
  const p = tzParts(NOW, TZ);
  check(p.y === 2026 && p.m === 10 && p.d === 14 && p.h === 10 && p.dow === 3, "zona: Rabu 14 Okt 2026 10:00");
  check(new Date(zonedToUtc(2026, 10, 14, 10, 0, "Asia/Makassar")).toISOString() === "2026-10-14T02:00:00.000Z", "zona: WITA lebih awal 1 jam dari WIB");
  const late = tzParts(Date.UTC(2026, 9, 14, 17, 30), TZ);
  check(late.d === 15 && late.h === 0 && late.mi === 30, "zona: lewat tengah malam lokal berganti hari");
}

// ---- perintah
{
  check(parseReminderCommand("/ingatkan besok 09:00 SPJ").name === "ingatkan" && parseReminderCommand("/ingatkan besok 09:00 SPJ").arg === "besok 09:00 SPJ", "perintah: /ingatkan + isi");
  check(parseReminderCommand("/pengingat").name === "pengingat" && parseReminderCommand("/pengingat").arg === "" && parseReminderCommand("/Reminder@bot batal 3").arg === "batal 3", "perintah: /pengingat, alias, @bot");
  check(parseReminderCommand("/ingatkanku") === null && parseReminderCommand("/ingat x") === null && parseReminderCommand("ingatkan") === null, "perintah: tidak bentrok dengan /ingat (catatan)");
  check(parseReminderCommand("/ingatkan\nbesok 09:00 a\nb").arg === "besok 09:00 a\nb", "perintah: isi multi-baris utuh");
}

// ---- relatif
{
  check(when(P("30 menit lagi cek oven")) === "Rabu, 14 Okt 2026 10:30" && P("30 menit lagi cek oven").text === "cek oven", "relatif: 30 menit lagi");
  check(when(P("dalam 2 jam rapat")) === "Rabu, 14 Okt 2026 12:00" && when(P("3 hari lagi bayar")) === "Sabtu, 17 Okt 2026 10:00", "relatif: jam & hari");
  check(P("0 menit lagi x").ok === false && P("30 menit lagi").ok === false && P("30 menit lagi").error.includes("apa yang diingatkan"), "relatif: nol / tanpa isi ditolak");
  check(P("999 hari lagi x").ok === false && P("999 hari lagi x").error.includes("jauh"), "relatif: terlalu jauh");
}

// ---- hari
{
  check(when(P("besok 09:00 kirim SPJ")) === "Kamis, 15 Okt 2026 09:00" && P("besok 09:00 kirim SPJ").text === "kirim SPJ", "hari: besok 09:00");
  check(when(P("besok jam 9 kirim")) === "Kamis, 15 Okt 2026 09:00" && when(P("besok pukul 14.30 x")) === "Kamis, 15 Okt 2026 14:30", "hari: 'jam 9', 'pukul 14.30'");
  check(when(P("besok jam 9 malam x")) === "Kamis, 15 Okt 2026 21:00" && when(P("besok jam 4 sore x")) === "Kamis, 15 Okt 2026 16:00" && when(P("besok jam 1 siang x")) === "Kamis, 15 Okt 2026 13:00" && when(P("besok jam 9 pagi x")) === "Kamis, 15 Okt 2026 09:00", "hari: pagi/siang/sore/malam menyesuaikan");
  check(when(P("besok pagi olahraga")) === "Kamis, 15 Okt 2026 07:00" && when(P("besok malam nonton")) === "Kamis, 15 Okt 2026 20:00", "hari: bagian hari tanpa jam");
  const d = P("besok kirim SPJ");
  check(when(d) === "Kamis, 15 Okt 2026 08:00" && d.defaultedTime === true && d.text === "kirim SPJ", "hari: tanpa jam -> 08:00 dan ditandai");
  check(P("besok 3 berkas").text === "3 berkas" && P("besok 3 berkas").defaultedTime, "hari: angka di teks bukan dianggap jam");
  check(when(P("lusa 07:15 x")) === "Jumat, 16 Okt 2026 07:15", "hari: lusa");
  check(when(P("hari ini 15:30 x")) === "Rabu, 14 Okt 2026 15:30" && P("hari ini 09:00 x").ok === false && P("hari ini 09:00 x").error.includes("sudah lewat"), "hari: hari ini (lewat ditolak jelas)");
  check(when(P("jumat jam 14.30 rapat")) === "Jumat, 16 Okt 2026 14:30" && when(P("hari senin 08:00 apel")) === "Senin, 19 Okt 2026 08:00", "hari: nama hari berikutnya");
  check(when(P("rabu 15:00 x")) === "Rabu, 14 Okt 2026 15:00" && when(P("rabu 09:00 x")) === "Rabu, 21 Okt 2026 09:00", "hari: nama hari ini -> hari ini bila belum lewat, kalau sudah -> minggu depan");
  check(when(P("minggu x")) === "Minggu, 18 Okt 2026 08:00" && when(P("jum'at 10:00 x")) === "Jumat, 16 Okt 2026 10:00", "hari: minggu, jum'at");
}

// ---- tanggal
{
  check(when(P("25 okt 08:00 bayar pajak")) === "Minggu, 25 Okt 2026 08:00" && P("25 okt 08:00 bayar pajak").text === "bayar pajak", "tanggal: 25 okt");
  check(when(P("1 Januari 2027 09:00 x")) === "Jumat, 1 Jan 2027 09:00" && when(P("3 agustus 07:00 x")) === "Selasa, 3 Agu 2027 07:00", "tanggal: tahun disebut; tanpa tahun & sudah lewat -> tahun depan");
  check(when(P("2026-12-31 23:00 x")) === "Kamis, 31 Des 2026 23:00" && when(P("20/11 10:00 x")) === "Jumat, 20 Nov 2026 10:00" && when(P("1/11/27 10:00 x")) === "Senin, 1 Nov 2027 10:00", "tanggal: ISO, d/m, d/m/yy");
  check(P("31 feb 09:00 x").ok === false && P("40/1 x").ok === false && P("2026-02-30 x").ok === false, "tanggal: tidak valid ditolak");
  check(P("1 jan 2026 09:00 x").ok === false && P("1 jan 2026 09:00 x").error.includes("sudah lewat"), "tanggal: tahun disebut dan sudah lewat -> ditolak");
  check(P("25 xyz 08:00 x").ok === false && P("blabla").ok === false && P("blabla").error.includes("tidak terbaca"), "tanggal: bukan waktu -> pesan contoh");
  check(P("besok 25:00 x").ok === false && P("besok 09:75 x").ok === false, "jam: tidak valid ditolak");
}

// ---- berulang
{
  const d = P("tiap hari 21:00 kunci pintu");
  check(d.ok && d.repeat.kind === "daily" && when(d) === "Rabu, 14 Okt 2026 21:00" && d.text === "kunci pintu", "ulang: tiap hari (hari ini belum lewat)");
  check(when(P("setiap hari 09:00 x")) === "Kamis, 15 Okt 2026 09:00", "ulang: tiap hari, jam sudah lewat -> besok");
  const w = P("tiap senin 07:30 apel");
  check(w.repeat.kind === "weekly" && w.repeat.dow === 1 && when(w) === "Senin, 19 Okt 2026 07:30", "ulang: tiap senin");
  const m = P("tiap tanggal 25 jam 08:00 laporan bulanan");
  check(m.repeat.kind === "monthly" && m.repeat.dom === 25 && when(m) === "Minggu, 25 Okt 2026 08:00" && m.text === "laporan bulanan", "ulang: tiap tanggal 25");
  check(when(P("tiap bulan tgl 10 jam 08:00 x")) === "Selasa, 10 Nov 2026 08:00", "ulang: tanggal sudah lewat -> bulan depan");
  const nj = P("tiap tanggal 25 gaji");
  check(nj.defaultedTime === true && nj.text === "gaji", "ulang: tanpa jam -> 08:00 ditandai");
  check(P("tiap sesuatu x").ok === false && P("tiap tanggal 40 x").ok === false, "ulang: bentuk tak dikenal / tanggal tak valid ditolak");
  check(describeRepeat({ kind: "daily", h: 7, mi: 5 }) === "tiap hari 07:05" && describeRepeat({ kind: "weekly", dow: 5, h: 8, mi: 0 }) === "tiap Jumat 08:00" && describeRepeat({ kind: "monthly", dom: 25, h: 8, mi: 0 }) === "tiap tanggal 25 08:00", "ulang: deskripsi");
  // tanggal 31 dijepit ke akhir bulan pendek
  const rep = { kind: "monthly", dom: 31, h: 8, mi: 0 };
  const a = nextOccurrence(rep, at(2026, 10, 31, 9, 0), TZ);
  check(formatWhen(a, TZ) === "Senin, 30 Nov 2026 08:00", "ulang: tanggal 31 -> 30 Nov (akhir bulan)");
  const feb = nextOccurrence(rep, at(2027, 1, 31, 9, 0), TZ);
  check(formatWhen(feb, TZ) === "Minggu, 28 Feb 2027 08:00", "ulang: tanggal 31 -> 28 Feb");
}

// ---- batas teks
{
  check(P(`besok 09:00 ${"x".repeat(201)}`).ok === false && P(`besok 09:00 ${"x".repeat(200)}`).ok === true, "teks: maks 200 huruf");
  check(P("besok 09:00 untuk: kirim SPJ").text === "kirim SPJ" && P("besok 09:00 - kirim SPJ").text === "kirim SPJ", "teks: awalan 'untuk:' / '-' dibuang");
}

// ---- penyimpanan + penjadwal
async function make(opts = {}) {
  const store = await openReminderStore({ file: ":memory:", maxActive: opts.max ?? 100, log: silent });
  const clock = { t: NOW };
  const sent = [];
  const rm = createReminders({
    store,
    send: opts.send || (async (t) => void sent.push(t)),
    now: () => clock.t,
    timeZone: TZ,
    tzLabel: "WIB",
    log: silent,
    retryMs: 120_000
  });
  return { store, rm, clock, sent };
}
{
  const { rm, clock, sent, store } = await make();
  const r = rm.handle({ name: "ingatkan", arg: "besok 09:00 kirim SPJ" });
  check(r.includes("Kamis, 15 Okt 2026 09:00 WIB") && r.includes("kirim SPJ") && r.includes("Nomor 1") && r.includes("/pengingat batal 1"), "balasan: konfirmasi waktu lengkap + nomor");
  check(rm.handle({ name: "ingatkan", arg: "besok kirim x" }).includes("kupakai 08:00"), "balasan: jam bawaan dikatakan terus terang");
  check(rm.handle({ name: "ingatkan", arg: "tiap senin 07:30 apel" }).includes("🔁 Berulang: tiap Senin 07:30"), "balasan: berulang");
  check(rm.handle({ name: "ingatkan", arg: "besok 09:00 kirim SPJ" }).includes("sudah ada"), "balasan: duplikat ditolak");
  check(rm.handle({ name: "ingatkan", arg: "" }).includes("/ingatkan besok 09:00") && rm.handle({ name: "ingatkan", arg: "ngawur" }).includes("tidak terbaca"), "balasan: kosong -> petunjuk; salah -> alasan + petunjuk");
  check(rm.handle({ name: "ingatkan", arg: "besok 09:00 token: abc" }).includes("tampak seperti rahasia") && rm.handle({ name: "ingatkan", arg: "besok 09:00 kartu 4111111111111111" }).includes("tampak seperti rahasia"), "balasan: teks mirip rahasia ditolak");
  const l = rm.handle({ name: "pengingat", arg: "" });
  check(l.includes("3 pengingat aktif") && l.indexOf("#1") < l.indexOf("#3") && l.includes("🔁 tiap Senin 07:30"), "daftar: terurut waktu, berulang ditandai");

  // belum waktunya
  check((await rm.check()) === 0 && sent.length === 0, "jadwal: belum jatuh tempo -> diam");
  // 09:00 besok lewat
  clock.t = at(2026, 10, 15, 8, 0);
  check((await rm.check()) === 1 && sent[0].includes("⏰ *Pengingat*: kirim SPJ") === false, "jadwal: 08:00 hanya yang 08:00 (kirim x) yang terkirim");
  check(sent[0].includes("kirim x") && !sent[0].includes("terlambat"), "jadwal: tepat waktu tanpa keterangan terlambat");
  clock.t = at(2026, 10, 15, 9, 0, 0);
  check((await rm.check()) === 1 && sent[1].includes("kirim SPJ"), "jadwal: pengingat 09:00 terkirim");
  check((await rm.check()) === 0, "jadwal: tidak terkirim dua kali");
  check(store.list().length === 1 && store.list()[0].text === "apel", "jadwal: sekali-jalan dihapus setelah terkirim, berulang tetap");

  // berulang: terlewat beberapa minggu -> sekali kirim + terlambat + lanjut ke jadwal berikutnya
  clock.t = at(2026, 11, 10, 12, 0); // Selasa; Senin 19 Okt, 26 Okt, 2 Nov, 9 Nov terlewat
  check((await rm.check()) === 1 && sent[2].includes("apel") && sent[2].includes("terlambat") && sent[2].includes("berikutnya Senin, 16 Nov 2026 07:30"), "jadwal: berulang terlewat -> kirim sekali, terlambat, berikutnya jelas");
  check(store.list()[0].dueMs === at(2026, 11, 16, 7, 30) && (await rm.check()) === 0, "jadwal: berulang dijadwalkan ulang ke depan");
}
{
  // kirim gagal -> dicoba lagi setelah jeda, tidak hilang
  let fail = true;
  const { rm, clock, store } = await make({ send: async () => { if (fail) throw new Error("WA putus"); } });
  rm.handle({ name: "ingatkan", arg: "30 menit lagi cek" });
  clock.t = NOW + 31 * 60_000;
  check((await rm.check()) === 0 && store.count() === 1, "gagal kirim: pengingat tetap tersimpan");
  clock.t += 60_000;
  fail = false;
  check((await rm.check()) === 0, "gagal kirim: menunggu jeda coba ulang");
  clock.t += 120_000;
  check((await rm.check()) === 1 && store.count() === 0, "gagal kirim: berhasil di percobaan berikutnya lalu dihapus");
  clock.t = NOW;
}
{
  // batal & batas
  const { rm, store } = await make({ max: 2 });
  rm.handle({ name: "ingatkan", arg: "besok 09:00 a" });
  rm.handle({ name: "ingatkan", arg: "besok 10:00 b" });
  check(rm.handle({ name: "ingatkan", arg: "besok 11:00 c" }).includes("penuh"), "batas: penuh ditolak dengan petunjuk");
  check(rm.handle({ name: "pengingat", arg: "batal 1" }).includes("Dibatalkan: a") && store.count() === 1, "batal: per nomor");
  check(rm.handle({ name: "pengingat", arg: "batal #9" }).includes("Tidak ada pengingat nomor 9") && rm.handle({ name: "pengingat", arg: "batal" }).includes("Sebut nomor"), "batal: nomor salah / kosong");
  check(rm.handle({ name: "pengingat", arg: "batal semua" }).includes("1 pengingat dibatalkan") && rm.handle({ name: "pengingat", arg: "" }).includes("Belum ada pengingat"), "batal: semua");
  check(rm.handle({ name: "pengingat", arg: "besok 09:00 lewat pengingat" }).includes("Kamis, 15 Okt 2026 09:00"), "perintah: /pengingat <waktu> <teks> juga menambah");
  check(rm.describe().includes("AKTIF (1 pengingat"), "describe: ringkasan");
  const none = createReminders({ store: null, send: async () => {}, log: silent });
  check(none.handle({ name: "ingatkan", arg: "besok x" }).includes("belum aktif") && (await none.check()) === 0 && none.describe().includes("mati"), "tanpa penyimpanan: ramah, tidak error");
}

// ---- Telegram
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
  const calls = [];
  const tg = createTelegram({ config: tcfg, deps: { chat: async (h) => { cloud.push(h); return "cloud"; }, reminders: { handle: (c) => { calls.push(c); return `R:${c.name}:${c.arg}`; } } }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/ingatkan besok 09:00 SPJ");
  await tg.handleOwnerText("111", "/pengingat");
  await tg.handleOwnerText("111", "/pengingat batal 2");
  check(sent.join("|") === "R:ingatkan:besok 09:00 SPJ|R:pengingat:|R:pengingat:batal 2" && cloud.length === 0, "telegram: /ingatkan & /pengingat -> modul, tidak ke AI cloud");
  const none = createTelegram({ config: tcfg, deps: { chat: async () => "x" }, fetchImpl: f, log: silent });
  await none.handleOwnerText("111", "/ingatkan besok 09:00 x");
  check(sent.at(-1).includes("belum aktif"), "telegram: tanpa modul -> pesan ramah");
  const boom = createTelegram({ config: tcfg, deps: { chat: async () => "x", reminders: { handle: () => { throw new Error("rusak"); } } }, fetchImpl: f, log: silent });
  await boom.handleOwnerText("111", "/pengingat");
  check(sent.at(-1).includes("Pengingat gagal") && sent.at(-1).includes("rusak"), "telegram: galat dilaporkan");
}

console.log(fails === 0 ? "\nSemua tes pengingat lulus." : `\n${fails} tes pengingat GAGAL.`);
process.exit(fails === 0 ? 0 : 1);
