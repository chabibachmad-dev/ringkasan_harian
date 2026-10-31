// Templat Minggu: deret bilangan muncul satu per satu, aturannya digambar, lalu angka berikutnya terungkap.
import { W, THEMES, P, eo, eio, pop, font, latar, bingkai, kartu, kotak, pil, paragraf, muatkan, efek } from "../engine.js";
import { S, L, hasil } from "./util.js";

export default {
  id: "pola-angka",
  nama: "Pola Angka",
  hari: 0,
  tema: "dusk",
  musik: { bpm: 100, akor: [[50, [50, 54, 57]], [47, [47, 50, 54]], [55, [55, 59, 62]], [52, [52, 56, 59]]], kick: false, hat: true },
  petunjukIsi: `{"judul":"...","deret":["2","5","8","11"],"aturan":"+3","berikutnya":"14","penjelasan":"..."}  // deret 4-6 bilangan; aturan pendek (misal "+3", "×2"); berikutnya = bilangan setelah deret; penjelasan 1-2 kalimat`,
  contoh: { judul: "Lanjutkan pola ini!", deret: ["2", "5", "8", "11"], aturan: "+3", berikutnya: "14", penjelasan: "Setiap bilangan bertambah 3 dari bilangan sebelumnya. Jadi setelah 11 adalah 11 + 3 = 14." },

  rapikan(raw) {
    const gal = [];
    const isi = { judul: S(raw, "judul", 70, gal), deret: L(raw, "deret", 4, 6, 8, gal), aturan: S(raw, "aturan", 10, gal), berikutnya: S(raw, "berikutnya", 8, gal), penjelasan: S(raw, "penjelasan", 220, gal) };
    return hasil(isi, gal);
  },
  narasi(c) { return `${c.judul} Perhatikan deret ini. ${c.deret.join(", ")}, lalu angka berapa? ... Aturannya ${c.aturan.replace("+", "tambah ").replace("−", "kurang ").replace("-", "kurang ").replace("×", "kali ")}. Jadi angka berikutnya adalah ${c.berikutnya}. ${c.penjelasan}`; },
  bangun(c) {
    const th = THEMES[this.tema], n = c.deret.length + 1;
    const t0 = 1.8, gp = 0.8, tTanya = t0 + n * gp - 0.2, tJawab = tTanya + 3.4, dur = tJawab + 1.6 + 5.8;
    const gap = 12, bw = (624 - (n - 1) * gap) / n, bh = Math.min(120, bw * 1.25), by = 560;
    const sfx = efek([0.6, "whoosh", { gain: 0.3 }]);
    for (let i = 0; i < n - 1; i++) sfx.push({ t: t0 + i * gp, k: "pop", f: 560 + 70 * i, gain: 0.5 });
    sfx.push({ t: tTanya, k: "whoosh", gain: 0.2 }, { t: tTanya + 1.2, k: "tick", f: 800, gain: 0.4 }, { t: tTanya + 2.2, k: "tick", f: 800, gain: 0.4 }, { t: tJawab, k: "tada", gain: 0.5 }, { t: tJawab + 1.4, k: "whoosh", gain: 0.25 });
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, "POLA ANGKA", W / 2, 170, 0.2, th);
        paragraf(g, t, c.judul, { x: W / 2, y: 290, size: 56, weight: 800, color: th.ink, t0: 0.7, align: "center", maksBaris: 3, maxW: 620, gap: 0.08 });
        for (let i = 0; i < n; i++) {
          const x = 48 + i * (bw + gap), ult = i === n - 1;
          const ts = ult ? tTanya : t0 + i * gp, k = pop(t, ts, ts + 0.45); if (k <= 0) continue;
          const terjawab = ult && t >= tJawab;
          const denyut = ult && !terjawab ? 1 + 0.05 * Math.sin((t - tTanya) * 8) : 1;
          g.save(); g.translate(x + bw / 2, by + bh / 2); g.scale(k * denyut * (terjawab ? 1 + 0.15 * Math.max(0, 1 - (t - tJawab) / 0.35) : 1), k * denyut);
          kartu(g, -bw / 2, -bh / 2, bw, bh, { r: 16, fill: ult ? (terjawab ? th.ok + "33" : th.a3 + "33") : "rgba(255,255,255,0.09)", stroke: ult ? (terjawab ? th.ok : th.a3) : "rgba(255,255,255,0.22)", lw: 4 });
          const s = ult ? (terjawab ? c.berikutnya : "?") : c.deret[i];
          let sz = 56; g.font = font(900, sz); while (g.measureText(s).width > bw - 14 && sz > 20) { sz -= 2; g.font = font(900, sz); }
          g.fillStyle = ult ? (terjawab ? th.ok : th.a3) : th.ink; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s, 0, 3); g.restore();
          // busur aturan antara kotak i-1 dan i
          if (i > 0) {
            const pr = eo(P(t, ts + 0.2, ts + 0.7)); if (pr <= 0 || (ult && !terjawab && false)) continue;
            const xa = x - gap - bw / 2, xb = x + bw / 2, ya = by - 8, hh = 38;
            g.save(); g.globalAlpha = pr; g.strokeStyle = th.a1; g.lineWidth = 4; g.lineCap = "round";
            g.beginPath(); g.moveTo(xa, ya); g.quadraticCurveTo((xa + xb) / 2, ya - hh * 1.6, xb, ya); g.stroke();
            g.fillStyle = th.a1; g.font = font(800, Math.min(28, bw * 0.38)); g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillText(c.aturan, (xa + xb) / 2, ya - hh * 0.8 - 6);
            g.restore();
          }
        }
        if (t >= tJawab + 0.3) {
          const k = pop(t, tJawab + 0.3, tJawab + 0.8), y = 860;
          g.save(); g.translate(W / 2, y); g.scale(k, k);
          g.font = font(900, 40); const txt = `Aturan: ${c.aturan}`, w = g.measureText(txt).width + 60;
          kotak(g, -w / 2, -40, w, 80, 40); g.fillStyle = th.a1; g.fill(); g.fillStyle = "#101A3A"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, 0, 3); g.restore();
        }
        paragraf(g, t, c.penjelasan, { x: W / 2, y: 970, size: 36, weight: 600, color: th.dim, t0: tJawab + 1.5, align: "center", maksBaris: 5, maxW: 600, gap: 0.05 });
      }
    };
  }
};
