// Pustaka benda ilustrasi (vektor, digambar dari kode). Tiap benda digambar berpusat di (0,0) dengan lebar kira-kira 100-160 satuan.
// Posisi, skala, dan animasi masuk diatur oleh penjelas.js; di sini hanya bentuk dan gerakan diam (idle).
// Tanda tangan: gambar(g, t, o) dengan o = { aktif: 0..1 (sorotan), nilai: 0..1 (isi/besaran), arah: 1|-1 }.
import { kotak, lerp, eo, clamp } from "./engine.js";
import { kapal, balok } from "./ilustrasi.js";

const TINTA = "rgba(11,26,43,0.55)";
const garis = (g, lw = 3) => { g.strokeStyle = TINTA; g.lineWidth = lw; g.lineJoin = "round"; g.stroke(); };
const lingk = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, 6.283); };
const grad = (g, x0, y0, x1, y1, ...stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c)); return gr; };
const gradR = (g, x, y, r0, r1, ...stops) => { const gr = g.createRadialGradient(x, y, r0, x, y, r1); stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c)); return gr; };

const BULATAN_AWAN = (w, h) => [[-w * 0.3, h * 0.08, h * 0.38], [-w * 0.08, -h * 0.14, h * 0.48], [w * 0.2, -h * 0.02, h * 0.4], [w * 0.36, h * 0.12, h * 0.3]];
/** Awan dari gabungan lingkaran; garis tepi hanya di sisi luar. */
function awanGambar(g, w, h, isi) {
  const b = BULATAN_AWAN(w, h);
  g.fillStyle = TINTA; for (const [x, y, r] of b) { lingk(g, x, y, r + 3); g.fill(); } g.fillRect(-w * 0.3, h * 0.1, w * 0.66, h * 0.3 + 3);
  g.fillStyle = isi; for (const [x, y, r] of b) { lingk(g, x, y, r); g.fill(); } g.fillRect(-w * 0.3, h * 0.1, w * 0.66, h * 0.3);
}

export const BENDA = {
  matahari: { nama: "matahari", gambar(g, t, o) {
    g.save(); g.rotate(t * 0.4);
    g.fillStyle = "#FFB830"; for (let i = 0; i < 12; i++) { g.save(); g.rotate(i * Math.PI / 6); g.beginPath(); g.moveTo(-7, -56); g.lineTo(0, -80 - (i % 2) * 8); g.lineTo(7, -56); g.closePath(); g.fill(); g.restore(); }
    g.restore();
    g.fillStyle = gradR(g, -10, -10, 4, 52, "#FFF3A0", "#FFD23F", "#FFA726"); lingk(g, 0, 0, 50); g.fill(); garis(g, 3);
  } },
  bulan: { nama: "bulan", gambar(g) {
    g.fillStyle = gradR(g, -14, -14, 4, 56, "#FFFDF0", "#E8E6D4", "#BDBBA8"); lingk(g, 0, 0, 52); g.fill(); garis(g, 3);
    g.fillStyle = "rgba(120,118,100,0.35)"; for (const [x, y, r] of [[-18, -12, 11], [14, 8, 15], [-8, 24, 7], [22, -22, 6]]) { lingk(g, x, y, r); g.fill(); }
  } },
  bumi: { nama: "bumi", gambar(g, t) {
    g.save(); lingk(g, 0, 0, 56); g.clip();
    g.fillStyle = grad(g, -56, -56, 56, 56, "#59C3F0", "#1F6FB5"); g.fillRect(-60, -60, 120, 120);
    g.fillStyle = "#4CAF50"; const off = (t * 14) % 120;
    for (const k of [-120, 0]) for (const [x, y, w, h] of [[-30, -18, 34, 22], [14, 14, 26, 30], [-6, 30, 18, 12], [34, -22, 18, 14]]) { g.beginPath(); g.ellipse(x + k + off, y, w, h, 0.3, 0, 6.283); g.fill(); }
    g.fillStyle = "rgba(255,255,255,0.22)"; lingk(g, -20, -22, 26); g.fill(); g.restore();
    lingk(g, 0, 0, 56); garis(g, 3.5);
  } },
  planet: { nama: "planet bercincin", gambar(g) {
    g.strokeStyle = "rgba(255,213,128,0.9)"; g.lineWidth = 9; g.beginPath(); g.ellipse(0, 0, 82, 22, -0.35, Math.PI, 6.283); g.stroke();
    g.fillStyle = grad(g, -40, -40, 40, 40, "#FFC27A", "#E8743B"); lingk(g, 0, 0, 42); g.fill(); garis(g, 3);
    g.save(); lingk(g, 0, 0, 42); g.clip(); g.fillStyle = "rgba(255,255,255,0.22)"; g.fillRect(-45, -12, 90, 9); g.fillRect(-45, 10, 90, 6); g.restore();
    g.strokeStyle = "rgba(255,213,128,0.9)"; g.lineWidth = 9; g.beginPath(); g.ellipse(0, 0, 82, 22, -0.35, 0, Math.PI); g.stroke();
  } },
  planetPolos: { nama: "planet besar bergaris (tanpa cincin)", gambar(g) {
    g.fillStyle = grad(g, -50, -50, 50, 50, "#F2C79A", "#C97B4A"); lingk(g, 0, 0, 54); g.fill();
    g.save(); lingk(g, 0, 0, 54); g.clip(); g.fillStyle = "rgba(255,255,255,0.28)"; g.fillRect(-56, -26, 112, 10); g.fillRect(-56, 4, 112, 14); g.fillStyle = "rgba(150,70,40,0.35)"; g.fillRect(-56, -8, 112, 8); g.fillRect(-56, 28, 112, 8);
    g.fillStyle = "#C0482E"; g.beginPath(); g.ellipse(16, 20, 12, 7, 0, 0, 6.283); g.fill(); g.restore(); lingk(g, 0, 0, 54); garis(g, 3);
  } },
  bintang: { nama: "bintang", gambar(g, t) {
    const k = 1 + 0.08 * Math.sin(t * 4); g.scale(k, k); g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 52, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fillStyle = grad(g, 0, -52, 0, 40, "#FFF08A", "#FFC107"); g.fill(); garis(g, 3);
  } },
  awan: { nama: "awan", gambar(g, t) {
    g.translate(0, Math.sin(t * 1.4) * 3); awanGambar(g, 150, 90, grad(g, 0, -40, 0, 40, "#FFFFFF", "#D4E4F2"));
  } },
  hujan: { nama: "awan hujan", gambar(g, t) {
    g.save(); g.translate(0, -18); awanGambar(g, 160, 92, grad(g, 0, -40, 0, 40, "#B7C4D2", "#7E8FA3")); g.restore();
    g.fillStyle = "#4FB6E8";
    for (let i = 0; i < 7; i++) { const ph = ((t * 1.3 + i * 0.37) % 1), x = -52 + i * 17, y = 32 + ph * 62; g.globalAlpha = 1 - ph * 0.7; g.beginPath(); g.moveTo(x, y - 9); g.quadraticCurveTo(x + 6, y + 2, x, y + 7); g.quadraticCurveTo(x - 6, y + 2, x, y - 9); g.fill(); }
    g.globalAlpha = 1;
  } },
  gunung: { nama: "gunung", gambar(g) {
    g.beginPath(); g.moveTo(-100, 70); g.lineTo(-30, -40); g.lineTo(40, 70); g.closePath(); g.fillStyle = "#7C93B0"; g.fill(); garis(g, 3);
    g.beginPath(); g.moveTo(-40, 70); g.lineTo(40, -75); g.lineTo(115, 70); g.closePath(); g.fillStyle = grad(g, 0, -75, 0, 70, "#9C7A5B", "#6E5440"); g.fill(); garis(g, 3);
    g.beginPath(); g.moveTo(40, -75); g.lineTo(14, -34); g.lineTo(28, -42); g.lineTo(40, -28); g.lineTo(54, -42); g.lineTo(68, -34); g.closePath(); g.fillStyle = "#FFFFFF"; g.fill(); garis(g, 2.5);
  } },
  gunungApi: { nama: "gunung berapi", gambar(g, t) {
    g.beginPath(); g.moveTo(-95, 70); g.lineTo(-24, -34); g.lineTo(24, -34); g.lineTo(95, 70); g.closePath(); g.fillStyle = grad(g, 0, -34, 0, 70, "#8A6A52", "#5A4332"); g.fill(); garis(g, 3);
    g.beginPath(); g.moveTo(-24, -34); g.lineTo(-10, -22); g.lineTo(10, -22); g.lineTo(24, -34); g.closePath(); g.fillStyle = "#FF6A2B"; g.fill();
    g.strokeStyle = "#FF8A3D"; g.lineWidth = 6; g.lineCap = "round"; g.beginPath(); g.moveTo(8, -22); g.quadraticCurveTo(22, 10, 14, 40); g.stroke();
    for (let i = 0; i < 6; i++) { const ph = (t * 0.7 + i / 6) % 1, x = Math.sin(i * 2.3) * 18 + ph * 16, y = -34 - ph * 70; g.globalAlpha = (1 - ph) * 0.8; g.fillStyle = i % 2 ? "#9AA3AD" : "#6F7782"; lingk(g, x, y, 10 + ph * 16); g.fill(); }
    g.globalAlpha = 1;
  } },
  pohon: { nama: "pohon", gambar(g, t) {
    g.fillStyle = "#8D6240"; kotak(g, -10, 8, 20, 62, 4); g.fill(); garis(g, 2.5);
    g.save(); g.translate(0, 8); g.rotate(Math.sin(t * 1.6) * 0.025); g.translate(0, -8);
    for (const [x, y, r, c] of [[-28, -4, 34, "#3E9B4F"], [28, -4, 34, "#3E9B4F"], [0, -34, 40, "#4CB35E"]]) { g.fillStyle = c; lingk(g, x, y, r); g.fill(); garis(g, 2.5); }
    g.restore();
  } },
  daun: { nama: "daun", gambar(g, t) {
    g.rotate(-0.5 + Math.sin(t * 1.5) * 0.05);
    g.beginPath(); g.moveTo(0, 70); g.bezierCurveTo(-70, 30, -50, -50, 0, -78); g.bezierCurveTo(50, -50, 70, 30, 0, 70); g.closePath(); g.fillStyle = grad(g, 0, -78, 0, 70, "#7ED957", "#2E9B4A"); g.fill(); garis(g, 3);
    g.strokeStyle = "rgba(11,26,43,0.4)"; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 70); g.lineTo(0, -60); g.stroke();
    for (const y of [-30, 0, 30]) { g.beginPath(); g.moveTo(0, y + 14); g.lineTo(-24, y - 6); g.moveTo(0, y + 14); g.lineTo(24, y - 6); g.stroke(); }
  } },
  bunga: { nama: "bunga", gambar(g, t) {
    g.strokeStyle = "#3E9B4F"; g.lineWidth = 7; g.beginPath(); g.moveTo(0, 20); g.lineTo(0, 78); g.stroke();
    g.save(); g.translate(0, -8); g.rotate(Math.sin(t * 1.2) * 0.06);
    g.fillStyle = "#FF7DA8"; for (let i = 0; i < 6; i++) { g.save(); g.rotate(i * Math.PI / 3); g.beginPath(); g.ellipse(0, -30, 17, 28, 0, 0, 6.283); g.fill(); garis(g, 2.5); g.restore(); }
    g.fillStyle = "#FFC933"; lingk(g, 0, 0, 16); g.fill(); garis(g, 2.5); g.restore();
  } },
  tetes: { nama: "tetes air", gambar(g, t) {
    g.translate(0, Math.sin(t * 2) * 3); g.beginPath(); g.moveTo(0, -62); g.bezierCurveTo(48, 6, 48, 52, 0, 60); g.bezierCurveTo(-48, 52, -48, 6, 0, -62); g.closePath();
    g.fillStyle = grad(g, -30, -40, 30, 60, "#8EE0FF", "#2C9BD8"); g.fill(); garis(g, 3);
    g.fillStyle = "rgba(255,255,255,0.55)"; g.beginPath(); g.ellipse(-16, 12, 6, 14, 0.3, 0, 6.283); g.fill();
  } },
  ombak: { nama: "laut atau air", gambar(g, t) {
    for (let k = 0; k < 2; k++) {
      g.beginPath(); g.moveTo(-170, 60);
      for (let x = -170; x <= 170; x += 10) g.lineTo(x, -8 + k * 18 + Math.sin(x * 0.04 + t * (2 + k) + k) * 9);
      g.lineTo(170, 60); g.closePath(); g.fillStyle = k ? "rgba(27,127,168,0.9)" : "rgba(79,209,197,0.75)"; g.fill();
    }
    g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 3; g.beginPath(); for (let x = -170; x <= 170; x += 10) { const y = -8 + Math.sin(x * 0.04 + t * 2) * 9; x === -170 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
  } },
  kapal: { nama: "kapal", gambar(g, t) { g.translate(0, Math.sin(t * 1.6) * 3); kapal(g, t, 0, 0, 0.66, { miring: Math.sin(t * 1.3) * 0.03 }); } },
  besi: { nama: "balok besi", gambar(g, t) { balok(g, 0, 0, 96, 0); } },
  rodaGigi: { nama: "roda gigi", gambar(g, t, o) {
    g.rotate(t * 0.8 * (o.arah || 1)); g.beginPath();
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, b = a + Math.PI / 10; g.lineTo(Math.cos(a - 0.12) * 50, Math.sin(a - 0.12) * 50); g.lineTo(Math.cos(a - 0.07) * 66, Math.sin(a - 0.07) * 66); g.lineTo(Math.cos(a + 0.07) * 66, Math.sin(a + 0.07) * 66); g.lineTo(Math.cos(a + 0.12) * 50, Math.sin(a + 0.12) * 50); g.lineTo(Math.cos(b) * 50, Math.sin(b) * 50); }
    g.closePath(); g.fillStyle = grad(g, -60, -60, 60, 60, "#C7D0DA", "#76828F"); g.fill(); garis(g, 3);
    g.fillStyle = "#0F2D4D"; lingk(g, 0, 0, 20); g.fill(); garis(g, 2.5);
  } },
  bohlam: { nama: "lampu", gambar(g, t, o) {
    const n = clamp(o.nilai ?? 1);
    if (n > 0) { g.fillStyle = gradR(g, 0, -20, 10, 110, `rgba(255,230,120,${0.55 * n})`, "rgba(255,230,120,0)"); lingk(g, 0, -20, 110); g.fill(); }
    g.fillStyle = n > 0.5 ? grad(g, 0, -70, 0, 20, "#FFF6B0", "#FFD23F") : "#DDE6EE"; lingk(g, 0, -26, 42); g.fill(); garis(g, 3);
    g.fillStyle = "#9AA6B2"; kotak(g, -20, 12, 40, 14, 3); g.fill(); garis(g, 2.5); kotak(g, -16, 26, 32, 12, 3); g.fill(); garis(g, 2.5); kotak(g, -9, 38, 18, 9, 3); g.fill(); garis(g, 2.5);
    g.strokeStyle = n > 0.5 ? "#E07B00" : "#7E8A96"; g.lineWidth = 3; g.beginPath(); g.moveTo(-10, 12); g.lineTo(-10, -12); g.lineTo(-4, -22); g.lineTo(4, -12); g.lineTo(10, -22); g.lineTo(10, 12); g.stroke();
  } },
  baterai: { nama: "baterai", gambar(g, t, o) {
    kotak(g, -48, -26, 92, 52, 8); g.fillStyle = "#2B3A4D"; g.fill(); garis(g, 3); kotak(g, 44, -11, 12, 22, 3); g.fillStyle = "#9AA6B2"; g.fill(); garis(g, 2.5);
    const n = clamp(o.nilai ?? 0.7); kotak(g, -42, -20, 80 * n, 40, 5); g.fillStyle = n > 0.3 ? "#4ADE80" : "#FF6B6B"; g.fill();
    g.fillStyle = "#fff"; g.font = "900 26px InterMG, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("+", -26, 2); g.fillText("−", 24, 2);
  } },
  magnet: { nama: "magnet", gambar(g) {
    g.lineWidth = 26; g.lineCap = "butt"; g.strokeStyle = "#E5484D"; g.beginPath(); g.arc(0, 0, 44, Math.PI, Math.PI * 1.5, false); g.stroke();
    g.strokeStyle = "#3B82F6"; g.beginPath(); g.arc(0, 0, 44, Math.PI * 1.5, 0, false); g.stroke();
    g.strokeStyle = "#E5484D"; g.beginPath(); g.moveTo(-44, 0); g.lineTo(-44, 50); g.stroke(); g.strokeStyle = "#3B82F6"; g.beginPath(); g.moveTo(44, 0); g.lineTo(44, 50); g.stroke();
    g.fillStyle = "#E8EDF2"; g.fillRect(-57, 50, 26, 16); g.fillRect(31, 50, 26, 16);
  } },
  termometer: { nama: "termometer", gambar(g, t, o) {
    const n = clamp(o.nilai ?? 0.6, 0.05, 1);
    kotak(g, -12, -72, 24, 112, 12); g.fillStyle = "#F4F8FB"; g.fill(); garis(g, 3);
    lingk(g, 0, 50, 24); g.fillStyle = "#E5484D"; g.fill(); garis(g, 3);
    g.fillStyle = "#E5484D"; g.fillRect(-5, 40 - 100 * n, 10, 12 + 100 * n); g.strokeStyle = "rgba(11,26,43,0.4)"; g.lineWidth = 2; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(14, -60 + i * 18); g.lineTo(24, -60 + i * 18); g.stroke(); }
  } },
  jam: { nama: "jam", gambar(g, t) {
    g.fillStyle = "#F6F1E6"; lingk(g, 0, 0, 56); g.fill(); garis(g, 5);
    g.strokeStyle = "rgba(11,26,43,0.6)"; g.lineWidth = 3; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(Math.sin(i * Math.PI / 6) * 46, -Math.cos(i * Math.PI / 6) * 46); g.lineTo(Math.sin(i * Math.PI / 6) * 52, -Math.cos(i * Math.PI / 6) * 52); g.stroke(); }
    g.lineCap = "round"; g.strokeStyle = "#0B1A2B"; g.lineWidth = 6; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(t * 0.2) * 26, -Math.cos(t * 0.2) * 26); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(t * 2.4) * 40, -Math.cos(t * 2.4) * 40); g.stroke(); g.fillStyle = "#E5484D"; lingk(g, 0, 0, 5); g.fill();
  } },
  buku: { nama: "buku", gambar(g, t) {
    g.fillStyle = "#3B82F6"; kotak(g, -78, -48, 156, 100, 8); g.fill(); garis(g, 3);
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, -40); g.lineTo(s * 70, -34); g.lineTo(s * 70, 44); g.lineTo(0, 50); g.closePath(); g.fillStyle = "#FFFDF4"; g.fill(); garis(g, 2.5); g.strokeStyle = "rgba(11,26,43,0.25)"; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(s * 10, -20 + i * 16 + 2); g.lineTo(s * 58, -16 + i * 16); g.stroke(); } }
  } },
  rumah: { nama: "rumah", gambar(g) {
    g.fillStyle = "#F6D9A8"; kotak(g, -56, -6, 112, 76, 4); g.fill(); garis(g, 3);
    g.beginPath(); g.moveTo(-70, -2); g.lineTo(0, -62); g.lineTo(70, -2); g.closePath(); g.fillStyle = "#D1554A"; g.fill(); garis(g, 3);
    g.fillStyle = "#8D6240"; kotak(g, -14, 28, 28, 42, 3); g.fill(); garis(g, 2.5); g.fillStyle = "#8EE0FF"; kotak(g, 26, 10, 22, 22, 3); g.fill(); garis(g, 2.5); kotak(g, -48, 10, 22, 22, 3); g.fill(); garis(g, 2.5);
  } },
  roket: { nama: "roket", gambar(g, t) {
    g.translate(0, Math.sin(t * 5) * 2.5);
    const kobar = 22 + 10 * Math.sin(t * 24); g.beginPath(); g.moveTo(-14, 58); g.quadraticCurveTo(0, 58 + kobar * 2.2, 14, 58); g.fillStyle = "#FFA726"; g.fill(); g.beginPath(); g.moveTo(-8, 58); g.quadraticCurveTo(0, 58 + kobar * 1.4, 8, 58); g.fillStyle = "#FFE066"; g.fill();
    g.fillStyle = "#E5484D"; g.beginPath(); g.moveTo(-30, 20); g.lineTo(-48, 62); g.lineTo(-18, 48); g.closePath(); g.fill(); garis(g, 2.5); g.beginPath(); g.moveTo(30, 20); g.lineTo(48, 62); g.lineTo(18, 48); g.closePath(); g.fill(); garis(g, 2.5);
    g.beginPath(); g.moveTo(0, -78); g.bezierCurveTo(38, -40, 32, 30, 24, 58); g.lineTo(-24, 58); g.bezierCurveTo(-32, 30, -38, -40, 0, -78); g.closePath(); g.fillStyle = grad(g, -30, 0, 30, 0, "#FFFFFF", "#CFD8E3"); g.fill(); garis(g, 3);
    g.fillStyle = "#3FB6D9"; lingk(g, 0, -20, 14); g.fill(); garis(g, 3);
  } },
  gelas: { nama: "gelas ukur", gambar(g, t, o) {
    const n = clamp(o.nilai ?? 0.6), tinggi = 120;
    g.fillStyle = "rgba(79,209,197,0.8)"; g.fillRect(-36, 60 - tinggi * n, 72, tinggi * n); g.fillStyle = "rgba(255,255,255,0.7)"; g.fillRect(-36, 60 - tinggi * n, 72, 3);
    g.beginPath(); g.moveTo(-42, -64); g.lineTo(-38, 56); g.arcTo(-38, 66, -28, 66, 9); g.lineTo(28, 66); g.arcTo(38, 66, 38, 56, 9); g.lineTo(42, -64); g.strokeStyle = "rgba(246,241,230,0.95)"; g.lineWidth = 5; g.lineJoin = "round"; g.stroke();
    g.strokeStyle = "rgba(246,241,230,0.8)"; g.lineWidth = 2.5; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-38, -44 + i * 24); g.lineTo(-24, -44 + i * 24); g.stroke(); }
  } },
  pie: { nama: "lingkaran pecahan", gambar(g, t, o) {
    const n = clamp(o.nilai ?? 0.25, 0, 1);
    g.fillStyle = "#F6F1E6"; lingk(g, 0, 0, 58); g.fill();
    g.fillStyle = "#FF9F43"; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 58, -Math.PI / 2, -Math.PI / 2 + n * 6.283); g.closePath(); g.fill();
    lingk(g, 0, 0, 58); garis(g, 4);
  } },
  ikan: { nama: "ikan", gambar(g, t) {
    g.translate(Math.sin(t * 1.5) * 6, Math.sin(t * 3) * 3); const e = Math.sin(t * 7) * 0.12;
    g.fillStyle = "#FF8A5B"; g.beginPath(); g.moveTo(52, 0); g.lineTo(88, -26 + e * 40); g.lineTo(80, 0); g.lineTo(88, 26 - e * 40); g.closePath(); g.fill(); garis(g, 3);
    g.beginPath(); g.ellipse(0, 0, 58, 34, 0, 0, 6.283); g.fillStyle = grad(g, 0, -34, 0, 34, "#FFB36B", "#FF7A45"); g.fill(); garis(g, 3);
    g.fillStyle = "#fff"; lingk(g, -32, -8, 8); g.fill(); g.fillStyle = "#0B1A2B"; lingk(g, -34, -8, 4); g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.ellipse(6, -14, 22, 6, 0, 0, 6.283); g.fill();
  } },
  orang: { nama: "orang", gambar(g, t) {
    g.fillStyle = "#F2C9A0"; lingk(g, 0, -52, 22); g.fill(); garis(g, 3);
    g.fillStyle = "#3B82F6"; kotak(g, -26, -26, 52, 66, 16); g.fill(); garis(g, 3);
    g.fillStyle = "#2B3A4D"; kotak(g, -22, 36, 18, 38, 6); g.fill(); garis(g, 2.5); kotak(g, 4, 36, 18, 38, 6); g.fill(); garis(g, 2.5);
    g.strokeStyle = "#3B82F6"; g.lineWidth = 12; g.lineCap = "round"; g.beginPath(); g.moveTo(-26, -14); g.lineTo(-42, 12 + Math.sin(t * 3) * 4); g.moveTo(26, -14); g.lineTo(42, 12 - Math.sin(t * 3) * 4); g.stroke();
  } },
  petir: { nama: "petir", gambar(g, t) {
    const k = 0.85 + 0.15 * Math.abs(Math.sin(t * 9)); g.scale(k, k);
    g.beginPath(); g.moveTo(14, -78); g.lineTo(-38, 8); g.lineTo(-6, 8); g.lineTo(-18, 76); g.lineTo(42, -16); g.lineTo(6, -16); g.closePath(); g.fillStyle = grad(g, 0, -78, 0, 76, "#FFF08A", "#FFB300"); g.fill(); garis(g, 3);
  } },
  kompas: { nama: "kompas", gambar(g, t) {
    g.fillStyle = "#F6F1E6"; lingk(g, 0, 0, 58); g.fill(); garis(g, 6);
    g.save(); g.rotate(Math.sin(t * 1.2) * 0.25);
    g.fillStyle = "#E5484D"; g.beginPath(); g.moveTo(0, -46); g.lineTo(-11, 0); g.lineTo(11, 0); g.closePath(); g.fill(); g.fillStyle = "#3B82F6"; g.beginPath(); g.moveTo(0, 46); g.lineTo(-11, 0); g.lineTo(11, 0); g.closePath(); g.fill();
    g.restore(); g.fillStyle = "#0B1A2B"; lingk(g, 0, 0, 5); g.fill();
    g.fillStyle = "rgba(11,26,43,0.7)"; g.font = "800 14px InterMG, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("U", 0, -50 + 8);
  } },
  pelangi: { nama: "pelangi atau cahaya warna-warni", gambar(g) {
    const w = ["#E5484D", "#FF9F43", "#FFD23F", "#4ADE80", "#3B82F6", "#8B5CF6"]; g.lineWidth = 11; g.lineCap = "butt";
    w.forEach((c, i) => { g.strokeStyle = c; g.beginPath(); g.arc(0, 40, 78 - i * 10.5, Math.PI, 6.283); g.stroke(); });
  } },
  panah_besar: { nama: "panah besar", gambar(g) {
    g.beginPath(); g.moveTo(-60, -16); g.lineTo(10, -16); g.lineTo(10, -40); g.lineTo(64, 0); g.lineTo(10, 40); g.lineTo(10, 16); g.lineTo(-60, 16); g.closePath(); g.fillStyle = "#FFC857"; g.fill(); garis(g, 3);
  } }
};
export const DAFTAR_BENDA = Object.keys(BENDA);

/** Gambar satu benda di (x,y) dengan skala s. p = kemajuan animasi masuk (0..1), masuk = gaya masuk. */
export function gambarBenda(g, t, jenis, { x, y, s = 1, p = 1, masuk = "pop", aktif = 0, nilai, arah, alfa = 1 } = {}) {
  const b = BENDA[jenis]; if (!b || p <= 0) return;
  const e = eo(clamp(p)); let dx = 0, dy = 0, k = 1, a = 1;
  if (masuk === "pop") { const c1 = 1.9, c3 = c1 + 1; k = p >= 1 ? 1 : Math.max(0.001, 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)); a = clamp(p * 4); }
  else if (masuk === "jatuh") { dy = -(1 - e) * 360; a = clamp(p * 5); }
  else if (masuk === "naik") { dy = (1 - e) * 200; a = e; }
  else if (masuk === "kiri") { dx = -(1 - e) * 360; a = clamp(p * 4); }
  else if (masuk === "kanan") { dx = (1 - e) * 360; a = clamp(p * 4); }
  else if (masuk === "tumbuh") { k = e; a = clamp(p * 5); }
  g.save(); g.globalAlpha = a * alfa; g.translate(x + dx, y + dy);
  if (aktif > 0) { g.strokeStyle = `rgba(255,200,87,${0.55 * aktif})`; g.lineWidth = 6; g.setLineDash([10, 8]); g.beginPath(); g.arc(0, 0, (88 + 6 * Math.sin(t * 6)) * s * k, 0, 6.283); g.stroke(); g.setLineDash([]); }
  g.scale(s * k, s * k); b.gambar(g, t, { aktif, nilai, arah }); g.restore();
}
