-- ================================================================
-- Study: PIN ORANG TUA PER ORANG TUA (menggantikan PIN orang tua bersama di study_settings).
--
-- * study_parents          : satu baris per orang tua (nama unik tanpa membedakan huruf besar-kecil, PIN di-hash PBKDF2 + salt per orang tua).
-- * study_parent_children  : tautan orang tua <-> anak (banyak ke banyak).
-- * study_parent_actions   : log siapa (orang tua) melakukan aksi apa pada anak mana.
-- * study_redemptions.given_by_parent_id : orang tua yang menandai hadiah sudah diberikan.
-- * PIN orang tua bersama lama DINONAKTIFKAN (kolom parent_pin_* di study_settings dikosongkan; kolomnya sengaja tidak dihapus).
--
-- Tidak ada data pemain yang dihapus. Setelah migrasi ini semua anak (grade selain 'Umum') belum punya tautan, sehingga
-- mendapat popup "Buat PIN orang tua" di login berikutnya; sampai ada PIN, semua aksi orang tua terkunci.
-- Lupa PIN: jalankan supabase/ops/reset-pin-ortu.sql (tidak ada PIN master).
-- RLS aktif tanpa policy (terkunci dari anon key); semua lewat Edge Function `study`. Aman dijalankan ulang. Butuh migrasi 0023.
-- ================================================================

create table if not exists public.study_parents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  pin_salt text not null,
  pin_hash text not null,
  pin_failures integer not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists study_parents_name_ci on public.study_parents (lower(btrim(name)));

create table if not exists public.study_parent_children (
  parent_id uuid not null references public.study_parents (id) on delete cascade,
  player_id uuid not null references public.study_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, player_id)
);
create index if not exists study_parent_children_player_idx on public.study_parent_children (player_id);

create table if not exists public.study_parent_actions (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.study_parents (id) on delete set null,
  parent_name text not null,
  action text not null,
  player_id uuid references public.study_players (id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists study_parent_actions_created_idx on public.study_parent_actions (created_at desc);

alter table public.study_redemptions add column if not exists given_by_parent_id uuid references public.study_parents (id) on delete set null;

alter table public.study_parents enable row level security;
alter table public.study_parent_children enable row level security;
alter table public.study_parent_actions enable row level security;

-- PIN orang tua bersama lama tidak berlaku lagi.
update public.study_settings
   set parent_pin_salt = null, parent_pin_hash = null, parent_pin_failures = 0, parent_pin_locked_until = null, updated_at = now()
 where id = 1;
