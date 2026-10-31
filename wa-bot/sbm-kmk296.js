// ================================================================
// Pencarian angka SBM menurut KMK 296/2026 (Rincian Besaran Standar Biaya Masukan) -- konteks untuk AI, BUKAN kalkulator.
//
// BEDA dengan sbm.js: sbm.js = kalkulator perjalanan dinas DETERMINISTIK dari tabel PMK 32/2025 (menjawab sendiri,
// tanpa AI). Modul ini hanya MENCARI baris data resmi KMK 296/2026 (data/kmk-296-2026/*.jsonl, ~8.200 baris: honorarium,
// perjalanan dinas, barang & jasa, dst.) dengan BM25 lalu menyisipkannya ke konteks AI sebagai blok
// "DATA RESMI KMK 296/2026" (atau potongan penjelasan ketentuan dari kmk-296-2026-penjelasan.md). AI yang menyusun jawaban,
// dengan aturan: kutip angka persis, jangan membulatkan/menghitung ulang, kalau tak ada -> "belum bisa memastikan".
//
//   createSbmKmk296({ dir }).contextFor(teks) -> { kind: "angka"|"aturan"|null, chunks: [{ score, distinct, title, text, page }] }
//
// chunks berbentuk sama dengan potongan dokumen (docChunks) supaya ikut jalur konteks dokumen yang sudah ada.
// ================================================================
import fs from "node:fs";
import path from "node:path";

export const KMK296_TITLE = "DATA RESMI KMK 296/2026";

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const STOP = new Set(
  "yang dan di ke dari untuk dengan atau pada adalah itu ini apa berapa apakah ada kah dong sih ya nya saya aku kita bisa boleh bagaimana gimana kalau jika sebesar sebesarnya tolong mohon dalam atas oleh sebagai per se".split(" ")
);
// Kata pemicu yang tidak membedakan baris data (hampir semua baris "tarif/biaya"): tidak dihitung dalam cakupan.
const NOISE = new Set(["tarif", "biaya", "besaran", "berapa"]);
const ALIAS = { honor: "honorarium", sbm: "standar biaya", ppk: "pejabat pembuat komitmen" };

export function tokenize(text) {
  const out = [];
  for (const w of norm(text).split(" ")) {
    if (!w || STOP.has(w)) continue;
    out.push(ALIAS[w] ? norm(ALIAS[w]).split(" ") : w);
  }
  return out.flat();
}

// Pertanyaan menyangkut angka biaya? (pemicu pencarian baris data)
const COST_RE = /\b(biaya|honor|honorarium|uang harian|uang saku|uang representasi|tarif|standar biaya|satuan biaya|sbm|sbk|kmk\s*296|besaran)\b/i;
// Pertanyaan tentang ketentuan pemakaian satuan biaya (bukan angka)
const RULE_RE = /\b(aturan|ketentuan|syarat|persyaratan|kriteria|dapat dilampaui|batas tertinggi|penjelasan|dasar hukum|berlaku|diperbolehkan|dilarang|mekanisme|pengertian|definisi)\b/i;
// Aturan hanya dipicu bila jelas membahas SBM/KMK 296, agar "aturan main" biasa tidak ikut.
const SBM_TOPIC_RE = /\b(kmk\s*296|sbm|sbk|standar biaya|satuan biaya|honorarium|uang harian)\b/i;
// Hanya kalau penanya jelas menyebut SBM/KMK 296 kami berani menjawab "tidak ditemukan" (bukan obrolan biasa berisi kata "biaya").
const EXPLICIT_RE = /\b(kmk\s*296|sbm|sbk|standar biaya|satuan biaya|honorarium|uang harian|uang representasi)\b/i;

export const isCostQuestion = (t) => COST_RE.test(String(t ?? ""));
export const isRuleQuestion = (t) => RULE_RE.test(String(t ?? "")) && SBM_TOPIC_RE.test(String(t ?? ""));

export const ANSWER_RULES = [
  "ATURAN MENJAWAB DATA RESMI KMK 296/2026:",
  "- Kutip angka PERSIS seperti di data, lengkap dengan satuan (mis. \"per OB (Orang/Bulan)\"), kode, dan halaman. Jangan membulatkan, jangan menghitung ulang, jangan mengubah format angka.",
  "- Pakai hanya baris yang benar-benar cocok dengan pertanyaan; kalau ada beberapa pilihan (wilayah, tingkat, jabatan), sebutkan yang relevan atau tanyakan yang dimaksud.",
  "- Kalau tidak ada baris yang cocok, jawab \"belum bisa memastikan\" angkanya dan JANGAN mengarang angka."
].join("\n");

// ---------------------------------------------------------------- BM25
function buildBm25(docs, k1 = 1.5, b = 0.75) {
  const tf = [];
  const df = new Map();
  const len = [];
  for (const d of docs) {
    const m = new Map();
    for (const t of tokenize(d)) m.set(t, (m.get(t) || 0) + 1);
    tf.push(m);
    len.push([...m.values()].reduce((a, c) => a + c, 0));
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = docs.length;
  const avg = len.reduce((a, c) => a + c, 0) / Math.max(n, 1) || 1;
  const idf = (t) => Math.log(1 + (n - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  return {
    size: n,
    /**
     * -> [{ i, score, coverage }] terurut turun. coverage = bobot (idf) kata pertanyaan yang ada di dokumen / bobot semua kata
     * pertanyaan; kata yang tak ada di data sama sekali (salah ketik, asing) memberi bobot tertinggi -> menurunkan coverage.
     */
    search(query, limit) {
      const all = [...new Set(tokenize(query))].filter((t) => !NOISE.has(t));
      const qs = all.filter((t) => df.has(t));
      if (qs.length === 0) return [];
      const idfOf = (t) => (df.has(t) ? idf(t) : Math.log(1 + (n + 0.5) / 0.5));
      const total = all.reduce((a, t) => a + idfOf(t), 0);
      const hits = [];
      for (let i = 0; i < n; i++) {
        let s = 0;
        let hit = 0;
        for (const t of qs) {
          const f = tf[i].get(t);
          if (!f) continue;
          hit += idf(t);
          s += idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len[i]) / avg)));
        }
        if (s > 0) hits.push({ i, score: s, coverage: hit / total });
      }
      hits.sort((a, c) => c.score - a.score || a.i - c.i);
      return hits.slice(0, limit);
    }
  };
}

// ---------------------------------------------------------------- pemuatan
export function loadKmk296(dir) {
  const jsonl = path.join(dir, "kmk-296-2026-sbm.jsonl");
  const rows = fs
    .readFileSync(jsonl, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  let sections = [];
  try {
    const md = fs.readFileSync(path.join(dir, "kmk-296-2026-penjelasan.md"), "utf8");
    sections = md
      .split(/^## /m)
      .slice(1)
      .map((s) => {
        const nl = s.indexOf("\n");
        const heading = s.slice(0, nl).trim();
        return { heading, page: Number(/halaman\s+(\d+)/i.exec(heading)?.[1]) || null, body: s.slice(nl + 1).trim() };
      })
      .filter((s) => s.body);
  } catch {
    /* penjelasan opsional */
  }
  return { rows, sections };
}

export function createSbmKmk296({ dir, maxRows = 8, minRows = 5, maxRuleSections = 2, ruleChars = 2500 } = {}) {
  const { rows, sections } = loadKmk296(dir);
  const rowIndex = buildBm25(rows.map((r) => r.teks));
  const secIndex = buildBm25(sections.map((s) => `${s.heading} ${s.body}`));

  /** Baris data teratas (5-8) untuk pertanyaan; [] bila tak ada yang cukup cocok. */
  function searchRows(query) {
    const hits = rowIndex.search(query, maxRows);
    if (hits.length === 0) return [];
    // Hit teratas harus mencakup cukup bobot kata pertanyaan; kalau tidak -> dianggap tidak ada (hindari angka nyasar).
    // Tanpa penyebutan SBM/KMK/honorarium/uang harian yang eksplisit (mis. "biaya kuliah anak"), syaratnya lebih ketat.
    const top = hits[0];
    if (top.coverage < (EXPLICIT_RE.test(query) ? 0.6 : 0.85)) return [];
    const floor = top.score * 0.35;
    const keep = hits.filter((h, k) => k < minRows || h.score >= floor);
    return keep.map((h) => ({ ...rows[h.i], score: h.score }));
  }

  function searchRules(query) {
    return secIndex
      .search(query, maxRuleSections)
      .filter((h) => h.coverage >= 0.3)
      .map((h) => ({ ...sections[h.i], score: h.score }));
  }

  function contextFor(text) {
    const q = String(text ?? "");
    const wantRule = isRuleQuestion(q);
    const wantCost = isCostQuestion(q);
    if (!wantRule && !wantCost) return { kind: null, chunks: [] };

    if (wantRule && !/\b(berapa|besaran|tarif)\b/i.test(q)) {
      const secs = searchRules(q);
      if (secs.length > 0) {
        const body = secs.map((s) => `[Halaman ${s.page ?? "?"}] ${s.heading}\n${s.body.slice(0, ruleChars)}`).join("\n\n");
        return {
          kind: "aturan",
          chunks: [
            {
              score: secs[0].score,
              distinct: 0,
              title: KMK296_TITLE,
              page: secs[0].page,
              text: `KETENTUAN (teks resmi KMK 296/2026, bagian Penjelasan/diktum):\n${body}\n\nJawab ketentuan hanya dari teks di atas; sebut halamannya. Kalau tidak tertulis di sana, jawab \"belum bisa memastikan\".`
            }
          ]
        };
      }
    }

    const found = searchRows(q);
    if (found.length === 0) {
      if (!EXPLICIT_RE.test(q)) return { kind: null, chunks: [] };
      return {
        kind: "angka",
        chunks: [
          {
            score: 0,
            distinct: 0,
            title: KMK296_TITLE,
            page: null,
            text: `Tidak ada baris data KMK 296/2026 yang cocok dengan pertanyaan ini.\n${ANSWER_RULES}`
          }
        ]
      };
    }
    const lines = found.map((r) => `- ${r.teks} [Halaman ${r.halaman}]`).join("\n");
    return {
      kind: "angka",
      chunks: [{ score: found[0].score, distinct: 0, title: KMK296_TITLE, page: found[0].halaman, text: `${lines}\n\n${ANSWER_RULES}` }]
    };
  }

  return { contextFor, searchRows, searchRules, stats: { rows: rows.length, sections: sections.length } };
}
