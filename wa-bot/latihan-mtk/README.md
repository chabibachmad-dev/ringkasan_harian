# Latihan Matematika (modul mandiri)

Lembar hitung "bersusun" untuk anak SD: kotak simpanan/pinjam putus-putus di atas, angka, tanda operasi, garis, dan kotak jawaban putus-putus di bawah.
Tanpa pustaka luar. Soal dibangkitkan program (bukan daftar tetap), jawaban dihitung ulang sehingga selalu benar.

## Isi
- Penjumlahan, pengurangan, perkalian (baris parsial), pembagian bersusun (porogapit, dengan sisa)
- Soal cerita (pilih operasi dulu, lalu hitung), pecahan (sejenis, beda penyebut, sederhanakan, kali, bagi)
- KPK, FPB, faktor, dan tabel perkalian/pembagian dasar (10 soal cepat)
- Kelas 1-6 x Mudah/Sedang/Sulit; pilihan kelas dan tingkat diingat per pemain

## Pemakaian
```js
import { bukaLatihanMatematika } from "./latihan-mtk/ui.js";
const mtk = bukaLatihanMatematika({
  tempat: elemen, bahasa: "id", pemain: "nama", kelas: 3,
  onPoin: (poin, info) => {},   // dipanggil tiap ada poin (jenis "soal" atau "bonus")
  onSoal: (info) => {},         // tiap soal selesai
  onSesi: (info) => {},         // tiap sesi selesai (bintang, ringkasan)
  onTutup: () => {},
});
```
`info` memuat: sesiId, topik, kelas, tingkat, nomor, benar, benarPertama, percobaan, bantuan, poin, durasiMs.

## Aturan poin
Percobaan pertama benar = poin penuh (tambah/kurang/kali 2-3-5, bagi/cerita/pecahan/KPK 3-4-6, tabel 1-1-2 untuk mudah-sedang-sulit); percobaan kedua = separuh;
setelah "Lihat caranya" = 0. Sesi 5 soal semuanya benar di percobaan pertama = bonus +5.
Poin dilaporkan dari perangkat, jadi server sebaiknya membatasi (lihat prompt integrasi).

## Berkas
`soal.js` mesin soal (murni), `ui.js` tampilan, `latihan-matematika.html` halaman mandiri untuk uji di ponsel/peramban, `../test-latihan-mtk.mjs` pengujian.
Bangun ulang halaman: `node build-halaman.mjs` (butuh esbuild).
