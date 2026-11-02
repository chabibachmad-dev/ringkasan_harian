// Tes penyaringan pemain untuk pemilih yang bisa dicari (src/study-search.js).  node test-study-search.mjs
import { filterPlayers, normalizeName } from "../src/study-search.js";

let gagal = 0;
const check = (c, n) => { console.log(`${c ? "ok" : "GAGAL"}: ${n}`); if (!c) gagal++; };
const P = [
  { id: "1", name: "Zahra" },
  { id: "2", name: "Ayyubi" },
  { id: "3", name: "Ananda Putri" },
  { id: "4", name: "Fátima" },
  { id: "5", name: "budi" }
];
const names = (q) => filterPlayers(P, q).map((p) => p.name).join(",");

check(names("") === "Ananda Putri,Ayyubi,budi,Fátima,Zahra", "kosong = semua, urut alfabet (tidak peka huruf besar-kecil)");
check(names("   ") === names(""), "hanya spasi = semua");
check(names("AYY") === "Ayyubi" && names("ayyubi") === "Ayyubi", "tidak peka huruf besar/kecil");
check(names("  ayy  ") === "Ayyubi", "spasi di awal/akhir diabaikan");
check(names("yub") === "Ayyubi", "cocok sebagian di tengah nama (substring)");
check(names("an") === "Ananda Putri", "substring di awal");
check(names("a") === "Ananda Putri,Ayyubi,Fátima,Zahra", "hasil banyak tetap urut alfabet");
check(names("ananda   putri") === "Ananda Putri", "spasi ganda di dalam dirapatkan");
check(names("fatima") === "Fátima" && names("FÁTIMA") === "Fátima", "aksen diabaikan");
check(names("tidak ada") === "", "tidak ada yang cocok = daftar kosong");
check(filterPlayers(null, "x").length === 0 && filterPlayers(undefined, "").length === 0, "daftar kosong/null aman");
const asli = P.map((p) => p.name).join(",");
filterPlayers(P, "a");
check(P.map((p) => p.name).join(",") === asli, "daftar asli tidak diubah urutannya");
check(normalizeName("  Éa  B ") === "ea b", "normalizeName: aksen, spasi, huruf kecil");
console.log(gagal ? `\n${gagal} GAGAL` : "\nsemua tes lolos");
process.exit(gagal ? 1 : 0);
