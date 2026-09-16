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

## Menambah/mengganti sumber berita

Edit `supabase/functions/_shared/rss-sources.ts` — tinggal tambah/hapus item di array `FEED_SOURCES`, lalu `npx supabase functions deploy generate-summary` lagi. Cari RSS feed media lain lewat `<nama-media>.com/rss` atau situs seperti feedspot.com.

## Kalau ada hari yang ringkasannya gagal

Baris di tabel `summaries` untuk tanggal itu akan berstatus `failed` dengan pesan error di kolom `error` — buka **Supabase Dashboard → Edge Functions → generate-summary → Logs** untuk detail (misalnya: RSS feed down, Gemini API key salah/habis kuota, dsb). Frontend akan menampilkan pesan "ringkasan gagal dibuat" untuk tanggal tersebut.

## Catatan keamanan

Aplikasi ini didesain untuk dipakai sendiri, tanpa sistem login (supaya tetap simpel). Konsekuensinya:

- `anon key` Supabase ada di kode frontend yang publik (memang begitu desainnya Supabase) — siapa pun yang tahu key itu bisa membaca tabel `summaries` (memang dimaksudkan publik-terbaca) dan menambah/mengubah baris di `push_subscriptions`. Tidak ada data pribadi sensitif di kedua tabel itu, jadi risikonya rendah, tapi ini bukan pola yang cocok kalau nanti kamu mau tambah data pribadi lain ke database yang sama.
- Edge Function `generate-summary` & `send-push` dilindungi header `x-cron-secret` supaya orang lain tidak bisa memicu Gemini API / kirim notifikasi memakai kuota kamu — pastikan secret `CRON_SECRET` di langkah 5 benar-benar di-set, karena kalau kosong pengecekan ini otomatis dilewati.
- `SUPABASE_SERVICE_ROLE_KEY` dan `VAPID_KEYS_JSON` **tidak pernah** ada di frontend — hanya tersimpan sebagai Supabase secret di server.

## Batasan tier gratis yang perlu diketahui

- **Gemini API free tier**: ada batas jumlah request per hari/menit (cek kuota terbaru di https://ai.google.dev/gemini-api/docs/rate-limits). Untuk 1x panggilan per hari, jauh di bawah batas normal.
- **Supabase free tier**: Edge Function invocations & pg_cron termasuk gratis dalam batas wajar untuk 1x request/hari.
- **RSS feed**: gratis, tidak perlu API key, tapi kalau media sumber mengubah struktur RSS mereka, parser sederhana di `rss-parser.ts` mungkin perlu disesuaikan.
