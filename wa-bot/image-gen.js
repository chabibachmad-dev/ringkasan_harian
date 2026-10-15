// ================================================================
// Pembuat GAMBAR (teks -> gambar) lewat Gemini ("Nano Banana"), memakai GEMINI_API_KEYS yang sama dengan bot.
//
// Dipakai di:
//   - grup WhatsApp   : "bot, buatkan gambar kucing memakai topi" (grup yang diizinkan; bisa dimatikan: /gambar grup off)
//   - chat WA pemilik : "buatkan gambar ..." atau "/gambar ..." (chat-ke-diri-sendiri atau chat dengan nomor bot)
//   - Telegram        : /gambar <deskripsi>
//
// Batas harian (hemat kuota, dihitung per hari WITA, tersimpan di bot_state "wa_image_quota"):
//   IMAGE_OWNER_DAILY=30   pemilik       IMAGE_GROUP_DAILY=10   seluruh grup       IMAGE_PERSON_DAILY=3   per orang di grup
//
// .env (semua opsional):
//   GEMINI_IMAGE_MODELS=...  model gambar dicoba berurutan (kosong = bawaan di bawah)
//   IMAGE_TIMEOUT_MS=90000   batas tunggu satu permintaan
//
// Dua jalur panggilan (otomatis mencoba yang cocok, lalu mengingat yang berhasil):
//   1. Interactions API  POST /v1beta/interactions          (jalur resmi model "nano banana" terbaru)
//   2. generateContent   POST /v1beta/models/{m}:generateContent  (cadangan, responseModalities TEXT+IMAGE)
// ================================================================

export const STATE_KEY = "wa_image_gen";
export const QUOTA_KEY = "wa_image_quota";
export const DEFAULT_IMAGE_MODELS = ["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-2.5-flash-image"];
export const DEFAULT_CF_IMAGE_MODELS = ["@cf/black-forest-labs/flux-1-schnell"];
export const DEFAULT_OR_IMAGE_MODELS = ["google/gemini-2.5-flash-image"];
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const splitList = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Akun Cloudflare: pasangan tunggal (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) dan/atau daftar
 * CLOUDFLARE_ACCOUNTS=idAkun1:token1,idAkun2:token2 (jatah gratis dihitung PER AKUN, jadi akun berbeda = jatah berbeda).
 * -> [{ account, token }] tanpa duplikat.
 */
export function parseCfAccounts(env = {}) {
  const out = [];
  const add = (account, token) => {
    const a = String(account || "").trim();
    const t = String(token || "").trim();
    if (/^[A-Za-z0-9]{8,64}$/.test(a) && t.length >= 8 && !out.some((x) => x.account === a)) out.push({ account: a, token: t });
  };
  add(env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN);
  for (const item of String(env.CLOUDFLARE_ACCOUNTS || "").split(",")) {
    const i = item.indexOf(":");
    if (i > 0) add(item.slice(0, i), item.slice(i + 1));
  }
  return out;
}

export function readImageConfig(env = process.env) {
  const num = (v, d, min = 0) => (Number.isFinite(Number(v)) && String(v ?? "").trim() !== "" && Number(v) >= min ? Math.floor(Number(v)) : d);
  const models = splitList(env.GEMINI_IMAGE_MODELS);
  return {
    keys: splitList(env.GEMINI_API_KEYS || env.GEMINI_API_KEY),
    models: models.length ? models : DEFAULT_IMAGE_MODELS,
    cfAccounts: parseCfAccounts(env),
    cfModels: splitList(env.CLOUDFLARE_IMAGE_MODELS).length ? splitList(env.CLOUDFLARE_IMAGE_MODELS) : DEFAULT_CF_IMAGE_MODELS,
    orKeys: splitList(env.OPENROUTER_API_KEYS || env.OPENROUTER_API_KEY),
    orModels: splitList(env.OPENROUTER_IMAGE_MODELS).length ? splitList(env.OPENROUTER_IMAGE_MODELS) : DEFAULT_OR_IMAGE_MODELS,
    timeoutMs: Math.max(10_000, num(env.IMAGE_TIMEOUT_MS, 90_000)),
    ownerDaily: num(env.IMAGE_OWNER_DAILY, 30),
    groupDaily: num(env.IMAGE_GROUP_DAILY, 10),
    personDaily: num(env.IMAGE_PERSON_DAILY, 3),
    promptMax: 600
  };
}

// ---------------------------------------------------------------- mengenali permintaan gambar
const NOUN = "gambar|foto|ilustrasi|image|picture|poster|logo|lukisan|sketsa|kartun|wallpaper|banner|meme|desain|stiker|karikatur|infografis";
const VERB = "buat(?:kan|in|lah)?|bikin(?:kan|in)?|generate|create|ciptakan|render|produce|make";
const FILLER = "(?:tolong|coba|bisa|dong|ya|yah|please|pls|kak|bro|min|bang|mas|mbak|bisa tolong|bisakah|boleh)";
const REQUEST_RE = new RegExp(
  `^(?:${FILLER}[\\s,]+)*(?:${VERB})\\s+(?:(?:sebuah|satu|1|a|an|me|aku|saya|kami|kita|untuk(?:ku| saya| aku)?|dong|ya)\\s+)*(${NOUN})(nya)?\\b(.*)$`,
  "is"
);
const SLASH_RE = /^\/(?:gambar|image|img)(?:@\w+)?(?:\s+(.*))?$/is;
const DRAW_RE = /^(?:(?:tolong|coba|please)\s+)*draw\s+(?:me\s+)?(?:an?\s+|the\s+)?(.{3,})$/is;

/**
 * Teks pengguna -> { prompt } bila ini permintaan membuat gambar (prompt "" = belum ada deskripsi), selain itu null.
 * Sengaja KETAT: "gambar ini apa?" / "kirim gambarnya" / "jelaskan gambaran ekonomi" bukan permintaan membuat gambar.
 */
export function detectImageRequest(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const slash = SLASH_RE.exec(t);
  if (slash) return { prompt: cleanPrompt(slash[1] || "") };
  const draw = DRAW_RE.exec(t);
  if (draw) return { prompt: cleanPrompt(draw[1]) };
  const m = REQUEST_RE.exec(t);
  if (!m) return null;
  const noun = m[1].toLowerCase();
  let rest = m[3] || "";
  // "buatkan gambarnya" / "buatkan gambar ini" -> merujuk gambar lain, bukan deskripsi baru
  if (m[2] || /^\s*(?:ini|itu|tadi)\b/i.test(rest)) rest = "";
  const keepNoun = !["gambar", "image", "picture"].includes(noun);
  const prompt = cleanPrompt(`${keepNoun ? noun + " " : ""}${rest}`.trim());
  return { prompt: keepNoun && prompt === noun ? "" : prompt };
}

/** Rapikan deskripsi: buang kata sambung pembuka ("tentang", "dari", "yang") dan tanda baca di ujung. */
export function cleanPrompt(raw) {
  let p = String(raw ?? "").replace(/\s+/g, " ").trim();
  p = p.replace(/^[\s,:;\-–—]+/, "").replace(/^(?:tentang|mengenai|dari|berupa|bertema|yang|of|about|:)\s+/i, "");
  for (let i = 0; i < 3; i++) p = p.replace(/[\s,;:!.]+(?:dong|ya|yah|deh|nih|please|pls|kak|bro|min|donk)$/i, "");
  p = p.replace(/[\s,;:]+$/, "");
  return p.slice(0, 600).trim();
}

// ---------------------------------------------------------------- filter deskripsi
const BLOCK_RES = [
  /\b(?:telanjang|bugil|porno\w*|bokep|seks(?:ual|i)?|erotis|nsfw|nude|naked|hentai|erotic|genital\w*|payudara|vagina|penis)\b/i,
  /\b(?:palsu|pemalsuan|memalsukan|fake|forge[ds]?|forgery|tiruan)\b.{0,40}\b(?:ktp|ijazah|sertifikat|paspor|passport|kwitansi|struk|nota|surat|dokumen|stempel|cap|materai|meterai|tanda tangan|rekening|bukti transfer|sk)\b/i,
  /\b(?:ktp|ijazah|sertifikat|paspor|passport|kwitansi|struk|nota|stempel|materai|meterai|bukti transfer)\b.{0,40}\b(?:palsu|fake|tiruan|bohongan)\b/i
];

/** -> alasan penolakan (teks siap tampil) atau null bila aman. */
export function promptProblem(prompt) {
  const p = String(prompt ?? "");
  if (BLOCK_RES.some((re) => re.test(p))) return "Maaf, permintaan gambar seperti itu tidak bisa saya buat (konten dewasa atau dokumen/bukti palsu).";
  return null;
}

// ---------------------------------------------------------------- membaca respons Gemini
function mimeFromBytes(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function asImage(o) {
  if (!o || typeof o !== "object") return null;
  // OpenRouter: {type:"image_url", image_url:{url:"data:image/png;base64,...."}}
  const durl = typeof o.url === "string" ? o.url : "";
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(durl);
  if (m && m[2].length >= 400) return { b64: m[2], mime: m[1] };
  const inline = o.inlineData || o.inline_data;
  const src = inline && typeof inline === "object" ? inline : o;
  const data = src.data;
  const mime = src.mimeType || src.mime_type || "";
  if (typeof data !== "string" || data.length < 400) return null;
  if (mime && !/^image\//i.test(mime)) return null;
  if (!mime && !(inline && typeof inline === "object") && o.type !== "image") return null;
  return { b64: data, mime: mime || "" };
}

/** Cari semua gambar & teks di respons (struktur Interactions maupun generateContent). Gambar terakhir dipakai. */
export function parseImageResponse(json) {
  const images = [];
  const texts = [];
  const walk = (node, inThought) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, inThought);
      return;
    }
    const thought = inThought || node.type === "thought" || node.thought === true;
    const img = asImage(node);
    if (img) {
      if (!thought) images.push(img);
      return;
    }
    if (typeof node.text === "string" && !thought && (node.type === "text" || node.type === undefined)) texts.push(node.text);
    for (const k of Object.keys(node)) {
      if (k === "data" || k === "text") continue;
      walk(node[k], thought);
    }
  };
  walk(json, false);
  const last = images[images.length - 1] || null;
  let buffer = null;
  let mime = "";
  if (last) {
    try {
      buffer = Buffer.from(last.b64, "base64");
      mime = mimeFromBytes(buffer) || last.mime || "image/png";
      if (buffer.length < 300) buffer = null;
    } catch {
      buffer = null;
    }
  }
  return { buffer, mime, text: texts.join(" ").replace(/\s+/g, " ").trim() };
}

const BLOCKED_RE = /blockReason|IMAGE_SAFETY|PROHIBITED|"SAFETY"|IMAGE_OTHER|RECITATION|content_filter|safety_block|"blocked"/i;

function errorKind(status, bodyText) {
  const b = String(bodyText || "");
  if (status === 402) return "billing";
  if (/daily free allocation|neurons|4006/i.test(b)) return "quota";
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(b)) return "quota";
  if (/billing|paid|free tier|not available in your|only available.*(paid|billing)|limit: 0/i.test(b) && (status === 403 || status === 400)) return "billing";
  if (status === 401 || status === 403 || /API key (not valid|expired)|PERMISSION_DENIED/i.test(b)) return "auth";
  if (status === 404 || (status === 400 && /not found|not supported|unsupported|unknown (name|field|model)|invalid.*model|INVALID_ARGUMENT/i.test(b))) return "api";
  return "server";
}

export const KIND_TEXT = {
  quota: "Kuota pembuat gambar Gemini sedang habis. Coba lagi nanti.",
  billing: "Pembuat gambar belum bisa dipakai sekarang: kuota gratis habis dan saldo cadangan belum ada. Pemilik sudah diberi tahu.",
  auth: "Kunci Gemini ditolak untuk pembuatan gambar.",
  unavailable: "Pembuat gambar sedang tidak tersedia. Coba lagi sebentar lagi.",
  blocked: "Maaf, gambar itu tidak bisa dibuat (ditolak oleh filter keamanan). Coba deskripsi lain.",
  nokey: "Pembuat gambar belum aktif: isi CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (gratis) atau GEMINI_API_KEYS di .env bot."
};

/** Pesan galat singkat dari respons API (error.message), maks 140 huruf. */
function apiMessage(r) {
  const m = r?.json?.error?.message || r?.json?.error?.status || (typeof r?.raw === "string" ? r.raw : "");
  return String(m).replace(/\s+/g, " ").slice(0, 140);
}

function hariWita(ms) {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

/**
 * deps: { state?: {get,set}, config, fetchImpl?, log?, now? }
 */
export function createImageGen({ state = null, config = readImageConfig({}), fetchImpl = globalThis.fetch, log = console, now = () => Date.now(), translate = null } = {}) {
  let groupsOn = true;
  let quota = { day: hariWita(now()), owner: 0, group: 0, people: {} };
  const apiPref = new Map(); // model -> "interactions" | "generate"
  let rr = 0;

  const cfList = () => config.cfAccounts || [];
  const hasCf = () => cfList().length > 0;
  const cfRest = new Map(); // idAkun -> ms: akun diistirahatkan (jatah harian habis / token ditolak)
  let cfRr = 0;
  const tail = (a) => `…${String(a).slice(-4)}`;
  const available = () => (config.keys.length > 0 || (config.orKeys?.length ?? 0) > 0 || hasCf()) && typeof fetchImpl === "function";

  async function load() {
    if (!state) return groupsOn;
    try {
      const v = await state.get(STATE_KEY);
      groupsOn = v !== "off";
      const q = await state.get(QUOTA_KEY);
      if (q && typeof q === "object" && q.day === hariWita(now())) quota = { day: q.day, owner: q.owner | 0, group: q.group | 0, people: { ...(q.people || {}) } };
    } catch (e) {
      log.warn?.(`🖼️ [Gambar] gagal membaca pengaturan tersimpan: ${e instanceof Error ? e.message : e}`);
    }
    return groupsOn;
  }

  const groupEnabled = () => groupsOn && available();

  async function setGroup(value) {
    groupsOn = Boolean(value);
    let saved = true;
    try {
      await state?.set(STATE_KEY, groupsOn ? "on" : "off");
    } catch {
      saved = false;
    }
    return { on: groupsOn, saved };
  }

  function rollDay() {
    const d = hariWita(now());
    if (quota.day !== d) quota = { day: d, owner: 0, group: 0, people: {} };
  }

  async function saveQuota() {
    try {
      await state?.set(QUOTA_KEY, quota);
    } catch {
      /* hanya berlaku sampai bot restart */
    }
  }

  /**
   * Pesan jatah SEBELUM membuat gambar. kind: "owner" | "group"; who = kunci orang (mis. jid peserta).
   * -> { ok:true, release() } atau { ok:false, reason }
   */
  async function reserve(kind, who = "") {
    rollDay();
    if (kind === "owner") {
      if (config.ownerDaily > 0 && quota.owner >= config.ownerDaily) return { ok: false, reason: `Jatah gambar pemilik hari ini (${config.ownerDaily}) sudah habis. Reset 00.00 WITA.` };
      quota.owner += 1;
    } else {
      if (config.groupDaily > 0 && quota.group >= config.groupDaily) return { ok: false, reason: `Jatah gambar untuk semua grup hari ini (${config.groupDaily}) sudah habis. Coba lagi besok ya.` };
      const key = String(who || "?");
      if (config.personDaily > 0 && (quota.people[key] || 0) >= config.personDaily) return { ok: false, reason: `Jatah gambarmu hari ini (${config.personDaily}) sudah habis. Coba lagi besok ya.` };
      quota.group += 1;
      quota.people[key] = (quota.people[key] || 0) + 1;
    }
    await saveQuota();
    let released = false;
    return {
      ok: true,
      release: async () => {
        if (released) return;
        released = true;
        rollDay();
        if (kind === "owner") quota.owner = Math.max(0, quota.owner - 1);
        else {
          quota.group = Math.max(0, quota.group - 1);
          const key = String(who || "?");
          if (quota.people[key]) quota.people[key] = Math.max(0, quota.people[key] - 1);
        }
        await saveQuota();
      }
    };
  }

  async function post(url, key, body) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
    const raw = await res.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* bukan JSON */
    }
    return { status: res.status, ok: res.ok, raw, json };
  }

  async function callApi(api, model, key, prompt) {
    if (api === "interactions") {
      return post(`${API_BASE}/interactions`, key, { model, input: [{ type: "text", text: prompt }] });
    }
    return post(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, key, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    });
  }

  /**
   * Buat gambar. -> { buffer, mime, model, text }. Galat: Error dengan .kind (quota|billing|auth|blocked|unavailable|nokey) dan pesan siap tampil.
   */
  async function generate(prompt) {
    const details = []; // rincian per penyedia, untuk pemilik (bukan untuk grup)
    const fail = (kind, extra = "") => Object.assign(new Error(KIND_TEXT[kind] + (extra ? ` (${extra})` : "")), { kind, detail: details.join("\n") });
    if (!available()) throw fail("nokey");
    const p = String(prompt ?? "").trim().slice(0, config.promptMax);
    if (!p) throw fail("blocked");
    const seen = new Set();
    let worst = null; // kategori galat terpenting: quota > billing > auth > unavailable
    const rank = { quota: 4, billing: 3, auth: 2, unavailable: 1 };
    const note = (kind) => {
      if (!worst || rank[kind] > rank[worst]) worst = kind;
    };
    // Penyedia GRATIS dulu: Cloudflare Workers AI (FLUX.1 schnell, jatah harian gratis tanpa kartu).
    if (hasCf()) {
      let cfPrompt = p;
      if (translate) {
        // FLUX jauh lebih paham bahasa Inggris: deskripsi diterjemahkan dulu (gagal -> pakai aslinya).
        try {
          const t = String((await translate(p)) ?? "").replace(/\s+/g, " ").trim();
          if (t && t.length <= 800) cfPrompt = t;
        } catch (e) {
          log.warn?.(`🖼️ [Gambar] terjemahan deskripsi gagal, pakai aslinya: ${e instanceof Error ? e.message : e}`);
        }
      }
      const nextUtcMidnight = () => {
        const d = new Date(now());
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      };
      for (const model of config.cfModels || []) {
        const accts = cfList();
        const startAt = cfRr++ % accts.length;
        let triedAny = false;
        for (let i = 0; i < accts.length; i++) {
          const acc = accts[(startAt + i) % accts.length];
          if ((cfRest.get(acc.account) || 0) > now()) continue; // akun sedang istirahat
          triedAny = true;
          let r;
          try {
            const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acc.account)}/ai/run/${model}`, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${acc.token}` },
              body: JSON.stringify({ prompt: cfPrompt, steps: 4 }),
              signal: AbortSignal.timeout(config.timeoutMs)
            });
            const raw = await res.text();
            let json = null;
            try {
              json = JSON.parse(raw);
            } catch {
              /* bukan JSON */
            }
            r = { status: res.status, ok: res.ok, raw, json };
          } catch (e) {
            log.warn?.(`🖼️ [Gambar] Cloudflare ${tail(acc.account)} ${model}: ${e instanceof Error ? e.message : e}`);
            details.push(`Cloudflare ${tail(acc.account)} ${model}: ${e instanceof Error ? e.message : e}`);
            note("unavailable");
            continue;
          }
          const b64 = r.json?.result?.image;
          if (r.ok && typeof b64 === "string" && b64.length > 400) {
            const buffer = Buffer.from(b64, "base64");
            return { buffer, mime: mimeFromBytes(buffer) || "image/jpeg", model: `cloudflare:${model}`, text: "" };
          }
          const kind = r.ok ? "server" : errorKind(r.status, r.raw);
          log.warn?.(`🖼️ [Gambar] Cloudflare ${tail(acc.account)} ${model} HTTP ${r.status} (${kind}): ${String(r.raw).replace(/\s+/g, " ").slice(0, 160)}`);
          details.push(`Cloudflare ${tail(acc.account)} ${model}: HTTP ${r.status} ${kind} — ${apiMessage(r)}`);
          if (/nsfw|moderat|flagged|inappropriate/i.test(r.raw)) throw fail("blocked");
          if (kind === "quota") cfRest.set(acc.account, nextUtcMidnight()); // jatah harian: pulih 00:00 UTC
          else if (kind === "auth") cfRest.set(acc.account, now() + 3600_000);
          note(kind === "api" || kind === "server" ? "unavailable" : kind);
          if (kind === "api") break; // model tidak ada -> model berikutnya
        }
        if (!triedAny) {
          details.push("Cloudflare: semua akun sedang istirahat (jatah harian habis / token ditolak)");
          note("quota");
        }
      }
    }
    const start = config.keys.length ? rr++ % config.keys.length : 0;
    for (const model of config.keys.length ? config.models : []) {
      const apis = apiPref.get(model) === "generate" ? ["generate", "interactions"] : ["interactions", "generate"];
      for (let i = 0; i < config.keys.length; i++) {
        const key = config.keys[(start + i) % config.keys.length];
        let modelMissing = false;
        for (const api of apis) {
          const id = `${model}|${key}|${api}`;
          if (seen.has(id)) continue;
          seen.add(id);
          let r;
          try {
            r = await callApi(api, model, key, p);
          } catch (e) {
            log.warn?.(`🖼️ [Gambar] ${model}/${api}: ${e instanceof Error ? e.message : e}`);
            note("unavailable");
            break;
          }
          if (r.ok) {
            const out = parseImageResponse(r.json ?? {});
            if (out.buffer) {
              apiPref.set(model, api);
              return { buffer: out.buffer, mime: out.mime, model, text: out.text };
            }
            // Berhasil tanpa gambar: ditolak filter / model hanya menjawab teks.
            if (BLOCKED_RE.test(r.raw) || out.text) {
              log.warn?.(`🖼️ [Gambar] ${model}: tanpa gambar${out.text ? ` ("${out.text.slice(0, 80)}")` : ""}`);
              throw fail("blocked");
            }
            note("unavailable");
            break;
          }
          const kind = errorKind(r.status, r.raw);
          log.warn?.(`🖼️ [Gambar] ${model}/${api} HTTP ${r.status} (${kind}): ${String(r.raw).replace(/\s+/g, " ").slice(0, 160)}`);
          if (kind !== "api") details.push(`Gemini ${model}: HTTP ${r.status} ${kind} — ${apiMessage(r)}`);
          if (kind === "api") {
            modelMissing = true;
            continue; // coba jalur panggilan lain untuk model ini
          }
          if (kind === "quota" || kind === "billing" || kind === "auth") {
            note(kind);
            break; // ganti key
          }
          if (/SAFETY|PROHIBITED|blockReason/i.test(r.raw)) throw fail("blocked");
          note("unavailable");
          break;
        }
        if (modelMissing && !worst) note("unavailable");
      }
    }
    // Cadangan: OpenRouter (model gambar berbayar/kredit; dicoba bila Gemini habis/ditolak/tidak ada kunci).
    for (const model of config.orModels || []) {
      for (const key of config.orKeys || []) {
        let r;
        try {
          const res = await fetchImpl(OR_URL, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages: [{ role: "user", content: p }], modalities: ["image", "text"] }),
            signal: AbortSignal.timeout(config.timeoutMs)
          });
          const raw = await res.text();
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* bukan JSON */
          }
          r = { status: res.status, ok: res.ok, raw, json };
        } catch (e) {
          log.warn?.(`🖼️ [Gambar] OpenRouter ${model}: ${e instanceof Error ? e.message : e}`);
          note("unavailable");
          continue;
        }
        if (r.ok) {
          const out = parseImageResponse(r.json ?? {});
          if (out.buffer) return { buffer: out.buffer, mime: out.mime, model: `openrouter:${model}`, text: out.text };
          if (/content_filter|safety|moderation/i.test(r.raw) || out.text) throw fail("blocked");
          note("unavailable");
          continue;
        }
        const kind = errorKind(r.status, r.raw);
        log.warn?.(`🖼️ [Gambar] OpenRouter ${model} HTTP ${r.status} (${kind}): ${String(r.raw).replace(/\s+/g, " ").slice(0, 160)}`);
        details.push(`OpenRouter ${model}: HTTP ${r.status} ${kind} — ${apiMessage(r)}`);
        note(kind === "api" || kind === "server" ? "unavailable" : kind);
        if (kind === "api") break; // model tidak ada -> model berikutnya
      }
    }
    // Gemini habis/ditolak DAN OpenRouter kehabisan saldo: tampilkan sebagai "billing" supaya pemilik tahu harus mengisi saldo.
    if ((config.orKeys?.length ?? 0) > 0 && details.some((d) => /^OpenRouter .*HTTP 402/.test(d)) && (worst === "quota" || worst === "billing" || worst === "auth")) {
      throw fail("billing");
    }
    throw fail(worst || "unavailable");
  }

  /**
   * Satu paket untuk pemanggil: cek deskripsi -> pesan jatah -> buat gambar (jatah dikembalikan bila gagal).
   * -> { image:{buffer,mime,model} } atau { error:"teks siap tampil", kind }
   * kind: "owner" | "group"
   */
  async function make(prompt, kind = "owner", who = "") {
    const p = cleanPrompt(prompt);
    if (!p) return { error: "Mau digambar apa? Contoh: buatkan gambar kucing memakai topi astronot.", kind: "empty" };
    const bad = promptProblem(p);
    if (bad) return { error: bad, kind: "refused" };
    if (!available()) return { error: KIND_TEXT.nokey, kind: "nokey" };
    const slot = await reserve(kind, who);
    if (!slot.ok) return { error: slot.reason, kind: "limit" };
    try {
      return { image: await generate(p) };
    } catch (e) {
      await slot.release().catch(() => {});
      return { error: e instanceof Error ? e.message : String(e), kind: e?.kind || "unavailable", detail: e?.detail || "" };
    }
  }

  function describe() {
    rollDay();
    const sisa = (limit, used) => (limit > 0 ? `${Math.max(0, limit - used)}/${limit}` : "tanpa batas");
    return (
      `grup: ${groupsOn ? "AKTIF" : "mati"} • model: ${config.keys.length ? config.models[0] : "(Gemini tanpa kunci)"}${config.keys.length && config.models.length > 1 ? ` (+${config.models.length - 1} cadangan)` : ""}${hasCf() ? ` • GRATIS: Cloudflare ${config.cfModels[0].split("/").pop()}${cfList().length > 1 ? ` (${cfList().length} akun)` : ""}` : ""}${config.orKeys?.length ? ` • cadangan OpenRouter: ${config.orModels[0]}` : ""}\n` +
      `Sisa jatah hari ini — pemilik: ${sisa(config.ownerDaily, quota.owner)}, semua grup: ${sisa(config.groupDaily, quota.group)} (maks ${config.personDaily || "∞"} per orang)`
    );
  }

  /** Perintah /gambar dari Telegram: tanpa argumen = status; "grup on|off" = saklar; selain itu = deskripsi (ditangani pemanggil). */
  function parseCommand(arg) {
    const a = String(arg ?? "").trim();
    if (!a || /^(?:status|info)$/i.test(a)) return { kind: "status" };
    const m = /^(?:grup|group|wag|wa)?\s*(on|off|aktif|mati|nyala)$/i.exec(a);
    if (m) return { kind: "group", value: /^(?:on|aktif|nyala)$/i.test(m[1]) };
    return { kind: "prompt", prompt: cleanPrompt(a) };
  }

  /** Ganti konfigurasi tanpa restart (dipakai /env). Jatah harian & saklar grup tetap; istirahat akun Cloudflare direset. */
  function reconfigure(next) {
    config = next;
    cfRest.clear();
    apiPref.clear();
  }

  return { available, load, groupEnabled, setGroup, reserve, generate, make, describe, parseCommand, reconfigure, detect: detectImageRequest, problem: promptProblem };
}
