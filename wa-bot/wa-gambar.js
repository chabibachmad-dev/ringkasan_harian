// Penyambung media/gambar-stok.js (tanganiGambarWa) ke pesan WhatsApp: foto, dokumen bertipe gambar, atau gambar yang dibalas (quote).
// Semua yang bergantung pada index.js disuntikkan, supaya bisa diuji dengan pesan palsu.
import fs from "node:fs";
import { tanganiGambarWa, kenaliPerintahGambar } from "./media/gambar-stok.js";

/**
 * @param {object} o  unwrap(message), unduh(sumber, sock) -> Buffer, adalahPemilik(msg, selfChat), grupBoleh(sock, grup) -> {boleh, subject},
 *                    balasGrup(sock, grup, msg, subject, teks), antrean (SAMA dengan render video), env, log
 */
export function createWaGambar({ unwrap, unduh, adalahPemilik, grupBoleh = async () => ({ boleh: false, subject: "" }), balasGrup = async () => {}, antrean = null, env = process.env, log = console, folder, tangani = tanganiGambarWa }) {
  const gambarDoc = (d) => (d && /^image\//i.test(d.mimetype || "") ? d : null);
  /** true = pesan sudah ditangani (hentikan pemrosesan). */
  return async function tanganiGambarStok(sock, msg, { teks, grup = null, disebut = false, isSelfChat = false } = {}) {
    const content = unwrap(msg.message) || {};
    const jid = msg.key.remoteJid;
    const own = content.imageMessage || gambarDoc(content.documentMessage) || null;
    const perintah = own ? String(own.caption ?? "").replace(/\s+/g, " ").trim() : String(teks ?? "").replace(/^\[(?:gambar|dokumen)\]\s*/i, "");
    if (!kenaliPerintahGambar(perintah)) return false; // murah: bukan perintah, jangan lanjut
    let subject = "";
    if (grup) {
      const g = await grupBoleh(sock, grup);
      if (!g.boleh) return false;
      subject = g.subject || "";
    }
    let sumber = null, namaBerkas = "foto.jpg";
    if (own) { sumber = { key: msg.key, message: content }; namaBerkas = own.fileName || "foto.jpg"; }
    else {
      const ctx = content.extendedTextMessage?.contextInfo || null;
      const q = ctx?.quotedMessage ? unwrap(ctx.quotedMessage) : null;
      const qm = q ? q.imageMessage || gambarDoc(q.documentMessage) : null;
      if (qm) { sumber = { key: { remoteJid: jid, id: ctx.stanzaId, participant: ctx.participant }, message: q }; namaBerkas = qm.fileName || "foto.jpg"; }
    }
    return tangani({
      teks: perintah, adalahPemilik: adalahPemilik(msg, grup ? false : isSelfChat), grup, disebut, adaGambar: Boolean(sumber), namaBerkas,
      unduhGambar: sumber ? () => unduh(sumber, sock) : undefined,
      kirimTeks: async (t) => {
        if (grup) await balasGrup(sock, grup, msg, subject, t);
        else await sock.sendMessage(jid, { text: t }, { quoted: msg }).catch((e) => log.error?.("🖼️ Gagal kirim balasan gambar:", e instanceof Error ? e.message : String(e)));
      },
      kirimDokumen: async (berkas, namaFile, keterangan) => {
        await sock.sendMessage(jid, { document: fs.readFileSync(berkas), mimetype: "image/jpeg", fileName: namaFile, caption: keterangan }, { quoted: msg });
      },
      antrean, folder, konfig: { izinSemua: env.WA_GAMBAR_SEMUA === "1" }
    });
  };
}
