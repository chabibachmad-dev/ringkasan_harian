// Tujuh gaya Shorts harian (bergambar). Tiap gaya = satu hari, satu tema warna, satu panduan struktur untuk AI, dan satu contoh lengkap.
// Id sama dengan templat teks lama (fakta-angka dst.); versi teks lama tersedia dengan akhiran "-teks" sebagai cadangan.
import { buatTemplatPenjelas } from "./penjelas.js";

const SUMBER_CONTOH = "Contoh tampilan. Isi video asli diambil dari sumber web.";
const o = (id, jenis, x, y, s, baris, extra = {}) => ({ id, jenis, x, y, s, baris, ...extra });

export const GAYA = [
  buatTemplatPenjelas({
    id: "fakta-angka", nama: "Fakta Bergambar: Angka", hari: 1, tema: "forest",
    arahan: "satu angka yang mengejutkan. Bab 1 mengenalkan bendanya, bab 2 menyebut angka utama (di kalimat dan di panel batang yang membandingkannya dengan hal lain); angka harus tertulis di SUMBER.",
    contoh: { judul: "Seberapa tinggi Gunung Everest?", sumberTeks: SUMBER_CONTOH, inti: "Everest setinggi **8.849 meter**, atap dunia.", bab: [
      { judul: "Puncak dunia", chip: "Setinggi **apa**?", fokus: "lebar", baris: ["Gunung **Everest** adalah puncak tertinggi di dunia.", "Letaknya di perbatasan Nepal dan Tiongkok."],
        objek: [o("aw", "awan", 22, 22, 0.9, 0, { masuk: "kiri" }), o("gn", "gunung", 50, 62, 2.0, 0, { masuk: "naik", label: "Gunung Everest" }), o("mt", "matahari", 84, 20, 0.8, 1, { masuk: "jatuh" })], panah: [] },
      { judul: "Seberapa tinggi", chip: "Tinggi **8.849** meter", fokus: "lebar", baris: ["Tingginya **8.849** meter di atas permukaan laut.", "Itu lebih dari sepuluh kali tinggi gedung tertinggi di dunia."],
        objek: [o("gn2", "gunung", 30, 55, 1.3, 0), o("or", "orang", 72, 62, 0.9, 1, { masuk: "kanan", label: "kamu" })], panah: [],
        panel: { judul: "tinggi (meter)", maks: 8849, muncul: 0, baris: [{ nama: "Everest", nilai: 8849, tampil: "8.849" }, { nama: "Gedung tertinggi", nilai: 828, tampil: "828" }] } }
    ] }
  }),
  buatTemplatPenjelas({
    id: "peringkat", nama: "Fakta Bergambar: Peringkat", hari: 2, tema: "plum",
    arahan: "peringkat 3 teratas. Satu bab untuk satu peringkat, urut dari nomor 3, nomor 2, lalu nomor 1 paling akhir; tiap bab menampilkan bendanya besar dengan label nama dan satu angka pembeda dari SUMBER.",
    contoh: { judul: "3 benda terbesar di tata surya", sumberTeks: SUMBER_CONTOH, inti: "Tiga terbesar: **Matahari**, **Jupiter**, lalu **Saturnus**.", bab: [
      { judul: "Nomor 3", chip: "Nomor **3**: Saturnus", fokus: "lebar", baris: ["Nomor tiga, **Saturnus**, selebar sekitar 116 ribu kilometer.", "Ia terkenal karena cincinnya yang indah."],
        objek: [o("sa", "planet", 50, 50, 1.7, 0, { masuk: "tumbuh", label: "Saturnus" }), o("b1", "bintang", 14, 20, 0.5, 1), o("b2", "bintang", 86, 78, 0.6, 1)], panah: [] },
      { judul: "Nomor 2", chip: "Nomor **2**: Jupiter", fokus: "lebar", baris: ["Nomor dua, **Jupiter**, selebar sekitar 140 ribu kilometer.", "Lebih dari seribu Bumi muat di dalamnya."],
        objek: [o("ju", "planetPolos", 40, 50, 2.0, 0, { masuk: "tumbuh", label: "Jupiter" }), o("bu", "bumi", 84, 28, 0.5, 1, { label: "Bumi" })], panah: [] },
      { judul: "Nomor 1", chip: "Juaranya: **Matahari**", fokus: "lebar", baris: ["Nomor satu, **Matahari**, selebar sekitar 1,39 juta kilometer.", "Hampir sepuluh kali lebih besar dari Jupiter."],
        objek: [o("mt", "matahari", 52, 42, 2.0, 0, { masuk: "tumbuh", label: "Matahari" }), o("j2", "planetPolos", 14, 82, 0.6, 1, { label: "Jupiter" }), o("b3", "bumi", 88, 84, 0.5, 1)], panah: [] }
    ] }
  }),
  buatTemplatPenjelas({
    id: "mitos-fakta", nama: "Fakta Bergambar: Mitos atau Fakta", hari: 3, tema: "wine",
    arahan: "meluruskan mitos. Bab 1 menyebut mitosnya (kalimat diawali 'Katanya'), bab 2 membongkar faktanya, bab 3 menjelaskan sebabnya; fakta harus tertulis di SUMBER.",
    contoh: { judul: "Petir tidak menyambar dua kali?", sumberTeks: SUMBER_CONTOH, inti: "Petir **bisa** menyambar tempat yang sama, terutama benda **tinggi**.", bab: [
      { judul: "Mitosnya", chip: "Mitos atau **fakta**?", fokus: "lebar", baris: ["Katanya, petir **tidak pernah** menyambar tempat yang sama dua kali."],
        objek: [o("aw", "hujan", 50, 20, 1.6, 0, { masuk: "kiri" }), o("pt", "petir", 50, 50, 0.9, 0, { masuk: "jatuh" }), o("rm", "rumah", 50, 80, 1.4, 0, { masuk: "naik", label: "satu tempat" })], panah: [] },
      { judul: "Faktanya", chip: "Ternyata **salah**", fokus: "lebar", baris: ["Petir **bisa** menyambar tempat yang sama berulang kali.", "Gedung yang sangat tinggi bisa tersambar puluhan kali dalam setahun."],
        objek: [o("aw2", "hujan", 50, 16, 1.4, 0), o("p1", "petir", 26, 46, 0.9, 0, { masuk: "jatuh" }), o("p2", "petir", 74, 46, 0.9, 0, { masuk: "jatuh" }), o("rm2", "rumah", 50, 80, 1.4, 1, { label: "gedung tinggi" })], panah: [] },
      { judul: "Sebabnya", chip: "Jalan **termudah**", fokus: "lebar", baris: ["Petir mencari jalan termudah ke tanah, yaitu benda yang **tinggi**."],
        objek: [o("pt3", "petir", 50, 34, 1.0, 0, { masuk: "jatuh" }), o("pn", "pohon", 22, 72, 1.3, 0), o("rm3", "rumah", 78, 72, 1.2, 0)], panah: [{ dari: "pt3", ke: "rm3", baris: 0, label: "jalan termudah" }] }
    ] }
  }),
  buatTemplatPenjelas({
    id: "perbandingan-bar", nama: "Fakta Bergambar: Perbandingan", hari: 4, tema: "ink",
    arahan: "membandingkan dua hal atau lebih. Bab pertama dan kedua masing-masing satu sisi perbandingan; bab terakhir memakai panel batang berisi angka pembanding yang tertulis di SUMBER.",
    contoh: { judul: "Beku dan mendidih", sumberTeks: SUMBER_CONTOH, inti: "Air beku di **0** derajat dan mendidih di **100** derajat.", bab: [
      { judul: "Air membeku", chip: "Suhu **0** derajat", fokus: "lebar", baris: ["Air membeku pada suhu **0** derajat Celsius.", "Di suhu ini, air berubah menjadi es."],
        objek: [o("th", "termometer", 28, 52, 1.6, 0, { nilai: 0.05 }), o("td", "tetes", 72, 52, 1.4, 1, { masuk: "naik", label: "air" })], panah: [] },
      { judul: "Air mendidih", chip: "Suhu **100** derajat", fokus: "lebar", baris: ["Air mendidih pada suhu **100** derajat Celsius.", "Air berubah menjadi uap yang naik ke atas."],
        objek: [o("th2", "termometer", 28, 52, 1.6, 0, { nilai: 1 }), o("aw", "awan", 72, 32, 1.0, 1, { masuk: "naik", label: "uap" }), o("td2", "tetes", 72, 76, 0.8, 0)], panah: [] },
      { judul: "Bandingkan", chip: "Selisih **100** derajat", fokus: "lebar", baris: ["Dari beku sampai mendidih, selisihnya **100** derajat."],
        objek: [o("t3", "termometer", 25, 40, 1.2, 0, { nilai: 0.05 }), o("t4", "termometer", 75, 40, 1.2, 0, { nilai: 1 })], panah: [],
        panel: { judul: "suhu air (derajat Celsius)", maks: 100, muncul: 0, baris: [{ nama: "Membeku", nilai: 0, tampil: "0" }, { nama: "Mendidih", nilai: 100, tampil: "100" }] } }
    ] }
  }),
  buatTemplatPenjelas({
    id: "proses-tahapan", nama: "Fakta Bergambar: Proses", hari: 5, tema: "ocean",
    arahan: "proses bertahap. Tiap bab satu tahap berurutan; pakai panah antar benda untuk menunjukkan arah proses, dan tutup dengan siklus yang berulang bila ada.",
    contoh: { judul: "Bagaimana hujan terbentuk?", sumberTeks: SUMBER_CONTOH, inti: "Hujan terjadi lewat **menguap**, **mengembun**, lalu **turun** lagi.", bab: [
      { judul: "Air menguap", chip: "Air **menguap**", fokus: "lebar", baris: ["Matahari memanaskan air laut.", "Air berubah jadi **uap** dan naik ke langit."],
        objek: [o("mt", "matahari", 16, 16, 0.9, 0, { masuk: "jatuh" }), o("om", "ombak", 50, 88, 1.9, 0, { masuk: "naik" }), o("aw", "awan", 74, 30, 1.0, 1, { masuk: "naik", label: "uap" })], panah: [{ dari: "om", ke: "aw", baris: 1, label: "naik" }] },
      { judul: "Jadi awan", chip: "Uap jadi **awan**", fokus: "lebar", baris: ["Di langit yang dingin, uap **mengembun**.", "Titik-titik air kecil berkumpul menjadi **awan**."],
        objek: [o("a1", "awan", 28, 38, 1.3, 0, { masuk: "tumbuh" }), o("a2", "awan", 68, 34, 1.7, 1, { masuk: "tumbuh" }), o("td", "tetes", 50, 76, 0.8, 1, { masuk: "naik", label: "titik air" })], panah: [] },
      { judul: "Turun jadi hujan", chip: "Turun jadi **hujan**", fokus: "lebar", baris: ["Awan menjadi berat, lalu air jatuh sebagai **hujan**.", "Air mengalir kembali ke laut dan siklus **berulang**."],
        objek: [o("hj", "hujan", 50, 26, 1.9, 0, { masuk: "tumbuh" }), o("gn", "gunung", 20, 72, 0.8, 1), o("om2", "ombak", 62, 90, 1.2, 1, { masuk: "naik" })], panah: [{ dari: "hj", ke: "om2", baris: 1, label: "kembali ke laut" }] }
    ] }
  }),
  buatTemplatPenjelas({
    id: "garis-waktu", nama: "Fakta Bergambar: Garis Waktu", hari: 6, tema: "dusk",
    arahan: "urutan peristiwa dari yang tertua. Tiap bab satu peristiwa dengan tahunnya di chip dan label; setiap tahun harus tertulis di SUMBER.",
    contoh: { judul: "Perjalanan manusia ke Bulan", sumberTeks: SUMBER_CONTOH, inti: "Dari **1957** sampai **1969**, manusia berhasil sampai ke **Bulan**.", bab: [
      { judul: "Tahun 1957", chip: "Tahun **1957**", fokus: "lebar", baris: ["Tahun **1957**, satelit buatan pertama diluncurkan ke angkasa."],
        objek: [o("bu", "bumi", 32, 58, 1.5, 0, { label: "Bumi" }), o("rk", "roket", 72, 48, 0.9, 0, { masuk: "naik", label: "1957" })], panah: [] },
      { judul: "Tahun 1961", chip: "Tahun **1961**", fokus: "lebar", baris: ["Tahun **1961**, Yuri Gagarin menjadi manusia pertama di luar angkasa.", "Ia mengelilingi Bumi satu kali."],
        objek: [o("bu2", "bumi", 28, 62, 1.3, 0), o("rk2", "roket", 66, 34, 1.0, 0, { masuk: "naik", label: "1961" }), o("or", "orang", 76, 80, 0.8, 1, { masuk: "jatuh", label: "Gagarin" })], panah: [] },
      { judul: "Tahun 1969", chip: "Tahun **1969**", fokus: "lebar", baris: ["Tahun **1969**, Apollo 11 mendarat di Bulan.", "Neil Armstrong menjadi manusia pertama yang berjalan di sana."],
        objek: [o("rk3", "roket", 24, 62, 0.9, 0), o("bl", "bulan", 68, 32, 1.6, 0, { masuk: "tumbuh", label: "Bulan" }), o("or2", "orang", 68, 78, 0.9, 1, { masuk: "jatuh", label: "Armstrong" })], panah: [{ dari: "rk3", ke: "bl", baris: 0, label: "1969" }] }
    ] }
  }),
  buatTemplatPenjelas({
    id: "cerita-fakta", nama: "Fakta Bergambar: Cerita", hari: 0, tema: "navy",
    arahan: "bercerita sebab-akibat. Bab 1 mengajukan pertanyaan atau keadaan awal, bab 2 menjelaskan sebabnya, bab 3 akibat atau kesimpulan; semua klaim harus tertulis di SUMBER.",
    contoh: { judul: "Kenapa langit berwarna biru?", sumberTeks: SUMBER_CONTOH, inti: "Langit **biru** karena cahaya biru paling mudah **dihamburkan** udara.", bab: [
      { judul: "Cahaya Matahari", chip: "Cahaya **putih**?", fokus: "lebar", baris: ["Cahaya Matahari terlihat putih.", "Padahal isinya banyak warna, seperti **pelangi**."],
        objek: [o("mt", "matahari", 24, 36, 1.4, 0, { masuk: "jatuh", label: "cahaya putih" }), o("pl", "pelangi", 74, 58, 1.5, 1, { masuk: "tumbuh", label: "banyak warna" })], panah: [{ dari: "mt", ke: "pl", baris: 1, label: "terurai" }] },
      { judul: "Cahaya terhambur", chip: "Biru **terhambur**", fokus: "lebar", baris: ["Di udara, cahaya **biru** paling mudah dihamburkan.", "Ia terpantul ke segala arah."],
        objek: [o("mt2", "matahari", 20, 22, 0.9, 0, { masuk: "jatuh" }), o("bu", "bumi", 56, 78, 1.4, 0, { masuk: "naik", label: "udara bumi" })], panah: [{ dari: "mt2", ke: "bu", baris: 1, label: "terhambur" }] },
      { judul: "Langit biru", chip: "Jadi langit **biru**", fokus: "lebar", baris: ["Cahaya biru menyebar ke seluruh langit, jadi langit tampak **biru**.", "Saat senja, langit tampak **jingga**."],
        objek: [o("rm", "rumah", 24, 80, 1.2, 0), o("a1", "awan", 34, 30, 1.2, 0, { masuk: "naik" }), o("mt3", "matahari", 78, 74, 1.0, 1, { masuk: "naik", label: "senja" })], panah: [] }
    ] }
  })
];
