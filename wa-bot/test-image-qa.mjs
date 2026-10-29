// Tes gambar/video/dokumen + sebutan bot di grup. Jalankan: node test-image-qa.mjs
import assert from "node:assert/strict";
import { askVisionChain, buildImageSystem, collectMentionedJids, isMentionedIn, isTasteQuestion, shouldAnswerImage, MSG_VISION_FAIL } from "./image-qa.js";
import { looksLikeImageQuestion } from "./visual.js";

let n = 0;
async function ok(name, fn) {
  await fn();
  n += 1;
  console.log(`ok: ${name}`);
}
const OWN = ["6285604512090@s.whatsapp.net", "52712485986330@lid"];
const norm = (j) => String(j).replace(/:\d+@/, "@");
const ctx = (mentionedJid) => ({ contextInfo: { mentionedJid } });
const CAPTION = "@Ayyubi logo paling bagus atau menarik yang mana?";

await ok("sebutan terdeteksi pada imageMessage/videoMessage/documentMessage/teks/audio", () => {
  for (const k of ["imageMessage", "videoMessage", "documentMessage", "extendedTextMessage", "audioMessage"]) {
    assert.equal(isMentionedIn({ [k]: { caption: CAPTION, ...ctx(["52712485986330@lid"]) } }, OWN, norm), true, k);
  }
  assert.equal(isMentionedIn({ imageMessage: ctx(["6285604512090:6@s.whatsapp.net"]) }, OWN, norm), true);
  assert.deepEqual(collectMentionedJids({ imageMessage: ctx(["a@lid"]), extendedTextMessage: ctx(["b@lid"]) }).sort(), ["a@lid", "b@lid"]);
});

await ok("gambar tanpa sebutan (atau menyebut orang lain) tidak memanggil bot", () => {
  assert.equal(isMentionedIn({ imageMessage: { caption: "lihat nih" } }, OWN, norm), false);
  assert.equal(isMentionedIn({ imageMessage: ctx(["62811@s.whatsapp.net"]) }, OWN, norm), false);
  assert.equal(isMentionedIn(null, OWN, norm), false);
});

await ok("pertanyaan selera dikenali, termasuk kalimat bug asli", () => {
  assert.equal(isTasteQuestion("logo paling bagus atau menarik yang mana?"), true);
  assert.equal(isTasteQuestion("menurutmu yang mana lebih cakep"), true);
  assert.equal(isTasteQuestion("jam berapa rapat besok"), false);
  assert.equal(looksLikeImageQuestion("logo paling bagus atau menarik yang mana?"), false); // akar masalah: regex lama tidak mengenalinya
});

await ok("gambar terlampir + sebutan selalu dijawab; gambar yang dikutip perlu terdengar bertanya", () => {
  const q = { text: "logo paling bagus atau menarik yang mana?", looksLikeQuestion: looksLikeImageQuestion };
  assert.equal(shouldAnswerImage({ attached: true, quoted: false, ...q }), true);
  assert.equal(shouldAnswerImage({ attached: false, quoted: true, ...q }), true); // selera
  assert.equal(shouldAnswerImage({ attached: false, quoted: true, text: "jam berapa rapat", looksLikeQuestion: looksLikeImageQuestion }), false);
  assert.equal(shouldAnswerImage({ attached: false, quoted: false, ...q }), false);
});

await ok("balasan pada pesan bot yang berisi gambar tetap memicu (jalur quoted)", () => {
  assert.equal(shouldAnswerImage({ attached: false, quoted: true, text: "ini apa?", looksLikeQuestion: looksLikeImageQuestion }), true);
});

await ok("sistem prompt selera memuat aturan satu pilihan + persona + pagar", () => {
  const s = buildImageSystem({ taste: true, persona: "\n\nGAYA BICARA (Ayyubi) tengil sopan" });
  assert.match(s, /TEPAT SATU/);
  assert.match(s, /2-3 alasan/);
  assert.match(s, /soal selera/);
  assert.match(s, /jangan menebak hal yang tidak terlihat/);
  assert.match(s, /GAYA BICARA/);
  assert.doesNotMatch(buildImageSystem({}), /TEPAT SATU/);
});

await ok("pertanyaan selera menghasilkan jawaban satu pilihan (model tiruan)", async () => {
  let seen = null;
  const mock = { name: "tiruan", run: async (a) => ((seen = a), "Aku pilih logo nomor 3: warnanya kontras, bentuknya sederhana, dan mudah dibaca. Ini soal selera sih.") };
  const r = await askVisionChain({ visions: [mock], system: buildImageSystem({ taste: true }), user: "Pertanyaan", image: { buffer: Buffer.from("x") } });
  assert.equal(r.ok, true);
  assert.match(r.text, /pilih logo nomor 3/);
  assert.match(seen.system, /TEPAT SATU/);
});

await ok("model pertama gagal -> model berikutnya dicoba", async () => {
  const calls = [];
  const bad = { name: "a", run: async () => (calls.push("a"), Promise.reject(new Error("429"))) };
  const good = { name: "b", run: async () => (calls.push("b"), "Logo kedua paling menarik.") };
  const r = await askVisionChain({ visions: [bad, good], system: "s", user: "u", image: {} });
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(r.ok, true);
  assert.equal(r.model, "b");
});

await ok("semua model gagal -> hasil gagal (pemanggil membalas pesan fallback jujur)", async () => {
  const bad = (m) => ({ name: m, run: async () => Promise.reject(new Error("boom")) });
  const r = await askVisionChain({ visions: [bad("a"), bad("b")], system: "s", user: "u", image: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "vision");
  assert.equal(r.errors.length, 2);
  assert.match(MSG_VISION_FAIL, /gagal kubaca/);
});

await ok("reply-guard: tag kontrol, URL dan mention angka dibuang", async () => {
  const mock = { name: "t", run: async () => "[SEARCH]x[/SEARCH] Pilih yang biru, lihat https://contoh.id/a @6281234567890 ya" };
  const r = await askVisionChain({ visions: [mock], system: "s", user: "u", image: {} });
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.text, /SEARCH|https?:|@\d{5,}/);
  assert.match(r.text, /Pilih yang biru/);
});

await ok("jawaban kosong dari semua model -> reason empty", async () => {
  const r = await askVisionChain({ visions: [{ name: "a", run: async () => "  " }], system: "s", user: "u", image: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty");
});

console.log(`\n${n} tes lulus.`);
