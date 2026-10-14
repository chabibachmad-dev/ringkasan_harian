// Catatan pribadi pemilik ("memori") -- /ingat, /catatan, /lupa. Disimpan di SQLite LOKAL di laptop (node:sqlite).
//
// Aturan privasi:
//   - Catatan HANYA disisipkan ke prompt model Ollama lokal untuk pemilik (chat aplikasi dan /dokumen).
//     Tidak pernah ke Gemini/Groq/OpenRouter, tidak pernah ke balasan otomatis untuk kontak WhatsApp.
//   - Perintah hanya dijalankan untuk pemilik (Telegram: id pemilik; WhatsApp: nomor pemilik, bukan grup).
//   - Teks yang tampak seperti rahasia (API key, nomor kartu, kata sandi, PIN) ditolak -- jangan simpan rahasia di sini.
//   - Dibatasi: panjang per catatan dan jumlah catatan (bawaan 50), supaya prompt Ollama tidak membengkak.
//
//   const mem = await openOwnerMemory({ file: "memori.sqlite" });   // ":memory:" untuk tes
//   mem.add("klien X memakai skema Y") -> { ok, id, note } | { ok:false, reason }
//   mem.list() / mem.remove(nomor | "semua") / mem.promptBlock(budgetChars)

import fs from "node:fs";
import path from "node:path";

export const MAX_NOTE_CHARS = 300;

const SECRET_RE = /(AIza[\w-]{10,}|gsk_[\w-]{10,}|sk-[\w-]{10,}|ghp_\w{10,}|eyJ[\w.-]{20,}|tvly-[\w-]{8,})|\b\d{13,19}\b|\b(?:kata\s*sandi|password|passwd|sandi|pin|otp|cvv|token|secret)\s*[:=]/i;

export function looksLikeSecret(text) {
  return SECRET_RE.test(String(text ?? ""));
}

/** Kenali /ingat, /catatan, /lupa (juga /memori, /note). null bila bukan perintah. */
export function parseMemoryCommand(text) {
  const m = /^\s*\/(ingat|catatan|lupa|memori|note)(?:@\w+)?\b[\s:,-]*([\s\S]*)$/i.exec(String(text ?? ""));
  if (!m) return null;
  const word = m[1].toLowerCase();
  const name = word === "memori" || word === "note" ? "catatan" : word;
  return { name, arg: m[2].trim() };
}

export const MEMORY_HELP = [
  "🧠 Catatan pribadi (disimpan hanya di laptop, hanya dibaca Ollama lokal):",
  "/ingat <teks>  — simpan satu catatan (maks 300 huruf)",
  "/catatan  — daftar catatan",
  "/lupa <nomor>  — hapus satu catatan   •   /lupa semua  — hapus semuanya",
  "Jangan simpan kata sandi, PIN, atau nomor kartu."
].join("\n");

export async function openOwnerMemory({ file, maxNotes = 50, log = console, now = () => new Date() } = {}) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (e) {
    log.warn?.(`🧠 Memori tidak aktif: node:sqlite tidak tersedia (${e?.message || e}). Butuh Node 22+.`);
    return null;
  }
  const target = file || ":memory:";
  if (target !== ":memory:") {
    try {
      fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    } catch {
      /* folder sudah ada */
    }
  }
  const db = new DatabaseSync(target);
  db.exec("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at TEXT NOT NULL)");
  const limit = Math.max(1, Math.floor(Number(maxNotes) || 50));

  const rows = () => db.prepare("SELECT id, text, created_at FROM notes ORDER BY id ASC").all();

  function add(raw) {
    const text = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!text) return { ok: false, reason: "empty" };
    if (text.length > MAX_NOTE_CHARS) return { ok: false, reason: "too_long" };
    if (looksLikeSecret(text)) return { ok: false, reason: "secret" };
    const all = rows();
    if (all.some((r) => r.text.toLowerCase() === text.toLowerCase())) return { ok: false, reason: "duplicate" };
    if (all.length >= limit) return { ok: false, reason: "full" };
    const info = db.prepare("INSERT INTO notes (text, created_at) VALUES (?, ?)").run(text, now().toISOString());
    return { ok: true, id: Number(info.lastInsertRowid), note: text, total: all.length + 1 };
  }

  /** Catatan bernomor urut tampilan (1..n), bukan id database. */
  function list() {
    return rows().map((r, i) => ({ n: i + 1, id: r.id, text: r.text, createdAt: r.created_at }));
  }

  /** which: nomor tampilan (1..n) atau "semua". */
  function remove(which) {
    const all = rows();
    if (/^(semua|all)$/i.test(String(which).trim())) {
      db.exec("DELETE FROM notes");
      return { ok: true, removed: all.length };
    }
    const n = Number(String(which).trim());
    if (!Number.isInteger(n) || n < 1 || n > all.length) return { ok: false, reason: "not_found", total: all.length };
    db.prepare("DELETE FROM notes WHERE id = ?").run(all[n - 1].id);
    return { ok: true, removed: 1, note: all[n - 1].text };
  }

  /** Blok teks untuk prompt Ollama milik pemilik; "" bila tidak ada catatan. */
  function promptBlock(budgetChars = 1200) {
    const items = rows();
    if (items.length === 0) return "";
    const lines = [];
    let used = 0;
    // catatan terbaru diutamakan bila anggaran terbatas, tapi urutan tampil tetap lama -> baru
    for (let i = items.length - 1; i >= 0; i--) {
      const line = `- ${items[i].text}`;
      if (used + line.length + 1 > budgetChars) break;
      lines.unshift(line);
      used += line.length + 1;
    }
    if (lines.length === 0) return "";
    return `CATATAN PRIBADI PEMILIK (ditulis sendiri oleh pemilik; anggap benar dan pakai hanya bila relevan dengan pertanyaan; jangan menyebutnya bila tidak relevan):\n${lines.join("\n")}`;
  }

  function close() {
    try {
      db.close();
    } catch {
      /* sudah tertutup */
    }
  }

  return { add, list, remove, promptBlock, close, count: () => rows().length, limit };
}

/** Balasan teks untuk perintah memori (dipakai Telegram dan WhatsApp). */
export function handleMemoryCommand(mem, { name, arg }) {
  if (!mem) return "Fitur catatan belum aktif di bot ini (butuh Node 22+ dan OWNER_MEMORY_ENABLED bukan false).";
  if (name === "ingat") {
    if (!arg) return `Tulis catatannya setelah perintah, contoh:\n/ingat klien PT Maju memakai skema SJPH reguler\n\n${MEMORY_HELP}`;
    const r = mem.add(arg);
    if (r.ok) return `🧠 Tersimpan sebagai catatan ${r.total} dari maks ${mem.limit}. Hanya dibaca Ollama lokal.`;
    if (r.reason === "too_long") return `Catatan terlalu panjang (maks ${MAX_NOTE_CHARS} huruf). Ringkas dulu atau pecah jadi beberapa catatan.`;
    if (r.reason === "secret") return "Itu tampak seperti rahasia (key, kata sandi, PIN, atau nomor kartu), jadi tidak disimpan. Simpan rahasia di pengelola kata sandi, bukan di sini.";
    if (r.reason === "duplicate") return "Catatan yang sama sudah ada.";
    if (r.reason === "full") return `Catatan sudah penuh (${mem.limit}). Hapus yang lama dengan /lupa <nomor> dulu.`;
    return "Catatan kosong, tidak disimpan.";
  }
  if (name === "lupa") {
    if (!arg) return "Sebut nomor catatan yang dihapus (lihat /catatan), atau /lupa semua.";
    const r = mem.remove(arg);
    if (r.ok) return /^(semua|all)$/i.test(arg) ? `🧹 ${r.removed} catatan dihapus.` : `🧹 Dihapus: ${r.note}`;
    return `Tidak ada catatan nomor ${arg}. Ada ${r.total} catatan; lihat /catatan.`;
  }
  // catatan
  const items = mem.list();
  if (items.length === 0) return `Belum ada catatan.\n\n${MEMORY_HELP}`;
  return [`🧠 ${items.length} catatan (maks ${mem.limit}; hanya di laptop, hanya dibaca Ollama lokal):`, ...items.map((i) => `${i.n}. ${i.text}`), "", "Hapus: /lupa <nomor> atau /lupa semua"].join("\n");
}
