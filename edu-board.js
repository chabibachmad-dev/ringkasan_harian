// ================================================================
// Perender "papan tulis digital": rencana materi (edu-bank.js) + narasi suara -> video MP4 16:9.
// Hanya ffmpeg (drawtext/drawbox) — tanpa pustaka tambahan. Tiap "beat" (satu bagian narasi) jadi satu klip:
// papan hijau bergaya kapur, teks muncul bertahap, narasi di-sinkronkan; klip digabung jadi satu video.
// Tidak ada wajah/orang/karakter: hanya tulisan dan angka.
// ================================================================
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const W = 1280;
export const H = 720;
export const FPS = 25;
export const LEAD_SEC = 0.35; // jeda sebelum narasi mulai
export const TAIL_SEC = 0.7; // jeda setelah narasi
export const SIZES = { m: 32, l: 40, xl: 52 };
export const COLORS = { white: "F4F1E8", yellow: "FFD84D", cyan: "7FDBFF", pink: "FF9EC4", green: "7CFC9A" };
export const BG = "1F3B2D";
export const FRAME = "6B4A2B";
const TOP = 104;
const BOTTOM = 52;
const LEFT = 72;
const MONO_X = 400;

const FONT_BOLD = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"];
const FONT_MONO = ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSansMono-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"];
const firstExisting = (list) => list.find((f) => { try { return fs.existsSync(f); } catch { return false; } }) || "";

export function findFonts(env = process.env) {
  const bold = env.EDU_FONT && fs.existsSync(env.EDU_FONT) ? env.EDU_FONT : firstExisting(FONT_BOLD);
  const mono = env.EDU_FONT_MONO && fs.existsSync(env.EDU_FONT_MONO) ? env.EDU_FONT_MONO : firstExisting(FONT_MONO) || bold;
  return { bold, mono };
}

// ---------------------------------------------------------------- WAV
/** Durasi (detik) dari buffer WAV PCM. 0 bila tak terbaca. */
export function wavSeconds(buf) {
  try {
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return 0;
    let off = 12;
    let byteRate = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString("ascii", off, off + 4);
      let size = buf.readUInt32LE(off + 4);
      if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
      if (id === "data") {
        if (size === 0xffffffff || off + 8 + size > buf.length) size = buf.length - off - 8;
        return byteRate ? size / byteRate : 0;
      }
      off += 8 + size + (size % 2);
    }
  } catch {
    /* abaikan */
  }
  return 0;
}

/** WAV hening (untuk tes / cadangan). */
export function silentWav(seconds, rate = 24000) {
  const n = Math.max(1, Math.round(seconds * rate));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

// ---------------------------------------------------------------- rencana -> daftar beat
/**
 * Rata: [{ say, board, clear, hold, section }]. `parts` adalah bagian-bagian isi (contoh, latihan 1, ...).
 * `drop` = indeks bagian yang dibuang (mis. latihan tambahan bila video terlalu panjang).
 */
export function flattenPlan(plan, { dropParts = [] } = {}) {
  const out = [];
  const add = (beats, section) => beats.forEach((b, i) => out.push({ ...b, section, firstOfSection: i === 0 }));
  add(plan.intro, "Pembukaan");
  plan.parts.forEach((p, i) => {
    if (dropParts.includes(i)) return;
    add(p, plan.sections?.[i] || `Bagian ${i + 1}`);
  });
  add(plan.outro, "Penutup");
  return out;
}

// ---------------------------------------------------------------- tata letak papan
export const lineHeight = (l) => Math.round(SIZES[l.s || "l"] * 1.38) + (l.s === "xl" ? 8 : 4);

/**
 * Untuk tiap beat, kembalikan baris yang tampil: [{ ...line, y, isNew }]. Papan dihapus bila beat.clear,
 * atau bila baris baru tak muat (halaman baru). Mengembalikan juga `pages` = jumlah penghapusan karena penuh.
 */
export function layoutBeats(beats) {
  const avail = H - TOP - BOTTOM;
  let cur = [];
  let used = 0;
  let overflowClears = 0;
  const out = [];
  for (const b of beats) {
    if (b.clear) {
      cur = [];
      used = 0;
    }
    const need = b.board.reduce((n, l) => n + lineHeight(l), 0);
    if (used + need > avail && cur.length) {
      // papan penuh: bersihkan, tetapi soal (baris "pin") dipertahankan di puncak supaya penonton tidak kehilangan konteks
      let y = TOP;
      cur = cur.filter((l) => l.pin).map((l) => {
        const q = { ...l, y };
        y += lineHeight(l);
        return q;
      });
      used = y - TOP;
      if (used + need > avail) {
        cur = [];
        used = 0;
      }
      overflowClears++;
    }
    const placed = [];
    let y = TOP + used;
    for (const l of b.board) {
      placed.push({ ...l, y, isNew: true });
      y += lineHeight(l);
      used += lineHeight(l);
    }
    out.push([...cur.map((p) => ({ ...p, isNew: false })), ...placed]);
    cur = [...cur, ...placed.map((p) => ({ ...p, isNew: false }))];
  }
  return { frames: out, overflowClears, avail };
}

// ---------------------------------------------------------------- argumen ffmpeg per klip
const esc = (p) => String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

/** Skrip filter (isi berkas filter_script) untuk satu klip. */
export function clipFilter({ lines, dur, fonts, textFiles, channelName = "", hold = 0, leadSec = LEAD_SEC }) {
  const f = [];
  // bingkai kayu + label saluran
  f.push(`drawbox=x=0:y=0:w=${W}:h=${H}:color=0x${FRAME}:t=14`);
  if (channelName) {
    f.push(`drawtext=fontfile='${esc(fonts.bold)}':text='${String(channelName).replace(/[:'\\%]/g, " ")}':fontsize=24:fontcolor=0x${COLORS.white}@0.55:x=44:y=34`);
  }
  const newOnes = lines.filter((l) => l.isNew);
  const n = Math.max(1, newOnes.length);
  const span = Math.max(0.6, Math.min(dur * 0.55, 0.9 * n));
  let k = 0;
  lines.forEach((l, i) => {
    const size = SIZES[l.s || "l"];
    const color = COLORS[l.c || "white"] || COLORS.white;
    const font = l.mono ? fonts.mono : fonts.bold;
    const x = l.mono ? `${MONO_X}` : l.center ? "(w-text_w)/2" : `${LEFT}`;
    let alpha = "";
    if (l.isNew) {
      const t0 = (leadSec + (n === 1 ? 0.05 : (span * k) / (n - 1))).toFixed(2);
      alpha = `:alpha='if(lt(t,${t0}),0,min(1,(t-${t0})/0.45))'`;
      k++;
    }
    f.push(`drawtext=fontfile='${esc(font)}':textfile='${esc(textFiles[i])}':expansion=none:fontsize=${size}:fontcolor=0x${color}:x=${x}:y=${l.y}${alpha}`);
  });
  if (hold > 0) {
    // bilah waktu "jeda & kerjakan sendiri": menyusut selama jeda
    const t0 = (dur - hold).toFixed(2);
    f.push(`drawbox=x=${LEFT}:y=${H - 40}:w='max(0,(1-(t-${t0})/${hold.toFixed(2)})*${W - 2 * LEFT})':h=12:color=0x${COLORS.yellow}:t=fill:enable='gte(t,${t0})'`);
  }
  return f.join(",\n");
}

/** Durasi satu klip: jeda awal + narasi + (jeda berpikir atau ekor). Dipakai pula oleh orkestrator untuk menakar panjang video. */
export const beatSeconds = (audioSec, hold = 0) => Math.max(2.2, LEAD_SEC + audioSec + (hold > 0 ? hold : TAIL_SEC));

function runProc(cmd, args, { spawnImpl = spawn, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return reject(e);
    }
    let err = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* abaikan */ }
      reject(new Error("ffmpeg terlalu lama"));
    }, timeoutMs);
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", (d) => { err = (err + d.toString()).slice(-4000); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg kode ${code}: ${err.slice(-300)}`));
    });
  });
}

/**
 * createBoardRenderer({ ffmpeg, fonts, channelName, spawnImpl, log })
 *   .render({ beats, wavs, outFile, tmpDir })  -> { file, seconds, timeline: [{ section, start, dur }], overflowClears }
 * `wavs[i]` = Buffer WAV narasi beat i (atau null = tanpa suara).
 */
export function createBoardRenderer({ ffmpeg = "ffmpeg", fonts = findFonts(), channelName = "", spawnImpl = spawn, log = console } = {}) {
  async function render({ beats, wavs, outFile, tmpDir }) {
    if (!fonts.bold) throw new Error("Font tidak ditemukan. Pasang: sudo apt install fonts-dejavu-core (atau isi EDU_FONT di .env).");
    if (beats.length !== wavs.length) throw new Error("jumlah beat dan suara tidak sama");
    fs.mkdirSync(tmpDir, { recursive: true });
    const { frames, overflowClears } = layoutBeats(beats);
    const clips = [];
    const timeline = [];
    let t = 0;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const aSec = wavs[i] ? wavSeconds(wavs[i]) : 0;
      const hold = b.hold || 0;
      const dur = beatSeconds(aSec, hold);
      const textFiles = frames[i].map((l, j) => {
        const f = path.join(tmpDir, `b${i}_l${j}.txt`);
        fs.writeFileSync(f, l.t, "utf8");
        return f;
      });
      const script = path.join(tmpDir, `b${i}.filter`);
      fs.writeFileSync(script, clipFilter({ lines: frames[i], dur, fonts, textFiles, channelName, hold }), "utf8");
      const out = path.join(tmpDir, `clip${String(i).padStart(3, "0")}.mp4`);
      const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", `color=c=0x${BG}:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)}`];
      if (wavs[i]) {
        const wf = path.join(tmpDir, `b${i}.wav`);
        fs.writeFileSync(wf, wavs[i]);
        args.push("-i", wf, "-af", `aresample=44100,aformat=channel_layouts=mono,adelay=${Math.round(LEAD_SEC * 1000)},apad`);
      } else {
        args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono");
      }
      args.push("-filter_script:v", script, "-map", "0:v", "-map", "1:a", "-t", dur.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "1", out);
      await runProc(ffmpeg, args, { spawnImpl, timeoutMs: 180_000 });
      clips.push(out);
      timeline.push({ section: b.section, firstOfSection: !!b.firstOfSection, start: t, dur });
      t += dur;
    }
    const list = path.join(tmpDir, "list.txt");
    fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n"));
    await runProc(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", outFile], { spawnImpl, timeoutMs: 120_000 });
    log.log?.(`🎓 Video papan tulis: ${beats.length} adegan, ${t.toFixed(1)} dtk → ${path.basename(outFile)}`);
    return { file: outFile, seconds: t, timeline, overflowClears };
  }
  return { render, fonts };
}

/** Sampul 1280x720 (PNG): papan hijau, kelas + judul besar. Tanpa wajah/gambar orang. */
export async function renderThumbnail({ kelas, title, outFile, tmpDir, ffmpeg = "ffmpeg", fonts = findFonts(), channelName = "", spawnImpl = spawn }) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const words = String(title).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 20 && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 4);
  const parts = [`drawbox=x=0:y=0:w=${W}:h=${H}:color=0x${FRAME}:t=22`];
  const put = (txt, name) => { const f = path.join(tmpDir, name); fs.writeFileSync(f, txt, "utf8"); return f; };
  const kf = put(kelas, "k.txt");
  parts.push(`drawtext=fontfile='${esc(fonts.bold)}':textfile='${esc(kf)}':expansion=none:fontsize=64:fontcolor=0x${COLORS.pink}:x=(w-text_w)/2:y=70`);
  const lh = 104;
  const y0 = Math.round((H - shown.length * lh) / 2) + 40;
  shown.forEach((t, i) => {
    const f = put(t, `t${i}.txt`);
    parts.push(`drawtext=fontfile='${esc(fonts.bold)}':textfile='${esc(f)}':expansion=none:fontsize=88:fontcolor=0x${i === 0 ? COLORS.yellow : COLORS.white}:x=(w-text_w)/2:y=${y0 + i * lh}`);
  });
  if (channelName) {
    const cf = put(channelName, "c.txt");
    parts.push(`drawtext=fontfile='${esc(fonts.bold)}':textfile='${esc(cf)}':expansion=none:fontsize=36:fontcolor=0x${COLORS.white}@0.7:x=(w-text_w)/2:y=${H - 80}`);
  }
  const script = path.join(tmpDir, "thumb.filter");
  fs.writeFileSync(script, parts.join(",\n"), "utf8");
  await runProc(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", `color=c=0x${BG}:s=${W}x${H}:d=1`, "-filter_script:v", script, "-frames:v", "1", outFile], { spawnImpl, timeoutMs: 60_000 });
  return outFile;
}

/** Bab YouTube dari linimasa: "0:00 Pembukaan" dst. Bab pertama harus 0:00, minimal 3 bab, tiap bab ≥ 10 dtk; selain itu "" (tanpa bab). */
export function chapterText(timeline) {
  const secs = [];
  for (const e of timeline) {
    if (e.firstOfSection) secs.push({ name: e.section, start: e.start, dur: 0 });
    if (secs.length) secs[secs.length - 1].dur += e.dur;
  }
  if (secs.length < 3 || secs.some((s) => s.dur < 10)) return "";
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return secs.map((s, i) => `${mmss(i === 0 ? 0 : s.start)} ${s.name}`).join("\n");
}
