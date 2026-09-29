// Client minimal untuk Gemini API (Google AI Studio) — tier gratis.
// Dokumentasi & daftar model terbaru: https://ai.google.dev/gemini-api/docs/models
// Kalau nama model di bawah sudah tidak berlaku, set secret GEMINI_MODEL
// dengan nama model lain yang tersedia di akun kamu (tanpa perlu ubah kode).

const DEFAULT_MODEL = "gemini-3.6-flash";

export interface NewsItem {
  id: number;
  title: string;
  description: string;
  source: string;
  category: "indonesia" | "dunia";
  link: string;
}

export interface SummaryResult {
  indonesia_id: string;
  dunia_id: string;
  indonesia_en: string;
  dunia_en: string;
}

function buildPrompt(items: NewsItem[]): string {
  const listText = items
    .map((it) => `[#${it.id}] (${it.category}, sumber: ${it.source}) ${it.title} — ${it.description}`)
    .join("\n");

  return `Kamu adalah asisten jurnalis yang menulis ringkasan berita harian untuk dibaca satu orang lewat aplikasi pribadinya.

Berikut daftar berita hari ini (judul + cuplikan singkat) dari berbagai sumber, sudah dikelompokkan kategori "indonesia" atau "dunia":

${listText}

Tugas kamu:
1. Tulis ringkasan naratif (bukan daftar/bullet per berita) untuk kategori "indonesia": gabungkan berita-berita bertema sama jadi paragraf yang mengalir, tapi JANGAN hilangkan fakta/esensi penting dari tiap berita. Panjang sekitar 200-400 kata. Kalau daftar berita kategori ini kosong, tulis satu kalimat bahwa tidak ada pembaruan yang berhasil diambil hari ini.
2. Lakukan hal yang sama untuk kategori "dunia".
3. Buat juga versi bahasa Inggris dari kedua ringkasan itu (tulis ulang secara natural, bukan terjemahan kata-per-kata).
4. JANGAN menambahkan fakta, angka, atau kejadian yang tidak ada di daftar. JANGAN menuliskan URL di dalam teks (link sumber akan ditampilkan terpisah oleh aplikasi).
5. Gunakan bahasa yang enak dibaca, netral, dan jelas — bukan gaya clickbait.

Balas HANYA dengan JSON valid (tanpa markdown code fence, tanpa teks lain di luar JSON), persis dengan struktur ini:
{"indonesia_id": "...", "dunia_id": "...", "indonesia_en": "...", "dunia_en": "..."}`;
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Status yang layak dicoba ulang: 503 (model lagi sibuk/overload) dan
// 429 (rate limit) -- keduanya biasanya bersifat sementara. Status lain
// (400 API key salah, 404 model tidak ada, dll) langsung dilempar sebagai
// error tanpa retry karena percobaan ulang tidak akan mengubah hasil.
const RETRYABLE_STATUS = new Set([429, 503]);
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [3000, 8000, 15000]; // jeda sebelum percobaan ke-2, ke-3, ke-4

export async function callGeminiWithRetry(url: string, requestBody: string): Promise<unknown> {
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody
    });

    if (res.ok) {
      return await res.json();
    }

    const errText = await res.text();
    lastErr = new Error(`Gemini API error ${res.status}: ${errText}`);

    const isLastAttempt = attempt === MAX_ATTEMPTS;
    if (!RETRYABLE_STATUS.has(res.status) || isLastAttempt) {
      throw lastErr;
    }

    const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    console.warn(`Gemini API ${res.status}, percobaan ${attempt}/${MAX_ATTEMPTS} gagal, coba lagi dalam ${delay}ms...`);
    await sleep(delay);
  }

  // Tidak akan pernah sampai sini, tapi TypeScript butuh ini.
  throw lastErr ?? new Error("Gemini API gagal tanpa pesan error.");
}

export async function generateSummary(items: NewsItem[], apiKey: string): Promise<SummaryResult> {
  const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = buildPrompt(items);

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json"
    }
  });

  const data = (await callGeminiWithRetry(url, requestBody)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const rawText: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`Respons Gemini tidak berisi teks yang diharapkan: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const cleaned = stripCodeFence(rawText);
  let parsed: SummaryResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_err) {
    throw new Error(`Gagal parse JSON dari Gemini. Isi respons: ${cleaned.slice(0, 800)}`);
  }

  for (const key of ["indonesia_id", "dunia_id", "indonesia_en", "dunia_en"] as const) {
    if (typeof parsed[key] !== "string") {
      throw new Error(`Field "${key}" hilang/tidak valid pada respons Gemini.`);
    }
  }

  return parsed;
}

// ================================================================
// Chat/diskusi -- dipakai oleh Edge Function `chat` untuk fitur diskusi
// pribadi di dalam aplikasi (terpisah dari ringkasan berita harian).
// ================================================================

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const CHAT_SYSTEM_PROMPT = `Kamu adalah asisten pribadi di dalam aplikasi "Daily Insider" milik satu pengguna saja.
Jawab pertanyaan atau ajak diskusi dengan ramah, jelas, dan seringkas mungkin tanpa kehilangan inti jawaban.
Gunakan Bahasa Indonesia kecuali pengguna jelas menulis/minta bahasa lain.
Kamu PUNYA akses ke pencarian Google secara real-time -- pakai untuk mencari info/berita/link terbaru saat relevan (termasuk mencarikan link video YouTube, artikel, atau halaman web lain yang diminta pengguna), dan tuliskan link hasil pencarian yang relevan dalam format markdown [label](url) supaya bisa diklik. Kalau setelah mencari tetap tidak menemukan info yang pasti, katakan terus terang bahwa kamu tidak menemukannya, jangan mengarang.`;

export async function generateChatReply(messages: ChatMessage[], apiKey: string): Promise<string> {
  const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const buildBody = (withTools: boolean) =>
    JSON.stringify({
      system_instruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
      contents,
      ...(withTools ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { temperature: 0.6 }
    });

  let data: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    data = (await callGeminiWithRetry(url, buildBody(true))) as typeof data;
  } catch (err) {
    // Apa pun sebab gagalnya percobaan pertama (model/versi API belum
    // dukung parameter tools/google_search, format error yang tidak
    // terduga, dll), coba lagi TANPA tools supaya chat tetap jalan
    // (walau berarti tanpa akses internet saat itu) daripada gagal total
    // dan pengguna cuma lihat "Gagal mengirim pesan".
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`Percobaan chat dengan Google Search grounding gagal (${reason}), coba ulang tanpa tools...`);
    data = (await callGeminiWithRetry(url, buildBody(false))) as typeof data;
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`Respons Gemini (chat) tidak berisi teks yang diharapkan: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return rawText.trim();
}
