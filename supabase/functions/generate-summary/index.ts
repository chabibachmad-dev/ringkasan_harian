// Edge Function utama: dipanggil otomatis oleh pg_cron tiap hari jam 20:00 WITA.
// Alur: ambil RSS (dunia + Indonesia) -> rangkum pakai Gemini API -> simpan ke
// tabel `summaries` -> kirim push notification ke semua device yang subscribe.
//
// Test manual (dari terminal kamu sendiri):
//   curl -X POST https://<project-ref>.supabase.co/functions/v1/generate-summary \
//     -H "Authorization: Bearer <ANON_ATAU_SERVICE_ROLE_KEY>" \
//     -H "x-cron-secret: <CRON_SECRET_KAMU>"

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { FEED_SOURCES, MAX_ITEMS_PER_FEED, MAX_AGE_HOURS } from "../_shared/rss-sources.ts";
import { fetchFeed, type RawItem } from "../_shared/rss-parser.ts";
import { generateSummary, type NewsItem } from "../_shared/gemini.ts";
import { sendPushToAllSubscribers } from "../_shared/send-push.ts";

function isRecentEnough(pubDate: string | null): boolean {
  if (!pubDate) return true; // kalau feed tidak kasih tanggal, tetap ikutkan drpd dibuang
  const t = new Date(pubDate).getTime();
  if (Number.isNaN(t)) return true;
  const ageHours = (Date.now() - t) / (1000 * 60 * 60);
  return ageHours <= MAX_AGE_HOURS;
}

async function collectNewsItems(): Promise<NewsItem[]> {
  const results = await Promise.all(
    FEED_SOURCES.map(async (source) => {
      const rawItems: RawItem[] = await fetchFeed(source.url);
      return rawItems
        .filter((it) => isRecentEnough(it.pubDate))
        .slice(0, MAX_ITEMS_PER_FEED)
        .map((it) => ({ ...it, source: source.name, category: source.category, link: it.link }));
    })
  );

  const flat = results.flat();

  // Dedupe kasar berdasarkan judul (huruf kecil, tanpa spasi berlebih) —
  // beberapa media suka memuat ulang judul yang sama persis dari kantor berita.
  const seen = new Set<string>();
  const deduped = flat.filter((it) => {
    const key = it.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.map((it, idx) => ({
    id: idx + 1,
    title: it.title,
    description: it.description || "",
    source: it.source,
    category: it.category,
    link: it.link
  }));
}

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Tanggal "hari ini" dihitung di zona waktu Asia/Makassar (WITA, UTC+8),
  // supaya konsisten dengan jam pemicu 20:00 WITA meskipun server jalan di UTC.
  const todayWita = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY belum di-set sebagai Supabase secret.");
    }

    const items = await collectNewsItems();

    if (items.length === 0) {
      throw new Error("Semua sumber RSS gagal diambil atau tidak ada berita baru dalam 30 jam terakhir.");
    }

    const summary = await generateSummary(items, geminiApiKey);

    const contentId = `## 🇮🇩 Indonesia\n\n${summary.indonesia_id}\n\n## 🌍 Dunia\n\n${summary.dunia_id}`;
    const contentEn = `## 🇮🇩 Indonesia\n\n${summary.indonesia_en}\n\n## 🌍 World\n\n${summary.dunia_en}`;

    const sources = items.map((it) => ({
      title: it.title,
      url: it.link,
      source: it.source,
      category: it.category
    }));

    const { error: upsertError } = await supabaseAdmin
      .from("summaries")
      .upsert(
        {
          summary_date: todayWita,
          content_id: contentId,
          content_en: contentEn,
          sources,
          model: Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash",
          status: "ok",
          error: null
        },
        { onConflict: "summary_date" }
      );

    if (upsertError) throw new Error(`Gagal simpan ke database: ${upsertError.message}`);

    let pushResult = { sent: 0, removed: 0, failed: 0 };
    try {
      pushResult = await sendPushToAllSubscribers({
        title: "Ringkasan Harian sudah siap 📰",
        body: "Ringkasan berita dunia & Indonesia hari ini sudah bisa dibaca.",
        url: "/"
      });
    } catch (pushErr) {
      // Ringkasan tetap tersimpan walau pengiriman push gagal — jangan
      // sampai kegagalan notifikasi bikin seluruh function dianggap error.
      console.error("Gagal kirim push notification:", pushErr);
    }

    return new Response(
      JSON.stringify({ ok: true, date: todayWita, items_count: items.length, push: pushResult }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("generate-summary error:", message);

    // Simpan juga baris "failed" supaya kelihatan di riwayat kalau ada hari yang gagal,
    // daripada diam-diam bolong tanpa jejak.
    const { error: failedUpsertError } = await supabaseAdmin.from("summaries").upsert(
      {
        summary_date: todayWita,
        content_id: "Ringkasan gagal dibuat hari ini. Perlu cek log Edge Function generate-summary.",
        content_en: "Failed to generate today's summary. Check the generate-summary Edge Function logs.",
        sources: [],
        status: "failed",
        error: message
      },
      { onConflict: "summary_date" }
    );
    if (failedUpsertError) console.error("Gagal simpan status failed:", failedUpsertError.message);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
