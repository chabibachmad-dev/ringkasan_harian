-- Uji ANTI-SPAM pengulangan mata pelajaran yang sama dalam sehari (migrasi 0033). Jalankan dari akar proyek pada DB kosong
-- setelah migrasi 0023-0033 (hasil akhir: 'gagal' harus 0). Berkas ini menjalankan 0032 + 0033 sendiri di awal karena
-- study_scoring.sql dan study_competition.sql menjalankan ulang 0027/0028 yang menimpa study_submit_session.
--   psql -d <db> -f supabase/tests/study_repeat.sql
\set ON_ERROR_STOP off
\i supabase/migrations/0032_study_daily_cap.sql
\i supabase/migrations/0033_study_repeat_penalty.sql
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;
create or replace function pg_temp.err(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return position(p_msg in sqlerrm) > 0; end $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$ select id from study_players where name = n $$;
-- pelajaran n soal (subjek p_subj), c benar; mengembalikan hasil submit
create or replace function pg_temp.lesson(p_name text, p_subj text, n int, c int) returns jsonb language plpgsql as $$
declare sid uuid; i int; ans jsonb := '[]'::jsonb;
begin
  insert into study_sessions(player_id,subject,material_grade,level,num_questions) values (pg_temp.pid(p_name),p_subj,'SMP','normal',n) returning id into sid;
  for i in 0..n-1 loop
    insert into study_questions(session_id,idx,question,options,correct_index) values (sid,i,'q'||i,'["a","b","c","d"]'::jsonb,0);
    ans := ans || to_jsonb(case when i < c then 0 else 1 end);
  end loop;
  return study_submit_session(sid, ans);
end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('RAli','SMP','s','h'),('RBudi','SMP','s','h'),('RCici','SMP','s','h');
update study_settings set per_question_points = 10, perfect_bonus_percent = 10, weight_easy = 80, weight_normal = 100, weight_hard = 120,
  daily_points_cap = 1000, day_timezone = 'Asia/Jakarta', repeat_subject_percent = 50 where id = 1;

select pg_temp.chk('bawaan: pengulangan 50%', (select repeat_subject_percent = 50 from study_settings));
select pg_temp.chk('persen pengulangan >100 ditolak', pg_temp.err('update study_settings set repeat_subject_percent = 101 where id = 1', 'violates check'));
select pg_temp.chk('persen pengulangan negatif ditolak', pg_temp.err('update study_settings set repeat_subject_percent = -1 where id = 1', 'violates check'));

do $$
declare r jsonb; a uuid := pg_temp.pid('RAli'); d jsonb;
begin
  r := pg_temp.lesson('RAli', 'Matematika', 10, 8);
  perform pg_temp.chk('pengerjaan pertama: 8/10 = 80 poin penuh', (r->>'points')::int = 80 and (r->>'repeatPercent')::int = 100);
  r := pg_temp.lesson('RAli', 'Matematika', 10, 8);
  perform pg_temp.chk('pengerjaan ke-2 mata pelajaran sama: 8/10 = 40 poin (50%)', (r->>'points')::int = 40 and (r->>'repeatPercent')::int = 50 and (r->>'rawPoints')::int = 40);
  r := pg_temp.lesson('RAli', 'Matematika', 10, 10);
  perform pg_temp.chk('pengerjaan ke-3: 10/10 = 110 x 50% = 55 (bonus ikut dikurangi)', (r->>'points')::int = 55 and (r->>'repeatPercent')::int = 50);
  r := pg_temp.lesson('RAli', '  matematika ', 10, 8);
  perform pg_temp.chk('huruf besar/kecil & spasi diabaikan: tetap 50%', (r->>'points')::int = 40 and (r->>'repeatPercent')::int = 50);
  r := pg_temp.lesson('RAli', 'IPA', 10, 8);
  perform pg_temp.chk('mata pelajaran lain: poin penuh 80', (r->>'points')::int = 80 and (r->>'repeatPercent')::int = 100);
  r := pg_temp.lesson('RAli', 'IPA', 10, 8);
  perform pg_temp.chk('IPA kedua kali: 40', (r->>'points')::int = 40);
  perform pg_temp.chk('sesi menyimpan repeat_percent', (select count(*) from study_sessions where player_id = a and repeat_percent = 50) = 4
     and (select count(*) from study_sessions where player_id = a and repeat_percent = 100) = 2);
  perform pg_temp.chk('buku besar sesuai (80+40+55+40+80+40 = 335)', study_balance(a) = 335);
  d := study_daily(a);
  perform pg_temp.chk('dasbor memuat mata pelajaran hari ini + jumlahnya', (select count(*) from jsonb_array_elements(d->'subjects')) = 2
     and (select (e->>'count')::int from jsonb_array_elements(d->'subjects') e where e->>'subject' = 'Matematika') = 4
     and (select (e->>'count')::int from jsonb_array_elements(d->'subjects') e where e->>'subject' = 'IPA') = 2);
  perform pg_temp.chk('study_repeat_count mengabaikan sesi yang dikecualikan', study_repeat_count(a, 'matematika') = 4
     and study_repeat_count(a, 'Fisika') = 0);
end $$;

-- pemain lain tidak terpengaruh; pelajaran kemarin tidak dihitung
do $$
declare r jsonb; b uuid := pg_temp.pid('RBudi'); sid uuid;
begin
  r := pg_temp.lesson('RBudi', 'Matematika', 10, 8);
  perform pg_temp.chk('pemain lain: Matematika pertama hari itu = penuh 80', (r->>'points')::int = 80);
  -- pelajaran Matematika kemarin (selesai kemarin) tidak membuat hari ini jadi pengulangan
  insert into study_sessions(player_id,subject,material_grade,level,num_questions,status,submitted_at,correct_count,points_awarded)
    values (pg_temp.pid('RCici'),'Matematika','SMP','normal',10,'submitted', study_day_start(now()) - interval '1 second', 8, 80);
  r := pg_temp.lesson('RCici', 'Matematika', 10, 8);
  perform pg_temp.chk('pelajaran kemarin tidak dihitung: hari ini tetap penuh', (r->>'points')::int = 80 and (r->>'repeatPercent')::int = 100);
  r := pg_temp.lesson('RCici', 'Matematika', 10, 8);
  perform pg_temp.chk('kedua hari ini: 50%', (r->>'points')::int = 40);
end $$;

-- pengaturan 100 = tanpa pengurangan, 0 = pengulangan tidak berpoin, dan berinteraksi dengan batas harian
do $$
declare r jsonb;
begin
  update study_settings set repeat_subject_percent = 100 where id = 1;
  r := pg_temp.lesson('RBudi', 'Matematika', 10, 8);
  perform pg_temp.chk('100% = tanpa pengurangan', (r->>'points')::int = 80 and (r->>'repeatPercent')::int = 100);
  update study_settings set repeat_subject_percent = 0 where id = 1;
  r := pg_temp.lesson('RBudi', 'Matematika', 10, 8);
  perform pg_temp.chk('0% = pengulangan tidak berpoin, tidak ada baris buku besar baru', (r->>'points')::int = 0 and (r->>'correct')::int = 8 and (r->>'repeatPercent')::int = 0
     and (select count(*) from study_ledger where player_id = pg_temp.pid('RBudi')) = 2);
  update study_settings set repeat_subject_percent = 50, per_question_points = 100 where id = 1;
  -- Budi: 160 hari ini; 10/10 = 1100 x 50% = 550 -> masih di bawah sisa jatah 840
  r := pg_temp.lesson('RBudi', 'Matematika', 10, 10);
  perform pg_temp.chk('pengulangan lalu batas: 1100 x 50% = 550 mentah, masuk 550', (r->>'points')::int = 550 and (r->>'rawPoints')::int = 550 and not (r->>'capped')::boolean);
  r := pg_temp.lesson('RBudi', 'Matematika', 10, 10);
  perform pg_temp.chk('berikutnya 550 mentah, sisa 290 -> dibatasi 290', (r->>'points')::int = 290 and (r->>'rawPoints')::int = 550 and (r->>'capped')::boolean);
  update study_settings set per_question_points = 10 where id = 1;
end $$;

select pg_temp.chk('study_repeat_count hanya untuk service_role', not has_function_privilege('anon','public.study_repeat_count(uuid,text,uuid)','execute')
  and has_function_privilege('service_role','public.study_repeat_count(uuid,text,uuid)','execute'));
select pg_temp.chk('migrasi 0033 dijalankan ulang: aman', (select count(*) from study_sessions where repeat_percent is not null) >= 10);
\i supabase/migrations/0033_study_repeat_penalty.sql
select pg_temp.chk('setelah jalan ulang: data tetap, kolom bawaan tetap', (select repeat_subject_percent = 50 from study_settings) and (select count(*) from study_sessions where repeat_percent = 50) >= 5);

select name, case when ok then 'ok' else 'GAGAL' end from res where not ok;
select count(*) filter (where ok) as lulus, count(*) filter (where not ok) as gagal from res;
