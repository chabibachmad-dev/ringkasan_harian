// Statistik penyedia AI untuk perintah /penyedia (Telegram + WhatsApp pemilik).
//
// Hanya MENCATAT hasil panggilan (berhasil / gagal / kena batas) per penyedia: Gemini, Groq, OpenRouter, Ollama, pencarian web.
// Tidak pernah menyimpan isi percakapan, prompt, atau key (hanya 4 karakter terakhir key sebagai "keyHint", untuk menghitung
// berapa key yang sedang istirahat). Pesan galat dibersihkan dari pola rahasia lalu dipotong. Semua di memori proses:
// restart bot = hitungan dari nol. Tidak ada panggilan jaringan dan tidak ada ketergantungan baru.

const KINDS = new Set(["success", "exhausted", "rejected", "error"]);
const LABELS = { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter", ollama: "Ollama", tavily: "Tavily", bing: "Bing", google: "Google" };

/** Buang pola key/token dari teks galat lalu potong. */
export function scrubError(text, max = 140) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/(AIza[\w-]{10,}|gsk_[\w-]{10,}|sk-[\w-]{10,}|ghp_[\w]{10,}|eyJ[\w.-]{20,}|tvly-[\w-]{8,})/g, "…")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "…")
    .trim()
    .slice(0, max);
}

export function relativeTime(ms, nowMs) {
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 45) return "baru saja";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} jam ${m % 60} mnt lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

function durationText(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d} hari ${h} jam` : h > 0 ? `${h} jam ${m % 60} mnt` : `${m} mnt`;
}

const labelOf = (name) => LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1);

/**
 * @param {{ now?: () => number, recent?: number }} opts  recent = berapa kejadian terakhir yang dinilai untuk ikon status
 */
export function createProviderStats({ now = () => Date.now(), recent = 20 } = {}) {
  const byName = new Map();
  let since = now();

  const entry = (name) => {
    let e = byName.get(name);
    if (!e) {
      e = { ok: 0, fail: 0, ring: [], lastOkAt: 0, lastOkModel: "", lastFailAt: 0, lastError: "", rests: new Map() };
      byName.set(name, e);
    }
    return e;
  };

  /** e = { provider, kind: "success"|"exhausted"|"rejected"|"error", model?, keyHint?, untilMs?, error? } */
  function record(e) {
    try {
      const name = String(e?.provider || "").trim().toLowerCase();
      if (!name || !KINDS.has(e?.kind)) return;
      const s = entry(name);
      const t = now();
      const hint = String(e.keyHint || "");
      if (e.kind === "success") {
        s.ok += 1;
        s.lastOkAt = t;
        s.lastOkModel = String(e.model || "").slice(0, 60);
        s.ring.push(true);
        s.rests.delete(hint);
      } else {
        s.fail += 1;
        s.lastFailAt = t;
        s.lastError = scrubError(e.error || (e.kind === "exhausted" ? "kena batas pemakaian" : e.kind === "rejected" ? "key ditolak" : "gagal"));
        s.ring.push(false);
        if (Number(e.untilMs) > t) s.rests.set(hint, Number(e.untilMs));
      }
      if (s.ring.length > recent) s.ring.splice(0, s.ring.length - recent);
    } catch {
      /* statistik tidak boleh mengganggu jawaban */
    }
  }

  function health(s) {
    if (s.ok + s.fail === 0) return "unused";
    const last3 = s.ring.slice(-3);
    if (last3.length === 3 && last3.every((x) => !x)) return "down";
    if (!s.ring[s.ring.length - 1]) return "warn";
    const fails = s.ring.filter((x) => !x).length;
    return fails / s.ring.length >= 0.3 ? "warn" : "ok";
  }

  /** Data mentah (untuk tes / pemakaian lain). */
  function snapshot() {
    const t = now();
    return [...byName.entries()].map(([name, s]) => ({
      name,
      ok: s.ok,
      fail: s.fail,
      recentOk: s.ring.filter(Boolean).length,
      recentTotal: s.ring.length,
      health: health(s),
      lastOkAt: s.lastOkAt,
      lastFailAt: s.lastFailAt,
      lastError: s.lastError,
      resting: [...s.rests.values()].filter((u) => u > t).sort((a, b) => a - b)
    }));
  }

  function reset() {
    byName.clear();
    since = now();
  }

  /**
   * Teks untuk pemilik (teks biasa; aman diteruskan ke Telegram/WhatsApp).
   * configured: nama penyedia yang SUDAH diatur di .env (tampil walau belum pernah dipakai).
   * formatClock(ms): jam lokal "14:05 WIB" untuk akhir masa istirahat.
   */
  function format({ configured = [], formatClock = (ms) => new Date(ms).toISOString().slice(11, 16) } = {}) {
    const t = now();
    const snap = new Map(snapshot().map((x) => [x.name, x]));
    for (const c of configured) {
      const name = String(c).toLowerCase();
      if (!snap.has(name)) snap.set(name, { name, ok: 0, fail: 0, recentOk: 0, recentTotal: 0, health: "unused", lastOkAt: 0, lastFailAt: 0, lastError: "", resting: [] });
    }
    const lines = ["🛰️ Status penyedia AI", `Sejak bot dihidupkan ${durationText(t - since)} (dihitung ulang tiap restart). Hanya statistik, tanpa isi percakapan.`, ""];
    if (snap.size === 0) {
      lines.push("Belum ada penyedia yang dipakai sejak bot dihidupkan.");
      return lines.join("\n");
    }
    const order = ["gemini", "groq", "openrouter", "ollama"];
    const names = [...snap.keys()].sort((a, b) => {
      const ia = order.indexOf(a) < 0 ? 99 : order.indexOf(a);
      const ib = order.indexOf(b) < 0 ? 99 : order.indexOf(b);
      return ia - ib || a.localeCompare(b);
    });
    const icon = { ok: "🟢", warn: "🟡", down: "🔴", unused: "⚪" };
    for (const name of names) {
      const s = snap.get(name);
      if (s.health === "unused") {
        lines.push(`⚪ ${labelOf(name)} — belum dipakai sejak bot dihidupkan`);
        continue;
      }
      lines.push(`${icon[s.health]} ${labelOf(name)} — ${s.ok} berhasil, ${s.fail} gagal${s.recentTotal ? ` • ${s.recentTotal} terakhir: ${s.recentOk} berhasil` : ""}`);
      if (s.lastOkAt) {
        const model = byName.get(name)?.lastOkModel;
        lines.push(`   terakhir berhasil ${relativeTime(s.lastOkAt, t)}${model ? ` (${model})` : ""}`);
      }
      if (s.resting.length) lines.push(`   ⏳ ${s.resting.length} key istirahat, yang terdekat pulih ${formatClock(s.resting[0])}`);
      if (s.lastFailAt && (s.health !== "ok" || s.lastFailAt > s.lastOkAt)) lines.push(`   ⚠️ gagal ${relativeTime(s.lastFailAt, t)}: ${s.lastError}`);
    }
    lines.push("", "🟢 lancar  🟡 kadang gagal  🔴 3 percobaan terakhir gagal  ⚪ belum dipakai", "Ketik /penyedia reset untuk menghitung dari nol.");
    return lines.join("\n");
  }

  return { record, snapshot, format, reset };
}

/** Kenali `/penyedia`, `/penyedia reset`. null bila bukan perintah. */
export function parseProviderCommand(text) {
  const m = /^\s*\/(?:penyedia|provider)(?:@\w+)?\b[\s:,-]*([\s\S]*)$/i.exec(String(text ?? ""));
  if (!m) return null;
  return { reset: /^(reset|ulang|nol|bersihkan)$/i.test(m[1].trim()) };
}
