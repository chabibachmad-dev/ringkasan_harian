// Render contoh semua templat harian ke folder (untuk dilihat pemilik).   node motion/render-contoh.mjs [folderKeluar] [skala]
import fs from "node:fs";
import path from "node:path";
import { HARIAN, NAMA_HARI } from "./templates/index.js";
import { renderVideo } from "./render.js";
import { HOOK_DEFAULT } from "./content.js";

const out = process.argv[2] || "contoh-video", skala = Number(process.argv[3] || 1.5);
fs.mkdirSync(out, { recursive: true });
const urut = [...HARIAN].sort((a, b) => ((a.hari + 6) % 7) - ((b.hari + 6) % 7)); // Senin dulu
for (let i = 0; i < urut.length; i++) {
  const t = urut[i], teaser = urut[(i + 1) % urut.length].nama;
  const berkas = path.join(out, `${String(i + 1).padStart(2, "0")}-${NAMA_HARI[t.hari].toLowerCase()}-${t.id}.mp4`);
  const t0 = Date.now();
  const r = await renderVideo({ templatId: t.id, isi: t.contoh, hook: HOOK_DEFAULT[t.id], teaser, keluar: berkas, skala });
  console.log(`${berkas}  ${r.durasi.toFixed(1)} dtk  ${r.lebar}x${r.tinggi}  ${((Date.now() - t0) / 1000).toFixed(0)} dtk render  ${(fs.statSync(berkas).size / 1e6).toFixed(1)} MB`);
}
