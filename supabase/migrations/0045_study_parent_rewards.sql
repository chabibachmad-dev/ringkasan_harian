-- ================================================================
-- Study: HADIAH KUSTOM PER ORANG TUA.
--
-- * study_redeem_items.owner_parent_id : orang tua pemilik hadiah. NULL = hadiah bersama (lama): terlihat semua anak dan
--   bisa dikelola orang tua mana pun. Hadiah milik orang tua hanya terlihat/bisa ditukar anak yang tertaut ke orang tua itu
--   (study_parent_children) dan hanya dikelola pemiliknya. Pemeriksaan ada di Edge Function `study`.
-- * Hadiah yang sudah ada TIDAK diubah (tetap bersama). Riwayat penukaran menyimpan nama + harga, jadi aman bila hadiah dihapus.
-- * Bila orang tua dihapus, hadiah miliknya menjadi bersama (on delete set null).
-- Butuh migrasi 0023 dan 0044. Aman dijalankan ulang. Sebelum migrasi ini dijalankan, fungsi `study` tetap jalan
-- (semua hadiah dianggap bersama; hadiah baru juga bersama).
-- ================================================================

alter table public.study_redeem_items
  add column if not exists owner_parent_id uuid references public.study_parents (id) on delete set null;

create index if not exists study_redeem_items_owner_idx on public.study_redeem_items (owner_parent_id);
