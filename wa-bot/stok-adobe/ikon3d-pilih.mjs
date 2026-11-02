// Pemilih mesin ikon 3D: Blender (3D sejati, Cycles CPU) atau JS relief (cepat, tanpa dependensi). Selalu ada cadangan ke JS bila Blender gagal.
// Pengaturan lewat env:
//   STOK_3D=js (bawaan) | blender | auto     auto = pakai Blender bila terdeteksi, kalau tidak JS
//   BLENDER_BIN=/usr/bin/blender             berkas program Blender (dipanggil: blender -b -P skrip -- ...)
//   STOK_BPY_PYTHON=/jalur/venv/bin/python   alternatif: Python yang sudah `pip install bpy`
//   STOK_BLENDER_SAMPEL=48  STOK_BLENDER_TIMEOUT_MS=600000
// Blender dijalankan sebagai proses anak ASINKRON (tidak memblokir bot) dan satu per satu.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { render3d, PALET } from "./ikon3d.mjs";

const SINI = path.dirname(fileURLToPath(import.meta.url));
export const SKRIP_BLENDER = path.join(SINI, "ikon3d-blender.py");

/** Cari cara menjalankan Blender. Mengembalikan {perintah, awalan} atau null. */
export function temukanBlender(env = process.env) {
  if (env.BLENDER_BIN) return { jenis: "bin", perintah: env.BLENDER_BIN, awalan: ["-b", "-noaudio", "-P", SKRIP_BLENDER, "--"] };
  if (env.STOK_BPY_PYTHON) return { jenis: "bpy", perintah: env.STOK_BPY_PYTHON, awalan: [SKRIP_BLENDER] };
  const r = spawnSync("blender", ["--version"], { encoding: "utf8", timeout: 15000 });
  if (!r.error && r.status === 0) return { jenis: "bin", perintah: "blender", awalan: ["-b", "-noaudio", "-P", SKRIP_BLENDER, "--"] };
  return null;
}

export function modeIkon3d(env = process.env) {
  const m = String(env.STOK_3D || "js").toLowerCase();
  return ["js", "blender", "auto"].includes(m) ? m : "js";
}

export function hexPalet(palet) {
  const p = Array.isArray(palet) ? palet : PALET[palet] || PALET.zamrud;
  return p[1];
}

function jalankan(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "", out = "", selesai = false;
    const t = setTimeout(() => { if (!selesai) { p.kill("SIGKILL"); reject(new Error(`Blender melebihi batas waktu ${Math.round(timeoutMs / 1000)} dtk`)); } }, timeoutMs);
    p.stdout.on("data", (d) => { out = (out + d).slice(-4000); }); p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => { selesai = true; clearTimeout(t); reject(e); });
    p.on("close", (kode) => { selesai = true; clearTimeout(t); kode === 0 ? resolve(out) : reject(new Error(`Blender keluar dengan kode ${kode}: ${(err || out).slice(-250)}`)); });
  });
}

/** Render lewat Blender. Melempar galat bila gagal. */
export async function render3dBlender({ svg, keluar, ukuran = 2048, palet = "zamrud", bahan = "clay", env = process.env, blender }) {
  const b = blender || temukanBlender(env); if (!b) throw new Error("Blender tidak ditemukan (set BLENDER_BIN atau STOK_BPY_PYTHON)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ikon3d-")), berkasSvg = path.join(tmp, "ikon.svg");
  try {
    fs.writeFileSync(berkasSvg, svg); fs.mkdirSync(path.dirname(path.resolve(keluar)), { recursive: true });
    const args = [...b.awalan, "--svg", berkasSvg, "--keluar", path.resolve(keluar), "--ukuran", String(ukuran), "--warna", hexPalet(palet), "--bahan", bahan, "--sampel", String(Number(env.STOK_BLENDER_SAMPEL) || 48)];
    await jalankan(b.perintah, args, Number(env.STOK_BLENDER_TIMEOUT_MS) || 600000);
    if (!fs.existsSync(keluar)) throw new Error("Blender selesai tetapi berkas hasil tidak ada");
    const img = await loadImage(fs.readFileSync(keluar)); // pastikan JPEG sah
    if (!img.width || !img.height) throw new Error("hasil Blender bukan gambar");
    return { berkas: keluar, lebar: img.width, tinggi: img.height, mp: (img.width * img.height) / 1e6, ukuranMB: fs.statSync(keluar).size / 1048576, mesin: "blender" };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * Titik masuk tunggal: sesuai STOK_3D. 'blender' dan 'auto' jatuh ke JS bila Blender tidak ada/gagal.
 * @returns {Promise<{berkas,lebar,tinggi,mp,ukuranMB,mesin:'blender'|'js',catatan?:string}>}
 */
export async function render3dPilih(opsi) {
  const env = opsi.env || process.env, mode = modeIkon3d(env);
  const jsSaja = async (catatan) => ({ ...(await render3d({ svg: opsi.svg, keluar: opsi.keluar, ukuran: opsi.ukuran, palet: opsi.palet, bahan: opsi.bahan })), mesin: "js", ...(catatan ? { catatan } : {}) });
  if (mode === "js") return jsSaja();
  const b = temukanBlender(env);
  if (!b) return jsSaja("Blender tidak ditemukan, dipakai render JS");
  try { return await render3dBlender({ ...opsi, env, blender: b }); } catch (e) { return jsSaja(`Blender gagal (${String(e.message).slice(0, 120)}), dipakai render JS`); }
}
