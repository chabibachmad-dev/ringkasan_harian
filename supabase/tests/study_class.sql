-- Uji kelas (class_level) Study. Jalankan pada DB kosong setelah migrasi 0023-0026:
--   psql -d <db> -f supabase/migrations/0023_study.sql -f supabase/migrations/0024_study_social.sql -f supabase/migrations/0025_study_materials.sql -f supabase/migrations/0026_study_class.sql -f supabase/tests/study_class.sql
-- Hasil akhir: kolom 'gagal' harus 0.
\set ON_ERROR_STOP off
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

do $$
declare ok boolean; a uuid; b uuid; sid uuid; lb record; tl record;
begin
  insert into study_players(name,grade,pin_salt,pin_hash,class_level) values ('KlsAli','SD','s','h',5) returning id into a;
  insert into study_players(name,grade,pin_salt,pin_hash) values ('KlsLama','SD','s','h') returning id into b;
  perform pg_temp.chk('pemain SD kelas 5 tersimpan', (select class_level from study_players where id = a) = 5);
  perform pg_temp.chk('pemain lama tanpa kelas tetap valid', (select class_level is null from study_players where id = b));
  insert into study_players(name,grade,pin_salt,pin_hash,class_level) values ('KlsSmp','SMP','s','h',9), ('KlsSma','SMA','s','h',10);
  perform pg_temp.chk('SMP kelas 9 dan SMA kelas 10 diterima', (select count(*) from study_players where name in ('KlsSmp','KlsSma')) = 2);

  begin insert into study_players(name,grade,pin_salt,pin_hash,class_level) values ('x1','SD','s','h',7); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('SD kelas 7 ditolak', ok);
  begin insert into study_players(name,grade,pin_salt,pin_hash,class_level) values ('x2','SMP','s','h',6); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('SMP kelas 6 ditolak', ok);
  begin insert into study_players(name,grade,pin_salt,pin_hash,class_level) values ('x3','SMA','s','h',13); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('SMA kelas 13 ditolak', ok);
  begin insert into study_players(name,grade,pin_salt,pin_hash,class_level) values ('x4','S1','s','h',1); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('S1 tidak boleh punya kelas', ok);
  begin insert into study_players(name,grade,pin_salt,pin_hash,class_level) values ('x5','Umum','s','h',1); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('Umum tidak boleh punya kelas', ok);
  begin update study_players set class_level = 3 where id = a and false; ok := true; exception when others then ok := false; end;
  begin update study_players set grade = 'SMP' where id = a; ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('ganti grade tanpa menyesuaikan kelas ditolak (SD 5 -> SMP 5)', ok);
  update study_players set grade = 'SMP', class_level = 7 where id = a;
  perform pg_temp.chk('naik jenjang sekaligus kelas (SMP 7) diterima', (select grade = 'SMP' and class_level = 7 from study_players where id = a));
  update study_players set grade = 'SD', class_level = 5 where id = a;

  -- pelajaran: kelas materi
  insert into study_sessions(player_id,subject,material_grade,material_class,level,num_questions,status,submitted_at,correct_count,weight_percent,base_points,points_awarded)
    values (a,'IPA','SD',6,'normal',10,'submitted',now(),10,100,100,100) returning id into sid;
  perform pg_temp.chk('pelajaran SD kelas 6 tersimpan', (select material_class from study_sessions where id = sid) = 6);
  begin insert into study_sessions(player_id,subject,material_grade,material_class,level,num_questions) values (a,'IPA','SD',8,'normal',5); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('pelajaran SD kelas 8 ditolak', ok);
  begin insert into study_sessions(player_id,subject,material_grade,material_class,level,num_questions) values (a,'IPA','Umum',1,'normal',5); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('pelajaran Umum dengan kelas ditolak', ok);
  insert into study_sessions(player_id,subject,material_grade,level,num_questions) values (a,'IPS','SD','normal',5);
  perform pg_temp.chk('pelajaran lama tanpa kelas tetap valid', true);

  -- materi
  insert into study_materials(creator_id,creator_name,subject,grade,class_level,detail,title,content) values (a,'KlsAli','Matematika','SMP',8,'d','t','c');
  perform pg_temp.chk('materi SMP kelas 8 tersimpan', (select class_level from study_materials where creator_name = 'KlsAli' and grade = 'SMP') = 8);
  begin insert into study_materials(creator_name,subject,grade,class_level,detail,title,content) values ('x','M','SMA',9,'d','t','c'); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('materi SMA kelas 9 ditolak', ok);

  -- fungsi: leaderboard & timeline membawa kelas
  select * into lb from study_leaderboard() where name = 'KlsAli';
  perform pg_temp.chk('leaderboard memuat kelas', lb.class_level = 5 and lb.grade = 'SD');
  perform pg_temp.chk('leaderboard pemain lama: kelas kosong', (select class_level is null from study_leaderboard() where name = 'KlsLama'));
  select * into tl from study_timeline(a, null) order by submitted_at desc limit 1;
  perform pg_temp.chk('timeline memuat kelas materi', tl.material_class = 6);
end $$;

do $$
declare ok1 boolean; ok2 boolean;
begin
  set local role anon;
  begin perform study_leaderboard(); ok1 := false; exception when insufficient_privilege then ok1 := true; end;
  begin perform study_timeline(gen_random_uuid(), null); ok2 := false; exception when insufficient_privilege then ok2 := true; end;
  reset role;
  perform pg_temp.chk('anon tidak boleh memanggil leaderboard (setelah dibuat ulang)', ok1);
  perform pg_temp.chk('anon tidak boleh memanggil timeline (setelah dibuat ulang)', ok2);
end $$;

select case when ok then 'ok  ' else 'FAIL' end || name as hasil from res order by ok, name;
select count(*) filter (where not ok) as gagal from res;
