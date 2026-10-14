// Tes obrolan Ollama lokal (/lokal, /tanya): local-chat.js + perintah Telegram.
//   node test-local-chat.mjs
import { createLocalChat, parseLocalChatCommand, LOCAL_CHAT_SYSTEM_PROMPT, LOCAL_CHAT_USAGE } from "./local-chat.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };

// ---- parser
{
  const a = parseLocalChatCommand("/lokal halo apa kabar");
  check(a && a.text === "halo apa kabar" && !a.reset && !a.empty, "parse: /lokal <pesan>");
  check(parseLocalChatCommand("/Tanya apa itu hibah?")?.text === "apa itu hibah?", "parse: alias /tanya, huruf besar");
  check(parseLocalChatCommand("/lokal")?.empty === true && parseLocalChatCommand("/lokal baru")?.reset === true && parseLocalChatCommand("/lokal Reset")?.reset === true, "parse: kosong dan 'baru/reset'");
  check(parseLocalChatCommand("/lokal baru lagi")?.reset === false, "parse: 'baru lagi' adalah pesan biasa, bukan reset");
  check(parseLocalChatCommand("/lokalisasi") === null && parseLocalChatCommand("lokal halo") === null && parseLocalChatCommand("tolong /tanya") === null, "parse: bukan perintah bila tak diawali tepat");
  check(parseLocalChatCommand("/lokal\nbaris 1\nbaris 2")?.text === "baris 1\nbaris 2", "parse: pesan multibaris utuh");
}

// ---- obrolan
{
  const calls = [];
  let n = 0;
  const chat = createLocalChat({
    callModel: async (messages, opts) => { calls.push({ messages, opts }); return `jawaban ${++n}`; },
    getMemory: () => "CATATAN PRIBADI PEMILIK (tes):\n- jawab singkat",
    now: () => new Date("2026-10-14T00:00:00Z"),
    historyTurns: 2
  });
  const r = await chat.ask("tg:1", "  halo  ");
  check(r.ok && r.reply === "jawaban 1", "ask: jawaban model apa adanya");
  const m0 = calls[0].messages;
  check(m0[0].role === "system" && m0[0].content.includes(LOCAL_CHAT_SYSTEM_PROMPT.slice(0, 40)) && m0[0].content.includes("2026-10-14") && m0[0].content.includes("- jawab singkat"), "ask: prompt sistem = aturan lokal + tanggal + catatan pribadi");
  check(m0.length === 2 && m0[1].role === "user" && m0[1].content === "halo" && calls[0].opts.temperature === 0.4, "ask: pesan pengguna dipangkas; suhu 0.4");
  check(/TIDAK punya akses internet/.test(m0[0].content) && /\/dokumen/.test(m0[0].content), "ask: model diberi tahu tak punya internet/dokumen dan diarahkan ke /dokumen");

  await chat.ask("tg:1", "lanjutannya?");
  const m1 = calls[1].messages;
  check(m1.length === 4 && m1[1].content === "halo" && m1[2].content === "jawaban 1" && m1[3].content === "lanjutannya?", "ask: riwayat giliran sebelumnya ikut");
  await chat.ask("tg:1", "tiga");
  await chat.ask("tg:1", "empat");
  const m3 = calls[3].messages;
  check(m3.length === 1 + 4 + 1 && m3[1].content === "lanjutannya?" && m3[5].content === "empat", "ask: riwayat dibatasi 2 pasang terakhir");

  await chat.ask("tg:2", "obrolan lain");
  check(calls[4].messages.length === 2, "ask: percakapan chat lain terpisah");
  chat.reset("tg:1");
  await chat.ask("tg:1", "setelah reset");
  check(calls[5].messages.length === 2, "reset: riwayat dilupakan");

  check((await chat.ask("tg:1", "   ")).reply === LOCAL_CHAT_USAGE && calls.length === 6, "ask: kosong -> petunjuk, model tidak dipanggil");
  const big = await chat.ask("tg:1", "x".repeat(4001));
  check(!big.ok && big.reply.includes("terlalu panjang") && calls.length === 6, "ask: terlalu panjang ditolak, model tidak dipanggil");
}

// ---- handle (pintu Telegram/WhatsApp)
{
  const calls = [];
  const chat = createLocalChat({ callModel: async (m) => { calls.push(m); return "oke"; } });
  check((await chat.handle("k", "")) === LOCAL_CHAT_USAGE && calls.length === 0, "handle: kosong -> petunjuk");
  await chat.handle("k", "satu");
  check((await chat.handle("k", "baru")).includes("dimulai dari awal"), "handle: 'baru' -> riwayat dihapus");
  await chat.handle("k", "dua");
  check(calls[1].length === 2, "handle: setelah 'baru' riwayat kosong");
  check((await chat.handle("k", "halo")) === "oke", "handle: mengembalikan teks balasan");
}

// ---- ketahanan
{
  const down = createLocalChat({ callModel: async () => { throw new Error("Ollama mati"); } });
  let msg = ""; try { await down.ask("k", "halo"); } catch (e) { msg = e.message; }
  check(msg === "Ollama mati" && down.size() === 0, "ketahanan: model gagal -> galat dilempar dan pesan gagal tidak masuk riwayat");
  const blank = createLocalChat({ callModel: async () => "  " });
  let m2 = ""; try { await blank.ask("k", "halo"); } catch (e) { m2 = e.message; }
  check(m2.includes("tidak menghasilkan"), "ketahanan: jawaban kosong dianggap gagal");
  const flaky = createLocalChat({ callModel: async () => "ok", getMemory: () => { throw new Error("rusak"); } });
  check((await flaky.ask("k", "halo")).ok, "ketahanan: pembaca catatan rusak tidak menggagalkan obrolan");
  const many = createLocalChat({ callModel: async () => "ok" });
  for (let i = 0; i < 30; i++) await many.ask(`k${i}`, "x");
  check(many.size() <= 20, "ketahanan: jumlah percakapan di memori dibatasi");
  const long = createLocalChat({ callModel: async () => "y".repeat(5000) });
  await long.ask("k", "a");
  const seen = [];
  const long2 = createLocalChat({ callModel: async (m) => { seen.push(m); return "y".repeat(5000); } });
  await long2.ask("k", "a"); await long2.ask("k", "b");
  check(seen[1][2].content.length <= 1500, "ketahanan: jawaban panjang dipotong saat disimpan sebagai riwayat");
}

// ---- Telegram
{
  const sent = [];
  const f = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    if (method === "sendMessage") sent.push(body.text);
    return { status: 200, json: async () => ({ ok: true, result: method === "getMe" ? { username: "b" } : { message_id: 1 } }) };
  };
  const cfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const seen = [];
  const resets = [];
  const localChat = { handle: async (k, a) => { seen.push([k, a]); if (a === "boom") throw new Error("Ollama mati"); return `LOKAL: ${a}`; }, reset: (k) => resets.push(k) };
  const cloud = [];
  const tg = createTelegram({ config: cfg, deps: { chat: async (h) => { cloud.push(h); return "ai-cloud"; }, localChat }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/lokal halo dunia");
  await tg.handleOwnerText("111", "/tanya apa itu hibah");
  await tg.handleOwnerText("111", "/lokal boom");
  await tg.handleOwnerText("111", "/baru");
  check(sent[0] === "LOKAL: halo dunia" && seen[0][0] === "tg:111" && sent[1] === "LOKAL: apa itu hibah", "telegram: /lokal dan /tanya -> jawaban lokal, kunci percakapan per chat");
  check(sent[2].includes("Ollama lokal gagal menjawab") && sent[2].includes("Ollama mati"), "telegram: galat model -> pesan ramah");
  check(cloud.length === 0, "telegram: /lokal TIDAK diteruskan ke AI cloud");
  check(resets.join() === "tg:111", "telegram: /baru ikut mereset percakapan lokal");
  const none = createTelegram({ config: cfg, deps: { chat: async () => "x" }, fetchImpl: f, log: silent });
  await none.handleOwnerText("111", "/lokal halo");
  check(sent.at(-1).includes("belum aktif"), "telegram: tanpa modul -> pesan ramah");
}

console.log(fails === 0 ? "\nSemua tes local-chat lulus." : `\n${fails} tes local-chat GAGAL.`);
process.exit(fails === 0 ? 0 : 1);
