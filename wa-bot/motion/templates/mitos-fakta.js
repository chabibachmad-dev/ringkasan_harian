// Templat Sabtu: klaim populer distempel "MITOS", kartu berbalik menjadi "FAKTA" beserta penjelasan.
import { W, THEMES, P, eo, eio, lerp, pop, font, latar, bingkai, kartu, kotak, pil, paragraf, muatkan, efek } from "../engine.js";
import { S, hasil } from "./util.js";

const T_STAMP = 4.4, T_FLIP = 7.4, T_STAMP2 = 8.6, T_PENJ = 9.6;

export default {
  id: "mitos-fakta",
  nama: "Mitos atau Fakta",
  hari: 6,
  tema: "wine",
  musik: { bpm: 112, akor: [[57, [57, 60, 64]], [55, [55, 59, 62]], [53, [53, 57, 60]], [52, [52, 56, 59]]], kick: true, hat: true },
  petunjukIsi: `{"mitos":"...","fakta":"...","penjelasan":"..."}  // mitos = anggapan keliru yang populer (1 kalimat); fakta = versi yang benar (1 kalimat); penjelasan 1-2 kalimat`,
  contoh: { mitos: "Makan wortel bikin mata jadi super tajam.", fakta: "Wortel baik untuk kesehatan mata, tapi tidak membuat penglihatan super tajam.", penjelasan: "Wortel mengandung vitamin A yang menjaga mata tetap sehat. Kalau sudah cukup vitamin A, makan lebih banyak wortel tidak menambah ketajaman mata." },

  rapikan(raw) {
    const gal = [];
    return hasil({ mitos: S(raw, "mitos", 120, gal), fakta: S(raw, "fakta", 140, gal), penjelasan: S(raw, "penjelasan", 240, gal) }, gal);
  },
  narasi(c) { return `Mitos atau fakta? Banyak orang bilang, ${c.mitos} ... Ternyata itu mitos! Faktanya, ${c.fakta} ${c.penjelasan}`; },
  bangun(c) {
    const th = THEMES[this.tema], dur = 18.5;
    const sfx = efek([0.6, "whoosh", { gain: 0.3 }], [1.0, "pop", { f: 700, gain: 0.5 }], [T_STAMP, "thud", { gain: 0.9 }], [T_STAMP + 0.5, "buzz", { gain: 0.3 }],
      [T_FLIP, "whoosh", { gain: 0.3 }], [T_STAMP2, "thud", { gain: 0.8 }], [T_STAMP2 + 0.05, "chime", { gain: 0.45 }], [T_PENJ, "whoosh", { gain: 0.25 }]);
    const cx = 48, cy = 330, cw = 624, ch = 410;
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, "MITOS ATAU FAKTA?", W / 2, 170, 0.2, th);
        // getar layar saat stempel
        const ds = (T) => Math.max(0, 1 - (t - T) / 0.35), sh = (t >= T_STAMP && t < T_STAMP + 0.35) ? ds(T_STAMP) : (t >= T_STAMP2 && t < T_STAMP2 + 0.35) ? ds(T_STAMP2) * 0.6 : 0;
        g.save(); g.translate(Math.sin(t * 90) * 7 * sh, Math.cos(t * 70) * 6 * sh);
        // balik kartu: skala X menyempit lalu melebar
        const f = P(t, T_FLIP, T_FLIP + 0.6), sx = f <= 0 ? 1 : f < 0.5 ? 1 - eio(f * 2) : eio((f - 0.5) * 2), sisiFakta = f >= 0.5;
        const pk = eo(P(t, 0.8, 1.3));
        if (pk > 0) {
          g.save(); g.globalAlpha = pk; g.translate(W / 2, cy + ch / 2); g.scale(Math.max(0.001, sx), 1); g.translate(-W / 2, -(cy + ch / 2));
          kartu(g, cx, cy, cw, ch, { fill: sisiFakta ? th.ok + "22" : "rgba(255,255,255,0.08)", stroke: sisiFakta ? th.ok : "rgba(255,255,255,0.2)", lw: 5 });
          g.fillStyle = sisiFakta ? th.ok : th.dim; g.font = font(800, 24); g.textAlign = "left"; g.letterSpacing = "3px"; g.textBaseline = "alphabetic";
          g.fillText(sisiFakta ? "YANG BENAR" : "KATA ORANG", cx + 34, cy + 56); g.letterSpacing = "0px";
          const isi = sisiFakta ? c.fakta : c.mitos;
          const m = muatkan(g, isi, 560, 800, 44, 5, 28), lh = Math.round(m.size * 1.25);
          g.fillStyle = th.ink; g.font = font(800, m.size);
          const ay = cy + 140; 
          if (sisiFakta) m.baris.forEach((b, bi) => { g.globalAlpha = pk * eo(P(t, T_FLIP + 0.5 + bi * 0.15, T_FLIP + 0.9 + bi * 0.15)); g.fillText(b, cx + 34, ay + bi * lh); });
          else {
            const kata = P(t, 1.0, 3.2);
            m.baris.forEach((b, bi) => { const a = eo(clamp01(kata * m.baris.length - bi)); g.save(); g.globalAlpha = pk * a; g.fillText(b, cx + 34, ay + bi * lh); g.restore(); });
            // coretan saat sudah distempel
            const co = eio(P(t, T_STAMP + 0.3, T_STAMP + 1.1));
            if (co > 0) { g.strokeStyle = th.bad; g.lineWidth = 7; g.lineCap = "round"; m.baris.forEach((b, bi) => { const w = g.measureText(b).width; g.beginPath(); g.moveTo(cx + 30, ay + bi * lh - m.size * 0.3); g.lineTo(cx + 30 + w * co + 6, ay + bi * lh - m.size * 0.3); g.stroke(); }); }
          }
          g.restore();
        }
        // stempel
        const stempel = (T, kata, warna, rot, y) => {
          if (t < T) return; const k = P(t, T, T + 0.22), s = lerp(2.6, 1, eo(k));
          g.save(); g.globalAlpha = Math.min(1, k * 3); g.translate(W - 190, y); g.rotate(rot); g.scale(s, s);
          g.font = font(900, 62); g.letterSpacing = "4px"; const w = g.measureText(kata).width + 48;
          kotak(g, -w / 2, -48, w, 96, 14); g.strokeStyle = warna; g.lineWidth = 12; g.stroke(); g.fillStyle = warna + "22"; g.fill();
          g.fillStyle = warna; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(kata, 0, 6); g.letterSpacing = "0px"; g.restore();
        };
        if (t >= T_STAMP && t < T_FLIP + 0.3) stempel(T_STAMP, "MITOS", th.bad, -0.16, cy + 38);
        if (t >= T_STAMP2) stempel(T_STAMP2, "FAKTA", th.ok, 0.1, cy + 38);
        g.restore();
        if (t >= T_PENJ) {
          const p = eo(P(t, T_PENJ, T_PENJ + 0.5)), m = muatkan(g, c.penjelasan, 560, 700, 36, 6), lh = Math.round(m.size * 1.3), h = m.baris.length * lh + 70, y0 = 780;
          g.save(); g.globalAlpha = p; g.translate(0, (1 - p) * 40);
          kartu(g, 48, y0, 624, h, { fill: "rgba(255,255,255,0.08)", stroke: th.a1 + "88" });
          g.fillStyle = th.a1; g.font = font(800, 24); g.textAlign = "left"; g.letterSpacing = "3px"; g.fillText("KENAPA?", 78, y0 + 40); g.letterSpacing = "0px"; g.restore();
          paragraf(g, t, c.penjelasan, { x: 78, y: y0 + 84, size: m.size, weight: 700, color: th.ink, t0: T_PENJ + 0.3, maksBaris: 6, maxW: 560, gap: 0.05, lineH: lh });
        }
      }
    };
  }
};
function clamp01(x) { return Math.min(1, Math.max(0, x)); }
