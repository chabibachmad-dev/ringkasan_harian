// Tes fungsi murni tampilan Class: src/study-class.js
//   node test-study-class-ui.mjs
import { guessLang, checkPdfFile, clampIdx, hashText, teacherSvg, TEACHER_PARTS, CLASS_MAX_PDF_BYTES } from "../src/study-class.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const eq = (a, b, m) => { const c = JSON.stringify(a) === JSON.stringify(b); if (!c) console.log("   dapat:", JSON.stringify(a), "\n   harap:", JSON.stringify(b)); check(c, m); };

eq(guessLang("Apa yang dimaksud dengan fotosintesis dan untuk apa"), "id", "tebak bahasa: Indonesia");
eq(guessLang("What is the main idea of this chapter and how can I use it"), "en", "tebak bahasa: Inggris");
eq(guessLang("???", "en"), "en", "tak jelas -> pakai cadangan en");
eq(guessLang("", "id"), "id", "kosong -> id");

eq(checkPdfFile(null), "empty", "tanpa berkas");
eq(checkPdfFile({ name: "a.docx", type: "application/msword", size: 100 }), "notpdf", "bukan PDF");
eq(checkPdfFile({ name: "a.PDF", type: "", size: 100 }), "", "PDF dikenali dari ekstensi");
eq(checkPdfFile({ name: "a.pdf", type: "application/pdf", size: 0 }), "empty", "berkas kosong");
eq(checkPdfFile({ name: "a.pdf", type: "application/pdf", size: CLASS_MAX_PDF_BYTES + 1 }), "toobig", "terlalu besar");
eq(checkPdfFile({ name: "a.pdf", type: "application/pdf", size: CLASS_MAX_PDF_BYTES }), "", "tepat batas diterima");

eq(clampIdx(5, 3), 2, "indeks dibatasi ke atas");
eq(clampIdx(-4, 3), 0, "indeks dibatasi ke bawah");
eq(clampIdx("1", 3), 1, "indeks dari string");
eq(clampIdx(0, 0), -1, "tanpa bagian");
eq(clampIdx("x", 3), 0, "bukan angka -> 0");

check(hashText("halo") === hashText("halo") && hashText("halo") !== hashText("halp"), "hash stabil dan membedakan teks");

const svg = teacherSvg();
for (const c of ["pt-eyes-open", "pt-eyes-closed", "pt-mouth-closed", "pt-mouth-open", "pixel-teacher"]) check(svg.includes(c), `SVG guru punya lapisan ${c}`);
check(svg.includes('shape-rendering="crispEdges"') && !/<script|onload|href/i.test(svg), "SVG tajam (piksel) dan aman");
const rows = TEACHER_PARTS.BASE;
check(rows.length === 16 && rows.every((r) => r.length === 16), "sprite dasar 16x16");
const inGrid = (arr) => arr.every(([x, y]) => x >= 0 && x < 16 && y >= 0 && y < 16);
check([TEACHER_PARTS.EYES_OPEN, TEACHER_PARTS.EYES_CLOSED, TEACHER_PARTS.MOUTH_CLOSED, TEACHER_PARTS.MOUTH_OPEN].every(inGrid), "semua piksel mata/mulut di dalam kisi");
check(TEACHER_PARTS.MOUTH_OPEN.length > TEACHER_PARTS.MOUTH_CLOSED.length, "mulut terbuka lebih besar dari tertutup");

console.log(fails ? `\n${fails} GAGAL` : "\nsemua lolos");
process.exit(fails ? 1 : 0);
