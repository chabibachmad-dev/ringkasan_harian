// Uji Latihan Matematika: mesin soal (tanpa browser) + uji tampilan bila Playwright tersedia.
// Jalankan: node test-latihan-mtk.mjs   (dari folder wa-bot)
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as S from "./latihan-mtk/soal.js";

const here = dirname(fileURLToPath(import.meta.url));
let lulus = 0, gagal = 0;
const uji = async (nama, fn) => { try { await fn(); lulus++; console.log("  ok  " + nama); } catch (e) { gagal++; console.log("GAGAL " + nama + "\n      " + (e && e.message)); } };

await uji("tiap topik x kelas x tingkat menghasilkan soal valid dan jawaban benar diterima", () => {
  let n = 0;
  for (const topik of Object.keys(S.TOPIK)) for (const k of S.KELAS) { if (k < S.TOPIK[topik].min) continue; for (const t of S.TINGKAT) for (let seed = 1; seed <= 25; seed++) {
    const s = S.buatSoal(topik, k, t, S.mulberry32(seed * 31 + k)); n++;
    if (s.jenis === "lembar") { assert.ok(S.periksa(s, S.jawabanLembar(s)).benar, `${topik} k${k} ${t} ${s.tampil}`); assert.ok(S.penjelasan(s).length > 0); }
    else if (s.jenis === "angka") assert.ok(S.periksa(s, { jawab: s.jawaban }).benar);
    else if (s.jenis === "pecahan") { assert.ok(S.periksa(s, { n: s.jawaban.n, d: s.jawaban.d }).benar); assert.ok(s.jawaban.n >= 1 && s.jawaban.d >= 1); assert.ok(S.penjelasan(s, "en").length > 0); }
    else if (s.jenis === "faktor") assert.ok(S.periksa(s, { pilih: s.jawaban }).benar);
  } }
  assert.ok(n > 2900);
});
await uji("pengurangan tidak pernah negatif dan tingkat mengatur pinjaman", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const m = S.buatSoal("kurang", 3, "mudah", S.mulberry32(seed)); assert.ok(m.a > m.b); assert.equal(S.hitungPinjam(m.a, m.b), 0);
    const d = S.buatSoal("kurang", 3, "sedang", S.mulberry32(seed)); assert.ok(S.hitungPinjam(d.a, d.b) >= 1);
  }
});
await uji("penjumlahan: mudah tanpa simpanan, sedang ada simpanan", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const m = S.buatSoal("tambah", 3, "mudah", S.mulberry32(seed)); assert.equal(S.hitungSimpan(m.a, m.b), 0);
    const d = S.buatSoal("tambah", 3, "sedang", S.mulberry32(seed)); assert.ok(S.hitungSimpan(d.a, d.b) >= 1);
  }
});
await uji("pembagian bersusun: hasil bagi dan sisa sesuai, mode pas tanpa sisa", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const p = S.buatSoal("bagi", 5, "sedang", S.mulberry32(seed)); assert.equal(p.sisa, 0); assert.equal(p.a % p.b, 0);
    const q = S.buatSoal("bagi", 4, "sulit", S.mulberry32(seed)); assert.equal(q.jawaban, Math.floor(q.a / q.b)); assert.equal(q.sisa, q.a % q.b);
    const hasil = S.langkahBagi(q.a, q.b).langkah.map((l) => l.q).join(""); assert.equal(Number(hasil), q.jawaban);
  }
});
await uji("perkalian bersusun: baris parsial dan total benar", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = S.buatSoal("kali", 6, "sulit", S.mulberry32(seed)); const kunci = S.jawabanLembar(s);
    const baris = s.lembar.baris.filter((b) => b.jenis === "isi"), total = baris[baris.length - 1].sel.map((c) => kunci[c.id]).join("");
    assert.equal(Number(total || 0), s.a * s.b);
  }
});
await uji("lembar: jawaban salah ditandai di kotak yang salah dan memberi petunjuk", () => {
  const s = S.buatSoal("tambah", 3, "sedang", S.mulberry32(3)), kunci = S.jawabanLembar(s), id = s.lembar.urutan[0];
  const salah = { ...kunci, [id]: String((Number(kunci[id]) + 1) % 10) }, r = S.periksa(s, salah);
  assert.equal(r.benar, false); assert.equal(r.salahPertama, id); assert.equal(r.sel[id], false);
  assert.match(S.petunjuk(s, r, "id"), /satuan/);
  assert.match(S.petunjuk(s, r, "en"), /ones/);
});
await uji("kotak depan kosong boleh dikosongkan atau 0", () => {
  const s = S.buatSoal("tambah", 2, "mudah", S.mulberry32(9)), kunci = S.jawabanLembar(s);
  const kosong = Object.keys(kunci).filter((k) => kunci[k] === ""); assert.ok(kosong.length >= 0);
  const x = { ...kunci }; for (const k of kosong) x[k] = "0"; assert.ok(S.periksa(s, x).benar);
});
await uji("pecahan: nilai benar tapi belum sederhana ditolak dengan status sederhanakan", () => {
  const s = { jenis: "pecahan", jawaban: { n: 1, d: 2 }, x: { n: 1, d: 4 }, y: { n: 1, d: 4 }, tipe: "tambah" };
  assert.equal(S.periksa(s, { n: "2", d: "4" }).status, "sederhanakan"); assert.ok(S.periksa(s, { n: "1", d: "2" }).benar); assert.equal(S.periksa(s, { n: "1", d: "3" }).status, "salah");
  const c = { jenis: "pecahan", jawaban: { n: 7, d: 4 } }; assert.ok(S.periksa(c, { bulat: "1", n: "3", d: "4" }).benar); assert.ok(S.periksa(c, { n: "7", d: "4" }).benar);
});
await uji("KPK/FPB benar dan faktor lengkap", () => {
  assert.equal(S.kpk(12, 18), 36); assert.equal(S.gcd(12, 18), 6); assert.deepEqual(S.faktorDari(24), [1, 2, 3, 4, 6, 8, 12, 24]);
  const f = { jenis: "faktor", jawaban: [1, 2, 3, 6] }; assert.equal(S.periksa(f, { pilih: [1, 2, 3] }).benar, false); assert.equal(S.periksa(f, { pilih: [1, 2, 3, 6, 4] }).benar, false); assert.ok(S.periksa(f, { pilih: [6, 3, 2, 1] }).benar);
});
await uji("soal cerita: operasi benar sesuai kalimat, pembagian habis, bahasa ID dan EN", () => {
  for (let seed = 1; seed <= 150; seed++) {
    const s = S.buatSoal("cerita", 4, "sedang", S.mulberry32(seed)); assert.ok(s.cerita.teks.id.length > 20 && s.cerita.teks.en.length > 20);
    assert.ok(!/[{}]/.test(s.cerita.teks.id + s.cerita.teks.en)); assert.ok(s.cerita.opsi.includes(s.cerita.opBenar));
    if (s.op === "bagi") assert.equal(s.sisa, 0);
    if (s.op === "kurang") assert.ok(s.a > s.b);
    assert.ok(String(s.a).length <= 4 && String(s.b).length <= 4);
  }
  assert.ok(S.buatSoal("cerita", 1, "mudah", S.mulberry32(1)).cerita.opsi.length === 2);
});
await uji("sesi tidak berisi soal kembar dan jumlahnya sesuai", () => {
  const sesi = S.buatSesi("tambah", 3, "sedang", S.mulberry32(5)); assert.equal(sesi.length, 5); assert.equal(new Set(sesi.map((x) => x.tampil)).size, 5);
  assert.equal(S.buatSesi("tabel", 3, "mudah", S.mulberry32(5)).length, 10);
});
await uji("topik terkunci sesuai kelas", () => {
  assert.deepEqual(S.topikTersedia(1).sort(), ["cerita", "kurang", "tambah"]); assert.ok(S.topikTersedia(2).includes("kali") && S.topikTersedia(2).includes("tabel"));
  assert.ok(S.topikTersedia(3).includes("bagi") && S.topikTersedia(3).includes("pecahan")); assert.ok(S.topikTersedia(4).includes("kpkfpb")); assert.ok(!S.topikTersedia(3).includes("kpkfpb"));
});
await uji("aturan poin: percobaan pertama penuh, kedua separuh, bantuan nol, bonus sesi sempurna", () => {
  assert.equal(S.poinSoal("tambah", "sulit", 1), 5); assert.equal(S.poinSoal("tambah", "sulit", 2), 3); assert.equal(S.poinSoal("tambah", "sulit", 3), 0); assert.equal(S.poinSoal("tambah", "sedang", 1, true), 0);
  assert.equal(S.poinSoal("tabel", "mudah", 2), 1);
  const semua = Array.from({ length: 5 }, () => ({ benar: true, percobaan: 1, bantuan: false })), r = S.ringkasSesi("tambah", "sedang", semua);
  assert.equal(r.poin, 5 * 3 + S.BONUS_SESI); assert.equal(r.bintang, 3); assert.ok(r.sempurna);
  const campur = [{ benar: true, percobaan: 1 }, { benar: true, percobaan: 2 }, { benar: false, percobaan: 2, bantuan: true }, { benar: true, percobaan: 1 }, { benar: true, percobaan: 1 }];
  const r2 = S.ringkasSesi("tambah", "sedang", campur); assert.equal(r2.poin, 3 + 2 + 0 + 3 + 3); assert.ok(!r2.sempurna);
});
await uji("rng sama -> soal sama (deterministik)", () => {
  assert.deepEqual(S.buatSoal("bagi", 5, "sulit", S.mulberry32(77)).tampil, S.buatSoal("bagi", 5, "sulit", S.mulberry32(77)).tampil);
});

// ---- uji tampilan (opsional, perlu Playwright + halaman terbangun) ----
const halaman = join(here, "latihan-mtk", "latihan-matematika.html");
let pw = null; try { pw = await import("playwright"); } catch { try { pw = (await import("module")).createRequire(import.meta.url)("playwright"); } catch { /* tidak ada */ } }
if (pw && existsSync(halaman)) {
  const { chromium } = pw.chromium ? pw : pw.default;
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 380, height: 800 } }); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const buka = async (q) => { await p.goto(pathToFileURL(halaman).href + q); };
  await uji("UI: sesi penuh benar semua -> 3 bintang, poin dikirim ke onPoin, bonus sempurna", async () => {
    await buka("?kelas=3&pemain=ujiA"); await p.click('.lm-chip:has-text("Mudah")'); await p.click('.lm-kartu:has-text("Penjumlahan")');
    for (let i = 0; i < 5; i++) {
      const m = (await p.textContent(".lm-tanya")).match(/(\d+) \+ (\d+)/); const hasil = String(Number(m[1]) + Number(m[2]));
      for (const d of hasil.split("").reverse()) await p.keyboard.press(d);
      await p.click(".lm-key.utama"); await p.waitForSelector(".lm-fb.ok"); await p.click(".lm-btn.utama");
    }
    await p.waitForSelector(".lm-hasil"); const poin = await p.evaluate(() => window.__poin.reduce((a, x) => a + x.p, 0)); assert.equal(poin, 5 * 2 + 5);
    assert.ok((await p.textContent(".lm-hasil .bt")).includes("★★★"));
    assert.ok((await p.evaluate(() => window.__poin.every((x) => x.info.sesiId && x.info.kelas === 3))));
  });
  await uji("UI: salah dua kali memunculkan Lihat caranya; melihat cara = 0 poin", async () => {
    await buka("?kelas=3&pemain=ujiB"); await p.click('.lm-kartu:has-text("Penjumlahan")');
    await p.keyboard.press("1"); await p.click(".lm-key.utama"); await p.click(".lm-key.utama");
    await p.click('.lm-btn:has-text("Lihat caranya")'); await p.waitForSelector(".lm-cara"); const poin = await p.evaluate(() => (window.__poin || []).reduce((a, x) => a + x.p, 0)); assert.equal(poin, 0);
  });
  await uji("UI: pembagian bersusun dapat diisi lewat papan ketik dan dinilai benar", async () => {
    await buka("?kelas=4&pemain=ujiC"); await p.click('.lm-kartu:has-text("Pembagian")');
    const m = (await p.textContent(".lm-tanya")).match(/(\d+) ÷ (\d+)/), a = Number(m[1]), d = Number(m[2]);
    const { langkah } = S.langkahBagi(a, d); const urut = [];
    langkah.forEach((L, i) => { urut.push(String(L.q)); urut.push(...String(L.prod).split("").reverse()); const last = i === langkah.length - 1; if (L.sisa > 0 || last) urut.push(...String(L.sisa).split("").reverse()); if (!last) urut.push(String(String(a)[L.c + 1])); });
    // urutan fokus: tiap langkah = bagi, kali (kanan ke kiri), sisa (kanan ke kiri), angka turun
    for (const k of urut) await p.keyboard.press(k);
    await p.click(".lm-key.utama"); assert.ok(await p.$(".lm-fb.ok"), "jawaban bersusun harus benar: " + (await p.textContent(".lm-fb").catch(() => "")));
  });
  await uji("UI: pecahan dan KPK dapat dijawab; cerita meminta pilih operasi dulu", async () => {
    await buka("?kelas=5&pemain=ujiD"); await p.click('.lm-kartu:has-text("KPK")');
    const tanya = await p.textContent(".lm-tanya, .lm-pec"); assert.ok(tanya.length > 2);
    await buka("?kelas=3&pemain=ujiE"); await p.click('.lm-kartu:has-text("Soal cerita")'); assert.ok(await p.$(".lm-op")); assert.equal(await p.$(".lm-key"), null);
  });
  await uji("UI: tidak ada galat skrip dan tidak ada luapan horizontal di layar sempit", async () => {
    await buka("?kelas=6&pemain=ujiF"); await p.click('.lm-chip:has-text("Sulit")'); await p.click('.lm-kartu:has-text("Penjumlahan")');
    const lebar = await p.evaluate(() => document.documentElement.scrollWidth); assert.ok(lebar <= 380 + 1, "scrollWidth " + lebar); assert.deepEqual(errs, []);
  });
  await b.close();
} else console.log("  (uji tampilan dilewati: Playwright atau latihan-matematika.html tidak ada)");
console.log(`\n${lulus} lulus, ${gagal} gagal`); process.exit(gagal ? 1 : 0);
