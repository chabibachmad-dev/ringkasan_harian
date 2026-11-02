// Akses cepat ke bot WhatsApp Ayyubi dari dialog "Daftarkan nomor WhatsApp" (PIN orang tua Study).
// Nomor WhatsApp UTAMA bot (yang menerima chat pribadi berisi kode PIN-xxxxxx) disimpan DI SATU TEMPAT ini:
//   * isi VITE_STUDY_BOT_WA_NUMBER di env build (mis. 6281234567890), atau
//   * isi BOT_WA_NUMBER_BAWAAN di bawah.
// Format internasional, angka saja (tanpa +, spasi, atau strip). Kosong = tombol "Chat bot" dan nomor disembunyikan.
const BOT_WA_NUMBER_BAWAAN = "";

const digits = (v) => String(v ?? "").replace(/\D/g, "");
/** Nomor bot (angka saja) atau "" bila belum diatur. */
export const BOT_WA_NUMBER = digits(import.meta.env?.VITE_STUDY_BOT_WA_NUMBER) || digits(BOT_WA_NUMBER_BAWAAN);

/** Link wa.me dengan pesan terisi kode; kode di-URL-encode. null bila nomor/kode kosong. */
export function waLink(number, code) {
  const n = digits(number);
  const c = String(code ?? "").trim();
  if (!n || !c) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(c)}`;
}

/** Nomor yang mudah dibaca: 6281234567890 -> "+62 812-3456-7890". */
export function formatWaNumber(number) {
  const n = digits(number);
  if (!n) return "";
  if (n.startsWith("62") && n.length > 5) {
    const r = n.slice(2);
    return `+62 ${r.slice(0, 3)}-${r.slice(3, 7)}${r.length > 7 ? `-${r.slice(7)}` : ""}`;
  }
  return `+${n}`;
}
