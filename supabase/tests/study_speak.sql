-- Uji LATIHAN SPEAKING (migrasi 0035). Jalankan pada DB kosong setelah migrasi 0023-0035 (hasil akhir: 'gagal' harus 0).
-- Berkas ini menjalankan 0035 sendiri di awal.
--   psql -d <db> -f supabase/tests/study_speak.sql
\set ON_ERROR_STOP off
\i supabase/migrations/0035_study_speaking.sql
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('SAli','SD','s','h'),('SBudi','SMP','s','h');

do $$
declare a uuid; b uuid; s1 uuid; s2 uuid; s3 uuid; n int; u record; ok boolean;
begin
  select id into a from study_players where name = 'SAli';
  select id into b from study_players where name = 'SBudi';
  insert into study_speak_sessions(player_id,scenario,title,grade,class_level) values (a,'intro','intro','SD',5) returning id into s1;
  insert into study_speak_turns(session_id,idx,role,body) values (s1,0,'ai','Hello! What is your name?');
  insert into study_speak_turns(session_id,idx,role,body,correction,tip) values (s1,1,'user','My name Ali','My name is Ali.','Tambahkan "is" setelah name.');
  insert into study_speak_turns(session_id,idx,role,body) values (s1,2,'ai','Nice to meet you, Ali!');
  perform pg_temp.chk('sesi + giliran tersimpan', (select count(*) from study_speak_turns where session_id = s1) = 3);
  perform pg_temp.chk('koreksi & tip tersimpan di giliran pemain', (select correction = 'My name is Ali.' and tip like 'Tambahkan%' from study_speak_turns where session_id = s1 and idx = 1));
  perform pg_temp.chk('user_turns bawaan 0, updated_at terisi', (select user_turns = 0 and updated_at is not null and ended_at is null from study_speak_sessions where id = s1));

  -- idx unik per sesi
  begin
    insert into study_speak_turns(session_id,idx,role,body) values (s1,1,'user','dup');
    ok := false;
  exception when unique_violation then ok := true; end;
  perform pg_temp.chk('idx giliran unik per sesi', ok);
  -- role & panjang divalidasi
  begin insert into study_speak_turns(session_id,idx,role,body) values (s1,9,'bot','x'); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('role selain user/ai ditolak', ok);
  begin insert into study_speak_turns(session_id,idx,role,body) values (s1,9,'user','   '); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('isi kosong ditolak', ok);
  begin insert into study_speak_sessions(player_id,scenario,title) values (a,'','x'); ok := false; exception when check_violation then ok := true; end;
  perform pg_temp.chk('skenario kosong ditolak', ok);

  -- pemakaian 24 jam
  insert into study_speak_sessions(player_id,scenario,title,grade) values (b,'free','free','SMP') returning id into s2;
  insert into study_speak_turns(session_id,idx,role,body) values (s2,0,'ai','Hi!'),(s2,1,'user','Hi'),(s2,2,'ai','How are you?'),(s2,3,'user','Fine'),(s2,4,'ai','Great');
  select * into u from study_speak_usage(a);
  perform pg_temp.chk('usage Ali: 1 giliran sendiri, 3 total (hanya role user)', u.mine = 1 and u.total = 3);
  select * into u from study_speak_usage(b);
  perform pg_temp.chk('usage Budi: 2 giliran sendiri, 3 total', u.mine = 2 and u.total = 3);
  update study_speak_turns set created_at = now() - interval '25 hours' where session_id = s2 and idx = 1;
  select * into u from study_speak_usage(b);
  perform pg_temp.chk('giliran lebih dari 24 jam tidak dihitung', u.mine = 1 and u.total = 2);

  -- pembersihan 7 hari
  insert into study_speak_sessions(player_id,scenario,title,grade,updated_at) values (a,'school','school','SD', now() - interval '8 days') returning id into s3;
  insert into study_speak_turns(session_id,idx,role,body) values (s3,0,'ai','Old chat');
  insert into study_speak_sessions(player_id,scenario,title,grade,updated_at) values (a,'hobbies','hobbies','SD', now() - interval '6 days 23 hours');
  n := study_speak_purge(7);
  perform pg_temp.chk('purge: hapus 1 sesi > 7 hari', n = 1 and not exists (select 1 from study_speak_sessions where id = s3));
  perform pg_temp.chk('purge: giliran sesi lama ikut terhapus', not exists (select 1 from study_speak_turns where session_id = s3));
  perform pg_temp.chk('purge: sesi 6 hari 23 jam dan yang baru tetap ada', (select count(*) from study_speak_sessions) = 3);
  perform pg_temp.chk('purge ulang: 0', study_speak_purge(7) = 0);

  -- hapus pemain menghapus riwayat speaking-nya
  delete from study_players where id = b;
  perform pg_temp.chk('hapus pemain: sesi & giliran speaking-nya terhapus', not exists (select 1 from study_speak_sessions where id = s2) and not exists (select 1 from study_speak_turns where session_id = s2));

  -- keamanan: anon/authenticated tidak bisa memanggil fungsi, RLS aktif
  perform pg_temp.chk('RLS aktif di kedua tabel', (select count(*) from pg_class where relname in ('study_speak_sessions','study_speak_turns') and relrowsecurity) = 2);
  perform pg_temp.chk('fungsi hanya untuk service_role', not has_function_privilege('anon', 'study_speak_purge(integer)', 'execute') and not has_function_privilege('anon', 'study_speak_usage(uuid)', 'execute'));
end $$;

select case when ok then 'ok:   ' else 'GAGAL ' end || name as hasil from res order by ok, name;
select count(*) filter (where ok) as lulus, count(*) filter (where not ok) as gagal from res;
