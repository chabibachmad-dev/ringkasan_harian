// Edge Function untuk fitur chat pribadi dengan asisten AI.
//
// Kenapa ada "kode akses" (CHAT_ACCESS_CODE)? Karena situs ini publik --
// siapa saja yang tahu link GitHub Pages-nya bisa membukanya. Isi
// obrolannya pribadi, jadi tabelnya dikunci total dari anon (lihat
// migrations/0004_chat.sql) dan function ini menolak semua request yang
// kodenya salah/tidak ada, sebelum menyentuh database atau memanggil Gemini.
//
// Body request (semua action) -- "date" di sini sebenarnya ID obrolan,
// dibuat otomatis client-side tiap kali user menekan tombol "+" (lihat
// main.js), formatnya selalu "freeform-<uuid>":
//   { "code": "...", "date": "freeform-<uuid>", "action": "history" }
//     -> { ok: true, messages: [{ role, content, created_at }, ...] }
//   { "code": "...", "date": "...", "action": "send", "message": "...", "agent"?: "auto"|"gemini"|"ollama" }
//     -> { ok: true, reply: "...", agent: "gemini" }                      (dijawab Gemini langsung)
//     -> { ok: true, pending: true, jobId, userMessageId, agent: "ollama" } (diantrekan ke Ollama di laptop;
//        klien lalu polling action "agent_job" sampai status "done")
//     agent "auto" (default) = Gemini dulu, kalau Gemini gagal & Ollama hidup -> otomatis diantrekan ke Ollama.
//     agent "ollama" ditolak (503, ollamaOffline: true) kalau laptop/bot/Ollama sedang tidak hidup.
//   { "code": "...", "action": "agent_job", "jobId": "<uuid>" }
//     -> { ok: true, status: "pending"|"running"|"done"|"failed", progress, error, reply?, assistantMessageId?, agent, fallbackFrom }
//   { "code": "...", "date": "...", "action": "attachment_add", "name": "x.pdf", "content": "<teks>" }
//     -> { ok: true, attachment: { id, name, charCount } }   (lampiran obrolan; teks diekstrak di browser)
//   { "code": "...", "date": "...", "action": "attachment_delete", "id": "<uuid>" }  -> { ok: true }
//     history juga mengembalikan attachments: [{ id, name, charCount }]
//   { "code": "...", "action": "system_status" }
//     -> { ok: true, worker: {...}, jobs: { pending, running, done24h, failed24h, avgSeconds, recent: [...] } }
//   { "code": "...", "action": "agent_status" }
//     -> { ok: true, ollama: { online, ollamaOk, model, busy, lastSeenMs } }
//   { "code": "...", "action": "last_messages", "dates": ["...", ...] }
//     -> { ok: true, lastMessages: { "<id>": { role, content, created_at }, ... } }
//     (dipakai buat cuplikan/preview di layar daftar obrolan)
//   { "code": "...", "date": "...", "action": "delete" }
//     -> { ok: true, deleted: <jumlah baris> }
//     (hapus semua chat_messages buat obrolan ini -- dipakai menu titik-3
//     "Hapus chat".)
//   { "code": "...", "action": "list_threads" }
//     -> { ok: true, threads: [{ id, createdAt, lastAt, pinned, saved, title, useKb, agent }, ...],
//          retention: { days, activeSince } }
//     (saved = tanda "Saved": obrolan tanpa tanda ini dihapus otomatis bila pesan
//     terakhirnya lebih tua dari retention.days hari -- lihat migrations/0018 &
//     purgeOldChats() di bawah. Penghapusan juga dijalankan tiap kali action ini dipanggil.)
//     (semua ID obrolan yang PERNAH punya minimal 1 pesan, diambil dari
//     server -- bukan dari localStorage perangkat. Dipakai supaya daftar
//     obrolan ikut muncul walau dibuka dari perangkat lain dengan kode akses
//     yang sama, karena kode aksesnya memang satu untuk semua perangkat.
//     pinned/title/useKb diambil dari tabel chat_thread_meta supaya status
//     sematan, judul custom, & toggle Dokumen Pengetahuan ikut sinkron ke
//     semua perangkat juga.)
//   { "code": "...", "date": "...", "action": "set_thread_meta", "pinned"?: bool, "saved"?: bool, "title"?: string|null, "useKb"?: bool, "agent"?: "auto"|"gemini"|"ollama" }
//     -> { ok: true, pinned: bool, saved: bool, title: string|null, useKb: bool, agent: string }
//     (simpan status sematan (pin), judul custom, dan/atau toggle "pakai
//     Dokumen Pengetahuan" satu obrolan ke tabel chat_thread_meta -- kirim
//     cuma field yang berubah, field yang tidak dikirim tidak akan diubah.
//     title null/kosong berarti "pakai judul default lagi". useKb default
//     false (lihat migrations/0010) -- SENGAJA opt-in per obrolan, supaya
//     Dokumen Pengetahuan [TOTAL bisa sampai 600rb karakter/±150rb token]
//     tidak otomatis disisipkan ke SEMUA obrolan di SETIAP pesan, yang
//     sebelumnya jadi penyebab utama token/biaya Gemini membengkak drastis.)
//   { "code": "...", "date": "...", "action": "delete_message", "id": "..." }
//     -> { ok: true }
//     (hapus SATU pesan -- dipakai menu titik-3 per-pesan di dalam obrolan,
//     opsi "Hapus pesan". Sengaja dibatasi role = 'user' di query-nya: cuma
//     pesan dari pengguna sendiri yang boleh dihapus satuan, supaya riwayat
//     balasan AI tidak bisa "disunat" sepihak dari sisi klien.)
//   { "code": "...", "action": "token_usage" }
//     -> { ok: true, tokensUsedToday: <jumlah token> }
//     (perkiraan token Gemini terpakai HARI INI, zona waktu Pasifik -- sama
//     seperti jadwal reset kuota gratis Gemini. Sengaja TIDAK mewajibkan
//     kode akses yang BENAR [lihat pengecekan di bawah] karena isinya cuma
//     angka, bukan isi chat pribadi -- supaya bisa ditampilkan di footer
//     layar daftar.)
//   { "code": "...", "action": "key_status" }
//     -> { ok: true, dailyLimit, resetAtMs, keys: [{ hint, requests, exhausted, exhaustedKind, exhaustedUntilMs, lastError }, ...] }
//     (status tiap API key Gemini hari ini, zona Pasifik: jumlah request yang
//     TERCATAT sistem ini (bot WA + chat aplikasi), apakah lagi habis kuota,
//     dan kapan reset. Hanya 4 karakter TERAKHIR key yang pernah keluar dari
//     server (hint) -- key aslinya tidak pernah dikirim ke klien. Dibaca dari
//     tabel gemini_key_usage, lihat migrations/0013.)
//
// --- "Dokumen Pengetahuan" (Pengaturan > Upload Dokumen) ---
// Teks PDF-nya diekstrak DI BROWSER (lihat src/pdfText.js) sebelum dikirim
// ke sini -- Edge Function ini cuma simpan/baca teksnya, TIDAK ada library
// PDF di sisi server sama sekali. Isi tabel knowledge_documents disertakan
// sebagai konteks tambahan ke Gemini tiap kali action "send" dipanggil,
// supaya AI bisa jawab dari dokumen yang diupload pengguna duluan sebelum
// (atau alih-alih) cari di web -- cocok buat dipakai sebagai referensi
// peraturan/perundangan yang sering dipakai berulang.
//   { "code": "...", "action": "kb_list" }
//     -> { ok: true, documents: [{ id, title, char_count, original_filename, uploaded_at }, ...] }
//   { "code": "...", "action": "kb_upload", "title": "...", "content": "...", "filename"?: "..." }
//     -> { ok: true, document: { id, title, char_count, original_filename, uploaded_at } }
//   { "code": "...", "action": "kb_delete", "id": "..." }
//     -> { ok: true }
//   Upload file MENTAH (PDF/txt/md/csv, sampai 50 MB; diproses bot di laptop,
//   lihat migrations/0017 + wa-bot/kb-ingest.js):
//   { "code": "...", "action": "kb_upload_url", "title": "...", "filename": "x.pdf", "size": 123 }
//     -> { ok: true, document, upload: { path, token } }  (browser lalu upload ke
//        bucket kb-inbox dengan uploadToSignedUrl(path, token, file))
//   { "code": "...", "action": "kb_upload_done", "id": "..." }  -> status 'queued'
//   { "code": "...", "action": "kb_retry", "id": "..." }        -> ulangi yang 'error'
//
// --- Al-Qur'an (halaman Pengaturan > Al-Qur'an; tabel di migrations/0014) ---
//   { "code": "...", "action": "quran_sync" }
//     -> { ok: true, lastRead: { surah, ayah, page, updated_at } | null,
//          bookmarks: [{ surah, ayah, page, created_at }, ...] }
//   { "code": "...", "action": "quran_set_last_read", "surah": 2, "ayah": 255, "page": 42 }
//   { "code": "...", "action": "quran_add_bookmark", "surah": 2, "ayah": 255, "page": 42 }  (idempotent)
//   { "code": "...", "action": "quran_delete_bookmark", "surah": 2, "ayah": 255 }
//     -> { ok: true }
//   { "code": "...", "action": "quran_khatam_set", "startDate": "2026-10-06", "targetDays": 30, "startPage": 1, "reminder"?: bool, "khatamCount"?: n }
//   { "code": "...", "action": "quran_khatam_clear" }
//     -> { ok: true, khatam }    (quran_sync juga mengembalikan khatam: {startDate,targetDays,startPage,reminder,khatamCount} | null)

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildKbQuery, selectKnowledgeChunks, wantsWholeDocument } from "../_shared/knowledge.ts";
import { requestLaptopChunks } from "../_shared/laptop-kb.ts";
import { getFallbackChain } from "../_shared/llm-fallback.ts";
import { guardDocAnswer } from "../_shared/docguard.ts";
import {
  generateChatReply,
  geminiKeyHint,
  getGeminiApiKeys,
  setGeminiKeyReporter,
  type ChatMessage
} from "../_shared/gemini.ts";

// ID obrolan dibuat client-side sebagai `freeform-<uuid>` (lihat main.js).
const FREEFORM_RE = /^freeform-[0-9a-fA-F-]{36}$/;
function isValidThreadId(id: string): boolean {
  return FREEFORM_RE.test(id);
}
// Hapus otomatis obrolan lama yang tidak bertanda Saved (fungsi SQL purge_old_chats,
// migrations/0018). Dijalankan paling sering sekali per 10 menit per instance; gagal
// (mis. migrasi belum dijalankan) tidak boleh mengganggu request.
let lastPurgeAt = 0;
// deno-lint-ignore no-explicit-any
async function purgeOldChats(admin: any) {
  const nowMs = Date.now();
  if (nowMs - lastPurgeAt < 10 * 60_000) return;
  lastPurgeAt = nowMs;
  try {
    const { error } = await admin.rpc("purge_old_chats");
    if (error) console.warn("purge_old_chats gagal:", error.message);
  } catch (err) {
    console.warn("purge_old_chats error:", err);
  }
}
const MAX_MESSAGE_LENGTH = 4000;
// Lampiran file per obrolan (teks hasil ekstrak di browser).
const MAX_ATTACHMENT_CHARS = 300_000;
const MAX_ATTACHMENTS_PER_THREAD = 3;
const MAX_HISTORY_FOR_CONTEXT = 40;

// Kuota harian GRATIS Gemini reset berdasarkan tengah malam waktu Pasifik
// (Los Angeles) -- lihat https://ai.google.dev/gemini-api/docs/rate-limits --
// jadi hitungan "token terpakai hari ini" di action "send"/"token_usage"
// sengaja ikut zona itu juga (BUKAN WITA) supaya angkanya selaras dengan
// kapan kuota benar-benar reset, walau cuma estimasi ditampilkan di footer.
function getPacificDateString(): string {
  // en-CA format tanggalnya "YYYY-MM-DD" -- pas buat kolom `date` Postgres.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// ---------------- Agen lokal (Ollama di laptop) ----------------
type AgentName = "auto" | "gemini" | "ollama";
function parseAgent(v: unknown): AgentName {
  return v === "gemini" || v === "ollama" || v === "auto" ? v : "auto";
}
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Worker dianggap hidup kalau denyutnya < 60 detik lalu (bot kirim tiap ~15 dtk).
const WORKER_ALIVE_MS = 60_000;
// Job 'pending' yang tidak diambil bot selama ini dianggap gagal; 'running'
// yang menggantung lebih lama dari ini juga (bot mati di tengah jalan).
const JOB_PENDING_MAX_MS = 10 * 60_000;
const JOB_RUNNING_MAX_MS = 25 * 60_000;

// deno-lint-ignore no-explicit-any
async function getWorkerStatus(db: any) {
  const { data } = await db
    .from("agent_worker_status")
    .select("last_seen, ollama_ok, model, busy, detail")
    .eq("id", "ollama")
    .maybeSingle();
  const lastSeenMs = data?.last_seen ? new Date(data.last_seen as string).getTime() : 0;
  const fresh = lastSeenMs > 0 && Date.now() - lastSeenMs < WORKER_ALIVE_MS;
  return {
    online: fresh && !!data?.ollama_ok,
    botAlive: fresh,
    ollamaOk: !!data?.ollama_ok,
    model: (data?.model as string | null) ?? null,
    busy: !!data?.busy,
    detail: (data?.detail as string | null) ?? null,
    lastSeenMs: lastSeenMs || null
  };
}

function offlineMessage(w: { botAlive: boolean; ollamaOk: boolean }): string {
  if (!w.botAlive) return "Ollama tidak tersedia: bot di laptop sedang tidak aktif (cek pm2 di laptop).";
  if (!w.ollamaOk) return "Ollama tidak tersedia: bot aktif tapi server Ollama tidak menjawab (jalankan \"ollama serve\" di laptop).";
  return "Ollama tidak tersedia.";
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
    date?: string;
    dates?: string[];
    action?: string;
    message?: string;
    pinned?: boolean;
    title?: string | null;
    useKb?: boolean;
    agent?: string;
    jobId?: string;
    name?: string;
    startDate?: string;
    targetDays?: number;
    startPage?: number;
    reminder?: boolean;
    khatamCount?: number;
    content?: string;
    filename?: string;
    id?: string;
    surah?: number;
    ayah?: number;
    page?: number;
    saved?: boolean;
    size?: number;
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // "token_usage" sengaja diletakkan SEBELUM pengecekan kode akses --
  // isinya cuma angka perkiraan pemakaian token (bukan isi chat pribadi),
  // supaya bisa ditampilkan di footer layar daftar walau kode akses belum
  // dimasukkan sama sekali.
  if (body.action === "token_usage") {
    const today = getPacificDateString();
    const { data, error } = await supabaseAdmin
      .from("token_usage")
      .select("total_tokens, total_cost_usd")
      .eq("usage_date", today)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    // total_cost_usd kolom `numeric` -- PostgREST mengembalikannya sebagai
    // STRING (bukan number JS), jadi WAJIB di-Number()-kan dulu di sini.
    return json({ ok: true, tokensUsedToday: data?.total_tokens ?? 0, costUsedToday: Number(data?.total_cost_usd ?? 0) });
  }

  if (typeof body.code !== "string" || body.code !== expectedCode) {
    return json({ ok: false, error: "Kode akses salah." }, 401);
  }

  if (body.action === "last_messages") {
    const dates = Array.isArray(body.dates) ? body.dates.filter((d) => isValidThreadId(d)) : [];
    if (dates.length === 0) {
      return json({ ok: true, lastMessages: {} });
    }

    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("chat_date, role, content, created_at")
      .in("chat_date", dates)
      .order("chat_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(dates.length * 20);

    if (error) return json({ ok: false, error: error.message }, 500);

    // Baris pertama yang ditemui untuk tiap chat_date sudah pasti yang
    // terbaru, karena query di atas diurutkan created_at menurun per tanggal.
    const lastMessages: Record<string, { role: string; content: string; created_at: string }> = {};
    for (const row of data ?? []) {
      if (!lastMessages[row.chat_date]) {
        lastMessages[row.chat_date] = { role: row.role, content: row.content, created_at: row.created_at };
      }
    }
    return json({ ok: true, lastMessages });
  }

  if (body.action === "list_threads") {
    await purgeOldChats(supabaseAdmin);
    // Ambil chat_date + created_at SEMUA baris, urut dari paling lama --
    // baris pertama yang ditemui per chat_date otomatis jadi "pesan
    // pertama"-nya, dipakai sebagai createdAt thread itu. Dibatasi 5000 baris
    // supaya query tidak membengkak kalau riwayatnya sudah sangat panjang
    // (lebih dari cukup untuk pemakaian pribadi).
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("chat_date, created_at")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (error) return json({ ok: false, error: error.message }, 500);

    const firstSeen: Record<string, string> = {};
    const lastSeen: Record<string, string> = {};
    for (const row of data ?? []) {
      if (!firstSeen[row.chat_date]) firstSeen[row.chat_date] = row.created_at;
      lastSeen[row.chat_date] = row.created_at; // urut menaik: yang terakhir ditemui = terbaru
    }
    const ids = Object.keys(firstSeen).filter((id) => isValidThreadId(id));

    // Ambil status sematan (pin), judul custom, & toggle Dokumen Pengetahuan
    // semua thread ini sekaligus -- supaya pin/rename/toggle yang dilakukan
    // dari PERANGKAT LAIN ikut kebawa ke sini juga (sebelumnya cuma
    // tersimpan di localStorage per perangkat).
    const metaById: Record<string, { pinned: boolean; saved: boolean; title: string | null; useKb: boolean; agent: AgentName }> = {};
    if (ids.length > 0) {
      let { data: metaRows, error: metaErr } = await supabaseAdmin
        .from("chat_thread_meta")
        .select("id, pinned, saved, title, use_kb, agent")
        .in("id", ids);
      if (metaErr && /saved/i.test(metaErr.message)) {
        // Migrasi 0018 belum dijalankan (kolom `saved` belum ada): tetap tampilkan daftar tanpa tanda Saved.
        ({ data: metaRows, error: metaErr } = await supabaseAdmin.from("chat_thread_meta").select("id, pinned, title, use_kb, agent").in("id", ids));
      }
      if (metaErr) return json({ ok: false, error: metaErr.message }, 500);
      for (const row of metaRows ?? []) {
        metaById[row.id] = { pinned: !!row.pinned, saved: !!row.saved, title: row.title ?? null, useKb: !!row.use_kb, agent: parseAgent(row.agent) };
      }
    }

    const threads = ids.map((id) => ({
      id,
      createdAt: firstSeen[id],
      lastAt: lastSeen[id] ?? firstSeen[id],
      pinned: metaById[id]?.pinned ?? false,
      saved: metaById[id]?.saved ?? false,
      title: metaById[id]?.title ?? null,
      useKb: metaById[id]?.useKb ?? false,
      agent: metaById[id]?.agent ?? "auto"
    }));

    // Aturan hapus otomatis (tabel opsional: kalau migrasi 0018 belum dijalankan, retention = null
    // dan aplikasi tidak menampilkan hitung mundur).
    let retention: { days: number; activeSince: string } | null = null;
    const { data: retRow } = await supabaseAdmin.from("chat_retention_settings").select("days, active_since").eq("id", "main").maybeSingle();
    if (retRow) retention = { days: Number(retRow.days), activeSince: retRow.active_since };

    return json({ ok: true, threads, retention });
  }

  if (body.action === "set_thread_meta") {
    const date0 = typeof body.date === "string" ? body.date : "";
    if (!isValidThreadId(date0)) {
      return json({ ok: false, error: "ID obrolan tidak valid." }, 400);
    }

    const pinnedProvided = typeof body.pinned === "boolean";
    const savedProvided = typeof body.saved === "boolean";
    const titleProvided = body.title !== undefined;
    const useKbProvided = typeof body.useKb === "boolean";
    const agentProvided = body.agent === "auto" || body.agent === "gemini" || body.agent === "ollama";
    if (!pinnedProvided && !savedProvided && !titleProvided && !useKbProvided && !agentProvided) {
      return json({ ok: false, error: "Tidak ada perubahan (pinned/saved/title/useKb/agent) yang dikirim." }, 400);
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("chat_thread_meta")
      .select("pinned, saved, title, use_kb, agent")
      .eq("id", date0)
      .maybeSingle();
    if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);

    const nextPinned = pinnedProvided ? !!body.pinned : existing?.pinned ?? false;
    const nextSaved = savedProvided ? !!body.saved : existing?.saved ?? false;
    const rawTitle = titleProvided ? body.title : existing?.title ?? null;
    const nextTitle = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : null;
    const nextUseKb = useKbProvided ? !!body.useKb : existing?.use_kb ?? false;
    const nextAgent: AgentName = agentProvided ? (body.agent as AgentName) : parseAgent(existing?.agent);

    const { error: upsertErr } = await supabaseAdmin
      .from("chat_thread_meta")
      .upsert({ id: date0, pinned: nextPinned, saved: nextSaved, title: nextTitle, use_kb: nextUseKb, agent: nextAgent, updated_at: new Date().toISOString() });
    if (upsertErr) return json({ ok: false, error: upsertErr.message }, 500);

    return json({ ok: true, pinned: nextPinned, saved: nextSaved, title: nextTitle, useKb: nextUseKb, agent: nextAgent });
  }

  if (body.action === "key_status") {
    const today = getPacificDateString();
    const { data, error } = await supabaseAdmin
      .from("gemini_key_usage")
      .select("key_hint, source, requests, exhausted_until, last_error")
      .eq("usage_date", today);
    if (error) return json({ ok: false, error: error.message }, 500);

    // Daftar key yang DIKONFIGURASI di Supabase selalu tampil (walau belum
    // ada pemakaian = 0 request), digabung dgn hint dari tabel (mis. key yang
    // cuma dipakai bot WA).
    type KeyUsageRow = {
      key_hint: string;
      source: string;
      requests: number | null;
      exhausted_until: string | null;
      last_error: string | null;
    };
    const usageRows = (data ?? []) as KeyUsageRow[];
    const hints = new Set<string>(getGeminiApiKeys().map(geminiKeyHint));
    for (const row of usageRows) hints.add(row.key_hint);

    const nowMs = Date.now();
    const keys = [...hints].map((hint) => {
      const rows = usageRows.filter((r) => r.key_hint === hint);
      const requests = rows.reduce((sum, r) => sum + (r.requests ?? 0), 0);
      let exhaustedUntilMs = 0;
      let lastError: string | null = null;
      let lastErrorUntil = 0;
      for (const r of rows) {
        const until = r.exhausted_until ? new Date(r.exhausted_until).getTime() : 0;
        if (until > exhaustedUntilMs) exhaustedUntilMs = until;
        if (r.last_error && until >= lastErrorUntil) {
          lastErrorUntil = until;
          lastError = r.last_error;
        }
      }
      const exhausted = exhaustedUntilMs > nowMs;
      // "daily" = jatah harian habis (masa istirahat panjang sampai reset);
      // "temporary" = rate-limit sementara (istirahat ~1 menit).
      const exhaustedKind = exhausted ? (exhaustedUntilMs - nowMs > 10 * 60_000 ? "daily" : "temporary") : null;
      return {
        hint,
        requests,
        exhausted,
        exhaustedKind,
        exhaustedUntilMs: exhausted ? exhaustedUntilMs : null,
        // Pesan error terakhir disertakan juga saat sudah tidak habis (buat
        // diagnosis), diambil dari baris yang paling baru diperbarui.
        lastError
      };
    });

    // Tengah malam Pasifik berikutnya (ms epoch) = jadwal reset kuota harian.
    const pacificNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const nextMidnight = new Date(pacificNow);
    nextMidnight.setHours(24, 0, 0, 0);
    const resetAtMs = nowMs + (nextMidnight.getTime() - pacificNow.getTime());

    return json({ ok: true, dailyLimit: Number(Deno.env.get("GEMINI_DAILY_LIMIT")) || 20, resetAtMs, keys });
  }

  // --- Dokumen Pengetahuan (lihat migrations/0007 + 0017) ---
  const KB_BUCKET = "kb-inbox";
  const KB_LIST_COLS_NEW =
    "id, title, char_count, original_filename, uploaded_at, status, status_detail, error, page_count, truncated, on_laptop, ocr_pages";
  const KB_LIST_COLS_OLD = "id, title, char_count, original_filename, uploaded_at";
  const KB_ALLOWED_EXT = ["pdf", "txt", "md", "csv"];
  const KB_MAX_FILE_BYTES = Number(Deno.env.get("KB_MAX_FILE_BYTES")) || 50 * 1024 * 1024;
  const isMissingColumn = (msg: string) => /column|schema cache/i.test(msg || "");

  if (body.action === "kb_list") {
    let res = await supabaseAdmin
      .from("knowledge_documents")
      .select(KB_LIST_COLS_NEW)
      .order("uploaded_at", { ascending: false })
      .limit(200);
    // Migrasi 0017 belum dijalankan -> kolom status belum ada; pakai daftar lama.
    if (res.error && isMissingColumn(res.error.message)) {
      res = await supabaseAdmin
        .from("knowledge_documents")
        .select(KB_LIST_COLS_OLD)
        .order("uploaded_at", { ascending: false })
        .limit(200);
    }
    if (res.error) return json({ ok: false, error: res.error.message }, 500);
    return json({ ok: true, documents: res.data ?? [] });
  }

  // Langkah 1 upload file mentah: buat baris + tiket upload ke bucket inbox.
  if (body.action === "kb_upload_url") {
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
    const size = Number(body.size) || 0;
    if (!title) return json({ ok: false, error: "Judul dokumen tidak boleh kosong." }, 400);
    const ext = (filename.split(".").pop() ?? "").toLowerCase();
    if (!filename || !KB_ALLOWED_EXT.includes(ext)) {
      return json({ ok: false, error: `Jenis file tidak didukung (boleh: ${KB_ALLOWED_EXT.join(", ")}).` }, 400);
    }
    if (size > KB_MAX_FILE_BYTES) {
      return json(
        { ok: false, error: `File terlalu besar (maks ${Math.floor(KB_MAX_FILE_BYTES / 1024 / 1024)} MB per file).` },
        400
      );
    }

    const docId = crypto.randomUUID();
    const path = `${docId}/source.${ext}`;
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from(KB_BUCKET).createSignedUploadUrl(path);
    if (signErr || !signed) {
      return json(
        {
          ok: false,
          error: `Gagal menyiapkan tempat upload (${signErr?.message ?? "tanpa detail"}). Pastikan migrasi 0017_kb_inbox.sql sudah dijalankan.`
        },
        500
      );
    }
    const { data, error } = await supabaseAdmin
      .from("knowledge_documents")
      .insert({
        id: docId,
        title,
        content: "",
        char_count: 0,
        original_filename: filename,
        status: "uploading",
        status_detail: "Mengirim file…",
        storage_path: path
      })
      .select(KB_LIST_COLS_NEW)
      .single();
    if (error) {
      return json(
        { ok: false, error: isMissingColumn(error.message) ? "Jalankan dulu migrasi 0017_kb_inbox.sql di Supabase." : error.message },
        500
      );
    }
    return json({ ok: true, document: data, upload: { path, token: signed.token } });
  }

  // Langkah 2: file sudah terkirim -> antrekan supaya diambil bot di laptop.
  if (body.action === "kb_upload_done") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID_RE.test(id)) return json({ ok: false, error: "ID dokumen tidak valid." }, 400);
    const { data: row } = await supabaseAdmin
      .from("knowledge_documents")
      .select("id, status, storage_path")
      .eq("id", id)
      .maybeSingle();
    if (!row || row.status !== "uploading" || !row.storage_path) {
      return json({ ok: false, error: "Dokumen tidak dalam status upload." }, 400);
    }
    const dir = String(row.storage_path).split("/")[0];
    const { data: files } = await supabaseAdmin.storage.from(KB_BUCKET).list(dir);
    if (!files || files.length === 0) {
      return json({ ok: false, error: "File belum sampai di server -- ulangi upload." }, 400);
    }
    const { error } = await supabaseAdmin
      .from("knowledge_documents")
      .update({ status: "queued", status_detail: "Menunggu diproses di laptop…", error: null })
      .eq("id", id)
      .eq("status", "uploading");
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // Coba ulang dokumen yang gagal diproses (file mentah masih di inbox).
  if (body.action === "kb_retry") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID_RE.test(id)) return json({ ok: false, error: "ID dokumen tidak valid." }, 400);
    const { data, error } = await supabaseAdmin
      .from("knowledge_documents")
      .update({ status: "queued", status_detail: "Menunggu diproses di laptop…", error: null })
      .eq("id", id)
      .eq("status", "error")
      .not("storage_path", "is", null)
      .select("id");
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data || data.length === 0) {
      return json({ ok: false, error: "Dokumen ini tidak bisa diulang (file mentahnya sudah tidak ada) -- upload ulang." }, 400);
    }
    return json({ ok: true });
  }

  // Jalur lama/cadangan: teks sudah diekstrak oleh klien.
  if (body.action === "kb_upload") {
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const originalFilename = typeof body.filename === "string" ? body.filename.slice(0, 200) : null;

    if (!title) return json({ ok: false, error: "Judul dokumen tidak boleh kosong." }, 400);
    if (!content) {
      return json(
        { ok: false, error: "Teks dokumen kosong -- kemungkinan PDF ini hasil scan/gambar tanpa lapisan teks." },
        400
      );
    }

    // Salinan teks untuk Gemini dibatasi supaya konteks tiap chat tidak
    // membengkak. (Dokumen yang lewat laptop tetap utuh di indeks Ollama.)
    const MAX_DOC_CHARS = 600000;
    const trimmed =
      content.length > MAX_DOC_CHARS ? `${content.slice(0, MAX_DOC_CHARS)}\n\n[...dipotong, dokumen terlalu panjang...]` : content;

    const { data, error } = await supabaseAdmin
      .from("knowledge_documents")
      .insert({ title, content: trimmed, char_count: trimmed.length, original_filename: originalFilename })
      .select(KB_LIST_COLS_OLD)
      .single();

    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, document: data });
  }

  if (body.action === "kb_delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return json({ ok: false, error: "ID dokumen tidak valid." }, 400);

    // Hapus juga file mentah di inbox kalau masih ada (best-effort).
    const { data: row } = await supabaseAdmin.from("knowledge_documents").select("storage_path").eq("id", id).maybeSingle();
    const sp = (row as { storage_path?: string | null } | null)?.storage_path;
    if (sp) {
      try {
        await supabaseAdmin.storage.from(KB_BUCKET).remove([sp]);
      } catch (_e) {
        // abaikan
      }
    }
    const { error } = await supabaseAdmin.from("knowledge_documents").delete().eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // --- Al-Qur'an: terakhir dibaca + bookmark (lihat migrations/0014) ---
  if (
    body.action === "quran_sync" ||
    body.action === "quran_set_last_read" ||
    body.action === "quran_add_bookmark" ||
    body.action === "quran_delete_bookmark" ||
    body.action === "quran_khatam_set" ||
    body.action === "quran_khatam_clear"
  ) {
    const inRange = (v: unknown, min: number, max: number): v is number =>
      typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

    const khatamOut = (r: Record<string, unknown> | null) =>
      r
        ? {
            startDate: r.start_date as string,
            targetDays: r.target_days as number,
            startPage: r.start_page as number,
            reminder: !!r.reminder,
            khatamCount: (r.khatam_count as number) ?? 0
          }
        : null;

    if (body.action === "quran_khatam_clear") {
      const { error } = await supabaseAdmin.from("quran_khatam").delete().eq("id", "main");
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, khatam: null });
    }

    if (body.action === "quran_khatam_set") {
      const okDate = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) && !Number.isNaN(Date.parse(body.startDate));
      if (!okDate || !inRange(body.targetDays, 1, 730) || !inRange(body.startPage, 1, 604)) {
        return json({ ok: false, error: "Target khatam tidak valid (tanggal, jumlah hari 1-730, halaman 1-604)." }, 400);
      }
      const { data: prev } = await supabaseAdmin.from("quran_khatam").select("reminder, khatam_count").eq("id", "main").maybeSingle();
      const row = {
        id: "main",
        start_date: body.startDate,
        target_days: body.targetDays,
        start_page: body.startPage,
        reminder: typeof body.reminder === "boolean" ? body.reminder : prev?.reminder ?? true,
        khatam_count: inRange(body.khatamCount, 0, 999) ? body.khatamCount : prev?.khatam_count ?? 0,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await supabaseAdmin.from("quran_khatam").upsert(row).select("*").single();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, khatam: khatamOut(data) });
    }

    if (body.action === "quran_sync") {
      const [lr, bm, kh] = await Promise.all([
        supabaseAdmin.from("quran_last_read").select("surah, ayah, page, updated_at").eq("id", "main").maybeSingle(),
        supabaseAdmin
          .from("quran_bookmarks")
          .select("surah, ayah, page, created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabaseAdmin.from("quran_khatam").select("*").eq("id", "main").maybeSingle()
      ]);
      if (lr.error) return json({ ok: false, error: lr.error.message }, 500);
      if (bm.error) return json({ ok: false, error: bm.error.message }, 500);
      // Tabel khatam belum ada (migrasi 0016 belum dijalankan) -> abaikan, bukan gagal.
      return json({ ok: true, lastRead: lr.data ?? null, bookmarks: bm.data ?? [], khatam: kh.error ? null : khatamOut(kh.data) });
    }

    if (body.action === "quran_delete_bookmark") {
      if (!inRange(body.surah, 1, 114) || !inRange(body.ayah, 1, 286)) {
        return json({ ok: false, error: "Surah/ayat tidak valid." }, 400);
      }
      const { error } = await supabaseAdmin
        .from("quran_bookmarks")
        .delete()
        .eq("surah", body.surah)
        .eq("ayah", body.ayah);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    if (!inRange(body.surah, 1, 114) || !inRange(body.ayah, 1, 286) || !inRange(body.page, 1, 604)) {
      return json({ ok: false, error: "Surah/ayat/halaman tidak valid." }, 400);
    }

    if (body.action === "quran_set_last_read") {
      const { error } = await supabaseAdmin
        .from("quran_last_read")
        .upsert({ id: "main", surah: body.surah, ayah: body.ayah, page: body.page, updated_at: new Date().toISOString() });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    // quran_add_bookmark -- idempotent (unik per surah+ayat).
    const { error } = await supabaseAdmin
      .from("quran_bookmarks")
      .upsert({ surah: body.surah, ayah: body.ayah, page: body.page }, { onConflict: "surah,ayah", ignoreDuplicates: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "system_status") {
    const w = await getWorkerStatus(supabaseAdmin);
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [pend, run, done, failed, recent, ws] = await Promise.all([
      supabaseAdmin.from("agent_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("agent_jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
      supabaseAdmin.from("agent_jobs").select("started_at, finished_at").eq("status", "done").gte("created_at", since).limit(200),
      supabaseAdmin.from("agent_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
      supabaseAdmin
        .from("agent_jobs")
        .select("id, status, progress, error, fallback_from, created_at, started_at, finished_at")
        .order("created_at", { ascending: false })
        .limit(6),
      supabaseAdmin.from("agent_worker_status").select("wa_connected, started_at, extra").eq("id", "ollama").maybeSingle()
    ]);
    const durations = (done.data ?? [])
      .filter((r) => r.started_at && r.finished_at)
      .map((r) => (new Date(r.finished_at as string).getTime() - new Date(r.started_at as string).getTime()) / 1000);
    const avgSeconds = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    return json({
      ok: true,
      serverNowMs: Date.now(),
      worker: {
        botAlive: w.botAlive,
        ollamaOk: w.ollamaOk,
        online: w.online,
        model: w.model,
        busy: w.busy,
        detail: w.detail,
        lastSeenMs: w.lastSeenMs,
        waConnected: ws.data?.wa_connected ?? null,
        startedAt: ws.data?.started_at ?? null,
        extra: ws.data?.extra ?? null
      },
      jobs: {
        pending: pend.count ?? 0,
        running: run.count ?? 0,
        done24h: durations.length,
        failed24h: failed.count ?? 0,
        avgSeconds,
        recent: (recent.data ?? []).map((r) => ({
          id: r.id,
          status: r.status,
          progress: r.progress,
          error: r.error,
          fallbackFrom: r.fallback_from,
          createdAt: r.created_at,
          startedAt: r.started_at,
          finishedAt: r.finished_at
        }))
      }
    });
  }

  if (body.action === "agent_status") {
    const w = await getWorkerStatus(supabaseAdmin);
    return json({
      ok: true,
      ollama: { online: w.online, botAlive: w.botAlive, ollamaOk: w.ollamaOk, model: w.model, busy: w.busy, lastSeenMs: w.lastSeenMs }
    });
  }

  if (body.action === "agent_job") {
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!UUID_RE.test(jobId)) return json({ ok: false, error: "jobId tidak valid." }, 400);
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("agent_jobs")
      .select("id, agent, status, progress, error, assistant_message_id, fallback_from, created_at, started_at")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) return json({ ok: false, error: jobErr.message }, 500);
    if (!job) return json({ ok: false, error: "Job tidak ditemukan." }, 404);

    let status = job.status as string;
    let errorText = (job.error as string | null) ?? null;
    // Job yang menggantung (laptop mati/bot restart) ditutup sebagai gagal
    // supaya klien tidak menunggu selamanya.
    const age = (iso: string | null) => (iso ? Date.now() - new Date(iso).getTime() : 0);
    const stalePending = status === "pending" && age(job.created_at as string) > JOB_PENDING_MAX_MS;
    const staleRunning = status === "running" && age((job.started_at ?? job.created_at) as string) > JOB_RUNNING_MAX_MS;
    if (stalePending || staleRunning) {
      status = "failed";
      errorText = stalePending ? "Laptop tidak mengambil permintaan ini (bot/Ollama tidak aktif)." : "Proses Ollama terlalu lama/terhenti.";
      await supabaseAdmin
        .from("agent_jobs")
        .update({ status, error: errorText, finished_at: new Date().toISOString() })
        .eq("id", jobId)
        .in("status", ["pending", "running"]);
    }

    let reply: string | undefined;
    if (status === "done" && job.assistant_message_id) {
      const { data: msg } = await supabaseAdmin.from("chat_messages").select("content").eq("id", job.assistant_message_id).maybeSingle();
      reply = (msg?.content as string | undefined) ?? undefined;
    }
    return json({
      ok: true,
      status,
      progress: job.progress ?? null,
      error: errorText,
      reply,
      assistantMessageId: job.assistant_message_id ?? null,
      agent: job.agent,
      fallbackFrom: job.fallback_from ?? null
    });
  }

  if (typeof body.date !== "string" || !isValidThreadId(body.date)) {
    return json({ ok: false, error: "ID obrolan tidak valid." }, 400);
  }
  const date = body.date;

  if (body.action === "history") {
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("id, role, content, created_at, tokens_used, cost_usd, agent")
      .eq("chat_date", date)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) return json({ ok: false, error: error.message }, 500);
    // cost_usd kolom `numeric` -- PostgREST mengembalikannya sebagai STRING,
    // jadi di-Number()-kan dulu di sini supaya klien selalu terima angka.
    // Pesan lama (sebelum kolom ini ada) cost_usd/tokens_used-nya NULL --
    // dibiarkan null, klien cukup tidak menampilkan "(token.. | $..)" untuk
    // pesan itu.
    const messages = (data ?? []).map((row) => ({
      ...row,
      cost_usd: row.cost_usd != null ? Number(row.cost_usd) : null
    }));
    // Job Ollama yang masih berjalan di obrolan ini (kalau halaman di-reload
    // saat menunggu) -- klien lanjut polling tanpa kehilangan jawabannya.
    const { data: activeJobs } = await supabaseAdmin
      .from("agent_jobs")
      .select("id, status, progress, created_at")
      .eq("chat_date", date)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1);
    const pendingJob = activeJobs && activeJobs.length > 0 ? activeJobs[0] : null;
    // Agen pilihan obrolan ini (sinkron lintas perangkat).
    const { data: metaRow } = await supabaseAdmin.from("chat_thread_meta").select("agent").eq("id", date).maybeSingle();
    // Lampiran file obrolan ini (tabel belum ada kalau migrasi 0016 belum jalan -> kosong).
    const { data: attRows } = await supabaseAdmin
      .from("chat_attachments")
      .select("id, name, char_count")
      .eq("chat_date", date)
      .order("created_at", { ascending: true })
      .limit(20);
    const attachments = (attRows ?? []).map((a) => ({ id: a.id, name: a.name, charCount: a.char_count }));
    return json({ ok: true, messages, pendingJob, agent: parseAgent(metaRow?.agent), attachments });
  }

  if (body.action === "attachment_add") {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!name || !content.trim()) return json({ ok: false, error: "Nama/isi lampiran kosong." }, 400);
    if (content.length > MAX_ATTACHMENT_CHARS) {
      return json({ ok: false, error: `Lampiran terlalu panjang (maks ${MAX_ATTACHMENT_CHARS.toLocaleString("id-ID")} karakter).` }, 413);
    }
    const { count } = await supabaseAdmin.from("chat_attachments").select("id", { count: "exact", head: true }).eq("chat_date", date);
    if ((count ?? 0) >= MAX_ATTACHMENTS_PER_THREAD) {
      return json({ ok: false, error: `Maksimal ${MAX_ATTACHMENTS_PER_THREAD} lampiran per obrolan -- hapus salah satu dulu.` }, 400);
    }
    const { data, error } = await supabaseAdmin
      .from("chat_attachments")
      .insert({ chat_date: date, name, content, char_count: content.length })
      .select("id, name, char_count")
      .single();
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, attachment: { id: data.id, name: data.name, charCount: data.char_count } });
  }

  if (body.action === "attachment_delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID_RE.test(id)) return json({ ok: false, error: "ID lampiran tidak valid." }, 400);
    const { error } = await supabaseAdmin.from("chat_attachments").delete().eq("id", id).eq("chat_date", date);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "delete_message") {
    const messageId = typeof body.id === "string" ? body.id : "";
    if (!messageId) return json({ ok: false, error: "ID pesan tidak valid." }, 400);

    // eq("chat_date", date) + eq("role", "user") sekaligus jadi jaga-jaga
    // ganda: tidak bisa menghapus pesan dari obrolan lain walau ID-nya
    // ketebak, dan tidak bisa menghapus balasan AI sama sekali -- bukan
    // cuma disembunyikan di UI, tapi memang ditolak di server.
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .delete()
      .eq("id", messageId)
      .eq("chat_date", date)
      .eq("role", "user")
      .select("id");

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data || data.length === 0) {
      return json({ ok: false, error: "Pesan tidak ditemukan, atau bukan pesan kamu." }, 404);
    }
    return json({ ok: true });
  }

  if (body.action === "delete") {
    // Pakai select buat tahu berapa baris yang kehapus (delete() biasa tidak
    // mengembalikan count kecuali diminta lewat .select()).
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .delete()
      .eq("chat_date", date)
      .select("id");

    if (error) return json({ ok: false, error: error.message }, 500);

    // Obrolannya sudah tidak ada lagi -- ikut buang baris metadata (pin/judul
    // custom)-nya juga supaya tidak jadi sampah tak terpakai selamanya di
    // chat_thread_meta. Gagal di sini tidak fatal (chat-nya sendiri sudah
    // terhapus), jadi cukup dicoba saja tanpa menggagalkan seluruh request.
    await supabaseAdmin.from("chat_thread_meta").delete().eq("id", date);
    await supabaseAdmin.from("chat_attachments").delete().eq("chat_date", date);

    return json({ ok: true, deleted: data?.length ?? 0 });
  }

  if (body.action === "send") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return json({ ok: false, error: "Pesan tidak boleh kosong." }, 400);
    }
    const trimmed = message.slice(0, MAX_MESSAGE_LENGTH);

    const agent = parseAgent(body.agent);
    const geminiApiKeys = getGeminiApiKeys();

    // Simpan pesan pengguna + buat job antrean untuk Ollama (bot di laptop yang
    // mengerjakan & menulis balasannya ke chat_messages). `userMessageId` diisi
    // kalau pesan pengguna SUDAH tersimpan (jalur cadangan setelah Gemini gagal).
    const enqueueOllama = async (opts: { userMessageId?: string; fallbackFrom?: string }) => {
      let userMessageId = opts.userMessageId;
      if (!userMessageId) {
        const { data: row, error: insErr } = await supabaseAdmin
          .from("chat_messages")
          .insert({ chat_date: date, role: "user", content: trimmed })
          .select("id")
          .single();
        if (insErr) return json({ ok: false, error: insErr.message }, 500);
        userMessageId = row?.id as string | undefined;
      }
      const { data: job, error: jobErr } = await supabaseAdmin
        .from("agent_jobs")
        .insert({
          chat_date: date,
          agent: "ollama",
          user_message_id: userMessageId ?? null,
          question: trimmed,
          fallback_from: opts.fallbackFrom ?? null
        })
        .select("id")
        .single();
      if (jobErr) return json({ ok: false, error: jobErr.message, userMessageId }, 500);
      return json({
        ok: true,
        pending: true,
        jobId: job?.id,
        userMessageId,
        agent: "ollama",
        fallbackFrom: opts.fallbackFrom ?? null
      });
    };

    // Agen "ollama" (atau "auto" tanpa API key Gemini sama sekali): langsung
    // ke antrean lokal -- tolak DULU (tanpa menyimpan pesan) kalau laptop mati.
    const cloudAiAvailable = geminiApiKeys.length > 0 || getFallbackChain().available();
    if (agent === "ollama" || (agent === "auto" && !cloudAiAvailable)) {
      const w = await getWorkerStatus(supabaseAdmin);
      if (!w.online) {
        return json({ ok: false, error: offlineMessage(w), ollamaOffline: true }, 503);
      }
      return await enqueueOllama({});
    }

    if (!cloudAiAvailable) {
      return json({ ok: false, error: "GEMINI_API_KEYS (atau GEMINI_API_KEY) belum di-set sebagai Supabase secret." }, 500);
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
    // riwayat tetap tersimpan walau balasan AI-nya gagal/timeout. .select()
    // dipakai supaya dapat ID-nya balik -- dikirim ke klien sebagai
    // userMessageId supaya bubble yang baru dikirim langsung bisa dihapus
    // (menu titik-3 > Hapus pesan) tanpa perlu reload riwayat dulu.
    const { data: userRow, error: insertUserErr } = await supabaseAdmin
      .from("chat_messages")
      .insert({ chat_date: date, role: "user", content: trimmed })
      .select("id")
      .single();
    if (insertUserErr) return json({ ok: false, error: insertUserErr.message }, 500);
    const userMessageId = userRow?.id as string | undefined;

    // Ambil "Dokumen Pengetahuan" (PDF peraturan dll yang diupload lewat
    // Pengaturan) buat disertakan sebagai konteks ke Gemini -- TAPI cuma
    // kalau obrolan ini AKTIFKAN toggle "Pakai Dokumen Pengetahuan" (menu
    // titik-3 > di bawah Sematkan). Defaultnya OFF (lihat migrations/0010):
    // sebelumnya SEMUA dokumen otomatis disisipkan ke SETIAP pesan di SEMUA
    // obrolan (bisa sampai 600rb karakter/±150rb token tiap request!),
    // bahkan obrolan yang tidak ada hubungannya sama dokumen sama sekali --
    // itu penyebab utama token/biaya Gemini membengkak drastis.
    const { data: threadMetaRow } = await supabaseAdmin
      .from("chat_thread_meta")
      .select("use_kb")
      .eq("id", date)
      .maybeSingle();
    const useKbForThisThread = !!threadMetaRow?.use_kb;

    const knowledgeContext: { title: string; content: string }[] = [];
    let kbExcerpts = false;
    // Jalur laptop: potongan datang dari indeks lengkap di laptop (bukan salinan cloud yang terpotong).
    let strictDocs = false;
    let docNoMatch = false;
    let guardChunks: { title: string; page: number | null; text: string }[] = [];
    let laptopHandled = false;
    if (!useKbForThisThread) {
      // Obrolan ini tidak mengaktifkan Dokumen Pengetahuan -- lewati query
      // kb sepenuhnya, knowledgeContext tetap kosong.
    } else {
      const userTextsAll = history.filter((m) => m.role === "user").map((m) => m.content);
      const lastUserAll = userTextsAll[userTextsAll.length - 1] ?? "";
      // Permintaan menyeluruh ("ringkas dokumen ini") tetap lewat jalur lama di bawah.
      if (!wantsWholeDocument(lastUserAll)) {
        const kbQuery = buildKbQuery(userTextsAll);
        const lr = kbQuery
          ? await requestLaptopChunks(supabaseAdmin, { chatDate: date, query: kbQuery, budgetChars: 12000, maxChunks: 10 })
          : ({ ok: false, reason: "kueri kosong" } as const);
        if (lr.ok) {
          laptopHandled = true;
          console.log(`chat: indeks laptop -> ${lr.chunks.length} blok dalam ${lr.ms} ms (query: "${kbQuery.slice(0, 80)}")`);
          if (lr.chunks.length > 0) {
            const titles = [...new Set(lr.chunks.map((c) => c.title))];
            for (const title of titles) {
              knowledgeContext.push({
                title,
                content: lr.chunks.filter((c) => c.title === title).map((c) => c.text).join("\n\n---\n\n")
              });
            }
            kbExcerpts = true;
            strictDocs = true;
            guardChunks = lr.chunks.map((c) => ({ title: c.title, page: c.page, text: c.text }));
          } else {
            docNoMatch = true;
          }
        } else {
          console.log(`chat: indeks laptop tidak dipakai (${lr.reason}), pakai pencarian salinan cloud.`);
        }
      }
    }
    if (useKbForThisThread && !laptopHandled) {
      // Diurut dari yang PALING BARU diupload supaya kalau harus ada yang
      // dipotong karena kepanjangan, yang kepotong duluan adalah dokumen lama.
      const { data: kbRows, error: kbErr } = await supabaseAdmin
        .from("knowledge_documents")
        .select("title, content")
        .neq("content", "") // lewati dokumen yang belum selesai diproses
        .order("uploaded_at", { ascending: false })
        .limit(50);
      if (kbErr) {
        console.error("chat: gagal ambil dokumen pengetahuan, lanjut tanpa itu:", kbErr.message);
      } else {
        const docs = (kbRows ?? []).map((r) => ({ title: r.title as string, content: r.content as string }));
        const totalChars = docs.reduce((sum, d) => sum + d.content.length, 0);
        const userTexts = history.filter((m) => m.role === "user").map((m) => m.content);
        const lastUser = userTexts[userTexts.length - 1] ?? "";

        // Dokumen KECIL, atau pengguna minta sesuatu yang menyangkut seluruh
        // dokumen ("ringkas dokumen ini"): kirim utuh seperti dulu. Dokumen
        // BESAR (mis. PMK SBM ratusan ribu karakter): kirim hanya POTONGAN yang
        // relevan dgn pertanyaan -- sebelumnya seluruh dokumen (±170 ribu token,
        // ±$0.28) dikirim di TIAP pertanyaan, dan bagian akhir dokumen malah
        // terpotong oleh batas total di bawah sehingga tabel di belakang tak
        // pernah terbaca.
        const KB_FULL_MAX_CHARS = 60000;
        if (totalChars <= KB_FULL_MAX_CHARS || wantsWholeDocument(lastUser)) {
          const TOTAL_KB_BUDGET_CHARS = 600000;
          let used = 0;
          for (const row of docs) {
            if (used >= TOTAL_KB_BUDGET_CHARS) break;
            const remaining = TOTAL_KB_BUDGET_CHARS - used;
            const content = row.content.length > remaining ? `${row.content.slice(0, remaining)}\n\n[...dipotong...]` : row.content;
            knowledgeContext.push({ title: row.title, content });
            used += content.length;
          }
        } else {
          const query = buildKbQuery(userTexts);
          const chunks = selectKnowledgeChunks(docs, query);
          const titles = [...new Set(chunks.map((c) => c.title))];
          console.log(`chat: dokumen besar (${totalChars} karakter) -> ${chunks.length} potongan relevan dari ${titles.length} dokumen (query: "${query.slice(0, 80)}")`);
          for (const title of titles) {
            knowledgeContext.push({
              title,
              content: chunks.filter((c) => c.title === title).map((c) => c.text).join("\n\n---\n\n")
            });
          }
          kbExcerpts = chunks.length > 0;
        }
      }
    }

    // Lampiran file obrolan ini selalu disertakan penuh (pengguna sengaja
    // melampirkannya), terlepas dari toggle Dokumen Pengetahuan.
    {
      const { data: attRows } = await supabaseAdmin
        .from("chat_attachments")
        .select("name, content")
        .eq("chat_date", date)
        .order("created_at", { ascending: true })
        .limit(MAX_ATTACHMENTS_PER_THREAD);
      // Anggaran total sama seperti Dokumen Pengetahuan (600rb karakter) supaya
      // 3 lampiran besar tidak membengkakkan token Gemini di tiap pesan.
      let attBudget = 600_000;
      const attDocs: { title: string; content: string }[] = [];
      for (const a of attRows ?? []) {
        if (attBudget <= 0) break;
        const text = a.content as string;
        const content = text.length > attBudget ? `${text.slice(0, attBudget)}\n\n[...dipotong...]` : text;
        attBudget -= content.length;
        attDocs.push({ title: `Lampiran: ${a.name as string}`, content });
      }
      knowledgeContext.unshift(...attDocs);
      if (strictDocs) for (const d of attDocs) guardChunks.push({ title: d.title, page: null, text: d.content });
    }

    let reply: string;
    let tokensUsed = 0;
    let costUsd = 0;
    try {
      // Catat tiap panggilan sukses & key yang kena kuota ke gemini_key_usage
      // (buat layar "Status API Gemini"). Best-effort -- gagal catat tidak
      // menggagalkan chat (lihat setGeminiKeyReporter di _shared/gemini.ts).
      setGeminiKeyReporter(async (event) => {
        await supabaseAdmin.rpc("report_gemini_key_event", {
          p_usage_date: getPacificDateString(),
          p_key_hint: event.keyHint,
          p_source: "chat",
          p_requests_inc: event.kind === "success" ? 1 : 0,
          p_exhausted_until: event.kind === "exhausted" && event.exhaustedUntilMs ? new Date(event.exhaustedUntilMs).toISOString() : null,
          p_error: event.kind === "exhausted" ? (event.error ?? null) : null
        });
      });
      const result = await generateChatReply(history, geminiApiKeys, knowledgeContext, { kbExcerpts, strictDocs, docNoMatch });
      reply = result.reply;
      tokensUsed = result.tokensUsed;
      costUsd = result.costUsd;
      if (result.provider) console.log(`chat: balasan dari penyedia cadangan ${result.provider}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("chat: gagal dapat balasan Gemini:", msg);
      // Mode "auto": Gemini gagal (kuota habis/overloaded) -> kalau Ollama di
      // laptop hidup, antrekan ke sana. Pesan pengguna sudah tersimpan di atas.
      if (agent === "auto") {
        const w = await getWorkerStatus(supabaseAdmin);
        if (w.online) {
          console.log("chat: Gemini gagal, dialihkan ke Ollama (antrean).");
          return await enqueueOllama({ userMessageId, fallbackFrom: "gemini" });
        }
      }
      // Pesan pengguna SUDAH tersimpan di atas -- sertakan userMessageId
      // juga di respons error ini, supaya bubble yang terlanjur tampil di
      // layar tetap bisa dihapus langsung tanpa perlu reload riwayat dulu.
      return json({ ok: false, error: `Gagal dapat balasan AI: ${msg}`, userMessageId }, 502);
    }

    // Pemeriksaan mekanis: kutipan «…» / nomor halaman yang tidak ada di potongan yang dikirim ke Gemini diberi catatan.
    if (strictDocs && guardChunks.length > 0) {
      const g = guardDocAnswer(reply, guardChunks);
      if (g.flagged) {
        console.log(`chat: jawaban ditandai pemeriksa dokumen (kutipan tak terbukti=${g.badQuotes.length}, halaman tak ada=${g.badPages.length})`);
        reply = g.reply;
      }
    }

    // SATU giliran kirim (satu panggilan Gemini) mencakup prompt (riwayat +
    // dokumen pengetahuan + pesan baru) DAN jawabannya sekaligus -- jadi
    // tokens_used/cost_usd yang sama dicatat di KEDUA baris (pesan pengguna
    // & balasan AI) untuk giliran ini, supaya "(token xxx | $ x,xx)" muncul
    // di kedua bubble-nya di UI, bukan cuma salah satu.
    // Log diagnostik: angka PERSIS yang mau disimpan ke chat_messages utk
    // giliran ini -- supaya kalau nanti masih ada yang aneh (mis. ternyata
    // tokensUsed 0 padahal seharusnya tidak), ketahuan dari log tanpa perlu
    // nebak-nebak lagi.
    console.log(`chat: giliran ini tokensUsed=${tokensUsed}, costUsd=${costUsd}`);

    const { data: assistantRow, error: insertAssistantErr } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        chat_date: date,
        role: "assistant",
        content: reply,
        agent: "gemini",
        tokens_used: tokensUsed || null,
        cost_usd: costUsd || null
      })
      .select("id")
      .single();
    if (insertAssistantErr) return json({ ok: false, error: insertAssistantErr.message }, 500);

    if (userMessageId && (tokensUsed || costUsd)) {
      // PENTING: error di update ini SEBELUMNYA tidak pernah dicek/dicatat
      // sama sekali -- kalau gagal (mis. RLS/constraint), tidak akan pernah
      // ketahuan dari log. Sekarang dicatat (tidak menggagalkan response,
      // karena balasan utamanya sendiri sudah berhasil tersimpan).
      const { error: updateUserMsgErr } = await supabaseAdmin
        .from("chat_messages")
        .update({ tokens_used: tokensUsed || null, cost_usd: costUsd || null })
        .eq("id", userMessageId);
      if (updateUserMsgErr) {
        console.error("chat: gagal update tokens_used/cost_usd pesan pengguna:", updateUserMsgErr.message);
      }
    }

    // Catat pemakaian token + biaya hari ini (zona Pasifik) -- cuma buat
    // estimasi di footer aplikasi, jadi kegagalan di sini sengaja TIDAK
    // menggagalkan seluruh response (pesan & balasannya sendiri sudah
    // berhasil tersimpan).
    let tokensUsedToday: number | undefined;
    let costUsedToday: number | undefined;
    if (tokensUsed > 0) {
      try {
        const today = getPacificDateString();
        const { data: existingUsage } = await supabaseAdmin
          .from("token_usage")
          .select("total_tokens, total_cost_usd")
          .eq("usage_date", today)
          .maybeSingle();
        tokensUsedToday = (existingUsage?.total_tokens ?? 0) + tokensUsed;
        // total_cost_usd kolom `numeric` -- balik sebagai STRING, Number()-kan
        // dulu sebelum dijumlah supaya tidak jadi concat string.
        costUsedToday = Number(existingUsage?.total_cost_usd ?? 0) + costUsd;
        await supabaseAdmin.from("token_usage").upsert({
          usage_date: today,
          total_tokens: tokensUsedToday,
          total_cost_usd: costUsedToday,
          updated_at: new Date().toISOString()
        });
      } catch (err) {
        console.error("chat: gagal catat token_usage, lanjut tanpa itu:", err instanceof Error ? err.message : String(err));
      }
    }

    return json({
      ok: true,
      reply,
      agent: "gemini",
      userMessageId,
      assistantMessageId: assistantRow?.id,
      // Angka giliran INI SAJA -- dipakai klien buat langsung menampilkan
      // "(token xxx | $ x,xx)" di dua bubble yang baru saja tampil, tanpa
      // perlu reload riwayat dulu.
      turnTokens: tokensUsed,
      turnCostUsd: costUsd,
      // Angka AKUMULASI hari ini -- dipakai klien buat update footer.
      tokensUsedToday,
      costUsedToday
    });
  }

  return json(
    {
      ok: false,
      error:
        "action tidak dikenal (pakai 'history', 'send', 'agent_job', 'agent_status', 'system_status', 'attachment_add', 'attachment_delete', 'quran_khatam_set', 'quran_khatam_clear', 'delete', 'delete_message', 'last_messages', 'list_threads', 'set_thread_meta', 'token_usage', 'key_status', 'kb_list', 'kb_upload', 'kb_upload_url', 'kb_upload_done', 'kb_retry', 'kb_delete', 'quran_sync', 'quran_set_last_read', 'quran_add_bookmark', atau 'quran_delete_bookmark')."
    },
    400
  );
});
