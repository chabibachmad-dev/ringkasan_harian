-- ================================================================
-- Metadata obrolan (status sematan/pin & judul custom hasil "Ubah judul")
-- -- SEBELUMNYA cuma disimpan di localStorage tiap perangkat, jadi kalau
-- di-pin/di-rename dari HP A, tidak muncul sama sekali waktu dibuka dari
-- HP B walau kode aksesnya sama. Tabel ini bikin keduanya ikut disimpan di
-- server supaya sinkron ke semua perangkat (sama seperti isi obrolannya
-- sendiri di chat_messages).
--
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau via
-- `npx supabase db push`.
-- ================================================================

create table if not exists public.chat_thread_meta (
  id text primary key,
  pinned boolean not null default false,
  title text,
  updated_at timestamptz not null default now()
);

comment on table public.chat_thread_meta is 'Status sematan (pin) & judul custom per obrolan (id = chat_messages.chat_date), supaya sinkron lintas perangkat lewat kode akses yang sama.';
comment on column public.chat_thread_meta.id is 'ID obrolan, format "freeform-<uuid>" -- sama seperti chat_messages.chat_date.';
comment on column public.chat_thread_meta.title is 'Judul custom hasil menu "Ubah judul". NULL berarti pakai judul default (belum pernah di-rename, atau di-reset).';

-- ================================================================
-- Row Level Security
-- Sama seperti chat_messages: tabel ini dikunci TOTAL dari anon key. Semua
-- baca/tulis wajib lewat Edge Function `chat`, yang jalan pakai service_role
-- (bypass RLS) DAN memverifikasi kode akses (secret CHAT_ACCESS_CODE)
-- sebelum mengizinkan apa pun.
-- ================================================================

alter table public.chat_thread_meta enable row level security;

-- Sengaja TIDAK ada policy apa pun untuk anon/authenticated di sini --
-- RLS aktif + nol policy = akses langsung dari browser ditolak total.
