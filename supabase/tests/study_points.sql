-- Uji logika poin/penukaran/hukuman Study di Postgres. Jalankan pada DB kosong setelah migrasi 0023:
--   psql -d <db> -f supabase/migrations/0023_study.sql && psql -d <db> -f supabase/tests/study_points.sql
-- (butuh pgcrypto/extension seperti migrasi; hasil akhir: 'gagal' harus 0)
\set ON_ERROR_STOP off
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('Ali','SD','s','h'),('Budi','SMP','s','h') ;
select pg_temp.chk('seed 3 hadiah', (select count(*) from study_redeem_items)=3);
select pg_temp.chk('seed setting 80/100/120', (select weight_easy=80 and weight_normal=100 and weight_hard=120 and base_points=100 from study_settings));

-- sesi easy 15 soal
do $$
declare sid uuid; pid uuid; r jsonb; i int; ans jsonb := '[]'::jsonb;
begin
  select id into pid from study_players where name='Ali';
  insert into study_sessions(player_id,subject,material_grade,level,num_questions) values (pid,'Matematika','SD','easy',15) returning id into sid;
  for i in 0..14 loop
    insert into study_questions(session_id,idx,question,options,correct_index) values (sid,i,'q'||i,'["a","b","c","d"]'::jsonb, i%4);
    ans := ans || to_jsonb(i%4);
  end loop;
  r := study_submit_session(sid, ans);
  perform pg_temp.chk('15/15 easy = 80', (r->>'points')::int=80 and (r->>'correct')::int=15);
  r := study_submit_session(sid, ans);
  perform pg_temp.chk('submit ulang tidak dobel', (r->>'already')::boolean and (select count(*) from study_ledger where ref_id=sid)=1 and study_balance(pid)=80);
end $$;

-- hard 15/15 = 120, normal 10 dari 15 = 67, jawaban null/invalid = salah
do $$
declare sid uuid; pid uuid; r jsonb; i int; ans jsonb;
begin
  select id into pid from study_players where name='Budi';
  insert into study_sessions(player_id,subject,material_grade,level,num_questions) values (pid,'IPA','SMP','hard',15) returning id into sid;
  for i in 0..14 loop insert into study_questions(session_id,idx,question,options,correct_index) values (sid,i,'q','["a","b","c","d"]'::jsonb,0); end loop;
  select jsonb_agg(0) into ans from generate_series(1,15);
  r := study_submit_session(sid, ans);
  perform pg_temp.chk('hard 15/15 = 120', (r->>'points')::int=120);

  insert into study_sessions(player_id,subject,material_grade,level,num_questions) values (pid,'IPA','SMP','normal',15) returning id into sid;
  for i in 0..14 loop insert into study_questions(session_id,idx,question,options,correct_index) values (sid,i,'q','["a","b","c","d"]'::jsonb,0); end loop;
  select jsonb_agg(case when g<=10 then to_jsonb(0) when g=11 then 'null'::jsonb when g=12 then to_jsonb(9) when g=13 then to_jsonb('A'::text) else to_jsonb(1) end) into ans from generate_series(1,15) g;
  r := study_submit_session(sid, ans);
  perform pg_temp.chk('normal 10/15 = 67 (null/9/"A"/salah = salah)', (r->>'points')::int=67 and (r->>'correct')::int=10);
end $$;

select pg_temp.chk('leaderboard urut poin terbesar', (select name from study_leaderboard() limit 1)='Budi' and (select total_points from study_leaderboard() limit 1)=187);
select pg_temp.chk('leaderboard jumlah pelajaran', (select sessions_done from study_leaderboard() where name='Budi')=2);

-- redeem
do $$
declare pid uuid; r jsonb; item uuid; ok boolean;
begin
  select id into pid from study_players where name='Ali';
  select id into item from study_redeem_items where cost=2000;
  begin perform study_redeem(pid,item); ok:=false; exception when others then ok := sqlerrm='SALDO_KURANG'; end;
  perform pg_temp.chk('redeem saldo kurang ditolak', ok);
  insert into study_ledger(player_id,kind,points) values (pid,'session',2000);
  r := study_redeem(pid,item);
  perform pg_temp.chk('redeem mengurangi saldo + riwayat pending', (r->>'balance')::int=80 and study_balance(pid)=80 and (select status from study_redemptions where player_id=pid)='pending');
  perform pg_temp.chk('leaderboard total tidak turun karena redeem', (select total_points from study_leaderboard() where name='Ali')=2080);
end $$;

-- hukuman
do $$
declare pid uuid; r jsonb; ok boolean;
begin
  select id into pid from study_players where name='Ali';
  r := study_apply_penalty(pid, 30, 'Tidak mengerjakan PR');
  perform pg_temp.chk('hukuman 30 dari saldo 80', (r->>'applied')::int=30 and (r->>'balance')::int=50);
  r := study_apply_penalty(pid, 500, 'Besar');
  perform pg_temp.chk('hukuman berhenti di 0', (r->>'applied')::int=50 and (r->>'requested')::int=500 and study_balance(pid)=0);
  r := study_apply_penalty(pid, 10, 'x');
  perform pg_temp.chk('saldo 0: tidak ada catatan baru', (r->>'applied')::int=0 and (select count(*) from study_ledger where player_id=pid and kind='penalty')=2);
  begin perform study_apply_penalty(pid, 0, 'x'); ok:=false; exception when others then ok := sqlerrm='POIN_TIDAK_VALID'; end;
  perform pg_temp.chk('hukuman 0 ditolak', ok);
end $$;

-- hak akses: anon tidak boleh memanggil fungsi / membaca tabel
do $$
declare ok1 boolean; ok2 boolean;
begin
  set local role anon;
  begin perform study_leaderboard(); ok1:=false; exception when insufficient_privilege then ok1:=true; end;
  begin perform 1 from study_questions limit 1; ok2 := false; exception when insufficient_privilege then ok2:=true; end;
  reset role;
  perform pg_temp.chk('anon tidak boleh memanggil fungsi', ok1);
  perform pg_temp.chk('anon tidak boleh membaca kunci jawaban', ok2);
end $$;

-- hapus pemain menghapus sesi/soal/riwayat (cascade)
delete from study_players where name='Budi';
select pg_temp.chk('cascade hapus pemain', (select count(*) from study_sessions s where not exists (select 1 from study_players p where p.id=s.player_id))=0 and (select count(*) from study_questions)=15);

select case when ok then 'ok  ' else 'FAIL' end || name as hasil from res order by ok, name;
select count(*) filter (where not ok) as gagal from res;
