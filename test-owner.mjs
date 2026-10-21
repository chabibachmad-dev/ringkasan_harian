// Tes pengenalan pemilik nomor oleh bot (grup & chat pribadi). Jalankan: node test-owner.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { OWNER_ASKER_NOTE, OWNER_CLAIM_NOTE, OWNER_DEFLECT_FALLBACK, deflectsToOwner, senderLabel } from "./capabilities.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;

assert.equal(senderLabel("Abu", true), "Abu (pemilik)");
assert.equal(senderLabel("Budi", false), "Budi");
ok("label pengirim: hanya pemilik bertanda (pemilik)");

assert.match(OWNER_ASKER_NOTE, /PEMILIK NOMOR SEDANG BERBICARA/);
assert.match(OWNER_ASKER_NOTE, /JANGAN menjawab "pesan diterima dan akan disampaikan ke pemilik nomor"/);
assert.match(OWNER_ASKER_NOTE, /TIDAK berlaku terhadap pemilik/);
assert.match(OWNER_ASKER_NOTE, /jangan mengarang fakta/);
assert.match(OWNER_CLAIM_NOTE, /BUKAN pemilik/);
assert.match(OWNER_CLAIM_NOTE, /mengaku sebagai pemilik/);
ok("catatan prompt: pemilik tidak dijawab 'disampaikan ke pemilik'; klaim palsu orang lain tidak dipercaya");

for (const r of ["Pesan diterima dan akan disampaikan ke pemilik nomor.", "Nanti pemilik nomor akan membalas langsung ya", "Akan ditindaklanjuti langsung oleh pemilik.", "Pesannya kuteruskan kepada pemilik", "Pemilik akan segera menghubungi kamu"])
  assert.equal(deflectsToOwner(r), true, r);
for (const r of ["Saldo kas Rp 5 juta.", "Aku asisten milik pemilik nomor ini.", "Rapat besok jam 9, pemilik ruangan sudah setuju."])
  assert.equal(deflectsToOwner(r), false, r);
assert.equal(deflectsToOwner(OWNER_DEFLECT_FALLBACK), false);
ok("pendeteksi jawaban 'disampaikan ke pemilik' (benar & tidak salah tangkap)");

const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
// awalan "Nama (pemilik): " harus tetap terbuang oleh perapian pencarian (regex stripGroupMeta)
const strip = (t) => t.replace(/\n\(mengutip:[\s\S]*$/, "").replace(/^[^:\n]{1,40}:\s+/, "");
assert.equal(strip("Abu (pemilik): berapa saldo kas?"), "berapa saldo kas?");
assert.ok(src.includes('return text.replace(/\\n\\(mengutip:[\\s\\S]*$/, "").replace(/^[^:\\n]{1,40}:\\s+/, "");'), "stripGroupMeta di index.js belum berubah (regex yang dites di atas)");
ok("awalan '(pemilik)' tidak mengganggu pencarian dokumen/web");

const grp = src.slice(src.indexOf("async function handleGroupMessage"), src.indexOf("async function deliverAutoReplyVoice"));
assert.ok(grp.includes("const ownerAsker = isOwnerSender(msg, false)"), "grup: pemilik dikenali dari id pengirim");
assert.ok(grp.includes("senderLabel(sender, ownerAsker)"), "grup: riwayat menandai ucapan pemilik");
assert.ok(grp.includes("flags.ownerAsker = ownerAsker"), "grup: AI diberi tahu pengirimnya pemilik");
assert.ok(grp.includes("ownerAsker && deflectsToOwner(result.reply)"), "grup: jawaban melempar ke pemilik ditulis ulang");
assert.ok(grp.includes("WA_OWNER_LIDS=<id di atas>"), "log membantu bila pemilik tampil sebagai id @lid");
const wgn = src.slice(src.indexOf("function withGroupNote"), src.indexOf("function stripGroupMeta"));
assert.ok(/if \(!isGroupJid\(jid\)\) return `\$\{base\}\$\{ownerNote\}`/.test(wgn), "chat pribadi dari pemilik juga mendapat catatan");
assert.ok(wgn.includes("${ownerNote || OWNER_CLAIM_NOTE}"), "grup: catatan pemilik, atau peringatan klaim palsu untuk orang lain");
assert.ok(src.includes("st.ownerAsker = isOwnerSender(msg, isSelfChat)"), "chat pribadi: penanda pemilik di konteks pesan");
ok("index.js: grup & chat pribadi tersambung");

console.log(`\nSemua ${n} kelompok tes pengenalan pemilik lulus ✅`);
