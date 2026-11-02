// Judul + kata kunci + CSV untuk Adobe Stock, dengan pemeriksaan aturan. Tanpa dependensi.
// Aturan (halaman bantuan Adobe): CSV UTF-8, header persis templat; Filename maks 30 karakter; Title maks 70, teks biasa tanpa koma/karakter khusus;
// Keywords maks 50, dipisah koma, urut dari yang terpenting; maks 5.000 baris dan 1 MB per berkas.
export const HEADER = ["Filename", "Title", "Keywords", "Category", "Releases"];
export const BATAS = { judul: 70, namaBerkas: 30, kataKunci: 50, panjangKata: 40, baris: 5000 };
// merek/nama yang tidak boleh ada di judul dan kata kunci (daftar contoh; bukan daftar lengkap)
const DILARANG = /\b(adobe|shutterstock|canva|freepik|getty|istock|midjourney|dall-?e|stable diffusion|chatgpt|openai|google|apple|samsung|nike|disney|marvel|pixar|ghibli|pokemon|mickey|hello kitty|starbucks|coca-?cola|facebook|instagram|tiktok|youtube|whatsapp)\b/i;

export function bersihkanJudul(t) {
  let s = String(t || "").replace(/[,;:"'`“”‘’<>|\\/{}[\]()*#@!?&%$^~+=_]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > BATAS.judul) { s = s.slice(0, BATAS.judul + 1); s = s.slice(0, Math.max(s.lastIndexOf(" "), 20)).trim(); }
  return s;
}
export function bersihkanKataKunci(arr) {
  const daftar = Array.isArray(arr) ? arr : String(arr || "").split(",");
  const hasil = [];
  for (let k of daftar) {
    k = String(k).toLowerCase().replace(/[,;"'`<>|\\{}[\]()*#@!?&%$^~+=_]/g, " ").replace(/\s+/g, " ").trim();
    if (!k || k.length > BATAS.panjangKata || DILARANG.test(k) || /\d{4,}/.test(k) || hasil.includes(k)) continue;
    hasil.push(k); if (hasil.length >= BATAS.kataKunci) break;
  }
  return hasil;
}
export function periksaBaris({ berkas, judul, kata }) {
  const m = [];
  if (!berkas || berkas.length > BATAS.namaBerkas) m.push(`nama berkas lebih dari ${BATAS.namaBerkas} karakter: ${berkas}`);
  if (!judul || judul.length > BATAS.judul || /,/.test(judul)) m.push(`judul tidak valid: ${judul}`);
  if (DILARANG.test(judul || "")) m.push(`judul memuat merek/nama terlarang: ${judul}`);
  if (!kata || kata.length < 7 || kata.length > BATAS.kataKunci) m.push(`jumlah kata kunci ${kata ? kata.length : 0} (harus 7-${BATAS.kataKunci}): ${berkas}`);
  return m;
}
const esc = (v) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** @param {{berkas,judul,kata:string[],kategori?,rilis?}[]} baris */
export function buatCsv(baris) {
  if (baris.length > BATAS.baris) throw new Error(`CSV maksimal ${BATAS.baris} baris`);
  const galat = baris.flatMap(periksaBaris); if (galat.length) throw new Error(galat.slice(0, 5).join("; "));
  const out = [HEADER.join(",")].concat(baris.map((b) => [b.berkas, b.judul, b.kata.join(","), b.kategori ?? "", b.rilis ?? ""].map(esc).join(",")));
  const teks = out.join("\r\n") + "\r\n";
  if (Buffer.byteLength(teks) > 1048576) throw new Error("CSV melebihi 1 MB");
  return teks;
}
function ekstrakJson(t) {
  const s = String(t || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null; try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
export function promptMetadata({ subjek, jenis, tema, dasarKata = [] }) {
  const apa = jenis === "ikon" ? "vector icon" : jenis === "ikon3d" ? "3D rendered icon illustration (rounded relief look, soft shadow, plain light background)" : "illustration/background image";
  return `You write Adobe Stock metadata in English for ONE ${apa}.
Subject: ${subjek}
Theme: ${tema}
Hint keywords (use only if they really describe the image): ${dasarKata.slice(0, 20).join(", ")}
Rules:
- title: 35-65 characters, plain words only, NO commas or special characters, describes what the image shows. ${jenis === "ikon" || jenis === "ikon3d" ? 'End with the word "icon".' : ""}${jenis === "ikon3d" ? " Start with 3D." : ""}
- keywords: 35-50 single or two-word terms, most important first (the first 10 matter most), no duplicates, no brand names, no artist/person/character names, no camera info, nothing that is not in the image.
Return ONLY JSON: {"title":"...","keywords":["..."]}`;
}
/** Metadata dari LLM bila ada, jatuh ke bawaan katalog bila gagal/tidak valid. */
export async function metadataUntuk({ llm, berkas, subjek, jenis, tema, judulBawaan, kataBawaan }) {
  const bawaan = { berkas, judul: bersihkanJudul(judulBawaan), kata: bersihkanKataKunci(kataBawaan), sumber: "katalog" };
  if (typeof llm !== "function") return bawaan;
  try {
    const j = ekstrakJson(await llm(promptMetadata({ subjek, jenis, tema, dasarKata: bawaan.kata })));
    if (!j) return bawaan;
    const judul = bersihkanJudul(j.title), kata = bersihkanKataKunci(j.keywords);
    if (judul.length < 15 || DILARANG.test(judul) || kata.length < 20) return bawaan;
    // lengkapi dari bawaan bila kurang dari 35
    for (const k of bawaan.kata) { if (kata.length >= BATAS.kataKunci) break; if (!kata.includes(k)) kata.push(k); }
    return { berkas, judul, kata, sumber: "ai" };
  } catch { return bawaan; }
}
