// Tes tanya-jawab dokumen lokal (/dokumen): local-docs.js + onlyLocal di kb-index + perintah Telegram.
//   node test-local-docs.mjs
import { openKbIndex } from "./kb-index.js";
import { createLocalDocs, parseDokumenCommand, formatSources, LOCAL_DOC_SYSTEM_PROMPT } from "./local-docs.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };

// ---- parser perintah
{
  check(parseDokumenCommand("/dokumen apa itu hibah?")?.question === "apa itu hibah?", "parse: /dokumen <tanya>");
  check(parseDokumenCommand("/dokumen")?.list === true && parseDokumenCommand("/Dokumen daftar")?.list === true, "parse: tanpa argumen / 'daftar' = daftar");
  check(parseDokumenCommand("/dok: pasal 5")?.question === "pasal 5", "parse: singkatan /dok dan tanda titik dua");
  check(parseDokumenCommand("dokumen apa saja") === null && parseDokumenCommand("tolong /dokumen") === null, "parse: bukan perintah bila tidak diawali /dokumen");
  check(parseDokumenCommand("/dokumentasi foto") === null, "parse: /dokumentasi bukan /dokumen");
}

// ---- indeks: onlyLocal / excludeLocal
const index = await openKbIndex({ file: ":memory:", log: silent });
index.upsertDoc({ id: "local:uu-1.md", title: "UU 1 Tahun 2004 tentang Perbendaharaan", pages: [{ page: 3, text: "Pasal 12. Hibah diberikan paling lama tiga tahun anggaran sejak ditetapkan oleh pejabat berwenang." }, { page: 4, text: "Pasal 13. Pertanggungjawaban hibah disampaikan setiap triwulan." }] });
index.upsertDoc({ id: "uuid-awan", title: "Panduan Awan", pages: [{ page: 1, text: "Hibah awan dibahas pada dokumen cloud biasa, bukan peraturan lokal." }] });
{
  const only = index.search("hibah", { onlyLocal: true });
  const ex = index.search("hibah", { excludeLocal: true });
  const all = index.search("hibah");
  check(only.length > 0 && only.every((c) => c.title.startsWith("UU 1")), "onlyLocal: hanya potongan dokumen lokal");
  check(ex.length > 0 && ex.every((c) => c.title === "Panduan Awan"), "excludeLocal: dokumen lokal tidak ikut");
  check(all.some((c) => c.title.startsWith("UU 1")) && all.some((c) => c.title === "Panduan Awan"), "tanpa opsi: keduanya ikut");
}

// ---- createLocalDocs
{
  const calls = [];
  const ld = createLocalDocs({
    index,
    callModel: async (messages, opts) => { calls.push({ messages, opts }); return "Hibah paling lama *tiga tahun anggaran* (Pasal 12, halaman 3)."; },
    now: () => new Date("2026-10-04T00:00:00Z")
  });
  check(ld.list().includes("1 dokumen lokal") && ld.list().includes("UU 1 Tahun 2004") && !ld.list().includes("Panduan Awan"), "list: hanya dokumen lokal");

  const r = await ld.ask("berapa lama hibah diberikan?");
  check(r.ok && r.reply.includes("tiga tahun anggaran") && r.reply.includes("📚 Sumber: UU 1 Tahun 2004 tentang Perbendaharaan (hlm 3"), "ask: jawaban + sumber dengan halaman");
  const ctx = calls[0].messages[1].content;
  check(ctx.includes("Pasal 12") && !ctx.includes("Hibah awan"), "ask: konteks ke model hanya dari dokumen lokal (bukan dokumen awan)");
  check(calls[0].messages[0].content.includes(LOCAL_DOC_SYSTEM_PROMPT.slice(0, 40)) && calls[0].messages[0].content.includes("2026-10-04"), "ask: prompt sistem pemilik + tanggal");
  check(!calls[0].messages[0].content.includes("ATAS NAMA pemilik"), "ask: bukan prompt auto-reply kontak");
  check(!r.flagged, "ask: jawaban yang benar tidak ditandai");

  const before = calls.length;
  const none = await ld.ask("xylophone zebra quantum");
  check(!none.ok && none.reply.includes("Tidak ada bagian dokumen") && calls.length === before, "ask: tak ada yang cocok -> model TIDAK dipanggil");
  const empty = await ld.ask("   ");
  check(!empty.ok && empty.reply.includes("dokumen lokal") && calls.length === before, "ask: pertanyaan kosong -> daftar, model tidak dipanggil");

  const bad = createLocalDocs({ index, callModel: async () => 'Menurut dokumen: «Hibah diberikan seumur hidup» (halaman 99).' });
  const rb = await bad.ask("berapa lama hibah diberikan?");
  check(rb.ok && rb.flagged && rb.reply.includes("Pemeriksaan otomatis") && rb.reply.includes("Sumber"), "ask: kutipan/halaman karangan diberi peringatan");

  const down = createLocalDocs({ index, callModel: async () => { throw new Error("Ollama mati"); } });
  let msg = "";
  try { await down.ask("hibah"); } catch (e) { msg = e.message; }
  check(msg === "Ollama mati", "ask: kegagalan model dilempar ke pemanggil (diubah jadi pesan ramah di WA/Telegram)");

  const blank = createLocalDocs({ index, callModel: async () => "  " });
  let m2 = "";
  try { await blank.ask("hibah"); } catch (e) { m2 = e.message; }
  check(m2.includes("tidak menghasilkan"), "ask: jawaban kosong dianggap gagal");
}
{
  const cloudOnly = await openKbIndex({ file: ":memory:", log: silent });
  cloudOnly.upsertDoc({ id: "uuid-1", title: "Dokumen awan", pages: [{ page: 1, text: "isi awan" }] });
  let called = 0;
  const ld = createLocalDocs({ index: cloudOnly, callModel: async () => { called++; return "x"; } });
  const r = await ld.ask("isi awan");
  check(!r.ok && r.reply.includes("Belum ada dokumen lokal") && called === 0, "ask: tanpa dokumen lokal -> petunjuk, model tidak dipanggil");
  check(ld.list().includes("Belum ada dokumen lokal"), "list: kosong -> petunjuk");
  const none = createLocalDocs({ index: null, callModel: async () => "x" });
  check((await none.ask("apa")).reply.includes("tidak aktif") && none.list().includes("Belum ada"), "tanpa indeks: pesan aman, tidak error");
  // regresi: indeks dibuka SETELAH createLocalDocs dibuat (urutan start di index.js)
  let late = null;
  const lazy = createLocalDocs({ getIndex: () => late, callModel: async () => "Jawaban." });
  check((await lazy.ask("hibah")).reply.includes("tidak aktif"), "lazy: sebelum indeks terbuka -> pesan tidak aktif");
  late = index;
  const r2 = await lazy.ask("berapa lama hibah diberikan?");
  check(r2.ok && r2.reply.includes("Jawaban.") && lazy.list().includes("1 dokumen lokal"), "lazy: setelah indeks terbuka langsung berfungsi tanpa restart modul");
}
{
  const s = formatSources([{ title: "A", text: "[Halaman 2]\nx [Halaman 5]\ny" }, { title: "A", text: "[Halaman 2]" }, { title: "B", text: "tanpa penanda" }], { maxDocs: 1 });
  check(s === "📚 Sumber: A (hlm 2, 5) +1 lainnya", "sumber: halaman unik terurut, dokumen berlebih diringkas");
}

// ---- Telegram /dokumen
{
  const sent = [];
  const f = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    if (method === "sendMessage") sent.push(body.text);
    return { status: 200, json: async () => ({ ok: true, result: method === "getMe" ? { username: "b" } : { message_id: 1 } }) };
  };
  const asked = [];
  const localDocs = { list: () => "DAFTAR-LOKAL", ask: async (q) => { asked.push(q); if (q === "boom") throw new Error("Ollama mati"); return { ok: true, reply: `JAWAB: ${q}` }; } };
  const cfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: cfg, deps: { chat: async () => "ai-biasa", localDocs }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/dokumen");
  await tg.handleOwnerText("111", "/dokumen apa itu hibah");
  await tg.handleOwnerText("111", "/dokumen boom");
  check(sent[0] === "DAFTAR-LOKAL" && sent[1] === "JAWAB: apa itu hibah" && asked.join("|") === "apa itu hibah|boom", "telegram: /dokumen -> daftar; /dokumen <tanya> -> jawaban lokal");
  check(sent[2].includes("Gagal menjawab") && sent[2].includes("Ollama mati"), "telegram: kegagalan jadi pesan ramah");
  await tg.handleOwnerText("111", "halo");
  check(sent[3] === "ai-biasa" && asked.length === 2, "telegram: obrolan biasa tidak menyentuh dokumen lokal");
  await tg.handleOwnerText("111", "/start");
  check(sent[4].includes("/dokumen"), "telegram: bantuan menyebut /dokumen");

  const sent2 = [];
  const f2 = async (url, init) => { const body = init?.body ? JSON.parse(init.body) : {}; if (String(url).endsWith("sendMessage")) sent2.push(body.text); return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
  const tg2 = createTelegram({ config: cfg, deps: { chat: async () => "x" }, fetchImpl: f2, log: silent });
  await tg2.handleOwnerText("111", "/dokumen pasal 5");
  check(sent2[0].includes("belum aktif"), "telegram: tanpa localDocs -> pesan 'belum aktif'");
  // bukan pemilik: diabaikan
  await tg2.handleUpdate({ update_id: 9, message: { chat: { id: 222, type: "private" }, text: "/dokumen pasal 5" } });
  check(sent2.length === 1, "telegram: non-pemilik tidak bisa memakai /dokumen");
}

index.close?.();
console.log(fails === 0 ? "\nSEMUA TES LULUS" : `\n${fails} TES GAGAL`);
process.exit(fails === 0 ? 0 : 1);
