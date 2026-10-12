-- ================================================================
-- Menu "Study": timeline kegiatan per pemain (seperti media sosial) -- SUKA dan KOMENTAR.
--
-- Klik nama di papan peringkat membuka timeline pemain itu: satu kartu per pelajaran yang sudah
-- dikumpulkan. Pemain lain yang sudah masuk (PIN) bisa menyukai, berkomentar, dan membuka Detil.
-- Aturan yang dijaga di database (bukan hanya di layar):
--   - hanya pelajaran berstatus 'submitted' yang bisa disukai/dikomentari;
--   - pemain tidak bisa menyukai/mengomentari pelajarannya sendiri;
--   - satu pemain paling banyak 1 suka per pelajaran (kunci utama), komentar paling banyak 10 per pemain
--     per pelajaran dan 200 per pelajaran, isi komentar 1-300 karakter.
-- Tabel dikunci total dari anon key (RLS aktif, nol policy); semua lewat Edge Function `study`.
-- Hapus pemain / pelajaran ikut menghapus suka dan komentarnya (on delete cascade).
--
-- Aman dijalankan ulang. Butuh migrasi 0023 lebih dulu.
-- ================================================================

create table if not exists public.study_likes (
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  player_id uuid not null references public.study_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, player_id)
);

create table if not exists public.study_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  player_id uuid not null references public.study_players (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists study_comments_session_idx on public.study_comments (session_id, created_at);
create index if not exists study_sessions_submitted_idx on public.study_sessions (player_id, submitted_at desc) where status = 'submitted';

alter table public.study_likes enable row level security;
alter table public.study_comments enable row level security;

-- Timeline satu pemain (terbaru di atas), dengan jumlah suka/komentar dan apakah p_viewer sudah menyukai.
-- p_before = kursor halaman berikutnya (submitted_at kartu terakhir yang sudah tampil).
create or replace function public.study_timeline(p_owner uuid, p_viewer uuid, p_limit integer default 20, p_before timestamptz default null)
returns table (
  session_id uuid, subject text, topic text, material_grade text, level text, num_questions integer,
  correct_count integer, points_awarded integer, weight_percent integer, submitted_at timestamptz,
  like_count integer, comment_count integer, liked boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id, s.subject, s.topic, s.material_grade, s.level, s.num_questions,
    coalesce(s.correct_count, 0), coalesce(s.points_awarded, 0), coalesce(s.weight_percent, 100), s.submitted_at,
    (select count(*) from public.study_likes l where l.session_id = s.id)::integer,
    (select count(*) from public.study_comments c where c.session_id = s.id)::integer,
    (p_viewer is not null and exists (select 1 from public.study_likes l where l.session_id = s.id and l.player_id = p_viewer))
  from public.study_sessions s
  where s.player_id = p_owner
    and s.status = 'submitted'
    and (p_before is null or s.submitted_at < p_before)
  order by s.submitted_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- Suka / batal suka (satu fungsi, atomik). Mengembalikan { liked, count }.
create or replace function public.study_toggle_like(p_session uuid, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  st text;
  was_deleted integer;
  now_liked boolean;
begin
  select player_id, status into owner, st from public.study_sessions where id = p_session;
  if not found or st <> 'submitted' then
    raise exception 'KEGIATAN_TIDAK_ADA';
  end if;
  if owner = p_player then
    raise exception 'KEGIATAN_SENDIRI';
  end if;
  perform 1 from public.study_players where id = p_player;
  if not found then
    raise exception 'PEMAIN_TIDAK_ADA';
  end if;
  delete from public.study_likes where session_id = p_session and player_id = p_player;
  get diagnostics was_deleted = row_count;
  if was_deleted > 0 then
    now_liked := false;
  else
    insert into public.study_likes (session_id, player_id) values (p_session, p_player) on conflict do nothing;
    now_liked := true;
  end if;
  return jsonb_build_object('liked', now_liked, 'count', (select count(*) from public.study_likes where session_id = p_session));
end;
$$;

-- Tambah komentar. Mengembalikan baris komentar + jumlah komentar sekarang.
create or replace function public.study_add_comment(p_session uuid, p_player uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  st text;
  clean text := btrim(coalesce(p_body, ''));
  c public.study_comments;
begin
  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'KOMENTAR_TIDAK_VALID';
  end if;
  -- kunci baris sesi supaya batas jumlah komentar tidak terlewati oleh permintaan bersamaan
  select player_id, status into owner, st from public.study_sessions where id = p_session for update;
  if not found or st <> 'submitted' then
    raise exception 'KEGIATAN_TIDAK_ADA';
  end if;
  if owner = p_player then
    raise exception 'KEGIATAN_SENDIRI';
  end if;
  perform 1 from public.study_players where id = p_player;
  if not found then
    raise exception 'PEMAIN_TIDAK_ADA';
  end if;
  if (select count(*) from public.study_comments where session_id = p_session and player_id = p_player) >= 10
     or (select count(*) from public.study_comments where session_id = p_session) >= 200 then
    raise exception 'KOMENTAR_PENUH';
  end if;
  insert into public.study_comments (session_id, player_id, body) values (p_session, p_player, clean) returning * into c;
  return jsonb_build_object(
    'id', c.id, 'playerId', c.player_id, 'body', c.body, 'createdAt', c.created_at,
    'count', (select count(*) from public.study_comments where session_id = p_session)
  );
end;
$$;

revoke all on function public.study_timeline(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.study_toggle_like(uuid, uuid) from public, anon, authenticated;
revoke all on function public.study_add_comment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.study_timeline(uuid, uuid, integer, timestamptz) to service_role;
grant execute on function public.study_toggle_like(uuid, uuid) to service_role;
grant execute on function public.study_add_comment(uuid, uuid, text) to service_role;
