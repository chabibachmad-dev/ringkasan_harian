// ================================================================
// Penghubung modul motion graphic (motion/) ke pipeline edu-channel.js:
//   produce()    : tema hari ini -> isi AI -> narasi TTS -> render video -> metadata Shorts
//   tema mingguan: usulan Sabtu 08:00, pengingat Minggu 18:00, setujui otomatis Minggu 21:00 (TEMA_OTOMATIS=0 mematikan),
//                  tombol/balasan/perintah /tema dari pemilik.
// Semua ketergantungan (AI, suara, kirim pesan, jam, modul motion) dapat disuntik agar bisa diuji tanpa jaringan.
// ================================================================
import fs from "node:fs";
import path from "node:path";
import { templatUntuk } from "./motion/templates/index.js";
import { buatIsi } from "./motion/content.js";
import { renderVideo } from "./motion/render.js";
import { metaShorts } from "./motion/youtube-meta.js";
import * as TM from "./motion/tema-mingguan.js";
import { localDay, minutesOfDay } from "./edu-channel.js";

const flag = (v, d) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? !["false", "0", "off", "no", "tidak", "mati"].includes(s) : d;
};

export function readMotionConfig(env = process.env) {
  const mode = String(env.EDU_MODE || "motion").trim().toLowerCase();
  const skala = Number(env.EDU_MOTION_SKALA);
  return {
    mode: mode === "papan" ? "papan" : "motion",
    temaOtomatis: flag(env.TEMA_OTOMATIS, true),
    temaFile: String(env.EDU_TEMA_FILE || "data/tema-mingguan.json").trim(),
    skala: Number.isFinite(skala) && skala >= 1 && skala <= 2 ? skala : 1.5
  };
}

const LIB_BAWAAN = {
  templatUntuk, buatIsi, renderVideo, metaShorts,
  usulkanMinggu: TM.usulkanMinggu, terapkan: TM.terapkan, parsePerintah: TM.parsePerintah, formatUsulan: TM.formatUsulan, tombolUsulan: TM.tombolUsulan,
  muatState: TM.muatState, simpanState: TM.simpanState, temaUntuk: TM.temaUntuk, setujuiOtomatis: TM.setujuiOtomatis,
  catatRiwayat: TM.catatRiwayat, teaserBesok: TM.teaserBesok, senenBerikut: TM.senenBerikut
};

const HARI_SABTU = 6;
const HARI_MINGGU = 0;
const MENIT = { usul: 8 * 60, ingat: 18 * 60, otomatis: 21 * 60 };
const dariHari = (iso) => new Date(`${iso}T12:00:00`);

/**
 * @param {object} o
 *  config  : hasil readMotionConfig + { channelName, voice, style }
 *  llm     : async (prompt) => string          speaker : { speakWav(text,{voice,style}) -> {wav} }
 *  sendText: async (text, {markup}) -> jumlah penerima (markup = baris tombol Telegram)
 */
export function createMotion({ config, tz = "Asia/Makassar", llm = null, antrean = null, speaker = null, sendText = async () => 0, now = () => Date.now(), log = console, lib: libOverride = {} } = {}) {
  const lib = { ...LIB_BAWAAN, ...libOverride };
  const muat = () => lib.muatState(config.temaFile);
  const simpan = (st) => lib.simpanState(config.temaFile, st);
  const baris = (minggu) => lib.tombolUsulan(minggu).inline_keyboard;

  // antrean agar callback, balasan teks, dan jadwal tidak saling menimpa berkas state
  let rantai = Promise.resolve();
  const serial = (fn) => {
    const p = rantai.then(fn, fn);
    rantai = p.catch(() => {});
    return p;
  };

  const kirimUsulan = (u, awalan = "") => sendText(`${awalan}${lib.formatUsulan(u)}`, { markup: baris(u.minggu) });
  /** Jawaban langsung hanya ke kanal asal (kanal lain dikabari terpisah oleh kabari). */
  const balas = (kanal, pesan) => sendText(pesan, { hanya: kanal });
  const NAMA_KANAL = { telegram: "Telegram", wa: "WhatsApp" };
  /** Kabari kanal lain (bukan `kanal` asal) bahwa pemilik sudah memutuskan lewat `kanal`. */
  const kabari = (kanal, pesan) => (kanal ? sendText(`ℹ️ (lewat ${NAMA_KANAL[kanal] || kanal}) ${pesan}`, { kecuali: kanal }).catch(() => 0) : Promise.resolve(0));

  // ------------------------------------------------------------ pembuatan video
  /**
   * @param {object} o  tanggal "YYYY-MM-DD" (hari tayang), file (.mp4 keluar), tmpDir, bank () => {topik} bila tema tak ada,
   *                    topik/templatId (opsional; dipakai saat "buat ulang")
   */
  async function produce({ tanggal, file, tmpDir, bank = null, topik: paksa = "", templatId: paksaTpl = "" }) {
    const st = muat();
    const tema = lib.temaUntuk(st, tanggal);
    const tpl = paksaTpl ? { id: paksaTpl } : lib.templatUntuk(tanggal);
    let topik = paksa, asal = paksa ? "ulang" : "", dariBank = null;
    if (!topik && tema.status === "disetujui" && tema.topik) { topik = tema.topik; asal = "tema"; }
    if (!topik) {
      if (!bank) throw new Error("Tidak ada tema hari ini dan bank topik tidak tersedia.");
      dariBank = bank();
      topik = dariBank.topik; asal = "bank";
    }
    const { isi, hook, dasar, narasi } = await lib.buatIsi({ llm, templatId: tpl.id, topik });
    fs.mkdirSync(tmpDir, { recursive: true });
    const suara = await speaker.speakWav(narasi, { voice: config.voice, style: config.style });
    if (!suara?.wav) throw new Error("Suara narasi kosong.");
    const berkasSuara = path.join(tmpDir, "narasi.wav");
    fs.writeFileSync(berkasSuara, suara.wav);
    // render berat: bergiliran dengan permintaan video dari WhatsApp (antrean yang sama)
    const render = () => lib.renderVideo({ templatId: tpl.id, isi, hook, teaser: lib.teaserBesok(st, tanggal), narasi: berkasSuara, keluar: file, skala: config.skala, kanal: config.channelName });
    const v = await (antrean ? antrean.jalankan(render) : render());
    const meta = lib.metaShorts({ templatId: tpl.id, isi, hook, topik, kanal: config.channelName, tanggal });
    return { topik, asal, dariBank, templatId: tpl.id, hook, dasar, narasi, isi, meta, detik: v.durasi, lebar: v.lebar, tinggi: v.tinggi };
  }

  /** Topik video pelajaran untuk tanggal itu, hanya bila agenda sudah disetujui. "" bila tak ada. */
  function pelajaranHariIni(tanggal) {
    const t = lib.temaUntuk(muat(), tanggal);
    return t.status === "disetujui" ? String(t.pelajaran?.topik || "") : "";
  }

  /** Dipanggil saat video disetujui: topik masuk riwayat supaya tidak diusulkan lagi. */
  function catatTopik(topik) {
    return serial(() => { simpan(lib.catatRiwayat(muat(), topik)); });
  }

  // ------------------------------------------------------------ jadwal tema mingguan
  async function tickInner() {
    const t = now();
    const hariIni = localDay(t, tz);
    const dow = dariHari(hariIni).getDay();
    if (dow !== HARI_SABTU && dow !== HARI_MINGGU) return;
    const menit = minutesOfDay(t, tz);
    const senen = lib.senenBerikut(dariHari(hariIni));
    let st = muat();
    st.penanda ||= {};
    const u = st.usulan;
    const adaUntukMinggu = u && u.minggu === senen;

    if (!adaUntukMinggu && st.penanda.usul !== senen && (dow === HARI_MINGGU || menit >= MENIT.usul)) {
      st.penanda.usul = senen; // ditandai dulu: gagal AI pun tidak diulang tiap menit (usulkanMinggu sendiri jatuh ke bank)
      const baru = await lib.usulkanMinggu({ llm, senen, riwayat: st.riwayat || [], temaOwner: st.temaOwner || [], sekarang: new Date(t) });
      const dipakai = baru.hari.filter((h) => h.sumber === "owner").length;
      st.temaOwner = (st.temaOwner || []).slice(dipakai);
      st.usulan = baru;
      st.menunggu = null;
      simpan(st);
      await kirimUsulan(baru, "🗓️ ");
      return;
    }
    if (!adaUntukMinggu || u.status !== "diusulkan" || dow !== HARI_MINGGU) return;

    if (config.temaOtomatis && menit >= MENIT.otomatis && st.penanda.otomatis !== senen) {
      st.penanda.otomatis = senen;
      st = lib.setujuiOtomatis(st, new Date(t));
      simpan(st);
      await sendText(`⏰ Tema pekan depan belum Bapak jawab, jadi saya setujui otomatis sesuai usulan:\n\n${lib.formatUsulan(st.usulan)}\n\nUbah lewat /tema bila perlu.`);
      return;
    }
    if (menit >= MENIT.ingat && st.penanda.ingat !== senen) {
      st.penanda.ingat = senen;
      simpan(st);
      await kirimUsulan(u, `🔔 Pengingat: tema pekan depan belum disetujui${config.temaOtomatis ? " (disetujui otomatis pukul 21:00)" : ""}.\n\n`);
    }
  }
  /** Dipanggil tiap menit oleh check(). Tidak melempar. */
  const tickTema = () => serial(tickInner).catch((e) => { log.error?.(`🗓️ [Tema] jadwal gagal: ${e?.message || e}`); });

  // ------------------------------------------------------------ tombol, balasan, perintah
  async function terapkanPerintah(st, perintah, kanal = "") {
    const u0 = st.usulan;
    // keputusan pertama yang masuk yang berlaku: setelah disetujui (dari kanal mana pun), setuju/ulang berikutnya ditolak
    if (u0?.status === "disetujui" && (perintah.aksi === "setuju" || perintah.aksi === "ulang")) {
      const lewat = u0.disetujuiLewat ? ` lewat ${NAMA_KANAL[u0.disetujuiLewat] || u0.disetujuiLewat}` : "";
      return { state: st, pesan: `Usulan ini sudah disetujui${lewat}.`, berubah: false, ditolak: true };
    }
    const r = await lib.terapkan({ state: st, perintah, llm, sekarang: new Date(now()) });
    if (perintah.aksi === "setuju" && r.state.usulan) r.state.usulan.disetujuiLewat = kanal || "telegram";
    if (r.berubah || perintah.aksi === "setuju") simpan(r.state);
    if ((r.berubah || perintah.aksi === "setuju") && kanal && perintah.aksi !== "tema") await kabari(kanal, r.pesan);
    return r;
  }

  /** callback_data "tema:setuju|ulang|revisi:<minggu>" (tanpa awalan "tema:" atau dengan). Mengembalikan teks balasan atau "". */
  function callback(data, { kanal = "telegram" } = {}) {
    return serial(async () => {
      const m = /^(?:tema:)?(setuju|ulang|revisi):(\S+)$/.exec(String(data || "").trim());
      if (!m) return "Tombol tema tidak dikenal.";
      const [, aksi, minggu] = m;
      const st = muat();
      const u = st.usulan;
      if (!u || u.minggu !== minggu) {
        if (u) await kirimUsulan(u, "Usulan itu sudah tidak berlaku. Usulan terbaru:\n\n");
        return u ? "" : "Belum ada usulan tema yang aktif.";
      }
      if (aksi === "revisi") {
        st.menunggu = { minggu, sampai: now() + 30 * 60_000 };
        simpan(st);
        return "Silakan balas dengan perubahan, misalnya: ganti 3: planet Mars, tukar 2 5, hapus 4, atau tulis bebas.";
      }
      if (aksi === "setuju") {
        return (await terapkanPerintah(st, { aksi: "setuju" }, kanal)).pesan;
      }
      const r = await terapkanPerintah(st, { aksi: "ulang" }, kanal);
      if (r.ditolak) return r.pesan;
      await balas(kanal, r.pesan);
      await kirimUsulan(r.state.usulan);
      return "";
    });
  }

  /**
   * Teks bebas dari pemilik. Ditangani bila membalas pesan usulan, setelah menekan "Revisi", atau berupa perintah tegas
   * (ganti/tukar/hapus/tema:). Pesan biasa seperti "ok" tidak dicegat. Mengembalikan { handled }.
   */
  function teks(text, { replyText = "", kanal = "telegram" } = {}) {
    return serial(async () => {
      const st = muat();
      const p = lib.parsePerintah(text);
      const membalas = /Usulan tema pekan/.test(String(replyText || "").slice(0, 300));
      const siaga = st.menunggu && st.menunggu.sampai > now();
      let tegas = ["ganti", "gantiPelajaran", "tukar", "hapus"].includes(p.aksi) ? Boolean(st.usulan) : ["tema", "daftarTema"].includes(p.aksi);
      // WhatsApp tidak punya tombol: "setuju"/"ulang" yang jelas dianggap jawaban selama usulan masih menunggu
      if (kanal === "wa" && st.usulan?.status === "diusulkan" && /^(setuju|acc|usul(kan)? ulang|ulang)\s*$/i.test(String(text).trim())) tegas = true;
      // sudah diputuskan lewat kanal lain beberapa jam lalu: jawab "sudah disetujui", jangan diam
      if (kanal === "wa" && st.usulan?.status === "disetujui" && Date.parse(st.usulan.disetujui || 0) > now() - 12 * 3600_000 && /^(setuju|usul(kan)? ulang)\s*$/i.test(String(text).trim())) tegas = true;
      if (!(membalas || siaga || tegas)) return { handled: false };
      if (!st.usulan && !["tema", "daftarTema"].includes(p.aksi)) return { handled: false };
      const r = await terapkanPerintah(st, p, kanal);
      if (siaga && (r.berubah || p.aksi !== "bebas")) { const s2 = muat(); s2.menunggu = null; simpan(s2); }
      await balas(kanal, r.pesan);
      if (!r.ditolak && p.aksi !== "setuju" && (r.berubah || p.aksi === "ulang") && r.state.usulan) await kirimUsulan(r.state.usulan);
      return { handled: true };
    });
  }

  /** /tema | /tema tambah a; b | /tema setuju|ulang | /tema usul | /tema <perintah apa pun dari parsePerintah> */
  function perintah(arg = "", { kanal = "telegram" } = {}) {
    return serial(async () => {
      const a = String(arg || "").trim();
      const st = muat();
      if (!a) {
        if (!st.usulan) return "Belum ada usulan tema yang aktif. Usulan dikirim tiap Sabtu 08:00; atau ketik /tema usul. Tambah topik sendiri: /tema tambah topik; topik lain";
        await kirimUsulan(st.usulan);
        return "";
      }
      let m;
      if ((m = a.match(/^tambah\s+([\s\S]+)$/i))) {
        const daftar = m[1].split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
        if (!daftar.length) return "Tulis topiknya: /tema tambah topik; topik lain";
        return (await terapkanPerintah(st, { aksi: "tema", daftar }, kanal)).pesan;
      }
      if (/^usul(kan)?$/i.test(a)) {
        const senen = lib.senenBerikut(dariHari(localDay(now(), tz)));
        const baru = await lib.usulkanMinggu({ llm, senen, riwayat: st.riwayat || [], temaOwner: st.temaOwner || [], sekarang: new Date(now()) });
        st.temaOwner = (st.temaOwner || []).slice(baru.hari.filter((h) => h.sumber === "owner").length);
        st.usulan = baru; st.menunggu = null;
        simpan(st);
        await kirimUsulan(baru, "🗓️ ");
        return "";
      }
      const p = lib.parsePerintah(a);
      const r = await terapkanPerintah(st, p, kanal);
      await balas(kanal, r.pesan);
      if (!r.ditolak && (r.berubah || p.aksi === "ulang") && r.state.usulan) await kirimUsulan(r.state.usulan);
      return "";
    });
  }

  return { config, produce, catatTopik, pelajaranHariIni, tickTema, callback, teks, perintah, state: muat };
}
