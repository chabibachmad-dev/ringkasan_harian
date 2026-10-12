-- Uji tabel materi & pencatat pemakaian AI. Jalankan pada DB kosong setelah migrasi 0023 dan 0025:
--   psql -d <db> -f supabase/migrations/0023_study.sql -f supabase/migrations/0025_study_materials.sql -f supabase/tests/study_materials.sql
-- Hasil akhir: kolom 'gagal' harus 0.
\set ON_ERROR_STOP off
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('MatAli','SD','s','h');

do $$
declare pid uuid; mid uuid; ok boolean;
begin
  select id into pid from study_players where name='MatAli';
  insert into study_materials(creator_id,creator_name,subject,grade,detail,title,content) values (pid,'MatAli','Matematika','SMP','Pythagoras','Teorema','isi materi') returning id into mid;
  perform pg_temp.chk('materi tersimpan', (select count(*) from study_materials where id = mid) = 1);

  begin insert into study_materials(creator_name,subject,grade,detail,title,content) values ('x','Mat','Kuliah','d','t','c'); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('grade tidak valid ditolak', ok);
  begin insert into study_materials(creator_name,subject,grade,detail,title,content) values ('x','Mat','SD','   ','t','c'); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('detail kosong ditolak', ok);
  begin insert into study_materials(creator_name,subject,grade,detail,title,content) values ('x','Mat','SD',repeat('d',301),'t','c'); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('detail >300 ditolak', ok);
  begin insert into study_materials(creator_name,subject,grade,detail,title,content) values ('x','Mat','SD','d','t',''); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('isi kosong ditolak', ok);
  begin insert into study_materials(creator_name,subject,grade,detail,title,content) values ('x','Mat','SD','d','t',repeat('c',40001)); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('isi >40000 ditolak', ok);

  insert into study_gen_log(kind, player_id) values ('lesson', pid), ('material', pid);
  begin insert into study_gen_log(kind, player_id) values ('lain', pid); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('jenis catatan pemakaian divalidasi', ok);
  perform pg_temp.chk('catatan pemakaian tersimpan', (select count(*) from study_gen_log where player_id = pid) = 2);

  perform pg_temp.chk('RLS aktif di tabel baru', (select count(*) from pg_tables where schemaname='public' and tablename in ('study_materials','study_gen_log') and rowsecurity) = 2);
  perform pg_temp.chk('tanpa kebijakan RLS (terkunci total)', (select count(*) from pg_policies where tablename in ('study_materials','study_gen_log')) = 0);

  -- hapus pembuat: materi tetap ada (creator_id jadi null, nama tetap), catatan pemakaiannya ikut hilang
  delete from study_players where id = pid;
  perform pg_temp.chk('hapus pembuat: materi tetap, nama pembuat tetap', (select creator_id is null and creator_name = 'MatAli' from study_materials where id = mid));
  perform pg_temp.chk('hapus pembuat: catatan pemakaian ikut terhapus', (select count(*) from study_gen_log) = 0);
end $$;

do $$
declare ok1 boolean; ok2 boolean;
begin
  set local role anon;
  begin perform 1 from study_materials limit 1; ok1 := false; exception when insufficient_privilege then ok1 := true; end;
  begin perform 1 from study_gen_log limit 1; ok2 := false; exception when insufficient_privilege then ok2 := true; end;
  reset role;
  perform pg_temp.chk('anon tidak boleh membaca materi', ok1);
  perform pg_temp.chk('anon tidak boleh membaca catatan pemakaian', ok2);
end $$;

select case when ok then 'ok  ' else 'FAIL' end || name as hasil from res order by ok, name;
select count(*) filter (where not ok) as gagal from res;
