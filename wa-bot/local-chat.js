// Ngobrol dengan Ollama LOKAL lewat `/lokal <pesan>` (alias `/tanya`) di Telegram dan WhatsApp -- khusus pemilik.
//
// Beda dari obrolan biasa di Telegram (dijawab Gemini di cloud): di sini SELURUH percakapan, termasuk catatan pribadi
// (/ingat), hanya diproses model Ollama di laptop sendiri. Tidak ada pencarian web dan tidak ada dokumen (untuk dokumen
// pakai /dokumen). Ada ingatan percakapan pendek (beberapa giliran terakhir, hanya di memori proses, hilang saat restart
// atau `/lokal baru`).

export const LOCAL_CHAT_SYSTEM_PROMPT = `Kamu adalah Ayyubi, asisten AI pribadi milik pemilik bot ini. Kamu berbicara LANGSUNG dengan pemilik dan berjalan sebagai model AI LOKAL di laptopnya: percakapan ini tidak dikirim ke internet.

Aturan:
1. Kamu TIDAK punya akses internet dan tidak membaca dokumen pemilik di percakapan ini. Untuk peraturan/angka resmi atau kabar terbaru, katakan terus terang kamu tidak bisa memastikan dan sarankan memakai /dokumen (dokumen lokal) atau bertanya lewat obrolan biasa (yang bisa mencari web).
2. Jangan mengarang fakta, angka, nama, atau pasal. Kalau tidak tahu, katakan tidak tahu.
3. Jawab dengan Bahasa Indonesia yang jelas dan ringkas kecuali pemilik menulis/meminta bahasa lain. Format yang rapi di WhatsApp/Telegram: *tebal*, _miring_, \`kode\`, dan daftar bernomor sederhana. Jangan pakai heading (#) atau tabel.`;

/** Kenali `/lokal ...` atau `/tanya ...`. `reset` = "/lokal baru" (lupakan percakapan). null bila bukan perintah. */
export function parseLocalChatCommand(text) {
  const m = /^\s*\/(?:lokal|tanya)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(text ?? ""));
  if (!m) return null;
  const arg = (m[1] ?? "").trim();
  return { text: arg, reset: /^(baru|reset|ulang|lupakan)$/i.test(arg), empty: arg === "" };
}

export const LOCAL_CHAT_USAGE = [
  "🦙 Ngobrol dengan Ollama lokal (percakapan dan catatan pribadimu tidak keluar dari laptop):",
  "/lokal <pesan>  — tanya/ngobrol (alias /tanya)",
  "/lokal baru  — lupakan percakapan sebelumnya",
  "Tidak ada pencarian web atau dokumen di sini: untuk dokumen pakai /dokumen, untuk info terbaru pakai obrolan biasa."
].join("\n");

/**
 * deps:
 *   callModel(messages, { temperature }) -> Promise<string>   (di index.js: antrean Ollama, prioritas obrolan)
 *   getMemory  — opsional: () => string (blok catatan pribadi)
 *   historyTurns — berapa pasang tanya-jawab terakhir yang diingat per percakapan (bawaan 4)
 *   maxInputChars — batas panjang satu pesan (bawaan 4000)
 */
export function createLocalChat({ callModel, getMemory = null, historyTurns = 4, maxInputChars = 4000, temperature = 0.4, now = () => new Date() } = {}) {
  const histories = new Map(); // kunci percakapan -> [{role, content}]
  const MAX_KEYS = 20;

  function reset(key) {
    histories.delete(String(key));
  }

  /** @returns {Promise<{ok:boolean, reply:string}>} */
  async function ask(key, rawText) {
    const k = String(key);
    const text = String(rawText ?? "").trim();
    if (!text) return { ok: false, reply: LOCAL_CHAT_USAGE };
    if (text.length > maxInputChars) return { ok: false, reply: `Pesannya terlalu panjang (${text.length} huruf, maks ${maxInputChars}). Pecah jadi beberapa pesan, atau pakai /skill untuk mengolah teks panjang.` };

    let memory = "";
    if (typeof getMemory === "function") {
      try {
        memory = String(getMemory() || "").trim();
      } catch {
        memory = ""; // catatan tidak boleh menggagalkan obrolan
      }
    }
    const system = [LOCAL_CHAT_SYSTEM_PROMPT, `Waktu sekarang: ${now().toISOString().slice(0, 10)}.`, memory].filter(Boolean).join("\n\n");
    const past = histories.get(k) || [];
    const raw = String(await callModel([{ role: "system", content: system }, ...past, { role: "user", content: text }], { temperature })).trim();
    if (!raw) throw new Error("Ollama tidak menghasilkan jawaban.");

    // simpan hanya bila berhasil, supaya pesan yang gagal tidak menumpuk di ingatan
    const next = [...past, { role: "user", content: text }, { role: "assistant", content: raw.slice(0, 1500) }];
    histories.delete(k); // pindahkan ke ujung (urutan terbaru)
    histories.set(k, next.slice(-historyTurns * 2));
    while (histories.size > MAX_KEYS) histories.delete(histories.keys().next().value);
    return { ok: true, reply: raw };
  }

  /** Satu pintu untuk Telegram/WhatsApp: arg = teks setelah /lokal. Mengembalikan teks balasan (melempar bila model gagal). */
  async function handle(key, arg) {
    const cmd = parseLocalChatCommand(`/lokal ${arg ?? ""}`);
    if (cmd.empty) return LOCAL_CHAT_USAGE;
    if (cmd.reset) {
      reset(key);
      return "Oke, percakapan lokal dimulai dari awal.";
    }
    return (await ask(key, cmd.text)).reply;
  }

  return { ask, reset, handle, size: () => histories.size };
}
