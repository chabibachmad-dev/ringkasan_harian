-- ============================================================================
-- SiMAB: batasi akun bot WhatsApp menjadi BACA-SAJA
-- Jalankan di SQL Editor project Supabase **SiMAB** (bukan project ringkasan_harian).
--
-- LANGKAH:
--  1) Dashboard SiMAB > Authentication > Users > Add user > Create new user:
--       email    : bot-wa@simab.local   (boleh lain, samakan dengan di bawah & di .env)
--       password : sandi panjang acak (simpan di .env: SIMAB_BOT_PASSWORD)
--       centang "Auto Confirm User"
--     Akun ini TIDAK perlu baris di tabel pegawai.
--  2) Jalankan seluruh skrip ini (aman diulang).
--  3) Jalankan blok "PERIKSA" di bagian bawah.
--
-- CARA KERJA: kebijakan RLS bertipe RESTRICTIVE selalu DIGABUNG (AND) dengan
-- kebijakan yang sudah ada. Jadi untuk akun bot: insert/update/delete ditolak di
-- semua tabel, dan tabel pegawai (berisi data bank) tidak bisa dibaca sama sekali.
-- Pengguna aplikasi lain tidak terpengaruh. Skrip ini TIDAK mengaktifkan RLS di
-- tabel mana pun (kalau RLS sebuah tabel mati, kebijakannya tidak berlaku; lihat PERIKSA).
-- ============================================================================

do $$
declare
  bot_email constant text := 'bot-wa@simab.local';   -- <-- samakan dengan akun bot
  t text;
begin
  foreach t in array array[
    'kegiatan','pok','blokir','rpd','rpd_berjalan','mp_pnbp',
    'pegawai','kantor','pejabat','config','notifikasi','sbm'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'Tabel % tidak ada, dilewati', t;
      continue;
    end if;

    execute format('drop policy if exists bot_ro_insert on public.%I', t);
    execute format('drop policy if exists bot_ro_update on public.%I', t);
    execute format('drop policy if exists bot_ro_delete on public.%I', t);

    execute format(
      'create policy bot_ro_insert on public.%I as restrictive for insert to authenticated
         with check (coalesce(auth.jwt() ->> ''email'', '''') <> %L)', t, bot_email);
    execute format(
      'create policy bot_ro_update on public.%I as restrictive for update to authenticated
         using (coalesce(auth.jwt() ->> ''email'', '''') <> %L)
         with check (coalesce(auth.jwt() ->> ''email'', '''') <> %L)', t, bot_email, bot_email);
    execute format(
      'create policy bot_ro_delete on public.%I as restrictive for delete to authenticated
         using (coalesce(auth.jwt() ->> ''email'', '''') <> %L)', t, bot_email);
  end loop;

  -- Data rekening/bank pegawai: bot tidak boleh membaca sama sekali.
  if to_regclass('public.pegawai') is not null then
    execute 'drop policy if exists bot_no_read on public.pegawai';
    execute format(
      'create policy bot_no_read on public.pegawai as restrictive for select to authenticated
         using (coalesce(auth.jwt() ->> ''email'', '''') <> %L)', bot_email);
  end if;
end $$;

-- ============================ PERIKSA ======================================
-- (a) Semua tabel di bawah HARUS rowsecurity = true agar pembatas berlaku.
--     Kalau ada yang false, tabel itu belum dilindungi RLS (di luar cakupan skrip ini).
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('kegiatan','pok','blokir','rpd','rpd_berjalan','mp_pnbp','pegawai','kantor','pejabat','config','notifikasi','sbm')
order by tablename;

-- (b) Kebijakan bot yang terpasang.
select tablename, policyname, cmd, permissive
from pg_policies
where schemaname = 'public' and policyname like 'bot\_%' escape '\'
order by tablename, policyname;

-- (c) UJI (opsional, dibatalkan otomatis lewat rollback): perlakukan sesi ini sebagai akun bot.
--     Harapan: pegawai = 0 baris, dan update kegiatan = "UPDATE 0".
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     '{"sub":"00000000-0000-0000-0000-000000000000","email":"bot-wa@simab.local","role":"authenticated"}', true);
--   select count(*) as pegawai_terbaca from public.pegawai;
--   update public.kegiatan set jumlah = jumlah where id in (select id from public.kegiatan limit 1);
-- rollback;
