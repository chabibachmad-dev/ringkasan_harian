// Tes nomor WhatsApp kedua: konfigurasi, penanda akun, perutean jid -> akun, dan aturan keamanan di index.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import { MAIN_ACCOUNT, SECOND_ACCOUNT, acctFields, createAccountRouter, formatPairingCode, normalizePhone, pairingInstructions, readSecondAccountConfig } from "./wa-accounts.js";

let failed = 0;
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
