import { applyStaticI18n, t } from "./i18n.js";
import { renderChatMarkdown } from "./markdown.js";
import {
  ICON_MOON,
  ICON_SUN,
  ICON_CHAT,
  ICON_SPARK,
  ICON_DOTS,
  ICON_PIN,
  ICON_PIN_FILLED,
  ICON_EDIT,
  ICON_DOWNLOAD,
  ICON_INFO,
  ICON_TRASH
} from "./icons.js";
import { registerServiceWorker, isIOS, isStandalone } from "./push.js";
import {
  getStoredChatCode,
  setStoredChatCode,
  clearStoredChatCode,
  fetchChatHistory,
  sendChatMessage,
  fetchLastMessages,
  listChatThreads,
  deleteChatThread
} from "./chat.js";

// Daftar obrolan yang pernah dimulai dari perangkat ini (tombol "+") --
// disimpan lokal karena app ini sekarang murni asisten chat, tidak ada lagi
// daftar "tanggal ringkasan" dari server untuk dipakai sebagai sumber daftar.
const FREEFORM_THREADS_KEY = "rh_freeform_threads";
// Chat yang disematkan (pin) & judul custom (hasil "Ubah judul") -- sama-sama
// disimpan lokal per perangkat, dikunci dengan ID thread (tanggal kalender
// atau "freeform-<uuid>"), sama seperti FREEFORM_THREADS_KEY di atas.
const PINNED_CHATS_KEY = "rh_pinned_chats";
const CHAT_TITLES_KEY = "rh_chat_titles";

const els = {
  screenList: document.getElementById("screen-list"),
  screenDetail: document.getElementById("screen-detail"),
  backBtn: document.getElementById("back-btn"),
  detailDateTitle: document.getElementById("detail-date-title"),
  langToggle: document.getElementById("lang-toggle"),
  langLabel: document.getElementById("lang-label"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  chatSearchInput: document.getElementById("chat-search-input"),
  chatList: document.getElementById("chat-list"),
  chatListStatus: document.getElementById("chat-list-status"),
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
  scrollBottomBtn: document.getElementById("scroll-bottom-btn"),
  chatOptionsDialog: document.getElementById("chat-options-dialog"),
  chatOptionsTitle: document.getElementById("chat-options-title"),
  chatOptionsPinBtn: document.getElementById("chat-options-pin"),
  chatOptionsPinIcon: document.getElementById("chat-options-pin-icon"),
  chatOptionsPinLabel: document.getElementById("chat-options-pin-label"),
  chatOptionsRenameBtn: document.getElementById("chat-options-rename"),
  chatOptionsRenameIcon: document.getElementById("chat-options-rename-icon"),
  chatOptionsPdfBtn: document.getElementById("chat-options-pdf"),
  chatOptionsPdfIcon: document.getElementById("chat-options-pdf-icon"),
  chatOptionsDetailBtn: document.getElementById("chat-options-detail"),
  chatOptionsDetailIcon: document.getElementById("chat-options-detail-icon"),
  chatOptionsDeleteBtn: document.getElementById("chat-options-delete"),
  chatOptionsDeleteIcon: document.getElementById("chat-options-delete-icon"),
  chatOptionsCancel: document.getElementById("chat-options-cancel"),
  renameDialog: document.getElementById("rename-dialog"),
  renameForm: document.getElementById("rename-form"),
  renameInput: document.getElementById("rename-input"),
  renameCancel: document.getElementById("rename-cancel"),
  chatDetailDialog: document.getElementById("chat-detail-dialog"),
  chatDetailTitle: document.getElementById("chat-detail-title"),
  chatDetailEmpty: document.getElementById("chat-detail-empty"),
  chatDetailStats: document.getElementById("chat-detail-stats"),
  chatDetailTotal: document.getElementById("chat-detail-total"),
  chatDetailStart: document.getElementById("chat-detail-start"),
  chatDetailLast: document.getElementById("chat-detail-last"),
  chatDetailClose: document.getElementById("chat-detail-close"),
  printArea: document.getElementById("print-area")
};

const state = {
  lang: localStorage.getItem("rh_lang") || "id",
  theme: localStorage.getItem("rh_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  currentDate: null,
  chatCode: "",
  // id obrolan -> { defaultLabel } -- diisi ulang tiap kali renderChatList()
  // jalan, dipakai menu titik-3 buat tahu judul default chat yang lagi
  // diklik tanpa harus hitung ulang.
  listIndex: new Map(),
  activeOptionsId: null
};

function formatBubbleTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const locale = state.lang === "id" ? "id-ID" : "en-US";
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
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

// Dipanggil waktu satu obrolan dihapus lewat menu titik-3 "Hapus chat" --
// obrolan cuma ada karena ada thread-nya, jadi dihapus total dari daftar
// begitu isinya dihapus.
function removeFreeformThread(id) {
  try {
    const list = getFreeformThreads().filter((th) => th.id !== id);
    localStorage.setItem(FREEFORM_THREADS_KEY, JSON.stringify(list));
  } catch (_err) {
    /* noop */
  }
}

// Dipanggil waktu renderChatList() menemukan obrolan yang ADA di server
// (list_threads) tapi belum tercatat di localStorage perangkat ini --
// biasanya karena obrolan itu dibuat/diisi dari perangkat lain dengan kode
// akses yang sama. createdAt dari server (pesan pertamanya) dipakai, bukan
// "sekarang", supaya urutannya tetap wajar.
function mergeDiscoveredThread(id, createdAt) {
  try {
    const list = getFreeformThreads();
    if (list.some((th) => th.id === id)) return;
    list.push({ id, createdAt: createdAt || new Date().toISOString() });
    localStorage.setItem(FREEFORM_THREADS_KEY, JSON.stringify(list));
  } catch (_err) {
    /* noop */
  }
}

function getPinnedChats() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PINNED_CHATS_KEY) || "[]"));
  } catch (_err) {
    return new Set();
  }
}

function isPinned(id) {
  return getPinnedChats().has(id);
}

function togglePinned(id) {
  const set = getPinnedChats();
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  try {
    localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify([...set]));
  } catch (_err) {
    /* noop */
  }
}

function unpinChat(id) {
  const set = getPinnedChats();
  if (!set.has(id)) return;
  set.delete(id);
  try {
    localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify([...set]));
  } catch (_err) {
    /* noop */
  }
}

function getChatTitles() {
  try {
    const obj = JSON.parse(localStorage.getItem(CHAT_TITLES_KEY) || "{}");
    return obj && typeof obj === "object" ? obj : {};
  } catch (_err) {
    return {};
  }
}

function getCustomTitle(id) {
  return getChatTitles()[id] || "";
}

// title kosong/null berarti "reset ke judul default" -- hapus key-nya
// supaya file localStorage-nya tidak menumpuk entri kosong selamanya.
function setCustomTitle(id, title) {
  const titles = getChatTitles();
  const trimmed = (title || "").trim();
  if (trimmed) {
    titles[id] = trimmed;
  } else {
    delete titles[id];
  }
  try {
    localStorage.setItem(CHAT_TITLES_KEY, JSON.stringify(titles));
  } catch (_err) {
    /* noop */
  }
}

function clearChatTitle(id) {
  const titles = getChatTitles();
  if (!(id in titles)) return;
  delete titles[id];
  try {
    localStorage.setItem(CHAT_TITLES_KEY, JSON.stringify(titles));
  } catch (_err) {
    /* noop */
  }
}

// Judul default (sebelum dipengaruhi "Ubah judul") buat satu obrolan --
// dipakai renderChatList, showDetailScreen, dan isi awal popup opsi/rename.
function getDefaultLabel(_id) {
  return t(state.lang, "freeform_chat_title");
}

function getDisplayLabel(id) {
  return getCustomTitle(id) || getDefaultLabel(id);
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

  if (state.chatCode) {
    // Tanya server obrolan apa saja yang PERNAH ada (bukan cuma yang
    // tercatat di localStorage perangkat ini) -- supaya daftar ikut muncul
    // walau dibuka dari perangkat lain dengan kode akses yang sama, karena
    // kode aksesnya memang satu untuk semua perangkat, bukan per-perangkat.
    const threadsResult = await listChatThreads(state.chatCode);
    if (threadsResult.ok) {
      for (const th of threadsResult.threads || []) {
        mergeDiscoveredThread(th.id, th.createdAt);
      }
    } else if (threadsResult.unauthorized) {
      state.chatCode = "";
      clearStoredChatCode();
    }
  }

  const freeformThreads = getFreeformThreads();
  const allIds = freeformThreads.map((th) => th.id);
  let lastMessages = {};
  if (state.chatCode && allIds.length > 0) {
    const result = await fetchLastMessages(allIds, state.chatCode);
    if (result.ok) {
      lastMessages = result.lastMessages || {};
    } else if (result.unauthorized) {
      // Kode yang tersimpan sudah tidak cocok lagi -- lepas supaya
      // preview & chat minta kode ulang, tapi jangan ganggu daftarnya.
      state.chatCode = "";
      clearStoredChatCode();
    }
  }

  const pinnedSet = getPinnedChats();
  state.listIndex.clear();

  if (freeformThreads.length === 0) {
    els.chatListStatus.hidden = false;
    els.chatListStatus.textContent = t(state.lang, "chat_list_empty");
    applyChatListFilter();
    return;
  }
  els.chatListStatus.hidden = true;

  // Diurutkan berdasarkan aktivitas terbaru (mirip daftar chat WhatsApp).
  // Yang disematkan (pin) selalu naik ke atas duluan, baru di dalam
  // masing-masing grup (disematkan / tidak) diurutkan berdasarkan waktu
  // aktivitas terakhir.
  const items = freeformThreads.map((thread) => {
    const lastMsg = lastMessages[thread.id];
    const sortTime = lastMsg?.created_at ? Date.parse(lastMsg.created_at) : Date.parse(thread.createdAt);
    return { id: thread.id, thread, lastMsg, sortTime };
  });
  items.sort((a, b) => {
    const aPinned = pinnedSet.has(a.id) ? 1 : 0;
    const bPinned = pinnedSet.has(b.id) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return (b.sortTime || 0) - (a.sortTime || 0);
  });

  for (const entry of items) {
    const pinned = pinnedSet.has(entry.id);
    const item = document.createElement("div");
    item.className = pinned ? "chat-list-item pinned" : "chat-list-item";

    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "chat-list-item-main";

    const { lastMsg } = entry;
    const avatar = document.createElement("div");
    avatar.className = "chat-list-avatar";
    avatar.innerHTML = lastMsg ? ICON_CHAT : ICON_SPARK;

    const main = document.createElement("div");
    main.className = "chat-list-main";

    const top = document.createElement("div");
    top.className = "chat-list-top";
    const labelWrap = document.createElement("span");
    labelWrap.className = "chat-list-label-wrap";
    const dateLabel = document.createElement("span");
    dateLabel.className = "chat-list-date";
    const timeLabel = document.createElement("span");
    timeLabel.className = "chat-list-time";

    const bottom = document.createElement("div");
    bottom.className = "chat-list-bottom";
    const preview = document.createElement("span");
    preview.className = "chat-list-preview";

    const defaultLabel = t(state.lang, "freeform_chat_title");
    const timeSource = lastMsg?.created_at || entry.thread.createdAt;
    timeLabel.textContent = timeSource ? formatBubbleTime(timeSource) : "";

    let previewText;
    if (lastMsg) {
      const prefix = lastMsg.role === "assistant" ? "" : `${t(state.lang, "chat_you_prefix")} `;
      previewText = truncate(`${prefix}${lastMsg.content}`);
    } else {
      previewText = t(state.lang, "freeform_chat_preview");
    }

    state.listIndex.set(entry.id, { defaultLabel });
    const labelText = getCustomTitle(entry.id) || defaultLabel;

    if (pinned) {
      const pinIcon = document.createElement("span");
      pinIcon.className = "chat-list-pin-icon";
      pinIcon.innerHTML = ICON_PIN_FILLED;
      labelWrap.appendChild(pinIcon);
    }
    dateLabel.textContent = labelText;
    labelWrap.appendChild(dateLabel);
    top.appendChild(labelWrap);
    top.appendChild(timeLabel);
    preview.textContent = previewText;
    bottom.appendChild(preview);

    main.appendChild(top);
    main.appendChild(bottom);
    mainBtn.appendChild(avatar);
    mainBtn.appendChild(main);
    mainBtn.addEventListener("click", () => openDetail(entry.id));

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "chat-list-menu-btn";
    menuBtn.innerHTML = ICON_DOTS;
    menuBtn.setAttribute("aria-label", t(state.lang, "chat_options_menu"));
    menuBtn.title = t(state.lang, "chat_options_menu");
    menuBtn.addEventListener("click", () => openChatOptions(entry.id));

    item.appendChild(mainBtn);
    item.appendChild(menuBtn);
    item.dataset.search = `${labelText} ${previewText}`.toLowerCase();
    els.chatList.appendChild(item);
  }

  applyChatListFilter();
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
    p.textContent = t(state.lang, "chat_empty_freeform");
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

  els.detailDateTitle.textContent = getDisplayLabel(date);

  if (state.chatCode) {
    await loadChatForDate(date);
  } else {
    els.chatThread.innerHTML = "";
  }

  // Terlepas dari diskusi terkunci/terbuka -- begitu layar detail dibuka,
  // langsung terscroll ke paling bawah (pesan terbaru).
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

function openDialogEl(dialogEl) {
  if (typeof dialogEl.showModal === "function") {
    dialogEl.showModal();
  } else {
    dialogEl.setAttribute("open", "");
  }
}

function closeDialogEl(dialogEl) {
  if (typeof dialogEl.close === "function") {
    dialogEl.close();
  } else {
    dialogEl.removeAttribute("open");
  }
}

// Tempel pesan error asli dari server (kalau ada) di belakang teks generik --
// supaya begitu ada kegagalan, langsung kelihatan di layar APA sebenarnya
// yang salah (mis. "Unauthorized", "HTTP 500", "Failed to fetch") tanpa
// harus buka DevTools/Network tab (susah dilakukan dari HP).
function alertWithDetail(messageKey, result) {
  const detail = result && typeof result.message === "string" ? result.message.trim() : "";
  const base = t(state.lang, messageKey);
  window.alert(detail ? `${base}\n\n(${detail})` : base);
}

function formatFullDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const locale = state.lang === "id" ? "id-ID" : "en-US";
  return d.toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Detail/PDF/Hapus butuh data dari server (riwayat diskusi), jadi ketiganya
// butuh kode akses -- beda dari Sematkan/Ubah judul yang murni lokal. Kalau
// belum ada kode tersimpan, tutup menu titik-3 dan buka ulang dialog kode
// akses yang sudah ada (dipakai juga oleh tombol "Buka Diskusi"), dengan
// pesan kontekstual kenapa diminta.
function requireChatCodeOrPrompt(messageKey) {
  if (state.chatCode) return true;
  closeChatOptions();
  openChatCodeDialog();
  els.chatCodeError.hidden = false;
  els.chatCodeError.textContent = t(state.lang, messageKey);
  return false;
}

function openChatOptions(id) {
  state.activeOptionsId = id;
  const info = state.listIndex.get(id) || { defaultLabel: getDefaultLabel(id) };
  els.chatOptionsTitle.textContent = getCustomTitle(id) || info.defaultLabel;

  const pinned = isPinned(id);
  els.chatOptionsPinIcon.innerHTML = pinned ? ICON_PIN_FILLED : ICON_PIN;
  els.chatOptionsPinLabel.textContent = t(state.lang, pinned ? "chat_options_unpin" : "chat_options_pin");

  openDialogEl(els.chatOptionsDialog);
}

function closeChatOptions() {
  closeDialogEl(els.chatOptionsDialog);
}

// Dipakai pin/rename/hapus: beri tahu detail layar yang lagi dibuka (kalau
// ada) supaya judulnya ikut update, dan segarkan daftar HANYA kalau layar
// daftar yang sedang kelihatan (hindari fetch "last_messages" ke server
// sia-sia waktu user lagi ada di layar chat).
async function refreshAfterChatMutation(id, { titleChanged = false } = {}) {
  if (titleChanged && !els.screenDetail.hidden && state.currentDate === id) {
    els.detailDateTitle.textContent = getDisplayLabel(id);
  }
  if (!els.screenList.hidden) {
    await renderChatList();
  }
}

async function exportChatToPdf(id) {
  // Keterbatasan WebKit yang sudah lama dikenal & tidak bisa diperbaiki dari
  // sisi web app: window.print() TIDAK memunculkan apa-apa sama sekali kalau
  // situsnya dibuka sebagai app yang di-"Add to Home Screen" (standalone),
  // karena di mode itu tidak ada UI Safari yang bisa menampilkan dialog
  // cetak. Harus dibuka lewat tab Safari biasa (ada address bar-nya) supaya
  // tombol ini bisa memunculkan popup cetak/PDF.
  if (isIOS() && isStandalone()) {
    window.alert(t(state.lang, "pdf_ios_standalone"));
    return;
  }

  const title = getCustomTitle(id) || getDefaultLabel(id);

  const result = await fetchChatHistory(id, state.chatCode);
  if (!result.ok) {
    if (result.unauthorized) {
      state.chatCode = "";
      clearStoredChatCode();
    }
    alertWithDetail("chat_load_error", result);
    return;
  }
  const messages = result.messages || [];

  if (messages.length === 0) {
    window.alert(t(state.lang, "pdf_empty"));
    return;
  }

  const locale = state.lang === "id" ? "id-ID" : "en-US";
  const printedAt = new Date().toLocaleString(locale, { dateStyle: "long", timeStyle: "short" });

  els.printArea.innerHTML = "";

  const titleEl = document.createElement("h1");
  titleEl.className = "print-title";
  titleEl.textContent = title;
  els.printArea.appendChild(titleEl);

  const metaEl = document.createElement("p");
  metaEl.className = "print-meta";
  metaEl.textContent = `${messages.length} ${t(state.lang, "detail_messages_unit")} • ${printedAt}`;
  els.printArea.appendChild(metaEl);

  for (const msg of messages) {
    const msgEl = document.createElement("div");
    msgEl.className = "print-message";

    const head = document.createElement("div");
    head.className = "print-message-head";
    const who = msg.role === "assistant" ? t(state.lang, "pdf_ai_prefix") : t(state.lang, "pdf_you_prefix");
    head.textContent = `${who} • ${formatFullDateTime(msg.created_at)}`;
    msgEl.appendChild(head);

    const body = document.createElement("div");
    body.innerHTML = renderChatMarkdown(msg.content);
    msgEl.appendChild(body);

    els.printArea.appendChild(msgEl);
  }

  // Baru panggil print() 2 frame kemudian -- kasih waktu DOM yang baru
  // diisi kebentuk layout dulu sebelum browser menyiapkan halaman cetaknya.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}

function wireEvents() {
  els.langToggle.addEventListener("click", () => {
    state.lang = state.lang === "id" ? "en" : "id";
    localStorage.setItem("rh_lang", state.lang);
    applyLang();
    handleRoute();
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

    const date = state.currentDate || state.activeOptionsId;
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
    if (!text || !state.chatCode || !state.currentDate) return;

    els.chatInput.value = "";
    els.chatInput.style.height = "auto";
    els.chatSendBtn.disabled = true;
    appendChatBubble("user", text, new Date());
    setChatStatus(t(state.lang, "chat_sending"));

    const date = state.currentDate;
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

  // ---------- Menu titik-3 per-chat: sematkan / ubah judul / PDF / detail / hapus ----------

  // Ikon-ikon ini statis (tidak tergantung status chat tertentu), cukup
  // dipasang sekali -- cuma ikon pin yang berubah tiap kali menu dibuka
  // (lihat openChatOptions).
  els.chatOptionsRenameIcon.innerHTML = ICON_EDIT;
  els.chatOptionsPdfIcon.innerHTML = ICON_DOWNLOAD;
  els.chatOptionsDetailIcon.innerHTML = ICON_INFO;
  els.chatOptionsDeleteIcon.innerHTML = ICON_TRASH;

  els.chatOptionsCancel.addEventListener("click", () => closeChatOptions());

  // Tap area gelap di luar kartu sheet-nya buat nutup -- dialog bawaan
  // browser tidak otomatis begitu, perlu dicek manual apa targetnya persis
  // elemen <dialog>-nya sendiri (bukan konten .sheet-card di dalamnya).
  els.chatOptionsDialog.addEventListener("click", (e) => {
    if (e.target === els.chatOptionsDialog) closeChatOptions();
  });

  els.chatOptionsPinBtn.addEventListener("click", async () => {
    const id = state.activeOptionsId;
    if (!id) return;
    togglePinned(id);
    closeChatOptions();
    await refreshAfterChatMutation(id);
  });

  els.chatOptionsRenameBtn.addEventListener("click", () => {
    const id = state.activeOptionsId;
    if (!id) return;
    closeChatOptions();
    const defaultLabel = state.listIndex.get(id)?.defaultLabel || getDefaultLabel(id);
    els.renameInput.value = getCustomTitle(id);
    els.renameInput.placeholder = defaultLabel;
    openDialogEl(els.renameDialog);
    els.renameInput.focus();
  });

  els.renameCancel.addEventListener("click", () => closeDialogEl(els.renameDialog));

  els.renameForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = state.activeOptionsId;
    closeDialogEl(els.renameDialog);
    if (!id) return;
    setCustomTitle(id, els.renameInput.value);
    await refreshAfterChatMutation(id, { titleChanged: true });
  });

  els.chatOptionsPdfBtn.addEventListener("click", async () => {
    const id = state.activeOptionsId;
    if (!id) return;
    if (!requireChatCodeOrPrompt("need_code_pdf")) return;
    closeChatOptions();
    await exportChatToPdf(id);
  });

  els.chatOptionsDetailBtn.addEventListener("click", async () => {
    const id = state.activeOptionsId;
    if (!id) return;
    if (!requireChatCodeOrPrompt("need_code_detail")) return;
    closeChatOptions();

    const defaultLabel = state.listIndex.get(id)?.defaultLabel || getDefaultLabel(id);
    els.chatDetailTitle.textContent = getCustomTitle(id) || defaultLabel;
    els.chatDetailStats.hidden = false;
    els.chatDetailEmpty.hidden = true;
    els.chatDetailTotal.textContent = "…";
    els.chatDetailStart.textContent = "…";
    els.chatDetailLast.textContent = "…";
    openDialogEl(els.chatDetailDialog);

    const result = await fetchChatHistory(id, state.chatCode);
    if (!result.ok) {
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
      }
      closeDialogEl(els.chatDetailDialog);
      alertWithDetail("detail_load_error", result);
      return;
    }

    const messages = result.messages || [];
    if (messages.length === 0) {
      els.chatDetailStats.hidden = true;
      els.chatDetailEmpty.hidden = false;
      return;
    }
    els.chatDetailTotal.textContent = `${messages.length} ${t(state.lang, "detail_messages_unit")}`;
    els.chatDetailStart.textContent = formatFullDateTime(messages[0].created_at);
    els.chatDetailLast.textContent = formatFullDateTime(messages[messages.length - 1].created_at);
  });

  els.chatDetailClose.addEventListener("click", () => closeDialogEl(els.chatDetailDialog));

  els.chatOptionsDeleteBtn.addEventListener("click", async () => {
    const id = state.activeOptionsId;
    if (!id) return;
    if (!requireChatCodeOrPrompt("need_code_delete")) return;
    closeChatOptions();

    if (!window.confirm(t(state.lang, "delete_confirm"))) return;

    const result = await deleteChatThread(id, state.chatCode);
    if (!result.ok) {
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
      }
      alertWithDetail("delete_error", result);
      return;
    }

    // Chat-nya sudah tidak ada lagi -- lepas sematan, judul custom, dan
    // hapus dari daftar obrolan lokal.
    unpinChat(id);
    clearChatTitle(id);
    removeFreeformThread(id);

    if (!els.screenDetail.hidden && state.currentDate === id) {
      // Lagi buka chat yang baru dihapus -- keluar duluan baru balik ke daftar.
      openList();
    } else if (!els.screenList.hidden) {
      await renderChatList();
    }
  });
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
  await initChat();
  handleRoute();
}

main();