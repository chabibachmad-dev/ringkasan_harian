-- ================================================================
-- Dukungan "obrolan bebas" (tombol + ala WhatsApp) -- chat yang TIDAK
-- terikat ke ringkasan berita tanggal tertentu, bisa dimulai kapan saja.
--
-- chat_messages.chat_date sebelumnya kolom `date` asli (harus format
-- kalender YYYY-MM-DD). Diubah jadi `text` supaya bisa juga menyimpan ID
-- obrolan bebas seperti "freeform-<uuid>", selain tanggal kalender biasa
-- untuk diskusi ringkasan harian. Data lama otomatis tetap aman (cuma
-- berubah tipe kolom, isinya sama).
--
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau via
-- `npx supabase db push`.
-- ================================================================

alter table public.chat_messages
  alter column chat_date type text using chat_date::text;

comment on column public.chat_messages.chat_date is
  'ID thread obrolan: tanggal kalender (YYYY-MM-DD) untuk diskusi ringkasan harian, atau "freeform-<uuid>" untuk obrolan bebas yang dimulai lewat tombol "+".';
