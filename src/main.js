import { supabase } from "./supabaseClient.js";
import { applyStaticI18n, t } from "./i18n.js";
import { renderMiniMarkdown, renderChatMarkdown } from "./markdown.js";
import {
  ICON_BELL_OUTLINE,
  ICON_BELL_FILLED,
  ICON_BELL_PLUS,
  ICON_MOON,
  ICON_SUN,
  ICON_CHAT,
  ICON_DOC
} from "./icons.js";
import { isIOS, isStandalone, pushSupported, registerServiceWorker, getExistingSubscription, subscribeToPush } from "./push.js";
import {
  getStoredChatCode,
  setStoredChatCode,
  clearStoredChatCode,
  fetchChatHistory,
  sendChatMessage,
  fetchLastMessages
} from "./chat.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const OPENED_DATES_KEY = "rh_opened_dates";

const els = {
  screenList: document.getElementById("screen-list"),
  screenDetail: document.getElementById("screen-detail"),
  backBtn: document.getElementById("back-btn"),
  detailDateTitle: document.getElementById("detail-date-title"),
  notifyToggle: document.getElementById("notify-toggle"),
  notifyIcon: document.getElementById("notify-icon"),
  langToggle: document.getElementById("lang-toggle"),
  langLabel: document.getElementById("lang-label"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  chatSearchInput: document.getElementById("chat-search-input"),
  chatList: document.getElementById("chat-list"),
  chatListStatus: document.getElementById("chat-list-status"),
  chatSummarySlot: document.getElementById("chat-summary-slot"),
  chatThread: document.getElementById("chat-thread"),
  chatLockedBar: document.getElementById("chat-locked-bar"),
  chatUnlockBtn: document.getElementById("chat-unlock-btn"),
  chatCodeDialog: document.getElementById("chat-code-dialog"),
  chatCodeForm: document.getElementById("chat-code-form"),
  chatCodeInput: document.getElementById("chat-code-input"),
  chatCodeError: document.getElementById("chat-code-error"),
  chatCodeCancel: document.getElementById("chat-code-cancel"),
  chatMessages: document.getElementById("chat-messages"),
  chatStatus: document.getElementById("chat-status"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatSendBtn: document.getElementById("chat-send-btn")
};

const state = {
  lang: localStorage.getItem("rh_lang") || "id",
  theme: localStorage.getItem("rh_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  summaries: [], // { summary_date, status, content_id, content_en, sources, created_at, ... }
  currentDate: null,
  cache: new Map(), // summary_date -> full row
  chatCode: "",
  notifyMode: "idle",
  notifyExtra: ""
};

// Tanggal "hari ini" di zona WITA (UTC+8) -- sama persis dengan cara
// Edge Function generate-summary/chat menghitungnya, supaya konsisten.
function todayWita() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatBubbleTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const locale = state.lang === "id" ? "id-ID" : "en-US";
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function getOpenedDates() {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPENED_DATES_KEY) || "[]"));
  } catch (_err) {
    return new Set();
  }
}

function markDateOpened(date) {
  try {
    const set = getOpenedDates();
    if (set.has(date)) return;
    set.add(date);
    localStorage.setItem(OPENED_DATES_KEY, JSON.stringify([...set]));
  } catch (_err) {
    /* noop */
  }
}

const META_THEME_COLOR = document.getElementById("meta-theme-color");

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  els.themeIcon.innerHTML = state.theme === "dark" ? ICON_SUN : ICON_MOON;
  if (META_THEME_COLOR) {
    META_THEME_COLOR.setAttribute("content", state.theme === "dark" ? "#000000" : "#ffffff");
  }
}

function applyLang() {
  applyStaticI18n(state.lang);
  els.langLabel.textContent = state.lang.toUpperCase();
}

function formatDateLabel(dateStr) {
  const locale = state.lang === "id" ? "id-ID" : "en-US";
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

async function loadDateList() {
  const { data, error } = await supabase
    .from("summaries")
    .select("*")
    .order("summary_date", { ascending: false })
    .limit(60);

  if (error) {
    els.chatListStatus.hidden = false;
    els.chatListStatus.textContent = t(state.lang, "load_error");
    console.error(error);
    return;
  }

  state.summaries = data || [];

  // Pastikan tanggal hari ini (WITA) selalu ada di daftar, walau ringkasan
  // buat hari itu belum sempat dibuat cron -- supaya diskusi/chat hari ini
  // tetap bisa diakses dari awal, tidak harus menunggu jam 20:00.
  const today = todayWita();
  if (!state.summaries.some((row) => row.summary_date === today)) {
    state.summaries.unshift({ summary_date: today, status: "none" });
  }

  // Isi cache sekalian -- baris-baris ini sudah lengkap (select *), jadi
  // fetchSummary() tidak perlu query ulang waktu tanggalnya dibuka.
  for (const row of state.summaries) {
    if (row.status !== "none") {
      state.cache.set(row.summary_date, row);
    }
  }
}

async function fetchSummary(date) {
  if (state.cache.has(date)) return state.cache.get(date);
  const { data, error } = await supabase.from("summaries").select("*").eq("summary_date", date).maybeSingle();
  if (error) throw error;
  if (data) state.cache.set(date, data);
  return data;
}

function stripMarkdownPreview(md) {
  if (!md) return "";
  return md
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max = 90) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function applyChatListFilter() {
  const q = els.chatSearchInput.value.trim().toLowerCase();
  els.chatList.querySelectorAll(".chat-list-item").forEach((item) => {
    const haystack = item.dataset.search || "";
    item.hidden = q.length > 0 && !haystack.includes(q);
  });
}

async function renderChatList() {
  els.chatListStatus.hidden = false;
  els.chatListStatus.textContent = t(state.lang, "loading");
  els.chatList.innerHTML = "";

  const dates = state.summaries.map((row) => row.summary_date);
  const openedDates = getOpenedDates();
  let lastMessages = {};
  if (state.chatCode && dates.length > 0) {
    const result = await fetchLastMessages(dates, state.chatCode);
    if (result.ok) {
      lastMessages = result.lastMessages || {};
    } else if (result.unauthorized) {
      // Kode yang tersimpan sudah tidak cocok lagi -- lepas supaya
      // preview & chat minta kode ulang, tapi jangan ganggu daftar tanggal.
      state.chatCode = "";
      clearStoredChatCode();
    }
  }

  els.chatListStatus.hidden = true;

  for (const row of state.summaries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "chat-list-item";

    const lastMsg = lastMessages[row.summary_date];
    const unread = row.status !== "none" && !lastMsg && !openedDates.has(row.summary_date);

    const avatar = document.createElement("div");
    avatar.className = "chat-list-avatar";
    avatar.innerHTML = lastMsg ? ICON_CHAT : ICON_DOC;

    const main = document.createElement("div");
    main.className = "chat-list-main";

    const dateLabelText = formatDateLabel(row.summary_date);

    const top = document.createElement("div");
    top.className = "chat-list-top";
    const dateLabel = document.createElement("span");
    dateLabel.className = "chat-list-date";
    dateLabel.textContent = dateLabelText;
    top.appendChild(dateLabel);
    const timeLabel = document.createElement("span");
    timeLabel.className = "chat-list-time";
    const timeSource = lastMsg?.created_at || (row.status !== "none" ? row.created_at : null);
    timeLabel.textContent = timeSource ? formatBubbleTime(timeSource) : "";
    top.appendChild(timeLabel);

    const bottom = document.createElement("div");
    bottom.className = "chat-list-bottom";
    const preview = document.createElement("span");
    preview.className = "chat-list-preview";
    let previewText;
    if (lastMsg) {
      const prefix = lastMsg.role === "assistant" ? "" : `${t(state.lang, "chat_you_prefix")} `;
      previewText = truncate(`${prefix}${lastMsg.content}`);
    } else if (row.status === "failed") {
      previewText = t(state.lang, "failed_summary");
    } else if (row.status === "none") {
      previewText = t(state.lang, "no_summary");
    } else {
      const content = state.lang === "id" ? row.content_id : row.content_en || row.content_id;
      previewText = truncate(stripMarkdownPreview(content));
    }
    preview.textContent = previewText;
    bottom.appendChild(preview);

    const badges = document.createElement("span");
    badges.className = "chat-list-badges";
    if (row.status === "failed") {
      const badge = document.createElement("span");
      badge.className = "chat-list-badge";
      badge.textContent = "!";
      badges.appendChild(badge);
    }
    if (unread) {
      const dot = document.createElement("span");
      dot.className = "chat-list-unread-dot";
      badges.appendChild(dot);
    }
    bottom.appendChild(badges);

    main.appendChild(top);
    main.appendChild(bottom);
    item.appendChild(avatar);
    item.appendChild(main);
    item.dataset.search = `${dateLabelText} ${previewText}`.toLowerCase();
    item.addEventListener("click", () => openDetail(row.summary_date));
    els.chatList.appendChild(item);
  }

  applyChatListFilter();
}

function buildSourcesBlock(sources) {
  const container = document.createElement("div");
  container.className = "chat-summary-sources";

  const groups = [
    { key: "indonesia", label: t(state.lang, "sources_indonesia") },
    { key: "dunia", label: t(state.lang, "sources_dunia") }
  ];

  for (const group of groups) {
    const items = sources.filter((s) => s.category === group.key);
    if (items.length === 0) continue;

    const label = document.createElement("div");
    label.className = "chat-summary-sources-label";
    label.textContent = group.label;
    container.appendChild(label);

    const ul = document.createElement("ul");
    ul.className = "sources-list";
    for (const item of items) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = item.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = item.title;
      const small = document.createElement("span");
      small.className = "source-name";
      small.textContent = item.source;
      li.appendChild(a);
      li.appendChild(small);
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  return container;
}

function buildSummaryBubble(row) {
  if (!row) {
    const empty = document.createElement("div");
    empty.className = "chat-bubble assistant chat-bubble--system";
    empty.textContent = t(state.lang, "no_summary");
    return empty;
  }

  if (row.status === "failed") {
    const failed = document.createElement("div");
    failed.className = "chat-bubble assistant chat-bubble--system";
    failed.textContent = t(state.lang, "failed_summary");
    return failed;
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble assistant chat-bubble--summary";

  const textEl = document.createElement("div");
  textEl.className = "chat-summary-text";
  const content = state.lang === "id" ? row.content_id : row.content_en || row.content_id;
  textEl.innerHTML = renderMiniMarkdown(content);
  bubble.appendChild(textEl);

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "chat-summary-toggle";
  toggleBtn.textContent = t(state.lang, "chat_summary_more");
  toggleBtn.hidden = true;
  toggleBtn.addEventListener("click", () => {
    const expanded = textEl.classList.toggle("expanded");
    toggleBtn.textContent = t(state.lang, expanded ? "chat_summary_less" : "chat_summary_more");
  });
  bubble.appendChild(toggleBtn);

  const sources = Array.isArray(row.sources) ? row.sources : [];
  if (sources.length > 0) {
    bubble.appendChild(buildSourcesBlock(sources));
  }

  const timeEl = document.createElement("span");
  timeEl.className = "chat-bubble-time";
  timeEl.textContent = row.created_at ? formatBubbleTime(row.created_at) : "";
  bubble.appendChild(timeEl);

  // Baru tampilkan tombol "Tampilkan selengkapnya" kalau teksnya benar-benar
  // kepotong oleh batas tinggi (max-height) di CSS.
  requestAnimationFrame(() => {
    if (textEl.scrollHeight > textEl.clientHeight + 4) {
      toggleBtn.hidden = false;
    }
  });

  return bubble;
}

function appendChatBubble(role, content, timestamp) {
  const emptyEl = els.chatThread.querySelector(".chat-empty-text");
  if (emptyEl) emptyEl.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "assistant" ? "assistant" : "user"}`;

  const textEl = document.createElement("div");
  textEl.className = "chat-bubble-text";
  textEl.innerHTML = renderChatMarkdown(content);
  bubble.appendChild(textEl);

  const timeEl = document.createElement("span");
  timeEl.className = "chat-bubble-time";
  timeEl.textContent = formatBubbleTime(timestamp || new Date());
  bubble.appendChild(timeEl);

  els.chatThread.appendChild(bubble);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function renderChatMessages(messages) {
  els.chatThread.innerHTML = "";
  if (!messages || messages.length === 0) {
    const p = document.createElement("p");
    p.className = "chat-empty-text";
    p.textContent = t(state.lang, "chat_empty");
    els.chatThread.appendChild(p);
  } else {
    for (const msg of messages) {
      appendChatBubble(msg.role, msg.content, msg.created_at);
    }
  }
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function showChatLocked(errorText) {
  els.chatLockedBar.hidden = false;
  els.chatForm.hidden = true;
  if (errorText) {
    els.chatCodeError.hidden = false;
    els.chatCodeError.textContent = errorText;
    openChatCodeDialog();
  }
}

function showChatUnlocked() {
  els.chatLockedBar.hidden = true;
  els.chatForm.hidden = false;
}

function openChatCodeDialog() {
  els.chatCodeError.hidden = true;
  els.chatCodeError.textContent = "";
  els.chatCodeInput.value = "";
  if (typeof els.chatCodeDialog.showModal === "function") {
    els.chatCodeDialog.showModal();
  } else {
    els.chatCodeDialog.setAttribute("open", "");
  }
  els.chatCodeInput.focus();
}

function closeChatCodeDialog() {
  if (typeof els.chatCodeDialog.close === "function") {
    els.chatCodeDialog.close();
  } else {
    els.chatCodeDialog.removeAttribute("open");
  }
}

function setChatStatus(text) {
  if (!text) {
    els.chatStatus.hidden = true;
    els.chatStatus.textContent = "";
    return;
  }
  els.chatStatus.hidden = false;
  els.chatStatus.textContent = text;
}

async function loadChatForDate(date) {
  if (!state.chatCode) return;
  setChatStatus(t(state.lang, "loading"));
  const result = await fetchChatHistory(date, state.chatCode);
  if (!result.ok) {
    if (result.unauthorized) {
      // Kode yang tersimpan di browser ternyata sudah tidak cocok lagi
      // dengan CHAT_ACCESS_CODE di server -- minta dimasukkan ulang.
      state.chatCode = "";
      clearStoredChatCode();
      setChatStatus("");
      showChatLocked(t(state.lang, "chat_code_wrong"));
      return;
    }
    setChatStatus(t(state.lang, "chat_load_error"));
    return;
  }
  setChatStatus("");
  renderChatMessages(result.messages);
}

async function initChat() {
  const stored = getStoredChatCode();
  if (!stored) {
    showChatLocked();
    return;
  }
  state.chatCode = stored;
  showChatUnlocked();
}

async function showListScreen() {
  els.screenDetail.hidden = true;
  els.screenList.hidden = false;
  await renderChatList();
}

async function showDetailScreen(date) {
  state.currentDate = date;
  els.detailDateTitle.textContent = formatDateLabel(date);
  els.screenList.hidden = true;
  els.screenDetail.hidden = false;
  markDateOpened(date);

  els.chatSummarySlot.innerHTML = "";
  try {
    const row = await fetchSummary(date);
    els.chatSummarySlot.appendChild(buildSummaryBubble(row));
  } catch (err) {
    console.error(err);
    const errEl = document.createElement("div");
    errEl.className = "chat-bubble assistant chat-bubble--system";
    errEl.textContent = t(state.lang, "load_error");
    els.chatSummarySlot.appendChild(errEl);
  }

  if (state.chatCode) {
    await loadChatForDate(date);
  } else {
    els.chatThread.innerHTML = "";
  }
}

function handleRoute() {
  const match = location.hash.match(/^#d\/(\d{4}-\d{2}-\d{2})$/);
  if (match) {
    showDetailScreen(match[1]);
  } else {
    showListScreen();
  }
}

function openDetail(date) {
  location.hash = `d/${date}`;
}

function openList() {
  location.hash = "";
}

const NOTIFY_ICONS = {
  on: ICON_BELL_FILLED,
  need_install: ICON_BELL_PLUS,
  unsupported: ICON_BELL_OUTLINE,
  denied: ICON_BELL_OUTLINE,
  error: ICON_BELL_OUTLINE,
  save_error: ICON_BELL_OUTLINE,
  idle: ICON_BELL_OUTLINE
};

const NOTIFY_ACTIONABLE = new Set(["idle", "error", "save_error"]);

function setNotifyState(mode, extra) {
  // mode: "idle" | "on" | "need_install" | "unsupported" | "denied" | "error" | "save_error"
  state.notifyMode = mode;
  state.notifyExtra = extra || "";
  els.notifyToggle.disabled = false;
  els.notifyIcon.innerHTML = NOTIFY_ICONS[mode] || NOTIFY_ICONS.idle;
  els.notifyToggle.classList.toggle("icon-btn--attn", mode === "error" || mode === "save_error");

  const key =
    {
      on: "notify_on",
      need_install: "notify_need_install",
      unsupported: "notify_unsupported",
      denied: "notify_denied",
      error: "notify_error",
      save_error: "notify_save_error",
      idle: "notify_prompt"
    }[mode] || "notify_prompt";

  const text = extra ? `${t(state.lang, key)} (${extra})` : t(state.lang, key);
  els.notifyToggle.title = text;
  els.notifyToggle.setAttribute("aria-label", text);
}

async function saveSubscription(subJson) {
  // Disimpan lewat Edge Function `subscribe` (bukan insert langsung dari
  // browser) -- lihat komentar di supabase/functions/subscribe/index.ts
  // dan supabase/migrations/0003_lock_push_subscriptions.sql soal alasannya.
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify(subJson)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const message = data.error || `HTTP ${res.status}`;
      console.error("Gagal simpan subscription:", message);
      return { ok: false, message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Gagal simpan subscription:", err);
    return { ok: false, message };
  }
}

async function initNotify() {
  if (!pushSupported()) {
    setNotifyState("unsupported");
    return;
  }

  if (isIOS() && !isStandalone()) {
    setNotifyState("need_install");
    return;
  }

  await registerServiceWorker();

  const existing = await getExistingSubscription();
  if (existing) {
    const result = await saveSubscription(existing.toJSON());
    setNotifyState(result.ok ? "on" : "save_error", result.message);
    return;
  }

  if (Notification.permission === "denied") {
    setNotifyState("denied");
    return;
  }

  setNotifyState("idle");
}

async function tryEnableNotifications() {
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.includes("ganti-dengan")) {
    alert("VITE_VAPID_PUBLIC_KEY belum diisi di file .env — lihat README bagian setup notifikasi.");
    return;
  }
  els.notifyToggle.disabled = true;
  await registerServiceWorker();
  try {
    const result = await subscribeToPush(VAPID_PUBLIC_KEY);
    if (!result.ok) {
      setNotifyState(result.reason === "denied" ? "denied" : "error");
      return;
    }
    const saveResult = await saveSubscription(result.subscription);
    setNotifyState(saveResult.ok ? "on" : "save_error", saveResult.message);
  } catch (err) {
    console.error(err);
    setNotifyState("error");
  } finally {
    els.notifyToggle.disabled = false;
  }
}

function wireEvents() {
  els.notifyToggle.addEventListener("click", () => {
    if (NOTIFY_ACTIONABLE.has(state.notifyMode)) {
      tryEnableNotifications();
    } else {
      alert(els.notifyToggle.title);
    }
  });

  els.langToggle.addEventListener("click", async () => {
    state.lang = state.lang === "id" ? "en" : "id";
    localStorage.setItem("rh_lang", state.lang);
    applyLang();
    await loadDateList();
    handleRoute();
    initNotify();
  });

  els.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("rh_theme", state.theme);
    applyTheme();
  });

  els.backBtn.addEventListener("click", () => {
    openList();
  });

  els.chatSearchInput.addEventListener("input", applyChatListFilter);

  window.addEventListener("hashchange", handleRoute);

  els.chatUnlockBtn.addEventListener("click", () => {
    openChatCodeDialog();
  });

  els.chatCodeCancel.addEventListener("click", () => {
    closeChatCodeDialog();
  });

  els.chatCodeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = els.chatCodeInput.value.trim();
    if (!code) return;

    const submitBtn = els.chatCodeForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    els.chatCodeError.hidden = true;

    const date = state.currentDate || todayWita();
    const result = await fetchChatHistory(date, code);
    submitBtn.disabled = false;

    if (!result.ok) {
      els.chatCodeError.hidden = false;
      els.chatCodeError.textContent = result.unauthorized ? t(state.lang, "chat_code_wrong") : result.message;
      return;
    }

    state.chatCode = code;
    setStoredChatCode(code);
    els.chatCodeInput.value = "";
    showChatUnlocked();
    closeChatCodeDialog();
    renderChatMessages(result.messages);
  });

  els.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text || !state.chatCode) return;

    els.chatInput.value = "";
    els.chatInput.style.height = "auto";
    els.chatSendBtn.disabled = true;
    appendChatBubble("user", text, new Date());
    setChatStatus(t(state.lang, "chat_sending"));

    const date = state.currentDate || todayWita();
    const result = await sendChatMessage(date, state.chatCode, text);

    els.chatSendBtn.disabled = false;
    setChatStatus("");

    if (!result.ok) {
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
        showChatLocked(t(state.lang, "chat_code_wrong"));
        return;
      }
      setChatStatus(t(state.lang, "chat_error"));
      return;
    }

    appendChatBubble("assistant", result.reply, new Date());
  });

  // Enter buat kirim, Shift+Enter buat baris baru.
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.chatForm.requestSubmit();
    }
  });

  // Auto-resize textarea sederhana biar mengikuti panjang teks.
  els.chatInput.addEventListener("input", () => {
    els.chatInput.style.height = "auto";
    els.chatInput.style.height = `${els.chatInput.scrollHeight}px`;
  });
}

async function main() {
  applyTheme();
  applyLang();
  wireEvents();
  await registerServiceWorker();
  await loadDateList();
  await initChat();
  handleRoute();
  initNotify();
}

main();
