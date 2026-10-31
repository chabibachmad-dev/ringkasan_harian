// ================================================================
// Pengelola channel YouTube edukasi (SD kelas 1-6): bikin video papan tulis → minta persetujuan di Telegram →
// unggah ke YouTube dengan jadwal tayang. Semua langkah berat ada di modul lain:
//   edu-bank.js   : bank soal (dihitung program, bukan AI → jawaban pasti benar) + kartu fakta sains
//   edu-board.js  : perakit video papan tulis (ffmpeg) + sampul + bab
//   voice-output.js: suara narasi (Gemini TTS)    youtube.js: unggah terjadwal
// Modul ini hanya mengatur alur, status, jadwal, dan perintah /edu. Semua ketergantungan dapat disuntik (untuk tes).
//
// Alur status item:  awaiting → (setuju) approved → uploading → scheduled
//                    awaiting → rejected (dibuang / dibuat ulang)      approved/uploading → failed (perlu tindakan)
// ================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pickNext, buildMathPlan } from "./edu-bank.js";
import { flattenPlan, wavSeconds, beatSeconds, createBoardRenderer, renderThumbnail, chapterText } from "./edu-board.js";

const flag = (v, d) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? !["false", "0", "off", "no", "tidak", "mati"].includes(s) : d;
};
const num = (v, d, lo = -Infinity, hi = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(hi, Math.max(lo, n)) : d;
};
const hhmm = (v, d) => (/^([01]?\d|2[0-3]):([0-5]\d)$/.test(String(v || "").trim()) ? String(v).trim().replace(/^(\d):/, "0$1:") : d);

function parseMix(v, d) {
  const out = {};
  for (const part of String(v || "").split(",")) {
    const m = /^\s*(math|sains)\s*:\s*(\d{1,2})\s*$/i.exec(part);
    if (m && Number(m[2]) > 0) out[m[1].toLowerCase()] = Number(m[2]);
  }
  return Object.keys(out).length ? out : d;
}

function parseGrades(v, d) {
  const g = [...new Set(String(v || "").split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 6))].sort();
  return g.length ? g : d;
}

export function readEduConfig(env = process.env) {
  const minSec = num(env.EDU_MIN_SEC, 60, 20, 300);
  return {
    enabled: flag(env.EDU_ENABLED, false),
    channelName: String(env.EDU_CHANNEL_NAME || "Belajar Bareng").trim().slice(0, 40),
    renderTime: hhmm(env.EDU_RENDER_TIME, "02:00"), // kapan video baru dibuat tiap hari (jam lokal)
    publishTime: hhmm(env.EDU_PUBLISH_TIME, "16:00"), // jam tayang di YouTube (jam lokal), satu video per hari
    timeZone: String(env.WA_TIMEZONE || "Asia/Makassar").trim(),
    tzLabel: String(env.WA_TIMEZONE_LABEL || "WITA").trim(),
    maxPending: num(env.EDU_MAX_PENDING, 3, 1, 10), // berhenti membuat bila segini draf belum kamu putuskan
    practice: num(env.EDU_PRACTICE, 1, 0, 3), // jumlah soal latihan per video matematika
    grades: parseGrades(env.EDU_GRADES, [1, 2, 3, 4, 5, 6]),
    mix: parseMix(env.EDU_MIX, { math: 2, sains: 1 }),
    voice: String(env.EDU_VOICE || "").trim() || undefined,
    style: String(env.EDU_STYLE || "Ramah, jelas, dan sabar seperti guru SD yang menyenangkan").trim(),
    minSec,
    maxSec: Math.max(minSec + 10, num(env.EDU_MAX_SEC, 120, 30, 600)),
    keepDays: num(env.EDU_KEEP_DAYS, 14, 1, 365),
    maxAttempts: num(env.EDU_MAX_ATTEMPTS, 4, 1, 12), // percobaan membuat per hari bila gagal
    dir: String(env.EDU_DIR || "edu-data").trim(),
    mode: String(env.EDU_MODE || "motion").trim().toLowerCase() === "papan" ? "papan" : "motion" // motion = Short motion graphic (motion/); papan = video papan tulis lama
  };
}

// ---------------------------------------------------------------- waktu (zona IANA tanpa pustaka)
function zonedParts(ms, tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute };
}
export const localDay = (ms, tz) => {
  const p = zonedParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};
export const minutesOfDay = (ms, tz) => {
  const p = zonedParts(ms, tz);
  return p.hh * 60 + p.mm;
};
/** Waktu lokal (y,m,d,hh,mm di zona tz) -> epoch ms. */
export function zonedToMs(y, m, d, hh, mm, tz) {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess -= asUtc - Date.UTC(y, m - 1, d, hh, mm);
  }
  return guess;
}

/**
 * Slot tayang berikutnya: jam `publishTime` lokal, paling cepat `leadMs` dari sekarang, satu video per hari
 * (hari yang sudah dipakai item lain dilewati). `taken` = daftar epoch ms jadwal yang sudah ada.
 */
export function nextPublishAt({ now, publishTime = "16:00", tz = "Asia/Makassar", taken = [], leadMs = 30 * 60_000 }) {
  const [hh, mm] = publishTime.split(":").map(Number);
  const used = new Set(taken.map((t) => localDay(t, tz)));
  const base = zonedParts(now, tz);
  for (let i = 0; i < 90; i++) {
    const day = new Date(Date.UTC(base.y, base.m - 1, base.d + i)); // hari kalender lokal ke-i (aritmetika murni)
    const slot = zonedToMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
    if (slot >= now + leadMs && !used.has(localDay(slot, tz))) return slot;
  }
  return now + 24 * 3600_000;
}

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
function fmtWhen(ms, tz, label) {
  const t = new Intl.DateTimeFormat("id-ID", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return `${t} ${label}`.replace(/\./g, ":");
}

// ---------------------------------------------------------------- deskripsi video
export function buildDescription(plan, { chapters = "", channelName = "" } = {}) {
  const kelas = `Kelas ${plan.grade} SD`;
  const lines = [];
  lines.push(plan.kind === "math" ? `Belajar matematika ${kelas}: ${plan.topic}.` : `Belajar IPA / pengetahuan umum ${kelas}: ${plan.topic}.`);
  lines.push("Disusun dengan bahasa sederhana dan langkah demi langkah. Jeda videonya saat ada soal latihan, kerjakan sendiri dulu, baru cocokkan jawabanmu.");
  if (chapters) lines.push("", chapters);
  lines.push("");
  lines.push("Catatan transparansi: narasi video ini memakai suara sintetis (buatan AI), dan soal serta kunci jawabannya disusun dan dihitung oleh program. Bila kamu menemukan kekeliruan, kabari kami agar segera diperbaiki.");
  if (channelName) lines.push("", `${channelName} — belajar bareng, pelan-pelan, pasti bisa!`);
  lines.push("", (plan.hashtags || []).slice(0, 3).join(" "));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Naskah lengkap (untuk /edu naskah): kalimat yang diucapkan, per adegan. */
export function scriptText(plan) {
  return flattenPlan(plan).map((b, i) => `${i + 1}. ${b.say}`).join("\n");
}

// ---------------------------------------------------------------- pabrik
export function createEdu({
  config = readEduConfig({}),
  speaker = null, // { available(), speakWav(text,{voice,style}) }
  renderer = null, // { render({beats,wavs,outFile,tmpDir}), fonts }
  thumbnail = null, // async ({kelas,title,outFile,tmpDir}) -> outFile
  youtube = null, // createYoutube(...)
  sendText = async () => 0, // (text, { markup }) -> jumlah penerima
  sendFile = async () => 0, // (file {video|photo,data,name,...}, caption) -> jumlah penerima
  loadCards = () => [],
  motion = null, // createMotion(...) dari edu-motion.js; null = selalu papan tulis
  now = () => Date.now(),
  log = console
} = {}) {
  const dir = path.resolve(config.dir);
  const stateFile = path.join(dir, "state.json");
  const ttsDir = path.join(dir, "tts-cache");
  const videoDir = path.join(dir, "video");
  const tmpRoot = path.join(dir, "tmp");
  const tz = config.timeZone;
  const ensure = () => { for (const d of [dir, ttsDir, videoDir, tmpRoot]) fs.mkdirSync(d, { recursive: true }); };

  let st = null;
  function load() {
    if (st) return st;
    ensure();
    try {
      st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") {
        try { fs.renameSync(stateFile, `${stateFile}.rusak-${now()}`); } catch { /* abaikan */ }
        log.error?.(`🎓 [Edu] state.json rusak, dimulai baru: ${e.message}`);
      }
      st = null;
    }
    if (!st || typeof st !== "object") st = {};
    st.items = Array.isArray(st.items) ? st.items : [];
    st.history = Array.isArray(st.history) ? st.history : [];
    st.seq = Number(st.seq) || 0;
    st.paused = !!st.paused;
    st.day = st.day || { date: "", attempts: 0, produced: false, lastAttemptAt: 0, notified: false };
    // proses yang terputus (bot mati saat mengunggah) dianggap belum terunggah
    for (const it of st.items) if (it.status === "uploading") it.status = "approved";
    return st;
  }
  function save() {
    ensure();
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 1));
    fs.renameSync(tmp, stateFile);
  }
  const byId = (id) => load().items.find((i) => String(i.id) === String(id));
  const ytReady = () => Boolean(youtube?.available?.()) && !youtube.status?.().broken;

  const jobs = new Set();
  let producing = null;
  const track = (p) => {
    jobs.add(p);
    p.finally(() => jobs.delete(p)).catch(() => {});
    return p;
  };
  const idle = async () => { while (jobs.size) await Promise.allSettled([...jobs]); };

  // ------------------------------------------------------------ suara (cache di disk agar percobaan ulang tak boros kuota)
  async function narrate(beats) {
    const out = [];
    for (const b of beats) {
      if (!b.say) { out.push(null); continue; }
      const key = crypto.createHash("sha1").update(`${config.voice || ""}|${config.style}|${b.say}`).digest("hex");
      const f = path.join(ttsDir, `${key}.wav`);
      let wav = null;
      try { wav = fs.readFileSync(f); } catch { /* belum ada */ }
      if (!wav || wavSeconds(wav) <= 0) {
        const r = await speaker.speakWav(b.say, { voice: config.voice, style: config.style });
        wav = r?.wav || null;
        if (wav && wavSeconds(wav) > 0) fs.writeFileSync(f, wav);
      }
      out.push(wav);
    }
    return out;
  }

  const total = (beats, wavs) => beats.reduce((s, b, i) => s + beatSeconds(wavs[i] ? wavSeconds(wavs[i]) : 0, b.hold || 0), 0);

  /** Atur panjang ke rentang minSec..maxSec: tambah latihan / perpanjang jeda berpikir, atau buang latihan terakhir. */
  async function fit(plan) {
    let cur = plan;
    let beats = flattenPlan(cur);
    let wavs = await narrate(beats);
    let sec = total(beats, wavs);
    if (sec < config.minSec && cur.kind === "math" && cur.parts.length - 1 < 2) {
      const more = buildMathPlan({ gen: cur.gen, grade: cur.grade, seed: cur.seed, practice: cur.parts.length + 1 });
      const b2 = flattenPlan(more);
      const w2 = await narrate(b2);
      if (total(b2, w2) <= config.maxSec) { cur = more; beats = b2; wavs = w2; sec = total(b2, w2); }
    }
    if (sec > config.maxSec) {
      // buang latihan terakhir (hanya matematika dengan >1 latihan), lalu pendekkan jeda berpikir
      if (cur.kind === "math" && cur.parts.length > 2) {
        beats = flattenPlan(cur, { dropParts: [cur.parts.length - 1] });
        wavs = await narrate(beats);
        sec = total(beats, wavs);
      }
      if (sec > config.maxSec) {
        beats = beats.map((b) => (b.hold ? { ...b, hold: Math.min(b.hold, 3) } : b));
        sec = total(beats, wavs);
      }
    }
    if (sec < config.minSec) {
      const holdIdx = beats.map((b, i) => (b.hold ? i : -1)).filter((i) => i >= 0);
      let need = config.minSec + 2 - sec;
      for (const i of holdIdx) {
        const add = Math.min(10, Math.ceil(need / holdIdx.length));
        beats[i] = { ...beats[i], hold: beats[i].hold + add };
      }
      sec = total(beats, wavs);
    }
    if (sec < 40 || sec > 150) throw new Error(`Panjang video ${Math.round(sec)} detik di luar batas wajar (${config.minSec}–${config.maxSec} dtk). Materi: ${cur.id}`);
    return { plan: cur, beats, wavs, estSeconds: sec };
  }

  // ------------------------------------------------------------ membuat satu draf
  async function produceInner({ kind = null, grade = null, source = "otomatis" } = {}) {
    const s = load();
    if (!speaker?.available?.()) throw Object.assign(new Error("Suara narasi belum aktif (butuh GEMINI_API_KEYS dan ffmpeg)."), { fatal: true });
    if (!renderer) throw Object.assign(new Error("Perakit video belum tersedia."), { fatal: true });
    const pick = pickNext({ history: s.history, cards: loadCards(), grades: config.grades, mix: config.mix, seed: (now() % 1_000_000_000) + s.seq * 7919 + 1, kind, grade });
    let plan = pick.plan;
    if (plan.kind === "math" && config.practice !== 1) plan = buildMathPlan({ gen: plan.gen, grade: plan.grade, seed: plan.seed, practice: config.practice });
    const fitted = await fit(plan);
    const id = String(++s.seq);
    const tmpDir = path.join(tmpRoot, id);
    const file = path.join(videoDir, `edu-${id}.mp4`);
    try {
      const r = await renderer.render({ beats: fitted.beats, wavs: fitted.wavs, outFile: file, tmpDir });
      let thumb = null;
      try {
        if (thumbnail) thumb = await thumbnail({ kelas: `Kelas ${fitted.plan.grade} SD`, title: String(fitted.plan.title).split(" | ")[0], outFile: path.join(videoDir, `edu-${id}.png`), tmpDir });
      } catch (e) {
        log.error?.(`🎓 [Edu] sampul gagal (tidak fatal): ${e?.message || e}`);
      }
      const size = fs.statSync(file).size;
      if (size < 20_000) throw new Error("Hasil video terlalu kecil/rusak.");
      const p = fitted.plan;
      const item = {
        id, status: "awaiting", source, key: pick.key, kind: p.kind, grade: p.grade, topic: p.topic, title: p.title,
        tags: p.tags, answer: p.answer, practiceAnswers: p.practiceAnswers,
        description: buildDescription(p, { chapters: chapterText(r.timeline), channelName: config.channelName }),
        script: scriptText(p), file, thumb, size, seconds: Math.round(r.seconds), createdAt: now(),
        tries: 0
      };
      s.items.push(item);
      s.history.push({ key: pick.key, grade: p.grade, at: now(), id });
      s.history = s.history.slice(-200);
      save();
      return item;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const motionAktif = () => Boolean(motion) && config.mode === "motion";

  /** Draf Short motion graphic. Melempar bila gagal (pemanggil jatuh ke papan tulis). */
  async function produceMotion({ templatId = "", topik = "" } = {}) {
    const s = load();
    if (!speaker?.available?.()) throw Object.assign(new Error("Suara narasi belum aktif (butuh GEMINI_API_KEYS dan ffmpeg)."), { fatal: true });
    const id = String(++s.seq);
    const tmpDir = path.join(tmpRoot, id);
    const file = path.join(videoDir, `edu-${id}.mp4`);
    const tanggal = localDay(now(), tz);
    try {
      const bank = () => {
        const pick = pickNext({ history: s.history, cards: loadCards(), grades: config.grades, mix: config.mix, seed: (now() % 1_000_000_000) + s.seq * 7919 + 1 });
        return { topik: pick.plan.topic, key: pick.key, grade: pick.plan.grade };
      };
      const r = await motion.produce({ tanggal, file, tmpDir, bank, topik, templatId });
      const size = fs.statSync(file).size;
      if (size < 20_000) throw new Error("Hasil video terlalu kecil/rusak.");
      if (r.dariBank) { s.history.push({ key: r.dariBank.key, grade: r.dariBank.grade, at: now(), id }); s.history = s.history.slice(-200); }
      const item = {
        id, status: "awaiting", source: "motion", mode: "motion", kind: "motion", grade: 0, topic: r.topik, title: r.meta.judul,
        templatId: r.templatId, tags: r.meta.tag, description: r.meta.deskripsi, dasar: r.dasar, madeForKids: r.meta.madeForKids, aiDisclosure: r.meta.containsSyntheticMedia,
        script: r.narasi, file, thumb: null, size, seconds: Math.round(r.detik), createdAt: now(), tries: 0, lebar: r.lebar, tinggi: r.tinggi
      };
      s.items.push(item);
      save();
      return item;
    } catch (e) {
      s.seq -= 1; // nomor tidak terpakai
      save();
      throw e;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // format tombol Telegram milik telegram.send: baris-baris tombol (bukan {inline_keyboard})
const kb = (id) => [[{ text: "✅ Setujui & jadwalkan", callback_data: `ed:ok:${id}` }], [{ text: "🔁 Buat ulang", callback_data: `ed:again:${id}` }, { text: "🗑️ Buang", callback_data: `ed:no:${id}` }]];

  async function deliver(item) {
    const s = load();
    const slot = nextPublishAt({ now: now(), publishTime: config.publishTime, tz, taken: scheduledTimes(item.id) });
    const answers = [item.answer, ...(item.practiceAnswers || [])].filter(Boolean);
    const cap = item.mode === "motion" ? `🎬 Draf Short #${item.id} · ${fmtDur(item.seconds)}\n*${item.title}*` : `🎓 Draf video #${item.id} · Kelas ${item.grade} SD · ${fmtDur(item.seconds)}\n*${item.title}*`;
    let delivered = 0;
    if (item.size <= 48 * 1024 * 1024) {
      delivered = await sendFile({ video: true, data: fs.readFileSync(item.file), name: `edu-${item.id}.mp4`, mime: "video/mp4", width: item.lebar || 1280, height: item.tinggi || 720 }, cap);
    }
    const txt = [
      item.size > 48 * 1024 * 1024 ? `${cap}\n(Berkas terlalu besar untuk Telegram.)` : null,
      `Periksa videonya dulu. Kalau disetujui, akan ditayangkan ${fmtWhen(slot, tz, config.tzLabel)}.`,
      item.dasar ? `Dasar fakta: ${item.dasar}` : null,
      answers.length ? `🔑 Kunci jawaban (cek sendiri): ${answers.join(" | ")}` : null,
      `Naskah: /edu naskah ${item.id}`
    ].filter(Boolean).join("\n");
    const n = await sendText(txt, { markup: kb(item.id) });
    item.deliveredAt = n > 0 || delivered > 0 ? now() : 0;
    save();
    void s;
    return n;
  }

  function scheduledTimes(exceptId = null) {
    return load().items.filter((i) => ["scheduled", "uploading"].includes(i.status) || (i.status === "approved" && i.publishAt)).filter((i) => String(i.id) !== String(exceptId)).map((i) => i.publishAt).filter(Boolean);
  }

  /** Buat draf (otomatis/manual). Tidak melempar; mengabari pemilik bila gagal. */
  function startProduce(opts = {}) {
    if (producing) return false;
    const s = load();
    const day = localDay(now(), tz);
    if (s.day.date !== day) s.day = { date: day, attempts: 0, produced: false, lastAttemptAt: 0, notified: false };
    const manual = opts.source === "manual";
    if (!manual) { s.day.attempts += 1; s.day.lastAttemptAt = now(); }
    save();
    producing = track(
      (async () => {
        try {
          let item;
          const pakaiMotion = motionAktif() && (opts.motion || (!opts.kind && !opts.grade));
          if (pakaiMotion) {
            try {
              item = await produceMotion(opts.motion || {});
            } catch (e) {
              const alasan = String(e?.message || e).slice(0, 250);
              log.error?.(`🎓 [Edu] video motion gagal, pindah ke papan tulis: ${alasan}`);
              await sendText(`⚠️ Video motion graphic gagal dibuat (${alasan}). Beralih ke video papan tulis.`).catch(() => {});
              item = await produceInner({ ...opts, kind: null, grade: null });
            }
          } else item = await produceInner(opts);
          if (!manual) s.day.produced = true;
          save();
          const n = await deliver(item);
          if (!n) log.error?.("🎓 [Edu] draf siap tapi tidak ada penerima Telegram (pemilik belum /start?). Lihat /edu antrean.");
          else log.log?.(`🎓 [Edu] draf #${item.id} terkirim untuk disetujui.`);
        } catch (e) {
          const msg = String(e?.message || e).slice(0, 300);
          log.error?.(`🎓 [Edu] gagal membuat video: ${msg}`);
          s.day.lastError = msg;
          s.day.lastErrorQuota = !!e?.quota;
          if (e?.fatal) s.day.attempts = config.maxAttempts;
          const last = s.day.attempts >= config.maxAttempts;
          save();
          if (manual || last || !s.day.notified) {
            s.day.notified = true;
            save();
            await sendText(`🎓 Gagal membuat video edukasi${manual ? "" : ` (percobaan ${s.day.attempts}/${config.maxAttempts})`}: ${msg}${e?.quota ? "\nKuota suara Gemini habis; hasil suara yang sudah jadi disimpan dan dilanjutkan otomatis nanti." : ""}${last && !manual ? "\nHari ini tidak dicoba lagi." : ""}`).catch(() => {});
          }
        } finally {
          producing = null;
        }
      })()
    );
    return true;
  }

  // ------------------------------------------------------------ unggah
  async function uploadItem(item) {
    const s = load();
    if (item.status === "uploading") return;
    item.status = "uploading";
    item.error = "";
    save();
    try {
      if (!(item.publishAt && item.publishAt >= now() + 20 * 60_000)) {
        item.publishAt = nextPublishAt({ now: now(), publishTime: config.publishTime, tz, taken: scheduledTimes(item.id) });
        save();
      }
      const extra = item.mode === "motion" ? { madeForKids: true, aiDisclosure: true } : {};
      const r = await youtube.upload({ file: item.file, title: item.title, description: item.description, tags: item.tags, publishAt: item.publishAt, ...extra });
      item.ytId = r.id;
      item.ytUrl = r.url;
      item.studioUrl = r.studioUrl;
      item.publishAt = r.publishAt ? Date.parse(r.publishAt) || item.publishAt : item.publishAt;
      item.status = "scheduled";
      item.uploadedAt = now();
      save();
      let thumbNote = "";
      if (item.thumb && fs.existsSync(item.thumb)) {
        const t = await youtube.setThumbnail(r.id, item.thumb);
        thumbNote = t.ok ? "" : `\n⚠️ Sampul tidak terpasang (${String(t.reason || "").slice(0, 120)}). Biasanya karena akun YouTube belum verifikasi telepon; videonya tetap terjadwal.`;
      }
      await sendText(`✅ Video #${item.id} terjadwal tayang ${fmtWhen(item.publishAt, tz, config.tzLabel)}.\n${item.title}\nCek / ubah: ${r.studioUrl}\n(Status di YouTube: pribadi sampai jam tayang.)${thumbNote}`).catch(() => {});
    } catch (e) {
      const kind = e?.kind || "unknown";
      const msg = String(e?.message || e).slice(0, 300);
      item.error = msg;
      item.tries = (item.tries || 0) + 1;
      if (kind === "quota" || kind === "limit") {
        item.status = "approved";
        item.retryAt = now() + 20 * 3600_000;
        save();
        await sendText(`⏳ Video #${item.id}: jatah unggah YouTube hari ini habis (${msg}). Dicoba lagi otomatis besok.`).catch(() => {});
      } else if ((kind === "network" || kind === "server") && item.tries < 4) {
        item.status = "approved";
        item.retryAt = now() + 10 * 60_000;
        save();
        log.error?.(`🎓 [Edu] unggah #${item.id} gagal sementara (${kind}), dicoba lagi 10 menit.`);
      } else {
        item.status = "failed";
        save();
        const hint = kind === "auth" || kind === "config" ? "\nPerbaiki izin: jalankan `node youtube-auth.mjs` di laptop bot, lalu /edu ulang " + item.id : `\nSetelah diperbaiki: /edu ulang ${item.id}`;
        await sendText(`❌ Unggah video #${item.id} gagal: ${msg}${hint}`).catch(() => {});
      }
    }
    void s;
  }

  function startUpload(item) {
    return track(uploadItem(item));
  }

  // ------------------------------------------------------------ keputusan pemilik
  function approve(item) {
    if (item.status !== "awaiting") return `Video #${item.id} sudah berstatus "${item.status}".`;
    item.status = "approved";
    item.approvedAt = now();
    item.publishAt = nextPublishAt({ now: now(), publishTime: config.publishTime, tz, taken: scheduledTimes(item.id) });
    item.tries = 0;
    item.retryAt = 0;
    save();
    if (item.mode === "motion" && item.topic) motion?.catatTopik?.(item.topic)?.catch?.(() => {});
    if (!ytReady()) {
      return `👍 Video #${item.id} disetujui, tapi YouTube belum tersambung (${youtube?.status?.().broken || "isi YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN di .env"}). Video disimpan; begitu YouTube siap akan diunggah otomatis, atau ketik /edu ulang ${item.id}.`;
    }
    startUpload(item);
    return `👍 Disetujui. Mengunggah video #${item.id} ke YouTube, terjadwal ${fmtWhen(item.publishAt, tz, config.tzLabel)}. Saya kabari begitu selesai.`;
  }

  function discard(item, reason = "dibuang") {
    item.status = "rejected";
    item.rejectedReason = reason;
    save();
    for (const f of [item.file, item.thumb]) if (f) fs.rmSync(f, { force: true });
  }

  /** Dipanggil dari tombol Telegram: "ok:<id>" | "again:<id>" | "no:<id>". Mengembalikan teks balasan. */
  async function decide(arg) {
    const m = /^(ok|again|no):(\S+)$/.exec(String(arg || "").trim());
    if (!m) return "Tombol tidak dikenal.";
    return act(m[1], m[2]);
  }

  function act(action, id) {
    const item = byId(id);
    if (!item) return `Video #${id} tidak ditemukan.`;
    if (action === "ok") return approve(item);
    if (action === "no") {
      if (item.status !== "awaiting") return `Video #${item.id} sudah berstatus "${item.status}", tidak bisa dibuang dari sini.`;
      discard(item);
      return `🗑️ Video #${item.id} dibuang.`;
    }
    // again
    if (item.status !== "awaiting") return `Video #${item.id} sudah berstatus "${item.status}".`;
    if (producing) return "Sedang ada video yang dibuat. Tunggu sebentar, lalu coba lagi.";
    discard(item, "dibuat ulang");
    if (item.mode === "motion") {
      startProduce({ source: "manual", motion: { templatId: item.templatId, topik: item.topic } });
      return `🔁 Draf #${item.id} dibuang. Membuat pengganti (${item.topic}); kirim ulang dalam beberapa menit.`;
    }
    startProduce({ source: "manual", kind: item.kind, grade: item.grade });
    return `🔁 Draf #${item.id} dibuang. Membuat pengganti (kelas ${item.grade}, ${item.kind === "math" ? "matematika" : "sains"}); kirim ulang dalam beberapa menit.`;
  }

  // ------------------------------------------------------------ jadwal
  /** Dipanggil tiap menit. Tidak melempar. */
  async function check() {
    try {
      if (!config.enabled) return;
      const s = load();
      const t = now();
      const day = localDay(t, tz);
      if (s.day.date !== day) { s.day = { date: day, attempts: 0, produced: false, lastAttemptAt: 0, notified: false }; save(); }

      // unggah yang menunggu (YouTube baru tersambung / giliran coba ulang)
      if (ytReady()) {
        for (const it of s.items) if (it.status === "approved" && (it.retryAt || 0) <= t && !jobs.size) startUpload(it);
      }

      if (motionAktif()) await motion.tickTema();

      // buat video harian
      if (!s.paused && !producing && !s.day.produced && minutesOfDay(t, tz) >= hhmmToMin(config.renderTime) && s.day.attempts < config.maxAttempts) {
        const awaiting = s.items.filter((i) => i.status === "awaiting").length;
        const gap = s.day.lastErrorQuota ? 90 * 60_000 : 20 * 60_000;
        if (awaiting < config.maxPending && t - (s.day.lastAttemptAt || 0) >= gap) startProduce({ source: "otomatis" });
      }
      cleanup();
    } catch (e) {
      log.error?.(`🎓 [Edu] check gagal: ${e?.message || e}`);
    }
  }
  const hhmmToMin = (v) => { const [h, m] = v.split(":").map(Number); return h * 60 + m; };

  let lastCleanDay = "";
  function cleanup() {
    const s = load();
    const day = localDay(now(), tz);
    if (lastCleanDay === day) return;
    lastCleanDay = day;
    const cutoff = now() - config.keepDays * 86400_000;
    for (const it of s.items) {
      const ref = it.uploadedAt || it.createdAt || 0;
      if (["scheduled", "rejected", "failed"].includes(it.status) && ref < cutoff && it.file) {
        for (const f of [it.file, it.thumb]) if (f) fs.rmSync(f, { force: true });
        it.file = null;
        it.thumb = null;
      }
    }
    s.items = s.items.filter((it) => !(["scheduled", "rejected"].includes(it.status) && !it.file && (it.createdAt || 0) < now() - 90 * 86400_000));
    try {
      for (const f of fs.readdirSync(ttsDir)) {
        const p = path.join(ttsDir, f);
        if (fs.statSync(p).mtimeMs < now() - 7 * 86400_000) fs.rmSync(p, { force: true });
      }
    } catch { /* abaikan */ }
    save();
  }

  // ------------------------------------------------------------ perintah /edu
  const STATUS_LABEL = { awaiting: "menunggu persetujuanmu", approved: "disetujui, belum diunggah", uploading: "sedang diunggah", scheduled: "terjadwal di YouTube", failed: "gagal unggah", rejected: "dibuang" };

  function describe() {
    if (!config.enabled) return "mati (EDU_ENABLED=false)";
    const s = load();
    const n = (k) => s.items.filter((i) => i.status === k).length;
    const yt = !youtube?.available?.() ? "YouTube belum diatur" : youtube.status().broken ? "YouTube: izin ditolak" : "YouTube siap";
    return `${s.paused ? "DIJEDA" : "aktif"} · mode ${motionAktif() ? "motion" : "papan"} · buat ${config.renderTime}, tayang ${config.publishTime} ${config.tzLabel} · menunggu kamu: ${n("awaiting")} · terjadwal: ${n("scheduled")}${n("approved") ? ` · belum terunggah: ${n("approved")}` : ""}${n("failed") ? ` · gagal: ${n("failed")}` : ""} · ${yt}`;
  }

  function list() {
    const s = load();
    const act = s.items.filter((i) => ["awaiting", "approved", "uploading", "failed", "scheduled"].includes(i.status)).slice(-12);
    if (!act.length) return "Antrean kosong. Buat satu: /edu buat";
    return act.map((i) => `#${i.id} · ${i.mode === "motion" ? "Short" : `Kelas ${i.grade}`} · ${i.title.split(" | ")[0]} · ${STATUS_LABEL[i.status]}${i.publishAt && ["scheduled", "approved"].includes(i.status) ? ` (${fmtWhen(i.publishAt, tz, config.tzLabel)})` : ""}${i.error && ["failed", "approved"].includes(i.status) ? `\n   ⚠️ ${i.error.slice(0, 120)}` : ""}`).join("\n");
  }

  const HELP = [
    "🎓 Channel edukasi (SD kelas 1-6):",
    "/edu  — status",
    "/edu buat [kelas N] [matematika|sains]  — buat satu draf sekarang",
    "/edu antrean  — daftar video",
    "/edu setuju <no>  /edu buang <no>  — sama dengan tombol",
    "/edu naskah <no>  — naskah yang diucapkan",
    "/edu ulang <no>  — coba unggah lagi",
    "/edu youtube  — cek sambungan YouTube",
    "/edu jeda  /edu lanjut  — hentikan / lanjutkan pembuatan harian",
    "/tema  — usulan tema mingguan (Short motion graphic); /tema tambah topik; topik lain"
  ].join("\n");

  async function handle(arg = "") {
    const a = String(arg || "").trim();
    const [cmd0, ...rest] = a.split(/\s+/);
    const cmd = (cmd0 || "").toLowerCase();
    if (!config.enabled && cmd !== "bantuan") return "Channel edukasi belum aktif. Isi EDU_ENABLED=true (dan YT_* untuk YouTube) di .env lalu restart bot. Ketik /edu bantuan.";
    const s = load();
    if (!cmd || cmd === "status") return `🎓 Channel edukasi: ${describe()}\n\n${list()}`;
    if (cmd === "bantuan" || cmd === "help") return HELP;
    if (cmd === "antrean" || cmd === "daftar" || cmd === "list") return list();
    if (cmd === "jeda") { s.paused = true; save(); return "⏸️ Pembuatan harian dijeda. /edu lanjut untuk melanjutkan."; }
    if (cmd === "lanjut") { s.paused = false; save(); return "▶️ Pembuatan harian dilanjutkan."; }
    if (cmd === "youtube" || cmd === "yt") {
      if (!youtube?.available?.()) return "YouTube belum diatur. Isi YT_CLIENT_ID, YT_CLIENT_SECRET, lalu jalankan `node youtube-auth.mjs` di laptop bot (lihat README bagian Channel YouTube).";
      try {
        const v = await youtube.verify();
        return v.ok ? `✅ YouTube tersambung. Izin: ${v.scopes.map((x) => x.replace("https://www.googleapis.com/auth/", "")).join(", ") || "-"}. Bisa mengunggah: ${v.canUpload ? "ya" : "TIDAK (izin kurang, ulangi youtube-auth.mjs)"}.` : "❌ Token YouTube ditolak. Jalankan ulang `node youtube-auth.mjs`.";
      } catch (e) {
        return `❌ ${String(e?.message || e).slice(0, 250)}`;
      }
    }
    if (cmd === "buat" || cmd === "baru") {
      const g = /kelas\s*(\d)/i.exec(a);
      const grade = g ? Number(g[1]) : null;
      if (grade && (grade < 1 || grade > 6)) return "Kelas harus 1 sampai 6.";
      const kind = /matematika|math|hitung/i.test(a) ? "math" : /sains|ipa|pengetahuan/i.test(a) ? "sains" : null;
      if (producing) return "Sedang ada video yang dibuat. Tunggu sebentar.";
      startProduce({ source: "manual", kind, grade });
      return `🎬 Membuat draf${grade ? ` kelas ${grade}` : ""}${kind ? ` (${kind === "math" ? "matematika" : "sains"})` : ""}. Biasanya 3–6 menit; hasilnya saya kirim ke sini.`;
    }
    const id = (rest[0] || "").replace(/^#/, "");
    if (["setuju", "ok", "buang", "tolak", "hapus", "naskah", "ulang"].includes(cmd)) {
      if (!id) return `Sebutkan nomornya, contoh: /edu ${cmd} 3`;
      const item = byId(id);
      if (!item) return `Video #${id} tidak ditemukan. Lihat /edu antrean.`;
      if (cmd === "setuju" || cmd === "ok") return act("ok", id);
      if (cmd === "naskah") return `Naskah #${item.id} — ${item.title}\n\n${item.script}`.slice(0, 3800);
      if (cmd === "ulang") {
        if (!["approved", "failed"].includes(item.status)) return `Video #${item.id} berstatus "${item.status}"; yang bisa diulang unggahnya hanya yang "disetujui/gagal".`;
        if (!item.file || !fs.existsSync(item.file)) return `Berkas video #${item.id} sudah dihapus. Buat video baru: /edu buat`;
        if (!ytReady()) return "YouTube belum siap. Cek /edu youtube.";
        item.status = "approved"; item.tries = 0; item.retryAt = 0; save();
        startUpload(item);
        return `🔄 Mengunggah ulang video #${item.id}…`;
      }
      // buang / tolak / hapus
      if (item.status === "scheduled") return `Video #${item.id} sudah terjadwal di YouTube. Batalkan lewat YouTube Studio: ${item.studioUrl || "studio.youtube.com"} (bot hanya punya izin mengunggah, tidak bisa menghapus).`;
      if (item.status === "uploading") return `Video #${item.id} sedang diunggah. Tunggu selesai.`;
      discard(item);
      return `🗑️ Video #${item.id} dibuang.`;
    }
    return HELP;
  }

  const temaTersedia = () => motionAktif() && config.enabled;
  const temaCallback = async (data) => (temaTersedia() ? motion.callback(data) : "Fitur tema mingguan hanya aktif pada EDU_MODE=motion.");
  const temaPerintah = async (arg) => (temaTersedia() ? motion.perintah(arg) : "Fitur tema mingguan hanya aktif pada EDU_MODE=motion (dan EDU_ENABLED=true).");
  const temaTeks = async (text, o) => (temaTersedia() ? motion.teks(text, o) : { handled: false });

  return { config, check, handle, decide, temaCallback, temaPerintah, temaTeks, describe, idle, startProduce, load, nextSlot: () => nextPublishAt({ now: now(), publishTime: config.publishTime, tz, taken: scheduledTimes() }), enabled: () => config.enabled };
}

/** Rakitan bawaan untuk index.js: perakit, sampul, dan pemuat kartu sains dari berkas. */
export function createEduDefaults({ config, ffmpeg = process.env.FFMPEG_PATH || "ffmpeg", log = console, cardsFile = "data/edu-sains.json" } = {}) {
  const renderer = createBoardRenderer({ ffmpeg, channelName: config.channelName, log });
  const thumbnail = (o) => renderThumbnail({ ...o, ffmpeg, channelName: config.channelName, fonts: renderer.fonts });
  const loadCards = () => {
    try {
      return JSON.parse(fs.readFileSync(cardsFile, "utf8"));
    } catch (e) {
      log.error?.(`🎓 [Edu] kartu sains tidak terbaca (${e.message}); hanya matematika.`);
      return [];
    }
  };
  return { renderer, thumbnail, loadCards };
}
