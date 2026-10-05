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

## 5. Auto-reply pakai AI (opsional, default MATI)

Bot ini bisa membalas OTOMATIS setiap pesan WA personal yang masuk, bisa
diajak diskusi bebas & bantu coding/debugging -- tanpa kamu baca/setujui
dulu. **Baca semua poin di bawah ini sebelum menyalakan**, karena beda dari
Obrolan AI biasa (yang cuma kamu sendiri yang baca balasannya), ini otomatis
terkirim ke kontak SUNGGUHAN:

- AI dikasih instruksi buat tidak membuat janji/komitmen/keputusan/harga
  atas nama kamu, tidak membagikan info pribadi/sensitif, dan mengaku
  "akan ditindaklanjuti langsung" kalau pesannya butuh keputusan manusia
  (negosiasi, hal mendesak, masalah pribadi/emosional) -- rem aman ini
  tetap aktif apa pun mesin AI yang dipakai (lihat `WA_BASE_SYSTEM_PROMPT`
  / `WA_OLLAMA_SYSTEM_PROMPT` di `index.js` kalau mau mengubah gaya
  balasannya) -- tapi ini tetap AI, bisa saja salah paham konteks atau
  salah jawab.
- Bisa dimatikan PER-KONTAK lewat tombol lonceng di layar obrolan WA
  kontak itu di aplikasi (tetap perlu `WA_AUTO_REPLY_ENABLED=true` secara
  global dulu -- toggle per-kontak cuma mengecualikan kontak tertentu dari
  auto-reply global itu).
- Bisa menulis kode (dikirim dalam blok monospace WhatsApp) kalau diminta
  bantuan coding/debugging lewat chat.

Ada 2 pilihan **mesin AI** (`WA_AI_ENGINE` di `.env`) -- beda jauh soal
biaya, privasi, dan kemampuannya:

### Opsi A -- `ollama` (DEFAULT, model AI lokal di laptop sendiri)

Gratis & privasi penuh: tidak ada satu pun isi chat yang dikirim ke
Google/pihak ketiga (KECUALI untuk pencarian web, lihat poin di bawah).
Cocok buat laptop yang sudah nyala 24/7 (lihat bagian 3-4 di atas).

- **Butuh [Ollama](https://ollama.com) terpasang & model-nya sudah
  di-pull duluan** di laptop yang sama dgn bot ini:
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ollama pull qwen2.5:3b
  ollama serve   # kalau belum otomatis jalan sbg service
  ```
  Model lain (mis. `llama3.2:3b`) juga bisa, tinggal ganti `OLLAMA_MODEL`
  di `.env` -- sesuaikan dgn RAM/CPU laptop (model 3B itu titik aman buat
  spek pas-pasan, lihat diskusi riwayat percakapan soal ini).
- Jalankan `npm install` sekali lagi di folder `wa-bot/` (nambah dependency
  baru `cheerio` buat parsing hasil pencarian web).
- **Ikut membaca Dokumen Pengetahuan** yang sudah kamu upload di aplikasi
  (RAG sederhana berbasis kecocokan kata kunci, BUKAN seluruh isi dokumen
  sekaligus -- cuma potongan paling relevan, biar muat di jendela konteks
  model lokal) -- ini PENTING karena model 3B TERBUKTI asal mengarang kalau
  ditanya istilah/aturan resmi yang spesifik tanpa dikasih konteks dulu.
- **Dilengkapi pencarian web manual** (scraping Bing, gratis, tanpa API key
  -- awalnya dicoba DuckDuckGo, tapi ketahuan diblokir di level ISP
  sebagian provider internet Indonesia, jadi dipindah ke Bing) buat
  pertanyaan yang tidak nyambung ke Dokumen Pengetahuan -- model lokal
  sendiri tidak punya akses internet bawaan, jadi query pertanyaan kontak
  akan dikirim ke Bing tiap kali ini terjadi (lihat `RAG_STRONG_MATCH_SCORE`
  di `index.js` kalau mau mengetatkan/melonggarkan kapan ini dipicu).
- Balasannya GRATIS (tidak tercatat di "token terpakai" footer aplikasi,
  itu khusus biaya Gemini) -- TAPI inferensinya CPU-only di laptop tua bisa
  LAMBAT. Dari tes nyata (`ollama run qwen2.5:3b --verbose`) di laptop
  spek i5-4200M + RAM 7.5GB: kecepatan generate cuma ~4.5 token/detik --
  artinya balasan **bisa makan waktu 1-4 menit**, bukan hitungan detik
  kayak Gemini. Ada indikator "mengetik..." di WA selama proses (walau
  WhatsApp sendiri biasanya nyembunyiin indikator itu stlh ~25 detik kalau
  tidak di-refresh, jadi jangan kaget kalau "ketikannya" kelihatan berhenti
  padahal masih diproses di belakang layar). Sudah ditala (lihat
  `OLLAMA_MAX_OUTPUT_TOKENS`, `OLLAMA_HISTORY_LIMIT`,
  `RAG_CONTEXT_BUDGET_CHARS`, `WEB_SEARCH_MAX_RESULTS` di `index.js`) buat
  memperkecil prompt & panjang jawaban supaya lebih jarang kelamaan, tapi
  kalau hardware-nya memang segini, WA auto-reply yang "instan" bukan hal
  yang realistis dgn opsi A ini -- kalau kecepatan itu penting, opsi B
  (`gemini`) jauh lebih cepat (hitungan detik), cuma lebih mahal/kurang
  privat & kena kuota harian.

**Cara nyalakan:** di `wa-bot/.env`, set:

```
WA_AUTO_REPLY_ENABLED=true
WA_AI_ENGINE=ollama
OLLAMA_MODEL=qwen2.5:3b
```

### Opsi B -- `gemini` (cara lama, lewat API Google)

Kualitas jawaban lebih konsisten & punya akses pencarian Google asli
real-time, tapi TIDAK membaca Dokumen Pengetahuan (sengaja, karena Gemini
sudah py akses internet sendiri) dan kena kuota free-tier (20
request/hari) + biaya kalau sudah lewat situ, serta seluruh pertanyaan
dikirim ke server Google.

**Cara nyalakan:** di `wa-bot/.env`, set:

```
WA_AUTO_REPLY_ENABLED=true
WA_AI_ENGINE=gemini
GEMINI_API_KEY=isi-dengan-API-key-Google-AI-Studio-yang-sama-dgn-di-Supabase
```

API key-nya dari https://aistudio.google.com/apikey -- kalau sudah pernah
pasang `GEMINI_API_KEY` sebagai secret di Supabase buat fitur "Obrolan AI",
pakai nilai yang SAMA di sini. Tiap pesan masuk = 1 panggilan Gemini, ikut
tercatat bareng total biaya "Obrolan AI" di footer aplikasi.

#### Rotasi beberapa API key (opsional, buat akalin kuota 20/hari)

Kalau kuota gratis 20 request/hari kerasa kurang & belum mau bayar, bot ini
bisa gonta-ganti BEBERAPA API key Gemini secara otomatis -- begitu satu key
kena limit harian, langsung pindah pakai key berikutnya, muter terus
(looping) sampai semuanya habis baru benar-benar berhenti. Syaratnya tiap
key dari **akun Google yang beda-beda** (bikin API key baru di
https://aistudio.google.com/apikey pakai akun Google ke-2, ke-3, dst --
tiap akun Google dapat jatah 20/hari SENDIRI-SENDIRI, jadi key dari akun
yang sama tidak nambah jatah apa-apa).

**Catatan jujur:** ini sedikit di luar "semangat" kuota gratis per-akun yang
dikasih Google (jatahnya memang dimaksudkan per akun/project, bukan buat
digabung-gabung) -- tapi bukan pelanggaran Ketentuan Layanan yang eksplisit
sejauh yang diketahui, cuma bukan cara "seharusnya". Kalau butuh kuota
lebih besar & stabil, opsi paling aman & didukung resmi tetap upgrade ke
tier berbayar. Pakai fitur ini atas tanggung jawab sendiri.

**Cara nyalakan:** ganti `GEMINI_API_KEY` (tunggal) jadi `GEMINI_API_KEYS`
(jamak, dipisah koma, TANPA spasi) di `.env`:

```
WA_AUTO_REPLY_ENABLED=true
WA_AI_ENGINE=gemini
GEMINI_API_KEYS=key-akun-1,key-akun-2,key-akun-3
```

Begitu bot start, log-nya bakal nampilin jumlah key yang kebaca, mis.
`🤖 Auto-reply AI: AKTIF (mesin: gemini, 3 API key)`. Pas salah satu key
kena limit harian (error 429 `RESOURCE_EXHAUSTED`), muncul log peringatan:

```
⚠️  API key Gemini #1/3 kena kuota harian, pindah ke key lain sampai tengah malam (Pacific Time).
```

...dan auto-reply otomatis lanjut pakai key berikutnya tanpa perlu restart
manual. Key yang sudah ditandai habis otomatis dicoba lagi besoknya
(perkiraan reset tengah malam Pacific Time, sesuai kebiasaan kuota gratis
Gemini) -- kalau SEMUA key lagi habis barengan, auto-reply gagal total utk
pesan itu (fallback text biasa yang terkirim, lihat bagian error-handling
`sendAutoReply`) sampai salah satu key reset lagi.

### Setelah diisi (berlaku utk opsi A maupun B)

```bash
pm2 restart wa-bot
pm2 logs wa-bot
```

Begitu nyala, cek log-nya: harus muncul `🤖 Auto-reply AI: AKTIF (mesin:
ollama)` (atau `gemini`) waktu bot start. Setiap kali auto-reply terkirim,
ada baris `🤖 Auto-reply ke ...` di log. **Buat matikan lagi**, set
`WA_AUTO_REPLY_ENABLED=false` (atau hapus baris itu) lalu
`pm2 restart wa-bot` -- bot tetap jalan normal (terima & sinkron pesan
seperti biasa), cuma berhenti membalas otomatis.

## 6. Fitur tambahan bot (butuh migration 0013)

Jalankan dulu `supabase/migrations/0013_gemini_keys_quick_replies_retry.sql`
di Supabase Dashboard > SQL Editor (atau `npx supabase db push`), lalu
deploy ulang Edge Function `chat` dan `whatsapp`. Fitur di bawah ini aman
dinyalakan satu per satu -- kalau migration belum dijalankan, bot tetap
jalan normal (cuma fitur terkait yang diam-diam tidak aktif, dan ada satu
baris peringatan di log).

**Template jawaban (tanpa AI).** Di aplikasi: Pengaturan > Template Jawaban
WA. Isi nama, kata kunci (pisahkan koma), dan jawabannya. Pesan WA masuk yang
mengandung salah satu kata kunci (sebagai kata/frasa utuh, huruf besar-kecil
dan tanda baca diabaikan) dijawab langsung dari template, AI tidak dipanggil.
Kalau beberapa template cocok, yang kata kuncinya paling panjang menang.
Template hanya dicoba untuk pesan pendek (maksimal 12 kata, lihat
`QUICK_REPLY_MAX_WORDS`), supaya pertanyaan panjang yang rumit tetap sampai
ke AI. Perubahan template berlaku dalam sekitar 1 menit (bot menyimpan cache).

**Antrean balasan ulang.** Kalau AI gagal membalas (mis. semua API key habis
kuota), kontak dapat satu pesan "akan dibalas otomatis begitu sistem siap",
lalu bot mencoba lagi sendiri tiap menit (jeda makin panjang tiap gagal,
maksimal 6 percobaan, kedaluwarsa setelah 24 jam). Balasan susulan dilewati
kalau kamu sudah membalas manual atau auto-reply untuk kontak itu kamu
matikan.

**Peringatan semua key habis.** Isi `WA_OWNER_NUMBER` di `.env`. Begitu semua
API key kena kuota harian, bot kirim satu WA ke nomor itu (maksimal sekali
sehari) berisi perkiraan jam kuota kembali.

**Ringkasan percakapan harian.** Dengan `WA_OWNER_NUMBER` terisi, tiap hari
setelah jam `WA_DAILY_SUMMARY_HOUR` (default 20:00 WITA; set `WA_TIMEZONE=Asia/Jakarta` dan `WA_TIMEZONE_LABEL=WIB` untuk WIB) bot merangkum semua
percakapan WA hari itu dengan Gemini dan mengirimnya ke nomor pemilik:
gambaran umum, ringkasan per kontak, dan daftar yang perlu ditindaklanjuti
manual. Secara default ringkasan dibuat **Ollama (model lokal di laptop)**:
isi percakapan tidak keluar dari laptop dan tidak memakai kuota Gemini
(`WA_SUMMARY_ENGINE=ollama`; ubah ke `gemini` kalau mau pakai Gemini). Kalau
Ollama gagal (mis. `ollama serve` mati), bot jatuh ke Gemini kecuali
`WA_SUMMARY_GEMINI_FALLBACK=false` (mode ketat: isi percakapan tidak pernah
dikirim ke Google). Ringkasan lokal bisa makan beberapa menit dan ditandai
"dirangkum model lokal" di ujungnya. Kalau AI sedang tidak tersedia setelah 3
kali percobaan, yang terkirim daftar sederhana tanpa AI. Kalau bot mati pada jam
itu, ringkasan terkirim begitu bot nyala lagi di hari yang sama.

**Tes ringkasan sekarang (tanpa menunggu jam jadwal).** Dua cara, keduanya
mengirim ringkasan hari ini ke `WA_OWNER_NUMBER` tanpa menandai "sudah terkirim",
jadi ringkasan terjadwal malamnya tetap jalan:

1. Di laptop server: `touch ~/ringkasan_harian/wa-bot/kirim-ringkasan.flag`
   (bot memeriksa tiap 5 detik, memakai lalu menghapus file itu).
2. Dari WhatsApp: kirim `/ringkasan` lewat chat ke diri sendiri atau dari nomor
   pemilik ke nomor bot.

Bot lebih dulu mengirim "Membuat ringkasan...", lalu hasilnya. Pantau dengan
`pm2 logs wa-bot` (cari baris `[Tes ringkasan]`).

**Cadangan lokal saat kuota Gemini habis.** Dengan `WA_AI_ENGINE=gemini`, kalau
Gemini gagal karena kuota (semua key habis / 429 / 503), pertanyaan yang BUKAN soal
angka/aturan dijawab Ollama dulu (konteks Dokumen Pengetahuan + Bing), bukan cuma
"sistem penuh". Pertanyaan yang mengandung angka, tarif, aturan, atau uang tetap
diantre untuk dijawab Gemini nanti, karena model 3B mudah mengarang angka. Cadangan
dilewati kalau Ollama lagi sibuk atau kontak itu sudah punya antrean aktif.
Atur lewat `WA_OLLAMA_FALLBACK_ENABLED` (default true) dan
`WA_OLLAMA_FALLBACK_TIMEOUT_MS` (default 90000).

**Status API Gemini.** Di aplikasi: Pengaturan > Status API Gemini. Tiap key
tampil dengan 4 karakter terakhirnya, jumlah request hari ini, dan status
aktif/habis beserta perkiraan jam aktif lagi. Angka request hanya mencakup
panggilan yang tercatat sistem ini (bot WA dan chat aplikasi). Batas harian
yang jadi pembanding bar default 20, ubah lewat secret Supabase
`GEMINI_DAILY_LIMIT` kalau kuota akunmu berbeda. Bot juga mengingat key yang
sudah habis hari itu, jadi setelah restart tidak membuang request ke key yang
pasti ditolak.

## Troubleshooting

- **QR tidak muncul / bot langsung error network** -- cek koneksi internet;
  Baileys butuh akses ke server WhatsApp (bukan cuma Supabase).
- **"Sesi logout/dicabut dari HP"** -- biasanya karena sesi di-logout manual
  dari HP (WhatsApp > Perangkat Tertaut), atau tidak dipakai terlalu lama.
  Hapus folder `auth_session/` lalu `npm start` lagi buat scan QR baru.
- **Pesan nyangkut status "pending" lama di aplikasi** -- cek bot masih
  jalan (`pm2 status` atau terminalnya masih terbuka) dan tersambung
  (`✅ WhatsApp tersambung` muncul di log terakhir).
