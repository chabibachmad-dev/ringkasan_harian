// ================================================================
// MUSIK LATAR untuk video buatan bot (foto hidup, morf, stop motion, animasi/cerita).
//
// Sumber musik, berurutan:
//   1. Berkas milik pemilik di folder musik (bawaan: wa-bot/musik/, ubah lewat VIDEO_MUSIC_DIR). Boleh diberi subfolder
//      sebagai kategori (musik/dj/lagu1.mp3, musik/tenang/piano.mp3). Nama berkas/subfolder dipakai untuk mencari.
//   2. Cadangan buatan ffmpeg (tanpa berkas, bebas hak cipta): ketukan "jedag-jedug" (dj) atau bantalan nada lembut (tenang).
//
// Cara meminta (kalimat biasa, bisa di Telegram maupun WhatsApp):
//   "... pakai musik"            -> lagu acak dari folder (kalau folder kosong: ketukan buatan)
//   "... pakai musik dj"         -> lagu yang nama berkas/foldernya mengandung "dj" (jedag jedug, edm, dugem ikut dikenali)
//   "... tanpa musik"            -> tidak diberi musik (menimpa VIDEO_MUSIC_DEFAULT=1)
// Video yang sudah bernarasi (animasi cerita): musik dikecilkan otomatis saat narasi berbicara.
// ================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { runProc } from "./photo-video.js";

export const MUSIC_EXTS = [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"];
export const MAX_TRACKS = 300;
export const MAX_MUSIC_SEC = 180;
export const FADE_IN_SEC = 0.6;
export const FADE_OUT_SEC = 1.5;

const MUSIC_WORD = "(?:musik|music|lagu|backsound|back\\s*sound|bgm|soundtrack|iringan)";
const ON_VERB = "(?:pakai|pake|pakei|pakailah|dengan|plus|tambah(?:kan|in)?|beri(?:kan)?|kasih|sertakan|iringi(?:\\s+dengan)?|disertai|diiringi|diberi|berlatar)";
const OFF_RE = new RegExp(`\\b(?:tanpa|tidak\\s+(?:pakai|usah|perlu)|ga(?:k)?\\s+(?:pakai|usah|perlu)|jangan\\s+(?:pakai|pake|ada)|no)\\s+(?:suara\\s+)?${MUSIC_WORD}\\b`, "i");
const ON_RE = new RegExp(`(?:^|[\\s,;(])(?:${ON_VERB})\\s+(?:(?:suara|efek)\\s+)?(?:${MUSIC_WORD})(?:\\s+(?:latar|background))?(?![\\p{L}\\p{N}])`, "iu");
const PLUS_RE = new RegExp(`(?:^|\\s)\\+\\s*${MUSIC_WORD}(?![\\p{L}\\p{N}])`, "iu");
// kata yang menandakan kalimat sudah beralih ke hal lain (bukan lagi nama/gaya musik)
const STOP_WORDS = new Set(["tulisan", "judul", "selama", "durasi", "detik", "fps", "tahap", "halus", "bolak", "balik", "dan", "yang", "untuk", "di", "ke", "dari", "dengan", "pakai", "pake", "tentang", "jadi", "agar", "supaya", "lalu", "kemudian", "serta", "tapi", "ya", "dong", "nya", "plus", "buat", "mode", "efek", "salju", "hujan"]);

/** Kata kunci pencarian -> kata yang dicari di nama berkas/folder. "jedag jedug", edm, dugem, koplo... semuanya dianggap "dj". */
const ALIAS = [
  { re: /^(?:jedag|jedug|jedagjedug|dugem|dj|edm|remix|disko|disco|club|party|techno|house|beat|bass|koplo)$/, tags: ["dj", "edm", "jedag", "jedug", "dugem", "remix", "club", "party", "house", "techno", "beat", "bass", "koplo", "disco"] },
  { re: /^(?:tenang|santai|lembut|calm|chill|lofi|piano|relax|rileks|damai)$/, tags: ["tenang", "santai", "lembut", "calm", "chill", "lofi", "piano", "relax", "rileks", "damai"] },
  { re: /^(?:sedih|haru|melankolis|sad)$/, tags: ["sedih", "haru", "sad", "melankolis", "piano"] },
  { re: /^(?:ceria|riang|gembira|happy|semangat)$/, tags: ["ceria", "riang", "gembira", "happy", "semangat", "upbeat"] },
  { re: /^(?:dramatis|epik|epic|sinematik|cinematic|tegang)$/, tags: ["dramatis", "epik", "epic", "sinematik", "cinematic", "tegang", "dramatic"] }
];

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const words = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Teks permintaan -> { text (tanpa frasa musik), on, off, query }.
 * on=true bila diminta musik; off=true bila "tanpa musik"; query = kata gaya/nama ("dj", "jedag jedug", ...), maks 3 kata.
 */
export function parseMusicRequest(text) {
  const raw = String(text ?? "");
  if (OFF_RE.test(raw)) return { text: raw.replace(OFF_RE, " ").replace(/\s{2,}/g, " ").trim(), on: false, off: true, query: "" };
  let m = ON_RE.exec(raw);
  let end;
  if (m) end = m.index + m[0].length;
  else {
    m = PLUS_RE.exec(raw);
    if (!m) return { text: raw, on: false, off: false, query: "" };
    end = m.index + m[0].length;
  }
  const tokens = [];
  let rest = raw.slice(end);
  let consumed = 0;
  for (let i = 0; i < 3; i++) {
    const t = /^[ \t]+([\p{L}\p{N}][\p{L}\p{N}-]*)/u.exec(rest);
    if (!t) break;
    const w = norm(t[1]);
    if (STOP_WORDS.has(w) || /^\d/.test(w)) break;
    tokens.push(w);
    consumed += t[0].length;
    rest = rest.slice(t[0].length);
  }
  const cut = raw.slice(0, m.index) + " " + raw.slice(end + consumed);
  return { text: cut.replace(/\s{2,}/g, " ").replace(/\s+([,.;!?])/g, "$1").trim(), on: true, off: false, query: tokens.join(" ") };
}

/** Kata kunci -> daftar kata yang dicari (beserta padanannya). */
export function queryTags(query) {
  const out = new Set();
  for (const w of words(query)) {
    if (w.length < 2) continue;
    out.add(w);
    for (const a of ALIAS) if (a.re.test(w)) for (const t of a.tags) out.add(t);
  }
  return [...out];
}

/** Gaya ketukan cadangan untuk kata kunci: "tenang" bila mengarah ke musik lembut, selain itu "dj". */
export function synthStyleFor(query) {
  const w = words(query);
  if (w.some((x) => ALIAS[1].re.test(x) || ALIAS[2].re.test(x))) return "tenang";
  return "dj";
}

/** Pindai folder musik (satu tingkat subfolder). -> [{ file, name, label, search }] diurutkan menurut nama. */
export function listTracks(dir, fsImpl = fs) {
  const out = [];
  const add = (full, rel) => {
    const ext = path.extname(full).toLowerCase();
    if (!MUSIC_EXTS.includes(ext)) return;
    const base = path.basename(full, ext);
    out.push({ file: full, name: rel, label: base, search: ` ${words(rel).join(" ")} ` });
  };
  try {
    for (const e of fsImpl.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isFile()) add(full, e.name);
      else if (e.isDirectory()) {
        try {
          for (const f of fsImpl.readdirSync(full, { withFileTypes: true })) if (f.isFile() && !f.name.startsWith(".")) add(path.join(full, f.name), `${e.name}/${f.name}`);
        } catch {
          /* subfolder tak terbaca: lewati */
        }
      }
      if (out.length >= MAX_TRACKS) break;
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Pilih lagu: yang cocok dengan kata kunci (acak di antara skor tertinggi); tanpa kecocokan -> acak dari semua. */
export function pickTrack(tracks, query = "", rand = Math.random) {
  if (!tracks.length) return null;
  const tags = queryTags(query);
  let pool = tracks;
  let matched = false;
  if (tags.length) {
    let best = 0;
    const scored = tracks.map((t) => {
      const s = tags.reduce((n, tag) => n + (t.search.includes(tag) ? 1 : 0), 0);
      if (s > best) best = s;
      return { t, s };
    });
    if (best > 0) {
      pool = scored.filter((x) => x.s === best).map((x) => x.t);
      matched = true;
    }
  }
  return { track: pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))], matched };
}

// ---------------------------------------------------------------- musik buatan ffmpeg
const SEMI = [0, 3, 7, 10, 12, 10, 7, 3];
const BPM_DJ = 128;

/** Ekspresi aevalsrc. "dj": kick 4/4 + hi-hat offbeat + bass + arpeggio. "tenang": akord lembut bergetar pelan. */
export function synthExpr(style = "dj") {
  if (style === "tenang") {
    const note = (f) => `sin(2*PI*${f}*t)`;
    return `0.16*(${note(220)}+${note(277.18)}+${note(329.63)})*(0.75+0.25*sin(2*PI*0.25*t))+0.05*${note(110)}`;
  }
  const p = (60 / BPM_DJ).toFixed(6);
  const h = (60 / BPM_DJ / 2).toFixed(6);
  const kick = `0.85*sin(2*PI*(45+110*exp(-28*mod(t,${p})))*mod(t,${p}))*exp(-7*mod(t,${p}))`;
  const hat = `0.14*(random(0)*2-1)*exp(-70*mod(t+${h},${p}))`;
  const bass = `0.30*sin(2*PI*55*t)*(1-exp(-12*mod(t,${p})))`;
  const step = `mod(floor(t/${h}),8)`;
  const semi = SEMI.map((s, k) => `between(${step},${k},${k})*${s}`).join("+");
  const arp = `0.10*sin(2*PI*(220*pow(2,(${semi})/12))*t)*exp(-9*mod(t,${h}))*(1-exp(-300*mod(t,${h})))`;
  return `${kick}+${hat}+${bass}+${arp}`;
}

export function synthArgs(style, seconds, out) {
  const d = Math.max(2, Math.min(MAX_MUSIC_SEC, Math.ceil(seconds) + 1));
  return ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=exprs='${synthExpr(style)}':s=44100:d=${d}`, "-af", "alimiter=limit=0.9,aformat=channel_layouts=stereo", "-ar", "44100", out];
}

// ---------------------------------------------------------------- mencampur ke video
/** Panjang & ada-tidaknya audio pada video, dibaca dari keluaran ffmpeg -i. */
export async function probeMedia(ffmpeg, file, opts = {}) {
  const r = await runProc(ffmpeg, ["-hide_banner", "-nostdin", "-i", file], { timeoutMs: 20_000, ...opts });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  return { seconds: m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0, hasAudio: /Stream #[^\n]*Audio:/.test(r.stderr) };
}

/** Argumen ffmpeg untuk menempelkan musik. Video disalin (tanpa render ulang); audio AAC. hasAudio -> narasi dipertahankan, musik mengalah. */
export function mixArgs({ video, music, out, seconds, hasAudio, volume = 0.6, loop = true }) {
  const S = Math.max(1, seconds);
  const fadeOutAt = Math.max(0, S - FADE_OUT_SEC);
  const v = hasAudio ? volume * 0.45 : volume;
  const chain = `[1:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${S.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${FADE_IN_SEC},afade=t=out:st=${fadeOutAt.toFixed(2)}:d=${FADE_OUT_SEC},volume=${v.toFixed(3)}`;
  const filter = hasAudio
    ? `${chain}[m];[0:a]aresample=44100,aformat=channel_layouts=stereo,asplit=2[n1][n2];[m][n2]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=400[md];[n1][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`
    : `${chain},alimiter=limit=0.95[a]`;
  return ["-hide_banner", "-loglevel", "error", "-y", "-i", video, ...(loop ? ["-stream_loop", "-1"] : []), "-i", music, "-filter_complex", filter, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-t", S.toFixed(2), "-movflags", "+faststart", out];
}

/**
 * createMusic({ dir, ffmpeg, volume, spawnImpl, tmpRoot, rand, log })
 *  .parse(text)           -> parseMusicRequest
 *  .tracks()              -> daftar lagu di folder
 *  .add(buffer, req)      -> { buffer, label, source: "berkas"|"buatan", matched } ; melempar galat bila ffmpeg gagal
 *  .info()                -> teks status untuk /musik
 */
export function createMusic({ dir = "musik", ffmpeg = "ffmpeg", volume = 0.6, spawnImpl = spawn, tmpRoot = os.tmpdir(), rand = Math.random, log = console } = {}) {
  const tracks = () => listTracks(dir);

  async function add(buffer, req = {}) {
    const query = req.query || "";
    const dirTmp = fs.mkdtempSync(path.join(tmpRoot, "ayyubi-musik-"));
    try {
      const vin = path.join(dirTmp, "in.mp4");
      const out = path.join(dirTmp, "out.mp4");
      fs.writeFileSync(vin, buffer);
      const probe = await probeMedia(ffmpeg, vin, { spawnImpl });
      if (!probe.seconds) throw new Error("durasi video tidak terbaca");
      const seconds = Math.min(probe.seconds, MAX_MUSIC_SEC);
      let musicFile;
      let label;
      let source;
      let matched = false;
      const pick = pickTrack(tracks(), query, rand);
      if (pick) {
        musicFile = pick.track.file;
        label = pick.track.label;
        source = "berkas";
        matched = pick.matched;
      } else {
        const style = synthStyleFor(query);
        musicFile = path.join(dirTmp, "beat.wav");
        const r = await runProc(ffmpeg, synthArgs(style, seconds, musicFile), { timeoutMs: 60_000, spawnImpl });
        if (r.code !== 0) throw new Error(`musik buatan gagal: ${r.stderr.slice(-160)}`);
        label = style === "tenang" ? "nada lembut buatan" : "ketukan jedag-jedug buatan";
        source = "buatan";
        matched = true;
      }
      const r = await runProc(ffmpeg, mixArgs({ video: vin, music: musicFile, out, seconds: probe.seconds, hasAudio: probe.hasAudio, volume }), { timeoutMs: 180_000, spawnImpl });
      if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`mencampur musik gagal: ${r.stderr.slice(-200)}`);
      return { buffer: fs.readFileSync(out), label, source, matched, narrated: probe.hasAudio };
    } finally {
      try {
        fs.rmSync(dirTmp, { recursive: true, force: true });
      } catch (e) {
        log.warn?.(`🎵 gagal membersihkan ${dirTmp}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  function info() {
    const list = tracks();
    const lines = [`🎵 Musik latar video`, `Folder: ${path.resolve(dir)}`, list.length ? `Isi: ${list.length} lagu` : "Isi: kosong (bot memakai ketukan buatan ffmpeg)"];
    for (const t of list.slice(0, 20)) lines.push(`• ${t.name}`);
    if (list.length > 20) lines.push(`… dan ${list.length - 20} lagu lain`);
    lines.push("", "Cara minta: tambahkan \"pakai musik\" atau \"pakai musik dj\" (jedag jedug, edm, tenang, ceria ikut dikenali) di perintah video; \"tanpa musik\" untuk mematikan.", "Beri nama berkas/subfolder yang jelas (mis. musik/dj/lagu1.mp3) supaya mudah dicari.", `Format: ${MUSIC_EXTS.join(" ")}`);
    return lines.join("\n");
  }

  return { parse: parseMusicRequest, tracks, add, info, count: () => tracks().length };
}
