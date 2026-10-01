// Klien buat fitur diskusi/chat pribadi -- semua request lewat Edge
// Function `chat` (lihat supabase/functions/chat/index.ts), karena
// tabel chat_messages dikunci total dari anon key.

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
        message: data.error || `HTTP ${res.status}`
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

export function sendChatMessage(date, code, message) {
  return callChatFunction({ code, date, action: "send", message });
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

// Simpan status sematan (pin) dan/atau judul custom satu obrolan ke SERVER
// -- supaya "Sematkan" dan "Ubah judul" ikut sinkron ke semua perangkat
// dengan kode akses yang sama (sebelumnya cuma localStorage per perangkat).
// Cuma kirim field yang berubah: field yang tidak disertakan tidak akan
// diubah di server. title: null/"" berarti "pakai judul default lagi".
export function setThreadMeta(id, code, { pinned, title } = {}) {
  const payload = { code, date: id, action: "set_thread_meta" };
  if (typeof pinned === "boolean") payload.pinned = pinned;
  if (title !== undefined) payload.title = title;
  return callChatFunction(payload);
}

// Hapus semua pesan di satu obrolan -- dipakai oleh menu titik-3
// "Hapus chat".
export function deleteChatThread(date, code) {
  return callChatFunction({ code, date, action: "delete" });
}