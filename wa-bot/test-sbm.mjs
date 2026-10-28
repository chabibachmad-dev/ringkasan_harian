// Tes kalkulator SBM (sbm.js) dengan data ASLI hasil sbm-build.mjs (data/sbm-pmk32-2025.json).
//   node test-sbm.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSbm, loadSbmData, parseJabatan, parseLama, rupiah } from "./sbm.js";
import { parseProvRows, parseTiketRows, provKey, provDisplay, rp, buildSbm } from "./sbm-build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const data = loadSbmData(path.join(here, "data", "sbm-pmk32-2025.json"));
let clock = 1_000_000;
const mk = () => createSbm({ data, now: () => clock });
const has = (s, ...parts) => typeof s === "string" && parts.every((p) => (p instanceof RegExp ? p.test(s) : s.includes(p)));

// ---- data hasil penyalinan dari PDF
check(data.provinsi.length === 38, "38 provinsi");
check(data.uangHarian.ACEH.luarKota === 360000 && data.uangHarian.BALI.luarKota === 480000 && data.uangHarian.DKIJAKARTA.luarKota === 530000 && data.uangHarian.PAPUAPEGUNUNGAN.luarKota === 580000, "uang harian luar kota: Aceh, Bali, DKI, Papua Pegunungan sesuai PDF");
check(data.uangHarian.BALI.dalamKota8Jam === 190000 && data.uangHarian.BALI.diklat === 140000 && data.uangHarian.BALI.hlm === 15, "uang harian Bali dalam kota & diklat, halaman 15");
check(data.penginapan.BALI.t3 === 1754000 && data.penginapan.BALI.t4 === 1138000 && data.penginapan.DKIJAKARTA.t1 === 9331000 && data.penginapan.DKIJAKARTA.t2 === 2084000 && data.penginapan.BALI.hlm === 19, "penginapan Bali & DKI sesuai PDF");
check(data.representasi.length === 3 && data.representasi[0].luarKota === 250000 && data.representasi[2].luarKota === 150000, "uang representasi");
check(data.tiket.some((t) => t.asal === "JAKARTA" && t.tujuan === "DENPASAR" && t.ekonomi === 3262000 && t.bisnis === 5305000 && t.hlm === 86), "tiket Jakarta–Denpasar");
check(Object.keys(data.uangHarian).every((k) => data.penginapan[k]), "setiap provinsi punya tarif penginapan");
check(Object.values(data.uangHarian).every((u) => u.luarKota > u.dalamKota8Jam && u.dalamKota8Jam > u.diklat), "urutan wajar: luar kota > dalam kota > diklat (deteksi salah baca kolom)");
check(Object.values(data.penginapan).every((p) => p.t1 > 0 && p.t4 > 0 && p.t4 < p.t1), "penginapan: tingkat 4 < tingkat 1");

// ---- fungsi pembuat data (murni)
check(provKey("R I A U") === "RIAU" && provKey("SUMATRA UTARA") === "SUMATERAUTARA" && provKey("SUMATERA UTARA") === "SUMATERAUTARA" && provKey("D.K.I. JAKARTA") === "DKIJAKARTA" && provKey("B A N TE N") === "BANTEN", "provKey: huruf terpisah & ejaan Sumatra/Sumatera");
check(provDisplay("D.I. YOGYAKARTA") === "DI Yogyakarta" && provDisplay("NUSA TENGGARA BARAT") === "Nusa Tenggara Barat" && provDisplay("JAWA BARAT") === "Jawa Barat", "provDisplay");
check(rp("Rp1.754.000") === 1754000, "rp()");
check(parseProvRows(" 17. B A L I     OH   Rp480.000    Rp190.000   Rp140.000").length === 1, "parseProvRows");
check(parseTiketRows("  3.    JAKARTA           BANDA ACEH          Rp7.519.000    Rp4.807.000")[0].ekonomi === 4807000, "parseTiketRows");
{
  let e = null;
  try { buildSbm(["", "", ""]); } catch (x) { e = x; }
  check(e && /tidak sesuai harapan/.test(e.message), "pembuat data menolak PDF yang formatnya lain (tidak diam-diam salah)");
}

// ---- parser
check(parseJabatan("eselon III").tier === 3 && parseJabatan("Eselon 2").tier === 2 && parseJabatan("pejabat eselon I").tier === 1 && parseJabatan("eselon IV").tier === 4, "jabatan: eselon");
check(parseJabatan("golongan IV/a").tier === 3 && parseJabatan("gol III").tier === 4 && parseJabatan("gol. II").tier === 4, "jabatan: golongan IV → tingkat 3, III/II/I → 4");
check(parseJabatan("wakil menteri").tier === 1 && parseJabatan("staf biasa").needsGol === true && parseJabatan("halo") === null, "jabatan: menteri, staf, bukan jabatan");
{
  const l = parseLama("3 hari 2 malam untuk 4 orang");
  check(l.hari === 3 && l.malam === 2 && l.orang === 4, "lama: hari, malam, orang");
}

// ---- satu komponen langsung
{
  const sbm = mk();
  const r = sbm.handle("c1", "berapa uang harian perjalanan dinas ke Bali 3 hari?");
  check(has(r, "Rp480.000", "Rp1.440.000", "hlm 15", "PMK 32/2025"), "uang harian Bali 3 hari = Rp1.440.000 (hlm 15)");
  check(!/Mau dihitung/.test(r), "hari sudah diberikan: tidak bertanya lagi");
}
{
  const sbm = mk();
  const r = sbm.handle("c2", "uang harian ke Papua Pegunungan");
  check(has(r, "Rp580.000", "Mau dihitung untuk berapa hari"), "tanpa hari: angka per hari + tanya jumlah hari");
  const r2 = sbm.handle("c2", "4 hari");
  check(has(r2, "4 hari × Rp580.000", "Rp2.320.000"), "jawaban 'hari' melengkapi: 4 × 580.000 = 2.320.000");
}
{
  const sbm = mk();
  const r = sbm.handle("c3", "tarif hotel eselon II di DKI Jakarta berapa");
  check(has(r, "Rp2.084.000", "Eselon II", "hlm 19"), "hotel Eselon II di DKI = Rp2.084.000 (hlm 19)");
  const r1 = sbm.handle("c3b", "batas tarif hotel di Jakarta");
  check(has(r1, "Rp9.331.000", "Rp2.084.000", "Rp1.062.000", "Rp730.000"), "tanpa jabatan: keempat tingkat ditampilkan, tidak menebak");
}
{
  const sbm = mk();
  const r = sbm.handle("c4", "uang harian dalam kota lebih dari 8 jam di Bali");
  check(has(r, "dalam kota > 8 jam", "Rp190.000"), "dalam kota > 8 jam Bali = Rp190.000");
  const r2 = sbm.handle("c4b", "uang harian diklat Jawa Barat");
  check(has(r2, "diklat", "Rp130.000"), "uang harian diklat Jawa Barat = Rp130.000");
  const r3 = sbm.handle("c4c", "uang harian ke Bali 2 hari transpor lokal riil");
  check(has(r3, "60%", "Rp288.000", "2 hari × Rp288.000", "Rp576.000"), "transpor lokal riil → 60% (Rp480.000 → Rp288.000)");
}

// ---- hitung lengkap
{
  const sbm = mk();
  const r = sbm.handle("f1", "hitung perjalanan dinas eselon III ke Bali 3 hari 2 malam naik pesawat dari Jakarta");
  check(has(r, "1 orang") || has(r, "Eselon III"), "ringkasan memuat jabatan");
  check(has(r, "3 hari × Rp480.000", "Rp1.440.000"), "harian 3 × 480.000");
  check(has(r, "2 malam × Rp1.754.000", "Rp3.508.000", "hlm 19"), "penginapan Eselon III Bali 2 malam = 3.508.000");
  check(has(r, "Tiket pesawat PP Jakarta–Denpasar", "Rp3.262.000", "hlm 86", "dapat dilampaui"), "tiket PP Jakarta–Denpasar ekonomi (hlm 86, dapat dilampaui)");
  check(has(r, "Jumlah komponen yang terhitung: Rp8.210.000"), "total = 1.440.000 + 3.508.000 + 3.262.000 = Rp8.210.000");
  check(has(r, "bukti pengeluaran yang sah"), "catatan: penginapan berdasarkan bukti sah");
  check(!/representasi/i.test(r.replace(/Uang representasi hanya/, "")) || /hanya untuk pejabat negara/.test(r), "Eselon III tidak mendapat representasi (hanya dicatat)");
}
{
  const sbm = mk();
  const r1 = sbm.handle("f2", "tolong hitung biaya perjalanan dinas");
  check(has(r1, "provinsi/kota mana"), "langkah 1: tanya tujuan");
  const r2 = sbm.handle("f2", "Bali");
  check(has(r2, "Berapa hari"), "langkah 2: tanya lama");
  const r3 = sbm.handle("f2", "3 hari 2 malam");
  check(has(r3, "Jabatan/golongan"), "langkah 3: tanya jabatan");
  const r4 = sbm.handle("f2", "gol III");
  check(has(r4, "2 malam × Rp1.138.000", "Rp2.276.000", "Jumlah komponen yang terhitung: Rp3.716.000"), "gol III Bali: 1.440.000 + 2.276.000 = 3.716.000");
  check(sbm.sessions.size === 0, "sesi selesai dibersihkan");
}
{
  const sbm = mk();
  const r = sbm.handle("f3", "hitung perjalanan dinas eselon II ke Jawa Barat 2 hari untuk 3 orang");
  check(has(r, "3 orang", "2 hari × Rp430.000 × 3 orang = *Rp2.580.000*"), "3 orang: harian 2 × 430.000 × 3 = 2.580.000");
  check(has(r, "representasi", "2 hari × Rp150.000 × 3 orang = *Rp900.000*"), "representasi Eselon II luar kota 2 hari × 3 orang = 900.000");
}
{
  const sbm = mk();
  const r = sbm.handle("f4", "estimasi perjalanan dinas eselon I ke Banten 1 hari");
  check(has(r, "Rp200.000"), "representasi Eselon I = Rp200.000");
}
{
  const sbm = mk();
  const r = sbm.handle("f5", "hitung perjalanan dinas eselon III dari Jakarta ke Jawa Tengah 3 hari pesawat");
  check(has(r, "Semarang") && has(r, "Solo") && has(r, "tidak dijumlahkan"), "dua bandara di provinsi tujuan: keduanya ditampilkan, tidak masuk total");
}
{
  const sbm = mk();
  const r = sbm.handle("f6", "hitung perjalanan dinas eselon III dari Jakarta ke Bandung 2 hari pesawat");
  check(has(r, "tidak tercantum") && has(r, "Jawa Barat"), "rute yang tak ada di tabel tiket → dikatakan tidak tercantum, tidak dikarang");
}

// ---- jangan menebak: yang tidak ada di PMK
{
  const sbm = mk();
  const r = sbm.handle("n1", "berapa biaya BBM perjalanan dinas ke Bali?");
  check(has(r, "tidak memuat satuan biaya khusus", "tidak menebak", "hlm 85", "hlm 69") && !/Rp\d{3}\.000\b.*bbm/i.test(r.split("\n")[0]), "BBM: jawab 'tidak ada di PMK' + yang memang ada");
  const r2 = sbm.handle("n2", "uang harian ke Bali 3 hari dan biaya taksi");
  check(has(r2, "Rp1.440.000", "taksi", "tidak memuat satuan biaya khusus"), "campuran: tetap hitung uang harian, taksi dinyatakan tidak ada di PMK");
  const r3 = sbm.handle("n3", "tarif tol dan parkir perjalanan dinas");
  check(has(r3, "tidak memuat satuan biaya khusus"), "tol/parkir: tidak ada di PMK");
}

// ---- bukan urusan SBM → null (diserahkan ke AI)
{
  const sbm = mk();
  for (const t of ["halo apa kabar", "besok saya perjalanan dinas ke Bali capek banget", "kapan rapatnya?", "uang makan siang di kantin enak", "tolong buatkan surat tugas", "berapa hasil 12 x 13"]) {
    check(sbm.handle("x", t) === null, `bukan SBM: "${t}" → null`);
  }
  sbm.handle("x2", "uang harian ke Bali");
  check(sbm.handle("x2", "terima kasih ya sudah dijelaskan panjang lebar tadi pagi") === null, "sesi menggantung + pesan tak nyambung → sesi dilepas, null");
  check(sbm.sessions.size === 0, "sesi dibersihkan");
}

// ---- batal & kedaluwarsa
{
  const sbm = mk();
  sbm.handle("b1", "hitung perjalanan dinas");
  check(has(sbm.handle("b1", "batal"), "dibatalkan"), "batal");
  sbm.handle("b2", "hitung perjalanan dinas");
  clock += 11 * 60_000;
  check(sbm.handle("b2", "Bali") === null, "sesi kedaluwarsa (10 menit): 'Bali' saja tidak lagi dianggap lanjutan");
}

// ---- luar negeri belum didukung (jujur)
{
  const sbm = mk();
  const r = sbm.handle("l1", "hitung perjalanan dinas luar negeri ke Jepang");
  check(has(r, "luar negeri", "belum bisa", "hlm 16"), "luar negeri: jujur belum didukung + petunjuk halaman");
}

// ---- kota & alias
{
  const sbm = mk();
  const t = (s) => sbm.placesIn(s).map((p) => p.prov);
  check(t("ke jogja")[0] === "DIYOGYAKARTA" && t("ke yogyakarta")[0] === "DIYOGYAKARTA", "alias Jogja/Yogyakarta");
  check(t("ke jabar")[0] === "JAWABARAT" && t("ke sulsel")[0] === "SULAWESISELATAN" && t("ke ntt")[0] === "NUSATENGGARATIMUR", "singkatan provinsi");
  check(t("ke papua barat daya")[0] === "PAPUABARATDAYA" && t("ke papua barat")[0] === "PAPUABARAT" && t("ke papua")[0] === "PAPUA", "nama terpanjang menang (papua barat daya > papua barat > papua)");
  check(t("dari garut ke bandung")[0] === "JAWABARAT", "kota tanpa bandara dikenali");
  const miss = data.provinsi.filter((p) => sbm.placesIn(p.nama).length === 0).map((p) => p.nama);
  check(miss.length === 0, `semua 38 nama provinsi dikenali (${miss.join(",") || "ok"})`);
  const sl = sbm.parseSlots("dari Surabaya ke Makassar", null);
  check(sl.asal?.air === "SURABAYA" && sl.tujuan?.air === "MAKASSAR", "asal/tujuan dari kata 'dari' & 'ke'");
  check(rupiah(1440000) === "Rp1.440.000", "format rupiah");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua tes SBM lulus.");
