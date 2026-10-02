// Klien buat fitur "WhatsApp di dalam aplikasi" -- semua request lewat Edge
// Function `whatsapp` (lihat supabase/functions/whatsapp/index.ts), yang
// cuma baca/tulis tabel whatsapp_messages (dikunci total dari anon key).
// Yang beneran bicara ke WhatsApp adalah bot terpisah di wa-bot/ (lihat
// README.md di situ) -- function & klien ini cuma "jembatan"-nya.
//
// Dipakai kode akses yang SAMA dengan fitur Obrolan AI (lihat chat.js) --
// satu aplikasi, satu pemilik, satu kode buat semua fitur pribadi di
// dalamnya.

async function callWhatsappFunction(payload) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp`, {
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

// Daftar semua obrolan WA (satu entri per nomor/grup), diurut aktivitas
// terbaru oleh pemanggil (lihat renderWaList() di main.js).
export function listWaChats(code) {
  return callWhatsappFunction({ code, action: "list_chats" });
}

// Riwayat pesan SATU obrolan WA (jid = ID WhatsApp-nya, mis.
// "6281234567890@s.whatsapp.net").
export function fetchWaHistory(jid, code) {
  return callWhatsappFunction({ code, action: "history", jid });
}

// Kirim balasan -- INSERT status 'pending' dulu di server, belum tentu
// langsung terkirim (nunggu bot wa-bot/ polling & proses, lihat komentar di
// Edge Function-nya).
export function sendWaMessage(jid, message, code) {
  return callWhatsappFunction({ code, action: "send", jid, message });
}
