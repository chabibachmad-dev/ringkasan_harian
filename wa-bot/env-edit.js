// ================================================================
// /env di Telegram: ubah BEBERAPA pengaturan .env tanpa membuka laptop (hanya pemilik, hanya kunci pada daftar putih).
//
//   /env                        daftar kunci yang boleh diubah + nilainya (rahasia disamarkan)
//   /env KEY=nilai              ubah / tambah (juga: /env set KEY=nilai atau /env KEY nilai)
//   /env hapus KEY              hapus kunci dari .env
//   /env urungkan               kembalikan .env ke keadaan sebelum perubahan terakhir
//
// Aturan keamanan:
//   - Hanya kunci pada ENV_KEYS (pembuat gambar). Kunci lain (Supabase, Telegram, WhatsApp, dll.) TIDAK bisa diubah dari sini.
//   - Nilai divalidasi (tanpa spasi/kutip/#, pola per kunci) dan tidak pernah ditampilkan utuh (rahasia: ••••4 huruf terakhir).
//   - Pesan yang berisi nilai rahasia dihapus dari chat Telegram setelah diproses (bila bot diizinkan).
//   - .env ditulis atomik (berkas sementara lalu rename); satu cadangan bergulir di .env.bak (untuk /env urungkan).
//   - Perubahan berlaku langsung (tanpa restart) untuk fitur yang mendaftar lewat onChange.
// ================================================================

import fs from "node:fs";
import { parseCfAccounts } from "./image-gen.js";

const intIn = (min, max) => (v) => (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max ? null : `harus bilangan bulat ${min}-${max}`);
const modelList = (v) => (/^[\w@/.:-]+(?:,[\w@/.:-]+)*$/.test(v) ? null : "daftar model dipisah koma, tanpa spasi");

/** Kunci yang boleh diubah dari Telegram. secret = nilai disamarkan di tampilan. */
export const ENV_KEYS = {
  CLOUDFLARE_ACCOUNT_ID: { secret: false, hint: "ID akun Cloudflare (Workers AI)", validate: (v) => (/^[A-Za-z0-9]{8,64}$/.test(v) ? null : "ID akun: huruf/angka 8-64 karakter") },
  CLOUDFLARE_API_TOKEN: { secret: true, hint: "token Cloudflare (izin Workers AI Read+Edit)", validate: (v) => (/^[\w.-]{8,200}$/.test(v) ? null : "token: 8-200 karakter huruf/angka/_-.") },
  CLOUDFLARE_ACCOUNTS: {
    secret: true,
    hint: "beberapa akun: idAkun1:token1,idAkun2:token2",
    validate: (v) => (parseCfAccounts({ CLOUDFLARE_ACCOUNTS: v }).length ? null : "format: idAkun1:token1,idAkun2:token2 (ID huruf/angka 8-64, token ≥ 8)")
  },
  CLOUDFLARE_IMAGE_MODELS: { secret: false, hint: "model gambar Cloudflare", validate: modelList },
  CLOUDFLARE_EDIT_MODELS: { secret: false, hint: "model edit foto Cloudflare (menerima foto referensi)", validate: modelList },
  GEMINI_IMAGE_MODELS: { secret: false, hint: "model gambar Gemini", validate: modelList },
  OPENROUTER_IMAGE_MODELS: { secret: false, hint: "model gambar OpenRouter", validate: modelList },
  IMAGE_PROVIDERS: {
    secret: false,
    hint: "urutan penyedia gambar: cloudflare,gemini,openrouter (kosong = hanya Cloudflare bila terisi)",
    validate: (v) => (/^(?:cloudflare|gemini|openrouter)(?:,(?:cloudflare|gemini|openrouter))*$/i.test(v) ? null : "isi: cloudflare, gemini, openrouter (dipisah koma)")
  },
  IMAGE_OWNER_DAILY: { secret: false, hint: "jatah gambar pemilik per hari (0 = tanpa batas)", validate: intIn(0, 10000) },
  IMAGE_GROUP_DAILY: { secret: false, hint: "jatah gambar semua grup per hari", validate: intIn(0, 10000) },
  IMAGE_PERSON_DAILY: { secret: false, hint: "jatah gambar per orang di grup per hari", validate: intIn(0, 10000) },
  IMAGE_TIMEOUT_MS: { secret: false, hint: "batas tunggu satu gambar (ms)", validate: intIn(10000, 300000) },
  VIDEO_ENABLED: { secret: false, hint: "pembuat video: 1 = aktif, 0 = mati", validate: (v) => (/^[01]$/.test(v) ? null : "isi 1 (aktif) atau 0 (mati)") },
  VIDEO_OWNER_DAILY: { secret: false, hint: "jatah video pemilik per hari (0 = tanpa batas)", validate: intIn(0, 1000) },
  VIDEO_GROUP_DAILY: { secret: false, hint: "jatah video semua grup per hari", validate: intIn(0, 1000) },
  VIDEO_PERSON_DAILY: { secret: false, hint: "jatah video per orang di grup per hari", validate: intIn(0, 1000) },
  VIDEO_PHOTO_OWNER_DAILY: { secret: false, hint: "jatah foto-hidup pemilik per hari (0 = tanpa batas)", validate: intIn(0, 1000) },
  VIDEO_PHOTO_GROUP_DAILY: { secret: false, hint: "jatah foto-hidup semua grup per hari", validate: intIn(0, 1000) },
  VIDEO_PHOTO_PERSON_DAILY: { secret: false, hint: "jatah foto-hidup per orang di grup per hari", validate: intIn(0, 1000) },
  VIDEO_PHOTO_MAX_SEC: { secret: false, hint: "durasi maksimum foto-hidup (detik, 5-30)", validate: intIn(5, 30) },
  VIDEO_SCENES: { secret: false, hint: "jumlah adegan bawaan satu video (3-8; makin banyak makin lama & boros gambar)", validate: intIn(3, 8) },
  VIDEO_MAX_SCENES: { secret: false, hint: "adegan maksimum bila diminta durasi panjang (3-8)", validate: intIn(3, 8) },
  VIDEO_MORPH_OWNER_DAILY: { secret: false, hint: "jatah morf foto pemilik per hari (tiap morf = beberapa edit foto AI; 0 = tanpa batas)", validate: intIn(0, 100) },
  VIDEO_MORPH_STEPS: { secret: false, hint: "jumlah tahap edit bawaan satu morf (2-8)", validate: intIn(2, 8) },
  VIDEO_MORPH_SECONDS: { secret: false, hint: "durasi bawaan morf (detik, 4-14)", validate: intIn(4, 14) },
  VIDEO_STOP_MAX_PHOTOS: { secret: false, hint: "foto maksimum per sesi /stopmotion (6-120)", validate: intIn(6, 120) },
  VIDEO_STOP_MAX_FPS: { secret: false, hint: "gambar per detik maksimum stop motion (4-24)", validate: intIn(4, 24) },
  VIDEO_MUSIC_VOLUME: { secret: false, hint: "volume musik latar video (10-100, bawaan 60)", validate: intIn(10, 100) },
  VIDEO_MUSIC_DEFAULT: { secret: false, hint: "1 = semua video otomatis diberi musik dari folder musik/ (bila ada lagunya); 0 = hanya bila diminta" , validate: intIn(0, 1) }
};

export const maskValue = (value, secret) => {
  const v = String(value ?? "");
  if (!v) return "(kosong)";
  if (!secret) return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
};

/** Argumen /env -> { kind: "status"|"set"|"unset"|"undo"|"error", key?, value?, error? } */
export function parseEnvArg(arg) {
  const a = String(arg ?? "").trim();
  if (!a || /^(?:status|daftar|list)$/i.test(a)) return { kind: "status" };
  if (/^(?:urungkan|undo|batal)$/i.test(a)) return { kind: "undo" };
  const un = /^(?:hapus|unset|delete|del)\s+([A-Za-z0-9_]+)$/i.exec(a);
  if (un) return { kind: "unset", key: un[1].toUpperCase() };
  const m = /^(?:set\s+)?([A-Za-z][A-Za-z0-9_]*)\s*(?:=|\s)\s*([\s\S]+)$/i.exec(a);
  if (!m) return { kind: "error", error: "Format: /env KEY=nilai  •  /env hapus KEY  •  /env urungkan  •  /env (daftar)" };
  let value = m[2].trim();
  if (/^(["']).*\1$/s.test(value)) value = value.slice(1, -1).trim();
  return { kind: "set", key: m[1].toUpperCase(), value };
}

/**
 * deps: { envPath, env?, onChange?(keys), fsImpl?, now? }
 * handle(arg) -> { text, secret: boolean }  (secret = pesan pengguna berisi nilai rahasia -> hapus dari chat)
 */
export function createEnvEditor({ envPath, env = process.env, onChange = null, fsImpl = fs, now = () => Date.now() } = {}) {
  const bakPath = `${envPath}.bak`;

  const read = () => {
    try {
      return fsImpl.readFileSync(envPath, "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
  };
  const write = (text) => {
    const tmp = `${envPath}.tmp-${now()}`;
    fsImpl.writeFileSync(tmp, text, { mode: 0o600 });
    fsImpl.renameSync(tmp, envPath);
  };
  const backup = (text) => {
    try {
      fsImpl.writeFileSync(bakPath, text, { mode: 0o600 });
    } catch {
      /* cadangan gagal tidak boleh menggagalkan perubahan */
    }
  };

  /** Ganti/tambah satu baris KEY=VALUE tanpa menyentuh baris lain. value = null -> hapus baris. */
  function applyLine(text, key, value) {
    const lines = text.split("\n");
    const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    let found = false;
    const out = [];
    for (const line of lines) {
      if (re.test(line)) {
        if (!found && value !== null) out.push(`${key}=${value}`);
        found = true; // baris duplikat kunci yang sama ikut dibuang
        continue;
      }
      out.push(line);
    }
    if (!found && value !== null) {
      while (out.length && out[out.length - 1] === "") out.pop();
      out.push(`${key}=${value}`, "");
    }
    return out.join("\n");
  }

  function statusText() {
    const rows = Object.entries(ENV_KEYS).map(([k, d]) => `• ${k} = ${maskValue(env[k], d.secret)}\n   ${d.hint}`);
    return (
      "⚙️ Pengaturan yang bisa diubah dari sini (hanya pembuat gambar):\n\n" +
      rows.join("\n") +
      "\n\nUbah: /env KEY=nilai\nHapus: /env hapus KEY\nBatalkan perubahan terakhir: /env urungkan\n" +
      "Berlaku langsung tanpa restart. Pesan berisi token akan dihapus dari chat ini setelah diproses."
    );
  }

  async function notify(keys) {
    try {
      await onChange?.(keys);
    } catch {
      return " (perubahan tersimpan, tetapi gagal diterapkan langsung — kirim /restart)";
    }
    return "";
  }

  async function handle(arg) {
    const cmd = parseEnvArg(arg);
    if (cmd.kind === "error") return { text: cmd.error, secret: false };
    if (cmd.kind === "status") return { text: statusText(), secret: false };

    if (cmd.kind === "undo") {
      let bak;
      try {
        bak = fsImpl.readFileSync(bakPath, "utf8");
      } catch {
        return { text: "Belum ada cadangan untuk dikembalikan.", secret: false };
      }
      const current = read();
      write(bak);
      if (current !== null) backup(current); // urungkan bisa diurungkan lagi
      for (const k of Object.keys(ENV_KEYS)) {
        const m = new RegExp(`^\\s*(?:export\\s+)?${k}\\s*=\\s*(.*)$`, "m").exec(bak);
        if (m) env[k] = m[1].trim().replace(/^(["'])(.*)\1$/, "$2");
        else delete env[k];
      }
      const warn = await notify(Object.keys(ENV_KEYS));
      return { text: `↩️ .env dikembalikan ke keadaan sebelum perubahan terakhir.${warn}`, secret: false };
    }

    const def = ENV_KEYS[cmd.key];
    if (!def) {
      return { text: `⛔ ${cmd.key} tidak boleh diubah dari Telegram. Yang boleh: ${Object.keys(ENV_KEYS).join(", ")}.`, secret: /token|key|secret|password/i.test(cmd.key) };
    }
    const secretInput = def.secret && cmd.kind === "set";

    let current;
    try {
      current = read();
    } catch (e) {
      return { text: `⚠️ Gagal membaca .env: ${e instanceof Error ? e.message : e}`, secret: secretInput };
    }
    if (current === null) return { text: `⚠️ Berkas .env tidak ditemukan di ${envPath}.`, secret: secretInput };

    if (cmd.kind === "unset") {
      backup(current);
      write(applyLine(current, cmd.key, null));
      delete env[cmd.key];
      const warn = await notify([cmd.key]);
      return { text: `🗑️ ${cmd.key} dihapus dari .env.${warn}\n(/env urungkan untuk mengembalikan)`, secret: false };
    }

    if (/[\s"'#\\`$]/.test(cmd.value) || cmd.value.length > 2000) {
      return { text: `⚠️ Nilai ${cmd.key} ditolak: tidak boleh berisi spasi, kutip, #, \\ atau $.`, secret: secretInput };
    }
    const err = def.validate(cmd.value);
    if (err) return { text: `⚠️ Nilai ${cmd.key} ditolak: ${err}.`, secret: secretInput };

    backup(current);
    write(applyLine(current, cmd.key, cmd.value));
    env[cmd.key] = cmd.value;
    const warn = await notify([cmd.key]);
    return { text: `✅ ${cmd.key} = ${maskValue(cmd.value, def.secret)} tersimpan di .env.${warn}\n(/env urungkan untuk membatalkan)`, secret: secretInput };
  }

  return { handle, keys: () => Object.keys(ENV_KEYS) };
}
