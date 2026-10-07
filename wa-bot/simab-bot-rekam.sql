-- ============================================================================
-- SiMAB: izinkan bot WhatsApp MEREKAM, MENGUBAH, dan MENGHAPUS kegiatan hasil rekamnya
-- Jalankan di SQL Editor project Supabase **SiMAB** (bukan ringkasan_harian).
-- Aman diulang. Jalankan SETELAH simab-bot-readonly.sql.
--
-- Akun bot tetap BACA-SAJA di semua tabel (kebijakan RESTRICTIVE tidak diubah).
-- Penulisan hanya lewat 3 fungsi di bawah (bot_rekam_kegiatan, bot_ubah_kegiatan,
-- bot_hapus_kegiatan) + 1 fungsi baca (bot_daftar_rekam). Tabel bot_rekam_log mencatat
-- id kegiatan yang DIBUAT BOT; ubah/hapus hanya berlaku untuk id di log itu dan hanya
-- selama statusnya masih 'Rekam Data' (kalau sudah diproses di aplikasi, bot menolak).
-- Salinan data sebelum diubah/dihapus disimpan di bot_rekam_log.snapshot (pemulihan manual).
--
-- bot_rekam_kegiatan:
--   * hanya bisa dipanggil akun bot (cek email di JWT),
--   * hanya memasukkan SATU baris kegiatan berstatus 'Rekam Data' (tidak bisa
--     mengubah/menghapus apa pun),
--   * memeriksa kode MAK ada di POK satker+tahun itu dan merupakan kode TERPANJANG
--     (tidak punya turunan),
--   * membuat id 10 huruf/angka acak yang dijamin belum dipakai,
--   * menolak baris identik yang baru direkam < 10 menit lalu (cegah dobel kirim).
-- ============================================================================

-- Log id kegiatan buatan bot. RLS aktif TANPA kebijakan + hak dicabut = hanya fungsi
-- di bawah (security definer) yang bisa menyentuhnya.
create table if not exists public.bot_rekam_log (
  id             text primary key,
  kantor_id      text not null,
  tahun          integer not null,
  created_at     timestamptz not null default now(),
  last_action    text,
  last_action_at timestamptz,
  snapshot       jsonb,       -- isi baris SEBELUM perubahan/penghapusan terakhir
  deleted_at     timestamptz
);
alter table public.bot_rekam_log enable row level security;
revoke all on public.bot_rekam_log from public, anon, authenticated;

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

  insert into public.bot_rekam_log (id, kantor_id, tahun) values (v_id, p_kantor_id, p_tahun);

  return v_id;
end;
$$;

revoke all on function public.bot_rekam_kegiatan(text, integer, text, text, date, numeric, text) from public, anon;
grant execute on function public.bot_rekam_kegiatan(text, integer, text, text, date, numeric, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Daftar kegiatan buatan bot yang MASIH 'Rekam Data' (terbaru dulu, maks 20).
-- p_id diisi -> hanya id itu (tahun diabaikan).
-- ---------------------------------------------------------------------------
create or replace function public.bot_daftar_rekam(
  p_kantor_id text,
  p_tahun     integer default null,
  p_id        text default null,
  p_limit     integer default 10
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bot_email constant text := 'bot-wa@simab.local';   -- <-- samakan dengan akun bot
  v jsonb;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> bot_email then
    raise exception 'Hanya akun bot yang boleh memakai fungsi ini';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v
  from (
    select k.id::text as id, k.mak::text as mak, k.uraian::text as uraian, k.tgl_st::text as tgl_st,
           k.jumlah::numeric as jumlah, k.status::text as status, l.created_at as created_at
    from public.bot_rekam_log l
    join public.kegiatan k on k.id = l.id
    where l.deleted_at is null
      and l.kantor_id = p_kantor_id
      and (p_id is not null or p_tahun is null or l.tahun = p_tahun)
      and (p_id is null or l.id = p_id)
      and k.status = 'Rekam Data'
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit, 10), 1), 20)
  ) x;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ubah uraian / tanggal dokumen / jumlah (yang NULL tidak diubah). MAK tidak bisa diubah.
-- ---------------------------------------------------------------------------
create or replace function public.bot_ubah_kegiatan(
  p_kantor_id text,
  p_id        text,
  p_uraian    text default null,
  p_tgl_st    date default null,
  p_jumlah    numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bot_email constant text := 'bot-wa@simab.local';   -- <-- samakan dengan akun bot
  k         record;
  v_uraian  text := case when p_uraian is null then null else btrim(regexp_replace(p_uraian, '\s+', ' ', 'g')) end;
  v_jumlah  numeric := case when p_jumlah is null then null else round(p_jumlah) end;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> bot_email then
    raise exception 'Hanya akun bot yang boleh memakai fungsi ini';
  end if;
  if v_uraian is null and p_tgl_st is null and v_jumlah is null then
    raise exception 'Tidak ada perubahan yang dikirim';
  end if;
  if v_uraian is not null and (length(v_uraian) < 3 or length(v_uraian) > 300) then
    raise exception 'Uraian harus 3-300 karakter';
  end if;
  if v_jumlah is not null and (v_jumlah <= 0 or v_jumlah > 9999999999999) then
    raise exception 'Jumlah tidak valid';
  end if;
  if p_tgl_st is not null and (p_tgl_st < date '2000-01-01' or p_tgl_st > date '2100-12-31') then
    raise exception 'Tanggal dokumen tidak valid';
  end if;

  perform 1 from public.bot_rekam_log
   where id = p_id and kantor_id = p_kantor_id and deleted_at is null for update;
  if not found then
    raise exception 'Kegiatan % tidak ditemukan di daftar rekam bot', p_id;
  end if;

  select * into k from public.kegiatan where id = p_id for update;
  if not found then
    raise exception 'Kegiatan % tidak ditemukan', p_id;
  end if;
  if k.status is distinct from 'Rekam Data' then
    raise exception 'Kegiatan % sudah diproses (status %), ubah lewat aplikasi SiMAB', p_id, k.status;
  end if;

  update public.bot_rekam_log
     set snapshot = to_jsonb(k), last_action = 'ubah', last_action_at = now()
   where id = p_id;

  if v_uraian is not null then update public.kegiatan set uraian = v_uraian where id = p_id; end if;
  if p_tgl_st is not null then update public.kegiatan set tgl_st = p_tgl_st where id = p_id; end if;
  if v_jumlah is not null then update public.kegiatan set jumlah = v_jumlah where id = p_id; end if;
  update public.kegiatan set updated_at = now() where id = p_id;

  return jsonb_build_object('id', p_id, 'ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hapus satu kegiatan buatan bot (salinannya disimpan di bot_rekam_log.snapshot).
-- ---------------------------------------------------------------------------
create or replace function public.bot_hapus_kegiatan(
  p_kantor_id text,
  p_id        text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bot_email constant text := 'bot-wa@simab.local';   -- <-- samakan dengan akun bot
  k record;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> bot_email then
    raise exception 'Hanya akun bot yang boleh memakai fungsi ini';
  end if;

  perform 1 from public.bot_rekam_log
   where id = p_id and kantor_id = p_kantor_id and deleted_at is null for update;
  if not found then
    raise exception 'Kegiatan % tidak ditemukan di daftar rekam bot', p_id;
  end if;

  select * into k from public.kegiatan where id = p_id for update;
  if not found then
    raise exception 'Kegiatan % tidak ditemukan', p_id;
  end if;
  if k.status is distinct from 'Rekam Data' then
    raise exception 'Kegiatan % sudah diproses (status %), hapus lewat aplikasi SiMAB', p_id, k.status;
  end if;

  update public.bot_rekam_log
     set snapshot = to_jsonb(k), last_action = 'hapus', last_action_at = now(), deleted_at = now()
   where id = p_id;
  delete from public.kegiatan where id = p_id;

  return jsonb_build_object('id', p_id, 'ok', true);
end;
$$;

revoke all on function public.bot_daftar_rekam(text, integer, text, integer) from public, anon;
revoke all on function public.bot_ubah_kegiatan(text, text, text, date, numeric) from public, anon;
revoke all on function public.bot_hapus_kegiatan(text, text) from public, anon;
grant execute on function public.bot_daftar_rekam(text, integer, text, integer) to authenticated;
grant execute on function public.bot_ubah_kegiatan(text, text, text, date, numeric) to authenticated;
grant execute on function public.bot_hapus_kegiatan(text, text) to authenticated;

-- (Opsional) daftarkan kegiatan yang sudah terlanjur direkam bot SEBELUM skrip ini dipasang
-- supaya bisa diubah/dihapus lewat WhatsApp. Ganti id-nya:
-- insert into public.bot_rekam_log (id, kantor_id, tahun)
-- select id, kantor_id::text, tahun::integer from public.kegiatan
-- where id in ('ID1234ABCD') and status = 'Rekam Data'
-- on conflict (id) do nothing;

-- ============================ PERIKSA ======================================
-- (a) Fungsi terpasang & berjalan sebagai pemilik (security definer = true).
select proname, prosecdef from pg_proc where proname in ('bot_rekam_kegiatan','bot_daftar_rekam','bot_ubah_kegiatan','bot_hapus_kegiatan') order by 1;

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
