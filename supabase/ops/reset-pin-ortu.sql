-- Lupa PIN orang tua (tidak ada PIN master). Jalankan SENDIRI di SQL editor Supabase, ganti nama di bawah.
-- Menghapus baris orang tua itu; tautan ke anak ikut terhapus. Anak-anaknya otomatis mendapat popup
-- "Buat PIN orang tua" di login berikutnya. Log tindakan lama tetap ada (nama orang tua disalin di log).
-- Periksa dulu siapa yang akan terhapus:
--   select p.id, p.name, count(c.player_id) anak from study_parents p left join study_parent_children c on c.parent_id = p.id
--   where lower(btrim(p.name)) = lower(btrim('NAMA ORANG TUA')) group by 1, 2;
delete from public.study_parents where lower(btrim(name)) = lower(btrim('NAMA ORANG TUA'));
