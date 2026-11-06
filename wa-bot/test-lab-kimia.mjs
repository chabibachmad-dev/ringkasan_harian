// Uji modul Laboratorium Kimia (tanpa pustaka luar; tidak butuh DOM atau kanvas sungguhan).
import assert from "node:assert/strict";
import { UNSUR, PER_SIMBOL, KATEGORI, SENYAWA, BENTUK_UNSUR } from "./lab-kimia/data.js";
import { racik, parseRumus, normalisasi, cariSenyawa, bahanAcak, mulberry32, rumusTeks, pecahTampilan } from "./lab-kimia/core.js";
import { bacaRumus, periksaRumus, aturanGabung, bintangUntuk, catatBenar, catatSalah, skorBersih, soalAcak, soalTerpenuhi } from "./lab-kimia/tantangan.js";
import { bersihkan, ukurTeks, bungkus, GLYPH } from "./lab-kimia/font.js";
import { buatPdf } from "./lab-kimia/pdf.js";
import { gambarTabel, UKURAN_TABEL, gambarKartuUnsur, gambarKartuHasil, ukuranKartuHasil } from "./lab-kimia/render.js";

let n = 0;
const ok = (nama, fn) => { fn(); n++; };

ok("118 unsur, posisi & simbol unik, nomor 1..118", () => {
  assert.equal(UNSUR.length, 118);
  UNSUR.forEach((u, i) => assert.equal(u.z, i + 1));
  assert.equal(new Set(UNSUR.map((u) => u.simbol)).size, 118);
  assert.equal(new Set(UNSUR.map((u) => u.kolom + "," + u.baris)).size, 118);
  for (const u of UNSUR) { assert.ok(KATEGORI[u.kategori], u.simbol); assert.ok(u.massa > 0); assert.ok(u.nama.id && u.nama.en); }
});

ok("parseRumus + normalisasi", () => {
  const c = parseRumus("Ca(OH)2");
  assert.equal(c.get("Ca"), 1); assert.equal(c.get("O"), 2); assert.equal(c.get("H"), 2);
  const m = normalisasi([{ simbol: "H", jumlah: 2 }, { simbol: "H", jumlah: 3 }, { simbol: "Xx", jumlah: 5 }, { simbol: "O", jumlah: -4 }, { simbol: "Fe", jumlah: 99999 }]);
  assert.equal(m.get("H"), 5); assert.equal(m.has("Xx"), false); assert.equal(m.has("O"), false); assert.equal(m.get("Fe"), 999);
});

ok("semua senyawa nyata di basis data dikenali tepat", () => {
  assert.ok(SENYAWA.length >= 120);
  for (const [rumus, nama] of SENYAWA) {
    const counts = parseRumus(rumus), r = racik([...counts].map(([simbol, jumlah]) => ({ simbol, jumlah })));
    assert.equal(r.tipe, "nyata", rumus); assert.equal(r.nama.id, nama, rumus);
    assert.equal(cariSenyawa(counts) != null, true);
  }
});

ok("air, kelipatan, unsur tunggal", () => {
  assert.equal(racik([{ simbol: "H", jumlah: 2 }, { simbol: "O", jumlah: 1 }]).nama.id, "Air");
  const k = racik([{ simbol: "H", jumlah: 4 }, { simbol: "O", jumlah: 2 }]);
  assert.equal(k.tipe, "nyata"); assert.equal(k.kelipatan, 2);
  assert.equal(racik([{ simbol: "Fe", jumlah: 1 }]).tipe, "unsur");
});

ok("racik deterministik, tidak bergantung urutan, bahan tak terbatas", () => {
  const a = racik([{ simbol: "Au", jumlah: 3 }, { simbol: "Og", jumlah: 1 }, { simbol: "Na", jumlah: 7 }]);
  const b = racik([{ simbol: "Na", jumlah: 7 }, { simbol: "Au", jumlah: 3 }, { simbol: "Og", jumlah: 1 }]);
  assert.equal(a.tipe, "fiksi"); assert.deepEqual(a, b);
  const semua = UNSUR.map((u) => ({ simbol: u.simbol, jumlah: 1 + (u.z % 7) }));
  const g = racik(semua);
  assert.equal(g.tipe, "fiksi"); assert.ok(g.nama.id.length > 3); assert.equal(g.sprite.sel.length, 16);
  assert.deepEqual(g, racik([...semua].reverse()));
  assert.ok(/^ZX-\d{4}$/.test(g.kode));
});

ok("sprite 16x16 berisi warna valid", () => {
  const r = racik([{ simbol: "K", jumlah: 2 }, { simbol: "Cr", jumlah: 1 }, { simbol: "O", jumlah: 4 }]);
  for (const baris of r.sprite.sel) { assert.equal(baris.length, 16); for (const p of baris) assert.ok(p == null || /^#[0-9a-f]{6}$/i.test(p)); }
});

ok("bahanAcak valid", () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 50; i++) { const b = bahanAcak(rng); assert.ok(b.length >= 2 && b.length <= 4); assert.ok(racik(b)); }
});

ok("font & pembungkus teks", () => {
  assert.equal(bersihkan("Hidrogén – “x”"), 'Hidrogen - "x"');
  assert.equal(ukurTeks("AB", 1), 11);
  for (const ch of "AZaz09.,-()[]/:;+=%!?*#'&<>_ \"") assert.ok(GLYPH[ch], ch);
  assert.ok(bungkus("satu dua tiga empat lima enam", 10).every((l) => l.length <= 10));
});

ok("PDF: kepala, xref, objek, ukuran halaman", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buatPdf(jpeg, 800, 600, { judul: "Tabel (uji) \\ ü", latar: "#1b1b2f" });
  const s = Buffer.from(pdf).toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4")); assert.ok(s.trimEnd().endsWith("%%EOF"));
  assert.ok(s.includes("/MediaBox [0 0 842 595]")); // landscape
  const x = Number(/startxref\n(\d+)/.exec(s)[1]); assert.equal(s.slice(x, x + 4), "xref");
  const ent = s.slice(x).split("\n").slice(3, 9);
  ent.forEach((l, i) => { assert.equal(l.length, 19); const off = Number(l.slice(0, 10)); assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), "obj " + (i + 1)); });
  assert.ok(buatPdf(jpeg, 600, 800).length > 100);
  assert.ok(Buffer.from(buatPdf(jpeg, 600, 800)).toString("latin1").includes("[0 0 595 842]"));
});

ok("render memakai kanvas apa pun yang hanya punya fillRect/fillStyle", () => {
  let gambar = 0;
  const ctx = new Proxy({ fillStyle: "#000", fillRect() { gambar++; } }, { get(t, k) { if (!(k in t)) throw new Error("API kanvas tak didukung: " + String(k)); return t[k]; }, set(t, k, v) { if (k !== "fillStyle") throw new Error("set " + String(k)); t[k] = v; return true; } });
  gambarTabel(ctx, "id"); assert.ok(gambar > 5000);
  gambar = 0; gambarTabel(ctx, "en"); assert.ok(gambar > 5000);
  gambar = 0; gambarKartuUnsur(ctx, PER_SIMBOL.get("Au"), "id"); assert.ok(gambar > 500);
  const h = racik([{ simbol: "Na", jumlah: 1 }, { simbol: "Cl", jumlah: 1 }]), uk = ukuranKartuHasil(h, "id");
  assert.ok(uk.lebar > 100 && uk.tinggi > 100);
  gambar = 0; gambarKartuHasil(ctx, h, "id"); assert.ok(gambar > 500);
  assert.ok(UKURAN_TABEL.lebar > 800);
});


ok("senyawa: 10 kolom, nama & rumus unik, contoh pemakaian ID+EN terisi, tanpa bahan peledak", () => {
  const kunci = new Set(), nama = new Set();
  for (const r of SENYAWA) {
    assert.equal(r.length, 10, r[0]);
    assert.ok(/^#[0-9a-f]{6}$/i.test(r[4]), "warna " + r[0]);
    assert.ok(["padat", "cair", "gas"].includes(r[3]), "wujud " + r[0]);
    for (const i of [1, 2, 5, 6, 8, 9]) assert.ok(typeof r[i] === "string" && r[i].length > (i < 3 ? 1 : 8), `kolom ${i} ${r[0]}`);
    const k = rumusTeks(parseRumus(r[0])); assert.ok(!kunci.has(k), "rumus ganda " + r[0]); kunci.add(k);
    assert.ok(!nama.has(r[1]), "nama ganda " + r[1]); nama.add(r[1]);
    assert.ok(!/TNT|nitrogliserin|sarin|natrium azida|amonium nitrat/i.test(r[1]), r[1]);
    assert.equal(racik(parseRumus(r[0]) && [...parseRumus(r[0])].map(([simbol, jumlah]) => ({ simbol, jumlah }))).pakai.id, r[8]);
  }
  for (const [k, b] of Object.entries(BENTUK_UNSUR)) assert.ok(b.pakai && b.pakai[0] && b.pakai[1], k);
});

ok("rumus bertanda kurung ditampilkan apa adanya (Ca(OH)2, Ca5(PO4)3OH)", () => {
  assert.equal(racik([{ simbol: "Ca", jumlah: 1 }, { simbol: "O", jumlah: 2 }, { simbol: "H", jumlah: 2 }]).rumus, "Ca(OH)2");
  assert.deepEqual(pecahTampilan("Ca(OH)2"), [["Ca", 1], ["(", 1], ["O", 1], ["H", 1], [")", 2]]);
  assert.equal(racik([{ simbol: "H", jumlah: 4 }, { simbol: "O", jumlah: 2 }]).rumus, "H4O2");
});

ok("tantangan: bacaRumus menolak tulisan yang salah dengan pesan dua bahasa", () => {
  assert.equal(bacaRumus("CO2").ok, true);
  assert.equal(bacaRumus("CO₂").ok, true); // angka bawah Unicode
  assert.equal(bacaRumus(" Ca ( OH ) 2 ").ok, true);
  for (const [t, kode] of [["", "kosong"], ["co2", "huruf-kecil"], ["2CO", "koefisien"], ["Xx", "simbol"], ["C-O", "karakter"], ["Ca(OH2", "kurung"], ["H0", "nol"], ["C()", "kurung-kosong"], ["(2H)", "angka-salah"]]) {
    const r = bacaRumus(t); assert.equal(r.ok, false, t); assert.equal(r.kode, kode, t); assert.ok(r.pesan.id && r.pesan.en, t);
  }
});

ok("tantangan: periksaRumus (cocok, kelipatan, salah, salah kapital)", () => {
  const B = (o) => new Map(Object.entries(o));
  assert.equal(periksaRumus(B({ C: 1, O: 2 }), "CO2").status, "cocok");
  assert.equal(periksaRumus(B({ O: 2, C: 1 }), "O2C").status, "cocok"); // urutan bebas
  assert.equal(periksaRumus(B({ H: 4, O: 2 }), "H2O").kelipatan, 2);
  const s1 = periksaRumus(B({ C: 1, O: 2 }), "CO"); assert.equal(s1.status, "tidak-cocok"); assert.ok(s1.detail.length >= 1);
  const s2 = periksaRumus(B({ C: 1, O: 2 }), "Co2"); assert.equal(s2.status, "tidak-cocok"); assert.match(s2.tip.id, /kapital/);
  assert.equal(periksaRumus(B({ C: 1, O: 2 }), "").status, "tulis");
});

ok("tantangan: aturanGabung (nyata, gas mulia, radioaktif, paduan, logam-logam, perbandingan, satu unsur)", () => {
  const B = (o) => new Map(Object.entries(o)), kode = (o) => { const r = aturanGabung(B(o)); return r.bisa ? "OK:" + r.hasil.nama.id : r.kode; };
  assert.equal(kode({ C: 1, O: 2 }), "OK:Karbon dioksida");
  assert.equal(kode({ H: 2, O: 1 }), "OK:Air");
  assert.equal(kode({ O: 2 }), "OK:Gas oksigen");
  assert.equal(kode({ He: 1, O: 2 }), "gas-mulia");
  assert.equal(kode({ U: 1, O: 2 }), "radioaktif");
  assert.equal(kode({ Cu: 1, Zn: 1 }), "paduan");
  assert.equal(kode({ Fe: 1, C: 1 }), "paduan");
  assert.equal(kode({ Na: 1, Fe: 1 }), "logam-logam");
  assert.equal(kode({ C: 1, O: 5 }), "perbandingan");
  assert.equal(kode({ Fe: 3 }), "satu-unsur");
  assert.equal(kode({ Au: 1, Cl: 1 }), "tak-terdaftar");
  for (const o of [{ Cu: 1, Zn: 1 }, { He: 1, O: 2 }, { Na: 1, Fe: 1 }, { C: 1, O: 5 }]) { const r = aturanGabung(B(o)); assert.ok(r.alasan.id.length > 30 && r.alasan.en.length > 30); }
  assert.ok(aturanGabung(B({ Cu: 1, Zn: 1 })).contoh.id.includes("kuningan"));
  // setiap senyawa daftar bisa digabung dari rumusnya sendiri
  for (const r of SENYAWA) assert.equal(aturanGabung(parseRumus(r[0])).bisa, true, r[0]);
});

ok("tantangan: bintang, beruntun, dan soal acak", () => {
  assert.deepEqual([1, 2, 3, 9].map(bintangUntuk), [3, 2, 1, 1]);
  let r = catatBenar(skorBersih(null), { percobaan: 1 }); assert.equal(r.bintang, 3); assert.equal(r.skor.beruntun, 1);
  r = catatBenar(r.skor, { percobaan: 1 }); assert.equal(r.skor.beruntun, 2); assert.equal(r.skor.terbaik, 2);
  assert.equal(catatSalah(r.skor).beruntun, 0); assert.equal(catatSalah(r.skor).bintang, 6); // tanpa hukuman bintang
  r = catatBenar(r.skor, { percobaan: 1, baru: false }); assert.equal(r.bintang, 0); // tak bisa mengulang untuk bintang
  r = catatBenar(r.skor, { percobaan: 2, baru: true, bonus: 1 }); assert.equal(r.bintang, 3);
  assert.deepEqual(skorBersih({ bintang: -5, beruntun: "x", terbaik: 2.7 }), { bintang: 0, beruntun: 0, terbaik: 2, benar: 0 });
  const rng = mulberry32(3);
  for (let i = 0; i < 40; i++) {
    const so = soalAcak(rng); assert.ok(so.nama.id && so.pakai.id && so.unsur.length >= 2);
    const hasil = racik([...parseRumus(so.rumus)].map(([simbol, jumlah]) => ({ simbol, jumlah })));
    assert.equal(soalTerpenuhi(so, hasil), true); assert.equal(soalTerpenuhi(so, racik([{ simbol: "Na", jumlah: 1 }, { simbol: "Cl", jumlah: 1 }])) || so.kunci === "ClNa", so.kunci === "ClNa");
  }
  const semua = SENYAWA.map((r) => rumusTeks(parseRumus(r[0])));
  assert.ok(soalAcak(rng, semua).nama.id); // bila semua sudah ditemukan tetap ada soal
});

ok("kartu hasil memuat contoh pemakaian (lebih tinggi daripada tanpa contoh)", () => {
  const h = racik([{ simbol: "C", jumlah: 1 }, { simbol: "O", jumlah: 2 }]);
  const a = ukuranKartuHasil(h, "id").tinggi, b = ukuranKartuHasil({ ...h, pakai: null }, "id").tinggi;
  assert.ok(a > b + 30, `${a} vs ${b}`);
});

console.log(`test-lab-kimia: ${n} kelompok tes lulus`);
