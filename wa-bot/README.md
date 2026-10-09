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

**Grup WhatsApp (dipanggil lewat mention).** Default mati. Isi di `.env`:
`WA_GROUP_ALLOWED_NAMES=Salim Family` (cukup potongan nama grup; boleh beberapa,
pisah koma) lalu `pm2 restart wa-bot`. Bot menjawab di grup itu hanya kalau
(a) nomor bot di-mention (@), (b) pesan bot dibalas (reply), atau (c) pesan diawali
kata pemicu di `WA_GROUP_KEYWORDS` (opsional, mis. `bot,ai`). Jawaban mengutip
pesan penanya, dan kalau pemanggil me-reply sebuah pesan, isi pesan yang dikutip
ikut dibaca bot. Pesan grup yang tidak memanggil bot TIDAK disimpan. Grup lain
tidak pernah dijawab; kalau bot dipanggil di grup yang belum diizinkan, log
menampilkan nama dan id grupnya (`WA_GROUP_ALLOWED_JIDS` untuk mengizinkan lewat id).
Obrolan santai dijawab langsung. Dokumen/web dicari hanya bila pesannya memuat kata seperti harga, berita, cuaca, jadwal, tarif, aturan (`WA_GROUP_DOCS=always` membuat dokumen selalu dicari untuk setiap pertanyaan yang memanggil bot). Agar grup tertentu **berpegang pada satu surat/dokumen saja**, isi `WA_GROUP_DOC_TITLES=Surat Edaran` (potongan judul dokumen seperti di daftar Dokumen Pengetahuan; pisah koma): di grup bot lalu hanya mencari di dokumen itu, mematikan Google/Bing, dan menjawab "tidak ditemukan di dokumen acuan" bila isinya tidak ada. Pengaturan ini berlaku untuk SEMUA grup yang diizinkan. Kalau Gemini membalas 503 (sibuk), bot mencoba sekali lagi setelah 12 detik. Template jawaban tidak dipakai di grup, tidak ada antrean ulang (kalau AI gagal,
bot minta di-tag lagi), dan ada jeda `WA_GROUP_COOLDOWN_SEC` (20 detik) per orang.
Pesan yang kamu ketik sendiri dari nomor ini tidak memicu bot. Percakapan grup ikut
masuk ringkasan harian dengan nama grupnya.

**SiMAB lewat WhatsApp (baca + rekam kegiatan).** Kirim pesan berawalan `simab` dari nomor
pemilik (`WA_OWNER_NUMBER`) ke nomor bot, atau lewat chat ke diri sendiri:

- `simab pagu 4701.EBA.994.002.A.521111.10` -- pagu, blokir, realisasi, sisa satu kode
  (kode tidak lengkap = semua turunannya; angka 6 digit = satu akun; kata = cari di uraian)
- `simab sisa 521111`, `simab pagu perkantoran 40 bali` -- kata dicari di uraian POK (semua kata harus ada, urutan bebas); tambah `semua` di akhir untuk daftar sampai 25 baris. Kalau yang cocok hanya baris judul/induk, turunannya ikut ditampilkan.
- `simab cek 123/ST/2026` -- cari kegiatan dari uraian, nomor ST, pelaksana, MAK, nomor SPM
- `simab perjadin budi` -- perjalanan dinas seorang pelaksana (hanya transaksi dengan MAK akun 524111 atau 524113; ubah lewat `SIMAB_PERJADIN_AKUN`)
- `simab sbm yogyakarta`, `simab rpd`, `simab rpd oktober`
- akhiri dengan tahun untuk tahun lain: `simab pagu 521111 2025`
- `simab rekam <seksi>` -- **rekam kegiatan baru** (lihat bagian "Merekam kegiatan" di bawah)
- kalimat bebas juga boleh (ditafsirkan Ollama menjadi salah satu perintah di atas, ±1 menit)

Rumus: Sisa = Pagu - Blokir - Realisasi; Realisasi = jumlah `kegiatan.jumlah` per MAK
(semua status); RPD memakai bulan `tgl_sp2d`. Jawaban disusun kode dengan format tetap,
model bahasa tidak pernah menulis angka. Perintah dan jawabannya tidak disimpan ke
`whatsapp_messages` (tidak muncul di aplikasi/ringkasan harian).

Persiapan sekali saja: (1) buat akun bot di Dashboard Supabase SiMAB (Authentication >
Users), (2) jalankan `simab-bot-readonly.sql` di SQL Editor SiMAB agar akun itu tidak bisa
menulis dan tidak bisa membaca tabel pegawai, (3) isi `SIMAB_*` di `.env`, (4)
`pm2 restart wa-bot`. Bot selalu menyaring `kantor_id` = `SIMAB_KANTOR_ID`.

### Merekam, mengubah, dan menghapus kegiatan lewat WhatsApp

Hanya dari nomor pemilik. Seksi: Umum, PKN, PN, HI, KI, Lelang, Penilaian.

1. `simab rekam Umum` -> daftar **kelompok POK** milik seksi itu (3 segmen kode, mis. `4701.EBA.002 Kerumahtanggaan`). Balas angkanya.
2. Daftar **kode MAK paling panjang** (yang tidak punya turunan) di kelompok itu, dengan pagu dan sisa. Balas angkanya. Pindah halaman dengan `lanjut` / `balik`, kembali ke kelompok dengan `kembali`.
   **Pencarian cepat:** ketik `cari <kata>` (semua kata harus ada; mencari di kode dan uraian). Dari daftar kelompok, `cari listrik` langsung mencari di seluruh kode MAK seksi itu; di dalam daftar kode, `cari` menyaring daftar dan angka mengikuti hasil saringan. `semua` (atau `cari` saja) menghapus saringan.
3. Kirim **tiga baris dalam satu pesan**: uraian, tanggal dokumen, jumlah. Tanggal: `5/10/2026`, `5 okt 2026`, `hari ini`. Jumlah: `1.500.000`, `1,5jt`, `500rb`.
4. Bot menampilkan ringkasan. Kalau jumlah melebihi sisa pagu, ada peringatan. Balas `ya` untuk menyimpan, `ubah` untuk isi ulang, atau `batal`.

**Mengubah / menghapus.** `simab ubah` atau `simab hapus` menampilkan hingga 10 kegiatan terbaru yang **direkam lewat bot** dan masih berstatus Rekam Data (boleh langsung `simab ubah <id>` / `simab hapus <id>`). Pilih angkanya, lalu:

- ubah sebagian: ketik `uraian ...`, `tanggal ...`, atau `jumlah ...` (boleh beberapa baris), atau kirim 3 baris (uraian, tanggal, jumlah) untuk mengganti semuanya. Bot menampilkan sebelum → sesudah (dan peringatan bila jumlah baru melewati sisa pagu); balas `ya` untuk menyimpan.
- hapus: ketik `hapus` di tahap ubah, atau pilih dari `simab hapus`; konfirmasi harus persis `ya hapus`.

Kegiatan buatan aplikasi web, atau yang statusnya sudah bukan Rekam Data, **tidak bisa** diubah/dihapus dari WhatsApp. Salinan data sebelum diubah/dihapus tersimpan di tabel `bot_rekam_log` (kolom `snapshot`) untuk pemulihan manual. Kegiatan yang direkam bot SEBELUM versi SQL ini dipasang perlu didaftarkan dulu (lihat blok "Opsional" di akhir `simab-bot-rekam.sql`).

**Pintasan semua MAK.** Selain nama seksi, `simab rekam <kata>` mencari kode MAK terpanjang dari kata di **kode atau uraian** di semua seksi (semua kata harus ada), mis. `simab rekam listrik`. Satu hasil langsung menampilkan Pagu/Blokir/Realisasi/Sisa; banyak hasil tampil sebagai daftar bernomor (pagu = gabungan semua seksi). Lalu kirim **jumlah saja** (uraian bawaan = uraian MAK itu, tanggal hari ini) atau 3 baris biasa. Langsung ke konfirmasi: `simab rekam listrik; 1.500.000` atau `simab rekam listrik; 1,5jt; Listrik September; 3/10/2026` (urutan: kata; jumlah; uraian; tanggal; uraian & tanggal opsional). Gunakan `;` untuk memisahkan. Nama seksi tetap mengikuti alur seksi. `simab meterai` adalah pintasan khusus dengan kata kunci dan uraian bawaan sendiri.

**Meterai.** `simab rekam meterai` langsung menampilkan data MAK meterai (pagu, blokir, realisasi, sisa), lalu kirim **jumlah saja** (uraian "Pembelian meterai", tanggal hari ini) atau 3 baris seperti biasa. Pintasan: `simab meterai 120.000` langsung ke konfirmasi; lengkapnya `simab meterai 120rb; uraian; 5/10/2026` (uraian dan tanggal opsional). Kode MAK meterai dideteksi otomatis dari kode terpanjang yang uraiannya memuat "meterai"/"materai"; kalau ada lebih dari satu, bot menampilkan daftar untuk dipilih. Bila deteksi salah, tetapkan `SIMAB_METERAI_MAK=<kode>` (boleh beberapa, pisah koma). Variabel lain: `SIMAB_METERAI_KATA`, `SIMAB_METERAI_URAIAN`. Tidak perlu SQL baru. Catatan: `simab meterai 2000` di akhir perintah bisa terbaca sebagai override tahun anggaran; tulis `2.000` atau `2rb` untuk jumlah.

Status otomatis **Rekam Data**; kolom `tgl_st` diisi tanggal dokumen, `tgl_rekam` hari ini, `user` dari `SIMAB_REKAM_USER`; id 10 huruf/angka acak dibuat di database. Sesi kedaluwarsa 10 menit tanpa balasan (`SIMAB_REKAM_TTL_MIN`).

**Keamanan.** Akun bot tetap baca-saja di semua tabel. Penulisan hanya lewat fungsi database `bot_rekam_kegiatan`, `bot_ubah_kegiatan`, `bot_hapus_kegiatan` (+ `bot_daftar_rekam` untuk membaca daftar) di `simab-bot-rekam.sql` (jalankan di SQL Editor **SiMAB** setelah `simab-bot-readonly.sql`; aman diulang, jalankan ulang untuk memperbarui). Fungsi-fungsi itu hanya bisa dipanggil akun bot; rekam hanya menambah satu baris berstatus Rekam Data, memeriksa ulang bahwa kode ada di POK satker+tahun itu dan merupakan kode terpanjang, dan menolak baris identik yang direkam kurang dari 10 menit lalu; ubah/hapus hanya menyentuh baris yang tercatat di `bot_rekam_log` dan masih berstatus Rekam Data. Kalimat bebas (model lokal) tidak pernah bisa memulai perekaman; hanya perintah `simab rekam ...` yang tertulis. Matikan fitur dengan `SIMAB_REKAM_ENABLED=false`.

Tes: `node test-simab-rekam.mjs`.


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

**Jeda otomatis saat kamu membalas manual.** Kalau kamu membalas sebuah chat
sendiri (dari HP, atau dari layar obrolan WA di aplikasi), bot berhenti membalas
otomatis di chat itu selama 60 menit, dihitung dari balasan manual TERAKHIR
(balas lagi = hitungan mulai ulang). Chat dengan nomor lain tidak terpengaruh,
dan pesan yang masuk selama jeda tetap tersimpan. Untuk mengaktifkan bot lagi
sebelum 60 menit: ketik `AI On` di chat itu. Kalau diketik dari layar WA di
aplikasi, `AI On` diperlakukan sebagai PERINTAH: tidak dikirim ke lawan bicara
dan tidak memicu jeda baru. Kalau diketik dari HP, pesan "AI On" terlihat oleh
lawan bicara (isi `WA_AI_ON_DELETE_COMMAND=true` kalau mau bot langsung
menghapusnya untuk semua orang). Konfirmasi "AI aktif lagi untuk ..." dikirim
ke nomor pemilik. Di chat-ke-diri-sendiri: `AI On` mengaktifkan semua chat
sekaligus, `AI Status` menampilkan chat yang sedang dijeda. Balasan manual
yang dihitung: teks, foto, dokumen, stiker, suara; reaksi emoji tidak. Status
jeda disimpan di `ai-pause.json` (selamat dari restart). Atur lewat
`WA_MANUAL_PAUSE_MINUTES` (default 60, `0` = fitur dimatikan).

## 7. Agen Ollama untuk chat di aplikasi (butuh migration 0015)

Di halaman chat aplikasi ada pemilih **Auto / Gemini / Ollama** di atas kolom ketik
(disimpan per obrolan, sinkron lintas perangkat):

- **Auto** (default): Gemini dulu. Kalau Gemini gagal (kuota habis/overloaded) dan Ollama di laptop
  hidup, pesan otomatis dialihkan ke Ollama.
- **Gemini**: seperti sebelumnya (API key di Supabase, rotasi key).
- **Ollama**: model lokal di laptop ini. Data tidak keluar ke Google. Cocok untuk analisis dokumen.

Cara kerjanya: Edge Function di cloud tidak bisa menjangkau Ollama di laptop, jadi aplikasi menaruh
permintaan di tabel `agent_jobs`; bot ini (proses pm2 yang sama dengan bot WhatsApp) mengambilnya tiap
~4 detik, menjalankan Ollama, lalu menulis balasan ke obrolan. **Tidak ada pesan WhatsApp yang dikirim
dan tidak ada port yang dibuka ke internet.** Tiap ~15 detik bot menulis "denyut" ke
`agent_worker_status`; kalau mati/Ollama tidak menjawab, aplikasi menolak pilihan Ollama dengan pesan
jelas (titik di tombol Ollama: penuh = aktif, kosong = tidak aktif).

Setup (sekali):

1. Jalankan `supabase/migrations/0015_agent_jobs.sql` (SQL Editor atau `npx supabase db push`).
2. Deploy ulang Edge Function: `npx supabase functions deploy chat`.
3. Ganti `wa-bot/index.js`, tambahkan `wa-bot/app-agent.js`, lalu `pm2 restart wa-bot`.
   Di log harus muncul `🦙 Agen Ollama untuk chat aplikasi aktif (...)`.
4. Pastikan model ada: `ollama pull qwen2.5:3b` (atau model di `OLLAMA_MODEL`).

Analisis dokumen: aktifkan "Pakai Dokumen Pengetahuan" di menu titik-3 obrolan itu.
Pertanyaan spesifik ("berapa tarif ...") memakai potongan dokumen paling relevan (cepat).
Permintaan menyeluruh ("ringkas dokumen ini", "analisis ...") memakai mode baca-per-bagian: dokumen
dipecah, tiap bagian dicatat poin pentingnya, lalu digabung jadi jawaban. Paling banyak
`OLLAMA_DOC_MAX_CHUNKS` (6) bagian dibaca (dipilih merata) dan jawabannya diberi catatan kalau hanya
sebagian dokumen yang terbaca.

Catatan kecepatan: pada laptop CPU-only (~4-5 token/detik) satu jawaban bisa 1-3 menit dan ringkasan
dokumen bisa 5-10 menit. Aplikasi menampilkan progres ("Membaca dokumen: bagian 2 dari 6") dan
jawabannya tetap muncul walau halaman ditutup/dibuka lagi. Panggilan Ollama berbagi antrean dengan
auto-reply WhatsApp (satu per satu, supaya CPU tidak rebutan). Variabel pengaturan: lihat bagian
"Agen Ollama untuk chat di APLIKASI" di `.env.example`. Tes tanpa jaringan: `node test-app-agent.mjs`.

## 8. Notifikasi Ollama, lampiran file, Status Sistem, target khatam (butuh migration 0016)

**Notifikasi push saat jawaban Ollama selesai.** Kalau satu job Ollama berjalan lebih dari 20 detik
(`APP_AGENT_NOTIFY_MIN_SECONDS`), bot mengirim push ke HP: "Jawaban Ollama sudah siap" (atau "gagal")
dengan tautan ke obrolannya. Isi jawaban tidak ikut dikirim lewat push. Syarat: isi `CRON_SECRET` di
`wa-bot/.env` dengan nilai yang SAMA dengan secret `CRON_SECRET` di Supabase (dipakai Edge Function
`send-push`), dan deploy ulang `send-push`: `npx supabase functions deploy send-push`. Tanpa
`CRON_SECRET`, push dimatikan dan bot hanya menulis peringatan di log (fitur lain tetap jalan).
Push hanya sampai ke perangkat yang sudah menekan "Aktifkan Notifikasi" (PWA di Layar Utama).

**Lampiran file di chat.** Tombol klip di kolom ketik: PDF (yang punya lapisan teks) atau file teks
(.txt/.md/.csv/.json/.log), maks 15 MB dan 3 lampiran per obrolan. Teks diekstrak di browser lalu
disimpan sebagai lampiran obrolan itu (tabel `chat_attachments`, ikut terhapus bersama obrolan) dan
dibaca AI di setiap pesan obrolan itu sampai chip lampirannya dihapus. Gemini menerimanya utuh (dibatasi
600 ribu karakter total); Ollama: lampiran pendek (<= `OLLAMA_ATTACH_INLINE_CHARS`) disisipkan utuh,
yang panjang diambil potongan relevannya, dan permintaan seperti "ringkas file ini" memakai mode baca
per bagian (maks `OLLAMA_DOC_MAX_CHUNKS`). PDF hasil scan/foto tanpa teks tidak bisa dibaca.

**Status Sistem.** Menu "Status" di beranda: bot hidup/mati (denyut terakhir & lama menyala), WhatsApp
tersambung atau tidak, Ollama siap/sibuk/mati (beserta penyebabnya, mis. model belum di-pull), antrean
dan statistik 24 jam, jumlah chat WA yang sedang dijeda, pekerjaan Ollama terakhir, dan kuota tiap API key
Gemini. Diperbarui otomatis tiap 10 detik selama jendelanya terbuka.

**Target khatam.** Di halaman Al-Qur'an ada kartu "Target khatam": pilih jumlah hari (7/30/60/90 atau
bebas) dan mulai dari halaman 1 atau halaman terakhir dibaca. Aplikasi menghitung target halaman hari
ini, posisi, sisa halaman/hari, dan kemajuan berdasarkan "terakhir dibaca" (tersimpan otomatis saat
membaca). Setelah khatam, tombol "Mulai khatam baru" menambah hitungan khatam. Pengingat: tiap malam pada
jam `KHATAM_REMINDER_TIME` (default 20:30, zona `WA_TIMEZONE`) bot mengirim push HANYA kalau target hari
ini belum tercapai (butuh `CRON_SECRET` seperti di atas; bisa dimatikan di formulir target).

Setup: jalankan `supabase/migrations/0016_attachments_khatam_status.sql`, deploy ulang Edge Function
`chat` dan `send-push`, salin file bot (`index.js`, `app-agent.js`, `khatam.js`), isi `CRON_SECRET`, lalu
`pm2 restart wa-bot`. Tes tanpa jaringan: `node test-app-agent.mjs` dan `node test-khatam.mjs`
(`test-khatam.mjs` mengimpor `../src/khatam.js`, jadi jalankan di dalam repo lengkap).

## 9. Dokumen Pengetahuan penuh: PDF diproses di laptop (butuh migration 0017)

Sebelumnya teks PDF diambil di browser dan dipotong di 300 ribu karakter. Sekarang file **mentah** (PDF, .txt, .md, .csv, sampai 50 MB per file) diunggah dari aplikasi ke bucket Storage privat `kb-inbox`, lalu bot di laptop:

1. mengunduhnya dan mengubahnya jadi teks per halaman dengan `pdftotext -layout` (tabel tetap rapi);
2. untuk halaman **tanpa teks** (hasil scan) menjalankan OCR `tesseract` — opsional, dilewati bila tidak terpasang; PDF yang teksnya bisa diseleksi tidak butuh OCR sama sekali;
3. membuat indeks pencarian **SQLite FTS5 (BM25)** di `wa-bot/kb/kb.sqlite` yang memuat SELURUH teks, tanpa batas halaman;
4. menyalin teks ke kolom `content` di Supabase (dipotong di `KB_SYNC_MAX_CHARS`, default 600 ribu karakter) supaya **Gemini** tetap bisa memakai dokumen ini — dokumen yang terpotong ditandai di aplikasi;
5. menghapus file mentah dari inbox dan mengirim notifikasi push "Dokumen sudah siap".

Ollama tidak membaca ratusan halaman sekaligus: tiap pertanyaan dicarikan beberapa potongan paling relevan (dengan nomor halaman) dari indeks. Permintaan menyeluruh ("ringkas dokumen") tetap memakai peta-lalu-ringkas atas teks lengkap dari indeks.

**Persiapan satu kali di laptop**

```bash
sudo apt install poppler-utils                      # wajib: pdftotext
sudo apt install tesseract-ocr tesseract-ocr-ind    # opsional: OCR untuk PDF scan
node -v                                             # Node >= 22.5 memakai node:sqlite bawaan.
# Kalau Node lebih lama dari 22.5:  cd wa-bot && npm install better-sqlite3
```

Lalu: jalankan `supabase/migrations/0017_kb_inbox.sql` (SQL Editor atau `npx supabase db push`), deploy ulang function `chat`, deploy front-end, salin file bot baru ke laptop dan `pm2 restart wa-bot`. Status (jumlah dokumen, ada/tidaknya pdftotext & OCR) tampil di Pengaturan > Status Sistem.

Hal yang perlu diketahui:

- Dokumen lama (hasil upload sebelum fitur ini) otomatis ikut diindeks lewat "rekonsiliasi" tiap 2 menit; dokumen yang dihapus di aplikasi otomatis dibuang dari indeks.
- Indeks hanya ada di laptop. Kalau laptop mati, pencarian dokumen untuk Ollama ikut mati (Gemini tetap jalan memakai salinan di Supabase). Kalau `kb/kb.sqlite` terhapus, indeks dibangun ulang dari salinan di Supabase (bisa terpotong untuk dokumen sangat panjang) — simpan file PDF aslinya.
- Dokumen yang gagal diproses (mis. PDF berkata sandi) tampil dengan pesan dan tombol **Coba lagi**; file mentahnya tetap di inbox sampai berhasil atau dokumennya dihapus.
**Anti-halusinasi saat membaca dokumen.** (1) Bila toggle Dokumen Pengetahuan/lampiran aktif, prompt sistem memuat *ATURAN DOKUMEN*: jawab hanya dari teks konteks, tulis "Informasi tidak ada di dokumen." bila tak ada, sebut judul + halaman, dan tuliskan SEMUA butir saat diminta daftar. Bila tak ada potongan yang cocok, model diberi tahu eksplisit. (2) Suhu model turun ke 0.1 (`OLLAMA_DOC_TEMPERATURE`), berlaku juga untuk balasan WhatsApp yang memakai konteks dokumen. (3) Pencarian: potongan ±1000 karakter + overlap 150; potongan yang mirip **daftar isi** dibuang dari hasil (kecuali pertanyaan memang soal daftar isi); potongan **sesudah/sebelum** hasil teratas ikut disertakan dalam anggaran karakter yang sama (daftar rukun/syarat yang menyambung tidak terpotong). Indeks lama disusun ulang otomatis sekali saat bot dijalankan dengan versi ini (dari teks tersimpan, tanpa OCR ulang); setelah mengubah `KB_CHUNK_CHARS`/`KB_CHUNK_OVERLAP` isi `KB_REINDEX=true` sekali. (5) **Cek mutu PDF:** halaman yang teksnya berantakan (karakter rusak, huruf terpisah-pisah, kata tanpa huruf hidup) dicoba di-OCR ulang dan hasil OCR dipakai hanya bila lebih bersih; halaman yang masih berantakan dilaporkan di daftar Dokumen Pengetahuan di aplikasi ("⚠️ Sebagian teks berantakan: 2 dari 10 halaman (hlm 6, 7)"). Matikan dengan `KB_QUALITY_CHECK=off`. Penilaian ini heuristik: halaman berisi tabel/kode yang tidak lazim bisa kadang ditandai. Sejak versi ini ada juga **cakupan kata umum**: halaman berhuruf Latin dengan <5% kata umum (yang, dan, di, untuk, … / the, of, and) ditandai rusak -- ini menangkap lapisan teks scan yang "berhuruf hidup" tapi salah baca ("yarg", "dar", "unluk"). (6) **Imbuhan Bahasa Indonesia:** pencarian dijalankan dua kali -- teks asli (kata persis/awalan) dan *batang kata* (stem, `id-stem.js`) -- lalu digabung (Reciprocal Rank Fusion), sehingga "menyetor" menemukan "penyetoran/setoran/disetorkan", "membayar" menemukan "pembayaran". Indeks menambah kolom `stem` (±+40% ukuran file SQLite) dan disusun ulang otomatis sekali saat bot dijalankan. Potongan daftar isi dengan titik pengantar berspasi (`. . . . 12`) atau judul bab yang dibungkus ke baris kedua kini ikut dikenali.

**Audit pencarian & mutu dokumen (tanpa mengubah indeks).** `node kb-audit.mjs --docs` menilai teks tiap dokumen yang SUDAH terindeks (halaman berantakan, jumlah halaman OCR). `node kb-audit.mjs "apa rukun wudhu" "tarif hotel Jogja"` menampilkan persis potongan (judul, halaman, skor) yang akan diterima model. `--file pertanyaan.txt` menjalankan banyak pertanyaan sekaligus; format baris `pertanyaan | hal=37 | dok=Fiqih | teks=niat` (bagian setelah `|` opsional) dan di akhir dihitung hit-rate. Kalau potongan yang benar tidak muncul di sini, masalahnya di pencarian/chunking/OCR, bukan di model. `node kb-audit.mjs --pages [--dok Fiqih]` mendaftar HALAMAN yang masih berantakan beserta alasan dan cuplikan teksnya (perbaikan: hapus dokumen di aplikasi lalu unggah ulang agar OCR dicoba lagi). Opsi: `--budget 5000 --max 8 --no-neighbors --index <file>`.

- OCR di laptop CPU-only lambat (puluhan detik per halaman) dan berjalan berprioritas rendah (`nice`); dibatasi `KB_OCR_MAX_PAGES` halaman per dokumen.
- Tes: `node test-kb.mjs` (memakai PDF contoh di `test-fixtures/`).


### 9b. Gemini membaca dokumen lewat indeks laptop (butuh migration 0019)

Sebelumnya Gemini hanya melihat salinan teks di Supabase yang dipotong di `KB_SYNC_MAX_CHARS` (dokumen besar seperti Fiqih Sunnah ±60% tak terlihat) dan dicari dengan pencari sederhana. Sekarang, bila toggle **Pakai Dokumen Pengetahuan** aktif dan laptop hidup:

1. Edge Function `chat` menaruh pertanyaan (dari beberapa pesan terakhir) di tabel `kb_retrievals`;
2. bot di laptop (`kb-retrieval.js`, cek antrean tiap 2 dtk) mencari di indeks FTS5 lengkap — dengan pencarian imbuhan, penyingkiran daftar isi, dan potongan tetangga — lalu menulis potongan + nomor halamannya;
3. Edge Function menunggu hasilnya (maks. ±25 dtk) dan **hanya potongan itu** yang dikirim ke Gemini (±12.000 karakter ≈ 3–4 ribu token, jauh lebih hemat daripada salinan dokumen);
4. mode **dokumen ketat**: tanpa Google Search, suhu 0.2, wajib menyebut (judul, hlm N) dan menyalin kutipan persis di antara «…», serta menjawab "Informasi tidak ada di dokumen." bila memang tak ada;
5. **pemeriksa mekanis** (`docguard.js` / `_shared/docguard.ts`): kutipan «…» yang tak ada persis di potongan, atau nomor halaman yang tak ada di potongan, diberi catatan "⚠️ Pemeriksaan otomatis…" di akhir jawaban. Pemeriksa yang sama aktif untuk jawaban Ollama (aplikasi) dan Gemini via WhatsApp.

Bila laptop mati / bot tak menjawab / indeks kosong, Edge Function otomatis memakai jalur lama (salinan cloud) — pesan tetap terjawab. Permintaan "ringkas dokumen ini" juga masih lewat jalur lama. Jawaban dari WhatsApp (mesin Gemini) kini memakai indeks laptop langsung (`GEMINI_RAG_BUDGET_CHARS`, bawaan 10000; `GEMINI_RAG_MAX_CHUNKS`, bawaan 8). Lihat log Edge Function: `indeks laptop -> N blok dalam X ms` atau `indeks laptop tidak dipakai (alasan)`.

Pasang: jalankan `supabase/migrations/0019_kb_retrievals.sql`, deploy ulang function `chat`, salin file bot baru ke laptop (`kb-retrieval.js`, `docguard.js`, `index.js`, `app-agent.js`, `kb-index.js`) dan `pm2 restart wa-bot`. Opsi `.env`: `KB_RETRIEVAL_ENABLED=false` mematikan worker, `KB_RETRIEVAL_POLL_MS`, `KB_RETRIEVAL_MAX_BUDGET_CHARS`.


**Penyempurnaan pencarian (hasil audit).** (a) *Cakupan kata*: pertanyaan panjang (≥ 5 kata penting) hanya mengembalikan potongan yang memuat ≥ 50% kata kuncinya (`KB_MIN_COVERAGE`, 0 = mati; naikkan ke 0.7 bila pertanyaan di luar dokumen masih mendapat potongan sampah); bila tak ada yang memenuhi hasilnya kosong sehingga model diberi tahu "tidak ditemukan". (b) *Halaman berantakan* (teks scan rusak) diurutkan di belakang halaman bersih. Halaman tabel/angka tidak dianggap rusak. (c) Pembersihan otomatis: URL penanda air JDIH, "SK No 115576 A" di kaki halaman, dan salah-baca OCR "4,5o/o" → "4,5%". (d) Sinonim fikih: "rukun" ↔ "fardhu/fardu". (e) Pemeriksa jawaban hanya memeriksa kutipan di antara « » — judul dokumen dalam tanda kutip biasa tidak lagi ditandai. Indeks disusun ulang otomatis sekali saat bot dijalankan (versi skema 5). `kb-audit.mjs` mengenal kunci `kosong=ya` (pertanyaan tanpa jawaban), `tidak=`, `jawab=`, `bukan=` dan opsi `--ask`.

## 9c. Penyedia cadangan Groq & OpenRouter (rotasi di luar Gemini)

Gemini tetap yang pertama (punya Google Search). Hanya bila SEMUA key Gemini habis kuota/gagal (429, 503, jaringan), permintaan dialihkan ke **Groq**, lalu **OpenRouter**. Keduanya memakai format OpenAI-compatible, tanpa Google Search: bot WA menyisipkan hasil Bing + potongan dokumen seperti jalur "tanpa internet" Gemini, dan Obrolan AI di aplikasi memakai pencarian Bing yang sama. Mode dokumen ketat (suhu 0,2 dan pemeriksa kutipan) tetap berlaku.

1. Buat API key di console.groq.com dan openrouter.ai (boleh lebih dari satu, dipisah koma).
2. **Bot WA** — tambahkan di `.env`:
   ```
   GROQ_API_KEYS=gsk_xxx,gsk_yyy
   OPENROUTER_API_KEYS=sk-or-xxx
   ```
   lalu `pm2 restart wa-bot`. Di log harus muncul `🛟 Penyedia cadangan AI aktif`.
3. **Obrolan AI di aplikasi** — set secret yang sama di Supabase (tanpa perlu migration), lalu deploy ulang fungsi `chat`:
   ```
   npx supabase secrets set GROQ_API_KEYS=gsk_xxx,gsk_yyy OPENROUTER_API_KEYS=sk-or-xxx
   npx supabase functions deploy chat
   ```
4. Opsional: `GROQ_MODEL`, `OPENROUTER_MODEL` (daftar dipisah koma, dicoba berurutan), `LLM_FALLBACK_ORDER` (mis. `openrouter,groq`), `LLM_FALLBACK_MAX_INPUT_CHARS`. Nama model gratis berubah dari waktu ke waktu; kalau log menampilkan `model ... tidak ditemukan`, perbarui nilainya.

Catatan: jawaban cadangan dicatat 0 token/0 dolar (hitungan token di aplikasi tetap hanya Gemini) dan tetap tersimpan sebagai balasan "gemini" di riwayat. Key yang kena 429 diistirahatkan sesuai header `retry-after` (atau 1 menit; 1 jam bila pesan menyebut batas harian). Bila Gemini tidak punya key sama sekali tetapi Groq/OpenRouter ada, bot dan aplikasi langsung memakai cadangan. Ringkasan harian WA juga memakai cadangan bila Gemini gagal. **Monitoring di aplikasi (butuh migration 0020).** Di menu Status (Status Sistem) ada tiga tombol: **Gemini**, **OpenRouter**, dan **Groq**. Klik salah satu untuk melihat key-nya: 4 karakter terakhir, jumlah permintaan hari ini (OpenRouter dengan garis batas 50/hari, Groq tanpa garis karena jatahnya per model dan per menit), model terakhir yang berhasil menjawab, status Aktif / Dibatasi sementara / Habis kuota / Key ditolak, serta pesan error terakhir. Bot WA dan fungsi `chat` mencatatnya otomatis setiap Groq atau OpenRouter dipakai. Jalankan `supabase/migrations/0020_llm_provider_usage.sql` di SQL Editor (aman diulang), deploy ulang `chat`, `pm2 restart wa-bot`, lalu build ulang aplikasinya seperti biasa. Batas harian bisa diubah lewat secret `OPENROUTER_DAILY_LIMIT` atau `GROQ_DAILY_LIMIT` (opsional). Cek lokal: `node test-llm-fallback.mjs`.

## 10. Antrean Ollama berprioritas & pengaman RAM

Laptop 2 inti / 7,5 GB RAM hanya sanggup satu panggilan Ollama pada satu waktu. Semua panggilan lewat satu antrean (`ollama-queue.js`) dengan tiga tingkat prioritas:

| Prioritas | Untuk apa |
| --- | --- |
| 0 — CHAT | chat di aplikasi, perintah pemilik (SiMAB) |
| 1 — WA | balasan otomatis WhatsApp |
| 2 — BACKGROUND | ringkasan harian |

Yang prioritasnya lebih tinggi didahulukan; di tingkat yang sama berlaku urutan datang. Panggilan yang sedang berjalan tidak dipotong. Supaya pekerjaan latar tidak kelaparan, tiap `OLLAMA_QUEUE_AGING_MS` (default 2 menit) menunggu, prioritasnya naik satu tingkat.

Pekerjaan latar yang berat di luar Ollama, yaitu **OCR dokumen**, ikut mengalah: dokumen baru tidak diambil saat Ollama sibuk, dan OCR berhenti sebentar sebelum tiap halaman sampai antrean kosong.

Pengaman RAM:

- `OLLAMA_KEEP_ALIVE` (default `5m`) mengatur berapa lama model tetap di RAM setelah panggilan terakhir. Makin pendek, RAM makin cepat lega, tetapi pesan berikutnya kena ongkos muat ulang (sekitar 5–8 detik).
- Kalau suatu saat dipakai model Ollama kedua, model sebelumnya dibongkar dari RAM lebih dulu supaya tidak ada dua model sekaligus.
- Status Sistem menampilkan RAM tersedia dan swap terpakai; peringatan muncul bila RAM tersedia di bawah 1 GB.

Tes: `node test-ollama-queue.mjs`.

### Jawaban dokumen lama / "Gagal hubungi Ollama" setelah 5 menit

Di laptop CPU-only, prompt besar (potongan dokumen + riwayat) butuh waktu: membaca prompt sekitar 20 token/detik dan menulis sekitar 4,5 token/detik. Dua hal sudah ditangani:

- Panggilan ke Ollama kini lewat `ollama-http.js` (node:http + stream), bukan `fetch` bawaan Node yang memutus request setelah **300 detik** dengan pesan "fetch failed". Batas sekarang hanya `OLLAMA_CHAT_TIMEOUT_MS` (default 10 menit). Pesan gagal juga lebih jelas: "tidak merespons (timeout)", "koneksi terputus" (biasanya Ollama berhenti karena RAM), atau "Gagal hubungi Ollama" (server memang mati).
- Saat Dokumen Pengetahuan atau lampiran aktif, riwayat obrolan dipangkas ke `OLLAMA_DOC_HISTORY_LIMIT` pesan terakhir (default 4) dan balasan lama dipotong ke `OLLAMA_DOC_HISTORY_CLIP_CHARS` karakter (default 700), supaya prompt tidak membengkak. Aplikasi menampilkan kemajuan "Menulis jawaban (N token)".

Tes: `node test-ollama-http.mjs`.

## Troubleshooting

- **QR tidak muncul / bot langsung error network** -- cek koneksi internet;
  Baileys butuh akses ke server WhatsApp (bukan cuma Supabase).
- **"Sesi logout/dicabut dari HP"** -- biasanya karena sesi di-logout manual
  dari HP (WhatsApp > Perangkat Tertaut), atau tidak dipakai terlalu lama.
  Hapus folder `auth_session/` lalu `npm start` lagi buat scan QR baru.
- **Pesan nyangkut status "pending" lama di aplikasi** -- cek bot masih
  jalan (`pm2 status` atau terminalnya masih terbuka) dan tersambung
  (`✅ WhatsApp tersambung` muncul di log terakhir).
