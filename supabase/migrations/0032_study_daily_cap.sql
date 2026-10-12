-- ================================================================
-- Menu "Study": BATAS POIN HARIAN + data "poin didapat hari ini".
--
-- Satu pemain paling banyak mendapat `study_settings.daily_points_cap` poin (bawaan 1000) per HARI, berapa pun
-- yang dikerjakan. Yang dihitung adalah poin yang DIDAPAT (pelajaran, latihan, kompetisi, bonus pemenang), bukan saldo:
-- menukar hadiah (redeem) atau terkena hukuman TIDAK membuka jatah lagi. Setelah batas tercapai, pelajaran tetap bisa
-- dikerjakan dan hasilnya tetap tercatat (nilai & pembahasan), tetapi poin yang masuk 0.
--   - Hari memakai zona waktu study_settings.day_timezone (bawaan Asia/Jakarta), berganti pukul 00.00 di sana.
--   - Pemotongan: pelajaran = poin dihitung lalu dipotong ke sisa jatah; kompetisi = poin dasar dulu, baru bonus pemenang.
--     Peringkat & pemenang kompetisi tidak berubah.
--   - Nilai asli sebelum dipotong disimpan (study_sessions.points_raw, study_room_players.points_raw/bonus_raw) supaya
--     layar hasil bisa menjelaskan "dibatasi batas harian".
--   - 0 = tanpa batas.
--   - Pelajaran/kompetisi yang SUDAH selesai tidak diubah.
-- Fungsi bantu: study_day_tz(), study_day_start(), study_earned_today(), study_cap_left(), study_daily(), study_today_points().
--
-- Aman dijalankan ulang. Butuh migrasi 0023, 0027, 0028.
-- ================================================================

alter table public.study_settings add column if not exists daily_points_cap integer not null default 1000
  check (daily_points_cap between 0 and 1000000);
alter table public.study_settings add column if not exists day_timezone text not null default 'Asia/Jakarta';

alter table public.study_sessions add column if not exists points_raw integer;
alter table public.study_room_players add column if not exists points_raw integer;
alter table public.study_room_players add column if not exists bonus_raw integer;

comment on column public.study_sessions.points_raw is 'Poin sebelum dipotong batas harian; null = pelajaran lama (sama dengan points_awarded).';

-- ---------------------------------------------------------------- hari & jatah
create or replace function public.study_day_tz()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select s.day_timezone from public.study_settings s
       where s.id = 1 and exists (select 1 from pg_timezone_names z where z.name = s.day_timezone)),
    'Asia/Jakarta');
$$;

-- Awal hari (00.00 zona hari belajar) yang memuat p_at.
create or replace function public.study_day_start(p_at timestamptz default now())
returns timestamptz
language sql
stable
set search_path = public
as $$
  select ((p_at at time zone public.study_day_tz())::date::timestamp) at time zone public.study_day_tz();
$$;

create or replace function public.study_earned_today(p_player uuid, p_at timestamptz default now())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.points), 0)::integer
  from public.study_ledger l
  where l.player_id = p_player
    and l.kind in ('session', 'competition', 'competition_bonus')
    and l.created_at >= public.study_day_start(p_at)
    and l.created_at < public.study_day_start(p_at) + interval '1 day';
$$;

-- Sisa jatah poin hari ini. Tanpa batas (0) = bilangan sangat besar.
create or replace function public.study_cap_left(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select s.daily_points_cap from public.study_settings s where s.id = 1), 1000) <= 0 then 2147483647
    else greatest(0, (select s.daily_points_cap from public.study_settings s where s.id = 1) - public.study_earned_today(p_player))
  end;
$$;

-- Ringkasan hari ini untuk satu pemain (dasbor) + 7 hari terakhir.
create or replace function public.study_daily(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cap integer := coalesce((select s.daily_points_cap from public.study_settings s where s.id = 1), 1000);
  tz text := public.study_day_tz();
  d0 timestamptz := public.study_day_start(now());
  earned integer;
  solo integer;
  comp integer;
  bonus integer;
  sessions_n integer;
  comps_n integer;
  hist jsonb;
begin
  select
    coalesce(sum(l.points), 0),
    coalesce(sum(l.points) filter (where l.kind = 'session'), 0),
    coalesce(sum(l.points) filter (where l.kind = 'competition'), 0),
    coalesce(sum(l.points) filter (where l.kind = 'competition_bonus'), 0)
  into earned, solo, comp, bonus
  from public.study_ledger l
  where l.player_id = p_player and l.kind in ('session', 'competition', 'competition_bonus')
    and l.created_at >= d0 and l.created_at < d0 + interval '1 day';

  select count(*) into sessions_n from public.study_sessions s
  where s.player_id = p_player and s.status = 'submitted' and s.submitted_at >= d0 and s.submitted_at < d0 + interval '1 day';

  select count(*) into comps_n from public.study_room_players rp join public.study_rooms r on r.id = rp.room_id
  where rp.player_id = p_player and r.status = 'finished' and r.finished_at >= d0 and r.finished_at < d0 + interval '1 day';

  select coalesce(jsonb_agg(jsonb_build_object('date', to_char(g.d, 'YYYY-MM-DD'), 'earned', coalesce(x.earned, 0)) order by g.d), '[]'::jsonb)
  into hist
  from generate_series((d0 at time zone tz)::date - 6, (d0 at time zone tz)::date, interval '1 day') as g(d)
  left join (
    select (l.created_at at time zone tz)::date as day, sum(l.points)::integer as earned
    from public.study_ledger l
    where l.player_id = p_player and l.kind in ('session', 'competition', 'competition_bonus')
      and l.created_at >= d0 - interval '6 days'
    group by 1
  ) x on x.day = g.d::date;

  return jsonb_build_object(
    'cap', cap,
    'earned', earned,
    'remaining', case when cap <= 0 then null else greatest(0, cap - earned) end,
    'reached', cap > 0 and earned >= cap,
    'date', to_char((d0 at time zone tz)::date, 'YYYY-MM-DD'),
    'timezone', tz,
    'resetAt', d0 + interval '1 day',
    'solo', solo,
    'competition', comp,
    'bonus', bonus,
    'sessions', sessions_n,
    'competitions', comps_n,
    'history', hist
  );
end;
$$;

-- Poin didapat hari ini untuk semua pemain yang punya poin hari ini (papan "Hari ini").
create or replace function public.study_today_points()
returns table (player_id uuid, earned integer)
language sql
stable
security definer
set search_path = public
as $$
  select l.player_id, sum(l.points)::integer
  from public.study_ledger l
  where l.kind in ('session', 'competition', 'competition_bonus')
    and l.created_at >= public.study_day_start(now())
    and l.created_at < public.study_day_start(now()) + interval '1 day'
  group by l.player_id;
$$;

revoke all on function public.study_day_tz() from public, anon, authenticated;
revoke all on function public.study_day_start(timestamptz) from public, anon, authenticated;
revoke all on function public.study_earned_today(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.study_cap_left(uuid) from public, anon, authenticated;
revoke all on function public.study_daily(uuid) from public, anon, authenticated;
revoke all on function public.study_today_points() from public, anon, authenticated;
grant execute on function public.study_day_tz() to service_role;
grant execute on function public.study_day_start(timestamptz) to service_role;
grant execute on function public.study_earned_today(uuid, timestamptz) to service_role;
grant execute on function public.study_cap_left(uuid) to service_role;
grant execute on function public.study_daily(uuid) to service_role;
grant execute on function public.study_today_points() to service_role;

-- ---------------------------------------------------------------- pelajaran: poin dipotong batas harian
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
  bonus integer;
  base integer;
  pts integer;
  raw_pts integer;
  left_pts integer;
  late boolean := false;
  answers jsonb := p_answers;
  grace constant interval := interval '30 seconds';
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
      'bonusPercent', s.bonus_percent,
      'perQuestionPoints', s.per_question_points,
      'timedOut', s.timed_out,
      'basePoints', s.base_points,
      'points', s.points_awarded,
      'rawPoints', coalesce(s.points_raw, s.points_awarded),
      'capped', coalesce(s.points_raw, s.points_awarded) > coalesce(s.points_awarded, 0)
    );
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'JAWABAN_TIDAK_VALID';
  end if;

  -- lewat batas waktu + toleransi: jawaban diabaikan (semua dianggap tidak dijawab)
  if s.time_limit_seconds is not null and now() > s.created_at + make_interval(secs => s.time_limit_seconds) + grace then
    late := true;
    answers := '[]'::jsonb;
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
    from jsonb_array_elements(answers) with ordinality as e(val, ord)
  ) a
  where q.session_id = p_session and q.idx = a.idx;

  select count(*) into correct
  from public.study_questions
  where session_id = p_session and user_answer is not null and user_answer = correct_index;

  select * into cfg from public.study_settings where id = 1;
  weight := case s.level when 'easy' then cfg.weight_easy when 'hard' then cfg.weight_hard else cfg.weight_normal end;
  bonus := case when correct = total then cfg.perfect_bonus_percent else 0 end;
  base := cfg.per_question_points * total; -- poin maksimal sebelum bobot level dan bonus
  raw_pts := round(cfg.per_question_points::numeric * correct * weight / 100 * (100 + bonus) / 100)::integer;

  -- BATAS POIN HARIAN: poin yang didapat hari ini (pelajaran + kompetisi + bonus) tidak melebihi batas, walau saldo
  -- sudah ditukar hadiah. Dikunci per pemain supaya dua pengumpulan bersamaan tidak sama-sama melihat sisa jatah yang sama.
  perform pg_advisory_xact_lock(hashtextextended('study_daily:' || s.player_id::text, 0));
  left_pts := public.study_cap_left(s.player_id);
  pts := least(raw_pts, left_pts);

  update public.study_sessions
  set status = 'submitted',
      submitted_at = now(),
      correct_count = correct,
      weight_percent = weight,
      bonus_percent = bonus,
      per_question_points = cfg.per_question_points,
      timed_out = late,
      base_points = base,
      points_awarded = pts,
      points_raw = raw_pts
  where id = p_session;

  if pts > 0 then
    insert into public.study_ledger (player_id, kind, points, note, ref_id, meta)
    values (
      s.player_id, 'session', pts,
      s.subject,
      p_session,
      jsonb_build_object('correct', correct, 'total', total, 'level', s.level, 'weightPercent', weight,
                         'perQuestion', cfg.per_question_points, 'bonusPercent', bonus)
    );
  end if;

  return jsonb_build_object(
    'already', false,
    'correct', correct,
    'total', total,
    'weightPercent', weight,
    'bonusPercent', bonus,
    'perQuestionPoints', cfg.per_question_points,
    'timedOut', late,
    'basePoints', base,
    'points', pts,
    'rawPoints', raw_pts,
    'capped', pts < raw_pts
  );
end;
$$;

revoke all on function public.study_submit_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.study_submit_session(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------- kompetisi: poin dipotong batas harian
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
  rec record;
  left_pts integer;
  pa integer;
  bp integer;
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

  -- BATAS POIN HARIAN: tiap peserta dibatasi sisa jatahnya hari ini (poin dasar dulu, baru bonus pemenang).
  -- Peringkat dan pemenang TIDAK berubah; yang dibatasi hanya poin yang masuk. Kunci diambil terurut agar tidak saling tunggu.
  for rec in select player_id from public.study_room_players where room_id = p_room order by player_id loop
    perform pg_advisory_xact_lock(hashtextextended('study_daily:' || rec.player_id::text, 0));
  end loop;
  for rec in select player_id, points_awarded, bonus_points from public.study_room_players where room_id = p_room order by rank loop
    left_pts := public.study_cap_left(rec.player_id);
    pa := least(rec.points_awarded, left_pts);
    bp := least(rec.bonus_points, left_pts - pa);
    update public.study_room_players
    set points_raw = rec.points_awarded, bonus_raw = rec.bonus_points, points_awarded = pa, bonus_points = bp
    where room_id = p_room and player_id = rec.player_id;
  end loop;

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

revoke all on function public.study_room_finalize(uuid) from public, anon, authenticated;
grant execute on function public.study_room_finalize(uuid) to service_role;
