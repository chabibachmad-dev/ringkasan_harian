export const STRINGS = {
  id: {
    brand: "Daily Insider",
    notify_prompt: "Aktifkan notifikasi supaya kamu tahu begitu ringkasan hari ini siap.",
    notify_on: "Notifikasi aktif",
    notify_need_install:
      "Tambahkan dulu ke Layar Utama (tombol Share di Safari → \"Add to Home Screen\"), lalu buka lagi dari ikon di layar utama untuk mengaktifkan notifikasi.",
    notify_unsupported: "Browser ini belum mendukung notifikasi push.",
    notify_denied: "Izin notifikasi ditolak. Aktifkan lewat pengaturan notifikasi Safari untuk situs ini.",
    notify_error: "Gagal mengaktifkan notifikasi, coba lagi nanti. Tap untuk coba lagi.",
    notify_save_error: "Notifikasi aktif di perangkat ini, tapi gagal tersimpan ke server. Tap untuk coba simpan ulang.",
    loading: "Memuat ringkasan…",
    no_summary: "Belum ada ringkasan untuk tanggal ini.",
    failed_summary: "Ringkasan pada tanggal ini gagal dibuat.",
    sources_indonesia: "Indonesia",
    sources_dunia: "Dunia",
    footer_note: "Dibuat otomatis tiap hari jam 20:00 WITA dari berbagai sumber berita publik.",
    load_error: "Gagal memuat data dari server. Cek koneksi internet kamu.",
    search_placeholder: "Cari tanggal atau topik…",
    chat_code_prompt: "Fitur ini pribadi. Masukkan kode akses untuk membukanya.",
    chat_code_placeholder: "Kode akses",
    chat_code_submit: "Buka",
    chat_code_cancel: "Batal",
    chat_code_title: "Kode Akses",
    chat_code_wrong: "Kode akses salah, coba lagi.",
    chat_unlock_btn: "Buka Diskusi",
    chat_send: "Kirim",
    chat_empty: "Balas ringkasan ini atau mulai diskusi di bawah.",
    chat_sending: "Mengetik…",
    chat_error: "Gagal mengirim pesan. Coba lagi.",
    chat_load_error: "Gagal memuat riwayat diskusi.",
    chat_you_prefix: "Kamu:",
    chat_summary_more: "Tampilkan selengkapnya",
    chat_summary_less: "Tampilkan lebih sedikit"
  },
  en: {
    brand: "Daily Insider",
    notify_prompt: "Turn on notifications so you know the moment today's digest is ready.",
    notify_on: "Notifications on",
    notify_need_install:
      "First add this app to your Home Screen (Safari Share button → \"Add to Home Screen\"), then reopen it from the home screen icon to enable notifications.",
    notify_unsupported: "This browser doesn't support push notifications yet.",
    notify_denied: "Notification permission was denied. Enable it from Safari's notification settings for this site.",
    notify_error: "Couldn't enable notifications, please try again later. Tap to retry.",
    notify_save_error: "Notifications are active on this device, but failed to sync with the server. Tap to retry.",
    loading: "Loading digest…",
    no_summary: "No digest available for this date yet.",
    failed_summary: "The digest for this date failed to generate.",
    sources_indonesia: "Indonesia",
    sources_dunia: "World",
    footer_note: "Generated automatically every day at 20:00 WITA (Indonesia time) from public news sources.",
    load_error: "Couldn't load data from the server. Check your internet connection.",
    search_placeholder: "Search dates or topics…",
    chat_code_prompt: "This is private. Enter the access code to unlock it.",
    chat_code_placeholder: "Access code",
    chat_code_submit: "Unlock",
    chat_code_cancel: "Cancel",
    chat_code_title: "Access Code",
    chat_code_wrong: "Wrong access code, try again.",
    chat_unlock_btn: "Open Discussion",
    chat_send: "Send",
    chat_empty: "Reply to this digest or start a discussion below.",
    chat_sending: "Typing…",
    chat_error: "Couldn't send the message. Please try again.",
    chat_load_error: "Couldn't load the discussion history.",
    chat_you_prefix: "You:",
    chat_summary_more: "Show more",
    chat_summary_less: "Show less"
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
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.setAttribute("placeholder", t(lang, key));
  });
  document.documentElement.lang = lang;
}
