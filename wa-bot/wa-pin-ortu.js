// PIN orang tua Study (supabase/migrations/0044): sisi bot.
//  1) Pendaftaran nomor WA orang tua: pesan pribadi berisi kode "PIN-123456" (dibuat di aplikasi) -> nomor pengirim dicatat
//     sebagai study_parents.wa_jid, lalu bot membalas konfirmasi. Hanya nomor utama, hanya chat pribadi.
//  2) Reset darurat pemilik (/resetpin <nama> di Telegram): membuat kode reset 6 digit yang dikirim ke pemilik.
// Fungsi kode (findWaCode, hashWaCode, hashResetCode) SENGAJA diduplikasi dari supabase/functions/_shared/study-core.ts
// (bot tidak memuat berkas .ts); test-wa-pin-ortu.mjs memastikan hasilnya sama.
import crypto from "node:crypto";

export const WA_CODE_TTL_MS = 30 * 60 * 1000;
export const RESET_TTL_MS = 15 * 60 * 1000;
/** Pesan Study (kode reset / pemberitahuan): jangan memicu jeda "dibalas manual dari aplikasi" dan jangan dicatat isinya di log. */
export const STUDY_PIN_MSG_RE = /^(Kode reset PIN orang tua Study:|PIN orang tua Study berhasil diubah|\[kode reset)/;

export function findWaCode(text) {
  const m = /(?:^|[^A-Za-z0-9])PIN[-\s]?(\d{6})(?![0-9])/i.exec(String(text ?? ""));
  return m ? `PIN-${m[1]}` : null;
}
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");
export const hashWaCode = (code) => sha256(`wa:${String(code).toUpperCase()}`);
export const hashResetCode = (code, salt) => sha256(`reset:${salt}:${code}`);
const digits = (n) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join("");

/**
 * Penangan pesan masuk. true = pesan sudah ditangani (hentikan pemrosesan; pesan berisi kode tidak disimpan/dijawab AI).
 * @param {object} o supabase, mainAccount (id nomor utama), now()
 */
export function createWaPinOrtu({ supabase, mainAccount = "main", now = () => Date.now(), log = console, maxSalahPerJam = 5 }) {
  const salah = new Map(); // jid -> [waktu]
  const terlalu = (jid) => (salah.get(jid) || []).filter((t) => now() - t < 3600_000).length >= maxSalahPerJam;
  const catat = (jid) => salah.set(jid, [...(salah.get(jid) || []).filter((t) => now() - t < 3600_000), now()]);

  return async function tangani(sock, msg, { teks, grup = null, account = mainAccount } = {}) {
    if (grup || msg?.key?.fromMe) return false;
    if (account !== mainAccount) return false;
    const kode = findWaCode(teks);
    if (!kode) return false;
    const jid = msg.key.remoteJid;
    if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return false;
    const balas = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg }).catch((e) => log.error?.("PIN ortu: gagal balas:", e instanceof Error ? e.message : String(e)));
    if (terlalu(jid)) {
      await balas("Terlalu banyak kode salah dari nomor ini. Coba lagi satu jam lagi.");
      return true;
    }
    const { data: row, error } = await supabase
      .from("study_parent_wa_codes")
      .select("id,parent_id,expires_at")
      .eq("code_hash", hashWaCode(kode))
      .is("used_at", null)
      .maybeSingle();
    if (error) {
      log.error?.("PIN ortu: gagal cek kode:", error.message);
      return false; // tabel belum ada (migrasi 0044 belum jalan): perlakukan sebagai pesan biasa
    }
    if (!row || Date.parse(row.expires_at) <= now()) {
      catat(jid);
      await balas("Kode tidak dikenal atau sudah kedaluwarsa. Buat kode baru di aplikasi (Study > Setting > PIN orang tua).");
      return true;
    }
    // sekali pakai: tandai terpakai lebih dulu (kondisional) supaya tidak bisa dipakai dua kali
    const { data: used } = await supabase.from("study_parent_wa_codes").update({ used_at: new Date(now()).toISOString() }).eq("id", row.id).is("used_at", null).select("id").maybeSingle();
    if (!used) {
      await balas("Kode itu sudah dipakai. Buat kode baru di aplikasi.");
      return true;
    }
    const { data: parent, error: e2 } = await supabase.from("study_parents").update({ wa_jid: jid }).eq("id", row.parent_id).select("name").maybeSingle();
    if (e2 || !parent) {
      await balas("Maaf, nomor belum bisa dicatat. Buat kode baru di aplikasi lalu kirim lagi.");
      return true;
    }
    await balas(`Nomor ini terdaftar untuk PIN orang tua Study atas nama ${parent.name}. Kalau lupa PIN, kode reset akan dikirim ke sini. Jangan bagikan kode apa pun ke orang lain.`);
    return true;
  };
}

/**
 * Reset darurat pemilik (dipanggil dari /resetpin di Telegram owner). Membuat kode reset 6 digit (via='owner') dan mengembalikannya
 * sebagai teks untuk pemilik; pemilik meneruskannya ke orang tua, yang memakainya lewat "Lupa PIN" di aplikasi.
 */
export async function resetPinPemilik({ supabase, nama, now = () => Date.now() }) {
  const n = String(nama || "").trim();
  if (!n) return "Pakai: /resetpin <nama orang tua>  (nama persis seperti saat membuat PIN).";
  const { data: ortu, error } = await supabase.from("study_parents").select("id,name").ilike("name", n.replace(/[%_]/g, (c) => `\\${c}`));
  if (error) return `⚠️ Gagal mencari orang tua: ${error.message}`;
  const cocok = (ortu || []).filter((p) => p.name.trim().toLowerCase() === n.toLowerCase());
  if (cocok.length === 0) return `Orang tua bernama "${n}" tidak ditemukan.`;
  const p = cocok[0];
  const code = digits(6), salt = digits(16);
  const { error: e2 } = await supabase.from("study_parent_reset_codes").insert({ parent_id: p.id, code_salt: salt, code_hash: hashResetCode(code, salt), via: "owner", expires_at: new Date(now() + RESET_TTL_MS).toISOString() });
  if (e2) return `⚠️ Gagal membuat kode: ${e2.message}`;
  return `Kode reset PIN orang tua untuk ${p.name}: ${code}\nBerlaku 15 menit, sekali pakai. Berikan ke orang tua yang bersangkutan: di aplikasi, buka dialog PIN orang tua > Lupa PIN, lalu pilih memasukkan kode (atau minta ia memakai tombol Lupa PIN setelah kode ini dikirim). Setelah kode benar ia wajib membuat PIN baru.`;
}
