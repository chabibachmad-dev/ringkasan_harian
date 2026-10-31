// Judul, deskripsi, dan tag untuk unggahan YouTube Shorts.
import { potong } from "./engine.js";

export function judulDari(templatId, isi, hook) {
  const p = { "kuis-kilat": isi.pertanyaan, "hitung-langkah": isi.judul ? `${isi.judul}: ${isi.soal}` : isi.soal, "fakta-angka": isi.judul, "perbandingan-bar": isi.judul,
    "proses-tahapan": isi.judul, "mitos-fakta": isi.mitos ? `Mitos atau fakta? ${isi.mitos}` : "", "pola-angka": `${isi.judul} ${(isi.deret || []).join(", ")}, ...?` }[templatId];
  return potong(p || hook || "Belajar Bareng", 88);
}
export function metaShorts({ templatId, isi, hook, topik, kanal = "Belajar Bareng", tanggal = "" }) {
  const judul = potong(`${judulDari(templatId, isi, hook)} #Shorts`, 100);
  const tag = [...new Set(["shorts", "belajar", "edukasi", "anak sd", "belajar bareng", ...String(topik || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3).slice(0, 4)])];
  const deskripsi = [
    `${hook ? hook + " " : ""}Belajar singkat tentang ${topik || "hal baru"}, cocok untuk anak SD.`, "",
    `Ikuti ${kanal} supaya tidak ketinggalan video belajar singkat tiap hari.`, "",
    "#Shorts #BelajarBareng #BelajarSD", tanggal ? `\n${tanggal}` : ""
  ].join("\n").trim();
  return { judul, deskripsi, tag, madeForKids: true, containsSyntheticMedia: true };
}
