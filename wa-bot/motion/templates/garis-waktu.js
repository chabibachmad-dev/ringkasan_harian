// Templat fakta (Sabtu): peristiwa berurutan pada garis waktu vertikal.
import { W, THEMES, P, eo, eio, lerp, pop, font, latar, bingkai, kartu, lingkaran, pil, paragraf, muatkan, efek } from "../engine.js";
import { S, hasil } from "./util.js";

export default {
  id: "garis-waktu",
  nama: "Garis Waktu",
  hari: 6,
  jalur: "fakta",
  tema: "dusk",
  musik: { bpm: 94, akor: [[50, [50, 54, 57]], [55, [55, 59, 62]], [52, [52, 56, 59]], [47, [47, 50, 54]]], kick: false, hat: true },
  petunjukIsi: `{"judul":"...","peristiwa":[{"tahun":"...","teks":"..."}],"kesimpulan":"..."}  // 3-5 peristiwa berurutan dari yang paling lama; tahun pendek (misal "1969", "250 juta th lalu"); teks maks 70 huruf; kesimpulan 1 kalimat`,
  contoh: { judul: "Perjalanan manusia ke Bulan", peristiwa: [{ tahun: "1957", teks: "Satelit buatan pertama, Sputnik 1, diluncurkan." }, { tahun: "1961", teks: "Manusia pertama terbang ke luar angkasa." }, { tahun: "1969", teks: "Apollo 11 mendarat di Bulan." }, { tahun: "1972", teks: "Misi Apollo terakhir ke Bulan." }], kesimpulan: "Hanya 12 tahun dari satelit pertama sampai mendarat di Bulan." },
  angkaKunci(c) { return c.peristiwa.map((x) => x.tahun).filter((y) => /^\d{3,4}$/.test(y)); },

  rapikan(raw) {
    const gal = [], ps = Array.isArray(raw?.peristiwa) ? raw.peristiwa : [];
    if (ps.length < 3) gal.push('"peristiwa" minimal 3');
    const peristiwa = ps.slice(0, 5).map((x) => ({ tahun: S(x, "tahun", 22, gal), teks: S(x, "teks", 80, gal) }));
    return hasil({ judul: S(raw, "judul", 80, gal), peristiwa, kesimpulan: S(raw, "kesimpulan", 120, gal) }, gal);
  },
  narasi(c) { return `${c.judul} ${c.peristiwa.map((x) => `Pada ${x.tahun}, ${x.teks}`).join(" ")} ${c.kesimpulan}`; },
  bangun(c, opsi = {}) {
    const th = THEMES[opsi.tema || this.tema], n = c.peristiwa.length, t0 = 3.6, gp = 2.7, tK = t0 + n * gp + 0.3, dur = tK + 5.4;
    const pitch = n <= 3 ? 170 : n === 4 ? 150 : 128, y0 = 470, lx = 205, maksB = n === 5 ? 2 : 3;
    const sfx = efek([0.6, "whoosh", { gain: 0.3 }]);
    c.peristiwa.forEach((_, i) => sfx.push({ t: t0 + i * gp, k: "whoosh", gain: 0.15 }, { t: t0 + i * gp + 0.45, k: "pop", f: 560 + 80 * i, gain: 0.55 }));
    sfx.push({ t: tK, k: "chime", gain: 0.45 });
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, "GARIS WAKTU", W / 2, 170, 0.2, th);
        paragraf(g, t, c.judul, { x: W / 2, y: 290, size: 54, weight: 800, color: th.ink, t0: 0.7, align: "center", maksBaris: 3, maxW: 620, gap: 0.07 });
        const cy = (i) => y0 + i * pitch + 36;
        for (let i = 0; i < n - 1; i++) {
          const pr = eo(P(t, t0 + (i + 1) * gp - 0.8, t0 + (i + 1) * gp)); if (pr <= 0) continue;
          g.strokeStyle = th.a2 + "99"; g.lineWidth = 6; g.lineCap = "round"; g.beginPath(); g.moveTo(lx, cy(i) + 16); g.lineTo(lx, lerp(cy(i) + 16, cy(i + 1) - 16, pr)); g.stroke();
        }
        c.peristiwa.forEach((x, i) => {
          const ts = t0 + i * gp, p = eo(P(t, ts, ts + 0.5)); if (p <= 0) return;
          const k = pop(t, ts, ts + 0.5);
          g.save(); g.globalAlpha = Math.min(1, p * 1.4);
          lingkaran(g, lx, cy(i), 14 * Math.min(1.2, k), { fill: i === n - 1 ? th.a1 : th.a2 });
          const my = muatkan(g, x.tahun, 130, 900, 40, 3, 22); g.fillStyle = th.a1; g.font = font(900, my.size); g.textAlign = "right"; g.textBaseline = "alphabetic";
          my.baris.forEach((b, bi) => g.fillText(b, lx - 28 + (1 - p) * -40, cy(i) + 12 - ((my.baris.length - 1) * my.size * 0.55) + bi * Math.round(my.size * 1.1)));
          g.translate((1 - p) * 90, 0);
          const mt = muatkan(g, x.teks, 385, 700, 32, maksB, 22), h = Math.max(84, mt.baris.length * Math.round(mt.size * 1.2) + 30);
          kartu(g, lx + 32, cy(i) - h / 2, 672 - lx - 32, h, { fill: "rgba(255,255,255,0.08)", stroke: "rgba(255,255,255,0.15)", r: 18 });
          g.fillStyle = th.ink; g.font = font(700, mt.size); g.textAlign = "left"; const lh = Math.round(mt.size * 1.2);
          mt.baris.forEach((b, bi) => g.fillText(b, lx + 50, cy(i) - ((mt.baris.length - 1) * lh) / 2 + bi * lh + mt.size * 0.35));
          g.restore();
        });
        paragraf(g, t, c.kesimpulan, { x: W / 2, y: Math.min(1085, y0 + n * pitch + 60), size: 34, weight: 800, color: th.a1, t0: tK, align: "center", maksBaris: 3, maxW: 620, gap: 0.06 });
      }
    };
  }
};
