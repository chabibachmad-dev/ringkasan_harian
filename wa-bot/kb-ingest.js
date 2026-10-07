// ================================================================
// Worker "ingest" Dokumen Pengetahuan -- jalan di laptop, di dalam proses bot.
//
// Aplikasi mengunggah file MENTAH (PDF dll) ke bucket Storage privat
// `kb-inbox` dan menandai barisnya status 'queued' (lihat migrations/0017).
// Worker ini:
//   1. mengklaim satu dokumen 'queued' (atomik -> 'processing'),
//   2. mengunduh file, mengubahnya jadi teks per halaman:
//        - `pdftotext -layout` (cepat, mempertahankan tabel),
//        - halaman yang TIDAK punya teks (scan) di-OCR dengan tesseract
//          (opsional; dilewati kalau tesseract tidak terpasang),
//   3. mengindeks seluruh teks ke SQLite FTS5 lokal (kb-index.js),
//   4. menyalin teks (dibatasi KB_SYNC_MAX_CHARS) ke kolom `content` supaya
//      Gemini tetap bisa memakainya, menandai 'ready',
//   5. MENGHAPUS file mentah dari inbox.
// Plus "rekonsiliasi" berkala: dokumen yang dihapus di aplikasi dibuang dari
// indeks, dan dokumen 'ready' yang belum ada di indeks (mis. dokumen lama hasil
// upload browser) ikut diindeks.
//
// Semua dependensi disuntik (supabase, index, run, notify) supaya mudah dites
// dengan mock -- lihat test-kb.mjs.
// ================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function readKbConfig(env = process.env, baseDir = process.cwd()) {
  return {
    enabled: (env.KB_INGEST_ENABLED || "true").toLowerCase() !== "false",
    indexFile: env.KB_INDEX_FILE || path.join(baseDir, "kb", "kb.sqlite"),
    bucket: env.KB_BUCKET || "kb-inbox",
    pollMs: num(env.KB_POLL_MS, 6000),
    reconcileMs: num(env.KB_RECONCILE_MS, 120000),
    syncMaxChars: num(env.KB_SYNC_MAX_CHARS, 600000),
    chunkChars: num(env.KB_CHUNK_CHARS, 1200),
    convertTimeoutMs: num(env.KB_CONVERT_TIMEOUT_MS, 600000),
    ocr: (env.KB_OCR || "auto").toLowerCase() !== "off",
    ocrLang: env.KB_OCR_LANG || "",
    ocrDpi: num(env.KB_OCR_DPI, 200),
    ocrMinChars: num(env.KB_OCR_MIN_CHARS, 25),
    ocrMaxPages: num(env.KB_OCR_MAX_PAGES, 300),
    ocrPageTimeoutMs: num(env.KB_OCR_PAGE_TIMEOUT_MS, 180000)
  };
}

// Menjalankan perintah luar dengan prioritas CPU rendah (nice) supaya tidak
// mengganggu Ollama/bot. Mengembalikan { stdout, stderr }; melempar saat gagal.
export function defaultRun(cmd, args, { timeoutMs = 600000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "nice",
      ["-n", "10", cmd, ...args],
      { timeout: timeoutMs, maxBuffer, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          // `nice` tidak ada? coba langsung.
          if (err.code === "ENOENT" && err.path === "nice") {
            execFile(cmd, args, { timeout: timeoutMs, maxBuffer, encoding: "utf8" }, (e2, so2, se2) =>
              e2 ? reject(e2) : resolve({ stdout: so2, stderr: se2 })
            );
            return;
          }
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export async function detectTools(run = defaultRun, cfg = readKbConfig()) {
  const tools = { pdftotext: false, pdftoppm: false, tesseract: false, ocrLang: null };
  const has = async (cmd, args) => {
    try {
      return await run(cmd, args, { timeoutMs: 15000 });
    } catch (e) {
      // pdftotext -v keluar dengan kode 0 di sebagian versi, 99 di versi lain; yang penting bukan ENOENT
      // Kode 127 = `nice` tidak menemukan perintahnya; ENOENT = tidak ada sama sekali.
      return e && typeof e.code === "number" && e.code !== 127 ? { stdout: e.stdout || "", stderr: e.stderr || "" } : null;
    }
  };
  tools.pdftotext = !!(await has("pdftotext", ["-v"]));
  tools.pdftoppm = !!(await has("pdftoppm", ["-v"]));
  const t = await has("tesseract", ["--list-langs"]);
  if (t) {
    tools.tesseract = true;
    const langs = new Set(
      `${t.stdout}\n${t.stderr}`
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^[a-z_]+$/i.test(l) && l.toLowerCase() !== "list")
    );
    if (cfg.ocrLang) tools.ocrLang = cfg.ocrLang;
    else if (langs.has("ind") && langs.has("eng")) tools.ocrLang = "ind+eng";
    else if (langs.has("ind")) tools.ocrLang = "ind";
    else if (langs.has("eng")) tools.ocrLang = "eng";
    else tools.tesseract = false;
  }
  return tools;
}

// Ubah file jadi halaman-halaman teks.
// Mengembalikan { pages: [{page, text}], ocrPages, ocrSkipped, ocrMissing }.
export async function convertFile({ file, ext, tools, cfg, run = defaultRun, onProgress = () => {}, tmpDir, gate = async () => {} }) {
  if (ext !== "pdf") {
    const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    return { pages: [{ page: null, text }], ocrPages: 0, ocrSkipped: 0, ocrMissing: false };
  }
  if (!tools.pdftotext) {
    throw new Error("`pdftotext` belum terpasang di laptop. Jalankan: sudo apt install poppler-utils");
  }
  const outTxt = path.join(tmpDir, "out.txt");
  onProgress("Mengubah PDF menjadi teks…");
  try {
    await run("pdftotext", ["-layout", "-enc", "UTF-8", file, outTxt], { timeoutMs: cfg.convertTimeoutMs });
  } catch (e) {
    const msg = String(e?.stderr || e?.message || e).trim().split("\n")[0];
    if (/password|encrypted/i.test(msg)) throw new Error("PDF ini dikunci dengan kata sandi, tidak bisa dibaca.");
    throw new Error(`Gagal membaca PDF (${msg.slice(0, 200)}).`);
  }
  let raw = "";
  try {
    raw = fs.readFileSync(outTxt, "utf8");
  } catch (_e) {
    raw = "";
  }
  const parts = raw.split("\f");
  if (parts.length > 1 && parts[parts.length - 1].trim() === "") parts.pop();
  const pages = parts.map((text, i) => ({ page: i + 1, text, ocr: false }));

  const empties = pages.filter((p) => p.text.replace(/\s+/g, "").length < cfg.ocrMinChars);
  let ocrPages = 0;
  let ocrSkipped = 0;
  let ocrMissing = false;
  if (empties.length > 0 && cfg.ocr) {
    if (!tools.tesseract || !tools.pdftoppm) {
      ocrMissing = true;
      ocrSkipped = empties.length;
    } else {
      const todo = empties.slice(0, cfg.ocrMaxPages);
      ocrSkipped = empties.length - todo.length;
      let i = 0;
      for (const p of todo) {
        i += 1;
        // Beri jalan ke Ollama dulu (OCR memakan CPU & memperlambat chat).
        await gate();
        onProgress(`OCR halaman ${p.page} (${i}/${todo.length})…`);
        const base = path.join(tmpDir, "ocr");
        try {
          await run(
            "pdftoppm",
            ["-r", String(cfg.ocrDpi), "-gray", "-png", "-singlefile", "-f", String(p.page), "-l", String(p.page), file, base],
            { timeoutMs: cfg.ocrPageTimeoutMs }
          );
          const { stdout } = await run("tesseract", [`${base}.png`, "stdout", "-l", tools.ocrLang], {
            timeoutMs: cfg.ocrPageTimeoutMs
          });
          if (stdout && stdout.trim()) {
            p.text = stdout;
            p.ocr = true;
            ocrPages += 1;
          }
        } catch (_e) {
          // halaman ini gagal di-OCR; lanjut ke halaman berikutnya
          ocrSkipped += 1;
        } finally {
          fs.rmSync(`${base}.png`, { force: true });
        }
      }
    }
  } else if (empties.length > 0) {
    ocrSkipped = empties.length;
  }
  return { pages, ocrPages, ocrSkipped, ocrMissing };
}

export function pagesToText(pages) {
  return pages
    .map((p) => `${p.page != null ? `[Halaman ${p.page}]\n` : ""}${p.text.replace(/[ \t]+\n/g, "\n").trim()}`)
    .filter((s) => s.replace(/^\[Halaman \d+\]\s*/, "").length > 0)
    .join("\n\n");
}

export function createKbIngestWorker(deps, overrides = {}) {
  const { supabase, index, notify, run = defaultRun, log = console, now = () => Date.now(), isBusy, waitForIdle } = deps;
  const cfg = { ...readKbConfig(deps.env || process.env, deps.baseDir || process.cwd()), ...overrides };

  let timer = null;
  let busy = false;
  let lastReconcile = 0;
  let tools = null;
  let warnedSchema = false;
  const state = { current: null, lastError: null, lastDoneAt: null, processed: 0 };

  function noteDbError(error) {
    const msg = error?.message || String(error);
    if (/column|status|storage_path/i.test(msg) && !warnedSchema) {
      warnedSchema = true;
      log.error?.("📚 Dokumen: kolom baru belum ada -- jalankan migrasi supabase/migrations/0017_kb_inbox.sql.");
    } else if (!warnedSchema) {
      log.error?.("📚 Dokumen: error database:", msg);
    }
  }

  async function patch(id, fields) {
    const { error } = await supabase.from("knowledge_documents").update(fields).eq("id", id);
    if (error) noteDbError(error);
    return !error;
  }

  async function reconcile() {
    lastReconcile = now();
    let res = await supabase.from("knowledge_documents").select("id, status, on_laptop");
    if (res.error && /column/i.test(res.error.message || "")) {
      res = await supabase.from("knowledge_documents").select("id");
    }
    if (res.error) {
      noteDbError(res.error);
      return { removed: 0, added: 0 };
    }
    const remote = new Map((res.data ?? []).map((r) => [r.id, r]));
    const local = new Map(index.listDocs().map((d) => [d.id, d]));
    let removed = 0;
    for (const id of local.keys()) {
      if (!remote.has(id)) {
        index.removeDoc(id);
        removed += 1;
      }
    }
    let added = 0;
    for (const [id, r] of remote) {
      if (local.has(id)) continue;
      if (r.status && r.status !== "ready") continue;
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select("id, title, original_filename, content")
        .eq("id", id)
        .maybeSingle();
      if (error || !data || !data.content) continue;
      index.upsertDocFromText({ id, title: data.title, filename: data.original_filename, text: data.content });
      added += 1;
      if (r.on_laptop === false) await patch(id, { on_laptop: true });
    }
    if (removed || added) log.log?.(`📚 Dokumen: rekonsiliasi indeks (+${added} / -${removed}).`);
    return { removed, added };
  }

  async function claimNext() {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("id, title, original_filename, storage_path")
      .eq("status", "queued")
      .not("storage_path", "is", null)
      .order("uploaded_at", { ascending: true })
      .limit(1);
    if (error) {
      noteDbError(error);
      return null;
    }
    const doc = data?.[0];
    if (!doc) return null;
    const { data: claimed, error: e2 } = await supabase
      .from("knowledge_documents")
      .update({ status: "processing", status_detail: "Mulai diproses di laptop…", error: null })
      .eq("id", doc.id)
      .eq("status", "queued")
      .select("id");
    if (e2) {
      noteDbError(e2);
      return null;
    }
    return claimed && claimed.length > 0 ? doc : null;
  }

  async function processDoc(doc) {
    const started = now();
    state.current = { id: doc.id, title: doc.title, detail: "mulai" };
    const ext = (doc.storage_path.split(".").pop() || "pdf").toLowerCase();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
    let lastProgressAt = 0;
    const progress = async (text) => {
      state.current.detail = text;
      if (now() - lastProgressAt < 2500) return;
      lastProgressAt = now();
      await patch(doc.id, { status_detail: text });
    };
    try {
      await progress("Mengunduh file ke laptop…");
      const { data: blob, error: dlErr } = await supabase.storage.from(cfg.bucket).download(doc.storage_path);
      if (dlErr || !blob) throw new Error(`Gagal mengunduh file dari inbox (${dlErr?.message || "kosong"}).`);
      const file = path.join(tmpDir, `source.${ext}`);
      fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));

      if (!tools) tools = await detectTools(run, cfg);
      const conv = await convertFile({
        file,
        ext,
        tools,
        cfg,
        run,
        tmpDir,
        gate: async () => {
          if (typeof waitForIdle === "function") await waitForIdle();
        },
        onProgress: (t) => {
          progress(t).catch(() => {});
        }
      });
      const text = pagesToText(conv.pages);
      if (text.replace(/\[Halaman \d+\]|\s+/g, "").length < 20) {
        throw new Error(
          conv.ocrMissing
            ? "Tidak ada teks di PDF ini (hasil scan). Pasang OCR di laptop: sudo apt install tesseract-ocr tesseract-ocr-ind poppler-utils, lalu tekan Coba lagi."
            : "Tidak ada teks yang bisa dibaca dari file ini."
        );
      }

      await progress("Membuat indeks pencarian…");
      const indexed = index.upsertDoc({
        id: doc.id,
        title: doc.title,
        filename: doc.original_filename,
        pages: conv.pages,
        ocrPages: conv.ocrPages,
        chunkChars: cfg.chunkChars
      });

      const truncated = text.length > cfg.syncMaxChars;
      const synced = truncated ? `${text.slice(0, cfg.syncMaxChars)}\n\n[...dipotong untuk Gemini; versi lengkap ada di laptop...]` : text;
      const notes = [];
      if (conv.ocrPages > 0) notes.push(`${conv.ocrPages} hlm via OCR`);
      if (conv.ocrSkipped > 0) notes.push(`${conv.ocrSkipped} hlm tanpa teks dilewati`);
      const ok = await patch(doc.id, {
        content: synced,
        char_count: indexed.chars,
        page_count: indexed.pages,
        truncated,
        on_laptop: true,
        ocr_pages: conv.ocrPages,
        status: "ready",
        status_detail: notes.length ? notes.join(" • ") : null,
        error: null,
        storage_path: null
      });
      if (!ok) throw new Error("Teks sudah diindeks tetapi gagal disimpan ke database.");

      // Bersihkan inbox.
      try {
        await supabase.storage.from(cfg.bucket).remove([doc.storage_path]);
      } catch (_e) {
        // abaikan; kb_delete juga membersihkan
      }
      state.processed += 1;
      state.lastDoneAt = now();
      state.lastError = null;
      const secs = Math.round((now() - started) / 1000);
      log.log?.(`📚 Dokumen "${doc.title}" siap: ${indexed.pages ?? "?"} hlm, ${indexed.chars} karakter, ${indexed.chunks} potongan (${secs} dtk).`);
      if (notify) {
        await Promise.resolve(
          notify({
            title: "Dokumen sudah siap",
            body: `"${doc.title}"${indexed.pages ? ` (${indexed.pages} halaman)` : ""} sudah diindeks dan bisa ditanyakan.`,
            url: "./",
            tag: `kb-${doc.id}`
          })
        ).catch(() => {});
      }
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 500);
      state.lastError = msg;
      log.error?.(`📚 Dokumen "${doc.title}" gagal: ${msg}`);
      await patch(doc.id, { status: "error", status_detail: null, error: msg });
      if (notify) {
        await Promise.resolve(
          notify({ title: "Dokumen gagal diproses", body: `"${doc.title}": ${msg}`.slice(0, 180), url: "./", tag: `kb-${doc.id}` })
        ).catch(() => {});
      }
    } finally {
      state.current = null;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (now() - lastReconcile >= cfg.reconcileMs) await reconcile();
      // Jangan mulai dokumen baru saat Ollama sedang bekerja (menghindari rebutan CPU).
      if (typeof isBusy === "function" && isBusy()) return;
      const doc = await claimNext();
      if (doc) await processDoc(doc);
    } catch (e) {
      log.error?.("📚 Dokumen: tick gagal:", e?.message || e);
    } finally {
      busy = false;
    }
  }

  async function start() {
    if (!cfg.enabled || timer) return;
    // Proses yang terputus (bot mati di tengah jalan) diulang dari awal.
    const { error } = await supabase
      .from("knowledge_documents")
      .update({ status: "queued", status_detail: "Menunggu diproses di laptop…" })
      .eq("status", "processing")
      .not("storage_path", "is", null);
    if (error) noteDbError(error);
    tools = await detectTools(run, cfg).catch(() => ({ pdftotext: false, pdftoppm: false, tesseract: false, ocrLang: null }));
    log.log?.(
      `📚 Dokumen: indeks ${index.driver} • pdftotext ${tools.pdftotext ? "ada" : "TIDAK ADA"} • OCR ${
        tools.tesseract && tools.pdftoppm ? `ada (${tools.ocrLang})` : "tidak ada (opsional)"
      }`
    );
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
    return { ...index.stats(), tools, current: state.current, lastError: state.lastError, processed: state.processed };
  }

  return { start, stop, tick, reconcile, status, config: cfg };
}
