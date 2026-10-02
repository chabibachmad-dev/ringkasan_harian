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
//   { "code": "...", "date": "...", "action": "send", "message": "..." }
//     -> { ok: true, reply: "..." }
//   { "code": "...", "action": "last_messages", "dates": ["...", ...] }
//     -> { ok: true, lastMessages: { "<id>": { role, content, created_at }, ... } }
//     (dipakai buat cuplikan/preview di layar daftar obrolan)
//   { "code": "...", "date": "...", "action": "delete" }
//     -> { ok: true, deleted: <jumlah baris> }
//     (hapus semua chat_messages buat obrolan ini -- dipakai menu titik-3
//     "Hapus chat".)
//   { "code": "...", "action": "list_threads" }
//     -> { ok: true, threads: [{ id, createdAt, pinned, title, useKb }, ...] }
//     (semua ID obrolan yang PERNAH punya minimal 1 pesan, diambil dari
//     server -- bukan dari localStorage perangkat. Dipakai supaya daftar
//     obrolan ikut muncul walau dibuka dari perangkat lain dengan kode akses
//     yang sama, karena kode aksesnya memang satu untuk semua perangkat.
//     pinned/title/useKb diambil dari tabel chat_thread_meta supaya status
//     sematan, judul custom, & toggle Dokumen Pengetahuan ikut sinkron ke
//     semua perangkat juga.)
//   { "code": "...", "date": "...", "action": "set_thread_meta", "pinned"?: bool, "title"?: string|null, "useKb"?: bool }
//     -> { ok: true, pinned: bool, title: string|null, useKb: bool }
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

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { generateChatReply, type ChatMessage } from "../_shared/gemini.ts";

// ID obrolan dibuat client-side sebagai `freeform-<uuid>` (lihat main.js).
const FREEFORM_RE = /^freeform-[0-9a-fA-F-]{36}$/;
function isValidThreadId(id: string): boolean {
  return FREEFORM_RE.test(id);
}
const MAX_MESSAGE_LENGTH = 4000;
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
    content?: string;
    filename?: string;
    id?: string;
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
    for (const row of data ?? []) {
      if (!firstSeen[row.chat_date]) firstSeen[row.chat_date] = row.created_at;
    }
    const ids = Object.keys(firstSeen).filter((id) => isValidThreadId(id));

    // Ambil status sematan (pin), judul custom, & toggle Dokumen Pengetahuan
    // semua thread ini sekaligus -- supaya pin/rename/toggle yang dilakukan
    // dari PERANGKAT LAIN ikut kebawa ke sini juga (sebelumnya cuma
    // tersimpan di localStorage per perangkat).
    const metaById: Record<string, { pinned: boolean; title: string | null; useKb: boolean }> = {};
    if (ids.length > 0) {
      const { data: metaRows, error: metaErr } = await supabaseAdmin
        .from("chat_thread_meta")
        .select("id, pinned, title, use_kb")
        .in("id", ids);
      if (metaErr) return json({ ok: false, error: metaErr.message }, 500);
      for (const row of metaRows ?? []) {
        metaById[row.id] = { pinned: !!row.pinned, title: row.title ?? null, useKb: !!row.use_kb };
      }
    }

    const threads = ids.map((id) => ({
      id,
      createdAt: firstSeen[id],
      pinned: metaById[id]?.pinned ?? false,
      title: metaById[id]?.title ?? null,
      useKb: metaById[id]?.useKb ?? false
    }));

    return json({ ok: true, threads });
  }

  if (body.action === "set_thread_meta") {
    const date0 = typeof body.date === "string" ? body.date : "";
    if (!isValidThreadId(date0)) {
      return json({ ok: false, error: "ID obrolan tidak valid." }, 400);
    }

    const pinnedProvided = typeof body.pinned === "boolean";
    const titleProvided = body.title !== undefined;
    const useKbProvided = typeof body.useKb === "boolean";
    if (!pinnedProvided && !titleProvided && !useKbProvided) {
      return json({ ok: false, error: "Tidak ada perubahan (pinned/title/useKb) yang dikirim." }, 400);
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("chat_thread_meta")
      .select("pinned, title, use_kb")
      .eq("id", date0)
      .maybeSingle();
    if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);

    const nextPinned = pinnedProvided ? !!body.pinned : existing?.pinned ?? false;
    const rawTitle = titleProvided ? body.title : existing?.title ?? null;
    const nextTitle = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : null;
    const nextUseKb = useKbProvided ? !!body.useKb : existing?.use_kb ?? false;

    const { error: upsertErr } = await supabaseAdmin
      .from("chat_thread_meta")
      .upsert({ id: date0, pinned: nextPinned, title: nextTitle, use_kb: nextUseKb, updated_at: new Date().toISOString() });
    if (upsertErr) return json({ ok: false, error: upsertErr.message }, 500);

    return json({ ok: true, pinned: nextPinned, title: nextTitle, useKb: nextUseKb });
  }

  if (body.action === "kb_list") {
    const { data, error } = await supabaseAdmin
      .from("knowledge_documents")
      .select("id, title, char_count, original_filename, uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(200);

    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, documents: data ?? [] });
  }

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

    // Batasi per-dokumen supaya satu PDF yang sangat panjang tidak membuat
    // konteks yang dikirim ke Gemini tiap chat membengkak tak terkendali
    // (lihat pemotongan total gabungan semua dokumen di action "send").
    const MAX_DOC_CHARS = 300000;
    const trimmed =
      content.length > MAX_DOC_CHARS ? `${content.slice(0, MAX_DOC_CHARS)}\n\n[...dipotong, dokumen terlalu panjang...]` : content;

    const { data, error } = await supabaseAdmin
      .from("knowledge_documents")
      .insert({ title, content: trimmed, char_count: trimmed.length, original_filename: originalFilename })
      .select("id, title, char_count, original_filename, uploaded_at")
      .single();

    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, document: data });
  }

  if (body.action === "kb_delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return json({ ok: false, error: "ID dokumen tidak valid." }, 400);

    const { error } = await supabaseAdmin.from("knowledge_documents").delete().eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  if (typeof body.date !== "string" || !isValidThreadId(body.date)) {
    return json({ ok: false, error: "ID obrolan tidak valid." }, 400);
  }
  const date = body.date;

  if (body.action === "history") {
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("id, role, content, created_at, tokens_used, cost_usd")
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
    return json({ ok: true, messages });
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

    return json({ ok: true, deleted: data?.length ?? 0 });
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
    if (!useKbForThisThread) {
      // Obrolan ini tidak mengaktifkan Dokumen Pengetahuan -- lewati query
      // kb sepenuhnya, knowledgeContext tetap kosong.
    } else {
      // Dibatasi total gabungannya (bukan cuma per-dokumen) supaya tidak
      // kebablasan kalau dokumennya banyak. Diurut dari yang PALING BARU
      // diupload supaya kalau harus ada yang dipotong karena kepanjangan,
      // yang kepotong duluan adalah dokumen lama -- dokumen yang baru saja
      // diupload (paling relevan buat pengguna saat ini) tetap utuh.
      const { data: kbRows, error: kbErr } = await supabaseAdmin
        .from("knowledge_documents")
        .select("title, content")
        .order("uploaded_at", { ascending: false })
        .limit(50);
      if (kbErr) {
        console.error("chat: gagal ambil dokumen pengetahuan, lanjut tanpa itu:", kbErr.message);
      } else {
        const TOTAL_KB_BUDGET_CHARS = 600000;
        let used = 0;
        for (const row of kbRows ?? []) {
          if (used >= TOTAL_KB_BUDGET_CHARS) break;
          const remaining = TOTAL_KB_BUDGET_CHARS - used;
          const content = row.content.length > remaining ? `${row.content.slice(0, remaining)}\n\n[...dipotong...]` : row.content;
          knowledgeContext.push({ title: row.title, content });
          used += content.length;
        }
      }
    }

    let reply: string;
    let tokensUsed = 0;
    let costUsd = 0;
    try {
      const result = await generateChatReply(history, geminiApiKey, knowledgeContext);
      reply = result.reply;
      tokensUsed = result.tokensUsed;
      costUsd = result.costUsd;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("chat: gagal dapat balasan Gemini:", msg);
      // Pesan pengguna SUDAH tersimpan di atas -- sertakan userMessageId
      // juga di respons error ini, supaya bubble yang terlanjur tampil di
      // layar tetap bisa dihapus langsung tanpa perlu reload riwayat dulu.
      return json({ ok: false, error: `Gagal dapat balasan AI: ${msg}`, userMessageId }, 502);
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
        "action tidak dikenal (pakai 'history', 'send', 'delete', 'delete_message', 'last_messages', 'list_threads', 'set_thread_meta', 'token_usage', 'kb_list', 'kb_upload', atau 'kb_delete')."
    },
    400
  );
});