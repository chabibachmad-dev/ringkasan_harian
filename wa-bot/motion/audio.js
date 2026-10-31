// Sintesis musik latar + efek suara (tanpa berkas audio dari luar). Keluaran: dua kanal Float32 44,1 kHz.
import fs from "node:fs";

export const SR = 44100;
const mid = (n) => 440 * Math.pow(2, (n - 69) / 12);

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }

class Mixer {
  constructor(n) { this.n = n; this.L = new Float32Array(n); this.R = new Float32Array(n); }
  tambah(sig, at, pan = 0, gain = 1) {
    const i0 = Math.round(at * SR); if (i0 >= this.n || i0 + sig.length < 0) return;
    const l = Math.cos(((pan + 1) * Math.PI) / 4) * 1.414 * gain, r = Math.sin(((pan + 1) * Math.PI) / 4) * 1.414 * gain;
    const mulai = Math.max(0, -i0);
    for (let i = mulai; i < sig.length && i0 + i < this.n; i++) { this.L[i0 + i] += sig[i] * l; this.R[i0 + i] += sig[i] * r; }
  }
}
const env = (n, a, r) => { const e = new Float32Array(n).fill(1); const na = Math.max(1, Math.round(a * SR)), nr = Math.max(1, Math.round(r * SR)); for (let i = 0; i < na && i < n; i++) e[i] = i / na; for (let i = 0; i < nr && i < n; i++) e[n - 1 - i] *= i / nr; return e; };

// ---------- efek ----------
function whoosh(dur = 0.5, f0 = 300, f1 = 5000, seed = 1) {
  const n = Math.round(dur * SR), r = rng(seed), out = new Float32Array(n); let p = 0;
  for (let i = 0; i < n; i++) {
    const fc = f0 * Math.pow(f1 / f0, i / n), a = Math.exp((-2 * Math.PI * fc) / SR);
    p = (1 - a) * gauss(r) + a * p; out[i] = p * Math.pow(Math.sin((Math.PI * i) / n), 1.5) * 3;
  }
  return out;
}
function pop(f0 = 700, f1 = 260, dur = 0.12) { const n = Math.round(dur * SR), o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t * 35))) / SR; o[i] = Math.sin(ph) * Math.exp(-t * 30); } return o; }
function tick(f = 1500, dur = 0.05) { const n = Math.round(dur * SR), o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; o[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 90); } return o; }
function bell(f = 1318, dur = 1.4) { const n = Math.round(dur * SR), o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; o[i] = (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.01 * t) + 0.25 * Math.sin(2 * Math.PI * f * 3.02 * t)) * Math.exp(-t * 3.2); } return o; }
function thud(dur = 0.4) { const n = Math.round(dur * SR), o = new Float32Array(n); let ph = 0; const r = rng(9); for (let i = 0; i < n; i++) { const t = i / SR; ph += (2 * Math.PI * (48 + 110 * Math.exp(-t * 30))) / SR; o[i] = Math.sin(ph) * Math.exp(-t * 11) + gauss(r) * 0.12 * Math.exp(-t * 60); } return o; }
function buzz(dur = 0.45) { const n = Math.round(dur * SR), o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR, s = Math.sign(Math.sin(2 * Math.PI * 110 * t)) * 0.5 + Math.sign(Math.sin(2 * Math.PI * 116 * t)) * 0.5; o[i] = s * 0.35 * Math.exp(-t * 6); } return o; }
function chime(dur = 0.9) { const a = bell(880, dur), b = bell(1318, dur), n = a.length, o = new Float32Array(n), d = Math.round(0.11 * SR); for (let i = 0; i < n; i++) o[i] = a[i] + (i >= d ? b[i - d] : 0); return o; }
function tada(dur = 1.4) {
  const n = Math.round(dur * SR), o = new Float32Array(n);
  [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]].forEach(([f, d]) => { const i0 = Math.round(d * SR); for (let i = i0; i < n; i++) { const t = (i - i0) / SR; o[i] += (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 3.5) * 0.4; } });
  return o;
}
const PEMBUAT = {
  whoosh: (e, i) => whoosh(e.dur || 0.5, e.f0 || 300, e.f1 || 5000, 100 + i),
  pop: (e) => pop((e.f || 700) * 1.3, (e.f || 700) * 0.4, 0.13),
  tick: (e) => tick(e.f || 1500, 0.05),
  bell: (e) => bell(e.f || 1318, 1.4),
  thud: () => thud(),
  buzz: () => buzz(),
  chime: () => chime(),
  tada: () => tada()
};

// ---------- musik ----------
function musik(mx, dur, m, seed = 7) {
  const bpm = m.bpm || 96, beat = 60 / bpm, bar = 4 * beat, akor = m.akor, r = rng(seed);
  const nBar = Math.ceil(dur / bar);
  for (let b = 0; b < nBar; b++) {
    const [root, notes] = akor[b % akor.length], st = b * bar, n = Math.round((bar + 0.6) * SR), pad = new Float32Array(n);
    for (const nt of notes) for (const det of [-0.07, 0, 0.07]) {
      const f = mid(nt + 12) * Math.pow(2, det / 12);
      for (let i = 0; i < n; i++) { const t = i / SR; pad[i] += Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t); }
    }
    const e = env(n, 0.5, 0.6); for (let i = 0; i < n; i++) pad[i] *= (e[i] / (notes.length * 3)) * 0.55;
    mx.tambah(pad, st, 0, 0.55);
    for (const bb of [0, 2]) { const nb = Math.round(beat * 1.9 * SR), o = new Float32Array(nb); for (let i = 0; i < nb; i++) { const t = i / SR; o[i] = Math.sin(2 * Math.PI * mid(root - 12) * t) * Math.exp(-t * 2.2) * Math.min(1, i / (0.005 * SR)); } mx.tambah(o, st + bb * beat, 0, 0.5); }
    const pola = [0, 1, 2, 1, 2, 1, 2, 1];
    for (let k = 0; k < 8; k++) {
      const f = mid(notes[pola[k] % 3] + (k % 2 === 0 ? 24 : 12)), nn = Math.round(0.55 * SR), o = new Float32Array(nn);
      for (let i = 0; i < nn; i++) { const t = i / SR; o[i] = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 6.5) * Math.min(1, i / (0.002 * SR)); }
      mx.tambah(o, st + (k * beat) / 2, k % 2 === 0 ? -0.4 : 0.4, 0.16);
    }
    if (m.hat) for (let k = 0; k < 4; k++) { const nh = Math.round(0.05 * SR), o = new Float32Array(nh); let p = 0; const a = Math.exp((-2 * Math.PI * 6000) / SR); for (let i = 0; i < nh; i++) { const x = gauss(r); p = (1 - a) * x + a * p; o[i] = (x - p) * Math.exp(-(i / SR) * 70); } mx.tambah(o, st + k * beat + beat / 2, 0.2, 0.05); }
    if (m.kick && b >= 1) mx.tambah(thud(0.25), st, 0, 0.35);
  }
}

/** Buat musik + efek untuk durasi tertentu. Musik direndahkan sebentar saat ada efek (ducking sederhana). */
export function sintesisAudio({ durasi, musik: gaya, efek = [] }) {
  const n = Math.round(durasi * SR), M = new Mixer(n), X = new Mixer(n);
  musik(M, durasi, gaya);
  efek.forEach((e, i) => { const mk = PEMBUAT[e.k]; if (!mk) return; X.tambah(mk(e, i), e.t, e.pan || 0, e.gain ?? 0.5); });
  // selubung efek -> ducking musik
  const lvl = new Float32Array(n); let s = 0; const a = Math.exp(-1 / (0.06 * SR));
  for (let i = 0; i < n; i++) { const v = Math.abs(X.L[i] + X.R[i]) / 2; s = v > s ? v : a * s + (1 - a) * v; lvl[i] = s; }
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, fade = Math.min(1, t / 0.4) * Math.min(1, (durasi - t) / 1.2), duck = 1 - 0.35 * Math.min(1, lvl[i] / 0.25);
    L[i] = M.L[i] * fade * duck * 0.8 + X.L[i]; R[i] = M.R[i] * fade * duck * 0.8 + X.R[i];
  }
  let pk = 1e-9; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.85 / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  return { L, R };
}

export function tulisWav(berkas, { L, R }) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4); buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4); }
  fs.writeFileSync(berkas, buf);
}
