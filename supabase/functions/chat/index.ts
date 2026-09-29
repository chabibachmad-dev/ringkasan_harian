// Edge Function untuk fitur diskusi/chat pribadi.
//
// Kenapa ada "kode akses" (CHAT_ACCESS_CODE)? Karena situs ini publik --
// siapa saja yang tahu link GitHub Pages-nya bisa membukanya. Ringkasan
// berita memang sengaja terbuka untuk semua orang, tapi isi chat/diskusi
// ini pribadi, jadi tabelnya dikunci total dari anon (lihat migrations/
// 0004_chat.sql) dan function ini menolak semua request yang kodenya
// salah/tidak ada, sebelum menyentuh database atau memanggil Gemini.
//
// Body request (semua action):
//   { "code": "...", "date": "YYYY-MM-DD", "action": "history" }
//     -> { ok: true, messages: [{ role, content, created_at }, ...] }
//   { "code": "...", "date": "YYYY-MM-DD", "action": "send", "message": "..." }
//     -> { ok: true, reply: "..." }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { generateChatReply, type ChatMessage } from "../_shared/gemini.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_FOR_CONTEXT = 40;

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

  let body: { code?: string; date?: string; action?: string; message?: string };
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

  if (typeof body.date !== "string" || !DATE_RE.test(body.date)) {
    return json({ ok: false, error: "Tanggal tidak valid (format YYYY-MM-DD)." }, 400);
  }
  const date = body.date;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "history") {
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("chat_date", date)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, messages: data ?? [] });
  }

  if (body.action === "send") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return json({ ok: false, error: "Pesan tidak boleh kosong." }, 400);
    }
    const trimmed = message.slice(0, MAX_MESSAGE_LENGTH);

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return json({ ok: false, error: "GEMINI_API_KEY belum di-set sebagai Supabase secret." }, 500);
    }

    // Ambil riwayat hari ini dulu buat konteks percakapan.
    const { data: historyRows, error: historyErr } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content")
      .eq("chat_date", date)
      .order("created_at", { ascending: true })
      .limit(MAX_HISTORY_FOR_CONTEXT);

    if (historyErr) return json({ ok: false, error: historyErr.message }, 500);

    const history: ChatMessage[] = (historyRows ?? []).map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content as string
    }));
    history.push({ role: "user", content: trimmed });

    // Simpan pesan dari pengguna dulu, sebelum manggil Gemini -- supaya
    // riwayat tetap tersimpan walau balasan AI-nya gagal/timeout.
    const { error: insertUserErr } = await supabaseAdmin
      .from("chat_messages")
      .insert({ chat_date: date, role: "user", content: trimmed });
    if (insertUserErr) return json({ ok: false, error: insertUserErr.message }, 500);

    let reply: string;
    try {
      reply = await generateChatReply(history, geminiApiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("chat: gagal dapat balasan Gemini:", msg);
      return json({ ok: false, error: `Gagal dapat balasan AI: ${msg}` }, 502);
    }

    const { error: insertAssistantErr } = await supabaseAdmin
      .from("chat_messages")
      .insert({ chat_date: date, role: "assistant", content: reply });
    if (insertAssistantErr) return json({ ok: false, error: insertAssistantErr.message }, 500);

    return json({ ok: true, reply });
  }

  return json({ ok: false, error: "action tidak dikenal (pakai 'history' atau 'send')." }, 400);
});
