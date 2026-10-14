// Penjaga kesehatan bot: memeriksa hal-hal yang kalau rusak biasanya baru ketahuan setelah bot diam, lalu mengabari pemilik
// (WhatsApp + Telegram) SEKALI saat bermasalah dan SEKALI saat pulih. Tanpa AI, tanpa layanan luar, tanpa biaya.
//
// Yang diperiksa (tiap HEALTH_INTERVAL_MIN menit, bawaan 5):
//   Ollama          server lokal tidak menjawab (GET /api/version)                     -> dilaporkan setelah 2x gagal berturut-turut
//   Disk            sisa ruang di disk bot / folder cadangan < HEALTH_DISK_MIN_GB (3)   -> langsung
//   Memori          RAM tersedia < HEALTH_MEM_MIN_MB (300) tiga kali berturut-turut
//   WhatsApp        tidak tersambung lebih dari HEALTH_WA_DOWN_MIN menit (10), mis. sesi dicabut dari HP
//   Basis data      Supabase tidak terjangkau 3x berturut-turut (internet putus / layanan bermasalah)
//   Restart         bot menyala >= HEALTH_RESTARTS kali (5) dalam 15 menit (pm2 restart berulang / crash loop)
//   Cadangan        cadangan terakhir lebih tua dari 36 jam padahal cadangan otomatis aktif
// /kesehatan (alias /sehat, /health) menjalankan semua pemeriksaan sekarang dan menampilkan papan status.
//
// Aturan anti-berisik: satu pesan per tick (gabungan), satu peringatan per masalah, diulang paling cepat tiap 6 jam bila
// masih bermasalah, dan satu pesan "pulih". Bila pengiriman gagal, peringatan dicoba lagi di tick berikutnya.

import fs from "node:fs";
import path from "node:path";

const FALSE_RE = /^(0|false|off|no|tidak|mati)$/i;
const REPEAT_MS = 6 * 3600_000;

export function readHealthConfig(env = process.env) {
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(hi, Math.max(lo, Number(v))) : d);
  return {
    enabled: !FALSE_RE.test(String(env.HEALTH_ENABLED ?? "true").trim()),
    intervalMin: num(env.HEALTH_INTERVAL_MIN, 5, 1, 120),
    diskMinGb: num(env.HEALTH_DISK_MIN_GB, 3, 0.1, 5000),
    memMinMb: num(env.HEALTH_MEM_MIN_MB, 300, 50, 100000),
    waDownMin: num(env.HEALTH_WA_DOWN_MIN, 10, 2, 1440),
    restarts: Math.floor(num(env.HEALTH_RESTARTS, 5, 2, 50)),
    ollama: !FALSE_RE.test(String(env.HEALTH_OLLAMA ?? "true").trim())
  };
}

/** Kenali /kesehatan (alias /sehat, /health). null bila bukan perintah. */
export function parseHealthCommand(text) {
  return /^\s*\/(?:kesehatan|sehat|health)(?:@\w+)?\s*$/i.test(String(text ?? "")) ? {} : null;
}

const fmtGb = (bytes) => `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(bytes / 1024 ** 3)} GB`;
const durText = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} jam${m % 60 ? ` ${m % 60} menit` : ""}` : `${Math.floor(h / 24)} hari`;
};

// ------------------------------------------------------------ pemeriksaan siap pakai (masing-masing mengembalikan { ok, detail })
export function ollamaCheck({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  return {
    id: "ollama",
    label: "Ollama",
    failAfter: 2,
    hint: "Jalankan Ollama lagi (mis. `ollama serve` atau buka aplikasinya). Selama mati, /lokal, /dokumen, /skill, dan balasan Ollama tidak jalan.",
    async run() {
      try {
        const res = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return { ok: false, detail: `menjawab HTTP ${res.status}` };
        const j = await res.json().catch(() => ({}));
        return { ok: true, detail: j.version ? `versi ${j.version}` : "menjawab" };
      } catch (e) {
        const msg = String(e?.cause?.code || e?.name || e?.message || e);
        return { ok: false, detail: /Timeout|Abort/i.test(msg) ? `tidak menjawab dalam ${Math.round(timeoutMs / 1000)} detik` : `tidak terjangkau (${msg.slice(0, 60)})` };
      }
    }
  };
}

export function diskCheck({ paths, minGb, statfs = fs.statfsSync }) {
  return {
    id: "disk",
    label: "Disk",
    failAfter: 1,
    hint: "Kosongkan ruang (hapus berkas besar / cadangan lama). Cadangan dan basis data butuh ruang kosong untuk menulis.",
    async run() {
      const rows = [];
      for (const p of paths.filter(Boolean)) {
        try {
          const st = statfs(p);
          rows.push({ p, free: Number(st.bavail) * Number(st.bsize), total: Number(st.blocks) * Number(st.bsize) });
        } catch {
          /* folder belum ada (mis. cadangan belum pernah jalan): lewati */
        }
      }
      if (rows.length === 0) return { ok: true, detail: "tidak bisa dibaca (dilewati)" };
      const worst = rows.sort((a, b) => a.free - b.free)[0];
      const pct = worst.total > 0 ? Math.round((worst.free / worst.total) * 100) : 0;
      const detail = `sisa ${fmtGb(worst.free)} (${pct}%)`;
      return { ok: worst.free >= minGb * 1024 ** 3, detail: worst.free >= minGb * 1024 ** 3 ? detail : `${detail}, di bawah batas ${minGb} GB` };
    }
  };
}

export function memoryCheck({ read, minMb }) {
  return {
    id: "memori",
    label: "Memori",
    failAfter: 3,
    hint: "RAM hampir habis: tutup aplikasi berat atau pakai model Ollama yang lebih kecil. Bot bisa melambat atau dimatikan sistem.",
    async run() {
      const m = read();
      if (!m || !(m.availableMB >= 0)) return { ok: true, detail: "tidak bisa dibaca (dilewati)" };
      const detail = `tersedia ${m.availableMB} MB dari ${m.totalMB} MB`;
      return { ok: m.availableMB >= minMb, detail: m.availableMB >= minMb ? detail : `${detail}, di bawah batas ${minMb} MB` };
    }
  };
}

export function whatsappCheck({ isConnected, downMin, now = () => Date.now() }) {
  let downSince = null;
  return {
    id: "whatsapp",
    label: "WhatsApp",
    failAfter: 1,
    hint: "Lihat log (`/log`). Bila sesi dicabut dari HP, hapus folder auth_session lalu scan QR lagi (atau pulihkan dari /cadangan).",
    async run() {
      const t = now();
      if (isConnected()) {
        downSince = null;
        return { ok: true, detail: "tersambung" };
      }
      if (downSince === null) downSince = t;
      const down = t - downSince;
      return down >= downMin * 60_000 ? { ok: false, detail: `putus sudah ${durText(down)}` } : { ok: true, detail: `sedang menyambung ulang (${durText(down)})` };
    }
  };
}

export function databaseCheck({ ping, timeoutMs = 8000 }) {
  return {
    id: "database",
    label: "Basis data (Supabase)",
    failAfter: 3,
    hint: "Periksa koneksi internet laptop dan status Supabase. Selama putus, ringkasan, chat aplikasi, dan antrean pesan tertahan.",
    async run() {
      try {
        await Promise.race([Promise.resolve(ping()), new Promise((_, rej) => setTimeout(() => rej(new Error("tidak menjawab")), timeoutMs))]);
        return { ok: true, detail: "terjangkau" };
      } catch (e) {
        return { ok: false, detail: `tidak terjangkau (${String(e?.message || e).slice(0, 70)})` };
      }
    }
  };
}

/** Riwayat waktu menyala bot di berkas kecil lokal. recordStart() dipanggil sekali saat bot menyala. */
export function createRestartTracker({ file, now = () => Date.now(), windowMs = 15 * 60_000, max = 5 }) {
  const read = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(j) ? j.filter((x) => Number.isFinite(x)) : [];
    } catch {
      return [];
    }
  };
  return {
    recordStart() {
      try {
        const list = [...read(), now()].slice(-30);
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(list));
      } catch {
        /* pencatatan tidak boleh mengganggu bot */
      }
    },
    check: {
      id: "restart",
      label: "Restart bot",
      failAfter: 1,
      hint: "Bot menyala berulang kali: kemungkinan crash. Lihat `/log` untuk galat terakhir. Bila itu karena kamu sendiri memasang patch, abaikan.",
      async run() {
        const t = now();
        const n = read().filter((x) => t - x <= windowMs).length;
        return { ok: n < max, detail: `${n} kali menyala dalam ${Math.round(windowMs / 60000)} menit terakhir` };
      }
    }
  };
}

export function backupCheck({ enabled, latest, startedAt, now = () => Date.now(), maxAgeHours = 36 }) {
  return {
    id: "cadangan",
    label: "Cadangan",
    failAfter: 1,
    hint: "Lihat /cadangan; coba /cadangan sekarang. Bila ruang disk penuh, kosongkan dulu.",
    async run() {
      if (!enabled) return { ok: true, detail: "dimatikan (dilewati)" };
      const t = now();
      const last = latest();
      if (!last) return t - startedAt < 3 * 3600_000 ? { ok: true, detail: "belum ada (bot baru menyala)" } : { ok: false, detail: "belum pernah ada cadangan" };
      const age = t - last;
      return age <= maxAgeHours * 3600_000 ? { ok: true, detail: `terakhir ${durText(age)} lalu` } : { ok: false, detail: `cadangan terakhir ${durText(age)} lalu` };
    }
  };
}

// ------------------------------------------------------------ penjaga
/**
 * deps: config, checks: [{ id, label, run() -> {ok, detail}, failAfter?, hint?, repeatMs? }], notify(text) -> Promise (lempar bila gagal),
 *       now(), log
 */
export function createHealth({ config, checks = [], notify, now = () => Date.now(), log = console } = {}) {
  const state = new Map(); // id -> { fails, downSince, alertedAt, detail }
  let running = false;
  const st = (id) => {
    let s = state.get(id);
    if (!s) {
      s = { fails: 0, downSince: null, alertedAt: 0, detail: "" };
      state.set(id, s);
    }
    return s;
  };

  async function runOne(c) {
    try {
      const r = await c.run();
      return { ok: !!r?.ok, detail: String(r?.detail ?? "") };
    } catch (e) {
      return { ok: false, detail: `pemeriksaan gagal dijalankan: ${String(e?.message || e).slice(0, 80)}` };
    }
  }

  /** Satu putaran pemeriksaan + pengiriman peringatan/pulih. @returns jumlah pesan yang terkirim (0 atau 1) */
  async function tick() {
    if (!config.enabled || running) return 0;
    running = true;
    try {
      const t = now();
      const alerts = [];
      const recoveries = [];
      const commit = []; // tindakan penandaan, dijalankan setelah pesan SUKSES terkirim
      for (const c of checks) {
        const r = await runOne(c);
        const s = st(c.id);
        s.detail = r.detail;
        if (r.ok) {
          if (s.alertedAt) {
            recoveries.push(`✅ ${c.label} pulih — ${r.detail}${s.downSince ? ` (sempat bermasalah ${durText(t - s.downSince)})` : ""}`);
            commit.push(() => {
              s.alertedAt = 0;
              s.downSince = null;
              s.fails = 0;
            });
          } else {
            s.fails = 0;
            s.downSince = null;
          }
          continue;
        }
        s.fails += 1;
        if (s.downSince === null) s.downSince = t;
        const need = c.failAfter ?? 2;
        if (s.fails >= need && (!s.alertedAt || t - s.alertedAt >= (c.repeatMs ?? REPEAT_MS))) {
          alerts.push(`⚠️ *${c.label}*: ${r.detail}${c.hint ? `\n   ${c.hint}` : ""}`);
          commit.push(() => {
            s.alertedAt = t;
          });
        }
      }
      if (alerts.length === 0 && recoveries.length === 0) return 0;
      const text = ["🩺 *Kesehatan bot*", ...alerts, ...recoveries].join("\n");
      try {
        await notify(text);
      } catch (e) {
        log.warn?.(`🩺 Peringatan kesehatan belum terkirim (dicoba lagi di putaran berikutnya): ${e?.message || e}`);
        return 0;
      }
      for (const f of commit) f();
      return 1;
    } catch (e) {
      log.error?.(`🩺 Pemeriksaan kesehatan gagal: ${e?.message || e}`);
      return 0;
    } finally {
      running = false;
    }
  }

  /** Papan status sekarang (tanpa mengirim peringatan dan tanpa mengubah hitungan gagal). */
  async function report() {
    const lines = ["🩺 Kesehatan bot sekarang:"];
    let bad = 0;
    for (const c of checks) {
      const r = await runOne(c);
      if (!r.ok) bad += 1;
      lines.push(`${r.ok ? "✅" : "⚠️"} ${c.label}: ${r.detail}`);
      if (!r.ok && c.hint) lines.push(`   ${c.hint}`);
    }
    lines.push("", bad === 0 ? "Semua baik." : `${bad} hal perlu perhatian.`, `Otomatis diperiksa tiap ${config.intervalMin} menit; kamu dikabari saat bermasalah dan saat pulih.`);
    return lines.join("\n");
  }

  const describe = () => (config.enabled ? `AKTIF (tiap ${config.intervalMin} menit: ${checks.map((c) => c.id).join(", ")}; /kesehatan)` : "mati (HEALTH_ENABLED=true untuk menyalakan; /kesehatan tetap bisa dipakai)");

  return { tick, report, describe };
}
