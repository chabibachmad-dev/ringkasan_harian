// Edge Function untuk fitur "WhatsApp di dalam aplikasi" -- baca & balas
// chat WhatsApp pribadi langsung dari aplikasi ini.
//
// PENTING: function ini TIDAK pernah bicara langsung ke WhatsApp. Yang
// benar-benar nyambung ke WhatsApp adalah bot Node.js terpisah (folder
// wa-bot/ di root repo, JALAN TERUS-MENERUS di laptop user -- lihat komentar
// panjang di migrations/0011_whatsapp_messages.sql buat alasan kenapa ini
// tidak bisa jadi Edge Function biasa). Function ini cuma baca/tulis tabel
// whatsapp_messages, yang jadi "jembatan" antara aplikasi & bot:
//   - Pesan WA MASUK: bot yang insert duluan (status='received'), function
//     ini cuma BACA.
//   - Pesan mau DIKIRIM: function ini insert (status='pending'), nanti bot
//     yang polling & beneran ngirim lewat WhatsApp, baru update jadi 'sent'.
//
// Sama seperti Edge Function `chat`: dikunci pakai CHAT_ACCESS_CODE yang
// SAMA (satu aplikasi, satu pemilik, satu kode akses buat semua fitur
// pribadi di dalamnya).
//
// Body request (semua action):
//   { "code": "...", "action": "list_chats" }
//     -> { ok: true, chats: [{ jid, name, lastContent, lastDirection, lastStatus, lastAt }, ...] }
//     (satu entri per nomor/grup WA yang PERNAH ada pesannya, diurut dari
//     aktivitas terbaru oleh klien -- lihat main.js.)
//   { "code": "...", "action": "history", "jid": "..." }
//     -> { ok: true, messages: [{ id, direction, content, status, created_at }, ...] }
//   { "code": "...", "action": "send", "jid": "...", "message": "..." }
//     -> { ok: true, id: "..." }
//     (insert baris baru status='pending' -- BELUM benar-benar terkirim,
//     nunggu bot polling & proses. Klien bisa cek status via "history"
//     lagi kalau mau tahu sudah 'sent'/'failed'.)

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_MESSAGE_LENGTH = 4000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body: {
    code?: string;
    action?: string;
    jid?: string;
    message?: string;
  };
  try {
    body = await req.json();
  } catch (_err) {
    return json({ ok: false, error: "Body harus JSON valid" }, 400);
  }

  const expectedCode = Deno.env.get("CHAT_ACCESS_CODE");
  if (!expectedCode) {
    return json({ ok: false, error: "CHAT_ACCESS_CODE belum di-set sebagai Supabase secret." }, 500);
  }
  if (typeof body.code !== "string" || body.code !== expectedCode) {
    return json({ ok: false, error: "Kode akses salah." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "list_chats") {
    // Ambil SEMUA baris (dibatasi 5000, cukup buat pemakaian pribadi),
    // urut created_at MENURUN -- baris pertama yang ditemui per wa_jid
    // otomatis jadi pesan TERAKHIR-nya. wa_name diambil dari baris mana pun
    // yang kebetulan punya nilainya (push name WA bisa saja kosong di
    // sebagian pesan).
    const { data, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("wa_jid, wa_name, direction, content, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) return json({ ok: false, error: error.message }, 500);

    const chats: Record<
      string,
      { jid: string; name: string | null; lastContent: string; lastDirection: string; lastStatus: string; lastAt: string }
    > = {};
    const nameByJid: Record<string, string> = {};
    for (const row of data ?? []) {
      if (!chats[row.wa_jid]) {
        chats[row.wa_jid] = {
          jid: row.wa_jid,
          name: row.wa_name ?? null,
          lastContent: row.content,
          lastDirection: row.direction,
          lastStatus: row.status,
          lastAt: row.created_at
        };
      }
      if (row.wa_name && !nameByJid[row.wa_jid]) nameByJid[row.wa_jid] = row.wa_name;
    }
    const list = Object.values(chats).map((c) => ({ ...c, name: c.name ?? nameByJid[c.jid] ?? null }));
    return json({ ok: true, chats: list });
  }

  if (body.action === "history") {
    const jid = typeof body.jid === "string" ? body.jid : "";
    if (!jid) return json({ ok: false, error: "jid wajib diisi." }, 400);

    const { data, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, direction, content, status, error, created_at")
      .eq("wa_jid", jid)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, messages: data ?? [] });
  }

  if (body.action === "send") {
    const jid = typeof body.jid === "string" ? body.jid : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!jid) return json({ ok: false, error: "jid wajib diisi." }, 400);
    if (!message) return json({ ok: false, error: "Pesan tidak boleh kosong." }, 400);
    const trimmed = message.slice(0, MAX_MESSAGE_LENGTH);

    const { data, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert({ wa_jid: jid, direction: "out", content: trimmed, status: "pending" })
      .select("id")
      .single();
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, id: data?.id });
  }

  return json({ ok: false, error: "action tidak dikenal (pakai 'list_chats', 'history', atau 'send')." }, 400);
});