// Templat Rabu: satu angka mengejutkan menghitung naik di dalam cincin, lalu fakta pendukung.
import { W, THEMES, P, eo, eio, lerp, pop, font, latar, bingkai, kartu, lingkaran, teks, pil, paragraf, muatkan, fmtAngka, efek } from "../engine.js";
import { S, L, N, hasil } from "./util.js";

export default {
  id: "fakta-angka",
  nama: "Fakta Angka",
  hari: 3,
  tema: "forest",
  musik: { bpm: 100, akor: [[50, [50, 53, 57]], [58, [58, 62, 65]], [53, [53, 57, 60]], [57, [57, 61, 64]]], kick: true, hat: false },
  petunjukIsi: `{"judul":"...","angka":0,"desimal":0,"satuan":"...","keterangan":"...","fakta":["...","..."]}  // angka = bilangan (tanpa titik ribuan); satuan pendek (misal "km", "tahun"); keterangan 1 kalimat; fakta 0-3 butir pendek`,
  contoh: { judul: "Seberapa tinggi Gunung Everest?", angka: 8849, desimal: 0, satuan: "meter di atas laut", keterangan: "Puncak tertinggi di dunia, ada di perbatasan Nepal dan Tiongkok.", fakta: ["Tingginya hampir 9 kilometer.", "Pesawat penumpang terbang sekitar 10 km.", "Pendaki butuh sekitar 2 bulan menuju puncak."] },

  rapikan(raw) {
    const gal = [];
    const d = Math.min(3, Math.max(0, Math.round(Number(raw?.desimal) || 0)));
    const isi = { judul: S(raw, "judul", 90, gal), angka: N(raw, "angka", gal), desimal: d, satuan: S(raw, "satuan", 34, gal), keterangan: S(raw, "keterangan", 150, gal), fakta: [] };
    if (Array.isArray(raw?.fakta)) isi.fakta = L(raw, "fakta", 0, 3, 80, gal);
    return hasil(isi, gal);
  },
  narasi(c) {
    return `Tahukah kamu? ${c.judul} Jawabannya ${fmtAngka(c.angka, c.desimal)} ${c.satuan}. ${c.keterangan} ${c.fakta.join(" ")}`;
  },
  bangun(c) {
    const th = THEMES[this.tema], adaFakta = c.fakta.length > 0;
    const tF = 11.0, dur = adaFakta ? tF + 1.2 + c.fakta.length * 2.0 + 3.6 : 16;
    const sfx = efek([0.6, "whoosh", { gain: 0.3 }]);
    for (let k = 0; k < 20; k++) sfx.push({ t: 1.3 + k * 0.21, k: "tick", f: 700 + k * 35, gain: 0.35 });
    sfx.push({ t: 5.6, k: "bell", gain: 0.3 }, { t: 6.0, k: "whoosh", gain: 0.2 });
    if (adaFakta) { sfx.push({ t: tF, k: "whoosh", gain: 0.3 }); c.fakta.forEach((_, i) => sfx.push({ t: tF + 1.2 + i * 2.0, k: "pop", f: 640 + 90 * i, gain: 0.55 })); }
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, "TAHUKAH KAMU?", W / 2, 170, 0.2, th);
        paragraf(g, t, c.judul, { x: W / 2, y: 290, size: 50, weight: 800, color: th.ink, t0: 0.7, align: "center", maksBaris: 3, maxW: 620, gap: 0.07 });
        const k = adaFakta ? eio(P(t, tF, tF + 0.9)) : 0;
        const sc = lerp(1, 0.58, k), cy = lerp(640, 470, k), R = 190;
        const nilai = c.angka * eo(P(t, 1.2, 5.4));
        const prog = eo(P(t, 1.0, 5.6));
        g.save(); g.translate(W / 2, cy); g.scale(sc, sc);
        lingkaran(g, 0, 0, R, { stroke: "rgba(255,255,255,0.12)", lw: 18 });
        lingkaran(g, 0, 0, R, { stroke: th.a1, lw: 18, prog });
        const txt = fmtAngka(nilai, c.desimal);
        const m = muatkan(g, txt, 270, 900, 112, 1, 40);
        const pk = t > 5.4 ? 1 + 0.06 * Math.max(0, 1 - (t - 5.4) / 0.3) : 1;
        g.save(); g.scale(pk, pk); g.fillStyle = th.ink; g.font = font(900, m.size); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, 0, 0); g.restore();
        const ms = muatkan(g, c.satuan, 520, 800, 42, 2, 24);
        g.fillStyle = th.a1; g.font = font(800, ms.size); g.textBaseline = "alphabetic"; g.textAlign = "center";
        ms.baris.forEach((b, i) => g.fillText(b, 0, R + 66 + i * Math.round(ms.size * 1.2)));
        g.restore();
        if (!adaFakta || t < tF + 0.4) paragraf(g, t, c.keterangan, { x: W / 2, y: 1030, size: 34, weight: 600, color: th.dim, t0: 6.0, align: "center", maksBaris: 4, maxW: 600, gap: 0.05, out: adaFakta ? tF : null });
        if (adaFakta) c.fakta.forEach((f, i) => {
          const ts = tF + 1.2 + i * 2.0, p = eo(P(t, ts, ts + 0.5)); if (p <= 0) return;
          const y = 700 + i * 136, mm = muatkan(g, f, 500, 700, 33, 2, 22);
          g.save(); g.globalAlpha = p; g.translate((1 - p) * 120, 0);
          kartu(g, 48, y, 624, 118, { fill: "rgba(255,255,255,0.08)", stroke: th.a2 + "66" });
          lingkaran(g, 98, y + 59, 26, { fill: th.a2 });
          g.fillStyle = "#0C1F1A"; g.font = font(900, 28); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), 98, y + 61);
          g.fillStyle = th.ink; g.font = font(700, mm.size); g.textAlign = "left"; const lh = Math.round(mm.size * 1.22), y1 = y + 59 - ((mm.baris.length - 1) * lh) / 2;
          mm.baris.forEach((b, bi) => g.fillText(b, 146, y1 + bi * lh)); g.restore();
        });
      }
    };
  }
};
