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
