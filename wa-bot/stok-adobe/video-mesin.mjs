// Mesin latar GERAK (video loop) untuk Adobe Stock: digambar murni dari kode (@napi-rs/canvas) lalu di-encode ffmpeg (H.264 MP4, tanpa suara).
// Semua desain loop mulus: setiap gerakan memakai frekuensi bilangan bulat per putaran, atau bergeser tepat satu ubin.
// Tanpa orang, tanpa teks, tanpa merek. Tidak menyentuh Baileys.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";

const TAU = Math.PI * 2;
// Syarat teknis video Adobe Stock (halaman bantuan resmi, "Technical requirements for video submissions")
export const SPEK = {
  detikMin: 5, detikMaks: 60, ukuranMaksMB: 3900,
  fps: [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60],
  resolusi: [[1920, 1080], [2048, 1080], [3840, 2160], [4096, 2160], [4096, 2304], [2304, 4096], [2160, 4096], [2160, 3840], [1080, 1920], [1080, 1080], [2160, 2160]],
  kodek: ["h264", "prores", "mpeg2video", "mpeg4", "mjpeg", "png"]
};
const rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const frac = (x) => x - Math.floor(x);

function bintang8(g, x, y, r) { for (let k = 0; k < 2; k++) { g.beginPath(); for (let i = 0; i < 4; i++) { const a = k * Math.PI / 4 + i * Math.PI / 2 + Math.PI / 4; const px = x + r * Math.cos(a), py = y + r * Math.sin(a); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.stroke(); } }
function percik4(g, x, y, r, rot) { g.beginPath(); for (let i = 0; i < 8; i++) { const a = rot + i * Math.PI / 4, rr = i % 2 ? r * 0.22 : r; const px = x + rr * Math.cos(a), py = y + rr * Math.sin(a); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.fill(); }
function elips(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); }
function cahaya(g, x, y, r, rgb, a) { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(${rgb},${a})`); rg.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); }

// ---------- desain ----------
// Tiap desain: siapkan(W,H) -> fungsi (g,u) yang menggambar satu frame; u dalam [0,1) = posisi dalam satu putaran loop.
const DESAIN = {
  "bintang-islami-emas"(W, H) {
    const S = Math.min(W, H), TILE = S * 0.2222, sk = S / 1080;
    return (g, u) => {
      const denyut = 0.5 + 0.5 * Math.sin(TAU * u);
      const bg = g.createRadialGradient(W / 2, H / 2, S * 0.093, W / 2, H / 2, S * 1.11); bg.addColorStop(0, "#0b5a46"); bg.addColorStop(1, "#04231c"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.lineJoin = "round";
      for (let lapis = 0; lapis < 2; lapis++) {
        const tl = lapis ? TILE / 2 : TILE, gs = (lapis ? -u * tl : u * tl) % tl;
        g.lineWidth = (lapis ? 1.5 : 2.5) * sk; g.strokeStyle = lapis ? `rgba(245,185,66,${0.18 + 0.1 * denyut})` : `rgba(245,185,66,${0.45 + 0.35 * denyut})`;
        for (let y = -tl + gs; y < H + tl; y += tl) for (let x = -tl + gs; x < W + tl; x += tl) { bintang8(g, x + tl / 2, y + tl / 2, tl * 0.42); g.beginPath(); g.arc(x + tl / 2, y + tl / 2, tl * 0.13, 0, TAU); g.stroke(); }
      }
      cahaya(g, W / 2, H / 2, S * 0.65, "255,236,170", 0.1 + 0.14 * denyut);
    };
  },
  "kawung-bergulir"(W, H) {
    const S = Math.min(W, H), T = S * 0.2, d = T * 0.25;
    return (g, u) => {
      g.fillStyle = "#efe0bd"; g.fillRect(0, 0, W, H);
      const gs = (u * T) % T; g.lineWidth = Math.max(1.5, T * 0.012); g.strokeStyle = "rgba(60,32,12,0.75)"; g.fillStyle = "rgba(107,68,35,0.92)";
      for (let y = -T + gs; y < H + T; y += T) for (let x = -T + gs; x < W + T; x += T) {
        const cx = x + T / 2, cy = y + T / 2;
        for (const [ox, oy, rx, ry] of [[0, -d, T * 0.13, T * 0.25], [0, d, T * 0.13, T * 0.25], [-d, 0, T * 0.25, T * 0.13], [d, 0, T * 0.25, T * 0.13]]) { elips(g, cx + ox, cy + oy, rx, ry); g.fill(); g.stroke(); }
        g.fillStyle = "#efe0bd"; g.beginPath(); g.arc(cx, cy, T * 0.05, 0, TAU); g.fill();
        g.fillStyle = "rgba(107,68,35,0.92)"; for (const [qx, qy] of [[x, y], [x + T, y], [x, y + T], [x + T, y + T]]) { g.beginPath(); g.arc(qx, qy, T * 0.045, 0, TAU); g.fill(); }
      }
      const pusat = -0.3 * W + u * 1.6 * W, sb = g.createLinearGradient(pusat - W * 0.25, 0, pusat + W * 0.25, H * 0.4);
      sb.addColorStop(0, "rgba(255,244,214,0)"); sb.addColorStop(0.5, `rgba(255,244,214,${0.28 * Math.sin(Math.PI * u)})`); sb.addColorStop(1, "rgba(255,244,214,0)"); g.fillStyle = sb; g.fillRect(0, 0, W, H);
      const vg = g.createRadialGradient(W / 2, H / 2, S * 0.4, W / 2, H / 2, S * 1.1); vg.addColorStop(0, "rgba(40,20,5,0)"); vg.addColorStop(1, "rgba(40,20,5,0.35)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    };
  },
  "lentera-melayang"(W, H) {
    const S = Math.min(W, H), r = rng(11), m = S * 0.25, bintang = [], lentera = [];
    for (let i = 0; i < 80; i++) bintang.push({ x: r() * W, y: r() * H, rad: S * (0.0008 + r() * 0.0016), k: 1 + Math.floor(r() * 3), ph: r() });
    for (let i = 0; i < 12; i++) lentera.push({ x: (0.06 + 0.88 * ((i + r() * 0.6) / 12)) * W, w: S * (0.05 + r() * 0.07), n: r() < 0.6 ? 1 : 2, ph: r(), ph2: r(), k: 1 + Math.floor(r() * 2), ph3: r() });
    lentera.sort((a, b) => a.w - b.w);
    return (g, u) => {
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#070d24"); bg.addColorStop(0.6, "#14264f"); bg.addColorStop(1, "#27406f"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      for (const b of bintang) { g.fillStyle = `rgba(255,248,225,${0.25 + 0.6 * (0.5 + 0.5 * Math.sin(TAU * (b.k * u + b.ph)))})`; g.beginPath(); g.arc(b.x, b.y, b.rad, 0, TAU); g.fill(); }
      for (const l of lentera) {
        const y = H + m - frac(u * l.n + l.ph) * (H + 2 * m), x = l.x + Math.sin(TAU * (l.k * u + l.ph2)) * S * 0.018, api = 0.85 + 0.15 * Math.sin(TAU * (3 * u + l.ph3)), w = l.w, h = w * 1.35;
        cahaya(g, x, y, w * 2.4, "255,170,70", 0.5 * api);
        const gr = g.createLinearGradient(0, y - h / 2, 0, y + h / 2); gr.addColorStop(0, `rgba(255,222,140,${api})`); gr.addColorStop(1, `rgba(255,116,28,${api})`);
        g.fillStyle = gr; g.beginPath(); g.moveTo(x - w * 0.38, y - h / 2); g.lineTo(x + w * 0.38, y - h / 2); g.lineTo(x + w * 0.5, y + h / 2); g.lineTo(x - w * 0.5, y + h / 2); g.closePath(); g.fill();
        g.strokeStyle = "rgba(120,45,0,0.35)"; g.lineWidth = Math.max(1, w * 0.02); for (const f of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(x + f * w * 0.38, y - h / 2); g.lineTo(x + f * w * 0.5, y + h / 2); g.stroke(); }
        g.fillStyle = "#6b3d0e"; g.fillRect(x - w * 0.42, y - h / 2 - h * 0.06, w * 0.84, h * 0.08); g.fillRect(x - w * 0.52, y + h / 2 - h * 0.01, w * 1.04, h * 0.07);
        g.strokeStyle = "#6b3d0e"; g.lineWidth = Math.max(1, w * 0.03); g.beginPath(); g.arc(x, y - h / 2 - h * 0.14, h * 0.08, Math.PI, 0); g.stroke();
      }
    };
  },
  "bulan-bintang-malam"(W, H) {
    const S = Math.min(W, H), r = rng(23), R = S * 0.11, bintang = [];
    for (let i = 0; i < 140; i++) bintang.push({ x: r() * W, y: r() * H * 0.78, rad: S * (0.0007 + r() * 0.0018), k: 1 + Math.floor(r() * 3), ph: r() });
    const sp = createCanvas(Math.ceil(R * 2.6), Math.ceil(R * 2.6)), sg = sp.getContext("2d"), c0 = R * 1.3;
    const gr = sg.createLinearGradient(c0 - R, c0 - R, c0 + R, c0 + R); gr.addColorStop(0, "#fff0b8"); gr.addColorStop(1, "#e3a93c"); sg.fillStyle = gr; sg.beginPath(); sg.arc(c0, c0, R, 0, TAU); sg.fill();
    sg.globalCompositeOperation = "destination-out"; sg.beginPath(); sg.arc(c0 + R * 0.45, c0 - R * 0.1, R * 0.82, 0, TAU); sg.fill();
    const mx = W / 2, dasar = H * 0.9;
    const awan = Array.from({ length: 5 }, (_, i) => ({ y: H * (0.12 + 0.11 * i + r() * 0.04), sk: S * (0.12 + r() * 0.1), ph: r(), a: 0.07 + r() * 0.07 }));
    return (g, u) => {
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#040b24"); bg.addColorStop(0.55, "#0c2a55"); bg.addColorStop(1, "#1f5a74"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      for (const b of bintang) { g.fillStyle = `rgba(255,250,230,${0.2 + 0.7 * (0.5 + 0.5 * Math.sin(TAU * (b.k * u + b.ph)))})`; g.beginPath(); g.arc(b.x, b.y, b.rad, 0, TAU); g.fill(); }
      for (const aw of awan) { const x = frac(u + aw.ph) * (W + 4 * aw.sk) - 2 * aw.sk; for (const [dx, dy, rr] of [[-0.9, 0.05, 0.5], [-0.35, -0.12, 0.62], [0.2, -0.05, 0.7], [0.8, 0.06, 0.48], [0.1, 0.12, 0.6]]) cahaya(g, x + dx * aw.sk, aw.y + dy * aw.sk, rr * aw.sk * 0.8, "150,185,235", aw.a * 2.2); }
      const cx = W * 0.66, cy = H * 0.27 + Math.sin(TAU * u) * S * 0.008, denyut = 0.5 + 0.5 * Math.sin(TAU * u);
      cahaya(g, cx, cy, R * 3.2, "255,215,120", 0.22 + 0.14 * denyut); g.drawImage(sp, cx - c0, cy - c0);
      g.fillStyle = `rgba(255,236,170,${0.75 + 0.2 * denyut})`; percik4(g, cx + R * 1.35, cy - R * 0.25, S * 0.03, u * Math.PI / 2);
      g.fillStyle = "#03101f"; g.fillRect(0, dasar, W, H - dasar);
      g.beginPath(); g.ellipse(mx, dasar, S * 0.16, S * 0.14, 0, Math.PI, 0); g.fill(); g.fillRect(mx - S * 0.008, dasar - S * 0.2, S * 0.016, S * 0.06); g.beginPath(); g.arc(mx, dasar - S * 0.205, S * 0.012, 0, TAU); g.fill();
      for (const sgn of [-1, 1]) { const x = mx + sgn * S * 0.3, w = S * 0.03; g.fillRect(x - w / 2, dasar - S * 0.3, w, S * 0.3); g.beginPath(); g.moveTo(x - w * 0.8, dasar - S * 0.3); g.lineTo(x + w * 0.8, dasar - S * 0.3); g.lineTo(x, dasar - S * 0.37); g.closePath(); g.fill(); g.fillRect(x - w * 1.1, dasar - S * 0.2, w * 2.2, S * 0.012); }
    };
  },
  "gradien-cair"(W, H) {
    const S = Math.min(W, H), warna = ["0,200,170", "255,70,140", "255,170,40", "120,80,255", "0,140,255"], r = rng(5);
    const blob = warna.map((c, i) => ({ c, ax: W * (0.24 + r() * 0.14), ay: H * (0.2 + r() * 0.14), kx: 1 + (i % 2), ky: 1 + ((i + 1) % 2), px: r(), py: r(), rad: S * (0.42 + r() * 0.16) }));
    return (g, u) => {
      g.globalCompositeOperation = "source-over"; g.fillStyle = "#0b1240"; g.fillRect(0, 0, W, H); g.globalCompositeOperation = "lighter";
      for (const b of blob) cahaya(g, W / 2 + b.ax * Math.sin(TAU * (b.kx * u + b.px)), H / 2 + b.ay * Math.cos(TAU * (b.ky * u + b.py)), b.rad, b.c, 0.44);
      g.globalCompositeOperation = "source-over";
    };
  },
  "bokeh-emas"(W, H) {
    const S = Math.min(W, H), r = rng(31), titik = [];
    for (let i = 0; i < 46; i++) titik.push({ x: r() * W, rad: S * (0.014 + r() * 0.05), a: 0.14 + r() * 0.4, n: r() < 0.7 ? 1 : 2, ph: r(), ph2: r(), k: 1 + Math.floor(r() * 2), ph3: r(), k3: 1 + Math.floor(r() * 3) });
    return (g, u) => {
      g.globalCompositeOperation = "source-over"; const bg = g.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, S * 1.1); bg.addColorStop(0, "#2d1b09"); bg.addColorStop(1, "#0d0803"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "lighter";
      for (const p of titik) {
        const m = p.rad * 2, y = H + m - frac(u * p.n + p.ph) * (H + 2 * m), x = p.x + Math.sin(TAU * (p.k * u + p.ph2)) * S * 0.02, a = p.a * (0.7 + 0.3 * Math.sin(TAU * (p.k3 * u + p.ph3)));
        const rg = g.createRadialGradient(x, y, 0, x, y, p.rad); rg.addColorStop(0, `rgba(255,205,100,${a * 0.35})`); rg.addColorStop(0.75, `rgba(255,205,100,${a * 0.5})`); rg.addColorStop(0.92, `rgba(255,225,150,${a})`); rg.addColorStop(1, "rgba(255,205,100,0)");
        g.fillStyle = rg; g.fillRect(x - p.rad, y - p.rad, p.rad * 2, p.rad * 2);
      }
      g.globalCompositeOperation = "source-over";
    };
  }
};

const KATA_DASAR_VIDEO = "video background,motion background,looping background,seamless loop,animated background,motion graphics,animation,background,loop,copy space,no people,full hd,1080p";
export const VIDEO = [
  { nama: "bintang-islami-emas", tema: ["ramadan"], judul: "Seamless loop animated Islamic geometric star pattern gold on green",
    kata: "islamic pattern,geometric pattern,eight pointed star,arabesque,ramadan,eid mubarak,ramadan kareem,islamic background,islamic geometric,islamic art,star pattern,gold,golden,green,emerald green,dark green,dark background,luxury,elegant,abstract,backdrop,pattern,arabic,ornament,ornamental,decoration,festive,celebration,tradition,traditional,culture,religion,religious,holiday,texture,wallpaper" },
  { nama: "kawung-bergulir", tema: ["batik"], judul: "Seamless loop animated Indonesian batik kawung pattern brown on cream",
    kata: "batik,kawung,batik pattern,indonesian batik,javanese batik,traditional pattern,ethnic pattern,oval pattern,geometric pattern,pattern,ornament,brown,sogan,cream,beige,vintage,retro,traditional,heritage,culture,indonesia,java,nusantara,textile,fabric,wallpaper,texture,decoration,abstract,backdrop" },
  { nama: "lentera-melayang", tema: ["ramadan"], judul: "Glowing paper lanterns floating up in the night sky seamless loop",
    kata: "lanterns,floating lanterns,glowing lantern,paper lantern,sky lantern,night sky,night,festival,celebration,ramadan,eid mubarak,ramadan kareem,lebaran,islamic,festive,magic,warm light,glow,golden light,orange,dark blue,stars,twinkling stars,peaceful,dreamy,hope,wish,tradition,culture,holiday,backdrop" },
  { nama: "bulan-bintang-malam", tema: ["ramadan"], judul: "Crescent moon and twinkling stars over mosque silhouette seamless loop",
    kata: "crescent moon,crescent,moon,stars,twinkling stars,night sky,starry night,mosque,mosque silhouette,silhouette,ramadan,ramadan kareem,eid mubarak,islamic,dome,minaret,night,dark blue,golden,glow,peaceful,spiritual,religion,culture,celebration,holiday,backdrop,sky" },
  { nama: "gradien-cair", tema: ["umum"], judul: "Abstract fluid colorful gradient glowing blobs seamless loop",
    kata: "abstract,gradient,fluid,liquid,colorful,glowing,blobs,flowing,smooth,soft,aurora,vibrant,neon,modern,futuristic,technology,creative,dynamic,blur,blurred,light,color,purple,teal,pink,orange,blue,backdrop,wallpaper" },
  { nama: "bokeh-emas", tema: ["ramadan", "umum"], judul: "Golden bokeh lights particles rising on dark background seamless loop",
    kata: "bokeh,golden bokeh,gold,golden,glitter,particles,light particles,sparkle,lights,glowing,defocused,blurred lights,festive,celebration,luxury,elegant,holiday,party,ramadan,eid mubarak,dark background,black,brown,warm,backdrop,shiny" }
].map((v) => ({ ...v, kata: `${v.kata},${KATA_DASAR_VIDEO}` }));

/** Untuk tes: fungsi penggambar satu frame (g,u) suatu desain. */
export const _gambarDesain = (nama, W, H) => DESAIN[nama](W, H);

export const namaBerkasVideo = (nama, vertikal) => `${nama}${vertikal ? "-v" : ""}.mp4`;

/**
 * Render satu klip loop.
 * @param {string} nama desain (lihat VIDEO)  @param {string} berkas keluaran .mp4
 * @param {{detik?:number,fps?:number,vertikal?:boolean,lebar?:number,tinggi?:number,crf?:number,timeoutMs?:number}} o
 */
export async function renderVideo(nama, berkas, o = {}) {
  const buat = DESAIN[nama]; if (!buat) throw new Error(`desain video tidak dikenal: ${nama}`);
  const fps = o.fps || 30, detik = o.detik || 10, vertikal = !!o.vertikal, W = o.lebar || (vertikal ? 1080 : 1920), H = o.tinggi || (vertikal ? 1920 : 1080), N = Math.round(fps * detik);
  fs.mkdirSync(path.dirname(path.resolve(berkas)), { recursive: true });
  const c = createCanvas(W, H), g = c.getContext("2d"), gambar = buat(W, H);
  const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(fps), "-i", "-", "-an", "-threads", String(Number(process.env.STOK_FFMPEG_THREADS) || 2),
    "-c:v", "libx264", "-preset", "medium", "-crf", String(o.crf || 17), "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", berkas], { stdio: ["pipe", "ignore", "pipe"] });
  let err = ""; ff.stderr.on("data", (d) => { err = (err + d).slice(-1500); }); ff.stdin.on("error", () => {});
  const selesai = new Promise((res, rej) => { ff.on("error", (e) => rej(new Error(`ffmpeg tidak bisa dijalankan: ${e.message}`))); ff.on("close", (k) => (k === 0 ? res() : rej(new Error(`ffmpeg kode ${k}: ${err.slice(-200)}`)))); });
  selesai.catch(() => {});
  const timer = setTimeout(() => ff.kill("SIGKILL"), o.timeoutMs || 20 * 60 * 1000);
  try {
    for (let f = 0; f < N; f++) {
      gambar(g, f / N);
      const buf = Buffer.from(g.getImageData(0, 0, W, H).data.buffer);
      if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once("drain", r)), selesai]);
      await new Promise((r) => setImmediate(r)); // beri kesempatan pesan WA lain diproses
    }
    ff.stdin.end(); await selesai;
  } catch (e) { ff.kill("SIGKILL"); throw e; } finally { clearTimeout(timer); }
  return { berkas, lebar: W, tinggi: H, fps, detik, frame: N };
}

/** Ambil satu bingkai JPEG sebagai pratinjau. */
export function ambilBingkai(berkas, keluar, detikKe = 3) {
  fs.mkdirSync(path.dirname(path.resolve(keluar)), { recursive: true });
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(detikKe), "-i", berkas, "-frames:v", "1", "-q:v", "3", keluar], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0 || !fs.existsSync(keluar)) throw new Error(`gagal mengambil bingkai: ${String(r.stderr).slice(-150)}`);
  return keluar;
}

const hitungFps = (s) => { const [a, b] = String(s || "0/1").split("/").map(Number); return b ? a / b : a; };
/** Periksa klip terhadap syarat teknis Adobe Stock. longgar=true melewati batas resolusi/durasi (hanya untuk tes). */
export function periksaVideo(berkas, { longgar = false } = {}) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", berkas], { encoding: "utf8", timeout: 60000, maxBuffer: 10 << 20 });
  if (r.status !== 0) return { ok: false, masalah: ["tidak bisa dibaca ffprobe"], info: null };
  let j; try { j = JSON.parse(r.stdout); } catch { return { ok: false, masalah: ["keluaran ffprobe tidak valid"], info: null }; }
  const v = (j.streams || []).find((s) => s.codec_type === "video"); if (!v) return { ok: false, masalah: ["tidak ada aliran video"], info: null };
  const fps = hitungFps(v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : v.r_frame_rate), detik = Number(j.format?.duration) || 0, mb = (Number(j.format?.size) || 0) / 1048576;
  const info = { lebar: v.width, tinggi: v.height, fps: Math.round(fps * 1000) / 1000, detik: Math.round(detik * 100) / 100, kodek: v.codec_name, ukuranMB: Math.round(mb * 10) / 10, audio: (j.streams || []).some((s) => s.codec_type === "audio"), wadah: j.format?.format_name || "" };
  const masalah = [];
  if (!/mp4|mov|mpeg/.test(info.wadah)) masalah.push(`wadah ${info.wadah} bukan MP4/MOV/MPG`);
  if (!SPEK.kodek.includes(info.kodek)) masalah.push(`kodek ${info.kodek} tidak termasuk yang diterima`);
  if (!SPEK.fps.some((x) => Math.abs(x - fps) < 0.011)) masalah.push(`frame rate ${info.fps} tidak termasuk (23,98/24/25/29,97/30/50/59,94/60)`);
  if (mb > SPEK.ukuranMaksMB) masalah.push(`ukuran ${info.ukuranMB} MB melebihi ${SPEK.ukuranMaksMB} MB`);
  if (!longgar) {
    if (detik < SPEK.detikMin - 0.05 || detik > SPEK.detikMaks + 0.05) masalah.push(`durasi ${info.detik} dtk di luar 5-60 dtk`);
    if (!SPEK.resolusi.some(([w, h]) => w === info.lebar && h === info.tinggi)) masalah.push(`resolusi ${info.lebar}x${info.tinggi} tidak termasuk yang diterima`);
  }
  return { ok: masalah.length === 0, masalah, info };
}
