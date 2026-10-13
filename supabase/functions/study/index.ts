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
//   overview            -> { players: [{id,name,grade,classLevel,sessionsDone,totalPoints,balance,todayPoints}], settings, grades }
//                         BATAS POIN HARIAN (migrasi 0032): settings.dailyPointsCap (0 = tanpa batas; null = migrasi belum dijalankan). Poin yang DIDAPAT
//                         (pelajaran, kompetisi, bonus pemenang) per hari (zona Asia/Jakarta) dipotong sampai batas; redeem/hukuman tidak membuka jatah lagi.
//                         todayPoints = poin didapat hari ini. Hasil pelajaran membawa rawPoints/capped; session_submit & player_profile membawa daily.
//   player_create       { name, grade, classLevel?, pin }                    -> { player }   (classLevel wajib untuk SD/SMP/SMA: SD 1-6, SMP 7-9, SMA 10-12)
//   player_update_level { playerId, pin, grade, classLevel?, parentPin? }    -> { player }   (naik kelas / ralat; PIN orang tua bila sudah dibuat)
//   player_profile      { playerId, pin }                                    -> { player, balance, totalEarned, daily, sessions, redemptions, penalties, allowedGrades }   (daily = dasbor poin hari ini, null bila migrasi 0032 belum ada)
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
//   ANTI-SPAM PENGULANGAN (migrasi 0033): mata pelajaran yang SAMA dikumpulkan lagi di hari yang sama (ke-2 dst) -> poin x settings.repeatSubjectPercent
//                         (bawaan 50; null = migrasi belum ada). session_start/session_get(aktif) membawa repeat:{count,percent} (percent 100 = tanpa pengurangan);
//                         hasil membawa repeatPercent; player_profile.daily.subjects = mata pelajaran yang sudah dikerjakan hari ini.
//   NOTIFIKASI suka & komentar (migrasi 0034), butuh PIN/token pemain:
//   notif_list          { playerId, pin }                                    -> { items:[{type:"like"|"comment",kind,targetId,title,actorId,actorName,body,at,unread}], unread }
//   notif_count         { playerId, pin }                                    -> { unread }
//   notif_seen          { playerId, pin, upTo? }                             -> { ok }   (tandai sudah dibaca sampai waktu upTo, bawaan sekarang)
//                         Sebelum migrasi 0034 ketiganya menjawab { ok:true, unavailable:true } (daftar kosong).
//   settings_save       { parentPin?, perQuestionPoints, perfectBonusPercent, secondsPerQuestion, competitionWinBonus, dailyPointsCap?, repeatSubjectPercent?, weights:{easy,normal,hard}, subjects:[...] } -> { settings }   (dailyPointsCap 0-1000000, 0 = tanpa batas; repeatSubjectPercent 0-100, 100 = tanpa pengurangan; dihilangkan = tidak diubah)
//   redeem_item_save    { parentPin?, id?, name, cost }                      -> { items }
//   redeem_item_delete  { parentPin?, id }                                   -> { items }
//   redeem_mark         { parentPin?, redemptionId, status:"given"|"pending" } -> { ok }
//   penalty             { parentPin?, playerId, points, reason }             -> { requested, applied, balance }
//   bonus_give          { parentPin?, playerIds:[uuid], points, name }       -> { given, points, name }   (EXTRA POIN dari orang tua, migrasi 0036: poin 1-1.000.000, nama maks 80 huruf, 1-100 pemain;
//                                                                              TIDAK dihitung ke batas poin harian, masuk saldo; semua pemain terpilih atau tidak sama sekali)
//   parent_pin_set      { newPin, parentPin? }                               -> { ok }
//   -- timeline (Facebook-like): lihat kegiatan pemain, suka, komentar, detil. Melihat timeline & komentar tidak perlu PIN;
//      suka/komentar/detil butuh PIN penonton (viewerId + viewerPin) dan tidak boleh pada kegiatan sendiri (suka/komentar).
//   player_avatar_set   { playerId, pin, image }                            -> { avatarUrl }   (foto profil: JPEG base64 <= 150 KB, sudah dipotong persegi di peramban; bucket publik study-avatars, migrasi 0031)
//   player_avatar_remove { playerId, pin }                                   -> { avatarUrl: null }
//   overview menyertakan players[].avatarUrl (null = belum punya foto).
//   player_verify       { playerId, pin }                                    -> { player }   (masuk sebagai penonton)
//   login               { playerId, pin }                                    -> { token, player }   (login perangkat: simpan token di perangkat; token berlaku sebagai pengganti PIN di semua aksi pemain)
//   logout              { playerId, token }                                  -> { ok }   (cabut token perangkat ini)
//   Token tidak valid -> 403 { pinWrong:true, tokenInvalid:true }. Reset PIN oleh orang tua mencabut semua token pemain itu.
//   feed                { ownerId?, kinds?, viewerId?, viewerPin?, before? } -> { items:[{kind:"lesson"|"competition"|"material", id, at, likeCount, commentCount, liked, ...}], hasMore }
//                         (tanpa ownerId = timeline global semua pemain; dengan ownerId = kegiatan satu pemain; kinds menyaring jenis)
//   player_public       { playerId }                                         -> { player:{id,name,grade,classLevel}, stats:{rank,totalPoints,soloPoints,competitionPoints,lessons,competitions,wins,materials}, today:{earned,cap,reached}|null }   (profil publik, tanpa PIN)
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
//   -- SPEAKING (migrasi 0035): mengobrol bahasa Inggris dengan tutor AI (suara/ketik di peramban). Tanpa poin. Riwayat disimpan 7 hari. Butuh PIN/token pemain.
//   speak_start         { playerId, pin, scenario, topic?, lang?, engine? }   -> { session, turns:[pembuka tutor] }   (scenario: free|intro|school|restaurant|shopping|travel|hobbies|interview|custom (+topic); lang "id"|"en" = bahasa tip koreksi)
//   speak_turn          { playerId, pin, sessionId, text, lang?, engine? }    -> { userTurn:{idx,body,correction,tip}, aiTurn:{idx,body}, userTurns, full, ended }   (maks 30 giliran/sesi, 80/hari/pemain; ended=true bila pemain berpamitan: tutor membalas salam & percakapan diakhiri otomatis)
//   speak_transcribe    { playerId, pin, sessionId, audio (base64 WAV 16-bit mono), mime:"audio/wav" } -> { text }   (suara -> teks: Groq Whisper dulu bila GROQ_API_KEYS ada, cadangan Gemini; teks kosong = tak ada ucapan jelas)
//   speak_tts           { playerId, pin, sessionId, idx }                     -> { audio (base64 WAV 24 kHz), mime }   (suara tutor natural lewat Gemini TTS; hanya giliran tutor tersimpan; galat = aplikasi memakai suara perangkat)
//   speak_end           { playerId, pin, sessionId }                          -> { ok }
//   speak_delete        { playerId, pin, sessionId }                          -> { ok }
//   speak_list          { playerId, pin }                                     -> { sessions:[{id,ownerId,ownerName,mine,scenario,topic,title,userTurns,createdAt,updatedAt,endedAt,expiresAt}], keepDays }
//   (RIWAYAT TERLIHAT OLEH SEMUA PEMAIN: speak_list/speak_get/speak_tts boleh untuk percakapan siapa pun; speak_turn/transcribe/end/delete hanya pemilik)
//   speak_get           { playerId, pin, sessionId }                          -> { session, turns:[{idx,role,body,correction,tip,at}] }
//                         overview.speak = false bila migrasi belum dijalankan; aksi speak_* lalu menjawab { ok:true, unavailable:true }.
//   -- materi pelajaran buatan AI (tab "Materi"); DAFTAR & ISI bisa dibaca semua orang tanpa PIN, membuat butuh PIN pemain
//   material_list       { before? }                                          -> { items:[{id,title,subject,grade,detail,creatorName,createdAt}], hasMore }
//   material_get        { materialId }                                       -> { material:{...,content} }
//   material_create     { playerId, pin, subject, grade, classLevel?, detail, engine? }   -> { material:{...,content} }
//   material_delete     { materialId, playerId?, pin? | parentPin }          -> { ok }   (pembuatnya dengan PIN, atau orang tua bila PIN-nya sudah dibuat)

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiApiKeys, generateJsonText, setGeminiKeyReporter, synthesizeSpeech, transcribeAudio } from "../_shared/gemini.ts";
import { getGroqSttKeys, transcribeWithGroq } from "../_shared/groq-stt.ts";
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
  hashDeviceToken,
  isDeviceToken,
  MAX_DEVICE_TOKENS,
  newDeviceToken,
  parseAvatarImage,
  PRACTICE_QUESTIONS,
  SPEAK_GLOBAL_DAY,
  SPEAK_KEEP_DAYS,
  SPEAK_MAX_ACTIVE,
  SPEAK_MAX_TURNS,
  SPEAK_PER_PLAYER_DAY,
  buildSpeakSystemPrompt,
  buildSpeakUserPrompt,
  isFarewell,
  cleanSpeakText,
  parseSpeakReply,
  validSpeakScenario,
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

// ---------------------------------------------------------------- foto profil
const AVATAR_BUCKET = "study-avatars";
function avatarUrl(id: string, ver: unknown): string | null {
  const v = Number(ver);
  if (!Number.isFinite(v) || v <= 0) return null;
  return `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${AVATAR_BUCKET}/${id}.jpg?v=${v}`;
}

// ---------------------------------------------------------------- PIN
async function checkPlayerPin(admin: Admin, playerId: unknown, pin: unknown): Promise<{ player: Row } | Response> {
  if (!isUuid(playerId)) return fail("Pemain tidak valid.");
  const { data: player, error } = await admin.from("study_players").select("*").eq("id", playerId).maybeSingle();
  if (error) return fail(error.message, 500);
  if (!player) return fail("Pemain tidak ditemukan.", 404);
  // Token login perangkat menggantikan PIN (tidak ikut penghitung salah-PIN, karena acak 256 bit).
  if (isDeviceToken(pin)) {
    const hash = await hashDeviceToken(pin);
    const { data: t } = await admin.from("study_device_tokens").select("id,last_used_at").eq("player_id", playerId).eq("token_hash", hash).maybeSingle();
    if (t) {
      if (Date.now() - Date.parse(t.last_used_at) > 10 * 60 * 1000) await admin.from("study_device_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id);
      return { player };
    }
    return fail("Sesi masuk di perangkat ini sudah berakhir. Masuk lagi dengan PIN.", 403, { pinWrong: true, tokenInvalid: true });
  }
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
  repeatSubjectPercent: typeof s.repeat_subject_percent === "number" ? s.repeat_subject_percent : null, // null = migrasi 0033 belum dijalankan
  dailyPointsCap: typeof s.daily_points_cap === "number" ? s.daily_points_cap : null, // 0 = tanpa batas; null = migrasi 0032 belum dijalankan
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

// Dasbor poin hari ini (fungsi study_daily, migrasi 0032). null bila migrasi belum dijalankan.
async function loadDaily(admin: Admin, playerId: string): Promise<Row | null> {
  const [{ data, error }, extra] = await Promise.all([admin.rpc("study_daily", { p_player: playerId }), admin.rpc("study_bonus_today", { p_player: playerId })]);
  if (error || !data) return null;
  // Extra poin dari orang tua hari ini (migrasi 0036); di luar batas harian. null bila migrasi belum dijalankan.
  return { ...(data as Row), extra: extra.error || typeof extra.data !== "number" ? null : extra.data };
}

// Pengulangan mata pelajaran yang sama hari ini (migrasi 0033): { count, percent }. percent 100 = pelajaran berikutnya tidak dikurangi.
// null bila migrasi belum dijalankan.
async function loadRepeat(admin: Admin, playerId: string, subject: string): Promise<{ count: number; percent: number } | null> {
  const [{ data: n, error }, settings] = await Promise.all([admin.rpc("study_repeat_count", { p_player: playerId, p_subject: subject }), loadSettings(admin)]);
  if (error || typeof n !== "number" || !settings || typeof settings.repeat_subject_percent !== "number") return null;
  return { count: n, percent: n > 0 ? settings.repeat_subject_percent : 100 };
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
  repeatPercent: s.repeat_percent ?? null, // persen poin karena mata pelajaran sama sudah dikerjakan hari itu (null = pelajaran lama)
  pointsRaw: s.points_raw ?? null, // sebelum dipotong batas harian (null = tidak dipotong / pelajaran lama)
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
    repeatPercent: session.repeat_percent ?? 100,
    rawPoints: session.points_raw ?? session.points_awarded ?? 0, // sebelum dipotong batas harian
    capped: (session.points_raw ?? 0) > (session.points_awarded ?? 0),
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
  const rep = body.repeatSubjectPercent === undefined || body.repeatSubjectPercent === null ? undefined : int(body.repeatSubjectPercent, 0, 100);
  const cap = body.dailyPointsCap === undefined || body.dailyPointsCap === null ? undefined : int(body.dailyPointsCap, 0, 1_000_000);
  const w = (body.weights ?? {}) as Row;
  const easy = int(w.easy, 1, 1000);
  const normal = int(w.normal, 1, 1000);
  const hard = int(w.hard, 1, 1000);
  if (perQ === null) return { ok: false, error: "Poin per soal harus bilangan bulat 1-10000." };
  if (bonus === null) return { ok: false, error: "Bonus nilai sempurna harus bilangan bulat 0-100 (persen)." };
  if (winBonus === null) return { ok: false, error: "Bonus pemenang kompetisi harus bilangan bulat 0-1000." };
  if (rep === null) return { ok: false, error: "Poin pengulangan mata pelajaran harus bilangan bulat 0-100 (persen; 100 = tanpa pengurangan)." };
  if (cap === null) return { ok: false, error: "Batas poin harian harus bilangan bulat 0-1.000.000 (0 = tanpa batas)." };
  if (spq === null || (spq !== 0 && spq < 10)) return { ok: false, error: "Waktu per soal harus 0 (tanpa timer) atau 10-600 detik." };
  if (easy === null || normal === null || hard === null) return { ok: false, error: "Bobot level harus bilangan bulat 1-1000 (persen)." };
  const rawSubjects = Array.isArray(body.subjects) ? body.subjects : [];
  const subjects: string[] = [];
  for (const s of rawSubjects) {
    const name = cleanLine(s, 40);
    if (name && !subjects.some((x) => x.toLowerCase() === name.toLowerCase())) subjects.push(name);
  }
  if (subjects.length === 0 || subjects.length > 30) return { ok: false, error: "Daftar pelajaran harus berisi 1-30 nama." };
  return { ok: true, value: { per_question_points: perQ, perfect_bonus_percent: bonus, seconds_per_question: spq, competition_win_bonus: winBonus, ...(cap === undefined ? {} : { daily_points_cap: cap }), ...(rep === undefined ? {} : { repeat_subject_percent: rep }), weight_easy: easy, weight_normal: normal, weight_hard: hard, subjects, updated_at: new Date().toISOString() } };
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
    pointsRaw: rp.points_raw ?? rp.points_awarded ?? 0, // sebelum dipotong batas harian
    bonusRaw: rp.bonus_raw ?? rp.bonus_points ?? 0,
    capped: (rp.points_raw ?? 0) > (rp.points_awarded ?? 0) || (rp.bonus_raw ?? 0) > (rp.bonus_points ?? 0),
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
    results: room.status === "finished" ? await roomResults(admin, room) : null,
    daily: room.status === "finished" && mine ? await loadDaily(admin, me as string) : null
  };
}

// ---------------------------------------------------------------- speaking: bantu
const SPEAK_SESSIONS_PER_DAY = 20; // sesi baru per pemain per 24 jam (mencegah memboroskan kuota AI dengan buka-tutup sesi)
const SPEAK_LIST_MAX = 60; // riwayat semua pemain
const SPEAK_TTS_PER_PLAYER_DAY = 150; // batas lunak (ingatan isolate) suara tutor server per pemain per hari
const speakTtsUse = new Map<string, { day: number; n: number }>();
const SPEAK_AUDIO_MAX_B64 = 1_400_000; // rekaman WAV 16 kHz mono ±20 detik ≈ 640 KB -> base64 ≈ 855 KB
const speakSince = () => new Date(Date.now() - SPEAK_KEEP_DAYS * 24 * 3600 * 1000).toISOString();
// Tabel speaking belum ada (migrasi 0035 belum dijalankan): fitur dianggap belum tersedia, bukan galat.
const speakMissing = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || /study_speak/i.test(e.message ?? ""));
const speakUnavailable = () => json({ ok: true, unavailable: true, sessions: [], turns: [] });

// viewerId/names: riwayat terlihat oleh SEMUA pemain; "mine" menandai milik pemain yang sedang melihat (hanya itu yang bisa dilanjutkan/dihapus).
const speakSessionRow = (s: Row, viewerId?: string, names?: Map<string, string>) => ({
  id: s.id,
  ownerId: s.player_id,
  ownerName: names?.get(s.player_id as string) ?? "",
  mine: !!viewerId && s.player_id === viewerId,
  scenario: s.scenario,
  topic: s.topic ?? "",
  title: s.title,
  userTurns: s.user_turns ?? 0,
  maxTurns: SPEAK_MAX_TURNS,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
  endedAt: s.ended_at ?? null,
  expiresAt: new Date(new Date(s.updated_at).getTime() + SPEAK_KEEP_DAYS * 24 * 3600 * 1000).toISOString()
});
const speakTurnRow = (t: Row) => ({ idx: t.idx, role: t.role, body: t.body, correction: t.correction ?? null, tip: t.tip ?? null, at: t.created_at });

// anyOwner=true: percakapan pemain lain boleh DILIHAT (baca saja). Aksi yang mengubah (giliran, akhiri, hapus) tetap hanya untuk pemiliknya.
async function loadSpeakSession(admin: Admin, sessionId: unknown, playerId: string, anyOwner = false): Promise<{ session: Row } | Response> {
  if (!isUuid(sessionId)) return fail("Percakapan tidak valid.");
  let q = admin.from("study_speak_sessions").select("*").eq("id", sessionId);
  if (!anyOwner) q = q.eq("player_id", playerId);
  const { data, error } = await q.gte("updated_at", speakSince()).maybeSingle();
  if (error) return speakMissing(error) ? speakUnavailable() : fail(error.message, 500);
  if (!data) return fail("Percakapan itu tidak ditemukan atau sudah dihapus (riwayat hanya disimpan 7 hari).", 404);
  return { session: data };
}

// Giliran pemain 24 jam terakhir: per pemain & global. null = lolos.
async function speakOwnerNames(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return out;
  const { data } = await admin.from("study_players").select("id,name").in("id", uniq);
  for (const r of (data ?? []) as Row[]) out.set(r.id as string, String(r.name ?? ""));
  return out;
}

async function checkSpeakLimits(admin: Admin, playerId: string): Promise<Response | null> {
  const { data, error } = await admin.rpc("study_speak_usage", { p_player: playerId });
  if (error) return null;
  const u = (Array.isArray(data) ? data[0] : data) as Row | null;
  if (Number(u?.mine ?? 0) >= SPEAK_PER_PLAYER_DAY) return fail(`Batas harian tercapai: maksimal ${SPEAK_PER_PLAYER_DAY} giliran bicara per pemain dalam 24 jam. Coba lagi nanti.`, 429, { dailyLimit: true });
  if (Number(u?.total ?? 0) >= SPEAK_GLOBAL_DAY) return fail("Batas harian latihan speaking untuk seluruh pemain sudah tercapai. Coba lagi besok.", 429, { dailyLimit: true });
  return null;
}

// Satu panggilan AI untuk tutor speaking. Mengulang sekali bila keluaran tak bisa dipakai.
async function askSpeakTutor(
  admin: Admin,
  p: Row,
  spec: { scenario: string; topic: string; lang: "id" | "en" },
  history: { role: "user" | "ai"; body: string }[],
  userText: string | null,
  engine: Engine,
  farewell = false
): Promise<{ reply: string; correction: string; tip: string; provider: string } | { error: string }> {
  wireReporters(admin);
  const keys = getGeminiApiKeys();
  const system = buildSpeakSystemPrompt({ scenario: spec.scenario, topic: spec.topic, grade: p.grade, classLevel: p.class_level ?? null, lang: spec.lang });
  const user = buildSpeakUserPrompt(history, userText, farewell);
  let lastError = "";
  let tokens = 0;
  let cost = 0;
  let out: { reply: string; correction: string; tip: string; provider: string } | null = null;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    try {
      const r = await generateJsonText(system, user, keys, { temperature: 0.95, engine });
      tokens += r.tokensUsed;
      cost += r.costUsd;
      const parsed = parseSpeakReply(r.text, userText ?? undefined);
      if (parsed) out = { ...parsed, provider: r.provider || "gemini" };
      else lastError = "AI mengembalikan balasan yang tidak bisa dipakai.";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error("study speak:", lastError);
    }
  }
  await recordTokens(admin, tokens, cost);
  return out ?? { error: lastError || "Tutor AI tidak menjawab." };
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
      const [{ data: board, error }, settings, items, av, today, speakProbe] = await Promise.all([admin.rpc("study_leaderboard"), loadSettings(admin), loadItems(admin), admin.from("study_players").select("id,avatar_ver"), admin.rpc("study_today_points"), admin.from("study_speak_sessions").select("id", { count: "exact", head: true })]);
      if (error) return fail(error.message, 500);
      // avatar_ver ada setelah migrasi 0031; sebelum itu kueri ini gagal dan foto dianggap tidak ada
      const avById = new Map<string, unknown>((av.error ? [] : av.data ?? []).map((r: Row) => [r.id as string, r.avatar_ver] as [string, unknown]));
      // poin didapat hari ini per pemain (migrasi 0032); sebelum itu fungsinya tidak ada dan semua dianggap 0
      const todayById = new Map<string, number>((today.error ? [] : (today.data ?? []) as Row[]).map((r: Row) => [r.player_id as string, Number(r.earned) || 0] as [string, number]));
      if (!settings) return fail("Setting Study belum ada. Jalankan migrasi 0023_study.sql.", 500);
      return json({
        ok: true,
        players: (board ?? []).map((p: Row) => ({ id: p.id, name: p.name, grade: p.grade, classLevel: p.class_level ?? null, sessionsDone: p.sessions_done, competitions: p.competitions ?? 0, wins: p.wins ?? 0, totalPoints: p.total_points, balance: p.balance, todayPoints: todayById.get(p.id) ?? 0, avatarUrl: avatarUrl(p.id, avById.get(p.id)) })),
        settings: publicSettings(settings, items),
        grades: GRADES,
        speak: !speakProbe.error // latihan speaking (migrasi 0035); false = belum dijalankan, tombol disembunyikan
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
      const [bal, sessions, reds, ledger, items, daily] = await Promise.all([
        admin.rpc("study_balance", { p_player: p.id }),
        admin.from("study_sessions").select("*").eq("player_id", p.id).order("created_at", { ascending: false }).limit(50),
        admin.from("study_redemptions").select("*").eq("player_id", p.id).order("created_at", { ascending: false }).limit(100),
        admin.from("study_ledger").select("kind,points,note,meta,created_at").eq("player_id", p.id).in("kind", ["session", "competition", "competition_bonus", "penalty", "bonus"]).order("created_at", { ascending: false }).limit(300),
        loadItems(admin),
        loadDaily(admin, p.id)
      ]);
      const ledgerRows = (ledger.data ?? []) as Row[];
      const totalEarned = ledgerRows.filter((l) => l.kind !== "penalty").reduce((a, l) => a + l.points, 0);
      return json({
        ok: true,
        player: { id: p.id, name: p.name, grade: p.grade, classLevel: p.class_level ?? null },
        balance: bal.data ?? 0,
        totalEarned,
        daily,
        sessions: (sessions.data ?? []).map(sessionRow),
        redemptions: (reds.data ?? []).map((r: Row) => ({ id: r.id, itemName: r.item_name, cost: r.cost, status: r.status, createdAt: r.created_at, givenAt: r.given_at })),
        bonuses: ledgerRows.filter((l) => l.kind === "bonus").slice(0, 50).map((l) => ({ points: l.points, name: l.note, createdAt: l.created_at })),
        penalties: ledgerRows.filter((l) => l.kind === "penalty").slice(0, 50).map((l) => ({ points: -l.points, requested: l.meta?.requested ?? -l.points, reason: l.note, createdAt: l.created_at })),
        redeemItems: items,
        allowedGrades: allowedMaterialGrades(p.grade),
        classRanges: Object.fromEntries(["SD", "SMP", "SMA"].map((g) => [g, classesOf(g)]))
      });
    }

    // ------------------------------------------------------------ foto profil
    if (action === "player_avatar_set") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const bytes = parseAvatarImage(body.image);
      if (!bytes) return fail("Foto tidak valid. Pakai gambar JPEG berukuran kecil (maksimal 150 KB).");
      const p = auth.player;
      const { error: ue } = await admin.storage.from(AVATAR_BUCKET).upload(`${p.id}.jpg`, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
      if (ue) return fail(`Gagal menyimpan foto: ${ue.message}`, 500);
      const ver = (Number(p.avatar_ver) || 0) + 1;
      const { error: de } = await admin.from("study_players").update({ avatar_ver: ver }).eq("id", p.id);
      if (de) return fail(de.message, 500);
      return json({ ok: true, avatarUrl: avatarUrl(p.id, ver) });
    }

    if (action === "player_avatar_remove") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      await admin.storage.from(AVATAR_BUCKET).remove([`${p.id}.jpg`]);
      const { error: de } = await admin.from("study_players").update({ avatar_ver: 0 }).eq("id", p.id);
      if (de) return fail(de.message, 500);
      return json({ ok: true, avatarUrl: null });
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
      await admin.from("study_device_tokens").delete().eq("player_id", body.playerId); // PIN baru = semua perangkat harus masuk lagi
      return json({ ok: true });
    }

    // ------------------------------------------------------------ login perangkat
    if (action === "login") {
      if (isDeviceToken(body.pin)) return fail("Masuk dengan PIN.");
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      const token = newDeviceToken();
      const { error: te } = await admin.from("study_device_tokens").insert({ player_id: p.id, token_hash: await hashDeviceToken(token) });
      if (te) return fail(te.message, 500);
      // batasi jumlah perangkat: yang terlama dikeluarkan
      const { data: all } = await admin.from("study_device_tokens").select("id").eq("player_id", p.id).order("created_at", { ascending: false });
      const extra = (all ?? []).slice(MAX_DEVICE_TOKENS).map((r: Row) => r.id);
      if (extra.length > 0) await admin.from("study_device_tokens").delete().in("id", extra);
      return json({ ok: true, token, player: { id: p.id, name: p.name, grade: p.grade, classLevel: p.class_level ?? null } });
    }

    if (action === "logout") {
      // idempoten: token yang sudah tidak berlaku pun dianggap berhasil keluar
      if (isUuid(body.playerId) && isDeviceToken(body.token)) {
        await admin.from("study_device_tokens").delete().eq("player_id", body.playerId).eq("token_hash", await hashDeviceToken(body.token));
      }
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
        repeat: await loadRepeat(admin, p.id, subject),
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
      return json({ ok: true, status: "active", session: sessionRow(s), repeat: await loadRepeat(admin, auth.player.id, s.subject), questions: qs ?? [] });
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
      return json({ ok: true, explainFailed: missing > 0, result: await loadResult(admin, fresh ?? owned.session, auth.player), daily: await loadDaily(admin, auth.player.id) });
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

    // ------------------------------------------------------------ notifikasi suka & komentar (migrasi 0034)
    if (action === "notif_list" || action === "notif_count" || action === "notif_seen") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const pid = auth.player.id;
      if (action === "notif_seen") {
        const upTo = typeof body.upTo === "string" && !Number.isNaN(Date.parse(body.upTo)) ? new Date(body.upTo).toISOString() : null;
        const { error } = await admin.rpc("study_notif_seen", { p_player: pid, p_upto: upTo });
        return error ? json({ ok: true, unavailable: true }) : json({ ok: true });
      }
      if (action === "notif_count") {
        const { data, error } = await admin.rpc("study_notif_count", { p_player: pid });
        return error ? json({ ok: true, unread: 0, unavailable: true }) : json({ ok: true, unread: Number(data) || 0 });
      }
      const [list, seenRow] = await Promise.all([admin.rpc("study_notifications", { p_player: pid, p_limit: 50 }), admin.from("study_players").select("notif_seen_at").eq("id", pid).maybeSingle()]);
      if (list.error || seenRow.error) return json({ ok: true, items: [], unread: 0, unavailable: true });
      const seenMs = seenRow.data?.notif_seen_at ? new Date(seenRow.data.notif_seen_at).getTime() : 0;
      const items = ((list.data ?? []) as Row[]).map((n) => ({
        type: n.type,
        kind: n.kind,
        targetId: n.target_id,
        title: n.title,
        actorId: n.actor_id,
        actorName: n.actor_name,
        body: n.body ?? null,
        at: n.created_at,
        unread: new Date(n.created_at).getTime() > seenMs
      }));
      return json({ ok: true, items, unread: items.filter((i) => i.unread).length });
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
      // Riwayat extra poin terakhir (per batch): nama, poin per anak, siapa saja. Kosong bila migrasi 0036 belum dijalankan.
      const { data: bonusRows } = await admin.from("study_ledger").select("player_id,points,note,meta,created_at").eq("kind", "bonus").order("created_at", { ascending: false }).limit(300);
      const batches = new Map<string, { name: string; points: number; createdAt: string; players: string[] }>();
      for (const r of (bonusRows ?? []) as Row[]) {
        const key = String(r.meta?.batch ?? `${r.created_at}|${r.note}|${r.points}`);
        const b = batches.get(key) ?? { name: r.note ?? "", points: r.points, createdAt: r.created_at, players: [] };
        b.players.push(names.get(r.player_id) ?? "?");
        batches.set(key, b);
      }
      return json({
        ok: true,
        recentBonuses: [...batches.values()].slice(0, 10),
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

    if (action === "bonus_give") {
      const par = await checkParentPin(admin, body.parentPin);
      if (par instanceof Response) return par;
      const ids = Array.isArray(body.playerIds) ? [...new Set(body.playerIds.filter((x: unknown): x is string => isUuid(x)))] : [];
      if (ids.length === 0) return fail("Pilih minimal satu pemain.");
      if (ids.length > 100) return fail("Terlalu banyak pemain dalam satu pemberian (maksimal 100).");
      const points = body.points;
      if (typeof points !== "number" || !Number.isInteger(points) || points < 1 || points > 1_000_000) return fail("Poin extra harus bilangan bulat positif (maksimal 1.000.000).");
      const name = cleanLine(body.name, 80);
      if (!name) return fail("Nama extra poin wajib diisi.");
      const { data, error } = await admin.rpc("study_give_bonus", { p_players: ids, p_points: points, p_name: name });
      if (error) {
        if (/PEMAIN_TIDAK_ADA/.test(error.message)) return fail("Ada pemain yang tidak ditemukan. Muat ulang daftar lalu coba lagi.", 404);
        if (/function .*study_give_bonus|does not exist|schema cache/i.test(error.message)) return fail("Fitur extra poin belum aktif: jalankan migrasi 0036_study_parent_bonus.sql di Supabase.", 500);
        if (/check constraint|study_ledger_kind_check/i.test(error.message)) return fail("Fitur extra poin belum aktif: jalankan migrasi 0036_study_parent_bonus.sql di Supabase.", 500);
        return fail(error.message, 500);
      }
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
      const d = await loadDaily(admin, p.id);
      const today = d ? { earned: d.earned, cap: d.cap, reached: d.reached } : null;
      return json({ ok: true, player: { id: p.id, name: p.name, grade: p.grade, classLevel: p.class_level ?? null }, stats, today });
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

    // ------------------------------------------------------------ speaking: mulai percakapan baru
    if (action === "speak_start") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      if (!validSpeakScenario(body.scenario)) return fail("Pilih skenario percakapan.");
      const scenario: string = body.scenario;
      const topic = scenario === "custom" ? cleanLine(body.topic, 100) : "";
      if (scenario === "custom" && topic.length < 3) return fail("Tulis topik percakapan (minimal 3 karakter).");
      const lang = body.lang === "en" ? "en" : "id";
      const since = speakSince();
      const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [recent, active] = await Promise.all([
        admin.from("study_speak_sessions").select("id", { count: "exact", head: true }).eq("player_id", p.id).gte("created_at", day),
        admin.from("study_speak_sessions").select("id").eq("player_id", p.id).is("ended_at", null).gte("updated_at", since).order("updated_at", { ascending: true })
      ]);
      if (recent.error || active.error) return speakMissing(recent.error ?? active.error) ? speakUnavailable() : fail((recent.error ?? active.error)!.message, 500);
      if ((recent.count ?? 0) >= SPEAK_SESSIONS_PER_DAY) return fail(`Batas harian tercapai: maksimal ${SPEAK_SESSIONS_PER_DAY} percakapan baru per pemain dalam 24 jam.`, 429, { dailyLimit: true });
      const limit = await checkSpeakLimits(admin, p.id);
      if (limit) return limit;
      const made = await askSpeakTutor(admin, p, { scenario, topic, lang }, [], null, parseEngine(body.engine));
      if ("error" in made) return fail(`Tutor AI belum bisa memulai. ${made.error}`.trim(), 502, { generationFailed: true });
      // sesi berjalan melebihi batas: yang paling lama diakhiri otomatis
      const running = (active.data ?? []) as Row[];
      if (running.length >= SPEAK_MAX_ACTIVE) {
        const old = running.slice(0, running.length - SPEAK_MAX_ACTIVE + 1).map((r) => r.id);
        await admin.from("study_speak_sessions").update({ ended_at: new Date().toISOString() }).in("id", old);
      }
      const { data: s, error } = await admin
        .from("study_speak_sessions")
        .insert({ player_id: p.id, scenario, topic, title: scenario === "custom" ? topic : scenario, grade: p.grade, class_level: p.class_level ?? null, provider: made.provider })
        .select("*")
        .single();
      if (error || !s) return speakMissing(error) ? speakUnavailable() : fail(error?.message || "Gagal membuat percakapan.", 500);
      const { data: t, error: terr } = await admin.from("study_speak_turns").insert({ session_id: s.id, idx: 0, role: "ai", body: made.reply }).select("*").single();
      if (terr || !t) return fail(terr?.message || "Gagal menyimpan percakapan.", 500);
      if (Math.random() < 0.05) await admin.rpc("study_speak_purge", { p_days: SPEAK_KEEP_DAYS });
      return json({ ok: true, session: speakSessionRow(s, p.id, new Map([[p.id as string, String(p.name ?? "")]])), turns: [speakTurnRow(t)] });
    }

    // ------------------------------------------------------------ speaking: satu giliran (ucapan pemain -> balasan tutor + koreksi)
    if (action === "speak_turn") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const p = auth.player;
      const loaded = await loadSpeakSession(admin, body.sessionId, p.id);
      if (loaded instanceof Response) return loaded;
      const sess = loaded.session;
      if (sess.ended_at) return fail("Percakapan ini sudah diakhiri.", 409, { ended: true });
      if ((sess.user_turns ?? 0) >= SPEAK_MAX_TURNS) return fail(`Percakapan ini sudah mencapai ${SPEAK_MAX_TURNS} giliran. Mulai percakapan baru.`, 409, { sessionFull: true });
      const text = cleanSpeakText(body.text);
      if (text.length < 1) return fail("Ucapan kosong. Bicara atau ketik dulu.");
      const limit = await checkSpeakLimits(admin, p.id);
      if (limit) return limit;
      const { data: rows, error: herr } = await admin.from("study_speak_turns").select("idx,role,body").eq("session_id", sess.id).order("idx", { ascending: true });
      if (herr) return speakMissing(herr) ? speakUnavailable() : fail(herr.message, 500);
      const history = ((rows ?? []) as Row[]).map((r) => ({ role: r.role as "user" | "ai", body: String(r.body) }));
      const nextIdx = ((rows ?? []) as Row[]).reduce((m, r) => Math.max(m, r.idx), -1) + 1;
      const lang = body.lang === "en" ? "en" : "id";
      const bye = isFarewell(text); // pamit -> tutor membalas salam perpisahan & percakapan diakhiri otomatis
      const made = await askSpeakTutor(admin, p, { scenario: sess.scenario, topic: sess.topic ?? "", lang }, history, text, parseEngine(body.engine), bye);
      if ("error" in made) return fail(`Tutor AI belum menjawab. ${made.error}`.trim(), 502, { generationFailed: true });
      const { error: ierr } = await admin.from("study_speak_turns").insert([
        { session_id: sess.id, idx: nextIdx, role: "user", body: text, correction: made.correction || null, tip: made.tip || null },
        { session_id: sess.id, idx: nextIdx + 1, role: "ai", body: made.reply }
      ]);
      if (ierr) return fail(ierr.code === "23505" ? "Ada ucapan lain yang sedang diproses. Coba lagi." : ierr.message, ierr.code === "23505" ? 409 : 500);
      const userTurns = (sess.user_turns ?? 0) + 1;
      await admin.from("study_speak_sessions").update({ user_turns: userTurns, updated_at: new Date().toISOString(), provider: made.provider, ...(bye ? { ended_at: new Date().toISOString() } : {}) }).eq("id", sess.id);
      return json({
        ok: true,
        userTurn: { idx: nextIdx, role: "user", body: text, correction: made.correction || null, tip: made.tip || null },
        aiTurn: { idx: nextIdx + 1, role: "ai", body: made.reply, correction: null, tip: null },
        userTurns,
        full: userTurns >= SPEAK_MAX_TURNS,
        ended: bye
      });
    }

    // ------------------------------------------------------------ speaking: suara -> teks (cadangan bila peramban tak punya pengenalan suara)
    if (action === "speak_transcribe") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const loaded = await loadSpeakSession(admin, body.sessionId, auth.player.id);
      if (loaded instanceof Response) return loaded;
      if (loaded.session.ended_at) return fail("Percakapan ini sudah diakhiri.", 409, { ended: true });
      const audio = typeof body.audio === "string" ? body.audio : "";
      const mime = body.mime === "audio/wav" || body.mime === "audio/x-wav" ? "audio/wav" : "";
      if (!mime) return fail("Format rekaman tidak didukung.");
      if (audio.length < 200 || audio.length > SPEAK_AUDIO_MAX_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return fail("Rekaman tidak valid atau terlalu panjang (maksimal ±20 detik).");
      const limit = await checkSpeakLimits(admin, auth.player.id);
      if (limit) return limit;
      wireReporters(admin);
      try {
        // Mesin utama: Groq Whisper (gratis, longgar). Gagal/habis/tak ada key -> cadangan Gemini.
        const groqKeys = getGroqSttKeys();
        if (groqKeys.length > 0) {
          try {
            const g = await transcribeWithGroq(audio, mime, groqKeys, {
              language: "en",
              prompt: "An Indonesian learner practising English conversation with a tutor. Transcribe exactly what was said."
            });
            return json({ ok: true, text: g.text, engine: "groq" });
          } catch (gErr) {
            console.error("study speak_transcribe groq gagal, pakai Gemini:", gErr instanceof Error ? gErr.message : String(gErr));
          }
        }
        const r = await transcribeAudio(audio, mime, getGeminiApiKeys());
        await recordTokens(admin, r.tokensUsed, r.costUsd);
        return json({ ok: true, text: r.text, engine: "gemini" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("study speak_transcribe:", msg);
        // kuota Gemini habis: pesan ramah (bukan galat mentah dari Google); pemain bisa mengetik jawabannya
        if (/429|quota|exhaust|batas kuota|rate.?limit|PerDay/i.test(msg)) {
          const daily = /PerDay|harian|daily/i.test(msg);
          return fail(
            daily
              ? "Kuota gratis pengenal suara hari ini sudah habis. Ketik jawabanmu dulu, atau coba lagi besok."
              : "Pengenal suara sedang penuh. Tunggu sebentar lalu coba lagi, atau ketik jawabanmu.",
            429,
            { generationFailed: true, sttQuota: true, sttDaily: daily }
          );
        }
        return fail(`Gagal mengubah suara jadi teks. ${msg}`.slice(0, 200).trim(), 502, { generationFailed: true });
      }
    }

    // ------------------------------------------------------------ speaking: suara tutor natural (teks -> suara lewat Gemini TTS)
    // Hanya membacakan giliran TUTOR yang sudah tersimpan (bukan teks sembarang), jadi tak bisa disalahgunakan sebagai layanan TTS umum.
    if (action === "speak_tts") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const loaded = await loadSpeakSession(admin, body.sessionId, auth.player.id, true);
      if (loaded instanceof Response) return loaded;
      const idx = Number(body.idx);
      if (!Number.isInteger(idx) || idx < 0) return fail("Giliran tidak valid.");
      const { data: turn, error: terr } = await admin.from("study_speak_turns").select("role,body").eq("session_id", loaded.session.id).eq("idx", idx).maybeSingle();
      if (terr) return fail(terr.message, 500);
      if (!turn || turn.role !== "ai") return fail("Giliran tutor tidak ditemukan.", 404);
      const used = speakTtsUse.get(auth.player.id as string) ?? { day: 0, n: 0 };
      const today = Math.floor(Date.now() / 86400000);
      if (used.day !== today) {
        used.day = today;
        used.n = 0;
      }
      if (used.n >= SPEAK_TTS_PER_PLAYER_DAY) return fail("Batas suara tutor harian tercapai; memakai suara perangkat.", 429, { dailyLimit: true });
      used.n++;
      speakTtsUse.set(auth.player.id as string, used);
      wireReporters(admin);
      try {
        const r = await synthesizeSpeech(String(turn.body), getGeminiApiKeys());
        return json({ ok: true, audio: r.wavBase64, mime: "audio/wav" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("study speak_tts:", msg);
        // kuota Gemini habis (429 / RESOURCE_EXHAUSTED / semua key sedang istirahat): aplikasi memakai suara perangkat lebih lama & memberi tahu pemain
        const quota = /429|quota|exhaust|batas kuota|rate.?limit|PerDay/i.test(msg);
        return fail(`Suara tutor tidak tersedia. ${msg}`.slice(0, 300), quota ? 429 : 502, { generationFailed: true, ttsQuota: quota, ttsDaily: quota && /PerDay|harian|daily/i.test(msg) });
      }
    }

    // ------------------------------------------------------------ speaking: akhiri / hapus / daftar / buka
    if (action === "speak_end" || action === "speak_delete") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const loaded = await loadSpeakSession(admin, body.sessionId, auth.player.id);
      if (loaded instanceof Response) return loaded;
      const q = admin.from("study_speak_sessions");
      const { error } = action === "speak_delete" ? await q.delete().eq("id", loaded.session.id) : await q.update({ ended_at: loaded.session.ended_at ?? new Date().toISOString() }).eq("id", loaded.session.id);
      if (error) return fail(error.message, 500);
      return json({ ok: true });
    }

    if (action === "speak_list") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      if (Math.random() < 0.1) await admin.rpc("study_speak_purge", { p_days: SPEAK_KEEP_DAYS });
      const { data, error } = await admin.from("study_speak_sessions").select("*").gte("updated_at", speakSince()).order("updated_at", { ascending: false }).limit(SPEAK_LIST_MAX);
      if (error) return speakMissing(error) ? speakUnavailable() : fail(error.message, 500);
      const rows = (data ?? []) as Row[];
      const names = await speakOwnerNames(admin, rows.map((r) => r.player_id as string));
      return json({ ok: true, sessions: rows.map((r) => speakSessionRow(r, auth.player.id as string, names)), keepDays: SPEAK_KEEP_DAYS, shared: true });
    }

    if (action === "speak_get") {
      const auth = await checkPlayerPin(admin, body.playerId, body.pin);
      if (auth instanceof Response) return auth;
      const loaded = await loadSpeakSession(admin, body.sessionId, auth.player.id, true);
      if (loaded instanceof Response) return loaded;
      const { data, error } = await admin.from("study_speak_turns").select("*").eq("session_id", loaded.session.id).order("idx", { ascending: true });
      if (error) return fail(error.message, 500);
      const names = await speakOwnerNames(admin, [loaded.session.player_id as string]);
      return json({ ok: true, session: speakSessionRow(loaded.session, auth.player.id as string, names), turns: ((data ?? []) as Row[]).map(speakTurnRow) });
    }

    return fail("action tidak dikenal.", 400);
  } catch (err) {
    console.error("study:", err instanceof Error ? err.stack || err.message : String(err));
    return fail(err instanceof Error ? err.message : "Terjadi kesalahan di server.", 500);
  }
});

