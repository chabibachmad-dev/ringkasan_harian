// Tab "Class" di menu Study: PDF -> ringkasan AI -> "guru" pixel-art yang menjelaskan dengan suara; murid bertanya lewat suara/ketikan.
// Bagian atas file = fungsi murni (diuji di wa-bot/test-study-class-ui.mjs); bagian bawah = tampilan & suara (DOM).
import { applyChatResult, chatHistoryPayload, cleanQuestion, newChat } from "./study-matchat.js";
import { audioPlayable, playWav, recognitionSupported, recorderSupported, releaseMic, speakText, speechToken, startListening, startRecording, stopSpeaking } from "./study-voice.js";

export const CLASS_MAX_PDF_BYTES = 15 * 1024 * 1024; // PDF lebih besar ditolak di peramban
export const CLASS_SOURCE_LIMIT = 60000; // sama dengan CLASS_SOURCE_MAX di server

// ---------------------------------------------------------------- fungsi murni
const ID_WORDS = new Set(["yang", "dan", "di", "untuk", "dengan", "adalah", "pada", "dari", "ini", "itu", "dalam", "atau", "tidak", "akan", "ke", "saya", "kamu", "apa", "bagaimana", "kenapa", "mengapa"]);
const EN_WORDS = new Set(["the", "and", "of", "to", "is", "in", "that", "for", "with", "are", "this", "as", "on", "by", "be", "what", "how", "why", "you", "can"]);

/** Tebak bahasa teks pendek ("id" | "en"); `fallback` bila tidak jelas. Dipakai memilih suara perangkat cadangan. */
export function guessLang(text, fallback = "id") {
  const words = String(text || "").toLowerCase().match(/[a-z]+/g) || [];
  let id = 0;
  let en = 0;
  for (const w of words) {
    if (ID_WORDS.has(w)) id++;
    else if (EN_WORDS.has(w)) en++;
  }
  if (id === en) return fallback === "en" ? "en" : "id";
  return en > id ? "en" : "id";
}

/** Hash singkat untuk kunci cache suara (teks jawaban berbeda -> kunci berbeda). */
export function hashText(text) {
  let h = 5381;
  const t = String(text || "");
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Berkas yang dipilih layak dicoba? -> "" (ya) | kode galat: "notpdf" | "toobig" | "empty". */
export function checkPdfFile(file) {
  if (!file) return "empty";
  const name = String(file.name || "");
  const type = String(file.type || "");
  if (!(type === "application/pdf" || /\.pdf$/i.test(name))) return "notpdf";
  if (!(file.size > 0)) return "empty";
  if (file.size > CLASS_MAX_PDF_BYTES) return "toobig";
  return "";
}

/** Nomor bagian yang valid (0..n-1), atau -1 bila tidak ada bagian. */
export function clampIdx(i, n) {
  if (!(n > 0)) return -1;
  const x = Math.trunc(Number(i));
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(n - 1, x));
}

// ---------------------------------------------------------------- sprite guru (pixel art, 16x16)
// Setiap karakter = satu piksel. Lapisan mata/mulut terpisah supaya bisa dikedipkan / digerakkan lewat CSS.
const PALETTE = { H: "#5b3a29", S: "#f2c9a0", C: "#ffffff", B: "#3563c9", D: "#2a2a35", R: "#c0392b", M: "#7a1f2b", K: "#f0a3a3", W: "#ffffff" };
const BASE = [
  "................",
  ".....HHHHHH.....",
  "....HHHHHHHH....",
  "...HHHHHHHHHH...",
  "...HHSSSSSSHH...",
  "...HSSSSSSSSH...",
  "...HSSSSSSSSH...",
  "...HSSSSSSSSH...",
  "....SSSSSSSS....",
  "....SSSSSSSS....",
  ".....SSSSSS.....",
  "...CCCCSSCCCC...",
  "..BBBBBBBBBBBB..",
  ".BBBBBBBBBBBBBB.",
  ".BBBBBBBBBBBBBB.",
  ".BBBBBBBBBBBBBB."
];
// koordinat [x, y, warna]
const EYES_OPEN = [[5, 6, "D"], [5, 7, "D"], [10, 6, "D"], [10, 7, "D"], [6, 6, "W"], [9, 6, "W"]];
const EYES_CLOSED = [[4, 7, "D"], [5, 7, "D"], [10, 7, "D"], [11, 7, "D"]];
const CHEEKS = [[4, 8, "K"], [11, 8, "K"]];
const GLASSES = [[4, 5, "D"], [5, 5, "D"], [6, 5, "D"], [9, 5, "D"], [10, 5, "D"], [11, 5, "D"], [4, 8, "D"], [6, 8, "D"], [9, 8, "D"], [11, 8, "D"]];
const BOWTIE = [[6, 12, "R"], [7, 12, "R"], [8, 12, "R"], [9, 12, "R"]];
const MOUTH_CLOSED = [[7, 9, "M"], [8, 9, "M"]];
const MOUTH_OPEN = [[7, 9, "M"], [8, 9, "M"], [7, 10, "M"], [8, 10, "M"]];

function rects(px) {
  return px.map(([x, y, c]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[c]}"/>`).join("");
}

function baseRects() {
  const out = [];
  BASE.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === ".") {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++; // gabungkan piksel sewarna sebaris
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${PALETTE[ch]}"/>`);
      x += w;
    }
  });
  return out.join("");
}

/** SVG guru. Kelas CSS: .pt-eyes-open / .pt-eyes-closed (berkedip) dan .pt-mouth-closed / .pt-mouth-open (bicara). */
export function teacherSvg() {
  return `<svg class="pixel-teacher" viewBox="0 0 16 16" width="128" height="128" shape-rendering="crispEdges" role="img" aria-hidden="true" focusable="false">
    <g class="pt-body">${baseRects()}${rects(CHEEKS)}${rects(BOWTIE)}</g>
    <g class="pt-eyes-open">${rects(EYES_OPEN)}</g>
    <g class="pt-eyes-closed">${rects(EYES_CLOSED)}</g>
    <g class="pt-glasses">${rects(GLASSES)}</g>
    <g class="pt-mouth-closed">${rects(MOUTH_CLOSED)}</g>
    <g class="pt-mouth-open">${rects(MOUTH_OPEN)}</g>
  </svg>`;
}

export const TEACHER_PARTS = { EYES_OPEN, EYES_CLOSED, MOUTH_CLOSED, MOUTH_OPEN, BASE };

// ---------------------------------------------------------------- tampilan & suara (DOM)
// deps: { L, esc, renderMd(text)->html, typeset(el), $(id), call(action, params, opts)->Promise<res> (menambah playerId+pin),
//         signedIn()->bool, ensureSignedIn()->Promise<bool>, errText(res)->string, isOpen()->bool }
export function createClassroom(deps) {
  const { L, esc, $ } = deps;
  const MIC_LANGS = [["id", "ID"], ["en", "EN"]];
  let cs = null; // kelas yang sedang dibuka
  let ttsDownUntil = 0;
  const wavCache = new Map(); // kunci -> Promise<string|null>

  const micLocale = (l) => (l === "en" ? "en-US" : "id-ID");

  function fresh(meta) {
    return {
      id: meta.id,
      meta,
      summary: meta.summary || null,
      sections: Array.isArray(meta.sections) ? meta.sections : null,
      loading: !meta.summary,
      error: "",
      idx: 0,
      finished: false,
      playing: false,
      speaking: false,
      thinking: false,
      cap: null, // { head, text, tag } yang tampil di papan tulis
      status: "",
      chat: newChat(meta.id),
      round: 0,
      micLang: meta.lang === "en" ? "en" : "id",
      listening: false,
      transcribing: false,
      forceRecord: false,
      rec: null,
      micRound: 0
    };
  }

  // ---- suara
  function halt() {
    if (!cs) return;
    cs.round++;
    cs.playing = false;
    cs.speaking = false;
    stopSpeaking();
  }

  function markTtsDown(res) {
    const quota = !!(res && (res.ttsQuota || res.dailyLimit || res.status === 429));
    ttsDownUntil = Date.now() + (res && (res.ttsDaily || res.dailyLimit) ? 60 : quota ? 2 : 1) * 60_000;
    return quota;
  }

  function wavFor(key, params) {
    if (!deps.signedIn() || !audioPlayable() || Date.now() < ttsDownUntil) return Promise.resolve(null);
    if (wavCache.has(key)) return wavCache.get(key);
    const p = deps
      .call("class_tts", params, { timeoutMs: 20000 })
      .then((res) => {
        if (res.ok && res.audio) return res.audio;
        const quota = markTtsDown(res);
        if (cs) {
          cs.status = L(quota ? "study_cls_tts_quota" : "study_cls_tts_fail");
          paintLive();
        }
        return null;
      })
      .catch(() => null);
    wavCache.set(key, p);
    p.then((v) => v === null && wavCache.delete(key));
    if (wavCache.size > 40) wavCache.delete(wavCache.keys().next().value);
    return p;
  }

  // Ucapkan satu teks: suara server (Gemini) bila bisa, kalau tidak suara perangkat. onEnd dipanggil sekali saat selesai.
  function say({ key, params, text, lang, onEnd }) {
    stopSpeaking();
    const tok = speechToken();
    const mine = cs;
    const round = cs.round;
    let done = false;
    let watchdog = 0;
    const alive = () => cs === mine && mine.round === round && tok === speechToken();
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      if (cs !== mine || mine.round !== round) return;
      mine.speaking = false;
      paintLive();
      onEnd?.();
    };
    mine.speaking = true;
    paintLive();
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (alive()) finish();
      }, 8000 + Math.min(60_000, String(text || "").length * 90));
    };
    const fallback = () => {
      if (done || !alive()) return;
      arm();
      // tanpa suara sama sekali (peramban tanpa speechSynthesis): tahan sebentar seukuran waktu membaca, jangan melompat ke bagian berikutnya
      if (!speakText(text, { lang, rate: 0.98, onEnd: finish })) setTimeout(finish, 2000 + String(text || "").length * 55);
    };
    if (!deps.signedIn() || !audioPlayable() || Date.now() < ttsDownUntil) return fallback();
    let timedOut = false;
    const slow = setTimeout(() => {
      timedOut = true;
      ttsDownUntil = Date.now() + 2 * 60_000;
      fallback();
    }, 9000);
    mine.status = L("study_cls_voice_loading");
    paintLive();
    wavFor(key, params).then(async (wav) => {
      clearTimeout(slow);
      if (timedOut || done) return;
      if (mine.status === L("study_cls_voice_loading")) mine.status = "";
      if (!alive()) return;
      if (!wav) return fallback();
      arm();
      const ok = await playWav(wav, { onEnd: finish });
      if (!ok && alive()) {
        ttsDownUntil = Date.now() + 5 * 60_000;
        mine.status = L("study_cls_audio_blocked");
        fallback();
      }
      paintLive();
    });
  }

  function sectionAt(i) {
    return cs?.sections?.[i] || null;
  }

  function playSection(i) {
    if (!cs || !cs.sections) return;
    const n = cs.sections.length;
    if (i >= n) {
      cs.playing = false;
      cs.speaking = false;
      cs.finished = true;
      cs.cap = { head: L("study_cls_done_head"), text: L("study_cls_done"), tag: "" };
      return paintLive();
    }
    const idx = clampIdx(i, n);
    const sec = sectionAt(idx);
    cs.idx = idx;
    cs.playing = true;
    cs.finished = false;
    cs.round++;
    cs.cap = { head: sec.heading, text: sec.say, tag: L("study_cls_progress", { a: idx + 1, n }) };
    if (idx + 1 < n) wavFor(`${cs.id}:${idx + 1}`, { classId: cs.id, idx: idx + 1 }); // siapkan suara bagian berikutnya selagi ini berbunyi
    const round = cs.round;
    const mine = cs;
    say({
      key: `${cs.id}:${idx}`,
      params: { classId: cs.id, idx },
      text: sec.say,
      lang: mine.meta.lang,
      onEnd: () => {
        if (cs === mine && mine.round === round && mine.playing) playSection(idx + 1);
      }
    });
    paintLive();
  }

  function speakAnswer(turn, i) {
    if (!cs) return;
    halt();
    const text = turn.say || turn.text;
    cs.cap = { head: L("study_cls_answer_head"), text, tag: "" };
    cs.round++;
    say({ key: `a:${cs.id}:${hashText(text)}`, params: { text }, text, lang: guessLang(text, cs.meta.lang) });
    paintLive();
  }

  // ---- mikrofon
  function micError(code) {
    return code === "denied"
      ? L("study_speak_mic_denied")
      : code === "nospeech"
        ? L("study_speak_mic_nospeech")
        : code === "unsupported"
          ? L("study_speak_mic_unsupported")
          : code === "stalled"
            ? L("study_speak_mic_stuck")
            : L("study_speak_mic_error", { e: code });
  }

  function setDraft(text) {
    cs.chat.draft = text;
    const box = $("cls-input");
    if (box) box.value = text;
  }

  function micToggle() {
    if (!cs) return;
    if (cs.listening) {
      cs.rec?.stop();
      return;
    }
    if (cs.chat.busy || cs.transcribing) return;
    halt();
    const mode = recognitionSupported() && !cs.forceRecord ? "browser" : recorderSupported() ? "record" : "";
    if (!mode) {
      cs.status = L("study_speak_mic_unsupported");
      return paintLive();
    }
    cs.status = "";
    cs.listening = true;
    cs.micRound++;
    paintLive();
    if (mode === "browser") listenBrowser(cs);
    else listenRecord(cs);
  }

  function listenBrowser(mine) {
    const round = mine.micRound;
    let heard = "";
    let err = "";
    let switching = false;
    mine.rec = startListening({
      lang: micLocale(mine.micLang),
      onText: (txt) => {
        if (cs !== mine || mine.micRound !== round) return;
        heard = txt;
        setDraft(txt);
      },
      onError: (code) => {
        if (cs !== mine || mine.micRound !== round) return;
        err = code;
        if (code !== "nospeech" && code !== "denied" && recorderSupported()) {
          switching = true; // pengenalan suara peramban macet/gagal: pakai rekam + server
          mine.forceRecord = true;
        }
      },
      onEnd: () => {
        if (cs !== mine || mine.micRound !== round) return;
        mine.listening = false;
        mine.rec = null;
        releaseMic();
        if (switching) return micToggle();
        if (err && err !== "nospeech") mine.status = micError(err);
        else if (!heard) mine.status = L("study_speak_mic_nospeech");
        paintLive();
        if (heard) send();
      }
    });
  }

  function listenRecord(mine) {
    const round = mine.micRound;
    mine.rec = startRecording({
      onDone: async ({ wavBase64 }) => {
        if (cs !== mine || mine.micRound !== round) return;
        mine.listening = false;
        mine.rec = null;
        mine.transcribing = true;
        paintLive();
        if (!(await deps.ensureSignedIn())) {
          mine.transcribing = false;
          mine.status = L("study_mchat_login");
          return paintLive();
        }
        const res = await deps.call("class_transcribe", { audio: wavBase64, mime: "audio/wav" }, { timeoutMs: 40000 });
        if (cs !== mine || mine.micRound !== round) return;
        mine.transcribing = false;
        if (!res.ok) {
          mine.status = L("study_speak_stt_failed", { e: deps.errText(res) });
          return paintLive();
        }
        if (!res.text) {
          mine.status = L("study_speak_mic_nospeech");
          return paintLive();
        }
        setDraft(res.text);
        paintLive();
        send();
      },
      onError: (code) => {
        if (cs !== mine || mine.micRound !== round) return;
        mine.listening = false;
        mine.rec = null;
        mine.status = code === "nospeech" ? L("study_speak_mic_nospeech") : micError(code);
        paintLive();
      }
    });
  }

  function stopMic() {
    if (!cs) return;
    cs.micRound++;
    cs.listening = false;
    cs.transcribing = false;
    try {
      cs.rec?.stop();
    } catch {
      /* abaikan */
    }
    cs.rec = null;
    releaseMic();
  }

  // ---- tanya guru
  async function send() {
    const mine = cs;
    if (!mine || mine.chat.busy || !mine.summary) return;
    const q = cleanQuestion(mine.chat.draft);
    if (!q) return;
    if (!(await deps.ensureSignedIn())) {
      mine.status = L("study_mchat_login");
      return paintLive();
    }
    if (cs !== mine) return;
    halt();
    const history = chatHistoryPayload(mine.chat.turns);
    mine.chat.turns.push({ role: "user", text: q });
    mine.chat.draft = "";
    mine.chat.busy = true;
    mine.chat.error = "";
    mine.status = "";
    const box = $("cls-input");
    if (box) box.value = "";
    paintTurns();
    paintLive();
    const res = await deps.call("class_ask", { classId: mine.id, question: q, history }, { timeoutMs: 70000 });
    if (cs !== mine) return;
    const ok = applyChatResult(mine.chat, q, res, res.ok ? "" : deps.errText(res));
    if (ok) {
      const t = mine.chat.turns[mine.chat.turns.length - 1];
      t.say = String(res.say || "").trim();
      t.lang = res.lang === "en" ? "en" : "id";
      mine.chat.remaining = Number.isFinite(res.remaining) ? res.remaining : mine.chat.remaining;
    } else if (box) {
      box.value = mine.chat.draft;
    }
    paintTurns();
    paintLive();
    if (ok) speakAnswer(mine.chat.turns[mine.chat.turns.length - 1], mine.chat.turns.length - 1);
  }

  // ---- gambar
  function turnsHtml() {
    const c = cs.chat;
    const items = c.turns
      .map((t, i) =>
        t.role === "user"
          ? `<div class="cls-turn cls-turn--user"><div class="cls-turn-who">${esc(L("study_cls_you"))}</div><div class="cls-turn-body">${esc(t.text)}</div></div>`
          : `<div class="cls-turn cls-turn--ai"><div class="cls-turn-who">${esc(L("study_cls_teacher"))} <button type="button" class="study-link-btn" data-act="cls-replay" data-i="${i}">${esc(L("study_cls_replay_answer"))}</button></div><div class="cls-turn-body chat-md">${deps.renderMd(t.text)}</div></div>`
      )
      .join("");
    return `${items}${c.busy ? `<p class="status-text" role="status">${esc(L("study_cls_thinking"))}</p>` : ""}${c.error ? `<p class="study-warn" role="alert">${esc(c.error)}</p>` : ""}`;
  }

  function paintTurns() {
    const el = $("cls-turns");
    if (!el || !cs) return;
    el.innerHTML = turnsHtml();
    deps.typeset(el);
    const last = el.lastElementChild;
    if (last && cs.chat.turns.length) last.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  // Memperbarui bagian yang berubah-ubah tanpa menggambar ulang seluruh layar (kotak ketik tidak kehilangan isi/fokus).
  function paintLive() {
    if (!cs || !deps.isOpen()) return;
    const stage = $("cls-stage");
    if (stage) {
      stage.classList.toggle("is-speaking", !!cs.speaking);
      stage.classList.toggle("is-thinking", !!cs.chat.busy);
    }
    const cap = cs.cap || (cs.sections?.length ? { head: cs.sections[cs.idx]?.heading || "", text: L("study_cls_idle"), tag: "" } : { head: "", text: "", tag: "" });
    const set = (id, text) => {
      const el = $(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set("cls-cap-head", cap.head);
    set("cls-cap-text", cap.text);
    set("cls-cap-tag", cap.tag || "");
    set("cls-status", cs.status || (cs.listening ? L("study_cls_listening") : cs.transcribing ? L("study_cls_transcribing") : ""));
    const n = cs.sections?.length || 0;
    const play = $("cls-play");
    if (play) {
      play.textContent = cs.playing ? L("study_cls_pause") : cs.finished ? L("study_cls_replay") : cs.cap && cs.cap.tag ? L("study_cls_resume") : L("study_cls_play");
      play.disabled = !n;
    }
    const prev = $("cls-prev");
    if (prev) prev.disabled = !n || cs.idx <= 0;
    const next = $("cls-next");
    if (next) next.disabled = !n || cs.idx >= n - 1;
    document.querySelectorAll("#cls-sections [data-i]").forEach((b) => b.classList.toggle("is-on", Number(b.dataset.i) === cs.idx && (cs.playing || !!cs.cap)));
    const mic = $("cls-mic");
    if (mic) {
      mic.textContent = cs.listening ? L("study_speak_mic_stop") : cs.transcribing ? "…" : L("study_cls_mic");
      mic.classList.toggle("is-on", !!cs.listening);
      mic.disabled = !!cs.transcribing || !!cs.chat.busy;
    }
    const sendBtn = $("cls-send");
    if (sendBtn) sendBtn.disabled = !!cs.chat.busy || !!cs.transcribing;
    const rem = $("cls-remaining");
    if (rem) rem.textContent = cs.chat.remaining == null ? "" : L("study_cls_remaining", { n: cs.chat.remaining });
  }

  function render(body) {
    if (!cs) return;
    const m = cs.meta;
    if (cs.loading) {
      body.innerHTML = `<div class="study-card"><div class="study-row-title">${esc(m.title)}</div></div>${cs.error ? `<div class="study-card"><p>${esc(cs.error)}</p><button type="button" class="secondary-btn" data-act="cls-reload">${esc(L("study_reload"))}</button></div>` : `<p class="status-text">${esc(L("study_loading"))}</p>`}`;
      return;
    }
    const secs = (cs.sections || [])
      .map((s, i) => `<li><button type="button" class="cls-sec" data-act="cls-section" data-i="${i}"><span class="cls-sec-no">${i + 1}</span><span>${esc(s.heading)}</span></button></li>`)
      .join("");
    body.innerHTML = `
      <div class="study-card">
        <div class="study-row-title">${esc(m.title)}</div>
        <div class="study-row-meta">${esc(L("study_mat_by", { name: m.creatorName }))}${m.pageCount ? ` · ${esc(L("study_cls_pages", { n: m.pageCount }))}` : ""}${m.fileName ? ` · ${esc(m.fileName)}` : ""}</div>
      </div>
      <div class="cls-stage" id="cls-stage">
        <div class="cls-teacher">${teacherSvg()}</div>
        <div class="cls-board" aria-live="polite">
          <div class="cls-board-head"><span id="cls-cap-tag" class="cls-tag"></span><strong id="cls-cap-head"></strong></div>
          <p id="cls-cap-text" class="cls-cap-text"></p>
        </div>
      </div>
      <div class="cls-controls">
        <button type="button" class="secondary-btn" id="cls-prev" data-act="cls-prev">${esc(L("study_cls_prev"))}</button>
        <button type="button" class="primary-btn" id="cls-play" data-act="cls-play">${esc(L("study_cls_play"))}</button>
        <button type="button" class="secondary-btn" id="cls-next" data-act="cls-next">${esc(L("study_cls_next"))}</button>
      </div>
      <p class="study-hint" id="cls-status" role="status"></p>
      <div class="study-card cls-ask">
        <div class="study-expl-title">${esc(L("study_cls_ask_title"))}</div>
        <div id="cls-turns" class="cls-turns"></div>
        <div class="study-composer">
          <textarea id="cls-input" rows="2" maxlength="600" placeholder="${esc(L("study_cls_ask_ph"))}" aria-label="${esc(L("study_cls_ask_ph"))}">${esc(cs.chat.draft)}</textarea>
          <div class="cls-ask-actions">
            <select id="cls-mic-lang" aria-label="${esc(L("study_cls_mic_lang"))}" title="${esc(L("study_cls_mic_lang"))}">${MIC_LANGS.map(([v, l]) => `<option value="${v}" ${cs.micLang === v ? "selected" : ""}>${l}</option>`).join("")}</select>
            <button type="button" class="secondary-btn cls-mic" id="cls-mic" data-act="cls-mic">${esc(L("study_cls_mic"))}</button>
            <button type="button" class="primary-btn" id="cls-send" data-act="cls-send">${esc(L("study_cls_send"))}</button>
          </div>
          <small class="study-hint" id="cls-remaining"></small>
        </div>
      </div>
      <div class="study-card">
        <div class="study-expl-title">${esc(L("study_cls_summary"))}</div>
        <article class="study-material-body chat-md">${deps.renderMd(cs.summary)}</article>
        <p class="study-hint">${esc(L("study_cls_hint"))}</p>
      </div>
      <div class="study-card">
        <div class="study-expl-title">${esc(L("study_cls_sections"))}</div>
        <ol class="cls-sections" id="cls-sections">${secs}</ol>
      </div>`;
    const sel = $("cls-mic-lang");
    if (sel) sel.addEventListener("change", () => cs && (cs.micLang = sel.value === "en" ? "en" : "id"));
    paintTurns();
    paintLive();
  }

  return {
    /** Buka kelas (ringkasan boleh belum ada: dimuat lewat load()). */
    open(meta) {
      dispose();
      cs = fresh(meta);
    },
    current: () => cs,
    isLoading: () => !!cs?.loading,
    setLoaded(full) {
      if (!cs || cs.id !== full.id) return false;
      cs.meta = { ...cs.meta, ...full };
      cs.summary = full.summary;
      cs.sections = full.sections;
      cs.loading = false;
      cs.error = "";
      return true;
    },
    setError(id, message) {
      if (cs && cs.id === id) cs.error = message;
    },
    render,
    dispose,
    /** Penangan klik data-act="cls-*" (dipanggil dalam sentuhan pengguna). */
    async onAct(act, btn) {
      if (!cs) return;
      if (act === "cls-play") {
        if (cs.playing) {
          halt();
          cs.status = "";
          return paintLive();
        }
        if (!deps.signedIn()) await deps.ensureSignedIn(); // suara guru alami butuh masuk; tanpa itu dipakai suara perangkat
        if (!cs) return;
        return playSection(cs.finished ? 0 : cs.idx);
      }
      if (act === "cls-prev" || act === "cls-next") {
        const n = cs.sections?.length || 0;
        const to = clampIdx(cs.idx + (act === "cls-next" ? 1 : -1), n);
        halt();
        return playSection(to);
      }
      if (act === "cls-section") {
        halt();
        return playSection(clampIdx(btn.dataset.i, cs.sections?.length || 0));
      }
      if (act === "cls-mic") return micToggle();
      if (act === "cls-send") return send();
      if (act === "cls-replay") {
        const i = Number(btn.dataset.i);
        const t = cs.chat.turns[i];
        if (t && t.role === "ai") return speakAnswer(t, i);
      }
    },
    onInput(target) {
      if (cs && target.id === "cls-input") cs.chat.draft = target.value;
    },
    /** Enter (tanpa Shift) di kotak ketik = kirim. */
    onKey(e) {
      if (cs && e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target?.id === "cls-input") {
        e.preventDefault();
        send();
        return true;
      }
      return false;
    }
  };

  function dispose() {
    if (!cs) return;
    stopMic();
    halt();
    releaseMic();
    cs = null;
  }
}
