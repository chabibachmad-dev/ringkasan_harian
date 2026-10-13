// Tes tutor Inggris Telegram (tutor.js): prompt, perpisahan (sama dengan versi aplikasi), perapian balasan model.
//   node test-tutor.mjs     (butuh Node 22.18+ untuk membandingkan dengan study-core.ts)
import { buildTutorSystemPrompt, buildTutorUserPrompt, formatTutorMessage, isFarewell, isFarewellFor, isFarewellId, parseTutorReply, TUTOR_HISTORY, TUTOR_MAX_TURNS, TUTOR_TEXT_MAX_ID } from "./tutor.js";
import { isFarewell as isFarewellApp, parseSpeakReply } from "../supabase/functions/_shared/study-core.ts";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// ---- perpisahan: harus SAMA dengan versi aplikasi (study-core.ts)
{
  const samples = [
    "Goodbye!", "bye", "Bye bye, see you tomorrow", "Good bye teacher", "Okay, see you later.", "Thank you so much, see you next time", "I have to go now",
    "I gotta go. Bye!", "That's all for today", "Let's stop here", "Take care!", "Good night", "Thanks for the chat. Have a nice day!", "I like pizza. Anyway, goodbye",
    "talk to you later", "sampai jumpa", "I'm done for today", "I must go home",
    "How do you say goodbye in French?", "I will take care of my sister", "What does bye mean?", "I like the song Goodbye", "My favorite food is fried rice",
    "Can you help me with homework?", "I go to market yesterday", "Do you want to say goodbye?", "bye?", "I need to go to the bank tomorrow to pay my bill and then buy food"
  ];
  const diff = samples.filter((t) => isFarewell(t) !== isFarewellApp(t));
  check(diff.length === 0, "perpisahan: sama dengan versi aplikasi pada " + samples.length + " contoh" + (diff.length ? " (beda: " + diff.join(" | ") + ")" : ""));
  check(isFarewell("Goodbye!") && isFarewell("see you later") && !isFarewell("How do you say goodbye in French?") && !isFarewell("bye?"), "perpisahan: contoh utama");
}

// ---- prompt
{
  const sys = buildTutorSystemPrompt({ topic: "ordering coffee" });
  check(/Emma/.test(sys) && /ordering coffee/.test(sys) && /OUTPUT: return ONLY a JSON object/.test(sys) && /Bahasa Indonesia/.test(sys), "prompt sistem: persona, topik, format JSON, tips berbahasa Indonesia");
  check(/free conversation about everyday life/.test(buildTutorSystemPrompt({})), "prompt sistem: tanpa topik = obrolan bebas");
  check(/Start the conversation now/.test(buildTutorUserPrompt([], null)) && /empty strings/.test(buildTutorUserPrompt([], null)), "prompt pembuka: minta salam singkat");
  const hist = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "ai" : "user", body: "turn " + i }));
  const up = buildTutorUserPrompt(hist, "I like coffee");
  check(!up.includes("turn 0") && up.includes("turn 29") && up.split("\n").filter((l) => /^(Learner|Tutor):/.test(l)).length === TUTOR_HISTORY, "prompt giliran: hanya " + TUTOR_HISTORY + " pesan terakhir");
  check(up.includes("<<<MSG\nI like coffee\nMSG>>>") && !/SAYING GOODBYE/.test(up), "prompt giliran: ucapan terbaru dibungkus, tanpa perintah pamit");
  check(/SAYING GOODBYE/.test(buildTutorUserPrompt(hist, "bye", true)), "prompt giliran: farewell meminta satu salam penutup");
  check(buildTutorUserPrompt([], "a".repeat(1000)).length < 1200, "prompt giliran: ucapan panjang dipotong");
  check(TUTOR_MAX_TURNS === 30, "batas giliran bawaan 30");
}

// ---- mode ngobrol Indonesia (/speak id)
{
  const yes = ["Sampai jumpa ya!", "dadah", "Aku pamit dulu ya", "Udahan dulu ya", "Sudah dulu ya, makasih", "Aku mau tidur dulu", "Saya harus pergi sekarang", "Cukup dulu untuk hari ini", "Sampai ketemu besok", "Selamat tidur", "Selamat tinggal", "Terima kasih ya, sampai nanti", "bye", "Goodbye!", "Oke, sampai disini dulu ya"];
  const no = ["Selamat malam, apa kabar?", "Selamat malam!", "Selamat pagi, Rani", "Bagaimana cara mengucapkan sampai jumpa dalam bahasa Inggris?", "Apa artinya dadah?", "Aku mau pergi ke pasar besok untuk beli sayur dan buah", "Sudah dulu makannya, sekarang lagi nonton film", "Kapan kita sampai jumpa lagi?", "Aku suka lagu Sampai Jumpa", "Tolong ceritakan tentang liburan", "Uangnya sudah cukup untuk beli laptop", "Aku capek banget hari ini", "Dia sudah pamit pulang kemarin dan aku masih kepikiran terus soal itu semua"];
  const missY = yes.filter((t) => !isFarewellFor(t, "id"));
  const missN = no.filter((t) => isFarewellFor(t, "id"));
  check(missY.length === 0, "perpisahan id: semua kalimat pamit dikenali" + (missY.length ? " (lolos: " + missY.join(" | ") + ")" : ""));
  check(missN.length === 0, "perpisahan id: sapaan/tanya/cerita bukan pamit" + (missN.length ? " (salah: " + missN.join(" | ") + ")" : ""));
  check(!isFarewellFor("aku pamit dulu", "en") && isFarewellFor("see you later", "id") && isFarewellFor("Aku pamit dulu", "id"), "perpisahan: kata Indonesia (pamit) hanya di mode id; mode id tetap mengenali bahasa Inggris");
  check(isFarewellId("dadah") && !isFarewellId("dadah?"), "perpisahan id: tanda tanya = bukan pamit");
  const sys = buildTutorSystemPrompt({ lang: "id", topic: "rencana liburan" });
  check(/Rani/.test(sys) && /rencana liburan/.test(sys) && /bahasa Indonesia/.test(sys) && /SELALU string kosong/.test(sys) && !/Emma/.test(sys), "prompt id: persona Rani, topik, tanpa koreksi, bukan Emma");
  check(/obrolan santai tentang kehidupan sehari-hari/.test(buildTutorSystemPrompt({ lang: "id" })), "prompt id: tanpa topik = obrolan bebas");
  check(buildTutorSystemPrompt({ lang: "en" }).includes("Emma") && buildTutorSystemPrompt({}).includes("Emma"), "prompt: bawaan tetap Emma (Inggris)");
  const open = buildTutorUserPrompt([], null, false, "id");
  check(/in Indonesian/.test(open) && /empty strings/.test(open), "prompt pembuka id: sapaan Indonesia");
  const up = buildTutorUserPrompt([{ role: "ai", body: "Halo!" }, { role: "user", body: "Hai Rani" }], "Aku baru pulang kerja", false, "id");
  check(/^User: Hai Rani$/m.test(up) && /^Rani: Halo!$/m.test(up) && /Reply as Rani now, in Indonesian/.test(up) && !/Learner|Tutor/.test(up), "prompt giliran id: label User/Rani, balas Indonesia");
  check(/SAYING GOODBYE/.test(buildTutorUserPrompt([], "dadah", true, "id")) && /in Indonesian/.test(buildTutorUserPrompt([], "dadah", true, "id")), "prompt giliran id: pamit -> satu salam penutup Indonesia");
  check(buildTutorUserPrompt([], "a".repeat(900), false, "id").includes("a".repeat(TUTOR_TEXT_MAX_ID)) && !buildTutorUserPrompt([], "a".repeat(900), false, "id").includes("a".repeat(TUTOR_TEXT_MAX_ID + 1)), "prompt giliran id: ucapan dipotong di " + TUTOR_TEXT_MAX_ID + " karakter");
}

// ---- keluaran model
{
  const r = parseTutorReply('{"reply":"Oh nice! What did you buy?","correction":"I went to the market yesterday.","tip":"Gunakan went untuk lampau."}', "I go to market yesterday");
  check(r && r.reply === "Oh nice! What did you buy?" && r.correction.startsWith("I went") && r.tip.length > 0, "parse: JSON lengkap");
  check(parseTutorReply('```json\n{"reply":"Hi!","correction":"","tip":"ada tip"}\n```').tip === "", "parse: pagar kode dibuang; tip tanpa koreksi dibuang");
  check(parseTutorReply('Here you go: {"reply":"Cool, tell me more.","correction":"","tip":""} thanks').reply === "Cool, tell me more.", "parse: objek JSON di tengah teks diambil");
  check(parseTutorReply("Haha, that's funny!").reply === "Haha, that's funny!", "parse: bukan JSON -> seluruh teks jadi balasan");
  check(parseTutorReply('{"reply":"x"}') === null && parseTutorReply("") === null && parseTutorReply("{broken") === null, "parse: balasan kosong/rusak -> null");
  check(parseTutorReply('{"reply":"Nice!","correction":"I like coffee.","tip":"x"}', "i like coffee").correction === "", "parse: koreksi yang sama dengan ucapan dibuang");
  // sama dengan versi aplikasi
  const raw = '{"reply":"Oh really? That sounds fun.","correction":"I went home.","tip":"went = lampau"}';
  const a = parseTutorReply(raw, "I go home");
  const b = parseSpeakReply(raw, "I go home");
  check(a.reply === b.reply && a.correction === b.correction && a.tip === b.tip, "parse: sama dengan versi aplikasi");
  check(formatTutorMessage({ reply: "Hi!", correction: "", tip: "" }) === "💬 Hi!", "format: balasan saja");
  check(formatTutorMessage({ reply: "Hi!", correction: "I went.", tip: "went = lampau" }) === "💬 Hi!\n\n✏️ Lebih baik: I went.\n💡 went = lampau", "format: dengan koreksi & tip");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
