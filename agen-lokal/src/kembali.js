// Alur "kirim ke Telegram -> kerjakan di tempat lain -> kirim balik -> timpa di lokasi asal".
// Yang dikirim lewat alat kirim_file dicatat (nama -> alamat asli). Saat berkas bernama sama dikirim balik, bot meminta
// persetujuan lalu MENGGANTI berkas asli. Berkas asli dicadangkan lebih dulu ke _sampah, jadi selalu bisa dikembalikan.
import fs from "node:fs";
import path from "node:path";
import { isInside, resolveInRoots, SafetyError } from "./safety.js";

export const SENT_FILE = "_kirim.json";
const MAX_ENTRIES = 200;
const key = (name) => path.basename(String(name)).toLowerCase();

function readMap(workdir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(workdir, SENT_FILE), "utf8"));
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

/** Catat berkas yang baru dikirim ke Telegram (alamat asli, ukuran, waktu ubah). */
export function recordSent(workdir, fullPath, { now = Date.now() } = {}) {
  const st = fs.statSync(fullPath);
  const map = readMap(workdir);
  map[key(fullPath)] = { path: fullPath, size: st.size, mtimeMs: st.mtimeMs, at: now };
  const keep = Object.entries(map).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_ENTRIES);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, SENT_FILE), JSON.stringify(Object.fromEntries(keep), null, 1), "utf8");
}

/** Cari catatan pengiriman menurut nama berkas. -> { path, size, mtimeMs, at } atau null */
export function lookupSent(workdir, name) {
  const e = readMap(workdir)[key(name)];
  return e && typeof e.path === "string" ? e : null;
}

/** Daftar nama berkas yang pernah dikirim (terbaru dulu). */
export function listSent(workdir, limit = 10) {
  return Object.values(readMap(workdir))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, limit)
    .map((e) => e.path);
}

/**
 * Periksa & rencanakan penggantian. Melempar SafetyError bila tidak boleh.
 * src = berkas hasil kiriman (harus di folder _masuk), entry = catatan pengiriman.
 * -> { dest, warnings[] }
 */
export function planReturn({ workdir, roots, src, entry }) {
  if (!entry) throw new SafetyError("Tidak ada catatan berkas asal untuk itu.");
  if (!isInside(path.join(workdir, "_masuk"), src)) throw new SafetyError("Berkas sumber harus berada di folder _masuk.");
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new SafetyError("Berkas sumber tidak ditemukan.");
  const dest = resolveInRoots(entry.path, { roots, workdir }); // tetap di dalam folder izin, bukan berkas rahasia
  if (path.extname(dest).toLowerCase() !== path.extname(src).toLowerCase()) throw new SafetyError(`Jenis berkas berbeda (${path.extname(src)} lawan ${path.extname(dest)}); tidak diganti.`);
  const warnings = [];
  let st = null;
  try {
    st = fs.statSync(dest);
  } catch {
    warnings.push("Berkas asli sudah tidak ada di lokasi itu; akan dibuat ulang.");
  }
  if (st) {
    if (!st.isFile()) throw new SafetyError("Tujuan bukan berkas biasa.");
    if (entry.mtimeMs && Math.abs(st.mtimeMs - entry.mtimeMs) > 2000) warnings.push("⚠️ Berkas asli BERUBAH sejak dikirim ke Telegram. Perubahan itu akan tertimpa (tetap ada di cadangan _sampah).");
  }
  return { dest, warnings };
}

/** Ganti berkas tujuan dengan src. Cadangan berkas lama masuk _sampah. -> { dest, backup|null } */
export function applyReturn({ workdir, roots, src, entry, now = () => new Date() }) {
  const { dest } = planReturn({ workdir, roots, src, entry });
  let backup = null;
  if (fs.existsSync(dest)) {
    const trash = path.join(workdir, "_sampah");
    fs.mkdirSync(trash, { recursive: true });
    const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    backup = path.join(trash, `${stamp}-${path.basename(dest)}`);
    fs.copyFileSync(dest, backup);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.tmp`);
  try {
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dest); // penggantian utuh: tidak pernah setengah tertulis
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    if (["EBUSY", "EPERM", "EACCES"].includes(e.code)) throw new Error(`Berkas sedang dibuka di aplikasi lain (mis. Excel). Tutup dulu, lalu kirim ulang berkasnya. (${e.code})`);
    throw e;
  }
  return { dest, backup };
}
