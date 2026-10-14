// Diskusi dengan AI tentang SATU materi: panel yang naik dari bawah layar.
// Percakapan hanya hidup di memori browser (tidak disimpan di database); riwayat dikirim ke server tiap giliran.
// Bagian atas file = fungsi murni (diuji di wa-bot/test-mat-chat.mjs); bagian bawah = panel DOM.

export const CHAT_QUESTION_MAX = 600; // sama dengan MATERIAL_CHAT_QUESTION_MAX di server
export const CHAT_TURN_MAX = 1500; // sama dengan MATERIAL_CHAT_TURN_MAX di server
export const CHAT_HISTORY_MAX = 16; // 8 giliran tanya-jawab
export const CHAT_SUGGESTION_KEYS = ["study_mchat_sg1", "study_mchat_sg2", "study_mchat_sg3", "study_mchat_sg4"];

export function newChat(materialId) {
  return { materialId: String(materialId || ""), turns: [], busy: false, draft: "", error: "", remaining: null };
}

// Pertanyaan siap kirim: spasi dirapikan, dipotong ke batas server. "" = kosong (jangan dikirim).
export function cleanQuestion(v) {
  return String(v ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, CHAT_QUESTION_MAX);
}

// Riwayat yang dikirim ke server: giliran terakhir saja, tiap giliran dipotong ke batas server.
export function chatHistoryPayload(turns) {
  if (!Array.isArray(turns)) return [];
  const out = [];
  for (const t of turns) {
    if (!t || (t.role !== "user" && t.role !== "ai")) continue;
    const text = String(t.text ?? "").trim().slice(0, CHAT_TURN_MAX);
    if (text) out.push({ role: t.role, text });
  }
  return out.slice(-CHAT_HISTORY_MAX);
}

// Terapkan hasil panggilan server ke percakapan. Gagal = pertanyaan dikembalikan ke kotak ketik supaya tidak hilang.
export function applyChatResult(chat, question, res, errMessage) {
  chat.busy = false;
  if (res && res.ok && typeof res.reply === "string" && res.reply.trim()) {
    chat.turns.push({ role: "ai", text: res.reply.trim() });
    chat.error = "";
    chat.remaining = Number.isFinite(res.remaining) ? res.remaining : chat.remaining;
    return true;
  }
  const last = chat.turns[chat.turns.length - 1];
  if (last && last.role === "user" && last.text === question) chat.turns.pop();
  chat.draft = question;
  chat.error = errMessage || "Error";
  return false;
}

// Jumlah giliran tanya-jawab yang masih "diingat" AI (untuk petunjuk di layar).
export const chatRemembered = (turns) => Math.ceil(chatHistoryPayload(turns).length / 2);

// ---------------------------------------------------------------- panel (DOM)
// deps: { L, esc, renderMd(text)->html, typeset(el), getChat()->chat|null, getTitle()->string,
//         ask(question, history)->Promise<res>, errText(res)->string, onReset?() }
export function createMatChatSheet(deps) {
  const { L, esc } = deps;
  let dlg = null;
  let shownChat = null; // percakapan yang sekarang tergambar di log (ganti = gambar ulang dari nol)

  const q = (sel) => (dlg ? dlg.querySelector(sel) : null);

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "study-sheet";
    dlg.setAttribute("aria-labelledby", "study-sheet-title");
    dlg.tabIndex = -1;
    dlg.innerHTML = `
      <div class="study-sheet-grab" aria-hidden="true"></div>
      <header class="study-sheet-head">
        <div class="study-sheet-titles"><strong id="study-sheet-title">${esc(L("study_mchat_title"))}</strong><span class="study-sheet-sub" data-sheet-sub></span></div>
        <button type="button" class="study-sheet-btn" data-sheet="new">${esc(L("study_mchat_new"))}</button>
        <button type="button" class="study-sheet-close" data-sheet="close" aria-label="${esc(L("study_mchat_close"))}">&times;</button>
      </header>
      <div class="study-sheet-log" data-sheet-log role="log" aria-live="polite"></div>
      <p class="study-sheet-error" data-sheet-error role="alert" hidden></p>
      <p class="study-sheet-note" data-sheet-note></p>
      <form class="study-sheet-composer" data-sheet-form>
        <textarea rows="1" maxlength="${CHAT_QUESTION_MAX}" data-sheet-input placeholder="${esc(L("study_mchat_ph"))}" aria-label="${esc(L("study_mchat_ph"))}" autocomplete="off" autocapitalize="sentences"></textarea>
        <button type="submit" class="primary-btn" data-sheet-send>${esc(L("study_mchat_send"))}</button>
      </form>`;
    document.body.appendChild(dlg);

    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) return close(); // klik area gelap di luar panel
      const btn = e.target.closest("[data-sheet]");
      if (btn) {
        if (btn.dataset.sheet === "close") close();
        else if (btn.dataset.sheet === "new") reset();
        return;
      }
      const chip = e.target.closest("[data-chip]");
      if (chip) send(chip.dataset.text || "");
    });
    dlg.addEventListener("cancel", () => {
      /* Esc: biarkan menutup; percakapan tetap disimpan selama masih di halaman materi */
    });
    q("[data-sheet-form]").addEventListener("submit", (e) => {
      e.preventDefault();
      send(q("[data-sheet-input]").value);
    });
    const input = q("[data-sheet-input]");
    input.addEventListener("input", () => {
      const chat = deps.getChat();
      if (chat) chat.draft = input.value;
      grow(input);
    });
    input.addEventListener("keydown", (e) => {
      // Komputer: Enter kirim, Shift+Enter baris baru. HP: Enter = baris baru (kirim lewat tombol).
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const desktop = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
      if (desktop || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        send(input.value);
      }
    });
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", fit);
      vv.addEventListener("scroll", fit);
    }
  }

  function grow(input) {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  // Papan ketik HP menutupi sebagian layar: panel diturunkan/diperpendek mengikuti area yang benar-benar terlihat.
  function fit() {
    if (!dlg || !dlg.open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const gap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    dlg.style.bottom = gap ? `${gap}px` : "";
    dlg.style.setProperty("--sheet-h", `${Math.round(Math.min(vv.height * 0.88, 640))}px`);
  }

  function bubble(turn) {
    const el = document.createElement("div");
    if (turn.role === "ai") {
      el.className = "study-chat-msg is-ai";
      el.innerHTML = `<div class="study-speak-who">${esc(L("study_mchat_ai"))}</div><div class="study-chat-bubble chat-md">${deps.renderMd(turn.text)}</div>`;
    } else {
      el.className = "study-chat-msg is-user";
      el.innerHTML = `<div class="study-chat-bubble"></div>`;
      el.querySelector(".study-chat-bubble").textContent = turn.text; // teks pengguna: tidak pernah jadi HTML
    }
    return el;
  }

  // scroll: "end" (ke dasar) | "reply" (awal jawaban terbaru, supaya jawaban panjang dibaca dari atas) | "" (biarkan)
  function paint(scroll = "") {
    if (!dlg) return;
    const chat = deps.getChat();
    if (!chat) return;
    const log = q("[data-sheet-log]");
    const input = q("[data-sheet-input]");
    const send = q("[data-sheet-send]");
    q("[data-sheet-sub]").textContent = deps.getTitle();
    if (shownChat !== chat) {
      log.innerHTML = "";
      shownChat = chat;
    }
    // sinkronkan gelembung dengan giliran (hanya menambah di ujung / membuang yang terakhir)
    log.querySelectorAll("[data-transient]").forEach((n) => n.remove());
    const msgs = [...log.querySelectorAll(":scope > .study-chat-msg")];
    while (msgs.length > chat.turns.length) msgs.pop().remove();
    const fresh = [];
    for (let i = msgs.length; i < chat.turns.length; i++) {
      const el = bubble(chat.turns[i]);
      log.appendChild(el);
      fresh.push(el);
    }
    if (!chat.turns.length && !chat.busy) {
      const empty = document.createElement("div");
      empty.className = "study-chat-empty";
      empty.dataset.transient = "1";
      empty.innerHTML = `<p>${esc(L("study_mchat_empty"))}</p><div class="study-chat-chips"></div>`;
      const box = empty.querySelector(".study-chat-chips");
      for (const key of CHAT_SUGGESTION_KEYS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "study-chat-chip";
        b.dataset.chip = "1";
        b.dataset.text = L(key);
        b.textContent = L(key);
        box.appendChild(b);
      }
      log.appendChild(empty);
    }
    if (chat.busy) {
      const th = document.createElement("div");
      th.className = "study-chat-msg is-ai is-thinking";
      th.dataset.transient = "1";
      th.innerHTML = `<div class="study-chat-bubble"><span class="study-chat-dots" aria-hidden="true"><i></i><i></i><i></i></span> ${esc(L("study_mchat_thinking"))}</div>`;
      log.appendChild(th);
    }
    const err = q("[data-sheet-error]");
    err.hidden = !chat.error;
    err.textContent = chat.error || "";
    const note = q("[data-sheet-note]");
    const left = chat.remaining;
    note.textContent = typeof left === "number" && left <= 10 ? L("study_mchat_remaining", { n: left }) : L("study_mchat_note");
    input.disabled = chat.busy;
    send.disabled = chat.busy;
    if (input.value !== (chat.draft || "")) input.value = chat.draft || "";
    grow(input);
    for (const el of fresh) if (el.classList.contains("is-ai")) deps.typeset(el);
    if (scroll === "end" || chat.busy) log.scrollTop = log.scrollHeight;
    else if (scroll === "reply" && fresh.length) log.scrollTop = Math.max(0, fresh[fresh.length - 1].offsetTop - log.offsetTop - 4);
  }

  async function send(raw) {
    const chat = deps.getChat();
    if (!chat || chat.busy) return;
    const question = cleanQuestion(raw);
    if (!question) return;
    const history = chatHistoryPayload(chat.turns);
    chat.turns.push({ role: "user", text: question });
    chat.draft = "";
    chat.error = "";
    chat.busy = true;
    const input = q("[data-sheet-input]");
    if (input) input.value = "";
    paint("end");
    let res;
    try {
      res = await deps.ask(question, history);
    } catch (e) {
      res = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    if (deps.getChat() !== chat) return; // pengguna sudah meninggalkan materi / mulai percakapan baru
    const ok = applyChatResult(chat, question, res, res && res.ok ? L("study_mchat_empty_reply") : deps.errText(res || {}));
    if (!dlg || !dlg.open) return;
    paint(ok ? "reply" : "end");
    if (input && window.matchMedia && window.matchMedia("(pointer: fine)").matches) input.focus();
  }

  function reset() {
    const chat = deps.getChat();
    if (!chat || chat.busy) return;
    chat.turns = [];
    chat.draft = "";
    chat.error = "";
    chat.remaining = null;
    paint("");
  }

  function open() {
    if (!dlg) build();
    if (!dlg.open) dlg.showModal();
    fit();
    paint("end");
    const input = q("[data-sheet-input]");
    const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    if (fine && input) input.focus();
    else dlg.focus();
  }

  function close() {
    if (dlg && dlg.open) dlg.close();
  }

  // Dipanggil saat meninggalkan materi / keluar akun: tutup dan lupakan gambar log.
  function destroy() {
    if (dlg) {
      if (dlg.open) dlg.close();
      dlg.remove();
      dlg = null;
    }
    shownChat = null;
  }

  return { open, close, paint, destroy, isOpen: () => !!(dlg && dlg.open) };
}
