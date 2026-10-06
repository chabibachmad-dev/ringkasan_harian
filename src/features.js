// Layar "Jadwal Shalat" dan "Al-Qur'an" (dibuka dari Pengaturan).
// Logika murni ada di prayer.js & quran.js; file ini cuma urusan tampilan.
// Rute (hash): #prayer, #quran, #quran/p/<halaman>[/<surah>:<ayat>]

import { t } from "./i18n.js";
import { ICON_BOOKMARK, ICON_BOOKMARK_FILLED, ICON_TRASH } from "./icons.js";
import {
  DEFAULT_LOCATION,
  FARDH,
  PRAYER_ORDER,
  cardinal,
  detectLocation,
  formatClock,
  formatCountdown,
  getCurrentPrayer,
  getNextPrayer,
  getPrayerTimes,
  hijriDate,
  loadSavedLocation,
  qiblaBearing,
  tzLabel
} from "./prayer.js";
import {
  JUZ_START_PAGES,
  SURAHS,
  TOTAL_PAGES,
  BASMALAH_TEXT,
  cachedPageCount,
  clampPage,
  downloadAll,
  getLastRead,
  getPage,
  groupBySurah,
  hizbLabel,
  isBookmarked,
  juzOfPage,
  listBookmarks,
  prefetchPages,
  setLastRead,
  surahInfo,
  syncWithServer,
  toArabicDigits,
  toggleBookmark
} from "./quran.js";

let ctx = { getLang: () => "id", getCode: () => "" };
const $ = (id) => document.getElementById(id);
const L = (key, vars) => {
  let s = t(ctx.getLang(), key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
};
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const SCREEN_IDS = ["screen-prayer", "screen-quran"];
let active = null; // "prayer" | "quran" | null
let prayerTimer = null;
let autoReadTimer = null;

export function initFeatures(context) {
  ctx = { ...ctx, ...context };
  $("prayer-back-btn")?.addEventListener("click", () => {
    location.hash = "";
  });
  $("prayer-refresh-btn")?.addEventListener("click", () => refreshLocation(true));
  $("quran-back-btn")?.addEventListener("click", () => {
    if (/^#quran\/p\//.test(location.hash)) location.hash = "quran";
    else location.hash = "";
  });
  $("quran-font-minus")?.addEventListener("click", () => changeFont(-0.125));
  $("quran-font-plus")?.addEventListener("click", () => changeFont(0.125));
  applyFont();
  wireQuranReader();
}

export function hideFeatureScreens() {
  for (const id of SCREEN_IDS) {
    const el = $(id);
    if (el) el.hidden = true;
  }
}

// Dipanggil router setiap pindah rute -- hentikan timer layar fitur.
export function stopFeatures() {
  if (prayerTimer) clearInterval(prayerTimer);
  prayerTimer = null;
  if (autoReadTimer) clearTimeout(autoReadTimer);
  autoReadTimer = null;
  active = null;
}

// Bahasa diganti saat layar fitur terbuka -> gambar ulang bagian dinamis.
export function rerenderFeatures() {
  if (active === "prayer") renderPrayer();
  else if (active === "quran") routeQuran(location.hash);
}

// ================================================================ Jadwal Shalat

let loc = null;
let locNote = "";
let locBusy = false;
let renderedKey = "";

export function showPrayerScreen() {
  stopFeatures();
  active = "prayer";
  $("screen-prayer").hidden = false;
  window.scrollTo(0, 0);

  const saved = loadSavedLocation();
  loc = saved || { ...DEFAULT_LOCATION };
  locNote = "";
  renderedKey = "";
  renderPrayer();

  // Lokasi tersimpan dianggap segar 3 jam; selebihnya cari ulang diam-diam.
  const fresh = saved && Date.now() - (saved.savedAt || 0) < 3 * 3600 * 1000;
  if (!fresh) refreshLocation(false);

  prayerTimer = setInterval(tickPrayer, 1000);
}

async function refreshLocation(manual) {
  if (locBusy) return;
  locBusy = true;
  locNote = L("prayer_locating");
  paintNote();
  try {
    loc = await detectLocation();
    locNote = "";
  } catch (err) {
    const code = err instanceof Error ? err.message : "unavailable";
    const key =
      code === "denied" ? "prayer_loc_denied" : code === "unsupported" ? "prayer_loc_unsupported" : "prayer_loc_unavailable";
    locNote = L(key, { city: loc?.name || DEFAULT_LOCATION.name });
    if (!manual && !loadSavedLocation()) loc = { ...DEFAULT_LOCATION };
  } finally {
    locBusy = false;
  }
  renderedKey = "";
  if (active === "prayer") renderPrayer();
}

function paintNote() {
  const el = $("prayer-note");
  if (!el) return;
  el.textContent = locNote;
  el.hidden = !locNote;
}

function qiblaSvg(deg) {
  return `<svg class="qibla-svg" viewBox="0 0 100 100" width="92" height="92" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="50" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">${L("prayer_north")}</text>
    <g transform="rotate(${deg.toFixed(1)} 50 50)">
      <path d="M50 22 L58 50 L50 46 L42 50 Z" fill="currentColor"/>
      <line x1="50" y1="46" x2="50" y2="76" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </g>
    <circle cx="50" cy="50" r="3" fill="var(--bg)" stroke="currentColor" stroke-width="2"/>
  </svg>`;
}

function renderPrayer() {
  const root = $("prayer-body");
  if (!root || !loc) return;
  const now = new Date();
  const times = getPrayerTimes(now, loc.lat, loc.lng);
  const next = getNextPrayer(now, loc.lat, loc.lng);
  const cur = getCurrentPrayer(now, loc.lat, loc.lng);
  const afterMaghrib = times.maghrib && now >= times.maghrib;
  const hijri = hijriDate(now, !!afterMaghrib);
  const lang = ctx.getLang() === "id" ? "id-ID" : "en-US";
  const dateStr = now.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const q = qiblaBearing(loc.lat, loc.lng);

  const rows = PRAYER_ORDER.map((k) => {
    const isNext = k === next.key && FARDH.includes(k);
    const isCur = k === cur;
    const minor = k === "imsak" || k === "terbit";
    return `<div class="prayer-row${isNext ? " is-next" : ""}${isCur ? " is-current" : ""}${minor ? " is-minor" : ""}">
      <span class="prayer-row-name">${esc(L("p_" + k))}</span>
      <span class="prayer-row-flag">${isNext ? esc(L("prayer_next_short")) : isCur ? esc(L("prayer_now")) : ""}</span>
      <span class="prayer-row-time">${formatClock(times[k])}</span>
    </div>`;
  }).join("");

  root.innerHTML = `
    <section class="prayer-card">
      <div class="prayer-city">${esc(loc.name || "")}</div>
      <div class="prayer-sub">${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} · ${esc(tzLabel(now))}${loc.fallback ? " · " + esc(L("prayer_default_loc")) : ""}</div>
      <div id="prayer-note" class="prayer-note" ${locNote ? "" : "hidden"}>${esc(locNote)}</div>
      <div class="prayer-date">${esc(dateStr)}</div>
      ${hijri ? `<div class="prayer-hijri">${esc(hijri.text)}</div>` : ""}
    </section>
    <section class="prayer-card prayer-next-card">
      <div class="prayer-next-label">${esc(L("prayer_next"))}</div>
      <div class="prayer-next-name">${esc(L("p_" + next.key))}${next.tomorrow ? " (" + esc(L("prayer_tomorrow")) + ")" : ""}</div>
      <div class="prayer-next-time">${formatClock(next.at)}</div>
      <div id="prayer-countdown" class="prayer-countdown">${next.at ? "- " + formatCountdown(next.at - now) : ""}</div>
    </section>
    <section class="prayer-card prayer-times">${rows}</section>
    <section class="prayer-card prayer-qibla">
      <div class="prayer-qibla-text">
        <div class="prayer-next-label">${esc(L("prayer_qibla"))}</div>
        <div class="prayer-qibla-deg">${q.toFixed(1)}° ${cardinal(q)}</div>
        <div class="prayer-sub">${esc(L("prayer_qibla_hint"))}</div>
      </div>
      ${qiblaSvg(q)}
    </section>
    <p class="prayer-foot">${esc(L("prayer_method"))}<br>${esc(L("prayer_hijri_note"))}</p>`;
  renderedKey = `${next.key}|${next.tomorrow}|${cur}|${now.toDateString()}|${loc.lat}|${loc.lng}|${ctx.getLang()}`;
}

function tickPrayer() {
  if (active !== "prayer" || !loc) return;
  const now = new Date();
  const next = getNextPrayer(now, loc.lat, loc.lng);
  const cur = getCurrentPrayer(now, loc.lat, loc.lng);
  const key = `${next.key}|${next.tomorrow}|${cur}|${now.toDateString()}|${loc.lat}|${loc.lng}|${ctx.getLang()}`;
  if (key !== renderedKey) {
    renderPrayer();
    return;
  }
  const el = $("prayer-countdown");
  if (el && next.at) el.textContent = "- " + formatCountdown(next.at - now);
}

// ================================================================ Al-Qur'an

const FONT_KEY = "rh_quran_font";
let fontScale = 1;
let homeTab = "surah";
let surahFilter = "";
let currentPage = null;
let selected = null; // { surah, ayah, page }
let routeToken = 0;

function applyFont() {
  try {
    const v = Number(localStorage.getItem(FONT_KEY));
    if (v >= 0.75 && v <= 2) fontScale = v;
  } catch (_err) {
    /* noop */
  }
  document.documentElement.style.setProperty("--q-scale", String(fontScale));
}

function changeFont(delta) {
  fontScale = Math.min(2, Math.max(0.75, Math.round((fontScale + delta) * 1000) / 1000));
  document.documentElement.style.setProperty("--q-scale", String(fontScale));
  requestAnimationFrame(fitLastLines);
  try {
    localStorage.setItem(FONT_KEY, String(fontScale));
  } catch (_err) {
    /* noop */
  }
}

export function showQuranScreen(hash) {
  stopFeatures();
  active = "quran";
  $("screen-quran").hidden = false;
  routeQuran(hash || "#quran");
}

function routeQuran(hash) {
  const m = hash.match(/^#quran\/p\/(\d{1,3})(?:\/(\d{1,3}):(\d{1,3}))?$/);
  if (m) {
    openReader(clampPage(Number(m[1])), m[2] ? { surah: Number(m[2]), ayah: Number(m[3]) } : null);
  } else {
    openHome();
  }
}

function setQuranTitle(text, reader) {
  $("quran-title").textContent = text;
  $("quran-font-controls").hidden = !reader;
}

const goPage = (page, s, a) => {
  location.hash = `quran/p/${page}${s ? `/${s}:${a}` : ""}`;
};

// ---------------------------------------------------------------- Beranda Qur'an

async function openHome() {
  selected = null;
  currentPage = null;
  $("quran-reader").hidden = true;
  $("quran-reader-bar").hidden = true;
  $("quran-home").hidden = false;
  $("quran-home-controls").hidden = false;
  setQuranTitle(L("quran_title"), false);
  renderHome();
  window.scrollTo(0, 0);

  const code = ctx.getCode();
  if (code) {
    const res = await syncWithServer(code);
    if (res.ok && res.changed && active === "quran" && !$("quran-home").hidden) renderHome();
  }
}

function surahName(n) {
  const s = surahInfo(n);
  return s ? s.name : String(n);
}

function renderHome() {
  const home = $("quran-home");
  const last = getLastRead();
  const code = ctx.getCode();

  const lastCard = last
    ? `<button type="button" class="quran-last" data-go-page="${last.page}" data-go-s="${last.surah}" data-go-a="${last.ayah}">
         <span class="quran-last-label">${esc(L("quran_continue"))}</span>
         <span class="quran-last-name">${esc(surahName(last.surah))} · ${esc(L("quran_ayah"))} ${last.ayah}</span>
         <span class="quran-last-sub">${esc(L("quran_page"))} ${last.page} · ${esc(L("quran_juz"))} ${juzOfPage(last.page)}</span>
       </button>`
    : `<div class="quran-last quran-last--empty">${esc(L("quran_no_last"))}</div>`;

  const controls = $("quran-home-controls");
  controls.innerHTML = `
    ${lastCard}
    <form id="quran-jump" class="quran-jump">
      <input id="quran-jump-input" type="number" inputmode="numeric" min="1" max="${TOTAL_PAGES}" placeholder="${esc(L("quran_page_ph"))}" />
      <button type="submit" class="primary-btn">${esc(L("quran_go"))}</button>
    </form>
    <div class="quran-tabs" role="tablist">
      ${["surah", "juz", "bookmark"]
        .map(
          (k) =>
            `<button type="button" role="tab" class="quran-tab${homeTab === k ? " is-active" : ""}" data-tab="${k}">${esc(L("quran_tab_" + k))}</button>`
        )
        .join("")}
    </div>
    ${homeTab === "surah" ? `<input id="quran-surah-filter" class="quran-filter" type="search" autocomplete="off" placeholder="${esc(L("quran_search_ph"))}" value="${esc(surahFilter)}" />` : ""}`;

  home.innerHTML = `
    <div id="quran-list" class="quran-list"></div>
    <section class="quran-offline" id="quran-offline"></section>
    ${code ? "" : `<p class="prayer-foot">${esc(L("quran_need_code"))}</p>`}`;

  controls.querySelector(".quran-last[data-go-page]")?.addEventListener("click", (e) => {
    const b = e.currentTarget;
    goPage(Number(b.dataset.goPage), Number(b.dataset.goS), Number(b.dataset.goA));
  });
  $("quran-jump").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Number($("quran-jump-input").value);
    if (Number.isFinite(v) && v >= 1) goPage(clampPage(v));
  });
  controls.querySelectorAll(".quran-tab").forEach((b) =>
    b.addEventListener("click", () => {
      homeTab = b.dataset.tab;
      renderHome();
    })
  );
  $("quran-surah-filter")?.addEventListener("input", (e) => {
    surahFilter = e.target.value;
    renderHomeList();
  });
  renderHomeList();
  renderOffline();
}

function renderHomeList() {
  const box = $("quran-list");
  if (!box) return;
  if (homeTab === "surah") {
    const f = surahFilter.trim().toLowerCase();
    const items = SURAHS.filter((s) => !f || s.name.toLowerCase().includes(f) || String(s.number) === f || s.arabic.includes(f));
    box.innerHTML = items
      .map(
        (s) => `<button type="button" class="quran-item" data-page="${s.page}">
            <span class="quran-item-no">${s.number}</span>
            <span class="quran-item-main"><b>${esc(s.name)}</b><small>${s.ayahs} ${esc(L("quran_ayah"))} · ${esc(L("quran_page"))} ${s.page}</small></span>
            <span class="quran-item-ar" dir="rtl" lang="ar">${s.arabic}</span>
          </button>`
      )
      .join("");
  } else if (homeTab === "juz") {
    box.innerHTML = JUZ_START_PAGES.map((p, i) => {
      const first = SURAHS.filter((s) => s.page <= p).pop();
      return `<button type="button" class="quran-item" data-page="${p}">
        <span class="quran-item-no">${i + 1}</span>
        <span class="quran-item-main"><b>${esc(L("quran_juz"))} ${i + 1}</b><small>${esc(L("quran_page"))} ${p}${first ? " · " + esc(first.name) : ""}</small></span>
      </button>`;
    }).join("");
  } else {
    const bms = listBookmarks();
    box.innerHTML = bms.length
      ? bms
          .map(
            (b) => `<div class="quran-item quran-item--bm">
              <button type="button" class="quran-item-hit" data-page="${b.page}" data-s="${b.surah}" data-a="${b.ayah}">
                <span class="quran-item-no">${ICON_BOOKMARK_FILLED}</span>
                <span class="quran-item-main"><b>${esc(surahName(b.surah))} : ${b.ayah}</b><small>${esc(L("quran_page"))} ${b.page} · ${esc(L("quran_juz"))} ${juzOfPage(b.page)}</small></span>
              </button>
              <button type="button" class="icon-btn quran-bm-del" data-s="${b.surah}" data-a="${b.ayah}" title="${esc(L("quran_bookmark_remove"))}" aria-label="${esc(L("quran_bookmark_remove"))}">${ICON_TRASH}</button>
            </div>`
          )
          .join("")
      : `<div class="status-text">${esc(L("quran_bm_empty"))}</div>`;
    box.querySelectorAll(".quran-bm-del").forEach((b) =>
      b.addEventListener("click", () => {
        toggleBookmark({ surah: Number(b.dataset.s), ayah: Number(b.dataset.a), page: 1 }, ctx.getCode());
        renderHomeList();
      })
    );
  }
  box.querySelectorAll(".quran-item[data-page]").forEach((b) => b.addEventListener("click", () => goPage(Number(b.dataset.page))));
  box.querySelectorAll(".quran-item-hit").forEach((b) =>
    b.addEventListener("click", () => goPage(Number(b.dataset.page), Number(b.dataset.s), Number(b.dataset.a)))
  );
}

let downloading = false;

async function renderOffline() {
  const box = $("quran-offline");
  if (!box) return;
  const n = await cachedPageCount();
  if (!$("quran-offline")) return;
  const full = n >= TOTAL_PAGES;
  box.innerHTML = `
    <div class="quran-offline-title">${esc(L("quran_offline_title"))}</div>
    <div class="prayer-sub" id="quran-offline-status">${esc(L("quran_cached_n", { n: String(n), total: String(TOTAL_PAGES) }))}</div>
    ${full ? "" : `<button type="button" id="quran-download-all" class="secondary-btn" ${downloading ? "disabled" : ""}>${esc(L(downloading ? "quran_downloading" : "quran_download_all"))}</button>`}`;
  $("quran-download-all")?.addEventListener("click", async () => {
    if (downloading) return;
    downloading = true;
    const btn = $("quran-download-all");
    btn.disabled = true;
    btn.textContent = L("quran_downloading");
    try {
      await downloadAll();
    } catch (err) {
      const st = $("quran-offline-status");
      if (st) st.textContent = `${L("quran_load_error")} (${err instanceof Error ? err.message : err})`;
      downloading = false;
      if ($("quran-download-all")) {
        $("quran-download-all").disabled = false;
        $("quran-download-all").textContent = L("quran_download_all");
      }
      return;
    }
    downloading = false;
    if (active === "quran") renderOffline();
  });
}

// ---------------------------------------------------------------- Pembaca

async function openReader(page, focus) {
  const token = ++routeToken;
  selected = null;
  currentPage = page;
  $("quran-home").hidden = true;
  $("quran-home-controls").hidden = true;
  const reader = $("quran-reader");
  reader.hidden = false;
  $("quran-reader-bar").hidden = false;
  hideActions();
  const body = $("quran-page-body");
  body.innerHTML = `<div class="status-text">${esc(L("loading"))}</div>`;
  setQuranTitle(L("quran_title"), true);
  window.scrollTo(0, 0);
  updateNav(page);

  let rec;
  try {
    rec = await getPage(page);
  } catch (_err) {
    if (token !== routeToken) return;
    body.innerHTML = `<div class="status-text">${esc(L("quran_load_error"))}</div>
      <div class="quran-retry"><button type="button" id="quran-retry" class="secondary-btn">${esc(L("quran_retry"))}</button></div>`;
    $("quran-retry").addEventListener("click", () => openReader(page, focus));
    return;
  }
  if (token !== routeToken) return;

  const first = rec.ayahs[0];
  renderPageBody(rec, focus);
  prefetchPages([page + 1, page - 1, page + 2]);

  // Auto "terakhir dibaca": setelah 2,5 dtk di halaman ini, kecuali halaman ini
  // sudah tercatat (supaya penanda ayat manual tidak tertimpa).
  if (autoReadTimer) clearTimeout(autoReadTimer);
  autoReadTimer = setTimeout(() => {
    const lr = getLastRead();
    if (active === "quran" && currentPage === page && (!lr || lr.page !== page)) {
      setLastRead({ surah: first.surah, ayah: first.ayah, page }, ctx.getCode());
      refreshMarks();
    }
  }, 2500);
}

function ayahMarks(a) {
  const lr = getLastRead();
  const cls = [];
  if (isBookmarked(a.surah, a.ayah)) cls.push("is-bm");
  if (lr && lr.surah === a.surah && lr.ayah === a.ayah) cls.push("is-last");
  return cls.join(" ");
}

function renderPageBody(rec, focus) {
  const body = $("quran-page-body");
  const blocks = groupBySurah(rec.ayahs);
  const first = rec.ayahs[0];
  const last = rec.ayahs[rec.ayahs.length - 1];
  const firstInfo = surahInfo(first.surah);
  const juz = first.juz ?? juzOfPage(rec.page);
  const hz = hizbLabel(last.hq);

  const headHtml = `<div class="q-page-head">
      <span class="q-page-head-l">${esc(L("quran_juz"))} ${juz}${hz ? ", " + esc(hz) : ""}</span>
      <span class="q-page-head-r"><span>${esc(firstInfo.name)}</span><span dir="rtl" lang="ar" class="q-page-head-ar">${firstInfo.arabic}</span></span>
    </div>`;

  const blocksHtml = blocks
    .map((b) => {
      const info = surahInfo(b.surah);
      const head = b.header
        ? `<div class="q-surah-head"><span class="q-surah-ar" dir="rtl" lang="ar">سورة ${info.arabic}</span><small>${esc(info.name)}</small></div>
           ${b.surah !== 1 && b.surah !== 9 ? `<div class="q-basmalah" dir="rtl" lang="ar">${BASMALAH_TEXT}</div>` : ""}`
        : "";
      const endsSurah = b.ayahs[b.ayahs.length - 1].ayah === info.ayahs;
      const text = b.ayahs
        .map((a, i) => {
          // Tanda awal seperempat hizb (۞) saat hizbQuarter berganti di dalam halaman.
          const prev = i > 0 ? b.ayahs[i - 1] : null;
          const mark = prev && a.hq !== prev.hq ? `<span class="q-hizb" aria-hidden="true">۞</span> ` : "";
          return `${mark}<span class="q-ayah ${ayahMarks(a)}" data-s="${a.surah}" data-a="${a.ayah}">${esc(a.text)}<span class="q-no">${toArabicDigits(a.ayah)}</span></span> `;
        })
        .join("");
      return `${head}<p class="q-text${endsSurah ? " ends-surah" : ""}" dir="rtl" lang="ar">${text}</p>`;
    })
    .join("");

  body.innerHTML = `${headHtml}${blocksHtml}<div class="q-page-foot">${rec.page}</div>`;
  fitLastLines();

  body.querySelectorAll(".q-ayah").forEach((el) =>
    el.addEventListener("click", () => {
      const s = Number(el.dataset.s);
      const a = Number(el.dataset.a);
      if (selected && selected.surah === s && selected.ayah === a) {
        hideActions();
        return;
      }
      selectAyah({ surah: s, ayah: a, page: currentPage });
    })
  );

  if (focus) {
    const el = body.querySelector(`.q-ayah[data-s="${focus.surah}"][data-a="${focus.ayah}"]`);
    if (el) {
      selectAyah({ surah: focus.surah, ayah: focus.ayah, page: currentPage });
      el.scrollIntoView({ block: "center" });
    }
  }
}

// Baris terakhir tiap paragraf: kalau sudah cukup penuh (>= 55% lebar), ratakan
// kanan-kiri seperti baris mushaf; kalau pendek (akhir surah) biarkan/tengahkan.
function fitLastLines() {
  document.querySelectorAll("#quran-page-body .q-text").forEach((p) => {
    p.classList.remove("justify-last");
    const spans = p.querySelectorAll(".q-ayah");
    const lastEl = spans[spans.length - 1];
    if (!lastEl || !p.clientWidth) return;
    const rects = lastEl.getClientRects();
    if (!rects.length) return;
    const r = rects[rects.length - 1];
    if (r.width / p.clientWidth >= 0.55) p.classList.add("justify-last");
  });
}

function refreshMarks() {
  document.querySelectorAll("#quran-page-body .q-ayah").forEach((el) => {
    const s = Number(el.dataset.s);
    const a = Number(el.dataset.a);
    const sel = selected && selected.surah === s && selected.ayah === a;
    el.className = `q-ayah ${ayahMarks({ surah: s, ayah: a })}${sel ? " is-selected" : ""}`;
  });
}

function selectAyah(sel) {
  selected = sel;
  refreshMarks();
  const bar = $("quran-actions");
  bar.hidden = false;
  $("quran-actions-label").textContent = `${surahName(sel.surah)} : ${sel.ayah}`;
  paintActions();
}

function hideActions() {
  selected = null;
  const bar = $("quran-actions");
  if (bar) bar.hidden = true;
  refreshMarks();
}

function paintActions() {
  if (!selected) return;
  const bm = isBookmarked(selected.surah, selected.ayah);
  $("quran-act-bookmark").innerHTML = `${bm ? ICON_BOOKMARK_FILLED : ICON_BOOKMARK}<span>${esc(L(bm ? "quran_bookmark_remove" : "quran_bookmark_add"))}</span>`;
}

function updateNav(page) {
  $("quran-page-input").value = String(page);
  $("quran-page-total").textContent = `/ ${TOTAL_PAGES}`;
  $("quran-nav-prev").disabled = page <= 1;
  $("quran-nav-next").disabled = page >= TOTAL_PAGES;
}

let navWired = false;
export function wireQuranReader() {
  if (navWired) return;
  navWired = true;
  $("quran-nav-prev")?.addEventListener("click", () => currentPage > 1 && goPage(currentPage - 1));
  $("quran-nav-next")?.addEventListener("click", () => currentPage < TOTAL_PAGES && goPage(currentPage + 1));
  $("quran-page-input")?.addEventListener("change", (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v >= 1) goPage(clampPage(v));
    else e.target.value = String(currentPage);
  });
  $("quran-act-bookmark")?.addEventListener("click", () => {
    if (!selected) return;
    toggleBookmark(selected, ctx.getCode());
    paintActions();
    refreshMarks();
  });
  $("quran-act-last")?.addEventListener("click", () => {
    if (!selected) return;
    setLastRead(selected, ctx.getCode());
    refreshMarks();
    const b = $("quran-act-last");
    const old = b.dataset.label || b.textContent;
    b.dataset.label = old;
    b.textContent = L("quran_marked");
    setTimeout(() => {
      b.textContent = old;
    }, 1500);
  });
  $("quran-act-copy")?.addEventListener("click", async () => {
    if (!selected) return;
    const el = document.querySelector(`#quran-page-body .q-ayah[data-s="${selected.surah}"][data-a="${selected.ayah}"]`);
    if (!el) return;
    const txt = `${el.firstChild.textContent.trim()} ﴿${toArabicDigits(selected.ayah)}﴾ (${surahName(selected.surah)}: ${selected.ayah})`;
    try {
      await navigator.clipboard.writeText(txt);
      const b = $("quran-act-copy");
      const old = b.dataset.label || b.textContent;
      b.dataset.label = old;
      b.textContent = L("quran_copied");
      setTimeout(() => {
        b.textContent = old;
      }, 1500);
    } catch (_err) {
      /* clipboard diblokir -- abaikan */
    }
  });
  $("quran-act-close")?.addEventListener("click", hideActions);

  // Geser seperti membalik mushaf (huruf Arab dibaca dari kanan ke kiri):
  // jari bergerak KIRI -> KANAN = halaman berikutnya, KANAN -> KIRI = sebelumnya.
  const reader = $("quran-reader");
  let sx = 0;
  let sy = 0;
  let tracking = false;
  reader?.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      tracking = e.touches.length === 1 && t.clientX > 24 && t.clientX < window.innerWidth - 24; // jangan bentrok dgn gestur tepi layar iOS
      sx = t.clientX;
      sy = t.clientY;
    },
    { passive: true }
  );
  reader?.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      if (String(window.getSelection?.() || "").length > 0) return;
      if (dx > 0 && currentPage < TOTAL_PAGES) goPage(currentPage + 1);
      else if (dx < 0 && currentPage > 1) goPage(currentPage - 1);
    },
    { passive: true }
  );
  window.addEventListener("resize", () => {
    if (active === "quran" && !$("quran-reader").hidden) fitLastLines();
  });
}
