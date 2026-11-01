// Pustaka ilustrasi untuk video penjelas bergaya "bongkar benda": objek digambar dari kode (vektor),
// kamera bergerak (geser + zoom), label panah, takarir kata-demi-kata, kartu kepala bab.
// Semua fungsi murni gambar di atas kanvas 720x1280 (lihat engine.js); tanpa berkas gambar dari luar.
import { W, H, clamp, P, lerp, eo, eio, pop, font, kotak } from "./engine.js";

export const WR = {
  bg1: "#12365C", bg2: "#08182B", garis: "rgba(160,200,255,0.07)", garisBesar: "rgba(160,200,255,0.14)",
  krem: "#F6F1E6", tinta: "#0B1A2B", amber: "#FFC857", teal: "#4FD1C5", karat: "#FF7A59", merah: "#B8434F", biru: "#3FB6D9", birutua: "#1B7FA8"
};

const WR0 = { ...WR };
/** Pakai warna dari tema (THEMES) agar tiap pekan/hari berbeda; resetTema() mengembalikan warna bawaan. */
export function pakaiTema(th) { Object.assign(WR, { bg1: th.bg2, bg2: th.bg, amber: th.a1, teal: th.a2, karat: th.a3 }); }
export function resetTema() { Object.assign(WR, WR0); }

// ---------- kamera ----------
/** kunci: [{t,x,y,z}] diurutkan; interpolasi mulus (ease in-out) di antara dua kunci, tahan di ujung. */
export function kamera(kunci, t) {
  if (t <= kunci[0].t) return { x: kunci[0].x, y: kunci[0].y, z: kunci[0].z };
  for (let i = 1; i < kunci.length; i++) {
    if (t <= kunci[i].t) {
      const a = kunci[i - 1], b = kunci[i], k = eio(P(t, a.t, b.t));
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) };
    }
  }
  const z = kunci[kunci.length - 1]; return { x: z.x, y: z.y, z: z.z };
}
export const pakaiKamera = (g, c, tx = 360, ty = 600) => { g.translate(tx, ty); g.scale(c.z, c.z); g.translate(-c.x, -c.y); };

/** Latar papan gambar: gradasi layar + kisi yang ikut bergerak bersama kamera. Panggil sebelum pakaiKamera. */
export function latarGambar(g, c) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, WR.bg1); gr.addColorStop(1, WR.bg2);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.save(); pakaiKamera(g, c);
  const x0 = c.x - 380 / c.z, x1 = c.x + 380 / c.z, y0 = c.y - 620 / c.z, y1 = c.y + 700 / c.z;
  for (const [step, warna, lw] of [[60, WR.garis, 1.5], [300, WR.garisBesar, 2.5]]) {
    g.strokeStyle = warna; g.lineWidth = lw / c.z; g.beginPath();
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { g.moveTo(x, y0); g.lineTo(x, y1); }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { g.moveTo(x0, y); g.lineTo(x1, y); }
    g.stroke();
  }
  g.restore();
}

// ---------- air ----------
export const tinggiAir = (px, t, level, amp) => level + amp * Math.sin(px * 0.045 + t * 3.2) + 1.5 * Math.sin(px * 0.11 + t * 1.7);
/** Bak kaca: bagian belakang (panggil sebelum objek) dan depan (air tembus pandang + kaca; panggil setelah objek). */
export function bakBelakang(g, x, y, w, h) {
  kotak(g, x, y, w, h, 14); g.fillStyle = "rgba(255,255,255,0.035)"; g.fill();
}
export function bakDepan(g, t, { x, y, w, h, level, amp }) {
  g.save();
  g.beginPath(); g.moveTo(x, tinggiAir(x, t, level, amp));
  for (let px = x; px <= x + w; px += 6) g.lineTo(px, tinggiAir(px, t, level, amp));
  g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath();
  const gr = g.createLinearGradient(0, level, 0, y + h); gr.addColorStop(0, "rgba(79,209,197,0.50)"); gr.addColorStop(1, "rgba(27,127,168,0.78)");
  g.fillStyle = gr; g.fill();
  g.beginPath(); for (let px = x; px <= x + w; px += 6) { const yy = tinggiAir(px, t, level, amp); px === x ? g.moveTo(px, yy) : g.lineTo(px, yy); }
  g.strokeStyle = "rgba(255,255,255,0.65)"; g.lineWidth = 3; g.stroke();
  // kaca (huruf U terbuka di atas)
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h - 14); g.arcTo(x, y + h, x + 14, y + h, 14); g.lineTo(x + w - 14, y + h); g.arcTo(x + w, y + h, x + w, y + h - 14, 14); g.lineTo(x + w, y);
  g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 5; g.lineJoin = "round"; g.stroke();
  g.fillStyle = "rgba(255,255,255,0.10)"; g.fillRect(x + 12, y + 24, 8, h - 80);
  g.restore();
}
export function riak(g, t, t0, x, y, { maks = 3, kec = 170 } = {}) {
  for (let k = 0; k < maks; k++) {
    const r = (t - t0 - k * 0.22) * kec; if (r <= 0) continue;
    const a = clamp(1 - r / 190); if (a <= 0) continue;
    g.strokeStyle = `rgba(255,255,255,${0.7 * a})`; g.lineWidth = 3;
    g.beginPath(); g.ellipse(x, y, r, r * 0.16, 0, 0, 6.283); g.stroke();
  }
}
export function gelembung(g, t, t0, x0, yBawah, ySurf, n = 14) {
  for (let i = 0; i < n; i++) {
    const h = Math.sin(i * 91.7) * 0.5 + 0.5, h2 = Math.sin(i * 33.1 + 2) * 0.5 + 0.5;
    const lahir = t0 + i * 0.12 + h * 0.2, umur = t - lahir; if (umur < 0) continue;
    const y = yBawah - umur * (70 + 80 * h2); if (y < ySurf) continue;
    const x = x0 + (h - 0.5) * 80 + Math.sin(umur * 6 + i) * 6, r = 3 + 5 * h2;
    g.strokeStyle = `rgba(255,255,255,${0.75 * clamp(1 - (yBawah - y) / 380)})`; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.stroke();
  }
}

// ---------- benda ----------
export function balok(g, cx, cy, s, rot = 0) {
  g.save(); g.translate(cx, cy); g.rotate(rot);
  const gr = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2); gr.addColorStop(0, "#E8EDF2"); gr.addColorStop(0.5, "#9AA6B2"); gr.addColorStop(1, "#5E6B78");
  kotak(g, -s / 2, -s / 2, s, s, 8); g.fillStyle = gr; g.fill(); g.strokeStyle = "rgba(11,26,43,0.55)"; g.lineWidth = 3; g.stroke();
  g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(-s / 2 + 8, -s / 2 + 8, s - 16, 7);
  g.fillStyle = "rgba(11,26,43,0.7)"; g.font = font(900, s * 0.28); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("BESI", 0, 6);
  g.restore();
}
/** Lunas kapal: x kiri/kanan pada ketinggian y lokal (dek y=-20, dasar y=40). */
export const lambung = (y) => { const f = (y + 20) / 60; return [lerp(-120, -95, f), lerp(130, 95, f)]; };
export const GARIS_AIR = 14; // y lokal garis air kapal
/** Gambar kapal. (cx, cy) = titik asal lokal; s = skala. potong = tampilkan penampang (rongga udara terlihat). */
export function kapal(g, t, cx, cy, s = 1, { miring = 0, potong = 0 } = {}) {
  g.save(); g.translate(cx, cy); g.rotate(miring); g.scale(s, s);
  // kontainer & anjungan
  const kon = [["#4FD1C5", 20], ["#FFC857", 56], ["#FF7A59", 92]];
  for (const [w, x] of kon) { g.fillStyle = w; kotak(g, x, -48, 32, 28, 3); g.fill(); g.strokeStyle = "rgba(11,26,43,0.4)"; g.lineWidth = 2; g.stroke(); }
  g.fillStyle = "#F6F1E6"; kotak(g, -56, -72, 74, 52, 6); g.fill(); g.strokeStyle = "rgba(11,26,43,0.45)"; g.lineWidth = 2.5; g.stroke();
  g.fillStyle = "#3FB6D9"; for (let i = 0; i < 3; i++) { kotak(g, -48 + i * 22, -62, 16, 14, 3); g.fill(); }
  g.fillStyle = "#F6F1E6"; kotak(g, -38, -92, 38, 24, 5); g.fill(); g.stroke();
  g.fillStyle = "#FFC857"; kotak(g, -100, -64, 26, 44, 4); g.fill(); g.strokeStyle = "rgba(11,26,43,0.45)"; g.stroke();
  g.fillStyle = "#0B1A2B"; g.fillRect(-100, -64, 26, 9);
  // lambung
  const jalur = () => { g.beginPath(); g.moveTo(-120, -20); g.lineTo(130, -20); g.lineTo(95, 40); g.lineTo(-95, 40); g.closePath(); };
  jalur(); g.fillStyle = WR.karat; g.fill();
  g.save(); jalur(); g.clip(); g.fillStyle = WR.merah; g.fillRect(-140, GARIS_AIR, 300, 40);
  g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(-140, -20, 300, 5); g.restore();
  if (potong > 0) { // penampang: ruang kosong berisi udara
    g.save(); g.globalAlpha = eo(potong);
    g.beginPath(); g.moveTo(-104, -12); g.lineTo(118, -12); g.lineTo(88, 34); g.lineTo(-88, 34); g.closePath();
    g.fillStyle = "rgba(246,241,230,0.88)"; g.fill();
    g.setLineDash([7, 6]); g.strokeStyle = "rgba(11,26,43,0.55)"; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
    g.fillStyle = "rgba(63,182,217,0.55)";
    for (let i = 0; i < 9; i++) { const bx = -80 + i * 24 + Math.sin(t * 1.5 + i) * 3, by = 4 + ((i * 37) % 22) + Math.sin(t * 2 + i * 2) * 3; g.beginPath(); g.arc(bx, by, 4 + (i % 3), 0, 6.283); g.fill(); }
    g.restore();
  }
  jalur(); g.strokeStyle = "rgba(11,26,43,0.6)"; g.lineWidth = 3; g.lineJoin = "round"; g.stroke();
  g.restore();
}

// ---------- anotasi ----------
export function panah(g, x, y1, y2, warna, prog, lw = 12) {
  const p = eo(clamp(prog)); if (p <= 0) return;
  const yEnd = lerp(y1, y2, p), arah = Math.sign(y2 - y1) || 1, kepala = 26;
  g.save(); g.strokeStyle = warna; g.fillStyle = warna; g.lineWidth = lw; g.lineCap = "round";
  g.beginPath(); g.moveTo(x, y1); g.lineTo(x, yEnd - arah * (Math.abs(yEnd - y1) > kepala ? kepala * 0.6 : 0)); g.stroke();
  if (Math.abs(yEnd - y1) > 10) { g.beginPath(); g.moveTo(x, yEnd); g.lineTo(x - kepala * 0.8, yEnd - arah * kepala); g.lineTo(x + kepala * 0.8, yEnd - arah * kepala); g.closePath(); g.fill(); }
  g.restore();
}
/** Label berpenunjuk: titik di (ax,ay), kapsul putih di (bx,by). Ukuran teks tetap di layar meski kamera zoom (z). */
export function label(g, t, t0, teks, ax, ay, bx, by, z = 1, warna = WR.teal) {
  const k = pop(t, t0, t0 + 0.4); if (k <= 0) return;
  g.save();
  g.strokeStyle = "rgba(246,241,230,0.9)"; g.lineWidth = 2 / z; g.setLineDash([4 / z, 4 / z]);
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
  g.fillStyle = warna; g.beginPath(); g.arc(ax, ay, 7 / z, 0, 6.283); g.fill(); g.strokeStyle = WR.tinta; g.lineWidth = 2 / z; g.stroke();
  g.translate(bx, by); g.scale(k / z, k / z);
  g.font = font(800, 24); const w = g.measureText(teks).width + 30;
  kotak(g, -w / 2, -20, w, 40, 20); g.fillStyle = WR.krem; g.fill(); g.strokeStyle = WR.tinta; g.lineWidth = 2.5; g.stroke();
  g.fillStyle = warna; g.beginPath(); g.arc(-w / 2 + 16, 0, 5, 0, 6.283); g.fill();
  g.fillStyle = WR.tinta; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(teks, 6, 1);
  g.restore();
}

// ---------- elemen layar (tidak ikut kamera) ----------
function urai(teks) {
  const out = []; let k = false;
  for (const mentah of String(teks).split(/\s+/).filter(Boolean)) {
    const m = mentah.match(/^(\*\*)?(.*?)(\*\*)?([.,!?;:]*)$/);
    if (m[1]) k = true;
    const w = m[2] + m[4]; if (w) out.push({ w, k });
    if (m[3]) k = false;
  }
  return out;
}
/** Takarir bawah: kata muncul satu per satu; kata kunci (**kata**) berwarna kuning. segmen: [[t0,t1,"teks"],...] */
export function takarir(g, t, segmen, { y = 1040, size = 44, maxW = 640 } = {}) {
  const s = segmen.find(([a, b]) => t >= a && t < b); if (!s) return;
  const [a, b, teks] = s, tok = urai(teks);
  g.font = font(800, size); const sp = g.measureText(" ").width;
  tok.forEach((o) => { o.lebar = g.measureText(o.w).width; });
  const baris = []; let cur = [], lebar = 0;
  for (const o of tok) { const tambah = (cur.length ? sp : 0) + o.lebar; if (lebar + tambah > maxW && cur.length) { baris.push({ cur, lebar }); cur = [o]; lebar = o.lebar; } else { cur.push(o); lebar += tambah; } }
  if (cur.length) baris.push({ cur, lebar });
  const keluar = 1 - eo(P(t, b - 0.2, b));
  let i = 0; g.textBaseline = "alphabetic"; g.textAlign = "left"; g.lineJoin = "round";
  baris.forEach((br, bi) => {
    let x = W / 2 - br.lebar / 2;
    for (const o of br.cur) {
      const p = eo(clamp((t - (a + i * 0.1)) / 0.25)), al = p * keluar; i++;
      if (al > 0) {
        g.save(); g.globalAlpha = al; const yy = y + bi * size * 1.25 + (1 - p) * 14;
        g.strokeStyle = "rgba(5,15,28,0.9)"; g.lineWidth = 9; g.strokeText(o.w, x, yy);
        g.fillStyle = o.k ? WR.amber : WR.krem; g.fillText(o.w, x, yy); g.restore();
      }
      x += o.lebar + sp;
    }
  });
}
export function lapisBawah(g) {
  const gr = g.createLinearGradient(0, 900, 0, H); gr.addColorStop(0, "rgba(5,15,28,0)"); gr.addColorStop(0.45, "rgba(5,15,28,0.55)"); gr.addColorStop(1, "rgba(5,15,28,0.9)");
  g.fillStyle = gr; g.fillRect(0, 900, W, H - 900);
}
/** Kartu kepala bab dengan penanda kemajuan. */
export function kepala(g, t, { nomor, total, judul, tBab }) {
  const k = eo(clamp((t) / 0.5)); g.save(); g.globalAlpha = k;
  kotak(g, 24, 34, 672, 88, 18); g.fillStyle = "rgba(246,241,230,0.95)"; g.fill();
  g.fillStyle = "#4A5B72"; g.font = font(800, 18); g.textAlign = "left"; g.textBaseline = "middle"; g.letterSpacing = "2px";
  g.save(); g.globalAlpha = k * eo(clamp((t - tBab) / 0.35)); g.fillText(`BAB ${nomor} · ${judul.toUpperCase()}`, 46, 62); g.restore(); g.letterSpacing = "0px";
  const x0 = 46, lebarTot = 500, gap = 8, w = (lebarTot - gap * (total - 1)) / total;
  for (let i = 0; i < total; i++) {
    kotak(g, x0 + i * (w + gap), 88, w, 10, 5); g.fillStyle = "rgba(11,26,43,0.14)"; g.fill();
    const isi = i + 1 < nomor ? 1 : i + 1 === nomor ? clamp((t - tBab) / 2) * 0.35 + 0.15 : 0;
    if (isi > 0) { kotak(g, x0 + i * (w + gap), 88, w * Math.min(1, isi), 10, 5); g.fillStyle = "#E0A100"; g.fill(); }
  }
  g.fillStyle = WR.tinta; g.font = font(900, 38); g.textAlign = "right"; g.fillText(`${nomor}`, 640, 70);
  g.fillStyle = "#4A5B72"; g.font = font(800, 18); g.textAlign = "left"; g.fillText(`/ ${total}`, 646, 76);
  g.restore();
}
/** Kapsul pernyataan di bawah kepala; kata ber-** disorot kuning. */
export function kapsul(g, t, t0, teks) {
  const k = pop(t, t0, t0 + 0.45); if (k <= 0) return;
  const tok = urai(teks); g.save(); g.font = font(800, 30);
  const sp = g.measureText(" ").width; tok.forEach((o) => { o.lebar = g.measureText(o.w).width; });
  const total = tok.reduce((s, o) => s + o.lebar, 0) + sp * (tok.length - 1), w = total + 36;
  g.translate(24, 150); g.scale(k, k);
  kotak(g, 0, 0, w, 58, 14); g.fillStyle = WR.krem; g.fill(); g.strokeStyle = WR.tinta; g.lineWidth = 2.5; g.stroke();
  let x = 18; g.textBaseline = "middle"; g.textAlign = "left";
  for (const o of tok) {
    if (o.k) { kotak(g, x - 6, 10, o.lebar + 12, 38, 8); g.fillStyle = WR.amber; g.fill(); }
    g.fillStyle = WR.tinta; g.fillText(o.w, x, 30); x += o.lebar + sp;
  }
  g.restore();
}
/** Panel batang perbandingan di layar. baris: [{nama, nilai, warna, tampil}], maks = nilai untuk batang penuh. */
export function panelBatang(g, t, t0, { judul, baris, maks, garisBanding = null, y = 218, t1 = Infinity }) {
  const k = eo(clamp((t - t0) / 0.5)) * (1 - eo(P(t, t1 - 0.5, t1))); if (k <= 0) return;
  g.save(); g.globalAlpha = k;
  const h = 62 + baris.length * 56;
  kotak(g, 24, y, 672, h, 18); g.fillStyle = "rgba(8,24,43,0.86)"; g.fill(); g.strokeStyle = "rgba(246,241,230,0.2)"; g.lineWidth = 2; g.stroke();
  g.fillStyle = "rgba(246,241,230,0.75)"; g.font = font(800, 19); g.textAlign = "left"; g.textBaseline = "middle"; g.letterSpacing = "2px"; g.fillText(judul.toUpperCase(), 48, y + 30); g.letterSpacing = "0px";
  const bx = 300, bw = 250;
  baris.forEach((r, i) => {
    const yy = y + 78 + i * 56, p = eo(clamp((t - t0 - 0.35 - i * 0.45) / 0.9));
    g.fillStyle = WR.krem; g.font = font(800, 24); g.textAlign = "left"; g.fillText(r.nama, 48, yy);
    kotak(g, bx, yy - 14, bw, 28, 8); g.fillStyle = "rgba(246,241,230,0.10)"; g.fill();
    const lebar = Math.max(6, bw * (r.nilai / maks) * p); kotak(g, bx, yy - 14, lebar, 28, 8); g.fillStyle = r.warna; g.fill();
    if (p > 0.6) { g.globalAlpha = k * clamp((p - 0.6) / 0.4); g.fillStyle = WR.krem; g.font = font(800, 20); g.fillText(r.tampil, bx + lebar + 12, yy + 1); g.globalAlpha = k; }
  });
  if (garisBanding != null) {
    const gx = bx + bw * garisBanding; g.setLineDash([6, 5]); g.strokeStyle = WR.teal; g.lineWidth = 3;
    g.beginPath(); g.moveTo(gx, y + 52); g.lineTo(gx, y + h - 14); g.stroke(); g.setLineDash([]);
  }
  g.restore();
}
/** Kartu kesimpulan layar penuh di akhir (tinggi menyesuaikan jumlah baris). */
export function kartuInti(g, t, t0, teks) {
  const k = eo(clamp((t - t0) / 0.6)); if (k <= 0) return;
  const tok = urai(teks); g.font = font(900, 44);
  const sp = g.measureText(" ").width, maxW = 552, lh = 60;
  tok.forEach((o) => { o.lebar = g.measureText(o.w).width; });
  const baris = [[]]; let x = 0;
  for (const o of tok) { if (x + o.lebar > maxW && baris[baris.length - 1].length) { baris.push([]); x = 0; } baris[baris.length - 1].push(o); x += o.lebar + sp; }
  const h = 120 + baris.length * lh, y0 = 560 - h / 2;
  g.save(); g.fillStyle = `rgba(5,15,28,${0.72 * k})`; g.fillRect(0, 0, W, H);
  g.globalAlpha = k; g.translate(0, (1 - k) * 40);
  kotak(g, 48, y0, 624, h, 26); g.fillStyle = WR.krem; g.fill();
  g.fillStyle = WR.amber; kotak(g, 48, y0, 624, 16, 8); g.fill();
  g.fillStyle = "#4A5B72"; g.font = font(800, 22); g.textAlign = "left"; g.textBaseline = "middle"; g.letterSpacing = "4px"; g.fillText("INTINYA", 84, y0 + 56); g.letterSpacing = "0px";
  g.font = font(900, 44);
  baris.forEach((br, bi) => {
    let xx = 84; const yy = y0 + 118 + bi * lh;
    for (const o of br) {
      if (o.k) { kotak(g, xx - 6, yy - 26, o.lebar + 12, 50, 10); g.fillStyle = WR.amber; g.fill(); }
      g.fillStyle = WR.tinta; g.textBaseline = "middle"; g.fillText(o.w, xx, yy); xx += o.lebar + sp;
    }
  });
  g.restore();
}
export function kaki(g, t, dur, sumber) {
  g.save(); g.fillStyle = "rgba(246,241,230,0.55)"; g.font = font(600, 15); g.textAlign = "left"; g.textBaseline = "alphabetic";
  if (sumber) g.fillText(sumber, 24, 1196);
  g.fillStyle = "rgba(246,241,230,0.85)"; g.font = font(800, 16); g.letterSpacing = "4px"; g.textAlign = "right"; g.fillText("BELAJAR BARENG", W - 24, 1236); g.letterSpacing = "0px";
  g.fillStyle = "rgba(246,241,230,0.16)"; g.fillRect(24, 1256, W - 48, 5); g.fillStyle = WR.amber; g.fillRect(24, 1256, (W - 48) * clamp(t / dur), 5);
  g.restore();
}
