// Tes pemeriksa jawaban dokumen: versi JS (wa-bot) dan versi TS (Edge Function) harus berperilaku sama.
//   node test-docguard.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import * as js from "./docguard.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// transpilasi salinan TS memakai esbuild (sudah ada di devDependencies proyek utama)
let tsMod = null;
try {
  const out = path.join(os.tmpdir(), `docguard-ts-${process.pid}.mjs`);
  const esbuild = path.join(here, "..", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [path.join(here, "..", "supabase", "functions", "_shared", "docguard.ts"), "--format=esm", `--outfile=${out}`, "--log-level=error"]);
  tsMod = await import(pathToFileURL(out).href);
  fs.rmSync(out, { force: true });
} catch (e) {
  console.log("peringatan: salinan TS tidak ditranspilasi (", String(e.message).split("\n")[0], ") -- hanya JS yang dites");
}

const chunks = [
  { title: "Fiqih Sunnah", page: 37, text: "[Halaman 37] Rukun wudhu ada enam: niat, membasuh muka, membasuh kedua tangan sampai siku, mengusap sebagian kepala, membasuh kedua kaki sampai mata kaki, dan tertib." },
  { title: "Fiqih Sunnah", page: 38, text: "[Halaman 38] Sunnah wudhu antara lain bersiwak dan membaca basmalah." }
];

for (const [name, m] of [["js", js], ["ts", tsMod]]) {
  if (!m) continue;
  const ok = m.guardDocAnswer('Rukun wudhu ada enam (Fiqih Sunnah, hlm 37): «membasuh kedua tangan sampai siku» dan «mengusap sebagian kepala».', chunks);
  check(!ok.flagged && ok.checkedQuotes === 2 && ok.checkedPages === 1, `[${name}] kutipan & halaman benar -> tidak ditandai`);
  const fakeQ = m.guardDocAnswer('Menurut dokumen: «wajib membasuh telinga tiga kali sebelum shalat» (hlm 37).', chunks);
  check(fakeQ.flagged && fakeQ.badQuotes.length === 1 && fakeQ.reply.includes("⚠️ Pemeriksaan otomatis"), `[${name}] kutipan karangan ditandai`);
  const fakeP = m.guardDocAnswer("Rukun wudhu dijelaskan di halaman 99 dan hlm 37.", chunks);
  check(fakeP.flagged && JSON.stringify(fakeP.badPages) === "[99]", `[${name}] halaman yang tidak ada di potongan ditandai`);
  const ell = m.checkDocAnswer("«membasuh muka, membasuh kedua tangan … mengusap sebagian kepala»", chunks);
  check(ell.badQuotes.length === 0 && ell.checkedQuotes === 1, `[${name}] kutipan dengan elipsis diperiksa per penggal`);
  const caseP = m.checkDocAnswer("«MEMBASUH   kedua tangan, sampai siku!»", chunks);
  check(caseP.badQuotes.length === 0, `[${name}] huruf besar/tanda baca/spasi tidak mempengaruhi`);
  const range = m.checkDocAnswer("lihat hlm 37-38", chunks);
  check(range.badPages.length === 0 && range.checkedPages === 2, `[${name}] rentang halaman`);
  const none = m.guardDocAnswer("Informasi tidak ada di dokumen.", chunks);
  check(!none.flagged && none.reply === "Informasi tidak ada di dokumen.", `[${name}] jawaban tanpa rujukan tidak berubah`);
  const noCtx = m.guardDocAnswer("hlm 5 «kalimat apa saja yang panjang»", []);
  check(!noCtx.flagged, `[${name}] tanpa potongan -> tidak memeriksa`);
  const title = m.guardDocAnswer('Judul dokumen: "Fiqih Sunnah Jilid Satu" dan “Bab Wudhu Lengkap” (hlm 37).', chunks);
  check(!title.flagged && title.checkedQuotes === 0, `[${name}] judul dalam tanda kutip biasa bukan kutipan`);
  const short = m.checkDocAnswer("«ya tidak»", chunks);
  check(short.checkedQuotes === 0, `[${name}] kutipan terlalu pendek diabaikan`);
}
console.log(fails ? `\n${fails} GAGAL` : "\nsemua OK");
process.exit(fails ? 1 : 0);
