// Bilah atas bersama (Study + beranda): hanya Kembali / Judul / Bahasa / Hamburger di luar menu.
// Fungsi di sini MURNI (tanpa DOM) supaya bisa diuji; pemasangan ke DOM ada di study.js / main.js.

// Tema: pilihan tersimpan ("light"/"dark") menang; kalau belum ada, ikuti prefers-color-scheme.
export function resolveTheme(stored, prefersDark) {
  if (stored === "dark" || stored === "light") return stored;
  return prefersDark ? "dark" : "light";
}

export const nextTheme = (t) => (t === "dark" ? "light" : "dark");
export const nextLang = (l) => (l === "id" ? "en" : "id");
export const themeColor = (t) => (t === "dark" ? "#000000" : "#ffffff");

// Tulis tema ke <html data-theme> dan meta theme-color. `doc` boleh tiruan sederhana saat tes.
export function applyThemeTo(doc, theme) {
  doc.documentElement.setAttribute("data-theme", theme);
  const meta = doc.getElementById?.("meta-theme-color");
  if (meta) meta.setAttribute("content", themeColor(theme));
}

// Baris menu. Urutan: Notifikasi, aksi halaman (Pemain baru, ...), Pengaturan, Tema.
// `labels` = teks sudah diterjemahkan; `pageItems` = [[act, label], ...] dari halaman.
export function headerMenuRows({ theme, unread = 0, hasNotif = false, hasSettings = false, pageItems = [], labels }) {
  const rows = [];
  if (hasNotif) rows.push({ act: "menu-notif", icon: "bell", label: labels.notif, count: unread > 0 ? unread : 0 });
  for (const [act, label] of pageItems) rows.push({ act, icon: "", label });
  if (hasSettings) rows.push({ act: "menu-settings", icon: "gear", label: labels.settings });
  rows.push({
    act: "menu-theme",
    icon: theme === "dark" ? "sun" : "moon",
    label: theme === "dark" ? labels.themeLight : labels.themeDark
  });
  return rows;
}

// Titik kecil di tombol hamburger bila ada notifikasi belum dibaca.
export const menuDot = (unread, hasNotif) => !!hasNotif && unread > 0;
export const countText = (n) => (n > 99 ? "99+" : String(n));
