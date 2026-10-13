// Pembungkus suara peramban untuk latihan Speaking: bicara -> teks (SpeechRecognition, atau rekam + server sebagai cadangan)
// dan teks -> suara (speechSynthesis). Semua fungsi aman dipanggil di peramban tanpa dukungan (mengembalikan false / diam).

const recognitionCtor = () => (typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

export const recognitionSupported = () => !!recognitionCtor();
export const synthSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance !== "undefined";

// ---------------------------------------------------------------- pengenalan suara bawaan peramban
// Mulai mendengarkan satu ucapan. Mengembalikan { stop() }.
//   onText(teks, final) dipanggil terus selama bicara; onEnd() sekali saat selesai; onError(kode) bila gagal
//   kode: "denied" (izin mikrofon ditolak) | "service" (layanan suara peramban tak tersedia) | "nospeech" (tak terdengar) | "unsupported" | "stalled" (mesin tak merespons) | kode asli lain.
export function startListening({ lang = "en-US", onText, onEnd, onError, stallMs = 6000 }) {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onError?.("unsupported");
    onEnd?.();
    return { stop() {} };
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let ended = false;
  let alive = false; // sudah ada tanda hidup dari mesin pengenalan (mulai merekam / mendengar suara / hasil)
  let stallTimer = 0;
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(stallTimer);
    onEnd?.();
  };
  const markAlive = () => {
    alive = true;
    clearTimeout(stallTimer);
  };
  // Beberapa peramban (mis. Safari iPad/iPhone, terutama aplikasi layar utama) menerima start() tetapi tak pernah memanggil
  // apa pun: tanpa penjaga ini layar menunggu selamanya. Bila tak ada tanda hidup, hentikan paksa dan laporkan "stalled".
  stallTimer = setTimeout(() => {
    if (alive || ended) return;
    // laporkan DULU: abort() bisa langsung memicu onend, dan pemanggil harus sudah tahu ini "stalled" saat sesi berakhir
    onError?.("stalled");
    try {
      rec.abort();
    } catch {
      /* abaikan */
    }
    finish();
  }, stallMs);
  rec.onstart = markAlive;
  rec.onaudiostart = markAlive;
  rec.onspeechstart = markAlive;
  rec.onresult = (e) => {
    markAlive();
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0]?.transcript ?? "";
      if (e.results[i].isFinal) final = true;
    }
    onText?.(text.replace(/\s+/g, " ").trim(), final);
  };
  rec.onerror = (e) => {
    const code = e?.error || "error";
    if (code === "aborted") return;
    if (code === "not-allowed") onError?.("denied");
    else if (code === "service-not-allowed") onError?.("service"); // layanan suara peramban tidak tersedia (bukan izin mikrofon)
    else if (code === "no-speech") onError?.("nospeech");
    else onError?.(code);
  };
  rec.onend = finish;
  try {
    rec.start();
  } catch (err) {
    onError?.(err instanceof Error ? err.message : "error");
    finish();
  }
  return {
    stop() {
      try {
        rec.stop();
      } catch {
        finish();
      }
      // jaminan keluar: bila onend tak kunjung datang, paksa selesai supaya tombol tidak macet di "Berhenti"
      setTimeout(() => {
        if (ended) return;
        try {
          rec.abort();
        } catch {
          /* abaikan */
        }
        finish();
      }, 1500);
    }
  };
}

// ---------------------------------------------------------------- suara tutor (teks -> suara)
// Peringkat suara bahasa Inggris: suara "Premium/Enhanced/Neural/Natural" paling alami, lalu suara populer yang enak didengar,
// en-US didahulukan. Suara robotik bawaan lama (mis. "Fred", "Albert", "Zarvox") dihindari.
const AVOID = /\b(fred|albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|kathy|organ|princess|ralph|trinoids|whisper|zarvox|superstar|wobble|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const NATURAL = /(premium|enhanced|neural|natural|online|wavenet|studio)/i;
const FAVORITE = /(samantha|ava|allison|susan|nicky|aria|jenny|michelle|emma|zira|google us english|google uk english female|daniel|serena|karen|moira|tessa)/i;

function scoreVoice(v) {
  let s = 0;
  if (/^en[-_]US/i.test(v.lang)) s += 30;
  else if (/^en[-_](GB|AU|IE|CA)/i.test(v.lang)) s += 20;
  else s += 5;
  if (NATURAL.test(v.name)) s += 60;
  if (FAVORITE.test(v.name)) s += 25;
  if (AVOID.test(v.name)) s -= 80;
  if (v.localService) s += 3;
  return s;
}

function pickVoice() {
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
    if (!en.length) return null;
    return en.slice().sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
  } catch {
    return null;
  }
}

export function stopSpeaking() {
  speakToken++;
  stopWav();
  try {
    if (synthSupported()) window.speechSynthesis.cancel();
  } catch {
    /* abaikan */
  }
}

// Penanda "ucapan ke berapa": berubah tiap stopSpeaking()/ucapan baru. Pemanggil yang menunggu data suara dari server
// membandingkannya setelah menunggu, supaya suara basi tidak diputar bila pemain sudah menekan Jeda/Kembali.
export const speechToken = () => speakToken;

// iOS/Safari hanya mengizinkan suara bila diminta dari sentuhan pengguna. Panggil fungsi ini DI DALAM penangan klik/ketuk:
// satu ucapan hening membuka "kunci" sehingga balasan tutor berikutnya (yang datang setelah menunggu server) bisa langsung berbunyi.
// Sekaligus menyiapkan AudioContext untuk rekam suara.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=";
let sharedAudio = null; // satu elemen <audio> yang dibuka kuncinya di ketukan pemain, dipakai ulang untuk suara dari server (cadangan iOS)
function getSharedAudio() {
  if (!sharedAudio && typeof Audio !== "undefined") sharedAudio = new Audio();
  return sharedAudio;
}

export function unlockSpeech() {
  try {
    const a = getSharedAudio();
    if (a && !(curAudio && !curAudio.paused && !curAudio.ended)) {
      a.src = SILENT_WAV;
      a.muted = false;
      const pr = a.play();
      if (pr && pr.catch) pr.catch(() => {});
    }
  } catch {
    /* abaikan */
  }
  try {
    const ac = getAudioContext();
    if (ac) {
      // satu bunyi hening lewat Web Audio membuka kunci pemutaran suara dari server di iOS
      const src = ac.createBufferSource();
      src.buffer = ac.createBuffer(1, 1, 22050);
      src.connect(ac.destination);
      src.start(0);
    }
  } catch {
    /* abaikan */
  }
  if (!synthSupported()) return;
  try {
    const u = new window.SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.rate = 2;
    window.speechSynthesis.speak(u);
  } catch {
    /* abaikan */
  }
}

let speakToken = 0;

// Pecah menjadi kalimat pendek: jeda antarkalimat membuat irama lebih alami, dan menghindari ucapan panjang yang terpotong di Chrome.
function sentencesOf(text) {
  const t = String(text || "")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = t.match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) || [t];
  const out = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (out.length && out[out.length - 1].length < 14) out[out.length - 1] += ` ${s}`;
    else out.push(s);
  }
  return out;
}

// Ucapkan teks bahasa Inggris. onEnd dipanggil setelah selesai (atau gagal / dibatalkan oleh stopSpeaking tidak memanggilnya).
// Bila peramban tak pernah memanggil onend (bug iOS), penjaga waktu memanggilnya. Mengembalikan true bila diminta diputar.
export function speakText(text, { rate = 1, onEnd } = {}) {
  if (!synthSupported() || !String(text || "").trim()) return false;
  try {
    stopSpeaking();
    const token = speakToken;
    const voice = pickVoice();
    const parts = sentencesOf(text);
    let done = false;
    const finish = () => {
      if (done || token !== speakToken) return;
      done = true;
      clearTimeout(guard);
      onEnd?.();
    };
    const guardMs = 2500 + String(text).length * 95; // perkiraan lama bicara + cadangan
    const guard = setTimeout(finish, guardMs + parts.length * 400);
    parts.forEach((part, i) => {
      const u = new window.SpeechSynthesisUtterance(part);
      u.lang = voice?.lang || "en-US";
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = 1.02;
      if (i === parts.length - 1) {
        u.onend = finish;
        u.onerror = finish;
      }
      window.speechSynthesis.speak(u);
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- suara tutor dari server (WAV, Gemini TTS)
// Diputar lewat AudioContext bersama (sudah dibuka kuncinya oleh unlockSpeech di ketukan pemain); bila gagal, lewat elemen <audio>.
let curSource = null;
let curAudio = null;
let curStop = null;

export const audioPlayable = () => !!audioCtxCtor() || (typeof Audio !== "undefined");

function stopWav() {
  const stop = curStop;
  curStop = null;
  if (stop) stop();
}

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Putar WAV (base64). Mengembalikan Promise<boolean>: true bila mulai diputar; onEnd dipanggil saat selesai (tidak dipanggil bila dihentikan).
export async function playWav(b64, { onEnd } = {}) {
  stopWav();
  const token = speakToken;
  let finished = false;
  let guard = 0;
  const done = (natural) => {
    if (finished) return;
    finished = true;
    clearTimeout(guard);
    if (curStop === stop) {
      curStop = null;
      curSource = null;
    }
    if (natural && token === speakToken) onEnd?.();
  };
  const stop = () => {
    try {
      curSource?.stop();
    } catch {
      /* abaikan */
    }
    try {
      curAudio?.pause();
    } catch {
      /* abaikan */
    }
    curSource = null;
    curAudio = null;
    done(false);
  };
  const ac = getAudioContext();
  if (ac) {
    try {
      if (ac.state !== "running") await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 800))]);
      if (ac.state === "running") {
        const buf = await decodeAudio(ac, b64ToArrayBuffer(b64));
        if (token !== speakToken) return false;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(ac.destination);
        src.onended = () => done(true);
        curSource = src;
        curStop = stop;
        guard = setTimeout(() => done(true), buf.duration * 1000 + 1500);
        src.start(0);
        return true;
      }
    } catch {
      /* jatuh ke elemen <audio> */
    }
  }
  if (token !== speakToken) return false;
  try {
    const a = getSharedAudio() || new Audio();
    a.onended = () => done(true);
    a.onerror = () => done(true);
    curAudio = a;
    curStop = stop;
    guard = setTimeout(() => done(true), 30000);
    a.src = `data:audio/wav;base64,${b64}`;
    await a.play();
    return true;
  } catch {
    curAudio = null;
    curStop = null;
    clearTimeout(guard);
    return false;
  }
}

// ---------------------------------------------------------------- rekam suara (cadangan: peramban tanpa pengenalan suara yang andal)
// Merekam dengan MediaRecorder, berhenti otomatis saat pembicara diam (deteksi hening), lalu diubah ke WAV 16 kHz mono 16-bit
// di peramban (format yang diterima server di mana pun, termasuk hasil rekam Safari yang berformat MP4/AAC).
// Teks diperoleh server lewat aksi speak_transcribe.
export const isAppleTouch = () =>
  typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const audioCtxCtor = () => (typeof window === "undefined" ? null : window.AudioContext || window.webkitAudioContext || null);

// Satu AudioContext dipakai bersama (dibuat saat sentuhan pertama): di iOS konteks baru di luar sentuhan tetap "suspended".
let sharedAc = null;
function getAudioContext() {
  const Ctor = audioCtxCtor();
  if (!Ctor) return null;
  if (!sharedAc || sharedAc.state === "closed") sharedAc = new Ctor();
  if (sharedAc.state !== "running") sharedAc.resume?.().catch?.(() => {}); // juga "interrupted" (Safari iOS setelah memakai mikrofon)
  return sharedAc;
}

export const recorderSupported = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined" && !!audioCtxCtor();

// Mikrofon dipertahankan selama percakapan otomatis berjalan (menghindari izin diminta ulang tiap giliran); lepaskan lewat releaseMic().
// Semua aliran yang pernah dibuka dicatat (liveStreams): dua permintaan getUserMedia yang berdekatan atau pelepasan di tengah menunggu izin
// dulu bisa menyisakan aliran "yatim" yang tidak pernah dihentikan -> iPhone terus menampilkan titik/pil oranye walau percakapan selesai.
let micStream = null;
let micNodes = [];
let micPending = null; // permintaan getUserMedia yang sedang menunggu (dipakai bersama agar tidak membuka dua aliran)
let micEpoch = 0; // naik tiap releaseMic(): permintaan yang datang terlambat setelah pelepasan langsung dihentikan
const liveStreams = new Set();
export const micHeld = () => !!micStream || liveStreams.size > 0 || !!micPending;
function stopStream(st) {
  try {
    st.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* abaikan */
      }
      try {
        st.removeTrack(t);
      } catch {
        /* abaikan */
      }
    });
  } catch {
    /* abaikan */
  }
  liveStreams.delete(st);
}
export function releaseMic() {
  micEpoch++;
  micPending = null;
  for (const st of [...liveStreams]) stopStream(st);
  if (micStream) stopStream(micStream);
  micStream = null;
  // putuskan simpul analisis dari AudioContext bersama; kalau tidak, iOS bisa tetap menandai mikrofon "aktif"
  for (const n of micNodes) {
    try {
      n.disconnect();
    } catch {
      /* abaikan */
    }
  }
  micNodes = [];
}
// Tutup AudioContext bersama saat tidak dipakai (iOS menahan sesi audio "rekam+putar" selama konteks hidup setelah mikrofon dipakai).
// Aman: ketukan berikutnya (unlockSpeech) membuat konteks baru. Tidak menutup bila ada suara yang sedang diputar.
export function idleAudio() {
  if (!isAppleTouch() || !sharedAc || sharedAc.state === "closed" || curSource || (curAudio && !curAudio.paused && !curAudio.ended)) return;
  const ac = sharedAc;
  sharedAc = null;
  try {
    ac.close?.().catch?.(() => {});
  } catch {
    /* abaikan */
  }
}
function acquireMic() {
  if (micStream && micStream.getAudioTracks().some((t) => t.readyState === "live")) return Promise.resolve(micStream);
  if (micPending) return micPending;
  const epoch = micEpoch;
  const req = navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then((st) => {
      if (epoch !== micEpoch) {
        // mikrofon sudah dilepas selagi menunggu izin: hentikan aliran ini sekarang juga
        st.getTracks().forEach((t) => t.stop());
        const err = new Error("cancelled");
        err.name = "Cancelled";
        throw err;
      }
      liveStreams.add(st);
      micStream = st;
      return st;
    })
    .finally(() => {
      if (micPending === req) micPending = null;
    });
  micPending = req;
  return req;
}

function pickRecorderType() {
  const list = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
  try {
    return list.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || "";
  } catch {
    return "";
  }
}

function decodeAudio(ctx, buf) {
  return new Promise((resolve, reject) => {
    // Safari lama hanya mendukung bentuk callback
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
}

// AudioBuffer -> { wavBase64, rms, seconds } (mono 16 kHz)
function toWav16k(audioBuf) {
  const rate = 16000;
  const ch = audioBuf.numberOfChannels;
  const len = audioBuf.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const d = audioBuf.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
  }
  const ratio = audioBuf.sampleRate / rate;
  const outLen = Math.max(1, Math.floor(len / ratio));
  const pcm = new Int16Array(outLen);
  let sum = 0;
  for (let i = 0; i < outLen; i++) {
    // rata-rata jendela sumber (penyaring sederhana) lalu dibulatkan ke 16-bit
    const a = Math.floor(i * ratio);
    const b = Math.min(len, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let acc = 0;
    for (let j = a; j < b; j++) acc += mono[j];
    const v = Math.max(-1, Math.min(1, acc / (b - a)));
    sum += v * v;
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(bytes.buffer);
  const wr = (o, str) => {
    for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i));
  };
  wr(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length * 2, true);
  wr(8, "WAVE");
  wr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  wr(36, "data");
  dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { wavBase64: btoa(bin), rms: Math.sqrt(sum / outLen), seconds: outLen / rate };
}

// Mulai merekam. onRecording() dipanggil saat mikrofon benar-benar aktif; onDone({wavBase64, seconds}) setelah berhenti dan konversi;
// onError(kode): "denied" | "nospeech" (terlalu pelan / terlalu singkat / tak ada suara) | "unsupported" | pesan galat lain.
// Berhenti sendiri bila: pembicara diam silenceMs setelah bicara, tak ada suara dalam noSpeechMs, atau maxMs tercapai.
// keepMic=true: mikrofon tidak dilepas setelah rekaman (untuk percakapan otomatis; lepaskan dengan releaseMic()).
// Mengembalikan { stop() } (aman dipanggil berkali-kali).
export function startRecording({ maxMs = 20000, silenceMs = 1400, noSpeechMs = 9000, keepMic = false, onRecording, onDone, onError }) {
  let rec = null;
  let stopped = false;
  let finished = false;
  let timer = 0;
  let vad = 0;
  const cleanup = () => {
    clearTimeout(timer);
    clearInterval(vad);
    if (!keepMic) releaseMic();
  };
  const fail = (code) => {
    if (finished) return;
    finished = true;
    cleanup();
    onError?.(code);
  };
  const handle = {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        if (rec && rec.state !== "inactive") rec.stop();
        else fail("nospeech");
      } catch {
        fail("error");
      }
    }
  };
  if (!recorderSupported()) {
    setTimeout(() => fail("unsupported"), 0);
    return handle;
  }
  acquireMic()
    .then((st) => {
      if (stopped) return fail("nospeech");
      const chunks = [];
      const type = pickRecorderType();
      rec = type ? new window.MediaRecorder(st, { mimeType: type }) : new window.MediaRecorder(st);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      rec.onerror = () => fail("error");
      rec.onstop = async () => {
        clearTimeout(timer);
        clearInterval(vad);
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/mp4" });
          if (blob.size < 800) return fail("nospeech");
          const ac = getAudioContext();
          const decoded = await decodeAudio(ac, await blob.arrayBuffer());
          const w = toWav16k(decoded);
          if (w.seconds < 0.4 || w.rms < 0.004) return fail("nospeech");
          if (finished) return;
          finished = true;
          cleanup();
          onDone?.({ wavBase64: w.wavBase64, seconds: w.seconds });
        } catch (err) {
          fail(err instanceof Error ? err.message : "error");
        }
      };
      // deteksi hening: ambang menyesuaikan kebisingan ruangan (dikalibrasi 0,5 detik pertama)
      try {
        const ac = getAudioContext();
        const src = ac.createMediaStreamSource(st);
        const an = ac.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        micNodes.push(src, an);
        const data = new Uint8Array(an.fftSize);
        const t0 = Date.now();
        let floor = 0;
        let samples = 0;
        let heard = false;
        let lastVoice = t0;
        vad = setInterval(() => {
          an.getByteTimeDomainData(data);
          let s = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            s += v * v;
          }
          const level = Math.sqrt(s / data.length);
          const now = Date.now();
          if (now - t0 < 500) {
            floor = (floor * samples + level) / (samples + 1);
            samples++;
            return;
          }
          const threshold = Math.max(0.02, floor * 3);
          if (level > threshold) {
            heard = true;
            lastVoice = now;
          }
          if (heard && now - lastVoice > silenceMs) handle.stop();
          else if (!heard && now - t0 > noSpeechMs) handle.stop();
        }, 100);
      } catch {
        /* tanpa deteksi hening: pemain menekan Berhenti sendiri, atau maxMs */
      }
      rec.start();
      timer = setTimeout(() => handle.stop(), maxMs);
      onRecording?.();
    })
    .catch((err) => {
      const name = err && err.name;
      if (name === "Cancelled") {
        // mikrofon dilepas selagi menunggu izin: aliran sudah dihentikan di acquireMic; jangan melepas lagi (bisa membatalkan permintaan baru)
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearInterval(vad);
        onError?.("nospeech");
        return;
      }
      fail(name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" ? "denied" : name === "NotFoundError" ? "unsupported" : name === "Cancelled" ? "nospeech" : name || "error");
    });
  return handle;
}
