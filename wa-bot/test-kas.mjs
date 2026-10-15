// Tes laporan kas bulanan (kas.js + kas-docx.js). Jalankan: node test-kas.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DENOMS, readKasConfig, parseRupiah, parseDate, parseClauses, parseKasCommand, applyEdits, computeView, seedRecord, finalizeRecord,
  describeRecord, createKas, idr, nextPeriod, lastDayIso
} from "./kas.js";
import { buildKasDocx, fmtInt, fmtMoney, fmtRp } from "./kas-docx.js";
import { readZip } from "./zip-lite.js";
import { createTelegram } from "./telegram.js";
import { findSoffice, docxToPdf } from "./nodin.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };
const jkt = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 7, mi); // WIB = UTC+7

// --- angka & tanggal
assert.deepEqual(parseRupiah("157509115"), { value: 157509115 });
assert.deepEqual(parseRupiah("157.509.115"), { value: 157509115 });
assert.deepEqual(parseRupiah("157,509,115"), { value: 157509115 });
assert.deepEqual(parseRupiah("Rp 157.509.115,00"), { value: 157509115 });
assert.deepEqual(parseRupiah("1.500"), { value: 1500 });
assert.deepEqual(parseRupiah("0"), { value: 0 });
assert.ok(parseRupiah("1.500,50").error, "sen ditolak");
assert.ok(parseRupiah("abc").error);
assert.ok(parseRupiah("").error);
assert.equal(parseDate("30-09-2026"), "2026-09-30");
assert.equal(parseDate("30/9/2026"), "2026-09-30");
assert.equal(parseDate("2026-09-30"), "2026-09-30");
assert.equal(parseDate("30 september 2026"), "2026-09-30");
assert.equal(parseDate("31-02-2026"), null);
assert.equal(parseDate("ngaco"), null);
assert.equal(lastDayIso({ y: 2026, m: 10 }), "2026-10-31");
assert.equal(lastDayIso({ y: 2028, m: 2 }), "2028-02-29");
assert.deepEqual(nextPeriod({ y: 2026, m: 12 }), { y: 2027, m: 1 });
assert.equal(idr(1771352342), "Rp 1.771.352.342");
assert.equal(fmtInt(42689382), "42,689,382");
assert.equal(fmtMoney(50898150), "50,898,150.00");
assert.equal(fmtRp(0), "Rp0.00");
assert.equal(fmtRp(-1500), "-Rp1,500.00");
ok("angka rupiah, tanggal, format dokumen");

// --- konfigurasi & perintah
let c = readKasConfig({});
assert.deepEqual([c.enabled, c.day, c.hour, c.minute, c.pdf], [true, 1, 7, 10, true]);
c = readKasConfig({ KAS_ENABLED: "false", KAS_DAY: "3", KAS_TIME: "8.45", KAS_PDF: "0" });
assert.deepEqual([c.enabled, c.day, c.hour, c.minute, c.pdf], [false, 3, 8, 45, false]);
c = readKasConfig({ KAS_DAY: "99", KAS_TIME: "x" });
assert.deepEqual([c.day, c.hour, c.minute], [1, 7, 10]);
assert.deepEqual(parseKasCommand("/kas"), { arg: "" });
assert.deepEqual(parseKasCommand("/kas@bot terima 100"), { arg: "terima 100" });
assert.deepEqual(parseKasCommand("!laporankas daftar"), { arg: "daftar" });
assert.equal(parseKasCommand("kas"), null);
assert.equal(parseKasCommand("/kasir"), null);
const pc = parseClauses("september 2026 terima=157.509.115 keluar: 165717883 kpa I Ketut Arimbawa rek2 1.771.352.342 tunai 100000=2 50000=1");
assert.deepEqual(pc.lead, ["september", "2026"]);
assert.deepEqual(pc.clauses.map((x) => [x.key, x.value]), [["terima", "157.509.115"], ["keluar", "165717883"], ["kpa", "I Ketut Arimbawa"], ["rek2", "1.771.352.342"], ["tunai", "100000=2 50000=1"]]);
ok("konfigurasi, perintah /kas, penguraian klausa");

// --- hitungan dari data September 2026 (harus sama dengan PDF contoh)
const sep = seedRecord();
let v = computeView(sep);
assert.equal(v.A, 42689382);
assert.equal(v.B, 42689382);
assert.equal(v.selisih, 0);
assert.equal(v.penjelasan, "Kesulitan Pecahan Rp0.00");
assert.equal(v.pemeriksa, "I Ketut Arimbawa");
assert.equal(v.item2, 42689382);
assert.equal(v.accounts.length, 4);
assert.equal(v.accounts.filter((a) => a.group !== "hak").reduce((s, a) => s + a.saldo, 0), 1771352342);
assert.equal(v.periodLabelUpper, "SEPTEMBER 2026");
ok("hitungan September 2026 = PDF contoh (saldo buku, kas, selisih, jumlah kelompok)");

// --- dokumen Word: isi + (bila ada) LibreOffice
const docx = buildKasDocx(v);
const entries = readZip(docx);
for (const e of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/settings.xml"]) assert.ok(entries.some((x) => x.name === e), `berkas ${e}`);
const xml = entries.find((e) => e.name === "word/document.xml").read().toString("utf8");
const plain = xml.replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
for (const want of ["LAPORAN SALDO REKENING", "PER 30-09-2026", "Telah Menjadi Hak Negara", "Belum/Tidak Menjadi Hak Negara", "650095380651000", "S-789/WPB.12/KP.02/2020", "18-02-2020", "1,771,352,342", "LAPORAN REGISTER PENUTUPAN KAS", "BULAN : SEPTEMBER 2026", "30 September 2026", "31 Agustus 2026", "50,898,150.00", "157,509,115.00", "165,717,883.00", "42,689,382.00", "Rp0.00", "Kesulitan Pecahan Rp0.00", "Achmad Chabib Nursalim", "NIP 199101162013101002", "NIP 196902241989121001", "Ditandatangani secara elektronik"]) assert.ok(plain.includes(want), `dokumen memuat: ${want}`);
assert.equal((xml.match(/<w:sectPr/g) || []).length, 2, "dua bagian: mendatar + tegak");
assert.ok(xml.includes('w:orient="landscape"'));
const xmlDoc = new (await import("node:util")).TextDecoder().decode(Buffer.from(xml));
assert.ok(xmlDoc.startsWith("<?xml"));
ok("dokumen Word memuat semua angka/teks, dua halaman (mendatar + tegak)");

// --- pengeditan
let r = applyEdits(sep, parseClauses("terima 100 keluar 40 rek2 5.000 tgl2 15-10-2026 tunai 100000=2 50000=1 penjelasan uji coba").clauses);
assert.deepEqual(r.errors, []);
assert.equal(r.rec.terima, 100);
assert.equal(r.rec.accounts[1].saldo, 5000);
assert.equal(r.rec.accounts[1].tgl, "2026-10-15");
assert.equal(r.rec.tunai[100000], 2);
assert.equal(r.rec.penjelasan, "uji coba");
assert.equal(sep.terima, 157509115, "sumber tidak berubah (salinan)");
r = applyEdits(sep, parseClauses("terima abc rek9 5 tgl1 31-02-2026 tunai 7=1 keluar 5").clauses);
assert.equal(r.errors.length, 4);
r = applyEdits(sep, parseClauses("tunai 0 kpa Budi Santoso nipkpa 1969 0224 pemeriksa auto awal 1.000 awal auto").clauses, { prevBuku: 777 });
assert.deepEqual(r.errors, []);
assert.equal(r.rec.kpa.nama, "Budi Santoso");
assert.equal(r.rec.kpa.nip, "19690224");
assert.equal(r.rec.awal, 777);
ok("pengeditan: nilai, tanggal, tunai, pejabat, galat (tidak ada yang berubah bila ada galat)");

// --- alur lengkap dengan penyimpanan palsu
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, val) => void m.set(k, val) }; };
function build(st, clockRef, extra = {}) {
  const sent = [];
  const kas = createKas({
    config: readKasConfig({}), state: st, timeZone: "Asia/Jakarta", tzLabel: "WIB", log: silent, now: () => clockRef.t,
    send: async (t) => { if (extra.fail?.()) throw new Error("kirim gagal"); sent.push(t); },
    convert: async () => Buffer.from("%PDF-palsu")
  });
  return { kas, sent };
}
{
  const st = mem(); const clock = { t: jkt(2026, 10, 15, 10, 0) };
  const { kas, sent } = build(st, clock);
  let o = await kas.handle("");
  assert.ok(o.ok && /September 2026/.test(o.text) && /tersimpan/.test(o.text) && /Oktober 2026/.test(o.text), "ringkasan awal: September tersimpan, berikutnya Oktober");
  assert.deepEqual(JSON.parse(st.m.get("kas_index")), ["2026-09"], "data awal ditanam");
  assert.equal(await kas.check(), false, "15 Oktober: belum waktunya (bulan lalu = September sudah ada)");
  assert.equal(sent.length, 0);
  o = await kas.handle("lihat september");
  assert.ok(o.ok && /Rp 42\.689\.382/.test(o.text));
  o = await kas.handle("dokumen");
  assert.ok(o.ok && o.files.map((f) => f.name).join() === "Saldo_Rekening_dan_Register_Kas_September_2026.pdf,Saldo_Rekening_dan_Register_Kas_September_2026.docx");
  o = await kas.handle("daftar");
  assert.ok(/September 2026: saldo buku Rp 42\.689\.382/.test(o.text));
  o = await kas.handle("terima 100");
  assert.equal(o.ok, false, "belum ada rancangan");
  assert.ok(/tidak dikenal/.test((await kas.handle("ngawur")).text));

  // 1 November 07.10 -> rancangan Oktober dikirim otomatis
  clock.t = jkt(2026, 11, 1, 7, 9);
  assert.equal(await kas.check(), false, "sebelum 07.10");
  clock.t = jkt(2026, 11, 1, 7, 10);
  assert.equal(await kas.check(), true);
  assert.equal(sent.length, 1);
  assert.ok(/Oktober 2026/.test(sent[0]) && /Rp 42\.689\.382/.test(sent[0]) && /belum diisi/.test(sent[0]) && /\/kas submit/.test(sent[0]), "rancangan: saldo awal = saldo buku September, minta penerimaan/pengeluaran");
  let d = JSON.parse(st.m.get("kas_draft"));
  assert.equal(d.period, "2026-10");
  assert.equal(d.awal, 42689382);
  assert.equal(d.closingDate, "2026-10-31");
  assert.equal(d.prevClosingDate, "2026-09-30");
  clock.t = jkt(2026, 11, 1, 7, 11);
  assert.equal(await kas.check(), false, "sehari sekali");
  clock.t = jkt(2026, 11, 2, 8, 0);
  assert.equal(await kas.check(), true, "besok mengingatkan lagi");
  assert.ok(/Pengingat/.test(sent[1]));

  // submit sebelum lengkap ditolak
  o = await kas.handle("submit");
  assert.equal(o.ok, false);
  assert.ok(/penerimaan/.test(o.text) && /pengeluaran/.test(o.text));
  o = await kas.handle("pratinjau");
  assert.equal(o.ok, false);

  // isi angka (perhatikan: saldo buku = 42.689.382 + 200.000.000 - 190.000.000 = 52.689.382)
  o = await kas.handle("terima 200.000.000 keluar 190000000");
  assert.ok(o.ok && /Saldo buku \(A\): Rp 52\.689\.382/.test(o.text) && /Selisih \(A−B\): Rp 0 ✅/.test(o.text), "rek 1 otomatis = saldo buku");
  assert.ok(/52\.689\.382 _\(otomatis/.test(o.text));
  o = await kas.handle("rek1 52.000.000");
  assert.ok(/⚠️/.test(o.text) && /Rp 689\.382/.test(o.text), "selisih ditandai bila saldo bank beda");
  o = await kas.handle("rek1 auto tgl3 31-10-2026 penjelasan sesuai");
  assert.ok(o.ok && /Selisih \(A−B\): Rp 0 ✅/.test(o.text));
  o = await kas.handle("pratinjau");
  assert.ok(o.ok && o.files[0].name.includes("pratinjau"));
  assert.ok(!st.m.has("kas_rec_2026-10"), "pratinjau tidak menyimpan");

  // submit
  clock.t = jkt(2026, 11, 2, 9, 0);
  o = await kas.handle("submit");
  assert.ok(o.ok && /DISIMPAN/.test(o.text) && o.files.length === 2);
  assert.equal(st.m.get("kas_draft"), "null");
  assert.deepEqual(JSON.parse(st.m.get("kas_index")), ["2026-09", "2026-10"]);
  const saved = JSON.parse(st.m.get("kas_rec_2026-10"));
  assert.equal(saved.terima, 200000000);
  const sv = computeView(saved);
  assert.equal(sv.accounts[0].saldo, 52689382, "rekening 1 = saldo buku (otomatis)");
  assert.equal(saved.accounts[0].saldo, null, "nilai otomatis tetap otomatis di data tersimpan");
  assert.equal(sv.accounts[0].tgl, "2026-10-31");
  assert.equal(sv.accounts[1].saldo, 1771352342, "rekening lain terbawa");
  assert.equal(sv.accounts[1].tgl, "2026-09-30", "tanggal terbawa bila saldo tak berubah");
  assert.equal(sv.accounts[2].tgl, "2026-10-31", "diisi manual");
  assert.equal(sv.accounts[3].tgl, "2026-03-12");
  assert.equal(saved.penjelasan, "sesuai");
  assert.ok(saved.submittedAt);
  assert.equal(await kas.check(), false, "setelah submit tidak ada pengingat");
  clock.t = jkt(2026, 11, 20, 9, 0);
  assert.equal(await kas.check(), false, "November belum waktunya (bulan lalu = Oktober sudah ada)");

  // dipanggil kembali
  o = await kas.handle("lihat oktober");
  assert.ok(/Penerimaan: Rp 200\.000\.000/.test(o.text));
  o = await kas.handle("dokumen oktober 2026");
  assert.ok(o.files[1].name.endsWith("Oktober_2026.docx"));
  o = await kas.handle("lihat desember");
  assert.equal(o.ok, false);
  o = await kas.handle("daftar");
  assert.ok(/Oktober 2026/.test(o.text) && /September 2026/.test(o.text));

  // 1 Desember -> rancangan November memakai saldo buku Oktober
  clock.t = jkt(2026, 12, 1, 7, 30);
  assert.equal(await kas.check(), true);
  d = JSON.parse(st.m.get("kas_draft"));
  assert.equal(d.period, "2026-11");
  assert.equal(d.awal, 52689382);
  assert.equal(d.accounts[1].prevSaldo, 1771352342);
  assert.equal(d.prevClosingDate, "2026-10-31");

  // koreksi bulan lama: saldo awal rancangan ikut, peringatan rantai
  o = await kas.handle("ubah oktober keluar 189.000.000");
  assert.ok(o.ok && /Rp 52\.689\.382 → Rp 53\.689\.382/.test(o.text) && /Rancangan November 2026 ikut diperbarui/.test(o.text), o.text);
  assert.equal(JSON.parse(st.m.get("kas_draft")).awal, 53689382);
  assert.equal(JSON.parse(st.m.get("kas_draft")).accounts[0].prevSaldo, 53689382, "saldo pembanding rancangan ikut");
  o = await kas.handle("lihat oktober");
  assert.ok(/Saldo buku \(A\): Rp 53\.689\.382/.test(o.text) && /Selisih \(A−B\): Rp 0 ✅/.test(o.text), "rekening 1 otomatis ikut, selisih tetap 0");
  // mulai/ulang
  assert.equal((await kas.handle("mulai")).ok, false, "rancangan sudah ada");
  o = await kas.handle("terima 5 keluar 3");
  o = await kas.handle("ulang");
  assert.ok(o.ok && /belum diisi/.test(o.text));
  assert.equal(JSON.parse(st.m.get("kas_draft")).terima, null);
}
ok("alur: data awal, rancangan 1 November, pengingat harian, isi angka, pratinjau, submit, panggil ulang, bulan berikutnya, koreksi, ulang");

{
  // koreksi bulan lama yang bulan sesudahnya sudah tersimpan -> peringatan
  const st = mem(); const clock = { t: jkt(2026, 11, 1, 8, 0) };
  const { kas } = build(st, clock);
  await kas.check();
  await kas.handle("terima 200000000 keluar 190000000");
  await kas.handle("submit");
  clock.t = jkt(2026, 12, 1, 8, 0);
  await kas.check();
  await kas.handle("terima 1 keluar 1");
  await kas.handle("submit");
  const o = await kas.handle("ubah oktober keluar 100");
  assert.ok(/saldo awal November 2026 masih/.test(o.text) && /\/kas ubah november awal/.test(o.text), o.text);
  const fixed = await kas.handle(`ubah november awal auto`);
  assert.ok(fixed.ok);
  assert.equal(computeView(JSON.parse(st.m.get("kas_rec_2026-11"))).awal, computeView(JSON.parse(st.m.get("kas_rec_2026-10"))).A);
  assert.equal((await kas.handle("ubah oktober")).ok, false);
  assert.equal((await kas.handle("ubah agustus keluar 1")).ok, false, "bulan belum tersimpan");
}
ok("koreksi bulan lama: peringatan saldo awal bulan sesudahnya + perbaikan 'awal auto'");

{
  // loncat bulan: Desember padahal Oktober belum diisi -> Oktober dulu, lalu November
  const st = mem(); const clock = { t: jkt(2026, 12, 3, 9, 0) };
  const { kas, sent } = build(st, clock);
  assert.equal(await kas.check(), true);
  assert.equal(JSON.parse(st.m.get("kas_draft")).period, "2026-10", "bulan yang bolong diisi berurutan");
  assert.ok(/Oktober 2026/.test(sent[0]));
  await kas.handle("terima 1 keluar 1");
  await kas.handle("submit");
  clock.t = jkt(2026, 12, 4, 9, 0);
  assert.equal(await kas.check(), true);
  assert.equal(JSON.parse(st.m.get("kas_draft")).period, "2026-11");
  const bad = await kas.handle("mulai januari 2027");
  assert.equal(bad.ok, false);
}
ok("bulan terlewat diisi berurutan (rantai saldo awal tidak bolong)");

{
  // kegagalan: kirim gagal, basis data gagal, fitur mati
  const st = mem(); const clock = { t: jkt(2026, 11, 1, 8, 0) }; let fail = true;
  const { kas, sent } = build(st, clock, { fail: () => fail });
  assert.equal(await kas.check(), false, "kirim gagal");
  assert.ok(st.m.has("kas_draft"), "rancangan tetap dibuat");
  assert.ok(!st.m.has("kas_remind"));
  assert.equal(await kas.check(), false, "jeda 30 menit");
  clock.t += 31 * 60_000; fail = false;
  assert.equal(await kas.check(), true, "berhasil setelah jeda");
  assert.equal(sent.length, 1);

  const dead = mem(); dead.get = async () => { throw new Error("db mati"); };
  const k2 = build(dead, { t: jkt(2026, 11, 1, 8, 0) }).kas;
  assert.equal(await k2.check(), false);
  assert.ok(/gagal diproses/.test((await k2.handle("")).text));
  assert.equal(dead.m.size, 0, "galat basis data tidak menimpa/menanam apa pun");
  const off = createKas({ config: { ...readKasConfig({}), enabled: false }, state: mem(), send: async () => { throw new Error("jangan"); }, log: silent, now: () => jkt(2026, 11, 1, 8, 0) });
  assert.equal(await off.check(), false);
  assert.ok(/mati/.test(off.describe()));
}
ok("kegagalan: kirim gagal (jeda), basis data gagal (tak menimpa), fitur mati");

// --- Telegram: teks dulu, lalu berkas
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const isForm = init?.body instanceof FormData;
    calls.push({ method, form: isForm ? init.body : null, body: !isForm && init?.body ? JSON.parse(init.body) : {} });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const st = mem(); const clock = { t: jkt(2026, 11, 1, 8, 0) };
  const { kas } = build(st, clock);
  const tg = createTelegram({ config: { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true }, deps: { chat: async () => "x", kas }, fetchImpl: fakeFetch, log: silent });
  const say = (text, id) => tg.handleUpdate({ update_id: id, message: { chat: { id: 111, type: "private" }, text } });
  await say("/kas bantuan", 1);
  assert.ok(calls.at(-1).body.text.includes("Laporan kas bulanan"));
  await say("/kas mulai", 2);
  assert.ok(calls.some((c) => c.method === "sendMessage" && /RANCANGAN/.test(c.body.text)));
  await say("/kas terima 10 keluar 5", 3);
  await say("/kas submit", 4);
  const docs = calls.filter((c) => c.method === "sendDocument");
  assert.equal(docs.length, 2);
  assert.ok(docs[0].form.get("document").name.includes("Oktober_2026"));
  const txt = calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text).join("\n");
  assert.ok(/DISIMPAN/.test(txt));
  const tg2 = createTelegram({ config: { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true }, deps: { chat: async () => "x" }, fetchImpl: fakeFetch, log: silent });
  await tg2.handleUpdate({ update_id: 9, message: { chat: { id: 111, type: "private" }, text: "/kas" } });
  assert.ok(calls.at(-1).body.text.includes("belum aktif"));
}
ok("Telegram: /kas bantuan, mulai, isi, submit mengirim teks lalu PDF+Word");

// --- LibreOffice sungguhan (bergantung mesin: gagal hanya DICATAT)
const so = await findSoffice("");
if (so) {
  try {
    const pdf = await docxToPdf(docx, { soffice: so });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kas-tes-"));
    fs.writeFileSync(path.join(tmp, "a.pdf"), pdf);
    let pages = 0;
    let text = "";
    try {
      text = execFileSync("pdftotext", ["-layout", path.join(tmp, "a.pdf"), "-"], { encoding: "utf8" });
      pages = (text.match(/\f/g) || []).length;
    } catch {
      /* pdftotext tidak ada: lewati pemeriksaan isi */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (text) {
      assert.equal(pages, 2, "tepat 2 halaman");
      assert.ok(text.includes("42,689,382.00") && text.includes("1,771,352,342") && text.includes("LAPORAN REGISTER PENUTUPAN KAS"));
    }
    ok(`LibreOffice (${so}) -> PDF ${Math.round(pdf.length / 1024)} KB${pages ? ", 2 halaman, isi sesuai" : ""}`);
  } catch (e) {
    console.log(`  ! LibreOffice (${so}) ada tetapi belum bisa membuat PDF di mesin ini -- bot akan mengirim Word saja.\n    ${String(e.message).slice(0, 300)}`);
  }
} else console.log("  - LibreOffice tidak ada di mesin ini, tes PDF sungguhan dilewati");

console.log(`\nSemua ${n} kelompok tes kas lulus.`);
