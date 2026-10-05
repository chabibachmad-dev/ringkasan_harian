// Perintah SiMAB lewat WhatsApp (HANYA BACA).
//
// Modul ini dipanggil index.js kalau pemilik mengirim pesan berawalan "simab ...".
// Bot masuk ke Supabase SiMAB (project BERBEDA dari Supabase ringkasan_harian)
// memakai akun khusus bot yang di database dibatasi baca-saja (lihat
// simab-bot-readonly.sql). Semua kueri disaring ke satu kantor (SIMAB_KANTOR_ID)
// dan satu tahun anggaran. Jawaban disusun kode dengan format tetap -- model
// bahasa (Ollama) HANYA dipakai menebak aksi dari kalimat bebas, tidak pernah
// menulis SQL maupun angka.
//
// Aturan hitung (dari dokumentasi SiMAB):
//   Realisasi = SUM(kegiatan.jumlah) per mak = pok.kode (semua status)
//   Blokir    = blokir.nilai per blokir.id = pok.kode
//   Sisa      = Pagu - Blokir - Realisasi
//   RPD       : Realisasi per bulan dari bulan tgl_sp2d, Deviasi = RPD - Realisasi

import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;
const IN_CHUNK = 80;
const MAX_KODE = 1500;
const LIST_MAX = 8;
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const SIMAB_ACTIONS = ["pagu", "cek", "perjadin", "sbm", "rpd", "bantuan"];

export const SIMAB_HELP = `🏛️ *Perintah SiMAB* (hanya baca)

• *simab pagu <kode / akun / kata>*
  contoh: simab pagu 4701.EBA.994.002.A.521111.10
  contoh: simab sisa 521111  (satu akun 6 digit)
  contoh: simab pagu perjalanan dinas  (cari di uraian)
• *simab cek <kata>* — cari kegiatan dari uraian, nomor ST, pelaksana, MAK, atau nomor SPM
  contoh: simab cek 123/ST/2026
• *simab perjadin <nama>* — perjalanan dinas seorang pelaksana (akun 524111/524113)
• *simab sbm <kota>* — tarif SBM
• *simab rpd* — RPD vs realisasi per bulan (atau: simab rpd oktober)

Tambahkan tahun di akhir untuk tahun lain, mis. *simab pagu 521111 2025*.
Kalimat bebas juga boleh (dibaca model lokal, ±1 menit).`;

// ---------- utilitas ----------
function rp(n) {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? "-" : ""}Rp ${new Intl.NumberFormat("id-ID").format(Math.abs(v))}`;
}

function cut(s, n) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

// Buang karakter yang berarti khusus di pola LIKE/ILIKE.
function likeSafe(s) {
  return String(s ?? "").replace(/[%_\\*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const KODE_RE = /^\d{4}(\.[A-Za-z0-9]+)*$/;
const KODE_IN_TEXT_RE = /\b\d{4}(?:\.[A-Za-z0-9]+)+\b/;
const AKUN_RE = /^\d{6}$/;

const ALIASES = {
  pagu: "pagu", sisa: "pagu", realisasi: "pagu", blokir: "pagu", saldo: "pagu", anggaran: "pagu",
  cek: "cek", cari: "cek", kegiatan: "cek", st: "cek", spm: "cek",
  perjadin: "perjadin", pelaksana: "perjadin", dinas: "perjadin",
  sbm: "sbm", tarif: "sbm",
  rpd: "rpd",
  bantuan: "bantuan", help: "bantuan", menu: "bantuan", "?": "bantuan"
};

// Return { aksi, arg, tahun } -- aksi null kalau tidak dikenali (-> kalimat bebas).
export function parseCommand(raw) {
  let t = String(raw ?? "").trim().replace(/^simab\b[\s:,.-]*/i, "").trim();
  let tahun = null;
  const ym = t.match(/(?:^|\s)(20\d{2})$/);
  if (ym && t.length > 4) {
    tahun = Number(ym[1]);
    t = t.slice(0, ym.index).trim();
  }
  if (!t) return { aksi: "bantuan", arg: "", tahun };
  const [first, ...rest] = t.split(/\s+/);
  const aksi = ALIASES[first.toLowerCase()] ?? null;
  if (aksi) return { aksi, arg: rest.join(" ").trim(), tahun };
  if (KODE_RE.test(t) && t.includes(".")) return { aksi: "pagu", arg: t, tahun };
  if (AKUN_RE.test(t)) return { aksi: "pagu", arg: t, tahun };
  return { aksi: null, arg: t, tahun };
}

function monthFromText(s) {
  const t = String(s ?? "").trim().toLowerCase();
  if (!t) return null;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const i = MONTHS.findIndex((m) => m.toLowerCase() === t || m.toLowerCase().startsWith(t.slice(0, 3)) && t.length >= 3);
  return i >= 0 ? i + 1 : null;
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- pabrik ----------
export function createSimab({
  url,
  anonKey,
  email,
  password,
  kantorId = "538065",
  fixedTahun = null,
  timeZone = "Asia/Jakarta",
  makeClient = createClient,
  ollamaParse = null,
  perjadinAkun = ["524111", "524113"]
}) {
  const enabled = Boolean(url && anonKey && email && password);
  let client = null;
  let tahunCache = { value: null, at: 0 };

  function getClient() {
    if (!client) {
      client = makeClient(url, anonKey, { auth: { autoRefreshToken: true, persistSession: false } });
    }
    return client;
  }

  async function login() {
    const { error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Login akun bot SiMAB gagal (${error.message}). Cek SIMAB_BOT_EMAIL/SIMAB_BOT_PASSWORD.`);
  }

  async function ensureSession() {
    const { data } = await getClient().auth.getSession();
    const exp = (data?.session?.expires_at ?? 0) * 1000;
    if (!data?.session || exp - Date.now() < 60_000) await login();
  }

  function isAuthError(res) {
    const msg = String(res?.error?.message ?? "");
    return res?.status === 401 || res?.error?.code === "PGRST301" || /jwt|token/i.test(msg);
  }

  // Jalankan satu kueri (fungsi yang mengembalikan builder BARU tiap dipanggil),
  // otomatis login ulang sekali kalau sesi kedaluwarsa.
  async function exec(build) {
    await ensureSession();
    let res = await build();
    if (res.error && isAuthError(res)) {
      await login();
      res = await build();
    }
    if (res.error) throw new Error(res.error.message);
    return res.data ?? [];
  }

  // Ambil SEMUA baris (PostgREST membatasi 1000/permintaan).
  async function fetchAll(makeQuery) {
    const all = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const rows = await exec(() => makeQuery().range(from, from + PAGE_SIZE - 1));
      all.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return all;
  }

  async function currentTahun(override) {
    if (override) return override;
    if (fixedTahun) return fixedTahun;
    if (tahunCache.value && Date.now() - tahunCache.at < 10 * 60_000) return tahunCache.value;
    let t = null;
    try {
      const rows = await exec(() => getClient().from("config").select("data").eq("id", "tahun_aktif").limit(1));
      const v = Number(rows[0]?.data?.tahun);
      if (Number.isInteger(v) && v > 2000) t = v;
    } catch {
      /* pakai tahun berjalan */
    }
    if (!t) t = Number(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(new Date()));
    tahunCache = { value: t, at: Date.now() };
    return t;
  }

  const scope = (q, tahun) => q.eq("kantor_id", kantorId).eq("tahun", tahun);
  const head = (tahun) => `Tahun ${tahun} • Satker ${kantorId}`;

  // ---------- pagu / sisa ----------
  async function cmdPagu(arg, tahun) {
    const q = arg.trim();
    if (!q) return "Tulis kode, akun, atau kata. Contoh: *simab pagu 4701.EBA.994.002.A.521111.10* atau *simab sisa 521111*.";

    let pokRows;
    let label = q;
    if (KODE_RE.test(q)) {
      const k = q.toUpperCase();
      pokRows = (await fetchAll(() => scope(getClient().from("pok").select("kode,uraian,pagu,seksi"), tahun).like("kode", `${k}%`))).filter(
        (r) => r.kode === k || String(r.kode).startsWith(`${k}.`)
      );
      label = k;
    } else if (AKUN_RE.test(q)) {
      pokRows = await fetchAll(() => scope(getClient().from("pok").select("kode,uraian,pagu,seksi"), tahun).like("kode", `%.${q}.%`));
      label = `akun ${q}`;
    } else {
      const k = likeSafe(q);
      if (!k) return "Kata pencarian kosong.";
      pokRows = await fetchAll(() => scope(getClient().from("pok").select("kode,uraian,pagu,seksi"), tahun).ilike("uraian", `%${k}%`));
      label = `uraian “${k}”`;
    }

    if (pokRows.length === 0) return `Tidak ada kode POK untuk ${label}.\n_${head(tahun)}_`;

    const byKode = new Map();
    for (const r of pokRows) {
      if (!byKode.has(r.kode)) byKode.set(r.kode, { kode: r.kode, uraian: "", pagu: 0, seksi: [], blokir: 0, real: 0, n: 0 });
      const e = byKode.get(r.kode);
      if (!e.uraian && r.uraian) e.uraian = r.uraian;
      const p = Number(r.pagu) || 0;
      e.pagu += p;
      if (r.seksi) e.seksi.push({ seksi: r.seksi, pagu: p });
    }
    const kodes = [...byKode.keys()];
    if (kodes.length > MAX_KODE) {
      return `Terlalu banyak kode (${kodes.length}) untuk ${label}. Persempit dengan kode yang lebih lengkap.`;
    }

    for (const part of chunks(kodes, IN_CHUNK)) {
      const bl = await fetchAll(() => scope(getClient().from("blokir").select("id,nilai"), tahun).in("id", part));
      for (const r of bl) {
        const e = byKode.get(r.id);
        if (e) e.blokir += Number(r.nilai) || 0;
      }
      const kg = await fetchAll(() => scope(getClient().from("kegiatan").select("mak,jumlah"), tahun).in("mak", part));
      for (const r of kg) {
        const e = byKode.get(r.mak);
        if (e) {
          e.real += Number(r.jumlah) || 0;
          e.n += 1;
        }
      }
    }

    const rows = [...byKode.values()].sort((a, b) => a.kode.localeCompare(b.kode));
    for (const e of rows) e.sisa = e.pagu - e.blokir - e.real;
    const shown = rows.filter((e) => e.pagu || e.blokir || e.real);
    if (shown.length === 0) return `Kode ditemukan tetapi belum ada pagu/realisasi untuk ${label}.\n_${head(tahun)}_`;

    if (shown.length === 1) {
      const e = shown[0];
      const lines = [
        `📊 *POK ${e.kode}*`,
        e.uraian ? `_${cut(e.uraian, 120)}_` : null,
        `${head(tahun)}`,
        "",
        `Pagu: ${rp(e.pagu)}`,
        `Blokir: ${rp(e.blokir)}`,
        `Realisasi: ${rp(e.real)} (${e.n} kegiatan)`,
        `*Sisa: ${rp(e.sisa)}*`,
        "_Sisa = Pagu − Blokir − Realisasi_"
      ];
      if (e.seksi.length > 1) {
        lines.push("", `Pagu per Seksi: ${e.seksi.map((s) => `${s.seksi} ${rp(s.pagu)}`).join(" | ")}`);
        lines.push("_Pagu di atas = jumlah semua baris Seksi._");
      }
      return lines.join("\n");
    }

    const tot = shown.reduce((a, e) => ({ pagu: a.pagu + e.pagu, blokir: a.blokir + e.blokir, real: a.real + e.real }), { pagu: 0, blokir: 0, real: 0 });
    const lines = [
      `📊 *Pagu & sisa — ${label}*`,
      `${shown.length} kode • ${head(tahun)}`,
      "",
      `Pagu: ${rp(tot.pagu)}`,
      `Blokir: ${rp(tot.blokir)}`,
      `Realisasi: ${rp(tot.real)}`,
      `*Sisa: ${rp(tot.pagu - tot.blokir - tot.real)}*`,
      ""
    ];
    for (const e of shown.slice(0, LIST_MAX)) {
      lines.push(`• ${e.kode}${e.uraian ? ` — ${cut(e.uraian, 40)}` : ""}\n  pagu ${rp(e.pagu)} • sisa *${rp(e.sisa)}*`);
    }
    if (shown.length > LIST_MAX) lines.push(`…dan ${shown.length - LIST_MAX} kode lain. Pakai kode lengkap untuk rincian satu kode.`);
    return lines.join("\n");
  }

  // ---------- kegiatan ----------
  const KEG_COLS = "id,mak,uraian,pelaksana,tgl_mulai,tgl_selesai,tgl_sp2d,jumlah,status,nomor_spm";

  function formatKegiatan(list, startNo = 1) {
    return list
      .map((k, i) => {
        const tgl = k.tgl_mulai ? (k.tgl_selesai && k.tgl_selesai !== k.tgl_mulai ? `${fmtDate(k.tgl_mulai)} – ${fmtDate(k.tgl_selesai)}` : fmtDate(k.tgl_mulai)) : "tanggal belum diisi";
        const extra = [k.status, k.mak ? `MAK ${k.mak}` : null, k.nomor_spm ? `SPM ${k.nomor_spm}` : null].filter(Boolean).join(" • ");
        return `${startNo + i}. *${cut(k.uraian, 90)}*\n   👤 ${cut(k.pelaksana, 40) || "-"} • 📅 ${tgl}\n   💰 ${rp(k.jumlah)}${extra ? ` • ${extra}` : ""}`;
      })
      .join("\n\n");
  }

  const byTglDesc = (a, b) => String(b.tgl_mulai ?? "").localeCompare(String(a.tgl_mulai ?? ""));

  async function cmdCek(arg, tahun) {
    const k = likeSafe(arg);
    if (!k) return "Tulis kata kunci. Contoh: *simab cek 123/ST/2026* atau *simab cek bimtek halal*.";
    const FIELDS = ["uraian", "pelaksana", "mak", "nomor_spm"];
    const seen = new Map();
    for (const f of FIELDS) {
      const rows = await exec(() =>
        scope(getClient().from("kegiatan").select(KEG_COLS), tahun).ilike(f, `%${k}%`).order("tgl_mulai", { ascending: false }).limit(30)
      );
      for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
    }
    const all = [...seen.values()].sort(byTglDesc);
    if (all.length === 0) return `Tidak ada kegiatan yang cocok dengan “${k}”.\n_${head(tahun)}_`;
    const total = all.reduce((a, r) => a + (Number(r.jumlah) || 0), 0);
    const shown = all.slice(0, LIST_MAX);
    const lines = [`🔎 *Kegiatan “${k}”* — ${all.length} hasil`, `${head(tahun)} • total ${rp(total)}`, "", formatKegiatan(shown)];
    if (all.length > shown.length) lines.push("", `…dan ${all.length - shown.length} lainnya. Persempit kata kuncinya.`);
    return lines.join("\n");
  }

  async function cmdPerjadin(arg, tahun) {
    const k = likeSafe(arg);
    if (!k) return "Tulis nama pelaksana. Contoh: *simab perjadin budi*.";
    // Hanya transaksi perjalanan dinas: MAK harus memuat salah satu akun di perjadinAkun
    // (524111 / 524113), bukan semua kegiatan milik pelaksana itu.
    const seen = new Map();
    for (const akun of perjadinAkun) {
      const part = await exec(() =>
        scope(getClient().from("kegiatan").select(KEG_COLS), tahun)
          .ilike("pelaksana", `%${k}%`)
          .like("mak", `%${akun}%`)
          .order("tgl_mulai", { ascending: false })
          .limit(200)
      );
      for (const r of part) if (!seen.has(r.id)) seen.set(r.id, r);
    }
    const rows = [...seen.values()].sort(byTglDesc);
    const akunLabel = perjadinAkun.join("/");
    if (rows.length === 0) return `Tidak ada perjalanan dinas (akun ${akunLabel}) dengan pelaksana “${k}”.\n_${head(tahun)}_`;
    const total = rows.reduce((a, r) => a + (Number(r.jumlah) || 0), 0);
    const perStatus = {};
    for (const r of rows) perStatus[r.status || "-"] = (perStatus[r.status || "-"] || 0) + 1;
    const statusLine = Object.entries(perStatus).map(([s, n]) => `${s} ${n}`).join(" • ");
    const shown = rows.slice(0, LIST_MAX);
    const lines = [
      `🧳 *Perjadin “${k}”* — ${rows.length} kegiatan`,
      `${head(tahun)} • akun ${akunLabel} • total ${rp(total)}`,
      `Status: ${statusLine}`,
      "",
      formatKegiatan(shown)
    ];
    if (rows.length > shown.length) lines.push("", `…dan ${rows.length - shown.length} kegiatan lain (lebih lama).`);
    return lines.join("\n");
  }

  // ---------- SBM ----------
  async function cmdSbm(arg) {
    const k = likeSafe(arg);
    if (!k) return "Tulis nama kabupaten/kota. Contoh: *simab sbm yogyakarta*.";
    const rows = await exec(() => getClient().from("sbm").select("id,luar_kota,dalam_kota,diklat").ilike("id", `%${k}%`).limit(6));
    if (rows.length === 0) return `Tidak ada SBM untuk “${k}”.`;
    const lines = [`🏨 *SBM — ${k}*`, ""];
    for (const r of rows) {
      lines.push(`• *${r.id}*\n  Luar kota: ${rp(r.luar_kota)} • Dalam kota: ${rp(r.dalam_kota)} • Diklat: ${rp(r.diklat)}`);
    }
    lines.push("", "_Nilai sesuai tabel SBM di SiMAB._");
    return lines.join("\n");
  }

  // ---------- RPD ----------
  async function cmdRpd(arg, tahun) {
    const onlyMonth = monthFromText(arg);
    const rpdRows = await fetchAll(() => scope(getClient().from("rpd").select("bulan_ke,nilai"), tahun));
    const kg = await fetchAll(() => scope(getClient().from("kegiatan").select("jumlah,tgl_sp2d"), tahun).not("tgl_sp2d", "is", null));
    const rpdBy = Array(13).fill(0);
    const realBy = Array(13).fill(0);
    for (const r of rpdRows) {
      const m = Number(r.bulan_ke);
      if (m >= 1 && m <= 12) rpdBy[m] += Number(r.nilai) || 0;
    }
    for (const r of kg) {
      const m = Number(String(r.tgl_sp2d).slice(5, 7));
      if (m >= 1 && m <= 12) realBy[m] += Number(r.jumlah) || 0;
    }
    if (rpdRows.length === 0 && kg.length === 0) return `Belum ada data RPD/realisasi SP2D.\n_${head(tahun)}_`;

    const line = (m) => `${MONTHS_SHORT[m - 1]}: RPD ${rp(rpdBy[m])} • Real ${rp(realBy[m])} • Dev *${rp(rpdBy[m] - realBy[m])}*`;
    if (onlyMonth) {
      return [`📅 *RPD ${MONTHS[onlyMonth - 1]}*`, head(tahun), "", line(onlyMonth), "_Deviasi = RPD − Realisasi (realisasi dihitung dari bulan tgl SP2D)._"].join("\n");
    }
    const lines = [`📅 *RPD vs realisasi*`, head(tahun), ""];
    let tr = 0;
    let tl = 0;
    for (let m = 1; m <= 12; m += 1) {
      tr += rpdBy[m];
      tl += realBy[m];
      if (rpdBy[m] || realBy[m]) lines.push(line(m));
    }
    lines.push("", `*Total*: RPD ${rp(tr)} • Real ${rp(tl)} • Dev *${rp(tr - tl)}*`, "_Deviasi = RPD − Realisasi (realisasi dihitung dari bulan tgl SP2D)._");
    return lines.join("\n");
  }

  async function dispatch(aksi, arg, tahunOverride) {
    if (aksi === "bantuan") return SIMAB_HELP;
    if (aksi === "sbm") return cmdSbm(arg);
    const tahun = await currentTahun(tahunOverride);
    if (aksi === "pagu") return cmdPagu(arg, tahun);
    if (aksi === "cek") return cmdCek(arg, tahun);
    if (aksi === "perjadin") return cmdPerjadin(arg, tahun);
    if (aksi === "rpd") return cmdRpd(arg, tahun);
    return SIMAB_HELP;
  }

  // Titik masuk: terima teks pesan, kembalikan teks jawaban.
  async function run(text, { notify = null } = {}) {
    const cmd = parseCommand(text);
    if (cmd.aksi) return dispatch(cmd.aksi, cmd.arg, cmd.tahun);

    // Kalimat bebas -> bantuan model lokal untuk MENEBAK aksi (bukan angka).
    const kodeInText = cmd.arg.match(KODE_IN_TEXT_RE)?.[0];
    if (kodeInText) return dispatch("pagu", kodeInText, cmd.tahun);
    if (!ollamaParse) return SIMAB_HELP;
    if (notify) await notify("⏳ Memahami pertanyaan (model lokal, bisa sampai ±1 menit)…");
    let parsed = null;
    try {
      parsed = await ollamaParse(cmd.arg);
    } catch (err) {
      console.error("🏛️ [SiMAB] model lokal gagal menafsirkan:", err instanceof Error ? err.message : String(err));
    }
    if (!parsed || !SIMAB_ACTIONS.includes(parsed.aksi)) {
      return `Saya belum paham maksudnya. Coba format singkat:\n\n${SIMAB_HELP}`;
    }
    const kueri = likeSafe(parsed.kueri);
    const sub = await dispatch(parsed.aksi, kueri, cmd.tahun);
    return `_Dipahami sebagai: simab ${parsed.aksi}${kueri ? ` ${kueri}` : ""}_\n\n${sub}`;
  }

  return { enabled, run };
}

// Prompt penafsir untuk Ollama (kalimat bebas -> {aksi, kueri}).
export const SIMAB_OLLAMA_SYSTEM = `Kamu penerjemah perintah untuk sistem monitoring anggaran. Pilih SATU aksi lalu ambil kata kunci intinya.
Aksi yang tersedia:
- pagu: pagu/sisa/realisasi/blokir sebuah kode POK, akun (6 angka), atau jenis belanja (kata di uraian)
- cek: cari kegiatan dari uraian, nomor ST, nama pelaksana, kode MAK, atau nomor SPM
- perjadin: daftar perjalanan dinas (akun 524111/524113) milik seorang pelaksana (butuh nama)
- sbm: tarif standar biaya masukan sebuah kabupaten/kota
- rpd: rencana penarikan dana per bulan (kueri boleh nama bulan atau kosong)
- bantuan: kalau tidak ada yang cocok
Balas HANYA JSON satu baris: {"aksi":"...","kueri":"..."}. "kueri" hanya kata kunci inti (kode, akun, nama, kota, nomor ST, bulan) tanpa kata sambung atau tanda tanya.
Contoh:
"berapa sisa anggaran akun 521111" -> {"aksi":"pagu","kueri":"521111"}
"sisa pagu belanja perjalanan dinas biasa" -> {"aksi":"pagu","kueri":"perjalanan dinas biasa"}
"kegiatan bimtek halal yang mana saja" -> {"aksi":"cek","kueri":"bimtek halal"}
"perjalanan dinas pak budi tahun ini" -> {"aksi":"perjadin","kueri":"budi"}
"uang harian ke surabaya berapa" -> {"aksi":"sbm","kueri":"surabaya"}
"rpd bulan oktober gimana" -> {"aksi":"rpd","kueri":"oktober"}`;
