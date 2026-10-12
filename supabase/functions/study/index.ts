// Edge Function untuk menu "Study" (latihan soal pilihan ganda buatan AI, poin, redeem, hukuman).
//
// Seperti `chat`, semua request wajib membawa kode akses (CHAT_ACCESS_CODE) -- tabel study_* dikunci total
// dari anon key (lihat migrations/0023_study.sql). Di atas kode akses ada dua lapis PIN:
//   - PIN pemain  : membuka profil/saldo, memulai & mengumpulkan pelajaran, redeem. Disimpan sebagai hash
//                   PBKDF2 + salt; salah 5 kali = terkunci 5 menit.
//   - PIN orang tua: untuk reset PIN pemain, hukuman poin, setting, hadiah, dan menandai hadiah "sudah diberikan".
//                   Belum diatur = aksi-aksi itu terbuka (aplikasi menyarankan membuatnya).
// KUNCI JAWABAN tidak pernah dikirim ke klien sebelum pelajaran dikumpulkan. Poin dihitung di database
// (fungsi study_submit_session), BUKAN oleh AI; AI hanya membuat soal dan menulis pembahasan.
//
// Body request (semua: { "code": "...", "action": "...", ... }); respons selalu { ok: boolean, ... }:
//   overview            -> { players: [{id,name,grade,sessionsDone,totalPoints,balance}], settings, grades }
//   player_create       { name, grade, pin }                                 -> { player }
//   player_profile      { playerId, pin }                                    -> { player, balance, totalEarned, sessions, redemptions, penalties, allowedGrades }
//   pin_reset           { playerId, newPin, parentPin? }                     -> { ok }
//   session_start       { playerId, pin, subject, topic?, materialGrade, level, count, engine? }
//                                                                            -> { sessionId, questions:[{idx,question,options}], provider, requested, shortfall }
//   session_get         { playerId, pin, sessionId }                         -> { status, questions } | { status:"submitted", result }
//   session_submit      { playerId, pin, sessionId, answers:[0..3|null], engine? } -> { result, explainFailed }
//   session_explain     { playerId, pin, sessionId, engine? }                -> { result, explainFailed }   (ulangi pembahasan yang gagal)
//   session_cancel      { playerId, pin, sessionId }                         -> { ok }   (hanya sesi yang belum dikumpulkan)
//   redeem              { playerId, pin, itemId }                            -> { redemption }
//   settings_open       { parentPin? }                                       -> { settings, pendingRedemptions, players }
//   settings_save       { parentPin?, basePoints, weights:{easy,normal,hard}, subjects:[...] } -> { settings }
//   redeem_item_save    { parentPin?, id?, name, cost }                      -> { items }
//   redeem_item_delete  { parentPin?, id }                                   -> { items }
//   redeem_mark         { parentPin?, redemptionId, status:"given"|"pending" } -> { ok }
//   penalty             { parentPin?, playerId, points, reason }             -> { requested, applied, balance }
//   parent_pin_set      { newPin, parentPin? }                               -> { ok }

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
  buildExplainPrompt,
  buildQuestionPrompt,
  cleanLine,
  hashPin,
  isMaterialGradeAllowed,
  lockSecondsLeft,
  parseExplanations,
  parseQuestions,
  validCount,
  validPin,
  verifyPin
} from "../_shared/study-core.ts";
import type { ParsedQuestion } from "../_shared/study-core.ts";

type Admin = ReturnType<typeof createClient>;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

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
  basePoints: s.base_points,
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

const sessionRow = (s: Row) => ({
  id: s.id,
  subject: s.subject,
  topic: s.topic,
  materialGrade: s.material_grade,
  level: s.level,
  numQuestions: s.num_questions,
  status: s.status,
  correctCount: s.correct_count,
  pointsAwarded: s.points_awarded,
  weightPercent: s.weight_percent,
  provider: s.provider,
  createdAt: s.created_at,
  submittedAt: s.submitted_at
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
    player: { id: player.id, name: player.name, grade: player.grade },
    total: items.length,
    correct: session.correct_count ?? 0,
    basePoints: session.base_points,
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
  spec: { subject: string; topic?: string; grade: string; level: string; count: number },
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
      const p = buildExplainPrompt(session.subject, session.material_grade, items);
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
  const base = int(body.basePoints, 1, 100000);
  const w = (body.weights ?? {}) as Row;
  const easy = int(w.easy, 1, 1000);
  const normal = int(w.normal, 1, 1000);
  const hard = int(w.hard, 1, 1000);
  if (base === null) return { ok: false, error: "Poin dasar harus bilangan bulat 1-100000." };
  if (easy === null || normal === null || hard === null) return { ok: false, error: "Bobot level harus bilangan bulat 1-1000 (persen)." };
  const rawSubjects = Array.isArray(body.subjects) ? body.subjects : [];
  const subjects: string[] = [];
  for (const s of rawSubjects) {
    const name = cleanLine(s, 40);
    if (name && !subjects.some((x) => x.toLowerCase() === name.toLowerCase())) subjects.push(name);
  }
  if (subjects.length === 0 || subjects.length > 30) return { ok: false, error: "Daftar pelajaran harus berisi 1-30 nama." };
  return { ok: true, value: { base_points: base, weight_easy: easy, weight_normal: normal, weight_hard: hard, subjects, updated_at: new Date().toISOString() } };
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

  const expectedCode = Deno.env.get("CHAT_ACCESS_CODE");
  if (!expectedCode) return fail("CHAT_ACCESS_CODE belum di-set sebagai Supabase secret.", 500);
  if (typeof body.code !== "string" || body.code !== expectedCode) return fail("Kode akses salah.", 401);

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
        players: (board ?? []).map((p: Row) => ({ id: p.id, name: p.name, grade: p.grade, sessionsDone: p.sessions_done, totalPoints: p.total_points, balance: p.balance })),
        settings: publicSettings(settings, items),
        grades: GRADES
      });
    }

    // ------------------------------------------------------------ pemain baru
    if (action === "player_create") {
      const name = cleanLine(body.name, 30);
      if (!name) return fail("Nama wajib diisi.");
      if (typeof body.grade !== "string" || !GRADES.includes(body.grade)) return fail("Grade tidak valid.");
      if (!validPin(body.pin)) return fail("PIN harus 4-6 angka.");
      const { salt, hash } = await hashPin(body.pin as string);
      const { data, error } = await admin.from("study_players").insert({ name, grade: body.grade, pin_salt: salt, pin_hash: hash }).select("id,name,grade").single();
      if (error) return error.code === "23505" ? fail("Nama itu sudah dipakai pemain lain.", 409) : fail(error.message, 500);
      return json({ ok: true, player: data });
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
        admin.from("study_ledger").select("kind,points,note,meta,created_at").eq("player_id", p.id).in("kind", ["session", "penalty"]).order("created_at", { ascending: false }).limit(300),
        loadItems(admin)
      ]);
      const ledgerRows = (ledger.data ?? []) as Row[];
      const totalEarned = ledgerRows.filter((l) => l.kind === "session").reduce((a, l) => a + l.points, 0);
      return json({
        ok: true,
        player: { id: p.id, name: p.name, grade: p.grade },
        balance: bal.data ?? 0,
        totalEarned,
        sessions: (sessions.data ?? []).map(sessionRow),
        redemptions: (reds.data ?? []).map((r: Row) => ({ id: r.id, itemName: r.item_name, cost: r.cost, status: r.status, createdAt: r.created_at, givenAt: r.given_at })),
        penalties: ledgerRows.filter((l) => l.kind === "penalty").slice(0, 50).map((l) => ({ points: -l.points, requested: l.meta?.requested ?? -l.points, reason: l.note, createdAt: l.created_at })),
        redeemItems: items,
        allowedGrades: allowedMaterialGrades(p.grade)
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
      const subject = cleanLine(body.subject, 60);
      const topic = cleanLine(body.topic, 100);
      if (!subject) return fail("Pilih atau ketik mata pelajaran.");
      if (typeof body.materialGrade !== "string" || !isMaterialGradeAllowed(p.grade, body.materialGrade)) {
        return fail("Tingkat materi tidak boleh lebih rendah dari grade pemain.");
      }
      if (typeof body.level !== "string" || !LEVELS.includes(body.level)) return fail("Level tidak valid.");
      if (!validCount(body.count)) return fail(`Jumlah soal harus 1-${MAX_QUESTIONS}.`);
      const count = body.count as number;

      const { count: active } = await admin.from("study_sessions").select("id", { count: "exact", head: true }).eq("player_id", p.id).eq("status", "active");
      if ((active ?? 0) >= MAX_ACTIVE_SESSIONS) {
        return fail(`Ada ${active} pelajaran yang belum selesai. Selesaikan atau batalkan dulu sebelum membuat yang baru.`, 429, { tooManyActive: true });
      }

      const engine = parseEngine(body.engine);
      wireReporters(admin);
      const made = await makeQuestions(admin, { subject, topic: topic || undefined, grade: body.materialGrade, level: body.level, count }, engine);
      const minOk = Math.max(1, Math.ceil(count * 0.8));
      if (made.questions.length < minOk) {
        return fail(`Gagal membuat soal (${made.questions.length} dari ${count} yang layak). ${made.lastError}`.trim(), 502, { generationFailed: true });
      }

      const { data: s, error: e1 } = await admin
        .from("study_sessions")
        .insert({ player_id: p.id, subject, topic: topic || null, material_grade: body.materialGrade, level: body.level, num_questions: made.questions.length, provider: made.provider })
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
        admin.from("study_players").select("id,name,grade").order("name", { ascending: true })
      ]);
      const names = new Map<string, string>((players.data ?? []).map((x: Row) => [x.id, x.name]));
      return json({
        ok: true,
        settings: publicSettings(par.settings, items),
        pendingRedemptions: (pending.data ?? []).map((r: Row) => ({ id: r.id, playerName: names.get(r.player_id) ?? "?", itemName: r.item_name, cost: r.cost, createdAt: r.created_at })),
        players: (players.data ?? []).map((x: Row) => ({ id: x.id, name: x.name, grade: x.grade }))
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

    return fail("action tidak dikenal.", 400);
  } catch (err) {
    console.error("study:", err instanceof Error ? err.stack || err.message : String(err));
    return fail(err instanceof Error ? err.message : "Terjadi kesalahan di server.", 500);
  }
});

