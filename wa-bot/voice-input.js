// ================================================================
// Pesan suara (Telegram) -> teks yang dimengerti bot.
//
// Dua bagian, keduanya tanpa efek samping (mudah dites; lihat test-voice.mjs):
//   1. TRANSKRIPSI: createTranscriber() mengubah rekaman suara (OGG/Opus dari Telegram) jadi teks.
//        Utama  : Groq Whisper (whisper-large-v3-turbo) -- gratis, cepat, bagus untuk bahasa Indonesia. Memakai GROQ_API_KEYS.
//        Cadangan: Gemini (audio inline) -- memakai GEMINI_API_KEYS yang sama dengan bot.
//      Kunci dirotasi: kunci yang kena 429/5xx dilewati dan diistirahatkan sebentar.
//   2. PENYESUAIAN UCAPAN: voiceToCommand() merapikan hasil dengar supaya cocok dengan perintah bot:
//        - "si mab rekam umum" -> "simab rekam umum"
//        - saat sesi SiMAB berjalan: angka dalam kata ("tiga", "nomor lima belas") -> digit; "lima ratus ribu" -> 500000
//        - saat sesi SiMAB berjalan dan ucapannya berisi uraian + tanggal + jumlah ("Pembelian ATK, tanggal 5 Oktober 2026,
//          jumlah satu juta lima ratus ribu rupiah") -> tiga baris (uraian / tanggal / jumlah) seperti yang diminta alur rekam.
// ================================================================

const splitList = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function readSttConfig(env = process.env) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    groqKeys: splitList(env.GROQ_API_KEYS || env.GROQ_API_KEY),
    groqModel: String(env.GROQ_STT_MODEL || "whisper-large-v3-turbo").trim(),
    geminiKeys: splitList(env.GEMINI_API_KEYS || env.GEMINI_API_KEY),
    geminiModel: String(env.GEMINI_STT_MODEL || env.GEMINI_MODEL || "gemini-3.6-flash").trim(),
    language: String(env.VOICE_LANGUAGE || "id").trim().toLowerCase(),
    timeoutMs: num(env.VOICE_STT_TIMEOUT_MS, 45_000),
    maxSeconds: num(env.VOICE_MAX_SECONDS, 180)
  };
}

// Petunjuk kosakata untuk Whisper (maks ±224 token): menurunkan salah dengar istilah SiMAB dan membuat angka ditulis sebagai digit.
const STT_HINT =
  "Transkrip percakapan bahasa Indonesia. Tulis angka dengan digit. Istilah: SiMAB, rekam, seksi Umum, PKN, PN, HI, KI, Lelang, Penilaian, " +
  "uraian, tanggal, jumlah, rupiah, perjadin, pagu, RPD, SBM, KPKNL Denpasar, ATK, meterai, pembelian, belanja barang, berupa.";

const EXT = { "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/flac": "flac" };
const extOf = (mime) => EXT[String(mime || "").toLowerCase().split(";")[0].trim()] || "ogg";
const cleanMime = (mime) => {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  return /^audio\//.test(m) ? (m === "audio/opus" ? "audio/ogg" : m) : "audio/ogg";
};

class SttHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** "fetch failed" saja tidak berguna: sertakan sebab aslinya (mis. ENOTFOUND, ECONNRESET, UND_ERR_CONNECT_TIMEOUT). */
export function describeError(e) {
  const c = e?.cause;
  const cause = c ? [c.code || c.name, c.message && c.message !== e?.message ? c.message : ""].filter(Boolean).join(": ") : "";
  return `${e?.message || e}${cause ? ` [${cause}]` : ""}`;
}

export function createTranscriber({ config = readSttConfig(), fetchImpl = globalThis.fetch, log = console, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const restUntil = new Map(); // "engine|key" -> waktu boleh dipakai lagi
  const hint = (k) => `...${String(k).slice(-4)}`;
  const available = () => config.groqKeys.length > 0 || config.geminiKeys.length > 0;

  async function withTimeout(fn) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
    try {
      return await fn(ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function groqOnce(key, buffer, mime, o = {}) {
    return withTimeout(async (signal) => {
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: cleanMime(mime) }), `voice.${extOf(mime)}`);
      form.append("model", config.groqModel);
      form.append("response_format", "json");
      form.append("temperature", "0");
      const lang = o.language ?? config.language;
      if (lang) form.append("language", lang);
      form.append("prompt", o.hint ?? STT_HINT);
      const res = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal });
      const raw = await res.text();
      if (!res.ok) throw new SttHttpError(res.status, raw.slice(0, 200));
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new SttHttpError(502, "jawaban bukan JSON");
      }
      return String(data?.text ?? "").trim();
    });
  }

  async function geminiOnce(key, buffer, mime, o = {}) {
    return withTimeout(async (signal) => {
      const body = {
        system_instruction: {
          parts: [{ text: "Kamu juru ketik suara. Tulis PERSIS ucapan dalam rekaman (bahasa Indonesia atau Inggris), tanpa menjawab, menerjemahkan, atau menambah komentar. Tulis angka dengan digit. Jika tidak ada ucapan jelas, keluarkan tepat: <silence>" }]
        },
        contents: [{ role: "user", parts: [{ text: "Transkripsikan rekaman ini." }, { inline_data: { mime_type: cleanMime(mime), data: Buffer.from(buffer).toString("base64") } }] }],
        generationConfig: { temperature: 0 }
      };
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal
      });
      const raw = await res.text();
      if (!res.ok) throw new SttHttpError(res.status, raw.slice(0, 200));
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new SttHttpError(502, "jawaban bukan JSON");
      }
      const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("").trim();
      return /^<?\s*silence\s*>?\.?$/i.test(text) ? "" : text.replace(/^["“”']+|["“”']+$/g, "").trim();
    });
  }

  /** -> { text, engine }. text kosong = tidak ada ucapan jelas. Melempar Error bila semua mesin gagal. */
  async function transcribe(buffer, { mime = "audio/ogg", language, hint: sttHint } = {}) {
    if (!available()) throw new Error("Pesan suara belum aktif: isi GROQ_API_KEYS (atau GEMINI_API_KEYS) di .env bot lalu restart.");
    const attempts = [
      ...config.groqKeys.map((k) => ({ engine: "groq", key: k, run: groqOnce })),
      ...config.geminiKeys.map((k) => ({ engine: "gemini", key: k, run: geminiOnce }))
    ];
    let lastErr = null;
    for (const a of attempts) {
      const id = `${a.engine}|${a.key}`;
      if (now() < (restUntil.get(id) ?? 0)) continue;
      for (let tryNo = 0; tryNo < 2; tryNo++) {
        try {
          const text = await a.run(a.key, buffer, mime, { language, hint: sttHint });
          return { text, engine: a.engine };
        } catch (e) {
          lastErr = e;
          const status = e?.status;
          // gangguan jaringan sesaat (tanpa kode HTTP, mis. "fetch failed" / koneksi lama ditutup): coba sekali lagi di key yang sama
          if (status === undefined && tryNo === 0) {
            log.warn?.(`🎤 STT ${a.engine} ${hint(a.key)} gangguan jaringan (${describeError(e).slice(0, 160)}), mengulang...`);
            await sleep(600);
            continue;
          }
          if (status === 429 || status === 401 || status === 403 || (status >= 500 && status < 600)) restUntil.set(id, now() + (status === 429 ? 60_000 : 30_000));
          log.warn?.(`🎤 STT ${a.engine} ${hint(a.key)} gagal (${status ?? e?.name ?? "error"}): ${describeError(e).slice(0, 200)}`);
          break;
        }
      }
    }
    throw new Error(`Gagal mengubah suara jadi teks (${lastErr ? describeError(lastErr).slice(0, 200) : "semua mesin sedang istirahat"}).`);
  }

  return { available, transcribe };
}

// ---------------------------------------------------------------- angka dalam kata (Indonesia)
const UNIT = { nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
const NUMWORDS = new Set([...Object.keys(UNIT), "sepuluh", "sebelas", "belas", "puluh", "seratus", "ratus", "seribu", "ribu", "sejuta", "juta", "semiliar", "miliar"]);

/** Nilai dari deretan kata bilangan, mis. ["satu","juta","lima","ratus","ribu"] -> 1500000. null bila tidak berbentuk bilangan. */
function valueOfWords(words) {
  let total = 0;
  let chunk = 0;
  let last = 0; // satuan terakhir yang menempel di chunk (untuk "dua puluh", "tiga ratus")
  for (const w of words) {
    if (w in UNIT) {
      chunk += UNIT[w];
      last = UNIT[w];
    } else if (w === "sepuluh") {
      chunk += 10;
      last = 0;
    } else if (w === "sebelas") {
      chunk += 11;
      last = 0;
    } else if (w === "belas") {
      if (last === 0) return null;
      chunk += 10;
      last = 0;
    } else if (w === "puluh") {
      if (last === 0) return null;
      chunk = chunk - last + last * 10;
      last = 0;
    } else if (w === "seratus") {
      chunk += 100;
      last = 0;
    } else if (w === "ratus") {
      if (last === 0) return null;
      chunk = chunk - last + last * 100;
      last = 0;
    } else if (w === "seribu") {
      total += (chunk || 0) + 1000;
      chunk = 0;
      last = 0;
    } else if (w === "ribu") {
      total += (chunk || 1) * 1000;
      chunk = 0;
      last = 0;
    } else if (w === "sejuta") {
      total += (chunk || 0) + 1_000_000;
      chunk = 0;
      last = 0;
    } else if (w === "juta") {
      total += (chunk || 1) * 1_000_000;
      chunk = 0;
      last = 0;
    } else if (w === "semiliar") {
      total += (chunk || 0) + 1_000_000_000;
      chunk = 0;
      last = 0;
    } else if (w === "miliar") {
      total += (chunk || 1) * 1_000_000_000;
      chunk = 0;
      last = 0;
    } else return null;
  }
  return total + chunk;
}

/** Ganti deretan kata bilangan di dalam teks menjadi digit ("tanggal lima oktober dua ribu dua puluh enam" -> "tanggal 5 oktober 2026"). */
export function wordsToDigits(text) {
  const pieces = String(text ?? "").match(/\p{L}+|[^\p{L}]+/gu) || [];
  let out = "";
  let run = []; // potongan asli yang membentuk satu deretan bilangan: kata, spasi, kata, ...
  const flush = () => {
    if (!run.length) return;
    while (run.length && !NUMWORDS.has(run[run.length - 1].toLowerCase())) out += run.pop(); // jangan menelan spasi di ujung
    const words = run.filter((p) => NUMWORDS.has(p.toLowerCase())).map((p) => p.toLowerCase());
    // "2 juta" / "1,5 ribu": pengali yang didahului angka digit dibiarkan apa adanya
    if (words.length && words.every((w) => w === "juta" || w === "ribu" || w === "miliar") && /\d[ \t]*$/.test(out)) {
      out += run.join("");
      run = [];
      return;
    }
    const v = words.length ? valueOfWords(words) : null;
    out += v === null ? run.join("") : String(v);
    run = [];
  };
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k];
    const isNum = /^\p{L}+$/u.test(p) && NUMWORDS.has(p.toLowerCase());
    if (isNum) {
      run.push(p);
    } else if (run.length && /^[ \t]+$/.test(p) && NUMWORDS.has((pieces[k + 1] || "").toLowerCase())) {
      run.push(p); // spasi di antara dua kata bilangan
    } else {
      flush();
      out += p;
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- ucapan -> perintah
const stripEdge = (s) => String(s ?? "").replace(/^[\s"“”'.,;:!?-]+|[\s"“”'.,;:!?-]+$/g, "").trim();

/** Nama SiMAB sering salah dengar di awal ucapan. */
function fixSimabWord(t) {
  return t.replace(/^\s*(?:si\s?mab|sim\s?ab|simap|semab|sima\s?b|simmab)\b[\s,.:]*/i, "simab ");
}

// Ucapan "enter" / "baris baru" = pindah baris (Whisper menuliskannya sebagai kata biasa: "... materai. Enter. Tanggal ...").
const SPOKEN_BREAK = /[.,;:!]?\s*\b(?:enter|entar|baris baru|garis baru|new\s?line|ganti baris|pindah baris)\b[.,;:!]*\s*/gi;
export function spokenBreaks(t) {
  return String(t ?? "").replace(SPOKEN_BREAK, "\n");
}

// Jumlah uang di ujung kalimat tanpa kata "jumlah": "Rp 1 juta", "2 juta", "1.500.000" (angka tahun polos tidak dihitung).
const MONEY_TAIL = /(?:\brp\.?\s*\d[\d.,]*(?:\s*(?:juta|jt|ribu|rb|miliar))?|\b\d[\d.,]*\s*(?:juta|jt|ribu|rb|miliar)|\b\d{1,3}(?:\.\d{3})+(?:,-)?)(?:\s*rupiah)?\s*[.!]?$/i;

const cleanDate = (x) =>
  stripEdge(x)
    .replace(/^(?:tanggal|tgl)\b[\s:,.-]*(?:dokumen\b[\s:,.-]*)?/i, "")
    .replace(/\b(?:bulan|tahun)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;]+$/, "");
const cleanMoney = (x) =>
  stripEdge(x)
    .replace(/^(?:jumlah|nominal|senilai|sebesar|total)\b[\s:,.-]*/i, "")
    .replace(/\b(?:rupiah|rp\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;]+$/, "");

/** Tiga bagian dipisah "enter": uraian / tanggal / jumlah (kata penanda boleh ada atau tidak). */
function rekamByBreaks(t) {
  const parts = String(t).split("\n").map(stripEdge).filter(Boolean);
  if (parts.length !== 3) return null;
  const uraian = parts[0].replace(/^uraian\b[\s:,.-]*/i, "").replace(/\s+/g, " ").trim();
  const tgl = cleanDate(parts[1]);
  const jml = cleanMoney(parts[2]);
  if (uraian.length < 3 || !tgl || !jml) return null;
  return `${uraian}\n${tgl}\n${jml}`;
}

function rekamThreeLines(t) {
  const kindOf = (w) => (/^uraian$/i.test(w) ? "u" : /^tanggal$/i.test(w) ? "t" : "j");
  const marks = [];
  const seen = new Set();
  for (const m of t.matchAll(/\b(uraian|tanggal|jumlah|nominal|senilai|sebesar|total)\b/gi)) {
    const k = kindOf(m[1]);
    if (seen.has(k)) continue; // kemunculan kedua jenis yang sama = bagian dari isi, bukan pembatas
    seen.add(k);
    marks.push({ k, start: m.index, end: m.index + m[0].length });
  }
  if (!seen.has("t")) return null;
  if (!seen.has("j")) {
    // tanpa kata "jumlah": uang di ujung ucapan (setelah tanggal) dianggap jumlah
    const tm = marks.find((m) => m.k === "t");
    const rest = t.slice(tm.end);
    const mm = MONEY_TAIL.exec(rest);
    if (!mm || mm.index === 0) return null;
    const pos = tm.end + mm.index;
    marks.push({ k: "j", start: pos, end: pos });
    marks.sort((x, y) => x.start - y.start);
  }
  const seg = {};
  marks.forEach((m, i) => {
    seg[m.k] = t.slice(m.end, i + 1 < marks.length ? marks[i + 1].start : t.length);
  });
  if (!seg.u) seg.u = t.slice(0, marks[0].start); // tanpa kata "uraian": kalimat di depan = uraian
  const uraian = stripEdge(seg.u).replace(/\s+/g, " ");
  if (uraian.length < 3) return null;
  const tgl = cleanDate(seg.t);
  const jml = cleanMoney(seg.j);
  if (!tgl || !jml) return null;
  return `${uraian}\n${tgl}\n${jml}`;
}

/**
 * Hasil dengar -> teks perintah untuk bot.
 *  - inSession: pemilik sedang di tengah alur SiMAB (rekam/ubah/hapus). Angka kata diubah jadi digit, dan ucapan lengkap
 *    "uraian ..., tanggal ..., jumlah ..." dijadikan tiga baris.
 * Mengembalikan { text, changed } -- changed=true bila berbeda dari yang terdengar (untuk ditampilkan ke pemilik).
 */
export function voiceToCommand(heard, { inSession = false } = {}) {
  const original = String(heard ?? "").replace(/\s+/g, " ").trim();
  if (!original) return { text: "", changed: false };
  let t = fixSimabWord(original);
  const isSimab = /^simab\b/i.test(t);
  if (!inSession && !isSimab) return { text: original.replace(/^[\s"“”]+|[\s"“”]+$/g, ""), changed: false };

  t = wordsToDigits(t);
  if (inSession) {
    const broken = spokenBreaks(t);
    const three = rekamByBreaks(broken) || rekamThreeLines(broken.replace(/\s+/g, " "));
    if (three) return { text: three, changed: three !== original };
    // jawaban pendek (pilihan / perintah): "nomor 3.", "Ya.", "Lanjut!" -> "3", "ya", "lanjut"
    const short = stripEdge(t);
    const num = /^(?:nomor|nomer|no|pilih|pilihan|angka)?\s*(\d{1,4})$/i.exec(short);
    if (num) return { text: num[1], changed: num[1] !== original };
    if (/^[\p{L}]+(?:\s[\p{L}]+)?$/u.test(short) && short.length <= 14) return { text: short.toLowerCase(), changed: short.toLowerCase() !== original };
    // jumlah sendirian ("Rp 1.500.000." / "satu juta lima ratus ribu rupiah")
    const only = stripEdge(t.replace(/\b(?:rupiah)\b/gi, ""));
    if (/^(?:rp\.?\s*)?[\d.,]+(?:\s?(?:jt|juta|rb|ribu|miliar))?$/i.test(only)) return { text: only, changed: only !== original };
  }
  const cleaned = stripEdge(t) === "" ? t : t.replace(/[.!]+$/, "").trim();
  return { text: cleaned, changed: cleaned !== original };
}
