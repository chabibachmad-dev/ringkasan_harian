// Tes penyambung gambar stok ke pesan WhatsApp (wa-gambar.js) dengan dependensi palsu.   node test-wa-gambar.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createWaGambar } from "./wa-gambar.js";
import { buatAntrean } from "./motion/perintah-wa.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const unwrap = (m) => m;
const JID = "6281@s.whatsapp.net";
function mk(over = {}) {
  const rec = { panggil: [], unduh: [], sent: [], grupTeks: [] };
  const sock = { sendMessage: async (jid, content, opt) => { rec.sent.push({ jid, content, opt }); return {}; } };
  const antrean = buatAntrean();
  const f = createWaGambar({
    unwrap, antrean, env: over.env || {},
    unduh: async (sumber) => { rec.unduh.push(sumber); return over.buf || Buffer.from("x"); },
    adalahPemilik: () => over.pemilik !== false,
    grupBoleh: async () => ({ boleh: over.grupBoleh !== false, subject: "Grup Uji" }),
    balasGrup: async (s, g, m, sub, t) => rec.grupTeks.push(t),
    ...(over.nyata ? {} : { tangani: async (o) => { rec.panggil.push(o); return true; } })
  });
  return { f, rec, sock, antrean };
}
const msgFoto = (caption) => ({ key: { remoteJid: JID, id: "A1" }, message: { imageMessage: { caption, mimetype: "image/jpeg" } } });
const msgDok = (caption, mimetype = "image/jpeg", fileName = "pantai.jpg") => ({ key: { remoteJid: JID, id: "A2" }, message: { documentMessage: { caption, mimetype, fileName } } });
const msgTeks = (t, quoted) => ({ key: { remoteJid: JID, id: "A3" }, message: { extendedTextMessage: { text: t, contextInfo: quoted ? { stanzaId: "Q1", participant: "62@s.whatsapp.net", quotedMessage: quoted } : undefined } } });

{ // foto + keterangan
  const { f, rec, sock, antrean } = mk();
  const r = await f(sock, msgFoto("upscale"), { teks: "[gambar] upscale" });
  const o = rec.panggil[0];
  check(r === true && o.teks === "upscale" && o.adaGambar === true && o.adalahPemilik === true && o.namaBerkas === "foto.jpg", "foto + keterangan: teks = caption, adaGambar, nama bawaan foto.jpg");
  check(o.antrean === antrean, "antrean sama dengan yang disuntikkan (dipakai render video)");
  await o.unduhGambar(); check(rec.unduh[0].key.id === "A1", "unduhGambar mengunduh pesan itu");
  check(o.konfig.izinSemua === false, "WA_GAMBAR_SEMUA kosong -> izinSemua false");
}
{ // dokumen gambar
  const { f, rec, sock } = mk({ env: { WA_GAMBAR_SEMUA: "1" } });
  await f(sock, msgDok("cek shutterstock"), { teks: "[dokumen] pantai.jpg" });
  const o = rec.panggil[0];
  check(o.teks === "cek shutterstock" && o.adaGambar && o.namaBerkas === "pantai.jpg" && o.konfig.izinSemua === true, "dokumen image/*: caption sebagai teks, fileName, WA_GAMBAR_SEMUA=1");
}
{ // dokumen bukan gambar
  const { f, rec, sock } = mk();
  const r = await f(sock, msgDok("upscale", "application/pdf", "a.pdf"), { teks: "[dokumen] a.pdf" });
  check(r === false && rec.panggil.length === 0, "dokumen PDF diabaikan (teks '[dokumen] a.pdf' bukan perintah)");
}
{ // teks biasa dengan perintah, tanpa gambar
  const { f, rec, sock } = mk();
  await f(sock, msgTeks("upscale"), { teks: "upscale" });
  check(rec.panggil[0].adaGambar === false && rec.panggil[0].unduhGambar === undefined, "teks 'upscale' tanpa gambar: adaGambar false (bot membalas petunjuk)");
  await f(sock, msgTeks("/stok bantuan"), { teks: "/stok bantuan" });
  check(rec.panggil[1].teks === "/stok bantuan", "'/stok bantuan' diteruskan");
  rec.panggil.length = 0;
  const r = await f(sock, msgTeks("selamat pagi"), { teks: "selamat pagi" });
  check(r === false && rec.panggil.length === 0, "obrolan biasa tidak diteruskan");
}
{ // membalas (quote) gambar / dokumen gambar
  const { f, rec, sock } = mk();
  await f(sock, msgTeks("upscale", { imageMessage: { mimetype: "image/jpeg" } }), { teks: "upscale" });
  const o = rec.panggil[0];
  check(o.adaGambar === true, "membalas gambar: adaGambar true");
  await o.unduhGambar();
  check(rec.unduh[0].key.id === "Q1" && rec.unduh[0].key.participant === "62@s.whatsapp.net", "mengunduh gambar yang DIKUTIP, bukan pesan pembalas");
  await f(sock, msgTeks("upscale", { documentMessage: { mimetype: "image/png", fileName: "x.png" } }), { teks: "upscale" });
  check(rec.panggil[1].adaGambar && rec.panggil[1].namaBerkas === "x.png", "membalas dokumen gambar: nama berkas dari dokumen");
  await f(sock, msgTeks("upscale", { documentMessage: { mimetype: "application/pdf", fileName: "x.pdf" } }), { teks: "upscale" });
  check(rec.panggil[2].adaGambar === false, "membalas PDF: bukan gambar");
}
{ // grup
  const a = mk();
  await a.f(a.sock, msgFoto("/stok"), { teks: "/stok", grup: "123@g.us", disebut: true });
  check(a.rec.panggil[0].grup === "123@g.us" && a.rec.panggil[0].disebut === true, "grup: jid & disebut diteruskan");
  await a.rec.panggil[0].kirimTeks("halo");
  check(a.rec.grupTeks[0] === "halo" && a.rec.sent.length === 0, "balasan grup lewat balasGrup (dicatat)");
  const b = mk({ grupBoleh: false });
  const r = await b.f(b.sock, msgFoto("upscale"), { teks: "upscale", grup: "123@g.us" });
  check(r === false && b.rec.panggil.length === 0, "grup tidak diizinkan: diabaikan");
}
{ // kirim teks & dokumen ke JID asal dengan quoted
  const { f, rec, sock } = mk();
  const m = msgFoto("upscale");
  await f(sock, m, { teks: "x" });
  const o = rec.panggil[0];
  await o.kirimTeks("Siap");
  const tmp = path.join(os.tmpdir(), `wg-${Date.now()}.jpg`); fs.writeFileSync(tmp, "jpgdata");
  await o.kirimDokumen(tmp, "foto_stok.jpg", "ket"); fs.unlinkSync(tmp);
  const [t, d] = rec.sent;
  check(t.jid === JID && t.content.text === "Siap" && t.opt.quoted === m, "kirimTeks: ke JID asal, mengutip pesan asli");
  check(d.jid === JID && d.content.mimetype === "image/jpeg" && d.content.fileName === "foto_stok.jpg" && d.content.caption === "ket" && Buffer.isBuffer(d.content.document) && d.opt.quoted === m, "kirimDokumen: document buffer, image/jpeg, fileName, caption, quoted");
}
{ // ujung ke ujung dengan modul asli (non-pemilik ditolak; pemilik dapat dokumen)
  const ff = spawnSync("ffmpeg", ["-version"]).status === 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-"));
  const img = path.join(dir, "k.jpg");
  if (ff) spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1600x1200:d=1", "-frames:v", "1", "-q:v", "2", img]);
  const buf = ff ? fs.readFileSync(img) : null;
  const tolak = mk({ pemilik: false, nyata: true });
  await tolak.f(tolak.sock, msgFoto("upscale"), { teks: "x" });
  check(/hanya untuk pemilik/.test(tolak.rec.sent[0]?.content.text || ""), "non-pemilik tanpa WA_GAMBAR_SEMUA: ditolak sopan");
  if (ff) {
    const ok = mk({ buf, nyata: true });
    ok.f && await ok.f(ok.sock, msgFoto("upscale"), { teks: "x" });
    const dok = ok.rec.sent.find((s) => s.content.document);
    check(!!dok && dok.content.fileName === "foto_stok.jpg" && dok.content.document.length > 1000, "pemilik: dokumen JPEG hasil upscale terkirim");
  }
}
console.log(fails ? `\n${fails} GAGAL` : "\nsemua lolos");
process.exit(fails ? 1 : 0);
