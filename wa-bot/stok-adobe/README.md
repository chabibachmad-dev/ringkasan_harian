# Paket Adobe Stock lewat WhatsApp (`stok-adobe/`)

Bot **menyiapkan** paket (ikon SVG + latar/pola JPEG + CSV metadata + lembar pratinjau, dalam satu zip). **Mengunggah dan menekan Submit tetap dilakukan pemilik** di contributor.stock.adobe.com: Adobe tidak punya API publik untuk unggah.

## Perintah (hanya pemilik)
- `/adobe ikon dan latar ramadan 12 ikon 3 latar` -> bot menyusun rencana
- `/adobe ikon 3d ramadan 6` -> ikon 3D (JPEG ilustrasi 2400x2400, 5,8 MP)
- `/adobe ikon idul adha 8` -> tema baru: ikon disusun AI (eksperimental), WAJIB dicek lewat pratinjau
- `/adobe setuju` | `/adobe batal` | `/adobe riwayat` | `/adobe bantuan`
- tambahkan `paksa` untuk melewati batas paket per pekan atau membuat ulang gambar yang sudah pernah dibuat

## Isi paket (zip)
`ikon/*.svg` + `metadata-ikon.csv`, `ikon3d/*.jpg` + `metadata-ikon3d.csv`, `latar/*.jpg` + `metadata-latar.csv`, `PETUNJUK.txt` (hanya folder yang diminta). Pratinjau dikirim terpisah sebagai gambar. Satu batch unggah = satu CSV (CSV hanya menempel ke berkas di tab New yang namanya cocok).

## Isi modul
- `ikon-mesin.py` : mesin ikon (Python + `skia-pathops`): 24 ikon Ramadan/Lebaran bawaan + DSL JSON untuk ikon baru. Semua ikon: satu bentuk gabungan, tanpa goresan, jalur tertutup, di dalam kotak 64x64.
- `latar-mesin.mjs` : 6 latar/pola (5400x3600, 19,4 MP) dengan `@napi-rs/canvas`.
- `ikon3d.mjs` : render 3D murni JS (tanpa Chromium/Blender): siluet SVG -> jarak ke tepi -> bidang tinggi membulat -> normal -> cahaya (difus, kilap Blinn-Phong, rim) + bayangan lembut + latar abu terang. Bahan: `clay`, `kilap`, `logam`; palet: zamrud, emas, nila, koral, langit, mawar, krem. Ini render 2,5D tampak depan, BUKAN model 3D penuh; kualitasnya di bawah render Blender profesional.
- `metadata.js` : judul (maks 70, tanpa koma), kata kunci (maks 50, unik, tanpa merek), CSV persis header templat Adobe, validasi; AI menulis metadata dan hasilnya selalu divalidasi, bila gagal dipakai bawaan katalog.
- `stok-adobe.js` : perintah, rencana, riwayat (mencegah gambar mirip dan membatasi paket per pekan), pembuat paket, penangan WA (`tanganiStokWa`).

## Pengaman
- `SUDAH_DIUNGGAH` memuat 24 ikon + 6 latar paket pertama; bot tidak membuatnya lagi (Adobe menolak konten mirip, maks 3 versi).
- Batas paket per 7 hari (`WA_ADOBE_MAKS_PEKAN`, default 2) agar tidak menumpuk konten dan melewati batas pengiriman Adobe.
- Label AI: putuskan dan konsisten. Ikon AI-DSL belum teruji kualitasnya: selalu lihat pratinjau.

## Pemasangan
`pip install skia-pathops` (disarankan di venv; isi `STOK_PYTHON=/jalur/venv/bin/python`), `npm i @napi-rs/canvas`, lalu panggil `tanganiStokWa` dari penangan pesan WA (lihat prompt Claude Code). Tes: `node test-stok-adobe.mjs` (bagian Python dan canvas dilewati bila tidak terpasang).

## Ikon 3D: yang perlu diketahui
- Ikon 3D adalah **JPEG ilustrasi** (bukan vektor): saat mengunggah pilih tipe Illustration dan **jangan** centang "This is an icon". Syarat ilustrasi Adobe: JPEG, sRGB, 4-100 MP, maks 45 MB; keluaran 2400x2400 = 5,76 MP.
- Bentuknya sama dengan ikon datar yang sudah diunggah, dan Adobe menganggap variasi kecil dari desain yang sama sebagai mirip (maks 3 versi). Bot menambahkan catatan ini pada rencana. Mulai dengan 4-6 ikon 3D dan lihat hasil review; subjek yang belum punya versi datar lebih aman.
- Judul diawali "3D ...", kata kunci memuat "3d icon, 3d render, 3d illustration, clay render, ...". AI yang menulis metadata selalu divalidasi.
- Label AI: ikon digambar program (bukan generator gambar), tetapi program ditulis dengan bantuan AI; putuskan dan konsisten (saran aman: centang "Created using generative AI tools").

## Batasan jujur
- Adobe tidak punya API unggah publik: bot hanya menyiapkan, kamu mengunggah dan Submit.
- Ikon susunan AI (tema baru) belum teruji kualitasnya; selalu periksa pratinjau.
- Latar bawaan hanya 6 desain; tema baru untuk latar butuh desain baru yang kita buat bersama (variasi warna dari desain yang sama dianggap mirip).
- Tidak ada jaminan lolos review atau laku; penghasilan stok umumnya datang dari portofolio besar yang konsisten.
