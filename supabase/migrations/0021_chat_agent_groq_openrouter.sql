-- ================================================================
-- Agent chat baru di aplikasi: Groq dan OpenRouter (selain Auto / Gemini / Ollama).
--
-- chat_thread_meta.agent (pilihan agent per obrolan) sebelumnya dibatasi check
-- ('auto','gemini','ollama'); sekarang boleh juga 'groq' dan 'openrouter'.
-- chat_messages.agent (agent yang menjawab, tampil di bubble) tidak punya batasan -- tidak diubah.
--
-- Aman dijalankan ulang. Jalankan di Supabase Dashboard > SQL Editor, atau `npx supabase db push`.
-- ================================================================

alter table public.chat_thread_meta drop constraint if exists chat_thread_meta_agent_check;
alter table public.chat_thread_meta
  add constraint chat_thread_meta_agent_check
  check (agent in ('auto', 'gemini', 'groq', 'openrouter', 'ollama'));

comment on column public.chat_thread_meta.agent is 'Agent pilihan obrolan: auto (Gemini, cadangan Groq/OpenRouter/Ollama) | gemini | groq | openrouter | ollama.';
comment on column public.chat_messages.agent is 'Agent yang menghasilkan balasan: gemini | groq | openrouter | ollama. NULL = pesan lama/pengguna.';
