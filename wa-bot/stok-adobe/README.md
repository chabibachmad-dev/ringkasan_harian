# Paket Adobe Stock lewat WhatsApp (`stok-adobe/`)

Bot **menyiapkan** paket (ikon SVG + latar/pola JPEG + CSV metadata + lembar pratinjau, dalam satu zip). **Mengunggah dan menekan Submit tetap dilakukan pemilik** di contributor.stock.adobe.com: Adobe tidak punya API publik untuk unggah.

## Perintah (hanya pemilik)
- `/adobe ikon dan latar ramadan 12 ikon 3 latar` -> bot menyusun rencana
- `/adobe video ramadan 3` -> latar gerak loop (MP4 1920x1080, 30 fps, 10 dtk, tanpa suara); tambah kata `vertikal` untuk 1080x1920
- `/adobe ikon 3d ramadan 6` -> ikon 3D (JPEG ilustrasi 2400x2400, 5,8 MP)
- `/adobe ikon idul adha 8` -> tema baru: ikon disusun AI (eksperimental), WAJIB dicek lewat pratinjau
- `/adobe setuju` | `/adobe batal` | `/adobe riwayat` | `/adobe bantuan`
- tambahkan `paksa` untuk melewati batas paket per pekan atau membuat ulang gambar yang sudah pernah dibuat

## Isi paket (zip)
`ikon/*.svg` + `metadata-ikon.csv`, `ikon3d/*.jpg` + `metadata-ikon3d.csv`, `latar/*.jpg` + `metadata-latar.csv`, `PETUNJUK.txt` (hanya folder yang diminta). Pratinjau dikirim terpisah sebagai gambar. Satu batch unggah = satu CSV (CSV hanya menempel ke berkas di tab New yang namanya cocok).

## Isi modul
- `ikon-mesin.py` : mesin ikon (Python + `skia-pathops`): 24 ikon Ramadan/Lebaran bawaan + DSL JSON untuk ikon baru. Semua ikon: satu bentuk gabungan, tanpa goresan, jalur tertutup, di dalam kotak 64x64.
- `latar-mesin.mjs` : 6 latar/pola (5400x3600, 19,4 MP) dengan `@napi-rs/canvas`.
- `ikon3d-blender.py` + `ikon3d-pilih.mjs` : OPSI render 3D SEJATI dengan Blender (ekstrusi + bevel + material + 3 lampu area + bayangan, Cycles CPU, denoise). `ikon3d-pilih.mjs` memilih mesin lewat `STOK_3D` dan otomatis jatuh ke render JS bila Blender tidak ada, gagal, atau melewati batas waktu.
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
- Ikon 3D adalah **JPEG ilustrasi** (bukan vektor): saat mengunggah pilih tipe Illustration dan **jangan** centang "This is an icon". Syarat ilustrasi Adobe: JPEG, sRGB, 4-100 MP, maks 45 MB; keluaran JS 2400x2400 = 5,76 MP (Blender 2048x2048 = 4,19 MP).
- Bentuknya sama dengan ikon datar yang sudah diunggah, dan Adobe menganggap variasi kecil dari desain yang sama sebagai mirip (maks 3 versi). Bot menambahkan catatan ini pada rencana. Mulai dengan 4-6 ikon 3D dan lihat hasil review; subjek yang belum punya versi datar lebih aman.
- Judul diawali "3D ...", kata kunci memuat "3d icon, 3d render, 3d illustration, clay render, ...". AI yang menulis metadata selalu divalidasi.
- Label AI: ikon digambar program (bukan generator gambar), tetapi program ditulis dengan bantuan AI; putuskan dan konsisten (saran aman: centang "Created using generative AI tools").

## Batasan jujur
- Adobe tidak punya API unggah publik: bot hanya menyiapkan, kamu mengunggah dan Submit.
- Ikon susunan AI (tema baru) belum teruji kualitasnya; selalu periksa pratinjau.
- Latar bawaan hanya 6 desain; tema baru untuk latar butuh desain baru yang kita buat bersama (variasi warna dari desain yang sama dianggap mirip).
- Tidak ada jaminan lolos review atau laku; penghasilan stok umumnya datang dari portofolio besar yang konsisten.

## Ikon 3D dengan Blender (opsional)
Bawaan tetap render JS (cepat, tanpa pemasangan). Untuk hasil 3D sungguhan (ketebalan, tepi membulat, bayangan jatuh yang nyata):

1. Pasang salah satu: (a) program Blender (`sudo apt install blender`, atau unduh dari blender.org) lalu `export BLENDER_BIN=/usr/bin/blender`; atau (b) modul Python: `python3 -m venv ~/venv-bpy && ~/venv-bpy/bin/pip install bpy` lalu `export STOK_BPY_PYTHON=~/venv-bpy/bin/python` (unduhan sekitar 400 MB, terpasang sekitar 1 GB).
2. `export STOK_3D=blender` (atau `auto` = pakai Blender bila terdeteksi). Tanpa itu, bot memakai render JS.
3. Opsional: `STOK_BLENDER_SAMPEL=32` (makin tinggi makin halus dan lambat), `STOK_BLENDER_TIMEOUT_MS=600000`.

Uji manual satu ikon: `blender -b -P stok-adobe/ikon3d-blender.py -- --svg ikon.svg --keluar hasil.jpg --warna "#10b981" --bahan clay` (bahan: clay, kilap, logam; ukuran bawaan 2048 px = 4,2 MP, memenuhi syarat minimal 4 MP).

Yang perlu diketahui:
- **Lambat di CPU**: sekitar 3,5 menit per ikon (2048 px, 32 sampel, 2 inti). Satu paket 6 ikon 3D bisa 20 menit lebih. Blender dijalankan sebagai proses anak asinkron (bot tetap menjawab pesan lain) dan satu per satu; gunakan jumlah ikon 3D kecil (4-6) dan sampel lebih rendah bila mesin lemah.
- **Bentuk dari SVG**: ikon yang berupa siluet padat (masjid, hilal, hadiah, bedug) hasilnya paling bagus. Ikon bergaya garis tipis (ketupat, lentera) terpotong-potong menjadi lempengan karena pembuatnya memotong banyak celah; periksa pratinjau sebelum diunggah.
- Beberapa lubang sempit (jendela menara masjid) tampak gelap karena tidak terkena cahaya; ini normal untuk rendering fisik, tetapi periksa pratinjau.
- Hasil tetap JPEG ilustrasi (bukan vektor): tipe Illustration, jangan centang "This is an icon", dan beri label AI.
- Blender gagal atau melebihi batas waktu: bot memakai render JS dan menulis "Info 3D" pada ringkasan paket.

## Video latar gerak (Adobe Stock)
Perintah: `/adobe video ramadan 3`, `/adobe video batik 2 vertikal`, `/adobe latar gerak 2`, `/adobe ikon ramadan 4 dan 2 video`. Maks 4 klip per paket. Lalu `/adobe setuju`.

- **Desain** (`video-mesin.mjs`): bintang-islami-emas, kawung-bergulir (batik), lentera-melayang, bulan-bintang-malam, gradien-cair, bokeh-emas. Digambar dari kode (@napi-rs/canvas) dan di-encode ffmpeg (H.264, yuv420p, bt709, tanpa audio). Semua loop mulus (frekuensi bilangan bulat per putaran atau bergeser tepat satu ubin; diuji: frame awal = frame akhir).
- **Pemeriksa spesifikasi** (`periksaVideo`, memakai ffprobe) mengikuti halaman bantuan Adobe: MP4/MOV, H.264, 5-60 dtk, frame rate 23,98/24/25/29,97/30/50/59,94/60, resolusi horizontal 1920x1080 dan seterusnya atau vertikal 1080x1920 dan seterusnya, maks 3,9 GB. Klip yang tidak lolos dibuang dari paket dan dilaporkan sebagai "Gagal".
- **Isi zip**: `video/*.mp4`, `metadata-video.csv`, `metadata-video.txt` (judul, kata kunci, kategori, label AI, spesifikasi), `PETUNJUK.txt`. Klip vertikal berakhiran `-v.mp4`, judul berawalan "Vertical", kata kunci memuat "vertical video" (saran Adobe). Apakah portal menyediakan Upload CSV untuk video belum diverifikasi; bila tidak ada, salin dari metadata-video.txt.
- **Waktu render**: sekitar 1 menit per klip (2 inti). ffmpeg memakai `STOK_FFMPEG_THREADS` (bawaan 2) supaya bot tidak kehabisan CPU. Render berjalan asinkron.
- **Ukuran zip**: beberapa MB sampai puluhan MB (desain bergaris halus lebih besar), aman untuk dokumen WA.
- Desain `bintang-islami-emas` sudah diunggah pemilik (tercatat di `SUDAH_DIUNGGAH.video`), jadi tidak dibuat lagi kecuali memakai kata `paksa`. Versi vertikal dari desain yang sama dianggap mirip oleh Adobe (maks 3 versi).
- **Jujur soal kualitas**: ini latar sederhana buatan kode; ada risiko ditolak karena kualitas atau dianggap terlalu polos. Periksa pratinjau, unggah sedikit dulu, dan lihat hasil moderasi.
