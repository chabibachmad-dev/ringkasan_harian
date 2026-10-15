-- ================================================================
-- 0039: nomor WhatsApp kedua -- kolom `account` di whatsapp_messages
--
-- Bot Baileys kini bisa memegang dua nomor WhatsApp. Tiap baris riwayat ditandai nomor mana yang menanganinya:
--   'main' = nomor utama (bawaan, semua baris lama), 'wa2' = nomor kedua.
-- Dipakai bot untuk (a) mengirim balasan dari aplikasi lewat nomor yang benar dan (b) memisahkan percakapan nomor kedua
-- dari ringkasan harian pemilik.
--
-- Aman dijalankan berulang. Jalankan SEBELUM mengaktifkan nomor kedua (WA2_NUMBER di .env):
-- Supabase Dashboard > SQL Editor > Run.
-- ================================================================

alter table public.whatsapp_messages
  add column if not exists account text not null default 'main';

create index if not exists whatsapp_messages_account_idx
  on public.whatsapp_messages (account, wa_jid, created_at);

comment on column public.whatsapp_messages.account is 'Nomor WhatsApp bot yang menangani percakapan: main (utama) atau wa2 (nomor kedua).';
