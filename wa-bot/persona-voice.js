// ================================================================
// Suara per bot: Ayyubi (nomor utama) dan bot nomor kedua (mis. Wongsobot) bisa punya suara & gaya bicara sendiri.
//
//   Pengaturan (Telegram, tersimpan di bot_state, langsung berlaku tanpa restart):
//     /suara daftar                          daftar suara (pria/wanita) + pengaturan sekarang
//     /suara coba Puck anak laki-laki ceria  kirim CONTOH suara (tidak menyimpan). Tambah " | teks sendiri" untuk teks contoh
//     /suara coba wongsobot                  contoh dengan pengaturan Wongsobot sekarang
//     /suara pakai ayyubi Puck anak laki-laki ceria, bicara cepat   simpan untuk Ayyubi
//     /suara pakai wongsobot Charon bapak-bapak tenang dan berwibawa
//     /suara reset ayyubi                    kembali ke suara bawaan
//   Bawaan awal dari .env (opsional): WA_VOICE, WA_VOICE_STYLE, WA2_VOICE, WA2_VOICE_STYLE.
//
// Suara = salah satu dari 30 suara siap pakai Gemini TTS; gaya = kalimat bebas yang mengarahkan cara bicara (tidak dijamin menghasilkan
// umur tertentu: Gemini tidak punya suara anak-anak).
// ================================================================
import { MAIN_ACCOUNT, SECOND_ACCOUNT } from "./wa-accounts.js";

export const FEMALE_VOICES = ["Achernar", "Aoede", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux", "Kore", "Laomedeia", "Leda", "Pulcherrima", "Sulafat", "Vindemiatrix", "Zephyr"];
export const MALE_VOICES = ["Achird", "Algenib", "Algieba", "Alnilam", "Charon", "Enceladus", "Fenrir", "Iapetus", "Orus", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Umbriel", "Zubenelgenubi"];
export const ALL_VOICES = [...FEMALE_VOICES, ...MALE_VOICES];
export const STYLE_MAX = 240;
export const sampleText = (name = "") => (name ? `Halo, aku ${name}. Senang bertemu denganmu! Ada yang bisa kubantu hari ini?` : "Halo, ini contoh suaranya. Senang bertemu denganmu! Ada yang bisa kubantu hari ini?");

/** "puck" / "PUCK" -> "Puck"; tidak dikenal -> null. */
export function findVoice(name) {
  const k = String(name ?? "").trim().toLowerCase();
  return ALL_VOICES.find((v) => v.toLowerCase() === k) || null;
}

/** Gaya bicara dibersihkan: satu baris, tanpa tanda kutip/kurung siku (supaya tidak dibaca sebagai penanda), maks STYLE_MAX. */
export function cleanStyle(s) {
  return String(s ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\[\]"“”<>{}`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STYLE_MAX);
}

const KEY = (who) => `persona_voice:${who}`;

/**
 * state: { get(key), set(key, value) } (bot_state). env: process.env.
 * secondName: nama bot nomor kedua ("Wongsobot") atau "" bila nomor kedua tidak aktif.
 */
export function createPersonaVoice({ state = null, env = process.env, secondName = "", secondEnabled = Boolean(secondName), log = console } = {}) {
  const cache = new Map(); // who -> { voice, style }
  const envDefault = (who) => {
    const voice = findVoice(who === SECOND_ACCOUNT ? env.WA2_VOICE : env.WA_VOICE);
    const raw = who === SECOND_ACCOUNT ? env.WA2_VOICE_STYLE : env.WA_VOICE_STYLE;
    return { voice: voice || null, style: cleanStyle(raw) };
  };
  const names = { [MAIN_ACCOUNT]: "Ayyubi", [SECOND_ACCOUNT]: String(secondName || "").trim() || "Nomor 2" };

  async function load() {
    for (const who of [MAIN_ACCOUNT, SECOND_ACCOUNT]) {
      try {
        const raw = await state?.get?.(KEY(who));
        if (!raw) continue;
        const o = typeof raw === "string" ? JSON.parse(raw) : raw;
        const voice = findVoice(o?.voice);
        if (voice) cache.set(who, { voice, style: cleanStyle(o?.style) });
      } catch (e) {
        log.warn?.(`🔊 Suara bot "${who}" tersimpan rusak, diabaikan: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Pengaturan yang berlaku untuk satu akun WA: { voice, style } (voice null = suara bawaan sistem). Sinkron. */
  function get(accountId) {
    const who = accountId === SECOND_ACCOUNT ? SECOND_ACCOUNT : MAIN_ACCOUNT;
    return cache.get(who) || envDefault(who);
  }

  /** Simpan. Mengembalikan { saved } (false bila penyimpanan gagal; tetap berlaku sampai restart). */
  async function set(who, voice, style = "") {
    const v = findVoice(voice);
    if (!v) throw new Error("nama suara tidak dikenal");
    const val = { voice: v, style: cleanStyle(style) };
    cache.set(who, val);
    try {
      await state?.set?.(KEY(who), JSON.stringify(val));
      return { saved: true, value: val };
    } catch {
      return { saved: false, value: val };
    }
  }

  async function reset(who) {
    cache.delete(who);
    try {
      await state?.set?.(KEY(who), "");
      return { saved: true };
    } catch {
      return { saved: false };
    }
  }

  /** Kata -> akun: "ayyubi"/"utama"/"wa1" -> main; "wa2"/"nomor2"/nama bot kedua -> wa2; selain itu null. */
  function whoFromWord(word) {
    const w = String(word ?? "").trim().toLowerCase();
    if (!w) return null;
    if (["ayyubi", "utama", "main", "wa1", "nomor1"].includes(w)) return MAIN_ACCOUNT;
    const second = String(secondName || "").trim().toLowerCase();
    if (["wa2", "nomor2", "kedua"].includes(w) || (second && (w === second || w === second.split(/\s+/)[0]))) return SECOND_ACCOUNT;
    return null;
  }

  const label = (who) => names[who];
  const line = (who) => {
    const c = get(who);
    return `• ${label(who)}: ${c.voice ? `*${c.voice}*` : "suara bawaan (Sulafat)"}${c.style ? ` — gaya: ${c.style}` : ""}`;
  };
  function describe() {
    return [line(MAIN_ACCOUNT), ...(secondEnabled ? [line(SECOND_ACCOUNT)] : [])].join("\n");
  }
  const listText = () =>
    `🔊 *Suara yang tersedia* (Gemini)\n• Pria: ${MALE_VOICES.join(", ")}\n• Wanita: ${FEMALE_VOICES.join(", ")}\n\n*Sekarang*\n${describe()}\n\n*Coba dulu:* /suara coba Puck anak laki-laki ceria\n*Simpan:* /suara pakai ayyubi Puck anak laki-laki ceria${secondEnabled ? `\n/suara pakai ${String(secondName).trim().split(/\s+/)[0].toLowerCase()} Charon bapak-bapak tenang dan berwibawa` : ""}\n*Kembalikan:* /suara reset ayyubi\nGaya = kalimat bebas (nada, usia kira-kira, tempo). Gemini tidak punya suara anak-anak, jadi hasilnya perlu didengar dulu.`;

  /**
   * Menguraikan argumen /suara yang menyangkut suara-per-bot. null = bukan perintah ini (biarkan /suara auto|on|off).
   * -> { kind: "list" } | { kind: "show", who } | { kind: "try", who?, voice?, style, text? } | { kind: "set", who, voice, style } | { kind: "reset", who } | { kind: "error", error }
   */
  function parse(arg) {
    const raw = String(arg ?? "").trim();
    if (!raw) return null;
    const [head, ...restWords] = raw.split(/\s+/);
    const h = head.toLowerCase();
    const rest = restWords.join(" ");
    const needSecond = (who) => (who === SECOND_ACCOUNT && !secondEnabled ? "Nomor WhatsApp kedua belum aktif di bot ini (WA2_ENABLED)." : null);
    if (["daftar", "list", "suaranya", "pilihan"].includes(h)) return { kind: "list" };
    const whoHead = whoFromWord(h);
    if (whoHead && restWords.length === 0) return needSecond(whoHead) ? { kind: "error", error: needSecond(whoHead) } : { kind: "show", who: whoHead };
    if (["coba", "contoh", "test", "tes", "uji"].includes(h)) {
      if (!rest) return { kind: "error", error: "Pakai: /suara coba <NamaSuara> [gaya]  atau  /suara coba ayyubi|wongsobot.\nDaftar suara: /suara daftar" };
      let body = rest;
      let text = "";
      const bar = body.indexOf("|");
      if (bar >= 0) {
        text = body.slice(bar + 1).trim().slice(0, 400);
        body = body.slice(0, bar).trim();
      }
      const [first, ...more] = body.split(/\s+/);
      const who = whoFromWord(first);
      if (who && more.length === 0) return needSecond(who) ? { kind: "error", error: needSecond(who) } : { kind: "try", who, voice: null, style: "", text };
      const voice = findVoice(first);
      if (!voice) return { kind: "error", error: `Suara "${first}" tidak dikenal. Lihat /suara daftar.` };
      return { kind: "try", who: null, voice, style: cleanStyle(more.join(" ")), text };
    }
    if (["pakai", "set", "atur", "simpan", "ganti"].includes(h)) {
      const [whoWord, voiceWord, ...more] = restWords;
      const who = whoFromWord(whoWord);
      if (!who || !voiceWord) return { kind: "error", error: "Pakai: /suara pakai <ayyubi|wongsobot> <NamaSuara> [gaya]\nContoh: /suara pakai ayyubi Puck anak laki-laki ceria" };
      if (needSecond(who)) return { kind: "error", error: needSecond(who) };
      const voice = findVoice(voiceWord);
      if (!voice) return { kind: "error", error: `Suara "${voiceWord}" tidak dikenal. Lihat /suara daftar.` };
      return { kind: "set", who, voice, style: cleanStyle(more.join(" ")) };
    }
    if (["reset", "bawaan", "default", "hapus"].includes(h)) {
      const who = whoFromWord(restWords[0]);
      if (!who) return { kind: "error", error: "Pakai: /suara reset ayyubi  atau  /suara reset wongsobot" };
      if (needSecond(who)) return { kind: "error", error: needSecond(who) };
      return { kind: "reset", who };
    }
    return null;
  }

  return { load, get, set, reset, parse, describe, listText, whoFromWord, label, line };
}
