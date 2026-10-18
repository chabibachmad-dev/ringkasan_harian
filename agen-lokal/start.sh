#!/usr/bin/env bash
# Menjalankan tanpa pm2 (mis. untuk mencoba): bash start.sh   -- menyala lagi sendiri 10 detik setelah berhenti.
cd "$(dirname "$0")" || exit 1
while true; do
  node src/index.js
  echo "[$(date '+%F %T')] Agen berhenti. Mulai ulang dalam 10 detik... (Ctrl+C untuk menghentikan)"
  sleep 10
done
