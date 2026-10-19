// Daftar kegiatan dari Excel (kolom: COA Sakti | Uraian | Jumlah) -> baris terperiksa + antrian di folder kerja.
import fs from "node:fs";
import path from "node:path";
import { xlsxSheets } from "./docs.js";

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const COA_RE = /^[0-9A-Z]+(?:\.[0-9A-Z]+){7,}$/i;

/** "5.040.000" / "Rp 5.040.000,50" / 5040000 -> angka; tidak terbaca -> NaN */
export function parseJumlah(v) {
  let s = String(v ?? "").trim().replace(/^rp\.?\s*/i, "").replace(/\s+/g, "");
  if (!s) return NaN;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const rupiah = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");

/** Petik info dari uraian perjalanan dinas (hanya untuk tampilan; boleh kosong). */
export function uraianInfo(uraian) {
  const u = String(uraian ?? "");
  return {
    st: /\bST-[\w./-]+/i.exec(u)?.[0] || "",
    tanggal: /\b\d{4}-\d{2}-\d{2}\b/.exec(u)?.[0] || "",
    tujuan: /tujuan\s+(.+?)(?:\s+an\s+|$)/i.exec(u)?.[1]?.trim() || "",
    nama: /\ban\s+(.+)$/i.exec(u)?.[1]?.trim() || ""
  };
}

/**
 * Cari lembar yang berisi kepala kolom COA / Uraian / Jumlah. Mengembalikan null bila berkas ini bukan daftar semacam itu.
 * Hasil: { sheet, rows: [{ no, baris, coa, akun, uraian, jumlah, masalah: [] }], masalah: [] }
 */
export function parseDaftar(buf) {
  let sheets;
  try {
    sheets = xlsxSheets(buf, { maxRows: 2000 });
  } catch {
    return null;
  }
  for (const sh of sheets) {
    const hi = sh.rows.slice(0, 10).findIndex((r) => r.some((c) => norm(c).startsWith("coa")) && r.some((c) => norm(c) === "uraian") && r.some((c) => norm(c) === "jumlah"));
    if (hi < 0) continue;
    const head = sh.rows[hi].map(norm);
    const ci = head.findIndex((h) => h.startsWith("coa"));
    const ui = head.indexOf("uraian");
    const ji = head.indexOf("jumlah");
    const rows = [];
    const masalahUmum = [];
    const seen = new Map();
    sh.rows.slice(hi + 1).forEach((r, k) => {
      const coa = String(r[ci] ?? "").trim();
      const uraian = String(r[ui] ?? "").replace(/\s+/g, " ").trim();
      const rawJ = r[ji];
      if (!coa && !uraian && String(rawJ ?? "").trim() === "") return;
      const baris = hi + 2 + k;
      const jumlah = parseJumlah(rawJ);
      const masalah = [];
      if (!coa) masalah.push("COA kosong");
      else if (/\s/.test(coa) || !COA_RE.test(coa)) masalah.push("format COA tidak lazim (diharapkan ≥8 bagian dipisah titik, tanpa spasi)");
      const akun = coa.split(".")[2] || "";
      if (coa && !/^\d{6}$/.test(akun)) masalah.push("bagian akun (ke-3) bukan 6 digit");
      if (!uraian) masalah.push("uraian kosong");
      if (!Number.isFinite(jumlah)) masalah.push("jumlah tidak terbaca");
      else if (jumlah <= 0) masalah.push("jumlah harus lebih dari 0");
      const key = `${coa}|${uraian}|${jumlah}`;
      if (seen.has(key)) masalah.push(`sama persis dengan baris ${seen.get(key)}`);
      else seen.set(key, baris);
      rows.push({ no: rows.length + 1, baris, coa, akun, uraian, jumlah: Number.isFinite(jumlah) ? jumlah : null, masalah, status: "menunggu" });
    });
    if (!rows.length) masalahUmum.push("tidak ada baris data di bawah kepala kolom");
    return { sheet: sh.name, rows, masalah: masalahUmum };
  }
  return null;
}

/** Teks ringkasan untuk Telegram. */
export function ringkasan(parsed, namaBerkas) {
  const { rows } = parsed;
  const total = rows.reduce((a, r) => a + (r.jumlah || 0), 0);
  const bermasalah = rows.filter((r) => r.masalah.length);
  const lines = [`📊 ${namaBerkas}: ${rows.length} baris, total ${rupiah(total)}`, ""];
  for (const r of rows.slice(0, 15)) {
    const i = uraianInfo(r.uraian);
    const ket = [i.st, i.tujuan && `tujuan ${i.tujuan}`, i.nama && `an ${i.nama}`].filter(Boolean).join(" · ") || r.uraian.slice(0, 80);
    lines.push(`${r.no}. akun ${r.akun || "?"} · ${r.jumlah == null ? "?" : rupiah(r.jumlah)}${ket ? `\n   ${ket.length > 110 ? ket.slice(0, 107) + "…" : ket}` : ""}${r.masalah.length ? `\n   ⚠️ ${r.masalah.join("; ")}` : ""}`);
  }
  if (rows.length > 15) lines.push(`… dan ${rows.length - 15} baris lagi`);
  if (parsed.masalah.length) lines.push("", `⚠️ ${parsed.masalah.join("; ")}`);
  lines.push("", bermasalah.length ? `⚠️ ${bermasalah.length} baris bermasalah (tanda ⚠️). Perbaiki di Excel lalu kirim ulang, atau lanjutkan hanya bila memang benar.` : "✅ Semua baris lolos pemeriksaan bentuk.");
  return lines.join("\n");
}

const antrianFile = (workdir) => path.join(workdir, "_spby.json");

export function simpanAntrian(workdir, { berkas, rows }) {
  fs.mkdirSync(workdir, { recursive: true });
  const data = { berkas, at: Date.now(), rows };
  fs.writeFileSync(antrianFile(workdir), JSON.stringify(data, null, 1), "utf8");
  return data;
}

export function bacaAntrian(workdir) {
  try {
    return JSON.parse(fs.readFileSync(antrianFile(workdir), "utf8"));
  } catch {
    return null;
  }
}
