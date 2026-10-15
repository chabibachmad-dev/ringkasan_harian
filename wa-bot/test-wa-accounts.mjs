// Tes nomor WhatsApp kedua: konfigurasi, penanda akun, perutean jid -> akun, dan aturan keamanan di index.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTelegram } from "./telegram.js";
import { qrMatrix, qrToPng } from "./qr-png.js";
import zlib from "node:zlib";
import { MAIN_ACCOUNT, SECOND_ACCOUNT, acctFields, createAccountRouter, formatPairingCode, isPairedCreds, isStalePairing, normalizePhone, pairingInstructions, personaPrompt, readSecondAccountConfig } from "./wa-accounts.js";

let failed = 0;
const src0 = () => fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
async function t(name, fn) {
  try {
    await fn();
    console.log(`ok: ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL: ${name}\n   ${e instanceof Error ? e.message : e}`);
  }
}

await t("konfigurasi: mati bawaan", () => {
  const c = readSecondAccountConfig({});
  assert.equal(c.enabled, false);
  assert.equal(c.authDir, "auth_session_2");
  assert.equal(c.label, "Nomor 2");
  assert.equal(c.inSummary, false);
  assert.deepEqual(c.groupNames, []);
});
await t("konfigurasi: WA2_NUMBER menyalakan, nomor dinormalkan", () => {
  assert.equal(readSecondAccountConfig({ WA2_NUMBER: "0812-3456-7890" }).number, "6281234567890");
  assert.equal(readSecondAccountConfig({ WA2_NUMBER: "0812-3456-7890" }).enabled, true);
  assert.equal(readSecondAccountConfig({ WA2_NUMBER: "81234567890" }).number, "6281234567890");
  assert.equal(readSecondAccountConfig({ WA2_NUMBER: "+62 812 3456 7890" }).number, "6281234567890");
  assert.equal(normalizePhone(""), null);
});
await t("konfigurasi: WA2_ENABLED=false mematikan walau nomor diisi; true tanpa nomor tetap hidup", () => {
  assert.equal(readSecondAccountConfig({ WA2_NUMBER: "0812", WA2_ENABLED: "false" }).enabled, false);
  assert.equal(readSecondAccountConfig({ WA2_ENABLED: "true" }).enabled, true);
});
await t("konfigurasi: grup, label, folder, ringkasan", () => {
  const c = readSecondAccountConfig({ WA2_GROUP_ALLOWED_NAMES: "Keluarga Besar, Arisan RT 05", WA2_GROUP_ALLOWED_JIDS: "123@g.us ,456@g.us", WA2_LABEL: "HP Ibu", WA2_AUTH_DIR: "sesi_ibu", WA2_IN_SUMMARY: "true" });
  assert.deepEqual(c.groupNames, ["keluargabesar", "arisanrt05"]);
  assert.deepEqual(c.groupJids, ["123@g.us", "456@g.us"]);
  assert.equal(c.label, "HP Ibu");
  assert.equal(c.authDir, "sesi_ibu");
  assert.equal(c.inSummary, true);
});
await t("nama bot nomor kedua: WA2_NAME mengisi label & nama persona; prompt diganti hanya bila diisi", () => {
  const c = readSecondAccountConfig({ WA2_NUMBER: "0812", WA2_NAME: "Wongsobot" });
  assert.equal(c.label, "Wongsobot");
  assert.equal(c.botName, "Wongsobot");
  assert.equal(readSecondAccountConfig({ WA2_NAME: "Wongsobot", WA2_LABEL: "HP Ibu" }).label, "HP Ibu");
  assert.equal(readSecondAccountConfig({ WA2_NUMBER: "0812" }).botName, "");
  const p = "Namamu Ayyubi: asisten. Perkenalkan dirimu sebagai Ayyubi, asisten AI.";
  assert.equal(personaPrompt(p, "Wongsobot"), "Namamu Wongsobot: asisten. Perkenalkan dirimu sebagai Wongsobot, asisten AI.");
  assert.equal(personaPrompt(p, ""), p);
  assert.match(src0(), /personaPrompt\(basePrompt, wa2Config\.botName\)/);
});
await t("acctFields: nomor utama tidak menambah kolom (jalan tanpa migrasi)", () => {
  assert.deepEqual(acctFields(MAIN_ACCOUNT), {});
  assert.deepEqual(acctFields(undefined), {});
  assert.deepEqual(acctFields(SECOND_ACCOUNT), { account: "wa2" });
});
await t("kode tautan: format dan petunjuk", () => {
  assert.equal(formatPairingCode("abcd1234"), "ABCD-1234");
  assert.equal(formatPairingCode("ABCD-1234"), "ABCD-1234");
  const txt = pairingInstructions({ label: "Nomor 2", code: "ABCD1234" });
  assert.match(txt, /ABCD-1234/);
  assert.match(txt, /Tautkan dengan nomor telepon/);
  assert.match(txt, /\/wa2 kode/);
});

function fakeSupabase(rows, { failColumn = false } = {}) {
  const calls = [];
  const q = {
    select() { return q; },
    eq() { return q; },
    neq() { return q; },
    order() { return q; },
    limit() { calls.push("q"); return Promise.resolve(failColumn ? { data: null, error: { message: "column whatsapp_messages.account does not exist" } } : { data: rows, error: null }); }
  };
  return { from: () => q, calls };
}

await t("router: jid dari pesan masuk diingat", async () => {
  const r = createAccountRouter({ supabase: null });
  r.remember("a@s.whatsapp.net", "wa2");
  assert.equal(await r.accountOf("a@s.whatsapp.net"), "wa2");
  assert.equal(await r.accountOf("zzz@s.whatsapp.net"), MAIN_ACCOUNT);
});
await t("router: jid baru dicari dari pesan terakhir di database lalu di-cache", async () => {
  const sb = fakeSupabase([{ account: "wa2" }]);
  const r = createAccountRouter({ supabase: sb });
  assert.equal(await r.accountOf("b@s.whatsapp.net"), "wa2");
  assert.equal(await r.accountOf("b@s.whatsapp.net"), "wa2");
  assert.equal(sb.calls.length, 1);
});
await t("router: kolom account belum ada -> nomor utama (tidak melempar)", async () => {
  const r = createAccountRouter({ supabase: fakeSupabase(null, { failColumn: true }) });
  assert.equal(await r.accountOf("c@s.whatsapp.net"), MAIN_ACCOUNT);
});
await t("router: pesan berikutnya dari nomor lain mengubah perutean", async () => {
  const r = createAccountRouter({ supabase: null });
  r.remember("d@s.whatsapp.net", "main");
  r.remember("d@s.whatsapp.net", "wa2");
  assert.equal(await r.accountOf("d@s.whatsapp.net"), "wa2");
});

await t("sesi: sisa tautan tak selesai (ada me, belum ada account) dikenali basi", () => {
  assert.equal(isStalePairing({ me: { id: "62812@s.whatsapp.net", name: "~" } }), true);
  assert.equal(isStalePairing({ me: { id: "62812:3@s.whatsapp.net" }, account: { details: "x" } }), false);
  assert.equal(isStalePairing({}), false);
  assert.equal(isStalePairing(undefined), false);
  assert.equal(isPairedCreds({ account: {} }), true);
  assert.equal(isPairedCreds({ me: { id: "x" }, registered: true }), false);
});

await t("Telegram: /wa2 dan /wa2 kode dikenali sebagai perintah (nama perintah boleh berisi angka), bukan diteruskan ke AI", async () => {
  const sent = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    sent.push({ method, body: init?.body && !(init.body instanceof FormData) ? JSON.parse(init.body) : {} });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  let chatCalls = 0;
  let codeCalls = 0;
  const wa2 = { describe: () => "STATUS-NOMOR-2", code: async () => { codeCalls += 1; return "KODE-ABCD-1234"; } };
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => { chatCalls += 1; return "jawaban AI"; }, wa2 }, fetchImpl: fakeFetch, log: { log() {}, warn() {}, error() {} } });
  const say = async (text, id) => { await tg.handleUpdate({ update_id: id, message: { chat: { id: 111, type: "private" }, text } }); return sent.filter((c) => c.method === "sendMessage").at(-1).body.text; };
  assert.match(await say("/wa2", 1), /STATUS-NOMOR-2/);
  assert.match(await say("/wa2 kode", 2), /KODE-ABCD-1234/);
  assert.equal(codeCalls, 1);
  assert.equal(chatCalls, 0, "tidak boleh sampai ke AI");
  wa2.code = async () => { throw new Error("WA2_NUMBER belum diisi"); };
  assert.match(await say("/wa2 kode", 3), /WA2_NUMBER belum diisi/);
});

// ---- aturan keamanan di index.js (pemeriksaan teks sumber) ----
const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
await t("keamanan: chat-ke-diri-sendiri di nomor kedua diabaikan sebelum perintah pemilik", () => {
  const i = src.indexOf("if (isSelfChat && sock.waAccount?.secondary) return;");
  assert.ok(i > 0, "guard tidak ada");
  assert.ok(i < src.indexOf("await handleOwnOutgoing(msg, sock, jid)"), "guard harus di depan handleOwnOutgoing");
  assert.ok(i < src.indexOf("handleWaKasCommand(sock, jid, text)"), "guard harus di depan perintah pemilik");
});
await t("keamanan: notifikasi pemilik dari nomor kedua lewat nomor utama/Telegram", () => {
  assert.match(src, /sock\?\.waAccount\?\.secondary\) \{\s+await sendToOwner\(/);
});
await t("riwayat: semua penyimpanan pesan menandai akun", () => {
  const inserts = src.match(/from\("whatsapp_messages"\)\.insert\(\{/g) || [];
  const tagged = src.match(/\.\.\.acctFields\(currentAccountId\(\)\)/g) || [];
  assert.equal(tagged.length, inserts.length, `insert=${inserts.length} bertanda=${tagged.length}`);
});
await t("logout berulang: sesi basi dibuang saat start & tidak menyambung ulang tanpa henti", () => {
  assert.match(src, /isStalePairing\(loaded\.state\.creds\)/);
  assert.match(src, /wipeAuthDir\(acct\.authDir\)/);
  assert.match(src, /acct\.secondary && !paired/);
  assert.match(src, /acct\.idle = true/);
});
await t("kode tautan: hanya SATU kode per koneksi (kode baru membatalkan kode lama)", () => {
  assert.match(src, /if \(!sock\.pairCodeAsked && !acct\.pairing/);
  assert.match(src, /sock\.pairCodeAsked = true;\s+acct\.autoCodes/);
  assert.match(src, /if \(\(acct\.autoCodes \|\| 0\) >= 1 \|\| loggedOut\)/);
});
await t("QR PNG: tanda PNG valid, ukuran sesuai, isi piksel = matriks QR", () => {
  const text = "2@abcDEF123,xyz/456+7890=,AbCdEfGhIjKlMnOpQrStUvWxYz0123456789,qwertyuiopasdfghjkl==";
  const png = qrToPng(text, { scale: 3, margin: 4 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const m = qrMatrix(text);
  const size = (m.length + 8) * 3;
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
  // ambil IDAT dan cocokkan beberapa piksel dengan matriks
  let pos = 8; let idat = Buffer.alloc(0);
  while (pos < png.length) { const len = png.readUInt32BE(pos); const type = png.toString("ascii", pos + 4, pos + 8); if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(pos + 8, pos + 8 + len)]); pos += 12 + len; }
  const raw = zlib.inflateSync(idat);
  assert.equal(raw.length, (1 + size) * size);
  for (const [r, c] of [[0, 0], [0, 1], [3, 5], [m.length - 1, m.length - 1], [10, 20]]) {
    const px = raw[(r * 3 + 12) * (1 + size) + 1 + (c * 3 + 12)];
    assert.equal(px, m[r][c] ? 0 : 255, `modul ${r},${c}`);
  }
  assert.equal(raw[1], 255, "tepi putih (margin)");
});
await t("Telegram: /wa2 qr mengirim foto (bukan dokumen), galat ditampilkan", async () => {
  const sent = [];
  const fakeFetch = async (url, init) => {
    const method = String(url).split("/").pop();
    sent.push({ method, body: init?.body && !(init.body instanceof FormData) ? JSON.parse(init.body) : {} });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const wa2 = { describe: () => "S", code: async () => "K", qr: async () => ({ data: qrToPng("hello"), name: "qr-nomor-2.png", mime: "image/png", photo: true }) };
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => "x", wa2 }, fetchImpl: fakeFetch, log: { log() {}, warn() {}, error() {} } });
  await tg.handleUpdate({ update_id: 1, message: { chat: { id: 111, type: "private" }, text: "/wa2 qr" } });
  assert.ok(sent.some((c) => c.method === "sendPhoto"), "harus sendPhoto");
  assert.ok(!sent.some((c) => c.method === "sendDocument"));
  wa2.qr = async () => { throw new Error("QR belum muncul"); };
  await tg.handleUpdate({ update_id: 2, message: { chat: { id: 111, type: "private" }, text: "/wa2 qr" } });
  assert.match(sent.filter((c) => c.method === "sendMessage").at(-1).body.text, /QR belum muncul/);
});
await t("grup: nomor kedua memakai daftar WA2 sendiri", () => {
  assert.match(src, /groupRulesFor\(sock\)\.enabled/);
  assert.match(src, /isGroupAllowed\(groupJid, subject, sock\)/);
});
await t("ringkasan harian: nomor kedua tidak ikut kecuali WA2_IN_SUMMARY", () => {
  assert.match(src, /if \(!wa2Config\.inSummary\) rows = /);
});

if (failed) {
  console.log(`\n${failed} GAGAL`);
  process.exit(1);
}
console.log("\nsemua ok");
