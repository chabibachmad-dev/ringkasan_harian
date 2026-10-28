// Alur penjaga balasan yang bergantung pada pemanggilan model (dipisah dari index.js supaya bisa dites tanpa menyalakan bot).
import { extractSearchRequest, guardReply, isEmptyAfterGuard } from "./reply-guard.js";

export const REPLY_GUARD_SAFE_TEXT = "Maaf, saya belum bisa memastikan jawabannya saat ini. Coba tanyakan lagi dengan kata kunci yang lebih spesifik, atau cek langsung ke sumber resmi yang bersangkutan.";
export const NO_SOURCE_NOTE = "\n\nCATATAN SISTEM: pencarian web TIDAK menemukan sumber untuk pertanyaan ini. Jawab bahwa kamu belum bisa memastikannya; jangan menyebut angka, nama, tanggal, atau link yang tidak tertulis di percakapan/dokumen. Jangan menulis kode kontrol seperti [SEARCH].";

const withText = (data, text) => ({ ...data, candidates: [{ content: { parts: [{ text }] } }] });

/**
 * @param {object} d
 * @param {(system:string, contents:object[], opts:object)=>Promise<object>} d.core   panggilan model; hasil boleh membawa _allowedUrls
 * @param {(data:object)=>string} d.extractText
 * @param {(q:string)=>Promise<object[]>} d.search
 * @param {(lastUserText:string, results:object[])=>string} d.ground  susun pesan pengguna + blok HASIL PENCARIAN WEB
 */
export async function guardedGenerate({ core, extractText, search, ground, systemText, contents, opts = {}, log = console }) {
  let data = await core(systemText, contents, opts);
  const lastText = contents[contents.length - 1]?.parts?.[0]?.text ?? "";
  const q = extractSearchRequest(extractText(data));
  if (q) {
    log.warn(`🛡️ [Penjaga] model meminta [SEARCH] "${q.slice(0, 80)}" (${data._provider || "?"}) -> dicarikan sungguhan.`);
    let results = [];
    try {
      if (!opts.pinnedDocs) results = await search(q);
    } catch (e) {
      log.error("🛡️ [Penjaga] pencarian gagal:", e instanceof Error ? e.message : String(e));
    }
    data = await core(
      results.length ? systemText : systemText + NO_SOURCE_NOTE,
      [...contents.slice(0, -1), { role: "user", parts: [{ text: ground(lastText, results) }] }],
      { ...opts, useSearch: false, webQuery: "", docChunks: [] }
    );
  }
  let g = guardReply(extractText(data), { allowedUrls: data._allowedUrls });
  if (isEmptyAfterGuard(g)) {
    log.warn("🛡️ [Penjaga] balasan kosong setelah disaring; minta model sekali lagi.");
    try {
      const again = await core(systemText + NO_SOURCE_NOTE, contents, { ...opts, useSearch: false, webQuery: "" });
      g = guardReply(extractText(again), { allowedUrls: again._allowedUrls });
      data = again;
    } catch {}
    if (isEmptyAfterGuard(g)) g = { ...g, text: REPLY_GUARD_SAFE_TEXT };
  }
  if (g.hadTags || g.removedUrls.length) log.warn(`🛡️ [Penjaga] tag dibuang=${g.hadTags}, URL dibuang=${g.removedUrls.length}${g.removedUrls.length ? ` (${g.removedUrls.join(", ").slice(0, 160)})` : ""}`);
  return withText(data, g.text);
}
