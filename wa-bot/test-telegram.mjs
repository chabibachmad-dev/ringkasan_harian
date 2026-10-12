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
const cfg = (o = {}) => ({ token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, ...o });
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
  const ran = [];
  const tg = createTelegram({ config: cfg(), deps: { chat: async () => { ran.push("chat"); return "x"; } }, fetchImpl: f, log: quiet });
  await tg.handleUpdate(msg(222, "halo bot"));
  await tg.handleUpdate(msg(222, "/simab pagu"));
  check(f.calls.filter((c) => c.method === "sendMessage").length === 0 && ran.length === 0, "keamanan: chat selain pemilik diabaikan sepenuhnya (tidak dibalas, AI tidak dipanggil)");
  await tg.handleUpdate({ update_id: 3, message: { chat: { id: 111, type: "supergroup" }, text: "halo" } });
  check(f.calls.filter((c) => c.method === "sendMessage").length === 0, "keamanan: id pemilik di grup tetap diabaikan (hanya chat pribadi)");
  await tg.handleUpdate(msg(111, "/start"));
  check(f.texts(111)[0].includes("Ayyubi") && f.texts(111)[0].includes("/simab"), "pemilik: /start menampilkan bantuan");
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

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
