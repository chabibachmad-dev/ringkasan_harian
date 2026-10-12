-- ================================================================
-- Menu "Study": LATIHAN SPEAKING BAHASA INGGRIS (mengobrol dengan tutor AI).
--
-- Pemain memilih skenario (perkenalan, restoran, sekolah, dst.) lalu mengobrol dengan AI lewat suara (peramban: SpeechRecognition +
-- speechSynthesis) atau ketikan. Edge Function `study` (aksi speak_*) yang memanggil AI; tabel ini hanya menyimpan riwayatnya.
--   - study_speak_sessions : satu percakapan (pemilik, skenario, jumlah giliran pemain, waktu).
--   - study_speak_turns    : isi percakapan (role 'user' | 'ai'); giliran AI membawa koreksi singkat atas kalimat pemain.
-- RIWAYAT DISIMPAN 7 HARI SAJA: aplikasi hanya menampilkan sesi yang terakhir aktif <= 7 hari lalu, dan study_speak_purge()
-- menghapus yang lebih lama (dipanggil Edge Function secara berkala; boleh juga dijadwalkan). Tidak ada poin untuk latihan ini.
-- Seperti tabel study lain: RLS aktif tanpa policy (terkunci total dari anon key); semua lewat Edge Function.
-- Aman dijalankan ulang. Butuh migrasi 0023.
-- ================================================================

create table if not exists public.study_speak_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.study_players (id) on delete cascade,
  scenario text not null check (char_length(btrim(scenario)) between 1 and 40),
  topic text not null default '' check (char_length(topic) <= 100),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  grade text not null default 'Umum',
  class_level integer,
  user_turns integer not null default 0 check (user_turns >= 0),
  provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists study_speak_sessions_player_idx on public.study_speak_sessions (player_id, updated_at desc);
create index if not exists study_speak_sessions_updated_idx on public.study_speak_sessions (updated_at);

create table if not exists public.study_speak_turns (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.study_speak_sessions (id) on delete cascade,
  idx integer not null check (idx >= 0),
  role text not null check (role in ('user', 'ai')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  correction text,
  tip text,
  created_at timestamptz not null default now(),
  unique (session_id, idx)
);

create index if not exists study_speak_turns_time_idx on public.study_speak_turns (created_at desc);

alter table public.study_speak_sessions enable row level security;
alter table public.study_speak_turns enable row level security;

-- Hapus sesi (beserta giliran-gilirannya) yang terakhir aktif lebih dari p_days hari lalu. Mengembalikan jumlah sesi terhapus.
create or replace function public.study_speak_purge(p_days integer default 7)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.study_speak_sessions where updated_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Jumlah giliran pemain (pesan 'user') dalam 24 jam terakhir: pemain itu (p_player) dan semua pemain. Dipakai pembatas harian.
create or replace function public.study_speak_usage(p_player uuid)
returns table (mine bigint, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where s.player_id = p_player),
    count(*)
  from public.study_speak_turns t
  join public.study_speak_sessions s on s.id = t.session_id
  where t.role = 'user' and t.created_at >= now() - interval '24 hours';
$$;

revoke all on function public.study_speak_purge(integer) from public, anon, authenticated;
revoke all on function public.study_speak_usage(uuid) from public, anon, authenticated;
grant execute on function public.study_speak_purge(integer) to service_role;
grant execute on function public.study_speak_usage(uuid) to service_role;
