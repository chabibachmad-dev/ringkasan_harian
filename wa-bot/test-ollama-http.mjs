// Tes lapisan HTTP ke Ollama (server palsu lokal, tanpa Ollama sungguhan).
//   node test-ollama-http.mjs
import http from "node:http";
import { ollamaChatStream } from "./ollama-http.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mode = "ok";
let lastBody = null;
const srv = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    lastBody = JSON.parse(raw || "{}");
    const line = (o) => JSON.stringify(o) + "\n";
    if (mode === "ok") {
      await sleep(300); // header baru keluar setelah "prompt eval"
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(line({ message: { content: "Ha" } }));
      res.write(line({ message: { content: "lo" } }).slice(0, 10)); // potongan di tengah baris
      await sleep(30);
      res.write(line({ message: { content: "lo" } }).slice(10));
      res.end(line({ message: { content: " dunia" }, done: true, prompt_eval_count: 12, eval_count: 3 }));
    } else if (mode === "http500") {
      res.writeHead(500); res.end("model hilang");
    } else if (mode === "midstream-error") {
      res.writeHead(200);
      res.write(line({ message: { content: "sebagian" } }));
      res.end(line({ error: "model runner has unexpectedly stopped" }));
    } else if (mode === "cut") {
      res.writeHead(200);
      res.write(line({ message: { content: "sebagian" } }));
      await sleep(30);
      req.socket.destroy();
    } else if (mode === "hang") {
      // tidak pernah membalas
    } else if (mode === "empty") {
      res.writeHead(200);
      res.end(line({ message: { content: "" }, done: true }));
    }
  });
});
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
const call = (extra = {}) => ollamaChatStream({ baseUrl: base, body: { model: "m", messages: [{ role: "user", content: "x" }], options: { num_ctx: 4096 } }, timeoutMs: 5000, ...extra });

{
  const seen = [];
  const r = await call({ onToken: (n) => seen.push(n) });
  check(r.content === "Halo dunia", `stream digabung utuh, termasuk baris yang terpotong (${JSON.stringify(r.content)})`);
  check(r.promptTokens === 12 && r.evalTokens === 3, "jumlah token dari Ollama terbaca");
  check(seen.length === 3 && seen.at(-1) === 3, "onToken dipanggil tiap potongan");
  check(lastBody.stream === true && lastBody.model === "m" && lastBody.options.num_ctx === 4096, "body: stream dipaksa true, opsi diteruskan");
}
mode = "http500";
await call().then(() => check(false, "HTTP 500 harus gagal"), (e) => check(/Ollama API error 500: model hilang/.test(e.message), "HTTP 500 -> pesan jelas"));
mode = "midstream-error";
await call().then(() => check(false, "error di tengah stream harus gagal"), (e) => check(/runner has unexpectedly stopped/.test(e.message), "error dari Ollama di tengah stream diteruskan"));
mode = "cut";
await call().then(() => check(false, "koneksi putus harus gagal"), (e) => check(/terputus/.test(e.message), `koneksi putus -> pesan terputus (${e.message.slice(0, 40)})`));
mode = "hang";
{
  const t0 = Date.now();
  await call({ timeoutMs: 400 }).then(() => check(false, "hang harus timeout"), (e) => check(/tidak merespons dalam 400ms/.test(e.message) && Date.now() - t0 < 2000, "timeout buatan kita bekerja"));
}
mode = "empty";
await call().then(() => check(false, "jawaban kosong harus gagal"), (e) => check(/tidak berisi teks/.test(e.message), "jawaban kosong ditolak"));
await new Promise((r) => srv.close(r));
await ollamaChatStream({ baseUrl: base, body: { model: "m", messages: [] }, timeoutMs: 2000 }).then(
  () => check(false, "server mati harus gagal"),
  (e) => check(/Gagal hubungi Ollama .*ECONNREFUSED/.test(e.message), `server mati -> 'Gagal hubungi Ollama' + kode (${e.message.slice(-30)})`)
);

console.log(fails ? `\n${fails} GAGAL` : "\nSemua OK");
process.exit(fails ? 1 : 0);
