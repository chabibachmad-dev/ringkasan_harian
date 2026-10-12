// Menu "Study": latihan soal pilihan ganda buatan AI untuk beberapa pemain, dengan poin, leaderboard, redeem,
// hukuman, setting orang tua, dan PDF hasil. Semua data & logika poin ada di server (Edge Function `study`,
// lihat supabase/functions/study/index.ts); file ini hanya urusan tampilan.
// Rute (hash): #study

import { t } from "./i18n.js";
import { clearDeviceLogin, isDeviceToken, readDeviceLogin, saveDeviceLogin, studyCall, studyHooks } from "./study-client.js";
import { openFormDialog } from "./study-form.js";
import { fileToAvatarBase64 } from "./study-avatar.js";
import { renderAiMarkdown, typesetMath } from "./markdown.js";
import { buildStudyPdf, shareOrSaveStudyPdf, buildMaterialPdf, shareOrSaveMaterialPdf } from "./study-pdf.js";
import { pointsFormula, studyCardFileName } from "./study-text.js";
import { renderLessonCard, renderRoomCard, shareOrSaveCard } from "./study-card.js";
import { allowedClasses, allowedMaterialGrades, classesOf, computePoints, formatClock, gradeText, PRACTICE_QUESTIONS as PRACTICE_COUNT, timeLimitSeconds } from "../supabase/functions/_shared/study-core.ts";

const $ = (id) => document.getElementById(id);
let ctx = { getLang: () => "id" };
const L = (key, vars) => {
  let s = t(ctx.getLang(), key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const locale = () => (ctx.getLang() === "id" ? "id-ID" : "en-US");
const fmt = (n) => Number(n ?? 0).toLocaleString(locale());
const fmtDate = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
};
// ---- batas poin harian (migrasi 0032): data dari server, tampilan di sini
const weekdayShort = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString(locale(), { weekday: "short" });
};
const tzLabel = (tz) => (tz === "Asia/Jakarta" ? "WIB" : tz || "");
const dailyCapOf = () => {
  const c = S.overview?.settings?.dailyPointsCap;
  return typeof c === "number" ? c : null; // null = migrasi 0032 belum dijalankan: fitur disembunyikan
};
// simpan poin hari ini pemain di data beranda supaya papan "Hari ini" & bilah penonton ikut terbarui
function syncToday(playerId, daily) {
  const p = S.overview?.players?.find((x) => x.id === playerId);
  if (p && daily && typeof daily.earned === "number") p.todayPoints = daily.earned;
}
function todayOf(playerId) {
  return S.overview?.players?.find((x) => x.id === playerId)?.todayPoints ?? 0;
}
function capReached(playerId) {
  const cap = dailyCapOf();
  if (!(cap > 0)) return false;
  if (S.profile?.player?.id === playerId && S.profile.daily) return !!S.profile.daily.reached;
  return todayOf(playerId) >= cap;
}
// Dasbor "poin didapat hari ini": angka, batang kemajuan terhadap batas, rincian, dan grafik 7 hari.
function dailyCardHtml(d) {
  if (!d) return "";
  const cap = Number(d.cap) || 0;
  const earned = Number(d.earned) || 0;
  const pct = cap > 0 ? Math.min(100, Math.round((earned / cap) * 100)) : 0;
  const hist = Array.isArray(d.history) ? d.history : [];
  const top = Math.max(cap, ...hist.map((h) => Number(h.earned) || 0), 1);
  const bars = hist
    .map((h, i) => {
      const e = Number(h.earned) || 0;
      const hp = e > 0 ? Math.max(5, Math.round((e / top) * 100)) : 0;
      return `<li class="study-daily-day ${i === hist.length - 1 ? "is-today" : ""} ${cap > 0 && e >= cap ? "is-full" : ""}" title="${esc(h.date)}: ${esc(fmt(e))}">
        <span class="study-daily-val">${esc(fmt(e))}</span>
        <span class="study-daily-barwrap"><span class="study-daily-bar" style="height:${hp}%"></span></span>
        <span class="study-daily-wd">${esc(weekdayShort(h.date))}</span>
      </li>`;
    })
    .join("");
  const status =
    cap <= 0
      ? L("study_daily_unlimited")
      : d.reached
        ? L("study_daily_full", { tz: tzLabel(d.timezone) })
        : L("study_daily_left", { n: fmt(d.remaining ?? Math.max(0, cap - earned)) });
  return `
    <section class="study-daily" aria-label="${esc(L("study_daily_title"))}">
      <div class="study-daily-head">
        <div class="study-balance-label">${esc(L("study_daily_title"))}</div>
        ${cap > 0 && d.reached ? `<span class="study-badge study-badge--solid">${esc(L("study_daily_max"))}</span>` : ""}
      </div>
      <div class="study-daily-main"><span class="study-daily-num">${esc(fmt(earned))}</span>${cap > 0 ? `<span class="study-daily-cap">/ ${esc(fmt(cap))} ${esc(L("study_pts"))}</span>` : `<span class="study-daily-cap">${esc(L("study_pts"))}</span>`}</div>
      ${cap > 0 ? `<div class="study-daily-track" role="progressbar" aria-valuemin="0" aria-valuemax="${cap}" aria-valuenow="${Math.min(earned, cap)}" aria-label="${esc(L("study_daily_title"))}"><span class="study-daily-fill ${d.reached ? "is-full" : ""}" style="width:${pct}%"></span></div>` : ""}
      <div class="study-row-meta" data-daily-status>${esc(status)}</div>
      <div class="study-row-meta">${esc(L("study_daily_breakdown", { solo: fmt(d.solo), comp: fmt(d.competition), bonus: fmt(d.bonus) }))}</div>
      <div class="study-row-meta">${esc(L("study_daily_counts", { s: d.sessions ?? 0, c: d.competitions ?? 0 }))}</div>
      ${hist.length ? `<div class="study-daily-week-label">${esc(L("study_daily_week"))}</div><ul class="study-daily-week">${bars}</ul>` : ""}
      ${cap > 0 ? `<p class="study-hint">${esc(L("study_daily_note", { tz: tzLabel(d.timezone) }))}</p>` : ""}
    </section>`;
}
// Satu baris ringkas "Hari ini X/1000" untuk bilah penonton & layar hasil.
function dailyLine(earned, cap) {
  return cap > 0 ? L("study_daily_short", { e: fmt(earned), cap: fmt(cap) }) : L("study_daily_short_nocap", { e: fmt(earned) });
}

const GRADE_LIST = ["TK", "SD", "SMP", "SMA", "S1", "S2", "S3", "Umum"];
const COUNTS = [5, 10, 15, 20, 25, 30];
const LETTERS = ["A", "B", "C", "D"];
const CUSTOM = "__custom";

// view: "home" | "profile" | "quiz" | "result". PIN hanya hidup di memori (hilang saat layar Study ditinggalkan).
const S = {
  boardMode: "total", // papan leaderboard: "total" | "today" (poin didapat hari ini)
  avatarBusy: false,
  avatarMsg: "",
  view: "home",
  overview: null,
  overviewError: "",
  loading: false,
  player: null, // { id, name, grade }
  pin: "",
  profile: null,
  quiz: null, // { sessionId, session, questions, answers }
  result: null,
  autoSubmittedId: "", // id pelajaran yang dikumpulkan otomatis karena waktu habis (untuk pesan di hasil)
  explainFailed: false,
  resultFrom: "profile", // dari mana hasil dibuka: "profile" (milik sendiri) | "feed" (detil kegiatan pemain lain)
  viewer: null, // { id, name, grade, pin } pemain yang sudah "masuk" untuk suka/komentar/detil/room; PIN hanya di memori
  stack: [], // tumpukan layar (profil publik, hasil, materi, daftar room) supaya tombol kembali ke asalnya
  tab: "timeline", // tab beranda: "timeline" (default) | "board" (leaderboard) | "materi"
  feed: null, // timeline global (beranda)
  pub: null, // profil publik yang sedang dibuka: { id, player, stats, sub, feeds }
  rr: null, // tabel hasil kompetisi yang sedang dibuka
  rooms: { items: [], loading: false, loaded: false, error: "" },
  room: null, // room yang sedang diikuti: { id, creds, state, busy, leftQuiz }
  materials: { items: [], hasMore: false, loading: false, loaded: false, error: "" },
  material: null // materi yang sedang dibaca: { id, title, ..., content (null = masih dimuat) }
};

// ---------------------------------------------------------------- util
function errText(res) {
  if (res.notDeployed) return L("study_not_deployed");
  if (res.network) return `${L("study_network")} (${res.message})`;
  if (res.status === 504 || res.status === 546 || res.status === 502 && !res.generationFailed) return L("study_timeout");
  return res.message || "Error";
}

function handleFailure(res) {
  window.alert(errText(res));
}

const ansKey = (id) => `study_ans_${id}`;
function loadAnswers(id, n) {
  try {
    const arr = JSON.parse(sessionStorage.getItem(ansKey(id)) || "null");
    if (Array.isArray(arr) && arr.length === n) return arr.map((x) => (Number.isInteger(x) && x >= 0 && x <= 3 ? x : null));
  } catch (_e) {
    /* abaikan */
  }
  return new Array(n).fill(null);
}
function saveAnswers(id, answers) {
  try {
    sessionStorage.setItem(ansKey(id), JSON.stringify(answers));
  } catch (_e) {
    /* abaikan (mis. mode privat) */
  }
}
function clearAnswers(id) {
  try {
    sessionStorage.removeItem(ansKey(id));
  } catch (_e) {
    /* abaikan */
  }
}

const levelLabel = (level, settings) => {
  const w = settings?.weights?.[level];
  return `${L(`study_level_${level}`)}${w ? ` (${w}%)` : ""}`;
};
const mdBlock = (text) => renderAiMarkdown(String(text ?? ""));

// ---------------------------------------------------------------- siklus layar
export function initStudy(context) {
  ctx = { ...ctx, ...context };
  $("study-back-btn")?.addEventListener("click", onBack);
  $("study-settings-btn")?.addEventListener("click", () => openSettings());
  $("study-body")?.addEventListener("click", onBodyClick);
  $("study-body")?.addEventListener("change", onBodyChange);
  $("study-body")?.addEventListener("input", onBodyInput);
  // foto yang gagal dimuat (file hilang / offline): kembali ke huruf awal
  $("study-body")?.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!img || img.tagName !== "IMG" || !img.closest(".study-avatar")) return;
      const box = img.closest(".study-avatar");
      box.classList.remove("has-img");
      box.textContent = img.dataset.initial || "?";
    },
    true
  );
}

export function hideStudyScreen() {
  const el = $("screen-study");
  if (el) el.hidden = true;
  // keluar dari layar: kredensial sesi dilupakan; login perangkat (S.viewer, token) tetap sampai Keluar
  S.pin = "";
  S.player = null;
  S.profile = null;
  if (S.viewer && !isDeviceToken(S.viewer.pin)) S.viewer = null; // PIN mentah tidak disimpan; token perangkat tetap
  S.pub = null;
  S.rr = null;
  S.room = null;
  S.quiz = null;
  S.stack = [];
  S.view = "home";
  stopPoll();
  syncQuizTimer();
}

export function showStudyScreen() {
  $("screen-study").hidden = false;
  S.view = "home";
  S.pin = "";
  S.player = null;
  S.profile = null;
  S.quiz = null;
  S.result = null;
  S.pub = null;
  S.rr = null;
  S.room = null;
  S.stack = [];
  S.material = null;
  S.feed = newFeed(null, null);
  S.materials = { items: [], hasMore: false, loading: false, loaded: false, error: "" };
  restoreLogin();
  render();
  loadOverview();
  if (S.tab === "materi") loadMaterials(true);
  else if (S.tab === "timeline") loadFeed(S.feed, "first");
}

export function rerenderStudy() {
  if (!$("screen-study") || $("screen-study").hidden) return;
  render();
}

function onBack() {
  if (S.view === "quiz") {
    if (S.quiz?.kind === "room") {
      // kompetisi: waktu tetap berjalan; kembali ke room, soal bisa dilanjutkan dari sana
      if (!window.confirm(L("study_room_leave_quiz_confirm"))) return;
      if (S.room) S.room.leftQuiz = true;
      S.quiz = null;
      S.view = "room";
      render();
      return;
    }
    if (!window.confirm(L("study_leave_confirm"))) return;
    S.quiz = null;
    S.view = "profile";
    loadProfile();
    return;
  }
  if (S.view === "result") {
    S.result = null;
    if (S.resultFrom === "feed" && popView()) return;
    S.view = "profile";
    loadProfile();
    return;
  }
  if (S.view === "room") return leaveRoomView();
  if (["material", "public", "roomresult", "rooms"].includes(S.view)) {
    if (!popView()) {
      S.view = "home";
      render();
    }
    return;
  }
  if (S.view === "profile") {
    S.view = "home";
    S.player = null;
    S.pin = "";
    S.profile = null;
    S.stack = [];
    if (S.feed) S.feed.stale = true;
    render();
    loadOverview();
    return;
  }
  location.hash = "";
}

// ---------------------------------------------------------------- data
async function loadOverview() {
  S.loading = true;
  S.overviewError = "";
  render();
  const res = await studyCall("overview");
  S.loading = false;
  if (res.ok) {
    S.overview = res;
    S.overviewError = "";
  } else {
    S.overviewError = errText(res);
  }
  if (S.view === "home") render();
}

async function loadProfile() {
  if (!S.player) return;
  S.avatarMsg = "";
  S.loading = true;
  render();
  const res = await studyCall("player_profile", { playerId: S.player.id, pin: S.pin });
  S.loading = false;
  if (!res.ok) {
    handleFailure(res);
    S.view = "home";
    S.player = null;
    S.pin = "";
    render();
    loadOverview();
    return;
  }
  S.profile = res;
  S.player = res.player;
  syncToday(res.player.id, res.daily);
  render();
}

// ---------------------------------------------------------------- tampilan
function setTopbar() {
  const title = $("study-title");
  const settingsBtn = $("study-settings-btn");
  if (title) {
    const titles = {
      profile: S.player?.name,
      public: S.pub?.player?.name || L("study_pub_title"),
      material: L("study_mat_title"),
      quiz: S.quiz?.kind === "room" ? L("study_kind_competition") : L("study_quiz_title"),
      result: L("study_result_title"),
      rooms: L("study_rooms_title"),
      room: L("study_room_title"),
      roomresult: L("study_room_result_title")
    };
    title.textContent = titles[S.view] || L("study_title");
  }
  if (settingsBtn) settingsBtn.hidden = S.view !== "home";
}

function render() {
  const body = $("study-body");
  if (!body) return;
  setTopbar();
  if (S.view === "home") renderHome(body);
  else if (S.view === "profile") renderProfile(body);
  else if (S.view === "quiz") renderQuiz(body);
  else if (S.view === "result") renderResult(body);
  else if (S.view === "public") renderPublic(body);
  else if (S.view === "material") renderMaterial(body);
  else if (S.view === "rooms") renderRooms(body);
  else if (S.view === "room") renderRoom(body);
  else if (S.view === "roomresult") renderRoomResult(body);
  typesetMath(body).catch(() => {});
  syncQuizTimer();
  syncPoll();
}

// ---------------------------------------------------------------- timer ujian
// Sisa waktu dihitung server (secondsLeft) lalu dihitung mundur di sini; habis = jawaban dikumpulkan otomatis.
let timerId = 0;
const AUTO_SUBMIT_TRIES = 3;

function armQuizTimer(quiz) {
  const left = quiz.session?.secondsLeft;
  quiz.endsAt = typeof left === "number" ? Date.now() + left * 1000 : null;
  quiz.autoTries = 0;
  return quiz;
}

function quizSecondsLeft() {
  return S.quiz?.endsAt ? Math.max(0, Math.ceil((S.quiz.endsAt - Date.now()) / 1000)) : null;
}

function paintTimer() {
  const el = $("study-timer");
  const n = quizSecondsLeft();
  if (!el || n === null) return;
  el.textContent = L("study_time_left", { t: formatClock(n) });
  el.classList.toggle("is-low", n <= 60);
}

function syncQuizTimer() {
  const on = S.view === "quiz" && S.quiz && S.quiz.endsAt;
  if (!on) {
    if (timerId) clearInterval(timerId);
    timerId = 0;
    return;
  }
  paintTimer();
  if (!timerId) timerId = setInterval(tickQuizTimer, 1000);
  if (quizSecondsLeft() === 0) tickQuizTimer();
}

function tickQuizTimer() {
  if (!(S.view === "quiz" && S.quiz && S.quiz.endsAt)) return syncQuizTimer();
  paintTimer();
  const q = S.quiz;
  if (quizSecondsLeft() === 0 && !q.submitting && q.autoTries < AUTO_SUBMIT_TRIES) {
    q.autoTries += 1;
    submitQuiz($("study-submit-btn"), true);
  }
}

function renderHome(body) {
  if (S.overviewError && !S.overview) {
    body.innerHTML = `
      <div class="study-card">
        <p>${esc(S.overviewError)}</p>
        <div class="study-actions">
          <button type="button" class="secondary-btn" data-act="reload">${esc(L("study_reload"))}</button>
        </div>
      </div>`;
    return;
  }
  if (!S.overview) {
    body.innerHTML = `<p class="status-text">${esc(L("study_loading"))}</p>`;
    return;
  }
  const players = S.overview.players || [];
  const rows = players
    .map(
      (p, i) => `
      <button type="button" class="study-board-row ${i < 3 ? "is-top" : ""}" data-act="open-public" data-id="${esc(p.id)}">
        <span class="study-rank">${i + 1}</span>
        ${avatarHtml(p.id, p.name, "study-avatar--sm", true)}
        <span class="study-board-main"><span class="study-name">${esc(p.name)}</span><small class="study-board-meta">${esc(gradeText(p.grade, p.classLevel))} · ${fmt(p.sessionsDone)} ${esc(L("study_col_done").toLowerCase())}</small></span>
        <span class="study-pts">${fmt(p.totalPoints)}<small>${esc(L("study_pts"))}</small></span>
      </button>`
    )
    .join("");
  const capNow = dailyCapOf();
  const todayMode = capNow !== null && S.boardMode === "today";
  const todayRows = players
    .filter((p) => (p.todayPoints ?? 0) > 0)
    .sort((a, b) => (b.todayPoints ?? 0) - (a.todayPoints ?? 0) || String(a.name).localeCompare(String(b.name)))
    .map(
      (p, i) => `
      <button type="button" class="study-board-row ${i < 3 ? "is-top" : ""}" data-act="open-public" data-id="${esc(p.id)}">
        <span class="study-rank">${i + 1}</span>
        ${avatarHtml(p.id, p.name, "study-avatar--sm", true)}
        <span class="study-board-main"><span class="study-name">${esc(p.name)}</span><small class="study-board-meta">${esc(gradeText(p.grade, p.classLevel))}${capNow > 0 && p.todayPoints >= capNow ? ` · ${esc(L("study_daily_max"))}` : ""}</small></span>
        <span class="study-pts">+${fmt(p.todayPoints)}<small>${esc(L("study_pts"))}</small></span>
      </button>`
    )
    .join("");
  const modeBtn = (id, label) =>
    `<button type="button" role="tab" class="study-tab ${(todayMode ? "today" : "total") === id ? "is-on" : ""}" aria-selected="${(todayMode ? "today" : "total") === id ? "true" : "false"}" data-act="board-mode" data-mode="${id}">${esc(label)}</button>`;
  const modeTabs = capNow === null || players.length === 0 ? "" : `<div class="study-tabs study-tabs--sub" role="tablist">${modeBtn("total", L("study_board_total"))}${modeBtn("today", L("study_board_today"))}</div>`;
  const boardHtml =
    players.length === 0
      ? `<p class="status-text">${esc(L("study_board_empty"))}</p>`
      : todayMode
        ? `${modeTabs}${todayRows ? `<div class="study-board" role="table">${todayRows}</div>` : `<p class="status-text">${esc(L("study_board_today_empty"))}</p>`}
      <p class="study-hint">${esc(L(capNow > 0 ? "study_board_today_hint" : "study_board_today_hint_nocap", { cap: fmt(capNow) }))}</p>`
        : `${modeTabs}<div class="study-board" role="table">${rows}</div>
      <p class="study-hint">${esc(L("study_board_hint"))}</p>`;
  const tab = (id, label) =>
    `<button type="button" role="tab" id="study-tab-${id}" class="study-tab ${S.tab === id ? "is-on" : ""}" aria-selected="${S.tab === id ? "true" : "false"}" data-act="tab" data-tab="${id}">${esc(label)}</button>`;
  body.innerHTML = `
    <div class="study-actions study-actions--chips">
      <button type="button" class="secondary-btn" data-act="new-player">${esc(L("study_new_player"))}</button>
      <button type="button" class="secondary-btn" data-act="new-lesson">${esc(L("study_new_lesson"))}</button>
      <button type="button" class="secondary-btn" data-act="rooms">${esc(L("study_rooms_btn"))}</button>
    </div>
    <div class="study-tabs" role="tablist">${tab("timeline", L("study_tab_timeline"))}${tab("board", L("study_tab_board"))}${tab("materi", L("study_tab_materi"))}</div>
    ${S.loading && S.tab === "board" ? `<p class="status-text">${esc(L("study_loading"))}</p>` : ""}
    ${S.tab === "timeline" ? "" : viewerBarHtml()}
    <div role="tabpanel">${S.tab === "materi" ? materialsHtml() : S.tab === "timeline" ? timelineHtml() : boardHtml}</div>`;
  // kegiatan baru (pelajaran/kompetisi/materi selesai) sejak timeline dimuat: segarkan diam-diam
  if (S.tab === "timeline" && S.feed && S.feed.stale && !S.feed.loading) setTimeout(() => S.feed && loadFeed(S.feed, "refresh"), 0);
}

function renderProfile(body) {
  const p = S.profile;
  if (!p) {
    body.innerHTML = `<p class="status-text">${esc(L("study_loading"))}</p>`;
    return;
  }
  const items = p.redeemItems || [];
  const redeem = items.length
    ? items
        .map((it) => {
          const need = it.cost - p.balance;
          return `
        <div class="study-row">
          <div class="study-row-main"><div class="study-row-title">${esc(it.name)}</div><div class="study-row-meta">${fmt(it.cost)} ${esc(L("study_pts"))}</div></div>
          <button type="button" class="secondary-btn" data-act="redeem" data-id="${esc(it.id)}" ${need > 0 ? "disabled" : ""}>${esc(need > 0 ? L("study_redeem_need", { n: fmt(need) }) : L("study_redeem_btn"))}</button>
        </div>`;
        })
        .join("")
    : `<p class="status-text">${esc(L("study_redeem_empty"))}</p>`;

  const statusLabel = (s) => L(s === "given" ? "study_status_given" : "study_status_pending");
  const redHistory = (p.redemptions || []).length
    ? p.redemptions
        .map(
          (r) => `
        <div class="study-row">
          <div class="study-row-main"><div class="study-row-title">${esc(r.itemName)}</div><div class="study-row-meta">${fmtDate(r.createdAt)} · -${fmt(r.cost)} ${esc(L("study_pts"))}</div></div>
          <span class="study-badge ${r.status === "given" ? "study-badge--solid" : ""}">${esc(statusLabel(r.status))}</span>
        </div>`
        )
        .join("")
    : `<p class="status-text">${esc(L("study_empty_list"))}</p>`;

  const penalties = (p.penalties || []).length
    ? p.penalties
        .map(
          (x) => `
        <div class="study-row">
          <div class="study-row-main"><div class="study-row-title">${esc(x.reason || "-")}</div><div class="study-row-meta">${fmtDate(x.createdAt)}</div></div>
          <span class="study-badge">-${fmt(x.points)}</span>
        </div>`
        )
        .join("")
    : "";

  const lessons = (p.sessions || []).length
    ? p.sessions
        .map((s) => {
          const lvl = `${esc(L(`study_level_${s.level}`))} · ${esc(gradeText(s.materialGrade, s.materialClass))}`;
          if (s.status === "submitted") {
            return `
          <div class="study-row">
            <div class="study-row-main"><div class="study-row-title">${esc(s.subject)}</div><div class="study-row-meta">${lvl} · ${fmtDate(s.submittedAt)}<br>${esc(L("study_score", { c: s.correctCount, n: s.numQuestions }))} · +${fmt(s.pointsAwarded)} ${esc(L("study_pts"))}${s.pointsRaw > s.pointsAwarded ? ` (${esc(L("study_row_capped", { raw: fmt(s.pointsRaw) }))})` : ""}</div></div>
            <button type="button" class="secondary-btn" data-act="view-result" data-id="${esc(s.id)}">${esc(L("study_view_result"))}</button>
          </div>`;
          }
          return `
          <div class="study-row">
            <div class="study-row-main"><div class="study-row-title">${esc(s.subject)}</div><div class="study-row-meta">${lvl} · ${esc(L("study_in_progress"))} (${s.numQuestions})</div></div>
            <div class="study-row-btns">
              <button type="button" class="secondary-btn" data-act="resume" data-id="${esc(s.id)}">${esc(L("study_continue"))}</button>
              <button type="button" class="secondary-btn" data-act="cancel-lesson" data-id="${esc(s.id)}">${esc(L("study_cancel_lesson"))}</button>
            </div>
          </div>`;
        })
        .join("")
    : `<p class="status-text">${esc(L("study_lessons_empty"))}</p>`;

  body.innerHTML = `
    <div class="study-profile-top">
      <div class="study-profile-top-main">
        <div class="study-profile-name">${esc(p.player.name)}</div>
        <div class="study-row-meta">${esc(gradeText(p.player.grade, p.player.classLevel))}</div>
      </div>
      <button type="button" class="study-avatar-btn" data-act="avatar-pick" aria-label="${esc(L("study_photo_change"))}">${avatarHtml(p.player.id, p.player.name, "study-avatar--xl", true)}<span class="study-avatar-badge" aria-hidden="true">${ICONS.camera}</span></button>
    </div>
    <div class="study-balance">
      <div class="study-balance-label">${esc(L("study_balance"))}</div>
      <div class="study-balance-value">${fmt(p.balance)}</div>
      <div class="study-row-meta">${esc(L("study_total_earned"))}: ${fmt(p.totalEarned)}</div>
    </div>
    ${dailyCardHtml(p.daily)}
    <div class="study-actions">
      <button type="button" class="primary-btn" data-act="new-lesson-me">${esc(L("study_new_lesson"))}</button>
      <button type="button" class="secondary-btn" data-act="my-timeline">${esc(L("study_tl_my"))}</button>
      <button type="button" class="secondary-btn" data-act="edit-level">${esc(L("study_edit_level"))}</button>
      <button type="button" class="secondary-btn" data-act="avatar-pick">${esc(L("study_photo_change"))}</button>
      ${avatarUrlOf(p.player.id) ? `<button type="button" class="study-link-btn" data-act="avatar-remove">${esc(L("study_photo_remove"))}</button>` : ""}
      <button type="button" class="study-link-btn" data-act="tl-signout">${esc(L("study_logout_device"))}</button>
    </div>
    ${S.avatarMsg ? `<p class="study-hint" role="status">${esc(S.avatarMsg)}</p>` : ""}
    <h2 class="study-h">${esc(L("study_redeem"))}</h2>
    ${redeem}
    <details class="study-details"><summary>${esc(L("study_redeem_history"))} (${(p.redemptions || []).length})</summary>${redHistory}</details>
    ${penalties ? `<details class="study-details"><summary>${esc(L("study_penalties"))} (${(p.penalties || []).length})</summary>${penalties}</details>` : ""}
    <details class="study-details" open><summary>${esc(L("study_lessons"))} (${(p.sessions || []).length})</summary>${lessons}</details>
    ${S.loading ? `<p class="status-text">${esc(L("study_loading"))}</p>` : ""}`;
}

function renderQuiz(body) {
  const q = S.quiz;
  if (!q) return;
  const answered = q.answers.filter((a) => a !== null).length;
  const cards = q.questions
    .map(
      (it) => `
    <fieldset class="study-q-card">
      <legend class="study-q-no">${it.idx + 1}</legend>
      <div class="study-q chat-md">${mdBlock(it.question)}</div>
      ${it.options
        .map(
          (opt, i) => `
        <label class="study-opt-label">
          <input type="radio" name="q-${it.idx}" value="${i}" data-q="${it.idx}" ${q.answers[it.idx] === i ? "checked" : ""} />
          <span class="study-letter">${LETTERS[i]}</span>
          <span class="study-opt-text chat-md">${mdBlock(opt)}</span>
        </label>`
        )
        .join("")}
    </fieldset>`
    )
    .join("");
  body.innerHTML = `
    <div class="study-card">
      <div class="study-row-title">${q.kind === "room" ? `<span class="study-badge study-badge--solid">${esc(L("study_kind_competition"))}</span> ` : ""}${esc(q.session.subject)}${q.session.topic ? ` · ${esc(q.session.topic)}` : ""}</div>
      <div class="study-row-meta">${esc(gradeText(q.session.materialGrade, q.session.materialClass))} · ${esc(levelLabel(q.session.level, S.overview?.settings))} · ${q.questions.length} ${esc(L("study_questions_unit"))}</div>
      ${q.shortfall ? `<div class="study-row-meta">${esc(L("study_shortfall", { got: q.questions.length, want: q.questions.length + q.shortfall }))}</div>` : ""}
      ${q.endsAt ? `<div class="study-row-meta">${esc(L("study_time_hint", { m: Math.ceil((q.session.timeLimitSeconds || 0) / 60) }))}</div>` : ""}
    </div>
    ${cards}
    <div class="study-submit-bar">
      ${q.endsAt ? `<span id="study-timer" class="study-timer" role="timer" aria-live="off">${esc(L("study_time_left", { t: formatClock(quizSecondsLeft() ?? 0) }))}</span>` : ""}
      <span id="study-progress" class="study-progress">${esc(L("study_quiz_progress", { a: answered, n: q.questions.length }))}</span>
      <button type="button" id="study-submit-btn" class="primary-btn" data-act="submit">${esc(L("study_submit"))}</button>
    </div>`;
}

function renderResult(body) {
  const r = S.result;
  if (!r) return;
  const items = r.items
    .map((it) => {
      const unanswered = it.userAnswer === null || it.userAnswer === undefined;
      const state = unanswered ? L("study_unanswered") : it.isCorrect ? `✓ ${L("study_correct")}` : `✗ ${L("study_wrong")}`;
      const opts = it.options
        .map((opt, i) => {
          const isKey = i === it.correctIndex;
          const isPick = i === it.userAnswer;
          const tag = isKey ? `✓ ${L("study_key")}` : isPick ? `✗ ${L("study_yours")}` : "";
          const extra = isKey && isPick ? ` · ${L("study_yours")}` : "";
          return `
          <li class="study-opt ${isKey ? "is-key" : ""} ${isPick && !isKey ? "is-wrong-pick" : ""}">
            <span class="study-letter">${LETTERS[i]}</span>
            <span class="study-opt-text chat-md">${mdBlock(opt)}</span>
            ${tag ? `<span class="study-opt-tag">${esc(tag + extra)}</span>` : ""}
          </li>`;
        })
        .join("");
      return `
      <article class="study-item ${unanswered ? "is-none" : it.isCorrect ? "is-correct" : "is-wrong"}">
        <header class="study-item-head"><span class="study-q-no">${it.idx + 1}</span><span class="study-item-state">${esc(state)}</span></header>
        <div class="study-q chat-md">${mdBlock(it.question)}</div>
        <ul class="study-opts">${opts}</ul>
        ${
          it.explanation
            ? `<div class="study-expl"><div class="study-expl-title">${esc(L("study_explanation"))}</div><div class="chat-md">${mdBlock(it.explanation)}</div></div>`
            : `<div class="study-expl study-expl--missing">${esc(L("study_explanation_missing"))}</div>`
        }
        ${it.doubtful ? `<div class="study-doubtful">⚠ ${esc(L("study_doubtful"))}</div>` : ""}
      </article>`;
    })
    .join("");
  body.innerHTML = `
    <div class="study-card study-score">
      ${r.session.materialTitle ? `<div class="study-post-chips"><span class="study-badge study-badge--solid">${esc(L("study_kind_practice"))}</span></div>` : ""}
      <div class="study-row-title">${esc(r.session.subject)}${r.session.topic ? ` · ${esc(r.session.topic)}` : ""}</div>
      <div class="study-row-meta">${esc(r.player.name)} · ${esc(gradeText(r.session.materialGrade, r.session.materialClass))} · ${esc(L(`study_level_${r.session.level}`))} (${r.weightPercent}%)</div>
      <div class="study-score-main">${esc(L("study_score", { c: r.correct, n: r.total }))}</div>
      <div class="study-score-points">+${fmt(r.points)} <small>${esc(L("study_pts"))}</small></div>
      <div class="study-row-meta">${esc(pointsFormula(r, L))}</div>
      ${r.capped ? `<div class="study-warn" role="status">${esc(L("study_daily_capped_line", { raw: fmt(r.rawPoints), got: fmt(r.points) }))}</div>` : ""}
      ${r.daily && dailyCapOf() !== null ? `<div class="study-row-meta">${esc(dailyLine(r.daily.earned, r.daily.cap))}</div>` : ""}
      ${r.bonusPercent > 0 ? `<div class="study-bonus">${esc(L("study_bonus_line", { b: r.bonusPercent }))}</div>` : ""}
      ${r.timedOut ? `<div class="study-warn">${esc(L("study_time_up_late"))}</div>` : S.autoSubmittedId === r.session.id ? `<div class="study-warn">${esc(L("study_time_up_auto"))}</div>` : ""}
    </div>
    ${S.explainFailed && S.resultFrom !== "feed" ? `<div class="study-card"><p>${esc(L("study_explain_failed"))}</p><button type="button" class="secondary-btn" data-act="explain-retry">${esc(L("study_explain_retry"))}</button></div>` : ""}
    <div class="study-actions">
      <button type="button" class="primary-btn" data-act="share-card">${esc(L("study_share_card"))}</button>
      <button type="button" class="secondary-btn" data-act="share-pdf">${esc(L("study_share_pdf"))}</button>
      ${
        S.resultFrom === "feed"
          ? `<button type="button" class="secondary-btn" data-act="to-timeline">${esc(L("study_back_timeline"))}</button>`
          : `<button type="button" class="secondary-btn" data-act="to-profile">${esc(L("study_to_profile"))}</button>`
      }
    </div>
    ${items}`;
}

// ---------------------------------------------------------------- aksi di halaman
function onBodyChange(e) {
  const input = e.target.closest?.('input[type="radio"][data-q]');
  if (!input || !S.quiz) return;
  const idx = Number(input.dataset.q);
  S.quiz.answers[idx] = Number(input.value);
  saveAnswers(S.quiz.sessionId, S.quiz.answers);
  const el = $("study-progress");
  if (el) el.textContent = L("study_quiz_progress", { a: S.quiz.answers.filter((a) => a !== null).length, n: S.quiz.questions.length });
}

async function onBodyClick(e) {
  const btn = e.target.closest?.("[data-act]");
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (act === "reload") return loadOverview();
  if (act === "new-player") return openNewPlayerForm();
  if (act === "new-lesson" || act === "new-lesson-me") {
    const who = act === "new-lesson-me" ? S.player : loggedIn(S.overview?.players || []);
    if (who && capReached(who.id) && !window.confirm(L("study_daily_start_confirm"))) return;
    return openLessonForm(act === "new-lesson-me" ? S.player : null);
  }
  if (act === "open-player") return openPlayerPin(id);
  if (act === "tab") return switchTab(btn.dataset.tab);
  if (act === "board-mode") {
    S.boardMode = btn.dataset.mode === "today" ? "today" : "total";
    return render();
  }
  if (act === "rooms") return openRooms();
  if (act === "rooms-refresh") return loadRooms();
  if (act === "room-new") return openRoomCreate();
  if (act === "room-join") return joinRoomFlow(id);
  if (act === "room-start") return roomStart();
  if (act === "room-leave") return leaveRoomView();
  if (act === "room-resume") {
    if (S.room) S.room.leftQuiz = false;
    return startRoomQuiz();
  }
  if (act === "room-back") {
    S.room = null;
    S.view = "rooms";
    render();
    return loadRooms();
  }
  if (act === "open-public") return openPublic(id);
  if (act === "pub-tab") return switchPubTab(btn.dataset.tab);
  if (act === "pub-reload") return S.pub && loadPublic(S.pub);
  if (act === "feed-reload") return loadFeed(shownFeed(), "first");
  if (act === "mat-new") return openMaterialCreate();
  if (act === "mat-view") return openMaterial(id);
  if (act === "mat-pdf") return materialPdf(id, btn);
  if (act === "mat-practice") return openPracticeForm(S.materials.items.find((i) => i.id === id));
  if (act === "mat-reader-practice") return openPracticeForm(S.material);
  if (act === "mat-reader-pdf") return materialPdf(S.material?.id, btn);
  if (act === "mat-del") return deleteMaterial(id);
  if (act === "mat-more") return loadMaterials(false);
  if (act === "my-timeline") return openPublic(S.player?.id);
  if (act === "edit-level") return openEditLevel();
  if (act === "avatar-pick") return pickAvatar();
  if (act === "avatar-remove") return removeAvatar();
  if (act === "tl-profile") return openProfileFromPublic();
  if (act === "tl-more") return loadFeed(shownFeed(), "more");
  if (act === "tl-signin") return signInViewer();
  if (act === "tl-signout") return signOutViewer();
  if (act === "my-profile") return openOwnProfile();
  if (act === "like") return doLike(id);
  if (act === "comments") return toggleComments(id);
  if (act === "comment-send") return sendComment(id);
  if (act === "comment-del") return deleteComment(id, btn.dataset.sid, btn.dataset.parent === "1");
  if (act === "detail") return openDetail(id);
  if (act === "to-timeline") return onBack();
  if (act === "redeem") return doRedeem(id);
  if (act === "resume") return resumeLesson(id);
  if (act === "view-result") return viewResult(id);
  if (act === "cancel-lesson") return cancelLesson(id);
  if (act === "submit") return submitQuiz(btn);
  if (act === "explain-retry") return retryExplain(btn);
  if (act === "share-pdf") return sharePdf(btn);
  if (act === "share-card") return shareLessonCard(btn);
  if (act === "room-card") return shareRoomCard(btn);
  if (act === "to-profile") {
    S.result = null;
    S.view = "profile";
    return loadProfile();
  }
}

// ---------------------------------------------------------------- pemain
// Field "Kelas" untuk form: tampil hanya bila tingkatnya punya kelas (SD/SMP/SMA). gradeOf(v) = tingkat terpilih,
// classesFor(v) = daftar kelas yang boleh, preferred(v) = kelas anjuran saat daftar berubah (kosong = yang terendah).
function classField(gradeOf, classesFor, preferred, initial) {
  return {
    key: "classLevel",
    label: L("study_class"),
    type: "select",
    value: initial === undefined || initial === null ? undefined : String(initial),
    show: (v) => classesFor(v).length > 0,
    options: (v) => classesFor(v).map((c) => ({ value: String(c), label: gradeText(gradeOf(v), c) })),
    onOptionsChange: preferred ? (v) => preferred(v) : undefined
  };
}

// Nilai kelas untuk dikirim ke server: angka bila tingkat itu punya kelas, selain itu null.
const classValue = (grade, raw) => (classesOf(grade).length > 0 && raw !== "" && raw != null ? Number(raw) : null);

const gradeOptions = () => GRADE_LIST.map((g) => ({ value: g, label: g }));

function validPinFormat(p) {
  return typeof p === "string" && /^\d{4,6}$/.test(p);
}

// ---------------------------------------------------------------- login perangkat
// Pemain yang sudah masuk (S.viewer) tetap masuk di perangkat ini sampai menekan Keluar: peramban menyimpan token dari
// server (bukan PIN). Token dikirim sebagai pengganti PIN di semua aksi pemain, jadi form tidak perlu minta PIN lagi.
const validCred = (c) => validPinFormat(c) || isDeviceToken(c);

// Akun yang sedang masuk dengan token perangkat, bila termasuk dalam daftar pemain `list`; selain itu null (form biasa minta pemain + PIN).
const loggedIn = (list) => (S.viewer && isDeviceToken(S.viewer.pin) ? list.find((p) => p.id === S.viewer.id) || null : null);

// Kredensial (PIN atau token) untuk pemain `pl` yang sudah dikenali.
const credOf = (pl) => (S.viewer && S.viewer.id === pl.id ? S.viewer.pin : S.player && S.player.id === pl.id ? S.pin : "");

// Setelah PIN terbukti benar: tukar dengan token perangkat, simpan, dan jadikan akun yang masuk. Mengembalikan kredensial
// yang dipakai selanjutnya (token; atau PIN bila server tidak bisa dihubungi, supaya aksi yang sedang jalan tetap lanjut).
async function adoptLogin(player, pin) {
  const base = { id: player.id, name: player.name, grade: player.grade, classLevel: player.classLevel ?? null };
  if (isDeviceToken(pin)) {
    S.viewer = { ...base, pin };
    return pin;
  }
  if (S.viewer && S.viewer.id === player.id && isDeviceToken(S.viewer.pin)) return S.viewer.pin;
  const old = S.viewer && isDeviceToken(S.viewer.pin) ? S.viewer : null;
  const res = await studyCall("login", { playerId: player.id, pin });
  if (!res.ok) {
    S.viewer = { ...base, pin };
    return pin;
  }
  if (old) studyCall("logout", { playerId: old.id, token: old.pin }); // ganti akun: token akun lama dicabut
  S.viewer = { ...base, pin: res.token };
  saveDeviceLogin(S.viewer);
  return res.token;
}

// Keluar: token dicabut di server, dihapus dari perangkat, dan semua kredensial di memori dilupakan.
async function logoutDevice() {
  const v = S.viewer;
  if (v && isDeviceToken(v.pin)) studyCall("logout", { playerId: v.id, token: v.pin });
  clearDeviceLogin();
  forgetViewer();
  if (S.view === "profile" || S.view === "result") {
    S.result = null;
    S.view = "home";
    S.stack = [];
    if (S.feed) S.feed.stale = true;
    render();
    loadOverview();
    return;
  }
  shownFeed()?.items.forEach((i) => (i.liked = false));
  render();
}

// Lupakan akun yang masuk di memori (tanpa menyentuh server / penyimpanan).
function forgetViewer() {
  S.viewer = null;
  if (S.player) {
    S.player = null;
    S.pin = "";
    S.profile = null;
  }
}

studyHooks.onTokenInvalid = () => {
  clearDeviceLogin();
  if (S.viewer && isDeviceToken(S.viewer.pin)) {
    S.viewer = null;
    if (isDeviceToken(S.pin)) S.pin = "";
    if (!$("screen-study")?.hidden) render();
  }
};

// Pulihkan login dari penyimpanan perangkat, lalu cek diam-diam ke server (nama/kelas bisa berubah; token bisa sudah dicabut).
function restoreLogin() {
  if (S.viewer) return;
  const d = readDeviceLogin();
  if (!d) return;
  S.viewer = { id: d.id, name: d.name, grade: d.grade, classLevel: d.classLevel, pin: d.token };
  studyCall("player_verify", { playerId: d.id, pin: d.token }).then((res) => {
    if (!res.ok) {
      if (res.status === 404) {
        clearDeviceLogin();
        if (S.viewer && S.viewer.id === d.id) S.viewer = null;
        render();
      }
      return;
    }
    if (S.viewer && S.viewer.id === d.id && S.viewer.pin === d.token) {
      S.viewer = { ...res.player, pin: d.token };
      saveDeviceLogin(S.viewer);
      render();
    }
  });
}

// Buka profil pribadi akun yang sedang masuk (tanpa PIN).
function openOwnProfile() {
  const v = S.viewer;
  if (!v) return;
  S.player = { id: v.id, name: v.name, grade: v.grade, classLevel: v.classLevel ?? null };
  S.pin = v.pin;
  S.profile = null;
  S.stack = [];
  S.pub = null;
  S.view = "profile";
  render();
  loadProfile();
}

async function openNewPlayerForm() {
  const created = await openFormDialog({
    title: L("study_np_title"),
    okLabel: L("study_np_ok"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_busy_saving"),
    fields: [
      { key: "name", label: L("study_np_name"), type: "text", maxlength: 30 },
      { key: "grade", label: L("study_np_grade"), type: "select", value: "SD", options: gradeOptions() },
      classField((v) => v.grade, (v) => classesOf(v.grade)),
      { key: "pin", label: L("study_np_pin"), type: "pin" },
      { key: "pin2", label: L("study_np_pin2"), type: "pin" }
    ],
    onSubmit: async (v) => {
      if (!String(v.name || "").trim()) return { ok: false, error: L("study_np_name_required") };
      if (!validPinFormat(v.pin)) return { ok: false, error: L("study_pin_invalid") };
      if (v.pin !== v.pin2) return { ok: false, error: L("study_np_mismatch") };
      const res = await studyCall("player_create", { name: v.name, grade: v.grade, classLevel: classValue(v.grade, v.classLevel), pin: v.pin });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: res.player };
    }
  });
  if (created) {
    window.alert(L("study_np_done", { name: created.name }));
    loadOverview();
  }
}

function openPlayerPin(playerId) {
  const player = (S.overview?.players || []).find((p) => p.id === playerId);
  if (!player) return;
  if (S.viewer && S.viewer.id === playerId) return openOwnProfile(); // sudah masuk di perangkat ini
  return openFormDialog({
    title: L("study_pin_title", { name: player.name }),
    okLabel: L("study_open"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_loading"),
    fields: [{ key: "pin", label: L("study_pin"), type: "pin" }],
    extra: [{ label: L("study_forgot_pin"), onClick: () => openResetPin(player) }],
    onSubmit: async (v) => {
      if (!validPinFormat(v.pin)) return { ok: false, error: L("study_pin_invalid") };
      const res = await studyCall("player_profile", { playerId: player.id, pin: v.pin });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: { res, pin: v.pin } };
    }
  }).then(async (out) => {
    if (!out) return;
    S.player = out.res.player;
    S.pin = await adoptLogin(out.res.player, out.pin);
    S.profile = out.res;
    S.stack = [];
    S.pub = null;
    S.view = "profile";
    render();
  });
}

// Ubah grade/kelas sendiri (naik kelas atau ralat). Butuh PIN orang tua bila sudah dibuat,
// karena menurunkan kelas membuka materi yang lebih rendah.
// ---- ganti / hapus foto profil (hanya profil sendiri: S.player + S.pin)
function setAvatarLocal(id, url) {
  const pl = (S.overview?.players || []).find((p) => p.id === id);
  if (pl) pl.avatarUrl = url || null;
}

function pickAvatar() {
  const me = S.player;
  if (!me || S.avatarBusy) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*"; // tanpa "capture": peramban menawarkan galeri (dan kamera) sesuai perangkat
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    S.avatarBusy = true;
    S.avatarMsg = L("study_photo_busy");
    render();
    try {
      let image;
      try {
        image = await fileToAvatarBase64(file);
      } catch (e) {
        S.avatarMsg = e && e.message === "size" ? L("study_photo_err_size") : L("study_photo_err_read");
        return;
      }
      const res = await studyCall("player_avatar_set", { playerId: me.id, pin: S.pin, image });
      if (!res.ok) {
        S.avatarMsg = errText(res);
        return;
      }
      setAvatarLocal(me.id, res.avatarUrl);
      S.avatarMsg = L("study_photo_saved");
      if (S.feed) S.feed.stale = true;
    } finally {
      S.avatarBusy = false;
      render();
    }
  });
  input.click();
}

async function removeAvatar() {
  const me = S.player;
  if (!me || S.avatarBusy) return;
  if (!window.confirm(L("study_photo_remove_confirm"))) return;
  S.avatarBusy = true;
  S.avatarMsg = L("study_photo_busy");
  render();
  const res = await studyCall("player_avatar_remove", { playerId: me.id, pin: S.pin });
  S.avatarBusy = false;
  if (res.ok) {
    setAvatarLocal(me.id, null);
    S.avatarMsg = L("study_photo_removed");
  } else {
    S.avatarMsg = errText(res);
  }
  render();
}

function openEditLevel() {
  const me = S.player;
  if (!me) return;
  const parentSet = !!S.overview?.settings?.parentPinSet;
  return openFormDialog({
    title: L("study_edit_level_title"),
    intro: parentSet ? L("study_edit_level_intro_parent") : L("study_edit_level_intro"),
    okLabel: L("study_save"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_busy_saving"),
    fields: [
      { key: "grade", label: L("study_np_grade"), type: "select", value: me.grade, options: gradeOptions() },
      classField((v) => v.grade, (v) => classesOf(v.grade), (v) => (v.grade === me.grade && me.classLevel ? String(me.classLevel) : undefined), me.classLevel),
      ...(parentSet ? [{ key: "parentPin", label: L("study_parent_pin"), type: "pin" }] : [])
    ],
    onSubmit: async (v) => {
      if (parentSet && !validPinFormat(v.parentPin)) return { ok: false, error: L("study_pin_invalid") };
      const res = await studyCall("player_update_level", {
        playerId: me.id,
        pin: S.pin,
        grade: v.grade,
        classLevel: classValue(v.grade, v.classLevel),
        parentPin: v.parentPin
      });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: res.player };
    }
  }).then((player) => {
    if (!player) return;
    S.player = { ...S.player, grade: player.grade, classLevel: player.classLevel ?? null };
    if (S.viewer && S.viewer.id === player.id) S.viewer = { ...S.viewer, grade: player.grade, classLevel: player.classLevel ?? null };
    loadOverview();
    loadProfile();
  });
}

// Reset PIN pemain: butuh PIN orang tua (bila sudah dibuat) + PIN baru.
function openResetPin(player) {
  const parentSet = !!S.overview?.settings?.parentPinSet;
  return openFormDialog({
    title: L("study_reset_title", { name: player.name }),
    intro: parentSet ? L("study_reset_intro_parent") : L("study_reset_intro_open"),
    okLabel: L("study_reset_ok"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_busy_saving"),
    fields: [
      ...(parentSet ? [{ key: "parentPin", label: L("study_parent_pin"), type: "pin" }] : []),
      { key: "newPin", label: L("study_new_pin"), type: "pin" },
      { key: "newPin2", label: L("study_new_pin2"), type: "pin" }
    ],
    onSubmit: async (v) => {
      if (!validPinFormat(v.newPin)) return { ok: false, error: L("study_pin_invalid") };
      if (v.newPin !== v.newPin2) return { ok: false, error: L("study_np_mismatch") };
      const res = await studyCall("pin_reset", { playerId: player.id, newPin: v.newPin, parentPin: v.parentPin });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true };
    }
  }).then((ok) => {
    if (ok) window.alert(L("study_reset_done", { name: player.name }));
    return ok;
  });
}

// ---------------------------------------------------------------- pelajaran baru
function openLessonForm(fixedPlayer) {
  const ov = S.overview;
  const settings = ov?.settings;
  if (!settings) return;
  const players = ov.players || [];
  if (!fixedPlayer && players.length === 0) {
    window.alert(L("study_no_players"));
    return;
  }
  const playerById = (id) => players.find((p) => p.id === id) || (fixedPlayer && fixedPlayer.id === id ? fixedPlayer : null);
  const subjects = settings.subjects || [];
  const lessonSettings = settings;
  const perQ = lessonSettings.perQuestionPoints ?? 10;
  const bonus = lessonSettings.perfectBonusPercent ?? 0;
  const spq = lessonSettings.secondsPerQuestion ?? 0;
  const maxPoints = (level, count) => computePoints(perQ, count, count, lessonSettings.weights[level] ?? 100, bonus);
  fixedPlayer = fixedPlayer || loggedIn(players); // sudah masuk di perangkat ini: tanpa pilih pemain + PIN
  const fixed = !!fixedPlayer;

  return openFormDialog({
    title: L("study_lesson_title"),
    okLabel: L("study_start"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_generating"),
    fields: [
      {
        key: "playerId",
        label: L("study_player"),
        type: "select",
        value: fixedPlayer?.id || players[0]?.id,
        options: players.map((p) => ({ value: p.id, label: `${p.name} (${gradeText(p.grade, p.classLevel)})` })),
        show: () => !fixed
      },
      { key: "pin", label: L("study_pin"), type: "pin", show: () => !fixed },
      {
        key: "subject",
        label: L("study_subject"),
        type: "select",
        value: subjects[0] || CUSTOM,
        options: [...subjects.map((s) => ({ value: s, label: s })), { value: CUSTOM, label: L("study_subject_custom") }]
      },
      { key: "customSubject", label: L("study_subject_custom_label"), type: "text", maxlength: 60, show: (v) => v.subject === CUSTOM },
      { key: "topic", label: L("study_topic"), type: "text", maxlength: 100, placeholder: L("study_topic_ph") },
      {
        key: "materialGrade",
        label: L("study_material_grade"),
        type: "select",
        value: (fixedPlayer || players[0])?.grade,
        options: (v) => {
          const pl = playerById(fixed ? fixedPlayer.id : v.playerId);
          return allowedMaterialGrades(pl?.grade || "Umum").map((g) => ({ value: g, label: g }));
        },
        onOptionsChange: (v) => playerById(fixed ? fixedPlayer.id : v.playerId)?.grade,
        help: L("study_grade_help")
      },
      classField(
        (v) => v.materialGrade,
        (v) => {
          const pl = playerById(fixed ? fixedPlayer.id : v.playerId);
          return allowedClasses(pl?.grade || "Umum", pl?.classLevel, v.materialGrade);
        },
        (v) => {
          const pl = playerById(fixed ? fixedPlayer.id : v.playerId);
          return pl && pl.grade === v.materialGrade && pl.classLevel ? String(pl.classLevel) : undefined;
        },
        (fixedPlayer || players[0])?.classLevel
      ),
      {
        key: "count",
        label: L("study_count"),
        type: "select",
        value: "10",
        options: COUNTS.map((n) => ({ value: String(n), label: String(n) })),
        help: (v) => {
          const secs = timeLimitSeconds(Number(v.count || 10), spq);
          return secs ? L("study_time_estimate", { m: Math.ceil(secs / 60), s: spq }) : L("study_time_none");
        }
      },
      {
        key: "level",
        label: L("study_level"),
        type: "select",
        value: "normal",
        options: ["easy", "normal", "hard"].map((lv) => ({ value: lv, label: levelLabel(lv, lessonSettings) })),
        help: (v) => {
          const n = fmt(maxPoints(v.level || "normal", Number(v.count || 10)));
          return bonus > 0 ? L("study_max_points_bonus", { n, b: bonus }) : L("study_max_points", { n });
        }
      }
    ],
    extra: fixed
      ? []
      : [
          {
            label: L("study_forgot_pin"),
            onClick: (v) => {
              const pl = playerById(v.playerId);
              if (pl) openResetPin(pl);
            }
          }
        ],
    onSubmit: async (v) => {
      const pl = playerById(fixed ? fixedPlayer.id : v.playerId);
      if (!pl) return { ok: false, error: L("study_pick_player") };
      const pin = fixed ? credOf(pl) : v.pin;
      if (!validCred(pin)) return { ok: false, error: L("study_pin_invalid") };
      const subject = v.subject === CUSTOM ? String(v.customSubject || "").trim() : v.subject;
      if (!subject) return { ok: false, error: L("study_subject_required") };
      const res = await studyCall("session_start", {
        playerId: pl.id,
        pin,
        subject,
        topic: String(v.topic || "").trim(),
        materialGrade: v.materialGrade,
        materialClass: classValue(v.materialGrade, v.materialClass ?? v.classLevel),
        level: v.level,
        count: Number(v.count),
        engine: "auto"
      });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: { res, player: pl, pin } };
    }
  }).then(enterQuiz);
}

// Setelah sesi dibuat (pelajaran baru atau latihan materi): simpan pemain + PIN dan buka layar soal.
async function enterQuiz(out) {
  if (!out) return;
  S.player = { id: out.player.id, name: out.player.name, grade: out.player.grade, classLevel: out.player.classLevel ?? null };
  S.pin = await adoptLogin(S.player, out.pin);
  S.quiz = {
    sessionId: out.res.sessionId,
    session: out.res.session,
    questions: out.res.questions,
    answers: new Array(out.res.questions.length).fill(null),
    shortfall: out.res.shortfall || 0
  };
  armQuizTimer(S.quiz);
  S.autoSubmittedId = "";
  saveAnswers(S.quiz.sessionId, S.quiz.answers);
  S.view = "quiz";
  render();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- latihan dari materi
// 10 soal yang dibuat AI dari isi materi; pelajaran, tingkat, dan kelas mengikuti materinya. Hasilnya = pelajaran biasa
// (poin, timer, pembahasan) dan tampil di timeline dengan penanda "Latihan".
async function openPracticeForm(material) {
  if (!material) return;
  const ov = S.overview;
  if (!ov?.settings) {
    window.alert(S.overviewError || L("study_loading"));
    return;
  }
  const players = (ov.players || []).filter((p) => allowedMaterialGrades(p.grade).includes(material.grade));
  if (players.length === 0) {
    window.alert(L("study_practice_no_player", { grade: material.grade }));
    return;
  }
  const settings = ov.settings;
  const perQ = settings.perQuestionPoints ?? 10;
  const bonus = settings.perfectBonusPercent ?? 0;
  const spq = settings.secondsPerQuestion ?? 0;
  const n = PRACTICE_COUNT;
  const playerById = (id) => players.find((p) => p.id === id);
  const fixed = loggedIn(players); // sudah masuk di perangkat ini: tanpa pilih pemain + PIN
  const out = await openFormDialog({
    title: L("study_practice_title"),
    intro: L("study_practice_intro", { title: material.title, n, subject: material.subject, grade: gradeText(material.grade, material.classLevel) }),
    okLabel: L("study_start"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_generating"),
    fields: [
      {
        key: "playerId",
        label: L("study_player"),
        type: "select",
        value: (fixed || players[0]).id,
        options: players.map((p) => ({ value: p.id, label: `${p.name} (${gradeText(p.grade, p.classLevel)})` })),
        show: () => !fixed
      },
      { key: "pin", label: L("study_pin"), type: "pin", show: () => !fixed },
      {
        key: "level",
        label: L("study_level"),
        type: "select",
        value: "normal",
        options: ["easy", "normal", "hard"].map((lv) => ({ value: lv, label: levelLabel(lv, settings) })),
        help: (v) => {
          const pts = fmt(computePoints(perQ, n, n, settings.weights[v.level || "normal"] ?? 100, bonus));
          const time = timeLimitSeconds(n, spq);
          return `${bonus > 0 ? L("study_max_points_bonus", { n: pts, b: bonus }) : L("study_max_points", { n: pts })} ${time ? L("study_time_estimate", { m: Math.ceil(time / 60), s: spq }) : L("study_time_none")}`;
        }
      }
    ],
    extra: fixed
      ? []
      : [
          {
            label: L("study_forgot_pin"),
            onClick: (v) => {
              const pl = playerById(v.playerId);
              if (pl) openResetPin(pl);
            }
          }
        ],
    onSubmit: async (v) => {
      const pl = fixed || playerById(v.playerId);
      if (!pl) return { ok: false, error: L("study_pick_player") };
      const pin = fixed ? credOf(pl) : v.pin;
      if (!validCred(pin)) return { ok: false, error: L("study_pin_invalid") };
      const res = await studyCall("session_start", { playerId: pl.id, pin, materialId: material.id, level: v.level, engine: "auto" });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: { res, player: pl, pin } };
    }
  });
  if (!out) return;
  S.stack = [];
  S.material = null;
  enterQuiz(out);
}

async function resumeLesson(sessionId) {
  const res = await studyCall("session_get", { playerId: S.player.id, pin: S.pin, sessionId });
  if (!res.ok) return handleFailure(res);
  if (res.status === "submitted") {
    S.result = res.result;
    S.explainFailed = res.result.items.some((i) => !i.explanation);
    S.resultFrom = "profile";
    S.view = "result";
    render();
    return;
  }
  S.quiz = {
    sessionId,
    session: res.session,
    questions: res.questions,
    answers: loadAnswers(sessionId, res.questions.length),
    shortfall: 0
  };
  armQuizTimer(S.quiz);
  S.view = "quiz";
  render();
  window.scrollTo(0, 0);
}

async function viewResult(sessionId) {
  const res = await studyCall("session_get", { playerId: S.player.id, pin: S.pin, sessionId });
  if (!res.ok) return handleFailure(res);
  if (res.status !== "submitted") return resumeLesson(sessionId);
  S.result = res.result;
  S.explainFailed = res.result.items.some((i) => !i.explanation);
  S.resultFrom = "profile";
    S.view = "result";
  render();
  window.scrollTo(0, 0);
}

async function cancelLesson(sessionId) {
  if (!window.confirm(L("study_cancel_confirm"))) return;
  const res = await studyCall("session_cancel", { playerId: S.player.id, pin: S.pin, sessionId });
  if (!res.ok) return handleFailure(res);
  clearAnswers(sessionId);
  loadProfile();
}

// ---------------------------------------------------------------- kumpulkan & hasil
async function submitQuiz(btn, auto = false) {
  const q = S.quiz;
  if (!q || q.submitting) return;
  const unanswered = q.answers.filter((a) => a === null).length;
  // waktu habis: kumpulkan langsung tanpa bertanya (yang kosong dihitung salah)
  if (!auto && unanswered > 0 && !window.confirm(L("study_unanswered_confirm", { n: unanswered }))) return;
  q.submitting = true;
  const old = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = L("study_submit_busy");
  }
  if (q.kind === "room") return submitRoomQuiz(q, btn, old, auto);
  const res = await studyCall("session_submit", { playerId: S.player.id, pin: S.pin, sessionId: q.sessionId, answers: q.answers, engine: "auto" });
  q.submitting = false;
  const btnNow = $("study-submit-btn");
  if (btnNow) {
    btnNow.disabled = false;
    btnNow.textContent = old || L("study_submit");
  }
  if (!res.ok) return handleFailure(res);
  clearAnswers(q.sessionId);
  if (S.feed) S.feed.stale = true;
  S.autoSubmittedId = auto ? q.sessionId : "";
  S.quiz = null;
  S.result = res.daily ? { ...res.result, daily: res.daily } : res.result;
  syncToday(S.player.id, res.daily);
  S.explainFailed = !!res.explainFailed;
  S.resultFrom = "profile";
    S.view = "result";
  render();
  window.scrollTo(0, 0);
}

// Kumpulkan jawaban kompetisi. Setelah itu layar room menampilkan "menunggu" atau tabel hasil.
async function submitRoomQuiz(q, btn, oldLabel, auto) {
  const rm = S.room;
  const res = rm ? await studyCall("room_submit", { playerId: rm.creds.id, pin: rm.creds.pin, roomId: q.roomId, answers: q.answers }) : { ok: false, message: "Error" };
  q.submitting = false;
  const btnNow = $("study-submit-btn");
  if (btnNow) {
    btnNow.disabled = false;
    btnNow.textContent = oldLabel || L("study_submit");
  }
  if (!res.ok) {
    if (res.status === 404 && S.room === rm) return roomGone();
    return handleFailure(res);
  }
  clearAnswers(q.sessionId);
  S.autoSubmittedId = auto ? q.roomId : "";
  S.quiz = null;
  S.view = "room";
  window.scrollTo(0, 0);
  applyRoomState(res.state);
  render();
}

async function retryExplain(btn) {
  if (!S.result) return;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = L("study_submit_busy");
  const res = await studyCall("session_explain", { playerId: S.player.id, pin: S.pin, sessionId: S.result.session.id, engine: "auto" });
  btn.disabled = false;
  btn.textContent = old;
  if (!res.ok) return handleFailure(res);
  S.result = S.result.daily ? { ...res.result, daily: S.result.daily } : res.result;
  S.explainFailed = !!res.explainFailed;
  render();
}

async function sharePdf(btn) {
  if (!S.result) return;
  btn.disabled = true;
  try {
    const doc = buildStudyPdf(S.result, L, locale());
    await shareOrSaveStudyPdf(doc, S.result, `${L("study_pdf_title")}: ${S.result.session.subject}`);
  } catch (err) {
    window.alert(`${L("study_pdf_failed")} (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    btn.disabled = false;
  }
}

// ---- kartu gambar (PNG) untuk galeri / WhatsApp
async function shareCardSafely(btn, make, name, title) {
  btn.disabled = true;
  try {
    const canvas = await make();
    await shareOrSaveCard(canvas, name, title);
  } catch (err) {
    window.alert(`${L("study_card_failed")} (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    btn.disabled = false;
  }
}

function shareLessonCard(btn) {
  const r = S.result;
  if (!r) return Promise.resolve();
  const s = r.session;
  const when = s.submittedAt ? new Date(s.submittedAt) : new Date();
  const make = () =>
    renderLessonCard({
      brand: L("brand"),
      dateText: when.toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" }),
      title: s.subject || "",
      topic: s.topic || "",
      player: r.player?.name || "",
      meta: `${gradeText(r.player?.grade || "", r.player?.classLevel)} · ${gradeText(s.materialGrade || "", s.materialClass)} · ${L(`study_level_${s.level}`)} (${r.weightPercent}%)`,
      big: `${r.correct}/${r.total}`,
      scoreLabel: L("study_score", { c: r.correct, n: r.total }),
      points: `+${fmt(r.points)}`,
      ptsUnit: L("study_pts"),
      formula: pointsFormula(r, L),
      bonus: r.bonusPercent > 0 ? L("study_bonus_line", { b: r.bonusPercent }) : "",
      flags: (r.items || []).map((it) => (it.userAnswer === null || it.userAnswer === undefined ? "n" : it.isCorrect ? "c" : "w")),
      footer: L("study_card_footer", { name: L("brand") })
    });
  return shareCardSafely(btn, make, studyCardFileName(r.player?.name, s.subject, when), `${L("study_pdf_title")}: ${s.subject}`);
}

function shareRoomCard(btn) {
  const room = S.view === "roomresult" ? S.rr?.room : S.room?.state?.room;
  const results = S.view === "roomresult" ? S.rr?.results : S.room?.state?.results;
  if (!room) return Promise.resolve();
  const LIMIT = 10;
  const list = results || [];
  const rows = list.slice(0, LIMIT).map((x) => ({
    rank: String(x.rank),
    name: x.name,
    sub: `${gradeText(x.grade, x.classLevel)}${x.timedOut ? ` · ${L("study_room_timedout")}` : ""}`,
    score: `${x.correct}/${x.total}`,
    time: x.seconds == null ? "-" : formatClock(x.seconds),
    points: fmt(x.points + x.bonus),
    isWinner: x.bonus > 0
  }));
  const make = () =>
    renderRoomCard({
      brand: L("brand"),
      badge: L("study_kind_competition"),
      title: `${room.subject}${room.topic ? ` · ${room.topic}` : ""}`,
      info: `${gradeText(room.materialGrade, room.materialClass)} · ${L(`study_level_${room.level}`)} (${room.weightPercent}%) · ${room.numQuestions} ${L("study_questions_unit")} · ${L("study_feed_minutes", { m: roomMinutes(room) })}`,
      creator: L("study_room_by", { name: room.creatorName }),
      winner: room.winnerName ? L("study_room_winner", { name: room.winnerName }) : L("study_room_no_winner"),
      winnerSub: room.winnerName ? L("study_room_bonus_line", { b: fmt(room.winBonus) }) : "",
      cols: { name: L("study_col_name"), score: L("study_col_score"), time: L("study_col_time"), points: L("study_col_points") },
      rows,
      more: list.length > LIMIT ? L("study_card_more", { n: list.length - LIMIT }) : "",
      footer: L("study_card_footer", { name: L("brand") })
    });
  return shareCardSafely(btn, make, studyCardFileName(L("study_kind_competition"), room.subject), `${L("study_kind_competition")}: ${room.subject}`);
}

// ================================================================ Timeline global, profil publik, suka, komentar, detil
const COMMENT_MAX = 300;

const viewerParams = () => (S.viewer ? { viewerId: S.viewer.id, viewerPin: S.viewer.pin } : {});
const fmtDateTime = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const initial = (name) => esc(String(name || "?").trim().charAt(0).toUpperCase() || "?");

// ---- foto profil: URL dari overview (players[].avatarUrl), huruf awal bila belum punya foto atau gagal dimuat
const avatarUrlOf = (id) => (id ? (S.overview?.players || []).find((p) => p.id === id)?.avatarUrl || "" : "");
function avatarHtml(id, name, cls = "", hidden = false) {
  const url = avatarUrlOf(id);
  const inner = url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" data-initial="${initial(name)}">` : initial(name);
  return `<span class="study-avatar ${cls} ${url ? "has-img" : ""}"${hidden ? ' aria-hidden="true"' : ""}>${inner}</span>`;
}
const keyOf = (it) => `${it.kind}:${it.id}`;
const splitKey = (k) => {
  const i = String(k).indexOf(":");
  return { kind: k.slice(0, i), id: k.slice(i + 1) };
};
// Satu "feed" = satu daftar kartu kegiatan (timeline global di beranda, atau milik satu pemain di profil publik).
const newFeed = (ownerId, kinds) => ({ ownerId: ownerId || null, kinds: kinds || null, items: [], hasMore: false, loading: false, loaded: false, error: "", stale: false, comments: {}, drafts: {} });

// Feed yang sedang tampil di layar (sasaran semua aksi kartu).
function shownFeed() {
  if (S.view === "home" && S.tab === "timeline") return S.feed;
  if (S.view === "public" && S.pub) return S.pub.feeds[S.pub.sub];
  return null;
}
const feedItemByKey = (key) => shownFeed()?.items.find((i) => keyOf(i) === key);
const ownerIdOf = (it) => (it.kind === "lesson" ? it.playerId : it.kind === "material" ? it.creatorId : null);
const isOwnItem = (it) => !!S.viewer && !!ownerIdOf(it) && S.viewer.id === ownerIdOf(it);

// Tumpukan layar: layar yang dibuka dari kartu/baris (profil publik, hasil, materi, daftar room) kembali ke tempat asalnya.
function pushView() {
  S.stack.push({ view: S.view, scroll: window.scrollY, pub: S.pub, rr: S.rr, material: S.material });
}
function popView() {
  const e = S.stack.pop();
  if (!e) return false;
  S.view = e.view;
  S.pub = e.pub;
  S.rr = e.rr;
  S.material = e.material;
  render();
  window.scrollTo(0, e.scroll || 0);
  // kembali ke beranda: papan peringkat & setting disegarkan diam-diam (poin baru, PIN orang tua, dll.)
  if (e.view === "home") loadOverviewQuiet().then(() => S.view === "home" && render());
  return true;
}

// PIN penonton salah/terkunci (mis. PIN direset): lupakan penonton supaya bisa masuk lagi.
function viewerFailure(res) {
  if (res.pinWrong || res.locked) {
    S.viewer = null;
    render();
  }
  handleFailure(res);
}

function rerenderIfShown(feed) {
  if (shownFeed() === feed) render();
}

// mode: "first" (kosongkan lalu muat), "refresh" (muat ulang, isi lama tetap tampil sampai data baru datang), "more" (halaman berikutnya)
async function loadFeed(feed, mode = "first") {
  if (!feed || feed.loading) return;
  feed.loading = true;
  feed.error = "";
  feed.stale = false;
  if (mode === "first") {
    feed.items = [];
    feed.hasMore = false;
  }
  rerenderIfShown(feed);
  const last = feed.items[feed.items.length - 1];
  const res = await studyCall("feed", {
    ownerId: feed.ownerId || undefined,
    kinds: feed.kinds || undefined,
    before: mode === "more" ? last?.at : undefined,
    ...viewerParams()
  });
  feed.loading = false;
  if (!res.ok) {
    if (res.pinWrong || res.locked) S.viewer = null;
    feed.error = errText(res);
  } else if (mode === "more") {
    const have = new Set(feed.items.map(keyOf));
    feed.items = feed.items.concat(res.items.filter((i) => !have.has(keyOf(i))));
    feed.hasMore = res.hasMore;
  } else {
    feed.items = res.items;
    feed.hasMore = res.hasMore;
    feed.loaded = true;
  }
  rerenderIfShown(feed);
}

// Ambil ulang semua kartu yang sudah tampil (mis. setelah masuk, supaya status "disukai" benar).
async function refreshFeed(feed) {
  if (!feed) return;
  const want = Math.max(feed.items.length, 1);
  let items = [];
  let more = true;
  while (more && items.length < want) {
    const res = await studyCall("feed", { ownerId: feed.ownerId || undefined, kinds: feed.kinds || undefined, before: items.length ? items[items.length - 1].at : undefined, ...viewerParams() });
    if (!res.ok) return viewerFailure(res);
    items = items.concat(res.items);
    more = res.hasMore;
  }
  feed.items = items;
  feed.hasMore = more;
  feed.loaded = true;
  rerenderIfShown(feed);
}

// ---- profil publik (tanpa PIN: hanya prestasi, bukan saldo/redeem/hukuman)
function openPublic(playerId) {
  if (!playerId) return;
  if (S.view === "public" && S.pub?.id === playerId) return;
  pushView();
  const pub = {
    id: playerId,
    player: null,
    stats: null,
    error: "",
    sub: "all",
    feeds: { all: newFeed(playerId, null), lesson: newFeed(playerId, ["lesson"]), competition: newFeed(playerId, ["competition"]) }
  };
  S.pub = pub;
  S.view = "public";
  render();
  window.scrollTo(0, 0);
  loadPublic(pub);
}

async function loadPublic(pub) {
  pub.error = "";
  loadFeed(pub.feeds.all, "first");
  const res = await studyCall("player_public", { playerId: pub.id });
  if (res.ok) {
    pub.player = res.player;
    pub.stats = res.stats;
    pub.today = res.today || null;
  } else {
    pub.error = errText(res);
  }
  if (S.view === "public" && S.pub === pub) render();
}

function switchPubTab(sub) {
  const pub = S.pub;
  if (!pub || !pub.feeds[sub]) return;
  pub.sub = sub;
  render();
  const f = pub.feeds[sub];
  if (!f.loaded && !f.loading) loadFeed(f, "first");
}

function openProfileFromPublic() {
  const o = S.pub?.player;
  if (!o) return;
  if (S.viewer && S.viewer.id === o.id) return openOwnProfile();
  return openPlayerPin(o.id);
}

// ---- masuk sebagai penonton
function openViewerLogin() {
  const players = S.overview?.players || [];
  if (!players.length) return Promise.resolve(false);
  const first = S.viewer ? players.find((p) => p.id === S.viewer.id) || players[0] : players.find((p) => p.id !== S.pub?.player?.id) || players[0];
  return openFormDialog({
    title: L("study_signin_title"),
    okLabel: L("study_signin_ok"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_loading"),
    fields: [
      { key: "playerId", label: L("study_player"), type: "select", value: first.id, options: players.map((p) => ({ value: p.id, label: `${p.name} (${gradeText(p.grade, p.classLevel)})` })) },
      { key: "pin", label: L("study_pin"), type: "pin" }
    ],
    extra: [
      {
        label: L("study_forgot_pin"),
        onClick: (v) => {
          const pl = players.find((p) => p.id === v.playerId);
          if (pl) openResetPin(pl);
        }
      }
    ],
    onSubmit: async (v) => {
      if (!validPinFormat(v.pin)) return { ok: false, error: L("study_pin_invalid") };
      const res = await studyCall("login", { playerId: v.playerId, pin: v.pin });
      if (res.ok) return { ok: true, value: { player: res.player, cred: res.token, persist: true } };
      // PIN salah / terkunci / pemain tidak ada: tolak. Gangguan lain (mis. function belum di-deploy ulang): masuk tanpa token.
      if (res.pinWrong || res.locked || res.status === 404 || res.status === 403 || res.status === 429) return { ok: false, error: errText(res) };
      const old = await studyCall("player_verify", { playerId: v.playerId, pin: v.pin });
      if (!old.ok) return { ok: false, error: errText(old) };
      return { ok: true, value: { player: old.player, cred: v.pin, persist: false } };
    }
  }).then((out) => {
    if (!out) return false;
    S.viewer = { ...out.player, pin: out.cred };
    if (out.persist) saveDeviceLogin(S.viewer);
    return true;
  });
}

async function signInViewer() {
  if (!(await openViewerLogin())) return;
  await refreshFeed(shownFeed());
  render(); // di tab Leaderboard/Materi tidak ada daftar kegiatan yang disegarkan: gambar ulang supaya bilah "Masuk sebagai ..." muncul
}

function signOutViewer() {
  return logoutDevice();
}

// Pastikan sudah masuk; bila belum, tampilkan popup. true = siap.
async function ensureViewer() {
  if (S.viewer) return true;
  if (!(await openViewerLogin())) return false;
  await refreshFeed(shownFeed());
  return !!S.viewer;
}

// ---- tampilan
function viewerBarHtml() {
  if (S.viewer) {
    const cap = dailyCapOf();
    const today = cap === null ? "" : ` · ${esc(dailyLine(todayOf(S.viewer.id), cap))}`;
    return `<div class="study-viewer"><span>${esc(L("study_tl_signed_as", { name: S.viewer.name }))}${today}</span><span class="study-viewer-actions"><button type="button" class="study-link-btn" data-act="my-profile">${esc(L("study_my_profile"))}</button><button type="button" class="study-link-btn" data-act="tl-signout">${esc(L("study_tl_signout"))}</button></span></div>`;
  }
  return `<div class="study-viewer"><span>${esc(L("study_tl_signed_out"))}</span><button type="button" class="study-link-btn" data-act="tl-signin">${esc(L("study_tl_signin"))}</button></div>`;
}

function commentsHtml(it, feed) {
  const key = keyOf(it);
  const cm = feed.comments[key];
  if (!cm || !cm.open) return "";
  const isOwn = isOwnItem(it);
  const parentSet = !!S.overview?.settings?.parentPinSet;
  let list;
  if (cm.loading) list = `<p class="status-text">${esc(L("study_loading"))}</p>`;
  else if (!cm.list || cm.list.length === 0) list = `<p class="study-row-meta">${esc(L("study_comment_none"))}</p>`;
  else {
    list = cm.list
      .map((c) => {
        const mine = !!S.viewer && S.viewer.id === c.playerId;
        const del = mine
          ? `<button type="button" class="study-link-btn" data-act="comment-del" data-id="${esc(c.id)}" data-sid="${esc(key)}">${esc(L("study_comment_delete"))}</button>`
          : parentSet
            ? `<button type="button" class="study-link-btn" data-act="comment-del" data-parent="1" data-id="${esc(c.id)}" data-sid="${esc(key)}">${esc(L("study_comment_delete_parent"))}</button>`
            : "";
        return `
      <div class="study-comment">
        ${avatarHtml(c.playerId, c.name, "study-avatar--sm")}
        <div class="study-comment-main">
          <div class="study-comment-head"><strong>${esc(c.name)}</strong> <small>${esc(gradeText(c.grade, c.classLevel))}</small> <small>${esc(fmtDateTime(c.createdAt))}</small></div>
          <div class="study-comment-body">${esc(c.body)}</div>
          ${del}
        </div>
      </div>`;
      })
      .join("");
  }
  let composer;
  if (!S.viewer) {
    composer = `<p class="study-row-meta">${esc(L("study_comment_need_signin"))} <button type="button" class="study-link-btn" data-act="tl-signin">${esc(L("study_tl_signin"))}</button></p>`;
  } else if (isOwn) {
    composer = `<p class="study-row-meta">${esc(L("study_comment_own"))}</p>`;
  } else {
    composer = `
      <div class="study-composer">
        <textarea rows="2" maxlength="${COMMENT_MAX}" data-draft="${esc(key)}" placeholder="${esc(L("study_comment_ph"))}" aria-label="${esc(L("study_comment_ph"))}">${esc(feed.drafts[key] || "")}</textarea>
        <button type="button" class="primary-btn" data-act="comment-send" data-id="${esc(key)}" ${cm.sending ? "disabled" : ""}>${esc(L("study_comment_send"))}</button>
      </div>`;
  }
  return `<div class="study-comments">${list}${composer}</div>`;
}

const topicText = (it) => (it.topic ? ` · ${esc(it.topic)}` : "");
const nameBtn = (id, name) => (id ? `<button type="button" class="study-name-btn" data-act="open-public" data-id="${esc(id)}">${esc(name)}</button>` : `<span class="study-name-btn is-static">${esc(name)}</span>`);

// Isi khusus tiap jenis kegiatan: { who, whoId, grade, text, chips, extra }
function cardParts(it) {
  if (it.kind === "competition") {
    const minutes = Math.max(1, Math.round((it.timeLimitSeconds || 0) / 60));
    const top = (it.top || [])
      .map((x) => `<li class="study-top-row"><span class="study-rank">${x.rank}</span><span class="study-top-name">${esc(x.name)}</span><span>${x.correct}/${it.total}</span><span class="study-pts">${fmt(x.points)}</span></li>`)
      .join("");
    const winner = it.winnerName ? esc(L("study_feed_winner", { name: it.winnerName, b: fmt(it.winBonus) })) : esc(L("study_feed_nowinner"));
    const me = it.me
      ? `<div class="study-feed-me">${esc(L("study_feed_me", { rank: it.me.rank, score: `${it.me.correct}/${it.total}`, pts: fmt((it.me.points || 0) + (it.me.bonus || 0)) }))}</div>`
      : "";
    return {
      who: it.creatorName,
      whoId: it.creatorId || null,
      grade: "",
      text: `<span class="study-kind">${esc(L("study_kind_competition"))}</span> <strong>${esc(it.subject)}</strong>${topicText(it)} <span class="study-row-meta">${esc(L("study_feed_comp_by", { name: it.creatorName }))}</span>`,
      chips: `<span class="study-badge">${esc(L(`study_level_${it.level}`))}</span><span class="study-badge">${esc(gradeText(it.materialGrade, it.materialClass))}</span><span class="study-badge">${esc(L("study_feed_players", { n: it.players }))}</span><span class="study-badge">${it.total} ${esc(L("study_questions_unit"))}</span><span class="study-badge">${esc(L("study_feed_minutes", { m: minutes }))}</span>`,
      extra: `${top ? `<ol class="study-top">${top}</ol>` : ""}<div class="study-feed-winner">${winner}</div>${me}`
    };
  }
  if (it.kind === "material") {
    return {
      who: it.creatorName,
      whoId: it.creatorId,
      grade: "",
      text: `<span class="study-kind">${esc(L("study_kind_material"))}</span> <strong>${esc(it.creatorName)}</strong> ${esc(L("study_feed_mat_text"))}: <strong>${esc(it.title)}</strong>`,
      chips: `<span class="study-badge">${esc(it.subject)}</span><span class="study-badge">${esc(gradeText(it.grade, it.classLevel))}</span>`,
      extra: it.detail ? `<p class="study-material-detail">${esc(it.detail)}</p>` : ""
    };
  }
  return {
    who: it.playerName,
    whoId: it.playerId,
    grade: gradeText(it.grade, it.classLevel),
    text: it.materialTitle
      ? `<span class="study-kind">${esc(L("study_kind_practice"))}</span> <strong>${esc(it.playerName)}</strong> ${esc(L("study_tl_practiced"))} <strong>${esc(it.materialTitle)}</strong>`
      : `<strong>${esc(it.playerName)}</strong> ${esc(L("study_tl_finished"))} <strong>${esc(it.subject)}</strong>${topicText(it)}`,
    chips: `${it.materialTitle ? `<span class="study-badge">${esc(it.subject)}</span>` : ""}<span class="study-badge">${esc(L(`study_level_${it.level}`))} (${it.weightPercent}%)</span><span class="study-badge">${esc(gradeText(it.materialGrade, it.materialClass))}</span><span class="study-badge study-badge--solid">${esc(L("study_score", { c: it.correct, n: it.total }))}</span><span class="study-post-points">+${fmt(it.points)} ${esc(L("study_pts"))}</span>`,
    extra: ""
  };
}

// Ikon garis (monokrom, mengikuti warna teks): suka, komentar, buka.
const ICONS = {
  like: '<svg class="study-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-8-4.9-8-10.7A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.8c0 5.8-8 10.7-8 10.7z"/></svg>',
  comment: '<svg class="study-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.5-4.6A8 8 0 1 1 20.5 11.5z"/></svg>',
  camera: '<svg class="study-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z"/><circle cx="12" cy="13" r="3.2"/></svg>',
  open: '<svg class="study-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8.5 7H17v8.5"/></svg>'
};

function postHtml(it, feed) {
  const key = keyOf(it);
  const isOwn = isOwnItem(it);
  const cm = feed.comments[key];
  const p = cardParts(it);
  const detailLabel = it.kind === "competition" ? L("study_view_result") : it.kind === "material" ? L("study_mat_view") : L("study_detail_btn");
  const hasReplies = it.commentCount > 0 || !!(cm && cm.open);
  return `
  <article class="study-post study-post--${esc(it.kind)}" data-card="${esc(key)}">
    <div class="study-post-side">
      ${avatarHtml(p.whoId, p.who)}
      ${hasReplies ? '<span class="study-thread-line" aria-hidden="true"></span>' : ""}
    </div>
    <div class="study-post-main">
      <header class="study-post-head">
        <div class="study-post-name">${nameBtn(p.whoId, p.who)} ${p.grade ? `<small>${esc(p.grade)}</small>` : ""}</div>
        <time class="study-post-time">${esc(fmtDateTime(it.at))}</time>
      </header>
      <p class="study-post-text">${p.text}</p>
      <div class="study-post-chips">${p.chips}</div>
      ${p.extra}
      <div class="study-post-actions">
        <button type="button" class="study-post-btn ${it.liked ? "is-on" : ""}" data-act="like" data-id="${esc(key)}" aria-pressed="${it.liked ? "true" : "false"}" ${isOwn ? "disabled" : ""}>${ICONS.like}<span>${esc(L(it.liked ? "study_liked" : "study_like"))}</span></button>
        <button type="button" class="study-post-btn ${cm && cm.open ? "is-on" : ""}" data-act="comments" data-id="${esc(key)}" aria-expanded="${cm && cm.open ? "true" : "false"}">${ICONS.comment}<span>${esc(L("study_comment_btn"))}</span></button>
        <button type="button" class="study-post-btn" data-act="detail" data-id="${esc(key)}">${ICONS.open}<span>${esc(detailLabel)}</span></button>
      </div>
      <div class="study-post-counts"><span>${esc(L("study_likes_count", { n: fmt(it.likeCount) }))}</span><span>${esc(L("study_comments_count", { n: fmt(it.commentCount) }))}</span></div>
      ${commentsHtml(it, feed)}
    </div>
  </article>`;
}

function updateCard(key) {
  const feed = shownFeed();
  const it = feedItemByKey(key);
  const el = $("study-body")?.querySelector(`[data-card="${CSS.escape(key)}"]`);
  if (!feed || !it || !el) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = postHtml(it, feed).trim();
  el.replaceWith(tmp.firstElementChild);
}

// Daftar kartu + status muat/galat/kosong/halaman berikutnya.
function feedBodyHtml(feed, emptyKey = "study_feed_empty") {
  if (feed.error && feed.items.length === 0) {
    return `<div class="study-card"><p>${esc(feed.error)}</p><div class="study-actions"><button type="button" class="secondary-btn" data-act="feed-reload">${esc(L("study_reload"))}</button></div></div>`;
  }
  if (feed.loading && feed.items.length === 0) return `<p class="status-text">${esc(L("study_loading"))}</p>`;
  const cards = feed.items.map((it) => postHtml(it, feed)).join("");
  const empty = feed.loaded && feed.items.length === 0 && !feed.error ? `<p class="status-text">${esc(L(emptyKey))}</p>` : "";
  const foot = feed.hasMore
    ? `<div class="study-actions"><button type="button" class="secondary-btn" data-act="tl-more" ${feed.loading ? "disabled" : ""}>${esc(feed.loading ? L("study_loading") : L("study_tl_more"))}</button></div>`
    : feed.loading
      ? `<p class="status-text">${esc(L("study_loading"))}</p>`
      : "";
  const err = feed.error ? `<p class="study-row-meta">${esc(feed.error)}</p>` : "";
  return `${empty}${cards}${err}${foot}`;
}

function timelineHtml() {
  if (!S.feed) S.feed = newFeed(null, null);
  const composeBar = `<button type="button" class="study-compose-bar" data-act="new-lesson">${S.viewer ? avatarHtml(S.viewer.id, S.viewer.name, "study-avatar--sm", true) : '<span class="study-avatar study-avatar--sm" aria-hidden="true">+</span>'}<span class="study-compose-text">${esc(L("study_compose_ph"))}</span></button>`;
  return `${viewerBarHtml()}${composeBar}${feedBodyHtml(S.feed)}`;
}

// Tabel ringkas (profil publik, tab Solo & Kompetisi): satu baris per kegiatan, ketuk = detil.
function tableHtml(feed, kind) {
  if (feed.error && feed.items.length === 0) return feedBodyHtml(feed);
  if (feed.loading && feed.items.length === 0) return `<p class="status-text">${esc(L("study_loading"))}</p>`;
  if (feed.loaded && feed.items.length === 0) return `<p class="status-text">${esc(L(kind === "lesson" ? "study_pub_empty_solo" : "study_pub_empty_comp"))}</p>`;
  const rows = feed.items
    .map((it) => {
      const key = keyOf(it);
      if (kind === "lesson") {
        return `<button type="button" class="study-trow study-trow--solo" data-act="detail" data-id="${esc(key)}">
          <span>${esc(fmtDate(it.at))}</span>
          <span class="study-tcell-main"><strong>${esc(it.subject)}</strong><small>${esc(gradeText(it.materialGrade, it.materialClass))} · ${esc(L(`study_level_${it.level}`))}</small></span>
          <span>${it.correct}/${it.total}</span>
          <span class="study-pts">+${fmt(it.points)}</span>
        </button>`;
      }
      const m = it.me;
      return `<button type="button" class="study-trow study-trow--comp" data-act="detail" data-id="${esc(key)}">
          <span>${esc(fmtDate(it.at))}</span>
          <span class="study-tcell-main"><strong>${esc(it.subject)}</strong><small>${esc(gradeText(it.materialGrade, it.materialClass))} · ${esc(L("study_feed_players", { n: it.players }))}</small></span>
          <span>${m ? `#${m.rank}` : "-"}</span>
          <span>${m ? `${m.correct}/${it.total}` : "-"}</span>
          <span class="study-pts">${m ? `+${fmt((m.points || 0) + (m.bonus || 0))}` : "-"}</span>
        </button>`;
    })
    .join("");
  const head =
    kind === "lesson"
      ? `<span>${esc(L("study_col_date"))}</span><span>${esc(L("study_col_subject"))}</span><span>${esc(L("study_col_score"))}</span><span>${esc(L("study_col_points"))}</span>`
      : `<span>${esc(L("study_col_date"))}</span><span>${esc(L("study_col_subject"))}</span><span>${esc(L("study_col_rank"))}</span><span>${esc(L("study_col_score"))}</span><span>${esc(L("study_col_points"))}</span>`;
  const foot = feed.hasMore
    ? `<div class="study-actions"><button type="button" class="secondary-btn" data-act="tl-more" ${feed.loading ? "disabled" : ""}>${esc(feed.loading ? L("study_loading") : L("study_tl_more"))}</button></div>`
    : "";
  return `<div class="study-board study-table study-table--${kind === "lesson" ? "solo" : "comp"}" role="table"><div class="study-trow study-thead" role="row">${head}</div>${rows}</div><p class="study-hint">${esc(L("study_pub_table_hint"))}</p>${foot}`;
}

function renderPublic(body) {
  const pub = S.pub;
  if (!pub) return;
  if (!pub.player) {
    body.innerHTML = pub.error
      ? `<div class="study-card"><p>${esc(pub.error)}</p><div class="study-actions"><button type="button" class="secondary-btn" data-act="pub-reload">${esc(L("study_reload"))}</button></div></div>`
      : `<p class="status-text">${esc(L("study_loading"))}</p>`;
    return;
  }
  const o = pub.player;
  const st = pub.stats || {};
  const you = S.viewer && S.viewer.id === o.id ? ` ${esc(L("study_tl_you"))}` : "";
  const stat = (label, value, sub) => `<div class="study-stat"><div class="study-stat-label">${esc(label)}</div><div class="study-stat-value">${fmt(value)}</div>${sub ? `<div class="study-stat-sub">${esc(sub)}</div>` : ""}</div>`;
  const sub = (id, label) =>
    `<button type="button" role="tab" class="study-tab ${pub.sub === id ? "is-on" : ""}" aria-selected="${pub.sub === id ? "true" : "false"}" data-act="pub-tab" data-tab="${id}">${esc(label)}</button>`;
  const feed = pub.feeds[pub.sub];
  const content = pub.sub === "all" ? `${viewerBarHtml()}${feedBodyHtml(feed)}` : tableHtml(feed, pub.sub);
  body.innerHTML = `
    <div class="study-profile-top">
      <div class="study-profile-top-main">
        <div class="study-profile-name">${esc(o.name)}${you}</div>
        <div class="study-row-meta">${esc(gradeText(o.grade, o.classLevel))}</div>
        <div class="study-row-meta">${esc(L("study_tl_rank", { n: st.rank ?? "-" }))} · ${fmt(st.totalPoints)} ${esc(L("study_pts"))}</div>
        ${pub.today ? `<div class="study-row-meta">${esc(L("study_pub_today", { line: dailyLine(pub.today.earned, pub.today.cap) }))}</div>` : ""}
      </div>
      ${avatarHtml(o.id, o.name, "study-avatar--xl")}
    </div>
    <div class="study-actions study-actions--chips"><button type="button" class="secondary-btn" data-act="tl-profile">${esc(L("study_tl_open_profile"))}</button></div>
    <div class="study-stats">
      ${stat(L("study_stat_lessons"), st.lessons, L("study_stat_solo_pts", { n: fmt(st.soloPoints) }))}
      ${stat(L("study_stat_competitions"), st.competitions, L("study_stat_comp_pts", { n: fmt(st.competitionPoints) }))}
      ${stat(L("study_stat_wins"), st.wins)}
      ${stat(L("study_stat_materials"), st.materials)}
    </div>
    <p class="study-hint">${esc(L("study_pub_private_hint"))}</p>
    <div class="study-tabs study-tabs--sub" role="tablist">${sub("all", L("study_pub_tab_all"))}${sub("lesson", L("study_pub_tab_solo"))}${sub("competition", L("study_pub_tab_comp"))}</div>
    <div role="tabpanel">${content}</div>`;
}

// ---- aksi kartu
async function doLike(key) {
  const first = feedItemByKey(key);
  if (!first || !(await ensureViewer())) return;
  const cur = feedItemByKey(key); // ambil ulang: masuk tadi memuat ulang kartu
  if (!cur || isOwnItem(cur)) return; // tidak boleh menyukai kegiatan sendiri
  const t = splitKey(key);
  const res = await studyCall("like_toggle", { ...viewerParams(), kind: t.kind, targetId: t.id });
  if (!res.ok) return viewerFailure(res);
  const it = feedItemByKey(key);
  if (!it) return;
  it.liked = res.liked;
  it.likeCount = res.count;
  updateCard(key);
}

async function toggleComments(key) {
  const feed = shownFeed();
  const it = feedItemByKey(key);
  if (!feed || !it) return;
  const cm = (feed.comments[key] ||= { open: false, loading: false, list: null, sending: false });
  cm.open = !cm.open;
  if (cm.open && cm.list === null) {
    cm.loading = true;
    updateCard(key);
    const t = splitKey(key);
    const res = await studyCall("comment_list", { kind: t.kind, targetId: t.id });
    cm.loading = false;
    if (!res.ok) {
      cm.open = false;
      updateCard(key);
      return handleFailure(res);
    }
    cm.list = res.comments;
    it.commentCount = res.comments.length;
  }
  updateCard(key);
  if (cm.open) $("study-body")?.querySelector(`[data-draft="${CSS.escape(key)}"]`)?.focus();
}

function onBodyInput(e) {
  const ta = e.target.closest?.("textarea[data-draft]");
  const feed = shownFeed();
  if (ta && feed) feed.drafts[ta.dataset.draft] = ta.value;
}

async function sendComment(key) {
  const feed = shownFeed();
  const cm = feed?.comments[key];
  if (!feedItemByKey(key) || !cm || cm.sending) return;
  if (!(await ensureViewer())) return;
  const cur = feedItemByKey(key);
  if (!cur || isOwnItem(cur)) return;
  const text = String(feed.drafts[key] || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  if (text.length > COMMENT_MAX) return window.alert(L("study_comment_ph"));
  cm.sending = true;
  updateCard(key);
  const t = splitKey(key);
  const res = await studyCall("comment_add", { ...viewerParams(), kind: t.kind, targetId: t.id, body: text });
  cm.sending = false;
  if (feed.comments[key] !== cm) return; // daftar sudah diganti selama menunggu
  if (!res.ok) {
    updateCard(key);
    return viewerFailure(res);
  }
  const it = feedItemByKey(key);
  (cm.list ||= []).push(res.comment);
  if (it) it.commentCount = res.count;
  feed.drafts[key] = "";
  updateCard(key);
}

async function deleteComment(commentId, key, byParent) {
  const it = feedItemByKey(key);
  const cm = shownFeed()?.comments[key];
  if (!it || !cm) return;
  let res;
  if (byParent) {
    res = await openFormDialog({
      title: L("study_comment_parent_title"),
      okLabel: L("study_comment_delete"),
      cancelLabel: L("study_cancel"),
      busyLabel: L("study_loading"),
      fields: [{ key: "parentPin", label: L("study_parent_pin"), type: "pin" }],
      onSubmit: async (v) => {
        if (!validPinFormat(v.parentPin)) return { ok: false, error: L("study_pin_invalid") };
        const r = await studyCall("comment_delete", { commentId, parentPin: v.parentPin });
        if (!r.ok) return { ok: false, error: errText(r) };
        return { ok: true, value: r };
      }
    });
    if (!res) return;
  } else {
    if (!window.confirm(L("study_comment_delete_confirm"))) return;
    res = await studyCall("comment_delete", { commentId, ...viewerParams() });
    if (!res.ok) return viewerFailure(res);
  }
  cm.list = (cm.list || []).filter((c) => c.id !== commentId);
  it.commentCount = res.count;
  updateCard(key);
}

// "Detil": pelajaran = soal + pembahasan (perlu masuk), kompetisi = tabel hasil, materi = pembaca materi.
async function openDetail(key) {
  const it = feedItemByKey(key);
  if (!it) return;
  if (it.kind === "competition") return openRoomResult(it.id);
  if (it.kind === "material") {
    return openMaterial(it.id, { id: it.id, title: it.title, subject: it.subject, grade: it.grade, classLevel: it.classLevel, detail: it.detail, creatorId: it.creatorId, creatorName: it.creatorName, createdAt: it.at });
  }
  if (!(await ensureViewer())) return;
  const res = await studyCall("result_detail", { ...viewerParams(), sessionId: it.id });
  if (!res.ok) return viewerFailure(res);
  pushView();
  S.result = res.result;
  S.explainFailed = false;
  S.resultFrom = "feed";
  S.view = "result";
  render();
  window.scrollTo(0, 0);
}

// ================================================================ Materi pelajaran (tab Materi)
const MATERIAL_DETAIL_MAX = 300;

function switchTab(tab) {
  if (tab !== "timeline" && tab !== "board" && tab !== "materi") return;
  S.tab = tab;
  render();
  if (tab === "materi" && !S.materials.loaded && !S.materials.loading) loadMaterials(true);
  if (tab === "timeline" && S.feed && !S.feed.loaded && !S.feed.loading) loadFeed(S.feed, "first");
}

async function loadMaterials(reset) {
  const m = S.materials;
  if (m.loading) return;
  m.loading = true;
  m.error = "";
  if (reset) {
    m.items = [];
    m.hasMore = false;
  }
  render();
  const last = m.items[m.items.length - 1];
  const res = await studyCall("material_list", { before: reset ? undefined : last?.createdAt });
  m.loading = false;
  if (!res.ok) {
    m.error = errText(res);
  } else {
    const have = new Set(m.items.map((i) => i.id));
    m.items = m.items.concat(res.items.filter((i) => !have.has(i.id)));
    m.hasMore = res.hasMore;
    m.loaded = true;
  }
  if (S.view === "home") render();
}

function materialsHtml() {
  const m = S.materials;
  const cards = m.items
    .map(
      (it) => `
    <article class="study-material" data-mat="${esc(it.id)}">
      <div class="study-material-title">${esc(it.title)}</div>
      <div class="study-post-chips"><span class="study-badge">${esc(it.subject)}</span><span class="study-badge">${esc(gradeText(it.grade, it.classLevel))}</span></div>
      <p class="study-material-detail">${esc(it.detail)}</p>
      <div class="study-row-meta">${esc(L("study_mat_by", { name: it.creatorName }))} · ${esc(fmtDate(it.createdAt))}</div>
      <div class="study-material-actions">
        <button type="button" class="primary-btn" data-act="mat-view" data-id="${esc(it.id)}">${esc(L("study_mat_view"))}</button>
        <button type="button" class="secondary-btn" data-act="mat-pdf" data-id="${esc(it.id)}">${esc(L("study_mat_pdf"))}</button>
        <button type="button" class="secondary-btn" data-act="mat-practice" data-id="${esc(it.id)}">${esc(L("study_practice_btn"))}</button>
        <button type="button" class="study-link-btn" data-act="mat-del" data-id="${esc(it.id)}">${esc(L("study_mat_delete"))}</button>
      </div>
    </article>`
    )
    .join("");
  return `
    <div class="study-actions"><button type="button" class="primary-btn" data-act="mat-new">${esc(L("study_mat_new"))}</button></div>
    ${m.error ? `<div class="study-card"><p>${esc(m.error)}</p><button type="button" class="secondary-btn" data-act="mat-more">${esc(L("study_reload"))}</button></div>` : ""}
    ${m.loaded && m.items.length === 0 && !m.error ? `<p class="status-text">${esc(L("study_mat_empty"))}</p>` : ""}
    ${cards}
    ${m.loading ? `<p class="status-text">${esc(L("study_loading"))}</p>` : m.hasMore ? `<div class="study-actions"><button type="button" class="secondary-btn" data-act="mat-more">${esc(L("study_tl_more"))}</button></div>` : ""}`;
}

function renderMaterial(body) {
  const m = S.material;
  if (!m) return;
  body.innerHTML = `
    <div class="study-card">
      <div class="study-row-title">${esc(m.title)}</div>
      <div class="study-post-chips"><span class="study-badge">${esc(m.subject)}</span><span class="study-badge">${esc(gradeText(m.grade, m.classLevel))}</span></div>
      <div class="study-row-meta">${esc(L("study_mat_by", { name: m.creatorName }))} · ${esc(fmtDate(m.createdAt))}</div>
      <div class="study-row-meta">${esc(m.detail)}</div>
      <div class="study-actions">
        <button type="button" class="primary-btn" data-act="mat-reader-practice">${esc(L("study_practice_btn"))}</button>
        <button type="button" class="secondary-btn" data-act="mat-reader-pdf" ${m.content ? "" : "disabled"}>${esc(L("study_mat_pdf"))}</button>
      </div>
    </div>
    ${m.content ? `<article class="study-material-body chat-md">${mdBlock(m.content)}</article><p class="study-hint">${esc(L("study_mat_hint"))}</p>` : `<p class="status-text">${esc(L("study_loading"))}</p>`}`;
}

async function fetchMaterial(id) {
  const res = await studyCall("material_get", { materialId: id });
  if (!res.ok) {
    handleFailure(res);
    if (res.status === 404) {
      loadMaterials(true);
      if (S.feed) S.feed.stale = true;
    }
    return null;
  }
  return res.material;
}

async function openMaterial(id, known) {
  const list = S.materials.items.find((i) => i.id === id);
  const base = known || list;
  if (!base) return;
  if (S.view !== "material") pushView();
  S.material = { ...base, content: known?.content || null };
  S.view = "material";
  render();
  window.scrollTo(0, 0);
  if (S.material.content) return;
  const full = await fetchMaterial(id);
  if (!S.material || S.material.id !== id) return; // pengguna sudah pindah
  if (!full) {
    S.material = null;
    if (!popView()) {
      S.view = "home";
      render();
    }
    return;
  }
  S.material = full;
  render();
}

async function materialPdf(id, btn) {
  if (!id) return;
  if (btn) btn.disabled = true;
  try {
    const m = S.material && S.material.id === id && S.material.content ? S.material : await fetchMaterial(id);
    if (!m) return;
    const doc = buildMaterialPdf(m, L, locale());
    await shareOrSaveMaterialPdf(doc, m, `${m.title}`);
  } catch (err) {
    window.alert(`${L("study_pdf_failed")} (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openMaterialCreate() {
  const ov = S.overview;
  const settings = ov?.settings;
  const players = ov?.players || [];
  if (!settings) return window.alert(S.overviewError || L("study_loading"));
  if (players.length === 0) return window.alert(L("study_no_players"));
  const subjects = settings.subjects || [];
  const playerById = (id) => players.find((p) => p.id === id);
  const me = loggedIn(players); // sudah masuk di perangkat ini: tanpa pilih pemain + PIN
  return openFormDialog({
    title: L("study_mat_create_title"),
    intro: L("study_mat_hint"),
    okLabel: L("study_mat_generate"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_mat_generating"),
    fields: [
      { key: "playerId", label: L("study_player"), type: "select", value: me?.id || S.viewer?.id || players[0].id, options: players.map((p) => ({ value: p.id, label: `${p.name} (${gradeText(p.grade, p.classLevel)})` })), show: () => !me },
      { key: "pin", label: L("study_pin"), type: "pin", show: () => !me },
      {
        key: "grade",
        label: L("study_np_grade"),
        type: "select",
        value: playerById(S.viewer?.id || players[0].id)?.grade || "Umum",
        options: GRADE_LIST.map((g) => ({ value: g, label: g }))
      },
      classField(
        (v) => v.grade,
        (v) => classesOf(v.grade),
        (v) => {
          const pl = playerById(v.playerId);
          return pl && pl.grade === v.grade && pl.classLevel ? String(pl.classLevel) : undefined;
        },
        playerById(S.viewer?.id || players[0].id)?.classLevel
      ),
      {
        key: "subject",
        label: L("study_subject"),
        type: "select",
        value: subjects[0] || CUSTOM,
        options: [...subjects.map((x) => ({ value: x, label: x })), { value: CUSTOM, label: L("study_subject_custom") }]
      },
      { key: "customSubject", label: L("study_subject_custom_label"), type: "text", maxlength: 60, show: (v) => v.subject === CUSTOM },
      { key: "detail", label: L("study_mat_detail"), type: "textarea", rows: 3, maxlength: MATERIAL_DETAIL_MAX, placeholder: L("study_mat_detail_ph"), help: L("study_mat_detail_help") }
    ],
    onSubmit: async (v) => {
      const pid = me ? me.id : v.playerId;
      const pin = me ? credOf(me) : v.pin;
      if (!validCred(pin)) return { ok: false, error: L("study_pin_invalid") };
      const subject = v.subject === CUSTOM ? String(v.customSubject || "").trim() : v.subject;
      if (!subject) return { ok: false, error: L("study_subject_required") };
      const detail = String(v.detail || "").replace(/\s+/g, " ").trim();
      if (detail.length < 3) return { ok: false, error: L("study_mat_detail_required") };
      const res = await studyCall("material_create", { playerId: pid, pin, subject, grade: v.grade, classLevel: classValue(v.grade, v.classLevel), detail, engine: "auto" });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: { material: res.material, player: playerById(pid), pin } };
    }
  }).then(async (out) => {
    if (!out) return;
    if (out.player) await adoptLogin(out.player, out.pin);
    const { material } = out;
    S.materials.items = [{ ...material, content: undefined }, ...S.materials.items.filter((i) => i.id !== material.id)];
    S.materials.loaded = true;
    if (S.feed) S.feed.stale = true;
    if (S.view === "home") render();
    await openMaterialDone(material);
  });
}

// Popup setelah materi jadi: Bagikan PDF atau Lihat Materi.
function openMaterialDone(material) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "chat-code-dialog study-dialog";
    dlg.innerHTML = `
      <div class="chat-code-form-modal">
        <h2>${esc(L("study_mat_done_title"))}</h2>
        <p>${esc(L("study_mat_done_text", { title: material.title }))}</p>
        <div class="study-done-actions">
          <button type="button" class="primary-btn" data-done="view">${esc(L("study_mat_view"))}</button>
          <button type="button" class="secondary-btn" data-done="pdf">${esc(L("study_mat_pdf"))}</button>
          <button type="button" class="secondary-btn" data-done="practice">${esc(L("study_practice_btn"))}</button>
          <button type="button" class="study-link-btn" data-done="close">${esc(L("study_close"))}</button>
        </div>
      </div>`;
    let finished = false;
    const finish = (then) => {
      if (finished) return;
      finished = true;
      try {
        dlg.close();
      } catch (_e) {
        /* sudah tertutup */
      }
      dlg.remove();
      resolve();
      if (then) then();
    };
    dlg.addEventListener("close", () => finish());
    dlg.addEventListener("click", async (e) => {
      const b = e.target.closest?.("[data-done]");
      if (!b) return;
      const act = b.dataset.done;
      if (act === "view") finish(() => openMaterial(material.id, material));
      else if (act === "practice") finish(() => openPracticeForm(material));
      else if (act === "close") finish();
      else if (act === "pdf") {
        b.disabled = true;
        try {
          await shareOrSaveMaterialPdf(buildMaterialPdf(material, L, locale()), material, material.title);
        } catch (err) {
          window.alert(`${L("study_pdf_failed")} (${err instanceof Error ? err.message : String(err)})`);
        } finally {
          b.disabled = false;
        }
      }
    });
    (document.getElementById("app") || document.body).appendChild(dlg);
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  });
}

async function deleteMaterial(id) {
  const m = S.materials.items.find((i) => i.id === id);
  if (!m) return;
  const parentSet = !!S.overview?.settings?.parentPinSet;
  const creatorOk = !!m.creatorId && (S.overview?.players || []).some((p) => p.id === m.creatorId);
  const options = [];
  if (creatorOk) options.push({ value: "creator", label: L("study_mat_del_creator") });
  if (parentSet) options.push({ value: "parent", label: L("study_mat_del_parent") });
  if (options.length === 0) return window.alert(L("study_mat_del_no_way"));
  const done = await openFormDialog({
    title: L("study_mat_del_title"),
    intro: L("study_mat_del_intro", { title: m.title }),
    okLabel: L("study_mat_delete"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_loading"),
    fields: [
      { key: "as", label: L("study_mat_del_as"), type: "select", value: options[0].value, options },
      { key: "pin", label: L("study_pin"), type: "pin" }
    ],
    onSubmit: async (v) => {
      if (!validPinFormat(v.pin)) return { ok: false, error: L("study_pin_invalid") };
      const params = v.as === "parent" ? { parentPin: v.pin } : { playerId: m.creatorId, pin: v.pin };
      const res = await studyCall("material_delete", { materialId: id, ...params });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: true };
    }
  });
  if (!done) return;
  S.materials.items = S.materials.items.filter((i) => i.id !== id);
  if (S.feed) S.feed.stale = true;
  if (S.view === "home") render();
  window.alert(L("study_mat_del_done"));
}

// ---------------------------------------------------------------- redeem
async function doRedeem(itemId) {
  const item = (S.profile?.redeemItems || []).find((i) => i.id === itemId);
  if (!item) return;
  if (!window.confirm(L("study_redeem_confirm", { cost: fmt(item.cost), item: item.name }))) return;
  const res = await studyCall("redeem", { playerId: S.player.id, pin: S.pin, itemId });
  if (!res.ok) {
    handleFailure(res);
    loadProfile();
    return;
  }
  window.alert(L("study_redeem_done", { item: res.redemption.itemName, balance: fmt(res.redemption.balance) }));
  loadProfile();
}

// ================================================================ Kompetisi (room, serentak dengan lobi)
// Alur: daftar room -> gabung / buat -> lobi (polling) -> pembuat menekan Mulai -> semua mengerjakan soal yang sama
// -> kumpulkan -> menunggu -> tabel hasil. Skor, peringkat, dan poin dihitung server; layar ini hanya menampilkan.
const ROOM_POLL_MS = 3500;
const ROOM_LIST_POLL_MS = 6000;
const ROOM_MAX_PLAYERS = 10;
const MINUTE_OPTIONS = [3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
let pollId = 0;
let pollMode = "";

function syncPoll() {
  const hidden = !$("screen-study") || $("screen-study").hidden;
  let mode = "";
  if (!hidden) {
    if (S.view === "rooms") mode = "rooms";
    else if (S.view === "room" && S.room?.state && S.room.state.room.status !== "finished") mode = "room";
  }
  if (mode === pollMode) return;
  if (pollId) clearInterval(pollId);
  pollId = 0;
  pollMode = mode;
  if (mode) pollId = setInterval(pollTick, mode === "room" ? ROOM_POLL_MS : ROOM_LIST_POLL_MS);
}

function stopPoll() {
  if (pollId) clearInterval(pollId);
  pollId = 0;
  pollMode = "";
}

async function pollTick() {
  if (S.view === "rooms") return loadRooms();
  const rm = S.room;
  if (S.view !== "room" || !rm || rm.busy || rm.polling) return;
  rm.polling = true;
  const res = await studyCall("room_state", { playerId: rm.creds.id, pin: rm.creds.pin, roomId: rm.id });
  rm.polling = false;
  if (S.room !== rm || S.view !== "room" || rm.busy) return;
  if (!res.ok) {
    if (res.status === 404) roomGone();
    return; // galat sementara (jaringan): coba lagi pada putaran berikutnya
  }
  applyRoomState(res.state);
}

function roomGone() {
  window.alert(L("study_room_gone"));
  S.room = null;
  S.view = "rooms";
  render();
  loadRooms();
}

const roomMinutes = (r) => Math.max(1, Math.round((r.timeLimitSeconds || 0) / 60));
const roomTitle = (r) => `${esc(r.subject)}${r.topic ? ` · ${esc(r.topic)}` : ""}`;

// ---- daftar room
function openRooms() {
  pushView();
  S.rooms = { items: [], loading: false, loaded: false, error: "" };
  S.view = "rooms";
  render();
  window.scrollTo(0, 0);
  loadRooms();
}

async function loadRooms() {
  const r = S.rooms;
  if (r.loading) return;
  r.loading = true;
  if (!r.loaded) render();
  const res = await studyCall("room_list");
  r.loading = false;
  if (res.ok) {
    r.items = res.rooms;
    r.loaded = true;
    r.error = "";
  } else {
    r.error = errText(res);
  }
  if (S.view === "rooms" && S.rooms === r) render();
}

function renderRooms(body) {
  const r = S.rooms;
  const bonus = S.overview?.settings?.competitionWinBonus ?? 10;
  const cards = r.items
    .map((x) => {
      const running = x.status === "running";
      return `
      <article class="study-room-card" data-room="${esc(x.id)}">
        <div class="study-room-head">
          <div class="study-row-title">${roomTitle(x)}</div>
          <span class="study-badge ${running ? "study-badge--solid" : ""}">${esc(L(running ? "study_room_status_running" : "study_room_status_lobby"))}</span>
        </div>
        <div class="study-post-chips">
          <span class="study-badge">${esc(gradeText(x.materialGrade, x.materialClass))}</span>
          <span class="study-badge">${esc(L(`study_level_${x.level}`))}</span>
          <span class="study-badge">${x.numQuestions} ${esc(L("study_questions_unit"))}</span>
          <span class="study-badge">${esc(L("study_feed_minutes", { m: roomMinutes(x) }))}</span>
          <span class="study-badge">${esc(L("study_room_count", { n: x.players, max: x.maxPlayers }))}</span>
        </div>
        <div class="study-row-meta">${esc(L("study_room_by", { name: x.creatorName }))} · ${esc((x.playerNames || []).join(", "))}</div>
        <div class="study-actions"><button type="button" class="primary-btn" data-act="room-join" data-id="${esc(x.id)}">${esc(L(running ? "study_room_enter" : "study_room_join"))}</button></div>
      </article>`;
    })
    .join("");
  body.innerHTML = `
    <p class="study-hint study-hint--top">${esc(L("study_rooms_intro", { b: fmt(bonus), max: ROOM_MAX_PLAYERS }))}</p>
    <div class="study-actions">
      <button type="button" class="primary-btn" data-act="room-new">${esc(L("study_room_new"))}</button>
      <button type="button" class="secondary-btn" data-act="rooms-refresh">${esc(L("study_rooms_refresh"))}</button>
    </div>
    ${r.error ? `<div class="study-card"><p>${esc(r.error)}</p></div>` : ""}
    ${r.loaded && r.items.length === 0 && !r.error ? `<p class="status-text">${esc(L("study_rooms_empty"))}</p>` : ""}
    ${!r.loaded && r.loading ? `<p class="status-text">${esc(L("study_loading"))}</p>` : ""}
    ${cards}`;
}

// ---- gabung / masuk
async function joinRoomFlow(roomId) {
  const room = S.rooms.items.find((x) => x.id === roomId);
  const players = S.overview?.players || [];
  if (!room) return;
  if (!players.length) return window.alert(L("study_no_players"));
  const running = room.status === "running";
  const me = loggedIn(players);
  const first = me || players[0];
  const out = await openFormDialog({
    title: L(running ? "study_room_enter_title" : "study_room_join_title"),
    intro: L("study_room_join_intro", { subject: `${room.subject}${room.topic ? ` · ${room.topic}` : ""}`, count: room.numQuestions, m: roomMinutes(room) }),
    okLabel: L(running ? "study_room_enter" : "study_room_join"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_loading"),
    fields: [
      { key: "playerId", label: L("study_player"), type: "select", value: first.id, options: players.map((p) => ({ value: p.id, label: `${p.name} (${gradeText(p.grade, p.classLevel)})` })), show: () => !me },
      { key: "pin", label: L("study_pin"), type: "pin", show: () => !me }
    ],
    extra: me
      ? []
      : [
          {
            label: L("study_forgot_pin"),
            onClick: (v) => {
              const pl = players.find((p) => p.id === v.playerId);
              if (pl) openResetPin(pl);
            }
          }
        ],
    onSubmit: async (v) => {
      const pid = me ? me.id : v.playerId;
      const pin = me ? credOf(me) : v.pin;
      if (!validCred(pin)) return { ok: false, error: L("study_pin_invalid") };
      // room berjalan: hanya peserta lama yang boleh masuk lagi (room_state); lobi: bergabung (idempotent)
      const res = await studyCall(running ? "room_state" : "room_join", { playerId: pid, pin, roomId });
      if (!res.ok) return { ok: false, error: errText(res) };
      if (!res.state.me) return { ok: false, error: L("study_room_not_member") };
      return { ok: true, value: { state: res.state, player: players.find((p) => p.id === pid), pin } };
    }
  });
  if (out) enterRoom(out.state, out.player, out.pin);
}

async function enterRoom(state, player, pin) {
  await adoptLogin(player, pin);
  S.room = { id: state.room.id, creds: S.viewer, state: null, busy: false, polling: false, leftQuiz: false };
  S.view = "room";
  window.scrollTo(0, 0);
  applyRoomState(state);
}

// Simpan keadaan terbaru dari server lalu tampilkan; room yang baru berjalan langsung membuka soal.
function applyRoomState(state) {
  const rm = S.room;
  if (!rm) return;
  rm.state = state;
  const r = state.room;
  if (r.status === "cancelled") return roomGone();
  if (r.status === "finished") {
    clearAnswers(`room_${r.id}`);
    if (S.feed) S.feed.stale = true;
    if (S.overview) loadOverviewQuiet();
    if (S.quiz?.kind === "room") S.quiz = null;
    S.view = "room";
  }
  if (S.view === "room" && r.status === "running" && state.me && !state.me.submitted && state.questions && state.questions.length && !rm.leftQuiz) {
    return startRoomQuiz();
  }
  if (S.view === "room") render();
}

// Muat ulang papan peringkat tanpa menggeser layar (poin baru dari kompetisi).
async function loadOverviewQuiet() {
  const res = await studyCall("overview");
  if (res.ok) S.overview = res;
}

function startRoomQuiz() {
  const rm = S.room;
  const st = rm?.state;
  if (!st?.questions?.length) return;
  const r = st.room;
  const sid = `room_${r.id}`;
  S.quiz = {
    kind: "room",
    roomId: r.id,
    sessionId: sid,
    session: { subject: r.subject, topic: r.topic, materialGrade: r.materialGrade, materialClass: r.materialClass, level: r.level, timeLimitSeconds: r.timeLimitSeconds, secondsLeft: r.secondsLeft },
    questions: st.questions,
    answers: loadAnswers(sid, st.questions.length),
    shortfall: 0
  };
  armQuizTimer(S.quiz);
  S.autoSubmittedId = "";
  rm.leftQuiz = false;
  S.view = "quiz";
  render();
  window.scrollTo(0, 0);
}

// ---- buat room
function openRoomCreate() {
  const ov = S.overview;
  const settings = ov?.settings;
  if (!settings) return window.alert(S.overviewError || L("study_loading"));
  const players = ov.players || [];
  if (!players.length) return window.alert(L("study_no_players"));
  const subjects = settings.subjects || [];
  const spq = settings.secondsPerQuestion ?? 0;
  const playerById = (id) => players.find((p) => p.id === id);
  const me = loggedIn(players);
  const first = me || players[0];
  return openFormDialog({
    title: L("study_room_create_title"),
    okLabel: L("study_room_create_ok"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_room_creating"),
    fields: [
      { key: "playerId", label: L("study_player"), type: "select", value: first.id, options: players.map((p) => ({ value: p.id, label: `${p.name} (${gradeText(p.grade, p.classLevel)})` })), show: () => !me },
      { key: "pin", label: L("study_pin"), type: "pin", show: () => !me },
      {
        key: "subject",
        label: L("study_subject"),
        type: "select",
        value: subjects[0] || CUSTOM,
        options: [...subjects.map((s) => ({ value: s, label: s })), { value: CUSTOM, label: L("study_subject_custom") }]
      },
      { key: "customSubject", label: L("study_subject_custom_label"), type: "text", maxlength: 60, show: (v) => v.subject === CUSTOM },
      { key: "topic", label: L("study_topic"), type: "text", maxlength: 100, placeholder: L("study_topic_ph") },
      {
        key: "materialGrade",
        label: L("study_material_grade"),
        type: "select",
        value: first.grade,
        options: (v) => allowedMaterialGrades(playerById(v.playerId)?.grade || "Umum").map((g) => ({ value: g, label: g })),
        onOptionsChange: (v) => playerById(v.playerId)?.grade,
        help: L("study_grade_help")
      },
      classField(
        (v) => v.materialGrade,
        (v) => {
          const pl = playerById(v.playerId);
          return allowedClasses(pl?.grade || "Umum", pl?.classLevel, v.materialGrade);
        },
        (v) => {
          const pl = playerById(v.playerId);
          return pl && pl.grade === v.materialGrade && pl.classLevel ? String(pl.classLevel) : undefined;
        },
        first.classLevel
      ),
      { key: "count", label: L("study_count"), type: "select", value: "10", options: COUNTS.map((n) => ({ value: String(n), label: String(n) })) },
      {
        key: "level",
        label: L("study_level"),
        type: "select",
        value: "normal",
        options: ["easy", "normal", "hard"].map((lv) => ({ value: lv, label: levelLabel(lv, settings) }))
      },
      {
        key: "minutes",
        label: L("study_room_minutes"),
        type: "select",
        value: "10",
        options: MINUTE_OPTIONS.map((m) => ({ value: String(m), label: String(m) })),
        help: (v) => (spq ? L("study_room_minutes_help", { m: Math.ceil(timeLimitSeconds(Number(v.count || 10), spq) / 60), s: spq }) : L("study_room_minutes_free"))
      }
    ],
    extra: me
      ? []
      : [
          {
            label: L("study_forgot_pin"),
            onClick: (v) => {
              const pl = playerById(v.playerId);
              if (pl) openResetPin(pl);
            }
          }
        ],
    onSubmit: async (v) => {
      const pl = me || playerById(v.playerId);
      if (!pl) return { ok: false, error: L("study_pick_player") };
      const pin = me ? credOf(me) : v.pin;
      if (!validCred(pin)) return { ok: false, error: L("study_pin_invalid") };
      const subject = v.subject === CUSTOM ? String(v.customSubject || "").trim() : v.subject;
      if (!subject) return { ok: false, error: L("study_subject_required") };
      const res = await studyCall("room_create", {
        playerId: pl.id,
        pin,
        subject,
        topic: String(v.topic || "").trim(),
        materialGrade: v.materialGrade,
        materialClass: classValue(v.materialGrade, v.materialClass ?? v.classLevel),
        level: v.level,
        count: Number(v.count),
        minutes: Number(v.minutes),
        engine: "auto"
      });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: { state: res.state, player: pl, pin } };
    }
  }).then((out) => {
    if (out) enterRoom(out.state, out.player, out.pin);
  });
}

// ---- tampilan room
function roomTableHtml(results, meId) {
  const rows = results
    .map((r) => {
      const total = r.points + r.bonus;
      return `<button type="button" class="study-trow study-trow--room ${meId && r.playerId === meId ? "is-me" : ""}" data-act="open-public" data-id="${esc(r.playerId)}">
        <span class="study-rank">${r.rank}</span>
        <span class="study-tcell-main"><strong>${esc(r.name)}</strong><small>${esc(gradeText(r.grade, r.classLevel))}${r.timedOut ? ` · ${esc(L("study_room_timedout"))}` : ""}</small></span>
        <span>${r.correct}/${r.total}</span>
        <span>${r.seconds == null ? "-" : esc(formatClock(r.seconds))}</span>
        <span class="study-pts">${fmt(total)}${r.bonus > 0 ? `<small>${esc(L("study_room_bonus", { b: fmt(r.bonus) }))}</small>` : ""}${r.capped ? `<small>${esc(L("study_room_capped_small"))}</small>` : ""}</span>
      </button>`;
    })
    .join("");
  return `<div class="study-board study-table study-table--room" role="table">
    <div class="study-trow study-thead" role="row"><span>#</span><span>${esc(L("study_col_name"))}</span><span>${esc(L("study_col_score"))}</span><span>${esc(L("study_col_time"))}</span><span>${esc(L("study_col_points"))}</span></div>
    ${rows}
  </div>`;
}

// Catatan untuk peserta yang poin kompetisinya dipotong batas harian + posisi poin hari ini.
function roomCappedNote(results, meId, daily) {
  const mine = (results || []).find((x) => x.playerId === meId);
  if (!mine) return "";
  const lines = [];
  if (mine.capped) lines.push(`<div class="study-warn" role="status">${esc(L("study_daily_capped_line", { raw: fmt(mine.pointsRaw + mine.bonusRaw), got: fmt(mine.points + mine.bonus) }))}</div>`);
  if (daily && dailyCapOf() !== null) {
    syncToday(meId, daily);
    lines.push(`<div class="study-row-meta">${esc(dailyLine(daily.earned, daily.cap))}</div>`);
  }
  return lines.length ? `<div class="study-card">${lines.join("")}</div>` : "";
}

function roomInfoHtml(r) {
  return `
    <div class="study-card">
      <div class="study-room-head">
        <div class="study-row-title">${roomTitle(r)}</div>
        <span class="study-badge study-badge--solid">${esc(L("study_kind_competition"))}</span>
      </div>
      <div class="study-post-chips">
        <span class="study-badge">${esc(gradeText(r.materialGrade, r.materialClass))}</span>
        <span class="study-badge">${esc(L(`study_level_${r.level}`))} (${r.weightPercent}%)</span>
        <span class="study-badge">${r.numQuestions} ${esc(L("study_questions_unit"))}</span>
        <span class="study-badge">${esc(L("study_feed_minutes", { m: roomMinutes(r) }))}</span>
      </div>
      <div class="study-row-meta">${esc(L("study_room_by", { name: r.creatorName }))}</div>
    </div>`;
}

function renderRoom(body) {
  const rm = S.room;
  const st = rm?.state;
  if (!st) {
    body.innerHTML = `<p class="status-text">${esc(L("study_loading"))}</p>`;
    return;
  }
  const r = st.room;
  const meId = rm.creds.id;
  const isCreator = r.creatorId === meId;
  const playerRows = (withState) =>
    st.players
      .map(
        (p) => `
      <div class="study-row study-room-player">
        ${avatarHtml(p.id, p.name, "study-avatar--sm")}
        <div class="study-row-main"><div class="study-row-title">${esc(p.name)}${p.id === meId ? ` <small>(${esc(L("study_room_you"))})</small>` : ""}</div><div class="study-row-meta">${esc(gradeText(p.grade, p.classLevel))}${p.isCreator ? ` · ${esc(L("study_room_creator_tag"))}` : ""}</div></div>
        ${withState ? `<span class="study-badge ${p.submitted ? "study-badge--solid" : ""}">${esc(L(p.submitted ? "study_room_p_done" : "study_room_p_working"))}</span>` : ""}
      </div>`
      )
      .join("");

  if (r.status === "lobby") {
    const enough = st.players.length >= 2;
    body.innerHTML = `
      ${roomInfoHtml(r)}
      <h2 class="study-h">${esc(L("study_room_lobby"))} <small>(${esc(L("study_room_count", { n: st.players.length, max: r.maxPlayers }))})</small></h2>
      ${playerRows(false)}
      <p class="study-hint">${esc(isCreator ? L("study_room_hint_creator") : L("study_room_hint_guest", { name: r.creatorName }))}</p>
      <div class="study-actions">
        ${isCreator ? `<button type="button" class="primary-btn" data-act="room-start" ${enough && !rm.busy ? "" : "disabled"}>${esc(rm.busy ? L("study_room_starting") : L("study_room_start"))}</button>` : ""}
        <button type="button" class="secondary-btn" data-act="room-leave" ${rm.busy ? "disabled" : ""}>${esc(L(isCreator ? "study_room_cancel" : "study_room_leave"))}</button>
      </div>
      ${isCreator && !enough ? `<p class="study-row-meta">${esc(L("study_room_need_two"))}</p>` : ""}`;
    return;
  }

  if (r.status === "running") {
    const done = !!st.me?.submitted;
    body.innerHTML = `
      ${roomInfoHtml(r)}
      <div class="study-card">
        <div class="study-row-title">${esc(L("study_room_running"))}</div>
        ${r.secondsLeft != null ? `<div class="study-timer-static">${esc(L("study_time_left", { t: formatClock(r.secondsLeft) }))}</div>` : ""}
        ${done ? `<p>${esc(L("study_room_waiting"))}</p>` : `<button type="button" class="primary-btn" data-act="room-resume">${esc(L("study_room_resume"))}</button>`}
      </div>
      ${playerRows(true)}
      ${S.autoSubmittedId === r.id ? `<p class="study-warn">${esc(L("study_time_up_auto"))}</p>` : ""}`;
    return;
  }

  // selesai
  const winner = r.winnerName ? esc(L("study_room_winner", { name: r.winnerName })) : esc(L("study_room_no_winner"));
  body.innerHTML = `
    ${roomInfoHtml(r)}
    <div class="study-card study-winner">
      <div class="study-row-title">${esc(L("study_room_finished"))}</div>
      <div class="study-winner-name">${winner}</div>
      ${r.winnerName ? `<div class="study-row-meta">${esc(L("study_room_bonus_line", { b: fmt(r.winBonus) }))}</div>` : ""}
    </div>
    ${roomTableHtml(st.results || [], meId)}
    ${roomCappedNote(st.results, meId, st.daily)}
    <div class="study-actions">
      <button type="button" class="primary-btn" data-act="room-card">${esc(L("study_share_card"))}</button>
      <button type="button" class="secondary-btn" data-act="room-back">${esc(L("study_room_back"))}</button>
    </div>`;
}

async function roomStart() {
  const rm = S.room;
  if (!rm || rm.busy) return;
  rm.busy = true;
  render();
  const res = await studyCall("room_start", { playerId: rm.creds.id, pin: rm.creds.pin, roomId: rm.id });
  rm.busy = false;
  if (S.room !== rm) return;
  if (!res.ok) {
    render();
    if (res.status === 404) return roomGone();
    return handleFailure(res);
  }
  applyRoomState(res.state);
}

// Keluar dari lobi (pembuat keluar = room dibatalkan). Room yang sudah berjalan tidak bisa ditinggalkan, hanya ditutup layarnya.
async function leaveRoomView() {
  const rm = S.room;
  const status = rm?.state?.room.status;
  if (rm && status === "lobby") {
    const creator = rm.state.room.creatorId === rm.creds.id;
    if (!window.confirm(L(creator ? "study_room_cancel_confirm" : "study_room_leave_confirm"))) return;
    rm.busy = true;
    render();
    const res = await studyCall("room_leave", { playerId: rm.creds.id, pin: rm.creds.pin, roomId: rm.id });
    rm.busy = false;
    if (!res.ok && res.status !== 404) {
      render();
      return handleFailure(res);
    }
  }
  S.room = null;
  S.view = "rooms";
  render();
  loadRooms();
}

// ---- tabel hasil kompetisi (publik, dari kartu timeline atau tabel profil)
async function openRoomResult(roomId) {
  if (S.view !== "roomresult") pushView();
  const rr = { id: roomId, loading: true, room: null, results: null, error: "" };
  S.rr = rr;
  S.view = "roomresult";
  render();
  window.scrollTo(0, 0);
  const res = await studyCall("room_result", { roomId });
  rr.loading = false;
  if (res.ok) {
    rr.room = res.room;
    rr.results = res.results;
  } else {
    rr.error = errText(res);
  }
  if (S.view === "roomresult" && S.rr === rr) render();
}

function renderRoomResult(body) {
  const rr = S.rr;
  if (!rr) return;
  if (rr.loading) {
    body.innerHTML = `<p class="status-text">${esc(L("study_loading"))}</p>`;
    return;
  }
  if (rr.error || !rr.room) {
    body.innerHTML = `<div class="study-card"><p>${esc(rr.error || "Error")}</p></div>`;
    return;
  }
  const r = rr.room;
  const winner = r.winnerName ? esc(L("study_room_winner", { name: r.winnerName })) : esc(L("study_room_no_winner"));
  body.innerHTML = `
    ${roomInfoHtml(r)}
    <div class="study-card study-winner">
      <div class="study-winner-name">${winner}</div>
      ${r.winnerName ? `<div class="study-row-meta">${esc(L("study_room_bonus_line", { b: fmt(r.winBonus) }))}</div>` : ""}
    </div>
    ${roomTableHtml(rr.results || [], S.viewer?.id)}
    <div class="study-actions"><button type="button" class="primary-btn" data-act="room-card">${esc(L("study_share_card"))}</button></div>
    <p class="study-hint">${esc(L("study_pub_table_hint"))}</p>`;
}

// ================================================================ Setting (area orang tua)
let settingsDlg = null;
let parentPin = "";

async function openSettings() {
  if (!S.overview) {
    window.alert(S.overviewError || L("study_loading"));
    return;
  }
  parentPin = "";
  let data = null;
  if (S.overview.settings.parentPinSet) {
    data = await openFormDialog({
      title: L("study_set_gate_title"),
      okLabel: L("study_open"),
      cancelLabel: L("study_cancel"),
      busyLabel: L("study_loading"),
      fields: [{ key: "pin", label: L("study_parent_pin"), type: "pin" }],
      onSubmit: async (v) => {
        if (!validPinFormat(v.pin)) return { ok: false, error: L("study_pin_invalid") };
        const res = await studyCall("settings_open", { parentPin: v.pin });
        if (!res.ok) return { ok: false, error: errText(res) };
        parentPin = v.pin;
        return { ok: true, value: res };
      }
    });
    if (!data) return;
  } else {
    data = await studyCall("settings_open", {});
    if (!data.ok) return handleFailure(data);
  }
  showSettingsDialog(data);
}

function showSettingsDialog(data) {
  if (!settingsDlg) {
    settingsDlg = document.createElement("dialog");
    settingsDlg.className = "kb-dialog study-dialog";
    settingsDlg.addEventListener("click", (e) => {
      if (e.target === settingsDlg) closeSettings();
    });
    settingsDlg.addEventListener("close", () => {
      parentPin = "";
      loadOverview();
    });
    settingsDlg.addEventListener("click", onSettingsClick);
    (document.getElementById("app") || document.body).appendChild(settingsDlg);
  }
  renderSettings(data);
  if (!settingsDlg.open) {
    if (typeof settingsDlg.showModal === "function") settingsDlg.showModal();
    else settingsDlg.setAttribute("open", "");
  }
}

function closeSettings() {
  if (settingsDlg && settingsDlg.open) settingsDlg.close();
}

let settingsData = null;
function renderSettings(data) {
  settingsData = data;
  const s = data.settings;
  const items = s.redeemItems || [];
  const pending = data.pendingRedemptions || [];
  settingsDlg.innerHTML = `
  <div class="kb-dialog-card">
    <h2>${esc(L("study_set_title"))}</h2>
    ${s.parentPinSet ? "" : `<p class="study-warn">${esc(L("study_set_no_parent_pin"))}</p>`}

    <h3 class="sys-subtitle">${esc(L("study_set_points"))}</h3>
    <form id="study-points-form" class="study-set-form">
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_perq"))}</span><input type="number" inputmode="numeric" min="1" max="10000" name="perQuestionPoints" value="${s.perQuestionPoints}" /></label>
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_bonus"))}</span><input type="number" inputmode="numeric" min="0" max="100" name="perfectBonusPercent" value="${s.perfectBonusPercent}" /></label>
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_spq"))}</span><input type="number" inputmode="numeric" min="0" max="600" name="secondsPerQuestion" value="${s.secondsPerQuestion}" /><small class="study-field-help">${esc(L("study_set_spq_help"))}</small></label>
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_winbonus"))}</span><input type="number" inputmode="numeric" min="0" max="1000" name="competitionWinBonus" value="${s.competitionWinBonus ?? 10}" /></label>
      ${typeof s.dailyPointsCap === "number" ? `<label class="study-field"><span class="study-field-label">${esc(L("study_set_dailycap"))}</span><input type="number" inputmode="numeric" min="0" max="1000000" name="dailyPointsCap" value="${s.dailyPointsCap}" /><small class="study-field-help">${esc(L("study_set_dailycap_help"))}</small></label>` : ""}
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_w_easy"))}</span><input type="number" inputmode="numeric" min="1" max="1000" name="easy" value="${s.weights.easy}" /></label>
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_w_normal"))}</span><input type="number" inputmode="numeric" min="1" max="1000" name="normal" value="${s.weights.normal}" /></label>
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_w_hard"))}</span><input type="number" inputmode="numeric" min="1" max="1000" name="hard" value="${s.weights.hard}" /></label>
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_subjects"))}</span><textarea name="subjects" rows="6">${esc((s.subjects || []).join("\n"))}</textarea></label>
      <p id="study-points-msg" class="study-set-msg" hidden></p>
      <button type="submit" class="primary-btn">${esc(L("study_set_save"))}</button>
    </form>

    <h3 class="sys-subtitle">${esc(L("study_set_rewards"))}</h3>
    ${items
      .map(
        (it) => `
      <div class="study-row">
        <div class="study-row-main"><div class="study-row-title">${esc(it.name)}</div><div class="study-row-meta">${fmt(it.cost)} ${esc(L("study_pts"))}</div></div>
        <div class="study-row-btns">
          <button type="button" class="secondary-btn" data-sact="edit-reward" data-id="${esc(it.id)}">${esc(L("study_set_edit"))}</button>
          <button type="button" class="secondary-btn" data-sact="delete-reward" data-id="${esc(it.id)}">${esc(L("study_set_delete"))}</button>
        </div>
      </div>`
      )
      .join("")}
    <button type="button" class="secondary-btn" data-sact="add-reward">${esc(L("study_set_add_reward"))}</button>

    <h3 class="sys-subtitle">${esc(L("study_set_penalty"))}</h3>
    <button type="button" class="secondary-btn" data-sact="penalty" ${(data.players || []).length ? "" : "disabled"}>${esc(L("study_set_penalty_btn"))}</button>

    <h3 class="sys-subtitle">${esc(L("study_set_pending"))}</h3>
    ${
      pending.length
        ? pending
            .map(
              (r) => `
      <div class="study-row">
        <div class="study-row-main"><div class="study-row-title">${esc(r.itemName)}</div><div class="study-row-meta">${esc(r.playerName)} · ${fmtDate(r.createdAt)}</div></div>
        <button type="button" class="secondary-btn" data-sact="mark-given" data-id="${esc(r.id)}">${esc(L("study_mark_given"))}</button>
      </div>`
            )
            .join("")
        : `<p class="status-text">${esc(L("study_set_pending_empty"))}</p>`
    }

    <h3 class="sys-subtitle">${esc(L("study_parent_pin"))}</h3>
    <button type="button" class="secondary-btn" data-sact="parent-pin">${esc(L(s.parentPinSet ? "study_set_change_pin" : "study_set_create_pin"))}</button>

    <div class="chat-code-dialog-actions">
      <button type="button" class="primary-btn" data-sact="close">${esc(L("study_close"))}</button>
    </div>
  </div>`;
  const form = settingsDlg.querySelector("#study-points-form");
  form.addEventListener("submit", onPointsSubmit);
}

async function reloadSettings() {
  const res = await studyCall("settings_open", { parentPin });
  if (!res.ok) {
    handleFailure(res);
    closeSettings();
    return;
  }
  renderSettings(res);
}

async function onPointsSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const num = (name) => (f.elements[name].value === "" ? null : Number(f.elements[name].value));
  const msg = settingsDlg.querySelector("#study-points-msg");
  const btn = f.querySelector('button[type="submit"]');
  btn.disabled = true;
  const res = await studyCall("settings_save", {
    parentPin,
    perQuestionPoints: num("perQuestionPoints"),
    perfectBonusPercent: num("perfectBonusPercent"),
    secondsPerQuestion: num("secondsPerQuestion"),
    competitionWinBonus: num("competitionWinBonus"),
    ...(f.elements.dailyPointsCap ? { dailyPointsCap: num("dailyPointsCap") } : {}),
    weights: { easy: num("easy"), normal: num("normal"), hard: num("hard") },
    subjects: f.elements.subjects.value.split("\n")
  });
  btn.disabled = false;
  msg.hidden = false;
  if (!res.ok) {
    msg.textContent = errText(res);
    msg.classList.add("is-error");
    return;
  }
  msg.classList.remove("is-error");
  msg.textContent = L("study_set_saved");
  S.overview.settings = res.settings;
  settingsData.settings = res.settings;
}

async function onSettingsClick(e) {
  const btn = e.target.closest?.("[data-sact]");
  if (!btn || btn.disabled) return;
  const act = btn.dataset.sact;
  const id = btn.dataset.id;
  const data = settingsData;
  if (act === "close") return closeSettings();

  if (act === "add-reward" || act === "edit-reward") {
    const cur = act === "edit-reward" ? data.settings.redeemItems.find((i) => i.id === id) : null;
    const ok = await openFormDialog({
      title: L(cur ? "study_set_edit" : "study_set_add_reward"),
      okLabel: L("study_set_save"),
      cancelLabel: L("study_cancel"),
      busyLabel: L("study_busy_saving"),
      fields: [
        { key: "name", label: L("study_reward_name"), type: "text", maxlength: 80, value: cur?.name ?? "" },
        { key: "cost", label: L("study_reward_cost"), type: "number", min: 1, value: cur?.cost ?? "" }
      ],
      onSubmit: async (v) => {
        const res = await studyCall("redeem_item_save", { parentPin, id: cur?.id, name: v.name, cost: v.cost });
        return res.ok ? { ok: true } : { ok: false, error: errText(res) };
      }
    });
    if (ok) reloadSettings();
    return;
  }

  if (act === "delete-reward") {
    const cur = data.settings.redeemItems.find((i) => i.id === id);
    if (!cur || !window.confirm(L("study_set_delete_confirm", { name: cur.name }))) return;
    const res = await studyCall("redeem_item_delete", { parentPin, id });
    if (!res.ok) return handleFailure(res);
    return reloadSettings();
  }

  if (act === "mark-given") {
    const res = await studyCall("redeem_mark", { parentPin, redemptionId: id, status: "given" });
    if (!res.ok) return handleFailure(res);
    return reloadSettings();
  }

  if (act === "penalty") {
    const players = data.players || [];
    const out = await openFormDialog({
      title: L("study_penalty_title"),
      okLabel: L("study_penalty_btn"),
      cancelLabel: L("study_cancel"),
      busyLabel: L("study_busy_saving"),
      fields: [
        { key: "playerId", label: L("study_player"), type: "select", options: players.map((p) => ({ value: p.id, label: `${p.name} (${gradeText(p.grade, p.classLevel)})` })) },
        { key: "points", label: L("study_penalty_points"), type: "number", min: 1 },
        { key: "reason", label: L("study_penalty_reason"), type: "text", maxlength: 200 }
      ],
      onSubmit: async (v) => {
        if (!v.points || v.points < 1) return { ok: false, error: L("study_penalty_points_invalid") };
        if (!String(v.reason || "").trim()) return { ok: false, error: L("study_penalty_reason_required") };
        const res = await studyCall("penalty", { parentPin, playerId: v.playerId, points: v.points, reason: v.reason });
        if (!res.ok) return { ok: false, error: errText(res) };
        return { ok: true, value: { res, name: players.find((p) => p.id === v.playerId)?.name || "" } };
      }
    });
    if (out) {
      const r = out.res;
      let text = L("study_penalty_done", { applied: fmt(r.applied), name: out.name, balance: fmt(r.balance) });
      if (r.applied < r.requested) text += `\n${L("study_penalty_capped", { requested: fmt(r.requested), applied: fmt(r.applied) })}`;
      window.alert(text);
    }
    return;
  }

  if (act === "parent-pin") {
    const has = data.settings.parentPinSet;
    const ok = await openFormDialog({
      title: L(has ? "study_set_change_pin" : "study_set_create_pin"),
      okLabel: L("study_set_save"),
      cancelLabel: L("study_cancel"),
      busyLabel: L("study_busy_saving"),
      fields: [
        ...(has ? [{ key: "current", label: L("study_parent_pin_current"), type: "pin" }] : []),
        { key: "newPin", label: L("study_new_pin"), type: "pin" },
        { key: "newPin2", label: L("study_new_pin2"), type: "pin" }
      ],
      onSubmit: async (v) => {
        if (!validPinFormat(v.newPin)) return { ok: false, error: L("study_pin_invalid") };
        if (v.newPin !== v.newPin2) return { ok: false, error: L("study_np_mismatch") };
        const res = await studyCall("parent_pin_set", { parentPin: has ? v.current : undefined, newPin: v.newPin });
        if (!res.ok) return { ok: false, error: errText(res) };
        parentPin = v.newPin;
        return { ok: true };
      }
    });
    if (ok) {
      S.overview.settings.parentPinSet = true;
      reloadSettings();
    }
  }
}
