// Tes arsip PDF grup: dedup sha256, isolasi antargrup, tidak terkirim ke Jina, scan tidak diindeks,
// pencarian menurut nama berkas/nomor peraturan, hapus bersih, pemberitahuan sekali per grup.
//   node test-arsip-pdf.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createArsip, arsipConfig, arsipCitationNote, refsOf, ARSIP_NOTICE_TEXT } from "./arsip-pdf.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, error() {} };

// "PDF" palsu: isi = teks halaman dipisah \f; readPages mengembalikan halaman dari isi itu.
const mk = (...pages) => Buffer.from(`%PDF-1.7\n${pages.join("\f")}`);
const fakeRead = async (buf, { maxPages = 300 } = {}) => {
  const raw = buf.toString("latin1").replace(/^%PDF-1\.7\n/, "");
  const all = raw.split("\f").map((t, i) => ({ page: i + 1, text: t }));
  const chars = all.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
  if (raw.startsWith("RUSAK")) throw Object.assign(new Error("rusak"), { kind: "badpdf" });
  return { pages: all.slice(0, maxPages), total: all.length, truncated: all.length > maxPages, scanned: chars < 30 };
};

const KMK = mk(
  "KEPUTUSAN MENTERI KEUANGAN REPUBLIK INDONESIA\nNOMOR 296/KMK.05/2026\nTENTANG PEMBERIAN TUNJANGAN KINERJA PEGAWAI KEMENTERIAN KEUANGAN",
  "Pasal 1\nBesaran tunjangan kinerja bagi pegawai golongan IV ditetapkan sebesar Rp5.400.000 per bulan setiap bulannya.",
  "Pasal 2\nPembayaran tunjangan dilakukan paling lambat tanggal 10 bulan berikutnya oleh bendahara."
);
const PMK = mk(
  "PERATURAN MENTERI KEUANGAN NOMOR 32 TAHUN 2025\nTENTANG STANDAR BIAYA MASUKAN",
  "Pasal 1\nUang harian perjalanan dinas dalam negeri ditetapkan sebesar Rp430.000 per hari untuk provinsi tertentu."
);
const RAHASIA = mk("Dokumen internal grup B", "Anggaran rahasia kegiatan pembinaan duta wisata sebesar Rp999.000.000 khusus grup B.");
const SCAN = mk(" ", " ");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arsip-tes-"));
const store = new Map();
const state = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) };
let t = Date.parse("2026-10-12T03:00:00Z");
const now = () => new Date((t += 60_000));
const arsip = await createArsip({ dir, state, readPages: fakeRead, now, log: silent, maxBytes: 5000 });

const GA = "111@g.us";
const GB = "222@g.us";
let n = 0;
const send = (buf, { name, group = GA, groupName = group === GA ? "Grup Keuangan" : "Grup B", sender = "Bu Rina", size } = {}) =>
  arsip.ingest({ download: async () => buf, fileName: name, size: size ?? buf.length, groupJid: group, groupName, senderName: sender, senderJid: "62811@s.whatsapp.net", messageId: `M${++n}` });

// ---------- config
{
  const c = arsipConfig({}, "/x");
  check(c.enabled === true && c.notice === true && c.dir === path.resolve("/x", "arsip-dokumen"), "config: bawaan aktif, pemberitahuan on, folder arsip-dokumen");
  const o = arsipConfig({ ARSIP_ENABLED: "false", ARSIP_PEMBERITAHUAN: "off", ARSIP_DIR: "/tmp/z" }, "/x");
  check(o.enabled === false && o.notice === false && o.dir === "/tmp/z", "config: dapat dimatikan & folder diganti");
}

// ---------- pengenalan acuan
check(JSON.stringify(refsOf("bot, apa isi KMK 296 tahun 2026?")) === '[{"kind":"kmk","num":"296"}]', "refsOf: KMK 296 (tahun diabaikan)");
check(refsOf("bandingkan PMK nomor 32 dengan KMK 296/2026").length === 2, "refsOf: dua acuan");
check(refsOf("tahun 2026 ada apa").length === 0, "refsOf: angka tahun saja bukan nomor");

// ---------- masuk, dedup sha256
const r1 = await send(KMK, { name: "KMK 296 Tukin.pdf" });
check(r1.status === "terindeks" && r1.sha?.length === 64 && r1.stored && r1.firstForGroup && r1.pages === 3, "PDF teks terindeks, halaman terhitung");
check(fs.existsSync(path.join(dir, `${r1.sha}.pdf`)) && fs.existsSync(path.join(dir, "indeks.sqlite")), "berkas asli <sha256>.pdf dan indeks.sqlite tersimpan");
const r1b = await send(KMK, { name: "salinan-kmk.pdf", sender: "Pak Budi" });
check(r1b.duplicate === true && r1b.sha === r1.sha && r1b.firstForGroup === false, "berkas sama dikirim lagi: dedup (tanpa indeks ulang)");
check(arsip.stats().files === 1 && arsip.stats().indexed === 1 && arsip.index.stats().docs === 1, "dedup: tetap 1 berkas & 1 dokumen terindeks");
check(arsip.list().length === 1 && arsip.handle("daftar").includes("KMK 296 Tukin.pdf"), "daftar memuat nama asli pertama");
const dupMsg = await arsip.ingest({ download: async () => KMK, fileName: "x.pdf", size: KMK.length, groupJid: GA, senderName: "Bu Rina", messageId: "M1" });
check(dupMsg.status === "duplikat-pesan", "pesan yang sama (id pesan) diproses dua kali -> diabaikan");
const origins = arsip.handle("cari tunjangan");
check(/Grup Keuangan/.test(origins), "asal-usul grup tercatat");

await send(PMK, { name: "PMK-32-2025.pdf" });
await send(RAHASIA, { name: "anggaran-duta-wisata.pdf", group: GB, sender: "Pak Joko" });

// ---------- scan, gagal, terlalu besar
const rs = await send(SCAN, { name: "scan-surat.pdf" });
check(rs.status === "scan" && rs.stored && arsip.index.stats().docs === 3, "PDF scan: status dicatat, TIDAK diindeks");
check(arsip.stats().scan === 1 && arsip.search("surat scan", { groupJid: GA }).length === 0, "scan tidak bisa dicari");
const rf = await send(mk("RUSAK total"), { name: "rusak.pdf" });
check(rf.status === "gagal" && arsip.stats().failed >= 1, "PDF rusak: status gagal, tidak mengganggu");
const rbig = await send(Buffer.alloc(10), { name: "raksasa.pdf", size: 9_999_999 });
check(rbig.status === "terlalu besar" && arsip.stats().tooBig === 1, "melebihi batas ukuran: dicatat 'terlalu besar', tidak diunduh");
const rdl = await arsip.ingest({ download: async () => { throw new Error("jaringan putus"); }, fileName: "x.pdf", size: 10, groupJid: GA, messageId: "MX" });
check(rdl.status === "gagal", "unduhan gagal: tidak melempar galat");

// ---------- isolasi antargrup
{
  const inA = arsip.search("anggaran rahasia duta wisata", { groupJid: GA });
  const inB = arsip.search("anggaran rahasia duta wisata", { groupJid: GB });
  const owner = arsip.search("anggaran rahasia duta wisata", { groupJid: null });
  check(inA.length === 0, "isolasi: arsip grup B tidak muncul di grup A");
  check(inB.length > 0 && /999\.000\.000/.test(inB[0].text), "isolasi: grup B menemukan arsipnya sendiri");
  check(owner.length > 0, "pemilik boleh mencari lintas grup");
  check(arsip.search("tunjangan kinerja", { groupJid: GB }).length === 0, "isolasi: arsip grup A tidak muncul di grup B");
  check(arsip.search("tunjangan kinerja", { groupJid: "999@g.us" }).length === 0, "grup tanpa arsip: kosong (bukan bocor ke semua)");
  check(arsip.lookup(GA, "isi anggaran rahasia duta wisata dokumen") === null, "lookup di grup A tidak menemukan dokumen grup B");
  check(arsip.lookup("999@g.us", "isi KMK 296") === null, "lookup di grup lain/pribadi: tidak ada hasil");
  // berkas yang SAMA dikirim di grup B: grup B ikut bisa memakainya, grup A tetap hanya miliknya
  await send(PMK, { name: "pmk32.pdf", group: GB, groupName: "Grup B" });
  check(arsip.lookup(GB, "uraikan PMK 32")?.docs[0]?.sha === arsip.lookup(GA, "uraikan PMK 32")?.docs[0]?.sha, "berkas sama di dua grup: dedup tapi keduanya bisa memakai");
}

// ---------- tidak terkirim ke Jina / embedding
{
  check(arsip.index.pendingVectors("model-x", 100).length === 0, "tidak ada potongan arsip yang menunggu embedding");
  arsip.index.putVectors("model-x", [{ docId: `local:arsip:${r1.sha}`, seq: 0, vec: new Float32Array([1, 0]) }]);
  const vs = arsip.index.vectorStats("model-x");
  check(vs.total === 0 && vs.embedded === 0, "vektor untuk arsip ditolak & tidak dihitung (diperlakukan sebagai dokumen lokal)");
  check(arsip.index.listDocs().every((d) => d.id.startsWith("local:arsip:")), "semua dokumen arsip berid 'local:' (dikecualikan dari jalur penyedia luar)");
  check(arsip.index.search("tunjangan kinerja", { excludeLocal: true }).length === 0, "pencarian excludeLocal (jalur Gemini/Jina) tidak melihat arsip");
}

// ---------- pencarian menurut nomor peraturan / nama berkas
{
  const a = arsip.lookup(GA, "bot, berapa tunjangan golongan IV di KMK 296?");
  check(a?.via === "nomor" && a.docs[0].name === "KMK 296 Tukin.pdf" && a.docs[0].sender === "Bu Rina" && a.docs[0].total === 3 && a.docs[0].pages.length === 3, "lookup 'KMK 296' -> berkas benar, pengirim & halaman terbawa");
  check(/tgl 12 Oktober 2026/.test(arsipCitationNote(a.docs)) && /hlm N/.test(arsipCitationNote(a.docs)), "catatan sitasi memuat nama, pengirim, tanggal, hlm N");
  const byFileName = arsip.lookup(GA, "tolong ringkas PMK-32-2025.pdf");
  check(byFileName?.docs[0]?.name === "PMK-32-2025.pdf", "lookup menurut nama berkas / nomor PMK 32");
  const byName = arsip.lookup(GA, "apa isi dokumen tukin?");
  check(byName === null || byName.docs.length === 1, "nama berkas satu kata pendek tidak asal cocok");
  const byNumFirstPage = arsip.lookup(GA, "pasal 2 KMK 296 soal pembayaran?");
  check(byNumFirstPage?.docs[0]?.name === "KMK 296 Tukin.pdf", "nomor dicocokkan juga ke halaman pertama");
  const content = arsip.lookup(GA, "dokumen yang dibagikan tadi: berapa uang harian perjalanan dinas dalam negeri?");
  check(content?.via === "isi" && content.docs[0].name === "PMK-32-2025.pdf", "jelas bertanya isi dokumen -> BM25 di arsip grup");
  check(arsip.lookup(GA, "bot, siapa presiden pertama indonesia?") === null, "obrolan umum tidak memicu arsip");
  check(arsip.lookup(GA, "ada peraturan baru gak?") === null, "kata 'peraturan' saja tanpa isi spesifik tidak memicu arsip");
  check(arsip.lookup(GA, "isi KMK 777") === null, "nomor yang tak ada di arsip -> null (alur biasa)");
  const cmp = arsip.lookup(GA, "bandingkan KMK 296 dengan PMK 32");
  check(cmp?.docs.length === 2, "permintaan membandingkan: dua dokumen arsip diikutkan");
  const cmp2 = arsip.lookup(GA, "bandingkan isi dokumen tentang tunjangan kinerja bendahara dan uang harian perjalanan dinas");
  check(cmp2 === null || cmp2.docs.length <= 2, "pembanding maksimal dua dokumen");
}

// ---------- perintah pemilik
{
  const s = arsip.handle("");
  check(/berkas/.test(s) && /Grup Keuangan/.test(s) && /Grup B/.test(s) && /terlalu besar 1/.test(s), "/arsip: ringkasan per grup");
  check(/KMK 296 Tukin\.pdf/.test(arsip.handle("daftar Keuangan")) && !/anggaran-duta/.test(arsip.handle("daftar Keuangan")), "/arsip daftar <grup> menyaring");
  check(/tunjangan/i.test(arsip.handle("cari tunjangan kinerja")) && /^🔎 Tidak ada/.test(arsip.handle("cari xyzqwk")), "/arsip cari");
  check(arsipStatusOk(arsip.statusLine()), "baris /status");
}
function arsipStatusOk(l) { return /^📦 Arsip PDF grup: \d+ berkas, /.test(l); }

// ---------- hapus bersih
{
  const rows = arsip.list();
  const no = rows.find((r) => r.b.nama === "anggaran-duta-wisata.pdf").no;
  const sha = rows.find((r) => r.b.nama === "anggaran-duta-wisata.pdf").b.sha256;
  const ask = arsip.handle(`hapus ${no}`, { chatId: "1" });
  check(/Ketik: \/arsip hapus \d+ ya/.test(ask) && fs.existsSync(path.join(dir, `${sha}.pdf`)), "hapus: minta konfirmasi dulu, belum terhapus");
  check(/kedaluwarsa/.test(arsip.handle(`hapus ${no} ya`, { chatId: "lain" })), "hapus: konfirmasi dari chat lain ditolak");
  let removed = null;
  const done = arsip.handle(`hapus ${no} ya`, { chatId: "1", onRemove: (s) => (removed = s) });
  check(/Dihapus/.test(done) && removed === sha, "hapus: setelah konfirmasi terhapus");
  check(!fs.existsSync(path.join(dir, `${sha}.pdf`)), "hapus: berkas asli hilang");
  check(arsip.search("anggaran rahasia duta wisata", { groupJid: GB }).length === 0 && arsip.index.listDocs().every((d) => !d.id.endsWith(sha)), "hapus: indeks bersih");
  check(arsip.list().every((r) => r.b.sha256 !== sha), "hapus: metadata bersih");
  const again = await send(RAHASIA, { name: "anggaran-duta-wisata.pdf", group: GB, sender: "Pak Joko" });
  check(again.status === "terindeks" && !again.duplicate, "berkas yang pernah dihapus bisa diarsipkan lagi");
}

// ---------- pemberitahuan sekali per grup
{
  check((await arsip.claimNotice(GA)) === true && (await arsip.claimNotice(GA)) === false, "pemberitahuan: sekali untuk grup A");
  check((await arsip.claimNotice(GB)) === true, "pemberitahuan: grup B tetap dapat satu kali");
  check(/disimpan di komputer kantor/.test(ARSIP_NOTICE_TEXT) && /Hubungi pemilik bot/.test(arsip.noticeText), "teks pemberitahuan");
  const off = await createArsip({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "arsip-off-")), state, notice: false, readPages: fakeRead, log: silent });
  check((await off.claimNotice("333@g.us")) === false && !store.has("arsip_notice:333@g.us"), "ARSIP_PEMBERITAHUAN=off: tidak ada pemberitahuan");
  off.close();
  const broken = await createArsip({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "arsip-brk-")), state: { get: async () => { throw new Error("db mati"); }, set: async () => {} }, readPages: fakeRead, log: silent });
  check((await broken.claimNotice("444@g.us")) === false, "status tak terbaca: tidak mengirim (tak pernah dobel)");
  broken.close();
}

// ---------- persisten: dibuka ulang, isi tetap ada
{
  arsip.close();
  const again = await createArsip({ dir, state, readPages: fakeRead, log: silent });
  check(again.lookup(GA, "isi KMK 296")?.docs[0]?.name === "KMK 296 Tukin.pdf", "indeks & metadata persisten setelah dibuka ulang");
  const dupAfter = await again.ingest({ download: async () => KMK, fileName: "lagi.pdf", size: KMK.length, groupJid: GA, groupName: "Grup Keuangan", senderName: "X", messageId: "M-baru" });
  check(dupAfter.duplicate === true, "dedup bertahan setelah restart");
  again.close();
}

fs.rmSync(dir, { recursive: true, force: true });
if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua tes arsip PDF lulus.");
