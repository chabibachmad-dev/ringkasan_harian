// Templat Kamis: batang horizontal tumbuh satu per satu untuk membandingkan beberapa hal.
import { W, THEMES, P, eo, eio, pop, font, latar, bingkai, kartu, kotak, pil, paragraf, muatkan, fmtAngka, efek } from "../engine.js";
import { S, N, hasil } from "./util.js";

export default {
  id: "perbandingan-bar",
  nama: "Perbandingan Batang",
  hari: 4,
  tema: "ink",
  musik: { bpm: 108, akor: [[55, [55, 59, 62]], [52, [52, 55, 59]], [48, [48, 52, 55]], [50, [50, 54, 57]]], kick: true, hat: true },
  petunjukIsi: `{"judul":"...","satuan":"...","item":[{"label":"...","nilai":0}],"desimal":0,"kesimpulan":"..."}  // 3-5 item; label pendek; nilai bilangan; satuan pendek (misal "km/jam"); kesimpulan 1 kalimat`,
  contoh: { judul: "Siapa paling cepat?", satuan: "km/jam", item: [{ label: "Sepeda", nilai: 25 }, { label: "Mobil di kota", nilai: 60 }, { label: "Kereta cepat", nilai: 350 }, { label: "Pesawat", nilai: 900 }], desimal: 0, kesimpulan: "Pesawat 36 kali lebih cepat daripada sepeda!" },

  rapikan(raw) {
    const gal = [];
    const isi = { judul: S(raw, "judul", 80, gal), satuan: S(raw, "satuan", 20, gal, false), desimal: Math.min(2, Math.max(0, Math.round(Number(raw?.desimal) || 0))), item: [], kesimpulan: S(raw, "kesimpulan", 130, gal) };
    const it = Array.isArray(raw?.item) ? raw.item : [];
    if (it.length < 3) gal.push('"item" minimal 3');
    for (const x of it.slice(0, 5)) { const v = N(x, "nilai", gal); if (v < 0) gal.push("nilai negatif"); isi.item.push({ label: S(x, "label", 24, gal), nilai: v }); }
    if (isi.item.length && Math.max(...isi.item.map((x) => x.nilai)) <= 0) gal.push("semua nilai nol");
    return hasil(isi, gal);
  },
  narasi(c) {
    return `${c.judul} ${c.item.map((x) => `${x.label}, ${fmtAngka(x.nilai, c.desimal)} ${c.satuan}`).join(". ")}. ${c.kesimpulan}`;
  },
  bangun(c) {
    const th = THEMES[this.tema], n = c.item.length, maks = Math.max(...c.item.map((x) => x.nilai));
    const t0 = 3.6, gp = 1.6, tEnd = t0 + n * gp + 0.4, dur = tEnd + 0.9 + 5.2;
    const pitch = n <= 3 ? 150 : n === 4 ? 130 : 112, y0 = 480;
    const idxMaks = c.item.findIndex((x) => x.nilai === maks);
    const sfx = efek([0.6, "whoosh", { gain: 0.3 }]);
    c.item.forEach((_, i) => sfx.push({ t: t0 + i * gp, k: "whoosh", gain: 0.15 }, { t: t0 + i * gp + 1.1, k: "pop", f: 600 + 70 * i, gain: 0.5 }));
    sfx.push({ t: tEnd, k: "tada", gain: 0.45 });
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, "BANDINGKAN", W / 2, 170, 0.2, th);
        paragraf(g, t, c.judul, { x: W / 2, y: 290, size: 52, weight: 800, color: th.ink, t0: 0.7, align: "center", maksBaris: 3, maxW: 620, gap: 0.07 });
        c.item.forEach((x, i) => {
          const ts = t0 + i * gp, pa = eo(P(t, ts, ts + 0.4)); if (pa <= 0) return;
          const y = y0 + i * pitch, grow = eo(P(t, ts + 0.2, ts + 1.2)), maksW = 624;
          const hi = i === idxMaks && t >= tEnd, warna = hi ? th.a1 : th.a2;
          g.save(); g.globalAlpha = pa;
          const ml = muatkan(g, x.label, 600, 700, 34, 1, 20);
          g.fillStyle = hi ? th.a1 : th.dim; g.font = font(700, ml.size); g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillText(ml.baris[0], 48, y + 8);
          kotak(g, 48, y + 22, maksW, 56, 14); g.fillStyle = "rgba(255,255,255,0.07)"; g.fill();
          const w = Math.max(6, (x.nilai / maks) * maksW * grow);
          kotak(g, 48, y + 22, w, 56, 14); g.fillStyle = warna; g.fill();
          const v = fmtAngka(x.nilai * grow, c.desimal) + (c.satuan ? " " + c.satuan : "");
          g.font = font(900, 32); const tw = g.measureText(v).width;
          const dalam = w > tw + 40;
          g.fillStyle = dalam ? "#101820" : th.ink; g.textAlign = dalam ? "right" : "left"; g.textBaseline = "middle";
          g.fillText(v, dalam ? 48 + w - 16 : 48 + w + 12, y + 51);
          g.restore();
        });
        paragraf(g, t, c.kesimpulan, { x: W / 2, y: y0 + n * pitch + 56, size: 38, weight: 800, color: th.a1, t0: tEnd + 0.9, align: "center", maksBaris: 3, maxW: 620, gap: 0.06 });
      }
    };
  }
};
