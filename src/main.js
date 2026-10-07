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
  ICON_BOOK_SMALL,
  ICON_BOOKMARK,
  ICON_BOOKMARK_FILLED,
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
  ICON_DOC,
  ICON_BELL_FILLED,
  ICON_BELL_OUTLINE,
  ICON_ZAP,
  ICON_GAUGE,
  ICON_PAPERCLIP,
  ICON_X_SMALL,
  ICON_PULSE,
  ICON_PRAYER,
  ICON_BOOK,
  ICON_LOCATE
} from "./icons.js";
import {
  initFeatures,
  showPrayerScreen,
  showQuranScreen,
  stopFeatures,
  hideFeatureScreens
} from "./features.js";
import { registerServiceWorker } from "./push.js";
import {
  getStoredChatCode,
  setStoredChatCode,
  clearStoredChatCode,
  fetchChatHistory,
  sendChatMessage,
  fetchAgentJob,
  fetchAgentStatus,
  fetchLastMessages,
  listChatThreads,
  setThreadMeta,
  deleteChatThread,
  deleteChatMessage,
  fetchTokenUsageToday,
  listKnowledgeDocs,
  uploadKnowledgeDoc,
  uploadKnowledgeFile,
  retryKnowledgeDoc,
  deleteKnowledgeDoc,
  fetchKeyStatus,
  addChatAttachment,
  deleteChatAttachment,
  fetchSystemStatus
} from "./chat.js";
import {
  listWaChats,
  fetchWaHistory,
  sendWaMessage,
  setWaAutoReply,
  listWaQuickReplies,
  saveWaQuickReply,
  deleteWaQuickReply
} from "./wa.js";

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
  screenHome: document.getElementById("screen-home"),
  screenList: document.getElementById("screen-list"),
  menuChatBtn: document.getElementById("menu-chat"),
  menuChatIcon: document.getElementById("menu-chat-icon"),
  chatsBackBtn: document.getElementById("chats-back-btn"),
  screenDetail: document.getElementById("screen-detail"),
  backBtn: document.getElementById("back-btn"),
  detailDateTitle: document.getElementById("detail-date-title"),
  detailKbBadge: document.getElementById("detail-kb-badge"),
  detailSavedBadge: document.getElementById("detail-saved-badge"),
  chatListRetentionNote: document.getElementById("chat-list-retention-note"),
  chatOptionsSaveBtn: document.getElementById("chat-options-save"),
  chatOptionsSaveIcon: document.getElementById("chat-options-save-icon"),
  chatOptionsSaveLabel: document.getElementById("chat-options-save-label"),
  // Layar fitur "WhatsApp di dalam aplikasi" -- lihat wa.js & wa-bot/.
  screenWaList: document.getElementById("screen-wa-list"),
  screenWaDetail: document.getElementById("screen-wa-detail"),
  waListBackBtn: document.getElementById("wa-list-back-btn"),
  waList: document.getElementById("wa-list"),
  waListStatus: document.getElementById("wa-list-status"),
  waDetailBackBtn: document.getElementById("wa-detail-back-btn"),
  waDetailTitle: document.getElementById("wa-detail-title"),
  waAutoReplyToggle: document.getElementById("wa-auto-reply-toggle"),
  waAutoReplyToggleIcon: document.getElementById("wa-auto-reply-toggle-icon"),
  waThread: document.getElementById("wa-thread"),
  waForm: document.getElementById("wa-form"),
  waInput: document.getElementById("wa-input"),
  waSendBtn: document.getElementById("wa-send-btn"),
  waStatus: document.getElementById("wa-status"),
  waNewChatFab: document.getElementById("wa-new-chat-fab"),
  waNewChatDialog: document.getElementById("wa-new-chat-dialog"),
  waNewChatForm: document.getElementById("wa-new-chat-form"),
  waNewChatPhone: document.getElementById("wa-new-chat-phone"),
  waNewChatMessage: document.getElementById("wa-new-chat-message"),
  waNewChatError: document.getElementById("wa-new-chat-error"),
  waNewChatCancel: document.getElementById("wa-new-chat-cancel"),
  menuWhatsappBtn: document.getElementById("menu-whatsapp"),
  menuWhatsappIcon: document.getElementById("menu-whatsapp-icon"),
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
  chatAgentBar: document.getElementById("chat-agent-bar"),
  chatAttachBtn: document.getElementById("chat-attach-btn"),
  chatAttachInput: document.getElementById("chat-attach-input"),
  chatAttachments: document.getElementById("chat-attachments"),
  sysStatus: document.getElementById("sys-status"),
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
  menuKbBtn: document.getElementById("menu-kb"),
  menuKbIcon: document.getElementById("menu-kb-icon"),
  settingsChangeCodeBtn: document.getElementById("settings-change-code-btn"),
  settingsChangeCodeIcon: document.getElementById("settings-change-code-icon"),
  settingsLogoutBtn: document.getElementById("settings-logout-btn"),
  settingsLogoutIcon: document.getElementById("settings-logout-icon"),
  menuAboutBtn: document.getElementById("menu-about"),
  menuPrayerBtn: document.getElementById("menu-prayer"),
  menuPrayerIcon: document.getElementById("menu-prayer-icon"),
  menuQuranBtn: document.getElementById("menu-quran"),
  menuQuranIcon: document.getElementById("menu-quran-icon"),
  menuAboutIcon: document.getElementById("menu-about-icon"),
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
  menuQrBtn: document.getElementById("menu-qr"),
  menuQrIcon: document.getElementById("menu-qr-icon"),
  menuKeysBtn: document.getElementById("menu-keys"),
  menuKeysIcon: document.getElementById("menu-keys-icon"),
  qrDialog: document.getElementById("qr-dialog"),
  qrForm: document.getElementById("qr-form"),
  qrTitleInput: document.getElementById("qr-title-input"),
  qrKeywordsInput: document.getElementById("qr-keywords-input"),
  qrReplyInput: document.getElementById("qr-reply-input"),
  qrSaveBtn: document.getElementById("qr-save-btn"),
  qrCancelEditBtn: document.getElementById("qr-cancel-edit-btn"),
  qrStatus: document.getElementById("qr-status"),
  qrList: document.getElementById("qr-list"),
  qrListEmpty: document.getElementById("qr-list-empty"),
  qrCloseBtn: document.getElementById("qr-close-btn"),
  keysDialog: document.getElementById("keys-dialog"),
  keysList: document.getElementById("keys-list"),
  keysStatus: document.getElementById("keys-status"),
  keysResetNote: document.getElementById("keys-reset-note"),
  keysRefreshBtn: document.getElementById("keys-refresh-btn"),
  keysCloseBtn: document.getElementById("keys-close-btn"),
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
  // id obrolan -> boolean, tanda "Saved" (chat_thread_meta.saved) -- obrolan bertanda ini tidak
  // ikut dihapus otomatis. threadLastAt: waktu pesan terakhir (ISO) dari server, dipakai
  // menghitung "Dihapus N hari lagi". retention: { days, activeSince } dari server (null = tidak aktif).
  threadSaved: new Map(),
  threadLastAt: new Map(),
  retention: null,
  // id obrolan -> "auto" | "gemini" | "ollama" -- agen AI pilihan tiap obrolan
  // (disimpan di server, chat_thread_meta.agent; default "auto").
  threadAgent: new Map(),
  // Job Ollama yang sedang ditunggu (id job) + status laptop (true/false/null=belum tahu).
  agentJobWaiting: null,
  // Lampiran file obrolan yang sedang dibuka: [{ id, name, charCount }] + penanda sedang unggah.
  threadAttachments: [],
  attachBusy: false,
  sysTimer: null,
  ollamaOnline: null,
  // Fitur WhatsApp (lihat wa.js, wa-bot/) -- jid obrolan WA yang lagi
  // dibuka di screen-wa-detail, & timer polling buat masing-masing layar
  // (null kalau layarnya lagi tidak kebuka, supaya tidak polling sia-sia
  // waktu user ada di layar lain).
  waCurrentJid: null,
  waListTimer: null,
  waDetailTimer: null,
  // jid -> nama kontak WA (diisi ulang tiap renderWaList() jalan, dipakai
  // formatWaJidLabel() buat judul layar detail). "Signature" di bawah ini
  // cuma dipakai buat DETEKSI PERUBAHAN waktu polling -- bukan ditampilkan,
  // supaya daftar/bubble tidak dirender ulang (dan bikin scroll "lompat")
  // kalau isinya memang belum berubah sejak tick sebelumnya.
  waNames: new Map(),
  waListSignature: null,
  waThreadSignature: null,
  // Status toggle auto-reply AI (tabel whatsapp_contacts) utk waCurrentJid
  // yang lagi dibuka -- null = belum diketahui/belum dimuat, dipakai
  // updateWaAutoReplyToggleUi() buat gambar ikon lonceng di header.
  waCurrentAutoReplyEnabled: null,
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
function applyThreadMetaFromServer(id, pinned, title, useKb, agent, saved, lastAt) {
  state.threadUseKb.set(id, !!useKb);
  state.threadSaved.set(id, !!saved);
  if (lastAt) state.threadLastAt.set(id, lastAt);
  if (agent === "auto" || agent === "gemini" || agent === "ollama") state.threadAgent.set(id, agent);

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

// Penanda kecil "Dokumen" untuk obrolan yang memakai Dokumen Pengetahuan,
// supaya kelihatan dari luar tanpa membuka menu titik-3.
function makeKbBadge() {
  const badge = document.createElement("span");
  badge.className = "chat-kb-badge";
  fillKbBadge(badge);
  return badge;
}

function fillKbBadge(badge) {
  badge.innerHTML = `${ICON_BOOK_SMALL}<span>${t(state.lang, "chat_kb_badge")}</span>`;
  badge.title = t(state.lang, "chat_kb_badge_title");
  badge.setAttribute("aria-label", t(state.lang, "chat_kb_badge_title"));
}

// Penanda "Saved": obrolan ini dikecualikan dari hapus otomatis.
function fillSavedBadge(badge) {
  badge.innerHTML = `${ICON_BOOKMARK_FILLED}<span>${t(state.lang, "chat_saved_badge")}</span>`;
  badge.title = t(state.lang, "chat_saved_badge_title");
  badge.setAttribute("aria-label", t(state.lang, "chat_saved_badge_title"));
}

function makeSavedBadge() {
  const badge = document.createElement("span");
  badge.className = "chat-saved-badge";
  fillSavedBadge(badge);
  return badge;
}

// Sisa hari sebelum obrolan dihapus otomatis; null = tidak akan dihapus (Saved / fitur belum aktif).
// Dihitung sama dengan purge_old_chats() di server: batas = max(pesan terakhir, saat aturan dipasang) + days.
function daysUntilAutoDelete(id) {
  const r = state.retention;
  if (!r || !(r.days > 0) || state.threadSaved.get(id)) return null;
  const last = Date.parse(state.threadLastAt.get(id) || "");
  const since = Date.parse(r.activeSince || "");
  const base = Math.max(Number.isFinite(last) ? last : 0, Number.isFinite(since) ? since : 0);
  if (!base) return null;
  const ms = base + r.days * 86400000 - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
}

function expireHintText(id) {
  const left = daysUntilAutoDelete(id);
  if (left === null || left > 3) return "";
  return left <= 0 ? t(state.lang, "chat_expire_today") : t(state.lang, "chat_expire_days").replace("{n}", String(left));
}

// Chip yang sama di header layar obrolan (hanya tampil bila obrolan aktif memakai dokumen).
function renderDetailKbBadge() {
  const saved = !!(state.currentDate && state.threadSaved.get(state.currentDate));
  els.detailSavedBadge.hidden = !saved;
  if (saved) fillSavedBadge(els.detailSavedBadge);
  const on = !!(state.currentDate && state.threadUseKb.get(state.currentDate));
  els.detailKbBadge.hidden = !on;
  if (on) fillKbBadge(els.detailKbBadge);
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
      const serverIds = new Set();
      for (const th of threadsResult.threads || []) {
        serverIds.add(th.id);
        mergeDiscoveredThread(th.id, th.createdAt);
        applyThreadMetaFromServer(th.id, th.pinned, th.title, th.useKb, th.agent, th.saved, th.lastAt);
      }
      state.retention = threadsResult.retention && threadsResult.retention.days > 0 ? threadsResult.retention : null;
      // Obrolan yang sudah dihapus otomatis di server dibuang juga dari daftar lokal perangkat ini
      // (obrolan lokal yang baru dibuat < 24 jam dan belum ada pesannya dibiarkan).
      if (state.retention) {
        const cutoff = Date.now() - 86400000;
        for (const th of getFreeformThreads()) {
          if (serverIds.has(th.id)) continue;
          if (Date.parse(th.createdAt) < cutoff) {
            unpinChat(th.id);
            clearChatTitle(th.id);
            removeFreeformThread(th.id);
          }
        }
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
    if (state.threadSaved.get(entry.id)) labelWrap.appendChild(makeSavedBadge());
    if (state.threadUseKb.get(entry.id)) labelWrap.appendChild(makeKbBadge());
    top.appendChild(labelWrap);
    top.appendChild(timeLabel);
    preview.textContent = previewText;
    bottom.appendChild(preview);
    const hint = expireHintText(entry.id);
    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "chat-expire-hint";
      hintEl.textContent = hint;
      bottom.appendChild(hintEl);
    }

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
    if (state.threadUseKb.get(entry.id)) item.dataset.kb = "1";
    if (state.threadSaved.get(entry.id)) item.dataset.saved = "1";
    els.chatList.appendChild(item);
  }

  if (state.retention) {
    els.chatListRetentionNote.textContent = t(state.lang, "chat_retention_note").replace("{n}", String(state.retention.days));
    els.chatListRetentionNote.hidden = false;
  } else {
    els.chatListRetentionNote.hidden = true;
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
function appendChatBubble(role, content, timestamp, id, tokensUsed, costUsd, agent) {
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

  // Label agen penjawab ("Gemini"/"Ollama") -- hanya untuk balasan AI yang
  // tercatat agennya (pesan lama tidak punya info ini, jadi tidak diberi label).
  if (role === "assistant" && (agent === "gemini" || agent === "ollama")) {
    const agentEl = document.createElement("span");
    agentEl.className = "chat-bubble-agent";
    agentEl.textContent = `· ${t(state.lang, agent === "ollama" ? "agent_ollama" : "agent_gemini")}`;
    agentEl.title = `${t(state.lang, "agent_answered_by")} ${t(state.lang, agent === "ollama" ? "agent_ollama" : "agent_gemini")}`;
    meta.appendChild(agentEl);
  }

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
      appendChatBubble(msg.role, msg.content, msg.created_at, msg.id, tokensUsed, costUsd, msg.agent);
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
  els.chatAgentBar.hidden = true;
  if (errorText) {
    els.chatCodeError.hidden = false;
    els.chatCodeError.textContent = errorText;
    openChatCodeDialog();
  }
}

function showChatUnlocked() {
  els.chatLockedBar.hidden = true;
  els.chatForm.hidden = false;
  els.chatAgentBar.hidden = false;
  renderAgentBar();
}

// ---------- Lampiran file di chat ----------
// Teks PDF/file teks diekstrak DI BROWSER lalu disimpan sebagai lampiran obrolan
// (maks 3, ikut terhapus bersama obrolan). Dibaca Gemini (Edge Function) maupun
// Ollama (bot) di setiap pesan obrolan ini sampai lampirannya dihapus.

const ATTACH_MAX_BYTES = 15 * 1024 * 1024;
const ATTACH_MAX_CHARS = 299000;
const ATTACH_MAX_COUNT = 3;

function formatCount(n) {
  return Number(n || 0).toLocaleString(state.lang === "id" ? "id-ID" : "en-US");
}

function renderAttachments() {
  const box = els.chatAttachments;
  box.innerHTML = "";
  const list = state.threadAttachments;
  box.hidden = list.length === 0;
  for (const a of list) {
    const chip = document.createElement("span");
    chip.className = "chat-attach-chip";
    chip.title = t(state.lang, "attach_chip_hint");
    const name = document.createElement("span");
    name.className = "chat-attach-chip-name";
    name.textContent = a.name;
    const size = document.createElement("small");
    size.textContent = `${formatCount(a.charCount)} ${t(state.lang, "attach_chars")}`;
    const del = document.createElement("button");
    del.type = "button";
    del.innerHTML = ICON_X_SMALL;
    del.title = t(state.lang, "attach_remove");
    del.setAttribute("aria-label", t(state.lang, "attach_remove"));
    del.addEventListener("click", () => removeAttachment(a.id));
    chip.append(name, size, del);
    box.appendChild(chip);
  }
}

async function removeAttachment(id) {
  const date = state.currentDate;
  if (!date || !state.chatCode) return;
  const prev = state.threadAttachments;
  state.threadAttachments = prev.filter((a) => a.id !== id);
  renderAttachments();
  const res = await deleteChatAttachment(state.chatCode, date, id);
  if (!res.ok && state.currentDate === date) {
    state.threadAttachments = prev; // gagal hapus di server: tampilkan lagi
    renderAttachments();
    setChatStatus(`${t(state.lang, "attach_failed")} ${res.message || ""}`.trim());
  }
}

async function extractFileText(file) {
  const name = file.name || "file";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
  const isText = /^text\//.test(file.type) || /\.(txt|md|csv|json|log)$/i.test(name);
  if (!isPdf && !isText) throw new Error(t(state.lang, "attach_unsupported"));
  if (file.size > ATTACH_MAX_BYTES) throw new Error(t(state.lang, "attach_too_big"));
  let text;
  if (isPdf) {
    const { extractPdfText } = await import("./pdfText.js");
    text = (await extractPdfText(file)).text;
  } else {
    text = (await file.text()).trim();
  }
  if (!text || !text.trim()) throw new Error(t(state.lang, "attach_empty"));
  return text.length > ATTACH_MAX_CHARS ? `${text.slice(0, ATTACH_MAX_CHARS)}\n\n[...dipotong, file terlalu panjang...]` : text;
}

async function handleAttachFile(file) {
  const date = state.currentDate;
  if (!file || !date || !state.chatCode || state.attachBusy) return;
  if (state.threadAttachments.length >= ATTACH_MAX_COUNT) {
    setChatStatus(t(state.lang, "attach_limit"));
    return;
  }
  state.attachBusy = true;
  els.chatAttachBtn.disabled = true;
  try {
    setChatStatus(t(state.lang, "attach_reading"));
    const content = await extractFileText(file);
    setChatStatus(t(state.lang, "attach_uploading"));
    const res = await addChatAttachment(state.chatCode, date, { name: file.name || "file", content });
    if (!res.ok) {
      dropChatCodeIfUnauthorized(res);
      throw new Error(res.message || "");
    }
    if (state.currentDate === date) {
      state.threadAttachments = [...state.threadAttachments, res.attachment];
      renderAttachments();
    }
    setChatStatus("");
  } catch (err) {
    setChatStatus(`${t(state.lang, "attach_failed")} ${err instanceof Error ? err.message : String(err)}`.trim());
  } finally {
    state.attachBusy = false;
    els.chatAttachBtn.disabled = false;
    els.chatAttachInput.value = "";
  }
}

// ---------- Pemilih agen AI (Auto / Gemini / Ollama) ----------
// Ollama = model lokal di laptop; Edge Function di cloud tak bisa
// menjangkaunya, jadi pesan diantrekan lewat tabel agent_jobs & dikerjakan bot
// di laptop (lihat wa-bot/app-agent.js). Klien menunggu lewat polling.

function currentAgent() {
  return (state.currentDate && state.threadAgent.get(state.currentDate)) || "auto";
}

function renderAgentBar() {
  const agent = currentAgent();
  for (const btn of els.chatAgentBar.querySelectorAll(".chat-agent-pill")) {
    const on = btn.dataset.agent === agent;
    btn.setAttribute("aria-checked", on ? "true" : "false");
    if (btn.dataset.agent === "ollama") {
      if (state.ollamaOnline === null) btn.removeAttribute("data-online");
      else btn.dataset.online = state.ollamaOnline ? "true" : "false";
      const hint = t(state.lang, "agent_ollama_hint");
      btn.title =
        state.ollamaOnline === null ? hint : `${hint} — ${t(state.lang, state.ollamaOnline ? "agent_ollama_online" : "agent_ollama_offline")}`;
    }
  }
}

async function refreshOllamaStatus() {
  if (!state.chatCode) return;
  const res = await fetchAgentStatus(state.chatCode);
  if (res.ok && res.ollama) {
    state.ollamaOnline = !!res.ollama.online;
    renderAgentBar();
  }
}

async function chooseAgent(agent) {
  const date = state.currentDate;
  if (!date || !state.chatCode) return;
  const prev = currentAgent();
  if (agent === prev) return;
  state.threadAgent.set(date, agent);
  renderAgentBar();
  const res = await setThreadMeta(date, state.chatCode, { agent });
  if (!res.ok) {
    // Gagal simpan di server: kembalikan pilihan supaya tampilan jujur.
    state.threadAgent.set(date, prev);
    renderAgentBar();
  }
  if (agent === "ollama") refreshOllamaStatus();
}

// Tunggu hasil job Ollama (polling). Berhenti kalau pengguna pindah layar/obrolan;
// jawabannya tetap tersimpan di server & muncul lagi saat obrolan dibuka
// (history mengembalikan pendingJob / balasan yang sudah selesai).
async function waitForAgentJob(date, jobId, { fallback = false } = {}) {
  if (state.agentJobWaiting === jobId) return;
  state.agentJobWaiting = jobId;
  els.chatSendBtn.disabled = true;
  const POLL_MS = 3000;
  const MAX_MS = 30 * 60_000;
  const t0 = Date.now();
  let lastProgress = "";
  try {
    while (Date.now() - t0 < MAX_MS) {
      if (state.currentDate !== date || els.screenDetail.hidden || state.agentJobWaiting !== jobId) return;
      const res = await fetchAgentJob(state.chatCode, jobId);
      if (state.currentDate !== date || els.screenDetail.hidden || state.agentJobWaiting !== jobId) return;
      if (res.ok && res.status === "done") {
        setChatStatus("");
        if (res.reply && !els.chatThread.querySelector(`[data-id="${res.assistantMessageId}"]`)) {
          appendChatBubble("assistant", res.reply, new Date(), res.assistantMessageId || undefined, undefined, undefined, "ollama");
        }
        if (!els.chatSearchBar.hidden && els.chatInSearchInput.value.trim()) applyInChatSearch(els.chatInSearchInput.value);
        return;
      }
      if (res.ok && res.status === "failed") {
        setChatStatus(`${t(state.lang, "agent_failed")} ${res.error || ""}`.trim());
        return;
      }
      if (!res.ok && res.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
        showChatLocked(t(state.lang, "chat_code_wrong"));
        return;
      }
      // pending/running (atau error jaringan sesaat): tampilkan progres & lanjut.
      if (res.ok && res.progress) lastProgress = res.progress;
      const base = t(state.lang, fallback ? "agent_fallback" : "agent_working");
      setChatStatus(lastProgress ? `${base} · ${lastProgress}` : base);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    setChatStatus(t(state.lang, "agent_timeout"));
  } finally {
    if (state.agentJobWaiting === jobId) state.agentJobWaiting = null;
    els.chatSendBtn.disabled = false;
  }
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
  if (result.agent === "auto" || result.agent === "gemini" || result.agent === "ollama") {
    state.threadAgent.set(date, result.agent);
  }
  state.threadAttachments = Array.isArray(result.attachments) ? result.attachments : [];
  renderAttachments();
  renderAgentBar();
  refreshOllamaStatus();
  // Halaman di-reload/dibuka lagi saat Ollama masih bekerja: lanjut menunggu.
  if (result.pendingJob && result.pendingJob.id) {
    waitForAgentJob(date, result.pendingJob.id);
  }
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
  stopWaPolling();
  hideAllScreens();
  els.screenList.hidden = false;
  updateScrollBottomBtnVisibility();
  // Sengaja tanpa await -- ini cuma info tambahan di footer, tidak boleh
  // bikin daftar chat telat tampil kalau lambat/gagal.
  renderTokenUsage();
  await renderChatList();
}

async function showDetailScreen(date) {
  stopWaPolling();
  if (state.currentDate !== date) {
    state.threadAttachments = [];
    renderAttachments();
  }
  state.currentDate = date;
  hideAllScreens();
  els.screenDetail.hidden = false;
  resetInChatSearch();

  els.detailDateTitle.textContent = getDisplayLabel(date);
  renderDetailKbBadge();

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
  // Terima ID tanggal (YYYY-MM-DD) maupun ID obrolan bebas (freeform-<uuid>),
  // atau rute WhatsApp (#wa, #wa/<jid yang di-encode>).
  const match = location.hash.match(/^#d\/([0-9a-zA-Z_-]{1,60})$/);
  const waMatch = location.hash.match(/^#wa(?:\/(.+))?$/);
  stopFeatures();
  if (location.hash === "#prayer") {
    stopWaPolling();
    hideAllScreens();
    showPrayerScreen();
  } else if (/^#quran(\/.*)?$/.test(location.hash)) {
    stopWaPolling();
    hideAllScreens();
    showQuranScreen(location.hash);
  } else if (match) {
    showDetailScreen(match[1]);
  } else if (waMatch) {
    if (waMatch[1]) {
      showWaDetailScreen(decodeURIComponent(waMatch[1]));
    } else {
      showWaListScreen();
    }
  } else if (location.hash === "#chats") {
    showListScreen();
  } else {
    showHomeScreen();
  }
}

function showHomeScreen() {
  stopWaPolling();
  hideAllScreens();
  els.screenHome.hidden = false;
}

function openDetail(date) {
  location.hash = `d/${date}`;
}

// "Daftar" = daftar obrolan AI (#chats); beranda menu = hash kosong.
function openList() {
  location.hash = "chats";
}

function openHome() {
  location.hash = "";
}

// ---------- Fitur WhatsApp (daftar obrolan WA & satu obrolan WA) ----------
// Lihat wa.js buat klien Edge Function-nya & wa-bot/README.md buat cara
// jalanin bot-nya. Pola layar/polling di sini SENGAJA dibikin mirip layar
// Obrolan AI biasa (showListScreen/showDetailScreen) supaya konsisten, tapi
// dipisah fungsinya sendiri-sendiri karena sumber datanya beda total (tabel
// whatsapp_messages, bukan chat_messages) dan TIDAK ada konsep "terkunci di
// localStorage" -- WA selalu butuh kode akses buat baca apapun.

function openWaList() {
  location.hash = "wa";
}

function openWaDetail(jid) {
  location.hash = `wa/${encodeURIComponent(jid)}`;
}

// Dipanggil tiap kali SALAH SATU layar WA ditinggalkan (pindah ke layar
// lain) -- biar tidak ada 2 timer polling nyala bersamaan sia-sia di
// belakang layar yang sudah tidak kelihatan.
function stopWaPolling() {
  if (state.waListTimer) {
    clearInterval(state.waListTimer);
    state.waListTimer = null;
  }
  if (state.waDetailTimer) {
    clearInterval(state.waDetailTimer);
    state.waDetailTimer = null;
  }
}

function hideAllScreens() {
  els.screenHome.hidden = true;
  els.screenList.hidden = true;
  els.screenDetail.hidden = true;
  els.screenWaList.hidden = true;
  els.screenWaDetail.hidden = true;
  hideFeatureScreens();
}

async function showWaListScreen() {
  stopWaPolling();
  hideAllScreens();
  els.screenWaList.hidden = false;
  state.waCurrentJid = null;
  state.waListSignature = null;

  await renderWaList();
  // Poll tiap beberapa detik supaya daftar ikut kebaruan (ada pesan masuk
  // baru/berubah urutan) tanpa user harus manual refresh -- interval sama
  // dengan punya bot (lihat POLL_INTERVAL_MS di wa-bot/index.js) supaya
  // kira-kira selaras.
  state.waListTimer = setInterval(() => {
    renderWaList();
  }, 4000);
}

async function showWaDetailScreen(jid) {
  stopWaPolling();
  hideAllScreens();
  els.screenWaDetail.hidden = false;
  state.waCurrentJid = jid;
  state.waThreadSignature = null;
  state.waCurrentAutoReplyEnabled = null;
  els.waDetailTitle.textContent = formatWaJidLabel(jid);

  await loadWaThread(jid);
  state.waDetailTimer = setInterval(() => {
    loadWaThread(jid, { silent: true });
  }, 4000);
}

// "6281234567890@s.whatsapp.net" -> nama kontak (kalau sempat kebawa dari
// renderWaList(), lihat state.waNames) atau "+6281234567890" kalau belum ada
// nama -- v1 cuma dukung chat personal, jadi cukup pakai nomornya saja.
function formatWaJidLabel(jid) {
  if (!jid) return "";
  const known = state.waNames.get(jid);
  if (known) return known;
  const numberPart = jid.split("@")[0];
  return numberPart ? `+${numberPart}` : jid;
}

// Ubah nomor HP yang diketik user (mis. "0856...", "+62856...", "62856...",
// ada spasi/strip) jadi JID WhatsApp format nomor ("62856...@s.whatsapp.net")
// -- cukup buat MULAI obrolan baru dari aplikasi (lihat wa-new-chat-fab).
// CATATAN: ini cuma format "berbasis nomor HP" (@s.whatsapp.net) -- JID
// format "@lid" (lihat komentar di wa-bot/index.js) cuma pernah dikasih tau
// WhatsApp sendiri waktu KITA menerima pesan dari kontak itu, tidak bisa
// ditebak dari nomor HP-nya, jadi tidak relevan buat MEMULAI obrolan baru.
function normalizeWaPhoneToJid(raw) {
  const digits = (raw || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  let national = digits;
  if (national.startsWith("0")) {
    national = `62${national.slice(1)}`;
  } else if (!national.startsWith("62")) {
    national = `62${national}`;
  }
  // Nomor HP Indonesia wajar: kira-kira 10-13 digit SETELAH kode negara 62.
  if (national.length < 10 || national.length > 15) return null;
  return `${national}@s.whatsapp.net`;
}

function setWaListStatus(text) {
  if (!text) {
    els.waListStatus.hidden = true;
    els.waListStatus.textContent = "";
    return;
  }
  els.waListStatus.hidden = false;
  els.waListStatus.textContent = text;
}

async function renderWaList() {
  if (!state.chatCode) {
    els.waList.innerHTML = "";
    setWaListStatus(t(state.lang, "wa_need_code"));
    return;
  }

  // Sama kayak loadWaThread(): kalau daftarnya sudah pernah tampil (dari
  // panggilan sebelumnya, mis. tiap tick polling), jangan tutupi dengan teks
  // "Memuat..." -- biar tidak kedip-kedip tiap 4 detik.
  const hasExisting = els.waList.children.length > 0;
  if (!hasExisting) setWaListStatus(t(state.lang, "loading"));

  const result = await listWaChats(state.chatCode);
  if (!result.ok) {
    if (result.unauthorized) {
      state.chatCode = "";
      clearStoredChatCode();
      els.waList.innerHTML = "";
      setWaListStatus(t(state.lang, "chat_code_wrong"));
      return;
    }
    if (!hasExisting) setWaListStatus(t(state.lang, "wa_load_error"));
    return;
  }

  const chats = result.chats || [];
  state.waNames.clear();
  for (const chat of chats) {
    if (chat.name) state.waNames.set(chat.jid, chat.name);
  }

  if (chats.length === 0) {
    els.waList.innerHTML = "";
    setWaListStatus(t(state.lang, "wa_list_empty"));
    return;
  }

  // Diurut aktivitas terbaru -- lihat komentar di Edge Function `whatsapp`
  // action "list_chats" (sengaja TIDAK diurut di server, jadi diurut di sini).
  chats.sort((a, b) => (Date.parse(b.lastAt || 0) || 0) - (Date.parse(a.lastAt || 0) || 0));

  const signature = chats.map((c) => `${c.jid}:${c.lastContent}:${c.lastStatus}:${c.lastAt}`).join("|");
  if (signature === state.waListSignature) return;
  state.waListSignature = signature;

  setWaListStatus("");
  els.waList.innerHTML = "";

  for (const chat of chats) {
    const item = document.createElement("div");
    item.className = "chat-list-item";

    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "chat-list-item-main";

    const avatar = document.createElement("div");
    avatar.className = "chat-list-avatar";
    avatar.innerHTML = ICON_CHAT;

    const main = document.createElement("div");
    main.className = "chat-list-main";

    const top = document.createElement("div");
    top.className = "chat-list-top";
    const dateLabel = document.createElement("span");
    dateLabel.className = "chat-list-date";
    dateLabel.textContent = chat.name || formatWaJidLabel(chat.jid);
    const timeLabel = document.createElement("span");
    timeLabel.className = "chat-list-time";
    timeLabel.textContent = chat.lastAt ? formatBubbleTime(chat.lastAt) : "";

    const bottom = document.createElement("div");
    bottom.className = "chat-list-bottom";
    const preview = document.createElement("span");
    preview.className = "chat-list-preview";
    const prefix = chat.lastDirection === "out" ? `${t(state.lang, "chat_you_prefix")} ` : "";
    preview.textContent = chat.lastContent ? truncate(`${prefix}${chat.lastContent}`) : "";

    top.appendChild(dateLabel);
    top.appendChild(timeLabel);
    bottom.appendChild(preview);
    main.appendChild(top);
    main.appendChild(bottom);
    mainBtn.appendChild(avatar);
    mainBtn.appendChild(main);
    mainBtn.addEventListener("click", () => openWaDetail(chat.jid));

    item.appendChild(mainBtn);
    els.waList.appendChild(item);
  }
}

function setWaStatus(text) {
  if (!text) {
    els.waStatus.hidden = true;
    els.waStatus.textContent = "";
    return;
  }
  els.waStatus.hidden = false;
  els.waStatus.textContent = text;
}

// direction "out" (dikirim dari aplikasi ini, lewat wa-bot/) ditampilkan
// seperti bubble "user" (kanan) -- "in" (pesan masuk dari lawan bicara)
// seperti bubble "assistant" (kiri). Reuse gaya bubble obrolan AI yang sudah
// ada, cuma beda makna arahnya.
function appendWaBubble(direction, content, timestamp, status) {
  const emptyEl = els.waThread.querySelector(".chat-empty-text");
  if (emptyEl) emptyEl.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${direction === "out" ? "user" : "assistant"}`;

  const textEl = document.createElement("div");
  textEl.className = "chat-bubble-text";
  // Pesan WA ditampilkan APA ADANYA (textContent, bukan renderChatMarkdown)
  // -- isinya pesan WhatsApp biasa, bukan markdown dari AI.
  textEl.textContent = content;
  bubble.appendChild(textEl);

  const meta = document.createElement("div");
  meta.className = "chat-bubble-meta";

  const timeEl = document.createElement("span");
  timeEl.className = "chat-bubble-time";
  timeEl.textContent = formatBubbleTime(timestamp || new Date());
  meta.appendChild(timeEl);

  // Status pending/failed cuma relevan buat pesan KELUAR (yang kita kirim
  // dari sini) -- pesan masuk statusnya selalu "received", tidak perlu
  // ditampilkan.
  if (direction === "out" && status && status !== "sent") {
    const statusEl = document.createElement("span");
    statusEl.className = "chat-bubble-usage";
    statusEl.textContent = t(state.lang, status === "failed" ? "wa_status_failed" : "wa_status_pending");
    meta.appendChild(statusEl);
  }

  bubble.appendChild(meta);
  els.waThread.appendChild(bubble);
  scrollChatToBottom();
  return bubble;
}

function renderWaMessages(messages) {
  els.waThread.innerHTML = "";
  if (!messages || messages.length === 0) {
    const p = document.createElement("p");
    p.className = "chat-empty-text";
    p.textContent = t(state.lang, "wa_empty_thread");
    els.waThread.appendChild(p);
  } else {
    for (const msg of messages) {
      appendWaBubble(msg.direction, msg.content, msg.created_at, msg.status);
    }
  }
  scrollChatToBottom();
}

async function loadWaThread(jid, opts = {}) {
  const silent = opts.silent || false;
  if (!state.chatCode) {
    if (!silent) {
      els.waThread.innerHTML = "";
      setWaStatus(t(state.lang, "wa_need_code"));
    }
    return;
  }

  if (!silent) setWaStatus(t(state.lang, "loading"));
  const result = await fetchWaHistory(jid, state.chatCode);
  if (!silent) setWaStatus("");

  if (!result.ok) {
    if (result.unauthorized) {
      state.chatCode = "";
      clearStoredChatCode();
      setWaStatus(t(state.lang, "chat_code_wrong"));
      return;
    }
    if (!silent) setWaStatus(t(state.lang, "wa_load_error"));
    return;
  }

  // Diupdate TERLEPAS dari signature pesan di bawah (toggle-nya bisa saja
  // berubah tanpa ada pesan baru, mis. abis di-klik sendiri, atau diubah
  // dari perangkat/tab lain).
  updateWaAutoReplyToggleUi(result.autoReplyEnabled ?? true);

  const messages = result.messages || [];
  // Sama seperti renderWaList(): kalau tidak ada perubahan sama sekali sejak
  // render terakhir, jangan render ulang -- hindari bubble "berkedip"/scroll
  // ke bawah paksa tiap tick polling padahal user mungkin lagi scroll baca
  // pesan lama.
  const signature = messages.map((m) => `${m.id}:${m.status}`).join("|");
  if (signature === state.waThreadSignature) return;
  state.waThreadSignature = signature;

  renderWaMessages(messages);
}

// Gambar ikon lonceng di header layar WA detail sesuai status toggle
// auto-reply (tabel whatsapp_contacts) -- lihat loadWaThread() (diisi dari
// hasil "history") & handler klik tombolnya di bagian event listener.
function updateWaAutoReplyToggleUi(enabled) {
  state.waCurrentAutoReplyEnabled = enabled;
  els.waAutoReplyToggleIcon.innerHTML = enabled ? ICON_BELL_FILLED : ICON_BELL_OUTLINE;
  els.waAutoReplyToggle.title = t(state.lang, enabled ? "wa_auto_reply_on_title" : "wa_auto_reply_off_title");
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

  const saved = state.threadSaved.get(id) || false;
  els.chatOptionsSaveIcon.innerHTML = saved ? ICON_BOOKMARK_FILLED : ICON_BOOKMARK;
  els.chatOptionsSaveLabel.textContent = t(state.lang, saved ? "chat_options_unsave" : "chat_options_save");
  els.chatOptionsSaveBtn.classList.toggle("sheet-action--active", saved);

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

const KB_MAX_FILE_BYTES = 50 * 1024 * 1024;
let kbPollTimer = null;

async function renderKbDocList() {
  if (kbPollTimer) clearTimeout(kbPollTimer);
  kbPollTimer = null;
  let needsPoll = false;
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
    const status = doc.status || "ready";
    if (status !== "ready") needsPoll = true;
    if (status === "ready") {
      const bits = [];
      if (doc.page_count) bits.push(`${doc.page_count.toLocaleString(locale)} ${t(state.lang, "kb_pages_unit")}`);
      bits.push(`${charCount.toLocaleString(locale)} ${t(state.lang, "kb_chars_unit")}`);
      bits.push(formatFullDateTime(doc.uploaded_at));
      meta.textContent = bits.join(" • ");
    } else {
      meta.textContent = formatFullDateTime(doc.uploaded_at);
    }
    main.appendChild(titleEl);
    main.appendChild(meta);

    const info = document.createElement("div");
    info.className = `kb-doc-state kb-doc-state--${status}`;
    if (status === "uploading") info.textContent = t(state.lang, "kb_state_uploading");
    else if (status === "queued") info.textContent = t(state.lang, "kb_state_queued");
    else if (status === "processing") info.textContent = `${t(state.lang, "kb_state_processing")}${doc.status_detail ? ` — ${doc.status_detail}` : ""}`;
    else if (status === "error") info.textContent = `${t(state.lang, "kb_state_error")}${doc.error ? `: ${doc.error}` : ""}`;
    else {
      const extra = [];
      if (doc.on_laptop) extra.push(t(state.lang, "kb_state_indexed"));
      if (doc.truncated) extra.push(t(state.lang, "kb_state_truncated"));
      if (doc.ocr_pages) extra.push(`${doc.ocr_pages} ${t(state.lang, "kb_state_ocr")}`);
      info.textContent = extra.join(" • ");
    }
    if (info.textContent) main.appendChild(info);
    // Catatan mutu dokumen siap pakai (mis. "⚠️ Sebagian teks berantakan: 2 dari 10 halaman"), dari bot di laptop.
    if (status === "ready" && doc.status_detail) {
      const notes = String(doc.status_detail)
        .split(" • ")
        .filter((p) => p && !/hlm via OCR/.test(p));
      if (notes.length > 0) {
        const warn = document.createElement("div");
        warn.className = `kb-doc-note${notes.some((p) => p.includes("⚠️")) ? " kb-doc-note--warn" : ""}`;
        warn.textContent = notes.join(" • ");
        main.appendChild(warn);
      }
    }

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
    if (status === "error" && doc.on_laptop !== true) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "secondary-btn kb-retry-btn";
      retryBtn.textContent = t(state.lang, "kb_retry_btn");
      retryBtn.addEventListener("click", async () => {
        retryBtn.disabled = true;
        const r = await retryKnowledgeDoc(state.chatCode, doc.id);
        if (!r.ok) alertWithDetail("kb_retry_error", r);
        await renderKbDocList();
      });
      row.appendChild(retryBtn);
    }
    row.appendChild(delBtn);
    els.kbDocList.appendChild(row);
  }

  // Selama ada dokumen yang masih diproses, segarkan daftar tiap 4 detik
  // (selama dialog terbuka).
  if (needsPoll) {
    kbPollTimer = setTimeout(() => {
      if (els.kbDialog.open) renderKbDocList();
    }, 4000);
  }
}

// ---------- Template Jawaban WA (Pengaturan > Template Jawaban WA) ----------
// Pesan WA masuk yang cocok dgn kata kunci sebuah template dijawab langsung
// oleh bot dari template itu, tanpa memanggil AI (lihat wa-bot/index.js,
// findQuickReply & tabel wa_quick_replies).

// id template yang lagi diubah lewat form (null = form lagi mode "tambah baru").
let qrEditingId = null;

// Kalau server menolak kode akses, lupakan kode tersimpan -- pola yang sama
// dipakai di seluruh dialog Pengaturan lain.
function dropChatCodeIfUnauthorized(result) {
  if (result && result.unauthorized) {
    state.chatCode = "";
    clearStoredChatCode();
  }
}

function setQrStatus(text) {
  els.qrStatus.hidden = !text;
  els.qrStatus.textContent = text || "";
}

function resetQrForm() {
  qrEditingId = null;
  els.qrTitleInput.value = "";
  els.qrKeywordsInput.value = "";
  els.qrReplyInput.value = "";
  els.qrCancelEditBtn.hidden = true;
}

async function openQrDialog() {
  closeSettingsDialog();
  resetQrForm();
  setQrStatus("");
  openDialogEl(els.qrDialog);
  await renderQrList();
}

async function renderQrList() {
  els.qrList.innerHTML = "";

  if (!state.chatCode) {
    els.qrListEmpty.hidden = false;
    els.qrListEmpty.textContent = t(state.lang, "qr_need_code");
    return;
  }

  els.qrListEmpty.hidden = false;
  els.qrListEmpty.textContent = t(state.lang, "loading");

  const result = await listWaQuickReplies(state.chatCode);
  if (!result.ok) {
    dropChatCodeIfUnauthorized(result);
    els.qrListEmpty.textContent = t(state.lang, "qr_load_error");
    return;
  }

  const replies = result.replies || [];
  if (replies.length === 0) {
    els.qrListEmpty.textContent = t(state.lang, "qr_empty");
    return;
  }
  els.qrListEmpty.hidden = true;

  for (const item of replies) {
    const row = document.createElement("div");
    row.className = "kb-doc-row qr-row";
    if (!item.enabled) row.classList.add("qr-row--disabled");

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "qr-toggle";
    toggle.checked = !!item.enabled;
    const toggleLabel = t(state.lang, item.enabled ? "qr_toggle_off" : "qr_toggle_on");
    toggle.title = toggleLabel;
    toggle.setAttribute("aria-label", toggleLabel);
    toggle.addEventListener("change", async () => {
      const nextEnabled = toggle.checked;
      toggle.disabled = true;
      const saveResult = await saveWaQuickReply(state.chatCode, {
        id: item.id,
        title: item.title,
        keywords: item.keywords,
        reply: item.reply,
        enabled: nextEnabled
      });
      if (!saveResult.ok) {
        dropChatCodeIfUnauthorized(saveResult);
        alertWithDetail("qr_toggle_error", saveResult);
      }
      await renderQrList();
    });

    const main = document.createElement("div");
    main.className = "kb-doc-main";
    const titleEl = document.createElement("div");
    titleEl.className = "kb-doc-title";
    titleEl.textContent = item.enabled ? item.title : `${item.title} (${t(state.lang, "qr_disabled_label")})`;
    const kwEl = document.createElement("div");
    kwEl.className = "kb-doc-meta";
    kwEl.textContent = `${t(state.lang, "qr_keywords_label")}: ${(item.keywords || []).join(", ")}`;
    const replyEl = document.createElement("div");
    replyEl.className = "qr-reply-preview";
    replyEl.textContent = truncate(item.reply || "", 90);
    const usedEl = document.createElement("div");
    usedEl.className = "kb-doc-meta";
    usedEl.textContent = `${item.use_count || 0} ${t(state.lang, "qr_used_unit")}`;
    main.appendChild(titleEl);
    main.appendChild(kwEl);
    main.appendChild(replyEl);
    main.appendChild(usedEl);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn icon-btn--small";
    editBtn.innerHTML = ICON_EDIT;
    editBtn.title = t(state.lang, "qr_edit_btn");
    editBtn.setAttribute("aria-label", t(state.lang, "qr_edit_btn"));
    editBtn.addEventListener("click", () => {
      qrEditingId = item.id;
      els.qrTitleInput.value = item.title || "";
      els.qrKeywordsInput.value = (item.keywords || []).join(", ");
      els.qrReplyInput.value = item.reply || "";
      els.qrCancelEditBtn.hidden = false;
      setQrStatus("");
      els.qrTitleInput.focus();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn icon-btn--small";
    delBtn.innerHTML = ICON_TRASH;
    delBtn.title = t(state.lang, "qr_delete_btn");
    delBtn.setAttribute("aria-label", t(state.lang, "qr_delete_btn"));
    delBtn.addEventListener("click", async () => {
      if (!window.confirm(t(state.lang, "qr_delete_confirm"))) return;
      const delResult = await deleteWaQuickReply(state.chatCode, item.id);
      if (!delResult.ok) {
        dropChatCodeIfUnauthorized(delResult);
        alertWithDetail("qr_delete_error", delResult);
        return;
      }
      if (qrEditingId === item.id) resetQrForm();
      await renderQrList();
    });

    row.appendChild(toggle);
    row.appendChild(main);
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    els.qrList.appendChild(row);
  }
}

// ---------- Status API Gemini (Pengaturan > Status API Gemini) ----------
// Data dari action "key_status" di Edge Function chat (tabel gemini_key_usage,
// ditulis bot wa-bot/ & Edge Function chat). Key aslinya TIDAK PERNAH sampai
// ke sini -- cuma 4 karakter terakhir (hint) buat membedakan satu key dari
// yang lain.

async function openKeysDialog() {
  closeSettingsDialog();
  openDialogEl(els.keysDialog);
  stopSystemStatusTimer();
  // Status sistem (bot/WA/Ollama/antrean) diperbarui tiap 10 detik selama dialog terbuka.
  state.sysTimer = setInterval(() => {
    if (els.keysDialog.open) renderSystemStatus();
    else stopSystemStatusTimer();
  }, 10000);
  await Promise.all([renderSystemStatus(), renderKeysList()]);
}

function stopSystemStatusTimer() {
  if (state.sysTimer) clearInterval(state.sysTimer);
  state.sysTimer = null;
}

// "12 dtk", "3 mnt", "2 jam", "1 hr" (id) / "12 s", "3 m", "2 h", "1 d" (en).
function formatDuration(seconds) {
  const id = state.lang === "id";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} ${id ? "dtk" : "s"}`;
  if (s < 3600) return `${Math.round(s / 60)} ${id ? "mnt" : "m"}`;
  if (s < 86400) return `${Math.round(s / 3600)} ${id ? "jam" : "h"}`;
  return `${Math.round(s / 86400)} ${id ? "hr" : "d"}`;
}

function sysRow(on, label, value) {
  const row = document.createElement("div");
  row.className = "sys-row";
  const dot = document.createElement("span");
  dot.className = `sys-dot${on === true ? " sys-dot--on" : ""}`;
  const main = document.createElement("div");
  main.className = "sys-row-main";
  const l = document.createElement("span");
  l.className = "sys-row-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "sys-row-value";
  v.textContent = value;
  main.append(l, v);
  row.append(dot, main);
  return row;
}

async function renderSystemStatus() {
  const box = els.sysStatus;
  if (!state.chatCode) {
    box.textContent = t(state.lang, "keys_need_code");
    return;
  }
  const res = await fetchSystemStatus(state.chatCode);
  if (!res.ok) {
    dropChatCodeIfUnauthorized(res);
    if (!box.children.length) box.textContent = t(state.lang, "sys_load_error");
    return;
  }
  const L = (k) => t(state.lang, k);
  const w = res.worker || {};
  const jobs = res.jobs || {};
  const now = res.serverNowMs || Date.now();
  const ago = w.lastSeenMs ? formatDuration((now - w.lastSeenMs) / 1000) : null;

  const rows = [];
  rows.push(
    sysRow(
      !!w.botAlive,
      L("sys_bot"),
      w.botAlive
        ? `${L("sys_on")} · ${L("sys_seen")} ${ago} ${L("sys_ago")}${w.startedAt ? ` · ${L("sys_up")} ${formatDuration((now - Date.parse(w.startedAt)) / 1000)}` : ""}`
        : `${L("sys_off")}${ago ? ` · ${L("sys_seen")} ${ago} ${L("sys_ago")}` : ""}`
    )
  );
  rows.push(
    sysRow(
      w.waConnected === true,
      L("sys_wa"),
      w.waConnected === true ? L("sys_connected") : w.waConnected === false ? L("sys_disconnected") : L("sys_unknown")
    )
  );
  rows.push(
    sysRow(
      !!w.online,
      L("sys_ollama"),
      w.online
        ? `${L("sys_ready")}${w.model ? ` · ${w.model}` : ""}${w.busy ? ` · ${L("sys_busy")}` : ""}`
        : `${L("sys_off")}${w.detail ? ` · ${w.detail}` : ""}`
    )
  );
  const avg = jobs.avgSeconds != null ? ` · ${L("sys_avg")} ${formatDuration(jobs.avgSeconds)}` : "";
  rows.push(
    sysRow(
      (jobs.running || 0) > 0 || (jobs.pending || 0) > 0,
      L("sys_queue"),
      `${jobs.pending || 0} ${L("sys_waiting")} · ${jobs.running || 0} ${L("sys_running")} | ${L("sys_last24")}: ${jobs.done24h || 0} ${L("sys_done")}, ${jobs.failed24h || 0} ${L("sys_failed")}${avg}`
    )
  );
  if (w.extra && typeof w.extra.pausedChats === "number") {
    rows.push(sysRow(w.extra.pausedChats > 0, L("sys_paused"), String(w.extra.pausedChats)));
  }

  const mem = w.extra && w.extra.mem;
  if (mem && Number(mem.totalMB) > 0) {
    const gb = (mb) => (Number(mb) / 1024).toFixed(1);
    const low = Number(mem.availableMB) < 1000;
    rows.push(
      sysRow(
        !low,
        L("sys_mem"),
        `${L("sys_mem_avail")} ${gb(mem.availableMB)} / ${gb(mem.totalMB)} GB · ${L("sys_mem_swap")} ${gb(mem.swapUsedMB || 0)} GB${low ? ` · ${L("sys_mem_low")}` : ""}`
      )
    );
  }

  const kb = w.extra && w.extra.kb;
  if (kb && typeof kb.docs === "number") {
    const tools = `${kb.pdftotext ? "pdftotext" : L("sys_kb_no_pdftotext")} · ${kb.ocr ? "OCR" : L("sys_kb_no_ocr")}`;
    const busyKb = kb.processing ? ` · ${L("sys_kb_processing")}: ${kb.processing}` : "";
    const err = kb.lastError ? ` · ${kb.lastError}` : "";
    rows.push(
      sysRow(
        !!kb.pdftotext && !kb.lastError,
        L("sys_kb"),
        `${kb.docs} ${L("sys_kb_docs")} · ${(kb.chunks || 0).toLocaleString()} ${L("sys_kb_chunks")} · ${tools}${busyKb}${err}`
      )
    );
  }

  const frag = document.createDocumentFragment();
  rows.forEach((r) => frag.appendChild(r));

  const recent = document.createElement("div");
  const rt = document.createElement("span");
  rt.className = "sys-row-label";
  rt.textContent = L("sys_recent");
  recent.appendChild(rt);
  const list = document.createElement("div");
  list.className = "sys-jobs";
  if (!(jobs.recent || []).length) {
    list.textContent = L("sys_no_jobs");
  } else {
    for (const j of jobs.recent) {
      const line = document.createElement("div");
      line.className = "sys-job";
      const left = document.createElement("span");
      const statusKey = { pending: "sys_waiting", running: "sys_running", done: "sys_done", failed: "sys_failed" }[j.status] || "sys_unknown";
      left.textContent = `${L(statusKey)}${j.fallbackFrom ? " (Gemini→Ollama)" : ""}${j.status === "failed" && j.error ? ` — ${truncate(String(j.error), 60)}` : ""}${j.status === "running" && j.progress ? ` — ${j.progress}` : ""}`;
      const right = document.createElement("span");
      const dur = j.startedAt && j.finishedAt ? formatDuration((Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 1000) : "";
      right.textContent = `${dur}${dur ? " · " : ""}${formatFullDateTime(Date.parse(j.createdAt))}`;
      line.append(left, right);
      list.appendChild(line);
    }
  }
  recent.appendChild(list);
  frag.appendChild(recent);

  box.replaceChildren(frag);
}

async function renderKeysList() {
  els.keysList.innerHTML = "";
  els.keysResetNote.textContent = "";

  if (!state.chatCode) {
    els.keysStatus.hidden = false;
    els.keysStatus.textContent = t(state.lang, "keys_need_code");
    return;
  }

  els.keysStatus.hidden = false;
  els.keysStatus.textContent = t(state.lang, "loading");

  const result = await fetchKeyStatus(state.chatCode);
  if (!result.ok) {
    dropChatCodeIfUnauthorized(result);
    els.keysStatus.textContent = t(state.lang, "keys_load_error");
    return;
  }

  const keys = result.keys || [];
  if (keys.length === 0) {
    els.keysStatus.textContent = t(state.lang, "keys_empty");
    return;
  }
  els.keysStatus.hidden = true;

  const limit = Number(result.dailyLimit) > 0 ? Number(result.dailyLimit) : 20;

  for (const k of keys) {
    const row = document.createElement("div");
    row.className = "kb-doc-row keys-row";

    const main = document.createElement("div");
    main.className = "kb-doc-main";

    const head = document.createElement("div");
    head.className = "keys-head";
    const nameEl = document.createElement("span");
    nameEl.className = "kb-doc-title";
    nameEl.textContent = `${t(state.lang, "keys_key_label")} …${k.hint}`;
    const isDaily = k.exhausted && k.exhaustedKind !== "temporary";
    const chip = document.createElement("span");
    chip.className = `keys-chip ${isDaily ? "keys-chip--exhausted" : "keys-chip--active"}`;
    chip.textContent = t(state.lang, isDaily ? "keys_exhausted" : k.exhausted ? "keys_limited" : "keys_active");
    head.appendChild(nameEl);
    head.appendChild(chip);

    const bar = document.createElement("div");
    bar.className = "keys-bar";
    const fill = document.createElement("div");
    const pct = isDaily ? 100 : Math.min(100, Math.round((k.requests / limit) * 100));
    fill.className = "keys-bar-fill";
    if (isDaily) fill.classList.add("keys-bar-fill--exhausted");
    else if (pct >= 80) fill.classList.add("keys-bar-fill--warn");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const meta = document.createElement("div");
    meta.className = "kb-doc-meta";
    meta.textContent = `${k.requests} / ${limit} ${t(state.lang, "keys_requests_unit")}`;

    main.appendChild(head);
    main.appendChild(bar);
    main.appendChild(meta);
    if (k.exhausted && k.exhaustedUntilMs) {
      const until = document.createElement("div");
      until.className = "kb-doc-meta";
      until.textContent = `${t(state.lang, isDaily ? "keys_exhausted_until" : "keys_limited_until")} ${formatFullDateTime(k.exhaustedUntilMs)}`;
      main.appendChild(until);
    }
    // Pesan error terakhir dari Google (dipotong) -- buat tahu PENYEBAB
    // sebenarnya tanpa harus buka log server.
    if (k.lastError) {
      const errEl = document.createElement("div");
      errEl.className = "keys-last-error";
      errEl.textContent = `${t(state.lang, "keys_last_error_prefix")} ${truncate(String(k.lastError), 400)}`;
      main.appendChild(errEl);
    }

    row.appendChild(main);
    els.keysList.appendChild(row);
  }

  if (result.resetAtMs) {
    els.keysResetNote.textContent = `${t(state.lang, "keys_reset_note")} ${formatFullDateTime(result.resetAtMs)}`;
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

  els.waListBackBtn.addEventListener("click", () => {
    openHome();
  });

  els.chatsBackBtn.addEventListener("click", () => openHome());
  els.menuChatBtn.addEventListener("click", () => openList());

  els.waDetailBackBtn.addEventListener("click", () => {
    openWaList();
  });

  // Toggle auto-reply AI khusus kontak yang lagi dibuka (lihat
  // updateWaAutoReplyToggleUi() & tabel whatsapp_contacts) -- optimistic:
  // ikon diganti duluan, baru dikembalikan kalau request-nya gagal.
  els.waAutoReplyToggle.addEventListener("click", async () => {
    const jid = state.waCurrentJid;
    if (!jid || !state.chatCode || state.waCurrentAutoReplyEnabled === null) return;

    const next = !state.waCurrentAutoReplyEnabled;
    updateWaAutoReplyToggleUi(next);

    const result = await setWaAutoReply(jid, next, state.chatCode);
    if (!result.ok) {
      updateWaAutoReplyToggleUi(!next);
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
        setWaStatus(t(state.lang, "chat_code_wrong"));
        return;
      }
      setWaStatus(t(state.lang, "wa_auto_reply_toggle_error"));
    }
  });

  els.waForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = els.waInput.value.trim();
    const jid = state.waCurrentJid;
    if (!text || !jid) return;
    if (!state.chatCode) {
      setWaStatus(t(state.lang, "wa_need_code"));
      openChatCodeDialog();
      return;
    }

    els.waInput.value = "";
    els.waInput.style.height = "auto";
    els.waSendBtn.disabled = true;
    // Bubble ditampilkan dulu (optimistic) dengan status "pending" -- baru
    // beneran terkirim setelah bot wa-bot/ polling & proses (lihat komentar
    // panjang di wa-bot/index.js). Status finalnya ('sent'/'failed') baru
    // kelihatan di tick polling berikutnya (loadWaThread), begitu
    // state.waThreadSignature berubah.
    appendWaBubble("out", text, new Date(), "pending");
    state.waThreadSignature = null;

    const result = await sendWaMessage(jid, text, state.chatCode);
    els.waSendBtn.disabled = false;

    if (!result.ok) {
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
        setWaStatus(t(state.lang, "chat_code_wrong"));
        return;
      }
      setWaStatus(t(state.lang, "wa_send_error"));
      return;
    }
    setWaStatus("");
  });

  // Enter buat kirim, Shift+Enter buat baris baru -- sama seperti chatInput.
  els.waInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.waForm.requestSubmit();
    }
  });

  els.waInput.addEventListener("input", () => {
    els.waInput.style.height = "auto";
    els.waInput.style.height = `${els.waInput.scrollHeight}px`;
  });

  // Mulai obrolan WA baru dari aplikasi (bukan nunggu kontak chat duluan) --
  // lihat normalizeWaPhoneToJid() & komentar di wa-new-chat-dialog (index.html).
  els.waNewChatFab.addEventListener("click", () => {
    if (!state.chatCode) {
      openChatCodeDialog();
      return;
    }
    els.waNewChatPhone.value = "";
    els.waNewChatMessage.value = "";
    els.waNewChatError.hidden = true;
    openDialogEl(els.waNewChatDialog);
    els.waNewChatPhone.focus();
  });

  els.waNewChatCancel.addEventListener("click", () => {
    closeDialogEl(els.waNewChatDialog);
  });

  els.waNewChatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const jid = normalizeWaPhoneToJid(els.waNewChatPhone.value);
    const message = els.waNewChatMessage.value.trim();

    if (!jid) {
      els.waNewChatError.hidden = false;
      els.waNewChatError.textContent = t(state.lang, "wa_new_chat_invalid_phone");
      return;
    }
    if (!message) return;

    const submitBtn = els.waNewChatForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    els.waNewChatError.hidden = true;

    // Reuse action "send" yang sama dengan balas chat biasa -- Edge Function
    // `whatsapp` memang sudah generik (terima jid apa saja, tidak perlu ada
    // riwayat dulu), jadi "mulai obrolan baru" di sini cukup berarti "kirim
    // pesan pertama ke jid yang belum pernah ada baris-nya sama sekali".
    const result = await sendWaMessage(jid, message, state.chatCode);
    submitBtn.disabled = false;

    if (!result.ok) {
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
        closeDialogEl(els.waNewChatDialog);
        openChatCodeDialog();
        return;
      }
      els.waNewChatError.hidden = false;
      els.waNewChatError.textContent = result.message || t(state.lang, "wa_send_error");
      return;
    }

    closeDialogEl(els.waNewChatDialog);
    state.waListSignature = null;
    openWaDetail(jid);
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
    // Sama seperti 2 cabang di atas, tapi buat layar WhatsApp -- dialog kode
    // akses ini generik dan bisa saja dibuka waktu user lagi di salah satu
    // layar WA (lihat waForm submit handler & renderWaList()/loadWaThread()).
    if (!els.screenWaList.hidden) {
      state.waListSignature = null;
      await renderWaList();
    }
    if (!els.screenWaDetail.hidden && state.waCurrentJid) {
      state.waThreadSignature = null;
      await loadWaThread(state.waCurrentJid);
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
    const result = await sendChatMessage(date, state.chatCode, text, currentAgent());

    els.chatSendBtn.disabled = false;
    setChatStatus("");

    // Ollama dipilih tapi laptop/bot/Ollama tidak hidup: server MENOLAK tanpa
    // menyimpan pesan -- buang bubble sementara & kembalikan teks ke kolom ketik.
    if (!result.ok && result.ollamaOffline) {
      userBubble.remove();
      if (!els.chatThread.querySelector(".chat-bubble")) {
        const p = document.createElement("p");
        p.className = "chat-empty-text";
        p.textContent = t(state.lang, "chat_empty_freeform");
        els.chatThread.appendChild(p);
      }
      els.chatInput.value = text;
      els.chatInput.style.height = "auto";
      els.chatInput.style.height = `${els.chatInput.scrollHeight}px`;
      state.ollamaOnline = false;
      renderAgentBar();
      setChatStatus(`${t(state.lang, "agent_offline")} ${result.message || ""}`.trim());
      return;
    }

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

    // Diantrekan ke Ollama di laptop (pilihan "Ollama", atau "Auto" saat Gemini
    // gagal): tunggu hasilnya lewat polling -- balasan muncul begitu selesai.
    if (result.pending && result.jobId) {
      await waitForAgentJob(date, result.jobId, { fallback: result.fallbackFrom === "gemini" });
      return;
    }

    appendChatBubble("assistant", result.reply, new Date(), result.assistantMessageId, result.turnTokens, result.turnCostUsd, result.agent || "gemini");

    // Kalau pencarian lagi aktif waktu pesan baru masuk, ikut re-scan supaya
    // pesan baru ini juga ketemu kalau cocok dengan kata kuncinya.
    if (!els.chatSearchBar.hidden && els.chatInSearchInput.value.trim()) {
      applyInChatSearch(els.chatInSearchInput.value);
    }
  });

  // Lampiran file.
  els.chatAttachBtn.addEventListener("click", () => els.chatAttachInput.click());
  els.chatAttachInput.addEventListener("change", () => handleAttachFile(els.chatAttachInput.files?.[0]));

  // Pemilih agen AI (Auto / Gemini / Ollama).
  els.chatAgentBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".chat-agent-pill");
    if (btn && btn.dataset.agent) chooseAgent(btn.dataset.agent);
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
  els.menuChatIcon.innerHTML = ICON_SPARK;
  els.menuKbIcon.innerHTML = ICON_UPLOAD;
  els.menuWhatsappIcon.innerHTML = ICON_CHAT;
  els.menuQrIcon.innerHTML = ICON_ZAP;
  els.menuKeysIcon.innerHTML = ICON_PULSE;
  els.chatAttachBtn.innerHTML = ICON_PAPERCLIP;
  els.settingsChangeCodeIcon.innerHTML = ICON_KEY;
  els.settingsLogoutIcon.innerHTML = ICON_LOGOUT;
  els.menuAboutIcon.innerHTML = ICON_INFO;
  els.menuPrayerIcon.innerHTML = ICON_PRAYER;
  els.menuQuranIcon.innerHTML = ICON_BOOK;
  document.getElementById("prayer-refresh-icon").innerHTML = ICON_LOCATE;

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

  // Tanda "Saved": wajib tersimpan di server (yang menjalankan hapus otomatis), jadi butuh kode akses.
  els.chatOptionsSaveBtn.addEventListener("click", async () => {
    const id = state.activeOptionsId;
    if (!id) return;
    if (!requireChatCodeOrPrompt("need_code_saved")) return;
    closeChatOptions();

    const nextSaved = !(state.threadSaved.get(id) || false);
    state.threadSaved.set(id, nextSaved);
    renderDetailKbBadge();

    const result = await setThreadMeta(id, state.chatCode, { saved: nextSaved });
    if (!result.ok) {
      state.threadSaved.set(id, !nextSaved);
      renderDetailKbBadge();
      if (result.unauthorized) {
        state.chatCode = "";
        clearStoredChatCode();
      }
      alertWithDetail("saved_sync_error", result);
      return;
    }

    if (!els.screenList.hidden) {
      await renderChatList();
    }
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
    renderDetailKbBadge();

    const result = await setThreadMeta(id, state.chatCode, { useKb: nextUseKb });
    if (!result.ok) {
      state.threadUseKb.set(id, !nextUseKb);
      renderDetailKbBadge();
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

  els.menuKbBtn.addEventListener("click", () => openKbDialog());

  els.menuWhatsappBtn.addEventListener("click", () => {
    closeSettingsDialog();
    openWaList();
  });

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

  els.menuPrayerBtn.addEventListener("click", () => {
    closeSettingsDialog();
    location.hash = "prayer";
  });

  els.menuQuranBtn.addEventListener("click", () => {
    closeSettingsDialog();
    location.hash = "quran";
  });

  els.menuAboutBtn.addEventListener("click", () => {
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

  els.menuQrBtn.addEventListener("click", () => openQrDialog());
  els.menuKeysBtn.addEventListener("click", () => openKeysDialog());

  els.qrCloseBtn.addEventListener("click", () => closeDialogEl(els.qrDialog));
  els.qrDialog.addEventListener("click", (e) => {
    if (e.target === els.qrDialog) closeDialogEl(els.qrDialog);
  });
  els.qrCancelEditBtn.addEventListener("click", () => {
    resetQrForm();
    setQrStatus("");
  });
  els.qrForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!state.chatCode) {
      setQrStatus(t(state.lang, "qr_need_code"));
      return;
    }
    const title = els.qrTitleInput.value.trim();
    const keywords = els.qrKeywordsInput.value
      .split(/[,\n]/)
      .map((k) => k.trim())
      .filter(Boolean);
    const reply = els.qrReplyInput.value.trim();
    if (!title) {
      setQrStatus(t(state.lang, "qr_title_required"));
      return;
    }
    if (keywords.length === 0) {
      setQrStatus(t(state.lang, "qr_keywords_required"));
      return;
    }
    if (!reply) {
      setQrStatus(t(state.lang, "qr_reply_required"));
      return;
    }

    els.qrSaveBtn.disabled = true;
    setQrStatus(t(state.lang, "qr_saving"));
    const result = await saveWaQuickReply(state.chatCode, { id: qrEditingId || undefined, title, keywords, reply });
    els.qrSaveBtn.disabled = false;
    if (!result.ok) {
      dropChatCodeIfUnauthorized(result);
      setQrStatus(result.message ? `${t(state.lang, "qr_save_error")} (${result.message})` : t(state.lang, "qr_save_error"));
      return;
    }
    resetQrForm();
    setQrStatus(t(state.lang, "qr_save_success"));
    await renderQrList();
  });

  els.keysCloseBtn.addEventListener("click", () => closeDialogEl(els.keysDialog));
  els.keysDialog.addEventListener("close", stopSystemStatusTimer);
  els.keysDialog.addEventListener("click", (e) => {
    if (e.target === els.keysDialog) closeDialogEl(els.keysDialog);
  });
  els.keysRefreshBtn.addEventListener("click", () => Promise.all([renderSystemStatus(), renderKeysList()]));

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

    if (file.size > KB_MAX_FILE_BYTES) {
      els.kbUploadStatus.hidden = false;
      els.kbUploadStatus.textContent = t(state.lang, "kb_file_too_big");
      return;
    }

    // File dikirim MENTAH; konversi ke teks + pengindeksan dikerjakan bot di
    // laptop (lihat wa-bot/kb-ingest.js), jadi tidak ada batas karakter dan
    // PDF scan pun bisa di-OCR di sana.
    els.kbUploadBtn.disabled = true;
    els.kbUploadStatus.hidden = false;
    els.kbUploadStatus.textContent = t(state.lang, "kb_uploading");
    const result = await uploadKnowledgeFile(state.chatCode, { title, file });
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

    els.kbUploadStatus.textContent = t(state.lang, "kb_upload_queued");
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
  initFeatures({ getLang: () => state.lang, getCode: () => state.chatCode });
  fixStickyHeaderOnIOSKeyboard();
  await registerServiceWorker();
  await initChat();
  handleRoute();
}

main();
