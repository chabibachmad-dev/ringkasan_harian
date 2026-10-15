// Dukungan NOMOR WHATSAPP KEDUA (satu bot, dua nomor).
//
// Nomor utama ("main") berjalan persis seperti sebelumnya. Nomor kedua ("wa2") adalah sesi Baileys terpisah
// (folder login sendiri) dan HANYA aktif bila WA2_ENABLED=true atau WA2_NUMBER diisi di .env.
//
// Aturan nomor kedua (karena HP-nya biasanya dipegang orang lain):
//   - Perintah pemilik (/kas, /nodin, /dokumen, simab, dll.) hanya dari nomor pemilik (WA_OWNER_NUMBER) -- chat-ke-diri-sendiri
//     di nomor kedua diabaikan, jadi pemegang HP-nya tidak bisa membuka data pemilik lewat bot.
//   - Notifikasi bot untuk pemilik tetap lewat nomor utama / Telegram (bukan dari nomor kedua).
//   - Grup memakai daftar sendiri (WA2_GROUP_ALLOWED_NAMES / WA2_GROUP_ALLOWED_JIDS); kosong = nomor kedua tidak menjawab di grup.
//   - Percakapan nomor kedua TIDAK ikut ringkasan harian pemilik kecuali WA2_IN_SUMMARY=true.
//   - Riwayat disimpan di tabel whatsapp_messages dengan kolom `account` = "wa2" (lihat migrasi 0039).
//
// .env (semua opsional):
//   WA2_ENABLED=true               nyalakan nomor kedua (otomatis true bila WA2_NUMBER diisi)
//   WA2_NUMBER=0812xxxxxxx         nomor itu, dipakai membuat KODE TAUTAN (tanpa scan QR); "0"/"8" di depan otomatis jadi 62
//   WA2_LABEL=Nomor 2              nama di pesan status
//   WA2_AUTH_DIR=auth_session_2    folder sesi login nomor kedua
//   WA2_GROUP_ALLOWED_NAMES=...    grup yang dijawab nomor kedua (pisah koma, sama aturannya dengan WA_GROUP_ALLOWED_NAMES)
//   WA2_GROUP_ALLOWED_JIDS=...
//   WA2_IN_SUMMARY=false           true = chat nomor kedua ikut ringkasan harian ke pemilik

export const MAIN_ACCOUNT = "main";
export const SECOND_ACCOUNT = "wa2";

export function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits;
}

export function normalizeGroupName(name) {
  return String(name ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const truthy = (v, d = false) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return d;
  return !["false", "0", "no", "off", "tidak"].includes(s);
};

/** -> { enabled, id, label, number, authDir, groupNames[], groupJids[], inSummary } */
export function readSecondAccountConfig(env = process.env) {
  const number = normalizePhone(env.WA2_NUMBER);
  const enabled = env.WA2_ENABLED === undefined || String(env.WA2_ENABLED).trim() === "" ? Boolean(number) : truthy(env.WA2_ENABLED);
  const label = String(env.WA2_LABEL || "").trim() || "Nomor 2";
  const authDir = String(env.WA2_AUTH_DIR || "").trim() || "auth_session_2";
  const split = (v) => String(v || "").split(",");
  return {
    enabled,
    id: SECOND_ACCOUNT,
    label,
    number,
    authDir,
    groupNames: split(env.WA2_GROUP_ALLOWED_NAMES).map(normalizeGroupName).filter(Boolean),
    groupJids: split(env.WA2_GROUP_ALLOWED_JIDS).map((x) => x.trim()).filter(Boolean),
    inSummary: truthy(env.WA2_IN_SUMMARY, false)
  };
}

/** Tambahan kolom untuk baris whatsapp_messages: nomor utama tidak menambah apa pun (tetap jalan walau migrasi belum dijalankan). */
export function acctFields(accountId) {
  return accountId && accountId !== MAIN_ACCOUNT ? { account: accountId } : {};
}

/** Format kode tautan 8 huruf "ABCD1234" -> "ABCD-1234". */
export function formatPairingCode(code) {
  const c = String(code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Teks petunjuk untuk pemegang HP nomor kedua. */
export function pairingInstructions({ label, code }) {
  return (
    `🔗 Kode tautan ${label}: ${formatPairingCode(code)}\n\n` +
    "Di HP nomor itu: WhatsApp → ⋮ / Pengaturan → Perangkat Tertaut → Tautkan Perangkat → " +
    "\"Tautkan dengan nomor telepon\" (di bagian bawah layar scan) → masukkan kode di atas.\n" +
    "Kode berlaku beberapa menit saja. Kalau kedaluwarsa, kirim /wa2 kode untuk minta yang baru."
  );
}

/**
 * Pencari "jid ini ditangani nomor yang mana". Pesan masuk selalu menandai jid -> akun; untuk baris antrean dari aplikasi
 * (yang tidak tahu akun) dipakai pesan terakhir di jid itu.
 * deps: { supabase, log }
 */
export function createAccountRouter({ supabase = null, log = console } = {}) {
  const known = new Map(); // jid -> accountId

  function remember(jid, accountId) {
    if (jid) known.set(jid, accountId || MAIN_ACCOUNT);
  }

  /** -> accountId ("main" bila tidak diketahui / kolom account belum ada). */
  async function accountOf(jid) {
    if (!jid) return MAIN_ACCOUNT;
    const hit = known.get(jid);
    if (hit) return hit;
    let found = MAIN_ACCOUNT;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("whatsapp_messages")
          .select("account")
          .eq("wa_jid", jid)
          .neq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1);
        if (!error && data?.[0]?.account) found = data[0].account;
      } catch (e) {
        log.warn?.(`Gagal cek nomor untuk ${jid}: ${e instanceof Error ? e.message : e}`);
      }
    }
    known.set(jid, found);
    return found;
  }

  return { remember, accountOf, size: () => known.size };
}
