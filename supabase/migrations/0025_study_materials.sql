-- ================================================================
-- Menu "Study": MATERI PELAJARAN buatan AI (tab "Materi" di samping Leaderboard) + pembatas pemakaian AI.
--
-- Materi dibuat oleh pemain (dengan PIN) lewat Edge Function `study`, disimpan di sini, dan DAFTARNYA bisa dilihat
-- semua orang tanpa PIN. Menu Study tidak lagi memakai kode akses chat, jadi ada pembatas:
--   - study_gen_log mencatat tiap permintaan pembuatan soal/materi (dipakai untuk batas per pemain & global per 24 jam);
--   - batas jumlah pemain dan batas harian ada di Edge Function (lihat konstanta di study/index.ts).
-- Seperti tabel study lain: RLS aktif tanpa policy (terkunci total dari anon key); semua lewat Edge Function.
-- Hapus pemain tidak menghapus materinya (nama pembuat disimpan terpisah di creator_name).
--
-- Aman dijalankan ulang. Butuh migrasi 0023.
-- ================================================================

create table if not exists public.study_materials (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.study_players (id) on delete set null,
  creator_name text not null check (char_length(btrim(creator_name)) between 1 and 30),
  subject text not null check (char_length(btrim(subject)) between 1 and 60),
  grade text not null check (grade in ('TK', 'SD', 'SMP', 'SMA', 'S1', 'S2', 'S3', 'Umum')),
  detail text not null check (char_length(btrim(detail)) between 1 and 300),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  content text not null check (char_length(content) between 1 and 40000),
  provider text,
  created_at timestamptz not null default now()
);

create index if not exists study_materials_created_idx on public.study_materials (created_at desc);

create table if not exists public.study_gen_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('lesson', 'material')),
  player_id uuid references public.study_players (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists study_gen_log_time_idx on public.study_gen_log (created_at desc);
create index if not exists study_gen_log_player_idx on public.study_gen_log (player_id, created_at desc);

alter table public.study_materials enable row level security;
alter table public.study_gen_log enable row level security;
