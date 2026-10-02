# wa-bot -- Bot WhatsApp buat Ringkasan Harian

Skrip Node.js kecil yang menyambungkan satu nomor WhatsApp pribadi ke
aplikasi Ringkasan Harian, lewat Supabase (tabel `whatsapp_messages`) --
jadi kamu bisa baca & balas chat WhatsApp langsung dari aplikasi.

**Ini BUKAN WhatsApp Business API resmi.** Pakai library [Baileys](https://github.com/WhiskeySockets/Baileys)
yang bicara langsung ke protokol WhatsApp Web (sama kayak buka web.whatsapp.com),
login lewat scan QR code kayak biasa. Konsekuensinya:

- Gratis, setup lebih simpel dibanding WhatsApp Business Platform resmi.
- Secara teknis melanggar Ketentuan Layanan WhatsApp -- ada risiko (walau
  kecil utk pemakaian wajar/personal) nomornya kena limit/banned dari Meta.
- **Harus jalan TERUS-MENERUS** (24 jam) di komputer ini supaya sesinya
  tetap tersambung -- kalau laptop dimatikan/tidur atau internet putus,
  bot berhenti jalan sampai dinyalakan lagi (pesan yang masuk SELAMA bot
  mati tidak akan tersimpan -- itu tersimpan di HP kamu seperti biasa, tapi
  tidak ikut muncul di aplikasi sampai bot nyala & nyambung lagi).
- Sebaiknya pakai nomor yang memang KHUSUS buat ini, bukan nomor yang masih
  dipakai manual bersamaan di HP (lihat komentar di `index.js`).

## 1. Install

Butuh Node.js versi 20 ke atas (`node --version` buat cek).

```bash
cd wa-bot
npm install
cp .env.example .env
```

Buka `.env`, isi:
- `SUPABASE_URL` -- dari Supabase Dashboard > Settings > API > Project URL
- `SUPABASE_SERVICE_ROLE_KEY` -- dari halaman yang sama, bagian `service_role` key
  (ini SECRET, jangan pernah dipakai di frontend/browser atau di-commit ke git --
  `.gitignore` di folder ini sudah mengecualikan `.env`, tapi tetap hati-hati)

## 2. Jalankan SQL migration dulu (kalau belum)

Pastikan `supabase/migrations/0011_whatsapp_messages.sql` sudah dijalankan di
Supabase Dashboard > SQL Editor, dan Edge Function `whatsapp` sudah di-deploy:

```bash
npx supabase functions deploy whatsapp
```

## 3. Jalankan bot & scan QR

```bash
npm start
```

QR code bakal muncul di terminal. Buka WhatsApp di HP yang mau disambungkan
> titik tiga/Setelan > **Perangkat Tertaut** > **Tautkan Perangkat** > scan
QR di terminal.

Setelah berhasil, bot akan nampilin `✅ WhatsApp tersambung`. Sesi login ini
disimpan di folder `auth_session/` -- lain kali jalanin `npm start` lagi
TIDAK perlu scan ulang, kecuali folder itu dihapus atau sesinya di-logout
dari HP.

## 4. Biar tetap nyala (auto-restart)

Supaya bot otomatis nyala lagi kalau laptop di-restart atau prosesnya
ke-crash, pakai [pm2](https://pm2.keymetrics.io/) (process manager buat
Node.js):

```bash
npm install -g pm2
cd wa-bot
pm2 start index.js --name wa-bot
pm2 save
pm2 startup   # ikuti instruksi yang muncul, ini bikin pm2 otomatis nyala
              # tiap laptop dinyalakan/restart
```

Cek status & log kapan saja:

```bash
pm2 status
pm2 logs wa-bot
```

Tanpa pm2 (atau process manager sejenis), bot cuma jalan selama terminal/
jendela tempat `npm start` dijalankan masih terbuka -- begitu terminalnya
ditutup atau laptop sleep, bot ikut berhenti.

## Troubleshooting

- **QR tidak muncul / bot langsung error network** -- cek koneksi internet;
  Baileys butuh akses ke server WhatsApp (bukan cuma Supabase).
- **"Sesi logout/dicabut dari HP"** -- biasanya karena sesi di-logout manual
  dari HP (WhatsApp > Perangkat Tertaut), atau tidak dipakai terlalu lama.
  Hapus folder `auth_session/` lalu `npm start` lagi buat scan QR baru.
- **Pesan nyangkut status "pending" lama di aplikasi** -- cek bot masih
  jalan (`pm2 status` atau terminalnya masih terbuka) dan tersambung
  (`✅ WhatsApp tersambung` muncul di log terakhir).