-- ================================================================
-- Toggle per-obrolan: "pakai Dokumen Pengetahuan atau tidak".
--
-- SEBELUM ini, SELURUH isi "Dokumen Pengetahuan" (PDF peraturan dll, sampai
-- 600.000 karakter / ±150 ribu token) otomatis disisipkan ke prompt Gemini
-- di SETIAP pesan, di SEMUA obrolan -- bahkan obrolan yang tidak ada
-- hubungannya sama dokumen sama sekali. Ini penyebab utama token/biaya
-- membengkak drastis (lihat diskusi token 1 juta+/hari).
--
-- Sekarang defaultnya OFF (opt-in) -- obrolan baru TIDAK menyertakan Dokumen
-- Pengetahuan kecuali pengguna aktifkan manual lewat menu titik-3 > "Pakai
-- Dokumen Pengetahuan". Lihat juga chat_thread_meta.pinned/title di
-- migrations/0006 -- kolom ini ditambahkan ke tabel yang sama.
--
-- Jalankan file ini di Supabase Dashboard > SQL Editor (Run), atau via
-- `npx supabase db push`.
-- ================================================================

alter table public.chat_thread_meta
  add column if not exists use_kb boolean not null default false;

comment on column public.chat_thread_meta.use_kb is 'Apakah obrolan ini menyertakan isi "Dokumen Pengetahuan" sbg konteks ke Gemini. Default false (opt-in) -- sebelumnya semua obrolan otomatis menyertakan SEMUA dokumen di tiap pesan, yang jadi penyebab utama token/biaya membengkak.';
