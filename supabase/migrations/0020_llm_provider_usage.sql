-- ================================================================
-- Monitoring key penyedia AI cadangan (Groq, OpenRouter) di layar "Status Sistem".
--
-- Memakai ulang tabel gemini_key_usage (migration 0013) dengan kolom baru:
--   provider      -- 'gemini' (bawaan, semua baris lama), 'groq', atau 'openrouter'
--   last_model    -- model terakhir yang berhasil menjawab lewat key ini
--   last_used_at  -- kapan terakhir berhasil dipakai
-- Primary key diperluas dengan provider supaya 4 karakter terakhir dua key dari penyedia
-- berbeda yang kebetulan sama tidak bertabrakan.
--
-- Key asli TIDAK PERNAH disimpan -- hanya 4 karakter terakhir (key_hint).
-- Tanggal (usage_date): zona Pasifik untuk Gemini (seperti sebelumnya), UTC untuk Groq/OpenRouter
-- (jatah harian keduanya reset tengah malam UTC).
--
-- Aman dijalankan ulang. Jalankan di Supabase Dashboard > SQL Editor, atau `npx supabase db push`.
-- ================================================================

alter table public.gemini_key_usage add column if not exists provider text not null default 'gemini';
alter table public.gemini_key_usage add column if not exists last_model text;
alter table public.gemini_key_usage add column if not exists last_used_at timestamptz;

alter table public.gemini_key_usage drop constraint if exists gemini_key_usage_pkey;
alter table public.gemini_key_usage add primary key (usage_date, provider, key_hint, source);

comment on column public.gemini_key_usage.provider is 'gemini | groq | openrouter';

-- Fungsi lama (dipanggil bot & Edge Function untuk Gemini): tanda tangan SAMA, hanya target konflik
-- menyesuaikan primary key baru (provider = 'gemini').
create or replace function public.report_gemini_key_event(
  p_usage_date date,
  p_key_hint text,
  p_source text,
  p_requests_inc integer default 0,
  p_exhausted_until timestamptz default null,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.gemini_key_usage as g (usage_date, provider, key_hint, source, requests, exhausted_until, last_error, updated_at)
  values (p_usage_date, 'gemini', p_key_hint, p_source, greatest(p_requests_inc, 0), p_exhausted_until, p_error, now())
  on conflict (usage_date, provider, key_hint, source) do update set
    requests = g.requests + greatest(p_requests_inc, 0),
    exhausted_until = coalesce(p_exhausted_until, g.exhausted_until),
    last_error = coalesce(p_error, g.last_error),
    updated_at = now();
end;
$$;

revoke all on function public.report_gemini_key_event(date, text, text, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.report_gemini_key_event(date, text, text, integer, timestamptz, text) to service_role;

-- Fungsi baru untuk penyedia cadangan. Saat sukses: requests +1, catat model & waktu, dan hapus masa
-- istirahat (key itu jelas hidup lagi).
create or replace function public.report_llm_key_event(
  p_provider text,
  p_usage_date date,
  p_key_hint text,
  p_source text,
  p_requests_inc integer default 0,
  p_exhausted_until timestamptz default null,
  p_error text default null,
  p_model text default null,
  p_clear_exhausted boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_provider not in ('gemini', 'groq', 'openrouter') then
    raise exception 'provider tidak dikenal: %', p_provider;
  end if;
  insert into public.gemini_key_usage as g
    (usage_date, provider, key_hint, source, requests, exhausted_until, last_error, last_model, last_used_at, updated_at)
  values
    (p_usage_date, p_provider, p_key_hint, p_source, greatest(p_requests_inc, 0), p_exhausted_until, p_error,
     p_model, case when p_requests_inc > 0 then now() else null end, now())
  on conflict (usage_date, provider, key_hint, source) do update set
    requests = g.requests + greatest(p_requests_inc, 0),
    exhausted_until = case when p_clear_exhausted then null else coalesce(p_exhausted_until, g.exhausted_until) end,
    last_error = coalesce(p_error, g.last_error),
    last_model = coalesce(p_model, g.last_model),
    last_used_at = case when p_requests_inc > 0 then now() else g.last_used_at end,
    updated_at = now();
end;
$$;

revoke all on function public.report_llm_key_event(text, date, text, text, integer, timestamptz, text, text, boolean) from public, anon, authenticated;
grant execute on function public.report_llm_key_event(text, date, text, text, integer, timestamptz, text, text, boolean) to service_role;
