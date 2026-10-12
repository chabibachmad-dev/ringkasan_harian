-- Uji foto profil (migrasi 0031). Jalankan pada DB kosong setelah migrasi 0023-0031 (hasil akhir: 'gagal' harus 0).
-- Pada Postgres polos tabel storage.buckets tidak ada, jadi dibuat tiruannya di bawah (di Supabase: tidak berbuat apa-apa).
-- Berkas ini menjalankan 0031 sendiri di awal karena study_competition.sql/study_practice.sql menimpa study_feed.
--   psql -d <db> -f supabase/tests/study_avatar.sql
\set ON_ERROR_STOP off
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
\i supabase/migrations/0031_study_avatar.sql
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('FotoAli','SMP','s','h');
select pg_temp.chk('pemain baru: avatar_ver = 0 (belum berfoto)', (select avatar_ver from study_players where name='FotoAli') = 0);
update study_players set avatar_ver = avatar_ver + 1 where name='FotoAli';
update study_players set avatar_ver = avatar_ver + 1 where name='FotoAli';
select pg_temp.chk('versi naik tiap foto diganti', (select avatar_ver from study_players where name='FotoAli') = 2);
select pg_temp.chk('bucket study-avatars publik, JPEG saja, maks 200 KB',
  (select public and file_size_limit = 204800 and allowed_mime_types = array['image/jpeg'] from storage.buckets where id = 'study-avatars'));
select pg_temp.chk('study_feed membawa creatorId kompetisi', position($$'creatorId', r.creator_id$$ in pg_get_functiondef('public.study_feed(uuid,uuid,text[],integer,timestamptz)'::regprocedure)) > 0
  and position($$'materialTitle', s.material_title$$ in pg_get_functiondef('public.study_feed(uuid,uuid,text[],integer,timestamptz)'::regprocedure)) > 0);
select pg_temp.chk('study_feed tetap bisa dipanggil', (select count(*) >= 0 from public.study_feed(null, null)));
select pg_temp.chk('service_role boleh, anon tidak', has_function_privilege('service_role', 'public.study_feed(uuid,uuid,text[],integer,timestamptz)', 'execute') and not has_function_privilege('anon', 'public.study_feed(uuid,uuid,text[],integer,timestamptz)', 'execute'));

\i supabase/migrations/0031_study_avatar.sql
select pg_temp.chk('migrasi 0031 dijalankan ulang: aman, versi foto tidak direset', (select avatar_ver from study_players where name='FotoAli') = 2);

select name, ok from res where not ok;
select 'lulus: ' || count(*) filter (where ok) || ', gagal: ' || count(*) filter (where not ok) from res;
