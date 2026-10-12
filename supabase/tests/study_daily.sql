-- Uji BATAS POIN HARIAN + dasbor "poin didapat hari ini" (migrasi 0032). Jalankan pada DB kosong setelah migrasi 0023-0032:
--   psql -d <db> -f supabase/tests/study_daily.sql      (hasil akhir: 'gagal' harus 0)
-- Berkas ini mengubah study_settings (poin per soal 100) agar satu pelajaran bisa melewati 1000 poin.
-- Berkas ini menjalankan 0032 sendiri di awal (jalankan dari akar proyek) karena study_scoring.sql dan study_competition.sql
-- menjalankan ulang 0027/0028 yang menimpa study_submit_session/study_room_finalize.
\set ON_ERROR_STOP off
\i supabase/migrations/0032_study_daily_cap.sql
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin insert into res values (n, coalesce(c,false)); end $$;
create or replace function pg_temp.err(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return position(p_msg in sqlerrm) > 0; end $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$ select id from study_players where name = n $$;
-- pelajaran normal n soal, c jawaban benar (kunci selalu 0); mengembalikan hasil study_submit_session
create or replace function pg_temp.lesson(p_name text, n int, c int) returns jsonb language plpgsql as $$
declare sid uuid; i int; ans jsonb := '[]'::jsonb;
begin
  insert into study_sessions(player_id,subject,material_grade,level,num_questions) values (pg_temp.pid(p_name),'Matematika','SMP','normal',n) returning id into sid;
  for i in 0..n-1 loop
    insert into study_questions(session_id,idx,question,options,correct_index) values (sid,i,'q'||i,'["a","b","c","d"]'::jsonb,0);
    ans := ans || to_jsonb(case when i < c then 0 else 1 end);
  end loop;
  return study_submit_session(sid, ans);
end $$;
create or replace function pg_temp.qs(n int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('question','q'||i,'options','["a","b","c","d"]'::jsonb,'correctIndex', i%4) order by i) from generate_series(0,n-1) i $$;
create or replace function pg_temp.meta() returns jsonb language sql as $$
  select jsonb_build_object('subject','Matematika','materialGrade','SMP','materialClass',8,'level','normal','timeLimitSeconds',600,'provider','gemini') $$;

insert into study_players(name,grade,pin_salt,pin_hash) values
  ('DAli','SMP','s','h'),('DBudi','SMP','s','h'),('DCitra','SMP','s','h'),('DDewi','SMP','s','h'),
  ('DEka','SMP','s','h'),('DFani','SMP','s','h'),('DGita','SMP','s','h'),('DHadi','SMP','s','h');
-- pengaturan yang dipakai berkas ini (supaya tidak bergantung pada berkas uji lain)
update study_settings set per_question_points = 100, perfect_bonus_percent = 10, weight_easy = 80, weight_normal = 100, weight_hard = 120,
  daily_points_cap = 1000, day_timezone = 'Asia/Jakarta' where id = 1;

select pg_temp.chk('bawaan: batas 1000/hari, zona Asia/Jakarta', (select daily_points_cap=1000 and day_timezone='Asia/Jakarta' from study_settings where id=1)
  and study_day_tz()='Asia/Jakarta');
select pg_temp.chk('batas harian negatif ditolak', pg_temp.err('update study_settings set daily_points_cap = -1 where id = 1', 'violates check'));
select pg_temp.chk('awal hari = 00.00 zona hari belajar, hari ini memuat sekarang',
  (study_day_start(now()) at time zone 'Asia/Jakarta')::time = time '00:00'
  and study_day_start(now()) <= now() and now() < study_day_start(now()) + interval '1 day');
update study_settings set day_timezone = 'Bukan/Zona' where id = 1;
select pg_temp.chk('zona waktu tidak valid -> kembali ke Asia/Jakarta', study_day_tz() = 'Asia/Jakarta');
update study_settings set day_timezone = 'Asia/Jakarta' where id = 1;

-- ----------------------------------------------------------- pelajaran: dipotong ke 1000, redeem & hukuman tidak membuka jatah
do $$
declare r jsonb; pid uuid := pg_temp.pid('DAli'); item uuid; d jsonb;
begin
  r := pg_temp.lesson('DAli', 10, 10);
  perform pg_temp.chk('10/10 normal = 1100 mentah, dipotong 1000', (r->>'points')::int=1000 and (r->>'rawPoints')::int=1100 and (r->>'capped')::boolean);
  perform pg_temp.chk('sesi menyimpan poin mentah 1100 & poin 1000', (select points_raw=1100 and points_awarded=1000 from study_sessions where player_id=pid));
  perform pg_temp.chk('buku besar 1000, jatah habis', study_balance(pid)=1000 and study_earned_today(pid)=1000 and study_cap_left(pid)=0);

  r := pg_temp.lesson('DAli', 10, 10);
  perform pg_temp.chk('pelajaran berikutnya: 0 poin, tetap dinilai (10/10)', (r->>'points')::int=0 and (r->>'correct')::int=10 and (r->>'rawPoints')::int=1100 and (r->>'capped')::boolean);
  perform pg_temp.chk('tidak ada baris buku besar baru untuk 0 poin', (select count(*) from study_ledger where player_id=pid)=1);

  -- tukar hadiah: saldo turun tetapi jatah TIDAK terbuka lagi
  insert into study_ledger(player_id,kind,points,note,created_at) values (pid,'session',5000,'poin hari-hari lalu', now() - interval '3 days');
  select id into item from study_redeem_items order by cost limit 1;
  perform study_redeem(pid, item);
  perform pg_temp.chk('redeem mengurangi saldo (6000 -> 4000)', study_balance(pid) = 4000);
  r := pg_temp.lesson('DAli', 10, 10);
  perform pg_temp.chk('setelah redeem tetap maks 1000/hari (0 poin baru)', (r->>'points')::int=0 and study_earned_today(pid)=1000 and study_cap_left(pid)=0);
  insert into study_ledger(player_id,kind,points,note) values (pid,'penalty',-300,'hukuman');
  r := pg_temp.lesson('DAli', 10, 5);
  perform pg_temp.chk('setelah hukuman tetap 0 poin baru', (r->>'points')::int=0 and (r->>'rawPoints')::int=500 and study_earned_today(pid)=1000);

  d := study_daily(pid);
  perform pg_temp.chk('dasbor: batas 1000, didapat 1000, sisa 0, tercapai', (d->>'cap')::int=1000 and (d->>'earned')::int=1000 and (d->>'remaining')::int=0 and (d->>'reached')::boolean);
  perform pg_temp.chk('dasbor: rincian pelajaran 1000, 4 pelajaran, 0 kompetisi', (d->>'solo')::int=1000 and (d->>'sessions')::int=4 and (d->>'competition')::int=0 and (d->>'competitions')::int=0);
  perform pg_temp.chk('dasbor: riwayat 7 hari, hari ini terakhir = 1000', jsonb_array_length(d->'history')=7 and (d->'history'->6->>'earned')::int=1000 and (d->'history'->0->>'earned')::int=0);
  perform pg_temp.chk('dasbor: tanggal & waktu reset', (d->>'date') = to_char((now() at time zone 'Asia/Jakarta')::date,'YYYY-MM-DD') and (d->>'timezone')='Asia/Jakarta'
     and (d->>'resetAt')::timestamptz = study_day_start(now()) + interval '1 day');
end $$;

-- ----------------------------------------------------------- sebagian: sisa jatah dipakai penuh, lalu habis
do $$
declare r jsonb; pid uuid := pg_temp.pid('DBudi'); d jsonb;
begin
  r := pg_temp.lesson('DBudi', 10, 6);
  perform pg_temp.chk('6/10 = 600 (belum kena batas)', (r->>'points')::int=600 and (r->>'rawPoints')::int=600 and not (r->>'capped')::boolean);
  perform pg_temp.chk('sisa jatah 400', study_cap_left(pid)=400);
  r := pg_temp.lesson('DBudi', 10, 10);
  perform pg_temp.chk('10/10 = 1100 mentah, hanya 400 yang masuk', (r->>'points')::int=400 and (r->>'rawPoints')::int=1100 and (r->>'capped')::boolean and study_earned_today(pid)=1000);
  d := study_daily(pid);
  perform pg_temp.chk('dasbor Budi: 1000, tercapai', (d->>'earned')::int=1000 and (d->>'reached')::boolean and (d->>'sessions')::int=2);
  r := pg_temp.lesson('DBudi', 10, 0);
  perform pg_temp.chk('0/10 setelah batas: 0 poin, tidak dianggap dibatasi (mentah 0)', (r->>'points')::int=0 and (r->>'rawPoints')::int=0 and not (r->>'capped')::boolean);
end $$;

-- ----------------------------------------------------------- hari kemarin tidak dihitung; batas hari tepat pukul 00.00
do $$
declare pid uuid := pg_temp.pid('DCitra'); r jsonb; d jsonb;
begin
  insert into study_ledger(player_id,kind,points,note,created_at) values (pid,'session',1000,'kemarin', study_day_start(now()) - interval '1 second');
  perform pg_temp.chk('poin pukul 23.59.59 kemarin tidak dihitung hari ini', study_earned_today(pid)=0 and study_cap_left(pid)=1000);
  insert into study_ledger(player_id,kind,points,note,created_at) values (pid,'session',100,'tepat 00.00', study_day_start(now()));
  perform pg_temp.chk('poin tepat pukul 00.00 dihitung hari ini', study_earned_today(pid)=100 and study_cap_left(pid)=900);
  r := pg_temp.lesson('DCitra', 10, 10);
  perform pg_temp.chk('jatah hari ini 900 -> 1100 mentah menjadi 900', (r->>'points')::int=900 and (r->>'capped')::boolean);
  d := study_daily(pid);
  perform pg_temp.chk('riwayat: kemarin 1000, hari ini 1000', (d->'history'->5->>'earned')::int=1000 and (d->'history'->6->>'earned')::int=1000);
  perform pg_temp.chk('earned_today pada waktu kemarin = 1000', study_earned_today(pid, study_day_start(now()) - interval '1 hour')=1000);
end $$;

-- ----------------------------------------------------------- kompetisi: poin dasar dulu, lalu bonus pemenang; peringkat tidak berubah
do $$
declare rid uuid; r jsonb; a uuid := pg_temp.pid('DDewi'); b uuid := pg_temp.pid('DEka'); c uuid := pg_temp.pid('DFani'); e uuid := pg_temp.pid('DGita'); wb int;
begin
  -- Dewi sudah 950 hari ini, Eka 0 -> Dewi menang 4/4 (440 + bonus) tetapi hanya 50 poin masuk
  insert into study_ledger(player_id,kind,points,note) values (a,'session',950,'sebelumnya');
  rid := study_room_create(a, pg_temp.meta(), pg_temp.qs(4));
  perform study_room_join(rid, b);
  perform study_room_start(rid, a);
  perform study_room_submit(rid, a, '[0,1,2,3]');
  r := study_room_submit(rid, b, '[0,1,0,0]');
  select win_bonus into wb from study_rooms where id = rid;
  perform pg_temp.chk('Dewi tetap juara 1 meski jatah hampir habis', (select winner_id=a from study_rooms where id=rid) and (select rank from study_room_players where room_id=rid and player_id=a)=1);
  perform pg_temp.chk('Dewi: poin dasar 440 mentah -> 50, bonus semua terpotong', (select points_raw=440 and points_awarded=50 and bonus_raw=wb and bonus_points=0 from study_room_players where room_id=rid and player_id=a));
  perform pg_temp.chk('Dewi total hari ini 1000 (950 + 50)', study_earned_today(a)=1000);
  perform pg_temp.chk('Eka 2/4 = 200 penuh (jatah 1000)', (select points_raw=200 and points_awarded=200 and bonus_points=0 from study_room_players where room_id=rid and player_id=b) and study_earned_today(b)=200);
  perform study_room_finalize(rid);
  perform pg_temp.chk('tutup ulang tidak menggandakan', study_earned_today(a)=1000 and study_earned_today(b)=200);

  -- Fani 555 hari ini: sisa 445 -> dasar 440 penuh, bonus tinggal 5 (jika bonus >= 5)
  insert into study_ledger(player_id,kind,points,note) values (c,'session',555,'sebelumnya');
  rid := study_room_create(c, pg_temp.meta(), pg_temp.qs(4));
  perform study_room_join(rid, e);
  perform study_room_start(rid, c);
  perform study_room_submit(rid, c, '[0,1,2,3]');
  perform study_room_submit(rid, e, '[1,0,1,0]');
  perform pg_temp.chk('Fani: dasar 440 penuh, bonus hanya sisa jatah (445-440=5)', (select points_awarded=440 and bonus_points=least(wb,5) and bonus_raw=wb from study_room_players where room_id=rid and player_id=c)
     and study_earned_today(c)=555+440+least(wb,5));
  perform pg_temp.chk('Gita 0 benar: 0 poin, tidak ada baris buku besar', (select points_awarded=0 and points_raw=0 from study_room_players where room_id=rid and player_id=e)
     and (select count(*) from study_ledger where player_id=e)=0);
end $$;

-- ----------------------------------------------------------- tanpa batas (0) & papan "hari ini"
do $$
declare r jsonb; pid uuid := pg_temp.pid('DHadi'); d jsonb;
begin
  update study_settings set daily_points_cap = 0 where id = 1;
  perform pg_temp.chk('batas 0 = tanpa batas: sisa sangat besar', study_cap_left(pid)=2147483647);
  r := pg_temp.lesson('DHadi', 10, 10);
  perform pg_temp.chk('tanpa batas: 1100 penuh, tidak dibatasi', (r->>'points')::int=1100 and not (r->>'capped')::boolean);
  d := study_daily(pid);
  perform pg_temp.chk('dasbor tanpa batas: cap 0, sisa null, tidak tercapai', (d->>'cap')::int=0 and d->'remaining'='null'::jsonb and not (d->>'reached')::boolean and (d->>'earned')::int=1100);
  update study_settings set daily_points_cap = 1000 where id = 1;
  perform pg_temp.chk('batas dikembalikan 1000: Hadi (1100) sisa 0', study_cap_left(pid)=0);
  r := pg_temp.lesson('DHadi', 10, 10);
  perform pg_temp.chk('setelah batas kembali, pelajaran baru 0 poin', (r->>'points')::int=0 and (r->>'capped')::boolean);
end $$;

select pg_temp.chk('study_today_points: semua pemain yang punya poin hari ini',
  (select earned from study_today_points() where player_id=pg_temp.pid('DAli'))=1000
  and (select earned from study_today_points() where player_id=pg_temp.pid('DBudi'))=1000
  and (select earned from study_today_points() where player_id=pg_temp.pid('DEka'))=200
  and (select count(*) from study_today_points() where player_id=pg_temp.pid('DGita'))=0);
select pg_temp.chk('papan hari ini mengabaikan redeem & hukuman (Ali tetap 1000 walau saldo turun)',
  (select earned from study_today_points() where player_id=pg_temp.pid('DAli'))=1000 and study_balance(pg_temp.pid('DAli')) = 3700);
select pg_temp.chk('fungsi bantu hanya untuk service_role', not has_function_privilege('anon','public.study_daily(uuid)','execute')
  and not has_function_privilege('authenticated','public.study_today_points()','execute')
  and has_function_privilege('service_role','public.study_cap_left(uuid)','execute'));

select name, case when ok then 'ok' else 'GAGAL' end from res where not ok;
select count(*) filter (where ok) as lulus, count(*) filter (where not ok) as gagal from res;
