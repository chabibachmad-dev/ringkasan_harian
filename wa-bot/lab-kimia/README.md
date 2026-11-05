# Laboratorium Kimia (modul mandiri)

Tabel periodik pixel berwarna (118 unsur), popup unsur yang bisa disimpan sebagai gambar/PDF, dan laboratorium
untuk meracik bahan tanpa batas jenis menjadi senyawa nyata atau "zat khayalan" bernama + gambar pixel berwarna.

Tanpa dependensi. ES module murni.

| Berkas | Fungsi |
|---|---|
| data.js | 118 unsur, kategori & warna, ~40 senyawa nyata yang aman |
| core.js | parser rumus, racik() deterministik (hasil sama untuk bahan sama), nama & sprite 16x16 |
| font.js | font bitmap 5x7 (tidak bergantung font perangkat) |
| render.js | menggambar tabel/kartu hanya dengan fillRect/fillStyle (kanvas browser atau @napi-rs/canvas) |
| pdf.js | pembuat PDF satu halaman dari JPEG |
| ui.js | antarmuka: `bukaLabKimia({ tempat, bahasa, pemain, tab, onTutup, tanpaHeader, simpanBerkas })` |
| demo.html | halaman uji mandiri (buka langsung di browser HP) |

Pemakaian di PWA: `import { bukaLabKimia } from "./lab-kimia/ui.js"`; panggil dengan elemen penampung.
Koleksi disimpan di localStorage per pemain (`lk_koleksi_v1:<pemain>`). Tema mengikuti `html[data-theme]`.
Uji: `node test-lab-kimia.mjs` (dari folder wa-bot).
