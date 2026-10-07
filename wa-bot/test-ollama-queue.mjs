// Tes antrean Ollama berprioritas.   node test-ollama-queue.mjs
import { createPriorityQueue, PRIORITY } from "./ollama-queue.js";
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. hanya satu yang jalan; prioritas mendahului; FIFO dalam prioritas yang sama
{
  const q = createPriorityQueue();
  const order = [];
  let concurrent = 0, maxConcurrent = 0;
  const job = (name, ms = 10) => async () => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(ms); order.push(name); concurrent--; return name;
  };
  const p = [q.enqueue(job("first", 30), { priority: PRIORITY.BACKGROUND })]; // mulai duluan (antrean kosong)
  await sleep(2);
  p.push(
    q.enqueue(job("bg", 5), { priority: PRIORITY.BACKGROUND }),
    q.enqueue(job("wa1", 5), { priority: PRIORITY.WA }),
    q.enqueue(job("chat1", 5), { priority: PRIORITY.CHAT }),
    q.enqueue(job("wa2", 5), { priority: PRIORITY.WA }),
    q.enqueue(job("chat2", 5), { priority: PRIORITY.CHAT })
  );
  const res = await Promise.all(p);
  check(maxConcurrent === 1, "tidak pernah ada dua panggilan jalan bareng");
  check(order.join(",") === "first,chat1,chat2,wa1,wa2,bg", `urutan prioritas + FIFO (${order.join(",")})`);
  check(res[0] === "first" && res[3] === "chat1", "hasil dikembalikan ke pemanggil yang benar");
}

// 2. default prioritas = WA; error tidak mematikan antrean; pending akurat
{
  const q = createPriorityQueue();
  const bad = q.enqueue(async () => { await sleep(5); throw new Error("boom"); });
  const good = q.enqueue(async () => "ok");
  check(q.pending === 2, "pending = 2 (jalan + menunggu)");
  let msg = "";
  await bad.catch((e) => { msg = e.message; });
  check(msg === "boom", "error dilempar balik ke pemanggilnya");
  check((await good) === "ok", "antrean lanjut setelah ada yang gagal");
  await sleep(5);
  check(q.pending === 0 && q.isIdle(), "kosong -> idle");
}

// 3. aging: pekerjaan prioritas rendah yang lama menunggu tidak kelaparan
{
  let t = 0;
  const q = createPriorityQueue({ agingMs: 1000, now: () => t });
  const order = [];
  const mk = (n) => async () => { order.push(n); await sleep(2); };
  const blocker = q.enqueue(mk("blocker"), { priority: PRIORITY.CHAT });
  const old = q.enqueue(mk("old-bg"), { priority: PRIORITY.BACKGROUND });
  await sleep(1);
  t = 2500; // old-bg sudah menunggu 2,5 dtk -> naik 2 tingkat (efektif 0)
  const fresh = q.enqueue(mk("fresh-chat"), { priority: PRIORITY.CHAT });
  await Promise.all([blocker, old, fresh]);
  check(order.join(",") === "blocker,old-bg,fresh-chat", `aging mengangkat yang lama menunggu (${order.join(",")})`);
}

// 4. waitForIdle
{
  const q = createPriorityQueue();
  check((await q.waitForIdle()) === true, "waitForIdle langsung true saat kosong");
  q.enqueue(async () => { await sleep(30); });
  const t0 = Date.now();
  const ok = await q.waitForIdle();
  check(ok === true && Date.now() - t0 >= 25, "waitForIdle menunggu sampai selesai");
  q.enqueue(async () => { await sleep(120); });
  check((await q.waitForIdle({ maxWaitMs: 20 })) === false, "waitForIdle menyerah setelah maxWaitMs");
  await sleep(150);
  const s = q.stats();
  check(s.running === null && s.waiting === 0, "stats() kosong setelah selesai");
}

console.log(fails ? `\n${fails} GAGAL` : "\nSEMUA OK");
process.exit(fails ? 1 : 0);
