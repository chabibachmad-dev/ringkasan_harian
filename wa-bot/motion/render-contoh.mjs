// Render contoh 7 Shorts fakta (satu per hari) ke folder.   node motion/render-contoh.mjs [folderKeluar] [skala]
import fs from "node:fs";
import path from "node:path";
import { HARIAN, NAMA_HARI, temaMinggu } from "./templates/index.js";
import { renderVideo } from "./render.js";
import { HOOK_DEFAULT } from "./content.js";
import { metaShorts } from "./youtube-meta.js";

const out = process.argv[2] || "contoh-video", skala = Number(process.argv[3] || 1.5);
fs.mkdirSync(out, { recursive: true });
const urut = [...HARIAN].sort((a, b) => ((a.hari + 6) % 7) - ((b.hari + 6) % 7)); // Senin dulu
const pelajaran = ["Perkalian dan pembagian", "Pecahan senilai", "Mengenal bangun datar", "Satuan panjang dan berat", "Siklus air", "Keliling dan luas", "Rantai makanan"];
for (let i = 0; i < urut.length; i++) {
  const t = urut[i], tanggal = `2026-11-${String(2 + i).padStart(2, "0")}`;
  const berkas = path.join(out, `${String(i + 1).padStart(2, "0")}-${NAMA_HARI[t.hari].toLowerCase()}-${t.id}.mp4`);
  const t0 = Date.now();
  const r = await renderVideo({ templatId: t.id, isi: t.contoh, hook: HOOK_DEFAULT[t.id], teaserLabel: "TONTON JUGA", teaser: `Pelajaran: ${pelajaran[i]}`, tema: temaMinggu(t, tanggal), keluar: berkas, skala });
  const meta = metaShorts({ templatId: t.id, isi: t.contoh, hook: HOOK_DEFAULT[t.id], topik: t.nama });
  console.log(`${path.basename(berkas)}  ${r.durasi.toFixed(1)} dtk  ${r.lebar}x${r.tinggi}  ${((Date.now() - t0) / 1000).toFixed(0)} dtk render  ${(fs.statSync(berkas).size / 1e6).toFixed(1)} MB  judul: ${meta.judul}`);
}
