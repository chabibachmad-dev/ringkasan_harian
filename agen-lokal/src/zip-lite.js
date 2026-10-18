// Pembaca ZIP minimal (tanpa dependensi): cukup untuk zip patch biasa (metode simpan/deflate, tanpa enkripsi/zip64).
// Dipakai ops.js untuk menerapkan zip patch yang dikirim lewat Telegram. Hanya MEMBACA; tidak pernah menulis ke disk.
//
//   const entries = readZip(buffer, { maxEntries, maxTotalBytes, maxFileBytes });
//   entries[i] = { name, size, isDir, read() -> Buffer }
//
// Menolak: zip rusak, terenkripsi, zip64, metode kompresi lain, simlink, dan melebihi batas ukuran/jumlah.

import zlib from "node:zlib";

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export class ZipError extends Error {}

export function readZip(buf, { maxEntries = 500, maxTotalBytes = 60 * 1024 * 1024, maxFileBytes = 25 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipError("berkas bukan zip yang valid (terlalu kecil)");
  // cari End Of Central Directory dari belakang (komentar zip maks 65535 byte)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("berkas bukan zip yang valid (akhir arsip tidak ditemukan)");
  const total = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cenSize === 0xffffffff || cenOffset === 0xffffffff) throw new ZipError("zip64 tidak didukung");
  if (total > maxEntries) throw new ZipError(`isi zip terlalu banyak (${total} berkas, maks ${maxEntries})`);
  if (cenOffset + cenSize > buf.length) throw new ZipError("zip rusak (direktori di luar berkas)");

  const entries = [];
  let pos = cenOffset;
  let sum = 0;
  for (let n = 0; n < total; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CEN) throw new ZipError("zip rusak (direktori tidak terbaca)");
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const csize = buf.readUInt32LE(pos + 20);
    const usize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const extAttr = buf.readUInt32LE(pos + 38);
    const localOffset = buf.readUInt32LE(pos + 42);
    const utf8 = (flags & 0x800) !== 0;
    const name = buf.toString(utf8 ? "utf8" : "latin1", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    const isDir = name.endsWith("/");
    const unixMode = (extAttr >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) throw new ZipError(`simlink tidak diizinkan: ${name}`);
    if (flags & 1) throw new ZipError("zip terenkripsi tidak didukung");
    if (!isDir) {
      if (method !== 0 && method !== 8) throw new ZipError(`metode kompresi ${method} tidak didukung (${name})`);
      if (usize > maxFileBytes) throw new ZipError(`berkas terlalu besar: ${name}`);
      sum += usize;
      if (sum > maxTotalBytes) throw new ZipError("isi zip terlalu besar");
    }
    entries.push({
      name,
      size: usize,
      isDir,
      read() {
        if (isDir) return Buffer.alloc(0);
        if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOC) throw new ZipError(`zip rusak (${name})`);
        const ln = buf.readUInt16LE(localOffset + 26);
        const le = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + ln + le;
        if (start + csize > buf.length) throw new ZipError(`zip terpotong (${name})`);
        const raw = buf.subarray(start, start + csize);
        const out = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) + 1024 });
        if (out.length !== usize) throw new ZipError(`ukuran tidak cocok: ${name}`);
        return out;
      }
    });
  }
  return entries;
}
