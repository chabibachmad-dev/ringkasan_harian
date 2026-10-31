// Templat Jumat: tahapan proses/siklus sains digambar berurutan dengan titik cahaya yang mengalir.
import { W, THEMES, P, eo, eio, lerp, pop, font, latar, bingkai, kartu, lingkaran, pil, paragraf, muatkan, efek } from "../engine.js";
import { S, L, hasil } from "./util.js";

export default {
  id: "proses-tahapan",
  nama: "Proses Bertahap",
  hari: 5,
  tema: "ocean",
  musik: { bpm: 92, akor: [[53, [53, 57, 60]], [55, [55, 59, 62]], [57, [57, 60, 64]], [50, [50, 53, 57]]], kick: false, hat: true },
  petunjukIsi: `{"judul":"...","tahap":["...","...","..."],"siklus":false,"keterangan":"..."}  // 3-5 tahap, tiap tahap <= 45 huruf; siklus=true bila prosesnya berputar kembali ke awal; keterangan 1 kalimat penutup`,
  contoh: { judul: "Bagaimana hujan terbentuk?", tahap: ["Matahari memanaskan air laut", "Uap air naik ke langit", "Uap mendingin jadi awan", "Awan jatuh sebagai hujan"], siklus: true, keterangan: "Air hujan mengalir ke laut, lalu proses ini mulai lagi." },

  rapikan(raw) {
    const gal = [];
    const isi = { judul: S(raw, "judul", 80, gal), tahap: L(raw, "tahap", 3, 5, 48, gal), siklus: raw?.siklus === true || raw?.siklus === "true", keterangan: S(raw, "keterangan", 120, gal) };
    return hasil(isi, gal);
  },
  narasi(c) {
    return `${c.judul} ${c.tahap.map((x, i) => `Pertama, ${x}.`.replace("Pertama", ["Pertama", "Kedua", "Ketiga", "Keempat", "Kelima"][i])).join(" ")} ${c.siklus ? "Lalu semuanya berulang lagi. " : ""}${c.keterangan}`;
  },
  bangun(c) {
    const th = THEMES[this.tema], n = c.tahap.length;
    const t0 = 3.6, gp = 2.6, tEnd = t0 + n * gp, dur = tEnd + (c.siklus ? 1.6 : 0.6) + 5.2;
    const pitch = n <= 3 ? 170 : n === 4 ? 140 : 118, h = pitch - 22, y0 = 450;
    const sfx = efek([0.6, "whoosh", { gain: 0.3 }]);
    c.tahap.forEach((_, i) => sfx.push({ t: t0 + i * gp, k: "whoosh", gain: 0.18 }, { t: t0 + i * gp + 0.5, k: "pop", f: 560 + 80 * i, gain: 0.5 }));
    if (c.siklus) sfx.push({ t: tEnd + 0.2, k: "whoosh", gain: 0.25 });
    sfx.push({ t: tEnd + (c.siklus ? 1.6 : 0.3), k: "chime", gain: 0.4 });
    return {
      durasi: dur, efek: sfx,
      gambar(g, t) {
        latar(g, t, th); bingkai(g, t, dur, th);
        pil(g, t, "PROSES", W / 2, 170, 0.2, th);
        paragraf(g, t, c.judul, { x: W / 2, y: 290, size: 52, weight: 800, color: th.ink, t0: 0.7, align: "center", maksBaris: 3, maxW: 620, gap: 0.07 });
        const cx = 48 + 52, cyOf = (i) => y0 + i * pitch + h / 2;
        // garis penghubung (tergambar mengikuti tahap)
        for (let i = 0; i < n - 1; i++) {
          const ta = t0 + (i + 1) * gp - 0.7, pr = eo(P(t, ta, ta + 0.7)); if (pr <= 0) continue;
          g.strokeStyle = th.a2 + "88"; g.lineWidth = 6; g.lineCap = "round"; g.beginPath(); g.moveTo(cx, cyOf(i) + 34); g.lineTo(cx, lerp(cyOf(i) + 34, cyOf(i + 1) - 34, pr)); g.stroke();
          if (pr < 1) { g.fillStyle = th.a1; g.beginPath(); g.arc(cx, lerp(cyOf(i) + 34, cyOf(i + 1) - 34, pr), 10, 0, 6.283); g.fill(); }
        }
        c.tahap.forEach((x, i) => {
          const ts = t0 + i * gp, p = eo(P(t, ts, ts + 0.55)); if (p <= 0) return;
          const y = y0 + i * pitch;
          g.save(); g.globalAlpha = p; g.translate((1 - p) * 140, 0);
          kartu(g, 48, y, 592, h, { fill: "rgba(255,255,255,0.08)", stroke: "rgba(255,255,255,0.16)" });
          lingkaran(g, cx, y + h / 2, 34, { fill: th.a1 });
          g.fillStyle = "#06222E"; g.font = font(900, 36); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), cx, y + h / 2 + 2);
          const m = muatkan(g, x, 430, 800, 36, 2, 22), lh = Math.round(m.size * 1.2), y1 = y + h / 2 - ((m.baris.length - 1) * lh) / 2;
          g.fillStyle = th.ink; g.font = font(800, m.size); g.textAlign = "left"; m.baris.forEach((b, bi) => g.fillText(b, 172, y1 + bi * lh + 2));
          g.restore();
        });
        if (c.siklus) {
          const pr = eio(P(t, tEnd + 0.1, tEnd + 1.3));
          if (pr > 0) {
            const xa = 640, ya = cyOf(n - 1), yb = cyOf(0), bx = 688;
            g.strokeStyle = th.a3; g.lineWidth = 6; g.lineCap = "round"; g.lineJoin = "round";
            const pts = [[xa, ya], [bx, ya], [bx, yb], [xa + 6, yb]];
            const L = [Math.abs(bx - xa), Math.abs(ya - yb), Math.abs(bx - xa - 6)], tot = L[0] + L[1] + L[2]; let rest = tot * pr;
            g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
            for (let s = 0; s < 3; s++) { const f = Math.min(1, rest / L[s]); g.lineTo(lerp(pts[s][0], pts[s + 1][0], f), lerp(pts[s][1], pts[s + 1][1], f)); rest -= L[s]; if (rest <= 0) break; }
            g.stroke();
            if (pr > 0.97) { g.fillStyle = th.a3; g.beginPath(); g.moveTo(xa - 2, yb); g.lineTo(xa + 16, yb - 12); g.lineTo(xa + 16, yb + 12); g.closePath(); g.fill(); }
          }
        }
        paragraf(g, t, c.keterangan, { x: W / 2, y: Math.min(1085, y0 + n * pitch + 40), size: 34, weight: 700, color: th.a1, t0: tEnd + (c.siklus ? 1.6 : 0.4), align: "center", maksBaris: 2, maxW: 620, gap: 0.06 });
      }
    };
  }
};
