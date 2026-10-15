// Laporan kas bulanan: "Laporan Saldo Rekening" + "Laporan Register Penutupan Kas" (satu berkas, 2 halaman).
//
// Alur tiap awal bulan (tanggal KAS_DAY, pukul KAS_TIME):
//   1. Bot membuat RANCANGAN untuk bulan lalu dari data bulan sebelumnya (saldo awal = saldo buku bulan lalu,
//      daftar rekening, pejabat, dsb ikut terbawa) dan mengirimnya ke pemilik untuk dikonfirmasi.
//   2. Pemilik mengisi angka yang berubah lewat /kas (penerimaan, pengeluaran, saldo rekening, ...), bot menghitung ulang.
//   3. /kas submit -> data DISIMPAN permanen (tabel bot_state), dokumen Word + PDF dibuat dan dikirim.
//   Data bisa dipanggil kapan saja: /kas lihat, /kas dokumen, /kas daftar; diperbaiki dengan /kas ubah.
// Selama rancangan belum disubmit, bot mengingatkan sekali sehari. Bulan berikutnya baru dibuat setelah bulan ini disubmit
// (rantai saldo awal tidak boleh bolong).
//
// Penyimpanan (bot_state, nilai JSON): kas_index (daftar bulan), kas_rec_YYYY-MM (satu bulan), kas_draft (rancangan aktif),
// kas_remind (tanggal pengingat terakhir).

import { BULAN, MONTH_WORDS } from "./nodin.js";
import { tzParts } from "./reminders.js";
import { buildKasDocx, ddmmyyyy, fmtRp, longDate } from "./kas-docx.js";

export const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];
const INDEX_KEY = "kas_index";
const DRAFT_KEY = "kas_draft";
const REMIND_KEY = "kas_remind";
const recKey = (pkey) => `kas_rec_${pkey}`;
const SATKER = "KANTOR PELAYANAN KEKAYAAN NEGARA DAN LELANG DENPASAR";

// ---------------------------------------------------------------- konfigurasi
const bool = (v, d) => (v === undefined || v === "" ? d : !/^(false|0|no|tidak|mati|off)$/i.test(String(v).trim()));

export function readKasConfig(env = process.env) {
  const tm = String(env.KAS_TIME || "07:10").match(/^(\d{1,2})[:.](\d{2})$/);
  const ok = tm && Number(tm[1]) < 24 && Number(tm[2]) < 60;
  const day = Number(env.KAS_DAY);
  return {
    enabled: bool(env.KAS_ENABLED, true),
    day: Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1,
    hour: ok ? Number(tm[1]) : 7,
    minute: ok ? Number(tm[2]) : 10,
    pdf: bool(env.KAS_PDF, true)
  };
}

// ---------------------------------------------------------------- periode & tanggal
export const pkeyOf = (p) => `${p.y}-${String(p.m).padStart(2, "0")}`;
export const parsePkey = (k) => {
  const m = String(k || "").match(/^(\d{4})-(\d{2})$/);
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
};
export const nextPeriod = (p) => (p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 });
export const prevPeriod = (p) => (p.m === 1 ? { y: p.y - 1, m: 12 } : { y: p.y, m: p.m - 1 });
export const cmpPeriod = (a, b) => a.y * 12 + a.m - (b.y * 12 + b.m);
export const periodText = (p) => `${BULAN[p.m - 1]} ${p.y}`;
export function lastDayIso(p) {
  const d = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const validIso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** "30-09-2026", "30/9/2026", "2026-09-30", "30 september 2026" -> "2026-09-30" atau null. */
export function parseDate(raw) {
  const t = String(raw ?? "").trim().toLowerCase();
  let y;
  let m;
  let d;
  let x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (x) [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else if ((x = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) [d, m, y] = [Number(x[1]), Number(x[2]), x[3].length === 2 ? 2000 + Number(x[3]) : Number(x[3])];
  else if ((x = t.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/)) && MONTH_WORDS[x[2]]) [d, m, y] = [Number(x[1]), MONTH_WORDS[x[2]], Number(x[3])];
  else return null;
  return validIso(y, m, d) ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
}

// ---------------------------------------------------------------- angka
/** "157.509.115", "157,509,115", "Rp 157509115", "1.500,00" -> { value } | { error }. Hanya rupiah bulat. */
export function parseRupiah(raw) {
  const s = String(raw ?? "").toLowerCase().replace(/rp\.?/g, "").replace(/\s+/g, "");
  if (!s) return { error: "angkanya kosong" };
  let digits = null;
  let m;
  if (/^\d+$/.test(s)) digits = s;
  else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) digits = s.replace(/[.,]/g, "");
  else if ((m = s.match(/^(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{1,2})$/))) {
    if (Number(m[2]) !== 0) return { error: `"${raw}" memuat sen; hanya rupiah bulat yang didukung` };
    digits = m[1].replace(/[.,]/g, "");
  }
  if (digits === null || digits.length > 15) return { error: `"${raw}" bukan angka rupiah yang valid` };
  return { value: Number(digits) };
}

/** Tampilan untuk pesan chat (titik ribuan): Rp 1.234.567 */
export const idr = (n) => (n == null ? "—" : `${n < 0 ? "-" : ""}Rp ${String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`);

// ---------------------------------------------------------------- data awal (dari PDF September 2026)
const BASE_ACCOUNT = { ba: "015", es: "09", kode: "538065", ket: "-" };
export function seedRecord() {
  const acc = (o) => ({ ...BASE_ACCOUNT, ...o, prevSaldo: null, prevTgl: null });
  return {
    period: "2026-09",
    closingDate: "2026-09-30",
    prevClosingDate: "2026-08-31",
    awal: 50898150,
    awalManual: false,
    terima: 157509115,
    keluar: 165717883,
    tunai: Object.fromEntries(DENOMS.map((n) => [n, 0])),
    accounts: [
      acc({ group: "hak", nomor: "650095380651000", nama: "BPG 037 KPKNL DENPASAR", jenis: "20", kodeBank: "2", bank: "BANK BRI", cabang: "JAKARTA", kodeRek: "20", persNomor: "S-789/WPB.12/KP.02/2020", persTanggal: "2020-02-18", tgl: "2026-09-30", saldo: 42689382 }),
      acc({ group: "bukan", nomor: "1450014836536", nama: "RPL 037 PDJ KPKNL DENPASAR UTK LELA", jenis: "30", kodeBank: "8", bank: "BANK MANDIRI", cabang: "RENON", kodeRek: "360", persNomor: "S-1867/MK.5/2022", persTanggal: "2022-10-14", tgl: "2026-09-30", saldo: 1771352342 }),
      acc({ group: "bukan", nomor: "036801000715304", nama: "RPL 037 KPKNL DENPASAR UTK PIUTANG", jenis: "30", kodeBank: "2", bank: "BANK BRI", cabang: "RENON", kodeRek: "360", persNomor: "S-5929/MK.5/2009", persTanggal: "2015-09-30", tgl: "2026-09-30", saldo: 0 }),
      acc({ group: "bukan", nomor: "036801002268303", nama: "RPL 037 KPKNL DENPASAR UTK PS TKPKN", jenis: "30", kodeBank: "2", bank: "BANK BRI", cabang: "RENON", kodeRek: "350", persNomor: "S-9134/MK.5/2016", persTanggal: "2016-11-11", tgl: "2026-03-12", saldo: 0 })
    ],
    penjelasan: null,
    pemeriksa: null,
    kpa: { nama: "I Ketut Arimbawa", nip: "196902241989121001" },
    bendahara: { nama: "Achmad Chabib Nursalim", nip: "199101162013101002" },
    satker: SATKER,
    city: "Denpasar",
    seed: true,
    submittedAt: "2026-10-15T00:00:00.000Z"
  };
}

// ---------------------------------------------------------------- perhitungan
/** Nilai turunan sebuah rekaman/rancangan. Angka null = belum diisi. */
export function computeView(rec) {
  const denoms = DENOMS.map((n) => ({ nominal: n, count: Math.max(0, Math.round(Number(rec.tunai?.[n]) || 0)) }));
  const tunai = denoms.reduce((s, d) => s + d.nominal * d.count, 0);
  const complete = rec.awal != null && rec.terima != null && rec.keluar != null;
  const A = complete ? rec.awal + rec.terima - rec.keluar : null;
  const accounts = (rec.accounts || []).map((a, i) => {
    const prevSaldo = a.prevSaldo ?? null;
    const saldo = a.saldo ?? (i === 0 ? (A == null ? null : A - tunai) : (prevSaldo ?? 0));
    const tgl = a.tgl ?? (a.prevTgl && saldo === prevSaldo ? a.prevTgl : rec.closingDate);
    return { ...a, saldo, tgl, saldoAuto: a.saldo == null, tglAuto: a.tgl == null };
  });
  const item2 = accounts[0]?.saldo ?? null;
  const B = item2 == null ? null : tunai + item2;
  const selisih = A == null || B == null ? null : A - B;
  const pel = parsePkey(rec.period);
  return {
    satker: rec.satker || SATKER,
    period: pel,
    periodLabel: pel ? periodText(pel) : rec.period,
    periodLabelUpper: pel ? periodText(pel).toUpperCase() : rec.period,
    closingDate: rec.closingDate,
    prevClosingDate: rec.prevClosingDate,
    city: rec.city || "Denpasar",
    accounts,
    awal: rec.awal,
    terima: rec.terima,
    keluar: rec.keluar,
    A,
    denoms,
    tunai,
    item2,
    B,
    selisih,
    penjelasan: rec.penjelasan ?? (selisih == null ? "" : `Kesulitan Pecahan ${fmtRp(selisih)}`),
    pemeriksa: rec.pemeriksa || rec.kpa?.nama || "",
    kpa: rec.kpa || { nama: "", nip: "" },
    bendahara: rec.bendahara || { nama: "", nip: "" }
  };
}

/**
 * Rekaman siap simpan: hanya membuang catatan isian (touched). Nilai otomatis (saldo rekening 1 = saldo buku - tunai,
 * tanggal transaksi terakhir) sengaja TETAP otomatis supaya ikut benar bila angka bulan itu diperbaiki lewat /kas ubah.
 */
export function finalizeRecord(rec) {
  const out = JSON.parse(JSON.stringify(rec));
  delete out.touched;
  return out;
}

// ---------------------------------------------------------------- penguraian perintah
const KEY_RE = /^(terima|penerimaan|masuk|keluar|pengeluaran|awal|saldoawal|rek\d{1,2}|tgl\d{1,2}|tanggal|penutupan|lalu|sebelumnya|tunai|penjelasan|kpa|nipkpa|bendahara|nipbend|pemeriksa)$/i;
const isKey = (t) => KEY_RE.test(t);

/** "/kas ..." (alias /laporankas) -> { arg } atau null. */
export function parseKasCommand(text) {
  const m = String(text ?? "")
    .trim()
    .match(/^[/!](kas|laporankas)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return m ? { arg: String(m[2] || "").trim() } : null;
}

/** "september 2026 terima 100 keluar 50" -> { lead: ["september","2026"], clauses: [{ key, value, tokens }] } */
export function parseClauses(text) {
  const toks = [];
  for (const raw of String(text ?? "").split(/\s+/).filter(Boolean)) {
    const m = raw.match(/^([a-z]+\d*)[:=](.*)$/i);
    if (m && isKey(m[1])) {
      toks.push(m[1]);
      if (m[2]) toks.push(m[2]);
    } else toks.push(raw);
  }
  const lead = [];
  const clauses = [];
  for (const t of toks) {
    if (isKey(t)) clauses.push({ key: t.toLowerCase(), tokens: [] });
    else if (clauses.length) clauses.at(-1).tokens.push(t);
    else lead.push(t);
  }
  for (const c of clauses) c.value = c.tokens.join(" ");
  return { lead, clauses };
}

/**
 * Terapkan klausa ke rekaman (salinan baru). -> { rec, changes: [teks], errors: [teks] }. Ada galat = rec tidak boleh dipakai.
 * ctx.prevBuku = saldo buku bulan sebelumnya (untuk "awal auto").
 */
export function applyEdits(source, clauses, { prevBuku = null } = {}) {
  const rec = JSON.parse(JSON.stringify(source));
  rec.touched = Array.isArray(rec.touched) ? rec.touched : [];
  const changes = [];
  const errors = [];
  const touch = (k) => {
    if (!rec.touched.includes(k)) rec.touched.push(k);
  };
  const money = (c) => {
    const r = parseRupiah(c.tokens.join(""));
    if (r.error) {
      errors.push(`${c.key}: ${r.error}`);
      return null;
    }
    return r.value;
  };
  for (const c of clauses) {
    const k = c.key;
    const val = c.value.trim();
    const auto = /^(auto|otomatis)$/i.test(val);
    let m;
    if (k === "terima" || k === "penerimaan" || k === "masuk") {
      const v = money(c);
      if (v != null) {
        rec.terima = v;
        touch("terima");
        changes.push(`Penerimaan ${idr(v)}`);
      }
    } else if (k === "keluar" || k === "pengeluaran") {
      const v = money(c);
      if (v != null) {
        rec.keluar = v;
        touch("keluar");
        changes.push(`Pengeluaran ${idr(v)}`);
      }
    } else if (k === "awal" || k === "saldoawal") {
      if (auto) {
        if (prevBuku == null) errors.push("awal auto: tidak ada saldo buku bulan sebelumnya");
        else {
          rec.awal = prevBuku;
          rec.awalManual = false;
          changes.push(`Saldo awal ${idr(prevBuku)} (= saldo buku bulan lalu)`);
        }
      } else {
        const v = money(c);
        if (v != null) {
          rec.awal = v;
          rec.awalManual = true;
          touch("awal");
          changes.push(`Saldo awal ${idr(v)} (diubah manual)`);
        }
      }
    } else if ((m = k.match(/^rek(\d{1,2})$/))) {
      const i = Number(m[1]) - 1;
      if (!rec.accounts[i]) errors.push(`${k}: rekening nomor ${m[1]} tidak ada (ada 1-${rec.accounts.length})`);
      else if (auto) {
        rec.accounts[i].saldo = null;
        changes.push(`Rekening ${m[1]}: saldo ${i === 0 ? "otomatis = saldo buku" : "kembali ke saldo bulan lalu"}`);
      } else {
        const v = money(c);
        if (v != null) {
          rec.accounts[i].saldo = v;
          touch(k);
          changes.push(`Rekening ${m[1]} ${idr(v)}`);
        }
      }
    } else if ((m = k.match(/^tgl(\d{1,2})$/))) {
      const i = Number(m[1]) - 1;
      if (!rec.accounts[i]) errors.push(`${k}: rekening nomor ${m[1]} tidak ada (ada 1-${rec.accounts.length})`);
      else if (auto) {
        rec.accounts[i].tgl = null;
        changes.push(`Rekening ${m[1]}: tanggal transaksi terakhir otomatis`);
      } else {
        const iso = parseDate(val);
        if (!iso) errors.push(`${k}: tanggal "${val}" tidak dikenali (contoh 30-10-2026)`);
        else {
          rec.accounts[i].tgl = iso;
          touch(k);
          changes.push(`Rekening ${m[1]}: transaksi terakhir ${ddmmyyyy(iso)}`);
        }
      }
    } else if (k === "tanggal" || k === "penutupan") {
      const iso = parseDate(val);
      if (!iso) errors.push(`${k}: tanggal "${val}" tidak dikenali (contoh 31-10-2026)`);
      else {
        rec.closingDate = iso;
        touch("tanggal");
        changes.push(`Tanggal penutupan ${longDate(iso)}`);
      }
    } else if (k === "lalu" || k === "sebelumnya") {
      const iso = parseDate(val);
      if (!iso) errors.push(`${k}: tanggal "${val}" tidak dikenali (contoh 30-09-2026)`);
      else {
        rec.prevClosingDate = iso;
        touch("lalu");
        changes.push(`Penutupan kas yang lalu ${longDate(iso)}`);
      }
    } else if (k === "tunai") {
      if (/^(0|nol|kosong|reset)$/i.test(val) || !val) {
        if (!val) errors.push("tunai: isi pecahan=jumlah (contoh: tunai 100000=2 50000=1) atau 'tunai 0'");
        else {
          rec.tunai = Object.fromEntries(DENOMS.map((n) => [n, 0]));
          touch("tunai");
          changes.push("Uang tunai: semua pecahan 0");
        }
      } else {
        const next = { ...rec.tunai };
        let bad = false;
        for (const pair of c.tokens) {
          const pm = pair.match(/^(\d[\d.]*)[=x:*](\d+)$/i);
          const nominal = pm ? Number(pm[1].replace(/\./g, "")) : 0;
          if (!pm || !DENOMS.includes(nominal)) {
            errors.push(`tunai: "${pair}" tidak dikenali. Pecahan yang ada: ${DENOMS.join(", ")} (contoh 100000=2)`);
            bad = true;
            break;
          }
          next[nominal] = Number(pm[2]);
        }
        if (!bad) {
          rec.tunai = next;
          touch("tunai");
          changes.push(`Uang tunai ${idr(DENOMS.reduce((s, n) => s + n * (Number(next[n]) || 0), 0))}`);
        }
      }
    } else if (k === "penjelasan") {
      rec.penjelasan = auto || !val ? null : val;
      touch("penjelasan");
      changes.push(auto || !val ? "Penjelasan: otomatis" : `Penjelasan: ${val}`);
    } else if (k === "kpa") {
      if (!val) errors.push("kpa: isi nama (contoh: kpa I Ketut Arimbawa)");
      else {
        rec.kpa = { ...rec.kpa, nama: val };
        changes.push(`KPA ${val}`);
      }
    } else if (k === "nipkpa") {
      rec.kpa = { ...rec.kpa, nip: val.replace(/\s+/g, "") };
      changes.push(`NIP KPA ${rec.kpa.nip}`);
    } else if (k === "bendahara") {
      if (!val) errors.push("bendahara: isi nama");
      else {
        rec.bendahara = { ...rec.bendahara, nama: val };
        changes.push(`Bendahara ${val}`);
      }
    } else if (k === "nipbend") {
      rec.bendahara = { ...rec.bendahara, nip: val.replace(/\s+/g, "") };
      changes.push(`NIP Bendahara ${rec.bendahara.nip}`);
    } else if (k === "pemeriksa") {
      rec.pemeriksa = auto || !val ? null : val;
      changes.push(auto || !val ? "Pemeriksa kas: sama dengan KPA" : `Pemeriksa kas ${val}`);
    }
  }
  return { rec, changes, errors };
}

// ---------------------------------------------------------------- teks ringkasan
/** Ringkasan satu rekaman/rancangan untuk chat. mode: "draft" | "saved". */
export function describeRecord(rec, mode = "saved") {
  const v = computeView(rec);
  const draft = mode === "draft";
  const touched = new Set(rec.touched || []);
  const L = [];
  L.push(`🧾 *Laporan Kas ${v.periodLabel}* ${draft ? "— RANCANGAN (belum disimpan)" : rec.seed ? "— tersimpan (data awal dari PDF contoh)" : "— tersimpan"}`);
  L.push(`Penutupan: ${longDate(v.closingDate)} (sebelumnya ${longDate(v.prevClosingDate)})`);
  L.push(`Saldo awal: ${idr(v.awal)}${draft ? (rec.awalManual ? " _(diubah manual)_" : " _(= saldo buku bulan lalu)_") : ""}`);
  L.push(`Penerimaan: ${v.terima == null ? "❓ *belum diisi*" : idr(v.terima)}`);
  L.push(`Pengeluaran: ${v.keluar == null ? "❓ *belum diisi*" : idr(v.keluar)}`);
  L.push(`Saldo buku (A): ${idr(v.A)}`);
  const tunaiParts = v.denoms.filter((d) => d.count > 0).map((d) => `${d.nominal}×${d.count}`);
  L.push(`Uang tunai: ${idr(v.tunai)}${tunaiParts.length ? ` (${tunaiParts.join(", ")})` : " (semua pecahan 0)"}`);
  L.push(`Saldo kas (B): ${idr(v.B)} _(tunai + saldo rekening 1)_`);
  if (v.selisih == null) L.push("Selisih (A−B): —");
  else L.push(`Selisih (A−B): ${v.selisih === 0 ? "Rp 0 ✅" : `*${idr(v.selisih)}* ⚠️ (saldo buku ≠ saldo kas; cek angkanya)`}`);
  L.push(`Penjelasan: ${v.penjelasan || "—"}`);
  L.push("", "*Rekening*");
  v.accounts.forEach((a, i) => {
    const n = i + 1;
    let note = "";
    if (draft) {
      if (a.saldoAuto) note = i === 0 ? " _(otomatis = saldo buku − tunai)_" : " _(sama dengan bulan lalu)_";
      else if (!touched.has(`rek${n}`)) note = "";
    }
    const dateNote = draft && a.tglAuto ? (a.tgl === rec.closingDate ? "" : " _(sama dengan bulan lalu)_") : "";
    L.push(`${n}. ${String(a.nama).slice(0, 35)}${a.group === "hak" ? " [hak negara]" : ""}`);
    L.push(`    ${idr(a.saldo)}${note} · transaksi terakhir ${ddmmyyyy(a.tgl)}${dateNote}`);
  });
  const sum = (g) => v.accounts.filter((a) => (g === "hak" ? a.group === "hak" : a.group !== "hak")).reduce((s, a) => s + (a.saldo || 0), 0);
  L.push(`Jumlah telah menjadi hak negara: ${idr(sum("hak"))} · belum/tidak: ${idr(sum("bukan"))}`);
  L.push("", `KPA/pemeriksa kas: ${v.pemeriksa} (KPA ${v.kpa.nama}) · Bendahara: ${v.bendahara.nama}`);
  return L.join("\n");
}

const HOW_TO = [
  "*Cara mengisi* (boleh sekaligus, satu pesan):",
  "`/kas terima 157509115 keluar 165717883`",
  "Saldo rekening 2, 3, ...: `/kas rek2 1771352342`. Rekening 1 (BPG) otomatis = saldo buku; kalau saldo bank sebenarnya beda: `/kas rek1 42689382`",
  "Lain-lain: `/kas tgl2 30-10-2026` (transaksi terakhir), `/kas tunai 100000=2 50000=1`, `/kas penjelasan ...`, `/kas awal ...`",
  "Sudah benar semua? `/kas submit` (simpan + buat PDF & Word). Lihat lagi: `/kas`. Mulai ulang isian: `/kas ulang`."
].join("\n");

export const KAS_HELP = [
  "🧾 *Laporan kas bulanan* (Saldo Rekening + Register Penutupan Kas)",
  "Tiap awal bulan bot menyiapkan rancangan bulan lalu dan meminta konfirmasimu.",
  "",
  HOW_TO,
  "",
  "*Data tersimpan*",
  "`/kas daftar` — bulan yang sudah tersimpan",
  "`/kas lihat september` — angka tersimpan (tahun otomatis; boleh `september 2026`)",
  "`/kas dokumen september` — buat ulang PDF + Word dari data tersimpan",
  "`/kas ubah september keluar 165717883` — perbaiki data bulan lama (bulan sesudahnya diperiksa)",
  "`/kas pratinjau` — PDF + Word dari rancangan (sebelum submit)",
  "`/kas mulai` — buat rancangan sekarang (biasanya otomatis)",
  "`/kas status` — jadwal dan keadaan sekarang"
].join("\n");

// ---------------------------------------------------------------- layanan
const sizeKb = (b) => `${Math.max(1, Math.round(b.length / 1024))} KB`;

/**
 * deps: { config, state: {get,set}, send(text), convert(docxBuf)->Promise<Buffer pdf> (opsional), timeZone, tzLabel, now(), log }
 * handle(arg) -> { ok, text, files?: [{name,data,mime}], caption? }
 */
export function createKas({ config, state, send, convert = null, timeZone = "Asia/Jakarta", tzLabel = "WIB", now = () => Date.now(), log = console } = {}) {
  let chain = Promise.resolve();
  const lock = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  let lastTry = 0;

  const nowParts = () => tzParts(now(), timeZone);
  const todayStr = () => {
    const p = nowParts();
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  };

  // --- penyimpanan
  async function readJson(key) {
    const raw = await state.get(key);
    if (raw == null || raw === "" || raw === "null") return null;
    return JSON.parse(raw);
  }
  const writeJson = (key, value) => state.set(key, JSON.stringify(value));

  async function readIndex() {
    const raw = await state.get(INDEX_KEY);
    if (raw == null) {
      // belum pernah dipakai: tanam data September 2026 (dari PDF contoh) sebagai titik awal rantai saldo
      const seed = seedRecord();
      await writeJson(recKey(seed.period), seed);
      await writeJson(INDEX_KEY, [seed.period]);
      return [seed.period];
    }
    const list = JSON.parse(raw);
    return Array.isArray(list) ? [...list].sort() : [];
  }
  const getRec = (pkey) => readJson(recKey(pkey));
  async function saveRec(rec) {
    await writeJson(recKey(rec.period), rec);
    const idx = new Set(await readIndex());
    idx.add(rec.period);
    await writeJson(INDEX_KEY, [...idx].sort());
  }
  const getDraft = () => readJson(DRAFT_KEY);
  const saveDraft = (d) => state.set(DRAFT_KEY, d ? JSON.stringify(d) : "null");

  // --- pembuatan rancangan dari bulan sebelumnya
  function draftFrom(prev, period) {
    const pv = computeView(prev);
    const pkey = pkeyOf(period);
    return {
      period: pkey,
      closingDate: lastDayIso(period),
      prevClosingDate: prev.closingDate,
      awal: pv.A,
      awalManual: false,
      terima: null,
      keluar: null,
      tunai: { ...prev.tunai },
      accounts: pv.accounts.map((a) => ({
        group: a.group, ba: a.ba, es: a.es, kode: a.kode, nomor: a.nomor, nama: a.nama, jenis: a.jenis, kodeBank: a.kodeBank,
        bank: a.bank, cabang: a.cabang, kodeRek: a.kodeRek, persNomor: a.persNomor, persTanggal: a.persTanggal, ket: a.ket || "-",
        saldo: null, tgl: null, prevSaldo: a.saldo, prevTgl: a.tgl
      })),
      penjelasan: null,
      pemeriksa: prev.pemeriksa ?? null,
      kpa: prev.kpa,
      bendahara: prev.bendahara,
      satker: prev.satker,
      city: prev.city,
      touched: []
    };
  }

  async function latestRecord(index) {
    const key = index.at(-1);
    return key ? getRec(key) : null;
  }

  // --- dokumen
  async function buildFiles(rec, { preview = false } = {}) {
    const view = computeView(rec);
    if (view.A == null) throw new Error("Penerimaan/pengeluaran belum diisi");
    const docx = buildKasDocx(view);
    const base = `Saldo_Rekening_dan_Register_Kas_${BULAN[view.period.m - 1]}_${view.period.y}${preview ? "_pratinjau" : ""}`;
    const files = [];
    let pdfError = "";
    if (config.pdf) {
      try {
        if (!convert) throw new Error("pembuat PDF tidak tersedia");
        files.push({ name: `${base}.pdf`, data: await convert(docx), mime: "application/pdf" });
      } catch (e) {
        pdfError = String(e?.message || e).slice(0, 300);
      }
    }
    files.push({ name: `${base}.docx`, data: docx, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const caption = [`📄 *Laporan Saldo Rekening & Register Penutupan Kas — ${view.periodLabel}*${preview ? " (PRATINJAU)" : ""}`, `Saldo buku ${idr(view.A)} · selisih ${idr(view.selisih)}`, "QR tanda tangan ditambahkan sistem persuratan."].join("\n");
    return { files, caption, pdfError, view };
  }

  function filesNote(r) {
    return [r.pdfError ? `⚠️ PDF tidak dibuat (${r.pdfError}). Word tetap dikirim.` : "", r.files.map((f) => `• ${f.name} (${sizeKb(f.data)})`).join("\n")].filter(Boolean).join("\n");
  }

  // --- penentuan bulan dari kata-kata ("september", "9 2026", "2026-09")
  function resolvePeriod(words, index) {
    const text = words.join(" ").trim().toLowerCase();
    if (!text) return { period: null };
    let month = 0;
    let year = 0;
    const iso = text.match(/^(\d{4})[-/](\d{1,2})$/);
    const num = text.match(/^(\d{1,2})[-/\s](\d{4})$/);
    if (iso) [year, month] = [Number(iso[1]), Number(iso[2])];
    else if (num) [month, year] = [Number(num[1]), Number(num[2])];
    else {
      for (const t of text.split(/[\s,/-]+/).filter(Boolean)) {
        if (MONTH_WORDS[t]) month = MONTH_WORDS[t];
        else if (/^\d{4}$/.test(t)) year = Number(t);
        else if (/^\d{1,2}$/.test(t) && !month) month = Number(t);
        else return { error: `Tidak mengerti "${t}". Contoh: september, september 2026, 9 2026` };
      }
    }
    if (!(month >= 1 && month <= 12)) return { error: "Bulan tidak dikenal. Contoh: september, september 2026, 9 2026" };
    if (!year) {
      const found = index.map(parsePkey).filter((p) => p && p.m === month).sort((a, b) => b.y - a.y);
      if (found.length) year = found[0].y;
      else {
        const p = nowParts();
        year = month <= p.m ? p.y : p.y - 1;
      }
    }
    return { period: { y: year, m: month } };
  }

  // --- perintah
  async function overview(index) {
    const draft = await getDraft();
    if (draft) return { ok: true, text: `${describeRecord(draft, "draft")}\n\n${HOW_TO}` };
    const latest = await latestRecord(index);
    const lines = [latest ? describeRecord(latest, "saved") : "Belum ada data tersimpan.", "", `Bulan berikutnya yang akan diisi: *${latest ? periodText(nextPeriod(parsePkey(latest.period))) : "—"}* (rancangan dibuat otomatis tiap tanggal ${config.day} pukul ${String(config.hour).padStart(2, "0")}.${String(config.minute).padStart(2, "0")} ${tzLabel}).`, "Bantuan: `/kas bantuan`"];
    return { ok: true, text: lines.join("\n") };
  }

  async function startDraft(words, index) {
    if (await getDraft()) return { ok: false, text: "Masih ada rancangan yang belum disubmit. Ketik /kas untuk melihatnya, atau /kas ulang untuk mengisi dari awal." };
    const latest = await latestRecord(index);
    if (!latest) return { ok: false, text: "Belum ada data bulan sebelumnya sebagai dasar (saldo awal)." };
    const target = nextPeriod(parsePkey(latest.period));
    const r = resolvePeriod(words, index);
    if (r.error) return { ok: false, text: r.error };
    if (r.period && cmpPeriod(r.period, target) !== 0) {
      if (index.includes(pkeyOf(r.period))) return { ok: false, text: `${periodText(r.period)} sudah tersimpan. Untuk memperbaikinya: /kas ubah ${BULAN[r.period.m - 1].toLowerCase()} ...` };
      return { ok: false, text: `Isi dulu berurutan: bulan berikutnya adalah ${periodText(target)} (saldo awal diambil dari bulan sebelumnya).` };
    }
    const draft = draftFrom(latest, target);
    await saveDraft(draft);
    return { ok: true, text: `${describeRecord(draft, "draft")}\n\n${HOW_TO}` };
  }

  async function editDraft(clauses, index) {
    const draft = await getDraft();
    if (!draft) return { ok: false, text: "Belum ada rancangan. Ketik /kas mulai untuk membuatnya (atau /kas ubah <bulan> ... untuk memperbaiki bulan yang sudah tersimpan)." };
    const prev = await getRec(index.filter((k) => k < draft.period).at(-1) || "");
    const prevBuku = prev ? computeView(prev).A : null;
    const { rec, changes, errors } = applyEdits(draft, clauses, { prevBuku });
    if (errors.length) return { ok: false, text: `⚠️ Tidak ada yang diubah:\n${errors.map((e) => `• ${e}`).join("\n")}` };
    await saveDraft(rec);
    return { ok: true, text: `✅ Diperbarui: ${changes.join("; ")}\n\n${describeRecord(rec, "draft")}\n\nSudah benar? \`/kas submit\`. Belum? lanjut isi dengan /kas ...` };
  }

  async function submit(index) {
    const draft = await getDraft();
    if (!draft) return { ok: false, text: "Tidak ada rancangan untuk disubmit. Ketik /kas mulai." };
    const v = computeView(draft);
    const missing = [draft.terima == null ? "penerimaan (terima)" : "", draft.keluar == null ? "pengeluaran (keluar)" : ""].filter(Boolean);
    if (missing.length) return { ok: false, text: `Belum bisa submit, masih kosong: ${missing.join(", ")}.\nContoh: /kas terima 157509115 keluar 165717883` };
    const rec = finalizeRecord(draft);
    rec.submittedAt = new Date(now()).toISOString();
    await saveRec(rec);
    await saveDraft(null);
    const lines = [`✅ *Laporan Kas ${v.periodLabel} DISIMPAN*`, `Saldo buku ${idr(v.A)} · saldo kas ${idr(v.B)} · selisih ${idr(v.selisih)}${v.selisih === 0 ? " ✅" : " ⚠️"}`];
    if (v.selisih !== 0) lines.push("⚠️ Ada selisih; pastikan penjelasannya benar (bisa diperbaiki: /kas ubah ...).");
    let r = null;
    try {
      r = await buildFiles(rec);
      lines.push(filesNote(r));
    } catch (e) {
      lines.push(`⚠️ Data tersimpan, tetapi dokumen gagal dibuat: ${String(e?.message || e).slice(0, 200)}. Coba lagi: /kas dokumen ${BULAN[v.period.m - 1].toLowerCase()}`);
    }
    lines.push(`Data bisa dipanggil kapan saja: /kas lihat, /kas dokumen. Bulan berikutnya (${periodText(nextPeriod(v.period))}) disiapkan otomatis tiap tanggal ${config.day}.`);
    return { ok: true, text: lines.join("\n"), ...(r ? { files: r.files, caption: r.caption } : {}) };
  }

  async function preview() {
    const draft = await getDraft();
    if (!draft) return { ok: false, text: "Tidak ada rancangan. Ketik /kas mulai." };
    if (draft.terima == null || draft.keluar == null) return { ok: false, text: "Isi dulu penerimaan dan pengeluaran (/kas terima ... keluar ...), baru pratinjau bisa dibuat." };
    const r = await buildFiles(draft, { preview: true });
    return { ok: true, text: `Pratinjau (belum disimpan):\n${filesNote(r)}`, files: r.files, caption: r.caption };
  }

  async function showSaved(words, index, { withFiles }) {
    if (!index.length) return { ok: false, text: "Belum ada data tersimpan." };
    const r = resolvePeriod(words, index);
    if (r.error) return { ok: false, text: r.error };
    const key = r.period ? pkeyOf(r.period) : index.at(-1);
    if (!index.includes(key)) return { ok: false, text: `Data ${r.period ? periodText(r.period) : key} belum tersimpan. Tersimpan: ${index.map((k) => periodText(parsePkey(k))).join(", ")}.` };
    const rec = await getRec(key);
    if (!rec) return { ok: false, text: `Data ${key} tidak terbaca dari penyimpanan.` };
    if (!withFiles) return { ok: true, text: describeRecord(rec, "saved") };
    const f = await buildFiles(rec);
    return { ok: true, text: `${describeRecord(rec, "saved")}\n\n${filesNote(f)}`, files: f.files, caption: f.caption };
  }

  async function list(index) {
    if (!index.length) return { ok: true, text: "Belum ada data tersimpan." };
    const rows = [];
    for (const k of [...index].reverse()) {
      const rec = await getRec(k);
      if (!rec) continue;
      const v = computeView(rec);
      rows.push(`• ${v.periodLabel}: saldo buku ${idr(v.A)}${v.selisih ? ` ⚠️ selisih ${idr(v.selisih)}` : ""}${rec.seed ? " (data awal)" : ""}`);
    }
    const draft = await getDraft();
    if (draft) rows.unshift(`• ${periodText(parsePkey(draft.period))}: RANCANGAN (belum disubmit)`);
    return { ok: true, text: `🗂️ *Laporan kas tersimpan*\n${rows.join("\n")}` };
  }

  async function editSaved(lead, clauses, index) {
    if (!clauses.length) return { ok: false, text: "Isi yang diubah. Contoh: /kas ubah september keluar 165717883" };
    const r = resolvePeriod(lead, index);
    if (r.error) return { ok: false, text: r.error };
    if (!r.period) return { ok: false, text: "Sebut bulannya. Contoh: /kas ubah september keluar 165717883" };
    const key = pkeyOf(r.period);
    const rec = await getRec(index.includes(key) ? key : "");
    if (!rec) return { ok: false, text: `Data ${periodText(r.period)} belum tersimpan (tersimpan: ${index.map((k) => periodText(parsePkey(k))).join(", ") || "tidak ada"}).` };
    const prev = await getRec(index.filter((k) => k < key).at(-1) || "");
    const { rec: next, changes, errors } = applyEdits(rec, clauses, { prevBuku: prev ? computeView(prev).A : null });
    if (errors.length) return { ok: false, text: `⚠️ Tidak ada yang diubah:\n${errors.map((e) => `• ${e}`).join("\n")}` };
    const saved = finalizeRecord(next);
    saved.editedAt = new Date(now()).toISOString();
    await saveRec(saved);
    const before = computeView(rec);
    const after = computeView(saved);
    const notes = [];
    const nextKey = index.find((k) => k > key);
    if (nextKey && before.A !== after.A) {
      const nxt = await getRec(nextKey);
      const nv = nxt ? computeView(nxt) : null;
      if (nv && nv.awal !== after.A) notes.push(`⚠️ Saldo buku ${after.periodLabel} sekarang ${idr(after.A)}, tetapi saldo awal ${nv.periodLabel} masih ${idr(nv.awal)}. Sesuaikan: /kas ubah ${BULAN[nv.period.m - 1].toLowerCase()} awal ${after.A}`);
    }
    const draft = await getDraft();
    if (draft && pkeyOf(prevPeriod(parsePkey(draft.period))) === key) {
      // rancangan bulan sesudahnya membawa angka bulan ini: segarkan (saldo awal bila tidak diubah manual, dan saldo/tanggal pembanding rekening)
      const stale = (!draft.awalManual && draft.awal !== after.A) || draft.accounts.some((a, i) => a.prevSaldo !== after.accounts[i]?.saldo || a.prevTgl !== after.accounts[i]?.tgl);
      if (stale) {
        if (!draft.awalManual) draft.awal = after.A;
        draft.accounts.forEach((a, i) => {
          if (after.accounts[i]) {
            a.prevSaldo = after.accounts[i].saldo;
            a.prevTgl = after.accounts[i].tgl;
          }
        });
        await saveDraft(draft);
        notes.push(`Rancangan ${periodText(parsePkey(draft.period))} ikut diperbarui (saldo awal ${idr(draft.awal)}).`);
      }
    }
    const diff = before.A !== after.A || before.selisih !== after.selisih ? `\nSaldo buku ${idr(before.A)} → ${idr(after.A)}; selisih ${idr(before.selisih)} → ${idr(after.selisih)}.` : "";
    return { ok: true, text: [`✅ ${after.periodLabel} diperbaiki: ${changes.join("; ")}${diff}`, ...notes, `Dokumen baru: /kas dokumen ${BULAN[after.period.m - 1].toLowerCase()}`].join("\n") };
  }

  async function resetDraft(index) {
    const draft = await getDraft();
    if (!draft) return startDraft([], index);
    const prev = await getRec(index.filter((k) => k < draft.period).at(-1) || "");
    if (!prev) return { ok: false, text: "Data bulan sebelumnya tidak ditemukan; rancangan tidak bisa diulang." };
    const fresh = draftFrom(prev, parsePkey(draft.period));
    await saveDraft(fresh);
    return { ok: true, text: `Isian dikosongkan.\n\n${describeRecord(fresh, "draft")}\n\n${HOW_TO}` };
  }

  async function status() {
    const index = await readIndex();
    const draft = await getDraft();
    const latest = await latestRecord(index);
    const t = `${String(config.hour).padStart(2, "0")}.${String(config.minute).padStart(2, "0")} ${tzLabel}`;
    return [
      "🧾 *Laporan kas bulanan*",
      `Jadwal: ${config.enabled ? `rancangan otomatis tiap tanggal ${config.day} pukul ${t}; pengingat tiap hari sampai disubmit` : "otomatis MATI"}.`,
      `Tersimpan: ${index.length} bulan${latest ? `, terakhir ${periodText(parsePkey(latest.period))} (saldo buku ${idr(computeView(latest).A)})` : ""}.`,
      draft ? `Rancangan aktif: ${periodText(parsePkey(draft.period))} (belum disubmit): /kas` : `Rancangan aktif: tidak ada. Berikutnya: ${latest ? periodText(nextPeriod(parsePkey(latest.period))) : "—"}.`,
      `Dokumen: PDF ${config.pdf ? "ya (bila LibreOffice berfungsi)" : "mati"} + Word.`
    ].join("\n");
  }

  async function handleInner(arg) {
    const text = String(arg || "").trim();
    const index = await readIndex();
    if (!text) return overview(index);
    const first = text.split(/\s+/)[0].toLowerCase();
    const rest = text.slice(first.length).trim();
    const words = rest ? rest.split(/\s+/) : [];
    switch (first) {
      case "bantuan":
      case "help":
        return { ok: true, text: KAS_HELP };
      case "status":
        return { ok: true, text: await status() };
      case "mulai":
        return startDraft(words, index);
      case "ulang":
      case "reset":
        return resetDraft(index);
      case "submit":
      case "kirim":
      case "simpan":
        return submit(index);
      case "pratinjau":
      case "preview":
        return preview();
      case "lihat":
      case "data":
        return showSaved(words, index, { withFiles: false });
      case "dokumen":
      case "dok":
      case "file":
        return showSaved(words, index, { withFiles: true });
      case "daftar":
      case "riwayat":
        return list(index);
      case "ubah":
      case "koreksi": {
        const { lead, clauses } = parseClauses(rest);
        return editSaved(lead, clauses, index);
      }
      default: {
        const { lead, clauses } = parseClauses(text);
        if (lead.length || !clauses.length) return { ok: false, text: `Perintah "/kas ${first}" tidak dikenal.\nIsi angka: /kas terima ... keluar ...  ·  Bantuan: /kas bantuan` };
        return editDraft(clauses, index);
      }
    }
  }

  /** Untuk perintah /kas (Telegram & WhatsApp). */
  function handle(arg = "") {
    return lock(async () => {
      try {
        return await handleInner(arg);
      } catch (e) {
        log.error?.(`🧾 [Kas] gagal: ${e?.message || e}`);
        return { ok: false, text: `⚠️ Perintah kas gagal diproses: ${String(e?.message || e).slice(0, 200)}` };
      }
    });
  }

  function describe() {
    if (!config.enabled) return "mati (KAS_ENABLED=false)";
    return `AKTIF (rancangan tiap tanggal ${config.day} pukul ${String(config.hour).padStart(2, "0")}.${String(config.minute).padStart(2, "0")} ${tzLabel} untuk bulan lalu, pengingat harian sampai /kas submit; PDF: ${config.pdf ? "ya" : "mati"})`;
  }

  /** Dipanggil tiap menit: membuat rancangan bulan lalu bila sudah waktunya, dan mengingatkan sekali sehari sampai disubmit. */
  function check() {
    if (!config.enabled) return Promise.resolve(false);
    const p = nowParts();
    if (p.d < config.day || p.h * 60 + p.mi < config.hour * 60 + config.minute) return Promise.resolve(false);
    if (now() - lastTry < 30 * 60_000) return Promise.resolve(false);
    return lock(async () => {
      let index;
      let draft;
      let remind;
      try {
        index = await readIndex();
        draft = await getDraft();
        remind = await state.get(REMIND_KEY);
      } catch {
        return false; // basis data belum bisa dibaca: coba lagi menit berikutnya
      }
      const today = todayStr();
      if (remind === today) return false;
      const latest = await latestRecord(index);
      if (!latest) return false;
      let heading = "";
      if (draft) {
        heading = `⏰ *Pengingat:* laporan kas ${periodText(parsePkey(draft.period))} belum disubmit.`;
      } else {
        const target = nextPeriod(parsePkey(latest.period));
        const due = { y: p.m === 1 ? p.y - 1 : p.y, m: p.m === 1 ? 12 : p.m - 1 };
        if (cmpPeriod(target, due) > 0) return false; // belum waktunya
        draft = draftFrom(latest, target);
        await saveDraft(draft);
        heading = `🧾 *Awal bulan: waktunya laporan kas ${periodText(target)}.* Saya sudah menyiapkan rancangannya dari bulan lalu; tolong cek dan isi angkanya.`;
      }
      lastTry = now();
      try {
        await send(`${heading}\n\n${describeRecord(draft, "draft")}\n\n${HOW_TO}`);
        await state.set(REMIND_KEY, today).catch(() => {});
        log.log?.(`🧾 [Kas] rancangan/pengingat ${draft.period} terkirim.`);
        return true;
      } catch (e) {
        log.error?.(`🧾 [Kas] gagal mengirim rancangan/pengingat: ${e?.message || e}`);
        return false;
      }
    });
  }

  return { check, handle, describe, status };
}
