// Ikon "3D" (relief membulat / clay): siluet ikon SVG diubah jadi bidang tinggi lewat jarak-ke-tepi, lalu diberi cahaya, kilap, dan bayangan.
// Murni JS + @napi-rs/canvas (tanpa Chromium/Blender). Ini render 2,5D tampak depan (bukan model 3D penuh); hasilnya JPEG ilustrasi, bukan vektor.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

export const BAHAN = {
  clay: { kilap: 0.18, kekerasan: 24, ambien: 0.42, rim: 0.10 },
  kilap: { kilap: 0.85, kekerasan: 70, ambien: 0.34, rim: 0.18 },
  logam: { kilap: 1.0, kekerasan: 110, ambien: 0.22, rim: 0.28 }
};
// palet: [terang, dasar, gelap]
export const PALET = {
  zamrud: ["#6ee7b7", "#10b981", "#047857"], emas: ["#fde68a", "#f5b942", "#b45309"], nila: ["#a5b4fc", "#6366f1", "#3730a3"],
  koral: ["#fdba74", "#f97316", "#c2410c"], langit: ["#7dd3fc", "#0ea5e9", "#0369a1"], mawar: ["#f9a8d4", "#ec4899", "#9d174d"], krem: ["#fffbeb", "#f1e3c4", "#c9b48a"]
};
export const URUTAN_PALET = ["zamrud", "emas", "langit", "koral", "nila", "mawar"];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// jarak kuadrat Euclid (Felzenszwalb) dari tiap piksel "dalam" ke piksel "luar" terdekat
function edtKuadrat(dalam, w, h) {
  const INF = 1e12, f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = dalam[i] ? INF : 0;
  const n = Math.max(w, h), v = new Int32Array(n), z = new Float32Array(n + 1), d = new Float32Array(n);
  const satu = (get, set, len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s; const fq = get(q) + q * q;
      for (;;) { const p = v[k]; s = (fq - (get(p) + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + get(p); } for (let q = 0; q < len; q++) set(q, d[q]);
  };
  for (let x = 0; x < w; x++) satu((q) => f[q * w + x], (q, val) => { f[q * w + x] = val; }, h);
  for (let y = 0; y < h; y++) satu((q) => f[y * w + q], (q, val) => { f[y * w + q] = val; }, w);
  return f;
}
function kaburKotak(a, w, h, r, lintasan = 2) {
  const t = new Float32Array(a.length);
  for (let p = 0; p < lintasan; p++) {
    for (let y = 0; y < h; y++) { let s = 0, c = 0; const o = y * w; for (let x = -r; x <= r; x++) { if (x >= 0 && x < w) { s += a[o + x]; c++; } } for (let x = 0; x < w; x++) { t[o + x] = s / c; const xa = x + r + 1, xb = x - r; if (xa < w) { s += a[o + xa]; c++; } if (xb >= 0) { s -= a[o + xb]; c--; } } }
    for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let y = -r; y <= r; y++) { if (y >= 0 && y < h) { s += t[y * w + x]; c++; } } for (let y = 0; y < h; y++) { a[y * w + x] = s / c; const ya = y + r + 1, yb = y - r; if (ya < h) { s += t[ya * w + x]; c++; } if (yb >= 0) { s -= t[yb * w + x]; c--; } } }
  }
  return a;
}

/**
 * @param {object} o svg (string), keluar (berkas .jpg), ukuran=2400, palet="zamrud"|[terang,dasar,gelap], bahan="clay"|"kilap"|"logam", latar="terang"|"putih", tonjolan=0.045 (radius lengkung relatif)
 * @returns {Promise<{berkas, lebar, tinggi, mp, ukuranMB}>}
 */
export async function render3d({ svg, keluar, ukuran = 2400, palet = "zamrud", bahan = "clay", latar = "terang", tonjolan = 0.05 }) {
  const S = ukuran, W = S, H = S, mat = BAHAN[bahan] || BAHAN.clay, pal = (Array.isArray(palet) ? palet : PALET[palet] || PALET.zamrud).map(hex);
  const c = createCanvas(W, H), g = c.getContext("2d"), m = Math.round(S * 0.15);
  const img = await loadImage(Buffer.from(svg)); g.drawImage(img, m, m, S - 2 * m, S - 2 * m);
  const rgba = g.getImageData(0, 0, W, H).data, N = W * H, alfa = new Float32Array(N), dalam = new Uint8Array(N);
  for (let i = 0; i < N; i++) { alfa[i] = rgba[i * 4 + 3] / 255; dalam[i] = alfa[i] > 0.5 ? 1 : 0; }
  const D = edtKuadrat(dalam, W, H), R = S * tonjolan, tinggi = new Float32Array(N);
  for (let i = 0; i < N; i++) { if (!dalam[i]) continue; const t = Math.min(Math.sqrt(D[i]) / R, 1), u = 1 - t; tinggi[i] = Math.sqrt(Math.max(0, 1 - u * u)) * R * 1.15; }
  kaburKotak(tinggi, W, H, Math.max(2, Math.round(S / 600)), 2);
  // bayangan lembut di bawah-kanan objek
  const bay = new Float32Array(N), gs = Math.round(S * 0.035), gx = Math.round(S * 0.012);
  for (let y = 0; y < H - gs; y++) for (let x = 0; x < W - gx; x++) bay[(y + gs) * W + x + gx] = alfa[y * W + x];
  kaburKotak(bay, W, H, Math.round(S * 0.022), 3);
  // cahaya
  const L = (() => { const x = -0.5, y = -0.62, z = 0.6, n = Math.hypot(x, y, z); return [x / n, y / n, z / n]; })();
  const Hv = (() => { const x = L[0], y = L[1], z = L[2] + 1, n = Math.hypot(x, y, z); return [x / n, y / n, z / n]; })();
  let ymin = H, ymax = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 8) if (dalam[y * W + x]) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const out = new Uint8ClampedArray(N * 4), bg = latar === "putih" ? [255, 255, 255] : [246, 247, 250], bg2 = latar === "putih" ? [255, 255, 255] : [226, 229, 236];
  const lerp = (a, b, t) => a + (b - a) * t;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, ty = y / H, vg = Math.hypot(x / W - 0.5, y / H - 0.45) * 1.25;
    let r = lerp(bg[0], bg2[0], vg), gg = lerp(bg[1], bg2[1], vg), b = lerp(bg[2], bg2[2], vg);
    const sh = Math.min(1, bay[i] * 0.55); r *= 1 - sh * 0.5; gg *= 1 - sh * 0.5; b *= 1 - sh * 0.5;
    const a = alfa[i];
    if (a > 0) {
      const xl = x > 0 ? x - 1 : x, xr = x < W - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
      let nx = -(tinggi[y * W + xr] - tinggi[y * W + xl]) / 2 * 1.0, ny = -(tinggi[yd * W + x] - tinggi[yu * W + x]) / 2 * 1.0, nz = 1; const nn = Math.hypot(nx, ny, nz); nx /= nn; ny /= nn; nz /= nn;
      const df = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]), sp = Math.pow(Math.max(0, nx * Hv[0] + ny * Hv[1] + nz * Hv[2]), mat.kekerasan) * mat.kilap;
      const rim = Math.pow(1 - nz, 2.2) * mat.rim, tt = ymax > ymin ? Math.min(1, Math.max(0, (y - ymin) / (ymax - ymin))) : ty;
      const warna = tt < 0.5 ? [0, 1, 2].map((k) => lerp(pal[0][k], pal[1][k], tt * 2)) : [0, 1, 2].map((k) => lerp(pal[1][k], pal[2][k], (tt - 0.5) * 2));
      const terang = mat.ambien + (1 - mat.ambien) * df;
      const cr = Math.min(255, warna[0] * terang + 255 * sp + 255 * rim), cg = Math.min(255, warna[1] * terang + 255 * sp + 255 * rim), cb = Math.min(255, warna[2] * terang + 255 * sp + 255 * rim);
      r = lerp(r, cr, a); gg = lerp(gg, cg, a); b = lerp(b, cb, a);
    }
    const o = i * 4; out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = 255;
  }
  const c2 = createCanvas(W, H), g2 = c2.getContext("2d"); g2.putImageData(new (globalThis.ImageData || (await import("@napi-rs/canvas")).ImageData)(out, W, H), 0, 0);
  const buf = await c2.encode("jpeg", 95); fs.mkdirSync(path.dirname(keluar), { recursive: true }); fs.writeFileSync(keluar, buf);
  return { berkas: keluar, lebar: W, tinggi: H, mp: (W * H) / 1e6, ukuranMB: buf.length / 1048576 };
}
