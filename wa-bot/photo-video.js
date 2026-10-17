// ================================================================
// FOTO HIDUP: foto -> video pendek dengan gerak kamera + efek (salju, hujan, debu, kunang-kunang, bintang, konfeti, ...).
// Gratis & lokal: efek digambar oleh kode Node (frame RGBA setengah resolusi dialirkan ke ffmpeg), ffmpeg menggerakkan foto,
// menambah nuansa warna, tulisan, dan fade, lalu menulis MP4 H.264. Tanpa API, tanpa kunci, tanpa paket tambahan.
//
// Dipakai lewat video-gen.js (makeFromPhoto): grup WA ("bot, jadikan video dengan salju" + foto), chat pemilik, Telegram.
// ================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const FPS = 25;
export const DEFAULT_SECONDS = 8;
export const MIN_SECONDS = 4;

// ---------------------------------------------------------------- mengenali permintaan
const VIDEO_WORD = "video|vidio|bideo|klip|reels?|animasi|gif|film|story";
const MAKE_VERB = "di(?:jadi(?:kan)?|ubah|buat(?:kan)?|bikin(?:kan)?|ganti(?:kan)?)|jadi(?:kan|in)?|menjadi|ubah(?:lah|kan|in)?|buat(?:kan|in|lah)?|bikin(?:kan|in)?|ganti(?:kan)?|edit(?:kan)?|convert|konversi|ubahin|ubah|change|turn|make|create|transform";
const ALIVE_RE = /\b(?:animasi(?:kan)?|animate|hidupkan|hidupin|gerakkan|gerakin|bring(?:\s+\w+)?\s+to\s+life)\b/i;
const MAKE_VIDEO_RE = new RegExp(`\\b(?:${MAKE_VERB})\\b.{0,60}?\\b(?:${VIDEO_WORD})\\b`, "i");
const VIDEO_FROM_RE = new RegExp(`\\b(?:${VIDEO_WORD})\\s+(?:dari|dr|pakai|memakai|dengan|untuk)\\s+(?:foto|gambar|pic|photo|image)`, "i");
const THIS_PHOTO_RE = /\b(?:foto|gambar|photo|image|pic)(?:nya)?\s+(?:ini|itu|tadi|tersebut)\b/i;
const SLASH_VIDEO_RE = /^\/(?:video|vidio|vid)(?:@\w+)?(?:\s+|$)/i;

const stripEmoji = (s) => String(s ?? "").replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

export const EFFECT_KEYWORDS = {
  snow: /\b(?:salju|snow|bersalju)\b/i,
  rain: /\b(?:hujan|rain|gerimis|berhujan)\b/i,
  dust: /\b(?:debu|dust|partikel|particles?|serbuk)\b/i,
  fireflies: /\b(?:kunang|firefl)\w*/i,
  stars: /\b(?:bintang|stars?|starry|berbintang)\b/i,
  confetti: /\b(?:konfeti|confetti|perayaan|pesta|ulang tahun|ultah|birthday)\b/i,
  bubbles: /\b(?:gelembung|bubbles?|balon sabun)\b/i,
  embers: /\b(?:bara|ember|percikan|sparks?|api unggun|api)\b/i,
  mist: /\b(?:kabut|mist|fog|berkabut|embun|misty)\b/i,
  rays: /\b(?:sinar|cahaya|light rays?|sun ?rays?|matahari|golden|bersinar)\b/i,
  leaves: /\b(?:daun|leaves|leaf|gugur|musim gugur|autumn)\b/i,
  petals: /\b(?:sakura|kelopak|petals?|bunga|blossom)\b/i,
  sparkle: /\b(?:kilau|berkilau|berkilauan|glitter|sparkle|gemerlap|bling|berkelip)\b/i
};
export const EFFECT_NAMES = Object.keys(EFFECT_KEYWORDS);
export const DEFAULT_EFFECTS = ["dust", "rays"];

const MOTION_KEYWORDS = [
  ["zoomout", /\b(?:zoom ?out|menjauh|perkecil|mundur)\b/i],
  ["zoomin", /\b(?:zoom ?in|mendekat|perbesar|maju)\b/i],
  ["panleft", /\b(?:(?:geser|pan|bergeser|menggeser)\s*(?:ke\s*)?kiri|pan left)\b/i],
  ["panright", /\b(?:(?:geser|pan|bergeser|menggeser)\s*(?:ke\s*)?kanan|pan right)\b/i],
  ["panup", /\b(?:(?:geser|pan|tilt)\s*(?:ke\s*)?atas|tilt up|naik)\b/i],
  ["handheld", /\b(?:goyang|bergoyang|handheld|getar|shake|natural)\b/i]
];
const GRADE_KEYWORDS = [
  ["bw", /\b(?:hitam ?putih|black ?(?:and|&)? ?white|monokrom|monochrome|b\/?w)\b/i],
  ["vintage", /\b(?:jadul|vintage|retro|klasik|tempo dulu|sepia|lawas)\b/i],
  ["cinematic", /\b(?:sinematik|cinematic|film|dramatis|dramatic|bioskop)\b/i],
  ["warm", /\b(?:hangat|warm|senja|sunset|golden hour|oranye)\b/i],
  ["cool", /\b(?:dingin|cool|biru|malam|night|sejuk)\b/i]
];
const FORMAT_KEYWORDS = [
  ["portrait", /\b(?:vertikal|vertical|portrait|story|reels?|tiktok|status)\b/i],
  ["square", /\b(?:persegi|square|kotak)\b/i],
  ["landscape", /\b(?:horizontal|landscape|lebar|layar lebar|youtube)\b/i]
];

/** Opsi dari kalimat bebas: { seconds, title, effects[], motion, grade, format, noEffects }. */
export function parsePhotoOptions(text, { maxSeconds = 15 } = {}) {
  const t = String(text ?? "");
  const low = t.toLowerCase();
  let seconds = DEFAULT_SECONDS;
  const d = /\b(\d{1,3})\s*(detik|dtk|second|sec|menit|min)\b/i.exec(low);
  if (d) seconds = /^(menit|min)/i.test(d[2]) ? Number(d[1]) * 60 : Number(d[1]);
  seconds = Math.max(MIN_SECONDS, Math.min(maxSeconds, Math.round(seconds)));
  // tulisan: teks di dalam tanda kutip (lurus/miring); "tanpa tulisan" mematikannya
  let title = "";
  const q = /["“”„«]([^"“”„«»]{2,80})["“”»]/.exec(t) || /\b(?:bertuliskan|tulisan|tuliskan|judul|caption|teks|text)\s*[:=]?\s*'([^']{2,80})'/i.exec(t);
  if (q) title = stripEmoji(q[1]).slice(0, 60);
  const noEffects = /\b(?:tanpa|no|nggak pakai|ga pakai|jangan pakai)\s+(?:efek|effects?|partikel)\b/i.test(low);
  const effects = [];
  if (!noEffects) for (const name of EFFECT_NAMES) if (EFFECT_KEYWORDS[name].test(low)) effects.push(name);
  const motion = (MOTION_KEYWORDS.find(([, re]) => re.test(low)) || [])[0] || "zoomin";
  const grade = (GRADE_KEYWORDS.find(([, re]) => re.test(low)) || [])[0] || "";
  const format = (FORMAT_KEYWORDS.find(([, re]) => re.test(low)) || [])[0] || "";
  return { seconds, title, effects: effects.slice(0, 3), motion, grade, format, noEffects };
}

/**
 * Teks -> { text, needsImage } bila ini permintaan MENGHIDUPKAN FOTO (foto -> video), selain itu null.
 * hasImage = pesan membawa foto atau membalas foto. Tanpa foto: harus menyebut "foto ini ..." (needsImage:true).
 */
export function detectPhotoVideoRequest(text, { hasImage = false } = {}) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const slash = SLASH_VIDEO_RE.test(t);
  const wants = slash || ALIVE_RE.test(t) || MAKE_VIDEO_RE.test(t) || VIDEO_FROM_RE.test(t);
  if (!wants) return null;
  if (hasImage) return { text: t.replace(SLASH_VIDEO_RE, ""), needsImage: false };
  // tanpa foto: hanya bila jelas menunjuk foto ("foto ini jadikan video", "animasikan foto ini", "video dari foto")
  if (!slash && (THIS_PHOTO_RE.test(t) || VIDEO_FROM_RE.test(t) || /\b(?:animasi(?:kan)?|hidupkan|hidupin)\s+(?:foto|gambar)/i.test(t))) return { text: t, needsImage: true };
  return null;
}

// ---------------------------------------------------------------- penggambar efek (kode murni, deterministik)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => x * x * (3 - 2 * x);

/** "over" biasa (alpha lurus) satu piksel. a: 0..1 */
function put(buf, pw, ph, x, y, r, g, b, a) {
  if (a <= 0.004 || x < 0 || y < 0 || x >= pw || y >= ph) return;
  const i = (y * pw + x) * 4;
  const da = buf[i + 3] / 255;
  const oa = a + da * (1 - a);
  const k = da * (1 - a);
  buf[i] = (r * a + buf[i] * k) / oa;
  buf[i + 1] = (g * a + buf[i + 1] * k) / oa;
  buf[i + 2] = (b * a + buf[i + 2] * k) / oa;
  buf[i + 3] = oa * 255;
}
function disc(buf, pw, ph, cx, cy, rad, col, alpha, soft = 0.7) {
  const x0 = Math.floor(cx - rad - 1);
  const x1 = Math.ceil(cx + rad + 1);
  const y0 = Math.floor(cy - rad - 1);
  const y1 = Math.ceil(cy + rad + 1);
  const inner = rad * (1 - soft);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > rad) continue;
      const f = d <= inner ? 1 : 1 - (d - inner) / (rad - inner + 1e-6);
      put(buf, pw, ph, x, y, col[0], col[1], col[2], alpha * f);
    }
}
function line(buf, pw, ph, x0, y0, x1, y1, col, alpha) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const x = x0 + (x1 - x0) * f;
    const y = y0 + (y1 - y0) * f;
    put(buf, pw, ph, Math.floor(x), Math.floor(y), col[0], col[1], col[2], alpha * (0.55 + 0.45 * f));
  }
}
function ellipse(buf, pw, ph, cx, cy, a, b, ang, col, alpha) {
  const R = Math.ceil(Math.max(a, b)) + 1;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = (dx * ca + dy * sa) / a;
      const v = (-dx * sa + dy * ca) / b;
      const d = u * u + v * v;
      if (d <= 1) put(buf, pw, ph, x, y, col[0], col[1], col[2], alpha * (d > 0.7 ? 1 - (d - 0.7) / 0.3 * 0.6 : 1));
    }
}
function star4(buf, pw, ph, cx, cy, size, col, alpha) {
  for (let i = -size; i <= size; i++) {
    const f = 1 - Math.abs(i) / (size + 1);
    put(buf, pw, ph, Math.round(cx + i), Math.round(cy), col[0], col[1], col[2], alpha * f);
    put(buf, pw, ph, Math.round(cx), Math.round(cy + i), col[0], col[1], col[2], alpha * f);
  }
  disc(buf, pw, ph, cx, cy, Math.max(1, size * 0.35), col, alpha, 0.9);
}

// kisi nilai acak berulang (untuk kabut): hash -> 0..1
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Medan alpha halus: dihitung di kisi kasar (step px) lalu di-interpolasi bilinear -- murah dan tanpa kotak-kotak. */
function drawField(buf, pw, ph, fn, col, step = 8) {
  const gw = Math.ceil(pw / step) + 2;
  const gh = Math.ceil(ph / step) + 2;
  const g = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j * gw + i] = fn(i * step, j * step);
  for (let y = 0; y < ph; y++) {
    const gy = y / step;
    const j = Math.floor(gy);
    const fy = gy - j;
    for (let x = 0; x < pw; x++) {
      const gx = x / step;
      const i = Math.floor(gx);
      const fx = gx - i;
      const a = g[j * gw + i];
      const b = g[j * gw + i + 1];
      const c = g[(j + 1) * gw + i];
      const d = g[(j + 1) * gw + i + 1];
      const v = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      if (v > 0.004) put(buf, pw, ph, x, y, col[0], col[1], col[2], v);
    }
  }
}

const rnd = (r, a, b) => a + (b - a) * r();
const CONFETTI = [[255, 99, 132], [54, 162, 235], [255, 206, 86], [75, 192, 120], [153, 102, 255], [255, 159, 64]];
const LEAF_COLS = [[214, 120, 40], [190, 80, 30], [160, 130, 40], [120, 150, 50]];
const PETAL_COLS = [[255, 190, 205], [255, 170, 190], [255, 215, 225]];

/** Satu efek -> { draw(t, buf) }. Posisi = fungsi waktu t (detik), jadi tidak ada keadaan yang perlu disimpan. */
function makeEffect(name, pw, ph, rng) {
  const u = pw / 640; // skala ukuran agar sama di semua orientasi
  const W = pw;
  const H = ph;
  switch (name) {
    case "snow": {
      const fl = Array.from({ length: Math.round(150 * (pw * ph) / 230400 + 40) }, () => ({ x: rnd(rng, 0, W), y: rnd(rng, 0, H), r: rnd(rng, 1.1, 3.6) * u, ph: rnd(rng, 0, 6.28), sw: rnd(rng, 0.6, 1.6) }));
      return { draw: (t, buf) => { for (const f of fl) { const vy = (14 + f.r * 9 / u) * u; const y = ((f.y + vy * t) % (H + 8 * u)) - 4 * u; const x = (((f.x + Math.sin(t * f.sw + f.ph) * 14 * u + 6 * u * t) % W) + W) % W; disc(buf, pw, ph, x, y, f.r, [255, 255, 255], 0.55 + 0.4 * (f.r / (3.6 * u)), 0.8); } } };
    }
    case "rain": {
      const dr = Array.from({ length: Math.round(260 * (pw * ph) / 230400 + 60) }, () => ({ x: rnd(rng, -20, W), y: rnd(rng, 0, H), len: rnd(rng, 10, 22) * u, v: rnd(rng, 300, 480) * u, a: rnd(rng, 0.35, 0.65) }));
      return { draw: (t, buf) => { for (const d of dr) { const y = ((d.y + d.v * t) % (H + d.len)) - d.len * 0.2; const x = ((d.x + 60 * u * t * 0.12) % (W + 20)); line(buf, pw, ph, x, y, x - d.len * 0.18, y - d.len, [200, 215, 235], d.a); } } };
    }
    case "dust": {
      const m = Array.from({ length: Math.round(130 * (pw * ph) / 230400 + 30) }, () => ({ x: rnd(rng, 0, W), y: rnd(rng, 0, H), r: rnd(rng, 1.1, 3) * u, ph: rnd(rng, 0, 6.28), f: rnd(rng, 0.4, 1.3), vx: rnd(rng, -5, 8) * u, vy: rnd(rng, -9, 2) * u }));
      return { draw: (t, buf) => { for (const p of m) { const x = (((p.x + p.vx * t + Math.sin(t * p.f + p.ph) * 6 * u) % W) + W) % W; const y = (((p.y + p.vy * t + Math.cos(t * p.f * 0.8 + p.ph) * 5 * u) % H) + H) % H; const a = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * p.f * 1.7 + p.ph)); disc(buf, pw, ph, x, y, p.r, [255, 244, 220], a, 0.9); } } };
    }
    case "fireflies": {
      const ff = Array.from({ length: Math.round(26 * (pw * ph) / 230400 + 8) }, () => ({ x: rnd(rng, 0, W), y: rnd(rng, H * 0.25, H), ax: rnd(rng, 10, 40) * u, ay: rnd(rng, 8, 26) * u, f1: rnd(rng, 0.2, 0.6), f2: rnd(rng, 0.2, 0.7), p1: rnd(rng, 0, 6.28), p2: rnd(rng, 0, 6.28), f3: rnd(rng, 0.6, 1.6), p3: rnd(rng, 0, 6.28) }));
      return { draw: (t, buf) => { for (const f of ff) { const x = f.x + Math.sin(t * f.f1 + f.p1) * f.ax; const y = f.y + Math.sin(t * f.f2 + f.p2) * f.ay; const pulse = clamp(0.5 + 0.6 * Math.sin(t * f.f3 + f.p3), 0, 1); if (pulse < 0.04) continue; disc(buf, pw, ph, x, y, (3 + 5 * pulse) * u, [255, 240, 130], 0.22 * pulse, 0.2); disc(buf, pw, ph, x, y, 1.5 * u, [255, 252, 200], 0.85 * pulse, 0.6); } } };
    }
    case "stars": {
      const st = Array.from({ length: Math.round(70 * (pw * ph) / 230400 + 20) }, () => ({ x: rnd(rng, 0, W), y: rnd(rng, 0, H * 0.7), r: rnd(rng, 0.7, 1.9) * u, ph: rnd(rng, 0, 6.28), f: rnd(rng, 0.5, 2.2), big: rng() < 0.18 }));
      return { draw: (t, buf) => { for (const s of st) { const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.f + s.ph)); if (s.big) star4(buf, pw, ph, s.x, s.y, Math.round(4 * u + 2 * a), [255, 255, 245], a * 0.9); else disc(buf, pw, ph, s.x, s.y, s.r, [255, 255, 245], a, 0.8); } } };
    }
    case "confetti": {
      const c = Array.from({ length: Math.round(90 * (pw * ph) / 230400 + 30) }, () => ({ x: rnd(rng, 0, W), y: rnd(rng, 0, H), v: rnd(rng, 40, 95) * u, sw: rnd(rng, 0.8, 2.2), ph: rnd(rng, 0, 6.28), sp: rnd(rng, 2, 7), col: CONFETTI[Math.floor(rng() * CONFETTI.length)], w: rnd(rng, 5, 9) * u, h: rnd(rng, 3, 5) * u }));
      return { draw: (t, buf) => { for (const p of c) { const y = ((p.y + p.v * t) % (H + 12 * u)) - 6 * u; const x = (((p.x + Math.sin(t * p.sw + p.ph) * 18 * u) % W) + W) % W; const wob = Math.abs(Math.cos(t * p.sp + p.ph)); const hw = Math.max(0.6, p.w * wob); for (let yy = 0; yy < p.h; yy++) for (let xx = -hw / 2; xx < hw / 2; xx++) put(buf, pw, ph, Math.floor(x + xx), Math.floor(y + yy), p.col[0], p.col[1], p.col[2], 0.95); } } };
    }
    case "bubbles": {
      const b = Array.from({ length: Math.round(26 * (pw * ph) / 230400 + 8) }, () => ({ x: rnd(rng, 0, W), y: rnd(rng, 0, H), r: rnd(rng, 4, 14) * u, v: rnd(rng, 14, 38) * u, ph: rnd(rng, 0, 6.28), f: rnd(rng, 0.6, 1.4) }));
      return { draw: (t, buf) => { for (const p of b) { const y = H + p.r - (((p.v * t + p.y) % (H + 2 * p.r))); const x = p.x + Math.sin(t * p.f + p.ph) * 10 * u; for (let yy = Math.floor(y - p.r - 1); yy <= Math.ceil(y + p.r + 1); yy++) for (let xx = Math.floor(x - p.r - 1); xx <= Math.ceil(x + p.r + 1); xx++) { const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y); if (d > p.r || d < p.r - 1.4 * u) continue; put(buf, pw, ph, xx, yy, 225, 240, 255, 0.5); } disc(buf, pw, ph, x - p.r * 0.38, y - p.r * 0.38, Math.max(1, p.r * 0.2), [255, 255, 255], 0.8, 0.8); } } };
    }
    case "embers": {
      const L = 3.2;
      const e = Array.from({ length: Math.round(70 * (pw * ph) / 230400 + 20) }, () => ({ x: rnd(rng, 0, W), off: rnd(rng, 0, L), vy: rnd(rng, 30, 80) * u, ph: rnd(rng, 0, 6.28), r: rnd(rng, 1.4, 3.2) * u, fl: rnd(rng, 4, 11) }));
      return { draw: (t, buf) => { for (const p of e) { const age = (t + p.off) % L; const k = age / L; const x = p.x + Math.sin(age * 3 + p.ph) * 9 * u + age * 6 * u; const y = H - age * p.vy - 4 * u; const flick = 0.65 + 0.35 * Math.sin(t * p.fl + p.ph); disc(buf, pw, ph, x, y, p.r * (1.6 - 0.6 * k), [255, 150 - 90 * k, 40 - 20 * k], (1 - k) * flick * 0.95, 0.5); disc(buf, pw, ph, x, y, p.r * 3, [255, 120, 30], (1 - k) * flick * 0.2, 0.2); } } };
    }
    case "leaves":
    case "petals": {
      const cols = name === "leaves" ? LEAF_COLS : PETAL_COLS;
      const lv = Array.from({ length: Math.round(34 * (pw * ph) / 230400 + 12) }, () => ({ x: rnd(rng, 0, W), y: rnd(rng, 0, H), v: rnd(rng, 22, 55) * u, sw: rnd(rng, 0.5, 1.3), ph: rnd(rng, 0, 6.28), sp: rnd(rng, 0.8, 2.6), col: cols[Math.floor(rng() * cols.length)], a: rnd(rng, 3.6, 6.2) * u, b: rnd(rng, 2, 3.2) * u }));
      return { draw: (t, buf) => { for (const p of lv) { const y = ((p.y + p.v * t) % (H + 14 * u)) - 7 * u; const x = (((p.x + Math.sin(t * p.sw + p.ph) * 26 * u + 10 * u * t) % W) + W) % W; ellipse(buf, pw, ph, x, y, p.a, p.b * (0.5 + 0.5 * Math.abs(Math.cos(t * p.sp + p.ph))) + 0.4, t * p.sp + p.ph, p.col, 0.92); } } };
    }
    case "sparkle": {
      const sp = Array.from({ length: 22 }, () => ({ x: rnd(rng, 0, W), y: rnd(rng, 0, H), T: rnd(rng, 1.4, 3.2), ph: rng(), s: rnd(rng, 4, 9) * u }));
      return { draw: (t, buf) => { for (const s of sp) { const k = (t / s.T + s.ph) % 1; if (k > 0.3) continue; const a = Math.sin((k / 0.3) * Math.PI); star4(buf, pw, ph, s.x, s.y, Math.max(2, Math.round(s.s * a)), [255, 252, 235], 0.95 * a); } } };
    }
    case "mist": {
      const seed = Math.floor(rng() * 1e6);
      return { draw: (t, buf) => drawField(buf, pw, ph, (x, y) => { const n = vnoise(x / (150 * u) + t * 0.05, y / (90 * u), seed) * 0.65 + vnoise(x / (70 * u) - t * 0.08, y / (45 * u) + 7, seed + 1) * 0.35; return clamp((n - 0.35) * 0.62, 0, 0.34) * (0.55 + 0.45 * (y / ph)); }, [232, 238, 244]) };
    }
    case "rays": {
      return { draw: (t, buf) => drawField(buf, pw, ph, (x, y) => { const s = Math.sin(((x * 0.82 + y * 0.57) / (42 * u)) + t * 0.45) * 0.5 + Math.sin(((x * 0.82 + y * 0.57) / (17 * u)) - t * 0.3) * 0.25; const fall = clamp(1 - (x / pw) * 0.55 - (y / ph) * 0.65, 0, 1); return clamp(s, 0, 1) * fall * 0.34 * (0.8 + 0.2 * Math.sin(t * 0.6)); }, [255, 232, 176], 6) };
    }
    default:
      return null;
  }
}

/** Gabungan efek -> { draw(frameIndex, buf) }; buf = RGBA pw*ph (dibersihkan di sini). */
export function createEffects(names, pw, ph, { seed = 12345 } = {}) {
  const list = [];
  const order = ["mist", "rays"]; // medan lembut di bawah, partikel di atas
  const sorted = [...new Set(names)].sort((a, b) => (order.includes(b) ? 1 : 0) - (order.includes(a) ? 1 : 0));
  sorted.forEach((n, i) => {
    const fx = makeEffect(n, pw, ph, mulberry32(seed + i * 7919));
    if (fx) list.push(fx);
  });
  return {
    count: list.length,
    draw(frame, buf) {
      buf.fill(0);
      const t = frame / FPS;
      for (const fx of list) fx.draw(t, buf);
    }
  };
}

// ---------------------------------------------------------------- ffmpeg
const GRADES = {
  warm: "eq=saturation=1.12:contrast=1.05,colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.06:bm=-0.06",
  cool: "colorbalance=rs=-0.06:bs=0.1:rm=-0.05:bm=0.08,eq=saturation=0.95",
  cinematic: "eq=contrast=1.12:saturation=1.08:gamma=0.97,colorbalance=rs=-0.04:bs=0.06:rh=0.06:bh=-0.04",
  bw: "hue=s=0,eq=contrast=1.1",
  vintage: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,noise=alls=9:allf=t"
};

/** Kanvas keluaran menurut bentuk foto/permintaan. -> { W, H } (kelipatan 4). */
export function canvasFor(iw, ih, format = "") {
  const ratio = iw / Math.max(1, ih);
  const f = format || (ratio >= 1.25 ? "landscape" : ratio <= 0.8 ? "portrait" : "square");
  if (f === "portrait") return { W: 720, H: 1280, format: f };
  if (f === "square") return { W: 960, H: 960, format: f };
  return { W: 1280, H: 720, format: "landscape" };
}

/** Ukuran foto di dalam kanvas: menutup penuh (dipotong tipis) bila bentuknya hampir sama, jika tidak muat utuh di atas latar blur. */
export function fitPhoto(iw, ih, W, H) {
  const cover = Math.max(W / iw, H / ih);
  const cropX = (iw * cover - W) / (iw * cover);
  const cropY = (ih * cover - H) / (ih * cover);
  if (cropX <= 0.1 && cropY <= 0.1) return { FW: W, FH: H, cover: true };
  const s = Math.min(W / iw, H / ih);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { FW: even(iw * s), FH: even(ih * s), cover: false };
}

export function motionExprs(motion, N) {
  const c = { x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)/2" };
  switch (motion) {
    case "zoomout":
      return { z: `1.15-0.15*on/${N}`, ...c };
    case "panleft":
      return { z: "1.13", x: `(iw-iw/zoom)*(1-on/${N})`, y: c.y };
    case "panright":
      return { z: "1.13", x: `(iw-iw/zoom)*on/${N}`, y: c.y };
    case "panup":
      return { z: "1.13", x: c.x, y: `(ih-ih/zoom)*(1-on/${N})` };
    case "handheld":
      return { z: "1.07+0.02*sin(on/37)", x: `${c.x}+iw*0.008*sin(on/11)`, y: `${c.y}+ih*0.006*sin(on/13+1)` };
    default:
      return { z: `1+0.15*on/${N}`, ...c };
  }
}

const esc = (p) => String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

/** Argumen ffmpeg: foto (+ aliran efek RGBA di stdin bila ada) -> MP4. */
export function photoArgs({ photo, out, iw, ih, seconds, motion, grade, format, hasFx, fxW, fxH, titleFile = null, font = "" }) {
  const { W, H } = canvasFor(iw, ih, format);
  const { FW, FH, cover } = fitPhoto(iw, ih, W, H);
  const N = Math.max(2, Math.round(seconds * FPS));
  const m = motionExprs(motion, N);
  const fgScale = cover ? `scale=${FW * 2}:${FH * 2}:force_original_aspect_ratio=increase,crop=${FW * 2}:${FH * 2}` : `scale=${FW * 2}:${FH * 2}`;
  const parts = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=30:luma_power=2,eq=brightness=-0.1:saturation=1.1,setsar=1[bg]`,
    `[1:v]${fgScale},zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${N}:s=${FW}x${FH}:fps=${FPS},setsar=1[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p${GRADES[grade] ? "," + GRADES[grade] : ""}[base]`
  ];
  let last = "base";
  if (hasFx) {
    parts.push(`[2:v]scale=${W}:${H}:flags=bilinear,format=rgba,setsar=1[fx]`);
    parts.push(`[base][fx]overlay=format=auto:shortest=1,format=yuv420p[withfx]`);
    last = "withfx";
  }
  let tail = `[${last}]vignette=angle=PI/${grade === "cinematic" || grade === "vintage" ? 4 : 6}`;
  if (titleFile) {
    const fs = Math.round(Math.min(W, H) * 0.062);
    tail += `,drawtext=${font ? `fontfile='${esc(font)}':` : ""}textfile='${esc(titleFile)}':expansion=none:fontsize=${fs}:fontcolor=white:borderw=${Math.max(2, Math.round(fs / 14))}:bordercolor=black@0.55:shadowx=2:shadowy=2:shadowcolor=black@0.4:line_spacing=10:x=(w-text_w)/2:y=h*0.80-text_h/2:alpha='min(1,max(0,(t-0.8)/0.9))'`;
  }
  tail += `,fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, seconds - 0.6).toFixed(2)}:d=0.6[v]`;
  parts.push(tail);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", String(FPS), "-t", seconds.toFixed(2), "-i", photo, "-i", photo];
  if (hasFx) args.push("-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${fxW}x${fxH}`, "-framerate", String(FPS), "-i", "pipe:0");
  args.push("-filter_complex", parts.join(";"), "-map", "[v]", "-frames:v", String(N), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out);
  return args;
}

/** Jalankan proses; bila frames > 0, tulis frame RGBA ke stdin. -> { code, stderr } */
export function runProc(cmd, args, { timeoutMs = 120_000, spawnImpl = spawn, frames = 0, frameBytes = 0, fill = null } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(cmd, args, { stdio: [frames ? "pipe" : "ignore", "pipe", "pipe"] });
    } catch (e) {
      return reject(e);
    }
    const err = [];
    let closed = false;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* abaikan */
      }
      closed = true;
      reject(Object.assign(new Error("ffmpeg terlalu lama"), { code: "timeout" }));
    }, timeoutMs);
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", (d) => {
      err.push(d);
      if (err.length > 400) err.splice(0, 200);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      closed = true;
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      closed = true;
      resolve({ code, stderr: Buffer.concat(err).toString("utf8") });
    });
    if (frames) {
      child.stdin.on("error", () => {});
      (async () => {
        const buf = new Uint8Array(frameBytes);
        for (let i = 0; i < frames && !closed; i++) {
          fill(i, buf);
          if (!child.stdin.write(Buffer.from(buf))) {
            await new Promise((res) => {
              const done = () => {
                child.stdin.off("drain", done);
                child.off("close", done);
                res();
              };
              child.stdin.once("drain", done);
              child.once("close", done);
            });
          }
        }
        try {
          child.stdin.end();
        } catch {
          /* sudah ditutup */
        }
      })().catch(() => {});
    }
  });
}

export async function probeSize(ffmpeg, file, opts = {}) {
  const r = await runProc(ffmpeg, ["-hide_banner", "-nostdin", "-i", file], { timeoutMs: 20_000, ...opts });
  const m = /Video:.*?, (\d{2,5})x(\d{2,5})/.exec(r.stderr);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/** Bungkus judul: baris <= width huruf, maks 3 baris. */
export function wrapTitle(text, width = 22) {
  const words = stripEmoji(text).split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).join("\n");
}

/**
 * Foto (Buffer) + opsi -> { buffer, seconds, width, height, effects, motion, grade }.
 * Melempar Error dengan .kind = "badimage" | "render".
 */
export async function buildPhotoVideo(photoBuffer, options, { ffmpeg = "ffmpeg", spawnImpl = spawn, tmpRoot, font = "", log = console, stepTimeoutMs = 240_000, onStage = () => {} } = {}) {
  if (!Buffer.isBuffer(photoBuffer) || photoBuffer.length < 100) throw Object.assign(new Error("Fotonya kosong."), { kind: "badimage" });
  const dir = fs.mkdtempSync(path.join(tmpRoot, "pvid-"));
  try {
    const raw = path.join(dir, "asli.bin");
    fs.writeFileSync(raw, photoBuffer);
    const photo = path.join(dir, "foto.png");
    // dibakukan: diputar sesuai EXIF, maks 2400 px sisi terpanjang (tanpa diperbesar), PNG
    const nr = await runProc(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-frames:v", "1", "-vf", "scale=w='min(2400,iw)':h='min(2400,ih)':force_original_aspect_ratio=decrease:flags=lanczos", photo], { timeoutMs: 60_000, spawnImpl });
    if (nr.code !== 0 || !fs.existsSync(photo)) throw Object.assign(new Error(`Fotonya tidak bisa dibaca: ${nr.stderr.replace(/\s+/g, " ").slice(-120)}`), { kind: "badimage" });
    const size = await probeSize(ffmpeg, photo, { spawnImpl });
    if (!size || size.w < 16 || size.h < 16) throw Object.assign(new Error("Ukuran foto tidak terbaca."), { kind: "badimage" });
    const { W, H } = canvasFor(size.w, size.h, options.format);
    const effects = options.noEffects ? [] : options.effects?.length ? options.effects : DEFAULT_EFFECTS;
    const fxW = W / 2;
    const fxH = H / 2;
    const fx = createEffects(effects, fxW, fxH, { seed: photoBuffer.length * 31 + options.seconds });
    const hasFx = fx.count > 0;
    let titleFile = null;
    if (options.title) {
      titleFile = path.join(dir, "judul.txt");
      fs.writeFileSync(titleFile, wrapTitle(options.title, W > H ? 30 : 20), "utf8");
    }
    const N = Math.max(2, Math.round(options.seconds * FPS));
    const out = path.join(dir, "foto-hidup.mp4");
    onStage("render");
    const base = { photo, out, iw: size.w, ih: size.h, seconds: options.seconds, motion: options.motion, grade: options.grade, format: options.format, hasFx, fxW, fxH };
    const run = (title) => runProc(ffmpeg, photoArgs({ ...base, titleFile: title, font }), { timeoutMs: stepTimeoutMs, spawnImpl, frames: hasFx ? N : 0, frameBytes: fxW * fxH * 4, fill: hasFx ? (i, buf) => fx.draw(i, buf) : null });
    let r = await run(titleFile);
    if (r.code !== 0 && titleFile) {
      log.warn?.(`🎞️ [FotoHidup] drawtext gagal, dibuat tanpa tulisan: ${r.stderr.slice(-160)}`);
      r = await run(null);
    }
    if (r.code !== 0) throw Object.assign(new Error(`ffmpeg foto hidup: ${r.stderr.replace(/\s+/g, " ").slice(-220)}`), { kind: "render" });
    let buffer = fs.readFileSync(out);
    if (buffer.length > 15 * 1024 * 1024) {
      const small = path.join(dir, "kecil.mp4");
      const rs = await runProc(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", out, "-vf", `scale=${Math.round(W * 0.66 / 2) * 2}:-2`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-an", "-movflags", "+faststart", small], { timeoutMs: stepTimeoutMs, spawnImpl });
      if (rs.code === 0) buffer = fs.readFileSync(small);
    }
    if (buffer.length < 2000) throw Object.assign(new Error("Video hasil kosong."), { kind: "render" });
    return { buffer, mime: "video/mp4", seconds: options.seconds, width: W, height: H, effects, motion: options.motion, grade: options.grade || "", title: options.title || "" };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* sisa folder sementara tidak fatal */
    }
  }
}
