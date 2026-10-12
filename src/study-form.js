// Mesin formulir kecil untuk popup di menu Study (pemain baru, PIN, pelajaran baru, hukuman, dll.).
// Tiap panggilan membuat <dialog> sendiri, jadi popup bisa bertumpuk (mis. "Reset PIN" dari popup pelajaran).
//
// openFormDialog({
//   title, intro, okLabel, cancelLabel, busyLabel,
//   fields: [{ key, label, type: "text"|"pin"|"number"|"select"|"textarea"|"note",
//              value, options, placeholder, maxlength, min, max, rows, help,
//              show: (values) => bool }],
//   // options / help boleh berupa fungsi (values) => ...; onOptionsChange(values) => nilai pilihan saat daftar opsi berubah
//   extra: [{ label, onClick(values) }],          // tombol tambahan di bawah isian
//   onSubmit: async (values) => ({ ok: true, value? }) | ({ ok: false, error })
// }) -> Promise: nilai hasil onSubmit (value ?? values) bila berhasil, null bila dibatalkan.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const val = (x, values) => (typeof x === "function" ? x(values) : x);

export function openFormDialog(cfg) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "chat-code-dialog study-dialog";
    const form = document.createElement("form");
    form.className = "chat-code-form-modal";
    form.noValidate = true;
    dlg.appendChild(form);

    const fields = cfg.fields || [];
    const els = new Map(); // key -> { wrap, input, help }
    let busy = false;
    let done = false;

    const h = document.createElement("h2");
    h.textContent = cfg.title || "";
    form.appendChild(h);
    if (cfg.intro) {
      const p = document.createElement("p");
      p.textContent = cfg.intro;
      form.appendChild(p);
    }

    const current = () => {
      const v = {};
      for (const f of fields) {
        const e = els.get(f.key);
        if (!e || !e.input) continue;
        v[f.key] = f.type === "number" ? (e.input.value === "" ? null : Number(e.input.value)) : e.input.value;
      }
      return v;
    };

    for (const f of fields) {
      const wrap = document.createElement("label");
      wrap.className = "study-field";
      if (f.type === "note") {
        wrap.innerHTML = `<span class="study-note"></span>`;
        form.appendChild(wrap);
        els.set(f.key, { wrap, input: null, help: wrap.firstChild, f });
        continue;
      }
      const caption = document.createElement("span");
      caption.className = "study-field-label";
      caption.textContent = f.label || "";
      wrap.appendChild(caption);

      let input;
      if (f.type === "select") {
        input = document.createElement("select");
      } else if (f.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = f.rows || 3;
      } else {
        input = document.createElement("input");
        if (f.type === "pin") {
          input.type = "password";
          input.inputMode = "numeric";
          input.pattern = "[0-9]*";
          input.maxLength = 6;
          input.autocomplete = "off";
        } else if (f.type === "number") {
          input.type = "number";
          input.inputMode = "numeric";
          if (f.min !== undefined) input.min = String(f.min);
          if (f.max !== undefined) input.max = String(f.max);
        } else {
          input.type = "text";
          input.autocomplete = "off";
        }
        if (f.maxlength) input.maxLength = f.maxlength;
      }
      if (f.placeholder) input.placeholder = f.placeholder;
      wrap.appendChild(input);
      const help = document.createElement("span");
      help.className = "study-field-help";
      wrap.appendChild(help);
      form.appendChild(wrap);
      els.set(f.key, { wrap, input, help, f });
      if (f.type !== "select" && f.value !== undefined && f.value !== null) input.value = String(f.value);
    }

    const errorEl = document.createElement("p");
    errorEl.className = "chat-code-error";
    errorEl.hidden = true;
    form.appendChild(errorEl);

    const extraBox = document.createElement("div");
    extraBox.className = "study-extra";
    for (const x of cfg.extra || []) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "study-link-btn";
      b.textContent = x.label;
      b.addEventListener("click", () => {
        if (!busy) x.onClick(current());
      });
      extraBox.appendChild(b);
    }
    if (extraBox.childElementCount) form.appendChild(extraBox);

    const actions = document.createElement("div");
    actions.className = "chat-code-dialog-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary-btn";
    cancelBtn.textContent = cfg.cancelLabel || "Batal";
    const okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.className = "primary-btn";
    okBtn.textContent = cfg.okLabel || "OK";
    actions.append(cancelBtn, okBtn);
    form.appendChild(actions);

    // Hitung ulang bagian dinamis (tampil/sembunyi, opsi select, teks bantuan).
    const refresh = () => {
      let v = current();
      for (const f of fields) {
        const e = els.get(f.key);
        if (!e) continue;
        const visible = f.show ? !!f.show(v) : true;
        e.wrap.hidden = !visible;
        if (f.type === "select") {
          const opts = val(f.options, v) || [];
          const sig = JSON.stringify(opts);
          if (e.sig !== sig) {
            // Kalau daftar opsi berubah (mis. pemain diganti), pakai nilai anjuran field (onOptionsChange) bila ada.
            const prev = e.sig !== undefined && f.onOptionsChange ? f.onOptionsChange(v) : e.input.value || (f.value ?? "");
            e.input.innerHTML = opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
            e.sig = sig;
            e.input.value = opts.some((o) => String(o.value) === String(prev)) ? String(prev) : opts[0] ? String(opts[0].value) : "";
            v = current(); // field sesudahnya (mis. kelas) bergantung pada nilai yang baru saja berubah ini
          }
        }
        const helpText = val(f.help, v);
        if (e.help) {
          if (f.type === "note") e.help.textContent = helpText || f.label || "";
          else e.help.textContent = helpText || "";
        }
      }
    };

    const setBusy = (b) => {
      busy = b;
      okBtn.disabled = b;
      cancelBtn.disabled = b;
      okBtn.textContent = b ? cfg.busyLabel || "…" : cfg.okLabel || "OK";
      for (const e of els.values()) if (e.input) e.input.disabled = b;
      for (const x of extraBox.querySelectorAll("button")) x.disabled = b;
    };

    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        dlg.close();
      } catch (_e) {
        /* sudah tertutup */
      }
      dlg.remove();
      resolve(result);
    };

    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    cancelBtn.addEventListener("click", () => finish(null));
    dlg.addEventListener("cancel", (e) => {
      if (busy) e.preventDefault();
    });
    dlg.addEventListener("close", () => finish(null));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      errorEl.hidden = true;
      const values = current();
      if (!cfg.onSubmit) return finish(values);
      setBusy(true);
      let res;
      try {
        res = await cfg.onSubmit(values);
      } catch (err) {
        res = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      setBusy(false);
      if (res && res.ok === false) {
        errorEl.textContent = res.error || "Gagal.";
        errorEl.hidden = false;
        return;
      }
      finish(res && res.value !== undefined ? res.value : values);
    });

    (document.getElementById("app") || document.body).appendChild(dlg);
    refresh();
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    const first = [...els.values()].find((e) => e.input && !e.wrap.hidden);
    if (first && first.input.type !== "select") first.input.focus();
  });
}
