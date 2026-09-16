export const STRINGS = {
  id: {
    brand: "Ringkasan Harian",
    notify_prompt: "Aktifkan notifikasi supaya kamu tahu begitu ringkasan hari ini siap.",
    notify_btn: "Aktifkan Notifikasi",
    notify_on: "Notifikasi Aktif ✅",
    notify_need_install:
      "Tambahkan dulu ke Layar Utama (tombol Share di Safari → \"Add to Home Screen\"), lalu buka lagi dari ikon di layar utama untuk mengaktifkan notifikasi.",
    notify_unsupported: "Browser ini belum mendukung notifikasi push.",
    notify_denied: "Izin notifikasi ditolak. Aktifkan lewat pengaturan notifikasi Safari untuk situs ini.",
    notify_error: "Gagal mengaktifkan notifikasi, coba lagi nanti.",
    notify_save_error:
      "Notifikasi aktif di perangkat ini, tapi gagal tersimpan ke server (jadi belum akan menerima kiriman). Tap tombol di bawah untuk coba simpan ulang.",
    notify_retry_btn: "Coba Simpan Ulang",
    pick_date: "Pilih tanggal:",
    loading: "Memuat ringkasan…",
    no_summary: "Belum ada ringkasan untuk tanggal ini.",
    failed_summary: "Ringkasan pada tanggal ini gagal dibuat.",
    sources_title: "Sumber & bacaan lebih lanjut",
    sources_indonesia: "🇮🇩 Indonesia",
    sources_dunia: "🌍 Dunia",
    no_sources: "Tidak ada sumber tercatat.",
    footer_note: "Dibuat otomatis tiap hari jam 20:00 WITA dari berbagai sumber berita publik.",
    load_error: "Gagal memuat data dari server. Cek koneksi internet kamu."
  },
  en: {
    brand: "Daily Digest",
    notify_prompt: "Turn on notifications so you know the moment today's digest is ready.",
    notify_btn: "Enable Notifications",
    notify_on: "Notifications On ✅",
    notify_need_install:
      "First add this app to your Home Screen (Safari Share button → \"Add to Home Screen\"), then reopen it from the home screen icon to enable notifications.",
    notify_unsupported: "This browser doesn't support push notifications yet.",
    notify_denied: "Notification permission was denied. Enable it from Safari's notification settings for this site.",
    notify_error: "Couldn't enable notifications, please try again later.",
    notify_save_error:
      "Notifications are active on this device, but failed to sync with the server (so you won't receive anything yet). Tap the button below to retry.",
    notify_retry_btn: "Retry Saving",
    pick_date: "Pick a date:",
    loading: "Loading digest…",
    no_summary: "No digest available for this date yet.",
    failed_summary: "The digest for this date failed to generate.",
    sources_title: "Sources & further reading",
    sources_indonesia: "🇮🇩 Indonesia",
    sources_dunia: "🌍 World",
    no_sources: "No sources recorded.",
    footer_note: "Generated automatically every day at 20:00 WITA (Indonesia time) from public news sources.",
    load_error: "Couldn't load data from the server. Check your internet connection."
  }
};

export function t(lang, key) {
  return STRINGS[lang]?.[key] ?? STRINGS.id[key] ?? key;
}

export function applyStaticI18n(lang) {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(lang, key);
  });
  document.documentElement.lang = lang;
}
