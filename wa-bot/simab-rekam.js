// ================================================================
// Perekaman, perubahan, dan penghapusan kegiatan SiMAB lewat WhatsApp
// (HANYA dari pemilik).
//
// REKAM  -- simab rekam <seksi>
//   1. daftar KELOMPOK POK milik seksi itu (3 segmen kode, mis. 4701.EBA.002) -> balas angka
//      (atau "cari <kata>" untuk langsung mencari kode MAK di seluruh seksi)
//   2. daftar kode MAK paling panjang (tidak punya turunan), lengkap dengan sisa pagu
//      -> balas angka ("cari <kata>" menyaring daftar, "semua" mengembalikan)
//   3. kirim 3 baris: uraian, tanggal dokumen, jumlah
//   4. ringkasan + peringatan bila melewati sisa pagu -> balas "ya" untuk menyimpan
//   Status otomatis "Rekam Data". ID kegiatan (10 huruf/angka acak) dibuat di database.
//
// UBAH / HAPUS -- simab ubah | simab hapus [id]
//   Hanya kegiatan yang direkam lewat bot dan MASIH berstatus "Rekam Data". Daftar
//   terbaru ditampilkan -> pilih angka -> ubah (uraian/tanggal/jumlah) atau hapus,
//   keduanya dengan konfirmasi.
//
// Penulisan TIDAK lewat INSERT/UPDATE/DELETE biasa: akun bot di database tetap baca-saja.
// Satu-satunya jalan tulis adalah fungsi bot_rekam_kegiatan / bot_ubah_kegiatan /
// bot_hapus_kegiatan (lihat simab-bot-rekam.sql) yang memeriksa ulang semua syaratnya.
// ================================================================

export const SEKSI = ["Umum", "PKN", "PN", "HI", "KI", "Lelang", "Penilaian"];

const PAGE_SIZE = 10;
const IN_CHUNK = 80;
const LIST_LIMIT = 10;
const NEXT = new Set(["lanjut", "next", "n"]);
const PREV = new Set(["balik", "prev", "p"]);
const YES = new Set(["ya", "y", "iya", "ok", "oke", "simpan", "yes"]);
const CLEAR_FILTER = new Set(["semua", "reset", "all"]);
const MONTH3 = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
const ID_RE = /^[A-Za-z0-9]{10}$/;

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

// Perubahan sebagian: tiap baris berawalan "uraian", "tanggal"/"tgl", atau "jumlah".
// -> { ok, patch:{uraian?,tgl?,jumlah?} } | { ok:false, error } | null (bukan format sebagian)
export function parsePatch(text, { tahun, today } = {}) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const re = /^(uraian|tanggal|tgl|jumlah|nominal)\s*[:=]?\s+(.+)$/i;
  if (!lines.every((l) => re.test(l))) return null;
  const patch = {};
  const problems = [];
  for (const l of lines) {
    const [, field, value] = l.match(re);
    const f = field.toLowerCase();
    if (f === "uraian") {
      const u = value.replace(/\s+/g, " ").trim();
      if (u.length < 3 || u.length > 300) problems.push("uraian harus 3–300 karakter");
      else patch.uraian = u;
    } else if (f === "tanggal" || f === "tgl") {
      const t = parseTanggal(value, { tahun, today });
      if (!t) problems.push(`tanggal “${value}” tidak terbaca`);
      else patch.tgl = t;
    } else {
      const j = parseJumlah(value);
      if (!j) problems.push(`jumlah “${value}” tidak terbaca`);
      else patch.jumlah = j;
    }
  }
  if (problems.length > 0) return { ok: false, error: `Belum bisa dibaca: ${problems.join("; ")}.` };
  return { ok: true, patch };
}

// Kelompok = 3 segmen pertama kode (4701.EBA.002). Kode < 3 segmen tidak punya kelompok.
export function groupKey(kode) {
  const seg = String(kode ?? "").split(".");
  return seg.length >= 3 ? seg.slice(0, 3).join(".") : null;
}

// Pencarian cepat: SEMUA kata harus ada (urutan bebas, huruf besar/kecil diabaikan).
export function searchTerms(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}
export function matchesTerms(haystack, terms) {
  const h = String(haystack ?? "").toLowerCase();
  return terms.every((t) => h.includes(t));
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

const MISSING_FN_RE = /could not find the function|schema cache|does not exist/i;
const REFUSAL_RE = /tidak ada di POK|bukan kode terpanjang|sama persis|Hanya akun bot|permission denied|tidak ditemukan|sudah diproses|tidak ada perubahan/i;

// ---------- alur percakapan ----------
// deps: { exec, fetchAll, getClient, scope, kantorId, currentTahun, head, rp, cut, fmtDate, today(),
//         user, ttlMs, now }
export function createRekamFlow(deps) {
  const { exec, fetchAll, getClient, scope, kantorId, currentTahun, head, rp, cut, fmtDate, today, user = "Bot WhatsApp", ttlMs = 10 * 60_000, now = Date.now, meteraiMak = [], meteraiKata = ["meterai", "materai"], meteraiUraian = "Pembelian meterai" } = deps;
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

  // sisa = pagu(semua seksi) - blokir - realisasi. Pagu dari baris POK yang sudah dimuat.
  async function fillSisa(items, tahun) {
    const todo = items.filter((l) => l.sisa === undefined);
    if (todo.length === 0) return;
    await refreshSisa(todo, tahun);
  }
  async function refreshSisa(items, tahun) {
    const kodes = items.map((l) => l.kode);
    const bl = new Map(kodes.map((k) => [k, 0]));
    const rl = new Map(kodes.map((k) => [k, 0]));
    for (const part of chunks(kodes, IN_CHUNK)) {
      for (const r of await fetchAll(() => scope(getClient().from("blokir").select("id,nilai"), tahun).in("id", part))) {
        if (bl.has(r.id)) bl.set(r.id, bl.get(r.id) + (Number(r.nilai) || 0));
      }
      for (const r of await fetchAll(() => scope(getClient().from("kegiatan").select("mak,jumlah"), tahun).in("mak", part))) {
        if (rl.has(r.mak)) rl.set(r.mak, rl.get(r.mak) + (Number(r.jumlah) || 0));
      }
    }
    for (const l of items) {
      l.blokir = bl.get(l.kode);
      l.real = rl.get(l.kode);
      l.sisa = (l.pagu || 0) - l.blokir - l.real;
    }
  }

  // ----- tampilan: rekam -----
  function renderGroups(s) {
    const { p, pages, slice, start } = pageOf(s.groups, s.groupPage);
    s.groupPage = p;
    const lines = [`📋 *Rekam kegiatan — Seksi ${s.seksi}*`, head(s.tahun), `${s.groups.length} kelompok POK • ${s.allLeaves.length} kode MAK`, ""];
    slice.forEach((g, i) => {
      lines.push(`${start + i + 1}. *${g.key}*${g.uraian ? ` — ${cut(g.uraian, 70)}` : ""}`);
      if (g.pagu) lines.push(`   pagu seksi ${rp(g.pagu)}`);
    });
    lines.push("", `Balas *angka* untuk memilih kelompok${pages > 1 ? ` • *lanjut* / *balik* (hal ${p + 1}/${pages})` : ""}`, "Atau *cari <kata>* untuk langsung mencari kode MAK, mis. *cari listrik* • *batal*");
    return lines.join("\n");
  }

  function leafView(s) {
    const base = s.group ? s.allLeaves.filter((l) => l.group === s.group.key) : s.allLeaves;
    return s.leafTerm ? base.filter((l) => matchesTerms(`${l.kode} ${l.uraian}`, searchTerms(s.leafTerm))) : base;
  }

  async function renderLeaves(s) {
    const view = leafView(s);
    const { p, pages, slice, start } = pageOf(view, s.leafPage);
    s.leafPage = p;
    await fillSisa(slice, s.tahun);
    const title = s.quick ? s.quick.title : s.group ? `📂 *${s.group.key}*${s.group.uraian ? ` — ${cut(s.group.uraian, 80)}` : ""}` : `🔎 *Pencarian kode MAK — Seksi ${s.seksi}*`;
    const lines = [title, `${s.quick ? head(s.tahun) : `Seksi ${s.seksi}`} • ${view.length} kode MAK (terpanjang)${s.leafTerm ? ` • filter “${s.leafTerm}”` : ""}`, ""];
    slice.forEach((l, i) => {
      lines.push(`${start + i + 1}. *${l.kode}*`);
      if (l.uraian) lines.push(`   ${cut(l.uraian, 90)}`);
      lines.push(`   pagu ${rp(l.pagu)} • sisa *${rp(l.sisa)}*${l.sisa <= 0 ? " ⚠️" : ""}`);
    });
    lines.push("", `Balas *angka* untuk memilih kode MAK${pages > 1 ? ` • *lanjut* / *balik* (hal ${p + 1}/${pages})` : ""}`, `*cari <kata>* menyaring${s.leafTerm ? " • *semua* menghapus filter" : ""} • *kembali* • *batal*`);
    return lines.join("\n");
  }

  function renderInputPrompt(s) {
    const l = s.leaf;
    if (s.quick) {
      const defU = s.quick.defaultUraian ?? l.uraian ?? "";
      return [
        `${s.quick.icon} *${s.quick.label}*`,
        `MAK: *${l.kode}*`,
        l.uraian ? `_${cut(l.uraian, 120)}_` : null,
        head(s.tahun),
        "",
        `Pagu: ${rp(l.pagu)}`,
        `Blokir: ${rp(l.blokir ?? 0)}`,
        `Realisasi: ${rp(l.real ?? 0)}`,
        `*Sisa: ${rp(l.sisa)}*`,
        "",
        `Cukup kirim *jumlah* saja (uraian “${cut(defU, 80)}”, tanggal hari ini), atau:`,
        INPUT_FORMAT,
        "",
        "*kembali* • *batal*"
      ]
        .filter((x) => x !== null)
        .join("\n");
    }
    return [`✅ *${l.kode}*`, l.uraian ? `_${cut(l.uraian, 120)}_` : null, `Sisa pagu: *${rp(l.sisa)}*`, "", INPUT_FORMAT, "", "*kembali* untuk memilih kode lain • *batal*"].filter((x) => x !== null).join("\n");
  }

  function renderConfirm(s) {
    const d = s.draft;
    const after = s.leaf.sisa - d.jumlah;
    const lines = [
      "📝 *Konfirmasi rekam kegiatan*",
      head(s.tahun),
      "",
      s.quick ? `Jenis: ${s.quick.label}` : `Seksi: ${s.seksi}`,
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

  // ----- tahap: rekam -----
  async function loadPok(tahun) {
    const all = await fetchAll(() => scope(getClient().from("pok").select("id,kode,uraian,pagu,seksi"), tahun));
    const uraianOf = new Map();
    const paguOf = new Map();
    const kodes = new Set();
    for (const r of all) {
      kodes.add(r.kode);
      if (r.uraian && !uraianOf.has(r.kode)) uraianOf.set(r.kode, r.uraian);
      paguOf.set(r.kode, (paguOf.get(r.kode) || 0) + (Number(r.pagu) || 0));
    }
    const sorted = [...kodes].sort();
    // kode k punya turunan bila ada kode lain yang diawali "k." (daftar terurut: cukup lihat tetangga berikutnya)
    const hasChild = new Set();
    for (let i = 0; i < sorted.length - 1; i += 1) {
      for (let j = i + 1; j < sorted.length && sorted[j].startsWith(`${sorted[i]}.`); j += 1) hasChild.add(sorted[i]);
    }
    return { all, uraianOf, paguOf, hasChild, kodes: sorted };
  }

  // ----- jalan pintas METERAI -----
  // Kode MAK meterai: SIMAB_METERAI_MAK (kode persis, dipisah koma) bila diisi; kalau tidak,
  // kode terpanjang yang uraiannya memuat salah satu kata di SIMAB_METERAI_KATA.
  function meteraiLeaves(pok) {
    const { uraianOf, paguOf, hasChild, kodes } = pok;
    const picked =
      meteraiMak.length > 0
        ? meteraiMak.filter((k) => kodes.includes(k) && !hasChild.has(k))
        : kodes.filter((k) => !hasChild.has(k) && meteraiKata.some((w) => matchesTerms(`${k} ${uraianOf.get(k) ?? ""}`, [w.toLowerCase()])));
    return picked.map((k) => ({ kode: k, group: groupKey(k), uraian: uraianOf.get(k) ?? "", pagu: paguOf.get(k) || 0 }));
  }

  const normUraian = (x) => String(x ?? "").replace(/\s+/g, " ").trim();

  // Bagian pintasan setelah kata kunci: "<jumlah>[; uraian[; tanggal]]". Kembalikan { preset } atau { error }.
  function parseQuickTail(parts, tahun, contoh) {
    if (!parts[0]) return { preset: null };
    const jumlah = parseJumlah(parts[0]);
    if (!jumlah) return { error: `Jumlah “${parts[0]}” tidak terbaca. ${contoh}` };
    const tgl = parts[2] ? parseTanggal(parts[2], { tahun, today: today() }) : today();
    if (!tgl) return { error: `Tanggal “${parts[2]}” tidak terbaca (contoh: 5/10/2026). ${contoh}` };
    const uraian = parts[1] ? normUraian(parts[1]) : null; // null = pakai uraian bawaan saat kode dipilih
    if (uraian !== null && (uraian.length < 3 || uraian.length > 300)) return { error: `Uraian harus 3–300 karakter. ${contoh}` };
    return { preset: { uraian, tgl, jumlah } };
  }

  async function beginQuick(key, tahun, leaves, quick, preset) {
    const s = { mode: "rekam", quick, stage: "leaf", seksi: quick.label, tahun, groups: [], groupPage: 0, allLeaves: leaves, group: null, leafTerm: "", leafPage: 0, preset, exp: 0 };
    touch(s);
    sessions.set(key, s);
    if (leaves.length === 1) return pickLeaf(s, leaves[0]);
    return renderLeaves(s);
  }

  // rawArg kosong = tampilkan data MAK meterai lalu minta uraian/tanggal/jumlah (atau jumlah saja);
  // rawArg "<jumlah>[; uraian[; tanggal]]" = langsung ke konfirmasi.
  async function startMeterai(key, rawArg, tahunOverride) {
    const tahun = await currentTahun(tahunOverride);
    const contoh = "Contoh: *simab meterai 120.000* atau *simab meterai 120rb; Pembelian meterai Oktober; 5/10/2026*";
    const { preset, error } = parseQuickTail(String(rawArg ?? "").split(";").map((x) => x.trim()), tahun, contoh);
    if (error) return error;
    const leaves = meteraiLeaves(await loadPok(tahun));
    if (leaves.length === 0) {
      return meteraiMak.length > 0
        ? `Kode MAK meterai (${meteraiMak.join(", ")}) tidak ditemukan sebagai kode terpanjang di POK.\n${head(tahun)}`
        : `Tidak ada kode MAK terpanjang yang uraiannya memuat “${meteraiKata.join("” / “")}”.\n${head(tahun)}\n\nTetapkan kodenya di .env: SIMAB_METERAI_MAK=<kode MAK meterai>`;
    }
    return beginQuick(key, tahun, leaves, { icon: "🧷", label: "Meterai", title: "🧷 *Kode MAK meterai*", defaultUraian: meteraiUraian }, preset ? { ...preset, uraian: preset.uraian ?? meteraiUraian } : null);
  }

  // PINTASAN UMUM: "simab rekam <kata>[; jumlah[; uraian[; tanggal]]]" mencari kode MAK terpanjang di SEMUA seksi
  // berdasarkan kata di kode/uraian (semua kata harus ada). Satu hasil -> langsung tampil data MAK; banyak -> daftar bernomor.
  async function startCari(key, rawArg, tahunOverride) {
    const parts = String(rawArg ?? "").split(";").map((x) => x.trim());
    const terms = searchTerms(parts[0]);
    const seksiInfo = `Seksi: ${SEKSI.join(", ")}`;
    if (terms.length === 0) return `Sebutkan seksinya. Contoh: *simab rekam Umum*\n\n${seksiInfo}\nAtau cari langsung dari uraian MAK: *simab rekam listrik* • *simab rekam listrik; 1.500.000*`;
    const tahun = await currentTahun(tahunOverride);
    const kata = terms.join(" ");
    const contoh = `Contoh: *simab rekam ${kata}; 1.500.000* atau *simab rekam ${kata}; 1,5jt; uraian; 5/10/2026*`;
    const { preset, error } = parseQuickTail(parts.slice(1), tahun, contoh);
    if (error) return error;
    const pok = await loadPok(tahun);
    const leaves = pok.kodes
      .filter((k) => !pok.hasChild.has(k) && matchesTerms(`${k} ${pok.uraianOf.get(k) ?? ""}`, terms))
      .map((k) => ({ kode: k, group: groupKey(k), uraian: pok.uraianOf.get(k) ?? "", pagu: pok.paguOf.get(k) || 0 }));
    if (leaves.length === 0) return `Bukan nama seksi, dan tidak ada kode MAK terpanjang yang cocok dengan “${kata}”.\n${head(tahun)}\n\n${seksiInfo}`;
    return beginQuick(key, tahun, leaves, { icon: "🔎", label: `Cari “${cut(kata, 40)}”`, title: `🔎 *Kode MAK “${cut(kata, 40)}” — semua seksi*`, defaultUraian: null }, preset);
  }

  async function start(key, arg, tahunOverride) {
    if (/^(meterai|materai)$/i.test(String(arg ?? "").trim())) return startMeterai(key, "", tahunOverride);
    const seksi = parseSeksi(arg);
    if (!seksi) return startCari(key, arg, tahunOverride);
    const tahun = await currentTahun(tahunOverride);
    // Satu kali muat seluruh POK satker+tahun: kelompok, kode terpanjang, dan pencarian dihitung lokal.
    const { all, uraianOf, paguOf, hasChild } = await loadPok(tahun);
    const mine = all.filter((r) => String(r.seksi ?? "").trim().toLowerCase() === seksi.toLowerCase());
    if (mine.length === 0) {
      const ada = [...new Set(all.map((r) => String(r.seksi ?? "").trim()).filter(Boolean))].sort();
      return `Tidak ada baris POK untuk seksi “${seksi}”.\n${head(tahun)}\n\n${ada.length > 0 ? `Isi kolom seksi di POK: ${ada.join(", ")}` : "Kolom seksi di POK kosong semua."}`;
    }

    const groups = new Map();
    const leafKodes = new Set();
    for (const r of mine) {
      const g = groupKey(r.kode);
      if (!g) continue;
      if (!groups.has(g)) groups.set(g, { key: g, uraian: uraianOf.get(g) ?? "", pagu: 0 });
      groups.get(g).pagu += Number(r.pagu) || 0;
      if (!hasChild.has(r.kode)) leafKodes.add(r.kode);
    }
    if (groups.size === 0) return `Baris POK seksi ${seksi} ada, tetapi kodenya tidak berformat bertingkat.\n${head(tahun)}`;
    const allLeaves = [...leafKodes].sort().map((k) => ({ kode: k, group: groupKey(k), uraian: uraianOf.get(k) ?? "", pagu: paguOf.get(k) || 0 }));

    const s = {
      mode: "rekam",
      stage: "group",
      seksi,
      tahun,
      groups: [...groups.keys()].sort().map((k) => groups.get(k)),
      groupPage: 0,
      allLeaves,
      group: null,
      leafTerm: "",
      leafPage: 0,
      exp: 0
    };
    touch(s);
    sessions.set(key, s);
    return renderGroups(s);
  }

  async function pickGroup(s, g) {
    s.group = g;
    s.leafTerm = "";
    s.leafPage = 0;
    if (leafView(s).length === 0) {
      s.group = null;
      return `Tidak ada kode MAK terpanjang milik seksi ${s.seksi} di ${g.key}.\n\n${renderGroups(s)}`;
    }
    s.stage = "leaf";
    return renderLeaves(s);
  }

  async function searchFromGroups(s, term) {
    const terms = searchTerms(term);
    if (terms.length === 0) return renderGroups(s);
    s.group = null;
    s.leafTerm = terms.join(" ");
    s.leafPage = 0;
    if (leafView(s).length === 0) {
      s.leafTerm = "";
      return `Tidak ada kode MAK seksi ${s.seksi} yang cocok dengan “${terms.join(" ")}”.\n\n${renderGroups(s)}`;
    }
    s.stage = "leaf";
    return renderLeaves(s);
  }

  async function searchInLeaves(s, term) {
    const terms = searchTerms(term);
    if (terms.length === 0) {
      s.leafTerm = "";
      s.leafPage = 0;
      return renderLeaves(s);
    }
    const prev = s.leafTerm;
    s.leafTerm = terms.join(" ");
    if (leafView(s).length === 0) {
      const t = s.leafTerm;
      s.leafTerm = prev;
      return `Tidak ada yang cocok dengan “${t}” di daftar ini. Daftar tetap seperti semula.\n\n${await renderLeaves(s)}`;
    }
    s.leafPage = 0;
    return renderLeaves(s);
  }

  async function pickLeaf(s, leaf) {
    await refreshSisa([leaf], s.tahun); // sisa terbaru
    s.leaf = leaf;
    if (s.preset) {
      const uraian = normUraian(s.preset.uraian ?? s.quick?.defaultUraian ?? leaf.uraian ?? "");
      if (uraian.length >= 3 && uraian.length <= 300) {
        s.draft = { uraian, tgl: s.preset.tgl, jumlah: s.preset.jumlah };
        s.stage = "confirm";
        return renderConfirm(s);
      }
      s.preset = null; // uraian bawaan tidak layak -> minta input lengkap
    }
    s.stage = "input";
    return renderInputPrompt(s);
  }

  function failText(err, what) {
    const m = err instanceof Error ? err.message : String(err);
    if (MISSING_FN_RE.test(m) && /bot_(rekam|ubah|hapus|daftar)/i.test(m)) {
      return { end: true, text: "⚠️ Fungsi database belum terpasang/versinya lama. Jalankan *simab-bot-rekam.sql* (versi terbaru) di SQL Editor project SiMAB, lalu coba lagi." };
    }
    if (REFUSAL_RE.test(m)) return { end: true, text: `⚠️ Ditolak database: ${m.slice(0, 250)}\nSesi dibatalkan.` };
    return { end: false, text: `⚠️ Gagal ${what}: ${m.slice(0, 250)}` };
  }

  async function saveNew(key, s) {
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
        "_Rekam lagi: *simab rekam <seksi atau kata MAK>* • koreksi: *simab ubah* • hapus: *simab hapus*_"
      ]
        .filter((x) => x !== null)
        .join("\n");
    } catch (err) {
      const f = failText(err, "menyimpan");
      if (f.end) {
        sessions.delete(key);
        return f.text;
      }
      touch(s);
      return `${f.text}\nBalas *ya* untuk mencoba lagi, atau *batal*.`;
    }
  }

  // ----- UBAH / HAPUS -----
  const entryLine = (e, i) =>
    `${i}. *${e.id}* — ${cut(e.uraian, 60)}\n   ${e.mak}\n   ${rp(e.jumlah)} • tgl dokumen ${fmtDate(e.tgl_st)} • direkam ${fmtDate(String(e.created_at ?? "").slice(0, 10))}`;

  function renderEntry(e) {
    return [`ID: *${e.id}*`, `MAK: ${e.mak}`, `Uraian: ${e.uraian}`, `Tgl dokumen: ${fmtDate(e.tgl_st)}`, `Jumlah: *${rp(e.jumlah)}*`, `Status: ${e.status ?? "Rekam Data"}`].join("\n");
  }

  async function listEntries(tahun, id = null) {
    const res = await exec(() => getClient().rpc("bot_daftar_rekam", { p_kantor_id: String(kantorId), p_tahun: tahun, p_id: id, p_limit: LIST_LIMIT }));
    return Array.isArray(res) ? res : [];
  }

  async function startManage(key, intent, arg, tahunOverride) {
    const word = intent === "hapus" ? "hapus" : "ubah";
    const idArg = String(arg ?? "").trim();
    if (idArg && !ID_RE.test(idArg)) return `ID kegiatan berupa 10 huruf/angka. Contoh: *simab ${word} Z9Y8X7W6V5*, atau *simab ${word}* saja untuk melihat daftar.`;
    const tahun = await currentTahun(tahunOverride);
    let rows;
    try {
      rows = await listEntries(tahun, idArg ? idArg.toUpperCase() : null);
    } catch (err) {
      return failText(err, "mengambil daftar").text;
    }
    if (rows.length === 0) {
      return idArg
        ? `Kegiatan ${idArg.toUpperCase()} tidak ditemukan di daftar rekam bot, atau statusnya sudah bukan Rekam Data. Ubah/hapus lewat aplikasi SiMAB.`
        : `Belum ada kegiatan hasil rekam bot (tahun ${tahun}) yang masih berstatus Rekam Data.`;
    }
    const s = { mode: "manage", intent: word, stage: "m_list", tahun, entries: rows, directId: !!idArg, exp: 0 };
    touch(s);
    sessions.set(key, s);
    if (idArg) return openEntry(s, rows[0]);
    const lines = [
      `${word === "hapus" ? "🗑️ *Hapus*" : "✏️ *Ubah*"} *kegiatan hasil rekam bot*`,
      head(tahun),
      "Hanya yang direkam lewat bot dan masih berstatus Rekam Data.",
      "",
      ...rows.map((e, i) => entryLine(e, i + 1)),
      "",
      "Balas *angka* untuk memilih • *batal*"
    ];
    return lines.join("\n");
  }

  function openEntry(s, e) {
    s.entry = e;
    if (s.intent === "hapus") {
      s.stage = "m_delete";
      return renderDeleteConfirm(s);
    }
    s.stage = "m_edit";
    return [
      "✏️ *Ubah kegiatan*",
      renderEntry(e),
      "",
      "Cara mengubah:",
      "• ketik *uraian …*, *tanggal …*, atau *jumlah …* (boleh beberapa baris) untuk mengganti sebagian",
      "• atau kirim *3 baris* (uraian, tanggal, jumlah) untuk mengganti semuanya",
      "• *hapus* untuk menghapus kegiatan ini",
      "• *kembali* ke daftar • *batal*"
    ].join("\n");
  }

  function renderDeleteConfirm(s) {
    return [
      "🗑️ *Konfirmasi hapus kegiatan*",
      renderEntry(s.entry),
      "",
      "⚠️ Kegiatan ini dihapus dari SiMAB (salinannya tersimpan di log database untuk pemulihan manual).",
      "Balas *ya hapus* untuk menghapus • *batal* untuk membatalkan"
    ].join("\n");
  }

  async function previewEdit(s, patch) {
    const e = s.entry;
    const next = { uraian: patch.uraian ?? e.uraian, tgl: patch.tgl ?? String(e.tgl_st ?? "").slice(0, 10), jumlah: patch.jumlah ?? Number(e.jumlah) };
    const changes = [];
    if (next.uraian !== e.uraian) changes.push(`Uraian: ${cut(e.uraian, 80)} → *${next.uraian}*`);
    if (next.tgl !== String(e.tgl_st ?? "").slice(0, 10)) changes.push(`Tgl dokumen: ${fmtDate(e.tgl_st)} → *${fmtDate(next.tgl)}*`);
    if (next.jumlah !== Number(e.jumlah)) changes.push(`Jumlah: ${rp(e.jumlah)} → *${rp(next.jumlah)}*`);
    if (changes.length === 0) return { none: true };
    const lines = ["📝 *Konfirmasi ubah kegiatan*", `ID: *${e.id}* • ${e.mak}`, "", ...changes];
    if (next.jumlah !== Number(e.jumlah)) {
      const probe = { kode: e.mak, pagu: await paguOfKode(e.mak, s.tahun) };
      await refreshSisa([probe], s.tahun);
      // realisasi sekarang sudah memuat jumlah lama kegiatan ini
      const after = probe.sisa + Number(e.jumlah) - next.jumlah;
      lines.push("", `Sisa pagu ${e.mak}: ${rp(probe.sisa)} → sesudah ubah ${rp(after)}`);
      if (after < 0) lines.push("", `⚠️ *Melebihi sisa pagu sebesar ${rp(-after)}.* Tetap diubah hanya kalau kamu membalas *ya*.`);
    }
    lines.push("", "Balas *ya* untuk menyimpan • *ubah* untuk mengisi ulang • *batal*");
    return { next, text: lines.join("\n") };
  }

  async function paguOfKode(kode, tahun) {
    const rows = await fetchAll(() => scope(getClient().from("pok").select("kode,pagu"), tahun).eq("kode", kode));
    return rows.reduce((a, r) => a + (Number(r.pagu) || 0), 0);
  }

  async function saveEdit(key, s) {
    const e = s.entry;
    const n = s.next;
    try {
      await exec(() =>
        getClient().rpc("bot_ubah_kegiatan", {
          p_kantor_id: String(kantorId),
          p_id: e.id,
          p_uraian: n.uraian !== e.uraian ? n.uraian : null,
          p_tgl_st: n.tgl !== String(e.tgl_st ?? "").slice(0, 10) ? n.tgl : null,
          p_jumlah: n.jumlah !== Number(e.jumlah) ? n.jumlah : null
        })
      );
      sessions.delete(key);
      return ["✅ *Kegiatan diubah*", `ID: *${e.id}* • ${e.mak}`, `Uraian: ${n.uraian}`, `Tgl dokumen: ${fmtDate(n.tgl)} • Jumlah: *${rp(n.jumlah)}*`, "Status: Rekam Data"].join("\n");
    } catch (err) {
      const f = failText(err, "mengubah");
      if (f.end) {
        sessions.delete(key);
        return f.text;
      }
      touch(s);
      return `${f.text}\nBalas *ya* untuk mencoba lagi, atau *batal*.`;
    }
  }

  async function saveDelete(key, s) {
    const e = s.entry;
    try {
      await exec(() => getClient().rpc("bot_hapus_kegiatan", { p_kantor_id: String(kantorId), p_id: e.id }));
      sessions.delete(key);
      return ["🗑️ *Kegiatan dihapus*", renderEntry(e), "", "_Salinannya tersimpan di log database (bot_rekam_log)._"].join("\n");
    } catch (err) {
      const f = failText(err, "menghapus");
      if (f.end) {
        sessions.delete(key);
        return f.text;
      }
      touch(s);
      return `${f.text}\nBalas *ya hapus* untuk mencoba lagi, atau *batal*.`;
    }
  }

  // ----- penangan balasan -----
  async function handleManage(key, s, text, low) {
    if (s.stage === "m_list") {
      const m = low.match(/^(?:pilih\s*)?(\d{1,3})$/);
      if (!m) return `Sesi masih aktif. Balas *angka* 1–${s.entries.length} atau *batal*.`;
      const n = Number(m[1]);
      if (n < 1 || n > s.entries.length) return `Angka di luar daftar. Pilih 1–${s.entries.length}, atau *batal*.`;
      return openEntry(s, s.entries[n - 1]);
    }
    if (s.stage === "m_edit") {
      if (low === "kembali" || low === "back") {
        if (s.entries.length <= 1 && s.directId) return "Tidak ada daftar untuk kembali. Balas *batal*.";
        s.stage = "m_list";
        return ["Pilih kegiatan:", "", ...s.entries.map((e, i) => entryLine(e, i + 1)), "", "Balas *angka* • *batal*"].join("\n");
      }
      if (low === "hapus" || low === "delete") {
        s.stage = "m_delete";
        return renderDeleteConfirm(s);
      }
      let patch = null;
      const part = parsePatch(text, { tahun: s.tahun, today: today() });
      if (part) {
        if (!part.ok) return part.error;
        patch = part.patch;
      } else {
        const full = parseInput(text, { tahun: s.tahun, today: today() });
        if (!full.ok) return `${full.error}\n\nAtau ketik *uraian …* / *tanggal …* / *jumlah …* untuk mengganti satu hal.`;
        patch = { uraian: full.uraian, tgl: full.tgl, jumlah: full.jumlah };
      }
      const pv = await previewEdit(s, patch);
      if (pv.none) return "Tidak ada perubahan dibanding data sekarang. Kirim nilai baru, atau *batal*.";
      s.next = pv.next;
      s.stage = "m_confirm_edit";
      return pv.text;
    }
    if (s.stage === "m_confirm_edit") {
      if (YES.has(low)) return saveEdit(key, s);
      if (low === "ubah" || low === "ulang" || low === "edit") {
        s.stage = "m_edit";
        return openEntry(s, s.entry);
      }
      return "Balas *ya* untuk menyimpan perubahan, *ubah* untuk mengisi ulang, atau *batal*.";
    }
    if (s.stage === "m_delete") {
      if (low === "ya hapus") return saveDelete(key, s);
      if (low === "kembali" && s.intent === "ubah") {
        s.stage = "m_edit";
        return openEntry(s, s.entry);
      }
      return "Untuk menghapus balas persis *ya hapus*. Atau *batal*.";
    }
    return null;
  }

  // Balasan pemilik selagi sesi aktif. Mengembalikan teks jawaban, atau null kalau tidak ada sesi.
  async function handle(key, rawText) {
    const s = live(key);
    if (!s) return null;
    touch(s);
    const text = String(rawText ?? "").trim();
    const low = text.toLowerCase().replace(/\s+/g, " ");

    if (["batal", "cancel", "stop"].includes(low)) {
      sessions.delete(key);
      return s.mode === "manage" ? "Dibatalkan. Tidak ada yang diubah." : "Perekaman dibatalkan. Tidak ada yang disimpan.";
    }
    if (s.mode === "manage") return handleManage(key, s, text, low);

    if (s.stage === "group" || s.stage === "leaf") {
      const isGroup = s.stage === "group";
      const searchM = text.match(/^cari(?:\s+([\s\S]*))?$/i);
      if (searchM) return isGroup ? searchFromGroups(s, searchM[1] ?? "") : searchInLeaves(s, searchM[1] ?? "");
      if (!isGroup && CLEAR_FILTER.has(low)) return searchInLeaves(s, "");
      const view = isGroup ? s.groups : leafView(s);
      const pageKey = isGroup ? "groupPage" : "leafPage";
      if (NEXT.has(low)) {
        s[pageKey] += 1;
        return isGroup ? renderGroups(s) : renderLeaves(s);
      }
      if (PREV.has(low)) {
        s[pageKey] -= 1;
        return isGroup ? renderGroups(s) : renderLeaves(s);
      }
      if (!isGroup && s.quick && (low === "kembali" || low === "back")) {
        sessions.delete(key);
        return "Dibatalkan. Tidak ada yang disimpan.";
      }
      if (!isGroup && (low === "kembali" || low === "back")) {
        s.stage = "group";
        s.group = null;
        s.leafTerm = "";
        return renderGroups(s);
      }
      const m = low.match(/^(?:pilih\s*)?(\d{1,3})$/);
      if (!m) return `Sesi rekam masih aktif. Balas *angka* 1–${view.length}, *cari <kata>*${isGroup ? "" : ", *kembali*"} atau *batal*.`;
      const n = Number(m[1]);
      if (n < 1 || n > view.length) return `Angka di luar daftar. Pilih 1–${view.length}, atau *batal*.`;
      return isGroup ? pickGroup(s, view[n - 1]) : pickLeaf(s, view[n - 1]);
    }

    if (s.stage === "input") {
      if (low === "kembali" || low === "back") {
        s.stage = "leaf";
        return renderLeaves(s);
      }
      let parsed;
      const onlyAmount = s.quick && !/[\n;|]/.test(text) ? parseJumlah(text) : null;
      const defU = s.quick ? normUraian(s.quick.defaultUraian ?? s.leaf.uraian ?? "") : "";
      if (onlyAmount && (defU.length < 3 || defU.length > 300)) parsed = { ok: false, error: "Uraian bawaan untuk kode ini tidak ada/terlalu pendek, jadi kirim 3 baris: uraian, tanggal dokumen, jumlah." };
      else if (onlyAmount) parsed = { ok: true, uraian: defU, tgl: today(), jumlah: onlyAmount };
      else parsed = parseInput(text, { tahun: s.tahun, today: today() });
      if (!parsed.ok) return parsed.error;
      await refreshSisa([s.leaf], s.tahun);
      s.draft = { uraian: parsed.uraian, tgl: parsed.tgl, jumlah: parsed.jumlah };
      s.stage = "confirm";
      return renderConfirm(s);
    }

    if (s.stage === "confirm") {
      if (YES.has(low)) return saveNew(key, s);
      if (low === "ubah" || low === "ulang" || low === "edit") {
        s.stage = "input";
        return renderInputPrompt(s);
      }
      return "Balas *ya* untuk menyimpan, *ubah* untuk mengisi ulang, atau *batal*.";
    }
    return null;
  }

  return { start, startMeterai, startManage, handle, hasSession, cancel };
}
