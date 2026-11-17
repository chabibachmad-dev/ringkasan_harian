// Membuat latihan-matematika.html (satu berkas, tanpa pustaka luar) untuk uji di browser/ponsel.
import { build } from "esbuild"; import { writeFileSync } from "node:fs";
const kode = `
import { bukaLatihanMatematika } from "./ui.js";
const q = new URLSearchParams(location.search);
const bahasa = q.get("bahasa") === "en" ? "en" : "id";
const log = []; const papan = document.getElementById("log");
bukaLatihanMatematika({ tempat: document.getElementById("app"), bahasa, pemain: q.get("pemain") || "demo", kelas: q.get("kelas") ? Number(q.get("kelas")) : undefined,
  onPoin: (p, info) => { log.push({ p, info }); window.__poin = log; papan.textContent = "Poin demo (dikirim ke onPoin): " + log.reduce((a, x) => a + x.p, 0); } });
document.getElementById("tema").onclick = () => { const d = document.documentElement; d.dataset.theme = d.dataset.theme === "dark" ? "light" : "dark"; };
`;
const r = await build({ stdin: { contents: kode, resolveDir: ".", loader: "js" }, bundle: true, minify: true, format: "iife", write: false, target: "es2020" });
const js = r.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Latihan Matematika</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#16161d}html[data-theme="dark"] body{background:#111116;color:#f2f2f6}
@media (prefers-color-scheme:dark){html:not([data-theme="light"]) body{background:#111116;color:#f2f2f6}}
#bar{display:flex;gap:10px;align-items:center;padding:8px 16px;font-size:12px;opacity:.8}#bar button{font:inherit;padding:4px 10px;border-radius:8px;border:1px solid currentColor;background:none;color:inherit}</style></head>
<body><div id="bar"><span id="log">Poin demo (dikirim ke onPoin): 0</span><button id="tema" type="button">Terang/Gelap</button></div><div id="app"></div><script>${js}</script></body></html>`;
writeFileSync("latihan-matematika.html", html); console.log("ok", Math.round(html.length / 1024) + " KB");
