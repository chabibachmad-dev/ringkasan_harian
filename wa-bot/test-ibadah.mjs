// Tes pengingat ibadah (juz harian, hadits, ayat). Jalankan: node test-ibadah.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { createIbadah, openIbadahStore, juzFor, parseTimesFromText, parseClock, matchIngatkanQuran, splitMessage, loadData, pickAyat, pickHadits, formatAyat, formatHadits, formatQuranReminder, dayNumber, todayIso } from "./ibadah.js";
import { createReminders, parseReminderCommand } from "./reminders.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const TZ = "Asia/Jakarta";
const at = (iso, hhmm) => Date.parse(`${iso}T${hhmm}:00+07:00`);
const quiet = { warn() {}, error() {}, log() {} };

// ---- 1. juz: naik 1 per hari, 30 -> 1
{
  assert.equal(juzFor(2, "2026-10-17", "2026-10-17"), 2);
  assert.equal(juzFor(2, "2026-10-17", "2026-10-18"), 3);
  assert.equal(juzFor(2, "2026-10-17", "2026-11-14"), 30); // 28 hari kemudian
  assert.equal(juzFor(2, "2026-10-17", "2026-11-15"), 1); // setelah 30 kembali ke 1
  assert.equal(juzFor(2, "2026-10-17", "2026-11-16"), 2); // putaran baru dimulai lagi
  assert.equal(juzFor(30, "2026-10-17", "2026-10-18"), 1);
  assert.equal(juzFor(1, "2026-10-17", "2027-10-17"), ((365 % 30) + 1)); // lintas tahun
  assert.equal(juzFor(5, "2026-10-17", "2026-10-16"), 4); // mundur satu hari tetap masuk akal
  ok("juz naik 1 per hari dan kembali ke 1 setelah juz 30");
}

// ---- 2. jam dari kalimat
{
  assert.deepEqual(parseTimesFromText("setiap hari jam 7 pagi 12 siang dan jam 6 sore untuk membaca al quran"), ["07:00", "12:00", "18:00"]);
  assert.deepEqual(parseTimesFromText("jam 05.30 dan pukul 21:15"), ["05:30", "21:15"]);
  assert.deepEqual(parseTimesFromText("jam 8 malam"), ["20:00"]);
  assert.deepEqual(parseTimesFromText("hari ini juz 2, besok juz 3"), []);
  assert.equal(parseClock("7.30"), "07:30");
  assert.equal(parseClock("25:00"), null);
  assert.equal(parseClock("abc"), null);
  ok("jam dari kalimat bahasa Indonesia (pagi/siang/sore/malam)");
}

// ---- 3. kalimat /ingatkan dari pengguna dikenali; pengingat biasa tidak dibajak
{
  const msg = "setiap hari jam 7 pagi 12 siang dan jam 6 sore untuk membaca al quran. Hari ini juz 2, bsk dan seterusnya akan bertambah juz 3 dan ngeloop terus setiap hari";
  assert.deepEqual(matchIngatkanQuran(msg), { juz: 2, times: ["07:00", "12:00", "18:00"] });
  assert.equal(matchIngatkanQuran("tiap hari 21:00 kunci pintu"), null);
  assert.equal(matchIngatkanQuran("tiap hari 05:00 baca quran"), null); // tanpa "juz": pengingat biasa
  assert.equal(matchIngatkanQuran("besok jam 9 tadarus quran juz 3"), null); // bukan tiap hari
  assert.ok(matchIngatkanQuran("setiap hari baca al quran juz 31").error);
  ok("kalimat pengingat Al-Qur'an dikenali, pengingat biasa dibiarkan");
}

// ---- 4. data: hadits & ayat lengkap
{
  const d = loadData();
  assert.equal(d.hadits.length, 42);
  assert.ok(d.ayat.length > 6000);
  for (const h of d.hadits) assert.ok(h.ar.length > 20 && h.id.length > 20 && /[؀-ۿ]/.test(h.ar), `hadits ${h.no}`);
  for (const a of d.ayat) {
    assert.ok(/[؀-ۿ]/.test(a[2]) && a[3].length > 3, `ayat ${a[0]}:${a[1]}`);
    assert.ok(d.surah.has(a[0]));
  }
  const fatihah = d.ayat.find((a) => a[0] === 1 && a[1] === 2);
  assert.ok(fatihah[2].includes("الْحَمْدُ") || fatihah[2].includes("ٱلْحَمْدُ") || /ال[ْ]?حَمْدُ/.test(fatihah[2]) || fatihah[2].length > 10);
  // urutan acak tetap: semua ayat muncul tepat sekali dalam satu putaran, sama di setiap pemanggilan
  const start = "2026-10-17";
  const seen = new Set();
  const total = d.ayat.length;
  for (let i = 0; i < total; i++) {
    const a = pickAyat(d, start, new Date(dayNumber(start) * 86400000 + i * 86400000).toISOString().slice(0, 10));
    seen.add(`${a[0]}:${a[1]}`);
  }
  assert.equal(seen.size, total);
  assert.deepEqual(pickAyat(d, start, "2026-10-20"), pickAyat(d, start, "2026-10-20"));
  assert.equal(pickHadits(d, start, "2026-10-17").no, 1);
  assert.equal(pickHadits(d, start, "2026-10-18").no, 2);
  assert.equal(pickHadits(d, start, "2026-11-28").no, 1); // hari ke-42 (setelah 42 hadits): putar ke no. 1
  ok("data hadits (42) dan ayat (>6000) utuh; urutan ayat tetap & tanpa pengulangan");
}

// ---- 5. format pesan
{
  const d = loadData();
  assert.equal(formatQuranReminder(2), "📖 *Pengingat Al-Qur'an*\nBaca Al-Qur'an hari ini: juz 2");
  const a = formatAyat(d, d.ayat.find((x) => x[0] === 2 && x[1] === 255) || d.ayat[0]);
  assert.ok(/QS\. /.test(a) && /Artinya/.test(a) && /Tafsir Kemenag/.test(a) && /[؀-ۿ]/.test(a));
  const h = formatHadits(d.hadits[0], "Penjelasan contoh.");
  assert.ok(/Arbain Nawawi no\. 1/.test(h) && /Artinya/.test(h) && /Takhrij/.test(h) && h.includes("Penjelasan contoh.") && /disusun AI/.test(h));
  assert.ok(/belum tersedia/.test(formatHadits(d.hadits[0], null)));
  for (const x of d.hadits) for (const p of splitMessage(formatHadits(x, "x ".repeat(300)))) assert.ok(p.length <= 3600);
  for (const x of d.ayat.slice(0, 400)) for (const p of splitMessage(formatAyat(d, x))) assert.ok(p.length <= 3600);
  const long = `${"Kalimat panjang sekali. ".repeat(400)}\n\nParagraf dua.`;
  const parts = splitMessage(long, 1000);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 1000));
  ok("format ayat/hadits memuat Arab, arti, tafsir/takhrij, dan label AI; pesan panjang dipecah");
}

// ---- 6. perintah /ibadah
{
  const store = await openIbadahStore({ file: ":memory:", log: quiet });
  let t = at("2026-10-17", "06:10");
  const ib = createIbadah({ store, send: async () => {}, now: () => t, timeZone: TZ, log: quiet });
  assert.ok(/mati/.test(ib.handle("")) && /belum dinyalakan/.test(ib.describe()));
  const r = ib.handle("mulai juz 2");
  assert.ok(/juz 2/.test(r) && /juz 3/.test(r) && /07:00, 12:00, 18:00/.test(r) && /05:30/.test(r) && /06:00/.test(r));
  assert.ok(/AKTIF/.test(ib.describe()));
  assert.ok(/juz 5/.test(ib.handle("juz 5")));
  assert.ok(/juz 31|1 sampai 30/.test(ib.handle("juz 31")));
  assert.ok(/07:30, 13:00/.test(ib.handle("jam quran 7.30 13:00")));
  assert.ok(/tidak valid/.test(ib.handle("jam quran 99:00")));
  assert.ok(/hanya satu kali/.test(ib.handle("jam hadits 05:00 06:00")));
  assert.ok(/05:00/.test(ib.handle("jam hadits 5")));
  assert.ok(/dimatikan/.test(ib.handle("hadits mati")));
  assert.ok(/diaktifkan/.test(ib.handle("hadits aktif")));
  assert.ok(/dimatikan/.test(ib.handle("mati")));
  assert.ok(/tidak dikenali/.test(ib.handle("ngawur")));
  assert.ok(/mengirim contoh/i.test(ib.handle("tes")));
  ok("perintah /ibadah: mulai, juz, jam, aktif/mati, validasi");
}

// ---- 7. penjadwalan: jam, juz harian, tanpa kirim ganda, terlambat, gagal kirim
{
  const store = await openIbadahStore({ file: ":memory:", log: quiet });
  const sent = [];
  let t = at("2026-10-17", "06:00");
  const ib = createIbadah({ store, send: async (x) => void sent.push(x), explain: async () => "Penjelasan AI contoh.", now: () => t, timeZone: TZ, log: quiet });
  ib.handle("mulai juz 2"); // 17 Okt, 06:00: slot 05:30 hadits sudah lewat 30 menit -> terlambat tapi masih dikirim
  assert.equal(await ib.check(), 2); // hadits 05:30 (terlambat) + ayat 06:00
  assert.ok(sent.some((x) => /Hadits Hari Ini/.test(x)) && sent.some((x) => /Ayat Hari Ini/.test(x)));
  assert.ok(sent.some((x) => /terlambat 30 menit/.test(x)));
  assert.ok(sent.some((x) => x.includes("Penjelasan AI contoh.")));
  assert.equal(await ib.check(), 0); // tidak dikirim dua kali
  sent.length = 0;
  t = at("2026-10-17", "07:00");
  assert.equal(await ib.check(), 1);
  assert.equal(sent[0], "📖 *Pengingat Al-Qur'an*\nBaca Al-Qur'an hari ini: juz 2");
  t = at("2026-10-17", "12:01");
  await ib.check();
  t = at("2026-10-17", "18:00");
  await ib.check();
  assert.equal(sent.filter((x) => /juz 2$/.test(x)).length, 3);
  // besok: juz 3
  sent.length = 0;
  t = at("2026-10-18", "07:00");
  await ib.check();
  assert.ok(sent.some((x) => /juz 3$/.test(x)));
  assert.ok(sent.some((x) => /Arbain Nawawi no\. 2/.test(x)), "hadits berikutnya = nomor 2");
  ok("jadwal: 3x juz sama per hari, besok juz 3, hadits berurutan, tanpa kirim ganda");

  // bot baru menyala siang hari: pengingat pagi yang sudah lewat jauh dilewati
  const store2 = await openIbadahStore({ file: ":memory:", log: quiet });
  const sent2 = [];
  let t2 = at("2026-10-17", "05:00");
  const ib2 = createIbadah({ store: store2, send: async (x) => void sent2.push(x), now: () => t2, timeZone: TZ, log: quiet });
  ib2.handle("mulai juz 1");
  t2 = at("2026-10-17", "15:30"); // bot baru menyala: 07:00 (8,5 jam) dan 12:00 (3,5 jam) -> 12:00 masih dalam batas 4 jam
  await ib2.check();
  const quran = sent2.filter((x) => /Pengingat Al-Qur'an/.test(x));
  assert.equal(quran.length, 1);
  assert.ok(/terlambat/.test(quran[0]));
  assert.ok(!sent2.some((x) => /Hadits Hari Ini|Ayat Hari Ini/.test(x)), "hadits/ayat pagi yang lewat > 6 jam dilewati");
  ok("bot mati lalu menyala: yang terlewat dekat dikirim 'terlambat', yang sudah lewat jauh dilewati");

  // kirim gagal: dicoba lagi, tidak hilang, tidak ganda
  const store3 = await openIbadahStore({ file: ":memory:", log: quiet });
  let fail = true;
  const sent3 = [];
  let t3 = at("2026-10-17", "06:50");
  const ib3 = createIbadah({ store: store3, send: async (x) => { if (fail) throw new Error("WA putus"); sent3.push(x); }, now: () => t3, timeZone: TZ, retryMs: 1000, log: quiet });
  ib3.handle("quran aktif");
  ib3.handle("juz 7");
  t3 = at("2026-10-17", "07:00");
  assert.equal(await ib3.check(), 0);
  fail = false;
  t3 += 500;
  assert.equal(await ib3.check(), 0); // masih menunggu jeda coba ulang
  t3 += 2000;
  assert.equal(await ib3.check(), 1);
  assert.equal(await ib3.check(), 0);
  assert.equal(sent3.length, 1);
  ok("kirim gagal: dicoba lagi setelah jeda, tidak hilang dan tidak ganda");

  // penjelasan AI gagal: tetap kirim hadits tanpa penjelasan (tanpa mengarang), lalu coba lagi esok hari
  const store4 = await openIbadahStore({ file: ":memory:", log: quiet });
  const sent4 = [];
  let t4 = at("2026-10-17", "05:00");
  const ib4 = createIbadah({ store: store4, send: async (x) => void sent4.push(x), explain: async () => { throw new Error("kuota"); }, now: () => t4, timeZone: TZ, log: quiet });
  ib4.handle("hadits aktif");
  t4 = at("2026-10-17", "05:30");
  await ib4.check();
  assert.equal(sent4.length >= 1, true);
  assert.ok(/belum tersedia/.test(sent4.join("\n")) && /[؀-ۿ]/.test(sent4.join("\n")));
  ok("AI gagal: hadits tetap terkirim (Arab + arti), penjelasan dinyatakan belum tersedia");

  // penjelasan di-cache: AI dipanggil sekali per hadits
  const store5 = await openIbadahStore({ file: ":memory:", log: quiet });
  let calls = 0;
  let t5 = at("2026-10-17", "05:30");
  const ib5 = createIbadah({ store: store5, send: async () => {}, explain: async () => (calls++, "Penjelasan."), now: () => t5, timeZone: TZ, log: quiet });
  ib5.handle("hadits aktif");
  await ib5.check();
  await ib5.sendSamples();
  await ib5.sendSamples();
  assert.equal(calls, 1);
  ok("penjelasan hadits disimpan: AI hanya dipanggil sekali per hadits");
}

// ---- 8. tersambung ke /ingatkan dan /ibadah
{
  const store = await openIbadahStore({ file: ":memory:", log: quiet });
  const t = at("2026-10-17", "08:00");
  const ib = createIbadah({ store, send: async () => {}, now: () => t, timeZone: TZ, log: quiet });
  const rem = createReminders({ store: null, send: async () => {}, now: () => t, timeZone: TZ, ibadah: ib });
  assert.deepEqual(parseReminderCommand("/ibadah mulai juz 2"), { name: "ibadah", arg: "mulai juz 2" });
  assert.deepEqual(parseReminderCommand("/ingatkan besok 09:00 kirim SPJ"), { name: "ingatkan", arg: "besok 09:00 kirim SPJ" });
  const r = rem.handle({ name: "ingatkan", arg: "setiap hari jam 7 pagi 12 siang dan jam 6 sore untuk membaca al quran. Hari ini juz 2, bsk juz 3 dan ngeloop terus setiap hari" });
  assert.ok(/07:00, 12:00, 18:00/.test(r) && /juz 2/.test(r) && /juz 3/.test(r) && /kembali ke juz 1/.test(r));
  assert.ok(/AKTIF/.test(rem.handle({ name: "ibadah", arg: "" })) || /AKTIF/.test(ib.status()));
  assert.ok(/Fitur pengingat belum aktif|belum aktif/.test(rem.handle({ name: "ingatkan", arg: "besok 09:00 kirim SPJ" })), "pengingat biasa tidak dibajak");
  const none = createReminders({ store: null, send: async () => {}, now: () => t, timeZone: TZ });
  assert.ok(/belum aktif/.test(none.handle({ name: "ibadah", arg: "" })));
  ok("/ingatkan dengan kalimat Al-Qur'an + /ibadah tersambung lewat pintu pengingat yang sama");
}

// ---- 9. penyambungan di index.js, telegram.js, .gitignore
{
  const idx = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.ok(/import \{ buildExplainPrompt, createIbadah, openIbadahStore \} from "\.\/ibadah\.js"/.test(idx));
  assert.ok(/createReminders\(\{[^}]*ibadah \}\)/.test(idx));
  assert.ok(/setInterval\(\(\) => \{\s*ibadah\.check\(\)/.test(idx));
  assert.ok(idx.includes('{ name: "pengingat ibadah", kind: "sqlite", path: IBADAH_FILE }'));
  const tg = fs.readFileSync(new URL("./telegram.js", import.meta.url), "utf8");
  assert.ok(tg.includes('name === "ibadah"'));
  const gi = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.ok(gi.includes("wa-bot/ibadah.sqlite*"), ".gitignore harus memuat wa-bot/ibadah.sqlite*");
  ok("index.js, telegram.js, cadangan, dan .gitignore tersambung");
}

console.log(`\n${n} kelompok tes lulus.`);
