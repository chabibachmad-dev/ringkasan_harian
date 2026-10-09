// Client minimal untuk Gemini API (Google AI Studio) — tier gratis.
// Dokumentasi & daftar model terbaru: https://ai.google.dev/gemini-api/docs/models
// Kalau nama model di bawah sudah tidak berlaku / sering kena error "model
// overloaded", set secret GEMINI_MODEL (model utama) dan/atau
// GEMINI_MODEL_FALLBACK (model cadangan yang otomatis dicoba kalau model
// utama gagal) dengan nama model lain yang tersedia di akun kamu -- tanpa
// perlu ubah kode sama sekali.

import { buildWebGroundedMessage, buildWebQuery, searchBing } from "./knowledge.ts";
import { getFallbackChain } from "./llm-fallback.ts";
import { getWebSearch } from "./web-search.ts";

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

// Error dari Gemini API dgn kode status HTTP-nya -- dipakai rotasi API key di
// bawah buat membedakan "kuota habis (429)" dari error lain.
export class GeminiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiHttpError";
    this.status = status;
  }
}

export async function callGeminiWithRetry(
  url: string,
  requestBody: string,
  maxAttempts: number = MAX_ATTEMPTS,
  // false = 429 langsung dilempar tanpa retry (dipakai waktu ada >1 API key,
  // supaya langsung pindah ke key berikutnya, bukan nunggu 3-15 detik dulu).
  retryOn429: boolean = true
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
    lastErr = new GeminiHttpError(res.status, `Gemini API error ${res.status}: ${errText}`);

    const isLastAttempt = attempt === maxAttempts;
    const retryable = RETRYABLE_STATUS.has(res.status) && !(res.status === 429 && !retryOn429);
    if (!retryable || isLastAttempt) {
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
//
// ROTASI BEBERAPA API KEY: apiKeys boleh lebih dari satu (lihat
// getGeminiApiKeys). Di tiap step, key dicoba berurutan -- begitu satu key
// kena 429 (kuota habis), langsung pindah ke key berikutnya (looping, bukan
// nunggu retry). Kuota Gemini itu per-key PER-MODEL, jadi status "habis"
// dicatat per kombinasi (tag, model, key): model cadangan tetap punya jatah
// sendiri walau model utama di key yang sama sudah habis.
async function callGeminiWithModelFallback(
  apiKeys: string[],
  buildBody: () => string,
  steps: { model: string; maxAttempts: number }[],
  tag = "plain" // pembeda jalur (mis. "tools" vs "plain") buat catatan key habis
): Promise<{ data: GeminiData; model: string }> {
  let lastErr: unknown;
  const multiKey = apiKeys.length > 1;
  for (const step of steps) {
    const candidates = availableKeysInOrder(apiKeys, tag, step.model);
    if (candidates.length === 0) {
      lastErr = new Error(`Semua API key Gemini (${apiKeys.length}) sedang kena batas kuota untuk model "${step.model}".`);
      console.warn(String((lastErr as Error).message));
      continue;
    }
    for (const apiKey of candidates) {
      try {
        const data = (await callGeminiWithRetry(
          buildGenerateUrl(step.model, apiKey),
          buildBody(),
          step.maxAttempts,
          !multiKey
        )) as GeminiData;
        await reportKeyEvent({ keyHint: geminiKeyHint(apiKey), kind: "success", model: step.model });
        return { data, model: step.model };
      } catch (err) {
        lastErr = err;
        const reason = err instanceof Error ? err.message : String(err);
        if (multiKey && err instanceof GeminiHttpError && err.status === 429) {
          const info = markKeyExhausted(apiKeys, apiKey, tag, step.model, err.message);
          // 429 NON-harian di jalur Google Search ("tools") biasanya cuma batas
          // sementara/khusus fitur pencarian -- BUKAN tanda key-nya habis.
          // Jangan muter ke semua key lain di jalur ini (membuang 1 request
          // per key tiap pesan & bikin SEMUA key kelihatan "habis" padahal
          // jalur biasa tanpa pencarian masih lancar) dan jangan dicatat
          // sebagai key habis di dashboard: langsung lanjut ke step berikutnya
          // (tanpa internet), yang punya rotasi key sendiri.
          if (!info.daily && tag.endsWith("-tools")) {
            console.warn(`Jalur Google Search kena 429 non-harian (${err.message.slice(0, 160)}), lanjut tanpa internet.`);
            break;
          }
          await reportKeyEvent({
            keyHint: geminiKeyHint(apiKey),
            kind: "exhausted",
            model: step.model,
            daily: info.daily,
            exhaustedUntilMs: info.untilMs,
            error: summarizeGeminiError(err.message)
          });
          continue; // coba key berikutnya utk step/model yang sama
        }
        console.warn(`Model "${step.model}" gagal (${reason}), lanjut ke opsi berikutnya...`);
        break; // error selain kuota: pindah ke step berikutnya (spt sebelumnya)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Semua percobaan ke Gemini API gagal.");
}

// ---------------- Pelaporan pemakaian key (buat layar "Status API Gemini") ----------------
// Edge Function pemanggil (chat) bisa mendaftarkan "reporter" lewat
// setGeminiKeyReporter() buat mencatat tiap panggilan sukses & tiap key yang
// kena kuota ke database (tabel gemini_key_usage). Disengaja berupa hook,
// bukan import langsung ke Supabase, supaya file bersama ini tetap bersih dari
// urusan database. Kegagalan reporter TIDAK PERNAH menggagalkan chat.
export interface GeminiKeyEvent {
  keyHint: string; // 4 karakter terakhir key -- key aslinya tidak pernah keluar dari sini
  kind: "success" | "exhausted";
  model: string;
  daily?: boolean;
  exhaustedUntilMs?: number;
  error?: string;
}
let keyReporter: ((event: GeminiKeyEvent) => Promise<void> | void) | null = null;

export function setGeminiKeyReporter(fn: ((event: GeminiKeyEvent) => Promise<void> | void) | null): void {
  keyReporter = fn;
}

export function geminiKeyHint(apiKey: string): string {
  return apiKey.slice(-4);
}

// Ambil teks jawaban dari respons Gemini dengan menggabung SEMUA bagian
// (parts) berupa teks. Model "thinking" kadang mengirim bagian PERTAMA
// berisi text:"" + thoughtSignature, dan jawaban aslinya baru ada di bagian
// berikutnya -- membaca parts[0] saja salah mengira respons kosong.
// deno-lint-ignore no-explicit-any
function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    // deno-lint-ignore no-explicit-any
    .filter((p: any) => typeof p?.text === "string" && !p.thought)
    // deno-lint-ignore no-explicit-any
    .map((p: any) => p.text as string)
    .join("");
}

// Ringkas pesan error 429 dari Google jadi 1 baris yang memuat PENYEBAB-nya.
// Respons aslinya JSON panjang; bagian yang berguna (quotaId / quotaMetric,
// model, retryDelay) ada di "details" SETELAH kalimat generik "You exceeded
// your current quota...", jadi kalau cuma dipotong dari depan bagian itu
// hilang. Gagal parse = jatuh ke potongan teks mentah.
// deno-lint-ignore no-explicit-any
function summarizeGeminiError(raw: unknown): string {
  const text = String(raw ?? "");
  try {
    const start = text.indexOf("{");
    // deno-lint-ignore no-explicit-any
    const parsed: any = start >= 0 ? JSON.parse(text.slice(start)) : null;
    const e = parsed?.error;
    if (e) {
      const parts: string[] = [];
      if (e.code) parts.push(String(e.code));
      // deno-lint-ignore no-explicit-any
      const violations: any[] = [];
      let retry = "";
      for (const d of e.details ?? []) {
        if (Array.isArray(d?.violations)) violations.push(...d.violations);
        if (d?.retryDelay) retry = String(d.retryDelay);
      }
      for (const v of violations.slice(0, 3)) {
        const model = v?.quotaDimensions?.model;
        parts.push(`${v?.quotaId || v?.quotaMetric || "kuota?"}${model ? ` [${model}]` : ""}`);
      }
      if (retry) parts.push(`retry ${retry}`);
      const msg = String(e.message ?? "").split("\n")[0].slice(0, 140);
      if (msg) parts.push(msg);
      if (parts.length > 1 || (parts.length === 1 && msg)) return parts.join(" | ").slice(0, 600);
    }
  } catch {
    // bukan JSON -- pakai teks mentah di bawah
  }
  return text.slice(0, 600);
}

async function reportKeyEvent(event: GeminiKeyEvent): Promise<void> {
  if (!keyReporter) return;
  try {
    await keyReporter(event);
  } catch (err) {
    console.warn("Gagal melaporkan status key Gemini:", err instanceof Error ? err.message : String(err));
  }
}

// ---------------- Rotasi API key ----------------
// Baca daftar API key dari secret GEMINI_API_KEYS (dipisah koma) -- kalau
// kosong, jatuh ke GEMINI_API_KEY (satu key, nama lama) supaya setup lama
// tidak rusak. Return array kosong kalau dua-duanya belum di-set.
export function getGeminiApiKeys(): string[] {
  const raw = Deno.env.get("GEMINI_API_KEYS") || Deno.env.get("GEMINI_API_KEY") || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Catatan "key ini lagi habis sampai kapan" -- disimpan di memori isolate
// Edge Function (bertahan selama instance masih "hangat"; kalau instance
// baru, catatan hilang & key habis dicoba sekali lagi lalu ditandai lagi --
// biayanya cuma 1 request ditolak, tidak fatal).
const exhaustedUntil = new Map<string, number>();
let keyCursor = 0;

function exhaustedId(tag: string, model: string, apiKey: string): string {
  return `${tag}|${model}|${apiKey}`;
}

function nextMidnightPacificMs(): number {
  const pacificNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const nextMidnight = new Date(pacificNow);
  nextMidnight.setHours(24, 0, 5, 0);
  return Date.now() + (nextMidnight.getTime() - pacificNow.getTime());
}

// Key yang belum ditandai habis utk (tag, model) ini, mulai dari keyCursor
// supaya gilirannya muter (key yang lagi dipakai tetap dipakai sampai habis,
// baru geser ke berikutnya).
function availableKeysInOrder(apiKeys: string[], tag: string, model: string): string[] {
  const now = Date.now();
  const result: string[] = [];
  for (let i = 0; i < apiKeys.length; i++) {
    const key = apiKeys[(keyCursor + i) % apiKeys.length];
    if (now >= (exhaustedUntil.get(exhaustedId(tag, model, key)) ?? 0)) result.push(key);
  }
  return result;
}

function markKeyExhausted(
  apiKeys: string[],
  apiKey: string,
  tag: string,
  model: string,
  errorMessage: string
): { daily: boolean; untilMs: number } {
  // 429 "PerDay" = jatah harian habis (tunggu reset tengah malam Pacific);
  // 429 lain biasanya cuma rate-limit per menit -- cukup istirahat 1 menit.
  const daily = /PerDay/i.test(errorMessage);
  const untilMs = daily ? nextMidnightPacificMs() : Date.now() + 60_000;
  exhaustedUntil.set(exhaustedId(tag, model, apiKey), untilMs);
  const idx = apiKeys.indexOf(apiKey);
  keyCursor = (idx + 1) % apiKeys.length;
  console.warn(
    `API key Gemini #${idx + 1}/${apiKeys.length} kena ${daily ? "kuota harian" : "rate limit"} (model "${model}"), pindah ke key berikutnya.`
  );
  return { daily, untilMs };
}

export async function generateSummary(items: NewsItem[], apiKeyOrKeys: string | string[]): Promise<SummaryResult> {
  const apiKeys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];
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

  const { data } = await callGeminiWithModelFallback(apiKeys, buildBody, steps, "summary");
  const rawText: string | undefined = extractGeminiText(data) || undefined;
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

const CHAT_SYSTEM_PROMPT = `Namamu Ayyubi. Kamu adalah asisten pribadi di dalam aplikasi "Ayyubi" milik satu pengguna saja.
Jawab pertanyaan atau ajak diskusi dengan ramah, jelas, dan seringkas mungkin tanpa kehilangan inti jawaban.
Gunakan Bahasa Indonesia kecuali pengguna jelas menulis/minta bahasa lain.
Kamu PUNYA akses ke pencarian Google secara real-time -- pakai untuk mencari info/berita/link terbaru saat relevan (termasuk mencarikan link video YouTube, artikel, atau halaman web lain yang diminta pengguna), dan tuliskan link hasil pencarian yang relevan dalam format markdown [label](url) supaya bisa diklik. Kalau setelah mencari tetap tidak menemukan info yang pasti, katakan terus terang bahwa kamu tidak menemukannya, jangan mengarang.`;

// Dipakai waktu pengguna sudah upload "Dokumen Pengetahuan" (lihat Pengaturan
// > Upload Dokumen di aplikasi) -- PDF peraturan/referensi yang teksnya mau
// dijadikan sumber utama, supaya AI tidak perlu cari di web dulu kalau
// jawabannya memang sudah ada di dokumen yang diupload.
const KNOWLEDGE_CONTEXT_INTRO = `Pengguna sudah mengupload dokumen referensi berikut ke dalam aplikasi ini (mis. peraturan/perundangan keuangan). ANGGAP dokumen-dokumen ini sebagai sumber paling terpercaya dan PRIORITASKAN jawaban dari sini -- kalau pertanyaan pengguna bisa dijawab dari isi salah satu dokumen di bawah, jawab dari situ duluan dan sebutkan judul dokumennya, TANPA perlu cari di internet dulu. Cari di Google HANYA kalau jawabannya memang tidak ada di dokumen-dokumen ini, atau topiknya jelas di luar cakupan dokumen ini.`;

// Ditambahkan kalau yang dikirim cuma POTONGAN dokumen yang relevan (bukan
// seluruh dokumen) -- supaya model tidak menyimpulkan "dokumennya tidak memuat
// itu" hanya karena potongan yang kebetulan terkirim belum memuatnya.
const KB_EXCERPT_NOTE =
  "CATATAN: yang disertakan di bawah hanyalah POTONGAN dokumen yang paling relevan dengan pertanyaan (bukan seluruh dokumen), dan tabel panjang bisa terpotong di tengah. Kalau jawabannya tidak ada di potongan ini, katakan terus terang bahwa potongan yang tersedia belum memuatnya -- JANGAN menyimpulkan bahwa dokumennya tidak memuatnya.";

// Mode DOKUMEN KETAT: potongan datang dari indeks laptop (lengkap, ber-halaman). Model hanya boleh
// menjawab dari potongan itu -- tanpa Google Search, suhu rendah, kutipan wajib bisa diperiksa mesin
// (lihat _shared/docguard.ts).
const STRICT_DOC_RULES = `ATURAN DOKUMEN (WAJIB):
- Untuk pertanyaan tentang isi dokumen, jawab HANYA berdasarkan teks di bawah. Jangan menebak dan jangan memakai pengetahuan luar untuk fakta, angka, pasal, istilah, tarif, atau daftar.
- Kalau jawabannya tidak ada di teks itu, tulis persis: "Informasi tidak ada di dokumen." Boleh ditambah satu kalimat tentang apa yang ADA di potongan yang ditemukan. JANGAN menyimpulkan bahwa dokumen aslinya tidak memuatnya -- yang kamu lihat hanya potongan.
- Setiap fakta ditulis dengan rujukan (Judul dokumen, hlm N) memakai nomor dari penanda [Halaman n].
- Untuk angka, tarif, syarat, pasal, atau definisi, sertakan KUTIPAN PERSIS satu kalimat/frasa penting dari teks di antara tanda « dan » (salin apa adanya, jangan diubah). Jangan membuat kutipan yang tidak ada di teks.
- Kalau diminta daftar (rukun, wajib, syarat, langkah): tuliskan SEMUA butir yang benar-benar tertulis, tidak menambah dan tidak mengurangi. Bila daftar tampak terpotong di ujung potongan, katakan "daftar di potongan ini mungkin belum lengkap".
- Kalau potongan hanya berupa daftar isi atau judul bab tanpa isinya, katakan isi bagian itu belum terbaca.
- Teks bisa berisi salah-baca hasil scan (huruf aneh). Bila angka/kata kunci tampak rusak atau ragu, katakan ragu dan sarankan memeriksa dokumen aslinya.
- Sapaan atau obrolan umum yang tidak menyangkut dokumen: jawab seperti biasa.`;

// Toggle dokumen aktif, tetapi tidak ada satu pun potongan yang cocok dengan pertanyaan.
const NO_MATCH_NOTE =
  "CATATAN: pengguna mengaktifkan Dokumen Pengetahuan, tetapi pencarian di dokumen TIDAK menemukan bagian yang cocok dengan pertanyaan ini. Kalau pertanyaannya menyangkut isi dokumen, jawab: \"Informasi tidak ada di dokumen.\" (jangan menjawab dari ingatan seolah-olah dari dokumen). Kalau pertanyaannya umum / di luar dokumen, jawab seperti biasa dan sebut singkat bahwa jawabannya bukan dari dokumen.";

function buildSystemText(
  knowledgeContext: { title: string; content: string }[],
  kbExcerpts = false,
  mode: { strictDocs?: boolean; docNoMatch?: boolean } = {}
): string {
  // Model TIDAK tahu tanggal hari ini kecuali diberi tahu -- tanpa ini ia
  // menjawab pakai "kalender" data latihannya. Zona WITA, sama dgn bot WA.
  const nowText = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Makassar"
  }).format(new Date());
  const base = `${CHAT_SYSTEM_PROMPT}\n\nWaktu sekarang: ${nowText} WITA. Anggap ini tanggal hari ini. Jangan mengira tahun ini masih tahun sebelumnya, dan jangan bilang aturan/peraturan tahun ini "belum terbit" atau "akan terbit" kecuali hasil pencarian memastikannya.`;

  if (knowledgeContext.length === 0) return mode.docNoMatch ? `${base}\n\n${NO_MATCH_NOTE}` : base;

  const docsText = knowledgeContext
    .map((doc) => `=== Dokumen: "${doc.title}" ===\n${doc.content}`)
    .join("\n\n");

  if (mode.strictDocs) return `${base}\n\n${STRICT_DOC_RULES}\n\n${docsText}`;
  return `${base}\n\n${KNOWLEDGE_CONTEXT_INTRO}${kbExcerpts ? `\n${KB_EXCERPT_NOTE}` : ""}\n\n${docsText}`;
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
  // Diisi hanya kalau jawaban datang dari penyedia cadangan ("groq/llama-...", "openrouter/..."), bukan Gemini.
  provider?: string;
}

export async function generateChatReply(
  messages: ChatMessage[],
  apiKeyOrKeys: string | string[],
  knowledgeContext: { title: string; content: string }[] = [],
  options: {
    kbExcerpts?: boolean;
    strictDocs?: boolean;
    docNoMatch?: boolean;
    // Pilihan agent dari aplikasi: "auto" (Gemini lalu cadangan, bawaan) atau satu penyedia saja
    // ("gemini" | "groq" | "openrouter") TANPA pindah ke penyedia lain kalau gagal.
    engine?: "auto" | "gemini" | "groq" | "openrouter";
  } = {}
): Promise<ChatReplyResult> {
  const apiKeys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];
  const primaryModel = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  const fallbackModel = Deno.env.get("GEMINI_MODEL_FALLBACK") || DEFAULT_FALLBACK_MODEL;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const strict = options.strictDocs === true && knowledgeContext.length > 0;
  const systemText = buildSystemText(knowledgeContext, options.kbExcerpts === true, { strictDocs: strict, docNoMatch: options.docNoMatch === true });

  // Jalur TANPA Google Search (fallback) harus jujur soal itu: prompt dasar
  // bilang model punya akses internet, jadi tanpa catatan ini ia menjawab
  // angka/aturan dari ingatan lamanya dengan nada yakin.
  const noInternetNote =
    "\n\nCATATAN: untuk balasan ini akses pencarian internet SEDANG TIDAK TERSEDIA (abaikan klaim sebelumnya bahwa kamu punya akses internet). Untuk peraturan, tarif, angka resmi, berita, atau hal lain yang bisa sudah berubah, JANGAN menyebut angka/fakta dengan yakin dari ingatan -- katakan terus terang kamu belum bisa memastikan versi terbarunya dan sarankan cek sumber resmi.";

  // Kalau Google Search ditolak (di akun gratis tool ini bisa 429 di SEMUA key),
  // coba cari lewat Bing & sisipkan hasilnya ke pertanyaan terakhir (lihat
  // buildFallbackPayload) -- sama seperti bot WA.
  const webNote =
    "\n\nCATATAN: Google Search sedang tidak tersedia, jadi sistem mencarikan HASIL PENCARIAN WEB (judul + cuplikan, sebagian dengan baris 'Sumber: URL') dan melampirkannya di pesan terakhir. Jadikan itu acuan untuk fakta/angka/aturan terbaru dan sebut sumbernya singkat (nama situs/judul) kalau relevan. Cuplikan sering terpotong: kalau belum cukup untuk memastikan angka atau aturan resmi, katakan terus terang dan sarankan cek sumber resmi. Boleh menyebut URL HANYA yang tertulis persis di baris 'Sumber:'; jangan mengarang link/URL. Kalau ada dokumen referensi di atas yang memuat jawabannya, dokumen itu tetap sumber utama.";

  const buildBody = (withTools: boolean, system = systemText, ctn = contents) =>
    JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: ctn,
      ...(withTools ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { temperature: strict ? 0.2 : 0.6 }
    });

  const buildFallbackPayload = async () => {
    const webQuery = buildWebQuery(messages.filter((m) => m.role === "user").map((m) => m.content));
    if (!webQuery) return { system: systemText + noInternetNote, ctn: contents };
    const results = await getWebSearch(searchBing).search(webQuery, 5);
    console.log(`[Web] ${results.length} hasil web disisipkan ke prompt chat (query: "${webQuery.slice(0, 80)}")`);
    if (results.length === 0) return { system: systemText + noInternetNote, ctn: contents };
    const lastText = contents[contents.length - 1]?.parts?.[0]?.text ?? "";
    return {
      system: systemText + webNote,
      ctn: [...contents.slice(0, -1), { role: "user", parts: [{ text: buildWebGroundedMessage(lastText, results) }] }]
    };
  };

  // Urutan percobaan, dari yang paling ideal ke yang paling andal:
  // 1. Model utama + akses internet -- 1x saja, jangan buang waktu retry di
  //    sini kalau lagi "overloaded" (503), soalnya jalur ini yang paling
  //    sering padat permintaannya di tier gratis.
  // 2. Model utama tanpa akses internet -- diberi sisa jatah retry, supaya
  //    kalau cuma jalur "tools"-nya yang sibuk, chat tetap jalan cepat.
  // 3. Model cadangan (GEMINI_MODEL_FALLBACK) tanpa akses internet -- kalau
  //    model utama sendiri yang sedang overloaded total (bukan cuma jalur
  //    tools-nya), pindah ke model lain supaya pesan tidak gagal terkirim.
  const viaGemini = async (): Promise<ChatReplyResult> => {
  let data: GeminiData;
  let modelUsed: string;
  if (strict) {
    // Mode dokumen ketat: tanpa Google Search (jawaban hanya boleh dari potongan dokumen), suhu rendah.
    const steps = [{ model: primaryModel, maxAttempts: MAX_ATTEMPTS }];
    if (fallbackModel !== primaryModel) steps.push({ model: fallbackModel, maxAttempts: MAX_ATTEMPTS - 1 });
    const result = await callGeminiWithModelFallback(apiKeys, () => buildBody(false), steps, "chat-docs");
    data = result.data;
    modelUsed = result.model;
  } else {
    try {
      const result = await callGeminiWithModelFallback(apiKeys, () => buildBody(true), [{ model: primaryModel, maxAttempts: 1 }], "chat-tools");
      data = result.data;
      modelUsed = result.model;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`Percobaan chat dengan Google Search grounding gagal (${reason}), lanjut tanpa akses internet...`);
      const steps = [{ model: primaryModel, maxAttempts: MAX_ATTEMPTS - 1 }];
      if (fallbackModel !== primaryModel) {
        steps.push({ model: fallbackModel, maxAttempts: MAX_ATTEMPTS - 1 });
      }
      const fb = await buildFallbackPayload();
      const result = await callGeminiWithModelFallback(apiKeys, () => buildBody(false, fb.system, fb.ctn), steps, "chat-plain");
      data = result.data;
      modelUsed = result.model;
    }
  }

  const rawText = extractGeminiText(data);
  if (!rawText.trim()) {
    throw new Error(`Respons Gemini (chat) tidak berisi teks yang diharapkan: ${JSON.stringify(data).slice(0, 500)}`);
  }

  // CATATAN PENTING (setelah beberapa kali percobaan): Gemini TIDAK PERNAH
  // mengirim angka dolar -- dari awal biaya di aplikasi ini selalu hasil
  // hitungan kita sendiri (token x tarif resmi Gemini), bukan ditarik
  // langsung dari API. Sebelumnya biaya dihitung dari RINCIAN usageMetadata
  // (promptTokenCount/candidatesTokenCount/thoughtsTokenCount/
  // toolUsePromptTokenCount) satu-satu, tapi di lapangan field2 rincian itu
  // ternyata TIDAK BISA DIANDALKAN selalu muncul/terisi benar dari Gemini --
  // hasilnya biaya kehitung $0 terus walau token (usageMetadata.
  // totalTokenCount) sendiri SELALU muncul & SELALU akurat (cocok persis
  // dengan jumlah yang tercatat kumulatif di tabel token_usage).
  //
  // Jadi sekarang biaya dihitung LANGSUNG dari total token saja (bukan
  // dipecah-pecah lagi per kategori), pakai perkiraan proporsi input:output
  // yang wajar utk obrolan singkat (riwayat+prompt yang dikirim biasanya
  // jauh lebih panjang drpd jawaban yang dihasilkan). Ini ESTIMASI kasar,
  // bukan angka presisi -- tapi jauh lebih baik drpd $0 terus karena field
  // rincian yang nggak reliable.
  const tokensUsed = data?.usageMetadata?.totalTokenCount ?? 0;
  const ESTIMATED_INPUT_SHARE = 0.7; // 70% input, 30% output -- perkiraan kasar
  const costUsd =
    tokensUsed > 0
      ? estimateCostUsd(modelUsed, tokensUsed * ESTIMATED_INPUT_SHARE, tokensUsed * (1 - ESTIMATED_INPUT_SHARE))
      : 0;

  return { reply: rawText.trim(), tokensUsed, costUsd };
  };

  // Penyedia cadangan (Groq, OpenRouter): dipakai hanya setelah Gemini gagal total (semua key habis / 503 / jaringan),
  // atau bila tidak ada key Gemini sama sekali. Tanpa Google Search (hasil Bing disisipkan bila ada). Token/biaya
  // dicatat 0 supaya hitungan "token Gemini hari ini" di aplikasi tetap murni Gemini.
  const chain = getFallbackChain();
  const engine = options.engine ?? "auto";
  const viaFallback = async (only?: string): Promise<ChatReplyResult> => {
    const payload = strict ? { system: systemText, ctn: contents } : await buildFallbackPayload();
    const msgs = payload.ctn
      .map((c) => ({
        role: (c.role === "model" ? "assistant" : "user") as "assistant" | "user",
        content: c.parts.map((x) => x.text ?? "").join("")
      }))
      .filter((m) => m.content);
    const r = await chain.generate({ system: payload.system, messages: msgs, temperature: strict ? 0.2 : 0.4, only });
    return { reply: r.text, tokensUsed: 0, costUsd: 0, provider: `${r.provider}/${r.model}` };
  };

  // Agent dipilih eksplisit: hanya penyedia itu, tidak pindah ke yang lain bila gagal.
  if (engine === "gemini") {
    if (apiKeys.length === 0) throw new Error("Agent Gemini dipilih tetapi tidak ada API key Gemini.");
    return await viaGemini();
  }
  if (engine === "groq" || engine === "openrouter") {
    if (!chain.has(engine)) throw new Error(`Agent ${engine === "groq" ? "Groq" : "OpenRouter"} dipilih tetapi API key-nya belum diatur di server.`);
    return await viaFallback(engine);
  }

  if (apiKeys.length === 0) {
    if (!chain.available()) throw new Error("Tidak ada API key Gemini maupun penyedia cadangan.");
    return await viaFallback();
  }
  if (!chain.available()) return await viaGemini();
  try {
    return await viaGemini();
  } catch (geminiErr) {
    try {
      const out = await viaFallback();
      console.log(`[Cadangan] dijawab ${out.provider} (Gemini gagal: ${String((geminiErr as Error)?.message || geminiErr).slice(0, 120)})`);
      return out;
    } catch (fbErr) {
      console.error(`[Cadangan] juga gagal: ${fbErr instanceof Error ? fbErr.message : String(fbErr)}`);
      throw geminiErr;
    }
  }
}
