// Tes konsep nota dinas bulanan (nodin.js). Jalankan: node test-nodin.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BULAN, readNodinConfig, previousMonth, defaultPeriod, letterMonth, periodKey, periodLabel,
  parseNodinCommand, parseNodinArg, repairSplitPlaceholders, fillDocx, buildZip, crc32, createNodin, findSoffice, docxToPdf
} from "./nodin.js";
import { readZip } from "./zip-lite.js";
import { createTelegram } from "./telegram.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(here, "templates", "nota-dinas-lpj.docx");
let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };

// --- periode
assert.deepEqual(previousMonth(2026, 11), { y: 2026, m: 10 });
assert.deepEqual(previousMonth(2026, 1), { y: 2025, m: 12 });
assert.deepEqual(defaultPeriod({ y: 2027, m: 1 }), { y: 2026, m: 12 });
assert.deepEqual(letterMonth({ y: 2026, m: 12 }), { y: 2027, m: 1 });
assert.equal(periodKey({ y: 2026, m: 3 }), "2026-03");
assert.equal(periodLabel({ y: 2026, m: 10 }), "Oktober 2026");
ok("periode: bulan sebelum surat, lintas tahun");

// --- konfigurasi
let c = readNodinConfig({}, "/bot");
assert.equal(c.enabled, true); assert.equal(c.day, 1); assert.equal(c.hour, 7); assert.equal(c.minute, 0); assert.equal(c.lateDays, 5);
assert.equal(c.template, path.join("/bot", "templates", "nota-dinas-lpj.docx"));
c = readNodinConfig({ NODIN_ENABLED: "false", NODIN_DAY: "3", NODIN_TIME: "8.30", NODIN_LATE_DAYS: "2", NODIN_PDF: "0" });
assert.equal(c.enabled, false); assert.equal(c.day, 3); assert.equal(c.hour, 8); assert.equal(c.minute, 30); assert.equal(c.lateDays, 2); assert.equal(c.pdf, false);
c = readNodinConfig({ NODIN_DAY: "40", NODIN_TIME: "99:99", NODIN_LATE_DAYS: "x" });
assert.equal(c.day, 1); assert.equal(c.hour, 7); assert.equal(c.lateDays, 5);
ok("konfigurasi + nilai ngawur jatuh ke bawaan");

// --- perintah
assert.deepEqual(parseNodinCommand("/nodin"), { arg: "" });
assert.deepEqual(parseNodinCommand("!nodin November"), { arg: "November" });
assert.deepEqual(parseNodinCommand("/notadinas@bot status"), { arg: "status" });
assert.equal(parseNodinCommand("nodin"), null);
assert.equal(parseNodinCommand("/nodinx"), null);
const now = { y: 2026, m: 10, d: 14 };
assert.deepEqual(parseNodinArg("", now), { kind: "default", period: { y: 2026, m: 9 } });
assert.equal(parseNodinArg("status", now).kind, "status");
assert.deepEqual(parseNodinArg("oktober", now).period, { y: 2026, m: 10 });
assert.deepEqual(parseNodinArg("desember", now).period, { y: 2025, m: 12 });
assert.deepEqual(parseNodinArg("november 2026", now).period, { y: 2026, m: 11 });
assert.deepEqual(parseNodinArg("10 2026", now).period, { y: 2026, m: 10 });
assert.deepEqual(parseNodinArg("2026-09", now).period, { y: 2026, m: 9 });
assert.equal(parseNodinArg("cek", now).kind, "check");
assert.equal(parseNodinArg("blabla", now).kind, "error");
assert.equal(parseNodinArg("13 2026", now).kind, "error");
assert.equal(parseNodinArg("oktober 1999", now).kind, "error");
ok("perintah /nodin dan argumen");

// --- zip
const sample = buildZip([{ name: "b.txt", data: Buffer.from("halo ".repeat(100)) }, { name: "[Content_Types].xml", data: Buffer.from("<x/>") }, { name: "kecil.bin", data: Buffer.from([1, 2, 3]) }]);
const back = readZip(sample);
assert.equal(back[0].name, "[Content_Types].xml");
assert.equal(back.find((e) => e.name === "b.txt").read().toString(), "halo ".repeat(100));
assert.deepEqual([...back.find((e) => e.name === "kecil.bin").read()], [1, 2, 3]);
assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
ok("penulis ZIP + CRC32");

// --- penanda terpecah
const split = '<w:p><w:r><w:t>Bulan [Bulan_</w:t></w:r><w:r><w:t>Laporan] ya</w:t></w:r></w:p><w:p><w:r><w:t>utuh [Tahun_Laporan]</w:t></w:r><w:r><w:t> b</w:t></w:r></w:p>';
const fixed = repairSplitPlaceholders(split);
assert.ok(fixed.includes("Bulan [Bulan_Laporan] ya"));
assert.ok(fixed.includes("utuh [Tahun_Laporan]</w:t></w:r><w:r><w:t> b"), "paragraf utuh tidak disentuh");
ok("penanda yang terpecah antar-run diperbaiki, paragraf lain utuh");

// --- isi templat sungguhan
const filled = fillDocx(fs.readFileSync(TEMPLATE), { bulan: "Oktober", tahun: 2026 });
const doc = readZip(filled).find((e) => e.name === "word/document.xml").read().toString("utf8");
const text = doc.replace(/<[^>]+>/g, "");
assert.ok(text.includes("Bulan Oktober 2026"), "bulan terisi");
assert.ok(!text.includes("[Bulan_Laporan]") && !text.includes("[Tahun_Laporan]"));
assert.ok(text.includes("[Nomor_ND]") && text.includes("[Tanggal_ND]"), "penanda sistem persuratan dibiarkan");
assert.ok(!/Nomor PMK Nomor|Kedudukandan|terimakasih/.test(text), "salah ketik sudah diperbaiki");
const all = readZip(filled).filter((e) => !e.isDir).map((e) => e.name);
assert.ok(all.some((x) => x.startsWith("word/media/")), "logo ikut");
assert.throws(() => fillDocx(buildZip([{ name: "word/document.xml", data: Buffer.from("<w:document/>") }]), { bulan: "Mei", tahun: 2026 }), /Templat tidak memuat/);
ok("templat sungguhan terisi; Nomor/Tanggal tetap; logo ikut; templat salah ditolak");

// --- pengiriman terjadwal (tanpa LibreOffice: convert palsu)
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) }; };
const cfg = readNodinConfig({}, here);
const jkt = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 7, mi); // WIB = UTC+7
async function scenario(clock, st, extra = {}) {
  const sent = [];
  const sentText = [];
  const svc = createNodin({
    config: cfg, state: st, timeZone: "Asia/Jakarta", tzLabel: "WIB", log: silent, now: () => clock.t,
    convert: async () => Buffer.from("%PDF-palsu"),
    sendFiles: async (files, caption) => { if (extra.fail?.()) throw new Error("kirim gagal"); sent.push({ files, caption }); },
    send: async (t) => void sentText.push(t)
  });
  return { svc, sent, sentText };
}
{
  const st = mem(); const clock = { t: jkt(2026, 10, 31, 12, 0) };
  const { svc, sent } = await scenario(clock, st);
  assert.equal(await svc.check(), false, "tgl 31: bukan waktunya");
  clock.t = jkt(2026, 11, 1, 6, 59);
  assert.equal(await svc.check(), false, "tgl 1 sebelum 07.00");
  clock.t = jkt(2026, 11, 1, 7, 0);
  assert.equal(await svc.check(), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].files.map((f) => f.name), ["Konsep_ND_LPJ_Bendahara_Oktober_2026.pdf", "Konsep_ND_LPJ_Bendahara_Oktober_2026.docx"]);
  assert.ok(sent[0].caption.includes("Oktober 2026") && sent[0].caption.includes("1 November 2026"));
  assert.equal(st.m.get("nodin_last"), "2026-10");
  clock.t = jkt(2026, 11, 1, 7, 1);
  assert.equal(await svc.check(), false, "tidak dobel");
  clock.t = jkt(2026, 11, 3, 9, 0);
  assert.equal(await svc.check(), false, "tidak dobel di hari berikutnya");
  assert.equal(sent.length, 1);
  clock.t = jkt(2026, 12, 1, 8, 0);
  assert.equal(await svc.check(), true, "bulan berikutnya jalan lagi");
  assert.ok(sent[1].files[0].name.includes("November_2026"));
}
ok("terjadwal: tepat waktu, tidak dobel, bulan berikutnya jalan");
{
  const st = mem(); const clock = { t: jkt(2027, 1, 1, 7, 0) };
  const { svc, sent } = await scenario(clock, st);
  assert.equal(await svc.check(), true);
  assert.ok(sent[0].files[0].name.includes("Desember_2026"), "1 Januari -> laporan Desember tahun lalu");
}
ok("1 Januari -> laporan Desember tahun sebelumnya");
{
  const st = mem(); const clock = { t: jkt(2026, 11, 3, 15, 0) };
  const { svc, sent } = await scenario(clock, st);
  assert.equal(await svc.check(), true, "bot mati tgl 1, dikejar tgl 3");
  assert.equal(sent.length, 1);
  clock.t = jkt(2026, 11, 6, 9, 0);
  const st2 = mem();
  const s2 = await scenario(clock, st2);
  assert.equal(await s2.svc.check(), false, "lewat batas hari kejar (tgl 6)");
}
ok("terlewat dikejar sampai batas hari");
{
  const st = mem(); const clock = { t: jkt(2026, 11, 1, 7, 0) }; let fails = 3;
  const { svc, sent, sentText } = await scenario(clock, st, { fail: () => fails-- > 0 });
  assert.equal(await svc.check(), false);
  assert.equal(await svc.check(), false, "jeda 30 menit antar percobaan");
  clock.t += 31 * 60_000; assert.equal(await svc.check(), false);
  clock.t += 31 * 60_000; assert.equal(await svc.check(), false);
  assert.equal(sentText.length, 1, "peringatan teks setelah gagal ke-3");
  assert.ok(/gagal/.test(sentText[0]));
  clock.t += 31 * 60_000; assert.equal(await svc.check(), false, "maks 3 percobaan per hari");
  assert.equal(sent.length, 0);
  assert.equal(st.m.has("nodin_last"), false, "gagal kirim -> penanda tidak disimpan");
  clock.t = jkt(2026, 11, 2, 7, 0); fails = 0;
  assert.equal(await svc.check(), true, "besoknya dicoba lagi dan berhasil");
}
ok("gagal kirim: jeda, maks 3x/hari, peringatan, lanjut besok");
{
  const st = mem(); st.get = async () => { throw new Error("db mati"); };
  const clock = { t: jkt(2026, 11, 1, 8, 0) };
  const { svc, sent } = await scenario(clock, st);
  assert.equal(await svc.check(), false);
  assert.equal(sent.length, 0);
  const off = createNodin({ config: { ...cfg, enabled: false }, state: mem(), sendFiles: async () => { throw new Error("jangan"); }, log: silent, now: () => jkt(2026, 11, 1, 8, 0), convert: async () => Buffer.alloc(1) });
  assert.equal(await off.check(), false);
}
ok("basis data tak terbaca / fitur mati -> tidak kirim");

// --- perintah manual & PDF gagal
{
  const clock = { t: jkt(2026, 10, 14, 10, 0) };
  const svc = createNodin({ config: cfg, state: mem(), log: silent, now: () => clock.t, convert: async () => { throw new Error("soffice rusak"); }, sendFiles: async () => {}, send: async () => {} });
  let r = await svc.compose("");
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => f.name), ["Konsep_ND_LPJ_Bendahara_September_2026.docx"], "PDF gagal -> Word saja");
  assert.ok(/PDF tidak dibuat/.test(r.text));
  r = await svc.compose("oktober");
  assert.ok(r.files[0].name.includes("Oktober_2026"));
  assert.equal((await svc.compose("ngaco")).ok, false);
  const st = await svc.compose("status");
  assert.ok(st.ok && /Jadwal/.test(st.text) && /belum pernah/.test(st.text));
  assert.ok(/AKTIF/.test(svc.describe()));
}
ok("/nodin manual, PDF gagal -> Word saja, status");


// --- Telegram: kirim dokumen + perintah /nodin
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const isForm = init?.body instanceof FormData;
    const rec = { method, form: isForm ? init.body : null, body: !isForm && init?.body ? JSON.parse(init.body) : {} };
    calls.push(rec);
    if (method === "sendDocument" && rec.form.get("caption")?.includes("TOLAK")) return { status: 400, json: async () => ({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }) };
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const svc = createNodin({ config: cfg, state: mem(), log: silent, now: () => jkt(2026, 11, 1, 9, 0), convert: async () => Buffer.from("%PDF-palsu"), sendFiles: async () => {}, send: async () => {} });
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => "x", nodin: svc }, fetchImpl: fakeFetch, log: silent });
  await tg.handleUpdate({ update_id: 1, message: { chat: { id: 111, type: "private" }, text: "/nodin" } });
  const docs = calls.filter((c) => c.method === "sendDocument");
  assert.equal(docs.length, 2, "PDF + Word terkirim");
  assert.equal(docs[0].form.get("chat_id"), "111");
  assert.equal(docs[0].form.get("document").name, "Konsep_ND_LPJ_Bendahara_Oktober_2026.pdf");
  assert.ok(docs[0].form.get("caption").includes("Oktober 2026") && docs[0].form.get("parse_mode") === "HTML");
  assert.equal(docs[1].form.get("caption"), null, "keterangan hanya di berkas pertama");
  await tg.handleUpdate({ update_id: 2, message: { chat: { id: 111, type: "private" }, text: "/nodin ngaco" } });
  assert.ok(calls.some((c) => c.method === "sendMessage" && /Tidak mengerti/.test(c.body.text)), "argumen salah dibalas teks");
  await tg.handleUpdate({ update_id: 3, message: { chat: { id: 111, type: "private" }, text: "/nodin status" } });
  assert.ok(calls.some((c) => c.method === "sendMessage" && /Jadwal/.test(c.body.text)));
  const before = calls.length;
  assert.equal(await tg.sendOwnerFiles([{ name: "a.txt", data: Buffer.from("x"), mime: "text/plain" }], "ket"), 1);
  assert.equal(calls.length, before + 1);
  const tg2 = createTelegram({ config: tcfg, deps: { chat: async () => "x" }, fetchImpl: fakeFetch, log: silent });
  await tg2.handleUpdate({ update_id: 4, message: { chat: { id: 111, type: "private" }, text: "/nodin" } });
  assert.ok(calls.at(-1).body.text.includes("belum aktif"));
  const off = createTelegram({ config: { ...tcfg, enabled: false }, deps: {}, fetchImpl: fakeFetch, log: silent });
  assert.equal(await off.sendOwnerFiles([{ name: "a", data: Buffer.from("x") }], ""), 0);
}
ok("Telegram: /nodin kirim PDF+Word, keterangan di berkas pertama, argumen salah, status, tanpa fitur, sendOwnerFiles");

// --- docxToPdf: folder kerja cadangan (LibreOffice snap tidak bisa membaca /tmp)
{
  const root = fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "nodin-tes-"));
  const bad = path.join(root, "terkurung");
  const good = path.join(root, "rumah");
  const fakeExec = async (cmd, args) => {
    const outdir = args[args.indexOf("--outdir") + 1];
    if (outdir.startsWith(good)) fs.writeFileSync(path.join(outdir, "nota.pdf"), "%PDF-ok");
    return { stdout: outdir.startsWith(bad) ? "Error: source file could not be loaded" : "", stderr: "" };
  };
  const pdf = await docxToPdf(Buffer.from("x"), { soffice: "soffice", exec: fakeExec, baseDirs: [bad, good] });
  assert.equal(pdf.toString(), "%PDF-ok", "folder pertama gagal -> folder cadangan dipakai");
  await assert.rejects(docxToPdf(Buffer.from("x"), { soffice: "soffice", exec: fakeExec, baseDirs: [bad] }), /source file could not be loaded/);
  const seen = [];
  await docxToPdf(Buffer.from("x"), { soffice: "soffice", exec: async (c, a) => { seen.push(a.some((x) => /infilter/.test(x))); const o = a[a.indexOf("--outdir") + 1]; if (seen.length === 2) fs.writeFileSync(path.join(o, "nota.pdf"), "%PDF"); return { stdout: "", stderr: "" }; }, baseDirs: [bad] });
  assert.deepEqual(seen, [false, true], "gagal -> diulang dengan penyaring Word di folder yang sama");
  await assert.rejects(docxToPdf(Buffer.from("x"), { soffice: "soffice", exec: async () => ({ stdout: "Error: no export filter for pdf", stderr: "" }), baseDirs: [bad] }), /Writer LibreOffice/);
  await assert.rejects(docxToPdf(Buffer.from("x"), { soffice: "soffice", exec: async () => { throw new Error("boom"); }, baseDirs: [bad] }), /boom/);
  assert.deepEqual(fs.readdirSync(bad), [], "folder sementara dibersihkan");
  fs.rmSync(root, { recursive: true, force: true });
}
ok("docxToPdf: folder cadangan, pesan alasan jelas, pembersihan");


// --- /nodin cek (diagnosa) dengan LibreOffice palsu
{
  const mk = (behaviour) => async (cmd, args) => {
    if (cmd === "which") return { stdout: "/usr/bin/soffice\n", stderr: "" };
    if (cmd === "dpkg") { if (behaviour.noWriter) throw new Error("dpkg: tidak ada"); return { stdout: "Package: libreoffice-writer\nStatus: install ok installed\n", stderr: "" }; }
    if (args.includes("--version")) return { stdout: "LibreOffice 7.6.4.1 60(Build:1)\n", stderr: "" };
    const outdir = args[args.indexOf("--outdir") + 1];
    const input = args.at(-1);
    if (behaviour.fail?.(input)) return { stdout: "Error: source file could not be loaded", stderr: "" };
    fs.writeFileSync(path.join(outdir, "nota.pdf"), "%PDF-ok");
    return { stdout: "", stderr: "" };
  };
  const mkSvc = (behaviour) => createNodin({ config: { ...cfg, soffice: "soffice" }, state: mem(), log: silent, exec: mk(behaviour), sendFiles: async () => {}, send: async () => {} });
  let r = await mkSvc({}).compose("cek");
  assert.ok(r.ok && /berhasil/.test(r.text) && /terpasang/.test(r.text) && /LibreOffice 7\.6/.test(r.text) && /Bot akan mengirim PDF/.test(r.text));
  r = await mkSvc({ noWriter: true, fail: () => true }).compose("cek");
  assert.ok(/gagal/.test(r.text) && /reinstall libreoffice-writer/.test(r.text) && /TIDAK terpasang/.test(r.text));
  r = await mkSvc({ fail: (i) => i.endsWith(".docx") }).compose("cek");
  assert.ok(/Teks biasa berhasil tetapi Word gagal/.test(r.text));
  const none = createNodin({ config: { ...cfg, soffice: "" }, state: mem(), log: silent, exec: async () => { throw new Error("tidak ada"); }, sendFiles: async () => {}, send: async () => {} });
  assert.ok(/tidak ditemukan/.test((await none.compose("cek")).text));
}
ok("/nodin cek: berhasil, Writer hilang, hanya Word gagal, LibreOffice tak ada");

// --- LibreOffice sungguhan bila ada (bergantung mesin: gagal hanya DICATAT, bukan menggagalkan tes)
const so = await findSoffice("");
if (so) {
  try {
    const pdf = await docxToPdf(filled, { soffice: so });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    ok(`LibreOffice (${so}) mengubah templat terisi jadi PDF ${Math.round(pdf.length / 1024)} KB`);
  } catch (e) {
    console.log(`  ! LibreOffice (${so}) ada tetapi belum bisa membuat PDF di mesin ini -- bot akan mengirim Word saja.\n    ${String(e.message).slice(0, 400)}`);
  }
} else console.log("  - LibreOffice tidak ada di mesin ini, tes PDF sungguhan dilewati");
assert.equal(await findSoffice("", async () => { throw new Error("x"); }), "");
ok("findSoffice kosong bila tak ada");

console.log(`\nSemua ${n} kelompok tes nodin lulus.`);
