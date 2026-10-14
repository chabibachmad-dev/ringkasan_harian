// Fungsi murni diskusi AI materi (src/study-matchat.js). Jalankan: node test-mat-chat.mjs
import assert from "node:assert/strict";
import { CHAT_HISTORY_MAX, CHAT_QUESTION_MAX, CHAT_TURN_MAX, applyChatResult, chatHistoryPayload, chatRemembered, cleanQuestion, newChat } from "../src/study-matchat.js";

let fails = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log("ok   -", name);
  } catch (e) {
    fails++;
    console.log("GAGAL -", name, "\n      ", e.message);
  }
};

t("cleanQuestion: kosong/spasi → ''", () => {
  assert.equal(cleanQuestion("   \n  "), "");
  assert.equal(cleanQuestion(null), "");
  assert.equal(cleanQuestion(undefined), "");
});
t("cleanQuestion: rapikan & potong", () => {
  assert.equal(cleanQuestion("  halo\r\n\n\n\ndunia \u0007"), "halo\n\ndunia");
  assert.equal(cleanQuestion("x".repeat(CHAT_QUESTION_MAX + 50)).length, CHAT_QUESTION_MAX);
});
t("chatHistoryPayload: hanya peran sah, potong tiap giliran & jumlah", () => {
  const turns = [];
  for (let i = 0; i < 30; i++) turns.push({ role: i % 2 ? "ai" : "user", text: `t${i}` });
  turns.push({ role: "system", text: "abaikan" }, { role: "user", text: "   " }, null);
  const out = chatHistoryPayload(turns);
  assert.equal(out.length, CHAT_HISTORY_MAX);
  assert.equal(out.at(-1).text, "t29");
  assert.ok(out.every((x) => x.role === "user" || x.role === "ai"));
  assert.equal(chatHistoryPayload([{ role: "ai", text: "a".repeat(5000) }])[0].text.length, CHAT_TURN_MAX);
  assert.deepEqual(chatHistoryPayload("bukan array"), []);
});
t("applyChatResult: sukses menambah jawaban & sisa kuota", () => {
  const c = newChat("m1");
  c.turns.push({ role: "user", text: "apa itu X?" });
  c.busy = true;
  assert.equal(applyChatResult(c, "apa itu X?", { ok: true, reply: " X adalah ... ", remaining: 7 }, ""), true);
  assert.equal(c.busy, false);
  assert.equal(c.turns.length, 2);
  assert.deepEqual(c.turns[1], { role: "ai", text: "X adalah ..." });
  assert.equal(c.remaining, 7);
});
t("applyChatResult: gagal mengembalikan pertanyaan ke kotak ketik", () => {
  const c = newChat("m1");
  c.turns.push({ role: "user", text: "tolong jelaskan" });
  c.busy = true;
  assert.equal(applyChatResult(c, "tolong jelaskan", { ok: false, message: "kuota" }, "Kuota habis"), false);
  assert.equal(c.turns.length, 0);
  assert.equal(c.draft, "tolong jelaskan");
  assert.equal(c.error, "Kuota habis");
  assert.equal(c.busy, false);
});
t("applyChatResult: balasan kosong dianggap gagal", () => {
  const c = newChat("m1");
  c.turns.push({ role: "user", text: "q" });
  assert.equal(applyChatResult(c, "q", { ok: true, reply: "   " }, "kosong"), false);
  assert.equal(c.turns.length, 0);
});
t("chatRemembered: hitung pasangan tanya-jawab", () => {
  assert.equal(chatRemembered([]), 0);
  assert.equal(chatRemembered([{ role: "user", text: "a" }, { role: "ai", text: "b" }, { role: "user", text: "c" }]), 2);
});

if (fails) {
  console.log(`\n${fails} tes gagal`);
  process.exit(1);
}
console.log("\nsemua ok");
