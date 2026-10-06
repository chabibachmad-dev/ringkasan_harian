-- ================================================================
-- Dokumen Pengetahuan: upload PDF MENTAH (tanpa batas 300 ribu karakter)
-- untuk diproses di laptop (bot).
--
-- Alur baru:
--   1. Aplikasi minta "tiket upload" ke Edge Function `chat` (aksi
--      kb_upload_url) -> baris knowledge_documents status 'uploading'.
--   2. Browser mengirim file ke bucket Storage privat `kb-inbox` lewat URL
--      bertanda tangan (tanpa policy; hanya yang dapat tiket yang bisa upload).
--   3. Aplikasi memanggil kb_upload_done -> status 'queued'.
--   4. Bot di laptop mengambil file itu, mengubahnya jadi teks (pdftotext,
--      OCR hanya untuk halaman tanpa teks), membuat indeks pencarian
--      SQLite FTS5 di laptop, menyalin teks (dibatasi) ke kolom `content`
--      supaya Gemini tetap bisa memakainya, lalu MENGHAPUS file dari inbox.
--
-- Jalankan di Supabase Dashboard > SQL Editor (Run), atau `npx supabase db push`.
-- ================================================================

alter table public.knowledge_documents
  add column if not exists status text not null default 'ready',
  add column if not exists status_detail text,
  add column if not exists error text,
  add column if not exists page_count integer,
  add column if not exists storage_path text,
  -- true kalau salinan teks di kolom `content` (untuk Gemini) dipotong karena
  -- terlalu panjang; indeks di laptop (untuk Ollama) tetap memuat SELURUHNYA.
  add column if not exists truncated boolean not null default false,
  -- true kalau dokumen ini sudah diindeks di laptop.
  add column if not exists on_laptop boolean not null default false,
  add column if not exists ocr_pages integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'knowledge_documents_status_check'
  ) then
    alter table public.knowledge_documents
      add constraint knowledge_documents_status_check
      check (status in ('uploading', 'queued', 'processing', 'ready', 'error'));
  end if;
end $$;

comment on column public.knowledge_documents.status is 'uploading -> queued -> processing -> ready | error. Dokumen lama (diupload dari browser) otomatis ''ready''.';

create index if not exists knowledge_documents_status_idx on public.knowledge_documents (status);

-- Bucket privat "inbox": hanya tempat singgah file mentah. Bot menghapus file
-- setelah dikonversi. Batas 50 MB = batas per-file bawaan paket gratis Supabase.
insert into storage.buckets (id, name, public, file_size_limit)
values ('kb-inbox', 'kb-inbox', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- Sengaja TIDAK ada policy di storage.objects untuk bucket ini: akses langsung
-- dari browser ditolak. Upload hanya lewat URL bertanda tangan yang dibuat
-- Edge Function (service_role) setelah kode akses diverifikasi; bot membaca
-- pakai service_role.
