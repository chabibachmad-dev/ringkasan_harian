// Daftar periksa (checklist) dari "Komitmen Bersama PPK" — dokumen INTERNAL, jadi 100% lokal.
//
//   /komitmen               -> daftar bagian (A, B, C…) + cara pakai
//   /komitmen cek <uraian>  -> butir komitmen yang paling relevan sebagai checklist ☐ + halaman
//   /komitmen <uraian>      -> sama dengan "cek"
//
// PRIVASI: hanya membaca dokumen berid `local:` dari indeks SQLite di laptop (kb-index). Tidak memanggil model apa pun
// (tanpa Ollama, tanpa Gemini, tanpa Jina) — murni mencocokkan kata & mengutip butir apa adanya. Karena itu tidak
// mungkin "mengarang" aturan: yang tampil hanya kalimat yang memang tertulis di dokumen, lengkap dengan nomor halaman.
// Pemakaian: hanya pemilik (dipasang di handleWaOwnerLocalCommands).
import { stemText } from "./id-stem.js";

export function parseKomitmenCommand(text) {
  const m = /^\s*\/komitmen(?:@\w+)?\b[\s:,-]*([\s\S]*)$/i.exec(String(text ?? ""));
  if (!m) return null;
  let arg = m[1].trim();
  const cek = /^(?:cek|periksa|checklist|check)\b[\s:,-]*/i.exec(arg);
  if (cek) arg = arg.slice(cek[0].length).trim();
  return { query: arg, list: arg === "" || /^(daftar|list|ls|bagian)$/i.test(arg) };
}

const STOP = new Set(
  "yang dan untuk dengan dari dalam pada atau akan agar bagi oleh sebagai adalah itu ini saya kami kita mau ingin apa bagaimana berapa apakah tolong bisa dapat harus wajib sudah belum tidak ada para serta jika bila maka cek periksa komitmen".split(" ")
);
const FOOTER = /^\s*Halaman\s+\d+\s+dari\s+\d+\s*$/i;
const HEADER = /^\s*KOMITMEN BERSAMA PPK\b/i;
const MARK = /^(\s*)([A-Z]|[a-z]|\d{1,2})\.\s+(\S.*)$/;

/** Teks dokumen ber-[Halaman n] -> { sections:[{key,title,page}], items:[{section,path,marker,text,page}] }. */
export function parseKomitmen(text) {
  const sections = [];
  const items = [];
  let page = null;
  let sec = null; // {key,title}
  let sub = null; // judul sub-bagian bernomor (mis. "Ketentuan Umum")
  let cur = null;

  const flush = () => {
    if (!cur) return;
    cur.text = cur.text.replace(/\s+/g, " ").trim();
    if (cur.text.length >= 25) items.push(cur);
    cur = null;
  };
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const pm = /^\[Halaman (\d+)\]\s*$/.exec(raw);
    if (pm) {
      page = Number(pm[1]);
      continue;
    }
    if (FOOTER.test(raw) || HEADER.test(raw)) continue;
    if (!raw.trim()) {
      flush();
      continue;
    }
    const m = MARK.exec(raw);
    const indent = m ? m[1].length : 0;
    if (m && /^[A-Z]$/.test(m[2]) && indent <= 1 && m[3].length < 80) {
      // "A. Pelaksanaan Perjalanan Dinas" = bagian utama
      flush();
      sec = { key: m[2], title: m[3].trim(), page };
      sections.push(sec);
      sub = null;
      continue;
    }
    if (m && /^\d{1,2}$/.test(m[2]) && indent <= 4) {
      flush();
      // Lihat baris bermarka berikutnya: bila berupa "a." maka ini judul sub-bagian, bukan butir.
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || FOOTER.test(lines[j]) || HEADER.test(lines[j]) || /^\[Halaman/.test(lines[j]))) j++;
      const nx = j < lines.length ? MARK.exec(lines[j]) : null;
      if (nx && nx[2] === "a") {
        sub = `${m[2]}. ${m[3].trim()}`;
        continue;
      }
      if (sec) {
        cur = { section: sec.key, sectionTitle: sec.title, sub: null, marker: `${m[2]}.`, text: m[3].trim(), page };
        continue;
      }
    }
    if (m && /^[a-z]$/.test(m[2]) && sec && indent >= 1) {
      flush();
      cur = { section: sec.key, sectionTitle: sec.title, sub, marker: `${m[2]}.`, text: m[3].trim(), page };
      continue;
    }
    if (cur) cur.text += ` ${raw.trim()}`;
  }
  flush();
  return { sections, items };
}

const tokens = (s) =>
  [...new Set(stemText(s).split(" ").filter((t) => t.length >= 3 && !STOP.has(t)))];

/** Peringkat butir berdasarkan irisan batang kata dengan uraian; mengembalikan [{item, score}] (skor > 0). */
export function rankItems(items, query, { limit = 8 } = {}) {
  const qWords = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  if (qWords.length === 0) return [];
  const qStems = qWords.map((w) => new Set(stemText(w).split(" ").filter(Boolean)));
  const scored = [];
  for (const it of items) {
    const hay = new Set(tokens(`${it.sub || ""} ${it.sectionTitle} ${it.text}`));
    const body = new Set(tokens(it.text));
    let score = 0;
    for (const st of qStems) {
      let hit = 0;
      for (const s of st) {
        if (body.has(s)) hit = Math.max(hit, 2);
        else if (hay.has(s)) hit = Math.max(hit, 1);
      }
      score += hit;
    }
    if (score > 0) scored.push({ item: it, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.item.page ?? 0) - (b.item.page ?? 0));
  // Ambang: minimal separuh dari kata kunci uraian harus kena, supaya tidak menampilkan butir yang kebetulan mengandung satu kata umum.
  const need = Math.max(2, Math.ceil(qWords.length * 0.5));
  return scored.filter((s) => s.score >= Math.min(need, scored[0]?.score ?? need)).slice(0, limit);
}

const clip = (s, n = 260) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Pasang ke indeks lokal. `getIndex` dipanggil tiap kali (indeks baru siap setelah start). */
export function createKomitmen({ getIndex, docPattern = /komitmen\s*bersama/i } = {}) {
  let cache = { id: null, sig: null, parsed: null };

  function findDoc() {
    const idx = getIndex?.();
    if (!idx) return { error: "📂 Indeks dokumen belum aktif." };
    const docs = idx.listDocs().filter((d) => d.id.startsWith("local:") && (docPattern.test(d.title || "") || docPattern.test(d.filename || "") || docPattern.test(d.id)));
    if (docs.length === 0) {
      return { error: "📂 Dokumen *Komitmen Bersama PPK* belum ada di dokumen lokal.\nTaruh PDF-nya di folder dokumen/peraturan-pdf (atau unggah lewat menu \"PDF → MD\"), tunggu sampai selesai dikonversi, lalu coba lagi. Dokumen ini hanya diproses di laptop (tidak dikirim ke layanan luar)." };
    }
    const d = docs[0];
    const sig = `${d.id}|${d.indexed_at}|${d.chars}`;
    if (cache.sig !== sig) cache = { id: d.id, sig, parsed: parseKomitmen(idx.getDocText(d.id)), title: d.title };
    return { doc: d, parsed: cache.parsed };
  }

  function handle(cmd) {
    const f = findDoc();
    if (f.error) return f.error;
    const { sections, items } = f.parsed;
    if (items.length === 0) return "📂 Dokumen Komitmen Bersama terbaca, tetapi butirnya tidak berhasil dikenali (format berbeda dari biasanya). Coba tanya lewat `/dokumen`.";
    if (cmd.list) {
      const perSec = sections.map((s) => `• *${s.key}. ${s.title}*${s.page ? ` (hlm ${s.page})` : ""} — ${items.filter((i) => i.section === s.key).length} butir`);
      return [
        `📋 *${f.doc.title || "Komitmen Bersama PPK"}* (dokumen lokal)`,
        ...perSec,
        "",
        "Pakai: `/komitmen cek perjalanan dinas fullboard` atau `/komitmen konsumsi rapat`.",
        "Hanya butir yang tertulis di dokumen yang ditampilkan, lengkap dengan halaman; tidak ada isian dari model."
      ].join("\n");
    }
    const ranked = rankItems(items, cmd.query, { limit: 8 });
    if (ranked.length === 0) return `🔎 Tidak ditemukan butir Komitmen Bersama yang cocok dengan "${clip(cmd.query, 80)}".\nCoba kata kunci lain (mis. "BBM", "fullboard", "konsumsi", "tagihan", "surat tugas") atau ketik /komitmen untuk melihat daftar bagian.`;
    const lines = ranked.map(({ item }) => `☐ ${clip(item.text)}\n   _${item.section}${item.sub ? ` › ${item.sub.replace(/^\d+\.\s*/, "")}` : ""} › butir ${item.marker.replace(/\.$/, "")}${item.page ? ` — hlm ${item.page}` : ""}_`);
    return [`📋 *Checklist Komitmen Bersama* untuk: ${clip(cmd.query, 100)}`, "", ...lines, "", `📚 Sumber: ${f.doc.title || "Komitmen Bersama PPK"} (dokumen lokal). Hanya butir yang tertulis di dokumen; angka/tarif resmi tetap lihat PMK 32/2025.`].join("\n");
  }

  return { handle, findDoc };
}
