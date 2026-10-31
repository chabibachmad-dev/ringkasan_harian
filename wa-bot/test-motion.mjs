// Tes modul motion graphic (templat harian, isi, tema mingguan, audio, render).   node test-motion.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SEMUA, HARIAN, templatUntuk, ambilTemplat } from "./motion/templates/index.js";
import { ekstrakJson, buatIsi, cekSatuHitungan, cekPola, periksaIsi } from "./motion/content.js";
import { metaShorts } from "./motion/youtube-meta.js";
import { sintesisAudio, SR } from "./motion/audio.js";
import { rencanaWaktu } from "./motion/render.js";
import { W, H, THEMES, fmtAngka, bungkus, siapkanFont } from "./motion/engine.js";
import * as T from "./motion/tema-mingguan.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// 1. daftar templat & rotasi harian
check(HARIAN.length === 7, "ada 7 templat harian");
check(new Set(HARIAN.map((t) => t.hari)).size === 7, "tiap hari punya templat berbeda");
check(templatUntuk("2026-11-02").id === "kuis-kilat", "Senin = kuis-kilat");
check(templatUntuk("2026-11-08").id === "pola-angka", "Minggu = pola-angka");
check(new Set(HARIAN.map((t) => t.tema)).size === 7, "tiap templat punya tema warna berbeda");
check(SEMUA.every((t) => THEMES[t.tema]), "semua tema warna terdaftar");

// 2. contoh tiap templat valid
for (const t of SEMUA) {
  const r = t.rapikan(t.contoh);
  check(r.ok, `${t.id}: contoh lolos validasi`);
  check(periksaIsi(t.id, r.isi).length === 0, `${t.id}: contoh lolos pemeriksaan hitungan`);
  const sp = t.bangun(r.isi);
  check(sp.durasi >= 14 && sp.durasi <= 24, `${t.id}: durasi ${sp.durasi.toFixed(1)} dtk wajar untuk Shorts`);
  check(sp.efek.every((e) => e.t >= 0 && e.t <= sp.durasi), `${t.id}: waktu efek di dalam durasi`);
  check(typeof t.narasi(r.isi) === "string" && t.narasi(r.isi).length > 20, `${t.id}: narasi tersusun`);
}

// 3. validasi menolak isi buruk
const kuis = ambilTemplat("kuis-kilat"), hit = ambilTemplat("hitung-langkah"), bar = ambilTemplat("perbandingan-bar"), mit = ambilTemplat("mitos-fakta"), pola = ambilTemplat("pola-angka"), fa = ambilTemplat("fakta-angka");
check(!kuis.rapikan({ ...kuis.contoh, jawaban: 9 }).ok, "kuis: jawaban di luar pilihan ditolak");
check(!kuis.rapikan({ ...kuis.contoh, pilihan: ["a", "b"] }).ok, "kuis: kurang dari 3 pilihan ditolak");
check(!hit.rapikan({ ...hit.contoh, langkah: [hit.contoh.langkah[0]] }).ok, "hitung: satu langkah ditolak");
check(!bar.rapikan({ ...bar.contoh, item: bar.contoh.item.slice(0, 2) }).ok, "bar: kurang dari 3 item ditolak");
check(!bar.rapikan({ ...bar.contoh, item: bar.contoh.item.map((x) => ({ ...x, nilai: 0 })) }).ok, "bar: semua nilai nol ditolak");
check(!mit.rapikan({ mitos: "x" }).ok, "mitos: isi tidak lengkap ditolak");
check(!pola.rapikan({ ...pola.contoh, deret: ["1", "2"] }).ok, "pola: deret terlalu pendek ditolak");
check(!fa.rapikan({ ...fa.contoh, angka: "abc" }).ok, "fakta: angka bukan bilangan ditolak");
check(fa.rapikan({ ...fa.contoh, angka: "8.849" }).isi.angka === 8849, "fakta: angka berformat Indonesia dibaca benar");
check(kuis.rapikan({ ...kuis.contoh, pertanyaan: "x".repeat(500) }).isi.pertanyaan.length <= 170, "teks terlalu panjang dipotong");

// 4. pemeriksaan hitungan
check(cekSatuHitungan("24 ÷ 4 = 6") === true, "hitungan benar terdeteksi");
check(cekSatuHitungan("7 × 8 = 54") === false, "hitungan salah terdeteksi");
check(cekSatuHitungan("Luas = 12") === null, "bentuk tak dikenal tidak diperiksa");
check(cekSatuHitungan("1.500 + 500 = 2.000") === true, "angka berformat titik ribuan");
check(cekPola(["2", "5", "8", "11"], "+3", "14") === true, "pola +3 benar");
check(cekPola(["2", "5", "8", "11"], "+3", "15") === false, "pola dengan jawaban salah terdeteksi");
check(cekPola(["3", "6", "12", "24"], "×2", "48") === true, "pola ×2 benar");
check(cekPola(["1", "2", "4"], "naik terus", "8") === null, "aturan bebas tidak diperiksa");

// 5. ekstrak JSON
check(ekstrakJson('```json\n{"a":1}\n```').a === 1, "ekstrak JSON dari blok kode");
check(ekstrakJson('Ini hasilnya: {"a":{"b":"}"}} selesai').a.b === "}", "ekstrak JSON dengan kurung di dalam string");
check(Array.isArray(ekstrakJson('[{"hari":1}]')), "ekstrak array JSON");
let gagal = false; try { ekstrakJson("tidak ada json"); } catch { gagal = true; } check(gagal, "tanpa JSON melempar galat");

// 6. buatIsi dengan AI tiruan (coba ulang)
{
  const balasan = ["maaf saya tidak bisa", JSON.stringify({ judul: "Bagi", soal: "Soal?", langkah: [{ ekspresi: "24 ÷ 4 = 7", catatan: "x" }, { ekspresi: "6 − 2 = 4" }], hasil: "4" }),
    JSON.stringify({ judul: "Bagi", soal: "Soal?", langkah: [{ ekspresi: "24 ÷ 4 = 6", catatan: "x" }, { ekspresi: "6 − 2 = 4" }], hasil: "4", hook: "Bisa hitung ini?", dasar: "pembagian" })];
  let i = 0, prompts = [];
  const r = await buatIsi({ llm: async (p) => { prompts.push(p); return balasan[i++]; }, templatId: "hitung-langkah", topik: "pembagian" });
  check(r.percobaan === 3 && r.hook === "Bisa hitung ini?" && r.dasar === "pembagian", "buatIsi: berhasil pada percobaan ke-3 setelah dua kegagalan");
  check(prompts[2].includes("hitungan salah"), "buatIsi: galat dikirim balik ke AI");
  let err = null; try { await buatIsi({ llm: async () => "bukan json", templatId: "kuis-kilat", topik: "x", maksCoba: 2 }); } catch (e) { err = e; }
  check(err && /Gagal membuat isi/.test(err.message), "buatIsi: melempar galat bila semua percobaan gagal");
}

// 7. tema mingguan
check(T.senenBerikut(new Date(2026, 9, 31)) === "2026-11-02", "Sabtu 31 Okt -> Senin 2 Nov");
check(T.senenBerikut(new Date(2026, 10, 2)) === "2026-11-09", "Senin -> Senin pekan depan");
{
  const mg = T.susunMinggu("2026-11-02");
  check(mg.length === 7 && mg[0].templat === "kuis-kilat" && mg[6].templat === "pola-angka" && mg[6].tanggal === "2026-11-08", "susunMinggu: 7 hari, Senin–Minggu");
  check(T.rentangTeks("2026-11-02") === "2–8 November 2026", "rentang tanggal teks");
  const u0 = await T.usulkanMinggu({ senen: "2026-11-02" });
  check(u0.hari.length === 7 && new Set(u0.hari.map((x) => x.topik)).size === 7 && u0.hari.every((x) => x.sumber === "bank"), "usulan tanpa AI memakai bank, 7 topik unik");
  const u1 = await T.usulkanMinggu({ senen: "2026-11-02", temaOwner: [{ teks: "Planet Mars" }, { teks: "Hewan laut" }] });
  check(u1.hari[0].topik === "Planet Mars" && u1.hari[0].sumber === "owner" && u1.hari[1].topik === "Hewan laut", "tema pemilik dipakai lebih dulu");
  const llm = async () => JSON.stringify([1, 2, 3, 4, 5, 6, 7].map((n) => ({ hari: n, topik: `Topik AI ${n}` })));
  const u2 = await T.usulkanMinggu({ llm, senen: "2026-11-02", temaOwner: [{ teks: "Planet Mars" }] });
  check(u2.hari[0].sumber === "owner" && u2.hari[1].topik === "Topik AI 2" && u2.hari[1].sumber === "ai", "AI mengisi hari yang kosong");
  const u3 = await T.usulkanMinggu({ llm: async () => { throw new Error("mati"); }, senen: "2026-11-02" });
  check(u3.hari.every((x) => x.sumber === "bank"), "AI gagal -> jatuh ke bank cadangan");
  const u4 = await T.usulkanMinggu({ senen: "2026-11-02", riwayat: [T.BANK_TEMA["kuis-kilat"][0]] });
  check(u4.hari[0].topik !== T.BANK_TEMA["kuis-kilat"][0], "topik yang sudah pernah dipakai dihindari");
  check(T.formatUsulan(u0).includes("Senin — Kuis Kilat") && T.formatUsulan(u0).includes("setuju"), "format pesan usulan");
  check(T.tombolUsulan("2026-11-02").inline_keyboard[0][0].callback_data === "tema:setuju:2026-11-02", "tombol usulan");

  const P = T.parsePerintah;
  check(P("setuju").aksi === "setuju" && P("Oke").aksi === "setuju", "perintah: setuju");
  check(P("ulang").aksi === "ulang", "perintah: ulang");
  const g = P("ganti 3: planet Mars"); check(g.aksi === "ganti" && g.hari === 3 && g.topik === "planet Mars", "perintah: ganti dengan nomor");
  const g2 = P("ganti rabu planet Mars"); check(g2.aksi === "ganti" && g2.hari === 3, "perintah: ganti dengan nama hari");
  const tk = P("tukar 2 5"); check(tk.aksi === "tukar" && tk.a === 2 && tk.b === 5, "perintah: tukar");
  check(P("tukar selasa dengan jumat").b === 5, "perintah: tukar dengan nama hari");
  check(P("hapus 4").aksi === "hapus" && P("hapus 4").hari === 4, "perintah: hapus");
  const tm = P("tema: dinosaurus; gunung berapi"); check(tm.aksi === "tema" && tm.daftar.length === 2, "perintah: tema banyak");
  check(P("ganti 9: x").aksi === "bebas", "hari tidak valid jatuh ke bebas");
  check(P("hari kamis tolong lebih mudah").aksi === "bebas", "kalimat bebas");

  let st = { usulan: u0, temaOwner: [], riwayat: [] };
  let r = await T.terapkan({ state: st, perintah: P("ganti 3: Planet Mars") });
  check(r.berubah && r.state.usulan.hari[2].topik === "Planet Mars" && r.state.usulan.hari[2].sumber === "owner" && st.usulan.hari[2].topik !== "Planet Mars", "ganti: hanya salinan yang berubah");
  const a0 = r.state.usulan.hari[0].topik, b0 = r.state.usulan.hari[4].topik; r = await T.terapkan({ state: r.state, perintah: P("tukar 1 5") });
  check(r.state.usulan.hari[0].topik === b0 && r.state.usulan.hari[4].topik === a0 && r.state.usulan.hari[0].templat === "kuis-kilat", "tukar: topik bertukar, templat tetap");
  r = await T.terapkan({ state: r.state, perintah: P("hapus 4") }); check(r.berubah && r.state.usulan.hari[3].topik, "hapus: diganti topik baru");
  r = await T.terapkan({ state: r.state, perintah: P("tema: Dinosaurus; Gunung berapi") }); check(r.state.temaOwner.length === 2, "tema: masuk antrean pemilik");
  r = await T.terapkan({ state: r.state, perintah: P("daftar tema") }); check(/Dinosaurus/.test(r.pesan), "daftar tema ditampilkan");
  r = await T.terapkan({ state: r.state, perintah: P("ulang"), llm: null }); check(r.state.usulan.hari[2].topik === "Planet Mars" && r.state.usulan.status === "diusulkan", "ulang: tema pemilik dipertahankan");
  r = await T.terapkan({ state: r.state, perintah: P("setuju") }); check(r.state.usulan.status === "disetujui" && r.state.usulan.disetujuiOleh === "owner", "setuju");
  const llmBebas = async () => JSON.stringify([{ hari: 5, topik: "Daur ulang sampah" }]);
  r = await T.terapkan({ state: r.state, perintah: P("hari jumat bahas lingkungan"), llm: llmBebas }); check(r.berubah && r.state.usulan.hari[4].topik === "Daur ulang sampah", "revisi bebas lewat AI");
  r = await T.terapkan({ state: { usulan: null, temaOwner: [], riwayat: [] }, perintah: P("setuju") }); check(!r.berubah && /Belum ada usulan/.test(r.pesan), "setuju tanpa usulan ditolak halus");
  const oto = T.setujuiOtomatis({ usulan: u0 }); check(oto.usulan.status === "disetujui" && oto.usulan.disetujuiOleh === "otomatis", "setujuiOtomatis");
  check(T.temaUntuk(oto, "2026-11-03").topik === u0.hari[1].topik && T.temaUntuk(oto, "2027-01-01").status === "tidak-ada", "temaUntuk per tanggal");
  check(T.teaserBesok(oto, "2026-11-02") === u0.hari[1].topik, "teaser besok");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tema-")); const berkas = path.join(tmp, "x", "tema.json");
  T.simpanState(berkas, oto); check(JSON.stringify(T.muatState(berkas)) === JSON.stringify(oto), "simpan dan muat state"); check(T.muatState(path.join(tmp, "tidak-ada.json")).usulan === null, "muat berkas tidak ada -> state kosong");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 8. metadata YouTube
{
  const t = ambilTemplat("mitos-fakta"), m = metaShorts({ templatId: t.id, isi: t.contoh, hook: "Mitos atau fakta?", topik: "Wortel dan mata" });
  check(m.judul.length <= 100 && m.judul.endsWith("#Shorts"), "judul <= 100 huruf dan ber-#Shorts");
  check(m.madeForKids === true && m.containsSyntheticMedia === true && m.deskripsi.includes("#Shorts"), "metadata anak-anak + media sintetis");
  const m2 = metaShorts({ templatId: "kuis-kilat", isi: { ...ambilTemplat("kuis-kilat").contoh, pertanyaan: "p".repeat(300) }, hook: "x" });
  check(m2.judul.length <= 100, "judul panjang dipotong");
}

// 9. audio
{
  const a = sintesisAudio({ durasi: 3, musik: ambilTemplat("kuis-kilat").musik, efek: [{ t: 0.5, k: "pop" }, { t: 1, k: "whoosh" }, { t: 1.5, k: "thud" }, { t: 2, k: "tada" }] });
  const b = sintesisAudio({ durasi: 3, musik: ambilTemplat("kuis-kilat").musik, efek: [{ t: 0.5, k: "pop" }, { t: 1, k: "whoosh" }, { t: 1.5, k: "thud" }, { t: 2, k: "tada" }] });
  let pk = 0, sama = true; for (let i = 0; i < a.L.length; i++) { pk = Math.max(pk, Math.abs(a.L[i]), Math.abs(a.R[i])); if (a.L[i] !== b.L[i]) sama = false; }
  check(a.L.length === 3 * SR, "audio: panjang sesuai durasi");
  check(pk > 0.5 && pk <= 0.86, `audio: puncak ${pk.toFixed(2)} terkendali`);
  check(sama, "audio: deterministik (hasil sama untuk masukan sama)");
  check(Math.abs(a.L[0]) < 0.01 && Math.abs(a.L[a.L.length - 1]) < 0.02, "audio: fade in/out di ujung");
}

// 10. rencana waktu
{
  const r0 = rencanaWaktu({ durTemplat: 20, durNarasi: 0 }); check(r0.k === 1 && r0.total > 20, "rencana waktu: tanpa narasi tidak diregangkan");
  const r1 = rencanaWaktu({ durTemplat: 16, durNarasi: 30, withHook: true }); check(r1.k > 1.5 && r1.total >= 30, "rencana waktu: narasi panjang meregangkan templat");
  const r2 = rencanaWaktu({ durTemplat: 10, durNarasi: 90 }); check(r2.k <= 2.2, "rencana waktu: regangan dibatasi");
  const r3 = rencanaWaktu({ durTemplat: 20, durNarasi: 5 }); check(r3.k === 1, "rencana waktu: narasi pendek tidak memendekkan templat");
}

// 11. util engine
check(fmtAngka(8849) === "8.849" && fmtAngka(3.14159, 2) === "3,14" && fmtAngka(1234567.5, 1) === "1.234.567,5", "format angka Indonesia");

// 12. gambar & render (dilewati bila @napi-rs/canvas / ffmpeg belum terpasang)
let canvasLib = null; try { canvasLib = await import("@napi-rs/canvas"); } catch {}
if (!canvasLib) console.log("lewati: @napi-rs/canvas belum terpasang (npm i @napi-rs/canvas)");
else {
  await siapkanFont(canvasLib);
  const cv = canvasLib.createCanvas(W, H), g = cv.getContext("2d");
  check(bungkus(g, "satu dua tiga empat lima enam tujuh delapan", 200, "800 40px InterMG").length > 1, "bungkus teks menjadi beberapa baris");
  for (const t of SEMUA) {
    const sp = t.bangun(t.rapikan(t.contoh).isi); let ok = true, ragam = 0;
    for (const f of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.99, 1]) {
      try { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; sp.gambar(g, f * sp.durasi); } catch (e) { ok = false; console.log("  galat gambar", t.id, f, e.message); }
      if (f === 0.85) { const d = cv.data(); const set = new Set(); for (let i = 0; i < d.length; i += 4 * 997) set.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); ragam = set.size; }
    }
    check(ok, `${t.id}: menggambar tanpa galat di 9 titik waktu`);
    check(ragam > 6, `${t.id}: kanvas tidak kosong (ragam warna ${ragam})`);
  }
  const ff = spawnSync("ffmpeg", ["-version"]);
  if (ff.status !== 0) console.log("lewati render: ffmpeg tidak ada");
  else {
    const { renderVideo, durasiBerkas } = await import("./motion/render.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mt-")), out = path.join(tmp, "uji.mp4"), t = ambilTemplat("pola-angka");
    const hasil = await renderVideo({ templatId: t.id, isi: t.contoh, hook: "Tebak angkanya!", teaser: "Fakta unik planet", keluar: out, skala: 0.3, fps: 15 });
    const dur = durasiBerkas(out);
    check(fs.existsSync(out) && Math.abs(dur - hasil.durasi) < 0.3, `render: berkas jadi, durasi ${dur.toFixed(1)} dtk sesuai rencana`);
    const info = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout;
    check(/h264,video,\d+,\d+/.test(info) && /aac,audio/.test(info), "render: ada video H.264 dan audio AAC");
    check(!fs.existsSync(out.replace(/\.mp4$/, ".part.mp4")), "render: tidak meninggalkan berkas sementara");
    // narasi tiruan (nada pendek) -> jalur ducking dan peregangan
    const nar = path.join(tmp, "nar.wav"); spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=26", nar]);
    const out2 = path.join(tmp, "uji2.mp4"), h2 = await renderVideo({ templatId: t.id, isi: t.contoh, hook: "Tebak angkanya!", narasi: nar, keluar: out2, skala: 0.3, fps: 15 });
    check(h2.regang > 1 && Math.abs(durasiBerkas(out2) - h2.durasi) < 0.3 && h2.durasi >= 26, `render dengan narasi: diregangkan x${h2.regang.toFixed(2)} dan cukup panjang`);
    let galat = null; try { await renderVideo({ templatId: "tidak-ada", isi: {}, keluar: path.join(tmp, "z.mp4") }); } catch (e) { galat = e; } check(galat, "render: templat tidak dikenal melempar galat");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(fails ? `\n${fails} tes GAGAL` : "\nSemua tes motion lolos");
process.exit(fails ? 1 : 0);
