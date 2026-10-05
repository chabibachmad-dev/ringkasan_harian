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
//     -> { ok: true, chats: [{ jid, name, lastContent, lastDirection, lastStatus, lastAt, autoReplyEnabled }, ...] }
//     (satu entri per nomor/grup WA yang PERNAH ada pesannya, diurut dari
//     aktivitas terbaru oleh klien -- lihat main.js.)
//   { "code": "...", "action": "history", "jid": "..." }
//     -> { ok: true, messages: [{ id, direction, content, status, created_at }, ...], autoReplyEnabled }
//   { "code": "...", "action": "send", "jid": "...", "message": "..." }
//     -> { ok: true, id: "..." }
//     (insert baris baru status='pending' -- BELUM benar-benar terkirim,
//     nunggu bot polling & proses. Klien bisa cek status via "history"
//     lagi kalau mau tahu sudah 'sent'/'failed'.)
//   { "code": "...", "action": "set_auto_reply", "jid": "...", "enabled": true|false }
//     -> { ok: true }
//     (atur toggle auto-reply AI KHUSUS nomor ini -- lihat tabel
//     whatsapp_contacts & cara wa-bot/index.js membacanya sebelum generate
//     balasan. Tidak ada baris = dianggap enabled=true/default ON.)
//   { "code": "...", "action": "qr_list" }
//     -> { ok: true, replies: [{ id, title, keywords, reply, enabled, use_count, last_used_at }, ...] }
//     (template jawaban otomatis -- tabel wa_quick_replies, lihat
//     migrations/0013. Pesan WA masuk yang cocok dgn kata kunci template
//     dijawab LANGSUNG dari template, AI tidak dipanggil.)
//   { "code": "...", "action": "qr_save", "id"?: "...", "title": "...", "keywords": ["...", ...], "reply": "...", "enabled"?: bool }
//     -> { ok: true, id: "..." }
//     (tanpa "id" = buat baru; dgn "id" = ubah template yang ada.)
//   { "code": "...", "action": "qr_delete", "id": "..." }
//     -> { ok: true }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_QR_TITLE_LENGTH = 100;
const MAX_QR_KEYWORDS = 20;
const MAX_QR_KEYWORD_LENGTH = 60;
const MAX_QR_REPLY_LENGTH = 3000;

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
    enabled?: boolean;
    id?: string;
    title?: string;
    keywords?: string[] | string;
    reply?: string;
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

    // Toggle auto-reply per kontak (lihat 0012_whatsapp_contacts.sql) --
    // tidak ada baris = dianggap enabled=true/default ON.
    const { data: contactRows } = await supabaseAdmin.from("whatsapp_contacts").select("wa_jid, auto_reply_enabled");
    const autoReplyByJid: Record<string, boolean> = {};
    for (const row of contactRows ?? []) autoReplyByJid[row.wa_jid] = row.auto_reply_enabled;

    const list = Object.values(chats).map((c) => ({
      ...c,
      name: c.name ?? nameByJid[c.jid] ?? null,
      autoReplyEnabled: autoReplyByJid[c.jid] ?? true
    }));
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

    const { data: contactRow } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("auto_reply_enabled")
      .eq("wa_jid", jid)
      .maybeSingle();

    return json({ ok: true, messages: data ?? [], autoReplyEnabled: contactRow?.auto_reply_enabled ?? true });
  }

  if (body.action === "set_auto_reply") {
    const jid = typeof body.jid === "string" ? body.jid : "";
    const enabled = body.enabled;
    if (!jid) return json({ ok: false, error: "jid wajib diisi." }, 400);
    if (typeof enabled !== "boolean") return json({ ok: false, error: "enabled wajib true/false." }, 400);

    const { error } = await supabaseAdmin
      .from("whatsapp_contacts")
      .upsert({ wa_jid: jid, auto_reply_enabled: enabled, updated_at: new Date().toISOString() });
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true });
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

  if (body.action === "qr_list") {
    const { data, error } = await supabaseAdmin
      .from("wa_quick_replies")
      .select("id, title, keywords, reply, enabled, use_count, last_used_at")
      .order("created_at", { ascending: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, replies: data ?? [] });
  }

  if (body.action === "qr_save") {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const reply = typeof body.reply === "string" ? body.reply.trim() : "";
    // Kata kunci boleh dikirim sbg array ATAU string dipisah koma/baris baru.
    const rawKeywords = Array.isArray(body.keywords)
      ? body.keywords
      : typeof body.keywords === "string"
        ? body.keywords.split(/[,\n]/)
        : [];
    const keywords = [...new Set(rawKeywords.map((k) => (typeof k === "string" ? k.trim() : "")).filter(Boolean))];

    if (!title) return json({ ok: false, error: "Judul template wajib diisi." }, 400);
    if (title.length > MAX_QR_TITLE_LENGTH) return json({ ok: false, error: `Judul maksimal ${MAX_QR_TITLE_LENGTH} karakter.` }, 400);
    if (keywords.length === 0) return json({ ok: false, error: "Isi minimal satu kata kunci." }, 400);
    if (keywords.length > MAX_QR_KEYWORDS) return json({ ok: false, error: `Maksimal ${MAX_QR_KEYWORDS} kata kunci.` }, 400);
    if (keywords.some((k) => k.length > MAX_QR_KEYWORD_LENGTH)) {
      return json({ ok: false, error: `Tiap kata kunci maksimal ${MAX_QR_KEYWORD_LENGTH} karakter.` }, 400);
    }
    if (!reply) return json({ ok: false, error: "Isi jawaban template wajib diisi." }, 400);
    if (reply.length > MAX_QR_REPLY_LENGTH) return json({ ok: false, error: `Jawaban maksimal ${MAX_QR_REPLY_LENGTH} karakter.` }, 400);

    const fields: Record<string, unknown> = { title, keywords, reply, updated_at: new Date().toISOString() };
    if (typeof body.enabled === "boolean") fields.enabled = body.enabled;

    if (typeof body.id === "string" && body.id) {
      const { data, error } = await supabaseAdmin.from("wa_quick_replies").update(fields).eq("id", body.id).select("id").maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "Template tidak ditemukan." }, 404);
      return json({ ok: true, id: data.id });
    }

    const { data, error } = await supabaseAdmin.from("wa_quick_replies").insert(fields).select("id").single();
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, id: data?.id });
  }

  if (body.action === "qr_delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return json({ ok: false, error: "id wajib diisi." }, 400);
    const { error } = await supabaseAdmin.from("wa_quick_replies").delete().eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  return json(
    {
      ok: false,
      error:
        "action tidak dikenal (pakai 'list_chats', 'history', 'send', 'set_auto_reply', 'qr_list', 'qr_save', atau 'qr_delete')."
    },
    400
  );
});
