-- ================================================================
-- Monitoring key API pencarian web (Tavily, Serper, Brave) di layar "Status Sistem".
--
-- Memakai ulang tabel gemini_key_usage (kolom provider dari migration 0020): hanya fungsi
-- report_llm_key_event yang perlu diperluas agar menerima provider 'tavily', 'serper', 'brave'.
-- Satu baris per hari (UTC) per key; layar Status Sistem menjumlahkannya per bulan karena jatah
-- layanan pencarian dihitung bulanan.
--
-- Key asli TIDAK PERNAH disimpan -- hanya 4 karakter terakhir (key_hint).
-- Aman dijalankan ulang. Butuh migration 0020 lebih dulu.
-- ================================================================

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
  if p_provider not in ('gemini', 'groq', 'openrouter', 'tavily', 'serper', 'brave') then
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

comment on column public.gemini_key_usage.provider is 'gemini | groq | openrouter | tavily | serper | brave';
