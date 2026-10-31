// Mesin animasi motion graphic: fungsi gambar murni di atas kanvas 2D (720x1280 logis).
// Dipakai oleh semua templat. Tanpa Chromium: dirender dengan @napi-rs/canvas (lihat render.js).
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export const W = 720;
export const H = 1280;

// ---------- matematika & easing ----------
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const P = (t, a, b) => clamp((t - a) / (b - a)); // progres 0..1 antara detik a dan b
export const lerp = (a, b, k) => a + (b - a) * k;
export const eo = (x) => 1 - Math.pow(1 - x, 3);
export const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const eb = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
/** Efek "membal" untuk skala: 0 sebelum a, lalu melompat melewati 1 dan mengendap di 1. */
export const pop = (t, a, b) => (t < a ? 0 : Math.max(0.0001, eb(P(t, a, b))));

// ---------- tema warna (satu per hari) ----------
export const THEMES = {
  navy:   { bg: "#0B1626", bg2: "#10223A", ink: "#F4F1E8", dim: "#8FA3BF", a1: "#FFC857", a2: "#4ECDC4", a3: "#FF6B8B", ok: "#4ADE80", bad: "#FF6B6B" },
  plum:   { bg: "#1A1030", bg2: "#2A1850", ink: "#F6F0FF", dim: "#A99BCB", a1: "#FFD166", a2: "#7BDFF2", a3: "#FF8FB1", ok: "#6EE7A0", bad: "#FF6B7A" },
  forest: { bg: "#0C1F1A", bg2: "#12332A", ink: "#F2F6EE", dim: "#93B3A5", a1: "#F9C74F", a2: "#90E0C0", a3: "#F4845F", ok: "#7EE787", bad: "#FF7B6B" },
  ink:    { bg: "#14161C", bg2: "#1F232D", ink: "#F5F5F0", dim: "#9AA3B2", a1: "#FF9F43", a2: "#54D2D2", a3: "#FF6F91", ok: "#5EEAA0", bad: "#FF6B6B" },
  ocean:  { bg: "#06222E", bg2: "#0B3A4D", ink: "#EAF7FA", dim: "#8CB8C6", a1: "#FFD23F", a2: "#3DDC97", a3: "#FF7A90", ok: "#3DDC97", bad: "#FF6F6F" },
  wine:   { bg: "#240E18", bg2: "#3A1626", ink: "#FBEFF2", dim: "#C39AA8", a1: "#FFC857", a2: "#6FD3C9", a3: "#FF8A8A", ok: "#79E5A6", bad: "#FF7A7A" },
  dusk:   { bg: "#101A3A", bg2: "#1D2C5E", ink: "#F3F1FF", dim: "#9FA9D6", a1: "#FFB84D", a2: "#5EE6C8", a3: "#FF7DA8", ok: "#63E6A5", bad: "#FF6D7D" }
};

// ---------- font ----------
const here = path.dirname(fileURLToPath(import.meta.url));
let fontsReady = false;
export async function siapkanFont(canvasLib) {
  if (fontsReady) return;
  const { GlobalFonts } = canvasLib;
  const dir = path.join(here, "fonts");
  for (const [file, fam] of [["Inter-Black.otf", "InterMG"], ["Inter-ExtraBold.otf", "InterMG"], ["Inter-Bold.otf", "InterMG"]]) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, fam);
  }
  fontsReady = true;
}
export const FONT = "InterMG, Inter, 'DejaVu Sans', sans-serif";
export const font = (weight, size) => `${weight} ${size}px ${FONT}`;

// ---------- latar & bingkai ----------
export function latar(g, t, th) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, th.bg); gr.addColorStop(1, th.bg2);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(143,163,191,0.12)";
  const off = (t * 8) % 48;
  for (let y = -48; y < H + 48; y += 48) for (let x = -48; x < W + 48; x += 48) {
    g.beginPath(); g.arc(x + off * 0.5, y + off, 2, 0, 6.283); g.fill();
  }
}
export function bingkai(g, t, dur, th, label = "BELAJAR BARENG") {
  g.save();
  g.globalAlpha = eo(P(t, 0.1, 0.6));
  g.fillStyle = th.a1; g.fillRect(48, 70, 10, 10);
  g.fillStyle = th.dim; g.font = font(700, 24); g.textAlign = "left"; g.textBaseline = "middle";
  g.letterSpacing = "4px"; g.fillText(label, 70, 76); g.letterSpacing = "0px";
  g.restore();
  g.fillStyle = "rgba(143,163,191,0.2)"; g.fillRect(48, H - 70, W - 96, 6);
  g.fillStyle = th.a1; g.fillRect(48, H - 70, (W - 96) * clamp(t / dur), 6);
}

// ---------- bentuk ----------
export function kotak(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr); g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr); g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
export function kartu(g, x, y, w, h, { r = 22, fill = "rgba(255,255,255,0.07)", stroke = null, lw = 3 } = {}) {
  kotak(g, x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
export function lingkaran(g, cx, cy, r, { fill = null, stroke = null, lw = 8, prog = 1, rot = 0 } = {}) {
  if (fill) { g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill(); }
  if (stroke && prog > 0) {
    g.strokeStyle = stroke; g.lineWidth = lw; g.lineCap = "round";
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2 + rot, -Math.PI / 2 + rot + Math.PI * 2 * clamp(prog)); g.stroke();
  }
}

// ---------- teks ----------
/** Pecah teks menjadi baris yang muat dalam maxW. Mengembalikan array baris. */
export function bungkus(g, teks, maxW, fnt) {
  g.font = fnt;
  const kata = String(teks).replace(/\s+/g, " ").trim().split(" ");
  const baris = []; let cur = "";
  for (const k of kata) {
    const coba = cur ? cur + " " + k : k;
    if (g.measureText(coba).width <= maxW || !cur) cur = coba; else { baris.push(cur); cur = k; }
  }
  if (cur) baris.push(cur);
  return baris;
}
/** Kecilkan ukuran huruf sampai teks muat dalam maksBaris baris. Mengembalikan {size, baris}. */
export function muatkan(g, teks, maxW, weight, size, maksBaris, minSize = 26) {
  let s = size;
  for (;;) {
    const baris = bungkus(g, teks, maxW, font(weight, s));
    if (baris.length <= maksBaris || s <= minSize) return { size: s, baris };
    s -= 2;
  }
}
/**
 * Paragraf yang masuk kata demi kata (meluncur dari kanan). Mengembalikan y bawah paragraf.
 * opsi: x, y (baris pertama, garis dasar), maxW, size, weight, color, t0, gap, align, maksBaris, lineH, out
 */
export function paragraf(g, t, teks, o) {
  const { x = 48, y, maxW = W - 96, weight = 800, color = "#fff", t0 = 0, gap = 0.08, align = "left", maksBaris = 4, dur = 0.5, out = null } = o;
  const m = muatkan(g, teks, maxW, weight, o.size || 52, maksBaris);
  const lh = o.lineH || Math.round(m.size * 1.22);
  g.font = font(weight, m.size); g.textBaseline = "alphabetic"; g.textAlign = "left";
  const sp = g.measureText(" ").width;
  let n = 0;
  m.baris.forEach((b, bi) => {
    const ws = b.split(" ");
    const wd = ws.map((w) => g.measureText(w).width);
    const total = wd.reduce((a, c) => a + c, 0) + sp * (ws.length - 1);
    let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    ws.forEach((w, i) => {
      const p = eo(clamp((t - (t0 + n * gap)) / dur));
      let a = p; if (out != null) a *= 1 - eo(P(t, out, out + 0.4));
      if (a > 0) {
        g.save(); g.globalAlpha = a; g.fillStyle = color; g.fillText(w, cx + (1 - p) * 60, y + bi * lh); g.restore();
      }
      cx += wd[i] + sp; n++;
    });
  });
  return y + (m.baris.length - 1) * lh;
}
/** Teks tunggal dengan transisi muncul/naik. */
export function teks(g, t, s, x, y, o = {}) {
  const { size = 48, weight = 800, color = "#fff", align = "center", t0 = 0, dur = 0.45, rise = 28, alpha = 1, skala = 1, baseline = "alphabetic" } = o;
  const p = eo(clamp((t - t0) / dur));
  if (p <= 0 || alpha <= 0) return;
  g.save(); g.globalAlpha = p * alpha; g.fillStyle = color; g.font = font(weight, size);
  g.textAlign = align; g.textBaseline = baseline;
  g.translate(x, y + (1 - p) * rise); if (skala !== 1) g.scale(skala, skala);
  g.fillText(s, 0, 0); g.restore();
}
/** Teks dengan efek membal (pusat di x,y). */
export function teksPop(g, t, s, x, y, t0, o = {}) {
  const { size = 60, weight = 900, color = "#fff", maxW = 0 } = o;
  const k = pop(t, t0, t0 + 0.5); if (k <= 0) return;
  g.save(); g.translate(x, y); g.scale(k, k);
  g.fillStyle = color; g.font = font(weight, size); g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(s, 0, 0, maxW || undefined); g.restore();
}
/** Label kecil berbentuk pil. */
export function pil(g, t, s, cx, cy, t0, th, { warna = null, size = 24 } = {}) {
  const k = pop(t, t0, t0 + 0.45); if (k <= 0) return;
  g.save(); g.translate(cx, cy); g.scale(k, k);
  g.font = font(800, size); g.letterSpacing = "3px";
  const w = g.measureText(s).width + 56, h = size + 28;
  kotak(g, -w / 2, -h / 2, w, h, h / 2); g.fillStyle = warna || th.a1; g.fill();
  g.fillStyle = "#101820"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s, 0, 2);
  g.letterSpacing = "0px"; g.restore();
}

// ---------- format angka (Indonesia) ----------
export function fmtAngka(n, desimal = 0) {
  const s = Number(n).toFixed(desimal);
  const [i, d] = s.split(".");
  const ribuan = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return d ? `${ribuan},${d}` : ribuan;
}

// ---------- pembantu templat ----------
/** Buat daftar efek suara. kind: whoosh|pop|tick|bell|thud|chime|buzz|tada. */
export function efek(...daftar) { return daftar.map(([t, k, o]) => ({ t, k, ...(o || {}) })); }

/** Jatuhkan teks panjang ke batas aman (untuk jaga-jaga isi dari AI terlalu panjang). */
export function potong(s, maks) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > maks ? s.slice(0, maks - 1).trimEnd() + "…" : s;
}
