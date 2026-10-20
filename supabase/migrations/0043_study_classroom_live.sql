-- ================================================================
-- Menu "Study" > tab "Class": KELAS LIVE (tanpa PDF). Pemain menulis materi yang ingin dijelaskan, AI menyiapkan ringkasan +
-- naskah lisan, lalu guru pixel-art menjelaskannya langsung. Disimpan di tabel yang sama dengan kelas PDF (study_classrooms).
--   kind  : 'pdf' (bawaan, dari PDF) | 'live' (dari permintaan materi)
--   topic : materi yang diminta pemain (hanya untuk kind 'live')
-- Aman dijalankan ulang. Butuh migrasi 0042.
-- ================================================================

alter table public.study_classrooms add column if not exists kind text not null default 'pdf';
alter table public.study_classrooms add column if not exists topic text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'study_classrooms_kind_check') then
    alter table public.study_classrooms add constraint study_classrooms_kind_check check (kind in ('pdf', 'live'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'study_classrooms_topic_check') then
    alter table public.study_classrooms add constraint study_classrooms_topic_check check (topic is null or char_length(btrim(topic)) between 1 and 300);
  end if;
end $$;
