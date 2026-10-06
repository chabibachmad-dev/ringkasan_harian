// Pengingat harian target khatam Al-Qur'an (push ke HP lewat send-push).
//
// Bot membaca tabel quran_khatam & quran_last_read (service role), dan kalau
// target hari ini BELUM tercapai, mengirim satu push per hari pada jam
// KHATAM_REMINDER_TIME (default 20:30, zona waktu WA_TIMEZONE). Tidak dikirim bila
// khatam sudah selesai, pengingat dimatikan, atau target hari ini sudah terpenuhi.
// Status "sudah dikirim hari ini" disimpan di khatam-state.json supaya restart bot
// tidak mengirim dua kali.
import fs from "node:fs";

const TOTAL_PAGES = 604;
const DAY_MS = 86400000;
function dayNumber(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
}

// SALINAN dari src/khatam.js (aplikasi) -- ubah bersamaan. Lihat test-khatam.mjs.
export function computeKhatam(khatam, page, today) {
  const startPage = Math.min(TOTAL_PAGES, Math.max(1, Math.round(khatam.startPage || 1)));
  const targetDays = Math.max(1, Math.round(khatam.targetDays || 1));
  const total = TOTAL_PAGES - startPage + 1;
  const elapsed = Math.max(0, dayNumber(today) - dayNumber(khatam.startDate));
  const notStarted = dayNumber(today) < dayNumber(khatam.startDate);
  const dayNo = Math.min(elapsed + 1, targetDays);

  const read = page && page >= startPage ? Math.min(total, page - startPage + 1) : 0;
  const currentPage = read > 0 ? startPage + read - 1 : startPage - 1;
  const finished = read >= total;
  const overdue = !finished && elapsed >= targetDays;

  const goalToday = Math.min(TOTAL_PAGES, startPage - 1 + Math.ceil((total * dayNo) / targetDays));
  const goalYesterday = Math.min(TOTAL_PAGES, startPage - 1 + Math.ceil((total * (dayNo - 1)) / targetDays));
  const remaining = total - read;
  const daysLeft = Math.max(1, targetDays - elapsed);
  const perDay = Math.ceil(remaining / daysLeft);
  const behindPages = Math.max(0, goalToday - currentPage);
  const status = finished ? "finished" : notStarted ? "not_started" : behindPages === 0 ? "on_track" : overdue ? "overdue" : "behind";

  return {
    total, read, remaining, percent: Math.round((read / total) * 100), dayNo, targetDays, elapsed, daysLeft, perDay,
    goalToday, goalYesterday, behindPages, currentPage, todayFrom: Math.min(TOTAL_PAGES, currentPage + 1), status, finished, overdue
  };
}

const localDate = (date, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
const localHm = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return h * 60 + m;
};

export function parseReminderTime(raw) {
  const m = String(raw || "20:30").trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return 20 * 60 + 30;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

export function createKhatamReminder({ supabase, notify, timeZone, stateFile, reminderTime = "20:30", now = () => new Date(), log = console }) {
  const atMinutes = parseReminderTime(reminderTime);
  let lastSent = null; // "YYYY-MM-DD" terakhir kali pengingat dikirim
  try {
    if (stateFile) lastSent = JSON.parse(fs.readFileSync(stateFile, "utf8")).lastSent ?? null;
  } catch {
    /* belum ada */
  }

  async function check() {
    const d = now();
    const today = localDate(d, timeZone);
    if (lastSent === today || localHm(d, timeZone) < atMinutes) return false;

    const { data: k, error } = await supabase.from("quran_khatam").select("*").eq("id", "main").maybeSingle();
    if (error || !k || !k.reminder) return false; // tabel belum ada / tidak ada target / pengingat mati
    const { data: lr } = await supabase.from("quran_last_read").select("page").eq("id", "main").maybeSingle();
    const c = computeKhatam({ startDate: k.start_date, targetDays: k.target_days, startPage: k.start_page }, lr?.page ?? null, today);
    if (c.finished || c.status === "on_track" || c.status === "not_started") {
      // Tidak perlu diingatkan hari ini; jangan cek lagi sampai besok.
      lastSent = today;
      save();
      return false;
    }

    const body =
      c.status === "overdue"
        ? `Target khatam sudah lewat. Sisa ${c.remaining} halaman (kamu di halaman ${c.currentPage || "-"}).`
        : `Target hari ini sampai halaman ${c.goalToday}. Kamu di halaman ${c.currentPage || "-"} — kurang ${c.behindPages} halaman.`;
    try {
      await notify({ title: "Pengingat khatam Al-Qur'an", body, url: "./#quran", tag: "khatam-reminder" });
      log.log(`📖 Pengingat khatam terkirim: ${body}`);
    } catch (err) {
      log.error("📖 Pengingat khatam gagal dikirim:", err instanceof Error ? err.message : String(err));
      return false; // coba lagi di cek berikutnya
    }
    lastSent = today;
    save();
    return true;
  }

  function save() {
    if (!stateFile) return;
    try {
      fs.writeFileSync(stateFile, JSON.stringify({ lastSent }));
    } catch {
      /* best-effort */
    }
  }

  return { check, get lastSent() { return lastSent; } };
}
