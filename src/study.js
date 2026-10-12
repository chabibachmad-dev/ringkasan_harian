// Menu "Study": latihan soal pilihan ganda buatan AI untuk beberapa pemain, dengan poin, leaderboard, redeem,
// hukuman, setting orang tua, dan PDF hasil. Semua data & logika poin ada di server (Edge Function `study`,
// lihat supabase/functions/study/index.ts); file ini hanya urusan tampilan.
// Rute (hash): #study

import { t } from "./i18n.js";
import { studyCall } from "./study-client.js";
import { openFormDialog } from "./study-form.js";
import { renderAiMarkdown, typesetMath } from "./markdown.js";
import { buildStudyPdf, shareOrSaveStudyPdf } from "./study-pdf.js";
import { allowedMaterialGrades } from "../supabase/functions/_shared/study-core.ts";

const $ = (id) => document.getElementById(id);
let ctx = { getLang: () => "id", askCode: () => {}, onUnauthorized: () => {} };
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
const GRADE_LIST = ["TK", "SD", "SMP", "SMA", "S1", "S2", "S3", "Umum"];
const COUNTS = [5, 10, 15, 20, 25, 30];
const LETTERS = ["A", "B", "C", "D"];
const CUSTOM = "__custom";

// view: "home" | "profile" | "quiz" | "result". PIN hanya hidup di memori (hilang saat layar Study ditinggalkan).
const S = {
  view: "home",
  overview: null,
  overviewError: "",
  loading: false,
  player: null, // { id, name, grade }
  pin: "",
  profile: null,
  quiz: null, // { sessionId, session, questions, answers }
  result: null,
  explainFailed: false,
  resultFrom: "profile", // dari mana hasil dibuka: "profile" (milik sendiri) | "timeline" (detil kegiatan pemain lain)
  viewer: null, // { id, name, grade, pin } pemain yang sudah "masuk" untuk suka/komentar/detil; PIN hanya di memori
  tl: null, // timeline yang sedang dibuka
  tlScroll: 0
};

// ---------------------------------------------------------------- util
function errText(res) {
  if (res.noCode) return L("study_need_code");
  if (res.notDeployed) return L("study_not_deployed");
  if (res.unauthorized) return L("study_code_wrong");
  if (res.network) return `${L("study_network")} (${res.message})`;
  if (res.status === 504 || res.status === 546 || res.status === 502 && !res.generationFailed) return L("study_timeout");
  return res.message || "Error";
}

function handleFailure(res) {
  if (res.unauthorized) ctx.onUnauthorized();
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
}

export function hideStudyScreen() {
  const el = $("screen-study");
  if (el) el.hidden = true;
  // keluar dari layar = PIN dilupakan
  S.pin = "";
  S.player = null;
  S.profile = null;
  S.viewer = null;
  S.tl = null;
}

export function showStudyScreen() {
  $("screen-study").hidden = false;
  S.view = "home";
  S.pin = "";
  S.player = null;
  S.profile = null;
  S.quiz = null;
  S.result = null;
  S.viewer = null;
  S.tl = null;
  render();
  loadOverview();
}

export function rerenderStudy() {
  if (!$("screen-study") || $("screen-study").hidden) return;
  render();
}

function onBack() {
  if (S.view === "quiz") {
    if (!window.confirm(L("study_leave_confirm"))) return;
    S.quiz = null;
    S.view = "profile";
    loadProfile();
    return;
  }
  if (S.view === "result") {
    S.result = null;
    if (S.resultFrom === "timeline" && S.tl) {
      S.view = "timeline";
      render();
      window.scrollTo(0, S.tlScroll || 0);
      return;
    }
    S.view = "profile";
    loadProfile();
    return;
  }
  if (S.view === "timeline") {
    S.view = "home";
    S.tl = null;
    S.player = null;
    S.pin = "";
    S.profile = null;
    render();
    loadOverview();
    return;
  }
  if (S.view === "profile") {
    S.view = "home";
    S.player = null;
    S.pin = "";
    S.profile = null;
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
    if (res.unauthorized) ctx.onUnauthorized();
    S.overviewError = errText(res);
    if (res.noCode || res.unauthorized) S.overview = null;
  }
  if (S.view === "home") render();
}

async function loadProfile() {
  if (!S.player) return;
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
  render();
}

// ---------------------------------------------------------------- tampilan
function setTopbar() {
  const title = $("study-title");
  const settingsBtn = $("study-settings-btn");
  if (title) {
    title.textContent =
      S.view === "profile" && S.player ? S.player.name : S.view === "timeline" && S.tl?.owner ? S.tl.owner.name : S.view === "quiz" ? L("study_quiz_title") : S.view === "result" ? L("study_result_title") : L("study_title");
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
  else if (S.view === "timeline") renderTimeline(body);
  typesetMath(body).catch(() => {});
}

function renderHome(body) {
  if (S.overviewError && !S.overview) {
    const needCode = S.overviewError === L("study_need_code") || S.overviewError === L("study_code_wrong");
    body.innerHTML = `
      <div class="study-card">
        <p>${esc(S.overviewError)}</p>
        <div class="study-actions">
          ${needCode ? `<button type="button" class="primary-btn" data-act="enter-code">${esc(L("study_enter_code"))}</button>` : ""}
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
      <button type="button" class="study-board-row" data-act="open-timeline" data-id="${esc(p.id)}">
        <span class="study-rank">${i + 1}</span>
        <span class="study-name">${esc(p.name)}</span>
        <span>${esc(p.grade)}</span>
        <span>${fmt(p.sessionsDone)}</span>
        <span class="study-pts">${fmt(p.totalPoints)}</span>
      </button>`
    )
    .join("");
  body.innerHTML = `
    <div class="study-actions">
      <button type="button" class="primary-btn" data-act="new-player">${esc(L("study_new_player"))}</button>
      <button type="button" class="primary-btn" data-act="new-lesson">${esc(L("study_new_lesson"))}</button>
    </div>
    <h2 class="study-h">${esc(L("study_leaderboard"))}${S.loading ? ` <small>${esc(L("study_loading"))}</small>` : ""}</h2>
    ${
      players.length === 0
        ? `<p class="status-text">${esc(L("study_board_empty"))}</p>`
        : `<div class="study-board" role="table">
        <div class="study-board-head" role="row">
          <span>#</span><span>${esc(L("study_col_name"))}</span><span>${esc(L("study_col_grade"))}</span><span>${esc(L("study_col_done"))}</span><span>${esc(L("study_col_points"))}</span>
        </div>
        ${rows}
      </div>
      <p class="study-hint">${esc(L("study_board_hint"))}</p>`
    }`;
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
          const lvl = `${esc(L(`study_level_${s.level}`))} · ${esc(s.materialGrade)}`;
          if (s.status === "submitted") {
            return `
          <div class="study-row">
            <div class="study-row-main"><div class="study-row-title">${esc(s.subject)}</div><div class="study-row-meta">${lvl} · ${fmtDate(s.submittedAt)}<br>${esc(L("study_score", { c: s.correctCount, n: s.numQuestions }))} · +${fmt(s.pointsAwarded)} ${esc(L("study_pts"))}</div></div>
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
    <div class="study-card study-balance">
      <div class="study-balance-label">${esc(L("study_balance"))}</div>
      <div class="study-balance-value">${fmt(p.balance)}</div>
      <div class="study-row-meta">${esc(p.player.grade)} · ${esc(L("study_total_earned"))}: ${fmt(p.totalEarned)}</div>
    </div>
    <div class="study-actions">
      <button type="button" class="primary-btn" data-act="new-lesson-me">${esc(L("study_new_lesson"))}</button>
      <button type="button" class="secondary-btn" data-act="my-timeline">${esc(L("study_tl_my"))}</button>
    </div>
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
      <div class="study-row-title">${esc(q.session.subject)}${q.session.topic ? ` · ${esc(q.session.topic)}` : ""}</div>
      <div class="study-row-meta">${esc(q.session.materialGrade)} · ${esc(levelLabel(q.session.level, S.overview?.settings))} · ${q.questions.length} ${esc(L("study_questions_unit"))}</div>
      ${q.shortfall ? `<div class="study-row-meta">${esc(L("study_shortfall", { got: q.questions.length, want: q.questions.length + q.shortfall }))}</div>` : ""}
    </div>
    ${cards}
    <div class="study-submit-bar">
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
      <div class="study-row-title">${esc(r.session.subject)}${r.session.topic ? ` · ${esc(r.session.topic)}` : ""}</div>
      <div class="study-row-meta">${esc(r.player.name)} · ${esc(r.session.materialGrade)} · ${esc(L(`study_level_${r.session.level}`))} (${r.weightPercent}%)</div>
      <div class="study-score-main">${esc(L("study_score", { c: r.correct, n: r.total }))}</div>
      <div class="study-score-points">+${fmt(r.points)} <small>${esc(L("study_pts"))}</small></div>
      <div class="study-row-meta">${esc(L("study_pdf_formula", { base: r.basePoints, correct: r.correct, total: r.total, weight: r.weightPercent }))}</div>
    </div>
    ${S.explainFailed && S.resultFrom !== "timeline" ? `<div class="study-card"><p>${esc(L("study_explain_failed"))}</p><button type="button" class="secondary-btn" data-act="explain-retry">${esc(L("study_explain_retry"))}</button></div>` : ""}
    <div class="study-actions">
      <button type="button" class="primary-btn" data-act="share-pdf">${esc(L("study_share_pdf"))}</button>
      ${
        S.resultFrom === "timeline"
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
  if (act === "enter-code") return ctx.askCode();
  if (act === "new-player") return openNewPlayerForm();
  if (act === "new-lesson") return openLessonForm(null);
  if (act === "new-lesson-me") return openLessonForm(S.player);
  if (act === "open-player") return openPlayerPin(id);
  if (act === "open-timeline") return openTimeline(id);
  if (act === "my-timeline") return openTimeline(S.player?.id);
  if (act === "tl-profile") return openProfileFromTimeline();
  if (act === "tl-more") return loadMoreTimeline();
  if (act === "tl-signin") return signInViewer();
  if (act === "tl-signout") return signOutViewer();
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
  if (act === "to-profile") {
    S.result = null;
    S.view = "profile";
    return loadProfile();
  }
}

// ---------------------------------------------------------------- pemain
const gradeOptions = () => GRADE_LIST.map((g) => ({ value: g, label: g }));

function validPinFormat(p) {
  return typeof p === "string" && /^\d{4,6}$/.test(p);
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
      { key: "pin", label: L("study_np_pin"), type: "pin" },
      { key: "pin2", label: L("study_np_pin2"), type: "pin" }
    ],
    onSubmit: async (v) => {
      if (!String(v.name || "").trim()) return { ok: false, error: L("study_np_name_required") };
      if (!validPinFormat(v.pin)) return { ok: false, error: L("study_pin_invalid") };
      if (v.pin !== v.pin2) return { ok: false, error: L("study_np_mismatch") };
      const res = await studyCall("player_create", { name: v.name, grade: v.grade, pin: v.pin });
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
  }).then((out) => {
    if (!out) return;
    S.player = out.res.player;
    S.pin = out.pin;
    S.profile = out.res;
    S.viewer = { ...out.res.player, pin: out.pin };
    S.view = "profile";
    render();
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
  const maxPoints = (level) => Math.round((lessonSettings.basePoints * (lessonSettings.weights[level] ?? 100)) / 100);
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
        options: players.map((p) => ({ value: p.id, label: `${p.name} (${p.grade})` })),
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
      { key: "count", label: L("study_count"), type: "select", value: "10", options: COUNTS.map((n) => ({ value: String(n), label: String(n) })) },
      {
        key: "level",
        label: L("study_level"),
        type: "select",
        value: "normal",
        options: ["easy", "normal", "hard"].map((lv) => ({ value: lv, label: levelLabel(lv, lessonSettings) })),
        help: (v) => L("study_max_points", { n: fmt(maxPoints(v.level || "normal")) })
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
      const pin = fixed ? S.pin : v.pin;
      if (!validPinFormat(pin)) return { ok: false, error: L("study_pin_invalid") };
      const subject = v.subject === CUSTOM ? String(v.customSubject || "").trim() : v.subject;
      if (!subject) return { ok: false, error: L("study_subject_required") };
      const res = await studyCall("session_start", {
        playerId: pl.id,
        pin,
        subject,
        topic: String(v.topic || "").trim(),
        materialGrade: v.materialGrade,
        level: v.level,
        count: Number(v.count),
        engine: "auto"
      });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: { res, player: pl, pin } };
    }
  }).then((out) => {
    if (!out) return;
    S.player = { id: out.player.id, name: out.player.name, grade: out.player.grade };
    S.pin = out.pin;
    S.viewer = { ...S.player, pin: out.pin };
    S.quiz = {
      sessionId: out.res.sessionId,
      session: out.res.session,
      questions: out.res.questions,
      answers: new Array(out.res.questions.length).fill(null),
      shortfall: out.res.shortfall || 0
    };
    saveAnswers(S.quiz.sessionId, S.quiz.answers);
    S.view = "quiz";
    render();
    window.scrollTo(0, 0);
  });
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
async function submitQuiz(btn) {
  const q = S.quiz;
  if (!q) return;
  const unanswered = q.answers.filter((a) => a === null).length;
  if (unanswered > 0 && !window.confirm(L("study_unanswered_confirm", { n: unanswered }))) return;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = L("study_submit_busy");
  const res = await studyCall("session_submit", { playerId: S.player.id, pin: S.pin, sessionId: q.sessionId, answers: q.answers, engine: "auto" });
  btn.disabled = false;
  btn.textContent = old;
  if (!res.ok) return handleFailure(res);
  clearAnswers(q.sessionId);
  S.quiz = null;
  S.result = res.result;
  S.explainFailed = !!res.explainFailed;
  S.resultFrom = "profile";
    S.view = "result";
  render();
  window.scrollTo(0, 0);
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
  S.result = res.result;
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

// ================================================================ Timeline (kegiatan pemain, suka, komentar, detil)
const COMMENT_MAX = 300;

const viewerParams = () => (S.viewer ? { viewerId: S.viewer.id, viewerPin: S.viewer.pin } : {});
const fmtDateTime = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const initial = (name) => esc(String(name || "?").trim().charAt(0).toUpperCase() || "?");
const tlItem = (sid) => S.tl?.items.find((i) => i.sessionId === sid);

// PIN penonton salah/terkunci (mis. PIN direset): lupakan penonton supaya bisa masuk lagi.
function viewerFailure(res) {
  if (res.pinWrong || res.locked) {
    S.viewer = null;
    if (S.view === "timeline") render();
  }
  handleFailure(res);
}

async function openTimeline(ownerId) {
  if (!ownerId) return;
  S.tl = { ownerId, owner: null, items: [], hasMore: false, loading: true, comments: {}, drafts: {} };
  S.view = "timeline";
  render();
  window.scrollTo(0, 0);
  const tl = S.tl;
  const res = await studyCall("timeline", { playerId: ownerId, ...viewerParams() });
  if (S.tl !== tl) return;
  tl.loading = false;
  if (!res.ok) {
    S.tl = null;
    S.view = "home";
    if (res.pinWrong || res.locked) S.viewer = null;
    handleFailure(res);
    render();
    loadOverview();
    return;
  }
  tl.owner = res.owner;
  tl.items = res.items;
  tl.hasMore = res.hasMore;
  render();
}

async function loadMoreTimeline() {
  const tl = S.tl;
  if (!tl || tl.loading || !tl.hasMore) return;
  tl.loading = true;
  render();
  const last = tl.items[tl.items.length - 1];
  const res = await studyCall("timeline", { playerId: tl.ownerId, before: last?.submittedAt, ...viewerParams() });
  if (S.tl !== tl) return;
  tl.loading = false;
  if (!res.ok) {
    render();
    return viewerFailure(res);
  }
  const have = new Set(tl.items.map((i) => i.sessionId));
  tl.items = tl.items.concat(res.items.filter((i) => !have.has(i.sessionId)));
  tl.hasMore = res.hasMore;
  tl.owner = res.owner;
  render();
}

// Ambil ulang semua kartu yang sudah tampil (mis. setelah masuk, supaya status "disukai" benar).
async function refreshTimeline() {
  const tl = S.tl;
  if (!tl) return;
  const want = Math.max(tl.items.length, 1);
  let items = [];
  let more = true;
  let owner = tl.owner;
  while (more && items.length < want) {
    const res = await studyCall("timeline", { playerId: tl.ownerId, before: items.length ? items[items.length - 1].submittedAt : undefined, ...viewerParams() });
    if (!res.ok) return viewerFailure(res);
    owner = res.owner;
    items = items.concat(res.items);
    more = res.hasMore;
  }
  if (S.tl !== tl) return;
  tl.owner = owner;
  tl.items = items;
  tl.hasMore = more;
  render();
}

function openProfileFromTimeline() {
  const o = S.tl?.owner;
  if (!o) return;
  if (S.viewer && S.viewer.id === o.id) {
    S.player = { id: o.id, name: o.name, grade: o.grade };
    S.pin = S.viewer.pin;
    S.profile = null;
    S.view = "profile";
    render();
    loadProfile();
    return;
  }
  return openPlayerPin(o.id);
}

// ---- masuk sebagai penonton
function openViewerLogin() {
  const players = S.overview?.players || [];
  if (!players.length) return Promise.resolve(false);
  const first = players.find((p) => p.id !== S.tl?.owner?.id) || players[0];
  return openFormDialog({
    title: L("study_signin_title"),
    okLabel: L("study_signin_ok"),
    cancelLabel: L("study_cancel"),
    busyLabel: L("study_loading"),
    fields: [
      { key: "playerId", label: L("study_player"), type: "select", value: first.id, options: players.map((p) => ({ value: p.id, label: `${p.name} (${p.grade})` })) },
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
      const res = await studyCall("player_verify", { playerId: v.playerId, pin: v.pin });
      if (!res.ok) return { ok: false, error: errText(res) };
      return { ok: true, value: { player: res.player, pin: v.pin } };
    }
  }).then((out) => {
    if (!out) return false;
    S.viewer = { ...out.player, pin: out.pin };
    return true;
  });
}

async function signInViewer() {
  if (await openViewerLogin()) await refreshTimeline();
}

function signOutViewer() {
  S.viewer = null;
  if (S.tl) S.tl.items.forEach((i) => (i.liked = false));
  render();
}

// Pastikan sudah masuk; bila belum, tampilkan popup. true = siap.
async function ensureViewer() {
  if (S.viewer) return true;
  if (!(await openViewerLogin())) return false;
  await refreshTimeline();
  return !!S.viewer;
}

// ---- tampilan
function viewerBarHtml() {
  if (S.viewer) {
    return `<div class="study-viewer"><span>${esc(L("study_tl_signed_as", { name: S.viewer.name }))}</span><button type="button" class="study-link-btn" data-act="tl-signout">${esc(L("study_tl_signout"))}</button></div>`;
  }
  return `<div class="study-viewer"><span>${esc(L("study_tl_signed_out"))}</span><button type="button" class="study-link-btn" data-act="tl-signin">${esc(L("study_tl_signin"))}</button></div>`;
}

function commentsHtml(it) {
  const cm = S.tl.comments[it.sessionId];
  if (!cm || !cm.open) return "";
  const isOwn = !!S.viewer && S.viewer.id === S.tl.owner.id;
  const parentSet = !!S.overview?.settings?.parentPinSet;
  let list;
  if (cm.loading) list = `<p class="status-text">${esc(L("study_loading"))}</p>`;
  else if (!cm.list || cm.list.length === 0) list = `<p class="study-row-meta">${esc(L("study_comment_none"))}</p>`;
  else {
    list = cm.list
      .map((c) => {
        const mine = !!S.viewer && S.viewer.id === c.playerId;
        const del = mine
          ? `<button type="button" class="study-link-btn" data-act="comment-del" data-id="${esc(c.id)}" data-sid="${esc(it.sessionId)}">${esc(L("study_comment_delete"))}</button>`
          : parentSet
            ? `<button type="button" class="study-link-btn" data-act="comment-del" data-parent="1" data-id="${esc(c.id)}" data-sid="${esc(it.sessionId)}">${esc(L("study_comment_delete_parent"))}</button>`
            : "";
        return `
      <div class="study-comment">
        <span class="study-avatar study-avatar--sm">${initial(c.name)}</span>
        <div class="study-comment-main">
          <div class="study-comment-head"><strong>${esc(c.name)}</strong> <small>${esc(c.grade)}</small> <small>${esc(fmtDateTime(c.createdAt))}</small></div>
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
        <textarea rows="2" maxlength="${COMMENT_MAX}" data-draft="${esc(it.sessionId)}" placeholder="${esc(L("study_comment_ph"))}" aria-label="${esc(L("study_comment_ph"))}">${esc(S.tl.drafts[it.sessionId] || "")}</textarea>
        <button type="button" class="primary-btn" data-act="comment-send" data-id="${esc(it.sessionId)}" ${cm.sending ? "disabled" : ""}>${esc(L("study_comment_send"))}</button>
      </div>`;
  }
  return `<div class="study-comments">${list}${composer}</div>`;
}

function postHtml(it) {
  const o = S.tl.owner;
  const isOwn = !!S.viewer && S.viewer.id === o.id;
  const cm = S.tl.comments[it.sessionId];
  const topic = it.topic ? ` · ${esc(it.topic)}` : "";
  return `
  <article class="study-post" data-card="${esc(it.sessionId)}">
    <header class="study-post-head">
      <span class="study-avatar">${initial(o.name)}</span>
      <div>
        <div class="study-post-name">${esc(o.name)} <small>${esc(o.grade)}</small></div>
        <div class="study-row-meta">${esc(fmtDateTime(it.submittedAt))}</div>
      </div>
    </header>
    <p class="study-post-text"><strong>${esc(o.name)}</strong> ${esc(L("study_tl_finished"))} <strong>${esc(it.subject)}</strong>${topic}</p>
    <div class="study-post-chips">
      <span class="study-badge">${esc(L(`study_level_${it.level}`))} (${it.weightPercent}%)</span>
      <span class="study-badge">${esc(it.materialGrade)}</span>
      <span class="study-badge study-badge--solid">${esc(L("study_score", { c: it.correct, n: it.total }))}</span>
      <span class="study-post-points">+${fmt(it.points)} ${esc(L("study_pts"))}</span>
    </div>
    <div class="study-post-counts"><span>${esc(L("study_likes_count", { n: fmt(it.likeCount) }))}</span><span>${esc(L("study_comments_count", { n: fmt(it.commentCount) }))}</span></div>
    <div class="study-post-actions">
      <button type="button" class="study-post-btn ${it.liked ? "is-on" : ""}" data-act="like" data-id="${esc(it.sessionId)}" aria-pressed="${it.liked ? "true" : "false"}" ${isOwn ? "disabled" : ""}>${esc(L(it.liked ? "study_liked" : "study_like"))}</button>
      <button type="button" class="study-post-btn ${cm && cm.open ? "is-on" : ""}" data-act="comments" data-id="${esc(it.sessionId)}" aria-expanded="${cm && cm.open ? "true" : "false"}">${esc(L("study_comment_btn"))}</button>
      <button type="button" class="study-post-btn" data-act="detail" data-id="${esc(it.sessionId)}">${esc(L("study_detail_btn"))}</button>
    </div>
    ${commentsHtml(it)}
  </article>`;
}

function updateCard(sid) {
  const it = tlItem(sid);
  const el = $("study-body")?.querySelector(`[data-card="${CSS.escape(sid)}"]`);
  if (!it || !el || S.view !== "timeline") return;
  const tmp = document.createElement("div");
  tmp.innerHTML = postHtml(it).trim();
  el.replaceWith(tmp.firstElementChild);
}

function renderTimeline(body) {
  const tl = S.tl;
  if (!tl) return;
  if (!tl.owner) {
    body.innerHTML = `<p class="status-text">${esc(L("study_loading"))}</p>`;
    return;
  }
  const o = tl.owner;
  const you = S.viewer && S.viewer.id === o.id ? ` ${esc(L("study_tl_you"))}` : "";
  body.innerHTML = `
    <div class="study-card study-profile-head">
      <span class="study-avatar study-avatar--lg">${initial(o.name)}</span>
      <div class="study-profile-info">
        <div class="study-row-title">${esc(o.name)}${you} <small>${esc(o.grade)}</small></div>
        <div class="study-row-meta">${esc(L("study_tl_rank", { n: o.rank }))} · ${esc(L("study_tl_stats", { done: fmt(o.sessionsDone), points: fmt(o.totalPoints) }))}</div>
      </div>
      <button type="button" class="secondary-btn" data-act="tl-profile">${esc(L("study_tl_open_profile"))}</button>
    </div>
    ${viewerBarHtml()}
    ${tl.items.length === 0 ? `<p class="status-text">${esc(L("study_tl_empty"))}</p>` : tl.items.map(postHtml).join("")}
    ${tl.hasMore ? `<div class="study-actions"><button type="button" class="secondary-btn" data-act="tl-more" ${tl.loading ? "disabled" : ""}>${esc(tl.loading ? L("study_loading") : L("study_tl_more"))}</button></div>` : tl.loading ? `<p class="status-text">${esc(L("study_loading"))}</p>` : ""}`;
}

// ---- aksi kartu
async function doLike(sid) {
  if (!tlItem(sid) || !(await ensureViewer())) return;
  if (S.viewer.id === S.tl.owner.id) return; // tidak boleh menyukai kegiatan sendiri
  const res = await studyCall("like_toggle", { ...viewerParams(), sessionId: sid });
  if (!res.ok) return viewerFailure(res);
  const it = tlItem(sid); // ambil ulang: masuk tadi memuat ulang kartu
  if (!it) return;
  it.liked = res.liked;
  it.likeCount = res.count;
  updateCard(sid);
}

async function toggleComments(sid) {
  const it = tlItem(sid);
  if (!it) return;
  const cm = (S.tl.comments[sid] ||= { open: false, loading: false, list: null, sending: false });
  cm.open = !cm.open;
  if (cm.open && cm.list === null) {
    cm.loading = true;
    updateCard(sid);
    const res = await studyCall("comment_list", { sessionId: sid });
    cm.loading = false;
    if (!res.ok) {
      cm.open = false;
      updateCard(sid);
      return handleFailure(res);
    }
    cm.list = res.comments;
    it.commentCount = res.comments.length;
  }
  updateCard(sid);
  if (cm.open) $("study-body")?.querySelector(`[data-draft="${CSS.escape(sid)}"]`)?.focus();
}

function onBodyInput(e) {
  const ta = e.target.closest?.("textarea[data-draft]");
  if (ta && S.tl) S.tl.drafts[ta.dataset.draft] = ta.value;
}

async function sendComment(sid) {
  const cm = S.tl?.comments[sid];
  if (!tlItem(sid) || !cm || cm.sending) return;
  if (!(await ensureViewer())) return;
  if (S.viewer.id === S.tl.owner.id) return;
  const text = String(S.tl.drafts[sid] || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  if (text.length > COMMENT_MAX) return window.alert(L("study_comment_ph"));
  cm.sending = true;
  updateCard(sid);
  const res = await studyCall("comment_add", { ...viewerParams(), sessionId: sid, body: text });
  cm.sending = false;
  if (!S.tl || S.tl.comments[sid] !== cm) return; // timeline sudah ditinggalkan selama menunggu
  if (!res.ok) {
    updateCard(sid);
    return viewerFailure(res);
  }
  const it = tlItem(sid);
  (cm.list ||= []).push(res.comment);
  if (it) it.commentCount = res.count;
  S.tl.drafts[sid] = "";
  updateCard(sid);
}

async function deleteComment(commentId, sid, byParent) {
  const it = tlItem(sid);
  const cm = S.tl?.comments[sid];
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
  updateCard(sid);
}

async function openDetail(sid) {
  if (!tlItem(sid) || !(await ensureViewer())) return;
  const res = await studyCall("result_detail", { ...viewerParams(), sessionId: sid });
  if (!res.ok) return viewerFailure(res);
  S.tlScroll = window.scrollY;
  S.result = res.result;
  S.explainFailed = false;
  S.resultFrom = "timeline";
  S.view = "result";
  render();
  window.scrollTo(0, 0);
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
      <label class="study-field"><span class="study-field-label">${esc(L("study_set_base"))}</span><input type="number" inputmode="numeric" min="1" name="basePoints" value="${s.basePoints}" /></label>
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
    basePoints: num("basePoints"),
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
        { key: "playerId", label: L("study_player"), type: "select", options: players.map((p) => ({ value: p.id, label: `${p.name} (${p.grade})` })) },
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
