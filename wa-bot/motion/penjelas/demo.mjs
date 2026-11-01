// Render prototipe video penjelas.   node motion/penjelas/demo.mjs [berkasKeluar.mp4] [skala]
// Tanpa argumen ketiga: video bisu (musik + efek). Pratinjau bingkai: node motion/penjelas/demo.mjs --lembar folder
import fs from "node:fs";
import path from "node:path";
import templat from "./kapal-mengapung.js";
import { renderVideo } from "../render.js";

if (process.argv[2] === "--lembar") {
  const { createCanvas } = await import("@napi-rs/canvas");
  const { siapkanFont } = await import("../engine.js");
  await siapkanFont(await import("@napi-rs/canvas"));
  const folder = process.argv[3] || "prev"; fs.mkdirSync(folder, { recursive: true });
  const spec = templat.bangun({}), waktu = (process.argv[4] || "1,3,5,8,12,15,18,21,25,28,32,38").split(",").map(Number);
  const cv = createCanvas(720, 1280), g = cv.getContext("2d");
  for (const t of waktu) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.textAlign = "left"; g.textBaseline = "alphabetic";
    spec.gambar(g, t); fs.writeFileSync(path.join(folder, `t${String(t).padStart(2, "0")}.png`), cv.toBuffer("image/png"));
  }
  console.log("ok", waktu.length);
} else {
  const keluar = process.argv[2] || "penjelas-kapal.mp4", skala = Number(process.argv[3] || 1.5);
  const t0 = Date.now();
  const r = await renderVideo({ templat, templatId: templat.id, isi: {}, hook: "Besi tenggelam, kapal tidak?", teaser: "Pelajaran hari ini di video panjang", teaserLabel: "TONTON JUGA", keluar, skala });
  console.log(`${r.durasi.toFixed(1)} dtk ${r.lebar}x${r.tinggi} ${((Date.now() - t0) / 1000).toFixed(0)} dtk render`);
}
