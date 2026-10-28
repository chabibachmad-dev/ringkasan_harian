// Pembuat data kalkulator SBM dari PDF PMK Standar Biaya Masukan (hanya dijalankan manual saat PMK baru terbit).
//   node sbm-build.mjs <PMK.pdf> [keluaran.json]          (butuh pdftotext)
//   node sbm-build.mjs --txt <hasil-pdftotext.txt> [keluaran.json]
// Default keluaran: data/sbm-pmk32-2025.json. Semua angka disalin dari tabel PDF beserta nomor halamannya;
// tidak ada angka yang diketik tangan. Skrip berhenti dengan galat bila jumlah baris tidak sesuai harapan.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const rp = (s) => Number(String(s).replace(/[^\d]/g, ""));
const letters = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, "");

// PMK memakai "SUMATRA", "R I A U", "JAM BI", "B A N TE N", "D.K.I. JAKARTA": samakan lewat kunci huruf.
export function provKey(raw) {
  return letters(raw).replace(/^SUMATRA/, "SUMATERA");
}
const TITLE_FIX = { DKI: "DKI", DI: "DI", NTB: "NTB", NTT: "NTT" };
export function provDisplay(raw) {
  const s = String(raw).trim();
  if (/D\.?K\.?I/i.test(s)) return "DKI Jakarta";
  if (/D\.?I\.?\s*YOGYA/i.test(s)) return "DI Yogyakarta";
  const k = provKey(s);
  if (["ACEH", "RIAU", "JAMBI", "LAMPUNG", "BENGKULU", "BANTEN", "BALI", "GORONTALO", "MALUKU", "PAPUA"].includes(k)) return k[0] + k.slice(1).toLowerCase(); // "B A L I", "JAM BI", ...
  const names = { NUSATENGGARABARAT: "Nusa Tenggara Barat", NUSATENGGARATIMUR: "Nusa Tenggara Timur", BANGKABELITUNG: "Bangka Belitung", KEPULAUANRIAU: "Kepulauan Riau" };
  if (names[k]) return names[k];
  return s
    .replace(/\s+/g, " ")
    .replace(/SUMATRA/i, "SUMATERA")
    .split(" ")
    .map((w) => (w.length === 1 ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ")
    .replace(/^R I A U$/i, "Riau");
}

const RP = "Rp\\s?[\\d.]+";
const ROW_PROV = new RegExp(`^\\s*(\\d{1,2})\\.?\\s+([A-Z][A-Z .]*?)\\s+(?:OH|Orang/Kali)\\s+((?:${RP}\\s*)+)$`);

/** Teks satu halaman -> [{ no, name, vals[] }] untuk tabel per provinsi. */
export function parseProvRows(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = ROW_PROV.exec(line);
    if (!m) continue;
    const vals = [...m[3].matchAll(/Rp\s?([\d.]+)/g)].map((x) => rp(x[1]));
    out.push({ no: Number(m[1]), name: m[2].trim(), vals });
  }
  return out;
}

const ROW_TIKET = /^\s*(\d{1,3})\.?\s+([A-Z][A-Z .\-']*?)\s{2,}([A-Z][A-Z .\-']*?)\s{2,}Rp\s?([\d.]+)\s+Rp\s?([\d.]+)\s*$/;
export function parseTiketRows(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = ROW_TIKET.exec(line);
    if (m) out.push({ no: Number(m[1]), asal: m[2].trim(), tujuan: m[3].trim(), bisnis: rp(m[4]), ekonomi: rp(m[5]) });
  }
  return out;
}

const ROW_DARAT = /^\s*(\d{1,4})\.?\s+(.+?)\s{2,}((?:Kab\.|Kota)\s.+?)\s{2,}Orang\/Kali\s+Rp\s?([\d.]+)\s*$/;
export function parseDaratRows(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = ROW_DARAT.exec(line);
    if (m) out.push({ no: Number(m[1]), ibukota: m[2].trim(), tujuan: m[3].trim(), nilai: rp(m[4]) });
  }
  return out;
}

const ROW_REP = new RegExp(`^\\s*\\d\\.\\s+(PEJABAT[A-Z /]+?)\\s+OH\\s+(${RP})\\s+(${RP})\\s*$`);

export function buildSbm(pages, { sumber = "PMK Nomor 32 Tahun 2025 tentang Standar Biaya Masukan Tahun Anggaran 2026" } = {}) {
  const page = (n) => pages[n - 1] || "";
  const warnings = [];
  const must = (cond, msg) => {
    if (!cond) throw new Error(`Data SBM tidak sesuai harapan: ${msg}`);
  };

  // 28.1 uang harian dalam negeri (hlm 15)
  const harianRows = parseProvRows(page(15)).filter((r) => r.vals.length === 3);
  must(harianRows.length === 38, `uang harian: ${harianRows.length} provinsi (harus 38)`);
  const provinsi = harianRows.map((r) => ({ key: provKey(r.name), nama: provDisplay(r.name) }));
  const uangHarian = {};
  for (const r of harianRows) uangHarian[provKey(r.name)] = { luarKota: r.vals[0], dalamKota8Jam: r.vals[1], diklat: r.vals[2], hlm: 15 };

  // 28.2 uang representasi
  const representasi = [];
  for (const line of page(15).split("\n")) {
    const m = ROW_REP.exec(line);
    if (m) representasi.push({ jabatan: m[1].trim(), luarKota: rp(m[2]), dalamKota8Jam: rp(m[3]), hlm: 15 });
  }
  must(representasi.length === 3, `uang representasi: ${representasi.length} baris (harus 3)`);

  // 30 penginapan (hlm 19)
  const penRows = parseProvRows(page(19)).filter((r) => r.vals.length === 4);
  must(penRows.length === 38, `penginapan: ${penRows.length} provinsi (harus 38)`);
  const penginapan = {};
  for (const r of penRows) {
    const k = provKey(r.name);
    must(uangHarian[k], `penginapan: provinsi '${r.name}' tidak ada di tabel uang harian`);
    penginapan[k] = { t1: r.vals[0], t2: r.vals[1], t3: r.vals[2], t4: r.vals[3], hlm: 19 };
  }

  // 16 transportasi dari/ke terminal-bandara (hlm 85)
  const termRows = parseProvRows(page(85)).filter((r) => r.vals.length === 1);
  const terminal = {};
  for (const r of termRows) {
    const k = provKey(r.name);
    if (uangHarian[k]) terminal[k] = { nilai: r.vals[0], hlm: 85 };
  }
  if (Object.keys(terminal).length !== 38) warnings.push(`transport terminal: ${Object.keys(terminal).length}/38 provinsi terbaca`);

  // 17 tiket pesawat DN PP (hlm 86-90)
  const tiket = [];
  for (let p = 86; p <= 90; p++) for (const r of parseTiketRows(page(p))) tiket.push({ asal: r.asal, tujuan: r.tujuan, bisnis: r.bisnis, ekonomi: r.ekonomi, hlm: p, no: r.no });
  must(tiket.length >= 250, `tiket pesawat: hanya ${tiket.length} rute terbaca`);
  const nos = tiket.map((t) => t.no);
  const gaps = [];
  for (let i = 1; i <= Math.max(...nos); i++) if (!nos.includes(i)) gaps.push(i);
  if (gaps.length) warnings.push(`tiket pesawat: nomor urut tidak terbaca/tidak ada di teks PDF: ${gaps.join(", ")}`);

  // 1-2 transpor darat ibukota provinsi -> kab/kota (hlm 62-68)
  const darat = [];
  for (let p = 62; p <= 69; p++) for (const r of parseDaratRows(page(p))) darat.push({ ibukota: r.ibukota, tujuan: r.tujuan, nilai: r.nilai, hlm: p });
  if (darat.length < 300) warnings.push(`transpor darat: hanya ${darat.length} baris terbaca`);

  return {
    meta: { sumber, dibuat: new Date().toISOString().slice(0, 10), catatan: "Disalin otomatis dari tabel PDF oleh sbm-build.mjs. Lampiran I = batas tertinggi; Lampiran II (terminal, tiket, transpor darat) = dapat dilampaui.", warnings },
    provinsi,
    uangHarian,
    representasi,
    penginapan,
    terminal,
    tiket: tiket.map(({ no, ...t }) => t),
    darat
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const txtMode = args[0] === "--txt";
  const input = txtMode ? args[1] : args[0];
  const outFile = (txtMode ? args[2] : args[1]) || path.join(path.dirname(new URL(import.meta.url).pathname), "data", "sbm-pmk32-2025.json");
  if (!input) {
    console.error("Pakai: node sbm-build.mjs <PMK.pdf> [keluaran.json]  |  node sbm-build.mjs --txt <teks.txt> [keluaran.json]");
    process.exit(2);
  }
  const raw = txtMode ? fs.readFileSync(input, "utf8") : execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", input, "-"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
  const pages = raw.split("\f");
  const data = buildSbm(pages);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(data));
  console.log(`OK: ${outFile}`);
  console.log(`provinsi ${data.provinsi.length} • tiket ${data.tiket.length} rute • transpor darat ${data.darat.length} baris`);
  for (const w of data.meta.warnings) console.log(`PERINGATAN: ${w}`);
}
