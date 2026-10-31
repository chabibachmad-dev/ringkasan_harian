// Templat fakta (Minggu): satu fakta diceritakan dengan teks bergerak, kalimat demi kalimat, ditutup kalimat kunci.
import { W, H, THEMES, P, eo, eio, lerp, pop, font, latar, bingkai, kartu, lingkaran, pil, paragraf, muatkan, efek } from "../engine.js";
import { S, L, hasil } from "./util.js";

export default {
  id: "cerita-fakta",
  nama: "Cerita Satu Fakta",
  hari: 0,
  jalur: "fakta",
  tema: "navy",
  musik: { bpm: 90, akor: [[57, [57, 60, 64]], [50, [50, 54, 57]], [55, [55, 59, 62]], [52, [52, 55, 59]]], kick: false, hat: false },
  petunjukIsi: `{"judul":"...","bagian":["...","...","..."],"penutup":"..."}  // judul = pertanyaan/pernyataan pemantik (maks 60 huruf); bagian = 3-4 kalimat pendek berurutan (maks 85 huruf per kalimat) yang menceritakan faktanya; penutup = kalimat kunci yang mudah diingat (maks 100 huruf)`,
  contoh: { judul: "Kenapa langit berwarna biru?", bagian: ["Cahaya Matahari tampak putih, tapi sebenarnya campuran banyak warna.", "Saat masuk ke udara, cahaya biru dipantulkan ke segala arah paling banyak.", "Cahaya biru yang tersebar itulah yang sampai ke mata kita dari seluruh langit."], penutup: "Langit biru karena udara menyebarkan cahaya biru paling banyak." },

  rapikan(raw) {
    const gal = [];
    return hasil({ judul: S(raw, "judul", 70, gal), bagian: L(raw, "bagian", 3, 4, 95, gal), penutup: S(raw, "penutup", 110, gal) }, gal);
  },
  narasi(c) { return `${c.judul} ${c.bagian.join(" ")} ${c.penutup}`; },
  bangun(c, opsi = {}) {
    const th = THEMES[opsi.tema || this.tema], n = c.bagian.length, tJ = 2.9, gp = 3.5, tP = tJ + n * gp, dur = tP + 4.6;
    const sfx = efek([0.5, "whoosh", { gain: 0.3 }], [0.9, "pop", { f: 760, gain: 0.5 }]);
    c.bagian.forEach((_, i) => sfx.push({ t: tJ + i * gp, k: "whoosh", gain: 0.22 }, { t: tJ + i * gp + 0.3, k: "tick", f: 900 + 100 * i, gain: 0.4 }));
    sfx.push({ t: tP, k: "thud", gain: 0.7 }, { t: tP + 0.05, k: "tada", gain: 0.4 });
    const aksen = (g, t, i, a) => {
      g.save(); g.globalAlpha = a * 0.14; g.translate(W / 2, 640); g.rotate(t * (i % 2 ? -0.15 : 0.15)); g.strokeStyle = th.a2; g.lineWidth = 14; g.lineCap = "round";
      const tipe = i % 3;
      if (tipe === 0) { for (let s = 0; s < 3; s++) { g.beginPath(); g.arc(0, 0, 330, s * 2.09, s * 2.09 + 1.2); g.stroke(); } }
      else if (tipe === 1) { g.strokeRect(-230, -230, 460, 460); }
      else { g.beginPath(); for (let s = 0; s < 3; s++) { const a2 = (s * 2 * Math.PI) / 3 - Math.PI / 2; g.lineTo(Math.cos(a2) * 320, Math.sin(a2) * 320); } g.closePath(); g.stroke(); }
      g.restore();
    };
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        // judul
        const aJ = (1 - eo(P(t, tJ - 0.4, tJ))) * eo(P(t, 0.2, 0.5));
        if (aJ > 0) { g.save(); g.globalAlpha = aJ; pil(g, t, "TAHUKAH KAMU?", W / 2, 420, 0.2, th); paragraf(g, t, c.judul, { x: W / 2, y: 600, size: 78, weight: 900, color: th.ink, t0: 0.7, align: "center", maksBaris: 4, maxW: 620, gap: 0.1 }); g.restore(); }
        // kalimat
        for (let i = 0; i < n; i++) {
          const ts = tJ + i * gp, te = ts + gp, a = eo(P(t, ts, ts + 0.3)) * (1 - eo(P(t, te - 0.35, te))); if (a <= 0) continue;
          aksen(g, t, i, a);
          g.save(); g.globalAlpha = a; g.fillStyle = th.a1; g.font = font(900, 28); g.textAlign = "center"; g.letterSpacing = "4px"; g.fillText(`${i + 1} / ${n}`, W / 2, 330); g.letterSpacing = "0px"; g.restore();
          g.save(); g.globalAlpha = a; paragraf(g, t, c.bagian[i], { x: W / 2, y: 560, size: 60, weight: 800, color: th.ink, t0: ts + 0.1, align: "center", maksBaris: 7, maxW: 600, gap: 0.12, lineH: 78 }); g.restore();
        }
        // titik kemajuan
        if (t > tJ - 0.3 && t < tP) for (let i = 0; i <= n; i++) { const aktif = t >= tJ + i * gp - 0.05; lingkaran(g, W / 2 + (i - n / 2) * 36, 1090, aktif ? 9 : 7, { fill: aktif ? th.a1 : "rgba(255,255,255,0.25)" }); }
        // penutup
        if (t >= tP) {
          const k = pop(t, tP, tP + 0.5);
          g.save(); g.translate(W / 2, 640); g.scale(k, k);
          const m = muatkan(g, c.penutup, 520, 900, 62, 6), lh = Math.round(m.size * 1.22), h = m.baris.length * lh + 110;
          kartu(g, -312, -h / 2, 624, h, { fill: th.a1, r: 34 });
          g.fillStyle = "#06222E"; g.font = font(800, 26); g.textAlign = "center"; g.letterSpacing = "4px"; g.fillText("INTINYA", 0, -h / 2 + 52); g.letterSpacing = "0px";
          g.font = font(900, m.size); m.baris.forEach((b, bi) => g.fillText(b, 0, -h / 2 + 100 + m.size * 0.8 + bi * lh)); g.restore();
        }
      }
    };
  }
};
