// Pembuka (hook) dan penutup untuk format Shorts: detik pertama menentukan penonton bertahan atau menggulir.
import { W, H, THEMES, P, eo, eio, lerp, pop, font, latar, kotak, pil, muatkan, efek } from "./engine.js";

export const DUR_HOOK = 1.7;
export const DUR_OUTRO = 2.4;

/** Pembuka: kalimat pancingan besar, kata demi kata menghantam layar. t = 0..DUR_HOOK. */
export function gambarHook(g, t, teks, th) {
  latar(g, t + 0.3, th);
  pil(g, t, "BELAJAR BARENG", W / 2, 190, 0.05, th);
  const m = muatkan(g, teks, 620, 900, 104, 4, 56), lh = Math.round(m.size * 1.15);
  g.font = font(900, m.size); g.textBaseline = "alphabetic"; g.textAlign = "left";
  const sp = g.measureText(" ").width;
  const semua = m.baris.map((b) => b.split(" ")), total = semua.reduce((a, b) => a + b.length, 0);
  const y0 = H / 2 - ((m.baris.length - 1) * lh) / 2 + m.size * 0.3;
  let n = 0;
  semua.forEach((ws, bi) => {
    const wd = ws.map((w) => g.measureText(w).width), tot = wd.reduce((a, c) => a + c, 0) + sp * (ws.length - 1);
    let cx = W / 2 - tot / 2;
    ws.forEach((w, i) => {
      const ts = 0.12 + n * 0.17, p = P(t, ts, ts + 0.22);
      if (p > 0) {
        const s = lerp(1.3, 1, eo(p)), akhir = n === total - 1;
        g.save(); g.globalAlpha = Math.min(1, p * 3); g.translate(cx + wd[i] / 2, y0 + bi * lh - m.size * 0.3); g.scale(s, s);
        g.fillStyle = akhir ? th.a1 : th.ink; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(w, 0, 0); g.restore();
      }
      cx += wd[i] + sp; n++;
    });
  });
  // kilatan putih singkat saat kata terakhir menghantam
  const tk = 0.12 + (total - 1) * 0.17;
  if (t > tk && t < tk + 0.18) { g.fillStyle = `rgba(255,255,255,${0.18 * (1 - (t - tk) / 0.18)})`; g.fillRect(0, 0, W, H); }
}
export function efekHook(teks) {
  const n = String(teks).trim().split(/\s+/).length, out = [];
  for (let i = 0; i < n; i++) out.push({ t: 0.12 + i * 0.17 + 0.1, k: "thud", gain: i === n - 1 ? 0.9 : 0.55 });
  return out;
}

/** Penutup: teaser esok hari + ajakan ikuti. t = 0..DUR_OUTRO. */
export function gambarOutro(g, t, { teaser, kanal }, th) {
  latar(g, t, th);
  pil(g, t, teaser ? "BESOK" : "SAMPAI JUMPA", W / 2, 430, 0.1, th, { warna: th.a2 });
  if (teaser) {
    const m = muatkan(g, teaser, 600, 900, 70, 4, 40), lh = Math.round(m.size * 1.2);
    g.font = font(900, m.size); g.fillStyle = th.ink; g.textAlign = "center"; g.textBaseline = "alphabetic";
    m.baris.forEach((b, i) => { const p = eo(P(t, 0.25 + i * 0.12, 0.7 + i * 0.12)); g.save(); g.globalAlpha = p; g.fillText(b, W / 2, 560 + i * lh + (1 - p) * 30); g.restore(); });
  }
  const k = pop(t, 0.8, 1.3), den = 1 + 0.03 * Math.sin(t * 7);
  g.save(); g.translate(W / 2, 850); g.scale(k * den, k * den);
  g.font = font(900, 48); const txt = "Ikuti & simpan ya!", w = g.measureText(txt).width + 80;
  kotak(g, -w / 2, -56, w, 112, 56); g.fillStyle = th.a1; g.fill();
  g.fillStyle = "#101820"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, 0, 4); g.restore();
  const p = eo(P(t, 1.2, 1.7)); g.save(); g.globalAlpha = p; g.fillStyle = th.dim; g.font = font(700, 30); g.textAlign = "center"; g.fillText(kanal || "Belajar Bareng", W / 2, 960); g.restore();
}
export function efekOutro() { return [{ t: 0.1, k: "whoosh", gain: 0.25 }, { t: 0.85, k: "pop", f: 820, gain: 0.6 }]; }
