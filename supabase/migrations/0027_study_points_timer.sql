-- ================================================================
-- Menu "Study": POIN PER SOAL BENAR, BONUS NILAI SEMPURNA, dan TIMER pelajaran.
--
-- Rumus lama memberi poin maksimal yang sama (mis. 100) berapa pun jumlah soalnya, sehingga 8 dari 10 soal
-- dan 16 dari 20 soal sama-sama bernilai 80. Rumus baru:
--   poin = poin_per_soal x jumlah_benar x bobot_level% x (100 + bonus_sempurna%)/100   [bonus hanya bila semua benar]
-- Contoh (10 poin/soal, bonus 10%): Normal 8/10 = 80, Normal 16/20 = 160, Easy 8/10 = 64, Normal 10/10 = 110.
--
-- Timer: waktu = jumlah soal x detik_per_soal (0 = tanpa timer). Batas dihitung SERVER dari saat pelajaran
-- dibuat (created_at + time_limit_seconds), sehingga menutup/membuka aplikasi tidak menambah waktu.
-- Pengumpulan yang tiba lebih dari TOLERANSI (30 detik) setelah batas dihitung tanpa jawaban (semua salah).
--
-- Aman dijalankan ulang. Butuh migrasi 0023. Pelajaran yang sudah selesai tidak diubah.
-- Kolom lama study_settings.base_points tetap ada tetapi tidak dipakai lagi.
-- ================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_settings' and column_name = 'per_question_points'
  ) then
    alter table public.study_settings
      add column per_question_points integer not null default 10 check (per_question_points between 1 and 10000),
      add column perfect_bonus_percent integer not null default 10 check (perfect_bonus_percent between 0 and 100),
      add column seconds_per_question integer not null default 60 check (seconds_per_question = 0 or seconds_per_question between 10 and 600);
    -- pertahankan nilai 10 soal yang sudah dipakai: poin dasar lama (per 10 soal) -> poin per soal
    update public.study_settings set per_question_points = greatest(1, least(10000, round(base_points / 10.0)::integer)) where id = 1;
  end if;
end $$;

alter table public.study_sessions add column if not exists time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds between 10 and 100000);
alter table public.study_sessions add column if not exists timed_out boolean not null default false;
alter table public.study_sessions add column if not exists bonus_percent integer not null default 0;
alter table public.study_sessions add column if not exists per_question_points integer; -- null = pelajaran lama (rumus lama)

comment on column public.study_sessions.time_limit_seconds is 'Batas waktu pelajaran (detik) sejak created_at; null = tanpa timer (pelajaran lama / timer dimatikan).';
comment on column public.study_sessions.timed_out is 'true bila dikumpulkan melewati batas waktu + toleransi (jawaban tidak dihitung).';

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
      'points', s.points_awarded
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
  pts := round(cfg.per_question_points::numeric * correct * weight / 100 * (100 + bonus) / 100)::integer;

  update public.study_sessions
  set status = 'submitted',
      submitted_at = now(),
      correct_count = correct,
      weight_percent = weight,
      bonus_percent = bonus,
      per_question_points = cfg.per_question_points,
      timed_out = late,
      base_points = base,
      points_awarded = pts
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
    'points', pts
  );
end;
$$;

revoke all on function public.study_submit_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.study_submit_session(uuid, jsonb) to service_role;
