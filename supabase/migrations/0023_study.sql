-- ================================================================
-- Menu "Study": latihan soal pilihan ganda buatan AI untuk beberapa pemain (anak/keluarga),
-- dengan poin, papan peringkat, penukaran poin (redeem), dan hukuman poin manual.
--
-- Semua tabel dikunci TOTAL dari anon key (RLS aktif, nol policy) -- sama seperti chat_messages.
-- Semua baca/tulis lewat Edge Function `study` (service_role) yang memeriksa kode akses.
-- KUNCI JAWABAN (study_questions.correct_index) tidak pernah dikirim ke browser sebelum soal
-- dikumpulkan, jadi tidak bisa diintip dari DevTools.
--
-- Poin dihitung di database (fungsi study_submit_session), bukan oleh AI:
--   poin = bulatkan( poin_dasar x (benar / jumlah_soal) x bobot_level / 100 )
--   contoh 15 soal benar semua, poin dasar 100: easy (80%) = 80, normal = 100, hard (120%) = 120.
-- Saldo pemain = jumlah kolom points di study_ledger (poin sesi bernilai +, redeem/hukuman bernilai -).
-- Papan peringkat memakai TOTAL poin yang pernah didapat dari pelajaran (bukan saldo), jadi peringkat
-- tidak turun karena redeem atau hukuman.
--
-- Aman dijalankan ulang. Jalankan di Supabase Dashboard > SQL Editor, atau `npx supabase db push`.
-- ================================================================

-- ---------------------------------------------------------------- Pemain
create table if not exists public.study_players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  grade text not null check (grade in ('TK', 'SD', 'SMP', 'SMA', 'S1', 'S2', 'S3', 'Umum')),
  pin_salt text not null,
  pin_hash text not null,
  pin_failures integer not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists study_players_name_ci on public.study_players (lower(btrim(name)));

comment on table public.study_players is 'Pemain menu Study. PIN disimpan sebagai hash PBKDF2 + salt (bukan teks asli).';

-- ---------------------------------------------------------------- Setting (satu baris)
create table if not exists public.study_settings (
  id smallint primary key default 1 check (id = 1),
  base_points integer not null default 100 check (base_points between 1 and 100000),
  weight_easy integer not null default 80 check (weight_easy between 1 and 1000),
  weight_normal integer not null default 100 check (weight_normal between 1 and 1000),
  weight_hard integer not null default 120 check (weight_hard between 1 and 1000),
  subjects jsonb not null default '["Matematika","IPA (Sains)","IPS","Bahasa Indonesia","Bahasa Inggris","PPKn","Pendidikan Agama Islam","Informatika (Coding)","Pengetahuan Umum"]'::jsonb,
  parent_pin_salt text,
  parent_pin_hash text,
  parent_pin_failures integer not null default 0,
  parent_pin_locked_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.study_settings (id) values (1) on conflict (id) do nothing;

comment on table public.study_settings is 'Setting Study (satu baris): poin dasar, bobot level (%), daftar pelajaran, dan PIN orang tua (hash).';

-- ---------------------------------------------------------------- Sesi & soal
create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.study_players (id) on delete cascade,
  subject text not null,
  topic text,
  material_grade text not null check (material_grade in ('TK', 'SD', 'SMP', 'SMA', 'S1', 'S2', 'S3', 'Umum')),
  level text not null check (level in ('easy', 'normal', 'hard')),
  num_questions integer not null check (num_questions between 1 and 50),
  status text not null default 'active' check (status in ('active', 'submitted')),
  provider text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  correct_count integer,
  weight_percent integer,
  base_points integer,
  points_awarded integer
);

create index if not exists study_sessions_player_idx on public.study_sessions (player_id, created_at desc);

create table if not exists public.study_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  idx integer not null,
  question text not null,
  options jsonb not null,
  correct_index smallint not null check (correct_index between 0 and 3),
  user_answer smallint check (user_answer between 0 and 3),
  explanation text,
  doubtful boolean not null default false,
  unique (session_id, idx)
);

comment on column public.study_questions.correct_index is 'Kunci jawaban (0=A .. 3=D). Tidak boleh dikirim ke klien sebelum sesi dikumpulkan.';
comment on column public.study_questions.doubtful is 'true bila saat membuat pembahasan AI menilai kunci jawabannya meragukan.';

-- ---------------------------------------------------------------- Buku besar poin
create table if not exists public.study_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.study_players (id) on delete cascade,
  kind text not null check (kind in ('session', 'redeem', 'penalty')),
  points integer not null,
  note text,
  ref_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists study_ledger_player_idx on public.study_ledger (player_id, created_at desc);

-- ---------------------------------------------------------------- Hadiah (redeem)
create table if not exists public.study_redeem_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  cost integer not null check (cost between 1 and 10000000),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.study_redeem_items (name, cost, sort)
select v.name, v.cost, v.sort
from (values
  ('Voucher Indomaret/Alfamart Rp20.000', 2000, 1),
  ('Voucher Marugame Udon', 8000, 2),
  ('Voucher Pizza', 15000, 3)
) as v(name, cost, sort)
where not exists (select 1 from public.study_redeem_items);

create table if not exists public.study_redemptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.study_players (id) on delete cascade,
  item_id uuid references public.study_redeem_items (id) on delete set null,
  item_name text not null,
  cost integer not null,
  status text not null default 'pending' check (status in ('pending', 'given')),
  created_at timestamptz not null default now(),
  given_at timestamptz
);

create index if not exists study_redemptions_player_idx on public.study_redemptions (player_id, created_at desc);

-- ---------------------------------------------------------------- RLS: kunci total dari anon
alter table public.study_players enable row level security;
alter table public.study_settings enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_questions enable row level security;
alter table public.study_ledger enable row level security;
alter table public.study_redeem_items enable row level security;
alter table public.study_redemptions enable row level security;
-- Sengaja TIDAK ada policy untuk anon/authenticated: akses langsung dari browser ditolak total.

-- ---------------------------------------------------------------- Fungsi
create or replace function public.study_balance(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(points), 0)::integer from public.study_ledger where player_id = p_player;
$$;

-- Papan peringkat: urut TOTAL poin pelajaran terbesar di paling atas (lalu jumlah pelajaran, lalu nama).
create or replace function public.study_leaderboard()
returns table (id uuid, name text, grade text, sessions_done integer, total_points integer, balance integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.grade,
    (select count(*) from public.study_sessions s where s.player_id = p.id and s.status = 'submitted')::integer,
    coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p.id and l.kind = 'session'), 0)::integer,
    public.study_balance(p.id)
  from public.study_players p
  order by 5 desc, 4 desc, lower(p.name) asc;
$$;

-- Kumpulkan sesi: simpan jawaban, hitung benar/poin (di sini, bukan oleh AI), catat ke buku besar.
-- p_answers = array JSON sepanjang jumlah soal; tiap elemen 0..3 atau null (tidak dijawab = salah).
-- Dipanggil dua kali untuk sesi yang sama TIDAK memberi poin dua kali (mengembalikan hasil lama dengan already=true).
create or replace function public.study_submit_session(p_session uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.study_sessions%rowtype;
  cfg public.study_settings%rowtype;
  total integer;
  correct integer;
  weight integer;
  pts integer;
begin
  select * into s from public.study_sessions where id = p_session for update;
  if not found then
    raise exception 'SESI_TIDAK_ADA';
  end if;

  select count(*) into total from public.study_questions where session_id = p_session;
  if total = 0 then
    raise exception 'SESI_KOSONG';
  end if;

  if s.status = 'submitted' then
    return jsonb_build_object(
      'already', true,
      'correct', s.correct_count,
      'total', total,
      'weightPercent', s.weight_percent,
      'basePoints', s.base_points,
      'points', s.points_awarded
    );
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'JAWABAN_TIDAK_VALID';
  end if;

  update public.study_questions q
  set user_answer = a.ans
  from (
    select
      (e.ord - 1)::integer as idx,
      case
        when jsonb_typeof(e.val) = 'number' and (e.val #>> '{}') in ('0', '1', '2', '3') then (e.val #>> '{}')::smallint
        else null
      end as ans
    from jsonb_array_elements(p_answers) with ordinality as e(val, ord)
  ) a
  where q.session_id = p_session and q.idx = a.idx;

  select count(*) into correct
  from public.study_questions
  where session_id = p_session and user_answer is not null and user_answer = correct_index;

  select * into cfg from public.study_settings where id = 1;
  weight := case s.level when 'easy' then cfg.weight_easy when 'hard' then cfg.weight_hard else cfg.weight_normal end;
  pts := round(cfg.base_points::numeric * correct / total * weight / 100)::integer;

  update public.study_sessions
  set status = 'submitted',
      submitted_at = now(),
      correct_count = correct,
      weight_percent = weight,
      base_points = cfg.base_points,
      points_awarded = pts
  where id = p_session;

  if pts > 0 then
    insert into public.study_ledger (player_id, kind, points, note, ref_id, meta)
    values (
      s.player_id, 'session', pts,
      s.subject,
      p_session,
      jsonb_build_object('correct', correct, 'total', total, 'level', s.level, 'weightPercent', weight)
    );
  end if;

  return jsonb_build_object(
    'already', false,
    'correct', correct,
    'total', total,
    'weightPercent', weight,
    'basePoints', cfg.base_points,
    'points', pts
  );
end;
$$;

-- Tukar poin dengan hadiah. Saldo harus cukup; poin langsung berkurang; riwayat berstatus 'pending'.
create or replace function public.study_redeem(p_player uuid, p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.study_redeem_items%rowtype;
  bal integer;
  rid uuid;
begin
  perform 1 from public.study_players where id = p_player for update;
  if not found then
    raise exception 'PEMAIN_TIDAK_ADA';
  end if;
  select * into it from public.study_redeem_items where id = p_item;
  if not found then
    raise exception 'HADIAH_TIDAK_ADA';
  end if;
  bal := public.study_balance(p_player);
  if bal < it.cost then
    raise exception 'SALDO_KURANG';
  end if;

  insert into public.study_redemptions (player_id, item_id, item_name, cost)
  values (p_player, it.id, it.name, it.cost)
  returning id into rid;

  insert into public.study_ledger (player_id, kind, points, note, ref_id)
  values (p_player, 'redeem', -it.cost, it.name, rid);

  return jsonb_build_object('redemptionId', rid, 'itemName', it.name, 'cost', it.cost, 'balance', bal - it.cost);
end;
$$;

-- Hukuman manual: kurangi poin. Saldo tidak pernah di bawah 0 -- pengurangan berhenti di 0
-- (applied = yang benar-benar terpotong, requested = yang diminta).
create or replace function public.study_apply_penalty(p_player uuid, p_points integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bal integer;
  applied integer;
begin
  if p_points is null or p_points <= 0 then
    raise exception 'POIN_TIDAK_VALID';
  end if;
  perform 1 from public.study_players where id = p_player for update;
  if not found then
    raise exception 'PEMAIN_TIDAK_ADA';
  end if;
  bal := public.study_balance(p_player);
  applied := least(p_points, bal);
  if applied > 0 then
    insert into public.study_ledger (player_id, kind, points, note, meta)
    values (p_player, 'penalty', -applied, nullif(btrim(coalesce(p_reason, '')), ''), jsonb_build_object('requested', p_points));
  end if;
  return jsonb_build_object('requested', p_points, 'applied', applied, 'balance', bal - applied);
end;
$$;

-- Hanya service_role (Edge Function) yang boleh memanggil -- bukan anon/authenticated lewat PostgREST.
revoke all on function public.study_balance(uuid) from public, anon, authenticated;
revoke all on function public.study_leaderboard() from public, anon, authenticated;
revoke all on function public.study_submit_session(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.study_redeem(uuid, uuid) from public, anon, authenticated;
revoke all on function public.study_apply_penalty(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.study_balance(uuid) to service_role;
grant execute on function public.study_leaderboard() to service_role;
grant execute on function public.study_submit_session(uuid, jsonb) to service_role;
grant execute on function public.study_redeem(uuid, uuid) to service_role;
grant execute on function public.study_apply_penalty(uuid, integer, text) to service_role;
