#!/usr/bin/env bash
# Memasang dan MENGAMANKAN SSH di server Ubuntu agar bisa diakses dari HP/laptop lain dengan aman.
#
# Pemakaian (dari akun biasa, bukan root):
#   sudo bash skrip/pasang-ssh.sh "ssh-ed25519 AAAA... catatan-kunci"          pasang + kunci publik HP-mu
#   sudo bash skrip/pasang-ssh.sh "ssh-ed25519 AAAA... catatan-kunci" --firewall   ... dan aktifkan firewall
#   sudo bash skrip/pasang-ssh.sh --firewall                                   hanya firewall (kunci sudah ada)
#
# Yang dilakukan:
#   1. memasang openssh-server (+ ufw) dan menyalakannya
#   2. menaruh kunci publikmu di ~/.ssh/authorized_keys
#   3. HANYA bila sudah ada minimal satu kunci: mematikan login kata sandi & login root
#      (supaya kamu tidak terkunci di luar, kata sandi tidak dimatikan selama belum ada kunci)
#   4. (opsional --firewall) hanya mengizinkan SSH dari Tailscale dan jaringan kantor/rumah (192.168.x, 10.x, 172.16-31.x)
# Aman dijalankan berulang kali.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan dengan sudo, mis.: sudo bash $0 \"ssh-ed25519 AAAA... catatan\"" >&2
  exit 1
fi
AKUN="${SUDO_USER:-}"
if [ -z "$AKUN" ] || [ "$AKUN" = "root" ]; then
  echo "Jalankan lewat sudo dari akun biasa (bukan langsung sebagai root)." >&2
  exit 1
fi
RUMAH="$(getent passwd "$AKUN" | cut -d: -f6)"

KUNCI=""
FIREWALL=0
for a in "$@"; do
  case "$a" in
    --firewall) FIREWALL=1 ;;
    ssh-*|ecdsa-*|sk-*) KUNCI="$a" ;;
    *) echo "Argumen tidak dikenal: $a" >&2; exit 1 ;;
  esac
done

echo "==> Memasang openssh-server, openssh-client, dan ufw"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y openssh-server openssh-client ufw >/dev/null

echo "==> Menyiapkan ~/.ssh milik $AKUN"
install -d -m 700 -o "$AKUN" -g "$AKUN" "$RUMAH/.ssh"
AK="$RUMAH/.ssh/authorized_keys"
touch "$AK"
chown "$AKUN:$AKUN" "$AK"
chmod 600 "$AK"

if [ -n "$KUNCI" ]; then
  TMP="$(mktemp)"
  printf '%s\n' "$KUNCI" >"$TMP"
  if ! ssh-keygen -l -f "$TMP" >/dev/null 2>&1; then
    rm -f "$TMP"
    echo "Kunci publik tidak valid. Salin ulang utuh satu baris (diawali ssh-ed25519 ...)." >&2
    exit 1
  fi
  rm -f "$TMP"
  if grep -qxF "$KUNCI" "$AK"; then
    echo "    kunci itu sudah terdaftar"
  else
    printf '%s\n' "$KUNCI" >>"$AK"
    echo "    kunci ditambahkan"
  fi
fi

JUMLAH="$(grep -cE '^(ssh-|ecdsa-|sk-)' "$AK" || true)"
CONF="/etc/ssh/sshd_config.d/00-ayyubi.conf"
install -d -m 755 /etc/ssh/sshd_config.d

{
  echo "# Dibuat oleh skrip/pasang-ssh.sh (Agen Lokal). Hapus berkas ini untuk mengembalikan bawaan."
  echo "PermitRootLogin no"
  echo "PubkeyAuthentication yes"
  echo "MaxAuthTries 3"
  echo "LoginGraceTime 30"
  echo "X11Forwarding no"
  echo "ClientAliveInterval 60"
  echo "ClientAliveCountMax 3"
  echo "AllowUsers $AKUN"
  if [ "$JUMLAH" -ge 1 ]; then
    echo "PasswordAuthentication no"
    echo "KbdInteractiveAuthentication no"
  fi
} >"$CONF"
chmod 644 "$CONF"

if ! sshd -t; then
  rm -f "$CONF"
  echo "Konfigurasi SSH ditolak sshd; perubahan dibatalkan (berkas $CONF dihapus)." >&2
  exit 1
fi
systemctl enable ssh >/dev/null 2>&1 || systemctl enable sshd >/dev/null 2>&1 || true
systemctl restart ssh 2>/dev/null || systemctl restart sshd

if [ "$JUMLAH" -ge 1 ]; then
  echo "==> Login kata sandi & root DIMATIKAN ($JUMLAH kunci terdaftar). Hanya kunci yang bisa masuk."
else
  echo "==> BELUM ada kunci publik, jadi login kata sandi sengaja masih menyala (agar kamu tidak terkunci)."
  echo "    Ulangi: sudo bash $0 \"ssh-ed25519 AAAA... catatan\""
fi

if [ "$FIREWALL" -eq 1 ]; then
  echo "==> Mengatur firewall (ufw)"
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow in on tailscale0 >/dev/null
  for net in 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12; do
    ufw allow from "$net" to any port 22 proto tcp >/dev/null
  done
  ufw --force enable >/dev/null
  echo "    firewall aktif: SSH hanya dari Tailscale dan jaringan lokal"
fi

echo
echo "Hasil akhir yang berlaku di server:"
sshd -T 2>/dev/null | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|allowusers) ' || true
echo
echo "Selesai. Uji dari HP/laptop lain SEBELUM menutup sesi ini: ssh $AKUN@<alamat-tailscale>"
