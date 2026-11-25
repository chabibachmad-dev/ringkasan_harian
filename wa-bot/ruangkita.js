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
    replyComments: toBool(env.RUANGKITA_REPLY, true),       // balas komentar di status sendiri
    inbox: toBool(env.RUANGKITA_INBOX, true),               // balas chat/inbox pribadi
    likeOthers: toBool(env.RUANGKITA_LIKE, true),           // suka status orang lain
    commentOthers: toBool(env.RUANGKITA_COMMENT_OTHERS, true), // komentar status orang lain
    mentions: toBool(env.RUANGKITA_MENTIONS, true),         // balas saat di-mention / di-"colek"
    engagePerHour: clamp(toInt(env.RUANGKITA_ENGAGE_PER_HOUR, 4), 0, 30), // maks like+komentar ke orang lain / jam
    // jam aktif lokal (bot "tidur" di luar jam ini, biar manusiawi). "" = sepanjang hari.
    activeFrom: clamp(toInt(env.RUANGKITA_ACTIVE_FROM, 6), 0, 23),
    activeTo: clamp(toInt(env.RUANGKITA_ACTIVE_TO, 23), 0, 23),
    headless: toBool(env.RUANGKITA_HEADLESS, true),
    displayName: (env.RUANGKITA_DISPLAYNAME || "").trim(), // nama tampilan akun (untuk kenali status sendiri)
    riddleRatio: clamp(toInt(env.RUANGKITA_RIDDLE_PCT, 40), 0, 100) / 100, // peluang status jadi tebak-tebakan
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
    async comment({ author = "", text = "" } = {}) {
      const ctx = `Status dari "${author || "warga"}": "${String(text).slice(0, 300)}". Tulis SATU komentar singkat, ramah, nyambung & lucu ala bapak-bapak. Tanpa tanda kutip.`;
      const t = await run(PERSONA_RULES, ctx, 0.85);
      return jadulkan(t || `Mantap ${author || "nak"}! ${pickJoke(random)}`).slice(0, 220);
    },
    async riddle() {
      const t = await run(PERSONA_RULES + "\nKhusus: buat TEBAK-TEBAKAN (riddle) receh bapak-bapak. Format: pertanyaan singkat, lalu ' ...' lalu jawaban yang lucu/plesetan. Nuansa nostalgia warnet/modem/BlackBerry/2009 boleh.",
        "Buat SATU tebak-tebakan lucu bapak-bapak. Tulis HANYA bagian pertanyaan lalu jawaban dipisah ' ...' (tanpa menulis 'Wak Kaji punya tebakan'). Tanpa tanda kutip. Maksimal 2 kalimat.", 0.95);
      const body = t || pickRiddle(random);
      return jadulkan(`Wak Kaji punya tebakan: ${body}`).slice(0, 480);
    },
  };
}

// Cadangan tebak-tebakan lokal (original).
export const RIDDLE_BANK = [
  "Hewan apa yang paling setia nungguin tiap malam tapi gak pernah dibales? ...Notifikasi. Dicuekin tetap muncul :))",
  "Kenapa sinyal warnet dulu mirip mantan? ...Pas dibutuhin ilang, pas udah move on malah full bar.",
  "Benda apa yang makin diisi makin kosong? ...Pulsa, nak.",
  "Apa bedanya kamu sama download 56k? ...Gak ada, sama-sama gagal di 99%.",
  "Kenapa modem jadul gak pernah bohong? ...Soalnya kalau lemot ya ngaku lemot, gak kayak janji.",
  "Kursi apa yang bikin orang betah berjam-jam tanpa gaji? ...Kursi warnet, nak.",
];
export function pickRiddle(random = Math.random) {
  return RIDDLE_BANK[Math.floor(random() * RIDDLE_BANK.length)];
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
  if (["lihat", "intip", "scan"].includes(a)) return { kind: "lihat" };
  if (["fitur", "mode", "aktifkan"].includes(a)) return { kind: "fitur", text: tail };
  if (["post", "status!", "posting", "tulis"].includes(a)) return { kind: "post", text: tail };
  if (["tebak", "tebakan", "teka", "riddle"].includes(a)) return { kind: "tebak" };
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
    // Sudah login bila kotak tulis status (komposer warga) muncul. Tamu hanya melihat
    // "Masuk untuk Menulis Status" tanpa kotak itu, jadi keberadaan kotak = sudah login.
    return await page.evaluate(() => {
      if (document.querySelector('textarea, [placeholder*="pikirkan" i]')) return true;
      const t = document.body.innerText || "";
      return /Perbarui Status/i.test(t) && !/Masuk untuk Menulis Status/i.test(t);
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
    // Form login sidebar selalu tampil untuk tamu: id #sidebar-username / #sidebar-password.
    let user = page.locator("#sidebar-username").first();
    let pass = page.locator("#sidebar-password").first();
    if (!(await user.count())) {
      // kalau tak ada, coba buka lewat tombol "Masuk" lalu pakai placeholder
      const masuk = page.getByRole("button", { name: /^Masuk$/i }).first();
      if (await masuk.count()) { await masuk.click().catch(() => {}); await page.waitForTimeout(1000); }
      user = page.getByPlaceholder(/Username/i).first();
      pass = page.locator('input[type="password"]').first();
    }
    if (!(await user.count()) || !(await pass.count())) throw new Error("Form login (kotak Username/Password) tidak ditemukan di halaman.");
    await user.fill(config.username, { timeout: 15_000 });
    await pass.fill(config.password, { timeout: 15_000 });
    // Submit: tombol di DALAM form yang memuat kotak password (bukan tombol 'Masuk' lain di halaman).
    const form = page.locator("form:has(#sidebar-password)").first();
    const submit = (await form.count())
      ? form.getByRole("button", { name: /Masuk|Login/i }).first()
      : page.getByRole("button", { name: /^(Masuk|Login)$/i }).first();
    if (await submit.count()) await submit.click({ timeout: 10_000 }).catch(() => {});
    else await pass.press("Enter").catch(() => {});
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
  // ---- Pindai kartu kiriman di beranda (nama penulis, teks, tombol, apakah milik kita) ----
  async function scanPosts(me, limit = 20) {
    return await page.evaluate(({ me, limit }) => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      const bars = [...document.querySelectorAll("button")].filter((b) => /^Komentar$/.test(norm(b.innerText)));
      for (const kom of bars) {
        // naik ke kartu: elemen yang memuat tombol Suka+Komentar+Bagikan & nama penulis
        let card = kom, author = "", text = "";
        for (let i = 0; i < 12 && card; i++) {
          card = card.parentElement; if (!card) break;
          const btns = [...card.querySelectorAll("button")].map((b) => norm(b.innerText));
          if (btns.includes("Suka") && btns.includes("Komentar") && btns.includes("Bagikan")) {
            const nameBtn = [...card.querySelectorAll("button")].find((b) => { const t = norm(b.innerText); return t && t.length < 40 && !/^(Suka|Komentar|Bagikan|Colek|Tandai Foto|Lihat)/.test(t); });
            author = nameBtn ? norm(nameBtn.innerText) : "";
            text = norm(card.innerText).replace(/^.*?(Suka · Komentar.*)$/, "");
            break;
          }
        }
        if (!card) continue;
        const idx = out.length;
        card.setAttribute("data-rk-idx", String(idx));
        const liked = !![...card.querySelectorAll("button")].find((b) => /^Suka$/.test(norm(b.innerText)) && /text-\[#3B5998\]|font-bold|aria-pressed/.test(b.className + (b.getAttribute("aria-pressed") || "")));
        out.push({ idx, author, mine: !!me && author.toLowerCase() === me.toLowerCase(), text: norm(card.innerText).slice(0, 200), liked });
        if (out.length >= limit) break;
      }
      return out;
    }, { me, limit }).catch(() => []);
  }
  const cardLoc = (idx) => page.locator(`[data-rk-idx="${idx}"]`).first();

  async function likePost(idx) {
    const card = cardLoc(idx);
    const b = card.getByRole("button", { name: /^Suka$/i }).first();
    if (!(await b.count())) return { ok: false, reason: "tombol Suka tidak ada" };
    await b.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    return { ok: true };
  }

  // Buka kotak komentar sebuah kartu & kembalikan locator kotaknya.
  async function openCommentBox(idx) {
    const card = cardLoc(idx);
    const kom = card.getByRole("button", { name: /^Komentar$/i }).first();
    if (await kom.count()) { await kom.click().catch(() => {}); await page.waitForTimeout(900); }
    // kotak komentar: textarea / input / contenteditable di dalam kartu
    for (const sel of ['textarea', 'input[placeholder*="omentar" i]', 'input[placeholder*="alas" i]', '[contenteditable="true"]']) {
      const box = card.locator(sel).first();
      if (await box.count()) { try { await box.waitFor({ state: "visible", timeout: 2500 }); return box; } catch {} }
    }
    return null;
  }
  async function commentOnPost(idx, text) {
    const box = await openCommentBox(idx);
    if (!box) return { ok: false, reason: "kotak komentar tidak ketemu (perlu verifikasi selector)" };
    await box.click().catch(() => {});
    await box.fill(text, { timeout: 10_000 }).catch(async () => { await box.type(text, { delay: 15 }).catch(() => {}); });
    await page.waitForTimeout(500);
    const card = cardLoc(idx);
    let send = card.getByRole("button", { name: /^(Kirim|Balas|Komentar|Bagikan)$/i }).last();
    if (await send.count()) await send.click({ timeout: 8000 }).catch(() => {});
    else await box.press("Enter").catch(() => {});
    await page.waitForTimeout(1200);
    return { ok: true };
  }

  // Baca komentar pada kartu (untuk balas komentar di status sendiri). Mengembalikan [{who,text}].
  async function readComments(idx) {
    const card = cardLoc(idx);
    const more = card.getByRole("button", { name: /Lihat \d+ komentar/i }).first();
    if (await more.count()) { await more.click().catch(() => {}); await page.waitForTimeout(900); }
    return await cardLoc(idx).evaluate((el) => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      // heuristik: komentar = baris dengan nama tebal + teks, setelah bar aksi
      const items = [];
      const strongs = [...el.querySelectorAll('strong,[class*="font-bold"],[class*="font-semibold"],a')];
      for (const s of strongs) {
        const who = norm(s.innerText); if (!who || who.length > 40) continue;
        const sib = s.parentElement ? norm(s.parentElement.innerText).replace(who, "").trim() : "";
        if (sib && sib.length > 1 && !/^(Suka|Balas|·)/.test(sib)) items.push({ who, text: sib.slice(0, 200) });
      }
      return items.slice(-10);
    }).catch(() => []);
  }

  // Inbox / Obrolan: buka dock, kembalikan ringkasan thread (read-only untuk mode intip).
  async function readInbox() {
    const ob = page.getByRole("button", { name: /Obrolan|Pesan Masuk|Inbox/i }).first();
    if (await ob.count()) { await ob.click().catch(() => {}); await page.waitForTimeout(1200); }
    return await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const nodes = [...document.querySelectorAll('[class*="chat"], [class*="inbox"], [class*="conversation"], li, a')].slice(0, 200);
      const seen = new Set(), out = [];
      for (const n of nodes) {
        const t = norm(n.innerText); if (!t || t.length < 2 || t.length > 120 || seen.has(t)) continue;
        if (/belum ada|tidak ada pesan/i.test(t)) continue;
        seen.add(t); out.push(t);
        if (out.length >= 15) break;
      }
      return out;
    }).catch(() => []);
  }

  // Notifikasi (untuk mention / colek).
  async function readNotifications() {
    const nf = page.getByRole("button", { name: /^Notif$/i }).first();
    if (await nf.count()) { await nf.click().catch(() => {}); await page.waitForTimeout(1200); }
    return await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      for (const n of [...document.querySelectorAll('[class*="notif"] *, li, a')].slice(0, 200)) {
        const t = norm(n.innerText); if (t && t.length > 3 && t.length < 160) out.push(t);
        if (out.length >= 20) break;
      }
      return [...new Set(out)];
    }).catch(() => []);
  }

  async function close() { try { await browser?.close(); } catch {} browser = context = page = null; }
  return { login, readFeed, setBio, postStatus, scanPosts, likePost, commentOnPost, openCommentBox, readComments, readInbox, readNotifications, close, isOpen: () => !!page };
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
  // pembatas terpisah untuk interaksi ke orang lain (like/komentar) biar tidak agresif
  const engageLimiter = createLimiter({ minGapMs: config.minGapMin * 60_000, maxPerHour: config.engagePerHour, postPerDay: 999, now });
  let driver = null;
  let running = false;      // loop hidup
  let enabled = config.enabled;
  let loopHandle = null;
  let lastError = "";
  let lastAction = "";
  let turn = 0;             // untuk rotasi jenis aksi
  const handled = new Set(); // id item yang sudah ditangani (komentar, like, inbox, notif)
  const flags = { replyComments: config.replyComments, inbox: config.inbox, likeOthers: config.likeOthers, commentOthers: config.commentOthers, mentions: config.mentions };
  const hkey = (kind, s) => `${kind}:${String(s).replace(/\s+/g, " ").trim().slice(0, 80).toLowerCase()}`;
  const seen = (k) => handled.has(k);
  const mark = (k) => { handled.add(k); if (handled.size > 800) { const arr = [...handled]; handled.clear(); arr.slice(-500).forEach((x) => handled.add(x)); } };

  async function saveState() {
    try { await state?.set(STATE_KEY, { enabled, acts: limiter.dump(), engageActs: engageLimiter.dump(), minGapMin: config.minGapMin, maxPerHour: config.maxPerHour, flags, handled: [...handled].slice(-500) }); } catch {}
  }
  async function loadState() {
    try {
      const s = await state?.get(STATE_KEY);
      if (s) {
        enabled = !!s.enabled; limiter.load(s.acts); engageLimiter.load(s.engageActs);
        if (s.minGapMin) config.minGapMin = s.minGapMin; if (s.maxPerHour) config.maxPerHour = s.maxPerHour;
        if (s.flags) Object.assign(flags, s.flags);
        if (Array.isArray(s.handled)) s.handled.forEach((k) => handled.add(k));
      }
    } catch {}
  }
  function whoAmI() { return config.displayName || config.username || ""; }
  async function jitterSleep() { await sleep(3000 + Math.round(random() * 9000)); } // jeda 3–12 dtk antar sub-aksi

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

  async function doPost(seed = "", kind = "auto") {
    // kind: "status" | "tebak" | "auto" (auto = sesekali tebak-tebakan)
    const asRiddle = kind === "tebak" || (kind === "auto" && !seed && random() < config.riddleRatio);
    const text = asRiddle ? await persona.riddle() : await persona.status(seed);
    await driver.postStatus(text);
    limiter.record("post"); lastAction = `${asRiddle ? "tebakan" : "post"}: ${text.slice(0, 60)}`; await saveState();
    return text;
  }

  // Balas komentar baru di status SENDIRI (dengan jeda; tiap komentar cuma dibalas sekali).
  async function replyOwnComments(max = 2) {
    const me = whoAmI(); if (!me) return 0;
    const posts = (await driver.scanPosts(me, 25)).filter((p) => p.mine);
    let done = 0;
    for (const p of posts) {
      if (done >= max || !limiter.canAct("reply")) break;
      const comments = await driver.readComments(p.idx);
      for (const cm of comments) {
        if (done >= max) break;
        if (!cm.who || cm.who.toLowerCase() === me.toLowerCase()) continue;
        const k = hkey("c", p.idx + "|" + cm.who + "|" + cm.text);
        if (seen(k)) continue;
        const text = await persona.reply({ author: cm.who, text: cm.text, where: "komentar status saya" });
        await jitterSleep();
        const r = await driver.commentOnPost(p.idx, text);
        mark(k);
        if (r.ok) { limiter.record("reply"); lastAction = `balas komentar ${cm.who}`; done++; await saveState(); }
        else { lastError = "balas komentar: " + (r.reason || "gagal"); break; }
      }
    }
    return done;
  }

  // Suka + sesekali komentar status ORANG LAIN (pakai engageLimiter).
  async function engageOthers(max = 2) {
    const me = whoAmI();
    const posts = (await driver.scanPosts(me, 20)).filter((p) => !p.mine && p.author);
    let done = 0;
    for (const p of posts) {
      if (done >= max || !engageLimiter.canAct()) break;
      const likeKey = hkey("like", p.idx + "|" + p.author + "|" + p.text.slice(0, 40));
      if (flags.likeOthers && !p.liked && !seen(likeKey)) {
        await jitterSleep();
        const r = await driver.likePost(p.idx); mark(likeKey);
        if (r.ok) { engageLimiter.record(); lastAction = `suka status ${p.author}`; done++; await saveState(); }
      }
      // komentar ke orang lain lebih jarang (1 dari ~3) agar natural
      const cKey = hkey("co", p.idx + "|" + p.author + "|" + p.text.slice(0, 40));
      if (flags.commentOthers && !seen(cKey) && random() < 0.34 && engageLimiter.canAct() && done < max) {
        const text = await persona.comment({ author: p.author, text: p.text });
        await jitterSleep();
        const r = await driver.commentOnPost(p.idx, text); mark(cKey);
        if (r.ok) { engageLimiter.record(); lastAction = `komentar ke ${p.author}`; done++; await saveState(); }
        else lastError = "komentar orang lain: " + (r.reason || "gagal");
      }
    }
    return done;
  }

  // Rotasi jenis aksi tiap siklus supaya tidak monoton & tidak nyepam satu kanal.
  async function cycle() {
    if (!enabled) return;
    const t = now();
    if (!withinActiveHours(config, t)) return;        // di luar jam aktif: diam
    try {
      await ensureLogin();
      const kinds = ["post"];
      if (flags.replyComments) kinds.push("reply");
      if (flags.mentions) kinds.push("mention");
      if (flags.inbox) kinds.push("inbox");
      if (flags.likeOthers || flags.commentOthers) kinds.push("engage");
      // mulai dari giliran berikutnya, jalankan maksimal satu jenis yang "boleh" per siklus
      for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[(turn + i) % kinds.length];
        if (kind === "post" && limiter.canAct("post")) { await doPost(); break; }
        if (kind === "reply" && limiter.canAct("reply")) { if (await replyOwnComments(2)) break; }
        if (kind === "mention" && limiter.canAct("reply")) { if (await doMentions(2)) break; }
        if (kind === "inbox" && limiter.canAct("reply")) { if (await doInbox(2)) break; }
        if (kind === "engage" && engageLimiter.canAct()) { if (await engageOthers(2)) break; }
      }
      turn++;
      lastError = "";
    } catch (e) {
      lastError = String(e?.message || e);
      log.warn?.("[ruangkita] siklus gagal:", lastError);
      try { await driver?.close(); } catch {} driver = null;   // paksa login ulang berikutnya
    }
  }

  // Inbox & mention: DETEKSI dulu (balas menyusul setelah struktur login diverifikasi lewat
  // /ruangkita lihat). Sengaja tidak menandai item sebagai "selesai" agar tidak ada yang hilang.
  let pendingInbox = 0, pendingMentions = 0;
  async function doInbox() {
    try { const threads = await driver.readInbox(); pendingInbox = threads.length; } catch {}
    return 0; // belum membalas otomatis
  }
  async function doMentions() {
    try { const n = await driver.readNotifications(); pendingMentions = n.filter((x) => /menyebut|mention|colek|membalas|komentar di|menandai/i.test(x)).length; } catch {}
    return 0; // belum membalas otomatis
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

  const onoff = (b) => (b ? "✅" : "⬜");
  function featureText() {
    return [
      `${onoff(flags.replyComments)} balas komentar di status saya`,
      `${onoff(flags.likeOthers)} suka status orang lain`,
      `${onoff(flags.commentOthers)} komentar status orang lain`,
      `${onoff(flags.inbox)} balas chat/inbox  ${flags.inbox ? "(deteksi dulu)" : ""}`,
      `${onoff(flags.mentions)} balas mention/colek  ${flags.mentions ? "(deteksi dulu)" : ""}`,
    ].join("\n");
  }
  function statusText() {
    const s = limiter.stats(), e = engageLimiter.stats();
    return [
      `🧓 RuangKita — ${enabled ? "AKTIF" : "MATI"}`,
      `Akun: ${config.username || "(belum diisi)"}${config.displayName ? ` (tampil: ${config.displayName})` : ""}`,
      `Jeda min: ${config.minGapMin} mnt · Post: ${s.postsToday}/${config.postPerDay} hari ini · Aksi: ${s.lastHour}/${config.maxPerHour} per jam`,
      `Interaksi ke orang lain: ${e.lastHour}/${config.engagePerHour} per jam`,
      `Jam aktif: ${config.activeFrom}:00–${config.activeTo}:00 WITA`,
      (pendingInbox || pendingMentions) ? `📥 Terdeteksi: ${pendingInbox} chat, ${pendingMentions} mention (balas otomatis menyusul verifikasi)` : "",
      lastAction ? `Terakhir: ${lastAction}` : "",
      lastError ? `⚠️ Error terakhir: ${lastError}` : "",
      "",
      "Fitur:",
      featureText(),
      "",
      "Perintah: on | off | uji | lihat | post [teks] | tebak | fitur <nama> on|off | jeda <mnt> | batas <n> | bio <teks>",
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
        return "🧓 RuangKita AKTIF. Dengan jeda acak & batas aman, bot akan: posting status, balas komentar di status Anda, suka & komentar status orang lain. Chat & mention dideteksi dulu (balas otomatis menyusul verifikasi — jalankan /ruangkita lihat).\n\n" + featureText() + "\n\nPantau: /ruangkita status";
      }
      case "off": { enabled = false; if (loopHandle) { clearTimeout(loopHandle); loopHandle = null; } await saveState(); return "🧓 RuangKita DIMATIKAN. Tidak ada aksi baru. Hidupkan lagi: /ruangkita on"; }
      case "fitur": {
        const parts = (c.text || "").toLowerCase().split(/\s+/);
        const map = { komentar: "replyComments", balas: "replyComments", suka: "likeOthers", like: "likeOthers", komentarorang: "commentOthers", inbox: "inbox", chat: "inbox", mention: "mentions", colek: "mentions" };
        const key = map[parts[0]];
        if (!key) return "Fitur:\n" + featureText() + "\n\nUbah: /ruangkita fitur <komentar|suka|komentarorang|inbox|mention> on|off";
        const val = ["on", "nyala", "aktif", "ya", "1"].includes(parts[1]) ? true : ["off", "mati", "tidak", "0"].includes(parts[1]) ? false : !flags[key];
        flags[key] = val; await saveState();
        return `${val ? "✅ dinyalakan" : "⬜ dimatikan"}: ${parts[0]}\n\n` + featureText();
      }
      case "lihat": {
        try {
          await ensureLogin();
          const me = whoAmI();
          const posts = await driver.scanPosts(me, 15);
          const mine = posts.filter((p) => p.mine), lain = posts.filter((p) => !p.mine);
          let komSaya = [];
          for (const p of mine.slice(0, 3)) { const cs = await driver.readComments(p.idx); komSaya.push(`• status saya: ${p.text.slice(0, 40)}… → ${cs.length} komentar`); }
          const inbox = await driver.readInbox().catch(() => []);
          const notif = await driver.readNotifications().catch(() => []);
          return [
            `🔎 MODE INTIP (tanpa menulis apa pun) — login sebagai ${config.username}`,
            `Nama tampilan terdeteksi: ${me || "(kosong — isi /env RUANGKITA_DISPLAYNAME=Nama Anda agar status sendiri dikenali)"}`,
            ``,
            `Status di beranda: ${posts.length} (punya saya: ${mine.length}, orang lain: ${lain.length})`,
            komSaya.length ? komSaya.join("\n") : "",
            ``,
            `Contoh status orang lain yang bisa disuka/dikomentari:`,
            lain.slice(0, 4).map((p) => `• ${p.author}: ${p.text.replace(/^.*?· /, "").slice(0, 50)}`).join("\n") || "(tidak ada)",
            ``,
            `Inbox terdeteksi (${inbox.length}): ${inbox.slice(0, 4).join(" | ").slice(0, 160) || "-"}`,
            `Notif terdeteksi (${notif.length}): ${notif.slice(0, 4).join(" | ").slice(0, 160) || "-"}`,
            ``,
            `Kalau daftar di atas benar, saya lanjutkan balas inbox & mention otomatis. Nyalakan aksi: /ruangkita on`,
          ].filter((x) => x !== "").join("\n");
        } catch (e) { return `⚠️ Intip gagal: ${String(e?.message || e)}`; }
      }
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
        try { await ensureLogin(); const text = await doPost(c.text || "", c.text ? "status" : "auto"); return `✅ Diposting:\n"${text}"`; }
        catch (e) { return `⚠️ Gagal posting: ${String(e?.message || e)}`; }
      }
      case "tebak": {
        try { await ensureLogin(); const text = await doPost("", "tebak"); return `✅ Diposting:\n"${text}"`; }
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

  return { handle, start, stop, statusText, describe: statusText, isEnabled: () => enabled, _internal: { persona, limiter, engageLimiter, doPost, replyOwnComments, engageOthers, flags, handled } };
}
