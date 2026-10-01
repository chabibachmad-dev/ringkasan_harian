// Client minimal untuk Gemini API (Google AI Studio) — tier gratis.
// Dokumentasi & daftar model terbaru: https://ai.google.dev/gemini-api/docs/models
// Kalau nama model di bawah sudah tidak berlaku / sering kena error "model
// overloaded", set secret GEMINI_MODEL (model utama) dan/atau
// GEMINI_MODEL_FALLBACK (model cadangan yang otomatis dicoba kalau model
// utama gagal) dengan nama model lain yang tersedia di akun kamu -- tanpa
// perlu ubah kode sama sekali.

const DEFAULT_MODEL = "gemini-3.6-flash";
// Model cadangan: dicoba otomatis kalau model utama gagal terus (mis. 503
// "model overloaded" karena model utama lagi tinggi permintaan). Model
// "legacy" biasanya kapasitasnya lebih longgar dibanding model paling baru.
const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash";

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

export async function callGeminiWithRetry(
  url: string,
  requestBody: string,
  maxAttempts: number = MAX_ATTEMPTS
): Promise<unknown> {
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

    const isLastAttempt = attempt === maxAttempts;
    if (!RETRYABLE_STATUS.has(res.status) || isLastAttempt) {
      throw lastErr;
    }

    const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    console.warn(`Gemini API ${res.status}, percobaan ${attempt}/${maxAttempts} gagal, coba lagi dalam ${delay}ms...`);
    await sleep(delay);
  }

  // Tidak akan pernah sampai sini, tapi TypeScript butuh ini.
  throw lastErr ?? new Error("Gemini API gagal tanpa pesan error.");
}

type GeminiData = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  // Rincian token pemakaian request ini -- dipakai buat estimasi "token
  // terpakai hari ini" + perkiraan biaya (USD) yang ditampilkan di footer
  // aplikasi dan di samping jam tiap bubble pesan (lihat Edge Function
  // `chat`, action "send" & "token_usage"). promptTokenCount/
  // candidatesTokenCount dipisah (bukan cuma totalTokenCount) karena harga
  // input vs output BEDA JAUH (output ±5x lebih mahal) -- lihat
  // estimateCostUsd() di bawah.
  usageMetadata?: {
    totalTokenCount?: number;
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    // gemini-3.x adalah model "thinking" (mikir dulu sebelum jawab) --
    // token buat "mikir" ini DITAGIH DENGAN HARGA OUTPUT oleh Gemini, tapi
    // dihitung TERPISAH dari candidatesTokenCount (bukan bagian darinya).
    // Kalau field ini diabaikan, biaya yang dihitung bisa jauh lebih kecil
    // dari kenyataan -- bahkan $0 kalau jawaban yang terlihat pendek tapi
    // proses mikirnya panjang. Lihat estimateCostUsd() di bawah.
    thoughtsTokenCount?: number;
    // Token dari hasil pencarian Google (tool "google_search") yang
    // dimasukkan balik ke model sebagai konteks tambahan -- ditagih harga
    // INPUT, juga terpisah dari promptTokenCount.
    toolUsePromptTokenCount?: number;
  };
};

// Harga resmi Gemini API per 1 JUTA token (USD), tier berbayar -- lihat
// https://ai.google.dev/gemini-api/docs/pricing. PENTING: harga
// gemini-3.6-flash di bawah ini harga PROMO yang cuma berlaku sampai 31 Des
// 2026 -- per 1 Jan 2027 naik jadi $1.50 input / $7.50 output (sudah
// ditangani otomatis lewat pengecekan tanggal, tidak perlu ubah kode waktu
// itu tiba). Kalau GEMINI_MODEL/GEMINI_MODEL_FALLBACK diganti ke model lain
// yang tidak ada di tabel ini, dianggap sama harganya dengan gemini-3.6-flash
// (supaya tetap ada angka walau kurang presisi, bukan error).
const GEMINI_3_6_FLASH_PRICE_BUMP_AT = new Date("2027-01-01T00:00:00Z");
function getModelPricing(model: string): { input: number; output: number } {
  const table: Record<string, { input: number; output: number }> = {
    "gemini-3.6-flash":
      new Date() < GEMINI_3_6_FLASH_PRICE_BUMP_AT ? { input: 0.75, output: 3.75 } : { input: 1.5, output: 7.5 },
    "gemini-3.5-flash": { input: 1.5, output: 9.0 }
  };
  return table[model] ?? table["gemini-3.6-flash"];
}

// Estimasi biaya (USD) satu request, dari jumlah token prompt & output-nya
// MASING-MASING (bukan totalnya digabung) -- lihat komentar getModelPricing().
function estimateCostUsd(model: string, promptTokens: number, outputTokens: number): number {
  const price = getModelPricing(model);
  return (promptTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

function buildGenerateUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

// Coba beberapa kombinasi (model, jumlah percobaan) berurutan sampai salah
// satu berhasil -- dipakai supaya kalau model utama sedang "overloaded"
// (503) dan tetap gagal walau sudah di-retry, permintaan otomatis dialihkan
// ke model cadangan (GEMINI_MODEL_FALLBACK) alih-alih gagal total. Model
// yang BENAR-BENAR berhasil dikembalikan juga (bukan cuma datanya) --
// dipakai generateChatReply() buat tahu harga mana yang berlaku (lihat
// estimateCostUsd()), karena model utama & cadangan harganya bisa beda.
async function callGeminiWithModelFallback(
  apiKey: string,
  buildBody: () => string,
  steps: { model: string; maxAttempts: number }[]
): Promise<{ data: GeminiData; model: string }> {
  let lastErr: unknown;
  for (const step of steps) {
    try {
      const data = (await callGeminiWithRetry(buildGenerateUrl(step.model, apiKey), buildBody(), step.maxAttempts)) as GeminiData;
      return { data, model: step.model };
    } catch (err) {
      lastErr = err;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`Model "${step.model}" gagal (${reason}), lanjut ke opsi berikutnya...`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Semua percobaan ke Gemini API gagal.");
}

export async function generateSummary(items: NewsItem[], apiKey: string): Promise<SummaryResult> {
  const primaryModel = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  const fallbackModel = Deno.env.get("GEMINI_MODEL_FALLBACK") || DEFAULT_FALLBACK_MODEL;

  const prompt = buildPrompt(items);

  const buildBody = () =>
    JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json"
      }
    });

  const steps = [{ model: primaryModel, maxAttempts: MAX_ATTEMPTS }];
  if (fallbackModel !== primaryModel) {
    steps.push({ model: fallbackModel, maxAttempts: MAX_ATTEMPTS });
  }

  const { data } = await callGeminiWithModelFallback(apiKey, buildBody, steps);
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

// Dipakai waktu pengguna sudah upload "Dokumen Pengetahuan" (lihat Pengaturan
// > Upload Dokumen di aplikasi) -- PDF peraturan/referensi yang teksnya mau
// dijadikan sumber utama, supaya AI tidak perlu cari di web dulu kalau
// jawabannya memang sudah ada di dokumen yang diupload.
const KNOWLEDGE_CONTEXT_INTRO = `Pengguna sudah mengupload dokumen referensi berikut ke dalam aplikasi ini (mis. peraturan/perundangan keuangan). ANGGAP dokumen-dokumen ini sebagai sumber paling terpercaya dan PRIORITASKAN jawaban dari sini -- kalau pertanyaan pengguna bisa dijawab dari isi salah satu dokumen di bawah, jawab dari situ duluan dan sebutkan judul dokumennya, TANPA perlu cari di internet dulu. Cari di Google HANYA kalau jawabannya memang tidak ada di dokumen-dokumen ini, atau topiknya jelas di luar cakupan dokumen ini.`;

function buildSystemText(knowledgeContext: { title: string; content: string }[]): string {
  if (knowledgeContext.length === 0) return CHAT_SYSTEM_PROMPT;

  const docsText = knowledgeContext
    .map((doc) => `=== Dokumen: "${doc.title}" ===\n${doc.content}`)
    .join("\n\n");

  return `${CHAT_SYSTEM_PROMPT}\n\n${KNOWLEDGE_CONTEXT_INTRO}\n\n${docsText}`;
}

export interface ChatReplyResult {
  reply: string;
  // Estimasi token Gemini yang terpakai untuk SATU request ini (prompt +
  // jawaban) -- 0 kalau Gemini kebetulan tidak mengirim usageMetadata (tetap
  // dianggap aman/tidak fatal, cuma estimasi di footer jadi kurang akurat
  // untuk request itu saja).
  tokensUsed: number;
  // Estimasi biaya (USD) request ini -- lihat estimateCostUsd(). 0 kalau
  // usageMetadata tidak ada/tidak lengkap, sama alasannya seperti tokensUsed.
  costUsd: number;
}

export async function generateChatReply(
  messages: ChatMessage[],
  apiKey: string,
  knowledgeContext: { title: string; content: string }[] = []
): Promise<ChatReplyResult> {
  const primaryModel = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  const fallbackModel = Deno.env.get("GEMINI_MODEL_FALLBACK") || DEFAULT_FALLBACK_MODEL;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const systemText = buildSystemText(knowledgeContext);

  const buildBody = (withTools: boolean) =>
    JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents,
      ...(withTools ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { temperature: 0.6 }
    });

  // Urutan percobaan, dari yang paling ideal ke yang paling andal:
  // 1. Model utama + akses internet -- 1x saja, jangan buang waktu retry di
  //    sini kalau lagi "overloaded" (503), soalnya jalur ini yang paling
  //    sering padat permintaannya di tier gratis.
  // 2. Model utama tanpa akses internet -- diberi sisa jatah retry, supaya
  //    kalau cuma jalur "tools"-nya yang sibuk, chat tetap jalan cepat.
  // 3. Model cadangan (GEMINI_MODEL_FALLBACK) tanpa akses internet -- kalau
  //    model utama sendiri yang sedang overloaded total (bukan cuma jalur
  //    tools-nya), pindah ke model lain supaya pesan tidak gagal terkirim.
  let data: GeminiData;
  let modelUsed: string;
  try {
    const result = await callGeminiWithModelFallback(apiKey, () => buildBody(true), [{ model: primaryModel, maxAttempts: 1 }]);
    data = result.data;
    modelUsed = result.model;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`Percobaan chat dengan Google Search grounding gagal (${reason}), lanjut tanpa akses internet...`);
    const steps = [{ model: primaryModel, maxAttempts: MAX_ATTEMPTS - 1 }];
    if (fallbackModel !== primaryModel) {
      steps.push({ model: fallbackModel, maxAttempts: MAX_ATTEMPTS - 1 });
    }
    const result = await callGeminiWithModelFallback(apiKey, () => buildBody(false), steps);
    data = result.data;
    modelUsed = result.model;
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`Respons Gemini (chat) tidak berisi teks yang diharapkan: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const promptTokens = data?.usageMetadata?.promptTokenCount ?? 0;
  const candidatesTokens = data?.usageMetadata?.candidatesTokenCount ?? 0;
  const thoughtsTokens = data?.usageMetadata?.thoughtsTokenCount ?? 0;
  const toolUseTokens = data?.usageMetadata?.toolUsePromptTokenCount ?? 0;
  const totalTokenCount = data?.usageMetadata?.totalTokenCount;

  // Harga INPUT berlaku utk promptTokenCount + toolUsePromptTokenCount
  // (hasil pencarian Google yang disuntikkan balik ke model). Harga OUTPUT
  // berlaku utk candidatesTokenCount (jawaban yang terlihat) +
  // thoughtsTokenCount (proses "mikir" internal model thinking) -- lihat
  // komentar thoughtsTokenCount di atas. Sebelumnya di sini cuma
  // dihitung candidatesTokenCount sendirian, jadi biaya bisa terhitung jauh
  // lebih kecil dari seharusnya (bahkan $0) utk model thinking seperti
  // gemini-3.6-flash.
  let billedInputTokens = promptTokens + toolUseTokens;
  let billedOutputTokens = candidatesTokens + thoughtsTokens;

  const tokensUsed = totalTokenCount ?? billedInputTokens + billedOutputTokens;

  // Jaga-jaga: kalau suatu saat Gemini mengubah bentuk usageMetadata dan
  // keempat rincian di atas semuanya kosong padahal totalTokenCount ADA dan
  // > 0, jangan sampai biaya diam-diam selalu tercatat $0 padahal token
  // sebenarnya sudah banyak -- pakai totalTokenCount sbg estimasi (dihitung
  // harga output, skenario paling "aman"/mahal) drpd dibiarkan nol terus.
  if (billedInputTokens + billedOutputTokens === 0 && tokensUsed > 0) {
    console.warn(
      "generateChatReply: rincian usageMetadata kosong padahal totalTokenCount ada, raw usageMetadata:",
      JSON.stringify(data?.usageMetadata)
    );
    billedOutputTokens = tokensUsed;
  }

  const costUsd = estimateCostUsd(modelUsed, billedInputTokens, billedOutputTokens);

  return { reply: rawText.trim(), tokensUsed, costUsd };
}