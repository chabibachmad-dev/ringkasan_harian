-- ================================================================
-- "Dokumen Pengetahuan" -- PDF peraturan/referensi yang diupload lewat menu
-- Pengaturan > Upload Dokumen, supaya AI bisa jawab dari isi dokumen ini
-- duluan (prioritas di atas pencarian web) buat pertanyaan yang relevan.
-- Cocok dipakai bendahara/petugas keuangan buat nyimpen peraturan yang
-- sering dipakai berulang sebagai rujukan.
--
-- Teks PDF-nya diekstrak DI BROWSER (lihat src/pdfText.js, pakai pdfjs-dist)
-- SEBELUM dikirim ke Edge Function -- kolom `content` di sini isinya teks
-- polos hasil ekstrak itu, BUKAN file PDF mentah, supaya tabel ini ringan
-- dan tidak butuh Supabase Storage sama sekali.
--
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau via
-- `npx supabase db push`.
-- ================================================================

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  char_count integer not null default 0,
  original_filename text,
  uploaded_at timestamptz not null default now()
);

comment on table public.knowledge_documents is 'Dokumen referensi (PDF peraturan dll, teksnya sudah diekstrak di browser) yang diupload pengguna lewat Pengaturan > Upload Dokumen -- disertakan sebagai konteks ke Gemini tiap kali chat supaya AI bisa jawab dari sini duluan sebelum cari di web.';
comment on column public.knowledge_documents.content is 'Teks hasil ekstrak PDF (bukan file PDF mentah). Dibatasi ukurannya di Edge Function waktu upload (lihat action "kb_upload").';

create index if not exists knowledge_documents_uploaded_at_idx on public.knowledge_documents (uploaded_at desc);

-- ================================================================
-- Row Level Security
-- Sama seperti chat_messages/chat_thread_meta: tabel ini dikunci TOTAL dari
-- anon key. Semua baca/tulis wajib lewat Edge Function `chat`, yang jalan
-- pakai service_role (bypass RLS) DAN memverifikasi kode akses (secret
-- CHAT_ACCESS_CODE) sebelum mengizinkan apa pun.
-- ================================================================

alter table public.knowledge_documents enable row level security;

-- Sengaja TIDAK ada policy apa pun untuk anon/authenticated di sini --
-- RLS aktif + nol policy = akses langsung dari browser ditolak total.
