// ================================================================
// Antrean panggilan Ollama BERPRIORITAS (satu panggilan jalan pada satu waktu).
//
// CPU laptop cuma 2 inti & model lokal ~4,5 token/detik, jadi dua panggilan
// yang jalan bareng saling memperlambat -- antrean ini memastikan hanya SATU
// yang berjalan, dan yang menunggu diurutkan menurut prioritas:
//   CHAT       (0)  chat di aplikasi & perintah pemilik -- ditunggu orangnya
//   WA         (1)  balasan WhatsApp (default)
//   BACKGROUND (2)  ringkasan harian, dll -- boleh menunggu
// Di dalam prioritas yang sama berlaku urutan datang (FIFO). Supaya pekerjaan
// prioritas rendah tidak kelaparan, tiap `agingMs` menunggu, prioritasnya naik
// satu tingkat. Panggilan yang SEDANG jalan tidak dipotong (non-preemptive).
// ================================================================

export const PRIORITY = { CHAT: 0, WA: 1, BACKGROUND: 2 };

export function createPriorityQueue({ agingMs = 120000, now = () => Date.now() } = {}) {
  const waiting = [];
  let running = null; // { priority, label, startedAt }
  let seq = 0;
  let idleWaiters = [];

  function effective(item) {
    return item.priority - Math.floor((now() - item.enqueuedAt) / agingMs);
  }

  function pickNext() {
    let bestIdx = 0;
    for (let i = 1; i < waiting.length; i += 1) {
      const a = waiting[i];
      const b = waiting[bestIdx];
      const ea = effective(a);
      const eb = effective(b);
      if (ea < eb || (ea === eb && a.seq < b.seq)) bestIdx = i;
    }
    return waiting.splice(bestIdx, 1)[0];
  }

  function notifyIdle() {
    if (running || waiting.length) return;
    const ws = idleWaiters;
    idleWaiters = [];
    ws.forEach((w) => w());
  }

  async function drain() {
    if (running) return;
    const item = waiting.length ? pickNext() : null;
    if (!item) {
      notifyIdle();
      return;
    }
    running = { priority: item.priority, label: item.label, startedAt: now() };
    try {
      item.resolve(await item.fn());
    } catch (err) {
      item.reject(err);
    } finally {
      running = null;
      // Lanjut ke berikutnya di tick lain supaya tumpukan pemanggilan tidak menumpuk.
      queueMicrotask(drain);
    }
  }

  function enqueue(fn, { priority = PRIORITY.WA, label = "" } = {}) {
    return new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject, priority, label, enqueuedAt: now(), seq: (seq += 1) });
      queueMicrotask(drain);
    });
  }

  return {
    enqueue,
    // Jumlah panggilan yang sedang jalan + menunggu.
    get pending() {
      return waiting.length + (running ? 1 : 0);
    },
    isIdle: () => !running && waiting.length === 0,
    stats() {
      const byPriority = {};
      for (const w of waiting) byPriority[w.priority] = (byPriority[w.priority] || 0) + 1;
      return {
        running: running ? { priority: running.priority, label: running.label, seconds: Math.round((now() - running.startedAt) / 1000) } : null,
        waiting: waiting.length,
        byPriority
      };
    },
    // Menunggu sampai antrean kosong (untuk pekerjaan latar yang memakai CPU,
    // mis. OCR). Berhenti menunggu setelah maxWaitMs supaya tidak menggantung selamanya.
    waitForIdle({ maxWaitMs = 15 * 60 * 1000 } = {}) {
      if (!running && waiting.length === 0) return Promise.resolve(true);
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(v);
        };
        const timer = setTimeout(() => finish(false), maxWaitMs);
        idleWaiters.push(() => finish(true));
      });
    }
  };
}
