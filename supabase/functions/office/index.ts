// Edge Function untuk halaman "Kantor AI" di aplikasi: umpan kejadian langsung karyawan AI (bot WhatsApp, studio media, Agen Lokal).
//
// Dua jenis pemanggil:
//   1) Aplikasi (kode akses = CHAT_ACCESS_CODE, sama dengan fitur lain):
//        { code, action: "poll", since?: number }
//          -> { ok, events: [{id, at, who, kind, text, progress, to, item}], presence: [{who, online, ageSec, detail}],
//               approvals: [{id, who, detail, at}], last, replay }
//             Tanpa `since` = pertama kali: 40 kejadian terakhir (replay: true) supaya aplikasi bisa menyusun keadaan sekarang.
//        { code, action: "decide", id, ok: true|false }  -> { ok, status }   (jawab izin dari aplikasi)
//   2) Agen Lokal di Windows (kunci OFFICE_PUSH_KEY, Supabase secret; TANPA kode akses, hanya bisa menulis kejadian):
//        { key, action: "push", events: [...], beat?: { who, detail? } }      -> { ok, saved }
//        { key, action: "approval_status", id }                              -> { ok, status }
//        { key, action: "approval_resolve", id, status: "approved"|"denied"|"expired" } -> { ok, status }
//   Bot wa-bot (service role) menulis langsung ke tabel office_events/office_presence, tanpa fungsi ini.
//
// Fungsi ini dideploy tanpa verifikasi JWT (lihat supabase/config.toml) supaya Agen Lokal tidak perlu anon key;
// pengamannya kode akses / OFFICE_PUSH_KEY. Isi kejadian dibersihkan (redact) dan hanya ringkasan satu baris.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { APPROVAL_LIFETIME_MS, KEEP_DAYS, MAX_PUSH_EVENTS, cleanEvent, cutoffIso, livePending, presenceView, redact } from "../_shared/office-core.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_err) {
    return json({ ok: false, error: "Body harus JSON valid" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const action = String(body.action ?? "");
  const nowMs = Date.now();

  // ---------------------------------------------------------------- pemanggil agen (kunci tulis)
  if (action === "push" || action === "approval_status" || action === "approval_resolve") {
    const expected = Deno.env.get("OFFICE_PUSH_KEY");
    if (!expected) return json({ ok: false, error: "OFFICE_PUSH_KEY belum di-set sebagai Supabase secret." }, 500);
    if (typeof body.key !== "string" || !safeEqual(body.key, expected)) return json({ ok: false, error: "Kunci salah." }, 401);

    if (action === "push") {
      const list = Array.isArray(body.events) ? body.events.slice(0, MAX_PUSH_EVENTS) : [];
      const rows = [];
      const approvals = [];
      for (const e of list) {
        const c = cleanEvent(e);
        // Pemanggil agen hanya boleh menulis atas nama agen lokal (bukan menyamar sebagai bot lain).
        if (!c || c.row.who !== "agen") continue;
        rows.push(c.row);
        if (c.approval) approvals.push({ id: c.approval.id, who: "agen", detail: c.approval.detail });
      }
      if (approvals.length) {
        const { error } = await admin.from("office_approvals").upsert(approvals, { onConflict: "id", ignoreDuplicates: true });
        if (error) return json({ ok: false, error: error.message }, 500);
      }
      if (rows.length) {
        const { error } = await admin.from("office_events").insert(rows);
        if (error) return json({ ok: false, error: error.message }, 500);
      }
      const beat = body.beat as Record<string, unknown> | undefined;
      if (rows.length || (beat && beat.who === "agen")) {
        await admin.from("office_presence").upsert({ who: "agen", seen_at: new Date(nowMs).toISOString(), detail: redact(beat?.detail ?? "", 80) });
      }
      // bersih-bersih sesekali
      if (Math.random() < 0.02) {
        await admin.from("office_events").delete().lt("created_at", cutoffIso(nowMs, KEEP_DAYS));
        await admin.from("office_approvals").delete().lt("created_at", cutoffIso(nowMs, KEEP_DAYS));
      }
      return json({ ok: true, saved: rows.length });
    }

    const id = String(body.id ?? "");
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return json({ ok: false, error: "id tidak valid." }, 400);
    if (action === "approval_status") {
      const { data, error } = await admin.from("office_approvals").select("status, created_at").eq("id", id).maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: true, status: "unknown" });
      const expired = data.status === "pending" && nowMs - Date.parse(data.created_at) > APPROVAL_LIFETIME_MS;
      return json({ ok: true, status: expired ? "expired" : data.status });
    }
    const status = String(body.status ?? "");
    if (!["approved", "denied", "expired"].includes(status)) return json({ ok: false, error: "status tidak valid." }, 400);
    const { error } = await admin.from("office_approvals").update({ status, decided_at: new Date(nowMs).toISOString(), decided_by: "agen" }).eq("id", id).eq("status", "pending");
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, status });
  }

  // ---------------------------------------------------------------- pemanggil aplikasi (kode akses)
  const expectedCode = Deno.env.get("CHAT_ACCESS_CODE");
  if (!expectedCode) return json({ ok: false, error: "CHAT_ACCESS_CODE belum di-set sebagai Supabase secret." }, 500);
  if (typeof body.code !== "string" || !safeEqual(body.code, expectedCode)) return json({ ok: false, error: "Kode akses salah." }, 401);

  if (action === "poll") {
    const since = Number.isFinite(Number(body.since)) && body.since !== null && body.since !== undefined ? Math.max(0, Math.floor(Number(body.since))) : null;
    let q = admin.from("office_events").select("id, created_at, who, kind, text, progress, to_who, item, approval_id");
    q = since === null ? q.order("id", { ascending: false }).limit(40) : q.gt("id", since).order("id", { ascending: true }).limit(100);
    const { data, error } = await q;
    if (error) return json({ ok: false, error: error.message }, 500);
    const rows = (since === null ? [...(data ?? [])].reverse() : data ?? []) as Record<string, unknown>[];
    const events = rows.map((r) => ({ id: r.id, at: r.created_at, who: r.who, kind: r.kind, text: r.text, progress: r.progress, to: r.to_who, item: r.item }));
    const last = events.length ? Number(events[events.length - 1].id) : since ?? 0;

    const { data: pres } = await admin.from("office_presence").select("who, seen_at, detail");
    const { data: aps } = await admin.from("office_approvals").select("id, who, detail, status, created_at").eq("status", "pending");
    return json({
      ok: true,
      events,
      last,
      replay: since === null,
      presence: presenceView(pres ?? [], nowMs),
      approvals: livePending(aps ?? [], nowMs).map((a) => ({ id: a.id, who: a.who, detail: a.detail, at: a.created_at })),
      now: new Date(nowMs).toISOString()
    });
  }

  if (action === "decide") {
    const id = String(body.id ?? "");
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return json({ ok: false, error: "id tidak valid." }, 400);
    if (typeof body.ok !== "boolean") return json({ ok: false, error: "ok wajib true/false." }, 400);
    const status = body.ok ? "approved" : "denied";
    const { data, error } = await admin
      .from("office_approvals")
      .update({ status, decided_at: new Date(nowMs).toISOString(), decided_by: "app" })
      .eq("id", id)
      .eq("status", "pending")
      .select("who, detail")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: true, status: "gone" }); // sudah dijawab / kedaluwarsa
    await admin.from("office_events").insert({ who: data.who, kind: "say", text: redact(body.ok ? `Kamu mengizinkan: ${data.detail}` : `Kamu menolak: ${data.detail}`), approval_id: id });
    return json({ ok: true, status });
  }

  return json({ ok: false, error: "action tidak dikenal." }, 400);
});
