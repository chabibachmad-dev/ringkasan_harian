// Uji modul Laboratorium Kimia (tanpa pustaka luar; tidak butuh DOM atau kanvas sungguhan).
import assert from "node:assert/strict";
import { UNSUR, PER_SIMBOL, KATEGORI, SENYAWA } from "./lab-kimia/data.js";
import { racik, parseRumus, normalisasi, cariSenyawa, bahanAcak, mulberry32, rumusTeks } from "./lab-kimia/core.js";
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
  assert.ok(SENYAWA.length >= 35);
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

console.log(`test-lab-kimia: ${n} kelompok tes lulus`);
