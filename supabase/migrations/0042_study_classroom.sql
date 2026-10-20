-- ================================================================
-- Menu "Study": tab "Class" -- PDF yang diunggah dibaca & diringkas AI, disimpan, lalu "guru" pixel-art menjelaskannya
-- dengan suara; pemain boleh bertanya lewat suara/ketikan.
--
-- Teks PDF diekstrak di PERAMBAN (pdf.js); server hanya menerima teksnya. Seperti study_materials: dibuat oleh pemain
-- (PIN/token), DAFTAR & ISI ringkasan bisa dilihat semua pemain, hanya pembuat (atau orang tua) yang boleh menghapus.
-- source_text TIDAK dikirim ke klien (hanya dipakai server sebagai konteks tanya-jawab).
-- RLS aktif tanpa policy (terkunci dari anon key); semua lewat Edge Function `study`.
--
-- Aman dijalankan ulang. Butuh migrasi 0023.
-- ================================================================

create table if not exists public.study_classrooms (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.study_players (id) on delete set null,
  creator_name text not null check (char_length(btrim(creator_name)) between 1 and 30),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  file_name text,
  lang text not null default 'id' check (lang in ('id', 'en')),
  page_count integer check (page_count is null or page_count between 1 and 5000),
  summary text not null check (char_length(summary) between 1 and 20000),
  sections jsonb not null default '[]'::jsonb,
  source_text text not null check (char_length(source_text) between 1 and 60000),
  provider text,
  created_at timestamptz not null default now()
);

create index if not exists study_classrooms_created_idx on public.study_classrooms (created_at desc);

alter table public.study_classrooms enable row level security;
