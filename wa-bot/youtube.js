// ================================================================
// Klien YouTube Data API v3 (unggah video terjadwal) — tanpa pustaka tambahan, hanya fetch.
//
// Rahasia HANYA dari .env: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (dibuat sekali lewat `node youtube-auth.mjs`).
// Izin yang diminta hanya `youtube.upload` (tidak bisa menghapus/mengubah video atau saluran lain).
// Tidak pernah menulis token ke log; hanya 4 huruf terakhir bila perlu.
//
//   unggah:  POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//            (lalu PUT berkas ke alamat Location). Jadwal tayang: status.privacyStatus="private" + status.publishAt (RFC 3339).
//   sampul:  POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=...  (butuh akun terverifikasi; gagal = tidak fatal)
// Dokumentasi: https://developers.google.com/youtube/v3/docs/videos/insert
// ================================================================
import fs from "node:fs";

const flag = (v, d) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? !["false", "0", "off", "no", "tidak", "mati"].includes(s) : d;
};

export function readYoutubeConfig(env = process.env) {
  return {
    clientId: String(env.YT_CLIENT_ID || "").trim(),
    clientSecret: String(env.YT_CLIENT_SECRET || "").trim(),
    refreshToken: String(env.YT_REFRESH_TOKEN || "").trim(),
    categoryId: String(env.YT_CATEGORY || "27").trim(), // 27 = Education
    language: String(env.YT_LANG || "id").trim(),
    // Konten untuk anak SD -> "dibuat untuk anak" (komentar & iklan personalisasi dinonaktifkan oleh YouTube; aturan COPPA)
    madeForKids: flag(env.YT_MADE_FOR_KIDS, true),
    // Suara narator sintetis (AI): beri label "konten sintetis/diubah" bila true (lebih aman terhadap kebijakan YouTube)
    aiDisclosure: flag(env.YT_AI_DISCLOSURE, true),
    timeoutMs: Number(env.YT_TIMEOUT_MS) > 0 ? Number(env.YT_TIMEOUT_MS) : 120_000
  };
}

export class YoutubeError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = "YoutubeError";
    this.kind = kind; // auth | quota | limit | bad_request | server | network | config
    Object.assign(this, extra);
  }
}

const mask = (s) => (s ? `…${String(s).slice(-4)}` : "(kosong)");

/** Judul YouTube: maks 100 huruf, tanpa < >. */
export function cleanTitle(t) {
  return String(t ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}
/** Deskripsi: maks 5000 byte, tanpa < >. */
export function cleanDescription(d) {
  let s = String(d ?? "").replace(/[<>]/g, "");
  while (Buffer.byteLength(s, "utf8") > 4900) s = s.slice(0, Math.floor(s.length * 0.95));
  return s.trim();
}
/** Tag: total ≤ 450 huruf, tanpa koma/< >, unik. */
export function cleanTags(tags) {
  const out = [];
  let total = 0;
  for (const t of tags || []) {
    const x = String(t).replace(/[<>,]/g, " ").replace(/\s+/g, " ").trim();
    if (!x || out.some((o) => o.toLowerCase() === x.toLowerCase())) continue;
    if (total + x.length + 1 > 450) break;
    out.push(x);
    total += x.length + 1;
  }
  return out;
}

export function classifyYoutubeError(status, body) {
  let reason = "";
  let message = "";
  try {
    const j = typeof body === "string" ? JSON.parse(body) : body;
    reason = j?.error?.errors?.[0]?.reason || j?.error?.status || j?.error || "";
    message = j?.error?.message || j?.error_description || "";
  } catch {
    message = String(body || "").slice(0, 200);
  }
  reason = String(reason);
  if (status === 401 || reason === "invalid_grant" || reason === "authError" || reason === "invalid_client") return new YoutubeError("auth", `Izin YouTube ditolak/kedaluwarsa (${reason || status}). Jalankan ulang: node youtube-auth.mjs`, { status, reason });
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(reason)) return new YoutubeError("quota", "Kuota harian YouTube API habis. Coba lagi besok.", { status, reason });
  if (/uploadLimitExceeded/i.test(reason)) return new YoutubeError("limit", "Batas unggahan harian saluran tercapai. Coba lagi besok.", { status, reason });
  if (status === 403) return new YoutubeError("auth", `YouTube menolak (403 ${reason}): ${message.slice(0, 160)}`, { status, reason });
  if (status >= 500) return new YoutubeError("server", `YouTube sedang bermasalah (HTTP ${status}).`, { status, reason });
  return new YoutubeError("bad_request", `YouTube menolak permintaan (HTTP ${status} ${reason}): ${message.slice(0, 200)}`, { status, reason });
}

/** Waktu tayang (Date atau ISO) -> RFC 3339 UTC tanpa milidetik, atau null. */
export function rfc3339(d) {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export function createYoutube({ config = readYoutubeConfig({}), fetchImpl = globalThis.fetch, readFile = (f) => fs.readFileSync(f), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console } = {}) {
  let token = null; // { value, exp }
  let broken = null; // pesan bila refresh token ditolak
  const stats = { uploads: 0, lastUploadAt: 0, lastError: null };

  const available = () => Boolean(config.clientId && config.clientSecret && config.refreshToken);

  async function withTimeout(url, init = {}, ms = config.timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      throw new YoutubeError("network", `Jaringan ke YouTube gagal: ${String(e?.message || e).slice(0, 120)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function accessToken({ force = false } = {}) {
    if (!available()) throw new YoutubeError("config", "YouTube belum diatur: isi YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN di .env (lihat README).");
    if (!force && token && token.exp - 60_000 > now()) return token.value;
    const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: "refresh_token" });
    const res = await withTimeout("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, 30_000);
    const text = await res.text();
    if (!res.ok) {
      const err = classifyYoutubeError(res.status, text);
      if (err.kind === "auth") broken = err.message;
      throw err;
    }
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new YoutubeError("server", "Jawaban token YouTube bukan JSON.");
    }
    if (!j.access_token) throw new YoutubeError("server", "Jawaban token YouTube tanpa access_token.");
    broken = null;
    token = { value: j.access_token, exp: now() + (Number(j.expires_in) || 3000) * 1000, scope: j.scope || "" };
    return token.value;
  }

  /** Cek izin tanpa mengunggah apa pun: ambil token baru lalu baca tokeninfo (cakupan & sisa umur). */
  async function verify() {
    const at = await accessToken({ force: true });
    const res = await withTimeout(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(at)}`, {}, 20_000);
    const j = await res.json().catch(() => ({}));
    const scopes = String(j.scope || token?.scope || "");
    return { ok: res.ok, scopes: scopes.split(/\s+/).filter(Boolean), canUpload: /youtube\.upload|auth\/youtube(\s|$)/.test(scopes) };
  }

  /**
   * Unggah satu video. publishAt (Date) -> privat lalu tayang otomatis pada waktu itu. Tanpa publishAt -> privat saja
   * (kamu tekan "Publikasikan" sendiri). Mengembalikan { id, url, studioUrl, publishAt }.
   */
  async function upload({ file, title, description = "", tags = [], publishAt = null, madeForKids = config.madeForKids, aiDisclosure = config.aiDisclosure }) {
    const at = await accessToken();
    const data = readFile(file);
    const meta = {
      snippet: { title: cleanTitle(title) || "Video belajar", description: cleanDescription(description), tags: cleanTags(tags), categoryId: config.categoryId, defaultLanguage: config.language, defaultAudioLanguage: config.language },
      status: { privacyStatus: "private", selfDeclaredMadeForKids: !!madeForKids, embeddable: true, license: "youtube", containsSyntheticMedia: !!aiDisclosure }
    };
    const pub = rfc3339(publishAt);
    if (pub) meta.status.publishAt = pub;
    const init = await withTimeout(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      { method: "POST", headers: { authorization: `Bearer ${at}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(data.length), "x-upload-content-type": "video/mp4" }, body: JSON.stringify(meta) },
      60_000
    );
    if (!init.ok) {
      const err = classifyYoutubeError(init.status, await init.text());
      if (err.kind === "auth") token = null;
      stats.lastError = err.message;
      throw err;
    }
    const loc = init.headers.get("location");
    if (!loc) throw new YoutubeError("server", "YouTube tidak memberi alamat unggahan (Location).");
    let last = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const put = await withTimeout(loc, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(data.length) }, body: data }, config.timeoutMs * 3);
        const text = await put.text();
        if (put.ok) {
          let j = {};
          try {
            j = JSON.parse(text);
          } catch {
            /* abaikan */
          }
          if (!j.id) throw new YoutubeError("server", "YouTube menerima berkas tetapi tidak mengembalikan id video.");
          stats.uploads += 1;
          stats.lastUploadAt = now();
          stats.lastError = null;
          return { id: j.id, url: `https://youtu.be/${j.id}`, studioUrl: `https://studio.youtube.com/video/${j.id}/edit`, publishAt: pub };
        }
        last = classifyYoutubeError(put.status, text);
        if (last.kind !== "server") break;
      } catch (e) {
        last = e instanceof YoutubeError ? e : new YoutubeError("network", String(e?.message || e));
        if (last.kind !== "network" && last.kind !== "server") break;
      }
      log.warn?.(`📺 YouTube: unggah percobaan ${attempt} gagal (${last.message}); mengulang...`);
      await sleep(2000 * attempt);
    }
    stats.lastError = last?.message || "unggah gagal";
    throw last || new YoutubeError("server", "unggah gagal");
  }

  /** Sampul kustom (PNG/JPG ≤ 2 MB). Gagal bukan masalah besar (akun harus terverifikasi) -> mengembalikan { ok:false, reason }. */
  async function setThumbnail(videoId, file) {
    try {
      const at = await accessToken();
      const buf = readFile(file);
      const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
      const res = await withTimeout(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: "POST", headers: { authorization: `Bearer ${at}`, "content-type": mime, "content-length": String(buf.length) }, body: buf }, 60_000);
      if (!res.ok) return { ok: false, reason: classifyYoutubeError(res.status, await res.text()).message };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e).slice(0, 160) };
    }
  }

  const status = () => ({ available: available(), broken, clientId: mask(config.clientId), refresh: mask(config.refreshToken), madeForKids: config.madeForKids, aiDisclosure: config.aiDisclosure, ...stats });
  return { available, accessToken, verify, upload, setThumbnail, status };
}
