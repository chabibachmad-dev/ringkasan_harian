-- ================================================================
-- Menu "Study": EXTRA POIN dari orang tua.
--
-- Orang tua (menu Setting, PIN orang tua) memberi poin tambahan dengan NAMA bebas ("Rajin salat Subuh", "Bantu cuci piring")
-- kepada satu atau beberapa pemain sekaligus. Ciri-cirinya:
--   - Dicatat di buku besar poin dengan jenis baru 'bonus' (note = nama extra poin, meta = { by:'parent', batch }).
--   - TIDAK dihitung ke batas poin harian (study_earned_today hanya menjumlah 'session', 'competition', 'competition_bonus'),
--     jadi tetap masuk walau jatah 1000 poin hari itu sudah habis, dan tidak mengurangi jatah belajar anak.
--   - Masuk saldo (study_balance menjumlah semua jenis), jadi bisa ditukar hadiah. Papan peringkat TIDAK berubah
--     (peringkat tetap berdasar hasil belajar).
--   - Satu panggilan = satu "batch": semua pemain terpilih mendapat jumlah yang sama atau tidak sama sekali (atomik).
--
-- Fungsi: study_give_bonus(pemain[], poin, nama) -> { given, points, name, batch }
--         study_bonus_today(pemain) -> poin extra yang diterima hari ini (untuk kartu harian)
-- Hanya service_role (Edge Function `study`) yang boleh memanggil.
-- Aman dijalankan ulang. Butuh migrasi 0023, 0028, 0032.
-- ================================================================

do $$
begin
  alter table public.study_ledger drop constraint if exists study_ledger_kind_check;
  alter table public.study_ledger add constraint study_ledger_kind_check
    check (kind in ('session', 'redeem', 'penalty', 'competition', 'competition_bonus', 'bonus'));
end $$;

create index if not exists study_ledger_bonus_idx on public.study_ledger (created_at desc) where kind = 'bonus';

create or replace function public.study_give_bonus(p_players uuid[], p_points integer, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
  nm text := nullif(btrim(coalesce(p_name, '')), '');
  found_n integer;
  batch uuid := gen_random_uuid();
begin
  if p_points is null or p_points < 1 or p_points > 1000000 then
    raise exception 'POIN_TIDAK_VALID';
  end if;
  if nm is null or char_length(nm) > 80 then
    raise exception 'NAMA_TIDAK_VALID';
  end if;
  select coalesce(array_agg(distinct x), '{}') into ids from unnest(coalesce(p_players, '{}')) as x where x is not null;
  if coalesce(array_length(ids, 1), 0) = 0 or array_length(ids, 1) > 100 then
    raise exception 'PEMAIN_TIDAK_VALID';
  end if;
  select count(*) into found_n from public.study_players where id = any (ids);
  if found_n <> array_length(ids, 1) then
    raise exception 'PEMAIN_TIDAK_ADA';
  end if;

  insert into public.study_ledger (player_id, kind, points, note, meta)
  select pid, 'bonus', p_points, nm, jsonb_build_object('by', 'parent', 'batch', batch)
  from unnest(ids) as pid;

  return jsonb_build_object('given', array_length(ids, 1), 'points', p_points, 'name', nm, 'batch', batch);
end;
$$;

-- Extra poin yang diterima pemain hari ini (zona waktu hari belajar, sama dengan batas harian).
create or replace function public.study_bonus_today(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.points), 0)::integer
  from public.study_ledger l
  where l.player_id = p_player
    and l.kind = 'bonus'
    and l.created_at >= public.study_day_start(now())
    and l.created_at < public.study_day_start(now()) + interval '1 day';
$$;

revoke all on function public.study_give_bonus(uuid[], integer, text) from public, anon, authenticated;
revoke all on function public.study_bonus_today(uuid) from public, anon, authenticated;
grant execute on function public.study_give_bonus(uuid[], integer, text) to service_role;
grant execute on function public.study_bonus_today(uuid) to service_role;
