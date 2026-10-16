// Tes agenda/jadwal grup. Jalankan: node test-agenda.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractWhen, parseAgendaCommand, detectScheduleMention, openAgendaStore, createAgenda, cleanTitle } from "./agenda.js";
import { formatWhen } from "./reminders.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const TZ = "Asia/Jakarta";
const NOW = Date.parse("2026-10-16T03:00:00Z"); // Jumat 16 Okt 2026 10:00 WIB
const when = (t, extra = {}) => extractWhen(t, { now: NOW, timeZone: TZ, ...extra });
const at = (t) => {
  const w = when(t);
  assert.ok(w.ok, `${t}: ${JSON.stringify(w)}`);
  return `${formatWhen(w.startMs, TZ)}${w.allDay ? " (seharian)" : ""}`;
};

// ---- 1. membaca tanggal & jam dari kalimat bebas
{
  assert.equal(at("rapat evaluasi pada hari Kamis tanggal 22 Oktober 2026 pukul 10.00 WIB di ruang rapat"), "Kamis, 22 Okt 2026 10:00");
  assert.equal(when("rapat evaluasi pada hari Kamis tanggal 22 Oktober 2026 pukul 10.00 WIB di ruang rapat").title, "Rapat evaluasi di ruang rapat");
  assert.equal(at("besok rapat jam 9 ya"), "Sabtu, 17 Okt 2026 09:00");
  assert.equal(when("besok rapat jam 9 ya").title, "Rapat");
  assert.equal(at("lusa rapat jam 9 malam"), "Minggu, 18 Okt 2026 21:00");
  assert.equal(at("jam 2 siang rapat besok"), "Sabtu, 17 Okt 2026 14:00");
  assert.equal(at("besok rapat jam 2"), "Sabtu, 17 Okt 2026 14:00", "jam 1-6 tanpa keterangan = siang/sore");
  assert.equal(at("besok sore rapat koordinasi"), "Sabtu, 17 Okt 2026 16:00");
  assert.equal(at("malam ini pengajian jam 19.30"), "Jumat, 16 Okt 2026 19:30");
  assert.equal(at("nanti sore jam 4 rapat"), "Jumat, 16 Okt 2026 16:00");
  assert.equal(at("rapat tanggal 3 jam 9"), "Selasa, 3 Nov 2026 09:00", "tanggal yang sudah lewat bulan ini = bulan depan");
  assert.equal(at("rapat 25/10 jam 09.00"), "Minggu, 25 Okt 2026 09:00");
  ok("tanggal & jam eksplisit, besok/lusa/malam ini, jam ambigu, judul bersih");
  assert.equal(at("senin depan apel jam 07.30"), "Senin, 19 Okt 2026 07:30");
  assert.equal(at("sabtu depan outing jam 8 pagi"), "Sabtu, 24 Okt 2026 08:00", "sabtu depan = pekan depan, bukan besok");
  assert.equal(at("jumat ini rapat jam 14"), "Jumat, 16 Okt 2026 14:00");
  assert.equal(at("kamis pelatihan"), "Kamis, 22 Okt 2026 00:00 (seharian)");
  assert.equal(at("bayar Rp 1.250.000 besok"), "Sabtu, 17 Okt 2026 00:00 (seharian)", "angka rupiah bukan jam");
  assert.equal(at("zoom bimtek besok jam 13.00 s.d. 15.00"), "Sabtu, 17 Okt 2026 13:00");
  assert.equal(when("zoom bimtek besok jam 13.00 s.d. 15.00").endText, "15:00");
  assert.equal(when("rapat 25/10 jam 09.00-12.00 WIB").endText, "12:00");
  ok("hari depan/ini, tanpa jam = seharian, rentang jam, angka uang tidak dikira jam");
  const rep = when("tiap senin jam 07.30 apel pagi");
  assert.deepEqual(rep.repeat, { kind: "weekly", dow: 1, h: 7, mi: 30 });
  assert.equal(formatWhen(rep.startMs, TZ), "Senin, 19 Okt 2026 07:30");
  assert.equal(rep.title, "Apel pagi");
  assert.equal(when("selamat pagi semua").found, false);
  assert.equal(when("jam 25.00 besok rapat").ok, false);
  assert.equal(when("kemarin rapat").found, false);
  assert.equal(when("hari ini jam 8 rapat").ok, false, "jam hari ini yang sudah lewat ditolak");
  assert.equal(cleanTitle("catat jadwal: rapat dengan bu kepala ya"), "Rapat dengan bu kepala");
  ok("jadwal berulang, tanpa tanggal, jam tidak valid, waktu lewat");
}

// ---- 2. mengenali perintah (dan TIDAK merebut permintaan lain)
{
  const P = (t, c) => parseAgendaCommand(t, c);
  assert.equal(P("catat rapat evaluasi Kamis 22 Oktober jam 10.00").kind, "add");
  assert.equal(P("jadwalkan apel tiap senin jam 07.30").kind, "add");
  assert.equal(P("tolong catat jadwal rapat besok jam 9").kind, "add");
  assert.equal(P("catat ini", { quotedText: "rapat besok jam 9" }).kind, "add_quoted");
  assert.equal(P("catat ini"), null, "tanpa kutipan tidak ada yang dicatat");
  for (const t of ["buatkan jadwal piket", "buatkan tabel besok", "catat pengeluaran", "buatkan gambar kucing besok jam 9", "jadwal sholat hari ini", "jadwal kereta ke Jakarta besok", "jadwal hari raya idul fitri", "apa itu agenda rapat", "cara membuat jadwal"]) assert.equal(P(t), null, t);
  assert.deepEqual(P("ada jadwal apa hari ini?"), { kind: "query", range: "day", offset: 0 });
  assert.deepEqual(P("jadwal besok"), { kind: "query", range: "day", offset: 1 });
  assert.deepEqual(P("agenda minggu ini"), { kind: "query", range: "week" });
  assert.deepEqual(P("agenda minggu depan"), { kind: "query", range: "nextweek" });
  assert.deepEqual(P("jadwal bulan ini"), { kind: "query", range: "month" });
  assert.deepEqual(P("jadwal berikutnya"), { kind: "query", range: "upcoming" });
  assert.equal(P("jadwal kamis").range, "date");
  assert.equal(P("ada rapat apa besok").kind, "query");
  assert.equal(P("jadwal").range, "upcoming");
  assert.deepEqual(P("hapus jadwal 5"), { kind: "delete", id: 5 });
  assert.deepEqual(P("hapus agenda #12"), { kind: "delete", id: 12 });
  assert.deepEqual(P("pindah jadwal 5 ke jumat jam 13.00"), { kind: "move", id: 5, body: "jumat jam 13.00" });
  assert.deepEqual(P("bantuan jadwal"), { kind: "help" });
  assert.equal(P("halo apa kabar"), null);
  ok("perintah dikenali; permintaan lain (jadwal sholat, buatkan jadwal piket, dll.) tetap ke AI");
}

// ---- 3. tawaran dari obrolan: ketat
{
  const D = (t) => detectScheduleMention(t, { now: NOW, timeZone: TZ })?.title ?? null;
  assert.equal(D("besok rapat koordinasi jam 9 ya teman-teman"), "Rapat koordinasi");
  assert.equal(D("bimtek halal tanggal 28 Oktober pukul 08.30 di aula"), "Bimtek halal di aula");
  for (const t of ["Rapat dibatalkan besok jam 9", "kapan rapat besok jam 9?", "besok libur", "makan siang jam 12 besok", "rapat besok", "ok siap", "/rapat besok jam 9", "rapat besok jam 9 ditunda ya"]) assert.equal(D(t), null, t);
  ok("tawaran hanya untuk acara + tanggal + jam yang jelas; pembatalan/pertanyaan/tanpa jam diabaikan");
}

// ---- 4. penyimpanan + alur lengkap
const store = await openAgendaStore({ file: ":memory:", maxPerGroup: 5 });
let clock = NOW;
const sent = [];
let failSend = false;
const agenda = createAgenda({
  store,
  now: () => clock,
  timeZone: TZ,
  tzLabel: "WIB",
  morningTime: "07:30",
  remindBeforeMin: 30,
  sendGroup: async (account, jid, text) => {
    if (failSend) throw new Error("socket putus");
    sent.push({ account, jid, text });
  },
  log: { error() {}, warn() {} }
});
const G = { account: "main", groupJid: "123@g.us", groupName: "Kantor", sender: "Budi" };
const G2 = { account: "main", groupJid: "999@g.us", groupName: "Grup lain", sender: "Ani" };
const say = async (t, g = G, c = {}) => { const cmd = agenda.parse(t, c); assert.ok(cmd, `tidak dikenali: ${t}`); return agenda.handle(cmd, g); };
{
  let r = await say("catat rapat evaluasi besok jam 10.00 di ruang rapat");
  assert.match(r, /Jadwal dicatat \(#1\)/);
  assert.match(r, /Sabtu, 17 Okt 2026 • 10:00 WIB/);
  assert.match(r, /30 menit sebelumnya/);
  assert.match(await say("catat rapat evaluasi besok jam 10.00 di ruang rapat"), /sudah tercatat \(#1\)/);
  assert.match(await say("catat kamis pelatihan halal"), /seharian/);
  assert.match(await say("jadwalkan apel tiap senin jam 07.30"), /tiap Senin 07:30/);
  assert.match(await say("catat jadwal rapat tanpa tanggal"), /belum terbaca/);
  ok("mencatat: konfirmasi jelas, duplikat ditolak, seharian & berulang, tanpa tanggal diberi petunjuk");

  r = await say("ada jadwal apa hari ini?");
  assert.match(r, /Belum ada|Tidak ada jadwal hari ini/);
  r = await say("jadwal besok");
  assert.match(r, /Jadwal besok.*Sabtu, 17 Okt 2026/);
  assert.match(r, /10:00 — Rapat evaluasi di ruang rapat _\(#1\)_/);
  r = await say("agenda minggu ini");
  assert.match(r, /\*Sabtu, 17 Okt 2026\*/);
  assert.ok(!/Pelatihan halal/.test(r), "kamis depan bukan minggu ini");
  r = await say("agenda minggu depan");
  assert.match(r, /Pelatihan halal.*Seharian|Seharian — Pelatihan halal/s);
  assert.match(r, /Apel 🔁/);
  r = await say("jadwal kamis");
  assert.match(r, /Seharian — Pelatihan halal/);
  r = await say("jadwal berikutnya");
  assert.match(r, /Rapat evaluasi/);
  assert.equal(/Jadwal besok/.test(await say("jadwal besok", G2)), false, "jadwal grup lain tidak bocor");
  assert.match(await say("jadwal besok", G2), /Belum ada jadwal/);
  ok("bertanya: hari ini/besok/minggu ini/minggu depan/hari tertentu/berikutnya; antar grup terpisah");

  assert.match(await say("hapus jadwal 1", G2), /tidak ditemukan/, "grup lain tidak bisa menghapus");
  r = await say("pindah jadwal 1 ke jumat jam 13.00");
  assert.match(r, /dipindah/);
  assert.match(r, /Jumat, 16 Okt 2026 • 13:00 WIB/);
  assert.match(await say("hapus jadwal 1"), /dihapus: Rapat evaluasi/);
  assert.match(await say("hapus jadwal 1"), /tidak ditemukan/);
  assert.match(await say("bantuan jadwal"), /Jadwal kantor di grup/);
  ok("hapus/pindah hanya di grup sendiri; bantuan");
}

// ---- 5. penjadwal: rekap pagi & pengingat sebelum acara
{
  // keadaan: #2 kamis (seharian), #3 apel tiap senin. Tambah rapat hari ini jam 14.00.
  clock = NOW;
  assert.match(await say("catat rapat anggaran hari ini jam 14.00"), /dicatat/);
  sent.length = 0;
  clock = Date.parse("2026-10-15T23:00:00Z"); // 06:00 WIB (Jumat) -> belum jam rekap
  await agenda.check();
  assert.equal(sent.length, 0, "sebelum jam rekap diam");
  clock = Date.parse("2026-10-16T00:35:00Z"); // 07:35 WIB
  await agenda.check();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Selamat pagi.*Jumat, 16 Okt 2026/s);
  assert.match(sent[0].text, /14:00 — Rapat anggaran/);
  assert.equal(sent[0].jid, G.groupJid);
  await agenda.check();
  assert.equal(sent.length, 1, "rekap pagi hanya sekali per hari");
  sent.length = 0;
  clock = Date.parse("2026-10-16T06:10:00Z"); // 13:10 WIB: 50 menit sebelum 14.00 -> belum
  await agenda.check();
  assert.equal(sent.length, 0);
  clock = Date.parse("2026-10-16T06:35:00Z"); // 13:35 WIB -> 25 menit lagi
  await agenda.check();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /25 menit lagi.*Rapat anggaran.*14:00 WIB/s);
  await agenda.check();
  assert.equal(sent.length, 1, "pengingat acara hanya sekali");
  ok("rekap pagi sekali per hari, pengingat 30 menit sebelum acara sekali");

  sent.length = 0;
  clock = Date.parse("2026-10-16T22:00:00Z"); // 05:00 WIB Sabtu: tak ada acara jam-nya? #hari Sabtu kosong kecuali tidak ada
  await agenda.check();
  assert.equal(sent.length, 0);
  clock = Date.parse("2026-10-17T01:00:00Z"); // 08:00 WIB Sabtu: tidak ada jadwal -> diam
  await agenda.check();
  assert.equal(sent.length, 0, "tanpa jadwal hari itu bot diam");
  clock = Date.parse("2026-10-18T17:30:00Z"); // 00:30 WIB Senin 19 -> sebelum jam rekap
  await agenda.check();
  clock = Date.parse("2026-10-19T00:40:00Z"); // 07:40 WIB Senin -> apel jam 07.30 sudah lewat, tetap masuk rekap pagi
  await agenda.check();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /07:30 — Apel 🔁/);
  ok("hari tanpa jadwal tidak mengirim apa-apa; jadwal berulang masuk rekap");

  // kirim gagal: dicoba lagi menit berikutnya, tidak hilang
  sent.length = 0;
  clock = Date.parse("2026-10-20T00:35:00Z"); // Selasa 07:35 -> tidak ada acara; tambahkan acara Selasa
  assert.match(await say("catat rapat selasa jam 10.00"), /dicatat/);
  failSend = true;
  await agenda.check();
  assert.equal(sent.length, 0);
  failSend = false;
  clock += 60_000;
  await agenda.check();
  assert.equal(sent.length, 1, "setelah gagal, rekap terkirim di pengecekan berikutnya");
  ok("kirim gagal tidak menghilangkan rekap");

  // acara lampau dibersihkan
  clock = Date.parse("2026-11-30T03:00:00Z");
  await agenda.check();
  assert.equal(store.listGroup(G.groupJid).filter((r) => !r.repeat).length, 0);
  assert.equal(store.listGroup(G.groupJid).filter((r) => r.repeat).length, 1, "yang berulang tetap ada");
  ok("jadwal sekali yang sudah lewat dibersihkan, yang berulang dipertahankan");
}

// ---- 6. batas jumlah
{
  clock = NOW;
  for (let i = 0; i < 6; i++) await say(`catat rapat ke${i} lusa jam ${8 + i}.00`, G2);
  assert.match(await say("catat rapat terakhir lusa jam 15.00", G2), /sudah penuh/);
  ok("batas jadwal per grup");
}

// ---- 7. tawaran dari obrolan: alur ya / tidak
{
  clock = NOW;
  const key = "123@g.us|MSG1";
  const offer = agenda.buildOffer("besok sore jam 4 ada rapat koordinasi ya", G);
  assert.ok(offer);
  assert.match(offer.text, /Mau saya catat sebagai jadwal/);
  assert.match(offer.text, /Rapat koordinasi/);
  assert.match(offer.text, /Sabtu, 17 Okt 2026 • 16:00 WIB/);
  assert.equal(agenda.buildOffer("besok sore jam 4 ada rapat koordinasi ya", G), null, "tawaran tidak diulang terus (jeda)");
  agenda.rememberOffer(key, offer.ev, G);
  assert.equal(agenda.parse("ya", { offerKey: key }).kind, "offer_yes");
  assert.equal(agenda.parse("tidak usah", { offerKey: key }).kind, "offer_no");
  assert.equal(agenda.parse("ya", { offerKey: "x|y" }), null, "'ya' tanpa tawaran = bukan perintah agenda");
  const r = await agenda.handle(agenda.parse("iya", { offerKey: key }), { ...G, sender: "Citra" });
  assert.match(r, /dicatat/);
  assert.match(r, /disetujui Citra/);
  assert.equal(await agenda.handle({ kind: "offer_yes", key }, G), null, "tawaran hanya bisa dipakai sekali");
  clock += 100_000;
  assert.equal(agenda.buildOffer("besok sore jam 4 ada rapat koordinasi ya", G), null, "yang sudah tercatat tidak ditawarkan lagi");
  const o2 = agenda.buildOffer("lusa pelatihan SPJ jam 9", G);
  agenda.rememberOffer("123@g.us|M2", o2.ev, G);
  assert.match(await agenda.handle(agenda.parse("tidak", { offerKey: "123@g.us|M2" }), G), /tidak saya catat/);
  assert.equal(store.listGroup(G.groupJid).filter((r) => /SPJ/.test(r.title)).length, 0);
  // tawaran kedaluwarsa
  clock += 100_000;
  const o3 = agenda.buildOffer("lusa seminar halal jam 13.00", G);
  agenda.rememberOffer("123@g.us|M3", o3.ev, G);
  clock += 7 * 3600_000;
  assert.match(await agenda.handle({ kind: "offer_yes", key: "123@g.us|M3" }, G), /kedaluwarsa|sudah lewat/);
  const off = createAgenda({ store, now: () => clock, timeZone: TZ, suggest: false, sendGroup: async () => {} });
  assert.equal(off.buildOffer("besok rapat jam 9 pagi ya", G), null, "AGENDA_SUGGEST=false mematikan tawaran");
  ok("tawaran: ya mencatat sekali, tidak membatalkan, kedaluwarsa, tidak berulang, bisa dimatikan");
}

// ---- 8. sambungan di index.js
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const grp = src.slice(src.indexOf("async function handleGroupMessage"), src.indexOf("async function deliverAutoReplyVoice"));
  const at2 = (s) => { const i = grp.indexOf(s); assert.ok(i >= 0, `handleGroupMessage tidak memuat: ${s}`); return i; };
  assert.ok(at2("agenda.mightOffer(text)") < at2("  if (!triggered) {") + 400 && at2("  if (!triggered) {") < at2("// --- Grup ini diizinkan?"), "tawaran dari obrolan hanya untuk pesan yang tidak memanggil bot, sebelum urusan lain");
  assert.match(src, /async function offerAgendaFromChat[\s\S]*?isGroupAllowed[\s\S]*?isAutoReplyEnabledForContact[\s\S]*?buildOffer/, "tawaran: grup diizinkan & izin kontak dicek sebelum menawarkan");
  assert.ok(at2("agenda.parse(") > at2("isAutoReplyEnabledForContact(groupJid)"), "perintah agenda setelah cek izin kontak");
  assert.ok(at2("agenda.parse(") < at2("generateAutoReply(groupJid)"), "agenda dijawab sebelum AI percakapan");
  assert.ok(at2("agenda.parse(") < at2("if (editReq && !docEdit)"), "agenda sebelum edit foto");
  assert.match(src, /setInterval\(\(\) => \{\s*agenda\.check\(\)/, "pemeriksaan tiap menit");
  assert.match(src, /AGENDA_MORNING_TIME/);
  assert.match(src, /kind: "sqlite", path: AGENDA_FILE/, "agenda ikut dicadangkan");
  assert.match(src, /async function sendAgendaGroupText/);
  assert.match(src, /waAccountContext\.run\(\{ account \}/, "pengiriman terjadwal memakai akun yang benar");
  ok("index.js: urutan penanganan, penjadwal tiap menit, akun yang benar, ikut cadangan");
}

// ---- 9. berkas jadwal tidak boleh ikut ter-commit (/rilis menolak file sensitif)
{
  const gi = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8").split(/\r?\n/).map((l) => l.trim());
  assert.ok(gi.includes("wa-bot/agenda.sqlite*"), ".gitignore harus memuat wa-bot/agenda.sqlite*");
  assert.ok(gi.includes("wa-bot/pengingat.sqlite*"));
  ok(".gitignore memuat berkas jadwal (agenda.sqlite)");
}

store.close();
console.log(`\nSemua ${n} kelompok tes agenda grup lulus ✅`);
