-- ============================================================================
-- SiMAB: izinkan bot WhatsApp MEREKAM kegiatan (satu-satunya jalan tulis)
-- Jalankan di SQL Editor project Supabase **SiMAB** (bukan ringkasan_harian).
-- Aman diulang. Jalankan SETELAH simab-bot-readonly.sql.
--
-- Akun bot tetap BACA-SAJA di semua tabel (kebijakan RESTRICTIVE tidak diubah).
-- Penulisan hanya lewat fungsi ini, yang:
--   * hanya bisa dipanggil akun bot (cek email di JWT),
--   * hanya memasukkan SATU baris kegiatan berstatus 'Rekam Data' (tidak bisa
--     mengubah/menghapus apa pun),
--   * memeriksa kode MAK ada di POK satker+tahun itu dan merupakan kode TERPANJANG
--     (tidak punya turunan),
--   * membuat id 10 huruf/angka acak yang dijamin belum dipakai,
--   * menolak baris identik yang baru direkam < 10 menit lalu (cegah dobel kirim).
-- ============================================================================

create or replace function public.bot_rekam_kegiatan(
  p_kantor_id text,
  p_tahun     integer,
  p_mak       text,
  p_uraian    text,
  p_tgl_st    date,
  p_jumlah    numeric,
  p_user      text default 'Bot WhatsApp'
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bot_email constant text := 'bot-wa@simab.local';   -- <-- samakan dengan akun bot
  alfabet   constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  r         record;
  v_id      text;
  v_uraian  text := btrim(regexp_replace(coalesce(p_uraian, ''), '\s+', ' ', 'g'));
  v_jumlah  numeric := round(coalesce(p_jumlah, 0));
  v_user    text := left(coalesce(nullif(btrim(p_user), ''), 'Bot WhatsApp'), 80);
  i         integer;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> bot_email then
    raise exception 'Hanya akun bot yang boleh memakai fungsi ini';
  end if;

  if length(v_uraian) < 3 or length(v_uraian) > 300 then
    raise exception 'Uraian harus 3-300 karakter';
  end if;
  if v_jumlah <= 0 or v_jumlah > 9999999999999 then
    raise exception 'Jumlah tidak valid';
  end if;
  if p_tgl_st is null or p_tgl_st < date '2000-01-01' or p_tgl_st > date '2100-12-31' then
    raise exception 'Tanggal dokumen tidak valid';
  end if;

  -- Kode harus ada di POK satker+tahun itu. kantor_id/tahun diambil dari baris POK
  -- supaya tipe datanya otomatis sama dengan kolom di tabel kegiatan.
  select kantor_id, tahun into r
  from public.pok
  where kantor_id::text = p_kantor_id and tahun::text = p_tahun::text and kode = p_mak
  limit 1;
  if not found then
    raise exception 'Kode % tidak ada di POK satker % tahun %', p_mak, p_kantor_id, p_tahun;
  end if;

  -- Hanya kode terpanjang (tidak punya turunan) yang boleh direkam.
  if exists (
    select 1 from public.pok
    where kantor_id::text = p_kantor_id and tahun::text = p_tahun::text and kode like p_mak || '.%'
  ) then
    raise exception 'Kode % bukan kode terpanjang (masih punya turunan)', p_mak;
  end if;

  if exists (
    select 1 from public.kegiatan
    where kantor_id = r.kantor_id and tahun = r.tahun and mak = p_mak
      and uraian = v_uraian and jumlah = v_jumlah and status = 'Rekam Data'
      and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'Kegiatan yang sama persis baru saja direkam (sama persis, kurang dari 10 menit lalu)';
  end if;

  -- id 10 huruf besar/angka acak, ulangi sampai belum dipakai.
  for attempt in 1..20 loop
    v_id := '';
    for i in 1..10 loop
      v_id := v_id || substr(alfabet, 1 + floor(random() * 36)::int, 1);
    end loop;
    exit when not exists (select 1 from public.kegiatan where id = v_id);
    v_id := null;
  end loop;
  if v_id is null then
    raise exception 'Gagal membuat id unik, coba lagi';
  end if;

  insert into public.kegiatan
    (id, mak, uraian, tgl_st, jumlah, "user", status, tgl_rekam, perbantuan, kantor_id, tahun, created_at, updated_at)
  values
    (v_id, p_mak, v_uraian, p_tgl_st, v_jumlah, v_user, 'Rekam Data',
     (now() at time zone 'Asia/Jakarta')::date, false, r.kantor_id, r.tahun, now(), now());

  return v_id;
end;
$$;

revoke all on function public.bot_rekam_kegiatan(text, integer, text, text, date, numeric, text) from public, anon;
grant execute on function public.bot_rekam_kegiatan(text, integer, text, text, date, numeric, text) to authenticated;

-- ============================ PERIKSA ======================================
-- (a) Fungsi terpasang & berjalan sebagai pemilik (security definer = true).
select proname, prosecdef from pg_proc where proname = 'bot_rekam_kegiatan';

-- (b) UJI (dibatalkan otomatis lewat rollback). Ganti '<KODE MAK TERPANJANG>' dengan
--     satu kode yang ada di tabel pok. Harapan: mengembalikan id 10 karakter, lalu
--     rollback sehingga tidak ada data tersisa.
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     '{"sub":"00000000-0000-0000-0000-000000000000","email":"bot-wa@simab.local","role":"authenticated"}', true);
--   select public.bot_rekam_kegiatan('538065', 2026, '<KODE MAK TERPANJANG>', 'uji coba', date '2026-01-02', 1000, 'uji');
-- rollback;

-- (c) UJI penolakan (akun lain TIDAK boleh): harapan error 'Hanya akun bot ...'.
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     '{"sub":"00000000-0000-0000-0000-000000000001","email":"orang-lain@simab.local","role":"authenticated"}', true);
--   select public.bot_rekam_kegiatan('538065', 2026, 'x', 'uji', date '2026-01-02', 1000, 'uji');
-- rollback;
