-- ================================================================
-- Toggle auto-reply AI ON/OFF PER KONTAK WA -- sebelumnya auto-reply cuma
-- bisa dimatikan total (WA_AUTO_REPLY_ENABLED di wa-bot/.env, berlaku buat
-- SEMUA kontak sekaligus). Tabel ini nyimpen pengecualian per-nomor, diatur
-- lewat tombol di layar obrolan WA tiap kontak di aplikasi (lihat
-- wa-auto-reply-toggle di index.html/main.js & action "set_auto_reply" di
-- Edge Function `whatsapp`).
--
-- TIDAK ADA baris utk suatu wa_jid = DIANGGAP auto_reply_enabled=true
-- (default ON, sama seperti perilaku sebelum fitur ini ada) -- baris cuma
-- dibuat begitu user PERTAMA KALI matikan/nyalakan toggle-nya secara
-- eksplisit dari aplikasi (lihat query "upsert" di Edge Function & cara
-- wa-bot/index.js membacanya -- default true kalau query tidak nemu baris).
--
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau via
-- `npx supabase db push`.
-- ================================================================

create table if not exists public.whatsapp_contacts (
  wa_jid text primary key,
  auto_reply_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_contacts is 'Pengaturan per-kontak WA (saat ini cuma toggle auto_reply_enabled). Tidak ada baris utk suatu wa_jid = dianggap auto_reply_enabled=true (default ON).';

-- ================================================================
-- Row Level Security -- pola SAMA PERSIS dengan whatsapp_messages (lihat
-- 0011_whatsapp_messages.sql): dikunci total dari anon key, cuma bisa
-- diakses lewat Edge Function `whatsapp` (service_role, verifikasi
-- CHAT_ACCESS_CODE dulu) atau langsung oleh bot (service_role key).
-- ================================================================

alter table public.whatsapp_contacts enable row level security;

-- Sengaja TIDAK ada policy apa pun untuk anon/authenticated di sini --
-- RLS aktif + nol policy = akses langsung dari browser ditolak total.
