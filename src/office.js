// ================================================================
// KANTOR AI: halaman yang menampilkan para "karyawan" (bot dan agen) sebagai tokoh piksel di sebuah kantor.
// Tiap karyawan punya meja, status (kerja, mikir, menunggu izin, galat, tidur), gelembung ucapan, dan
// bisa berjalan menyerahkan hasil kerja ke karyawan lain. Di bawah kantor ada ringkasan, kartu karyawan,
// dan umpan kejadian langsung.
//
// Sumber data: DATA ASLI (office-live.js, memanggil Edge Function `office`) atau SIMULASI contoh (office-sim.js);
// keduanya memanggil pushOfficeEvent() dengan bentuk kejadian yang sama (lihat komentar di office-sim.js).
// Mode awal = data asli; tombol di bawah adegan beralih ke "Contoh" (pilihan diingat di peramban).
// Adegan digambar di <canvas> 320x200 piksel logis yang diperbesar tanpa penghalusan; teks (gelembung, label)
// berupa elemen HTML di atasnya supaya tajam dan bisa dibaca pembaca layar.
// ================================================================

import { createOfficeSim } from "./office-sim.js";
import { createOfficeLive } from "./office-live.js";

const W = 320;
const H = 200;
const FRAME_MS = 100;

// ---------------------------------------------------------------- data karyawan
const STAFF_DEF = [
  { id: "ayyubi", name: "Ayyubi", role: "Admin WhatsApp utama", x: 56, y: 90, mon: 1, look: { skin: "#e8b98a", hair: "#1c1c1c", hat: "peci", shirt: "#2f8f83", trim: "#ffffff" } },
  { id: "wongsobot", name: "Wongsobot", role: "Admin WhatsApp kedua", x: 120, y: 90, mon: 1, look: { skin: "#d9a577", hair: "#c9c9c9", stache: true, shirt: "#8a5a2b", trim: "#e2b85c" } },
  { id: "agen", name: "Agen Lokal", role: "Asisten laptop Windows", x: 230, y: 90, mon: 1, look: { robot: true, shirt: "#5b7fa6", head: "#9bb9da", trim: "#dff3ff" } },
  { id: "video", name: "Studio Video", role: "Perakit video & stop motion", x: 56, y: 160, mon: 1, look: { skin: "#f0c9a0", hair: "#7a3b1d", hat: "beret", shirt: "#c84b4b", trim: "#ffd9d9" } },
  { id: "gambar", name: "Studio Gambar", role: "Pelukis gambar & edit foto", x: 160, y: 160, mon: 0, look: { skin: "#e9bf94", hair: "#e0782a", hat: "none", shirt: "#e0a02a", trim: "#fff2c2" } },
  { id: "suara", name: "Studio Suara", role: "Penyuara & musik latar", x: 264, y: 160, mon: 0, look: { skin: "#dfae86", hair: "#3b2a6a", hat: "headset", shirt: "#7d57c2", trim: "#e5d6ff" } }
];

const STATE_LABEL = { offline: "Tidur", idle: "Siaga", think: "Berpikir", work: "Bekerja", wait: "Menunggu izin", error: "Galat", walk: "Mengantar" };
const KIND_ICON = { online: "●", offline: "○", think: "◌", work: "▶", progress: "▷", say: "“", wait: "?", done: "✓", error: "!", handoff: "→" };

// ---------------------------------------------------------------- palet adegan
const PAL_DAY = {
  wall: "#e8dfcf", wallTop: "#d6c9b0", base: "#a98f6b", floorA: "#c9b99a", floorB: "#bfae8d", rugA: "#8fb7a6", rugB: "#7fa595", rugC: "#a8b3d6", rugD: "#c9a7b8",
  deskTop: "#b07a45", deskFront: "#8a5b30", deskLine: "#6e4724", chair: "#46505f", mon: "#2b2f38", monGlow: "#9fe4ff", key: "#d7d7d7", plant: "#4a9a52", pot: "#a8603a",
  sky: "#8ecbf3", sun: "#ffd95e", frame: "#7a5a37", shadow: "rgba(40,30,20,0.18)", ink: "#2a2118", board: "#2f3d4a", boardTxt: ["#8be9a0", "#ffd166", "#7fd1ff", "#ff9d9d"], night: false
};
const PAL_NIGHT = {
  wall: "#2c3144", wallTop: "#232738", base: "#1b1e2c", floorA: "#3a3f55", floorB: "#353a4f", rugA: "#2f5b52", rugB: "#2a4f47", rugC: "#3a4670", rugD: "#5a3f56",
  deskTop: "#7d5430", deskFront: "#5f3f23", deskLine: "#47301b", chair: "#242a38", mon: "#14171f", monGlow: "#6fd0ff", key: "#8d93a3", plant: "#2f6b38", pot: "#6b3e26",
  sky: "#10153a", sun: "#f3f1d0", frame: "#4b3a28", shadow: "rgba(0,0,0,0.3)", ink: "#e8e2d4", board: "#10151d", boardTxt: ["#5fd078", "#e1b04f", "#58b6e6", "#e07a7a"], night: true
};

const px = (c, x, y, w, h, col) => {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
};

// ---------------------------------------------------------------- keadaan
let built = false;
let activeScreen = false;
let rootEl = null;
let canvas = null;
let ctx = null;
let staticLayer = { key: "", cv: null };
let timer = null;
let lastFrame = 0;
let frame = 0;
let sim = null;
let live = null;
let mode = loadMode(); // "live" | "sim"
let liveStatus = "connecting";
let liveMsg = "";
let hooks = { getCode: () => "", askCode: () => {} };
let presenceSeen = false;
const STALE_WORK_MS = 120_000;
const STALE_ERROR_MS = 90_000;
const SILENT_AGE_MS = 20_000; // kejadian lebih tua dari ini langsung diterapkan tanpa animasi

function loadMode() {
  try {
    return localStorage.getItem("office_mode") === "sim" ? "sim" : "live";
  } catch {
    return "live";
  }
}
function saveMode(m) {
  try {
    localStorage.setItem("office_mode", m);
  } catch {
    /* penyimpanan tidak tersedia */
  }
}
const staff = new Map();
const feed = [];
const fx = [];
let filterId = "";
let approvals = [];
let els = {};

function makeStaff() {
  staff.clear();
  for (const d of STAFF_DEF) {
    staff.set(d.id, {
      ...d,
      state: "offline",
      task: "Belum aktif",
      progress: 0,
      bubble: "",
      bubbleUntil: 0,
      done: 0,
      err: 0,
      walk: null, // { pts:[{x,y}], i, x, y, item, wait }
      shake: 0,
      blinkAt: 0,
      lastAt: 0
    });
  }
}

// ---------------------------------------------------------------- gambar: orang
function drawHead(c, s, hx, hy, t, talking) {
  const L = s.look;
  const sleeping = s.state === "offline";
  const bob = s.state === "think" ? ((t >> 2) % 2) : 0;
  hy += sleeping ? 2 : bob;
  const shakeX = s.state === "error" ? (((t >> 1) % 2) ? 1 : -1) : 0;
  hx += shakeX;
  if (L.robot) {
    const eye = s.state === "offline" ? "#3a4756" : s.state === "error" ? "#ff5a5a" : s.state === "wait" ? "#ffd84d" : "#7ff3ff";
    px(c, hx, hy + 1, 8, 7, L.head);
    px(c, hx + 1, hy + 1, 6, 1, "#c9ddf0");
    px(c, hx + 3, hy - 2, 2, 3, "#6f8fb2");
    const led = s.state === "work" ? ((t >> 1) % 2 ? "#ff5a5a" : "#7a2e2e") : s.state === "error" ? "#ff5a5a" : "#7a2e2e";
    px(c, hx + 3, hy - 3, 2, 1, led);
    const blink = ((t + 7) % 41) === 0;
    if (!sleeping && !blink) {
      px(c, hx + 1, hy + 3, 2, 2, eye);
      px(c, hx + 5, hy + 3, 2, 2, eye);
    } else {
      px(c, hx + 1, hy + 4, 2, 1, eye);
      px(c, hx + 5, hy + 4, 2, 1, eye);
    }
    px(c, hx + 2, hy + 6, 4, 1, talking ? "#2a3a4c" : "#6f8fb2");
    px(c, hx - 1, hy + 3, 1, 3, "#6f8fb2");
    px(c, hx + 8, hy + 3, 1, 3, "#6f8fb2");
    return;
  }
  // kepala
  px(c, hx + 1, hy, 6, 8, L.skin);
  px(c, hx, hy + 1, 8, 6, L.skin);
  // rambut / topi
  if (L.hat === "peci") {
    px(c, hx, hy - 2, 8, 4, "#161616");
    px(c, hx, hy + 1, 8, 1, "#2e2e2e");
  } else if (L.hat === "beret") {
    px(c, hx - 1, hy - 2, 9, 3, "#2f5db0");
    px(c, hx + 2, hy - 3, 2, 1, "#2f5db0");
    px(c, hx, hy + 1, 8, 1, L.hair);
    px(c, hx, hy + 2, 1, 2, L.hair);
    px(c, hx + 7, hy + 2, 1, 2, L.hair);
  } else {
    px(c, hx + 1, hy, 6, 2, L.hair);
    px(c, hx, hy + 1, 8, 1, L.hair);
    px(c, hx, hy + 2, 1, 3, L.hair);
    px(c, hx + 7, hy + 2, 1, 3, L.hair);
    if (L.hat === "headset") {
      px(c, hx - 1, hy + 2, 1, 4, "#303040");
      px(c, hx + 8, hy + 2, 1, 4, "#303040");
      px(c, hx, hy - 1, 8, 1, "#303040");
      px(c, hx + 8, hy + 5, 2, 1, "#303040");
      px(c, hx + 9, hy + 6, 1, 1, "#ff6b6b");
    }
  }
  // mata
  const blink = ((t + 11) % 37) === 0;
  if (sleeping || blink) {
    px(c, hx + 2, hy + 4, 2, 1, "#3a2a22");
    px(c, hx + 5, hy + 4, 2, 1, "#3a2a22");
  } else {
    px(c, hx + 2, hy + 4, 1, 1, "#241a14");
    px(c, hx + 5, hy + 4, 1, 1, "#241a14");
    if (s.state === "error") {
      px(c, hx + 2, hy + 3, 2, 1, "#241a14");
      px(c, hx + 5, hy + 3, 2, 1, "#241a14");
    }
  }
  if (L.stache) px(c, hx + 2, hy + 5, 4, 1, L.hair);
  px(c, hx + 3, hy + 6, 2, 1, talking ? "#7a2f2f" : "#a86a58");
  px(c, hx + 1, hy + 5, 1, 1, "rgba(220,110,110,0.45)");
  px(c, hx + 6, hy + 5, 1, 1, "rgba(220,110,110,0.45)");
  if (s.state === "error") px(c, hx + 8, hy + 1, 1, 2, "#6cc3ff");
}

function drawSeated(c, s, P, t) {
  const L = s.look;
  const desk = { x: s.x, y: s.y };
  const talking = s.bubble && Date.now() < s.bubbleUntil;
  // kursi
  px(c, desk.x - 8, desk.y - 14, 16, 14, P.chair);
  px(c, desk.x - 9, desk.y - 12, 1, 10, P.chair);
  px(c, desk.x + 8, desk.y - 12, 1, 10, P.chair);
  // badan
  const body = L.robot ? L.shirt : L.shirt;
  px(c, desk.x - 6, desk.y - 9, 12, 9, body);
  px(c, desk.x - 6, desk.y - 9, 12, 1, L.trim);
  px(c, desk.x - 1, desk.y - 9, 2, 3, L.trim);
  drawHead(c, s, desk.x - 4, desk.y - 17, t, talking);
  // lengan
  const typing = s.state === "work";
  const a1 = typing ? (t % 2 ? -1 : 0) : 0;
  const a2 = typing ? (t % 2 ? 0 : -1) : 0;
  const hand = L.robot ? "#9bb9da" : L.skin;
  px(c, desk.x - 8, desk.y - 8, 2, 8 + a1, body);
  px(c, desk.x - 8, desk.y + a1 - 1, 2, 2, hand);
  if (s.state === "wait") {
    // tangan kanan terangkat
    const up = (t >> 2) % 2 ? 0 : -1;
    px(c, desk.x + 6, desk.y - 22 + up, 2, 12, body);
    px(c, desk.x + 6, desk.y - 24 + up, 2, 3, hand);
  } else {
    px(c, desk.x + 6, desk.y - 8, 2, 8 + a2, body);
    px(c, desk.x + 6, desk.y + a2 - 1, 2, 2, hand);
  }
}

function drawStanding(c, s, x, y, t, step) {
  const L = s.look;
  const hand = L.robot ? "#9bb9da" : L.skin;
  px(c, x - 6, y, 12, 2, "rgba(0,0,0,0.18)");
  const leg = L.robot ? "#44566b" : "#3a4256";
  const o = step ? 1 : 0;
  px(c, x - 3, y - 7, 3, 7 - o, leg);
  px(c, x + 1, y - 7, 3, 6 + o, leg);
  px(c, x - 3, y - 1 - o, 3, 1, "#1d1d1d");
  px(c, x + 1, y - 1 + o, 3, 1, "#1d1d1d");
  px(c, x - 4, y - 16, 8, 9, L.shirt);
  px(c, x - 4, y - 16, 8, 1, L.trim);
  px(c, x - 6, y - 15, 2, 7, L.shirt);
  px(c, x + 4, y - 15, 2, 7, L.shirt);
  px(c, x - 6, y - 9, 2, 2, hand);
  px(c, x + 4, y - 9, 2, 2, hand);
  drawHead(c, { ...s, state: "work" }, x - 4, y - 25, t, false);
}

// ---------------------------------------------------------------- gambar: meja, layar, perabot
function drawScreen(c, s, P, t, x, y, w, h) {
  px(c, x - 1, y - 1, w + 2, h + 2, P.mon);
  let bg = "#10202e";
  if (s.state === "offline") bg = "#0c0e12";
  else if (s.state === "error") bg = (t >> 1) % 2 ? "#5a1c1c" : "#3a1212";
  else if (s.state === "wait") bg = "#4a3d12";
  px(c, x, y, w, h, bg);
  if (s.state === "offline") return;
  if (s.state === "error") {
    px(c, x + (w >> 1) - 1, y + 2, 2, h - 6, "#ff7a7a");
    px(c, x + (w >> 1) - 1, y + h - 3, 2, 2, "#ff7a7a");
    return;
  }
  if (s.state === "wait") {
    px(c, x + 2, y + 2, w - 4, 2, "#ffd84d");
    px(c, x + 2, y + 5, w - 6, 1, "#c9ad3c");
    return;
  }
  if (s.id === "suara") {
    for (let i = 0; i < 7; i++) {
      const bh = s.state === "work" ? 2 + Math.abs(Math.sin((t + i * 3) * 0.5)) * (h - 4) : 2;
      px(c, x + 1 + i * 2, y + h - 1 - Math.round(bh), 1, Math.round(bh), "#b79aff");
    }
    return;
  }
  const cols = ["#7fd1ff", "#8be9a0", "#ffd166", "#b79aff"];
  const n = Math.floor((h - 1) / 3);
  for (let i = 0; i < n; i++) {
    const lw = s.state === "work" ? 3 + ((i * 5 + (t >> 1) * 3) % (w - 4)) : 3 + ((i * 7) % (w - 5));
    px(c, x + 1, y + 1 + i * 3, Math.min(lw, w - 2), 1, cols[(i + (s.state === "work" ? t >> 3 : 0)) % cols.length]);
  }
  if (s.state === "idle" && (t >> 3) % 2) px(c, x + 2, y + h - 3, 2, 1, "#7ff3ff");
  if (s.state === "work") px(c, x - 3, y - 3, w + 6, h + 6, "rgba(140,220,255,0.10)");
}

function drawDesk(c, s, P, t) {
  const { x, y } = s;
  px(c, x - 24, y, 48, 6, P.deskTop);
  px(c, x - 24, y, 48, 1, "rgba(255,255,255,0.18)");
  px(c, x - 24, y + 6, 48, 10, P.deskFront);
  px(c, x - 24, y + 6, 48, 1, P.deskLine);
  px(c, x - 22, y + 9, 12, 6, P.deskLine);
  px(c, x + 10, y + 9, 12, 6, P.deskLine);
  px(c, x - 17, y + 11, 2, 1, "#cdb27a");
  px(c, x + 15, y + 11, 2, 1, "#cdb27a");
  px(c, x - 24, y + 16, 48, 2, P.shadow);
  // papan ketik
  px(c, x - 9, y + 1, 11, 2, P.key);
  // cangkir
  px(c, x - 21, y - 3, 4, 4, "#f2efe6");
  px(c, x - 17, y - 2, 1, 2, "#f2efe6");
  if (s.state === "work" || s.state === "think") px(c, x - 20 + ((t >> 2) % 2), y - 6, 1, 2, "rgba(255,255,255,0.5)");
}

function drawProps(c, s, P, t) {
  const { x, y } = s;
  if (s.id === "agen") {
    // laptop terbuka + tumpukan map + kotak masuk
    px(c, x + 5, y - 10, 15, 10, P.mon);
    drawScreen(c, s, P, t, x + 6, y - 9, 13, 8);
    px(c, x + 3, y - 1, 19, 2, "#9aa3b3");
    px(c, x + 6, y - 1, 13, 1, "#6e7686");
    px(c, x + 28, y - 8, 14, 3, "#d6b04c");
    px(c, x + 28, y - 5, 14, 3, "#6ba3d6");
    px(c, x + 29, y - 11, 12, 3, "#e2e2e2");
    return;
  }
  if (s.id === "video") {
    drawScreen(c, s, P, t, x + 8, y - 12, 17, 10);
    px(c, x + 15, y - 2, 3, 3, P.mon);
    // lini waktu
    const cols = ["#ff8a8a", "#ffd166", "#7fd1ff"];
    for (let i = 0; i < 3; i++) {
      const len = s.state === "work" ? 3 + ((s.progress / 100) * 11 + i * 2) % 12 : 6 + i * 2;
      px(c, x + 9, y - 10 + i * 3, Math.min(15, len), 1, cols[i]);
    }
    // papan klak
    px(c, x + 29, y - 6, 9, 6, "#262626");
    px(c, x + 29, y - 8, 9, 2, "#f0f0f0");
    px(c, x + 31, y - 8, 2, 2, "#262626");
    px(c, x + 35, y - 8, 2, 2, "#262626");
    return;
  }
  if (s.id === "gambar") {
    // kuda-kuda + kanvas yang terisi sesuai progres
    px(c, x + 27, y - 24, 2, 30, "#7a5a37");
    px(c, x + 41, y - 24, 2, 30, "#7a5a37");
    px(c, x + 25, y - 26, 20, 17, "#f3efe6");
    px(c, x + 25, y - 26, 20, 1, "#d7d1c2");
    const n = s.state === "work" ? Math.floor((s.progress / 100) * 5) : s.state === "idle" ? 5 : 1;
    const blocks = ["#7fc4f5", "#9ad48d", "#f2c14e", "#e57c7c", "#b79aff"];
    for (let i = 0; i < n; i++) px(c, x + 27 + (i % 3) * 6, y - 24 + Math.floor(i / 3) * 8, 5, 7, blocks[i]);
    // palet cat
    px(c, x - 4, y + 1, 9, 4, "#e9dcc2");
    px(c, x - 3, y + 1, 2, 2, "#e57c7c");
    px(c, x, y + 1, 2, 2, "#7fc4f5");
    px(c, x + 3, y + 1, 1, 2, "#f2c14e");
    // kuas di tangan
    if (s.state === "work") px(c, x + 7 + ((t >> 1) % 3), y - 12 - ((t >> 1) % 2), 1, 8, "#8a5b30");
    return;
  }
  if (s.id === "suara") {
    // mikrofon + layar gelombang + pengeras suara
    drawScreen(c, s, P, t, x + 8, y - 12, 16, 10);
    px(c, x - 14, y - 14, 2, 14, "#444a57");
    px(c, x - 18, y - 17, 8, 4, "#2b2f38");
    px(c, x - 16, y - 16, 4, 2, "#8a93a6");
    px(c, x + 29, y - 14, 10, 16, "#2b2f38");
    px(c, x + 32, y - 11, 4, 4, "#555d6e");
    px(c, x + 31, y - 5, 6, 6, "#555d6e");
    if (s.state === "work" && (t >> 1) % 2) {
      px(c, x + 40, y - 9, 1, 6, "rgba(183,154,255,0.7)");
      px(c, x + 42, y - 11, 1, 10, "rgba(183,154,255,0.4)");
    }
    return;
  }
  // ayyubi, wongsobot: layar obrolan
  drawScreen(c, s, P, t, x + 9, y - 13, 14, 11);
  px(c, x + 14, y - 2, 4, 3, P.mon);
  if (s.state === "work" || s.state === "idle") {
    const o = (t >> 3) % 2;
    px(c, x + 10, y - 11 + o, 6, 2, "#8be9a0");
    px(c, x + 15, y - 7 - o, 7, 2, "#7fd1ff");
  }
}

// ---------------------------------------------------------------- gambar: latar statis
function buildStatic(P) {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  px(c, 0, 0, W, H, P.floorA);
  for (let y = 50; y < H; y += 10) for (let x = 0; x < W; x += 10) if (((x + y) / 10) % 2 === 0) px(c, x, y, 10, 10, P.floorB);
  // dinding
  px(c, 0, 0, W, 46, P.wall);
  px(c, 0, 0, W, 4, P.wallTop);
  px(c, 0, 46, W, 4, P.base);
  px(c, 0, 50, W, 1, "rgba(0,0,0,0.12)");
  // karpet tiap zona
  const rug = (x, y, w, h, a, b) => {
    px(c, x, y, w, h, a);
    px(c, x + 2, y + 2, w - 4, h - 4, b);
  };
  rug(10, 62, 150, 60, P.rugA, P.rugB);
  rug(176, 62, 134, 60, P.rugC, P.rugC);
  px(c, 178, 64, 130, 56, "rgba(255,255,255,0.07)");
  rug(10, 130, 300, 62, P.rugD, P.rugD);
  px(c, 12, 132, 296, 58, "rgba(255,255,255,0.07)");
  // jendela
  px(c, 8, 8, 44, 32, P.frame);
  px(c, 10, 10, 40, 28, P.sky);
  if (P.night) {
    px(c, 38, 14, 6, 6, P.sun);
    px(c, 40, 14, 4, 6, P.sky);
    for (const [sx, sy] of [[14, 14], [22, 20], [30, 13], [18, 30], [44, 28], [26, 34]]) px(c, sx, sy, 1, 1, "#ffffff");
  } else {
    px(c, 36, 14, 8, 8, P.sun);
    px(c, 12, 28, 14, 4, "#ffffff");
    px(c, 16, 25, 10, 4, "#ffffff");
  }
  px(c, 29, 10, 2, 28, P.frame);
  px(c, 10, 23, 40, 2, P.frame);
  // rak buku
  px(c, 62, 10, 34, 34, "#7a5a37");
  px(c, 64, 12, 30, 14, "#5e4429");
  px(c, 64, 28, 30, 14, "#5e4429");
  const bk = ["#c84b4b", "#2f8f83", "#e0a02a", "#5b7fa6", "#7d57c2", "#e0782a"];
  for (let i = 0; i < 9; i++) {
    px(c, 65 + i * 3, 13 + (i % 2), 2, 12 - (i % 2), bk[i % bk.length]);
    px(c, 65 + i * 3, 29 + ((i + 1) % 2), 2, 12 - ((i + 1) % 2), bk[(i + 2) % bk.length]);
  }
  // tanaman
  px(c, 300, 30, 12, 16, P.pot);
  px(c, 298, 18, 6, 14, P.plant);
  px(c, 304, 14, 6, 18, P.plant);
  px(c, 308, 20, 5, 12, P.plant);
  px(c, 8, 52, 0, 0, P.plant);
  // dispenser air + printer
  px(c, 108, 26, 12, 20, "#d6dde6");
  px(c, 110, 18, 8, 10, "#9fd3f5");
  px(c, 111, 34, 3, 2, "#4a82c4");
  px(c, 124, 36, 18, 10, "#c9ccd2");
  px(c, 126, 32, 14, 4, "#eeeeee");
  px(c, 128, 40, 10, 2, "#6b7280");
  // meja resepsionis kecil di sisi kanan bawah tak dipakai; garis lantai
  return cv;
}

// ---------------------------------------------------------------- gambar: adegan dinamis
function drawBoard(c, P, t) {
  // papan kejadian di dinding: baris kecil yang bergulir sesuai kejadian terbaru
  px(c, 160, 6, 130, 36, P.frame);
  px(c, 162, 8, 126, 32, P.board);
  const kindCol = { done: 0, work: 2, progress: 2, think: 1, say: 1, wait: 1, error: 3, handoff: 2, online: 0, offline: 3 };
  const rows = feed.slice(0, 5);
  rows.forEach((e, i) => {
    const col = P.boardTxt[kindCol[e.kind] ?? 0];
    const len = Math.min(110, 18 + ((e.text || "").length * 2.6) | 0);
    px(c, 166, 11 + i * 6, 3, 3, col);
    px(c, 172, 12 + i * 6, len, 2, col);
  });
  if ((t >> 3) % 2) px(c, 166, 11 + Math.min(rows.length, 5) * 6, 3, 3, "#ffffff");
  // jam
  const d = new Date();
  const cx = 150;
  const cy = 24;
  px(c, cx - 8, cy - 8, 16, 16, P.frame);
  px(c, cx - 7, cy - 7, 14, 14, "#f3efe6");
  const hand = (len, ang, col) => {
    for (let r = 0; r <= len; r++) px(c, cx + Math.round(Math.sin(ang) * r), cy - Math.round(Math.cos(ang) * r), 1, 1, col);
  };
  hand(3, ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, "#222222");
  hand(5, d.getMinutes() / 60 * Math.PI * 2, "#222222");
  hand(5, d.getSeconds() / 60 * Math.PI * 2, "#d04040");
}

function drawFx(c, t) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= 1;
    if (f.life <= 0) {
      fx.splice(i, 1);
      continue;
    }
    f.x += f.vx;
    f.y += f.vy;
    f.vy += 0.05;
    px(c, f.x, f.y, f.big ? 2 : 1, f.big ? 2 : 1, f.col);
  }
}

function burst(x, y, cols, n = 12) {
  for (let i = 0; i < n; i++) {
    fx.push({ x, y, vx: (Math.random() - 0.5) * 2.2, vy: -Math.random() * 1.8 - 0.4, life: 14 + Math.floor(Math.random() * 8), col: cols[i % cols.length], big: i % 3 === 0 });
  }
}

function itemGlyph(c, item, x, y) {
  const map = {
    video: ["#262626", "#ff8a8a"],
    naskah: ["#f3efe6", "#6b7280"],
    suara: ["#7d57c2", "#e5d6ff"],
    gambar: ["#f2c14e", "#7fc4f5"],
    berkas: ["#d6b04c", "#fff2c2"],
    pesan: ["#8be9a0", "#2f8f83"]
  };
  const [a, b] = map[item] || map.berkas;
  px(c, x - 4, y - 3, 8, 6, a);
  px(c, x - 2, y - 1, 4, 2, b);
}

function drawScene(t) {
  const attr = document.documentElement.getAttribute("data-theme");
  const dark = attr ? attr === "dark" : Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const P = dark ? PAL_NIGHT : PAL_DAY;
  const key = dark ? "n" : "d";
  if (staticLayer.key !== key) staticLayer = { key, cv: buildStatic(P) };
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(staticLayer.cv, 0, 0);
  drawBoard(ctx, P, t);
  // urutkan menurut y supaya yang di belakang tertutup yang di depan
  const list = [...staff.values()].sort((a, b) => a.y - b.y);
  for (const s of list) {
    // bayangan kursi kosong kalau sedang berjalan
    if (s.walk) {
      px(ctx, s.x - 8, s.y - 14, 16, 14, P.chair);
    } else {
      drawSeated(ctx, s, P, t);
    }
    drawDesk(ctx, s, P, t);
    drawProps(ctx, s, P, t);
    if (s.state === "offline" && !s.walk && (t >> 2) % 4 !== 3) {
      const zz = (t >> 2) % 4;
      px(ctx, s.x + 8 + zz * 2, s.y - 22 - zz * 3, 3, 1, "#ffffff");
      px(ctx, s.x + 9 + zz * 2, s.y - 21 - zz * 3, 1, 1, "#ffffff");
      px(ctx, s.x + 8 + zz * 2, s.y - 20 - zz * 3, 3, 1, "#ffffff");
    }
    if (s.state === "think" && !s.walk) {
      for (let i = 0; i < 3; i++) if (((t >> 2) + i) % 4 !== 3) px(ctx, s.x - 6 + i * 4, s.y - 28, 2, 2, P.night ? "#ffffff" : "#2a2118");
    }
    if (s.state === "wait" && !s.walk && (t >> 2) % 2) {
      px(ctx, s.x + 11, s.y - 33, 3, 6, "#ffd84d");
      px(ctx, s.x + 11, s.y - 25, 3, 2, "#ffd84d");
    }
    if (s.state === "error" && !s.walk) {
      const on = (t >> 1) % 2;
      px(ctx, s.x - 1, s.y - 33, 3, 6, on ? "#ff5a5a" : "#b03a3a");
      px(ctx, s.x - 1, s.y - 25, 3, 2, on ? "#ff5a5a" : "#b03a3a");
    }
  }
  // yang sedang berjalan digambar paling depan
  for (const s of list) {
    if (!s.walk) continue;
    drawStanding(ctx, s, s.walk.x, s.walk.y, t, (t >> 1) % 2);
    if (s.walk.item) itemGlyph(ctx, s.walk.item, s.walk.x, s.walk.y - 34);
  }
  drawFx(ctx, t);
}

// ---------------------------------------------------------------- jalan kaki
function startWalk(from, toId, item) {
  const a = staff.get(from);
  const b = staff.get(toId);
  if (!a || !b || a.walk) return;
  const lane = Math.max(a.y, b.y) + 26;
  const stopX = b.x + (b.x > a.x ? -28 : 28);
  const stopY = b.y + 10;
  a.walk = {
    pts: [
      { x: a.x, y: a.y + 14 },
      { x: a.x, y: Math.min(lane, 128) },
      { x: stopX, y: Math.min(lane, 128) },
      { x: stopX, y: stopY }
    ],
    i: 1,
    x: a.x,
    y: a.y + 14,
    item,
    wait: 0,
    returning: false,
    toId
  };
  a.prevState = a.state;
}

function stepWalks(dtSec) {
  for (const s of staff.values()) {
    const w = s.walk;
    if (!w) continue;
    if (w.wait > 0) {
      w.wait -= dtSec;
      if (w.wait <= 0 && !w.returning) {
        // balik ke meja
        w.returning = true;
        w.pts = w.pts.slice().reverse();
        w.i = 1;
        w.item = null;
        const target = staff.get(w.toId);
        if (target) burst(target.x, target.y - 30, ["#ffd84d", "#8be9a0", "#7fd1ff"], 8);
      }
      continue;
    }
    const tgt = w.pts[w.i];
    const dx = tgt.x - w.x;
    const dy = tgt.y - w.y;
    const dist = Math.hypot(dx, dy);
    const sp = 52 * dtSec;
    if (dist <= sp) {
      w.x = tgt.x;
      w.y = tgt.y;
      w.i += 1;
      if (w.i >= w.pts.length) {
        if (!w.returning) w.wait = 1.1;
        else s.walk = null;
      }
    } else {
      w.x += (dx / dist) * sp;
      w.y += (dy / dist) * sp;
    }
  }
}

// ---------------------------------------------------------------- kejadian
export function pushOfficeEvent(e, opts = {}) {
  const s = staff.get(e.who);
  if (!s) return;
  const silent = Boolean(opts.silent); // dari riwayat: terapkan keadaan tanpa jalan-jalan, bubble, dan kembang api
  const now = Number.isFinite(opts.at) ? opts.at : Date.now();
  s.lastAt = now;
  const text = String(e.text || "").slice(0, 120);
  let newText = false;
  switch (e.kind) {
    case "online":
      s.state = "idle";
      s.task = text || "Siaga";
      s.progress = 0;
      break;
    case "offline":
      s.state = "offline";
      s.task = text || "Belum aktif";
      s.progress = 0;
      break;
    case "think":
      s.state = "think";
      s.task = text;
      s.progress = 0;
      break;
    case "work":
      newText = !(s.state === "work" && s.task === text);
      s.state = "work";
      s.task = text;
      s.progress = e.progress ?? s.progress;
      break;
    case "progress":
      if (s.state === "idle" || s.state === "offline") s.state = "work";
      s.progress = e.progress ?? s.progress;
      if (text && text !== s.task) {
        s.task = text;
        newText = true;
      }
      break;
    case "say":
      s.task = text || s.task;
      break;
    case "wait":
      s.state = "wait";
      s.task = text;
      if (e.approval && mode === "sim") approvals.push({ ...e.approval, who: e.who, at: now });
      break;
    case "done":
      s.state = "idle";
      s.task = text || "Selesai";
      s.progress = silent ? 0 : 100;
      s.done += 1;
      if (!silent) {
        burst(s.x, s.y - 26, ["#ffd84d", "#8be9a0", "#7fd1ff", "#ffffff"], 14);
        setTimeout(() => {
          if (s.state === "idle") s.progress = 0;
        }, 1800);
      }
      break;
    case "error":
      s.state = "error";
      s.task = text;
      s.err += 1;
      break;
    case "handoff":
      s.task = text || s.task;
      if (!silent) startWalk(e.who, e.to, e.item);
      break;
    default:
      return;
  }
  if (!silent && e.kind !== "online" && e.kind !== "offline" && e.kind !== "progress" && text) {
    s.bubble = text;
    s.bubbleUntil = now + (e.kind === "wait" ? 60_000 : e.kind === "say" ? 3500 : 2800);
  }
  if (e.kind === "online" || e.kind === "offline") {
    s.bubble = "";
    s.bubbleUntil = 0;
  }
  if (!silent && (e.kind === "wait" || e.kind === "error")) s.bubbleUntil = now + (e.kind === "wait" ? 60_000 : 5000);
  // Mode contoh: izin datang lewat kejadian "wait". Mode asli: daftar izin dari server (applyApprovals) yang menentukan.
  if (mode === "sim" && (e.kind === "done" || e.kind === "online")) approvals = approvals.filter((a) => a.who !== e.who);
  if (e.kind !== "progress" || newText) {
    feed.unshift({ at: now, who: e.who, kind: e.kind, text: text || STATE_LABEL[s.state] || "" });
    if (feed.length > 80) feed.length = 80;
  }
  if (activeScreen && !opts.batch) {
    renderFeed();
    renderRoster();
    renderApprovals();
    renderSummary();
  }
}

// ---------------------------------------------------------------- tampilan HTML
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const hhmmss = (ms) => new Date(ms).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).replace(/\./g, ":");

function buildDom() {
  rootEl = document.getElementById("office-body");
  rootEl.innerHTML = `
    <div class="office-wrap">
      <div class="office-sim-note" id="office-sim-note" data-mode="live">
        <span class="office-sim-dot"></span><span class="office-note-text" id="office-note-text"></span>
        <button type="button" class="office-note-btn" id="office-note-action" hidden></button>
        <button type="button" class="office-note-btn" id="office-mode-btn"></button>
      </div>
      <div class="office-stick">
      <div class="office-scene" id="office-scene">
        <canvas id="office-canvas" width="${W}" height="${H}" aria-label="Kantor dengan karyawan AI" role="img"></canvas>
        <div class="office-zone" style="left:${(12 / W) * 100}%;top:${(54 / H) * 100}%">WhatsApp</div>
        <div class="office-zone" style="left:${(180 / W) * 100}%;top:${(54 / H) * 100}%">Laptop kantor</div>
        <div class="office-zone" style="left:${(12 / W) * 100}%;top:${(126 / H) * 100}%">Studio media</div>
        <div id="office-overlay"></div>
      </div>
      </div>
      <div class="office-summary" id="office-summary"></div>
      <div id="office-approvals"></div>
      <h2 class="office-h">Karyawan</h2>
      <div class="office-roster" id="office-roster"></div>
      <div class="office-feed-head"><h2 class="office-h">Kejadian langsung</h2><button type="button" class="office-filter" id="office-filter" hidden></button></div>
      <ol class="office-feed" id="office-feed" aria-live="polite"></ol>
    </div>`;
  els = {
    scene: document.getElementById("office-scene"),
    overlay: document.getElementById("office-overlay"),
    summary: document.getElementById("office-summary"),
    approvals: document.getElementById("office-approvals"),
    roster: document.getElementById("office-roster"),
    feed: document.getElementById("office-feed"),
    filter: document.getElementById("office-filter"),
    note: document.getElementById("office-sim-note"),
    noteText: document.getElementById("office-note-text"),
    noteAction: document.getElementById("office-note-action"),
    modeBtn: document.getElementById("office-mode-btn")
  };
  els.modeBtn.addEventListener("click", () => setMode(mode === "live" ? "sim" : "live"));
  els.noteAction.addEventListener("click", () => {
    if (liveStatus === "needcode") hooks.askCode();
    else startSource();
  });
  canvas = document.getElementById("office-canvas");
  ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  // label dan gelembung per karyawan
  for (const s of staff.values()) {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "office-tag";
    tag.dataset.id = s.id;
    tag.style.left = `${(s.x / W) * 100}%`;
    tag.style.top = `${((s.y + 17) / H) * 100}%`;
    tag.innerHTML = `<span class="office-tag-name">${esc(s.name)}</span><span class="office-tag-bar"><i></i></span>`;
    tag.addEventListener("click", () => toggleFilter(s.id));
    els.overlay.appendChild(tag);
    const bub = document.createElement("div");
    bub.className = "office-bubble";
    bub.dataset.id = s.id;
    bub.hidden = true;
    els.overlay.appendChild(bub);
  }
  els.filter.addEventListener("click", () => toggleFilter(""));
  els.roster.addEventListener("click", (e) => {
    const card = e.target.closest(".office-card");
    if (card) toggleFilter(card.dataset.id);
  });
  els.approvals.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    const ok = b.dataset.act === "ok";
    const a = approvals.find((x) => x.id === id);
    approvals = approvals.filter((x) => x.id !== id);
    if (mode === "live") {
      // server mencatat kejadian "Kamu mengizinkan/menolak ..." sendiri; muncul di umpan pada polling berikutnya
      live?.decide(id, ok).then((r) => {
        if (r === "error") {
          liveMsg = "Jawaban izin gagal terkirim, coba lagi.";
          renderNote();
        }
      });
    } else {
      sim?.decide(id, ok);
      if (a) {
        feed.unshift({ at: Date.now(), who: a.who, kind: ok ? "done" : "error", text: ok ? `Pemilik mengizinkan: ${a.detail}` : `Pemilik menolak: ${a.detail}` });
      }
    }
    renderApprovals();
    renderFeed();
  });
  built = true;
}

function toggleFilter(id) {
  filterId = filterId === id ? "" : id;
  renderFeed();
  renderRoster();
}

function renderSummary() {
  if (!els.summary) return;
  const all = [...staff.values()];
  const active = all.filter((s) => s.state === "work" || s.state === "think" || s.walk).length;
  const waiting = all.filter((s) => s.state === "wait").length;
  const errs = all.filter((s) => s.state === "error").length;
  const done = all.reduce((n, s) => n + s.done, 0);
  const sleeping = all.filter((s) => s.state === "offline").length;
  const chip = (cls, n, label) => `<div class="office-chip ${cls}"><b>${n}</b><span>${label}</span></div>`;
  els.summary.innerHTML = chip("", active, "bekerja") + chip(waiting ? "warn" : "", waiting, "menunggu izin") + chip(errs ? "bad" : "", errs, "galat") + chip("", sleeping, "tidur") + chip("", done, "tugas selesai");
}

let rosterHtml = "";
function renderRoster() {
  if (!els.roster) return;
  const html = [...staff.values()]
    .map((s) => {
      const st = s.walk ? "walk" : s.state;
      return `<button type="button" class="office-card ${filterId === s.id ? "sel" : ""}" data-id="${s.id}" data-state="${st}">
        <canvas class="office-face" width="16" height="16" data-face="${s.id}"></canvas>
        <span class="office-card-main"><span class="office-card-name">${esc(s.name)}</span><span class="office-card-role">${esc(s.role)}</span>
        <span class="office-card-task">${esc(s.task)}</span></span>
        <span class="office-state" data-state="${st}">${STATE_LABEL[st] || st}</span>
      </button>`;
    })
    .join("");
  if (html === rosterHtml) return;
  rosterHtml = html;
  els.roster.innerHTML = html;
  for (const cv of els.roster.querySelectorAll("canvas[data-face]")) {
    const s = staff.get(cv.dataset.face);
    const c = cv.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 16, 16);
    px(c, 0, 0, 16, 16, "rgba(128,128,128,0.18)");
    drawHead(c, { ...s, state: s.state === "error" ? "idle" : s.state }, 4, 5, 0, false);
  }
}

function renderFeed() {
  if (!els.feed) return;
  const rows = feed.filter((e) => !filterId || e.who === filterId).slice(0, 40);
  els.feed.innerHTML = rows.length
    ? rows
        .map((e) => `<li class="office-ev k-${e.kind}"><time>${hhmmss(e.at)}</time><span class="office-ev-ico">${KIND_ICON[e.kind] || "•"}</span><span class="office-ev-text"><b>${esc(staff.get(e.who)?.name || e.who)}</b> ${esc(e.text)}</span></li>`)
        .join("")
    : `<li class="office-ev empty">Belum ada kejadian.</li>`;
  if (filterId) {
    els.filter.hidden = false;
    els.filter.textContent = `Hanya ${staff.get(filterId)?.name} ✕`;
  } else {
    els.filter.hidden = true;
  }
}

function renderApprovals() {
  if (!els.approvals) return;
  els.approvals.innerHTML = approvals
    .map(
      (a) => `<div class="office-approval" role="alert">
        <div class="office-approval-text"><b>${esc(staff.get(a.who)?.name || a.who)} minta izin</b><span>${esc(a.detail)}</span></div>
        <div class="office-approval-btns"><button type="button" class="office-btn-ok" data-act="ok" data-id="${esc(a.id)}">Izinkan</button><button type="button" class="office-btn-no" data-act="no" data-id="${esc(a.id)}">Tolak</button></div>
      </div>`
    )
    .join("");
}

function updateOverlay() {
  const now = Date.now();
  for (const s of staff.values()) {
    const tag = els.overlay.querySelector(`.office-tag[data-id="${s.id}"]`);
    const bub = els.overlay.querySelector(`.office-bubble[data-id="${s.id}"]`);
    if (tag) {
      tag.dataset.state = s.walk ? "walk" : s.state;
      const bar = tag.querySelector(".office-tag-bar i");
      const show = s.state === "work" || (s.state === "idle" && s.progress >= 100);
      tag.querySelector(".office-tag-bar").style.opacity = show ? "1" : "0";
      bar.style.width = `${Math.max(0, Math.min(100, s.progress))}%`;
    }
    if (bub) {
      const on = s.bubble && now < s.bubbleUntil;
      bub.hidden = !on;
      if (on) {
        if (bub.textContent !== s.bubble) bub.textContent = s.bubble;
        const px0 = s.walk ? s.walk.x : s.x;
        const py0 = s.walk ? s.walk.y - 36 : s.y - 30;
        const sw = els.scene.clientWidth || 1;
        const half = (bub.offsetWidth || 0) / 2 + 4;
        const leftPx = Math.max(half, Math.min(sw - half, (px0 / W) * sw));
        bub.style.left = `${leftPx}px`;
        bub.style.top = `${(py0 / H) * 100}%`;
        bub.dataset.kind = s.state;
      }
    }
  }
}

// ---------------------------------------------------------------- putaran gambar
function loop(ts) {
  if (!activeScreen) return;
  timer = requestAnimationFrame(loop);
  if (document.hidden) return;
  if (ts - lastFrame < FRAME_MS) return;
  const dt = Math.min(0.3, (ts - lastFrame) / 1000);
  lastFrame = ts;
  frame += 1;
  stepWalks(dt);
  drawScene(frame);
  updateOverlay();
  if (frame % 10 === 0) {
    settleStale();
    renderRoster();
  }
}

// ---------------------------------------------------------------- sumber data: asli vs contoh
function resetState() {
  makeStaff();
  feed.length = 0;
  fx.length = 0;
  approvals = [];
  presenceSeen = false;
  rosterHtml = "";
}

function renderAll() {
  renderSummary();
  renderRoster();
  renderFeed();
  renderApprovals();
}

function liveEvents(list, { replay }) {
  const t = Date.now();
  for (const ev of list) {
    const silent = replay || t - ev.at > SILENT_AGE_MS;
    pushOfficeEvent({ who: ev.who, kind: ev.kind, text: ev.text, progress: ev.progress ?? undefined, to: ev.to ?? undefined, item: ev.item ?? undefined }, { silent, at: ev.at, batch: true });
  }
  settleStale();
  if (activeScreen) renderAll();
}

function applyPresence(list) {
  const by = new Map(list.map((p) => [p.who, p]));
  const t = Date.now();
  for (const s of staff.values()) {
    const p = by.get(s.id);
    if (p?.online) {
      if (s.state === "offline") {
        s.state = "idle";
        s.task = p.detail || "Masuk kerja";
        s.progress = 0;
        if (presenceSeen) feed.unshift({ at: t, who: s.id, kind: "online", text: "Masuk kerja" });
      }
    } else if (s.state !== "offline") {
      s.state = "offline";
      s.task = p ? "Tidak aktif" : "Belum aktif";
      s.progress = 0;
      s.walk = null;
      s.bubble = "";
      if (presenceSeen) feed.unshift({ at: t, who: s.id, kind: "offline", text: "Tidak aktif" });
    }
  }
  presenceSeen = true;
  if (feed.length > 80) feed.length = 80;
  if (activeScreen) renderAll();
}

function applyApprovals(list) {
  if (mode !== "live") return;
  approvals = list.map((a) => ({ id: a.id, who: a.who, detail: a.detail, at: a.at }));
  for (const s of staff.values()) {
    if (s.state === "wait" && !approvals.some((a) => a.who === s.id)) {
      s.state = "idle";
      s.task = "Siaga";
      s.bubble = "";
    }
    if (s.state !== "wait" && s.state !== "offline" && approvals.some((a) => a.who === s.id) && !s.walk) {
      s.state = "wait";
      s.task = "Menunggu izinmu";
    }
  }
  if (activeScreen) {
    renderApprovals();
    renderSummary();
    renderRoster();
  }
}

/** Kerja/berpikir yang sudah lama tanpa kabar dianggap selesai (bot mati di tengah jalan); galat lama dilupakan. */
function settleStale() {
  if (mode !== "live") return;
  const t = Date.now();
  let changed = false;
  for (const s of staff.values()) {
    if (s.walk || !s.lastAt) continue;
    const age = t - s.lastAt;
    if ((s.state === "work" || s.state === "think") && age > STALE_WORK_MS) {
      s.state = "idle";
      s.task = "Siaga";
      s.progress = 0;
      changed = true;
    } else if (s.state === "error" && age > STALE_ERROR_MS) {
      s.state = "idle";
      s.task = "Siaga";
      changed = true;
    }
  }
  if (changed && activeScreen) {
    renderSummary();
    renderRoster();
  }
}

function renderNote() {
  if (!els.note) return;
  const sim_ = mode === "sim";
  els.note.dataset.mode = sim_ ? "sim" : liveStatus;
  let text = "";
  let action = "";
  if (sim_) {
    text = "Mode contoh: kejadiannya hanya simulasi, bukan dari bot sungguhan.";
  } else if (liveStatus === "needcode") {
    text = liveMsg || "Masukkan kode akses untuk melihat data asli.";
    action = "Masukkan kode";
  } else if (liveStatus === "error") {
    text = `Belum bisa terhubung (${String(liveMsg || "periksa jaringan").replace(/[.\s]+$/, "")}). Mencoba lagi…`;
    action = "Coba lagi";
  } else if (liveStatus === "connecting") {
    text = "Menyambung ke bot…";
  } else {
    text = liveMsg || "Data asli dari bot, diperbarui otomatis.";
  }
  els.noteText.textContent = text;
  els.noteAction.hidden = !action;
  els.noteAction.textContent = action;
  els.modeBtn.textContent = sim_ ? "Data asli" : "Contoh";
  els.modeBtn.title = sim_ ? "Kembali ke data asli dari bot" : "Lihat simulasi contoh";
  const pb = document.getElementById("office-pause-btn");
  if (pb) pb.hidden = !sim_;
}

function ensureLive() {
  if (live) return live;
  live = createOfficeLive({
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    getCode: () => hooks.getCode(),
    onEvents: liveEvents,
    onPresence: applyPresence,
    onApprovals: applyApprovals,
    onStatus: (st, msg) => {
      liveStatus = st;
      liveMsg = st === "live" ? "" : msg || "";
      renderNote();
    }
  });
  return live;
}

/** Mulai sumber data sesuai mode (selalu dari keadaan bersih). */
function startSource() {
  live?.stop();
  if (sim) {
    sim.stop();
    sim = null;
  }
  resetState();
  if (activeScreen) renderAll();
  if (mode === "sim") {
    sim = createOfficeSim({ emit: pushOfficeEvent });
    sim.start();
    const pb = document.getElementById("office-pause-btn");
    if (pb) pb.textContent = "Jeda";
  } else {
    liveStatus = "connecting";
    liveMsg = "";
    renderNote();
    ensureLive().start();
  }
  renderNote();
}

function setMode(m) {
  if (m === mode) return;
  mode = m;
  saveMode(m);
  startSource();
}

/** Dipanggil main.js setelah kode akses dimasukkan/diganti: coba sambung lagi bila halaman Kantor terbuka. */
export function officeCodeChanged() {
  if (activeScreen && mode === "live") startSource();
}

// ---------------------------------------------------------------- publik
/** hooks: { getCode: () => string, askCode: () => void } (kode akses obrolan dipakai bersama fitur lain). */
export function initOffice(h = {}) {
  hooks = { ...hooks, ...h };
  makeStaff();
  const screen = document.getElementById("screen-office");
  if (!screen) return;
  document.getElementById("office-back-btn")?.addEventListener("click", () => {
    location.hash = "";
  });
  const pauseBtn = document.getElementById("office-pause-btn");
  pauseBtn?.addEventListener("click", () => {
    if (!sim) return;
    if (sim.isPaused()) {
      sim.resume();
      pauseBtn.textContent = "Jeda";
    } else {
      sim.pause();
      pauseBtn.textContent = "Lanjut";
    }
  });
}

/** Adegan menempel di bawah header saat daftar di bawahnya digulir: ukur tinggi header yang menempel di atas. */
function syncStickyTop() {
  const bar = document.querySelector("#screen-office .topbar");
  if (!bar || !rootEl) return;
  const h = Math.round(bar.getBoundingClientRect().height);
  if (h > 0) rootEl.style.setProperty("--office-top", `${h}px`);
}

export function showOfficeScreen() {
  const screen = document.getElementById("screen-office");
  if (!screen) return;
  screen.hidden = false;
  window.scrollTo(0, 0);
  if (!built) {
    buildDom();
    window.addEventListener("resize", syncStickyTop);
  }
  syncStickyTop();
  activeScreen = true;
  startSource();
  renderAll();
  lastFrame = 0;
  cancelAnimationFrame(timer);
  timer = requestAnimationFrame(loop);
}

export function hideOfficeScreen() {
  const screen = document.getElementById("screen-office");
  if (screen) screen.hidden = true;
  activeScreen = false;
  cancelAnimationFrame(timer);
  timer = null;
  live?.stop();
  sim?.stop();
  sim = null;
}

/** Untuk uji: kendali sim dan keadaan dari luar. */
export function __officeDebug() {
  return { staff, feed, sim, live, get mode() { return mode; }, get approvals() { return approvals; }, settleStale, applyPresence, applyApprovals, liveEvents };
}
