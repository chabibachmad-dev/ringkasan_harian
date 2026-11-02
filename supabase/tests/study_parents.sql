-- Uji skema PIN orang tua per orang tua (migrasi 0044). Jalankan pada DB kosong setelah migrasi 0023 dan 0044:
--   psql -d <db> -f supabase/migrations/0023_study.sql -f supabase/migrations/0044_study_parents.sql -f supabase/tests/study_parents.sql
-- Hasil akhir: baris dengan ok = false harus 0. (Verifikasi PIN/penguncian ada di Edge Function; ini menguji data dan tautan.)
\set ON_ERROR_STOP off
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('PrAnak1','SD','s','h'),('PrAnak2','SMP','s','h'),('PrAnak3','SD','s','h');
do $$
declare a1 uuid; a2 uuid; a3 uuid; pa uuid; pb uuid; ok boolean;
begin
  select id into a1 from study_players where name='PrAnak1';
  select id into a2 from study_players where name='PrAnak2';
  select id into a3 from study_players where name='PrAnak3';
  insert into study_parents(name,pin_salt,pin_hash) values ('Ibu Ani','s','h') returning id into pa;
  insert into study_parents(name,pin_salt,pin_hash) values ('Pak Budi','s','h') returning id into pb;
  insert into study_parent_children values (pa,a1),(pa,a2),(pb,a3);
  perform pg_temp.chk('satu orang tua, beberapa anak', (select count(*) from study_parent_children where parent_id = pa) = 2);
  perform pg_temp.chk('anak A3 tidak tertaut ke orang tua A', not exists (select 1 from study_parent_children where parent_id = pa and player_id = a3));
  begin insert into study_parents(name,pin_salt,pin_hash) values ('  ibu ani ','s','h'); ok := false; exception when unique_violation then ok := true; end;
  perform pg_temp.chk('nama orang tua unik (tanpa beda huruf besar-kecil)', ok);
  begin insert into study_parent_children values (pa,a1); ok := false; exception when unique_violation then ok := true; end;
  perform pg_temp.chk('tautan ganda ditolak', ok);
  insert into study_parent_children values (pb,a1);
  perform pg_temp.chk('satu anak boleh punya dua orang tua', (select count(*) from study_parent_children where player_id = a1) = 2);
  insert into study_parent_actions(parent_id,parent_name,action,player_id,detail) values (pa,'Ibu Ani','penalty',a1,'10 poin');
  delete from study_parents where id = pa;
  perform pg_temp.chk('hapus orang tua: tautan ikut terhapus', not exists (select 1 from study_parent_children where parent_id = pa));
  perform pg_temp.chk('hapus orang tua: pemain tetap ada', (select count(*) from study_players where name like 'PrAnak%') = 3);
  perform pg_temp.chk('hapus orang tua: log tetap ada dengan nama tersalin', (select parent_name from study_parent_actions where player_id = a1 limit 1) = 'Ibu Ani');
  update study_settings set parent_pin_hash = null where id = 1;
  perform pg_temp.chk('PIN bersama lama nonaktif', (select parent_pin_hash from study_settings where id = 1) is null);
end $$;
select name, ok from res order by ok, name;
select count(*) filter (where not ok) as gagal from res;
