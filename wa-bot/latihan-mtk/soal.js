// Mesin soal Latihan Matematika (murni, tanpa DOM): penjumlahan, pengurangan, perkalian, pembagian bersusun,
// soal cerita, pecahan, KPK/FPB/faktor, dan tabel perkalian. Kelas 1-6 x Mudah/Sedang/Sulit.
// Semua pembangkit menerima rng (0..1) supaya mudah diuji; jawaban selalu dihitung ulang, bukan ditulis tangan.

export const KELAS = [1, 2, 3, 4, 5, 6];
export const TINGKAT = ["mudah", "sedang", "sulit"];
export const TOPIK = {
  tambah: { min: 1, soal: 5 }, kurang: { min: 1, soal: 5 }, kali: { min: 2, soal: 5 }, bagi: { min: 3, soal: 5 },
  cerita: { min: 1, soal: 5 }, pecahan: { min: 3, soal: 5 }, kpkfpb: { min: 4, soal: 5 }, tabel: { min: 2, soal: 10 },
};
export const topikTersedia = (kelas) => Object.keys(TOPIK).filter((k) => kelas >= TOPIK[k].min);
const dua = (id, en) => ({ id, en });
export const rnd = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pilih = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
export const kpk = (a, b) => (a / gcd(a, b)) * b;
export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- angka ----------
function angkaDigit(rng, d, { dmin = 0, dmax = 9 } = {}) {
  let s = String(rnd(rng, Math.max(1, dmin), dmax));
  for (let i = 1; i < d; i++) s += String(rnd(rng, dmin, dmax));
  return Number(s);
}
export function hitungSimpan(a, b) { // jumlah simpanan pada a + b
  const x = String(a).split("").reverse().map(Number), y = String(b).split("").reverse().map(Number); let c = 0, n = 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const s = (x[i] || 0) + (y[i] || 0) + c; c = s >= 10 ? 1 : 0; n += c; }
  return n;
}
export function hitungPinjam(a, b) { // jumlah pinjaman pada a - b
  const x = String(a).split("").reverse().map(Number), y = String(b).split("").reverse().map(Number); let p = 0, n = 0;
  for (let i = 0; i < x.length; i++) { const d = x[i] - p - (y[i] || 0); p = d < 0 ? 1 : 0; n += p; }
  return n;
}
const cocokMode = (n, mode) => (mode === "tanpa" ? n === 0 : mode === "ada" ? n >= 1 : n >= 2);

// [digit a, digit b, mode simpan/pinjam, batas atas (opsional)]
const CFG_TAMBAH = {
  1: { mudah: [1, 1, "tanpa"], sedang: [1, 1, "ada"], sulit: [2, 1, "ada", 50] },
  2: { mudah: [2, 2, "tanpa"], sedang: [2, 2, "ada"], sulit: [3, 2, "banyak"] },
  3: { mudah: [3, 3, "tanpa"], sedang: [3, 3, "ada"], sulit: [3, 3, "banyak"] },
  4: { mudah: [4, 3, "ada"], sedang: [4, 4, "ada"], sulit: [5, 4, "banyak"] },
  5: { mudah: [4, 4, "ada"], sedang: [5, 5, "ada"], sulit: [6, 5, "banyak"] },
  6: { mudah: [5, 5, "ada"], sedang: [6, 5, "banyak"], sulit: [6, 6, "banyak"] },
};
const CFG_KURANG = {
  1: { mudah: [1, 1, "tanpa"], sedang: [2, 1, "ada", 20], sulit: [2, 1, "ada", 50] },
  2: { mudah: [2, 2, "tanpa"], sedang: [2, 2, "ada"], sulit: [3, 2, "banyak"] },
  3: { mudah: [3, 3, "tanpa"], sedang: [3, 3, "ada"], sulit: [4, 3, "banyak"] },
  4: { mudah: [4, 3, "ada"], sedang: [4, 4, "ada"], sulit: [5, 4, "banyak"] },
  5: { mudah: [5, 4, "ada"], sedang: [5, 5, "ada"], sulit: [6, 5, "banyak"] },
  6: { mudah: [6, 5, "ada"], sedang: [6, 6, "ada"], sulit: [7, 6, "banyak"] },
};
// [digit a, digit pengali]
const CFG_KALI = {
  2: { mudah: [2, 1], sedang: [2, 1], sulit: [3, 1] },
  3: { mudah: [2, 1], sedang: [3, 1], sulit: [3, 1] },
  4: { mudah: [3, 1], sedang: [3, 2], sulit: [4, 2] },
  5: { mudah: [3, 2], sedang: [4, 2], sulit: [3, 3] },
  6: { mudah: [4, 2], sedang: [3, 3], sulit: [4, 3] },
};
// [digit yang dibagi, digit pembagi, 'pas' | 'sisa']
const CFG_BAGI = {
  3: { mudah: [2, 1, "pas"], sedang: [3, 1, "pas"], sulit: [3, 1, "sisa"] },
  4: { mudah: [3, 1, "pas"], sedang: [4, 1, "sisa"], sulit: [4, 1, "sisa"] },
  5: { mudah: [3, 2, "pas"], sedang: [4, 2, "pas"], sulit: [4, 2, "sisa"] },
  6: { mudah: [4, 2, "sisa"], sedang: [5, 2, "pas"], sulit: [5, 2, "sisa"] },
};
const kelasAman = (kelas, tabel, min) => Math.min(6, Math.max(min, Number(kelas) || min)) && tabel[Math.min(6, Math.max(min, Number(kelas) || min))];

function bilTambah(rng, kelas, tingkat, maksDigit = 9) {
  const [da0, db0, mode, maks] = kelasAman(kelas, CFG_TAMBAH, 1)[tingkat], da = Math.min(da0, maksDigit), db = Math.min(db0, maksDigit);
  let a = 0, b = 0;
  for (let i = 0; i < 400; i++) {
    a = angkaDigit(rng, da); b = angkaDigit(rng, db);
    if (maks && a + b > maks) continue; if (da === db && b > a) [a, b] = [b, a];
    if (cocokMode(hitungSimpan(a, b), mode === "banyak" && da === 1 ? "ada" : mode)) break;
  }
  return [a, b];
}
function bilKurang(rng, kelas, tingkat, maksDigit = 9) {
  const [da0, db0, mode, maks] = kelasAman(kelas, CFG_KURANG, 1)[tingkat], da = Math.min(da0, maksDigit), db = Math.min(db0, maksDigit);
  let a = 0, b = 0;
  for (let i = 0; i < 600; i++) {
    a = angkaDigit(rng, da); b = angkaDigit(rng, db);
    if (maks && a > maks) continue; if (b >= a) continue;
    if (cocokMode(hitungPinjam(a, b), mode === "banyak" && da === 1 ? "ada" : mode)) break;
  }
  if (b >= a) { b = Math.max(1, a - 1); }
  return [a, b];
}
function bilKali(rng, kelas, tingkat, maksDigit = 9) {
  const [da0, db0] = kelasAman(kelas, CFG_KALI, 2)[tingkat], da = Math.min(da0, maksDigit), db = Math.min(db0, maksDigit);
  const dmax = tingkat === "mudah" ? 4 : 9, dmin = tingkat === "sulit" ? 3 : 0;
  const a = angkaDigit(rng, da, { dmin: Math.min(dmin, 2), dmax: Math.max(dmax, 2) });
  let b = db === 1 ? rnd(rng, 2, tingkat === "mudah" ? 5 : 9) : angkaDigit(rng, db, { dmin: tingkat === "sulit" ? 0 : 1, dmax: Math.max(dmax, 2) });
  if (b < 2) b = 2;
  return [a, b];
}
function bilBagi(rng, kelas, tingkat, maksDigit = 9) {
  const [dd0, ds0, mode] = kelasAman(kelas, CFG_BAGI, 3)[tingkat], dd = Math.min(dd0, maksDigit), ds = Math.min(ds0, dd - 1 > 0 ? maksDigit : maksDigit);
  const pembagi = ds === 1 ? rnd(rng, 2, tingkat === "mudah" ? 5 : 9) : rnd(rng, 11, tingkat === "mudah" ? 25 : 99);
  const lo = 10 ** (dd - 1), hi = 10 ** dd - 1;
  let bagi = 0;
  for (let i = 0; i < 300; i++) {
    const q = rnd(rng, Math.ceil(lo / pembagi), Math.floor(hi / pembagi)); if (q < 1) continue;
    const r = mode === "sisa" ? rnd(rng, 1, pembagi - 1) : 0, n = q * pembagi + r;
    if (n >= lo && n <= hi && (mode !== "pas" || (n % pembagi === 0 && q >= 2))) { bagi = n; break; }
  }
  if (!bagi) bagi = Math.ceil(lo / pembagi) * pembagi + (mode === "sisa" ? 1 : 0);
  return [bagi, pembagi];
}

// ---------- lembar bersusun ----------
const TEMPAT = { id: ["satuan", "puluhan", "ratusan", "ribuan", "puluh ribuan", "ratusan ribu", "jutaan"], en: ["ones", "tens", "hundreds", "thousands", "ten-thousands", "hundred-thousands", "millions"] };
export const namaTempat = (r, bahasa = "id") => (TEMPAT[bahasa] || TEMPAT.id)[r] || String(r);
class Pembuat {
  constructor(W) { this.W = W; this.baris = []; this.n = 0; this.urutan = []; this.meta = {}; }
  id() { return "c" + this.n++; }
  tetap(str, tanda, opsi = {}) { // angka diam, rata kanan pada kolom akhir
    const ke = opsi.akhir ?? this.W - 1, sel = [];
    for (let i = 0; i < str.length; i++) sel.push({ k: ke - str.length + 1 + i, t: "tetap", v: str[i] });
    this.baris.push({ jenis: "tetap", tanda: tanda || "", sel, atas: !!opsi.atas, label: opsi.label || "" });
  }
  garis(dari, sampai) { this.baris.push({ jenis: "garis", dari, sampai, sel: [] }); }
  bantu(dari, sampai, nama) { const sel = []; for (let k = dari; k <= sampai; k++) sel.push({ k, t: "bantu", id: this.id() }); this.baris.push({ jenis: "bantu", sel, nama }); }
  /** baris isian: digit-digit v (string) rata kanan pada kolom `akhir`, dengan `lebar` kotak (kotak kiri yang kosong = ''). */
  isi(v, lebar, akhir, meta = {}, opsi = {}) {
    const sel = [], p = String(v), ids = [];
    for (let i = 0; i < lebar; i++) {
      const dariKanan = lebar - 1 - i, ada = dariKanan < p.length, id = this.id();
      sel.push({ k: akhir - lebar + 1 + i, t: "isi", id, v: ada ? p[p.length - 1 - dariKanan] : "", r: dariKanan });
      this.meta[id] = { ...meta, r: dariKanan, kolom: akhir - lebar + 1 + i }; ids.push(id);
    }
    this.baris.push({ jenis: "isi", sel, tanda: opsi.tanda || "", label: opsi.label || "", atas: !!opsi.atas });
    return ids;
  }
  hasil() { return { kolom: this.W, baris: this.baris, urutan: this.urutan, meta: this.meta }; }
}
function lembarTambah(a, b) {
  const sa = String(a), sb = String(b), W = Math.max(sa.length, sb.length) + 1, P = new Pembuat(W), hasil = String(a + b);
  P.bantu(0, W - 2, "simpan"); P.tetap(sa); P.tetap(sb, "+"); P.garis(0, W - 1);
  const ids = P.isi(hasil, W, W - 1, { peran: "hasil" }); P.urutan = [...ids].reverse();
  return P.hasil();
}
function lembarKurang(a, b) {
  const sa = String(a), sb = String(b), W = sa.length, P = new Pembuat(W);
  P.bantu(0, W - 1, "pinjam"); P.tetap(sa); P.tetap(sb, "−"); P.garis(0, W - 1);
  const ids = P.isi(String(a - b), W, W - 1, { peran: "hasil" }); P.urutan = [...ids].reverse();
  return P.hasil();
}
function lembarKali(a, b) {
  const sa = String(a), sb = String(b), la = sa.length, db = sb.length, W = la + db, P = new Pembuat(W);
  P.bantu(W - la - 1, W - 2, "simpan"); P.tetap(sa); P.tetap(sb, "×"); P.garis(0, W - 1);
  if (db === 1) { const ids = P.isi(String(a * b), W, W - 1, { peran: "hasil" }); P.urutan = [...ids].reverse(); return P.hasil(); }
  for (let i = 0; i < db; i++) {
    const di = Number(sb[db - 1 - i]), p = String(a * di), akhir = W - 1 - i;
    const ids = P.isi(p, la + 1, akhir, { peran: "parsial", langkah: i + 1 });
    const baris = P.baris[P.baris.length - 1];
    for (let j = 0; j < i; j++) baris.sel.push({ k: W - 1 - j, t: "tetap", v: "0", dim: true });
    P.urutan.push(...[...ids].reverse());
  }
  P.garis(0, W - 1);
  const ids = P.isi(String(a * b), W, W - 1, { peran: "hasil" }); P.urutan.push(...[...ids].reverse());
  return P.hasil();
}
export function langkahBagi(dividen, pembagi) {
  const ds = String(dividen).split("").map(Number); let st = 0, cur = 0;
  while (cur < pembagi && st < ds.length) { cur = cur * 10 + ds[st]; st++; }
  const langkah = [];
  for (let c = st - 1; c < ds.length; c++) {
    if (c > st - 1) cur = langkah[langkah.length - 1].sisa * 10 + ds[c];
    const q = Math.floor(cur / pembagi), prod = q * pembagi, sisa = cur - prod;
    langkah.push({ c, cur, q, prod, sisa });
  }
  return { ds, langkah };
}
function lembarBagi(dividen, pembagi) {
  const { ds, langkah } = langkahBagi(dividen, pembagi), W = ds.length, P = new Pembuat(W);
  // baris hasil bagi (di atas)
  const qIds = [];
  { const sel = []; for (const L of langkah) { const id = P.id(); sel.push({ k: L.c, t: "isi", id, v: String(L.q), r: W - 1 - L.c }); P.meta[id] = { peran: "bagi", langkah: langkah.indexOf(L) + 1, kolom: L.c }; qIds.push(id); }
    P.baris.push({ jenis: "isi", sel, tanda: "", label: "", atas: false, hasilBagi: true }); }
  P.baris.push({ jenis: "tetap", tanda: "", label: `${pembagi} )`, atas: true, sel: ds.map((d, i) => ({ k: i, t: "tetap", v: String(d) })) });
  langkah.forEach((L, i) => {
    const urut = [qIds[i]], akhirKol = L.c, last = i === langkah.length - 1, lc = String(L.cur).length;
    const idsProd = P.isi(String(L.prod), String(L.prod).length, akhirKol, { peran: "kali", langkah: i + 1 }, { tanda: "−" }); urut.push(...[...idsProd].reverse());
    P.garis(akhirKol - lc + 1, akhirKol);
    const sel = [], idsSisa = [];
    const sisaStr = String(L.sisa), punyaSisa = L.sisa > 0 || last;
    if (punyaSisa) for (let j = 0; j < sisaStr.length; j++) { const id = P.id(); sel.push({ k: (last ? akhirKol : akhirKol) - sisaStr.length + 1 + j, t: "isi", id, v: sisaStr[j], r: sisaStr.length - 1 - j }); P.meta[id] = { peran: last ? "sisa" : "kurang", langkah: i + 1 }; idsSisa.push(id); }
    if (!last) { const id = P.id(); sel.push({ k: akhirKol + 1, t: "isi", id, v: String(ds[akhirKol + 1]), r: 0 }); P.meta[id] = { peran: "turun", langkah: i + 1 }; idsSisa.push(id); }
    P.baris.push({ jenis: "isi", sel, tanda: "", label: last ? "" : "", atas: false, sisaBaris: last });
    // urutan fokus: sisa dari kanan ke kiri (angka sisa), lalu angka yang diturunkan
    const sisaIds = idsSisa.filter((id) => P.meta[id].peran !== "turun").reverse(), turun = idsSisa.filter((id) => P.meta[id].peran === "turun");
    urut.push(...sisaIds, ...turun); P.urutan.push(...urut);
  });
  return P.hasil();
}

// ---------- penjelasan ----------
const fm = (n) => String(n);
function penjelasTambah(a, b, bahasa) {
  const x = String(a).split("").reverse().map(Number), y = String(b).split("").reverse().map(Number), out = []; let c = 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const s = (x[i] || 0) + (y[i] || 0) + c, nm = namaTempat(i, bahasa), tulis = s % 10, simpan = s >= 10 ? 1 : 0;
    out.push(bahasa === "en" ? `${nm}: ${x[i] || 0} + ${y[i] || 0}${c ? " + " + c + " (carried)" : ""} = ${s}. Write ${tulis}${simpan ? ", carry 1." : "."}` : `${nm}: ${x[i] || 0} + ${y[i] || 0}${c ? " + " + c + " (simpanan)" : ""} = ${s}. Tulis ${tulis}${simpan ? ", simpan 1." : "."}`);
    c = simpan;
  }
  if (c) out.push(bahasa === "en" ? `Last carry 1 goes in front: ${a + b}.` : `Simpanan terakhir 1 ditulis di depan: ${a + b}.`);
  return out;
}
function penjelasKurang(a, b, bahasa) {
  const x = String(a).split("").reverse().map(Number), y = String(b).split("").reverse().map(Number), out = []; let p = 0;
  for (let i = 0; i < x.length; i++) {
    const nm = namaTempat(i, bahasa), atas = x[i] - p, bawah = y[i] || 0;
    if (atas < bawah) { out.push(bahasa === "en" ? `${nm}: ${atas} − ${bawah} is not possible, so borrow 1 from the next place: ${atas + 10} − ${bawah} = ${atas + 10 - bawah}.` : `${nm}: ${atas} − ${bawah} tidak bisa, jadi pinjam 1 dari tempat di sebelahnya: ${atas + 10} − ${bawah} = ${atas + 10 - bawah}.`); p = 1; }
    else { out.push(`${nm}: ${atas} − ${bawah} = ${atas - bawah}${p && atas !== x[i] ? (bahasa === "en" ? " (after lending 1)" : " (setelah dipinjam 1)") : ""}.`); p = 0; }
  }
  return out;
}
function penjelasKali(a, b, bahasa) {
  const sb = String(b), db = sb.length, out = [];
  for (let i = 0; i < db; i++) { const d = Number(sb[db - 1 - i]); out.push(`${a} × ${d}${i ? " × " + 10 ** i : ""} = ${a * d * 10 ** i}`); }
  if (db > 1) out.push((bahasa === "en" ? "Add the rows: " : "Jumlahkan barisnya: ") + Array.from({ length: db }, (_, i) => a * Number(sb[db - 1 - i]) * 10 ** i).join(" + ") + ` = ${a * b}`);
  return out;
}
function penjelasBagi(dividen, pembagi, bahasa) {
  const { langkah } = langkahBagi(dividen, pembagi);
  const out = langkah.map((L, i) => (bahasa === "en"
    ? `Step ${i + 1}: ${L.cur} ÷ ${pembagi} = ${L.q} (because ${L.q} × ${pembagi} = ${L.prod}). ${L.cur} − ${L.prod} = ${L.sisa}${i < langkah.length - 1 ? ", then bring down the next digit." : "."}`
    : `Langkah ${i + 1}: ${L.cur} ÷ ${pembagi} = ${L.q} (karena ${L.q} × ${pembagi} = ${L.prod}). ${L.cur} − ${L.prod} = ${L.sisa}${i < langkah.length - 1 ? ", lalu turunkan angka berikutnya." : "."}`));
  const q = Math.floor(dividen / pembagi), r = dividen % pembagi;
  out.push(r ? (bahasa === "en" ? `Answer: ${q}, remainder ${r}.` : `Jawaban: ${q}, sisa ${r}.`) : (bahasa === "en" ? `Answer: ${q}.` : `Jawaban: ${q}.`));
  return out;
}

// ---------- soal cerita ----------
const NAMA = ["Budi", "Siti", "Ayu", "Raka", "Dina", "Eko", "Fajar", "Nisa"];
const BENDA = [["apel", "apples"], ["kelereng", "marbles"], ["buku", "books"], ["stiker", "stickers"], ["pensil", "pencils"], ["permen", "sweets"], ["jeruk", "oranges"], ["kue", "cakes"]];
const CERITA = {
  tambah: [
    [dua("{n1} punya {a} {benda}. Lalu {n2} memberi {b} {benda} lagi. Berapa {benda} {n1} sekarang?", "{n1} has {a} {benda}. Then {n2} gives {b} more {benda}. How many {benda} does {n1} have now?"), dua("Kata 'lagi' dan 'memberi' menunjukkan jumlahnya bertambah.", "The words 'more' and 'gives' show the amount grows.")],
    [dua("Di keranjang ada {a} {benda} merah dan {b} {benda} hijau. Berapa jumlah semua {benda} di keranjang?", "A basket holds {a} red {benda} and {b} green {benda}. How many {benda} are in the basket in all?"), dua("'Jumlah semua' berarti digabungkan.", "'In all' means put together.")],
    [dua("Pagi hari toko menjual {a} {benda}, sore hari {b} {benda}. Berapa {benda} yang terjual seharian?", "A shop sold {a} {benda} in the morning and {b} {benda} in the afternoon. How many {benda} were sold in the day?"), dua("Dua bagian digabung menjadi satu hari penuh.", "Two parts are joined into one whole day.")],
    [dua("{n1} membaca {a} halaman hari Senin dan {b} halaman hari Selasa. Berapa halaman yang dibaca seluruhnya?", "{n1} read {a} pages on Monday and {b} pages on Tuesday. How many pages were read altogether?"), dua("'Seluruhnya' berarti digabung.", "'Altogether' means joined.")],
  ],
  kurang: [
    [dua("{n1} punya {a} {benda}. {n1} memberikan {b} {benda} kepada {n2}. Berapa {benda} yang tersisa?", "{n1} has {a} {benda}. {n1} gives {b} {benda} to {n2}. How many {benda} are left?"), dua("'Memberikan' dan 'tersisa' menunjukkan jumlahnya berkurang.", "'Gives' and 'left' show the amount gets smaller.")],
    [dua("Ada {a} {benda} di dalam toples. Sebanyak {b} {benda} sudah dimakan. Berapa {benda} yang masih ada?", "A jar has {a} {benda}. {b} {benda} have been eaten. How many {benda} are still there?"), dua("Yang dimakan diambil dari semua.", "What was eaten is taken from the total.")],
    [dua("Sebuah buku tebalnya {a} halaman. {n1} sudah membaca {b} halaman. Berapa halaman yang belum dibaca?", "A book has {a} pages. {n1} has read {b} pages. How many pages are not read yet?"), dua("'Belum dibaca' berarti sisanya.", "'Not read yet' means what is left.")],
    [dua("Sebuah bus membawa {a} penumpang. Di terminal {b} penumpang turun. Berapa penumpang yang masih di bus?", "A bus carries {a} passengers. {b} passengers get off at the terminal. How many are still on the bus?"), dua("'Turun' berarti berkurang.", "'Get off' means fewer.")],
  ],
  kali: [
    [dua("Ada {b} kotak. Tiap kotak berisi {a} {benda}. Berapa jumlah {benda} seluruhnya?", "There are {b} boxes. Each box holds {a} {benda}. How many {benda} are there in all?"), dua("'Tiap kotak berisi' berarti jumlah yang sama diulang.", "'Each box holds' means the same amount repeated.")],
    [dua("{n1} membeli {b} bungkus {benda}. Tiap bungkus berisi {a} buah. Berapa buah {benda} semuanya?", "{n1} buys {b} packs of {benda}. Each pack has {a}. How many {benda} altogether?"), dua("Jumlah yang sama dalam beberapa bungkus.", "The same amount in several packs.")],
    [dua("Sebuah kelas memiliki {b} baris bangku. Tiap baris ada {a} bangku. Berapa bangku di kelas itu?", "A classroom has {b} rows of desks. Each row has {a} desks. How many desks are there?"), dua("'Tiap baris' menunjukkan pengulangan.", "'Each row' shows repetition.")],
    [dua("Seorang penjual menata {b} rak. Setiap rak diisi {a} {benda}. Berapa {benda} yang ditata?", "A seller arranges {b} shelves. Each shelf gets {a} {benda}. How many {benda} are arranged?"), dua("Setiap rak sama banyaknya.", "Every shelf has the same amount.")],
  ],
  bagi: [
    [dua("{n1} punya {a} {benda}. Ia membaginya sama banyak kepada {b} temannya. Berapa {benda} yang diterima tiap teman?", "{n1} has {a} {benda} and shares them equally with {b} friends. How many does each friend get?"), dua("'Dibagi sama banyak' berarti pembagian.", "'Shared equally' means division.")],
    [dua("{a} {benda} dimasukkan ke dalam kotak. Tiap kotak berisi {b} {benda}. Berapa kotak yang dibutuhkan?", "{a} {benda} are packed into boxes of {b} each. How many boxes are needed?"), dua("Mencari berapa kelompok yang berisi sama banyak.", "Finding how many equal groups there are.")],
    [dua("Ibu membagi {a} butir kue sama rata ke dalam {b} piring. Berapa butir kue di tiap piring?", "Mum shares {a} cakes equally onto {b} plates. How many cakes are on each plate?"), dua("'Sama rata' berarti pembagian.", "'Equally' means division.")],
    [dua("Panitia membagikan {a} buku kepada {b} kelas, masing-masing sama banyak. Berapa buku untuk tiap kelas?", "Organisers hand out {a} books to {b} classes, the same to each. How many books per class?"), dua("'Masing-masing sama banyak' berarti pembagian.", "'The same to each' means division.")],
  ],
};
const OP_TANDA = { tambah: "+", kurang: "−", kali: "×", bagi: "÷" };
export const OP_NAMA = { tambah: dua("Tambah", "Add"), kurang: dua("Kurang", "Subtract"), kali: dua("Kali", "Multiply"), bagi: dua("Bagi", "Divide") };

// ---------- bangun soal ----------
function soalHitung(op, a, b, extra = {}) {
  const lembar = op === "tambah" ? lembarTambah(a, b) : op === "kurang" ? lembarKurang(a, b) : op === "kali" ? lembarKali(a, b) : lembarBagi(a, b);
  const jawab = op === "tambah" ? a + b : op === "kurang" ? a - b : op === "kali" ? a * b : Math.floor(a / b), sisa = op === "bagi" ? a % b : 0;
  return { jenis: "lembar", op, a, b, tampil: `${a} ${OP_TANDA[op]} ${b}`, lembar, jawaban: jawab, sisa, ...extra };
}
function bangunBilangan(rng, op, kelas, tingkat, maksDigit) {
  return op === "tambah" ? bilTambah(rng, kelas, tingkat, maksDigit) : op === "kurang" ? bilKurang(rng, kelas, tingkat, maksDigit) : op === "kali" ? bilKali(rng, kelas, tingkat, maksDigit) : bilBagi(rng, kelas, tingkat, maksDigit);
}
function bangunCerita(rng, kelas, tingkat) {
  const ops = kelas <= 1 ? ["tambah", "kurang"] : kelas === 2 ? ["tambah", "kurang", "kali"] : ["tambah", "kurang", "kali", "bagi"], op = pilih(rng, ops);
  const kecil = kelas <= 2 ? 2 : kelas <= 3 ? 3 : 4; // angka tak terlalu besar agar cerita masuk akal
  let [a, b] = bangunBilangan(rng, op, Math.max(op === "kali" ? 2 : op === "bagi" ? 3 : 1, kelas), tingkat, kecil);
  if (op === "bagi") { const k = a % b; a -= k; if (a < b) a = b * 2; }
  const [teks, petunjuk] = pilih(rng, CERITA[op]), benda = pilih(rng, BENDA), n1 = pilih(rng, NAMA); let n2 = pilih(rng, NAMA); if (n2 === n1) n2 = NAMA[(NAMA.indexOf(n1) + 1) % NAMA.length];
  const isi = (s, bahasa) => s.replace(/\{n1\}/g, n1).replace(/\{n2\}/g, n2).replace(/\{a\}/g, a).replace(/\{b\}/g, b).replace(/\{benda\}/g, benda[bahasa === "en" ? 1 : 0]);
  return soalHitung(op, a, b, { topik: "cerita", cerita: { teks: dua(isi(teks.id, "id"), isi(teks.en, "en")), petunjuk, opBenar: op, opsi: ops } });
}
function pecahanSederhana(n, d) { const g = gcd(n, d); return { n: n / g, d: d / g }; }
function bangunPecahan(rng, kelas, tingkat) {
  const jenisBoleh = kelas <= 3 ? ["tambah", "kurang"]
    : kelas === 4 ? (tingkat === "mudah" ? ["tambah", "kurang"] : tingkat === "sedang" ? ["tambah", "kurang", "sederhanakan"] : ["tambah", "kurang", "sederhanakan", "tambah-beda"])
      : kelas === 5 ? (tingkat === "mudah" ? ["tambah", "kurang", "sederhanakan"] : ["tambah-beda", "kurang-beda", "sederhanakan"])
        : (tingkat === "mudah" ? ["tambah-beda", "kurang-beda", "kali"] : ["tambah-beda", "kurang-beda", "kali", "bagi"]);
  const tipe = pilih(rng, jenisBoleh), maksD = kelas <= 3 ? (tingkat === "mudah" ? 4 : 8) : tingkat === "mudah" ? 8 : 12;
  let x, y, hasil;
  if (tipe === "sederhanakan") {
    const f = rnd(rng, 2, tingkat === "sulit" ? 6 : 4), s = pecahanSederhana(rnd(rng, 1, 8), rnd(rng, 2, 9)); let n = s.n, d = s.d; if (n >= d) { n = d - 1; if (n < 1) { n = 1; d = 2; } }
    const sd = pecahanSederhana(n, d);
    x = { n: sd.n * f, d: sd.d * f }; hasil = { n: sd.n, d: sd.d }; return { jenis: "pecahan", tipe, tampil: `${x.n}/${x.d}`, x, op: "", y: null, jawaban: hasil };
  }
  if (tipe === "tambah" || tipe === "kurang") {
    const d = rnd(rng, 3, maksD), n1 = rnd(rng, 1, d - 1), n2 = rnd(rng, 1, d - 1); let a = n1, b = n2;
    if (tipe === "tambah" && kelas <= 3 && a + b > d) b = Math.max(1, d - a); if (tipe === "kurang" && b > a) [a, b] = [b, a]; if (tipe === "kurang" && a === b) a = Math.min(d - 1, a + 1), b = Math.max(1, a - 1);
    x = { n: a, d }; y = { n: b, d }; const h = tipe === "tambah" ? a + b : a - b; hasil = pecahanSederhana(h, d);
  } else if (tipe === "tambah-beda" || tipe === "kurang-beda") {
    let d1 = rnd(rng, 2, maksD), d2 = rnd(rng, 2, maksD), guard = 0; while ((d1 === d2 || kpk(d1, d2) > 24) && guard++ < 50) { d1 = rnd(rng, 2, 8); d2 = rnd(rng, 2, 8); }
    if (d1 === d2) d2 = d1 === 2 ? 4 : 2;
    let a = { n: rnd(rng, 1, d1 - 1), d: d1 }, b = { n: rnd(rng, 1, d2 - 1), d: d2 };
    if (tipe === "kurang-beda" && a.n * d2 < b.n * d1) [a, b] = [b, a]; if (tipe === "kurang-beda" && a.n * b.d === b.n * a.d) b = { n: 1, d: b.d };
    if (tipe === "kurang-beda" && a.n * b.d <= b.n * a.d) a = { n: a.d - 1, d: a.d }; // pastikan a > b
    const L = kpk(a.d, b.d), h = tipe === "tambah-beda" ? a.n * (L / a.d) + b.n * (L / b.d) : a.n * (L / a.d) - b.n * (L / b.d);
    x = a; y = b; hasil = pecahanSederhana(h, L);
  } else if (tipe === "kali") {
    x = { n: rnd(rng, 1, 5), d: rnd(rng, 2, 8) }; y = { n: rnd(rng, 1, 5), d: rnd(rng, 2, 8) }; if (x.n >= x.d) x.n = x.d - 1; if (y.n >= y.d) y.n = y.d - 1; hasil = pecahanSederhana(x.n * y.n, x.d * y.d);
  } else { // bagi
    x = { n: rnd(rng, 1, 5), d: rnd(rng, 2, 8) }; y = { n: rnd(rng, 1, 4), d: rnd(rng, 2, 6) }; if (x.n >= x.d) x.n = x.d - 1; if (y.n >= y.d) y.n = y.d - 1; hasil = pecahanSederhana(x.n * y.d, x.d * y.n);
  }
  return { jenis: "pecahan", tipe, tampil: `${x.n}/${x.d} ${tipe.startsWith("tambah") ? "+" : tipe.startsWith("kurang") ? "−" : tipe === "kali" ? "×" : "÷"} ${y.n}/${y.d}`, x, y, op: tipe.startsWith("tambah") ? "+" : tipe.startsWith("kurang") ? "−" : tipe === "kali" ? "×" : "÷", jawaban: hasil };
}
export const faktorDari = (n) => { const f = []; for (let i = 1; i <= n; i++) if (n % i === 0) f.push(i); return f; };
function bangunKpkFpb(rng, kelas, tingkat) {
  const jenis = pilih(rng, ["faktor", "kpk", "fpb"]);
  const batasF = tingkat === "mudah" ? 24 : tingkat === "sedang" ? 48 : kelas >= 6 ? 120 : 72, batasKF = tingkat === "mudah" ? 10 : tingkat === "sedang" ? 15 : kelas >= 6 ? 36 : 24;
  if (jenis === "faktor") { const n = rnd(rng, 8, batasF); return { jenis: "faktor", tampil: String(n), n, jawaban: faktorDari(n), pilihan: pilihanFaktor(rng, n) }; }
  let a = 0, b = 0;
  for (let i = 0; i < 300; i++) { a = rnd(rng, 4, batasKF); b = rnd(rng, 4, batasKF); if (a === b) continue; if (tingkat !== "mudah" && (a % b === 0 || b % a === 0)) continue; if (jenis === "fpb" && gcd(a, b) === 1) continue; if (jenis === "kpk" && kpk(a, b) > 400) continue; break; }
  if (a === b) b = a + 2;
  return { jenis: "angka", subjenis: jenis, tampil: `${jenis === "kpk" ? "KPK" : "FPB"}(${a}, ${b})`, a, b, jawaban: jenis === "kpk" ? kpk(a, b) : gcd(a, b) };
}
function pilihanFaktor(rng, n) { // semua kandidat 1..n (maks 12 pilihan) agar anak memilih yang benar
  const benar = faktorDari(n); if (n <= 36) return Array.from({ length: n }, (_, i) => i + 1);
  const set = new Set(benar); while (set.size < Math.min(benar.length + 6, 24)) set.add(rnd(rng, 2, n)); return [...set].sort((x, y) => x - y);
}
function bangunTabel(rng, kelas, tingkat) {
  const maks = kelas === 2 ? (tingkat === "mudah" ? 5 : 10) : kelas === 3 ? (tingkat === "mudah" ? 6 : 10) : tingkat === "mudah" ? 10 : 12;
  const faktorKecil = tingkat === "mudah" ? [2, 3, 4, 5, 10].filter((x) => x <= maks) : Array.from({ length: maks - 1 }, (_, i) => i + 2);
  const a = pilih(rng, faktorKecil), b = rnd(rng, 2, maks), bagi = kelas >= 3 && rng() < (tingkat === "mudah" ? 0.3 : 0.5);
  return bagi ? { jenis: "angka", subjenis: "tabel-bagi", tampil: `${a * b} ÷ ${a}`, a: a * b, b: a, jawaban: b } : { jenis: "angka", subjenis: "tabel-kali", tampil: `${a} × ${b}`, a, b, jawaban: a * b };
}

/** Buat satu soal. topik: tambah | kurang | kali | bagi | cerita | pecahan | kpkfpb | tabel */
export function buatSoal(topik, kelas, tingkat, rng = Math.random) {
  if (!TOPIK[topik]) throw new Error("topik tak dikenal: " + topik);
  kelas = Math.min(6, Math.max(TOPIK[topik].min, Number(kelas) || 1)); if (!TINGKAT.includes(tingkat)) tingkat = "mudah";
  let s;
  if (topik === "cerita") s = bangunCerita(rng, kelas, tingkat);
  else if (topik === "pecahan") s = bangunPecahan(rng, kelas, tingkat);
  else if (topik === "kpkfpb") s = bangunKpkFpb(rng, kelas, tingkat);
  else if (topik === "tabel") s = bangunTabel(rng, kelas, tingkat);
  else { const [a, b] = bangunBilangan(rng, topik, kelas, tingkat); s = soalHitung(topik, a, b); }
  s.topik = topik; s.kelas = kelas; s.tingkat = tingkat; return s;
}
/** Satu sesi: soal-soal tidak kembar. */
export function buatSesi(topik, kelas, tingkat, rng = Math.random, n = TOPIK[topik].soal) {
  const out = [], lihat = new Set();
  for (let i = 0, coba = 0; out.length < n && coba < n * 30; coba++) { const s = buatSoal(topik, kelas, tingkat, rng), k = s.tampil + (s.cerita ? s.cerita.teks.id : ""); if (lihat.has(k)) continue; lihat.add(k); out.push(s); i++; }
  while (out.length < n) out.push(buatSoal(topik, kelas, tingkat, rng));
  return out;
}

// ---------- periksa jawaban ----------
const bersih = (v) => String(v ?? "").trim();
/** isian: untuk lembar = {id: "digit"}, angka = {jawab}, pecahan = {bulat, n, d}, faktor = {pilih: [..]}. */
export function periksa(soal, isian = {}) {
  if (soal.jenis === "lembar") {
    const sel = {}; let benar = true, kosong = 0, salahPertama = null;
    const semua = {}; for (const b of soal.lembar.baris) for (const c of b.sel) if (c.t === "isi") semua[c.id] = c;
    for (const id of soal.lembar.urutan) {
      const c = semua[id], v = bersih(isian[id]), ok = c.v === "" ? v === "" || v === "0" : v === c.v;
      sel[id] = ok; if (!ok) { benar = false; if (v === "") kosong++; if (!salahPertama) salahPertama = id; }
    }
    return { benar, sel, salahPertama, kosong, status: benar ? "benar" : "salah" };
  }
  if (soal.jenis === "angka") {
    const t = bersih(isian.jawab).replace(",", "."), v = Number(t);
    if (!t || !Number.isFinite(v)) return { benar: false, status: "kosong" };
    return { benar: v === soal.jawaban, status: v === soal.jawaban ? "benar" : "salah" };
  }
  if (soal.jenis === "pecahan") {
    const n = Number(bersih(isian.n)), d = Number(bersih(isian.d)), b = bersih(isian.bulat) === "" ? 0 : Number(bersih(isian.bulat));
    if (bersih(isian.n) === "" || bersih(isian.d) === "" || ![n, d, b].every(Number.isFinite) || d <= 0) {
      if (bersih(isian.n) === "" && bersih(isian.d) === "" && bersih(isian.bulat) !== "" && Number(isian.bulat) === soal.jawaban.n / soal.jawaban.d) return { benar: true, status: "benar" };
      return { benar: false, status: "kosong" };
    }
    const sama = (b * d + n) * soal.jawaban.d === soal.jawaban.n * d;
    if (!sama) return { benar: false, status: "salah" };
    const sederhana = gcd(n, d) === 1 || n === 0;
    if (!sederhana) return { benar: false, status: "sederhanakan" };
    return { benar: true, status: "benar" };
  }
  if (soal.jenis === "faktor") {
    const pilih = new Set((isian.pilih || []).map(Number)), benar = new Set(soal.jawaban);
    const kurang = [...benar].filter((x) => !pilih.has(x)), lebih = [...pilih].filter((x) => !benar.has(x));
    return { benar: !kurang.length && !lebih.length, status: !kurang.length && !lebih.length ? "benar" : pilih.size ? "salah" : "kosong", kurang, lebih };
  }
  return { benar: false, status: "salah" };
}
/** Nilai benar tiap kotak (untuk 'lihat jawaban'). */
export function jawabanLembar(soal) { const o = {}; for (const b of soal.lembar.baris) for (const c of b.sel) if (c.t === "isi") o[c.id] = c.v; return o; }

/** Langkah penjelasan ramah anak. */
export function penjelasan(soal, bahasa = "id") {
  if (soal.jenis === "lembar") {
    const fn = { tambah: penjelasTambah, kurang: penjelasKurang, kali: penjelasKali, bagi: penjelasBagi }[soal.op];
    return fn(soal.a, soal.b, bahasa);
  }
  if (soal.jenis === "angka") {
    if (soal.subjenis === "kpk") { const k = (n, lim) => Array.from({ length: Math.ceil(lim / n) }, (_, i) => n * (i + 1)).join(", "); return [bahasa === "en" ? `Multiples of ${soal.a}: ${k(soal.a, soal.jawaban)}` : `Kelipatan ${soal.a}: ${k(soal.a, soal.jawaban)}`, bahasa === "en" ? `Multiples of ${soal.b}: ${k(soal.b, soal.jawaban)}` : `Kelipatan ${soal.b}: ${k(soal.b, soal.jawaban)}`, bahasa === "en" ? `The smallest number in both lists is ${soal.jawaban}.` : `Angka terkecil yang ada di kedua daftar adalah ${soal.jawaban}.`]; }
    if (soal.subjenis === "fpb") return [bahasa === "en" ? `Factors of ${soal.a}: ${faktorDari(soal.a).join(", ")}` : `Faktor ${soal.a}: ${faktorDari(soal.a).join(", ")}`, bahasa === "en" ? `Factors of ${soal.b}: ${faktorDari(soal.b).join(", ")}` : `Faktor ${soal.b}: ${faktorDari(soal.b).join(", ")}`, bahasa === "en" ? `The biggest number in both lists is ${soal.jawaban}.` : `Angka terbesar yang ada di kedua daftar adalah ${soal.jawaban}.`];
    return [soal.subjenis === "tabel-bagi" ? (bahasa === "en" ? `Think: ${soal.b} × ? = ${soal.a}. The answer is ${soal.jawaban}.` : `Pikirkan: ${soal.b} × ? = ${soal.a}. Jawabannya ${soal.jawaban}.`) : (bahasa === "en" ? `${soal.a} × ${soal.b} = ${soal.jawaban}. Count in steps of ${soal.a}.` : `${soal.a} × ${soal.b} = ${soal.jawaban}. Hitung loncat ${soal.a}.`)];
  }
  if (soal.jenis === "faktor") return [bahasa === "en" ? `A factor divides ${soal.n} with no remainder. The factors are: ${soal.jawaban.join(", ")}.` : `Faktor adalah bilangan yang membagi ${soal.n} tanpa sisa. Faktornya: ${soal.jawaban.join(", ")}.`];
  if (soal.jenis === "pecahan") {
    const { x, y, tipe, jawaban } = soal, hasil = jawaban.n >= jawaban.d ? `${Math.floor(jawaban.n / jawaban.d)}${jawaban.n % jawaban.d ? " " + (jawaban.n % jawaban.d) + "/" + jawaban.d : ""}` : `${jawaban.n}/${jawaban.d}`;
    if (tipe === "sederhanakan") { const g = gcd(x.n, x.d); return [bahasa === "en" ? `Divide the top and bottom by ${g}: ${x.n}/${x.d} = ${jawaban.n}/${jawaban.d}.` : `Bagi atas dan bawah dengan ${g}: ${x.n}/${x.d} = ${jawaban.n}/${jawaban.d}.`]; }
    if (tipe === "tambah" || tipe === "kurang") return [bahasa === "en" ? `Same denominator ${x.d}: ${tipe === "tambah" ? "add" : "subtract"} the numerators: ${x.n} ${tipe === "tambah" ? "+" : "−"} ${y.n} = ${tipe === "tambah" ? x.n + y.n : x.n - y.n}. Then simplify: ${hasil}.` : `Penyebut sama (${x.d}): ${tipe === "tambah" ? "jumlahkan" : "kurangkan"} pembilangnya: ${x.n} ${tipe === "tambah" ? "+" : "−"} ${y.n} = ${tipe === "tambah" ? x.n + y.n : x.n - y.n}. Lalu sederhanakan: ${hasil}.`];
    if (tipe === "tambah-beda" || tipe === "kurang-beda") { const L = kpk(x.d, y.d); return [bahasa === "en" ? `Make the denominators equal: KPK(${x.d}, ${y.d}) = ${L}.` : `Samakan penyebut: KPK(${x.d}, ${y.d}) = ${L}.`, `${x.n * (L / x.d)}/${L} ${tipe === "tambah-beda" ? "+" : "−"} ${y.n * (L / y.d)}/${L} = ${tipe === "tambah-beda" ? x.n * (L / x.d) + y.n * (L / y.d) : x.n * (L / x.d) - y.n * (L / y.d)}/${L} = ${hasil}`]; }
    if (tipe === "kali") return [bahasa === "en" ? `Multiply tops and bottoms: ${x.n * y.n}/${x.d * y.d}, then simplify: ${hasil}.` : `Kalikan atas dengan atas dan bawah dengan bawah: ${x.n * y.n}/${x.d * y.d}, lalu sederhanakan: ${hasil}.`];
    return [bahasa === "en" ? `Flip the second fraction and multiply: ${x.n}/${x.d} × ${y.d}/${y.n} = ${x.n * y.d}/${x.d * y.n} = ${hasil}.` : `Balik pecahan kedua lalu kalikan: ${x.n}/${x.d} × ${y.d}/${y.n} = ${x.n * y.d}/${x.d * y.n} = ${hasil}.`];
  }
  return [];
}
/** Petunjuk singkat setelah jawaban salah (tidak membocorkan jawaban). */
export function petunjuk(soal, hasilPeriksa, bahasa = "id") {
  const en = bahasa === "en";
  if (soal.jenis === "lembar") {
    if (!hasilPeriksa.salahPertama) return "";
    const m = soal.lembar.meta[hasilPeriksa.salahPertama] || {};
    if (soal.op === "bagi") {
      const nm = { bagi: en ? "quotient digit" : "angka hasil bagi", kali: en ? "product" : "hasil kali", kurang: en ? "subtraction result" : "hasil pengurangan", sisa: en ? "remainder" : "sisa", turun: en ? "brought-down digit" : "angka yang diturunkan" }[m.peran] || "";
      return en ? `Check the ${nm} in step ${m.langkah}.` : `Periksa ${nm} pada langkah ke-${m.langkah}.`;
    }
    if (m.peran === "parsial") return en ? `Check row ${m.langkah} (${soal.a} × the ${namaTempat(m.langkah - 1, bahasa)} digit).` : `Periksa baris ke-${m.langkah} (${soal.a} × angka ${namaTempat(m.langkah - 1, bahasa)}).`;
    return en ? `Check the ${namaTempat(m.r, bahasa)} column.` : `Periksa kolom ${namaTempat(m.r, bahasa)}.`;
  }
  if (soal.jenis === "pecahan") return hasilPeriksa.status === "sederhanakan" ? (en ? "Correct value, but it can be simplified more." : "Nilainya benar, tetapi masih bisa disederhanakan lagi.") : (en ? "Not yet. Look at the steps again." : "Belum tepat. Coba lihat langkahnya lagi.");
  if (soal.jenis === "faktor") return hasilPeriksa.lebih && hasilPeriksa.lebih.length ? (en ? "Some chosen numbers are not factors: a factor divides evenly." : "Ada angka terpilih yang bukan faktor: faktor harus membagi tanpa sisa.") : (en ? "You missed some factors. Try dividing by every number." : "Masih ada faktor yang terlewat. Coba bagi dengan tiap bilangan.");
  if (soal.subjenis === "kpk") return en ? "Write the multiples of both numbers and find the first one they share." : "Tulis kelipatan kedua bilangan, cari yang pertama sama.";
  if (soal.subjenis === "fpb") return en ? "Write the factors of both numbers and find the biggest one they share." : "Tulis faktor kedua bilangan, cari yang terbesar yang sama.";
  return en ? "Not quite. Try again." : "Belum tepat. Coba lagi.";
}

// ---------- poin ----------
const POIN_DASAR = { tambah: { mudah: 2, sedang: 3, sulit: 5 }, kurang: { mudah: 2, sedang: 3, sulit: 5 }, kali: { mudah: 2, sedang: 3, sulit: 5 }, bagi: { mudah: 3, sedang: 4, sulit: 6 }, cerita: { mudah: 3, sedang: 4, sulit: 6 }, pecahan: { mudah: 3, sedang: 4, sulit: 6 }, kpkfpb: { mudah: 3, sedang: 4, sulit: 6 }, tabel: { mudah: 1, sedang: 1, sulit: 2 } };
/** percobaan = percobaan ke berapa benar (1 = langsung benar). bantuan = true bila melihat jawaban. */
export function poinSoal(topik, tingkat, percobaan, bantuan = false) {
  if (bantuan || percobaan < 1 || percobaan > 2) return 0;
  const dasar = POIN_DASAR[topik][tingkat] || 1;
  return percobaan === 1 ? dasar : Math.max(1, Math.ceil(dasar / 2));
}
export const BONUS_SESI = 5;
export function ringkasSesi(topik, tingkat, hasil) { // hasil: [{benar, percobaan, bantuan}]
  const benar = hasil.filter((h) => h.benar).length, pertama = hasil.filter((h) => h.benar && h.percobaan === 1 && !h.bantuan).length;
  let poin = hasil.reduce((a, h) => a + (h.benar ? poinSoal(topik, tingkat, h.percobaan, h.bantuan) : 0), 0);
  const sempurna = hasil.length >= 5 && pertama === hasil.length; if (sempurna) poin += BONUS_SESI;
  const bintang = benar === hasil.length && pertama >= Math.ceil(hasil.length * 0.8) ? 3 : benar >= Math.ceil(hasil.length * 0.8) ? 2 : benar >= Math.ceil(hasil.length * 0.5) ? 1 : 0;
  return { soal: hasil.length, benar, benarPertama: pertama, poin, sempurna, bintang };
}
