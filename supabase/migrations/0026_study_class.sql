-- ================================================================
-- Menu "Study": KELAS untuk jenjang SD (1-6), SMP (7-9), dan SMA (10-12).
--
-- Kolom class_level (angka kelas) ditambahkan ke pemain, pelajaran (kelas materi), dan materi pelajaran.
-- Aturan (dijaga database): kelas hanya boleh terisi bila grade-nya SD/SMP/SMA dan angkanya sesuai jenjang;
-- grade lain (TK, S1-S3, Umum) tidak punya kelas. Data lama tetap berlaku dengan class_level kosong
-- (pemain lama: "semua kelas di jenjangnya" sampai kelasnya diatur lewat tombol Ubah kelas di profil).
--
-- Fungsi study_leaderboard dan study_timeline ikut menampilkan kelas. Karena bentuk hasilnya berubah, keduanya
-- dibuat ulang (drop lalu create). Aman dijalankan ulang. Butuh migrasi 0023, 0024, 0025.
-- ================================================================

alter table public.study_players add column if not exists class_level smallint;
alter table public.study_sessions add column if not exists material_class smallint;
alter table public.study_materials add column if not exists class_level smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'study_players_class_chk') then
    alter table public.study_players add constraint study_players_class_chk check (
      class_level is null
      or (grade = 'SD' and class_level between 1 and 6)
      or (grade = 'SMP' and class_level between 7 and 9)
      or (grade = 'SMA' and class_level between 10 and 12)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'study_sessions_class_chk') then
    alter table public.study_sessions add constraint study_sessions_class_chk check (
      material_class is null
      or (material_grade = 'SD' and material_class between 1 and 6)
      or (material_grade = 'SMP' and material_class between 7 and 9)
      or (material_grade = 'SMA' and material_class between 10 and 12)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'study_materials_class_chk') then
    alter table public.study_materials add constraint study_materials_class_chk check (
      class_level is null
      or (grade = 'SD' and class_level between 1 and 6)
      or (grade = 'SMP' and class_level between 7 and 9)
      or (grade = 'SMA' and class_level between 10 and 12)
    );
  end if;
end $$;

-- Papan peringkat (kolom class_level ditambahkan di akhir).
drop function if exists public.study_leaderboard();
create function public.study_leaderboard()
returns table (id uuid, name text, grade text, sessions_done integer, total_points integer, balance integer, class_level smallint)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.grade,
    (select count(*) from public.study_sessions s where s.player_id = p.id and s.status = 'submitted')::integer,
    coalesce((select sum(l.points) from public.study_ledger l where l.player_id = p.id and l.kind = 'session'), 0)::integer,
    public.study_balance(p.id),
    p.class_level
  from public.study_players p
  order by 5 desc, 4 desc, lower(p.name) asc;
$$;

-- Timeline satu pemain (material_class ditambahkan di akhir).
drop function if exists public.study_timeline(uuid, uuid, integer, timestamptz);
create function public.study_timeline(p_owner uuid, p_viewer uuid, p_limit integer default 20, p_before timestamptz default null)
returns table (
  session_id uuid, subject text, topic text, material_grade text, level text, num_questions integer,
  correct_count integer, points_awarded integer, weight_percent integer, submitted_at timestamptz,
  like_count integer, comment_count integer, liked boolean, material_class smallint
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
    (p_viewer is not null and exists (select 1 from public.study_likes l where l.session_id = s.id and l.player_id = p_viewer)),
    s.material_class
  from public.study_sessions s
  where s.player_id = p_owner
    and s.status = 'submitted'
    and (p_before is null or s.submitted_at < p_before)
  order by s.submitted_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.study_leaderboard() from public, anon, authenticated;
revoke all on function public.study_timeline(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.study_leaderboard() to service_role;
grant execute on function public.study_timeline(uuid, uuid, integer, timestamptz) to service_role;
