// Pengingat ibadah harian untuk pemilik bot: /ibadah, atau "/ingatkan setiap hari jam 7 pagi 12 siang dan jam 6 sore baca al quran. hari ini juz 2".
//
//   Al-Qur'an  : beberapa kali sehari, "Baca Al-Qur'an hari ini: juz N". N naik 1 tiap hari, setelah juz 30 kembali ke juz 1.
//   Hadits     : satu hadits Arbain Nawawi per hari (Arab + arti + takhrij dari data; penjelasan ringkas dari AI, diberi label).
//   Ayat       : satu ayat per hari (Arab + arti + tafsir ringkas Kemenag), urutan acak tetap sehingga semua ayat terbaca sebelum ada yang berulang.
//
// Teks Arab, arti, dan tafsir TIDAK pernah ditulis AI: semuanya dari berkas data di ibadah-data/ (lihat README).
// Pengaturan di SQLite lokal (ibadah.sqlite). Juz dihitung dari tanggal, bukan penghitung yang bisa meleset saat bot mati.
// Bot mati pada jamnya: begitu menyala, pengingat yang terlewat (dalam batas beberapa jam) tetap dikirim dengan keterangan "terlambat".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tzParts } from "./reminders.js";

const DATA_DIR = fileURLToPath(new URL("./ibadah-data/", import.meta.url));
const DAY_MS = 86400_000;
const MAX_MSG = 3500;
export const DEFAULT_QURAN_TIMES = ["07:00", "12:00", "18:00"];
export const DEFAULT_HADITS_TIME = "05:30";
export const DEFAULT_AYAT_TIME = "06:00";
const LATE_LIMIT_MIN = { quran: 240, hadits: 360, ayat: 360 };
const pad2 = (n) => String(n).padStart(2, "0");

// ------------------------------------------------------------ data
let dataCache = null;
export function loadData(dir = DATA_DIR) {
  if (dataCache && dataCache.dir === dir) return dataCache;
  const ay = JSON.parse(fs.readFileSync(path.join(dir, "ayat.json"), "utf8"));
  const hd = JSON.parse(fs.readFileSync(path.join(dir, "hadits-arbain.json"), "utf8"));
  const surah = new Map(ay.surah.map((s) => [s[0], { nama: s[1], arti: s[2] }]));
  dataCache = { dir, ayat: ay.ayat, surah, hadits: hd.hadits, order: null };
  return dataCache;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Urutan acak TETAP (benih tetap) atas semua ayat: hasilnya sama di setiap menyalakan ulang. */
function ayatOrder(data) {
  if (data.order) return data.order;
  const idx = data.ayat.map((_, i) => i);
  const rnd = mulberry32(20261017);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  data.order = idx;
  return idx;
}

// ------------------------------------------------------------ tanggal & juz
export const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
};
export const todayIso = (ms, tz) => {
  const p = tzParts(ms, tz);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
};

/** Juz untuk tanggal `iso` bila pada `startDate` juznya `startJuz`. 30 -> 1 lagi. */
export function juzFor(startJuz, startDate, iso) {
  const diff = dayNumber(iso) - dayNumber(startDate);
  return ((((Number(startJuz) - 1 + diff) % 30) + 30) % 30) + 1;
}

export function pickHadits(data, startDate, iso) {
  const n = data.hadits.length;
  const diff = dayNumber(iso) - dayNumber(startDate);
  return data.hadits[((diff % n) + n) % n];
}

export function pickAyat(data, startDate, iso) {
  const order = ayatOrder(data);
  const diff = dayNumber(iso) - dayNumber(startDate);
  return data.ayat[order[((diff % order.length) + order.length) % order.length]];
}

// ------------------------------------------------------------ jam
function clock(h, mi) {
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

/** "07:00", "7.30", "7" -> "07:00" atau null. */
export function parseClock(tok) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(String(tok).trim());
  return m ? clock(Number(m[1]), Number(m[2] ?? 0)) : null;
}

function withDaypart(h, part) {
  if (part === "sore") return h < 12 ? h + 12 : h;
  if (part === "malam") return h === 12 ? 0 : h < 12 ? h + 12 : h;
  if (part === "siang") return h >= 1 && h <= 5 ? h + 12 : h;
  return h; // pagi
}

/** Semua jam di kalimat: "jam 7 pagi 12 siang dan jam 6 sore" -> ["07:00","12:00","18:00"]. */
export function parseTimesFromText(text) {
  const re = /(?:(?:jam|pukul|pkl)\s*)?(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam)\b|(?:jam|pukul|pkl)\s*(\d{1,2})[.:](\d{2})(?!\s*(?:pagi|siang|sore|malam))/gi;
  const out = [];
  for (const m of String(text ?? "").matchAll(re)) {
    const c = m[3] ? clock(withDaypart(Number(m[1]), m[3].toLowerCase()), Number(m[2] ?? 0)) : clock(Number(m[4]), Number(m[5]));
    if (c && !out.includes(c)) out.push(c);
  }
  return out.sort();
}

// ------------------------------------------------------------ pesan
export function splitMessage(text, max = MAX_MSG) {
  const out = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (const para of String(text).split(/\n{2,}/)) {
    if ((cur ? cur.length + 2 : 0) + para.length <= max) {
      cur = cur ? `${cur}\n\n${para}` : para;
      continue;
    }
    push();
    if (para.length <= max) {
      cur = para;
      continue;
    }
    for (const sent of para.split(/(?<=[.!?。؟])\s+/)) {
      if ((cur ? cur.length + 1 : 0) + sent.length > max) push();
      if (sent.length > max) for (let i = 0; i < sent.length; i += max) out.push(sent.slice(i, i + max));
      else cur = cur ? `${cur} ${sent}` : sent;
    }
    push();
  }
  push();
  return out;
}

const trimTo = (s, n) => {
  const t = String(s ?? "").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const p = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return `${(p > n * 0.5 ? cut.slice(0, p + 1) : cut).trim()} …`;
};

export function formatQuranReminder(juz) {
  return `📖 *Pengingat Al-Qur'an*\nBaca Al-Qur'an hari ini: juz ${juz}`;
}

export function formatAyat(data, a) {
  const [sid, no, arab, arti, tafsir] = a;
  const s = data.surah.get(sid);
  return [
    `📜 *Ayat Hari Ini*\nQS. ${s?.nama || `Surah ${sid}`} (${sid}): ${no}${s?.arti ? ` — ${s.arti}` : ""}`,
    arab,
    `*Artinya:* ${arti}`,
    tafsir ? `*Tafsir Kemenag (ringkas):* ${trimTo(tafsir, 1800)}` : "",
    "_Sumber: Al-Qur'an dan tafsir Kementerian Agama RI. Untuk kajian mendalam, rujuk tafsir lengkapnya._"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatHadits(h, explanation) {
  const parts = [
    `🌙 *Hadits Hari Ini*\nArbain Nawawi no. ${h.no}: ${h.title}`,
    h.ar,
    `*Artinya:* ${h.id}`,
    h.takhrij ? `*Takhrij:* ${trimTo(h.takhrij, 400)}` : ""
  ];
  if (explanation) parts.push(`💡 *Penjelasan ringkas* _(disusun AI; mohon dicek ke kitab syarah)_\n${explanation}`);
  else parts.push("_Penjelasan hadits hari ini belum tersedia (AI sedang tidak bisa dipakai); teks Arab dan artinya tetap dari data._");
  parts.push("_Sumber: Hadits Arbain Nawawi. Periksa derajat hadits pada takhrij di atas (sebagian tercatat hasan)._");
  return parts.filter(Boolean).join("\n\n");
}

export function buildExplainPrompt(h) {
  return [
    "Tulis penjelasan ringkas (4 sampai 6 kalimat, bahasa Indonesia sederhana) untuk hadits berikut, mengikuti pemahaman ulama yang masyhur (mis. Imam an-Nawawi dan Ibnu Rajab dalam syarah Arbain).",
    "Aturan: jangan menulis teks Arab, jangan menambah hadits atau ayat lain, jangan menyebut derajat hadits, jangan mengarang nama ulama atau kitab yang tidak kamu yakini. Jika ada perbedaan pendapat ulama, tulis singkat saja. Akhiri dengan satu kalimat pelajaran praktis.",
    "",
    `Hadits no. ${h.no} (${h.title}):`,
    h.id
  ].join("\n");
}

// ------------------------------------------------------------ penyimpanan
export async function openIbadahStore({ file, log = console } = {}) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (e) {
    log.warn?.(`🕌 Pengingat ibadah tidak aktif: node:sqlite tidak tersedia (${e?.message || e}). Butuh Node 22+.`);
    return null;
  }
  const target = file || ":memory:";
  if (target !== ":memory:") {
    try {
      fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    } catch {
      /* sudah ada */
    }
  }
  const db = new DatabaseSync(target);
  db.exec("CREATE TABLE IF NOT EXISTS ibadah_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  return {
    get(k, fallback = null) {
      const r = db.prepare("SELECT v FROM ibadah_kv WHERE k = ?").get(k);
      if (!r) return fallback;
      try {
        return JSON.parse(r.v);
      } catch {
        return fallback;
      }
    },
    set(k, v) {
      db.prepare("INSERT INTO ibadah_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v));
    }
  };
}

// ------------------------------------------------------------ perintah
const KIND_WORD = { quran: "quran", alquran: "quran", "al-quran": "quran", hadits: "hadits", hadis: "hadits", ayat: "ayat" };
const KIND_LABEL = { quran: "Al-Qur'an", hadits: "Hadits harian", ayat: "Ayat harian" };

/** "/ingatkan setiap hari jam 7 pagi ... baca al quran. hari ini juz 2" -> { times, juz } atau null (bukan pengingat ibadah). */
export function matchIngatkanQuran(arg) {
  const s = String(arg ?? "");
  if (!/\bal\s*-?\s*qur'?an\b|\bquran\b|\bqur'an\b/i.test(s)) return null;
  if (!/\b(?:setiap|tiap)\s+hari\b|\bharian\b|\bsehari\b/i.test(s)) return null;
  const j = /\bjuz\s*(?:ke-?)?\s*(\d{1,2})\b/i.exec(s);
  if (!j) return null;
  const juz = Number(j[1]);
  if (juz < 1 || juz > 30) return { error: "Nomor juz harus 1 sampai 30." };
  const times = parseTimesFromText(s);
  return { juz, times };
}

export function createIbadah({ store, send, explain = null, now = () => Date.now(), timeZone = "Asia/Jakarta", tzLabel = "WIB", log = console, retryMs = 2 * 60_000, data = null } = {}) {
  let running = false;
  const retryAt = new Map();
  const getData = () => data || loadData();
  const cfg = () => {
    const c = store?.get("config", null) || {};
    return {
      quran: { on: false, times: [...DEFAULT_QURAN_TIMES], startJuz: 1, startDate: todayIso(now(), timeZone), ...(c.quran || {}) },
      hadits: { on: false, times: [DEFAULT_HADITS_TIME], startDate: todayIso(now(), timeZone), ...(c.hadits || {}) },
      ayat: { on: false, times: [DEFAULT_AYAT_TIME], startDate: todayIso(now(), timeZone), ...(c.ayat || {}) }
    };
  };
  const save = (c) => store.set("config", c);

  const usage = () =>
    [
      `🕌 Pengingat ibadah (waktu ${tzLabel}):`,
      '/ingatkan setiap hari jam 7 pagi 12 siang dan jam 6 sore baca al quran, hari ini juz 2',
      "/ibadah mulai juz 2  — nyalakan semua (Qur'an, hadits, ayat)",
      "/ibadah juz 5  — hari ini juz 5, besok juz 6, dst",
      "/ibadah jam quran 07:00 12:00 18:00   •   /ibadah jam hadits 05:30   •   /ibadah jam ayat 06:00",
      "/ibadah quran mati|aktif   •   /ibadah hadits mati|aktif   •   /ibadah ayat mati|aktif",
      "/ibadah mati  — matikan semua   •   /ibadah tes  — kirim contoh sekarang"
    ].join("\n");

  function status() {
    const c = cfg();
    const t = todayIso(now(), timeZone);
    const jz = juzFor(c.quran.startJuz, c.quran.startDate, t);
    const nx = (jz % 30) + 1;
    return [
      `🕌 Pengingat ibadah (waktu ${tzLabel}):`,
      `📖 Al-Qur'an: ${c.quran.on ? "AKTIF" : "mati"} • ${c.quran.times.join(", ")} • hari ini juz ${jz}, besok juz ${nx}`,
      `🌙 Hadits harian: ${c.hadits.on ? "AKTIF" : "mati"} • ${c.hadits.times[0]}`,
      `📜 Ayat harian: ${c.ayat.on ? "AKTIF" : "mati"} • ${c.ayat.times[0]}`,
      "",
      usage()
    ].join("\n");
  }

  function startAll(c, juz, times) {
    const t = todayIso(now(), timeZone);
    const firstTime = !store.get("config", null);
    if (juz) {
      c.quran.startJuz = juz;
      c.quran.startDate = t;
    } else if (firstTime) {
      c.quran.startJuz = 1;
      c.quran.startDate = t;
    }
    if (times?.length) c.quran.times = times.slice(0, 6);
    c.quran.on = true;
    for (const k of ["hadits", "ayat"]) {
      if (!c[k].on) c[k].startDate = t; // mulai dari hadits/ayat pertama pada hari menyalakan
      c[k].on = true;
    }
  }

  function describeStarted(c) {
    const t = todayIso(now(), timeZone);
    const jz = juzFor(c.quran.startJuz, c.quran.startDate, t);
    return [
      `✅ Pengingat ibadah aktif (waktu ${tzLabel}).`,
      `📖 Al-Qur'an ${c.quran.times.join(", ")}: "Baca Al-Qur'an hari ini: juz ${jz}". Besok juz ${(jz % 30) + 1}, dan seterusnya; setelah juz 30 kembali ke juz 1.`,
      `🌙 Hadits harian ${c.hadits.times[0]} (Arab, arti, penjelasan ringkas).`,
      `📜 Ayat harian ${c.ayat.times[0]} (Arab, arti, tafsir ringkas).`,
      "Ubah jam: /ibadah jam hadits 05:00 • matikan: /ibadah mati • contoh sekarang: /ibadah tes"
    ].join("\n");
  }

  /** /ingatkan ...: tangani hanya kalimat "tiap hari + Al-Qur'an + juz N"; selain itu null (pengingat biasa). */
  function intercept(arg) {
    const m = matchIngatkanQuran(arg);
    if (!m) return null;
    if (!store) return "Fitur pengingat ibadah belum aktif di bot ini (butuh Node 22+).";
    if (m.error) return `⚠️ ${m.error}`;
    const c = cfg();
    startAll(c, m.juz, m.times);
    save(c);
    return describeStarted(c);
  }

  function handle(arg) {
    if (!store) return "Fitur pengingat ibadah belum aktif di bot ini (butuh Node 22+).";
    const s = String(arg ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!s || s === "status" || s === "bantuan" || s === "help") return status();
    const c = cfg();
    let m;
    if ((m = /^(?:mulai|aktifkan|aktif|nyalakan)(?:\s+juz\s*(\d{1,2}))?$/.exec(s))) {
      const juz = m[1] ? Number(m[1]) : 0;
      if (m[1] && (juz < 1 || juz > 30)) return "⚠️ Nomor juz harus 1 sampai 30.";
      startAll(c, juz, null);
      save(c);
      return describeStarted(c);
    }
    if (/^(?:mati|matikan|nonaktif|berhenti)$/.test(s)) {
      for (const k of ["quran", "hadits", "ayat"]) c[k].on = false;
      save(c);
      return "🛑 Semua pengingat ibadah dimatikan. Pengaturan jam dan juz tetap tersimpan; nyalakan lagi: /ibadah aktif";
    }
    if ((m = /^(quran|alquran|al-quran|hadits|hadis|ayat)\s+(aktif|mati|nonaktif)$/.exec(s))) {
      const k = KIND_WORD[m[1]];
      const on = m[2] === "aktif";
      if (on && !c[k].on && k !== "quran") c[k].startDate = todayIso(now(), timeZone);
      c[k].on = on;
      save(c);
      return `${on ? "✅" : "🛑"} ${KIND_LABEL[k]} ${on ? "diaktifkan" : "dimatikan"}.`;
    }
    if ((m = /^juz\s*(\d{1,2})$/.exec(s))) {
      const juz = Number(m[1]);
      if (juz < 1 || juz > 30) return "⚠️ Nomor juz harus 1 sampai 30.";
      c.quran.startJuz = juz;
      c.quran.startDate = todayIso(now(), timeZone);
      c.quran.on = true;
      save(c);
      return `✅ Hari ini juz ${juz}, besok juz ${(juz % 30) + 1}, dan seterusnya (setelah juz 30 kembali ke juz 1). Pengingat Al-Qur'an: ${c.quran.times.join(", ")} ${tzLabel}.`;
    }
    if ((m = /^jam\s+(quran|alquran|al-quran|hadits|hadis|ayat)\s+(.+)$/.exec(s))) {
      const k = KIND_WORD[m[1]];
      const toks = m[2].split(/[\s,]+|\bdan\b/).filter(Boolean);
      const times = [];
      for (const tok of toks) {
        const cl = parseClock(tok);
        if (!cl) return `⚠️ Jam "${tok}" tidak valid. Contoh: /ibadah jam quran 07:00 12:00 18:00`;
        if (!times.includes(cl)) times.push(cl);
      }
      times.sort();
      if (k !== "quran" && times.length > 1) return `⚠️ ${KIND_LABEL[k]} hanya satu kali sehari. Contoh: /ibadah jam ${m[1]} 05:30`;
      if (times.length > 6) return "⚠️ Paling banyak 6 jam sehari.";
      c[k].times = times;
      save(c);
      return `✅ Jam ${KIND_LABEL[k]}: ${times.join(", ")} ${tzLabel}.${c[k].on ? "" : ` (Masih mati: /ibadah ${m[1]} aktif)`}`;
    }
    if (/^(?:tes|test|contoh)$/.test(s)) {
      sendSamples().catch((e) => log.error?.(`🕌 Contoh pengingat ibadah gagal: ${e?.message || e}`));
      return "⏳ Mengirim contoh juz, hadits, dan ayat hari ini (beberapa detik)…";
    }
    return `Perintah tidak dikenali.\n\n${usage()}`;
  }

  async function explainFor(h) {
    if (!explain) return null;
    const key = `explain:${h.no}`;
    const cached = store.get(key, null);
    if (cached) return cached;
    try {
      const text = await Promise.race([explain(h), new Promise((_, rej) => setTimeout(() => rej(new Error("AI kelamaan")), 60_000))]);
      const clean = String(text ?? "").trim();
      if (clean) {
        store.set(key, clean);
        return clean;
      }
    } catch (e) {
      log.warn?.(`🕌 Penjelasan hadits no. ${h.no} gagal dibuat AI: ${e?.message || e}`);
    }
    return null;
  }

  async function contentFor(kind, c, iso) {
    if (kind === "quran") return [formatQuranReminder(juzFor(c.quran.startJuz, c.quran.startDate, iso))];
    const d = getData();
    if (kind === "ayat") return splitMessage(formatAyat(d, pickAyat(d, c.ayat.startDate, iso)));
    const h = pickHadits(d, c.hadits.startDate, iso);
    return splitMessage(formatHadits(h, await explainFor(h)));
  }

  async function sendParts(parts) {
    let first = true;
    for (const p of parts) {
      try {
        await send(p);
      } catch (e) {
        if (first) throw e;
        log.warn?.(`🕌 Sebagian pesan ibadah gagal terkirim: ${e?.message || e}`);
        return;
      }
      first = false;
    }
  }

  async function sendSamples() {
    const c = cfg();
    const iso = todayIso(now(), timeZone);
    for (const kind of ["quran", "hadits", "ayat"]) {
      const parts = await contentFor(kind, c, iso);
      parts[0] = `(contoh) ${parts[0]}`;
      await sendParts(parts);
    }
  }

  /** Dipanggil berkala. @returns jumlah pengingat terkirim */
  async function check() {
    if (!store || running) return 0;
    running = true;
    let sent = 0;
    try {
      const t = now();
      const p = tzParts(t, timeZone);
      const iso = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
      const nowMin = p.h * 60 + p.mi;
      const c = cfg();
      const log2 = store.get("sent", {}) || {};
      let dirty = false;
      for (const k of Object.keys(log2)) if (dayNumber(k.split("|")[1] || iso) < dayNumber(iso) - 3) (delete log2[k], (dirty = true));
      for (const kind of ["quran", "hadits", "ayat"]) {
        if (!c[kind].on) continue;
        for (const time of c[kind].times) {
          const [hh, mm] = time.split(":").map(Number);
          const slot = hh * 60 + mm;
          const key = `${kind}|${iso}|${time}`;
          if (slot > nowMin || log2[key]) continue;
          const late = nowMin - slot;
          if (late > LATE_LIMIT_MIN[kind]) {
            log2[key] = -1; // sudah lewat jauh: lewati, jangan kirim siang bolong
            dirty = true;
            continue;
          }
          if ((retryAt.get(key) ?? 0) > t) continue;
          try {
            const parts = await contentFor(kind, c, iso);
            if (late > 5) parts[0] = `${parts[0]}\n\n(terlambat ${late >= 120 ? `${Math.round(late / 60)} jam` : `${late} menit`}: bot sedang mati atau tidak tersambung saat waktunya)`;
            await sendParts(parts);
          } catch (e) {
            retryAt.set(key, t + retryMs);
            log.warn?.(`🕌 Pengingat ${kind} ${time} belum terkirim (dicoba lagi sebentar lagi): ${e?.message || e}`);
            continue;
          }
          retryAt.delete(key);
          log2[key] = t;
          dirty = true;
          sent += 1;
        }
      }
      if (dirty) store.set("sent", log2);
    } catch (e) {
      log.error?.(`🕌 Pemeriksaan pengingat ibadah gagal: ${e?.message || e}`);
    } finally {
      running = false;
    }
    return sent;
  }

  const describe = () => {
    if (!store) return "mati (butuh Node 22+)";
    const c = cfg();
    const on = ["quran", "hadits", "ayat"].filter((k) => c[k].on);
    return on.length ? `AKTIF (${on.map((k) => KIND_LABEL[k]).join(", ")}; /ibadah)` : "siap, belum dinyalakan (/ibadah mulai juz 2)";
  };

  return { handle, intercept, check, describe, status, usage, sendSamples };
}
