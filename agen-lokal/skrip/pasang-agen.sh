#!/usr/bin/env bash
# Menjalankan Agen Lokal di bawah pm2 (hidup terus, menyala lagi sendiri bila mati / setelah laptop dinyalakan ulang).
# Pemakaian (akun biasa, tanpa sudo):  bash skrip/pasang-agen.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

fail() { echo "⛔ $1" >&2; exit 1; }

command -v node >/dev/null || fail "Node.js belum terpasang."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js harus versi 20 ke atas (sekarang $(node -v))."
command -v pm2 >/dev/null || fail "pm2 belum ada. Pasang: sudo npm install -g pm2"

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Berkas .env baru dibuat dari contoh. Isi dulu lalu jalankan skrip ini lagi:"
  echo "  nano $DIR/.env"
  exit 0
fi
chmod 600 .env
grep -qE '^TELEGRAM_BOT_TOKEN=.+' .env || fail "TELEGRAM_BOT_TOKEN di .env masih kosong."
grep -qE '^AGENT_ROOTS=.+' .env || fail "AGENT_ROOTS di .env masih kosong."

if command -v curl >/dev/null && ! curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "⚠️  Ollama belum menjawab di 127.0.0.1:11434 (cek: systemctl status ollama). Agen tetap dijalankan, tapi belum bisa berpikir."
fi
command -v pdftotext >/dev/null || echo "ℹ️  PDF rumit lebih baik dengan: sudo apt install poppler-utils (opsional)"

if pm2 describe agen-lokal >/dev/null 2>&1; then
  pm2 restart agen-lokal --update-env
else
  pm2 start src/index.js --name agen-lokal --cwd "$DIR" --restart-delay 5000 --time
fi
pm2 save
echo
echo "✅ Agen Lokal berjalan. Lihat log: pm2 logs agen-lokal --lines 30"
echo "   Kirim /status ke bot Telegram-nya untuk memastikan."
