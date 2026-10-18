-- ================================================================
-- 0041: Kantor AI -- umpan kejadian langsung para "karyawan" (bot WhatsApp, studio media, agen lokal Windows)
--
-- Penulis : bot wa-bot (service role, langsung ke tabel) dan Agen Lokal di Windows (lewat Edge Function `office`, kunci OFFICE_PUSH_KEY).
-- Pembaca : aplikasi, HANYA lewat Edge Function `office` (kode akses). Semua tabel dikunci total dari anon key (RLS aktif, tanpa policy).
-- Isinya ringkasan satu baris ("Menyusun balasan", "Membaca berkas"), BUKAN isi pesan atau dokumen. Dibersihkan otomatis (3 hari).
--
-- Aman dijalankan berulang. Jalankan di Supabase Dashboard > SQL Editor > Run, atau /migrasi di Telegram.
-- ================================================================

create table if not exists public.office_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  who text not null check (who in ('ayyubi', 'wongsobot', 'agen', 'video', 'gambar', 'suara')),
  kind text not null check (kind in ('online', 'offline', 'think', 'work', 'progress', 'say', 'wait', 'done', 'error', 'handoff')),
  text text not null default '',
  progress smallint check (progress is null or (progress >= 0 and progress <= 100)),
  to_who text check (to_who is null or to_who in ('ayyubi', 'wongsobot', 'agen', 'video', 'gambar', 'suara')),
  item text,
  approval_id text
);

create index if not exists office_events_created_idx on public.office_events (created_at);

alter table public.office_events enable row level security;
comment on table public.office_events is 'Kantor AI: umpan kejadian karyawan (ringkasan saja). Ditulis bot/agen, dibaca aplikasi lewat Edge Function office.';

-- Denyut: kapan terakhir tiap karyawan terlihat hidup (aplikasi menganggap tidur bila > 90 detik).
create table if not exists public.office_presence (
  who text primary key check (who in ('ayyubi', 'wongsobot', 'agen', 'video', 'gambar', 'suara')),
  seen_at timestamptz not null default now(),
  detail text not null default ''
);

alter table public.office_presence enable row level security;

-- Permintaan izin dari agen yang bisa dijawab dari aplikasi (selain lewat tombol Telegram).
create table if not exists public.office_approvals (
  id text primary key,
  who text not null,
  detail text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);

create index if not exists office_approvals_status_idx on public.office_approvals (status, created_at);

alter table public.office_approvals enable row level security;
comment on table public.office_approvals is 'Kantor AI: izin yang diminta agen lokal; dijawab dari aplikasi (Edge Function office) atau Telegram.';
