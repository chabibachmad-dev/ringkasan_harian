import { supabase } from "./supabaseClient.js";
import { applyStaticI18n, t } from "./i18n.js";
import { renderMiniMarkdown } from "./markdown.js";
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

const els = {
  screenList: document.getElementById("screen-list"),
  screenDetail: document.getElementById("screen-detail"),
  backBtn: document.getElementById("back-btn"),
  detailDateTitle: document.getElementById("detail-date-title"),
  langToggle: document.getElementById("lang-toggle"),
  langLabel: document.getElementById("lang-label"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  notifyCard: document.getElementById("notify-card"),
  notifyText: document.getElementById("notify-text"),
  notifyBtn: document.getElementById("notify-btn"),
  chatList: document.getElementById("chat-list"),
  chatListStatus: document.getElementById("chat-list-status"),
  summaryStatus: document.getElementById("summary-status"),
  summaryContent: document.getElementById("summary-content"),
  sourcesSection: document.getElementById("sources-section"),
  sourcesIndonesia: document.getElementById("sources-indonesia"),
  sourcesDunia: document.getElementById("sources-dunia"),
  chatLocked: document.getElementById("chat-locked"),
  chatLockedText: document.getElementById("chat-locked-text"),
  chatCodeForm: document.getElementById("chat-code-form"),
  chatCodeInput: document.getElementById("chat-code-input"),
  chatCodeError: document.getElementById("chat-code-error"),
  chatBody: document.getElementById("chat-body"),
  chatMessages: document.getElementById("chat-messages"),
  chatStatus: document.getElementById("chat-status"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatSendBtn: document.getElementById("chat-send-btn")
};

const state = {
  lang: localStorage.getItem("rh_lang") || "id",
  theme: localStorage.getItem("rh_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  summaries: [], // { summary_date, status }
  currentDate: null,
  cache: new Map(), // summary_date -> full row
  chatCode: ""
};

// Tanggal "hari ini" di zona WITA (UTC+8) -- sama persis dengan cara
// Edge Function generate-summary/chat menghitungnya, supaya konsisten.
function todayWita() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  els.themeIcon.textContent = state.theme === "dark" ? "☀️" : "🌙";
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

function renderSources(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const indo = list.filter((s) => s.category === "indonesia");
  const dunia = list.filter((s) => s.category === "dunia");

  function fill(container, items) {
    container.innerHTML = "";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.textContent = t(state.lang, "no_sources");
      container.appendChild(li);
      return;
    }
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
      container.appendChild(li);
    }
  }

  fill(els.sourcesIndonesia, indo);
  fill(els.sourcesDunia, dunia);
  els.sourcesSection.hidden = list.length === 0;
}

async function renderCurrentSummary() {
  if (!state.currentDate) {
    els.summaryStatus.hidden = false;
    els.summaryStatus.textContent = t(state.lang, "no_summary");
    els.summaryContent.innerHTML = "";
    els.sourcesSection.hidden = true;
    return;
  }

  els.summaryStatus.hidden = false;
  els.summaryStatus.textContent = t(state.lang, "loading");
  els.summaryContent.innerHTML = "";

  try {
    const row = await fetchSummary(state.currentDate);
    if (!row) {
      els.summaryStatus.textContent = t(state.lang, "no_summary");
      els.sourcesSection.hidden = true;
      return;
    }

    if (row.status === "failed") {
      els.summaryStatus.textContent = t(state.lang, "failed_summary");
      els.sourcesSection.hidden = true;
      return;
    }

    const content = state.lang === "id" ? row.content_id : row.content_en || row.content_id;
    els.summaryStatus.hidden = true;
    els.summaryContent.innerHTML = renderMiniMarkdown(content);
    renderSources(row.sources);
  } catch (err) {
    console.error(err);
    els.summaryStatus.hidden = false;
    els.summaryStatus.textContent = t(state.lang, "load_error");
  }
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

async function renderChatList() {
  els.chatListStatus.hidden = false;
  els.chatListStatus.textContent = t(state.lang, "loading");
  els.chatList.innerHTML = "";

  const dates = state.summaries.map((row) => row.summary_date);
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

    const avatar = document.createElement("div");
    avatar.className = "chat-list-avatar";
    avatar.textContent = lastMsg ? "💬" : "📰";

    const main = document.createElement("div");
    main.className = "chat-list-main";

    const top = document.createElement("div");
    top.className = "chat-list-top";
    const dateLabel = document.createElement("span");
    dateLabel.className = "chat-list-date";
    dateLabel.textContent = formatDateLabel(row.summary_date);
    top.appendChild(dateLabel);
    if (row.status === "failed") {
      const badge = document.createElement("span");
      badge.className = "chat-list-badge";
      badge.textContent = "⚠️";
      top.appendChild(badge);
    }

    const preview = document.createElement("div");
    preview.className = "chat-list-preview";
    if (lastMsg) {
      const prefix = lastMsg.role === "assistant" ? "" : `${t(state.lang, "chat_you_prefix")} `;
      preview.textContent = truncate(`${prefix}${lastMsg.content}`);
    } else if (row.status === "failed") {
      preview.textContent = t(state.lang, "failed_summary");
    } else if (row.status === "none") {
      preview.textContent = t(state.lang, "no_summary");
    } else {
      const content = state.lang === "id" ? row.content_id : row.content_en || row.content_id;
      preview.textContent = truncate(stripMarkdownPreview(content));
    }

    main.appendChild(top);
    main.appendChild(preview);
    item.appendChild(avatar);
    item.appendChild(main);
    item.addEventListener("click", () => openDetail(row.summary_date));
    els.chatList.appendChild(item);
  }
}

function showListScreen() {
  els.screenDetail.hidden = true;
  els.screenList.hidden = false;
  renderChatList();
}

async function showDetailScreen(date) {
  state.currentDate = date;
  els.detailDateTitle.textContent = formatDateLabel(date);
  els.screenList.hidden = true;
  els.screenDetail.hidden = false;
  await renderCurrentSummary();
  if (state.chatCode) {
    await loadChatForDate(date);
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

function setNotifyState(mode, extra) {
  // mode: "idle" | "on" | "need_install" | "unsupported" | "denied" | "error" | "save_error"
  els.notifyBtn.disabled = false;
  switch (mode) {
    case "on":
      els.notifyText.textContent = t(state.lang, "notify_on");
      els.notifyBtn.hidden = true;
      break;
    case "need_install":
      els.notifyText.textContent = t(state.lang, "notify_need_install");
      els.notifyBtn.hidden = true;
      break;
    case "unsupported":
      els.notifyText.textContent = t(state.lang, "notify_unsupported");
      els.notifyBtn.hidden = true;
      break;
    case "denied":
      els.notifyText.textContent = t(state.lang, "notify_denied");
      els.notifyBtn.hidden = true;
      break;
    case "error":
      els.notifyText.textContent = t(state.lang, "notify_error");
      els.notifyBtn.textContent = t(state.lang, "notify_btn");
      els.notifyBtn.hidden = false;
      break;
    case "save_error":
      els.notifyText.textContent = extra
        ? `${t(state.lang, "notify_save_error")} [${extra}]`
        : t(state.lang, "notify_save_error");
      els.notifyBtn.textContent = t(state.lang, "notify_retry_btn");
      els.notifyBtn.hidden = false;
      break;
    default:
      els.notifyText.textContent = t(state.lang, "notify_prompt");
      els.notifyBtn.textContent = t(state.lang, "notify_btn");
      els.notifyBtn.hidden = false;
  }
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

async function initNotifyCard() {
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

function setChatStatus(text) {
  if (!text) {
    els.chatStatus.hidden = true;
    els.chatStatus.textContent = "";
    return;
  }
  els.chatStatus.hidden = false;
  els.chatStatus.textContent = text;
}

function appendChatBubble(role, content) {
  const emptyEl = els.chatMessages.querySelector(".chat-empty-text");
  if (emptyEl) emptyEl.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "assistant" ? "assistant" : "user"}`;
  bubble.textContent = content;
  els.chatMessages.appendChild(bubble);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function renderChatMessages(messages) {
  els.chatMessages.innerHTML = "";
  if (!messages || messages.length === 0) {
    const p = document.createElement("p");
    p.className = "chat-empty-text";
    p.textContent = t(state.lang, "chat_empty");
    els.chatMessages.appendChild(p);
    return;
  }
  for (const msg of messages) {
    appendChatBubble(msg.role, msg.content);
  }
}

function showChatLocked(errorText) {
  els.chatLocked.hidden = false;
  els.chatBody.hidden = true;
  els.chatCodeError.hidden = !errorText;
  els.chatCodeError.textContent = errorText || "";
}

function showChatUnlocked() {
  els.chatLocked.hidden = true;
  els.chatBody.hidden = false;
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
  await loadChatForDate(state.currentDate || todayWita());
}

function wireEvents() {
  els.langToggle.addEventListener("click", async () => {
    state.lang = state.lang === "id" ? "en" : "id";
    localStorage.setItem("rh_lang", state.lang);
    applyLang();
    await loadDateList();
    handleRoute();
    initNotifyCard();
  });

  els.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("rh_theme", state.theme);
    applyTheme();
  });

  els.backBtn.addEventListener("click", () => {
    openList();
  });

  window.addEventListener("hashchange", handleRoute);

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
    renderChatMessages(result.messages);
  });

  els.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text || !state.chatCode) return;

    els.chatInput.value = "";
    els.chatInput.style.height = "auto";
    els.chatSendBtn.disabled = true;
    appendChatBubble("user", text);
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

    appendChatBubble("assistant", result.reply);
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

  els.notifyBtn.addEventListener("click", async () => {
    if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.includes("ganti-dengan")) {
      alert("VITE_VAPID_PUBLIC_KEY belum diisi di file .env — lihat README bagian setup notifikasi.");
      return;
    }
    els.notifyBtn.disabled = true;
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
    }
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
  initNotifyCard();
}

main();
