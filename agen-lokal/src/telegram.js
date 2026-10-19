// Bot Telegram untuk agent: long polling (tanpa webhook/port terbuka), hanya melayani id pemilik, persetujuan lewat tombol.
import { applyReturn, listSent, lookupSent, planReturn } from "./kembali.js";
import { findDirsByName, findFilesByName } from "./tools.js";
import { bacaAntrian, parseDaftar, ringkasan, simpanAntrian } from "./spby.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isInside, resolveInRoots } from "./safety.js";

const API = "https://api.telegram.org";
const chunk = (text, n = 3900) => {
  const out = [];
  let rest = String(text ?? "");
  while (rest.length > n) {
    let cut = rest.lastIndexOf("\n", n);
    if (cut < n * 0.5) cut = n;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out.length ? out : [""];
};

const IS_WIN = process.platform === "win32";

export const HELP = [
  `Halo, aku Agen Lokal di ${IS_WIN ? "laptopmu" : "server Linux-mu"}. Tulis saja permintaanmu, contoh:`,
  "• cari file laporan bulan September",
  IS_WIN ? "• ringkas file C:\\Users\\Kamu\\Documents\\notulen.docx" : "• ringkas file ~/dokumen/notulen.docx",
  "• buat folder Arsip 2026 lalu pindahkan semua pdf di Unduhan ke sana",
  "• cari di web harga emas hari ini",
  IS_WIN ? "• berapa sisa ruang disk? (aku jalankan perintah PowerShell, kamu setujui dulu)" : "• berapa sisa ruang disk dan memori server? (aku jalankan perintah bash, kamu setujui dulu)",
  "",
  "Perubahan (tulis/pindah/hapus file, perintah) selalu minta persetujuanmu lewat tombol ✅/❌. Hapus hanya memindahkan ke folder _sampah.",
  "Kirim berkas ke chat ini → disimpan di folder kerja (_masuk), lalu bisa kuolah.",
  "Mau mengedit di tempat lain? Suruh aku \"kirim file <alamat>\", edit, lalu kirim balik berkas bernama sama: aku tawarkan untuk menggantikan yang asli (yang lama dicadangkan).",
  "Daftar kegiatan (Excel berkolom COA Sakti | Uraian | Jumlah) yang kamu kirim ke chat ini kubaca, kuperiksa, dan kuantrikan. /sakti membuka SAKTI di komputer ini (captcha dan kode MFA kamu kirim lewat chat).",
  "",
  "/baru  lupakan percakapan   /batal  hentikan tugas   /status  kondisi   /model [nama]  lihat/ganti model   /ulang  mulai ulang agen   /id  id chat"
].join("\n");

export function createBot({ config, agent, ollama, tools = null, fetchImpl = fetch, log = console, pollTimeoutSec = 25, onRestart = null, restartDelayMs = 1500, sakti = null }) {
  const owners = config.owners;
  let offset = 0;
  let stopped = false;
  const pending = new Map(); // id -> { resolve, chatId, timer }

  async function api(method, body, { timeoutMs = 30_000, form = null } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${API}/bot${config.token}/${method}`, form ? { method: "POST", body: form, signal: ctl.signal } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: ctl.signal });
      const j = await res.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.description || `Telegram galat ${res.status}`);
      return j.result;
    } finally {
      clearTimeout(timer);
    }
  }

  const send = async (chatId, text, extra = {}) => {
    let last;
    for (const part of chunk(text)) last = await api("sendMessage", { chat_id: chatId, text: part, disable_web_page_preview: true, ...extra });
    return last;
  };

  async function sendFile(chatId, file) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("document", new Blob([fs.readFileSync(file)]), path.basename(file));
    return api("sendDocument", null, { form, timeoutMs: 120_000 });
  }

  async function sendPhoto(chatId, buf, caption = "") {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) form.append("caption", caption.slice(0, 900));
    form.append("photo", new Blob([buf], { type: "image/png" }), "layar.png");
    return api("sendPhoto", null, { form, timeoutMs: 60_000 });
  }

  // Jawaban teks yang sedang ditunggu (captcha, kode MFA): pesan berikutnya dari pemilik masuk ke sini, bukan ke model.
  const waiters = new Map(); // chatId -> { resolve, timer }
  function ask(chatId, prompt, timeoutMs = 5 * 60_000) {
    return new Promise((resolve) => {
      const old = waiters.get(chatId);
      if (old) {
        clearTimeout(old.timer);
        old.resolve(null);
      }
      const timer = setTimeout(() => {
        waiters.delete(chatId);
        send(chatId, "⌛ Waktu menunggu jawabanmu habis.").catch(() => {});
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      waiters.set(chatId, { resolve, timer });
      send(chatId, `✍️ ${prompt}`).catch(() => {});
    });
  }

  async function download(fileId) {
    const info = await api("getFile", { file_id: fileId });
    const res = await fetchImpl(`${API}/file/bot${config.token}/${info.file_path}`);
    if (!res.ok) throw new Error(`Unduh gagal (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  function askApproval(chatId, summary, state) {
    const id = crypto.randomBytes(5).toString("hex");
    return new Promise((resolve) => {
      const finish = (ok, why = "") => {
        const p = pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(id);
        resolve(ok);
        if (p.messageId) api("editMessageReplyMarkup", { chat_id: chatId, message_id: p.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        if (why) send(chatId, why).catch(() => {});
      };
      const timer = setTimeout(() => finish(false, "⌛ Tidak ada jawaban, tindakan dibatalkan."), config.approvalTimeoutMs);
      timer.unref?.();
      pending.set(id, { chatId, timer, finish });
      if (state) state.onCancel = () => finish(false);
      send(chatId, `🔐 Minta persetujuan:\n\n${summary}`, { reply_markup: { inline_keyboard: [[{ text: "✅ Izinkan", callback_data: `ap:${id}:y` }, { text: "❌ Tolak", callback_data: `ap:${id}:n` }]] } })
        .then((m) => {
          const p = pending.get(id);
          if (p) p.messageId = m?.message_id;
        })
        .catch((e) => {
          log.warn?.(`gagal kirim permintaan persetujuan: ${e.message}`);
          finish(false);
        });
    });
  }

  async function handleCallback(cq) {
    const m = /^ap:([0-9a-f]+):([yn])$/.exec(String(cq.data || ""));
    const chatId = String(cq.message?.chat?.id ?? "");
    const fromOk = owners.has(String(cq.from?.id)) && owners.has(chatId);
    if (!m || !fromOk) return void api("answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    const p = pending.get(m[1]);
    if (!p || p.chatId !== chatId) return void api("answerCallbackQuery", { callback_query_id: cq.id, text: "Permintaan ini sudah tidak berlaku." }).catch(() => {});
    api("answerCallbackQuery", { callback_query_id: cq.id, text: m[2] === "y" ? "Diizinkan" : "Ditolak" }).catch(() => {});
    p.finish(m[2] === "y", m[2] === "y" ? "" : "❌ Ditolak. Tidak ada yang diubah.");
  }

  async function status(chatId) {
    let models = [];
    let up = "✅ berjalan";
    try {
      models = await ollama.listModels();
    } catch (e) {
      up = `❌ ${e.message}`;
    }
    const has = models.includes(ollama.model) || models.some((x) => x.split(":")[0] === ollama.model && !ollama.model.includes(":"));
    return send(chatId, [`🤖 Model aktif: ${ollama.model}${models.length ? (has ? "" : "  ⚠️ belum diunduh (ollama pull " + ollama.model + ")") : ""}`, `Ollama: ${up}`, models.length ? `Model terpasang: ${models.join(", ")}` : "", `Mode: ${config.mode === "baca" ? "hanya membaca" : "tanya dulu sebelum mengubah"}`, `Folder izin: ${config.roots.join("; ")}`, `Folder kerja: ${config.workdir}`].filter(Boolean).join("\n"));
  }

  /** Pesan Telegram -> { doc: {file_id, file_name, file_size}, kind } untuk berkas/foto/video/audio/suara, atau null. */
  function incomingMedia(m) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (m.document) return { doc: m.document, kind: "berkas" };
    if (Array.isArray(m.photo) && m.photo.length) {
      const big = m.photo[m.photo.length - 1]; // ukuran terbesar
      return { doc: { file_id: big.file_id, file_size: big.file_size, file_name: `foto-${stamp}.jpg` }, kind: "foto" };
    }
    if (m.video) return { doc: { ...m.video, file_name: m.video.file_name || `video-${stamp}.mp4` }, kind: "video" };
    if (m.audio) return { doc: { ...m.audio, file_name: m.audio.file_name || `audio-${stamp}.mp3` }, kind: "audio" };
    if (m.voice) return { doc: { ...m.voice, file_name: `suara-${stamp}.ogg` }, kind: "pesan suara" };
    if (m.video_note) return { doc: { ...m.video_note, file_name: `video-bulat-${stamp}.mp4` }, kind: "video" };
    return null;
  }

  /** Dari keterangan "simpan ... di folder <nama>" -> alamat folder tujuan (harus ketemu persis & tunggal di folder izin), atau null. */
  function destinationFromCaption(caption) {
    const m = /\b(?:folder|direktori|map)\s+(.+?)\s*$/i.exec(String(caption || "").trim());
    if (!m) return null;
    const words = m[1].replace(/["'“”]/g, "").split(/\s+/).filter(Boolean);
    for (let i = 0; i < Math.min(words.length, 4); i++) {
      const hits = findDirsByName(config, words.slice(i).join(" "));
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return null; // ambigu: pakai _masuk
    }
    return null;
  }

  async function saveIncoming(chatId, doc, caption = "", kind = "berkas") {
    if (Number(doc.file_size) > 20 * 1024 * 1024) return send(chatId, "Berkas lebih dari 20 MB; batas unduhan bot Telegram.");
    const wantDir = /^\/?kembali(?:kan)?\s/i.test(String(caption || "").trim()) ? null : destinationFromCaption(caption);
    const dir = wantDir || path.join(config.workdir, "_masuk");
    const base = path.basename(doc.file_name || `berkas-${Date.now()}`).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    let dest = path.join(dir, base);
    if (!isInside(dir, dest)) return send(chatId, "Nama berkas tidak valid.");
    if (wantDir) {
      try {
        resolveInRoots(dest, config); // tujuan wajib di dalam folder izin dan bukan berkas rahasia
      } catch (e) {
        return send(chatId, `⚠️ ${e.message}`);
      }
    }
    const buf = await download(doc.file_id);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(dest)) dest = path.join(dir, `${Date.now()}-${base}`);
    fs.writeFileSync(dest, buf);
    // Berkas ini versi baru dari berkas yang tadi dikirim ke Telegram? (nama sama, atau keterangan "kembalikan <nama>")
    const capName = /^\/?kembali(?:kan)?\s+(.+)$/i.exec(String(caption || "").trim())?.[1]?.trim();
    const entry = lookupSent(config.workdir, capName || base);
    if (!entry && /\.xlsx$/i.test(dest) && !/^\/?kembali(?:kan)?\s/i.test(String(caption || "").trim())) {
      const daftar = parseDaftar(buf);
      if (daftar) {
        simpanAntrian(config.workdir, { berkas: path.basename(dest), rows: daftar.rows });
        await send(chatId, `📥 Disimpan: ${dest}`);
        return send(chatId, `${ringkasan(daftar, path.basename(dest))}\n\nAntrian tersimpan (${daftar.rows.length} baris, belum ada yang dikirim ke SAKTI). ${sakti ? "Langkah berikutnya: /sakti masuk" : ""}`);
      }
    }
    if (!entry) {
      const wordedFolder = /\b(?:folder|direktori|map)\b/i.test(String(caption || ""));
      const lines = [wantDir ? `📥 Disimpan di folder yang kamu sebut: ${dest}` : `📥 Disimpan: ${dest}`];
      if (kind === "foto") lines.push("(Foto lewat Telegram sudah dikompres; kirim sebagai File/Dokumen bila butuh kualitas aslinya.)");
      if (wordedFolder && !wantDir && !/^\/?kembali(?:kan)?\s/i.test(String(caption || "").trim())) lines.push("Folder yang kamu sebut tidak ketemu (atau ada beberapa yang bernama sama), jadi kusimpan di _masuk. Tulis nama folder persisnya.");
      if (kind === "berkas") lines.push(`Sekarang bisa kamu suruh, mis. "ringkas file ${path.basename(dest)}".`);
      if (listSent(config.workdir, 1).length) lines.push("", "Bila ini hasil editan berkas yang tadi kukirim dan ingin menggantikan yang asli, kirim ulang dengan keterangan: kembalikan <nama berkas asli>");
      return send(chatId, lines.join("\n"));
    }
    return offerReturn(chatId, dest, entry);
  }

  const SEND_RE = /^\s*(?:tolong\s+|coba\s+)?kirim(?:kan)?\s+(?:file|berkas|dokumen)\s+(.+?)\s*(?:ke\s+(?:sini|telegram|chat(?:\s+ini)?)|lewat\s+telegram)?\s*$/i;

  /** true bila permintaan sudah ditangani di sini; false = serahkan ke model. */
  async function directSend(chatId, text) {
    const m = SEND_RE.exec(text);
    if (!m) return false;
    const name = m[1].replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
    if (!name || name.length > 260) return false;
    let target = null;
    try {
      const p = resolveInRoots(name, config);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) target = p;
    } catch {}
    if (!target) {
      const hits = findFilesByName(config, name);
      if (hits.length === 0) return false; // tidak ketemu: biar model yang menjawab/mencari
      if (hits.length > 1) {
        const exact = hits.filter((h) => path.basename(h).toLowerCase() === name.toLowerCase());
        if (exact.length === 1) target = exact[0];
        else {
          await send(chatId, `Ada ${hits.length}${hits.length >= 10 ? "+" : ""} berkas yang cocok dengan "${name}". Tulis ulang dengan alamat lengkap, mis. "kirim file ${hits[0]}":\n\n${hits.map((h, i) => `${i + 1}. ${h}`).join("\n")}`);
          return true;
        }
      } else target = hits[0];
    }
    try {
      await send(chatId, `📤 Mengirim ${path.basename(target)}…`);
      const out = await tools.get("kirim_file").run({ file: target });
      log.log?.(`kirim langsung: ${target}`);
      await send(chatId, `✅ ${out}`);
      return true;
    } catch (e) {
      await send(chatId, `⚠️ ${e.message}`);
      return true;
    }
  }

  async function offerReturn(chatId, src, entry) {
    if (config.mode === "baca") return send(chatId, `📥 Disimpan: ${src}\nMode hanya-baca aktif, jadi tidak bisa menggantikan berkas asli.`);
    let plan;
    try {
      plan = planReturn({ workdir: config.workdir, roots: config.roots, src, entry });
    } catch (e) {
      return send(chatId, `📥 Disimpan: ${src}\n⚠️ Tidak bisa dikembalikan ke lokasi asal: ${e.message}`);
    }
    await send(chatId, `📥 Disimpan: ${src}`);
    const summary = [`Mengganti berkas asli dengan versi yang baru kamu kirim:`, `${src}`, `→ ${plan.dest}`, `Berkas asli dicadangkan dulu ke _sampah (bisa dikembalikan).`, ...plan.warnings].join("\n");
    const ok = await askApproval(chatId, summary, null);
    if (!ok) return;
    try {
      const r = applyReturn({ workdir: config.workdir, roots: config.roots, src, entry });
      return send(chatId, `✅ Sudah diganti: ${r.dest}${r.backup ? `\nCadangan berkas lama: ${r.backup}` : ""}`);
    } catch (e) {
      return send(chatId, `⚠️ Gagal mengganti: ${e.message}`);
    }
  }

  let saktiBusy = false;
  async function saktiCommand(chatId, arg) {
    if (!sakti) return void (await send(chatId, "Fitur SAKTI tidak aktif di cara menjalankan ini."));
    const sub = (arg || "").split(/\s+/)[0].toLowerCase();
    const io = { say: (t) => send(chatId, t), photo: (b, c) => sendPhoto(chatId, b, c), ask: (p) => ask(chatId, p) };
    if (!sub || sub === "bantuan") {
      const q = bacaAntrian(config.workdir);
      return void (await send(chatId, ["SAKTI:", "/sakti masuk — buka SAKTI di komputer ini dan login (captcha & kode MFA kamu balas lewat chat)", "/sakti halaman — foto + daftar kolom/tombol halaman yang sedang terbuka", "/sakti foto — tangkapan layar saja", "/sakti antrian — baris dari Excel yang menunggu", "/sakti tutup — tutup peramban", "", `Peramban: ${sakti.terbuka ? "terbuka" : "belum dibuka"}. Antrian: ${q ? `${q.rows.length} baris dari ${q.berkas}` : "kosong"}.`, "Catatan: captcha tidak dipecahkan otomatis; gambarnya dikirim ke kamu untuk dibaca."].join("\n")));
    }
    if (sub === "antrian") {
      const q = bacaAntrian(config.workdir);
      if (!q) return void (await send(chatId, "Antrian kosong. Kirim berkas Excel (COA Sakti | Uraian | Jumlah) ke chat ini."));
      return void (await send(chatId, `Antrian dari ${q.berkas}:\n` + q.rows.map((r) => `${r.no}. [${r.status}] akun ${r.akun} · Rp ${Math.round(r.jumlah || 0).toLocaleString("id-ID")} · ${r.uraian.slice(0, 70)}`).join("\n")));
    }
    if (sub === "tutup") return void (await send(chatId, (await sakti.tutup()) ? "Peramban ditutup." : "Peramban memang belum dibuka."));
    if (!["masuk", "halaman", "foto"].includes(sub)) return void (await send(chatId, "Perintah SAKTI tidak dikenal. Kirim /sakti untuk daftar perintah."));
    if (saktiBusy) return void (await send(chatId, "Masih ada proses SAKTI berjalan. Selesaikan dulu atau balas /batal."));
    saktiBusy = true;
    try {
      if (sub === "masuk") await sakti.masuk(io);
      else if (sub === "halaman") await sakti.halaman(io);
      else await sakti.foto(io);
    } catch (e) {
      log.error?.(`sakti gagal: ${e?.stack || e}`);
      await send(chatId, `⚠️ ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
    } finally {
      saktiBusy = false;
    }
  }

  async function runAgent(chatId, text) {
    let statusId = null;
    let lastStatus = "";
    const sendTyping = () => api("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    sendTyping();
    const typing = setInterval(sendTyping, 4500);
    typing.unref?.();
    const io = {
      approve: (summary, tool, state) => askApproval(chatId, summary, state),
      status: (t) => {
        if (t === lastStatus) return;
        lastStatus = t;
        if (statusId) api("editMessageText", { chat_id: chatId, message_id: statusId, text: t }).catch(() => {});
        else send(chatId, t).then((m) => (statusId = m?.message_id ?? null)).catch(() => {});
      }
    };
    try {
      const out = await agent.ask(chatId, text, io);
      if (out.busy) return void (await send(chatId, out.reply));
      await send(chatId, out.reply || "(tidak ada jawaban)");
    } catch (e) {
      log.error?.(`agent gagal: ${e?.stack || e}`);
      await send(chatId, `⚠️ ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
    } finally {
      clearInterval(typing);
      if (statusId) api("deleteMessage", { chat_id: chatId, message_id: statusId }).catch(() => {});
    }
  }

  async function handleMessage(m) {
    const chatId = String(m.chat.id);
    const isPrivate = m.chat.type === "private";
    if (!owners.size) {
      if (isPrivate) await send(chatId, `Id Telegram-mu: ${m.from?.id ?? chatId}\n\nIsi TELEGRAM_OWNER_IDS=${m.from?.id ?? chatId} di berkas .env, lalu jalankan ulang bot. Sebelum itu bot tidak menjalankan apa pun.`).catch(() => {});
      return;
    }
    if (!isPrivate || !owners.has(chatId) || !owners.has(String(m.from?.id))) {
      log.warn?.(`pesan dari chat ${chatId} diabaikan (bukan pemilik)`);
      return;
    }
    const w = waiters.get(chatId);
    if (w && typeof m.text === "string" && m.text.trim()) {
      const t = m.text.trim();
      waiters.delete(chatId);
      clearTimeout(w.timer);
      if (/^\/batal\b/i.test(t)) {
        w.resolve(null);
        return;
      }
      if (!t.startsWith("/")) {
        w.resolve(t);
        return;
      }
      w.resolve(null); // perintah lain membatalkan penantian, lalu diproses seperti biasa
    }
    const media = incomingMedia(m);
    if (media) return void (await saveIncoming(chatId, media.doc, m.caption, media.kind).catch((e) => send(chatId, `⚠️ ${e.message}`)));
    const text = typeof m.text === "string" ? m.text.trim() : "";
    if (!text) return void (await send(chatId, "Aku membaca pesan teks, berkas, foto, video, dan suara. Tulis permintaanmu."));
    const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    if (cmd) {
      const name = cmd[1].toLowerCase();
      const arg = (cmd[2] || "").trim();
      if (name === "start" || name === "help") return void (await send(chatId, HELP));
      if (name === "id") return void (await send(chatId, `Id chat ini: ${chatId}`));
      if (name === "baru") {
        agent.reset(chatId);
        return void (await send(chatId, "Oke, percakapan baru. Konteks sebelumnya dilupakan."));
      }
      if (name === "batal") return void (await send(chatId, agent.cancel(chatId) ? "🛑 Dihentikan setelah langkah ini selesai." : "Tidak ada tugas yang berjalan."));
      if (name === "status") return void (await status(chatId));
      if (name === "ulang") {
        if (!onRestart) return void (await send(chatId, "Mulai-ulang tidak tersedia di cara menjalankan ini."));
        if (agent.isRunning?.(chatId)) return void (await send(chatId, "Masih ada tugas berjalan. Kirim /batal dulu, lalu /ulang."));
        try {
          fs.mkdirSync(config.workdir, { recursive: true });
          fs.writeFileSync(path.join(config.workdir, "_ulang.json"), JSON.stringify({ chatId, at: Date.now() }), "utf8"); // supaya setelah menyala lagi bot memberi kabar
        } catch {}
        await send(chatId, "🔄 Memulai ulang… (kembali dalam ±10 detik bila dijalankan lewat pm2, start.bat, atau start.sh)");
        // putaran polling sudah meminta pembaruan berikutnya (offset naik), jadi Telegram menganggap /ulang ini terbaca;
        // jeda sebentar supaya permintaan itu sempat terkirim sebelum proses berhenti (kalau tidak, /ulang akan diulang terus)
        stopped = true;
        setTimeout(onRestart, restartDelayMs);
        return;
      }
      if (name === "sakti") return void (await saktiCommand(chatId, arg));
      if (name === "model") {
        if (!arg) return void (await send(chatId, `Model aktif: ${ollama.model}\nGanti: /model qwen2.5:3b (lebih cepat) atau /model qwen2.5:7b. Model harus sudah diunduh: ollama pull <nama>`));
        if (!/^[\w.\-:/]{1,80}$/.test(arg)) return void (await send(chatId, "Nama model tidak valid."));
        ollama.setModel(arg);
        return void (await send(chatId, `Model diganti ke ${arg} (sampai bot dijalankan ulang). Cek /status bila belum diunduh.`));
      }
      return void (await send(chatId, `Perintah /${name} tidak dikenal.\n\n${HELP}`));
    }
    // "kirim file <nama atau alamat> [ke sini]" dikerjakan langsung (tanpa model): model kecil sering salah memilih alat
    if (tools && !agent.isRunning?.(chatId)) {
      const handled = await directSend(chatId, text).catch((e) => {
        log.warn?.(`kirim langsung gagal: ${e.message}`);
        return false;
      });
      if (handled) return;
    }
    // JANGAN ditunggu: persetujuan datang sebagai pembaruan lain saat tugas masih berjalan
    void runAgent(chatId, text);
  }

  async function handleUpdate(u) {
    try {
      if (u.callback_query) return await handleCallback(u.callback_query);
      if (u.message?.chat) return await handleMessage(u.message);
    } catch (e) {
      log.error?.(`gagal memproses pesan: ${e?.stack || e}`);
    }
  }

  async function poll() {
    let backoff = 2000;
    while (!stopped) {
      try {
        const updates = await api("getUpdates", { offset, timeout: pollTimeoutSec, allowed_updates: ["message", "callback_query"] }, { timeoutMs: (pollTimeoutSec + 15) * 1000 });
        backoff = 2000;
        for (const u of updates) {
          offset = Math.max(offset, u.update_id + 1);
          void handleUpdate(u);
        }
      } catch (e) {
        if (stopped) break;
        log.warn?.(`Telegram: ${e.message}; coba lagi ${Math.round(backoff / 1000)} dtk`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  return {
    handleUpdate,
    sendFile,
    send,
    sendPhoto,
    pendingCount: () => pending.size,
    async start() {
      const me = await api("getMe", {});
      log.log?.(`🤖 Bot Telegram @${me.username} siap.`);
      try {
        const mark = path.join(config.workdir, "_ulang.json");
        if (fs.existsSync(mark)) {
          const m = JSON.parse(fs.readFileSync(mark, "utf8"));
          fs.rmSync(mark, { force: true });
          if (m?.chatId && owners.has(String(m.chatId)) && Date.now() - Number(m.at) < 10 * 60_000) {
            await send(m.chatId, `✅ Agen menyala kembali (model ${ollama.model}). Memulai ulang memakan ${Math.max(1, Math.round((Date.now() - Number(m.at)) / 1000))} detik.`);
          }
        }
      } catch {}
      await api("setMyCommands", { commands: [{ command: "status", description: "Kondisi agent dan model" }, { command: "baru", description: "Lupakan percakapan" }, { command: "batal", description: "Hentikan tugas" }, { command: "model", description: "Lihat/ganti model" }, { command: "sakti", description: "Buka/kendalikan SAKTI" }, { command: "ulang", description: "Mulai ulang agen" }, { command: "help", description: "Bantuan" }] }).catch(() => {});
      void poll();
    },
    stop() {
      stopped = true;
    }
  };
}
