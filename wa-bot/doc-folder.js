// ================================================================
// Folder dokumen lokal di laptop: PDF peraturan -> .md terstruktur -> indeks pencarian (khusus Ollama).
//
//   <DOC_DIR>/peraturan-pdf/   <- taruh PDF di sini (boleh subfolder); bot HANYA MEMBACA, tidak pernah mengubah/menghapus
//   <DOC_DIR>/peraturan-md/    <- hasil .md (bisa kamu sunting tangan; suntingan tidak ditimpa)
//   <DOC_DIR>/.doc-state.json  <- catatan internal (hash file), aman dihapus (semua dikonversi ulang)
//
// Dua pintu masuk, satu jalur proses:
//   1. Pemantau folder: PDF baru/berubah di peraturan-pdf/ otomatis dikonversi.
//   2. Menu "PDF → MD" di aplikasi: PDF diunggah ke bucket sementara `kb-inbox` (antrean tabel pdf_md_jobs,
//      migrasi 0037); bot menyalinnya ke peraturan-pdf/ lalu memprosesnya sama seperti poin 1.
//
// PRIVASI: semua .md diindeks dengan id "local:<path>". Pencarian untuk Gemini/Groq/OpenRouter memakai
// `excludeLocal: true` (kb-index.js), jadi isinya HANYA bisa dijawab Ollama di laptop. Yang naik ke Supabase hanya
// metadata tugas (nama file, jumlah halaman/pasal, status) — tidak pernah isi dokumen.
//
// Semua dependensi disuntik (supabase, index, convert, log, now) supaya mudah dites: test-doc-folder.mjs.
// ================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { buildRegulationMarkdown, markdownToPages, markdownTitle, slugify } from "./pdf-md.js";
import { convertFile, detectTools, readKbConfig, defaultRun } from "./kb-ingest.js";

const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? "").trim() !== "" && Number(v) > 0 ? Number(v) : d);
const flag = (v, d) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? !["false", "0", "off", "no", "tidak", "mati"].includes(s) : d;
};

export function readDocFolderConfig(env = process.env, baseDir = process.cwd()) {
  const root = env.DOC_DIR ? path.resolve(env.DOC_DIR) : path.resolve(baseDir, "..", "dokumen");
  return {
    enabled: flag(env.DOC_FOLDER_ENABLED, true),
    root,
    pdfDir: env.DOC_PDF_DIR ? path.resolve(env.DOC_PDF_DIR) : path.join(root, "peraturan-pdf"),
    mdDir: env.DOC_MD_DIR ? path.resolve(env.DOC_MD_DIR) : path.join(root, "peraturan-md"),
    stateFile: path.join(root, ".doc-state.json"),
    pollMs: num(env.DOC_POLL_MS, 20000),
    settleMs: num(env.DOC_SETTLE_MS, 5000), // file harus tidak berubah selama ini (selesai disalin) sebelum diproses
    maxPdfBytes: num(env.DOC_MAX_MB, 300) * 1024 * 1024,
    bucket: env.KB_BUCKET || "kb-inbox"
  };
}

const posix = (p) => p.split(path.sep).join("/");
const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
const sha256Text = (t) => crypto.createHash("sha256").update(t).digest("hex");

/** Daftar berkas ber-ekstensi `ext` (relatif, posix), maks 3 tingkat subfolder; abaikan berkas tersembunyi/sementara. */
export function listFiles(dir, ext, depth = 3) {
  const out = [];
  const walk = (d, rel, level) => {
    let ents = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      if (e.isDirectory()) {
        if (level < depth) walk(path.join(d, e.name), rel ? `${rel}/${e.name}` : e.name, level + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(ext)) out.push(rel ? `${rel}/${e.name}` : e.name);
    }
  };
  walk(dir, "", 0);
  return out.sort();
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/** Perkiraan persen kemajuan dari teks tahap konversi (untuk bilah kemajuan di aplikasi). */
export function percentOf(text) {
  const t = String(text || "");
  const ocr = /OCR halaman \d+ \((\d+)\/(\d+)\)/.exec(t);
  if (ocr) return 20 + Math.round((60 * Number(ocr[1])) / Math.max(1, Number(ocr[2])));
  if (/Mengunduh/i.test(t)) return 5;
  if (/Membaca PDF/i.test(t)) return 10;
  if (/Mengubah PDF menjadi teks/i.test(t)) return 20;
  if (/Menata/i.test(t)) return 85;
  if (/Mengindeks/i.test(t)) return 95;
  return null;
}

export function createDocFolderWorker(deps, overrides = {}) {
  const { supabase = null, index, notify, log = console, now = () => Date.now(), isBusy, waitForIdle } = deps;
  const cfg = { ...readDocFolderConfig(deps.env || process.env, deps.baseDir || process.cwd()), ...overrides };
  const kbCfg = readKbConfig(deps.env || process.env, deps.baseDir || process.cwd());
  const run = deps.run || defaultRun;
  let tools = null;
  const convert =
    deps.convert ||
    (async ({ file, tmpDir, onProgress, gate }) => {
      if (!tools) tools = await detectTools(run, kbCfg);
      return convertFile({ file, ext: "pdf", tools, cfg: kbCfg, run, onProgress, tmpDir, gate });
    });

  let timer = null;
  let busy = false;
  let warnedTable = false;
  const pending = new Map(); // rel -> { size, mtimeMs, firstSeen }
  const stats = { processed: 0, lastError: null, lastDoneAt: null, current: null };
  let state = { files: {}, indexed: {} };

  function loadState() {
    try {
      const j = JSON.parse(fs.readFileSync(cfg.stateFile, "utf8"));
      state = { files: j.files || {}, indexed: j.indexed || {} };
    } catch {
      state = { files: {}, indexed: {} };
    }
  }
  function saveState() {
    try {
      atomicWrite(cfg.stateFile, JSON.stringify(state, null, 1));
    } catch (e) {
      log.error?.(`📂 Dokumen lokal: gagal menyimpan catatan (${e?.message || e}).`);
    }
  }

  // ------------------------------------------------------------ laporan ke Supabase (metadata saja)
  function noteTableError(error) {
    const msg = error?.message || String(error);
    if (!warnedTable) {
      warnedTable = true;
      log.error?.(/relation|does not exist|schema cache|column/i.test(msg) ? "📂 Dokumen lokal: tabel pdf_md_jobs belum ada -- jalankan migrasi supabase/migrations/0037_pdf_md_jobs.sql (folder tetap bekerja tanpa itu)." : `📂 Dokumen lokal: ${msg}`);
    }
  }
  let noProgressCol = false; // migrasi 0038 belum dijalankan: kolom progress tidak ada, abaikan saja
  const stripProgress = (f) => {
    if (!noProgressCol || !("progress" in f)) return f;
    const { progress: _p, ...rest } = f;
    return rest;
  };
  async function patchJob(id, fields) {
    if (!supabase || !id) return false;
    let { error } = await supabase.from("pdf_md_jobs").update(stripProgress(fields)).eq("id", id);
    if (error && /progress/i.test(error.message || "") && !noProgressCol) {
      noProgressCol = true;
      log.error?.("📂 Dokumen lokal: kolom progress belum ada -- jalankan migrasi 0038_pdf_md_progress.sql (bilah kemajuan baru tampil setelah itu).");
      ({ error } = await supabase.from("pdf_md_jobs").update(stripProgress(fields)).eq("id", id));
    }
    if (error) noteTableError(error);
    return !error;
  }
  /** Catat hasil konversi folder sebagai satu baris (satu per nama file) supaya tampil di menu aplikasi. */
  async function reportFolder(rel, fields) {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.from("pdf_md_jobs").select("id").eq("source", "folder").eq("filename", rel).limit(1);
      if (error) return noteTableError(error);
      if (data && data[0]) await patchJob(data[0].id, fields);
      else {
        let { error: e2 } = await supabase.from("pdf_md_jobs").insert({ source: "folder", filename: rel, ...stripProgress(fields) });
        if (e2 && /progress/i.test(e2.message || "") && !noProgressCol) {
          noProgressCol = true;
          ({ error: e2 } = await supabase.from("pdf_md_jobs").insert({ source: "folder", filename: rel, ...stripProgress(fields) }));
        }
        if (e2) noteTableError(e2);
      }
    } catch (e) {
      noteTableError(e);
    }
  }

  // ------------------------------------------------------------ indeks
  function indexMd(relMd) {
    const abs = path.join(cfg.mdDir, relMd);
    const text = fs.readFileSync(abs, "utf8");
    const pages = markdownToPages(text);
    const id = `local:${relMd}`;
    if (pages.length === 0) {
      index.removeDoc(id);
      state.indexed[id] = sha256Text(text);
      return { chunks: 0, chars: 0, pages: 0 };
    }
    const title = markdownTitle(text) || path.basename(relMd).replace(/\.md$/i, "");
    const r = index.upsertDoc({ id, title, filename: relMd, pages, chunkChars: kbCfg.chunkChars, overlapChars: kbCfg.chunkOverlap });
    state.indexed[id] = sha256Text(text);
    return r;
  }

  /** Samakan indeks dengan isi peraturan-md/: .md baru/disunting diindeks ulang, .md yang hilang dibuang dari indeks. */
  function syncIndex() {
    const present = new Set();
    const inIndex = new Set(index.listDocs().map((d) => d.id));
    let added = 0;
    for (const relMd of listFiles(cfg.mdDir, ".md")) {
      if (/\.baru\.md$/i.test(relMd)) continue; // salinan baru yang tidak menimpa suntinganmu: tidak ikut diindeks
      const id = `local:${relMd}`;
      present.add(id);
      let text;
      try {
        text = fs.readFileSync(path.join(cfg.mdDir, relMd), "utf8");
      } catch {
        continue;
      }
      if (state.indexed[id] === sha256Text(text) && inIndex.has(id)) continue;
      try {
        indexMd(relMd);
        added += 1;
      } catch (e) {
        log.error?.(`📂 Gagal mengindeks ${relMd}: ${e?.message || e}`);
      }
    }
    let removed = 0;
    for (const id of inIndex) {
      if (id.startsWith("local:") && !present.has(id)) {
        index.removeDoc(id);
        delete state.indexed[id];
        removed += 1;
      }
    }
    if (added || removed) {
      saveState();
      log.log?.(`📂 Dokumen lokal: indeks disamakan (+${added} / -${removed}).`);
    }
    return { added, removed };
  }

  // ------------------------------------------------------------ konversi satu PDF
  async function convertOne(rel, { job = null, progress = () => {} } = {}) {
    const abs = path.join(cfg.pdfDir, rel);
    const st = fs.statSync(abs);
    if (st.size > cfg.maxPdfBytes) throw new Error(`PDF terlalu besar (${Math.round(st.size / 1024 / 1024)} MB; batas DOC_MAX_MB=${Math.round(cfg.maxPdfBytes / 1024 / 1024)}).`);
    const hash = await sha256File(abs);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docmd-"));
    stats.current = { file: rel, detail: "mulai" };
    try {
      progress("Membaca PDF…", 10);
      const conv = await convert({
        file: abs,
        tmpDir,
        gate: async () => {
          if (typeof waitForIdle === "function") await waitForIdle();
        },
        onProgress: (t) => {
          stats.current.detail = t;
          progress(t, percentOf(t));
        }
      });
      const textLen = conv.pages.reduce((n, p) => n + String(p.text || "").replace(/\s+/g, "").length, 0);
      if (textLen < 20) {
        throw new Error(
          conv.ocrMissing
            ? "Tidak ada teks di PDF ini (hasil scan). Pasang OCR di laptop: sudo apt install tesseract-ocr tesseract-ocr-ind poppler-utils, lalu unggah/ganti file lagi."
            : "Tidak ada teks yang bisa dibaca dari PDF ini."
        );
      }
      progress("Menata menjadi Markdown…", 85);
      const built = buildRegulationMarkdown(conv.pages, {
        filename: path.basename(rel),
        now: new Date(now()),
        badPages: conv.badPages || [],
        ocrPages: conv.ocrPages || 0
      });

      // Tulis .md; suntinganmu tidak pernah ditimpa -> versi baru ke "<nama>.baru.md".
      const dir = path.posix.dirname(rel);
      const base = `${slugify(path.posix.basename(rel))}.md`;
      let relMd = dir && dir !== "." ? `${dir}/${base}` : base;
      const prev = state.files[rel];
      const target = path.join(cfg.mdDir, relMd);
      const note = [];
      if (fs.existsSync(target)) {
        const curHash = sha256Text(fs.readFileSync(target, "utf8"));
        if (!prev || prev.mdHash !== curHash) {
          relMd = relMd.replace(/\.md$/i, ".baru.md");
          note.push(`Sudah ada ${path.posix.basename(relMd.replace(/\.baru\.md$/i, ".md"))} yang kamu sunting (atau bukan buatan bot); hasil baru disimpan sebagai ${path.posix.basename(relMd)}.`);
        }
      }
      progress("Mengindeks…", 95);
      atomicWrite(path.join(cfg.mdDir, relMd), built.markdown);
      const isBaru = /\.baru\.md$/i.test(relMd);
      state.files[rel] = {
        size: st.size,
        mtimeMs: st.mtimeMs,
        hash,
        md: relMd,
        mdHash: isBaru ? prev?.mdHash : sha256Text(built.markdown),
        convertedAt: new Date(now()).toISOString()
      };
      if (!isBaru) indexMd(relMd);
      saveState();

      const notes = [...note, ...built.stats.catatan];
      stats.processed += 1;
      stats.lastDoneAt = now();
      stats.lastError = null;
      log.log?.(`📂 ${rel} → ${relMd}: ${built.stats.halaman} hlm, ${built.stats.bab} BAB, ${built.stats.pasal} Pasal, ${built.stats.tabel} tabel${isBaru ? " (disimpan sebagai .baru.md)" : ""}.`);
      return { relMd, title: built.title, stats: built.stats, notes, indexed: !isBaru };
    } finally {
      stats.current = null;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const resultFields = (r) => ({
    status: "done",
    status_detail: null,
    error: null,
    title: r.title,
    md_name: r.relMd,
    page_count: r.stats.halaman,
    bab_count: r.stats.bab,
    pasal_count: r.stats.pasal,
    table_count: r.stats.tabel,
    notes: r.notes,
    indexed: r.indexed,
    progress: 100,
    storage_path: null,
    finished_at: new Date(now()).toISOString()
  });

  // ------------------------------------------------------------ pemantau folder
  async function scanFolder() {
    for (const rel of listFiles(cfg.pdfDir, ".pdf")) {
      let st;
      try {
        st = fs.statSync(path.join(cfg.pdfDir, rel));
      } catch {
        continue;
      }
      const entry = state.files[rel];
      if (entry && entry.size === st.size && entry.mtimeMs === st.mtimeMs) {
        pending.delete(rel);
        continue;
      }
      const p = pending.get(rel);
      if (!p || p.size !== st.size || p.mtimeMs !== st.mtimeMs) {
        pending.set(rel, { size: st.size, mtimeMs: st.mtimeMs, firstSeen: now() });
        continue; // lihat dulu: tunggu sampai ukurannya stabil (file masih disalin?)
      }
      if (now() - p.firstSeen < cfg.settleMs) continue;
      if (typeof isBusy === "function" && isBusy()) return false; // Ollama sedang bekerja: tunda
      pending.delete(rel);
      // isi sama dengan yang pernah diproses (hanya disentuh/disalin ulang) -> tidak perlu konversi ulang
      const hash = await sha256File(path.join(cfg.pdfDir, rel)).catch(() => null);
      if (entry && hash && entry.hash === hash) {
        entry.size = st.size;
        entry.mtimeMs = st.mtimeMs;
        saveState();
        continue;
      }
      try {
        await reportFolder(rel, { status: "processing", status_detail: "Mulai diproses di laptop…", error: null, progress: 2, finished_at: null });
        let lastAt = 0;
        const progress = (text, pct = null) => {
          if (now() - lastAt < 2500) return;
          lastAt = now();
          reportFolder(rel, { status_detail: text, ...(pct != null ? { progress: pct } : {}) }).catch(() => {});
        };
        const r = await convertOne(rel, { progress });
        await reportFolder(rel, resultFields(r));
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 500);
        stats.lastError = `${rel}: ${msg}`;
        log.error?.(`📂 ${rel} gagal: ${msg}`);
        // catat agar tidak diulang terus tiap putaran; berubah/ditimpa file -> dicoba lagi
        state.files[rel] = { ...(entry || {}), size: st.size, mtimeMs: st.mtimeMs, hash: hash || entry?.hash, failed: msg };
        saveState();
        await reportFolder(rel, { status: "error", error: msg, status_detail: null, finished_at: new Date(now()).toISOString() });
      }
      return true; // satu PDF per putaran
    }
    return false;
  }

  // ------------------------------------------------------------ antrean dari aplikasi
  async function claimNext() {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("pdf_md_jobs")
      .select("id, filename, storage_path")
      .eq("status", "queued")
      .eq("source", "app")
      .not("storage_path", "is", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) {
      noteTableError(error);
      return null;
    }
    const job = data?.[0];
    if (!job) return null;
    const claim = () =>
      supabase
        .from("pdf_md_jobs")
        .update(stripProgress({ status: "processing", status_detail: "Mulai diproses di laptop…", error: null, progress: 2 }))
        .eq("id", job.id)
        .eq("status", "queued")
        .select("id");
    let { data: claimed, error: e2 } = await claim();
    if (e2 && /progress/i.test(e2.message || "") && !noProgressCol) {
      noProgressCol = true; // migrasi 0038 belum dijalankan: lanjut tanpa bilah kemajuan
      log.error?.("📂 Dokumen lokal: kolom progress belum ada -- jalankan migrasi 0038_pdf_md_progress.sql (bilah kemajuan baru tampil setelah itu).");
      ({ data: claimed, error: e2 } = await claim());
    }
    if (e2) {
      noteTableError(e2);
      return null;
    }
    return claimed && claimed.length > 0 ? job : null;
  }

  /** Nama berkas aman di peraturan-pdf/; nama yang sama dengan isi BERBEDA diberi akhiran -2, -3, … */
  function placePdf(filename, buffer) {
    const base = slugify(String(filename).replace(/\.pdf$/i, ""));
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    fs.mkdirSync(cfg.pdfDir, { recursive: true });
    for (let n = 1; n < 100; n++) {
      const name = n === 1 ? `${base}.pdf` : `${base}-${n}.pdf`;
      const abs = path.join(cfg.pdfDir, name);
      if (!fs.existsSync(abs)) {
        atomicWrite(abs, buffer);
        return name;
      }
      if (crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex") === hash) return name;
    }
    throw new Error("Terlalu banyak berkas dengan nama yang sama di folder.");
  }

  async function processJob(job) {
    let lastAt = 0;
    const progress = (text, pct = null) => {
      if (now() - lastAt < 2500) return;
      lastAt = now();
      patchJob(job.id, { status_detail: text, ...(pct != null ? { progress: pct } : {}) }).catch(() => {});
    };
    try {
      progress("Mengunduh PDF ke laptop…", 5);
      const { data: blob, error: dlErr } = await supabase.storage.from(cfg.bucket).download(job.storage_path);
      if (dlErr || !blob) throw new Error(`Gagal mengunduh file dari inbox (${dlErr?.message || "kosong"}).`);
      const rel = placePdf(job.filename, Buffer.from(await blob.arrayBuffer()));
      const r = await convertOne(rel, { job, progress });
      const ok = await patchJob(job.id, resultFields(r));
      try {
        await supabase.storage.from(cfg.bucket).remove([job.storage_path]);
      } catch {
        /* dibersihkan juga saat baris dihapus */
      }
      if (!ok) log.error?.("📂 Hasil sudah disimpan di laptop, tetapi status gagal ditulis ke database.");
      if (notify) await Promise.resolve(notify({ title: "PDF sudah jadi .md", body: `"${r.title}" — ${r.stats.pasal} Pasal, tersimpan di laptop dan bisa ditanyakan.`.slice(0, 180), url: "./", tag: `pdfmd-${job.id}` })).catch(() => {});
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 500);
      stats.lastError = `${job.filename}: ${msg}`;
      log.error?.(`📂 Tugas "${job.filename}" gagal: ${msg}`);
      await patchJob(job.id, { status: "error", status_detail: null, error: msg, finished_at: new Date(now()).toISOString() });
      if (notify) await Promise.resolve(notify({ title: "PDF gagal diubah", body: `"${job.filename}": ${msg}`.slice(0, 180), url: "./", tag: `pdfmd-${job.id}` })).catch(() => {});
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      syncIndex(); // suntingan .md dan berkas baru langsung diindeks (murah)
      if (typeof isBusy === "function" && isBusy()) return;
      const job = await claimNext();
      if (job) return void (await processJob(job));
      await scanFolder();
    } catch (e) {
      log.error?.("📂 Dokumen lokal: putaran gagal:", e?.message || e);
    } finally {
      busy = false;
    }
  }

  async function start() {
    if (!cfg.enabled || timer) return;
    fs.mkdirSync(cfg.pdfDir, { recursive: true });
    fs.mkdirSync(cfg.mdDir, { recursive: true });
    loadState();
    if (supabase) {
      // Tugas yang terputus (bot mati di tengah jalan) diantrekan lagi.
      const { error } = await supabase.from("pdf_md_jobs").update({ status: "queued", status_detail: "Menunggu diproses di laptop…" }).eq("status", "processing").eq("source", "app").not("storage_path", "is", null);
      if (error) noteTableError(error);
      // Konversi folder yang terputus saat bot mati: hapus status 'processing' yang menggantung (akan diproses ulang oleh pemantau).
      const { error: e3 } = await supabase.from("pdf_md_jobs").update(stripProgress({ status: "queued", status_detail: "Menunggu diproses ulang…", progress: 0 })).eq("status", "processing").eq("source", "folder");
      if (e3) noteTableError(e3);
    }
    log.log?.(`📂 Dokumen lokal aktif: PDF di ${cfg.pdfDir} → .md di ${cfg.mdDir} (hanya dijawab Ollama).`);
    timer = setInterval(() => {
      tick();
    }, cfg.pollMs);
    tick();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function status() {
    const docs = index.listDocs().filter((d) => String(d.id).startsWith("local:"));
    return { pdfDir: cfg.pdfDir, mdDir: cfg.mdDir, docs: docs.length, processed: stats.processed, current: stats.current, lastError: stats.lastError };
  }

  return { start, stop, tick, scanFolder, syncIndex, convertOne, processJob, claimNext, status, loadState, config: cfg, _state: () => state };
}
