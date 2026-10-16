// ================================================================
// Agenda / jadwal kantor di GRUP WhatsApp.
//
//   Dicatat:      "bot, catat rapat evaluasi Kamis 22 Oktober jam 10.00 di ruang rapat"
//                 "bot, jadwalkan apel tiap senin jam 07.30"   •   balas (reply) pesan jadwal: "bot, catat ini"
//   Ditawarkan:   bot menyimak grup (tanpa AI, hanya pola kalimat). Ada kalimat seperti "besok rapat jam 9 ya" -> bot bertanya
//                 "Mau saya catat sebagai jadwal?"; baru disimpan bila ada yang membalas "ya".
//   Ditanya:      "bot, ada jadwal apa hari ini?"  •  "jadwal besok"  •  "agenda minggu ini"  •  "jadwal kamis"  •  "jadwal berikutnya"
//   Diubah:       "bot, hapus jadwal 5"  •  "bot, pindah jadwal 5 ke jumat jam 13.00"
//   Pengingat:    tiap pagi (AGENDA_MORNING_TIME) rekap jadwal hari itu (diam bila kosong) + AGENDA_REMIND_BEFORE_MIN menit sebelum acara.
//
// Disimpan di SQLite LOKAL (agenda.sqlite), per grup. Tanpa AI, tanpa layanan luar, tanpa biaya. Semua anggota grup boleh mencatat dan menghapus.
// Jam tidak disebut -> acara seharian (tanpa pengingat jam). "jam 2" tanpa keterangan pagi/siang/sore -> 14.00 (jam 1-6 dianggap siang/sore).
// ================================================================
import fs from "node:fs";
import path from "node:path";
import { parseReminder, tzParts, zonedToUtc, nextOccurrence, describeRepeat } from "./reminders.js";

export const MAX_TITLE_CHARS = 140;
const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"];
const MONTH_RE = "januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sept|sep|oktober|okt|november|nov|desember|des";
const normMonth = (w) => (/^ags/i.test(w) ? "agu" : String(w).toLowerCase().slice(0, 3));
const DOW_RE = "senin|selasa|rabu|kamis|jum'?at|sabtu";
const pad2 = (n) => String(n).padStart(2, "0");
const hhmm = (h, mi) => `${pad2(h)}:${pad2(mi)}`;

// ---------------------------------------------------------------- menguraikan tanggal & jam dari kalimat
const DATE_PATTERNS = [
  { name: "iso", re: /\b(\d{4})-(\d{2})-(\d{2})\b/i, explicit: true, norm: (m) => m[0] },
  { name: "dmon", re: new RegExp(`\\b(?:tanggal\\s+|tgl\\.?\\s*)?(\\d{1,2})\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?\\b`, "i"), explicit: true, norm: (m) => `${m[1]} ${normMonth(m[2])}${m[3] ? ` ${m[3]}` : ""}` },
  { name: "dmy", re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/i, explicit: true, norm: (m) => m[0] },
  { name: "tgl", re: /\b(?:tanggal|tgl\.?)\s*(\d{1,2})\b/i, explicit: true, dayOnly: true },
  { name: "rel", re: /\b(hari\s+ini|besok|lusa)(?:\s+(pagi|siang|sore|malam))?\b/i, norm: (m) => m[1].replace(/\s+/g, " ").toLowerCase(), part: 2 },
  { name: "partini", re: /\b(?:(pagi|siang|sore|malam)\s+ini|nanti\s+(pagi|siang|sore|malam))\b/i, norm: () => "hari ini", partOf: (m) => m[1] || m[2] },
  { name: "dow", re: new RegExp(`\\b(?:hari\\s+)?(${DOW_RE})(?:\\s+(depan|ini))?(?:\\s+(pagi|siang|sore|malam))?\\b|\\bhari\\s+(minggu)(?:\\s+(depan|ini))?(?:\\s+(pagi|siang|sore|malam))?\\b|\\b(ahad)\\b`, "i"), dow: true }
];
const TIME_RE = /\b(?:(?:jam|pukul|pkl\.?)\s*(\d{1,2})(?!\d)(?:[:.](\d{2})(?!\d))?|(\d{1,2})[:.](\d{2})(?!\d))(?:\s*(pagi|siang|sore|malam))?(?:\s*(wib|wita|wit)\b)?(?:\s*(?:-|–|—|s\.?\s?d\.?|sampai|hingga)\s*(?:(?:(?:jam|pukul)\s*)?(\d{1,2})(?:[:.](\d{2}))?|selesai)(?:\s*(wib|wita|wit)\b)?)?/i;
const TZ_OF = { wib: "Asia/Jakarta", wita: "Asia/Makassar", wit: "Asia/Jayapura" };
const REPEAT_RE = new RegExp(`\\b(?:tiap|setiap)\\s+(hari|${DOW_RE}|ahad|(?:tanggal|tgl\\.?)\\s*\\d{1,2})\\b`, "i");
const LEAD_IN = /(?:\b(?:pada|hari|tanggal|tgl\.?|pukul|jam|pkl\.?|senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|ahad)\s+)+$/i;
const TRAIL_TZ = /^\s*(?:wib|wita|wit)\b/i;

const monthIdx = (w) => MONTH_KEYS.indexOf(String(w).toLowerCase().slice(0, 3));
const dowIdx = (w) => {
  const k = String(w).toLowerCase().replace("'", "");
  return { minggu: 0, ahad: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 }[k];
};

/** Pilih hasil pola tanggal: tanggal eksplisit lebih diutamakan daripada "besok"/nama hari. */
function findDate(s) {
  for (const group of [true, false]) {
    let best = null;
    for (const p of DATE_PATTERNS) {
      if (Boolean(p.explicit) !== group) continue;
      const m = p.re.exec(s);
      if (m && (!best || m.index < best.m.index)) best = { p, m };
    }
    if (best) return best;
  }
  return null;
}

/** Awal pekan (Senin) untuk tanggal lokal -> ms hari itu 00:00 (dipakai membedakan "senin depan"). */
function weekStartKey(y, m, d) {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return Date.UTC(y, m - 1, d - ((dow + 6) % 7));
}

/**
 * Cari waktu di dalam kalimat bebas.
 * -> { ok:true, startMs, repeat, allDay, title, endText } | { ok:false, error, found? } (found=false: tidak ada tanggal sama sekali)
 */
export function extractWhen(input, { now = Date.now(), timeZone = "Asia/Jakarta", allDayClock = "00:00" } = {}) {
  const src = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!src) return { ok: false, error: "kosong", found: false };
  const today = tzParts(now, timeZone);
  const spans = []; // [start, end) bagian yang dibuang dari judul
  let phrase = null;
  let repeatMode = false;
  let daypart = "";
  let wantNextWeek = false;

  const rep = REPEAT_RE.exec(src);
  if (rep) {
    repeatMode = true;
    spans.push([rep.index, rep.index + rep[0].length]);
    phrase = `tiap ${rep[1].replace(/\s+/g, " ")}`;
  } else {
    const hit = findDate(src);
    if (!hit) return { ok: false, error: "Tanggalnya belum terbaca.", found: false };
    const { p, m } = hit;
    spans.push([m.index, m.index + m[0].length]);
    if (p.dayOnly) {
      const d = Number(m[1]);
      let mo = today.m;
      let y = today.y;
      if (d < today.d) {
        mo += 1;
        if (mo > 12) {
          mo = 1;
          y += 1;
        }
      }
      phrase = `${y}-${pad2(mo)}-${pad2(d)}`;
    } else if (p.dow) {
      const name = m[1] || (m[4] ? "minggu" : "ahad");
      const mod = (m[2] || m[5] || "").toLowerCase();
      daypart = (m[3] || m[6] || "").toLowerCase();
      phrase = name.toLowerCase() === "ahad" ? "minggu" : name;
      wantNextWeek = mod === "depan";
    } else {
      phrase = p.norm(m);
      if (p.part) daypart = (m[p.part] || "").toLowerCase();
      if (p.partOf) daypart = String(p.partOf(m) || "").toLowerCase();
    }
  }

  // jam
  const tm = TIME_RE.exec(src);
  let h = null;
  let mi = 0;
  let endText = "";
  let tzWord = "";
  if (tm) {
    spans.push([tm.index, tm.index + tm[0].length]);
    h = Number(tm[1] ?? tm[3]);
    mi = Number(tm[2] ?? tm[4] ?? 0);
    const part = (tm[5] || daypart || "").toLowerCase();
    if (h > 23 || mi > 59) return { ok: false, error: "Jamnya tidak valid (jam 0-23, menit 0-59).", found: true };
    if (part === "sore" || part === "malam") {
      if (h < 12) h += 12;
    } else if (part === "siang") {
      if (h >= 1 && h <= 5) h += 12;
    } else if (!part && h >= 1 && h <= 6) h += 12; // kantor: "jam 2" = 14.00
    tzWord = String(tm[6] || tm[9] || "").toLowerCase();
    if (tm[7] !== undefined) {
      let eh = Number(tm[7]);
      const emi = Number(tm[8] ?? 0);
      if (eh >= 1 && eh <= 6 && h >= 12) eh += 12;
      endText = hhmm(eh % 24, emi);
    }
  } else if (daypart) {
    const dp = { pagi: [7, 0], siang: [12, 0], sore: [16, 0], malam: [20, 0] }[daypart];
    [h, mi] = dp;
  }
  const allDay = h === null;
  const clock = allDay ? allDayClock : hhmm(h, mi);

  const parsed = parseReminder(`${phrase} ${clock} x`, { now, timeZone });
  if (!parsed.ok) return { ok: false, error: parsed.error, found: true };
  let startMs = parsed.dueMs;
  if (!repeatMode && wantNextWeek) {
    const a = tzParts(startMs, timeZone);
    if (weekStartKey(a.y, a.m, a.d) === weekStartKey(today.y, today.m, today.d)) startMs = zonedToUtc(a.y, a.m, a.d + 7, a.h, a.mi, timeZone);
  }
  const repeat = repeatMode ? parsed.repeat : null;
  // "17.00 WITA" padahal zona bot WIB: jam dinding dibaca di zona yang ditulis (jadwal repeat & seharian tidak dikonversi)
  let eventTz;
  const msgTz = TZ_OF[tzWord];
  if (msgTz && msgTz !== timeZone && !repeatMode && !allDay) {
    const q = tzParts(startMs, timeZone);
    startMs = zonedToUtc(q.y, q.m, q.d, q.h, q.mi, msgTz);
    if (startMs <= now) return { ok: false, error: "Waktu itu sudah lewat.", found: true };
    eventTz = msgTz;
  }

  // judul = kalimat tanpa bagian waktu
  const merged = spans.sort((a, b) => a[0] - b[0]);
  let title = "";
  let pos = 0;
  for (const [a0, b0] of merged) {
    if (a0 < pos) continue;
    let a = a0;
    let b = b0;
    const before = src.slice(pos, a);
    const lead = LEAD_IN.exec(before);
    if (lead) a = pos + lead.index;
    const tz = TRAIL_TZ.exec(src.slice(b));
    if (tz) b += tz[0].length;
    title += src.slice(pos, a) + " ";
    pos = b;
  }
  title += src.slice(pos);
  title = cleanTitle(title);
  return { ok: true, startMs, repeat, allDay, title: title || "Kegiatan", endText, tz: eventTz, found: true };
}

// ---------------------------------------------------------------- pengumuman berformat ("Tempat: ... / Hari/Tanggal: ... / Waktu: ...")
const field = (labels) => new RegExp(`^[^\\p{L}\\p{N}\\n]*(?:${labels})\\s*[:：]\\s*(.+)$`, "imu");
const F_DATE = field("hari\\s*\\/\\s*tanggal|hari\\s*,?\\s*tanggal|tanggal|tgl|hari");
const F_TIME = field("waktu|jam|pukul|pkl");
const F_PLACE = field("tempat|lokasi(?:\\s+acara)?|venue");
const F_WHAT = field("acara|agenda|kegiatan|perihal|topik|tema");
const stripEmoji = (t) => String(t ?? "").replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, " ").replace(/\s+/g, " ").trim();
function sentenceCase(t) {
  const s = String(t).trim();
  const letters = s.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  const base = letters.length >= 4 && upper / letters.length > 0.6 ? s.toLowerCase() : s;
  return base ? base[0].toUpperCase() + base.slice(1) : base;
}
function announcementTitle(raw, what, place) {
  let t = stripEmoji(what || "");
  if (!t) {
    const m = /\b(?:acara|kegiatan)\s+([^.!?\n]{3,90})/i.exec(stripEmoji(raw));
    t = m ? m[1] : "";
  }
  if (!t) {
    const line = raw.split(/\n/).map(stripEmoji).find((l) => EVENT_WORDS.test(l) && l.length >= 4 && l.length <= 90);
    t = line || raw.split(/\n/).map(stripEmoji).find((l) => l.length >= 4) || "";
  }
  t = sentenceCase(t.replace(/^(?:yuk|ayo|mari|ayuk)[,\s]+/i, "").replace(/\s*[!.]+$/, "")).slice(0, 90);
  const where = stripEmoji(place || "").slice(0, 60);
  return where ? `${t || "Kegiatan"} — ${where}` : t;
}

/**
 * Pengumuman berlabel (Hari/Tanggal + Waktu, boleh multi-baris, banyak emoji) -> sama seperti extractWhen, atau null bila bukan format itu.
 */
export function extractAnnouncement(raw, opts = {}) {
  const text = String(raw ?? "");
  const d = F_DATE.exec(text)?.[1];
  const tm = F_TIME.exec(text)?.[1];
  if (!d || !tm) return null;
  const w = extractWhen(`${stripEmoji(d)} ${stripEmoji(tm)}`, opts);
  if (!w.ok) return w;
  const title = announcementTitle(text, F_WHAT.exec(text)?.[1], F_PLACE.exec(text)?.[1]);
  return { ...w, title: title || w.title };
}

/** Pengumuman berlabel bila cocok, selain itu kalimat bebas. */
export function extractSchedule(raw, opts = {}) {
  return extractAnnouncement(raw, opts) ?? extractWhen(raw, opts);
}

export function cleanTitle(t) {
  let s = String(t ?? "").replace(/\s+/g, " ").trim();
  s = s
    .replace(/^(?:tolong\s+|mohon\s+|bisa\s+|coba\s+)?(?:bot[,\s]+)?(?:catat(?:kan)?|catet(?:in)?|tambah(?:kan|in)?|buat(?:kan)?|simpan(?:kan)?|masukkan|jadwalkan|agendakan|daftarkan|input(?:kan)?)\s+(?:ke\s+)?(?:jadwal|agenda)?\s*(?:baru)?\s*[:,\-–]?\s*/i, "")
    .replace(/^(?:jadwal|agenda)\s*[:,\-–]?\s*/i, "")
    .replace(/\b(?:ya+|yah|dong|deh|nih|ya\s+teman-teman|teman-teman|rekan-rekan|bapak\s*\/\s*ibu|bapak\s+ibu|mohon\s+hadir|harap\s+hadir)[\s.!]*$/i, "")
    .replace(/\b(?:pada|di\s+hari|hari|tanggal|pukul|jam|pkl)\s*$/i, "")
    .replace(/^(?:pada|di|hari|tanggal|akan\s+ada|ada|akan\s+diadakan|diadakan)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:\-–—.]+|[\s,;:\-–—]+$/g, "")
    .trim();
  if (s.length > MAX_TITLE_CHARS) s = `${s.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

// ---------------------------------------------------------------- mengenali perintah
const EVENT_WORDS =
  /\b(rapat|rakor|raker|apel|upacara|pelatihan|diklat|bimtek|workshop|sosialisasi|zoom|webinar|seminar|koordinasi|evaluasi|monev|kunjungan|senam|pengajian|arisan|sidang|audit|visitasi|undangan|acara|kegiatan|briefing|ujian|pertemuan|konsultasi|fgd|outing|halal bihalal|lelang|penandatanganan|peresmian|pembinaan|supervisi|asistensi|survei|survey|presentasi|pemaparan|wawancara|musrenbang|gathering|pendampingan|lokakarya)\b/i;
const NEGATION = /\b(batal|dibatalkan|membatalkan|ditunda|diundur|dimajukan|tidak jadi|nggak jadi|gak jadi|libur|ditiadakan|cancel)\b/i;
const QUESTION = /\?|^\s*(apa|apakah|kapan|siapa|bagaimana|gimana|kenapa|mengapa|dimana|di mana|berapa|bisa|boleh|jadi)\b/i;
const AFFIRM = /^\s*(?:ya+|iya+|yap|yoi|yes|y|ok(?:e|ay)?|siap|boleh|setuju|betul|benar|catat(?:kan)?|simpan|tolong\s+catat|silakan|sip|mantap)\b/i;
const NEGATIVE = /^\s*(?:tidak|nggak|enggak|gak|ga|jangan|batal|skip|no|nope|tak)\b/i;

const Q_FOLLOW = new RegExp(
  `\\b(?:jadwal|agenda)\\s+(?:apa|kita|kami|kantor|grup|ini|besok|lusa|kemarin|hari\\s+(?:ini|${DOW_RE}|minggu|ahad)|(?:minggu|pekan|bulan)\\s+(?:ini|depan)|${DOW_RE}|ahad|tanggal|\\d{1,2}\\s+(?:${MONTH_RE})|\\d{1,2}\\/\\d{1,2}|mendatang|selanjutnya|berikutnya|terdekat|rapat|kegiatan|acara|pagi|siang|sore|malam)\\b`,
  "i"
);
const Q_ADA = /\b(?:ada|punya|ada\s+lagi)\s+(?:jadwal|agenda|acara|kegiatan|rapat)\b/i;
const Q_NOT = /\b(sholat|salat|shalat|imsakiyah|kereta|pesawat|penerbangan|bus|bioskop|film|tv|televisi|bola|liga|pertandingan|ujian nasional|libur nasional|kajian|tarawih|misa|ibadah|cuaca|haji|umrah|pemilu|cpns|sekolah|kuliah|kelas|imunisasi|posyandu|vaksin|dokter|praktek|praktik|operasi)\b/i;
const HOWTO = /\b(apa itu|pengertian|definisi|arti|maksud|cara|bagaimana|gimana|template|contoh|format|susun|rancang|usul(?:kan)?|saran|bikin(?:kan)?|buatkan|tuliskan)\b/i;

const ADD_VERB = /^\s*(?:tolong\s+|mohon\s+|bisa\s+|coba\s+)?(?:bot[,\s]+)?(catat(?:kan)?|catet(?:in)?|tambah(?:kan|in)?|buat(?:kan)?|simpan(?:kan)?|masukkan|jadwalkan|agendakan|daftarkan|input(?:kan)?)\b/i;

/**
 * Teks pesan (sudah tanpa panggilan bot) -> perintah agenda atau null (biarkan ke AI).
 * ctx: { quotedText, offerKey, hasPendingOffer }
 */
export function parseAgendaCommand(text, ctx = {}) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (ctx.hasPendingOffer && ctx.offerKey) {
    if (NEGATIVE.test(t)) return { kind: "offer_no", key: ctx.offerKey };
    if (AFFIRM.test(t) && t.length <= 40) return { kind: "offer_yes", key: ctx.offerKey };
  }
  if (/^(?:bantuan|help|cara\s+pakai|petunjuk)\s+(?:jadwal|agenda)\b/i.test(t) || /^(?:jadwal|agenda)\s+(?:bantuan|help)\b/i.test(t)) return { kind: "help" };

  let m = /^\s*(?:tolong\s+)?(?:hapus(?:kan)?|batalkan|batal|cancel|buang|hilangkan)\s+(?:jadwal|agenda|acara|kegiatan)\s*(?:nomor|no\.?|#)?\s*(\d+)\s*$/i.exec(t);
  if (m) return { kind: "delete", id: Number(m[1]) };
  m = /^\s*(?:tolong\s+)?(?:pindah(?:kan)?|ubah|ganti|undur(?:kan)?|majukan|reschedule|revisi)\s+(?:jadwal|agenda|acara|kegiatan)\s*(?:nomor|no\.?|#)?\s*(\d+)\s*(?:jadi|menjadi|ke|untuk)?\s*(.+)$/i.exec(t);
  if (m) return { kind: "move", id: Number(m[1]), body: m[2].trim() };

  const av = ADD_VERB.exec(t);
  if (av) {
    const verb = av[1].toLowerCase();
    const rest = t.slice(av[0].length).trim();
    const hasWord = /\b(jadwal|agenda|acara|kegiatan)\b/i.test(rest);
    const strong = /^(?:catat|catatkan|catet|catetin|jadwalkan|agendakan|daftarkan|simpan|simpankan|masukkan|input)/.test(verb);
    // "catat ini" dengan mengutip pesan jadwal
    if (ctx.quotedText && /^(?:ini|itu|pesan\s+(?:ini|itu)|di\s+atas)?\s*(?:sebagai\s+|ke\s+)?(?:jadwal|agenda)?\s*(?:ya|dong|aja|saja)?$/i.test(rest) && strong) return { kind: "add_quoted", body: ctx.quotedText };
    const when = extractWhen(rest);
    if (when.found !== false) {
      if (strong || hasWord) return { kind: "add", body: rest };
    } else if (hasWord && strong && !HOWTO.test(rest)) {
      return { kind: "add", body: rest }; // tanggal tidak ada: dijawab dengan petunjuk
    }
    return null; // "buatkan jadwal piket" tanpa tanggal = permintaan ke AI
  }

  // pertanyaan
  const lower = t.toLowerCase();
  const asks = Q_FOLLOW.test(lower) || Q_ADA.test(lower) || /^(?:jadwal|agenda)\??$/.test(lower);
  if (asks && !Q_NOT.test(lower) && !HOWTO.test(lower) && !ADD_VERB.test(lower)) return { kind: "query", ...queryRange(lower) };
  return null;
}

function queryRange(lower) {
  if (/\bkemarin\b/.test(lower)) return { range: "day", offset: -1 };
  if (/\bbesok\b/.test(lower)) return { range: "day", offset: 1 };
  if (/\blusa\b/.test(lower)) return { range: "day", offset: 2 };
  if (/\b(minggu|pekan)\s+depan\b/.test(lower)) return { range: "nextweek" };
  if (/\b(minggu|pekan)\s+ini\b/.test(lower)) return { range: "week" };
  if (/\bbulan\s+depan\b/.test(lower)) return { range: "nextmonth" };
  if (/\bbulan\s+ini\b/.test(lower)) return { range: "month" };
  if (/\b(hari\s+ini|pagi\s+ini|siang\s+ini|sore\s+ini|malam\s+ini|sekarang)\b/.test(lower)) return { range: "day", offset: 0 };
  if (/\b(mendatang|selanjutnya|berikutnya|terdekat|akan\s+datang|ke\s+depan)\b/.test(lower)) return { range: "upcoming" };
  const hit = findDate(lower);
  if (hit && !hit.p.dayOnly) return { range: "date", dateText: lower };
  if (hit && hit.p.dayOnly) return { range: "date", dateText: lower };
  return { range: "upcoming" };
}

// ---------------------------------------------------------------- tawaran dari obrolan
/**
 * Kalimat biasa di grup -> { ev } bila tampak jelas seperti pengumuman jadwal (acara + tanggal + jam), selain itu null.
 * Sengaja ketat: lebih baik terlewat daripada mengganggu grup.
 */
export function detectScheduleMention(text, { now = Date.now(), timeZone = "Asia/Jakarta" } = {}) {
  const raw = String(text ?? "");
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 15 || t.length > 2000 || /^[/!.]/.test(t)) return null;
  if (/^(?:bot|ayyubi|wongsobot)\b/i.test(t)) return null;
  if (NEGATION.test(t)) return null;
  // pengumuman berlabel (Tempat / Hari-Tanggal / Waktu): boleh panjang dan banyak tanda tanya/emoji
  if (t.length > 120 && F_DATE.test(raw) && F_TIME.test(raw)) {
    if (!EVENT_WORDS.test(t)) return null;
    const a = extractAnnouncement(raw, { now, timeZone });
    return a && a.ok && !a.allDay && !a.repeat ? { ...a } : null;
  }
  if (t.length > 400 || QUESTION.test(t)) return null;
  if (!EVENT_WORDS.test(t)) return null;
  if (!TIME_RE.test(t)) return null; // harus ada jam yang jelas
  const w = extractWhen(t, { now, timeZone });
  if (!w.ok || w.allDay || w.title.length < 4) return null;
  return { ...w };
}

// ---------------------------------------------------------------- penyimpanan
export async function openAgendaStore({ file, maxPerGroup = 200, log = console, now = () => Date.now() } = {}) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (e) {
    log.warn?.(`📅 Agenda grup tidak aktif: node:sqlite tidak tersedia (${e?.message || e}). Butuh Node 22+.`);
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
  db.exec(
    "CREATE TABLE IF NOT EXISTS agenda_events (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL DEFAULT 'main', group_jid TEXT NOT NULL, group_name TEXT, title TEXT NOT NULL, start_ms INTEGER NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, repeat TEXT, created_by TEXT, created_ms INTEGER NOT NULL, pre_ms INTEGER NOT NULL DEFAULT 0)"
  );
  try {
    db.exec("ALTER TABLE agenda_events ADD COLUMN tz TEXT");
  } catch {
    /* kolom sudah ada */
  }
  db.exec("CREATE INDEX IF NOT EXISTS agenda_group ON agenda_events (group_jid, start_ms)");
  db.exec("CREATE TABLE IF NOT EXISTS agenda_kv (k TEXT PRIMARY KEY, v TEXT)");
  const limit = Math.max(1, Math.floor(Number(maxPerGroup) || 200));
  const toRow = (r) => ({
    id: Number(r.id),
    account: r.account,
    groupJid: r.group_jid,
    groupName: r.group_name || "",
    title: r.title,
    startMs: Number(r.start_ms),
    allDay: Number(r.all_day) === 1,
    repeat: r.repeat ? JSON.parse(r.repeat) : null,
    createdBy: r.created_by || "",
    createdMs: Number(r.created_ms),
    preMs: Number(r.pre_ms),
    tz: r.tz || ""
  });
  return {
    limit,
    listGroup: (jid) => db.prepare("SELECT * FROM agenda_events WHERE group_jid = ? ORDER BY start_ms ASC, id ASC").all(jid).map(toRow),
    listAll: () => db.prepare("SELECT * FROM agenda_events ORDER BY group_jid, start_ms ASC, id ASC").all().map(toRow),
    get: (id) => {
      const r = db.prepare("SELECT * FROM agenda_events WHERE id = ?").get(id);
      return r ? toRow(r) : null;
    },
    add({ account = "main", groupJid, groupName = "", title, startMs, allDay = false, repeat = null, createdBy = "", tz = "" }) {
      const rows = this.listGroup(groupJid);
      if (rows.length >= limit) return { ok: false, reason: "full" };
      const dup = rows.find((r) => r.startMs === startMs && r.title.toLowerCase() === title.toLowerCase());
      if (dup) return { ok: false, reason: "duplicate", id: dup.id };
      const info = db
        .prepare("INSERT INTO agenda_events (account, group_jid, group_name, title, start_ms, all_day, repeat, created_by, created_ms, tz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(account, groupJid, groupName, title, startMs, allDay ? 1 : 0, repeat ? JSON.stringify(repeat) : null, createdBy, now(), tz || null);
      return { ok: true, id: Number(info.lastInsertRowid) };
    },
    update(id, { startMs, allDay, repeat, tz = "" }) {
      db.prepare("UPDATE agenda_events SET start_ms = ?, all_day = ?, repeat = ?, tz = ?, pre_ms = 0 WHERE id = ?").run(startMs, allDay ? 1 : 0, repeat ? JSON.stringify(repeat) : null, tz || null, id);
    },
    remove(id, groupJid) {
      const row = this.get(id);
      if (!row || row.groupJid !== groupJid) return null;
      db.prepare("DELETE FROM agenda_events WHERE id = ?").run(id);
      return row;
    },
    setPre: (id, ms) => void db.prepare("UPDATE agenda_events SET pre_ms = ? WHERE id = ?").run(ms, id),
    groups: () => db.prepare("SELECT DISTINCT account, group_jid, group_name FROM agenda_events").all().map((r) => ({ account: r.account, groupJid: r.group_jid, groupName: r.group_name || "" })),
    purge(nowMs) {
      const r = db.prepare("DELETE FROM agenda_events WHERE repeat IS NULL AND start_ms < ?").run(nowMs - 36 * 3600_000);
      return Number(r.changes ?? 0);
    },
    count: () => Number(db.prepare("SELECT COUNT(*) AS n FROM agenda_events").get().n),
    kvGet: (k) => db.prepare("SELECT v FROM agenda_kv WHERE k = ?").get(k)?.v ?? null,
    kvSet: (k, v) => void db.prepare("INSERT INTO agenda_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, String(v)),
    close() {
      try {
        db.close();
      } catch {
        /* sudah tertutup */
      }
    }
  };
}

// ---------------------------------------------------------------- penjadwal + penjawab
/**
 * deps: store, sendGroup(account, groupJid, text) -> Promise (lempar bila gagal), now(), timeZone, tzLabel,
 *       morningTime "07:30", remindBeforeMin (0 = mati), suggest (tawaran dari obrolan), log
 */
export function createAgenda({ store, sendGroup, now = () => Date.now(), timeZone = "Asia/Jakarta", tzLabel = "WIB", morningTime = "07:30", remindBeforeMin = 30, suggest = true, log = console, offerTtlMs = 6 * 3600_000, offerGapMs = 90_000 } = {}) {
  const enabled = Boolean(store);
  const [mh, mm] = (/^(\d{1,2}):(\d{2})$/.exec(String(morningTime).trim()) || [null, "7", "30"]).slice(1).map(Number);
  const morningMin = (mh > 23 || mm > 59 ? 7 : mh) * 60 + (mh > 23 || mm > 59 ? 30 : mm);
  const lead = Math.max(0, Math.floor(Number(remindBeforeMin) || 0));
  const offers = new Map(); // "grup|idPesan" -> { ev, account, groupJid, groupName, at }
  const lastOfferAt = new Map(); // grup -> ms
  let running = false;

  const dayKey = (ms) => {
    const p = tzParts(ms, timeZone);
    return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  };
  const dayStart = (ms, plusDays = 0) => {
    const p = tzParts(ms, timeZone);
    return zonedToUtc(p.y, p.m, p.d + plusDays, 0, 0, timeZone);
  };
  const zoneLabel = (z) => ({ "Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" })[z] || tzLabel;
  const stamp = (ms, z) => {
    const p = tzParts(ms, z || timeZone);
    return `${hhmm(p.h, p.mi)} ${z ? zoneLabel(z) : tzLabel}`;
  };
  const dateLabel = (ms, z) => {
    const p = tzParts(ms, z || timeZone);
    return `${DAY_NAMES[p.dow]}, ${p.d} ${MONTH_SHORT[p.m - 1]} ${p.y}`;
  };
  const clock = (ms) => {
    const p = tzParts(ms, timeZone);
    return hhmm(p.h, p.mi);
  };

  /** Kejadian (termasuk yang berulang) dalam [fromMs, toMs). */
  function occurrences(events, fromMs, toMs) {
    const out = [];
    for (const ev of events) {
      if (ev.repeat) {
        let t = nextOccurrence(ev.repeat, fromMs - 1, timeZone);
        for (let g = 0; t !== null && t < toMs && g < 60; g++) {
          out.push({ ev, startMs: t });
          t = nextOccurrence(ev.repeat, t, timeZone);
        }
      } else if (ev.startMs >= fromMs && ev.startMs < toMs) out.push({ ev, startMs: ev.startMs });
    }
    return out.sort((a, b) => a.startMs - b.startMs || a.ev.id - b.ev.id);
  }

  const line = (o) => {
    const when = o.ev.allDay ? "Seharian" : o.ev.tz ? stamp(o.startMs, o.ev.tz) : clock(o.startMs);
    return `• ${when} — ${o.ev.title}${o.ev.repeat ? " 🔁" : ""} _(#${o.ev.id})_`;
  };
  function renderList(occ, { perDay = false, max = 25 } = {}) {
    const shown = occ.slice(0, max);
    const lines = [];
    let lastDay = "";
    for (const o of shown) {
      if (perDay) {
        const k = dayKey(o.startMs);
        if (k !== lastDay) {
          lines.push(`${lines.length ? "\n" : ""}*${dateLabel(o.startMs)}*`);
          lastDay = k;
        }
      }
      lines.push(line(o));
    }
    if (occ.length > shown.length) lines.push(`…dan ${occ.length - shown.length} jadwal lain`);
    return lines.join("\n");
  }

  const confirmText = (id, w, who = "") =>
    [
      `✅ Jadwal dicatat (#${id})${who ? ` — disetujui ${who}` : ""}`,
      `*${w.title}*`,
      w.repeat ? `🔁 ${describeRepeat(w.repeat)} ${tzLabel}` : `🗓 ${dateLabel(w.startMs, w.tz)}${w.allDay ? " • seharian" : ` • ${stamp(w.startMs, w.tz)}${w.endText ? ` s.d. ${w.endText}` : ""}`}`,
      w.allDay ? "Jam tidak disebut, jadi dicatat sebagai acara seharian (tanpa pengingat jam)." : lead > 0 ? `Saya ingatkan ${lead} menit sebelumnya, dan masuk rekap pagi (${hhmm(Math.floor(morningMin / 60), morningMin % 60)}).` : `Masuk rekap pagi (${hhmm(Math.floor(morningMin / 60), morningMin % 60)}).`,
      `Salah? Balas: bot, hapus jadwal ${id}  •  bot, pindah jadwal ${id} ke jumat jam 13.00`
    ].join("\n");

  const usage = () =>
    [
      "📅 *Jadwal kantor di grup*",
      "• Catat: bot, catat rapat evaluasi Kamis 22 Oktober jam 10.00 di ruang rapat",
      "• Berulang: bot, jadwalkan apel tiap senin jam 07.30",
      "• Dari pesan: balas (reply) pesan jadwalnya dengan \"bot, catat ini\"",
      "• Tanya: bot, ada jadwal apa hari ini? • jadwal besok • agenda minggu ini • jadwal kamis • jadwal berikutnya",
      "• Ubah: bot, hapus jadwal 5 • bot, pindah jadwal 5 ke jumat jam 13.00",
      `Pagi hari (${hhmm(Math.floor(morningMin / 60), morningMin % 60)} ${tzLabel}) bot merekap jadwal hari itu${lead > 0 ? `, dan mengingatkan ${lead} menit sebelum acara` : ""}.`,
      'Jam tidak disebut = acara seharian. "jam 2" tanpa keterangan dianggap 14.00.'
    ].join("\n");

  function addEvent(w, ctx, who = "") {
    const r = store.add({ account: ctx.account, groupJid: ctx.groupJid, groupName: ctx.groupName, title: w.title, startMs: w.startMs, allDay: w.allDay, repeat: w.repeat, createdBy: ctx.sender || "", tz: w.tz || "" });
    if (!r.ok) {
      if (r.reason === "full") return `Jadwal di grup ini sudah penuh (maks ${store.limit}). Hapus yang sudah tidak dipakai dulu: bot, hapus jadwal <nomor>.`;
      return `Jadwal yang sama sudah tercatat (#${r.id}).`;
    }
    return confirmText(r.id, w, who);
  }

  /** Jawab satu perintah. ctx: { account, groupJid, groupName, sender } -> teks balasan */
  async function handle(cmd, ctx) {
    if (!enabled) return null;
    const t0 = now();
    const opts = { now: t0, timeZone };
    switch (cmd.kind) {
      case "help":
        return usage();
      case "add":
      case "add_quoted": {
        const w = extractSchedule(cmd.body, opts);
        if (!w.ok) {
          if (w.found === false) return `Tanggalnya belum terbaca. Contoh: bot, catat rapat evaluasi Kamis 22 Oktober jam 10.00\n(${"hari ini/besok/lusa, nama hari, atau tanggal 22 Oktober"})`;
          return `${w.error}\nContoh: bot, catat rapat evaluasi besok jam 10.00`;
        }
        return addEvent(w, ctx);
      }
      case "offer_yes": {
        const o = offers.get(cmd.key);
        if (!o) return null;
        offers.delete(cmd.key);
        if (now() - o.at > offerTtlMs) return "Tawaran itu sudah kedaluwarsa. Catat langsung saja: bot, catat <acara> <hari> jam <jam>.";
        // hitung ulang bila tawaran sudah lewat waktunya
        if (!o.ev.repeat && o.ev.startMs < t0) return "Waktu acaranya sudah lewat, jadi tidak saya catat.";
        return addEvent(o.ev, { ...ctx, account: o.account, groupJid: o.groupJid, groupName: o.groupName || ctx.groupName }, ctx.sender || "");
      }
      case "offer_no":
        offers.delete(cmd.key);
        return "Baik, tidak saya catat.";
      case "delete": {
        const row = store.remove(cmd.id, ctx.groupJid);
        if (!row) return `Jadwal #${cmd.id} tidak ditemukan di grup ini. Lihat nomornya: bot, jadwal berikutnya`;
        return `🗑 Jadwal #${row.id} dihapus: ${row.title}${row.repeat ? ` (${describeRepeat(row.repeat)})` : row.allDay ? ` (${dateLabel(row.startMs)})` : ` (${dateLabel(row.startMs, row.tz)} ${stamp(row.startMs, row.tz)})`}`;
      }
      case "move": {
        const row = store.get(cmd.id);
        if (!row || row.groupJid !== ctx.groupJid) return `Jadwal #${cmd.id} tidak ditemukan di grup ini.`;
        const w = extractWhen(`x ${cmd.body}`, opts);
        if (!w.ok) return w.found === false ? "Waktu barunya belum terbaca. Contoh: bot, pindah jadwal 5 ke jumat jam 13.00" : w.error;
        store.update(row.id, { startMs: w.startMs, allDay: w.allDay, repeat: w.repeat, tz: w.tz || "" });
        return `✏️ Jadwal #${row.id} dipindah.\n*${row.title}*\n${w.repeat ? `🔁 ${describeRepeat(w.repeat)} ${tzLabel}` : `🗓 ${dateLabel(w.startMs, w.tz)}${w.allDay ? " • seharian" : ` • ${stamp(w.startMs, w.tz)}`}`}`;
      }
      case "query":
        return answerQuery(cmd, ctx, t0);
      default:
        return null;
    }
  }

  function answerQuery(cmd, ctx, t0) {
    const events = store.listGroup(ctx.groupJid);
    const today = dayStart(t0);
    let from = today;
    let to = dayStart(t0, 1);
    let title = "hari ini";
    let perDay = false;
    switch (cmd.range) {
      case "day":
        from = dayStart(t0, cmd.offset);
        to = dayStart(t0, cmd.offset + 1);
        title = cmd.offset === 0 ? "hari ini" : cmd.offset === 1 ? "besok" : cmd.offset === -1 ? "kemarin" : "lusa";
        break;
      case "date": {
        const w = extractWhen(`x ${cmd.dateText}`, { now: t0, timeZone, allDayClock: "23:59" });
        if (!w.ok) return "Tanggalnya belum terbaca atau sudah lewat. Contoh: bot, jadwal kamis • bot, jadwal 22 oktober";
        from = dayStart(w.startMs);
        to = dayStart(w.startMs, 1);
        title = dateLabel(w.startMs);
        break;
      }
      case "week": {
        const p = tzParts(t0, timeZone);
        const back = (p.dow + 6) % 7;
        from = today;
        to = dayStart(t0, 7 - back);
        title = "minggu ini";
        perDay = true;
        break;
      }
      case "nextweek": {
        const p = tzParts(t0, timeZone);
        const back = (p.dow + 6) % 7;
        from = dayStart(t0, 7 - back);
        to = dayStart(t0, 14 - back);
        title = "minggu depan";
        perDay = true;
        break;
      }
      case "month": {
        const p = tzParts(t0, timeZone);
        to = zonedToUtc(p.y, p.m + 1, 1, 0, 0, timeZone);
        title = "bulan ini";
        perDay = true;
        break;
      }
      case "nextmonth": {
        const p = tzParts(t0, timeZone);
        from = zonedToUtc(p.y, p.m + 1, 1, 0, 0, timeZone);
        to = zonedToUtc(p.y, p.m + 2, 1, 0, 0, timeZone);
        title = "bulan depan";
        perDay = true;
        break;
      }
      default: {
        // upcoming: 14 hari ke depan, mulai sekarang
        from = t0 - 1;
        to = dayStart(t0, 14);
        title = "yang akan datang (14 hari)";
        perDay = true;
        break;
      }
    }
    let occ = occurrences(events, from, to);
    if (cmd.range === "upcoming") occ = occ.filter((o) => o.ev.allDay || o.startMs >= t0 - 5 * 60_000).slice(0, 15);
    if (!occ.length) {
      const none = events.length ? `Tidak ada jadwal ${title} di grup ini.` : `Belum ada jadwal yang tercatat di grup ini.`;
      return `📅 ${none}\nCatat dengan: bot, catat rapat evaluasi Kamis jam 10.00`;
    }
    const head = cmd.range === "day" || cmd.range === "date" ? `📅 *Jadwal ${title}* — ${dateLabel(from)}` : `📅 *Jadwal ${title}*`;
    return `${head}\n${renderList(occ, { perDay })}`;
  }

  // ---- tawaran dari obrolan
  /** Pesan biasa di grup -> { text, key? } tawaran, atau null. Pemanggil mengirim teksnya lalu memanggil rememberOffer(). */
  function buildOffer(text, ctx) {
    if (!enabled || !suggest) return null;
    const t0 = now();
    if (t0 - (lastOfferAt.get(ctx.groupJid) || 0) < offerGapMs) return null;
    const ev = detectScheduleMention(text, { now: t0, timeZone });
    if (!ev || ev.repeat) return null;
    const dup = store.listGroup(ctx.groupJid).find((r) => r.startMs === ev.startMs && (r.title.toLowerCase() === ev.title.toLowerCase() || r.title.toLowerCase().includes(ev.title.toLowerCase().slice(0, 12))));
    if (dup) return null;
    for (const [k, o] of offers) if (t0 - o.at > offerTtlMs) offers.delete(k);
    if (offers.size >= 50) return null;
    lastOfferAt.set(ctx.groupJid, t0);
    return {
      ev,
      text: `📅 Mau saya catat sebagai jadwal?\n*${ev.title}*\n🗓 ${dateLabel(ev.startMs, ev.tz)} • ${stamp(ev.startMs, ev.tz)}${ev.endText ? ` s.d. ${ev.endText}` : ""}\nBalas pesan ini dengan *ya* untuk mencatat (saya ingatkan sebelum acara), atau abaikan saja.`
    };
  }
  /** Murah & tanpa efek samping: layak dipertimbangkan sebagai tawaran? (dipakai sebelum cek jaringan/DB) */
  const mightOffer = (text) => enabled && suggest && detectScheduleMention(text, { now: now(), timeZone }) !== null;
  const rememberOffer = (key, ev, ctx) => void offers.set(key, { ev, account: ctx.account, groupJid: ctx.groupJid, groupName: ctx.groupName, at: now() });
  const hasOffer = (key) => offers.has(key);

  // ---- pengingat terjadwal (dipanggil tiap menit)
  async function check() {
    if (!enabled || running) return;
    running = true;
    try {
      const t0 = now();
      store.purge(t0);
      const p = tzParts(t0, timeZone);
      const minutes = p.h * 60 + p.mi;
      const today = dayKey(t0);
      for (const g of store.groups()) {
        const events = store.listGroup(g.groupJid);
        // rekap pagi: sekali per hari, sejak jamnya sampai tengah hari (bot baru nyala siang tetap mengirim; sore tidak)
        if (minutes >= morningMin && minutes < 13 * 60 && store.kvGet(`morning:${g.groupJid}`) !== today) {
          const occ = occurrences(events, dayStart(t0), dayStart(t0, 1));
          if (occ.length) {
            try {
              await sendGroup(g.account, g.groupJid, `☀️ *Selamat pagi!* Jadwal hari ini — ${dateLabel(t0)}\n${renderList(occ)}`);
              store.kvSet(`morning:${g.groupJid}`, today);
            } catch (e) {
              log.error?.(`📅 Rekap pagi ke ${g.groupName || g.groupJid} gagal: ${e instanceof Error ? e.message : e}`);
            }
          } else store.kvSet(`morning:${g.groupJid}`, today);
        }
        // pengingat sebelum acara
        if (lead > 0) {
          for (const o of occurrences(events, t0, t0 + lead * 60_000 + 1)) {
            if (o.ev.allDay || o.startMs <= t0 || o.ev.preMs === o.startMs) continue;
            const mins = Math.max(1, Math.round((o.startMs - t0) / 60_000));
            try {
              await sendGroup(g.account, g.groupJid, `⏰ *${mins} menit lagi* — ${o.ev.title}\n🕒 ${stamp(o.startMs, o.ev.tz)}`);
              store.setPre(o.ev.id, o.startMs);
            } catch (e) {
              log.error?.(`📅 Pengingat acara #${o.ev.id} gagal: ${e instanceof Error ? e.message : e}`);
            }
          }
        }
      }
    } finally {
      running = false;
    }
  }

  const describe = () => (enabled ? `aktif (${store.count()} jadwal, rekap pagi ${hhmm(Math.floor(morningMin / 60), morningMin % 60)} ${tzLabel}, ingatkan ${lead > 0 ? `${lead} menit sebelum` : "mati"}, tawaran dari obrolan ${suggest ? "ya" : "tidak"})` : "tidak aktif");

  return { enabled, handle, buildOffer, mightOffer, rememberOffer, hasOffer, check, describe, occurrences, usage, parse: (text, ctx = {}) => (enabled ? parseAgendaCommand(text, { ...ctx, hasPendingOffer: ctx.offerKey ? offers.has(ctx.offerKey) : false }) : null) };
}
