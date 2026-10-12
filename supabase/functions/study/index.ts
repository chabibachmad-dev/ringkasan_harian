// Edge Function untuk menu "Study" (latihan soal pilihan ganda buatan AI, poin, redeem, hukuman).
//
// Menu Study TIDAK memakai kode akses chat: siapa pun yang membuka aplikasi bisa memakainya. Tabel study_* dikunci
// total dari anon key (lihat migrations/0023_study.sql); semua baca/tulis lewat fungsi ini. Pengamannya ada dua lapis PIN
// plus pembatas pemakaian AI (jumlah pemain, permintaan per pemain & global per 24 jam, lihat konstanta di bawah):
//   - PIN pemain  : membuka profil/saldo, memulai & mengumpulkan pelajaran, redeem. Disimpan sebagai hash
//                   PBKDF2 + salt; salah 5 kali = terkunci 5 menit.
//   - PIN orang tua: untuk reset PIN pemain, hukuman poin, setting, hadiah, dan menandai hadiah "sudah diberikan".
//                   Belum diatur = aksi-aksi itu terbuka (aplikasi menyarankan membuatnya).
// KUNCI JAWABAN tidak pernah dikirim ke klien sebelum pelajaran dikumpulkan. Poin dihitung di database
// (fungsi study_submit_session), BUKAN oleh AI; AI hanya membuat soal dan menulis pembahasan.
//
// Body request (semua: { "action": "...", ... }); respons selalu { ok: boolean, ... }:
//   overview            -> { players: [{id,name,grade,classLevel,sessionsDone,totalPoints,balance}], settings, grades }
//   player_create       { name, grade, classLevel?, pin }                    -> { player }   (classLevel wajib untuk SD/SMP/SMA: SD 1-6, SMP 7-9, SMA 10-12)
//   player_update_level { playerId, pin, grade, classLevel?, parentPin? }    -> { player }   (naik kelas / ralat; PIN orang tua bila sudah dibuat)
//   player_profile      { playerId, pin }                                    -> { player, balance, totalEarned, sessions, redemptions, penalties, allowedGrades }
//   pin_reset           { playerId, newPin, parentPin? }                     -> { ok }
//   session_start       { playerId, pin, subject, topic?, materialGrade, materialClass?, level, count, engine? }
//                       ATAU latihan dari materi: { playerId, pin, materialId, level, engine? } (10 soal dari isi materi; pelajaran/tingkat/kelas diambil dari materi)
//                                                                            -> { sessionId, questions:[{idx,question,options}], provider, requested, shortfall }
//   session_get         { playerId, pin, sessionId }                         -> { status, questions } | { status:"submitted", result }
//   session_submit      { playerId, pin, sessionId, answers:[0..3|null], engine? } -> { result, explainFailed }
//   session_explain     { playerId, pin, sessionId, engine? }                -> { result, explainFailed }   (ulangi pembahasan yang gagal)
//   session_cancel      { playerId, pin, sessionId }                         -> { ok }   (hanya sesi yang belum dikumpulkan)
//   redeem              { playerId, pin, itemId }                            -> { redemption }
//   settings_open       { parentPin? }                                       -> { settings, pendingRedemptions, players }
//   settings_save       { parentPin?, perQuestionPoints, perfectBonusPercent, secondsPerQuestion, competitionWinBonus, weights:{easy,normal,hard}, subjects:[...] } -> { settings }
//   redeem_item_save    { parentPin?, id?, name, cost }                      -> { items }
//   redeem_item_delete  { parentPin?, id }                                   -> { items }
//   redeem_mark         { parentPin?, redemptionId, status:"given"|"pending" } -> { ok }
//   penalty             { parentPin?, playerId, points, reason }             -> { requested, applied, balance }
//   parent_pin_set      { newPin, parentPin? }                               -> { ok }
//   -- timeline (Facebook-like): lihat kegiatan pemain, suka, komentar, detil. Melihat timeline & komentar tidak perlu PIN;
//      suka/komentar/detil butuh PIN penonton (viewerId + viewerPin) dan tidak boleh pada kegiatan sendiri (suka/komentar).
//   player_verify       { playerId, pin }                                    -> { player }   (masuk sebagai penonton)
//   feed                { ownerId?, kinds?, viewerId?, viewerPin?, before? } -> { items:[{kind:"lesson"|"competition"|"material", id, at, likeCount, commentCount, liked, ...}], hasMore }
//                         (tanpa ownerId = timeline global semua pemain; dengan ownerId = kegiatan satu pemain; kinds menyaring jenis)
//   player_public       { playerId }                                         -> { player:{id,name,grade,classLevel}, stats:{rank,totalPoints,soloPoints,competitionPoints,lessons,competitions,wins,materials} }   (profil publik, tanpa PIN)
//   like_toggle         { viewerId, viewerPin, kind?, targetId }             -> { liked, count }   (kind: lesson (bawaan, boleh pakai sessionId) | competition | material)
//   comment_list        { kind?, targetId }                                  -> { comments:[{id,playerId,name,grade,body,createdAt}] }
//   comment_add         { viewerId, viewerPin, kind?, targetId, body }       -> { comment, count }
//   comment_delete      { commentId, viewerId?, viewerPin? | parentPin }     -> { ok, count }   (penulisnya, atau orang tua bila PIN-nya sudah dibuat)
//   result_detail       { viewerId, viewerPin, sessionId }                   -> { result }   (soal + jawaban + kunci + pembahasan, hanya pelajaran selesai)
//   -- KOMPETISI (room). Pembuat memilih pelajaran/tingkat/level/jumlah soal/waktu, pemain lain bergabung di lobi, pembuat menekan Mulai,
//      semua mengerjakan soal yang sama serentak. Skor tertinggi menang + bonus. Semua aksi room butuh PIN pemain (playerId + pin), kecuali room_list/room_result.
//   room_list           { }                                                  -> { rooms:[{...room, creatorName, players, playerNames}] }   (lobi & yang sedang berjalan)
//   room_create         { playerId, pin, subject, topic?, materialGrade, materialClass?, level, count, minutes, engine? } -> { state }
//   room_join           { roomId, playerId, pin }                            -> { state }
//   room_leave          { roomId, playerId, pin }                            -> { cancelled }   (pembuat keluar = room dibatalkan)
//   room_start          { roomId, playerId, pin }                            -> { state }   (pembuat, minimal 2 pemain)
//   room_state          { roomId, playerId, pin }                            -> { state:{room, players, me, questions|null, results|null} }   (dipanggil berkala saat di lobi / menunggu hasil)
//   room_submit         { roomId, playerId, pin, answers:[0..3|null] }       -> { state }
//   room_result         { roomId }                                           -> { room, results:[{rank,name,grade,classLevel,correct,seconds,points,bonus,timedOut}] }   (publik, hanya room selesai)
//   -- materi pelajaran buatan AI (tab "Materi"); DAFTAR & ISI bisa dibaca semua orang tanpa PIN, membuat butuh PIN pemain
//   material_list       { before? }                                          -> { items:[{id,title,subject,grade,detail,creatorName,createdAt}], hasMore }
//   material_get        { materialId }                                       -> { material:{...,content} }
//   material_create     { playerId, pin, subject, grade, classLevel?, detail, engine? }   -> { material:{...,content} }
//   material_delete     { materialId, playerId?, pin? | parentPin }          -> { ok }   (pembuatnya dengan PIN, atau orang tua bila PIN-nya sudah dibuat)

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiApiKeys, generateJsonText, setGeminiKeyReporter } from "../_shared/gemini.ts";
import { setFallbackReporter } from "../_shared/llm-fallback.ts";
import {
  GRADES,
  LEVELS,
  MAX_QUESTIONS,
  PIN_LOCK_MS,
  PIN_MAX_FAILURES,
  QUESTION_BATCH,
  allowedMaterialGrades,
  classesOf,
  gradeLong,
  isLevelAllowed,
  validClass,
  MATERIAL_DETAIL_MAX,
  buildExplainPrompt,
  buildMaterialPrompt,
  buildQuestionPrompt,
  cleanMaterial,
  cleanLine,
  hashPin,
  isMaterialGradeAllowed,
  lockSecondsLeft,
  parseExplanations,
  parseQuestions,
  practiceSource,
  PRACTICE_QUESTIONS,
  validCount,
  validPin,
  verifyPin
} from "../_shared/study-core.ts";
import type { ParsedQuestion } from "../_shared/study-core.ts";

type Admin = ReturnType<typeof createClient>;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const MAX_PLAYERS = 50; // batas jumlah pemain (Study terbuka tanpa kode akses)
const GEN_PER_PLAYER_DAY = 25; // permintaan buat pelajaran/materi per pemain per 24 jam
const GEN_GLOBAL_DAY = 100; // total permintaan buat pelajaran/materi semua pemain per 24 jam
const MAX_ACTIVE_SESSIONS = 3; // sesi belum dikumpulkan per pemain (mencegah memboroskan kuota AI)
const GENERATION_BUDGET_MS = 100_000; // berhenti meminta soal tambahan setelah ini (batas fungsi ±150 dtk)
const EXPLAIN_BATCH = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const fail = (error: string, status = 400, extra: Row = {}) => json({ ok: false, error, ...extra }, status);
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function pacificDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// ---------------------------------------------------------------- PIN
async function checkPlayerPin(admin: Admin, playerId: unknown, pin: unknown): Promise<{ player: Row } | Response> {
  if (!isUuid(playerId)) return fail("Pemain tidak valid.");
  const { data: player, error } = await admin.from("study_players").select("*").eq("id", playerId).maybeSingle();
  if (error) return fail(error.message, 500);
  if (!player) return fail("Pemain tidak ditemukan.", 404);
  const left = lockSecondsLeft(player.pin_locked_until, Date.now());
  if (left > 0) return fail(`PIN terkunci. Coba lagi ${Math.ceil(left / 60)} menit lagi.`, 429, { locked: true, seconds: left });
  if (typeof pin === "string" && validPin(pin) && (await verifyPin(pin, player.pin_salt, player.pin_hash))) {
    if (player.pin_failures > 0) await admin.from("study_players").update({ pin_failures: 0, pin_locked_until: null }).eq("id", playerId);
    return { player };
  }
  const failures = (player.pin_failures ?? 0) + 1;
  const lock = failures >= PIN_MAX_FAILURES;
  await admin
    .from("study_players")
    .update({ pin_failures: lock ? 0 : failures, pin_locked_until: lock ? new Date(Date.now() + PIN_LOCK_MS).toISOString() : null })
    .eq("id", playerId);
  return fail(lock ? "PIN salah terlalu sering. Terkunci 5 menit." : `PIN salah. Sisa percobaan: ${PIN_MAX_FAILURES - failures}.`, 403, {
    pinWrong: true,
    locked: lock,
    attemptsLeft: lock ? 0 : PIN_MAX_FAILURES - failures,
    seconds: lock ? PIN_LOCK_MS / 1000 : 0
  });
}

// PIN orang tua belum diatur = lolos (aplikasi menyarankan membuatnya).
async function checkParentPin(admin: Admin, parentPin: unknown): Promise<{ settings: Row } | Response> {
  const { data: s, error } = await admin.from("study_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !s) return fail(error?.message || "Setting Study belum ada. Jalankan migrasi 0023.", 500);
  if (!s.parent_pin_hash) return { settings: s };
  const left = lockSecondsLeft(s.parent_pin_locked_until, Date.now());
  if (left > 0) return fail(`PIN orang tua terkunci. Coba lagi ${Math.ceil(left / 60)} menit lagi.`, 429, { locked: true, seconds: left });
  if (typeof parentPin === "string" && validPin(parentPin) && (await verifyPin(parentPin, s.parent_pin_salt, s.parent_pin_hash))) {
    if (s.parent_pin_failures > 0) await admin.from("study_settings").update({ parent_pin_failures: 0, parent_pin_locked_until: null }).eq("id", 1);
    return { settings: s };
  }
  const failures = (s.parent_pin_failures ?? 0) + 1;
  const lock = failures >= PIN_MAX_FAILURES;
  await admin
    .from("study_settings")
    .update({ parent_pin_failures: lock ? 0 : failures, parent_pin_locked_until: lock ? new Date(Date.now() + PIN_LOCK_MS).toISOString() : null })
    .eq("id", 1);
  return fail(lock ? "PIN orang tua salah terlalu sering. Terkunci 5 menit." : `PIN orang tua salah. Sisa percobaan: ${PIN_MAX_FAILURES - failures}.`, 403, {
    pinWrong: true,
    parent: true,
    locked: lock,
    attemptsLeft: lock ? 0 : PIN_MAX_FAILURES - failures,
    seconds: lock ? PIN_LOCK_MS / 1000 : 0
  });
}

// ---------------------------------------------------------------- bentuk data ke klien
const publicSettings = (s: Row, items: Row[]) => ({
  perQuestionPoints: s.per_question_points,
  perfectBonusPercent: s.perfect_bonus_percent,
  secondsPerQuestion: s.seconds_per_question, // 0 = tanpa timer
  competitionWinBonus: s.competition_win_bonus,
  weights: { easy: s.weight_easy, normal: s.weight_normal, hard: s.weight_hard },
  subjects: Array.isArray(s.subjects) ? s.subjects : [],
  parentPinSet: !!s.parent_pin_hash,
  redeemItems: items.map((i) => ({ id: i.id, name: i.name, cost: i.cost }))
});

async function loadItems(admin: Admin): Promise<Row[]> {
  const { data } = await admin.from("study_redeem_items").select("id,name,cost").order("sort", { ascending: true }).order("cost", { ascending: true });
  return data ?? [];
}

async function loadSettings(admin: Admin): Promise<Row | null> {
  const { data } = await admin.from("study_settings").select("*").eq("id", 1).maybeSingle();
  return data ?? null;
}

// Kelas dari klien: bilangan bulat atau kosong (null). Nilai lain -> NaN supaya ditolak validClass.
function classOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "number" && Number.isInteger(v) ? v : Number.NaN;
}

const sessionRow = (s: Row) => ({
  id: s.id,
  subject: s.subject,
  topic: s.topic,
  materialGrade: s.material_grade,
  materialClass: s.material_class ?? null,
  materialId: s.material_id ?? null,
  materialTitle: s.material_title ?? null,
  level: s.level,
  numQuestions: s.num_questions,
  status: s.status,
  correctCount: s.correct_count,
  pointsAwarded: s.points_awarded,
  weightPercent: s.weight_percent,
  provider: s.provider,
  createdAt: s.created_at,
  submittedAt: s.submitted_at,
  bonusPercent: s.bonus_percent ?? 0,
  timedOut: !!s.timed_out,
  timeLimitSeconds: s.time_limit_seconds ?? null,
  // sisa waktu menurut jam SERVER (detik), supaya jam perangkat yang keliru tidak berpengaruh; null = tanpa timer
  secondsLeft:
    s.status === "active" && s.time_limit_seconds
      ? Math.max(0, Math.ceil((new Date(s.created_at).getTime() + s.time_limit_seconds * 1000 - Date.now()) / 1000))
      : null
});

// Hasil lengkap sesi yang SUDAH dikumpulkan (memuat kunci jawaban + pembahasan).
async function loadResult(admin: Admin, session: Row, player: Row) {
  const { data: qs } = await admin.from("study_questions").select("*").eq("session_id", session.id).order("idx", { ascending: true });
  const items = (qs ?? []).map((q: Row) => ({
    idx: q.idx,
    question: q.question,
    options: q.options,
    correctIndex: q.correct_index,
    userAnswer: q.user_answer,
    isCorrect: q.user_answer !== null && q.user_answer === q.correct_index,
    explanation: q.explanation,
    doubtful: q.doubtful
  }));
  return {
    session: sessionRow(session),
    player: { id: player.id, name: player.name, grade: player.grade, classLevel: player.class_level ?? null },
    total: items.length,
    correct: session.correct_count ?? 0,
    basePoints: session.base_points,
    bonusPercent: session.bonus_percent ?? 0,
    perQuestionPoints: session.per_question_points ?? null, // null = pelajaran lama (rumus lama)
    timedOut: !!session.timed_out,
    weightPercent: session.weight_percent,
    points: session.points_awarded ?? 0,
    items
  };
}

// ---------------------------------------------------------------- AI
async function recordTokens(admin: Admin, tokens: number, cost: number) {
  if (tokens <= 0) return;
  try {
    const today = pacificDate();
    const { data: ex } = await admin.from("token_usage").select("total_tokens,total_cost_usd").eq("usage_date", today).maybeSingle();
    await admin.from("token_usage").upsert({
      usage_date: today,
      total_tokens: (ex?.total_tokens ?? 0) + tokens,
      total_cost_usd: Number(ex?.total_cost_usd ?? 0) + cost,
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("study: gagal catat token_usage:", err instanceof Error ? err.message : String(err));
  }
}

function wireReporters(admin: Admin) {
  setGeminiKeyReporter(async (event) => {
    await admin.rpc("report_gemini_key_event", {
      p_usage_date: pacificDate(),
      p_key_hint: event.keyHint,
      p_source: "chat",
      p_requests_inc: event.kind === "success" ? 1 : 0,
      p_exhausted_until: event.kind === "exhausted" && event.exhaustedUntilMs ? new Date(event.exhaustedUntilMs).toISOString() : null,
      p_error: event.kind === "exhausted" ? (event.error ?? null) : null
    });
  });
  setFallbackReporter(async (e) => {
    await admin.rpc("report_llm_key_event", {
      p_provider: e.provider,
      p_usage_date: new Date().toISOString().slice(0, 10),
      p_key_hint: e.keyHint,
      p_source: "chat",
      p_requests_inc: e.kind === "success" ? 1 : 0,
      p_exhausted_until: e.untilMs ? new Date(e.untilMs).toISOString() : null,
      p_error: e.kind === "success" ? null : (e.error ?? null),
      p_model: e.kind === "success" ? (e.model || null) : null,
      p_clear_exhausted: e.kind === "success"
    });
  });
}

type Engine = "auto" | "gemini" | "groq" | "openrouter";
const parseEngine = (v: unknown): Engine => (v === "gemini" || v === "groq" || v === "openrouter" ? v : "auto");

// Minta soal per kelompok (maks QUESTION_BATCH) sampai jumlah terpenuhi; soal tak sah/kembar dibuang & diminta lagi.
async function makeQuestions(
  admin: Admin,
  spec: { subject: string; topic?: string; grade: string; classLevel?: number | null; level: string; count: number; source?: string },
  engine: Engine
): Promise<{ questions: ParsedQuestion[]; provider: string; lastError: string }> {
  const keys = getGeminiApiKeys();
  const out: ParsedQuestion[] = [];
  const started = Date.now();
  const maxAttempts = Math.ceil(spec.count / QUESTION_BATCH) + 2;
  let provider = "gemini";
  let lastError = "";
  let errorsInRow = 0;
  let tokens = 0;
  let cost = 0;
  for (let attempt = 0; attempt < maxAttempts && out.length < spec.count; attempt++) {
    if (attempt > 0 && Date.now() - started > GENERATION_BUDGET_MS) break;
    const need = Math.min(QUESTION_BATCH, spec.count - out.length);
    const p = buildQuestionPrompt({ ...spec, count: need, avoid: out.map((q) => q.question) });
    try {
      const r = await generateJsonText(p.system, p.user, keys, { temperature: 0.8, engine });
      tokens += r.tokensUsed;
      cost += r.costUsd;
      if (r.provider) provider = r.provider;
      const got = parseQuestions(r.text, { existing: out.map((q) => q.question), max: need });
      if (got.length === 0) lastError = "AI mengembalikan soal yang tidak bisa dipakai.";
      out.push(...got);
      errorsInRow = 0;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (++errorsInRow >= 2) break;
    }
  }
  await recordTokens(admin, tokens, cost);
  return { questions: out, provider, lastError };
}

// Tulis pembahasan untuk soal yang belum punya (per kelompok, paralel). Mengembalikan jumlah yang masih kosong.
async function explainQuestions(admin: Admin, session: Row, engine: Engine): Promise<number> {
  const { data: qs } = await admin.from("study_questions").select("*").eq("session_id", session.id).order("idx", { ascending: true });
  const pending = (qs ?? []).filter((q: Row) => !q.explanation);
  if (pending.length === 0) return 0;
  const keys = getGeminiApiKeys();
  const batches: Row[][] = [];
  for (let i = 0; i < pending.length; i += EXPLAIN_BATCH) batches.push(pending.slice(i, i + EXPLAIN_BATCH));
  let tokens = 0;
  let cost = 0;
  await Promise.all(
    batches.map(async (batch) => {
      const items = batch.map((q: Row) => ({
        no: q.idx + 1,
        question: q.question,
        options: q.options as string[],
        correctIndex: q.correct_index,
        userAnswer: q.user_answer
      }));
      const p = buildExplainPrompt(session.subject, gradeLong(session.material_grade, session.material_class), items);
      try {
        const r = await generateJsonText(p.system, p.user, keys, { temperature: 0.3, engine });
        tokens += r.tokensUsed;
        cost += r.costUsd;
        const parsed = parseExplanations(r.text, items.map((i) => i.no));
        for (const e of parsed) {
          const q = batch.find((x: Row) => x.idx + 1 === e.no);
          if (!q) continue;
          await admin.from("study_questions").update({ explanation: e.explanation, doubtful: e.doubtful }).eq("id", q.id);
        }
      } catch (err) {
        console.warn("study: pembahasan gagal untuk satu kelompok:", err instanceof Error ? err.message : String(err));
      }
    })
  );
  await recordTokens(admin, tokens, cost);
  const { count } = await admin.from("study_questions").select("id", { count: "exact", head: true }).eq("session_id", session.id).is("explanation", null);
  return count ?? 0;
}

async function loadOwnedSession(admin: Admin, sessionId: unknown, playerId: string): Promise<{ session: Row } | Response> {
  if (!isUuid(sessionId)) return fail("Sesi tidak valid.");
  const { data: s } = await admin.from("study_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!s || s.player_id !== playerId) return fail("Pelajaran tidak ditemukan.", 404);
  return { session: s };
}

// ---------------------------------------------------------------- validasi setting
function readSettingsInput(body: Row): { ok: true; value: Row } | { ok: false; error: string } {
  const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
  const perQ = int(body.perQuestionPoints, 1, 10000);
  const bonus = int(body.perfectBonusPercent, 0, 100);
  const spq = int(body.secondsPerQuestion, 0, 600);
  const winBonus = int(body.competitionWinBonus, 0, 1000);
  const w = (body.weights ?? {}) as Row;
  const easy = int(w.easy, 1, 1000);
  const normal = int(w.normal, 1, 1000);
  const hard = int(w.hard, 1, 1000);
  if (perQ === null) return { ok: false, error: "Poin per soal harus bilangan bulat 1-10000." };
  if (bonus === null) return { ok: false, error: "Bonus nilai sempurna harus bilangan bulat 0-100 (persen)." };
  if (winBonus === null) return { ok: false, error: "Bonus pemenang kompetisi harus bilangan bulat 0-1000." };
  if (spq === null || (spq !== 0 && spq < 10)) return { ok: false, error: "Waktu per soal harus 0 (tanpa timer) atau 10-600 detik." };
  if (easy === null || normal === null || hard === null) return { ok: false, error: "Bobot level harus bilangan bulat 1-1000 (persen)." };
  const rawSubjects = Array.isArray(body.subjects) ? body.subjects : [];
  const subjects: string[] = [];
  for (const s of rawSubjects) {
    const name = cleanLine(s, 40);
    if (name && !subjects.some((x) => x.toLowerCase() === name.toLowerCase())) subjects.push(name);
  }
  if (subjects.length === 0 || subjects.length > 30) return { ok: false, error: "Daftar pelajaran harus berisi 1-30 nama." };
  return { ok: true, value: { per_question_points: perQ, perfect_bonus_percent: bonus, seconds_per_question: spq, competition_win_bonus: winBonus, weight_easy: easy, weight_normal: normal, weight_hard: hard, subjects, updated_at: new Date().toISOString() } };
}

// ---------------------------------------------------------------- pembatas pemakaian AI
// Mencatat satu permintaan pembuatan soal/materi, atau menolaknya bila batas 24 jam terlampaui.
// Dicatat SEBELUM AI dipanggil (gagal pun tetap memakai kuota), dan pembatalan pelajaran tidak menghapus catatannya.
async function takeGenerationSlot(admin: Admin, playerId: string, kind: "lesson" | "material"): Promise<Response | null> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [mine, all] = await Promise.all([
    admin.from("study_gen_log").select("id", { count: "exact", head: true }).eq("player_id", playerId).gte("created_at", since),
    admin.from("study_gen_log").select("id", { count: "exact", head: true }).gte("created_at", since)
  ]);
  if ((mine.count ?? 0) >= GEN_PER_PLAYER_DAY) {
    return fail(`Batas harian tercapai: maksimal ${GEN_PER_PLAYER_DAY} pembuatan soal/materi per pemain dalam 24 jam. Coba lagi nanti.`, 429, { dailyLimit: true });
  }
  if ((all.count ?? 0) >= GEN_GLOBAL_DAY) {
    return fail("Batas harian pembuatan soal/materi untuk seluruh pemain sudah tercapai. Coba lagi besok.", 429, { dailyLimit: true });
  }
  await admin.from("study_gen_log").insert({ kind, player_id: playerId });
  // bersih-bersih catatan lama (tidak perlu disimpan lebih dari beberapa hari)
  if (Math.random() < 0.05) await admin.from("study_gen_log").delete().lt("created_at", new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());
  return null;
}

// ---------------------------------------------------------------- materi pelajaran: bantu
const MATERIAL_PAGE = 20;
const MATERIAL_PER_PLAYER_ATTEMPTS = 2; // percobaan membuat materi (bila AI mengembalikan jawaban tak layak)

const materialRow = (m: Row, withContent = false) => ({
  id: m.id,
  creatorId: m.creator_id ?? null,
  title: m.title,
  subject: m.subject,
  grade: m.grade,
  classLevel: m.class_level ?? null,
  detail: m.detail,
  creatorName: m.creator_name,
  createdAt: m.created_at,
  ...(withContent ? { content: m.content } : {})
});

// ---------------------------------------------------------------- timeline: bantu
const TIMELINE_PAGE = 20;
const COMMENT_MAX = 300;

// Pesan galat dari fungsi SQL timeline -> respons ramah.
function socialError(message: string): Response | null {
  if (/KEGIATAN_TIDAK_ADA/.test(message)) return fail("Kegiatan itu tidak ditemukan.", 404);
  if (/KEGIATAN_SENDIRI/.test(message)) return fail("Kamu tidak bisa menyukai atau mengomentari kegiatanmu sendiri.", 400);
  if (/KOMENTAR_PENUH/.test(message)) return fail("Batas komentar untuk kegiatan ini sudah tercapai.", 429);
  if (/KOMENTAR_TIDAK_VALID/.test(message)) return fail(`Komentar harus 1-${COMMENT_MAX} karakter.`, 400);
  if (/PEMAIN_TIDAK_ADA/.test(message)) return fail("Pemain tidak ditemukan.", 404);
  return null;
}

async function loadSubmittedSession(admin: Admin, sessionId: unknown): Promise<{ session: Row } | Response> {
  if (!isUuid(sessionId)) return fail("Kegiatan tidak valid.");
  const { data: s } = await admin.from("study_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!s || s.status !== "submitted") return fail("Kegiatan itu tidak ditemukan.", 404);
  return { session: s };
}

// ---------------------------------------------------------------- suka & komentar: jenis kegiatan
const KIND_COL: Record<string, string> = { lesson: "session_id", competition: "room_id", material: "material_id" };

function readTarget(body: Row): { kind: string; id: string } | null {
  const kind = typeof body.kind === "string" ? body.kind : "lesson";
  const id = body.targetId ?? body.sessionId;
  if (!KIND_COL[kind] || !isUuid(id)) return null;
  return { kind, id };
}

// Kegiatan yang boleh dilihat komentarnya: pelajaran selesai, kompetisi selesai, atau materi.
async function targetVisible(admin: Admin, t: { kind: string; id: string }): Promise<boolean> {
  if (t.kind === "lesson") {
    const { data } = await admin.from("study_sessions").select("id").eq("id", t.id).eq("status", "submitted").maybeSingle();
    return !!data;
  }
  if (t.kind === "competition") {
    const { data } = await admin.from("study_rooms").select("id").eq("id", t.id).eq("status", "finished").maybeSingle();
    return !!data;
  }
  const { data } = await admin.from("study_materials").select("id").eq("id", t.id).maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------- timeline global: bantu
const FEED_KINDS = ["lesson", "competition", "material"];
const ISO_CURSOR_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;

const feedItem = (r: Row) => ({
  kind: r.kind,
  id: r.ref_id,
  at: r.at,
  likeCount: r.like_count,
  commentCount: r.comment_count,
  liked: !!r.liked,
  ...(r.data as Row)
});

// ---------------------------------------------------------------- kompetisi: bantu
const ROOM_MAX_MINUTES = 120;
const ROOM_LIST_MAX = 30;

function roomError(message: string): Response | null {
  if (/ROOM_TIDAK_ADA/.test(message)) return fail("Room itu tidak ditemukan (mungkin sudah dibatalkan).", 404);
  if (/SUDAH_DI_ROOM/.test(message)) return fail("Kamu masih ada di room lain yang belum selesai. Selesaikan atau keluar dulu.", 409, { alreadyInRoom: true });
  if (/ROOM_BUKAN_LOBI/.test(message)) return fail("Room itu sudah dimulai, tidak bisa bergabung lagi.", 409);
  if (/ROOM_PENUH/.test(message)) return fail("Room sudah penuh.", 409);
  if (/ROOM_SUDAH_JALAN/.test(message)) return fail("Room sudah berjalan, tidak bisa ditinggalkan.", 409);
  if (/ROOM_BELUM_JALAN/.test(message)) return fail("Room belum dimulai.", 409);
  if (/BUKAN_PEMBUAT/.test(message)) return fail("Hanya pembuat room yang bisa memulai.", 403);
  if (/PEMAIN_KURANG/.test(message)) return fail("Minimal 2 pemain untuk memulai kompetisi.", 409);
  if (/BUKAN_PESERTA/.test(message)) return fail("Kamu bukan peserta room ini.", 403);
  if (/PEMAIN_TIDAK_ADA/.test(message)) return fail("Pemain tidak ditemukan.", 404);
  if (/JAWABAN_TIDAK_VALID|SOAL_TIDAK_VALID/.test(message)) return fail("Data tidak valid.", 400);
  return null;
}

const roomRow = (r: Row, playerCount: number) => ({
  id: r.id,
  subject: r.subject,
  topic: r.topic,
  materialGrade: r.material_grade,
  materialClass: r.material_class ?? null,
  level: r.level,
  numQuestions: r.num_questions,
  timeLimitSeconds: r.time_limit_seconds,
  maxPlayers: r.max_players,
  status: r.status,
  creatorId: r.creator_id ?? null,
  creatorName: r.creator_name,
  createdAt: r.created_at,
  startedAt: r.started_at ?? null,
  winnerName: r.winner_name ?? null,
  winBonus: r.win_bonus,
  perQuestionPoints: r.per_question_points,
  weightPercent: r.weight_percent,
  perfectBonusPercent: r.perfect_bonus_percent,
  players: playerCount,
  // sisa waktu menurut jam SERVER (detik) selama room berjalan
  secondsLeft: r.status === "running" && r.ends_at ? Math.max(0, Math.ceil((new Date(r.ends_at).getTime() - Date.now()) / 1000)) : null
});

async function loadRoom(admin: Admin, roomId: unknown): Promise<Row | null> {
  if (!isUuid(roomId)) return null;
  await admin.rpc("study_room_sweep"); // tutup room yang waktunya habis / lobi menganggur sebelum dibaca
  const { data } = await admin.from("study_rooms").select("*").eq("id", roomId).maybeSingle();
  return data ?? null;
}

// Hasil room selesai: tabel peringkat. Skor baru dibuka setelah room selesai supaya tidak membocorkan jawaban peserta lain.
async function roomResults(admin: Admin, room: Row): Promise<Row[]> {
  const { data: rps } = await admin.from("study_room_players").select("*").eq("room_id", room.id).order("rank", { ascending: true });
  const ids = (rps ?? []).map((x: Row) => x.player_id);
  const { data: ps } = ids.length ? await admin.from("study_players").select("id,name,grade,class_level").in("id", ids) : { data: [] as Row[] };
  const byId = new Map<string, Row>((ps ?? []).map((p: Row) => [p.id as string, p] as [string, Row]));
  const startedMs = room.started_at ? new Date(room.started_at).getTime() : 0;
  return (rps ?? []).map((rp: Row) => ({
    rank: rp.rank,
    playerId: rp.player_id,
    name: byId.get(rp.player_id)?.name ?? "?",
    grade: byId.get(rp.player_id)?.grade ?? "",
    classLevel: byId.get(rp.player_id)?.class_level ?? null,
    correct: rp.correct_count ?? 0,
    total: room.num_questions,
    seconds: rp.submitted_at && startedMs ? Math.max(0, Math.round((new Date(rp.submitted_at).getTime() - startedMs) / 1000)) : null,
    points: rp.points_awarded ?? 0,
    bonus: rp.bonus_points ?? 0,
    timedOut: !!rp.timed_out
  }));
}

// Keadaan room untuk satu peserta. Soal (tanpa kunci) hanya dikirim saat room berjalan dan peserta belum mengumpulkan.
async function roomState(admin: Admin, room: Row, me: string | null) {
  const { data: rps } = await admin.from("study_room_players").select("player_id,submitted_at,joined_at").eq("room_id", room.id).order("joined_at", { ascending: true });
  const ids = (rps ?? []).map((x: Row) => x.player_id);
  const { data: ps } = ids.length ? await admin.from("study_players").select("id,name,grade,class_level").in("id", ids) : { data: [] as Row[] };
  const byId = new Map<string, Row>((ps ?? []).map((p: Row) => [p.id as string, p] as [string, Row]));
  const mine = (rps ?? []).find((x: Row) => x.player_id === me);
  let questions: Row[] | null = null;
  if (room.status === "running" && mine && !mine.submitted_at) {
    const { data: qs } = await admin.from("study_room_questions").select("idx,question,options").eq("room_id", room.id).order("idx", { ascending: true });
    questions = qs ?? [];
  }
  return {
    room: roomRow(room, (rps ?? []).length),
    players: (rps ?? []).map((rp: Row) => ({
      id: rp.player_id,
      name: byId.get(rp.player_id)?.name ?? "?",
      grade: byId.get(rp.player_id)?.grade ?? "",
      classLevel: byId.get(rp.player_id)?.class_level ?? null,
      isCreator: rp.player_id === room.creator_id,
      submitted: !!rp.submitted_at
    })),
    me: mine ? { submitted: !!mine.submitted_at } : null,
    questions,
    results: room.status === "finished" ? await roomResults(admin, room) : null
  };
}

// ================================================================ handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return fail("Body harus JSON valid", 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const action = String(body.action ?? "");

  try {
    // ------------------------------------------------------------ overview
    if (action === "overview") {
      const [{ data: board, error }, settings, items] = await Promise.all([admin.rpc("study_leaderboard"), loadSettings(admin), loadItems(admin)]);
      if (error) return fail(error.message, 500);
      if (!settings) return fail("Setting Study belum ada. Jalankan migrasi 0023_study.sql.", 500);
      return json({
        ok: true,
        players: (board ?? []).map((p: Row) => ({ id: p.id, name: p.name, grade: p.grade, classLevel: p.class_level ?? null, sessionsDone: p.sessions_done, competitions: p.competitions ?? 0, wins: p.wins ?? 0, totalPoints: p.total_points, balance: p.balance })),
        settings: publicSettings(settings, items),
        grades: GRADES
      });
    }

    // ------------------------------------------------------------ pemain baru
    if (action === "player_create") {
      const name = cleanLine(body.name, 30);
      if (!name) return fail("Nama wajib diisi.");
      if (typeof body.grade !== "string" || !GRADES.includes(body.grade)) return fail("Grade tidak valid.");
      const cls = classOf(body.classLevel);
      if (classesOf(body.grade).length > 0 && cls === null) return fail("Pilih kelasnya.");
      if (!validClass(body.grade, cls)) return fail("Kelas tidak sesuai dengan grade.");
      if (!validPin(body.pin)) return fail("PIN harus 4-6 angka.");
      const { count: nPlayers } = await admin.from("study_players").select("id", { count: "exact", head: true });
      if ((nPlayers ?? 0) >= MAX_PLAYERS) return fail(`Jumlah pemain sudah mencapai batas (${MAX_PLAYERS}).`, 429);
      const { salt, hash } = await hashPin(body.pin as string);
      const { data, error } = await admin.from("study_players").insert({ name, grade: body.grade, class_level: cls, pin_salt: salt, pin_hash: hash }).select("id,name,grade,class_level").single();
      if (error) return error.code === "23505" ? fail("Nama itu sudah dipakai pemain lain.", 409) : fail(error.message, 500);
      return json({ ok: true, player: { id: data.id, name: data.name, grade: data.grade, classLevel: data.class_level ?? null } });
    }

    // ------------------------------------------------------------ naik kelas / ralat grade & kelas
    if (action === "player_update_level") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      if (typeof body.grade !== "string" || !GRADES.includes(body.grade)) return fail("Grade tidak valid.");
      const cls = classOf(body.classLevel);
      if (classesOf(body.grade).length > 0 && cls === null) return fail("Pilih kelasnya.");
      if (!validClass(body.grade, cls)) return fail("Kelas tidak sesuai dengan grade.");
      // Menurunkan tingkat membuka materi yang lebih rendah, jadi bila PIN orang tua sudah dibuat, ia wajib.
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      const { data, error } = await admin.from("study_players").update({ grade: body.grade, class_level: cls }).eq("id", auth.player.id).select("id,name,grade,class_level").single();
      if (error || !data) return fail(error?.message || "Gagal menyimpan.", 500);
      return json({ ok: true, player: { id: data.id, name: data.name, grade: data.grade, classLevel: data.class_level ?? null } });
    }

    // ------------------------------------------------------------ profil pemain
    if (action === "player_profile") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      const [bal, sessions, reds, ledger, items] = await Promise.all([
        admin.rpc("study_balance", { p_player: p.id }),
        admin.from("study_sessions").select("*").eq("player_id", p.id).order("created_at", { ascending: false }).limit(50),
        admin.from("study_redemptions").select("*").eq("player_id", p.id).order("created_at", { ascending: false }).limit(100),
        admin.from("study_ledger").select("kind,points,note,meta,created_at").eq("player_id", p.id).in("kind", ["session", "competition", "competition_bonus", "penalty"]).order("created_at", { ascending: false }).limit(300),
        loadItems(admin)
      ]);
      const ledgerRows = (ledger.data ?? []) as Row[];
      const totalEarned = ledgerRows.filter((l) => l.kind !== "penalty").reduce((a, l) => a + l.points, 0);
      return json({
        ok: true,
        player: { id: p.id, name: p.name, grade: p.grade, classLevel: p.class_level ?? null },
        balance: bal.data ?? 0,
        totalEarned,
        sessions: (sessions.data ?? []).map(sessionRow),
        redemptions: (reds.data ?? []).map((r: Row) => ({ id: r.id, itemName: r.item_name, cost: r.cost, status: r.status, createdAt: r.created_at, givenAt: r.given_at })),
        penalties: ledgerRows.filter((l) => l.kind === "penalty").slice(0, 50).map((l) => ({ points: -l.points, requested: l.meta?.requested ?? -l.points, reason: l.note, createdAt: l.created_at })),
        redeemItems: items,
        allowedGrades: allowedMaterialGrades(p.grade),
        classRanges: Object.fromEntries(["SD", "SMP", "SMA"].map((g) => [g, classesOf(g)]))
      });
    }

    // ------------------------------------------------------------ reset PIN pemain (orang tua)
    if (action === "pin_reset") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      if (!isUuid(body.playerId)) return fail("Pemain tidak valid.");
      if (!validPin(body.newPin)) return fail("PIN baru harus 4-6 angka.");
      const { salt, hash } = await hashPin(body.newPin as string);
      const { data, error } = await admin
        .from("study_players")
        .update({ pin_salt: salt, pin_hash: hash, pin_failures: 0, pin_locked_until: null })
        .eq("id", body.playerId)
        .select("id")
        .maybeSingle();
      if (error) return fail(error.message, 500);
      if (!data) return fail("Pemain tidak ditemukan.", 404);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ mulai pelajaran
    if (action === "session_start") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      // Latihan dari materi: pelajaran, topik, tingkat, dan kelas diambil dari materinya; jumlah soal tetap PRACTICE_QUESTIONS.
      let material: Row | null = null;
      if (body.materialId !== undefined && body.materialId !== null && body.materialId !== "") {
        if (!isUuid(body.materialId)) return fail("Materi tidak valid.");
        const { data: m, error: me } = await admin.from("study_materials").select("*").eq("id", body.materialId).maybeSingle();
        if (me) return fail(me.message, 500);
        if (!m) return fail("Materi itu tidak ditemukan.", 404);
        material = m;
      }
      const subject = material ? cleanLine(material.subject, 60) : cleanLine(body.subject, 60);
      const topic = material ? cleanLine(material.title, 100) : cleanLine(body.topic, 100);
      const materialGrade: unknown = material ? material.grade : body.materialGrade;
      if (!subject) return fail("Pilih atau ketik mata pelajaran.");
      if (typeof materialGrade !== "string" || !isMaterialGradeAllowed(p.grade, materialGrade)) {
        return fail("Tingkat materi tidak boleh lebih rendah dari grade pemain.");
      }
      const materialClass = classOf(material ? material.class_level : body.materialClass);
      if (!material && classesOf(materialGrade).length > 0 && materialClass === null) return fail("Pilih kelasnya.");
      if (!isLevelAllowed(p.grade, p.class_level, materialGrade, materialClass)) {
        return fail("Kelas materi tidak boleh lebih rendah dari kelas pemain.");
      }
      if (typeof body.level !== "string" || !LEVELS.includes(body.level)) return fail("Level tidak valid.");
      if (!material && !validCount(body.count)) return fail(`Jumlah soal harus 1-${MAX_QUESTIONS}.`);
      const count = material ? PRACTICE_QUESTIONS : (body.count as number);

      const { count: active } = await admin.from("study_sessions").select("id", { count: "exact", head: true }).eq("player_id", p.id).eq("status", "active");
      if ((active ?? 0) >= MAX_ACTIVE_SESSIONS) {
        return fail(`Ada ${active} pelajaran yang belum selesai. Selesaikan atau batalkan dulu sebelum membuat yang baru.`, 429, { tooManyActive: true });
      }

      const slot = await takeGenerationSlot(admin, p.id, "lesson");
      if (slot) return slot;
      const engine = parseEngine(body.engine);
      wireReporters(admin);
      const made = await makeQuestions(
        admin,
        { subject, topic: topic || undefined, grade: materialGrade, classLevel: materialClass, level: body.level, count, source: material ? practiceSource(material.content) : undefined },
        engine
      );
      const minOk = Math.max(1, Math.ceil(count * 0.8));
      if (made.questions.length < minOk) {
        return fail(`Gagal membuat soal (${made.questions.length} dari ${count} yang layak). ${made.lastError}`.trim(), 502, { generationFailed: true });
      }

      // timer: jumlah soal x detik per soal (0 = tanpa timer); batas dihitung dari created_at di sisi server
      const cfg = await loadSettings(admin);
      const spq = Number(cfg?.seconds_per_question ?? 0);
      const timeLimit = spq > 0 ? made.questions.length * spq : null;
      const { data: s, error: e1 } = await admin
        .from("study_sessions")
        .insert({ player_id: p.id, subject, topic: topic || null, material_grade: materialGrade, material_class: materialClass, level: body.level, num_questions: made.questions.length, provider: made.provider, time_limit_seconds: timeLimit, material_id: material?.id ?? null, material_title: material ? material.title : null })
        .select("*")
        .single();
      if (e1 || !s) return fail(e1?.message || "Gagal menyimpan pelajaran.", 500);
      const { error: e2 } = await admin.from("study_questions").insert(
        made.questions.map((q, i) => ({ session_id: s.id, idx: i, question: q.question, options: q.options, correct_index: q.correctIndex }))
      );
      if (e2) {
        await admin.from("study_sessions").delete().eq("id", s.id);
        return fail(e2.message, 500);
      }
      return json({
        ok: true,
        sessionId: s.id,
        session: sessionRow(s),
        questions: made.questions.map((q, i) => ({ idx: i, question: q.question, options: q.options })),
        provider: made.provider,
        requested: count,
        shortfall: count - made.questions.length
      });
    }

    // ------------------------------------------------------------ lanjutkan / lihat pelajaran
    if (action === "session_get") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const owned = await loadOwnedSession(admin, body.sessionId, auth.player.id);
      if (owned instanceof Response) return owned;
      const s = owned.session;
      if (s.status === "submitted") return json({ ok: true, status: "submitted", result: await loadResult(admin, s, auth.player) });
      const { data: qs } = await admin.from("study_questions").select("idx,question,options").eq("session_id", s.id).order("idx", { ascending: true });
      return json({ ok: true, status: "active", session: sessionRow(s), questions: qs ?? [] });
    }

    // ------------------------------------------------------------ kumpulkan
    if (action === "session_submit") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const owned = await loadOwnedSession(admin, body.sessionId, auth.player.id);
      if (owned instanceof Response) return owned;
      if (!Array.isArray(body.answers)) return fail("Jawaban tidak valid.");
      const { error } = await admin.rpc("study_submit_session", { p_session: owned.session.id, p_answers: body.answers });
      if (error) return fail(error.message, 500);
      wireReporters(admin);
      const { data: fresh } = await admin.from("study_sessions").select("*").eq("id", owned.session.id).single();
      const missing = await explainQuestions(admin, fresh ?? owned.session, parseEngine(body.engine));
      return json({ ok: true, explainFailed: missing > 0, result: await loadResult(admin, fresh ?? owned.session, auth.player) });
    }

    if (action === "session_explain") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const owned = await loadOwnedSession(admin, body.sessionId, auth.player.id);
      if (owned instanceof Response) return owned;
      if (owned.session.status !== "submitted") return fail("Pelajaran belum dikumpulkan.", 409);
      wireReporters(admin);
      const missing = await explainQuestions(admin, owned.session, parseEngine(body.engine));
      return json({ ok: true, explainFailed: missing > 0, result: await loadResult(admin, owned.session, auth.player) });
    }

    if (action === "session_cancel") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const owned = await loadOwnedSession(admin, body.sessionId, auth.player.id);
      if (owned instanceof Response) return owned;
      if (owned.session.status !== "active") return fail("Hanya pelajaran yang belum dikumpulkan yang bisa dibatalkan.", 409);
      await admin.from("study_sessions").delete().eq("id", owned.session.id);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ redeem
    if (action === "redeem") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      if (!isUuid(body.itemId)) return fail("Hadiah tidak valid.");
      const { data, error } = await admin.rpc("study_redeem", { p_player: auth.player.id, p_item: body.itemId });
      if (error) {
        if (/SALDO_KURANG/.test(error.message)) return fail("Poin belum cukup untuk hadiah ini.", 409, { insufficient: true });
        if (/HADIAH_TIDAK_ADA/.test(error.message)) return fail("Hadiah sudah tidak tersedia.", 404);
        return fail(error.message, 500);
      }
      return json({ ok: true, redemption: data });
    }

    // ------------------------------------------------------------ area orang tua
    if (action === "settings_open") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      const [items, pending, players] = await Promise.all([
        loadItems(admin),
        admin.from("study_redemptions").select("id,player_id,item_name,cost,created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(200),
        admin.from("study_players").select("id,name,grade,class_level").order("name", { ascending: true })
      ]);
      const names = new Map<string, string>((players.data ?? []).map((x: Row) => [x.id, x.name]));
      return json({
        ok: true,
        settings: publicSettings(par.settings, items),
        pendingRedemptions: (pending.data ?? []).map((r: Row) => ({ id: r.id, playerName: names.get(r.player_id) ?? "?", itemName: r.item_name, cost: r.cost, createdAt: r.created_at })),
        players: (players.data ?? []).map((x: Row) => ({ id: x.id, name: x.name, grade: x.grade, classLevel: x.class_level ?? null }))
      });
    }

    if (action === "settings_save") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      const parsed = readSettingsInput(body);
      if (!parsed.ok) return fail(parsed.error);
      const { error } = await admin.from("study_settings").update(parsed.value).eq("id", 1);
      if (error) return fail(error.message, 500);
      const [s, items] = await Promise.all([loadSettings(admin), loadItems(admin)]);
      return json({ ok: true, settings: publicSettings(s as Row, items) });
    }

    if (action === "redeem_item_save") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      const name = cleanLine(body.name, 80);
      const cost = body.cost;
      if (!name) return fail("Nama hadiah wajib diisi.");
      if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1 || cost > 10_000_000) return fail("Poin hadiah harus bilangan bulat positif.");
      if (body.id !== undefined && body.id !== null && body.id !== "") {
        if (!isUuid(body.id)) return fail("Hadiah tidak valid.");
        const { error } = await admin.from("study_redeem_items").update({ name, cost }).eq("id", body.id);
        if (error) return fail(error.message, 500);
      } else {
        const { data: last } = await admin.from("study_redeem_items").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
        const { error } = await admin.from("study_redeem_items").insert({ name, cost, sort: (last?.sort ?? 0) + 1 });
        if (error) return fail(error.message, 500);
      }
      return json({ ok: true, items: await loadItems(admin) });
    }

    if (action === "redeem_item_delete") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      if (!isUuid(body.id)) return fail("Hadiah tidak valid.");
      const { error } = await admin.from("study_redeem_items").delete().eq("id", body.id);
      if (error) return fail(error.message, 500);
      return json({ ok: true, items: await loadItems(admin) });
    }

    if (action === "redeem_mark") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      if (!isUuid(body.redemptionId)) return fail("Penukaran tidak valid.");
      if (body.status !== "given" && body.status !== "pending") return fail("Status tidak valid.");
      const { data, error } = await admin
        .from("study_redemptions")
        .update({ status: body.status, given_at: body.status === "given" ? new Date().toISOString() : null })
        .eq("id", body.redemptionId)
        .select("id")
        .maybeSingle();
      if (error) return fail(error.message, 500);
      if (!data) return fail("Penukaran tidak ditemukan.", 404);
      return json({ ok: true });
    }

    if (action === "penalty") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      if (!isUuid(body.playerId)) return fail("Pemain tidak valid.");
      const points = body.points;
      if (typeof points !== "number" || !Number.isInteger(points) || points < 1 || points > 10_000_000) return fail("Poin hukuman harus bilangan bulat positif.");
      const reason = cleanLine(body.reason, 200);
      if (!reason) return fail("Alasan hukuman wajib diisi.");
      const { data, error } = await admin.rpc("study_apply_penalty", { p_player: body.playerId, p_points: points, p_reason: reason });
      if (error) return fail(/PEMAIN_TIDAK_ADA/.test(error.message) ? "Pemain tidak ditemukan." : error.message, /PEMAIN_TIDAK_ADA/.test(error.message) ? 404 : 500);
      return json({ ok: true, ...(data as Row) });
    }

    if (action === "parent_pin_set") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      if (!validPin(body.newPin)) return fail("PIN baru harus 4-6 angka.");
      const { salt, hash } = await hashPin(body.newPin as string);
      const { error } = await admin
        .from("study_settings")
        .update({ parent_pin_salt: salt, parent_pin_hash: hash, parent_pin_failures: 0, parent_pin_locked_until: null, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) return fail(error.message, 500);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ timeline: masuk sebagai penonton
    if (action === "player_verify") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      return json({ ok: true, player: { id: auth.player.id, name: auth.player.name, grade: auth.player.grade, classLevel: auth.player.class_level ?? null } });
    }

    // ------------------------------------------------------------ timeline global / per pemain
    if (action === "feed") {
      let owner: string | null = null;
      if (body.ownerId !== undefined && body.ownerId !== null && body.ownerId !== "") {
        if (!isUuid(body.ownerId)) return fail("Pemain tidak valid.");
        owner = body.ownerId;
      }
      let viewerId: string | null = null;
      if (body.viewerId !== undefined && body.viewerId !== null && body.viewerId !== "") {
        const v = await checkPlayerPin(admin, body.viewerId, body.viewerPin);
        if (v instanceof Response) return v;
        viewerId = v.player.id;
      }
      let kinds: string[] | null = null;
      if (Array.isArray(body.kinds)) {
        kinds = body.kinds.filter((k: unknown) => typeof k === "string" && FEED_KINDS.includes(k)) as string[];
        if (kinds.length === 0) return fail("Jenis kegiatan tidak valid.");
      }
      let before: string | null = null;
      if (typeof body.before === "string" && body.before) {
        // dipakai apa adanya (presisi mikrodetik dari database), asal bentuknya tanggal-waktu ISO yang wajar
        if (body.before.length > 40 || !ISO_CURSOR_RE.test(body.before) || Number.isNaN(new Date(body.before).getTime())) {
          return fail("Kursor halaman tidak valid.");
        }
        before = body.before;
      }
      await admin.rpc("study_room_sweep"); // kompetisi yang waktunya habis ikut tampil
      const { data, error } = await admin.rpc("study_feed", { p_owner: owner, p_viewer: viewerId, p_kinds: kinds, p_limit: TIMELINE_PAGE + 1, p_before: before });
      if (error) return fail(error.message, 500);
      const all = (data ?? []) as Row[];
      return json({ ok: true, items: all.slice(0, TIMELINE_PAGE).map(feedItem), hasMore: all.length > TIMELINE_PAGE });
    }

    // ------------------------------------------------------------ profil publik (tanpa PIN): hanya prestasi, bukan saldo
    if (action === "player_public") {
      if (!isUuid(body.playerId)) return fail("Pemain tidak valid.");
      await admin.rpc("study_room_sweep");
      const { data: p } = await admin.from("study_players").select("id,name,grade,class_level").eq("id", body.playerId).maybeSingle();
      if (!p) return fail("Pemain tidak ditemukan.", 404);
      const { data: stats, error } = await admin.rpc("study_player_stats", { p_player: p.id });
      if (error) return fail(error.message, 500);
      return json({ ok: true, player: { id: p.id, name: p.name, grade: p.grade, classLevel: p.class_level ?? null }, stats });
    }

    // ------------------------------------------------------------ suka / batal suka
    if (action === "like_toggle") {
      const v = await checkPlayerPin(admin, body.viewerId, body.viewerPin);
      if (v instanceof Response) return v;
      const t = readTarget(body);
      if (!t) return fail("Kegiatan tidak valid.");
      const { data, error } = await admin.rpc("study_post_like", { p_kind: t.kind, p_id: t.id, p_player: v.player.id });
      if (error) return socialError(error.message) ?? fail(error.message, 500);
      return json({ ok: true, ...(data as Row) });
    }

    // ------------------------------------------------------------ komentar
    if (action === "comment_list") {
      const t = readTarget(body);
      if (!t) return fail("Kegiatan tidak valid.");
      if (!(await targetVisible(admin, t))) return fail("Kegiatan itu tidak ditemukan.", 404);
      const { data: cs, error } = await admin.from("study_comments").select("id,player_id,body,created_at").eq(KIND_COL[t.kind], t.id).order("created_at", { ascending: true }).limit(200);
      if (error) return fail(error.message, 500);
      const ids = [...new Set((cs ?? []).map((c: Row) => c.player_id))];
      const { data: ps } = ids.length ? await admin.from("study_players").select("id,name,grade,class_level").in("id", ids) : { data: [] as Row[] };
      const byId = new Map<string, Row>((ps ?? []).map((p: Row) => [p.id as string, p] as [string, Row]));
      return json({
        ok: true,
        comments: (cs ?? []).map((c: Row) => ({
          id: c.id,
          playerId: c.player_id,
          name: byId.get(c.player_id)?.name ?? "?",
          grade: byId.get(c.player_id)?.grade ?? "",
          classLevel: byId.get(c.player_id)?.class_level ?? null,
          body: c.body,
          createdAt: c.created_at
        }))
      });
    }

    if (action === "comment_add") {
      const v = await checkPlayerPin(admin, body.viewerId, body.viewerPin);
      if (v instanceof Response) return v;
      const t = readTarget(body);
      if (!t) return fail("Kegiatan tidak valid.");
      const text = cleanLine(body.body, COMMENT_MAX + 1);
      if (!text || text.length > COMMENT_MAX) return fail(`Komentar harus 1-${COMMENT_MAX} karakter.`);
      const { data, error } = await admin.rpc("study_post_comment", { p_kind: t.kind, p_id: t.id, p_player: v.player.id, p_body: text });
      if (error) return socialError(error.message) ?? fail(error.message, 500);
      const r = data as Row;
      return json({
        ok: true,
        count: r.count,
        comment: { id: r.id, playerId: r.playerId, name: v.player.name, grade: v.player.grade, classLevel: v.player.class_level ?? null, body: r.body, createdAt: r.createdAt }
      });
    }

    if (action === "comment_delete") {
      if (!isUuid(body.commentId)) return fail("Komentar tidak valid.");
      const { data: c } = await admin.from("study_comments").select("id,session_id,room_id,material_id,player_id").eq("id", body.commentId).maybeSingle();
      if (!c) return fail("Komentar tidak ditemukan.", 404);
      if (body.viewerId) {
        // penulisnya sendiri (PIN pemain)
        const v = await checkPlayerPin(admin, body.viewerId, body.viewerPin);
        if (v instanceof Response) return v;
        if (v.player.id !== c.player_id) return fail("Hanya penulis komentar yang bisa menghapusnya.", 403);
      } else {
        // orang tua: wajib PIN orang tua yang SUDAH dibuat (tidak terbuka bagi semua orang)
        const settings = await loadSettings(admin);
        if (!settings?.parent_pin_hash) return fail("PIN orang tua belum dibuat. Buat dulu di Setting.", 403);
        const par = await checkParentPin(admin, body.parentPin);
        if (par instanceof Response) return par;
      }
      const { error } = await admin.from("study_comments").delete().eq("id", c.id);
      if (error) return fail(error.message, 500);
      const col = c.session_id ? "session_id" : c.room_id ? "room_id" : "material_id";
      const { count } = await admin.from("study_comments").select("id", { count: "exact", head: true }).eq(col, c.session_id ?? c.room_id ?? c.material_id);
      return json({ ok: true, count: count ?? 0 });
    }

    // ------------------------------------------------------------ detil kegiatan (soal + pembahasan)
    if (action === "result_detail") {
      const v = await checkPlayerPin(admin, body.viewerId, body.viewerPin);
      if (v instanceof Response) return v;
      const ss = await loadSubmittedSession(admin, body.sessionId);
      if (ss instanceof Response) return ss;
      const { data: owner } = await admin.from("study_players").select("id,name,grade,class_level").eq("id", ss.session.player_id).maybeSingle();
      if (!owner) return fail("Pemain tidak ditemukan.", 404);
      return json({ ok: true, result: await loadResult(admin, ss.session, owner) });
    }

    // ------------------------------------------------------------ materi: daftar (tanpa PIN)
    if (action === "material_list") {
      let before: string | null = null;
      if (typeof body.before === "string" && body.before) {
        if (body.before.length > 40 || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(body.before) || Number.isNaN(new Date(body.before).getTime())) {
          return fail("Kursor halaman tidak valid.");
        }
        before = body.before;
      }
      let q = admin.from("study_materials").select("id,title,subject,grade,class_level,detail,creator_name,created_at").order("created_at", { ascending: false }).limit(MATERIAL_PAGE + 1);
      if (before) q = q.lt("created_at", before);
      const { data, error } = await q;
      if (error) return fail(error.message, 500);
      const rows = (data ?? []) as Row[];
      return json({ ok: true, items: rows.slice(0, MATERIAL_PAGE).map((m) => materialRow(m)), hasMore: rows.length > MATERIAL_PAGE });
    }

    // ------------------------------------------------------------ materi: isi (tanpa PIN)
    if (action === "material_get") {
      if (!isUuid(body.materialId)) return fail("Materi tidak valid.");
      const { data: m, error } = await admin.from("study_materials").select("*").eq("id", body.materialId).maybeSingle();
      if (error) return fail(error.message, 500);
      if (!m) return fail("Materi itu tidak ditemukan.", 404);
      return json({ ok: true, material: materialRow(m, true) });
    }

    // ------------------------------------------------------------ materi: buat (PIN pemain)
    if (action === "material_create") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      const subject = cleanLine(body.subject, 60);
      const detail = cleanLine(body.detail, MATERIAL_DETAIL_MAX + 1);
      if (!subject) return fail("Pilih atau ketik mata pelajaran.");
      if (typeof body.grade !== "string" || !GRADES.includes(body.grade)) return fail("Grade tidak valid.");
      const cls = classOf(body.classLevel);
      if (classesOf(body.grade).length > 0 && cls === null) return fail("Pilih kelasnya.");
      if (!validClass(body.grade, cls)) return fail("Kelas tidak sesuai dengan grade.");
      if (detail.length < 3) return fail("Tulis detail materi yang diinginkan (minimal 3 karakter).");
      if (detail.length > MATERIAL_DETAIL_MAX) return fail(`Detail materi maksimal ${MATERIAL_DETAIL_MAX} karakter.`);

      const slot = await takeGenerationSlot(admin, p.id, "material");
      if (slot) return slot;
      const engine = parseEngine(body.engine);
      wireReporters(admin);
      const keys = getGeminiApiKeys();
      const prompt = buildMaterialPrompt({ subject, grade: body.grade, classLevel: cls, detail });
      let made: { title: string; content: string } | null = null;
      let provider = "gemini";
      let lastError = "";
      let tokens = 0;
      let cost = 0;
      for (let attempt = 0; attempt < MATERIAL_PER_PLAYER_ATTEMPTS && !made; attempt++) {
        try {
          const r = await generateJsonText(prompt.system, prompt.user, keys, { temperature: 0.6, engine, plain: true });
          tokens += r.tokensUsed;
          cost += r.costUsd;
          if (r.provider) provider = r.provider;
          made = cleanMaterial(r.text, `${subject}: ${detail}`);
          if (!made) lastError = "AI mengembalikan materi yang terlalu pendek atau tidak bisa dipakai.";
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.error("study material_create:", lastError);
        }
      }
      await recordTokens(admin, tokens, cost);
      if (!made) return fail(`Gagal membuat materi. ${lastError}`.trim(), 502, { generationFailed: true });
      const { data: m, error } = await admin
        .from("study_materials")
        .insert({ creator_id: p.id, creator_name: p.name, subject, grade: body.grade, class_level: cls, detail, title: made.title, content: made.content, provider })
        .select("*")
        .single();
      if (error || !m) return fail(error?.message || "Gagal menyimpan materi.", 500);
      return json({ ok: true, material: materialRow(m, true) });
    }

    // ------------------------------------------------------------ materi: hapus (pembuat dengan PIN / orang tua)
    if (action === "material_delete") {
      if (!isUuid(body.materialId)) return fail("Materi tidak valid.");
      const { data: m } = await admin.from("study_materials").select("id,creator_id").eq("id", body.materialId).maybeSingle();
      if (!m) return fail("Materi itu tidak ditemukan.", 404);
      if (body.playerId) {
        const v = await checkPlayerPin(admin, body.playerId, body.pin);
        if (v instanceof Response) return v;
        if (v.player.id !== m.creator_id) return fail("Hanya pembuat materi yang bisa menghapusnya.", 403);
      } else {
        const settings = await loadSettings(admin);
        if (!settings?.parent_pin_hash) return fail("PIN orang tua belum dibuat. Buat dulu di Setting.", 403);
        const par = await checkParentPin(admin, body.parentPin);
        if (par instanceof Response) return par;
      }
      const { error } = await admin.from("study_materials").delete().eq("id", m.id);
      if (error) return fail(error.message, 500);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ kompetisi: daftar room terbuka (tanpa PIN)
    if (action === "room_list") {
      await admin.rpc("study_room_sweep");
      const { data: rooms, error } = await admin.from("study_rooms").select("*").in("status", ["lobby", "running"]).order("created_at", { ascending: false }).limit(ROOM_LIST_MAX);
      if (error) return fail(error.message, 500);
      const ids = (rooms ?? []).map((r: Row) => r.id);
      const { data: rps } = ids.length ? await admin.from("study_room_players").select("room_id,player_id").in("room_id", ids) : { data: [] as Row[] };
      const pids = [...new Set((rps ?? []).map((x: Row) => x.player_id))];
      const { data: ps } = pids.length ? await admin.from("study_players").select("id,name").in("id", pids) : { data: [] as Row[] };
      const nameOf = new Map<string, string>((ps ?? []).map((p: Row) => [p.id as string, p.name as string] as [string, string]));
      return json({
        ok: true,
        rooms: (rooms ?? []).map((r: Row) => {
          const mine = (rps ?? []).filter((x: Row) => x.room_id === r.id);
          return { ...roomRow(r, mine.length), playerNames: mine.map((x: Row) => nameOf.get(x.player_id) ?? "?") };
        })
      });
    }

    // ------------------------------------------------------------ kompetisi: buat room
    if (action === "room_create") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      const subject = cleanLine(body.subject, 60);
      const topic = cleanLine(body.topic, 100);
      if (!subject) return fail("Pilih atau ketik mata pelajaran.");
      if (typeof body.materialGrade !== "string" || !isMaterialGradeAllowed(p.grade, body.materialGrade)) {
        return fail("Tingkat materi tidak boleh lebih rendah dari grade pemain.");
      }
      const materialClass = classOf(body.materialClass);
      if (classesOf(body.materialGrade).length > 0 && materialClass === null) return fail("Pilih kelasnya.");
      if (!isLevelAllowed(p.grade, p.class_level, body.materialGrade, materialClass)) {
        return fail("Kelas materi tidak boleh lebih rendah dari kelas pemain.");
      }
      if (typeof body.level !== "string" || !LEVELS.includes(body.level)) return fail("Level tidak valid.");
      if (!validCount(body.count)) return fail(`Jumlah soal harus 1-${MAX_QUESTIONS}.`);
      const count = body.count as number;
      const minutes = body.minutes;
      if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > ROOM_MAX_MINUTES) {
        return fail(`Waktu harus 1-${ROOM_MAX_MINUTES} menit.`);
      }
      await admin.rpc("study_room_sweep");
      const { data: already } = await admin.rpc("study_active_room", { p_player: p.id });
      if (already) return roomError("SUDAH_DI_ROOM") as Response;

      const slot = await takeGenerationSlot(admin, p.id, "lesson");
      if (slot) return slot;
      const engine = parseEngine(body.engine);
      wireReporters(admin);
      const made = await makeQuestions(admin, { subject, topic: topic || undefined, grade: body.materialGrade, classLevel: materialClass, level: body.level, count }, engine);
      const minOk = Math.max(1, Math.ceil(count * 0.8));
      if (made.questions.length < minOk) {
        return fail(`Gagal membuat soal (${made.questions.length} dari ${count} yang layak). ${made.lastError}`.trim(), 502, { generationFailed: true });
      }
      const { data: rid, error } = await admin.rpc("study_room_create", {
        p_creator: p.id,
        p_meta: { subject, topic, materialGrade: body.materialGrade, materialClass, level: body.level, timeLimitSeconds: minutes * 60, provider: made.provider },
        p_questions: made.questions.map((q) => ({ question: q.question, options: q.options, correctIndex: q.correctIndex }))
      });
      if (error) return roomError(error.message) ?? fail(error.message, 500);
      const room = await loadRoom(admin, rid);
      if (!room) return fail("Room gagal dibuat.", 500);
      return json({ ok: true, state: await roomState(admin, room, p.id) });
    }

    // ------------------------------------------------------------ kompetisi: bergabung / keluar / mulai / keadaan / kumpulkan
    if (["room_join", "room_leave", "room_start", "room_state", "room_submit"].includes(action)) {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      if (!isUuid(body.roomId)) return fail("Room tidak valid.");
      const roomId = body.roomId;
      if (action === "room_join") {
        const { error } = await admin.rpc("study_room_join", { p_room: roomId, p_player: p.id });
        if (error) return roomError(error.message) ?? fail(error.message, 500);
      } else if (action === "room_leave") {
        const { data, error } = await admin.rpc("study_room_leave", { p_room: roomId, p_player: p.id });
        if (error) return roomError(error.message) ?? fail(error.message, 500);
        return json({ ok: true, cancelled: !!(data as Row)?.cancelled });
      } else if (action === "room_start") {
        const { error } = await admin.rpc("study_room_start", { p_room: roomId, p_player: p.id });
        if (error) return roomError(error.message) ?? fail(error.message, 500);
      } else if (action === "room_submit") {
        if (!Array.isArray(body.answers)) return fail("Jawaban tidak valid.");
        const { error } = await admin.rpc("study_room_submit", { p_room: roomId, p_player: p.id, p_answers: body.answers });
        if (error) return roomError(error.message) ?? fail(error.message, 500);
      }
      const room = await loadRoom(admin, roomId);
      if (!room) return fail("Room itu tidak ditemukan (mungkin sudah dibatalkan).", 404);
      return json({ ok: true, state: await roomState(admin, room, p.id) });
    }

    // ------------------------------------------------------------ kompetisi: tabel hasil (publik)
    if (action === "room_result") {
      const room = await loadRoom(admin, body.roomId);
      if (!room || room.status !== "finished") return fail("Hasil kompetisi itu tidak ditemukan.", 404);
      const results = await roomResults(admin, room);
      return json({ ok: true, room: roomRow(room, results.length), results });
    }

    return fail("action tidak dikenal.", 400);
  } catch (err) {
    console.error("study:", err instanceof Error ? err.stack || err.message : String(err));
    return fail(err instanceof Error ? err.message : "Terjadi kesalahan di server.", 500);
  }
});

