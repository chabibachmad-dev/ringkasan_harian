// Bot WhatsApp (pakai Baileys -- library TIDAK RESMI yang bicara langsung
// ke protokol WhatsApp Web, tanpa Puppeteer/browser) buat fitur "WhatsApp di
// dalam aplikasi" di Ringkasan Harian.
//
// KENAPA INI SKRIP TERPISAH, BUKAN EDGE FUNCTION?
// Supabase Edge Function itu stateless & cuma hidup sebentar per-request --
// tidak bisa dipakai buat pegang satu koneksi WebSocket ke WhatsApp yang
// harus tetap nyambung 24 jam. Makanya bot ini WAJIB jalan sebagai proses
// Node.js yang hidup terus-menerus (lihat README.md buat cara jalaninnya +
// cara biar auto-restart kalau laptop di-reboot).
//
// ALUR KERJANYA (lihat juga komentar di migrations/0011_whatsapp_messages.sql):
//   1. Login SEKALI lewat scan QR code (sesi disimpan di folder
//      auth_session/, otomatis dipakai lagi tiap bot di-restart -- TIDAK
//      perlu scan ulang kecuali folder itu dihapus atau sesi di-logout dari
//      HP).
//   2. Pesan WhatsApp MASUK -> langsung disimpan ke tabel whatsapp_messages
//      (Supabase) lewat service_role key.
//   3. Tiap beberapa detik (POLL_INTERVAL_MS), bot CEK tabel whatsapp_messages
//      nyari baris status='pending' (ini dibikin sama Edge Function
//      `whatsapp` action "send", waktu user balas chat dari aplikasi) ->
//      beneran dikirim lewat WhatsApp -> status diupdate jadi 'sent' atau
//      'failed'.
//
// CATATAN PENTING soal nomor WA yang dipakai di sini: karena ini BUKAN
// WhatsApp Business API resmi, nomor yang di-scan QR di sini sebaiknya
// nomor KHUSUS buat bot ini (bukan nomor yang masih aktif dipakai manual di
// HP), karena begitu sesi dipegang Baileys, pemakaian manual bersamaan di
// app WhatsApp biasa bisa bikin salah satu sisi ke-logout/bentrok.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import * as cheerio from "cheerio";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createSimab, SIMAB_OLLAMA_SYSTEM } from "./simab.js";
import { createAppAgentWorker } from "./app-agent.js";
import { createFallbackChain, readFallbackConfig } from "./llm-fallback.js";
import { createWebSearch, readSearchConfig } from "./web-search.js";
import { createKhatamReminder } from "./khatam.js";
import { createPriorityQueue, PRIORITY } from "./ollama-queue.js";
import { openKbIndex } from "./kb-index.js";
import { createKbIngestWorker, readKbConfig } from "./kb-ingest.js";
import { createKbRetrievalWorker } from "./kb-retrieval.js";
import { guardDocAnswer } from "./docguard.js";
import { ollamaChatStream } from "./ollama-http.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 4000;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set. Salin .env.example jadi .env lalu isi dulu.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ================================================================
// Auto-reply pakai AI (Gemini) -- OPSIONAL, DEFAULT MATI.
//
// Nyala HANYA kalau WA_AUTO_REPLY_ENABLED=true DAN GEMINI_API_KEY diisi di
// .env (pakai API key Google AI Studio yang SAMA dengan yang dipasang
// sebagai secret GEMINI_API_KEY di Supabase buat fitur "Obrolan AI" --
// lihat https://aistudio.google.com/apikey).
//
// KENAPA GEMINI DIPANGGIL LANGSUNG DARI SINI (bukan lewat Edge Function
// `whatsapp`)? Beda dari frontend (browser, tidak dipercaya, makanya harus
// lewat Edge Function + CHAT_ACCESS_CODE), skrip bot ini SUDAH pegang
// service_role key (akses penuh ke database, lebih tinggi derajat
// kepercayaannya drpd anon key) dan memang didesain bicara LANGSUNG ke
// Supabase tanpa lewat Edge Function (lihat handleIncoming/
// processPendingOutgoing di atas) -- jadi manggil Gemini langsung dari sini
// juga konsisten dengan pola itu, drpd nambah satu lompatan jaringan lagi
// via Edge Function.
//
// CATATAN: logika hitung biaya (estimateCostUsd/getModelPricing) di bawah
// ini SENGAJA DIDUPLIKASI dari supabase/functions/_shared/gemini.ts (bukan
// di-share) karena yang satu jalan di Deno/TypeScript (Edge Function) dan
// yang ini di Node.js biasa -- kalau suatu saat tarif resmi Gemini berubah,
// PASTIKAN update KEDUA tempat ini supaya catatan "token terpakai hari ini"
// di footer aplikasi tetap akurat.
const WA_AUTO_REPLY_ENABLED = (process.env.WA_AUTO_REPLY_ENABLED || "").toLowerCase() === "true";
// Boleh isi BEBERAPA API key Gemini dipisah koma (GEMINI_API_KEYS=key1,key2,key3)
// -- tiap key biasanya dari akun Google BEDA (masing2 py jatah gratis 20
// request/hari sendiri2, lihat GEMINI_KEY_COOLDOWN_MS di bawah). Tetap
// terima GEMINI_API_KEY (tunggal, nama lama) sbg fallback kalau
// GEMINI_API_KEYS tidak diisi, biar .env lama tidak rusak.
const GEMINI_API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
// Log jumlah key yang kebaca (cuma 4 karakter terakhir) -- supaya gampang
// cek di `pm2 logs` apakah GEMINI_API_KEYS di .env benar2 terbaca semua.
if (GEMINI_API_KEYS.length > 0 && (process.env.WA_AI_ENGINE || "ollama").trim().toLowerCase() === "gemini") {
  console.log(
    `🔑 ${GEMINI_API_KEYS.length} API key Gemini terbaca (${GEMINI_API_KEYS.map((k) => "..." + k.slice(-4)).join(", ")}), model ${GEMINI_MODEL}.`
  );
}
// Penyedia CADANGAN (Groq, OpenRouter): dipakai hanya setelah semua key Gemini gagal/habis kuota.
// Diatur lewat GROQ_API_KEYS / OPENROUTER_API_KEYS di .env (lihat llm-fallback.js & .env.example).
const llmFallback = createFallbackChain({ config: readFallbackConfig(process.env), onEvent: (e) => reportLlmEvent(e) });
if (llmFallback.available() && (process.env.WA_AI_ENGINE || "ollama").trim().toLowerCase() === "gemini") {
  console.log(`🛟 Penyedia cadangan AI aktif (setelah Gemini): ${llmFallback.describe()}`);
}
// Berapa pesan terakhir (masuk+keluar) di satu obrolan yang dikasihkan ke
// AI sebagai konteks -- sengaja lebih pendek drpd riwayat Obrolan AI (yang
// 40) karena chat WA biasanya lebih singkat/kasual, dan tiap pesan WA baru
// memicu 1 panggilan AI (beda dari Obrolan AI yang cuma kepanggil waktu
// user benar-benar kirim) -- riwayat lebih pendek = lebih hemat token/waktu.
const AUTO_REPLY_HISTORY_LIMIT = 20;

// ----------------------------------------------------------------
// Pilihan "mesin" AI buat auto-reply WA: "ollama" (default, model lokal
// jalan di laptop sendiri -- gratis & privasi penuh, lihat blok RAG + web
// search di bawah) atau "gemini" (cara lama, lihat callGeminiOnce dkk).
// Kode Gemini SENGAJA TETAP DIPERTAHANKAN (bukan dihapus) biar gampang
// pindah balik tinggal ganti WA_AI_ENGINE di .env, tanpa perlu
// install-ulang/tulis ulang apa pun -- walau praktiknya auto-reply WA
// sekarang jalan pakai "ollama" per keputusan user (hasil tes pembuktian
// konsep RAG: qwen2.5:3b + potongan dokumen relevan = akurat, lihat
// riwayat percakapan).
const WA_AI_ENGINE = (process.env.WA_AI_ENGINE || "ollama").toLowerCase();
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
// Berapa lama model dibiarkan di RAM setelah panggilan terakhir (format Ollama: "5m", "30s", "0").
// Makin pendek = RAM lebih cepat lega, tapi pesan berikutnya kena ongkos muat ulang (±5-8 dtk).
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "5m";
// num_ctx = ukuran jendela konteks (dalam token) yang diminta ke Ollama --
// default bawaan Ollama cuma 2048, kekecilan begitu riwayat obrolan +
// konteks dokumen + hasil pencarian web digabung. 4096 aman buat RAM 7.5GB
// dgn model 3B di laptop spek pas-pasan (lihat spek yang di-share user).
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX) || 4096;
// Batas maksimal PANJANG JAWABAN (dalam token, lihat options.num_predict di
// callOllamaChat) -- bukan cuma hemat waktu generate, tapi juga wajar buat
// chat WA (balasan sependek2nya tetap lebih natural drpd esai panjang di WA).
// Diukur dari tes --verbose user langsung di server: eval rate CUMA ~4.5
// token/detik (CPU i5-4200M, 2014, tanpa akselerasi khusus) -- 300 token
// output = sekitar 65 detik generate SAJA, belum prompt eval & load model.
// Suhu saat jawaban memakai KONTEKS DOKUMEN (balasan WA & chat aplikasi): rendah = patuh pada teks,
// tidak berimajinasi. 0 sampai 1; bawaan 0.1.
const OLLAMA_DOC_TEMPERATURE = Number.isFinite(Number(process.env.OLLAMA_DOC_TEMPERATURE)) && process.env.OLLAMA_DOC_TEMPERATURE !== undefined && process.env.OLLAMA_DOC_TEMPERATURE !== "" ? Math.min(1, Math.max(0, Number(process.env.OLLAMA_DOC_TEMPERATURE))) : 0.1;
const OLLAMA_MAX_OUTPUT_TOKENS = Number(process.env.OLLAMA_MAX_OUTPUT_TOKENS) || 300;
// Inferensi CPU-only di laptop tua bisa LAMBAT -- dari tes nyata di server
// user (376 token prompt + 356 token jawaban = total ~104 detik, lihat
// riwayat percakapan), 120 detik awal TERBUKTI sering kurang begitu
// prompt/jawabannya dikit lebih besar. Dinaikkan jadi 4 menit, kasih ruang
// lebih drpd auto-reply dianggap "gagal" padahal cuma masih mikir --
// dikombinasikan dgn OLLAMA_MAX_OUTPUT_TOKENS & pemangkasan konteks (lihat
// RAG_CONTEXT_BUDGET_CHARS, WEB_SEARCH_MAX_RESULTS, OLLAMA_HISTORY_LIMIT)
// biar kejadian "mepet/lewat batas" ini lebih jarang, bukan cuma ditutupi
// dgn nunggu lebih lama.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 240000;
// Riwayat obrolan yang dikirim ke Ollama SENGAJA lebih pendek drpd punya
// Gemini (AUTO_REPLY_HISTORY_LIMIT=20) -- tiap pesan riwayat nambah token
// prompt yang harus "dibaca" dulu (prompt eval, lihat hasil tes), & itu ikut
// numpuk ke total waktu tunggu di CPU lambat begini.
const OLLAMA_HISTORY_LIMIT = Number(process.env.OLLAMA_HISTORY_LIMIT) || 10;

// ----------------------------------------------------------------
// Nomor PEMILIK (nomor WA utama kamu, BUKAN nomor bot ini) -- tujuan
// peringatan "semua API key habis" & ringkasan percakapan harian. Cukup
// isi angka nomornya di .env (WA_OWNER_NUMBER=085719965097 atau
// 6285719965097 -- "0" di depan otomatis jadi "62"). Sengaja lewat .env,
// BUKAN ditulis di kode, supaya nomor pribadi tidak ikut ke-commit ke GitHub.
function normalizeOwnerNumber(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits;
}
const OWNER_NUMBER = normalizeOwnerNumber(process.env.WA_OWNER_NUMBER);
const OWNER_JID = OWNER_NUMBER ? `${OWNER_NUMBER}@s.whatsapp.net` : null;
// Zona waktu buat "tengah malam"/jam ringkasan harian & label jam di pesan.
// Default WITA (sama dgn jam ringkasan berita di aplikasi) -- ganti ke
// Asia/Jakarta + label WIB kalau mau waktu Jawa.
const WA_TIMEZONE = process.env.WA_TIMEZONE || "Asia/Makassar";
const WA_TIMEZONE_LABEL = process.env.WA_TIMEZONE_LABEL || "WITA";
// Ringkasan percakapan harian ke nomor pemilik: nyala otomatis kalau
// WA_OWNER_NUMBER diisi (matikan lewat WA_DAILY_SUMMARY_ENABLED=false).
const WA_DAILY_SUMMARY_ENABLED = OWNER_JID !== null && (process.env.WA_DAILY_SUMMARY_ENABLED || "true").toLowerCase() !== "false";
const WA_DAILY_SUMMARY_HOUR = Math.min(23, Math.max(0, Number(process.env.WA_DAILY_SUMMARY_HOUR ?? 20) || 20));
// Mesin pembuat ringkasan harian: "ollama" (DEFAULT -- model lokal di laptop ini,
// isi percakapan WA tidak keluar dari laptop & tidak makan kuota Gemini) atau
// "gemini". Kalau "ollama" gagal (mis. "ollama serve" mati), WA_SUMMARY_GEMINI_FALLBACK
// (default true) mengizinkan jatuh ke Gemini; set "false" kalau mau ketat: isi
// percakapan TIDAK BOLEH dikirim ke Google sama sekali (gagal = daftar sederhana).
const WA_SUMMARY_ENGINE = (process.env.WA_SUMMARY_ENGINE || "ollama").trim().toLowerCase() === "gemini" ? "gemini" : "ollama";
const WA_SUMMARY_GEMINI_FALLBACK = (process.env.WA_SUMMARY_GEMINI_FALLBACK || "true").trim().toLowerCase() !== "false";
// Ringkasan lokal boleh lama (jalan sekali sehari, tak ada yang menunggu).
const WA_SUMMARY_OLLAMA_TIMEOUT_MS = Number(process.env.WA_SUMMARY_OLLAMA_TIMEOUT_MS) || 600000;
// Cadangan lokal buat auto-reply: kalau Gemini gagal karena KUOTA (semua key
// habis / 429 / 503), pertanyaan yang BUKAN soal angka/aturan dijawab Ollama
// dulu daripada cuma "sistem penuh". Pertanyaan angka/aturan tetap diantre
// buat dijawab Gemini nanti (model 3B terbukti mudah mengarang angka).
const WA_OLLAMA_FALLBACK_ENABLED = (process.env.WA_OLLAMA_FALLBACK_ENABLED || "true").trim().toLowerCase() !== "false";
// Batas tunggu jawaban Ollama utk cadangan ini -- lebih pendek dari OLLAMA_TIMEOUT_MS
// supaya kontak tidak menunggu terlalu lama sebelum jatuh ke antrean.
const WA_OLLAMA_FALLBACK_TIMEOUT_MS = Number(process.env.WA_OLLAMA_FALLBACK_TIMEOUT_MS) || 90000;
// Template jawaban (tabel wa_quick_replies) cuma dicoba kalau pesannya
// PENDEK -- pesan panjang hampir pasti pertanyaan rumit yang butuh AI,
// jangan sampai kata kunci nyasar di tengah kalimat panjang memicu template.
const QUICK_REPLY_MAX_WORDS = 12;
// Retry pesan yang gagal dibalas AI (tabel wa_retry_queue): dicek tiap menit,
// maksimal beberapa percobaan, kadaluarsa setelah RETRY_EXPIRE_HOURS jam.
const RETRY_CHECK_INTERVAL_MS = 60_000;
const RETRY_MAX_ATTEMPTS = 6;
const RETRY_EXPIRE_HOURS = 24;

if (WA_AUTO_REPLY_ENABLED && WA_AI_ENGINE === "gemini" && GEMINI_API_KEYS.length === 0 && !llmFallback.available()) {
  console.warn(
    "⚠️  WA_AUTO_REPLY_ENABLED=true + WA_AI_ENGINE=gemini tapi GEMINI_API_KEY(S) belum diisi di .env -- auto-reply TIDAK akan jalan sampai diisi."
  );
}
// Auto-reply dianggap "siap jalan" kalau: enabled DAN (pakai ollama -- tidak
// butuh API key apa pun, cukup Ollama-nya jalan di laptop -- ATAU pakai
// gemini DAN minimal 1 API key sudah diisi).
const AUTO_REPLY_ACTIVE = WA_AUTO_REPLY_ENABLED && (WA_AI_ENGINE === "ollama" || GEMINI_API_KEYS.length > 0 || llmFallback.available());
console.log(
  `🤖 Auto-reply AI: ${AUTO_REPLY_ACTIVE ? `AKTIF (mesin: ${WA_AI_ENGINE}${WA_AI_ENGINE === "gemini" ? `, ${GEMINI_API_KEYS.length} API key Gemini${llmFallback.available() ? " + cadangan Groq/OpenRouter" : ""}` : ""})` : "mati"}`
);

// Prompt ini menentukan gaya & batasan balasan otomatis. Dibuat SELENGKAP
// Obrolan AI di aplikasi (boleh diskusi bebas, bantu coding, akses
// pencarian Google) per permintaan user -- TAPI tetap pakai 1 rem pengaman
// yang sengaja TIDAK dihilangkan: tidak boleh bikin janji/komitmen atas
// nama pemilik nomor, karena ini mengatasnamakan pemilik nomor WA ASLI ke
// kontak SUNGGUHAN secara otomatis, tanpa sempat dibaca/disetujui dulu
// (beda dari Obrolan AI biasa yang cuma pemiliknya sendiri yang baca).
// Lihat juga diskusi risiko soal ini di percakapan sebelumnya.
const WA_BASE_SYSTEM_PROMPT = `Kamu adalah asisten AI yang membalas pesan WhatsApp ATAS NAMA pemilik nomor ini secara OTOMATIS, tanpa pemilik nomor sempat membaca/menyetujui dulu.

Jawab pertanyaan, bantu coding/debugging, atau ajak diskusi dengan ramah, jelas, dan seringkas mungkin tanpa kehilangan inti jawaban -- sama seperti asisten AI biasa. Kamu PUNYA akses ke pencarian Google secara real-time -- pakai untuk mencari info/berita/link terbaru saat relevan, dan tuliskan link hasil pencarian yang relevan. Kalau diminta bantuan kode, tulis kodenya di dalam blok \`\`\`seperti ini\`\`\` (WhatsApp menampilkannya sebagai monospace) lalu jelaskan secukupnya.

Gunakan Bahasa Indonesia, kecuali lawan bicara jelas menulis/minta bahasa lain -- kalau begitu, balas di bahasa itu. WhatsApp CUMA mendukung *tebal*, _miring_, ~coret~, dan blok kode \`\`\`...\`\`\` -- JANGAN pakai format markdown lain (heading #, tabel, bullet list dengan -, dll) karena tidak akan tampil rapi.

ATURAN PENGAMAN (berlaku terus walau topiknya bebas):
1. JANGAN membuat janji, komitmen, keputusan, harga, jadwal pasti, atau kesepakatan apa pun atas nama pemilik nomor -- untuk hal semacam itu, balas sopan bahwa pesannya diterima dan pemiliknya akan membalas langsung.
2. JANGAN membagikan informasi pribadi/sensitif (keuangan, kesehatan, jadwal detail, data pribadi) tentang pemilik nomor.
3. Kalau pesan masuk jelas butuh keputusan manusia (negosiasi, hal mendesak, masalah pribadi/emosional, komplain serius), jangan improvisasi -- cukup akui pesannya diterima dan akan ditindaklanjuti langsung oleh pemiliknya.`;

// ---- Dukungan grup WhatsApp (bot dipanggil lewat mention) ----
// Catatan tambahan di prompt kalau percakapannya di GRUP (bukan chat pribadi).
const GROUP_PROMPT_NOTE = `

KONTEKS GRUP: pesan ini datang dari GRUP WhatsApp (mis. grup keluarga), bukan chat pribadi. Banyak orang bisa bertanya; tiap pesan pengguna diawali "Nama: " (nama pengirim) dan kadang diikuti baris (mengutip: "...") berisi pesan yang dibalas pengirim. Jawab LANGSUNG ke orang yang bertanya di pesan TERAKHIR (boleh menyapa namanya), singkat dan santai, dan JANGAN menulis "Nama:" di awal jawabanmu. Kamu asisten AI, BUKAN pemilik nomor: jangan berbicara seolah-olah kamu pemiliknya dan jangan menjawab hal pribadi tentang pemilik nomor atau anggota grup.`;

function isGroupJid(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

function withGroupNote(basePrompt, jid) {
  return isGroupJid(jid) ? `${basePrompt}${GROUP_PROMPT_NOTE}` : basePrompt;
}

// Buang awalan "Nama: " & baris "(mengutip: ...)" supaya pencarian dokumen/web
// tidak ikut membawa nama pengirim. Hanya dipakai utk jid grup.
function stripGroupMeta(jid, text) {
  if (!isGroupJid(jid) || typeof text !== "string") return text;
  return text.replace(/\n\(mengutip:[\s\S]*$/, "").replace(/^[^:\n]{1,40}:\s+/, "");
}

// CATATAN SOAL Dokumen Pengetahuan (tabel knowledge_documents) & web search:
// sempat diputuskan auto-reply WA TIDAK ikut baca Dokumen Pengetahuan sama
// sekali (lihat riwayat git) -- itu berlaku SELAMA mesinnya Gemini (yang
// Gemini-nya sendiri sudah py akses Google Search bawaan lewat tools:
// google_search di callGeminiOnce, jadi dokumen dirasa tidak perlu).
//
// Begitu pindah ke mesin "ollama" (model LOKAL, TIDAK punya akses internet
// bawaan sama sekali), ceritanya beda: tanpa dikasih konteks, model kecil
// (3B parameter) kebukti ASAL NGARANG kalau ditanya istilah/aturan resmi
// yang spesifik (lihat hasil tes qwen2.5:3b soal "LPH" & "bendahara
// pengeluaran" di riwayat percakapan -- jawabannya ngawur total tanpa
// konteks, tapi akurat begitu dikasih potongan teks aslinya). Makanya
// KHUSUS jalur "ollama", auto-reply WA ikut baca Dokumen Pengetahuan LAGI
// (RAG sederhana, lihat fetchRelevantKnowledgeChunks) DAN dilengkapi
// pencarian web manual (lihat webSearchBing, scraping Bing HTML -- gratis,
// tanpa API key, krn model lokal tidak bisa googling sendiri; awalnya
// coba DuckDuckGo tapi ternyata diblokir ISP user, lihat catatan di
// webSearchBing).
//
// Ringkasnya:
//   - WA_AI_ENGINE=gemini -> TIDAK pakai Dokumen Pengetahuan (asli), googling
//     lewat tools bawaan Gemini.
//   - WA_AI_ENGINE=ollama (default sekarang) -> PAKAI Dokumen Pengetahuan
//     (RAG) + googling manual (Bing) sebagai "mata" buat model lokal.

// ================================================================
// RAG (Retrieval-Augmented Generation) SEDERHANA buat mesin "ollama" --
// nyari potongan Dokumen Pengetahuan yang relevan tanpa butuh vector
// database/embedding model (terlalu berat buat laptop spek pas-pasan ini,
// lihat spek CPU/RAM yang di-share user) -- cukup skor "berapa banyak kata
// penting yang sama" antara pertanyaan & tiap potongan dokumen. Kasar, tapi
// cukup buat kasus pakai "dokumen resmi berbahasa Indonesia yang istilahnya
// spesifik" (lihat hasil tes LPH/bendahara pengeluaran) -- dan JAUH lebih
// ringan drpd embedding.
// ================================================================
const RAG_CHUNK_SIZE_CHARS = 700;
// Diperkecil dari 3000 -> 1500 char (~375 token) setelah tes kecepatan nyata
// di server user (eval rate ~4.5 token/detik, lihat OLLAMA_TIMEOUT_MS) --
// prompt yang lebih kecil = prompt eval lebih cepat = lebih jarang kebentur
// timeout, dgn tetap nyisa cukup ruang buat 1-2 potongan dokumen relevan.
const RAG_CONTEXT_BUDGET_CHARS = 1500;
// Kalau potongan dokumen dgn skor tertinggi >= angka ini, pertanyaannya
// dianggap "jelas soal dokumen kita" -> SKIP pencarian web (lebih cepat &
// lebih privat, tidak perlu kirim apa pun ke Bing -- DAN lebih penting lagi
// di CPU lambat begini: skip 1 sumber konteks = prompt lebih kecil = lebih
// cepat).
const RAG_STRONG_MATCH_SCORE = 4;

// Daftar kata umum Bahasa Indonesia yang DIBUANG waktu scoring (supaya kata
// kayak "yang", "untuk", "dengan" tidak dianggap "match" ke semua potongan
// dokumen secara percuma).
const ID_STOPWORDS = new Set([
  "yang", "untuk", "dengan", "pada", "dari", "dan", "atau", "ini", "itu",
  "ke", "di", "adalah", "akan", "juga", "saja", "bisa", "ada", "tidak",
  "apa", "apakah", "bagaimana", "kalau", "jika", "karena", "sebagai",
  "oleh", "dalam", "para", "sudah", "belum", "lebih", "kurang", "agar",
  "supaya", "hal", "nya", "mu", "ku", "saya", "kamu", "anda", "kita",
  "mereka", "dia", "tersebut", "begitu", "maka", "namun", "tetapi", "serta",
  "antara", "tiap", "setiap", "banyak", "sedikit", "satu", "dua", "tiga",
  "tolong", "mohon", "coba", "gimana", "kenapa", "siapa", "dimana", "kapan",
  "berapa"
]);

// Ejaan/singkatan yang SERING beda antara cara orang menulis di WA & di
// dokumen resmi -- disamakan di kedua sisi (pertanyaan & potongan dokumen)
// supaya "Jogja" nyambung ke "Yogyakarta" di tabel tarif.
const ID_ALIASES = {
  jogja: "yogyakarta",
  jogjakarta: "yogyakarta",
  yogya: "yogyakarta",
  jogyakarta: "yogyakarta",
  diy: "yogyakarta",
  gol: "golongan"
};

// Perluasan KHUSUS sisi pertanyaan: kata yang diketik orang -> istilah yang
// kemungkinan tertulis di dokumen resmi (alternatif, BUKAN tambahan wajib).
// Mis. "honor ppk" -> dokumen menulis "honorarium ... Pejabat Pembuat Komitmen".
const QUERY_EXPANSIONS = {
  ppk: ["pejabat", "pembuat", "komitmen"],
  pptk: ["pejabat", "pelaksana", "teknis", "kegiatan"],
  kpa: ["kuasa", "pengguna", "anggaran"],
  bpp: ["bendahara", "pengeluaran", "pembantu"],
  honor: ["honorarium"],
  honorer: ["honorarium"],
  uh: ["uang", "harian"],
  sbm: ["standar", "biaya", "masukan"],
  sbk: ["standar", "biaya", "keluaran"],
  perdin: ["perjalanan", "dinas"],
  spj: ["pertanggungjawaban"]
};

function tokenizeForScoring(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => ID_ALIASES[w] ?? w)
    .filter((w) => w.length > 2 && !ID_STOPWORDS.has(w));
}

// Pecah teks dokumen jadi potongan ~RAG_CHUNK_SIZE_CHARS karakter, usahakan
// tidak motong di tengah paragraf (gabung paragraf pendek sampai mendekati
// batas ukuran).
// Satu paragraf yang jauh lebih panjang dari ukuran potongan (mis. tabel tarif
// hasil ekstrak PDF yang tidak punya baris kosong) dipecah per baris, dan kalau
// sebuah baris saja sudah kepanjangan, dipotong per jendela karakter yang
// saling tumpang-tindih sedikit -- supaya 1 potongan tidak jadi puluhan ribu
// karakter & baris tabel yang terpotong masih utuh di potongan sebelah.
function splitOversizedText(text, size) {
  if (text.length <= size * 2) return [text];
  const overlap = Math.min(200, Math.floor(size / 4));
  const out = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (line.length > size * 2) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < line.length; i += size - overlap) out.push(line.slice(i, i + size));
      continue;
    }
    if (buf && buf.length + line.length + 1 > size) {
      out.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// Judul bagian/tabel dokumen resmi ("Tabel 30 Satuan Biaya Penginapan...",
// "Lampiran I", "BAB II") -- dipakai sebagai konteks potongan lanjutan.
const HEADING_RE = /^(tabel|lampiran|bab)\b/i;

function chunkDocumentText(text, chunkSize) {
  // PENTING (tabel panjang): baris-baris tabel di potongan ke-2 dst. TIDAK
  // memuat judul tabelnya ("Penginapan", "Perjalanan Dinas"...), jadi baris
  // "D.I. Yogyakarta ..." tidak akan nyambung ke pertanyaan soal penginapan &
  // tak pernah ketemu. Solusi: tiap potongan lanjutan dari paragraf yang
  // dipecah diberi awalan "(Lanjutan dari: <judul/awal bagian>…)".
  let lastHeading = "";
  let carry = ""; // judul yang menunggu digabung ke paragraf isi berikutnya
  const paragraphs = [];
  for (const raw of (text || "").split(/\n{2,}/)) {
    let p = raw.trim();
    if (!p) continue;
    if (p.length <= 200 && HEADING_RE.test(p)) {
      // Judul digabung ke paragraf isi tepat di bawahnya (bukan jadi potongan
      // sendiri) supaya isi tabel & judulnya selalu 1 kesatuan.
      carry = carry ? `${carry} ${p.replace(/\s+/g, " ")}` : p.replace(/\s+/g, " ");
      lastHeading = carry;
      continue;
    }
    if (carry) {
      p = `${carry}\n${p}`;
      carry = "";
    }
    const parts = splitOversizedText(p, chunkSize);
    if (parts.length === 1) {
      paragraphs.push(parts[0]);
      continue;
    }
    const head = p.slice(0, 160).replace(/\s+/g, " ");
    const ctx = lastHeading && !head.startsWith(lastHeading.slice(0, 40)) ? `${lastHeading} | ${head}` : head;
    parts.forEach((part, i) => paragraphs.push(i === 0 ? part : `(Lanjutan dari: ${ctx}…)\n${part}`));
  }
  if (carry) paragraphs.push(carry);
  const chunks = [];
  let buffer = "";
  for (const p of paragraphs) {
    if (buffer && (buffer.length + p.length + 2) > chunkSize) {
      chunks.push(buffer);
      buffer = p;
    } else {
      buffer = buffer ? `${buffer}\n\n${p}` : p;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

// Cari potongan Dokumen Pengetahuan paling relevan dgn `question`, dibatasi
// total `budgetChars` karakter (biar prompt ke Ollama tidak kegedean --
// inget num_ctx cuma 4096 token & inferensinya CPU-only). Return array
// kosong kalau tabel kosong/error (BUKAN exception -- kegagalan RAG tidak
// boleh bikin seluruh auto-reply gagal, cukup lanjut tanpa konteks dokumen).
// Peringkat potongan dari kumpulan dokumen {title, content} (tanpa akses database) --
// dipakai fetchRelevantKnowledgeChunks (Dokumen Pengetahuan) & agen chat aplikasi
// (lampiran file).
function rankKnowledgeChunks(docs, question, budgetChars) {
  const qWords = new Set(tokenizeForScoring(question));
  if (qWords.size === 0 || !docs || docs.length === 0) return [];

  const scored = [];
  for (const doc of docs) {
    for (const chunk of chunkDocumentText(doc.content, RAG_CHUNK_SIZE_CHARS)) {
      const chunkWords = tokenizeForScoring(chunk);
      if (chunkWords.length === 0) continue;
      let score = 0;
      for (const w of chunkWords) {
        if (qWords.has(w)) score++;
      }
      if (score > 0) scored.push({ score, title: doc.title, text: chunk });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;
  for (const item of scored) {
    if (used >= budgetChars) break;
    picked.push(item);
    used += item.text.length;
  }
  return picked;
}

// Indeks pencarian dokumen di laptop (SQLite FTS5, lihat kb-index.js / kb-ingest.js).
// Diisi saat start; kalau gagal dibuka, RAG kembali ke cara lama (ambil dari Supabase).
let kbIndex = null;

// Saring dokumen menurut potongan judul (mis. grup yang hanya boleh memakai surat tertentu). titles=null -> semua.
function titleMatches(title, titles) {
  if (!titles || titles.length === 0) return true;
  const t = String(title || "").toLowerCase();
  return titles.some((x) => t.includes(String(x).toLowerCase()));
}

async function fetchRelevantKnowledgeChunks(question, budgetChars, titles = null) {
  // Dokumen yang diupload lewat laptop diindeks FULL (tanpa batas ukuran) --
  // cari di indeks itu dulu. Rekonsiliasi berkala menjamin isinya sama dengan
  // tabel knowledge_documents, jadi kalau indeks ada isinya, tak perlu ke Supabase.
  if (kbIndex && kbIndex.hasDocs()) {
    return kbIndex.search(question, { budgetChars, maxChunks: 8, titles }).map(({ title, text }) => ({ title, text }));
  }
  const qWords = new Set(tokenizeForScoring(question));
  if (qWords.size === 0) return [];

  const { data, error } = await supabase.from("knowledge_documents").select("title, content").neq("content", "");
  if (error) {
    console.error("RAG: gagal ambil Dokumen Pengetahuan, lanjut tanpa konteks dokumen:", error.message);
    return [];
  }
  const docs = (data ?? []).filter((d) => titleMatches(d.title, titles));
  if (docs.length === 0) return [];
  return rankKnowledgeChunks(docs, question, budgetChars);
}

// ----------------------------------------------------------------
// Versi untuk mesin GEMINI: dokumen jadi sumber UTAMA angka/tarif/aturan
// (model dapat potongan dokumen + hasil web, bukan Google Search). Beda dari
// versi Ollama di atas:
//   - skor berbobot "kelangkaan kata" (IDF): kata yang jarang di seluruh
//     dokumen (mis. "yogyakarta") jauh lebih berharga daripada kata yang ada
//     di mana-mana (mis. "tarif", "golongan") -- jadi baris tabel yang memuat
//     nama wilayah yang ditanyakan menang atas potongan yang cuma mengulang
//     kata umum;
//   - wajib cocok minimal 2 kata berbeda (kecuali query-nya cuma 1-2 kata)
//     supaya tidak menyodorkan potongan yang kebetulan cuma 1 kata sama
//     (potongan lanjutan tabel membawa judul tabelnya, lihat chunkDocumentText,
//     jadi baris "Yogyakarta" di tabel PENGINAPAN cocok 2 kata, sedangkan baris
//     "Yogyakarta" di tabel uang harian tidak);
//   - budget lebih besar (Gemini jauh lebih lega dari Ollama CPU), tapi tetap
//     DIBATASI -- tidak "baca seluruh dokumen";
//   - dokumen dipotong & diindeks SEKALI lalu di-cache GEMINI_RAG_CACHE_MS,
//     supaya tiap pertanyaan tidak menarik ulang & memproses semua dokumen.
// ----------------------------------------------------------------
const GEMINI_RAG_BUDGET_CHARS = Number(process.env.GEMINI_RAG_BUDGET_CHARS) > 0 ? Number(process.env.GEMINI_RAG_BUDGET_CHARS) : 10000;
const GEMINI_RAG_MAX_CHUNKS = Number(process.env.GEMINI_RAG_MAX_CHUNKS) > 0 ? Number(process.env.GEMINI_RAG_MAX_CHUNKS) : 8;
const GEMINI_RAG_MAX_CHUNK_CHARS = 2500;
const GEMINI_RAG_CACHE_MS = 5 * 60_000;
let knowledgeIndexCache = { at: 0, chunks: [], df: new Map() };

async function getKnowledgeIndexCached() {
  if (Date.now() - knowledgeIndexCache.at < GEMINI_RAG_CACHE_MS) return knowledgeIndexCache;
  const { data, error } = await supabase.from("knowledge_documents").select("title, content");
  if (error) {
    console.error("RAG: gagal ambil Dokumen Pengetahuan, lanjut tanpa konteks dokumen:", error.message);
    return knowledgeIndexCache; // pakai indeks lama kalau ada
  }
  const chunks = [];
  const df = new Map(); // kata -> jumlah potongan yang memuatnya
  for (const doc of data ?? []) {
    for (const text of chunkDocumentText(doc.content, RAG_CHUNK_SIZE_CHARS)) {
      const counts = new Map();
      for (const w of tokenizeForScoring(text)) counts.set(w, (counts.get(w) || 0) + 1);
      if (counts.size === 0) continue;
      chunks.push({ title: doc.title, text, counts });
      for (const w of counts.keys()) df.set(w, (df.get(w) || 0) + 1);
    }
  }
  knowledgeIndexCache = { at: Date.now(), chunks, df };
  return knowledgeIndexCache;
}

// Return [{ score, distinct, title, text }] terurut skor menurun (bisa kosong).
async function fetchKnowledgeChunksForGemini(query, titles = null) {
  // Indeks lengkap di laptop (FTS5 + imbuhan, seluruh teks, ber-halaman) lebih baik daripada salinan Supabase yang
  // terpotong; pencari TF-IDF di bawah hanya cadangan bila indeks laptop tidak aktif/kosong.
  if (kbIndex && kbIndex.hasDocs()) {
    return kbIndex
      .search(query, { budgetChars: GEMINI_RAG_BUDGET_CHARS, maxChunks: GEMINI_RAG_MAX_CHUNKS, titles })
      .map((b) => ({ score: b.score, distinct: 0, title: b.title, text: b.text }));
  }
  const baseTokens = [...new Set(tokenizeForScoring(query))];
  if (baseTokens.length === 0) return [];
  // Tiap kata pertanyaan = 1 "grup" alternatif (kata itu + perluasannya).
  const groups = baseTokens.map((w) => [w, ...(QUERY_EXPANSIONS[w] ?? [])]);
  const { chunks, df } = await getKnowledgeIndexCached();
  if (chunks.length === 0) return [];
  const n = chunks.length;
  const minDistinct = Math.min(2, groups.length);

  const scored = [];
  for (const ch of chunks) {
    if (!titleMatches(ch.title, titles)) continue;
    let distinct = 0;
    let score = 0;
    for (const group of groups) {
      let best = 0;
      for (const w of group) {
        const c = ch.counts.get(w);
        if (!c) continue;
        const s = Math.log(1 + n / (df.get(w) || 1)) * (1 + 0.1 * Math.min(c - 1, 4));
        if (s > best) best = s;
      }
      if (best > 0) {
        distinct++;
        score += best;
      }
    }
    if (distinct >= minDistinct) scored.push({ score, distinct, title: ch.title, text: ch.text });
  }
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;
  for (const item of scored) {
    if (picked.length >= GEMINI_RAG_MAX_CHUNKS || used >= GEMINI_RAG_BUDGET_CHARS) break;
    const text = item.text.length > GEMINI_RAG_MAX_CHUNK_CHARS ? `${item.text.slice(0, GEMINI_RAG_MAX_CHUNK_CHARS)}...` : item.text;
    picked.push({ ...item, text });
    used += text.length;
  }
  return picked;
}

// ================================================================
// Pencarian web "manual" buat model lokal (yang TIDAK punya akses internet
// bawaan seperti Gemini) -- scraping halaman hasil BING (bing.com/search),
// BUKAN API resmi berbayar, tanpa API key, cocok buat pemakaian personal
// skala kecil begini.
//
// KENAPA BING, BUKAN DuckDuckGo? Sempat dicoba DuckDuckGo duluan, tapi
// kebukti (lihat tes di server user, error ERR_TLS_CERT_ALTNAME_INVALID
// dgn sertifikat milik domain ISP "ioh.co.id") provider internet user
// MEMBLOKIR/meng-intersepsi koneksi ke html.duckduckgo.com di level
// jaringan -- bukan soal kode. Bing & Google dites BISA diakses normal
// (status 200) dari jaringan yang sama, jadi dipindah ke Bing (scraping
// Google lebih berisiko kena CAPTCHA/block krn lebih agresif deteksi bot).
//
// Kalau suatu saat strukturnya berubah atau diblokir juga & parsing ini
// berhenti nemu apa-apa, paling auto-reply jalan TANPA hasil web (fallback
// aman, lihat pemanggil), bukan bikin bot crash -- tapi jalankan
// test-ollama-websearch.mjs buat ketahuan dari awal kalau ini kejadian.
// ================================================================
async function webSearchBing(query, maxResults) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    // Struktur umum halaman hasil Bing: tiap hasil ada di <li class="b_algo">,
    // judul di dalam <h2>, ringkasan di ".b_caption p" (kadang berubah jadi
    // class ".b_lineclampN" tergantung versi) -- dicoba beberapa fallback
    // selector ringkasan biar tidak gampang nemu 0 hasil cuma gara2 Bing
    // ganti nama class.
    // Snippet dipotong max 220 karakter -- Bing kadang ngasih cuplikan cukup
    // panjang, dan tiap karakter ekstra di sini ikut numpuk ke ukuran prompt
    // yang harus "dibaca" Ollama (lihat catatan kecepatan di
    // RAG_CONTEXT_BUDGET_CHARS).
    const SNIPPET_MAX_CHARS = 220;
    $("li.b_algo").each((_, el) => {
      if (results.length >= maxResults) return;
      const title = $(el).find("h2").text().trim();
      let snippet = $(el).find(".b_caption p").first().text().trim();
      if (!snippet) snippet = $(el).find("[class^='b_lineclamp']").first().text().trim();
      if (!snippet) snippet = $(el).find("p").first().text().trim();
      if (snippet.length > SNIPPET_MAX_CHARS) snippet = `${snippet.slice(0, SNIPPET_MAX_CHARS)}...`;
      if (title || snippet) results.push({ title, snippet });
    });
    return results;
  } catch (err) {
    console.error("Web search (Bing) gagal, lanjut tanpa hasil web:", err instanceof Error ? err.message : String(err));
    return [];
  }
}
// Diperkecil dari 4 -> 3 hasil (alasan sama: makin sedikit teks yang
// disodorkan ke Ollama, makin cepat prompt eval-nya -- lihat catatan
// kecepatan di RAG_CONTEXT_BUDGET_CHARS).
const WEB_SEARCH_MAX_RESULTS = 3;

// Pencarian web: API (Tavily/Serper/Brave, kalau key-nya diisi di .env) dengan rotasi key, lalu Bing
// (scraping di atas) sebagai cadangan terakhir. Hasil API membawa URL sumber. Lihat web-search.js.
const webSearch = createWebSearch({ config: readSearchConfig(process.env), bing: webSearchBing, onEvent: (e) => reportLlmEvent(e) });
if (webSearch.available()) console.log(`🔎 Pencarian web: ${webSearch.describe()}`);

// Gabung potongan dokumen + hasil web (kalau ada) jadi 1 blok teks yang
// ditaruh SEBELUM pertanyaan asli di giliran "user" terakhir -- pola ini
// (konteks + pertanyaan dalam 1 pesan yang sama) PERSIS yang terbukti
// jalan di tes manual qwen2.5:3b (lihat riwayat percakapan: model jadi
// akurat & tidak ngarang begitu konteksnya ditaruh jadi satu kesatuan
// dengan pertanyaan, drpd dipisah jadi system message terpisah yang kadang
// diabaikan model kecil).
function buildGroundedUserMessage(originalText, docChunks, webResults) {
  const parts = [];
  if (docChunks.length > 0) {
    const docBlock = docChunks.map((c) => `[Dari dokumen: ${c.title}]\n${c.text}`).join("\n\n");
    parts.push(`KONTEKS DOKUMEN (dari Dokumen Pengetahuan, dicarikan otomatis, mungkin relevan -- kalau tidak relevan, abaikan):\n${docBlock}`);
  }
  if (webResults.length > 0) {
    const webBlock = webResults.map((r, i) => `${i + 1}. ${r.title} -- ${r.snippet}${r.url ? `\n   Sumber: ${r.url}` : ""}`).join("\n");
    parts.push(`HASIL PENCARIAN WEB (dicarikan otomatis, mungkin relevan -- kalau tidak relevan, abaikan):\n${webBlock}`);
  }
  if (parts.length === 0) return originalText;
  return `${parts.join("\n\n")}\n\nPertanyaan dari kontak: ${originalText}`;
}

// Prompt sistem KHUSUS mesin "ollama" -- isinya sama persis dgn
// WA_BASE_SYSTEM_PROMPT (rem pengaman TIDAK berubah) tapi paragraf
// "akses pencarian Google" diganti penjelasan soal blok KONTEKS
// DOKUMEN/HASIL PENCARIAN WEB yang disisipkan manual (lihat
// buildGroundedUserMessage) -- model lokal tidak punya tools bawaan
// seperti Gemini, jadi perlu dikasih tau eksplisit gimana cara pakai
// konteks itu & kapan HARUS mengaku tidak tahu drpd mengarang.
const WA_OLLAMA_SYSTEM_PROMPT = `Kamu adalah asisten AI yang membalas pesan WhatsApp ATAS NAMA pemilik nomor ini secara OTOMATIS, tanpa pemilik nomor sempat membaca/menyetujui dulu. Kamu jalan sebagai model AI LOKAL di laptop pemilik nomor (BUKAN di internet) -- kamu TIDAK py akses pencarian sendiri, tapi kadang sebelum pertanyaan dari kontak akan ada blok "KONTEKS DOKUMEN" dan/atau "HASIL PENCARIAN WEB" yang DICARIKAN OTOMATIS oleh sistem (bukan kamu yang mencari).

PENTING soal konteks itu: pakai isinya KALAU relevan buat menjawab. Kalau ternyata tidak nyambung ke pertanyaan (atau tidak ada blok konteksnya sama sekali), jawab pakai pengetahuan umum kamu seperlunya, TAPI kalau pertanyaannya soal istilah/aturan/lembaga resmi yang SPESIFIK (nama lembaga, nomor peraturan, kepanjangan singkatan resmi, dll) dan kamu TIDAK yakin atau TIDAK ada di konteks yang dikasih -- JANGAN MENGARANG. Akui terus terang tidak tahu pastinya & sarankan cek sumber resmi, drpd kasih jawaban yang kedengaran meyakinkan tapi salah.

Jawab pertanyaan, bantu coding/debugging, atau ajak diskusi dengan ramah, jelas, dan SERINGKAS MUNGKIN tanpa kehilangan inti jawaban -- kamu jalan di hardware yang lumayan lambat & ada batas keras panjang jawaban, jadi USAHAKAN selesai dalam sekitar 120-150 kata (poin-poin singkat lebih baik drpd paragraf panjang bertele-tele), kecuali pertanyaannya benar-benar butuh penjelasan/kode yang lebih panjang. Kalau diminta bantuan kode, tulis kodenya di dalam blok \`\`\`seperti ini\`\`\` (WhatsApp menampilkannya sebagai monospace) lalu jelaskan secukupnya.

Gunakan Bahasa Indonesia, kecuali lawan bicara jelas menulis/minta bahasa lain -- kalau begitu, balas di bahasa itu. WhatsApp CUMA mendukung *tebal*, _miring_, ~coret~, dan blok kode \`\`\`...\`\`\` -- JANGAN pakai format markdown lain (heading #, tabel, bullet list dengan -, dll) karena tidak akan tampil rapi.

ATURAN PENGAMAN (berlaku terus walau topiknya bebas):
1. JANGAN membuat janji, komitmen, keputusan, harga, jadwal pasti, atau kesepakatan apa pun atas nama pemilik nomor -- untuk hal semacam itu, balas sopan bahwa pesannya diterima dan pemiliknya akan membalas langsung.
2. JANGAN membagikan informasi pribadi/sensitif (keuangan, kesehatan, jadwal detail, data pribadi) tentang pemilik nomor.
3. Kalau pesan masuk jelas butuh keputusan manusia (negosiasi, hal mendesak, masalah pribadi/emosional, komplain serius), jangan improvisasi -- cukup akui pesannya diterima dan akan ditindaklanjuti langsung oleh pemiliknya.`;

// ANTRIAN GLOBAL buat panggilan Ollama -- CPU laptop ini cuma 2 core/4
// thread & TERBUKTI lambat (~4.5 token/detik, lihat hasil tes user). Kalau
// 2 pertanyaan masuk berdekatan (misal kontak yang sama kirim 2 pesan
// cepat, atau 2 kontak beda kirim bareng) dan DUA-duanya langsung coba
// generate BARENGAN, mereka rebutan CPU yang sama & JUSTRU membuat
// dua-duanya lebih lambat/lebih gampang kena timeout drpd diproses satu-
// satu bergiliran -- ini KEBUKTI kejadian di tes user (kirim ulang
// pertanyaan yg sama 2x sementara percobaan pertama belum selesai, hasilnya
// 2 gagal, baru yang ketiga -- diproses sendirian -- berhasil). Antrian ini
// memaksa cuma ADA 1 panggilan Ollama yang benar2 jalan dalam satu waktu;
// panggilan lain nunggu giliran drpd jalan bareng & saling memperlambat.
// Satu baris "Waktu sekarang: ..." -- model lokal juga TIDAK tahu tanggal hari ini.
function currentDateLine() {
  const nowText = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: WA_TIMEZONE }).format(new Date());
  return `Waktu sekarang: ${nowText} ${WA_TIMEZONE_LABEL}. Anggap ini tanggal hari ini.`;
}

// Antrean berprioritas (lihat ollama-queue.js): chat aplikasi (0) mendahului
// balasan WhatsApp (1) yang mendahului pekerjaan latar seperti ringkasan harian (2).
// `pending` = jumlah panggilan yang lagi jalan/menunggu giliran -- cadangan
// auto-reply tidak mau ikut mengantre di belakang pekerjaan lain, supaya kontak
// tidak menunggu lama; lihat sendAutoReply.
const ollamaQueue = createPriorityQueue({ agingMs: Number(process.env.OLLAMA_QUEUE_AGING_MS) || 120000 });
function enqueueOllamaCall(fn, opts) {
  return ollamaQueue.enqueue(fn, opts);
}

// Cadangan: model yang terakhir dipakai. Kalau panggilan berikutnya memakai
// model LAIN, model lama dibongkar dari RAM dulu (keep_alive 0) -- laptop ini
// hanya 7,5 GB RAM, dua model dimuat bareng akan membuat sistem swap berat.
let lastOllamaModel = null;
async function unloadOllamaModel(model) {
  try {
    await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    // best-effort
  }
}

// Info memori laptop (Linux) untuk halaman Status Sistem.
function readMemInfo() {
  try {
    const txt = fs.readFileSync("/proc/meminfo", "utf8");
    const kb = (k) => {
      const m = txt.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"));
      return m ? Number(m[1]) : 0;
    };
    return {
      totalMB: Math.round(kb("MemTotal") / 1024),
      availableMB: Math.round(kb("MemAvailable") / 1024),
      swapUsedMB: Math.round((kb("SwapTotal") - kb("SwapFree")) / 1024)
    };
  } catch {
    return null;
  }
}

// Satu kali panggilan ke Ollama (server lokal, default port 11434 -- lihat
// OLLAMA_BASE_URL) pakai endpoint /api/chat (format "messages" kayak
// OpenAI/Gemini chat API, BUKAN /api/generate yang formatnya 1 prompt
// mentah). stream:false biar responsnya 1 JSON utuh sekali balik, bukan
// potongan-potongan (lebih gampang ditangani drpd streaming, auto-reply WA
// toh baru dikirim setelah teksnya LENGKAP).
async function callOllamaChat(messages, { timeoutMs = OLLAMA_TIMEOUT_MS, maxTokens = OLLAMA_MAX_OUTPUT_TOKENS, numCtx = OLLAMA_NUM_CTX, format = undefined, temperature = 0.4, model = OLLAMA_MODEL, onToken = undefined } = {}) {
  if (lastOllamaModel && lastOllamaModel !== model) await unloadOllamaModel(lastOllamaModel);
  lastOllamaModel = model;
  // Lewat node:http + stream (lihat ollama-http.js): fetch bawaan Node memutus
  // request yang menunggu > 300 detik ("fetch failed"), padahal di laptop ini
  // jawaban berbasis dokumen bisa lebih lama dari itu.
  const { content } = await ollamaChatStream({
    baseUrl: OLLAMA_BASE_URL,
    timeoutMs,
    onToken,
    body: {
      model,
      messages,
      // keep_alive: berapa lama model dibiarkan di RAM sejak pemakaian terakhir
      // (lihat OLLAMA_KEEP_ALIVE di atas).
      keep_alive: OLLAMA_KEEP_ALIVE,
      ...(format ? { format } : {}),
      options: { num_ctx: numCtx, num_predict: maxTokens, temperature }
    }
  });
  return content;
}

// Versi generateAutoReply KHUSUS mesin "ollama": ambil riwayat (sama persis
// query & urutan dgn versi Gemini di bawah -- lihat catatan descending+
// reverse di sana soal kenapa), lalu SISIPKAN konteks RAG + web search ke
// pertanyaan TERAKHIR sebelum dikirim ke Ollama. tokensUsed/costUsd selalu
// 0 (model lokal, tidak ada biaya/kuota token API) -- recordTokenUsage
// sudah otomatis skip kalau tokensUsed 0, jadi tidak mencemari angka
// pemakaian Gemini di footer aplikasi.
async function generateAutoReplyWithOllama(jid, { timeoutMs } = {}) {
  const { data: historyRowsDesc, error: historyErr } = await supabase
    .from("whatsapp_messages")
    .select("direction, content")
    .eq("wa_jid", jid)
    .order("created_at", { ascending: false })
    .limit(OLLAMA_HISTORY_LIMIT);
  if (historyErr) throw new Error(`Gagal ambil riwayat: ${historyErr.message}`);

  const historyRows = (historyRowsDesc ?? []).slice().reverse();
  const messages = historyRows
    .filter((row) => row.content)
    .map((row) => ({ role: row.direction === "in" ? "user" : "assistant", content: row.content }));

  while (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    messages.pop();
  }
  if (messages.length === 0) return null;

  const question = messages[messages.length - 1].content;
  const searchQuestion = stripGroupMeta(jid, question);

  // Grup: obrolan santai tidak perlu dokumen/web (lihat GROUP_LOOKUP_RE).
  // Dokumen (pencarian lokal, murah) boleh selalu dicari di grup (WA_GROUP_DOCS); web (Bing) tetap hanya bila ada kata kunci.
  const lookupAllowed = !isGroupJid(jid) || GROUP_LOOKUP_RE.test(searchQuestion);
  const docsAllowed = lookupAllowed || (GROUP_DOCS_ALWAYS && searchQuestion.trim().split(/\s+/).length >= 3);
  const pinnedTitles = docTitlesFor(jid);
  const docChunks = docsAllowed ? await fetchRelevantKnowledgeChunks(searchQuestion, RAG_CONTEXT_BUDGET_CHARS, pinnedTitles) : [];
  const topScore = docChunks[0]?.score ?? 0;
  const webResults = !lookupAllowed || pinnedTitles || topScore >= RAG_STRONG_MATCH_SCORE ? [] : await webSearch.search(searchQuestion, WEB_SEARCH_MAX_RESULTS, { snippetChars: 220 });

  // Log diagnostik ringan (BUKAN isi lengkap dokumen/pertanyaan, cuma
  // judul+skor) -- biar kalau jawabannya aneh/salah sasaran lagi, langsung
  // ketahuan dari `pm2 logs` apakah sebabnya RAG salah nyangkut ke dokumen
  // yang gak relevan (lihat judulnya), pencarian Bing yang di-skip/gagal,
  // atau murni modelnya sendiri yang salah paham walau konteksnya benar.
  const docTitlesPreview = docChunks.map((c) => `"${c.title}"(skor ${c.score})`).join(", ") || "-";
  console.log(
    `🔍 [RAG+web] jid=${jid} skorTertinggi=${topScore} dokumenDipakai=[${docTitlesPreview}] ` +
      `webDi-skip=${topScore >= RAG_STRONG_MATCH_SCORE ? "ya (skor kuat)" : "tidak"} hasilWeb=${webResults.length}`
  );

  messages[messages.length - 1] = {
    role: "user",
    content: buildGroundedUserMessage(question, docChunks, webResults)
  };

  // Lewat antrian (enqueueOllamaCall) -- lihat catatan di atasnya kenapa:
  // timer timeout (OLLAMA_TIMEOUT_MS) baru mulai jalan begitu giliran
  // permintaan ini BENERAN dieksekusi (bukan dari saat masuk antrian), jadi
  // nunggu antrian TIDAK ikut makan jatah waktu timeout-nya.
  const replyText = await enqueueOllamaCall(
    () =>
      callOllamaChat(
        [{ role: "system", content: `${withGroupNote(WA_OLLAMA_SYSTEM_PROMPT, jid)}\n\n${currentDateLine()}` }, ...messages],
        { ...(timeoutMs ? { timeoutMs } : {}), ...(docChunks.length > 0 ? { temperature: OLLAMA_DOC_TEMPERATURE } : {}) }
      ),
    { priority: PRIORITY.WA, label: "wa-reply" }
  );

  return { reply: replyText.trim(), tokensUsed: 0, costUsd: 0 };
}

// Tabel harga & logika estimasi biaya -- SALINAN dari
// supabase/functions/_shared/gemini.ts, lihat catatan sinkronisasi di atas.
const GEMINI_3_6_FLASH_PRICE_BUMP_AT = new Date("2027-01-01T00:00:00Z");
function getModelPricing(model) {
  const table = {
    "gemini-3.6-flash": new Date() < GEMINI_3_6_FLASH_PRICE_BUMP_AT ? { input: 0.75, output: 3.75 } : { input: 1.5, output: 7.5 },
    "gemini-3.5-flash": { input: 1.5, output: 9.0 }
  };
  return table[model] ?? table["gemini-3.6-flash"];
}
function estimateCostUsd(model, promptTokens, outputTokens) {
  const price = getModelPricing(model);
  return (promptTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

// ================================================================
// ROTASI BEBERAPA API KEY GEMINI -- lihat GEMINI_API_KEYS di atas. Dipakai
// kalau user py lebih dari 1 akun Google, tiap akun bikin API key sendiri2
// di AI Studio, masing2 dapat jatah gratis 20 request/hari SENDIRI2 --
// begitu key yang lagi dipakai kena 429 (RESOURCE_EXHAUSTED, lihat error
// "GenerateRequestsPerDayPerProjectPerModel-FreeTier" yg kejadian di
// riwayat percakapan), otomatis pindah ke key berikutnya yg belum habis,
// drpd auto-reply diam/fallback padahal masih ada jatah di key lain.
//
// Kapan sebuah key dianggap "boleh dicoba lagi": quota gratis Gemini
// kebiasaannya reset tiap tengah malam Pacific Time (konsisten dgn
// timezone yg sudah dipakai utk token_usage harian di recordTokenUsage di
// bawah) -- jadi begitu 1 key kena 429, ditandai "jangan dipakai lagi
// sampai tengah malam Pacific berikutnya" drpd dicoba berulang2 sia2.
const geminiKeyExhaustedUntil = new Map(); // apiKey -> timestamp ms boleh dicoba lagi
let geminiKeyCursor = 0; // index key yg jadi titik mulai pencarian berikutnya

function nextMidnightPacificMs() {
  const pacificNowStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pacificNow = new Date(pacificNowStr);
  const nextMidnight = new Date(pacificNow);
  nextMidnight.setHours(24, 0, 5, 0); // +5 detik jaga2 drpd pas-pasan
  return Date.now() + (nextMidnight.getTime() - pacificNow.getTime());
}

// Cari API key yg belum ditandai habis, mulai dari geminiKeyCursor (biar
// gilirannya muter rata, bukan selalu balik ke key #0 duluan). Return null
// kalau SEMUA key lagi dalam masa "habis".
function pickAvailableGeminiKey() {
  const now = Date.now();
  for (let i = 0; i < GEMINI_API_KEYS.length; i++) {
    const idx = (geminiKeyCursor + i) % GEMINI_API_KEYS.length;
    const key = GEMINI_API_KEYS[idx];
    if (now >= (geminiKeyExhaustedUntil.get(key) || 0)) return key;
  }
  return null;
}

// Tanggal "hari ini" zona Pasifik (YYYY-MM-DD) -- sama dgn kunci harian
// token_usage & reset kuota Gemini.
function pacificDateString() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// Pengenal key yang AMAN disimpan/ditampilkan: 4 karakter terakhir saja.
function geminiKeyHint(key) {
  return key.slice(-4);
}

// Ambil teks jawaban dari respons Gemini dengan menggabung SEMUA bagian
// (parts) yang berupa teks. Model "thinking" kadang mengirim bagian PERTAMA
// berisi text:"" + thoughtSignature, dan jawaban aslinya baru ada di bagian
// berikutnya -- membaca parts[0] saja salah mengira respons kosong & bot
// membalas "sistem penuh" padahal AI-nya sebenarnya menjawab.
function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => typeof p?.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
}

// Ringkas pesan error 429 dari Google jadi 1 baris yang memuat PENYEBAB-nya.
// Respons aslinya JSON panjang; bagian yang berguna (quotaId / quotaMetric,
// model, retryDelay) ada di "details" SETELAH kalimat generik "You exceeded
// your current quota...", jadi kalau cuma dipotong 300 karakter dari depan
// bagian itu hilang. Gagal parse = jatuh ke potongan teks mentah.
function summarizeGeminiError(raw) {
  const text = String(raw ?? "");
  try {
    const start = text.indexOf("{");
    const parsed = start >= 0 ? JSON.parse(text.slice(start)) : null;
    const e = parsed?.error;
    if (e) {
      const parts = [];
      if (e.code) parts.push(String(e.code));
      const violations = [];
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

// Catat kejadian key ke tabel gemini_key_usage (buat layar "Status API
// Gemini" di aplikasi). Best-effort: gagal catat TIDAK boleh mengganggu
// auto-reply (mis. migration 0013 belum dijalankan).
let keyReportWarned = false;
function reportKeyEvent(key, { requestsInc = 0, exhaustedUntilMs = null, error = null } = {}) {
  supabase
    .rpc("report_gemini_key_event", {
      p_usage_date: pacificDateString(),
      p_key_hint: geminiKeyHint(key),
      p_source: "wa-bot",
      p_requests_inc: requestsInc,
      p_exhausted_until: exhaustedUntilMs ? new Date(exhaustedUntilMs).toISOString() : null,
      p_error: error ? summarizeGeminiError(error) : null
    })
    .then(({ error: rpcErr }) => {
      if (rpcErr && !keyReportWarned) {
        keyReportWarned = true;
        console.warn(`Gagal catat status key Gemini ke database (sudah jalankan migration 0013?): ${rpcErr.message}`);
      }
    })
    .catch(() => {});
}

// Catat pemakaian penyedia cadangan (Groq/OpenRouter) untuk layar "Status Sistem" di aplikasi
// (tabel gemini_key_usage, kolom provider -- migration 0020). Hanya 4 karakter terakhir key.
let llmReportWarned = false;
function reportLlmEvent(e) {
  supabase
    .rpc("report_llm_key_event", {
      p_provider: e.provider,
      p_usage_date: new Date().toISOString().slice(0, 10),
      p_key_hint: e.keyHint,
      p_source: "wa-bot",
      p_requests_inc: e.kind === "success" ? 1 : 0,
      p_exhausted_until: e.untilMs ? new Date(e.untilMs).toISOString() : null,
      p_error: e.kind === "success" ? null : e.error ?? null,
      p_model: e.kind === "success" ? e.model || null : null,
      p_clear_exhausted: e.kind === "success"
    })
    .then(({ error }) => {
      if (error && !llmReportWarned) {
        llmReportWarned = true;
        console.warn(`Gagal catat pemakaian penyedia cadangan/pencarian (sudah jalankan migration 0020 dan 0022?): ${error.message}`);
      }
    })
    .catch(() => {});
}

// Waktu start/restart bot: ingat key yang SUDAH habis hari ini (dicatat bot
// ini sendiri sebelumnya), supaya habis restart bot tidak buang-buang request
// mencoba key yang sudah pasti ditolak lagi. Hanya baris source='wa-bot' yang
// dipakai -- status dari Edge Function chat bisa beda (model/jalur berbeda).
async function primeExhaustedKeysFromDb() {
  if (WA_AI_ENGINE !== "gemini" || GEMINI_API_KEYS.length === 0) return;
  try {
    const baseQuery = () =>
      supabase
        .from("gemini_key_usage")
        .select("key_hint, exhausted_until")
        .eq("usage_date", pacificDateString())
        .eq("source", "wa-bot")
        .gt("exhausted_until", new Date().toISOString());
    // Hanya baris Gemini (kolom provider ada sejak migration 0020; sebelum itu semua baris memang Gemini).
    let { data, error } = await baseQuery().eq("provider", "gemini");
    if (error) ({ data, error } = await baseQuery());
    if (error) return; // tabel belum ada / error lain: abaikan, bot tetap jalan normal
    for (const row of data ?? []) {
      const matches = GEMINI_API_KEYS.filter((k) => geminiKeyHint(k) === row.key_hint);
      if (matches.length !== 1) continue; // hint ambigu: lebih aman tidak ditebak
      geminiKeyExhaustedUntil.set(matches[0], new Date(row.exhausted_until).getTime());
      console.log(`ℹ️  API key Gemini ...${row.key_hint} tercatat masih habis kuota, dilewati sampai reset.`);
    }
  } catch (_err) {
    /* abaikan */
  }
}

// ---------------- Alert "semua API key habis" ke nomor pemilik ----------------
// True kalau SEMUA key lagi dalam masa istirahat PANJANG (> 10 menit = jatah
// harian habis, bukan sekadar rate-limit per menit yang sembuh sendiri).
function allGeminiKeysExhaustedForLong() {
  if (GEMINI_API_KEYS.length === 0) return false;
  const threshold = Date.now() + 10 * 60_000;
  return GEMINI_API_KEYS.every((k) => (geminiKeyExhaustedUntil.get(k) || 0) > threshold);
}

function formatClockInTimezone(ms) {
  return new Intl.DateTimeFormat("id-ID", { timeZone: WA_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(ms))
    .replace(".", ":");
}

// Dipanggil tiap kali sebuah key ditandai habis (atau saat semua key sudah
// habis waktu mau dipakai). Maksimal SEKALI per hari (dicatat di bot_state,
// jadi aman walau bot di-restart) supaya tidak spam.
let allKeysAlertInFlight = false;
async function notifyOwnerAllKeysExhausted() {
  if (!OWNER_JID || !currentSock || allKeysAlertInFlight || !allGeminiKeysExhaustedForLong()) return;
  allKeysAlertInFlight = true;
  try {
    const today = pacificDateString();
    const { data } = await supabase.from("bot_state").select("value").eq("key", "all_keys_alert_date").maybeSingle();
    if (data?.value === today) return;

    const resetMs = Math.min(...GEMINI_API_KEYS.map((k) => geminiKeyExhaustedUntil.get(k) || Infinity));
    const resetText = Number.isFinite(resetMs) ? `sekitar pukul ${formatClockInTimezone(resetMs)} ${WA_TIMEZONE_LABEL}` : "besok";
    await currentSock.sendMessage(OWNER_JID, {
      text:
        `⚠️ *Semua API key Gemini habis kuota harian* (${GEMINI_API_KEYS.length} key).\n\n` +
        `Gemini tidak bisa dipakai sampai kuota reset, ${resetText}. ` +
        (llmFallback.available() ? "" : `Pesan WA yang masuk selama itu akan dibalas otomatis begitu kuota kembali.`) + `\n\n` +
        (llmFallback.available()
          ? `Bot WA beralih otomatis ke penyedia cadangan (${llmFallback.describe()}), jadi balasan tetap jalan tanpa Google Search.`
          : `Tambah API key baru di GEMINI_API_KEYS (bot WA) dan secret Supabase kalau mau tetap jalan sebelum itu.`)
    });
    await supabase.from("bot_state").upsert({ key: "all_keys_alert_date", value: today, updated_at: new Date().toISOString() });
    console.log("📣 Peringatan 'semua key habis' dikirim ke nomor pemilik.");
  } catch (err) {
    console.error("Gagal kirim peringatan semua-key-habis:", err instanceof Error ? err.message : String(err));
  } finally {
    allKeysAlertInFlight = false;
  }
}

function markGeminiKeyExhausted(key, err) {
  // 429 "PerDay" = jatah harian habis (tunggu reset tengah malam Pacific);
  // 429 lain biasanya cuma rate-limit per menit -- cukup istirahat 1 menit.
  const isDaily = /PerDay/i.test(err?.message || "");
  const untilMs = isDaily ? nextMidnightPacificMs() : Date.now() + 60_000;
  geminiKeyExhaustedUntil.set(key, untilMs);
  const idx = GEMINI_API_KEYS.indexOf(key);
  geminiKeyCursor = (idx + 1) % GEMINI_API_KEYS.length; // mulai dr key berikutnya lain kali
  console.warn(
    `⚠️  API key Gemini #${idx + 1}/${GEMINI_API_KEYS.length} kena ${isDaily ? "kuota harian (sampai tengah malam Pacific Time)" : "rate limit (istirahat 1 menit)"}, pindah ke key lain.`
  );
  reportKeyEvent(key, { exhaustedUntilMs: untilMs, error: err?.message });
  if (isDaily) notifyOwnerAllKeysExhausted().catch(() => {});
}

// Satu kali panggilan mentah ke Gemini API. withTools=true nyalakan akses
// pencarian Google (lihat WA_BASE_SYSTEM_PROMPT). Melempar Error (dengan
// properti .status) kalau gagal, ditangani pemanggil (callGeminiWithRetry).
async function callGeminiOnce(systemText, contents, withTools, apiKey) {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemText }] },
    contents,
    ...(withTools ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0.6 }
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (res.ok) return res.json();
  const errText = await res.text();
  const err = new Error(`Gemini API error ${res.status}: ${errText}`);
  err.status = res.status;
  throw err;
}

// Retry ringan buat status sementara (429/503) -- beda dari versi lengkap di
// Edge Function `chat` yang juga punya fallback ke MODEL cadangan segala,
// di sini cukup retry model yang sama supaya kodenya tetap ringkas. CATATAN:
// 429 di sini sengaja TETAP dianggap "retryable" (nunggu 3 detik lalu coba
// lagi pakai key yg SAMA) -- 429 kadang cuma rate-limit PER MENIT yg
// sembuh sendiri, bukan jatah harian yg abis total. Keputusan "key ini
// beneran habis, pindah ke key lain" ada di generateAutoReplyWithGemini,
// SETELAH semua jatah retry di key ini benar2 habis.
async function callGeminiWithRetry(systemText, contents, withTools, maxAttempts, apiKey) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callGeminiOnce(systemText, contents, withTools, apiKey);
    } catch (err) {
      lastErr = err;
      const retryable = err.status === 429 || err.status === 503;
      if (!retryable || attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw lastErr;
}

// Dispatcher: generateAutoReply dipanggil pemanggil (sendAutoReply) TANPA
// peduli mesin apa yang lagi aktif -- tinggal arahkan ke implementasi yang
// sesuai WA_AI_ENGINE. Ini satu-satunya tempat percabangannya, biar gampang
// nambah mesin lain nanti kalau perlu.
async function generateAutoReply(jid) {
  if (WA_AI_ENGINE === "ollama") return generateAutoReplyWithOllama(jid);
  return generateAutoReplyWithGemini(jid);
}

// Satu "panggilan Gemini" lengkap dgn rotasi API key -- dipakai auto-reply
// DAN ringkasan harian. Urutan percobaan sama seperti generateChatReply() di
// Edge Function `chat`: kalau useSearch, coba dulu DENGAN akses internet (1x
// saja, jangan buang waktu retry di jalur ini kalau lagi padat), baru kalau
// gagal lanjut TANPA internet dengan sisa jatah retry. Semuanya dibungkus
// loop rotasi key: kalau key yang lagi dipakai ternyata kena kuota (429 yang
// masih bertahan setelah retry di callGeminiWithRetry), tandai habis & coba
// lagi dari awal pakai key berikutnya -- maksimal sebanyak jumlah key yang
// ada, biar tidak muter selamanya kalau semua key memang habis. Error selain
// 429 TIDAK memicu rotasi (langsung dilempar ke pemanggil).
//
// CATATAN Google Search: di akun gratis, tool google_search BISA ditolak 429
// di SEMUA key walau jalur biasa (tanpa tool) normal 200 -- terbukti lewat tes
// curl di server (4 key, 4 project beda). Maka begitu ditolak, tool itu
// "diistirahatkan" GOOGLE_SEARCH_BLOCK_MS (tidak dicoba lagi tiap pesan -- hemat
// 1 request & ~detik latensi), dan sebagai gantinya bot mencari sendiri lewat
// Bing (webSearchBing) lalu menyisipkan hasilnya ke pesan terakhir -- hanya
// kalau `webQuery` diberikan pemanggil.
let googleSearchBlockedUntil = 0;
const GOOGLE_SEARCH_BLOCK_MS = 30 * 60_000;
const GEMINI_WEB_MAX_RESULTS = 5;

// Kata tanya/tanda pengenal pesan yang kemungkinan butuh fakta dari internet.
const WEB_QUESTION_WORDS =
  /\b(apa|apakah|siapa|berapa|kapan|dimana|di mana|kemana|bagaimana|gimana|kenapa|mengapa|tarif|aturan|peraturan|harga|berita|terbaru|update|pmk|sbm|uu|perpres|jadwal|link|tautan)\b/i;

// Bikin query pencarian dari pesan masuk TERAKHIR (+ pesan sebelumnya kalau
// yang terakhir pendek, krn biasanya follow-up spt "sesuai sbm 2026?").
// Return "" = tidak usah cari (sapaan/basa-basi/pesan sangat pendek).
function buildWebQuery(userTexts) {
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const wordCount = (s) => (s ? s.split(" ").length : 0);
  const looksLikeQuestion = (s) => wordCount(s) >= 3 && (s.includes("?") || WEB_QUESTION_WORDS.test(s));
  const last = clean(userTexts[userTexts.length - 1]);
  const prev = clean(userTexts[userTexts.length - 2]);
  if (!last || last.startsWith("[")) return "";
  const prevUsable = prev && !prev.startsWith("[");
  if (!looksLikeQuestion(last)) {
    // Jawaban/lanjutan pendek atas pertanyaan sebelumnya (mis. bot tanya
    // "wilayah mana?" -> kontak jawab "Yogyakarta"): cari pakai pertanyaan
    // sebelumnya + jawaban ini, bukan dilewati.
    if (wordCount(last) <= 4 && prevUsable && looksLikeQuestion(prev)) return `${prev} ${last}`.slice(0, 200);
    return "";
  }
  // Pertanyaan pendek ("sesuai sbm 2026?") biasanya lanjutan -- gabung dgn
  // pesan sebelumnya supaya query-nya punya konteks.
  return (wordCount(last) < 8 && prevUsable ? `${prev} ${last}` : last).slice(0, 200);
}

async function geminiGenerateWithRotation(
  systemText,
  contents,
  { useSearch = true, webQuery = "", docChunks = [], pinnedDocs = false, docMiss = false } = {}
) {
  let attemptsLeft = Math.max(GEMINI_API_KEYS.length, 1);
  // Dokumen "dikunci" untuk grup ini: tanpa Google Search/Bing, jawab hanya dari dokumen.
  if (pinnedDocs) useSearch = false;
  const hasDocs = docChunks.length > 0;
  // Isi giliran "user" terakhir dgn KONTEKS DOKUMEN (kalau ada) -- dipakai di
  // SEMUA jalur (dgn/tanpa Google Search). Hasil web (Bing) ditambahkan di atasnya
  // khusus jalur tanpa Google Search (lihat getNoSearchPayload).
  const lastUserText = contents[contents.length - 1]?.parts?.[0]?.text ?? "";
  const withDocsContents = hasDocs
    ? [...contents.slice(0, -1), { role: "user", parts: [{ text: buildGroundedUserMessage(lastUserText, docChunks, []) }] }]
    : contents;
  // Model TIDAK tahu tanggal hari ini kecuali diberi tahu -- tanpa ini ia
  // menjawab pakai "kalender" data latihannya (mis. bilang aturan 2026 "baru
  // terbit pertengahan 2025 nanti").
  const nowText = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: WA_TIMEZONE
  }).format(new Date());
  const pinnedNote = pinnedDocs
    ? hasDocs
      ? `\n\nGRUP INI MEMAKAI DOKUMEN TERTENTU SEBAGAI ACUAN. Jawab HANYA dari KONTEKS DOKUMEN di pesan terakhir; jangan memakai pengetahuan umum, ingatan, atau internet untuk isi surat/aturan. Sebut judul dokumen dan nomor halaman bila ada. Kutipan kalimat ditulis persis dalam tanda « ». Kalau jawabannya tidak tertulis di potongan dokumen, jawab: "Informasi itu tidak ditemukan di dokumen acuan" dan jangan menebak.`
      : docMiss
        ? `\n\nGRUP INI MEMAKAI DOKUMEN TERTENTU SEBAGAI ACUAN, tetapi tidak ada bagian dokumen yang cocok dengan pertanyaan ini. Jawab singkat: "Informasi itu tidak ditemukan di dokumen acuan" dan sarankan menanyakan dengan kata kunci yang ada di dokumen. Jangan menjawab dari pengetahuan umum atau menebak isi dokumen.`
        : ""
    : "";
  const docNote = pinnedNote || (hasDocs
    ? `\n\nKONTEKS DOKUMEN di pesan terakhir berasal dari Dokumen Pengetahuan milik pemilik nomor ini (dokumen resmi/internal) -- itu sumber UTAMA untuk angka, tarif, dan aturan. Kalau dokumen memuat jawabannya, pakai angkanya apa adanya dan sebut judul dokumennya singkat. Hasil pencarian web (kalau ada) hanya pelengkap; kalau bertentangan dengan dokumen, utamakan dokumen dan sebut perbedaannya singkat. Kalau jawabannya tidak ada di dokumen maupun hasil web, katakan terus terang (untuk pertanyaan tentang isi dokumen: \"Informasi tidak ada di dokumen\") dan JANGAN menebak. Untuk daftar (rukun, syarat, langkah) tuliskan semua butir yang tertulis di dokumen, tidak menambah/mengurangi. Jangan mengutip dokumen panjang-panjang -- ambil bagian yang menjawab saja.`
    : "");
  const systemWithDate =
    `${systemText}\n\nWaktu sekarang: ${nowText} ${WA_TIMEZONE_LABEL}. Anggap ini tanggal hari ini. Jangan mengira tahun ini masih tahun sebelumnya, dan jangan bilang aturan/peraturan tahun ini "belum terbit" atau "akan terbit" kecuali hasil pencarian memastikannya.${docNote}`;
  // Dipakai HANYA kalau jalur dengan internet gagal & jatuh ke jalur tanpa
  // internet: tanpa ini model menjawab angka/aturan dari ingatan lamanya
  // dengan nada yakin (bisa salah/usang).
  const systemNoSearch =
    `${systemWithDate}\n\nCATATAN: untuk balasan ini akses pencarian internet SEDANG TIDAK TERSEDIA. Untuk peraturan, tarif, angka resmi, atau hal lain yang bisa sudah berubah, JANGAN menyebut angka/aturan dengan yakin dari ingatan (angka yang tertulis di KONTEKS DOKUMEN boleh dipakai) -- katakan terus terang kamu belum bisa memastikan versi terbarunya dan sarankan cek sumber resmi (mis. PMK/situs Kemenkeu).`;
  const systemWithWeb =
    `${systemWithDate}\n\nCATATAN: Google Search sedang tidak tersedia, jadi sistem mencarikan HASIL PENCARIAN WEB (judul + cuplikan, sebagian dengan baris "Sumber: URL") dan melampirkannya di pesan terakhir. Jadikan itu acuan utama untuk fakta/angka/aturan terbaru dan sebut sumbernya singkat (nama situs/judul) kalau relevan. Cuplikan sering terpotong: kalau belum cukup untuk memastikan angka atau aturan resmi, katakan terus terang dan sarankan cek sumber resmi. Boleh menyebut URL HANYA yang tertulis persis di baris "Sumber:"; jangan mengarang link/URL.`;
  // Payload jalur tanpa Google Search: dihitung malas & maksimal 1x per
  // panggilan (kalau rotasi key mengulang, Bing tidak dicari ulang).
  let noSearchPayload = null;
  const getNoSearchPayload = async () => {
    if (noSearchPayload) return noSearchPayload;
    noSearchPayload = { system: systemNoSearch, contents: withDocsContents };
    if (!webQuery) {
      console.log("🌐 [Web] dilewati (pesan terakhir tidak terlihat seperti pertanyaan yang butuh internet).");
    } else {
      const results = await webSearch.search(webQuery, GEMINI_WEB_MAX_RESULTS);
      console.log(`🌐 [Web] ${results.length} hasil web disisipkan ke prompt Gemini (query: "${webQuery.slice(0, 80)}")`);
      if (results.length > 0) {
        noSearchPayload = {
          system: systemWithWeb,
          contents: [
            ...contents.slice(0, -1),
            { role: "user", parts: [{ text: buildGroundedUserMessage(lastUserText, docChunks, results) }] }
          ]
        };
      }
    }
    return noSearchPayload;
  };
  const runGemini = async () => {
  for (;;) {
    const apiKey = pickAvailableGeminiKey();
    if (!apiKey) {
      if (GEMINI_API_KEYS.length > 0) notifyOwnerAllKeysExhausted().catch(() => {});
      const err = new Error(
        `Semua API key Gemini (${GEMINI_API_KEYS.length}) kena kuota harian, coba lagi setelah tengah malam (Pacific Time).`
      );
      err.allKeysExhausted = true;
      throw err;
    }
    try {
      let data;
      if (useSearch) {
        if (Date.now() < googleSearchBlockedUntil) {
          // Google Search lagi "diistirahatkan" (ditolak barusan) -- langsung
          // jalur tanpa tool + hasil Bing, tanpa buang 1 request percuma.
          const p = await getNoSearchPayload();
          data = await callGeminiWithRetry(p.system, p.contents, false, 2, apiKey);
        } else {
          try {
            data = await callGeminiWithRetry(systemWithDate, withDocsContents, true, 1, apiKey);
          } catch (err) {
            // Jatah HARIAN key ini habis: coba lagi tanpa internet di key yang sama
            // percuma, langsung rotasi. (429 jenis lain, mis. limit khusus jalur
            // Google Search, tetap lanjut ke percobaan tanpa tool di bawah.)
            if (err.status === 429 && /PerDay/i.test(err.message)) throw err;
            if (err.status === 429) {
              googleSearchBlockedUntil = Date.now() + GOOGLE_SEARCH_BLOCK_MS;
              console.warn(
                `Auto-reply WA: Google Search ditolak (${summarizeGeminiError(err.message)}) -- tool itu diistirahatkan ${GOOGLE_SEARCH_BLOCK_MS / 60_000} menit, pakai pencarian Bing.`
              );
            } else {
              console.warn(`Auto-reply WA: percobaan dgn Google Search gagal (${summarizeGeminiError(err.message)}), lanjut tanpa tool...`);
            }
            const p = await getNoSearchPayload();
            data = await callGeminiWithRetry(p.system, p.contents, false, 2, apiKey);
          }
        }
      } else {
        data = await callGeminiWithRetry(systemWithDate, withDocsContents, false, 2, apiKey);
      }
      reportKeyEvent(apiKey, { requestsInc: 1 });
      return data;
    } catch (err) {
      attemptsLeft -= 1;
      if (err.status === 429 && attemptsLeft > 0) {
        markGeminiKeyExhausted(apiKey, err);
        continue; // coba lagi dari awal pakai key berikutnya
      }
      if (err.status === 429) markGeminiKeyExhausted(apiKey, err); // key terakhir: tetap catat habis
      throw err; // bukan soal kuota (atau semua key sudah dicoba) -- lempar ke pemanggil spt biasa
    }
  }
  };

  // Gemini gagal total (semua key habis / 503 / jaringan) -> coba penyedia cadangan (Groq, OpenRouter) dengan
  // prompt TANPA Google Search (+ hasil Bing bila ada). Hasilnya dibungkus agar bentuknya sama dgn respons Gemini.
  if (!llmFallback.available()) return await runGemini();
  try {
    if (GEMINI_API_KEYS.length === 0) throw Object.assign(new Error("Tidak ada API key Gemini."), { allKeysExhausted: true });
    return await runGemini();
  } catch (geminiErr) {
    try {
      const p = await getNoSearchPayload();
      const messages = p.contents
        .map((c) => ({ role: c.role === "model" ? "assistant" : "user", content: c.parts?.map((x) => x.text ?? "").join("") ?? "" }))
        .filter((m) => m.content);
      const r = await llmFallback.generate({ system: p.system, messages, temperature: pinnedDocs ? 0.2 : 0.4 });
      console.log(`🛟 [Cadangan] dijawab ${r.provider}/${r.model} (Gemini gagal: ${String(geminiErr?.message || geminiErr).slice(0, 120)})`);
      return { candidates: [{ content: { parts: [{ text: r.text }] } }], usageMetadata: { totalTokenCount: 0 }, _provider: `${r.provider}/${r.model}` };
    } catch (fbErr) {
      console.error(`🛟 [Cadangan] juga gagal: ${fbErr instanceof Error ? fbErr.message : String(fbErr)}`);
      throw geminiErr; // pemanggil menangani error Gemini aslinya spt biasa (antrean ulang, dll)
    }
  }
}

// Minta Gemini bikinkan satu balasan buat obrolan WA tertentu, pakai
// AUTO_REPLY_HISTORY_LIMIT pesan terakhir di obrolan itu sebagai konteks
// (TANPA Dokumen Pengetahuan -- lihat catatan di atas). Return null kalau
// memang tidak ada apa-apa buat dibalas (riwayat kosong) -- selain itu throw
// error (ditangani pemanggil) kalau Gemini gagal total.
async function generateAutoReplyWithGemini(jid) {
  // PENTING: ascending + limit tanpa descending dulu bakal ambil N pesan
  // PALING LAMA (bukan paling baru!) begitu percakapan sudah lebih panjang
  // dari AUTO_REPLY_HISTORY_LIMIT -- jendela riwayatnya jadi "beku" di awal
  // percakapan & pesan yang baru masuk barusan malah tidak ikut terkirim ke
  // Gemini. Makanya di sini ambil TERBARU dulu (descending), baru dibalik
  // lagi jadi urutan kronologis (lama -> baru) buat dikirim ke Gemini.
  const { data: historyRowsDesc, error: historyErr } = await supabase
    .from("whatsapp_messages")
    .select("direction, content")
    .eq("wa_jid", jid)
    .order("created_at", { ascending: false })
    .limit(AUTO_REPLY_HISTORY_LIMIT);
  if (historyErr) throw new Error(`Gagal ambil riwayat: ${historyErr.message}`);

  const historyRows = (historyRowsDesc ?? []).slice().reverse();

  const contents = historyRows
    .filter((row) => row.content)
    .map((row) => ({
      role: row.direction === "in" ? "user" : "model",
      parts: [{ text: row.content }]
    }));

  // Pengaman tambahan: API Gemini menolak request yang giliran TERAKHIRnya
  // "model" (balasan AI) -- harus diakhiri giliran "user". Normalnya tidak
  // kejadian lagi setelah fix di atas (pesan yang baru masuk barusan sudah
  // pasti paling baru = di posisi terakhir = role "user"), tapi dibuang saja
  // kalau ada sisa giliran "model" nyangkut di ujung, drpd request ditolak
  // total & bot diam saja.
  while (contents.length > 0 && contents[contents.length - 1].role === "model") {
    contents.pop();
  }
  if (contents.length === 0) return null;

  const webQueryRaw = buildWebQuery(contents.filter((c) => c.role === "user").map((c) => stripGroupMeta(jid, c.parts?.[0]?.text ?? "")));
  // Di grup, obrolan santai ("Mas mau mie instan?") tidak perlu cari dokumen/web --
  // hanya dicari kalau pesannya jelas butuh data (lihat GROUP_LOOKUP_RE).
  const pinnedTitles = docTitlesFor(jid);
  // Grup dengan dokumen "dikunci" (WA_GROUP_DOC_TITLES): jawaban HANYA dari dokumen itu, tanpa internet.
  const webQuery = pinnedTitles ? "" : !isGroupJid(jid) || GROUP_LOOKUP_RE.test(webQueryRaw) ? webQueryRaw : "";
  // Dokumen: di grup selalu dicari (pencarian lokal, murah) kecuali WA_GROUP_DOCS=keywords.
  const docQuery = !isGroupJid(jid) || GROUP_DOCS_ALWAYS ? webQueryRaw : webQuery;
  // Dokumen Pengetahuan dicek untuk pertanyaan yang sama (bukan sapaan) --
  // hasilnya dibatasi budget, bukan baca seluruh dokumen. Gagal = lanjut tanpa.
  let docChunks = [];
  if (docQuery) {
    try {
      docChunks = await fetchKnowledgeChunksForGemini(docQuery, pinnedTitles);
    } catch (err) {
      console.error("RAG (Gemini): gagal cari di Dokumen Pengetahuan, lanjut tanpa:", err instanceof Error ? err.message : String(err));
    }
    const titles = docChunks.map((c) => `"${c.title}"(skor ${c.score.toFixed(1)})`).join(", ") || "-";
    console.log(`📚 [Dokumen] ${docChunks.length} potongan dipakai: ${titles}`);
  }
  const data = await geminiGenerateWithRotation(withGroupNote(WA_BASE_SYSTEM_PROMPT, jid), contents, {
    webQuery,
    docChunks,
    pinnedDocs: Boolean(pinnedTitles),
    docMiss: Boolean(pinnedTitles) && docChunks.length === 0 && Boolean(docQuery)
  });

  const rawText = extractGeminiText(data);
  if (!rawText.trim()) {
    const cand = data?.candidates?.[0];
    const partsInfo = (cand?.content?.parts ?? []).map((p) => Object.keys(p ?? {}).join("+")).join(", ");
    throw new Error(
      `Respons Gemini tidak berisi teks (finishReason=${cand?.finishReason ?? "?"}, blockReason=${data?.promptFeedback?.blockReason ?? "-"}, parts=[${partsInfo}])`
    );
  }

  const tokensUsed = data?.usageMetadata?.totalTokenCount ?? 0;
  const ESTIMATED_INPUT_SHARE = 0.7;
  const costUsd = tokensUsed > 0 ? estimateCostUsd(GEMINI_MODEL, tokensUsed * ESTIMATED_INPUT_SHARE, tokensUsed * (1 - ESTIMATED_INPUT_SHARE)) : 0;

  // Kutipan «…» / nomor halaman yang tidak ada di potongan dokumen yang dikirim diberi catatan peringatan.
  const guarded = docChunks.length > 0 ? guardDocAnswer(rawText.trim(), docChunks) : null;
  if (guarded?.flagged) console.log(`🛡️ [Dokumen] jawaban ditandai: kutipan tak terbukti=${guarded.badQuotes.length}, halaman tak ada=${guarded.badPages.length}`);
  return { reply: guarded ? guarded.reply : rawText.trim(), tokensUsed, costUsd };
}

// Catat token+biaya auto-reply ke tabel token_usage YANG SAMA dipakai fitur
// Obrolan AI (lihat action "send"/"token_usage" di Edge Function `chat`) --
// supaya angka "token terpakai hari ini" di footer aplikasi mencerminkan
// SEMUA pemakaian Gemini (Obrolan AI + auto-reply WA), bukan cuma salah
// satu. Kegagalan di sini sengaja tidak menggagalkan apa pun yang lain
// (pesannya sendiri sudah terlanjur terkirim duluan).
async function recordTokenUsage(tokensUsed, costUsd) {
  if (!tokensUsed || tokensUsed <= 0) return;
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    const { data: existing } = await supabase
      .from("token_usage")
      .select("total_tokens, total_cost_usd")
      .eq("usage_date", today)
      .maybeSingle();
    const totalTokens = (existing?.total_tokens ?? 0) + tokensUsed;
    const totalCost = Number(existing?.total_cost_usd ?? 0) + costUsd;
    await supabase.from("token_usage").upsert({
      usage_date: today,
      total_tokens: totalTokens,
      total_cost_usd: totalCost,
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("Gagal catat token_usage dari auto-reply:", err instanceof Error ? err.message : String(err));
  }
}

// Generate balasan AI buat jid ini & langsung kirim lewat WhatsApp (beda
// dari processPendingOutgoing: itu buat balasan MANUAL dari aplikasi yang
// antre dulu di status 'pending', ini langsung sinkron di tempat karena
// socket-nya (sock) sudah ada di tangan & tidak ada yang perlu diantre).
// Dipakai kalau generateAutoReply gagal total (mis. Gemini lagi kena
// rate-limit/429 di kedua percobaan) -- drpd bot DIAM SAJA (kelihatan kayak
// error/mati dari sisi kontak yang chat), minimal kasih tau pesannya
// kebaca & bakal ditindaklanjuti manual.
const AUTO_REPLY_FALLBACK_TEXT =
  "Maaf, sistem balasan otomatisnya lagi ada kendala teknis. Pesannya sudah diterima kok, nanti dibalas langsung ya 🙏";

// Dipakai waktu AI gagal DAN pesannya berhasil diantre buat dicoba lagi otomatis
// (lihat wa_retry_queue & processRetryQueue) -- janji "dibalas otomatis" itu
// BENAR karena bot memang akan mencoba lagi sendiri, bukan sekadar basa-basi.
const AUTO_REPLY_QUEUED_TEXT =
  "Maaf, sistem balasan otomatisnya lagi penuh/ada kendala sementara. Pesannya sudah diterima dan akan dibalas otomatis begitu sistemnya siap lagi ya 🙏";

// ---------------- Template jawaban (tabel wa_quick_replies) ----------------
// Pesan masuk yang cocok dgn kata kunci sebuah template dijawab LANGSUNG dari
// template itu -- AI tidak dipanggil sama sekali (hemat kuota, lebih cepat,
// jawabannya konsisten). Template dikelola dari aplikasi (Pengaturan >
// Template Jawaban WA).
let quickReplyCache = { at: 0, rows: [] };
let quickReplyLoadWarned = false;

async function loadQuickReplies() {
  if (Date.now() - quickReplyCache.at < 60_000) return quickReplyCache.rows;
  const { data, error } = await supabase
    .from("wa_quick_replies")
    .select("id, title, keywords, reply, use_count")
    .eq("enabled", true);
  if (error) {
    if (!quickReplyLoadWarned) {
      quickReplyLoadWarned = true;
      console.warn(`Gagal baca template jawaban (sudah jalankan migration 0013?): ${error.message}`);
    }
    quickReplyCache = { at: Date.now(), rows: [] };
    return [];
  }
  quickReplyCache = { at: Date.now(), rows: data ?? [] };
  return quickReplyCache.rows;
}

// Huruf kecil, tanda baca jadi spasi, spasi dirapikan, lalu DIAPIT spasi di
// kedua ujung -- supaya mencocokkan " jam buka " ke dalam teks pesan otomatis
// berarti cocok sebagai kata/frasa UTUH (bukan potongan kata lain).
function normalizeForMatch(text) {
  const cleaned = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? ` ${cleaned} ` : "";
}

// Cari template yang kata kuncinya cocok dgn teks pesan. Kalau beberapa
// template cocok sekaligus, menang yang kata kunci cocoknya PALING PANJANG
// (paling spesifik). Pesan panjang (> QUICK_REPLY_MAX_WORDS kata) & placeholder
// media seperti "[gambar] ..." tidak pernah memicu template.
function findQuickReply(text, rows) {
  if (!text || text.startsWith("[")) return null;
  const normalized = normalizeForMatch(text);
  if (!normalized) return null;
  if (normalized.trim().split(" ").length > QUICK_REPLY_MAX_WORDS) return null;

  let best = null;
  let bestLen = 0;
  for (const row of rows) {
    for (const kw of row.keywords ?? []) {
      const nk = normalizeForMatch(kw);
      if (!nk) continue;
      if (normalized.includes(nk) && nk.length > bestLen) {
        best = row;
        bestLen = nk.length;
      }
    }
  }
  return best;
}

async function sendQuickReply(sock, jid, template) {
  const sent = await sock.sendMessage(jid, { text: template.reply });
  await supabase.from("whatsapp_messages").insert({
    wa_jid: jid,
    direction: "out",
    content: template.reply,
    status: "sent",
    wa_message_id: sent?.key?.id ?? null
  });
  template.use_count = (template.use_count || 0) + 1;
  supabase
    .from("wa_quick_replies")
    .update({ use_count: template.use_count, last_used_at: new Date().toISOString() })
    .eq("id", template.id)
    .then(
      () => {},
      () => {}
    );
  console.log(`⚡ Template "${template.title}" dipakai utk ${jid} (tanpa AI).`);
}

// ---------------- Antrean retry (tabel wa_retry_queue) ----------------
// Dipanggil waktu AI gagal membalas. Return "queued" (baru diantre),
// "already" (kontak ini sudah punya antrean aktif -- tidak perlu kirim teks
// permintaan maaf lagi), atau "unavailable" (tabel belum ada/error -- tetap
// kirim teks permintaan maaf biasa).
async function enqueueRetry(jid, errorMessage) {
  const { error } = await supabase.from("wa_retry_queue").insert({ wa_jid: jid, last_error: String(errorMessage).slice(0, 300) });
  if (!error) return "queued";
  if (error.code === "23505") return "already";
  console.warn(`Gagal antre retry utk ${jid} (sudah jalankan migration 0013?): ${error.message}`);
  return "unavailable";
}

async function finishRetry(id, status, extra = {}) {
  await supabase
    .from("wa_retry_queue")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

let retryProcessing = false;
async function processRetryQueue(sock) {
  if (!sock || retryProcessing || !AUTO_REPLY_ACTIVE) return;
  retryProcessing = true;
  try {
    const { data, error } = await supabase
      .from("wa_retry_queue")
      .select("id, wa_jid, attempts, created_at")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(3);
    if (error || !data || data.length === 0) return;

    for (const row of data) {
      const ageHours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
      if (ageHours > RETRY_EXPIRE_HOURS) {
        await finishRetry(row.id, "expired");
        continue;
      }
      // Mesin Gemini: nunggu sampai ADA key yang tersedia lagi (kalau semua
      // masih habis, berhenti di sini & coba lagi menit depan -- tanpa
      // menambah hitungan percobaan).
      if (WA_AI_ENGINE === "gemini" && pickAvailableGeminiKey() === null) break;

      if (!(await isAutoReplyEnabledForContact(row.wa_jid))) {
        await finishRetry(row.id, "skipped");
        continue;
      }
      // Kamu sudah membalas manual -> balasan susulan dari AI tidak perlu.
      if (aiPauseRemainingMs(jidUserKeys(row.wa_jid)) > 0) {
        await finishRetry(row.id, "skipped");
        continue;
      }
      // Sudah ada balasan lain (mis. kamu balas manual dari aplikasi/HP) sejak
      // antrean dibuat? Kalau ya, tidak perlu balasan otomatis susulan.
      const { data: later } = await supabase
        .from("whatsapp_messages")
        .select("content")
        .eq("wa_jid", row.wa_jid)
        .eq("direction", "out")
        .gt("created_at", row.created_at)
        .limit(10);
      const alreadyHandled = (later ?? []).some(
        (m) => m.content !== AUTO_REPLY_FALLBACK_TEXT && m.content !== AUTO_REPLY_QUEUED_TEXT
      );
      if (alreadyHandled) {
        await finishRetry(row.id, "skipped");
        continue;
      }

      sock.sendPresenceUpdate("composing", row.wa_jid).catch(() => {});
      try {
        const result = await generateAutoReply(row.wa_jid);
        sock.sendPresenceUpdate("paused", row.wa_jid).catch(() => {});
        if (!result || !result.reply) {
          await finishRetry(row.id, "skipped");
          continue;
        }
        await deliverAutoReplyText(sock, row.wa_jid, result, "🔁 Balasan ulang");
        await finishRetry(row.id, "done");
      } catch (err) {
        sock.sendPresenceUpdate("paused", row.wa_jid).catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        const attempts = row.attempts + 1;
        console.error(`Retry auto-reply utk ${row.wa_jid} gagal (percobaan ${attempts}/${RETRY_MAX_ATTEMPTS}): ${msg}`);
        if (attempts >= RETRY_MAX_ATTEMPTS) {
          await finishRetry(row.id, "expired", { attempts, last_error: msg.slice(0, 300) });
        } else {
          const delayMin = Math.min(5 * 2 ** (attempts - 1), 60);
          await supabase
            .from("wa_retry_queue")
            .update({
              attempts,
              last_error: msg.slice(0, 300),
              next_attempt_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", row.id);
        }
      }
    }
  } catch (err) {
    console.error("Loop retry auto-reply error:", err instanceof Error ? err.message : String(err));
  } finally {
    retryProcessing = false;
  }
}

// Kirim teks balasan AI ke kontak + catat ke whatsapp_messages + catat token.
// Dipakai balasan normal (sendAutoReply) DAN balasan ulang dari antrean.
async function deliverAutoReplyText(sock, jid, result, logLabel = "🤖 Auto-reply", { quoted = null, waName = null } = {}) {
  try {
    const sent = await sock.sendMessage(jid, { text: result.reply }, quoted ? { quoted } : undefined);
    await supabase.from("whatsapp_messages").insert({
      wa_jid: jid,
      wa_name: waName,
      direction: "out",
      content: result.reply,
      status: "sent",
      wa_message_id: sent?.key?.id ?? null
    });
    console.log(`${logLabel} ke ${jid}: ${result.reply.slice(0, 60)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Gagal kirim auto-reply ke ${jid}:`, msg);
    await supabase.from("whatsapp_messages").insert({
      wa_jid: jid,
      direction: "out",
      content: result.reply,
      status: "failed",
      error: msg
    });
  }
  await recordTokenUsage(result.tokensUsed, result.costUsd);
}

// Pesan yang jawabannya harus AKURAT (angka, tarif, aturan, uang) -- JANGAN
// dijawab model lokal 3B yang mudah mengarang; biarkan diantre buat Gemini.
const NEEDS_ACCURATE_FIGURES_RE =
  /\d|\b(tarif|biaya|harga|berapa|nominal|rp|rupiah|persen|pmk|sbm|sbk|uu|perpres|peraturan|aturan|honor|honorarium|gaji|tunjangan|pajak|denda|sanksi|batas|plafon|pagu|anggaran)\b|%/i;

// Return { reply, tokensUsed: 0, costUsd: 0 } kalau cadangan lokal berhasil
// menjawab, atau null (lanjut ke jalur antrean seperti biasa).
async function tryLocalFallbackReply(sock, jid, incomingText, err) {
  if (!WA_OLLAMA_FALLBACK_ENABLED || WA_AI_ENGINE === "ollama") return null;
  // Hanya untuk kegagalan KUOTA/kepadatan (semua key habis, 429, 503) -- bukan
  // error lain (mis. respons kosong) yang tidak ada hubungannya dgn kuota.
  const quotaLike = err?.allKeysExhausted === true || err?.status === 429 || err?.status === 503;
  if (!quotaLike) return null;
  if (!incomingText || incomingText.startsWith("[") || NEEDS_ACCURATE_FIGURES_RE.test(incomingText)) return null;
  if (ollamaQueue.pending > 0) {
    console.log("🦙 Cadangan lokal dilewati: Ollama lagi sibuk.");
    return null;
  }
  // Kontak yang sudah punya antrean aktif tidak dijawab dobel.
  const { data: pending } = await supabase.from("wa_retry_queue").select("id").eq("wa_jid", jid).eq("status", "pending").limit(1);
  if (pending && pending.length > 0) return null;
  try {
    sock.sendPresenceUpdate("composing", jid).catch(() => {});
    const local = await generateAutoReplyWithOllama(jid, { timeoutMs: WA_OLLAMA_FALLBACK_TIMEOUT_MS });
    sock.sendPresenceUpdate("paused", jid).catch(() => {});
    return local && local.reply ? local : null;
  } catch (fbErr) {
    sock.sendPresenceUpdate("paused", jid).catch(() => {});
    console.error(`Cadangan lokal (Ollama) gagal utk ${jid}, lanjut ke antrean:`, fbErr instanceof Error ? fbErr.message : String(fbErr));
    return null;
  }
}

async function sendAutoReply(sock, jid, incomingText) {
  // 1) Template jawaban dulu -- kalau cocok, AI tidak dipanggil sama sekali.
  try {
    const template = findQuickReply(incomingText, await loadQuickReplies());
    if (template) {
      await sendQuickReply(sock, jid, template);
      return;
    }
  } catch (err) {
    console.error(`Template jawaban gagal utk ${jid}, lanjut ke AI:`, err instanceof Error ? err.message : String(err));
  }

  // Indikator "mengetik..." di WA -- murni kosmetik, tapi berguna terutama
  // buat mesin "ollama": inferensi CPU-only di laptop tua bisa makan waktu
  // puluhan detik (apalagi dgn konteks RAG+web search), drpd kontak nunggu
  // diam tanpa tanda apa-apa. Dibungkus try/catch & SENGAJA tidak menunggu
  // (tidak di-await secara blocking lewat Promise.all) -- gagal kirim
  // presence bukan alasan buat gagalkan auto-reply itu sendiri.
  sock.sendPresenceUpdate("composing", jid).catch(() => {});

  let result;
  try {
    result = await generateAutoReply(jid);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Gagal generate auto-reply utk ${jid}:`, errMsg);
    sock.sendPresenceUpdate("paused", jid).catch(() => {});
    if (aiPauseRemainingMs(jidUserKeys(jid)) > 0) return; // kamu keburu membalas manual

    // Cadangan lokal: Gemini gagal karena KUOTA & pertanyaannya bukan soal
    // angka/aturan -> coba jawab pakai Ollama (gratis, tanpa kuota) dulu.
    const localResult = await tryLocalFallbackReply(sock, jid, incomingText, err);
    if (localResult) {
      await deliverAutoReplyText(sock, jid, localResult, "🦙 Auto-reply (cadangan lokal)");
      return;
    }

    // Antre buat dicoba lagi otomatis nanti (lihat processRetryQueue). Kalau
    // kontak ini SUDAH punya antrean aktif, permintaan maaf tidak dikirim
    // lagi (supaya tidak spam tiap kali dia kirim pesan susulan).
    const queued = await enqueueRetry(jid, errMsg);
    if (queued === "already") return;
    const fallbackText = queued === "queued" ? AUTO_REPLY_QUEUED_TEXT : AUTO_REPLY_FALLBACK_TEXT;
    try {
      const sent = await sock.sendMessage(jid, { text: fallbackText });
      await supabase.from("whatsapp_messages").insert({
        wa_jid: jid,
        direction: "out",
        content: fallbackText,
        status: "sent",
        wa_message_id: sent?.key?.id ?? null
      });
    } catch (sendErr) {
      console.error(`Gagal kirim balasan cadangan ke ${jid}:`, sendErr instanceof Error ? sendErr.message : String(sendErr));
    }
    return;
  }
  sock.sendPresenceUpdate("paused", jid).catch(() => {});
  if (!result || !result.reply) return;
  // Kamu keburu membalas manual selagi AI menyusun jawaban -> jawaban AI dibuang.
  if (aiPauseRemainingMs(jidUserKeys(jid)) > 0) {
    console.log(`⏸️ Jawaban AI utk ${jid} dibuang: kamu sudah membalas manual.`);
    return;
  }

  await deliverAutoReplyText(sock, jid, result);
}

// ---------------- Ringkasan percakapan harian ke nomor pemilik ----------------
// Tiap hari setelah jam WA_DAILY_SUMMARY_HOUR (zona WA_TIMEZONE), bot merangkum
// SEMUA percakapan WA hari itu pakai Gemini lalu mengirimnya ke OWNER_JID.
// Sekali per hari (dicatat di bot_state, aman walau bot di-restart).
function zonedParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(ms));
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return {
    dateStr: `${o.year}-${o.month}-${o.day}`,
    year: Number(o.year),
    month: Number(o.month),
    day: Number(o.day),
    hour: Number(o.hour),
    minute: Number(o.minute),
    second: Number(o.second)
  };
}

// Jam 00:00 tanggal dateStr (YYYY-MM-DD) di zona timeZone, dalam ms UTC.
function zonedStartOfDayUtcMs(dateStr, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guessUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const p = zonedParts(guessUtc, timeZone);
  const asLocalUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return guessUtc - (asLocalUtc - guessUtc);
}

function describeJidForSummary(jid, name) {
  if (name) return name;
  const userPart = jid.split("@")[0];
  if (jid.endsWith("@s.whatsapp.net")) return `+${userPart}`;
  return `Kontak (ID …${userPart.slice(-4)})`;
}

const SUMMARY_SYSTEM_PROMPT = `Kamu asisten pribadi pemilik nomor WhatsApp ini. Tugasmu merangkum percakapan WhatsApp HARI INI antara kontak-kontak dan nomor ini. Baris bertanda "Balasan" dikirim oleh nomor ini (otomatis oleh bot AI/template, atau manual oleh pemilik).
Tulis dalam Bahasa Indonesia dengan format teks WhatsApp: *tebal* pakai SATU bintang, boleh bullet "•", TANPA heading markdown (#) dan TANPA tabel.
Struktur jawaban:
1) Satu-dua kalimat gambaran umum hari ini.
2) Per kontak (sebut namanya): 1-2 kalimat inti yang ditanyakan/dibicarakan dan apakah sudah terjawab.
3) Penutup "*Perlu ditindaklanjuti:*" berisi daftar singkat hal yang butuh keputusan/jawaban manual dari pemilik (permintaan mendesak, negosiasi, hal pribadi/emosional, pertanyaan yang belum terjawab bot). Kalau tidak ada, tulis "Tidak ada".
Aturan: JANGAN mengarang fakta, angka, atau janji yang tidak ada di percakapan. Maksimal sekitar 250 kata.`;

// Batas panjang transkrip utk Ollama (karakter): ±7000 karakter Indonesia =
// ±2000 token, + prompt sistem ±300 + jawaban hingga 700 token = masih muat di
// jendela 4096 token.
const OLLAMA_SUMMARY_MAX_CHARS = 7000;
const OLLAMA_SUMMARY_MAX_TOKENS = 700;

async function summarizeWithOllama(transcript) {
  return enqueueOllamaCall(
    () =>
    callOllamaChat(
      [
        { role: "system", content: `${SUMMARY_SYSTEM_PROMPT}\n\n${currentDateLine()}` },
        { role: "user", content: transcript }
      ],
      {
        timeoutMs: WA_SUMMARY_OLLAMA_TIMEOUT_MS,
        maxTokens: OLLAMA_SUMMARY_MAX_TOKENS,
        numCtx: Math.max(OLLAMA_NUM_CTX, 4096)
      }
    ),
    { priority: PRIORITY.BACKGROUND, label: "daily-summary" }
  );
}

async function buildDailySummaryText(dateStr, { allowAi = true } = {}) {
  const startMs = zonedStartOfDayUtcMs(dateStr, WA_TIMEZONE);
  const { data: rows, error } = await supabase
    .from("whatsapp_messages")
    .select("wa_jid, wa_name, direction, content, status, created_at")
    .gte("created_at", new Date(startMs).toISOString())
    .order("created_at", { ascending: true })
    .limit(1500);
  if (error) throw new Error(`Gagal ambil pesan hari ini: ${error.message}`);

  const skipJids = new Set([OWNER_JID, ...(currentSock ? getOwnJids(currentSock) : [])].filter(Boolean));
  const byJid = new Map();
  for (const row of rows ?? []) {
    if (skipJids.has(row.wa_jid) || !row.content) continue;
    if (!byJid.has(row.wa_jid)) byJid.set(row.wa_jid, { name: null, messages: [] });
    const entry = byJid.get(row.wa_jid);
    if (row.wa_name && !entry.name) entry.name = row.wa_name;
    entry.messages.push(row);
  }

  const dateLabel = new Intl.DateTimeFormat("id-ID", {
    timeZone: WA_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
  const header = `📋 *Ringkasan WhatsApp — ${dateLabel}*`;

  let pendingLine = "";
  const { count: pendingCount, error: pendingErr } = await supabase
    .from("wa_retry_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (!pendingErr && pendingCount > 0) pendingLine = `\n\n⏳ ${pendingCount} pesan masih menunggu balasan otomatis ulang.`;

  if (byJid.size === 0) return `${header}\n\nTidak ada percakapan WhatsApp hari ini.${pendingLine}`;

  let incoming = 0;
  let outgoing = 0;
  for (const { messages } of byJid.values()) {
    for (const m of messages) {
      if (m.direction === "in") incoming += 1;
      else if (m.status === "sent") outgoing += 1;
    }
  }
  const statsLine = `${byJid.size} kontak • ${incoming} pesan masuk • ${outgoing} balasan terkirim`;

  const buildTranscript = (perContactLimit) =>
    [...byJid.entries()]
      .map(([jid, { name, messages }]) => {
        const lines = messages
          .slice(-perContactLimit)
          .map((m) => `${m.direction === "in" ? "Kontak" : "Balasan"}: ${m.content.replace(/\s+/g, " ").slice(0, 280)}`);
        return `=== ${describeJidForSummary(jid, name)} (${messages.length} pesan) ===\n${lines.join("\n")}`;
      })
      .join("\n\n");

  // Potong transkrip sampai muat `maxChars` (kurangi jumlah pesan per kontak,
  // terakhir baru dipotong paksa).
  const fitTranscript = (maxChars) => {
    let limit = 25;
    let t = buildTranscript(limit);
    while (t.length > maxChars && limit > 2) {
      limit = Math.floor(limit / 2);
      t = buildTranscript(limit);
    }
    return t.length > maxChars ? `${t.slice(0, maxChars)}\n[...dipotong...]` : t;
  };

  if (allowAi) {
    // 1) Ollama (lokal) dulu kalau WA_SUMMARY_ENGINE=ollama: isi percakapan
    //    tidak keluar laptop & tidak makan kuota Gemini. Anggaran teks kecil
    //    krn jendela konteks Ollama cuma OLLAMA_NUM_CTX (4096 token) &
    //    jawabannya pun dibatasi -- prompt + transkrip + jawaban harus muat.
    if (WA_SUMMARY_ENGINE === "ollama") {
      try {
        const localText = (await summarizeWithOllama(fitTranscript(OLLAMA_SUMMARY_MAX_CHARS))).trim();
        if (!localText) throw new Error("Respons Ollama untuk ringkasan kosong.");
        console.log("📋 Ringkasan harian dibuat model lokal (Ollama).");
        return `${header}\n${statsLine}\n\n${localText}\n\n_(Dirangkum model lokal di laptop -- hal penting, cek langsung ya.)_${pendingLine}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Ringkasan lokal (Ollama) gagal: ${msg}`);
        if (!WA_SUMMARY_GEMINI_FALLBACK || (GEMINI_API_KEYS.length === 0 && !llmFallback.available())) throw err;
        console.log("📋 Ringkasan harian: jatuh ke Gemini (WA_SUMMARY_GEMINI_FALLBACK=true).");
      }
    }

    // 2) Gemini (mesin utama kalau WA_SUMMARY_ENGINE=gemini, atau cadangan).
    if (GEMINI_API_KEYS.length > 0 || llmFallback.available()) {
      const data = await geminiGenerateWithRotation(
        SUMMARY_SYSTEM_PROMPT,
        [{ role: "user", parts: [{ text: fitTranscript(14000) }] }],
        { useSearch: false }
      );
      const aiText = extractGeminiText(data).trim();
      if (!aiText) throw new Error("Respons Gemini untuk ringkasan kosong.");
      const tokensUsed = data?.usageMetadata?.totalTokenCount ?? 0;
      if (tokensUsed > 0) {
        await recordTokenUsage(
          tokensUsed,
          estimateCostUsd(GEMINI_MODEL, tokensUsed * 0.7, tokensUsed * 0.3)
        );
      }
      return `${header}\n${statsLine}\n\n${aiText}${pendingLine}`;
    }
  }

  // Cadangan tanpa AI (belum ada API key / semua habis / AI gagal berkali2):
  // daftar sederhana per kontak, supaya ringkasan harian tetap sampai.
  const plain = [...byJid.entries()]
    .map(([jid, { name, messages }]) => {
      const lastIn = [...messages].reverse().find((m) => m.direction === "in");
      const inCount = messages.filter((m) => m.direction === "in").length;
      return `• *${describeJidForSummary(jid, name)}* — ${inCount} pesan masuk${lastIn ? `, terakhir: "${lastIn.content.replace(/\s+/g, " ").slice(0, 100)}"` : ""}`;
    })
    .join("\n");
  return `${header}\n${statsLine}\n\n${plain}\n\n_(Ringkasan AI sedang tidak tersedia, ini daftar sederhana.)_${pendingLine}`;
}

let summarySentDate = null;
let summaryRunning = false;
let summaryLastAttemptMs = 0;
let summaryFailures = { date: null, count: 0 };

async function checkDailySummary() {
  if (!WA_DAILY_SUMMARY_ENABLED || !currentSock || summaryRunning) return;
  const local = zonedParts(Date.now(), WA_TIMEZONE);
  if (local.hour < WA_DAILY_SUMMARY_HOUR) return;
  if (summarySentDate === local.dateStr) return;
  if (Date.now() - summaryLastAttemptMs < 10 * 60_000) return;

  summaryRunning = true;
  try {
    const { data: state } = await supabase.from("bot_state").select("value").eq("key", "daily_summary_date").maybeSingle();
    if (state?.value === local.dateStr) {
      summarySentDate = local.dateStr;
      return;
    }

    summaryLastAttemptMs = Date.now();
    if (summaryFailures.date !== local.dateStr) summaryFailures = { date: local.dateStr, count: 0 };

    let text;
    try {
      // Setelah 3 kali gagal di hari yang sama (mis. semua key habis), kirim
      // versi sederhana tanpa AI daripada ringkasannya tidak sampai sama sekali.
      text = await buildDailySummaryText(local.dateStr, { allowAi: summaryFailures.count < 3 });
    } catch (err) {
      summaryFailures.count += 1;
      throw err;
    }

    await currentSock.sendMessage(OWNER_JID, { text });
    await supabase.from("bot_state").upsert({ key: "daily_summary_date", value: local.dateStr, updated_at: new Date().toISOString() });
    summarySentDate = local.dateStr;
    console.log("📋 Ringkasan harian terkirim ke nomor pemilik.");
  } catch (err) {
    console.error("Gagal kirim ringkasan harian (dicoba lagi 10 menit lagi):", err instanceof Error ? err.message : String(err));
  } finally {
    summaryRunning = false;
  }
}

// Kirim ringkasan SEKARANG (buat tes / minta manual). Beda dgn jadwal harian:
// tidak mengecek jam, tidak menandai "sudah terkirim hari ini" (jadi ringkasan
// terjadwal malamnya tetap jalan normal). Dipicu lewat file bendera
// (wa-bot/kirim-ringkasan.flag) atau pesan "/ringkasan" dari nomor pemilik.
async function sendSummaryNow(source) {
  if (!OWNER_JID) {
    console.error("📋 [Tes ringkasan] WA_OWNER_NUMBER belum diisi di .env, tidak ada tujuan kirim.");
    return;
  }
  if (!currentSock) {
    console.error("📋 [Tes ringkasan] WhatsApp belum tersambung, coba lagi sebentar.");
    return;
  }
  if (summaryRunning) {
    console.log("📋 [Tes ringkasan] masih ada proses ringkasan lain yang berjalan, dilewati.");
    return;
  }
  summaryRunning = true;
  const startedAt = Date.now();
  try {
    console.log(`📋 [Tes ringkasan] dipicu lewat ${source}, mesin: ${WA_SUMMARY_ENGINE}. Mulai membuat...`);
    await currentSock
      .sendMessage(OWNER_JID, {
        text: `⏳ Membuat ringkasan hari ini (mesin: ${WA_SUMMARY_ENGINE === "ollama" ? "model lokal, bisa beberapa menit" : "Gemini"})...`
      })
      .catch(() => {});
    const local = zonedParts(Date.now(), WA_TIMEZONE);
    const text = await buildDailySummaryText(local.dateStr, { allowAi: true });
    await currentSock.sendMessage(OWNER_JID, { text });
    console.log(`📋 [Tes ringkasan] terkirim ke nomor pemilik (${Math.round((Date.now() - startedAt) / 1000)} detik).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`📋 [Tes ringkasan] gagal: ${msg}`);
    await currentSock?.sendMessage(OWNER_JID, { text: `⚠️ Ringkasan gagal dibuat: ${msg.slice(0, 300)}` }).catch(() => {});
  } finally {
    summaryRunning = false;
  }
}

const SUMMARY_FLAG_FILE = fileURLToPath(new URL("./kirim-ringkasan.flag", import.meta.url));
async function checkSummaryFlagFile() {
  if (!fs.existsSync(SUMMARY_FLAG_FILE)) return;
  if (!currentSock || summaryRunning) return; // biarkan bendera, coba lagi nanti
  try {
    fs.unlinkSync(SUMMARY_FLAG_FILE);
  } catch {
    return;
  }
  await sendSummaryNow("file bendera");
}

// Dipakai loop pengirim (setInterval di bawah) -- selalu nunjuk ke socket
// WhatsApp yang LAGI AKTIF, diupdate ulang tiap kali connect()/reconnect
// bikin socket baru (lihat connection.update di bawah).
let currentSock = null;
let waOpen = false; // koneksi WhatsApp benar-benar terbuka (untuk halaman Status sistem)

// Ambil teks dari berbagai tipe pesan WhatsApp yang umum. Tipe yang tidak
// dikenali (voice note, lokasi, kontak dibagikan, dll) sengaja DILEWATI
// (return null) drpd nyimpen data kosong/rusak -- cukup buat v1 fitur ini.
function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[gambar] ${m.imageMessage.caption}`;
  if (m.videoMessage?.caption) return `[video] ${m.videoMessage.caption}`;
  if (m.documentMessage?.fileName) return `[dokumen] ${m.documentMessage.fileName}`;
  if (m.audioMessage) return "[pesan suara/audio -- belum didukung, buka HP buat dengar]";
  if (m.stickerMessage) return "[stiker]";
  return null;
}

// Normalisasi 1 JID mentah: buang akhiran ":N" (device id, mis.
// "6285xxxx:6@s.whatsapp.net" -> "6285xxxx@s.whatsapp.net") supaya bisa
// dibandingkan APA ADANYA dengan msg.key.remoteJid.
function normalizeJidSuffix(raw) {
  if (!raw) return null;
  const [userPart, domainPart] = raw.split("@");
  if (!domainPart) return null;
  return `${userPart.split(":")[0]}@${domainPart}`;
}

// Semua JID yang mewakili KITA SENDIRI (pemilik bot) -- ternyata BUKAN cuma
// satu. Baileys/WhatsApp kasih 2 identitas: sock.user.id (format nomor HP,
// "@s.whatsapp.net") DAN sock.user.lid (format "Local ID" privasi,
// "@lid") -- "chat ke diri sendiri" (catatan pribadi) ternyata muncul
// pakai jid ber-AKHIRAN @lid ini, BUKAN format nomor HP seperti dugaan
// awal (ketauan dari log debug: jid="<angka>@lid" sementara sock.user.id
// cuma kasih tau versi "@s.whatsapp.net"-nya) -- makanya HARUS dicek
// terhadap keduanya, persis pola yang sama dengan kenapa kontak lain juga
// bisa muncul dengan jid @lid (lihat komentar panjang di handleIncoming
// soal itu).
function getOwnJids(sock) {
  const me = sock.user;
  if (!me) return [];
  return [normalizeJidSuffix(me.id), normalizeJidSuffix(me.lid)].filter(Boolean);
}

// ---------------- Jeda auto-reply saat pemilik membalas MANUAL ----------------
// Kalau kamu membalas sebuah chat sendiri (dari HP, atau dari layar obrolan WA di
// aplikasi), bot berhenti membalas OTOMATIS di chat itu selama WA_MANUAL_PAUSE_MINUTES
// (default 60 menit, dihitung dari balasan manual TERAKHIR). Chat dengan nomor lain
// tidak terpengaruh. Ketik "AI On" di chat itu (atau "AI On" di chat-ke-diri-sendiri
// untuk semua chat) supaya bot aktif lagi seketika. Status jeda disimpan di
// ai-pause.json supaya selamat dari restart bot. 0 = fitur ini dimatikan.
const MANUAL_PAUSE_MINUTES = Number.isFinite(Number(process.env.WA_MANUAL_PAUSE_MINUTES))
  ? Math.max(0, Number(process.env.WA_MANUAL_PAUSE_MINUTES))
  : 60;
const MANUAL_PAUSE_MS = MANUAL_PAUSE_MINUTES * 60_000;
const AI_ON_DELETE_COMMAND = (process.env.WA_AI_ON_DELETE_COMMAND || "false").toLowerCase() === "true";
const AI_PAUSE_FILE = fileURLToPath(new URL("./ai-pause.json", import.meta.url));
const AI_ON_RE = /^\s*ai\s*on\s*[.!]*\s*$/i;
const AI_STATUS_RE = /^\s*ai\s*status\s*[?.!]*\s*$/i;

// kunci = bagian "user" JID (nomor HP ATAU id @lid, tanpa @domain/:device) -> waktu jeda berakhir (ms).
// Satu kontak bisa muncul sbg dua id (nomor & @lid), jadi dua-duanya disimpan.
const aiPausedUntil = new Map();
const contactNames = new Map(); // kunci -> nama tampilan terakhir (utk pesan konfirmasi)
const botSentIds = new Map(); // id pesan yang DIKIRIM BOT -> waktu (ms), supaya tidak dikira balasan manual

// kunci -> semua kunci lain yang diketahui milik kontak yang sama (nomor <-> @lid).
// Diisi tiap kali ada JID + remoteJidAlt bersamaan, sehingga perintah dari aplikasi
// (yang cuma tahu satu JID) tetap menjangkau kunci jeda yang satunya.
const jidAliases = new Map();

function jidUserKeys(...jids) {
  const base = [...new Set(jids.filter(Boolean).map((j) => String(j).split("@")[0].split(":")[0]).filter(Boolean))];
  if (base.length > 1) {
    for (const a of base) {
      let set = jidAliases.get(a);
      if (!set) jidAliases.set(a, (set = new Set()));
      for (const b of base) set.add(b);
    }
  }
  const out = new Set(base);
  for (const k of base) for (const x of jidAliases.get(k) ?? []) out.add(x);
  return [...out];
}

function loadAiPause() {
  try {
    const raw = JSON.parse(fs.readFileSync(AI_PAUSE_FILE, "utf8"));
    for (const [k, v] of Object.entries(raw || {})) {
      if (Number(v) > Date.now()) aiPausedUntil.set(k, Number(v));
    }
  } catch {
    /* belum ada file / rusak -> mulai kosong */
  }
}

function saveAiPause() {
  try {
    fs.writeFileSync(AI_PAUSE_FILE, JSON.stringify(Object.fromEntries(aiPausedUntil)));
  } catch (err) {
    console.warn("Gagal simpan ai-pause.json:", err instanceof Error ? err.message : String(err));
  }
}

function pauseAiFor(keys) {
  if (MANUAL_PAUSE_MS <= 0 || keys.length === 0) return 0;
  const until = Date.now() + MANUAL_PAUSE_MS;
  for (const k of keys) aiPausedUntil.set(k, until);
  saveAiPause();
  return until;
}

// Sisa waktu jeda (ms) untuk salah satu kunci; 0 = tidak dijeda.
function aiPauseRemainingMs(keys) {
  let best = 0;
  let expiredAny = false;
  for (const k of keys) {
    const until = aiPausedUntil.get(k);
    if (!until) continue;
    if (until <= Date.now()) {
      aiPausedUntil.delete(k);
      expiredAny = true;
    } else {
      best = Math.max(best, until - Date.now());
    }
  }
  if (expiredAny) saveAiPause();
  return best;
}

function resumeAiFor(keys) {
  let had = false;
  for (const k of keys) had = aiPausedUntil.delete(k) || had;
  if (had) saveAiPause();
  return had;
}

function rememberBotSent(id) {
  if (!id) return;
  botSentIds.set(id, Date.now());
  if (botSentIds.size > 500) {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, t] of botSentIds) if (t < cutoff) botSentIds.delete(k);
  }
}

// Pesan dari kita yang "sungguhan" (teks/media/stiker/dll), BUKAN reaksi, hapus-pesan, dsb.
function isRealOutgoingContent(message) {
  const m = unwrapMessageContent(message);
  if (!m) return false;
  return [
    "conversation",
    "extendedTextMessage",
    "imageMessage",
    "videoMessage",
    "documentMessage",
    "audioMessage",
    "stickerMessage",
    "contactMessage",
    "locationMessage",
    "pollCreationMessage"
  ].some((k) => m[k]);
}

function describeContact(keys) {
  for (const k of keys) if (contactNames.has(k)) return `${contactNames.get(k)} (${k})`;
  return keys[0] || "?";
}

async function notifyOwner(sock, text) {
  if (!OWNER_JID) return;
  await sock.sendMessage(OWNER_JID, { text }).catch(() => {});
}

// Pesan KELUAR dari akun kita ke kontak lain (muncul lewat event pesan sbg fromMe).
// "AI On" -> aktifkan lagi; selain itu dihitung balasan manual -> jeda auto-reply.
async function handleOwnOutgoing(msg, sock, jid) {
  if (MANUAL_PAUSE_MS <= 0) return;
  if (!jid || !(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))) return;
  if (msg.key.id && botSentIds.has(msg.key.id)) return; // dikirim bot sendiri
  if (!isRealOutgoingContent(msg.message)) return;

  const keys = jidUserKeys(msg.key.remoteJid, msg.key.remoteJidAlt);
  const text = extractText({ message: unwrapMessageContent(msg.message) });

  if (text && AI_ON_RE.test(text)) {
    const was = resumeAiFor(keys);
    console.log(`🤖 "AI On" di chat ${describeContact(keys)} -> auto-reply aktif lagi${was ? "" : " (sebelumnya memang tidak dijeda)"}.`);
    if (AI_ON_DELETE_COMMAND) {
      sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
    }
    await notifyOwner(sock, `✅ AI aktif lagi untuk ${describeContact(keys)}.`);
    return;
  }

  const wasPaused = aiPauseRemainingMs(keys) > 0;
  const until = pauseAiFor(keys);
  if (until) {
    console.log(
      `✋ Balasan manual ke ${describeContact(keys)} -> auto-reply dijeda sampai ${new Date(until).toLocaleTimeString("id-ID", { timeZone: WA_TIMEZONE, hour: "2-digit", minute: "2-digit" })} ${WA_TIMEZONE_LABEL}${wasPaused ? " (diperpanjang)" : ""}.`
    );
  }
}

// Balasan manual lewat layar WA di aplikasi (antrean "pending") juga dihitung manual.
function markManualFromApp(jid) {
  pauseAiFor(jidUserKeys(jid));
}

// Perintah dari pemilik di chat-ke-diri-sendiri: "AI On" (semua chat) / "AI Status".
async function handleAiPauseCommand(sock, jid, text) {
  if (AI_ON_RE.test(text)) {
    const n = aiPausedUntil.size;
    aiPausedUntil.clear();
    saveAiPause();
    await sock.sendMessage(jid, { text: n > 0 ? "✅ AI aktif lagi untuk semua chat." : "AI sudah aktif di semua chat (tidak ada yang sedang dijeda)." }).catch(() => {});
    return true;
  }
  if (AI_STATUS_RE.test(text)) {
    const now = Date.now();
    const seen = new Set();
    const lines = [];
    for (const [k, until] of aiPausedUntil) {
      if (until <= now) continue;
      const name = contactNames.get(k);
      const label = name ? `${name} (${k})` : k;
      const dupKey = `${name || k}|${until}`; // nomor & @lid kontak yang sama dijeda bersamaan -> satu baris
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);
      lines.push(`- ${label}: ${Math.ceil((until - now) / 60_000)} menit lagi`);
    }
    await sock
      .sendMessage(jid, {
        text: lines.length
          ? `⏸️ Chat yang auto-replynya sedang dijeda (setelah balasan manual):\n${lines.join("\n")}\n\nKetik "AI On" di chat itu (atau di sini untuk semua) supaya aktif lagi.`
          : "Tidak ada chat yang sedang dijeda. AI aktif di semua chat."
      })
      .catch(() => {});
    return true;
  }
  return false;
}

loadAiPause();

// Cek toggle auto-reply KHUSUS kontak ini (tabel whatsapp_contacts, diatur
// dari tombol di layar obrolan WA kontak itu di aplikasi) -- tidak ada baris
// = dianggap enabled=true/default ON (sama seperti sebelum fitur toggle per-
// kontak ini ada).
async function isAutoReplyEnabledForContact(jid) {
  const { data, error } = await supabase
    .from("whatsapp_contacts")
    .select("auto_reply_enabled")
    .eq("wa_jid", jid)
    .maybeSingle();
  if (error) {
    console.error(`Gagal cek toggle auto-reply utk ${jid}, anggap ON:`, error.message);
    return true;
  }
  return data?.auto_reply_enabled ?? true;
}

// ---------------- Perintah SiMAB (hanya baca, hanya dari pemilik) ----------------
// Pesan berawalan "simab ..." dari nomor pemilik (WA_OWNER_NUMBER) atau dari chat-ke-
// diri-sendiri dijawab dari database SiMAB (Supabase TERPISAH) lewat akun bot
// baca-saja. Pesan & jawabannya SENGAJA tidak disimpan ke whatsapp_messages (isinya
// data anggaran; juga supaya tidak ikut masuk ringkasan harian / dikirim ke Gemini).
// Lihat simab.js dan simab-bot-readonly.sql.
const OWNER_LIDS = (process.env.WA_OWNER_LIDS || "")
  .split(",")
  .map((x) => x.trim().split("@")[0].split(":")[0])
  .filter(Boolean);

async function parseSimabWithOllama(freeText) {
  const raw = await enqueueOllamaCall(
    () =>
    callOllamaChat(
      [
        { role: "system", content: SIMAB_OLLAMA_SYSTEM },
        { role: "user", content: freeText.slice(0, 300) }
      ],
      { timeoutMs: 180_000, maxTokens: 80, numCtx: 2048, format: "json", temperature: 0 }
    ),
    { priority: PRIORITY.CHAT, label: "simab-parse" }
  );
  const parsed = JSON.parse(raw);
  return { aksi: String(parsed?.aksi ?? "").toLowerCase().trim(), kueri: String(parsed?.kueri ?? "") };
}

const simab = createSimab({
  url: process.env.SIMAB_SUPABASE_URL,
  anonKey: process.env.SIMAB_SUPABASE_ANON_KEY,
  email: process.env.SIMAB_BOT_EMAIL,
  password: process.env.SIMAB_BOT_PASSWORD,
  kantorId: (process.env.SIMAB_KANTOR_ID || "538065").trim(),
  fixedTahun: Number(process.env.SIMAB_TAHUN) || null,
  perjadinAkun: (process.env.SIMAB_PERJADIN_AKUN || "524111,524113").split(",").map((x) => x.trim()).filter((x) => /^\d{6}$/.test(x)),
  timeZone: WA_TIMEZONE,
  ollamaParse: parseSimabWithOllama,
  rekamEnabled: (process.env.SIMAB_REKAM_ENABLED || "true").toLowerCase() !== "false",
  rekamUser: (process.env.SIMAB_REKAM_USER || "Bot WhatsApp").trim(),
  rekamTtlMs: (Number(process.env.SIMAB_REKAM_TTL_MIN) || 10) * 60_000,
  meteraiMak: (process.env.SIMAB_METERAI_MAK || "").split(",").map((x) => x.trim()).filter(Boolean),
  meteraiKata: (process.env.SIMAB_METERAI_KATA || "meterai,materai").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
  meteraiUraian: (process.env.SIMAB_METERAI_URAIAN || "Pembelian meterai").trim()
});

// Pengirim = pemilik? Nomor bisa datang sbg "@s.whatsapp.net" ATAU "@lid"; untuk "@lid"
// Baileys 7 menyertakan nomor aslinya di remoteJidAlt/participantAlt.
function senderUserParts(msg) {
  return [msg.key.remoteJid, msg.key.remoteJidAlt, msg.key.participant, msg.key.participantAlt]
    .filter(Boolean)
    .map((j) => j.split("@")[0].split(":")[0]);
}
function isOwnerSender(msg, isSelfChat) {
  if (isSelfChat) return true;
  const parts = senderUserParts(msg);
  if (OWNER_NUMBER && parts.includes(OWNER_NUMBER)) return true;
  return parts.some((p) => OWNER_LIDS.includes(p));
}

async function handleSimabMessage(sock, jid, msg, text) {
  const send = (t) =>
    sock.sendMessage(jid, { text: t }, { quoted: msg }).catch((err) => {
      console.error("🏛️ [SiMAB] gagal kirim balasan:", err instanceof Error ? err.message : String(err));
    });
  console.log(`🏛️ [SiMAB] perintah dari pemilik: ${text.slice(0, 80)}`);
  sock.sendPresenceUpdate("composing", jid).catch(() => {});
  const started = Date.now();
  try {
    const reply = await simab.run(text, { notify: send, sessionKey: jid });
    await send(reply);
    console.log(`🏛️ [SiMAB] dijawab dalam ${Math.round((Date.now() - started) / 100) / 10} detik.`);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`🏛️ [SiMAB] gagal: ${m}`);
    await send(`⚠️ SiMAB: ${m.slice(0, 300)}`);
  } finally {
    sock.sendPresenceUpdate("paused", jid).catch(() => {});
  }
}

// ---------------- Grup WhatsApp (dijawab hanya kalau bot di-mention) ----------------
// Default MATI. Nyalakan dengan mengisi WA_GROUP_ALLOWED_NAMES (nama grup, pisah
// koma; cukup potongan nama, huruf besar-kecil/emoji/tanda baca diabaikan) dan/
// atau WA_GROUP_ALLOWED_JIDS (id grup "...@g.us"). Grup di luar daftar tidak
// pernah dijawab maupun disimpan. Pesan grup yang TIDAK memanggil bot juga tidak
// disimpan sama sekali (privasi anggota lain).
function normalizeGroupName(name) {
  return String(name ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
const GROUP_ALLOWED_NAMES = (process.env.WA_GROUP_ALLOWED_NAMES || "")
  .split(",")
  .map(normalizeGroupName)
  .filter(Boolean);
const GROUP_ALLOWED_JIDS = (process.env.WA_GROUP_ALLOWED_JIDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const GROUP_ENABLED = GROUP_ALLOWED_NAMES.length > 0 || GROUP_ALLOWED_JIDS.length > 0;
// Pemicu: mention nomor bot (default aktif), membalas pesan bot, atau pesan yang
// diawali kata pemicu (WA_GROUP_KEYWORDS, mis. "bot,ai" -> "bot, jam berapa buka?").
const GROUP_MENTION_TRIGGER = (process.env.WA_GROUP_MENTION_TRIGGER || "true").trim().toLowerCase() !== "false";
const GROUP_KEYWORDS = (process.env.WA_GROUP_KEYWORDS || "")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);
// Jeda minimal antar pertanyaan dari ORANG YANG SAMA di grup (detik).
const GROUP_COOLDOWN_MS = Math.max(0, Number(process.env.WA_GROUP_COOLDOWN_SEC ?? 20) || 0) * 1000;
const GROUP_QUOTE_MAX_CHARS = 400;
// Pesan grup baru memicu pencarian dokumen/web kalau mengandung kata yang menandakan
// butuh data (berita, harga, aturan, dll). Selain itu dijawab langsung tanpa lookup.
const GROUP_LOOKUP_RE =
  /\b(berita|terbaru|terkini|hari ini|harga|kurs|cuaca|jadwal|skor|link|tarif|biaya|honor|honorarium|aturan|peraturan|pmk|sbm|sbk|perdin|anggaran|pagu|uu|perpres|alamat|jam buka|buka jam|nomor telepon)\b/i;
// Dokumen Pengetahuan di grup: "keywords" (bawaan) = hanya bila pesan mengandung kata di GROUP_LOOKUP_RE;
// "always" = tiap pertanyaan yang memanggil bot dicarikan di dokumen (pencarian lokal, murah).
const GROUP_DOCS_ALWAYS = (process.env.WA_GROUP_DOCS || "keywords").trim().toLowerCase() === "always";
// Opsional: di grup HANYA dokumen yang judulnya memuat salah satu potongan ini yang dijadikan acuan (pisah koma).
const GROUP_DOC_TITLES = (process.env.WA_GROUP_DOC_TITLES || "").split(",").map((x) => x.trim()).filter(Boolean);
function docTitlesFor(jid) {
  return isGroupJid(jid) && GROUP_DOC_TITLES.length > 0 ? GROUP_DOC_TITLES : null;
}
// Gemini kadang 503 ("high demand") beberapa detik; di grup coba sekali lagi dulu.
const GROUP_RETRY_503_DELAY_MS = 12_000;
const GROUP_BUSY_TEXT = "Maaf, sistem lagi penuh. Coba tag aku lagi sebentar lagi ya 🙏";

const groupSubjectCache = new Map(); // jid -> { subject, at }
async function getGroupSubject(sock, jid) {
  const hit = groupSubjectCache.get(jid);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.subject;
  try {
    const meta = await sock.groupMetadata(jid);
    const subject = meta?.subject || "";
    groupSubjectCache.set(jid, { subject, at: Date.now() });
    return subject;
  } catch (err) {
    console.error(`👥 Gagal ambil nama grup ${jid}:`, err instanceof Error ? err.message : String(err));
    return hit?.subject ?? "";
  }
}

function isGroupAllowed(jid, subject) {
  if (GROUP_ALLOWED_JIDS.includes(jid)) return true;
  const norm = normalizeGroupName(subject);
  return norm !== "" && GROUP_ALLOWED_NAMES.some((n) => norm.includes(n));
}

// Pesan di grup yang pakai "pesan sementara"/view-once dibungkus lagi -- buka dulu.
function unwrapMessageContent(message) {
  let m = message;
  for (let i = 0; i < 4 && m; i += 1) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m ?? null;
}

function getMessageContextInfo(m) {
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    null
  );
}

const groupLastAskAt = new Map(); // "grup|pengirim" -> ms

async function handleGroupMessage(msg, sock) {
  if (!GROUP_ENABLED || !AUTO_REPLY_ACTIVE) return;
  const groupJid = msg.key.remoteJid;
  const content = unwrapMessageContent(msg.message);
  if (!content) return;
  const rawText = extractText({ message: content });
  if (!rawText || rawText.startsWith("[")) return;

  const ctx = getMessageContextInfo(content);
  const ownJids = getOwnJids(sock);
  const ownUserParts = ownJids.map((j) => j.split("@")[0]);

  // --- Apakah bot dipanggil? (murni lokal & murah, belum menyentuh DB/jaringan)
  const mentioned = (ctx?.mentionedJid ?? []).some((j) => ownJids.includes(normalizeJidSuffix(j)));
  const mentionedInText = ownUserParts.some((u) => u && rawText.includes(`@${u}`));
  let triggered = GROUP_MENTION_TRIGGER && (mentioned || mentionedInText);

  let text = rawText;
  for (const u of ownUserParts) {
    if (u) text = text.split(`@${u}`).join(" ");
  }
  text = text.replace(/\s+/g, " ").trim();

  if (!triggered && GROUP_KEYWORDS.length > 0) {
    const lower = text.toLowerCase();
    const kw = GROUP_KEYWORDS.find((k) => lower === k || new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s,:!?-]`, "i").test(lower));
    if (kw) {
      triggered = true;
      text = text.slice(kw.length).replace(/^[\s,:!?-]+/, "").trim();
    }
  }

  const quotedParticipant = ctx?.participant ? normalizeJidSuffix(ctx.participant) : null;
  const repliedToOwn = quotedParticipant !== null && ownJids.includes(quotedParticipant);
  if (!triggered && repliedToOwn && ctx?.stanzaId) {
    // Hanya balasan ke pesan BOT (bukan pesan manual pemilik): cek id pesannya
    // ada di catatan balasan keluar grup ini.
    const { data: botMsg } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("wa_jid", groupJid)
      .eq("direction", "out")
      .eq("wa_message_id", ctx.stanzaId)
      .limit(1);
    if (botMsg && botMsg.length > 0) triggered = true;
  }
  if (!triggered) return;

  // --- Grup ini diizinkan?
  const subject = await getGroupSubject(sock, groupJid);
  if (!isGroupAllowed(groupJid, subject)) {
    console.log(`👥 Bot dipanggil di grup "${subject || "?"}" (${groupJid}) tapi grup ini tidak ada di WA_GROUP_ALLOWED_NAMES/JIDS, diabaikan.`);
    return;
  }

  const sender = msg.pushName || "Anggota grup";
  const quotedText = ctx?.quotedMessage ? extractText({ message: unwrapMessageContent(ctx.quotedMessage) }) : null;
  if (!text && !quotedText) return;
  if (!text) text = "(menandai tanpa pertanyaan, jawab/jelaskan pesan yang dikutip)";

  // --- Jeda per orang (cegah spam & hemat kuota)
  const senderKey = `${groupJid}|${msg.key.participant || sender}`;
  const lastAt = groupLastAskAt.get(senderKey) ?? 0;
  if (GROUP_COOLDOWN_MS > 0 && Date.now() - lastAt < GROUP_COOLDOWN_MS) {
    console.log(`👥 [${subject}] ${sender} terlalu cepat bertanya lagi, diabaikan.`);
    return;
  }
  groupLastAskAt.set(senderKey, Date.now());

  const stored =
    `${sender}: ${text}` +
    (quotedText ? `\n(mengutip: "${quotedText.replace(/\s+/g, " ").slice(0, GROUP_QUOTE_MAX_CHARS)}")` : "");
  const { error } = await supabase.from("whatsapp_messages").insert({
    wa_jid: groupJid,
    wa_name: subject || null,
    direction: "in",
    content: stored,
    status: "received",
    wa_message_id: msg.key.id
  });
  if (error) {
    if (error.code !== "23505") console.error("Gagal simpan pesan grup:", error.message);
    return; // 23505 = event terkirim ulang, jangan dijawab dobel
  }
  console.log(`👥 [${subject}] ${sender} memanggil bot: ${text.slice(0, 60)}`);

  if (!(await isAutoReplyEnabledForContact(groupJid))) {
    console.log(`🔕 Auto-reply dimatikan khusus utk grup ${groupJid}, dilewati.`);
    return;
  }

  sock.sendPresenceUpdate("composing", groupJid).catch(() => {});
  let result = null;
  try {
    try {
      result = await generateAutoReply(groupJid);
    } catch (firstErr) {
      if (firstErr?.status !== 503 || firstErr?.allKeysExhausted === true) throw firstErr;
      console.warn(`👥 Gemini 503 (sibuk) untuk grup ${groupJid}, coba lagi ${GROUP_RETRY_503_DELAY_MS / 1000} detik lagi...`);
      await new Promise((resolve) => setTimeout(resolve, GROUP_RETRY_503_DELAY_MS));
      result = await generateAutoReply(groupJid);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Gagal generate balasan grup ${groupJid}:`, errMsg);
    result = await tryLocalFallbackReply(sock, groupJid, text, err);
    if (!result) {
      sock.sendPresenceUpdate("paused", groupJid).catch(() => {});
      // Di grup tidak ada antrean ulang (balasan susulan berjam-jam kemudian
      // tidak nyambung); cukup minta mencoba lagi.
      try {
        const sent = await sock.sendMessage(groupJid, { text: GROUP_BUSY_TEXT }, { quoted: msg });
        await supabase.from("whatsapp_messages").insert({
          wa_jid: groupJid,
          wa_name: subject || null,
          direction: "out",
          content: GROUP_BUSY_TEXT,
          status: "sent",
          wa_message_id: sent?.key?.id ?? null
        });
      } catch (sendErr) {
        console.error(`Gagal kirim pesan sibuk ke grup ${groupJid}:`, sendErr instanceof Error ? sendErr.message : String(sendErr));
      }
      return;
    }
  }
  sock.sendPresenceUpdate("paused", groupJid).catch(() => {});
  if (!result || !result.reply) return;
  await deliverAutoReplyText(sock, groupJid, result, "👥 Balasan grup", { quoted: msg, waName: subject || null });
}

async function handleIncoming(msg, sock) {
  const jid = msg.key.remoteJid;
  // "Chat ke diri sendiri" (catatan pribadi) di WhatsApp -- remoteJid-nya
  // salah satu dari JID KITA SENDIRI (lihat getOwnJids -- BISA jid format
  // nomor HP ATAU format @lid, sudah ketauan dari debugging kalau WhatsApp
  // ternyata pakai yang @lid buat ini). Baileys selalu menandai ini
  // fromMe=true (kita "pengirim"-nya, tidak ada lawan bicara lain), BEDA
  // dari balasan yang kita kirim ke KONTAK LAIN (yang juga fromMe=true tapi
  // sudah dicatat duluan waktu diproses dari antrian "pending", lihat
  // processPendingOutgoing) -- makanya guard di bawah ini KECUALIKAN kasus
  // chat-ke-diri-sendiri secara eksplisit, supaya catatan pribadi ini ikut
  // tersimpan & tampil di aplikasi juga (TANPA memicu auto-reply -- lihat
  // bagian bawah fungsi ini).
  const isSelfChat = getOwnJids(sock).includes(jid);

  // Pesan yang KITA kirim sendiri (fromMe) KE KONTAK LAIN juga muncul lewat
  // event ini -- sudah dicatat duluan waktu diproses dari antrian "pending"
  // (lihat processPendingOutgoing), jadi di sini cukup dilewati supaya tidak
  // dobel. Chat-ke-diri-sendiri DIKECUALIKAN (lihat komentar isSelfChat).
  if (msg.key.fromMe && !isSelfChat) {
    await handleOwnOutgoing(msg, sock, jid);
    return;
  }

  // Grup: jalur terpisah (hanya dijawab kalau bot dipanggil & grupnya diizinkan).
  if (isGroupJid(jid)) {
    await handleGroupMessage(msg, sock);
    return;
  }

  // v1 cuma dukung chat PERSONAL (bukan grup/status/broadcast) -- biar
  // scope-nya jelas dulu, grup bisa menyusul kalau memang dibutuhkan nanti.
  // Terima jid format lama (@s.whatsapp.net, berbasis nomor HP) MAUPUN
  // format baru (@lid -- "Local ID", sistem identitas privasi yang belakangan
  // dipakai WhatsApp buat sebagian chat personal, menggantikan nomor HP
  // mentah). Tanpa ini, pesan dari kontak yang jid-nya sudah migrasi ke @lid
  // bakal kebuang diam-diam di sini (ketauan waktu debugging: event-nya
  // beneran nyampe & kebaca teksnya, tapi filter ini yang mendrop duluan).
  if (!jid || !(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))) return;

  const text = extractText(msg);
  if (!text) return;

  if (msg.pushName && !isSelfChat) {
    for (const k of jidUserKeys(jid, msg.key.remoteJidAlt)) contactNames.set(k, msg.pushName);
  }

  // "AI On" / "AI Status" dari pemilik di chat-ke-diri-sendiri (lihat Jeda auto-reply).
  if (isSelfChat && (await handleAiPauseCommand(sock, jid, text))) return;

  // Perintah SiMAB dari pemilik: dijawab dari database SiMAB, TIDAK disimpan & TIDAK
  // diteruskan ke auto-reply AI. Dari orang lain, pesan "simab ..." diperlakukan biasa.
  // Selagi sesi "simab rekam" aktif, balasan pemilik (angka / 3 baris data / ya / batal)
  // juga milik SiMAB -- bukan chat biasa.
  const inRekamSession = simab.enabled && simab.hasSession(jid) && isOwnerSender(msg, isSelfChat);
  if (/^\s*simab\b/i.test(text) || inRekamSession) {
    if (!simab.enabled) {
      if (isOwnerSender(msg, isSelfChat)) {
        await sock.sendMessage(jid, { text: "Fitur SiMAB belum aktif: isi SIMAB_SUPABASE_URL, SIMAB_SUPABASE_ANON_KEY, SIMAB_BOT_EMAIL, SIMAB_BOT_PASSWORD di .env lalu restart bot." }).catch(() => {});
        return;
      }
    } else if (isOwnerSender(msg, isSelfChat)) {
      await handleSimabMessage(sock, jid, msg, text);
      return;
    } else {
      console.log(
        `🏛️ [SiMAB] perintah ditolak: pengirim bukan pemilik (id: ${senderUserParts(msg).join(", ")}). Kalau ini nomormu tapi tampil sbg id @lid, isi WA_OWNER_LIDS=<id lid itu> di .env.`
      );
    }
  }

  const { error } = await supabase.from("whatsapp_messages").insert({
    wa_jid: jid,
    wa_name: msg.pushName || null,
    direction: "in",
    content: text,
    status: "received",
    wa_message_id: msg.key.id
  });
  if (error) {
    // Kode 23505 = unique violation (wa_message_id sudah ada) -- ini AMAN
    // diabaikan, biasa terjadi kalau bot sempat reconnect dan WhatsApp
    // mengirim ulang event pesan yang sama. PENTING: di sini juga return
    // lebih awal (jangan lanjut ke auto-reply) -- kalau tidak, pesan yang
    // sama bisa kepicu auto-reply DUA KALI waktu event-nya terkirim ulang.
    if (error.code !== "23505") {
      console.error("Gagal simpan pesan masuk:", error.message);
    }
    return;
  }
  console.log(`📩 Pesan masuk dari ${jid}${msg.pushName ? ` (${msg.pushName})` : ""}: ${text.slice(0, 60)}`);

  // Perintah pemilik: "/ringkasan" (dari chat-ke-diri-sendiri atau dari nomor
  // WA_OWNER_NUMBER) = kirim ringkasan hari ini sekarang juga.
  if (isOwnerSender(msg, isSelfChat) && text.trim().toLowerCase() === "/ringkasan") {
    sendSummaryNow("perintah /ringkasan").catch(() => {});
    return;
  }

  // Chat-ke-diri-sendiri TIDAK PERNAH memicu auto-reply (tidak masuk akal
  // bot membalas catatan kita sendiri) -- baru lanjut cek toggle AKTIF/MATI
  // global & per-kontak kalau ini beneran pesan dari kontak lain.
  if (!isSelfChat && AUTO_REPLY_ACTIVE) {
    // Kamu baru membalas chat ini manual -> bot diam dulu (pesannya tetap disimpan).
    const pausedMs = aiPauseRemainingMs(jidUserKeys(jid, msg.key.remoteJidAlt));
    if (pausedMs > 0) {
      console.log(`⏸️ Auto-reply dijeda utk ${jid} (balasan manual), ${Math.ceil(pausedMs / 60_000)} menit lagi. Ketik "AI On" di chat itu untuk mengaktifkan.`);
      return;
    }
    const contactEnabled = await isAutoReplyEnabledForContact(jid);
    if (contactEnabled) {
      await sendAutoReply(sock, jid, text);
    } else {
      console.log(`🔕 Auto-reply dimatikan khusus utk ${jid}, dilewati.`);
    }
  }
}

async function processPendingOutgoing(sock) {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, wa_jid, content")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    console.error("Gagal ambil antrian pesan keluar:", error.message);
    return;
  }

  for (const row of data ?? []) {
    try {
      // "AI On" yang diketik dari layar WA di aplikasi = PERINTAH, bukan pesan untuk kontak:
      // aktifkan lagi auto-reply di chat ini, JANGAN dikirim ke kontak, dan JANGAN memicu jeda.
      if (typeof row.content === "string" && AI_ON_RE.test(row.content)) {
        const keys = jidUserKeys(row.wa_jid);
        const was = resumeAiFor(keys);
        await supabase
          .from("whatsapp_messages")
          .update({ status: "sent", wa_message_id: null, error: null })
          .eq("id", row.id);
        console.log(
          `🤖 "AI On" dari aplikasi untuk ${describeContact(keys)} -> auto-reply aktif lagi${was ? "" : " (sebelumnya memang tidak dijeda)"}. (tidak dikirim ke kontak)`
        );
        await notifyOwner(sock, `✅ AI aktif lagi untuk ${describeContact(keys)}.`);
        continue;
      }
      const sent = await sock.sendMessage(row.wa_jid, { text: row.content });
      rememberBotSent(sent?.key?.id);
      await supabase
        .from("whatsapp_messages")
        .update({ status: "sent", wa_message_id: sent?.key?.id ?? null, error: null })
        .eq("id", row.id);
      console.log(`📤 Terkirim ke ${row.wa_jid}: ${row.content.slice(0, 60)}`);
      markManualFromApp(row.wa_jid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Gagal kirim ke ${row.wa_jid}:`, msg);
      await supabase.from("whatsapp_messages").update({ status: "failed", error: msg }).eq("id", row.id);
    }
  }
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    // "silent" -- Baileys defaultnya CEREWET BANGET kalau logger-nya aktif
    // (nge-log tiap paket protokol WhatsApp). Ganti ke level "info" cuma
    // kalau lagi debug masalah koneksi.
    logger: pino({ level: "silent" }),
    browser: ["Ringkasan Harian Bot", "Chrome", "1.0.0"]
  });

  currentSock = sock;

  // Catat id tiap pesan yang dikirim BOT supaya tidak pernah dikira balasan manual.
  const origSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const res = await origSendMessage(...args);
    rememberBotSent(res?.key?.id);
    return res;
  };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n=== Scan QR code ini pakai HP ===");
      console.log("WhatsApp di HP > Perangkat Tertaut > Tautkan Perangkat\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      currentSock = null;
      waOpen = false;
      if (loggedOut) {
        console.error(
          "\n❌ Sesi WhatsApp logout/dicabut dari HP (atau sesi tidak valid lagi).\n" +
            "   Hapus folder wa-bot/auth_session/ lalu jalankan ulang bot ini untuk scan QR baru.\n"
        );
      } else {
        console.warn("⚠️  Koneksi WhatsApp putus, coba sambung ulang dalam 5 detik...");
        setTimeout(connect, 5000);
      }
    } else if (connection === "open") {
      waOpen = true;
      console.log(`\n✅ WhatsApp tersambung (${sock.user?.id || "?"}). Bot siap jalan.\n`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // type "notify" = pesan baru beneran masuk (bukan hasil sinkronisasi
    // riwayat lama waktu pertama kali login).
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await handleIncoming(msg, sock);
      } catch (err) {
        console.error("Gagal proses satu pesan masuk:", err instanceof Error ? err.message : String(err));
      }
    }
  });
}

connect().catch((err) => {
  console.error("Gagal mulai koneksi WhatsApp:", err);
  process.exit(1);
});

setInterval(() => {
  if (currentSock) {
    processPendingOutgoing(currentSock).catch((err) => {
      console.error("Loop kirim pesan error:", err instanceof Error ? err.message : String(err));
    });
  }
}, POLL_INTERVAL_MS);

// Retry pesan yang gagal dibalas AI + ringkasan harian + ingat key yang sudah
// habis hari ini (lihat processRetryQueue, checkDailySummary,
// primeExhaustedKeysFromDb).
setInterval(() => {
  processRetryQueue(currentSock).catch(() => {});
}, RETRY_CHECK_INTERVAL_MS);
setInterval(() => {
  checkDailySummary().catch(() => {});
}, 60_000);
setInterval(() => {
  checkSummaryFlagFile().catch(() => {});
}, 5_000);
primeExhaustedKeysFromDb().catch(() => {});
console.log(
  `📋 Ringkasan harian ke pemilik: ${WA_DAILY_SUMMARY_ENABLED ? `AKTIF (tiap hari setelah ${String(WA_DAILY_SUMMARY_HOUR).padStart(2, "0")}:00 ${WA_TIMEZONE_LABEL}, mesin: ${WA_SUMMARY_ENGINE}${WA_SUMMARY_ENGINE === "ollama" ? `, cadangan Gemini: ${WA_SUMMARY_GEMINI_FALLBACK ? "ya" : "tidak"}` : ""})` : "mati (isi WA_OWNER_NUMBER di .env buat menyalakan)"}`
);
console.log(
  `🏛️ SiMAB lewat WhatsApp (hanya baca): ${simab.enabled && OWNER_NUMBER ? `AKTIF (satker ${(process.env.SIMAB_KANTOR_ID || "538065").trim()}, awali pesan dengan "simab")` : "mati (isi SIMAB_* di .env buat menyalakan)"}`
);
console.log(
  `👥 Grup WhatsApp: ${GROUP_ENABLED && AUTO_REPLY_ACTIVE ? `AKTIF (grup diizinkan: ${[...(process.env.WA_GROUP_ALLOWED_NAMES || "").split(",").map((x) => x.trim()).filter(Boolean), ...GROUP_ALLOWED_JIDS].join(" | ")}; pemicu: ${[GROUP_MENTION_TRIGGER ? "mention" : null, "balas pesan bot", GROUP_KEYWORDS.length ? `kata "${GROUP_KEYWORDS.join(",")}"` : null].filter(Boolean).join(", ")})` : "mati (isi WA_GROUP_ALLOWED_NAMES di .env buat menyalakan)"}`
);
console.log(
  `🦙 Cadangan lokal auto-reply (Ollama, saat kuota Gemini habis): ${AUTO_REPLY_ACTIVE && WA_AI_ENGINE === "gemini" && WA_OLLAMA_FALLBACK_ENABLED ? `AKTIF (model ${OLLAMA_MODEL}, hanya pertanyaan non-angka)` : "mati"}`
);

// Agen Ollama untuk chat di APLIKASI (pilihan agen di halaman chat): mengambil
// antrean `agent_jobs` dari Supabase & menjawab pakai Ollama lokal. Tidak
// butuh koneksi WhatsApp & tidak mengirim pesan WA apa pun -- lihat app-agent.js.
// Push notifikasi ke HP lewat Edge Function send-push (memakai CRON_SECRET yang sama
// dengan di Supabase). Tanpa CRON_SECRET di .env, push dimatikan (fitur lain tetap jalan).
const CRON_SECRET = process.env.CRON_SECRET || "";
let warnedNoPush = false;
async function sendPush({ title, body, url, tag }) {
  if (!CRON_SECRET) {
    if (!warnedNoPush) {
      warnedNoPush = true;
      console.warn("🔔 Push notifikasi dimatikan: isi CRON_SECRET di wa-bot/.env (sama dengan secret Supabase).");
    }
    return;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "x-cron-secret": CRON_SECRET },
    body: JSON.stringify({ title, body, url, tag })
  });
  if (!res.ok) throw new Error(`send-push HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const kbCfg = readKbConfig(process.env, fileURLToPath(new URL(".", import.meta.url)));
let kbIngest = null;
if (kbCfg.enabled) {
  try {
    kbIndex = await openKbIndex({ file: kbCfg.indexFile, chunkChars: kbCfg.chunkChars, overlapChars: kbCfg.chunkOverlap, reindex: kbCfg.reindex });
    kbIngest = createKbIngestWorker({
      supabase,
      index: kbIndex,
      notify: sendPush,
      env: process.env,
      baseDir: fileURLToPath(new URL(".", import.meta.url)),
      // Pekerjaan berat di latar (OCR) menunggu Ollama selesai supaya tidak berebut CPU.
      isBusy: () => !ollamaQueue.isIdle(),
      waitForIdle: () => ollamaQueue.waitForIdle()
    });
  } catch (err) {
    console.error("📚 Indeks dokumen tidak aktif:", err instanceof Error ? err.message : String(err));
    kbIndex = null;
  }
}

// Gemini (chat aplikasi) membaca dokumen lewat indeks laptop ini: Edge Function menaruh pertanyaan di
// kb_retrievals, worker ini menjawab dengan potongan teks (lihat kb-retrieval.js, migrations/0019).
const kbRetrieval = kbIndex ? createKbRetrievalWorker({ supabase, index: kbIndex, env: process.env }) : null;

const appAgent = createAppAgentWorker({
  supabase,
  kbIndex,
  callOllamaChat,
  enqueueOllamaCall,
  fetchRelevantKnowledgeChunks,
  rankKnowledgeChunks,
  chunkDocumentText,
  currentDateLine,
  ollamaBaseUrl: OLLAMA_BASE_URL,
  ollamaModel: OLLAMA_MODEL,
  notify: sendPush,
  getExtra: () => ({
    waConnected: waOpen,
    extra: {
      pausedChats: aiPausedUntil.size,
      engine: WA_AI_ENGINE,
      autoReply: AUTO_REPLY_ACTIVE,
      queue: ollamaQueue.stats(),
      mem: readMemInfo(),
      keepAlive: OLLAMA_KEEP_ALIVE,
      kb: kbIngest
        ? (() => {
            const st = kbIngest.status();
            return {
              docs: st.docs,
              chunks: st.chunks,
              pdftotext: !!st.tools?.pdftotext,
              ocr: !!(st.tools?.tesseract && st.tools?.pdftoppm),
              processing: st.current ? st.current.title : null,
              lastError: st.lastError
            };
          })()
        : null
    }
  })
});

// Pengingat harian target khatam Al-Qur'an (push). Jam: KHATAM_REMINDER_TIME (default 20:30, zona WA_TIMEZONE).
const khatamReminder = createKhatamReminder({
  supabase,
  notify: sendPush,
  timeZone: WA_TIMEZONE,
  stateFile: fileURLToPath(new URL("./khatam-state.json", import.meta.url)),
  reminderTime: process.env.KHATAM_REMINDER_TIME || "20:30"
});
setInterval(() => {
  khatamReminder.check().catch((err) => console.error("📖 Pengingat khatam error:", err instanceof Error ? err.message : String(err)));
}, 60_000);
appAgent.start().catch((err) => {
  console.error("Agen Ollama aplikasi gagal start:", err instanceof Error ? err.message : String(err));
});
kbRetrieval?.start();
if (kbIngest) {
  kbIngest.start().catch((err) => {
    console.error("Ingest dokumen gagal start:", err instanceof Error ? err.message : String(err));
  });
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    kbIngest?.stop();
    kbRetrieval?.stop();
    appAgent
      .stop()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

// Jaga-jaga: bot ini harus jalan LAMA tanpa diawasi -- jangan sampai mati
// total cuma gara-gara satu error tak terduga yang tidak ketangkep try/catch
// di atas. Dicatat ke log biar ketahuan, tapi proses dibiarkan tetap hidup.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (bot tetap jalan):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (bot tetap jalan):", err);
});
