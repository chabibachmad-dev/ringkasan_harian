// Templat fakta (Selasa): hitung mundur tiga peringkat, dari nomor 3 sampai nomor 1.
import { W, THEMES, P, eo, eio, lerp, pop, font, latar, bingkai, kartu, lingkaran, pil, paragraf, muatkan, efek } from "../engine.js";
import { S, hasil } from "./util.js";

export default {
  id: "peringkat",
  nama: "Peringkat 3-2-1",
  hari: 2,
  jalur: "fakta",
  tema: "plum",
  musik: { bpm: 108, akor: [[52, [52, 55, 59]], [57, [57, 60, 64]], [53, [53, 57, 60]], [55, [55, 59, 62]]], kick: true, hat: true },
  petunjukIsi: `{"judul":"...","item":[{"label":"...","catatan":"...","nilai":"..."},{...},{...}],"kesimpulan":"..."}  // tepat 3 item, item pertama = peringkat 1 (terbaik/terbesar); label pendek (maks 28 huruf); catatan 1 kalimat pendek; nilai (opsional) angka beserta satuan, misal "8.849 m"; kesimpulan 1 kalimat`,
  contoh: { judul: "3 hewan tercepat di dunia", item: [{ label: "Elang peregrine", catatan: "Menukik hingga sekitar 390 km/jam.", nilai: "390 km/jam" }, { label: "Cheetah", catatan: "Pelari tercepat di darat.", nilai: "110 km/jam" }, { label: "Kuda pacu", catatan: "Bisa berlari sangat cepat dalam jarak pendek.", nilai: "70 km/jam" }], kesimpulan: "Hewan tercepat justru terbang, bukan berlari!" },
  angkaKunci(c) { return c.item.map((x) => x.nilai).filter(Boolean); },

  rapikan(raw) {
    const gal = [], it = Array.isArray(raw?.item) ? raw.item : [];
    if (it.length < 3) gal.push('"item" harus 3 butir');
    const item = it.slice(0, 3).map((x) => ({ label: S(x, "label", 30, gal), catatan: S(x, "catatan", 90, gal, false), nilai: S(x, "nilai", 16, gal, false) }));
    return hasil({ judul: S(raw, "judul", 80, gal), item, kesimpulan: S(raw, "kesimpulan", 120, gal) }, gal);
  },
  narasi(c) {
    const urut = [2, 1, 0].map((i) => `Peringkat ${i + 1}, ${c.item[i].label}. ${c.item[i].catatan || ""}`);
    return `${c.judul} ${urut.join(" ")} ${c.kesimpulan}`;
  },
  bangun(c, opsi = {}) {
    const th = THEMES[opsi.tema || this.tema], ts = { 3: 3.8, 2: 7.2, 1: 10.6 }, tK = 14.4, dur = 20.4;
    const sfx = efek([0.6, "whoosh", { gain: 0.3 }], [3.8, "thud", { gain: 0.6 }], [7.2, "thud", { gain: 0.7 }], [10.6, "thud", { gain: 0.9 }], [10.9, "tada", { gain: 0.5 }], [tK, "whoosh", { gain: 0.25 }]);
    const h = 188, gp = 24, y0 = 470;
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, "PERINGKAT", W / 2, 170, 0.2, th);
        paragraf(g, t, c.judul, { x: W / 2, y: 290, size: 54, weight: 800, color: th.ink, t0: 0.7, align: "center", maksBaris: 3, maxW: 620, gap: 0.07 });
        for (const r of [3, 2, 1]) {
          const it = c.item[r - 1], p = eo(P(t, ts[r], ts[r] + 0.5)); if (p <= 0) continue;
          const y = y0 + (r - 1) * (h + gp), juara = r === 1, k = pop(t, ts[r], ts[r] + 0.55);
          g.save(); g.globalAlpha = Math.min(1, p * 1.5); g.translate(W / 2 + (1 - p) * 160, y + h / 2); g.scale(Math.min(1.04, 0.9 + 0.1 * k), Math.min(1.04, 0.9 + 0.1 * k)); g.translate(-W / 2, -h / 2);
          kartu(g, 48, 0, 624, h, { fill: juara ? th.a1 + "26" : "rgba(255,255,255,0.07)", stroke: juara ? th.a1 : "rgba(255,255,255,0.18)", lw: juara ? 6 : 3, r: 26 });
          lingkaran(g, 48 + 70, h / 2, 50, { fill: juara ? th.a1 : th.a2 });
          g.fillStyle = "#14161C"; g.font = font(900, 64); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(r), 118, h / 2 + 4);
          const maxW = it.nilai ? 300 : 440, m = muatkan(g, it.label, maxW, 900, 42, 1, 22);
          g.fillStyle = th.ink; g.font = font(900, m.size); g.textAlign = "left"; g.textBaseline = "alphabetic";
          const lh = Math.round(m.size * 1.1); m.baris.forEach((b, bi) => g.fillText(b, 190, 62 + bi * lh));
          const mc = muatkan(g, it.catatan || "", maxW, 600, 26, 2, 20);
          g.fillStyle = th.dim; g.font = font(600, mc.size); mc.baris.forEach((b, bi) => g.fillText(b, 190, 62 + m.baris.length * lh + 14 + bi * 30));
          if (it.nilai) { g.fillStyle = juara ? th.a1 : th.a2; g.textAlign = "right"; const mv = muatkan(g, it.nilai, 140, 900, 32, 2, 20); g.font = font(900, mv.size); mv.baris.forEach((b, bi) => g.fillText(b, 648, h / 2 - ((mv.baris.length - 1) * 16) + bi * 34 + 8)); }
          g.restore();
        }
        paragraf(g, t, c.kesimpulan, { x: W / 2, y: 1150, size: 34, weight: 800, color: th.a1, t0: tK, align: "center", maksBaris: 2, maxW: 620, gap: 0.06 });
      }
    };
  }
};
