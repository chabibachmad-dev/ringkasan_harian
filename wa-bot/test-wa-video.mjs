// Tes penyambung permintaan video WhatsApp (wa-video.js) dengan pesan, soket, AI, pencarian, suara, dan render PALSU. Tanpa jaringan.
//   node test-wa-video.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWaVideo } from "./wa-video.js";
import { buatAntrean, buatPembatas, konfigDariEnv } from "./motion/perintah-wa.js";
import { ambilTemplat } from "./motion/templates/index.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };

const ev = { judul: "Gunung Everest", url: "https://a.example.org/everest", teks: "Gunung Everest memiliki tinggi 8.849 meter di atas permukaan laut dan berada di pegunungan Himalaya antara Nepal dan Tiongkok." };
const ev2 = { judul: "Everest Facts", url: "https://b.example.com/facts", teks: "Mount Everest stands 8,849 m above sea level, the highest mountain on Earth, first climbed in 1953 by Hillary and Norgay." };
const baik = { ...ambilTemplat("fakta-angka").contoh, judul: "Seberapa tinggi Gunung Everest?", angka: 8849, hook: "Setinggi apa?", dasar: "Everest setinggi 8.849 meter.", sumber: [1, 2] };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wav-"));

const PEMILIK = "628111";
function setup(env = {}, over = {}) {
  const sent = [];
  const sock = { sendMessage: async (jid, content, opts) => { sent.push({ jid, content, quoted: opts?.quoted }); return { key: { id: `k${sent.length}` } }; } };
  const rec = { balasGrup: [], catat: [], cari: 0, llm: 0, render: [] };
  const wv = createWaVideo({
    konfig: konfigDariEnv(env), antrean: buatAntrean({ maksTunggu: 3 }), pembatas: buatPembatas({ selangMenit: 0, maksHarian: 3 }),
    deps: { llm: async () => { rec.llm++; return JSON.stringify(baik); }, cari: async () => { rec.cari++; return [ev, ev2]; }, tts: null },
    namaBot: () => "Ayyubi",
    adalahPemilik: (msg) => msg.key.remoteJid.startsWith(PEMILIK) || String(msg.key.participant || "").startsWith(PEMILIK),
    bagianPengirim: (msg) => [msg.key.remoteJid, msg.key.remoteJidAlt, msg.key.participant, msg.key.participantAlt].filter(Boolean).map((j) => j.split("@")[0]),
    grupBoleh: async (s, grup) => ({ boleh: over.grupBoleh ? over.grupBoleh(grup) : grup === "ok@g.us", subject: "Grup Uji" }),
    kontakDilayani: async () => over.dilayani !== false,
    balasGrup: async (s, grup, msg, subject, t) => { rec.balasGrup.push(t); },
    catatKeluarGrup: async (grup, subject, sentMsg, ket) => { rec.catat.push({ grup, ket }); },
    renderFn: async (a) => { rec.render.push(a); fs.writeFileSync(a.keluar, "mp4"); return { berkas: a.keluar, durasi: over.durasiAkhir || 22, tercapai: over.tercapai }; },
    folder: tmp, log: quiet
  });
  const pesan = (remoteJid, participant) => ({ key: { remoteJid, participant, id: "m1" } });
  return { wv, sock, sent, rec, pesan };
}
const videos = (sent) => sent.filter((x) => x.content.video);
const teks = (sent) => sent.filter((x) => x.content.text).map((x) => x.content.text);

// ---- pemilik di chat pribadi
{
  const { wv, sock, sent, pesan, rec } = setup();
  const m = pesan(`${PEMILIK}@s.whatsapp.net`);
  const r = await wv.tangani(sock, m, { teks: "buatkan video tentang Gunung Everest" });
  check(r === true && videos(sent).length === 1, "pemilik: permintaan video diterima dan video terkirim");
  check(sent.every((x) => x.jid === m.key.remoteJid && x.quoted === m), "balasan dikirim ke chat yang sama dan mengutip pesan peminta");
  check(videos(sent)[0].content.mimetype === "video/mp4" && /Seberapa tinggi/.test(videos(sent)[0].content.caption) && /Sumber:/.test(videos(sent)[0].content.caption), "video bermimetype mp4 dengan keterangan judul + sumber");
  check(rec.cari >= 1, "pencarian web dipakai untuk fakta");
  const n = sent.length;
  check((await wv.tangani(sock, m, { teks: "halo, apa kabar?" })) === false && sent.length === n, "pemilik: obrolan biasa -> false, tidak ada pesan");
  check((await wv.tangani(sock, m, { teks: "/video bantuan" })) === true && /video/i.test(teks(sent).at(-1)), "pemilik: /video bantuan -> teks bantuan");
}

// ---- durasi target
{
  const a = setup();
  await a.wv.tangani(a.sock, a.pesan(`${PEMILIK}@s.whatsapp.net`), { teks: "/video fakta Gunung Everest 30 detik" });
  check(a.rec.render.at(-1)?.durasiTarget === 30 && videos(a.sent).length === 1, "durasi: '30 detik' diteruskan ke render sebagai durasiTarget");
  await a.wv.tangani(a.sock, a.pesan(`${PEMILIK}@s.whatsapp.net`), { teks: "/video fakta Gunung Everest" });
  check(a.rec.render.at(-1)?.durasiTarget === undefined, "durasi: tanpa permintaan, tidak ada target");
  await a.wv.tangani(a.sock, a.pesan(`${PEMILIK}@s.whatsapp.net`), { teks: "/video fakta Gunung Everest 5 menit" });
  check(/disesuaikan ke 45 detik/.test(videos(a.sent).at(-1).content.caption), "durasi di luar rentang: pemohon diberi tahu disesuaikan ke 45 detik");
  const b = setup({}, { tercapai: false, durasiAkhir: 24 });
  await b.wv.tangani(b.sock, b.pesan(`${PEMILIK}@s.whatsapp.net`), { teks: "/video fakta Gunung Everest 15 detik" });
  check(/tidak bisa dicapai persis/.test(videos(b.sent).at(-1).content.caption), "durasi mustahil: keterangan jujur soal durasi akhir");
}

// ---- nomor lain ditolak / diizinkan
{
  const { wv, sock, sent, pesan } = setup();
  const m = pesan("628999@s.whatsapp.net");
  check((await wv.tangani(sock, m, { teks: "buatkan video tentang Gunung Everest" })) === true && videos(sent).length === 0 && /hanya untuk pemilik/.test(teks(sent).at(-1)), "nomor lain tanpa izin: ditolak dengan sopan, tidak ada video");

  const b = setup({ WA_VIDEO_PENGIRIM: "628999" });
  check((await b.wv.tangani(b.sock, b.pesan("628999@s.whatsapp.net"), { teks: "buatkan video tentang Gunung Everest" })) === true && videos(b.sent).length === 1, "WA_VIDEO_PENGIRIM: nomor yang didaftarkan boleh");

  const c = setup({ WA_VIDEO_SEMUA: "1" });
  check((await c.wv.tangani(c.sock, c.pesan("628777@s.whatsapp.net"), { teks: "buatkan video tentang Gunung Everest" })) === true && videos(c.sent).length === 1, "WA_VIDEO_SEMUA=1: siapa pun boleh");

  const d = setup({}, { dilayani: false });
  const r = await d.wv.tangani(d.sock, d.pesan("628999@s.whatsapp.net"), { teks: "buatkan video tentang Gunung Everest" });
  check(r === false && d.sent.length === 0, "kontak yang tidak dilayani AI (dimatikan/dijeda): tidak dibalas sama sekali");

  const e = setup({}, { dilayani: false });
  check((await e.wv.tangani(e.sock, e.pesan(`${PEMILIK}@s.whatsapp.net`), { teks: "buatkan video tentang Gunung Everest" })) === true && videos(e.sent).length === 1, "pemilik tetap dilayani walau AI kontaknya dimatikan");
}

// ---- grup
{
  const { wv, sock, sent, pesan, rec } = setup({ WA_VIDEO_GRUP: "ok@g.us" });
  const dari = (j) => pesan("ok@g.us", j);
  check((await wv.tangani(sock, dari("628999@s.whatsapp.net"), { teks: "buatkan video tentang Gunung Everest", grup: "ok@g.us", disebut: false })) === false && sent.length === 0 && rec.balasGrup.length === 0, "grup tanpa mention: diabaikan, tidak membalas");
  check((await wv.tangani(sock, dari("628999@s.whatsapp.net"), { teks: "buatkan video tentang Gunung Everest", grup: "ok@g.us", disebut: true })) === true && videos(sent).length === 1, "grup diizinkan + disebut: video terkirim ke grup");
  check(rec.catat.length === 1 && rec.catat[0].grup === "ok@g.us" && rec.balasGrup.some((t) => /sedang dibuat/.test(t)), "grup: video keluar dicatat, teks status lewat balasGrup");
  const n = sent.length;
  check((await wv.tangani(sock, dari("628999@s.whatsapp.net"), { teks: "/video fakta Gunung Everest", grup: "ok@g.us", disebut: false })) === true && videos(sent).length === 2 && sent.length > n, "grup: /video tanpa mention tetap diproses");
  check((await wv.tangani(sock, dari("628999@s.whatsapp.net"), { teks: "besok rapat jam 9 ya", grup: "ok@g.us", disebut: true })) === false, "grup: pesan bukan perintah video -> false");

  const x = setup({}, {});
  check((await x.wv.tangani(x.sock, x.pesan("lain@g.us", "628999@s.whatsapp.net"), { teks: "/video fakta Gunung Everest", grup: "lain@g.us", disebut: true })) === false && x.sent.length === 0 && x.rec.balasGrup.length === 0, "grup yang tidak diizinkan bot: tetap diam");

  const y = setup({}, {});
  await y.wv.tangani(y.sock, y.pesan("ok@g.us", "628999@s.whatsapp.net"), { teks: "/video fakta Gunung Everest", grup: "ok@g.us", disebut: true });
  check(videos(y.sent).length === 0 && y.rec.balasGrup.some((t) => /hanya untuk pemilik/.test(t)), "grup diizinkan bot tapi tidak ada di WA_VIDEO_GRUP: anggota ditolak");

  const z = setup({}, {});
  await z.wv.tangani(z.sock, z.pesan("ok@g.us", `${PEMILIK}@s.whatsapp.net`), { teks: "/video fakta Gunung Everest", grup: "ok@g.us", disebut: false });
  check(videos(z.sent).length === 1, "grup: pemilik boleh tanpa daftar");
}

// ---- antrean dan pembatas dipakai bersama (satu instans untuk dua akun)
{
  const antrean = buatAntrean({ maksTunggu: 3 }), pembatas = buatPembatas({ selangMenit: 0, maksHarian: 1 });
  const bikin = () => {
    const sent = [];
    const sock = { sendMessage: async (jid, content) => { sent.push(content); return { key: { id: "k" } }; } };
    const wv = createWaVideo({
      konfig: konfigDariEnv({ WA_VIDEO_SEMUA: "1" }), antrean, pembatas, deps: { llm: async () => JSON.stringify(baik), cari: async () => [ev, ev2], tts: null }, namaBot: () => "x",
      adalahPemilik: () => false, bagianPengirim: (m) => [m.key.remoteJid.split("@")[0]], grupBoleh: async () => ({ boleh: true }), kontakDilayani: async () => true,
      balasGrup: async () => {}, renderFn: async (a) => { fs.writeFileSync(a.keluar, "mp4"); return { berkas: a.keluar, durasi: 20 }; }, folder: tmp, log: quiet
    });
    return { wv, sock, sent };
  };
  const a = bikin(), b = bikin();
  const m = { key: { remoteJid: "628555@s.whatsapp.net", id: "i" } };
  await a.wv.tangani(a.sock, m, { teks: "buatkan video tentang Gunung Everest" });
  await b.wv.tangani(b.sock, m, { teks: "buatkan video tentang Gunung Everest" });
  check(a.sent.some((c) => c.video) && !b.sent.some((c) => c.video) && b.sent.some((c) => /Jatahmu hari ini sudah habis/.test(c.text || "")), "pembatas dipakai bersama akun utama dan akun kedua");
}

console.log(fails ? `\n${fails} GAGAL` : "\nsemua lolos");
process.exit(fails ? 1 : 0);
