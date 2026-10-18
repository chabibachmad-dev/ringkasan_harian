// ================================================================
// KANTOR AI -- pemancar kejadian dari bot ke halaman "Kantor" di aplikasi.
//
// Bot memanggil feed.emit({ who, kind, text, progress, to, item }) di titik-titik kerja (menyusun balasan, membuat gambar/video/suara,
// serah-terima antar karyawan). Kejadian ditampung, dibersihkan (tanpa nomor, surel, tautan; satu baris pendek), lalu dikirim berkelompok
// ke tabel `office_events`. Denyut ("masih hidup") ditulis ke `office_presence` tiap 30 detik oleh heartbeat().
//
// Aturan privasi (sengaja ketat): yang dikirim hanya RINGKASAN kegiatan ("Menyusun balasan di grup Keluarga"), tidak pernah isi pesan.
// Cleanup/redact DUPLIKAT dari supabase/functions/_shared/office-core.ts (bot tidak boleh impor .ts di Node 20); test-office.mjs menjaga keduanya sama.
//
// Gagal menulis (tabel belum dimigrasi, jaringan putus) tidak boleh mengganggu bot: kejadian dibuang, dicoba lagi pelan-pelan.
// ================================================================

export const WHO = ["ayyubi", "wongsobot", "agen", "video", "gambar", "suara"];
export const KINDS = ["online", "offline", "think", "work", "progress", "say", "wait", "done", "error", "handoff"];
export const ITEMS = ["naskah", "video", "suara", "gambar", "berkas", "pesan"];
const MAX_TEXT = 120;

export function redact(text, max = MAX_TEXT) {
  let s = String(text ?? "");
  s = s.replace(/https?:\/\/\S+/gi, "[tautan]");
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[surel]");
  s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, "[angka]");
  s = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Kejadian mentah -> baris tabel `office_events`, atau null bila tidak sah. */
export function toRow(e) {
  if (!e || typeof e !== "object") return null;
  if (!WHO.includes(e.who) || !KINDS.includes(e.kind)) return null;
  const hasP = e.progress !== null && e.progress !== undefined && e.progress !== "" && Number.isFinite(Number(e.progress));
  const handoff = e.kind === "handoff";
  return {
    who: e.who,
    kind: e.kind,
    text: redact(e.text),
    progress: hasP ? Math.max(0, Math.min(100, Math.round(Number(e.progress)))) : null,
    to_who: handoff && WHO.includes(e.to) ? e.to : null,
    item: handoff && ITEMS.includes(e.item) ? e.item : null,
    approval_id: null
  };
}

const REASONS = {
  quota: "Kuota habis",
  billing: "Kuota dan saldo habis",
  auth: "Kunci ditolak",
  unavailable: "Layanan sedang tidak tersedia",
  blocked: "Ditolak filter keamanan",
  noffmpeg: "ffmpeg belum terpasang",
  noimage: "Pembuat gambar belum aktif",
  noedit: "Edit foto belum aktif",
  badimage: "Foto tidak terbaca",
  badphoto: "Foto tidak terbaca",
  render: "Gagal merakit video",
  fail: "Gagal merakit video",
  busy: "Studio sedang sibuk",
  off: "Dimatikan"
};
/** Alasan galat singkat & aman (tanpa isi pesan galat mentah) dari jenis galat studio. */
export const reasonText = (kind) => REASONS[kind] || "Gagal dikerjakan";

/** Alasan galat singkat & aman dari galat model lokal (Ollama). */
export function ollamaReason(err) {
  const m = String(err?.message || err || "");
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|connect/i.test(m)) return "Ollama tidak aktif";
  if (/timeout|timed out|abort|terlalu lama/i.test(m)) return "Model lokal terlalu lama";
  if (/memory|ram|alloc/i.test(m)) return "Memori tidak cukup";
  return "Model lokal gagal";
}

/** Nama pekerjaan di antrean Ollama -> kalimat untuk umpan Kantor. */
export const OLLAMA_JOB_LABEL = {
  "wa-reply": "Menyusun balasan WhatsApp",
  "daily-summary": "Meringkas percakapan harian",
  "simab-parse": "Membaca perintah SiMAB",
  "reg-monitor": "Memeriksa peraturan baru",
  "owner-docs": "Menjawab dari dokumen pemilik",
  "owner-skill": "Menjalankan keterampilan",
  "owner-lokal": "Mengobrol dengan pemilik"
};
export const ollamaJobLabel = (label) => OLLAMA_JOB_LABEL[label] || "Menjawab dengan model lokal";

/** Alasan galat singkat dari galat AI teks. */
export function aiReason(err) {
  const m = String(err?.message || err || "");
  if (err?.allKeysExhausted === true || err?.status === 429 || /quota|kuota|exhaust/i.test(m)) return "Kuota AI habis";
  if (err?.status === 503 || /overload|sibuk|unavailable/i.test(m)) return "AI sedang sibuk";
  if (/timeout|timed out|abort/i.test(m)) return "AI terlalu lama menjawab";
  return "Gagal menyusun balasan";
}

/** Label grup yang aman dipajang: nama dipotong pendek; chat pribadi disamarkan. */
export function chatLabel(jid, subject = "") {
  if (String(jid || "").endsWith("@g.us")) {
    const name = redact(subject, 28);
    return name ? `grup ${name}` : "sebuah grup";
  }
  return "chat pribadi";
}

/**
 * @param {object} o
 * @param {object} o.supabase     klien supabase-js (service role)
 * @param {boolean} [o.enabled]   false = semua perintah tidak melakukan apa-apa
 * @param {number} [o.flushMs]
 * @param {number} [o.heartbeatMs]
 * @param {() => Array|Promise<Array>} [o.presence]  daftar {who, detail?} karyawan yang saat ini "masuk kerja" (boleh async)
 */
export function createOfficeFeed({ supabase, enabled = true, flushMs = 1500, heartbeatMs = 30_000, presence = () => [], logger = console, now = () => Date.now() } = {}) {
  const queue = [];
  const lastProgress = new Map(); // who -> waktu progres terakhir yang diantre
  let timer = null;
  let beatTimer = null;
  let flushing = false;
  let failures = 0;
  let pauseUntil = 0;
  let warned = false;
  const stats = { queued: 0, sent: 0, dropped: 0, errors: 0 };

  function emit(e) {
    if (!enabled) return false;
    const row = toRow(e);
    if (!row) return false;
    // progres yang terlalu rapat dijarangkan; kejadian lain tetap lengkap
    if (row.kind === "progress") {
      const last = lastProgress.get(row.who) || 0;
      if (now() - last < 2000) return false;
      lastProgress.set(row.who, now());
    }
    // jangan menumpuk bila tabel macet
    if (queue.length >= 200) {
      queue.shift();
      stats.dropped++;
    }
    queue.push(row);
    stats.queued++;
    schedule();
    return true;
  }

  function schedule() {
    if (timer || !enabled) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, flushMs);
    timer.unref?.();
  }

  async function flush() {
    if (!enabled || flushing || queue.length === 0) return;
    if (now() < pauseUntil) {
      schedule();
      return;
    }
    flushing = true;
    const batch = queue.splice(0, 40);
    try {
      const { error } = await supabase.from("office_events").insert(batch);
      if (error) throw new Error(error.message || String(error));
      stats.sent += batch.length;
      failures = 0;
      warned = false;
    } catch (e) {
      stats.errors++;
      failures++;
      stats.dropped += batch.length;
      if (!warned) {
        warned = true;
        logger.warn?.(`🏢 Kantor AI: gagal menulis kejadian (${e instanceof Error ? e.message : String(e)}). Sudah menjalankan migrasi 0041_office.sql? Bot tetap jalan normal.`);
      }
      // 3 gagal beruntun -> istirahat 5 menit (kejadian di antrean dibuang)
      if (failures >= 3) {
        pauseUntil = now() + 5 * 60_000;
        stats.dropped += queue.length;
        queue.length = 0;
      }
    } finally {
      flushing = false;
      if (queue.length) schedule();
    }
  }

  /** Tulis denyut untuk semua karyawan yang sedang "masuk kerja". */
  async function heartbeat() {
    if (!enabled || now() < pauseUntil) return;
    let list = [];
    try {
      list = (await presence()) || []; // boleh sinkron atau async (mis. memeriksa Ollama)
    } catch {
      return;
    }
    const at = new Date(now()).toISOString();
    const rows = list.filter((p) => WHO.includes(p?.who)).map((p) => ({ who: p.who, seen_at: at, detail: redact(p.detail ?? "", 80) }));
    if (!rows.length) return;
    try {
      const { error } = await supabase.from("office_presence").upsert(rows, { onConflict: "who" });
      if (error) throw new Error(error.message || String(error));
    } catch (e) {
      stats.errors++;
      if (!warned) {
        warned = true;
        logger.warn?.(`🏢 Kantor AI: gagal menulis denyut (${e instanceof Error ? e.message : String(e)}).`);
      }
    }
  }

  function start() {
    if (!enabled || beatTimer) return;
    heartbeat().catch(() => {});
    beatTimer = setInterval(() => heartbeat().catch(() => {}), heartbeatMs);
    beatTimer.unref?.();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    if (beatTimer) clearInterval(beatTimer);
    timer = beatTimer = null;
  }

  /**
   * Pembantu satu pekerjaan: t = feed.task("ayyubi"); t.think("..."); t.work("...", 30); t.done("...") / t.fail("...").
   * Setiap panggilan aman walau feed dimatikan.
   */
  function task(who) {
    const e = (kind, text, extra = {}) => emit({ who, kind, text, ...extra });
    return {
      who,
      think: (text) => e("think", text),
      work: (text, progress) => e("work", text, progress === undefined ? {} : { progress }),
      progress: (text, progress) => e("progress", text, progress === undefined ? {} : { progress }),
      say: (text) => e("say", text),
      done: (text) => e("done", text),
      fail: (text) => e("error", text),
      handoff: (to, item, text) => e("handoff", text, { to, item })
    };
  }

  return { emit, flush, heartbeat, start, stop, task, stats, enabled };
}

/**
 * Kantor AI: terjemahkan tahap pembuatan video (script|images|voice|render|edit) jadi kejadian karyawan studio.
 * Naskah -> Studio Video; gambar -> Studio Gambar; narasi -> Studio Suara; rakit -> Studio Video; hasil diserahkan ke bot pemesan.
 */
export function officeVideoStages(office, boss, where, { photo = false, morph = false } = {}) {
  const video = office.task("video");
  const pic = office.task("gambar");
  const mic = office.task("suara");
  boss.think(`Permintaan ${morph ? "morf foto" : photo ? "foto hidup" : "video"} di ${where}`);
  if (!photo && !morph) boss.handoff("video", "naskah", "Menyerahkan permintaan ke studio video");
  let last = "";
  return {
    video,
    stage(stage, i, n) {
      if (stage === last && stage !== "edit") return;
      last = stage;
      if (stage === "script") video.work("Menulis naskah adegan", 15);
      else if (stage === "images") {
        video.progress("Menunggu gambar", 35);
        pic.work("Menggambar adegan", 40);
      } else if (stage === "voice") {
        pic.done("Gambar adegan siap");
        mic.work("Membacakan narasi", 60);
      } else if (stage === "edit") pic.work(n ? `Mengedit foto ${Math.min(Number(i) || 1, n)}/${n}` : "Mengedit foto", n ? Math.round(((Number(i) || 1) / n) * 100) : 50);
      else if (stage === "render") {
        if (!photo && !morph) mic.done("Narasi selesai");
        if (morph) pic.done("Semua tahap foto siap");
        video.work(photo ? "Menghidupkan foto dengan ffmpeg" : "Merakit video dengan ffmpeg", 80);
      }
    }
  };
}

/** Bangun penyusun config dari env: OFFICE_FEED=0 mematikan. */
export function readOfficeConfig(env = process.env) {
  const v = String(env.OFFICE_FEED ?? "1").trim().toLowerCase();
  return { enabled: !["0", "false", "off", "no", "mati"].includes(v) };
}
