-- ================================================================
-- Ringkasan Harian - skema database awal
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run),
-- atau via `supabase db push` kalau pakai Supabase CLI.
-- ================================================================

-- Tabel utama: satu baris = satu ringkasan berita untuk satu tanggal.
create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  summary_date date not null unique,
  content_id text not null,           -- ringkasan lengkap, Bahasa Indonesia (markdown sederhana)
  content_en text,                    -- ringkasan lengkap, Bahasa Inggris
  sources jsonb not null default '[]'::jsonb, -- [{ "title", "url", "source", "category" }]
  model text,                         -- nama model LLM yang dipakai, utk audit
  status text not null default 'ok',  -- 'ok' | 'partial' | 'failed'
  error text,                         -- pesan error kalau status != 'ok'
  created_at timestamptz not null default now()
);

comment on table public.summaries is 'Ringkasan berita harian dunia + Indonesia, dibuat otomatis tiap jam 20:00 WITA.';

-- Tabel subscription push notification (satu baris per perangkat yang subscribe).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.push_subscriptions is 'Web Push subscription dari perangkat (iPhone/PWA) yang mengaktifkan notifikasi.';

-- Index untuk query "ringkasan 30 hari terakhir" di halaman riwayat.
create index if not exists summaries_date_idx on public.summaries (summary_date desc);

-- ================================================================
-- Row Level Security
-- Aplikasi ini dipakai sendiri (personal), tapi anon key tetap publik
-- secara desain (dibaca oleh browser siapa saja yang membuka PWA-nya),
-- jadi kita kunci apa yang boleh dilakukan oleh anon key:
--   - summaries       : boleh dibaca semua orang, TIDAK boleh ditulis/diubah lewat anon key
--   - push_subscriptions : boleh DITAMBAH (insert) oleh anon key (supaya device bisa subscribe
--                          sendiri dari browser), tapi TIDAK boleh dibaca/diubah/dihapus.
-- Insert & update summaries hanya lewat Edge Function pakai service_role key
-- (service_role otomatis bypass RLS).
-- ================================================================

alter table public.summaries enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "summaries_public_read" on public.summaries;
create policy "summaries_public_read"
  on public.summaries for select
  to anon, authenticated
  using (true);

drop policy if exists "push_subscriptions_public_insert" on public.push_subscriptions;
create policy "push_subscriptions_public_insert"
  on public.push_subscriptions for insert
  to anon, authenticated
  with check (true);

-- Izinkan browser update last_seen_at / upsert endpoint yang sama (on conflict).
drop policy if exists "push_subscriptions_public_update_own" on public.push_subscriptions;
create policy "push_subscriptions_public_update_own"
  on public.push_subscriptions for update
  to anon, authenticated
  using (true)
  with check (true);
