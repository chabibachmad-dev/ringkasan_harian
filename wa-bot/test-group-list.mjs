// Tes daftar grup yang bisa diubah dari Telegram (/grup). Jalankan: node test-group-list.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { STATE_KEY, createGroupList, parseGroupArg } from "./group-list.js";
import { normalizeGroupName } from "./wa-accounts.js";
import { createTelegram } from "./telegram.js";

let n = 0;
async function ok(name, fn) {
  await fn();
  n += 1;
  console.log(`ok: ${name}`);
}
const silent = { log() {}, warn() {}, error() {} };
const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
};
const GROUPS = {
  main: [{ id: "111@g.us", subject: "Keluarga Besar 🌿" }, { id: "222@g.us", subject: "Arisan RT 05" }, { id: "333@g.us", subject: "Alumni SMA" }],
  wa2: [{ id: "444@g.us", subject: "Kantor Wongso" }, { id: "555@g.us", subject: "Pengajian" }]
};
const make = (over = {}) => {
  const st = over.state || mem();
  const gl = createGroupList({
    state: st,
    env: { main: { names: ["keluargabesar"], jids: [] }, wa2: { names: [], jids: [] } },
    labels: { main: "Nomor utama", wa2: "Wongsobot" },
    secondEnabled: true,
    listGroups: async (a) => (over.down?.includes(a) ? null : GROUPS[a]),
    log: silent,
    ...over.extra
  });
  return { gl, st };
};

await ok("parse: status, semua, tambah, hapus, nomor kedua (wa2 / nama bot), galat", () => {
  assert.deepEqual(parseGroupArg(""), { kind: "status" });
  assert.deepEqual(parseGroupArg("semua"), { kind: "all", account: "main" });
  assert.deepEqual(parseGroupArg("semua wa2"), { kind: "all", account: "wa2" });
  assert.deepEqual(parseGroupArg("tambah Arisan RT 05"), { kind: "add", account: "main", arg: "Arisan RT 05" });
  assert.deepEqual(parseGroupArg("tambah wa2 Kantor Wongso"), { kind: "add", account: "wa2", arg: "Kantor Wongso" });
  assert.deepEqual(parseGroupArg("tambah wongsobot 2", { secondAliases: ["Wongsobot"] }), { kind: "add", account: "wa2", arg: "2" });
  assert.deepEqual(parseGroupArg("hapus 3"), { kind: "remove", account: "main", arg: "3" });
  assert.deepEqual(parseGroupArg("wa2"), { kind: "status", account: "wa2" });
  assert.equal(parseGroupArg("tambah").kind, "error");
  assert.equal(parseGroupArg("lompat").kind, "error");
  assert.equal(parseGroupArg("TAMBAH x").kind, "add");
});

await ok("aturan efektif: .env + tambahan, tiap nomor terpisah", async () => {
  const { gl } = make();
  assert.deepEqual(gl.rules("main"), { enabled: true, names: ["keluargabesar"], jids: [] });
  assert.equal(gl.rules("wa2").enabled, false);
  await gl.handle("tambah Arisan RT");
  await gl.handle("tambah wa2 Pengajian");
  assert.deepEqual(gl.rules("main").names, ["keluargabesar", "arisanrt"]);
  assert.deepEqual(gl.rules("wa2").names, ["pengajian"]);
  assert.equal(gl.rules("wa2").enabled, true);
});

await ok("tambah lewat nomor dari /grup semua (disimpan sebagai id grup), tanpa daftar dulu = diminta", async () => {
  const { gl, st } = make();
  assert.match(await gl.handle("tambah 2"), /Jalankan dulu \/grup semua/);
  const t = await gl.handle("semua");
  assert.match(t, /1\. Alumni SMA/, "terurut abjad");
  assert.match(t, /Keluarga Besar.*✅/, "grup dari .env bertanda");
  assert.match(await gl.handle("tambah 2"), /Arisan RT 05/);
  assert.deepEqual(gl.rules("main").jids, ["222@g.us"]);
  assert.match(await gl.handle("tambah 2"), /sudah dijawab/);
  assert.match(await gl.handle("tambah 9"), /Tidak ada grup nomor 9/);
  assert.equal(JSON.parse(st.m.get(STATE_KEY)).main.jids[0], "222@g.us");
});

await ok("tambah lewat nama: cocok-memuat, peringatan bila tak ada yang cocok, nama terlalu pendek ditolak", async () => {
  const { gl } = make();
  assert.match(await gl.handle("tambah Alumni"), /Cocok dengan: "Alumni SMA"/);
  assert.match(await gl.handle("tambah Tidak Ada Grup Ini"), /Belum ada grup.*tetap disimpan/);
  assert.match(await gl.handle("tambah ab"), /terlalu pendek/);
  assert.match(await gl.handle("tambah alumni"), /sudah ada/);
  const { gl: g2 } = make({ down: ["main"] });
  assert.match(await g2.handle("tambah Alumni"), /menjawab di grup yang namanya memuat/, "nomor terputus: tetap tersimpan tanpa pemeriksaan");
});

await ok("hapus: lewat nomor status atau nama; entri .env tidak bisa dihapus; entri tak ada", async () => {
  const { gl } = make();
  await gl.handle("tambah Alumni");
  assert.match(await gl.handle("hapus 1"), /Lihat daftar dulu/);
  const s = await gl.handle("");
  assert.match(s, /1\. keluargabesar \(\.env/);
  assert.match(s, /2\. Alumni/);
  assert.match(await gl.handle("hapus 1"), /berasal dari \.env/);
  assert.match(await gl.handle("hapus 2"), /dicabut/);
  assert.deepEqual(gl.rules("main").names, ["keluargabesar"]);
  assert.match(await gl.handle("hapus Tidak Ada"), /Tidak ada/);
  await gl.handle("tambah Pengajian");
  assert.match(await gl.handle("hapus pengajian"), /dicabut/);
});

await ok("muat ulang dari penyimpanan; nomor kedua mati menolak perintah wa2", async () => {
  const st = mem();
  const a = make({ state: st }).gl;
  await a.handle("tambah Arisan RT");
  await a.handle("tambah wa2 Pengajian");
  const b = make({ state: st }).gl;
  await b.load();
  assert.deepEqual(b.rules("main").names, ["keluargabesar", "arisanrt"]);
  assert.deepEqual(b.rules("wa2").names, ["pengajian"]);
  const single = createGroupList({ state: mem(), env: {}, secondEnabled: false, log: silent });
  assert.match(await single.handle("tambah wa2 Pengajian"), /belum dinyalakan/);
});

await ok("keamanan data: gagal membaca daftar tersimpan -> perubahan ditunda, tidak menimpa; pulih setelah database kembali", async () => {
  const st = mem({ [STATE_KEY]: JSON.stringify({ main: { names: ["Lama Penting"], jids: [] }, wa2: { names: [], jids: [] } }) });
  let broken = true;
  const strict = { get: async (k) => { if (broken) throw new Error("db mati"); return st.m.get(k) ?? null; }, set: st.set };
  const { gl } = make({ state: strict });
  await gl.load(); // gagal (db mati)
  assert.match(await gl.handle("tambah Baru Sekali"), /ditunda/);
  assert.equal(JSON.parse(st.m.get(STATE_KEY)).main.names[0], "Lama Penting", "data lama utuh");
  broken = false;
  assert.match(await gl.handle("tambah Baru Sekali"), /menjawab di grup/);
  assert.deepEqual(JSON.parse(st.m.get(STATE_KEY)).main.names, ["Lama Penting", "Baru Sekali"]);
  // gagal menyimpan: tetap berlaku sementara + peringatan
  const noSave = { get: async () => null, set: async () => { throw new Error("db mati"); } };
  const { gl: g3 } = make({ state: noSave });
  const t = await g3.handle("tambah Sementara");
  assert.match(t, /sampai bot restart/);
  assert.ok(g3.rules("main").names.includes("sementara"));
});

await ok("Telegram: /grup dikenali sebagai perintah dan dijawab dari daftar", async () => {
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ method: String(url).split("/").pop(), body: init?.body && !(init.body instanceof FormData) ? JSON.parse(init.body) : {} });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const { gl } = make();
  let chat = 0;
  const tcfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: tcfg, deps: { chat: async () => { chat += 1; return "x"; }, groups: { handle: (a) => gl.handle(a, { secondAliases: ["Wongsobot"] }) } }, fetchImpl: fakeFetch, log: silent });
  const say = async (text, id) => { await tg.handleUpdate({ update_id: id, message: { chat: { id: 111, type: "private" }, text } }); return sent.filter((c) => c.method === "sendMessage").at(-1).body.text; };
  assert.match(await say("/grup", 1), /Grup yang dijawab/);
  assert.match(await say("/grup tambah wongsobot Pengajian", 2), /Wongsobot sekarang menjawab/);
  assert.equal(gl.rules("wa2").enabled, true);
  assert.equal(chat, 0, "tidak diteruskan ke AI");
});

await ok("index.js memakai daftar gabungan untuk tiap pesan grup", () => {
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /groupList\.rules\(sock\?\.waAccount\?\.secondary \? SECOND_ACCOUNT : MAIN_ACCOUNT\)/);
  assert.match(src, /groupRulesFor\(sock\)\.enabled/);
  assert.match(src, /groups: \{ handle: \(arg\) => groupList\.handle/);
  assert.equal(normalizeGroupName("Keluarga Besar 🌿"), "keluargabesar");
});

console.log(`\nSemua ${n} kelompok tes daftar grup lulus.`);
