// ================================================================
// Perekaman kegiatan SiMAB lewat WhatsApp (HANYA dari pemilik).
//
// Alur (satu sesi per chat, kedaluwarsa 10 menit tanpa balasan):
//   simab rekam <seksi>
//     1. daftar KELOMPOK POK milik seksi itu (3 segmen kode, mis. 4701.EBA.002) -> balas angka
//     2. daftar kode MAK paling panjang (tidak punya turunan) di kelompok itu, lengkap
//        dengan sisa pagu -> balas angka
//     3. kirim 3 baris: uraian, tanggal dokumen, jumlah
//     4. ringkasan + peringatan bila melewati sisa pagu -> balas "ya" untuk menyimpan
//   Status otomatis "Rekam Data". ID kegiatan (10 huruf/angka acak) dibuat di database.
//
// Penulisan TIDAK lewat INSERT biasa: akun bot di database tetap baca-saja. Satu-satunya
// jalan tulis adalah fungsi bot_rekam_kegiatan (lihat simab-bot-rekam.sql) yang
// hanya bisa memasukkan SATU baris berstatus "Rekam Data" dan memeriksa ulang kodenya.
// ================================================================

export const SEKSI = ["Umum", "PKN", "PN", "HI", "KI", "Lelang", "Penilaian"];

const PAGE_SIZE = 10;
const IN_CHUNK = 80;
const PAGE_PAGES = new Set(["lanjut", "next", "n"]);
const BACK_PAGES = new Set(["balik", "prev", "p"]);
const YES = new Set(["ya", "y", "iya", "ok", "oke", "simpan", "yes"]);
const MONTH3 = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };

// ---------- pengurai (murni, diuji terpisah) ----------
export function parseSeksi(arg) {
  const t = String(arg ?? "")
    .trim()
    .replace(/^seksi\s+/i, "")
    .toLowerCase();
  return SEKSI.find((s) => s.toLowerCase() === t) ?? null;
}

function isoDate(y, m, d) {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// -> "YYYY-MM-DD" atau null. `today` = "YYYY-MM-DD" (zona waktu pemilik).
export function parseTanggal(text, { tahun, today } = {}) {
  const s = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (s === "hari ini" || s === "today") return today ?? null;
  const defYear = Number(tahun) || Number(String(today ?? "").slice(0, 4)) || null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m && defYear) return isoDate(defYear, Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?$/);
  if (m) {
    const mon = MONTH3[m[2].slice(0, 3)];
    const y = m[3] ? Number(m[3]) : defYear;
    if (mon && y) return isoDate(y, mon, Number(m[1]));
  }
  return null;
}

// "1.500.000", "Rp 1.500.000,-", "1500000", "1,5jt", "500rb" -> bilangan bulat rupiah atau null.
export function parseJumlah(text) {
  const s = String(text ?? "")
    .toLowerCase()
    .replace(/rp\.?/g, "")
    .replace(/\s+/g, "")
    .replace(/[,.]-$/, "")
    .replace(/-$/, "");
  const m = s.match(/^([\d.,]+)(jt|juta|rb|ribu|k|miliar)?$/);
  if (!m) return null;
  let n;
  if (m[2]) {
    const mult = m[2] === "jt" || m[2] === "juta" ? 1e6 : m[2] === "miliar" ? 1e9 : 1e3;
    const base = m[1].replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(base)) return null;
    n = parseFloat(base) * mult;
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(m[1])) {
    n = Number(m[1].replace(/[.,]/g, ""));
  } else if (/^\d+$/.test(m[1])) {
    n = Number(m[1]);
  } else if (/^\d+[.,]\d{1,2}$/.test(m[1])) {
    n = parseFloat(m[1].replace(",", "."));
  } else {
    return null;
  }
  n = Math.round(n);
  return Number.isFinite(n) && n > 0 && n <= 9_999_999_999_999 ? n : null;
}

const INPUT_FORMAT = `Kirim *3 baris dalam satu pesan*:
1️⃣ uraian
2️⃣ tanggal dokumen
3️⃣ jumlah

Contoh:
Pembelian ATK bulan Oktober
5/10/2026
1.500.000`;

// Baris terakhir = jumlah, sebelumnya = tanggal, sisanya = uraian. Boleh juga satu baris
// dipisah titik koma. -> { ok, uraian, tgl, jumlah } | { ok:false, error }
export function parseInput(text, { tahun, today } = {}) {
  let lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) {
    const alt = String(text ?? "")
      .split(/[;|]/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (alt.length >= 3) lines = alt;
  }
  if (lines.length < 3) return { ok: false, error: `Datanya kurang: butuh uraian, tanggal, dan jumlah.\n\n${INPUT_FORMAT}` };
  const jumlahTxt = lines[lines.length - 1];
  const tglTxt = lines[lines.length - 2];
  const uraian = lines.slice(0, -2).join(" ").replace(/\s+/g, " ").trim();
  const problems = [];
  if (uraian.length < 3) problems.push("uraian terlalu pendek");
  if (uraian.length > 300) problems.push("uraian terlalu panjang (maks 300 karakter)");
  const tgl = parseTanggal(tglTxt, { tahun, today });
  if (!tgl) problems.push(`tanggal “${tglTxt}” tidak terbaca (contoh: 5/10/2026 atau 5 okt 2026)`);
  const jumlah = parseJumlah(jumlahTxt);
  if (!jumlah) problems.push(`jumlah “${jumlahTxt}” tidak terbaca (contoh: 1.500.000 atau 1,5jt)`);
  if (problems.length > 0) return { ok: false, error: `Belum bisa dibaca: ${problems.join("; ")}.\n\nKirim ulang 3 baris (uraian, tanggal, jumlah).` };
  return { ok: true, uraian, tgl, jumlah };
}

// Kelompok = 3 segmen pertama kode (4701.EBA.002). Kode < 3 segmen tidak punya kelompok.
export function groupKey(kode) {
  const seg = String(kode ?? "").split(".");
  return seg.length >= 3 ? seg.slice(0, 3).join(".") : null;
}

function pageOf(items, page) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), pages - 1);
  return { p, pages, slice: items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE), start: p * PAGE_SIZE };
}

const chunks = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ---------- alur percakapan ----------
// deps: { exec, fetchAll, getClient, scope, kantorId, currentTahun, head, rp, cut, fmtDate, today(),
//         user, ttlMs, now }
export function createRekamFlow(deps) {
  const { exec, fetchAll, getClient, scope, kantorId, currentTahun, head, rp, cut, fmtDate, today, user = "Bot WhatsApp", ttlMs = 10 * 60_000, now = Date.now } = deps;
  const sessions = new Map();

  function live(key) {
    const s = sessions.get(key);
    if (!s) return null;
    if (s.exp < now()) {
      sessions.delete(key);
      return null;
    }
    return s;
  }
  const touch = (s) => {
    s.exp = now() + ttlMs;
  };

  const hasSession = (key) => !!live(key);
  const cancel = (key) => sessions.delete(key);

  // sisa = pagu(semua seksi) - blokir - realisasi, per kode.
  async function computeSisa(kodes, tahun) {
    const out = new Map(kodes.map((k) => [k, { pagu: 0, blokir: 0, real: 0 }]));
    for (const part of chunks(kodes, IN_CHUNK)) {
      const pk = await fetchAll(() => scope(getClient().from("pok").select("kode,pagu"), tahun).in("kode", part));
      for (const r of pk) {
        const e = out.get(r.kode);
        if (e) e.pagu += Number(r.pagu) || 0;
      }
      const bl = await fetchAll(() => scope(getClient().from("blokir").select("id,nilai"), tahun).in("id", part));
      for (const r of bl) {
        const e = out.get(r.id);
        if (e) e.blokir += Number(r.nilai) || 0;
      }
      const kg = await fetchAll(() => scope(getClient().from("kegiatan").select("mak,jumlah"), tahun).in("mak", part));
      for (const r of kg) {
        const e = out.get(r.mak);
        if (e) e.real += Number(r.jumlah) || 0;
      }
    }
    for (const e of out.values()) e.sisa = e.pagu - e.blokir - e.real;
    return out;
  }

  // ----- tampilan -----
  function renderGroups(s) {
    const { p, pages, slice, start } = pageOf(s.groups, s.groupPage);
    s.groupPage = p;
    const lines = [`📋 *Rekam kegiatan — Seksi ${s.seksi}*`, head(s.tahun), `${s.groups.length} kelompok POK`, ""];
    slice.forEach((g, i) => {
      lines.push(`${start + i + 1}. *${g.key}*${g.uraian ? ` — ${cut(g.uraian, 70)}` : ""}`);
      if (g.pagu) lines.push(`   pagu seksi ${rp(g.pagu)}`);
    });
    lines.push("", `Balas *angka* untuk memilih kelompok${pages > 1 ? ` • *lanjut* / *balik* (hal ${p + 1}/${pages})` : ""} • *batal*`);
    return lines.join("\n");
  }

  function renderLeaves(s) {
    const g = s.group;
    const { p, pages, slice, start } = pageOf(s.leaves, s.leafPage);
    s.leafPage = p;
    const lines = [`📂 *${g.key}*${g.uraian ? ` — ${cut(g.uraian, 80)}` : ""}`, `Seksi ${s.seksi} • ${s.leaves.length} kode MAK (terpanjang)`, ""];
    slice.forEach((l, i) => {
      lines.push(`${start + i + 1}. *${l.kode}*`);
      if (l.uraian) lines.push(`   ${cut(l.uraian, 90)}`);
      lines.push(`   pagu ${rp(l.pagu)} • sisa *${rp(l.sisa)}*${l.sisa <= 0 ? " ⚠️" : ""}`);
    });
    lines.push("", `Balas *angka* untuk memilih kode MAK${pages > 1 ? ` • *lanjut* / *balik* (hal ${p + 1}/${pages})` : ""} • *kembali* • *batal*`);
    return lines.join("\n");
  }

  function renderInputPrompt(s) {
    const l = s.leaf;
    return [`✅ *${l.kode}*`, l.uraian ? `_${cut(l.uraian, 120)}_` : null, `Sisa pagu: *${rp(l.sisa)}*`, "", INPUT_FORMAT, "", "*kembali* untuk memilih kode lain • *batal*"].filter((x) => x !== null).join("\n");
  }

  function renderConfirm(s) {
    const d = s.draft;
    const after = s.leaf.sisa - d.jumlah;
    const lines = [
      "📝 *Konfirmasi rekam kegiatan*",
      head(s.tahun),
      "",
      `Seksi: ${s.seksi}`,
      `MAK: *${s.leaf.kode}*`,
      `Uraian: ${d.uraian}`,
      `Tgl dokumen: ${fmtDate(d.tgl)}`,
      `Jumlah: *${rp(d.jumlah)}*`,
      "Status: Rekam Data",
      "",
      `Sisa pagu sekarang ${rp(s.leaf.sisa)} → sesudah rekam ${rp(after)}`
    ];
    if (after < 0) lines.push("", `⚠️ *Melebihi sisa pagu sebesar ${rp(-after)}.* Tetap disimpan hanya kalau kamu membalas *ya*.`);
    lines.push("", "Balas *ya* untuk menyimpan • *ubah* untuk mengisi ulang • *batal*");
    return lines.join("\n");
  }

  // ----- tahap -----
  async function start(key, arg, tahunOverride) {
    const seksi = parseSeksi(arg);
    if (!seksi) {
      return `Sebutkan seksinya. Contoh: *simab rekam Umum*\n\nSeksi: ${SEKSI.join(", ")}`;
    }
    const tahun = await currentTahun(tahunOverride);
    const rows = await fetchAll(() => scope(getClient().from("pok").select("id,kode,uraian,pagu,seksi"), tahun).ilike("seksi", seksi));
    if (rows.length === 0) {
      const all = await fetchAll(() => scope(getClient().from("pok").select("seksi"), tahun));
      const ada = [...new Set(all.map((r) => String(r.seksi ?? "").trim()).filter(Boolean))].sort();
      return `Tidak ada baris POK untuk seksi “${seksi}”.\n${head(tahun)}\n\n${ada.length > 0 ? `Isi kolom seksi di POK: ${ada.join(", ")}` : "Kolom seksi di POK kosong semua."}`;
    }
    const byKey = new Map();
    for (const r of rows) {
      const k = groupKey(r.kode);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, { key: k, uraian: "", pagu: 0 });
      byKey.get(k).pagu += Number(r.pagu) || 0;
    }
    const keys = [...byKey.keys()].sort();
    if (keys.length === 0) return `Baris POK seksi ${seksi} ada, tetapi kodenya tidak berformat bertingkat.\n${head(tahun)}`;
    for (const part of chunks(keys, IN_CHUNK)) {
      const hd = await fetchAll(() => scope(getClient().from("pok").select("kode,uraian"), tahun).in("kode", part));
      for (const r of hd) {
        const g = byKey.get(r.kode);
        if (g && !g.uraian && r.uraian) g.uraian = r.uraian;
      }
    }
    const s = { stage: "group", seksi, tahun, groups: keys.map((k) => byKey.get(k)), groupPage: 0, exp: 0 };
    touch(s);
    sessions.set(key, s);
    return renderGroups(s);
  }

  async function pickGroup(s, idx) {
    const g = s.groups[idx];
    const kids = await fetchAll(() => scope(getClient().from("pok").select("id,kode,uraian,pagu,seksi"), s.tahun).like("kode", `${g.key}%`));
    const rows = kids.filter((r) => r.kode === g.key || String(r.kode).startsWith(`${g.key}.`));
    const kodes = new Set(rows.map((r) => r.kode));
    const isLeaf = (k) => ![...kodes].some((o) => o !== k && o.startsWith(`${k}.`));
    const mine = new Set(rows.filter((r) => String(r.seksi ?? "").trim().toLowerCase() === s.seksi.toLowerCase()).map((r) => r.kode));
    const leafKodes = [...mine].filter(isLeaf).sort();
    if (leafKodes.length === 0) return `Tidak ada kode MAK terpanjang milik seksi ${s.seksi} di ${g.key}.\n\n${renderGroups(s)}`;
    const uraian = new Map();
    for (const r of rows) if (r.uraian && !uraian.has(r.kode)) uraian.set(r.kode, r.uraian);
    const sisa = await computeSisa(leafKodes, s.tahun);
    s.group = g;
    s.leaves = leafKodes.map((k) => ({ kode: k, uraian: uraian.get(k) ?? "", ...sisa.get(k) }));
    s.leafPage = 0;
    s.stage = "leaf";
    return renderLeaves(s);
  }

  async function pickLeaf(s, idx) {
    const leaf = s.leaves[idx];
    // Segarkan sisa pagu (bisa berubah sejak daftar dibuat).
    const fresh = (await computeSisa([leaf.kode], s.tahun)).get(leaf.kode);
    s.leaf = { ...leaf, ...fresh };
    s.stage = "input";
    return renderInputPrompt(s);
  }

  async function save(key, s) {
    const d = s.draft;
    try {
      const id = await exec(() =>
        getClient().rpc("bot_rekam_kegiatan", {
          p_kantor_id: String(kantorId),
          p_tahun: s.tahun,
          p_mak: s.leaf.kode,
          p_uraian: d.uraian,
          p_tgl_st: d.tgl,
          p_jumlah: d.jumlah,
          p_user: user
        })
      );
      sessions.delete(key);
      const newId = typeof id === "string" ? id : Array.isArray(id) ? "" : String(id ?? "");
      return [
        "✅ *Tersimpan di SiMAB*",
        newId ? `ID kegiatan: *${newId}*` : null,
        `MAK: ${s.leaf.kode}`,
        `Uraian: ${d.uraian}`,
        `Tgl dokumen: ${fmtDate(d.tgl)} • Jumlah: *${rp(d.jumlah)}*`,
        "Status: Rekam Data",
        "",
        "_Rekam lagi: ketik *simab rekam <seksi>*_"
      ]
        .filter((x) => x !== null)
        .join("\n");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (/could not find the function|bot_rekam_kegiatan.*does not exist|schema cache/i.test(m)) {
        sessions.delete(key);
        return "⚠️ Fungsi perekaman belum dipasang di database SiMAB. Jalankan *simab-bot-rekam.sql* di SQL Editor project SiMAB, lalu coba lagi.";
      }
      if (/tidak ada di POK|bukan kode terpanjang|sama persis|Hanya akun bot|permission denied/i.test(m)) {
        sessions.delete(key);
        return `⚠️ Ditolak database: ${m.slice(0, 250)}\nSesi dibatalkan.`;
      }
      touch(s);
      return `⚠️ Gagal menyimpan: ${m.slice(0, 250)}\nBalas *ya* untuk mencoba lagi, atau *batal*.`;
    }
  }

  // Balasan pemilik selagi sesi aktif. Mengembalikan teks jawaban, atau null kalau tidak ada sesi.
  async function handle(key, rawText) {
    const s = live(key);
    if (!s) return null;
    touch(s);
    const text = String(rawText ?? "").trim();
    const low = text.toLowerCase();

    if (["batal", "cancel", "stop"].includes(low)) {
      sessions.delete(key);
      return "Perekaman dibatalkan. Tidak ada yang disimpan.";
    }

    if (s.stage === "group" || s.stage === "leaf") {
      const isGroup = s.stage === "group";
      const list = isGroup ? s.groups : s.leaves;
      const pageKey = isGroup ? "groupPage" : "leafPage";
      if (PAGE_PAGES.has(low)) {
        s[pageKey] += 1;
        return isGroup ? renderGroups(s) : renderLeaves(s);
      }
      if (BACK_PAGES.has(low)) {
        s[pageKey] -= 1;
        return isGroup ? renderGroups(s) : renderLeaves(s);
      }
      if (!isGroup && (low === "kembali" || low === "back")) {
        s.stage = "group";
        return renderGroups(s);
      }
      const m = low.match(/^(?:pilih\s*)?(\d{1,3})$/);
      if (!m) return `Sesi rekam masih aktif. Balas *angka* 1–${list.length}${isGroup ? "" : ", *kembali*"} atau *batal*.`;
      const n = Number(m[1]);
      if (n < 1 || n > list.length) return `Angka di luar daftar. Pilih 1–${list.length}, atau *batal*.`;
      return isGroup ? pickGroup(s, n - 1) : pickLeaf(s, n - 1);
    }

    if (s.stage === "input") {
      if (low === "kembali" || low === "back") {
        s.stage = "leaf";
        return renderLeaves(s);
      }
      const parsed = parseInput(text, { tahun: s.tahun, today: today() });
      if (!parsed.ok) return parsed.error;
      const fresh = (await computeSisa([s.leaf.kode], s.tahun)).get(s.leaf.kode);
      s.leaf = { ...s.leaf, ...fresh };
      s.draft = { uraian: parsed.uraian, tgl: parsed.tgl, jumlah: parsed.jumlah };
      s.stage = "confirm";
      return renderConfirm(s);
    }

    if (s.stage === "confirm") {
      if (YES.has(low)) return save(key, s);
      if (low === "ubah" || low === "ulang" || low === "edit") {
        s.stage = "input";
        return renderInputPrompt(s);
      }
      return "Balas *ya* untuk menyimpan, *ubah* untuk mengisi ulang, atau *batal*.";
    }
    return null;
  }

  return { start, handle, hasSession, cancel };
}
