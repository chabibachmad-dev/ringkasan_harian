// Pencarian pemain untuk pemilih "Masuk sebagai pemain" dan dialog lain di Study. Murni di klien, dari daftar yang sudah dimuat.

/** Samakan untuk pencocokan: tanpa aksen, huruf kecil, spasi ganda dirapatkan, spasi tepi dibuang. */
export const normalizeName = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Saring pemain berdasarkan potongan nama (substring, tidak peka huruf besar-kecil/aksen/spasi tepi).
 * Hasil selalu urut alfabet nama. Kata kunci kosong = semua pemain.
 */
/** Apakah `name` memuat `query` (aturan sama dengan filterPlayers). Kata kunci kosong = cocok. */
export const matchesQuery = (name, query) => {
  const q = normalizeName(query);
  return !q || normalizeName(name).includes(q);
};

/**
 * Letak potongan yang cocok di `name` ASLI sebagai [mulai, akhir) -- untuk digarisbawahi.
 * Pencocokan tidak peka huruf besar-kecil/aksen/spasi ganda; null bila kata kunci kosong atau tidak ketemu.
 */
export function matchRange(name, query) {
  const q = normalizeName(query);
  if (!q) return null;
  const src = String(name ?? "");
  let norm = "";
  const at = []; // at[i] = indeks karakter asli untuk norm[i]
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const piece = /\s/.test(c) ? " " : c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const ch of piece) {
      if (ch === " " && (norm === "" || norm.endsWith(" "))) continue; // spasi tepi/ganda tidak dihitung
      norm += ch;
      at.push(i);
    }
  }
  const k = norm.indexOf(q);
  if (k < 0) return null;
  return [at[k], at[k + q.length - 1] + 1];
}

export function filterPlayers(players, query) {
  return (players || [])
    .filter((p) => matchesQuery(p.name, query))
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), "id") || String(a.name).localeCompare(String(b.name), "id"));
}

/**
 * Leaderboard: `ranked` sudah urut peringkat. Hasil saring TETAP membawa peringkat asli (bukan dihitung ulang)
 * dan urutan peringkat. Mengembalikan [{ p, rank }].
 */
export function filterRanked(ranked, query) {
  return (ranked || []).map((p, i) => ({ p, rank: i + 1 })).filter((x) => matchesQuery(x.p.name, query));
}
