-- ================================================================
-- Menu "Study": BOBOT POIN MENURUT KELAS MATERI.
--
-- Materi yang LEBIH TINGGI dari kelas pemain bernilai poin lebih besar; materi yang LEBIH RENDAH bernilai lebih kecil.
--   persen_kelas = 100 + 10 x (tingkat_materi - tingkat_pemain), dibatasi 50 sampai 200
--   tingkat: TK = 0, SD 1-6 = 1-6, SMP 7-9 = 7-9, SMA 10-12 = 10-12, S1/S2/S3 = 13/14/15
--   (kelas 3 mengerjakan SD 5 = 120%; kelas 3 mengerjakan SD 1 = 80%; SMP 7 = 140%)
--   Materi "Umum", pemain "Umum", atau pemain/materi bertingkat berkelas tetapi tanpa kelas = 100% (netral).
-- poin = poin_per_soal x benar x bobot_level% x (100 + bonus)/100 x persen_pengulangan/100 x persen_kelas/100
-- Persen yang dipakai disimpan di study_sessions.class_percent. Kompetisi (room) tidak terpengaruh.
-- Rumus yang sama ada di supabase/functions/_shared/study-core.ts (classPercent) -- ubah bersamaan; lihat wa-bot/test-study.mjs.
--
-- Aman dijalankan ulang. Butuh migrasi 0023, 0026, 0033. Pelajaran yang sudah selesai tidak diubah.
-- ================================================================

alter table public.study_sessions add column if not exists class_percent integer;
comment on column public.study_sessions.class_percent is 'Persen poin karena kelas materi dibanding kelas pemain (100 = netral); null = pelajaran lama.';

create or replace function public.study_level_rank(p_grade text, p_class integer)
returns integer
language sql
immutable
as $$
  select case
    when p_grade = 'TK' then 0
    when p_grade = 'SD' then p_class
    when p_grade = 'SMP' then p_class
    when p_grade = 'SMA' then p_class
    when p_grade = 'S1' then 13
    when p_grade = 'S2' then 14
    when p_grade = 'S3' then 15
    else null
  end;
$$;

create or replace function public.study_class_percent(p_player_grade text, p_player_class integer, p_material_grade text, p_material_class integer)
returns integer
language sql
immutable
as $$
  select coalesce(
    (
      select greatest(50, least(200, 100 + 10 * (m.r - p.r)))
      from (select public.study_level_rank(p_player_grade, p_player_class) as r) p,
           (select public.study_level_rank(p_material_grade, p_material_class) as r) m
      where p.r is not null and m.r is not null
    ),
    100
  );
$$;

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
  cls_pct integer := 100;
  p_grade text;
  p_class integer;
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
      'classPercent', coalesce(s.class_percent, 100),
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
  -- BOBOT KELAS MATERI: materi lebih tinggi dari kelas pemain = poin lebih besar, lebih rendah = lebih kecil
  -- (10% per tingkat, batas 50%-200%; materi "Umum" atau pemain tanpa kelas = 100%).
  select pl.grade, pl.class_level into p_grade, p_class from public.study_players pl where pl.id = s.player_id;
  cls_pct := public.study_class_percent(p_grade, p_class, s.material_grade, s.material_class);
  raw_pts := round(cfg.per_question_points::numeric * correct * weight / 100 * (100 + bonus) / 100 * rep_pct / 100 * cls_pct / 100)::integer;

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
      repeat_percent = rep_pct,
      class_percent = cls_pct
  where id = p_session;

  if pts > 0 then
    insert into public.study_ledger (player_id, kind, points, note, ref_id, meta)
    values (
      s.player_id, 'session', pts,
      s.subject,
      p_session,
      jsonb_build_object('correct', correct, 'total', total, 'level', s.level, 'weightPercent', weight,
                         'perQuestion', cfg.per_question_points, 'bonusPercent', bonus, 'repeatPercent', rep_pct, 'classPercent', cls_pct)
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
    'repeatPercent', rep_pct,
    'classPercent', cls_pct
  );
end;
$$;

revoke all on function public.study_submit_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.study_submit_session(uuid, jsonb) to service_role;
