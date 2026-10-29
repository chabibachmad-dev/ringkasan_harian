// Gambar/video/dokumen + keterangan yang menyebut bot di grup: deteksi sebutan, pertanyaan selera, dan rantai model penglihat.
// Murni (tanpa jaringan): pemanggil menyuntikkan fungsi unduh & model supaya mudah diuji.
import { guardReply, isEmptyAfterGuard } from "./reply-guard.js";
import { IMAGE_QA_SYSTEM } from "./visual.js";

const CTX_KEYS = ["extendedTextMessage", "imageMessage", "videoMessage", "documentMessage", "audioMessage", "stickerMessage"];

/** Semua mentionedJid dari setiap jenis pesan (teks, gambar, video, dokumen, audio, stiker). */
export function collectMentionedJids(content) {
  const out = [];
  for (const k of CTX_KEYS) {
    const list = content?.[k]?.contextInfo?.mentionedJid;
    if (Array.isArray(list)) out.push(...list);
  }
  return out;
}

/** Bot disebut lewat mentionedJid pada jenis pesan apa pun? `normalize` menyeragamkan sufiks JID. */
export function isMentionedIn(content, ownJids, normalize = (j) => j) {
  return collectMentionedJids(content).some((j) => ownJids.includes(normalize(j)));
}

const TASTE_RE = /\b(?:paling\s+)?(?:bagus|menarik|cakep|keren|estetik|indah|cantik|unik|rapi|favorit|cocok|enak dilihat|mending|lebih\s+\w+)\b|\bmana\s+(?:yang|ya|nih|menurut)|\byang\s+mana\b|\bpilih(?:an)?\b/i;

/** Pertanyaan selera ("mana yang paling bagus/menarik?"): harus dijawab dengan satu pilihan. */
export function isTasteQuestion(text) {
  const t = String(text ?? "").trim();
  return t.length > 0 && t.length <= 300 && TASTE_RE.test(t);
}

/** Gambar yang DILAMPIRKAN bersama sebutan bot selalu dijawab; gambar yang dikutip tetap perlu terdengar bertanya soal gambar. */
export function shouldAnswerImage({ attached, quoted, text, looksLikeQuestion }) {
  if (attached) return true;
  return Boolean(quoted) && (isTasteQuestion(text) || looksLikeQuestion(text));
}

export const TASTE_RULES =
  "INI PERTANYAAN SELERA (mana yang paling bagus/menarik/cocok): JAWAB, jangan menolak dengan alasan tidak bisa menilai. Pilih TEPAT SATU yang kamu anggap terbaik dan sebutkan dengan jelas (nama/teks/posisinya di gambar), lalu beri 2-3 alasan singkat yang benar-benar tampak di gambar: warna, keterbacaan, kesederhanaan, kekhasan bentuk. Jangan mengarang detail yang tidak terlihat; kalau ada yang kurang jelas, katakan. Boleh menutup dengan \"ini soal selera sih\". Maksimal 5 kalimat pendek.";

export function buildImageSystem({ taste = false, persona = "" } = {}) {
  return `${IMAGE_QA_SYSTEM}${taste ? `\n\n${TASTE_RULES}` : ""}${persona || ""}`;
}

export const MSG_DOWNLOAD_FAIL = "Gambarnya gagal kubaca, coba kirim ulang ya 🙏";
export const MSG_VISION_FAIL = "Gambarnya gagal kubaca (AI penglihatanku lagi bermasalah), coba kirim ulang sebentar lagi ya 🙏";
export const MSG_EMPTY = "Aku melihatnya, tapi bingung mau bilang apa 😅";

/**
 * Coba tiap model penglihat berurutan sampai satu menjawab.
 * @returns {Promise<{ok:true,text:string,model:string}|{ok:false,reason:"vision"|"empty",errors:string[]}>}
 */
export async function askVisionChain({ visions, system, user, image, maxChars = 700 }) {
  const errors = [];
  let sawEmpty = false;
  for (const v of visions) {
    try {
      const raw = await v.run({ system, user, image });
      const g = guardReply(String(raw ?? ""), { doubleBracket: true, allowedUrls: [] });
      const text = g.text.replace(/@\d{5,}/g, "").trim().slice(0, maxChars);
      if (isEmptyAfterGuard({ text })) {
        sawEmpty = true;
        errors.push(`${v.name}: jawaban kosong`);
        continue;
      }
      return { ok: true, text, model: v.name };
    } catch (e) {
      errors.push(`${v.name}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  return { ok: false, reason: sawEmpty && errors.every((x) => x.includes("kosong")) ? "empty" : "vision", errors };
}
