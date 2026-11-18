// Menautkan ulang NOMOR UTAMA lewat Telegram (/wa1 qr), tanpa terminal di laptop.
//
// Latar belakang: bila sesi nomor utama logout/dicabut dari HP, Baileys tidak bisa menyambung lagi dan QR baru hanya dicetak di
// terminal laptop. Modul ini (tanpa dependensi berat, mudah diuji) menyimpan sesi lama dengan AMAN (diganti nama, TIDAK dihapus),
// memulai sesi baru, dan mengubah QR-nya menjadi gambar untuk dikirim ke Telegram -- sama seperti /wa2 qr untuk nomor kedua.
//
// Keadaan (acct = objek akun utama di index.js; field yang dipakai: loggedOutAt, relinkAt, lastQr):
//   tersambung      -> WhatsApp terbuka; tidak ada yang perlu dilakukan
//   logout          -> sesi dicabut (loggedOutAt terisi); /wa1 qr boleh memulai sesi baru
//   menunggu-pindai -> sesi baru sedang menampilkan QR (relinkAt lebih baru dari loggedOutAt)
//   menyambung      -> putus biasa, belum logout; TIDAK boleh menyentuh sesi (bisa pulih sendiri)

export function relinkState(acct, open) {
  if (open) return "tersambung";
  if (acct.relinkAt && acct.relinkAt > (acct.loggedOutAt || 0)) return "menunggu-pindai";
  if (acct.loggedOutAt) return "logout";
  return "menyambung";
}

export const QR_CAPTION =
  "QR penautan NOMOR UTAMA (Ayyubi). Di HP nomor utama: WhatsApp → Perangkat Tertaut → Tautkan Perangkat → pindai QR ini dari HP/laptop LAIN (bukan dari HP yang sama). " +
  "Kalau bot lama masih tercantum di Perangkat Tertaut, keluarkan dulu. Jangan bagikan QR ini ke siapa pun. QR berlaku ±1 menit; kalau gagal kirim /wa1 qr lagi.";

/**
 * deps: { acct, isOpen(): bool, userId(): string|null, startConnect(): Promise, moveAuthDir(): string|null, qrToPng(qr): Promise<Buffer>,
 *         now?, wait?, maxWaitMs?, log? }
 */
export function createMainRelink({ acct, isOpen, userId = () => null, startConnect, moveAuthDir, qrToPng, now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)), maxWaitMs = 30_000, log = console }) {
  let busy = false;

  function describe() {
    const st = relinkState(acct, isOpen());
    const who = userId();
    if (st === "tersambung") return `✅ Nomor utama tersambung${who ? ` (${who})` : ""}. Tidak perlu ditautkan ulang.`;
    if (st === "logout") {
      return [
        "❌ Nomor utama (Ayyubi) logout / dicabut dari WhatsApp. Restart saja tidak cukup; harus ditautkan ulang dengan QR.",
        "",
        "/wa1 qr — buat QR baru (sesi lama disimpan, tidak dihapus)",
        "Pindai dari HP nomor utama memakai layar HP/laptop lain."
      ].join("\n");
    }
    if (st === "menunggu-pindai") return "⏳ Sesi baru sedang menunggu QR dipindai. Kirim /wa1 qr untuk gambar QR terbaru.";
    return "⚠️ Nomor utama sedang menyambung ulang dan belum tercatat logout. Tunggu 1–2 menit lalu kirim /wa1 lagi. Kalau tetap begitu, coba /restart.";
  }

  async function qr() {
    const st = relinkState(acct, isOpen());
    if (st === "tersambung") throw new Error("Nomor utama sudah tersambung; tidak perlu ditautkan ulang.");
    if (st === "menyambung") throw new Error("Nomor utama belum tercatat logout (hanya menyambung ulang). Tunggu 1–2 menit lalu kirim /wa1 lagi; kalau statusnya menjadi logout, baru /wa1 qr. Sesi tidak disentuh.");
    if (st === "logout") {
      if (busy) throw new Error("Sedang menyiapkan sesi baru; coba lagi beberapa detik lagi.");
      busy = true;
      try {
        const moved = moveAuthDir();
        if (moved) log.log?.(`🔗 [Nomor utama] sesi lama disimpan sebagai ${moved}; memulai sesi baru untuk QR.`);
        acct.lastQr = null;
        acct.relinkAt = now();
        Promise.resolve(startConnect()).catch((err) => log.error?.("Gagal memulai sesi baru nomor utama:", err instanceof Error ? err.message : String(err)));
      } finally {
        busy = false;
      }
    }
    const start = now();
    for (;;) {
      if (isOpen()) throw new Error("Nomor utama sudah tersambung.");
      if (acct.lastQr && now() - acct.lastQr.at < 15_000) break;
      if (now() - start > maxWaitMs) throw new Error("QR belum muncul dari WhatsApp (koneksi internet laptop mungkin lambat). Coba /wa1 qr lagi.");
      await wait(500);
    }
    return qrToPng(acct.lastQr.qr);
  }

  return { describe, qr };
}
