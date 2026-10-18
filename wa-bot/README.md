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

## 9d. Telegram untuk pemilik (opsional, default MATI)

Tambahan, bukan pengganti: bot WhatsApp tetap berjalan seperti biasa. Selama `TELEGRAM_BOT_TOKEN` kosong, tidak ada yang berubah. Bot memakai **Bot API resmi Telegram lewat long polling** dari proses yang sama (tanpa webhook, tanpa port terbuka), jadi laptop/pm2 yang menjalankan bot WA yang juga menjalankan Telegram.

Yang bisa dilakukan lewat Telegram (hanya dari chat pribadi pemilik):

- **Ngobrol dengan AI**: ketik biasa. Memakai Gemini (rotasi key + cadangan Groq/OpenRouter), pencarian web, dan Dokumen Pengetahuan, dengan riwayat singkat per chat. `/baru` melupakan konteks.
- **SiMAB**: `/simab pagu ...`, `/simab cek ...`, `/simab rekam <seksi>`, dst. (atau tulis `simab ...` tanpa garis miring). Perintahnya persis sama dengan di WhatsApp; sesi rekam berjalan per chat.
- **Tombol pilihan di perekaman SiMAB** (`simab rekam`, `simab ubah`, `simab hapus`): daftar bernomor tampil sebagai tombol satu per baris, ditambah tombol *Lanjut/Balik*, *Kembali*, *Ya, simpan / Ubah / Batal*, dan *Ya, hapus*. Menekan tombol sama persis dengan mengetik katanya, jadi mengetik angka atau kata tetap bisa (perlu untuk `cari <kata>` dan mengisi 3 baris data). Tombol dibuat dari teks balasan SiMAB, tanpa mengubah alur SiMAB di WhatsApp; tombol lama otomatis hilang saat pilihan baru muncul atau setelah ditekan, dan menekan tombol setelah sesi berakhir hanya memunculkan pesan "Sesi SiMAB sudah berakhir".
- **Pesan suara (🎤)**: tahan tombol mikrofon di Telegram dan bicara. Bot menuliskan apa yang terdengar (`🎤 “...”`), lalu menjalankannya seperti pesan teks: obrolan AI biasa, atau perintah SiMAB ("si mab rekam umum" dikenali sebagai `simab rekam Umum`). Di tengah sesi rekam SiMAB: ucapkan *"nomor tiga"*, *"ya"*, *"lanjut"*, *"batal"*, atau satu kalimat penuh seperti *"Pembelian ATK, tanggal lima Oktober dua ribu dua puluh enam, jumlah satu juta lima ratus ribu rupiah"* (`uraian` boleh dilisankan atau cukup kalimat di depannya; kata `jumlah` boleh dilewati bila uangnya di ujung, mis. *"Rp 1 juta"*). Ucapkan *"enter"* atau *"baris baru"* untuk memisahkan tiga bagian: *"Pembelian ATK, enter, tanggal 5 Oktober 2026, enter, Rp 1 juta"* (kata `bulan`, `tanggal`, `Rp` otomatis dibuang); bot mengubah angka dalam kata jadi digit, menyusunnya jadi tiga baris (uraian / tanggal / jumlah), lalu alur biasa meminta konfirmasi (*ya* / *ubah* / *batal*) sebelum menyimpan. Mesin suara->teks: **Groq Whisper** (`whisper-large-v3-turbo`, gratis, memakai `GROQ_API_KEYS`) lebih dulu, cadangan **Gemini** (`GEMINI_API_KEYS`); kunci yang kena batas diistirahatkan otomatis. Batas: `VOICE_MAX_SECONDS` (180 detik) dan 20 MB. Tanpa kedua jenis kunci, pesan suara dijawab "belum aktif". Tes: `node test-voice.mjs`.
- **Balasan suara & ngobrol Inggris di Telegram (🔊 / 🎙️)**: bot bisa membalas dengan **voice note** (suara natural Gemini TTS, suara "Sulafat"; ganti dengan `TELEGRAM_TTS_VOICE`). Teks tetap dikirim juga. **Butuh `ffmpeg` (dengan libopus) di laptop bot** untuk mengubah WAV jadi OGG/Opus yang diterima Telegram: `sudo apt install ffmpeg`, cek `ffmpeg -version` (bot mengecek ulang tiap menit, jadi tak perlu restart setelah memasangnya). Tanpa ffmpeg atau saat kuota Gemini habis, bot tetap membalas teks dan memberi tahu sekali. Perintah: `/suara auto` (bawaan: dibalas suara bila kamu mengirim suara), `/suara on` (selalu), `/suara off`; pilihan tersimpan di `bot_state` per chat. Jawaban SiMAB tidak dibacakan; jawaban panjang diucapkan sampai akhir kalimat terakhir yang muat dalam `TTS_MAX_CHARS` (700 karakter), teksnya tetap lengkap. **Mode tutor Inggris `/speak [topik]`**: sesi ngobrol dengan "Emma" (persona yang sama dengan menu Speaking di aplikasi); kirim suara berbahasa Inggris (pengenalan suara otomatis diatur ke bahasa Inggris selama sesi) atau ketik; tutor membalas dengan teks + voice note, lengkap dengan koreksi singkat (✏️) dan tip berbahasa Indonesia (💡). Berakhir dengan `/selesai`, ucapan perpisahan (goodbye, see you, I have to go...), batas `TELEGRAM_SPEAK_MAX_TURNS` (30 giliran), atau diam `TELEGRAM_SPEAK_IDLE_MIN` (60 menit). **`/speak id [topik]`** = teman ngobrol santai berbahasa Indonesia ("Rani"): pengenalan suara diatur ke bahasa Indonesia, balasan singkat dan lisan (teks + voice note), **tanpa koreksi/tip**, dan berakhir juga dengan ucapan pamit berbahasa Indonesia (sampai jumpa, dadah, aku pamit dulu, udahan dulu, aku mau tidur dulu, selamat tidur; "selamat malam/pagi" sengaja tidak dihitung karena sering jadi sapaan). `/speak en [topik]` = Inggris (sama dengan `/speak`). Untuk ngobrol biasa tanpa sesi, cukup kirim voice dengan `/suara auto`. Selama sesi, pesan biasa dianggap ucapan untuk tutor; perintah `/...` dan alur SiMAB tetap jalan. Sesi disimpan di memori bot (hilang saat restart; tidak masuk riwayat aplikasi). `/status` menampilkan apakah suara siap. Tes: `node test-voice-output.mjs`, `node test-tutor.mjs`, `node test-telegram.mjs`.

- **Suara di WhatsApp (🎤 / 🎙️)**: (1) **Pemilik** (chat ke diri sendiri atau dari `WA_OWNER_NUMBER`): kirim voice note, bot menampilkan `🎤 “...”` lalu menjalankannya seperti ketikan (SiMAB, dst.). **`/speak [topik]`**, **`/speak id [topik]`** dan **`/selesai`** bekerja seperti di Telegram: tutor membalas teks + voice note (PTT) dengan koreksi; selama sesi, teks/voice note pemilik = ucapan untuk tutor, tidak disimpan ke riwayat dan tidak memicu auto-reply. (2) **Kontak lain di chat pribadi**: voice note diubah jadi teks lalu dijawab auto-reply seperti pesan biasa (balasan berupa teks; riwayat menyimpan `🎤 <teks>`). Hanya untuk kontak yang memang akan dijawab AI (tidak dijeda, tidak dimatikan); matikan dengan `WA_VOICE_FROM_OTHERS=false`. (3) **Grup**: voice note tidak bisa me-mention, jadi yang dijawab hanya voice note yang **membalas (reply) pesan bot** di grup yang diizinkan (`WA_VOICE_IN_GROUPS=false` untuk mematikan); tetap berlaku jeda per orang. Kunci, `ffmpeg`, dan batas durasi sama dengan Telegram. Tes: `node test-wa-voice.mjs`.
- **`/status`**: kondisi bot sekilas: WhatsApp tersambung atau tidak, auto-reply, jumlah key Gemini yang siap (dan kapan yang kena batas pulih), penyedia cadangan, token & biaya hari ini, Ollama, jumlah dokumen di indeks laptop, SiMAB, ringkasan harian, pantauan peraturan, Telegram. Key tidak pernah ditampilkan, hanya dihitung.
- **`/ringkasan`**: ringkasan percakapan WhatsApp hari ini, dikirim ke Telegram.
- **`/peraturan`** dan **`/peraturan semua`**: pantauan peraturan, hasilnya dikirim ke Telegram.
- **Notifikasi ikut dikirim ke Telegram**: ringkasan harian, laporan pantauan peraturan mingguan, dan peringatan "semua key Gemini habis". Pantauan peraturan kini gagal hanya bila WhatsApp **dan** Telegram sama-sama tidak bisa menerima. Matikan dengan `TELEGRAM_MIRROR_NOTIFICATIONS=false`.

Pasang:

1. Di Telegram buka **@BotFather** > `/newbot` > beri nama > salin token.
2. Isi `.env` bot: `TELEGRAM_BOT_TOKEN=<token>` lalu `pm2 restart wa-bot --update-env`. Di log muncul "Telegram: AKTIF tapi mode pairing".
3. Kirim pesan apa saja ke bot barumu. Ia membalas **id chat-mu** dan belum menjalankan perintah apa pun.
4. Isi `TELEGRAM_OWNER_IDS=<id itu>` (boleh beberapa, pisah koma) lalu restart lagi. Kirim `/start` untuk melihat bantuan.

Keamanan: pesan dari chat yang id-nya tidak ada di `TELEGRAM_OWNER_IDS`, dan semua pesan grup, diabaikan diam-diam (hanya dicatat di log). Siapa pun yang menemukan nama bot-mu tidak bisa memakainya. Token bot adalah rahasia seperti password: jangan dibagikan atau di-commit; kalau bocor, buat ulang lewat @BotFather (`/revoke`). Pesan lewat Telegram tersimpan di server Telegram (tidak terenkripsi ujung ke ujung), jadi untuk data yang sangat sensitif tetap pertimbangkan.

Catatan: yang dibaca pesan teks dan pesan suara (foto/berkas belum). Jangan menjalankan dua salinan bot dengan token yang sama: Telegram menolak polling ganda (galat 409, tercatat di log). Tes tanpa jaringan: `node test-telegram.mjs`.

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


## Tutor /speak: suara saja

Selama sesi `/speak` (WhatsApp dan Telegram), bawaannya **suara saja**: ucapanmu tidak di-echo (`🎤 “...”`) dan balasan tutor tidak ditulis. Teks hanya muncul sebagai cadangan bila suara tutor gagal dibuat (kuota Gemini TTS habis, ffmpeg bermasalah).

- `/teks on` / `/teks off` (atau `/teks` untuk bolak-balik): tampilkan teks balasan + echo ucapanmu selama sesi.
- `/koreksi`: tampilkan koreksi dan tips giliran terakhir (kelas Inggris).
- Bawaan global lewat `.env`: `WA_SPEAK_TEXT=true` / `TELEGRAM_SPEAK_TEXT=true`.
- Putar otomatis tidak bisa dipaksa oleh bot: itu perilaku aplikasi WhatsApp/Telegram di HP. Untuk putar-otomatis sungguhan pakai halaman Speaking di aplikasi.
- `TUTOR_AI_ORDER` (bawaan `fallback-first`): tutor memakai Groq/OpenRouter dulu, Gemini sebagai cadangan; `gemini-first` membalik urutannya.

## Perintah laptop dari Telegram (restart, deploy, log)

Mati bawaan. Aktifkan dengan `OPS_ENABLED=true` di `.env` bot lalu `pm2 restart wa-bot --update-env`. Hanya Telegram (bukan WhatsApp), hanya chat pribadi pemilik (`TELEGRAM_OWNER_IDS`, bisa dipersempit dengan `OPS_TELEGRAM_IDS`), dan tidak lewat pesan suara.

| Perintah | Fungsi |
| --- | --- |
| `/sistem` | pm2, disk, RAM/swap, beban, Ollama |
| `/log [jumlah] [error]` | baris terakhir log bot (maks 80), rahasia disamarkan |
| `/restart` | `pm2 restart wa-bot --update-env` (konfirmasi) |
| `/deploy chat` / `/deploy study` | `npx supabase functions deploy <fungsi>` (konfirmasi) |
| `/migrasi` | pratinjau migrasi yang belum diterapkan (`db push --dry-run`) |
| `/migrasi terapkan` | `npx supabase db push` (konfirmasi) |
| `/ya <kode>` | konfirmasi |

**Patch zip + Git dari Telegram.** Alur kerja sehari-hari saat aku mengirim file baru:

1. Kirim berkas `patch-….zip` ke bot Telegram. Bot memeriksanya (path harus relatif terhadap akar proyek; `.env`, `auth_session/`, `dokumen/`, `wa-bot/kb/`, `.git`, `node_modules` tidak pernah disentuh; satu path berbahaya = seluruh zip ditolak), lalu menampilkan daftar `+` baru / `~` berubah dan meminta `/ya <kode>`.
2. Setelah `/ya`, file lama dicadangkan di `.ops-backup/<waktu>/` dan zip diterapkan. Bot menyarankan langkah berikutnya sesuai file yang berubah: `/tes`, `/migrasi`, `/deploy chat`, `/restart`, `/rilis`.
3. `/tes` menjalankan `npm test`. Bila gagal: `/urungkan` mengembalikan patch terakhir (dari cadangan).
4. `/rilis <pesan>` = `git add -A` + `git commit` + `git push` dengan satu konfirmasi. Tersedia juga `/git` (status), `/commit <pesan>`, `/push`.

Git: tidak pernah `--force`; commit dibatalkan bila ada file sensitif ikut ter-stage; push yang ditolak karena remote lebih baru hanya dilaporkan (gabungkan manual dengan `git pull`). Git harus sudah bisa push tanpa kata sandi dari proses bot (pm2): pakai kunci SSH tanpa passphrase atau HTTPS dengan `git config credential.helper store`; bot tidak pernah menanyakan kata sandi (`GIT_TERMINAL_PROMPT=0`). Cabang tanpa upstream di-push dengan `-u origin`. Sekali sebelum memakai: pastikan `git config user.name` dan `user.email` sudah terisi di folder proyek.

Pengaman: tidak ada shell bebas (perintah tetap, nama fungsi dicocokkan dengan daftar putih `OPS_FUNCTIONS`, dijalankan tanpa shell); perintah yang mengubah sesuatu memberi kode acak 4 digit yang harus dibalas `/ya <kode>` dalam 60 detik (sekali pakai, hanya dari chat yang sama); satu pekerjaan berat pada satu waktu; setiap perintah dicatat di `wa-bot/ops-audit.log`; nilai `.env` yang berisi KEY/TOKEN/SECRET/PASSWORD disamarkan dari keluaran. Setelah `/restart`, bot mengabari lewat Telegram begitu menyala lagi.

Catatan: ini menyerahkan kendali atas laptop ke akun Telegram-mu — dengan fitur patch, siapa pun yang menguasai akun itu bisa mengganti kode bot (setelah konfirmasi), jadi perlakukan akun Telegram-mu seperti kunci laptop. Aktifkan verifikasi dua langkah di Telegram dan jangan tinggalkan HP tanpa kunci. `/deploy` dan `/migrasi` memakai login Supabase CLI yang sudah ada di laptop; zip patch tetap harus kamu ekstrak sendiri ke folder proyek sebelum `/deploy` atau `/restart`.

## Dokumen lokal: PDF peraturan → .md → bisa ditanyakan (khusus Ollama)

Folder di laptop (bawaan: `dokumen/` di samping `wa-bot/`, ubah dengan `DOC_DIR`):

```
dokumen/peraturan-pdf/   taruh PDF di sini (boleh subfolder). Bot hanya MEMBACA, tidak mengubah/menghapus.
dokumen/peraturan-md/    hasil .md terstruktur. Boleh kamu sunting; suntingan TIDAK ditimpa.
```

- Folder dipantau tiap 20 detik (`DOC_POLL_MS`). PDF baru/berubah dikonversi satu per satu, menunggu Ollama bebas.
- Hasil: kepala YAML (judul, jenis, nomor, tahun, tentang, jumlah halaman/BAB/Pasal, catatan mutu), `## BAB`, `### Bagian`, `Pasal` jadi judul, ayat/huruf/angka jadi daftar bertingkat (nomor aslinya dipertahankan), tabel jadi tabel Markdown, header/footer berulang dibuang, dan penanda `<!-- hlm N -->` supaya jawaban bisa menyebut halaman PDF.
- PDF scan memakai OCR yang sama dengan Dokumen Pengetahuan (`tesseract-ocr-ind`).
- Bila PDF diganti padahal kamu sudah menyunting .md-nya, hasil baru disimpan sebagai `<nama>.baru.md` (tidak ikut diindeks) dan suntinganmu aman.
- .md yang kamu taruh/sunting sendiri di `peraturan-md/` otomatis diindeks ulang; .md yang dihapus keluar dari indeks.
- **Privasi:** dokumen ini diindeks dengan id `local:` dan dikecualikan dari pencarian untuk Gemini/Groq/OpenRouter (`excludeLocal`). Hanya jalur Ollama (balasan WA bila `WA_AI_ENGINE=ollama`, agen chat aplikasi) yang melihatnya. Ke Supabase hanya naik metadata tugas (nama file, jumlah halaman/Pasal, status).
- Menu **PDF → MD** di aplikasi: unggah PDF → antrean (`pdf_md_jobs`, migrasi `0037_pdf_md_jobs.sql`) → laptop menyimpannya ke `peraturan-pdf/` dan memprosesnya. Hasil dari folder juga tampil di daftar itu.
- Folder `dokumen/` sudah masuk `.gitignore` (tidak ikut ke GitHub).
- **Cara menanyakannya (semuanya dijawab Ollama di laptop):**
  - *Chat aplikasi*: pilih mesin **Ollama** pada percakapan, lalu nyalakan toggle **Dokumen**. Pertanyaan otomatis mencari di dokumen lokal (dan Dokumen Pengetahuan biasa). Teks jawabannya tersimpan di riwayat chat Supabase seperti obrolan lain.
  - *WhatsApp* (chat pribadi/chat ke diri sendiri, hanya pemilik; di grup diabaikan): `/dokumen <pertanyaan>`. `/dokumen` saja = daftar dokumen lokal.
  - *Telegram* (hanya pemilik): perintah yang sama.
  - Satu pertanyaan = satu jawaban (tanpa memori obrolan), jadi tulis lengkap, mis. `/dokumen berapa lama hibah diberikan menurut UU 1 2004 pasal 12?`. Jawaban memuat daftar sumber (judul + halaman) dan diperiksa `guardDocAnswer`; bila tak ada bagian yang cocok, model tidak dipanggil dan bot bilang tidak ditemukan.
  - Balasan otomatis ke kontak/grup TIDAK memakai dokumen lokal (bawaan). `DOC_LOCAL_WA_CONTACTS=true` mengizinkannya (hanya bila `WA_AI_ENGINE=ollama`). `DOC_LOCAL_BUDGET_CHARS` (bawaan 3500) = banyaknya teks dokumen yang dibaca model untuk `/dokumen`.
- Pemasangan: `npx supabase db push` (atau tempel 0037 dan 0038 di SQL Editor; 0038 = kolom progres), `npx supabase functions deploy chat`, ekstrak zip, `pm2 restart wa-bot --update-env`.

## Status penyedia AI (`/penyedia`) dan catatan pribadi (`/ingat`)

Dua perintah untuk pemilik, di Telegram dan WhatsApp (WhatsApp: chat pribadi saja, bukan grup). Keduanya jalan lokal, tanpa biaya, tanpa paket baru.

**`/penyedia`** menampilkan status tiap penyedia AI sejak bot dihidupkan: Gemini, Groq, OpenRouter, Ollama, dan pencarian web. Isinya jumlah berhasil/gagal, 20 percobaan terakhir, kapan terakhir berhasil, berapa key yang sedang istirahat (dan jam pulihnya), serta galat terakhir. Ikon: 🟢 lancar, 🟡 kadang gagal, 🔴 tiga percobaan terakhir gagal, ⚪ belum dipakai. `/penyedia reset` menghitung dari nol. Yang dicatat hanya hasil panggilan; isi percakapan dan key tidak disimpan (galat dibersihkan dari pola key). Hitungan di memori, jadi mulai dari nol setiap bot di-restart.

**`/ingat <teks>`** menyimpan catatan pribadi (maks 300 huruf, maks 50 catatan), **`/catatan`** menampilkan daftar, **`/lupa <nomor>`** atau **`/lupa semua`** menghapus. Catatan disimpan di `wa-bot/memori.sqlite` di laptop (sudah masuk `.gitignore`) dan hanya disisipkan ke prompt Ollama lokal untuk pemilik: chat di aplikasi dan `/dokumen`. Catatan **tidak** dikirim ke Gemini/Groq/OpenRouter, **tidak** dipakai untuk balasan otomatis ke kontak WhatsApp, dan obrolan biasa di Telegram (yang dijawab Gemini) juga tidak memakainya. Teks yang tampak seperti rahasia (API key, kata sandi, PIN, nomor kartu) ditolak. Untuk `/dokumen`, catatan hanya menyesuaikan gaya jawaban; isi peraturan tetap hanya dari dokumen.

Contoh: `/ingat jawab singkat, maksimal 5 poin` lalu tanya di chat aplikasi dengan mesin Ollama.

Pengaturan (opsional) ada di bagian 16 `.env.example`: `OWNER_MEMORY_ENABLED`, `OWNER_MEMORY_MAX`, `OWNER_MEMORY_BUDGET_CHARS`, `OWNER_MEMORY_FILE`.

## Skill (`/skill`): resep tugas buatanmu sendiri

Skill adalah file `.md` di folder `wa-bot/skills/` yang berisi instruksi untuk Ollama. Nama file = nama skill. Dipanggil dari Telegram atau WhatsApp (WhatsApp: chat pribadi saja, bukan grup):

- `/skill` — daftar skill
- `/skill <nama> <teks yang diolah>` — jalankan, contoh: `/skill ringkas <tempel teksnya>` (nama boleh disingkat selama awalannya unik)

Skill **hanya teks**: tidak ada kode yang dijalankan, tidak ada akses berkas, jaringan, atau shell. Dijawab Ollama lokal di laptop (tidak pernah ke Gemini/Groq/OpenRouter), hanya untuk pemilik. Teks masukan diperlakukan sebagai bahan olahan, bukan perintah, jadi instruksi yang menyusup di dalam teks yang kamu tempel diabaikan. Folder dibaca ulang tiap dipakai, jadi skill baru langsung bisa dipakai tanpa restart.

Format file (blok di antara `---` opsional):

```
---
deskripsi: Ringkas teks jadi poin-poin     # tampil di daftar
dokumen: false     # true = sertakan bagian dokumen lokal yang cocok; jawaban diperiksa & diberi "📚 Sumber"
catatan: true      # true (bawaan) = catatan pribadi /ingat ikut dibaca
suhu: 0.3          # 0-1; makin kecil makin kaku/konsisten
---
Instruksi untuk model, bebas, Bahasa Indonesia.
```

Batas: file maks 8.000 huruf, masukan maks 6.000 huruf, maks 60 skill. Skill `dokumen: true` tidak memanggil model sama sekali bila tidak ada bagian dokumen yang cocok. Contoh bawaan: `ringkas`, `rapikan-surat`, `laporan-skp`, `tanya-pasal`. Mengirim ulang patch yang berisi skill bernama sama akan menimpa isinya, jadi untuk ubahan sendiri beri nama file yang berbeda.

## Obrolan Ollama lokal (`/lokal`) dan pencarian catatan

**`/lokal <pesan>`** (alias **`/tanya`**) mengobrol dengan Ollama di laptop, di Telegram dan WhatsApp (WhatsApp: chat pribadi saja, bukan grup). Bedanya dengan obrolan biasa di Telegram (dijawab Gemini di cloud): di sini seluruh percakapan dan **catatan pribadi (`/ingat`) hanya diproses Ollama lokal**, tidak keluar dari laptop. Bot mengingat beberapa tanya-jawab terakhir per chat (hanya di memori; hilang saat restart). `/lokal baru` melupakannya, dan `/baru` di Telegram ikut mengosongkannya. Tidak ada pencarian web dan tidak ada dokumen di sini: untuk dokumen pakai `/dokumen`, untuk info terbaru pakai obrolan biasa. Model lokal bisa keliru, jadi untuk angka/peraturan resmi tetap cek ke dokumen.

**`/catatan <kata>`** mencari catatan yang memuat semua kata itu (tak peduli huruf besar-kecil), contoh `/catatan maju sjph`. Nomor di hasil sama dengan nomor di daftar lengkap, jadi bisa langsung `/lupa <nomor>`.

### Membuat dan mengelola skill dari Telegram

Selain membuat file `.md` sendiri, skill bisa dibuat langsung dari Telegram (butuh `OPS_ENABLED=true`, karena perubahan lewat konfirmasi yang sama dengan perintah laptop):

```
/skill baru notulen-rapat
deskripsi: Ubah catatan rapat jadi notulen rapi
dokumen: tidak
suhu: 0.3
Ubah catatan rapat menjadi notulen dengan bagian Peserta, Pokok Bahasan, Keputusan, dan Tindak Lanjut. Jangan menambah keputusan yang tidak disebut.
```

Baris pertama setelah `baru` adalah nama skill. Baris-baris pembuka `deskripsi:`, `dokumen:` (ya/tidak), `catatan:` (ya/tidak), dan `suhu:` bersifat opsional dan harus berada paling atas; sisanya adalah instruksi untuk model. Pindah baris di Telegram dengan Shift+Enter. Bot menampilkan pratinjau lalu meminta `/ya <kode>`. Perintah lain: `/skill lihat <nama>` (menampilkan isi, tanpa konfirmasi) dan `/skill hapus <nama>` (konfirmasi, nama harus persis). Menimpa atau menghapus tidak menghilangkan isi lama: salinannya disimpan di `wa-bot/skills/.terhapus/` (30 terbaru). Nama skill hanya huruf kecil, angka, dan tanda minus (maks 40); `baru`, `lihat`, `hapus` tidak bisa dipakai sebagai nama; maksimal 60 skill. Tidak bisa lewat pesan suara, dan perubahan hanya dari Telegram (WhatsApp hanya `/skill`, `/skill lihat`, dan menjalankan skill). Semua perubahan tercatat di `ops-audit.log`.

## Pasar pagi: IHSG, emas, dan kurs (`/pasar`)

Tiap pagi di hari kerja (bawaan 07:30 sesuai `WA_TIMEZONE`, Senin sampai Jumat) bot mengirim ke WhatsApp dan Telegram pemilik: IHSG, harga emas dunia (US$/oz dan perkiraan Rp/gram), dan kurs USD/IDR, masing-masing dengan selisih dari penutupan sebelumnya. **`/pasar`** (alias `/emas`, `/ihsg`) menampilkannya kapan saja, di Telegram dan WhatsApp (chat pribadi).

- **Sumber (berlapis, tanpa API key dan tanpa biaya):** tiap data punya sumber cadangan. IHSG: Yahoo Finance, lalu Stooq (butuh API key gratis, lihat di bawah), lalu halaman Google Finance (COMPOSITE:IDX). Emas dunia: xaus.com, lalu Yahoo, lalu Stooq. Kurs USD/IDR: ExchangeRate-API (open.er-api.com, diperbarui harian; wajib menyebut atribusinya, sudah tampil di laporan), lalu Yahoo, lalu Stooq. Bila satu sumber gagal (mis. Yahoo membalas HTTP 429 karena membatasi permintaan), sumber berikutnya dicoba otomatis dan sumber yang terakhir berhasil dicoba lebih dulu. Permintaan ke Yahoo diantre dengan jeda dan hasil disimpan 5 menit supaya tidak memicu pembatasan. Semuanya sumber tidak resmi, jadi bisa berubah atau sesekali tertunda. Bila satu bagian gagal dibaca, bagian itu ditulis "data tidak terbaca (alasan tiap sumber)" dan sisanya tetap tampil; angka tidak pernah ditebak. Angka yang tidak masuk akal ditolak.
- **Stooq API key:** sejak April 2026 Stooq mewajibkan key. Buka `https://stooq.com/q/d/?s=^jci&get_apikey` di browser, isi captcha, lalu salin nilai `apikey=` dari tautan CSV di bagian bawah halaman ke `MARKET_STOOQ_APIKEY` di `.env`. Tanpa key, Stooq dilewati. Google Finance dibaca dari halaman webnya (tanpa key), jadi bisa rusak bila Google mengubah tampilannya; sumber ini tidak menyebut waktu data, dan laporan memberi tahu hal itu.
- **`/pasar tes`:** mencoba SEMUA sumber satu per satu dan menampilkan OK/GAGAL beserta alasannya. Pakai ini bila ada bagian yang "tidak terbaca", lalu kirim hasilnya agar sumbernya bisa diganti.
- **Selisih:** xaus.com dan ExchangeRate-API tidak memberi "penutupan sebelumnya". Untuk emas dan kurs, selisih dihitung terhadap angka laporan terakhir (disimpan di `bot_state`) dan diberi keterangan tanggalnya.
- **Tanggal data:** tiap laporan menyebut tanggal penutupan terakhir IHSG; bila lebih dari 4 hari lalu diberi peringatan (libur panjang atau data tertunda). Di pagi hari yang IHSG-nya belum buka, angka yang tampil adalah penutupan hari bursa sebelumnya.
- **Ketahanan:** bila semua sumber gagal, dicoba lagi tiap 30 menit (maks 3 kali) lalu dikirim satu pemberitahuan gagal. Bila bot baru menyala lewat 180 menit dari jam kirim, hari itu dilewati. Status "sudah terkirim hari ini" disimpan di `bot_state`, jadi restart tidak mengirim dua kali.
- **Privasi:** hanya meminta data pasar ke sumber di atas (alamat IP laptop terlihat oleh mereka seperti pengunjung biasa); tidak ada data pribadi yang dikirim.

Pengaturan di bagian 17 `.env.example`: `MARKET_BRIEF_ENABLED`, `MARKET_BRIEF_TIME`, `MARKET_BRIEF_DAYS`, `MARKET_BRIEF_LATE_MIN`, simbol Yahoo/Stooq, dan batas waktu. Untuk mematikan kiriman otomatis: `MARKET_BRIEF_ENABLED=false` (`/pasar` tetap bisa dipakai).

## Pengingat pribadi (`/ingatkan`, `/pengingat`)

Pengingat yang dikirim ke WhatsApp **dan** Telegram pemilik pada waktunya. Disimpan di SQLite lokal (`wa-bot/pengingat.sqlite`, tidak ikut Git), tanpa AI dan tanpa layanan luar.

```
/ingatkan 30 menit lagi cek oven
/ingatkan besok 09:00 kirim SPJ
/ingatkan jumat jam 14.30 rapat
/ingatkan 25 okt 08:00 bayar pajak
/ingatkan tiap tanggal 25 jam 08:00 laporan bulanan
/ingatkan tiap senin 07:30 apel
/ingatkan tiap hari 21:00 kunci pintu
/pengingat                 daftar (tiap pengingat punya nomor)
/pengingat batal 3         batalkan satu     |   /pengingat batal semua
```

- **Waktu** mengikuti `WA_TIMEZONE`. Jam tidak disebut = 08:00 (balasan bot menyebutnya terus terang). "pagi/siang/sore/malam" tanpa jam = 07:00/12:00/16:00/20:00; "jam 9 malam" = 21:00. Tanggal tanpa tahun yang sudah lewat dianggap tahun depan; tanggal 29-31 untuk jadwal bulanan jatuh di akhir bulan pada bulan yang lebih pendek.
- **Bot mati saat waktunya:** begitu menyala, pengingat yang terlewat tetap dikirim dengan keterangan "terlambat". Pengingat berulang yang terlewat beberapa kali dikirim sekali, lalu lanjut ke jadwal berikutnya.
- **Kirim gagal** (WhatsApp putus dan Telegram juga tidak bisa): pengingat tidak hilang, dicoba lagi tiap 2 menit.
- **Batas:** 100 pengingat aktif, 200 huruf per pengingat, paling jauh sekitar 400 hari ke depan. Teks yang tampak seperti rahasia (key, kata sandi, PIN, nomor kartu) ditolak karena pengingat dikirim lewat WhatsApp/Telegram.
- Hanya pemilik (Telegram: id pemilik; WhatsApp: nomor pemilik, bukan grup). Pengaturan: bagian 18 `.env.example`.

## Pengingat ibadah (`/ibadah`): juz harian, hadits, ayat

Dikirim ke WhatsApp **dan** Telegram pemilik. Pengaturan di SQLite lokal (`wa-bot/ibadah.sqlite`, tidak ikut Git, ikut dicadangkan). Sebelum dinyalakan bot tidak mengirim apa pun.

```
/ingatkan setiap hari jam 7 pagi 12 siang dan jam 6 sore untuk membaca al quran, hari ini juz 2
/ibadah mulai juz 2          nyalakan semua (Al-Qur'an, hadits, ayat)
/ibadah juz 5                hari ini juz 5, besok juz 6, dst
/ibadah jam quran 07:00 12:00 18:00     /ibadah jam hadits 05:30     /ibadah jam ayat 06:00
/ibadah quran mati|aktif     /ibadah hadits mati|aktif     /ibadah ayat mati|aktif
/ibadah                      status      |   /ibadah mati   matikan semua   |   /ibadah tes   kirim contoh sekarang
```

- **Al-Qur'an:** beberapa kali sehari (bawaan 07:00, 12:00, 18:00), pesannya "Baca Al-Qur'an hari ini: juz N". Juz **dihitung dari tanggal** (naik 1 tiap hari, setelah juz 30 kembali ke juz 1), jadi tidak meleset walau bot mati beberapa hari.
- **Hadits harian** (bawaan 05:30): satu hadits dari **Arbain Nawawi** (42 hadits, berurutan lalu berputar): teks Arab, arti, dan takhrij dari data, plus **penjelasan ringkas yang disusun AI** (diberi label dan diminta dicek ke kitab syarah; disimpan sehingga AI hanya dipanggil sekali per hadits). Bila AI tidak tersedia, hadits tetap terkirim tanpa penjelasan. Catatan: Arbain memuat hadits shahih dan sebagian hasan; derajatnya terbaca di baris takhrij.
- **Ayat harian** (bawaan 06:00): satu ayat dengan Arab, arti, dan **tafsir ringkas Kemenag**. Urutannya acak tetap sehingga seluruh ayat terbaca (sekitar 6.150 hari) sebelum ada yang berulang; 83 ayat yang tafsirnya sangat panjang dilewati.
- **Teks Arab, arti, dan tafsir tidak pernah ditulis AI.** Semuanya dari berkas di `wa-bot/ibadah-data/` (Kemenag RI lewat paket npm `quran-kemenag`; hadits lewat paket `arbain-id`, keduanya berlisensi ISC) dan bisa dipakai tanpa internet.
- **Bot mati saat waktunya:** begitu menyala, pengingat yang baru terlewat dikirim dengan keterangan "terlambat" (Al-Qur'an sampai 4 jam, hadits/ayat sampai 6 jam); yang sudah jauh terlewat dilewati agar tidak masuk siang bolong. Kirim gagal dicoba lagi tiap 2 menit; tidak pernah terkirim ganda.
- Pengingat biasa seperti `/ingatkan tiap hari 21:00 kunci pintu` tidak terpengaruh: hanya kalimat yang memuat "tiap/setiap hari", "al quran", dan "juz N" yang dianggap pengingat ibadah.
- Mematikan fitur sepenuhnya: `IBADAH_ENABLED=false` (`.env.example`).

## Cadangan otomatis (`/cadangan`)

Tiap hari (bawaan 02:30) bot menyalin data yang **hanya ada di laptop** ke folder bertanggal, lalu menghapus yang lebih lama dari 7 cadangan terakhir.

| Yang dicadangkan | Catatan |
| --- | --- |
| `memori.sqlite` (catatan `/ingat`) dan `pengingat.sqlite` | disalin dengan `VACUUM INTO` (konsisten walau bot sedang menulis), lalu diperiksa integritasnya |
| `skills/` | resep skill (.md) |
| `auth_session/` | sesi WhatsApp; tanpa ini harus pairing ulang. `creds.json` diperiksa utuh; kalau terbaca setengah ditulis, disalin ulang |
| `.env` | **hanya** bila `BACKUP_INCLUDE_ENV=true` (berisi key rahasia) |

- **Perintah:** `/cadangan` (status dan daftar), `/cadangan sekarang` (buat sekarang). Di Telegram dan WhatsApp pemilik.
- **Aman:** disalin ke folder sementara dulu, baru diganti nama bila SEMUA sumber berhasil. Bila ada yang gagal, cadangan lama tidak disentuh dan kamu dikabari (setelah 3 percobaan, selang 30 menit). Rotasi hanya menghapus folder berpola tanggal yang berisi `manifest.json` di dalam folder cadangan. Folder dibuat 0700.
- **Lokasi:** bawaan `~/cadangan-ayyubi`. Disk yang sama melindungi dari berkas rusak atau terhapus, **bukan** dari disk rusak/laptop hilang; arahkan `BACKUP_DIR` ke disk eksternal atau folder yang disinkronkan bila bisa. Folder ini berisi sesi WhatsApp: jangan dibagikan dan jangan masuk Git (bot memperingatkan bila folder ada di dalam proyek).
- **Tidak bergantung pada Supabase:** penanda "sudah dicadangkan hari ini" dibaca dari isi folder. Bot baru menyala lewat jam cadangan dan belum ada cadangan hari itu -> langsung dibuat.

### Memulihkan dari cadangan (manual, sengaja tidak otomatis)

```bash
pm2 stop wa-bot
cd ~/ringkasan_harian/wa-bot
B=~/cadangan-ayyubi/2026-10-14_0230          # pilih folder cadangan yang diinginkan
cp "$B/memori.sqlite" memori.sqlite           # catatan
cp "$B/pengingat.sqlite" pengingat.sqlite     # pengingat
rm -f memori.sqlite-wal memori.sqlite-shm pengingat.sqlite-wal pengingat.sqlite-shm
cp -r "$B/skills/." skills/                   # skill
rm -rf auth_session && cp -r "$B/auth_session" auth_session   # sesi WhatsApp
pm2 start wa-bot
```

Pulihkan hanya bagian yang diperlukan. Memulihkan `auth_session` memakai sesi lama: bila WhatsApp sudah mencabut tautan perangkat itu, bot tetap minta pairing ulang.

## Penjaga kesehatan bot (`/kesehatan`)

Bot memeriksa dirinya sendiri tiap 5 menit dan mengabari pemilik (WhatsApp + Telegram) **sekali** saat ada masalah dan **sekali** saat pulih. Tanpa AI dan tanpa layanan luar.

| Yang diperiksa | Dianggap bermasalah bila | Dilaporkan |
| --- | --- | --- |
| Ollama | `GET /api/version` tidak menjawab | setelah 2 kali berturut-turut |
| Disk (folder bot dan folder cadangan) | sisa ruang < `HEALTH_DISK_MIN_GB` (3) | langsung |
| Memori | RAM tersedia < `HEALTH_MEM_MIN_MB` (300) | setelah 3 kali berturut-turut |
| WhatsApp | tidak tersambung > `HEALTH_WA_DOWN_MIN` (10) menit, mis. sesi dicabut dari HP | langsung |
| Basis data (Supabase) | tidak terjangkau (internet putus / layanan bermasalah) | setelah 3 kali berturut-turut |
| Restart | bot menyala >= `HEALTH_RESTARTS` (5) kali dalam 15 menit (crash loop) | langsung |
| Cadangan | cadangan terakhir > 36 jam padahal cadangan otomatis aktif | langsung |

- **`/kesehatan`** (alias `/sehat`, `/health`) menjalankan semua pemeriksaan sekarang dan menampilkan papan status ✅/⚠️ beserta saran. Perintah ini tidak memicu peringatan dan tidak mengubah hitungan.
- **Anti-berisik:** masalah yang sama tidak diulang, kecuali masih ada setelah 6 jam; beberapa masalah dalam satu putaran digabung jadi satu pesan; gagal sesekali (tidak berturut-turut) diabaikan. Bila pesan gagal terkirim (WhatsApp dan Telegram sama-sama putus), peringatan dicoba lagi di putaran berikutnya.
- **Pemeriksaan pertama** 90 detik setelah bot menyala, supaya WhatsApp/Telegram sempat tersambung.
- **Restart** dihitung dari berkas kecil `wa-bot/.health-starts.json` (tidak ikut Git). Memasang patch dan `/restart` berkali-kali dalam 15 menit bisa memicu peringatan ini; itu wajar, abaikan.
- Bila WhatsApp putus lama, peringatan tetap sampai lewat Telegram.
- Pengaturan: bagian 20 `.env.example`. Matikan satu pemeriksaan Ollama dengan `HEALTH_OLLAMA=false`, atau seluruhnya dengan `HEALTH_ENABLED=false` (`/kesehatan` tetap bisa dipakai).

## Urutan AI untuk balasan WhatsApp & grup (`/urutan`)

Balasan WhatsApp (chat pribadi dan grup) memakai **dua jalur**, tergantung pesannya:

| Jalur | Dipakai untuk | Urutan bawaan |
| --- | --- | --- |
| **santai** | obrolan biasa: tanpa angka, aturan, dokumen, atau pencarian web | Groq → Gemini → OpenRouter → Ollama |
| **akurat** | pertanyaan angka/tarif/aturan, yang menemukan potongan dokumen, grup dengan dokumen terkunci, atau yang butuh internet | Gemini → Groq → OpenRouter → Ollama |

- Tiap penyedia **dihabiskan dulu** sebelum pindah: Gemini merotasi semua key-nya (lalu model cadangan), Groq/OpenRouter merotasi key dan model di dalamnya. Penyedia yang sudah diketahui habis dilewati seketika, tanpa menunggu.
- **Ollama selalu di ujung** dan tetap hanya menjawab pertanyaan tanpa angka/aturan (model 3B mudah mengarang angka). Ollama juga dicoba bila semua penyedia internet macet atau jaringan putus.
- Penyedia yang belum punya key di `.env` otomatis dilewati. `/urutan` menandai mana yang belum aktif.
- **Tidak perlu menyentuh `.env`.** Urutan diubah dari Telegram atau WhatsApp (chat pribadi pemilik) dan disimpan di tabel `bot_state` (kunci `ai_route`), jadi bertahan setelah restart:
  - `/urutan` — lihat urutan sekarang
  - `/urutan santai groq,gemini,openrouter,ollama`
  - `/urutan akurat gemini,groq,openrouter` — tanpa `ollama` = jalur itu tanpa cadangan lokal
  - `/urutan semua gemini,groq` — dua jalur sekaligus
  - `/urutan reset` — kembali ke bawaan
- Ringkasan harian, pantauan peraturan, dan chat Telegram tidak ikut jalur ini: tetap Gemini dulu, lalu cadangan sesuai `LLM_FALLBACK_ORDER`.

**Batas waktu.** Panggilan Gemini untuk balasan WA kini punya batas **25 detik** (sebelumnya tanpa batas, sehingga jaringan buruk bisa membuat balasan menggantung berpuluh detik sampai menit); tugas lain 90 detik. Groq/OpenRouter di jalur ini dibatasi 20 detik per percobaan dan 3 percobaan. Jatah harian (429 "PerDay") tidak lagi diulang 3 detik kemudian di key yang sama; langsung pindah key. Opsional di `.env`: `GEMINI_WA_TIMEOUT_MS` dan `GEMINI_TIMEOUT_MS` (milidetik).

**Membaca log.** Tiap balasan mencatat penyedia dan lamanya, mis. `⏱️ [AI] dijawab groq/llama-3.3-70b-versatile dalam 1.4 dtk (santai: groq > gemini > openrouter)`; kegagalan sebuah penyedia tercatat `⏭️ [AI] gemini gagal dalam 25.0 dtk: … -> lanjut groq`. Dari sini terlihat penyedia mana yang lambat.

## Konsep Nota Dinas LPJ Bendahara tiap tanggal 1 (`/nodin`)

Nota Dinas "Penyampaian Laporan Pertanggungjawaban Bendahara Pengeluaran" hanya berganti nama **bulan** (dan tahun). Bot membuatnya dari templat Word `templates/nota-dinas-lpj.docx`:

- `[Bulan_Laporan]` dan `[Tahun_Laporan]` diisi bot dengan **bulan sebelum tanggal surat** (surat 1 November → Oktober; surat 1 Januari → Desember tahun lalu).
- `[Nomor_ND]` dan `[Tanggal_ND]` **sengaja dibiarkan**: diisi sistem persuratan saat naskah dibuat. QR tanda tangan juga dibuat sistem persuratan, jadi tidak ada di konsep.
- Tiap tanggal 1 pukul 07.00 (zona `WA_TIMEZONE`) bot mengirim **PDF + Word** ke WhatsApp dan Telegram pemilik. Hanya sekali per bulan laporan (penanda `nodin_last` di tabel `bot_state`). Bila bot mati pada tanggal 1, dikejar sampai tanggal 5. Gagal 3 kali dalam sehari → kamu dikabari.
- Kapan saja: `/nodin` (bulan lalu), `/nodin november`, `/nodin oktober 2026`, `/nodin status`, dan `/nodin cek` (memeriksa LibreOffice di laptop dan menjelaskan kalau PDF gagal dibuat) — semuanya dari WhatsApp maupun Telegram.

PDF dibuat LibreOffice tanpa tampilan. Pasang sekali di laptop: `sudo apt install libreoffice-writer`, lalu cek `soffice --version`. Tanpa LibreOffice bot tetap mengirim Word (kamu ekspor PDF sendiri) dan memberi tahu alasannya.

**Mengganti isi surat:** buka `templates/nota-dinas-lpj.docx` di Word/LibreOffice, ubah kalimatnya, simpan dengan tetap memuat `[Bulan_Laporan]` dan `[Tahun_Laporan]` (ketik utuh, jangan disisipi format di tengahnya). Atau taruh templat lain dan isi `NODIN_TEMPLATE` di `.env`. Pengaturan lain ada di bagian 22 `.env.example`. Perubahan templat sebaiknya lewat patch/`/deploy` agar tidak tertimpa.

## Laporan kas bulanan (`/kas`): Laporan Saldo Rekening + Register Penutupan Kas

Dua laporan yang dibuat tiap awal bulan, satu berkas dua halaman (halaman 1 Laporan Saldo Rekening mendatar, halaman 2 Register Penutupan Kas tegak), meniru PDF dari sistem persuratan. QR tanda tangan tidak dibuat (ditambahkan sistem persuratan di atas tulisan "Ditandatangani secara elektronik").

**Alur tiap awal bulan**

1. Tanggal 1 pukul 07.10 bot mengirim **rancangan** bulan lalu ke WhatsApp + Telegram. Saldo awal = saldo buku bulan sebelumnya; daftar rekening, pejabat, dan tanggal ikut terbawa.
2. Kamu mengisi yang berubah: `/kas terima 157509115 keluar 165717883`, saldo rekening lain `/kas rek2 1771352342`. Boleh sekaligus dalam satu pesan; angka boleh bertitik (`157.509.115`). Bot langsung menghitung saldo buku (A), saldo kas (B), dan selisih.
3. `/kas submit`: data **disimpan permanen** (tabel `bot_state`, kunci `kas_rec_YYYY-MM`) lalu PDF + Word dikirim.
4. Belum disubmit? Bot mengingatkan sekali sehari. Bulan berikutnya baru dibuat setelah bulan ini disubmit, supaya rantai saldo awal tidak bolong (bulan yang terlewat diisi berurutan).

**Aturan hitung**

- Saldo buku (A) = saldo awal + penerimaan − pengeluaran. Saldo kas (B) = uang tunai + saldo rekening 1 (BPG, "kertas berharga dan bagian kas lainnya"). Selisih = A − B.
- Saldo rekening 1 otomatis = saldo buku bila tidak diisi (selisih 0). Kalau saldo bank sebenarnya berbeda, isi `/kas rek1 <saldo>`; selisih ≠ 0 diberi tanda ⚠️.
- Rekening lain: saldo dan tanggal transaksi terakhir sama dengan bulan lalu kecuali diisi. Tanggal transaksi terakhir rekening yang saldonya berubah otomatis = tanggal penutupan.
- Data awal (September 2026) diambil dari PDF contoh sebagai titik mulai rantai.

**Perintah**

| Perintah | Fungsi |
|---|---|
| `/kas` | rancangan aktif (atau data terakhir) + cara mengisi |
| `/kas terima … keluar … rek2 … tgl2 31-10-2026 tunai 100000=2 penjelasan … awal …` | isi rancangan |
| `/kas pratinjau` | PDF + Word dari rancangan (belum disimpan) |
| `/kas submit` | simpan + buat dokumen |
| `/kas ulang` | kosongkan isian rancangan |
| `/kas daftar`, `/kas lihat september`, `/kas dokumen september` | panggil data tersimpan (angka / PDF + Word) |
| `/kas ubah september keluar 165717883` | perbaiki bulan lama; bot memberi tahu bila saldo awal bulan sesudahnya jadi tidak sinkron (`/kas ubah oktober awal auto` memperbaikinya) |
| `/kas kpa …`, `/kas nipkpa …`, `/kas bendahara …`, `/kas nipbend …` | ganti pejabat (berlaku dari rancangan itu dan bulan-bulan sesudahnya) |
| `/kas mulai`, `/kas status`, `/kas bantuan` | buat rancangan manual, jadwal, bantuan |

Pengaturan opsional ada di bagian 23 `.env.example` (`KAS_DAY`, `KAS_TIME`, `KAS_PDF`, `KAS_ENABLED`). Daftar rekening mengikuti data bulan lalu; rekening baru/ditutup belum punya perintah sendiri (bilang saja, akan ditambahkan).

## Balasan suara di grup WhatsApp (`/voice wag on|off`)

Diatur dari Telegram (hanya pemilik):

| Perintah | Fungsi |
|---|---|
| `/voice` | lihat pengaturan suara (grup WhatsApp + Telegram) |
| `/voice wag on` | balasan bot di grup berupa **voice note saja** (tanpa teks / transkrip) |
| `/voice wag off` | balasan grup kembali **teks** (bawaan) |
| `/voice tg auto\|on\|off` | sama dengan `/suara` (balasan suara di Telegram) |

- Pengaturan disimpan di tabel `bot_state` (kunci `wa_group_voice`), jadi bertahan setelah restart dan berlaku untuk semua grup yang diizinkan.
- Syarat: `GEMINI_API_KEYS` terisi dan `ffmpeg` terpasang (`sudo apt install ffmpeg`), sama dengan balasan suara Telegram.
- Tetap dikirim sebagai **teks** bila jawabannya memuat tautan, blok kode, atau tabel; lebih panjang dari `WA_GROUP_VOICE_MAX_CHARS`; atau suara gagal dibuat (ffmpeg belum ada, kuota habis, terlalu lama). Jawaban tidak pernah hilang, dan kamu dikabari sekali di Telegram/WhatsApp bila penyebabnya ffmpeg atau kuota.
- Riwayat percakapan tetap menyimpan teks jawaban (bukan suara), sehingga balasan terhadap voice note bot tetap dikenali.
- Pengaturan opsional ada di bagian 24 `.env.example`.

## Nomor WhatsApp kedua (`WA2_*`, `/wa2`)

Satu bot bisa memegang **dua nomor WhatsApp**. Nomor utama jalan seperti biasa; nomor kedua adalah sesi terpisah (folder `auth_session_2/`) yang membalas chat dan grup dengan AI yang sama. Mati bawaan: baru aktif bila `WA2_NUMBER` (atau `WA2_ENABLED=true`) diisi di `.env`.

**Memasang**

1. Jalankan migrasi database **sekali** (menambah kolom `account` di `whatsapp_messages`): Telegram `/migrasi terapkan`, atau salin isi `supabase/migrations/0039_whatsapp_account.sql` ke Supabase SQL Editor.
2. Isi `.env` (lihat bagian 25 `.env.example`), minimal `WA2_NUMBER=0812xxxxxxx`, lalu `/restart`.
3. Bot mengirim **kode tautan** 8 huruf ke WhatsApp + Telegram kamu. Teruskan ke pemegang HP nomor kedua: WhatsApp → Perangkat Tertaut → Tautkan Perangkat → *Tautkan dengan nomor telepon* → masukkan kode. Kode berlaku beberapa menit; minta lagi dengan `/wa2 kode`. Tanpa `WA2_NUMBER`, bot menampilkan QR di log (`pm2 logs`). Kalau kode tidak dimasukkan tepat waktu, bot membersihkan sesi setengah jadi itu sendiri (tidak perlu menghapus folder), berhenti menyambung, dan menunggu `/wa2 kode`.
3b. **Cara lain bila kode ditolak HP:** kirim `/wa2 qr`. Bot mengirim gambar QR ke Telegram; pemegang HP nomor 2 memindainya dari HP/laptop lain (WhatsApp → Perangkat Tertaut → Tautkan Perangkat). QR berlaku ±1 menit; kirim `/wa2 qr` lagi untuk gambar baru.
4. `/wa2` menampilkan status; `/status` ikut menampilkan nomor kedua.

**Aturan nomor kedua** (karena HP-nya dipegang orang lain)

- Perintah pemilik (`/kas`, `/nodin`, `/dokumen`, `simab …`, dll.) hanya dari nomor pemilik (`WA_OWNER_NUMBER`) atau Telegram. Chat-ke-diri-sendiri di nomor kedua **diabaikan**, jadi pemegang HP-nya tidak bisa membuka data kamu lewat bot.
- Notifikasi bot untuk kamu tetap lewat nomor utama dan Telegram, tidak pernah dari nomor kedua.
- Di grup, nomor kedua hanya menjawab grup di `WA2_GROUP_ALLOWED_NAMES` / `WA2_GROUP_ALLOWED_JIDS` (kosong = tidak menjawab di grup).
- Chat nomor kedua **tidak** ikut ringkasan harian ke kamu kecuali `WA2_IN_SUMMARY=true`.
- Balasan manual dari pemegang HP menjeda AI untuk kontak itu (sama seperti nomor utama). Balasan dari aplikasi Ayyubi ke kontak nomor kedua dikirim lewat nomor kedua.
- Riwayat kedua nomor tampil di aplikasi Ayyubi milikmu; pemegang HP nomor kedua sebaiknya tahu bahwa bot membaca dan membalas chat di nomornya.
- `/voice wag on|off`, daftar dokumen pengetahuan, dan pengaturan AI berlaku sama untuk kedua nomor.

## Mengatur grup yang dijawab dari Telegram (`/grup`)

Tidak perlu membuka `.env` di laptop untuk menambah grup. Perubahan tersimpan di database dan **langsung berlaku tanpa restart**.

| Perintah | Fungsi |
|---|---|
| `/grup` | daftar grup yang dijawab tiap nomor (bernomor) |
| `/grup semua` | grup yang diikuti nomor utama (bernomor, ✅ = sudah dijawab) |
| `/grup tambah <nomor>` | izinkan grup dengan nomor dari `/grup semua` (paling teliti: disimpan sebagai id grup) |
| `/grup tambah <nama>` | izinkan grup yang namanya memuat potongan nama itu (minimal 3 huruf/angka; huruf besar-kecil, emoji, tanda baca diabaikan) |
| `/grup hapus <nomor atau nama>` | cabut izin yang ditambahkan lewat `/grup` (nomor dari `/grup`) |

Untuk nomor kedua tambahkan kata `wa2` (atau nama botnya, mis. `wongsobot`) setelah perintah: `/grup semua wa2`, `/grup tambah wa2 Pengajian`, `/grup wa2`.

Grup yang sudah ada di `.env` (`WA_GROUP_ALLOWED_*`, `WA2_GROUP_ALLOWED_*`) tetap dipakai sebagai daftar dasar dan bertanda `(.env)`; itu hanya bisa dihapus dengan mengubah `.env`. Bila database sedang bermasalah, perubahan ditunda (daftar lama tidak pernah tertimpa).

### Bahasa suara di grup (Indonesia, Inggris, Korea, Arab, Jawa)

Suara dibuat Gemini TTS yang mengenali bahasa dari teks yang dibacakan, jadi yang diatur adalah **bahasa jawabannya**. Dua cara:

- **Pengaturan (Telegram):** `/voice wag kor` (Korea), `/voice wag arb` (Arab), `/voice wag jawa` (Jawa), `/voice wag eng` (Inggris), `/voice wag id` (Indonesia). Memilih bahasa sekaligus menyalakan suara grup bila masih mati. `/voice wag auto` mengembalikan ke otomatis (mengikuti bahasa penanya, bawaan). `/voice` menampilkan pengaturan sekarang. Pengaturan tersimpan dan bertahan setelah restart.
- **Permintaan di chat grup:** anggota grup menulis mis. "bot, jawab pakai bahasa Korea", "balas dalam bahasa Arab", "reply in Arabic", "ngomong pakai bahasa Jawa". Berlaku untuk pesan itu saja dan mengalahkan pengaturan di atas. Pertanyaan terjemahan ("apa bahasa Korea dari terima kasih?") bukan permintaan ganti bahasa.

Hanya voice note, tanpa teks terjemahan. Jawaban yang memuat tautan, kode, tabel, atau terlalu panjang tetap berupa teks (aturan sama dengan `/voice wag on`). Bahasa suara hanya berlaku saat suara grup menyala; saat `/voice wag off`, bot tetap menjawab teks seperti biasa.

Catatan: voice note MASUK di grup (balasan ke pesan bot) dikenali sebagai bahasa Indonesia (`VOICE_LANGUAGE=id`), jadi anggota grup yang membalas dengan voice note berbahasa Korea/Arab belum terbaca dengan baik; mereka bisa mengetik.

## Jawab pakai teks, tabel yang terbaca, dan berkas PDF/Word/Excel (grup & chat)

**Minta teks, bukan suara.** Saat `/voice wag on`, bot biasanya membalas dengan voice note. Tulis di pesan: "bot, buatkan prompt ..., **jawab pakai teks**" (juga: "teks saja", "jangan pakai suara/voice", "tanpa voice", "bukan voice", "reply in text", "text only") maka **pesan itu** dijawab teks. Pesan berikutnya kembali mengikuti `/voice wag` (pengaturan tidak berubah).

**Tabel di gelembung WhatsApp.** WhatsApp tidak punya tabel, jadi tabel dari AI otomatis ditata ulang:
- tabel sempit (lebar total sampai 34 huruf) → blok monospace berkolom rata;
- tabel dua kolom → daftar `• *Istilah* — penjelasan`;
- tabel lebar → "kartu" per baris (judul tebal, lalu `• Kolom: nilai`); kolom "No" dipakai sebagai nomor.

Judul `## ...` menjadi *tebal*, `**x**` menjadi `*x*`, garis `---` dibuang, `[teks](url)` menjadi `teks (url)`. Blok kode tidak diubah. Berlaku untuk balasan teks di grup maupun chat pribadi.

**Jadikan PDF / Word / Excel (khusus grup).**
- `bot, jelaskan alur sertifikasi halal dalam bentuk PDF` (atau `... dalam bentuk Word`, `... dalam bentuk Excel`) → AI menjawab, lalu bot mengirim berkasnya (bukan teks/suara).
- Balas (reply) sebuah jawaban bot dengan `bot, jadikan pdf` / `bot, jadikan word` / `bot, jadikan excel` → jawaban itu diubah jadi berkas tanpa memanggil AI lagi (bot mengingat 80 jawaban terakhir sejak ia menyala; untuk jawaban lama, tulis ulang pertanyaannya).
- **PDF**: A4 dengan judul, daftar, tabel sungguhan (judul kolom diulang tiap halaman), blok kode, nomor halaman. Hanya huruf Latin (emoji dibuang, Arab/Korea tampil `?`).
- **Word (.docx)**: judul/heading bergaya, daftar, tabel Word sungguhan (halaman otomatis mendatar bila tabel 6 kolom atau lebih). Huruf Arab/Korea dan emoji tetap utuh.
- **Excel (.xlsx)**: tiap tabel menjadi satu lembar (nama lembar dari judul di atas tabel), judul kolom dibekukan. Angka murni (`1250`, `1.250`, `3,5`, `1,234.50`) disimpan sebagai ANGKA; yang berawalan nol (`0812...`, NIK), memakai `Rp`/`%`, tanggal, atau berbentuk rumus (`=A1`) tetap TEKS (tidak pernah dijalankan sebagai rumus). Jawaban tanpa tabel masuk lembar "Teks".
- Sapaan pembuka ("Halo <nama>!") dan promosi perintah bot di ujung jawaban dibuang otomatis dari isi berkas; tabel yang digambar AI dengan karakter `===`/`|` di dalam blok kode diubah menjadi tabel sungguhan. Judul berkas diambil dari judul jawaban, kalau tidak ada dari permintaan penanya.
- Bila berkas gagal dibuat, jawabannya tetap dikirim sebagai teks.
- Kalimat yang bukan perintah membuat berkas ("apa itu pdf", "cara bikin rumus di excel", "baca pdf ini", "kirim pdf peraturan PMK 62") tidak memicu fitur ini.
- Jatah: `WA_GROUP_FILE_MAX_PER_DAY` berkas per orang per hari (bawaan 10; 0 = tanpa batas; hitungan kembali nol saat bot di-restart).

**Ubah PDF yang dibagikan di grup menjadi Excel/Word.** Ada yang membagikan PDF di grup? Balas (reply) file PDF itu dengan `bot, convert ke excel` atau `bot, jadikan word` (atau kirim PDF dengan keterangan `bot, convert ke excel`).
- Dibaca dengan `pdftotext` (sudah dipakai Dokumen Pengetahuan; di Ubuntu: `sudo apt install poppler-utils`). Tidak memakai AI, jadi isi tidak diubah-ubah; tabel dikenali dari kolom yang rata, tabel yang terpotong antar halaman digabung, nomor halaman/judul berulang dibuang.
- Batas: PDF **berisi teks** (bukan hasil scan/foto), maksimal 15 MB, 60 halaman pertama. PDF hasil scan dijawab dengan penjelasan (belum ada OCR). Tabel tanpa garis dengan kolom sangat rapat atau sel yang bergabung bisa meleset: bot selalu menulis di keterangan "Mohon dicek ulang". Satu konversi diproses satu per satu agar laptop tidak berat.
- Hanya file PDF yang bisa dikonversi; file lain dijawab "baru PDF yang bisa".

**Ubah ISI PDF/Word yang dibagikan di grup.** Balas (reply) file Word atau PDF-nya (atau kirim file dengan keterangan) dengan perintah:
- **Ganti kata:** `bot, ganti "PT Maju" jadi "PT Makmur"` (boleh beberapa: `ganti "A" jadi "B" dan ganti "C" jadi "D"`). Untuk **Word (.docx)** kata diganti **langsung di dalam berkas**, jadi huruf, tabel, header/footer, dan format aslinya utuh; kata yang terbelah beda gaya tetap ketemu. Huruf besar/kecil tidak dipedulikan. Kalau kata tidak ditemukan, bot memberi tahu dan tidak mengirim apa-apa.
- **Perintah AI:** `bot, perbaiki kalimatnya`, `bot, ringkas jadi satu halaman`, `bot, tulis ulang dengan bahasa formal`, `bot, terjemahkan ke bahasa Inggris`. AI membaca isi dokumen lalu menulis ulang, dan hasilnya dikirim sebagai berkas baru. Maksimal ± 14.000 karakter (kira-kira 5-6 halaman); lebih panjang dijawab dengan penjelasan.
- **PDF + ganti kata (`pdf-overlay.js`):** kata lama **ditutup kotak putih** lalu kata baru ditulis di atasnya, jadi logo, QR code, tabel, dan tata letak asli **tetap utuh** (halaman lain tidak disentuh sama sekali; perubahan ditulis sebagai pembaruan di akhir berkas). Posisi kata dibaca dengan `pdftotext -bbox-layout`, jenis/ukuran/warna huruf dengan `pdftohtml -xml` (paket `poppler-utils`); huruf pengganti memakai huruf standar PDF yang paling mirip (Helvetica/Times/Courier), dikecilkan seperlunya agar muat (minimal 60%), dan tetap di tengah bila kata lama memang sendirian di tengah halaman. Batasan yang selalu ditulis di keterangan: kata lama **hanya tertutup** (masih bisa ditemukan lewat pencarian/salin teks, jadi bukan untuk menyembunyikan data rahasia), hurufnya mirip tapi tidak persis, dan latar berwarna akan tampak kotak putih. Mengedit ulang kata yang baru saja diganti sebaiknya dari file aslinya.
- **PDF bertanda tangan elektronik** (ada `/ByteRange` atau tulisan "ditandatangani secara elektronik"/BSrE/TTE): setiap halaman otomatis diberi **cap merah "REVISI - bukan dokumen asli..."** di bagian atas, ditambah peringatan di keterangan.
- **Cadangan:** bila kata tidak bisa ditimpa (PDF terenkripsi/diputar/strukturnya aneh, kata terbagi dua baris, teks pengganti jauh lebih panjang dari ruang di tengah kalimat), bot memakai cara lama: isi dibaca, diubah, lalu dikirim sebagai **PDF/Word baru** (tata letak asli tidak ikut), dengan catatan alasannya. Perintah AI (`perbaiki`, `ringkas`) dan hasil dalam bentuk Word juga memakai cara ini. Tambahkan `... dalam bentuk Word` bila mau hasil Word.
- **Pengaman:** berkas asli tidak pernah ditimpa (hasil bernama `<nama> revisi`). Setiap hasil AI diberi peringatan di keterangan bila ada **angka baru atau angka yang hilang** (AI bisa keliru mengubah angka/nama), plus "Mohon dicek ulang". Ganti kata persis (berkutip) tidak memakai AI sama sekali. Dihitung ke jatah berkas harian.
- Format lain (.doc lama, Excel) dijawab dengan penjelasan; PDF hasil scan belum didukung.

Setelah patch: cukup `/restart` (tidak perlu `/rilis`, tidak perlu `npm install`).

## Jadwal kantor di grup (catat, tanya, rekap pagi, pengingat)

Bot di grup bisa **mencatat jadwal**, **menjawab "ada jadwal apa hari ini?"**, **merekap jadwal tiap pagi**, dan **mengingatkan sebelum acara**. Semua dari catatan lokal (`agenda.sqlite`), **tanpa AI dan tanpa biaya**, per grup (jadwal grup A tidak tampil di grup B). Siapa pun di grup boleh mencatat dan menghapus.

| Ketik di grup | Hasil |
|---|---|
| `bot, catat rapat evaluasi Kamis 22 Oktober jam 10.00 di ruang rapat` | dicatat (#nomor); boleh juga `besok`, `lusa`, `senin depan`, `25/10`, `tanggal 3` |
| `bot, jadwalkan apel tiap senin jam 07.30` | jadwal berulang (`tiap hari`, `tiap senin`, `tiap tanggal 25`) |
| balas (reply) pesan jadwal dengan `bot, catat ini` | mencatat dari pesan yang dikutip |
| `bot, ada jadwal apa hari ini?` / `jadwal besok` / `agenda minggu ini` / `minggu depan` / `jadwal kamis` / `jadwal berikutnya` | daftar jadwal grup itu |
| `bot, hapus jadwal 5` · `bot, pindah jadwal 5 ke jumat jam 13.00` | hapus / pindah (hanya jadwal di grup yang sama) |
| `bot, bantuan jadwal` | ringkasan perintah |

- **Tawaran otomatis.** Bot menyimak pola kalimat (tanpa AI, obrolan tidak disimpan). Bila ada kalimat yang jelas berupa pengumuman, mis. "besok rapat koordinasi jam 9 ya", bot bertanya *"Mau saya catat sebagai jadwal?"*; baru **dicatat bila ada yang membalas pesan itu dengan "ya"** ("tidak" / diabaikan = tidak dicatat). Syaratnya ketat: ada kata acara (rapat, apel, bimtek, zoom, dst.) **dan** tanggal **dan** jam; pertanyaan, pembatalan ("dibatalkan", "ditunda"), dan kalimat tanpa jam diabaikan. Maksimal satu tawaran per grup per 90 detik; tawaran kedaluwarsa setelah 6 jam dan hilang bila bot di-restart. Matikan dengan `AGENDA_SUGGEST=false`.
- **Pengumuman berformat.** Undangan panjang berlabel (banyak emoji, boleh ada tanda tanya) juga dikenali bila memuat baris `Hari/Tanggal:` (atau `Tanggal:`) **dan** `Waktu:` (atau `Jam:`), plus kata acara. Judulnya diambil dari baris `Acara:`/`Kegiatan:`/`Perihal:` atau kalimat "untuk acara ...", ditambah `Tempat:`/`Lokasi:`. Cara paling pasti untuk pengumuman yang sudah terkirim: balas (reply) pesannya dengan `bot, catat ini`.
- **Zona waktu.** Bila pesan menulis **WIB/WITA/WIT** (mis. "17.00 WITA") padahal zona bot lain, jam dibaca di zona yang ditulis, ditampilkan dengan zona itu ("17:00 WITA"), dan pengingatnya tetap tepat. Jadwal berulang tidak dikonversi.
- **Rekap pagi.** Tiap hari pukul `AGENDA_MORNING_TIME` (bawaan 07:30) bot mengirim jadwal hari itu ke grup. **Bila hari itu tidak ada jadwal, bot diam.** Bila bot baru menyala siang hari (sebelum 13:00), rekap tetap dikirim satu kali.
- **Pengingat sebelum acara.** `AGENDA_REMIND_BEFORE_MIN` menit (bawaan 30; 0 = mati) sebelum jam acara: "⏰ 25 menit lagi — Rapat anggaran". Hanya untuk acara yang jamnya disebut.
- **Aturan membaca waktu.** Jam tidak disebut = acara *seharian* (masuk rekap pagi, tanpa pengingat jam). "jam 2" tanpa "pagi/siang/sore/malam" dianggap 14.00 (jam 1-6 = siang/sore, 7-11 = pagi). "senin depan" = Senin pekan depan. "tanggal 3" yang sudah lewat bulan ini = bulan depan. Bot **selalu menulis ulang hari, tanggal, dan jam yang ia pahami** di konfirmasi, jadi salah baca langsung terlihat dan bisa dipindah/dihapus. Jadwal sekali yang sudah lewat dibersihkan otomatis setelah 36 jam.
- **Tidak merebut permintaan lain.** "jadwal sholat", "jadwal kereta", "buatkan jadwal piket", atau "apa itu agenda" tetap dijawab AI seperti biasa. Hanya pola seperti "ada jadwal apa hari ini", "jadwal besok", "catat ... jam ..." yang ditangani fitur ini.
- Dikirim dari **nomor yang mencatatnya** (Ayyubi atau nomor kedua), dan hanya ke grup yang masih diizinkan (`/grup`). Ikut cadangan otomatis (`/backup`).
- Pengaturan di `.env`: `AGENDA_ENABLED`, `AGENDA_SUGGEST`, `AGENDA_MORNING_TIME`, `AGENDA_REMIND_BEFORE_MIN`, `AGENDA_MAX_PER_GROUP` (bawaan 200), `AGENDA_FILE`. Butuh Node 22+ (`node:sqlite`, sama seperti Pengingat pribadi).
- Setelah patch: cukup `/restart` (tidak perlu `/rilis`, tidak perlu `npm install`).

## Suara tiap bot (`/suara daftar`, `/suara coba`, `/suara pakai`)

Ayyubi (nomor utama) dan bot nomor kedua (mis. Wongsobot) bisa punya **suara dan gaya bicara sendiri** di balasan suara grup WhatsApp (`/voice wag on`). Contoh: Ayyubi anak laki-laki, Wongsobot bapak-bapak. Semua diatur dari Telegram, tersimpan di `bot_state`, dan **langsung berlaku tanpa restart**.

| Perintah | Fungsi |
|---|---|
| `/suara daftar` | daftar 30 suara Gemini (16 pria, 14 wanita) + pengaturan sekarang |
| `/suara coba Puck anak laki-laki ceria` | kirim CONTOH suara (tidak menyimpan). Tambah `\| teks sendiri` untuk teks contoh: `/suara coba Puck santai \| Halo semuanya` |
| `/suara coba wongsobot` | contoh dengan pengaturan Wongsobot sekarang |
| `/suara pakai ayyubi Puck anak laki-laki ceria` | simpan untuk Ayyubi (langsung dikirim contohnya) |
| `/suara pakai wongsobot Charon bapak-bapak tenang dan berwibawa` | simpan untuk Wongsobot |
| `/suara ayyubi` / `/suara wongsobot` | lihat pengaturan satu bot |
| `/suara reset ayyubi` | kembali ke suara bawaan (Sulafat) |

- **Suara** = nama salah satu suara siap pakai Gemini TTS. **Gaya** = kalimat bebas yang mengarahkan cara bicara (nada, kira-kira usia, tempo), maks 240 huruf. Tanda kutip, kurung siku, dan baris baru dibuang otomatis.
- Gemini **tidak punya suara anak-anak**; "anak laki-laki ceria" hanya mengarahkan gaya pada suara pria yang dipilih, hasilnya bisa terdengar seperti pemuda yang ceria. Dokumentasi Google tidak menjanjikan umur tertentu, jadi dengarkan dulu dengan `/suara coba` sebelum menyimpan.
- Bawaan awal dari `.env` (opsional): `WA_VOICE`, `WA_VOICE_STYLE` (Ayyubi), `WA2_VOICE`, `WA2_VOICE_STYLE` (nomor kedua). Pengaturan dari Telegram menang atas `.env`.
- Berlaku untuk **balasan suara grup WhatsApp**. Balasan suara di Telegram, tutor `/speak`, dan tutor WhatsApp tetap memakai suara bawaan (`TELEGRAM_TTS_VOICE`).
- `/voice` (tanpa argumen) juga menampilkan suara tiap bot. Setiap contoh memakai kuota suara Gemini yang sama dengan balasan biasa.
- Setelah patch: `/restart` (tanpa `/rilis`, tanpa `npm install`).

## Pembuat gambar (`/gambar`, "buatkan gambar ...")

Bot bisa membuat gambar dari deskripsi memakai Gemini ("Nano Banana"), dengan `GEMINI_API_KEYS` yang sama. Tidak ada kunci baru.

- **Grup WhatsApp** (nomor 1 dan nomor 2, hanya grup yang sudah diizinkan): `bot, buatkan gambar kucing memakai topi astronot`. Hasilnya dikirim sebagai gambar (membalas pesan peminta). Saklar dari Telegram: `/gambar grup on|off` (bawaan aktif).
- **Chat WhatsApp pemilik** (chat ke diri sendiri atau chat dengan nomor bot): `buatkan gambar ...` atau `/gambar ...`. Kontak pribadi lain TIDAK bisa meminta gambar.
- **Telegram**: `/gambar <deskripsi>`; `/gambar` saja = status dan sisa jatah.

Batas harian (reset 00.00 WITA, tahan restart): pemilik 30, semua grup 10, per orang di grup 3 (`IMAGE_*` di `.env`; 0 = tanpa batas). Jatah dikembalikan bila pembuatan gagal. Deskripsi konten dewasa atau dokumen/bukti palsu (KTP, kuitansi, stempel, dll.) ditolak sebelum dikirim ke Gemini. Bila kuota Gemini habis, bot memberi tahu dengan sopan; bila kunci ditolak atau model butuh akun berbayar, pemilik diberi tahu lewat Telegram (maks. sekali per 6 jam).

**Penyedia gratis (disarankan):** Cloudflare Workers AI (FLUX.1 schnell). Buat akun Cloudflare gratis (tanpa kartu), buka Dashboard > AI > Workers AI > *Use REST API*, salin *Account ID* dan buat *API token* (templat Workers AI), lalu isi `CLOUDFLARE_ACCOUNT_ID` dan `CLOUDFLARE_API_TOKEN` di `.env` dan `/restart`. Jatah gratisnya 10.000 neuron/hari (±100-170 gambar, reset 07.00 WIB / 08.00 WITA). Beberapa akun Cloudflare (milik orang berbeda yang setuju) bisa dipakai bergiliran lewat `CLOUDFLARE_ACCOUNTS=idAkun1:token1,idAkun2:token2` (boleh digabung dengan pasangan tunggal di atas); akun yang jatah hariannya habis diistirahatkan sampai 00.00 UTC, akun yang tokennya ditolak diistirahatkan 1 jam. Dipakai PERTAMA; deskripsi diterjemahkan ke Inggris dulu (lewat Groq/OpenRouter bila ada) karena FLUX lebih paham Inggris. Gemini gratis tidak punya jatah untuk model gambar.\n\n**Edit foto (grup):** kirim foto dengan keterangan `bot, ubah jadi hitam putih` (atau balas foto/gambar buatan bot dengan `bot, edit foto ini jadi pantai`). Foto diperkecil dulu lewat ffmpeg (sisi terpanjang 480 px, batas Cloudflare: input lebih kecil dari 512x512), lalu diedit oleh FLUX.2 klein (`CLOUDFLARE_EDIT_MODELS`, gratis, memakai jatah neuron akun Cloudflare yang sama) dan hasilnya dikirim ke grup. Memakai jatah harian yang sama dengan pembuat gambar. Karena fotonya diperkecil, wajah dan detail halus bisa berubah; cocok untuk ubah gaya, latar, warna, atau menghapus/menambah objek. Foto dengan keterangan biasa (bukan perintah edit) tetap diabaikan. Permintaan membuka pakaian, pakaian renang/dalam, atau dokumen palsu ditolak. Edit dihitung terpisah di pemantauan (neuron edit tidak ikut perkiraan).\n\n**Hanya Cloudflare (bawaan):** bila Cloudflare terisi dan `IMAGE_PROVIDERS` kosong, perintah gambar HANYA memakai Cloudflare; Gemini/OpenRouter tidak dipanggil sama sekali. Untuk mengaktifkan cadangan: `/env IMAGE_PROVIDERS=cloudflare,gemini,openrouter`. **Tanpa jatah harian buatan bot:** `/env IMAGE_OWNER_DAILY=0`, `IMAGE_GROUP_DAILY=0`, `IMAGE_PERSON_DAILY=0` (0 = tanpa batas); batas gratis Cloudflare sendiri (±100-170 gambar/hari/akun) tetap berlaku dan tidak bisa dilewati. **Pemantauan:** hitungan berhasil/gagal hari ini, perkiraan neuron terpakai per akun Cloudflare, sisa gambar, dan waktu reset tampil di layar Status aplikasi (baris "Pembuat gambar"), di `/status` dan di `/gambar` (angka neuron hanya perkiraan; angka resmi ada di dashboard Cloudflare).\n\nCadangan: bila penyedia sebelumnya habis/ditolak atau tak ada kunci, bot mencoba OpenRouter (`OPENROUTER_API_KEYS` yang sama; model gambar `OPENROUTER_IMAGE_MODELS`, bawaan `google/gemini-2.5-flash-image`; memakai kredit OpenRouter, bukan gratis). Groq tidak punya model pembuat gambar.

Model dicoba berurutan (`GEMINI_IMAGE_MODELS`); tiap model dicoba lewat Interactions API lalu `generateContent`, dan jalur yang berhasil diingat. Kuota gambar Gemini terpisah dari kuota chat/suara, tetapi bergantung pada akun Google AI Studio: bila muncul "butuh akun berbayar", model gambar belum tersedia di tier gratis untuk kunci itu.

## Uji Meta AI (`/metaai`) -- percobaan

Meta AI (kontak bawaan WhatsApp) tidak bisa ditambahkan ke grup dan tidak punya API. Perintah ini hanya MENGUJI apakah bot (nomor utama) bisa menerima balasan dari Meta AI, supaya ide "grup minta gambar -> bot minta Meta AI -> hasilnya diteruskan ke grup" bisa dinilai dengan fakta.

- `/metaai tes` : mengirim SATU pesan "buatkan gambar kucing lucu" ke Meta AI, menunggu balasan (maks. 45 dtk), lalu melaporkan jenis balasannya. Bila ada gambar, gambarnya dikirim ke chat pemilik.
- `/metaai tes <alamat> [pesan]` : memakai alamat/pesan lain.
- `/metaai video [pesan]` : meminta VIDEO (bawaan "buatkan video kucing berlari di taman"; kata "buatkan video" ditambahkan otomatis bila belum ada). Bot menunggu sampai ±4 menit (balasan teks "sedang membuat" tidak menghentikan penantian), lalu mengirim video yang diterima ke Telegram dan chat WhatsApp pemilik sebagai video sungguhan. Laporan akhir menyebut jujur bila Meta AI hanya membalas teks/gambar (video Meta AI mungkin hanya ada di aplikasi/situs Meta AI, bukan di WhatsApp).
- `/metaai cari` : mendengarkan 90 dtk tanpa mengirim apa pun. Ketik pesan ke Meta AI dari HP-mu sendiri selama itu; bot menangkap alamat aslinya dari pesan keluar HP.

Pesan dari/ke Meta AI tidak pernah diteruskan ke auto-reply (mencegah bot membalas Meta AI terus-menerus). Belum terhubung ke grup.

## Pembuat video gratis (`/video`, "bot, buatkan video ...")

Bot merakit sendiri video pendek bernarasi (20-60 detik) tanpa API video berbayar. Alurnya: (1) AI teks (Groq/OpenRouter, cadangan Gemini) menulis naskah 3-6 adegan berisi deskripsi gambar (Inggris) dan narasi (bahasa yang sama dengan permintaan); (2) tiap adegan digambar oleh pembuat gambar yang sama dengan `/gambar` (Cloudflare FLUX, gratis); (3) seluruh narasi dibacakan SEKALI oleh Gemini TTS dan durasi tiap adegan mengikuti panjang kalimatnya; (4) ffmpeg memberi gerak halus (zoom-in, zoom-out, geser) pada tiap gambar di atas latar blur 16:9, menambah subtitle dan fade, lalu menggabungkannya dengan suara menjadi MP4 H.264/AAC (1280x720) yang langsung bisa diputar di WhatsApp.

- **Grup WA:** `bot, buatkan video kancil dan buaya` atau `bot, buatkan video 30 detik tentang siklus air` (durasi dibulatkan ke 3-6 adegan, ±6 detik per adegan). Bot membalas satu pesan "sedang dibuat" lalu mengirim videonya (1-3 menit). **Chat pemilik di WA:** `buatkan video ...` atau `/video ...`. **Telegram:** `/video <deskripsi>`, `/video` (status & jatah), `/video grup on|off`.
- **Jatah (hari WITA):** pemilik 5, semua grup 3, per orang di grup 1 (`VIDEO_OWNER_DAILY`, `VIDEO_GROUP_DAILY`, `VIDEO_PERSON_DAILY`; 0 = tanpa batas; bisa diubah lewat `/env`). Satu video memakai ±5 gambar dari jatah gratis Cloudflare (±288 neuron dari 10.000/hari), jadi tiga video grup + lima video pemilik per hari masih jauh di bawah batas. Jatah dikembalikan bila videonya gagal dibuat.
- **Satu per satu:** hanya satu video dirakit pada satu waktu (CPU laptop); permintaan berikutnya mengantre (maks `VIDEO_QUEUE`, bawaan 2), sisanya dijawab "sedang sibuk".
- **Bila ada yang tidak tersedia:** AI naskah mati -> naskah cadangan (satu ide dari beberapa sudut kamera, subtitle ide itu saja); suara/TTS gagal atau kuotanya habis -> video tetap jadi, tanpa suara tetapi dengan subtitle; satu gambar gagal -> memakai gambar adegan sebelumnya; gambar adegan pertama gagal -> pesan alasan (dan pemilik diberi tahu bila kuota/kunci gambar bermasalah). Tanpa ffmpeg: pesan "belum bisa" dan pemilik diberi tahu (`sudo apt install ffmpeg`).
- **Aman:** deskripsi memakai filter yang sama dengan gambar (konten dewasa & dokumen palsu ditolak); prompt naskah melarang tokoh nyata/merek dan teks di dalam gambar.
- **Batasnya:** ini video "gambar bergerak bernarasi" (seperti slideshow sinematik), bukan video AI yang menggerakkan tokoh. Gambar antar-adegan dijaga mirip lewat gaya bersama dan deskripsi tokoh yang diulang, tetapi wajah/bentuk tokoh bisa tetap sedikit berbeda. Kalau nanti ingin klip AI sungguhan (berbayar, mis. Veo Lite ±US$0,05/detik), bisa ditambahkan sebagai mode terpisah.
- **Pengaturan opsional (.env):** `VIDEO_ENABLED`, `VIDEO_SCENES`, `VIDEO_MAX_SCENES`, `VIDEO_NARRATION_CHARS`, `VIDEO_FONT`, `VIDEO_QUEUE`, `FFMPEG_PATH` (lihat `.env.example` bagian 26b). Font subtitle bawaan DejaVu Sans Bold (paket `fonts-dejavu-core`); tanpa font yang ditemukan, subtitle tetap dicoba lewat fontconfig dan bila gagal video dibuat tanpa subtitle.

### Foto hidup (foto -> video dengan efek)

Foto yang dikirim bisa dijadikan video pendek (4-15 detik) lengkap dengan gerak kamera dan efek, **gratis, tanpa AI, tanpa kuota gambar**: efek digambar oleh kode Node (frame RGBA setengah resolusi dialirkan ke ffmpeg), ffmpeg menggerakkan foto, memberi nuansa warna dan tulisan, lalu menulis MP4 H.264 tanpa suara.

- **Grup WA:** kirim foto dengan keterangan `bot, jadikan video dengan salju turun`, atau balas (reply) foto/gambar buatan bot dengan `bot, jadikan video ...`. **Chat pribadi pemilik:** foto + keterangan `jadikan video ...` (atau balas foto). **Telegram:** foto + keterangan `jadikan video ...` / `/video hujan`, atau balas foto dengan perintah itu. Tanpa foto, "foto ini jadikan video" dijawab petunjuk.
- **Bisa diatur lewat kalimat (semuanya opsional):** efek (maks 3): `salju`, `hujan`, `debu`, `kunang-kunang`, `bintang`, `konfeti` (juga "ulang tahun"), `gelembung`, `bara`/`api`, `kabut`, `sinar`/`cahaya`, `daun` (musim gugur), `sakura`/`bunga`, `kilau`. Tanpa menyebut efek: debu + sinar lembut; `tanpa efek` mematikannya. Gerak kamera: `zoom in` (bawaan), `zoom out`, `geser kiri/kanan/atas`, `goyang`. Nuansa: `hitam putih`, `jadul`/`vintage`, `sinematik`, `hangat`, `dingin`. Durasi: `10 detik` (bawaan 8, maks `VIDEO_PHOTO_MAX_SEC`=15). Tulisan: teks di dalam tanda kutip, mis. `tulisan "Selamat Ulang Tahun"` (muncul perlahan di bawah). Bentuk: otomatis mengikuti foto (lanskap 1280x720, potret 720x1280, persegi 960x960; foto yang tidak pas dimuat utuh di atas latar blur); paksa dengan `vertikal`/`story`, `persegi`, `lebar`.
- **Contoh:** `bot, jadikan video 10 detik dengan salju dan kunang-kunang, sinematik, tulisan "Selamat Pagi"`.
- **Jatah (hari WITA), terpisah dari video buatan AI:** pemilik 15, semua grup 8, per orang 2 (`VIDEO_PHOTO_OWNER_DAILY`, `VIDEO_PHOTO_GROUP_DAILY`, `VIDEO_PHOTO_PERSON_DAILY`; 0 = tanpa batas; bisa diubah lewat `/env`). Memakai antrean yang sama dengan video AI (satu rakitan pada satu waktu) dan hanya butuh ffmpeg, jadi tetap jalan walau pembuat gambar Cloudflare mati.
- **Batasnya:** fotonya tidak "dianimasikan" oleh AI (orang/objek di dalam foto tidak bergerak sendiri); yang bergerak adalah kamera dan efek di atas foto. Gerak sungguhan butuh model image-to-video berbayar atau GPU besar (lihat catatan Veo di atas). Foto maks 12 MB; dengan keterangan tulisan, font DejaVu Sans Bold dipakai bila ada (`VIDEO_FONT` untuk font lain).

## Morf foto (percobaan, pemilik saja)

Foto + deskripsi perubahan -> video yang berubah bertahap. Contoh di Telegram: kirim FOTO dengan keterangan `/video morf siang jadi malam bersalju` (boleh tambah `8 detik`, `5 tahap`, `halus`), atau balas foto dengan perintah itu. Di chat pribadi WhatsApp pemilik: kirim foto dengan keterangan `morf siang jadi malam bersalju`.

- **Cara kerja:** AI teks menyusun N tahap perubahan (dari tipis sampai selesai) -> tiap tahap diedit dari FOTO ASLI oleh pembuat edit foto (Cloudflare, gratis; wajah dan komposisi tidak saling menumpuk penyimpangan) -> ffmpeg menyambung foto asli + hasil edit jadi video 25 fps. Bawaan: 5 edit, 8 detik, lebur halus (cepat). Kata `halus` memakai interpolasi gerak (minterpolate): lebih lambat (±1-3 menit di laptop kantor) dan bisa melengkung bila antar-gambar sangat berbeda.
- **Jatah:** `VIDEO_MORPH_OWNER_DAILY` (bawaan 4 video/hari, tiap video = `VIDEO_MORPH_STEPS` edit foto), terpisah dari video lain. Dikembalikan bila gagal. Memakai antrean perakitan yang sama (satu per satu).
- **Cocok untuk:** perubahan suasana/gaya/benda (siang -> malam, musim, salju, warna, gaya lukisan). **Tidak cocok** untuk gerak tubuh yang tepat; editor gambar AI tidak mengerti "gerakkan lengan sedikit". Wajah pada foto orang bisa sedikit berubah antar-tahap; aturan penolakan edit foto (mis. melepas pakaian) tetap berlaku untuk setiap tahap.
- Belum untuk grup. Mesinnya ada di `morph-video.js`; kuota dan perintah di `video-gen.js`.

## Animasi karakter tanpa wajah (gratis, digambar kode)

Selain video bergambar-diam bernarasi dan "foto hidup", bot bisa membuat **animasi kartun**: tokoh manusia 2D bergaya datar **tanpa mata/hidung/mulut** (sesuai gaya "tanpa wajah") yang benar-benar bergerak — berjalan, berlari, melambai, menunjuk, melompat, duduk, bertepuk tangan, bersorak, membungkuk, berdoa, berpikir, sedih, berbicara. Tiap frame dilukis di Node (penggambar beranti-alias sendiri), ditumpuk ffmpeg di atas latar, lalu diberi narasi suara + subtitle. Tanpa API video, tanpa GPU.

- **Memintanya:** di grup `bot, buatkan animasi ayah dan anak ke taman` (boleh tambah durasi: "30 detik"); di Telegram `/video animasi <cerita>`; di chat WhatsApp pemilik cukup tulis "buatkan animasi <cerita>". Kata "kartun" juga dikenali pada `/video kartun ...`.
- **Tokoh:** pria, wanita (boleh berhijab), anak (laki-laki/perempuan), kakek, nenek; boleh berpeci/bertopi; warna baju dan hijab mengikuti cerita. Maks. 3 tokoh per cerita, **hanya manusia** (bukan hewan).
- **Latar:** gambar AI bila pembuat gambar aktif; bila tidak, latar buatan kode (pagi, siang, sore, malam, dalam rumah) — jadi animasi tetap jalan tanpa kuota gambar.
- **Jatah & antrean:** memakai jatah video harian yang sama dengan video bergambar (`VIDEO_*_DAILY`) dan antrean perakitan yang sama (satu per satu).
- **Batasnya:** gerak berupa boneka kartun sederhana (sendi kaku bergaya "flat"), bukan animasi sinematik seperti Meta AI/Veo; karakter tidak bisa diganti-ganti tampilannya di luar warna baju/hijab/peci.
- Mesin gambarnya ada di `story-video.js`; perakitan dan naskah di `video-gen.js`.

## Mengubah pengaturan gambar dari Telegram (`/env`)

Supaya token Cloudflare dan jatah gambar bisa diatur tanpa membuka laptop. Hanya pemilik, hanya lewat teks (bukan pesan suara), dan HANYA kunci pembuat gambar dan video (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNTS`, `*_IMAGE_MODELS`, `IMAGE_*` termasuk `IMAGE_PROVIDERS`, dan jatah video `VIDEO_ENABLED`, `VIDEO_OWNER_DAILY`, `VIDEO_GROUP_DAILY`, `VIDEO_PERSON_DAILY`, `VIDEO_SCENES`, `VIDEO_MAX_SCENES`). Kunci lain (Supabase, Telegram, WhatsApp) tidak bisa diubah dari sini.

- `/env` : daftar kunci beserta nilainya (token disamarkan jadi ••••4 huruf terakhir).
- `/env CLOUDFLARE_ACCOUNT_ID=idAkunmu` lalu `/env CLOUDFLARE_API_TOKEN=tokenmu` : mengisi `.env`; berlaku LANGSUNG tanpa restart.
- `/env hapus KEY` : menghapus kunci. `/env urungkan` : membatalkan perubahan terakhir (cadangan di `.env.bak`).

Pesan yang berisi token otomatis dihapus dari chat Telegram setelah diproses. Token tetap sempat lewat server Telegram, jadi pakai token yang bisa dicabut kapan saja di dashboard Cloudflare. Nilai ditolak bila berisi spasi, kutip, `#`, `\` atau `$`.

