// Tes modul Telegram (telegram.js) dengan Bot API palsu, tanpa jaringan.
//   node test-telegram.mjs
import { createTelegram, readTelegramConfig, simabKeyboard, splitMessage, waToTelegramHtml } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };

// ---- konfigurasi
{
  const off = readTelegramConfig({});
  check(off.enabled === false && off.ownerIds.length === 0 && off.mirror === true, "config: tanpa token = mati, mirror bawaan aktif");
  const on = readTelegramConfig({ TELEGRAM_BOT_TOKEN: " 12:abc ", TELEGRAM_OWNER_IDS: "111, 222 ,abc,-100333", TELEGRAM_MIRROR_NOTIFICATIONS: "FALSE", TELEGRAM_HISTORY_LIMIT: "6" });
  check(on.enabled && on.token === "12:abc" && on.ownerIds.join() === "111,222,-100333" && on.mirror === false && on.historyLimit === 6, "config: token dipangkas, id non-angka dibuang, mirror=false, batas riwayat");
  check(readTelegramConfig({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_HISTORY_LIMIT: "999" }).historyLimit === 40, "config: batas riwayat dibatasi 40");
}

// ---- pemecah pesan
{
  check(splitMessage("halo").join("|") === "halo" && splitMessage("   ").length === 0, "split: pesan pendek utuh, kosong dibuang");
  const long = Array.from({ length: 40 }, (_, i) => `Paragraf ${i} ` + "x".repeat(200)).join("\n\n");
  const parts = splitMessage(long, 1000);
  check(parts.length > 1 && parts.every((p) => p.length <= 1010), "split: teks panjang terpotong <= batas");
  check(parts.join("\n\n").replace(/\s+/g, "") === long.replace(/\s+/g, ""), "split: tidak ada isi yang hilang");
  const code = "```\n" + Array.from({ length: 60 }, (_, i) => `baris ${i} ` + "y".repeat(50)).join("\n") + "\n```";
  const cp = splitMessage(code, 800);
  check(cp.length > 1 && cp.every((p) => ((p.match(/```/g) || []).length % 2) === 0), "split: blok kode yang terbelah selalu tertutup di tiap potongan");
}

// ---- format WhatsApp -> HTML Telegram
{
  check(waToTelegramHtml("*tebal* dan _miring_ dan ~coret~") === "<b>tebal</b> dan <i>miring</i> dan <s>coret</s>", "html: tebal, miring, coret");
  check(waToTelegramHtml("a < b & c > d") === "a &lt; b &amp; c &gt; d", "html: karakter khusus di-escape");
  check(waToTelegramHtml("pakai `x<y` ya") === "pakai <code>x&lt;y</code> ya", "html: kode satu baris di-escape");
  check(waToTelegramHtml("```js\nif (a<b) *x*\n```") === "<pre>if (a&lt;b) *x*</pre>", "html: blok kode apa adanya (tanpa format di dalamnya)");
  check(waToTelegramHtml("file_name_ini dan 2*3*4") === "file_name_ini dan 2*3*4", "html: garis bawah/bintang di dalam kata tidak dianggap format");
  check(waToTelegramHtml("<b>jahat</b>") === "&lt;b&gt;jahat&lt;/b&gt;", "html: tag dari teks asli tidak lolos");
}

// ---- Bot API palsu
function fakeApi({ failHtml = false, failSendTo = new Set(), getMe = { ok: true, result: { username: "ayyubi_bot" } }, queue = [] } = {}) {
  const calls = [];
  const f = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    const json = (o, status = 200) => ({ status, json: async () => o });
    if (method === "getMe") return json(getMe, getMe.ok ? 200 : 401);
    if (method === "sendMessage") {
      if (failSendTo.has(String(body.chat_id))) return json({ ok: false, error_code: 403, description: "Forbidden: bot was blocked" }, 403);
      if (failHtml && body.parse_mode === "HTML") return json({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, 400);
      return json({ ok: true, result: { message_id: 1 } });
    }
    if (method === "getUpdates") {
      const batch = queue.shift() || [];
      if (queue.length === 0 && batch.length === 0) f.onIdle?.();
      return json({ ok: true, result: batch });
    }
    return json({ ok: true, result: true });
  };
  f.calls = calls;
  f.texts = (chat) => calls.filter((c) => c.method === "sendMessage" && (!chat || String(c.body.chat_id) === String(chat))).map((c) => c.body.text);
  return f;
}
const cfg = (o = {}) => ({ token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true, ...o });
const msg = (chat, text, extra = {}) => ({ update_id: 1, message: { chat: { id: Number(chat), type: "private" }, text, ...extra } });

// ---- mode pairing & pemilik
{
  const f = fakeApi();
  const ran = [];
  const tg = createTelegram({ config: cfg({ ownerIds: [] }), deps: { chat: async () => { ran.push("chat"); return "x"; } }, fetchImpl: f, log: quiet });
  await tg.handleUpdate(msg(999, "halo"));
  check(f.texts(999).length === 1 && f.texts(999)[0].includes("999") && f.texts(999)[0].includes("TELEGRAM_OWNER_IDS") && ran.length === 0, "pairing: hanya membalas id chat, AI tidak dipanggil");
  await tg.handleUpdate(msg(999, "halo lagi"));
  check(f.texts(999).length === 1, "pairing: tidak membalas berulang dalam 30 detik");
  await tg.handleUpdate({ update_id: 2, message: { chat: { id: -5, type: "group" }, text: "hai" } });
  check(f.texts(-5).length === 0, "pairing: grup diabaikan");
}
{
  const f = fakeApi();
  const calls = [];
  const tgA = createTelegram({ config: cfg(), deps: { chat: async () => "x", arsip: { handle: (arg, o) => { calls.push([arg, o.chatId]); return `arsip:${arg}`; } } }, fetchImpl: f, log: quiet });
  await tgA.handleUpdate(msg(111, "/arsip"));
  await tgA.handleUpdate(msg(111, "/arsip hapus 3 ya"));
  check(f.texts(111).join("|") === "arsip:|arsip:hapus 3 ya" && calls[1][0] === "hapus 3 ya" && calls[1][1] === "111", "/arsip diteruskan ke modul arsip beserta argumennya");
  const f2 = fakeApi();
  const tgB = createTelegram({ config: cfg(), deps: { chat: async () => "x" }, fetchImpl: f2, log: quiet });
  await tgB.handleUpdate(msg(111, "/arsip"));
  check(/belum aktif/.test(f2.texts(111)[0]), "/arsip tanpa modul: pesan jelas, bukan galat");
}
{
  const f = fakeApi();
  const ran = [];
  const tg = createTelegram({ config: cfg(), deps: { chat: async () => { ran.push("chat"); return "x"; } }, fetchImpl: f, log: quiet });
  await tg.handleUpdate(msg(222, "halo bot"));
  await tg.handleUpdate(msg(222, "/simab pagu"));
  check(f.calls.filter((c) => c.method === "sendMessage").length === 0 && ran.length === 0, "keamanan: chat selain pemilik diabaikan sepenuhnya (tidak dibalas, AI tidak dipanggil)");
  await tg.handleUpdate({ update_id: 3, message: { chat: { id: 111, type: "supergroup" }, text: "halo" } });
  check(f.calls.filter((c) => c.method === "sendMessage").length === 0, "keamanan: id pemilik di grup tetap diabaikan (hanya chat pribadi)");
  await tg.handleUpdate(msg(111, "/start"));
  check(f.texts(111)[0].includes("Ayyubi") && f.texts(111)[0].includes("/simab"), "pemilik: /start menampilkan bantuan");
  check(f.texts(111)[0].length <= 3500 && f.texts(111)[0].includes("/arsip"), "HELP memuat /arsip dan tetap di bawah MAX_TEXT (3500)");
  await tg.handleUpdate(msg(111, "/id"));
  check(f.texts(111)[1].includes("111"), "pemilik: /id");
  await tg.handleUpdate({ update_id: 4, message: { chat: { id: 111, type: "private" }, photo: [{}] } });
  check(f.texts(111)[2].includes("teks"), "pemilik: pesan non-teks dijawab sopan");
  await tg.handleUpdate(msg(111, "/lain"));
  check(f.texts(111)[3].includes("tidak dikenal"), "pemilik: perintah tak dikenal");
}

// ---- SiMAB, ringkasan, peraturan
{
  const f = fakeApi();
  const log = { simab: [], reg: [], sum: 0 };
  let session = false;
  const simab = {
    enabled: true,
    hasSession: (k) => session && k === "tg:111",
    run: async (text, opts) => { log.simab.push({ text, key: opts.sessionKey }); await opts.notify("notify dulu"); if (/rekam/.test(text)) session = true; if (text === "1") session = false; return "hasil *pagu*"; }
  };
  const tg = createTelegram({
    config: cfg(),
    deps: { chat: async () => "ai", simab, summary: async () => { log.sum++; return "ringkasan hari ini"; }, regNow: async (o) => { log.reg.push(o.all); await o.sendTo("laporan peraturan"); } },
    fetchImpl: f, log: quiet
  });
  await tg.handleOwnerText("111", "/simab pagu 2026");
  check(log.simab[0].text === "simab pagu 2026" && log.simab[0].key === "tg:111", "simab: '/simab x' diteruskan sebagai 'simab x' dengan kunci sesi per chat");
  check(f.texts(111).slice(0, 2).join("|") === "notify dulu|hasil <b>pagu</b>", "simab: notifikasi lalu hasil (format WA -> HTML)");
  await tg.handleOwnerText("111", "simab cek 5");
  check(log.simab[1].text === "simab cek 5", "simab: tanpa garis miring juga dikenali");
  await tg.handleOwnerText("111", "simab rekam umum");
  await tg.handleOwnerText("111", "1");
  check(log.simab[3]?.text === "1", "simab: balasan angka selama sesi rekam aktif masuk ke SiMAB, bukan AI");
  await tg.handleOwnerText("111", "/ringkasan");
  check(log.sum === 1 && f.texts(111).some((t) => t === "ringkasan hari ini"), "ringkasan: dikirim ke Telegram");
  await tg.handleOwnerText("111", "/peraturan");
  await tg.handleOwnerText("111", "/peraturan semua");
  check(log.reg.join() === "false,true" && f.texts(111).filter((t) => t === "laporan peraturan").length === 2, "peraturan: dikirim ke pemanggil; 'semua' meneruskan all=true");
}
{
  const f = fakeApi();
  const tg = createTelegram({ config: cfg(), deps: { chat: async () => "x", simab: { enabled: false } }, fetchImpl: f, log: quiet });
  await tg.handleOwnerText("111", "simab pagu");
  check(f.texts(111)[0].includes("SiMAB belum aktif"), "simab: dimatikan -> pesan petunjuk");
}

// ---- obrolan AI & riwayat
{
  const f = fakeApi();
  const seen = [];
  let fail = false;
  const tg = createTelegram({ config: cfg(), deps: { chat: async (h, t) => { seen.push(h.map((x) => `${x.role}:${x.text}`)); if (fail) throw new Error("kuota habis"); return `jawab ${t}`; } }, fetchImpl: f, log: quiet });
  await tg.handleOwnerText("111", "satu");
  await tg.handleOwnerText("111", "dua");
  check(seen[1].join() === "user:satu,model:jawab satu,user:dua", "chat: riwayat ikut dikirim (user, model, user)");
  await tg.handleOwnerText("111", "tiga");
  await tg.handleOwnerText("111", "empat");
  check(seen[3].length === 4 && seen[3][3] === "user:empat", "chat: riwayat dibatasi historyLimit (4)");
  fail = true;
  await tg.handleOwnerText("111", "lima");
  check(f.texts(111).at(-1).includes("Gagal membalas") && f.texts(111).at(-1).includes("kuota habis"), "chat: gagal -> pesan error ke pemilik");
  fail = false;
  await tg.handleOwnerText("111", "enam");
  check(!seen.at(-1).join().includes("lima") && seen.at(-1).at(-1) === "user:enam", "chat: pesan yang gagal dijawab tidak tertinggal di riwayat");
  await tg.handleOwnerText("111", "/baru");
  await tg.handleOwnerText("111", "tujuh");
  check(seen.at(-1).join() === "user:tujuh", "chat: /baru mengosongkan riwayat");
}

// ---- pengiriman: HTML ditolak -> teks polos; sendOwner; pemecahan
{
  const f = fakeApi({ failHtml: true });
  const tg = createTelegram({ config: cfg(), deps: { chat: async () => "*x*" }, fetchImpl: f, log: quiet });
  await tg.send("111", "halo *tebal*");
  const sends = f.calls.filter((c) => c.method === "sendMessage");
  check(sends.length === 2 && sends[0].body.parse_mode === "HTML" && sends[1].body.parse_mode === undefined && sends[1].body.text === "halo *tebal*", "kirim: HTML ditolak (400) -> ulangi sebagai teks polos apa adanya");
}
{
  const f = fakeApi({ failSendTo: new Set(["222"]) });
  const tg = createTelegram({ config: cfg({ ownerIds: ["111", "222"] }), deps: {}, fetchImpl: f, log: quiet });
  check((await tg.sendOwner("notif")) === 1, "sendOwner: satu pemilik gagal (403), satu berhasil -> 1");
  const off = createTelegram({ config: cfg({ ownerIds: [] }), deps: {}, fetchImpl: f, log: quiet });
  const off2 = createTelegram({ config: { ...cfg(), enabled: false }, deps: {}, fetchImpl: f, log: quiet });
  check((await off.sendOwner("x")) === 0 && (await off2.sendOwner("x")) === 0, "sendOwner: tanpa pemilik / dimatikan -> 0, tidak memanggil API");
}
{
  const f = fakeApi();
  const tg = createTelegram({ config: cfg(), deps: {}, fetchImpl: f, log: quiet });
  const n = await tg.send("111", Array.from({ length: 30 }, (_, i) => `baris ${i} ` + "z".repeat(300)).join("\n\n"));
  check(n > 1 && f.calls.filter((c) => c.method === "sendMessage").length === n, "kirim: pesan panjang dipecah jadi beberapa pesan");
}


// ---- tombol pilihan SiMAB (dari teks balasan)
{
  const groups = [
    "📋 *Rekam kegiatan — Seksi Umum*", "TA 2026", "3 kelompok POK • 9 kode MAK", "",
    "1. *4701.EBA.002* — Layanan perkantoran", "   pagu seksi Rp10.000.000",
    "2. *4701.EBA.994*", "3. *4701.EBA.951* — Layanan sarana dan prasarana internal yang sangat panjang sekali uraiannya",
    "", "Balas *angka* untuk memilih kelompok • *lanjut* / *balik* (hal 2/3)", "Atau *cari <kata>* untuk langsung mencari kode MAK, mis. *cari listrik* • *batal*"
  ].join("\n");
  const kb = simabKeyboard(groups);
  const flat = kb.flat();
  check(kb.slice(0, 3).every((r) => r.length === 1) && kb[0][0].callback_data === "sm:1" && kb[1][0].callback_data === "sm:2" && kb[2][0].callback_data === "sm:3", "tombol: tiap pilihan bernomor jadi satu tombol (callback sm:N)");
  check(kb[0][0].text.startsWith("1. 4701.EBA.002") && !kb[0][0].text.includes("*") && kb[2][0].text.length <= 46 && kb[2][0].text.endsWith("…"), "tombol: label tanpa tanda *, label panjang dipotong");
  check(flat.some((b) => b.callback_data === "sm:lanjut") && flat.some((b) => b.callback_data === "sm:balik") && flat.some((b) => b.callback_data === "sm:batal") && !flat.some((b) => /cari/.test(b.callback_data)), "tombol: Lanjut/Balik/Batal ada, 'cari <kata>' tidak dijadikan tombol");
  const confirm = ["✅ *Ringkasan*", "MAK: *4701.EBA.002.052.A.521211*", "Jumlah: *Rp1.500.000*", "", "Balas *ya* untuk menyimpan • *ubah* untuk mengisi ulang • *batal*"].join("\n");
  check(simabKeyboard(confirm).flat().map((b) => b.callback_data).join() === "sm:ya,sm:ubah,sm:batal", "tombol: layar konfirmasi = Ya, Ubah, Batal");
  const del = ["🗑️ *Konfirmasi hapus kegiatan*", "ID: *AB12*", "", "Balas *ya hapus* untuk menghapus • *batal* untuk membatalkan"].join("\n");
  check(simabKeyboard(del).flat().map((b) => b.callback_data).join() === "sm:ya hapus,sm:batal", "tombol: konfirmasi hapus = 'ya hapus' (bukan 'ya'), Batal");
  const input = ["✅ *4701.EBA.002*", "Sisa pagu: *Rp1*", "", "Kirim *3 baris dalam satu pesan*:", "1️⃣ uraian", "2️⃣ tanggal dokumen", "3️⃣ jumlah", "", "Contoh:", "Pembelian ATK", "5/10/2026", "1.500.000", "", "*kembali* untuk memilih kode lain • *batal*"].join("\n");
  check(simabKeyboard(input).flat().map((b) => b.callback_data).join() === "sm:kembali,sm:batal", "tombol: layar isi data = Kembali, Batal; contoh '1.500.000' bukan pilihan");
  check(simabKeyboard("Pagu seksi umum: *Rp5.000.000*\n1. *a* — b") === null, "tombol: jawaban biasa tanpa ajakan 'Balas *angka*' tidak diberi tombol");
  check(simabKeyboard("Dibatalkan. Tidak ada yang disimpan.") === null, "tombol: teks tanpa pilihan -> null");
}

// ---- alur tombol di Telegram
{
  const f = fakeApi();
  const runs = [];
  let session = true;
  const LIST = ["Pilih:", "1. *AAA* — satu", "2. *BBB* — dua", "", "Balas *angka* • *batal*"].join("\n");
  const simab = { enabled: true, hasSession: () => session, run: async (text) => { runs.push(text); if (text === "batal") { session = false; return "Perekaman dibatalkan."; } return LIST; } };
  const tg = createTelegram({ config: cfg(), deps: { chat: async () => "ai", simab }, fetchImpl: f, log: quiet });
  await tg.handleUpdate(msg(111, "/simab rekam umum"));
  const sent = f.calls.filter((c) => c.method === "sendMessage");
  const kbMsg = sent.at(-1).body;
  check(kbMsg.reply_markup?.inline_keyboard?.length === 3 && kbMsg.reply_markup.inline_keyboard[0][0].callback_data === "sm:1", "alur: balasan SiMAB yang menunggu pilihan membawa tombol (2 nomor + batal)");
  const cb = (data, from = 111, chat = 111, type = "private", mid = 7) => ({ update_id: 9, callback_query: { id: "cbq1", from: { id: from }, data, message: { message_id: mid, chat: { id: chat, type } } } });
  await tg.handleUpdate(cb("sm:2"));
  check(runs.at(-1) === "2" && f.calls.some((c) => c.method === "answerCallbackQuery"), "alur: menekan tombol 2 = mengetik '2' untuk SiMAB, dan ditandai 'diterima' ke Telegram");
  check(f.calls.some((c) => c.method === "editMessageReplyMarkup" && c.body.message_id === 7 && c.body.reply_markup.inline_keyboard.length === 0), "alur: tombol pada pesan yang ditekan dihapus");
  const before = runs.length;
  await tg.handleUpdate(cb("sm:1", 222, 222));
  await tg.handleUpdate(cb("sm:1", 111, -100, "supergroup"));
  await tg.handleUpdate(cb("lain:1"));
  check(runs.length === before, "keamanan: tombol dari non-pemilik, dari grup, atau data bukan 'sm:' tidak menjalankan apa pun");
  const kbBefore = f.calls.filter((c) => c.method === "editMessageReplyMarkup").length;
  await tg.handleUpdate(msg(111, "1"));
  check(f.calls.filter((c) => c.method === "editMessageReplyMarkup").length > kbBefore, "alur: balasan baru berisi tombol menghapus tombol pesan sebelumnya (tidak ada tombol basi)");
  await tg.handleUpdate(cb("sm:batal"));
  check(runs.at(-1) === "batal" && f.texts(111).at(-1).includes("dibatalkan") && !f.calls.filter((c) => c.method === "sendMessage").at(-1).body.reply_markup, "alur: 'Batal' mengakhiri sesi, balasan akhir tanpa tombol");
  await tg.handleUpdate(cb("sm:1"));
  check(f.texts(111).at(-1).includes("Sesi SiMAB sudah berakhir") && runs.at(-1) === "batal", "alur: menekan tombol lama setelah sesi berakhir -> pesan 'sesi berakhir', SiMAB tidak dijalankan");
}
{
  // markup hanya di potongan terakhir bila balasan panjang
  const f = fakeApi();
  const long = Array.from({ length: 12 }, (_, i) => `${i + 1}. *KODE${i}* — ` + "u".repeat(400)).join("\n") + "\n\nBalas *angka* • *batal*";
  const simab = { enabled: true, hasSession: () => true, run: async () => long };
  const tg = createTelegram({ config: cfg(), deps: { simab }, fetchImpl: f, log: quiet });
  await tg.handleUpdate(msg(111, "/simab rekam umum"));
  const sent = f.calls.filter((c) => c.method === "sendMessage");
  check(sent.length > 1 && sent.slice(0, -1).every((c) => !c.body.reply_markup) && sent.at(-1).body.reply_markup, "alur: balasan panjang dipecah, tombol hanya di pesan terakhir");
}

// ---- /status
{
  const f = fakeApi();
  const tg = createTelegram({ config: cfg(), deps: { status: async () => "📊 *Status Ayyubi*\nWhatsApp: tersambung" }, fetchImpl: f, log: quiet });
  await tg.handleOwnerText("111", "/status");
  check(f.texts(111)[0] === "📊 <b>Status Ayyubi</b>\nWhatsApp: tersambung", "status: teks dari index.js dikirim ke pemilik");
  const f2 = fakeApi();
  const tg2 = createTelegram({ config: cfg(), deps: { status: async () => { throw new Error("db mati"); } }, fetchImpl: f2, log: quiet });
  await tg2.handleOwnerText("111", "/status");
  check(f2.texts(111)[0].includes("Status gagal dibuat") && f2.texts(111)[0].includes("db mati"), "status: gagal -> pesan error, bot tetap hidup");
  const f3 = fakeApi();
  const tg3 = createTelegram({ config: cfg(), deps: {}, fetchImpl: f3, log: quiet });
  await tg3.handleOwnerText("111", "/status");
  check(f3.texts(111)[0].includes("belum tersedia"), "status: tanpa dependensi -> pesan 'belum tersedia'");
}

// ---- start & polling
{
  const mkTg = (f, extra = {}) => createTelegram({ config: cfg(), deps: { chat: async (h, t) => `jawab ${t}`, ...extra }, fetchImpl: f, log: quiet, sleep: async () => {} });
  const f = fakeApi({ queue: [[{ update_id: 10, message: { chat: { id: 111, type: "private" }, text: "halo" } }, { update_id: 11, message: { chat: { id: 111, type: "private" }, text: "dunia" } }]] });
  const saved = {};
  const tg = mkTg(f, { state: { get: async () => "5", set: async (k, v) => { saved[k] = v; } } });
  f.onIdle = () => tg.stop();
  check((await tg.start()) === true, "start: berhasil");
  await new Promise((r) => setTimeout(r, 50));
  const polls = f.calls.filter((c) => c.method === "getUpdates");
  check(polls[0].body.offset === 5, "polling: offset awal dimuat dari penyimpanan");
  check(f.texts(111).join("|") === "jawab halo|jawab dunia", "polling: pesan diproses berurutan");
  check(saved.telegram_offset === "12", "polling: offset berikutnya (update_id + 1) disimpan");
  check(f.calls.some((c) => c.method === "deleteWebhook") && f.calls.some((c) => c.method === "setMyCommands"), "start: webhook dibersihkan & daftar perintah dipasang");
}
{
  const f = fakeApi({ getMe: { ok: false, description: "Unauthorized" } });
  const tg = createTelegram({ config: cfg(), deps: {}, fetchImpl: f, log: quiet, sleep: async () => {} });
  check((await tg.start()) === false && !f.calls.some((c) => c.method === "getUpdates"), "start: token salah -> tidak aktif, tidak polling");
  const off = createTelegram({ config: { ...cfg(), enabled: false }, deps: {}, fetchImpl: f, log: quiet });
  check((await off.start()) === false, "start: tanpa token tidak melakukan apa pun");
  check(off.describe().includes("mati") && createTelegram({ config: cfg({ ownerIds: [] }), fetchImpl: f, log: quiet }).describe().includes("pairing"), "describe: mati / pairing");
}

// ---- ketahanan jaringan & pesan tidak antre di belakang pekerjaan lambat
{
  const netErr = () => { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNRESET" }; return e; };
  // getMe gagal jaringan 3x lalu berhasil -> start tetap berhasil (dulu: mati permanen)
  const f0 = fakeApi();
  let failsLeft = 3;
  const f = async (url, init) => { if (String(url).endsWith("/getMe") && failsLeft-- > 0) throw netErr(); return f0(url, init); };
  f.texts = f0.texts; f.calls = f0.calls;
  const sleeps = [];
  const tg = createTelegram({ config: cfg(), deps: { chat: async () => "x" }, fetchImpl: f, log: quiet, sleep: async (ms) => void sleeps.push(ms) });
  f0.onIdle = () => tg.stop();
  check((await tg.start()) === true && sleeps.slice(0, 3).join() === "2000,4000,8000", "start: galat jaringan sesaat dicoba ulang (backoff 2/4/8 dtk), lalu tersambung");
  await new Promise((r) => setTimeout(r, 30));

  // semua percobaan gagal -> menyerah setelah 12x, tidak polling
  const fAll = async () => { throw netErr(); };
  const sl2 = [];
  const tgAll = createTelegram({ config: cfg(), deps: {}, fetchImpl: fAll, log: quiet, sleep: async (ms) => void sl2.push(ms) });
  check((await tgAll.start()) === false && sl2.length === 11 && Math.max(...sl2) === 30000, "start: gagal terus -> menyerah setelah 12 percobaan (jeda maks 30 dtk)");

  // log menyebut penyebab asli ("fetch failed" saja tidak cukup untuk diagnosis)
  const warns = [];
  const logW = { log() {}, error() {}, warn: (m) => warns.push(m) };
  const fPoll = async (url) => { if (String(url).endsWith("/getUpdates")) { const e = new TypeError("fetch failed"); e.cause = { code: "ETIMEDOUT", message: "connect ETIMEDOUT 149.154.166.110:443" }; throw e; } return f0(url, {}); };
  fPoll.texts = f0.texts; fPoll.calls = f0.calls;
  let n = 0;
  const tgP = createTelegram({ config: cfg(), deps: {}, fetchImpl: fPoll, log: logW, sleep: async () => { if (++n > 2) tgP.stop(); } });
  await tgP.start();
  await new Promise((r) => setTimeout(r, 30));
  check(warns.some((m) => m.includes("polling gagal") && m.includes("ETIMEDOUT")), "log: polling gagal menyebut kode penyebab (ETIMEDOUT)");

  // sendMessage: galat jaringan sesaat dicoba ulang; galat HTTP (403) tidak
  const f1 = fakeApi();
  let nf = 1;
  const fs1 = async (url, init) => { if (String(url).endsWith("/sendMessage") && nf-- > 0) throw netErr(); return f1(url, init); };
  fs1.texts = f1.texts;
  const tg1 = createTelegram({ config: cfg(), deps: { chat: async () => "ok" }, fetchImpl: fs1, log: quiet, sleep: async () => {} });
  await tg1.handleOwnerText("111", "/id");
  check(f1.texts(111).length === 1 && f1.texts(111)[0].includes("111"), "kirim: 'fetch failed' sesaat dicoba ulang dan terkirim satu kali");
  const f2 = fakeApi({ failSendTo: new Set(["111"]) });
  const tg2 = createTelegram({ config: cfg(), deps: { chat: async () => "ok" }, fetchImpl: f2, log: quiet, sleep: async () => {} });
  await tg2.handleOwnerText("111", "/id").catch(() => {});
  check(f2.calls.filter((c) => c.method === "sendMessage").length === 1, "kirim: galat HTTP 403 tidak diulang");

  // obrolan lambat tidak menahan perintah laptop / dokumen
  const slow = { release: null };
  const gate = new Promise((r) => (slow.release = r));
  const fq = fakeApi({ queue: [[
    { update_id: 20, message: { chat: { id: 111, type: "private" }, text: "pertanyaan lambat" } },
    { update_id: 21, message: { chat: { id: 111, type: "private" }, text: "/sistem" } },
    { update_id: 22, message: { chat: { id: 111, type: "private" }, text: "/dokumen apa" } }
  ]] });
  const ops = { commands: ["sistem"], handle: async (n) => `ops ${n}`, handleDocument: async () => undefined };
  const tgq = createTelegram({ config: cfg(), deps: { chat: async () => { await gate; return "jawaban lambat"; }, ops, localDocs: { list: () => "d", ask: async (q) => ({ reply: `dok ${q}` }) } }, fetchImpl: fq, log: quiet, sleep: async () => {} });
  fq.onIdle = () => tgq.stop();
  await tgq.start();
  await new Promise((r) => setTimeout(r, 60));
  check(fq.texts(111).includes("ops sistem") && fq.texts(111).includes("dok apa") && !fq.texts(111).includes("jawaban lambat"), "polling: /sistem dan /dokumen dijawab saat obrolan AI masih berjalan");
  slow.release();
  await new Promise((r) => setTimeout(r, 30));
  check(fq.texts(111).includes("jawaban lambat"), "polling: obrolan lambat tetap selesai dan terkirim");
}

// ---- pesan suara
{
  const f0 = fakeApi();
  const f = async (url, init) => {
    const u = String(url);
    if (u.includes("/file/bot")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([79, 103, 103, 83]).buffer };
    if (u.endsWith("/getFile")) { f.getFiles.push(JSON.parse(init.body).file_id); return { status: 200, json: async () => ({ ok: true, result: { file_path: "voice/file_1.oga" } }) }; }
    return f0(url, init);
  };
  f.getFiles = [];
  f.texts = f0.texts;
  f.calls = f0.calls;
  const heard = { text: "" };
  const got = [];
  let session = false;
  const simab = { enabled: true, hasSession: (k) => session && k === "tg:111", run: async (text) => { got.push(`simab:${text}`); if (/rekam/.test(text)) session = true; return "ok simab"; } };
  const tg = createTelegram({
    config: cfg({ voiceMaxSeconds: 60 }),
    deps: { chat: async (h, t) => { got.push(`chat:${t}`); return "balasan ai"; }, simab, transcribe: async (buf, o) => { got.push(`stt:${buf.length}:${o.mime}`); return { text: heard.text, engine: "groq" }; } },
    fetchImpl: f, log: quiet
  });
  const voice = (extra = {}) => ({ update_id: 9, message: { chat: { id: 111, type: "private" }, voice: { file_id: "F1", duration: 5, mime_type: "audio/ogg", file_size: 4000, ...extra } } });

  heard.text = "Apa kabar hari ini?";
  await tg.handleUpdate(voice());
  check(f.getFiles[0] === "F1" && got[0] === "stt:4:audio/ogg" && got[1] === "chat:Apa kabar hari ini?", "suara: diunduh, diubah jadi teks, lalu diproses sebagai obrolan biasa");
  check(f.texts(111)[0].includes("🎤") && f.texts(111)[0].includes("Apa kabar hari ini?") && f.texts(111)[1] === "balasan ai", "suara: bot menampilkan apa yang terdengar sebelum menjawab");

  heard.text = "Si mab rekam Umum.";
  await tg.handleUpdate(voice());
  check(got.includes("simab:simab rekam Umum") && session === true, "suara: 'Si mab rekam Umum' -> perintah simab rekam umum, sesi mulai");
  check(f.texts(111).some((t) => t.includes("➡️") && t.includes("simab rekam Umum")), "suara: hasil penyesuaian ditampilkan (➡️)");

  heard.text = "Nomor tiga.";
  await tg.handleUpdate(voice());
  check(got.includes("simab:3"), "suara: dalam sesi SiMAB 'Nomor tiga' -> 3");
  heard.text = "Pembelian ATK, tanggal lima Oktober dua ribu dua puluh enam, jumlah satu juta lima ratus ribu rupiah";
  await tg.handleUpdate(voice());
  check(got.includes("simab:Pembelian ATK\n5 Oktober 2026\n1500000"), "suara: dalam sesi SiMAB uraian+tanggal+jumlah -> tiga baris");

  const nBefore = got.length;
  await tg.handleUpdate(voice({ duration: 300 }));
  check(got.length === nBefore && f.texts(111).at(-1).includes("terlalu panjang"), "suara: terlalu panjang ditolak sebelum diunduh");
  heard.text = "";
  await tg.handleUpdate(voice());
  check(f.texts(111).at(-1).includes("tidak terdengar jelas"), "suara: tanpa ucapan jelas -> minta rekam ulang, tidak diproses");
  await tg.handleUpdate({ update_id: 10, message: { chat: { id: 222, type: "private" }, voice: { file_id: "X", duration: 3 } } });
  check(!f.getFiles.includes("X"), "keamanan: suara dari chat selain pemilik diabaikan (tidak diunduh)");
  const tgOff = createTelegram({ config: cfg(), deps: { chat: async () => "x" }, fetchImpl: f, log: quiet });
  await tgOff.handleUpdate(voice());
  check(f.texts(111).at(-1).includes("belum aktif"), "suara: tanpa kunci STT -> pesan belum aktif");
  const tgFail = createTelegram({ config: cfg(), deps: { chat: async () => "x", transcribe: async () => { throw new Error("Gagal mengubah suara jadi teks (500)"); } }, fetchImpl: f, log: quiet });
  await tgFail.handleUpdate(voice());
  check(f.texts(111).at(-1).includes("Gagal mengubah suara jadi teks"), "suara: galat transkripsi disampaikan ke pemilik");

  // unduhan berkas suara: gangguan jaringan sesaat dicoba ulang, kegagalan tetap menyebut sebab aslinya
  const netErr = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
  let dl = 0;
  const fFlaky = async (url, init) => {
    if (String(url).includes("/file/bot")) {
      dl++;
      if (dl <= 2) throw netErr();
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    return f(url, init);
  };
  const sizes = [];
  const sleeps = [];
  const tgFlaky = createTelegram({ config: cfg(), deps: { chat: async () => "ok", transcribe: async (buf) => { sizes.push(buf.length); return { text: "halo", engine: "groq" }; } }, fetchImpl: fFlaky, log: quiet, sleep: async (ms) => { sleeps.push(ms); } });
  await tgFlaky.handleUpdate(voice());
  check(dl === 3 && sizes[0] === 3, "suara: unduhan gagal dua kali lalu berhasil -> tetap diproses (dicoba ulang)");
  check(sleeps.length >= 2, "suara: ada jeda antar percobaan unduh");

  let dl2 = 0;
  const fDead = async (url, init) => {
    if (String(url).includes("/file/bot")) { dl2++; throw netErr(); }
    return f(url, init);
  };
  const errLog = [];
  const tgDead = createTelegram({ config: cfg(), deps: { chat: async () => "x", transcribe: async () => ({ text: "x" }) }, fetchImpl: fDead, log: { ...quiet, error: (m) => errLog.push(m) }, sleep: async () => {} });
  await tgDead.handleUpdate(voice());
  check(dl2 === 3, "suara: unduhan selalu gagal -> berhenti setelah 3 percobaan");
  check(/ECONNRESET/.test(f.texts(111).at(-1)) && /unduh berkas/.test(f.texts(111).at(-1)), "suara: pesan ke pemilik memuat sebab asli (ECONNRESET)");
  check(errLog.some((m) => m.includes("ECONNRESET")), "suara: log memuat sebab asli");

  let dl3 = 0;
  const f404 = async (url, init) => {
    if (String(url).includes("/file/bot")) { dl3++; return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; }
    return f(url, init);
  };
  const tg404 = createTelegram({ config: cfg(), deps: { chat: async () => "x", transcribe: async () => ({ text: "x" }) }, fetchImpl: f404, log: quiet, sleep: async () => {} });
  await tg404.handleUpdate(voice());
  check(dl3 === 1, "suara: HTTP 404 pada unduhan tidak diulang");
}

// ---- balasan suara (/suara) dan tutor Inggris (/speak)
{
  const f0 = fakeApi();
  const f = async (url, init) => {
    const u = String(url);
    if (u.includes("/file/bot")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([79, 103, 103, 83]).buffer };
    if (u.endsWith("/getFile")) return { status: 200, json: async () => ({ ok: true, result: { file_path: "voice/f.oga" } }) };
    if (u.endsWith("/sendVoice")) {
      const fd = init.body;
      f.voices.push({ chat: fd.get("chat_id"), size: fd.get("voice").size, type: fd.get("voice").type });
      if (f.failVoice) return { status: 400, json: async () => ({ ok: false, error_code: 400, description: "Bad Request: wrong file" }) };
      return { status: 200, json: async () => ({ ok: true, result: { message_id: 5 } }) };
    }
    return f0(url, init);
  };
  f.voices = [];
  f.failVoice = false;
  f.texts = f0.texts;
  f.calls = f0.calls;
  const store = new Map();
  const spoken = [];
  const speakImpl = { err: null };
  const stt = [];
  const tutorCalls = [];
  const tutorState = { fail: false };
  const deps = {
    chat: async (h, t) => "Jawaban panjang dari AI. Ini kalimat kedua.",
    transcribe: async (buf, o) => { stt.push(o); return { text: f.heard, engine: "groq" }; },
    speak: async (text) => { spoken.push(text); if (speakImpl.err) throw speakImpl.err; return { ogg: Buffer.alloc(1200, 1), text }; },
    voiceCheck: async () => ({ ok: true }),
    tutor: async (a) => {
      tutorCalls.push(a);
      if (tutorState.fail) throw new Error("AI sibuk");
      if (a.userText === null) return { reply: "Hi! What did you do today?", correction: "", tip: "" };
      if (a.farewell) return { reply: "Bye! Take care.", correction: "", tip: "" };
      return a.userText.includes("go to market") ? { reply: "Oh, you went to the market? Nice.", correction: "I went to the market yesterday.", tip: "Gunakan went untuk lampau." } : { reply: "Cool, tell me more.", correction: "", tip: "" };
    },
    state: { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }
  };
  const tg = createTelegram({ config: cfg({ voiceMaxSeconds: 60, speakMaxTurns: 3, speakIdleMin: 60 }), deps, fetchImpl: f, log: quiet });
  const T = (text) => tg.handleUpdate(msg(111, text));
  const V = (heard) => { f.heard = heard; return tg.handleUpdate({ update_id: 9, message: { chat: { id: 111, type: "private" }, voice: { file_id: "F", duration: 4, mime_type: "audio/ogg", file_size: 3000 } } }); };

  // /suara
  await T("/suara");
  check(f.texts(111).at(-1).includes("otomatis") && f.texts(111).at(-1).includes("/suara on"), "suara: tanpa argumen menampilkan mode (bawaan otomatis)");
  await T("hai");
  check(f.voices.length === 0, "suara auto: teks biasa dibalas teks saja (tanpa voice)");
  await V("Apa kabar?");
  check(f.voices.length === 1 && f.voices[0].chat === "111" && f.voices[0].type === "audio/ogg" && f.voices[0].size === 1200, "suara auto: kirim suara -> dibalas voice note OGG");
  check(spoken.at(-1) === "Jawaban panjang dari AI. Ini kalimat kedua." && f.texts(111).at(-1) === "Jawaban panjang dari AI. Ini kalimat kedua.", "suara auto: teks lengkap tetap dikirim, suara membacakan jawaban");
  await T("/suara off");
  check(store.get("telegram_voice:111") === "off" && f.texts(111).at(-1).includes("mati"), "suara off: disimpan di bot_state");
  const n0 = f.voices.length;
  await V("Halo lagi");
  check(f.voices.length === n0, "suara off: kirim suara pun dibalas teks saja");
  await T("/suara on");
  await T("tes teks");
  check(f.voices.length === n0 + 1 && store.get("telegram_voice:111") === "on", "suara on: teks biasa pun dibalas voice");
  await T("/suara nyala");
  check(f.texts(111).at(-1).includes("selalu dibalas suara"), "suara: kata 'nyala' dikenali");
  // mode tersimpan terbaca setelah restart
  store.set("telegram_voice:111", "off");
  const tg2 = createTelegram({ config: cfg(), deps, fetchImpl: f, log: quiet });
  const n1 = f.voices.length;
  await tg2.handleUpdate(msg(111, "tes setelah restart"));
  check(f.voices.length === n1, "suara: mode dibaca dari bot_state saat bot dinyalakan ulang");
  // SiMAB tidak dibacakan
  store.set("telegram_voice:111", "on");
  const tg3 = createTelegram({ config: cfg(), deps: { ...deps, simab: { enabled: true, hasSession: () => false, run: async () => "hasil simab" } }, fetchImpl: f, log: quiet });
  const n2 = f.voices.length;
  await tg3.handleUpdate(msg(111, "simab pagu"));
  check(f.voices.length === n2, "suara: jawaban SiMAB tidak dibacakan");

  // gagal membuat suara
  const fx = fakeApi();
  speakImpl.err = Object.assign(new Error("ffmpeg belum terpasang."), { code: "ffmpeg" });
  const tgF = createTelegram({ config: cfg(), deps: { ...deps, state: { get: async () => "on", set: async () => {} } }, fetchImpl: f, log: quiet });
  const before = f.texts(111).length;
  await tgF.handleUpdate(msg(111, "tes ffmpeg"));
  await tgF.handleUpdate(msg(111, "tes ffmpeg lagi"));
  const added = f.texts(111).slice(before);
  check(added.filter((t) => t.includes("Pasang dengan: sudo apt install ffmpeg")).length === 1 && added.filter((t) => t === "Jawaban panjang dari AI. Ini kalimat kedua.").length === 2, "suara: ffmpeg tak ada -> teks tetap terkirim, petunjuk pasang hanya sekali");
  speakImpl.err = Object.assign(new Error("Kuota suara Gemini sedang habis."), { quota: true });
  const b2 = f.texts(111).length;
  await tgF.handleUpdate(msg(111, "tes kuota"));
  await tgF.handleUpdate(msg(111, "tes kuota 2"));
  const add2 = f.texts(111).slice(b2);
  check(add2.filter((t) => t.includes("Kuota suara Gemini sedang habis")).length === 1 && add2.filter((t) => t === "Jawaban panjang dari AI. Ini kalimat kedua.").length === 2, "suara: kuota habis -> teks tetap terkirim, pemberitahuan tidak berulang");
  speakImpl.err = null;
  f.failVoice = true;
  const b3 = f.texts(111).length;
  await tgF.handleUpdate(msg(111, "tes gagal kirim"));
  check(f.texts(111).slice(b3).includes("Jawaban panjang dari AI. Ini kalimat kedua."), "suara: sendVoice ditolak Telegram -> teks tetap terkirim, tidak crash");
  f.failVoice = false;

  // /speak
  store.set("telegram_voice:111", "off");
  const nv = f.voices.length;
  await T("/speak ordering coffee");
  check(tutorCalls.at(-1).userText === null && tutorCalls.at(-1).topic === "ordering coffee", "speak: sesi dimulai dengan topik & meminta pembuka");
  check(f.texts(111).some((t) => t.includes("Mode Speaking aktif") && t.includes("ordering coffee") && t.includes("/selesai")), "speak: pesan pembuka menjelaskan cara memakai");
  check(f.texts(111).at(-1) === "💬 Hi! What did you do today?" && f.voices.length === nv + 1 && spoken.at(-1) === "Hi! What did you do today?", "speak: sapaan tutor dikirim teks + voice (walau /suara off)");

  await V("I go to market yesterday");
  check(stt.at(-1).language === "en" && /English/.test(stt.at(-1).hint), "speak: suara masuk diubah jadi teks dengan bahasa Inggris");
  check(f.texts(111).some((t) => t === "🎤 “I go to market yesterday”"), "speak: ucapan yang terdengar ditampilkan");
  check(tutorCalls.at(-1).userText === "I go to market yesterday" && tutorCalls.at(-1).history.length === 1, "speak: tutor menerima ucapan + riwayat");
  check(f.texts(111).at(-1) === "💬 Oh, you went to the market? Nice.\n\n✏️ Lebih baik: I went to the market yesterday.\n💡 Gunakan went untuk lampau.", "speak: balasan memuat koreksi & tips (teks)");
  check(spoken.at(-1) === "Oh, you went to the market? Nice." && !spoken.at(-1).includes("Lebih baik"), "speak: yang diucapkan hanya balasan tutor, bukan koreksi");

  await T("I like coffee");
  check(tutorCalls.at(-1).userText === "I like coffee" && tutorCalls.at(-1).history.length === 3, "speak: ketikan juga diterima sebagai ucapan");
  check(f.texts(111).at(-1).startsWith("💬 Cool"), "speak: ketikan dibalas tutor (bukan obrolan AI biasa)");

  // batas giliran (speakMaxTurns=3): giliran ke-3 -> selesai
  await T("one more thing");
  check(f.texts(111).at(-1).includes("Batas 3 giliran tercapai"), "speak: batas giliran -> sesi selesai otomatis");
  await T("masih ngobrol?");
  check(f.texts(111).at(-1) === "Jawaban panjang dari AI. Ini kalimat kedua.", "speak: setelah selesai pesan biasa kembali ke obrolan AI");

  // perpisahan
  await T("/speak");
  await V("Okay, goodbye!");
  check(tutorCalls.at(-1).farewell === true && f.texts(111).some((t) => t === "💬 Bye! Take care."), "speak: ucapan perpisahan -> tutor menutup");
  check(f.texts(111).at(-1).includes("Sesi Speaking selesai"), "speak: perpisahan mengakhiri sesi otomatis");

  // /selesai
  await T("/selesai");
  check(f.texts(111).at(-1).includes("Tidak ada sesi Speaking"), "selesai: tanpa sesi -> pemberitahuan");
  await T("/speak");
  await T("/selesai");
  check(f.texts(111).at(-1).includes("Sesi Speaking selesai"), "selesai: mengakhiri sesi");
  await T("hai lagi");
  check(f.texts(111).at(-1) === "Jawaban panjang dari AI. Ini kalimat kedua.", "selesai: kembali ke obrolan biasa");

  // tutor gagal
  await T("/speak");
  tutorState.fail = true;
  await T("I am here");
  check(f.texts(111).at(-1).includes("Tutor gagal membalas") && f.texts(111).at(-1).includes("AI sibuk"), "speak: tutor gagal -> pesan jelas");
  tutorState.fail = false;
  await T("I am here again");
  check(tutorCalls.at(-1).history.length === 1, "speak: giliran yang gagal tidak masuk riwayat (bisa dicoba lagi)");
  await T("/selesai");

  // tutor di tengah sesi SiMAB tidak mengganggu; sesi kedaluwarsa
  let t = Date.now();
  const realNow = Date.now;
  await T("/speak");
  Date.now = () => t + 61 * 60_000;
  await T("masih di sini?");
  Date.now = realNow;
  check(f.texts(111).at(-1) === "Jawaban panjang dari AI. Ini kalimat kedua.", "speak: sesi diam > 60 menit kedaluwarsa -> kembali ke obrolan biasa");

  // tanpa tutor / tanpa suara masuk
  const tgN = createTelegram({ config: cfg(), deps: { chat: async () => "x" }, fetchImpl: f, log: quiet });
  await tgN.handleUpdate(msg(111, "/speak"));
  check(f.texts(111).at(-1).includes("belum tersedia"), "speak: tanpa tutor -> pesan belum tersedia");
  const tgNV = createTelegram({ config: cfg(), deps: { ...deps, transcribe: null }, fetchImpl: f, log: quiet });
  await tgNV.handleUpdate(msg(111, "/speak"));
  check(f.texts(111).some((t) => t.includes("suara masuk belum aktif")), "speak: tanpa STT -> diberi tahu cukup mengetik");
  await tgNV.handleUpdate(msg(111, "/selesai"));

  // perintah dari pemilik lain tidak menyentuh sesi
  await tg.handleUpdate({ update_id: 3, message: { chat: { id: 222, type: "private" }, text: "/speak" } });
  check(!f.texts(222).length, "keamanan: /speak dari chat selain pemilik diabaikan");
}


// ---- /speak id (ngobrol Indonesia)
{
  const f0 = fakeApi();
  const f = async (url, init) => {
    const u = String(url);
    if (u.includes("/file/bot")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([79, 103, 103, 83]).buffer };
    if (u.endsWith("/getFile")) return { status: 200, json: async () => ({ ok: true, result: { file_path: "voice/f.oga" } }) };
    if (u.endsWith("/sendVoice")) { f.voices++; return { status: 200, json: async () => ({ ok: true, result: { message_id: 5 } }) }; }
    return f0(url, init);
  };
  f.voices = 0;
  f.texts = f0.texts;
  const stt = [];
  const calls = [];
  const spoken = [];
  const deps = {
    chat: async () => "obrolan biasa",
    transcribe: async (buf, o) => { stt.push(o); return { text: f.heard, engine: "groq" }; },
    speak: async (text) => { spoken.push(text); return { ogg: Buffer.alloc(900, 1), text }; },
    voiceCheck: async () => ({ ok: true }),
    tutor: async (a) => {
      calls.push(a);
      if (a.userText === null) return { reply: "Hai! Lagi ngapain hari ini?", correction: "", tip: "" };
      if (a.farewell) return { reply: "Dadah, sampai ketemu lagi ya.", correction: "salah", tip: "salah juga" };
      return { reply: "Wah seru, ceritain dong.", correction: "Koreksi yang tidak boleh tampil.", tip: "Tip yang tidak boleh tampil." };
    },
    state: { get: async () => null, set: async () => {} }
  };
  const tg = createTelegram({ config: cfg({ speakMaxTurns: 5, speakIdleMin: 60, voiceMaxSeconds: 60 }), deps, fetchImpl: f, log: quiet });
  const T = (text) => tg.handleUpdate(msg(111, text));
  const V = (heard) => { f.heard = heard; return tg.handleUpdate({ update_id: 9, message: { chat: { id: 111, type: "private" }, voice: { file_id: "F", duration: 4, mime_type: "audio/ogg", file_size: 3000 } } }); };

  await T("/speak id soal liburan");
  check(calls.at(-1).lang === "id" && calls.at(-1).topic === "soal liburan" && calls.at(-1).userText === null, "speak id: bahasa id, topik 'soal liburan', minta pembuka");
  check(f.texts(111).some((t) => t.includes("Mode ngobrol bahasa Indonesia aktif") && t.includes("soal liburan") && t.includes("tanpa koreksi")), "speak id: pesan pembuka berbahasa Indonesia");
  check(f.texts(111).at(-1) === "💬 Hai! Lagi ngapain hari ini?" && spoken.at(-1) === "Hai! Lagi ngapain hari ini?" && f.voices === 1, "speak id: sapaan Rani dikirim teks + voice");

  await V("Aku baru pulang kerja nih");
  check(stt.at(-1).language === "id" && /bahasa Indonesia/.test(stt.at(-1).hint) && !/SiMAB/.test(stt.at(-1).hint), "speak id: suara masuk diubah jadi teks berbahasa Indonesia (tanpa kosakata SiMAB)");
  check(f.texts(111).some((t) => t === "🎤 “Aku baru pulang kerja nih”"), "speak id: ucapan yang terdengar ditampilkan");
  check(calls.at(-1).lang === "id" && calls.at(-1).history.length === 1 && calls.at(-1).farewell === false, "speak id: tutor menerima bahasa & riwayat");
  check(f.texts(111).at(-1) === "💬 Wah seru, ceritain dong." && !f.texts(111).at(-1).includes("Koreksi") && !f.texts(111).at(-1).includes("Tip"), "speak id: tidak ada koreksi/tip walau model mengirimnya");

  await T("Selamat malam!");
  check(calls.at(-1).farewell === false && f.texts(111).at(-1).startsWith("💬"), "speak id: 'Selamat malam!' bukan perpisahan");
  await T("Udahan dulu ya, aku pamit");
  check(calls.at(-1).farewell === true && f.texts(111).some((t) => t === "💬 Dadah, sampai ketemu lagi ya.") && !f.texts(111).some((t) => t.includes("salah")), "speak id: pamit Indonesia -> Rani menutup, tanpa koreksi");
  check(f.texts(111).at(-1).includes("Sesi ngobrol selesai") && f.texts(111).at(-1).includes("/speak id"), "speak id: sesi selesai otomatis dengan pesan Indonesia");
  await T("masih ada?");
  check(f.texts(111).at(-1) === "obrolan biasa", "speak id: setelah selesai kembali ke obrolan AI biasa");

  // /speak id tanpa topik, /selesai
  await T("/speak id");
  check(calls.at(-1).lang === "id" && calls.at(-1).topic === "", "speak id: tanpa topik");
  await T("/selesai");
  check(f.texts(111).at(-1).includes("Sesi ngobrol selesai"), "selesai: pesan sesi Indonesia");

  // variasi penulisan & bawaan tetap Inggris
  await T("/speak indonesia hobi");
  check(calls.at(-1).lang === "id" && calls.at(-1).topic === "hobi", "speak: 'indonesia' = id");
  await T("/selesai");
  await T("/speak en ordering food");
  check(calls.at(-1).lang === "en" && calls.at(-1).topic === "ordering food", "speak: 'en' = Inggris dengan topik");
  await T("/selesai");
  await T("/speak identity and culture");
  check(calls.at(-1).lang === "en" && calls.at(-1).topic === "identity and culture", "speak: kata 'identity' bukan kode bahasa 'id'");
  await V("I like coffee");
  check(stt.at(-1).language === "en", "speak: sesi Inggris tetap memakai pengenal suara Inggris");
  await T("/selesai");
  await T("/speak");
  check(calls.at(-1).lang === "en" && calls.at(-1).topic === "", "speak: tanpa argumen = Inggris");
  await T("/selesai");
}

// ---- /speak suara saja (bawaan): tanpa teks balasan & tanpa echo; teks hanya sebagai cadangan
for (const mode of ["ok", "gagal"]) {
  const f0 = fakeApi();
  const f = async (url, init) => {
    const u = String(url);
    if (u.includes("/file/bot")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([79, 103, 103, 83]).buffer };
    if (u.endsWith("/getFile")) return { status: 200, json: async () => ({ ok: true, result: { file_path: "voice/f.oga" } }) };
    if (u.endsWith("/sendVoice")) { f.voices++; return { status: 200, json: async () => ({ ok: true, result: { message_id: 5 } }) }; }
    return f0(url, init);
  };
  f.voices = 0;
  f.texts = f0.texts;
  const deps = {
    chat: async () => "obrolan biasa",
    transcribe: async () => ({ text: f.heard, engine: "groq" }),
    speak: async (text) => { if (mode === "gagal") throw Object.assign(new Error("habis"), { quota: true }); return { ogg: Buffer.alloc(900, 1), text }; },
    voiceCheck: async () => ({ ok: true }),
    tutor: async (a) => (a.userText === null ? { reply: "Hello there!", correction: "", tip: "" } : { reply: "Nice one.", correction: "I went", tip: "Past tense" }),
    state: { get: async () => null, set: async () => {} }
  };
  const tg = createTelegram({ config: cfg({ speakText: false, speakMaxTurns: 5, speakIdleMin: 60, voiceMaxSeconds: 60 }), deps, fetchImpl: f, log: quiet });
  const T = (text) => tg.handleUpdate(msg(111, text));
  const V = (heard) => { f.heard = heard; return tg.handleUpdate({ update_id: 9, message: { chat: { id: 111, type: "private" }, voice: { file_id: "F", duration: 4, mime_type: "audio/ogg", file_size: 3000 } } }); };
  await T("/speak");
  if (mode === "ok") {
    check(f.voices === 1 && !f.texts(111).some((t) => t.includes("Hello there!")), "suara-saja TG: sapaan hanya voice");
    check(f.texts(111).some((t) => t.includes("Mode suara saja")), "suara-saja TG: pembuka menjelaskan mode");
    const n = f.texts(111).length;
    await V("I go yesterday");
    check(f.voices === 2 && f.texts(111).length === n, "suara-saja TG: ucapan tidak di-echo, balasan tidak ditulis");
    await T("/koreksi");
    check(f.texts(111).at(-1).includes("I went") && f.texts(111).at(-1).includes("Past tense"), "suara-saja TG: /koreksi");
    await T("/teks on");
    check(f.texts(111).at(-1).includes("juga ditulis"), "suara-saja TG: /teks on");
    await V("second");
    check(f.texts(111).some((t) => t === "🎤 “second”") && f.texts(111).some((t) => t.startsWith("💬 Nice one.")), "suara-saja TG: teks on -> echo + teks");
    await T("/selesai");
    await T("/koreksi");
    check(f.texts(111).at(-1).includes("Tidak ada sesi"), "suara-saja TG: /koreksi tanpa sesi");
  } else {
    check(f.texts(111).some((t) => t.includes("Hello there!")), "suara-saja TG: suara gagal -> teks sapaan jadi cadangan");
    await T("I go yesterday");
    check(f.texts(111).some((t) => t.includes("Nice one.") && t.includes("✏️")), "suara-saja TG: suara gagal -> teks + koreksi cadangan");
    await T("/selesai");
  }
}

// ---- suara per bot: /suara daftar | coba | pakai | reset
{
  const { createPersonaVoice } = await import("./persona-voice.js");
  const f0 = fakeApi();
  const f = async (url, init) => {
    if (String(url).endsWith("/sendVoice")) {
      f.voices.push({ chat: init.body.get("chat_id") });
      return { status: 200, json: async () => ({ ok: true, result: { message_id: 5 } }) };
    }
    return f0(url, init);
  };
  f.voices = [];
  f.texts = f0.texts;
  const store = new Map();
  const state = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) };
  const spoken = [];
  const pv = createPersonaVoice({ state, env: {}, secondName: "Wongsobot", log: quiet });
  const deps = {
    chat: async () => "ok",
    speak: async (text, opts) => { spoken.push({ text, ...opts }); return { ogg: Buffer.alloc(1200, 1), text }; },
    voiceCheck: async () => ({ ok: true }),
    personaVoice: pv,
    state
  };
  const tg = createTelegram({ config: cfg(), deps, fetchImpl: f, log: quiet });
  const T = (text) => tg.handleUpdate(msg(111, text));

  await T("/suara daftar");
  check(f.texts(111).at(-1).includes("Puck") && f.texts(111).at(-1).includes("Zephyr") && f.texts(111).at(-1).includes("Wongsobot"), "suara-bot: /suara daftar menampilkan suara pria & wanita dan pengaturan sekarang");
  await T("/suara coba Puck anak laki-laki ceria");
  check(spoken.at(-1).voice === "Puck" && spoken.at(-1).style === "anak laki-laki ceria" && f.voices.length === 1 && f.texts(111).at(-1).includes("Contoh: Puck"), "suara-bot: /suara coba mengirim contoh dengan suara & gaya itu (tanpa menyimpan)");
  check(store.size === 0, "suara-bot: /suara coba tidak menyimpan apa pun");
  await T("/suara coba Puck gaya santai | Halo teman-teman semua");
  check(spoken.at(-1).text === "Halo teman-teman semua" && spoken.at(-1).style === "gaya santai", "suara-bot: teks contoh sendiri setelah tanda |");
  await T("/suara coba Ngawur");
  check(f.texts(111).at(-1).includes("tidak dikenal") && f.voices.length === 2, "suara-bot: nama suara salah -> pesan jelas, tanpa suara");
  await T("/suara pakai ayyubi puck anak laki-laki ceria");
  check(pv.get("main").voice === "Puck" && pv.get("main").style === "anak laki-laki ceria" && JSON.parse(store.get("persona_voice:main")).voice === "Puck", "suara-bot: /suara pakai ayyubi menyimpan ke bot_state");
  check(f.voices.length === 3 && /Ayyubi/.test(spoken.at(-1).text), "suara-bot: setelah menyimpan langsung dikirim contohnya (memakai nama bot)");
  await T("/suara pakai wongsobot Charon bapak-bapak tenang dan berwibawa");
  check(pv.get("wa2").voice === "Charon" && pv.get("main").voice === "Puck", "suara-bot: Wongsobot punya suara sendiri, Ayyubi tidak ikut berubah");
  await T("/suara coba wongsobot");
  check(spoken.at(-1).voice === "Charon" && /Wongsobot/.test(spoken.at(-1).text), "suara-bot: /suara coba wongsobot memakai pengaturannya sekarang");
  await T("/suara wongsobot");
  check(f.texts(111).at(-1).includes("Charon"), "suara-bot: /suara <bot> menampilkan pengaturannya");
  await T("/suara reset ayyubi");
  check(pv.get("main").voice === null && store.get("persona_voice:main") === "", "suara-bot: /suara reset mengembalikan ke bawaan");
  await T("/suara pakai ayyubi");
  check(f.texts(111).at(-1).includes("Pakai:"), "suara-bot: perintah kurang lengkap -> contoh pemakaian");
  await T("/voice");
  check(f.texts(111).at(-1).includes("Suara bot") || f.texts(111).at(-1).includes("Fitur balasan suara grup belum aktif"), "suara-bot: /voice tidak error");
  await T("/suara on");
  check(f.texts(111).at(-1).includes("selalu dibalas suara"), "suara-bot: /suara on|off|auto tetap berfungsi");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
