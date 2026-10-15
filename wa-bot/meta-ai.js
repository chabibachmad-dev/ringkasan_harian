// ================================================================
// PERCOBAAN: apakah bot bisa "ngobrol" dengan Meta AI (kontak bawaan WhatsApp) lewat nomor UTAMA?
//
// Meta AI tidak punya API; Baileys hanya punya pengetahuan sebagian tentang alamatnya (nomor 1313555xxxx / akhiran @bot).
// Karena itu ini baru UJI DIAGNOSTIK dari Telegram (pemilik saja), tidak terhubung ke grup:
//   /metaai tes [alamat] [pesan]   kirim SATU pesan ke Meta AI (bawaan "buatkan gambar kucing lucu"), tunggu balasan, laporkan
//   /metaai cari                   dengarkan ±90 detik tanpa mengirim apa pun; ketik pesan ke Meta AI dari HP-mu sendiri
//                                  supaya bot menangkap alamat aslinya (pesan keluar dari HP terlihat oleh bot)
//
// Pengaman: pesan dari/ke alamat Meta AI TIDAK PERNAH diteruskan ke auto-reply (mencegah bot membalas Meta AI terus-menerus).
//
// .env (opsional):
//   META_AI_JIDS=13135550002@s.whatsapp.net   alamat yang dicoba (pisah koma); alamat hasil /metaai cari bisa dimasukkan di sini
// ================================================================

export const DEFAULT_META_AI_JIDS = ["13135550002@s.whatsapp.net"];
export const DEFAULT_TEST_PROMPT = "buatkan gambar kucing lucu";
const BOT_NUMBER_RE = /^1313555\d{4}$|^131655500\d{2}$/;

const userPart = (jid) => String(jid || "").split("@")[0].split(":")[0];

export function readMetaAiConfig(env = process.env) {
  const list = String(env.META_AI_JIDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^[\w.:-]+@[\w.]+$/.test(x));
  return { jids: list.length ? list : DEFAULT_META_AI_JIDS };
}

/** Alamat yang jelas milik bot/Meta AI (akhiran @bot, pola nomor bot WhatsApp, atau alamat yang kita atur sendiri). */
export function isMetaAiJid(jid, known = []) {
  const j = String(jid || "");
  if (!j || j.endsWith("@g.us") || j.endsWith("@broadcast") || j.endsWith("@newsletter")) return false;
  if (j.endsWith("@bot")) return true;
  const u = userPart(j);
  if (BOT_NUMBER_RE.test(u)) return true;
  return known.some((k) => userPart(k) === u);
}

/** Ringkas satu pesan: { type, text, image } (image = true bila gambar). */
export function describeMessage(msg) {
  const m = msg?.message || {};
  const skip = new Set(["messageContextInfo", "senderKeyDistributionMessage", "messageContextInfo"]);
  const type = Object.keys(m).find((k) => !skip.has(k)) || "kosong";
  const text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || "";
  return { type, text: String(text).replace(/\s+/g, " ").slice(0, 300), image: type === "imageMessage" };
}

/** Pesan membawa metadata bot (balasan Meta AI ditandai begitu walau alamatnya tidak dikenali). */
export function hasBotMetadata(msg) {
  const ctx = msg?.message?.messageContextInfo;
  return Boolean(ctx?.botMetadata || ctx?.botMessageSecret?.length || msg?.message?.botInvokeMessage);
}

const mask = (jid) => {
  const [u, s] = String(jid || "").split("@");
  return u.length > 6 ? `${u.slice(0, 3)}…${u.slice(-4)}@${s}` : String(jid || "");
};

/**
 * deps: { config, now?, sleep?, log? }
 */
export function createMetaAi({ config = readMetaAiConfig({}), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console } = {}) {
  let session = null; // { events, others, phone, lastAt }
  let busy = false;
  const known = () => [...config.jids, ...(session?.extra || [])];

  /**
   * Dipanggil untuk SETIAP pesan masuk (paling awal). true = pesan milik Meta AI/bot -> pemanggil WAJIB berhenti
   * (tidak ada penyimpanan, tidak ada auto-reply). Pesan lain dicatat saja bila sedang ada uji.
   */
  function observe(msg) {
    const jid = msg?.key?.remoteJid;
    if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return false;
    const botish = isMetaAiJid(jid, known()) || hasBotMetadata(msg);
    if (session) {
      const d = describeMessage(msg);
      if (msg.key.fromMe) {
        // Pesan keluar dari HP pemilik (atau dari bot): berguna untuk mengetahui alamat asli Meta AI.
        if (botish || session.listening) session.phone.push({ jid, ...d, raw: msg });
      } else if (botish) {
        session.events.push({ jid, ...d, raw: msg });
        session.lastAt = now();
      } else {
        session.others.push({ jid, type: d.type });
      }
    }
    if (botish) log.log?.(`🤖 [Meta AI] pesan ${msg.key.fromMe ? "keluar ke" : "masuk dari"} ${mask(jid)} (${describeMessage(msg).type}) -- tidak diteruskan ke auto-reply`);
    return botish;
  }

  /**
   * Jalankan uji. send(jid, text) mengirim pesan; null = hanya mendengarkan.
   * -> { text (laporan siap tampil), images: [msg], found: boolean }
   */
  async function run({ send = null, jids = null, prompt = DEFAULT_TEST_PROMPT, waitMs = 45_000, quietMs = 12_000, listenMs = 90_000 } = {}) {
    if (busy) return { text: "⏳ Uji Meta AI sebelumnya masih berjalan. Tunggu selesai dulu.", images: [], found: false };
    busy = true;
    const targets = jids?.length ? jids : config.jids;
    const lines = [];
    const images = [];
    let found = false;
    try {
      if (!send) {
        session = { events: [], others: [], phone: [], lastAt: 0, listening: true, extra: [] };
        const until = now() + listenMs;
        while (now() < until) await sleep(1000);
        const jidsSeen = [...new Set(session.phone.map((p) => p.jid).concat(session.events.map((e) => e.jid)))];
        lines.push(`🔎 Mendengarkan ${Math.round(listenMs / 1000)} detik selesai.`);
        if (jidsSeen.length === 0) lines.push("Tidak ada pesan keluar dari HP-mu maupun dari bot yang tertangkap. Ketik pesan ke Meta AI dari HP SELAMA /metaai cari berjalan, lalu ulangi.");
        else {
          lines.push("Alamat yang tertangkap:");
          for (const j of jidsSeen) {
            const ex = session.phone.find((p) => p.jid === j) || session.events.find((e) => e.jid === j);
            lines.push(`• ${j}  (${ex.type}${ex.text ? `: "${ex.text.slice(0, 60)}"` : ""}) ${isMetaAiJid(j) ? "← tampak seperti Meta AI" : ""}`);
          }
          lines.push("", "Coba: /metaai tes <alamat di atas>   atau isi META_AI_JIDS di .env.");
        }
        for (const e of session.events) if (e.image) images.push(e.raw);
        found = jidsSeen.length > 0;
        return { text: lines.join("\n"), images, found };
      }

      for (const jid of targets) {
        session = { events: [], others: [], phone: [], lastAt: 0, listening: false, extra: [jid] };
        const startedAt = now();
        lines.push(`➡️ Mengirim "${prompt}" ke ${jid}`);
        try {
          await send(jid, prompt);
        } catch (e) {
          lines.push(`   ✗ gagal mengirim: ${e instanceof Error ? e.message : e}`);
          continue;
        }
        while (now() - startedAt < waitMs) {
          await sleep(1000);
          if (session.events.length && now() - session.lastAt >= quietMs) break;
        }
        const ev = session.events;
        if (ev.length === 0) {
          lines.push(`   ✗ tidak ada balasan dalam ${Math.round(waitMs / 1000)} detik.`);
          if (session.others.length) lines.push(`   (selama itu ada ${session.others.length} pesan dari kontak lain: ${[...new Set(session.others.map((o) => mask(o.jid)))].slice(0, 4).join(", ")})`);
          if (session.phone.length) lines.push(`   (pesan keluar dari HP tertangkap ke: ${[...new Set(session.phone.map((p) => p.jid))].slice(0, 3).join(", ")})`);
          continue;
        }
        found = true;
        lines.push(`   ✓ ${ev.length} balasan dari ${ev[0].jid}:`);
        ev.slice(0, 6).forEach((e, i) => lines.push(`     ${i + 1}. ${e.type}${e.text ? `: "${e.text.slice(0, 120)}"` : ""}`));
        for (const e of ev) if (e.image) images.push(e.raw);
        if (images.length) lines.push(`   🖼️ ${images.length} gambar diterima — dikirim ke chat ini.`);
        else lines.push("   (belum ada gambar: kemungkinan Meta AI hanya menjawab teks, atau gambar butuh waktu lebih lama)");
        break;
      }
      if (!found) {
        lines.push("", "Kesimpulan: belum ada balasan. Coba /metaai cari (ketik ke Meta AI dari HP) untuk menemukan alamat aslinya, atau Meta AI memang tidak mau menerima pesan dari klien tak resmi.");
      } else if (!images.length) {
        lines.push("", "Kesimpulan: Meta AI membalas, tetapi belum terbukti bisa mengirim gambar lewat jalur ini.");
      } else {
        lines.push("", "Kesimpulan: jalurnya BISA: Meta AI membalas dengan gambar. Penerusan ke grup dapat dibuat.");
      }
      return { text: lines.join("\n"), images, found };
    } finally {
      session = null;
      busy = false;
    }
  }

  return { observe, run, isBusy: () => busy, known };
}

/**
 * Pengaman: jangan mengirim uji ke alamat yang tidak tampak seperti Meta AI (bisa jadi nomor orang sungguhan).
 * -> teks peringatan, atau null bila boleh lanjut.
 */
export function unsafeTarget(jid, { force = false, known = [] } = {}) {
  if (!jid || force || isMetaAiJid(jid, known)) return null;
  return (
    `⚠️ ${jid} TIDAK tampak seperti alamat Meta AI (tampak seperti nomor telepon biasa, bisa jadi orang sungguhan). ` +
    "Pesan uji TIDAK dikirim.\n\nPastikan dulu di HP: buka chat itu — kalau itu kontak/orang, jangan diuji. " +
    `Kalau kamu yakin itu Meta AI, ulangi dengan kata "yakin": /metaai tes ${jid} yakin`
  );
}

/** Argumen /metaai -> { kind: "help"|"tes"|"cari", jid?, prompt? } */
export function parseMetaAiArg(arg) {
  const a = String(arg ?? "").trim();
  if (!a) return { kind: "help" };
  const [first, ...rest] = a.split(/\s+/);
  const w = first.toLowerCase();
  if (["cari", "pantau", "temukan", "listen"].includes(w)) return { kind: "cari" };
  if (["tes", "test", "uji", "coba"].includes(w)) {
    let jid = null;
    const words = [...rest];
    if (words[0] && /^[\w.:-]+@[\w.]+$/.test(words[0])) jid = words.shift();
    else if (words[0] && /^\d{9,}$/.test(words[0])) jid = `${words.shift()}@s.whatsapp.net`;
    let force = false;
    if (jid && words[0] && /^(?:yakin|paksa)$/i.test(words[0])) {
      force = true;
      words.shift();
    }
    return { kind: "tes", jid, force, prompt: words.join(" ").trim() || DEFAULT_TEST_PROMPT };
  }
  return { kind: "help" };
}
