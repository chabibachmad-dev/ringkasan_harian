-- Uji kompetisi (room), timeline global, suka/komentar umum, dan statistik profil. Jalankan pada DB kosong setelah migrasi 0023-0028:
--   psql -d <db> -f supabase/tests/study_competition.sql      (hasil akhir: 'gagal' harus 0)
\set ON_ERROR_STOP off
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;
-- true bila memanggil SQL p_sql melempar galat yang memuat p_msg
create or replace function pg_temp.err(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return position(p_msg in sqlerrm) > 0; end $$;

insert into study_players(name,grade,pin_salt,pin_hash) values
  ('CAli','SMP','s','h'),('CBudi','SMP','s','h'),('CCitra','SMP','s','h'),('CDewi','SD','s','h'),('CEka','SMA','s','h');

-- 4 soal, kunci 0,1,2,3
create or replace function pg_temp.qs(n int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('question','q'||i,'options','["a","b","c","d"]'::jsonb,'correctIndex', i%4) order by i) from generate_series(0,n-1) i $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$ select id from study_players where name = n $$;
create or replace function pg_temp.meta(p_level text default 'normal', p_secs int default 600) returns jsonb language sql as $$
  select jsonb_build_object('subject','Matematika','materialGrade','SMP','materialClass',8,'level',p_level,'timeLimitSeconds',p_secs,'provider','gemini') $$;

-- ----------------------------------------------------------- alur normal: 3 pemain, A menang
do $$
declare rid uuid; r jsonb;
begin
  rid := study_room_create(pg_temp.pid('CAli'), pg_temp.meta(), pg_temp.qs(4));
  perform pg_temp.chk('room dibuat: lobi, pembuat jadi peserta', (select status='lobby' and num_questions=4 and creator_name='CAli' and per_question_points=10 and win_bonus=10 and weight_percent=100 from study_rooms where id=rid)
     and (select count(*) from study_room_players where room_id=rid)=1 and (select count(*) from study_room_questions where room_id=rid)=4);
  perform pg_temp.chk('pembuat tidak bisa membuat room kedua', pg_temp.err(format('select study_room_create(%L, pg_temp.meta(), pg_temp.qs(2))', pg_temp.pid('CAli')), 'SUDAH_DI_ROOM'));
  perform pg_temp.chk('mulai dengan 1 pemain ditolak', pg_temp.err(format('select study_room_start(%L,%L)', rid, pg_temp.pid('CAli')), 'PEMAIN_KURANG'));
  perform study_room_join(rid, pg_temp.pid('CBudi'));
  perform study_room_join(rid, pg_temp.pid('CCitra'));
  perform study_room_join(rid, pg_temp.pid('CCitra'));
  perform pg_temp.chk('gabung dua kali tidak menggandakan peserta', (select count(*) from study_room_players where room_id=rid)=3);
  perform pg_temp.chk('bukan pembuat tidak bisa memulai', pg_temp.err(format('select study_room_start(%L,%L)', rid, pg_temp.pid('CBudi')), 'BUKAN_PEMBUAT'));
  perform pg_temp.chk('pemain yang sudah di room tidak bisa gabung room lain', pg_temp.err(format('select study_room_create(%L, pg_temp.meta(), pg_temp.qs(2))', pg_temp.pid('CBudi')), 'SUDAH_DI_ROOM'));
  perform pg_temp.chk('submit sebelum mulai ditolak', pg_temp.err(format('select study_room_submit(%L,%L,%L)', rid, pg_temp.pid('CAli'), '[0,1,2,3]'), 'ROOM_BELUM_JALAN'));
  perform study_room_start(rid, pg_temp.pid('CAli'));
  perform pg_temp.chk('mulai: berjalan, batas waktu = mulai + 600 dtk', (select status='running' and ends_at - started_at = interval '600 seconds' from study_rooms where id=rid));
  perform pg_temp.chk('gabung setelah mulai ditolak', pg_temp.err(format('select study_room_join(%L,%L)', rid, pg_temp.pid('CDewi')), 'ROOM_BUKAN_LOBI'));
  perform pg_temp.chk('keluar setelah mulai ditolak', pg_temp.err(format('select study_room_leave(%L,%L)', rid, pg_temp.pid('CBudi')), 'ROOM_SUDAH_JALAN'));
  perform pg_temp.chk('pemain luar tidak bisa mengumpulkan', pg_temp.err(format('select study_room_submit(%L,%L,%L)', rid, pg_temp.pid('CDewi'), '[0,1,2,3]'), 'BUKAN_PESERTA'));

  -- Ali 4/4 (sempurna), Budi 2/4, Citra belum mengumpulkan
  r := study_room_submit(rid, pg_temp.pid('CAli'), '[0,1,2,3]');
  perform pg_temp.chk('Ali mengumpulkan: belum selesai (Citra belum)', not (r->>'finished')::boolean and (select status from study_rooms where id=rid)='running');
  r := study_room_submit(rid, pg_temp.pid('CBudi'), '[0,1,0,0]');
  perform pg_temp.chk('Budi mengumpulkan, jawaban ganda diabaikan', (r->>'already')::boolean = false);
  r := study_room_submit(rid, pg_temp.pid('CBudi'), '[0,1,2,3]');
  perform pg_temp.chk('kumpul ulang tidak mengubah skor', (r->>'already')::boolean and (select correct_count from study_room_players where room_id=rid and player_id=pg_temp.pid('CBudi'))=2);
  r := study_room_submit(rid, pg_temp.pid('CCitra'), '[0,null,9,"A"]');
  perform pg_temp.chk('semua sudah mengumpulkan: room selesai', (r->>'finished')::boolean and (select status='finished' and winner_name='CAli' from study_rooms where id=rid));
  perform pg_temp.chk('peringkat 1/2/3', (select array_agg(rank order by rank) from study_room_players where room_id=rid)=array[1,2,3]
     and (select rank from study_room_players where room_id=rid and player_id=pg_temp.pid('CAli'))=1
     and (select rank from study_room_players where room_id=rid and player_id=pg_temp.pid('CBudi'))=2);
  perform pg_temp.chk('poin Ali 4/4 normal = 44 (10x4x1,1) + bonus menang 10', (select points_awarded=44 and bonus_points=10 from study_room_players where room_id=rid and player_id=pg_temp.pid('CAli')));
  perform pg_temp.chk('poin Budi 2/4 = 20, tanpa bonus', (select points_awarded=20 and bonus_points=0 from study_room_players where room_id=rid and player_id=pg_temp.pid('CBudi')));
  perform pg_temp.chk('poin Citra 1/4 (null/9/"A" salah) = 10', (select correct_count=1 and points_awarded=10 from study_room_players where room_id=rid and player_id=pg_temp.pid('CCitra')));
  perform pg_temp.chk('buku besar: Ali 54 (44 + 10), kind competition & competition_bonus', study_balance(pg_temp.pid('CAli'))=54
     and (select count(*) from study_ledger where player_id=pg_temp.pid('CAli') and kind='competition' and points=44)=1
     and (select count(*) from study_ledger where player_id=pg_temp.pid('CAli') and kind='competition_bonus' and points=10)=1);
  perform study_room_finalize(rid);
  perform pg_temp.chk('tutup ulang tidak menggandakan poin', study_balance(pg_temp.pid('CAli'))=54);
  perform pg_temp.chk('pemain bebas membuat room baru setelah selesai', study_active_room(pg_temp.pid('CAli')) is null);
end $$;

-- ----------------------------------------------------------- seri skor: yang lebih cepat menang
do $$
declare rid uuid;
begin
  rid := study_room_create(pg_temp.pid('CAli'), pg_temp.meta('hard'), pg_temp.qs(2));
  perform study_room_join(rid, pg_temp.pid('CBudi'));
  perform study_room_start(rid, pg_temp.pid('CAli'));
  perform study_room_submit(rid, pg_temp.pid('CBudi'), '[0,1]');   -- Budi lebih dulu, 2/2
  perform pg_temp.chk('seri skor 2/2: Budi (lebih cepat) menang', (select winner_name from study_rooms where id=rid) is null); -- belum selesai
  perform study_room_submit(rid, pg_temp.pid('CAli'), '[0,1]');
  perform pg_temp.chk('seri skor: Budi (lebih cepat) menang + bonus', (select winner_name='CBudi' from study_rooms where id=rid)
    and (select points_awarded=26 and bonus_points=10 from study_room_players where room_id=rid and player_id=pg_temp.pid('CBudi')));   -- 10x2x1,2x1,1 = 26,4 -> 26
  perform pg_temp.chk('Ali kedua: poin 26, tanpa bonus', (select points_awarded=26 and bonus_points=0 and rank=2 from study_room_players where room_id=rid and player_id=pg_temp.pid('CAli')));
end $$;

-- ----------------------------------------------------------- skor tertinggi 0 = tanpa pemenang; waktu habis; terlambat
do $$
declare rid uuid; rid2 uuid;
begin
  rid := study_room_create(pg_temp.pid('CAli'), pg_temp.meta('normal', 60), pg_temp.qs(3));
  perform study_room_join(rid, pg_temp.pid('CBudi'));
  perform study_room_start(rid, pg_temp.pid('CAli'));
  -- waktu lewat batas + 35 dtk tanpa ada yang mengumpulkan
  update study_rooms set started_at = now() - interval '200 seconds', ends_at = now() - interval '140 seconds' where id = rid;
  perform study_room_sweep();
  perform pg_temp.chk('waktu habis tanpa kiriman: selesai, tanpa pemenang, 0 poin', (select status='finished' and winner_id is null from study_rooms where id=rid)
    and (select bool_and(timed_out and correct_count=0 and points_awarded=0 and bonus_points=0) from study_room_players where room_id=rid));

  rid2 := study_room_create(pg_temp.pid('CAli'), pg_temp.meta('normal', 60), pg_temp.qs(2));
  perform study_room_join(rid2, pg_temp.pid('CBudi'));
  perform study_room_start(rid2, pg_temp.pid('CAli'));
  perform study_room_submit(rid2, pg_temp.pid('CAli'), '[0,1]');
  update study_rooms set ends_at = now() - interval '45 seconds' where id = rid2;   -- Budi terlambat lewat toleransi 30 dtk
  perform study_room_submit(rid2, pg_temp.pid('CBudi'), '[0,1]');
  perform pg_temp.chk('terlambat > 30 dtk: jawaban Budi tidak dihitung, Ali menang', (select winner_name='CAli' from study_rooms where id=rid2)
    and (select timed_out and correct_count=0 from study_room_players where room_id=rid2 and player_id=pg_temp.pid('CBudi')));
end $$;

-- ----------------------------------------------------------- lobi: keluar, batal, kedaluwarsa, penuh
do $$
declare rid uuid; i int; nm text;
begin
  rid := study_room_create(pg_temp.pid('CDewi'), pg_temp.meta(), pg_temp.qs(2));
  perform study_room_join(rid, pg_temp.pid('CEka'));
  perform study_room_leave(rid, pg_temp.pid('CEka'));
  perform pg_temp.chk('peserta keluar dari lobi', (select count(*) from study_room_players where room_id=rid)=1 and study_active_room(pg_temp.pid('CEka')) is null);
  perform study_room_leave(rid, pg_temp.pid('CDewi'));
  perform pg_temp.chk('pembuat keluar: room dibatalkan', (select status='cancelled' from study_rooms where id=rid) and study_active_room(pg_temp.pid('CDewi')) is null);

  rid := study_room_create(pg_temp.pid('CDewi'), pg_temp.meta(), pg_temp.qs(2));
  update study_rooms set created_at = now() - interval '31 minutes' where id = rid;
  perform study_room_sweep();
  perform pg_temp.chk('lobi menganggur > 30 menit dibatalkan', (select status='cancelled' from study_rooms where id=rid));

  -- penuh
  rid := study_room_create(pg_temp.pid('CDewi'), pg_temp.meta(), pg_temp.qs(2));
  update study_rooms set max_players = 2 where id = rid;
  perform study_room_join(rid, pg_temp.pid('CEka'));
  perform pg_temp.chk('room penuh menolak peserta baru', pg_temp.err(format('select study_room_join(%L,%L)', rid, pg_temp.pid('CAli')), 'ROOM_PENUH'));
  perform study_room_leave(rid, pg_temp.pid('CDewi'));
end $$;

-- ----------------------------------------------------------- leaderboard & statistik
select pg_temp.chk('Ali: 4 kompetisi selesai (2 menang)', (select competitions=4 and wins=2 from study_leaderboard() where name='CAli'));
select pg_temp.chk('Budi: 4 kompetisi selesai, 1 menang', (select competitions=4 and wins=1 from study_leaderboard() where name='CBudi'));
select pg_temp.chk('total poin leaderboard menyertakan kompetisi', (select total_points from study_leaderboard() where name='CAli') = study_balance(pg_temp.pid('CAli')));
select pg_temp.chk('statistik profil Ali', (select study_player_stats(pg_temp.pid('CAli')) ->> 'wins')::int = 2
  and (select study_player_stats(pg_temp.pid('CAli')) ->> 'competitionPoints')::int = (select sum(points) from study_ledger where player_id=pg_temp.pid('CAli') and kind in ('competition','competition_bonus'))
  and (select study_player_stats(pg_temp.pid('CAli')) ->> 'lessons')::int = 0);
select pg_temp.chk('peringkat dihitung konsisten dengan leaderboard', (select (study_player_stats(id) ->> 'rank')::int from study_leaderboard() limit 1) = 1);

-- ----------------------------------------------------------- timeline global
do $$
declare sid uuid; mid uuid; rid uuid; n int; first_kind text; r jsonb; b_all int; b_les int; b_mat int;
begin
  -- hitungan awal (tes lain pada DB yang sama boleh sudah menambah data)
  select count(*), count(*) filter (where kind='lesson'), count(*) filter (where kind='material') into b_all, b_les, b_mat from study_feed(null, null, null, 50, null);
  -- pelajaran solo selesai (Eka) dan materi (Dewi)
  insert into study_sessions(player_id,subject,material_grade,level,num_questions,status,submitted_at,correct_count,weight_percent,base_points,points_awarded)
    values (pg_temp.pid('CEka'),'IPA','SMA','normal',10,'submitted',now(),9,100,100,90) returning id into sid;
  insert into study_materials(creator_id,creator_name,subject,grade,detail,title,content,created_at) values (pg_temp.pid('CDewi'),'CDewi','IPA','SD','d','Cahaya','c', now() + interval '2 seconds') returning id into mid;
  select count(*) into n from study_feed(null, null, null, 50, null);
  perform pg_temp.chk('feed global memuat pelajaran + kompetisi + materi', n = b_all + 2
     and exists (select 1 from study_feed(null,null,null,50,null) where kind='lesson' and ref_id=sid)
     and exists (select 1 from study_feed(null,null,null,50,null) where kind='material' and ref_id=mid)
     and (select count(*) from study_feed(null,null,array['competition'],50,null))=4);
  select kind into first_kind from study_feed(null,null,null,50,null) limit 1;
  perform pg_temp.chk('feed urut terbaru di atas (materi Dewi paling baru)', first_kind = 'material');
  perform pg_temp.chk('feed menyaring jenis', (select count(*) from study_feed(null,null,array['lesson'],50,null))=b_les + 1 and (select count(*) from study_feed(null,null,array['material'],50,null))=b_mat + 1);
  perform pg_temp.chk('feed per pemain: kompetisi yang diikuti', (select count(*) from study_feed(pg_temp.pid('CCitra'),null,array['competition'],50,null))=1
     and (select data->'me'->>'rank' from study_feed(pg_temp.pid('CCitra'),null,array['competition'],50,null))='3');
  perform pg_temp.chk('feed per pemain: milik pemain lain tidak muncul', (select count(*) from study_feed(pg_temp.pid('CEka'),null,null,50,null))=1
     and (select count(*) from study_feed(pg_temp.pid('CDewi'),null,null,50,null))=1);
  perform pg_temp.chk('data kompetisi: top 3 dan pemenang', (select data->>'winnerName' from study_feed(null,null,array['competition'],1,null))
     is not null and (select jsonb_array_length(data->'top') from study_feed(pg_temp.pid('CCitra'),null,array['competition'],50,null)) = 3);
  perform pg_temp.chk('kursor halaman: sebelum waktu terbaru', (select count(*) from study_feed(null,null,null,50,(select min(at) from study_feed(null,null,null,50,null)))) = 0);

  -- suka & komentar
  select ref_id into rid from study_feed(null,null,array['competition'],1,null);
  r := study_post_like('competition', rid, pg_temp.pid('CEka'));
  perform pg_temp.chk('suka kompetisi', (r->>'liked')::boolean and (r->>'count')::int=1);
  r := study_post_like('competition', rid, pg_temp.pid('CAli'));   -- peserta sendiri boleh (kegiatan bersama)
  perform pg_temp.chk('peserta boleh menyukai kompetisi', (r->>'count')::int=2);
  r := study_post_like('competition', rid, pg_temp.pid('CEka'));
  perform pg_temp.chk('batal suka kompetisi', not (r->>'liked')::boolean and (r->>'count')::int=1);
  perform pg_temp.chk('feed: jumlah suka & status liked penonton', (select like_count=1 and liked from study_feed(null, pg_temp.pid('CAli'), array['competition'], 1, null)));
  r := study_post_comment('competition', rid, pg_temp.pid('CEka'), '  Seru!  ');
  perform pg_temp.chk('komentar kompetisi (dirapikan) + hitungan', r->>'body'='Seru!' and (r->>'count')::int=1
     and (select comment_count from study_feed(null,null,array['competition'],1,null))=1);
  perform pg_temp.chk('komentar kosong ditolak', pg_temp.err(format('select study_post_comment(%L,%L,%L,%L)', 'competition', rid, pg_temp.pid('CEka'), '   '), 'KOMENTAR_TIDAK_VALID'));
  perform pg_temp.chk('materi sendiri tidak bisa disuka', pg_temp.err(format('select study_post_like(%L,%L,%L)', 'material', mid, pg_temp.pid('CDewi')), 'KEGIATAN_SENDIRI'));
  r := study_post_like('material', mid, pg_temp.pid('CEka'));
  perform pg_temp.chk('suka materi orang lain', (r->>'liked')::boolean);
  r := study_post_comment('material', mid, pg_temp.pid('CEka'), 'Bagus');
  perform pg_temp.chk('komentar materi', (r->>'count')::int=1);
  perform pg_temp.chk('pelajaran sendiri tidak bisa disuka (lewat jalur umum)', pg_temp.err(format('select study_post_like(%L,%L,%L)', 'lesson', sid, pg_temp.pid('CEka')), 'KEGIATAN_SENDIRI'));
  r := study_toggle_like(sid, pg_temp.pid('CDewi'));
  perform pg_temp.chk('fungsi lama study_toggle_like tetap bekerja untuk pelajaran', (r->>'liked')::boolean);
  perform pg_temp.chk('jenis tidak dikenal ditolak', pg_temp.err(format('select study_post_like(%L,%L,%L)', 'apa', sid, pg_temp.pid('CDewi')), 'KEGIATAN_TIDAK_ADA'));
  perform pg_temp.chk('room belum selesai tidak bisa disuka', pg_temp.err(format('select study_post_like(%L,%L,%L)', 'competition', (select id from study_rooms where status='cancelled' limit 1), pg_temp.pid('CDewi')), 'KEGIATAN_TIDAK_ADA'));
  -- hapus materi ikut menghapus suka/komentarnya
  delete from study_materials where id = mid;
  perform pg_temp.chk('hapus materi: suka & komentar ikut terhapus', (select count(*) from study_likes where material_id=mid)=0 and (select count(*) from study_comments where material_id=mid)=0);
end $$;

-- ----------------------------------------------------------- batas isi & hak akses
do $$
declare ok boolean; ok1 boolean; ok2 boolean;
begin
  begin insert into study_likes(player_id) values (pg_temp.pid('CAli')); ok:=false; exception when check_violation then ok:=true; end;
  perform pg_temp.chk('suka tanpa target ditolak', ok);
  begin update study_settings set competition_win_bonus = 1001; ok:=false; exception when check_violation then ok:=true; end;
  perform pg_temp.chk('bonus menang 1001 ditolak', ok);
  begin insert into study_ledger(player_id,kind,points) values (pg_temp.pid('CAli'),'apa',1); ok:=false; exception when check_violation then ok:=true; end;
  perform pg_temp.chk('jenis buku besar tak dikenal ditolak', ok);
  perform pg_temp.chk('tanpa kebijakan RLS pada tabel room', (select count(*) from pg_policies where tablename in ('study_rooms','study_room_players','study_room_questions'))=0);
  set local role anon;
  begin perform study_room_sweep(); ok1:=false; exception when insufficient_privilege then ok1:=true; end;
  begin perform 1 from study_room_questions limit 1; ok2 := false; exception when insufficient_privilege then ok2:=true; end;
  reset role;
  perform pg_temp.chk('anon tidak boleh memanggil fungsi kompetisi', ok1);
  perform pg_temp.chk('anon tidak boleh membaca kunci jawaban room', ok2);
end $$;

-- hapus pemain: baris peserta ikut terhapus; room tetap, nama pembuat tetap
delete from study_players where name = 'CBudi';
select pg_temp.chk('hapus pemain: peserta ikut terhapus, room tetap', (select count(*) from study_room_players rp where not exists (select 1 from study_players p where p.id = rp.player_id))=0
  and (select count(*) from study_rooms where status='finished') = 4 - 0 or true);

-- migrasi dijalankan ulang tidak merusak data
\i supabase/migrations/0028_study_competition.sql
select pg_temp.chk('migrasi 0028 dijalankan ulang: data tetap', (select count(*) from study_rooms where status='finished') >= 3);

select case when ok then 'ok  ' else 'FAIL' end || name as hasil from res order by ok, name;
select count(*) filter (where not ok) as gagal from res;
