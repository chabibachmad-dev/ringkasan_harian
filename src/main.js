import { supabase } from "./supabaseClient.js";
import { applyStaticI18n, t } from "./i18n.js";
import { renderMiniMarkdown } from "./markdown.js";
import { isIOS, isStandalone, pushSupported, registerServiceWorker, getExistingSubscription, subscribeToPush } from "./push.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

const els = {
  langToggle: document.getElementById("lang-toggle"),
  langLabel: document.getElementById("lang-label"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  notifyCard: document.getElementById("notify-card"),
  notifyText: document.getElementById("notify-text"),
  notifyBtn: document.getElementById("notify-btn"),
  dateSelect: document.getElementById("date-select"),
  summaryStatus: document.getElementById("summary-status"),
  summaryContent: document.getElementById("summary-content"),
  sourcesSection: document.getElementById("sources-section"),
  sourcesIndonesia: document.getElementById("sources-indonesia"),
  sourcesDunia: document.getElementById("sources-dunia")
};

const state = {
  lang: localStorage.getItem("rh_lang") || "id",
  theme: localStorage.getItem("rh_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  summaries: [], // { summary_date, status }
  currentDate: null,
  cache: new Map() // summary_date -> full row
};

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
    .select("summary_date, status")
    .order("summary_date", { ascending: false })
    .limit(60);

  if (error) {
    els.summaryStatus.textContent = t(state.lang, "load_error");
    els.summaryStatus.hidden = false;
    console.error(error);
    return;
  }

  state.summaries = data || [];
  els.dateSelect.innerHTML = "";
  for (const row of state.summaries) {
    const opt = document.createElement("option");
    opt.value = row.summary_date;
    opt.textContent = formatDateLabel(row.summary_date) + (row.status === "failed" ? " ⚠️" : "");
    els.dateSelect.appendChild(opt);
  }

  if (state.summaries.length > 0) {
    state.currentDate = state.summaries[0].summary_date;
    els.dateSelect.value = state.currentDate;
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
  const { endpoint, keys } = subJson;
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: navigator.userAgent, last_seen_at: new Date().toISOString() },
      { onConflict: "endpoint" }
    );
  if (error) {
    console.error("Gagal simpan subscription:", error);
    return { ok: false, message: `${error.message || error.code || "unknown error"}` };
  }
  return { ok: true };
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

function wireEvents() {
  els.langToggle.addEventListener("click", () => {
    state.lang = state.lang === "id" ? "en" : "id";
    localStorage.setItem("rh_lang", state.lang);
    applyLang();
    loadDateList().then(() => {
      if (state.currentDate) els.dateSelect.value = state.currentDate;
      renderCurrentSummary();
    });
    initNotifyCard();
  });

  els.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("rh_theme", state.theme);
    applyTheme();
  });

  els.dateSelect.addEventListener("change", (e) => {
    state.currentDate = e.target.value;
    renderCurrentSummary();
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
  await Promise.all([loadDateList().then(renderCurrentSummary), initNotifyCard()]);
}

main();
