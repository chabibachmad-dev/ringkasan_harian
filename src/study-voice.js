// Pembungkus suara peramban untuk latihan Speaking: bicara -> teks (SpeechRecognition) dan teks -> suara (speechSynthesis).
// Semua fungsi aman dipanggil di peramban tanpa dukungan (mengembalikan false / tidak melakukan apa-apa).

const recognitionCtor = () => (typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

export const recognitionSupported = () => !!recognitionCtor();
export const synthSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance !== "undefined";

// Mulai mendengarkan satu ucapan. Mengembalikan { stop() }.
//   onText(teks, final) dipanggil terus selama bicara; onEnd() sekali saat selesai; onError(kode) bila gagal
//   kode: "denied" (izin mikrofon ditolak) | "nospeech" (tak terdengar) | "unsupported" | kode asli lain.
export function startListening({ lang = "en-US", onText, onEnd, onError }) {
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
  const finish = () => {
    if (ended) return;
    ended = true;
    onEnd?.();
  };
  rec.onresult = (e) => {
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
    if (code === "not-allowed" || code === "service-not-allowed") onError?.("denied");
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
    }
  };
}

function pickVoice() {
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
    return en.find((v) => /^en[-_]US/i.test(v.lang) && v.localService) || en.find((v) => /^en[-_]US/i.test(v.lang)) || en.find((v) => /^en[-_]GB/i.test(v.lang)) || en[0] || null;
  } catch {
    return null;
  }
}

export function stopSpeaking() {
  try {
    if (synthSupported()) window.speechSynthesis.cancel();
  } catch {
    /* abaikan */
  }
}

// Ucapkan teks bahasa Inggris. Mengembalikan true bila diminta diputar.
export function speakText(text, { rate = 0.9, onEnd } = {}) {
  if (!synthSupported() || !String(text || "").trim()) return false;
  try {
    stopSpeaking();
    const u = new window.SpeechSynthesisUtterance(String(text));
    u.lang = "en-US";
    u.rate = rate;
    const v = pickVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    if (onEnd) {
      u.onend = onEnd;
      u.onerror = onEnd;
    }
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}
