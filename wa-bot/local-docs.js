// Tanya-jawab dari DOKUMEN LOKAL (folder dokumen/peraturan-md di laptop) — khusus pemilik, khusus Ollama.
//
// Dipakai oleh perintah `/dokumen <pertanyaan>` di WhatsApp dan Telegram. Dokumen lokal diindeks dengan id 'local:...'
// (lihat doc-folder.js) dan TIDAK PERNAH dikirim ke penyedia cloud (Gemini/Groq/OpenRouter): pencarian di sini memakai
// `onlyLocal`, jawabannya dibuat model Ollama di laptop sendiri.
//
// Aturan emas:
//   - Bila tidak ada bagian dokumen yang cocok, model TIDAK dipanggil sama sekali ("tidak ditemukan"), jadi tidak ada karangan.
//   - Jawaban diperiksa guardDocAnswer (kutipan/halaman yang tidak ada di bagian yang dibaca diberi peringatan).
//   - Setiap jawaban ditutup dengan daftar sumber (judul + halaman).
//   - Satu pertanyaan = satu jawaban (tanpa memori obrolan); sebut pasal/UU lengkap pada pertanyaan berikutnya.

import { guardDocAnswer as defaultGuard } from "./docguard.js";

export const LOCAL_DOC_SYSTEM_PROMPT = `Kamu adalah Ayyubi, asisten AI pribadi milik pemilik bot ini. Kamu berbicara LANGSUNG dengan pemilik (bukan dengan orang lain) dan berjalan sebagai model AI LOKAL di laptopnya. Tugasmu sekarang: menjawab pertanyaan HANYA berdasarkan blok "KONTEKS DOKUMEN" yang disertakan sistem (potongan peraturan/dokumen milik pemilik).

Aturan:
1. Jawab hanya dari konteks itu. Kalau jawabannya tidak ada di konteks, katakan terus terang bahwa tidak ditemukan di bagian dokumen yang dibaca dan sarankan pemilik menyebut nomor pasal/judul peraturannya. JANGAN menebak dan jangan memakai pengetahuan di luar konteks.
2. Sebut sumbernya singkat: nama peraturan, pasal/ayat, dan halaman bila ada penandanya ("[Halaman n]"). Kutipan kata-kata penting ditulis persis seperti di dokumen.
3. Angka, tarif, batas waktu, dan nomor pasal harus sama persis dengan konteks.
4. Jawab dengan Bahasa Indonesia yang jelas dan ringkas (sekitar 150 kata, poin-poin singkat boleh). Format yang tampil rapi di WhatsApp/Telegram: *tebal*, _miring_, dan daftar bernomor sederhana. Jangan pakai heading (#) atau tabel.`;

const NO_DOCS = "📂 Belum ada dokumen lokal yang terindeks.\nTaruh PDF peraturan di folder dokumen/peraturan-pdf (atau unggah lewat menu \"PDF → MD\" di aplikasi), tunggu sampai selesai dikonversi, lalu coba lagi.";
const NO_MATCH = "🔎 Tidak ada bagian dokumen lokal yang cocok dengan pertanyaan itu.\nCoba sebut nomor pasal, nama/nomor peraturannya, atau kata kunci yang lebih spesifik.";

/** Kenali `/dokumen ...`, `/dokumen`, `dokumen: ...`. Mengembalikan null bila bukan perintah. */
export function parseDokumenCommand(text) {
  const m = /^\s*\/(?:dokumen|dok|doc)(?:@\w+)?\b[\s:,-]*([\s\S]*)$/i.exec(String(text ?? ""));
  if (!m) return null;
  const arg = m[1].trim();
  return { question: arg, list: arg === "" || /^(daftar|list|ls)$/i.test(arg) };
}

function pagesOf(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/\[Halaman (\d+)\]/g)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** "📚 Sumber: Judul (hlm 3, 4); Judul lain" */
export function formatSources(chunks, { maxDocs = 4 } = {}) {
  const byTitle = new Map();
  for (const c of chunks) {
    const t = String(c.title || "dokumen");
    if (!byTitle.has(t)) byTitle.set(t, []);
    const arr = byTitle.get(t);
    for (const p of pagesOf(c.text)) if (!arr.includes(p)) arr.push(p);
  }
  const parts = [...byTitle.entries()].slice(0, maxDocs).map(([t, pages]) => {
    const ps = pages.sort((a, b) => a - b).slice(0, 8);
    return ps.length ? `${t} (hlm ${ps.join(", ")})` : t;
  });
  const more = byTitle.size - parts.length;
  return `📚 Sumber: ${parts.join("; ")}${more > 0 ? ` +${more} lainnya` : ""}`;
}

export function buildOwnerDocMessage(question, chunks) {
  const block = chunks.map((c) => `[Dari dokumen: ${c.title}]\n${c.text}`).join("\n\n");
  return `KONTEKS DOKUMEN (dicarikan otomatis dari dokumen lokal pemilik; mungkin hanya sebagian yang relevan):\n${block}\n\nPertanyaan pemilik: ${question}`;
}

/**
 * deps:
 *   index      — kb-index (butuh search, listDocs)
 *   callModel(messages, { temperature }) -> Promise<string>   (di index.js: lewat antrean Ollama, prioritas obrolan)
 *   guard      — opsional (bawaan guardDocAnswer)
 *   getMemory  — opsional: () => string, blok CATATAN PRIBADI pemilik (owner-memory.js); hanya ke Ollama lokal ini
 *   budgetChars, maxChunks, temperature — opsional
 */
export function createLocalDocs({ index: indexArg = null, getIndex = null, getMemory = null, callModel, guard = defaultGuard, budgetChars = 3500, maxChunks = 8, temperature = 0.1, now = () => new Date() } = {}) {
  // getIndex: indeks di bot dibuka belakangan (await saat start), jadi diambil saat dipakai, bukan saat modul dibuat.
  const currentIndex = () => (typeof getIndex === "function" ? getIndex() : indexArg);

  function localList() {
    const index = currentIndex();
    if (!index) return [];
    return index.listDocs().filter((d) => String(d.id).startsWith("local:"));
  }

  /** Teks daftar dokumen lokal (untuk `/dokumen` tanpa pertanyaan). */
  function list() {
    const docs = localList();
    if (docs.length === 0) return NO_DOCS;
    const shown = docs.slice().sort((a, b) => String(a.title).localeCompare(String(b.title), "id"));
    const lines = shown.slice(0, 25).map((d, i) => `${i + 1}. ${d.title}${d.pages ? ` — ${d.pages} hlm` : ""}`);
    if (shown.length > 25) lines.push(`… dan ${shown.length - 25} lainnya`);
    return [`📂 ${docs.length} dokumen lokal (hanya dijawab Ollama di laptop):`, ...lines, "", "Tanya dengan: /dokumen <pertanyaan>   contoh: /dokumen berapa lama jangka waktu pasal 12 ayat 2?"].join("\n");
  }

  /** @returns {Promise<{ok:boolean, reply:string, sources?:string, flagged?:boolean}>} */
  async function ask(question) {
    const q = String(question ?? "").trim();
    if (!q) return { ok: false, reply: list() };
    const index = currentIndex();
    if (!index) return { ok: false, reply: "Indeks dokumen di laptop tidak aktif (KB_INGEST_ENABLED=false, atau gagal dibuka — lihat `pm2 logs wa-bot`, cari \"Indeks dokumen tidak aktif\")." };
    if (localList().length === 0) return { ok: false, reply: NO_DOCS };
    const chunks = index.search(q, { budgetChars, maxChunks, onlyLocal: true });
    if (chunks.length === 0) return { ok: false, reply: NO_MATCH };

    const dateLine = `Waktu sekarang: ${now().toISOString().slice(0, 10)}.`;
    let memory = "";
    try {
      memory = typeof getMemory === "function" ? String(getMemory() || "").trim() : "";
    } catch {
      memory = ""; // catatan tidak boleh menggagalkan jawaban
    }
    const memoryNote = memory ? `\n\n${memory}\nCatatan di atas hanya untuk menyesuaikan gaya jawaban dan konteks pemilik. Isi peraturan/angka tetap HANYA dari KONTEKS DOKUMEN.` : "";
    const raw = String(
      await callModel(
        [
          { role: "system", content: `${LOCAL_DOC_SYSTEM_PROMPT}\n\n${dateLine}${memoryNote}` },
          { role: "user", content: buildOwnerDocMessage(q, chunks) }
        ],
        { temperature }
      )
    ).trim();
    if (!raw) throw new Error("Ollama tidak menghasilkan jawaban.");
    const guarded = guard(raw, chunks);
    const sources = formatSources(chunks);
    return { ok: true, reply: `${guarded.reply}\n\n${sources}`, sources, flagged: !!guarded.flagged };
  }

  return { ask, list, localList };
}
