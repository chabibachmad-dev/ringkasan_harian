-- ================================================================
-- Perkiraan BIAYA (USD) Gemini API, selain jumlah token yang sudah ada
-- dari migration 0008 -- dipakai buat:
--   1. Menampilkan "(token xxx | $ x,xx)" di samping jam tiap bubble pesan
--      (satu giliran kirim = satu panggilan Gemini, jadi angkanya sama di
--      bubble pengguna & balasan AI untuk giliran yang sama).
--   2. Menambah nominal dollar TOTAL hari ini di footer layar daftar, di
--      samping angka token yang sudah ada.
-- Semua ini CUMA ESTIMASI (dihitung dari harga resmi per-model saat
-- request terjadi -- lihat supabase/functions/_shared/gemini.ts), BUKAN
-- tagihan asli dari Google. Jalankan file ini di Supabase Dashboard > SQL
-- Editor (Run), atau via `npx supabase db push`.
-- ================================================================

alter table public.chat_messages
  add column if not exists tokens_used integer,
  add column if not exists cost_usd numeric(12, 6);

comment on column public.chat_messages.tokens_used is 'Estimasi token Gemini untuk SATU giliran percakapan (prompt + jawaban dari satu panggilan action "send") -- NULL untuk pesan lama sebelum kolom ini ada.';
comment on column public.chat_messages.cost_usd is 'Estimasi biaya (USD) giliran percakapan ini, dihitung dari harga model yang benar-benar dipakai saat itu -- NULL untuk pesan lama.';

alter table public.token_usage
  add column if not exists total_cost_usd numeric(12, 6) not null default 0;

comment on column public.token_usage.total_cost_usd is 'Estimasi total biaya (USD) Gemini API hari itu (zona Pasifik) -- dijumlah dari cost_usd tiap giliran, bukan dihitung ulang dari total_tokens (supaya tetap akurat walau sebagian giliran pakai model fallback yang harganya beda).';
