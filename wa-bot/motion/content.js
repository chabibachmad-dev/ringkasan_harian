// Membuat isi video dari topik: prompt JSON ke AI, validasi per templat, pemeriksaan hitungan, coba ulang.
// `llm` = fungsi async (prompt:string) => string. Pasang dari router AI yang sudah ada di bot.
import { ambilTemplat } from "./templates/index.js";
import { potong } from "./engine.js";

const HOOK_DEFAULT = {
  peringkat: "Siapa juaranya?", "garis-waktu": "Dari mana semuanya mulai?", "cerita-fakta": "Fakta yang jarang diketahui",
  "kuis-kilat": "Kuis kilat! Siap?", "hitung-langkah": "Bisa hitung ini?", "fakta-angka": "Tahukah kamu?",
  "perbandingan-bar": "Siapa paling hebat?", "proses-tahapan": "Pernah penasaran?", "mitos-fakta": "Mitos atau fakta?",
  "pola-angka": "Tebak angka berikutnya!", "lingkaran-pi": "Kenapa π hampir 3,14?"
};

/** Ambil objek JSON pertama dari balasan AI (boleh dibungkus ```json ... ```). */
export function ekstrakJson(teks) {
  const s = String(teks ?? "");
  const pagar = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const sumber = pagar ? pagar[1] : s;
  const awal = sumber.search(/[\[{]/); if (awal < 0) throw new Error("tidak ada JSON");
  const buka = sumber[awal], tutup = buka === "{" ? "}" : "]";
  let dalam = 0, str = false, esc = false;
  for (let i = awal; i < sumber.length; i++) {
    const c = sumber[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === buka) dalam++; else if (c === tutup && --dalam === 0) return JSON.parse(sumber.slice(awal, i + 1));
  }
  throw new Error("JSON tidak lengkap");
}

export function promptIsi({ templatId, topik, kelas = "SD kelas 1-6" }) {
  const t = ambilTemplat(templatId);
  return [
    `Kamu penulis konten edukasi Short YouTube berbahasa Indonesia untuk anak ${kelas}.`,
    `Topik hari ini: "${topik}". Format video: "${t.nama}".`,
    `Balas HANYA dengan satu objek JSON (tanpa teks lain, tanpa markdown) berbentuk:`,
    t.petunjukIsi,
    `Tambahkan dua kolom di objek yang sama: "hook" (kalimat pancingan 3-6 kata, maks 38 huruf, memancing rasa penasaran, tanpa emoji) dan "dasar" (satu kalimat: dasar/sumber fakta atau rumus yang dipakai, untuk dicek pemilik).`,
    `Aturan: bahasa Indonesia baku yang santai dan mudah dipahami anak; kalimat pendek; fakta dan angka HARUS benar dan dapat diverifikasi, jangan mengarang angka; kalau kamu tidak yakin pada sebuah angka, pakai angka yang lebih umum atau topik lain yang kamu yakini; semua hitungan harus benar; jangan memakai emoji; jangan menyebut merek atau tokoh nyata.`
  ].join("\n");
}

// ---------- pemeriksaan hitungan deterministik ----------
const OPS = { "+": (a, b) => a + b, "-": (a, b) => a - b, "−": (a, b) => a - b, "×": (a, b) => a * b, "x": (a, b) => a * b, "*": (a, b) => a * b, "÷": (a, b) => a / b, "/": (a, b) => a / b, ":": (a, b) => a / b };
const angka = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));
/** "24 ÷ 4 = 6" -> true/false; null bila bentuknya tidak dikenali (tidak diperiksa). */
export function cekSatuHitungan(ekspresi) {
  const m = String(ekspresi).replace(/\s+/g, " ").trim().match(/^(-?[\d.,]+) ?([+\-−×x*÷/:]) ?(-?[\d.,]+) ?= ?(-?[\d.,]+)$/);
  if (!m) return null;
  const [a, op, b, c] = [angka(m[1]), m[2], angka(m[3]), angka(m[4])];
  const r = OPS[op](a, b); return Math.abs(r - c) < 1e-9 * Math.max(1, Math.abs(c)) + 1e-9;
}
/** Verifikasi aturan deret sederhana: "+3", "-2", "×2", "÷2". null bila aturan tidak dikenali. */
export function cekPola(deret, aturan, berikutnya) {
  const m = String(aturan).replace(/\s+/g, "").match(/^([+\-−×x*÷/])(-?[\d.,]+)$/); if (!m) return null;
  const f = OPS[m[1]], k = angka(m[2]), d = [...deret, berikutnya].map(angka); if (d.some((x) => !Number.isFinite(x))) return null;
  for (let i = 1; i < d.length; i++) if (Math.abs(f(d[i - 1], k) - d[i]) > 1e-9) return false;
  return true;
}
/** Pemeriksaan khusus templat; mengembalikan daftar galat (kosong = lolos). */
export function periksaIsi(templatId, isi) {
  const gal = [];
  if (templatId === "hitung-langkah") isi.langkah.forEach((l, i) => { if (cekSatuHitungan(l.ekspresi) === false) gal.push(`langkah ${i + 1}: hitungan salah ("${l.ekspresi}")`); });
  if (templatId === "pola-angka" && cekPola(isi.deret, isi.aturan, isi.berikutnya) === false) gal.push("deret tidak sesuai aturan");
  if (templatId === "kuis-kilat") { const j = isi.pilihan[isi.jawaban]; if (new Set(isi.pilihan.map((p) => p.toLowerCase())).size !== isi.pilihan.length) gal.push("ada pilihan kembar"); if (!j) gal.push("jawaban tidak ada"); }
  return gal;
}

/**
 * Minta AI membuat isi, validasi, ulang bila perlu (galat dikirim balik ke AI).
 * Mengembalikan { isi, hook, dasar, narasi, percobaan }. Melempar Error bila semua percobaan gagal.
 */
export async function buatIsi({ llm, templatId, topik, kelas, maksCoba = 3 }) {
  const t = ambilTemplat(templatId);
  let prompt = promptIsi({ templatId, topik, kelas }), galTerakhir = [];
  for (let n = 1; n <= maksCoba; n++) {
    let mentah;
    try { mentah = ekstrakJson(await llm(prompt)); } catch (e) { galTerakhir = [`balasan bukan JSON valid (${e.message})`]; prompt += `\n\nPERBAIKI: ${galTerakhir[0]}. Balas hanya JSON.`; continue; }
    const r = t.rapikan(mentah);
    const gal = r.ok ? periksaIsi(templatId, r.isi) : r.galat;
    if (gal.length === 0) {
      const hook = potong(mentah.hook || HOOK_DEFAULT[templatId] || "Tahukah kamu?", 38);
      return { isi: r.isi, hook, dasar: potong(mentah.dasar || "", 160), narasi: t.narasi(r.isi), percobaan: n };
    }
    galTerakhir = gal; prompt += `\n\nPERBAIKI, jawaban sebelumnya bermasalah: ${gal.join("; ")}. Balas hanya JSON yang sudah benar.`;
  }
  throw new Error(`Gagal membuat isi (${templatId}): ${galTerakhir.join("; ")}`);
}
export { HOOK_DEFAULT };
export const hookDefault = (id) => HOOK_DEFAULT[id] || HOOK_DEFAULT[String(id).replace(/-teks$/, "")] || "Tahukah kamu?";

// =====================================================================================
// FAKTA DUNIA (Shorts): dibuat dari sumber hasil pencarian web, bukan dari ingatan AI.
// =====================================================================================

/** Daftar awal kata yang tidak cocok untuk konten ramah keluarga. Tambah/kurangi sesuai kebutuhan. */
export const KATA_TIDAK_RAMAH = /\b(bunuh|membunuh|pembunuhan|darah|mayat|jenazah|bunuh diri|seks|seksual|porno|narkoba|judi|kasino|telanjang|teroris|terorisme|bom|senjata|konspirasi|ilmuminati|dukun|santet|kutukan|obat ajaib|menyembuhkan|kanker|diabetes|vaksin|partai|pemilu|capres|kafir|murtad)\b/i;
const BANDING_RAHASIA = /\b(rahasia gelap|disembunyikan pemerintah|tidak ingin kamu tahu|dilarang diketahui)\b/i;

export function semuaTeks(x, acc = []) {
  if (typeof x === "string") acc.push(x); else if (Array.isArray(x)) x.forEach((y) => semuaTeks(y, acc)); else if (x && typeof x === "object") Object.values(x).forEach((y) => semuaTeks(y, acc));
  return acc;
}
export function periksaRamahKeluarga(isi) {
  const gal = [];
  for (const s of semuaTeks(isi)) { const m = s.match(KATA_TIDAK_RAMAH) || s.match(BANDING_RAHASIA); if (m) gal.push(`kata/topik tidak ramah keluarga: "${m[0]}"`); }
  return gal;
}

const normTeks = (s) => String(s).replace(/[\u00a0\u202f]/g, " ").toLowerCase();
/** Apakah bilangan `nilai` (angka atau teks berisi angka) tertulis di teks sumber, dalam format ID/EN yang lazim? */
export function angkaAdaDiSumber(nilai, teksSumber) {
  const m = String(nilai).match(/-?\d[\d.,\s]*\d|-?\d/); if (!m) return true; // bukan angka: tidak diperiksa
  const asli = m[0].trim(), n = Number(asli.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  const teks = normTeks(teksSumber), kand = new Set([asli.replace(/\s+/g, " ")]);
  if (Number.isFinite(n)) {
    const ent = Math.trunc(Math.abs(n)), des = (String(n).split(".")[1] || "");
    const gabung = (ribu, dec) => String(ent).replace(/\B(?=(\d{3})+(?!\d))/g, ribu) + (des ? dec + des : "");
    ["", ".", ",", " "].forEach((r) => [".", ","].forEach((d) => kand.add((n < 0 ? "-" : "") + gabung(r, d))));
    if (!des && ent >= 1e6) { const jt = ent / 1e6; [".", ","].forEach((d) => { const t = String(Math.round(jt * 100) / 100).replace(".", d); kand.add(t + " juta"); kand.add(t + " million"); }); }
    if (!des && ent >= 1e9) { const mi = ent / 1e9; [".", ","].forEach((d) => { const t = String(Math.round(mi * 100) / 100).replace(".", d); kand.add(t + " miliar"); kand.add(t + " billion"); }); }
  }
  return [...kand].some((k) => k && teks.includes(k.toLowerCase()));
}

export function promptFakta({ templatId, topik, sumber, kelas = "keluarga, termasuk anak SD" }) {
  const t = ambilTemplat(templatId);
  const daftar = sumber.map((s, i) => `[${i + 1}] ${s.judul || s.url}\n${s.teks}`).join("\n\n");
  return [
    `Kamu penulis konten fakta untuk Short YouTube berbahasa Indonesia, penonton: ${kelas}.`,
    `Topik: "${topik}". Format video: "${t.nama}".`,
    `SUMBER (hasil pencarian web):\n${daftar}`,
    `Balas HANYA dengan satu objek JSON (tanpa teks lain, tanpa markdown) berbentuk:`, t.petunjukIsi,
    `Tambahkan tiga kolom pada objek yang sama: "hook" (kalimat pancingan 3-6 kata, maks 38 huruf, memancing rasa penasaran, tanpa emoji), "dasar" (satu kalimat ringkas yang menjelaskan fakta utamanya, untuk pemilik), dan "sumber" (daftar nomor sumber yang benar-benar kamu pakai, misal [1,3]; minimal 2 sumber berbeda).`,
    `ATURAN KERAS: (1) pakai HANYA fakta, angka, dan tahun yang tertulis eksplisit di SUMBER di atas; dilarang menambah angka atau tahun dari ingatanmu; (2) bila SUMBER tidak cukup atau saling bertentangan untuk topik ini, balas persis {"tidakCukup":true}; (3) bahasa Indonesia baku yang santai, kalimat pendek, mudah dipahami anak; (4) ramah keluarga: tanpa kekerasan, politik, agama, kesehatan/pengobatan, teori konspirasi, atau tokoh nyata yang kontroversial; jangan memakai kata "rahasia", pakai "jarang diketahui"; (5) tanpa emoji dan tanpa merek dagang.`
  ].join("\n");
}

/**
 * Buat isi Short fakta yang berbasis sumber.
 * @param {object} o  llm: async (prompt)=>string; cari: async (kueri)=>[{judul,url,teks}] (pasang dari web search bot);
 *                    templatId, topik, minSumber (default 2), maksCoba (default 3)
 * @returns {{isi, hook, dasar, narasi, sumber:[{judul,url}], percobaan}}
 */
export async function buatIsiFakta({ llm, cari, templatId, topik, kelas, maksCoba = 3, minSumber = 2 }) {
  if (typeof cari !== "function") throw new Error("buatIsiFakta butuh fungsi cari (pencarian web)");
  const t = ambilTemplat(templatId);
  const hasilCari = (await cari(topik)) || [];
  const sumber = hasilCari.filter((s) => s && s.url && String(s.teks || "").trim().length > 40).slice(0, 6).map((s) => ({ judul: potong(s.judul || "", 90), url: s.url, teks: potong(s.teks, 900) }));
  const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  if (new Set(sumber.map((s) => domain(s.url))).size < minSumber) throw new Error(`Sumber kurang untuk "${topik}" (butuh ${minSumber} situs berbeda)`);
  let prompt = promptFakta({ templatId, topik, sumber, kelas }), galTerakhir = [];
  for (let n = 1; n <= maksCoba; n++) {
    let mentah;
    try { mentah = ekstrakJson(await llm(prompt)); } catch (e) { galTerakhir = [`balasan bukan JSON valid (${e.message})`]; prompt += `\n\nPERBAIKI: ${galTerakhir[0]}. Balas hanya JSON.`; continue; }
    if (mentah && mentah.tidakCukup === true) throw new Error(`Sumber tidak cukup untuk "${topik}" (AI menolak mengarang)`);
    const r = t.rapikan(mentah);
    let gal = r.ok ? [...periksaIsi(templatId, r.isi), ...periksaRamahKeluarga(r.isi)] : [...r.galat];
    let dipakai = [];
    if (r.ok) {
      const nomor = [...new Set((Array.isArray(mentah.sumber) ? mentah.sumber : []).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= sumber.length))];
      dipakai = nomor.map((x) => sumber[x - 1]);
      if (new Set(dipakai.map((s) => domain(s.url))).size < minSumber) gal.push(`sebutkan minimal ${minSumber} sumber berbeda yang benar-benar dipakai (kolom "sumber")`);
      const teksDipakai = (dipakai.length ? dipakai : sumber).map((s) => s.judul + " " + s.teks).join(" ");
      for (const a of t.angkaKunci ? t.angkaKunci(r.isi) : []) if (!angkaAdaDiSumber(a, teksDipakai)) gal.push(`angka/tahun "${a}" tidak tertulis di sumber yang dikutip`);
    }
    if (gal.length === 0) {
      const hook = potong(mentah.hook || hookDefault(templatId), 38);
      return { isi: r.isi, hook, dasar: potong(mentah.dasar || "", 200), narasi: t.narasi(r.isi), sumber: dipakai.map((s) => ({ judul: s.judul, url: s.url })), percobaan: n };
    }
    galTerakhir = gal; prompt += `\n\nPERBAIKI, jawaban sebelumnya bermasalah: ${gal.join("; ")}. Balas hanya JSON yang sudah benar, atau {"tidakCukup":true} bila SUMBER memang tidak cukup.`;
  }
  throw new Error(`Gagal membuat fakta (${templatId}): ${galTerakhir.join("; ")}`);
}

/**
 * Seperti buatIsiFakta, tetapi bila adegan bergambar gagal disusun (bukan karena sumber kurang), jatuh ke versi teks ("<id>-teks").
 * Mengembalikan hasil buatIsiFakta + templatId yang akhirnya dipakai.
 */
export async function buatIsiFaktaCadangan(o) {
  const ids = [o.templatId]; try { ambilTemplat(`${o.templatId}-teks`); ids.push(`${o.templatId}-teks`); } catch {}
  let galat;
  for (const id of ids) {
    try { return { ...(await buatIsiFakta({ ...o, templatId: id })), templatId: id }; }
    catch (e) { galat = e; if (/Sumber (kurang|tidak cukup)|fungsi cari/i.test(e.message)) break; }
  }
  throw galat;
}
