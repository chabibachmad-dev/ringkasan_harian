-- ================================================================
-- Al-Qur'an: "terakhir dibaca" (last read) + bookmark per ayat.
--
-- Diakses HANYA lewat Edge Function `chat` (service role) dengan kode akses
-- yang sama seperti fitur lain -- jadi tabelnya dikunci total dari anon key
-- (RLS aktif, tanpa policy apa pun), sama seperti chat_messages.
--
-- Satu pengguna = satu baris last_read (id selalu 'main'). Bookmark unik per
-- (surah, ayah).
--
-- Jalankan di Supabase Dashboard > SQL Editor (Run), atau `npx supabase db push`.
-- ================================================================

create table if not exists public.quran_last_read (
  id text primary key default 'main',
  surah smallint not null check (surah between 1 and 114),
  ayah smallint not null check (ayah >= 1),
  page smallint not null check (page between 1 and 604),
  updated_at timestamptz not null default now()
);

create table if not exists public.quran_bookmarks (
  id bigint generated always as identity primary key,
  surah smallint not null check (surah between 1 and 114),
  ayah smallint not null check (ayah >= 1),
  page smallint not null check (page between 1 and 604),
  created_at timestamptz not null default now(),
  unique (surah, ayah)
);

create index if not exists quran_bookmarks_created_idx on public.quran_bookmarks (created_at desc);

alter table public.quran_last_read enable row level security;
alter table public.quran_bookmarks enable row level security;

comment on table public.quran_last_read is 'Posisi terakhir baca Al-Qur''an (satu baris, id=main). Diakses lewat Edge Function chat.';
comment on table public.quran_bookmarks is 'Bookmark ayat Al-Qur''an (unik per surah+ayah). Diakses lewat Edge Function chat.';
