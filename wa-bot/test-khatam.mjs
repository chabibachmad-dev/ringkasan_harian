// node test-khatam.mjs -- tes hitungan khatam (bot == aplikasi) & pengingat harian.
import { computeKhatam as botCompute, createKhatamReminder, parseReminderTime } from "./khatam.js";
import { computeKhatam as appCompute } from "../src/khatam.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

const K = { startDate: "2026-10-01", targetDays: 30, startPage: 1 };
// 1. hari ke-1, belum baca
let c = botCompute(K, null, "2026-10-01");
check(c.total === 604 && c.dayNo === 1 && c.goalToday === 21 && c.read === 0 && c.status === "behind", "hari 1: target hal 21 (604/30 dibulatkan ke atas)");
// 2. sudah di halaman 21 -> on track
c = botCompute(K, 21, "2026-10-01");
check(c.status === "on_track" && c.behindPages === 0 && c.percent === 3, "hari 1, hal 21 => sesuai target");
// 3. hari ke-10, di halaman 100 -> tertinggal
c = botCompute(K, 100, "2026-10-10");
check(c.dayNo === 10 && c.goalToday === 202 && c.behindPages === 102 && c.status === "behind", "hari 10 hal 100 tertinggal 102 halaman");
check(c.daysLeft === 21 && c.perDay === Math.ceil(504 / 21), "sisa 504 halaman / 21 hari = 24 per hari");
// 4. selesai
c = botCompute(K, 604, "2026-10-20");
check(c.finished && c.status === "finished" && c.remaining === 0 && c.percent === 100, "hal 604 = khatam");
// 5. lewat tenggat
c = botCompute(K, 300, "2026-11-15");
check(c.overdue && c.status === "overdue" && c.dayNo === 30 && c.daysLeft === 1 && c.remaining === 304, "lewat tenggat -> overdue");
// 6. belum mulai
c = botCompute({ ...K, startDate: "2026-10-10" }, null, "2026-10-05");
check(c.status === "not_started", "belum mulai");
// 7. mulai dari halaman tertentu (juz 30 = hal 582)
c = botCompute({ startDate: "2026-10-01", targetDays: 3, startPage: 582 }, 590, "2026-10-01");
check(c.total === 23 && c.read === 9 && c.goalToday === 582 - 1 + Math.ceil(23 / 3) && c.status === "on_track", "mulai dari hal 582: total 23 halaman");
// 8. halaman di bawah startPage dihitung belum membaca
c = botCompute({ ...K, startPage: 100 }, 50, "2026-10-01");
check(c.read === 0 && c.todayFrom === 100, "halaman sebelum startPage = belum baca");
// 9. bot == aplikasi (acak)
let same = true;
for (let i = 0; i < 2000; i++) {
  const k = { startDate: `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, targetDays: 1 + ((i * 7) % 90), startPage: 1 + ((i * 13) % 604) };
  const page = i % 5 === 0 ? null : 1 + ((i * 31) % 604);
  const today = `2026-${String(1 + ((i * 3) % 12)).padStart(2, "0")}-${String(1 + ((i * 5) % 28)).padStart(2, "0")}`;
  if (JSON.stringify(botCompute(k, page, today)) !== JSON.stringify(appCompute(k, page, today))) { same = false; console.log("beda", k, page, today); break; }
}
check(same, "hitungan bot == aplikasi (2000 kasus acak)");

// 10. pengingat
check(parseReminderTime("20:30") === 1230 && parseReminderTime("7.05") === 425 && parseReminderTime("ngawur") === 1230, "parse jam pengingat");
const mk = (kh, lr) => ({
  from: (t) => {
    const b = { select() { return b; }, eq() { return b; }, maybeSingle: async () => ({ data: t === "quran_khatam" ? kh : lr, error: null }) };
    return b;
  }
});
const sent = [];
const notify = async (p) => sent.push(p);
const quiet = { log() {}, error() {} };
const at = (iso) => () => new Date(iso);
const kh = { start_date: "2026-10-01", target_days: 30, start_page: 1, reminder: true };
{ // belum jam pengingat
  const r = createKhatamReminder({ supabase: mk(kh, { page: 10 }), notify, timeZone: "Asia/Jakarta", reminderTime: "20:30", now: at("2026-10-05T10:00:00Z"), log: quiet }); // 17:00 WIB
  check((await r.check()) === false && sent.length === 0, "sebelum jam pengingat: tidak kirim");
}
{ // sesudah jam, tertinggal -> kirim sekali
  const r = createKhatamReminder({ supabase: mk(kh, { page: 10 }), notify, timeZone: "Asia/Jakarta", reminderTime: "20:30", now: at("2026-10-05T14:00:00Z"), log: quiet }); // 21:00 WIB
  check((await r.check()) === true && sent.length === 1 && /halaman 101/.test(sent[0].body) && sent[0].url === "./#quran", "tertinggal: kirim push (target hal 101)");
  check((await r.check()) === false && sent.length === 1, "tidak kirim dua kali di hari yang sama");
}
{ // sudah memenuhi target -> diam
  sent.length = 0;
  const r = createKhatamReminder({ supabase: mk(kh, { page: 150 }), notify, timeZone: "Asia/Jakarta", reminderTime: "20:30", now: at("2026-10-05T14:00:00Z"), log: quiet });
  check((await r.check()) === false && sent.length === 0, "target hari ini sudah tercapai: tidak kirim");
}
{ // pengingat dimatikan / tidak ada target
  sent.length = 0;
  const r1 = createKhatamReminder({ supabase: mk({ ...kh, reminder: false }, { page: 1 }), notify, timeZone: "Asia/Jakarta", now: at("2026-10-05T14:00:00Z"), log: quiet });
  const r2 = createKhatamReminder({ supabase: mk(null, null), notify, timeZone: "Asia/Jakarta", now: at("2026-10-05T14:00:00Z"), log: quiet });
  await r1.check(); await r2.check();
  check(sent.length === 0, "pengingat mati / belum ada target: tidak kirim");
}
console.log(fails ? `GAGAL (${fails})` : "SEMUA OK");
process.exit(fails ? 1 : 0);
