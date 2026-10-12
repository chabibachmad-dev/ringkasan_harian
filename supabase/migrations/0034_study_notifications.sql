-- ================================================================
-- Menu "Study": NOTIFIKASI suka & komentar (tombol lonceng).
--
-- Pemain diberi tahu bila pemain LAIN menyukai atau mengomentari kegiatannya:
--   - pelajaran/latihan miliknya (study_sessions),
--   - materi buatannya (study_materials),
--   - kompetisi yang ia ikuti (study_room_players) — suka/komentar peserta lain maupun penonton.
-- Suka/komentar milik sendiri tidak dihitung. Tidak ada tabel notifikasi baru: daftar dibaca langsung dari study_likes dan
-- study_comments, sehingga suka yang dibatalkan atau komentar yang dihapus otomatis hilang dari daftar.
-- "Belum dibaca" = lebih baru dari study_players.notif_seen_at (pemain yang sudah ada dianggap sudah membaca semuanya
-- saat migrasi ini dijalankan; pemain baru mulai dari saat didaftarkan).
--
-- Fungsi: study_notifications(player, limit) -> daftar terbaru; study_notif_count(player) -> jumlah belum dibaca (maks 100);
-- study_notif_seen(player, upto) -> tandai sudah dibaca sampai waktu upto (bawaan sekarang).
-- Aman dijalankan ulang. Butuh migrasi 0023, 0024, 0025, 0028.
-- ================================================================

alter table public.study_players add column if not exists notif_seen_at timestamptz not null default now();

create or replace function public.study_notifications(p_player uuid, p_limit integer default 50)
returns table (type text, kind text, target_id uuid, title text, actor_id uuid, actor_name text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.type, n.kind, n.target_id, n.title, n.actor_id, n.actor_name, n.body, n.created_at
  from (
    select 'like'::text as type, 'lesson'::text as kind, s.id as target_id, s.subject as title, l.player_id as actor_id, a.name as actor_name, null::text as body, l.created_at
      from public.study_likes l
      join public.study_sessions s on s.id = l.session_id
      join public.study_players a on a.id = l.player_id
      where s.player_id = p_player and l.player_id <> p_player
    union all
    select 'like', 'material', m.id, m.title, l.player_id, a.name, null, l.created_at
      from public.study_likes l
      join public.study_materials m on m.id = l.material_id
      join public.study_players a on a.id = l.player_id
      where m.creator_id = p_player and l.player_id <> p_player
    union all
    select 'like', 'competition', r.id, r.subject, l.player_id, a.name, null, l.created_at
      from public.study_likes l
      join public.study_rooms r on r.id = l.room_id
      join public.study_room_players rp on rp.room_id = r.id and rp.player_id = p_player
      join public.study_players a on a.id = l.player_id
      where l.player_id <> p_player
    union all
    select 'comment', 'lesson', s.id, s.subject, c.player_id, a.name, c.body, c.created_at
      from public.study_comments c
      join public.study_sessions s on s.id = c.session_id
      join public.study_players a on a.id = c.player_id
      where s.player_id = p_player and c.player_id <> p_player
    union all
    select 'comment', 'material', m.id, m.title, c.player_id, a.name, c.body, c.created_at
      from public.study_comments c
      join public.study_materials m on m.id = c.material_id
      join public.study_players a on a.id = c.player_id
      where m.creator_id = p_player and c.player_id <> p_player
    union all
    select 'comment', 'competition', r.id, r.subject, c.player_id, a.name, c.body, c.created_at
      from public.study_comments c
      join public.study_rooms r on r.id = c.room_id
      join public.study_room_players rp on rp.room_id = r.id and rp.player_id = p_player
      join public.study_players a on a.id = c.player_id
      where c.player_id <> p_player
  ) n
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.study_notif_count(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.study_notifications(p_player, 100) n
  where n.created_at > (select p.notif_seen_at from public.study_players p where p.id = p_player);
$$;

create or replace function public.study_notif_seen(p_player uuid, p_upto timestamptz default null)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.study_players
  set notif_seen_at = greatest(notif_seen_at, least(coalesce(p_upto, now()), now()))
  where id = p_player;
$$;

revoke all on function public.study_notifications(uuid, integer) from public, anon, authenticated;
revoke all on function public.study_notif_count(uuid) from public, anon, authenticated;
revoke all on function public.study_notif_seen(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.study_notifications(uuid, integer) to service_role;
grant execute on function public.study_notif_count(uuid) to service_role;
grant execute on function public.study_notif_seen(uuid, timestamptz) to service_role;
