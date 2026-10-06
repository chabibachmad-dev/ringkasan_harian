-- ================================================================
-- Pilihan "agen" di chat aplikasi: Gemini (cloud) atau Ollama (model lokal di
-- laptop). Edge Function di cloud TIDAK bisa menjangkau Ollama di laptop, jadi
-- dipakai pola ANTREAN: aplikasi -> Edge Function menaruh baris di agent_jobs
-- (status 'pending') -> bot di laptop (wa-bot) mengambilnya, menjalankan Ollama,
-- menulis balasan ke chat_messages, lalu menandai job 'done'. Tidak ada port
-- yang dibuka ke internet.
--
-- Semua tabel dikunci total dari anon key (RLS aktif, tanpa policy): diakses
-- HANYA lewat Edge Function `chat` (service role + kode akses) dan bot
-- (service role).
--
-- Jalankan di Supabase Dashboard > SQL Editor (Run), atau `npx supabase db push`.
-- ================================================================

-- 1) Antrean permintaan ke agen lokal.
create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  chat_date text not null,                       -- ID obrolan ("freeform-<uuid>")
  agent text not null default 'ollama',
  user_message_id uuid,                          -- baris chat_messages pesan pengguna
  question text not null,                        -- teks pesan pengguna
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  progress text,                                 -- mis. "Membaca bagian 2/6" (ditampilkan di UI)
  assistant_message_id uuid,                     -- baris chat_messages balasan (kalau sukses)
  error text,
  fallback_from text,                            -- 'gemini' kalau job ini cadangan setelah Gemini gagal
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists agent_jobs_status_idx on public.agent_jobs (status, created_at);
create index if not exists agent_jobs_chat_idx on public.agent_jobs (chat_date, created_at desc);

alter table public.agent_jobs enable row level security;

comment on table public.agent_jobs is 'Antrean permintaan chat ke agen lokal (Ollama) -- diisi Edge Function chat, dikerjakan bot wa-bot di laptop.';

-- 2) Denyut (heartbeat) worker -- supaya Edge Function tahu laptop/bot/Ollama
--    sedang hidup atau tidak sebelum menaruh job.
create table if not exists public.agent_worker_status (
  id text primary key,                           -- 'ollama'
  last_seen timestamptz not null default now(),
  ollama_ok boolean not null default false,      -- server Ollama menjawab?
  model text,
  busy boolean not null default false,
  detail text
);

alter table public.agent_worker_status enable row level security;

comment on table public.agent_worker_status is 'Denyut worker agen lokal (id=ollama). Dibaca Edge Function chat, ditulis bot wa-bot tiap ~15 detik.';

-- 3) Agen mana yang menjawab tiap balasan (untuk label di bubble), dan agen
--    pilihan per obrolan (sinkron lintas perangkat seperti pin/judul).
alter table public.chat_messages add column if not exists agent text;
alter table public.chat_thread_meta add column if not exists agent text not null default 'auto'
  check (agent in ('auto', 'gemini', 'ollama'));

comment on column public.chat_messages.agent is 'Agen yang menghasilkan balasan: gemini | ollama. NULL = pesan lama/pengguna.';
comment on column public.chat_thread_meta.agent is 'Agen pilihan obrolan: auto (Gemini, cadangan Ollama) | gemini | ollama.';
