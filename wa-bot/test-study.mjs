// Tes logika murni menu Study (supabase/functions/_shared/study-core.ts).
//   node test-study.mjs      (butuh Node 22.18+ yang bisa memuat .ts langsung)
import {
  allowedMaterialGrades,
  isMaterialGradeAllowed,
  validPin,
  validCount,
  hashPin,
  verifyPin,
  lockSecondsLeft,
  buildQuestionPrompt,
  parseQuestions,
  parseJsonLoose,
  shuffleOptions,
  isOrderDependent,
  buildExplainPrompt,
  parseExplanations,
  computePoints,
  cleanLine,
  MAX_QUESTIONS
} from "../supabase/functions/_shared/study-core.ts";

let fails = 0;
const check = (c, m) => {
  if (!c) {
    fails++;
    console.log("FAIL:", m);
  } else console.log("ok:", m);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- tingkat materi
check(eq(allowedMaterialGrades("TK"), ["TK", "SD", "SMP", "SMA", "S1", "S2", "S3", "Umum"]), "pemain TK: semua tingkat");
check(eq(allowedMaterialGrades("SMP"), ["SMP", "SMA", "S1", "S2", "S3", "Umum"]), "pemain SMP: tidak ada TK/SD");
check(eq(allowedMaterialGrades("S3"), ["S3", "Umum"]), "pemain S3: hanya S3 dan Umum");
check(eq(allowedMaterialGrades("Umum"), ["TK", "SD", "SMP", "SMA", "S1", "S2", "S3", "Umum"]), "pemain Umum: semua tingkat");
check(!isMaterialGradeAllowed("SMA", "SD") && isMaterialGradeAllowed("SMA", "SMA") && isMaterialGradeAllowed("SMA", "S2"), "tidak boleh memilih tingkat lebih rendah");
check(!isMaterialGradeAllowed("SD", "Kuliah"), "tingkat tak dikenal ditolak");

// ---------------------------------------------------------------- input
check(validPin("1234") && validPin("123456") && !validPin("123") && !validPin("1234567") && !validPin("12a4") && !validPin(1234) && !validPin(""), "aturan PIN 4-6 digit angka");
check(validCount(15) && validCount(1) && validCount(MAX_QUESTIONS) && !validCount(0) && !validCount(MAX_QUESTIONS + 1) && !validCount(2.5) && !validCount("5"), "aturan jumlah soal");
check(cleanLine("  a\n\nb\t c  ", 10) === "a b c" && cleanLine("x".repeat(50), 5) === "xxxxx" && cleanLine(null, 5) === "", "cleanLine merapikan dan memotong");

// ---------------------------------------------------------------- PIN
{
  const h = await hashPin("4821");
  check(h.salt.length === 32 && h.hash.length === 64 && h.hash !== "4821", "hashPin: salt 16 byte + hash 32 byte, bukan teks asli");
  check((await verifyPin("4821", h.salt, h.hash)) === true, "verifyPin: PIN benar lolos");
  check((await verifyPin("4822", h.salt, h.hash)) === false && (await verifyPin("abcd", h.salt, h.hash)) === false && (await verifyPin("4821", "", h.hash)) === false, "verifyPin: PIN salah / tidak valid ditolak");
  const h2 = await hashPin("4821");
  check(h2.salt !== h.salt && h2.hash !== h.hash, "salt acak: PIN sama menghasilkan hash berbeda");
  const now = Date.parse("2026-10-11T10:00:00Z");
  check(lockSecondsLeft(null, now) === 0 && lockSecondsLeft("2026-10-11T09:59:00Z", now) === 0 && lockSecondsLeft("2026-10-11T10:02:30Z", now) === 150, "sisa detik penguncian PIN");
}

// ---------------------------------------------------------------- prompt soal
{
  const p = buildQuestionPrompt({ subject: "Matematika", topic: "Pecahan", grade: "SD", level: "hard", count: 10, avoid: ["Berapa 1+1?"] });
  check(p.user.includes("10 soal") && p.user.includes("Matematika") && p.user.includes("Pecahan") && p.user.includes("SD") && p.user.includes("SULIT"), "prompt memuat jumlah, pelajaran, topik, tingkat, level");
  check(p.user.includes("Berapa 1+1?") && p.system.includes("TEPAT SATU") && p.system.includes("LaTeX"), "prompt memuat soal yang dihindari dan aturan kunci tunggal / tanpa LaTeX");
  check(buildQuestionPrompt({ subject: "Bahasa Inggris", grade: "SMP", level: "easy", count: 5 }).system.includes("dalam bahasa Inggris"), "pelajaran Bahasa Inggris -> soal berbahasa Inggris");
  check(!buildQuestionPrompt({ subject: "IPA", grade: "SMP", level: "easy", count: 5 }).user.includes("Soal yang SUDAH ADA"), "tanpa daftar hindari bila kosong");
}

// ---------------------------------------------------------------- parser soal
const rngFixed = () => 0; // pengacakan deterministik
const sample = {
  questions: [
    { question: "Berapa hasil 2 + 3?", options: ["A. 4", "B) 5", "(C) 6", "D: 7"], answer: "B" },
    { question: "Ibukota Indonesia adalah?", options: ["Bandung", "Jakarta", "Surabaya", "Medan"], answer: 1 },
    { question: "Planet terdekat dengan Matahari?", options: ["Venus", "Bumi", "Merkurius", "Mars"], answer: "c" }
  ]
};
{
  const r = parseQuestions(JSON.stringify(sample), { shuffle: false });
  check(r.length === 3, "tiga soal sah terbaca");
  check(eq(r[0].options, ["4", "5", "6", "7"]) && r[0].correctIndex === 1, "awalan huruf A./B)/(C)/D: dibuang dan kunci terbaca");
  check(r[1].correctIndex === 1 && r[2].correctIndex === 2, "kunci berupa angka dan huruf kecil terbaca");
  const fenced = "Berikut hasilnya:\n```json\n" + JSON.stringify(sample) + "\n```\nSemoga membantu.";
  check(parseQuestions(fenced, { shuffle: false }).length === 3, "toleran terhadap code fence dan teks pembuka");
  check(parseQuestions(JSON.stringify(sample.questions), { shuffle: false }).length === 3, "toleran bila keluarannya langsung array");
  check(parseQuestions("bukan json sama sekali").length === 0 && parseQuestions("").length === 0 && parseJsonLoose("{rusak") === null, "keluaran rusak -> kosong, tidak melempar error");
}
{
  const bad = {
    questions: [
      { question: "Opsi kurang?", options: ["a", "b", "c"], answer: "A" },
      { question: "Opsi kembar?", options: ["sama", "Sama", "x", "y"], answer: "A" },
      { question: "Opsi kosong?", options: ["a", "", "c", "d"], answer: "A" },
      { question: "Kunci aneh?", options: ["a", "b", "c", "d"], answer: "Z" },
      { question: "Kunci hilang?", options: ["a", "b", "c", "d"] },
      { question: "x", options: ["a", "b", "c", "d"], answer: "A" },
      { question: "Soal sah satu-satunya?", options: ["a", "b", "c", "d"], answer: "D" }
    ]
  };
  const r = parseQuestions(JSON.stringify(bad), { shuffle: false });
  check(r.length === 1 && r[0].question.startsWith("Soal sah") && r[0].correctIndex === 3, "soal tidak sah (opsi kurang/kembar/kosong, kunci salah/hilang, terlalu pendek) dibuang");
}
{
  const dup = { questions: [sample.questions[0], { ...sample.questions[0], question: "BERAPA hasil 2 + 3 ???" }, sample.questions[1]] };
  check(parseQuestions(JSON.stringify(dup), { shuffle: false }).length === 2, "soal kembar dalam satu keluaran dibuang");
  check(parseQuestions(JSON.stringify(sample), { shuffle: false, existing: ["Berapa hasil 2 + 3?"] }).length === 2, "soal yang sudah ada sebelumnya tidak diulang");
  check(parseQuestions(JSON.stringify(sample), { shuffle: false, max: 2 }).length === 2, "batas maksimum dihormati");
}

// ---------------------------------------------------------------- pengacakan pilihan
{
  const q = { question: "Q?", options: ["salah1", "BENAR", "salah2", "salah3"], correctIndex: 1 };
  let ok = true;
  const positions = new Set();
  for (let s = 0; s < 200; s++) {
    let x = s + 1;
    const rng = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const r = shuffleOptions(q, rng);
    if (r.options[r.correctIndex] !== "BENAR" || new Set(r.options).size !== 4) ok = false;
    positions.add(r.correctIndex);
  }
  check(ok, "setelah diacak, kunci tetap menunjuk teks yang benar (200 percobaan)");
  check(positions.size === 4, "posisi jawaban benar menyebar ke A-D");
  const fixed = shuffleOptions(q, rngFixed);
  check(fixed.options[fixed.correctIndex] === "BENAR", "rng tetap tetap konsisten");
}
{
  const dep = { question: "Q?", options: ["Satu", "Dua", "Tiga", "Semua jawaban di atas benar"], correctIndex: 3 };
  check(isOrderDependent(dep.options) && eq(shuffleOptions(dep, () => 0.1).options, dep.options), "pilihan 'semua jawaban di atas' tidak diacak");
  check(isOrderDependent(["A dan B benar", "x", "y", "z"]) && isOrderDependent(["Tidak ada yang benar", "x", "y", "z"]) && isOrderDependent(["All of the above", "x", "y", "z"]), "pola lain yang bergantung urutan terdeteksi");
  check(!isOrderDependent(["Jakarta", "Bandung", "Medan", "Semarang"]), "pilihan biasa boleh diacak");
}

// ---------------------------------------------------------------- pembahasan
{
  const items = [
    { no: 1, question: "2+3?", options: ["4", "5", "6", "7"], correctIndex: 1, userAnswer: 0 },
    { no: 2, question: "Ibukota?", options: ["a", "b", "c", "d"], correctIndex: 2, userAnswer: null }
  ];
  const p = buildExplainPrompt("Matematika", "SD", items);
  check(p.user.includes("[1] 2+3?") && p.user.includes("Kunci: B | Jawaban pemain: A") && p.user.includes("Kunci: C | Jawaban pemain: -") && p.system.includes("keyAgrees"), "prompt pembahasan memuat kunci dan jawaban pemain");
  const txt = JSON.stringify({ items: [{ no: 1, explanation: "2+3=5, jadi B.", keyAgrees: true }, { no: 2, explanation: "Menurutku jawabannya d.", keyAgrees: false }, { no: 9, explanation: "nomor tak ada" }, { no: 1, explanation: "duplikat" }, { no: 2, explanation: "" }] });
  const r = parseExplanations(txt, [1, 2]);
  check(r.length === 2 && r[0].no === 1 && !r[0].doubtful && r[1].no === 2 && r[1].doubtful, "pembahasan: nomor tak valid/duplikat/kosong dibuang, keyAgrees:false -> meragukan");
  check(parseExplanations("rusak", [1]).length === 0, "pembahasan rusak -> kosong");
}

// ---------------------------------------------------------------- poin (cermin fungsi SQL)
check(computePoints(100, 15, 15, 80) === 80 && computePoints(100, 15, 15, 100) === 100 && computePoints(100, 15, 15, 120) === 120, "contoh pengguna: 15/15 easy 80, normal 100, hard 120");
check(computePoints(100, 10, 15, 100) === 67 && computePoints(100, 0, 10, 120) === 0 && computePoints(100, 5, 0, 100) === 0, "poin sebagian, nol, dan jumlah soal nol");

if (fails) {
  console.log(`\n${fails} GAGAL`);
  process.exit(1);
}
console.log("\nsemua ok");
