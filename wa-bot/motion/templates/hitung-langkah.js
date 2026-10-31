// Templat Selasa: soal hitungan diselesaikan langkah demi langkah, hasil akhir muncul besar.
import { W, THEMES, P, eo, eio, pop, font, latar, bingkai, kartu, teks, pil, paragraf, muatkan, efek } from "../engine.js";
import { S, hasil } from "./util.js";

export default {
  id: "hitung-langkah",
  nama: "Hitung Langkah demi Langkah",
  hari: 2,
  tema: "plum",
  musik: { bpm: 96, akor: [[52, [52, 55, 59]], [57, [57, 60, 64]], [53, [53, 57, 60]], [55, [55, 59, 62]]], kick: false, hat: true },
  petunjukIsi: `{"judul":"...","soal":"...","langkah":[{"ekspresi":"...","catatan":"..."}],"hasil":"..."}  // 2-3 langkah; ekspresi pendek (misal "24 ÷ 4 = 6"); catatan 1 kalimat pendek; hasil jawaban akhir pendek`,
  contoh: { judul: "Pecahan", soal: "Ibu punya 24 kue. Dibagi rata untuk 4 anak. Lalu tiap anak memberi 2 kue ke adik. Berapa sisa kue tiap anak?", langkah: [{ ekspresi: "24 ÷ 4 = 6", catatan: "Bagi rata dulu: tiap anak dapat 6 kue." }, { ekspresi: "6 − 2 = 4", catatan: "Tiap anak memberi 2 kue ke adik." }], hasil: "4 kue" },

  rapikan(raw) {
    const gal = [];
    const isi = { judul: S(raw, "judul", 40, gal), soal: S(raw, "soal", 200, gal), langkah: [], hasil: S(raw, "hasil", 28, gal) };
    const ls = Array.isArray(raw?.langkah) ? raw.langkah : [];
    if (ls.length < 2) gal.push('"langkah" minimal 2');
    for (const l of ls.slice(0, 3)) isi.langkah.push({ ekspresi: S(l, "ekspresi", 30, gal), catatan: S(l, "catatan", 70, gal, false) });
    return hasil(isi, gal);
  },
  narasi(c) {
    return `${c.judul}. ${c.soal} Yuk kita hitung pelan-pelan. ${c.langkah.map((l, i) => `Langkah ${i + 1}. ${l.catatan || l.ekspresi}`).join(" ")} Jadi hasilnya ${c.hasil}.`;
  },
  bangun(c) {
    const th = THEMES[this.tema], n = c.langkah.length;
    const t0 = 4.0, gp = 3.4, tHasil = t0 + n * gp + 0.4, dur = tHasil + 5.2;
    const sfx = efek([0.5, "whoosh", { gain: 0.3 }]);
    for (let i = 0; i < n; i++) sfx.push({ t: t0 + i * gp, k: "whoosh", gain: 0.2 }, { t: t0 + i * gp + 0.9, k: "pop", f: 700 + 100 * i, gain: 0.55 });
    sfx.push({ t: tHasil, k: "tada", gain: 0.5 });
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, c.judul.toUpperCase(), W / 2, 170, 0.2, th);
        paragraf(g, t, c.soal, { x: W / 2, y: 290, size: 44, weight: 700, color: th.ink, t0: 0.8, align: "center", maksBaris: 6, maxW: 620, gap: 0.06 });
        const yMulai = n === 2 ? 540 : 500, h = n === 2 ? 170 : 134, gp2 = 26;
        for (let i = 0; i < n; i++) {
          const ts = t0 + i * gp, p = eo(P(t, ts, ts + 0.5));
          if (p <= 0) continue;
          const y = yMulai + i * (h + gp2);
          g.save(); g.globalAlpha = p; g.translate(-(1 - p) * 120, 0);
          kartu(g, 48, y, 624, h, { fill: "rgba(255,255,255,0.08)", stroke: i === n - 1 ? th.a1 + "99" : "rgba(255,255,255,0.15)" });
          g.fillStyle = th.a2; g.font = font(900, 26); g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(`${i + 1}`, 74, y + 36);
          // ekspresi tersingkap dari kiri ke kanan
          const rev = eio(P(t, ts + 0.3, ts + 1.1));
          const m = muatkan(g, c.langkah[i].ekspresi, 540, 900, 58, 1, 28);
          g.save(); g.beginPath(); g.rect(100, y, 540 * rev + 2, h); g.clip();
          g.fillStyle = th.ink; g.font = font(900, m.size); g.textAlign = "left"; g.fillText(m.baris[0], 100, y + (h > 150 ? 76 : 62)); g.restore();
          if (c.langkah[i].catatan) {
            const a = eo(P(t, ts + 1.0, ts + 1.5)), mc = muatkan(g, c.langkah[i].catatan, 560, 600, 27, 2, 20);
            g.globalAlpha = p * a; g.fillStyle = th.dim; g.font = font(600, mc.size); mc.baris.forEach((b, bi) => g.fillText(b, 100, y + (h > 150 ? 124 : 104) + bi * 28));
          }
          g.restore();
        }
        if (t >= tHasil) {
          const k = pop(t, tHasil, tHasil + 0.55), y = yMulai + n * (h + gp2) + 6;
          g.save(); g.translate(W / 2, y + 48); g.scale(k, k);
          kartu(g, -312, -48, 624, 96, { fill: th.a1, r: 28 });
          const m = muatkan(g, `= ${c.hasil}`, 560, 900, 56, 1, 26);
          g.fillStyle = "#1A1030"; g.font = font(900, m.size); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(m.baris[0], 0, 4); g.restore();
        }
      }
    };
  }
};
