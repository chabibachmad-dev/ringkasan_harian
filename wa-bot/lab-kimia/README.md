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
| senyawa-lanjut.js | senyawa nyata tambahan (total 126) + contoh pemakaian di dunia nyata (ID/EN) |
| tantangan.js | aturan Mode Tantangan: baca rumus pemain, alasan 'tidak bisa digabung', bintang & beruntun, soal acak |
| ui.js | antarmuka: `bukaLabKimia({ tempat, bahasa, pemain, tab, onTutup, tanpaHeader, simpanBerkas })` |
| lab-kimia.html | halaman mandiri siap unggah (tanpa build) |
| demo.html | halaman uji mandiri (buka langsung di browser HP) |

Pemakaian di PWA: `import { bukaLabKimia } from "./lab-kimia/ui.js"`; panggil dengan elemen penampung.
Koleksi disimpan di localStorage per pemain (`lk_koleksi_v1:<pemain>`). Tema mengikuti `html[data-theme]`.
Uji: `node test-lab-kimia.mjs` (dari folder wa-bot).

## Mode Tantangan
Tab Laboratorium punya dua mode. **Tantangan** (bawaan): pemain menyusun bahan, menulis rumus kimianya (mis. C1 + O2 -> CO2), lalu menekan Gabungkan.
Rumus tidak cocok -> petunjuk (tanpa hukuman). Cocok tetapi tidak bisa digabung (gas mulia, radioaktif, logam-logam/paduan, perbandingan salah, belum terdaftar) -> penjelasan alasannya.
Berhasil -> nama, keterangan, dan contoh pemakaian di dunia nyata; bintang 3/2/1 menurut jumlah percobaan, "beruntun" bila benar di percobaan pertama, soal acak memberi bonus 1 bintang.
Skor disimpan per pemain di localStorage (`lk_skor_v1:<pemain>`), mode di `lk_mode_v1`. **Bebas**: racik tanpa menulis rumus; kombinasi tak dikenal menjadi zat khayalan.
