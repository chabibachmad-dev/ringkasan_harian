-- ================================================================
-- Penjadwalan otomatis: panggil Edge Function `generate-summary`
-- setiap hari jam 20:00 waktu Makassar/WITA (UTC+8) = 12:00 UTC.
--
-- PENTING sebelum menjalankan file ini:
-- 1. Aktifkan extension "pg_cron" dan "pg_net" lewat
--    Supabase Dashboard > Database > Extensions.
-- 2. Ganti '<PROJECT_URL>' dan '<ANON_ATAU_SERVICE_ROLE_KEY>' di bawah,
--    atau (lebih aman) simpan dulu sebagai secret via Vault:
--      select vault.create_secret('https://alkpmwowhlyffdwfvyeu.supabase.co', 'project_url');
--      select vault.create_secret('<SERVICE_ROLE_KEY_KAMU>', 'service_role_key');
--    lalu pakai versi "pakai Vault" di bagian bawah file ini.
-- ================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Hapus jadwal lama kalau sebelumnya pernah dibuat, supaya tidak dobel.
select cron.unschedule('ringkasan-harian-generate')
where exists (select 1 from cron.job where jobname = 'ringkasan-harian-generate');

-- === Versi paling sederhana (isi manual project URL + service_role key) ===
-- Uncomment & lengkapi baris di bawah ini kalau tidak pakai Vault.
--
-- select cron.schedule(
--   'ringkasan-harian-generate',
--   '0 12 * * *', -- 12:00 UTC = 20:00 WITA (UTC+8) sepanjang tahun
--   $$
--   select net.http_post(
--     url := '<PROJECT_URL>/functions/v1/generate-summary',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body := '{}'::jsonb
--   ) as request_id;
--   $$
-- );

-- === Versi pakai Supabase Vault (direkomendasikan, key tidak kelihatan di SQL) ===
select cron.schedule(
  'ringkasan-harian-generate',
  '0 12 * * *', -- 12:00 UTC = 20:00 WITA (UTC+8)
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/generate-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Cek jadwal yang aktif:
-- select * from cron.job;
-- Cek histori eksekusi:
-- select * from cron.job_run_details order by start_time desc limit 20;
