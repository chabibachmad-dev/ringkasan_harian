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
  ICON_DOC,
  ICON_SPARK
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
// Daftar obrolan bebas (tombol "+") yang pernah dimulai dari perangkat ini --
// disimpan lokal karena thread-nya tidak berasal dari tabel `summaries`
// (tidak terikat ringkasan tanggal tertentu), jadi tidak bisa didaftar dari
// server seperti obrolan ringkasan harian.
const FREEFORM_THREADS_KEY = "rh_freeform_threads";

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
  chatSendBtn: document.getElementById("chat-send-btn"),
  newChatFab: document.getElementById("new-chat-fab"),
  chatInputBar: document.getElementById("chat-input-bar"),
  scrollBottomBtn: document.getElementById("scroll-bottom-btn")
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

function isFreeformId(id) {
  return typeof id === "string" && id.startsWith("freeform-");
}

function getFreeformThreads() {
  try {
    const list = JSON.parse(localStorage.getItem(FREEFORM_THREADS_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (_err) {
    return [];
  }
}

function addFreeformThread(id) {
  try {
    const list = getFreeformThreads();
    list.unshift({ id, createdAt: new Date().toISOString() });
    localStorage.setItem(FREEFORM_THREADS_KEY, JSON.stringify(list));
  } catch (_err) {
    /* noop -- obrolan tetap bisa dipakai, cuma tidak muncul lagi di daftar
       setelah reload kalau localStorage gagal ditulis (mis. private mode). */
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

  const freeformThreads = getFreeformThreads();
  const allIds = [...state.summaries.map((row) => row.summary_date), ...freeformThreads.map((th) => th.id)];
  const openedDates = getOpenedDates();
  let lastMessages = {};
  if (state.chatCode && allIds.length > 0) {
    const result = await fetchLastMessages(allIds, state.chatCode);
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

  // Gabungkan obrolan ringkasan harian & obrolan bebas jadi satu daftar,
  // diurutkan berdasarkan aktivitas terbaru (mirip daftar chat WhatsApp) --
  // bukan cuma diurutkan berdasarkan tanggal ringkasan.
  const items = [];
  for (const row of state.summaries) {
    const lastMsg = lastMessages[row.summary_date];
    const sortTime = lastMsg?.created_at
      ? Date.parse(lastMsg.created_at)
      : row.status !== "none" && row.created_at
        ? Date.parse(row.created_at)
        : Date.parse(`${row.summary_date}T00:00:00`);
    items.push({ kind: "daily", id: row.summary_date, row, lastMsg, sortTime });
  }
  for (const thread of freeformThreads) {
    const lastMsg = lastMessages[thread.id];
    const sortTime = lastMsg?.created_at ? Date.parse(lastMsg.created_at) : Date.parse(thread.createdAt);
    items.push({ kind: "freeform", id: thread.id, thread, lastMsg, sortTime });
  }
  items.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));

  for (const entry of items) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "chat-list-item";

    const { lastMsg } = entry;
    const avatar = document.createElement("div");
    avatar.className = "chat-list-avatar";

    const main = document.createElement("div");
    main.className = "chat-list-main";

    const top = document.createElement("div");
    top.className = "chat-list-top";
    const dateLabel = document.createElement("span");
    dateLabel.className = "chat-list-date";
    const timeLabel = document.createElement("span");
    timeLabel.className = "chat-list-time";

    const bottom = document.createElement("div");
    bottom.className = "chat-list-bottom";
    const preview = document.createElement("span");
    preview.className = "chat-list-preview";
    const badges = document.createElement("span");
    badges.className = "chat-list-badges";

    let labelText;
    let previewText;

    if (entry.kind === "freeform") {
      avatar.innerHTML = ICON_SPARK;
      labelText = t(state.lang, "freeform_chat_title");
      const timeSource = lastMsg?.created_at || entry.thread.createdAt;
      timeLabel.textContent = timeSource ? formatBubbleTime(timeSource) : "";
      if (lastMsg) {
        const prefix = lastMsg.role === "assistant" ? "" : `${t(state.lang, "chat_you_prefix")} `;
        previewText = truncate(`${prefix}${lastMsg.content}`);
      } else {
        previewText = t(state.lang, "freeform_chat_preview");
      }
    } else {
      const row = entry.row;
      avatar.innerHTML = lastMsg ? ICON_CHAT : ICON_DOC;
      labelText = formatDateLabel(row.summary_date);
      const timeSource = lastMsg?.created_at || (row.status !== "none" ? row.created_at : null);
      timeLabel.textContent = timeSource ? formatBubbleTime(timeSource) : "";
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

      if (row.status === "failed") {
        const badge = document.createElement("span");
        badge.className = "chat-list-badge";
        badge.textContent = "!";
        badges.appendChild(badge);
      }
      const unread = row.status !== "none" && !lastMsg && !openedDates.has(row.summary_date);
      if (unread) {
        const dot = document.createElement("span");
        dot.className = "chat-list-unread-dot";
        badges.appendChild(dot);
      }
    }

    dateLabel.textContent = labelText;
    top.appendChild(dateLabel);
    top.appendChild(timeLabel);
    preview.textContent = previewText;
    bottom.appendChild(preview);
    bottom.appendChild(badges);

    main.appendChild(top);
    main.appendChild(bottom);
    item.appendChild(avatar);
    item.appendChild(main);
    item.dataset.search = `${labelText} ${previewText}`.toLowerCase();
    item.addEventListener("click", () => openDetail(entry.id));
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

// Halaman ini scroll di level dokumen/window (lihat catatan arsitektur di
// style.css), jadi "scroll ke bawah" berarti scroll window-nya, bukan
// #chat-messages -- elemen itu tidak overflow:auto/tinggi tetap sendiri jadi
// scrollTop di dirinya sendiri tidak ngaruh apa-apa.
function scrollChatToBottom(behavior = "auto") {
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior });
    // Dobel di frame berikutnya -- kadang tinggi konten masih menyesuaikan
    // (gambar/markdown/font baru selesai layout) sesaat setelah frame pertama.
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior });
      updateScrollBottomBtnVisibility();
    });
  });
}

// Tombol bulat "ke bawah" cuma relevan di layar detail, dan cuma kelihatan
// kalau posisi scroll sekarang sudah lumayan jauh dari pesan paling bawah.
function updateScrollBottomBtnVisibility() {
  if (!els.scrollBottomBtn) return;
  if (els.screenDetail.hidden) {
    els.scrollBottomBtn.classList.remove("visible");
    return;
  }
  const distanceFromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
  els.scrollBottomBtn.classList.toggle("visible", distanceFromBottom > 160);
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
  scrollChatToBottom();
}

function renderChatMessages(messages) {
  els.chatThread.innerHTML = "";
  if (!messages || messages.length === 0) {
    const p = document.createElement("p");
    p.className = "chat-empty-text";
    p.textContent = t(state.lang, isFreeformId(state.currentDate) ? "chat_empty_freeform" : "chat_empty");
    els.chatThread.appendChild(p);
  } else {
    for (const msg of messages) {
      appendChatBubble(msg.role, msg.content, msg.created_at);
    }
  }
  scrollChatToBottom();
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
  updateScrollBottomBtnVisibility();
  await renderChatList();
}

async function showDetailScreen(date) {
  state.currentDate = date;
  els.screenList.hidden = true;
  els.screenDetail.hidden = false;

  els.chatSummarySlot.innerHTML = "";

  if (isFreeformId(date)) {
    // Obrolan bebas: tidak ada ringkasan harian yang terkait, jadi tidak
    // perlu memuat/menampilkan bubble ringkasan -- langsung ke diskusi.
    els.detailDateTitle.textContent = t(state.lang, "freeform_chat_title");
  } else {
    els.detailDateTitle.textContent = formatDateLabel(date);
    markDateOpened(date);
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
  }

  if (state.chatCode) {
    await loadChatForDate(date);
  } else {
    els.chatThread.innerHTML = "";
  }

  // Terlepas dari diskusi terkunci/terbuka -- begitu layar detail dibuka,
  // langsung terscroll ke paling bawah (pesan/ringkasan terbaru).
  scrollChatToBottom();
}

function handleRoute() {
  // Terima ID tanggal (YYYY-MM-DD) maupun ID obrolan bebas (freeform-<uuid>).
  const match = location.hash.match(/^#d\/([0-9a-zA-Z_-]{1,60})$/);
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

  els.newChatFab.addEventListener("click", () => {
    const id = `freeform-${crypto.randomUUID()}`;
    addFreeformThread(id);
    openDetail(id);
  });

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

  // Tombol "ke bawah": muncul kalau user scroll ke atas, klik buat balik ke
  // pesan terbaru secara halus (smooth).
  window.addEventListener("scroll", updateScrollBottomBtnVisibility, { passive: true });
  els.scrollBottomBtn.addEventListener("click", () => scrollChatToBottom("smooth"));

  // #chat-input-bar tingginya bisa berubah-ubah (textarea multi-baris,
  // status "mengirim...", dsb) -- lacak lewat ResizeObserver supaya tombol
  // "ke bawah" selalu pas nangkring persis di atasnya, tidak ketumpuk.
  if (window.ResizeObserver && els.chatInputBar) {
    // Sengaja baca offsetHeight (border-box, termasuk padding) dari elemennya
    // langsung, BUKAN entry.contentRect dari ResizeObserver -- contentRect
    // itu content-box saja (padding atas/bawah #chat-input-bar tidak
    // terhitung), jadi kalau dipakai tombolnya bakal ketumpuk ~20px.
    const inputBarObserver = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--chat-input-bar-h", `${els.chatInputBar.offsetHeight}px`);
    });
    inputBarObserver.observe(els.chatInputBar);
  }
}

// Perbaikan bug WebKit: saat keyboard on-screen muncul di iOS (khususnya mode
// "Add to Home Screen"/standalone), header ".topbar" yang position:sticky bisa
// "hilang" ke atas layar. Ini terjadi karena begitu textarea/input difokus,
// iOS menggeser visual viewport (area yang benar-benar terlihat, tidak
// termasuk area keyboard) tanpa mengubah layout viewport tempat posisi
// sticky dihitung -- akibatnya elemen sticky yang seharusnya menempel di atas
// malah ikut "terdorong" ke luar area yang terlihat. Kompensasinya: pakai
// VisualViewport API buat menggeser header sejauh offset yang terjadi, supaya
// dia tetap kelihatan menempel di tepi atas layar yang sedang terlihat.
function fixStickyHeaderOnIOSKeyboard() {
  if (!window.visualViewport) return;

  function reposition() {
    const offsetTop = window.visualViewport.offsetTop || 0;
    document.querySelectorAll(".topbar").forEach((el) => {
      el.style.transform = offsetTop > 0.5 ? `translateY(${offsetTop}px)` : "";
    });
  }

  window.visualViewport.addEventListener("resize", reposition);
  window.visualViewport.addEventListener("scroll", reposition);
}

async function main() {
  applyTheme();
  applyLang();
  wireEvents();
  fixStickyHeaderOnIOSKeyboard();
  await registerServiceWorker();
  await loadDateList();
  await initChat();
  handleRoute();
  initNotify();
}

main();