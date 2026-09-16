// Edge Function untuk menyimpan Web Push subscription dari browser/PWA.
//
// Kenapa ini perlu jadi Edge Function (bukan insert langsung dari frontend
// pakai anon key)? Karena aplikasi pakai UPSERT (ON CONFLICT DO UPDATE) untuk
// tabel push_subscriptions, dan menurut dokumentasi resmi Postgres, UPSERT
// dengan ON CONFLICT DO UPDATE selalu butuh izin SELECT pada tabel target —
// walau baris itu baru pertama kali di-insert. Kalau kita kasih anon izin
// SELECT ke tabel ini, semua orang bisa baca endpoint+keys push subscription
// orang lain (bisa disalahgunakan buat spam notifikasi ke HP orang). Jadi
// solusinya: anon TIDAK dikasih izin baca/tulis langsung sama sekali ke tabel
// ini (lihat migrations/0003), dan semua penyimpanan lewat function ini yang
// jalan pakai service_role (otomatis bypass RLS).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await req.json();
  } catch (_err) {
    return new Response(JSON.stringify({ ok: false, error: "Body harus JSON valid" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;

  if (!endpoint || typeof endpoint !== "string" || !p256dh || !auth) {
    return new Response(
      JSON.stringify({ ok: false, error: "Payload tidak lengkap: butuh endpoint, keys.p256dh, keys.auth" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
    {
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent") || null,
      last_seen_at: new Date().toISOString()
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("Gagal simpan subscription:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
