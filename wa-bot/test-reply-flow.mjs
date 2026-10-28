// Tes integrasi alur penjaga balasan (model palsu).   node test-reply-flow.mjs
import { guardedGenerate, REPLY_GUARD_SAFE_TEXT } from "./reply-flow.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { warn() {}, error() {}, log() {} };
const txt = (d) => d.candidates[0].content.parts[0].text;
const mk = (t, extra = {}) => ({ candidates: [{ content: { parts: [{ text: t }] } }], ...extra });
const contents = [{ role: "user", parts: [{ text: "berapa pegawai KPKNL Surakarta?" }] }];
const ground = (t, r) => (r.length ? `HASIL PENCARIAN WEB:\n${r.map((x) => `${x.title}\n   Sumber: ${x.url}`).join("\n")}\n\nPertanyaan: ${t}` : t);
const run = (script, search) => {
  const calls = [];
  const core = async (system, c, o) => { calls.push({ system, c, o }); const s = script[Math.min(calls.length - 1, script.length - 1)]; return typeof s === "function" ? s(system, c) : s; };
  return guardedGenerate({ core, extractText: txt, search, ground, systemText: "SYS", contents, log: silent }).then((d) => ({ d, calls }));
};

// 1. tag [SEARCH] tidak lolos; pencarian dijalankan & model dipanggil ulang dengan hasilnya
let searched = null;
let r = await run([mk("[SEARCH] jumlah pegawai KPKNL Surakarta [/SEARCH]"), mk("Berdasarkan Profil, ada 40 pegawai. Lihat https://djkn.go.id/p", { _allowedUrls: ["https://djkn.go.id/p"] })],
  async (q) => { searched = q; return [{ title: "Profil", url: "https://djkn.go.id/p" }]; });
check(searched === "jumlah pegawai KPKNL Surakarta", "kueri [SEARCH] dijalankan");
check(r.calls.length === 2 && /Sumber: https:\/\/djkn\.go\.id\/p/.test(r.calls[1].c.at(-1).parts[0].text), "model dipanggil ulang dengan hasil pencarian");
check(!/SEARCH/.test(txt(r.d)) && txt(r.d).includes("40 pegawai") && txt(r.d).includes("https://djkn.go.id/p"), "tag tidak lolos, URL sah tetap");

// 2. URL palsu dibuang
r = await run([mk("Ada 38 orang. Lihat https://palsu.go.id/x.pdf", { _allowedUrls: [] })], async () => []);
check(!/https?:/.test(txt(r.d)) && txt(r.d).includes("38 orang"), "URL karangan dibuang");
r = await run([mk("Hasil https://google.example/a", { _allowedUrls: undefined })], async () => []);
check(txt(r.d).includes("https://google.example/a"), "grounding Google (allowedUrls undefined): URL tidak disaring");

// 3. pencarian kosong -> catatan "tidak ada sumber"
r = await run([mk("[SEARCH] apa saja [/SEARCH]"), mk("Saya belum bisa memastikan jumlahnya.")], async () => []);
check(r.calls.length === 2 && /TIDAK menemukan sumber/.test(r.calls[1].system), "hasil kosong -> prompt 'tidak ada sumber'");
check(/belum bisa memastikan/.test(txt(r.d)), "jawaban 'belum bisa memastikan'");

// 4. kosong setelah guard -> ulang sekali -> pesan aman
r = await run([mk("[SEARCH] x [/SEARCH]"), mk("[SEARCH] y [/SEARCH]"), mk("[SEARCH] z [/SEARCH]")], async () => []);
check(txt(r.d) === REPLY_GUARD_SAFE_TEXT && !/SEARCH/.test(txt(r.d)), "tetap hanya tag -> pesan aman, bukan teks kosong");
check(r.calls.length === 3, "diulang sekali sebelum pesan aman");
r = await run([mk("[SEARCH] x [/SEARCH]"), mk("[SEARCH] y [/SEARCH]"), mk("Belum bisa memastikan.")], async () => []);
check(txt(r.d) === "Belum bisa memastikan.", "ulangan berhasil dipakai");

// 5. pencarian error tidak menjatuhkan balasan
r = await run([mk("[SEARCH] x [/SEARCH]"), mk("Belum bisa memastikan.")], async () => { throw new Error("boom"); });
check(txt(r.d) === "Belum bisa memastikan.", "pencarian error -> tetap menjawab");

console.log(fails ? `\n${fails} GAGAL` : "\nSemua tes alur penjaga lolos.");
process.exit(fails ? 1 : 0);
