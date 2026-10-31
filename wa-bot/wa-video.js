// Penyambung permintaan video motion graphic (motion/perintah-wa.js) ke penangan pesan WhatsApp bot.
// Semua hal yang bergantung pada index.js (pemilik, grup diizinkan, kirim pesan) disuntikkan, supaya bisa diuji dengan pesan palsu.
import fs from "node:fs";
import { kenaliPerintah, tanganiPesanWa } from "./motion/perintah-wa.js";

/**
 * @param {object} o
 *  konfig, antrean, pembatas, deps {llm,cari,tts}   : seperti tanganiPesanWa
 *  namaBot()                                        : nama bot untuk akun yang sedang memproses
 *  adalahPemilik(msg, isSelfChat)                   : bool
 *  bagianPengirim(msg)                              : [jid, jidAlt, peserta, pesertaAlt] bagian nomor/LID
 *  grupBoleh(sock, grup)                            : async -> { boleh, subject }
 *  kontakDilayani(msg)                              : async -> bool (kontak pribadi non-pemilik hanya dibalas bila AI melayaninya)
 *  balasGrup(sock, grup, msg, subject, teks)        : kirim teks ke grup + catat
 *  catatKeluarGrup(grup, subject, sent, keterangan) : catat video keluar di grup
 *  renderFn, folder                                 : hanya untuk tes
 */
export function createWaVideo({ konfig, antrean, pembatas, deps, namaBot = () => "", adalahPemilik, bagianPengirim, grupBoleh, kontakDilayani, balasGrup, catatKeluarGrup = async () => {}, renderFn, folder, log = console }) {
  /** true = pesan sudah ditangani sebagai permintaan video (jangan diproses lagi). grup = jid grup atau null; disebut = bot dipanggil. */
  async function tangani(sock, msg, { teks, grup = null, disebut = false, isSelfChat = false }) {
    const nama = namaBot();
    if (!kenaliPerintah(teks, { namaBot: nama })) return false;
    const jid = msg.key.remoteJid;
    const pemilik = adalahPemilik(msg, grup ? false : isSelfChat);
    let subject = "";
    if (grup) {
      const g = await grupBoleh(sock, grup);
      if (!g.boleh) return false; // grup yang tidak dijawab bot: tetap diabaikan
      subject = g.subject || "";
    } else if (!pemilik && !(await kontakDilayani(msg))) {
      return false; // kontak yang tidak dilayani AI (dimatikan/dijeda): jangan dibalas
    }
    const ids = bagianPengirim(msg);
    const pengirim = ids.find((x) => konfig.izinPengirim.includes(x)) || (grup ? ids[2] || ids[0] : ids[0]) || "";
    const kirimTeks = async (t) => {
      if (grup) return void (await balasGrup(sock, grup, msg, subject, t));
      await sock.sendMessage(jid, { text: t }, { quoted: msg }).catch((e) => log.error?.("🎬 Gagal kirim balasan video:", e instanceof Error ? e.message : String(e)));
    };
    const kirimVideo = async (berkas, keterangan) => {
      const sent = await sock.sendMessage(jid, { video: fs.readFileSync(berkas), caption: keterangan, mimetype: "video/mp4" }, { quoted: msg });
      if (grup) await catatKeluarGrup(grup, subject, sent, keterangan);
    };
    log.log?.(`🎬 [WA] permintaan video motion dari ${pengirim || "?"}${grup ? ` di grup "${subject || grup}"` : ""}: ${String(teks).slice(0, 80)}`);
    return tanganiPesanWa({ teks, pengirim, adalahPemilik: pemilik, grup, disebut, deps, kirimTeks, kirimVideo, antrean, pembatas, konfig, namaBot: nama, renderFn, folder });
  }
  return { tangani };
}
