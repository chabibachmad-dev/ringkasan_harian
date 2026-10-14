// Tes catatan pribadi pemilik (/ingat /catatan /lupa): owner-memory.js + penyisipan ke prompt Ollama + perintah Telegram.
//   node test-owner-memory.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openOwnerMemory, parseMemoryCommand, handleMemoryCommand, looksLikeSecret, MAX_NOTE_CHARS } from "./owner-memory.js";
import { createLocalDocs } from "./local-docs.js";
import { openKbIndex } from "./kb-index.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };

// ---- parser
{
  check(parseMemoryCommand("/ingat klien X pakai skema Y")?.arg === "klien X pakai skema Y" && parseMemoryCommand("/ingat klien X pakai skema Y").name === "ingat", "parse: /ingat <teks>");
  check(parseMemoryCommand("/catatan")?.name === "catatan" && parseMemoryCommand("/memori")?.name === "catatan" && parseMemoryCommand("/note")?.name === "catatan", "parse: /catatan dan alias /memori /note");
  check(parseMemoryCommand("/lupa 2")?.arg === "2" && parseMemoryCommand("/lupa semua")?.arg === "semua", "parse: /lupa <nomor|semua>");
  check(parseMemoryCommand("/ingat: pakai titik dua")?.arg === "pakai titik dua", "parse: titik dua setelah perintah");
  check(parseMemoryCommand("ingat ini") === null && parseMemoryCommand("/ingatkan aku") === null && parseMemoryCommand("tolong /ingat x") === null, "parse: bukan perintah bila tak diawali tepat");
}

// ---- deteksi rahasia
{
  check(looksLikeSecret("key AIzaSyA1234567890abcdefghij") && looksLikeSecret("gsk_abcdefghijklmnop") && looksLikeSecret("kartu 4111111111111111"), "rahasia: API key dan nomor kartu terdeteksi");
  check(looksLikeSecret("password: rahasia123") && looksLikeSecret("PIN = 1234") && looksLikeSecret("kata sandi: abc"), "rahasia: kata sandi/PIN terdeteksi");
  check(!looksLikeSecret("klien PT Maju memakai skema SJPH reguler") && !looksLikeSecret("rapat tiap Selasa jam 9") && !looksLikeSecret("nomor SK 1234567 tahun 2026"), "rahasia: catatan biasa lolos");
}

// ---- penyimpanan
{
  const mem = await openOwnerMemory({ file: ":memory:", maxNotes: 3, log: silent, now: () => new Date("2026-10-14T00:00:00Z") });
  check(mem && mem.count() === 0 && mem.promptBlock() === "", "kosong: tidak ada blok prompt");
  const a = mem.add("  klien PT Maju   memakai skema SJPH reguler ");
  check(a.ok && a.note === "klien PT Maju memakai skema SJPH reguler" && a.total === 1, "add: spasi dirapikan");
  check(mem.add("klien pt maju memakai skema sjph reguler").reason === "duplicate", "add: duplikat (tak peduli besar-kecil) ditolak");
  check(mem.add("   ").reason === "empty", "add: kosong ditolak");
  check(mem.add("x".repeat(MAX_NOTE_CHARS + 1)).reason === "too_long", "add: terlalu panjang ditolak");
  check(mem.add("api key gsk_abcdefghijklmnop").reason === "secret", "add: rahasia ditolak");
  mem.add("jawaban ringkas saja");
  mem.add("zona waktu WITA");
  check(mem.add("catatan keempat").reason === "full" && mem.count() === 3, "add: penuh -> ditolak, jumlah tetap");

  const list = mem.list();
  check(list.length === 3 && list[0].n === 1 && list[2].text === "zona waktu WITA", "list: bernomor urut tampilan");

  const block = mem.promptBlock();
  check(block.startsWith("CATATAN PRIBADI PEMILIK") && block.includes("- jawaban ringkas saja") && block.includes("pakai hanya bila relevan"), "promptBlock: judul + butir + aturan pemakaian");
  const small = mem.promptBlock(60);
  check(small.includes("zona waktu WITA") && !small.includes("klien PT Maju"), "promptBlock: anggaran sempit mengutamakan catatan terbaru");

  const r = mem.remove("2");
  check(r.ok && r.note === "jawaban ringkas saja" && mem.count() === 2 && mem.list()[1].n === 2, "remove: hapus nomor 2, penomoran dirapatkan");
  check(mem.remove("9").reason === "not_found" && mem.remove("abc").reason === "not_found" && mem.remove("0").reason === "not_found", "remove: nomor tak ada/tidak valid ditolak");
  check(mem.remove("semua").removed === 2 && mem.count() === 0, "remove: semua");
  check(mem.add("catatan baru setelah dihapus").ok, "add: setelah dikosongkan bisa menambah lagi");
  mem.close();
}

// ---- pencarian
{
  const mem = await openOwnerMemory({ file: ":memory:", log: silent });
  mem.add("klien PT Maju memakai skema SJPH reguler");
  mem.add("rapat tiap Selasa jam 9 di kantor");
  mem.add("PT Maju punya dua lokasi produksi");
  mem.add("jawaban ringkas saja");
  check(mem.search("maju").map((n) => n.n).join() === "1,3", "cari: satu kata, nomor = nomor di daftar penuh");
  check(mem.search("PT  MAJU lokasi").map((n) => n.n).join() === "3", "cari: semua kata harus ada (AND), huruf besar-kecil & spasi ganda tak masalah");
  check(mem.search("tidak-ada").length === 0 && mem.search("   ").length === 0 && mem.search(undefined).length === 0, "cari: tak ada hasil / kueri kosong -> kosong");
  const r = handleMemoryCommand(mem, { name: "catatan", arg: "maju" });
  check(r.includes('2 catatan memuat "maju"') && r.includes("1. klien PT Maju") && r.includes("3. PT Maju punya") && !r.includes("Selasa"), "balasan: /catatan <kata> menampilkan hanya yang cocok dengan nomor aslinya");
  check(handleMemoryCommand(mem, { name: "catatan", arg: "cari selasa" }).includes("2. rapat tiap Selasa"), "balasan: '/catatan cari <kata>' juga bisa");
  check(handleMemoryCommand(mem, { name: "catatan", arg: "xyz" }).includes('Tidak ada catatan yang memuat "xyz"'), "balasan: tak ketemu -> pesan jelas");
  check(handleMemoryCommand(mem, { name: "catatan", arg: "a".repeat(90) }).includes("…"), "balasan: kata cari yang panjang dipotong di pesan");
  check(handleMemoryCommand(mem, { name: "catatan", arg: "" }).includes("4 catatan"), "balasan: tanpa kata tetap daftar lengkap");
  const hit = mem.search("maju")[1].n;
  handleMemoryCommand(mem, { name: "lupa", arg: String(hit) });
  check(mem.search("maju").length === 1 && mem.count() === 3, "cari -> /lupa <nomor hasil cari> menghapus catatan yang benar");
  const empty = await openOwnerMemory({ file: ":memory:", log: silent });
  check(handleMemoryCommand(empty, { name: "catatan", arg: "apa" }).includes("Belum ada catatan"), "balasan: cari saat kosong -> Belum ada catatan");
  mem.close(); empty.close();
}

// ---- tahan restart (file di disk)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-"));
  const file = path.join(dir, "sub", "memori.sqlite");
  const m1 = await openOwnerMemory({ file, log: silent });
  m1.add("tetap ada setelah restart");
  m1.close();
  const m2 = await openOwnerMemory({ file, log: silent });
  check(m2.list().length === 1 && m2.list()[0].text === "tetap ada setelah restart", "file: catatan bertahan setelah ditutup dan dibuka lagi (folder dibuat otomatis)");
  m2.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- balasan perintah
{
  const mem = await openOwnerMemory({ file: ":memory:", maxNotes: 2, log: silent });
  check(handleMemoryCommand(null, { name: "catatan", arg: "" }).includes("belum aktif"), "balasan: modul mati -> pesan ramah");
  check(handleMemoryCommand(mem, { name: "ingat", arg: "" }).includes("Tulis catatannya"), "balasan: /ingat tanpa teks -> petunjuk");
  check(handleMemoryCommand(mem, { name: "catatan", arg: "" }).includes("Belum ada catatan"), "balasan: daftar kosong");
  check(handleMemoryCommand(mem, { name: "ingat", arg: "suka jawaban ringkas" }).includes("Tersimpan sebagai catatan 1 dari maks 2"), "balasan: tersimpan");
  check(handleMemoryCommand(mem, { name: "ingat", arg: "password: abc" }).includes("tidak disimpan"), "balasan: rahasia ditolak dengan penjelasan");
  check(handleMemoryCommand(mem, { name: "ingat", arg: "suka jawaban ringkas" }).includes("sudah ada"), "balasan: duplikat");
  handleMemoryCommand(mem, { name: "ingat", arg: "zona WITA" });
  check(handleMemoryCommand(mem, { name: "ingat", arg: "satu lagi" }).includes("sudah penuh"), "balasan: penuh -> saran /lupa");
  const l = handleMemoryCommand(mem, { name: "catatan", arg: "" });
  check(l.includes("1. suka jawaban ringkas") && l.includes("2. zona WITA") && l.includes("hanya dibaca Ollama lokal"), "balasan: daftar bernomor");
  check(handleMemoryCommand(mem, { name: "lupa", arg: "" }).includes("Sebut nomor"), "balasan: /lupa tanpa nomor");
  check(handleMemoryCommand(mem, { name: "lupa", arg: "7" }).includes("Tidak ada catatan nomor 7"), "balasan: /lupa nomor tak ada");
  check(handleMemoryCommand(mem, { name: "lupa", arg: "1" }).includes("Dihapus: suka jawaban ringkas"), "balasan: /lupa 1");
  check(handleMemoryCommand(mem, { name: "lupa", arg: "semua" }).includes("1 catatan dihapus"), "balasan: /lupa semua");
  mem.close();
}

// ---- masuk ke prompt Ollama untuk /dokumen (dan tidak ke tempat lain)
{
  const index = await openKbIndex({ file: ":memory:", log: silent });
  index.upsertDoc({ id: "local:uu.md", title: "UU 1 Tahun 2004", pages: [{ page: 3, text: "Pasal 12. Hibah diberikan paling lama tiga tahun anggaran." }] });
  const mem = await openOwnerMemory({ file: ":memory:", log: silent });
  mem.add("pemilik lebih suka jawaban ringkas");
  const seen = [];
  const ld = createLocalDocs({ index, getMemory: () => mem.promptBlock(), callModel: async (messages) => { seen.push(messages); return "Hibah paling lama *tiga tahun anggaran*."; } });
  await ld.ask("berapa lama hibah diberikan?");
  const sys = seen[0][0].content;
  check(sys.includes("CATATAN PRIBADI PEMILIK") && sys.includes("pemilik lebih suka jawaban ringkas") && sys.includes("HANYA dari KONTEKS DOKUMEN"), "dokumen: catatan masuk ke prompt sistem + pengingat bahwa fakta tetap dari dokumen");
  check(!seen[0][1].content.includes("pemilik lebih suka"), "dokumen: catatan tidak bercampur ke konteks dokumen");

  const noMem = createLocalDocs({ index, callModel: async (messages) => { seen.push(messages); return "ok"; } });
  await noMem.ask("berapa lama hibah diberikan?");
  check(!seen[1][0].content.includes("CATATAN PRIBADI"), "dokumen: tanpa memori -> prompt tidak berubah");

  const broken = createLocalDocs({ index, getMemory: () => { throw new Error("rusak"); }, callModel: async (messages) => { seen.push(messages); return "tetap jawab"; } });
  check((await broken.ask("berapa lama hibah diberikan?")).ok, "dokumen: memori rusak tidak menggagalkan jawaban");
  mem.close();
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
  const mem = await openOwnerMemory({ file: ":memory:", log: silent });
  const chats = [];
  const tg = createTelegram({ config: cfg, deps: { chat: async (h) => { chats.push(h); return "ai-biasa"; }, memory: { handle: (c) => handleMemoryCommand(mem, c) } }, fetchImpl: f, log: silent });
  await tg.handleOwnerText("111", "/ingat klien X pakai skema Y");
  await tg.handleOwnerText("111", "/catatan");
  await tg.handleOwnerText("111", "/memori");
  await tg.handleOwnerText("111", "/lupa 1");
  check(sent[0].includes("Tersimpan") && sent[1].includes("1. klien X pakai skema Y") && sent[2].includes("1. klien X pakai skema Y") && sent[3].includes("Dihapus"), "telegram: /ingat, /catatan, alias /memori, /lupa");
  check(chats.length === 0, "telegram: perintah catatan TIDAK diteruskan ke AI cloud sebagai obrolan");
  const none = createTelegram({ config: cfg, deps: { chat: async () => "x" }, fetchImpl: f, log: silent });
  await none.handleOwnerText("111", "/ingat apa saja");
  check(sent[4].includes("belum aktif"), "telegram: tanpa modul -> pesan ramah");
  mem.close();
}

console.log(fails === 0 ? "\nSemua tes owner-memory lulus." : `\n${fails} tes owner-memory GAGAL.`);
process.exit(fails === 0 ? 0 : 1);
