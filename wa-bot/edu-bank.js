// ================================================================
// Bank materi channel edukasi SD (kelas 1-6): soal MATEMATIKA dibangkitkan & DIHITUNG oleh kode (bukan AI),
// materi SAINS diambil dari kartu fakta yang sudah disusun (data/edu-sains.json). AI tidak dipakai untuk menentukan
// angka/fakta -> tidak ada salah hitung atau karangan di video.
//
// Setiap materi = "rencana" (plan):
//   { id, kind: "math"|"sains", grade, topic, title, tags[],
//     intro: Beat[], parts: Beat[][] ([contoh], [latihan: soal+reveal]...), outro: Beat[], answer }
//   Beat = { say: "kalimat NARASI (angka ditulis dengan huruf)", board: [Line], clear?: bool, hold?: detik }
//   Line = { t: "teks di papan", c?: "white|yellow|cyan|pink|green", s?: "m|l|xl", mono?: bool, center?: bool }
// Semua fungsi murni & deterministik terhadap `seed` (dites di test-edu.mjs).
// ================================================================

// ---------------------------------------------------------------- acak berbenih
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p = 0.5) => next() < p
  };
}

// ---------------------------------------------------------------- bilangan -> kata (untuk NARASI)
const SATUAN = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
export function terbilang(n) {
  n = Math.trunc(Number(n));
  if (!Number.isFinite(n)) return "";
  if (n < 0) return `minus ${terbilang(-n)}`;
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  if (n < 100) return `${SATUAN[Math.floor(n / 10)]} puluh${n % 10 ? ` ${SATUAN[n % 10]}` : ""}`;
  if (n < 200) return `seratus${n % 100 ? ` ${terbilang(n % 100)}` : ""}`;
  if (n < 1000) return `${SATUAN[Math.floor(n / 100)]} ratus${n % 100 ? ` ${terbilang(n % 100)}` : ""}`;
  if (n < 2000) return `seribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ""}`;
  if (n < 1_000_000) return `${terbilang(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ""}`;
  if (n < 1_000_000_000) return `${terbilang(Math.floor(n / 1_000_000))} juta${n % 1_000_000 ? ` ${terbilang(n % 1_000_000)}` : ""}`;
  return String(n);
}
/** "tiga per empat" */
export const pecahanKata = (a, b) => `${terbilang(a)} per ${terbilang(b)}`;
/** 1250 -> "1.250" (tulisan di papan, gaya Indonesia) */
export const fmt = (n) => String(Math.trunc(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
export const lcm = (a, b) => (a / gcd(a, b)) * b;

const NAMES = ["Budi", "Siti", "Ani", "Rudi", "Dewi", "Andi", "Putri", "Joko", "Sari", "Dito", "Rina", "Bayu", "Wati", "Eko", "Nina", "Kadek", "Wayan", "Made", "Komang", "Putu"];
const THINGS = ["apel", "jeruk", "kelereng", "buku", "pensil", "permen", "mangga", "kue", "stiker", "balon", "salak", "pisang"];

/** Satu cerita ditulis sekali, jadi dua versi: angka (papan) dan kata (narasi). */
const dual = (fn) => ({ board: fn((n) => fmt(n)), say: fn((n) => terbilang(n)) });
const wrap = (text, width = 38) => {
  const words = String(text).split(/\s+/);
  const out = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
};
/** Baris yang tetap tampil (di puncak papan) saat papan penuh dan harus dibersihkan: soalnya. */
const pin = (lines) => lines.map((l) => ({ ...l, pin: true }));
const Q = (text, c = "white") => wrap(text).map((t) => ({ t, c }));
const L = (t, c = "white", s = "l", extra = {}) => ({ t, c, s, ...extra });

// ---------------------------------------------------------------- generator soal matematika
// Setiap generator: (rng) -> { topic, title, grades[], qBoard[], qSay, steps: Beat[], reveal: Beat[], answer }
//   steps  = penjelasan lengkap (contoh soal); reveal = kunci jawaban ringkas (soal latihan).

function addSmall(r) {
  const a = r.int(6, 9);
  const b = r.int(11 - a, 9);
  const need = 10 - a;
  const rest = b - need;
  const sum = a + b;
  const nm = r.pick(NAMES);
  let nm2 = r.pick(NAMES);
  if (nm2 === nm) nm2 = NAMES[(NAMES.indexOf(nm) + 1) % NAMES.length];
  const th = r.pick(THINGS);
  const q = dual((N) => `${nm} punya ${N(a)} ${th}. ${nm2} memberi ${N(b)} ${th} lagi. Berapa ${th} ${nm} sekarang?`);
  return {
    topic: "Penjumlahan sampai 20",
    title: "Penjumlahan sampai 20: Cara Mudah Melewati Sepuluh",
    grades: [1],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: `Kita ubah ceritanya jadi hitungan. ${terbilang(a)} ditambah ${terbilang(b)}.`, board: [L(`${a} + ${b} = ?`, "yellow", "xl", { center: true })] },
      { say: `Supaya mudah, kita genapkan dulu jadi sepuluh. ${terbilang(a)} butuh ${terbilang(need)} lagi untuk menjadi sepuluh. Kita ambil ${terbilang(need)} dari ${terbilang(b)}.`, board: [L(`${a} + ${need} = 10`, "cyan")] },
      { say: `Sisa dari ${terbilang(b)} setelah diambil ${terbilang(need)} adalah ${terbilang(rest)}.`, board: [L(`${b} − ${need} = ${rest}`, "cyan")] },
      { say: `Sekarang sepuluh ditambah ${terbilang(rest)} sama dengan ${terbilang(sum)}.`, board: [L(`10 + ${rest} = ${sum}`, "cyan")] },
      { say: `Jadi, ${nm} sekarang punya ${terbilang(sum)} ${th}.`, board: [L(`Jawaban: ${sum} ${th}`, "green", "xl", { center: true })] }
    ],
    reveal: [
      { say: `Kita genapkan jadi sepuluh. ${terbilang(a)} tambah ${terbilang(need)} sama dengan sepuluh, lalu ditambah sisanya ${terbilang(rest)}. Jawabannya ${terbilang(sum)} ${th}.`, board: [L(`${a} + ${b} = 10 + ${rest} = ${sum}`, "cyan"), L(`Jawaban: ${sum} ${th}`, "green", "xl", { center: true })] }
    ],
    answer: sum
  };
}

function subSmall(r) {
  const a = r.int(12, 18);
  const u = a - 10;
  const b = r.int(u + 1, 9);
  const need = b - u;
  const ans = a - b;
  const nm = r.pick(NAMES);
  const th = r.pick(THINGS);
  const q = dual((N) => `${nm} punya ${N(a)} ${th}. Sebanyak ${N(b)} ${th} dimakan. Berapa ${th} ${nm} yang tersisa?`);
  return {
    topic: "Pengurangan sampai 20",
    title: "Pengurangan sampai 20: Pakai Bilangan Sepuluh",
    grades: [1],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: `Kita ubah ceritanya jadi hitungan. ${terbilang(a)} dikurangi ${terbilang(b)}.`, board: [L(`${a} − ${b} = ?`, "yellow", "xl", { center: true })] },
      { say: `${terbilang(a)} sama dengan sepuluh ditambah ${terbilang(u)}. Kurangi dulu ${terbilang(u)}, sisanya sepuluh.`, board: [L(`${a} = 10 + ${u}`, "cyan"), L(`${a} − ${u} = 10`, "cyan")] },
      { say: `Masih harus dikurangi ${terbilang(need)} lagi, karena ${terbilang(b)} dikurangi ${terbilang(u)} adalah ${terbilang(need)}. Sepuluh dikurangi ${terbilang(need)} sama dengan ${terbilang(ans)}.`, board: [L(`${b} − ${u} = ${need}`, "cyan"), L(`10 − ${need} = ${ans}`, "cyan")] },
      { say: `Jadi, ${nm} masih punya ${terbilang(ans)} ${th}.`, board: [L(`Jawaban: ${ans} ${th}`, "green", "xl", { center: true })] }
    ],
    reveal: [
      { say: `${terbilang(a)} dikurangi ${terbilang(u)} sisa sepuluh, lalu dikurangi lagi ${terbilang(need)}. Jawabannya ${terbilang(ans)} ${th}.`, board: [L(`${a} − ${b} = 10 − ${need} = ${ans}`, "cyan"), L(`Jawaban: ${ans} ${th}`, "green", "xl", { center: true })] }
    ],
    answer: ans
  };
}

function addStack(r) {
  const ua = r.int(4, 9);
  const ub = r.int(10 - ua, 9);
  const ta = r.int(1, 6);
  const tb = r.int(1, 8 - ta);
  const a = ta * 10 + ua;
  const b = tb * 10 + ub;
  const su = ua + ub;
  const tt = ta + tb + 1;
  const ans = a + b;
  const nm = r.pick(NAMES);
  const th = r.pick(THINGS);
  const q = dual((N) => `${nm} mengumpulkan ${N(a)} ${th} di pagi hari dan ${N(b)} ${th} di sore hari. Berapa ${th} yang terkumpul?`);
  return {
    topic: "Penjumlahan bersusun dengan menyimpan",
    title: "Penjumlahan Bersusun dengan Menyimpan",
    grades: [2],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: `Kita tulis bersusun. Satuan di bawah satuan, puluhan di bawah puluhan. ${terbilang(a)} ditambah ${terbilang(b)}.`, board: [L(`  ${ta} ${ua}`, "white", "l", { mono: true, pin: true }), L(`+ ${tb} ${ub}`, "white", "l", { mono: true, pin: true }), L("-----", "white", "l", { mono: true, pin: true })] },
      { say: `Mulai dari satuan. ${terbilang(ua)} ditambah ${terbilang(ub)} sama dengan ${terbilang(su)}. Karena lebih dari sembilan, kita tulis ${terbilang(su % 10)} dan simpan satu puluhan.`, board: [L(`satuan: ${ua} + ${ub} = ${su}`, "cyan"), L(`tulis ${su % 10}, simpan 1`, "pink")] },
      { say: `Sekarang puluhan. ${terbilang(ta)} ditambah ${terbilang(tb)} ditambah satu yang disimpan, sama dengan ${terbilang(tt)}.`, board: [L(`puluhan: ${ta} + ${tb} + 1 = ${tt}`, "cyan")] },
      { say: `Gabungkan hasilnya: ${terbilang(tt)} puluhan dan ${terbilang(su % 10)} satuan, yaitu ${terbilang(ans)}.`, board: [L(`${a} + ${b} = ${ans}`, "yellow", "xl", { center: true }), L(`Jawaban: ${ans} ${th}`, "green", "xl", { center: true })] }
    ],
    reveal: [
      { say: `Satuan: ${terbilang(ua)} tambah ${terbilang(ub)} sama dengan ${terbilang(su)}, tulis ${terbilang(su % 10)} simpan satu. Puluhan: ${terbilang(ta)} tambah ${terbilang(tb)} tambah satu sama dengan ${terbilang(tt)}. Jawabannya ${terbilang(ans)}.`, board: [L(`${ua} + ${ub} = ${su} (tulis ${su % 10}, simpan 1)`, "cyan"), L(`${ta} + ${tb} + 1 = ${tt}`, "cyan"), L(`Jawaban: ${ans}`, "green", "xl", { center: true })] }
    ],
    answer: ans
  };
}

function subStack(r) {
  const ua = r.int(0, 7);
  const ub = r.int(ua + 1, 9);
  const ta = r.int(3, 9);
  const tb = r.int(1, ta - 1);
  const a = ta * 10 + ua;
  const b = tb * 10 + ub;
  const r1 = 10 + ua - ub;
  const r2 = ta - 1 - tb;
  const ans = a - b;
  const nm = r.pick(NAMES);
  const th = r.pick(THINGS);
  const q = dual((N) => `Di toko ada ${N(a)} ${th}. Terjual ${N(b)} ${th}. Berapa ${th} yang masih ada?`);
  return {
    topic: "Pengurangan bersusun dengan meminjam",
    title: "Pengurangan Bersusun dengan Meminjam",
    grades: [2, 3],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: `Kita tulis bersusun. ${terbilang(a)} dikurangi ${terbilang(b)}.`, board: [L(`  ${ta} ${ua}`, "white", "l", { mono: true, pin: true }), L(`− ${tb} ${ub}`, "white", "l", { mono: true, pin: true }), L("-----", "white", "l", { mono: true, pin: true })] },
      { say: `Mulai dari satuan. ${terbilang(ua)} tidak cukup dikurangi ${terbilang(ub)}. Jadi kita pinjam satu puluhan, sehingga ${terbilang(ua)} menjadi ${terbilang(10 + ua)}. Lalu ${terbilang(10 + ua)} dikurangi ${terbilang(ub)} sama dengan ${terbilang(r1)}.`, board: [L(`satuan: ${ua} < ${ub}, pinjam 10`, "pink"), L(`${10 + ua} − ${ub} = ${r1}`, "cyan")] },
      { say: `Puluhan tadi dipinjam satu, jadi ${terbilang(ta)} menjadi ${terbilang(ta - 1)}. Lalu ${terbilang(ta - 1)} dikurangi ${terbilang(tb)} sama dengan ${terbilang(r2)}.`, board: [L(`puluhan: ${ta} − 1 = ${ta - 1}`, "pink"), L(`${ta - 1} − ${tb} = ${r2}`, "cyan")] },
      { say: `Gabungkan: ${terbilang(r2)} puluhan dan ${terbilang(r1)} satuan, yaitu ${terbilang(ans)}.`, board: [L(`${a} − ${b} = ${ans}`, "yellow", "xl", { center: true }), L(`Jawaban: ${ans} ${th}`, "green", "xl", { center: true })] }
    ],
    reveal: [
      { say: `Satuan: pinjam sepuluh, ${terbilang(10 + ua)} kurang ${terbilang(ub)} sama dengan ${terbilang(r1)}. Puluhan: ${terbilang(ta - 1)} kurang ${terbilang(tb)} sama dengan ${terbilang(r2)}. Jawabannya ${terbilang(ans)}.`, board: [L(`${10 + ua} − ${ub} = ${r1}`, "cyan"), L(`${ta - 1} − ${tb} = ${r2}`, "cyan"), L(`Jawaban: ${ans}`, "green", "xl", { center: true })] }
    ],
    answer: ans
  };
}

function mulStory(r) {
  const n = r.int(3, 5);
  const k = r.int(2, 6);
  const total = n * k;
  const nm = r.pick(NAMES);
  const th = r.pick(THINGS);
  const wadah = r.pick(["kantong", "kotak", "piring", "keranjang"]);
  const q = dual((N) => `${nm} punya ${N(n)} ${wadah}. Setiap ${wadah} berisi ${N(k)} ${th}. Berapa ${th} semuanya?`);
  const rep = Array(n).fill(k).join(" + ");
  return {
    topic: "Perkalian sebagai penjumlahan berulang",
    title: "Perkalian itu Penjumlahan Berulang",
    grades: [2, 3],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: `Ada ${terbilang(n)} ${wadah}, dan setiap ${wadah} isinya sama, yaitu ${terbilang(k)}. Isi yang sama berulang bisa dijumlahkan.`, board: [L(`${rep} = ?`, "yellow", "l", { center: true })] },
      { say: `Kalau dijumlahkan satu per satu, hasilnya ${terbilang(total)}.`, board: [L(`${rep} = ${total}`, "cyan")] },
      { say: `Penjumlahan berulang ini bisa ditulis lebih singkat sebagai perkalian. ${terbilang(n)} kali ${terbilang(k)}.`, board: [L(`${n} × ${k} = ${total}`, "yellow", "xl", { center: true })] },
      { say: `Jadi, ${nm} punya ${terbilang(total)} ${th}.`, board: [L(`Jawaban: ${total} ${th}`, "green", "xl", { center: true })] }
    ],
    reveal: [
      { say: `${terbilang(n)} kali ${terbilang(k)} sama dengan ${terbilang(total)}. Jawabannya ${terbilang(total)} ${th}.`, board: [L(`${n} × ${k} = ${total}`, "cyan", "xl", { center: true }), L(`Jawaban: ${total} ${th}`, "green", "xl", { center: true })] }
    ],
    answer: total
  };
}

function divShare(r) {
  const d = r.int(2, 9);
  const qn = r.int(3, 12);
  const total = d * qn;
  const nm = r.pick(NAMES);
  const th = r.pick(THINGS);
  const q = dual((N) => `${nm} membagi ${N(total)} ${th} sama banyak kepada ${N(d)} temannya. Berapa ${th} yang diterima tiap teman?`);
  return {
    topic: "Pembagian sebagai pembagian rata",
    title: "Pembagian: Membagi Rata dengan Perkalian",
    grades: [3],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: `Membagi rata berarti pembagian. ${terbilang(total)} dibagi ${terbilang(d)}.`, board: [L(`${total} ÷ ${d} = ?`, "yellow", "xl", { center: true })] },
      { say: `Pembagian bisa dicari dengan perkalian. Kita cari bilangan yang kalau dikali ${terbilang(d)} hasilnya ${terbilang(total)}.`, board: [L(`${d} × ? = ${total}`, "cyan")] },
      { say: `Ternyata ${terbilang(d)} kali ${terbilang(qn)} sama dengan ${terbilang(total)}.`, board: [L(`${d} × ${qn} = ${total}`, "cyan")] },
      { say: `Jadi ${terbilang(total)} dibagi ${terbilang(d)} sama dengan ${terbilang(qn)}. Setiap teman mendapat ${terbilang(qn)} ${th}.`, board: [L(`${total} ÷ ${d} = ${qn}`, "yellow", "xl", { center: true }), L(`Jawaban: ${qn} ${th}`, "green", "xl", { center: true })] }
    ],
    reveal: [
      { say: `${terbilang(d)} kali ${terbilang(qn)} sama dengan ${terbilang(total)}, jadi ${terbilang(total)} dibagi ${terbilang(d)} sama dengan ${terbilang(qn)}.`, board: [L(`${d} × ${qn} = ${total}`, "cyan"), L(`Jawaban: ${qn} ${th}`, "green", "xl", { center: true })] }
    ],
    answer: qn
  };
}

function mulDigit(r) {
  const ta = r.int(1, 4);
  const ua = r.int(2, 9);
  const k = r.int(3, 9);
  const a = ta * 10 + ua;
  const p1 = ta * 10 * k;
  const p2 = ua * k;
  const ans = a * k;
  const nm = r.pick(NAMES);
  const th = r.pick(THINGS);
  const q = dual((N) => `Ada ${N(k)} kotak. Setiap kotak berisi ${N(a)} ${th}. Berapa ${th} semuanya?`);
  return {
    topic: "Perkalian bilangan dua angka",
    title: "Perkalian Dua Angka dengan Satu Angka",
    grades: [3, 4],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: `Kita hitung ${terbilang(a)} dikali ${terbilang(k)}.`, board: [L(`${a} × ${k} = ?`, "yellow", "xl", { center: true })] },
      { say: `Pecah ${terbilang(a)} menjadi ${terbilang(ta * 10)} dan ${terbilang(ua)}.`, board: [L(`${a} = ${ta * 10} + ${ua}`, "cyan")] },
      { say: `${terbilang(ta * 10)} dikali ${terbilang(k)} sama dengan ${terbilang(p1)}. Lalu ${terbilang(ua)} dikali ${terbilang(k)} sama dengan ${terbilang(p2)}.`, board: [L(`${ta * 10} × ${k} = ${p1}`, "cyan"), L(`${ua} × ${k} = ${p2}`, "cyan")] },
      { say: `Jumlahkan keduanya: ${terbilang(p1)} ditambah ${terbilang(p2)} sama dengan ${terbilang(ans)}.`, board: [L(`${p1} + ${p2} = ${ans}`, "yellow", "xl", { center: true }), L(`Jawaban: ${fmt(ans)} ${th}`, "green", "xl", { center: true })] }
    ],
    reveal: [
      { say: `${terbilang(ta * 10)} kali ${terbilang(k)} sama dengan ${terbilang(p1)}, ${terbilang(ua)} kali ${terbilang(k)} sama dengan ${terbilang(p2)}. Jumlahnya ${terbilang(ans)}.`, board: [L(`${p1} + ${p2} = ${ans}`, "cyan", "xl", { center: true }), L(`Jawaban: ${fmt(ans)} ${th}`, "green", "xl", { center: true })] }
    ],
    answer: ans
  };
}

function rectGeom(r) {
  const p = r.int(8, 20);
  const l = r.int(4, p - 2);
  const keliling = r.chance(0.5);
  const nm = r.pick(NAMES);
  const bentuk = r.pick(["kebun", "lapangan", "kolam", "papan tulis"]);
  const ans = keliling ? 2 * (p + l) : p * l;
  const q = dual((N) => (keliling ? `Sebuah ${bentuk} berbentuk persegi panjang dengan panjang ${N(p)} meter dan lebar ${N(l)} meter. Berapa keliling ${bentuk} itu?` : `Sebuah ${bentuk} berbentuk persegi panjang dengan panjang ${N(p)} meter dan lebar ${N(l)} meter. Berapa luas ${bentuk} itu?`));
  if (keliling) {
    return {
      topic: "Keliling persegi panjang",
      title: "Keliling Persegi Panjang: Rumus dan Contoh",
      grades: [3, 4],
      qBoard: Q(q.board),
      qSay: q.say,
      steps: [
        { say: "Keliling adalah jumlah panjang semua sisi yang mengelilingi bangun. Rumus keliling persegi panjang adalah dua kali, panjang ditambah lebar.", board: [L("K = 2 × (p + l)", "yellow", "xl", { center: true })] },
        { say: `Panjangnya ${terbilang(p)} meter dan lebarnya ${terbilang(l)} meter. Jumlahkan dulu: ${terbilang(p)} ditambah ${terbilang(l)} sama dengan ${terbilang(p + l)}.`, board: [L(`p + l = ${p} + ${l} = ${p + l}`, "cyan")] },
        { say: `Lalu dikali dua. Dua kali ${terbilang(p + l)} sama dengan ${terbilang(ans)}.`, board: [L(`K = 2 × ${p + l} = ${ans}`, "cyan")] },
        { say: `Jadi, keliling ${bentuk} itu ${terbilang(ans)} meter.`, board: [L(`Jawaban: ${ans} meter`, "green", "xl", { center: true })] }
      ],
      reveal: [{ say: `Dua kali, ${terbilang(p)} tambah ${terbilang(l)}, sama dengan dua kali ${terbilang(p + l)}, yaitu ${terbilang(ans)} meter.`, board: [L(`K = 2 × (${p} + ${l}) = ${ans}`, "cyan"), L(`Jawaban: ${ans} meter`, "green", "xl", { center: true })] }],
      answer: ans
    };
  }
  return {
    topic: "Luas persegi panjang",
    title: "Luas Persegi Panjang: Rumus dan Contoh",
    grades: [3, 4],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: "Luas adalah banyaknya petak satuan yang menutupi bangun. Rumus luas persegi panjang adalah panjang dikali lebar.", board: [L("L = p × l", "yellow", "xl", { center: true })] },
      { say: `Panjangnya ${terbilang(p)} meter dan lebarnya ${terbilang(l)} meter.`, board: [L(`p = ${p} m, l = ${l} m`, "cyan")] },
      { say: `${terbilang(p)} dikali ${terbilang(l)} sama dengan ${terbilang(ans)}.`, board: [L(`L = ${p} × ${l} = ${ans}`, "cyan")] },
      { say: `Jadi, luas ${bentuk} itu ${terbilang(ans)} meter persegi.`, board: [L(`Jawaban: ${ans} m²`, "green", "xl", { center: true })] }
    ],
    reveal: [{ say: `${terbilang(p)} kali ${terbilang(l)} sama dengan ${terbilang(ans)} meter persegi.`, board: [L(`L = ${p} × ${l} = ${ans}`, "cyan"), L(`Jawaban: ${ans} m²`, "green", "xl", { center: true })] }],
    answer: ans
  };
}

function mixedOps(r) {
  const a = r.int(10, 40);
  const b = r.int(2, 9);
  const c = r.int(2, 9);
  const bc = b * c;
  if (r.chance(0.5)) {
    const d = r.int(1, Math.min(30, a + bc - 1));
    const s1 = a + bc;
    const ans = s1 - d;
    return {
      topic: "Operasi hitung campuran",
      title: "Operasi Hitung Campuran: Kali Dulu, Baru Tambah Kurang",
      grades: [4],
      qBoard: [L(`${a} + ${b} × ${c} − ${d} = ?`, "yellow", "xl", { center: true })],
      qSay: `Hitunglah ${terbilang(a)} ditambah ${terbilang(b)} dikali ${terbilang(c)} dikurangi ${terbilang(d)}.`,
      steps: [
        { say: "Dalam operasi hitung campuran, perkalian dan pembagian dikerjakan lebih dulu daripada penjumlahan dan pengurangan.", board: [L("× dan ÷ dulu, baru + dan −", "pink")] },
        { say: `${terbilang(b)} dikali ${terbilang(c)} sama dengan ${terbilang(bc)}.`, board: [L(`${b} × ${c} = ${bc}`, "cyan"), L(`${a} + ${bc} − ${d}`, "white")] },
        { say: `Sekarang dari kiri ke kanan. ${terbilang(a)} ditambah ${terbilang(bc)} sama dengan ${terbilang(s1)}.`, board: [L(`${a} + ${bc} = ${s1}`, "cyan")] },
        { say: `Terakhir, ${terbilang(s1)} dikurangi ${terbilang(d)} sama dengan ${terbilang(ans)}.`, board: [L(`${s1} − ${d} = ${ans}`, "cyan"), L(`Jawaban: ${ans}`, "green", "xl", { center: true })] }
      ],
      reveal: [{ say: `Kali dulu: ${terbilang(b)} kali ${terbilang(c)} sama dengan ${terbilang(bc)}. Lalu ${terbilang(a)} tambah ${terbilang(bc)} kurang ${terbilang(d)} sama dengan ${terbilang(ans)}.`, board: [L(`${b} × ${c} = ${bc}`, "cyan"), L(`${a} + ${bc} − ${d} = ${ans}`, "cyan"), L(`Jawaban: ${ans}`, "green", "xl", { center: true })] }],
      answer: ans
    };
  }
  const x = r.int(2, 12);
  const y = r.int(2, 12);
  const m = r.int(2, 9);
  const s = x + y;
  const ans = s * m;
  return {
    topic: "Operasi hitung campuran dengan kurung",
    title: "Operasi Hitung dengan Tanda Kurung",
    grades: [4],
    qBoard: [L(`(${x} + ${y}) × ${m} = ?`, "yellow", "xl", { center: true })],
    qSay: `Hitunglah, ${terbilang(x)} ditambah ${terbilang(y)}, dalam kurung, lalu dikali ${terbilang(m)}.`,
    steps: [
      { say: "Operasi di dalam tanda kurung dikerjakan lebih dulu.", board: [L("kurung dulu!", "pink")] },
      { say: `${terbilang(x)} ditambah ${terbilang(y)} sama dengan ${terbilang(s)}.`, board: [L(`${x} + ${y} = ${s}`, "cyan"), L(`${s} × ${m}`, "white")] },
      { say: `Lalu ${terbilang(s)} dikali ${terbilang(m)} sama dengan ${terbilang(ans)}.`, board: [L(`${s} × ${m} = ${ans}`, "cyan"), L(`Jawaban: ${ans}`, "green", "xl", { center: true })] }
    ],
    reveal: [{ say: `Kurung dulu: ${terbilang(x)} tambah ${terbilang(y)} sama dengan ${terbilang(s)}. Lalu ${terbilang(s)} kali ${terbilang(m)} sama dengan ${terbilang(ans)}.`, board: [L(`${x} + ${y} = ${s}; ${s} × ${m} = ${ans}`, "cyan"), L(`Jawaban: ${ans}`, "green", "xl", { center: true })] }],
    answer: ans
  };
}

const PRIMA = [2, 3, 5, 7, 11, 13];
export function faktorPrima(n) {
  const out = [];
  let x = n;
  for (const p of PRIMA) while (x % p === 0) { out.push(p); x /= p; }
  if (x > 1) out.push(x);
  return out;
}
function fpbKpk(r) {
  const pairs = [[12, 18], [8, 12], [12, 20], [18, 24], [15, 20], [16, 24], [10, 25], [20, 30], [24, 36], [14, 21], [9, 15], [18, 27], [16, 20], [12, 30]];
  const [a, b] = r.pick(pairs);
  const fa = faktorPrima(a);
  const fb = faktorPrima(b);
  const g = gcd(a, b);
  const k = lcm(a, b);
  const join = (f) => f.join(" × ");
  const spell = (f) => f.map(terbilang).join(" kali ");
  return {
    topic: "FPB dan KPK",
    title: "FPB dan KPK dengan Faktorisasi Prima",
    grades: [4, 5],
    qBoard: [L(`Tentukan FPB dan KPK dari ${a} dan ${b}`, "yellow", "l", { center: true })],
    qSay: `Tentukan F P B dan K P K dari ${terbilang(a)} dan ${terbilang(b)}.`,
    steps: [
      { say: `Pertama, kita uraikan kedua bilangan menjadi faktor prima. ${terbilang(a)} sama dengan ${spell(fa)}. ${terbilang(b)} sama dengan ${spell(fb)}.`, board: [L(`${a} = ${join(fa)}`, "cyan"), L(`${b} = ${join(fb)}`, "cyan")] },
      { say: `F P B adalah faktor prima yang sama pada kedua bilangan, diambil yang pangkatnya paling kecil. Hasilnya ${terbilang(g)}.`, board: [L(`FPB = ${g}`, "yellow", "xl", { center: true })] },
      { say: `K P K adalah semua faktor prima dari kedua bilangan, diambil yang pangkatnya paling besar. Hasilnya ${terbilang(k)}.`, board: [L(`KPK = ${k}`, "yellow", "xl", { center: true })] },
      { say: `Cek cepat: F P B kali K P K harus sama dengan ${terbilang(a)} kali ${terbilang(b)}, yaitu ${terbilang(a * b)}.`, board: [L(`${g} × ${k} = ${a * b} = ${a} × ${b}`, "pink"), L(`FPB = ${g}, KPK = ${k}`, "green", "xl", { center: true })] }
    ],
    reveal: [{ say: `F P B dari ${terbilang(a)} dan ${terbilang(b)} adalah ${terbilang(g)}, dan K P K nya adalah ${terbilang(k)}.`, board: [L(`${a} = ${join(fa)}; ${b} = ${join(fb)}`, "cyan"), L(`FPB = ${g}, KPK = ${k}`, "green", "xl", { center: true })] }],
    answer: `${g};${k}`
  };
}

function fracAdd(r) {
  const dens = [2, 3, 4, 5, 6];
  let b;
  let d;
  let a;
  let c;
  for (let i = 0; i < 100; i++) {
    b = r.pick(dens);
    d = r.pick(dens);
    a = r.int(1, b - 1);
    c = r.int(1, d - 1);
    if (b !== d && a / b + c / d < 2 && lcm(b, d) <= 12) break;
  }
  const m = lcm(b, d);
  const a2 = a * (m / b);
  const c2 = c * (m / d);
  const num = a2 + c2;
  const g = gcd(num, m);
  const sn = num / g;
  const sd = m / g;
  const whole = Math.floor(sn / sd);
  const rem = sn % sd;
  const fin = whole > 0 ? (rem ? `${whole} ${rem}/${sd}` : `${whole}`) : `${sn}/${sd}`;
  const finSay = whole > 0 ? (rem ? `${terbilang(whole)} ${pecahanKata(rem, sd)}` : terbilang(whole)) : pecahanKata(sn, sd);
  return {
    topic: "Penjumlahan pecahan berpenyebut beda",
    title: "Menjumlahkan Pecahan Berpenyebut Berbeda",
    grades: [5],
    qBoard: [L(`${a}/${b} + ${c}/${d} = ?`, "yellow", "xl", { center: true })],
    qSay: `Hitunglah ${pecahanKata(a, b)} ditambah ${pecahanKata(c, d)}.`,
    steps: [
      { say: `Pecahan hanya bisa dijumlahkan langsung kalau penyebutnya sama. Penyebutnya sekarang ${terbilang(b)} dan ${terbilang(d)}, jadi kita samakan dulu dengan K P K nya, yaitu ${terbilang(m)}.`, board: [L(`KPK(${b}, ${d}) = ${m}`, "cyan")] },
      { say: `${pecahanKata(a, b)} diubah menjadi ${pecahanKata(a2, m)}, dan ${pecahanKata(c, d)} diubah menjadi ${pecahanKata(c2, m)}.`, board: [L(`${a}/${b} = ${a2}/${m}`, "cyan"), L(`${c}/${d} = ${c2}/${m}`, "cyan")] },
      { say: `Sekarang penyebutnya sama, jadi pembilangnya dijumlahkan: ${terbilang(a2)} tambah ${terbilang(c2)} sama dengan ${terbilang(num)}.`, board: [L(`${a2}/${m} + ${c2}/${m} = ${num}/${m}`, "cyan")] },
      g > 1 || whole > 0
        ? { say: `Terakhir, sederhanakan hasilnya menjadi ${finSay}.`, board: [L(`${num}/${m} = ${fin}`, "yellow", "xl", { center: true }), L(`Jawaban: ${fin}`, "green", "xl", { center: true })] }
        : { say: `Pecahan ini sudah paling sederhana. Jawabannya ${finSay}.`, board: [L(`Jawaban: ${fin}`, "green", "xl", { center: true })] }
    ],
    reveal: [{ say: `Samakan penyebut jadi ${terbilang(m)}: ${pecahanKata(a2, m)} tambah ${pecahanKata(c2, m)} sama dengan ${pecahanKata(num, m)}, yaitu ${finSay}.`, board: [L(`${a2}/${m} + ${c2}/${m} = ${num}/${m}`, "cyan"), L(`Jawaban: ${fin}`, "green", "xl", { center: true })] }],
    answer: fin
  };
}

function speed(r) {
  const v = r.pick([40, 45, 50, 60, 72, 80]);
  const t = r.int(2, 5);
  const d = v * t;
  const cari = r.pick(["jarak", "kecepatan", "waktu"]);
  const kend = r.pick(["bus", "mobil", "kereta", "sepeda motor"]);
  if (cari === "jarak") {
    return {
      topic: "Jarak, kecepatan, dan waktu",
      title: "Mencari Jarak dari Kecepatan dan Waktu",
      grades: [5, 6],
      qBoard: Q(`Sebuah ${kend} melaju dengan kecepatan ${v} km per jam selama ${t} jam. Berapa jarak yang ditempuh?`),
      qSay: `Sebuah ${kend} melaju dengan kecepatan ${terbilang(v)} kilometer per jam selama ${terbilang(t)} jam. Berapa jarak yang ditempuh?`,
      steps: [
        { say: "Hubungan jarak, kecepatan, dan waktu: jarak sama dengan kecepatan dikali waktu.", board: [L("jarak = kecepatan × waktu", "yellow", "l", { center: true })] },
        { say: `Kecepatannya ${terbilang(v)} kilometer per jam, waktunya ${terbilang(t)} jam.`, board: [L(`v = ${v} km/jam, t = ${t} jam`, "cyan")] },
        { say: `${terbilang(v)} dikali ${terbilang(t)} sama dengan ${terbilang(d)}.`, board: [L(`s = ${v} × ${t} = ${d}`, "cyan")] },
        { say: `Jadi, jarak yang ditempuh adalah ${terbilang(d)} kilometer.`, board: [L(`Jawaban: ${d} km`, "green", "xl", { center: true })] }
      ],
      reveal: [{ say: `Jarak sama dengan ${terbilang(v)} kali ${terbilang(t)}, yaitu ${terbilang(d)} kilometer.`, board: [L(`s = ${v} × ${t} = ${d}`, "cyan"), L(`Jawaban: ${d} km`, "green", "xl", { center: true })] }],
      answer: d
    };
  }
  if (cari === "kecepatan") {
    return {
      topic: "Jarak, kecepatan, dan waktu",
      title: "Mencari Kecepatan dari Jarak dan Waktu",
      grades: [5, 6],
      qBoard: Q(`Sebuah ${kend} menempuh jarak ${d} km dalam ${t} jam. Berapa kecepatannya?`),
      qSay: `Sebuah ${kend} menempuh jarak ${terbilang(d)} kilometer dalam ${terbilang(t)} jam. Berapa kecepatannya?`,
      steps: [
        { say: "Kecepatan sama dengan jarak dibagi waktu.", board: [L("kecepatan = jarak ÷ waktu", "yellow", "l", { center: true })] },
        { say: `Jaraknya ${terbilang(d)} kilometer dan waktunya ${terbilang(t)} jam.`, board: [L(`s = ${d} km, t = ${t} jam`, "cyan")] },
        { say: `${terbilang(d)} dibagi ${terbilang(t)} sama dengan ${terbilang(v)}.`, board: [L(`v = ${d} ÷ ${t} = ${v}`, "cyan")] },
        { say: `Jadi, kecepatannya ${terbilang(v)} kilometer per jam.`, board: [L(`Jawaban: ${v} km/jam`, "green", "xl", { center: true })] }
      ],
      reveal: [{ say: `${terbilang(d)} dibagi ${terbilang(t)} sama dengan ${terbilang(v)} kilometer per jam.`, board: [L(`v = ${d} ÷ ${t} = ${v}`, "cyan"), L(`Jawaban: ${v} km/jam`, "green", "xl", { center: true })] }],
      answer: v
    };
  }
  return {
    topic: "Jarak, kecepatan, dan waktu",
    title: "Mencari Waktu dari Jarak dan Kecepatan",
    grades: [5, 6],
    qBoard: Q(`Sebuah ${kend} menempuh jarak ${d} km dengan kecepatan ${v} km per jam. Berapa lama perjalanannya?`),
    qSay: `Sebuah ${kend} menempuh jarak ${terbilang(d)} kilometer dengan kecepatan ${terbilang(v)} kilometer per jam. Berapa lama perjalanannya?`,
    steps: [
      { say: "Waktu sama dengan jarak dibagi kecepatan.", board: [L("waktu = jarak ÷ kecepatan", "yellow", "l", { center: true })] },
      { say: `Jaraknya ${terbilang(d)} kilometer dan kecepatannya ${terbilang(v)} kilometer per jam.`, board: [L(`s = ${d} km, v = ${v} km/jam`, "cyan")] },
      { say: `${terbilang(d)} dibagi ${terbilang(v)} sama dengan ${terbilang(t)}.`, board: [L(`t = ${d} ÷ ${v} = ${t}`, "cyan")] },
      { say: `Jadi, perjalanannya memakan waktu ${terbilang(t)} jam.`, board: [L(`Jawaban: ${t} jam`, "green", "xl", { center: true })] }
    ],
    reveal: [{ say: `${terbilang(d)} dibagi ${terbilang(v)} sama dengan ${terbilang(t)} jam.`, board: [L(`t = ${d} ÷ ${v} = ${t}`, "cyan"), L(`Jawaban: ${t} jam`, "green", "xl", { center: true })] }],
    answer: t
  };
}

function volume(r) {
  const p = r.int(3, 12);
  const l = r.int(3, 10);
  const t = r.int(2, 9);
  const alas = p * l;
  const v = alas * t;
  const q = dual((N) => `Sebuah bak berbentuk balok memiliki panjang ${N(p)} sentimeter, lebar ${N(l)} sentimeter, dan tinggi ${N(t)} sentimeter. Berapa volumenya?`);
  return {
    topic: "Volume balok",
    title: "Volume Balok: Rumus dan Contoh",
    grades: [5, 6],
    qBoard: Q(q.board),
    qSay: q.say,
    steps: [
      { say: "Volume balok sama dengan panjang dikali lebar dikali tinggi.", board: [L("V = p × l × t", "yellow", "xl", { center: true })] },
      { say: `Kita kalikan panjang dan lebar dulu, yaitu luas alasnya. ${terbilang(p)} kali ${terbilang(l)} sama dengan ${terbilang(alas)}.`, board: [L(`p × l = ${p} × ${l} = ${alas}`, "cyan")] },
      { say: `Lalu kalikan dengan tingginya. ${terbilang(alas)} kali ${terbilang(t)} sama dengan ${terbilang(v)}.`, board: [L(`V = ${alas} × ${t} = ${fmt(v)}`, "cyan")] },
      { say: `Jadi, volume balok itu ${terbilang(v)} sentimeter kubik.`, board: [L(`Jawaban: ${fmt(v)} cm³`, "green", "xl", { center: true })] }
    ],
    reveal: [{ say: `${terbilang(p)} kali ${terbilang(l)} kali ${terbilang(t)} sama dengan ${terbilang(v)} sentimeter kubik.`, board: [L(`V = ${p} × ${l} × ${t} = ${fmt(v)}`, "cyan"), L(`Jawaban: ${fmt(v)} cm³`, "green", "xl", { center: true })] }],
    answer: v
  };
}

function percent(r) {
  const p = r.pick([10, 20, 25, 30, 40, 50, 60, 75]);
  const step = 100 / gcd(p, 100);
  const base = step * r.int(Math.ceil(40 / step), Math.floor(400 / step));
  const prod = p * base;
  const ans = prod / 100;
  const nm = r.pick(NAMES);
  return {
    topic: "Persen",
    title: "Menghitung Persen dari Suatu Bilangan",
    grades: [6],
    qBoard: Q(`Dari ${base} siswa, ${p} persen ikut lomba. Berapa siswa yang ikut lomba?`),
    qSay: `Dari ${terbilang(base)} siswa, ${terbilang(p)} persen ikut lomba. Berapa siswa yang ikut lomba?`,
    steps: [
      { say: `Persen artinya per seratus. ${terbilang(p)} persen sama dengan ${terbilang(p)} per seratus.`, board: [L(`${p}% = ${p}/100`, "cyan")] },
      { say: `Kita cari ${terbilang(p)} per seratus dari ${terbilang(base)}, yaitu dengan mengalikan.`, board: [L(`${p}/100 × ${base}`, "cyan")] },
      { say: `${terbilang(p)} kali ${terbilang(base)} sama dengan ${terbilang(prod)}. Lalu dibagi seratus, hasilnya ${terbilang(ans)}.`, board: [L(`${p} × ${base} = ${fmt(prod)}`, "cyan"), L(`${fmt(prod)} ÷ 100 = ${ans}`, "cyan")] },
      { say: `Jadi, ada ${terbilang(ans)} siswa yang ikut lomba.`, board: [L(`Jawaban: ${ans} siswa`, "green", "xl", { center: true })] }
    ],
    reveal: [{ say: `${terbilang(p)} per seratus kali ${terbilang(base)} sama dengan ${terbilang(ans)} siswa.`, board: [L(`${p}/100 × ${base} = ${ans}`, "cyan"), L(`Jawaban: ${ans} siswa`, "green", "xl", { center: true })] }],
    answer: ans
  };
}

function average(r) {
  const n = 5;
  let vals = Array.from({ length: n }, () => r.int(60, 95));
  const sum0 = vals.reduce((x, y) => x + y, 0);
  vals[n - 1] += (5 - (sum0 % 5)) % 5;
  if (vals[n - 1] > 100) vals[n - 1] -= 5;
  const sum = vals.reduce((x, y) => x + y, 0);
  const ans = sum / n;
  return {
    topic: "Rata-rata",
    title: "Menghitung Rata-rata (Mean)",
    grades: [6],
    qBoard: Q(`Nilai ulangan lima siswa: ${vals.join(", ")}. Berapa rata-ratanya?`),
    qSay: `Nilai ulangan lima siswa adalah ${vals.map(terbilang).join(", ")}. Berapa rata-ratanya?`,
    steps: [
      { say: "Rata-rata sama dengan jumlah semua nilai dibagi banyaknya data.", board: [L("rata-rata = jumlah ÷ banyak data", "yellow", "l", { center: true })] },
      { say: `Jumlahkan semua nilai: ${vals.map(terbilang).join(" tambah ")}. Hasilnya ${terbilang(sum)}.`, board: [L(`${vals.join(" + ")} = ${sum}`, "cyan")] },
      { say: `Banyak datanya ada ${terbilang(n)}. Jadi ${terbilang(sum)} dibagi ${terbilang(n)} sama dengan ${terbilang(ans)}.`, board: [L(`${sum} ÷ ${n} = ${ans}`, "cyan")] },
      { say: `Jadi, rata-rata nilainya adalah ${terbilang(ans)}.`, board: [L(`Jawaban: ${ans}`, "green", "xl", { center: true })] }
    ],
    reveal: [{ say: `Jumlah semua nilai ${terbilang(sum)}, dibagi ${terbilang(n)}, sama dengan ${terbilang(ans)}.`, board: [L(`${sum} ÷ ${n} = ${ans}`, "cyan"), L(`Jawaban: ${ans}`, "green", "xl", { center: true })] }],
    answer: ans
  };
}

export const GENERATORS = {
  addSmall,
  subSmall,
  addStack,
  subStack,
  mulStory,
  divShare,
  mulDigit,
  rectGeom,
  mixedOps,
  fpbKpk,
  fracAdd,
  speed,
  volume,
  percent,
  average
};
export const GENERATOR_GRADES = {
  addSmall: [1],
  subSmall: [1],
  addStack: [2],
  subStack: [2, 3],
  mulStory: [2, 3],
  divShare: [3],
  mulDigit: [3, 4],
  rectGeom: [3, 4],
  mixedOps: [4],
  fpbKpk: [4, 5],
  fracAdd: [5],
  speed: [5, 6],
  volume: [5, 6],
  percent: [6],
  average: [6]
};

const hashTag = (s) => `#${String(s).replace(/[^\p{L}\p{N}]/gu, "")}`;

/** Satu video matematika: contoh (dijelaskan) + latihan (soal lain dari generator yang sama, jawaban di akhir). */
export function buildMathPlan({ gen, grade = null, seed = 1, practice = 1 } = {}) {
  const g = GENERATORS[gen];
  if (!g) throw new Error(`generator tidak dikenal: ${gen}`);
  const r = makeRng(seed);
  const ex = g(r);
  const gr = grade && ex.grades.includes(grade) ? grade : ex.grades[0];
  const prac = [];
  const seen = new Set([JSON.stringify(ex.qBoard)]);
  for (let i = 0; i < 12 && prac.length < practice; i++) {
    const p = g(makeRng(seed * 7919 + 101 + i * 31));
    const key = JSON.stringify(p.qBoard);
    if (seen.has(key)) continue;
    seen.add(key);
    prac.push(p);
  }
  const kelas = `Kelas ${gr} SD`;
  const parts = [
    // contoh
    [{ say: `Perhatikan soal berikut. ${ex.qSay}`, board: [L("Contoh Soal", "pink", "l", { center: true }), ...pin(ex.qBoard)], clear: true }, ...ex.steps],
    // latihan (soal -> jeda -> kunci)
    ...prac.map((p, i) => [
      { say: `Sekarang giliran kamu! ${practice > 1 ? `Latihan nomor ${terbilang(i + 1)}. ` : ""}${p.qSay} Jeda videonya dan coba kerjakan sendiri.`, board: [L(`Latihan${practice > 1 ? ` ${i + 1}` : ""}`, "pink", "l", { center: true }), ...pin(p.qBoard)], clear: true, hold: 7 },
      ...p.reveal.map((b, j) => ({ ...b, say: j === 0 ? `Yuk kita cek. ${b.say}` : b.say, clear: j === 0 && false }))
    ])
  ];
  return {
    id: `math-${gen}-${seed}`,
    kind: "math",
    gen,
    seed,
    grade: gr,
    topic: ex.topic,
    title: `${ex.title} | Matematika ${kelas}`,
    tags: ["matematika", "SD", `kelas${gr}`, ex.topic, "belajar", "pelajaran sekolah"],
    hashtags: ["#Matematika", `#Kelas${gr}SD`, hashTag(ex.topic.split(" ")[0]), "#BelajarDiRumah"],
    intro: [{ say: `Halo teman-teman! Selamat datang di video belajar matematika ${kelas}. Hari ini kita belajar ${ex.topic.toLowerCase()}.`, board: [L(kelas, "pink", "l", { center: true }), ...wrap(ex.topic, 26).map((t) => L(t, "yellow", "xl", { center: true }))], clear: true }],
    parts,
    outro: [{ say: "Nah, itu tadi pembahasan kita hari ini. Kalau video ini membantu, jangan lupa suka dan berlangganan, ya. Sampai jumpa di video berikutnya!", board: [L("Terima kasih sudah belajar!", "green", "xl", { center: true }), L("Sampai jumpa!", "yellow", "l", { center: true })], clear: true }],
    answer: ex.answer,
    practiceAnswers: prac.map((p) => p.answer),
    sections: ["Contoh soal", ...prac.map((_, i) => `Latihan${practice > 1 ? ` ${i + 1}` : ""}`)]
  };
}

// ---------------------------------------------------------------- sains & pengetahuan umum (kartu fakta)
/** kartu = { id, grade:[..], title, topic, intro, points:[{say, board:[teks...]}], quiz:{ q, say, a, aSay }, tags[] } */
export function buildSainsPlan(card) {
  if (!card || !card.id) throw new Error("kartu sains tidak valid");
  const gr = Array.isArray(card.grade) ? card.grade : [card.grade];
  const kelas = gr.length > 1 ? `Kelas ${gr[0]}-${gr[gr.length - 1]} SD` : `Kelas ${gr[0]} SD`;
  const parts = [
    card.points.map((p, i) => ({
      say: p.say,
      board: [...(i === 0 ? [L(card.topic, "pink", "l", { center: true })] : []), ...p.board.map((t, j) => L(t, j === 0 ? "yellow" : "cyan", "l"))],
      clear: i > 0 && !!p.clear
    })),
    [
      { say: `Sekarang tebak, ya! ${card.quiz.say || card.quiz.q} Jeda videonya dan pikirkan jawabannya.`, board: [L("Kuis Singkat", "pink", "l", { center: true }), ...pin(wrap(card.quiz.q, 34).map((t) => L(t, "white", "l")))], clear: true, hold: 6 },
      { say: `Jawabannya: ${card.quiz.aSay || card.quiz.a}.`, board: wrap(`Jawaban: ${card.quiz.a}`, 30).map((t) => L(t, "green", "xl", { center: true })) }
    ]
  ];
  return {
    id: `sains-${card.id}`,
    kind: "sains",
    cardId: card.id,
    grade: gr[0],
    topic: card.topic,
    title: `${card.title} | IPA ${kelas}`,
    tags: ["IPA", "sains", "SD", ...(card.tags || []), card.topic, "pengetahuan umum", "belajar"],
    hashtags: ["#IPA", "#SainsUntukAnak", "#BelajarDiRumah"],
    intro: [{ say: card.intro, board: [L(kelas, "pink", "l", { center: true }), ...wrap(card.title, 24).map((t) => L(t, "yellow", "xl", { center: true }))], clear: true }],
    parts,
    outro: [{ say: "Seru, kan? Kalau video ini membantu, jangan lupa suka dan berlangganan. Sampai jumpa di video berikutnya!", board: [L("Terima kasih sudah belajar!", "green", "xl", { center: true })], clear: true }],
    answer: card.quiz.a,
    practiceAnswers: [],
    sections: ["Penjelasan", "Kuis"]
  };
}

// ---------------------------------------------------------------- pemilihan materi berikutnya
/**
 * Pilih materi berikutnya. `history` = [{ key }] yang sudah dipakai (terbaru di belakang). Aturan:
 *  - jenis bergantian sesuai `mix` (mis. { math: 2, sains: 1 });
 *  - generator/kartu yang sama tidak diulang dalam `cooldown` video terakhir;
 *  - kelas diputar agar semua kelas 1-6 kebagian.
 */
export function pickNext({ history = [], cards = [], grades = [1, 2, 3, 4, 5, 6], mix = { math: 2, sains: 1 }, seed = Date.now(), kind = null, grade = null, cooldown = 6 } = {}) {
  const r = makeRng(seed);
  const cyc = [];
  for (const [k, n] of Object.entries(mix)) for (let i = 0; i < n; i++) cyc.push(k);
  const want = kind || cyc[history.length % Math.max(1, cyc.length)] || "math";
  const recent = new Set(history.slice(-cooldown).map((h) => h.key));
  const gradeCount = Object.fromEntries(grades.map((g) => [g, 0]));
  for (const h of history.slice(-30)) if (h.grade in gradeCount) gradeCount[h.grade] += 1;
  const sortedGrades = [...grades].sort((a, b) => gradeCount[a] - gradeCount[b] || r.next() - 0.5);
  const tryGrades = grade ? [grade] : sortedGrades;

  const wantKinds = want === "sains" && cards.length ? ["sains", "math"] : ["math", "sains"];
  for (const k of wantKinds) {
    if (k === "sains") {
      for (const g of tryGrades) {
        const pool = cards.filter((c) => (Array.isArray(c.grade) ? c.grade : [c.grade]).includes(g) && !recent.has(`sains:${c.id}`));
        if (pool.length) {
          const c = pool[Math.floor(r.next() * pool.length)];
          return { kind: "sains", key: `sains:${c.id}`, grade: g, plan: buildSainsPlan(c) };
        }
      }
      if (!grade && !kind) {
        const pool = cards.filter((c) => !recent.has(`sains:${c.id}`));
        if (pool.length) {
          const c = pool[Math.floor(r.next() * pool.length)];
          return { kind: "sains", key: `sains:${c.id}`, grade: Array.isArray(c.grade) ? c.grade[0] : c.grade, plan: buildSainsPlan(c) };
        }
      }
    } else {
      for (const g of tryGrades) {
        const gens = Object.keys(GENERATORS).filter((n) => GENERATOR_GRADES[n].includes(g) && !recent.has(`math:${n}`));
        const pool = gens.length ? gens : Object.keys(GENERATORS).filter((n) => GENERATOR_GRADES[n].includes(g));
        if (pool.length) {
          const gen = pool[Math.floor(r.next() * pool.length)];
          const s = Math.floor(r.next() * 1e9) + 1;
          return { kind: "math", key: `math:${gen}`, grade: g, plan: buildMathPlan({ gen, grade: g, seed: s, practice: 1 }) };
        }
      }
    }
  }
  throw new Error("tidak ada materi yang cocok dengan pilihan kelas/jenis");
}
