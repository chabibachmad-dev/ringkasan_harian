// Pengingat pribadi: /ingatkan <waktu> <teks>, /pengingat. Disimpan di SQLite LOKAL (pengingat.sqlite), dikirim ke
// WhatsApp + Telegram pemilik pada waktunya. Tanpa AI, tanpa layanan luar, tanpa biaya.
//
// Contoh:
//   /ingatkan 30 menit lagi cek oven            /ingatkan besok 09:00 kirim SPJ
//   /ingatkan jumat jam 14.30 rapat             /ingatkan 25 okt 08:00 bayar pajak
//   /ingatkan tiap tanggal 25 jam 08:00 laporan bulanan
//   /ingatkan tiap senin 07:30 apel             /ingatkan tiap hari 21:00 kunci pintu
//   /pengingat   (daftar)        /pengingat batal 3   |   /pengingat batal semua
//
// Aturan:
//   - Zona waktu mengikuti WA_TIMEZONE. Jam tidak disebut -> 08:00 (dan dikatakan di balasan, tidak diam-diam).
//     "pagi/siang/sore/malam" tanpa jam = 07:00/12:00/16:00/20:00.
//   - Teks yang tampak seperti rahasia (key, kata sandi, PIN, nomor kartu) ditolak: pengingat dikirim lewat WhatsApp/Telegram.
//   - Bot mati saat waktunya: begitu menyala, pengingat yang terlewat tetap dikirim dengan keterangan "terlambat".
//     Pengingat berulang yang terlewat beberapa kali dikirim sekali, lalu lanjut ke jadwal berikutnya.
//   - Dibatasi: 100 pengingat aktif, 200 huruf per pengingat, paling jauh 400 hari ke depan.

import fs from "node:fs";
import path from "node:path";
import { looksLikeSecret } from "./owner-memory.js";

export const MAX_TEXT_CHARS = 200;
const MAX_AHEAD_MS = 400 * 86400_000;
const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const DAY_WORDS = { minggu: 0, ahad: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6 };
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const DAYPART_DEFAULT = { pagi: [7, 0], siang: [12, 0], sore: [16, 0], malam: [20, 0] };
const DEFAULT_TIME = [8, 0];

// ------------------------------------------------------------ waktu & zona
const fmtCache = new Map();
function tzFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Komponen waktu lokal di zona tz: { y, m (1-12), d, h, mi, dow (0=Minggu) }. */
export function tzParts(ms, tz) {
  const parts = tzFormatter(tz).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  return { y, m, d, h: get("hour") % 24, mi: get("minute"), dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

function offsetAt(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000;
}

/** Waktu dinding (y-m-d h:mi di zona tz) -> epoch ms UTC. */
export function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (y, m, d, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const pad2 = (n) => String(n).padStart(2, "0");

/** Kejadian pertama dari jadwal berulang yang waktunya SETELAH afterMs. */
export function nextOccurrence(repeat, afterMs, tz) {
  const base = tzParts(afterMs, tz);
  for (let k = 0; k <= 400; k++) {
    const day = addDays(base.y, base.m, base.d, k);
    const dow = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
    let match = true;
    if (repeat.kind === "weekly") match = dow === repeat.dow;
    else if (repeat.kind === "monthly") match = day.d === Math.min(repeat.dom, daysInMonth(day.y, day.m));
    if (!match) continue;
    const ms = zonedToUtc(day.y, day.m, day.d, repeat.h, repeat.mi, tz);
    if (ms > afterMs) return ms;
  }
  return null;
}

export function describeRepeat(repeat) {
  const t = `${pad2(repeat.h)}:${pad2(repeat.mi)}`;
  if (repeat.kind === "daily") return `tiap hari ${t}`;
  if (repeat.kind === "weekly") return `tiap ${DAY_NAMES[repeat.dow]} ${t}`;
  return `tiap tanggal ${repeat.dom} ${t}`;
}

/** "Jumat, 16 Okt 2026 09:00" */
export function formatWhen(ms, tz) {
  const p = tzParts(ms, tz);
  return `${DAY_NAMES[p.dow]}, ${p.d} ${MONTH_SHORT[p.m - 1]} ${p.y} ${pad2(p.h)}:${pad2(p.mi)}`;
}

function durationText(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} jam${m % 60 ? ` ${m % 60} menit` : ""}`;
  return `${Math.floor(h / 24)} hari`;
}

// ------------------------------------------------------------ penguraian perintah
/** Kenali /ingatkan dan /pengingat (alias /remind, /reminder). null bila bukan perintah. */
export function parseReminderCommand(text) {
  const m = /^\s*\/(ingatkan|remind|pengingat|reminder|ibadah)(?:@\w+)?(?:[\s:,-]+([\s\S]*))?$/i.exec(String(text ?? ""));
  if (!m) return null;
  const word = m[1].toLowerCase();
  return { name: word === "ibadah" ? "ibadah" : word === "ingatkan" || word === "remind" ? "ingatkan" : "pengingat", arg: (m[2] ?? "").trim() };
}

function clockFrom(s) {
  // jam eksplisit ("jam 9", "pukul 14.30", "09:00", "9 malam") atau bagian hari ("pagi", "malam")
  let m = /^(?:(?:pukul|jam|pkl)\s*(\d{1,2})(?:[:.](\d{2}))?|(\d{1,2})[:.](\d{2}))\s*(?:(pagi|siang|sore|malam)\b)?\s*(?:wib|wita|wit)?\b\s*/i.exec(s);
  if (m) {
    let h = Number(m[1] ?? m[3]);
    const mi = Number(m[2] ?? m[4] ?? 0);
    const part = (m[5] || "").toLowerCase();
    if (part === "sore" || part === "malam") {
      if (h < 12) h += 12;
    } else if (part === "siang" && h >= 1 && h <= 3) h += 12;
    if (h > 23 || mi > 59) return { error: "Jamnya tidak valid (jam 0-23, menit 0-59)." };
    return { h, mi, rest: s.slice(m[0].length), explicit: true };
  }
  m = /^(pagi|siang|sore|malam)\b\s*/i.exec(s);
  if (m) {
    const [h, mi] = DAYPART_DEFAULT[m[1].toLowerCase()];
    return { h, mi, rest: s.slice(m[0].length), explicit: true };
  }
  return null;
}

function cleanText(rest) {
  return String(rest ?? "")
    .replace(/^[\s:,\-–—]+/, "")
    .replace(/^(?:untuk|yaitu|bahwa)\b[\s:,\-–—]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const monthIndex = (word) => MONTH_KEYS.indexOf(String(word).toLowerCase().slice(0, 3));

/**
 * @returns {{ok:true, dueMs:number, repeat:object|null, text:string, defaultedTime:boolean} | {ok:false, error:string}}
 */
export function parseReminder(input, { now = Date.now(), timeZone = "Asia/Jakarta" } = {}) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "empty" };
  const today = tzParts(now, timeZone);
  const fail = (error) => ({ ok: false, error });
  const finish = (dueMs, repeat, rest, defaultedTime) => {
    const text = cleanText(rest);
    if (!text) return fail("Tulis juga apa yang diingatkan, contoh: /ingatkan besok 09:00 kirim SPJ");
    if (text.length > MAX_TEXT_CHARS) return fail(`Teks pengingat terlalu panjang (${text.length} huruf, maks ${MAX_TEXT_CHARS}).`);
    if (dueMs - now > MAX_AHEAD_MS) return fail("Terlalu jauh ke depan (maks sekitar 400 hari).");
    return { ok: true, dueMs, repeat, text, defaultedTime };
  };

  let m;

  // --- relatif: "30 menit lagi", "dalam 2 jam", "3 hari lagi"
  if ((m = /^(?:dalam\s+)?(\d{1,3})\s*(menit|mnt|jam|hari)\b(?:\s+lagi)?\s*/i.exec(raw))) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (n < 1) return fail("Jumlahnya minimal 1.");
    const ms = n * (unit === "jam" ? 3600_000 : unit === "hari" ? 86400_000 : 60_000);
    return finish(Math.ceil((now + ms) / 60000) * 60000, null, raw.slice(m[0].length), false);
  }

  // --- berulang
  if ((m = /^(?:tiap|setiap)\s+/i.exec(raw))) {
    let s = raw.slice(m[0].length);
    let repeat = null;
    let r;
    if ((r = /^hari\b\s*/i.exec(s))) {
      repeat = { kind: "daily" };
      s = s.slice(r[0].length);
    } else if ((r = /^(minggu|ahad|senin|selasa|rabu|kamis|jum'?at|sabtu)\b\s*/i.exec(s))) {
      repeat = { kind: "weekly", dow: DAY_WORDS[r[1].toLowerCase()] };
      s = s.slice(r[0].length);
    } else if ((r = /^(?:bulan\s+)?(?:tanggal|tgl)\.?\s*(\d{1,2})\b\s*/i.exec(s))) {
      const dom = Number(r[1]);
      if (dom < 1 || dom > 31) return fail("Tanggalnya tidak valid (1-31).");
      repeat = { kind: "monthly", dom };
      s = s.slice(r[0].length);
    }
    if (!repeat) return fail('Untuk yang berulang tulis: "tiap hari 07:00 ...", "tiap senin 07:30 ...", atau "tiap tanggal 25 jam 08:00 ...".');
    const c = clockFrom(s);
    if (c?.error) return fail(c.error);
    const [h, mi] = c ? [c.h, c.mi] : DEFAULT_TIME;
    repeat = { ...repeat, h, mi };
    const dueMs = nextOccurrence(repeat, now, timeZone);
    if (dueMs === null) return fail("Jadwal berulangnya tidak bisa dihitung.");
    return finish(dueMs, repeat, c ? c.rest : s, !c);
  }

  // --- hari/tanggal tertentu
  let target = null; // { y, m, d, needYear? }
  let s = raw;
  let relDay = false;
  if ((m = /^hari\s+ini\b\s*/i.exec(s))) {
    target = { y: today.y, m: today.m, d: today.d };
    relDay = "today";
    s = s.slice(m[0].length);
  } else if ((m = /^besok\b\s*/i.exec(s))) {
    target = addDays(today.y, today.m, today.d, 1);
    s = s.slice(m[0].length);
  } else if ((m = /^lusa\b\s*/i.exec(s))) {
    target = addDays(today.y, today.m, today.d, 2);
    s = s.slice(m[0].length);
  } else if ((m = /^(?:hari\s+)?(minggu|ahad|senin|selasa|rabu|kamis|jum'?at|sabtu)\b\s*/i.exec(s))) {
    const dow = DAY_WORDS[m[1].toLowerCase()];
    target = { ...addDays(today.y, today.m, today.d, (dow - today.dow + 7) % 7), weekdayToday: dow === today.dow };
    s = s.slice(m[0].length);
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})\b\s*/.exec(s))) {
    target = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), explicitYear: true };
    s = s.slice(m[0].length);
  } else if ((m = /^(\d{1,2})\s+(jan\w*|feb\w*|mar\w*|apr\w*|mei|jun\w*|jul\w*|agu\w*|ags|sep\w*|okt\w*|nov\w*|des\w*)(?:\s+(\d{4}))?\b\s*/i.exec(s)) && monthIndex(m[2]) >= 0) {
    target = { y: m[3] ? Number(m[3]) : today.y, m: monthIndex(m[2]) + 1, d: Number(m[1]), explicitYear: !!m[3] };
    s = s.slice(m[0].length);
  } else if ((m = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b\s*/.exec(s))) {
    const yr = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : today.y;
    target = { y: yr, m: Number(m[2]), d: Number(m[1]), explicitYear: !!m[3] };
    s = s.slice(m[0].length);
  }
  if (!target) {
    return fail("Waktunya tidak terbaca. Contoh: 30 menit lagi • besok 09:00 • jumat jam 14.30 • 25 okt 08:00 • tiap tanggal 25 jam 08:00");
  }
  if (target.m < 1 || target.m > 12 || target.d < 1 || target.d > daysInMonth(target.y, target.m)) return fail("Tanggalnya tidak valid.");

  const c = clockFrom(s);
  if (c?.error) return fail(c.error);
  const [h, mi] = c ? [c.h, c.mi] : DEFAULT_TIME;
  let dueMs = zonedToUtc(target.y, target.m, target.d, h, mi, timeZone);
  if (dueMs <= now) {
    if (target.weekdayToday) {
      const nx = addDays(target.y, target.m, target.d, 7);
      dueMs = zonedToUtc(nx.y, nx.m, nx.d, h, mi, timeZone);
    } else if (target.explicitYear === false) {
      if (target.y === today.y && target.d <= daysInMonth(today.y + 1, target.m)) dueMs = zonedToUtc(target.y + 1, target.m, target.d, h, mi, timeZone);
    }
    if (dueMs <= now) return fail(relDay === "today" ? "Jam itu hari ini sudah lewat. Pakai 'besok' atau jam yang lebih akhir." : "Waktu itu sudah lewat.");
  }
  return finish(dueMs, null, c ? c.rest : s, !c);
}

// ------------------------------------------------------------ penyimpanan
export async function openReminderStore({ file, maxActive = 100, log = console, now = () => Date.now() } = {}) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (e) {
    log.warn?.(`⏰ Pengingat tidak aktif: node:sqlite tidak tersedia (${e?.message || e}). Butuh Node 22+.`);
    return null;
  }
  const target = file || ":memory:";
  if (target !== ":memory:") {
    try {
      fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    } catch {
      /* folder sudah ada */
    }
  }
  const db = new DatabaseSync(target);
  db.exec("CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, due_ms INTEGER NOT NULL, repeat TEXT, created_ms INTEGER NOT NULL, fired INTEGER NOT NULL DEFAULT 0)");
  const limit = Math.max(1, Math.floor(Number(maxActive) || 100));
  const toRow = (r) => ({ id: Number(r.id), text: r.text, dueMs: Number(r.due_ms), repeat: r.repeat ? JSON.parse(r.repeat) : null, createdMs: Number(r.created_ms), fired: Number(r.fired) });
  const all = () => db.prepare("SELECT * FROM reminders ORDER BY due_ms ASC, id ASC").all().map(toRow);

  return {
    limit,
    count: () => Number(db.prepare("SELECT COUNT(*) AS n FROM reminders").get().n),
    list: all,
    add({ text, dueMs, repeat = null }) {
      if (all().length >= limit) return { ok: false, reason: "full" };
      const dup = all().find((r) => r.text.toLowerCase() === text.toLowerCase() && r.dueMs === dueMs);
      if (dup) return { ok: false, reason: "duplicate", id: dup.id };
      const info = db.prepare("INSERT INTO reminders (text, due_ms, repeat, created_ms) VALUES (?, ?, ?, ?)").run(text, dueMs, repeat ? JSON.stringify(repeat) : null, now());
      return { ok: true, id: Number(info.lastInsertRowid) };
    },
    due: (nowMs) => db.prepare("SELECT * FROM reminders WHERE due_ms <= ? ORDER BY due_ms ASC, id ASC").all(nowMs).map(toRow),
    reschedule: (id, dueMs) => void db.prepare("UPDATE reminders SET due_ms = ?, fired = fired + 1 WHERE id = ?").run(dueMs, id),
    remove(which) {
      if (/^(semua|all)$/i.test(String(which).trim())) {
        const n = this.count();
        db.exec("DELETE FROM reminders");
        return { ok: true, removed: n };
      }
      const id = Number(String(which).replace(/^#/, "").trim());
      const row = Number.isInteger(id) ? all().find((r) => r.id === id) : null;
      if (!row) return { ok: false, reason: "not_found" };
      db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
      return { ok: true, removed: 1, row };
    },
    close() {
      try {
        db.close();
      } catch {
        /* sudah tertutup */
      }
    }
  };
}

// ------------------------------------------------------------ penjadwal + perintah
/**
 * deps: store, send(text) -> Promise (lempar bila gagal terkirim), now() -> ms, timeZone, tzLabel, log, retryMs
 */
export function createReminders({ store, send, now = () => Date.now(), timeZone = "Asia/Jakarta", tzLabel = "WIB", log = console, retryMs = 2 * 60_000, ibadah = null } = {}) {
  let running = false;
  const retryAt = new Map(); // id -> ms: jangan coba kirim ulang sebelum ini (kirim gagal)

  const usage = () =>
    [
      `⏰ Pengingat (disimpan hanya di laptop, dikirim ke WhatsApp dan Telegram; waktu ${tzLabel}):`,
      "/ingatkan 30 menit lagi cek oven",
      "/ingatkan besok 09:00 kirim SPJ",
      "/ingatkan jumat jam 14.30 rapat",
      "/ingatkan 25 okt 08:00 bayar pajak",
      "/ingatkan tiap tanggal 25 jam 08:00 laporan bulanan",
      "/ingatkan tiap senin 07:30 apel   •   /ingatkan tiap hari 21:00 kunci pintu",
      "/pengingat  — daftar   •   /pengingat batal <nomor>   •   /pengingat batal semua",
      'Jam tidak disebut = 08:00. "pagi/siang/sore/malam" tanpa jam = 07:00/12:00/16:00/20:00.',
      "Jangan menulis kata sandi, PIN, atau nomor kartu."
    ].join("\n");

  function add(arg) {
    const special = ibadah?.intercept(arg); // "tiap hari ... baca al quran ... juz 2" = pengingat ibadah (ibadah.js)
    if (special) return special;
    if (!store) return "Fitur pengingat belum aktif di bot ini (butuh Node 22+).";
    if (!String(arg ?? "").trim()) return usage();
    const p = parseReminder(arg, { now: now(), timeZone });
    if (!p.ok) return `⚠️ ${p.error}\n\n${usage()}`;
    if (looksLikeSecret(p.text)) return "Itu tampak seperti rahasia (key, kata sandi, PIN, atau nomor kartu), jadi tidak disimpan sebagai pengingat. Pengingat dikirim lewat WhatsApp/Telegram.";
    const r = store.add({ text: p.text, dueMs: p.dueMs, repeat: p.repeat });
    if (!r.ok) {
      if (r.reason === "full") return `Pengingat sudah penuh (${store.limit}). Hapus yang lama: /pengingat batal <nomor>.`;
      return `Pengingat yang sama (nomor ${r.id}) sudah ada.`;
    }
    const lines = [`✅ Oke, kuingatkan ${formatWhen(p.dueMs, timeZone)} ${tzLabel}: ${p.text}`];
    if (p.repeat) lines.push(`🔁 Berulang: ${describeRepeat(p.repeat)}`);
    if (p.defaultedTime) lines.push(`ℹ️ Jam tidak disebut, kupakai ${pad2(DEFAULT_TIME[0])}:${pad2(DEFAULT_TIME[1])}.`);
    lines.push(`Nomor ${r.id} • batalkan: /pengingat batal ${r.id}`);
    return lines.join("\n");
  }

  function list() {
    if (!store) return "Fitur pengingat belum aktif di bot ini (butuh Node 22+).";
    const rows = store.list();
    if (rows.length === 0) return `Belum ada pengingat.\n\n${usage()}`;
    return [
      `⏰ ${rows.length} pengingat aktif (waktu ${tzLabel}):`,
      ...rows.map((r) => `#${r.id} • ${formatWhen(r.dueMs, timeZone)} • ${r.text}${r.repeat ? ` 🔁 ${describeRepeat(r.repeat)}` : ""}`),
      "",
      "Batalkan: /pengingat batal <nomor> atau /pengingat batal semua"
    ].join("\n");
  }

  function cancel(which) {
    if (!store) return "Fitur pengingat belum aktif di bot ini (butuh Node 22+).";
    if (!String(which ?? "").trim()) return "Sebut nomor pengingat yang dibatalkan (lihat /pengingat), atau /pengingat batal semua.";
    const r = store.remove(which);
    if (r.ok) return /^(semua|all)$/i.test(String(which).trim()) ? `🧹 ${r.removed} pengingat dibatalkan.` : `🧹 Dibatalkan: ${r.row.text}`;
    return `Tidak ada pengingat nomor ${String(which).replace(/^#/, "")}. Lihat /pengingat.`;
  }

  /** Satu pintu untuk Telegram/WhatsApp: { name: "ingatkan"|"pengingat", arg } -> teks balasan. */
  function handle({ name, arg }) {
    if (name === "ibadah") return ibadah ? ibadah.handle(arg) : "Fitur pengingat ibadah belum aktif di bot ini.";
    if (name === "ingatkan") return add(arg);
    const m = /^(?:batal|hapus|cancel|lupa)\b\s*([\s\S]*)$/i.exec(String(arg ?? "").trim());
    if (m) return cancel(m[1]);
    if (String(arg ?? "").trim()) return add(arg); // "/pengingat besok 09:00 ..." juga dianggap menambah
    return list();
  }

  /** Dipanggil berkala: kirim semua pengingat yang sudah jatuh tempo. @returns jumlah yang terkirim */
  async function check() {
    if (!store || running) return 0;
    running = true;
    let sent = 0;
    try {
      const t = now();
      for (const r of store.due(t)) {
        if ((retryAt.get(r.id) ?? 0) > t) continue;
        const late = t - r.dueMs;
        const lines = [`⏰ *Pengingat*: ${r.text}`];
        if (late > 5 * 60_000) lines.push(`(terlambat ${durationText(late)}: bot sedang mati atau tidak tersambung saat waktunya)`);
        let nextMs = null;
        if (r.repeat) {
          nextMs = nextOccurrence(r.repeat, t, timeZone);
          lines.push(`🔁 ${describeRepeat(r.repeat)}${nextMs ? ` • berikutnya ${formatWhen(nextMs, timeZone)} ${tzLabel}` : ""}`);
        }
        try {
          await send(lines.join("\n"));
        } catch (e) {
          retryAt.set(r.id, t + retryMs);
          log.warn?.(`⏰ Pengingat #${r.id} belum terkirim (dicoba lagi sebentar lagi): ${e?.message || e}`);
          continue;
        }
        retryAt.delete(r.id);
        sent += 1;
        if (nextMs) store.reschedule(r.id, nextMs);
        else store.remove(String(r.id));
      }
    } catch (e) {
      log.error?.(`⏰ Pemeriksaan pengingat gagal: ${e?.message || e}`);
    } finally {
      running = false;
    }
    return sent;
  }

  const describe = () => (store ? `AKTIF (${store.count()} pengingat; /ingatkan, /pengingat)` : "mati (butuh Node 22+)");

  return { handle, add, list, cancel, check, describe, usage };
}
