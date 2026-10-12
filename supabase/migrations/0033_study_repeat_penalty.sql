-- ================================================================
-- Menu "Study": ANTI-SPAM PENGULANGAN MATA PELAJARAN yang sama dalam satu hari.
--
-- Pelajaran (termasuk latihan dari materi) dengan mata pelajaran yang SAMA yang dikumpulkan lagi pada hari yang sama
-- (pengerjaan ke-2 dan seterusnya, per pemain, huruf besar/kecil diabaikan) mendapat poin per soal dikurangi:
-- poin = poin_per_soal x benar x bobot% x (100 + bonus)/100 x persen_pengulangan/100
-- study_settings.repeat_subject_percent: bawaan 50 (= 50% per soal), 100 = tanpa pengurangan, 0 = pengulangan tidak berpoin.
-- Pemotongan ini terjadi SEBELUM batas poin harian (0032). Nilai yang dipakai disimpan di study_sessions.repeat_percent.
-- Hari memakai zona waktu study_settings.day_timezone (bawaan Asia/Jakarta, berganti 00.00). Kompetisi tidak terpengaruh.
-- study_daily() kini juga memuat `subjects` (mata pelajaran yang sudah dikerjakan hari ini + jumlahnya).
--
-- Aman dijalankan ulang. Butuh migrasi 0023, 0027, 0032. Pelajaran yang sudah selesai tidak diubah.
-- ================================================================

alter table public.study_settings add column if not exists repeat_subject_percent integer not null default 50
  check (repeat_subject_percent between 0 and 100);
alter table public.study_sessions add column if not exists repeat_percent integer;
comment on column public.study_sessions.repeat_percent is 'Persen poin yang berlaku karena mata pelajaran sama sudah dikerjakan hari itu (100 = tanpa pengurangan); null = pelajaran lama.';

-- Berapa pelajaran dengan mata pelajaran yang sama sudah dikumpulkan pemain hari ini (selain p_exclude).
create or replace function public.study_repeat_count(p_player uuid, p_subject text, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.study_sessions x
  where x.player_id = p_player
    and x.status = 'submitted'
    and (p_exclude is null or x.id <> p_exclude)
    and lower(btrim(x.subject)) = lower(btrim(p_subject))
    and x.submitted_at >= public.study_day_start(now())
    and x.submitted_at < public.study_day_start(now()) + interval '1 day';
$$;

revoke all on function public.study_repeat_count(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.study_repeat_count(uuid, text, uuid) to service_role;

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
  rep_n integer;
  rep_pct integer := 100;
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
      'repeatPercent', coalesce(s.repeat_percent, 100),
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

  -- Dikunci per pemain supaya dua pengumpulan bersamaan tidak sama-sama melihat riwayat/sisa jatah yang sama.
  perform pg_advisory_xact_lock(hashtextextended('study_daily:' || s.player_id::text, 0));

  -- ANTI-SPAM PENGULANGAN: mata pelajaran yang SAMA sudah dikumpulkan hari ini (pengerjaan ke-2 dan seterusnya)
  -- -> poin per soal dikurangi (bawaan 50%). Hari = zona waktu study_settings.day_timezone.
  select public.study_repeat_count(s.player_id, s.subject, p_session) into rep_n;
  if rep_n > 0 then
    rep_pct := coalesce(cfg.repeat_subject_percent, 100);
  end if;
  raw_pts := round(cfg.per_question_points::numeric * correct * weight / 100 * (100 + bonus) / 100 * rep_pct / 100)::integer;

  -- BATAS POIN HARIAN: poin yang didapat hari ini (pelajaran + kompetisi + bonus) tidak melebihi batas, walau saldo
  -- sudah ditukar hadiah.
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
      points_raw = raw_pts,
      repeat_percent = rep_pct
  where id = p_session;

  if pts > 0 then
    insert into public.study_ledger (player_id, kind, points, note, ref_id, meta)
    values (
      s.player_id, 'session', pts,
      s.subject,
      p_session,
      jsonb_build_object('correct', correct, 'total', total, 'level', s.level, 'weightPercent', weight,
                         'perQuestion', cfg.per_question_points, 'bonusPercent', bonus, 'repeatPercent', rep_pct)
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
    'capped', pts < raw_pts,
    'repeatPercent', rep_pct
  );
end;
$$;

revoke all on function public.study_submit_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.study_submit_session(uuid, jsonb) to service_role;

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
  subs jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object('subject', x.subject, 'count', x.n) order by x.n desc, x.subject), '[]'::jsonb)
  into subs
  from (
    select min(btrim(s.subject)) as subject, count(*)::integer as n
    from public.study_sessions s
    where s.player_id = p_player and s.status = 'submitted' and s.submitted_at >= d0 and s.submitted_at < d0 + interval '1 day'
    group by lower(btrim(s.subject))
  ) x;

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
    'history', hist,
    'subjects', subs
  );
end;
$$;

revoke all on function public.study_daily(uuid) from public, anon, authenticated;
grant execute on function public.study_daily(uuid) to service_role;
