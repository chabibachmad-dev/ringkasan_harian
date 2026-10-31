# Motion graphic Shorts (Belajar Bareng)

Video vertikal 9:16 dibuat sepenuhnya dari kode: gambar dengan kanvas Node (`@napi-rs/canvas`), musik dan efek suara disintesis sendiri, dirakit ffmpeg. Tanpa Chromium, tanpa berkas media dari luar.

## Struktur video (format Shorts)
`[hook 1,7 dtk]` + `[templat 15–22 dtk, diregangkan mengikuti narasi]` + `[penutup 2,4 dtk]` = sekitar 20–26 detik.
- Hook: kalimat pancingan 3–6 kata yang menghantam layar di detik pertama (penonton memutuskan bertahan atau menggulir dalam beberapa detik pertama).
- Penutup: teaser topik besok + ajakan ikuti, supaya penonton kembali.
- Volume dinormalkan ke sekitar -14 LUFS; musik otomatis mengecil saat narator bicara (sidechain).

## Tujuh templat harian
| Hari | Templat | Isi |
|---|---|---|
| Senin | kuis-kilat | pertanyaan, 3–4 pilihan, hitung mundur, jawaban + penjelasan |
| Selasa | hitung-langkah | soal cerita diselesaikan 2–3 langkah, hasil besar |
| Rabu | fakta-angka | satu angka menghitung naik dalam cincin + 0–3 fakta |
| Kamis | perbandingan-bar | 3–5 batang tumbuh berurutan + kesimpulan |
| Jumat | proses-tahapan | 3–5 tahap bergaris alir (bisa siklus) |
| Sabtu | mitos-fakta | klaim distempel MITOS, kartu berbalik jadi FAKTA |
| Minggu | pola-angka | deret bilangan, aturan, angka berikutnya terungkap |
Tambahan di luar rotasi: `lingkaran-pi` (contoh asli).

## Pemakaian
```js
import { templatUntuk } from "./motion/templates/index.js";
import { buatIsi } from "./motion/content.js";        // AI -> JSON -> validasi -> periksa hitungan -> coba ulang
import { renderVideo } from "./motion/render.js";
const t = templatUntuk("2026-11-02");                  // Senin -> kuis-kilat
const { isi, hook, dasar, narasi } = await buatIsi({ llm, templatId: t.id, topik: "Perkalian 7 dan 8" });
await renderVideo({ templatId: t.id, isi, hook, teaser: "Besok: ...", narasi: "narasi.wav", keluar: "hari-ini.mp4" });
```
`llm` = `async (prompt) => string` (pasang dari router AI bot). `narasi` = berkas audio dari TTS (opsional; tanpa narasi video tetap jadi dengan musik + efek).

## Tema mingguan (`tema-mingguan.js`)
Bot mengusulkan 7 topik tiap pekan, pemilik menyetujui atau merevisi: `setuju`, `ganti 3: topik`, `tukar 2 5`, `hapus 4`, `ulang`, `tema: topik saya; topik lain` (antrean tema pemilik, dipakai lebih dulu pada usulan berikutnya), atau kalimat bebas yang diterapkan lewat AI. Status disimpan di berkas JSON.

## Menambah templat baru
Salin satu berkas di `templates/`, ubah `id`, `tema`, `rapikan` (validasi isi), `narasi`, `bangun` (durasi, `gambar(g,t)`, `efek`), lalu daftarkan di `templates/index.js`. Semua koordinat memakai kanvas 720×1280; `gambar` murni fungsi waktu `t` (deterministik per frame). Lihat `engine.js` untuk pembantu (paragraf, kartu, pil, easing).

## Uji dan contoh
- `node test-motion.mjs` (tes lengkap; render uji dilewati bila `@napi-rs/canvas`/ffmpeg tidak ada).
- `node motion/render-contoh.mjs folder 1.5` merender 7 contoh (1080×1920).
- Font Inter (lisensi SIL OFL 1.1) disertakan dalam `fonts/` (subset Latin).
