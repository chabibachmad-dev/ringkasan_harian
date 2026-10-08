// ================================================================
// Pemeriksa jawaban berbasis dokumen ("guard"): setelah model menjawab dari potongan dokumen,
// periksa secara MEKANIS (tanpa model) apakah
//   1. kutipan «…» benar-benar ada di potongan yang dikirim ke model, dan
//   2. nomor halaman yang disebut ("hlm 37", "halaman 12") ada di potongan itu.
// Yang tidak terbukti diberi catatan peringatan di akhir jawaban -- model kecil maupun besar
// kadang mengarang kutipan atau nomor halaman.
//
// SALINAN: supabase/functions/_shared/docguard.ts (Edge Function tidak bisa mengimpor folder wa-bot).
// Kalau salah satu diubah, ubah yang lain juga (test-docguard.mjs menjalankan keduanya).
// ================================================================

export function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// chunks: [{ title, page, text }] -- teks boleh memuat penanda "[Halaman n]".
export function collectPages(chunks) {
  const pages = new Set();
  for (const c of chunks || []) {
    if (Number.isFinite(c?.page)) pages.add(Number(c.page));
    for (const m of String(c?.text || "").matchAll(/\[Halaman (\d+)\]/g)) pages.add(Number(m[1]));
  }
  return pages;
}

const QUOTE_RE = /[«"“]([^«»"“”\n]{12,400})[»"”]/g;
const PAGE_RE = /\b(?:hlm\.?|halaman)\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?/gi;

export function checkDocAnswer(reply, chunks) {
  const text = String(reply || "");
  const list = chunks || [];
  const result = { badQuotes: [], badPages: [], checkedQuotes: 0, checkedPages: 0 };
  if (list.length === 0 || !text.trim()) return result;

  const ctx = ` ${normalizeForMatch(list.map((c) => c.text).join("\n"))} `;
  const seenQuote = new Set();
  for (const m of text.matchAll(QUOTE_RE)) {
    const raw = m[1].trim();
    // kutipan bertanda elipsis: tiap penggalnya diperiksa sendiri
    const parts = raw.split(/\s*(?:…|\.{3})\s*/).map(normalizeForMatch).filter((p) => p.split(" ").length >= 3);
    if (parts.length === 0 || seenQuote.has(raw)) continue;
    seenQuote.add(raw);
    result.checkedQuotes += 1;
    if (!parts.every((p) => ctx.includes(` ${p} `))) result.badQuotes.push(raw.length > 120 ? `${raw.slice(0, 117)}…` : raw);
  }

  const known = collectPages(list);
  if (known.size > 0) {
    const seenPage = new Set();
    for (const m of text.matchAll(PAGE_RE)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (const n of [a, b]) {
        if (seenPage.has(n)) continue;
        seenPage.add(n);
        result.checkedPages += 1;
        if (!known.has(n)) result.badPages.push(n);
      }
    }
  }
  return result;
}

// Balasan + catatan peringatan bila ada yang tidak terbukti. Mengembalikan { reply, flagged }.
export function guardDocAnswer(reply, chunks) {
  const r = checkDocAnswer(reply, chunks);
  const notes = [];
  if (r.badQuotes.length > 0) {
    notes.push(`kutipan berikut tidak ditemukan persis di bagian dokumen yang dibaca: ${r.badQuotes.slice(0, 3).map((q) => `«${q}»`).join(", ")}`);
  }
  if (r.badPages.length > 0) {
    notes.push(`rujukan halaman ${r.badPages.slice(0, 6).join(", ")} tidak ada di bagian dokumen yang dibaca`);
  }
  if (notes.length === 0) return { reply: String(reply || ""), flagged: false, ...r };
  return {
    reply: `${String(reply || "").trimEnd()}\n\n> ⚠️ Pemeriksaan otomatis: ${notes.join("; ")}. Periksa kembali ke dokumennya sebelum dipakai.`,
    flagged: true,
    ...r
  };
}
