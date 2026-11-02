// Penjaga "zona mati sementara" (TDZ): konstanta tingkat-atas yang nilai awalnya langsung membaca konstanta lain yang
// dideklarasikan LEBIH BAWAH di berkas yang sama -> ReferenceError saat modul dimuat -> seluruh aplikasi mati
// (ikon yang diisi lewat JS jadi kosong). esbuild/Vite mengubah const jadi var sehingga bundel tidak memperlihatkannya,
// jadi dicek langsung di sumber.  node test-app-load.mjs
import fs from "node:fs";

let gagal = 0;
const dir = new URL("../src/", import.meta.url);
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const lines = fs.readFileSync(new URL(f, dir), "utf8").split("\n");
  const decl = new Map(); // nama -> nomor baris (1-based) deklarasi tingkat-atas
  lines.forEach((l, i) => {
    const m = l.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (m) decl.set(m[1], i + 1);
  });
  lines.forEach((l, i) => {
    const m = l.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=(.*)$/);
    if (!m) return;
    const init = m[2];
    if (/=>|\bfunction\b|\bclass\b/.test(init)) return; // isi fungsi baru jalan nanti, bukan saat muat
    const code = init.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    for (const id of code.match(/[A-Za-z_$][\w$]*/g) || []) {
      const at = decl.get(id);
      if (at && at > i + 1) {
        console.log(`GAGAL: ${f}:${i + 1} membaca ${id} yang baru dideklarasikan di baris ${at} (TDZ)`);
        gagal++;
      }
    }
  });
}
if (!gagal) console.log("ok: tidak ada konstanta tingkat-atas yang dibaca sebelum dideklarasikan (src/*.js)");
process.exit(gagal ? 1 : 0);
