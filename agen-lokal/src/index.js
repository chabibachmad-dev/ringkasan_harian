// Titik masuk: node src/index.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, readConfig } from "./config.js";
import { createOllama } from "./ollama.js";
import { createWeb } from "./web.js";
import { createTools } from "./tools.js";
import { createAgent } from "./agent.js";
import { createBot } from "./telegram.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = readConfig({ ...loadEnvFile(path.join(root, ".env")), ...process.env });

if (config.problems.length) {
  console.error("⛔ Pengaturan belum lengkap:\n- " + config.problems.join("\n- ") + "\n\nIsi berkas .env (contoh ada di .env.example), lalu jalankan lagi.");
  process.exit(1);
}

const ollama = createOllama({ url: config.ollamaUrl, model: config.model, numCtx: config.numCtx, keepAlive: config.keepAlive, timeoutMs: config.requestTimeoutMs });
const web = createWeb();
let bot;
const tools = createTools({ config, web, sendFile: (file) => bot.sendFile([...config.owners][0], file) });
const agent = createAgent({ ollama, tools, config });
bot = createBot({ config, agent, ollama, onRestart: () => process.exit(0) }); // pm2/start.sh menyalakan lagi

process.on("unhandledRejection", (e) => console.error("Galat tak tertangani:", e));
process.on("SIGINT", () => {
  bot.stop();
  process.exit(0);
});

console.log(`🚀 Agen Lokal mulai. Model: ${config.model} · Mode: ${config.mode} · Folder: ${config.roots.join("; ")}`);
ollama.listModels().then(
  (list) => {
    if (!list.some((m) => m === config.model)) console.warn(`⚠️ Model "${config.model}" belum diunduh. Jalankan: ollama pull ${config.model}`);
  },
  (e) => console.warn(`⚠️ ${e.message}`)
);
bot.start().catch((e) => {
  console.error("⛔ Bot gagal mulai:", e.message, "\nPeriksa TELEGRAM_BOT_TOKEN dan koneksi internet.");
  process.exit(1);
});
