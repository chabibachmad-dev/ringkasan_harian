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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
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

if (WA_AUTO_REPLY_ENABLED && WA_AI_ENGINE === "gemini" && !GEMINI_API_KEY) {
  console.warn(
    "⚠️  WA_AUTO_REPLY_ENABLED=true + WA_AI_ENGINE=gemini tapi GEMINI_API_KEY belum diisi di .env -- auto-reply TIDAK akan jalan sampai diisi."
  );
}
// Auto-reply dianggap "siap jalan" kalau: enabled DAN (pakai ollama -- tidak
// butuh API key apa pun, cukup Ollama-nya jalan di laptop -- ATAU pakai
// gemini DAN API key-nya sudah diisi).
const AUTO_REPLY_ACTIVE = WA_AUTO_REPLY_ENABLED && (WA_AI_ENGINE === "ollama" || Boolean(GEMINI_API_KEY));
console.log(`🤖 Auto-reply AI: ${AUTO_REPLY_ACTIVE ? `AKTIF (mesin: ${WA_AI_ENGINE})` : "mati"}`);

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
  "tolong", "mohon", "coba", "gimana", "kenapa", "siapa", "dimana", "kapan"
]);

function tokenizeForScoring(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ID_STOPWORDS.has(w));
}

// Pecah teks dokumen jadi potongan ~RAG_CHUNK_SIZE_CHARS karakter, usahakan
// tidak motong di tengah paragraf (gabung paragraf pendek sampai mendekati
// batas ukuran).
function chunkDocumentText(text, chunkSize) {
  const paragraphs = (text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
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
async function fetchRelevantKnowledgeChunks(question, budgetChars) {
  const qWords = new Set(tokenizeForScoring(question));
  if (qWords.size === 0) return [];

  const { data, error } = await supabase.from("knowledge_documents").select("title, content");
  if (error) {
    console.error("RAG: gagal ambil Dokumen Pengetahuan, lanjut tanpa konteks dokumen:", error.message);
    return [];
  }
  if (!data || data.length === 0) return [];

  const scored = [];
  for (const doc of data) {
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
    const webBlock = webResults.map((r, i) => `${i + 1}. ${r.title} -- ${r.snippet}`).join("\n");
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
let ollamaQueueTail = Promise.resolve();
function enqueueOllamaCall(fn) {
  const run = ollamaQueueTail.then(fn, fn);
  // .catch(()=>{}) di sini CUMA buat jaga rantai antrian tetap jalan walau
  // panggilan sebelumnya gagal -- error aslinya tetap dilempar balik ke
  // pemanggil `run` (promise yang di-return), bukan ditelan di sini.
  ollamaQueueTail = run.catch(() => {});
  return run;
}

// Satu kali panggilan ke Ollama (server lokal, default port 11434 -- lihat
// OLLAMA_BASE_URL) pakai endpoint /api/chat (format "messages" kayak
// OpenAI/Gemini chat API, BUKAN /api/generate yang formatnya 1 prompt
// mentah). stream:false biar responsnya 1 JSON utuh sekali balik, bukan
// potongan-potongan (lebih gampang ditangani drpd streaming, auto-reply WA
// toh baru dikirim setelah teksnya LENGKAP).
async function callOllamaChat(messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        // keep_alive "10m" -- minta Ollama tetap nyimpen model ini DIMUAT di
        // RAM selama 10 menit sejak pemakaian terakhir (default Ollama cuma
        // 5 menit), supaya pesan WA berikutnya yang masih berdekatan waktu
        // tidak kena ongkos "load_duration" lagi (~5-8 detik dari hasil tes
        // user -- lumayan kalau CPU-nya memang sudah pas-pasan).
        keep_alive: "10m",
        options: { num_ctx: OLLAMA_NUM_CTX, num_predict: OLLAMA_MAX_OUTPUT_TOKENS, temperature: 0.4 }
      }),
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Ollama tidak merespons dalam ${OLLAMA_TIMEOUT_MS}ms (timeout).`);
    }
    throw new Error(`Gagal hubungi Ollama di ${OLLAMA_BASE_URL} -- apakah "ollama serve" jalan? (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.message?.content;
  if (!text) throw new Error(`Respons Ollama tidak berisi teks: ${JSON.stringify(data).slice(0, 300)}`);
  return text;
}

// Versi generateAutoReply KHUSUS mesin "ollama": ambil riwayat (sama persis
// query & urutan dgn versi Gemini di bawah -- lihat catatan descending+
// reverse di sana soal kenapa), lalu SISIPKAN konteks RAG + web search ke
// pertanyaan TERAKHIR sebelum dikirim ke Ollama. tokensUsed/costUsd selalu
// 0 (model lokal, tidak ada biaya/kuota token API) -- recordTokenUsage
// sudah otomatis skip kalau tokensUsed 0, jadi tidak mencemari angka
// pemakaian Gemini di footer aplikasi.
async function generateAutoReplyWithOllama(jid) {
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

  const docChunks = await fetchRelevantKnowledgeChunks(question, RAG_CONTEXT_BUDGET_CHARS);
  const topScore = docChunks[0]?.score ?? 0;
  const webResults = topScore >= RAG_STRONG_MATCH_SCORE ? [] : await webSearchBing(question, WEB_SEARCH_MAX_RESULTS);

  messages[messages.length - 1] = {
    role: "user",
    content: buildGroundedUserMessage(question, docChunks, webResults)
  };

  // Lewat antrian (enqueueOllamaCall) -- lihat catatan di atasnya kenapa:
  // timer timeout (OLLAMA_TIMEOUT_MS) baru mulai jalan begitu giliran
  // permintaan ini BENERAN dieksekusi (bukan dari saat masuk antrian), jadi
  // nunggu antrian TIDAK ikut makan jatah waktu timeout-nya.
  const replyText = await enqueueOllamaCall(() =>
    callOllamaChat([{ role: "system", content: WA_OLLAMA_SYSTEM_PROMPT }, ...messages])
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

// Satu kali panggilan mentah ke Gemini API. withTools=true nyalakan akses
// pencarian Google (lihat WA_BASE_SYSTEM_PROMPT). Melempar Error (dengan
// properti .status) kalau gagal, ditangani pemanggil (callGeminiWithRetry).
async function callGeminiOnce(systemText, contents, withTools) {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemText }] },
    contents,
    ...(withTools ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0.6 }
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (res.ok) return res.json();
  const errText = await res.text();
  const err = new Error(`Gemini API error ${res.status}: ${errText}`);
  err.status = res.status;
  throw err;
}

// Retry ringan buat status sementara (429/503) -- beda dari versi lengkap di
// Edge Function `chat` yang juga punya fallback ke MODEL cadangan segala,
// di sini cukup retry model yang sama supaya kodenya tetap ringkas.
async function callGeminiWithRetry(systemText, contents, withTools, maxAttempts) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callGeminiOnce(systemText, contents, withTools);
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

  const systemText = WA_BASE_SYSTEM_PROMPT;

  // Urutan percobaan sama seperti generateChatReply() di Edge Function
  // `chat`: coba dulu DENGAN akses internet (1x saja, jangan buang waktu
  // retry di jalur ini kalau lagi padat), baru kalau gagal lanjut TANPA
  // internet dengan sisa jatah retry.
  let data;
  try {
    data = await callGeminiWithRetry(systemText, contents, true, 1);
  } catch (err) {
    console.warn(`Auto-reply WA: percobaan dgn Google Search gagal (${err.message}), lanjut tanpa akses internet...`);
    data = await callGeminiWithRetry(systemText, contents, false, 2);
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error(`Respons Gemini tidak berisi teks: ${JSON.stringify(data).slice(0, 300)}`);

  const tokensUsed = data?.usageMetadata?.totalTokenCount ?? 0;
  const ESTIMATED_INPUT_SHARE = 0.7;
  const costUsd = tokensUsed > 0 ? estimateCostUsd(GEMINI_MODEL, tokensUsed * ESTIMATED_INPUT_SHARE, tokensUsed * (1 - ESTIMATED_INPUT_SHARE)) : 0;

  return { reply: rawText.trim(), tokensUsed, costUsd };
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

async function sendAutoReply(sock, jid) {
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
    console.error(`Gagal generate auto-reply utk ${jid}:`, err instanceof Error ? err.message : String(err));
    sock.sendPresenceUpdate("paused", jid).catch(() => {});
    try {
      const sent = await sock.sendMessage(jid, { text: AUTO_REPLY_FALLBACK_TEXT });
      await supabase.from("whatsapp_messages").insert({
        wa_jid: jid,
        direction: "out",
        content: AUTO_REPLY_FALLBACK_TEXT,
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

  try {
    const sent = await sock.sendMessage(jid, { text: result.reply });
    await supabase.from("whatsapp_messages").insert({
      wa_jid: jid,
      direction: "out",
      content: result.reply,
      status: "sent",
      wa_message_id: sent?.key?.id ?? null
    });
    console.log(`🤖 Auto-reply ke ${jid}: ${result.reply.slice(0, 60)}`);
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

// Dipakai loop pengirim (setInterval di bawah) -- selalu nunjuk ke socket
// WhatsApp yang LAGI AKTIF, diupdate ulang tiap kali connect()/reconnect
// bikin socket baru (lihat connection.update di bawah).
let currentSock = null;

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
  if (msg.key.fromMe && !isSelfChat) return;

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

  // Chat-ke-diri-sendiri TIDAK PERNAH memicu auto-reply (tidak masuk akal
  // bot membalas catatan kita sendiri) -- baru lanjut cek toggle AKTIF/MATI
  // global & per-kontak kalau ini beneran pesan dari kontak lain.
  if (!isSelfChat && AUTO_REPLY_ACTIVE) {
    const contactEnabled = await isAutoReplyEnabledForContact(jid);
    if (contactEnabled) {
      await sendAutoReply(sock, jid);
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
      const sent = await sock.sendMessage(row.wa_jid, { text: row.content });
      await supabase
        .from("whatsapp_messages")
        .update({ status: "sent", wa_message_id: sent?.key?.id ?? null, error: null })
        .eq("id", row.id);
      console.log(`📤 Terkirim ke ${row.wa_jid}: ${row.content.slice(0, 60)}`);
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

// Jaga-jaga: bot ini harus jalan LAMA tanpa diawasi -- jangan sampai mati
// total cuma gara-gara satu error tak terduga yang tidak ketangkep try/catch
// di atas. Dicatat ke log biar ketahuan, tapi proses dibiarkan tetap hidup.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (bot tetap jalan):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (bot tetap jalan):", err);
});
