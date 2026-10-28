// Tes bank materi channel edukasi: jawaban matematika DIHITUNG ULANG secara terpisah dari teks soal di papan,
// narasi bebas angka (enak dibaca TTS), panjang baris papan, kartu sains, pemilihan materi.
//   node test-edu-bank.mjs
import fs from "node:fs";
import { terbilang, fmt, gcd, lcm, GENERATORS, GENERATOR_GRADES, buildMathPlan, buildSainsPlan, pickNext, makeRng, faktorPrima } from "./edu-bank.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const eq = (a, b, m) => check(a === b, `${m}${a === b ? "" : ` (dapat ${JSON.stringify(a)}, harap ${JSON.stringify(b)})`}`);

// ---- terbilang
eq(terbilang(0), "nol", "terbilang 0");
eq(terbilang(11), "sebelas", "11");
eq(terbilang(15), "lima belas", "15");
eq(terbilang(20), "dua puluh", "20");
eq(terbilang(101), "seratus satu", "101");
eq(terbilang(365), "tiga ratus enam puluh lima", "365");
eq(terbilang(1000), "seribu", "1000");
eq(terbilang(1250), "seribu dua ratus lima puluh", "1250");
eq(terbilang(2024), "dua ribu dua puluh empat", "2024");
eq(terbilang(12000), "dua belas ribu", "12000");
eq(fmt(1250), "1.250", "fmt 1250");
eq(fmt(72), "72", "fmt 72");
eq(JSON.stringify(faktorPrima(36)), "[2,2,3,3]", "faktor prima 36");

// ---- verifikator MANDIRI: hitung ulang dari teks soal di papan
const nums = (s) => [...String(s).matchAll(/\d[\d.]*/g)].map((m) => Number(m[0].replace(/\./g, "")));
const qText = (p) => p.qBoard.map((l) => l.t).join(" ");
const lastAnswerLine = (steps) => {
  const lines = steps.flatMap((b) => b.board.map((l) => l.t));
  return [...lines].reverse().find((t) => /^Jawaban:/.test(t)) || "";
};
function expected(gen, ex) {
  const t = qText(ex);
  const n = nums(t);
  switch (gen) {
    case "addSmall": case "addStack": return n[0] + n[1];
    case "subSmall": case "subStack": return n[0] - n[1];
    case "mulStory": return n[0] * n[1];
    case "divShare": return n[0] / n[1];
    case "mulDigit": return n[0] * n[1];
    case "rectGeom": return /keliling/.test(t) ? 2 * (n[0] + n[1]) : n[0] * n[1];
    case "mixedOps": {
      const e = t.replace(/×/g, "*").replace(/−/g, "-").replace(/\s*=\s*\?/, "");
      if (!/^[\d\s+\-*()]+$/.test(e)) throw new Error("ekspresi aneh: " + e);
      return Function(`"use strict";return (${e})`)();
    }
    case "fpbKpk": { const [a, b] = n; return `${gcd(a, b)};${lcm(a, b)}`; }
    case "fracAdd": {
      const [a, b, c, d] = n;
      const num = a * d + c * b; const den = b * d; const g = gcd(num, den);
      const sn = num / g, sd = den / g; const w = Math.floor(sn / sd), rem = sn % sd;
      return w > 0 ? (rem ? `${w} ${rem}/${sd}` : `${w}`) : `${sn}/${sd}`;
    }
    case "speed": {
      if (/Berapa jarak/.test(t)) return n[0] * n[1];
      if (/Berapa kecepatannya/.test(t)) return n[0] / n[1];
      return n[0] / n[1];
    }
    case "volume": return n[0] * n[1] * n[2];
    case "percent": return (n[1] * n[0]) / 100; // "Dari {base} siswa, {p} persen"
    case "average": { const v = n.slice(0, 5); return v.reduce((x, y) => x + y, 0) / 5; }
    default: throw new Error("generator tanpa verifikator: " + gen);
  }
}
const SEEDS = 400;
let allSay = []; let allBoard = []; let checked = 0; const bad = [];
for (const gen of Object.keys(GENERATORS)) {
  let okAns = 0, okLine = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const ex = GENERATORS[gen](makeRng(seed));
    const exp = expected(gen, ex);
    if (String(ex.answer) === String(exp) || ex.answer === exp) okAns++; else if (bad.length < 6) bad.push(`${gen}#${seed}: jawaban ${ex.answer} != ${exp} | ${qText(ex)}`);
    const line = lastAnswerLine(ex.steps).replace(/^Jawaban:\s*/, "");
    const lineNum = String(line).replace(/\./g, "").split(" ")[0];
    const answerStr = String(ex.answer).replace(/;/, "");
    // baris "Jawaban:" harus memuat jawaban yang sama
    const ansTxt = gen === "fpbKpk" ? true : (gen === "fracAdd" ? line === String(ex.answer) : Number(lineNum) === Number(String(ex.answer)));
    if (ansTxt || gen === "fpbKpk") okLine++; else if (bad.length < 6) bad.push(`${gen}#${seed}: baris jawaban '${line}' != ${ex.answer}`);
    if (gen === "fpbKpk") {
      const [g, k] = String(ex.answer).split(";").map(Number);
      const lines = ex.steps.flatMap((b) => b.board.map((l) => l.t)).join(" | ");
      if (!lines.includes(`FPB = ${g}, KPK = ${k}`)) bad.push(`fpbKpk#${seed}: papan tak memuat FPB/KPK benar`);
    }
    for (const b of [...ex.steps, ...ex.reveal]) { allSay.push([gen, seed, b.say]); for (const l of b.board) allBoard.push([gen, seed, l]); }
    allSay.push([gen, seed, ex.qSay]); for (const l of ex.qBoard) allBoard.push([gen, seed, l]);
    checked++;
  }
  check(okAns === SEEDS && okLine === SEEDS, `${gen}: ${SEEDS} soal — jawaban cocok dengan hitung-ulang mandiri (${okAns}/${SEEDS}) & baris 'Jawaban' sama (${okLine}/${SEEDS})`);
}
for (const b of bad) console.log("  !", b);

check(allSay.every(([, , s]) => !/\d/.test(s)), "narasi semua soal bebas angka (ditulis dengan huruf)");
if (!allSay.every(([, , s]) => !/\d/.test(s))) console.log(allSay.filter(([, , s]) => /\d/.test(s)).slice(0, 4));
const badLen = allBoard.filter(([, , l]) => l.t.length > (l.s === "xl" ? 34 : l.mono ? 20 : 44));
check(badLen.length === 0, `panjang baris papan wajar (kebanyakan ≤44, xl ≤34): ${badLen.length} pelanggar`);
if (badLen.length) console.log(badLen.slice(0, 5).map(([g, s, l]) => `${g}#${s} (${l.s}) '${l.t}'`));
check(Object.keys(GENERATORS).every((g) => GENERATOR_GRADES[g]?.length), "setiap generator punya kelas");
const gradesCovered = new Set(Object.values(GENERATOR_GRADES).flat());
check([1, 2, 3, 4, 5, 6].every((g) => gradesCovered.has(g)), "kelas 1-6 semua tercakup");

// ---- rencana matematika
{
  const wc = (s) => String(s).split(/\s+/).filter(Boolean).length;
  const plan = buildMathPlan({ gen: "addStack", seed: 5, practice: 1 });
  check(plan.parts.length === 2 && plan.intro.length === 1 && plan.outro.length === 1, "rencana: intro + contoh + latihan + penutup");
  check(plan.practiceAnswers.length === 1, "latihan punya kunci");
  check(JSON.stringify(plan.parts[0][0].board) !== JSON.stringify(plan.parts[1][0].board), "soal latihan berbeda dari contoh");
  let minW = 1e9, maxW = 0;
  for (const gen of Object.keys(GENERATORS)) for (let s = 1; s <= 60; s++) {
    const p = buildMathPlan({ gen, seed: s, practice: 1 });
    const words = [...p.intro, ...p.parts.flat(), ...p.outro].reduce((n, b) => n + wc(b.say), 0);
    const holds = p.parts.flat().reduce((n, b) => n + (b.hold || 0), 0);
    const est = words / 2.2 + holds + 3; // ±2,2 kata/detik narasi anak
    minW = Math.min(minW, est); maxW = Math.max(maxW, est);
  }
  console.log(`  (perkiraan durasi: ${minW.toFixed(0)}–${maxW.toFixed(0)} dtk)`);
  check(minW >= 35 && maxW <= 125, "perkiraan durasi tiap video matematika wajar (orkestrator mengukur durasi asli lalu menambah/mengurangi latihan)");
  const tips = new Set(); for (let s = 1; s <= 200; s++) tips.add(buildMathPlan({ gen: "mulStory", seed: s }).parts[0][0].say);
  check(tips.size > 60, `variasi cerita: ${tips.size} soal berbeda dari 200 benih`);
}

// ---- sains
const cards = JSON.parse(fs.readFileSync(new URL("./data/edu-sains.json", import.meta.url), "utf8"));
{
  check(cards.length >= 20, `kartu sains: ${cards.length}`);
  const ids = new Set(cards.map((c) => c.id));
  check(ids.size === cards.length, "id kartu unik");
  let bad = 0;
  for (const c of cards) {
    const p = buildSainsPlan(c);
    const says = [...p.intro, ...p.parts.flat(), ...p.outro].map((b) => b.say);
    if (says.some((s) => /\d/.test(s))) { bad++; console.log("  digit di narasi:", c.id, says.find((s) => /\d/.test(s))); }
    const lines = [...p.intro, ...p.parts.flat(), ...p.outro].flatMap((b) => b.board);
    const long = lines.filter((l) => l.t.length > (l.s === "xl" ? 34 : 44));
    if (long.length) { bad++; console.log("  baris panjang:", c.id, long.map((l) => `'${l.t}'(${l.t.length})`).join(", ")); }
    const words = says.reduce((n, s) => n + s.split(/\s+/).length, 0);
    const est = words / 2.2 + 6 + 3;
    if (est < 45 || est > 125) { bad++; console.log("  durasi:", c.id, est.toFixed(0)); }
    if (!c.quiz?.q || !c.quiz?.a) { bad++; console.log("  kuis kosong:", c.id); }
    if (!c.grade?.length) { bad++; console.log("  tanpa kelas:", c.id); }
  }
  check(bad === 0, "semua kartu: narasi bebas angka, baris papan wajar, durasi wajar, kuis ada");
  check([1, 2, 3, 4, 5, 6].every((g) => cards.some((c) => c.grade.includes(g))), "kartu sains mencakup kelas 1-6");
}

// ---- pemilihan materi
{
  const hist = [];
  const kinds = []; const grades = new Set(); const dup = [];
  for (let i = 0; i < 60; i++) {
    const pk = pickNext({ history: hist, cards, seed: 1000 + i });
    kinds.push(pk.kind); grades.add(pk.grade);
    const recent = hist.slice(-6).map((h) => h.key);
    if (recent.includes(pk.key)) dup.push(pk.key);
    hist.push({ key: pk.key, grade: pk.grade });
  }
  check(dup.length === 0, "tidak ada materi yang sama dalam 6 video terakhir");
  check(grades.size === 6, "semua kelas 1-6 kebagian dalam 60 video");
  const m = kinds.filter((k) => k === "math").length, s = kinds.filter((k) => k === "sains").length;
  check(Math.abs(m - 2 * s) <= 3 && s > 10, `campuran jenis ≈ 2:1 (matematika ${m}, sains ${s})`);
  const g3 = pickNext({ history: [], cards, grade: 3, kind: "math", seed: 5 });
  check(g3.grade === 3 && g3.kind === "math", "pilihan kelas/jenis dihormati");
  const only = pickNext({ history: [], cards, kind: "sains", grade: 1, seed: 7 });
  check(only.kind === "sains" && only.plan.grade === 1, "kartu sains kelas 1");
  let threw = false; try { pickNext({ history: [], cards: [], kind: "sains", grade: 1, seed: 7 }); } catch { threw = true; }
  check(!threw, "tanpa kartu untuk kelas itu: jatuh ke matematika (tidak error)");
}
if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua tes bank materi edukasi lulus.");
