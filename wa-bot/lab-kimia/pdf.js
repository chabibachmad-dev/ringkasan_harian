// Pembuat PDF satu halaman berisi satu gambar JPEG (tanpa pustaka). Cukup untuk "Simpan sebagai PDF".
const enc = new TextEncoder();
const ascii = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?").replace(/([()\\])/g, "\\$1");

function gabung(bagian) {
  const n = bagian.reduce((a, b) => a + b.length, 0), out = new Uint8Array(n);
  let o = 0; for (const b of bagian) { out.set(b, o); o += b.length; }
  return out;
}

/**
 * @param jpeg Uint8Array berisi berkas JPEG
 * @param lebarPx, tinggiPx ukuran gambar
 * @param opsi {judul, latar: "#rrggbb", margin: 28}
 * Kertas A4 (landscape bila gambar lebih lebar daripada tinggi), gambar diskalakan muat dan ditaruh di tengah.
 */
export function buatPdf(jpeg, lebarPx, tinggiPx, opsi = {}) {
  const landscape = lebarPx > tinggiPx, W = landscape ? 842 : 595, H = landscape ? 595 : 842, m = opsi.margin ?? 28;
  const skala = Math.min((W - 2 * m) / lebarPx, (H - 2 * m) / tinggiPx), w = lebarPx * skala, h = tinggiPx * skala;
  const x = (W - w) / 2, y = (H - h) / 2;
  const rgb = /^#[0-9a-f]{6}$/i.test(opsi.latar || "") ? [1, 3, 5].map((i) => (parseInt(opsi.latar.slice(i, i + 2), 16) / 255).toFixed(4)).join(" ") : "1 1 1";
  const f = (n) => n.toFixed(2);
  const isi = `${rgb} rg 0 0 ${W} ${H} re f\nq ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(y)} cm /Im0 Do Q\n`;
  const bag = [], offs = [];
  let pos = 0;
  const tulis = (u8) => { bag.push(u8); pos += u8.length; };
  const teks = (s) => tulis(enc.encode(s));
  const obj = (n, fn) => { offs[n] = pos; teks(`${n} 0 obj\n`); fn(); teks("endobj\n"); };

  teks("%PDF-1.4\n"); tulis(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, () => teks("<< /Type /Catalog /Pages 2 0 R >>\n"));
  obj(2, () => teks("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n"));
  obj(3, () => teks(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\n`));
  obj(4, () => { teks(`<< /Type /XObject /Subtype /Image /Width ${lebarPx} /Height ${tinggiPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); tulis(jpeg); teks("\nendstream\n"); });
  obj(5, () => { const b = enc.encode(isi); teks(`<< /Length ${b.length} >>\nstream\n`); tulis(b); teks("endstream\n"); });
  obj(6, () => teks(`<< /Title (${ascii(opsi.judul || "Laboratorium Kimia")}) /Producer (Ayyubi) >>\n`));

  const xref = pos;
  teks("xref\n0 7\n0000000000 65535 f \n");
  for (let n = 1; n <= 6; n++) teks(String(offs[n]).padStart(10, "0") + " 00000 n \n");
  teks(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return gabung(bag);
}
