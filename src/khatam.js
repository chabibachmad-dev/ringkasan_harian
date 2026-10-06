// Hitungan target khatam Al-Qur'an (logika murni, tanpa DOM). SALINAN yang sama
// persis ada di wa-bot/khatam.js (dipakai bot untuk pengingat harian) --
// ubah keduanya bersamaan; tes: wa-bot/test-khatam.mjs memastikan hasilnya sama.
//
// Model: baca dari halaman `startPage` sampai halaman 604 dalam `targetDays` hari
// sejak `startDate`. Posisi baca = halaman "terakhir dibaca" (halaman itu dianggap
// sudah selesai dibaca).
export const TOTAL_PAGES = 604;

const DAY_MS = 86400000;

// "YYYY-MM-DD" -> nomor hari (UTC) supaya selisih hari tidak terpengaruh zona waktu/DST.
function dayNumber(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
}

export function localDateString(date = new Date(), timeZone) {
  const opts = timeZone ? { timeZone } : {};
  return new Intl.DateTimeFormat("en-CA", opts).format(date); // YYYY-MM-DD
}

// khatam: { startDate, targetDays, startPage }; page: halaman terakhir dibaca (atau null);
// today: "YYYY-MM-DD".
export function computeKhatam(khatam, page, today) {
  const startPage = Math.min(TOTAL_PAGES, Math.max(1, Math.round(khatam.startPage || 1)));
  const targetDays = Math.max(1, Math.round(khatam.targetDays || 1));
  const total = TOTAL_PAGES - startPage + 1;
  const elapsed = Math.max(0, dayNumber(today) - dayNumber(khatam.startDate)); // 0 = hari pertama
  const notStarted = dayNumber(today) < dayNumber(khatam.startDate);
  const dayNo = Math.min(elapsed + 1, targetDays);

  const read = page && page >= startPage ? Math.min(total, page - startPage + 1) : 0;
  const currentPage = read > 0 ? startPage + read - 1 : startPage - 1; // halaman terakhir yang selesai (0-based awal)
  const finished = read >= total;
  const overdue = !finished && elapsed >= targetDays;

  const goalToday = Math.min(TOTAL_PAGES, startPage - 1 + Math.ceil((total * dayNo) / targetDays)); // sampai halaman ini hari ini
  const goalYesterday = Math.min(TOTAL_PAGES, startPage - 1 + Math.ceil((total * (dayNo - 1)) / targetDays));
  const remaining = total - read;
  const daysLeft = Math.max(1, targetDays - elapsed); // termasuk hari ini
  const perDay = Math.ceil(remaining / daysLeft);
  const behindPages = Math.max(0, goalToday - currentPage); // kurang dari target hari ini
  const status = finished ? "finished" : notStarted ? "not_started" : behindPages === 0 ? "on_track" : overdue ? "overdue" : "behind";

  return {
    total,
    read,
    remaining,
    percent: Math.round((read / total) * 100),
    dayNo,
    targetDays,
    elapsed,
    daysLeft,
    perDay,
    goalToday, // halaman akhir yang perlu dicapai hari ini
    goalYesterday,
    behindPages, // 0 kalau sudah memenuhi target hari ini
    currentPage, // halaman terakhir dibaca (dalam siklus ini)
    todayFrom: Math.min(TOTAL_PAGES, currentPage + 1), // mulai membaca dari halaman ini
    status,
    finished,
    overdue
  };
}
