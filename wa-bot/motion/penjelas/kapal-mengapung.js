// Contoh video penjelas bergaya "bongkar benda" (ilustrasi vektor + kamera bergerak + takarir): Kenapa kapal besi mengapung?
// Templat ini ditulis khusus untuk satu topik (prototipe). Bagian umumnya ada di ../ilustrasi.js.
import { clamp, P, lerp, eo, eio, efek } from "../engine.js";
import { WR, resetTema, kamera, pakaiKamera, latarGambar, tinggiAir, bakBelakang, bakDepan, riak, gelembung, balok, kapal, lambung, GARIS_AIR, panah, label, takarir, lapisBawah, kepala, kapsul, panelBatang, kartuInti, kaki } from "../ilustrasi.js";

const TANK = { x: 120, y: 470, w: 480, h: 430 }, LEVEL = 640, DUR = 40;
const KUNCI = [
  { t: 0, x: 360, y: 600, z: 1 }, { t: 9.6, x: 360, y: 600, z: 1 },
  { t: 11.6, x: 400, y: 660, z: 1.2 }, { t: 23.4, x: 400, y: 660, z: 1.2 },
  { t: 26, x: 360, y: 650, z: 1.25 }
];
const BAB = [
  { t: 0, judul: "Besi itu berat", chip: "Besi **tenggelam**" },
  { t: 10.2, judul: "Dorongan air", chip: "Kapal **mengapung**?" },
  { t: 24, judul: "Rongga udara", chip: "Kuncinya: **rongga**" }
];
const TAKARIR = [
  [0.3, 3.4, "Sebongkah **besi** dijatuhkan ke air,"],
  [3.4, 6.2, "dan langsung **tenggelam**."],
  [6.2, 10.2, "Besi **lebih padat** dari air."],
  [10.4, 13.2, "Lalu datanglah **kapal** besi."],
  [13.2, 16.6, "Lambungnya **mendesak** air ke samping."],
  [16.6, 20.4, "Air **membalas** dengan dorongan ke atas."],
  [20.4, 24.0, "Kalau kedua dorongan **sama besar**, kapal **mengapung**."],
  [24.0, 27.6, "Kuncinya ada di **rongga** dalam kapal."],
  [27.6, 31.0, "Isinya **banyak udara**, bukan besi padat."],
  [31.0, 35.6, "Jadi rata-rata, kapal **lebih ringan** dari air."]
];
const tanpaTanda = (s) => s.replace(/\*\*/g, "");

const amp = (t) => 2.5 + (t > 2.4 ? 16 * Math.exp(-(t - 2.4) * 1.1) : 0) + (t > 11.2 ? 13 * Math.exp(-(t - 11.2) * 1.2) : 0);
const S = 1.1; // skala kapal
const BALOK_S = 84, LANTAI = TANK.y + TANK.h - BALOK_S / 2 - 4;

function posBalok(t) {
  if (t < 1.8) return { y: 330 + 4 * Math.sin(t * 2), rot: 0.03 * Math.sin(t * 2) };
  if (t < 2.4) return { y: 330 + 0.5 * 1489 * (t - 1.8) ** 2, rot: 0 };
  const p = eo(clamp((t - 2.4) / 1.9)), awal = LEVEL - BALOK_S / 2;
  return { y: lerp(awal, LANTAI, p), rot: Math.sin((t - 2.4) * 3.2) * 0.3 * (1 - p) };
}
function posKapal(t) {
  const surf = tinggiAir(360, t, LEVEL, amp(t));
  let dy = 0, miring = 0;
  if (t < 11.2) { const u = clamp((t - 10.4) / 0.8); dy = -620 * (1 - u * u); }
  else { const d = t - 11.2; dy = 26 * Math.exp(-d * 1.4) * Math.sin(d * 5.5); miring = 0.035 * Math.sin(d * 1.9) * Math.exp(-d * 0.15); }
  return { cx: 360 + (t > 11.2 ? 3 * Math.sin((t - 11.2) * 1.2) : 0), cy: surf - GARIS_AIR * S + dy, miring };
}
function gelas(g, x, y, w, h, isi, t) {
  g.save();
  if (isi > 0) { const hh = h * 0.78 * isi; g.fillStyle = "rgba(79,209,197,0.8)"; g.fillRect(x + 3, y + h - hh - 3, w - 6, hh); g.fillStyle = "rgba(255,255,255,0.7)"; g.fillRect(x + 3, y + h - hh - 3, w - 6, 3); }
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + h - 6); g.arcTo(x + 4, y + h, x + 14, y + h, 8); g.lineTo(x + w - 14, y + h); g.arcTo(x + w - 4, y + h, x + w - 4, y + h - 6, 8); g.lineTo(x + w, y);
  g.strokeStyle = "rgba(246,241,230,0.9)"; g.lineWidth = 4; g.lineJoin = "round"; g.stroke();
  g.restore();
}
function hantu(g, t, p) { // air yang terdesak: bentuk bagian lambung yang tercelup, terangkat ke gelas
  const k = posKapal(Math.min(t, 13.2));
  const geser = eio(clamp((t - 14.3) / 1.9));
  const tujuanX = 650, tujuanY = 770;
  const sk = lerp(S, 0.42, geser), x0 = k.cx, y0 = k.cy + GARIS_AIR * S;
  const cx = lerp(x0, tujuanX, geser), cy = lerp(y0, tujuanY - 12, geser) - Math.sin(geser * Math.PI) * 120;
  g.save(); g.globalAlpha = p * (1 - eo(clamp((t - 16.0) / 0.5))); g.translate(cx, cy); g.scale(sk, sk);
  g.beginPath(); const [l0, r0] = lambung(GARIS_AIR), [l1, r1] = lambung(40);
  g.moveTo(l0, 0); g.lineTo(r0, 0); g.lineTo(r1, 40 - GARIS_AIR); g.lineTo(l1, 40 - GARIS_AIR); g.closePath();
  g.fillStyle = "rgba(255,255,255,0.28)"; g.fill(); g.setLineDash([8, 6]); g.strokeStyle = "#fff"; g.lineWidth = 3 / sk; g.stroke(); g.setLineDash([]);
  g.restore();
}

export default {
  id: "penjelas-kapal", nama: "Penjelas: kapal besi mengapung", hari: null, jalur: "ilustrasi", tema: "ocean",
  musik: { bpm: 84, akor: [[53, [53, 57, 60]], [55, [55, 59, 62]], [57, [57, 60, 64]], [50, [50, 53, 57]]], kick: false, hat: true },
  petunjukIsi: "(prototipe: isi tetap)", contoh: {},
  rapikan: () => ({ ok: true, galat: [], isi: {} }),
  narasi: () => TAKARIR.map((s) => tanpaTanda(s[2])).join(" "),
  bangun() {
    const sfx = efek([1.8, "whoosh", { gain: 0.3 }], [2.4, "pop", { f: 300, gain: 0.7 }], [4.1, "thud", { gain: 0.5 }], [6.6, "pop", { f: 520 }], [7.1, "pop", { f: 620 }],
      [10.4, "whoosh", { gain: 0.3 }], [11.2, "pop", { f: 280, gain: 0.7 }], [13.4, "pop", { f: 560 }], [14.4, "whoosh", { gain: 0.25 }], [16.2, "pop", { f: 700 }],
      [17.0, "pop", { f: 480 }], [17.9, "pop", { f: 560 }], [20.8, "chime", { gain: 0.4 }], [24.4, "whoosh", { gain: 0.25 }], [28.0, "pop", { f: 600 }], [31.6, "pop", { f: 520 }], [36.2, "chime", { gain: 0.5 }]);
    return {
      durasi: DUR, efek: sfx,
      gambar(g, t) {
        resetTema(); const cam = kamera(KUNCI, t), a = amp(t), z = cam.z;
        latarGambar(g, cam);
        g.save(); pakaiKamera(g, cam);
        bakBelakang(g, TANK.x, TANK.y, TANK.w, TANK.h);
        // balok besi
        const b = posBalok(t); if (t < 2.4) balok(g, 360, b.y, BALOK_S, b.rot);
        if (t < 1.8) label(g, t, 0.6, "balok besi", 360 - 30, 318, 215, 262, z, WR.amber);
        // kapal
        if (t >= 10.4) { const k = posKapal(t); kapal(g, t, k.cx, k.cy, S, { miring: k.miring, potong: P(t, 24.5, 25.6) }); }
        bakDepan(g, t, { ...TANK, level: LEVEL, amp: a });
        if (t >= 2.4) { g.save(); g.globalAlpha = 0.88; balok(g, 360, b.y, BALOK_S, b.rot); g.restore(); }
        gelembung(g, t, 2.5, 360, 850, LEVEL, 16);
        riak(g, t, 2.4, 360, LEVEL, { maks: 3 }); riak(g, t, 11.2, 360, LEVEL, { maks: 3, kec: 210 });
        // bab 1: label tenggelam
        if (t < 9.8) label(g, t, 4.6, "tenggelam", 360 + 30, 850, 485, 790, z, WR.karat);
        // bab 2: air terdesak, gelas, panah gaya
        if (t >= 13.2 && t < 16.6) hantu(g, t, eo(clamp((t - 13.2) / 0.5)));
        if (t >= 13.2 && t < 24.4) {
          const isi = eo(clamp((t - 16.0) / 1.2));
          gelas(g, 620, 720, 64, 100, isi, t);
          if (t < 24) label(g, t, 15.4, "air tergeser", 652, 790, 600, 690, z, WR.biru);
        }
        if (t >= 16.6 && t < 24.2) {
          const k = posKapal(t), pudar = 1 - eo(P(t, 23.6, 24.2));
          g.save(); g.globalAlpha = pudar;
          panah(g, 320, k.cy + 10, k.cy + 118, WR.karat, (t - 17.6) / 0.7);
          panah(g, 410, k.cy + 190, k.cy + 74, WR.teal, (t - 17.0) / 0.7);
          if (t > 18.3) label(g, t, 18.4, "berat kapal", 320, k.cy + 100, 230, k.cy + 175, z, WR.karat);
          if (t > 17.7) label(g, t, 17.8, "dorongan air", 410, k.cy + 160, 505, k.cy + 235, z, WR.teal);
          if (t > 20.6) { const e = eo(clamp((t - 20.6) / 0.4)); g.fillStyle = WR.amber; g.beginPath(); g.arc(365, k.cy + 112, 26 * e, 0, 6.283); g.fill(); g.fillStyle = WR.tinta; g.font = `900 ${34 * e}px InterMG, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("=", 365, k.cy + 114); }
          g.restore();
        }
        // bab 3: label rongga dan perbandingan
        if (t >= 25.2 && t < 36) {
          const k = posKapal(t);
          label(g, t, 25.6, "rongga udara", 360, k.cy + 10 * S, 190, 575, z, WR.biru);
          label(g, t, 28.4, "besi padat: tenggelam", 360 - 30, LANTAI, 330, 800, z, WR.karat);
          label(g, t, 29.4, "berongga: mengapung", 360 + 70, k.cy + 14 * S, 480, 700, z, WR.teal);
        }
        g.restore();
        lapisBawah(g);
        // elemen layar
        const bab = [...BAB].reverse().find((x) => t >= x.t) || BAB[0], nomor = BAB.indexOf(bab) + 1;
        kepala(g, t, { nomor, total: BAB.length, judul: bab.judul, tBab: bab.t });
        kapsul(g, t, bab.t + 0.3, bab.chip);
        panelBatang(g, t, 6.2, { judul: "kerapatan (kg per meter kubik)", maks: 8000, t1: 10.0, baris: [{ nama: "besi", nilai: 7800, warna: WR.amber, tampil: "sekitar 7.800" }, { nama: "air", nilai: 1000, warna: WR.teal, tampil: "sekitar 1.000" }] });
        panelBatang(g, t, 31.0, { judul: "kerapatan rata-rata", maks: 1000, t1: 35.6, garisBanding: 1, baris: [{ nama: "air", nilai: 1000, warna: WR.teal, tampil: "1.000" }, { nama: "kapal", nilai: 380, warna: WR.amber, tampil: "lebih kecil" }] });
        takarir(g, t, TAKARIR);
        kartuInti(g, t, 36.0, "Bentuk **berongga** membuat kapal mendesak **banyak air**, dan itulah yang menahannya.");
        kaki(g, t, DUR, "Dasar: prinsip Archimedes. Gaya apung sama dengan berat air yang terdesak.");
      }
    };
  }
};
