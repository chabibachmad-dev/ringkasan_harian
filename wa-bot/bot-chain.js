// Pengaman rantai balasan antar-bot (Ayyubi <-> Wongsobot) di grup. Pemilik MENGIZINKAN kedua bot saling membalas, jadi tidak ada pemblokiran:
// hanya (1) batas rantai: berapa pesan bot berturut-turut tanpa pesan manusia di antaranya (bawaan 6), setelah itu bot berhenti
// menyahut sampai ada manusia yang bicara; (2) jeda acak 3-10 detik sebelum membalas pesan bot agar terasa wajar dan tidak membanjiri.
// Satu proses menjalankan kedua akun, jadi hitungannya dipakai bersama. Murni logika, tanpa jaringan.
const num = (v, d, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(hi, Math.max(lo, Math.floor(n))) : d;
};

export function readBotChainConfig(env = process.env) {
  const minMs = num(env.BOT_CHAIN_DELAY_MIN_SEC, 3, 0, 60) * 1000;
  return {
    max: num(env.BOT_CHAIN_MAX, 6, 0, 50), // 0 = bot tidak menyahut bot lain sama sekali
    minDelayMs: minMs,
    maxDelayMs: Math.max(minMs, num(env.BOT_CHAIN_DELAY_MAX_SEC, 10, 0, 120) * 1000)
  };
}

export function createBotChain({ config = readBotChainConfig(), random = Math.random, keep = 500 } = {}) {
  const groups = new Map(); // groupJid -> { count, seen:Set(id) }
  const stateOf = (g) => {
    let s = groups.get(g);
    if (!s) {
      s = { count: 0, seen: new Set() };
      groups.set(g, s);
      while (groups.size > keep) groups.delete(groups.keys().next().value);
    }
    return s;
  };

  /**
   * Catat satu pesan grup. Pesan yang sama (id sama) yang terlihat dari dua akun dihitung sekali.
   * -> { count, fresh } ; count = panjang rantai bot berturut-turut SETELAH pesan ini.
   */
  function note(groupJid, { id = "", fromBot = false } = {}) {
    const s = stateOf(groupJid);
    if (id) {
      if (s.seen.has(id)) return { count: s.count, fresh: false };
      s.seen.add(id);
      if (s.seen.size > 200) s.seen.delete(s.seen.values().next().value);
    }
    s.count = fromBot ? s.count + 1 : 0; // pesan manusia mereset hitungan
    return { count: s.count, fresh: true };
  }

  /** True bila rantai sudah melewati batas: bot tidak boleh menyahut pesan bot lain. */
  const blocked = (groupJid) => stateOf(groupJid).count > config.max;
  const count = (groupJid) => stateOf(groupJid).count;
  /** Jeda acak (ms) antara minDelayMs dan maxDelayMs. */
  const delayMs = () => config.minDelayMs + Math.floor(random() * (config.maxDelayMs - config.minDelayMs + 1));

  return { note, blocked, count, delayMs, config };
}
