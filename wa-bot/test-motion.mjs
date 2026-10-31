// Tes modul motion graphic (templat harian, isi, tema mingguan, audio, render).   node test-motion.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SEMUA, HARIAN, templatUntuk, ambilTemplat, temaMinggu } from "./motion/templates/index.js";
import { ekstrakJson, buatIsi, buatIsiFakta, angkaAdaDiSumber, periksaRamahKeluarga, cekSatuHitungan, cekPola, periksaIsi } from "./motion/content.js";
import { metaShorts } from "./motion/youtube-meta.js";
import { sintesisAudio, SR } from "./motion/audio.js";
import { rencanaWaktu } from "./motion/render.js";
import { W, H, THEMES, fmtAngka, bungkus, siapkanFont } from "./motion/engine.js";
import * as T from "./motion/tema-mingguan.js";
import * as WA from "./motion/perintah-wa.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// 1. daftar templat & rotasi harian
check(HARIAN.length === 7, "ada 7 templat harian");
check(new Set(HARIAN.map((t) => t.hari)).size === 7, "tiap hari punya templat berbeda");
check(templatUntuk("2026-11-02").id === "fakta-angka", "Senin = fakta-angka");
check(templatUntuk("2026-11-08").id === "cerita-fakta", "Minggu = cerita-fakta");
check(HARIAN.every((t) => t.jalur === "fakta"), "semua templat rotasi harian berjalur fakta");
check(SEMUA.filter((t) => t.hari === null).every((t) => ["pelajaran", "khusus"].includes(t.jalur)), "templat di luar rotasi berjalur pelajaran/khusus");
{
  const tgl = (n) => `2026-11-${String(n).padStart(2, "0")}`; const pekan1 = [2, 3, 4, 5, 6, 7, 8].map((d) => temaMinggu(templatUntuk(tgl(d)), tgl(d))), pekan2 = [9, 10, 11, 12, 13, 14, 15].map((d) => temaMinggu(templatUntuk(tgl(d)), tgl(d)));
  check(new Set(pekan1).size === 7 && new Set(pekan2).size === 7, "warna: dalam satu pekan tiap hari berwarna beda");
  check(pekan1.every((x, i) => x !== pekan2[i]), "warna: tiap templat berganti warna di pekan berikutnya");
  const tp0 = templatUntuk(tgl(2)); check(temaMinggu(tp0, tgl(2)) === temaMinggu(tp0, tgl(8)), "warna: satu templat, satu pekan, satu warna");
}
check(new Set(HARIAN.map((t) => t.tema)).size === 7, "tiap templat punya tema warna berbeda");
check(SEMUA.every((t) => THEMES[t.tema]), "semua tema warna terdaftar");

// 2. contoh tiap templat valid
for (const t of SEMUA) {
  const r = t.rapikan(t.contoh);
  check(r.ok, `${t.id}: contoh lolos validasi`);
  check(periksaIsi(t.id, r.isi).length === 0, `${t.id}: contoh lolos pemeriksaan hitungan`);
  const sp = t.bangun(r.isi);
  check(sp.durasi >= 14 && sp.durasi <= 26, `${t.id}: durasi ${sp.durasi.toFixed(1)} dtk wajar untuk Shorts`);
  check(sp.efek.every((e) => e.t >= 0 && e.t <= sp.durasi), `${t.id}: waktu efek di dalam durasi`);
  check(typeof t.narasi(r.isi) === "string" && t.narasi(r.isi).length > 20, `${t.id}: narasi tersusun`);
}

// 3. validasi menolak isi buruk
const kuis = ambilTemplat("kuis-kilat"), hit = ambilTemplat("hitung-langkah"), bar = ambilTemplat("perbandingan-bar"), mit = ambilTemplat("mitos-fakta"), pola = ambilTemplat("pola-angka"), fa = ambilTemplat("fakta-angka");
check(!kuis.rapikan({ ...kuis.contoh, jawaban: 9 }).ok, "kuis: jawaban di luar pilihan ditolak");
check(!kuis.rapikan({ ...kuis.contoh, pilihan: ["a", "b"] }).ok, "kuis: kurang dari 3 pilihan ditolak");
check(!hit.rapikan({ ...hit.contoh, langkah: [hit.contoh.langkah[0]] }).ok, "hitung: satu langkah ditolak");
check(!bar.rapikan({ ...bar.contoh, item: bar.contoh.item.slice(0, 2) }).ok, "bar: kurang dari 3 item ditolak");
check(!bar.rapikan({ ...bar.contoh, item: bar.contoh.item.map((x) => ({ ...x, nilai: 0 })) }).ok, "bar: semua nilai nol ditolak");
check(!mit.rapikan({ mitos: "x" }).ok, "mitos: isi tidak lengkap ditolak");
check(!pola.rapikan({ ...pola.contoh, deret: ["1", "2"] }).ok, "pola: deret terlalu pendek ditolak");
check(!ambilTemplat("peringkat").rapikan({ ...ambilTemplat("peringkat").contoh, item: ambilTemplat("peringkat").contoh.item.slice(0, 2) }).ok, "peringkat: harus 3 item");
check(!ambilTemplat("garis-waktu").rapikan({ ...ambilTemplat("garis-waktu").contoh, peristiwa: ambilTemplat("garis-waktu").contoh.peristiwa.slice(0, 2) }).ok, "garis-waktu: minimal 3 peristiwa");
check(!ambilTemplat("cerita-fakta").rapikan({ ...ambilTemplat("cerita-fakta").contoh, bagian: ["satu", "dua"] }).ok, "cerita-fakta: minimal 3 bagian");
check(!fa.rapikan({ ...fa.contoh, angka: "abc" }).ok, "fakta: angka bukan bilangan ditolak");
check(fa.rapikan({ ...fa.contoh, angka: "8.849" }).isi.angka === 8849, "fakta: angka berformat Indonesia dibaca benar");
check(kuis.rapikan({ ...kuis.contoh, pertanyaan: "x".repeat(500) }).isi.pertanyaan.length <= 170, "teks terlalu panjang dipotong");

// 4. pemeriksaan hitungan
check(cekSatuHitungan("24 ÷ 4 = 6") === true, "hitungan benar terdeteksi");
check(cekSatuHitungan("7 × 8 = 54") === false, "hitungan salah terdeteksi");
check(cekSatuHitungan("Luas = 12") === null, "bentuk tak dikenal tidak diperiksa");
check(cekSatuHitungan("1.500 + 500 = 2.000") === true, "angka berformat titik ribuan");
check(cekPola(["2", "5", "8", "11"], "+3", "14") === true, "pola +3 benar");
check(cekPola(["2", "5", "8", "11"], "+3", "15") === false, "pola dengan jawaban salah terdeteksi");
check(cekPola(["3", "6", "12", "24"], "×2", "48") === true, "pola ×2 benar");
check(cekPola(["1", "2", "4"], "naik terus", "8") === null, "aturan bebas tidak diperiksa");

// 5. ekstrak JSON
check(ekstrakJson('```json\n{"a":1}\n```').a === 1, "ekstrak JSON dari blok kode");
check(ekstrakJson('Ini hasilnya: {"a":{"b":"}"}} selesai').a.b === "}", "ekstrak JSON dengan kurung di dalam string");
check(Array.isArray(ekstrakJson('[{"hari":1}]')), "ekstrak array JSON");
let gagal = false; try { ekstrakJson("tidak ada json"); } catch { gagal = true; } check(gagal, "tanpa JSON melempar galat");

// 6. buatIsi dengan AI tiruan (coba ulang)
{
  const balasan = ["maaf saya tidak bisa", JSON.stringify({ judul: "Bagi", soal: "Soal?", langkah: [{ ekspresi: "24 ÷ 4 = 7", catatan: "x" }, { ekspresi: "6 − 2 = 4" }], hasil: "4" }),
    JSON.stringify({ judul: "Bagi", soal: "Soal?", langkah: [{ ekspresi: "24 ÷ 4 = 6", catatan: "x" }, { ekspresi: "6 − 2 = 4" }], hasil: "4", hook: "Bisa hitung ini?", dasar: "pembagian" })];
  let i = 0, prompts = [];
  const r = await buatIsi({ llm: async (p) => { prompts.push(p); return balasan[i++]; }, templatId: "hitung-langkah", topik: "pembagian" });
  check(r.percobaan === 3 && r.hook === "Bisa hitung ini?" && r.dasar === "pembagian", "buatIsi: berhasil pada percobaan ke-3 setelah dua kegagalan");
  check(prompts[2].includes("hitungan salah"), "buatIsi: galat dikirim balik ke AI");
  let err = null; try { await buatIsi({ llm: async () => "bukan json", templatId: "kuis-kilat", topik: "x", maksCoba: 2 }); } catch (e) { err = e; }
  check(err && /Gagal membuat isi/.test(err.message), "buatIsi: melempar galat bila semua percobaan gagal");
}

// 6b. fakta bersumber (anti karangan)
check(angkaAdaDiSumber(8849, "Puncaknya setinggi 8.849 meter di atas laut") === true, "angka: format titik ribuan ditemukan");
check(angkaAdaDiSumber(8849, "Height: 8,849 m") === true && angkaAdaDiSumber(8849, "tinggi 8849 m") === true, "angka: format koma/polos ditemukan");
check(angkaAdaDiSumber(3.14, "nilai pi sekitar 3,14") === true, "angka: desimal koma ditemukan");
check(angkaAdaDiSumber("390 km/jam", "kecepatan mencapai 390 km/jam saat menukik") === true, "angka: nilai berteks");
check(angkaAdaDiSumber(9000, "tinggi 8.849 meter") === false, "angka: tidak ada di sumber terdeteksi");
check(angkaAdaDiSumber("banyak", "apa saja") === true, "bukan angka: tidak diperiksa");
check(periksaRamahKeluarga({ a: "Dia ingin membunuh nyamuk" }).length === 1 && periksaRamahKeluarga({ a: "Kucing suka tidur" }).length === 0, "filter ramah keluarga");
{
  const ev = { judul: "Gunung Everest", url: "https://a.example.org/everest", teks: "Gunung Everest memiliki tinggi 8.849 meter di atas permukaan laut dan berada di pegunungan Himalaya antara Nepal dan Tiongkok." };
  const ev2 = { judul: "Everest Facts", url: "https://b.example.com/facts", teks: "Mount Everest stands 8,849 m above sea level, the highest mountain on Earth, first climbed in 1953 by Hillary and Norgay." };
  const sama = { judul: "Salinan", url: "https://a.example.org/lain", teks: ev.teks };
  const cari = async () => [ev, ev2];
  const fa = ambilTemplat("fakta-angka");
  const baik = { ...fa.contoh, judul: "Seberapa tinggi Gunung Everest?", angka: 8849, hook: "Setinggi apa?", dasar: "Sumber 1 dan 2", sumber: [1, 2] };
  const r = await buatIsiFakta({ llm: async () => JSON.stringify(baik), cari, templatId: "fakta-angka", topik: "Everest" });
  check(r.percobaan === 1 && r.sumber.length === 2 && r.sumber[0].url.startsWith("https://"), "fakta: lolos dengan 2 sumber dan angka cocok");
  let n = 0; const balasan = [JSON.stringify({ ...baik, angka: 9100 }), JSON.stringify({ ...baik, sumber: [1] }), JSON.stringify(baik)]; const prompts = [];
  const r2 = await buatIsiFakta({ llm: async (p) => { prompts.push(p); return balasan[n++]; }, cari, templatId: "fakta-angka", topik: "Everest" });
  check(r2.percobaan === 3 && /tidak tertulis di sumber/.test(prompts[1]) && /minimal 2 sumber/.test(prompts[2]), "fakta: angka karangan dan sumber kurang ditolak lalu diperbaiki");
  let e1 = null; try { await buatIsiFakta({ llm: async () => JSON.stringify(baik), cari: async () => [ev, sama], templatId: "fakta-angka", topik: "x" }); } catch (e) { e1 = e; } check(e1 && /Sumber kurang/.test(e1.message), "fakta: dua sumber dari situs yang sama ditolak");
  let e2 = null; try { await buatIsiFakta({ llm: async () => JSON.stringify({ tidakCukup: true }), cari, templatId: "fakta-angka", topik: "x" }); } catch (e) { e2 = e; } check(e2 && /tidak cukup/.test(e2.message), "fakta: AI menolak mengarang -> galat");
  let e3 = null; try { await buatIsiFakta({ llm: async () => JSON.stringify({ ...baik, judul: "Pembunuhan misterius" }), cari, templatId: "fakta-angka", topik: "x", maksCoba: 2 }); } catch (e) { e3 = e; } check(e3 && /ramah keluarga/.test(e3.message), "fakta: topik tidak ramah keluarga ditolak");
  let e4 = null; try { await buatIsiFakta({ llm: async () => "{}", templatId: "fakta-angka", topik: "x" }); } catch (e) { e4 = e; } check(e4 && /fungsi cari/.test(e4.message), "fakta: tanpa fungsi cari ditolak");
  const garis = ambilTemplat("garis-waktu"), sg = [{ judul: "NASA", url: "https://x.example/n", teks: "Sputnik 1 diluncurkan pada 1957, manusia pertama ke luar angkasa pada 1961, Apollo 11 mendarat di Bulan tahun 1969, misi terakhir 1972." }, { judul: "Space", url: "https://y.example/s", teks: "Timeline: 1957 Sputnik; 1961 Gagarin; 1969 Apollo 11; 1972 Apollo 17 mission ended lunar landings." }];
  const gw = { ...garis.contoh, hook: "Dari mana mulai?", dasar: "NASA", sumber: [1, 2] };
  const rg = await buatIsiFakta({ llm: async () => JSON.stringify(gw), cari: async () => sg, templatId: "garis-waktu", topik: "Bulan" });
  check(rg.isi.peristiwa.length === 4, "fakta: garis waktu dengan tahun cocok lolos");
  let e5 = null; try { await buatIsiFakta({ llm: async () => JSON.stringify({ ...gw, peristiwa: [...gw.peristiwa.slice(0, 3), { tahun: "1980", teks: "Karangan." }] }), cari: async () => sg, templatId: "garis-waktu", topik: "Bulan", maksCoba: 1 }); } catch (e) { e5 = e; } check(e5 && /1980/.test(e5.message), "fakta: tahun karangan terdeteksi");
}

// 7. tema mingguan
check(T.senenBerikut(new Date(2026, 9, 31)) === "2026-11-02", "Sabtu 31 Okt -> Senin 2 Nov");
check(T.senenBerikut(new Date(2026, 10, 2)) === "2026-11-09", "Senin -> Senin pekan depan");
{
  const mg = T.susunMinggu("2026-11-02");
  check(mg.length === 7 && mg[0].templat === "fakta-angka" && mg[6].templat === "cerita-fakta" && mg[6].tanggal === "2026-11-08", "susunMinggu: 7 hari, Senin–Minggu");
  check(T.rentangTeks("2026-11-02") === "2–8 November 2026", "rentang tanggal teks");
  const u0 = await T.usulkanMinggu({ senen: "2026-11-02" });
  check(u0.hari.length === 7 && new Set(u0.hari.map((x) => x.topik)).size === 7 && u0.hari.every((x) => x.sumber === "bank"), "usulan tanpa AI memakai bank, 7 topik Short unik");
  check(new Set(u0.hari.map((x) => x.pelajaran.topik)).size === 7 && u0.hari.every((x) => x.pelajaran.sumber === "bank"), "usulan juga berisi 7 topik video pelajaran unik");
  const u1 = await T.usulkanMinggu({ senen: "2026-11-02", temaOwner: [{ teks: "Planet Mars" }, { teks: "Hewan laut" }] });
  check(u1.hari[0].topik === "Planet Mars" && u1.hari[0].sumber === "owner" && u1.hari[1].topik === "Hewan laut", "tema pemilik dipakai lebih dulu");
  const llm = async () => JSON.stringify([1, 2, 3, 4, 5, 6, 7].map((n) => ({ hari: n, fakta: `Fakta AI ${n}`, pelajaran: `Pelajaran AI ${n}` })));
  const u2 = await T.usulkanMinggu({ llm, senen: "2026-11-02", temaOwner: [{ teks: "Planet Mars" }] });
  check(u2.hari[0].sumber === "owner" && u2.hari[1].topik === "Fakta AI 2" && u2.hari[1].sumber === "ai" && u2.hari[1].pelajaran.topik === "Pelajaran AI 2", "AI mengisi hari yang kosong di kedua jalur");
  const u2b = await T.usulkanMinggu({ llm, senen: "2026-11-02", temaOwner: [{ teks: "Matematika pasar", jalur: "pelajaran" }] });
  check(u2b.hari[0].pelajaran.topik === "Matematika pasar" && u2b.hari[0].pelajaran.sumber === "owner" && u2b.hari[0].sumber === "ai", "tema pelajaran pemilik masuk jalur pelajaran saja");
  const u3 = await T.usulkanMinggu({ llm: async () => { throw new Error("mati"); }, senen: "2026-11-02" });
  check(u3.hari.every((x) => x.sumber === "bank"), "AI gagal -> jatuh ke bank cadangan");
  const u4 = await T.usulkanMinggu({ senen: "2026-11-02", riwayat: [T.BANK_TEMA["fakta-angka"][0]] });
  check(u4.hari[0].topik !== T.BANK_TEMA["fakta-angka"][0], "topik yang sudah pernah dipakai dihindari");
  check(T.formatUsulan(u0).includes("Short (Fakta Angka)") && T.formatUsulan(u0).includes("Video pelajaran:") && T.formatUsulan(u0).includes("setuju"), "format pesan usulan memuat dua jalur");
  check(T.tombolUsulan("2026-11-02").inline_keyboard[0][0].callback_data === "tema:setuju:2026-11-02", "tombol usulan");

  const P = T.parsePerintah;
  check(P("setuju").aksi === "setuju" && P("Oke").aksi === "setuju", "perintah: setuju");
  check(P("ulang").aksi === "ulang", "perintah: ulang");
  const g = P("ganti 3: planet Mars"); check(g.aksi === "ganti" && g.hari === 3 && g.topik === "planet Mars", "perintah: ganti dengan nomor");
  const g2 = P("ganti rabu planet Mars"); check(g2.aksi === "ganti" && g2.hari === 3, "perintah: ganti dengan nama hari");
  const tk = P("tukar 2 5"); check(tk.aksi === "tukar" && tk.a === 2 && tk.b === 5, "perintah: tukar");
  check(P("tukar selasa dengan jumat").b === 5, "perintah: tukar dengan nama hari");
  check(P("hapus 4").aksi === "hapus" && P("hapus 4").hari === 4, "perintah: hapus");
  const tm = P("tema: dinosaurus; gunung berapi"); check(tm.aksi === "tema" && tm.daftar.length === 2 && tm.jalur === "fakta", "perintah: tema banyak");
  const tp = P("tema pelajaran: pecahan"); check(tp.aksi === "tema" && tp.jalur === "pelajaran" && tp.daftar[0] === "pecahan", "perintah: tema pelajaran");
  const gp = P("pelajaran 3: siklus air"); check(gp.aksi === "gantiPelajaran" && gp.hari === 3 && gp.topik === "siklus air", "perintah: ganti pelajaran");
  check(P("video kamis: magnet").aksi === "gantiPelajaran" && P("video kamis: magnet").hari === 4, "perintah: video + nama hari");
  check(P("ganti 9: x").aksi === "bebas", "hari tidak valid jatuh ke bebas");
  check(P("hari kamis tolong lebih mudah").aksi === "bebas", "kalimat bebas");

  let st = { usulan: u0, temaOwner: [], riwayat: [] };
  let r = await T.terapkan({ state: st, perintah: P("ganti 3: Planet Mars") });
  check(r.berubah && r.state.usulan.hari[2].topik === "Planet Mars" && r.state.usulan.hari[2].sumber === "owner" && st.usulan.hari[2].topik !== "Planet Mars", "ganti: hanya salinan yang berubah");
  const a0 = r.state.usulan.hari[0].topik, b0 = r.state.usulan.hari[4].topik; r = await T.terapkan({ state: r.state, perintah: P("tukar 1 5") });
  check(r.state.usulan.hari[0].topik === b0 && r.state.usulan.hari[4].topik === a0 && r.state.usulan.hari[0].templat === "fakta-angka", "tukar: topik bertukar, templat tetap");
  r = await T.terapkan({ state: r.state, perintah: P("pelajaran 2: Magnet") }); check(r.berubah && r.state.usulan.hari[1].pelajaran.topik === "Magnet" && r.state.usulan.hari[1].pelajaran.sumber === "owner", "ganti pelajaran: jalur pelajaran berubah, Short tidak");
  r = await T.terapkan({ state: r.state, perintah: P("hapus 4") }); check(r.berubah && r.state.usulan.hari[3].topik, "hapus: diganti topik baru");
  r = await T.terapkan({ state: r.state, perintah: P("tema: Dinosaurus; Gunung berapi") }); check(r.state.temaOwner.length === 2 && r.state.temaOwner[0].jalur === "fakta", "tema: masuk antrean pemilik");
  r = await T.terapkan({ state: r.state, perintah: P("tema pelajaran: Rantai makanan") }); check(r.state.temaOwner.length === 3 && r.state.temaOwner[2].jalur === "pelajaran", "tema pelajaran: antrean terpisah");
  r = await T.terapkan({ state: r.state, perintah: P("daftar tema") }); check(/Dinosaurus/.test(r.pesan), "daftar tema ditampilkan");
  r = await T.terapkan({ state: r.state, perintah: P("ulang"), llm: null }); check(r.state.usulan.hari[2].topik === "Planet Mars" && r.state.usulan.hari[1].pelajaran.topik === "Magnet" && r.state.usulan.status === "diusulkan", "ulang: tema pemilik di kedua jalur dipertahankan");
  r = await T.terapkan({ state: r.state, perintah: P("setuju") }); check(r.state.usulan.status === "disetujui" && r.state.usulan.disetujuiOleh === "owner", "setuju");
  const llmBebas = async () => JSON.stringify([{ hari: 5, fakta: "Daur ulang sampah" }]);
  r = await T.terapkan({ state: r.state, perintah: P("hari jumat bahas lingkungan"), llm: llmBebas }); check(r.berubah && r.state.usulan.hari[4].topik === "Daur ulang sampah", "revisi bebas lewat AI");
  r = await T.terapkan({ state: { usulan: null, temaOwner: [], riwayat: [] }, perintah: P("setuju") }); check(!r.berubah && /Belum ada usulan/.test(r.pesan), "setuju tanpa usulan ditolak halus");
  const oto = T.setujuiOtomatis({ usulan: u0 }); check(oto.usulan.status === "disetujui" && oto.usulan.disetujuiOleh === "otomatis", "setujuiOtomatis");
  check(T.temaUntuk(oto, "2026-11-03").topik === u0.hari[1].topik && T.temaUntuk(oto, "2027-01-01").status === "tidak-ada", "temaUntuk per tanggal");
  check(T.teaserBesok(oto, "2026-11-02") === u0.hari[1].topik, "teaser besok");
  check(T.teaserPelajaran(oto, "2026-11-02") === u0.hari[0].pelajaran.topik, "teaser pelajaran hari ini");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tema-")); const berkas = path.join(tmp, "x", "tema.json");
  T.simpanState(berkas, oto); check(JSON.stringify(T.muatState(berkas)) === JSON.stringify(oto), "simpan dan muat state"); check(T.muatState(path.join(tmp, "tidak-ada.json")).usulan === null, "muat berkas tidak ada -> state kosong");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 8. metadata YouTube
{
  const t = ambilTemplat("mitos-fakta"), m = metaShorts({ templatId: t.id, isi: t.contoh, hook: "Mitos atau fakta?", topik: "Wortel dan mata", sumber: [{ judul: "Contoh", url: "https://a.example/x" }], linkVideo: "https://youtu.be/abc" });
  check(m.deskripsi.includes("Sumber:") && m.deskripsi.includes("https://a.example/x") && m.deskripsi.includes("https://youtu.be/abc"), "deskripsi memuat sumber dan tautan video pelajaran");
  check(m.judul.length <= 100 && m.judul.endsWith("#Shorts"), "judul <= 100 huruf dan ber-#Shorts");
  check(m.madeForKids === true && m.containsSyntheticMedia === true && m.deskripsi.includes("#Shorts"), "metadata anak-anak + media sintetis");
  const m2 = metaShorts({ templatId: "kuis-kilat", isi: { ...ambilTemplat("kuis-kilat").contoh, pertanyaan: "p".repeat(300) }, hook: "x" });
  check(m2.judul.length <= 100, "judul panjang dipotong");
}

// 9. audio
{
  const a = sintesisAudio({ durasi: 3, musik: ambilTemplat("kuis-kilat").musik, efek: [{ t: 0.5, k: "pop" }, { t: 1, k: "whoosh" }, { t: 1.5, k: "thud" }, { t: 2, k: "tada" }] });
  const b = sintesisAudio({ durasi: 3, musik: ambilTemplat("kuis-kilat").musik, efek: [{ t: 0.5, k: "pop" }, { t: 1, k: "whoosh" }, { t: 1.5, k: "thud" }, { t: 2, k: "tada" }] });
  let pk = 0, sama = true; for (let i = 0; i < a.L.length; i++) { pk = Math.max(pk, Math.abs(a.L[i]), Math.abs(a.R[i])); if (a.L[i] !== b.L[i]) sama = false; }
  check(a.L.length === 3 * SR, "audio: panjang sesuai durasi");
  check(pk > 0.5 && pk <= 0.86, `audio: puncak ${pk.toFixed(2)} terkendali`);
  check(sama, "audio: deterministik (hasil sama untuk masukan sama)");
  check(Math.abs(a.L[0]) < 0.01 && Math.abs(a.L[a.L.length - 1]) < 0.02, "audio: fade in/out di ujung");
}

// 10. rencana waktu
{
  const r0 = rencanaWaktu({ durTemplat: 20, durNarasi: 0 }); check(r0.k === 1 && r0.total > 20, "rencana waktu: tanpa narasi tidak diregangkan");
  const r1 = rencanaWaktu({ durTemplat: 16, durNarasi: 30, withHook: true }); check(r1.k > 1.5 && r1.total >= 30, "rencana waktu: narasi panjang meregangkan templat");
  const r2 = rencanaWaktu({ durTemplat: 10, durNarasi: 90 }); check(r2.k <= 2.2, "rencana waktu: regangan dibatasi");
  const r4 = rencanaWaktu({ durTemplat: 16, durNarasi: 60 }); check(r4.k === 2.2 && r4.tahan > 0 && r4.total >= 60 + 0.3 + 1.0 + r4.outro - 1e-9, "rencana waktu: narasi lebih panjang dari regangan maksimal -> bingkai ditahan, suara tidak terpotong");
  check(rencanaWaktu({ durTemplat: 16, durNarasi: 30 }).tahan === 0 && rencanaWaktu({ durTemplat: 16 }).tahan === 0, "rencana waktu: tanpa kelebihan narasi tidak ada penahanan");
  const r3 = rencanaWaktu({ durTemplat: 20, durNarasi: 5 }); check(r3.k === 1, "rencana waktu: narasi pendek tidak memendekkan templat");
}

// 11. util engine
check(fmtAngka(8849) === "8.849" && fmtAngka(3.14159, 2) === "3,14" && fmtAngka(1234567.5, 1) === "1.234.567,5", "format angka Indonesia");

// 12. gambar & render (dilewati bila @napi-rs/canvas / ffmpeg belum terpasang)
let canvasLib = null; try { canvasLib = await import("@napi-rs/canvas"); } catch {}
if (!canvasLib) console.log("lewati: @napi-rs/canvas belum terpasang (npm i @napi-rs/canvas)");
else {
  await siapkanFont(canvasLib);
  const cv = canvasLib.createCanvas(W, H), g = cv.getContext("2d");
  check(bungkus(g, "satu dua tiga empat lima enam tujuh delapan", 200, "800 40px InterMG").length > 1, "bungkus teks menjadi beberapa baris");
  for (const t of SEMUA) {
    const sp = t.bangun(t.rapikan(t.contoh).isi); let ok = true, ragam = 0;
    for (const f of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.99, 1]) {
      try { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; sp.gambar(g, f * sp.durasi); } catch (e) { ok = false; console.log("  galat gambar", t.id, f, e.message); }
      if (f === 0.85) { const d = cv.data(); const set = new Set(); for (let i = 0; i < d.length; i += 4 * 997) set.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); ragam = set.size; }
    }
    check(ok, `${t.id}: menggambar tanpa galat di 9 titik waktu`);
    check(ragam > 6, `${t.id}: kanvas tidak kosong (ragam warna ${ragam})`);
  }
  const ff = spawnSync("ffmpeg", ["-version"]);
  if (ff.status !== 0) console.log("lewati render: ffmpeg tidak ada");
  else {
    const { renderVideo, durasiBerkas } = await import("./motion/render.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mt-")), out = path.join(tmp, "uji.mp4"), t = ambilTemplat("pola-angka");
    const hasil = await renderVideo({ templatId: t.id, isi: t.contoh, hook: "Tebak angkanya!", teaser: "Fakta unik planet", keluar: out, skala: 0.3, fps: 15 });
    const dur = durasiBerkas(out);
    check(fs.existsSync(out) && Math.abs(dur - hasil.durasi) < 0.3, `render: berkas jadi, durasi ${dur.toFixed(1)} dtk sesuai rencana`);
    const info = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout;
    check(/h264,video,\d+,\d+/.test(info) && /aac,audio/.test(info), "render: ada video H.264 dan audio AAC");
    check(!fs.existsSync(out.replace(/\.mp4$/, ".part.mp4")), "render: tidak meninggalkan berkas sementara");
    // narasi tiruan (nada pendek) -> jalur ducking dan peregangan
    const nar = path.join(tmp, "nar.wav"); spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=26", nar]);
    const out2 = path.join(tmp, "uji2.mp4"), h2 = await renderVideo({ templatId: t.id, isi: t.contoh, hook: "Tebak angkanya!", narasi: nar, keluar: out2, skala: 0.3, fps: 15 });
    check(h2.regang > 1 && Math.abs(durasiBerkas(out2) - h2.durasi) < 0.3 && h2.durasi >= 26, `render dengan narasi: diregangkan x${h2.regang.toFixed(2)} dan cukup panjang`);
    let galat = null; try { await renderVideo({ templatId: "tidak-ada", isi: {}, keluar: path.join(tmp, "z.mp4") }); } catch (e) { galat = e; } check(galat, "render: templat tidak dikenal melempar galat");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 13. permintaan video lewat WhatsApp
{
  const k = (t, o) => WA.kenaliPerintah(t, o);
  check(k("halo apa kabar") === null && k("video itu bagus ya") === null && k("") === null, "wa: obrolan biasa bukan perintah");
  let p = k("buatkan video tentang gunung tertinggi di dunia");
  check(p && p.topik === "gunung tertinggi di dunia" && p.templatId === null && p.suara && !p.hd, "wa: perintah alami + topik");
  p = k("/video peringkat: 3 hewan tercepat");
  check(p && p.slash && p.templatId === "peringkat" && p.topik === "3 hewan tercepat", "wa: /video jenis: topik");
  p = k("bikin video mitos tentang makan wortel bikin mata tajam ya");
  check(p && p.templatId === "mitos-fakta" && p.topik === "makan wortel bikin mata tajam", "wa: jenis mitos + penutup 'ya' dibuang");
  p = k("@628123456789 buatin video motion graphic proses terjadinya hujan tanpa suara hd");
  check(p && p.templatId === "proses-tahapan" && p.topik === "terjadinya hujan" && p.suara === false && p.hd === true, "wa: mention dibuang, tanpa suara, hd");
  p = k("Ayyubi, buatkan video kuis: perkalian 7 dan 8", { namaBot: "Ayyubi" });
  check(p && p.templatId === "kuis-kilat" && p.topik === "perkalian 7 dan 8", "wa: nama bot di depan dibuang");
  p = k("buat video fakta unik kucing");
  check(p && p.templatId === "fakta-angka" && /fakta unik kucing/.test(p.topik), "wa: kata 'fakta' tetap di topik");
  check(k("/video").bantuan === false && k("/video").topik === "" && k("/video bantuan").bantuan === true, "wa: /video kosong dan bantuan");
  check(WA.teksBantuan().includes("/video"), "wa: teks bantuan memuat contoh");

  const g = WA.izinVideo;
  check(g({ adalahPemilik: true }).ok && g({ adalahPemilik: true }).bebasBatas, "wa izin: pemilik selalu boleh");
  check(!g({ adalahPemilik: false, grup: "g1@g.us", pengirim: "a" }).ok, "wa izin: orang lain ditolak secara bawaan");
  check(g({ adalahPemilik: false, grup: "g1@g.us", pengirim: "a", konfig: { izinGrup: ["g1@g.us"] } }).ok, "wa izin: grup yang diizinkan");
  check(g({ adalahPemilik: false, pengirim: "a", konfig: { izinPengirim: ["a"] } }).ok && g({ adalahPemilik: false, pengirim: "z", konfig: { izinSemua: true } }).ok, "wa izin: pengirim diizinkan / izinSemua");
  const kfg = WA.konfigDariEnv({ WA_VIDEO_SEMUA: "1", WA_VIDEO_GRUP: "a@g.us, b@g.us", WA_VIDEO_MAKS_HARIAN: "5" });
  check(kfg.izinSemua && kfg.izinGrup.length === 2 && kfg.maksHarian === 5 && kfg.selangMenit === 10, "wa: konfigDariEnv");

  const pb = WA.buatPembatas({ selangMenit: 10, maksHarian: 2 }), t0 = Date.UTC(2026, 10, 2, 1, 0, 0);
  check(pb.cek("a", t0).ok, "wa batas: permintaan pertama lolos");
  pb.catat("a", t0);
  check(!pb.cek("a", t0 + 5 * 60e3).ok && pb.cek("a", t0 + 11 * 60e3).ok, "wa batas: selang 10 menit");
  pb.catat("a", t0 + 11 * 60e3);
  check(!pb.cek("a", t0 + 40 * 60e3).ok && /besok/.test(pb.cek("a", t0 + 40 * 60e3).alasan), "wa batas: maksimal per hari");
  check(pb.cek("a", t0 + 24 * 3600e3).ok && pb.cek("b", t0).ok, "wa batas: hari berikutnya dan pengirim lain bebas");

  const an = WA.buatAntrean({ maksTunggu: 1 }), urutan = [];
  const lambat = (n, ms) => an.jalankan(async () => { await new Promise((r) => setTimeout(r, ms)); urutan.push(n); return n; });
  const a1 = lambat(1, 30), a2 = lambat(2, 5);
  check(an.panjang === 2 && an.penuh(), "wa antrean: satu berjalan + satu menunggu = penuh");
  await Promise.all([a1, a2]);
  check(urutan.join() === "1,2" && an.panjang === 0, "wa antrean: dikerjakan berurutan satu-satu");
  let gal = null; try { await an.jalankan(async () => { throw new Error("x"); }); } catch (e) { gal = e; }
  check(gal && (await an.jalankan(async () => 7)) === 7, "wa antrean: galat satu tugas tidak menghentikan antrean");

  // alur penuh dengan AI/pencarian/render tiruan
  const ev = { judul: "Gunung Everest", url: "https://a.example.org/everest", teks: "Gunung Everest memiliki tinggi 8.849 meter di atas permukaan laut dan berada di pegunungan Himalaya antara Nepal dan Tiongkok." };
  const ev2 = { judul: "Everest Facts", url: "https://b.example.com/facts", teks: "Mount Everest stands 8,849 m above sea level, the highest mountain on Earth, first climbed in 1953 by Hillary and Norgay." };
  const fa = ambilTemplat("fakta-angka");
  const baik = { ...fa.contoh, judul: "Seberapa tinggi Gunung Everest?", angka: 8849, hook: "Setinggi apa?", dasar: "Everest setinggi 8.849 meter.", sumber: [1, 2] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mwa-"));
  const kirim = { teks: [], video: [] };
  const dasar = () => ({
    teks: "buatkan video tentang Gunung Everest", pengirim: "628111@s.whatsapp.net", adalahPemilik: true, grup: null, disebut: false, sekarang: Date.UTC(2026, 10, 2, 1, 0, 0),
    deps: { llm: async () => JSON.stringify(baik), cari: async () => [ev, ev2], tts: async () => { const f = path.join(tmp, "n.wav"); fs.writeFileSync(f, "x"); return f; } },
    kirimTeks: async (x) => kirim.teks.push(x), kirimVideo: async (b, ket) => kirim.video.push({ b, ket, ada: fs.existsSync(b) }),
    antrean: WA.buatAntrean(), pembatas: WA.buatPembatas(), konfig: {}, folder: tmp,
    renderFn: async (a) => { fs.writeFileSync(a.keluar, "mp4"); return { berkas: a.keluar, durasi: 22 }; }
  });
  let ok = await WA.tanganiPesanWa(dasar());
  check(ok === true && kirim.video.length === 1 && kirim.video[0].ada, "wa alur: pemilik di chat pribadi -> video terkirim");
  check(/Seberapa tinggi Gunung Everest/.test(kirim.video[0].ket) && /Sumber:/.test(kirim.video[0].ket) && /a\.example\.org/.test(kirim.video[0].ket), "wa alur: keterangan memuat judul, dasar, sumber");
  check(!fs.existsSync(kirim.video[0].b) && !fs.existsSync(path.join(tmp, "n.wav")), "wa alur: berkas video dan narasi sementara dibersihkan");
  check(kirim.teks.length === 1 && /sedang dibuat/.test(kirim.teks[0]), "wa alur: ada konfirmasi 'sedang dibuat'");
  const n0 = kirim.teks.length + kirim.video.length;
  check((await WA.tanganiPesanWa({ ...dasar(), teks: "besok libur ya" })) === false && kirim.teks.length + kirim.video.length === n0, "wa alur: obrolan biasa tidak ditangani (false)");
  check((await WA.tanganiPesanWa({ ...dasar(), grup: "g@g.us", disebut: false })) === false, "wa alur: di grup tanpa disebut/tanpa slash diabaikan");
  kirim.teks.length = 0; kirim.video.length = 0;
  check((await WA.tanganiPesanWa({ ...dasar(), grup: "g@g.us", disebut: false, teks: "/video fakta Gunung Everest" })) === true && kirim.video.length === 1, "wa alur: di grup dengan /video diproses");
  kirim.teks.length = 0; kirim.video.length = 0;
  await WA.tanganiPesanWa({ ...dasar(), adalahPemilik: false, grup: "g@g.us", disebut: true });
  check(kirim.video.length === 0 && /hanya untuk pemilik/.test(kirim.teks[0]), "wa alur: bukan pemilik di grup tak diizinkan -> ditolak sopan");
  kirim.teks.length = 0; kirim.video.length = 0;
  const d2 = { ...dasar(), adalahPemilik: false, grup: "g@g.us", disebut: true, konfig: { izinGrup: ["g@g.us"] } };
  await WA.tanganiPesanWa(d2); await WA.tanganiPesanWa(d2);
  check(kirim.video.length === 1 && /Tunggu sekitar/.test(kirim.teks[kirim.teks.length - 1]), "wa alur: anggota grup dibatasi selang waktu");
  kirim.teks.length = 0; kirim.video.length = 0;
  await WA.tanganiPesanWa({ ...dasar(), deps: { ...dasar().deps, cari: async () => [ev] } });
  check(kirim.video.length === 0 && /tidak menemukan sumber/.test(kirim.teks[kirim.teks.length - 1]), "wa alur: sumber kurang -> tidak membuat, pesan ramah");
  kirim.teks.length = 0; kirim.video.length = 0;
  await WA.tanganiPesanWa({ ...dasar(), teks: "buatkan video tentang pembunuhan" });
  check(kirim.video.length === 0 && /ramah keluarga/.test(kirim.teks[0]), "wa alur: topik tidak ramah keluarga ditolak sebelum diproses");
  kirim.teks.length = 0; kirim.video.length = 0;
  await WA.tanganiPesanWa({ ...dasar(), deps: { ...dasar().deps, tts: async () => { throw new Error("tts mati"); } } });
  check(kirim.video.length === 1 && /musik saja/.test(kirim.video[0].ket), "wa alur: TTS gagal -> video tetap terkirim tanpa narasi + catatan");
  // hari Sabtu (garis-waktu) tapi isi AI cocok untuk fakta-angka -> pakai templat cadangan
  kirim.teks.length = 0; kirim.video.length = 0;
  await WA.tanganiPesanWa({ ...dasar(), sekarang: Date.UTC(2026, 10, 7, 1, 0, 0) });
  check(kirim.video.length === 1, "wa alur: templat hari ini tak cocok -> jatuh ke templat cadangan, video tetap jadi");
  kirim.teks.length = 0; kirim.video.length = 0;
  const pen = dasar(); pen.antrean = { penuh: () => true, panjang: 4, jalankan: async () => {} };
  await WA.tanganiPesanWa(pen);
  check(kirim.video.length === 0 && /penuh/.test(kirim.teks[0]), "wa alur: antrean penuh ditolak sopan");
  kirim.teks.length = 0;
  await WA.tanganiPesanWa({ ...dasar(), teks: "/video" });
  check(/Cara minta video/.test(kirim.teks[0]), "wa alur: /video tanpa topik menampilkan bantuan");
  // pelajaran (tanpa web) memakai buatIsi
  kirim.teks.length = 0; kirim.video.length = 0;
  const kq = ambilTemplat("kuis-kilat");
  await WA.tanganiPesanWa({ ...dasar(), teks: "/video kuis: perkalian 7 dan 8", deps: { llm: async () => JSON.stringify({ ...kq.contoh, hook: "Coba tebak!", dasar: "7x8=56" }), tts: null } });
  check(kirim.video.length === 1 && /Isi dibuat AI/.test(kirim.video[0].ket), "wa alur: kuis tanpa web jalan + catatan pemeriksaan");
  fs.rmSync(tmp, { recursive: true, force: true });
  // render sungguhan (bila tersedia): pastikan keluarannya video asli lewat jalur WA
  let cvOk = true; try { await import("@napi-rs/canvas"); } catch { cvOk = false; }
  if (cvOk && spawnSync("ffmpeg", ["-version"]).status === 0) {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "mwa2-"));
    const h = await WA.buatVideoWa({ perintah: WA.kenaliPerintah("/video fakta Gunung Everest"), llm: async () => JSON.stringify(baik), cari: async () => [ev, ev2], folder: tmp2, skala: 0.3, tanggal: "2026-11-02" });
    check(fs.existsSync(h.berkas) && fs.statSync(h.berkas).size > 5000 && h.durasi > 18, `wa render sungguhan: ${h.durasi.toFixed(1)} dtk, ${(fs.statSync(h.berkas).size / 1e3).toFixed(0)} KB`);
    fs.rmSync(tmp2, { recursive: true, force: true });
  } else console.log("lewati wa render sungguhan: canvas/ffmpeg tidak ada");
}

console.log(fails ? `\n${fails} tes GAGAL` : "\nSemua tes motion lolos");
process.exit(fails ? 1 : 0);
