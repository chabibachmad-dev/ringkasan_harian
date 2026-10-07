// ================================================================
// Panggilan /api/chat ke Ollama lewat node:http (bukan fetch bawaan Node).
//
// Kenapa: fetch bawaan Node (undici) punya batas bawaan 300 detik untuk
// menunggu header respons (headersTimeout). Ollama non-streaming baru
// membalas SETELAH selesai menjawab; di CPU lambat, dokumen besar membuat
// "baca prompt + tulis jawaban" gampang lewat 5 menit -> request diputus
// dengan pesan "fetch failed" padahal Ollama masih bekerja.
//
// Di sini: tanpa batas bawaan itu (hanya batas `timeoutMs` kita sendiri),
// dan jawaban di-STREAM per potongan sehingga kita bisa melaporkan
// kemajuan (jumlah token) ke aplikasi dan membedakan penyebab gagal.
// ================================================================

import http from "node:http";
import https from "node:https";

// body: payload /api/chat (tanpa `stream`; selalu dipaksa true).
// Mengembalikan { content, promptTokens, evalTokens }.
export function ollamaChatStream({ baseUrl, body, timeoutMs = 600000, onToken } = {}) {
  const url = new URL("/api/chat", baseUrl);
  const lib = url.protocol === "https:" ? https : http;
  const payload = JSON.stringify({ ...body, stream: true });

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let gotResponse = false;
    let content = "";
    let tokens = 0;
    let buf = "";
    let last = null;
    let req;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const handleLine = (line) => {
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        return;
      }
      if (j.error) {
        finish(reject, new Error(`Ollama API error: ${String(j.error).slice(0, 300)}`));
        req.destroy();
        return;
      }
      const piece = j.message?.content;
      if (piece) {
        content += piece;
        tokens += 1; // satu potongan stream ~ satu token
        if (onToken) {
          try {
            onToken(tokens);
          } catch {
            /* pelapor kemajuan tidak boleh menggagalkan jawaban */
          }
        }
      }
      if (j.done) last = j;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
    }, timeoutMs);

    req = lib.request(
      url,
      {
        method: "POST",
        agent: false,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
      },
      (res) => {
        gotResponse = true;
        res.setEncoding("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let errText = "";
          res.on("data", (c) => {
            errText += c;
          });
          res.on("end", () => finish(reject, new Error(`Ollama API error ${res.statusCode}: ${errText.slice(0, 300)}`)));
          res.on("error", () => finish(reject, new Error(`Ollama API error ${res.statusCode}`)));
          return;
        }
        res.on("data", (chunk) => {
          buf += chunk;
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) handleLine(line);
          }
        });
        res.on("end", () => {
          if (buf.trim()) handleLine(buf.trim());
          if (settled) return;
          if (!last?.done) {
            return finish(
              reject,
              new Error("Koneksi ke Ollama terputus sebelum jawaban selesai (kemungkinan Ollama berhenti/kehabisan RAM -- cek `journalctl -u ollama`).")
            );
          }
          if (!content) return finish(reject, new Error(`Respons Ollama tidak berisi teks: ${JSON.stringify(last).slice(0, 300)}`));
          finish(resolve, { content, promptTokens: last.prompt_eval_count ?? null, evalTokens: last.eval_count ?? tokens });
        });
        res.on("error", (err) => finish(reject, new Error(`Koneksi ke Ollama terputus saat menjawab (${err.message})`)));
        res.on("close", () => {
          // 'end' tidak terkirim bila koneksi putus mendadak
          if (!settled && !res.complete) {
            finish(
              reject,
              timedOut
                ? new Error(`Ollama tidak merespons dalam ${timeoutMs}ms (timeout).`)
                : new Error("Koneksi ke Ollama terputus sebelum jawaban selesai (kemungkinan Ollama berhenti/kehabisan RAM -- cek `journalctl -u ollama`).")
            );
          }
        });
      }
    );

    req.on("error", (err) => {
      if (timedOut) return finish(reject, new Error(`Ollama tidak merespons dalam ${timeoutMs}ms (timeout).`));
      if (gotResponse) return finish(reject, new Error(`Koneksi ke Ollama terputus saat menjawab (${err.message})`));
      finish(reject, new Error(`Gagal hubungi Ollama di ${baseUrl} -- apakah "ollama serve" jalan? (${err.code || err.message})`));
    });

    req.end(payload);
  });
}
