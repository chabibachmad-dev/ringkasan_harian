-- ================================================================
-- Fitur diskusi/chat pribadi -- disimpan per tanggal (WITA), terpisah
-- dari ringkasan berita harian. Jalankan file ini di Supabase Dashboard
-- > SQL Editor (Run), atau via `npx supabase db push`.
-- ================================================================

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_date date not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

comment on table public.chat_messages is 'Riwayat diskusi/chat pribadi, dikelompokkan per tanggal (WITA). Tiap tanggal berdiri sendiri (obrolan baru tiap hari).';

create index if not exists chat_messages_date_idx on public.chat_messages (chat_date, created_at);

-- ================================================================
-- Row Level Security
-- Sama seperti push_subscriptions: tabel ini dikunci TOTAL dari anon key,
-- karena isinya percakapan pribadi (bukan konten publik seperti ringkasan
-- berita). Semua baca/tulis wajib lewat Edge Function `chat`, yang jalan
-- pakai service_role (bypass RLS) DAN memverifikasi kode akses
-- (secret CHAT_ACCESS_CODE) sebelum mengizinkan apa pun.
-- ================================================================

alter table public.chat_messages enable row level security;

-- Sengaja TIDAK ada policy apa pun untuk anon/authenticated di sini --
-- RLS aktif + nol policy = akses langsung dari browser ditolak total.
