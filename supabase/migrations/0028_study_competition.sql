-- ================================================================
-- Menu "Study": KOMPETISI (room), TIMELINE GLOBAL, dan PROFIL PUBLIK.
--
-- Kompetisi:
--   - Pembuat room memilih pelajaran, tingkat/kelas, level, jumlah soal, dan waktu. Soal dibuat AI SEKALI saat room dibuat.
--   - Pemain lain bergabung di lobi (maks. 10 pemain). Pembuat menekan Mulai (minimal 2 pemain): semua mengerjakan
--     soal yang sama serentak dengan batas waktu yang sama (dihitung server dari saat Mulai).
--   - Poin tiap pemain memakai rumus solo (poin per soal x benar x bobot level, bonus nilai sempurna).
--     Skor tertinggi MENANG dan mendapat tambahan poin (setting competition_win_bonus, bawaan 10).
--     Seri skor: yang mengumpulkan lebih cepat menang. Skor tertinggi 0 = tidak ada pemenang.
--   - Selesai bila semua sudah mengumpulkan atau waktu habis + toleransi 30 detik (dicek "malas" setiap ada permintaan,
--     tanpa penjadwal). Lobi yang menganggur > 30 menit dibatalkan. Satu pemain hanya boleh di satu room aktif.
--   - Poin masuk buku besar (kind 'competition' dan 'competition_bonus') sehingga ikut total poin, saldo, dan leaderboard.
--
-- Timeline global: study_feed() menggabungkan pelajaran solo selesai, kompetisi selesai, dan materi baru (urut waktu),
-- bisa disaring per pemain dan per jenis. Suka & komentar kini berlaku untuk ketiga jenis kegiatan itu.
--
-- Semua tabel baru terkunci (RLS aktif, nol policy); akses hanya lewat Edge Function `study` (service_role).
-- Aman dijalankan ulang. Butuh migrasi 0023-0027.
-- ================================================================

-- ---------------------------------------------------------------- buku besar & setting
do $$
begin
  alter table public.study_ledger drop constraint if exists study_ledger_kind_check;
  alter table public.study_ledger add constraint study_ledger_kind_check
    check (kind in ('session', 'redeem', 'penalty', 'competition', 'competition_bonus'));
end $$;

alter table public.study_settings add column if not exists competition_win_bonus integer not null default 10
  check (competition_win_bonus between 0 and 1000);

-- ---------------------------------------------------------------- tabel kompetisi
create table if not exists public.study_rooms (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.study_players (id) on delete set null,
  creator_name text not null,
  subject text not null,
  topic text,
  material_grade text not null check (material_grade in ('TK', 'SD', 'SMP', 'SMA', 'S1', 'S2', 'S3', 'Umum')),
  material_class smallint,
  level text not null check (level in ('easy', 'normal', 'hard')),
  num_questions integer not null check (num_questions between 1 and 50),
  time_limit_seconds integer not null check (time_limit_seconds between 60 and 7200),
  max_players integer not null default 10 check (max_players between 2 and 20),
  -- jepretan setting saat room dibuat, supaya perubahan setting tidak mengubah hasil room yang sedang berjalan
  per_question_points integer not null,
  perfect_bonus_percent integer not null,
  weight_percent integer not null,
  win_bonus integer not null,
  provider text,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'finished', 'cancelled')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ends_at timestamptz,
  finished_at timestamptz,
  winner_id uuid references public.study_players (id) on delete set null,
  winner_name text,
  constraint study_rooms_class_chk check (
    material_class is null
    or (material_grade = 'SD' and material_class between 1 and 6)
    or (material_grade = 'SMP' and material_class between 7 and 9)
    or (material_grade = 'SMA' and material_class between 10 and 12)
  )
);

create index if not exists study_rooms_status_idx on public.study_rooms (status, created_at desc);
create index if not exists study_rooms_finished_idx on public.study_rooms (finished_at desc) where status = 'finished';

create table if not exists public.study_room_questions (
  room_id uuid not null references public.study_rooms (id) on delete cascade,
  idx integer not null,
  question text not null,
  options jsonb not null,
  correct_index smallint not null check (correct_index between 0 and 3),
  primary key (room_id, idx)
);

create table if not exists public.study_room_players (
  room_id uuid not null references public.study_rooms (id) on delete cascade,
  player_id uuid not null references public.study_players (id) on delete cascade,
  joined_at timestamptz not null default now(),
  answers jsonb,
  submitted_at timestamptz,
  correct_count integer,
  timed_out boolean not null default false,
  rank integer,
  points_awarded integer not null default 0,
  bonus_points integer not null default 0,
  primary key (room_id, player_id)
);

create index if not exists study_room_players_player_idx on public.study_room_players (player_id, joined_at desc);

alter table public.study_rooms enable row level security;
alter table public.study_room_questions enable row level security;
alter table public.study_room_players enable row level security;
comment on column public.study_room_questions.correct_index is 'Kunci jawaban room. Tidak boleh dikirim ke klien.';

-- ---------------------------------------------------------------- suka & komentar untuk semua jenis kegiatan
alter table public.study_likes drop constraint if exists study_likes_pkey;
alter table public.study_likes alter column session_id drop not null;
alter table public.study_likes add column if not exists room_id uuid references public.study_rooms (id) on delete cascade;
alter table public.study_likes add column if not exists material_id uuid references public.study_materials (id) on delete cascade;
create unique index if not exists study_likes_session_uq on public.study_likes (session_id, player_id) where session_id is not null;
create unique index if not exists study_likes_room_uq on public.study_likes (room_id, player_id) where room_id is not null;
create unique index if not exists study_likes_material_uq on public.study_likes (material_id, player_id) where material_id is not null;

alter table public.study_comments alter column session_id drop not null;
alter table public.study_comments add column if not exists room_id uuid references public.study_rooms (id) on delete cascade;
alter table public.study_comments add column if not exists material_id uuid references public.study_materials (id) on delete cascade;
create index if not exists study_comments_room_idx on public.study_comments (room_id, created_at) where room_id is not null;
create index if not exists study_comments_material_idx on public.study_comments (material_id, created_at) where material_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'study_likes_one_target_chk') then
    alter table public.study_likes add constraint study_likes_one_target_chk check (num_nonnulls(session_id, room_id, material_id) = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'study_comments_one_target_chk') then
    alter table public.study_comments add constraint study_comments_one_target_chk check (num_nonnulls(session_id, room_id, material_id) = 1);
  end if;
end $$;

-- Pemeriksaan umum sebelum suka/komentar. p_kind: 'lesson' | 'competition' | 'material'.
-- Kegiatan sendiri tidak boleh disuka/dikomentari (pelajaran: pemiliknya; materi: pembuatnya).
-- Kompetisi terbuka bagi semua pemain (itu kegiatan bersama).
create or replace function public.study_post_check(p_kind text, p_id uuid, p_player uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner uuid;
  st text;
begin
  if p_kind = 'lesson' then
    select player_id, status into owner, st from public.study_sessions where id = p_id;
    if not found or st <> 'submitted' then raise exception 'KEGIATAN_TIDAK_ADA'; end if;
    if owner = p_player then raise exception 'KEGIATAN_SENDIRI'; end if;
  elsif p_kind = 'competition' then
    select status into st from public.study_rooms where id = p_id;
    if not found or st <> 'finished' then raise exception 'KEGIATAN_TIDAK_ADA'; end if;
  elsif p_kind = 'material' then
    select creator_id into owner from public.study_materials where id = p_id;
    if not found then raise exception 'KEGIATAN_TIDAK_ADA'; end if;
    if owner is not null and owner = p_player then raise exception 'KEGIATAN_SENDIRI'; end if;
  else
    raise exception 'KEGIATAN_TIDAK_ADA';
  end if;
  perform 1 from public.study_players where id = p_player;
  if not found then raise exception 'PEMAIN_TIDAK_ADA'; end if;
end;
$$;

create or replace function public.study_post_like(p_kind text, p_id uuid, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  was_deleted integer;
  now_liked boolean;
  total integer;
begin
  perform public.study_post_check(p_kind, p_id, p_player);
  if p_kind = 'lesson' then
    delete from public.study_likes where session_id = p_id and player_id = p_player;
  elsif p_kind = 'competition' then
    delete from public.study_likes where room_id = p_id and player_id = p_player;
  else
    delete from public.study_likes where material_id = p_id and player_id = p_player;
  end if;
  get diagnostics was_deleted = row_count;
  if was_deleted > 0 then
    now_liked := false;
  else
    if p_kind = 'lesson' then
      insert into public.study_likes (session_id, player_id) values (p_id, p_player) on conflict do nothing;
    elsif p_kind = 'competition' then
      insert into public.study_likes (room_id, player_id) values (p_id, p_player) on conflict do nothing;
    else
      insert into public.study_likes (material_id, player_id) values (p_id, p_player) on conflict do nothing;
    end if;
    now_liked := true;
  end if;
  select count(*) into total from public.study_likes
    where (p_kind = 'lesson' and session_id = p_id) or (p_kind = 'competition' and room_id = p_id) or (p_kind = 'material' and material_id = p_id);
  return jsonb_build_object('liked', now_liked, 'count', total);
end;
$$;

create or replace function public.study_post_comment(p_kind text, p_id uuid, p_player uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(coalesce(p_body, ''));
  c public.study_comments;
  mine integer;
  total integer;
begin
  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'KOMENTAR_TIDAK_VALID';
  end if;
  -- kunci baris kegiatan supaya batas jumlah komentar tidak terlewati oleh permintaan bersamaan
  if p_kind = 'lesson' then
    perform 1 from public.study_sessions where id = p_id for update;
  elsif p_kind = 'competition' then
    perform 1 from public.study_rooms where id = p_id for update;
  elsif p_kind = 'material' then
    perform 1 from public.study_materials where id = p_id for update;
  end if;
  perform public.study_post_check(p_kind, p_id, p_player);
  select count(*) filter (where player_id = p_player), count(*) into mine, total from public.study_comments
    where (p_kind = 'lesson' and session_id = p_id) or (p_kind = 'competition' and room_id = p_id) or (p_kind = 'material' and material_id = p_id);
  if mine >= 10 or total >= 200 then
    raise exception 'KOMENTAR_PENUH';
  end if;
  if p_kind = 'lesson' then
    insert into public.study_comments (session_id, player_id, body) values (p_id, p_player, clean) returning * into c;
  elsif p_kind = 'competition' then
    insert into public.study_comments (room_id, player_id, body) values (p_id, p_player, clean) returning * into c;
  else
    insert into public.study_comments (material_id, player_id, body) values (p_id, p_player, clean) returning * into c;
  end if;
  return jsonb_build_object('id', c.id, 'playerId', c.player_id, 'body', c.body, 'createdAt', c.created_at, 'count', total + 1);
end;
$$;

-- Fungsi lama (khusus pelajaran) tetap ada sebagai pembungkus supaya kompatibel.
create or replace function public.study_toggle_like(p_session uuid, p_player uuid)
returns jsonb language sql security definer set search_path = public
as $$ select public.study_post_like('lesson', p_session, p_player); $$;

create or replace function public.study_add_comment(p_session uuid, p_player uuid, p_body text)
returns jsonb language sql security definer set search_path = public
as $$ select public.study_post_comment('lesson', p_session, p_player, p_body); $$;

-- ---------------------------------------------------------------- kompetisi: fungsi
-- Room aktif (lobi / berjalan) milik pemain, atau null.
create or replace function public.study_active_room(p_player uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.study_rooms r
  join public.study_room_players rp on rp.room_id = r.id
  where rp.player_id = p_player and r.status in ('lobby', 'running')
  order by r.created_at desc
  limit 1;
$$;

-- Tutup room: hitung skor, peringkat, poin, pemenang, dan catat ke buku besar. Aman dipanggil berulang.
create or replace function public.study_room_finalize(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.study_rooms%rowtype;
  top_correct integer;
  win_player uuid;
  win_name text;
begin
  select * into r from public.study_rooms where id = p_room for update;
  if not found or r.status <> 'running' then
    return;
  end if;

  update public.study_room_players
  set timed_out = (timed_out or submitted_at is null),
      correct_count = coalesce(correct_count, 0)
  where room_id = p_room;

  -- peringkat: benar terbanyak, lalu mengumpulkan paling cepat, lalu yang lebih dulu bergabung
  update public.study_room_players rp
  set rank = x.rn
  from (
    select player_id, row_number() over (order by correct_count desc, submitted_at asc nulls last, joined_at asc) as rn
    from public.study_room_players where room_id = p_room
  ) x
  where rp.room_id = p_room and rp.player_id = x.player_id;

  update public.study_room_players rp
  set points_awarded = case
    when rp.correct_count > 0 then round(
      r.per_question_points::numeric * rp.correct_count * r.weight_percent / 100
      * (100 + case when rp.correct_count = r.num_questions then r.perfect_bonus_percent else 0 end) / 100
    )::integer
    else 0 end
  where rp.room_id = p_room;

  select rp.player_id, rp.correct_count, p.name into win_player, top_correct, win_name
  from public.study_room_players rp join public.study_players p on p.id = rp.player_id
  where rp.room_id = p_room and rp.rank = 1;

  if win_player is not null and top_correct > 0 then
    update public.study_room_players set bonus_points = r.win_bonus where room_id = p_room and player_id = win_player;
  else
    win_player := null;
    win_name := null;
  end if;

  insert into public.study_ledger (player_id, kind, points, note, ref_id, meta)
  select rp.player_id, 'competition', rp.points_awarded, r.subject, p_room,
         jsonb_build_object('rank', rp.rank, 'correct', rp.correct_count, 'total', r.num_questions, 'level', r.level)
  from public.study_room_players rp where rp.room_id = p_room and rp.points_awarded > 0;

  insert into public.study_ledger (player_id, kind, points, note, ref_id, meta)
  select rp.player_id, 'competition_bonus', rp.bonus_points, r.subject, p_room, jsonb_build_object('rank', rp.rank)
  from public.study_room_players rp where rp.room_id = p_room and rp.bonus_points > 0;

  update public.study_rooms
  set status = 'finished', finished_at = clock_timestamp(), winner_id = win_player, winner_name = win_name
  where id = p_room;
end;
$$;

-- Rapikan room yang jatuh tempo: batalkan lobi menganggur, tutup room yang waktunya habis / semua sudah mengumpulkan.
create or replace function public.study_room_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  update public.study_rooms set status = 'cancelled', finished_at = now()
  where status = 'lobby' and created_at < now() - interval '30 minutes';

  for rid in
    select r.id from public.study_rooms r
    where r.status = 'running'
      and (
        r.ends_at + interval '35 seconds' < now()
        or not exists (select 1 from public.study_room_players rp where rp.room_id = r.id and rp.submitted_at is null)
      )
  loop
    perform public.study_room_finalize(rid);
  end loop;
end;
$$;

-- Buat room. p_meta: subject, topic, materialGrade, materialClass, level, timeLimitSeconds, provider.
-- p_questions: [{question, options[4], correctIndex}]. Pembuat otomatis menjadi peserta pertama.
create or replace function public.study_room_create(p_creator uuid, p_meta jsonb, p_questions jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.study_settings%rowtype;
  who public.study_players%rowtype;
  rid uuid;
  lvl text := p_meta ->> 'level';
  n integer;
begin
  perform public.study_room_sweep();
  select * into who from public.study_players where id = p_creator;
  if not found then raise exception 'PEMAIN_TIDAK_ADA'; end if;
  if public.study_active_room(p_creator) is not null then raise exception 'SUDAH_DI_ROOM'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then raise exception 'SOAL_TIDAK_VALID'; end if;
  n := jsonb_array_length(p_questions);
  if n < 1 or n > 50 then raise exception 'SOAL_TIDAK_VALID'; end if;
  select * into cfg from public.study_settings where id = 1;

  insert into public.study_rooms (
    creator_id, creator_name, subject, topic, material_grade, material_class, level, num_questions, time_limit_seconds,
    per_question_points, perfect_bonus_percent, weight_percent, win_bonus, provider
  ) values (
    p_creator, who.name, p_meta ->> 'subject', nullif(p_meta ->> 'topic', ''), p_meta ->> 'materialGrade',
    nullif(p_meta ->> 'materialClass', '')::smallint, lvl, n, (p_meta ->> 'timeLimitSeconds')::integer,
    cfg.per_question_points, cfg.perfect_bonus_percent,
    case lvl when 'easy' then cfg.weight_easy when 'hard' then cfg.weight_hard else cfg.weight_normal end,
    cfg.competition_win_bonus, p_meta ->> 'provider'
  ) returning id into rid;

  insert into public.study_room_questions (room_id, idx, question, options, correct_index)
  select rid, (e.ord - 1)::integer, e.val ->> 'question', e.val -> 'options', (e.val ->> 'correctIndex')::smallint
  from jsonb_array_elements(p_questions) with ordinality as e(val, ord);

  insert into public.study_room_players (room_id, player_id) values (rid, p_creator);
  return rid;
end;
$$;

create or replace function public.study_room_join(p_room uuid, p_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.study_rooms%rowtype;
  active uuid;
begin
  perform public.study_room_sweep();
  select * into r from public.study_rooms where id = p_room for update;
  if not found then raise exception 'ROOM_TIDAK_ADA'; end if;
  perform 1 from public.study_room_players where room_id = p_room and player_id = p_player;
  if found then return; end if; -- sudah di room ini (mis. membuka ulang aplikasi)
  if r.status <> 'lobby' then raise exception 'ROOM_BUKAN_LOBI'; end if;
  perform 1 from public.study_players where id = p_player;
  if not found then raise exception 'PEMAIN_TIDAK_ADA'; end if;
  active := public.study_active_room(p_player);
  if active is not null then raise exception 'SUDAH_DI_ROOM'; end if;
  if (select count(*) from public.study_room_players where room_id = p_room) >= r.max_players then raise exception 'ROOM_PENUH'; end if;
  insert into public.study_room_players (room_id, player_id) values (p_room, p_player);
end;
$$;

-- Keluar dari lobi. Pembuat yang keluar = room dibatalkan. Room yang sudah berjalan tidak bisa ditinggalkan.
create or replace function public.study_room_leave(p_room uuid, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.study_rooms%rowtype;
begin
  select * into r from public.study_rooms where id = p_room for update;
  if not found then raise exception 'ROOM_TIDAK_ADA'; end if;
  if r.status <> 'lobby' then raise exception 'ROOM_SUDAH_JALAN'; end if;
  if r.creator_id = p_player then
    update public.study_rooms set status = 'cancelled', finished_at = now() where id = p_room;
    return jsonb_build_object('cancelled', true);
  end if;
  delete from public.study_room_players where room_id = p_room and player_id = p_player;
  return jsonb_build_object('cancelled', false);
end;
$$;

create or replace function public.study_room_start(p_room uuid, p_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.study_rooms%rowtype;
begin
  select * into r from public.study_rooms where id = p_room for update;
  if not found then raise exception 'ROOM_TIDAK_ADA'; end if;
  if r.creator_id is distinct from p_player then raise exception 'BUKAN_PEMBUAT'; end if;
  if r.status <> 'lobby' then raise exception 'ROOM_BUKAN_LOBI'; end if;
  if (select count(*) from public.study_room_players where room_id = p_room) < 2 then raise exception 'PEMAIN_KURANG'; end if;
  update public.study_rooms
  set status = 'running', started_at = now(), ends_at = now() + make_interval(secs => r.time_limit_seconds)
  where id = p_room;
end;
$$;

-- Kumpulkan jawaban room. p_answers = array sepanjang jumlah soal (0..3 atau null). Terlambat > batas + 30 detik = tanpa jawaban.
create or replace function public.study_room_submit(p_room uuid, p_player uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.study_rooms%rowtype;
  rp public.study_room_players%rowtype;
  ans jsonb := p_answers;
  late boolean := false;
  correct integer;
begin
  select * into r from public.study_rooms where id = p_room for update;
  if not found then raise exception 'ROOM_TIDAK_ADA'; end if;
  select * into rp from public.study_room_players where room_id = p_room and player_id = p_player for update;
  if not found then raise exception 'BUKAN_PESERTA'; end if;
  if r.status = 'finished' or rp.submitted_at is not null then
    return jsonb_build_object('already', true, 'finished', r.status = 'finished');
  end if;
  if r.status <> 'running' then raise exception 'ROOM_BELUM_JALAN'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then raise exception 'JAWABAN_TIDAK_VALID'; end if;

  if now() > r.ends_at + interval '30 seconds' then
    late := true;
    ans := '[]'::jsonb;
  end if;

  select count(*) into correct
  from public.study_room_questions q
  join jsonb_array_elements(ans) with ordinality as e(val, ord) on q.idx = e.ord - 1
  where q.room_id = p_room and jsonb_typeof(e.val) = 'number' and (e.val #>> '{}') in ('0', '1', '2', '3') and (e.val #>> '{}')::integer = q.correct_index;

  update public.study_room_players
  set answers = ans, submitted_at = clock_timestamp(), correct_count = correct, timed_out = late
  where room_id = p_room and player_id = p_player;

  if not exists (select 1 from public.study_room_players where room_id = p_room and submitted_at is null) then
    perform public.study_room_finalize(p_room);
  end if;
  return jsonb_build_object('already', false, 'finished', (select status = 'finished' from public.study_rooms where id = p_room), 'late', late);
end;
$$;

-- ---------------------------------------------------------------- leaderboard (poin total termasuk kompetisi)
drop function if exists public.study_leaderboard();
create function public.study_leaderboard()
returns table (
  id uuid, name text, grade text, sessions_done integer, total_points integer, balance integer, class_level smallint,
  competitions integer, wins integer
)
language sql
stable
security definer
set search_path = public
as $$
  select t.* from (
    select
      p.id,
      p.name,
      p.grade,
      (select count(*) from public.study_sessions s where s.player_id = p.id and s.status = 'submitted')::integer as sessions_done,
      coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p.id and l.kind in ('session', 'competition', 'competition_bonus')), 0)::integer as total_points,
      public.study_balance(p.id) as balance,
      p.class_level,
      (select count(*) from public.study_room_players rp join public.study_rooms r on r.id = rp.room_id
         where rp.player_id = p.id and r.status = 'finished')::integer as competitions,
      (select count(*) from public.study_rooms r where r.winner_id = p.id and r.status = 'finished')::integer as wins
    from public.study_players p
  ) t
  order by t.total_points desc, (t.sessions_done + t.competitions) desc, lower(t.name) asc;
$$;

-- ---------------------------------------------------------------- timeline global / per pemain
-- p_owner null = semua pemain. p_kinds null = semua jenis ('lesson', 'competition', 'material').
-- Untuk satu pemain: pelajarannya, kompetisi yang diikutinya, dan materi yang dibuatnya.
create or replace function public.study_feed(p_owner uuid, p_viewer uuid, p_kinds text[] default null, p_limit integer default 20, p_before timestamptz default null)
returns table (kind text, ref_id uuid, at timestamptz, data jsonb, like_count integer, comment_count integer, liked boolean)
language sql
stable
security definer
set search_path = public
as $$
  with items as (
    select 'lesson'::text as kind, s.id as ref_id, s.submitted_at as at,
      jsonb_build_object(
        'playerId', p.id, 'playerName', p.name, 'grade', p.grade, 'classLevel', p.class_level,
        'subject', s.subject, 'topic', s.topic, 'materialGrade', s.material_grade, 'materialClass', s.material_class,
        'level', s.level, 'total', s.num_questions, 'correct', coalesce(s.correct_count, 0),
        'points', coalesce(s.points_awarded, 0), 'weightPercent', coalesce(s.weight_percent, 100), 'timedOut', s.timed_out
      ) as data
    from public.study_sessions s join public.study_players p on p.id = s.player_id
    where s.status = 'submitted' and (p_owner is null or s.player_id = p_owner)
    union all
    select 'competition', r.id, r.finished_at,
      jsonb_build_object(
        'subject', r.subject, 'topic', r.topic, 'materialGrade', r.material_grade, 'materialClass', r.material_class,
        'level', r.level, 'total', r.num_questions, 'timeLimitSeconds', r.time_limit_seconds,
        'creatorName', r.creator_name, 'winnerId', r.winner_id, 'winnerName', r.winner_name, 'winBonus', r.win_bonus,
        'players', (select count(*) from public.study_room_players rp where rp.room_id = r.id),
        'top', coalesce((
          select jsonb_agg(jsonb_build_object('rank', x.rank, 'name', x.name, 'correct', x.correct_count, 'points', x.points_awarded + x.bonus_points) order by x.rank)
          from (
            select rp.rank, pl.name, rp.correct_count, rp.points_awarded, rp.bonus_points
            from public.study_room_players rp join public.study_players pl on pl.id = rp.player_id
            where rp.room_id = r.id order by rp.rank limit 3
          ) x
        ), '[]'::jsonb),
        'me', case when p_owner is null then null else (
          select jsonb_build_object('rank', rp.rank, 'correct', rp.correct_count, 'points', rp.points_awarded, 'bonus', rp.bonus_points, 'timedOut', rp.timed_out)
          from public.study_room_players rp where rp.room_id = r.id and rp.player_id = p_owner
        ) end
      )
    from public.study_rooms r
    where r.status = 'finished'
      and (p_owner is null or exists (select 1 from public.study_room_players rp where rp.room_id = r.id and rp.player_id = p_owner))
    union all
    select 'material', m.id, m.created_at,
      jsonb_build_object(
        'title', m.title, 'subject', m.subject, 'grade', m.grade, 'classLevel', m.class_level, 'detail', m.detail,
        'creatorId', m.creator_id, 'creatorName', m.creator_name
      )
    from public.study_materials m
    where (p_owner is null or m.creator_id = p_owner)
  )
  select
    i.kind, i.ref_id, i.at, i.data,
    (select count(*) from public.study_likes l
       where (i.kind = 'lesson' and l.session_id = i.ref_id) or (i.kind = 'competition' and l.room_id = i.ref_id) or (i.kind = 'material' and l.material_id = i.ref_id))::integer,
    (select count(*) from public.study_comments c
       where (i.kind = 'lesson' and c.session_id = i.ref_id) or (i.kind = 'competition' and c.room_id = i.ref_id) or (i.kind = 'material' and c.material_id = i.ref_id))::integer,
    (p_viewer is not null and exists (
       select 1 from public.study_likes l
       where l.player_id = p_viewer
         and ((i.kind = 'lesson' and l.session_id = i.ref_id) or (i.kind = 'competition' and l.room_id = i.ref_id) or (i.kind = 'material' and l.material_id = i.ref_id))
    ))
  from items i
  where (p_kinds is null or i.kind = any (p_kinds))
    and (p_before is null or i.at < p_before)
  order by i.at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- Ringkasan profil publik satu pemain.
create or replace function public.study_player_stats(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rank', (select x.rn from (
      select b.id, row_number() over (order by b.total_points desc, (b.sessions_done + b.competitions) desc, lower(b.name) asc) as rn
      from public.study_leaderboard() b
    ) x where x.id = p_player),
    'totalPoints', coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p_player and l.kind in ('session', 'competition', 'competition_bonus')), 0),
    'soloPoints', coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p_player and l.kind = 'session'), 0),
    'competitionPoints', coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p_player and l.kind in ('competition', 'competition_bonus')), 0),
    'lessons', (select count(*) from public.study_sessions s where s.player_id = p_player and s.status = 'submitted'),
    'competitions', (select count(*) from public.study_room_players rp join public.study_rooms r on r.id = rp.room_id where rp.player_id = p_player and r.status = 'finished'),
    'wins', (select count(*) from public.study_rooms r where r.winner_id = p_player and r.status = 'finished'),
    'materials', (select count(*) from public.study_materials m where m.creator_id = p_player)
  );
$$;

-- ---------------------------------------------------------------- hak akses
do $$
declare
  f text;
begin
  foreach f in array array[
    'study_post_check(text, uuid, uuid)', 'study_post_like(text, uuid, uuid)', 'study_post_comment(text, uuid, uuid, text)',
    'study_toggle_like(uuid, uuid)', 'study_add_comment(uuid, uuid, text)',
    'study_active_room(uuid)', 'study_room_finalize(uuid)', 'study_room_sweep()', 'study_room_create(uuid, jsonb, jsonb)',
    'study_room_join(uuid, uuid)', 'study_room_leave(uuid, uuid)', 'study_room_start(uuid, uuid)', 'study_room_submit(uuid, uuid, jsonb)',
    'study_leaderboard()', 'study_feed(uuid, uuid, text[], integer, timestamptz)', 'study_player_stats(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
