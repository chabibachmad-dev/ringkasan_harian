// Templat khusus (di luar rotasi harian): contoh asli "Kenapa π hampir 3,14?". Isinya tetap.
import { W, THEMES, P, eo, eio, pop, font, latar, bingkai, paragraf, efek } from "../engine.js";
import { hasil } from "./util.js";

export default {
  id: "lingkaran-pi",
  nama: "Lingkaran dan π (contoh khusus)",
  hari: null,
  tema: "navy",
  musik: { bpm: 96, akor: [[57, [57, 60, 64]], [53, [53, 57, 60]], [48, [48, 52, 55]], [55, [55, 59, 62]]], kick: true, hat: true },
  petunjukIsi: `{}  // tidak ada isian`,
  contoh: {},
  rapikan() { return hasil({}, []); },
  narasi() { return "Kenapa pi hampir tiga koma satu empat? Gulirkan lingkaran satu putaran penuh. Kelilingnya sama dengan tiga kali diameter, ditambah sedikit sisa nol koma satu empat. Keliling dibagi diameter selalu sama. Besar atau kecil, hasilnya tetap sama. Itulah pi."; },
  bangun() {
    const th = THEMES.navy, dur = 15;
    const sfx = efek([0.35, "whoosh", { gain: 0.35 }], [0.7, "pop", { f: 900, gain: 0.7 }], [1.15, "whoosh", { gain: 0.28 }], [3.25, "whoosh", { gain: 0.3 }], [3.55, "whoosh", { gain: 0.25 }],
      [4.95, "tick", { f: 900 }], [5.65, "tick", { f: 1050 }], [6.35, "tick", { f: 1200 }], [7.0, "tick", { f: 1350 }],
      [7.0, "pop", { f: 600, gain: 0.7 }], [7.3, "pop", { f: 720, gain: 0.7 }], [7.6, "pop", { f: 840, gain: 0.7 }], [7.95, "pop", { f: 1100, gain: 0.7 }],
      [8.85, "whoosh", { gain: 0.3 }], [12.05, "whoosh", { gain: 0.3 }], [12.6, "pop", { f: 830 }], [13.0, "pop", { f: 990 }], [13.4, "pop", { f: 1180 }], [14.0, "bell", { gain: 0.3 }]);
    for (let i = 0; i < 10; i++) sfx.push({ t: 9.5 + i * 0.18, k: "tick", f: 1100 + 55 * i, gain: 0.5 });
    const fade = (t, a, d = 0.4) => 1 - eo(P(t, a, a + d));
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        const a1 = fade(t, 2.7, 0.5);
        if (a1 > 0) {
          g.save(); g.globalAlpha = a1;
          g.strokeStyle = th.a2; g.lineWidth = 10; g.lineCap = "round"; g.beginPath(); g.arc(W / 2, 560, 190, -Math.PI / 2, -Math.PI / 2 + 6.283 * eio(P(t, 0.3, 1.8))); g.stroke();
          const s = pop(t, 0.5, 1.1); g.save(); g.translate(W / 2, 564); g.scale(s, s); g.fillStyle = th.a1; g.font = font(900, 260); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("π", 0, 0); g.restore();
          paragraf(g, t, "Kenapa π", { x: W / 2, y: 900, size: 84, weight: 900, color: th.ink, t0: 1.2, align: "center", gap: 0.14 });
          paragraf(g, t, "hampir 3,14?", { x: W / 2, y: 1000, size: 84, weight: 900, color: th.a1, t0: 1.55, align: "center", gap: 0.14 });
          g.restore();
        }
        if (t >= 2.9 && t <= 8.9) {
          const a = eo(P(t, 2.9, 3.4)) * fade(t, 8.4, 0.5);
          g.save(); g.globalAlpha = a;
          paragraf(g, t, "Gulirkan lingkaran", { x: W / 2, y: 330, size: 60, weight: 800, color: th.ink, t0: 3.3, align: "center", gap: 0.12, out: 8.4 });
          paragraf(g, t, "satu putaran penuh", { x: W / 2, y: 405, size: 60, weight: 800, color: th.a1, t0: 3.6, align: "center", gap: 0.12, out: 8.4 });
          const d = 144, r = 72, x0 = 84, gy = 840, th_ = 2 * Math.PI * eio(P(t, 4.3, 7.0)), cx = x0 + r + th_ * r, cy = gy - r;
          g.strokeStyle = "rgba(143,163,191,0.35)"; g.lineWidth = 4; g.beginPath(); g.moveTo(x0 - 20, gy); g.lineTo(W - 40, gy); g.stroke();
          g.strokeStyle = th.a1; g.lineWidth = 10; g.beginPath(); g.moveTo(x0, gy); g.lineTo(x0 + th_ * r, gy); g.stroke();
          g.fillStyle = "rgba(78,205,196,0.12)"; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill();
          g.strokeStyle = th.a2; g.lineWidth = 8; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
          const px = cx - r * Math.sin(th_), py = cy + r * Math.cos(th_);
          g.strokeStyle = "rgba(244,241,232,0.8)"; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(px, py); g.stroke();
          g.fillStyle = th.a1; g.beginPath(); g.arc(px, py, 13, 0, 6.283); g.fill(); g.fillStyle = th.ink; g.beginPath(); g.arc(cx, cy, 6, 0, 6.283); g.fill();
          if (t < 4.3) { g.globalAlpha = a * eo(P(t, 3.6, 4.2)); g.fillStyle = th.dim; g.font = font(700, 28); g.textAlign = "center"; g.fillText("diameter = 1", cx, gy - r * 2 - 30); g.globalAlpha = a; }
          [[7.0, "1"], [7.3, "2"], [7.6, "3"]].forEach(([ts, lb], i) => {
            const p = eo(P(t, ts, ts + 0.35)); if (p <= 0) return; const xa = x0 + i * d;
            g.strokeStyle = th.a2; g.lineWidth = 8; g.beginPath(); g.moveTo(xa + 4, gy + 46); g.lineTo(xa + d * p - 4, gy + 46); g.stroke();
            g.fillStyle = th.a2; g.font = font(800, 40); g.textAlign = "center"; g.fillText(lb, xa + d / 2, gy + 112);
          });
          const pr = eo(P(t, 7.95, 8.35));
          if (pr > 0) { const xa = x0 + 3 * d; g.strokeStyle = th.a3; g.lineWidth = 8; g.beginPath(); g.moveTo(xa + 2, gy + 46); g.lineTo(xa + (Math.PI - 3) * d * pr, gy + 46); g.stroke(); g.fillStyle = th.a3; g.font = font(800, 34); g.textAlign = "left"; g.fillText("0,14", xa - 6, gy + 108); }
          g.restore();
        }
        if (t >= 8.6 && t <= 12.3) {
          const a = eo(P(t, 8.6, 9.1)) * fade(t, 11.8, 0.5);
          g.save(); g.globalAlpha = a;
          paragraf(g, t, "Keliling ÷ diameter", { x: W / 2, y: 520, size: 58, weight: 800, color: th.ink, t0: 8.9, align: "center", gap: 0.12, out: 11.8 });
          paragraf(g, t, "selalu sama:", { x: W / 2, y: 595, size: 58, weight: 800, color: th.dim, t0: 9.2, align: "center", gap: 0.12, out: 11.8 });
          const digs = "3,14159265", n = Math.floor(Math.min(digs.length, Math.max(0, (t - 9.5) / 0.18)));
          g.font = font(900, 104); g.textBaseline = "alphabetic"; g.textAlign = "left"; const full = g.measureText(digs).width; let x = W / 2 - full / 2;
          for (let i = 0; i < digs.length; i++) {
            const w = g.measureText(digs[i]).width;
            if (i < n) { const age = t - (9.5 + i * 0.18), s = 1 + 0.35 * Math.max(0, 1 - age / 0.2); g.save(); g.translate(x + w / 2, 830); g.scale(s, s); g.fillStyle = i < 4 ? th.a1 : th.ink; g.textAlign = "center"; g.fillText(digs[i], 0, 0); g.restore(); }
            x += w;
          }
          g.restore();
        }
        if (t >= 12.0) {
          const a = eo(P(t, 12.0, 12.4)); g.save(); g.globalAlpha = a;
          paragraf(g, t, "Besar atau kecil,", { x: W / 2, y: 300, size: 58, weight: 800, color: th.ink, t0: 12.1, align: "center", gap: 0.12 });
          paragraf(g, t, "hasilnya tetap sama", { x: W / 2, y: 372, size: 58, weight: 800, color: th.a1, t0: 12.4, align: "center", gap: 0.12 });
          [[50, th.a2, 12.6, 540], [80, th.a1, 13.0, 720], [110, th.a3, 13.4, 930]].forEach(([r, col, ts, cy]) => {
            const s = pop(t, ts, ts + 0.5); g.save(); g.translate(190, cy); g.scale(s, s); g.fillStyle = col + "22"; g.beginPath(); g.arc(0, 0, r, 0, 6.283); g.fill(); g.strokeStyle = col; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, r, 0, 6.283); g.stroke(); g.restore();
            const tp = eo(P(t, ts + 0.15, ts + 0.6)); g.save(); g.globalAlpha = a * tp; g.fillStyle = col; g.font = font(900, 76); g.textAlign = "left"; g.fillText("≈ 3,14", 360 + (1 - tp) * 40, cy + 28); g.restore();
          });
          g.restore();
        }
      }
    };
  }
};
