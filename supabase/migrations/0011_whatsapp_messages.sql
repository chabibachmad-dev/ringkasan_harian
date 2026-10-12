-- ================================================================
-- Fitur "WhatsApp di dalam aplikasi": baca & balas chat WhatsApp pribadi
-- langsung dari aplikasi ini, tanpa buka app WhatsApp terpisah.
--
-- ARSITEKTUR (penting buat yang baca kode ini nanti):
--   1. Bot Node.js terpisah (folder wa-bot/, JALAN TERUS-MENERUS di laptop
--      user -- BUKAN Edge Function, karena Supabase Edge Function itu
--      stateless/short-lived, tidak bisa pegang koneksi WhatsApp yang harus
--      nyambung terus) -- pakai library Baileys, login via scan QR code
--      sekali, nyambung ke WhatsApp PRIBADI user (bukan WhatsApp Business
--      API resmi -- user sudah diberi tahu & terima trade-off-nya: nomor
--      WA ini jadi "khusus" buat bot ini, ada risiko kena limit dari
--      WhatsApp kalau dipakai berlebihan, dan sesi putus kalau laptop
--      mati/tidur/internet putus).
--   2. Pesan WA MASUK -> bot langsung INSERT ke tabel ini (direction='in',
--      status='received') pakai service_role key.
--   3. User mau BALAS dari aplikasi -> Edge Function "whatsapp" (action
--      "send") INSERT baris baru (direction='out', status='pending').
--   4. Bot POLLING tabel ini tiap beberapa detik nyari status='pending' ->
--      kirim beneran lewat WhatsApp (Baileys) -> update jadi status='sent'
--      (atau 'failed' + kolom error kalau gagal kirim).
--
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau via
-- `npx supabase db push`.
-- ================================================================

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  -- ID kontak/obrolan WhatsApp, format asli dari Baileys: "<nomor>@s.whatsapp.net"
  -- (chat personal) atau "<id>@g.us" (grup). Dipakai sebagai "thread id",
  -- mirip chat_messages.chat_date di fitur Obrolan AI.
  wa_jid text not null,
  -- Nama kontak/push name dari WhatsApp -- bisa berubah/kosong, cuma buat
  -- tampilan, BUKAN identifier (pakai wa_jid buat itu).
  wa_name text,
  direction text not null check (direction in ('in', 'out')),
  content text not null,
  -- 'received' = pesan masuk (direction='in', langsung final, tidak pernah
  -- berubah lagi). 'pending'/'sent'/'failed' = siklus hidup pesan KELUAR
  -- (direction='out') -- lihat poin 3 & 4 di atas.
  status text not null default 'received' check (status in ('pending', 'sent', 'failed', 'received')),
  -- ID pesan asli dari WhatsApp (dari Baileys) -- buat cegah data dobel
  -- kalau bot sempat restart/reconnect dan terima event yang sama 2x.
  wa_message_id text,
  -- Pesan error dari Baileys kalau status='failed' (mis. nomor tidak
  -- terdaftar WA, atau koneksi bot putus pas giliran kirim).
  error text,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_messages_jid_idx on public.whatsapp_messages (wa_jid, created_at);
create index if not exists whatsapp_messages_pending_idx on public.whatsapp_messages (status) where status = 'pending';
-- Dedup berbasis wa_message_id kalau ada (NULL diizinkan dobel -- pesan
-- keluar yang kita buat sendiri sebelum dikirim belum punya wa_message_id).
create unique index if not exists whatsapp_messages_wa_message_id_idx
  on public.whatsapp_messages (wa_message_id)
  where wa_message_id is not null;

comment on table public.whatsapp_messages is 'Riwayat chat WhatsApp (masuk & keluar) yang disinkronkan oleh bot Baileys (wa-bot/) -- dibaca/ditulis lewat Edge Function "whatsapp" (frontend) dan langsung oleh bot (service_role).';
comment on column public.whatsapp_messages.wa_jid is 'ID obrolan WhatsApp asli dari Baileys, mis. "6281234567890@s.whatsapp.net".';

-- ================================================================
-- Row Level Security
-- Sama seperti chat_messages: tabel ini dikunci TOTAL dari anon key. Semua
-- baca/tulis dari FRONTEND wajib lewat Edge Function `whatsapp` (service_role,
-- bypass RLS, verifikasi CHAT_ACCESS_CODE dulu). Bot Node.js juga pakai
-- service_role key langsung (dia proses tepercaya yang jalan di laptop user
-- sendiri, bukan browser publik).
-- ================================================================

alter table public.whatsapp_messages enable row level security;

-- Sengaja TIDAK ada policy apa pun untuk anon/authenticated di sini --
-- RLS aktif + nol policy = akses langsung dari browser ditolak total.
