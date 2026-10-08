// ================================================================
// Pelayan "pencarian potongan dokumen" untuk Gemini (jalan di laptop, di dalam proses bot).
//
// Edge Function `chat` (cloud) menaruh baris di `kb_retrievals` (migrations/0019); worker ini
// mengambilnya, mencari di indeks lokal (kb-index.js) dan menulis potongan hasilnya kembali.
// Gemini lalu hanya menerima POTONGAN itu (bukan salinan dokumen yang terpotong di cloud).
//
// Pencarian itu cepat (ms), jadi worker ini punya timer SENDIRI -- tidak menunggu job Ollama
// yang bisa berjalan menit-menit.
// ================================================================

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function readKbRetrievalConfig(env = process.env) {
  return {
    enabled: (env.KB_RETRIEVAL_ENABLED || "true").toLowerCase() !== "false",
    pollMs: num(env.KB_RETRIEVAL_POLL_MS, 2000),
    maxBudgetChars: num(env.KB_RETRIEVAL_MAX_BUDGET_CHARS, 30000),
    maxChunks: num(env.KB_RETRIEVAL_MAX_CHUNKS, 16),
    keepMs: num(env.KB_RETRIEVAL_KEEP_MS, 24 * 3600_000)
  };
}

export function createKbRetrievalWorker(deps, overrides = {}) {
  const { supabase, index, log = console, now = () => Date.now() } = deps;
  const cfg = { ...readKbRetrievalConfig(deps.env || process.env), ...overrides };
  let timer = null;
  let busy = false;
  let warned = false;
  let lastCleanup = 0;
  const state = { served: 0, lastError: null };

  function noteDbError(error) {
    state.lastError = error?.message || String(error);
    if (!warned) {
      warned = true;
      if (/kb_retrievals/i.test(state.lastError)) log.error?.("📚 Pencarian untuk Gemini: tabel kb_retrievals belum ada -- jalankan migrasi supabase/migrations/0019_kb_retrievals.sql.");
      else log.error?.("📚 Pencarian untuk Gemini: error database:", state.lastError);
    }
  }

  async function claim() {
    const { data, error } = await supabase
      .from("kb_retrievals")
      .select("id, question, budget_chars, max_chunks")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);
    if (error) {
      noteDbError(error);
      return [];
    }
    const claimed = [];
    for (const row of data ?? []) {
      const { data: ok, error: e2 } = await supabase.from("kb_retrievals").update({ status: "running" }).eq("id", row.id).eq("status", "pending").select("id");
      if (!e2 && ok && ok.length > 0) claimed.push(row);
    }
    return claimed;
  }

  async function serve(row) {
    const t0 = now();
    try {
      const budgetChars = Math.min(cfg.maxBudgetChars, num(row.budget_chars, 12000));
      const maxChunks = Math.min(cfg.maxChunks, num(row.max_chunks, 10));
      const blocks = index.hasDocs() ? index.search(row.question, { budgetChars, maxChunks }) : [];
      const chunks = blocks.map((b) => ({ title: b.title, page: b.page ?? null, text: b.text, score: Number(b.score.toFixed(3)) }));
      const st = index.stats();
      const { error } = await supabase
        .from("kb_retrievals")
        .update({
          status: "done",
          chunks,
          stats: { docs: st.docs, chunks: st.chunks, blocks: chunks.length, ms: now() - t0 },
          error: null,
          finished_at: new Date(now()).toISOString()
        })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      state.served += 1;
      log.log?.(`📚 Pencarian untuk Gemini: ${chunks.length} blok (${chunks.reduce((n, c) => n + c.text.length, 0)} karakter) dalam ${now() - t0} ms.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error?.("📚 Pencarian untuk Gemini gagal:", msg);
      await supabase.from("kb_retrievals").update({ status: "failed", error: msg.slice(0, 300), finished_at: new Date(now()).toISOString() }).eq("id", row.id);
    }
  }

  async function cleanup() {
    lastCleanup = now();
    const cutoff = new Date(now() - cfg.keepMs).toISOString();
    await supabase.from("kb_retrievals").delete().lt("created_at", cutoff);
  }

  async function tick() {
    if (busy) return 0;
    busy = true;
    try {
      const rows = await claim();
      for (const row of rows) await serve(row);
      if (now() - lastCleanup > 3600_000) await cleanup().catch(() => {});
      return rows.length;
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    status: () => ({ ...state }),
    start() {
      if (!cfg.enabled || timer) return;
      timer = setInterval(() => tick().catch((e) => noteDbError(e)), cfg.pollMs);
      log.log?.(`📚 Pencarian dokumen untuk Gemini aktif (cek antrean tiap ${Math.round(cfg.pollMs / 1000)} dtk).`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
