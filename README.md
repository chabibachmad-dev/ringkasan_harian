# Ringkasan Harian 📰

PWA pribadi yang tiap hari jam **20:00 WITA** otomatis:

1. Mengambil berita terbaru dari beberapa RSS feed (dunia + Indonesia).
2. Merangkumnya jadi narasi Bahasa Indonesia (+ versi Inggris) pakai Gemini API (gratis).
3. Menyimpan hasilnya ke Supabase supaya bisa dibaca ulang kapan saja.
4. Mengirim **push notification ke iPhone** begitu ringkasan selesai dibuat.

Semua komponennya gratis: RSS (tanpa API key), Gemini API (tier gratis Google AI Studio), Supabase (tier gratis, termasuk pg_cron & Edge Functions), dan GitHub Pages untuk hosting.

## Arsitektur singkat

```
pg_cron (Supabase, jadwal 20:00 WITA)
   │  memanggil tiap hari
   ▼
Edge Function generate-summary
   │  1. fetch RSS (BBC, Al Jazeera, ANTARA News)
   │  2. kirim ke Gemini API → dapat ringkasan ID + EN
   │  3. simpan ke tabel `summaries`
   │  4. panggil send-push → kirim Web Push ke semua device
   ▼
Tabel Supabase: summaries, push_subscriptions
   ▲
   │  dibaca oleh
PWA (GitHub Pages) — dibuka & di-"Add to Home Screen" di iPhone
```

Tidak ada server yang perlu kamu jalankan sendiri 24 jam — semuanya jalan otomatis di Supabase (cron + function) dan GitHub Pages (hosting statis).

Selain alur otomatis di atas, ada juga fitur **Diskusi/chat pribadi** yang terpisah: PWA memanggil Edge Function `chat` (diproteksi kode akses) setiap kamu kirim pesan, function-nya menyimpan pesan ke tabel `chat_messages` (dikelompokkan per tanggal) lalu membalas pakai Gemini API yang sama. Lihat langkah 11 di bawah untuk setup-nya.

---

## 0. Yang kamu butuhkan

- Repo GitHub `ringkasan_harian` (sudah ada, masih kosong) + **GitHub Desktop** untuk push.
- Project Supabase yang sudah kamu punya (URL & anon key sudah dipakai di kode ini).
- [Node.js](https://nodejs.org/) versi 20+ terpasang di komputer, untuk build & generate VAPID key.
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) — cara pasangnya ada di langkah 4 (install global lewat npm **tidak didukung**, jadi jangan pakai `npm install -g supabase`).
- Akun Google untuk ambil **Gemini API key gratis** di https://aistudio.google.com/apikey.
- iPhone dengan iOS 16.4 ke atas (untuk web push notification).

Salin semua file di folder ini ke folder lokal repo `ringkasan_harian` kamu (yang sudah ter-clone lewat GitHub Desktop), lalu ikuti langkah di bawah **sebelum** kamu push ke GitHub — supaya waktu Action jalan, semua secret sudah siap.

---

## 1. Setup database Supabase

1. Buka [Supabase Dashboard](https://supabase.com/dashboard) → project kamu → **SQL Editor**.
2. Jalankan isi file `supabase/migrations/0001_init.sql` (bikin tabel `summaries` & `push_subscriptions` + RLS).
3. Buka **Database → Extensions**, aktifkan `pg_cron` dan `pg_net` kalau belum aktif.
4. **Belum** jalankan `0002_cron.sql` dulu — itu langkah terakhir (butuh secret yang belum kita buat).

## 2. Bikin Gemini API key (gratis)

1. Buka https://aistudio.google.com/apikey, login, klik **Create API key**.
2. Simpan key-nya, kita pakai di langkah 5 (secret `GEMINI_API_KEY`).
3. Cek nama model yang tersedia untuk akun kamu di https://ai.google.dev/gemini-api/docs/models — kode ini pakai `gemini-3.6-flash` secara default. Google cukup sering mengganti/menghentikan dukungan nama model lama; kalau suatu saat muncul error `404 ... no longer available`, Google biasanya menyebutkan nama model pengganti langsung di pesan errornya — tinggal set itu sebagai secret `GEMINI_MODEL` (tanpa perlu ubah kode / deploy ulang):
   ```powershell
   npx supabase secrets set GEMINI_MODEL=nama-model-pengganti
   ```

## 3. Generate VAPID keys (untuk push notification)

VAPID key dipakai untuk membuktikan ke browser bahwa notifikasi benar-benar dari aplikasi kamu. Generate sekali saja, simpan baik-baik.

Butuh [Deno](https://deno.com/) terpasang (kalau belum ada: `curl -fsSL https://deno.land/install.sh | sh`), lalu dari folder project ini:

```bash
deno run --allow-net scripts/generate-vapid-keys.ts
```

Script ini akan mencetak dua blok:

1. Perintah `supabase secrets set VAPID_KEYS_JSON='...'` — **rahasia**, ini private key, jangan pernah disebar atau di-commit ke Git. Simpan/jalankan langsung di langkah 5.
2. Baris `VITE_VAPID_PUBLIC_KEY=...` — ini **boleh publik** (memang didesain untuk ada di kode frontend), dipakai di langkah 8.

Kalau kamu generate ulang di kemudian hari, semua device yang sudah subscribe dengan key lama otomatis berhenti menerima notifikasi (perlu klik "Aktifkan Notifikasi" lagi) — jadi generate cukup sekali di awal.

## 4. Install Supabase CLI, buat "cron secret", & login

**Install Supabase CLI.** Install global lewat npm **tidak didukung** (akan error), jadi install sebagai dev dependency di dalam folder project ini — semua perintah `supabase ...` di langkah-langkah berikutnya jadi `npx supabase ...`:

Pastikan dulu kamu sudah `cd` ke folder project (yang di dalamnya ada `package.json`), baru jalankan:

```powershell
npm install supabase --save-dev
```

**Buat "cron secret".** Ini password rahasia buatan kamu sendiri (string acak apa saja) — supaya Edge Function `generate-summary`/`send-push` tidak bisa dipanggil sembarang orang, walau anon key project kamu ada di kode frontend yang publik. Generate salah satu cara ini, lalu simpan hasilnya (tempel di Notepad dulu, dipakai di langkah 5 & 7):

- PowerShell (Windows):
  ```powershell
  [System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")
  ```
- macOS/Linux/Git Bash:
  ```bash
  openssl rand -hex 24
  ```

**Login & hubungkan ke project Supabase kamu:**

```powershell
npx supabase login
npx supabase link --project-ref alkpmwowhlyffdwfvyeu
```

`npx supabase login` akan membuka browser untuk login — setelah berhasil, kembali ke terminal.

## 5. Set secret untuk Edge Functions

```powershell
npx supabase secrets set GEMINI_API_KEY=isi-dengan-api-key-gemini-kamu
npx supabase secrets set VAPID_SUBJECT=mailto:emailkamu@example.com
npx supabase secrets set CRON_SECRET=isi-dengan-string-acak-dari-langkah-4
```

Lalu jalankan perintah `npx supabase secrets set VAPID_KEYS_JSON='...'` yang dicetak oleh script di langkah 3 (isinya JSON, jadi harus dalam tanda kutip satu seperti itu supaya tidak rusak oleh shell — di PowerShell tanda kutip satu `'...'` juga aman dipakai).

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` **tidak perlu** kamu set manual — Supabase otomatis menyediakannya ke semua Edge Function.

## 6. Deploy Edge Functions

```powershell
npx supabase functions deploy generate-summary
npx supabase functions deploy send-push
npx supabase functions deploy subscribe
```

*(`subscribe` dipakai frontend untuk menyimpan Web Push subscription — sengaja lewat Edge Function, bukan insert langsung dari browser, karena alasan teknis RLS + upsert yang dijelaskan di komentar `supabase/migrations/0001_init.sql`.)*

## 7. Aktifkan jadwal otomatis (pg_cron)

1. Kembali ke **SQL Editor** di Supabase Dashboard.
2. Jalankan dulu perintah ini untuk simpan URL project & service_role key ke Vault (ambil service_role key dari **Project Settings → API**, field **service_role secret** — JANGAN sebar key ini, beda dengan anon key):

   ```sql
   select vault.create_secret('https://alkpmwowhlyffdwfvyeu.supabase.co', 'project_url');
   select vault.create_secret('ISI_DENGAN_SERVICE_ROLE_KEY_KAMU', 'service_role_key');
   ```

3. Jalankan isi file `supabase/migrations/0002_cron.sql` (bagian "Versi pakai Supabase Vault").

   > Catatan: contoh `net.http_post` di file itu belum menyertakan header `x-cron-secret`. Tambahkan `'x-cron-secret', 'ISI_CRON_SECRET_KAMU'` ke `jsonb_build_object(...)` di bagian `headers` sebelum dijalankan, supaya cocok dengan pengecekan di Edge Function.

4. Cek jadwal aktif: `select * from cron.job;`

### Coba jalankan manual (jangan tunggu jam 20:00 untuk testing pertama)

```bash
curl -X POST https://alkpmwowhlyffdwfvyeu.supabase.co/functions/v1/generate-summary \
  -H "Authorization: Bearer <VITE_SUPABASE_ANON_KEY>" \
  -H "x-cron-secret: <CRON_SECRET_KAMU>"
```

Kalau sukses, cek tabel `summaries` di Supabase Table Editor — harus ada baris baru untuk hari ini.

---

## 8. Konfigurasi frontend

1. Salin `.env.example` menjadi `.env`, isi `VITE_VAPID_PUBLIC_KEY` dengan public key dari langkah 3 (URL & anon key sudah terisi otomatis).
2. Test lokal dulu kalau mau: `npm install` lalu `npm run dev`, buka `http://localhost:5173`.

### Tambahan (opsional): penyedia AI cadangan, pencarian web, dan agent di aplikasi

- **Agent di Chat AI** (tombol di atas kolom ketik): Auto (Gemini dulu, lalu Groq/OpenRouter, lalu Ollama), Gemini, Groq, OpenRouter, Ollama. Memilih satu penyedia = hanya penyedia itu, tidak pindah diam-diam ke yang lain. Jalankan migrasi `0021_chat_agent_groq_openrouter.sql`, lalu deploy ulang fungsi `chat`.
- **Key penyedia**: `npx supabase secrets set GROQ_API_KEYS=gsk_xxx OPENROUTER_API_KEYS=sk-or-xxx` (model lewat `GROQ_MODEL` / `OPENROUTER_MODEL`).

- **Pembuatan soal & tutor Speaking terasa lambat / gagal?** Kuota gratis Gemini kecil (±20 permintaan per hari per model), jadi bila habis, tiap permintaan dulu mencoba semua key sebelum pindah ke Groq. Sekarang: (1) Gemini dibatasi waktu (`STUDY_GEMINI_BUDGET_MS`, bawaan 45000 ms; tutor 20 dtk) lalu dialihkan ke Groq, (2) bila catatan database menunjukkan SEMUA key Gemini sudah kena batas harian, Gemini dilewati langsung, (3) aplikasi tidak lagi menunggu tanpa batas: balasan tutor maksimal 60 dtk, lalu aplikasi mengecek apakah giliran tercatat dan membuka kunci tombol jawab. Untuk paling cepat dan hemat kuota Gemini (disisakan untuk suara), pakai Groq lebih dulu: `npx supabase secrets set STUDY_AI_ORDER=fallback-first` (kembali ke bawaan: `gemini-first`). Butuh `GROQ_API_KEYS` di secrets Supabase.
- **Pencarian web via API** (hasil membawa URL sumber): `npx supabase secrets set TAVILY_API_KEYS=tvly-xxx SERPER_API_KEYS=xxx BRAVE_API_KEYS=xxx` (semua opsional, boleh beberapa key dipisah koma). Tanpa key, dipakai Bing seperti sebelumnya. Untuk bot WA, isi variabel yang sama di `wa-bot/.env` lalu `pm2 restart wa-bot --update-env`.
- **Pantauan perubahan peraturan** (bot WA, mingguan ke WhatsApp pemilik): butuh `WA_OWNER_NUMBER` dan minimal satu key API pencarian di `wa-bot/.env`. Pengaturan topik/hari/jam ada di bagian "Pantauan perubahan peraturan" pada `wa-bot/.env.example`. Kirim `/peraturan` dari nomor pemilik untuk menjalankannya sekarang.
- **Monitoring key pencarian** (tombol Tavily / Serper / Brave di Pengaturan > Status Sistem, hitungan per bulan): jalankan migrasi `0022_search_provider_usage.sql` (butuh 0020) dan deploy ulang fungsi `chat`. Batas bulanan bisa diubah lewat secret `TAVILY_MONTHLY_LIMIT`, `SERPER_MONTHLY_LIMIT`, `BRAVE_MONTHLY_LIMIT`.

## 9. Push ke GitHub & deploy ke GitHub Pages

1. Lewat GitHub Desktop: commit semua file, push ke `main`.
2. Di GitHub.com, buka repo → **Settings → Pages** → bagian **Build and deployment**, pilih Source: **GitHub Actions**.
3. Buka **Settings → Secrets and variables → Actions → New repository secret**, tambahkan 3 secret ini (nilainya sama seperti isi `.env` kamu):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_VAPID_PUBLIC_KEY`
4. Push commit apa saja ke `main` (atau buka tab **Actions** → jalankan workflow "Deploy PWA ke GitHub Pages" manual) untuk memicu deploy pertama.
5. Setelah selesai (cek tab **Actions**), URL PWA kamu ada di **Settings → Pages**, biasanya `https://<username>.github.io/ringkasan_harian/`.

## 10. Install & aktifkan notifikasi di iPhone

Push notification web **hanya berfungsi kalau PWA di-install ke Layar Utama** — tidak jalan kalau cuma dibuka di tab Safari biasa. Ini keterbatasan dari Apple, bukan dari aplikasi ini.

1. Buka URL GitHub Pages kamu di **Safari** (harus Safari, bukan Chrome/browser lain di iOS).
2. Tap ikon **Share** (kotak dengan panah ke atas) → **Add to Home Screen** → **Add**.
3. Buka aplikasi dari ikon di layar utama (bukan dari Safari lagi).
4. Tap tombol **"Aktifkan Notifikasi"**, izinkan saat diminta.
5. Selesai — mulai jam 20:00 WITA berikutnya, ringkasan akan otomatis dibuat dan kamu dapat notifikasi.

Untuk tes cepat tanpa nunggu jam 20:00:

```bash
curl -X POST https://alkpmwowhlyffdwfvyeu.supabase.co/functions/v1/send-push \
  -H "Authorization: Bearer <VITE_SUPABASE_ANON_KEY>" \
  -H "x-cron-secret: <CRON_SECRET_KAMU>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Tes notifikasi","body":"Kalau ini muncul, notifikasi berfungsi!"}'
```

---

## 11. Fitur Diskusi/Chat pribadi

Selain ringkasan berita otomatis, aplikasi ini juga punya kotak diskusi/chat pribadi (ditenagai Gemini, sama seperti ringkasan) yang tersimpan per tanggal — tiap hari mulai obrolan baru dari kosong.

Karena situs ini publik (siapa saja yang tahu link-nya bisa buka), tabel percakapannya dikunci total dari anon key (mirip `push_subscriptions`) dan diproteksi kode akses supaya cuma kamu yang bisa baca/pakai.

1. Jalankan migration-nya di **SQL Editor** Supabase Dashboard: isi file `supabase/migrations/0004_chat.sql`.
2. Bikin kode akses bebas (angka/huruf apa saja, cuma kamu yang perlu ingat), lalu set sebagai secret:
   ```powershell
   npx supabase secrets set CHAT_ACCESS_CODE=isi-dengan-kode-rahasia-kamu
   ```
3. Deploy function-nya:
   ```powershell
   npx supabase functions deploy chat
   ```
4. Buka aplikasinya, scroll ke bagian **Diskusi**, masukkan kode akses yang kamu set di langkah 2 → langsung bisa dipakai chat. Kode tersimpan di browser (localStorage) supaya tidak perlu dimasukkan ulang tiap buka aplikasi.

Kalau suatu saat mau ganti kode akses, tinggal `npx supabase secrets set CHAT_ACCESS_CODE=kode-baru` — device lama otomatis diminta masukkan kode baru begitu kode lamanya ditolak server.

---

## Menambah/mengganti sumber berita

Edit `supabase/functions/_shared/rss-sources.ts` — tinggal tambah/hapus item di array `FEED_SOURCES`, lalu `npx supabase functions deploy generate-summary` lagi. Cari RSS feed media lain lewat `<nama-media>.com/rss` atau situs seperti feedspot.com.

## Kalau ada hari yang ringkasannya gagal

Baris di tabel `summaries` untuk tanggal itu akan berstatus `failed` dengan pesan error di kolom `error` — buka **Supabase Dashboard → Edge Functions → generate-summary → Logs** untuk detail (misalnya: RSS feed down, Gemini API key salah/habis kuota, dsb). Frontend akan menampilkan pesan "ringkasan gagal dibuat" untuk tanggal tersebut.

## Catatan keamanan

Aplikasi ini didesain untuk dipakai sendiri, tanpa sistem login (supaya tetap simpel). Konsekuensinya:

- `anon key` Supabase ada di kode frontend yang publik (memang begitu desainnya Supabase) — siapa pun yang tahu key itu bisa membaca tabel `summaries` (memang dimaksudkan publik-terbaca, isinya cuma ringkasan berita). Tabel `push_subscriptions` dan `chat_messages` dikunci total dari anon key (RLS aktif tanpa policy sama sekali) — satu-satunya jalan masuk/keluar adalah lewat Edge Function (`subscribe`, `chat`) yang jalan pakai `service_role`.
- Edge Function `generate-summary` & `send-push` dilindungi header `x-cron-secret` supaya orang lain tidak bisa memicu Gemini API / kirim notifikasi memakai kuota kamu — pastikan secret `CRON_SECRET` di langkah 5 benar-benar di-set, karena kalau kosong pengecekan ini otomatis dilewati.
- Edge Function `study` (menu Study) sengaja **tanpa** kode akses; pengamannya PIN pemain/orang tua dan batas pemakaian AI (lihat bagian Menu Study). Siapa pun yang tahu alamat aplikasi bisa mendaftar sebagai pemain dan memakai kuota AI sampai batas harian itu.
- Edge Function `chat` dilindungi kode akses (`CHAT_ACCESS_CODE`) yang wajib ada — kalau secret ini belum di-set, function-nya menolak semua request (bukan fail-open seperti `x-cron-secret`).
- `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_KEYS_JSON`, dan `CHAT_ACCESS_CODE` **tidak pernah** ada di frontend — hanya tersimpan sebagai Supabase secret di server. Kode akses chat yang dimasukkan lewat browser cuma disimpan di `localStorage` device kamu sendiri, tidak pernah di-commit ke Git.

## Batasan tier gratis yang perlu diketahui

- **Gemini API free tier**: ada batas jumlah request per hari/menit (cek kuota terbaru di https://ai.google.dev/gemini-api/docs/rate-limits). Untuk 1x panggilan per hari, jauh di bawah batas normal.
- **Supabase free tier**: Edge Function invocations & pg_cron termasuk gratis dalam batas wajar untuk 1x request/hari.
- **RSS feed**: gratis, tidak perlu API key, tapi kalau media sumber mengubah struktur RSS mereka, parser sederhana di `rss-parser.ts` mungkin perlu disesuaikan.

## Hapus otomatis obrolan (7 hari) & tanda Saved

Obrolan di *Chat dengan AI* yang **tidak ditandai Saved** dihapus otomatis bila pesan terakhirnya lebih tua dari 7 hari (beserta lampiran, metadata, dan antrean job-nya). Tandai lewat menu titik tiga > **Simpan (Saved)**; obrolan Saved tampil dengan lencana "Saved" dan tidak pernah dihapus otomatis. Obrolan yang akan segera dihapus menampilkan "Dihapus N hari lagi" (3 hari terakhir). Sematan (pin) TIDAK mengecualikan penghapusan; hanya Saved.

Pasang: jalankan `supabase/migrations/0018_chat_saved_retention.sql` di SQL Editor **sebelum** men-deploy Edge Function `chat` yang baru (menambah kolom `saved`, tabel `chat_retention_settings`, dan fungsi `purge_old_chats()`). Penghapusan jalan tiap jam lewat pg_cron bila aktif, dan juga otomatis saat daftar obrolan dibuka. **Masa tenggang:** aturan baru efektif 7 hari setelah migrasi dijalankan, supaya obrolan lama sempat ditandai Saved. Ubah lama simpan: `update public.chat_retention_settings set days = 14 where id = 'main';` — matikan praktis dengan `days = 3650`.

**Gemini membaca dokumen lewat indeks laptop.** Jalankan `supabase/migrations/0019_kb_retrievals.sql`, deploy ulang Edge Function `chat`, lalu pasang file bot baru di laptop (detail: `wa-bot/README.md` bagian 9b). Bila laptop mati, chat otomatis memakai jalur lama.

## Menu Study (belajar, poin, tukar hadiah)

Menu **Study** di beranda: pemain mendaftar (nama, grade TK–S3/Umum, PIN), memilih pelajaran, menjawab soal pilihan ganda A–D, lalu poin dihitung dan setiap nomor diberi pembahasan. Papan peringkat tampil saat masuk, poin terbesar di paling atas.

**Pasang (sekali saja):**

1. Jalankan migrasi `0023_study.sql`, `0024_study_social.sql` (timeline: suka & komentar), `0025_study_materials.sql` (materi pelajaran + pencatat pemakaian AI), dan `0026_study_class.sql` (kelas SD/SMP/SMA), `0027_study_points_timer.sql` (poin per soal, bonus sempurna, timer), `0028_study_competition.sql` (kompetisi, timeline global, profil publik), `0029_study_practice.sql` (latihan dari materi), dan `0030_study_device_login.sql` (login perangkat), `0031_study_avatar.sql` (foto profil), `0032_study_daily_cap.sql` (batas poin harian), `0033_study_repeat_penalty.sql` (anti-spam pengulangan mata pelajaran), `0034_study_notifications.sql` (notifikasi suka & komentar), dan `0035_study_speaking.sql` (latihan Speaking Inggris, riwayat 7 hari), berurutan. Lewat SQL Editor, atau `npx supabase db push` untuk semuanya.
2. Deploy fungsi baru: `npx supabase functions deploy study` (sama seperti fungsi lain).
3. Deploy ulang fungsi `chat` (`npx supabase functions deploy chat`) karena `_shared/gemini.ts` ikut berubah, lalu push frontend ke GitHub seperti biasa.

Tidak ada secret baru. Fungsi `study` memakai kunci AI yang sudah ada (urutan: Gemini lebih dulu, lalu Groq/OpenRouter).

**Akses tanpa kode akses chat.** Menu **Study, Shalat, Al-Qur'an, dan Info** bisa dipakai tanpa kode akses. Menu lain (Chat AI, WhatsApp, Dokumen, Template WA, Status) tetap meminta kode seperti sebelumnya. Karena Study kini terbuka untuk siapa pun yang tahu alamat aplikasinya, data dijaga oleh PIN pemain dan PIN orang tua, dan pemakaian AI dibatasi di server (konstanta di `supabase/functions/study/index.ts`): maksimal **50 pemain**, **25** pembuatan pelajaran/materi per pemain per 24 jam, dan **100** untuk seluruh pemain per 24 jam (dicatat di tabel `study_gen_log`; membatalkan pelajaran tidak mengembalikan jatah). Ubah angkanya di file itu bila perlu, lalu deploy ulang. Buat PIN orang tua di Setting agar penghapusan komentar/materi oleh orang tua bisa dipakai.

**Cara kerja singkat**

- Poin dihitung oleh database, bukan AI: `poin per soal x jumlah benar x bobot level x (100 + bonus)%`, dibulatkan; bonus nilai sempurna hanya bila SEMUA soal benar. Dengan bawaan 10 poin/soal dan bonus 10%: Normal 8/10 = 80, Normal 16/20 = 160, Easy 8/10 = 64, Hard 8/10 = 96, Normal 10/10 = 110. Jumlah soal ikut menentukan poin, jadi 8/10 dan 16/20 tidak lagi sama. AI hanya membuat soal dan menulis pembahasan. Kunci jawaban tidak dikirim ke layar sebelum dikumpulkan.
- Peringkat memakai **total poin yang pernah didapat** (tidak turun saat ditukar atau kena hukuman). Saldo yang bisa ditukar ditampilkan di profil pemain.
- Grade materi: tidak boleh lebih rendah dari grade pemain (urutan TK < SD < SMP < SMA < S1 < S2 < S3). Pemain "Umum" boleh semua tingkat; materi "Umum" selalu boleh.
- **Kelas**: SD, SMP, dan SMA punya pilihan kelas (SD 1-6, SMP 7-9, SMA 10-12; tingkat lain tanpa kelas). Dipilih saat membuat pemain baru, saat memulai pelajaran, dan saat membuat materi, lalu tampil sebagai "SD 5" di leaderboard, profil, timeline, komentar, materi, dan PDF; juga dikirim ke AI agar soal/materi pas dengan kelasnya. Untuk **pelajaran**, kelas juga tidak boleh lebih rendah dari kelas pemain (pemain SD 5 boleh SD 5-6, SMP 7-9, SMA 10-12, tapi bukan SD 1-4); **materi** bebas semua kelas. Salah pilih atau naik kelas: tombol **Ubah kelas** di profil (butuh PIN orang tua bila sudah dibuat, karena menurunkan kelas membuka materi yang lebih rendah). Pemain lama belum punya kelas sampai mereka mengaturnya lewat **Ubah kelas**; selama itu hanya aturan tingkat yang berlaku.
- Tukar hadiah: poin langsung berkurang, status **Menunggu** sampai orang tua menandai **Sudah diberikan** (di Setting).
- Hukuman: orang tua mengisi nama pemain, jumlah poin, dan alasan. Saldo tidak pernah turun di bawah 0 (bila diminta lebih besar, yang terpotong hanya sebesar saldo dan itu dijelaskan).
- **Setting** (ikon roda gigi di halaman Study): poin per soal benar, bonus nilai sempurna (%), waktu per soal (detik; 0 = tanpa timer), bonus pemenang kompetisi (poin), bobot Easy/Normal/Hard, daftar mata pelajaran, tambah/ubah/hapus hadiah beserta ambang poinnya, hukuman, tandai hadiah diberikan, dan PIN orang tua.
- **PIN orang tua** menjaga reset PIN pemain, Setting, hukuman, dan penandaan hadiah. Selama belum dibuat, area itu terbuka (ada peringatan di Setting, sebaiknya segera dibuat). Kalau lupa PIN orang tua, ulang lewat SQL Editor: `update study_settings set parent_pin_salt = null, parent_pin_hash = null where id = 1;`
- PIN pemain terkunci 5 menit setelah 5 kali salah.
- Batas: maksimal 30 soal per pelajaran (dibuat per 10 soal), maksimal 3 pelajaran belum selesai per pemain, dan soal yang gagal sebagian tetap dipakai bila minimal 80% dari yang diminta.
- **Timer**: waktu pelajaran = jumlah soal x detik per soal (bawaan 60 detik; 10 soal = 10 menit; diatur orang tua di Setting, 0 = tanpa timer). Batas dihitung SERVER dari saat soal selesai dibuat, jadi menutup/membuka ulang aplikasi tidak menambah waktu. Saat habis, jawaban yang sudah terisi dikumpulkan otomatis (kosong = salah). Pengumpulan yang tiba lebih dari 30 detik setelah batas (misalnya HP terkunci lama) dihitung tanpa jawaban. Pelajaran lama yang belum selesai tidak punya batas waktu; pelajaran yang sudah selesai tidak dihitung ulang.
- **Beranda Study** punya tiga tab: **Timeline** (bawaan) | **Leaderboard** | **Materi**, dengan tombol **+ Pemain Baru**, **Pelajaran Baru**, dan **Kompetisi** di atasnya.
- **Timeline global** (seperti media sosial): semua kegiatan semua pemain dalam satu daftar, terbaru di atas (20 per halaman): pelajaran solo yang selesai, kompetisi yang selesai (3 teratas + pemenang), dan materi yang dibuat. Tombol **Suka**, **Komentar**, dan tombol ketiga di tiap kartu: **Detil** (pelajaran: soal, jawaban, kunci, dan pembahasan AI, bisa dibagikan sebagai PDF), **Lihat hasil** (kompetisi: tabel hasil), atau **Lihat Materi**. Kompetisi terbuka untuk disukai/dikomentari siapa pun, termasuk pesertanya; pelajaran dan materi tidak bisa disukai/dikomentari pembuatnya sendiri.
- **Profil publik**: ketuk nama pemain di mana pun (leaderboard, timeline, tabel hasil) untuk melihat prestasinya **tanpa PIN**: peringkat, total poin, jumlah pelajaran solo, kompetisi, kemenangan, dan materi, lalu tab **Aktivitas** (kartu timeline pemain itu) | **Solo** (tabel pelajaran, ketuk baris = Detil) | **Kompetisi** (tabel peringkat, ketuk baris = tabel hasil). Saldo, redeem, dan hukuman tetap hanya di profil pribadi (tombol **Buka profil pribadi (PIN)**).
  - Melihat timeline, profil publik, tabel hasil kompetisi, dan membaca komentar tidak perlu PIN. Suka, komentar, dan Detil butuh **masuk sebagai pemain** (pilih nama + PIN, sekali per kunjungan ke layar Study; hilang saat layar ditinggalkan).
  - Pemain tidak bisa menyukai atau mengomentari kegiatannya sendiri (dijaga di database), tetapi boleh membuka Detil-nya dan menghapus komentarnya sendiri. Komentar 1-300 karakter, maksimal 10 per pemain per pelajaran, tampil sebagai teks biasa.
  - Orang tua bisa menghapus komentar siapa pun lewat tombol **Hapus (orang tua)** (wajib PIN orang tua yang sudah dibuat).
  - Penukaran hadiah dan hukuman **tidak** tampil di timeline. Tombol **Buka profil pribadi (PIN)** di profil publik membuka saldo dan hadiah; bila pemilik sudah masuk, PIN tidak diminta lagi.
- **Kompetisi** (tombol **Kompetisi** di beranda): beradu mengerjakan soal yang sama pada waktu yang sama.
  - Pembuat room memilih pelajaran, topik (opsional), tingkat/kelas, level, jumlah soal, dan waktu (menit; ada saran dari "detik per soal" di Setting). Soal dibuat AI sekali saat room dibuat (memakai jatah pembuatan pelajaran pembuatnya). Siapa pun boleh bergabung lewat daftar room dengan PIN-nya (kelas materi tidak dibatasi untuk peserta).
  - **Lobi**: pembuat menekan **Mulai** setelah minimal 2 dan maksimal 10 pemain masuk; semua peserta langsung mendapat soal yang sama. Satu pemain hanya boleh ada di satu room yang belum selesai. Pembuat yang keluar membatalkan room; lobi yang menganggur lebih dari 30 menit dibatalkan otomatis. Layar memeriksa server tiap 3-4 detik.
  - **Waktu** dihitung server dari saat Mulai (jawaban dikumpulkan otomatis saat habis; toleransi 30 detik, lewat itu jawaban tidak dihitung). Keluar dari layar soal tidak menghentikan waktu; lanjutkan dari room lewat **Lanjut mengerjakan**. Room selesai begitu semua mengumpulkan atau waktu habis.
  - **Poin** dihitung seperti pelajaran solo (poin per soal x benar x bobot level, plus bonus nilai sempurna) memakai angka Setting saat room dibuat. Peringkat: benar terbanyak, lalu yang mengumpulkan lebih cepat. Peringkat 1 mendapat **bonus pemenang** (bawaan 10 poin, bisa diubah di Setting; tidak ada pemenang bila skor tertinggi 0). Semua masuk ke total poin, saldo, dan profil.
  - Hasil: tabel peringkat (benar, waktu, poin, bonus) muncul otomatis di layar room dan menjadi satu kartu di timeline global. Hasil bisa dibagikan sebagai **gambar** (kartu PNG) atau **PDF** (tombol **Bagikan Gambar** / **Bagikan PDF**, di layar room dan di tabel hasil dari timeline).
- **Materi pelajaran** (tab **Materi** di samping Leaderboard): tombol **+ Buat Materi** membuka popup pemain + PIN, grade (bebas TK-S3/Umum), mata pelajaran (daftar bawaan atau ketik sendiri), dan detail materi (maks. 300 huruf), lalu **Generate**. AI menulis materi terstruktur (tujuan belajar, penjelasan, contoh, ringkasan, latihan mandiri). Setelah jadi, muncul popup dengan **Bagikan PDF** dan **Lihat Materi**. Daftar dan isi materi bisa dibaca **semua orang tanpa PIN** (20 per halaman); setiap kartu punya tombol Lihat Materi, Bagikan PDF, dan Hapus.
  - Hapus: pembuatnya dengan PIN pemain, atau orang tua dengan PIN orang tua (bila sudah dibuat). Materi tidak ikut terhapus bila akun pembuatnya dihapus.
  - Materi dibuat AI, jadi periksa isinya sebelum dipakai belajar (ada pengingat di layar dan di PDF).
- PDF hasil memakai font standar: teks Arab diganti `[teks Arab]` dan rumus ditulis sebagai teks biasa.
- **Diskusi dengan AI tentang materi** (tombol terbang): di pembaca materi ada tombol bulat bergambar gelembung chat di pojok kanan bawah. Diketuk, muncul **panel yang naik dari bawah** untuk bertanya jawab dengan AI **hanya tentang materi itu** (ada 4 saran pertanyaan, tombol **Percakapan baru**, jawaban tampil dengan format Markdown dan rumus). Hanya pemain yang sudah masuk (bila belum, popup masuk muncul dulu). **Gemini menjadi mesin utama**; Groq/OpenRouter hanya cadangan bila Gemini gagal atau kuotanya habis. Percakapan **tidak disimpan di database** (tanpa tabel dan tanpa migrasi): hidup di memori peramban dan hilang saat keluar dari materi atau menutup aplikasi; tiap giliran klien mengirim maksimal 16 pesan terakhir dan server memangkasnya lagi. Isi materi dan pesan diperlakukan sebagai data, bukan perintah (pembatas disaring), jadi pertanyaan nakal tidak bisa mengubah aturan AI. Batas pemakaian lunak di server: **80 pertanyaan per pemain** dan **600 untuk semua pemain** per hari (konstanta `MATERIAL_CHAT_*` di `supabase/functions/study/index.ts`; hitungannya di memori instance function, jadi bisa mengulang saat function dimulai ulang). Kode: `src/study-matchat.js` (panel), aksi `material_chat` di function `study`, logika murni di `_shared/study-core.ts`. Tes: `node test-study.mjs` dan `node test-mat-chat.mjs` di `wa-bot/`. **Deploy ulang function `study` dan aplikasi web; tidak perlu `db push`.**
- **Login perangkat (masuk sekali sampai Keluar)**: setelah PIN pemain benar (lewat **Masuk** di bilah timeline, atau PIN yang diisi di form mana pun), server memberi **token acak** untuk perangkat itu. Peramban menyimpan token (kunci `study_device_login_v1` di localStorage), **bukan PIN**, dan memakainya sebagai pengganti PIN di semua aksi pemain. Selama masih masuk: halaman dibuka ulang tetap masuk, **Profil saya** terbuka tanpa PIN, dan form Pelajaran Baru, Latihan, Buat Materi, serta Kompetisi tidak lagi menanyakan pemain + PIN. Bilah "Masuk sebagai ..." (dengan **Profil saya** dan **Keluar**) tampil di semua tab beranda; tombol **Keluar dari perangkat ini** juga ada di profil. **Keluar** mencabut token di server dan menghapusnya dari perangkat. Server hanya menyimpan hash SHA-256 token (tabel `study_device_tokens`, migrasi **0030**); satu pemain maksimal 8 perangkat (yang terlama otomatis keluar); orang tua mereset PIN pemain = semua perangkat pemain itu keluar dan diminta PIN lagi. Berlaku per peramban/perangkat, jadi pemain yang ganti perangkat perlu masuk sekali lagi. PIN orang tua tidak pernah disimpan. Perlu `npx supabase db push` dan deploy ulang function `study`.
- **Latihan dari materi**: tombol **Latihan** ada di tiap kartu materi, di pembaca materi, dan di popup setelah materi jadi. Pilih pemain + PIN + level (jumlah soal tetap **10**), lalu AI membuat soal **dari isi materi itu** (isi materi dikirim sebagai bahan bacaan, dipotong maksimal 12.000 karakter; AI dilarang menanyakan hal di luar materi). Pelajaran, tingkat, dan kelas mengikuti materinya, jadi hanya pemain yang gradenya tidak lebih tinggi dari materi yang ditawarkan (aturan "tidak boleh lebih rendah" sama seperti pelajaran biasa). Latihan = pelajaran biasa (poin, level, timer, pembahasan, suka/komentar, PDF, kartu gambar) dan hasilnya masuk timeline sebagai kartu bertanda **Latihan** dengan judul materinya. Sesi menyimpan `material_id` dan `material_title` (migrasi **0029**), jadi kartu tetap tampil walau materinya dihapus. Perlu `npx supabase db push` dan deploy ulang function `study`.
- **Batas poin harian (maks. 1000/hari) + dasbor "poin didapat hari ini"** (migrasi **0032**): satu pemain paling banyak mendapat **1000 poin per hari** (bisa diubah orang tua di **Setting → Batas poin harian**, `0` = tanpa batas), berapa pun yang dikerjakan. Yang dihitung adalah poin yang **didapat** (pelajaran, latihan, kompetisi, dan bonus pemenang), **bukan saldo**: menukar hadiah (redeem) atau terkena hukuman **tidak membuka jatah lagi**, jadi tetap maksimal 1000 hari itu. Hari berganti pukul **00.00 WIB** (zona `Asia/Jakarta`, kolom `study_settings.day_timezone`). Setelah batas tercapai pelajaran tetap bisa dikerjakan dan dinilai (nilai & pembahasan tetap muncul), hanya poinnya yang 0; aplikasi menanyakan dulu sebelum memulai pelajaran baru. Pemotongan dilakukan di database (`study_submit_session` dan `study_room_finalize`), jadi tidak bisa dilewati dari aplikasi: pelajaran = poin dihitung lalu dipotong ke sisa jatah; kompetisi = poin dasar dulu baru bonus pemenang, **peringkat dan pemenang tidak berubah**. Poin sebelum dipotong disimpan (`points_raw`) supaya layar hasil bisa menjelaskan "seharusnya +1.100, yang masuk +290". Tampilan: kartu **Poin didapat hari ini** di profil (angka, batang kemajuan, sisa jatah, rincian pelajaran/kompetisi/bonus, grafik 7 hari), baris "Hari ini X/1000 poin" di bilah masuk dan profil publik, serta pilihan **Total | Hari ini** di Leaderboard. Pelajaran/kompetisi yang sudah selesai sebelum migrasi tidak diubah. Perlu `npx supabase db push` dan deploy ulang function `study`; sebelum migrasi dijalankan semua tampilan batas harian otomatis tersembunyi. Catatan: hadiah bawaan bernilai 2.000 poin ke atas, jadi dengan batas 1000/hari butuh minimal 2 hari untuk menukarnya; sesuaikan harga hadiah di Setting bila perlu.
- **Anti-spam pengulangan mata pelajaran** (migrasi **0033**): mata pelajaran yang **sama** (huruf besar/kecil & spasi diabaikan) yang dikumpulkan lagi pada hari yang sama, pengerjaan **ke-2 dan seterusnya** per pemain, mendapat poin per soal **dikurangi 50%** (poin = poin per soal x benar x bobot x bonus x 50%; bonus nilai sempurna ikut dikurangi). Persentasenya diatur orang tua di **Setting → Poin ulangan mata pelajaran yang sama** (`50` bawaan, `100` = tanpa pengurangan, `0` = pengulangan tidak berpoin). Berlaku untuk pelajaran biasa dan latihan dari materi; **kompetisi tidak terpengaruh**. Hari berganti pukul 00.00 WIB (sama dengan batas harian), dan pengurangan terjadi **sebelum** batas 1000/hari. Dihitung di database (`study_submit_session`, dikunci per pemain) jadi tidak bisa dilewati dari aplikasi; persen yang berlaku disimpan di `study_sessions.repeat_percent`. Tampilan: peringatan di layar soal sebelum mengerjakan ("sudah kamu kerjakan 1 kali hari ini ... menjadi 50%"), catatan + rumus di layar hasil, penanda "ulangan, poin 50%" di daftar pelajaran, dan baris "Sudah dikerjakan hari ini: Matematika ×2" di dasbor poin hari ini.
- **Bobot poin menurut kelas materi** (migrasi **0040**): pelajaran solo dan latihan dari materi **boleh memilih tingkat/kelas mana pun**; poinnya dikali **bobot kelas** = 100% + 10% x (tingkat materi − tingkat pemain), dibatasi **50%-200%**. Tingkat: TK = 0, SD 1-6, SMP 7-9, SMA 10-12 (nomor kelas berlanjut), S1/S2/S3 = 13/14/15. Contoh pemain SD 3: SD 5 = 120%, SD 6 = 130%, SMP 7 = 140%, SD 2 = 90%, SD 1 = 80%. Materi **Umum**, pemain "Umum", atau pemain tanpa kelas = 100% (netral). Rumusnya: poin = poin per soal x benar x bobot level x bonus sempurna x pengulangan x **bobot kelas**, lalu dipotong batas harian. Aplikasi menampilkan bobotnya di formulir ("Bobot kelas 120% (materi lebih tinggi dari kelasmu)"), di rumus hasil, dan di riwayat. **Kompetisi (room) tidak berubah** (masih tidak boleh lebih rendah dan tanpa bobot kelas). Rumus ada di dua tempat yang harus selaras: `classPercent` di `supabase/functions/_shared/study-core.ts` dan `study_class_percent` di migrasi 0040 (dijaga `wa-bot/test-study-class-points.mjs`). Cara pasang: jalankan `0040_study_class_points.sql` di SQL Editor Supabase, lalu `npx supabase functions deploy study`, lalu push frontend. Sebelum migrasi dijalankan, poin tetap dihitung seperti sebelumnya (tanpa bobot kelas); pelajaran lama tidak diubah.
- **Notifikasi suka & komentar (tombol lonceng)** (migrasi **0034**): setelah masuk sebagai pemain, tombol **lonceng** muncul di bilah atas dengan angka jumlah suka/komentar baru dari pemain LAIN pada **pelajaran, materi, dan kompetisi** milik/diikuti pemain itu (suka & komentar sendiri tidak dihitung). Mengetuk lonceng membuka daftar (terbaru di atas, yang belum dibuka bergaris tebal + titik); mengetuk satu baris membuka kegiatannya (detail hasil pelajaran, pembaca materi, atau tabel hasil kompetisi) dan tombol kembali ke daftar. Membuka daftar menandainya sudah dibaca (`study_players.notif_seen_at`); angka diperbarui tiap 45 detik selagi layar Study terbuka. Tidak ada tabel notifikasi: daftar dibaca langsung dari `study_likes` dan `study_comments`, jadi suka yang dibatalkan/komentar yang dihapus hilang sendiri. Ini notifikasi **di dalam aplikasi** (belum notifikasi dorong ke layar kunci HP). Perlu `npx supabase db push` dan deploy ulang function `study`; sebelum migrasi dijalankan fitur terkait otomatis tersembunyi.
- **Speaking Inggris (mengobrol dengan tutor AI)** (migrasi **0035**): tombol **Speaking** di beranda Study (tersembunyi sampai migrasi dijalankan). Pilih pemain + PIN (atau langsung bila sudah masuk), lalu **+ Percakapan Baru**: pilih skenario (obrolan bebas, perkenalan, sekolah, restoran, belanja, bepergian, hobi, wawancara kerja) atau tulis topik sendiri. Tutor AI (persona "Emma") membuka percakapan seperti teman: santai, pendek, pakai kontraksi (I'm, don't) dan reaksi alami, tanpa pujian basa-basi; sesuai jenjang/kelas pemain (TK sampai dewasa). Kalimat pemain **dikoreksi** singkat (kalimat yang benar + tip berbahasa Indonesia/Inggris sesuai bahasa aplikasi) di bawah gelembung ucapan. **Percakapan otomatis (hands-free)**: cukup ketuk **Bicara** sekali; ucapan terkirim sendiri setelah pemain diam, balasan tutor **dibacakan otomatis** (tanpa menekan tombol suara), lalu mic menyala lagi sendiri sampai pemain menekan **Berhenti**/**Jeda** (atau 3 kali hening berturut-turut). Semua bisa dimatikan di pilihan di bawah layar. Suara tutor memilih suara peramban yang paling alami (Premium/Enhanced/Neural bila ada) dan dibacakan per kalimat; di iPhone/iPad pasang suara "Enhanced" di Pengaturan > Aksesibilitas > Konten Lisan > Suara agar lebih manusiawi. **Suara memakai fitur peramban** (SpeechRecognition en-US + speechSynthesis). Bila mesin pengenalan peramban tidak merespons (umum di iPad/iPhone, terutama aplikasi layar utama), aplikasi **otomatis beralih ke mode rekam**: mikrofon direkam (WAV 16 kHz, berhenti sendiri saat diam, maks. 20 detik) lalu diubah jadi teks oleh Edge Function (`speak_transcribe`): **Groq Whisper** dulu bila secret `GROQ_API_KEYS` ada (gratis, jatah jauh lebih longgar; model lewat `GROQ_STT_MODEL`), cadangan Gemini. Peramban tanpa keduanya tetap bisa berlatih dengan mengetik. **Suara tutor natural (gratis, memakai kunci Gemini yang sama)**: balasan tutor dibuat suaranya oleh model TTS Gemini (aksi `speak_tts`, suara "Sulafat", gaya hangat/santai; model dan suara bisa diganti lewat secret `GEMINI_TTS_MODELS` / `GEMINI_TTS_VOICE`), diputar lewat Web Audio, dan disimpan sementara di peramban untuk putar ulang. Bila server TTS gagal/kuota habis/lebih dari 9 detik, otomatis memakai suara bawaan perangkat (lalu tidak dicoba lagi beberapa menit); pemain bisa mematikannya lewat pilihan "Suara natural (AI)". Server hanya membacakan giliran tutor yang tersimpan (bukan teks bebas). **Riwayat terlihat oleh semua pemain**: daftar percakapan menampilkan percakapan SEMUA pemain (7 hari terakhir) dengan nama pemiliknya, ada filter Semua pemain / Punyaku; percakapan orang lain hanya bisa dibaca (tanpa kotak ketik, Akhiri, atau Hapus), yang boleh melanjutkan/mengakhiri/menghapus hanya pemiliknya. **Cadangan otomatis**: bila pengenalan suara peramban gagal (mis. Android/Brave/Samsung: galat `network` / `service-not-allowed`, atau macet 6 detik), aplikasi beralih ke mode rekam + server; bila suara natural gagal/kuota Gemini habis, pemain diberi pesan jelas dan dipakai suara perangkat (kuota harian: tidak dicoba lagi 1 jam; per menit: 2 menit; gangguan lain: 1 menit). Audio TTS yang terlalu pendek/kosong dianggap gagal dan model berikutnya dicoba. **Pamit = selesai otomatis**: bila pemain mengucapkan/mengetik salam perpisahan pendek (goodbye, bye, see you later, I have to go now, take care, good night, dst.; bukan kalimat tanya atau kalimat tentang kata itu), tutor membalas satu salam perpisahan hangat (tanpa pertanyaan baru), percakapan ditandai selesai di server (`speak_turn` mengembalikan `ended: true`), dan mikrofon dimatikan. **Mikrofon selalu dimatikan saat tidak dipakai**: dilepas saat Berhenti/Jeda, percakapan penuh atau diakhiri, hening 3 kali, keluar layar, dan saat aplikasi ke latar belakang; ada penyapu pengaman tiap 1,5 detik. Pengenalan suara hanya memberi teks yang terdengar, jadi ini BUKAN penilaian pengucapan. **Tanpa poin.** Batas: 30 giliran per percakapan, 80 giliran per pemain dan 600 giliran seluruh pemain per 24 jam, 20 percakapan baru per pemain per 24 jam, maksimal 5 percakapan berjalan (yang paling lama diakhiri otomatis). **Riwayat disimpan 7 hari saja**: hanya sesi yang terakhir aktif <= 7 hari yang tampil, dan `study_speak_purge()` menghapus yang lebih lama (dipanggil function secara berkala; boleh dijadwalkan lewat pg_cron: `select cron.schedule('study-speak-purge','17 3 * * *','select public.study_speak_purge(7)')`). Pemain bisa membuka ulang percakapan yang belum selesai, mengakhiri, atau menghapus sendiri. Perlu `npx supabase db push` dan deploy ulang function `study`.
- **Tampilan gaya Threads**: menu Study memakai tata letak ala Threads di atas dasar Snail OS (hitam-putih, monospace, garis putus-putus, tema terang/gelap lewat variabel CSS): kartu timeline dengan kolom avatar + garis utas dan aksi ikon (suka/komentar/detail), kotak "Mau belajar apa hari ini?" sebagai pintu Pelajaran Baru, tab bergaris bawah, leaderboard berbaris (peringkat, avatar, nama, poin) tanpa tabel, profil dengan avatar besar + saldo + statistik sebaris, dan tombol aksi berbentuk chip yang bisa digeser. Hanya perubahan tampilan (`src/style.css`, markup di `src/study.js`); tidak ada migrasi dan tidak perlu deploy function.
- **Kode program di soal**: AI diminta menulis kode di dalam blok kode (satu statemen per baris, indentasi dijaga), sehingga tampil rapi berbaris dengan font monospace, dan di PDF juga memakai font monospace (courier). Server membersihkan soal lewat `cleanQuestion` (baris baru dan indentasi di dalam blok kode dipertahankan, blok yang tidak tertutup ditutup otomatis). Hanya berlaku untuk soal yang dibuat setelah function `study` di-deploy ulang (`npx supabase functions deploy study`); soal lama yang sudah tersimpan tetap apa adanya.
- **Kartu gambar (PNG)**: tombol **Bagikan Gambar** di halaman hasil pelajaran (juga Detil dari timeline) dan di hasil kompetisi (layar room selesai serta Lihat hasil dari timeline/profil). Kartu hitam-putih 1080 px digambar di browser (tanpa server): skor besar, deret kotak benar/salah per soal, dan poin; untuk kompetisi berisi pemenang + tabel peringkat (10 teratas, sisanya "+N peserta lainnya"). Di ponsel membuka lembar bagikan sistem (WhatsApp, Simpan ke Galeri, dll.); bila browser tidak mendukung, PNG diunduh.

**Uji:** `cd wa-bot && npm test` (logika murni), dan untuk database (pada DB kosong): `psql -d <db> -f supabase/migrations/0023_study.sql -f supabase/migrations/0024_study_social.sql -f supabase/migrations/0025_study_materials.sql -f supabase/migrations/0026_study_class.sql -f supabase/migrations/0027_study_points_timer.sql -f supabase/migrations/0028_study_competition.sql -f supabase/migrations/0029_study_practice.sql -f supabase/migrations/0030_study_device_login.sql -f supabase/migrations/0031_study_avatar.sql -f supabase/migrations/0032_study_daily_cap.sql -f supabase/migrations/0033_study_repeat_penalty.sql -f supabase/migrations/0034_study_notifications.sql -f supabase/migrations/0035_study_speaking.sql -f supabase/tests/study_points.sql -f supabase/tests/study_social.sql -f supabase/tests/study_materials.sql -f supabase/tests/study_class.sql -f supabase/tests/study_scoring.sql -f supabase/tests/study_competition.sql -f supabase/tests/study_practice.sql -f supabase/tests/study_device.sql -f supabase/tests/study_avatar.sql -f supabase/tests/study_daily.sql -f supabase/tests/study_repeat.sql -f supabase/tests/study_notif.sql -f supabase/tests/study_speak.sql` (jalankan dari akar proyek; kolom `gagal` harus 0 di ketiga belas tes).

## Menu "PDF → MD"

Mengubah PDF peraturan menjadi Markdown terstruktur (BAB/Pasal/ayat/tabel) yang disimpan di laptop dan bisa ditanyakan ke Ollama.
Lihat bagian "Dokumen lokal" di `wa-bot/README.md`. Butuh migrasi `0037_pdf_md_jobs.sql` + `0038_pdf_md_progress.sql` (bar progres) dan deploy ulang Edge Function `chat`.
Menanyakannya: chat aplikasi (mesin Ollama + toggle Dokumen), atau `/dokumen <pertanyaan>` di WhatsApp dan Telegram.
