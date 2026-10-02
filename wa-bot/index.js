// Bot WhatsApp (pakai Baileys -- library TIDAK RESMI yang bicara langsung
// ke protokol WhatsApp Web, tanpa Puppeteer/browser) buat fitur "WhatsApp di
// dalam aplikasi" di Ringkasan Harian.
//
// KENAPA INI SKRIP TERPISAH, BUKAN EDGE FUNCTION?
// Supabase Edge Function itu stateless & cuma hidup sebentar per-request --
// tidak bisa dipakai buat pegang satu koneksi WebSocket ke WhatsApp yang
// harus tetap nyambung 24 jam. Makanya bot ini WAJIB jalan sebagai proses
// Node.js yang hidup terus-menerus (lihat README.md buat cara jalaninnya +
// cara biar auto-restart kalau laptop di-reboot).
//
// ALUR KERJANYA (lihat juga komentar di migrations/0011_whatsapp_messages.sql):
//   1. Login SEKALI lewat scan QR code (sesi disimpan di folder
//      auth_session/, otomatis dipakai lagi tiap bot di-restart -- TIDAK
//      perlu scan ulang kecuali folder itu dihapus atau sesi di-logout dari
//      HP).
//   2. Pesan WhatsApp MASUK -> langsung disimpan ke tabel whatsapp_messages
//      (Supabase) lewat service_role key.
//   3. Tiap beberapa detik (POLL_INTERVAL_MS), bot CEK tabel whatsapp_messages
//      nyari baris status='pending' (ini dibikin sama Edge Function
//      `whatsapp` action "send", waktu user balas chat dari aplikasi) ->
//      beneran dikirim lewat WhatsApp -> status diupdate jadi 'sent' atau
//      'failed'.
//
// CATATAN PENTING soal nomor WA yang dipakai di sini: karena ini BUKAN
// WhatsApp Business API resmi, nomor yang di-scan QR di sini sebaiknya
// nomor KHUSUS buat bot ini (bukan nomor yang masih aktif dipakai manual di
// HP), karena begitu sesi dipegang Baileys, pemakaian manual bersamaan di
// app WhatsApp biasa bisa bikin salah satu sisi ke-logout/bentrok.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 4000;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set. Salin .env.example jadi .env lalu isi dulu.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Dipakai loop pengirim (setInterval di bawah) -- selalu nunjuk ke socket
// WhatsApp yang LAGI AKTIF, diupdate ulang tiap kali connect()/reconnect
// bikin socket baru (lihat connection.update di bawah).
let currentSock = null;

// Ambil teks dari berbagai tipe pesan WhatsApp yang umum. Tipe yang tidak
// dikenali (voice note, lokasi, kontak dibagikan, dll) sengaja DILEWATI
// (return null) drpd nyimpen data kosong/rusak -- cukup buat v1 fitur ini.
function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[gambar] ${m.imageMessage.caption}`;
  if (m.videoMessage?.caption) return `[video] ${m.videoMessage.caption}`;
  if (m.documentMessage?.fileName) return `[dokumen] ${m.documentMessage.fileName}`;
  if (m.audioMessage) return "[pesan suara/audio -- belum didukung, buka HP buat dengar]";
  if (m.stickerMessage) return "[stiker]";
  return null;
}

async function handleIncoming(msg) {
  // Pesan yang KITA kirim sendiri (fromMe) juga muncul lewat event ini --
  // sudah dicatat duluan waktu diproses dari antrian "pending" (lihat
  // processPendingOutgoing), jadi di sini cukup dilewati supaya tidak dobel.
  if (msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  // v1 cuma dukung chat PERSONAL (bukan grup/status/broadcast) -- biar
  // scope-nya jelas dulu, grup bisa menyusul kalau memang dibutuhkan nanti.
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return;

  const text = extractText(msg);
  if (!text) return;

  const { error } = await supabase.from("whatsapp_messages").insert({
    wa_jid: jid,
    wa_name: msg.pushName || null,
    direction: "in",
    content: text,
    status: "received",
    wa_message_id: msg.key.id
  });
  if (error) {
    // Kode 23505 = unique violation (wa_message_id sudah ada) -- ini AMAN
    // diabaikan, biasa terjadi kalau bot sempat reconnect dan WhatsApp
    // mengirim ulang event pesan yang sama.
    if (error.code !== "23505") {
      console.error("Gagal simpan pesan masuk:", error.message);
    }
    return;
  }
  console.log(`📩 Pesan masuk dari ${jid}${msg.pushName ? ` (${msg.pushName})` : ""}: ${text.slice(0, 60)}`);
}

async function processPendingOutgoing(sock) {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, wa_jid, content")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    console.error("Gagal ambil antrian pesan keluar:", error.message);
    return;
  }

  for (const row of data ?? []) {
    try {
      const sent = await sock.sendMessage(row.wa_jid, { text: row.content });
      await supabase
        .from("whatsapp_messages")
        .update({ status: "sent", wa_message_id: sent?.key?.id ?? null, error: null })
        .eq("id", row.id);
      console.log(`📤 Terkirim ke ${row.wa_jid}: ${row.content.slice(0, 60)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Gagal kirim ke ${row.wa_jid}:`, msg);
      await supabase.from("whatsapp_messages").update({ status: "failed", error: msg }).eq("id", row.id);
    }
  }
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    // "silent" -- Baileys defaultnya CEREWET BANGET kalau logger-nya aktif
    // (nge-log tiap paket protokol WhatsApp). Ganti ke level "info" cuma
    // kalau lagi debug masalah koneksi.
    logger: pino({ level: "silent" }),
    browser: ["Ringkasan Harian Bot", "Chrome", "1.0.0"]
  });

  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n=== Scan QR code ini pakai HP ===");
      console.log("WhatsApp di HP > Perangkat Tertaut > Tautkan Perangkat\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      currentSock = null;
      if (loggedOut) {
        console.error(
          "\n❌ Sesi WhatsApp logout/dicabut dari HP (atau sesi tidak valid lagi).\n" +
            "   Hapus folder wa-bot/auth_session/ lalu jalankan ulang bot ini untuk scan QR baru.\n"
        );
      } else {
        console.warn("⚠️  Koneksi WhatsApp putus, coba sambung ulang dalam 5 detik...");
        setTimeout(connect, 5000);
      }
    } else if (connection === "open") {
      console.log(`\n✅ WhatsApp tersambung (${sock.user?.id || "?"}). Bot siap jalan.\n`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // type "notify" = pesan baru beneran masuk (bukan hasil sinkronisasi
    // riwayat lama waktu pertama kali login).
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await handleIncoming(msg);
      } catch (err) {
        console.error("Gagal proses satu pesan masuk:", err instanceof Error ? err.message : String(err));
      }
    }
  });
}

connect().catch((err) => {
  console.error("Gagal mulai koneksi WhatsApp:", err);
  process.exit(1);
});

setInterval(() => {
  if (currentSock) {
    processPendingOutgoing(currentSock).catch((err) => {
      console.error("Loop kirim pesan error:", err instanceof Error ? err.message : String(err));
    });
  }
}, POLL_INTERVAL_MS);

// Jaga-jaga: bot ini harus jalan LAMA tanpa diawasi -- jangan sampai mati
// total cuma gara-gara satu error tak terduga yang tidak ketangkep try/catch
// di atas. Dicatat ke log biar ketahuan, tapi proses dibiarkan tetap hidup.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (bot tetap jalan):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (bot tetap jalan):", err);
});
