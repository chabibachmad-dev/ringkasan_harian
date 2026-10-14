-- ================================================================
-- Menu "PDF → MD": antrean konversi PDF peraturan menjadi Markdown terstruktur di LAPTOP.
--
-- Alur:
--   1. Aplikasi minta tiket upload ke Edge Function `chat` (aksi md_upload_url) -> baris status 'uploading'.
--   2. Browser mengirim PDF ke bucket privat `kb-inbox` (jalur md/<id>/source.pdf) lewat URL bertanda tangan.
--   3. Aplikasi memanggil md_upload_done -> status 'queued'.
--   4. Bot di laptop (wa-bot/doc-folder.js) mengunduh PDF, menyimpannya di dokumen/peraturan-pdf/, mengubahnya
--      menjadi .md di dokumen/peraturan-md/, mengindeksnya (khusus Ollama), lalu MENGHAPUS file mentah dari inbox.
--   5. PDF yang ditaruh langsung di folder laptop juga dicatat di sini (source = 'folder') supaya tampil di aplikasi.
--
-- Yang disimpan di Supabase HANYA metadata (nama file, judul, jumlah halaman/pasal, status, catatan mutu).
-- ISI dokumen/.md tidak pernah naik ke Supabase: tinggal di laptop.
--
-- Tanpa policy: hanya service_role (Edge Function & bot) yang boleh akses. Aman dijalankan ulang.
-- ================================================================

create table if not exists public.pdf_md_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'app' check (source in ('app', 'folder')),
  filename text not null,
  title text,
  status text not null default 'uploading' check (status in ('uploading', 'queued', 'processing', 'done', 'error')),
  status_detail text,
  error text,
  storage_path text,
  md_name text,
  page_count integer,
  bab_count integer,
  pasal_count integer,
  table_count integer,
  notes jsonb not null default '[]'::jsonb,
  indexed boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists pdf_md_jobs_status_idx on public.pdf_md_jobs (status, created_at);
create index if not exists pdf_md_jobs_created_idx on public.pdf_md_jobs (created_at desc);

alter table public.pdf_md_jobs enable row level security;

comment on table public.pdf_md_jobs is 'Antrean konversi PDF peraturan -> .md di laptop (wa-bot/doc-folder.js). Hanya metadata; isi dokumen tidak disimpan di sini.';
