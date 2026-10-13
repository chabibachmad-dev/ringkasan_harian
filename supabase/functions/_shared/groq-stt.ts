// ================================================================
// Suara -> teks lewat Groq Whisper (gratis, cepat, jatah jauh lebih longgar daripada transkripsi Gemini).
// Dipakai latihan Speaking (action speak_transcribe) sebagai mesin UTAMA; Gemini jadi cadangan.
//
// Secret Supabase (opsional; memakai key Groq yang sama dengan penyedia cadangan chat):
//   GROQ_API_KEYS=gsk_xxx,gsk_yyy      (boleh GROQ_API_KEY satu saja)
//   GROQ_STT_MODEL=whisper-large-v3-turbo
// ================================================================

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_GROQ_STT_MODEL = "whisper-large-v3-turbo";
const restUntil = new Map<string, number>(); // key -> waktu boleh dipakai lagi (setelah 429/401/403/5xx)

export function getGroqSttKeys(get: (n: string) => string | undefined = (n) => Deno.env.get(n)): string[] {
  const raw = get("GROQ_API_KEYS") || get("GROQ_API_KEY") || "";
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

export class GroqSttError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Whisper cenderung "berhalusinasi" pada rekaman hening ("Thank you.", "you"): buang segmen yang jelas bukan ucapan.
export function pickSpeechText(data: { text?: string; segments?: Array<{ text?: string; no_speech_prob?: number; avg_logprob?: number }> }): string {
  const segs = Array.isArray(data?.segments) ? data.segments : [];
  if (segs.length > 0) {
    const kept = segs.filter((s) => !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.8));
    return kept.map((s) => String(s.text ?? "")).join(" ").replace(/\s+/g, " ").trim();
  }
  return String(data?.text ?? "").replace(/\s+/g, " ").trim();
}

export async function transcribeWithGroq(
  audioBase64: string,
  mimeType: string,
  keys: string[],
  opts: { language?: string; prompt?: string; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number } = {}
): Promise<{ text: string; model: string }> {
  if (keys.length === 0) throw new Error("Tidak ada API key Groq.");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const model = opts.model || Deno.env.get("GROQ_STT_MODEL") || DEFAULT_GROQ_STT_MODEL;
  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3" : mimeType.includes("ogg") ? "ogg" : "m4a";
  const bytes = b64ToBytes(audioBase64);
  let lastErr: GroqSttError | Error | null = null;
  for (const key of keys) {
    if (now() < (restUntil.get(key) ?? 0)) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
    try {
      const form = new FormData();
      form.append("file", new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }), `speech.${ext}`);
      form.append("model", model);
      form.append("response_format", "verbose_json");
      form.append("temperature", "0");
      form.append("language", opts.language || "en");
      if (opts.prompt) form.append("prompt", opts.prompt);
      const res = await fetchImpl(GROQ_STT_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: ctrl.signal });
      const raw = await res.text();
      if (!res.ok) throw new GroqSttError(res.status, `Groq STT error ${res.status}: ${raw.slice(0, 160)}`);
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new GroqSttError(502, "Groq STT: jawaban bukan JSON");
      }
      return { text: pickSpeechText(data).slice(0, 600), model };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const st = e instanceof GroqSttError ? e.status : 0;
      if (st === 429 || st === 401 || st === 403 || (st >= 500 && st < 600)) restUntil.set(key, now() + (st === 429 ? 60_000 : 30_000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("Semua key Groq sedang istirahat.");
}
