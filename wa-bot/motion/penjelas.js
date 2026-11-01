// Mesin video penjelas bergambar: isi (JSON) -> adegan ilustrasi dengan kamera, label, panah, panel, takarir.
// buatTemplatPenjelas() menghasilkan objek templat yang kompatibel dengan render.js dan content.js.
import { W, THEMES, clamp, P, lerp, eo, efek, font, kotak, potong } from "./engine.js";
import { WR, pakaiTema, kamera, pakaiKamera, latarGambar, label, takarir, lapisBawah, kepala, kapsul, panelBatang, kartuInti, kaki } from "./ilustrasi.js";
import { BENDA, DAFTAR_BENDA, gambarBenda } from "./benda.js";
import { S, N, hasil } from "./templates/util.js";

const MASUK = ["pop", "jatuh", "naik", "kiri", "kanan", "tumbuh"];
const LATAR = new Set(["ombak", "panah_besar"]);
const MAKS_DURASI = 46, MAKS_BARIS = 8;
const petaX = (x) => 60 + clamp(x, 0, 100) * 6;
const petaY = (y, panel) => 250 + clamp(y, 0, 100) * (panel ? 4.5 : 7.2);
const jumlahKata = (s) => String(s).replace(/\*\*/g, "").trim().split(/\s+/).filter(Boolean).length;
const tanpaTanda = (s) => String(s).replace(/\*\*/g, "");
const durBaris = (teks) => clamp(0.38 * jumlahKata(teks) + 0.9, 2.2, 6);

/** Susun waktu: tiap baris narasi mendapat durasi sesuai jumlah kata. */
export function susunWaktu(c) {
  let t = 0.5;
  const bab = c.bab.map((b, i) => {
    const t0 = t, baris = b.baris.map((teks) => { const d = durBaris(teks), o = { t0: t, t1: t + d, teks }; t += d; return o; });
    t += 0.5; return { ...b, i, t0, t1: t, baris };
  });
  return { bab, tInti: t, durasi: t + 4.4 };
}

function rapikanBab(b, i, gal) {
  const tag = `bab ${i + 1}`, g = [];
  const bab = { judul: S(b, "judul", 28, g), chip: S(b, "chip", 44, g), fokus: b?.fokus === "dekat" ? "dekat" : "lebar", baris: [], objek: [], panah: [], panel: null };
  const baris = Array.isArray(b?.baris) ? b.baris.map((x) => potong(x, 110)).filter(Boolean) : [];
  if (baris.length < 1 || baris.length > 3) g.push('"baris" harus 1-3 kalimat');
  baris.slice(0, 3).forEach((x, k) => { if (jumlahKata(x) > 17) g.push(`baris ${k + 1} terlalu panjang (maks 16 kata)`); });
  bab.baris = baris.slice(0, 3);
  const nB = Math.max(1, bab.baris.length);
  const objekRaw = Array.isArray(b?.objek) ? b.objek : [];
  if (objekRaw.length < 2 || objekRaw.length > 6) g.push('"objek" harus 2-6 benda');
  const dipakai = new Set();
  objekRaw.slice(0, 6).forEach((o, k) => {
    const jenis = String(o?.jenis || "").trim();
    if (!BENDA[jenis]) { g.push(`jenis benda "${jenis}" tidak ada (pilih dari: ${DAFTAR_BENDA.join(", ")})`); return; }
    let id = String(o?.id || `${jenis}${k}`).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || `o${k}`;
    while (dipakai.has(id)) id += "x"; dipakai.add(id);
    const num = (v, d, a, z) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, a, z) : d; };
    bab.objek.push({
      id, jenis, x: num(o.x, 50, 0, 100), y: num(o.y, 50, 0, 100), s: num(o.s, 1, 0.5, 2.4),
      baris: Math.round(num(o.baris, 0, 0, nB - 1)), masuk: MASUK.includes(o.masuk) ? o.masuk : "pop",
      label: o.label ? potong(o.label, 24) : "", sorot: o.sorot === true, nilai: o.nilai == null ? undefined : num(o.nilai, 0.5, 0, 1)
    });
  });
  const ids = new Set(bab.objek.map((o) => o.id));
  for (const a of Array.isArray(b?.panah) ? b.panah.slice(0, 3) : []) {
    if (!ids.has(a?.dari) || !ids.has(a?.ke) || a.dari === a.ke) { g.push(`panah ${a?.dari}->${a?.ke}: id objek tidak ada (id yang ada: ${[...ids].join(", ")})`); continue; }
    bab.panah.push({ dari: a.dari, ke: a.ke, baris: Math.round(clamp(Number(a.baris) || 0, 0, nB - 1)), label: a.label ? potong(a.label, 20) : "" });
  }
  if (b?.panel && typeof b.panel === "object") {
    const pg = [], rows = Array.isArray(b.panel.baris) ? b.panel.baris.slice(0, 3) : [];
    const panel = { judul: S(b.panel, "judul", 40, pg), maks: N(b.panel, "maks", pg), muncul: Math.round(clamp(Number(b.panel.muncul) || 0, 0, nB - 1)), baris: rows.map((r) => ({ nama: potong(r?.nama || "", 22), nilai: Number(r?.nilai) || 0, tampil: potong(r?.tampil || "", 18) })) };
    if (panel.baris.length < 2) pg.push("panel butuh 2-3 baris");
    if (panel.maks <= 0 || panel.baris.some((r) => r.nilai < 0 || r.nilai > panel.maks)) pg.push('nilai panel harus 0..maks');
    if (pg.length) g.push(...pg.map((x) => `panel: ${x}`)); else bab.panel = panel;
  }
  // tumpang tindih: jarak antarpusat terlalu dekat
  const w = bab.objek.filter((o) => !LATAR.has(o.jenis)).map((o) => ({ ...o, wx: petaX(o.x), wy: petaY(o.y, !!bab.panel) }));
  for (let a = 0; a < w.length; a++) for (let c2 = a + 1; c2 < w.length; c2++) {
    const d = Math.hypot(w[a].wx - w[c2].wx, w[a].wy - w[c2].wy);
    if (d < 0.55 * 58 * (w[a].s + w[c2].s)) g.push(`benda "${w[a].id}" dan "${w[c2].id}" bertumpuk, geser salah satunya`);
  }
  gal.push(...g.map((x) => `${tag}: ${x}`));
  return bab;
}
export function rapikanPenjelas(raw) {
  const gal = [], isi = { judul: S(raw, "judul", 80, gal), sumberTeks: S(raw, "sumberTeks", 100, gal, false), inti: S(raw, "inti", 150, gal), bab: [] };
  const babRaw = Array.isArray(raw?.bab) ? raw.bab : [];
  if (babRaw.length < 2 || babRaw.length > 3) gal.push('"bab" harus 2-3 butir');
  isi.bab = babRaw.slice(0, 3).map((b, i) => rapikanBab(b, i, gal));
  const nBaris = isi.bab.reduce((s, b) => s + b.baris.length, 0);
  if (nBaris > MAKS_BARIS) gal.push(`total kalimat narasi ${nBaris}, maksimal ${MAKS_BARIS}`);
  if (!gal.length && susunWaktu(isi).durasi > MAKS_DURASI) gal.push("video terlalu panjang, persingkat kalimat");
  return hasil(isi, gal);
}
/** Angka yang harus tertulis di sumber: bilangan >= 2 digit di semua teks (tahun, ribuan, desimal). Angka satu digit diabaikan. */
export function angkaKunciPenjelas(c) {
  const teks = [c.judul, c.inti, ...c.bab.flatMap((b) => [b.chip, ...b.baris, ...b.objek.map((o) => o.label), ...b.panah.map((p) => p.label), ...(b.panel ? [b.panel.judul, ...b.panel.baris.map((r) => r.tampil), ...b.panel.baris.map((r) => String(r.nilai))] : [])])];
  const hit = new Set();
  for (const s of teks) for (const m of String(s || "").matchAll(/\d[\d.,]*\d/g)) hit.add(m[0]);
  return [...hit];
}

function panahAntar(g, t, t0, A, B, teks) {
  const p = eo(clamp((t - t0) / 0.7)); if (p <= 0) return;
  const dx = B.wx - A.wx, dy = B.wy - A.wy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, ra = 62 * A.s, rb = 66 * B.s;
  if (L < ra + rb + 30) return;
  const x1 = A.wx + ux * ra, y1 = A.wy + uy * ra, x2 = B.wx - ux * rb, y2 = B.wy - uy * rb, xe = lerp(x1, x2, p), ye = lerp(y1, y2, p);
  g.save(); g.strokeStyle = WR.amber; g.fillStyle = WR.amber; g.lineWidth = 9; g.lineCap = "round";
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(xe - ux * 16, ye - uy * 16); g.stroke();
  g.beginPath(); g.moveTo(xe, ye); g.lineTo(xe - ux * 30 - uy * 16, ye - uy * 30 + ux * 16); g.lineTo(xe - ux * 30 + uy * 16, ye - uy * 30 - ux * 16); g.closePath(); g.fill();
  if (teks && p > 0.85) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, k = clamp((p - 0.85) / 0.15);
    g.translate(mx, my); g.scale(k, k); g.font = font(800, 22); const w = g.measureText(teks).width + 28;
    kotak(g, -w / 2, -18, w, 36, 18); g.fillStyle = WR.krem; g.fill(); g.strokeStyle = WR.tinta; g.lineWidth = 2.5; g.stroke();
    g.fillStyle = WR.tinta; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(teks, 0, 1);
  }
  g.restore();
}

/**
 * Buat templat penjelas.
 * @param {object} d  id, nama, hari, tema, arahan (panduan struktur untuk AI), contoh, musik?
 */
export function buatTemplatPenjelas({ id, nama, hari = null, tema, arahan, contoh, musik }) {
  const skema = `{"judul":"...","hook":"3-6 kata pemancing rasa penasaran","bab":[{"judul":"maks 28 huruf","chip":"kalimat pendek dengan **kata kunci**","fokus":"lebar atau dekat","baris":["kalimat narasi 1","kalimat 2"],"objek":[{"id":"a","jenis":"matahari","x":20,"y":20,"s":1,"baris":0,"masuk":"pop","label":"opsional","sorot":false,"nilai":0.5}],"panah":[{"dari":"a","ke":"b","baris":1,"label":"opsional"}],"panel":{"judul":"...","maks":100,"muncul":0,"baris":[{"nama":"...","nilai":10,"tampil":"10 m"}]}}],"inti":"kalimat penutup dengan **kata kunci**","dasar":"satu kalimat ringkas fakta utama"}`;
  const aturan = `ATURAN BENTUK: 2-3 bab; tiap bab 1-3 kalimat narasi (maks 16 kata per kalimat, total semua bab maksimal ${MAKS_BARIS} kalimat); tiap bab 2-6 benda (objek), 0-3 panah, panel opsional (2-3 baris, hanya untuk angka yang tertulis di SUMBER). x,y = posisi di panggung 0-100 (0,0 = kiri atas); benda tidak boleh bertumpuk (jarak antarpusat minimal 25 satuan untuk s=1). "baris" pada benda = nomor kalimat (mulai 0) saat benda muncul. "masuk": ${MASUK.join("|")}. Kata kunci diapit ** **. Jenis benda HANYA dari daftar: ${DAFTAR_BENDA.map((j) => `${j} (${BENDA[j].nama})`).join(", ")}. Pilih benda yang paling cocok dengan kalimatnya (misalnya matahari untuk panas, tetes untuk air, termometer untuk suhu); "ombak" adalah latar lebar (s 1.6-2, y 80-90). Jangan membuat benda yang tidak ada dalam daftar.`;
  const tpl = {
    id, nama, hari, jalur: "fakta", tema, ilustrasi: true,
    musik: musik || { bpm: 90, akor: [[53, [53, 57, 60]], [55, [55, 59, 62]], [57, [57, 60, 64]], [50, [50, 53, 57]]], kick: false, hat: true },
    petunjukIsi: `${skema}\n// ${aturan}\n// GAYA VIDEO: ${arahan}`,
    contoh,
    rapikan: rapikanPenjelas,
    angkaKunci: angkaKunciPenjelas,
    narasi(c) { return [...c.bab.flatMap((b) => b.baris.map(tanpaTanda)), tanpaTanda(c.inti)].join(" "); },
    bangun(c, opsi = {}) {
      const th = THEMES[opsi.tema || tema], W0 = susunWaktu(c), { bab, tInti, durasi } = W0;
      // posisi dunia tiap benda
      bab.forEach((b) => b.objek.forEach((o) => { o.wx = petaX(o.x); o.wy = petaY(o.y, !!b.panel); }));
      // kamera
      const kunci = []; let prev = { x: 360, y: 600, z: 1 };
      bab.forEach((b, i) => {
        let target = { x: 360, y: 600, z: 1 };
        if (b.fokus === "dekat") {
          const os = b.objek.filter((o) => !LATAR.has(o.jenis)); if (os.length) {
            const x0 = Math.min(...os.map((o) => o.wx - 60 * o.s)), x1 = Math.max(...os.map((o) => o.wx + 60 * o.s)), y0 = Math.min(...os.map((o) => o.wy)), y1 = Math.max(...os.map((o) => o.wy));
            target = { x: clamp((x0 + x1) / 2, 300, 420), y: clamp((y0 + y1) / 2 + 20, 560, 660), z: clamp(660 / (x1 - x0 + 120), 1, 1.28) };
          }
        }
        if (i === 0) kunci.push({ t: 0, ...target }); else { kunci.push({ t: b.t0, ...prev }); kunci.push({ t: b.t0 + 1.2, ...target }); }
        prev = target;
      });
      kunci.push({ t: durasi, ...prev });
      const takarirSeg = bab.flatMap((b) => b.baris.map((r) => [r.t0, r.t1, r.teks]));
      const sfx = efek([0.3, "whoosh", { gain: 0.25 }]);
      bab.forEach((b, i) => {
        if (i > 0) sfx.push({ t: b.t0, k: "whoosh", gain: 0.25 });
        b.objek.forEach((o, k) => sfx.push({ t: b.baris[o.baris].t0 + 0.12 + k * 0.12, k: "pop", f: 480 + 70 * (k % 5), gain: 0.4 }));
        b.panah.forEach((a) => sfx.push({ t: b.baris[a.baris].t0 + 0.5, k: "whoosh", gain: 0.2 }));
        if (b.panel) b.panel.baris.forEach((_, k) => sfx.push({ t: b.baris[b.panel.muncul].t0 + 0.55 + k * 0.45, k: "tick", f: 800 + 100 * k, gain: 0.4 }));
      });
      sfx.push({ t: tInti + 0.2, k: "chime", gain: 0.5 });
      return {
        durasi, efek: sfx,
        gambar(g, t) {
          pakaiTema(th); const cam = kamera(kunci, t), z = cam.z;
          latarGambar(g, cam);
          const b = bab.find((x) => t < x.t1) || bab[bab.length - 1];
          const akhir = t >= tInti;
          g.save(); pakaiKamera(g, cam);
          if (!akhir) {
            const alfa = 1 - eo(P(t, b.t1 - 0.45, b.t1)), peta = new Map(b.objek.map((o) => [o.id, o]));
            const urut = [...b.objek].sort((p, q) => (LATAR.has(q.jenis) ? 1 : 0) - (LATAR.has(p.jenis) ? 1 : 0));
            urut.forEach((o) => {
              const k = b.objek.indexOf(o), to = b.baris[o.baris].t0 + 0.12 + k * 0.12;
              const aktif = o.sorot ? clamp(P(t, to + 0.5, to + 0.9)) * (1 - clamp(P(t, to + 2.0, to + 2.4))) : 0;
              gambarBenda(g, t, o.jenis, { x: o.wx, y: o.wy, s: o.s, p: clamp((t - to) / 0.6), masuk: o.masuk, aktif, nilai: o.nilai, alfa });
            });
            g.globalAlpha = alfa;
            for (const a of b.panah) panahAntar(g, t, b.baris[a.baris].t0 + 0.5, peta.get(a.dari), peta.get(a.ke), a.label);
            for (const o of b.objek) if (o.label) {
              const k = b.objek.indexOf(o), to = b.baris[o.baris].t0 + 0.12 + k * 0.12, bawah = o.wy < 820, dy = (LATAR.has(o.jenis) ? 40 : 62 * o.s) + 34;
              label(g, t, to + 0.4, o.label, o.wx, o.wy, o.wx, bawah ? o.wy + dy : o.wy - dy, z, WR.teal);
            }
            g.globalAlpha = 1;
          }
          g.restore();
          lapisBawah(g);
          const bi = akhir ? bab.length - 1 : b.i, bb = bab[bi];
          kepala(g, t, { nomor: bi + 1, total: bab.length, judul: bb.judul, tBab: bb.t0 });
          kapsul(g, t, bb.t0 + 0.3, bb.chip);
          if (!akhir && b.panel) panelBatang(g, t, b.baris[b.panel.muncul].t0 + 0.3, { judul: b.panel.judul, maks: b.panel.maks, t1: b.t1 - 0.1, y: 975 - (62 + b.panel.baris.length * 56), baris: b.panel.baris.map((r, k) => ({ ...r, warna: [WR.amber, WR.teal, WR.karat][k % 3] })) });
          takarir(g, t, takarirSeg);
          kartuInti(g, t, tInti, c.inti);
          kaki(g, t, durasi, c.sumberTeks || "");
        }
      };
    }
  };
  return tpl;
}
