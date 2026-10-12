-- ================================================================
-- Menu "Study": LATIHAN DARI MATERI.
--
-- Dari sebuah materi pelajaran, pemain (dengan PIN) bisa memulai latihan 10 soal yang dibuat AI dari isi materi itu.
-- Latihan = pelajaran biasa (poin, level, timer, pembahasan, suka/komentar sama persis), hanya saja sesinya mencatat
-- materi asalnya. Hasilnya tampil di timeline sebagai kartu pelajaran bertanda "Latihan materi".
--   - study_sessions.material_id    : materi asal (jadi null bila materinya dihapus)
--   - study_sessions.material_title : judul materi saat latihan dibuat (tetap tampil walau materinya dihapus)
--   - study_feed() menambahkan materialId + materialTitle pada kartu pelajaran.
--
-- Aman dijalankan ulang. Butuh migrasi 0025 dan 0028.
-- ================================================================

alter table public.study_sessions add column if not exists material_id uuid references public.study_materials (id) on delete set null;
alter table public.study_sessions add column if not exists material_title text check (material_title is null or char_length(material_title) <= 120);
create index if not exists study_sessions_material_idx on public.study_sessions (material_id) where material_id is not null;

create or replace function public.study_feed(p_owner uuid, p_viewer uuid, p_kinds text[] default null, p_limit integer default 20, p_before timestamptz default null)
returns table (kind text, ref_id uuid, at timestamptz, data jsonb, like_count integer, comment_count integer, liked boolean)
language sql
stable
security definer
set search_path = public
as $$
  with items as (
    select 'lesson'::text as kind, s.id as ref_id, s.submitted_at as at,
      jsonb_build_object(
        'playerId', p.id, 'playerName', p.name, 'grade', p.grade, 'classLevel', p.class_level,
        'subject', s.subject, 'topic', s.topic, 'materialGrade', s.material_grade, 'materialClass', s.material_class,
        'level', s.level, 'total', s.num_questions, 'correct', coalesce(s.correct_count, 0),
        'points', coalesce(s.points_awarded, 0), 'weightPercent', coalesce(s.weight_percent, 100), 'timedOut', s.timed_out,
        'materialId', s.material_id, 'materialTitle', s.material_title
      ) as data
    from public.study_sessions s join public.study_players p on p.id = s.player_id
    where s.status = 'submitted' and (p_owner is null or s.player_id = p_owner)
    union all
    select 'competition', r.id, r.finished_at,
      jsonb_build_object(
        'subject', r.subject, 'topic', r.topic, 'materialGrade', r.material_grade, 'materialClass', r.material_class,
        'level', r.level, 'total', r.num_questions, 'timeLimitSeconds', r.time_limit_seconds,
        'creatorName', r.creator_name, 'winnerId', r.winner_id, 'winnerName', r.winner_name, 'winBonus', r.win_bonus,
        'players', (select count(*) from public.study_room_players rp where rp.room_id = r.id),
        'top', coalesce((
          select jsonb_agg(jsonb_build_object('rank', x.rank, 'name', x.name, 'correct', x.correct_count, 'points', x.points_awarded + x.bonus_points) order by x.rank)
          from (
            select rp.rank, pl.name, rp.correct_count, rp.points_awarded, rp.bonus_points
            from public.study_room_players rp join public.study_players pl on pl.id = rp.player_id
            where rp.room_id = r.id order by rp.rank limit 3
          ) x
        ), '[]'::jsonb),
        'me', case when p_owner is null then null else (
          select jsonb_build_object('rank', rp.rank, 'correct', rp.correct_count, 'points', rp.points_awarded, 'bonus', rp.bonus_points, 'timedOut', rp.timed_out)
          from public.study_room_players rp where rp.room_id = r.id and rp.player_id = p_owner
        ) end
      )
    from public.study_rooms r
    where r.status = 'finished'
      and (p_owner is null or exists (select 1 from public.study_room_players rp where rp.room_id = r.id and rp.player_id = p_owner))
    union all
    select 'material', m.id, m.created_at,
      jsonb_build_object(
        'title', m.title, 'subject', m.subject, 'grade', m.grade, 'classLevel', m.class_level, 'detail', m.detail,
        'creatorId', m.creator_id, 'creatorName', m.creator_name
      )
    from public.study_materials m
    where (p_owner is null or m.creator_id = p_owner)
  )
  select
    i.kind, i.ref_id, i.at, i.data,
    (select count(*) from public.study_likes l
       where (i.kind = 'lesson' and l.session_id = i.ref_id) or (i.kind = 'competition' and l.room_id = i.ref_id) or (i.kind = 'material' and l.material_id = i.ref_id))::integer,
    (select count(*) from public.study_comments c
       where (i.kind = 'lesson' and c.session_id = i.ref_id) or (i.kind = 'competition' and c.room_id = i.ref_id) or (i.kind = 'material' and c.material_id = i.ref_id))::integer,
    (p_viewer is not null and exists (
       select 1 from public.study_likes l
       where l.player_id = p_viewer
         and ((i.kind = 'lesson' and l.session_id = i.ref_id) or (i.kind = 'competition' and l.room_id = i.ref_id) or (i.kind = 'material' and l.material_id = i.ref_id))
    ))
  from items i
  where (p_kinds is null or i.kind = any (p_kinds))
    and (p_before is null or i.at < p_before)
  order by i.at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.study_feed(uuid, uuid, text[], integer, timestamptz) from public, anon, authenticated;
grant execute on function public.study_feed(uuid, uuid, text[], integer, timestamptz) to service_role;
