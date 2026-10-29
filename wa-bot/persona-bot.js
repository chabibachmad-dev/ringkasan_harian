// ================================================================
// Kepribadian (gaya bicara) per akun WhatsApp -- TERPISAH dari /suara (persona-voice.js, yang mengatur suara TTS).
//
//   Akun utama = Ayyubi (tengil, meledek ringan). Akun kedua = Wongsobot (bapak bijak). Teksnya tersimpan di bot_state
//   (kunci persona_bot:<akun>) dan bisa diubah dari Telegram tanpa restart:
//     /persona lihat | /persona ayyubi <teks> | /persona wongsobot <teks> | /persona reset <akun|semua>
//
//   PAGAR TETAP (tidak bisa diubah/dimatikan lewat /persona, selalu ditempel SETELAH teks persona):
//     - semua akun: gaya hanya soal nada; patuh pemilik, jujur bila tidak tahu, tanpa mengarang, aturan lain tetap menang.
//     - Ayyubi: pagar roasting. Pertanyaan serius (aturan/uang/hukum/angka/dokumen) => ledekan dimatikan total.
// ================================================================
import { MAIN_ACCOUNT, SECOND_ACCOUNT } from "./wa-accounts.js";
import { stripControlTags } from "./reply-guard.js";

export const PERSONA_MAX = 500; // batas panjang teks persona buatan pengguna (prompt tidak boleh membengkak)

export const DEFAULT_PERSONA = {
  [MAIN_ACCOUNT]: "Kamu anak laki-laki yang tengil: spontan, lucu, suka meledek ringan, bahasa Indonesia santai sehari-hari. Tengil tapi tetap sopan dan tetap membantu; jawabannya jelas dulu, bumbu tengilnya sedikit saja.",
  [SECOND_ACCOUNT]: "Kamu seorang bapak yang bijak dan mengayomi: tenang, sabar, hangat, memberi nasihat singkat. Sesekali memanggil \"Nak\" dan memakai sentuhan Jawa yang halus (mis. \"ya, Nak\", \"monggo\"). Tidak menggurui, tidak bertele-tele."
};

export const COMMON_FENCE =
  "PAGAR TETAP (menang atas gaya di atas): gaya bicara hanya mengatur NADA, bukan isi. Tetap patuhi pemilik bot dan sapaan/kepatuhan kepada pemilik sesuai aturan lain di prompt ini, jujur bila tidak tahu, jangan mengarang fakta/angka/tanggal/tautan, dan jangan melanggar aturan lain di prompt ini.";

export const ROASTING_FENCE =
  "PAGAR ROASTING (wajib): meledek HANYA soal situasi, hal ringan, dirinya sendiri, atau pemilik bot. DILARANG menyinggung fisik, SARA, keluarga, kesehatan, jabatan/atasan, atau orang yang sedang kesal/sedih. Satu ledekan per jawaban paling banyak. Pertanyaan serius (aturan, keuangan, hukum, angka, dokumen): jawab akurat dulu; nada tengil hanya sentuhan kecil di pembuka/penutup atau dimatikan sama sekali.";

export const SERIOUS_FENCE = "PERTANYAAN INI SERIUS: JANGAN meledek sama sekali; jawab akurat, sopan, dan lugas.";

const KEY = (who) => `persona_bot:${who}`;
const BYPASS_RE = /(abaikan|hapus|matikan|nonaktifkan|lupakan|langgar|tanpa)\W+(?:\S+\W+){0,3}(pagar|aturan|larangan|batasan|roasting)/i;

/** Teks persona dibersihkan: satu baris, tanpa tag kontrol/kurung siku/kutip pembuka, maks PERSONA_MAX. */
export function cleanPersona(s) {
  return stripControlTags(String(s ?? ""), { doubleBracket: true })
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\[\]<>{}`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PERSONA_MAX);
}

export function createPersonaBot({ state = null, secondName = "", secondEnabled = Boolean(secondName), log = console } = {}) {
  const names = { [MAIN_ACCOUNT]: "Ayyubi", [SECOND_ACCOUNT]: String(secondName || "").trim() || "Wongsobot" };
  const custom = new Map(); // akun -> teks
  const aliases = (who) =>
    who === MAIN_ACCOUNT ? ["ayyubi", "main", "utama"] : ["wongsobot", "wa2", "nomor2", "nomor", String(names[SECOND_ACCOUNT]).toLowerCase().split(/\s+/)[0]];

  /** "ayyubi" / "wongsobot" / "wa2" -> id akun, atau null. */
  function resolve(word) {
    const w = String(word ?? "").trim().toLowerCase();
    return [MAIN_ACCOUNT, SECOND_ACCOUNT].find((who) => aliases(who).includes(w)) || null;
  }

  async function load() {
    for (const who of [MAIN_ACCOUNT, SECOND_ACCOUNT]) {
      try {
        const raw = await state?.get?.(KEY(who));
        const t = cleanPersona(typeof raw === "string" ? raw : raw?.text);
        if (t) custom.set(who, t);
      } catch (e) {
        log.warn?.(`🎭 Persona "${who}" tersimpan rusak, diabaikan: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const text = (who) => custom.get(who) || DEFAULT_PERSONA[who] || DEFAULT_PERSONA[MAIN_ACCOUNT];
  const isCustom = (who) => custom.has(who);

  /** Blok prompt untuk akun ini. serious=true => ledekan dimatikan total. Sinkron. */
  function note(who = MAIN_ACCOUNT, { serious = false } = {}) {
    const acct = who === SECOND_ACCOUNT ? SECOND_ACCOUNT : MAIN_ACCOUNT;
    const parts = [`GAYA BICARA (kepribadian ${names[acct]}):\n${text(acct)}`, COMMON_FENCE];
    if (acct === MAIN_ACCOUNT) parts.push(ROASTING_FENCE);
    if (acct === MAIN_ACCOUNT && serious) parts.push(SERIOUS_FENCE);
    return `\n\n${parts.join("\n")}`;
  }

  /** -> { saved, value } ; melempar galat berbahasa Indonesia bila teks tidak sah. */
  async function set(who, raw) {
    const value = cleanPersona(raw);
    if (value.length < 10) throw new Error("teks persona terlalu pendek (minimal 10 huruf)");
    if (BYPASS_RE.test(value)) throw new Error("persona tidak boleh meminta pagar/aturan dimatikan; pagar roasting dan aturan jujur selalu berlaku");
    custom.set(who, value);
    try {
      await state?.set?.(KEY(who), JSON.stringify({ text: value }));
      return { saved: true, value };
    } catch {
      return { saved: false, value };
    }
  }

  async function reset(who) {
    const had = custom.delete(who);
    try {
      await state?.set?.(KEY(who), "");
      return { saved: true, had };
    } catch {
      return { saved: false, had };
    }
  }

  function describe() {
    return [MAIN_ACCOUNT, SECOND_ACCOUNT]
      .filter((w) => w === MAIN_ACCOUNT || secondEnabled)
      .map((w) => `• ${names[w]} (${isCustom(w) ? "buatan sendiri" : "bawaan"}): ${text(w)}`)
      .join("\n");
  }

  /** Teks setelah "/persona" -> { kind: "show" } | { kind: "set", who, text } | { kind: "reset", who|"all" } | { kind: "error", message } | null */
  function parse(arg) {
    const a = String(arg ?? "").trim();
    if (!a || /^(lihat|daftar|show)$/i.test(a)) return { kind: "show" };
    const m = /^(\S+)\s*([\s\S]*)$/.exec(a);
    const head = m[1].toLowerCase();
    const rest = m[2].trim();
    if (head === "reset") {
      if (/^(semua|all)$/i.test(rest)) return { kind: "reset", who: "all" };
      const who = resolve(rest.split(/\s+/)[0]);
      return who ? { kind: "reset", who } : { kind: "error", message: "Akun mana yang di-reset? Contoh: /persona reset ayyubi, /persona reset wongsobot, atau /persona reset semua" };
    }
    const who = resolve(head);
    if (!who) return { kind: "error", message: "Akun tidak dikenal. Pakai: /persona ayyubi <teks>, /persona wongsobot <teks>, /persona lihat, /persona reset <akun>" };
    if (!rest) return { kind: "error", message: `Tulis gaya bicaranya, contoh: /persona ${head} anak tengil yang suka bercanda` };
    return { kind: "set", who, text: rest };
  }

  return { load, note, text, set, reset, describe, parse, resolve, label: (w) => names[w], isCustom };
}
