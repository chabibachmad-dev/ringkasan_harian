#!/usr/bin/env bash
# Agar laptop tetap menyala sebagai server: tidak tidur saat layar/tutup laptop, tidak hibernasi.
# Pemakaian: sudo bash skrip/server-tanpa-tidur.sh
# Layar boleh mati sendiri (hemat); yang dicegah hanya tidur sistem.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan dengan sudo: sudo bash $0" >&2
  exit 1
fi

echo "==> Tutup layar laptop tidak lagi membuat tidur"
install -d /etc/systemd/logind.conf.d
cat >/etc/systemd/logind.conf.d/90-ayyubi.conf <<'CONF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
CONF

echo "==> Mematikan target tidur/hibernasi"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1

# muat ulang aturan tanpa memulai ulang logind (memulai ulang bisa menutup sesi grafis yang sedang terbuka)
systemctl kill -s HUP systemd-logind 2>/dev/null || true

AKUN="${SUDO_USER:-}"
if [ -n "$AKUN" ] && [ "$AKUN" != "root" ]; then
  UID_AKUN="$(id -u "$AKUN")"
  if [ -S "/run/user/$UID_AKUN/bus" ]; then
    echo "==> Pengaturan hemat daya desktop GNOME: tidak tidur saat diam"
    for kunci in sleep-inactive-ac-type sleep-inactive-battery-type; do
      sudo -u "$AKUN" env DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UID_AKUN/bus" \
        gsettings set org.gnome.settings-daemon.plugins.power "$kunci" 'nothing' 2>/dev/null || true
    done
  fi
fi

echo
echo "Selesai. Uji: tutup layar laptop 1 menit lalu kirim /status ke bot Telegram; harus tetap menjawab."
echo "Tambahan di BIOS/UEFI (sekali saja): aktifkan \"Restore on AC Power Loss\" / \"Power On after power failure\" bila ada,"
echo "supaya laptop menyala sendiri setelah listrik padam."
