// Mesin racik Laboratorium Kimia (murni, tanpa DOM): rumus, senyawa nyata, zat fiktif, nama, warna, sprite pixel.
// Bahan boleh sebanyak apa pun (jenis unsur tidak dibatasi); hasil selalu sama untuk bahan yang sama (deterministik).
import { UNSUR, PER_SIMBOL, SENYAWA, KATEGORI, BENTUK_UNSUR } from "./data.js";

export const BATAS_JUMLAH = 999; // jumlah atom per jenis unsur

// ---------- acak deterministik ----------
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export function mulberry32(a) {
  a = a >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pilih = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ---------- rumus ----------
export function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }
function tambah(m, k, n) { m.set(k, (m.get(k) || 0) + n); }

/** "Ca(OH)2" -> Map {Ca:1, O:2, H:2}. Melempar galat bila simbol tak dikenal. */
export function parseRumus(s) {
  const st = [new Map()]; let i = 0;
  const angka = () => { let n = ""; while (/\d/.test(s[i] || "")) n += s[i++]; return n ? Number(n) : 1; };
  while (i < s.length) {
    const c = s[i];
    if (c === "(") { st.push(new Map()); i++; }
    else if (c === ")") { i++; const k = angka(), top = st.pop(); for (const [a, b] of top) tambah(st[st.length - 1], a, b * k); }
    else if (/[A-Z]/.test(c)) {
      let sim = c; i++; if (/[a-z]/.test(s[i] || "")) sim += s[i++];
      if (!PER_SIMBOL.has(sim)) throw new Error("simbol tak dikenal: " + sim);
      tambah(st[st.length - 1], sim, angka());
    } else throw new Error("karakter tak dikenal: " + c);
  }
  return st[0];
}

/** Urutan Hill: bila ada C -> C, H, lalu abjad; selain itu abjad semua. */
export function urutHill(counts) {
  const sims = [...counts.keys()];
  if (counts.has("C")) return ["C", ...(counts.has("H") ? ["H"] : []), ...sims.filter((s) => s !== "C" && s !== "H").sort()];
  return sims.sort();
}
export function pecahRumus(counts) { return urutHill(counts).map((s) => [s, counts.get(s)]); }
export function rumusTeks(counts) { return pecahRumus(counts).map(([s, n]) => s + (n > 1 ? n : "")).join(""); }
const SUB = "₀₁₂₃₄₅₆₇₈₉";
export function unicodeDariPecah(pecah) { return pecah.map(([s, n]) => s + (n > 1 ? String(n).replace(/\d/g, (d) => SUB[d]) : "")).join(""); }
export function rumusUnicode(counts) { return unicodeDariPecah(pecahRumus(counts)); }

/** Rapikan daftar bahan [{simbol, jumlah}] (boleh dobel, urutan bebas, tak terbatas jenisnya). */
export function normalisasi(bahan) {
  const counts = new Map();
  for (const b of bahan || []) {
    const sim = b && (b.simbol || b[0]);
    if (!PER_SIMBOL.has(sim)) continue;
    const n = Math.min(BATAS_JUMLAH, Math.max(0, Math.floor(Number(b.jumlah ?? b[1] ?? 1)) || 0));
    if (n > 0) tambah(counts, sim, n);
  }
  for (const [k, v] of counts) if (v > BATAS_JUMLAH) counts.set(k, BATAS_JUMLAH);
  return counts;
}

export function massaMolekul(counts) { let m = 0; for (const [s, n] of counts) m += PER_SIMBOL.get(s).massa * n; return Math.round(m * 1000) / 1000; }
export function totalProton(counts) { let p = 0; for (const [s, n] of counts) p += PER_SIMBOL.get(s).z * n; return p; }
export function jumlahAtom(counts) { let a = 0; for (const n of counts.values()) a += n; return a; }

// ---------- senyawa nyata ----------
const INDEKS = new Map(SENYAWA.map((r) => { const c = parseRumus(r[0]); return [rumusTeks(c), r]; }));
function kurangi(counts) {
  let g = 0; for (const n of counts.values()) g = gcd(g, n);
  if (g <= 1) return { counts, k: 1 };
  const r = new Map(); for (const [s, n] of counts) r.set(s, n / g);
  return { counts: r, k: g };
}
/** Cari senyawa nyata: tepat dulu (H2O2), lalu kelipatan (H4O2 = 2 x H2O). */
export function cariSenyawa(counts) {
  const tepat = INDEKS.get(rumusTeks(counts));
  if (tepat) return { baris: tepat, kelipatan: 1 };
  const { counts: r, k } = kurangi(counts);
  if (k > 1) { const b = INDEKS.get(rumusTeks(r)); if (b) return { baris: b, kelipatan: k }; }
  return null;
}

// ---------- warna ----------
export const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgbHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export function hslHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
export function hexHsl(hex) {
  let [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l];
}
export const gelapkan = (hex, f) => { const [r, g, b] = hexRgb(hex); return rgbHex(r * f, g * f, b * f); };
export const terangkan = (hex, f) => { const [r, g, b] = hexRgb(hex); return rgbHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); };

export function namaWarna(hex) {
  const [h, s, l] = hexHsl(hex);
  const t = (id, en) => ({ id, en });
  if (l < 0.14) return t("hitam", "black");
  if (l > 0.9 && s < 0.5) return t("putih", "white");
  if (s < 0.12) return l > 0.75 ? t("putih keabuan", "off-white") : t("abu-abu", "gray");
  if (h < 15 || h >= 345) return l < 0.4 ? t("merah tua", "dark red") : t("merah", "red");
  if (h < 40) return l < 0.42 ? t("cokelat", "brown") : t("jingga", "orange");
  if (h < 70) return l < 0.4 ? t("cokelat kekuningan", "olive") : t("kuning", "yellow");
  if (h < 160) return t("hijau", "green");
  if (h < 200) return t("toska", "teal");
  if (h < 255) return t("biru", "blue");
  if (h < 290) return t("ungu", "purple");
  return t("merah muda", "pink");
}

// ---------- nama zat fiktif ----------
const VOKAL = "aeiou";
export function akar(nama) {
  const n = nama.toLowerCase().replace(/[^a-z]/g, "");
  for (let i = 3; i <= Math.min(5, n.length); i++) if (VOKAL.includes(n[i - 1])) return n.slice(0, i);
  return n.slice(0, 4);
}
const AKHIRAN = ["ium", "ida", "it", "on", "ase", "il", "ol", "oks", "ina", "ar"];
const AWALAN = [[15, "Omni"], [8, "Giga"], [4, "Mega"]];
const huruf = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function namaFiksi(counts, rng) {
  const urut = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const batang = urut.slice(0, 3).map(([s]) => akar(PER_SIMBOL.get(s).nama.id)).join("");
  const awalan = (AWALAN.find(([min]) => counts.size >= min) || [0, ""])[1];
  const nama = huruf((awalan ? awalan.toLowerCase() : "") + batang + pilih(rng, AKHIRAN));
  return awalan ? huruf(nama) : nama;
}
function simbolFiksi(nama, rng) {
  const sisa = nama.slice(1).toLowerCase().split("").filter((c) => !VOKAL.includes(c) && /[a-z]/.test(c));
  return nama[0].toUpperCase() + (sisa.length ? pilih(rng, sisa) : nama[1].toLowerCase());
}

const SIFAT = [
  ["Berpendar lembut di tempat gelap.", "Glows softly in the dark."],
  ["Terasa sejuk seperti es serut.", "Feels cool like shaved ice."],
  ["Baunya mirip jahe hangat.", "Smells like warm ginger."],
  ["Bergetar pelan kalau ada yang bernyanyi di dekatnya.", "Hums quietly when someone sings nearby."],
  ["Berubah warna sedikit saat ditiup.", "Changes colour slightly when you blow on it."],
  ["Sangat ringan, hampir melayang.", "So light it almost floats."],
  ["Berkilau seperti taburan bintang kecil.", "Sparkles like tiny stars."],
  ["Meletup kecil-kecil seperti gelembung sabun.", "Pops softly like soap bubbles."],
  ["Hangat bila digenggam, padahal tidak ada api.", "Warm in the hand though there is no fire."],
  ["Bergerak pelan mengikuti cahaya.", "Slowly drifts toward light."],
];
const GUNA = [
  ["bahan cat lukisan yang berkilau", "a shiny painting pigment"],
  ["pelumas untuk robot mainan", "a lubricant for toy robots"],
  ["bahan lampu hias", "an ingredient for decorative lamps"],
  ["bahan layang-layang super ringan", "a material for ultra-light kites"],
  ["penyejuk ruangan kecil", "a cooler for small rooms"],
  ["tinta untuk menulis rahasia", "ink for secret writing"],
  ["pelapis kapal-kapalan agar tahan air", "a waterproof coat for toy boats"],
];

// ---------- sprite pixel 16x16 ----------
const LEBAR = 16, TINGGI = 16, GARIS = "#1b1b2f", KACA = "#e6eef5", KACA_BAYANG = "#b9c7d4";
const kosong = () => Array.from({ length: TINGGI }, () => Array(LEBAR).fill(null));
function palet(dasar, aksen) { return { dasar, gelap: gelapkan(dasar, 0.66), sgelap: gelapkan(dasar, 0.42), terang: terangkan(dasar, 0.45), aksen, garis: GARIS }; }

function spriteLabu(p, rng) {
  const g = kosong();
  const bentuk = { 1: [5, 10], 2: [6, 9], 3: [6, 9], 4: [6, 9], 5: [6, 9], 6: [5, 10], 7: [4, 11], 8: [4, 11], 9: [3, 12], 10: [3, 12], 11: [2, 13], 12: [2, 13], 13: [1, 14], 14: [1, 14] };
  const atas = 8 + Math.floor(rng() * 2);
  for (const [ys, [a, b]] of Object.entries(bentuk)) {
    const y = Number(ys);
    for (let x = a; x <= b; x++) {
      const tepi = x === a || x === b || y === 14, tutup = y === 1;
      if (tutup) { g[y][x] = x === a || x === b ? p.garis : "#a86b3c"; continue; }
      if (tepi) { g[y][x] = p.garis; continue; }
      if (y >= atas) g[y][x] = y === atas ? p.terang : y === 13 ? p.gelap : x === a + 1 ? p.terang : p.dasar;
      else g[y][x] = x === a + 1 ? "#ffffff" : y % 3 === 0 ? KACA_BAYANG : KACA;
    }
  }
  // gelembung dan percikan aksen
  for (let i = 0; i < 3; i++) { const y = atas + 1 + Math.floor(rng() * (13 - atas - 1)), [a, b] = bentuk[y]; const x = a + 2 + Math.floor(rng() * Math.max(1, b - a - 3)); if (g[y][x] && g[y][x] !== p.garis) g[y][x] = i === 0 ? p.aksen : p.terang; }
  for (let i = 0; i < 2; i++) { const y = 3 + Math.floor(rng() * (atas - 3)), [a, b] = bentuk[y]; const x = a + 1 + Math.floor(rng() * Math.max(1, b - a - 1)); if (x > a && x < b) g[y][x] = "#ffffff"; }
  return g;
}

function sprKristal(p, rng) {
  const g = kosong();
  const tabel = [
    [0, 0, 2, 4, 6, 7, 7, 6, 5, 4, 3, 2, 1, 1, 0, 0],
    [0, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 4, 3, 2, 1, 0],
    [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const hw = pilih(rng, tabel);
  for (let y = 0; y < TINGGI; y++) {
    const w = hw[y]; if (!w) continue;
    for (let x = 8 - w; x < 8 + w; x++) {
      const kiri = x < 8, tepi = x === 8 - w || x === 7 + w || (y > 0 && hw[y - 1] === 0) || (y < TINGGI - 1 && hw[y + 1] === 0);
      if (tepi) { g[y][x] = p.garis; continue; }
      const mid = Math.abs(x - 7.5) < 1.6;
      g[y][x] = y < 7 ? (mid ? p.dasar : kiri ? p.terang : p.gelap) : kiri ? p.dasar : p.sgelap;
    }
  }
  for (let i = 0; i < 2; i++) { const y = 3 + Math.floor(rng() * 4), w = hw[y]; if (w > 2) { const x = 8 - w + 1 + Math.floor(rng() * Math.max(1, w - 2)); if (g[y][x] && g[y][x] !== p.garis) g[y][x] = "#ffffff"; } }
  const ay = 8 + Math.floor(rng() * 3), ax = 8 - hw[ay] + 2; if (hw[ay] > 3) { g[ay][ax] = p.aksen; g[ay][ax + 1] = p.aksen; }
  return g;
}

function sprAwan(p, rng) {
  const m = kosong().map((r) => r.map(() => false)), bulat = [];
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) bulat.push({ x: 4.5 + rng() * 7, y: 6 + rng() * 5, r: 2.6 + rng() * 2.4 });
  for (let y = 0; y < TINGGI; y++) for (let x = 0; x < LEBAR; x++) for (const b of bulat) if ((x + 0.5 - b.x) ** 2 + (y + 0.5 - b.y) ** 2 <= b.r * b.r) m[y][x] = true;
  const g = kosong();
  const ys = []; for (let y = 0; y < TINGGI; y++) if (m[y].some(Boolean)) ys.push(y);
  const y0 = ys[0], y1 = ys[ys.length - 1];
  for (let y = 0; y < TINGGI; y++) for (let x = 0; x < LEBAR; x++) {
    if (!m[y][x]) continue;
    const tepi = !m[y - 1]?.[x] || !m[y + 1]?.[x] || !m[y][x - 1] || !m[y][x + 1];
    if (tepi) { g[y][x] = p.garis; continue; }
    const t = (y - y0) / Math.max(1, y1 - y0);
    g[y][x] = t < 0.3 ? p.terang : t < 0.7 ? p.dasar : p.gelap;
  }
  for (let i = 0; i < 4; i++) { const x = 2 + Math.floor(rng() * 12), y = 2 + Math.floor(rng() * 12); if (g[y][x] && g[y][x] !== p.garis) g[y][x] = i < 2 ? p.aksen : "#ffffff"; }
  return g;
}

function sprBongkah(p, rng) {
  const pts = Array.from({ length: 8 }, () => 4.6 + rng() * 2.6), cx = 7.5, cy = 8.3;
  const radius = (a) => { const t = ((a / (Math.PI * 2)) + 1) % 1 * 8, i = Math.floor(t), f = t - i; return pts[i % 8] * (1 - f) + pts[(i + 1) % 8] * f; };
  const m = kosong().map((r) => r.map(() => false));
  for (let y = 0; y < TINGGI; y++) for (let x = 0; x < LEBAR; x++) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (Math.hypot(dx, dy) <= radius(Math.atan2(dy, dx))) m[y][x] = true; }
  const g = kosong();
  for (let y = 0; y < TINGGI; y++) for (let x = 0; x < LEBAR; x++) {
    if (!m[y][x]) continue;
    if (!m[y - 1]?.[x] || !m[y + 1]?.[x] || !m[y][x - 1] || !m[y][x + 1]) { g[y][x] = p.garis; continue; }
    const l = -((x + 0.5 - cx) + (y + 0.5 - cy)) / 9;
    g[y][x] = l > 0.28 ? p.terang : l < -0.28 ? p.gelap : p.dasar;
  }
  for (let i = 0; i < 7; i++) { const x = 3 + Math.floor(rng() * 10), y = 3 + Math.floor(rng() * 10); if (g[y][x] && g[y][x] !== p.garis) g[y][x] = i < 4 ? p.aksen : p.terang; }
  return g;
}

/** Sprite 16x16: {lebar, tinggi, jenis, sel[y][x] = "#rrggbb"|null}. wujud menentukan bentuk. */
export function buatSprite({ kunci, warna, aksen, wujud }) {
  const rng = mulberry32(cyrb53("sprite:" + kunci));
  const p = palet(warna, aksen || terangkan(warna, 0.2));
  let jenis, sel;
  if (wujud === "cair") { jenis = "labu"; sel = spriteLabu(p, rng); }
  else if (wujud === "gas") { jenis = "awan"; sel = sprAwan(p, rng); }
  else if (rng() < 0.6) { jenis = "kristal"; sel = sprKristal(p, rng); }
  else { jenis = "bongkah"; sel = sprBongkah(p, rng); }
  return { lebar: LEBAR, tinggi: TINGGI, jenis, sel };
}

// ---------- racik ----------
const warnaKategori = (s) => KATEGORI[PER_SIMBOL.get(s).kategori].warna;
function dasarWarna(counts) {
  const urut = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { utama: warnaKategori(urut[0][0]), kedua: urut[1] ? warnaKategori(urut[1][0]) : null };
}

/**
 * Racik bahan -> hasil.
 * @param bahan [{simbol, jumlah}, ...] (tak terbatas jenisnya)
 * @returns null bila tidak ada bahan; selain itu objek hasil
 */
export function racik(bahan) {
  const counts = normalisasi(bahan);
  if (!counts.size) return null;
  const kunci = rumusTeks(counts), pecah = pecahRumus(counts);
  const dasar = {
    kunci, rumus: kunci, rumusUnicode: rumusUnicode(counts), pecah, jenisBahan: counts.size, jumlahAtom: jumlahAtom(counts),
    mr: massaMolekul(counts), proton: totalProton(counts), kelipatan: 1, bahaya: false,
  };

  // satu jenis unsur saja
  if (counts.size === 1) {
    const [sim, n] = [...counts.entries()][0], u = PER_SIMBOL.get(sim), bentuk = BENTUK_UNSUR[kunci];
    const wujud = bentuk ? bentuk.wujud : u.wujud === "tak-diketahui" ? "padat" : u.wujud;
    const warna = warnaKategori(sim);
    return {
      ...dasar, tipe: "unsur", nama: bentuk ? { id: bentuk.id, en: bentuk.en } : { ...u.nama }, wujud, warna, warnaNama: namaWarna(warna),
      deskripsi: { id: `Hanya satu jenis unsur (${u.nama.id}). Campurkan dengan unsur lain untuk membuat senyawa!`, en: `Only one kind of element (${u.nama.en}). Mix in another element to make a compound!` },
      kode: null, simbolFiksi: null, sprite: buatSprite({ kunci, warna, aksen: terangkan(warna, 0.3), wujud }),
    };
  }

  // senyawa nyata
  const nyata = cariSenyawa(counts);
  if (nyata) {
    const [, id, en, wujud, warna, kid, ken, bahaya] = nyata.baris;
    const { kedua } = dasarWarna(counts);
    // tampilkan rumus seperti penulisan umum (NaOH, H2SO4), bukan urutan Hill
    const urutan = [...new Set([...nyata.baris[0].matchAll(/[A-Z][a-z]?/g)].map((m) => m[0]))], pecahUmum = urutan.map((s) => [s, counts.get(s)]);
    return {
      ...dasar, pecah: pecahUmum, rumus: pecahUmum.map(([s, n]) => s + (n > 1 ? n : "")).join(""), rumusUnicode: unicodeDariPecah(pecahUmum), tipe: "nyata", nama: { id, en }, wujud, warna, warnaNama: namaWarna(warna), bahaya, kelipatan: nyata.kelipatan, rumusDasar: rumusTeks(parseRumus(nyata.baris[0])),
      deskripsi: { id: kid, en: ken }, kode: null, simbolFiksi: null,
      sprite: buatSprite({ kunci: rumusTeks(parseRumus(nyata.baris[0])), warna, aksen: kedua || terangkan(warna, 0.3), wujud }),
    };
  }

  // zat fiktif (deterministik dari rumus)
  const rng = mulberry32(cyrb53("fiksi:" + kunci)), { utama, kedua } = dasarWarna(counts);
  const [h, s] = hexHsl(utama);
  const warna = hslHex(h + (rng() * 50 - 25), Math.max(0.55, Math.min(0.85, s)), 0.5 + rng() * 0.12);
  const aksen = kedua || hslHex(h + 150, 0.7, 0.62);
  const r = rng(), wujud = r < 0.4 ? "padat" : r < 0.75 ? "cair" : "gas";
  const nama = namaFiksi(counts, rng), sifat = pilih(rng, SIFAT), guna = pilih(rng, GUNA);
  const wn = namaWarna(warna), kode = "ZX-" + String(1000 + (cyrb53(kunci) % 9000));
  const wujudTeks = { padat: ["padat", "solid"], cair: ["cair", "liquid"], gas: ["gas", "gas"] }[wujud];
  return {
    ...dasar, tipe: "fiksi", nama: { id: nama, en: nama }, wujud, warna, warnaNama: wn, kode, simbolFiksi: simbolFiksi(nama, rng),
    deskripsi: {
      id: `Zat khayalan berwujud ${wujudTeks[0]} berwarna ${wn.id}. ${sifat[0]} Cocok untuk ${guna[0]}.`,
      en: `An imaginary ${wujudTeks[1]} substance, ${wn.en} in colour. ${sifat[1]} Good for ${guna[1]}.`,
    },
    sprite: buatSprite({ kunci, warna, aksen, wujud }),
  };
}

/** Bahan acak untuk tombol "Acak": 2-4 jenis, tiap jenis 1-3 atom. */
export function bahanAcak(rng = Math.random) {
  const n = 2 + Math.floor(rng() * 3), dipakai = new Map();
  while (dipakai.size < n) { const u = UNSUR[Math.floor(rng() * 103)]; dipakai.set(u.simbol, 1 + Math.floor(rng() * 3)); }
  return [...dipakai.entries()].map(([simbol, jumlah]) => ({ simbol, jumlah }));
}

export { UNSUR, PER_SIMBOL, KATEGORI };
