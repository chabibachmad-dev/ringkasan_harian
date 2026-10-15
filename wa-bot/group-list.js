// Daftar grup WhatsApp yang dijawab bot, bisa diubah dari Telegram (/grup) TANPA membuka .env dan TANPA restart.
//
// Dua sumber digabung:
//   - .env  : WA_GROUP_ALLOWED_NAMES / WA_GROUP_ALLOWED_JIDS (nomor utama) dan WA2_GROUP_ALLOWED_* (nomor kedua) -- daftar dasar,
//             hanya bisa diubah di .env.
//   - /grup : tambahan yang disimpan di tabel bot_state (kunci wa_group_list), langsung berlaku.
//
// Perintah (satu nomor = "utama"; nomor kedua ditandai dengan kata wa2 / nomor2 / nama botnya):
//   /grup                         daftar grup yang dijawab tiap nomor (bernomor)
//   /grup semua [wa2]             grup yang diikuti nomor itu (bernomor) -- dasar untuk "tambah <nomor>"
//   /grup tambah [wa2] <nama|no>  izinkan grup (nama = potongan nama; no = nomor dari /grup semua)
//   /grup hapus [wa2] <nama|no>   cabut izin yang ditambahkan lewat /grup (no = nomor dari /grup)
// Pencocokan nama: potongan nama grup, huruf besar-kecil/emoji/tanda baca diabaikan (sama dengan WA_GROUP_ALLOWED_NAMES).

import { MAIN_ACCOUNT, SECOND_ACCOUNT, normalizeGroupName } from "./wa-accounts.js";

export const STATE_KEY = "wa_group_list";
const MIN_NAME_LEN = 3; // pencocokan memakai "memuat", nama terlalu pendek akan cocok ke banyak grup
const LISTING_TTL_MS = 30 * 60_000;

const emptyRules = () => ({ names: [], jids: [] });

/** Teks bebas -> daftar unik nama tampilan (rapi, tanpa kosong). */
function cleanName(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** "/grup ..." -> { kind, account?, arg? } */
export function parseGroupArg(arg, { secondAliases = [] } = {}) {
  const words = String(arg ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { kind: "status" };
  const verbWord = words[0].toLowerCase();
  const VERBS = {
    semua: "all", daftar: "all", all: "all", list: "all", ikut: "all",
    tambah: "add", add: "add", izinkan: "add", aktifkan: "add",
    hapus: "remove", del: "remove", remove: "remove", cabut: "remove", hilangkan: "remove"
  };
  const aliases = new Set(["wa2", "nomor2", "nomor-2", ...secondAliases.map((a) => String(a).toLowerCase()).filter(Boolean)]);
  const pickAccount = (rest) => {
    if (rest.length && aliases.has(rest[0].toLowerCase())) return { account: SECOND_ACCOUNT, rest: rest.slice(1) };
    return { account: MAIN_ACCOUNT, rest };
  };
  if (!VERBS[verbWord]) {
    // "/grup wa2" = daftar nomor kedua saja
    if (aliases.has(verbWord) && words.length === 1) return { kind: "status", account: SECOND_ACCOUNT };
    return { kind: "error", error: `"${words[0]}" tidak dikenali. Pakai: /grup, /grup semua, /grup tambah <nama>, /grup hapus <nama>` };
  }
  const kind = VERBS[verbWord];
  const { account, rest } = pickAccount(words.slice(1));
  const text = cleanName(rest.join(" "));
  if (kind === "all") return { kind, account };
  if (!text) return { kind: "error", error: kind === "add" ? "Sebutkan nama grup atau nomornya: /grup tambah Keluarga Besar  atau  /grup tambah 3 (nomor dari /grup semua)." : "Sebutkan nama atau nomor yang mau dihapus (lihat /grup)." };
  return { kind, account, arg: text };
}

/**
 * deps:
 *   state: { get(key), set(key, value) }
 *   env: { main: {names:[normalisasi], jids:[]}, wa2: {...} }       daftar dasar dari .env
 *   labels: { main: "Nomor utama", wa2: "Wongsobot" }
 *   listGroups(accountId) -> Promise<[{ id, subject }]> | null       grup yang diikuti nomor itu (null/melempar bila nomor terputus)
 *   secondEnabled: boolean
 */
export function createGroupList({ state = null, env = {}, labels = {}, listGroups = null, secondEnabled = false, log = console, now = () => Date.now() } = {}) {
  let dynamic = { [MAIN_ACCOUNT]: emptyRules(), [SECOND_ACCOUNT]: emptyRules() };
  const lastListing = new Map(); // account -> { at, groups }
  const lastStatus = new Map(); // account -> { at, entries }
  let loadedOk = !state; // true bila daftar tersimpan sudah terbaca (atau memang tidak ada penyimpanan)

  const label = (a) => labels[a] || (a === SECOND_ACCOUNT ? "Nomor 2" : "Nomor utama");
  const accounts = () => (secondEnabled ? [MAIN_ACCOUNT, SECOND_ACCOUNT] : [MAIN_ACCOUNT]);

  async function load() {
    if (!state) return;
    try {
      const raw = await state.get(STATE_KEY);
      if (!raw) {
        loadedOk = true; // belum pernah ada tambahan
        return;
      }
      const j = JSON.parse(raw);
      for (const a of [MAIN_ACCOUNT, SECOND_ACCOUNT]) {
        dynamic[a] = {
          names: Array.isArray(j?.[a]?.names) ? j[a].names.map(cleanName).filter(Boolean) : [],
          jids: Array.isArray(j?.[a]?.jids) ? j[a].jids.map((x) => String(x).trim()).filter(Boolean) : []
        };
      }
      loadedOk = true;
    } catch (e) {
      log.warn?.(`👥 [Daftar grup] gagal membaca daftar tersimpan (pakai .env saja): ${e instanceof Error ? e.message : e}`);
    }
  }

  async function save() {
    if (!state) return false;
    try {
      await state.set(STATE_KEY, JSON.stringify(dynamic));
      return true;
    } catch (e) {
      log.warn?.(`👥 [Daftar grup] gagal menyimpan: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /** Aturan efektif (sinkron, dipakai tiap pesan grup): gabungan .env + tambahan. */
  function rules(accountId) {
    const a = accountId === SECOND_ACCOUNT ? SECOND_ACCOUNT : MAIN_ACCOUNT;
    const base = env[a] || emptyRules();
    const names = [...new Set([...(base.names || []), ...dynamic[a].names.map(normalizeGroupName)].filter(Boolean))];
    const jids = [...new Set([...(base.jids || []), ...dynamic[a].jids])];
    return { enabled: names.length > 0 || jids.length > 0, names, jids };
  }

  /** Entri bernomor untuk tampilan/penghapusan: { text, source: "env"|"tg", kind: "name"|"jid", value } */
  function entries(a) {
    const base = env[a] || emptyRules();
    const out = [];
    for (const n of base.names || []) out.push({ text: n, source: "env", kind: "name", value: n });
    for (const j of base.jids || []) out.push({ text: j, source: "env", kind: "jid", value: j });
    for (const n of dynamic[a].names) out.push({ text: n, source: "tg", kind: "name", value: n });
    for (const j of dynamic[a].jids) {
      const known = (lastListing.get(a)?.groups || []).find((g) => g.id === j);
      out.push({ text: known ? `${known.subject}` : j, source: "tg", kind: "jid", value: j });
    }
    return out;
  }

  function statusText(only = null) {
    const parts = [];
    for (const a of only ? [only] : accounts()) {
      const list = entries(a);
      lastStatus.set(a, { at: now(), entries: list });
      const lines = list.length
        ? list.map((e, i) => `${i + 1}. ${e.text}${e.source === "env" ? " (.env, tidak bisa dihapus dari sini)" : ""}`)
        : ["(belum ada — bot tidak menjawab di grup mana pun)"];
      parts.push(`👥 *Grup yang dijawab — ${label(a)}*\n${lines.join("\n")}`);
    }
    parts.push("/grup semua — lihat grup yang diikuti nomor ini\n/grup tambah <nama atau nomor>\n/grup hapus <nama atau nomor>" + (secondEnabled ? "\n(untuk nomor kedua tambahkan kata wa2, mis. /grup tambah wa2 Arisan RT)" : ""));
    return parts.join("\n\n");
  }

  async function fetchGroups(a) {
    if (!listGroups) throw new Error("Daftar grup belum tersedia di bot ini.");
    let groups;
    try {
      groups = await listGroups(a);
    } catch (e) {
      throw new Error(`Tidak bisa mengambil daftar grup ${label(a)} (${e instanceof Error ? e.message : e}).`);
    }
    if (!groups) throw new Error(`${label(a)} sedang tidak tersambung ke WhatsApp.`);
    const sorted = [...groups].sort((x, y) => String(x.subject).localeCompare(String(y.subject), "id"));
    lastListing.set(a, { at: now(), groups: sorted });
    return sorted;
  }

  const isAllowedNow = (a, g) => {
    const r = rules(a);
    if (r.jids.includes(g.id)) return true;
    const n = normalizeGroupName(g.subject);
    return n !== "" && r.names.some((x) => n.includes(x));
  };

  async function listAll(a) {
    const groups = await fetchGroups(a);
    if (groups.length === 0) return `${label(a)} belum mengikuti grup apa pun.`;
    const lines = groups.map((g, i) => `${i + 1}. ${g.subject || "(tanpa nama)"}${isAllowedNow(a, g) ? " ✅" : ""}`);
    return `👥 *Grup yang diikuti ${label(a)}* (✅ = sudah dijawab)\n${lines.join("\n")}\n\nTambah dengan nomor: /grup tambah${a === SECOND_ACCOUNT ? " wa2" : ""} <nomor>`;
  }

  async function add(a, arg) {
    // Nomor dari /grup semua?
    if (/^\d{1,4}$/.test(arg)) {
      const listing = lastListing.get(a);
      if (!listing || now() - listing.at > LISTING_TTL_MS) return `Jalankan dulu /grup semua${a === SECOND_ACCOUNT ? " wa2" : ""} supaya nomornya jelas, lalu tambah dengan nomornya.`;
      const g = listing.groups[Number(arg) - 1];
      if (!g) return `Tidak ada grup nomor ${arg} di daftar terakhir (1–${listing.groups.length}).`;
      if (isAllowedNow(a, g)) return `"${g.subject}" sudah dijawab di ${label(a)}.`;
      dynamic[a].jids.push(g.id);
      const saved = await save();
      return `✅ ${label(a)} sekarang menjawab di grup "${g.subject}" (langsung berlaku).${saved ? "" : "\n⚠️ Gagal menyimpan ke database: berlaku sampai bot restart saja."}`;
    }
    const norm = normalizeGroupName(arg);
    if (norm.length < MIN_NAME_LEN) return `Nama "${arg}" terlalu pendek (minimal ${MIN_NAME_LEN} huruf/angka); nama dicocokkan sebagai potongan nama grup, jadi bisa mengenai banyak grup.`;
    if (rules(a).names.includes(norm)) return `Nama itu sudah ada di daftar ${label(a)}.`;
    dynamic[a].names.push(cleanName(arg));
    const saved = await save();
    let note = "";
    try {
      const groups = await fetchGroups(a);
      const hit = groups.filter((g) => normalizeGroupName(g.subject).includes(norm));
      note = hit.length === 0 ? `\n⚠️ Belum ada grup di ${label(a)} yang namanya memuat "${arg}" (tetap disimpan).` : `\nCocok dengan: ${hit.slice(0, 5).map((g) => `"${g.subject}"`).join(", ")}${hit.length > 5 ? `, +${hit.length - 5} lagi` : ""}.`;
    } catch {
      // nomor terputus: tidak bisa memeriksa, abaikan
    }
    return `✅ ${label(a)} sekarang menjawab di grup yang namanya memuat "${cleanName(arg)}" (langsung berlaku).${note}${saved ? "" : "\n⚠️ Gagal menyimpan ke database: berlaku sampai bot restart saja."}`;
  }

  async function remove(a, arg) {
    let target = null;
    if (/^\d{1,4}$/.test(arg)) {
      const st = lastStatus.get(a);
      if (!st || now() - st.at > LISTING_TTL_MS) return `Lihat daftar dulu dengan /grup${a === SECOND_ACCOUNT ? " wa2" : ""}, lalu hapus dengan nomornya.`;
      target = st.entries[Number(arg) - 1];
      if (!target) return `Tidak ada nomor ${arg} di daftar (1–${st.entries.length}).`;
    } else {
      const norm = normalizeGroupName(arg);
      target = entries(a).find((e) => e.kind === "name" && normalizeGroupName(e.value) === norm) || entries(a).find((e) => e.kind === "jid" && e.value === arg);
      if (!target) return `Tidak ada "${arg}" di daftar ${label(a)}. Lihat /grup.`;
    }
    if (target.source === "env") return `"${target.text}" berasal dari .env, jadi hanya bisa dihapus dengan mengubah .env di laptop (WA${a === SECOND_ACCOUNT ? "2" : ""}_GROUP_ALLOWED_*).`;
    const list = target.kind === "name" ? dynamic[a].names : dynamic[a].jids;
    const i = list.indexOf(target.value);
    if (i < 0) return "Sudah tidak ada di daftar.";
    list.splice(i, 1);
    lastStatus.delete(a);
    const saved = await save();
    return `🗑️ "${target.text}" dicabut dari daftar ${label(a)} (langsung berlaku; bot tidak menjawab di grup itu lagi).${saved ? "" : "\n⚠️ Gagal menyimpan ke database: berlaku sampai bot restart saja."}`;
  }

  /** Teks balasan untuk perintah /grup. Tidak melempar galat. */
  async function handle(arg, { secondAliases = [] } = {}) {
    const p = parseGroupArg(arg, { secondAliases });
    if (p.kind === "error") return p.error;
    if (p.account === SECOND_ACCOUNT && !secondEnabled) return "Nomor kedua belum dinyalakan (isi WA2_NUMBER di .env).";
    try {
      if ((p.kind === "add" || p.kind === "remove") && !loadedOk) {
        // Jangan menimpa daftar tersimpan yang belum terbaca (mis. database sedang bermasalah).
        await load();
        if (!loadedOk) return "⚠️ Daftar grup tersimpan belum bisa dibaca dari database, jadi perubahan ditunda supaya daftar lama tidak tertimpa. Coba lagi sebentar lagi.";
      }
      if (p.kind === "status") return statusText(p.account || null);
      if (p.kind === "all") return await listAll(p.account);
      if (p.kind === "add") return await add(p.account, p.arg);
      if (p.kind === "remove") return await remove(p.account, p.arg);
    } catch (e) {
      return `⚠️ ${e instanceof Error ? e.message : e}`;
    }
    return "Perintah tidak dikenali.";
  }

  return { load, rules, handle, statusText };
}
