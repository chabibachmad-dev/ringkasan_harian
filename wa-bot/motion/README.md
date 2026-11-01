# Motion graphic Shorts fakta (Belajar Bareng)

Video vertikal 9:16 dibuat sepenuhnya dari kode: gambar dengan kanvas Node (`@napi-rs/canvas`), musik dan efek suara disintesis sendiri, dirakit ffmpeg. Tanpa Chromium, tanpa berkas media dari luar.

## Sehari dua posting (satu kanal YouTube, ramah keluarga)
1. **Short 9:16** (modul ini): fakta dunia / hal yang jarang diketahui, bersumber dari pencarian web, dengan templat motion graphic yang berganti tiap hari.
2. **Video pelajaran 16:9**: tetap memakai saluran papan tulis (`edu-board.js`) yang sudah ada. Short mengajak penonton ke video pelajaran hari itu (label penutup "TONTON JUGA"), dan deskripsi Short memuat tautannya.

## Struktur video Short
`[hook 1,7 dtk]` + `[templat 15–22 dtk, diregangkan mengikuti narasi]` + `[penutup 2,4 dtk]` = sekitar 20–26 detik.
- Hook: kalimat pancingan 3–6 kata yang menghantam layar di detik pertama.
- Penutup: ajakan menonton pelajaran hari ini + ikuti kanal.
- Volume dinormalkan ke sekitar -14 LUFS; musik otomatis mengecil saat narator bicara (sidechain).

## Tujuh gaya Short bergambar (rotasi harian)
Tiap Short berupa adegan ilustrasi (benda vektor yang digambar dari kode), bukan hanya teks: kamera bergeser dan zoom antar-bab, benda masuk saat kalimatnya dibacakan, ada label, panah penghubung, panel batang angka, takarir kata demi kata, kartu "Intinya". Pustaka 33 benda (`benda.js`): matahari, bulan, bumi, planet, awan, awan hujan, gunung, gunung berapi, pohon, daun, bunga, tetes air, laut, kapal, balok besi, roda gigi, lampu, baterai, magnet, termometer, jam, buku, rumah, roket, gelas ukur, lingkaran pecahan, ikan, orang, petir, kompas, pelangi, panah besar, dll.

| Hari | Id | Gaya | Contoh |
|---|---|---|---|
| Senin | fakta-angka | satu angka mengejutkan + panel pembanding | Tinggi Gunung Everest |
| Selasa | peringkat | nomor 3, 2, lalu 1 | 3 benda terbesar di tata surya |
| Rabu | mitos-fakta | mitos, fakta, sebab | Petir tidak menyambar dua kali? |
| Kamis | perbandingan-bar | dua sisi + panel batang | Air beku dan mendidih |
| Jumat | proses-tahapan | tahap berurutan + panah | Bagaimana hujan terbentuk |
| Sabtu | garis-waktu | peristiwa berurutan dengan tahun | Perjalanan manusia ke Bulan |
| Minggu | cerita-fakta | sebab-akibat | Kenapa langit biru |

Struktur isi (JSON, divalidasi `rapikanPenjelas`): 2-3 bab; tiap bab 1-3 kalimat narasi, 2-6 benda (jenis, posisi x/y 0-100, skala, nomor kalimat saat muncul, gaya masuk, label), 0-3 panah, panel opsional, lalu kalimat "inti". Aturan otomatis: jenis benda harus ada di pustaka, benda tidak boleh bertumpuk, id panah harus ada, total maksimal 8 kalimat dan 46 detik. Semua angka 2 digit ke atas (tahun, ribuan, desimal) harus tertulis di sumber (`angkaKunciPenjelas`).

Cadangan: versi teks lama tetap ada dengan akhiran `-teks` (mis. `fakta-angka-teks`, di luar rotasi). `buatIsiFaktaCadangan` mencoba adegan bergambar dulu; bila AI gagal menyusunnya (bukan karena sumber kurang) otomatis jatuh ke versi teks, jadi video harian tetap jadi.

Menambah benda: tambah satu entri di `benda.js` (gambar(g,t,o) berpusat di 0,0, lebar sekitar 100-160), langsung tersedia untuk AI lewat daftar di prompt. Lihat `penjelas/` untuk contoh adegan buatan tangan sepenuhnya (kapal mengapung) dan `ilustrasi.js` untuk kamera, label, takarir, panel.

## Isi fakta berbasis sumber (`content.js` → `buatIsiFakta`)
```js
import { templatUntuk, temaMinggu } from "./motion/templates/index.js";
import { buatIsiFaktaCadangan } from "./motion/content.js";
import { renderVideo } from "./motion/render.js";
const t = templatUntuk("2026-11-02");   // Senin -> fakta-angka (bergambar)
const r = await buatIsiFaktaCadangan({ llm, cari, templatId: t.id, topik: "Tinggi Gunung Everest" });
// r = { isi, hook, dasar, narasi, sumber:[{judul,url}], percobaan, templatId }  (templatId bisa "-teks" bila cadangan terpakai)
await renderVideo({ templatId: r.templatId, isi: r.isi, hook: r.hook, narasi: "narasi.wav",
  teaser: "Pelajaran: Siklus air", teaserLabel: "TONTON JUGA",
  tema: temaMinggu(t, "2026-11-02"), keluar: "short.mp4" });
```
- `llm` = `async (prompt) => string`; `cari` = `async (topik) => [{judul,url,cuplikan}]` (pasang dari pencarian web bot).
- AI hanya boleh memakai fakta yang ada di cuplikan bernomor; wajib menyebut minimal 2 sumber dari domain berbeda; angka/tahun kunci harus muncul di cuplikan yang dikutip (`angkaAdaDiSumber`); filter ramah keluarga (`KATA_TIDAK_RAMAH`); bila bukti kurang, AI mengembalikan `{"tidakCukup":true}` dan fungsi gagal dengan jelas (jangan mengarang). Coba ulang sampai 3 kali dengan umpan balik galat.
- Hasil `dasar` + `sumber` ditampilkan ke pemilik saat persetujuan Telegram.

## Metadata YouTube (`youtube-meta.js`)
`metaShorts({templatId,isi,hook,topik,kanal,tanggal,sumber,linkVideo})` → judul (≤100 karakter, berakhir `#Shorts`), deskripsi (baris "Sumber:" + tautan video pelajaran hari ini), tag, `madeForKids: true`, `containsSyntheticMedia: true`.

## Tema mingguan dua jalur (`tema-mingguan.js`)
Tiap pekan bot mengusulkan 7 hari, masing-masing punya dua topik: **fakta** (untuk Short) dan **pelajaran** (untuk video 16:9). Pemilik bisa:
`setuju`, `ulang`, `ganti 3: topik` (fakta), `pelajaran 3: topik` / `video 3: topik`, `tukar 2 5`, `hapus 4`, `tema: topik saya; lain` (antrean fakta pemilik, dipakai lebih dulu), `tema pelajaran: ...`, `daftar tema`, atau kalimat bebas yang diterapkan lewat AI. Tombol Telegram: `tema:setuju|ulang|revisi:<minggu>`. Bila pemilik tidak menjawab, `setujuiOtomatis` menyetujui usulan (dapat dimatikan). `catatRiwayat` mencegah topik berulang. Status disimpan di berkas JSON (tulis atomik).

## Permintaan video lewat WhatsApp (`perintah-wa.js`)
Siapa pun yang diizinkan bisa meminta video langsung ke nomor bot atau di grup: "buatkan video tentang gunung tertinggi di dunia", "/video peringkat: 3 hewan tercepat", "/video mitos: ...", "/video kuis: perkalian 7 dan 8" (tambahan: "tanpa suara", "hd"). Jadwal otomatis tidak terganggu.
- Satu pintu: `tanganiPesanWa({teks, pengirim, adalahPemilik, grup, disebut, deps:{llm,cari,tts}, kirimTeks, kirimVideo, antrean, pembatas, konfig})` → `true` bila pesan sudah ditangani, `false` bila bukan perintah video (alur bot lanjut seperti biasa). Tidak menyentuh Baileys; semua sambungan disuntikkan.
- Izin: pemilik selalu boleh (tanpa batas). Orang lain hanya bila `WA_VIDEO_SEMUA=1`, grupnya ada di `WA_VIDEO_GRUP`, atau nomornya ada di `WA_VIDEO_PENGIRIM`; dibatasi `WA_VIDEO_SELANG_MENIT` (10) dan `WA_VIDEO_MAKS_HARIAN` (3). Di grup, bot hanya menanggapi bila di-mention/dibalas atau memakai `/video`.
- Antrean satu-per-satu (`buatAntrean`, maks. `WA_VIDEO_MAKS_ANTREAN` = 3 menunggu); pakai satu instans yang sama dengan job terjadwal supaya render tidak bertabrakan.
- Fakta tetap berbasis sumber web (sama seperti job harian); bila sumber kurang, video tidak dibuat. Topik tidak ramah keluarga ditolak. Tanpa jenis eksplisit, dipakai templat hari ini lalu cadangan serbaguna.
- Hasil dikirim sebagai video 720x1280 (hd = 1080x1920) dengan keterangan judul, dasar fakta, dan sumber; berkas sementara dihapus setelah terkirim.

## Pemakaian lain
- `buatIsi` (di `content.js`) membuat isi templat pelajaran dengan pemeriksaan hitungan deterministik.
- Bila tanpa narasi, video tetap jadi dengan musik + efek.

## Menambah templat baru
Salin satu berkas di `templates/`, ubah `id`, `tema`, `rapikan` (validasi isi), `narasi`, `bangun` (durasi, `gambar(g,t)`, `efek`), lalu daftarkan di `templates/index.js`. Semua koordinat memakai kanvas 720×1280; `gambar` murni fungsi waktu `t` (deterministik per frame). Lihat `engine.js` untuk pembantu (paragraf, kartu, pil, easing).

## Uji dan contoh
- `node test-motion.mjs` (tes lengkap; render uji dilewati bila `@napi-rs/canvas`/ffmpeg tidak ada).
- `node motion/render-contoh.mjs folder 1.5` merender 7 contoh Short (1080×1920).
- Font Inter (lisensi SIL OFL 1.1) disertakan dalam `fonts/` (subset Latin).

## Foto stok (Shutterstock) - `../media/gambar-stok.js`
Bukan bagian motion, tetapi dikirim dalam paket yang sama. Perintah WA (pemilik; kirim fotonya sebagai DOKUMEN supaya tidak dikecilkan WhatsApp): keterangan `upscale` (perbesar bila di bawah 4 MP, target 5 MP, hasil JPEG kualitas tertinggi, dikirim balik sebagai dokumen), `cek shutterstock` (hanya laporan syarat), `/stok bantuan`.
Batas: pembesaran maksimal 2,5 kali (di atasnya ditolak, pasti buram); di atas 1,6 kali diberi peringatan. Pembesaran tidak menambah detail asli. `node test-gambar-stok.mjs` untuk tes.
