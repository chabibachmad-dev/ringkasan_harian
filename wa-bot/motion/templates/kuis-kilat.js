// Templat Senin: kuis pilihan ganda dengan hitung mundur, lalu jawaban dan penjelasan.
import { W, H, THEMES, P, eo, eio, lerp, pop, font, latar, bingkai, kartu, lingkaran, teks, pil, paragraf, muatkan, efek } from "../engine.js";
import { S, L, N, hasil } from "./util.js";

const HURUF = ["A", "B", "C", "D"];
const T_REVEAL = 11.4;

export default {
  id: "kuis-kilat",
  nama: "Kuis Kilat",
  hari: 1, // 0=Minggu ... 6=Sabtu
  tema: "navy",
  musik: { bpm: 104, akor: [[57, [57, 60, 64]], [53, [53, 57, 60]], [48, [48, 52, 55]], [55, [55, 59, 62]]], kick: true, hat: true },
  petunjukIsi: `{"pertanyaan":"...","pilihan":["...","...","..."],"jawaban":0,"penjelasan":"..."}  // pilihan 3-4 butir pendek; jawaban = nomor pilihan benar mulai dari 0; penjelasan 1-2 kalimat`,
  contoh: { pertanyaan: "Berapa hasil 7 × 8?", pilihan: ["54", "56", "63", "48"], jawaban: 1, penjelasan: "7 × 8 = 56. Ingat: 7 × 8 sama dengan 7 × 10 dikurangi 7 × 2, yaitu 70 − 14 = 56." },

  rapikan(raw) {
    const gal = [];
    const isi = { pertanyaan: S(raw, "pertanyaan", 170, gal), pilihan: L(raw, "pilihan", 3, 4, 40, gal), jawaban: N(raw, "jawaban", gal), penjelasan: S(raw, "penjelasan", 260, gal) };
    if (!Number.isInteger(isi.jawaban) || isi.jawaban < 0 || isi.jawaban >= isi.pilihan.length) gal.push('"jawaban" di luar jumlah pilihan');
    return hasil(isi, gal);
  },
  narasi(c) {
    const daftar = c.pilihan.map((p, i) => `${HURUF[i]}, ${p}`).join(". ");
    return `Kuis kilat! ${c.pertanyaan} ${daftar}. Pikirkan dulu ya. ... Jawabannya adalah ${HURUF[c.jawaban]}, ${c.pilihan[c.jawaban]}. ${c.penjelasan}`;
  },
  bangun(c) {
    const th = THEMES[this.tema], n = c.pilihan.length;
    const dur = 21;
    const oy0 = 600, oh = n === 4 ? 92 : 104, gp = 18;
    const sfx = efek([0.7, "whoosh", { gain: 0.3 }]);
    for (let i = 0; i < n; i++) sfx.push({ t: 3.6 + i * 0.35, k: "pop", f: 600 + 80 * i, gain: 0.6 });
    for (let i = 0; i < 5; i++) sfx.push({ t: 6.2 + i, k: "tick", f: 900, gain: 0.5 });
    sfx.push({ t: T_REVEAL, k: "chime", gain: 0.5 }, { t: T_REVEAL + 0.9, k: "whoosh", gain: 0.25 });
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, "KUIS KILAT", W / 2, 170, 0.2, th);
        paragraf(g, t, c.pertanyaan, { x: W / 2, y: 290, size: 54, weight: 800, color: th.ink, t0: 0.8, align: "center", maksBaris: 5, maxW: 620, gap: 0.07 });
        const r = eio(P(t, T_REVEAL, T_REVEAL + 0.7));
        for (let i = 0; i < n; i++) {
          const benar = i === c.jawaban;
          const p = eo(P(t, 3.6 + i * 0.35, 3.6 + i * 0.35 + 0.5));
          if (p <= 0) continue;
          let y = oy0 + i * (oh + gp), dx = (1 - p) * 140, a = p;
          if (!benar) { a *= 1 - r; dx += r * 260; } else y = lerp(y, oy0, r);
          const sk = benar ? 1 + 0.04 * Math.sin(P(t, T_REVEAL, T_REVEAL + 0.6) * Math.PI) : 1;
          g.save(); g.globalAlpha = a; g.translate(W / 2 + dx, y + oh / 2); g.scale(sk, sk); g.translate(-W / 2, -oh / 2);
          const sorot = benar && t >= T_REVEAL;
          kartu(g, 48, 0, 624, oh, { fill: sorot ? th.ok + "33" : "rgba(255,255,255,0.07)", stroke: sorot ? th.ok : "rgba(255,255,255,0.18)", lw: sorot ? 5 : 3 });
          lingkaran(g, 48 + 46, oh / 2, 28, { fill: sorot ? th.ok : th.a2 });
          g.fillStyle = "#0B1626"; g.font = font(900, 32); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(HURUF[i], 94, oh / 2 + 2);
          const m = muatkan(g, c.pilihan[i], 440, 800, 38, 1, 24);
          g.fillStyle = th.ink; g.font = font(800, m.size); g.textAlign = "left"; g.fillText(m.baris[0], 142, oh / 2 + 2);
          if (sorot) { g.fillStyle = th.ok; g.font = font(900, 46); g.textAlign = "right"; g.fillText("✓", 648, oh / 2 + 2); }
          g.restore();
        }
        // hitung mundur
        if (t >= 6 && t < T_REVEAL + 0.3) {
          const a = eo(P(t, 6, 6.4)) * (1 - eo(P(t, T_REVEAL, T_REVEAL + 0.3)));
          g.save(); g.globalAlpha = a;
          lingkaran(g, W / 2, 1105, 42, { stroke: "rgba(255,255,255,0.15)", lw: 8 });
          lingkaran(g, W / 2, 1105, 42, { stroke: th.a1, lw: 8, prog: 1 - P(t, 6.2, 11.2) });
          const angka = Math.max(1, 5 - Math.floor(Math.max(0, t - 6.2)));
          g.fillStyle = th.ink; g.font = font(900, 44); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(angka), W / 2, 1108);
          g.restore();
        }
        // penjelasan
        if (t >= T_REVEAL + 0.9) {
          const tt = T_REVEAL + 0.9, m = muatkan(g, c.penjelasan, 560, 700, 36, 7);
          const lh = Math.round(m.size * 1.3), h = m.baris.length * lh + 64, y0 = oy0 + oh + 40;
          const p = eo(P(t, tt, tt + 0.5));
          g.save(); g.globalAlpha = p; g.translate(0, (1 - p) * 40);
          kartu(g, 48, y0, 624, h, { fill: "rgba(255,255,255,0.08)", stroke: th.a1 + "88" });
          g.fillStyle = th.a1; g.font = font(800, 24); g.textAlign = "left"; g.letterSpacing = "3px"; g.fillText("PENJELASAN", 78, y0 + 38); g.letterSpacing = "0px";
          g.restore();
          paragraf(g, t, c.penjelasan, { x: 78, y: y0 + 78, size: m.size, weight: 700, color: th.ink, t0: tt + 0.3, maksBaris: 7, maxW: 560, gap: 0.05, lineH: lh });
        }
      }
    };
  }
};
