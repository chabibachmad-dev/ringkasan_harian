// ================================================================
// Pencarian dokumen HIBRIDA: BM25 + batang kata (kb-index.js) + kemiripan makna (embedding Jina) + reranker Jina.
//
//   pertanyaan ─┬─ BM25/stem (lokal, ms) ──────────┐
//               └─ embedding Jina → cosine lokal ──┴─ RRF → reranker Jina → blok ber-[Halaman n] (kb-index.search)
//
// Aturan yang tidak boleh dilanggar:
//   1. Jina HANYA dipakai bila pemanggil memberi `excludeLocal: true` (jalur yang memang boleh ke penyedia cloud).
//      Dokumen 'local:' (peraturan-pdf di laptop, Komitmen Bersama, dst.) TIDAK PERNAH di-embed, di-rerank, atau dikirim.
//   2. Jina gagal / mati / lambat → kembali PERSIS ke pencarian lama (kb-index.search); bot tidak pernah macet karena Jina.
//   3. Bukti tipis → hasil kosong (pemanggil menjawab "tidak ditemukan di dokumen"), bukan potongan yang kebetulan mirip.
//
// Yang di-embed hanya dokumen non-lokal, di latar belakang (createEmbedWorker), sekali per potongan.
// ================================================================
import { tokenizeQuery, coverageOf } from "./kb-index.js";
import { JinaError } from "./jina.js";

const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? "").trim() !== "" && Number(v) >= 0 ? Number(v) : d);

export function readHybridConfig(env = process.env) {
  const cov = Number(env.KB_MIN_COVERAGE);
  return {
    candidates: num(env.JINA_CANDIDATES, 40), // kandidat per sumber (BM25 / vektor)
    rerankPool: num(env.JINA_RERANK_POOL, 20), // berapa kandidat gabungan yang dikirim ke reranker
    rerankMin: num(env.JINA_RERANK_MIN, 0.05), // skor reranker di bawah ini = tidak relevan (0 = mati)
    denseMin: num(env.JINA_DENSE_MIN, 0.4), // tanpa reranker: potongan hanya-vektor harus semirip ini
    denseExtra: num(env.JINA_DENSE_EXTRA, 6), // paling banyak potongan hanya-vektor yang ikut tanpa reranker
    deadlineMs: num(env.JINA_DEADLINE_MS, 9000), // batas total langkah Jina per pertanyaan
    minCoverage: env.KB_MIN_COVERAGE !== undefined && env.KB_MIN_COVERAGE !== "" && cov >= 0 && cov <= 1 ? cov : 0.5
  };
}

const keyOf = (r) => `${r.doc_id}#${r.seq}`;

/** Gabungkan dua daftar (urut terbaik dulu) dengan Reciprocal Rank Fusion. Pure, bisa dites. */
export function rrfMerge(lists, k = 60) {
  const m = new Map();
  for (const list of lists) {
    list.forEach((r, i) => {
      const key = keyOf(r);
      const cur = m.get(key) || { row: r, rrf: 0, from: new Set() };
      cur.rrf += 1 / (k + i + 1);
      cur.from.add(r.__src || "x");
      if (r.__src === "lex") cur.row = { ...r, sim: cur.row.sim }; // baris leksikal (punya skor bm25) dipakai sebagai dasar
      else if (cur.row !== r && Number.isFinite(r.sim)) cur.row = { ...cur.row, sim: r.sim };
      m.set(key, cur);
    });
  }
  return [...m.values()].sort((a, b) => b.rrf - a.rrf);
}

export function createHybridSearch({ index, jina, log = console, env = process.env, now = () => Date.now() }, overrides = {}) {
  const cfg = { ...readHybridConfig(env), ...overrides };
  const state = { hybrid: 0, bm25: 0, fallbacks: 0, lastError: null, lastMode: null, lastAt: 0 };
  const warned = new Map();

  function warnOnce(kind, msg) {
    const t = now();
    if (t - (warned.get(kind) || 0) < 5 * 60_000) return;
    warned.set(kind, t);
    log.warn?.(`🧠 Pencarian hibrida: ${msg}`);
  }

  const model = () => jina.cfg.embedModel;
  const ready = () => {
    try {
      return index.vectorStats(model()).embedded > 0;
    } catch {
      return false;
    }
  };

  function withDeadline(promise, ms) {
    let timer;
    const t = new Promise((_, rej) => (timer = setTimeout(() => rej(new JinaError("timeout", "Langkah Jina melewati batas waktu.")), ms)));
    return Promise.race([promise, t]).finally(() => clearTimeout(timer));
  }

  /** Urutkan ulang kandidat dengan Jina. Mengembalikan { rows, mode } atau melempar. */
  async function hybridRows(question, opts) {
    const { maxChunks = 8, titles = null } = opts;
    const tokens = tokenizeQuery(question);
    const lexAll = index.candidates(question, { maxChunks, titles, excludeLocal: true, limit: cfg.candidates });
    // Saring cakupan kata persis seperti search(): pertanyaan panjang yang tak tercakup oleh potongan leksikal mana pun
    // tidak boleh "diselamatkan" oleh kemiripan makna saja kecuali reranker menyatakan relevan.
    let lex = lexAll.map((r) => ({ ...r, __src: "lex" }));
    if (cfg.minCoverage > 0 && tokens.length >= 5) {
      const need = Math.max(2, Math.ceil(tokens.length * cfg.minCoverage));
      lex = lex.filter((r) => coverageOf(`${r.head || ""}\n${r.text}`, tokens) >= need);
    }
    const useDense = jina.usable("embed") && ready();
    let dense = [];
    if (useDense) {
      const qv = await jina.embedQuery(question);
      dense = index.denseSearch(qv, { model: model(), limit: cfg.candidates, titles, excludeLocal: true }).map((r) => ({ ...r, __src: "dense" }));
    }
    if (lex.length === 0 && dense.length === 0) return { rows: [], mode: useDense ? "hybrid" : "bm25" };

    const merged = rrfMerge([lex, dense]);
    const canRerank = jina.usable("rerank") && merged.length > 1;
    if (canRerank) {
      const pool = merged.slice(0, cfg.rerankPool);
      const docs = pool.map((p) => `${p.row.title}${p.row.page != null ? ` (hlm ${p.row.page})` : ""}\n${p.row.head ? `${p.row.head}\n` : ""}${p.row.text}`);
      const rr = await jina.rerank(question, docs, { topN: Math.min(pool.length, maxChunks + 6) });
      const kept = rr.filter((r) => cfg.rerankMin <= 0 || r.score >= cfg.rerankMin);
      const rows = kept.map((r) => {
        const p = pool[r.index];
        return { ...p.row, rrf: p.rrf, rr: r.score, score: -r.score, bm: Number.isFinite(p.row.bm) ? p.row.bm : 0 };
      });
      return { rows, mode: useDense ? "hybrid+rerank" : "bm25+rerank", top: rr[0]?.score ?? 0 };
    }
    // Tanpa reranker: potongan leksikal tetap; potongan hanya-vektor harus cukup mirip dan jumlahnya dibatasi.
    let extra = 0;
    const rows = [];
    for (const p of merged) {
      const lexical = p.from.has("lex");
      if (!lexical) {
        if (!(p.row.sim >= cfg.denseMin) || extra >= cfg.denseExtra) continue;
        extra += 1;
      }
      rows.push({ ...p.row, rrf: p.rrf, score: -p.rrf, bm: Number.isFinite(p.row.bm) ? p.row.bm : 0 });
    }
    return { rows, mode: useDense ? "hybrid" : "bm25" };
  }

  /**
   * -> { blocks, meta: { mode: "bm25"|"bm25+rerank"|"hybrid"|"hybrid+rerank", fallback?: string } }
   * `opts` sama dengan kb-index.search (budgetChars, maxChunks, titles, excludeLocal, ...).
   */
  async function searchWithMeta(question, opts = {}) {
    const plain = () => index.search(question, opts);
    const wantJina = opts.excludeLocal === true && !opts.onlyLocal && jina && jina.available() && (jina.usable("embed") || jina.usable("rerank"));
    if (!wantJina) {
      state.bm25 += 1;
      state.lastMode = "bm25";
      return { blocks: plain(), meta: { mode: "bm25" } };
    }
    try {
      const { rows, mode } = await withDeadline(hybridRows(question, opts), cfg.deadlineMs);
      state.hybrid += 1;
      state.lastMode = mode;
      state.lastAt = now();
      if (rows.length === 0) return { blocks: [], meta: { mode } };
      return { blocks: index.search(question, { ...opts, rows }), meta: { mode } };
    } catch (e) {
      state.fallbacks += 1;
      jina.noteFallback?.();
      state.lastError = e instanceof Error ? e.message : String(e);
      state.lastMode = "bm25";
      warnOnce(e?.kind || "x", `Jina tidak dipakai kali ini (${(e?.kind || "galat")}: ${state.lastError.slice(0, 120)}); memakai pencarian lokal.`);
      return { blocks: plain(), meta: { mode: "bm25", fallback: e?.kind || "error" } };
    }
  }

  return { search: async (q, o) => (await searchWithMeta(q, o)).blocks, searchWithMeta, status: () => ({ ...state, ready: ready(), cfg: { rerankMin: cfg.rerankMin, denseMin: cfg.denseMin } }) };
}

/**
 * Pekerja latar: memberi vektor pada potongan non-lokal yang belum punya. Pelan, bertahap, aman diulang.
 * tick() -> jumlah potongan yang di-embed pada putaran ini.
 */
export function createEmbedWorker({ index, jina, log = console, now = () => Date.now() }, overrides = {}) {
  const cfg = { intervalMs: num(process.env.JINA_EMBED_INTERVAL_MS, 60_000), perTick: num(process.env.JINA_EMBED_PER_TICK, 256), pause: num(process.env.JINA_EMBED_PAUSE_MS, 400), ...overrides };
  let timer = null;
  let busy = false;
  const state = { embedded: 0, lastError: null, lastAt: 0, backoffUntil: 0 };

  async function tick() {
    if (busy || !jina.usable("embed")) return 0;
    if (now() < state.backoffUntil) return 0;
    busy = true;
    let done = 0;
    try {
      const model = jina.cfg.embedModel;
      while (done < cfg.perTick) {
        const pend = index.pendingVectors(model, Math.min(jina.cfg.batchSize * 2, cfg.perTick - done));
        if (pend.length === 0) break;
        const vecs = await jina.embed(pend.map((p) => p.text), { task: "retrieval.passage" });
        index.putVectors(model, pend.map((p, i) => ({ docId: p.docId, seq: p.seq, vec: vecs[i] })));
        done += pend.length;
        if (cfg.pause > 0) await new Promise((r) => setTimeout(r, cfg.pause));
      }
      if (done > 0) {
        state.embedded += done;
        const st = index.vectorStats(model);
        log.log?.(`🧠 Embedding dokumen: +${done} potongan (${st.embedded}/${st.total}).`);
      }
      state.lastError = null;
    } catch (e) {
      state.lastError = e instanceof Error ? e.message : String(e);
      state.backoffUntil = now() + (e?.retryAfterMs || 120_000);
      log.warn?.(`🧠 Embedding dokumen berhenti sementara: ${state.lastError.slice(0, 140)}`);
    } finally {
      busy = false;
      state.lastAt = now();
    }
    return done;
  }

  return {
    tick,
    kick: () => {
      state.backoffUntil = 0;
      return tick();
    },
    status: () => ({ ...state, ...(jina.usable("embed") ? index.vectorStats(jina.cfg.embedModel) : {}) }),
    start() {
      if (timer || !jina.usable("embed")) return;
      timer = setInterval(() => tick().catch(() => {}), cfg.intervalMs);
      setTimeout(() => tick().catch(() => {}), 8000).unref?.();
      timer.unref?.();
      log.log?.(`🧠 Embedding dokumen (Jina ${jina.cfg.embedModel}) aktif, cek tiap ${Math.round(cfg.intervalMs / 1000)} dtk.`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

// ---------------------------------------------------------------- perintah pemilik: /jina
export function parseJinaCommand(text) {
  const m = /^\s*\/jina\b\s*(.*)$/is.exec(String(text || ""));
  if (!m) return null;
  const rest = m[1].trim();
  const [sub = "", ...args] = rest.split(/\s+/);
  return { sub: sub.toLowerCase(), arg: args.join(" ").trim() };
}


/** Ringkasan satu-dua baris untuk /status (WhatsApp & Telegram): key siap/jeda/rusak, vektor, statistik pencarian. */
export function describeJinaForStatus({ jina, hybrid = null, index = null } = {}) {
  if (!jina || !jina.available()) return "🧠 Jina: belum aktif (isi JINA_API_KEYS di .env)";
  const s = jina.status();
  const ready = s.keys.filter((k) => k.state === "siap").length;
  const rest = s.keys.filter((k) => /^jeda/.test(k.state)).length;
  const bad = s.keys.filter((k) => k.state === "rusak").length;
  const head = `🧠 Jina: ${ready} dari ${s.keys.length} key siap${rest ? ` • ${rest} jeda` : ""}${bad ? ` • ⚠️ ${bad} rusak/ditolak` : ""}` +
    ` • embed ${s.embed ? "on" : "off"}, rerank ${s.rerank ? "on" : "off"}, reader ${s.reader ? "on" : "off"}`;
  const vs = index?.vectorStats?.(jina.cfg.embedModel);
  const hs = hybrid?.status?.();
  const tail = [];
  if (vs) tail.push(`vektor ${vs.embedded}/${vs.total}${vs.ready ? "" : " (belum lengkap)"}`);
  if (hs) tail.push(`pencarian hibrida ${hs.hybrid}x, BM25 ${hs.bm25}x, fallback ${hs.fallbacks}x`);
  tail.push(`panggilan embed ${s.totals.embedCalls}, rerank ${s.totals.rerankCalls}`);
  const err = hs?.lastError ? `\n   galat terakhir: ${String(hs.lastError).slice(0, 120)}` : "";
  return `${head}\n   ${tail.join(" • ")}${err}`;
}

/** /jina (status) | /jina tes | /jina baca <url> | /jina embed (paksa isi vektor sekarang). -> teks balasan. */
export async function handleJinaCommand(cmd, { jina, hybrid = null, embedWorker = null, index = null, now = () => Date.now() } = {}) {
  if (!jina || !jina.available()) {
    return "🧠 Jina belum aktif. Isi `JINA_API_KEYS=key1,key2,...` di file .env di laptop (jangan kirim key ke chat), lalu restart bot.";
  }
  if (cmd.sub === "tes" || cmd.sub === "test") {
    const lines = ["🧠 Tes Jina:"];
    let t0 = now();
    try {
      const v = await jina.embed(["Berapa uang harian perjalanan dinas luar kota?"], { task: "retrieval.query" });
      lines.push(`• Embedding ${jina.cfg.embedModel}: OK (${v[0].length} dimensi, ${now() - t0} ms)`);
    } catch (e) {
      lines.push(`• Embedding: GAGAL (${e?.kind || "galat"}: ${String(e?.message || e).slice(0, 120)})`);
    }
    t0 = now();
    try {
      const r = await jina.rerank("uang harian perjalanan dinas", ["Uang harian adalah biaya makan dan transportasi lokal selama perjalanan dinas.", "Resep nasi goreng kampung."], { topN: 2 });
      lines.push(`• Reranker ${jina.cfg.rerankModel}: OK (${now() - t0} ms; teratas indeks ${r[0].index}, skor ${r[0].score.toFixed(2)}${r[0].index === 0 ? "" : " -- TIDAK sesuai harapan"})`);
    } catch (e) {
      lines.push(`• Reranker: GAGAL (${e?.kind || "galat"}: ${String(e?.message || e).slice(0, 120)})`);
    }
    return lines.join("\n");
  }
  if (cmd.sub === "baca" || cmd.sub === "reader") {
    if (!cmd.arg) return "Pakai: /jina baca <alamat URL>";
    if (!jina.usable("reader")) return "Pembaca URL (Jina Reader) mati. Nyalakan dengan JINA_READER=true di .env, lalu restart bot. Catatan: alamat URL yang dibaca dikirim ke Jina.";
    const t0 = now();
    try {
      const r = await jina.readUrl(cmd.arg.split(/\s+/)[0]);
      return `🧠 Reader OK (${now() - t0} ms${r.cached ? ", dari simpanan" : ""}): ${r.title || "(tanpa judul)"}\n${r.content.length} karakter${r.truncated ? " (dipotong)" : ""}\n\n${r.content.slice(0, 600)}${r.content.length > 600 ? "…" : ""}`;
    } catch (e) {
      return `🧠 Reader gagal (${e?.kind || "galat"}): ${String(e?.message || e).slice(0, 200)}`;
    }
  }
  if (cmd.sub === "embed" && embedWorker) {
    const n = await embedWorker.kick();
    const st = index?.vectorStats?.(jina.cfg.embedModel);
    return `🧠 Embedding diproses: +${n} potongan${st ? ` (${st.embedded}/${st.total})` : ""}${embedWorker.status().lastError ? `\nGalat terakhir: ${embedWorker.status().lastError.slice(0, 160)}` : ""}`;
  }
  const s = jina.status();
  const vs = index?.vectorStats?.(jina.cfg.embedModel);
  const hs = hybrid?.status?.();
  const lines = [
    "🧠 Jina (pembaca dokumen)",
    `Embedding: ${s.embed ? "aktif" : "mati"} (${s.embedModel}) • Reranker: ${s.rerank ? "aktif" : "mati"} (${s.rerankModel}) • Reader: ${s.reader ? "aktif" : "mati"}`,
    ...s.keys.map((k, i) => `Key ${i + 1} ${k.key}: ${k.state} • ok ${k.ok}, gagal ${k.fail}${k.last ? ` (${k.last})` : ""} • ±${k.tokens} token`)
  ];
  if (vs) lines.push(`Vektor dokumen: ${vs.embedded}/${vs.total} potongan${vs.ready ? " (siap)" : " (belum lengkap -- pencarian memakai BM25 + yang sudah ada)"}`);
  if (hs) lines.push(`Pencarian: hibrida ${hs.hybrid}x, BM25 saja ${hs.bm25}x, jatuh ke BM25 karena galat ${hs.fallbacks}x${hs.lastMode ? ` • terakhir: ${hs.lastMode}` : ""}${hs.lastError ? `\nGalat terakhir: ${hs.lastError.slice(0, 140)}` : ""}`);
  lines.push("Perintah: /jina tes • /jina embed • /jina baca <url>");
  return lines.join("\n");
}
