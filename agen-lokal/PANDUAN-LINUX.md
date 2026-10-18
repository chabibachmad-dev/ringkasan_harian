# Panduan: Agen Lokal di laptop Linux (server) + akses jarak jauh

Tujuan: laptop Ubuntu-mu jadi server yang bisa kamu perintah dari Telegram (Agen Lokal), dan bisa kamu masuki lewat SSH dari HP bila perlu. Dua hal itu terpisah:

- **Agen Lokal** = bot Telegram yang berpikir dengan Ollama di laptop itu. Aman karena tiap perubahan minta tombol ✅/❌ darimu. Cukup untuk kebanyakan keperluan.
- **SSH** = pintu masuk terminal penuh ke laptop (tanpa tombol persetujuan). Dipasang lewat Tailscale supaya tidak terbuka ke internet, dan hanya bisa dimasuki dengan kunci, bukan kata sandi.

Langkah A dan B hampir semuanya dilakukan **sekali** di terminal laptop (duduk di depan laptopnya). Sesudah itu semuanya bisa dari HP.

---

## A. Pasang Agen Lokal

**A1. Kirim patch** ke bot Ayyubi seperti biasa, lalu `/ya <kode>`. Ini menaruh folder `agen-lokal/` di sebelah folder `wa-bot/`. Tidak perlu `/restart` (Ayyubi tidak berubah). `/rilis` bila mau ikut disimpan ke GitHub.

**A2. Buat bot Telegram baru** untuk agen: di Telegram buka **@BotFather** → `/newbot` → salin token. Pakai bot **baru**, jangan token Ayyubi (dua program tidak boleh memakai satu token).

**A3. Buka terminal laptop** dan masuk ke folder agen. Cara mudah mencari tempatnya:

```
pm2 describe wa-bot | grep -i "exec cwd"
```

Itu menampilkan folder `wa-bot`; `agen-lokal` ada di sebelahnya (satu tingkat ke atas, lalu `agen-lokal`). Misalnya `cd ~/ringkasan_harian/agen-lokal`.

**A4. Jalankan pemasang** (pertama kali ia hanya membuatkan berkas `.env`):

```
bash skrip/pasang-agen.sh
nano .env
```

Isi di `.env`:

- `TELEGRAM_BOT_TOKEN=` token dari BotFather
- `AGENT_ROOTS=` folder yang boleh disentuh alat berkas, mis. `~/Dokumen;~/Unduhan`. **Jangan** isi folder proyek Ayyubi dan jangan `/`.
- `AGENT_WORKDIR=` satu folder di dalamnya untuk berkas baru dan `_sampah`, mis. `~/Dokumen/agen` (buat dulu: `mkdir -p ~/Dokumen/agen`)
- `OLLAMA_MODEL=` salah satu nama dari `ollama list` (bawaan `qwen2.5:7b`; bila belum ada: `ollama pull qwen2.5:7b`)

Simpan (Ctrl+O, Enter, Ctrl+X), lalu jalankan lagi:

```
bash skrip/pasang-agen.sh
```

Skrip memeriksa Node ≥ 20, pm2, dan Ollama, lalu menjalankan agen sebagai proses `agen-lokal` dan menyimpannya agar ikut hidup saat laptop dinyalakan ulang (bila `pm2 startup` sudah pernah kamu jalankan untuk Ayyubi, tidak perlu diulang; kalau belum: `pm2 startup`, jalankan perintah yang ditampilkannya, lalu `pm2 save`).

**A5. Daftarkan dirimu:** kirim pesan apa saja ke bot barumu. Bot membalas **id Telegram-mu**. Isi `TELEGRAM_OWNER_IDS=` di `.env` dengan angka itu, lalu:

```
pm2 restart agen-lokal
```

**A6. Coba:** kirim `/status` (harus menampilkan model), lalu "berapa sisa ruang disk dan memori?" — agen mengajukan perintah dan kamu tekan ✅.

Pemakaian sehari-hari: lihat README (`/baru`, `/batal`, `/model`, `/ulang`). Untuk memperbarui agen sesudah patch baru: kirim zip → `/ya <kode>` → kirim `/ulang` ke bot agen (pm2 menyalakannya lagi).

> Pencarian PDF yang rumit lebih baik dengan `sudo apt install poppler-utils` (opsional).

---

## B. Akses jarak jauh (SSH lewat Tailscale)

**B1. Tailscale di laptop dan HP** (akun yang sama, aktifkan verifikasi dua langkah di akun Tailscale-nya):

```
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Buka alamat login yang muncul, masuk. Pasang aplikasi **Tailscale** di HP dan masuk dengan akun yang sama. Lihat alamat laptop: `tailscale ip -4` (berbentuk `100.x.x.x`). Alamat ini hanya bisa dicapai perangkat di akun Tailscale-mu.

**B2. Buat kunci SSH di HP.** Pilih satu:

- **Termius** (Android/iPhone): Keychain → tambah kunci → *Generate* → jenis **ED25519**. Salin *public key* (satu baris, diawali `ssh-ed25519`).
- **Termux** (Android): `pkg install openssh`, lalu `ssh-keygen -t ed25519` dan `cat ~/.ssh/id_ed25519.pub`.

Kunci pribadi tetap di HP; yang disalin ke laptop hanya kunci **publik**.

**B3. Pasang & kunci SSH di laptop** (tempel kunci publik di antara tanda kutip):

```
sudo bash skrip/pasang-ssh.sh "ssh-ed25519 AAAA...isi-kunci-publikmu... hp-aku" --firewall
```

Skrip: memasang OpenSSH, mendaftarkan kunci, **mematikan login kata sandi dan login root**, membatasi ke akunmu, lalu menyalakan firewall yang hanya mengizinkan SSH dari Tailscale dan jaringan lokal (192.168.x, 10.x, 172.16–31.x). Kata sandi tidak dimatikan selama belum ada kunci, supaya kamu tidak terkunci di luar. Aman diulang. Bila di laptop ada layanan lain yang harus dijangkau dari jaringan (mis. server web lokal), tambahkan aturannya dulu (`sudo ufw allow <port>`), atau jalankan tanpa `--firewall`.

**B4. UJI sebelum percaya:** dari HP (Tailscale menyala) sambungkan ke `100.x.x.x`, port 22, nama pengguna akun laptopmu, autentikasi dengan kunci tadi. Kalau masuk, beres. Jangan tutup terminal laptop sebelum uji ini berhasil.

---

## C. Laptop jangan tidur

```
sudo bash skrip/server-tanpa-tidur.sh
```

Menutup layar atau diam lama tidak lagi membuat laptop tidur. Layar boleh mati sendiri. Tips: biarkan tersambung ke charger, jangan ditutup di tempat pengap (ventilasi laptop tertutup lebih panas), dan di BIOS/UEFI aktifkan opsi "nyalakan sendiri saat listrik kembali" bila ada. Uji: tutup layar semenit, kirim `/status` ke bot — harus tetap menjawab.

---

## D. Perintah berguna (lewat SSH atau terminal)

```
pm2 list                         # semua proses (wa-bot, agen-lokal)
pm2 logs agen-lokal --lines 30   # log agen
pm2 restart agen-lokal           # mulai ulang agen
systemctl status ollama          # kondisi Ollama
ollama list                      # model yang sudah diunduh
tailscale status                 # perangkat di jaringan Tailscale-mu
```

## E. Kalau ada masalah

- **Bot agen diam / "409 Conflict" di log:** token yang sama dipakai program lain. Buat bot baru di BotFather untuk agen.
- **Bot tidak menjawab pesanmu:** bot hanya melayani id di `TELEGRAM_OWNER_IDS`, selain itu diabaikan diam-diam. Pastikan terisi benar (A5) dan kamu menulis lewat chat pribadi, bukan grup.
- **"Model belum diunduh":** `ollama pull <nama-model>` lalu `/status`.
- **Agen menolak perintah:** ada daftar tolak permanen (sudo, hapus massal, matikan mesin, putus SSH, berkas rahasia). Untuk hal seperti itu, masuk lewat SSH dan lakukan sendiri.
- **Terkunci dari SSH** (jarang): duduk di laptop, lalu `sudo rm /etc/ssh/sshd_config.d/00-ayyubi.conf && sudo systemctl restart ssh` dan `sudo ufw disable`; ulangi B3.
- **Kehilangan HP:** hapus kunci HP itu dari `~/.ssh/authorized_keys` dan keluarkan perangkatnya dari akun Tailscale; kunci SSH membuat HP lain tetap tidak bisa masuk.
