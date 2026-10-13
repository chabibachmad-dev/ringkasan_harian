// Tes pesan suara (voice-input.js): angka dalam kata, penyesuaian ucapan -> perintah, transkripsi dengan rotasi mesin/kunci.
//   node test-voice.mjs
import { createTranscriber, describeError, readSttConfig, voiceToCommand, wordsToDigits } from "./voice-input.js";
import { parseInput, parseJumlah, parseTanggal } from "./simab-rekam.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const quiet = { log() {}, warn() {}, error() {} };

const mkNetCause = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });

// ---- angka dalam kata
{
  const cases = {
    tiga: "3", "lima belas": "15", sebelas: "11", "dua puluh": "20", "dua puluh lima": "25", seratus: "100", "seratus dua puluh": "120", "dua ratus lima puluh": "250",
    seribu: "1000", "dua ribu dua puluh enam": "2026", "sepuluh ribu": "10000", "dua ratus lima puluh ribu": "250000", "satu juta lima ratus ribu": "1500000", sejuta: "1000000",
    "dua juta": "2000000", "tiga miliar": "3000000000", "lima ratus ribu rupiah": "500000 rupiah", "nol": "0"
  };
  for (const [k, v] of Object.entries(cases)) check(wordsToDigits(k) === v, `kata->angka: "${k}" -> ${v} (dapat ${wordsToDigits(k)})`);
  check(wordsToDigits("tanggal lima oktober dua ribu dua puluh enam") === "tanggal 5 oktober 2026", "kata->angka: tanggal lengkap");
  check(wordsToDigits("Pembelian dua unit laptop") === "Pembelian 2 unit laptop", "kata->angka: di tengah kalimat");
  check(wordsToDigits("2 juta dan 1,5 ribu") === "2 juta dan 1,5 ribu", "kata->angka: 'juta/ribu' setelah digit dibiarkan");
  check(wordsToDigits("sebelas, tiga") === "11, 3", "kata->angka: koma memutus deretan");
  check(wordsToDigits("puluh") === "puluh" && wordsToDigits("belas kasihan") === "belas kasihan", "kata->angka: kata bilangan tanpa satuan dibiarkan");
}

// ---- ucapan -> perintah
{
  const free = (t) => voiceToCommand(t, { inSession: false });
  const ses = (t) => voiceToCommand(t, { inSession: true });
  check(free("Apa kabar hari ini?").text === "Apa kabar hari ini?" && free("Apa kabar hari ini?").changed === false, "perintah: obrolan biasa tidak diubah");
  check(free("Si mab rekam Umum.").text === "simab rekam Umum", "perintah: 'Si mab' di awal -> simab");
  check(free("Simap pagu umum").text === "simab pagu umum" && free("Semab cek lima").text === "simab cek 5", "perintah: salah dengar 'simap/semab' dan angka kata di perintah simab");
  check(free("simak dulu penjelasan ini").text === "simak dulu penjelasan ini", "perintah: kata 'simak' bukan simab");
  check(ses("Nomor tiga.").text === "3" && ses("pilih lima belas").text === "15" && ses("Empat").text === "4", "sesi: nomor pilihan -> digit");
  check(ses("Ya.").text === "ya" && ses("Lanjut!").text === "lanjut" && ses("Batal").text === "batal" && ses("ya hapus").text === "ya hapus", "sesi: perintah pendek dirapikan");
  check(ses("Satu juta lima ratus ribu rupiah.").text === "1500000" && ses("Rp 1.500.000.").text === "Rp 1.500.000", "sesi: jumlah sendirian");
  const full = ses("Pembelian ATK bulan Oktober, tanggal lima Oktober dua ribu dua puluh enam, jumlah satu juta lima ratus ribu rupiah.");
  check(full.text === "Pembelian ATK bulan Oktober\n5 Oktober 2026\n1500000" && full.changed, "sesi: uraian+tanggal+jumlah -> tiga baris");
  const p = parseInput(full.text, { today: "2026-10-05" });
  check(p.ok && p.tgl === "2026-10-05" && p.jumlah === 1500000 && p.uraian === "Pembelian ATK bulan Oktober", "sesi: tiga baris lolos pengurai alur rekam (parseInput)");
  const alt = ses("Jumlah 2 juta, uraian perjalanan dinas ke Surabaya tanggal 7 Oktober 2026");
  check(alt.text === "perjalanan dinas ke Surabaya\n7 Oktober 2026\n2 juta" && parseInput(alt.text, { today: "2026-10-05" }).ok, "sesi: urutan bebas dengan kata kunci 'uraian'");
  const digits = ses("Beli kertas A4, tanggal 12/10/2026, nominal Rp 750.000");
  check(digits.text === "Beli kertas A4\n12/10/2026\n750.000" && parseInput(digits.text, {}).jumlah === 750000, "sesi: angka sudah digit dibiarkan");
  check(ses("Ini cuma obrolan biasa tanpa kata kunci").text === "Ini cuma obrolan biasa tanpa kata kunci", "sesi: tanpa kata kunci lengkap, teks tidak dipecah");
  check(parseJumlah("1500000") === 1500000 && parseTanggal("5 oktober 2026", {}) === "2026-10-05", "pengurai rekam menerima keluaran penyesuai");
  // ucapan "enter" = baris baru (kasus nyata dari Telegram)
  const real = ses("Belanja barang untuk keperluan perkantoran beruah pemilihan materai. Enter. Tanggal 1 bulan Oktober 2026. Enter Rp 1 juta.");
  check(real.text === "Belanja barang untuk keperluan perkantoran beruah pemilihan materai\n1 Oktober 2026\n1 juta", "sesi: 'enter' memisah baris; 'bulan' & 'Rp' dibuang");
  const rp = parseInput(real.text, { today: "2026-10-05" });
  check(rp.ok && rp.tgl === "2026-10-01" && rp.jumlah === 1000000, "sesi: hasil 'enter' lolos parseInput");
  const e2 = ses("Pembelian ATK. Enter. Tanggal lima Oktober dua ribu dua puluh enam. Enter. Satu juta lima ratus ribu rupiah.");
  check(e2.text === "Pembelian ATK\n5 Oktober 2026\n1500000", "sesi: 'enter' + angka dalam kata");
  const e3 = ses("uraian beli kertas baris baru tanggal 3 oktober baris baru jumlah 500 ribu");
  check(e3.text === "beli kertas\n3 oktober\n500 ribu" && parseInput(e3.text, { today: "2026-10-05" }).ok, "sesi: 'baris baru' + penanda");
  const nj = ses("Beli kertas HVS tanggal 12 Oktober 2026 2 juta");
  check(nj.text === "Beli kertas HVS\n12 Oktober 2026\n2 juta", "sesi: tanpa kata 'jumlah', uang di ujung dikenali");
  check(ses("Pembelian ATK tanggal hari ini Rp 750.000").text === "Pembelian ATK\nhari ini\n750.000", "sesi: 'hari ini' + Rp tanpa kata 'jumlah'");
  check(!ses("Beli tinta, tanggal 5 Oktober 2026").text.includes("\n"), "sesi: tanpa jumlah sama sekali -> dibiarkan (bot yang meminta)");
}

// ---- transkripsi
const cfg = (o = {}) => ({ groqKeys: ["gk1", "gk2"], groqModel: "whisper-large-v3-turbo", geminiKeys: ["gm1"], geminiModel: "gem", language: "id", timeoutMs: 2000, maxSeconds: 180, ...o });
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
{
  const c = readSttConfig({ GROQ_API_KEYS: "a, b", GEMINI_API_KEY: "g", VOICE_LANGUAGE: "EN" });
  check(c.groqKeys.join() === "a,b" && c.geminiKeys.join() === "g" && c.language === "en" && c.groqModel === "whisper-large-v3-turbo", "stt config: kunci dipisah koma, bahasa huruf kecil, model bawaan");
  check(createTranscriber({ config: readSttConfig({}), log: quiet }).available() === false, "stt: tanpa kunci = tidak tersedia");
}
{
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init });
    return resp(200, { text: " Halo dunia " });
  };
  const t = createTranscriber({ config: cfg(), fetchImpl: f, log: quiet });
  const r = await t.transcribe(Buffer.from("OggS...."), { mime: "audio/ogg" });
  const fd = calls[0].init.body;
  check(r.text === "Halo dunia" && r.engine === "groq" && calls[0].url.includes("api.groq.com/openai/v1/audio/transcriptions") && calls[0].init.headers.Authorization === "Bearer gk1", "stt: Groq Whisper dipakai lebih dulu (kunci pertama)");
  check(fd.get("model") === "whisper-large-v3-turbo" && fd.get("language") === "id" && /SiMAB/.test(fd.get("prompt")) && fd.get("file").name === "voice.ogg", "stt: model, bahasa, petunjuk kosakata, nama berkas .ogg dikirim");
}
{
  const seen = [];
  const f = async (url, init) => {
    const key = init.headers.Authorization || init.headers["x-goog-api-key"];
    seen.push(`${String(url).includes("groq") ? "groq" : "gemini"}:${key}`);
    if (String(url).includes("groq")) return resp(429, { error: { message: "rate limit" } });
    return resp(200, { candidates: [{ content: { parts: [{ text: "Pembelian ATK" }] } }] });
  };
  let clock = 1000;
  const t = createTranscriber({ config: cfg(), fetchImpl: f, log: quiet, now: () => clock });
  const r = await t.transcribe(Buffer.from("x"), { mime: "audio/ogg; codecs=opus" });
  check(r.text === "Pembelian ATK" && r.engine === "gemini" && seen.join() === "groq:Bearer gk1,groq:Bearer gk2,gemini:gm1", "stt: kedua kunci Groq kena 429 -> cadangan Gemini");
  seen.length = 0;
  await t.transcribe(Buffer.from("x"), {});
  check(seen.join() === "gemini:gm1", "stt: kunci yang baru kena 429 diistirahatkan (langsung Gemini)");
  clock += 61_000;
  seen.length = 0;
  await t.transcribe(Buffer.from("x"), {});
  check(seen[0] === "groq:Bearer gk1", "stt: setelah istirahat, Groq dicoba lagi");
}
{
  const f = async () => resp(200, { candidates: [{ content: { parts: [{ text: "<silence>" }] } }] });
  const t = createTranscriber({ config: cfg({ groqKeys: [] }), fetchImpl: f, log: quiet });
  check((await t.transcribe(Buffer.from("x"))).text === "", "stt: <silence> dari Gemini = teks kosong");
  const bad = createTranscriber({ config: cfg(), fetchImpl: async () => resp(500, "boom"), log: quiet });
  let msg = "";
  try { await bad.transcribe(Buffer.from("x")); } catch (e) { msg = e.message; }
  check(/Gagal mengubah suara jadi teks/.test(msg), "stt: semua mesin gagal -> galat yang jelas");
  // bahasa & petunjuk bisa diganti per panggilan (mode Speaking Inggris) tanpa mengganggu fungsi log
  const seen = [];
  const capture = async (url, init) => { seen.push(init.body); return resp(200, { text: " hello " }); };
  const tEn = createTranscriber({ config: cfg(), fetchImpl: capture, log: quiet });
  const en = await tEn.transcribe(Buffer.from("x"), { language: "en", hint: "English practice" });
  check(en.text === "hello" && seen[0].get("language") === "en" && seen[0].get("prompt") === "English practice", "stt: bahasa & petunjuk per panggilan (Speaking Inggris)");
  const tDef = createTranscriber({ config: cfg(), fetchImpl: capture, log: quiet });
  await tDef.transcribe(Buffer.from("x"));
  check(seen[1].get("language") === "id" && /SiMAB/.test(seen[1].get("prompt")), "stt: tanpa pilihan -> bahasa Indonesia + kosakata SiMAB");
  const warnLog = [];
  const tWarn = createTranscriber({ config: cfg({ geminiKeys: [] }), fetchImpl: async () => resp(429, "x"), log: { ...quiet, warn: (m) => warnLog.push(m) } });
  try { await tWarn.transcribe(Buffer.from("x"), { language: "en", hint: "h" }); } catch { /* diharapkan */ }
  check(warnLog.length >= 1 && /STT groq/.test(warnLog[0]), "stt: pencatatan galat tetap jalan saat petunjuk diberikan");

  // gangguan jaringan (tanpa kode HTTP): diulang sekali di key yang sama, lalu berhasil
  const mkNet = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("socket hang up"), { code: "UND_ERR_SOCKET" }) });
  let netCalls = 0;
  const netWarn = [];
  const tNet = createTranscriber({ config: cfg({ geminiKeys: [] }), fetchImpl: async (u, i) => { netCalls++; if (netCalls === 1) throw mkNet(); return f(u, i); }, log: { ...quiet, warn: (m) => netWarn.push(m) }, sleep: async () => {} });
  const rNet = await tNet.transcribe(Buffer.from("x"));
  check(netCalls === 2 && rNet.engine === "groq" && /UND_ERR_SOCKET/.test(netWarn[0] || ""), "stt: gangguan jaringan sesaat diulang sekali dan sebabnya dicatat");
  const tNet2 = createTranscriber({ config: cfg({ geminiKeys: [] }), fetchImpl: async () => { throw mkNet(); }, log: quiet, sleep: async () => {} });
  let mNet = "";
  try { await tNet2.transcribe(Buffer.from("x")); } catch (e) { mNet = e.message; }
  check(/fetch failed/.test(mNet) && /UND_ERR_SOCKET/.test(mNet), "stt: gagal terus -> pesan akhir memuat sebab asli");
  check(describeError(new Error("x")) === "x" && /ECONNRESET/.test(describeError(mkNetCause())), "describeError: tanpa sebab apa adanya, dengan sebab ditambahkan");

  const none = createTranscriber({ config: cfg({ groqKeys: [], geminiKeys: [] }), fetchImpl: f, log: quiet });
  let m2 = "";
  try { await none.transcribe(Buffer.from("x")); } catch (e) { m2 = e.message; }
  check(/belum aktif/.test(m2), "stt: tanpa kunci -> pesan belum aktif");
}

if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nsemua ok");
