// ================================================================
// Job Short harian (9:16, bergambar) untuk kanal "Belajar Bareng". Berjalan terpisah dari video pelajaran 16:9.
//   topik  : agenda mingguan (temaUntuk) -> bila gagal, SATU topik cadangan dari BANK_TEMA -> bila tetap gagal, hari itu dilewati
//   isi    : buatIsiFaktaCadangan (fakta dari sumber web, tidak pernah dikarang) -> TTS -> render lewat antrean bersama WhatsApp
//   setuju : draf dikirim ke pemilik (video, judul, dasar, sumber); unggah hanya setelah disetujui (alur edu-channel.js)
// Semua ketergantungan disuntikkan supaya bisa diuji dengan jam, LLM, pencarian, suara, dan render palsu.
// ================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { templatUntuk, temaMinggu } from "./motion/templates/index.js";
import { buatIsiFaktaCadangan } from "./motion/content.js";
import { renderVideo } from "./motion/render.js";
import { metaShorts } from "./motion/youtube-meta.js";
import { BANK_TEMA, temaUntuk, teaserPelajaran } from "./motion/tema-mingguan.js";
import { localDay, minutesOfDay } from "./edu-channel.js";

const flag = (v, d) => { const s = String(v ?? "").trim().toLowerCase(); return s ? !["false", "0", "off", "no", "tidak", "mati"].includes(s) : d; };
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(hi, Math.max(lo, n)) : d; };
const jam = (v, d) => (/^([01]?\d|2[0-3]):([0-5]\d)$/.test(String(v || "").trim()) ? String(v).trim() : d);
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const keMenit = (v) => { const [h, m] = v.split(":").map(Number); return h * 60 + m; };

export function readShortsConfig(env = process.env) {
  return {
    aktif: flag(env.SHORTS_AKTIF, true),
    jam: jam(env.SHORTS_JAM, "12:00"), // jam mulai membuat Short (WITA)
    maksCoba: num(env.SHORTS_MAKS_COBA, 2, 1, 5), // percobaan per hari bila yang gagal bukan soal isi (suara/render/jaringan)
    maksMenunggu: num(env.SHORTS_MAKS_MENUNGGU, 2, 1, 7), // berhenti membuat bila segini Short belum diputuskan
    jedaMenit: 20
  };
}

const LIB_BAWAAN = { templatUntuk, temaMinggu, buatIsiFaktaCadangan, renderVideo, metaShorts, temaUntuk, teaserPelajaran, bankTema: BANK_TEMA };
const galatIsi = (e) => /^(Sumber (kurang|tidak cukup)|Gagal membuat fakta)/.test(String(e?.message || e)); // kegagalan ISI (bukan infrastruktur)
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/**
 * @param {object} o
 *  config  : readShortsConfig + { channelName, skala }     edu : createEdu(...) (ajukanShort, linkPelajaran, shortMenunggu, load, enabled, pasangShorts)
 *  motion  : createMotion(...) (state())                   llm, cari(kueri)->[{judul,url,teks}], tts(teks)->berkas audio|null
 *  antrean : { jalankan(fn) } antrean render bersama       sendText(text,{hanya,kecuali}) -> kirim ke pemilik (Telegram/WA)
 */
export function createShortsHarian({ config, edu, motion, llm, cari, tts, antrean = null, sendText = async () => 0, dir, tz = "Asia/Makassar", now = () => Date.now(), lib: libOverride = {}, log = console } = {}) {
  const lib = { ...LIB_BAWAAN, ...libOverride };
  const berkasState = path.join(path.resolve(dir || "edu-data"), "shorts.json");
  const muat = () => { try { return JSON.parse(fs.readFileSync(berkasState, "utf8")); } catch { return { hari: {} }; } };
  const simpan = (s) => { fs.mkdirSync(path.dirname(berkasState), { recursive: true }); const tmp = berkasState + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, berkasState); };
  let sibuk = null;

  /** Topik cadangan dari BANK_TEMA untuk templat itu: yang belum pernah dipakai dan bukan `kecuali`. */
  function topikBank(templatId, riwayat, kecuali = "") {
    const daftar = lib.bankTema[String(templatId).replace(/-teks$/, "")] || lib.bankTema["fakta-angka"] || [];
    const pakai = new Set((riwayat || []).map(norm));
    return daftar.find((x) => !pakai.has(norm(x)) && norm(x) !== norm(kecuali)) || daftar.find((x) => norm(x) !== norm(kecuali)) || "";
  }

  /** Susun, render, dan ajukan satu Short. Melempar { lewati:true } bila semua topik gagal pada ISI; galat lain = infrastruktur (boleh dicoba lagi). */
  async function buat({ tanggal, topikPaksa = "" }) {
    const st = motion.state() || {};
    const tema = lib.temaUntuk(st, tanggal);
    const tpl = lib.templatUntuk(tanggal);
    const utama = topikPaksa || (tema.status === "disetujui" && tema.topik ? tema.topik : "");
    const kandidat = [];
    if (utama) kandidat.push({ topik: utama, asal: topikPaksa ? "ulang" : "agenda" });
    const cad = topikBank(tpl.id, st.riwayat, utama);
    if (cad) kandidat.push({ topik: cad, asal: "cadangan" });

    let r = null, topik = "", asal = "";
    const galat = [];
    for (const k of kandidat) {
      try { r = await lib.buatIsiFaktaCadangan({ llm, cari, templatId: tpl.id, topik: k.topik }); topik = k.topik; asal = k.asal; break; }
      catch (e) {
        if (!galatIsi(e)) throw e; // pencarian/LLM mati: bukan salah topik, jangan buang cadangan
        galat.push(`"${k.topik}": ${String(e.message).slice(0, 140)}`);
      }
    }
    if (!r) throw Object.assign(new Error(galat.length ? galat.join(" | ") : "tidak ada topik"), { lewati: true });

    if (r.isi && "sumberTeks" in r.isi) {
      const dom = [...new Set((r.sumber || []).map((s) => domain(s.url)).filter(Boolean))].slice(0, 3);
      if (dom.length) r.isi.sumberTeks = `Sumber: ${dom.join(", ")}`;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "short-harian-"));
    let suara = null;
    try {
      suara = await tts(r.narasi);
      if (!suara) throw new Error("Suara narasi tidak tersedia (TTS kosong).");
      const keluar = path.join(tmpDir, `short-${tanggal}.mp4`);
      const render = () => lib.renderVideo({
        templatId: r.templatId, isi: r.isi, hook: r.hook, narasi: suara, teaser: lib.teaserPelajaran(st, tanggal), teaserLabel: "TONTON JUGA",
        tema: lib.temaMinggu(tpl, tanggal), skala: config.skala || 1.5, keluar, kanal: config.channelName
      });
      const v = await (antrean ? antrean.jalankan(render) : render());
      const meta = lib.metaShorts({ templatId: r.templatId, isi: r.isi, hook: r.hook, topik, sumber: r.sumber, linkVideo: edu.linkPelajaran?.(tanggal) || "", kanal: config.channelName });
      const item = await edu.ajukanShort({
        file: keluar, topik, judul: meta.judul, deskripsi: meta.deskripsi, tag: meta.tag, dasar: r.dasar, sumber: r.sumber, templatId: r.templatId,
        naskah: r.narasi, detik: v.durasi, lebar: v.lebar, tinggi: v.tinggi, tanggal
      });
      const catatan = asal === "cadangan" ? `\n⚠️ Topik agenda${utama ? ` ("${utama}")` : ""} ${utama ? "tidak lolos pemeriksaan sumber" : "belum ada"}; dipakai topik cadangan.` : "";
      await sendText([`🎬 Short ${tanggal} siap diperiksa di Telegram (tombol Setujui/Buang): #${item.id}`, item.title, `Topik: ${topik}`, r.dasar ? `Dasar fakta: ${r.dasar}` : "", (r.sumber || []).length ? `Sumber:\n${r.sumber.map((s) => `- ${s.judul ? s.judul + " " : ""}${s.url}`).join("\n")}` : ""].filter(Boolean).join("\n") + catatan, { hanya: "wa" }).catch(() => 0);
      return { item, topik, asal };
    } finally {
      if (suara) fs.rmSync(suara, { force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** Satu putaran untuk hari itu, dengan pencatatan percobaan & pemberitahuan. Tidak melempar. */
  async function jalankan({ tanggal, topikPaksa = "", manual = false } = {}) {
    const s = muat();
    const h = (s.hari[tanggal] ||= { status: "belum", percobaan: 0, terakhir: 0 });
    if (!manual) { h.percobaan += 1; h.terakhir = now(); }
    h.status = "jalan"; simpan(s);
    try {
      const r = await buat({ tanggal, topikPaksa });
      const s2 = muat(); const h2 = (s2.hari[tanggal] ||= { percobaan: h.percobaan }); h2.status = "selesai"; h2.topik = r.topik; h2.asal = r.asal; h2.item = r.item.id; simpan(s2);
      return { ok: true, ...r };
    } catch (e) {
      const s2 = muat(); const h2 = (s2.hari[tanggal] ||= { percobaan: h.percobaan });
      const pesan = String(e?.message || e).slice(0, 400);
      const habis = e?.lewati || (!manual && h2.percobaan >= config.maksCoba);
      h2.status = habis ? "dilewati" : "belum"; h2.galat = pesan; simpan(s2);
      log.error?.(`🎬 [Shorts] ${tanggal} gagal: ${pesan}`);
      if (e?.lewati) await sendText(`⚠️ Short ${tanggal} dilewati: topik agenda dan topik cadangan sama-sama gagal (sumber kurang atau isi tidak lolos pemeriksaan). Fakta tidak dikarang.\n${pesan}`).catch(() => 0);
      else if (habis) await sendText(`⚠️ Short ${tanggal} dilewati setelah ${h2.percobaan} percobaan: ${pesan}`).catch(() => 0);
      return { ok: false, galat: pesan, dilewati: habis };
    }
  }

  /** Dipanggil tiap menit. Tidak melempar. */
  async function check() {
    try {
      if (!config.aktif || !edu.enabled?.() || sibuk) return;
      if (edu.load?.().paused) return;
      const t = now(), tanggal = localDay(t, tz);
      const s = muat();
      for (const k of Object.keys(s.hari)) if (k < localDay(t - 30 * 86400_000, tz)) delete s.hari[k];
      const h = s.hari[tanggal];
      if (h && (h.status === "selesai" || h.status === "dilewati")) return;
      if (minutesOfDay(t, tz) < keMenit(config.jam)) return;
      if (h && t - (h.terakhir || 0) < config.jedaMenit * 60_000) return;
      if ((edu.shortMenunggu?.() || 0) >= config.maksMenunggu) return;
      sibuk = jalankan({ tanggal }).finally(() => { sibuk = null; });
    } catch (e) { log.error?.(`🎬 [Shorts] check gagal: ${e?.message || e}`); }
  }

  /** Dibuat ulang dari tombol "Buat ulang": topik sama, tidak menghitung percobaan harian. */
  function ulang(item) {
    const tanggal = item.tanggal || localDay(now(), tz);
    sibuk = jalankan({ tanggal, topikPaksa: item.topic, manual: true }).finally(() => { sibuk = null; });
  }

  const hasil = { check, ulang, jalankan, idle: async () => { while (sibuk) await sibuk; }, state: muat, config };
  edu.pasangShorts?.({ ulang });
  return hasil;
}
