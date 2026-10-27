// Tes pencarian hibrida (jina-rag.js) + pekerja embedding, dengan Jina palsu & indeks SQLite di memori.
//   node test-jina-rag.mjs
import { openKbIndex } from "./kb-index.js";
import { createHybridSearch, createEmbedWorker, rrfMerge, describeJinaForStatus } from "./jina-rag.js";
import { JinaError } from "./jina.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };

// Vektor 4 dimensi: sumbu 0 = "perjalanan/biaya", sumbu 1 = "kendaraan", sumbu 2 = lain-lain.
const VEC = {
  harian: [1, 0, 0, 0],
  kendaraan: [0, 1, 0, 0],
  lain: [0, 0, 1, 0],
  cuaca: [0, 0, 0, 1]
};
const unit = (v) => { const n = Math.hypot(...v) || 1; return Float32Array.from(v.map((x) => x / n)); };
const vecOf = (text) => {
  const t = text.toLowerCase();
  if (/akomodasi|menginap|hotel|penginapan|uang harian|biaya perjalanan/.test(t)) return unit(VEC.harian);
  if (/cuaca/.test(t)) return unit(VEC.cuaca);
  if (/mobil|taksi|kendaraan|bbm/.test(t)) return unit(VEC.kendaraan);
  return unit(VEC.lain);
};

function fakeJina({ rerank = true, embed = true, failEmbed = null, failRerank = null, rerankScores = null } = {}) {
  const log = { embed: [], query: [], rerank: [] };
  return {
    log,
    cfg: { embedModel: "jina-embeddings-v3", batchSize: 8 },
    available: () => true,
    usable: (k) => (k === "embed" ? embed : k === "rerank" ? rerank : false),
    embed: async (texts) => {
      if (failEmbed) throw failEmbed;
      log.embed.push(...texts);
      return texts.map(vecOf);
    },
    embedQuery: async (q) => {
      if (failEmbed) throw failEmbed;
      log.query.push(q);
      return vecOf(q);
    },
    rerank: async (q, docs, { topN }) => {
      if (failRerank) throw failRerank;
      log.rerank.push(...docs);
      const scores = rerankScores ? docs.map((d, i) => rerankScores(d, i)) : docs.map((d) => (/akomodasi|penginapan/i.test(d) ? 0.9 : 0.01));
      return scores.map((score, index) => ({ index, score })).sort((a, b) => b.score - a.score).slice(0, topN);
    },
    noteFallback() {}
  };
}

const idx = await openKbIndex({ file: ":memory:", log: silent });
const pad = (s) => `${s}\n` + "kalimat pengisi netral tentang administrasi umum. ".repeat(6);
idx.upsertDoc({
  id: "kb:pmk",
  title: "PMK 32 Tahun 2025 SBM",
  pages: [
    { page: 1, text: pad("Ketentuan umum standar biaya masukan. Lampiran memuat batas tertinggi.") },
    { page: 2, text: pad("Biaya akomodasi bagi pejabat eselon III: batas tertinggi per malam sebesar Rp1.200.000.") },
    { page: 3, text: pad("Taksi dan kendaraan dinas: biaya mobil sewaan ditetapkan per hari.") },
    { page: 4, text: pad("Ketentuan penutup dan mulai berlaku pada tanggal diundangkan.") }
  ]
});
idx.upsertDoc({
  id: "local:rahasia.md",
  title: "Komitmen Bersama PPK (internal)",
  pages: [{ page: 1, text: pad("Dokumen internal rahasia mengenai penginapan dan hotel pejabat.") }]
});

// ---- pekerja embedding
{
  const j = fakeJina();
  const w = createEmbedWorker({ index: idx, jina: j, log: silent }, { pause: 0, perTick: 100 });
  const n = await w.tick();
  const st = idx.vectorStats("jina-embeddings-v3");
  check(n > 0 && st.embedded === st.total && st.ready, "pekerja embedding mengisi semua potongan non-lokal");
  check(j.log.embed.every((t) => !/rahasia|Komitmen/i.test(t)), "dokumen lokal TIDAK dikirim untuk di-embed");
  check((await w.tick()) === 0, "tick kedua tidak mengulang pekerjaan");
  const e = fakeJina({ failEmbed: new JinaError("rate", "429", { retryAfterMs: 30000 }) });
  idx.upsertDoc({ id: "kb:baru", title: "Dokumen baru", pages: [{ page: 1, text: pad("isi baru tentang menginap") }] });
  const w2 = createEmbedWorker({ index: idx, jina: e, log: silent }, { pause: 0 });
  check((await w2.tick()) === 0 && /429/.test(w2.status().lastError), "galat Jina: pekerja berhenti & mencatat, tidak melempar");
  check((await w2.tick()) === 0 && e.log.embed.length === 0, "setelah galat ada jeda (backoff), tidak memukul Jina lagi");
  await w.tick();
  check(idx.vectorStats("jina-embeddings-v3").ready, "dokumen baru ikut di-embed");
  idx.removeDoc("kb:baru");
  check(idx.vectorStats("jina-embeddings-v3").ready, "dokumen dibuang -> vektornya ikut terhapus");
  idx.putVectors("jina-embeddings-v3", [{ docId: "local:rahasia.md", seq: 0, vec: unit([1, 0, 0, 0]) }]);
  check(idx.denseSearch(unit([1, 0, 0, 0]), { model: "jina-embeddings-v3", limit: 50 }).every((r) => !r.doc_id.startsWith("local:")), "vektor dokumen lokal ditolak / tak pernah dicari");
}

// ---- pencarian vektor menemukan padanan makna tanpa kata yang sama
{
  const rows = idx.denseSearch(unit([1, 0, 0, 0]), { model: "jina-embeddings-v3", limit: 3 });
  check(rows.length > 0 && rows[0].page === 2, "denseSearch: potongan akomodasi paling mirip");
}

// ---- hibrida + reranker
{
  const j = fakeJina();
  const h = createHybridSearch({ index: idx, jina: j, log: silent });
  const r = await h.searchWithMeta("berapa batas biaya menginap eselon III", { excludeLocal: true, budgetChars: 3000, maxChunks: 4 });
  check(r.meta.mode === "hybrid+rerank", "mode hybrid+rerank");
  check(r.blocks.length > 0 && r.blocks.some((b) => b.page === 2 && /\[Halaman 2\]/.test(b.text) && /1\.200\.000/.test(b.text)), "blok terbaik = halaman 2 dengan angka, ber-[Halaman n]");
  check(j.log.rerank.every((d) => !/Komitmen|rahasia/i.test(d)), "dokumen lokal tidak ikut dikirim ke reranker");
  const r2 = await h.searchWithMeta("tarif hotel malam", { excludeLocal: true, budgetChars: 3000, maxChunks: 4 });
  check(r2.blocks.some((b) => /Halaman 2/.test(b.text)), "pertanyaan tanpa kata yang sama ('hotel') tetap menemukan halaman akomodasi lewat makna");
}

// ---- bukti tipis -> kosong
{
  const j = fakeJina({ rerankScores: () => 0.001 });
  const h = createHybridSearch({ index: idx, jina: j, log: silent });
  const r = await h.searchWithMeta("jelaskan cara membuat rendang yang enak sekali", { excludeLocal: true });
  check(r.blocks.length === 0, "semua skor reranker di bawah ambang -> tidak ada blok (tidak ada di dokumen)");
}

// ---- tanpa reranker: ambang kemiripan vektor
{
  const j = fakeJina({ rerank: false });
  const h = createHybridSearch({ index: idx, jina: j, log: silent });
  const r = await h.searchWithMeta("berapa batas biaya menginap eselon III", { excludeLocal: true, budgetChars: 3000 });
  check(r.meta.mode === "hybrid" && r.blocks.some((b) => b.page === 2), "tanpa reranker: tetap hibrida via RRF");
  const r2 = await h.searchWithMeta("cuaca besok di kota apa saja bagaimana", { excludeLocal: true });
  check(r2.blocks.length === 0, "tanpa reranker: potongan hanya-vektor yang tak cukup mirip tidak masuk");
}

// ---- fallback bila Jina gagal
for (const [name, opts] of [["embed 429", { failEmbed: new JinaError("rate", "429") }], ["rerank 5xx", { failRerank: new JinaError("server", "500") }], ["semua key jeda", { failEmbed: new JinaError("unavailable", "jeda") }]]) {
  const j = fakeJina(opts);
  const h = createHybridSearch({ index: idx, jina: j, log: silent });
  const plain = idx.search("berapa batas biaya menginap eselon III", { excludeLocal: true, budgetChars: 3000 });
  const r = await h.searchWithMeta("berapa batas biaya menginap eselon III", { excludeLocal: true, budgetChars: 3000 });
  check(r.meta.mode === "bm25" && r.meta.fallback && JSON.stringify(r.blocks.map((b) => b.text)) === JSON.stringify(plain.map((b) => b.text)), `fallback ke BM25 persis seperti sebelumnya (${name})`);
}
{
  const j = fakeJina();
  j.rerank = () => new Promise(() => {});
  const h = createHybridSearch({ index: idx, jina: j, log: silent }, { deadlineMs: 50 });
  const t0 = Date.now();
  const r = await h.searchWithMeta("berapa batas biaya menginap eselon III", { excludeLocal: true });
  check(r.meta.fallback === "timeout" && Date.now() - t0 < 1000 && r.blocks.length > 0, "Jina menggantung -> batas waktu lalu BM25");
}

// ---- privasi: jalur yang boleh membaca dokumen lokal TIDAK memakai Jina
{
  const j = fakeJina();
  const h = createHybridSearch({ index: idx, jina: j, log: silent });
  const a = await h.searchWithMeta("penginapan hotel pejabat", { excludeLocal: false });
  const b = await h.searchWithMeta("penginapan hotel pejabat", { onlyLocal: true });
  check(a.meta.mode === "bm25" && b.meta.mode === "bm25" && j.log.query.length === 0 && j.log.rerank.length === 0, "excludeLocal=false / onlyLocal: Jina tidak dipanggil sama sekali");
  check(b.blocks.length > 0 && b.blocks.every((x) => x.docId.startsWith("local:")), "onlyLocal tetap menemukan dokumen lokal lewat BM25");
}
{
  const h = createHybridSearch({ index: idx, jina: null, log: silent });
  const r = await h.searchWithMeta("batas biaya menginap", { excludeLocal: true });
  check(r.meta.mode === "bm25" && r.blocks.length > 0, "tanpa objek Jina: BM25 saja");
}

// ---- RRF
{
  const L = [{ doc_id: "a", seq: 0, __src: "lex", score: -1 }, { doc_id: "b", seq: 0, __src: "lex", score: -1 }];
  const D = [{ doc_id: "b", seq: 0, __src: "dense", sim: 0.9 }, { doc_id: "c", seq: 0, __src: "dense", sim: 0.8 }];
  const m = rrfMerge([L, D]);
  check(m[0].row.doc_id === "b" && m[0].from.has("lex") && m[0].from.has("dense") && m[0].row.sim === 0.9, "RRF: yang muncul di dua daftar naik, sim dipertahankan");
}

// ---- ringkasan untuk /status
{
  const keys = [{ key: "jina_…aaaa", state: "siap", ok: 3, fail: 0, tokens: 10, last: null }, { key: "jina_…bbbb", state: "jeda 40 dtk", ok: 1, fail: 1, tokens: 5, last: "rate" }, { key: "jina_…cccc", state: "rusak", ok: 0, fail: 2, tokens: 0, last: "auth" }];
  const j = { available: () => true, cfg: { embedModel: "m" }, status: () => ({ embed: true, rerank: true, reader: false, keys, totals: { embedCalls: 7, rerankCalls: 4 } }) };
  const t = describeJinaForStatus({ jina: j, hybrid: { status: () => ({ hybrid: 5, bm25: 2, fallbacks: 1, lastError: "429" }) }, index: { vectorStats: () => ({ embedded: 10, total: 12, ready: false }) } });
  check(/1 dari 3 key siap/.test(t) && /1 jeda/.test(t) && /1 rusak/.test(t) && /vektor 10\/12 \(belum lengkap\)/.test(t) && /hibrida 5x/.test(t) && /galat terakhir: 429/.test(t), "ringkasan /status: key siap/jeda/rusak, vektor, statistik, galat");
  check(!/jina_/.test(t), "ringkasan /status tidak menampilkan key");
  check(/belum aktif/.test(describeJinaForStatus({ jina: { available: () => false } })), "tanpa key: 'belum aktif'");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua tes pencarian hibrida lulus.");
