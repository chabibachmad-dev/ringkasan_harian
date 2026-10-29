// Tes pengaman rantai antar-bot (bot-chain.js).   node test-bot-chain.mjs
import { createBotChain, readBotChainConfig } from "./bot-chain.js";
import { readFileSync } from "node:fs";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

const cfg = readBotChainConfig({});
check(cfg.max === 6 && cfg.minDelayMs === 3000 && cfg.maxDelayMs === 10000, "bawaan: rantai 6, jeda 3-10 detik");
const c2 = readBotChainConfig({ BOT_CHAIN_MAX: "3", BOT_CHAIN_DELAY_MIN_SEC: "1", BOT_CHAIN_DELAY_MAX_SEC: "2" });
check(c2.max === 3 && c2.minDelayMs === 1000 && c2.maxDelayMs === 2000, "diatur lewat env");
check(readBotChainConfig({ BOT_CHAIN_DELAY_MIN_SEC: "9", BOT_CHAIN_DELAY_MAX_SEC: "2" }).maxDelayMs >= 9000, "jeda maks tidak pernah di bawah jeda min");

const chain = createBotChain({ config: cfg, random: () => 0 });
const G = "120363@g.us";
let id = 0;
chain.note(G, { id: `h${++id}`, fromBot: false });
check(chain.count(G) === 0 && !chain.blocked(G), "pesan manusia: hitungan 0");
const results = [];
for (let i = 1; i <= 8; i++) { chain.note(G, { id: `b${i}`, fromBot: true }); results.push(chain.blocked(G)); }
check(results.slice(0, 6).every((b) => !b), "6 pesan bot berturut-turut masih boleh disahut");
check(results[6] === true && results[7] === true, "pesan bot ke-7 dan seterusnya: berhenti menyahut");
chain.note(G, { id: "b3", fromBot: true });
check(chain.count(G) === 8, "pesan yang sama dari dua akun dihitung sekali");
chain.note(G, { id: "h2", fromBot: false });
check(chain.count(G) === 0 && !chain.blocked(G), "pesan manusia mereset rantai");
chain.note(G, { id: "b9", fromBot: true });
check(chain.count(G) === 1 && !chain.blocked(G), "setelah reset, bot boleh bersahutan lagi");

// grup lain terpisah
const G2 = "999@g.us";
for (let i = 1; i <= 10; i++) chain.note(G2, { id: `x${i}`, fromBot: true });
check(chain.blocked(G2) && !chain.blocked(G), "hitungan terpisah per grup");

// jeda acak 3-10 detik
const lo = createBotChain({ config: cfg, random: () => 0 });
const hi = createBotChain({ config: cfg, random: () => 0.999999 });
check(lo.delayMs() === 3000 && hi.delayMs() >= 9990 && hi.delayMs() <= 10000, "jeda acak dalam rentang 3-10 detik");
const rnd = createBotChain({ config: cfg });
const ds = Array.from({ length: 200 }, () => rnd.delayMs());
check(ds.every((d) => d >= 3000 && d <= 10000) && new Set(ds).size > 20, "jeda benar-benar acak dan selalu dalam rentang");

// BOT_CHAIN_MAX=0: tidak menyahut bot sama sekali
const none = createBotChain({ config: readBotChainConfig({ BOT_CHAIN_MAX: "0" }) });
none.note(G, { id: "z1", fromBot: true });
check(none.blocked(G), "BOT_CHAIN_MAX=0: tidak pernah menyahut bot lain");

// terpasang di index.js
const idx = readFileSync(new URL("./index.js", import.meta.url), "utf8");
check(/botChain\.note\(groupJid, \{ id: msg\.key\.id, fromBot \}\)/.test(idx) && /fromBot && botChain\.blocked\(groupJid\)/.test(idx), "index.js: setiap pesan grup dicatat, rantai yang lewat batas dihentikan");
check(/botChain\.delayMs\(\)/.test(idx) && /if \(fromBot && !triggered\) return;/.test(idx), "index.js: jeda acak sebelum menyahut bot; pesan bot tak menyapa tidak jadi bahan obrolan spontan");
check(!/Bot lain diblokir|ignoreBots|abaikan bot/i.test(idx), "tidak ada pemblokiran total antar-bot");

console.log(fails ? `\n${fails} GAGAL` : "\nSemua tes rantai antar-bot lolos.");
process.exit(fails ? 1 : 0);
