// Al-Qur'an (teks Utsmani, per halaman mushaf Madinah -- 604 halaman).
//
// Sumber teks: API publik alquran.cloud (edisi `quran-uthmani`). Halaman yang
// pernah dibuka disimpan di IndexedDB supaya bisa dibaca offline; ada juga
// "Unduh semua" yang mengambil seluruh Al-Qur'an dalam SATU request lalu
// memecahnya per halaman.
//
// "Terakhir dibaca" & bookmark: local-first (localStorage, langsung tampil &
// jalan offline), lalu disinkronkan ke Supabase lewat Edge Function `chat`
// (lihat chat.js & migrations/0014) supaya sama di semua perangkat.

import { quranAddBookmark, quranDeleteBookmark, quranSetLastRead, quranSync } from "./chat.js";

// ---------------------------------------------------------------- Data surah
// [nama latin, nama arab, jumlah ayat, halaman mulai (mushaf Madinah)]
const S = [
  ["Al-Fatihah", "الفاتحة", 7, 1],
  ["Al-Baqarah", "البقرة", 286, 2],
  ["Ali 'Imran", "آل عمران", 200, 50],
  ["An-Nisa'", "النساء", 176, 77],
  ["Al-Ma'idah", "المائدة", 120, 106],
  ["Al-An'am", "الأنعام", 165, 128],
  ["Al-A'raf", "الأعراف", 206, 151],
  ["Al-Anfal", "الأنفال", 75, 177],
  ["At-Taubah", "التوبة", 129, 187],
  ["Yunus", "يونس", 109, 208],
  ["Hud", "هود", 123, 221],
  ["Yusuf", "يوسف", 111, 235],
  ["Ar-Ra'd", "الرعد", 43, 249],
  ["Ibrahim", "إبراهيم", 52, 255],
  ["Al-Hijr", "الحجر", 99, 262],
  ["An-Nahl", "النحل", 128, 267],
  ["Al-Isra'", "الإسراء", 111, 282],
  ["Al-Kahf", "الكهف", 110, 293],
  ["Maryam", "مريم", 98, 305],
  ["Ta Ha", "طه", 135, 312],
  ["Al-Anbiya'", "الأنبياء", 112, 322],
  ["Al-Hajj", "الحج", 78, 332],
  ["Al-Mu'minun", "المؤمنون", 118, 342],
  ["An-Nur", "النور", 64, 350],
  ["Al-Furqan", "الفرقان", 77, 359],
  ["Asy-Syu'ara'", "الشعراء", 227, 367],
  ["An-Naml", "النمل", 93, 377],
  ["Al-Qasas", "القصص", 88, 385],
  ["Al-'Ankabut", "العنكبوت", 69, 396],
  ["Ar-Rum", "الروم", 60, 404],
  ["Luqman", "لقمان", 34, 411],
  ["As-Sajdah", "السجدة", 30, 415],
  ["Al-Ahzab", "الأحزاب", 73, 418],
  ["Saba'", "سبأ", 54, 428],
  ["Fatir", "فاطر", 45, 434],
  ["Ya Sin", "يس", 83, 440],
  ["As-Saffat", "الصافات", 182, 446],
  ["Sad", "ص", 88, 453],
  ["Az-Zumar", "الزمر", 75, 458],
  ["Gafir", "غافر", 85, 467],
  ["Fussilat", "فصلت", 54, 477],
  ["Asy-Syura", "الشورى", 53, 483],
  ["Az-Zukhruf", "الزخرف", 89, 489],
  ["Ad-Dukhan", "الدخان", 59, 496],
  ["Al-Jasiyah", "الجاثية", 37, 499],
  ["Al-Ahqaf", "الأحقاف", 35, 502],
  ["Muhammad", "محمد", 38, 507],
  ["Al-Fath", "الفتح", 29, 511],
  ["Al-Hujurat", "الحجرات", 18, 515],
  ["Qaf", "ق", 45, 518],
  ["Az-Zariyat", "الذاريات", 60, 520],
  ["At-Tur", "الطور", 49, 523],
  ["An-Najm", "النجم", 62, 526],
  ["Al-Qamar", "القمر", 55, 528],
  ["Ar-Rahman", "الرحمن", 78, 531],
  ["Al-Waqi'ah", "الواقعة", 96, 534],
  ["Al-Hadid", "الحديد", 29, 537],
  ["Al-Mujadilah", "المجادلة", 22, 542],
  ["Al-Hasyr", "الحشر", 24, 545],
  ["Al-Mumtahanah", "الممتحنة", 13, 549],
  ["As-Saff", "الصف", 14, 551],
  ["Al-Jumu'ah", "الجمعة", 11, 553],
  ["Al-Munafiqun", "المنافقون", 11, 554],
  ["At-Tagabun", "التغابن", 18, 556],
  ["At-Talaq", "الطلاق", 12, 558],
  ["At-Tahrim", "التحريم", 12, 560],
  ["Al-Mulk", "الملك", 30, 562],
  ["Al-Qalam", "القلم", 52, 564],
  ["Al-Haqqah", "الحاقة", 52, 566],
  ["Al-Ma'arij", "المعارج", 44, 568],
  ["Nuh", "نوح", 28, 570],
  ["Al-Jinn", "الجن", 28, 572],
  ["Al-Muzzammil", "المزمل", 20, 574],
  ["Al-Muddassir", "المدثر", 56, 575],
  ["Al-Qiyamah", "القيامة", 40, 577],
  ["Al-Insan", "الإنسان", 31, 578],
  ["Al-Mursalat", "المرسلات", 50, 580],
  ["An-Naba'", "النبأ", 40, 582],
  ["An-Nazi'at", "النازعات", 46, 583],
  ["'Abasa", "عبس", 42, 585],
  ["At-Takwir", "التكوير", 29, 586],
  ["Al-Infitar", "الانفطار", 19, 587],
  ["Al-Mutaffifin", "المطففين", 36, 587],
  ["Al-Insyiqaq", "الانشقاق", 25, 589],
  ["Al-Buruj", "البروج", 22, 590],
  ["At-Tariq", "الطارق", 17, 591],
  ["Al-A'la", "الأعلى", 19, 591],
  ["Al-Gasyiyah", "الغاشية", 26, 592],
  ["Al-Fajr", "الفجر", 30, 593],
  ["Al-Balad", "البلد", 20, 594],
  ["Asy-Syams", "الشمس", 15, 595],
  ["Al-Lail", "الليل", 21, 595],
  ["Ad-Duha", "الضحى", 11, 596],
  ["Asy-Syarh", "الشرح", 8, 596],
  ["At-Tin", "التين", 8, 597],
  ["Al-'Alaq", "العلق", 19, 597],
  ["Al-Qadr", "القدر", 5, 598],
  ["Al-Bayyinah", "البينة", 8, 598],
  ["Az-Zalzalah", "الزلزلة", 8, 599],
  ["Al-'Adiyat", "العاديات", 11, 599],
  ["Al-Qari'ah", "القارعة", 11, 600],
  ["At-Takasur", "التكاثر", 8, 600],
  ["Al-'Asr", "العصر", 3, 601],
  ["Al-Humazah", "الهمزة", 9, 601],
  ["Al-Fil", "الفيل", 5, 601],
  ["Quraisy", "قريش", 4, 602],
  ["Al-Ma'un", "الماعون", 7, 602],
  ["Al-Kausar", "الكوثر", 3, 602],
  ["Al-Kafirun", "الكافرون", 6, 603],
  ["An-Nasr", "النصر", 3, 603],
  ["Al-Lahab", "المسد", 5, 603],
  ["Al-Ikhlas", "الإخلاص", 4, 604],
  ["Al-Falaq", "الفلق", 5, 604],
  ["An-Nas", "الناس", 6, 604]
];

export const SURAHS = S.map(([name, arabic, ayahs, page], i) => ({ number: i + 1, name, arabic, ayahs, page }));

// Halaman mulai tiap juz (mushaf Madinah: 20 halaman per juz, juz 1 mulai hal. 1).
export const JUZ_START_PAGES = [
  1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502,
  522, 542, 562, 582
];

export const TOTAL_PAGES = 604;
export const TOTAL_AYAHS = 6236;

export function surahInfo(n) {
  return SURAHS[n - 1] || null;
}

export function juzOfPage(page) {
  let juz = 1;
  for (let i = 0; i < JUZ_START_PAGES.length; i++) {
    if (page >= JUZ_START_PAGES[i]) juz = i + 1;
  }
  return juz;
}

export function clampPage(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(TOTAL_PAGES, Math.max(1, v));
}

// ---------------------------------------------------------------- Teks

// Buang tanda baca (harakat) & samakan bentuk alif supaya "بسم الله الرحمن
// الرحيم" bisa dikenali apa pun gaya penulisannya.
export function normalizeArabic(s) {
  return String(s)
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]/g, "")
    .replace(/[ٱآأإ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ی/g, "ي");
}

const BASMALAH_NORM = ["بسم", "الله", "الرحمن", "الرحيم"];

// API menyisipkan basmalah di depan ayat 1 tiap surah (kecuali Al-Fatihah &
// At-Taubah). Di layar basmalah ditampilkan terpisah sebagai bagian kepala
// surah, jadi di teks ayat 1 dibuang. Al-Fatihah ayat 1 memang basmalah -- tidak diubah.
export function stripBasmalah(text, surah, ayah) {
  if (ayah !== 1 || surah === 1 || surah === 9) return text;
  const words = String(text).trim().split(/\s+/);
  if (words.length > 4 && BASMALAH_NORM.every((w, i) => normalizeArabic(words[i]) === w)) {
    return words.slice(4).join(" ");
  }
  return text;
}

export const BASMALAH_TEXT = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export function toArabicDigits(n) {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

// Rapikan satu ayat mentah dari API -> bentuk internal.
function toAyah(raw, surahNumber) {
  const surah = surahNumber ?? raw.surah?.number;
  const ayah = raw.numberInSurah;
  return {
    surah,
    ayah,
    juz: raw.juz,
    hq: raw.hizbQuarter,
    page: raw.page,
    text: stripBasmalah(String(raw.text || "").trim(), surah, ayah)
  };
}

// Label seperempat hizb ala mushaf: hizbQuarter 1..240 -> "Hizb 1", "¼ Hizb 1", "½ Hizb 1", "¾ Hizb 1".
export function hizbLabel(hq) {
  if (!Number.isFinite(hq) || hq < 1 || hq > 240) return "";
  const hizb = Math.ceil(hq / 4);
  const frac = ["", "¼ ", "½ ", "¾ "][(hq - 1) % 4];
  return `${frac}Hizb ${hizb}`;
}

// Kelompokkan ayat sehalaman menurut surah -> blok; blok yang diawali ayat 1
// diberi `header: true` (tampilkan nama surah + basmalah).
export function groupBySurah(ayahs) {
  const blocks = [];
  for (const a of ayahs) {
    let b = blocks[blocks.length - 1];
    if (!b || b.surah !== a.surah) {
      b = { surah: a.surah, header: a.ayah === 1, ayahs: [] };
      blocks.push(b);
    }
    b.ayahs.push(a);
  }
  return blocks;
}

// ---------------------------------------------------------------- Cache halaman (IndexedDB)

const DB_NAME = "rh_quran";
const DB_STORE = "pages";
const memPages = new Map();
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE, { keyPath: "page" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_err) {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet(page) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(page);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_err) {
      resolve(null);
    }
  });
}

async function idbPutMany(records) {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      const store = tx.objectStore(DB_STORE);
      for (const r of records) store.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (_err) {
      resolve();
    }
  });
}

async function idbCount() {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    } catch (_err) {
      resolve(0);
    }
  });
}

export function cachedPageCount() {
  return idbCount();
}

const API = "https://api.alquran.cloud/v1";

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.code && j.code !== 200) throw new Error(j.status || `API ${j.code}`);
    return j.data;
  } finally {
    clearTimeout(to);
  }
}

// Ambil satu halaman: memori -> IndexedDB -> jaringan. Hasil: { page, ayahs: [...] }.
export async function getPage(page) {
  page = clampPage(page);
  if (memPages.has(page)) return memPages.get(page);

  const cached = await idbGet(page);
  const cachedOk = cached && Array.isArray(cached.ayahs) && cached.ayahs.length;
  if (cachedOk && cached.v === 2) {
    memPages.set(page, cached);
    return cached;
  }

  let data;
  try {
    data = await fetchJson(`${API}/page/${page}/quran-uthmani`);
  } catch (err) {
    // Cache versi lama (tanpa info hizb) tetap layak dipakai bila offline.
    if (cachedOk) {
      memPages.set(page, cached);
      return cached;
    }
    throw err;
  }
  const ayahs = (data.ayahs || []).map((r) => toAyah(r));
  if (!ayahs.length) {
    if (cachedOk) return cached;
    throw new Error("Halaman kosong");
  }
  const rec = { page, ayahs, v: 2 };
  memPages.set(page, rec);
  idbPutMany([rec]);
  return rec;
}

// Isi cache halaman tetangga di latar belakang (diam-diam, abaikan error).
export function prefetchPages(pages) {
  for (const p of pages) {
    if (p < 1 || p > TOTAL_PAGES || memPages.has(p)) continue;
    getPage(p).catch(() => {});
  }
}

// Unduh SELURUH Al-Qur'an sekali jalan (satu request ~1-2 MB), pecah per halaman.
export async function downloadAll(onProgress) {
  const data = await fetchJson(`${API}/quran/quran-uthmani`, 90000);
  const byPage = new Map();
  for (const s of data.surahs || []) {
    for (const raw of s.ayahs || []) {
      const a = toAyah(raw, s.number);
      if (!byPage.has(a.page)) byPage.set(a.page, []);
      byPage.get(a.page).push(a);
    }
  }
  const records = [...byPage.entries()].map(([page, ayahs]) => ({ page, ayahs, v: 2 }));
  if (records.length < TOTAL_PAGES) throw new Error(`Data tidak lengkap (${records.length}/${TOTAL_PAGES} halaman)`);
  const CH = 60;
  for (let i = 0; i < records.length; i += CH) {
    const part = records.slice(i, i + CH);
    await idbPutMany(part);
    for (const r of part) memPages.set(r.page, r);
    onProgress?.(Math.min(records.length, i + CH), records.length);
  }
  return records.length;
}

// ---------------------------------------------------------------- Status lokal + sinkron

const STATE_KEY = "rh_quran_state";

function emptyState() {
  return { lastRead: null, lastReadDirty: false, bookmarks: [], pendingDeletes: [] };
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      cache = { ...emptyState(), ...o };
      return cache;
    }
  } catch (_err) {
    /* noop */
  }
  cache = emptyState();
  return cache;
}

function save() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(cache));
  } catch (_err) {
    /* noop */
  }
}

const keyOf = (s, a) => `${s}:${a}`;

export function getLastRead() {
  return load().lastRead;
}

export function listBookmarks() {
  return [...load().bookmarks].sort((a, b) => b.at - a.at);
}

export function isBookmarked(surah, ayah) {
  return load().bookmarks.some((b) => b.surah === surah && b.ayah === ayah);
}

// Tandai posisi terakhir baca (lokal dulu, lalu dorong ke server bila ada kode akses).
export function setLastRead({ surah, ayah, page }, code) {
  const st = load();
  st.lastRead = { surah, ayah, page, at: Date.now() };
  st.lastReadDirty = true;
  save();
  pushLastRead(code);
  return st.lastRead;
}

async function pushLastRead(code) {
  const st = load();
  if (!code || !st.lastReadDirty || !st.lastRead) return;
  const lr = st.lastRead;
  const res = await quranSetLastRead(code, lr);
  if (res.ok && st.lastRead && st.lastRead.at === lr.at) {
    st.lastReadDirty = false;
    save();
  }
}

// Balik status bookmark satu ayat; hasil true = sekarang ter-bookmark.
export function toggleBookmark({ surah, ayah, page }, code) {
  const st = load();
  const idx = st.bookmarks.findIndex((b) => b.surah === surah && b.ayah === ayah);
  if (idx >= 0) {
    st.bookmarks.splice(idx, 1);
    if (!st.pendingDeletes.some((d) => d.surah === surah && d.ayah === ayah)) st.pendingDeletes.push({ surah, ayah });
    save();
    pushDeletes(code);
    return false;
  }
  st.bookmarks.push({ surah, ayah, page, at: Date.now(), synced: false });
  st.pendingDeletes = st.pendingDeletes.filter((d) => !(d.surah === surah && d.ayah === ayah));
  save();
  pushBookmarks(code);
  return true;
}

async function pushDeletes(code) {
  if (!code) return;
  const st = load();
  for (const d of [...st.pendingDeletes]) {
    const res = await quranDeleteBookmark(code, d);
    if (!res.ok) return;
    st.pendingDeletes = st.pendingDeletes.filter((x) => !(x.surah === d.surah && x.ayah === d.ayah));
    save();
  }
}

async function pushBookmarks(code) {
  if (!code) return;
  const st = load();
  for (const b of [...st.bookmarks]) {
    if (b.synced) continue;
    const res = await quranAddBookmark(code, b);
    if (!res.ok) return;
    b.synced = true;
    save();
  }
}

// Gabungkan dengan server. Aturan: bookmark = gabungan lokal + server dikurangi
// yang baru dihapus lokal (pendingDeletes); last-read = yang paling baru menang.
// Mengembalikan { ok, changed }.
export async function syncWithServer(code) {
  if (!code) return { ok: false, changed: false };
  const res = await quranSync(code);
  if (!res.ok) return { ok: false, changed: false, unauthorized: res.unauthorized };

  const st = load();
  let changed = false;

  // 1) Hapus yang tertunda lebih dulu supaya tidak "hidup lagi" dari data server.
  await pushDeletes(code);
  const pend = (s, a) => st.pendingDeletes.some((d) => d.surah === s && d.ayah === a);

  // 2) Bookmark dari server yang belum ada lokal.
  for (const sb of res.bookmarks || []) {
    if (pend(sb.surah, sb.ayah)) continue;
    const local = st.bookmarks.find((b) => b.surah === sb.surah && b.ayah === sb.ayah);
    if (local) {
      local.synced = true;
    } else {
      st.bookmarks.push({
        surah: sb.surah,
        ayah: sb.ayah,
        page: sb.page,
        at: Date.parse(sb.created_at) || Date.now(),
        synced: true
      });
      changed = true;
    }
  }
  // 3) Bookmark yang sudah hilang dari server (dihapus di perangkat lain) dan
  //    sebelumnya sudah tersinkron -> hapus lokal juga.
  const serverKeys = new Set((res.bookmarks || []).map((b) => keyOf(b.surah, b.ayah)));
  const before = st.bookmarks.length;
  st.bookmarks = st.bookmarks.filter((b) => !b.synced || serverKeys.has(keyOf(b.surah, b.ayah)));
  if (st.bookmarks.length !== before) changed = true;
  save();

  // 4) Dorong bookmark yang baru dibuat lokal.
  await pushBookmarks(code);

  // 5) Last read: yang terbaru menang.
  const sl = res.lastRead;
  const serverAt = sl ? Date.parse(sl.updated_at) || 0 : 0;
  const localAt = st.lastRead?.at || 0;
  if (sl && (!st.lastRead || serverAt > localAt)) {
    // Server lebih baru -> pakai punya server (buang perubahan lokal yang lebih lama).
    const differs = !st.lastRead || st.lastRead.surah !== sl.surah || st.lastRead.ayah !== sl.ayah || st.lastRead.page !== sl.page;
    st.lastRead = { surah: sl.surah, ayah: sl.ayah, page: sl.page, at: serverAt };
    st.lastReadDirty = false;
    if (differs) changed = true;
    save();
  } else if (st.lastRead && (st.lastReadDirty || !sl)) {
    st.lastReadDirty = true;
    save();
    await pushLastRead(code);
  }
  return { ok: true, changed };
}

// Dipakai tes: reset status lokal.
export function _resetForTest() {
  cache = null;
}
