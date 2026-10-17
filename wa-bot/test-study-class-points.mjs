// Tes bobot poin kelas pada fungsi SQL study_submit_session, dijalankan di Postgres uji (PGlite) dengan SELURUH migrasi Study.
//   node test-study-class-points.mjs     (butuh paket @electric-sql/pglite; tanpa itu tes ini dilewati)
import assert from "node:assert/strict";
import fs from "node:fs";
import { classPercent } from "../supabase/functions/_shared/study-core.ts";

let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.log("dilewati: paket @electric-sql/pglite tidak terpasang (hanya untuk pengujian di komputer pengembang)");
  process.exit(0);
}

let n = 0;
const ok = (name) => console.log(`ok: ${name}`) || n++;
const dir = new URL("../supabase/migrations/", import.meta.url);
const files = fs.readdirSync(dir).filter((f) => /^00(2[3-9]|3[0-9]|4[0-9])_/.test(f)).sort();
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
  create table if not exists public.whatsapp_messages (id bigserial primary key, wa_jid text, created_at timestamptz default now(), direction text, content text, status text, wa_name text, wa_message_id text);
`);
for (const f of files) {
  try {
    await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));
  } catch (e) {
    console.log(`FAIL migrasi ${f}: ${String(e.message).slice(0, 300)}`);
    process.exit(1);
  }
}
ok(`semua migrasi Study (${files.length} berkas, termasuk 0040) berjalan di Postgres`);

const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const player = async (name, grade, cls) =>
  (await one("insert into public.study_players (name, grade, class_level, pin_salt, pin_hash) values ($1, $2, $3, 'x', 'x') returning id", [name, grade, cls])).id;

// SQL harus sama dengan study-core.ts
{
  const grades = ["TK", "SD", "SMP", "SMA", "S1", "S2", "S3", "Umum"];
  const classes = { SD: [1, 2, 3, 4, 5, 6], SMP: [7, 8, 9], SMA: [10, 11, 12] };
  const opts = (g) => (classes[g] ? classes[g].map((c) => [g, c]) : [[g, null]]);
  let cmp = 0;
  for (const pg of grades) for (const [, pc] of opts(pg)) for (const mg of grades) for (const [, mc] of opts(mg)) {
    const sql = (await one("select public.study_class_percent($1, $2, $3, $4) as p", [pg, pc, mg, mc])).p;
    assert.equal(sql, classPercent(pg, pc, mg, mc), `SQL != TS untuk ${pg} ${pc} -> ${mg} ${mc}`);
    cmp++;
  }
  ok(`study_class_percent (SQL) sama dengan classPercent (TS) untuk ${cmp} kombinasi`);
}

// pengumpulan sesi: poin x bobot kelas
const submit = async (playerId, subject, mGrade, mClass, correct, total = 10, level = "normal") => {
  const s = await one("insert into public.study_sessions (player_id, subject, material_grade, material_class, level, num_questions) values ($1, $2, $3, $4, $5, $6) returning id", [playerId, subject, mGrade, mClass, level, total]);
  for (let i = 0; i < total; i++) await db.query("insert into public.study_questions (session_id, idx, question, options, correct_index) values ($1, $2, 'q', '[\"a\",\"b\",\"c\",\"d\"]', 0)", [s.id, i]);
  const answers = Array.from({ length: total }, (_v, i) => (i < correct ? 0 : 1));
  const r = (await one("select public.study_submit_session($1, $2::jsonb) as r", [s.id, JSON.stringify(answers)])).r;
  const row = await one("select class_percent, points_awarded, points_raw from public.study_sessions where id = $1", [s.id]);
  return { r, row };
};
await db.exec("update public.study_settings set per_question_points = 10, perfect_bonus_percent = 0, weight_easy = 50, weight_normal = 100, weight_hard = 150, daily_points_cap = 0");

{
  const anak = await player("Anak", "SD", 3);
  const base = await submit(anak, "Matematika", "SD", 3, 10);
  assert.equal(base.r.classPercent, 100);
  assert.equal(base.r.points, 100);
  const up = await submit(anak, "IPA", "SD", 5, 10);
  assert.equal(up.r.classPercent, 120);
  assert.equal(up.r.points, 120);
  assert.equal(up.row.class_percent, 120);
  const down = await submit(anak, "IPS", "SD", 1, 10);
  assert.equal(down.r.classPercent, 80);
  assert.equal(down.r.points, 80);
  const smp = await submit(anak, "Bahasa Inggris", "SMP", 7, 10);
  assert.equal(smp.r.classPercent, 140);
  assert.equal(smp.r.points, 140);
  ok("SD 3: materi SD 3 = 100, SD 5 = 120, SD 1 = 80, SMP 7 = 140 poin (10 soal benar semua)");

  const part = await submit(anak, "Agama", "SD", 4, 7); // 7 benar: 10 x 7 x 110% = 77
  assert.equal(part.r.points, 77);
  const hard = await submit(anak, "PKn", "SD", 5, 10, 10, "hard"); // 10 x 10 x 150% x 120% = 180
  assert.equal(hard.r.points, 180);
  ok("bobot kelas dikalikan dengan nilai dan bobot level (7 benar x 110% = 77; hard x 120% = 180)");

  const umum = await submit(anak, "Pengetahuan Umum", "Umum", null, 10);
  assert.equal(umum.r.classPercent, 100);
  assert.equal(umum.r.points, 100);
  const noclass = await player("Tanpa Kelas", "SD", null);
  const nc = await submit(noclass, "Matematika", "SD", 6, 10);
  assert.equal(nc.r.classPercent, 100);
  ok("materi Umum dan pemain tanpa kelas: bobot netral 100%");

  // ulang di hari yang sama (50%) berlaku bersama bobot kelas: 10 x 10 x 120% x 50% = 60
  const again = await submit(anak, "IPA", "SD", 5, 10);
  assert.equal(again.r.repeatPercent, 50);
  assert.equal(again.r.points, 60);
  ok("pengurangan mata pelajaran berulang tetap berlaku bersama bobot kelas (120% x 50% = 60)");

  // pengumpulan ulang sesi yang sama mengembalikan hasil yang sama (tanpa hitung ulang)
  const sess = await one("select id from public.study_sessions where subject = 'IPA' order by submitted_at asc limit 1");
  const again2 = (await one("select public.study_submit_session($1, '[]'::jsonb) as r", [sess.id])).r;
  assert.equal(again2.already, true);
  assert.equal(again2.classPercent, 120);
  assert.equal(again2.points, 120);
  ok("kumpul ulang sesi yang sama: hasil lama (classPercent 120, 120 poin) tanpa hitung ulang");

  // batas poin harian berlaku setelah bobot kelas
  await db.exec("update public.study_settings set daily_points_cap = 50");
  const capped = await submit(await player("Pemain Batas", "SD", 3), "Seni", "SD", 6, 10); // mentah 130, batas 50
  assert.equal(capped.r.rawPoints, 130);
  assert.equal(capped.r.points, 50);
  ok("batas poin harian memotong setelah bobot kelas (mentah 130, didapat 50)");
}

console.log(`\n${n} kelompok tes lulus.`);
