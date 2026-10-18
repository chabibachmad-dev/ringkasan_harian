# Agen Lokal

Agent AI **gratis dan jalan di komputermu sendiri (Linux/Ubuntu atau Windows)**, dikendalikan lewat **bot Telegram**. Otaknya model lokal (Ollama), jadi tanpa biaya API dan percakapanmu tidak dikirim ke layanan AI di internet. Yang keluar dari laptop hanya pesan Telegram dan (kalau kamu minta) pencarian web.

Kemampuan:

- **Baca & cari file** di folder yang kamu izinkan: teks, Word (.docx), Excel (.xlsx), PDF.
- **Kelola file**: buat/tulis, salin, pindah/ganti nama, buat folder, "hapus" (hanya dipindah ke folder `_sampah`).
- **Cari di internet** (DuckDuckGo, tanpa kunci) dan membaca halaman web.
- **Jalankan perintah** di komputer: bash di Linux, PowerShell di Windows (selalu setelah kamu tekan Ya).
- **Kirim berkas** dari laptop ke Telegram, dan **terima berkas** dari Telegram ke folder kerja.

Semua tindakan yang mengubah sesuatu (tulis, pindah, salin, hapus, perintah) **meminta persetujuanmu lewat tombol ✅/❌ di Telegram** dan menampilkan persis apa yang akan dilakukan.

## Pasang di Linux (server Ubuntu) — yang dianjurkan

Ikuti **`PANDUAN-LINUX.md`** (langkah demi langkah, termasuk pm2 agar hidup terus, akses jarak jauh SSH lewat Tailscale, dan mencegah laptop tidur). Ringkasnya: buat bot baru di @BotFather, isi `.env`, lalu `bash skrip/pasang-agen.sh`. Jika Ayyubi sudah memakai pm2 di laptop yang sama, Agen Lokal tinggal ikut sebagai proses kedua (`agen-lokal`).

## Pasang di Windows

### Spek yang dipakai

Laptop contoh: Windows 11, Core i7-12650H (10 inti), RAM 16 GB, grafis Intel UHD (tanpa GPU khusus). Artinya model berjalan di CPU: model 7B (±5 GB RAM) cukup nyaman, tetapi tidak secepat layanan online; perkiraan kasar 5–10 kata per detik, dan jawaban pertama setelah lama diam butuh 10–30 detik untuk memuat model. Kalau terasa lambat, pakai model 3B (`/model qwen2.5:3b`).

### Langkah (sekali saja)

Buka **PowerShell** (bukan sebagai administrator).

1. Pasang Node.js dan Ollama:

   ```
   winget install OpenJS.NodeJS.LTS
   winget install Ollama.Ollama
   ```

   Tutup lalu buka PowerShell lagi. Cek: `node -v` (harus 20 ke atas) dan `ollama -v`. Ollama berjalan otomatis di latar (ikon di baki sistem).

2. Unduh model (±4,7 GB, butuh internet sekali):

   ```
   ollama pull qwen2.5:7b
   ```

   Model ini dipilih karena mendukung pemanggilan alat dan paham bahasa Indonesia. Alternatif: `llama3.1:8b` (sedikit lebih berat), `qwen2.5:3b` (lebih cepat, lebih sering keliru).

3. Buat bot Telegram: di Telegram buka **@BotFather** → `/newbot` → ikuti petunjuk → salin **token**-nya.

4. Ekstrak zip ini ke folder tetap, mis. `C:\AgenLokal`. Salin `.env.example` menjadi `.env`, lalu isi (buka dengan Notepad):

   - `TELEGRAM_BOT_TOKEN=` token dari BotFather
   - `AGENT_ROOTS=` folder yang boleh diakses agent, mis. `C:\Users\NamaKamu\Documents;D:\Kerja` (pisahkan dengan titik koma). **Di luar folder ini agent tidak bisa menyentuh apa pun.** Jangan isi `C:\` seluruhnya.
   - `AGENT_WORKDIR=` folder kerja di dalam salah satunya, mis. `C:\Users\NamaKamu\Documents\Agen`. Buat foldernya dulu.

5. Jalankan: klik dua kali **`start.bat`** (atau di PowerShell: `cd C:\AgenLokal` lalu `node src\index.js`). Tidak perlu `npm install`; tidak ada pustaka tambahan.

6. Di Telegram, kirim pesan apa saja ke botmu. Bot membalas **id Telegram-mu**. Isi `TELEGRAM_OWNER_IDS=` di `.env` dengan id itu, tutup jendela agen, jalankan lagi. Mulai sekarang hanya kamu yang dilayani; chat lain diabaikan.

7. Coba: `/status` (cek Ollama & model), lalu tulis "cari file laporan".

## Memakainya

Tulis permintaan biasa dalam bahasa Indonesia, misalnya:

- "cari file notulen rapat bulan lalu"
- "ringkas file C:\Users\NamaKamu\Documents\SK.docx"
- "buat folder Arsip 2026 lalu pindahkan semua pdf di folder Unduhan ke sana" (tiap langkah minta persetujuan)
- "cari di web jadwal sidang isbat terbaru"
- "berapa sisa ruang disk C?" (agent mengajukan perintah PowerShell; kamu setujui atau tolak)
- "kirim file laporan-september.xlsx ke sini"

Perintah bot: `/status` kondisi · `/baru` lupakan percakapan · `/batal` hentikan tugas · `/model [nama]` lihat/ganti model · `/ulang` mulai ulang agen (butuh pm2/`start.sh`/`start.bat` yang menyalakannya lagi) · `/id` · `/help`. Kirim berkas ke chat → disimpan di `_masuk` dalam folder kerja, lalu bisa kamu suruh olah.

## Keamanan (baca ini)

- **Pagar folder**: semua alat memeriksa alamat. Alamat di luar `AGENT_ROOTS` (termasuk lewat `..` atau simlink/junction) ditolak.
- **Persetujuan wajib** untuk tulis/pindah/salin/hapus/perintah. Jika tak dijawab 5 menit, dianggap ❌. Baca ringkasannya sebelum menekan ✅, terutama perintah PowerShell.
- **Tidak ada hapus permanen**: "hapus" = pindah ke `_sampah` (bisa dikembalikan).
- **Perintah berbahaya ditolak permanen** walau kamu ingin. Windows: format disk, diskpart, registri, akun pengguna, unduh-lalu-jalankan, shutdown, jadwal tugas. Linux: `sudo`/`su`, ganti akun & kata sandi, hapus massal (`rm -rf /`, `~`, `/etc`, `/home`…), `mkfs`/`dd` ke disk, matikan/mulai ulang mesin, memutus SSH/Tailscale/firewall, mengubah `authorized_keys`/`sshd_config`, `crontab`, `curl … | sh`, bom fork. Daftar ini bukan jaminan mutlak; tetap baca perintah sebelum setuju.
- **Berkas rahasia tidak tersentuh**: `.env`, `auth_session`, kunci SSH (`.ssh`, `id_*`), `*.pem`/`*.key`, `.netrc`, `.git-credentials` ditolak oleh semua alat berkas, tidak muncul di pencarian, dan perintah shell yang menyebutnya ditolak.
- **Pagar folder hanya untuk alat berkas.** Perintah shell bisa menyentuh apa saja yang boleh dilakukan akun yang menjalankan agen; satu-satunya penjaganya adalah daftar tolak di atas dan tombol ✅ milikmu. Karena itu jalankan agen dengan akun biasa (bukan root), dan jangan menyetujui perintah yang tidak kamu pahami.
- **Mode hanya-baca**: `AGENT_MODE=baca` di `.env` menyembunyikan semua alat pengubah.
- **Isi berkas/web dianggap data, bukan perintah.** Model kecil bisa terpancing teks berbahaya di dokumen/halaman web; karena itu pagar folder dan persetujuan ada di kode, bukan hanya di instruksi model.
- **Web**: alamat lokal/jaringan kantor/router diblokir (anti-SSRF), termasuk lewat pengalihan.
- Hanya id Telegram yang terdaftar yang dilayani. Jaga token bot: siapa pun yang memegangnya bisa mengirim pesan atas nama bot (tetapi tetap tak bisa memerintah agen karena id-nya tak terdaftar).
- Agen berjalan dengan hak akses akun yang menjalankannya. Untuk lebih aman, pakai akun terpisah tanpa hak admin (Windows) atau akun biasa tanpa sudo (Linux).

## Jalan otomatis

**Linux:** pm2 (lihat `PANDUAN-LINUX.md`). **Windows:** tekan `Win+R` → `shell:startup` → salin pintasan (Alt+seret) ke **`jalankan-tersembunyi.vbs`** ke folder itu. Agen akan jalan di latar tanpa jendela setiap kali kamu masuk ke Windows. Berhenti: Task Manager → akhiri proses `node.exe`. Lihat kondisi lewat `/status` di Telegram.

## Batas jujur

- Model 7B lokal **jauh di bawah** layanan AI besar: bisa keliru memilih alat, salah baca tabel panjang, atau mengarang bila tidak memakai alat. Cek hasil penting. Tugas berantai panjang paling rawan; pecah jadi langkah kecil.
- PDF hasil scan (gambar) tidak terbaca (tanpa OCR). PDF teks sederhana terbaca; PDF rumit lebih baik dengan `pdftotext` (Poppler) terpasang di PATH.
- Pembatalan (`/batal`) berlaku setelah langkah model yang sedang berjalan selesai.
- Pencarian web memakai DuckDuckGo HTML tanpa kunci; sesekali dibatasi/tidak ada hasil.
- Konteks 8192 token: percakapan sangat panjang dipangkas (riwayat disimpan ringkas: hanya pertanyaan & jawaban akhir).

## Pengaturan lain (.env)

Lihat `.env.example`: `OLLAMA_MODEL`, `OLLAMA_NUM_CTX`, `OLLAMA_KEEP_ALIVE`, `AGENT_MAX_STEPS`, `AGENT_APPROVAL_TIMEOUT_SEC`, `AGENT_COMMAND_TIMEOUT_SEC`, `OLLAMA_TIMEOUT_SEC`.

## Pengujian

`node test/agent.test.mjs` (memakai Ollama dan Telegram palsu; tidak butuh jaringan).

## Susunan kode

`src/config.js` pengaturan · `src/safety.js` pagar folder/perintah/berkas rahasia/SSRF · `src/tools.js` alat · `src/docs.js` pembaca docx/xlsx/pdf · `src/web.js` pencarian web · `src/ollama.js` klien model · `src/agent.js` putaran agent · `src/telegram.js` bot & tombol persetujuan · `src/index.js` titik masuk · `skrip/` pasang-agen.sh (pm2), pasang-ssh.sh (SSH aman), server-tanpa-tidur.sh · `PANDUAN-LINUX.md`.
