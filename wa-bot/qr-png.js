// Gambar QR (PNG) tanpa pustaka tambahan: memakai pembuat QR bawaan qrcode-terminal + penulis PNG sederhana (zlib).
// Dipakai /wa2 qr untuk mengirim QR penautan nomor kedua ke Telegram (QR di layar laptop tidak bisa dipindai dari jauh).
import { createRequire } from "node:module";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** Matriks modul QR: boolean[][] (true = gelap). */
export function qrMatrix(text) {
  const QRCode = require("qrcode-terminal/vendor/QRCode");
  const { L } = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel");
  const qr = new QRCode(-1, L);
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => Boolean(qr.modules[r][c])));
}

/** PNG hitam-putih (skala abu-abu 8 bit). scale = piksel per modul; margin = modul putih di tepi (minimal 4 untuk QR). */
export function qrToPng(text, { scale = 10, margin = 4 } = {}) {
  const m = qrMatrix(text);
  const size = (m.length + margin * 2) * scale;
  const row = Buffer.alloc(1 + size);
  const raw = Buffer.alloc((1 + size) * size, 255);
  for (let y = 0; y < size; y += 1) {
    const my = Math.floor(y / scale) - margin;
    const off = y * (1 + size);
    raw[off] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / scale) - margin;
      raw[off + 1 + x] = my >= 0 && my < m.length && mx >= 0 && mx < m.length && m[my][mx] ? 0 : 255;
    }
  }
  void row;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // kedalaman bit
  ihdr[9] = 0; // skala abu-abu
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
