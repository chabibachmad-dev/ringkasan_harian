// ================================================================
// ANIMASI KARAKTER TANPA WAJAH (cerita bertokoh + narasi), digambar dan digerakkan sepenuhnya oleh kode.
//
// Tanpa API video, tanpa GPU: tiap frame dilukis di Node (penggambar SDF beranti-alias, RGBA) lalu dialirkan ke
// ffmpeg yang menumpuknya di atas latar adegan (gambar AI atau latar buatan kode), menambah subtitle, fade, dan
// gerak kamera halus. Karakter bergaya datar: kepala polos tanpa mata/hidung/mulut (sesuai gaya "tanpa wajah"),
// tersusun dari kepala, badan, lengan 2 ruas, kaki 2 ruas. Setiap aksi (jalan, lambai, tunjuk, bicara, lompat, duduk,
// tepuk tangan, membungkuk, sedih, bersorak, berpikir, berdoa, lari) adalah FUNGSI WAKTU murni -> pose sendi, jadi hasilnya
// deterministik dan bisa diuji.
//
// File ini hanya "mesin gambar"; pembuatan naskah, latar AI, suara, dan perakitan akhir ada di video-gen.js.
// ================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";
import { runProc } from "./photo-video.js";

export const FPS = 25;
export const W = 1280;
export const H = 720;
export const GROUND = Math.round(H * 0.765); // garis tapak kaki
export const BASE_K = 380; // piksel per "satuan tinggi" orang dewasa
export const CAM_ZOOM = 0.06; // gerak kamera: zoom 1.00 <-> 1.06 sepanjang adegan
export const BLEND_SEC = 0.3; // peralihan antar aksi
export const STOP_STEP = 3; // gaya stop motion: tiap gambar ditahan 3 frame (25/3 ≈ 8,3 gambar per detik)

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const PI2 = Math.PI * 2;

// ---------------------------------------------------------------- warna
export const COLOR_WORDS = {
  "biru tua": [35, 55, 100], navy: [35, 55, 100], "dark blue": [35, 55, 100],
  "biru muda": [125, 185, 232], "light blue": [125, 185, 232], "sky blue": [125, 185, 232],
  "hijau tua": [30, 100, 60], "dark green": [30, 100, 60],
  "hijau muda": [140, 205, 130], "light green": [140, 205, 130],
  "merah muda": [238, 140, 175], "merah jambu": [238, 140, 175],
  "merah marun": [120, 35, 50], maroon: [120, 35, 50],
  merah: [200, 55, 55], red: [200, 55, 55],
  biru: [47, 109, 181], blue: [47, 109, 181],
  hijau: [60, 150, 90], green: [60, 150, 90],
  kuning: [238, 193, 60], yellow: [238, 193, 60],
  oranye: [235, 140, 50], jingga: [235, 140, 50], orange: [235, 140, 50],
  ungu: [130, 80, 170], violet: [130, 80, 170], purple: [130, 80, 170],
  pink: [238, 140, 175],
  cokelat: [130, 85, 55], coklat: [130, 85, 55], brown: [130, 85, 55],
  hitam: [38, 40, 48], black: [38, 40, 48],
  putih: [242, 242, 238], white: [242, 242, 238],
  abu: [140, 145, 152], "abu-abu": [140, 145, 152], gray: [140, 145, 152], grey: [140, 145, 152],
  krem: [236, 222, 190], cream: [236, 222, 190], beige: [226, 208, 170],
  tosca: [40, 160, 160], teal: [40, 160, 160], emas: [212, 170, 60], gold: [212, 170, 60]
};
const COLOR_KEYS = Object.keys(COLOR_WORDS).sort((a, b) => b.length - a.length);

/** "#aabbcc" / "biru tua" / "dark blue" -> [r,g,b]; tidak dikenali -> fallback. */
export function parseColor(word, fallback) {
  const w = String(word ?? "").trim().toLowerCase();
  if (!w) return fallback;
  const hex = /^#?([0-9a-f]{6})$/.exec(w);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
  for (const key of COLOR_KEYS) if (w.includes(key)) return COLOR_WORDS[key];
  return fallback;
}
const shade = (c, f) => [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];

const SKINS = { light: [240, 200, 160], medium: [227, 176, 135], dark: [168, 112, 78] };

// ---------------------------------------------------------------- tipe karakter
export const KINDS = ["pria", "wanita", "anak", "kakek", "nenek"];
const LOOKS = {
  pria: { k: 1, legL: 0.47, torsoL: 0.29, headRx: 0.063, headRy: 0.075, shR: 0.115, hipR: 0.095, upper: 0.15, fore: 0.14, armR: 0.034, legR: 0.05, stoop: 0, hair: "short", hairCol: [34, 30, 30], top: [47, 109, 181], bottom: [52, 60, 76], skirt: false, hat: "none", hijab: false },
  wanita: { k: 0.95, legL: 0.46, torsoL: 0.28, headRx: 0.06, headRy: 0.072, shR: 0.1, hipR: 0.095, upper: 0.145, fore: 0.135, armR: 0.031, legR: 0.046, stoop: 0, hair: "none", hairCol: [34, 30, 30], top: [150, 70, 130], bottom: [150, 70, 130], skirt: true, hat: "none", hijab: true, hijabCol: [240, 200, 90] },
  anak: { k: 0.68, legL: 0.42, torsoL: 0.27, headRx: 0.086, headRy: 0.098, shR: 0.108, hipR: 0.095, upper: 0.14, fore: 0.13, armR: 0.036, legR: 0.052, stoop: 0, hair: "short", hairCol: [30, 26, 26], top: [235, 140, 50], bottom: [60, 90, 150], skirt: false, hat: "none", hijab: false },
  kakek: { k: 0.95, legL: 0.46, torsoL: 0.29, headRx: 0.062, headRy: 0.073, shR: 0.112, hipR: 0.095, upper: 0.148, fore: 0.138, armR: 0.034, legR: 0.05, stoop: 0.13, hair: "white", hairCol: [236, 236, 232], top: [120, 150, 110], bottom: [90, 70, 60], skirt: false, hat: "peci", hijab: false },
  nenek: { k: 0.9, legL: 0.45, torsoL: 0.28, headRx: 0.059, headRy: 0.07, shR: 0.1, hipR: 0.095, upper: 0.14, fore: 0.13, armR: 0.031, legR: 0.045, stoop: 0.1, hair: "none", hairCol: [236, 236, 232], top: [110, 130, 175], bottom: [110, 130, 175], skirt: true, hat: "none", hijab: true, hijabCol: [235, 235, 228] }
};

/** Kata bebas dari AI -> salah satu KINDS + penanda perempuan. */
export function normalizeKind(word) {
  const w = String(word ?? "").toLowerCase();
  if (/kakek|grandfather|grandpa|\bopa\b/.test(w)) return { kind: "kakek", female: false };
  if (/nenek|grandmother|grandma|\boma\b/.test(w)) return { kind: "nenek", female: true };
  if (/gadis|girl|putri|anak perempuan|adik perempuan/.test(w)) return { kind: "anak", female: true };
  if (/anak|child|kid|boy|bocah|adik|murid|siswa|santri/.test(w)) return { kind: "anak", female: false };
  if (/wanita|perempuan|ibu|woman|mother|mom|bunda|guru perempuan|ustadzah/.test(w)) return { kind: "wanita", female: true };
  return { kind: "pria", female: false };
}

const DEFAULT_TOPS = [[47, 109, 181], [60, 150, 90], [200, 100, 60], [130, 80, 170]];
const DEFAULT_BOTTOMS = [[52, 60, 76], [70, 70, 90], [90, 70, 60]];

/** Spesifikasi dari AI -> karakter siap gambar. index = urutan dalam daftar pemeran (memberi warna bawaan berbeda). */
export function makeCharacter(spec = {}, index = 0) {
  const { kind, female } = normalizeKind(spec.kind || spec.type || spec.role || "");
  const base = LOOKS[kind];
  const ch = { ...base, kind, id: String(spec.id ?? `c${index}`), name: String(spec.name ?? "").slice(0, 24) };
  if (kind === "pria" || kind === "anak") {
    ch.top = DEFAULT_TOPS[index % DEFAULT_TOPS.length];
    ch.bottom = DEFAULT_BOTTOMS[index % DEFAULT_BOTTOMS.length];
  }
  if (kind === "anak" && female) {
    ch.skirt = true;
    ch.hair = "bob";
    ch.bottom = ch.top;
  }
  const skinKey = String(spec.skin ?? "").toLowerCase();
  ch.skin = SKINS[/dark|gelap|sawo|hitam/.test(skinKey) ? "dark" : /light|terang|putih|cerah/.test(skinKey) ? "light" : "medium"];
  const top = parseColor(spec.shirt ?? spec.top ?? spec.dress ?? spec.clothes, null);
  const bottom = parseColor(spec.pants ?? spec.bottom ?? spec.skirt, null);
  if (top) {
    ch.top = top;
    if (ch.skirt) ch.bottom = top;
  }
  if (bottom && !ch.skirt) ch.bottom = bottom;
  ch.hairCol = parseColor(spec.hair, ch.hairCol);
  if (ch.hijab) ch.hijabCol = parseColor(spec.hijabColor ?? spec.hijab_color ?? (typeof spec.hijab === "string" ? spec.hijab : ""), ch.hijabCol);
  if (spec.hijab === true || (typeof spec.hijab === "string" && /^(true|ya|yes|1)$/i.test(spec.hijab))) {
    ch.hijab = true;
    ch.hijabCol = ch.hijabCol || [240, 200, 90];
  } else if (spec.hijab === false && kind !== "wanita" && kind !== "nenek") ch.hijab = false;
  const hat = String(spec.hat ?? "").toLowerCase();
  if (/peci|kopiah|songkok/.test(hat)) ch.hat = "peci";
  else if (/topi|cap|hat/.test(hat)) ch.hat = "topi";
  else if (/^(none|tidak|no|tanpa)$/.test(hat)) ch.hat = "none";
  ch.hatCol = parseColor(spec.hatColor ?? spec.hat_color, ch.hat === "peci" ? [30, 30, 34] : [200, 60, 60]);
  ch.kpx = BASE_K * ch.k;
  ch.heightPx = Math.round(ch.kpx * (ch.legL + ch.torsoL + 0.02 + 2 * ch.headRy + 0.03));
  return ch;
}

// ---------------------------------------------------------------- penggambar SDF (RGBA lurus, di-"over")
function put(buf, x, y, r, g, b, a) {
  if (a <= 0.004 || x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const da = buf[i + 3] / 255;
  if (a >= 0.996 && da < 0.004) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
    return;
  }
  const oa = a + da * (1 - a);
  const k = da * (1 - a);
  buf[i] = (r * a + buf[i] * k) / oa;
  buf[i + 1] = (g * a + buf[i + 1] * k) / oa;
  buf[i + 2] = (b * a + buf[i + 2] * k) / oa;
  buf[i + 3] = oa * 255;
}

/** Penggambar dengan kamera sederhana: zoom z di sekitar (cx,cy). Semua koordinat masukan = koordinat "dunia" (piksel). */
export function createPainter(buf, cam = { z: 1, cx: W / 2, cy: H / 2 }) {
  const z = cam.z;
  const X = (x) => cam.cx + (x - cam.cx) * z;
  const Y = (y) => cam.cy + (y - cam.cy) * z;
  const bbOf = (x0, y0, x1, y1) => [x0, y0, x1, y1];

  const api = {
    z,
    cone(a, b, r1, r2) {
      const ax = X(a[0]), ay = Y(a[1]), bx = X(b[0]), by = Y(b[1]);
      const R1 = r1 * z, R2 = r2 * z;
      let dx = bx - ax, dy = by - ay;
      const h = Math.hypot(dx, dy) || 1e-6;
      dx /= h;
      dy /= h;
      const bb = clamp((R1 - R2) / h, -0.999, 0.999);
      const aa = Math.sqrt(1 - bb * bb);
      const pad = Math.max(R1, R2) + 2;
      return {
        bb: bbOf(Math.min(ax, bx) - pad, Math.min(ay, by) - pad, Math.max(ax, bx) + pad, Math.max(ay, by) + pad),
        sd: (x, y) => {
          const px = x - ax, py = y - ay;
          const lx = Math.abs(px * dy - py * dx);
          const ly = px * dx + py * dy;
          const k = -bb * lx + aa * ly;
          if (k < 0) return Math.hypot(lx, ly) - R1;
          if (k > aa * h) return Math.hypot(lx, ly - h) - R2;
          return aa * lx + bb * ly - R1;
        }
      };
    },
    ell(c, rx, ry, ang = 0) {
      const cx = X(c[0]), cy = Y(c[1]);
      const a = rx * z, b = ry * z;
      const co = Math.cos(ang), si = Math.sin(ang);
      const pad = Math.max(a, b) + 2;
      return {
        bb: bbOf(cx - pad, cy - pad, cx + pad, cy + pad),
        sd: (x, y) => {
          const dx = x - cx, dy = y - cy;
          const u = dx * co + dy * si;
          const v = -dx * si + dy * co;
          const k0 = Math.hypot(u / a, v / b);
          const k1 = Math.hypot(u / (a * a), v / (b * b));
          return k1 < 1e-9 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1;
        }
      };
    },
    rbox(c, hw, hh, rad = 0, ang = 0) {
      const cx = X(c[0]), cy = Y(c[1]);
      const w = hw * z, h = hh * z;
      const r = Math.min(rad * z, w, h);
      const co = Math.cos(ang), si = Math.sin(ang);
      const pad = Math.hypot(w, h) + 2;
      return {
        bb: bbOf(cx - pad, cy - pad, cx + pad, cy + pad),
        sd: (x, y) => {
          const dx = x - cx, dy = y - cy;
          const u = Math.abs(dx * co + dy * si) - (w - r);
          const v = Math.abs(-dx * si + dy * co) - (h - r);
          return Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0) - r;
        }
      };
    },
    poly(pts, rad = 0) {
      const P = pts.map((p) => [X(p[0]), Y(p[1])]);
      const n = P.length;
      const r = rad * z;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of P) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      return {
        bb: bbOf(x0 - r - 2, y0 - r - 2, x1 + r + 2, y1 + r + 2),
        sd: (x, y) => {
          let d = (x - P[0][0]) ** 2 + (y - P[0][1]) ** 2;
          let s = 1;
          for (let i = 0, j = n - 1; i < n; j = i, i++) {
            const ex = P[j][0] - P[i][0], ey = P[j][1] - P[i][1];
            const wx = x - P[i][0], wy = y - P[i][1];
            const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1), 0, 1);
            const bx = wx - ex * t, by = wy - ey * t;
            d = Math.min(d, bx * bx + by * by);
            const c1 = y >= P[i][1], c2 = y < P[j][1], c3 = ex * wy > ey * wx;
            if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
          }
          return s * Math.sqrt(d) - r;
        }
      };
    },
    /** A dikurangi B (mis. rambut = kepala besar dikurangi kepala bergeser). */
    sub: (A, B) => ({ bb: A.bb, sd: (x, y) => Math.max(A.sd(x, y), -B.sd(x, y)) }),
    inter: (A, B) => ({ bb: A.bb, sd: (x, y) => Math.max(A.sd(x, y), B.sd(x, y)) }),
    fill(s, col, alpha = 1) {
      const x0 = Math.max(0, Math.floor(s.bb[0])), y0 = Math.max(0, Math.floor(s.bb[1]));
      const x1 = Math.min(W - 1, Math.ceil(s.bb[2])), y1 = Math.min(H - 1, Math.ceil(s.bb[3]));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const c = 0.5 - s.sd(x + 0.5, y + 0.5);
          if (c > 0) put(buf, x, y, col[0], col[1], col[2], alpha * (c > 1 ? 1 : c));
        }
    },
    /** Tepi lembut (bayangan): alpha menurun dari tengah ke tepi sejauh `soft` piksel. */
    soft(s, col, alpha, soft) {
      const sf = soft * z;
      const x0 = Math.max(0, Math.floor(s.bb[0])), y0 = Math.max(0, Math.floor(s.bb[1]));
      const x1 = Math.min(W - 1, Math.ceil(s.bb[2])), y1 = Math.min(H - 1, Math.ceil(s.bb[3]));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const d = s.sd(x + 0.5, y + 0.5);
          if (d < 0) put(buf, x, y, col[0], col[1], col[2], alpha * clamp(-d / sf, 0, 1));
        }
    }
  };
  return api;
}

// ---------------------------------------------------------------- pose: fungsi waktu -> sudut sendi
// Indeks pose: 0 condong badan, 1 miring kepala, 2 naik (loncat), 3 geser panggul, 4-5 kaki jauh (paha, tekuk lutut),
// 6-7 kaki dekat, 8-9 lengan jauh (bahu, tekuk siku), 10-11 lengan dekat, 12 duduk (0..1).
// Sudut dalam radian dari posisi menggantung ke bawah; positif = ke arah hadap.
const P = (o = {}) => [
  o.lean ?? 0, o.tilt ?? 0, o.dy ?? 0, o.dx ?? 0,
  ...(o.fl ?? [0, 0]), ...(o.nl ?? [0, 0]),
  ...(o.fa ?? [0.1, 0.18]), ...(o.na ?? [0.1, 0.18]),
  o.sit ?? 0
];

export const ACTIONS = ["idle", "walk", "run", "wave", "point", "talk", "jump", "sit", "clap", "bow", "sad", "cheer", "think", "pray"];
const ACTION_ALIASES = [
  [/^(idle|diam|stand|berdiri|stay|wait|tunggu)/, "idle"],
  [/^(walk|jalan|berjalan|melangkah|go|move|datang|pergi|masuk|keluar)/, "walk"],
  [/^(run|lari|berlari|kejar)/, "run"],
  [/^(wave|lambai|melambai|salam|greet|sapa|menyapa)/, "wave"],
  [/^(point|tunjuk|menunjuk)/, "point"],
  [/^(talk|speak|bicara|berbicara|bercerita|ngomong|jelaskan|menjelaskan|say|tell)/, "talk"],
  [/^(jump|lompat|melompat|loncat)/, "jump"],
  [/^(sit|duduk)/, "sit"],
  [/^(clap|tepuk|bertepuk)/, "clap"],
  [/^(bow|bungkuk|membungkuk|hormat)/, "bow"],
  [/^(sad|sedih|menangis|cry|kecewa)/, "sad"],
  [/^(cheer|sorak|bersorak|senang|happy|gembira|celebrate|rayakan)/, "cheer"],
  [/^(think|pikir|berpikir|bingung|ponder)/, "think"],
  [/^(pray|doa|berdoa|sholat|salat)/, "pray"]
];
export function normalizeAction(word) {
  const w = String(word ?? "").trim().toLowerCase();
  if (ACTIONS.includes(w)) return w;
  for (const [re, name] of ACTION_ALIASES) if (re.test(w)) return name;
  return "talk";
}

/** Pose satu aksi. tau = detik sejak aksi mulai, D = lama aksi, phase = putaran langkah (siklus) untuk jalan/lari. */
export function actionPose(action, tau, D, phase = 0) {
  const t = tau;
  switch (action) {
    case "walk": {
      const th = PI2 * phase;
      const A = 0.5;
      return P({
        lean: 0.05, tilt: -0.02,
        nl: [A * Math.sin(th), 0.85 * Math.max(0, Math.cos(th))],
        fl: [-A * Math.sin(th), 0.85 * Math.max(0, -Math.cos(th))],
        na: [-0.45 * Math.sin(th) + 0.05, 0.3 + 0.2 * Math.max(0, Math.cos(th))],
        fa: [0.45 * Math.sin(th) + 0.05, 0.3 + 0.2 * Math.max(0, -Math.cos(th))]
      });
    }
    case "run": {
      const th = PI2 * phase;
      const A = 0.85;
      return P({
        lean: 0.2, tilt: -0.04, dy: 0.03 * (1 - Math.cos(2 * th)) / 2,
        nl: [A * Math.sin(th), 1.5 * Math.max(0, Math.cos(th))],
        fl: [-A * Math.sin(th), 1.5 * Math.max(0, -Math.cos(th))],
        na: [-0.85 * Math.sin(th) + 0.1, 1.3],
        fa: [0.85 * Math.sin(th) + 0.1, 1.3]
      });
    }
    case "wave":
      return P({ lean: -0.01, tilt: 0.05 * Math.sin(PI2 * 0.9 * t), na: [2.5, 0.64 + 0.45 * Math.sin(PI2 * 2.6 * t)], fa: [0.08, 0.2] });
    case "point":
      return P({ lean: 0.06, tilt: -0.02, na: [1.5 + 0.06 * Math.sin(PI2 * 1.2 * t), 0.08], fa: [0.1, 0.2] });
    case "jump": {
      const u = ((t / 0.85) % 1 + 1) % 1;
      const air = 4 * u * (1 - u); // 0..1..0
      const crouch = Math.max(0, 1 - u / 0.16, (u - 0.84) / 0.16);
      const squat = [0.9 * crouch + 0.3 * air, 1.8 * crouch + 0.6 * air];
      return P({
        lean: 0.12 * crouch, dy: 0.2 * air,
        nl: squat, fl: squat,
        na: [lerp(0.2, 2.6, air * (1 - crouch)), 0.3], fa: [lerp(0.2, 2.6, air * (1 - crouch)), 0.3]
      });
    }
    case "sit":
      return P({
        sit: 1, lean: 0.02 * Math.sin(PI2 * 0.3 * t), tilt: 0.04 * Math.sin(PI2 * 1.1 * t),
        nl: [1.5, 1.45], fl: [1.5, 1.45],
        na: [0.7 + 0.25 * Math.sin(PI2 * 0.7 * t), 0.9 + 0.3 * Math.sin(PI2 * 1.1 * t + 1)],
        fa: [0.6, 0.8]
      });
    case "clap": {
      const s = Math.sin(PI2 * 3 * t);
      return P({ lean: 0.02, dy: 0.012 * Math.abs(s), na: [1.15 - 0.18 * s, 1.0], fa: [1.15 + 0.18 * s, 1.0] });
    }
    case "bow": {
      const u = clamp(t / Math.max(0.5, D), 0, 1);
      const b = smooth(Math.min(1, u * 3)) * (1 - smooth(Math.max(0, (u - 0.7) / 0.3)));
      return P({ lean: 0.95 * b, tilt: 0.1 * b, dx: -0.06 * b, na: [0.15 + 0.2 * b, 0.1], fa: [0.15 + 0.2 * b, 0.1] });
    }
    case "sad": {
      const b = Math.sin(PI2 * 0.18 * t);
      return P({ lean: 0.2 + 0.01 * b, tilt: 0.38, na: [0.05, 0.12], fa: [0.04, 0.1] });
    }
    case "cheer": {
      const s = Math.sin(PI2 * 3 * t);
      return P({
        lean: -0.03, dy: 0.04 * Math.abs(s), tilt: -0.05,
        nl: [0.12, 0.05], fl: [-0.12, 0.05],
        na: [2.7 + 0.25 * s, 0.1], fa: [2.7 - 0.25 * s, 0.1]
      });
    }
    case "think":
      return P({ lean: 0.03, tilt: 0.1 + 0.02 * Math.sin(PI2 * 0.4 * t), na: [0.5, 2.3], fa: [0.6, 1.5] });
    case "pray":
      return P({ lean: 0.02, tilt: 0.14, na: [0.9, 1.5], fa: [0.9, 1.5] });
    case "talk": {
      return P({
        lean: 0.015 * Math.sin(PI2 * 0.7 * t), tilt: 0.05 * Math.sin(PI2 * 1.6 * t),
        na: [0.5 + 0.35 * Math.sin(PI2 * 0.9 * t) + 0.2 * Math.sin(PI2 * 1.7 * t + 1), 0.9 + 0.4 * Math.sin(PI2 * 1.3 * t + 2)],
        fa: [0.12 + 0.1 * Math.sin(PI2 * 0.6 * t + 1), 0.2]
      });
    }
    default: {
      const b = Math.sin(PI2 * 0.28 * t);
      return P({ lean: 0.012 * b, tilt: 0.03 * Math.sin(PI2 * 0.2 * t + 1), fl: [-0.05, 0], nl: [0.05, 0], na: [0.08 - 0.03 * b, 0.2], fa: [0.1 + 0.03 * b, 0.18] });
    }
  }
}

const NATURAL = { walk: null, run: null, jump: 2, bow: 2.2, clap: 2, wave: 2, point: 2, talk: 3, sit: 3, sad: 2.5, cheer: 2.5, think: 2.5, pray: 2.5, idle: 1.5 };
const STRIDE = { walk: 0.9, run: 1.5 }; // jarak (satuan tinggi) per siklus langkah penuh

/**
 * Rencana gerak satu karakter dalam satu adegan.
 * acts: [{do, to?}], x0/face: posisi awal (0..1 lebar layar) dan arah awal, dur: lama adegan (detik).
 * -> { x(t), dir(t), pose(t), segs }
 */
export function planCharacter(ch, { x0 = 0.5, face = "", acts = [] }, dur) {
  let list = (Array.isArray(acts) ? acts : []).slice(0, 6).map((a) => ({
    act: normalizeAction(a?.do ?? a?.action ?? a),
    to: Number.isFinite(Number(a?.to)) ? clamp(Number(a.to), 0.06, 0.94) : null
  }));
  if (!list.length) list = [{ act: "talk", to: null }];
  let x = clamp(Number(x0), 0.06, 0.94);
  if (!Number.isFinite(x)) x = 0.5;
  const dir = /left|kiri/i.test(face) ? -1 : /right|kanan/i.test(face) ? 1 : x < 0.5 ? 1 : -1;

  // jalan/lari tanpa tujuan = diam bicara; dengan tujuan = bergerak
  const items = list.map((a) => {
    const loco = (a.act === "walk" || a.act === "run") && a.to != null && Math.abs(a.to - x) > 0.02;
    const it = { ...a, loco, from: x, dist: 0, nat: 0 };
    if (loco) {
      it.dist = Math.abs(a.to - x) * W;
      const speed = (a.act === "run" ? 1.6 : 0.8) * ch.kpx;
      it.nat = Math.max(a.act === "run" ? 0.6 : 0.8, it.dist / speed);
      x = a.to;
    } else if (a.act === "walk" || a.act === "run") it.act = "talk";
    if (!it.loco) it.nat = NATURAL[it.act] ?? 2;
    return it;
  });
  const locoNat = items.filter((i) => i.loco).reduce((s, i) => s + i.nat, 0);
  const other = items.filter((i) => !i.loco);
  const total = Math.max(0.5, dur);
  const locoScale = locoNat > total * 0.8 ? (total * 0.8) / locoNat : 1;
  const locoTime = locoNat * locoScale;
  const rem = Math.max(0, total - locoTime);
  const otherNat = other.reduce((s, i) => s + i.nat, 0) || 1;
  if (!other.length && rem > 0.05) items.push({ act: "talk", to: null, loco: false, from: x, dist: 0, nat: rem });
  let t = 0;
  let sCum = 0;
  let curDir = dir;
  const segs = items.map((it, i) => {
    const len = it.loco ? it.nat * locoScale : other.length ? (it.nat / otherNat) * rem : it.nat;
    const seg = { i, act: it.act, loco: it.loco, t0: t, t1: t + len, xa: it.from, xb: it.loco ? it.to : it.from, s0: sCum, dist: it.dist };
    if (it.loco) curDir = it.to > it.from ? 1 : -1;
    seg.dir = curDir;
    sCum += it.dist;
    t += len;
    return seg;
  });

  const segAt = (tt) => {
    for (const s of segs) if (tt < s.t1) return s;
    return segs[segs.length - 1];
  };
  const travel = (s, tt) => {
    if (!s.loco) return { x: s.xa, s: s.s0 };
    const u = clamp((tt - s.t0) / Math.max(1e-6, s.t1 - s.t0), 0, 1);
    const e = 0.7 * u + 0.3 * smooth(u);
    return { x: lerp(s.xa, s.xb, e), s: s.s0 + s.dist * e };
  };
  const phaseOf = (s, tt) => {
    const sTot = travel(s, tt).s;
    return sTot / ((STRIDE[s.act] || STRIDE.walk) * ch.kpx);
  };
  const evalSeg = (s, tt) => actionPose(s.act, tt - s.t0, s.t1 - s.t0, phaseOf(s, tt));

  return {
    segs,
    xAt: (tt) => travel(segAt(tt), tt).x * W,
    dirAt: (tt) => segAt(tt).dir ?? dir,
    actAt: (tt) => segAt(tt).act,
    poseAt(tt) {
      const s = segAt(tt);
      const p = evalSeg(s, tt);
      const tau = tt - s.t0;
      if (s.i > 0 && tau < BLEND_SEC) {
        const prev = segs[s.i - 1];
        const q = actionPose(prev.act, Math.min(tt, prev.t1) - prev.t0, prev.t1 - prev.t0, phaseOf(prev, Math.min(tt, prev.t1)));
        const w = smooth(tau / BLEND_SEC);
        return p.map((v, i) => lerp(q[i], v, w));
      }
      return p;
    }
  };
}

// ---------------------------------------------------------------- menggambar karakter
const BLACK = [10, 10, 14];

/** Gambar satu karakter. st = { x (px dunia), dir (+1/-1), pose }. */
export function drawCharacter(p, ch, st) {
  const k = ch.kpx;
  const pose = st.pose;
  const dir = st.dir >= 0 ? 1 : -1;
  const thigh = ch.legL / 2;
  const shin = ch.legL / 2;
  const footH = 0.03;
  const legs = [[pose[4], pose[5]], [pose[6], pose[7]]];
  let reach = 0;
  for (const [a, b] of legs) reach = Math.max(reach, thigh * Math.cos(a) + shin * Math.cos(a - b));
  const hipV = footH + reach + pose[2];
  const pt = (u, v) => [st.x + dir * u * k, GROUND - v * k];
  const hipU = pose[3];
  const lean = ch.stoop + pose[0];
  const tilt = pose[1];
  const skin = ch.skin;
  const farMul = 0.84;
  const sitting = pose[12] > 0.5;

  // bayangan
  const air = clamp(pose[2] / 0.2, 0, 1);
  p.soft(p.ell([st.x + dir * hipU * k, GROUND + 3], k * 0.19 * (1 - 0.4 * air), k * 0.032 * (1 - 0.4 * air)), [20, 24, 30], 0.28 * (1 - 0.5 * air), k * 0.032);

  // bangku bila duduk
  if (pose[12] > 0.02) {
    const a = clamp(pose[12], 0, 1);
    const top = hipV - 0.045;
    p.fill(p.rbox(pt(hipU - 0.02, top), 0.2 * k, 0.03 * k, 3), [150, 104, 66], a);
    p.fill(p.rbox(pt(hipU - 0.15, top / 2), 0.014 * k, (top / 2) * k, 2), [120, 80, 50], a);
    p.fill(p.rbox(pt(hipU + 0.11, top / 2), 0.014 * k, (top / 2) * k, 2), [120, 80, 50], a);
  }

  const hipPt = (off) => [hipU + off, hipV];
  const legJoints = legs.map(([a, b], i) => {
    const h = hipPt(i === 0 ? -0.022 : 0.022);
    const knee = [h[0] + thigh * Math.sin(a), h[1] - thigh * Math.cos(a)];
    const ankle = [knee[0] + shin * Math.sin(a - b), knee[1] - shin * Math.cos(a - b)];
    return { h, knee, ankle };
  });

  const bottomCol = ch.bottom;
  const drawLeg = (i, far) => {
    const { h, knee, ankle } = legJoints[i];
    const col = far ? shade(bottomCol, farMul) : bottomCol;
    const showLeg = !(ch.skirt && !sitting);
    if (showLeg) {
      p.fill(p.cone(pt(...h), pt(...knee), ch.legR * k, ch.legR * 0.82 * k), col);
      p.fill(p.cone(pt(...knee), pt(...ankle), ch.legR * 0.82 * k, ch.legR * 0.66 * k), col);
    }
    p.fill(p.ell(pt(ankle[0] + 0.035, ankle[1] - 0.008), 0.058 * k, 0.03 * k, 0), far ? shade(BLACK, 1.4) : BLACK);
  };

  // titik badan
  const sinL = Math.sin(lean), cosL = Math.cos(lean);
  const neck = [hipU + ch.torsoL * sinL, hipV + ch.torsoL * cosL];
  const shoulder = [hipU + (ch.torsoL - 0.035) * sinL, hipV + (ch.torsoL - 0.035) * cosL];
  const th = lean + tilt;
  const headC = [neck[0] + (0.004 + ch.headRy) * Math.sin(th), neck[1] + (0.004 + ch.headRy) * Math.cos(th)];
  const headCpx = pt(...headC);
  const ang = dir * th;
  const upV = [dir * Math.sin(th), -Math.cos(th)]; // arah "atas kepala" di layar
  const fwdV = [dir * Math.cos(th), Math.sin(th)]; // arah "depan kepala" di layar
  const at = (c, up, fw) => [c[0] + upV[0] * up + fwdV[0] * fw, c[1] + upV[1] * up + fwdV[1] * fw];
  const rx = ch.headRx * k, ry = ch.headRy * k;

  const drawArm = (i, far) => {
    const [a, b] = i === 0 ? [pose[8], pose[9]] : [pose[10], pose[11]];
    const sh = [shoulder[0] + (i === 0 ? -0.02 : 0.02), shoulder[1]];
    const el = [sh[0] + ch.upper * Math.sin(a), sh[1] - ch.upper * Math.cos(a)];
    const hand = [el[0] + ch.fore * Math.sin(a + b), el[1] - ch.fore * Math.cos(a + b)];
    const col = far ? shade(ch.top, farMul) : ch.top;
    p.fill(p.cone(pt(...sh), pt(...el), ch.armR * k, ch.armR * 0.88 * k), col);
    p.fill(p.cone(pt(...el), pt(...hand), ch.armR * 0.88 * k, ch.armR * 0.76 * k), col);
    p.fill(p.ell(pt(...hand), ch.armR * 0.95 * k, ch.armR * 0.95 * k), far ? shade(skin, farMul) : skin);
  };

  // urutan lukis: lengan jauh, kaki jauh, badan, kaki dekat, kepala, lengan dekat
  drawArm(0, true);
  drawLeg(0, true);
  if (ch.skirt && !sitting) {
    // rok/gamis: trapesium dari pinggang ke ujung, mengayun mengikuti kaki
    const hemV = footH + 0.04;
    const sway = ((legJoints[0].ankle[0] + legJoints[1].ankle[0]) / 2) * 0.7;
    const wU = 0.085 + 0.012;
    const hw = 0.155 + 0.02 * Math.abs(legs[0][0] - legs[1][0]);
    // kaki dekat digambar di belakang rok juga (tertutup)
    drawLeg(1, false);
    p.fill(p.poly([pt(hipU - wU, hipV + 0.06), pt(hipU + wU, hipV + 0.06), pt(hipU + sway + hw, hemV), pt(hipU + sway - hw, hemV)], 0.012 * k), ch.bottom);
  } else {
    p.fill(p.ell(pt(hipU, hipV + 0.01), ch.hipR * k, ch.hipR * 0.9 * k), ch.bottom);
    drawLeg(1, false);
  }
  // badan
  p.fill(p.cone(pt(hipU + 0.06 * sinL, hipV + 0.06 * cosL), pt(...shoulder), ch.hipR * 0.96 * k, ch.shR * k), ch.top);
  // kerudung: jubah di belakang kepala sampai dada
  if (ch.hijab) {
    const chest = [shoulder[0] - 0.01 * sinL, shoulder[1] - 0.07];
    p.fill(p.cone(headCpx, pt(...chest), rx * 1.12, ch.shR * k * 1.04), ch.hijabCol);
  }
  // leher + kepala
  p.fill(p.cone(pt(...shoulder), headCpx, 0.027 * k, 0.027 * k), skin);
  if (ch.hair === "bob" && !ch.hijab) p.fill(p.ell(at(headCpx, -0.2 * ry, -0.22 * rx), rx * 1.0, ry * 1.05, ang), ch.hairCol);
  if (ch.hijab) p.fill(p.ell(at(headCpx, 0, 0), rx * 1.3, ry * 1.18, ang), ch.hijabCol);
  else p.fill(p.ell(headCpx, rx, ry, ang), skin);
  if (ch.hijab) p.fill(p.ell(at(headCpx, -0.04 * ry, 0.11 * rx), rx * 0.82, ry * 0.8, ang), skin);
  // rambut (bulan sabit di atas kepala)
  if (!ch.hijab && ch.hair !== "none") {
    const big = p.ell(headCpx, rx * 1.06, ry * 1.05, ang);
    const cut = p.ell(at(headCpx, -0.38 * ry, 0.2 * rx), rx * 1.04, ry * 0.98, ang);
    p.fill(p.sub(big, cut), ch.hairCol);
    if (ch.hair === "white") p.fill(p.ell(at(headCpx, -0.22 * ry, -0.92 * rx), rx * 0.22, ry * 0.3, ang), ch.hairCol);
  }
  if (!ch.hijab && ch.hat === "peci") {
    const c = at(headCpx, 0.78 * ry, 0);
    p.fill(p.rbox(c, rx * 1.0, ry * 0.36, 3 * (ry / 28), ang), ch.hatCol);
  } else if (!ch.hijab && ch.hat === "topi") {
    const dome = p.inter(p.ell(headCpx, rx * 1.1, ry * 1.12, ang), p.ell(at(headCpx, 1.3 * ry, 0), rx * 2.6, ry * 1.1, ang));
    p.fill(dome, ch.hatCol);
    p.fill(p.rbox(at(headCpx, 0.27 * ry, rx * 1.05), rx * 0.75, ry * 0.09, 2, ang), shade(ch.hatCol, 0.85));
  }
  drawArm(1, false);
}

// ---------------------------------------------------------------- PNG (tanpa pustaka) + latar buatan kode
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** data = Uint8Array w*h*channels (3 = RGB, 4 = RGBA) -> Buffer PNG. */
export function encodePng(w, h, data, channels = 4) {
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

export const SETTINGS = ["day", "sunset", "night", "indoor"];
export function normalizeSetting(word) {
  const w = String(word ?? "").toLowerCase();
  if (/night|malam|bulan|moon/.test(w)) return "night";
  if (/sunset|senja|sore|dusk|evening|fajar|dawn|sunrise/.test(w)) return "sunset";
  if (/indoor|room|ruang|rumah|kelas|class|kamar|dalam|masjid|mosque|kantor|office|dapur|kitchen/.test(w)) return "indoor";
  return "day";
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Latar polos buatan kode (cadangan bila gambar AI tidak ada). -> Uint8Array RGBA 1280x720 buram penuh. */
export function paintBackground(setting = "day", seed = 7) {
  const buf = new Uint8Array(W * H * 4);
  const R = rng(seed);
  const p = createPainter(buf);
  const grad = (y0, y1, c0, c1) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      const f = (y - y0) / Math.max(1, y1 - y0);
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        buf[i] = lerp(c0[0], c1[0], f);
        buf[i + 1] = lerp(c0[1], c1[1], f);
        buf[i + 2] = lerp(c0[2], c1[2], f);
        buf[i + 3] = 255;
      }
    }
  };
  const hills = (base, amp, col, ph) => {
    for (let x = 0; x < W; x++) {
      const y0 = Math.round(base + amp * Math.sin(x * 0.006 + ph) + amp * 0.5 * Math.sin(x * 0.015 + ph * 2.1));
      for (let y = Math.max(0, y0); y < H; y++) {
        const i = (y * W + x) * 4;
        buf[i] = col[0];
        buf[i + 1] = col[1];
        buf[i + 2] = col[2];
        buf[i + 3] = 255;
      }
    }
  };
  const cloud = (cx, cy, s, a) => {
    for (const [dx, dy, rx, ry] of [[0, 0, 70, 30], [-55, 10, 48, 24], [58, 8, 52, 24], [14, -18, 44, 26]]) p.fill(p.ell([cx + dx * s, cy + dy * s], rx * s, ry * s), [255, 255, 255], a);
  };
  if (setting === "indoor") {
    grad(0, 520, [244, 230, 204], [232, 214, 182]);
    grad(520, H, [176, 128, 84], [140, 98, 62]);
    for (let x = 0; x < W; x += 90) for (let y = 520; y < H; y++) for (let d = 0; d < 2; d++) put(buf, x + d, y, 120, 82, 52, 0.35);
    p.fill(p.rbox([640, 520], 640, 6), [200, 180, 150]);
    // jendela
    p.fill(p.rbox([900, 230], 150, 125, 6), [250, 248, 240]);
    for (let y = 120; y < 340; y++) for (let x = 760; x < 1040; x++) { const f = (y - 120) / 220; put(buf, x, y, lerp(150, 215, f), lerp(205, 238, f), 250, 1); }
    p.fill(p.rbox([900, 230], 5, 110), [250, 248, 240]);
    p.fill(p.rbox([900, 230], 140, 5), [250, 248, 240]);
    // bingkai gambar + jam
    p.fill(p.rbox([260, 190], 90, 65, 4), [160, 112, 70]);
    p.fill(p.rbox([260, 190], 78, 53, 2), [200, 226, 210]);
    p.fill(p.ell([260, 205], 40, 16), [120, 175, 140]);
    p.fill(p.ell([560, 150], 34, 34), [250, 248, 240]);
    p.fill(p.ell([560, 150], 29, 29), [240, 236, 224]);
    p.fill(p.rbox([560, 140], 2, 12), [60, 60, 60]);
    p.fill(p.rbox([568, 150], 10, 2), [60, 60, 60]);
    return buf;
  }
  const pal =
    setting === "night"
      ? { sky: [[10, 22, 52], [40, 66, 110]], far: [34, 66, 82], near: [26, 56, 66], ground: [[36, 78, 70], [24, 54, 50]] }
      : setting === "sunset"
        ? { sky: [[96, 78, 150], [255, 176, 110]], far: [128, 110, 140], near: [96, 112, 104], ground: [[112, 150, 96], [74, 108, 72]] }
        : { sky: [[120, 196, 245], [222, 243, 255]], far: [156, 208, 154], near: [112, 180, 112], ground: [[128, 200, 120], [86, 160, 90]] };
  grad(0, 470, pal.sky[0], pal.sky[1]);
  if (setting === "night") {
    for (let i = 0; i < 70; i++) put(buf, Math.floor(R() * W), Math.floor(R() * 380), 255, 250, 220, 0.5 + R() * 0.5);
    p.fill(p.ell([1020, 130], 46, 46), [248, 244, 214]);
    p.fill(p.ell([1038, 120], 40, 40), pal.sky[0].map((v, i) => lerp(v, pal.sky[1][i], 0.25)));
  } else if (setting === "sunset") {
    p.soft(p.ell([860, 440], 190, 190), [255, 214, 140], 0.55, 150);
    p.fill(p.ell([860, 440], 78, 78), [255, 236, 170]);
    cloud(260, 150, 1.1, 0.55);
    cloud(980, 230, 0.8, 0.5);
  } else {
    p.soft(p.ell([1060, 110], 120, 120), [255, 246, 190], 0.5, 90);
    p.fill(p.ell([1060, 110], 52, 52), [255, 243, 176]);
    cloud(240, 130, 1.1, 0.95);
    cloud(640, 210, 0.8, 0.9);
    cloud(1000, 300, 0.7, 0.85);
  }
  hills(430, 22, pal.far, 1.3);
  hills(480, 16, pal.near, 3.1);
  grad(520, H, pal.ground[0], pal.ground[1]);
  return buf;
}

// ---------------------------------------------------------------- naskah cerita bertokoh
export function buildStoryPrompt(idea, n, maxChars) {
  const perScene = Math.max(60, Math.floor(maxChars / n) - 10);
  return {
    system:
      `You write short animated story scripts for a 2D flat cartoon with FACELESS human characters (smooth blank heads, no eyes/nose/mouth). Reply with ONE JSON object only (no markdown, no commentary):\n` +
      `{"title":"...","cast":[{"id":"A","kind":"man","shirt":"blue","pants":"black","hat":"none"}],"scenes":[{"setting":"day","bg":"...","narration":"...","chars":[{"id":"A","x":0.3,"face":"right","acts":[{"do":"walk","to":0.6},{"do":"wave"}]}]}]}\n` +
      `Rules:\n` +
      `- Exactly ${n} scenes telling a clear story (hook, development, ending). Cast: 1 to 3 HUMAN characters (animals/objects cannot be characters: tell animal fables with human characters or only in the narration).\n` +
      `- cast.kind is one of: man, woman, boy, girl, grandfather, grandmother. Optional: shirt, pants, hat (peci, cap, none), hijab (true/false; women/girls may wear hijab), hijab_color, skin (light/medium/dark), hair color. Colors are plain English words.\n` +
      `- scene.setting is one of: day, sunset, night, indoor. scene.bg: ONE English sentence describing an EMPTY background place (landscape/room, no people, no characters, open ground in the lower part). No text/letters/logos.\n` +
      `- scene.chars: which cast members appear, x = start position across the screen (0.1 to 0.9), face = left or right, acts = 1 to 3 actions performed in order. Allowed actions: idle, walk, run, wave, point, talk, jump, sit, clap, bow, sad, cheer, think, pray. "walk"/"run" need "to" (target x 0.1..0.9). Keep characters apart (at least 0.2 in x).\n` +
      `- narration: what the narrator says during the scene, in the SAME language as the user's idea (Indonesian if unclear), natural spoken sentence(s), max ${perScene} characters, no emoji, no scene numbers.\n` +
      `- title: max 6 words, same language as the narration. Keep it family-friendly.`,
    user: `Story idea: ${idea}`
  };
}

const stripEmoji = (s) => String(s ?? "").replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
function cutAtWord(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  const base = sp > max * 0.5 ? cut.slice(0, sp) : cut;
  return base.replace(/[,;:\-–\s]+$/, "") + (/[.!?]$/.test(base) ? "" : ".");
}

/** Jawaban AI -> { title, cast:[spec], scenes:[{setting,bg,narration,chars:[{id,x,face,acts}]}] } atau null. */
export function parseStoryScript(raw, n, maxChars = 620) {
  const text = String(raw ?? "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let j;
  try {
    j = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!j || !Array.isArray(j.scenes) || j.scenes.length < 2) return null;
  let cast = (Array.isArray(j.cast) ? j.cast : []).filter((c) => c && typeof c === "object").slice(0, 3).map((c, i) => ({ ...c, id: String(c.id ?? String.fromCharCode(65 + i)) }));
  if (!cast.length) cast = [{ id: "A", kind: "man" }];
  const ids = new Set(cast.map((c) => c.id));
  const scenes = j.scenes.slice(0, n).map((s, si) => {
    let chars = (Array.isArray(s?.chars) ? s.chars : []).filter((c) => c && ids.has(String(c.id))).slice(0, 3);
    if (!chars.length) chars = [{ id: cast[0].id, x: 0.5, acts: [{ do: "talk" }] }];
    chars = chars.map((c, ci) => ({
      id: String(c.id),
      x: Number.isFinite(Number(c.x)) ? clamp(Number(c.x), 0.1, 0.9) : [0.5, 0.3, 0.7][ci] ?? 0.5,
      face: String(c.face ?? ""),
      acts: (Array.isArray(c.acts) ? c.acts : []).slice(0, 4).map((x) => (typeof x === "string" ? { do: x } : { do: String(x?.do ?? x?.action ?? "talk"), ...(x?.to != null ? { to: Number(x.to) } : {}) }))
    }));
    return { setting: normalizeSetting(s?.setting ?? s?.bg), bg: stripEmoji(s?.bg).slice(0, 260), narration: stripEmoji(s?.narration).slice(0, 220), chars, _i: si };
  });
  let total = scenes.reduce((x, s) => x + s.narration.length, 0);
  if (total > maxChars) {
    const per = Math.floor(maxChars / scenes.length);
    for (const s of scenes) if (s.narration.length > per) s.narration = cutAtWord(s.narration, per);
    total = scenes.reduce((x, s) => x + s.narration.length, 0);
  }
  return { title: stripEmoji(j.title).slice(0, 60), cast, scenes: scenes.map(({ _i, ...rest }) => rest) };
}

/** Cadangan bila AI naskah tidak ada: seorang tokoh masuk, melambai, bercerita (ide menjadi subtitle adegan pertama). */
export function fallbackStory(idea, n) {
  const p = String(idea).slice(0, 300);
  const flows = [
    [{ do: "walk", to: 0.5 }, { do: "wave" }],
    [{ do: "talk" }, { do: "point" }],
    [{ do: "think" }],
    [{ do: "jump" }, { do: "cheer" }],
    [{ do: "talk" }],
    [{ do: "bow" }]
  ];
  return {
    title: "",
    fallback: true,
    cast: [{ id: "A", kind: "man" }],
    scenes: Array.from({ length: n }, (_, i) => ({
      setting: ["day", "day", "sunset", "day", "sunset", "night"][i % 6],
      bg: "",
      narration: i === 0 ? p : "",
      chars: [{ id: "A", x: i === 0 ? 0.15 : 0.5, face: "right", acts: flows[i % flows.length] }]
    }))
  };
}

// ---------------------------------------------------------------- merender satu adegan
const escPath = (p) => String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

export function sceneArgs({ bg, out, dur, camFrom = 1, camTo = 1 + CAM_ZOOM, textFile = null, font = "", style = "" }) {
  const N = Math.max(2, Math.round(dur * FPS));
  const z = `${camFrom.toFixed(4)}+${(camTo - camFrom).toFixed(4)}*on/${N}`;
  const stop = style === "stopmotion";
  let chain =
    `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${W}x${H}:fps=${FPS},setsar=1[bg];`;
  if (stop) {
    // GAYA STOP MOTION / POTONGAN KERTAS: tokoh diberi tepi putih (potongan kertas) + bayangan jatuh, butiran kertas berubah
    // hanya di frame yang "difoto" (8,3 gambar/dtk; tiap gambar ditahan 3 frame), latar ikut membeku di kecepatan yang sama.
    const d = dur.toFixed(2);
    chain +=
      `[1:v]format=rgba,setsar=1,split=2[f0][f1];` +
      `[f0]alphaextract,format=gray,boxblur=3:2,lut=y='if(gte(val,5),255,0)',split=2[m0][m1];` + // tepi putih ±5 px (tanpa filter dilate: tidak ada di semua build ffmpeg)
      `color=c=white:s=${W}x${H}:r=${FPS}:d=${d},format=rgba[wh];[wh][m0]alphamerge[outline];` +
      `[m1]boxblur=6:2,lut=y=val*0.45[sm];` +
      `color=c=black:s=${W}x${H}:r=${FPS}:d=${d},format=rgba[bk];[bk][sm]alphamerge[shadow];` +
      `[bg][shadow]overlay=x=7:y=9:format=auto[b1];[b1][outline]overlay=format=auto[b2];` +
      `[b2][f1]overlay=format=auto:shortest=1,format=yuv420p,eq=contrast=1.05:saturation=1.06,noise=alls=9:allf=t,fps=${FPS}/${STOP_STEP},fps=${FPS}`;
  } else {
    chain += `[1:v]format=rgba,setsar=1[fg];[bg][fg]overlay=format=auto:shortest=1,format=yuv420p`;
  }
  if (textFile) {
    chain += `,drawtext=${font ? `fontfile='${escPath(font)}':` : ""}textfile='${escPath(textFile)}':expansion=none:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=14:line_spacing=8:x=(w-text_w)/2:y=h-text_h-34`;
  }
  const fo = Math.max(0, dur - 0.25).toFixed(2);
  chain += `,fade=t=in:st=0:d=0.25,fade=t=out:st=${fo}:d=0.25[v]`;
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-framerate", String(FPS), "-t", dur.toFixed(2), "-i", bg,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-framerate", String(FPS), "-i", "pipe:0",
    "-filter_complex", chain,
    "-map", "[v]", "-frames:v", String(N), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-profile:v", "main", "-pix_fmt", "yuv420p", "-an",
    out
  ];
}

/**
 * Pemeran adegan -> fungsi menggambar frame ke-i. scene.chars = [{id,x,face,acts}], cast = daftar karakter jadi (makeCharacter).
 * Karakter diurutkan dari yang paling jauh di kiri supaya tumpang tindih konsisten.
 */
export function createSceneRenderer(scene, castMap, dur, { camFrom = 1, camTo = 1 + CAM_ZOOM, style = "" } = {}) {
  const stop = style === "stopmotion";
  let cacheJ = -1;
  let cache = null;
  const N = Math.max(2, Math.round(dur * FPS));
  const actors = scene.chars
    .map((c) => {
      const ch = castMap.get(String(c.id));
      return ch ? { ch, plan: planCharacter(ch, { x0: c.x, face: c.face, acts: c.acts }, dur) } : null;
    })
    .filter(Boolean);
  return {
    frames: N,
    actors,
    draw(i, buf) {
      if (stop) {
        // frame "difoto" tiap STOP_STEP frame; frame di antaranya hanya salinan (ffmpeg juga menahannya)
        const j = Math.floor(i / STOP_STEP);
        if (j === cacheJ && cache) return void buf.set(cache);
        const ii = j * STOP_STEP;
        buf.fill(0);
        const z = camFrom + ((camTo - camFrom) * ii) / N;
        const p = createPainter(buf, { z, cx: W / 2, cy: H / 2 });
        const t = ii / FPS;
        actors.forEach((a, k) => {
          const r = rng(j * 131 + k * 17 + 7);
          // goyangan tangan: posisi dan sendi sedikit berbeda tiap gambar
          const pose = a.plan.poseAt(t).slice();
          pose[0] += (r() - 0.5) * 0.024;
          pose[1] += (r() - 0.5) * 0.024;
          for (const idx of [8, 9, 10, 11]) pose[idx] += (r() - 0.5) * 0.08;
          drawCharacter(p, a.ch, { x: a.plan.xAt(t) + (r() - 0.5) * 3.2, dir: a.plan.dirAt(t), pose });
        });
        cacheJ = j;
        cache = Uint8Array.from(buf);
        return;
      }
      buf.fill(0);
      const z = camFrom + ((camTo - camFrom) * i) / N;
      const p = createPainter(buf, { z, cx: W / 2, cy: H / 2 });
      const t = i / FPS;
      for (const a of actors) drawCharacter(p, a.ch, { x: a.plan.xAt(t), dir: a.plan.dirAt(t), pose: a.plan.poseAt(t) });
    }
  };
}

/**
 * Render satu adegan ke klip MP4 (tanpa suara). bgFile = PNG/JPG latar. -> { code, stderr }
 * Bila drawtext (subtitle) gagal, diulang tanpa subtitle.
 */
export async function renderSceneClip({ scene, castMap, bgFile, out, dur, textFile = null, font = "", camFrom, camTo, style = "", ffmpeg = "ffmpeg", spawnImpl = spawn, timeoutMs = 240_000, log = console }) {
  const rend = createSceneRenderer(scene, castMap, dur, { camFrom, camTo, style });
  const run = (tf) =>
    runProc(ffmpeg, sceneArgs({ bg: bgFile, out, dur, camFrom, camTo, textFile: tf, font, style }), {
      timeoutMs,
      spawnImpl,
      frames: rend.frames,
      frameBytes: W * H * 4,
      fill: (i, buf) => rend.draw(i, buf)
    });
  let r = await run(textFile);
  if (r.code !== 0 && textFile) {
    log.warn?.(`🎭 [Animasi] drawtext gagal, adegan tanpa subtitle: ${r.stderr.slice(-160)}`);
    r = await run(null);
  }
  return r;
}

/** Tulis latar adegan ke berkas: gambar AI (Buffer) bila ada, jika tidak latar buatan kode. -> path. */
export function writeBackground(dir, name, aiImage, setting, seed) {
  if (aiImage?.buffer?.length) {
    const ext = /jpe?g/i.test(aiImage.mime || "") ? "jpg" : /webp/i.test(aiImage.mime || "") ? "webp" : "png";
    const f = `${dir}/${name}.${ext}`;
    fs.writeFileSync(f, aiImage.buffer);
    return f;
  }
  const f = `${dir}/${name}.png`;
  fs.writeFileSync(f, encodePng(W, H, paintBackground(setting, seed), 4));
  return f;
}

const STOP_WORDS = /\b(?:gaya\s+)?(?:stop[\s-]?motion|stopmotion|stopmo|paper[\s-]?cut(?:out)?|potongan\s+kertas|gaya\s+kertas)\b/gi;

/** Kalimat meminta "animasi"/"kartun"/"stop motion" -> animasi karakter; selain itu video gambar biasa. */
export function detectStoryMode(text) {
  const t = String(text ?? "");
  return /\b(?:animasi|animation|animated|kartun|cartoon)\b/i.test(t) || detectStoryStyle(t) === "stopmotion";
}

/** Gaya animasi yang diminta: "stopmotion" (potongan kertas, ±8 gambar/dtk) atau "" (halus, bawaan). */
export function detectStoryStyle(text) {
  return /\b(?:stop[\s-]?motion|stopmotion|stopmo|paper[\s-]?cut(?:out)?|potongan\s+kertas|gaya\s+kertas)\b/i.test(String(text ?? "")) ? "stopmotion" : "";
}

/** Buang kata gaya dari kalimat supaya tidak ikut jadi deskripsi cerita. */
export function stripStoryStyle(text) {
  return String(text ?? "").replace(STOP_WORDS, " ").replace(/\s+/g, " ").replace(/^[\s:,.-]+|[\s:,.-]+$/g, "").trim();
}
