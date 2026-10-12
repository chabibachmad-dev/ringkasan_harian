-- Uji tabel login perangkat (study_device_tokens). Jalankan pada DB kosong setelah migrasi 0023-0030 (hasil akhir: 'gagal' harus 0):
--   psql -d <db> -f supabase/tests/study_device.sql
\set ON_ERROR_STOP off
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;
create or replace function pg_temp.err(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return position(p_msg in sqlerrm) > 0; end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('DevAli','SMP','s','h'),('DevBudi','SMP','s','h');
insert into study_device_tokens(player_id, token_hash) select id, repeat('a',64) from study_players where name='DevAli';
insert into study_device_tokens(player_id, token_hash) select id, repeat('b',64) from study_players where name='DevAli';
insert into study_device_tokens(player_id, token_hash) select id, repeat('c',64) from study_players where name='DevBudi';

select pg_temp.chk('3 token tersimpan', (select count(*) from study_device_tokens t join study_players p on p.id=t.player_id where p.name like 'Dev%') = 3);
select pg_temp.chk('hash token harus unik', pg_temp.err($q$insert into study_device_tokens(player_id, token_hash) select id, repeat('a',64) from study_players where name='DevBudi'$q$, 'duplicate key'));
select pg_temp.chk('hash harus 64 karakter', pg_temp.err($q$insert into study_device_tokens(player_id, token_hash) select id, 'pendek' from study_players where name='DevBudi'$q$, 'check constraint'));
delete from study_device_tokens where token_hash = repeat('a',64);
select pg_temp.chk('hapus satu token (keluar) tidak mengganggu yang lain',
  (select count(*) from study_device_tokens t join study_players p on p.id=t.player_id where p.name='DevAli') = 1);
delete from study_device_tokens where player_id = (select id from study_players where name='DevAli');
select pg_temp.chk('hapus semua token pemain (reset PIN) hanya milik pemain itu',
  (select count(*) from study_device_tokens t join study_players p on p.id=t.player_id where p.name='DevAli') = 0
  and (select count(*) from study_device_tokens t join study_players p on p.id=t.player_id where p.name='DevBudi') = 1);
delete from study_players where name = 'DevBudi';
select pg_temp.chk('pemain dihapus: tokennya ikut terhapus', (select count(*) from study_device_tokens where token_hash = repeat('c',64)) = 0);
select pg_temp.chk('RLS aktif tanpa policy', (select relrowsecurity from pg_class where oid = 'public.study_device_tokens'::regclass) and (select count(*) from pg_policies where tablename = 'study_device_tokens') = 0);
select pg_temp.chk('anon/authenticated tanpa hak', not has_table_privilege('anon', 'public.study_device_tokens', 'select') and not has_table_privilege('authenticated', 'public.study_device_tokens', 'select'));

\i supabase/migrations/0030_study_device_login.sql
select pg_temp.chk('migrasi 0030 dijalankan ulang: aman', true);

select name, case when ok then 'ok' else 'GAGAL' end from res order by 1;
select 'gagal: ' || count(*) filter (where not ok) from res;
