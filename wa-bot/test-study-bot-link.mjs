// Tes link wa.me untuk pendaftaran nomor WA orang tua (src/study-bot.js).  node test-study-bot-link.mjs
import { waLink, formatWaNumber, BOT_WA_NUMBER } from "../src/study-bot.js";

let gagal = 0;
const check = (c, n) => { console.log(`${c ? "ok" : "GAGAL"}: ${n}`); if (!c) gagal++; };

const a = waLink("6281234567890", "PIN-482731");
check(a === "https://wa.me/6281234567890?text=PIN-482731", "link memuat nomor benar dan kode");
check(waLink("+62 812-3456-7890", "PIN-482731") === a, "nomor dibersihkan: tanpa +, spasi, atau strip");
const b = waLink("6281234567890", "PIN-111222");
check(b !== a && b.endsWith("text=PIN-111222"), "kode berganti = link ikut berganti");
check(waLink("6281234567890", "PIN-1 2&3") === "https://wa.me/6281234567890?text=PIN-1%202%263", "kode di-URL-encode");
check(decodeURIComponent(new URL(a).searchParams.get("text")) === "PIN-482731", "pesan terisi kembali utuh saat dibaca");
check(waLink("", "PIN-482731") === null && waLink("6281234567890", "") === null, "tanpa nomor atau tanpa kode: tidak ada link");
check(!a.includes("+") && !/\s/.test(a), "tanpa + dan tanpa spasi");
check(formatWaNumber("6281234567890") === "+62 812-3456-7890", "nomor Indonesia dibaca mudah");
check(formatWaNumber("14155550123") === "+14155550123" && formatWaNumber("") === "", "nomor luar negeri dan kosong");
check(typeof BOT_WA_NUMBER === "string" && /^\d*$/.test(BOT_WA_NUMBER), "BOT_WA_NUMBER berupa angka saja (kosong bila belum diatur)");
console.log(gagal ? `\n${gagal} GAGAL` : "\nsemua tes lolos");
process.exit(gagal ? 1 : 0);
