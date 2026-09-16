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
--   - summaries          : boleh dibaca semua orang, TIDAK boleh ditulis/diubah lewat anon key.
--   - push_subscriptions : TIDAK boleh dibaca/ditulis/diubah sama sekali lewat anon key.
--
-- Kenapa push_subscriptions dikunci total (bukan dikasih izin insert kayak
-- versi awal)? Karena aplikasi menyimpan subscription pakai UPSERT
-- (ON CONFLICT DO UPDATE), dan menurut dokumentasi Postgres, UPSERT jenis
-- itu SELALU butuh izin SELECT pada tabelnya -- walau barisnya baru pertama
-- kali di-insert. Kalau anon dikasih izin SELECT supaya upsert-nya lolos,
-- konsekuensinya semua orang jadi bisa baca endpoint+keys push subscription
-- siapa saja (bisa disalahgunakan buat spam kirim notifikasi ke device
-- orang). Jadi penyimpanan subscription lewat Edge Function `subscribe`
-- (jalan pakai service_role, otomatis bypass RLS) -- lihat
-- supabase/functions/subscribe/index.ts.
-- ================================================================

alter table public.summaries enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "summaries_public_read" on public.summaries;
create policy "summaries_public_read"
  on public.summaries for select
  to anon, authenticated
  using (true);

-- Sengaja TIDAK ada policy apa pun untuk anon/authenticated di
-- push_subscriptions -- RLS aktif + nol policy = akses langsung ditolak
-- total. service_role (dipakai Edge Function) tetap bisa baca/tulis
-- normal karena service_role selalu bypass RLS.
