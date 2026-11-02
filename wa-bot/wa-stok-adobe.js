// Penyambung stok-adobe/stok-adobe.js (tanganiStokWa) ke pesan WhatsApp: perintah /adobe (hanya pemilik).
// Semua yang bergantung pada index.js disuntikkan, supaya bisa diuji dengan pesan palsu.
import fs from "node:fs";
import path from "node:path";
import { tanganiStokWa, kenaliPerintahStok } from "./stok-adobe/stok-adobe.js";

const MIME = { ".zip": "application/zip", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".csv": "text/csv", ".svg": "image/svg+xml" };
export const mimeBerkas = (berkas) => MIME[path.extname(String(berkas)).toLowerCase()] || "application/octet-stream";
/** Tanggal hari ini (YYYY-MM-DD) di zona waktu tertentu. */
export const tanggalZona = (tz = "Asia/Jakarta", d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: tz });

/**
 * @param {object} o  llm(prompt)->string, adalahPemilik(msg, selfChat), grupBoleh(sock, grup)->{boleh, subject}, balasGrup(sock, grup, msg, subject, teks),
 *                    antrean (SAMA dengan render video dan gambar stok), folder (data bot, di luar git), env, tz, log, tangani
 */
export function createWaStokAdobe({ llm, adalahPemilik, grupBoleh = async () => ({ boleh: false, subject: "" }), balasGrup = async () => {}, antrean = null, folder, env = process.env, tz = "Asia/Jakarta", log = console, tangani = tanganiStokWa }) {
  /** true = pesan sudah ditangani (hentikan pemrosesan). */
  return async function tanganiStok(sock, msg, { teks, grup = null, disebut = false, isSelfChat = false } = {}) {
    if (!kenaliPerintahStok(teks)) return false; // murah: bukan /adobe, jangan lanjut
    const jid = msg.key.remoteJid;
    const pemilik = Boolean(adalahPemilik(msg, grup ? false : isSelfChat));
    let subject = "";
    if (grup) {
      if (!pemilik) return false; // di grup: non-pemilik tidak dijawab sama sekali
      const g = await grupBoleh(sock, grup);
      if (!g.boleh) return false;
      subject = g.subject || "";
    }
    const aman = (nama) => (e) => log.error?.(`🎨 Gagal kirim ${nama} Adobe:`, e instanceof Error ? e.message : String(e));
    return tangani({
      teks, chatId: jid, adalahPemilik: pemilik, grup, disebut, deps: { llm },
      kirimTeks: async (t) => {
        if (grup) await balasGrup(sock, grup, msg, subject, t);
        else await sock.sendMessage(jid, { text: t }, { quoted: msg }).catch(aman("balasan"));
      },
      kirimDokumen: async (berkas, namaFile, keterangan) => {
        await sock.sendMessage(jid, { document: fs.readFileSync(berkas), mimetype: mimeBerkas(berkas), fileName: namaFile, caption: keterangan }, { quoted: msg });
      },
      kirimGambar: async (berkas, nama, keterangan) => {
        await sock.sendMessage(jid, { image: fs.readFileSync(berkas), caption: keterangan }, { quoted: msg });
      },
      antrean, folder,
      konfig: { maksPekan: Number(env.WA_ADOBE_MAKS_PEKAN || 2) },
      python: env.STOK_PYTHON || undefined,
      tanggal: tanggalZona(tz)
    });
  };
}
