// ================================================================
// Kepribadian (gaya bicara) per akun WhatsApp -- TERPISAH dari /suara (persona-voice.js, yang mengatur suara TTS).
//
//   Akun utama = Ayyubi (tengil, meledek ringan). Akun kedua = Wongsobot (bapak bijak). Teksnya tersimpan di bot_state
//   (kunci persona_bot:<akun>) dan bisa diubah dari Telegram tanpa restart:
//     /persona lihat | /persona ayyubi <teks> | /persona wongsobot <teks> | /persona reset <akun|semua>
//   Mode keusilan per GRUP (kunci persona_bot_groups): "santai" (tengil penuh) atau "resmi" (jawaban lurus, usil maks. satu kalimat).
//     /persona grup santai <nama grup> | /persona grup resmi <nama grup> | /persona grup | /persona grup hapus <nama grup>
//     Grup baru/tak dikenal = resmi. Chat pribadi = santai. Pencocokan nama grup seperti /suara grup (potongan nama, huruf/emoji diabaikan).
//
//   PAGAR TETAP (tidak bisa diubah/dimatikan lewat /persona, selalu ditempel SETELAH teks persona):
//     - semua akun: gaya hanya soal nada; patuh pemilik, jujur bila tidak tahu, tanpa mengarang, aturan lain tetap menang.
//     - Ayyubi: pagar roasting. Pertanyaan serius (aturan/uang/hukum/angka/dokumen) => ledekan dimatikan total.
// ================================================================
import { MAIN_ACCOUNT, SECOND_ACCOUNT, normalizeGroupName } from "./wa-accounts.js";
import { stripControlTags } from "./reply-guard.js";

export const PERSONA_MAX = 500; // batas panjang teks persona buatan pengguna (prompt tidak boleh membengkak)

export const DEFAULT_PERSONA = {
  [MAIN_ACCOUNT]: "Kamu anak laki-laki yang tengil: spontan, lucu, suka meledek ringan, bahasa Indonesia santai sehari-hari. Tengil tapi tetap sopan dan tetap membantu; jawabannya jelas dulu, bumbu tengilnya sedikit saja.",
  [SECOND_ACCOUNT]: "Kamu seorang bapak yang bijak dan mengayomi: tenang, sabar, hangat, memberi nasihat singkat. Sesekali memanggil \"Nak\" dan memakai sentuhan Jawa yang halus (mis. \"ya, Nak\", \"monggo\"). Tidak menggurui, tidak bertele-tele."
};

export const COMMON_FENCE =
  "PAGAR TETAP (menang atas gaya di atas): gaya bicara hanya mengatur NADA, bukan isi. Tetap patuhi pemilik bot dan sapaan/kepatuhan kepada pemilik sesuai aturan lain di prompt ini, jujur bila tidak tahu, jangan mengarang fakta/angka/tanggal/tautan, dan jangan melanggar aturan lain di prompt ini.";

export const ROASTING_FENCE =
  "PAGAR ROASTING (wajib, berlaku di SEMUA mode): meledek HANYA soal situasi, hal ringan, dirinya sendiri, pemilik bot, atau (hanya bila mode santai) sesama anggota secara ringan dan akrab. DILARANG menyinggung fisik, SARA, keluarga, kesehatan, jabatan/atasan, atau orang yang sedang kesal/sedih/bertanya serius. Satu ledekan per jawaban paling banyak. Pertanyaan serius (aturan, keuangan, hukum, angka, dokumen): jawab akurat dulu; nada tengil hanya sentuhan kecil di pembuka/penutup atau dimatikan sama sekali.";

export const MODES = ["santai", "resmi"];
export const DEFAULT_GROUP_MODE = "resmi";
export const MODE_TEXT = {
  [MAIN_ACCOUNT]: {
    santai: "MODE GRUP: SANTAI -- tengil penuh: boleh ceplas-ceplos, boleh sesekali CAPSLOCK untuk penekanan lucu, boleh meledek sesama anggota secara ringan dan akrab (tetap dalam pagar).",
    resmi: "MODE GRUP: RESMI -- jawaban lurus dan rapi; sentuhan usil MAKSIMAL satu kalimat pendek (boleh tanpa sama sekali); tanpa capslock; jangan meledek anggota."
  },
  [SECOND_ACCOUNT]: {
    santai: "MODE GRUP: SANTAI -- hangat dan akrab, boleh bercanda kecil dan lebih luwes.",
    resmi: "MODE GRUP: RESMI -- tenang, sopan, dan lurus; tanpa candaan kecuali sangat singkat."
  }
};

export const SERIOUS_FENCE = "PERTANYAAN INI SERIUS: JANGAN meledek sama sekali; jawab akurat, sopan, dan lugas.";

const KEY = (who) => `persona_bot:${who}`;
export const GROUP_KEY = "persona_bot_groups";
export const GROUP_MIN_LEN = 3;
const cleanLabel = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
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
  let groupRules = []; // [{ name (normalisasi), label, mode }]
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
    try {
      const raw = await state?.get?.(GROUP_KEY);
      const arr = typeof raw === "string" ? (raw ? JSON.parse(raw) : []) : raw;
      groupRules = (Array.isArray(arr) ? arr : [])
        .map((x) => ({ name: normalizeGroupName(x?.label || x?.name), label: cleanLabel(x?.label || x?.name), mode: MODES.includes(x?.mode) ? x.mode : "" }))
        .filter((x) => x.name.length >= GROUP_MIN_LEN && x.mode);
    } catch (e) {
      log.warn?.(`🎭 Mode persona grup tersimpan rusak, diabaikan: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Mode untuk grup dengan nama ini (potongan nama paling panjang menang). Tak dikenal/kosong = resmi. Sinkron. */
  function groupMode(subject) {
    const n = normalizeGroupName(subject);
    let best = null;
    if (n) for (const x of groupRules) if (n.includes(x.name) && (!best || x.name.length > best.name.length)) best = x;
    return best ? best.mode : DEFAULT_GROUP_MODE;
  }

  async function saveGroups() {
    try {
      await state?.set?.(GROUP_KEY, JSON.stringify(groupRules.map((x) => ({ label: x.label, mode: x.mode }))));
      return true;
    } catch {
      return false;
    }
  }

  /** Simpan mode grup. -> { saved, label, mode, replaced } ; melempar galat berbahasa Indonesia bila nama/mode tidak sah. */
  async function setGroup(label, mode) {
    if (!MODES.includes(mode)) throw new Error("mode harus santai atau resmi");
    const name = normalizeGroupName(label);
    if (name.length < GROUP_MIN_LEN) throw new Error(`nama grup terlalu pendek (minimal ${GROUP_MIN_LEN} huruf/angka)`);
    const i = groupRules.findIndex((x) => x.name === name);
    const rule = { name, label: cleanLabel(label), mode };
    if (i >= 0) groupRules[i] = rule;
    else groupRules.push(rule);
    return { saved: await saveGroups(), label: rule.label, mode, replaced: i >= 0 };
  }

  async function removeGroup(label) {
    const name = normalizeGroupName(label);
    const i = groupRules.findIndex((x) => x.name === name);
    if (i < 0) return { saved: true, removed: false };
    groupRules.splice(i, 1);
    return { saved: await saveGroups(), removed: true };
  }

  function describeGroups() {
    return groupRules.length ? groupRules.map((x) => `• ${x.label}: ${x.mode}`).join("\n") : "(belum ada aturan: semua grup memakai mode resmi)";
  }

  const text = (who) => custom.get(who) || DEFAULT_PERSONA[who] || DEFAULT_PERSONA[MAIN_ACCOUNT];
  const isCustom = (who) => custom.has(who);

  /** Blok prompt untuk akun ini. serious=true => ledekan dimatikan total. Sinkron. */
  function note(who = MAIN_ACCOUNT, { serious = false, mode = "santai" } = {}) {
    const acct = who === SECOND_ACCOUNT ? SECOND_ACCOUNT : MAIN_ACCOUNT;
    const eff = serious ? "resmi" : MODES.includes(mode) ? mode : DEFAULT_GROUP_MODE; // topik serius selalu memakai nada resmi
    const parts = [`GAYA BICARA (kepribadian ${names[acct]}):\n${text(acct)}`, MODE_TEXT[acct][eff], COMMON_FENCE];
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
    if (head === "grup") {
      if (!rest) return { kind: "glist" };
      const g = /^(\S+)\s*([\s\S]*)$/.exec(rest);
      const sub = g[1].toLowerCase();
      const label = g[2].trim();
      if (sub === "hapus") return label ? { kind: "gdel", label } : { kind: "error", message: "Grup mana yang dihapus? Contoh: /persona grup hapus Jafung AiPBN" };
      if (MODES.includes(sub)) return label ? { kind: "gset", mode: sub, label } : { kind: "error", message: `Tulis nama grupnya, contoh: /persona grup ${sub} Jafung AiPBN` };
      return { kind: "error", message: "Pakai: /persona grup santai <nama grup> • /persona grup resmi <nama grup> • /persona grup (daftar) • /persona grup hapus <nama grup>" };
    }
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

  return { load, note, text, set, reset, describe, parse, resolve, label: (w) => names[w], isCustom, groupMode, setGroup, removeGroup, describeGroups };
}
