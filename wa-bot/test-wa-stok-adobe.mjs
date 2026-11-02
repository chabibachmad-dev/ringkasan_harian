// Tes penyambung /adobe ke pesan WhatsApp (wa-stok-adobe.js) dengan dependensi palsu dan folder sementara.   node test-wa-stok-adobe.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createWaStokAdobe, mimeBerkas, tanggalZona } from "./wa-stok-adobe.js";
import { buatAntrean } from "./motion/perintah-wa.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const JID = "6281@s.whatsapp.net", GRUP = "123-456@g.us";
const venv = new URL("../.venv-stok/bin/python", import.meta.url).pathname;
const py = process.env.STOK_PYTHON || (fs.existsSync(venv) ? venv : "python3");
const adaPy = spawnSync(py, ["-c", "import pathops"]).status === 0;

function mk(over = {}) {
  const rec = { sent: [], grupTeks: [], panggil: [] };
  const sock = { sendMessage: async (jid, content, opt) => { rec.sent.push({ jid, content, opt }); return {}; } };
  const f = createWaStokAdobe({
    llm: async () => "bukan json", // metadata AI gagal -> katalog bawaan
    adalahPemilik: () => over.pemilik !== false,
    grupBoleh: async () => ({ boleh: over.grupBoleh !== false, subject: "Grup Uji" }),
    balasGrup: async (s, g, m, sub, t) => rec.grupTeks.push(t),
    antrean: buatAntrean(), folder: over.folder, env: over.env || { STOK_PYTHON: py, WA_ADOBE_MAKS_PEKAN: "2" },
    ...(over.palsu ? { tangani: async (o) => { rec.panggil.push(o); return true; } } : {})
  });
  return { f, rec, sock };
}
const pesan = (jid = JID) => ({ key: { remoteJid: jid, id: "ABC" }, message: {} });
const kirim = (m, teks, o = {}) => m.f(m.sock, pesan(o.grup || JID), { teks, ...o });

// pembantu
check(mimeBerkas("a.zip") === "application/zip" && mimeBerkas("b.PNG") === "image/png" && mimeBerkas("c.bin") === "application/octet-stream", "mime berkas");
check(/^\d{4}-\d{2}-\d{2}$/.test(tanggalZona()) && tanggalZona("Asia/Jakarta", new Date("2026-11-01T18:00:00Z")) === "2026-11-02", "tanggal WIB");

// bukan /adobe -> tidak ditangani, penangan inti tidak dipanggil
{
  const m = mk({ palsu: true });
  check((await kirim(m, "halo apa kabar")) === false && (await kirim(m, "buatkan video")) === false && (await kirim(m, undefined)) === false, "pesan non-/adobe tidak ditangani");
  check(m.rec.panggil.length === 0 && m.rec.sent.length === 0, "non-/adobe: tidak ada panggilan/pengiriman");
}
// argumen yang diteruskan ke tanganiStokWa
{
  const m = mk({ palsu: true, folder: "/tmp/x", env: { STOK_PYTHON: "/p/python", WA_ADOBE_MAKS_PEKAN: "5" } });
  const r = await kirim(m, "/adobe bantuan");
  const o = m.rec.panggil[0];
  check(r === true && o.chatId === JID && o.adalahPemilik === true && o.python === "/p/python" && o.konfig.maksPekan === 5 && o.folder === "/tmp/x" && typeof o.deps.llm === "function" && /^\d{4}-\d{2}-\d{2}$/.test(o.tanggal) && o.antrean, "argumen diteruskan (chatId, pemilik, python, maksPekan, folder, llm, antrean, tanggal)");
  const m2 = mk({ palsu: true, env: {} }); await kirim(m2, "/adobe riwayat");
  check(m2.rec.panggil[0].konfig.maksPekan === 2 && m2.rec.panggil[0].python === undefined, "bawaan: maksPekan 2, python tidak diatur");
}
// bukan-pemilik ditolak (DM) dan dibisukan di grup
{
  const m = mk({ pemilik: false });
  check((await kirim(m, "/adobe ikon 3d ramadan 1")) === true, "DM bukan-pemilik: ditangani (ditolak)");
  check(m.rec.sent.length === 1 && /hanya untuk pemilik/.test(m.rec.sent[0].content.text) && m.rec.sent.every((s) => !s.content.document), "DM bukan-pemilik: hanya teks penolakan");
  const g = mk({ pemilik: false });
  check((await kirim(g, "/adobe bantuan", { grup: GRUP })) === false && g.rec.sent.length === 0 && g.rec.grupTeks.length === 0, "grup bukan-pemilik: tidak dijawab");
}
// grup: pemilik boleh, balasan lewat balasGrup; grup tak diizinkan -> diabaikan
{
  const m = mk(); 
  check((await kirim(m, "/adobe bantuan", { grup: GRUP })) === true && m.rec.grupTeks.length === 1 && m.rec.sent.length === 0, "grup pemilik: balasan lewat balasGrup");
  const n = mk({ grupBoleh: false });
  check((await kirim(n, "/adobe bantuan", { grup: GRUP })) === false && n.rec.grupTeks.length === 0, "grup tidak diizinkan: diabaikan");
}
// alur penuh: rencana -> setuju -> satu zip + satu pratinjau
if (!adaPy) console.log("python/skia-pathops tidak ada: tes alur penuh dilewati");
else {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "adobe-wa-"));
  try {
    const m = mk({ folder });
    check((await kirim(m, "/adobe setuju")) === true && /Tidak ada rencana/.test(m.rec.sent.at(-1).content.text), "setuju tanpa rencana ditolak");
    m.rec.sent.length = 0;
    check((await kirim(m, "/adobe ikon 3d ramadan 1 paksa")) === true, "perintah rencana ditangani");
    check(m.rec.sent.length === 1 && m.rec.sent[0].content.text && !m.rec.sent[0].content.document, "rencana dikirim sebagai teks, belum ada berkas");
    m.rec.sent.length = 0;
    check((await kirim(m, "/adobe setuju")) === true, "setuju ditangani");
    const dok = m.rec.sent.filter((s) => s.content.document), gbr = m.rec.sent.filter((s) => s.content.image);
    check(dok.length === 1 && dok[0].content.mimetype === "application/zip" && /\.zip$/.test(dok[0].content.fileName) && dok[0].content.document.length > 1000, "satu zip terkirim");
    check(gbr.length === 1 && gbr[0].content.image.length > 1000 && /Pratinjau/.test(gbr[0].content.caption), "satu pratinjau gambar terkirim");
    check(m.rec.sent.every((s) => s.jid === JID && s.opt?.quoted?.key?.id === "ABC"), "semua dikirim ke JID asal dengan quoted");
    const rw = JSON.parse(fs.readFileSync(path.join(folder, "riwayat.json"), "utf8"));
    check(rw.paket.length === 1 && rw.paket[0].ikon3d.length === 1, "riwayat.json mencatat satu ikon 3D");
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}
console.log(fails ? `\n${fails} GAGAL` : "\nsemua tes lolos");
process.exit(fails ? 1 : 0);
