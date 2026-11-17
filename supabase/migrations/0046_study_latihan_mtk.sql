-- ================================================================
-- Menu "Study": POIN LATIHAN MATEMATIKA (modul src/latihan-mtk).
--
-- Soal dibangkitkan dan dinilai DI PERANGKAT, jadi poinnya dilaporkan klien dan TIDAK bisa dipercaya begitu saja.
-- Server membatasinya (fungsi study_mtk_award, dipanggil Edge Function `study` aksi mtk_points):
--   - poin per soal paling banyak 6 (lebih besar dipotong jadi 6; 0 atau kurang diabaikan);
--   - satu pasangan (sesiId, nomor) hanya dicatat SEKALI per pemain (indeks unik + on conflict do nothing).
--     nomor 1..50 = soal; nomor 0 = bonus sesi sempurna (sekali per sesi);
--   - BATAS HARIAN sendiri untuk latihan matematika: study_settings.mtk_daily_cap (bawaan 100 poin per hari,
--     0 = tanpa batas). Hari memakai zona waktu study_settings.day_timezone (study_day_start, migrasi 0032).
--     Tidak memakan jatah 1000 poin harian pelajaran/kompetisi, dan sebaliknya.
-- Dicatat di buku besar poin dengan jenis baru 'latihan_mtk' (note = topik, meta = { sesiId, nomor, topik, kelas, tingkat }):
--   - masuk SALDO (study_balance menjumlah semua jenis) jadi bisa ditukar hadiah;
--   - masuk poin leaderboard "Total" dan "Hari ini" serta statistik profil publik (study_leaderboard,
--     study_today_points, study_player_stats ditulis ulang di bawah dengan bentuk keluaran yang sama);
--   - TIDAK dihitung ke batas harian umum (study_earned_today tidak diubah).
-- Ubah batasnya (opsional):  update public.study_settings set mtk_daily_cap = 150 where id = 1;
--
-- Aman dijalankan ulang. Butuh migrasi 0023, 0028, 0032, 0036. Hanya service_role (Edge Function `study`) yang boleh memanggil.
-- ================================================================

alter table public.study_settings add column if not exists mtk_daily_cap integer not null default 100
  check (mtk_daily_cap between 0 and 100000);

do $$
begin
  alter table public.study_ledger drop constraint if exists study_ledger_kind_check;
  alter table public.study_ledger add constraint study_ledger_kind_check
    check (kind in ('session', 'redeem', 'penalty', 'competition', 'competition_bonus', 'bonus', 'latihan_mtk'));
end $$;

-- Satu (sesiId, nomor) per pemain: pertahanan terakhir terhadap kirim ganda / balapan permintaan.
create unique index if not exists study_ledger_mtk_uniq
  on public.study_ledger (player_id, (meta ->> 'sesiId'), (meta ->> 'nomor'))
  where kind = 'latihan_mtk';

create or replace function public.study_mtk_today(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.points), 0)::integer
  from public.study_ledger l
  where l.player_id = p_player and l.kind = 'latihan_mtk'
    and l.created_at >= public.study_day_start(now())
    and l.created_at < public.study_day_start(now()) + interval '1 day';
$$;

-- Hasil: { awarded, duplicate, capped, today, cap }   (cap null = tanpa batas)
create or replace function public.study_mtk_award(p_player uuid, p_sesi text, p_nomor integer, p_poin integer, p_topik text, p_kelas integer, p_tingkat text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cap integer := coalesce((select s.mtk_daily_cap from public.study_settings s where s.id = 1), 100);
  sesi text := btrim(coalesce(p_sesi, ''));
  pts integer := least(coalesce(p_poin, 0), 6);
  today integer;
  give integer;
  n integer;
begin
  if sesi !~ '^[A-Za-z0-9_-]{4,40}$' or p_nomor is null or p_nomor < 0 or p_nomor > 50 then
    raise exception 'DATA_TIDAK_VALID';
  end if;
  if not exists (select 1 from public.study_players where id = p_player) then
    raise exception 'PEMAIN_TIDAK_ADA';
  end if;
  if pts < 1 then
    return jsonb_build_object('awarded', 0, 'duplicate', false, 'capped', false, 'today', public.study_mtk_today(p_player), 'cap', case when cap <= 0 then null else cap end);
  end if;

  -- serialkan per pemain supaya batas harian tidak bisa dilewati dengan permintaan serentak
  perform pg_advisory_xact_lock(hashtextextended('study_mtk:' || p_player::text, 0));

  if exists (select 1 from public.study_ledger l where l.player_id = p_player and l.kind = 'latihan_mtk' and l.meta ->> 'sesiId' = sesi and l.meta ->> 'nomor' = p_nomor::text) then
    return jsonb_build_object('awarded', 0, 'duplicate', true, 'capped', false, 'today', public.study_mtk_today(p_player), 'cap', case when cap <= 0 then null else cap end);
  end if;

  today := public.study_mtk_today(p_player);
  give := case when cap <= 0 then pts else least(pts, greatest(0, cap - today)) end;

  -- poin 0 karena batas harian tetap dicatat (kunci sesiId+nomor terpakai) supaya tak bisa dicoba ulang besok
  insert into public.study_ledger (player_id, kind, points, note, meta)
  values (p_player, 'latihan_mtk', give, left(coalesce(nullif(btrim(p_topik), ''), 'latihan matematika'), 60),
          jsonb_build_object('sesiId', sesi, 'nomor', p_nomor::text, 'topik', left(coalesce(p_topik, ''), 40), 'kelas', p_kelas, 'tingkat', left(coalesce(p_tingkat, ''), 12), 'diminta', pts))
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('awarded', 0, 'duplicate', true, 'capped', false, 'today', public.study_mtk_today(p_player), 'cap', case when cap <= 0 then null else cap end);
  end if;

  return jsonb_build_object('awarded', give, 'duplicate', false, 'capped', give < pts, 'today', today + give, 'cap', case when cap <= 0 then null else cap end);
end;
$$;

-- ---------------------------------------------------------------- leaderboard: ikut menghitung latihan matematika
create or replace function public.study_leaderboard()
returns table (
  id uuid, name text, grade text, sessions_done integer, total_points integer, balance integer, class_level smallint,
  competitions integer, wins integer
)
language sql
stable
security definer
set search_path = public
as $$
  select t.* from (
    select
      p.id,
      p.name,
      p.grade,
      (select count(*) from public.study_sessions s where s.player_id = p.id and s.status = 'submitted')::integer as sessions_done,
      coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p.id and l.kind in ('session', 'competition', 'competition_bonus', 'latihan_mtk')), 0)::integer as total_points,
      public.study_balance(p.id) as balance,
      p.class_level,
      (select count(*) from public.study_room_players rp join public.study_rooms r on r.id = rp.room_id
         where rp.player_id = p.id and r.status = 'finished')::integer as competitions,
      (select count(*) from public.study_rooms r where r.winner_id = p.id and r.status = 'finished')::integer as wins
    from public.study_players p
  ) t
  order by t.total_points desc, (t.sessions_done + t.competitions) desc, lower(t.name) asc;
$$;

create or replace function public.study_today_points()
returns table (player_id uuid, earned integer)
language sql
stable
security definer
set search_path = public
as $$
  select l.player_id, sum(l.points)::integer
  from public.study_ledger l
  where l.kind in ('session', 'competition', 'competition_bonus', 'latihan_mtk')
    and l.created_at >= public.study_day_start(now())
    and l.created_at < public.study_day_start(now()) + interval '1 day'
  group by l.player_id;
$$;

create or replace function public.study_player_stats(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rank', (select x.rn from (
      select b.id, row_number() over (order by b.total_points desc, (b.sessions_done + b.competitions) desc, lower(b.name) asc) as rn
      from public.study_leaderboard() b
    ) x where x.id = p_player),
    'totalPoints', coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p_player and l.kind in ('session', 'competition', 'competition_bonus', 'latihan_mtk')), 0),
    'soloPoints', coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p_player and l.kind in ('session', 'latihan_mtk')), 0),
    'competitionPoints', coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p_player and l.kind in ('competition', 'competition_bonus')), 0),
    'lessons', (select count(*) from public.study_sessions s where s.player_id = p_player and s.status = 'submitted'),
    'competitions', (select count(*) from public.study_room_players rp join public.study_rooms r on r.id = rp.room_id where rp.player_id = p_player and r.status = 'finished'),
    'wins', (select count(*) from public.study_rooms r where r.winner_id = p_player and r.status = 'finished'),
    'materials', (select count(*) from public.study_materials m where m.creator_id = p_player)
  );
$$;

revoke all on function public.study_mtk_today(uuid) from public, anon, authenticated;
revoke all on function public.study_mtk_award(uuid, text, integer, integer, text, integer, text) from public, anon, authenticated;
grant execute on function public.study_mtk_today(uuid) to service_role;
grant execute on function public.study_mtk_award(uuid, text, integer, integer, text, integer, text) to service_role;
