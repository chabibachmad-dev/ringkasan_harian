-- ================================================================
-- Kunci total akses langsung anon ke tabel push_subscriptions.
--
-- Sebelumnya anon dikasih izin insert+update langsung ke tabel ini supaya
-- device bisa subscribe sendiri dari browser. Ternyata cara itu bermasalah:
-- aplikasi pakai UPSERT (ON CONFLICT DO UPDATE), dan menurut dokumentasi
-- Postgres, UPSERT jenis itu SELALU butuh izin SELECT pada tabelnya --
-- walau barisnya baru pertama kali di-insert. Kalau anon dikasih izin
-- SELECT supaya upsert-nya lolos, konsekuensinya semua orang jadi bisa
-- baca endpoint+keys push subscription siapa saja (bisa disalahgunakan
-- buat spam kirim notifikasi ke device orang).
--
-- Solusinya: penyimpanan subscription sekarang lewat Edge Function
-- `subscribe` (jalan pakai service_role, otomatis bypass RLS), jadi anon
-- tidak perlu izin apa pun lagi ke tabel ini secara langsung.
-- ================================================================

drop policy if exists "push_subscriptions_public_insert" on public.push_subscriptions;
drop policy if exists "push_subscriptions_public_update_own" on public.push_subscriptions;

-- RLS tetap aktif dengan NOL policy untuk anon/authenticated = akses
-- langsung dari browser ditolak total (aman), tapi service_role (dipakai
-- Edge Function) tetap bisa baca/tulis seperti biasa karena service_role
-- selalu bypass RLS.
