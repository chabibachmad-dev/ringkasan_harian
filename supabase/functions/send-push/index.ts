// Edge Function terpisah untuk kirim push secara manual (mis. untuk testing
// "apakah notifikasi ke iPhone-ku benar-benar jalan" tanpa harus tunggu jam 20:00).
//
// Contoh test manual:
//   curl -X POST https://<project-ref>.supabase.co/functions/v1/send-push \
//     -H "Authorization: Bearer <ANON_ATAU_SERVICE_ROLE_KEY>" \
//     -H "x-cron-secret: <CRON_SECRET_KAMU>" \
//     -H "Content-Type: application/json" \
//     -d '{"title":"Tes notifikasi","body":"Halo dari Ringkasan Harian!"}'

import { corsHeaders } from "../_shared/cors.ts";
import { sendPushToAllSubscribers } from "../_shared/send-push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  if (cronSecret && providedSecret !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized: x-cron-secret salah/hilang" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const title = body.title || "Tes notifikasi Ringkasan Harian";
    const bodyText = body.body || "Kalau kamu terima ini, push notification-nya berfungsi 🎉";

    // url opsional (dipakai bot saat jawaban Ollama selesai -> buka obrolannya).
    // Hanya jalur relatif ke aplikasi sendiri yang diterima ("./#d/..." atau "/..."),
    // supaya notifikasi tidak bisa diarahkan ke situs lain.
    const rawUrl = typeof body.url === "string" ? body.url : "";
    const url = /^(\.\/|\/)[0-9A-Za-z#\/_.\-?=&%:]*$/.test(rawUrl) && !rawUrl.startsWith("//") ? rawUrl : "./";
    const tag = typeof body.tag === "string" ? body.tag.slice(0, 64) : undefined;

    const result = await sendPushToAllSubscribers({ title, body: bodyText, url, tag });

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
