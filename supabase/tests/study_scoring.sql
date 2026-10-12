-- Uji poin per soal, bonus nilai sempurna, dan timer Study. Jalankan pada DB kosong setelah migrasi 0023-0027:
--   psql -d <db> -f supabase/tests/study_scoring.sql      (hasil akhir: 'gagal' harus 0)
\set ON_ERROR_STOP off
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

-- pembuat sesi: n soal semua kunci 0; benar = jumlah jawaban benar; mengembalikan hasil submit
create or replace function pg_temp.run(p_player uuid, p_level text, n int, benar int, p_limit int default null, p_age interval default interval '0') returns jsonb language plpgsql as $$
declare sid uuid; i int; ans jsonb := '[]'::jsonb;
begin
  insert into study_sessions(player_id,subject,material_grade,level,num_questions,time_limit_seconds,created_at)
    values (p_player,'T','SD',p_level,n,p_limit, now() - p_age) returning id into sid;
  for i in 0..n-1 loop
    insert into study_questions(session_id,idx,question,options,correct_index) values (sid,i,'q','["a","b","c","d"]'::jsonb,0);
    ans := ans || to_jsonb(case when i < benar then 0 else 1 end);
  end loop;
  return study_submit_session(sid, ans);
end $$;

-- Batas poin harian (0032) dimatikan di berkas ini: satu pemain 'Pts' mengerjakan banyak pelajaran dalam sehari dan yang diuji di sini rumus poinnya. Batas harian diuji di study_daily.sql.
do $$ begin if exists (select 1 from information_schema.columns where table_name='study_settings' and column_name='daily_points_cap') then execute 'update study_settings set daily_points_cap = 0 where id = 1'; end if; end $$;
-- Anti-spam pengulangan mata pelajaran (0033) dimatikan di berkas ini: pemain yang sama mengerjakan mata pelajaran yang sama berkali-kali dalam sehari. Aturannya diuji di study_repeat.sql.
do $$ begin if exists (select 1 from information_schema.columns where table_name='study_settings' and column_name='repeat_subject_percent') then execute 'update study_settings set repeat_subject_percent = 100 where id = 1'; end if; end $$;
insert into study_players(name,grade,pin_salt,pin_hash) values ('Pts','SD','s','h');

select pg_temp.chk('seed setting 10 poin/soal, bonus 10%, 60 dtk/soal',
  (select per_question_points=10 and perfect_bonus_percent=10 and seconds_per_question=60 from study_settings));

do $$
declare pid uuid; r jsonb;
begin
  select id into pid from study_players where name='Pts';
  r := pg_temp.run(pid,'normal',10,8);
  perform pg_temp.chk('normal 8/10 = 80', (r->>'points')::int=80 and (r->>'bonusPercent')::int=0 and (r->>'basePoints')::int=100);
  r := pg_temp.run(pid,'normal',20,16);
  perform pg_temp.chk('normal 16/20 = 160 (lebih besar dari 8/10)', (r->>'points')::int=160 and (r->>'basePoints')::int=200);
  r := pg_temp.run(pid,'normal',30,27);
  perform pg_temp.chk('normal 27/30 = 270', (r->>'points')::int=270);
  r := pg_temp.run(pid,'easy',10,8);
  perform pg_temp.chk('easy 8/10 = 64', (r->>'points')::int=64);
  r := pg_temp.run(pid,'hard',10,8);
  perform pg_temp.chk('hard 8/10 = 96', (r->>'points')::int=96);
  r := pg_temp.run(pid,'normal',10,10);
  perform pg_temp.chk('normal 10/10 = 110 (bonus sempurna 10%)', (r->>'points')::int=110 and (r->>'bonusPercent')::int=10);
  r := pg_temp.run(pid,'normal',10,9);
  perform pg_temp.chk('9/10 tanpa bonus = 90', (r->>'points')::int=90 and (r->>'bonusPercent')::int=0);
  r := pg_temp.run(pid,'hard',20,20);
  perform pg_temp.chk('hard 20/20 = 264 (10 x 20 x 1,2 x 1,1)', (r->>'points')::int=264);
  r := pg_temp.run(pid,'normal',10,0);
  perform pg_temp.chk('0 benar = 0 poin, tanpa catatan buku besar baru', (r->>'points')::int=0 and (select count(*) from study_ledger where player_id=pid)=8);
end $$;

-- ubah setting: 5 poin/soal, bonus 0
do $$
declare pid uuid; r jsonb;
begin
  select id into pid from study_players where name='Pts';
  update study_settings set per_question_points=5, perfect_bonus_percent=0 where id=1;
  r := pg_temp.run(pid,'normal',10,10);
  perform pg_temp.chk('5 poin/soal, bonus 0: 10/10 = 50', (r->>'points')::int=50 and (r->>'bonusPercent')::int=0);
  update study_settings set per_question_points=10, perfect_bonus_percent=10 where id=1;
end $$;

-- timer
do $$
declare pid uuid; r jsonb;
begin
  select id into pid from study_players where name='Pts';
  r := pg_temp.run(pid,'normal',10,10, 600, interval '5 minutes');
  perform pg_temp.chk('dikumpulkan di dalam batas waktu: dihitung', (r->>'points')::int=110 and not (r->>'timedOut')::boolean);
  r := pg_temp.run(pid,'normal',10,10, 600, interval '600 seconds' + interval '20 seconds');
  perform pg_temp.chk('lewat batas tetapi di dalam toleransi 30 dtk: dihitung', (r->>'points')::int=110 and not (r->>'timedOut')::boolean);
  r := pg_temp.run(pid,'normal',10,10, 600, interval '600 seconds' + interval '45 seconds');
  perform pg_temp.chk('lewat batas + toleransi: jawaban diabaikan (0 poin, timedOut)', (r->>'points')::int=0 and (r->>'correct')::int=0 and (r->>'timedOut')::boolean);
  r := pg_temp.run(pid,'normal',10,10, null, interval '5 hours');
  perform pg_temp.chk('tanpa batas waktu (pelajaran lama / timer mati): selalu dihitung', (r->>'points')::int=110 and not (r->>'timedOut')::boolean);
end $$;

-- submit ulang mengembalikan hasil lama, tidak mengubah apa pun
do $$
declare pid uuid; sid uuid; r jsonb; r2 jsonb;
begin
  select id into pid from study_players where name='Pts';
  r := pg_temp.run(pid,'normal',10,10, 600, interval '2 hours');
  select id into sid from study_sessions where player_id=pid order by created_at limit 1;
  r2 := study_submit_session((select id from study_sessions where player_id=pid and timed_out limit 1), '[0,0,0,0,0,0,0,0,0,0]'::jsonb);
  perform pg_temp.chk('submit ulang sesi yang sudah lewat waktu: already, tetap 0 poin', (r2->>'already')::boolean and (r2->>'points')::int=0 and (r2->>'timedOut')::boolean);
end $$;

-- batas isi setting
do $$
declare ok boolean;
begin
  begin update study_settings set seconds_per_question=5 where id=1; ok:=false; exception when check_violation then ok:=true; end;
  perform pg_temp.chk('detik per soal 5 ditolak (minimal 10 atau 0)', ok);
  begin update study_settings set seconds_per_question=601 where id=1; ok:=false; exception when check_violation then ok:=true; end;
  perform pg_temp.chk('detik per soal 601 ditolak', ok);
  update study_settings set seconds_per_question=0 where id=1;
  perform pg_temp.chk('detik per soal 0 (timer mati) diterima', (select seconds_per_question from study_settings)=0);
  update study_settings set seconds_per_question=60 where id=1;
  begin update study_settings set perfect_bonus_percent=101 where id=1; ok:=false; exception when check_violation then ok:=true; end;
  perform pg_temp.chk('bonus 101% ditolak', ok);
  begin update study_settings set per_question_points=0 where id=1; ok:=false; exception when check_violation then ok:=true; end;
  perform pg_temp.chk('poin per soal 0 ditolak', ok);
end $$;

-- migrasi dijalankan ulang tidak mengubah setting yang sudah diatur
update study_settings set per_question_points=7 where id=1;
\i supabase/migrations/0027_study_points_timer.sql
select pg_temp.chk('migrasi 0027 dijalankan ulang tidak menimpa setting', (select per_question_points from study_settings)=7);
update study_settings set per_question_points=10 where id=1;

select case when ok then 'ok  ' else 'FAIL' end || name as hasil from res order by ok, name;
select count(*) filter (where not ok) as gagal from res;
