// ruangkita.js — Bot persona "bapak-bapak lucu" untuk akun RuangKita (ruangkita.online).
//
// PENDEKATAN (Pilihan A): bot login & beraksi lewat TAMPILAN ASLI situs memakai
// peramban (Playwright), persis seperti pemilik akun membuka situsnya sendiri.
// TIDAK menyentuh Firebase/database pembuat situs. Aksi diberi jeda acak + batas
// per jam/hari supaya tidak terasa seperti bot dan tidak nyepam.
//
// Logika murni (config, penjadwal/pembatas, persona, parser perintah) dipisah dari
// driver peramban supaya bisa diuji tanpa membuka peramban (lihat test-ruangkita.mjs).
//
// Kontrol lewat Telegram: /ruangkita (alias /rk)
//   status | on | off | uji | post [teks] | jeda <menit> | batas <n> | bio <teks>
//
// Keterbukaan: bio akun ditandai "dijalankan bot" saat login (RUANGKITA_BIO).

const DEFAULT_URL = "https://ruangkita.online";
const DEFAULT_BIO = "Akun ini dijalankan bot AI (persona bapak-bapak) 🤖 — kelola oleh pemilik.";
const TZ = "Asia/Makassar";

// ---------------------------------------------------------------- util
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const toBool = (v, d = false) => {
  if (v == null || v === "") return d;
  return !["0", "false", "off", "mati", "tidak", "no"].includes(String(v).trim().toLowerCase());
};
const toInt = (v, d) => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : d;
};

export function readRuangkitaConfig(env = process.env) {
  return {
    enabled: toBool(env.RUANGKITA_ENABLED, false),
    url: (env.RUANGKITA_URL || DEFAULT_URL).replace(/\/+$/, ""),
    username: (env.RUANGKITA_USERNAME || "").trim(),
    password: env.RUANGKITA_PASSWORD || "",
    bio: (env.RUANGKITA_BIO || DEFAULT_BIO).slice(0, 160),
    minGapMin: clamp(toInt(env.RUANGKITA_MIN_GAP_MIN, 3), 1, 180),
    maxPerHour: clamp(toInt(env.RUANGKITA_MAX_PER_HOUR, 8), 1, 60),
    postPerDay: clamp(toInt(env.RUANGKITA_POST_PER_DAY, 3), 0, 40),
    reply: toBool(env.RUANGKITA_REPLY, true),       // balas komentar di status sendiri + chat inbox
    likeOthers: toBool(env.RUANGKITA_LIKE, true),   // suka/komentar status orang lain
    // jam aktif lokal (bot "tidur" di luar jam ini, biar manusiawi). "" = sepanjang hari.
    activeFrom: clamp(toInt(env.RUANGKITA_ACTIVE_FROM, 6), 0, 23),
    activeTo: clamp(toInt(env.RUANGKITA_ACTIVE_TO, 23), 0, 23),
    headless: toBool(env.RUANGKITA_HEADLESS, true),
  };
}

// ---------------------------------------------------------------- jam lokal
export function localHour(ts, timeZone = TZ) {
  const s = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(new Date(ts));
  return toInt(s, 0);
}
export function withinActiveHours(cfg, ts) {
  const h = localHour(ts);
  if (cfg.activeFrom === cfg.activeTo) return true;
  if (cfg.activeFrom < cfg.activeTo) return h >= cfg.activeFrom && h <= cfg.activeTo;
  return h >= cfg.activeFrom || h <= cfg.activeTo; // rentang melintasi tengah malam
}

// ---------------------------------------------------------------- pembatas aksi
// Mencatat waktu tiap aksi; menjaga jeda minimum, batas per jam, dan batas post per hari.
export function createLimiter({ minGapMs, maxPerHour, postPerDay, now = () => Date.now() } = {}) {
  let acts = [];        // {t, kind}
  const prune = (t) => { acts = acts.filter((a) => t - a.t < 24 * 3600_000); };
  const sameLocalDay = (a, b) => localHour(a) >= 0 &&
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(a)) ===
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(b));
  return {
    canAct(kind = "any") {
      const t = now(); prune(t);
      if (acts.length) { const last = acts[acts.length - 1].t; if (t - last < minGapMs) return false; }
      const lastHour = acts.filter((a) => t - a.t < 3600_000).length;
      if (lastHour >= maxPerHour) return false;
      if (kind === "post" && postPerDay >= 0) {
        const today = acts.filter((a) => a.kind === "post" && sameLocalDay(a.t, t)).length;
        if (today >= postPerDay) return false;
      }
      return true;
    },
    record(kind = "any") { const t = now(); prune(t); acts.push({ t, kind }); },
    stats() {
      const t = now(); prune(t);
      return {
        lastHour: acts.filter((a) => t - a.t < 3600_000).length,
        postsToday: acts.filter((a) => a.kind === "post" && sameLocalDay(a.t, t)).length,
        lastActionMsAgo: acts.length ? t - acts[acts.length - 1].t : null,
      };
    },
    load(list) { if (Array.isArray(list)) acts = list.filter((a) => a && typeof a.t === "number").slice(-200); },
    dump() { return acts.slice(-200); },
  };
}

export function pickDelayMs(minMin, random = Math.random) {
  // jeda acak antara minMin dan ~2.4x minMin menit, supaya tidak berpola
  const lo = minMin, hi = Math.max(minMin + 2, Math.round(minMin * 2.4));
  return Math.round((lo + random() * (hi - lo)) * 60_000);
}

// ---------------------------------------------------------------- persona
const JADUL_MAP = [
  [/😂|🤣/g, " :))"], [/😊|🙂|😄|😁/g, " :)"], [/😉/g, " ;)"], [/😢|😭/g, " :(("],
  [/😮|😲/g, " :o"], [/😎/g, " B)"], [/👍/g, " (Y)"], [/❤️|💕|😍/g, " <3"], [/🙏/g, " m(_ _)m"],
];
// Ubah emoji modern jadi emotikon ala 2009 (menjaga nuansa situs).
export function jadulkan(text) {
  let t = String(text || "");
  for (const [re, rep] of JADUL_MAP) t = t.replace(re, rep);
  return t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

const PERSONA_RULES = `Kamu "Wak", bapak-bapak Indonesia yang lucu dan hangat di jejaring sosial gaya 2009 (RuangKita).
Gaya: guyonan bapak-bapak (dad jokes), plesetan, nasihat santai, kadang nyeletuk soal warnet/modem/BlackBerry/Friendster.
Aturan:
- Bahasa Indonesia santai, ramah, sopan. Panggil lawan bicara "nak" atau "bolo" sesekali, jangan tiap kalimat.
- SINGKAT: status maks 2 kalimat, balasan 1 kalimat. Jangan ceramah.
- Boleh garing, tapi tidak kasar, tidak menyinggung SARA/fisik, tidak politik, tidak menggurui soal agama.
- Jangan pakai tagar berderet, jangan jualan, jangan sok bijak berlebihan.
- Jangan mengaku AI di dalam teks (keterbukaan sudah di bio). Tulis seperti manusia iseng yang baik hati.
- Jangan pakai emoji; nanti sistem yang menambah emotikon jadul.`;

// Cadangan lokal bila LLM gagal (semua original, bukan kutipan).
export const JOKE_BANK = [
  "Hujan-hujan gini enaknya mikirin masa depan, eh keburu ngantuk.",
  "Dulu Wak kira 'cloud' itu mendung, taunya tempat nyimpen foto.",
  "Kopi tubruk itu filosofi nak: pahitnya di bawah, tinggal diaduk biar rata.",
  "Wak nggak gaptek, cuma hp-nya aja yang nggak ngerti maksud Wak.",
  "Sabar itu kayak pulsa: kelihatan abis, taunya masih ada sisa buat sekali lagi.",
  "Jangan galau terus nak, nanti kuota galaunya habis buat yang nggak penting.",
  "Rejeki itu kayak sinyal warnet, kadang penuh kadang satu bar, tapi nggak pernah bener-bener hilang.",
  "Wak mau update status, tapi hidup Wak udah stabil, nggak ada yang perlu di-refresh.",
];
export function pickJoke(random = Math.random) {
  return JOKE_BANK[Math.floor(random() * JOKE_BANK.length)];
}

// Buat teks status / balasan lewat LLM (generate = llmFallback.generate), fallback ke bank joke.
export function createPersona({ generate, random = Math.random, log = console } = {}) {
  const run = async (system, user, temp) => {
    if (!generate) return null;
    try {
      const r = await generate({ system, messages: [{ role: "user", content: user }], temperature: temp, timeoutMs: 30_000, maxTries: 2 });
      const t = String(r?.text || "").trim();
      return t ? t : null;
    } catch (e) { log.warn?.("[ruangkita] LLM gagal:", String(e?.message || e)); return null; }
  };
  return {
    async status(seed = "") {
      const topik = seed || "bikin status receh soal kehidupan sehari-hari (kopi, hujan, kerjaan, warnet, masa muda)";
      const t = await run(PERSONA_RULES, `Tulis SATU status lucu bapak-bapak untuk diposting. Topik: ${topik}. Maksimal 2 kalimat, tanpa tanda kutip.`, 0.9);
      return jadulkan(t || pickJoke(random)).slice(0, 480);
    },
    async reply({ author = "", text = "", where = "komentar" } = {}) {
      const ctx = `Seseorang bernama "${author || "warga"}" menulis di ${where}: "${String(text).slice(0, 300)}". Balas dengan SATU kalimat lucu & ramah ala bapak-bapak. Tanpa tanda kutip.`;
      const t = await run(PERSONA_RULES, ctx, 0.85);
      return jadulkan(t || `Wah ${author || "nak"}, sabar ya. ${pickJoke(random)}`).slice(0, 300);
    },
  };
}

// ---------------------------------------------------------------- parser perintah Telegram
export function parseCommand(arg = "") {
  const raw = String(arg || "").trim();
  const [head, ...rest] = raw.split(/\s+/);
  const a = (head || "").toLowerCase();
  const tail = rest.join(" ").trim();
  if (!a || ["status", "info", "?"].includes(a)) return { kind: "status" };
  if (["on", "nyala", "aktif", "mulai"].includes(a)) return { kind: "on" };
  if (["off", "mati", "stop", "berhenti"].includes(a)) return { kind: "off" };
  if (["uji", "test", "cek", "dryrun"].includes(a)) return { kind: "uji" };
  if (["post", "status!", "posting", "tulis"].includes(a)) return { kind: "post", text: tail };
  if (["jeda", "gap"].includes(a)) return { kind: "jeda", min: toInt(tail, NaN) };
  if (["batas", "limit"].includes(a)) return { kind: "batas", n: toInt(tail, NaN) };
  if (["bio"].includes(a)) return { kind: "bio", text: tail };
  return { kind: "unknown", raw };
}

// ---------------------------------------------------------------- driver peramban (Playwright, lazy)
// Dipisah supaya modul tetap bisa dimuat & diuji walau Playwright belum terpasang.
// Selector berbasis teks/peran agar tahan perubahan kecil; bila situs berubah, sesuaikan di sini.
export function createDriver({ config, log = console }) {
  let browser = null, context = null, page = null, chromium = null;
  async function ensureLib() {
    if (chromium) return chromium;
    try { ({ chromium } = await import("playwright")); }
    catch { throw new Error("Playwright belum terpasang. Di folder wa-bot jalankan: npm i playwright && npx playwright install chromium"); }
    return chromium;
  }
  async function open() {
    if (page) return page;
    await ensureLib();
    browser = await chromium.launch({ headless: config.headless, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    context = await browser.newContext({ locale: "id-ID", viewport: { width: 1000, height: 900 } });
    page = await context.newPage();
    return page;
  }
  async function loggedIn() {
    // Sudah login bila komposer status muncul & bukan ajakan "Masuk untuk Menulis Status".
    return await page.evaluate(() => {
      const t = document.body.innerText || "";
      if (/Masuk untuk Menulis Status/i.test(t)) return false;
      return /Perbarui Status|Apa yang sedang Anda pikirkan/i.test(t) ||
        !!document.querySelector('textarea, [placeholder*="pikirkan" i]');
    }).catch(() => false);
  }
  // Pastikan komposer status terbuka & kembalikan locator kotak teksnya.
  async function openComposer() {
    // kotak teks berdasarkan placeholder (lebih tahan perubahan daripada tag)
    const byPlaceholder = page.getByPlaceholder(/Apa yang sedang Anda pikirkan/i).first();
    try { await byPlaceholder.waitFor({ state: "visible", timeout: 8000 }); return byPlaceholder; } catch {}
    // kalau belum muncul, coba klik pemicunya (judul/teks komposer), lalu tunggu lagi
    for (const name of [/Perbarui Status/i, /Apa yang sedang Anda pikirkan/i, /Status Saya/i]) {
      const trg = page.getByText(name).first();
      if (await trg.count()) { await trg.click().catch(() => {}); await page.waitForTimeout(800); }
      if (await byPlaceholder.count()) { try { await byPlaceholder.waitFor({ state: "visible", timeout: 4000 }); return byPlaceholder; } catch {} }
    }
    const ta = page.locator('textarea, input[placeholder*="pikirkan" i]').first();
    if (await ta.count()) return ta;
    return null;
  }
  async function failureReason() {
    return await page.evaluate(() => {
      const t = (document.body.innerText || "");
      if (/Verify you are human|Cloudflare|Checking your browser|Sedang memeriksa/i.test(t)) return "situs menampilkan tantangan Cloudflare";
      const m = t.match(/Password yang Anda masukkan salah|belum terdaftar|Username dan password wajib|Gagal masuk[^.\n]*/i);
      if (m) return m[0];
      return "";
    }).catch(() => "");
  }
  async function login() {
    await open();
    await page.goto(config.url + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    if (await loggedIn()) return { ok: true, already: true };
    if (!config.username || !config.password) throw new Error("RUANGKITA_USERNAME / RUANGKITA_PASSWORD belum diisi di .env");
    // buka form masuk bila perlu
    const masuk = page.getByRole("button", { name: /^Masuk$/i }).first();
    if (await masuk.count()) { await masuk.click().catch(() => {}); await page.waitForTimeout(1000); }
    // Target kotak username SPESIFIK lewat placeholder "Username (wajib)" — jangan kotak pencarian.
    let user = page.getByPlaceholder(/Username/i).first();
    if (!(await user.count())) user = page.locator('input#sidebar-username, input[name="username"], input[autocomplete*="username"]').first();
    let pass = page.getByPlaceholder(/^Password/i).first();
    if (!(await pass.count())) pass = page.locator('input[type="password"]').first();
    if (!(await user.count()) || !(await pass.count())) throw new Error("Form login (kotak Username/Password) tidak ditemukan di halaman.");
    await user.fill(config.username, { timeout: 15_000 });
    await pass.fill(config.password, { timeout: 15_000 });
    // tombol "Masuk" di dalam form (submit)
    const submit = page.getByRole("button", { name: /^(Masuk|Login)$/i }).last();
    if (await submit.count()) await submit.click().catch(() => {}); else await pass.press("Enter").catch(() => {});
    // tunggu hasil: entah komposer muncul, atau pesan error
    await page.waitForFunction(() => {
      const t = document.body.innerText || "";
      return /Perbarui Status|Apa yang sedang Anda pikirkan/i.test(t) ||
        /Password yang Anda masukkan salah|belum terdaftar|Gagal masuk|Verify you are human|Cloudflare/i.test(t) ||
        !!document.querySelector('[placeholder*="pikirkan" i]');
    }, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (await loggedIn()) return { ok: true, already: false };
    const why = await failureReason();
    throw new Error(`Login gagal${why ? " — " + why : " — cek username/password"}. Coba /ruangkita uji lagi.`);
  }
  async function readFeed(limit = 12) {
    // Ringkasan beranda untuk mode uji: nama + cuplikan status teratas (read-only).
    return await page.evaluate((lim) => {
      const out = [];
      const blocks = Array.from(document.querySelectorAll("article, [class*='status'], [class*='post']")).slice(0, 60);
      for (const b of blocks) {
        const txt = (b.innerText || "").replace(/\s+/g, " ").trim();
        if (txt.length > 12) out.push(txt.slice(0, 160));
        if (out.length >= lim) break;
      }
      if (!out.length) return (document.body.innerText || "").split("\n").map((s) => s.trim()).filter((s) => s.length > 12).slice(0, lim);
      return out;
    }, limit).catch(() => []);
  }
  async function setBio(bio) {
    // Best-effort: dicoba lewat Edit Profil. Bila gagal, laporkan agar diisi manual sekali.
    try {
      await page.goto(config.url + "/", { waitUntil: "domcontentloaded" });
      const edit = page.getByRole("link", { name: /Edit Profil|Profil Saya/i }).first();
      if (await edit.count()) { await edit.click().catch(() => {}); await page.waitForTimeout(1500); }
      const area = page.locator('textarea').filter({ hasText: "" }).first();
      if (await area.count()) { await area.fill(bio).catch(() => {}); const simpan = page.getByRole("button", { name: /Simpan|Update/i }).first(); if (await simpan.count()) await simpan.click().catch(() => {}); return { ok: true }; }
      return { ok: false, reason: "form bio tidak ditemukan" };
    } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
  }
  async function postStatus(text) {
    await page.goto(config.url + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    if (!(await loggedIn())) throw new Error("Sesi belum login saat akan posting. Coba /ruangkita uji dulu.");
    const box = await openComposer();
    if (!box) throw new Error("Kotak tulis status tidak ditemukan (komposer tidak terbuka).");
    await box.click().catch(() => {});
    await box.fill(text, { timeout: 15_000 });
    await page.waitForTimeout(700);
    // tombol kirim: "Bagikan" (utama), atau sinonim; harus aktif (tidak disabled)
    let kirim = page.getByRole("button", { name: /^Bagikan$/i }).first();
    if (!(await kirim.count())) kirim = page.getByRole("button", { name: /Bagikan|Kirim|Posting|Perbarui/i }).first();
    if (!(await kirim.count())) throw new Error('Tombol "Bagikan" tidak ditemukan.');
    await kirim.click({ timeout: 10_000 });
    // tunggu sampai "Membagikan..." selesai / kotak kosong lagi
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !/Membagikan\.\.\./i.test(document.body.innerText || ""), { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return { ok: true };
  }
  async function close() { try { await browser?.close(); } catch {} browser = context = page = null; }
  return { login, readFeed, setBio, postStatus, close, isOpen: () => !!page };
}

// ---------------------------------------------------------------- orkestrator + kontrol Telegram
export function createRuangkita({
  config = readRuangkitaConfig(),
  generate = null,
  state = null,                 // { get(key), set(key,value) } -> KV bot_state
  driverFactory = createDriver,
  log = console,
  now = () => Date.now(),
  random = Math.random,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const STATE_KEY = "ruangkita";
  const persona = createPersona({ generate, random, log });
  const limiter = createLimiter({ minGapMs: config.minGapMin * 60_000, maxPerHour: config.maxPerHour, postPerDay: config.postPerDay, now });
  let driver = null;
  let running = false;      // loop hidup
  let enabled = config.enabled;
  let loopHandle = null;
  let lastError = "";
  let lastAction = "";

  async function saveState() { try { await state?.set(STATE_KEY, { enabled, acts: limiter.dump(), minGapMin: config.minGapMin, maxPerHour: config.maxPerHour }); } catch {} }
  async function loadState() {
    try {
      const s = await state?.get(STATE_KEY);
      if (s) { enabled = !!s.enabled; limiter.load(s.acts); if (s.minGapMin) config.minGapMin = s.minGapMin; if (s.maxPerHour) config.maxPerHour = s.maxPerHour; }
    } catch {}
  }

  // Ambil kredensial & bio terbaru dari process.env (supaya /env berlaku tanpa restart).
  function refreshCreds() {
    if (process.env.RUANGKITA_USERNAME != null) config.username = String(process.env.RUANGKITA_USERNAME).trim();
    if (process.env.RUANGKITA_PASSWORD != null) config.password = String(process.env.RUANGKITA_PASSWORD);
    if (process.env.RUANGKITA_BIO) config.bio = String(process.env.RUANGKITA_BIO).slice(0, 160);
  }
  async function ensureDriver() { if (!driver) driver = driverFactory({ config, log }); return driver; }
  async function ensureLogin() {
    refreshCreds();
    await ensureDriver();
    const r = await driver.login();
    if (!r.already) { const b = await driver.setBio(config.bio); if (!b.ok) log.warn?.("[ruangkita] bio belum terpasang otomatis:", b.reason); }
    return r;
  }

  async function doPost(seed = "") {
    const text = await persona.status(seed);
    await driver.postStatus(text);
    limiter.record("post"); lastAction = `post: ${text.slice(0, 60)}`; await saveState();
    return text;
  }

  async function cycle() {
    if (!enabled) return;
    const t = now();
    if (!withinActiveHours(config, t)) return;        // di luar jam aktif: diam
    if (!limiter.canAct("post")) return;
    try {
      await ensureLogin();
      // v1: aksi utama = posting status berkala. Balas komentar/inbox & like ditambah
      // setelah selector balasan diverifikasi lewat mode uji (lihat catatan modul).
      if (limiter.canAct("post")) await doPost();
      lastError = "";
    } catch (e) {
      lastError = String(e?.message || e);
      log.warn?.("[ruangkita] siklus gagal:", lastError);
      try { await driver?.close(); } catch {} driver = null;   // paksa login ulang berikutnya
    }
  }

  function scheduleNext() {
    if (!running) return;
    const delay = pickDelayMs(config.minGapMin, random);
    loopHandle = setTimeout(async () => { await cycle(); scheduleNext(); }, delay);
    if (loopHandle.unref) loopHandle.unref();
  }

  async function start() {
    await loadState();
    running = true;
    if (enabled) { log.info?.(`🧓 RuangKita bot: AKTIF (${config.username || "username belum diisi"})`); scheduleNext(); }
    else log.info?.("🧓 RuangKita bot: siaga (mati). Nyalakan: /ruangkita on");
  }
  function stop() { running = false; if (loopHandle) clearTimeout(loopHandle); }

  function statusText() {
    const s = limiter.stats();
    return [
      `🧓 RuangKita — ${enabled ? "AKTIF" : "MATI"}`,
      `Akun: ${config.username || "(RUANGKITA_USERNAME belum diisi)"}`,
      `Jeda min: ${config.minGapMin} mnt · Batas: ${config.maxPerHour}/jam · Post: ${s.postsToday}/${config.postPerDay} hari ini`,
      `Jam aktif: ${config.activeFrom}:00–${config.activeTo}:00 WITA`,
      `Aksi 1 jam terakhir: ${s.lastHour} · ${s.lastActionMsAgo != null ? Math.round(s.lastActionMsAgo / 60000) + " mnt lalu" : "belum ada"}`,
      lastAction ? `Terakhir: ${lastAction}` : "",
      lastError ? `⚠️ Error terakhir: ${lastError}` : "",
      "",
      "Perintah: /ruangkita on | off | uji | post [teks] | jeda <mnt> | batas <n>/jam | bio <teks>",
    ].filter(Boolean).join("\n");
  }

  async function handle(arg) {
    refreshCreds();
    const c = parseCommand(arg);
    switch (c.kind) {
      case "status": return statusText();
      case "on": {
        if (!config.username || !config.password) return "⚠️ Isi dulu RUANGKITA_USERNAME & RUANGKITA_PASSWORD lewat /env, lalu /ruangkita on.";
        enabled = true; await saveState();
        if (running && !loopHandle) scheduleNext();
        return "🧓 RuangKita AKTIF. Bot akan posting berkala dengan jeda acak & batas aman. Pantau: /ruangkita status";
      }
      case "off": { enabled = false; if (loopHandle) { clearTimeout(loopHandle); loopHandle = null; } await saveState(); return "🧓 RuangKita DIMATIKAN. Tidak ada aksi baru. Hidupkan lagi: /ruangkita on"; }
      case "uji": {
        try {
          const r = await ensureLogin();
          const feed = await driver.readFeed(8);
          return `✅ Login OK${r.already ? " (sesi lama masih jalan)" : ""} sebagai ${config.username}.\nBeranda kebaca (${feed.length} status teratas):\n` +
            feed.map((f, i) => `${i + 1}. ${f}`).join("\n") +
            "\n\nIni mode UJI (tanpa posting). Kalau beranda kebaca benar, lanjut: /ruangkita post (coba 1 status) atau /ruangkita on.";
        } catch (e) { return `⚠️ Uji gagal: ${String(e?.message || e)}`; }
      }
      case "post": {
        try { await ensureLogin(); const text = await doPost(c.text || ""); return `✅ Diposting:\n"${text}"`; }
        catch (e) { return `⚠️ Gagal posting: ${String(e?.message || e)}`; }
      }
      case "jeda": {
        if (!Number.isFinite(c.min) || c.min < 1) return "Pakai: /ruangkita jeda 5  (jeda minimum 5 menit antar aksi)";
        config.minGapMin = clamp(c.min, 1, 180); await saveState(); return `⏱️ Jeda minimum antar aksi: ${config.minGapMin} menit.`;
      }
      case "batas": {
        if (!Number.isFinite(c.n) || c.n < 1) return "Pakai: /ruangkita batas 8  (maks 8 aksi per jam)";
        config.maxPerHour = clamp(c.n, 1, 60); await saveState(); return `🚦 Batas aksi: ${config.maxPerHour} per jam.`;
      }
      case "bio": {
        if (!c.text) return `Bio sekarang: "${config.bio}". Ubah: /ruangkita bio <teks baru>`;
        config.bio = c.text.slice(0, 160);
        try { await ensureLogin(); const b = await driver.setBio(config.bio); return b.ok ? `✅ Bio diperbarui: "${config.bio}"` : `Bio disimpan untuk dipakai nanti, tapi belum terpasang di situs: ${b.reason}`; }
        catch (e) { return `Bio disimpan. Belum bisa dipasang sekarang: ${String(e?.message || e)}`; }
      }
      default: return "Perintah RuangKita tidak dikenal.\n" + statusText();
    }
  }

  return { handle, start, stop, statusText, describe: statusText, isEnabled: () => enabled, _internal: { persona, limiter, doPost } };
}
