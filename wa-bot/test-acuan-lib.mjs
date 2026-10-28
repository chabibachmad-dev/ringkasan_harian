// Tes perpustakaan acuan publik (acuan-lib.js): PDF asli PMK -> seluruh halaman terindeks, id 'acuan:' (bukan lokal).
//   node test-acuan-lib.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKbIndex } from "./kb-index.js";
import { createAcuanLibrary, readAcuanConfig } from "./acuan-lib.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acuan-"));
const md = (n) => Array.from({ length: n }, (_, i) => `[Halaman ${i + 1}]\nIsi halaman ${i + 1}. Batas penginapan eselon III sebesar Rp${(1000 + i).toLocaleString("id-ID")}. ${"kalimat pengisi. ".repeat(10)}`).join("\n\n");

const idx = await openKbIndex({ file: ":memory:", log: silent });
let indexedEvents = 0;
const lib = createAcuanLibrary({ index: idx, log: silent, onIndexed: () => { indexedEvents++; } }, { dir, settleMs: 0, pollMs: 100000 });

check(readAcuanConfig({ DOC_DIR: "/x" }, "/b").dir === path.join("/x", "acuan-publik"), "folder default <DOC_DIR>/acuan-publik");
check(readAcuanConfig({ ACUAN_ENABLED: "false" }).enabled === false, "ACUAN_ENABLED=false mematikan");

fs.writeFileSync(path.join(dir, "PMK 32 Tahun 2025 SBM.md"), md(12));
let r = await lib.scan();
check(r.added === 1, "berkas .md ber-[Halaman n] terindeks");
const doc = idx.listDocs().find((d) => d.id === "acuan:PMK 32 Tahun 2025 SBM.md");
check(doc && doc.title === "PMK 32 Tahun 2025 SBM" && doc.pages === 12, "judul dari nama berkas, 12 halaman");
check(!doc.id.startsWith("local:"), "id BUKAN local: -> boleh jalur cloud/Jina");
const hit = idx.search("batas penginapan eselon III halaman 7", { excludeLocal: true, budgetChars: 3000 });
check(hit.length > 0 && hit.every((b) => !b.docId.startsWith("local:")), "excludeLocal (jalur cloud) tetap menemukan dokumen acuan");
check(/\[Halaman 12\]\nIsi halaman 12\./.test(idx.getDocText("acuan:PMK 32 Tahun 2025 SBM.md")), "halaman terakhir (12) ikut terindeks");
r = await lib.scan();
check(r.added === 0, "pindai ulang tanpa perubahan: tidak mengindeks ulang");
check(indexedEvents === 1, "onIndexed dipanggil sekali (untuk memicu embedding)");

// berkas berubah -> diindeks ulang
fs.writeFileSync(path.join(dir, "PMK 32 Tahun 2025 SBM.md"), md(14));
fs.utimesSync(path.join(dir, "PMK 32 Tahun 2025 SBM.md"), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
r = await lib.scan();
check(r.added === 1 && idx.listDocs().find((d) => d.id.startsWith("acuan:")).pages === 14, "berkas berubah -> diindeks ulang (14 hlm)");

// PDF: pakai pengurai palsu
const lib2 = createAcuanLibrary({ index: idx, log: silent, toPages: async (buf, o) => ({ pages: Array.from({ length: 5 }, (_, i) => ({ page: i + 1, text: `halaman pdf ${i + 1} tarif uang harian ${"x ".repeat(30)}` })), total: 5, truncated: false, scanned: false }) }, { dir, settleMs: 0 });
fs.writeFileSync(path.join(dir, "Peraturan Lain.pdf"), Buffer.from("%PDF-1.4 palsu"));
await lib2.scan();
check(idx.listDocs().some((d) => d.id === "acuan:Peraturan Lain.pdf" && d.pages === 5), "PDF diindeks lewat pengurai (5 hlm)");

// PDF hasil scan ditolak, tidak mengulang-ulang
let calls = 0;
const idx3 = await openKbIndex({ file: ":memory:", log: silent });
const lib3 = createAcuanLibrary({ index: idx3, log: silent, toPages: async () => { calls++; return { pages: [{ page: 1, text: "" }], total: 1, truncated: false, scanned: true }; } }, { dir: (() => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "acuan3-")); fs.writeFileSync(path.join(d, "scan.pdf"), Buffer.from("%PDF-1.4 x")); return d; })(), settleMs: 0 });
await lib3.scan(); await lib3.scan();
check(calls === 1 && /scan/i.test(lib3.status().lastError || ""), "PDF scan ditolak sekali dengan pesan jelas (tidak diulang tiap putaran)");

// berkas dihapus -> dibuang dari indeks, tapi dokumen non-acuan tidak tersentuh
idx.upsertDoc({ id: "kb:lain", title: "Dokumen app", pages: [{ page: 1, text: "isi dokumen aplikasi yang cukup panjang untuk diindeks. ".repeat(3) }] });
idx.upsertDoc({ id: "local:rahasia.md", title: "Rahasia", pages: [{ page: 1, text: "isi rahasia lokal yang cukup panjang untuk diindeks. ".repeat(3) }] });
fs.rmSync(path.join(dir, "Peraturan Lain.pdf"));
r = await lib.scan();
check(r.removed === 1 && !idx.listDocs().some((d) => d.id === "acuan:Peraturan Lain.pdf"), "berkas dihapus -> dibuang dari indeks");
check(idx.listDocs().some((d) => d.id === "kb:lain") && idx.listDocs().some((d) => d.id === "local:rahasia.md"), "dokumen kb: dan local: tidak ikut terhapus");

// berkas yang masih disalin (ukuran berubah) ditunda
const lib4 = createAcuanLibrary({ index: idx, log: silent }, { dir, settleMs: 60000 });
fs.writeFileSync(path.join(dir, "baru.md"), md(3));
r = await lib4.scan();
check(r.added === 0, "berkas baru menunggu stabil (settle) sebelum diindeks");

fs.rmSync(dir, { recursive: true, force: true });
if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua tes perpustakaan acuan lulus.");
