-- ================================================================
-- Menu "Study": LOGIN PERANGKAT (masuk sekali, tetap masuk sampai Keluar).
--
-- Setelah pemain memasukkan PIN, server memberi TOKEN acak untuk perangkat itu. Peramban menyimpan token (bukan PIN)
-- dan memakainya sebagai pengganti PIN di semua aksi pemain, sehingga PIN tidak tersimpan di perangkat.
-- Di sini hanya hash SHA-256 token yang disimpan; token asli tidak bisa dibaca ulang.
--   - Keluar        : token perangkat itu dihapus.
--   - PIN direset   : semua token pemain itu dihapus (semua perangkat harus masuk lagi).
--   - Pemain dihapus: token ikut terhapus (on delete cascade).
-- Seperti tabel study lain: RLS aktif tanpa policy (terkunci total dari anon key); semua lewat Edge Function.
--
-- Aman dijalankan ulang. Butuh migrasi 0023.
-- ================================================================

create table if not exists public.study_device_tokens (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.study_players (id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists study_device_tokens_player_idx on public.study_device_tokens (player_id, created_at desc);

alter table public.study_device_tokens enable row level security;
revoke all on public.study_device_tokens from anon, authenticated;
