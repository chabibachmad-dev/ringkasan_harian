// Mesin latar/pola untuk paket Adobe Stock: digambar murni dari kode dengan @napi-rs/canvas (tanpa Chromium). 5400x3600 (19,4 MP), JPEG.
import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";

export const LEBAR = 5400, TINGGI = 3600;
const W = LEBAR, H = TINGGI;
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const baru = () => { const c = createCanvas(W, H); return [c, c.getContext("2d")]; };

function derau(c, g, amp = 3, seed = 7) {
  const r = rng(seed), im = g.getImageData(0, 0, W, H), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amp * 2; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(im, 0, 0);
}
function vinyet(g, kuat = 0.35) {
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, `rgba(0,0,0,${kuat})`); g.fillStyle = v; g.fillRect(0, 0, W, H);
}
const poligon = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
const bintang = (cx, cy, R, n, lompat, rot = 0) => { const p = []; for (let i = 0; i < n; i++) { const a = rot + (i * lompat * 2 * Math.PI) / n; p.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); } return p; };

// ---------- 1. Kawung (corak batik klasik: lensa dari lingkaran yang saling beririsan, warna sogan) ----------
function kawung() {
  const [c, g] = baru(); const u = 360, r = u * Math.SQRT1_2;
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#3a2214"); bg.addColorStop(1, "#4b2d19"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const lensa = (x, y, horiz, skala, isi, garis) => {
    g.save(); g.translate(x, y); if (!horiz) g.rotate(Math.PI / 2); g.scale(skala, skala);
    g.beginPath(); g.arc(-u / 2, 0, r, -Math.PI / 4, Math.PI / 4); g.arc(u / 2, 0, r, (3 * Math.PI) / 4, (5 * Math.PI) / 4); g.closePath();
    if (isi) { g.fillStyle = isi; g.fill(); } if (garis) { g.lineWidth = 8 / skala; g.strokeStyle = garis; g.stroke(); } g.restore();
  };
  for (let j = -1; j <= H / u + 1; j++) for (let i = -1; i <= W / u + 1; i++) {
    const x = i * u, y = j * u, alt = (i + j) % 2 === 0;
    // lensa mendatar di (x+u/2, y) dan tegak di (x, y+u/2); sisi lensa bertemu di pusat sel
    lensa(x + u / 2, y, true, 1, alt ? "#e9d5a6" : "#c99a5b", "#24140b");
    lensa(x + u / 2, y, true, 0.62, alt ? "#b9824a" : "#e9d5a6", "#24140b");
    lensa(x, y + u / 2, false, 1, alt ? "#c99a5b" : "#e9d5a6", "#24140b");
    lensa(x, y + u / 2, false, 0.62, alt ? "#e9d5a6" : "#b9824a", "#24140b");
    g.beginPath(); g.arc(x + u / 2, y + u / 2, u * 0.045, 0, Math.PI * 2); g.fillStyle = "#e9d5a6"; g.fill();
    g.beginPath(); g.arc(x, y, u * 0.05, 0, Math.PI * 2); g.fillStyle = "#e9d5a6"; g.fill();
    g.beginPath(); g.arc(x, y, u * 0.022, 0, Math.PI * 2); g.fillStyle = "#2a170c"; g.fill();
  }
  vinyet(g, 0.25); derau(c, g, 2, 11); return c;
}

// ---------- 2. Truntum (bintang-bunga kecil bertebaran, biru nila) ----------
function truntum() {
  const [c, g] = baru(); const u = 260;
  const bg = g.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, W * 0.7); bg.addColorStop(0, "#1d3a6b"); bg.addColorStop(1, "#0d1f40"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const bunga = (x, y, R, warna) => {
    g.save(); g.translate(x, y);
    for (let k = 0; k < 8; k++) { g.rotate(Math.PI / 4); g.beginPath(); g.ellipse(R * 0.55, 0, R * 0.42, R * 0.15, 0, 0, Math.PI * 2); g.fillStyle = warna; g.fill(); }
    g.beginPath(); g.arc(0, 0, R * 0.2, 0, Math.PI * 2); g.fillStyle = "#0d1f40"; g.fill();
    g.beginPath(); g.arc(0, 0, R * 0.1, 0, Math.PI * 2); g.fillStyle = warna; g.fill(); g.restore();
  };
  for (let j = -1; j <= H / (u * 0.88) + 2; j++) for (let i = -1; i <= W / u + 1; i++) {
    const x = i * u + (j % 2 ? u / 2 : 0), y = j * u * 0.88;
    bunga(x, y, u * 0.34, (i + j) % 3 === 0 ? "#f0d9a0" : "#d9b66a");
    g.fillStyle = "#8fb0e0";
    for (const [ox, oy] of [[0.5, 0.44], [0, 0.44], [0.25, 0.22], [0.75, 0.22]]) { g.beginPath(); g.arc(x + u * ox, y + u * oy * 0.88 * 1.0, u * 0.028, 0, Math.PI * 2); g.fill(); }
  }
  vinyet(g, 0.3); derau(c, g, 2, 12); return c;
}

// ---------- 3. Pola geometris Islami (bintang segi delapan dari dua persegi, khas ornamen Nusantara/Timur Tengah) ----------
function geometriIslami() {
  const [c, g] = baru(); const R = 190, sp = R * 2;
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#0b4a3a"); bg.addColorStop(1, "#06352a"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const emas = "#e0b955";
  for (let j = -1; j <= H / sp + 1; j++) for (let i = -1; i <= W / sp + 1; i++) {
    const x = i * sp, y = j * sp, k = (i + j) % 2 === 0;
    const isi = k ? "#12775c" : "#0d6049";
    // celah di pusat sel (di antara empat bintang)
    const gx = x + R, gy = y + R;
    poligon(g, bintang(gx, gy, R * 0.5, 4, 1, 0)); g.fillStyle = "#06352a"; g.fill(); g.lineWidth = 7; g.strokeStyle = emas; g.stroke();
    poligon(g, bintang(gx, gy, R * 0.2, 4, 1, 0)); g.fillStyle = emas; g.fill();
    // bintang: dua persegi saling berputar 45 derajat
    for (const rot of [0, Math.PI / 4]) { poligon(g, bintang(x, y, R, 4, 1, rot)); g.fillStyle = isi; g.fill(); }
    g.lineWidth = 9; g.strokeStyle = emas;
    for (const rot of [0, Math.PI / 4]) { poligon(g, bintang(x, y, R, 4, 1, rot)); g.stroke(); }
    poligon(g, bintang(x, y, R * 0.62, 8, 1, Math.PI / 8)); g.fillStyle = "#06352a"; g.fill(); g.lineWidth = 7; g.strokeStyle = emas; g.stroke();
    poligon(g, bintang(x, y, R * 0.46, 8, 3, 0)); g.fillStyle = emas; g.fill();
    g.beginPath(); g.arc(x, y, R * 0.1, 0, Math.PI * 2); g.fillStyle = "#06352a"; g.fill();
  }
  vinyet(g, 0.35); derau(c, g, 2, 13); return c;
}

// ---------- 4. Malam Ramadan: bulan sabit, masjid generik, lampu hias, ruang kosong untuk teks ----------
function ramadan() {
  const [c, g] = baru(); const r = rng(5);
  const langit = g.createLinearGradient(0, 0, 0, H); langit.addColorStop(0, "#050a22"); langit.addColorStop(0.55, "#0e2a5c"); langit.addColorStop(0.85, "#1d5a86"); langit.addColorStop(1, "#2a7a8e"); g.fillStyle = langit; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) { const x = r() * W, y = r() * H * 0.7, s = 2 + r() * 7, a = 0.25 + r() * 0.75; g.fillStyle = `rgba(255,248,220,${a})`; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); if (s > 7) { const gl = g.createRadialGradient(x, y, 0, x, y, s * 6); gl.addColorStop(0, "rgba(255,248,220,0.35)"); gl.addColorStop(1, "rgba(255,248,220,0)"); g.fillStyle = gl; g.beginPath(); g.arc(x, y, s * 6, 0, Math.PI * 2); g.fill(); } }
  // bulan sabit
  const mx = 4350, my = 900, mr = 430;
  const hal = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2); hal.addColorStop(0, "rgba(255,226,150,0.45)"); hal.addColorStop(1, "rgba(255,226,150,0)"); g.fillStyle = hal; g.beginPath(); g.arc(mx, my, mr * 3.2, 0, Math.PI * 2); g.fill();
  g.save(); g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.arc(mx + mr * 0.42, my - mr * 0.12, mr * 0.86, 0, Math.PI * 2, true); g.clip("evenodd");
  const em = g.createLinearGradient(mx - mr, my - mr, mx + mr, my + mr); em.addColorStop(0, "#fff0b8"); em.addColorStop(1, "#e8b94d"); g.fillStyle = em; g.fillRect(mx - mr, my - mr, mr * 2, mr * 2); g.restore();
  poligon(g, bintang(mx + mr * 0.55, my - mr * 0.05, 85, 5, 2, -Math.PI / 2)); g.fillStyle = "#ffe9a8"; g.fill();
  // siluet masjid generik (kubah dan menara)
  const dasar = H - 330; g.fillStyle = "#050c1c";
  const kubah = (cx, base, rr) => { g.beginPath(); g.moveTo(cx - rr, base); g.bezierCurveTo(cx - rr, base - rr * 1.45, cx + rr, base - rr * 1.45, cx + rr, base); g.closePath(); g.fill(); g.fillRect(cx - 6, base - rr * 1.45 - 120, 12, 120); g.beginPath(); g.arc(cx, base - rr * 1.45 - 135, 24, 0, Math.PI * 2); g.fill(); };
  const menara = (cx, tinggi, lebar) => { g.fillRect(cx - lebar / 2, dasar - tinggi, lebar, tinggi); g.fillRect(cx - lebar * 0.8, dasar - tinggi, lebar * 1.6, 36); g.beginPath(); g.moveTo(cx - lebar * 0.5, dasar - tinggi - 0); g.lineTo(cx, dasar - tinggi - lebar * 2.6); g.lineTo(cx + lebar * 0.5, dasar - tinggi); g.closePath(); g.fill(); g.beginPath(); g.arc(cx, dasar - tinggi - lebar * 2.6 - 22, 22, 0, Math.PI * 2); g.fill(); };
  g.fillRect(2700, dasar - 340, 2400, 700);
  kubah(3900, dasar - 340, 520); kubah(3150, dasar - 340, 250); kubah(4650, dasar - 340, 250);
  menara(2800, 1250, 110); menara(5000, 1250, 110);
  g.fillRect(0, dasar, W, H - dasar);
  // jendela bercahaya
  g.fillStyle = "#ffcf6a"; for (const x of [3250, 3550, 3850, 4150, 4450, 4750]) { g.beginPath(); g.moveTo(x - 50, dasar - 40); g.lineTo(x - 50, dasar - 190); g.arc(x, dasar - 190, 50, Math.PI, 0); g.lineTo(x + 50, dasar - 40); g.closePath(); g.fill(); }
  // lampu hias (fanous) menggantung di kanan atas
  const lentera = (x, y0, y, s) => {
    g.strokeStyle = "#c9a14a"; g.lineWidth = 8 * s; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y); g.stroke();
    g.fillStyle = "#c9a14a"; poligon(g, [[x - 55 * s, y + 70 * s], [x + 55 * s, y + 70 * s], [x + 35 * s, y], [x - 35 * s, y]]); g.fill();
    g.beginPath(); g.arc(x, y - 2 * s, 18 * s, 0, Math.PI * 2); g.fill();
    const hx = x, top = y + 70 * s, bot = y + 370 * s, lb = 110 * s;
    const cahaya = g.createRadialGradient(hx, (top + bot) / 2, 10, hx, (top + bot) / 2, 420 * s); cahaya.addColorStop(0, "rgba(255,205,100,0.55)"); cahaya.addColorStop(1, "rgba(255,205,100,0)"); g.fillStyle = cahaya; g.fillRect(0, 0, W, H);
    const bd = g.createLinearGradient(hx - lb, 0, hx + lb, 0); bd.addColorStop(0, "#f59e2c"); bd.addColorStop(0.5, "#ffe29a"); bd.addColorStop(1, "#f59e2c");
    poligon(g, [[hx - lb * 0.75, top], [hx + lb * 0.75, top], [hx + lb, (top + bot) / 2], [hx + lb * 0.75, bot], [hx - lb * 0.75, bot], [hx - lb, (top + bot) / 2]]); g.fillStyle = bd; g.fill();
    g.strokeStyle = "#7a4a12"; g.lineWidth = 7 * s; g.stroke();
    for (const f of [-0.45, 0, 0.45]) { g.beginPath(); g.moveTo(hx + lb * f * 0.8, top); g.lineTo(hx + lb * f * 1.2, bot); g.stroke(); }
    for (const t of [0.3, 0.6]) { g.beginPath(); g.moveTo(hx - lb, top + (bot - top) * t); g.lineTo(hx + lb, top + (bot - top) * t); g.stroke(); }
    g.fillStyle = "#c9a14a"; poligon(g, [[hx - lb * 0.75, bot], [hx + lb * 0.75, bot], [hx + 20 * s, bot + 70 * s], [hx - 20 * s, bot + 70 * s]]); g.fill();
    g.beginPath(); g.arc(hx, bot + 85 * s, 16 * s, 0, Math.PI * 2); g.fill();
  };
  lentera(3550, -20, 120, 1.15); lentera(4750, -20, 470, 0.85);
  vinyet(g, 0.3); derau(c, g, 2.5, 14); return c;
}

// ---------- 5. Ketupat Lebaran (tiga ketupat anyaman, ruang kosong untuk teks) ----------
function ketupat() {
  const [c, g] = baru(); const r = rng(9);
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#fbf1d6"); bg.addColorStop(1, "#f1dca2"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // pola bintang samar di latar
  g.globalAlpha = 0.08; for (let j = 0; j < H / 300 + 1; j++) for (let i = 0; i < W / 300 + 1; i++) { poligon(g, bintang(i * 300, j * 300, 130, 8, 3, Math.PI / 8)); g.strokeStyle = "#0b6b4f"; g.lineWidth = 6; g.stroke(); } g.globalAlpha = 1;
  const satu = (cx, topY, sz, rot) => {
    g.save(); g.strokeStyle = "#7a5a1f"; g.lineWidth = 8; g.beginPath(); g.moveTo(cx, -10); g.lineTo(cx, topY - sz * 0.95); g.stroke();
    g.translate(cx, topY); g.rotate(rot);
    const d = sz, kk = g.createLinearGradient(-d, -d, d, d); kk.addColorStop(0, "#35b36b"); kk.addColorStop(1, "#0e7a45");
    g.save(); poligon(g, [[0, -d], [d * 0.62, 0], [0, d], [-d * 0.62, 0]]); g.clip(); g.fillStyle = kk; g.fillRect(-d, -d, d * 2, d * 2);
    // anyaman: dua arah jalur diagonal bergantian
    const n = 9, w = (d * 2) / n;
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
      const x = ((a + b) * w) / 2 * 0.62 * 1.0, y = ((b - a) * w) / 2;
      if ((a + b) % 2 === 0) { g.fillStyle = (a * 3 + b) % 2 === 0 ? "#52cc82" : "#1a9658"; poligon(g, [[x, y - w * 0.5], [x + w * 0.31, y], [x, y + w * 0.5], [x - w * 0.31, y]]); g.fill(); }
    }
    g.strokeStyle = "rgba(6,70,40,0.55)"; g.lineWidth = 5;
    for (let a = -n; a <= n; a++) { g.beginPath(); g.moveTo(-d * 0.62, a * w); g.lineTo(d * 0.62, a * w + d * 0.0); g.stroke(); }
    g.restore();
    poligon(g, [[0, -d], [d * 0.62, 0], [0, d], [-d * 0.62, 0]]); g.lineWidth = 12; g.strokeStyle = "#0a5a34"; g.stroke();
    // rumbai di bawah
    g.strokeStyle = "#2fa45f"; g.lineWidth = 9; for (let k = -6; k <= 6; k++) { g.beginPath(); g.moveTo(k * 8, d - 4); g.quadraticCurveTo(k * 14 + 10, d + sz * 0.4, k * 20, d + sz * 0.7 + r() * 40); g.stroke(); }
    g.fillStyle = "#e0b955"; g.beginPath(); g.arc(0, -d, 18, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  satu(3900, 1050, 520, -0.07); satu(4700, 1500, 400, 0.08); satu(3150, 1650, 330, 0.05);
  // bayangan lembut di dasar
  const ds = g.createLinearGradient(0, H - 600, 0, H); ds.addColorStop(0, "rgba(120,80,20,0)"); ds.addColorStop(1, "rgba(120,80,20,0.25)"); g.fillStyle = ds; g.fillRect(0, H - 600, W, 600);
  vinyet(g, 0.18); derau(c, g, 2, 15); return c;
}

// ---------- 6. Latar abstrak lembut (gradien aurora, ruang kosong) ----------
function aurora() {
  const [c, g] = baru(); const r = rng(21);
  g.fillStyle = "#0f1b3d"; g.fillRect(0, 0, W, H);
  const blob = (x, y, rad, warna, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, warna.replace("A", a)); gr.addColorStop(1, warna.replace("A", 0)); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
  g.globalCompositeOperation = "lighter";
  blob(900, 700, 2300, "rgba(80,60,220,A)", 0.85); blob(3900, 600, 2100, "rgba(0,190,200,A)", 0.7); blob(2600, 3000, 2600, "rgba(240,90,170,A)", 0.55); blob(4800, 3100, 1800, "rgba(255,170,70,A)", 0.5);
  g.globalCompositeOperation = "source-over";
  g.lineWidth = 3; for (let k = 0; k < 18; k++) { g.beginPath(); const y0 = 500 + k * 120; g.moveTo(-50, y0); for (let x = 0; x <= W + 50; x += 60) g.lineTo(x, y0 + Math.sin(x / 700 + k * 0.4) * 160 + Math.sin(x / 260 + k) * 30); g.strokeStyle = `rgba(255,255,255,${0.035 + r() * 0.03})`; g.stroke(); }
  vinyet(g, 0.3); derau(c, g, 4, 16); return c;
}


export const LATAR = [
  { nama: "batik-kawung-sogan", fn: kawung, tema: ["batik", "umum"], judul: "Traditional Indonesian batik kawung pattern in brown sogan colors",
    kata: "batik,kawung,indonesian batik,traditional pattern,seamless pattern,pattern,ornament,motif,javanese,java,indonesia,heritage,culture,cultural,tradition,textile,fabric,brown,sogan,vintage,retro,ethnic,asian,geometric,repeating,background,wallpaper,decorative,design,handcrafted style,illustration,texture,elegant,classic,symmetry,circles,craft,artisan,nusantara,wrapping paper,fashion,interior,backdrop" },
  { nama: "batik-truntum-biru", fn: truntum, tema: ["batik", "umum"], judul: "Indonesian batik truntum floral pattern on indigo blue background",
    kata: "batik,truntum,indonesian batik,floral pattern,flower,flowers,indigo,blue,gold,golden,pattern,seamless pattern,traditional,textile,fabric,ornament,motif,java,indonesia,culture,heritage,ethnic,asian,elegant,luxury,decorative,background,wallpaper,repeating,design,illustration,star flower,dots,vintage,classic,wedding,fashion,craft,nusantara,backdrop,texture,symmetry,wrapping paper,interior" },
  { nama: "pola-islami-hijau-emas", fn: geometriIslami, tema: ["ramadan", "umum"], judul: "Islamic geometric eight pointed star pattern in green and gold",
    kata: "islamic pattern,geometric pattern,islamic art,arabesque,eight pointed star,star pattern,ramadan,eid,muslim,mosque,ornament,green,gold,emerald,seamless pattern,tessellation,tile,tiles,mosaic,decorative,background,wallpaper,traditional,culture,religion,islam,symmetry,geometry,luxury,elegant,design,illustration,repeating,texture,middle east,arab,festive,celebration,holiday,backdrop,wrapping paper,interior,motif,architecture" },
  { nama: "latar-malam-ramadan", fn: ramadan, tema: ["ramadan"], judul: "Ramadan night sky background with crescent moon mosque and lanterns",
    kata: "ramadan,ramadan kareem,ramadan background,crescent moon,mosque,lantern,lanterns,night sky,stars,starry sky,islamic,islam,muslim,eid,eid mubarak,celebration,holiday,greeting card,banner,poster,copy space,blue,gold,glowing,silhouette,minaret,dome,fasting,iftar,religion,spiritual,festive,tradition,culture,illustration,background,template,landscape,evening,twilight,holy month,backdrop,empty space" },
  { nama: "latar-lebaran-ketupat", fn: ketupat, tema: ["ramadan", "lebaran"], judul: "Eid al Fitr background with hanging ketupat and copy space",
    kata: "ketupat,eid,eid al fitr,eid mubarak,lebaran,hari raya,idul fitri,ramadan,indonesia,indonesian,traditional food,rice cake,hanging,green,cream,beige,greeting card,banner,poster,copy space,empty space,background,template,celebration,holiday,festive,culture,tradition,muslim,islamic,illustration,pattern,woven,palm leaf,asia,southeast asia,minimal,decoration,decorative,backdrop,flat design,seasonal" },
  { nama: "latar-abstrak-gradien", fn: aurora, tema: ["umum"], judul: "Abstract soft gradient background in blue purple and teal colors",
    kata: "abstract background,gradient,gradient background,soft,blurred,blur,blue,purple,teal,pink,orange,colorful,smooth,wallpaper,backdrop,aurora,glow,light,modern,minimal,clean,digital,tech,technology,creative,design,template,copy space,empty space,banner,website background,presentation,screen,vibrant,dreamy,calm,fluid,mesh gradient,waves,lines,texture,illustration,cover,landing page" },
];

/** Gambar satu latar ke berkas JPEG. @returns {Promise<{berkas, mp, ukuranMB}>} */
export async function renderLatar(nama, berkas, { kualitas = 95 } = {}) {
  const d = LATAR.find((x) => x.nama === nama);
  if (!d) throw new Error(`latar tidak dikenal: ${nama}`);
  const c = d.fn(); const buf = await c.encode("jpeg", kualitas);
  fs.mkdirSync(path.dirname(berkas), { recursive: true }); fs.writeFileSync(berkas, buf);
  return { berkas, mp: (W * H) / 1e6, ukuranMB: buf.length / 1048576 };
}
