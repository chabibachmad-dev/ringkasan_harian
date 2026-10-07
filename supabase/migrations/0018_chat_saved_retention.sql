-- ================================================================
-- Hapus otomatis obrolan AI Chat setelah 7 hari, KECUALI yang bertanda "Saved".
--
-- * chat_thread_meta.saved  : tanda "Saved" (diatur dari menu titik-3 tiap chat).
-- * chat_retention_settings : lama simpan (hari) & kapan aturan mulai berlaku.
--     - days (default 7) bisa diubah:  update public.chat_retention_settings set days = 14 where id = 'main';
--     - active_since = saat file ini pertama dijalankan. MASA TENGGANG: obrolan lama
--       baru ikut terhapus bila TIDAK ada aktivitas selama `days` hari DAN sudah lewat
--       `days` hari sejak active_since. Jadi setelah pemasangan, kamu punya 7 hari penuh
--       untuk menandai Saved obrolan lama yang mau dipertahankan.
--     - Mematikan fitur:  update public.chat_retention_settings set days = 3650 where id = 'main';
-- * purge_old_chats()       : menghapus obrolan "freeform-..." yang pesan TERAKHIRNYA lebih
--     tua dari `days` hari dan tidak Saved (beserta lampiran, metadata, dan antrean job-nya).
--     Obrolan yang masih punya job pending/running tidak disentuh.
--
-- Penghapusan dijalankan (a) tiap jam oleh pg_cron bila extension-nya aktif, dan
-- (b) otomatis oleh Edge Function `chat` saat daftar obrolan dibuka (cadangan, tidak butuh cron).
--
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau `npx supabase db push`.
-- Aman dijalankan ulang.
-- ================================================================

alter table public.chat_thread_meta
  add column if not exists saved boolean not null default false;

comment on column public.chat_thread_meta.saved is 'Tanda "Saved": obrolan ini TIDAK ikut dihapus otomatis oleh purge_old_chats().';

create table if not exists public.chat_retention_settings (
  id text primary key default 'main',
  days integer not null default 7 check (days between 1 and 3650),
  active_since timestamptz not null default now()
);

insert into public.chat_retention_settings (id) values ('main') on conflict (id) do nothing;

alter table public.chat_retention_settings enable row level security;
-- Tanpa policy: tertutup dari anon key; dibaca/ditulis hanya lewat Edge Function (service role) & SQL Editor.

comment on table public.chat_retention_settings is 'Lama simpan obrolan AI Chat (hari) dan waktu aturan mulai berlaku (masa tenggang). Satu baris, id=main.';

create or replace function public.purge_old_chats()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer;
  v_since timestamptz;
  v_cut timestamptz;
  v_ids text[];
  v_deleted integer := 0;
begin
  select days, active_since into v_days, v_since from public.chat_retention_settings where id = 'main';
  if v_days is null then
    return 0;
  end if;
  v_cut := now() - make_interval(days => v_days);
  -- Masa tenggang: belum ada yang dihapus sebelum `days` hari sejak aturan dipasang.
  if v_since > v_cut then
    return 0;
  end if;

  select coalesce(array_agg(m.chat_date), '{}') into v_ids
  from (
    select chat_date
    from public.chat_messages
    where chat_date ~ '^freeform-[0-9a-fA-F-]{36}$'
    group by chat_date
    having max(created_at) < v_cut
  ) m
  where not exists (select 1 from public.chat_thread_meta t where t.id = m.chat_date and t.saved)
    and not exists (select 1 from public.agent_jobs j where j.chat_date = m.chat_date and j.status in ('pending', 'running'));

  if array_length(v_ids, 1) is not null then
    delete from public.chat_messages where chat_date = any (v_ids);
    delete from public.chat_attachments where chat_date = any (v_ids);
    delete from public.agent_jobs where chat_date = any (v_ids);
    delete from public.chat_thread_meta where id = any (v_ids) and not saved;
    v_deleted := array_length(v_ids, 1);
  end if;

  -- Metadata yatim (obrolan tanpa pesan sama sekali) yang sudah lama dan tidak Saved.
  delete from public.chat_thread_meta t
  where not t.saved
    and t.updated_at < v_cut
    and not exists (select 1 from public.chat_messages c where c.chat_date = t.id);

  return v_deleted;
end;
$$;

revoke all on function public.purge_old_chats() from public, anon, authenticated;
grant execute on function public.purge_old_chats() to service_role;

-- Jadwal tiap jam lewat pg_cron (dilewati kalau extension-nya belum aktif --
-- Edge Function tetap menjalankan purge saat daftar obrolan dibuka).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-old-chats') where exists (select 1 from cron.job where jobname = 'purge-old-chats');
    perform cron.schedule('purge-old-chats', '17 * * * *', 'select public.purge_old_chats();');
  else
    raise notice 'pg_cron belum aktif: purge hanya berjalan lewat Edge Function (saat daftar obrolan dibuka).';
  end if;
end
$$;
