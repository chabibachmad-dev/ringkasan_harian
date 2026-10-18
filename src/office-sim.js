// ================================================================
// SIMULASI KANTOR: skenario palsu supaya halaman "Kantor" (office.js) bisa dinilai tampilannya sebelum
// tersambung ke bot sungguhan. Semua kejadian dikirim lewat emit(); nanti sumber datanya cukup diganti
// dengan umpan nyata yang memanggil emit() dengan bentuk kejadian yang sama.
//
// Bentuk kejadian: { who, kind, text?, progress?, to?, item?, approval? }
//   who      : ayyubi | wongsobot | agen | video | gambar | suara
//   kind     : online | offline | think | work | progress | say | wait | done | error | handoff
//   progress : 0..100 (untuk work/progress)
//   to,item  : handoff -> karyawan tujuan & benda yang dibawa (naskah | video | suara | gambar | berkas | pesan)
//   approval : { id, detail } untuk kind "wait" (menunggu izin pemilik)
// ================================================================

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function createOfficeSim({ emit, onDecisionNeeded = null } = {}) {
  let running = false;
  let paused = false;
  let stopped = false;
  const busy = new Set();
  const pending = new Map(); // id -> resolve(ok)
  let seq = 0;

  const sleep = (ms) =>
    new Promise((resolve, reject) => {
      let left = ms;
      const tick = () => {
        if (stopped) return reject(new Error("stop"));
        if (!paused) left -= 100;
        if (left <= 0) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });

  const ev = (who, kind, text = "", extra = {}) => emit({ who, kind, text, ...extra });

  /** Kerjakan "ya" lewat langkah-langkah berprogres. */
  async function steps(who, label, n, each = 1200, verb = "") {
    for (let i = 1; i <= n; i++) {
      ev(who, i === 1 ? "work" : "progress", `${label}${verb ? ` ${i}/${n}` : ""}`, { progress: Math.round((i / n) * 100) });
      await sleep(each * rnd(0.8, 1.2));
    }
  }

  function take(...ids) {
    if (ids.some((i) => busy.has(i))) return false;
    ids.forEach((i) => busy.add(i));
    return true;
  }
  const free = (...ids) => ids.forEach((i) => busy.delete(i));

  // ------------------------------------------------------------ skenario
  const SC = {
    async balasGrup() {
      if (!take("ayyubi")) return;
      try {
        const grup = pick(["Keluarga Besar", "Alumni SMA", "Arisan RT 05", "Kantor Wilayah"]);
        ev("ayyubi", "think", `Pesan baru di grup ${grup}`);
        await sleep(1800);
        await steps("ayyubi", "Menyusun balasan", 3, 1100);
        ev("ayyubi", "done", `Balasan terkirim ke ${grup}`);
        await sleep(1200);
      } finally {
        free("ayyubi");
      }
    },

    async videoCerita() {
      if (!take("ayyubi", "video", "gambar", "suara")) return;
      try {
        const topik = pick(["kancil dan buaya", "siklus air", "si semut rajin", "petualangan kapal layar"]);
        ev("ayyubi", "think", `Ada yang minta video ${topik}`);
        await sleep(1800);
        ev("ayyubi", "work", "Menyerahkan permintaan ke studio", { progress: 20 });
        await sleep(900);
        ev("ayyubi", "handoff", `Naskah ${topik} → Studio Video`, { to: "video", item: "naskah" });
        await sleep(3800);
        ev("video", "work", "Menulis naskah 5 adegan", { progress: 15 });
        await sleep(2200);
        // gambar & suara bekerja bersamaan
        const g = (async () => {
          await steps("gambar", "Menggambar adegan", 5, 1500, "n");
          ev("gambar", "done", "5 gambar adegan siap");
        })();
        const s = (async () => {
          await sleep(900);
          ev("suara", "work", "Membacakan narasi", { progress: 25 });
          await sleep(2600);
          ev("suara", "progress", "Membacakan narasi", { progress: 70 });
          await sleep(2600);
          ev("suara", "done", "Narasi selesai (42 dtk)");
        })();
        ev("video", "progress", "Menunggu gambar dan suara", { progress: 35 });
        await Promise.all([g, s]);
        await steps("video", "Merakit video dengan ffmpeg", 4, 1400);
        ev("video", "handoff", "Video jadi → Ayyubi", { to: "ayyubi", item: "video" });
        await sleep(3800);
        ev("video", "done", "Video diserahkan");
        ev("ayyubi", "work", "Mengirim video ke grup", { progress: 80 });
        await sleep(1800);
        ev("ayyubi", "done", "Video terkirim");
        await sleep(1200);
      } finally {
        free("ayyubi", "video", "gambar", "suara");
      }
    },

    async fotoHidup() {
      if (!take("video", "suara")) return;
      try {
        ev("video", "think", "Foto masuk: minta stop motion 24 foto");
        await sleep(1500);
        ev("suara", "work", "Memilih musik: dj jedag-jedug", { progress: 30 });
        await sleep(1800);
        ev("suara", "done", "Musik terpilih (Tes Beat)");
        await steps("video", "Merakit stop motion", 4, 1300);
        ev("video", "done", "Stop motion + musik selesai");
        await sleep(1000);
      } finally {
        free("video", "suara");
      }
    },

    async suaraCewek() {
      if (!take("wongsobot", "suara")) return;
      try {
        ev("wongsobot", "think", "Grup Keluarga Besar: jawab pakai suara");
        await sleep(1500);
        ev("wongsobot", "work", "Menulis jawaban", { progress: 40 });
        await sleep(1600);
        ev("wongsobot", "handoff", "Minta dibacakan (suara wanita)", { to: "suara", item: "pesan" });
        await sleep(3600);
        ev("suara", "work", "Membuat suara Sulafat", { progress: 60 });
        await sleep(2400);
        ev("suara", "handoff", "Voice note → Wongsobot", { to: "wongsobot", item: "suara" });
        await sleep(3600);
        ev("suara", "done", "Voice note diserahkan");
        ev("wongsobot", "done", "Voice note terkirim ke grup");
        await sleep(1000);
      } finally {
        free("wongsobot", "suara");
      }
    },

    async kuotaHabis() {
      if (!take("ayyubi")) return;
      try {
        ev("ayyubi", "work", "Menjawab pertanyaan di grup", { progress: 50 });
        await sleep(1800);
        ev("ayyubi", "error", "Kuota Gemini habis");
        await sleep(2600);
        ev("ayyubi", "say", "Pindah ke Groq cadangan");
        await sleep(1600);
        ev("ayyubi", "work", "Menjawab dengan Groq", { progress: 85 });
        await sleep(1600);
        ev("ayyubi", "done", "Jawaban terkirim");
        await sleep(1000);
      } finally {
        free("ayyubi");
      }
    },

    async wongsoKerja() {
      if (!take("wongsobot")) return;
      try {
        ev("wongsobot", "think", "Pertanyaan di grup Arisan RT 05");
        await sleep(1700);
        await steps("wongsobot", "Mencari jawaban", 3, 1200);
        ev("wongsobot", "done", "Jawaban terkirim");
        await sleep(1000);
      } finally {
        free("wongsobot");
      }
    },

    async agenCariBerkas() {
      if (!take("agen")) return;
      try {
        ev("agen", "think", "Tugas baru: cari berkas RAB 2026");
        await sleep(1800);
        await steps("agen", "Mencari di folder Dokumen", 3, 1200);
        ev("agen", "say", "Ketemu 3 berkas");
        await sleep(1500);
        ev("agen", "work", "Membaca RAB-2026.xlsx", { progress: 70 });
        await sleep(2200);
        ev("agen", "done", "Ringkasan dikirim ke Telegram");
        await sleep(1200);
      } finally {
        free("agen");
      }
    },

    async agenIzin() {
      if (!take("agen")) return;
      try {
        ev("agen", "think", "Merapikan folder Unduhan");
        await sleep(1800);
        const id = `izin-${++seq}`;
        const detail = pick(["Pindahkan 12 berkas ke Unduhan\\Arsip", "Hapus 4 berkas sementara di Temp", "Jalankan: dir C:\\Laporan /s"]);
        const decision = new Promise((resolve) => pending.set(id, resolve));
        ev("agen", "wait", "Menunggu izinmu", { approval: { id, detail } });
        onDecisionNeeded?.({ id, detail });
        const ok = await Promise.race([decision, sleep(30_000).then(() => null)]);
        pending.delete(id);
        if (ok === true) {
          ev("agen", "work", "Menjalankan tugas yang diizinkan", { progress: 50 });
          await sleep(2200);
          ev("agen", "done", "Selesai sesuai izin");
        } else {
          ev("agen", "say", ok === false ? "Ditolak pemilik, tidak dilakukan" : "Izin tak dijawab, dibatalkan");
          await sleep(1600);
          ev("agen", "done", "Tugas dibatalkan dengan aman");
        }
        await sleep(1000);
      } finally {
        free("agen");
      }
    },

    async agenCariWeb() {
      if (!take("agen")) return;
      try {
        ev("agen", "work", "Mencari di internet: harga emas hari ini", { progress: 30 });
        await sleep(2400);
        ev("agen", "progress", "Membaca 3 halaman hasil", { progress: 75 });
        await sleep(2000);
        ev("agen", "done", "Jawaban dikirim ke Telegram");
        await sleep(1000);
      } finally {
        free("agen");
      }
    }
  };

  const GROUP_A = [
    [SC.balasGrup, 3],
    [SC.videoCerita, 2],
    [SC.fotoHidup, 1],
    [SC.suaraCewek, 2],
    [SC.kuotaHabis, 1],
    [SC.wongsoKerja, 2]
  ];
  const GROUP_B = [
    [SC.agenCariBerkas, 3],
    [SC.agenIzin, 2],
    [SC.agenCariWeb, 2]
  ];
  const weighted = (list) => {
    const total = list.reduce((n, x) => n + x[1], 0);
    let r = Math.random() * total;
    for (const [fn, w] of list) {
      r -= w;
      if (r <= 0) return fn;
    }
    return list[0][0];
  };

  async function loop(list, gapMin, gapMax) {
    while (!stopped) {
      try {
        await sleep(rnd(gapMin, gapMax));
        await weighted(list)();
      } catch (e) {
        if (stopped) return;
      }
    }
  }

  async function start() {
    if (running) return;
    running = true;
    stopped = false;
    // keadaan awal: semua masuk kerja, Wongsobot masih tidur
    ev("ayyubi", "online", "Masuk kerja");
    ev("agen", "online", "Laptop kantor menyala");
    ev("video", "online", "Studio video buka");
    ev("gambar", "online", "Studio gambar buka");
    ev("suara", "online", "Studio suara buka");
    ev("wongsobot", "offline", "Belum aktif");
    loop(GROUP_A, 1500, 4500);
    loop(GROUP_B, 3500, 7000);
    (async () => {
      try {
        await sleep(9000);
        ev("wongsobot", "online", "Masuk kerja");
      } catch {
        /* berhenti */
      }
    })();
  }

  function stop() {
    stopped = true;
    running = false;
    busy.clear();
    for (const [, r] of pending) r(null);
    pending.clear();
  }

  return {
    start,
    stop,
    pause: () => (paused = true),
    resume: () => (paused = false),
    isPaused: () => paused,
    isRunning: () => running,
    decide(id, ok) {
      const r = pending.get(id);
      if (r) r(Boolean(ok));
      return Boolean(r);
    }
  };
}
