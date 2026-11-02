// Tes penyaringan pemain untuk pemilih yang bisa dicari (src/study-search.js).  node test-study-search.mjs
import { filterPlayers, filterRanked, matchRange, matchesQuery, normalizeName } from "../src/study-search.js";

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
// ---- leaderboard: peringkat asli + garis bawah
const R = [{ name: "Ayyubi" }, { name: "Zahra" }, { name: "Ananda Putri" }, { name: "Fátima" }, { name: "budi" }];
let fr = filterRanked(R, "a");
check(fr.map((x) => x.rank).join() === "1,2,3,4" && fr.map((x) => x.p.name).join() === "Ayyubi,Zahra,Ananda Putri,Fátima", "filterRanked: peringkat asli & urutan peringkat dipertahankan");
fr = filterRanked(R, "  FATIMA ");
check(fr.length === 1 && fr[0].rank === 4, "filterRanked: peringkat 4 tetap 4 (bukan 1), tanpa aksen/huruf besar/spasi tepi");
check(filterRanked(R, "BUD")[0].rank === 5, "filterRanked: peringkat 5 tetap 5");
check(filterRanked(R, "xyz").length === 0, "filterRanked: tidak ketemu -> kosong");
check(filterRanked(R, "").length === 5, "filterRanked: kata kunci kosong -> semua");
check(JSON.stringify(R.map((x) => x.name)) === JSON.stringify(["Ayyubi", "Zahra", "Ananda Putri", "Fátima", "budi"]), "filterRanked: data asli tidak berubah");
check(matchesQuery("Ayyubi", "yub") && !matchesQuery("Ayyubi", "z"), "matchesQuery");
let rg = matchRange("Fátima Zahra", "TIMA");
check(rg && "Fátima Zahra".slice(rg[0], rg[1]) === "tima", "matchRange: aksen & huruf besar-kecil");
rg = matchRange("Ananda  Putri", "da pu");
check(rg && "Ananda  Putri".slice(rg[0], rg[1]).replace(/\s+/g, " ").toLowerCase() === "da pu", "matchRange: spasi ganda");
check(matchRange("Budi", "") === null && matchRange("Budi", "x") === null, "matchRange: kosong/tidak ketemu -> null");

console.log(gagal ? `\n${gagal} GAGAL` : "\nsemua tes lolos");
process.exit(gagal ? 1 : 0);
