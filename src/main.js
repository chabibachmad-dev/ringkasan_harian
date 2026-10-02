import { jsPDF } from "jspdf";
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
  ICON_TRASH,
  ICON_SEARCH,
  ICON_CHEVRON_UP,
  ICON_CHEVRON_DOWN,
  ICON_X,
  ICON_SETTINGS,
  ICON_UPLOAD,
  ICON_KEY,
  ICON_LOGOUT,
  ICON_COPY,
  ICON_DOTS_SMALL,
  ICON_DOC
} from "./icons.js";
import { registerServiceWorker } from "./push.js";
import {
  getStoredChatCode,
  setStoredChatCode,
  clearStoredChatCode,
  fetchChatHistory,
  sendChatMessage,
  fetchLastMessages,
  listChatThreads,
  setThreadMeta,
  deleteChatThread,
  deleteChatMessage,
  fetchTokenUsageToday,
  listKnowledgeDocs,
  uploadKnowledgeDoc,
  deleteKnowledgeDoc
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
  chatOptionsKbBtn: document.getElementById("chat-options-kb"),
  chatOptionsKbIcon: document.getElementById("chat-options-kb-icon"),
  chatOptionsKbLabel: document.getElementById("chat-options-kb-label"),
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
  chatSearchToggle: document.getElementById("chat-search-toggle"),
  chatSearchToggleIcon: document.getElementById("chat-search-toggle-icon"),
  chatSearchBar: document.getElementById("chat-search-bar"),
  chatInSearchInput: document.getElementById("chat-in-search-input"),
  chatSearchCount: document.getElementById("chat-search-count"),
  chatSearchPrev: document.getElementById("chat-search-prev"),
  chatSearchPrevIcon: document.getElementById("chat-search-prev-icon"),
  chatSearchNext: document.getElementById("chat-search-next"),
  chatSearchNextIcon: document.getElementById("chat-search-next-icon"),
  chatSearchClose: document.getElementById("chat-search-close"),
  chatSearchCloseIcon: document.getElementById("chat-search-close-icon"),
  settingsToggle: document.getElementById("settings-toggle"),
  settingsToggleIcon: document.getElementById("settings-toggle-icon"),
  settingsDialog: document.getElementById("settings-dialog"),
  settingsKbBtn: document.getElementById("settings-kb-btn"),
  settingsKbIcon: document.getElementById("settings-kb-icon"),
  settingsChangeCodeBtn: document.getElementById("settings-change-code-btn"),
  settingsChangeCodeIcon: document.getElementById("settings-change-code-icon"),
  settingsLogoutBtn: document.getElementById("settings-logout-btn"),
  settingsLogoutIcon: document.getElementById("settings-logout-icon"),
  settingsAboutBtn: document.getElementById("settings-about-btn"),
  settingsAboutIcon: document.getElementById("settings-about-icon"),
  settingsCancelBtn: document.getElementById("settings-cancel-btn"),
  kbDialog: document.getElementById("kb-dialog"),
  kbUploadForm: document.getElementById("kb-upload-form"),
  kbTitleInput: document.getElementById("kb-title-input"),
  kbFileInput: document.getElementById("kb-file-input"),
  kbUploadBtn: document.getElementById("kb-upload-btn"),
  kbUploadStatus: document.getElementById("kb-upload-status"),
  kbDocList: document.getElementById("kb-doc-list"),
  kbDocListEmpty: document.getElementById("kb-doc-list-empty"),
  kbCloseBtn: document.getElementById("kb-close-btn"),
  aboutDialog: document.getElementById("about-dialog"),
  aboutChatsCount: document.getElementById("about-chats-count"),
  aboutKbCount: document.getElementById("about-kb-count"),
  aboutCodeStatus: document.getElementById("about-code-status"),
  aboutCloseBtn: document.getElementById("about-close-btn"),
  tokenUsageNote: document.getElementById("token-usage-note"),
  messageOptionsDialog: document.getElementById("message-options-dialog"),
  messageOptionsCopyBtn: document.getElementById("message-options-copy"),
  messageOptionsCopyIcon: document.getElementById("message-options-copy-icon"),
  messageOptionsDeleteBtn: document.getElementById("message-options-delete"),
  messageOptionsDeleteIcon: document.getElementById("message-options-delete-icon"),
  messageOptionsCancel: document.getElementById("message-options-cancel")
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
  // id obrolan -> boolean, status toggle "Pakai Dokumen Pengetahuan" --
  // diisi dari server (chat_thread_meta.use_kb) tiap kali renderChatList()
  // jalan, dipakai menu titik-3 (lihat openChatOptions). Default (belum ada
  // entry) dianggap false/OFF -- sengaja opt-in, lihat migrations/0010.
  threadUseKb: new Map(),
  activeOptionsId: null,
  // Hasil pencarian teks DI DALAM satu obrolan yang sedang dibuka (beda dari
  // chatSearchInput di layar daftar, yang cuma menyaring judul/preview).
  // inChatSearchMatches isinya elemen <mark> hasil highlight di DOM, jadi
  // navigasi next/prev tinggal scrollIntoView ke elemen yang bersangkutan.
  inChatSearchMatches: [],
  inChatSearchActive: -1,
  // Pesan (bubble) yang lagi dibuka menu titik-3-nya -- diisi waktu
  // openMessageOptions() dipanggil, dipakai sama tombol Salin/Hapus di
  // dalam sheet-nya supaya tahu pesan mana yang dimaksud.
  activeMessageEl: null,
  activeMessageId: null,
  activeMessageRole: null,
  activeMessageContent: null
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

// Dipanggil waktu renderChatList() dapat data pin/judul dari SERVER (hasil
// listChatThreads -- lihat action "list_threads"/"set_thread_meta" di
// chat.js & Edge Function-nya). Server sekarang jadi sumber kebenaran untuk
// pin & judul custom begitu ada kode akses, supaya perubahan yang dilakukan
// dari PERANGKAT LAIN (pin/unpin, ubah judul) ikut kebawa ke sini juga --
// sebelumnya dua-duanya cuma tersimpan di localStorage per perangkat jadi
// tidak pernah sinkron sama sekali.
function applyThreadMetaFromServer(id, pinned, title, useKb) {
  state.threadUseKb.set(id, !!useKb);

  if (isPinned(id) !== !!pinned) {
    const set = getPinnedChats();
    if (pinned) {
      set.add(id);
    } else {
      set.delete(id);
    }
    try {
      localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify([...set]));
    } catch (_err) {
      /* noop */
    }
  }

  const nextTitle = title || "";
  if (getCustomTitle(id) !== nextTitle) {
    setCustomTitle(id, nextTitle);
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
        applyThreadMetaFromServer(th.id, th.pinned, th.title, th.useKb);
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

// ---------- Cari teks di dalam satu obrolan (topbar layar detail) ----------

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Highlight dikerjakan lewat TreeWalker di atas text node ASLI (bukan
// regex di atas string HTML) -- supaya tag hasil renderChatMarkdown
// (mis. <strong>, <a>) tidak ikut kesentuh/rusak oleh proses pencarian.
function highlightTextNode(node, regex) {
  const text = node.nodeValue;
  regex.lastIndex = 0;
  if (!regex.test(text)) return [];
  regex.lastIndex = 0;

  const frag = document.createDocumentFragment();
  const marks = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const mark = document.createElement("mark");
    mark.className = "chat-search-hit";
    mark.textContent = match[0];
    frag.appendChild(mark);
    marks.push(mark);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  node.parentNode.replaceChild(frag, node);
  return marks;
}

function clearChatSearchHighlights() {
  els.chatThread.querySelectorAll("mark.chat-search-hit").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

function updateInChatSearchCount(hasQuery) {
  if (!hasQuery) {
    els.chatSearchCount.textContent = "";
    return;
  }
  const total = state.inChatSearchMatches.length;
  els.chatSearchCount.textContent = total > 0 ? `${state.inChatSearchActive + 1}/${total}` : "0/0";
}

function focusInChatSearchMatch() {
  state.inChatSearchMatches.forEach((m) => m.classList.remove("chat-search-hit--active"));
  const active = state.inChatSearchMatches[state.inChatSearchActive];
  if (!active) return;
  active.classList.add("chat-search-hit--active");
  active.scrollIntoView({ behavior: "smooth", block: "center" });
}

function applyInChatSearch(query) {
  clearChatSearchHighlights();
  state.inChatSearchMatches = [];
  state.inChatSearchActive = -1;

  const trimmed = (query || "").trim();
  if (!trimmed) {
    updateInChatSearchCount(false);
    return;
  }

  const regex = new RegExp(escapeRegExp(trimmed), "gi");
  const marks = [];
  els.chatThread.querySelectorAll(".chat-bubble-text").forEach((textEl) => {
    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
      marks.push(...highlightTextNode(node, regex));
    }
  });

  state.inChatSearchMatches = marks;
  if (marks.length > 0) {
    state.inChatSearchActive = 0;
    focusInChatSearchMatch();
  }
  updateInChatSearchCount(true);
}

function goToInChatSearchMatch(direction) {
  const total = state.inChatSearchMatches.length;
  if (total === 0) return;
  state.inChatSearchActive = (state.inChatSearchActive + direction + total) % total;
  focusInChatSearchMatch();
  updateInChatSearchCount(true);
}

// Dipanggil tiap kali layar detail dibuka/ditutup, dan tiap ganti obrolan --
// highlight & state pencarian sebelumnya tidak relevan lagi buat obrolan
// yang baru dibuka (bubble-bubble-nya memang dirender ulang dari nol).
function resetInChatSearch() {
  clearChatSearchHighlights();
  els.chatSearchBar.hidden = true;
  els.chatInSearchInput.value = "";
  state.inChatSearchMatches = [];
  state.inChatSearchActive = -1;
  if (els.chatSearchCount) els.chatSearchCount.textContent = "";
}

// id boleh kosong/undefined (mis. bubble user yang baru saja dikirim, SEBELUM
// server sempat balas dengan userMessageId -- lihat chatForm submit handler)
// -- selama belum ada id, menu titik-3 tetap bisa dibuka buat "Salin", tapi
// "Hapus pesan" belum bisa dipakai (server butuh id). Begitu id-nya datang,
// dipasang belakangan lewat bubble.dataset.id = ... (lihat submit handler).
// tokensUsed/costUsd opsional -- cuma ada kalau giliran kirim pesan ini
// sudah mencatat angkanya (lihat Edge Function action "send"). Pesan LAMA
// (sebelum fitur token/biaya ini ada) tidak punya angka ini sama sekali,
// jadi parameternya dibiarkan undefined -- lihat setBubbleUsage().
function appendChatBubble(role, content, timestamp, id, tokensUsed, costUsd) {
  const emptyEl = els.chatThread.querySelector(".chat-empty-text");
  if (emptyEl) emptyEl.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "assistant" ? "assistant" : "user"}`;
  bubble.dataset.role = role === "assistant" ? "assistant" : "user";
  if (id) bubble.dataset.id = id;
  // Konten ASLI (markdown mentah, sebelum dirender jadi HTML) disimpan di
  // properti elemen -- dipakai tombol "Salin pesan" supaya yang disalin ke
  // clipboard teks aslinya (bisa ada **bold**/link dll), bukan innerHTML
  // hasil renderChatMarkdown() yang sudah jadi tag HTML.
  bubble.rawContent = content;

  const textEl = document.createElement("div");
  textEl.className = "chat-bubble-text";
  textEl.innerHTML = renderChatMarkdown(content);
  bubble.appendChild(textEl);

  // Baris jam + estimasi token/biaya + tombol titik-3 (opsi: salin/hapus
  // pesan) duduk berdampingan di pojok kanan-bawah bubble -- lihat
  // .chat-bubble-meta di style.css.
  const meta = document.createElement("div");
  meta.className = "chat-bubble-meta";

  const timeEl = document.createElement("span");
  timeEl.className = "chat-bubble-time";
  timeEl.textContent = formatBubbleTime(timestamp || new Date());
  meta.appendChild(timeEl);

  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "chat-bubble-menu-btn";
  menuBtn.innerHTML = ICON_DOTS_SMALL;
  menuBtn.setAttribute("aria-label", t(state.lang, "chat_msg_options_menu"));
  menuBtn.title = t(state.lang, "chat_msg_options_menu");
  menuBtn.addEventListener("click", () => openMessageOptions(bubble));
  meta.appendChild(menuBtn);

  bubble.appendChild(meta);

  if (typeof tokensUsed === "number") {
    setBubbleUsage(bubble, tokensUsed, costUsd);
  }

  els.chatThread.appendChild(bubble);
  scrollChatToBottom();
  return bubble;
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
      const tokensUsed = typeof msg.tokens_used === "number" ? msg.tokens_used : undefined;
      const costUsd = typeof msg.cost_usd === "number" ? msg.cost_usd : undefined;
      appendChatBubble(msg.role, msg.content, msg.created_at, msg.id, tokensUsed, costUsd);
    }
  }
  scrollChatToBottom();
}

// ---------- Menu titik-3 PER-PESAN (di dalam satu obrolan): salin/hapus ----------
// Beda dari openChatOptions() di atas (itu menu titik-3 per-CHAT di layar
// daftar) -- ini untuk satu BUBBLE pesan di dalam obrolan yang sedang dibuka.

function openMessageOptions(bubbleEl) {
  state.activeMessageEl = bubbleEl;
  state.activeMessageId = bubbleEl.dataset.id || null;
  state.activeMessageRole = bubbleEl.dataset.role || "assistant";
  state.activeMessageContent = bubbleEl.rawContent || "";

  // "Hapus pesan" cuma relevan buat pesan dari pengguna sendiri -- balasan
  // AI cuma bisa disalin (server juga menolak hapus satuan untuk role
  // "assistant", lihat Edge Function action "delete_message").
  els.messageOptionsDeleteBtn.hidden = state.activeMessageRole !== "user";

  openDialogEl(els.messageOptionsDialog);
}

function closeMessageOptions() {
  closeDialogEl(els.messageOptionsDialog);
}

// Perkiraan token+biaya Gemini terpakai HARI INI (zona Pasifik, sama seperti
// jadwal reset kuota gratis -- lihat Edge Function action "token_usage"),
// ditampilkan sebagai baris kedua di footer layar daftar. Dipanggil tiap
// kali layar daftar dibuka (lihat showListScreen()) -- sengaja tidak
// menghalangi render daftar chat-nya sendiri (dipanggil tanpa await di
// sana), jadi kalau lambat/gagal, daftar chat tetap tampil normal.
async function renderTokenUsage() {
  if (!els.tokenUsageNote) return;
  if (!state.chatCode) {
    els.tokenUsageNote.hidden = true;
    return;
  }

  const result = await fetchTokenUsageToday(state.chatCode);
  if (!result.ok || typeof result.tokensUsedToday !== "number") {
    els.tokenUsageNote.hidden = true;
    return;
  }

  setTokenUsageText(result.tokensUsedToday, result.costUsedToday);
}

// Format "$ x,xx" (2 desimal, pemisah desimal ikut bahasa aktif -- koma
// untuk ID, titik untuk EN) -- dipakai footer (total harian) & bubble pesan
// (per giliran). costUsd kosong/bukan angka dianggap $0.
// 6 desimal -- sama persis dengan presisi yang disimpan di kolom database
// (`numeric(12,6)`, lihat migration 0009_token_cost_tracking.sql), jadi
// ini sudah paling detail yang bisa ditampilkan tanpa angka "halu" di
// belakang titik desimal.
function formatUsd(costUsd, locale) {
  const amount = typeof costUsd === "number" ? costUsd : 0;
  return `$ ${amount.toLocaleString(locale, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`;
}

// Dibuat SEPENDEK mungkin ("Token xxxx | $ x,xxxxxx", tanpa kalimat
// pembuka) -- versi sebelumnya yang lebih panjang suka kebungkus 2 baris di
// layar sempit dan ketiban tombol "+" (position: fixed) yang mengambang di
// pojok kanan-bawah. Baris pendek begini jauh lebih kecil kemungkinan
// wrap jadi 2 baris.
function setTokenUsageText(tokens, costUsedToday) {
  const locale = state.lang === "id" ? "id-ID" : "en-US";
  const formattedTokens = tokens.toLocaleString(locale);
  const formattedCost = formatUsd(costUsedToday, locale);
  els.tokenUsageNote.textContent = `${t(state.lang, "token_usage_today_prefix")} ${formattedTokens} | ${formattedCost}`;
  els.tokenUsageNote.hidden = false;
}

// "(token xxx | $ x,xxxxxx)" -- estimasi token+biaya SATU giliran
// percakapan (lihat komentar turnTokens/turnCostUsd di Edge Function action
// "send"). Dibuat 6 desimal (lihat formatUsd()) karena model Gemini Flash
// murah sekali -- pesan pendek biasanya cuma berbiaya sepersekian sen, jadi
// kalau dibulatkan ke 2 desimal saja hampir selalu tampil "$ 0,00".
function formatMessageUsage(tokensUsed, costUsd) {
  const locale = state.lang === "id" ? "id-ID" : "en-US";
  return `(token ${tokensUsed.toLocaleString(locale)} | ${formatUsd(costUsd, locale)})`;
}

// Pasang/perbarui span "(token xxx | $ x,xx)" di baris meta satu bubble --
// dipakai appendChatBubble() (pesan dari riwayat/baru dikirim) DAN langsung
// dipanggil lagi di chatForm submit handler begitu angkanya datang dari
// server (bubble pengguna sudah terlanjur tampil duluan sebelum tahu
// angkanya -- lihat komentar di appendChatBubble()).
function setBubbleUsage(bubbleEl, tokensUsed, costUsd) {
  if (typeof tokensUsed !== "number") return;
  const meta = bubbleEl.querySelector(".chat-bubble-meta");
  const timeEl = bubbleEl.querySelector(".chat-bubble-time");
  if (!meta || !timeEl) return;

  let usageEl = bubbleEl.querySelector(".chat-bubble-usage");
  if (!usageEl) {
    usageEl = document.createElement("span");
    usageEl.className = "chat-bubble-usage";
    // Selalu tepat SETELAH jam, SEBELUM tombol titik-3 -- insertBefore
    // dengan referenceNode timeEl.nextSibling aman dipanggil berkali-kali
    // (menu titik-3 selalu jadi anak terakhir meta).
    meta.insertBefore(usageEl, timeEl.nextSibling);
  }
  usageEl.textContent = formatMessageUsage(tokensUsed, costUsd);
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
  // Sengaja tanpa await -- ini cuma info tambahan di footer, tidak boleh
  // bikin daftar chat telat tampil kalau lambat/gagal.
  renderTokenUsage();
  await renderChatList();
}

async function showDetailScreen(date) {
  state.currentDate = date;
  els.screenList.hidden = true;
  els.screenDetail.hidden = false;
  resetInChatSearch();

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
// WAJIB ada kode akses -- kalau belum ada kode tersimpan, tutup menu titik-3
// dan buka ulang dialog kode akses yang sudah ada (dipakai juga oleh tombol
// "Buka Diskusi"), dengan pesan kontekstual kenapa diminta.
//
// Sematkan/Ubah judul BEDA: tetap langsung jalan di perangkat ini walau
// belum ada kode (supaya tetap bisa dipakai cuma buat rapi-rapi daftar
// lokal), tapi kalau kode-nya ADA, keduanya juga dikirim ke server (lihat
// setThreadMeta di chat.js) supaya ikut sinkron ke semua perangkat.
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

  const useKb = state.threadUseKb.get(id) || false;
  els.chatOptionsKbIcon.innerHTML = ICON_DOC;
  els.chatOptionsKbLabel.textContent = t(state.lang, useKb ? "chat_options_kb_off" : "chat_options_kb_on");
  els.chatOptionsKbBtn.classList.toggle("sheet-action--active", useKb);

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

// Hapus semua syntax markdown yang jadi "kotor" kalau ditulis apa adanya
// sebagai teks biasa di PDF (bold/italic/heading/kode/kutipan/link) --
// baris baru TETAP dipertahankan (beda dari versi preview satu-baris),
// supaya paragraf & daftar poin di PDF tidak nempel jadi satu blok teks.
function stripMarkdownForPdf(md) {
  if (!md) return "";
  return md
    .replace(/```([\s\S]*?)```/g, (_m, code) => code.trim())
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
    .replace(/^[-*]\s+/gm, "• ")
    .trim();
}

// Export PDF langsung jadi FILE (bukan lewat dialog cetak browser) --
// dirender sendiri pakai jsPDF, jadi hasilnya sama persis di semua
// perangkat/browser dan langsung ke-download tanpa popup apapun. Ini juga
// sekalian menghindari keterbatasan iOS lama: window.print() tidak bisa
// dipakai sama sekali kalau situsnya dibuka sebagai app yang di-"Add to
// Home Screen" (standalone) -- dengan generate PDF sendiri, batasan itu
// jadi tidak relevan lagi.
async function exportChatToPdf(id) {
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

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(lineHeight) {
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function writeLines(lines, lineHeight) {
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  writeLines(doc.splitTextToSize(title, maxWidth), 20);

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  writeLines(doc.splitTextToSize(`${messages.length} ${t(state.lang, "detail_messages_unit")} • ${printedAt}`, maxWidth), 13);
  doc.setTextColor(0);
  y += 10;

  for (const msg of messages) {
    const who = msg.role === "assistant" ? t(state.lang, "pdf_ai_prefix") : t(state.lang, "pdf_you_prefix");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    writeLines(doc.splitTextToSize(`${who} • ${formatFullDateTime(msg.created_at)}`, maxWidth), 13);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const plain = stripMarkdownForPdf(msg.content);
    for (const paragraph of plain.split(/\n+/)) {
      if (!paragraph.trim()) continue;
      writeLines(doc.splitTextToSize(paragraph, maxWidth), 15);
    }
    y += 10;
  }

  const safeTitle = title.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "chat";
  doc.save(`${safeTitle}.pdf`);
}

// ---------- Pengaturan (tombol gear di layar daftar) ----------

function openSettingsDialog() {
  openDialogEl(els.settingsDialog);
}

function closeSettingsDialog() {
  closeDialogEl(els.settingsDialog);
}

// ---------- Dokumen Pengetahuan (Pengaturan > Dokumen Pengetahuan) ----------

async function openKbDialog() {
  closeSettingsDialog();
  els.kbTitleInput.value = "";
  els.kbFileInput.value = "";
  els.kbUploadStatus.hidden = true;
  openDialogEl(els.kbDialog);
  await renderKbDocList();
}

async function renderKbDocList() {
  els.kbDocList.innerHTML = "";

  if (!state.chatCode) {
    els.kbDocListEmpty.hidden = false;
    els.kbDocListEmpty.textContent = t(state.lang, "kb_need_code");
    return;
  }

  els.kbDocListEmpty.hidden = false;
  els.kbDocListEmpty.textContent = t(state.lang, "loading");

  const result = await listKnowledgeDocs(state.chatCode);
  if (!result.ok) {
    if (result.unauthorized) {
      state.chatCode = "";
      clearStoredChatCode();
    }
    els.kbDocListEmpty.textContent = t(state.lang, "kb_load_error");
    return;
  }

  const docs = result.documents || [];
  if (docs.length === 0) {
    els.kbDocListEmpty.hidden = false;
    els.kbDocListEmpty.textContent = t(state.lang, "kb_empty");
    return;
  }
  els.kbDocListEmpty.hidden = true;

  const locale = state.lang === "id" ? "id-ID" : "en-US";
  for (const doc of docs) {
    const row = document.createElement("div");
    row.className = "kb-doc-row";

    const main = document.createElement("div");
    main.className = "kb-doc-main";
    const titleEl = document.createElement("div");
    titleEl.className = "kb-doc-title";
    titleEl.textContent = doc.title;
    const meta = document.createElement("div");
    meta.className = "kb-doc-meta";
    const charCount = typeof doc.char_count === "number" ? doc.char_count : 0;
    meta.textContent = `${charCount.toLocaleString(locale)} ${t(state.lang, "kb_chars_unit")} • ${formatFullDateTime(doc.uploaded_at)}`;
    main.appendChild(titleEl);
    main.appendChild(meta);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn icon-btn--small";
    delBtn.innerHTML = ICON_TRASH;
    delBtn.title = t(state.lang, "kb_delete_btn");
    delBtn.setAttribute("aria-label", t(state.lang, "kb_delete_btn"));
    delBtn.addEventListener("click", async () => {
      if (!window.confirm(t(state.lang, "kb_delete_confirm"))) return;
      const delResult = await deleteKnowledgeDoc(state.chatCode, doc.id);
      if (!delResult.ok) {
        if (delResult.unauthorized) {
          state.chatCode = "";
          clearStoredChatCode();
        }
        alertWithDetail("kb_delete_error", delResult);
        return;
      }
      await renderKbDocList();
    });

    row.appendChild(main);
    row.appendChild(delBtn);
    els.kbDocList.appendChild(row);
  }
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

  els.settingsToggle.addEventListener("click", () => openSettingsDialog());

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

    // Validasi pakai listChatThreads (bukan fetchChatHistory ke satu ID
    // obrolan tertentu) -- supaya dialog ini generik dan bisa dipakai dari
    // KONTEKS MANAPUN: unlock diskusi di layar detail, menu titik-3
    // (PDF/detail/hapus), ATAU "Ubah kode chat" di Pengaturan (yang dipicu
    // dari layar daftar, tanpa ID obrolan spesifik sama sekali).
    const result = await listChatThreads(code);
    submitBtn.disabled = false;

    if (!result.ok) {
      els.chatCodeError.hidden = false;
      els.chatCodeError.textContent = result.unauthorized ? t(state.lang, "chat_code_wrong") : result.message;
      return;
    }

    state.chatCode = code;
    setStoredChatCode(code);
    els.chatCodeInput.value = "";
    closeChatCodeDialog();

    // PENTING: showChatUnlocked() dipanggil TANPA SYARAT (bukan cuma kalau
    // layar detail lagi kebuka) -- chat-form/chat-locked-bar adalah elemen
    // GLOBAL yang dipakai ulang di layar detail manapun, jadi begitu
    // state.chatCode valid (termasuk lewat "Ubah kode chat" di Pengaturan,
    // yang dipicu dari layar DAFTAR), status unlock-nya harus ikut
    // diperbarui supaya obrolan berikutnya yang dibuka langsung terbuka,
    // tidak kebawa status "terkunci" lama dari waktu app pertama dimuat.
    showChatUnlocked();

    if (!els.screenDetail.hidden && state.currentDate) {
      await loadChatForDate(state.currentDate);
    }
    if (!els.screenList.hidden) {
      await renderChatList();
    }
  });

  els.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text || !state.chatCode || !state.currentDate) return;

    els.chatInput.value = "";
    els.chatInput.style.height = "auto";
    els.chatSendBtn.disabled = true;
    // Bubble ditampilkan dulu (optimistic) SEBELUM id-nya diketahui -- id
    // asli baru datang lewat result.userMessageId di bawah, dipasang
    // belakangan supaya "Hapus pesan" langsung bisa dipakai tanpa reload.
    const userBubble = appendChatBubble("user", text, new Date());
    setChatStatus(t(state.lang, "chat_sending"));

    const date = state.currentDate;
    const result = await sendChatMessage(date, state.chatCode, text);

    els.chatSendBtn.disabled = false;
    setChatStatus("");

    if (result.userMessageId) {
      userBubble.dataset.id = result.userMessageId;
    }
    // turnTokens/turnCostUsd sama buat bubble pengguna & balasan AI dari
    // giliran yang sama (lihat komentar di Edge Function action "send") --
    // bubble pengguna di atas sudah terlanjur tampil SEBELUM angka ini
    // diketahui, jadi dipasang belakangan lewat setBubbleUsage().
    if (typeof result.turnTokens === "number") {
      setBubbleUsage(userBubble, result.turnTokens, result.turnCostUsd);
    }
    if (typeof result.tokensUsedToday === "number") {
      setTokenUsageText(result.tokensUsedToday, result.costUsedToday);
    }

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

    appendChatBubble("assistant", result.reply, new Date(), result.assistantMessageId, result.turnTokens, result.turnCostUsd);

    // Kalau pencarian lagi aktif waktu pesan baru masuk, ikut re-scan supaya
    // pesan baru ini juga ketemu kalau cocok dengan kata kuncinya.
    if (!els.chatSearchBar.hidden && els.chatInSearchInput.value.trim()) {
      applyInChatSearch(els.chatInSearchInput.value);
    }
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

  // ---------- Cari teks di dalam obrolan yang sedang dibuka ----------

  els.chatSearchToggleIcon.innerHTML = ICON_SEARCH;
  els.chatSearchPrevIcon.innerHTML = ICON_CHEVRON_UP;
  els.chatSearchNextIcon.innerHTML = ICON_CHEVRON_DOWN;
  els.chatSearchCloseIcon.innerHTML = ICON_X;

  els.chatSearchToggle.addEventListener("click", () => {
    const willShow = els.chatSearchBar.hidden;
    if (willShow) {
      els.chatSearchBar.hidden = false;
      els.chatInSearchInput.focus();
    } else {
      resetInChatSearch();
    }
  });

  els.chatSearchClose.addEventListener("click", () => resetInChatSearch());

  let inChatSearchDebounce;
  els.chatInSearchInput.addEventListener("input", () => {
    clearTimeout(inChatSearchDebounce);
    const value = els.chatInSearchInput.value;
    inChatSearchDebounce = setTimeout(() => applyInChatSearch(value), 150);
  });

  els.chatInSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goToInChatSearchMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      resetInChatSearch();
    }
  });

  els.chatSearchPrev.addEventListener("click", () => goToInChatSearchMatch(-1));
  els.chatSearchNext.addEventListener("click", () => goToInChatSearchMatch(1));

  // ---------- Menu titik-3 per-chat: sematkan / ubah judul / PDF / detail / hapus ----------

  // Ikon-ikon ini statis (tidak tergantung status chat tertentu), cukup
  // dipasang sekali -- cuma ikon pin yang berubah tiap kali menu dibuka
  // (lihat openChatOptions).
  els.chatOptionsRenameIcon.innerHTML = ICON_EDIT;
  els.chatOptionsPdfIcon.innerHTML = ICON_DOWNLOAD;
  els.chatOptionsDetailIcon.innerHTML = ICON_INFO;
  els.chatOptionsDeleteIcon.innerHTML = ICON_TRASH;

  // Sama kayak di atas: ikon tombol Pengaturan & isi menunya statis, cukup
  // dipasang sekali.
  els.settingsToggleIcon.innerHTML = ICON_SETTINGS;
  els.settingsKbIcon.innerHTML = ICON_UPLOAD;
  els.settingsChangeCodeIcon.innerHTML = ICON_KEY;
  els.settingsLogoutIcon.innerHTML = ICON_LOGOUT;
  els.settingsAboutIcon.innerHTML = ICON_INFO;

  // ---------- Menu titik-3 PER-PESAN (di dalam obrolan): salin / hapus ----------

  els.messageOptionsCopyIcon.innerHTML = ICON_COPY;
  els.messageOptionsDeleteIcon.innerHTML = ICON_TRASH;

  els.messageOptionsCancel.addEventListener("click", () => closeMessageOptions());
  els.messageOptionsDialog.addEventListener("click", (e) => {
    if (e.target === els.messageOptionsDialog) closeMessageOptions();
  });

  els.messageOptionsCopyBtn.addEventListener("click", async () => {
    const text = state.activeMessageContent || "";
    closeMessageOptions();
    try {
      await navigator.clipboard.writeText(text);
    } catch (_err) {
      // Fallback langka (mis. Clipboard API diblokir) -- biar teksnya tetap
      // bisa disalin manual lewat dialog prompt bawaan browser.
      window.prompt(t(state.lang, "chat_msg_options_copy"), text);
      return;
    }
    setChatStatus(t(state.lang, "chat_msg_copied"));
    setTimeout(() => setChatStatus(""), 1500);
  });

  els.messageOptionsDeleteBtn.addEventListener("click", async () => {
    const id = state.activeMessageId;
    const bubbleEl = state.activeMessageEl;
    const date = state.currentDate;
    closeMessageOptions();
    if (!id || !date) return;
    if (!window.confirm(t(state.lang, "chat_msg_delete_confirm"))) return;

    const result = await deleteChatMessage(date, state.chatCode, id);
    if (!result.ok) {
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
        showChatLocked(t(state.lang, "chat_code_wrong"));
        return;
      }
      alertWithDetail("chat_msg_delete_error", result);
      return;
    }

    bubbleEl?.remove();
    if (!els.chatThread.querySelector(".chat-bubble")) {
      const p = document.createElement("p");
      p.className = "chat-empty-text";
      p.textContent = t(state.lang, "chat_empty_freeform");
      els.chatThread.appendChild(p);
    }
  });

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
    closeChatOptions();
    togglePinned(id);
    const nowPinned = isPinned(id);

    // PENTING: kirim ke server DULU, baru refresh daftar. Kalau urutannya
    // dibalik, refreshAfterChatMutation() di bawah bakal manggil
    // listChatThreads() yang ngambil status pin LAMA dari server (soalnya
    // belum sempat ditulis), terus applyThreadMetaFromServer() nimpa balik
    // perubahan lokal yang baru saja dibikin -- pin yang baru ditekan jadi
    // kebalik lagi ke kondisi semula sebelum sempat ke-kirim.
    if (state.chatCode) {
      const result = await setThreadMeta(id, state.chatCode, { pinned: nowPinned });
      if (!result.ok) {
        if (result.unauthorized) {
          state.chatCode = "";
          clearStoredChatCode();
        }
        alertWithDetail("pin_sync_error", result);
      }
    }

    await refreshAfterChatMutation(id);
  });

  // Toggle "Pakai Dokumen Pengetahuan" -- beda dari Sematkan/Ubah Judul,
  // status ini WAJIB tersimpan di server (bukan cuma localStorage) karena
  // langsung menentukan apa yang dikirim ke Gemini di Edge Function (lihat
  // chat/index.ts action "send"), jadi kalau belum ada kode akses, toggle
  // ini tidak bisa dipakai (beda dari pin/rename yang tetap jalan lokal
  // dulu tanpa kode).
  els.chatOptionsKbBtn.addEventListener("click", async () => {
    const id = state.activeOptionsId;
    if (!id) return;
    if (!requireChatCodeOrPrompt("need_code_kb_toggle")) return;
    closeChatOptions();

    const nextUseKb = !(state.threadUseKb.get(id) || false);
    // Optimistis dulu di lokal (konsisten sama pola pin), nanti ditimpa lagi
    // kalau ternyata gagal di server.
    state.threadUseKb.set(id, nextUseKb);

    const result = await setThreadMeta(id, state.chatCode, { useKb: nextUseKb });
    if (!result.ok) {
      state.threadUseKb.set(id, !nextUseKb);
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
      }
      alertWithDetail("kb_toggle_sync_error", result);
      return;
    }

    if (!els.screenList.hidden) {
      await renderChatList();
    }
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
    const nowTitle = getCustomTitle(id) || null;

    // PENTING: sama seperti pin, kirim ke server DULU baru refresh daftar --
    // kalau dibalik, refreshAfterChatMutation() di bawah bisa narik judul
    // LAMA dari server (belum sempat ditulis) dan nimpa balik judul baru
    // yang baru saja disimpan secara lokal.
    if (state.chatCode) {
      const result = await setThreadMeta(id, state.chatCode, { title: nowTitle });
      if (!result.ok) {
        if (result.unauthorized) {
          state.chatCode = "";
          clearStoredChatCode();
        }
        alertWithDetail("rename_sync_error", result);
      }
    }

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

  // ---------- Pengaturan: dokumen pengetahuan / ubah kode / keluar chat / detail aplikasi ----------

  els.settingsCancelBtn.addEventListener("click", () => closeSettingsDialog());

  // Sama kayak chat-options-dialog: tap area gelap di luar kartu buat nutup.
  els.settingsDialog.addEventListener("click", (e) => {
    if (e.target === els.settingsDialog) closeSettingsDialog();
  });

  els.settingsKbBtn.addEventListener("click", () => openKbDialog());

  els.settingsChangeCodeBtn.addEventListener("click", () => {
    closeSettingsDialog();
    openChatCodeDialog();
    // Dialog kode akses sama dipakai untuk unlock diskusi & menu titik-3
    // (lihat requireChatCodeOrPrompt) -- hint di bawah ini yang bikin
    // pemakaiannya kelihatan beda ("masukkan kode BARU", bukan "fitur ini
    // butuh kode").
    els.chatCodeError.hidden = false;
    els.chatCodeError.textContent = t(state.lang, "change_code_hint");
  });

  els.settingsLogoutBtn.addEventListener("click", async () => {
    closeSettingsDialog();
    if (!state.chatCode) return;
    if (!window.confirm(t(state.lang, "logout_confirm"))) return;

    state.chatCode = "";
    clearStoredChatCode();

    // Sama seperti showChatUnlocked() di chatCodeForm: chat-form/chat-locked-bar
    // itu elemen GLOBAL dipakai ulang di layar detail manapun, jadi
    // showChatLocked() dipanggil TANPA SYARAT supaya obrolan berikutnya yang
    // dibuka langsung kelihatan terkunci, bukan masih kebawa status
    // "terbuka" lama dari sebelum logout.
    showChatLocked();
    if (!els.screenList.hidden) {
      await renderChatList();
    }
  });

  els.settingsAboutBtn.addEventListener("click", () => {
    closeSettingsDialog();
    els.aboutChatsCount.textContent = String(getFreeformThreads().length);
    els.aboutCodeStatus.textContent = t(state.lang, state.chatCode ? "about_code_unlocked" : "about_code_locked");
    els.aboutKbCount.textContent = "…";
    openDialogEl(els.aboutDialog);

    if (state.chatCode) {
      listKnowledgeDocs(state.chatCode).then((result) => {
        els.aboutKbCount.textContent = result.ok ? String((result.documents || []).length) : "–";
      });
    } else {
      els.aboutKbCount.textContent = "–";
    }
  });

  els.aboutCloseBtn.addEventListener("click", () => closeDialogEl(els.aboutDialog));

  els.kbCloseBtn.addEventListener("click", () => closeDialogEl(els.kbDialog));

  els.kbDialog.addEventListener("click", (e) => {
    if (e.target === els.kbDialog) closeDialogEl(els.kbDialog);
  });

  els.kbUploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!state.chatCode) {
      els.kbUploadStatus.hidden = false;
      els.kbUploadStatus.textContent = t(state.lang, "kb_need_code");
      return;
    }

    const title = els.kbTitleInput.value.trim();
    const file = els.kbFileInput.files && els.kbFileInput.files[0];

    if (!title) {
      els.kbUploadStatus.hidden = false;
      els.kbUploadStatus.textContent = t(state.lang, "kb_title_required");
      return;
    }
    if (!file) {
      els.kbUploadStatus.hidden = false;
      els.kbUploadStatus.textContent = t(state.lang, "kb_file_required");
      return;
    }

    els.kbUploadBtn.disabled = true;
    els.kbUploadStatus.hidden = false;
    els.kbUploadStatus.textContent = t(state.lang, "kb_extracting");

    // Ekstrak teksnya DI BROWSER (lihat pdfText.js) -- Edge Function cuma
    // terima teks polos, tidak pernah lihat file PDF mentahnya sama sekali.
    // Di-import DINAMIS (bukan di atas bareng import lain) supaya library
    // pdfjs-dist yang lumayan besar itu CUMA diunduh begitu fitur ini benar-
    // benar dipakai, tidak ikut membengkakkan bundle utama yang dimuat tiap
    // kali app dibuka (termasuk cuma buat sekadar chat biasa).
    let extracted;
    try {
      const { extractPdfText } = await import("./pdfText.js");
      extracted = await extractPdfText(file);
    } catch (_err) {
      els.kbUploadBtn.disabled = false;
      els.kbUploadStatus.textContent = t(state.lang, "kb_extract_error");
      return;
    }

    if (!extracted.text || extracted.text.length < 20) {
      els.kbUploadBtn.disabled = false;
      els.kbUploadStatus.textContent = t(state.lang, "kb_extract_empty");
      return;
    }

    els.kbUploadStatus.textContent = t(state.lang, "kb_uploading");
    const result = await uploadKnowledgeDoc(state.chatCode, { title, content: extracted.text, filename: file.name });
    els.kbUploadBtn.disabled = false;

    if (!result.ok) {
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
      }
      els.kbUploadStatus.textContent = result.message
        ? `${t(state.lang, "kb_upload_error")} (${result.message})`
        : t(state.lang, "kb_upload_error");
      return;
    }

    els.kbUploadStatus.textContent = t(state.lang, "kb_upload_success");
    els.kbTitleInput.value = "";
    els.kbFileInput.value = "";
    await renderKbDocList();
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
