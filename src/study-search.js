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
export function filterPlayers(players, query) {
  const q = normalizeName(query);
  return (players || [])
    .filter((p) => !q || normalizeName(p.name).includes(q))
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), "id") || String(a.name).localeCompare(String(b.name), "id"));
}
