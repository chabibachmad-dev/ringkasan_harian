-- Uji NOTIFIKASI suka & komentar (migrasi 0034). Jalankan pada DB kosong setelah migrasi 0023-0034 (hasil akhir: 'gagal' harus 0).
-- Berkas ini menjalankan 0034 sendiri di awal.
--   psql -d <db> -f supabase/tests/study_notif.sql
\set ON_ERROR_STOP off
\i supabase/migrations/0034_study_notifications.sql
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$ select id from study_players where name = n $$;
create or replace function pg_temp.qs(n int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('question','q'||i,'options','["a","b","c","d"]'::jsonb,'correctIndex', i%4) order by i) from generate_series(0,n-1) i $$;
create or replace function pg_temp.meta() returns jsonb language sql as $$
  select jsonb_build_object('subject','IPA','materialGrade','SMP','materialClass',8,'level','normal','timeLimitSeconds',600,'provider','gemini') $$;

insert into study_players(name,grade,pin_salt,pin_hash) values ('NAli','SMP','s','h'),('NBudi','SMP','s','h'),('NCici','SMP','s','h');
select pg_temp.chk('pemain baru: notif_seen_at terisi (mulai dari pendaftaran)', (select notif_seen_at <= now() and notif_seen_at > now() - interval '1 minute' from study_players where name = 'NAli'));
select pg_temp.chk('belum ada kegiatan: tidak ada notifikasi', (select count(*) from study_notifications(pg_temp.pid('NAli'))) = 0 and study_notif_count(pg_temp.pid('NAli')) = 0);

do $$
declare a uuid := pg_temp.pid('NAli'); b uuid := pg_temp.pid('NBudi'); c uuid := pg_temp.pid('NCici');
        sid uuid; mid uuid; rid uuid; n record; cnt int; t0 timestamptz;
begin
  -- pelajaran Ali selesai
  insert into study_sessions(player_id,subject,material_grade,level,num_questions,status,submitted_at,correct_count,points_awarded)
    values (a,'Matematika','SMP','normal',5,'submitted',now(),5,50) returning id into sid;
  update study_players set notif_seen_at = now() - interval '1 hour' where id = a;
  perform study_post_like('lesson', sid, b);
  perform study_post_comment('lesson', sid, c, 'Keren sekali');
  -- satu DO block = satu transaksi (now() sama): beri jarak waktu eksplisit supaya urutan & "belum dibaca" bisa diuji
  update study_likes set created_at = now() - interval '30 minutes' where session_id = sid;
  update study_comments set created_at = now() - interval '20 minutes' where session_id = sid;
  perform pg_temp.chk('Ali: 2 notifikasi (suka Budi, komentar Cici)', (select count(*) from study_notifications(a)) = 2 and study_notif_count(a) = 2);
  select * into n from study_notifications(a) where type = 'like';
  perform pg_temp.chk('suka: pelaku, jenis, judul', n.actor_name = 'NBudi' and n.kind = 'lesson' and n.target_id = sid and n.title = 'Matematika' and n.body is null);
  select * into n from study_notifications(a) where type = 'comment';
  perform pg_temp.chk('komentar: pelaku + isi komentar', n.actor_name = 'NCici' and n.body = 'Keren sekali' and n.kind = 'lesson');
  perform pg_temp.chk('urut terbaru di atas', (select type from study_notifications(a) limit 1) = 'comment');
  perform pg_temp.chk('pemain lain (Budi) tidak menerima notifikasi pelajaran Ali', (select count(*) from study_notifications(b)) = 0);

  -- suka dibatalkan -> hilang dari daftar
  perform study_post_like('lesson', sid, b);
  perform pg_temp.chk('suka dibatalkan: notifikasi hilang', (select count(*) from study_notifications(a) where type = 'like') = 0 and study_notif_count(a) = 1);
  perform study_post_like('lesson', sid, b);
  update study_likes set created_at = now() - interval '30 minutes' where session_id = sid; -- suka ulang = notifikasi baru; dimundurkan agar tes berikutnya terukur

  -- tandai sudah dibaca
  perform study_notif_seen(a);
  perform pg_temp.chk('sudah dibaca: belum dibaca = 0, daftar tetap ada', study_notif_count(a) = 0 and (select count(*) from study_notifications(a)) = 2);
  perform pg_temp.chk('notif_seen_at tidak mundur', (select notif_seen_at > now() - interval '1 minute' from study_players where id = a));
  perform study_notif_seen(a, now() - interval '5 days');
  perform pg_temp.chk('upto lama tidak memundurkan', study_notif_count(a) = 0);

  -- komentar baru -> belum dibaca lagi
  update study_players set notif_seen_at = now() - interval '10 minutes' where id = a;
  perform study_post_comment('lesson', sid, b, 'Mantap');
  update study_comments set created_at = now() - interval '5 minutes' where body = 'Mantap';
  perform pg_temp.chk('komentar baru: belum dibaca = 1', study_notif_count(a) = 1);
  select max(created_at) into t0 from study_notifications(a);
  perform study_notif_seen(a, t0);
  perform pg_temp.chk('tandai sampai notifikasi terbaru: 0', study_notif_count(a) = 0);

  -- materi buatan Ali
  insert into study_materials(creator_id,creator_name,subject,grade,detail,title,content) values (a,'NAli','Matematika','SMP','d','Teorema Pythagoras','isi') returning id into mid;
  perform study_post_like('material', mid, c);
  perform study_post_comment('material', mid, b, 'Terima kasih materinya');
  update study_likes set created_at = now() - interval '2 minutes' where material_id = mid;
  update study_comments set created_at = now() - interval '2 minutes' where material_id = mid;
  perform pg_temp.chk('materi: suka + komentar sampai ke pembuat', (select count(*) from study_notifications(a) where kind = 'material') = 2
     and (select title from study_notifications(a) where kind = 'material' limit 1) = 'Teorema Pythagoras' and study_notif_count(a) = 2);

  -- kompetisi Ali & Budi (selesai): Cici menyukai & mengomentari -> keduanya diberi tahu, Cici tidak
  rid := study_room_create(a, pg_temp.meta(), pg_temp.qs(4));
  perform study_room_join(rid, b);
  perform study_room_start(rid, a);
  perform study_room_submit(rid, a, '[0,1,2,3]');
  perform study_room_submit(rid, b, '[0,1,0,0]');
  perform pg_temp.chk('kompetisi selesai', (select status = 'finished' from study_rooms where id = rid));
  perform study_post_like('competition', rid, c);
  perform study_post_comment('competition', rid, c, 'Seru lombanya');
  perform pg_temp.chk('kompetisi: peserta Ali diberi tahu (suka + komentar)', (select count(*) from study_notifications(a) where kind = 'competition') = 2);
  perform pg_temp.chk('kompetisi: peserta Budi juga diberi tahu', (select count(*) from study_notifications(b) where kind = 'competition') = 2);
  perform pg_temp.chk('kompetisi: pelaku Cici tidak diberi tahu soal aksinya sendiri', (select count(*) from study_notifications(c) where kind = 'competition') = 0);
  -- sesama peserta saling suka di kompetisi: tidak menotifikasi diri sendiri
  perform study_post_like('competition', rid, b);
  perform pg_temp.chk('suka Budi di kompetisi: Ali diberi tahu, Budi tidak', (select count(*) from study_notifications(a) where kind = 'competition' and type = 'like') = 2
     and (select count(*) from study_notifications(b) where kind = 'competition' and type = 'like' and actor_name = 'NBudi') = 0);

  -- batas jumlah
  perform pg_temp.chk('limit 1 -> 1 baris', (select count(*) from study_notifications(a, 1)) = 1);
  perform pg_temp.chk('limit 0/negatif -> minimal 1 baris', (select count(*) from study_notifications(a, 0)) = 1 and (select count(*) from study_notifications(a, -5)) = 1);

  -- pemain dihapus: notifikasi dari pelaku itu ikut hilang
  delete from study_players where id = c;
  perform pg_temp.chk('pelaku dihapus: suka/komentarnya ikut hilang dari daftar Ali', (select count(*) from study_notifications(a) where actor_name = 'NCici') = 0);
end $$;

select pg_temp.chk('fungsi notifikasi hanya untuk service_role', not has_function_privilege('anon','public.study_notifications(uuid,integer)','execute')
  and not has_function_privilege('authenticated','public.study_notif_count(uuid)','execute')
  and has_function_privilege('service_role','public.study_notif_seen(uuid,timestamptz)','execute'));
\i supabase/migrations/0034_study_notifications.sql
select pg_temp.chk('migrasi 0034 dijalankan ulang: aman, notif_seen_at tidak direset', (select notif_seen_at < now() - interval '1 minute' from study_players where name = 'NAli'));

select name, case when ok then 'ok' else 'GAGAL' end from res where not ok;
select count(*) filter (where ok) as lulus, count(*) filter (where not ok) as gagal from res;
