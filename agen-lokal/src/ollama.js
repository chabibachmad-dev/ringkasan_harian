// Klien Ollama (model lokal, gratis). Tanpa pustaka: cukup fetch bawaan Node 20+.
export class OllamaError extends Error {
  constructor(message, kind = "error") {
    super(message);
    this.kind = kind;
  }
}

export function createOllama({ url, model, numCtx = 8192, keepAlive = "30m", timeoutMs = 600_000, fetchImpl = fetch } = {}) {
  let current = model;
  async function call(pathname, body, { method = "POST", timeout = timeoutMs } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let res;
    try {
      res = await fetchImpl(`${url}${pathname}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    } catch (e) {
      if (e?.name === "AbortError") throw new OllamaError(`Model terlalu lama menjawab (> ${Math.round(timeout / 1000)} detik). Coba model yang lebih kecil (/model qwen2.5:3b).`, "timeout");
      throw new OllamaError(`Ollama tidak bisa dihubungi di ${url}. Pastikan aplikasi Ollama sedang berjalan (ikon di baki sistem).`, "down");
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (res.status === 404 || /not found/i.test(text)) throw new OllamaError(`Model "${current}" belum diunduh. Jalankan di terminal: ollama pull ${current}`, "nomodel");
    if (!res.ok) throw new OllamaError(`Ollama menjawab galat ${res.status}: ${text.slice(0, 200)}`, "http");
    try {
      return JSON.parse(text);
    } catch {
      throw new OllamaError("Jawaban Ollama tidak terbaca.", "parse");
    }
  }
  return {
    get model() {
      return current;
    },
    setModel(m) {
      current = String(m).trim();
    },
    /** messages: [{role, content, tool_calls?}], tools: skema fungsi. -> message asisten { content, tool_calls? } */
    async chat(messages, { tools = [], temperature = 0.2 } = {}) {
      const body = { model: current, messages, stream: false, keep_alive: keepAlive, options: { num_ctx: numCtx, temperature } };
      if (tools.length) body.tools = tools;
      const out = await call("/api/chat", body);
      if (!out?.message) throw new OllamaError("Jawaban Ollama kosong.", "parse");
      return out.message;
    },
    async listModels() {
      const out = await call("/api/tags", null, { method: "GET", timeout: 10_000 });
      return (out.models || []).map((m) => m.name);
    }
  };
}
