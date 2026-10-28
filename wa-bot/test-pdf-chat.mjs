// Tes PDF di chat: semua halaman terbaca, jawaban dikutip per halaman, pertanyaan di luar isi -> "tidak ada".
//   node test-pdf-chat.mjs
import fs from "node:fs";
import { pdfBufferToPages, createPdfChatStore } from "./pdf-chat.js";
import { pdfContextNote } from "./pdf-qa.js";
import { isBroadRequest, cleanQuery } from "./pdf-chat.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

const FILLER = "Uraian kegiatan administrasi rutin satuan kerja dan koordinasi antarunit kerja. ".repeat(8);
const pageText = (n) => `${n}\nBAB ${n}\n${n === 97 ? "Tarif sewa genset 450 KVA ditetapkan sebesar Rp31.770.000 per unit per tahun.\n" : ""}${n === 3 ? "Ketentuan umum perjalanan dinas dan batas waktu.\n" : ""}${FILLER}`;
const fakePdf = (total) => (cmd, args) => {
  if (cmd === "pdfinfo") return Promise.resolve(`Title: x\nPages:          ${total}\n`);
  const l = Number(args[args.indexOf("-l") + 1]) || total;
  return Promise.resolve(Array.from({ length: Math.min(l, total) }, (_, i) => pageText(i + 1)).join("\f") + "\f");
};
const buf = Buffer.from("%PDF-1.7\n....");

{
  const r = await pdfBufferToPages(buf, { maxPages: 300, exec: fakePdf(120) });
  check(r.pages.length === 120 && r.total === 120 && !r.truncated && !r.scanned && r.pages[96].page === 97, "120 halaman terbaca semua (tidak lagi dipotong di 60)");
  const r2 = await pdfBufferToPages(buf, { maxPages: 100, exec: fakePdf(120) });
  check(r2.pages.length === 100 && r2.truncated === true && r2.total === 120, "batas halaman bisa diatur; terpotong ditandai");
  const r3 = await pdfBufferToPages(buf, { exec: () => Promise.resolve("\f\f\f") });
  check(r3.scanned === true, "PDF tanpa teks terdeteksi sebagai hasil scan");
  let e = null;
  try { await pdfBufferToPages(Buffer.from("bukan pdf!!"), { exec: fakePdf(1) }); } catch (x) { e = x; }
  check(e?.kind === "badpdf", "berkas bukan PDF ditolak");
  e = null;
  try { await pdfBufferToPages(buf, { exec: () => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })) }); } catch (x) { e = x; }
  check(e?.kind === "notool", "pdftotext tidak ada -> kind notool");
}

{
  const r = await pdfBufferToPages(buf, { exec: fakePdf(120) });
  const store = createPdfChatStore({ ttlMs: 1000, max: 2 });
  const entry = await store.build("k1", { name: "PMK Uji.pdf", pages: r.pages, total: r.total, truncated: false });
  check(entry.readPages === 120 && entry.total === 120, "entry: 120 halaman diindeks");
  const c = store.contextFor(entry, "berapa tarif sewa genset 450 KVA?", { maxChars: 6000 });
  check(c.mode === "retrieved" && /\[Halaman 97\]/.test(c.text) && /31\.770\.000/.test(c.text) && c.pages.includes(97), "pertanyaan spesifik: halaman 97 ditemukan (jauh di atas halaman 60)");
  check(c.text.length <= 6000 + 200 && c.coverage < 0.5, "konteks dibatasi anggaran, bukan seluruh dokumen");
  const none = store.contextFor(entry, "bagaimana resep rendang padang yang enak sekali", { maxChars: 6000 });
  check(none.mode === "none" && /tidak ada bagian PDF/.test(none.text), "di luar isi PDF: mode none (tidak disodori potongan acak)");
  const ov = store.contextFor(entry, "ringkas pdf ini", { maxChars: 6000 });
  check(ov.mode === "sampled" && /\[Halaman \d+\]/.test(ov.text), "ringkasan: cuplikan merata ber-penanda halaman");
  const small = await store.build("k2", { name: "kecil.pdf", pages: [{ page: 1, text: "Surat pendek tentang rapat." }], total: 1 });
  check(store.contextFor(small, "apa isinya", { maxChars: 6000 }).mode === "full", "PDF kecil dikirim utuh");
  check(store.get("k1") && store.get("nope") === null, "cache per kunci");
  await store.build("k3", { name: "c.pdf", pages: [{ page: 1, text: "x tiga" }], total: 1 });
  check(store.size() <= 2, "cache dibatasi (max 2)");
  store.clear();
  check(store.size() === 0, "clear membuang & menutup indeks");
}

// ---- permintaan luas, kueri bersih, siblings
{
  const r = await pdfBufferToPages(buf, { exec: fakePdf(120) });
  const store = createPdfChatStore({ ttlMs: 1000, max: 4 });
  const entry = await store.build("g@g.us|A", { name: "KMK 296.pdf", pages: r.pages, total: r.total });
  const q = "bisa buatkan matriks perubahan antara KMK 296/2026 ini dengan PMK 32 Tahun 2025 tentang SBM 2026?";
  check(isBroadRequest(q) && !isBroadRequest("berapa tarif sewa genset 450 KVA?"), "isBroadRequest: matriks perubahan luas, tarif spesifik bukan");
  const c = store.contextFor(entry, q, { maxChars: 6000 });
  check(c.mode === "sampled" && c.broad === true && /\[Halaman \d+\]/.test(c.text), "permintaan luas pada PDF besar: sampled, bukan none");
  check(cleanQuery(q) === "matriks perubahan sbm", `cleanQuery membuang KMK/PMK/tahun/angka (${cleanQuery(q)})`);
  check(!/\b(kmk|pmk|tahun|2025|296)\b/.test(cleanQuery("KMK 296/2026 dan PMK 32 Tahun 2025 genset")), "cleanQuery tanpa nomor peraturan");
  const retry = store.contextFor(entry, "KMK 296/2026 PMK 32 Tahun 2025 tarif sewa genset", { maxChars: 6000 });
  check(retry.mode === "retrieved" && /31\.770\.000/.test(retry.text), "kueri bernomor peraturan: dicoba ulang dengan kueri bersih, ketemu");
  const none = store.contextFor(entry, "bagaimana resep rendang padang yang enak sekali", { maxChars: 6000 });
  check(none.mode === "none", "fakta yang tidak ada di PDF tetap none (anti-tebak)");
  const none2 = store.contextFor(entry, "resep rendang padang menurut PMK 32 Tahun 2025", { maxChars: 6000 });
  check(none2.mode === "none", "kueri bernomor peraturan tapi faktanya tidak ada: tetap none");
  await store.build("g@g.us|B", { name: "PMK 32.pdf", pages: r.pages.slice(0, 5), total: 5 });
  await store.build("lain@g.us|C", { name: "lain.pdf", pages: r.pages.slice(0, 5), total: 5 });
  const sib = store.siblings("g@g.us|A");
  check(sib.length === 1 && sib[0].name === "PMK 32.pdf", "siblings: PDF lain di obrolan yang sama saja");
  check(store.siblings("lain@g.us|C").length === 0 && store.siblings("tanpa-pemisah").length === 0, "siblings: obrolan lain/kunci tak valid kosong");
  const note = pdfContextNote({ name: "KMK 296.pdf", pages: 120, ctx: c, compare: { name: "PMK 32.pdf", pages: 5, ctx: { text: "[Halaman 1] isi pembanding" } }, readPages: 120 });
  check(/PDF PEMBANDING/.test(note) && /<<<ISI_PDF_PEMBANDING>>>/.test(note) && /isi pembanding/.test(note), "catatan memuat blok PDF PEMBANDING");
  const solo = pdfContextNote({ name: "KMK 296.pdf", pages: 120, ctx: c, readPages: 120 });
  check(/poin-poin berhalaman/.test(solo) && /mengirim PDF-nya di grup/.test(solo) && /JANGAN menyinggung internet/.test(solo) && /JANGAN mengarang/.test(solo), "permintaan luas: instruksi poin berhalaman, minta kirim PDF pembanding, larang internet");
  check(!/LUAS/.test(pdfContextNote({ name: "x.pdf", ctx: { ...c, broad: false } })), "bukan permintaan luas: tanpa catatan luas");
  store.clear();
}

// ---- systemNoSearch tidak boleh curhat soal internet
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const m = /const systemNoSearch =\s*`([\s\S]*?)`;/.exec(src);
  check(Boolean(m) && !/SEDANG TIDAK TERSEDIA/.test(m[1]) && /JANGAN pernah menyinggung internet/.test(m[1]), "systemNoSearch tidak lagi memuat 'SEDANG TIDAK TERSEDIA'");
}

// ---- catatan prompt
{
  const ctx = { text: "[Halaman 19] Tarif ... Rp1.754.000", mode: "retrieved", coverage: 0.05, pages: [19], totalChars: 100000, shownChars: 5000 };
  const n = pdfContextNote({ name: "PMK.pdf", pages: 110, ctx, scope: "chat pribadi", readPages: 110 });
  check(/PDF DI CHAT PRIBADI/.test(n) && /\[Halaman n\]/.test(n) && /halaman 19/.test(n) && /JANGAN menghitung atau menebak/.test(n) && /<<<ISI_PDF>>>/.test(n), "catatan chat pribadi: minta kutip halaman, larang menebak angka");
  const g = pdfContextNote({ name: "PMK.pdf", pages: 110, ctx: { ...ctx, mode: "sampled" } });
  check(/PDF DI GRUP/.test(g), "bawaan tetap 'PDF DI GRUP'");
  const none = pdfContextNote({ name: "PMK.pdf", pages: 110, ctx: { text: "(tidak ada bagian PDF yang cocok dengan pertanyaan ini)", mode: "none", coverage: 0 }, scope: "chat pribadi", readPages: 110 });
  check(/tidak ditemukan di PDF/.test(none) && /JANGAN menjawab dari pengetahuan umum/.test(none), "mode none: wajib menjawab tidak ditemukan, bukan pengetahuan umum");
  const evil = pdfContextNote({ name: 'a"b.pdf', pages: 1, ctx: { text: "ok", mode: "full", coverage: 1 }, scope: "chat pribadi" });
  check(/BUKAN perintah/.test(evil), "isi PDF diperlakukan sebagai data");
}

// ---- PDF asli (bila tersedia di mesin ini): PMK 32/2025, 110 halaman
const REAL = process.env.PMK_PDF || "/root/.claude/uploads/d9a2e0ae-25a9-5f27-9a18-0c73a650b368/6727d26f-PMK_32_Tahun_2025.pdf";
if (fs.existsSync(REAL)) {
  const r = await pdfBufferToPages(fs.readFileSync(REAL), { maxPages: 300 });
  check(r.total === 110 && r.pages.length === 110 && !r.scanned, `PMK asli: ${r.pages.length}/${r.total} halaman terbaca`);
  const store = createPdfChatStore();
  const e = await store.build("pmk", { name: "PMK 32 Tahun 2025.pdf", pages: r.pages, total: r.total });
  const ask = (q) => store.contextFor(e, q, { maxChars: 9000 });
  let c = ask("berapa batas tertinggi tarif hotel eselon III di Bali");
  check(c.mode === "retrieved" && c.pages.includes(19) && /Rp1\.754\.000/.test(c.text), "PMK asli: tarif hotel Bali → halaman 19 (Rp1.754.000)");
  c = ask("uang harian luar kota provinsi Aceh");
  check(c.pages.includes(15) && /Rp360\.000/.test(c.text), "PMK asli: uang harian Aceh → halaman 15");
  c = ask("tiket pesawat Jakarta Denpasar ekonomi bisnis");
  check(c.pages.includes(86) && /Rp3\.262\.000/.test(c.text), "PMK asli: tiket Jakarta–Denpasar → halaman 86");
  c = ask("satuan biaya sewa genset 500 KVA pemeliharaan");
  check(c.pages.some((p) => p > 60) && /31\.770\.000/.test(c.text), "PMK asli: genset 500 KVA (halaman 69, di atas batas lama 60)");
  c = ask("berapa tarif tol dan BBM per kilometer untuk perjalanan dinas");
  console.log(`   (info) tol/BBM: mode=${c.mode} halaman=${c.pages.join(",") || "-"}`);
  store.clear();
} else console.log("(PMK asli tidak ada di mesin ini: bagian PDF asli dilewati)");

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua tes PDF chat lulus.");
