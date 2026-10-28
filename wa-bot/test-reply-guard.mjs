// Tes penjaga balasan (reply-guard.js).   node test-reply-guard.mjs
import { guardReply, stripControlTags, filterUrls, extractSearchRequest, allowedUrlsFromContext, normalizeUrl, isEmptyAfterGuard, NO_FABRICATION_RULES } from "./reply-guard.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// 1. kasus nyata dari grup
const leak = "[SEARCH] jumlah pegawai KPKNL Surakarta [/SEARCH]";
check(extractSearchRequest(leak) === "jumlah pegawai KPKNL Surakarta", "kueri [SEARCH] terbaca");
check(extractSearchRequest("[search]  a   b ") === "a b", "tanpa penutup & huruf kecil tetap terbaca");
check(extractSearchRequest("jawaban biasa") === null, "tanpa tag → null");
const g1 = guardReply(leak, { allowedUrls: [] });
check(g1.text === "" && g1.hadTags && isEmptyAfterGuard(g1), "balasan hanya tag → kosong (perlu panggil ulang model)");
check(stripControlTags("Halo [SEARCH] x [/SEARCH] dunia") === "Halo dunia", "tag di tengah kalimat dibuang");
check(stripControlTags("Jawab dulu [SEARCH] kueri tanpa penutup") === "Jawab dulu", "tag yatim dibuang");
check(stripControlTags("Ada [[TANYA_BOS]] nih") === "Ada [[TANYA_BOS]] nih", "[[TANYA_BOS]] dibiarkan bila doubleBracket mati");
check(stripControlTags("Ada [[TANYA_BOS]] nih", { doubleBracket: true }) === "Ada nih", "[[TANYA_BOS]] dibuang bila doubleBracket hidup");
check(stripControlTags("Pasal [1] ayat [2] dan [Lampiran A]") === "Pasal [1] ayat [2] dan [Lampiran A]", "kurung siku biasa tidak disentuh");

// 2. URL karangan
const fake = "Menurut data terbaru, jumlah pegawai sekitar 38 orang. Dapat diakses di sini: https://kpnkpknl.surakarta.go.id/uploads/2023/Profil-KPKNL-Surakarta-2023.pdf";
const g2 = guardReply(fake, { allowedUrls: [] });
check(!/https?:/.test(g2.text) && g2.removedUrls.length === 1, "URL karangan dibuang");
check(!/diakses di sini\s*:?\s*$/i.test(g2.text) && g2.text.startsWith("Menurut data terbaru"), "frasa pengantar link yatim ikut dirapikan");

check(g2.text === "Menurut data terbaru, jumlah pegawai sekitar 38 orang.", "kalimat tetap utuh dan diakhiri titik");
const ctx = "1. Profil -- cuplikan\n   Sumber: https://www.djkn.kemenkeu.go.id/kpknl-surakarta/\n2. Lain\n   Sumber: https://example.org/a/b.pdf";
const allowed = allowedUrlsFromContext(ctx);
check(allowed.length === 2, "URL dari baris Sumber: terkumpul");
const g3 = guardReply("Lihat https://www.djkn.kemenkeu.go.id/kpknl-surakarta, atau (https://example.org/a/b.pdf). Bukan https://palsu.go.id/x", { allowedUrls: allowed });
check(g3.text.includes("djkn.kemenkeu.go.id/kpknl-surakarta,") && g3.text.includes("example.org/a/b.pdf") && !g3.text.includes("palsu"), "URL sah dipertahankan (abaikan '/' akhir & tanda baca), palsu dibuang");
check(normalizeUrl("HTTPS://Example.ORG/a/#x") === "https://example.org/a", "normalizeUrl");
check(filterUrls("lihat https://a.id/x", undefined).text === "lihat https://a.id/x", "allowed=undefined → URL tidak disentuh");
check(guardReply("tanpa tautan apa pun", { allowedUrls: [] }).text === "tanpa tautan apa pun", "teks biasa tidak berubah");
check(/\[SEARCH\]/.test(NO_FABRICATION_RULES) && /Sumber:/.test(NO_FABRICATION_RULES), "aturan prompt memuat larangan tag & link");

console.log(fails ? `\n${fails} GAGAL` : "\nSemua tes penjaga balasan lolos.");
process.exit(fails ? 1 : 0);
