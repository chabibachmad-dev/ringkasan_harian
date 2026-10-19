// Pengendali browser minimal lewat Chrome DevTools Protocol (tanpa paket tambahan).
// Memakai Chrome/Edge yang sudah terpasang dan WebSocket bawaan Node (Node 22+).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cari Chrome/Edge/Chromium. SAKTI_BROWSER (env) didahulukan. Mengembalikan alamat berkas atau null. */
export function findBrowser(env = process.env, platform = process.platform) {
  const c = [];
  if (env.SAKTI_BROWSER) c.push(env.SAKTI_BROWSER);
  if (platform === "win32") {
    for (const base of [env["ProgramFiles"], env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean)) {
      c.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"), path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else {
    const names = platform === "darwin" ? [] : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"];
    for (const d of String(env.PATH || "").split(path.delimiter).filter(Boolean)) for (const n of names) c.push(path.join(d, n));
    if (platform === "darwin") c.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  }
  return c.find((f) => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  }) || null;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    ws.addEventListener("message", (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"));
      } catch {
        return;
      }
      const w = m.id != null ? this.waiting.get(m.id) : null;
      if (!w) return;
      this.waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.error) w.reject(new Error(`${m.error.message || "galat CDP"}`));
      else w.resolve(m.result);
    });
    const dead = () => {
      for (const w of this.waiting.values()) {
        clearTimeout(w.timer);
        w.reject(new Error("Browser tertutup."));
      }
      this.waiting.clear();
    };
    ws.addEventListener("close", dead);
    ws.addEventListener("error", dead);
  }

  static async connect(url) {
    const WS = globalThis.WebSocket;
    if (!WS) throw new Error("Node ini belum punya WebSocket bawaan. Pakai Node 22 atau lebih baru.");
    const ws = new WS(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("Tidak bisa tersambung ke browser.")), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`Browser tidak menjawab (${method}).`));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        this.waiting.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

// ---- skrip yang berjalan DI DALAM halaman ----
const IN_PAGE = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const label = (e) => {
    const id = e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]');
    const wrap = e.closest('label');
    const al = e.getAttribute('aria-label');
    return ((id && id.innerText) || (wrap && wrap.innerText) || al || e.placeholder || e.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  };
  return { vis, label };
})()`;

export async function launchBrowser({ exe, userDataDir, headless = false, url = "about:blank", port = 0, startTimeoutMs = 20_000, log = console }) {
  if (!exe) throw new Error("Chrome/Edge tidak ditemukan. Pasang salah satunya, atau isi SAKTI_BROWSER di .env dengan alamat lengkap chrome.exe / msedge.exe.");
  fs.mkdirSync(userDataDir, { recursive: true });
  const dport = port || 9300 + Math.floor(Math.random() * 600);
  const args = [`--remote-debugging-port=${dport}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${userDataDir}`, "--no-first-run", "--no-default-browser-check", "--disable-popup-blocking", "--window-size=1366,900"];
  if (headless) args.push("--headless=new");
  if (typeof process.getuid === "function" && process.getuid() === 0) args.push("--no-sandbox");
  args.push(url);
  const child = spawn(exe, args, { stdio: "ignore", windowsHide: false, detached: false });
  let exited = false;
  child.on("exit", () => (exited = true));
  child.on("error", () => (exited = true));
  const base = `http://127.0.0.1:${dport}`;
  const t0 = Date.now();
  let target = null;
  while (Date.now() - t0 < startTimeoutMs) {
    if (exited) throw new Error("Browser langsung berhenti. Tutup dulu jendela browser lain yang memakai profil yang sama, lalu coba lagi.");
    try {
      const list = await (await fetch(`${base}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await sleep(250);
  }
  if (!target) {
    try {
      child.kill();
    } catch {}
    throw new Error("Browser tidak merespons dalam waktu wajar.");
  }
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable").catch(() => {});
  await cdp.send("Runtime.enable").catch(() => {});
  let closed = false;

  const page = {
    async eval(expr, { timeoutMs = 30_000 } = {}) {
      const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, timeoutMs);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "galat skrip halaman");
      return r.result?.value;
    },
    async goto(u, { timeoutMs = 45_000 } = {}) {
      await cdp.send("Page.navigate", { url: u }, timeoutMs);
      await page.settle(timeoutMs);
    },
    /** tunggu dokumen selesai dimuat + sebentar agar skrip halaman sempat menggambar */
    async settle(timeoutMs = 30_000) {
      const t = Date.now();
      while (Date.now() - t < timeoutMs) {
        const st = await page.eval("document.readyState").catch(() => "");
        if (st === "complete") break;
        await sleep(250);
      }
      await sleep(600);
    },
    async info() {
      return page.eval("({ url: location.href, title: document.title })");
    },
    async screenshot() {
      const r = await cdp.send("Page.captureScreenshot", { format: "png" }, 30_000);
      return Buffer.from(r.data, "base64");
    },
    /** potret satu elemen (mis. gambar captcha) */
    async shotOf(selector) {
      const rect = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
      if (!rect) throw new Error("Elemen tidak ditemukan.");
      const r = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: Math.max(1, Math.min(3, 240 / Math.max(1, rect.width))) }, captureBeyondViewport: true }, 30_000);
      return Buffer.from(r.data, "base64");
    },
    async exists(selector) {
      return page.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
    },
    /** isi kolom seperti ketikan sungguhan (kerangka web seperti Angular/React ikut terpicu) */
    async fill(selector, text) {
      const ok = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.focus(); if (e.select) e.select(); return true; })()`);
      if (!ok) throw new Error(`Kolom tidak ditemukan: ${selector}`);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      if (text) await cdp.send("Input.insertText", { text: String(text) });
    },
    async click(selector) {
      const pt = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!pt) throw new Error(`Tombol tidak ditemukan: ${selector}`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    },
    async press(key) {
      const code = key === "Enter" ? 13 : 0;
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, text: key === "Enter" ? "\r" : undefined });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
    },
    /** Kumpulkan kolom/tombol yang terlihat; setiap elemen diberi atribut data-agen="<jenis><n>" supaya bisa dipilih lagi. */
    async scan() {
      return page.eval(`(() => {
        const { vis, label } = ${IN_PAGE};
        document.querySelectorAll('[data-agen]').forEach((e) => e.removeAttribute('data-agen'));
        const out = [];
        let n = 0;
        const all = document.querySelectorAll('input, select, textarea, button, a[href], [role=button], img, canvas');
        for (const e of all) {
          if (!vis(e)) continue;
          const tag = e.tagName.toLowerCase();
          const type = (e.getAttribute('type') || '').toLowerCase();
          if (tag === 'input' && ['hidden'].includes(type)) continue;
          if (tag === 'a' && !(e.innerText || '').trim()) continue;
          const kind = tag === 'input' ? (type === 'password' ? 'sandi' : ['checkbox', 'radio'].includes(type) ? type : ['submit', 'button'].includes(type) ? 'tombol' : 'kolom') : tag === 'select' ? 'pilihan' : tag === 'textarea' ? 'kolom' : tag === 'img' || tag === 'canvas' ? 'gambar' : 'tombol';
          const id = 'e' + (++n);
          e.setAttribute('data-agen', id);
          const r = e.getBoundingClientRect();
          out.push({ id, kind, tag, type, name: e.getAttribute('name') || '', eid: e.id || '', cls: String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || '').slice(0, 80), ph: e.placeholder || '', label: label(e), text: (tag === 'input' || tag === 'textarea' ? (['submit','button'].includes(type) ? e.value : '') : e.innerText || e.alt || '').replace(/\\s+/g, ' ').trim().slice(0, 80), src: tag === 'img' ? (e.getAttribute('src') || '').slice(0, 60) : '', w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), opts: tag === 'select' ? [...e.options].slice(0, 12).map((o) => o.text.trim()) : undefined, kosong: (tag === 'input' || tag === 'textarea' || tag === 'select') ? !String(e.value || '').length : undefined });
          if (n >= 120) break;
        }
        return out;
      })()`);
    },
    async visibleText(max = 600) {
      return page.eval(`(document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, ${Number(max) || 600})`);
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await cdp.send("Browser.close", {}, 3000);
      } catch {}
      cdp.close();
      try {
        child.kill();
      } catch {}
    },
    get alive() {
      return !closed && !exited;
    }
  };
  log.log?.(`Browser siap (port ${dport}).`);
  return page;
}
