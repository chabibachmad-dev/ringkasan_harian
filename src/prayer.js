// Jadwal shalat -- dihitung LOKAL di perangkat (tanpa API, jadi tetap jalan
// offline). Algoritma posisi matahari mengikuti PrayTimes.org (Hamid
// Zarrabi-Zadeh), dengan parameter Kemenag RI:
//   Subuh -20 derajat, Isya -18 derajat, Imsak = Subuh - 10 menit,
//   terbit/terbenam -0,833 derajat, Ashar faktor bayangan 1 (Syafi'i),
//   ihtiyat +2 menit (Terbit -2 menit).
// Catatan: ini hitungan astronomi, bisa selisih ~1-2 menit dari tabel resmi
// Kemenag untuk kota tertentu (mereka memakai koordinat & ketinggian
// ibukota kabupaten/kota).

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const sin = (d) => Math.sin(d * D2R);
const cos = (d) => Math.cos(d * D2R);
const tan = (d) => Math.tan(d * D2R);
const asin = (x) => Math.asin(x) * R2D;
const acos = (x) => Math.acos(x) * R2D;
const atan2 = (y, x) => Math.atan2(y, x) * R2D;
const arccot = (x) => Math.atan(1 / x) * R2D;
const fix = (a, b) => {
  a -= b * Math.floor(a / b);
  return a < 0 ? a + b : a;
};
const fixAngle = (a) => fix(a, 360);
const fixHour = (a) => fix(a, 24);

export const KEMENAG = {
  fajr: 20,
  isha: 18,
  imsakMin: 10,
  riseSetAngle: 0.833,
  asrFactor: 1,
  ihtiyatMin: 2,
  terbitMin: -2
};

export const KAABA = { lat: 21.422487, lng: 39.826206 };

// Fallback bila izin lokasi ditolak / GPS gagal.
export const DEFAULT_LOCATION = {
  lat: -7.7956,
  lng: 110.3695,
  name: "Yogyakarta",
  fallback: true
};

function julian(y, m, d) {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * sin(g) + 0.02 * sin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = fixHour(atan2(cos(e) * sin(L), cos(L)) / 15);
  return { decl: asin(sin(e) * sin(L)), eqt: q / 15 - RA };
}

// Hitung waktu (jam desimal waktu lokal zona `tz`) untuk satu tanggal.
function computeHours(y, m, d, lat, lng, tz, p) {
  const jd0 = julian(y, m, d) - lng / (15 * 24);
  const midDay = (t) => fixHour(12 - sunPosition(jd0 + t).eqt);
  const angleTime = (angle, t, ccw) => {
    const decl = sunPosition(jd0 + t).decl;
    const v = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
    if (v < -1 || v > 1) return NaN; // matahari tidak pernah mencapai sudut itu
    return midDay(t) + (acos(v) / 15) * (ccw ? -1 : 1);
  };
  const asrTime = (factor, t) => {
    const decl = sunPosition(jd0 + t).decl;
    const angle = -arccot(factor + tan(Math.abs(lat - decl)));
    return angleTime(angle, t, false);
  };

  // Iterasi kasar (t = fraksi hari) seperti PrayTimes: tebakan awal lalu hitung ulang.
  let T = { imsak: 5, fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
  for (let i = 0; i < 2; i++) {
    const t = (k) => T[k] / 24;
    T = {
      fajr: angleTime(p.fajr, t("fajr"), true),
      sunrise: angleTime(p.riseSetAngle, t("sunrise"), true),
      dhuhr: midDay(t("dhuhr")),
      asr: asrTime(p.asrFactor, t("asr")),
      sunset: angleTime(p.riseSetAngle, t("sunset"), false),
      isha: angleTime(p.isha, t("isha"), false)
    };
  }
  const shift = tz - lng / 15;
  const out = {};
  for (const k of Object.keys(T)) out[k] = T[k] + shift;
  out.imsak = out.fajr - p.imsakMin / 60;
  return out;
}

// Offset zona waktu perangkat (jam) pada tanggal tertentu.
function deviceTz(y, m, d) {
  return -new Date(y, m - 1, d, 12).getTimezoneOffset() / 60;
}

// Hasil: objek Date untuk tiap waktu (null bila tidak terdefinisi, mis. lintang tinggi).
// `date` = Date yang menentukan hari kalender (zona waktu perangkat).
export function getPrayerTimes(date, lat, lng, opts = {}) {
  const p = { ...KEMENAG, ...opts };
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const tz = opts.tz ?? deviceTz(y, m, d);
  const h = computeHours(y, m, d, lat, lng, tz, p);
  const base = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const toDate = (hours, addMin = 0) => {
    if (!Number.isFinite(hours)) return null;
    // Hitung dari tengah malam LOKAL + jam desimal. Selisih DST pada hari
    // yang sama diabaikan (Indonesia tidak pakai DST).
    return new Date(base + Math.round((hours * 60 + addMin) * 60000));
  };
  const ih = p.ihtiyatMin;
  return {
    imsak: toDate(h.imsak, ih),
    subuh: toDate(h.fajr, ih),
    terbit: toDate(h.sunrise, p.terbitMin),
    dzuhur: toDate(h.dhuhr, ih),
    ashar: toDate(h.asr, ih),
    maghrib: toDate(h.sunset, ih),
    isya: toDate(h.isha, ih)
  };
}

export const PRAYER_ORDER = ["imsak", "subuh", "terbit", "dzuhur", "ashar", "maghrib", "isya"];
// Lima waktu wajib -- dipakai untuk "shalat berikutnya".
export const FARDH = ["subuh", "dzuhur", "ashar", "maghrib", "isya"];

// Shalat berikutnya dari `now`: { key, at, tomorrow }. Setelah Isya -> Subuh besok.
export function getNextPrayer(now, lat, lng) {
  const today = getPrayerTimes(now, lat, lng);
  for (const key of FARDH) {
    const at = today[key];
    if (at && at.getTime() > now.getTime()) return { key, at, tomorrow: false };
  }
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  const next = getPrayerTimes(tmr, lat, lng);
  return { key: "subuh", at: next.subuh, tomorrow: true };
}

// Shalat yang sedang berlangsung (terakhir yang sudah masuk), atau null sebelum Subuh.
export function getCurrentPrayer(now, lat, lng) {
  const today = getPrayerTimes(now, lat, lng);
  let cur = null;
  for (const key of FARDH) {
    const at = today[key];
    if (at && at.getTime() <= now.getTime()) cur = key;
  }
  return cur;
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatClock(date) {
  if (!date) return "--:--";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Label zona waktu Indonesia dari offset perangkat; selain itu "GMT+x".
export function tzLabel(date) {
  const off = -date.getTimezoneOffset() / 60;
  if (off === 7) return "WIB";
  if (off === 8) return "WITA";
  if (off === 9) return "WIT";
  const sign = off >= 0 ? "+" : "-";
  return `GMT${sign}${Math.abs(off)}`;
}

// ---------------------------------------------------------------- Kiblat

// Arah kiblat (derajat dari utara sejati, searah jarum jam), lingkaran besar.
export function qiblaBearing(lat, lng) {
  const dL = (KAABA.lng - lng) * D2R;
  const p1 = lat * D2R;
  const p2 = KAABA.lat * D2R;
  const y = Math.sin(dL);
  const x = Math.cos(p1) * Math.tan(p2) - Math.sin(p1) * Math.cos(dL);
  return fixAngle(Math.atan2(y, x) * R2D);
}

export function cardinal(deg) {
  const dirs = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"]; // Utara, Timur Laut, Timur, Tenggara, Selatan, Barat Daya, Barat, Barat Laut
  return dirs[Math.round(fixAngle(deg) / 45) % 8];
}

// ---------------------------------------------------------------- Hijriah

const HIJRI_MONTHS = [
  "Muharram",
  "Safar",
  "Rabiul Awal",
  "Rabiul Akhir",
  "Jumadil Awal",
  "Jumadil Akhir",
  "Rajab",
  "Sya'ban",
  "Ramadhan",
  "Syawal",
  "Dzulqa'dah",
  "Dzulhijjah"
];

// Tanggal Hijriah (kalender Umm al-Qura bawaan Intl). Bisa selisih 1 hari dari
// penetapan pemerintah RI. `afterMaghrib` = true menambah 1 hari (hari Hijriah
// berganti saat Maghrib).
export function hijriDate(date, afterMaghrib = false) {
  try {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (afterMaghrib ? 1 : 0), 12);
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      day: "numeric",
      month: "numeric",
      year: "numeric"
    }).formatToParts(d);
    const get = (t) => Number(parts.find((x) => x.type === t)?.value);
    const day = get("day");
    const month = get("month");
    const year = get("year");
    if (!day || !month || !year) return null;
    return { day, month, year, monthName: HIJRI_MONTHS[month - 1], text: `${day} ${HIJRI_MONTHS[month - 1]} ${year} H` };
  } catch (_err) {
    return null;
  }
}

// ---------------------------------------------------------------- Lokasi

const LOC_KEY = "rh_prayer_loc";

export function loadSavedLocation() {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (Number.isFinite(o.lat) && Number.isFinite(o.lng)) return o;
  } catch (_err) {
    /* noop */
  }
  return null;
}

export function saveLocation(loc) {
  try {
    localStorage.setItem(LOC_KEY, JSON.stringify(loc));
  } catch (_err) {
    /* noop */
  }
}

// Minta posisi GPS. Resolve { lat, lng, accuracy } atau reject Error(code).
export function getGpsPosition(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
      (err) => reject(new Error(err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable")),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

// Nama kota dari koordinat (BigDataCloud, tanpa API key). Gagal -> "".
export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=id`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return "";
    const j = await res.json();
    const city = j.city || j.locality || "";
    const region = j.principalSubdivision || "";
    return [city, region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  } catch (_err) {
    return "";
  }
}

// GPS + nama kota, disimpan. Lempar error GPS ke pemanggil (untuk pesan UI).
export async function detectLocation() {
  const pos = await getGpsPosition();
  const name = (await reverseGeocode(pos.lat, pos.lng)) || `${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)}`;
  const loc = { lat: pos.lat, lng: pos.lng, name, savedAt: Date.now() };
  saveLocation(loc);
  return loc;
}
