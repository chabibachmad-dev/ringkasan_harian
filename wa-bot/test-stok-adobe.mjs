// Tes paket Adobe Stock (ikon + latar + CSV + penangan WA).   node test-stok-adobe.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bersihkanJudul, bersihkanKataKunci, buatCsv, periksaBaris, metadataUntuk, HEADER } from "./stok-adobe/metadata.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// 1. metadata
{
  check(bersihkanJudul("Mosque, icon: (new) *best*") === "Mosque icon new best", "judul: karakter khusus dibuang");
  check(bersihkanJudul("a ".repeat(60)).length <= 70, "judul dipotong <= 70");
  const k = bersihkanKataKunci(["Mosque", "mosque", "Adobe Stock", "canva icon", "ramadan, kareem", "x".repeat(60), "2026 2027 2028", "ok one"]);
  check(k.includes("mosque") && k.filter((x) => x === "mosque").length === 1, "kata kunci: huruf kecil dan unik");
  check(!k.some((x) => /adobe|canva/.test(x)), "kata kunci: merek dibuang");
  check(!k.some((x) => x.length > 40), "kata kunci: terlalu panjang dibuang");
  check(bersihkanKataKunci(Array.from({ length: 80 }, (_, i) => "kata" + String.fromCharCode(97 + (i % 26)) + Math.floor(i / 26))).length === 50, "kata kunci maks 50");
  const kata = Array.from({ length: 12 }, (_, i) => "kunci " + String.fromCharCode(97 + i));
  const csv = buatCsv([{ berkas: "ikon-a.svg", judul: "Crescent moon icon", kata }]);
  check(csv.startsWith(HEADER.join(",") + "\r\n") && /"kunci a,kunci b/.test(csv), "CSV: header persis dan kata kunci dikutip");
  let g = null; try { buatCsv([{ berkas: "x".repeat(40) + ".svg", judul: "ok judul", kata }]); } catch (e) { g = e; }
  check(g && /30 karakter/.test(g.message), "CSV: nama berkas > 30 ditolak");
  g = null; try { buatCsv([{ berkas: "a.svg", judul: "Midjourney style icon", kata }]); } catch (e) { g = e; }
  check(g, "CSV: judul bermerek ditolak");
  check(periksaBaris({ berkas: "a.svg", judul: "Judul bagus ok", kata: ["a", "b"] }).length === 1, "periksaBaris: kata kunci terlalu sedikit");
  const m1 = await metadataUntuk({ llm: async () => JSON.stringify({ title: "Cute lantern for Ramadan nights icon", keywords: Array.from({ length: 40 }, (_, i) => "kw " + i) }), berkas: "a.svg", subjek: "x", jenis: "ikon", tema: "ramadan", judulBawaan: "Lantern icon", kataBawaan: "lantern,ramadan" });
  check(m1.sumber === "ai" && m1.kata.length === 42, "metadata: AI dipakai dan dilengkapi katalog");
  const m2 = await metadataUntuk({ llm: async () => "bukan json", berkas: "a.svg", subjek: "x", jenis: "ikon", tema: "t", judulBawaan: "Lantern icon", kataBawaan: "lantern,ramadan,lamp,light,night,islam,eid" });
  check(m2.sumber === "katalog" && m2.judul === "Lantern icon", "metadata: AI rusak -> bawaan katalog");
  const m3 = await metadataUntuk({ llm: async () => { throw new Error("x"); }, berkas: "a.svg", subjek: "x", jenis: "ikon", tema: "t", judulBawaan: "Lantern icon", kataBawaan: "a,b,c,d,e,f,g" });
  check(m3.sumber === "katalog", "metadata: galat AI -> bawaan katalog");
}

// 2. bagian yang butuh python + skia-pathops + canvas
const py = process.env.STOK_PYTHON || "python3";
const adaPy = spawnSync(py, ["-c", "import pathops"]).status === 0;
let M = null; try { M = await import("./stok-adobe/stok-adobe.js"); } catch (e) { console.log("modul utama tidak termuat (butuh @napi-rs/canvas):", String(e.message).slice(0, 80)); }
if (!M) console.log("bagian lanjutan dilewati");
else {
  const { kenaliPerintahStok, normalisasiTema, susunRencana, katalogIkon, buatPaket, tanganiStokWa, muatRiwayat, jumlahPaketPekanIni, hariLalu, sudahAda, _tunda } = M;
  // perintah
  const k = kenaliPerintahStok;
  check(k("/adobe") && k("/adobe").aksi === "bantuan", "/adobe -> bantuan");
  check(k("/adobe setuju").aksi === "setuju" && k("/adobe batal").aksi === "batal" && k("/adobe riwayat").aksi === "riwayat", "setuju, batal, riwayat");
  const a = k("/adobe ikon dan latar ramadan 12 ikon 3 latar");
  check(a.jenis === "keduanya" && a.tema === "ramadan" && a.jumlahIkon === 12 && a.jumlahLatar === 3, "perintah ikon+latar ramadan");
  const b = k("/adobe ikon idul adha 8");
  check(b.jenis === "ikon" && b.jumlahIkon === 8 && b.tema === "idul adha", "ikon tema baru");
  check(k("/adobe latar batik").jenis === "latar" && k("/adobe latar batik").tema === "batik" && k("/adobe latar batik").jumlahLatar === 3, "latar batik, default 3");
  check(k("/adobe ikon ramadan 99").jumlahIkon === 24, "jumlah ikon dibatasi 24");
  check(k("/adobe ikon ramadan paksa").paksa === true, "kata paksa");
  check(k("buatkan video") === null && k("") === null, "bukan perintah -> null");
  const t3 = k("/adobe ikon 3d ramadan 4");
  check(t3.tiga === true && t3.jumlahIkon === 4 && t3.tema === "ramadan" && k("/adobe ikon ramadan 4").tiga === false, "perintah ikon 3D");
  check(k("/adobe ikon dan latar 3d ramadan 5 ikon 2 latar").tiga && k("/adobe ikon dan latar 3d ramadan 5 ikon 2 latar").jumlahLatar === 2, "ikon 3D + latar");
  check(normalisasiTema("buka puasa") === "ramadan" && normalisasiTema("buka toko") === "buka toko", "normalisasi tema");
  // riwayat
  check(hariLalu("2026-11-01", 6) === "2026-10-26", "hariLalu");
  const r0 = { paket: [{ tanggal: "2026-10-30", ikon: ["x"], latar: [] }, { tanggal: "2026-10-01" }] };
  check(jumlahPaketPekanIni(r0, "2026-11-01") === 1 && sudahAda(r0).ikon.has("x") && sudahAda(r0).ikon.has("hilal"), "riwayat: hitung pekan dan gabung seed");
  // tanpa kenal python: berhenti di sini
  if (!adaPy) console.log("python/skia-pathops tidak ada: tes mesin ikon dilewati");
  else {
    const katalog = katalogIkon({ python: py });
    check(katalog.length === 24 && katalog.every((x) => x.tema === "ramadan"), "katalog 24 ikon ramadan");
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "adobe-")); const tanggal = "2026-11-01";
    let r = await susunRencana({ perintah: a, riwayat: { paket: [] }, llm: null, katalog, tanggal });
    check(r.ikon.length === 0 && r.latar.length === 0 && r.catatan.length >= 1, "semua ramadan sudah diunggah -> rencana kosong (tidak membuat duplikat)");
    r = await susunRencana({ perintah: { ...a, paksa: true }, riwayat: { paket: [] }, llm: null, katalog, tanggal });
    check(r.ikon.length === 12 && r.latar.length === 3, "paksa: 12 ikon + 3 latar");
    // ikon baru dari AI (DSL)
    const spekBulan = { t: "diff", a: { t: "circle", cx: 32, cy: 32, r: 22 }, b: [{ t: "circle", cx: 40, cy: 28, r: 17 }] };
    const spekBuruk = { t: "circle", cx: 32, cy: 32, r: 60 };
    const llmIkon = async (p) => /Propose/.test(p) ? JSON.stringify({ ikon: [
      { nama: "Bulan Baru!", judul: "New moon icon", kata: "moon,night,dark,sky,lunar,space,crescent", spek: spekBulan },
      { nama: "terlalu-besar", judul: "Big icon", kata: "a,b,c,d,e,f,g", spek: spekBuruk },
      { nama: "hilal", judul: "dupe", kata: "x", spek: spekBulan }] })
      : JSON.stringify({ title: "Soft new moon sky icon", keywords: Array.from({ length: 38 }, (_, i) => "moon word " + i) });
    r = await susunRencana({ perintah: k("/adobe ikon idul adha 3"), riwayat: { paket: [] }, llm: llmIkon, katalog, tanggal });
    check(r.ikon.length === 2 && r.ikon[0].nama === "bulanbaru" && r.ikon.every((i) => i.sumber === "ai"), "AI: nama dirapikan, duplikat katalog dibuang");
    check(r.catatan.some((c) => /eksperimental/.test(c)), "AI: ada catatan eksperimental");
    // buat paket nyata: 1 ikon katalog + 1 ikon AI sah + 1 ikon AI buruk + 1 latar
    const rencana = { tema: "idul adha", temaAsli: "idul adha", jenis: "keduanya", tanggal, catatan: [],
      ikon: [{ nama: "hilal", judul: "Crescent moon icon", kata: katalog[0].kata, sumber: "katalog" }, { nama: "bulanbaru", judul: "New moon icon", kata: "moon,night,dark,sky,lunar,space,crescent", spek: spekBulan, sumber: "ai" }, { nama: "buruk", judul: "Bad icon", kata: "a,b,c,d,e,f,g", spek: spekBuruk, sumber: "ai" }],
      latar: [{ nama: "latar-abstrak-gradien", judul: "Abstract soft gradient background in blue purple and teal colors", kata: "abstract background,gradient,soft,blue,purple,teal,pink" }] };
    const h = await buatPaket({ rencana, llm: llmIkon, folder, python: py, tanggal });
    check(h.ikon.length === 2 && h.latar.length === 1 && h.lapor.gagal.length === 1 && /buruk/.test(h.lapor.gagal[0]), "paket: 2 ikon + 1 latar, 1 gagal tercatat");
    const daftarZip = spawnSync(py, ["-m", "zipfile", "-l", h.zip], { encoding: "utf8" }).stdout;
    check(/ikon\/ikon-hilal\.svg/.test(daftarZip) && /latar\/latar-abstrak-gradien\.jpg/.test(daftarZip) && /metadata-ikon\.csv/.test(daftarZip) && /metadata-latar\.csv/.test(daftarZip) && /PETUNJUK\.txt/.test(daftarZip), "zip berisi ikon, latar, dua CSV, petunjuk");
    const csvIkon = fs.readFileSync(path.join(h.folder, "metadata-ikon.csv"), "utf8");
    check(csvIkon.split("\r\n")[0] === HEADER.join(",") && csvIkon.trim().split("\r\n").length === 3, "CSV ikon: header + 2 baris");
    const svg = fs.readFileSync(path.join(h.folder, "ikon", "ikon-hilal.svg"), "utf8");
    check(!/stroke|<text|<image/.test(svg) && (svg.match(/M/g) || []).length === (svg.match(/Z/g) || []).length, "SVG: tanpa goresan/teks/gambar, jalur tertutup");
    check(h.pratinjau && fs.statSync(h.pratinjau).size > 1000, "lembar pratinjau dibuat");
    const jpg = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(h.folder, "latar", "latar-abstrak-gradien.jpg")], { encoding: "utf8" });
    if (jpg.status === 0) check(jpg.stdout.trim() === "5400,3600", "latar 5400x3600 (>= 4 MP)");

    // ikon 3D
    {
      const p3 = k("/adobe ikon 3d ramadan 2");
      const r3 = await susunRencana({ perintah: p3, riwayat: { paket: [] }, llm: null, katalog, tanggal });
      check(r3.tiga && r3.ikon.length === 2 && r3.catatan.some((c) => /maks 3 versi/.test(c)), "3D: rencana memakai subjek yang belum punya versi 3D + catatan kemiripan");
      const h3 = await buatPaket({ rencana: r3, llm: null, folder, python: py, tanggal });
      check(h3.ikon3d.length === 2 && h3.ikon.length === 0 && h3.lapor.gagal.length === 0, "3D: dua ikon 3D jadi");
      const f3 = path.join(h3.folder, "ikon3d", `3d-${h3.ikon3d[0]}.jpg`);
      const pr = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f3], { encoding: "utf8" });
      if (pr.status === 0) check(pr.stdout.trim() === "2400,2400", "3D: JPEG 2400x2400 (5,8 MP)");
      check(path.basename(f3).length <= 30, "3D: nama berkas <= 30");
      const csv3 = fs.readFileSync(path.join(h3.folder, "metadata-ikon3d.csv"), "utf8").trim().split("\r\n");
      check(csv3.length === 3 && /^3d-/.test(csv3[1]) && /,3D /.test(csv3[1]) && /3d icon/.test(csv3[1]), "3D: CSV berjudul 3D + kata kunci 3d icon");
      check(!fs.existsSync(path.join(h3.folder, "_svg")), "3D: SVG perantara dihapus");
      const z3 = spawnSync(py, ["-m", "zipfile", "-l", h3.zip], { encoding: "utf8" }).stdout;
      check(/ikon3d\/3d-/.test(z3) && /metadata-ikon3d\.csv/.test(z3) && !/_svg/.test(z3), "3D: zip berisi ikon3d/ dan CSV-nya");
    }
    // penangan WA
    const log = { teks: [], dok: [], gambar: [] };
    const dasar = { chatId: "c1", adalahPemilik: true, folder: path.join(folder, "bot"), python: py, tanggal, deps: { llm: llmIkon }, konfig: { maksPekan: 1 },
      kirimTeks: async (t) => log.teks.push(t), kirimDokumen: async (b, n, kt) => log.dok.push({ b, n, kt, ada: fs.existsSync(b) }), kirimGambar: async (b, n) => log.gambar.push(n) };
    check(await tanganiStokWa({ ...dasar, teks: "halo" }) === false, "WA: bukan perintah -> false");
    check(await tanganiStokWa({ ...dasar, teks: "/adobe ikon ramadan 2", adalahPemilik: false }) === true && /hanya untuk pemilik/.test(log.teks.at(-1)), "WA: bukan pemilik ditolak");
    await tanganiStokWa({ ...dasar, teks: "/adobe setuju" });
    check(/Tidak ada rencana/.test(log.teks.at(-1)), "WA: setuju tanpa rencana");
    await tanganiStokWa({ ...dasar, teks: "/adobe ikon dan latar ramadan 2 ikon 1 latar paksa" });
    check(/Rencana paket/.test(log.teks.at(-1)) && _tunda.has("c1"), "WA: rencana disusun dan menunggu");
    await tanganiStokWa({ ...dasar, teks: "/adobe batal" }); check(!_tunda.has("c1"), "WA: batal");
    await tanganiStokWa({ ...dasar, teks: "/adobe ikon dan latar ramadan 2 ikon 1 latar paksa" });
    await tanganiStokWa({ ...dasar, teks: "/adobe setuju" });
    check(log.dok.length === 1 && log.dok[0].ada && /^paket-adobe-.*\.zip$/.test(log.dok[0].n) && log.gambar.length === 1, "WA: zip dan pratinjau terkirim");
    check(muatRiwayat(dasar.folder).paket.length === 1, "WA: riwayat tersimpan");
    await tanganiStokWa({ ...dasar, teks: "/adobe ikon ramadan 2 paksa" });
    check(/Rencana paket/.test(log.teks.at(-1)), "WA: kata paksa melewati batas paket per pekan");
    await tanganiStokWa({ ...dasar, teks: "/adobe batal" });
    await tanganiStokWa({ ...dasar, teks: "/adobe ikon ramadan 2" });
    check(/Batas 1 paket/.test(log.teks.at(-1)), "WA: batas paket per pekan");
    await tanganiStokWa({ ...dasar, teks: "/adobe riwayat" }); check(/Paket 7 hari terakhir: 1/.test(log.teks.at(-1)) && /ikon 3D/.test(log.teks.at(-1)), "WA: riwayat");
    await tanganiStokWa({ ...dasar, teks: "/adobe ikon 3d ramadan 1 paksa" }); await tanganiStokWa({ ...dasar, teks: "/adobe setuju" });
    check(log.dok.length === 2 && /1 ikon 3D/.test(log.dok[1].kt) && muatRiwayat(dasar.folder).paket.at(-1).ikon3d.length === 1, "WA: alur ikon 3D dan riwayat ikon3d");
    await tanganiStokWa({ ...dasar, teks: "/adobe bantuan" }); check(/Upload CSV/.test(log.teks.at(-1)), "WA: bantuan");
  }
}
console.log(fails ? `\n${fails} tes GAGAL` : "\nSemua tes stok-adobe lolos");
process.exit(fails ? 1 : 0);
