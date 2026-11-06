// Aturan Mode Tantangan Laboratorium Kimia (murni, tanpa DOM):
// 1) pemain menulis rumus dari bahan di meja, 2) bahan yang tak bisa digabung diberi alasan,
// 3) hasil nyata membawa contoh pemakaian, 4) bintang dan "beruntun" untuk anak.
import { PER_SIMBOL, KATEGORI, SENYAWA, BENTUK_UNSUR } from "./data.js";
import { parseRumus, rumusTeks, racik } from "./core.js";

const LOGAM = new Set(["logam-alkali", "logam-alkali-tanah", "logam-transisi", "logam-pasca-transisi", "lantanida", "aktinida"]);
const DIATOMIK = new Set(["H", "N", "O", "F", "Cl", "Br", "I"]);
const nm = (sim, b) => { const u = PER_SIMBOL.get(sim); return (u.nama[b] || u.nama.id); };
const gabungNama = (daftar, b) => {
  const n = daftar.map((s) => `${nm(s, b)} (${s})`);
  if (n.length < 2) return n.join("");
  return n.slice(0, -1).join(", ") + (b === "en" ? " and " : " dan ") + n[n.length - 1];
};
const dua = (id, en) => ({ id, en });

// ---------- membaca rumus yang ditulis pemain ----------
export function bersihRumus(teks) { return String(teks ?? "").normalize("NFKC").replace(/\s+/g, ""); }

function gagal(kode, pesan) { return { ok: false, kode, pesan }; }

/** Tafsirkan rumus tulisan pemain. Pesan galat ramah anak, dua bahasa. */
export function bacaRumus(teks) {
  const t = bersihRumus(teks);
  if (!t) return gagal("kosong", dua("Tulis dulu rumus kimianya.", "Write the chemical formula first."));
  const aneh = t.match(/[^A-Za-z0-9()]/);
  if (aneh) return gagal("karakter", dua(`Tanda "${aneh[0]}" tidak dipakai dalam rumus. Pakai huruf lambang unsur, angka, dan tanda kurung.`, `The sign "${aneh[0]}" is not used in formulas. Use element letters, numbers and brackets.`));
  if (/^\d/.test(t)) return gagal("koefisien", dua("Jangan mulai dengan angka. Dalam rumus, angka kecil ditulis SETELAH lambang unsur (contoh: H2O).", "Do not start with a number. In a formula, the small number goes AFTER the element symbol (example: H2O)."));
  let dalam = 0;
  for (const c of t) { if (c === "(") dalam++; else if (c === ")") dalam--; if (dalam < 0) break; }
  if (dalam !== 0) return gagal("kurung", dua("Tanda kurung belum berpasangan.", "The brackets do not pair up."));
  if (/\(\)/.test(t)) return gagal("kurung-kosong", dua("Ada tanda kurung yang kosong.", "There is an empty bracket."));
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === "(") { i++; if (/\d/.test(t[i] || "")) return gagal("angka-salah", dua("Angka tidak boleh langsung setelah tanda kurung buka.", "A number cannot come right after an opening bracket.")); continue; }
    if (c === ")") { i++; while (/\d/.test(t[i] || "")) i++; continue; }
    if (/[a-z]/.test(c)) return gagal("huruf-kecil", dua("Lambang unsur dimulai dengan huruf KAPITAL; huruf kecil hanya untuk huruf kedua (contoh: Na, Cl, Ca).", "An element symbol starts with a CAPITAL letter; a small letter is only the second letter (example: Na, Cl, Ca)."));
    if (/[A-Z]/.test(c)) {
      let sim = c; i++;
      if (/[a-z]/.test(t[i] || "")) sim += t[i++];
      if (!PER_SIMBOL.has(sim)) return gagal("simbol", dua(`"${sim}" bukan lambang unsur. Periksa tabel periodik.`, `"${sim}" is not an element symbol. Check the periodic table.`));
      if (/[a-z]/.test(t[i] || "")) return gagal("huruf-kecil", dua("Lambang unsur paling banyak dua huruf: kapital lalu kecil.", "An element symbol has at most two letters: a capital then a small one."));
      let n = ""; while (/\d/.test(t[i] || "")) n += t[i++];
      if (n && Number(n) === 0) return gagal("nol", dua("Angka 0 tidak dipakai dalam rumus.", "The number 0 is not used in formulas."));
      continue;
    }
    return gagal("angka-salah", dua("Ada angka yang tidak menempel pada lambang unsur atau tanda kurung tutup.", "A number is not attached to an element symbol or a closing bracket."));
  }
  try { return { ok: true, counts: parseRumus(t), teks: t }; } catch { return gagal("rumus", dua("Rumus ini belum bisa dibaca.", "This formula could not be read.")); }
}

const sama = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/** Bandingkan rumus pemain dengan bahan di meja (Map simbol -> jumlah). */
export function periksaRumus(bahan, teks) {
  const r = bacaRumus(teks);
  if (!r.ok) return { status: "tulis", kode: r.kode, pesan: r.pesan, detail: [] };
  const a = r.counts;
  if (sama(a, bahan)) return { status: "cocok", counts: a, teks: r.teks, kelipatan: 1 };
  // rumus dasar benar tetapi bahan di meja kelipatannya (H4O2 = 2 x H2O)
  if (a.size === bahan.size) {
    const k = bahan.get([...a.keys()][0]) / [...a.values()][0];
    if (Number.isInteger(k) && k >= 2 && [...a].every(([s, n]) => bahan.get(s) === n * k)) return { status: "cocok", counts: a, teks: r.teks, kelipatan: k };
  }
  const detail = [];
  for (const [s, n] of bahan) {
    if (!a.has(s)) detail.push(dua(`${nm(s, "id")} (${s}) ada di meja tetapi belum ada di rumusmu.`, `${nm(s, "en")} (${s}) is on the bench but not in your formula yet.`));
    else if (a.get(s) !== n) detail.push(dua(`Jumlah ${s}: di meja ${n}, di rumusmu ${a.get(s)}.`, `Amount of ${s}: ${n} on the bench, ${a.get(s)} in your formula.`));
  }
  for (const s of a.keys()) if (!bahan.has(s)) detail.push(dua(`${nm(s, "id")} (${s}) ada di rumusmu tetapi tidak ada di meja.`, `${nm(s, "en")} (${s}) is in your formula but not on the bench.`));
  // salah kapital: "Co" (kobalt) padahal maksudnya CO (karbon + oksigen), atau sebaliknya
  let tip = dua("Ingat: angka 1 tidak ditulis; angka lain ditulis kecil setelah lambang unsur.", "Remember: the number 1 is not written; other numbers go small after the element symbol.");
  for (const m of r.teks.matchAll(/([A-Z])([a-z])/g)) {
    const sim = m[0], dua1 = m[1], dua2 = m[2].toUpperCase();
    if (!bahan.has(sim) && bahan.has(dua1) && bahan.has(dua2)) tip = dua(`Hati-hati: "${sim}" dengan huruf kedua kecil adalah ${nm(sim, "id")}. Untuk ${dua1} dan ${dua2} tulis keduanya kapital: ${dua1}${dua2}.`, `Careful: "${sim}" with a small second letter is ${nm(sim, "en")}. For ${dua1} and ${dua2} write both as capitals: ${dua1}${dua2}.`);
  }
  for (const m of r.teks.matchAll(/([A-Z])(?=[A-Z])([A-Z])/g)) {
    const gab = m[1] + m[2].toLowerCase();
    if (bahan.has(gab) && !bahan.has(m[1]) && PER_SIMBOL.has(gab)) tip = dua(`Hati-hati: ${nm(gab, "id")} ditulis "${gab}" (huruf kedua kecil), bukan "${m[1]}${m[2]}".`, `Careful: ${nm(gab, "en")} is written "${gab}" (small second letter), not "${m[1]}${m[2]}".`);
  }
  return { status: "tidak-cocok", pesan: dua("Rumusmu belum cocok dengan bahan di meja.", "Your formula does not match the ingredients on the bench yet."), detail: detail.slice(0, 3), tip };
}

// ---------- aturan: bisa digabung atau tidak ----------
const PADUAN = [
  { set: ["Cu", "Zn"], nama: dua("kuningan", "brass"), pakai: dua("Alat musik tiup, keran air, dan gagang pintu.", "Wind instruments, taps and door handles.") },
  { set: ["Cu", "Sn"], nama: dua("perunggu", "bronze"), pakai: dua("Patung, lonceng, dan alat gamelan.", "Statues, bells and gamelan instruments.") },
  { set: ["Pb", "Sn"], nama: dua("solder", "solder"), pakai: dua("Menyambung komponen pada papan elektronik.", "Joining components on electronic circuit boards.") },
  { set: ["C", "Fe"], nama: dua("baja", "steel"), pakai: dua("Rangka gedung, rel kereta api, dan pisau dapur.", "Building frames, railway tracks and kitchen knives.") },
  { set: ["Cr", "Fe", "Ni"], nama: dua("baja tahan karat", "stainless steel"), pakai: dua("Sendok, panci, dan wastafel.", "Spoons, pots and sinks.") },
  { set: ["Cr", "Fe"], nama: dua("baja krom", "chrome steel"), pakai: dua("Alat dan bantalan yang tahan karat.", "Rust-resistant tools and bearings.") },
  { set: ["Au", "Cu"], nama: dua("emas perhiasan (emas karat)", "jewellery gold (carat gold)"), pakai: dua("Cincin dan kalung emas 18 karat.", "18-carat gold rings and necklaces.") },
  { set: ["Ag", "Cu"], nama: dua("perak sterling", "sterling silver"), pakai: dua("Perhiasan dan peralatan makan perak.", "Silver jewellery and cutlery.") },
  { set: ["Ag", "Au"], nama: dua("elektrum", "electrum"), pakai: dua("Koin-koin kuno.", "Ancient coins.") },
  { set: ["Al", "Mg"], nama: dua("magnalium", "magnalium"), pakai: dua("Rangka sepeda dan bagian kendaraan yang ringan.", "Light bicycle frames and vehicle parts.") },
  { set: ["Al", "Cu"], nama: dua("duralumin", "duralumin"), pakai: dua("Rangka pesawat terbang.", "Aircraft frames.") },
  { set: ["Cu", "Ni"], nama: dua("kupronikel", "cupronickel"), pakai: dua("Koin logam.", "Metal coins.") },
  { set: ["Ni", "Ti"], nama: dua("nitinol", "nitinol"), pakai: dua("Kawat behel gigi dan bingkai kacamata yang kembali ke bentuk semula.", "Braces wires and glasses frames that spring back into shape.") },
];
const kunciHimpunan = (arr) => [...arr].sort().join("+");
const PADUAN_PER = new Map(PADUAN.map((p) => [kunciHimpunan(p.set), p]));

// berapa senyawa dikenal yang tersusun dari himpunan unsur tertentu
const HIMPUNAN_SENYAWA = new Map();
for (const r of SENYAWA) { const k = kunciHimpunan(parseRumus(r[0]).keys()); HIMPUNAN_SENYAWA.set(k, (HIMPUNAN_SENYAWA.get(k) || 0) + 1); }

/**
 * Putuskan apakah bahan bisa digabung.
 * @returns {bisa:true, hasil} | {bisa:false, kode, alasan:{id,en}, tip, contoh}
 */
export function aturanGabung(counts) {
  const sims = [...counts.keys()], hasil = racik([...counts].map(([simbol, jumlah]) => ({ simbol, jumlah })));
  if (!hasil) return { bisa: false, kode: "kosong", alasan: dua("Meja masih kosong.", "The bench is empty."), tip: null, contoh: null };
  const tak = (kode, alasan, tip = null, contoh = null) => ({ bisa: false, kode, alasan, tip, contoh });

  // satu jenis unsur: hanya bentuk molekul yang bernama (H2, O2, O3, ...) yang berarti
  if (sims.length === 1) {
    const [s, n] = [...counts][0];
    if (BENTUK_UNSUR[s + n]) return { bisa: true, hasil };
    const tipD = DIATOMIK.has(s) ? dua(`Gas ${nm(s, "id")} di alam berpasangan, jadi ditulis ${s}2.`, `${nm(s, "en")} gas comes in pairs in nature, so it is written ${s}2.`) : null;
    return tak("satu-unsur", dua(`Di meja hanya ada satu jenis unsur (${nm(s, "id")}), jadi belum ada yang digabung. Tambahkan unsur lain.`, `There is only one kind of element on the bench (${nm(s, "en")}), so nothing is combined yet. Add another element.`), tipD);
  }
  if (hasil.tipe === "nyata") return { bisa: true, hasil };

  // gas mulia
  const mulia = sims.filter((s) => PER_SIMBOL.get(s).kategori === "gas-mulia");
  if (mulia.length) return tak("gas-mulia",
    dua(`${gabungNama(mulia, "id")} termasuk gas mulia. Kulit elektron terluarnya sudah penuh sehingga atomnya stabil dan hampir tidak mau bergabung dengan unsur lain.`, `${gabungNama(mulia, "en")} ${mulia.length > 1 ? "are noble gases" : "is a noble gas"}. The outer electron shell is already full, so the atoms are stable and almost never combine with other elements.`),
    dua("Di laboratorium khusus, xenon dan kripton memang pernah dipaksa bereaksi, tetapi di permainan ini gas mulia dianggap tidak bereaksi.", "In special laboratories xenon and krypton have been forced to react, but in this game noble gases are treated as unreactive."));

  // radioaktif / superberat
  const radio = sims.filter((s) => { const u = PER_SIMBOL.get(s); return u.radioaktif || u.z >= 104; });
  if (radio.length) return tak("radioaktif",
    dua(`${gabungNama(radio, "id")} bersifat radioaktif atau terlalu tidak stabil. Atomnya cepat meluruh, berbahaya, dan hanya ditangani ahli di laboratorium nuklir.`, `${gabungNama(radio, "en")} ${radio.length > 1 ? "are" : "is"} radioactive or far too unstable. Its atoms decay quickly, are dangerous, and only experts in nuclear laboratories handle them.`),
    dua("Coba gabungkan unsur yang stabil dan aman, seperti hidrogen, karbon, oksigen, natrium, atau klor.", "Try stable, safe elements such as hydrogen, carbon, oxygen, sodium or chlorine."));

  // paduan (alloy)
  const pad = PADUAN_PER.get(kunciHimpunan(sims));
  if (pad) return tak("paduan",
    dua(`Ini bukan senyawa. ${gabungNama(sims, "id")} tidak bereaksi membentuk molekul baru; atom-atomnya hanya bercampur saat dilebur menjadi paduan (alloy) bernama ${pad.nama.id}.`, `This is not a compound. ${gabungNama(sims, "en")} do not react to make new molecules; their atoms just mix when melted together into an alloy called ${pad.nama.en}.`),
    dua("Senyawa terbentuk karena atom berbagi atau memindahkan elektron; paduan hanya campuran.", "A compound forms when atoms share or transfer electrons; an alloy is only a mixture."),
    dua(`Contoh di dunia nyata: ${pad.nama.id} dipakai untuk ${pad.pakai.id.charAt(0).toLowerCase() + pad.pakai.id.slice(1)}`, `Real-world example: ${pad.nama.en} is used for ${pad.pakai.en.charAt(0).toLowerCase() + pad.pakai.en.slice(1)}`));

  // logam dengan logam
  if (sims.every((s) => LOGAM.has(PER_SIMBOL.get(s).kategori))) return tak("logam-logam",
    dua(`${gabungNama(sims, "id")} semuanya logam. Logam dengan logam tidak membentuk senyawa seperti air atau garam, karena sama-sama cenderung melepas elektron.`, `${gabungNama(sims, "en")} are all metals. Metals with metals do not form compounds like water or salt, because they all tend to give away electrons.`),
    dua("Logam bisa dilebur bersama menjadi paduan, tetapi itu campuran, bukan senyawa. Coba gabungkan logam dengan nonlogam.", "Metals can be melted together into alloys, but that is a mixture, not a compound. Try a metal with a nonmetal."));

  // unsur sama, perbandingan salah
  const n = HIMPUNAN_SENYAWA.get(kunciHimpunan(sims)) || 0;
  if (n > 0) return tak("perbandingan",
    dua(`${gabungNama(sims, "id")} memang bisa membentuk ${n === 1 ? "satu senyawa" : n + " senyawa"}, tetapi tidak dengan perbandingan jumlah atom ini. Atom bergabung dalam perbandingan tertentu, bukan sembarang.`, `${gabungNama(sims, "en")} can really form ${n === 1 ? "one compound" : n + " compounds"}, but not with this ratio of atoms. Atoms combine in set ratios, not any amount.`),
    dua("Coba ubah jumlah atom salah satu unsur, misalnya mulai dari 1, 2, atau 3.", "Try changing the number of atoms of one element, for example starting with 1, 2 or 3."));

  const mulia2 = sims.filter((s) => s === "Au" || s === "Pt");
  return tak("tak-terdaftar",
    dua(`Kombinasi ini tidak membentuk senyawa stabil yang umum di dunia nyata, atau belum ada dalam daftar ${SENYAWA.length} senyawa permainan ini.${mulia2.length ? " Emas dan platina juga sangat tidak mudah bereaksi (logam mulia)." : ""}`, `This combination does not form a common stable compound in real life, or it is not yet in the game's list of ${SENYAWA.length} compounds.${mulia2.length ? " Gold and platinum also hardly react at all (noble metals)." : ""}`),
    dua("Coba kombinasi lain. Unsur seperti hidrogen, karbon, oksigen, natrium, dan klor mudah dipasangkan.", "Try another combination. Elements like hydrogen, carbon, oxygen, sodium and chlorine pair up easily."));
}

// ---------- bintang dan beruntun ----------
export const bintangUntuk = (percobaan) => (percobaan <= 1 ? 3 : percobaan === 2 ? 2 : 1);
export const SKOR_AWAL = { bintang: 0, beruntun: 0, terbaik: 0, benar: 0 };

export function skorBersih(s) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return { bintang: n(s && s.bintang), beruntun: n(s && s.beruntun), terbaik: n(s && s.terbaik), benar: n(s && s.benar) };
}
/** Rumus salah: beruntun kembali ke 0 (tanpa hukuman bintang). */
export function catatSalah(skor) { return { ...skorBersih(skor), beruntun: 0 }; }
/**
 * Rumus benar. percobaan = percobaan ke berapa; bintang diberikan hanya untuk penemuan baru (agar tidak bisa diulang-ulang).
 * @returns {skor, bintang} bintang yang didapat kali ini
 */
export function catatBenar(skor, { percobaan = 1, baru = true, bonus = 0 } = {}) {
  const s = skorBersih(skor), dapat = (baru ? bintangUntuk(percobaan) : 0) + (bonus > 0 ? bonus : 0);
  const beruntun = percobaan <= 1 ? s.beruntun + 1 : 0;
  return { skor: { bintang: s.bintang + dapat, beruntun, terbaik: Math.max(s.terbaik, beruntun), benar: s.benar + 1 }, bintang: dapat };
}

// ---------- soal acak ----------
/** Pilih satu senyawa sederhana untuk dibuat. hindari = daftar kunci yang sudah ditemukan/ditanyakan (dipakai bila masih ada pilihan lain). */
export function soalAcak(rng = Math.random, hindari = []) {
  const sederhana = SENYAWA.filter((r) => { const c = parseRumus(r[0]); let a = 0; for (const v of c.values()) a += v; return c.size <= 3 && a <= 12 && !r[7]; });
  const kunci = (r) => rumusTeks(parseRumus(r[0])), belum = sederhana.filter((r) => !hindari.includes(kunci(r)));
  const pool = belum.length ? belum : sederhana, r = pool[Math.floor(rng() * pool.length)];
  const sims = [...parseRumus(r[0]).keys()];
  return { kunci: kunci(r), rumus: r[0], nama: dua(r[1], r[2]), unsur: sims, petunjuk: dua(r[5], r[6]), pakai: dua(r[8], r[9]) };
}
/** Apakah hasil racikan memenuhi soal? */
export function soalTerpenuhi(soal, hasil) { return !!(soal && hasil && hasil.tipe === "nyata" && (hasil.rumusDasar === soal.rumus || rumusTeks(parseRumus(hasil.rumusDasar)) === soal.kunci)); }
