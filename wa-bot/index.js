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
// Gemini sebagai konteks -- sengaja lebih pendek drpd riwayat Obrolan AI
// (yang 40) karena chat WA biasanya lebih singkat/kasual, dan tiap pesan WA
// baru memicu 1 panggilan Gemini (beda dari Obrolan AI yang cuma kepanggil
// waktu user benar-benar kirim) -- riwayat lebih pendek = lebih hemat token.
const AUTO_REPLY_HISTORY_LIMIT = 20;

if (WA_AUTO_REPLY_ENABLED && !GEMINI_API_KEY) {
  console.warn(
    "⚠️  WA_AUTO_REPLY_ENABLED=true tapi GEMINI_API_KEY belum diisi di .env -- auto-reply TIDAK akan jalan sampai diisi."
  );
}
console.log(`🤖 Auto-reply AI: ${WA_AUTO_REPLY_ENABLED && GEMINI_API_KEY ? "AKTIF" : "mati"}`);

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

// Sama persis konsepnya dengan KNOWLEDGE_CONTEXT_INTRO di
// supabase/functions/_shared/gemini.ts (lihat catatan sinkronisasi di atas).
const WA_KNOWLEDGE_CONTEXT_INTRO = `Pemilik nomor ini sudah mengupload dokumen referensi berikut ke aplikasinya (mis. peraturan/perundangan). ANGGAP dokumen-dokumen ini sebagai sumber paling terpercaya dan PRIORITASKAN jawaban dari sini -- kalau pertanyaan bisa dijawab dari isi salah satu dokumen di bawah, jawab dari situ duluan dan sebutkan judul dokumennya, TANPA perlu cari di internet dulu. Cari di Google HANYA kalau jawabannya memang tidak ada di dokumen-dokumen ini, atau topiknya jelas di luar cakupan dokumen ini.`;

function buildWaSystemText(knowledgeContext) {
  if (!knowledgeContext || knowledgeContext.length === 0) return WA_BASE_SYSTEM_PROMPT;
  const docsText = knowledgeContext.map((doc) => `=== Dokumen: "${doc.title}" ===\n${doc.content}`).join("\n\n");
  return `${WA_BASE_SYSTEM_PROMPT}\n\n${WA_KNOWLEDGE_CONTEXT_INTRO}\n\n${docsText}`;
}

// Ambil Dokumen Pengetahuan yang sama dipakai Obrolan AI (tabel
// knowledge_documents) -- SAMA PERSIS query & budget karakternya dengan
// Edge Function `chat` (action "send"), lihat catatan sinkronisasi di atas.
// Beda dari Obrolan AI (yang ini opt-in PER OBROLAN lewat toggle "Pakai
// Dokumen Pengetahuan"), auto-reply WA SELALU ikutkan semua dokumen yang ada
// -- tidak ada toggle per-kontak di v1 ini.
//
// BUDGET SENGAJA JAUH LEBIH KECIL drpd punya `chat` Edge Function
// (600.000): di sana user baru kena biaya/beban ini kalau SENGAJA nyalain
// toggle KB per obrolan, tapi di sini kekirim di SETIAP pesan WA yang masuk
// otomatis -- budget sebesar itu bikin tiap request jadi berat & gampang
// kena rate-limit (429) kalau lagi banyak pesan masuk beruntun.
const KB_TOTAL_BUDGET_CHARS = 80000;
async function fetchKnowledgeContext() {
  const { data: kbRows, error } = await supabase
    .from("knowledge_documents")
    .select("title, content")
    .order("uploaded_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("Gagal ambil dokumen pengetahuan (auto-reply WA), lanjut tanpa itu:", error.message);
    return [];
  }
  const knowledgeContext = [];
  let used = 0;
  for (const row of kbRows ?? []) {
    if (used >= KB_TOTAL_BUDGET_CHARS) break;
    const remaining = KB_TOTAL_BUDGET_CHARS - used;
    const content = row.content.length > remaining ? `${row.content.slice(0, remaining)}\n\n[...dipotong...]` : row.content;
    knowledgeContext.push({ title: row.title, content });
    used += content.length;
  }
  return knowledgeContext;
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

// Minta Gemini bikinkan satu balasan buat obrolan WA tertentu, pakai
// AUTO_REPLY_HISTORY_LIMIT pesan terakhir di obrolan itu + Dokumen
// Pengetahuan sebagai konteks. Return null kalau memang tidak ada apa-apa
// buat dibalas (riwayat kosong) -- selain itu throw error (ditangani
// pemanggil) kalau Gemini gagal total.
async function generateAutoReply(jid) {
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

  const knowledgeContext = await fetchKnowledgeContext();
  const systemText = buildWaSystemText(knowledgeContext);

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
  let result;
  try {
    result = await generateAutoReply(jid);
  } catch (err) {
    console.error(`Gagal generate auto-reply utk ${jid}:`, err instanceof Error ? err.message : String(err));
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

async function handleIncoming(msg, sock) {
  // Pesan yang KITA kirim sendiri (fromMe) juga muncul lewat event ini --
  // sudah dicatat duluan waktu diproses dari antrian "pending" (lihat
  // processPendingOutgoing), jadi di sini cukup dilewati supaya tidak dobel.
  if (msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
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

  if (WA_AUTO_REPLY_ENABLED && GEMINI_API_KEY) {
    await sendAutoReply(sock, jid);
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
