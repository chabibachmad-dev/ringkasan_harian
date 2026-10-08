-- ================================================================
-- Gemini membaca Dokumen Pengetahuan lewat indeks di LAPTOP.
--
-- Salinan teks dokumen di Supabase terpotong (KB_SYNC_MAX_CHARS) dan dicari dengan
-- pencari sederhana, sedangkan indeks di laptop (SQLite FTS5 + pencarian imbuhan) memuat
-- seluruh teks. Edge Function di cloud tidak bisa menjangkau laptop, jadi dipakai pola
-- ANTREAN yang sama seperti agent_jobs:
--   Edge Function `chat` -> insert baris 'pending' (pertanyaan + anggaran) ->
--   bot di laptop mengambilnya, mencari di indeks lokal, menulis potongan hasilnya ke
--   kolom `chunks` + status 'done' -> Edge Function membaca hasilnya (menunggu ≤ ±25 dtk)
--   dan hanya mengirim POTONGAN itu ke Gemini. Bila laptop mati / tidak menjawab, Edge
--   Function jatuh ke pencarian lama di salinan cloud.
--
-- Dikunci total dari anon key (RLS aktif tanpa policy): hanya service role (Edge Function & bot).
-- Jalankan di Supabase Dashboard > SQL Editor (Run), atau `npx supabase db push`.
-- ================================================================

create table if not exists public.kb_retrievals (
  id uuid primary key default gen_random_uuid(),
  chat_date text,                                -- ID obrolan (informasi saja)
  question text not null,                        -- kueri pencarian (dari beberapa pesan terakhir)
  budget_chars integer not null default 12000,
  max_chunks integer not null default 10,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  chunks jsonb,                                  -- [{ title, page, text, score }]
  stats jsonb,                                   -- { docs, chunks, ms }
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists kb_retrievals_status_idx on public.kb_retrievals (status, created_at);

alter table public.kb_retrievals enable row level security;

comment on table public.kb_retrievals is 'Antrean pencarian potongan Dokumen Pengetahuan di indeks laptop untuk jalur Gemini -- diisi Edge Function chat, dikerjakan bot wa-bot.';

-- Baris lama dibersihkan oleh Edge Function & bot (> 1 hari); tidak perlu cron.
