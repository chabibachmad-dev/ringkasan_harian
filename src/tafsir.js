// ================================================================
// Terjemahan & tafsir satu ayat (Bahasa Indonesia).
//
// Sumber utama: API publik alquran.cloud (sama dengan teks Qur'an di app ini).
// Daftar edisi (terjemahan/tafsir berbahasa Indonesia) DICARI OTOMATIS lewat
// /edition?language=id, jadi tidak bergantung pada pengenal edisi yang di-hardcode.
// Cadangan untuk tafsir: API quran.com v4 (sumber tafsir berbahasa Indonesia
// juga dicari otomatis lewat /resources/tafsirs).
//
// Hasil per ayat disimpan di localStorage (maks. MAX_CACHED ayat terakhir)
// supaya ayat yang pernah dibuka bisa dibaca lagi tanpa internet.
// ================================================================

const AC = "https://api.alquran.cloud/v1";
const QC = "https://api.quran.com/api/v4";
const LS_EDITIONS = "rh_quran_editions_v1";
const LS_QC_TAFSIRS = "rh_quran_qc_tafsirs_v1";
const LS_AYAH_PREFIX = "rh_tafsir_v1:";
const LS_AYAH_INDEX = "rh_tafsir_v1_index";
const META_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_CACHED = 80;
const KNOWN_TAFSIR_IDS = ["id.muntakhab", "id.jalalayn"];

const mem = new Map();
let editionsPromise = null;

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_e) {
    return null;
  }
}
function lsSet(key, val) {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch (_e) {
    return false;
  }
}
function lsDel(key) {
  try {
    localStorage.removeItem(key);
  } catch (_e) {
    // abaikan
  }
}

async function fetchRaw(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

// alquran.cloud membungkus hasil dalam { code, status, data }.
async function fetchAlquran(path) {
  const j = await fetchRaw(`${AC}${path}`);
  if (j && j.code && j.code !== 200) throw new Error(j.status || `API ${j.code}`);
  return j.data;
}

// HTML (mis. tafsir dari quran.com) -> teks polos aman. Tidak pernah memasang
// HTML mentah ke halaman; hanya textContent.
export function htmlToText(html) {
  const withBreaks = String(html ?? "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote)>/gi, "\n\n");
  let text;
  if (typeof DOMParser !== "undefined") {
    text = new DOMParser().parseFromString(withBreaks, "text/html").body.textContent || "";
  } else {
    text = withBreaks.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
  }
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Pilih edisi dari daftar alquran.cloud (sudah difilter bahasa Indonesia atau belum).
// -> { translation: "id.indonesian" | null, tafsirs: ["id...."] }
export function pickEditions(list) {
  const ids = (Array.isArray(list) ? list : []).filter((e) => e && e.identifier && (!e.language || e.language === "id"));
  const byId = new Map(ids.map((e) => [e.identifier, e]));
  let translation = null;
  if (byId.has("id.indonesian")) translation = "id.indonesian";
  else {
    const t = ids.find((e) => e.type === "translation");
    translation = t ? t.identifier : null;
  }
  const tafsirs = ids
    .filter((e) => e.identifier !== translation && (e.type === "tafsir" || KNOWN_TAFSIR_IDS.includes(e.identifier)))
    .map((e) => e.identifier)
    .slice(0, 2);
  return { translation, tafsirs };
}

async function loadEditions() {
  try {
    const raw = lsGet(LS_EDITIONS);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.at && Date.now() - c.at < META_TTL_MS && c.value) return c.value;
    }
  } catch (_e) {
    // cache rusak -> abaikan
  }
  if (editionsPromise) return editionsPromise;
  editionsPromise = (async () => {
    try {
      const list = await fetchAlquran("/edition?language=id");
      const value = pickEditions(list);
      if (!value.translation) value.translation = "id.indonesian";
      lsSet(LS_EDITIONS, JSON.stringify({ at: Date.now(), value }));
      return value;
    } catch (_e) {
      // Gagal (offline?): jangan di-cache; pakai tebakan terbaik untuk terjemahan.
      return { translation: "id.indonesian", tafsirs: [] };
    } finally {
      editionsPromise = null;
    }
  })();
  return editionsPromise;
}

// Cadangan: tafsir berbahasa Indonesia dari quran.com.
async function fetchQuranComTafsir(key) {
  let list = null;
  try {
    const raw = lsGet(LS_QC_TAFSIRS);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.at && Date.now() - c.at < META_TTL_MS && Array.isArray(c.value)) list = c.value;
    }
  } catch (_e) {
    list = null;
  }
  if (!list) {
    const j = await fetchRaw(`${QC}/resources/tafsirs`);
    list = (j.tafsirs || [])
      .filter((x) => String(x.language_name || "").toLowerCase() === "indonesian")
      .map((x) => ({ id: x.id, name: x.translated_name?.name || x.name || x.author_name || "Tafsir" }));
    if (list.length) lsSet(LS_QC_TAFSIRS, JSON.stringify({ at: Date.now(), value: list }));
  }
  if (!list.length) return null;
  const pick = list.find((x) => /kemenag|ringkas|kementerian/i.test(x.name)) || list[0];
  const j = await fetchRaw(`${QC}/tafsirs/${pick.id}/by_ayah/${key}`);
  const text = htmlToText(j?.tafsir?.text);
  if (!text) return null;
  return { name: j.tafsir.resource_name || pick.name, text };
}

function readAyahCache(key) {
  if (mem.has(key)) return mem.get(key);
  const raw = lsGet(LS_AYAH_PREFIX + key);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && (v.translation || (v.tafsirs && v.tafsirs.length))) {
      mem.set(key, v);
      return v;
    }
  } catch (_e) {
    // abaikan
  }
  return null;
}

function writeAyahCache(key, value) {
  mem.set(key, value);
  if (!lsSet(LS_AYAH_PREFIX + key, JSON.stringify(value))) return;
  let idx = [];
  try {
    idx = JSON.parse(lsGet(LS_AYAH_INDEX) || "[]");
  } catch (_e) {
    idx = [];
  }
  idx = idx.filter((k) => k !== key);
  idx.push(key);
  while (idx.length > MAX_CACHED) lsDel(LS_AYAH_PREFIX + idx.shift());
  lsSet(LS_AYAH_INDEX, JSON.stringify(idx));
}

// -> { translation: {name, text} | null, tafsirs: [{name, text}] }
// Melempar Error bila sama sekali tidak ada data (mis. offline & belum ada cache).
export async function getAyahInfo(surah, ayah) {
  const key = `${surah}:${ayah}`;
  const cached = readAyahCache(key);
  if (cached) return cached;

  const ed = await loadEditions();
  const wanted = [ed.translation, ...ed.tafsirs].filter(Boolean);
  let translation = null;
  const tafsirs = [];
  let netError = null;

  try {
    const data = await fetchAlquran(`/ayah/${key}/editions/${wanted.join(",")}`);
    const items = Array.isArray(data) ? data : [data];
    for (const it of items) {
      const id = it?.edition?.identifier;
      const text = htmlToText(it?.text);
      if (!text) continue;
      const name = it.edition?.name || it.edition?.englishName || id;
      if (id === ed.translation) translation = { name, text };
      else tafsirs.push({ name, text });
    }
  } catch (err) {
    netError = err;
  }

  if (tafsirs.length === 0) {
    try {
      const t = await fetchQuranComTafsir(key);
      if (t) tafsirs.push(t);
    } catch (err) {
      netError = netError || err;
    }
  }

  if (!translation && tafsirs.length === 0) throw netError || new Error("Data tidak tersedia");
  const value = { translation, tafsirs };
  // Hanya simpan yang lengkap; kalau sebagian gagal, coba lagi di buka berikutnya.
  if (translation && tafsirs.length > 0) writeAyahCache(key, value);
  return value;
}

export function _resetForTest() {
  mem.clear();
  editionsPromise = null;
}
