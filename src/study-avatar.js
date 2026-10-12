// Foto profil pemain Study: ambil gambar dari galeri, potong persegi di tengah, kecilkan, jadikan JPEG kecil.
// Semua dikerjakan di peramban; server hanya menerima JPEG <= 150 KB (lihat parseAvatarImage di study-core.ts).

export const AVATAR_SIZE = 256;
export const AVATAR_MAX_BYTES = 150 * 1024;

/** Kotak persegi terbesar di tengah gambar w x h -> { sx, sy, side }. */
export function squareCrop(w, h) {
  const side = Math.max(1, Math.min(w, h));
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* lanjut ke <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // URL dilepas setelah gambar terdekode; img tetap memegang piksel
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

/** File gambar (apa pun yang bisa dibaca peramban) -> string base64 JPEG persegi AVATAR_SIZE px. Melempar Error("read") bila gambar tak terbaca, Error("size") bila tetap terlalu besar. */
export async function fileToAvatarBase64(file) {
  if (!file || !/^image\//i.test(file.type || "image/")) throw new Error("read");
  let img;
  try {
    img = await decodeImage(file);
  } catch {
    throw new Error("read");
  }
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (!w || !h) throw new Error("read");
  const { sx, sy, side } = squareCrop(w, h);
  const size = Math.min(AVATAR_SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; // PNG transparan -> latar putih (JPEG tidak punya alfa)
  g.fillRect(0, 0, size, size);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  if (typeof img.close === "function") img.close();
  for (const q of [0.86, 0.75, 0.62, 0.5]) {
    const blob = await toBlob(canvas, q);
    if (blob && blob.size > 0 && blob.size <= AVATAR_MAX_BYTES) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }
  }
  throw new Error("size");
}
