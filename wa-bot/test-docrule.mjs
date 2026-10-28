// Pengaman: aturan "dilarang menebak angka" harus menempel di setiap blok KONTEKS DOKUMEN yang dikirim ke model.
//   node test-docrule.mjs
import fs from "node:fs";
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const rule = /const DOC_NO_GUESS_RULE = "([^\n]*)";/.exec(src)?.[1] || "";
check(/tidak ditemukan di dokumen/.test(rule) && /jangan menebak/.test(rule) && /jangan menghitung sendiri/.test(rule), "aturan memuat 'tidak ditemukan di dokumen', 'jangan menebak', 'jangan menghitung sendiri'");
check(/ANGKA UANG/.test(rule) && /LENGKAP dengan satuan/.test(rule) && /SEMUA baris/.test(rule) && /satuan di tabel tidak terlihat di bagian yang terbaca/.test(rule) && /jangan menaruh \* sendirian/.test(rule), "aturan memuat ketentuan angka uang: satuan lengkap, konsisten, satuan tak terlihat -> katakan, tanpa * nyasar");
const fn = src.slice(src.indexOf("function buildGroundedUserMessage"), src.indexOf("const WA_OLLAMA_SYSTEM_PROMPT"));
check(fn.includes("${docBlock}\\n${DOC_NO_GUESS_RULE}"), "buildGroundedUserMessage menempelkan aturan setelah potongan dokumen");
check(!/KONTEKS DOKUMEN[^`]*`\);\s*\}\s*if \(webResults/.test(fn.replace(/DOC_NO_GUESS_RULE/g, "")) || fn.includes("DOC_NO_GUESS_RULE"), "tidak ada jalur blok dokumen tanpa aturan");
const uses = (src.match(/buildGroundedUserMessage\(/g) || []).length;
check(uses >= 4, `builder dipakai di jalur Ollama & Gemini (${uses - 1} pemakaian)`);
if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nTes aturan anti-tebak lulus.");
