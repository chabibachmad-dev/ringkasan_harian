-- ================================================================
-- Pengembangan lanjutan bot WA + Gemini multi-key:
--   1. gemini_key_usage   -- catatan pemakaian & status "habis" tiap API key
--                            Gemini (buat layar "Status API Gemini" di aplikasi
--                            & supaya bot ingat key yang habis walau di-restart).
--   2. wa_quick_replies   -- template jawaban otomatis (tanpa panggil AI) untuk
--                            pertanyaan berulang, dikelola dari aplikasi.
--   3. wa_retry_queue     -- antrean pesan WA yang gagal dibalas AI (mis. semua
--                            key habis), dicoba lagi otomatis nanti.
--   4. bot_state          -- key-value kecil buat state bot (mis. "alert
--                            semua key habis sudah dikirim hari ini?").
--
-- Semua tabel dikunci total dari anon key (RLS aktif, nol policy) -- pola
-- SAMA dengan whatsapp_messages/whatsapp_contacts: cuma bisa diakses lewat
-- Edge Function (service_role) atau bot (service_role key).
--
-- PENTING: key API Gemini ASLI tidak pernah disimpan di database -- cuma
-- 4 karakter terakhirnya ("key_hint") buat membedakan key #1/#2/#3.
--
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau via
-- `npx supabase db push`.
-- ================================================================

-- ---------------- 1. gemini_key_usage ----------------

create table if not exists public.gemini_key_usage (
  -- Tanggal dalam zona waktu Pasifik (sama dgn reset kuota harian Gemini &
  -- kolom usage_date di token_usage).
  usage_date date not null,
  key_hint text not null,
  -- Siapa yang memakai: 'wa-bot' atau 'chat' (Edge Function chat) -- dipisah
  -- supaya masing-masing menulis barisnya sendiri (tidak rebutan).
  source text not null,
  requests integer not null default 0,
  -- Kalau terisi & masih di masa depan = key ini lagi dianggap habis kuota.
  exhausted_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (usage_date, key_hint, source)
);

comment on table public.gemini_key_usage is 'Pemakaian & status habis tiap API key Gemini per hari (zona Pasifik). Cuma 4 karakter terakhir key yang disimpan (key_hint).';

alter table public.gemini_key_usage enable row level security;

-- Upsert atomik (hindari race baca-lalu-tulis kalau bot & Edge Function
-- nulis bersamaan): tambah counter requests, dan/atau set exhausted_until.
create or replace function public.report_gemini_key_event(
  p_usage_date date,
  p_key_hint text,
  p_source text,
  p_requests_inc integer default 0,
  p_exhausted_until timestamptz default null,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.gemini_key_usage as g (usage_date, key_hint, source, requests, exhausted_until, last_error, updated_at)
  values (p_usage_date, p_key_hint, p_source, greatest(p_requests_inc, 0), p_exhausted_until, p_error, now())
  on conflict (usage_date, key_hint, source) do update set
    requests = g.requests + greatest(p_requests_inc, 0),
    exhausted_until = coalesce(p_exhausted_until, g.exhausted_until),
    last_error = coalesce(p_error, g.last_error),
    updated_at = now();
end;
$$;

-- Fungsi ini security definer, jadi WAJIB dikunci dari anon/authenticated --
-- cuma service_role (bot & Edge Function) yang boleh memanggil.
revoke all on function public.report_gemini_key_event(date, text, text, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.report_gemini_key_event(date, text, text, integer, timestamptz, text) to service_role;

-- ---------------- 2. wa_quick_replies ----------------

create table if not exists public.wa_quick_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Salah satu kata kunci cocok (sebagai kata/frasa utuh, tidak peduli huruf
  -- besar/kecil & tanda baca) = template ini dipakai & AI TIDAK dipanggil.
  keywords text[] not null,
  reply text not null,
  enabled boolean not null default true,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.wa_quick_replies is 'Template jawaban otomatis WA (tanpa AI), dicocokkan lewat kata kunci. Dikelola dari aplikasi (Pengaturan > Template Jawaban WA).';

alter table public.wa_quick_replies enable row level security;

-- ---------------- 3. wa_retry_queue ----------------

create table if not exists public.wa_retry_queue (
  id uuid primary key default gen_random_uuid(),
  wa_jid text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'expired', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Maksimal SATU antrean 'pending' per kontak (balasan ulang selalu pakai
-- riwayat terbaru, jadi antrean ganda tidak ada gunanya).
create unique index if not exists wa_retry_queue_one_pending_per_jid
  on public.wa_retry_queue (wa_jid)
  where status = 'pending';

create index if not exists wa_retry_queue_status_next_idx
  on public.wa_retry_queue (status, next_attempt_at);

comment on table public.wa_retry_queue is 'Antrean pesan WA yang gagal dibalas AI (mis. semua API key habis kuota), dicoba lagi otomatis oleh bot.';

alter table public.wa_retry_queue enable row level security;

-- ---------------- 4. bot_state ----------------

create table if not exists public.bot_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

comment on table public.bot_state is 'State kecil milik bot WA (mis. tanggal terakhir alert/ringkasan harian terkirim).';

alter table public.bot_state enable row level security;
