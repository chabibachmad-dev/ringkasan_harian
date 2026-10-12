-- Uji latihan dari materi: kolom material_id/material_title di sesi, study_feed menampilkannya, dan hapus materi tidak merusak.
-- Jalankan pada DB kosong setelah migrasi 0023-0029 (hasil akhir: 'gagal' harus 0):
--   psql -d <db> -f supabase/tests/study_practice.sql
\set ON_ERROR_STOP off
-- study_competition.sql menjalankan ulang 0028 (yang menimpa study_feed); pasang ulang 0029 supaya tes ini tidak bergantung urutan.
\i supabase/migrations/0029_study_practice.sql
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

insert into study_players(name,grade,class_level,pin_salt,pin_hash) values ('LatAli','SMP',8,'s','h'),('LatBudi','SMP',8,'s','h');
insert into study_materials(creator_id, creator_name, subject, grade, class_level, detail, title, content)
  select id, 'LatBudi', 'Matematika', 'SMP', 8, 'pecahan', 'Pecahan latihan', 'isi materi' from study_players where name = 'LatBudi';

-- latihan: sesi mencatat materi asal
insert into study_sessions(player_id, subject, topic, material_grade, material_class, level, num_questions, status, material_id, material_title, submitted_at, correct_count, points_awarded, weight_percent)
  select p.id, 'Matematika', 'Pecahan latihan', 'SMP', 8, 'normal', 10, 'submitted', m.id, m.title, now(), 7, 70, 100
  from study_players p, study_materials m where p.name = 'LatAli' and m.title = 'Pecahan latihan';
-- pelajaran biasa (tanpa materi)
insert into study_sessions(player_id, subject, material_grade, material_class, level, num_questions, status, submitted_at, correct_count, points_awarded, weight_percent)
  select p.id, 'IPA', 'SMP', 8, 'normal', 5, 'submitted', now() - interval '1 minute', 3, 30, 100 from study_players p where p.name = 'LatAli';

select pg_temp.chk('sesi latihan menyimpan material_id + material_title',
  (select material_id is not null and material_title = 'Pecahan latihan' from study_sessions where player_id = (select id from study_players where name='LatAli') and subject = 'Matematika'));
select pg_temp.chk('feed: kartu latihan memuat materialId + materialTitle',
  (select (data->>'materialTitle') = 'Pecahan latihan' and (data->>'materialId') is not null from study_feed((select id from study_players where name='LatAli'), null, array['lesson'], 20, null) where data->>'subject' = 'Matematika'));
select pg_temp.chk('feed: pelajaran biasa tanpa materialTitle',
  (select (data->>'materialTitle') is null from study_feed((select id from study_players where name='LatAli'), null, array['lesson'], 20, null) where data->>'subject' = 'IPA'));
select pg_temp.chk('feed: 2 pelajaran tampil', (select count(*) from study_feed((select id from study_players where name='LatAli'), null, array['lesson'], 20, null)) = 2);

-- hapus materi: sesi tetap ada, material_id jadi null, judul tetap
delete from study_materials where title = 'Pecahan latihan';
select pg_temp.chk('hapus materi: sesi latihan tetap ada', (select count(*) from study_sessions where player_id = (select id from study_players where name='LatAli') and subject = 'Matematika') = 1);
select pg_temp.chk('hapus materi: material_id null, judul tetap',
  (select material_id is null and material_title = 'Pecahan latihan' from study_sessions where player_id = (select id from study_players where name='LatAli') and subject = 'Matematika'));
select pg_temp.chk('feed setelah materi dihapus: judul tetap tampil',
  (select (data->>'materialTitle') = 'Pecahan latihan' and (data->>'materialId') is null from study_feed((select id from study_players where name='LatAli'), null, array['lesson'], 20, null) where data->>'subject' = 'Matematika'));

-- batas panjang judul
do $$ begin
  begin
    update study_sessions set material_title = repeat('x', 121) where subject = 'IPA';
    insert into res values ('judul >120 karakter ditolak', false);
  exception when check_violation then insert into res values ('judul >120 karakter ditolak', true);
  end;
end $$;

-- migrasi dijalankan ulang tidak merusak data
\i supabase/migrations/0029_study_practice.sql
select pg_temp.chk('migrasi 0029 dijalankan ulang: data tetap', (select count(*) from study_sessions where player_id = (select id from study_players where name='LatAli') and material_title is not null) = 1);

select name, case when ok then 'ok' else 'GAGAL' end from res order by 1;
select 'gagal: ' || count(*) filter (where not ok) from res;
