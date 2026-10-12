-- ================================================================
-- Perkiraan jumlah token Gemini yang terpakai PER HARI (zona waktu
-- Pasifik/Los Angeles, sama seperti jadwal reset kuota gratis Gemini API --
-- lihat Edge Function `chat`, action "send" & "token_usage") -- dipakai
-- cuma buat ditampilkan ke pengguna di footer layar daftar, supaya
-- kelihatan kira-kira sudah sedekat apa ke limit harian sebelum kena error
-- 429 waktu chat. BUKAN sumber kebenaran billing -- cuma estimasi.
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau via
-- `npx supabase db push`.
-- ================================================================

create table if not exists public.token_usage (
  usage_date date primary key,
  total_tokens bigint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.token_usage is 'Akumulasi token Gemini terpakai per hari (zona waktu Pasifik) -- estimasi saja, ditampilkan di footer aplikasi.';

-- ================================================================
-- Row Level Security -- sama seperti chat_messages: dikunci total dari
-- anon key, semua baca/tulis lewat Edge Function `chat` (service_role).
-- Action "token_usage" sengaja TIDAK mewajibkan kode akses di level Edge
-- Function (lihat index.ts) karena isinya cuma angka, bukan isi chat
-- pribadi -- tapi tabelnya sendiri tetap dikunci RLS seperti biasa, akses
-- cuma lewat service_role.
-- ================================================================

alter table public.token_usage enable row level security;

-- Sengaja TIDAK ada policy apa pun untuk anon/authenticated -- RLS aktif +
-- nol policy = akses langsung dari browser ditolak total.
