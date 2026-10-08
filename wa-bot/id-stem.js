// ================================================================
// Pemotong imbuhan (stemmer) Bahasa Indonesia SEDERHANA, tanpa kamus.
//
// Tujuan: pencarian "menyetor" bisa menemukan "setor", "disetorkan", "penyetoran", "setoran";
// "membayar" ~ "pembayaran" ~ "bayar". Dipakai di dua sisi yang SAMA (saat mengindeks teks
// dokumen dan saat memecah pertanyaan), jadi tidak harus linguistik-sempurna -- cukup konsisten.
// Karena tanpa kamus, hasil yang ambigu dikembalikan sebagai beberapa kandidat
// (mis. "mengeluarkan" -> {eluar, keluar}); pencocokan = ada kandidat yang sama.
//
// stemCandidates(kata) -> array kandidat (selalu menyertakan kata itu sendiri), maks ±8.
// ================================================================

const PARTICLES = ["lah", "kah", "tah", "pun"];
const POSSESSIVE = ["nya", "ku", "mu"];
const V = "aeiou";

function stripSuffixes(w) {
  const out = new Set([w]);
  let x = w;
  for (const p of PARTICLES) {
    if (x.length > p.length + 3 && x.endsWith(p)) {
      x = x.slice(0, -p.length);
      break;
    }
  }
  for (const p of POSSESSIVE) {
    if (x.length > p.length + 3 && x.endsWith(p)) {
      x = x.slice(0, -p.length);
      break;
    }
  }
  out.add(x);
  for (const suf of ["kan", "an", "i"]) {
    if (x.length > suf.length + 2 && x.endsWith(suf)) {
      out.add(x.slice(0, -suf.length));
      break; // hanya akhiran terpanjang yang cocok
    }
  }
  // "ke-...-an" / "pe-...-an" / "per-...-an" ditangani di prefix
  return out;
}

function stripPrefixes(x) {
  const out = new Set();
  const add = (s) => {
    if (s && s.length >= 4) out.add(s);
  };
  const startsV = (s) => s.length > 0 && V.includes(s[0]);
  const cut = (pre) => (x.startsWith(pre) ? x.slice(pre.length) : null);
  let r;

  // di-, se-, ke-(hanya bila ber-akhiran -an: "keuangan", "kebijakan")
  if ((r = cut("di")) && r.length >= 4) add(r);
  if ((r = cut("se")) && r.length >= 4) add(r);
  if ((r = cut("ke")) && r.length >= 4 && x.endsWith("an")) add(r);
  // ber-, ter-, per-
  if ((r = cut("ber"))) add(r);
  if ((r = cut("ter"))) add(r);
  if ((r = cut("per"))) add(r);
  if ((r = cut("bel")) && r === "ajar") add("ajar");
  // memper-, diper-, mempe-
  if ((r = cut("memper"))) add(r);
  if ((r = cut("diper"))) add(r);

  // meN- / peN- (R = me atau pe)
  for (const R of ["me", "pe"]) {
    if ((r = cut(R + "ny")) && startsV(r)) {
      add("s" + r); // menyetor -> setor
      add(r);
    }
    if ((r = cut(R + "ng"))) {
      if (startsV(r)) {
        add(r); // mengambil -> ambil
        add("k" + r); // mengeluarkan -> keluar
      } else {
        add(r); // menggunakan -> gunakan
      }
    }
    if ((r = cut(R + "nge"))) add(r); // mengecek -> cek
    if ((r = cut(R + "m"))) {
      if (startsV(r)) {
        add("p" + r); // memilih -> pilih
        add(r);
      } else if ("bfvp".includes(r[0])) {
        add(r); // membayar -> bayar
      }
    }
    if ((r = cut(R + "n"))) {
      if (startsV(r)) {
        add("t" + r); // menulis -> tulis
        add(r);
      } else if ("cdjzs".includes(r[0])) {
        add(r); // mendapat -> dapat
      }
    }
    if ((r = cut(R)) && r.length > 0 && "lmnrwy".includes(r[0])) add(r); // melihat -> lihat, pelaku -> laku
    if (R === "pe" && (r = cut("pe")) && r.length >= 4) add(r); // pekerja -> kerja
  }
  return out;
}

const cache = new Map();

export function stemCandidates(word) {
  const w = String(word || "").toLowerCase();
  if (w.length < 4 || !/^[a-z]+$/.test(w)) return [w];
  const hit = cache.get(w);
  if (hit) return hit;
  const out = new Set([w]);
  for (const x of stripSuffixes(w)) {
    out.add(x);
    for (const y of stripPrefixes(x)) out.add(y);
  }
  // Pertahankan hanya kandidat >= 3 huruf; urutan: kata, lalu yang terpendek-dulu tidak penting.
  const list = [...out].filter((s) => s.length >= 4).slice(0, 8);
  if (!list.includes(w)) list.unshift(w);
  if (cache.size > 50000) cache.clear();
  cache.set(w, list);
  return list;
}

// Teks -> deretan kandidat batang kata, dipisah spasi (untuk kolom FTS "stem").
export function stemText(text) {
  const words = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const out = [];
  for (const w of words) {
    if (/^[a-z]+$/.test(w)) out.push(...stemCandidates(w));
    else out.push(w);
  }
  return out.join(" ");
}
