-- Uji suka/komentar/timeline Study. Jalankan pada DB kosong setelah migrasi 0023 dan 0024:
--   psql -d <db> -f supabase/migrations/0023_study.sql -f supabase/migrations/0024_study_social.sql -f supabase/tests/study_social.sql
-- Hasil akhir: kolom 'gagal' harus 0.
\set ON_ERROR_STOP off
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('SocAli','SD','s','h'),('SocBudi','SMP','s','h'),('SocCitra','Umum','s','h');

do $$
declare ali uuid; budi uuid; citra uuid; s1 uuid; s2 uuid; s3 uuid; r jsonb; ok boolean; i int; cid uuid;
begin
  select id into ali from study_players where name='SocAli';
  select id into budi from study_players where name='SocBudi';
  select id into citra from study_players where name='SocCitra';
  -- s1, s2 selesai (s2 lebih baru), s3 masih aktif
  insert into study_sessions(player_id,subject,material_grade,level,num_questions,status,submitted_at,correct_count,weight_percent,base_points,points_awarded)
    values (ali,'Matematika','SD','easy',10,'submitted', now() - interval '2 hours', 8, 80, 100, 64) returning id into s1;
  insert into study_sessions(player_id,subject,material_grade,level,num_questions,status,submitted_at,correct_count,weight_percent,base_points,points_awarded)
    values (ali,'IPA-soc','SD','hard',10,'submitted', now() - interval '1 hour', 10, 120, 100, 120) returning id into s2;
  insert into study_sessions(player_id,subject,material_grade,level,num_questions) values (ali,'IPS','SD','normal',5) returning id into s3;

  -- timeline: hanya yang selesai, terbaru di atas
  perform pg_temp.chk('timeline hanya pelajaran selesai', (select count(*) from study_timeline(ali, null)) = 2);
  perform pg_temp.chk('timeline terbaru di atas', (select session_id from study_timeline(ali, null) limit 1) = s2);
  perform pg_temp.chk('timeline pemain tanpa kegiatan kosong', (select count(*) from study_timeline(budi, null)) = 0);
  perform pg_temp.chk('timeline kursor halaman berikutnya', (select count(*) from study_timeline(ali, null, 20, now() - interval '90 minutes')) = 1);
  perform pg_temp.chk('timeline batas jumlah', (select count(*) from study_timeline(ali, null, 1)) = 1);

  -- suka
  r := study_toggle_like(s2, budi);
  perform pg_temp.chk('suka pertama', (r->>'liked')::boolean and (r->>'count')::int = 1);
  r := study_toggle_like(s2, citra);
  perform pg_temp.chk('suka pemain kedua', (r->>'count')::int = 2);
  perform pg_temp.chk('timeline: jumlah suka & liked penonton', (select like_count = 2 and liked from study_timeline(ali, budi) where session_id = s2));
  perform pg_temp.chk('timeline: liked false untuk penonton lain/tanpa penonton', (select not liked from study_timeline(ali, null) where session_id = s2));
  r := study_toggle_like(s2, budi);
  perform pg_temp.chk('batal suka', not (r->>'liked')::boolean and (r->>'count')::int = 1);
  begin perform study_toggle_like(s2, ali); ok := false; exception when others then ok := sqlerrm like '%KEGIATAN_SENDIRI%'; end;
  perform pg_temp.chk('tidak boleh menyukai kegiatan sendiri', ok);
  begin perform study_toggle_like(s3, budi); ok := false; exception when others then ok := sqlerrm like '%KEGIATAN_TIDAK_ADA%'; end;
  perform pg_temp.chk('pelajaran belum selesai tidak bisa disukai', ok);
  begin perform study_toggle_like(gen_random_uuid(), budi); ok := false; exception when others then ok := sqlerrm like '%KEGIATAN_TIDAK_ADA%'; end;
  perform pg_temp.chk('suka pada kegiatan yang tidak ada ditolak', ok);
  begin perform study_toggle_like(s2, gen_random_uuid()); ok := false; exception when others then ok := sqlerrm like '%PEMAIN_TIDAK_ADA%'; end;
  perform pg_temp.chk('suka dari pemain tidak ada ditolak', ok);

  -- komentar
  r := study_add_comment(s2, budi, '  Keren, Ali!  ');
  perform pg_temp.chk('komentar tersimpan & dipangkas', r->>'body' = 'Keren, Ali!' and (r->>'count')::int = 1);
  cid := (r->>'id')::uuid;
  begin perform study_add_comment(s2, budi, '    '); ok := false; exception when others then ok := sqlerrm like '%KOMENTAR_TIDAK_VALID%'; end;
  perform pg_temp.chk('komentar kosong ditolak', ok);
  begin perform study_add_comment(s2, budi, repeat('x', 301)); ok := false; exception when others then ok := sqlerrm like '%KOMENTAR_TIDAK_VALID%'; end;
  perform pg_temp.chk('komentar >300 ditolak', ok);
  perform pg_temp.chk('komentar 300 diterima', (study_add_comment(s2, citra, repeat('y', 300))->>'count')::int = 2);
  begin perform study_add_comment(s2, ali, 'halo'); ok := false; exception when others then ok := sqlerrm like '%KEGIATAN_SENDIRI%'; end;
  perform pg_temp.chk('tidak boleh mengomentari kegiatan sendiri', ok);
  begin perform study_add_comment(s3, budi, 'halo'); ok := false; exception when others then ok := sqlerrm like '%KEGIATAN_TIDAK_ADA%'; end;
  perform pg_temp.chk('pelajaran belum selesai tidak bisa dikomentari', ok);
  for i in 2..10 loop perform study_add_comment(s2, budi, 'komentar ' || i); end loop;
  begin perform study_add_comment(s2, budi, 'kesebelas'); ok := false; exception when others then ok := sqlerrm like '%KOMENTAR_PENUH%'; end;
  perform pg_temp.chk('batas 10 komentar per pemain per pelajaran', ok);
  perform pg_temp.chk('timeline: jumlah komentar', (select comment_count = 11 from study_timeline(ali, null) where session_id = s2));

  -- RLS & hak akses
  perform pg_temp.chk('tidak ada kebijakan RLS (terkunci total)', (select count(*) from pg_policies where tablename in ('study_likes','study_comments')) = 0);
  perform pg_temp.chk('RLS aktif di tabel baru', (select count(*) from pg_tables where schemaname='public' and tablename in ('study_likes','study_comments') and rowsecurity) = 2);
end $$;

do $$
declare ok1 boolean; ok2 boolean; ok3 boolean;
begin
  set local role anon;
  begin perform study_timeline(gen_random_uuid(), null); ok1 := false; exception when insufficient_privilege then ok1 := true; end;
  begin perform study_toggle_like(gen_random_uuid(), gen_random_uuid()); ok2 := false; exception when insufficient_privilege then ok2 := true; end;
  begin perform 1 from study_comments limit 1; ok3 := false; exception when insufficient_privilege then ok3 := true; end;
  reset role;
  perform pg_temp.chk('anon tidak boleh memanggil timeline', ok1);
  perform pg_temp.chk('anon tidak boleh menyukai', ok2);
  perform pg_temp.chk('anon tidak boleh membaca komentar', ok3);
end $$;

-- hapus pelajaran / pemain ikut menghapus suka & komentar
do $$
declare s2 uuid;
begin
  select id into s2 from study_sessions where subject='IPA-soc';
  delete from study_players where name='SocBudi';
  perform pg_temp.chk('hapus pemain menghapus suka & komentarnya', (select count(*) from study_comments where player_id not in (select id from study_players)) = 0
    and (select count(*) from study_comments where session_id = s2) = 1);
  delete from study_sessions where id = s2;
  perform pg_temp.chk('hapus pelajaran menghapus suka & komentar', (select count(*) from study_comments) = 0 and (select count(*) from study_likes) = 0);
end $$;

select case when ok then 'ok  ' else 'FAIL' end || name as hasil from res order by ok, name;
select count(*) filter (where not ok) as gagal from res;
