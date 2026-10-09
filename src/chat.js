// Klien buat fitur diskusi/chat pribadi -- semua request lewat Edge
// Function `chat` (lihat supabase/functions/chat/index.ts), karena
// tabel chat_messages dikunci total dari anon key.

import { supabase } from "./supabaseClient.js";

const CODE_STORAGE_KEY = "rh_chat_code";

export function getStoredChatCode() {
  try {
    return localStorage.getItem(CODE_STORAGE_KEY) || "";
  } catch (_err) {
    return "";
  }
}

export function setStoredChatCode(code) {
  try {
    localStorage.setItem(CODE_STORAGE_KEY, code);
  } catch (_err) {
    // Abaikan (mis. private browsing yang blokir localStorage) --
    // kode cuma tidak akan diingat lintas sesi, fitur tetap jalan.
  }
}

export function clearStoredChatCode() {
  try {
    localStorage.removeItem(CODE_STORAGE_KEY);
  } catch (_err) {
    /* noop */
  }
}

async function callChatFunction(payload) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        unauthorized: res.status === 401,
        // Ollama dipilih tapi laptop/bot/Ollama tidak hidup (server menolak
        // tanpa menyimpan pesan) -- lihat Edge Function action "send".
        ollamaOffline: data.ollamaOffline === true,
        message: data.error || `HTTP ${res.status}`,
        userMessageId: data.userMessageId
      };
    }
    return { ok: true, ...data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, unauthorized: false, message };
  }
}

export function fetchChatHistory(date, code) {
  return callChatFunction({ code, date, action: "history" });
}

export function sendChatMessage(date, code, message, agent) {
  const payload = { code, date, action: "send", message };
  if (agent === "auto" || agent === "gemini" || agent === "ollama") payload.agent = agent;
  return callChatFunction(payload);
}

// Agen Ollama (model lokal di laptop) bekerja lewat antrean: send mengembalikan
// { pending: true, jobId }, lalu klien polling fetchAgentJob() sampai
// status "done" (berisi reply) atau "failed".
export function fetchAgentJob(code, jobId) {
  return callChatFunction({ code, action: "agent_job", jobId });
}

// Apakah laptop/bot/Ollama sedang hidup (untuk titik status di pemilih agen).
export function fetchAgentStatus(code) {
  return callChatFunction({ code, action: "agent_status" });
}

// Ambil pesan terakhir dari beberapa obrolan sekaligus -- dipakai buat
// cuplikan/preview di layar daftar obrolan (mirip pesan terakhir di
// daftar chat WhatsApp).
export function fetchLastMessages(dates, code) {
  return callChatFunction({ code, action: "last_messages", dates });
}

// Ambil semua ID obrolan yang tersimpan di SERVER (bukan cuma yang tercatat
// di localStorage perangkat ini), lengkap dengan status pin & judul
// custom-nya -- dipakai supaya daftar obrolan, sematan, dan judul custom
// ikut muncul walau dibuka dari perangkat lain dengan kode akses yang sama.
export function listChatThreads(code) {
  return callChatFunction({ code, action: "list_threads" });
}

// Simpan status sematan (pin), judul custom, dan/atau toggle "Pakai Dokumen
// Pengetahuan" satu obrolan ke SERVER -- supaya semuanya ikut sinkron ke
// semua perangkat dengan kode akses yang sama (sebelumnya cuma localStorage
// per perangkat). Cuma kirim field yang berubah: field yang tidak
// disertakan tidak akan diubah di server. title: null/"" berarti "pakai
// judul default lagi". useKb default false (opt-in) -- lihat komentar di
// Edge Function chat/index.ts migrations/0010 kenapa ini sengaja opt-in.
export function setThreadMeta(id, code, { pinned, saved, title, useKb, agent } = {}) {
  const payload = { code, date: id, action: "set_thread_meta" };
  if (typeof pinned === "boolean") payload.pinned = pinned;
  // saved = tanda "Saved": obrolan bertanda ini tidak ikut dihapus otomatis setelah 7 hari (migrations/0018).
  if (typeof saved === "boolean") payload.saved = saved;
  if (title !== undefined) payload.title = title;
  if (typeof useKb === "boolean") payload.useKb = useKb;
  if (agent === "auto" || agent === "gemini" || agent === "ollama") payload.agent = agent;
  return callChatFunction(payload);
}

// Hapus semua pesan di satu obrolan -- dipakai oleh menu titik-3
// "Hapus chat".
export function deleteChatThread(date, code) {
  return callChatFunction({ code, date, action: "delete" });
}

// Hapus SATU pesan -- dipakai menu titik-3 per-pesan di dalam obrolan
// ("Hapus pesan"). Server sengaja cuma mengizinkan ini untuk pesan dengan
// role "user" (lihat Edge Function) -- balasan AI tidak bisa dihapus
// satuan, cuma seluruh obrolan lewat deleteChatThread() di atas.
export function deleteChatMessage(date, code, id) {
  return callChatFunction({ code, date, action: "delete_message", id });
}

// Perkiraan token Gemini terpakai HARI INI (zona waktu Pasifik, sama
// seperti jadwal reset kuota gratis Gemini) -- ditampilkan di footer layar
// daftar. Sengaja tidak butuh kode akses yang benar di sisi server (lihat
// index.ts), tapi tetap dikirim kalau ada supaya konsisten dengan fungsi
// lain -- kalau belum ada kode tersimpan, caller cukup lewati panggilan ini.
export function fetchTokenUsageToday(code) {
  return callChatFunction({ code, action: "token_usage" });
}

// ================================================================
// "Dokumen Pengetahuan" (Pengaturan > Upload Dokumen) -- PDF referensi
// (mis. peraturan keuangan) yang teksnya sudah diekstrak DI BROWSER (lihat
// pdfText.js), lalu teksnya disimpan di server supaya disertakan sebagai
// konteks ke Gemini tiap kali chat (lihat action "send" di Edge Function).
// ================================================================

// Daftar dokumen yang sudah pernah diupload (metadata saja -- judul, jumlah
// karakter, tanggal upload -- TANPA isi teksnya, supaya ringan buat
// ditampilkan di dialog Pengaturan).
export function listKnowledgeDocs(code) {
  return callChatFunction({ code, action: "kb_list" });
}

// Upload satu dokumen baru -- `content` adalah teks hasil ekstrak PDF
// (extractPdfText() di pdfText.js), BUKAN file PDF mentah, supaya Edge
// Function tidak perlu library PDF sama sekali.
export function uploadKnowledgeDoc(code, { title, content, filename } = {}) {
  return callChatFunction({ code, action: "kb_upload", title, content, filename });
}

// Upload file MENTAH (PDF/txt/md/csv, sampai 50 MB) tanpa batas karakter:
// 1) minta tiket upload, 2) kirim file ke bucket privat `kb-inbox`,
// 3) antrekan -- lalu bot di laptop mengubahnya jadi teks + indeks pencarian
// (lihat wa-bot/kb-ingest.js). Mengembalikan { ok, document } atau error.
export async function uploadKnowledgeFile(code, { title, file, onStatus } = {}) {
  const ticket = await callChatFunction({ code, action: "kb_upload_url", title, filename: file.name, size: file.size });
  if (!ticket.ok) return ticket;
  if (onStatus) onStatus("sending");
  const { error } = await supabase.storage.from("kb-inbox").uploadToSignedUrl(ticket.upload.path, ticket.upload.token, file, {
    contentType: file.type || undefined
  });
  if (error) {
    // Bersihkan baris yatim supaya tidak menggantung 'uploading' selamanya.
    await callChatFunction({ code, action: "kb_delete", id: ticket.document.id });
    return { ok: false, message: error.message || "Gagal mengirim file." };
  }
  const done = await callChatFunction({ code, action: "kb_upload_done", id: ticket.document.id });
  if (!done.ok) return done;
  return { ok: true, document: ticket.document };
}

// Ulangi pemrosesan dokumen yang gagal (file mentahnya masih di inbox).
export function retryKnowledgeDoc(code, id) {
  return callChatFunction({ code, action: "kb_retry", id });
}

// Hapus satu dokumen pengetahuan (tombol tempat sampah di daftar dokumen).
export function deleteKnowledgeDoc(code, id) {
  return callChatFunction({ code, action: "kb_delete", id });
}

// Status tiap API key Gemini hari ini (jumlah request tercatat, habis/aktif,
// kapan reset) -- dipakai dialog Pengaturan > Status API Gemini. Server cuma
// mengirim 4 karakter TERAKHIR tiap key (hint), key aslinya tidak pernah
// sampai ke browser.
// provider: "gemini" (bawaan) | "openrouter" | "groq" -- tiga tombol di layar Status Sistem.
export function fetchKeyStatus(code, provider = "gemini") {
  return callChatFunction({ code, action: "key_status", provider });
}

// ================================================================
// Al-Qur'an: terakhir dibaca + bookmark (lihat quran.js & migrations/0014).
// ================================================================
export function quranSync(code) {
  return callChatFunction({ code, action: "quran_sync" });
}

export function quranSetLastRead(code, { surah, ayah, page }) {
  return callChatFunction({ code, action: "quran_set_last_read", surah, ayah, page });
}

export function quranAddBookmark(code, { surah, ayah, page }) {
  return callChatFunction({ code, action: "quran_add_bookmark", surah, ayah, page });
}

export function quranDeleteBookmark(code, { surah, ayah }) {
  return callChatFunction({ code, action: "quran_delete_bookmark", surah, ayah });
}

// ---------------------------------------------------------------- Lampiran, status sistem, khatam

// Lampiran file di obrolan (teks diekstrak di browser; max 3 per obrolan).
export function addChatAttachment(code, date, { name, content }) {
  return callChatFunction({ code, date, action: "attachment_add", name, content });
}

export function deleteChatAttachment(code, date, id) {
  return callChatFunction({ code, date, action: "attachment_delete", id });
}

// Kondisi bot/WhatsApp/Ollama/antrean untuk dialog "Status Sistem".
export function fetchSystemStatus(code) {
  return callChatFunction({ code, action: "system_status" });
}

// Target khatam Al-Qur'an (satu baris di server; lihat quran.js).
export function quranKhatamSet(code, { startDate, targetDays, startPage, reminder, khatamCount }) {
  const payload = { code, action: "quran_khatam_set", startDate, targetDays, startPage };
  if (typeof reminder === "boolean") payload.reminder = reminder;
  if (Number.isInteger(khatamCount)) payload.khatamCount = khatamCount;
  return callChatFunction(payload);
}

export function quranKhatamClear(code) {
  return callChatFunction({ code, action: "quran_khatam_clear" });
}
