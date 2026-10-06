-- ================================================================
-- 1) Lampiran file di chat (PDF/teks yang teksnya diekstrak di browser), per
--    obrolan. Dipakai Gemini (lewat Edge Function) maupun Ollama (lewat bot).
--    Ikut terhapus saat obrolan dihapus. Dikunci total dari anon key (RLS
--    aktif, tanpa policy) -- diakses hanya lewat Edge Function `chat`/bot.
-- 2) Target khatam Al-Qur'an (satu baris, id='main').
-- 3) Info tambahan denyut bot untuk halaman "Status sistem".
--
-- Jalankan di Supabase Dashboard > SQL Editor (Run), atau `npx supabase db push`.
-- ================================================================

create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  chat_date text not null,                -- ID obrolan ("freeform-<uuid>")
  name text not null,                     -- nama file
  char_count integer not null default 0,
  content text not null,                  -- teks hasil ekstrak
  created_at timestamptz not null default now()
);
create index if not exists chat_attachments_chat_idx on public.chat_attachments (chat_date, created_at);
alter table public.chat_attachments enable row level security;
comment on table public.chat_attachments is 'Lampiran file per obrolan (teks hasil ekstrak di browser). Diakses lewat Edge Function chat & bot.';

create table if not exists public.quran_khatam (
  id text primary key default 'main',
  start_date date not null,               -- tanggal mulai (tanggal lokal pengguna)
  target_days smallint not null check (target_days between 1 and 730),
  start_page smallint not null default 1 check (start_page between 1 and 604),
  reminder boolean not null default true, -- bot kirim push pengingat harian bila target hari ini belum tercapai
  khatam_count smallint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.quran_khatam enable row level security;
comment on table public.quran_khatam is 'Target khatam Al-Qur''an (satu baris, id=main). Diakses lewat Edge Function chat & bot.';

alter table public.agent_worker_status add column if not exists wa_connected boolean;
alter table public.agent_worker_status add column if not exists started_at timestamptz;
alter table public.agent_worker_status add column if not exists extra jsonb;
