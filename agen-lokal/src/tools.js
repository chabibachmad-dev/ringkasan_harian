// Alat yang boleh dipakai agent. Tiap alat: skema untuk model, penjelasan untuk persetujuan, dan pelaksanaan.
// Aturan besar: membaca bebas (di dalam folder izin), mengubah/menjalankan SELALU minta persetujuan, tidak ada hapus permanen.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { commandProblem, isSecretPath, resolveInRoots, SafetyError } from "./safety.js";
import { readFileText, TEXT_EXT } from "./docs.js";

const MAX_OUT = 4000;
const SKIP_DIRS = new Set(["node_modules", ".git", "$recycle.bin", "system volume information", "appdata", "windows", "program files", "program files (x86)", ".cache", ".npm", ".local", "snap", "proc", "sys"]);
const clip = (s, n = MAX_OUT) => (String(s).length > n ? String(s).slice(0, n) + `\n…[dipotong, ${String(s).length - n} huruf lagi]` : String(s));
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const str = (v) => (v == null ? "" : String(v));

/** Nama shell yang dipakai untuk "jalankan_perintah": PowerShell di Windows, bash di Linux/Mac. */
export const shellName = () => (process.platform === "win32" ? "PowerShell" : "bash");

/** Jalankan perintah di PowerShell (Windows) atau bash (Linux/Mac, sh bila bash tidak ada). Masukan standar ditutup supaya perintah interaktif tidak menggantung. */
export function defaultExec(cmd, { cwd, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    const prefix = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ";
    const sh = !win && fs.existsSync("/bin/bash") ? "/bin/bash" : "sh";
    const child = win
      ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", prefix + cmd], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(sh, ["-c", cmd], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: process.env.LC_ALL || "C.UTF-8", DEBIAN_FRONTEND: "noninteractive" } });
    let out = "";
    let timedOut = false;
    const add = (d) => {
      if (out.length < 200_000) out += d.toString("utf8");
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      timedOut = true;
      if (win) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else {
        try {
          process.kill(-child.pid, "SIGKILL"); // seluruh kelompok proses, bukan hanya shell-nya
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `Gagal menjalankan: ${e.message}`, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, output: out, timedOut });
    });
  });
}

function walk(dir, { maxDepth = 6, maxEntries = 20_000 } = {}) {
  const out = [];
  const stack = [[dir, 0]];
  while (stack.length && out.length < maxEntries) {
    const [d, depth] = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink() || isSecretPath(full)) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        out.push({ full, dir: true });
        if (depth < maxDepth) stack.push([full, depth + 1]);
      } else if (e.isFile()) out.push({ full, dir: false });
    }
  }
  return out;
}

const props = (o, required = []) => ({ type: "object", properties: o, required });

export function createTools({ config, web, sendFile = null, exec = defaultExec, now = () => new Date() }) {
  const here = (p) => resolveInRoots(p, config);
  const rootsOf = () => config.roots;
  const list = [
    {
      name: "waktu_sekarang",
      description: "Tanggal dan jam sekarang di laptop pemilik.",
      parameters: props({}),
      run: () => now().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })
    },
    {
      name: "daftar_folder",
      description: "Menampilkan isi sebuah folder (nama, jenis, ukuran). Tanpa alamat = folder kerja.",
      parameters: props({ folder: { type: "string", description: process.platform === "win32" ? "Alamat folder, mis. C:\\Users\\Aku\\Documents atau nama folder relatif" : "Alamat folder, mis. /home/aku/dokumen atau nama folder relatif" } }),
      run: ({ folder }) => {
        const dir = folder ? here(folder) : config.workdir || rootsOf()[0];
        const ents = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 200);
        if (!ents.length) return `${dir} kosong.`;
        return `${dir}\n` + ents.map((e) => (e.isDirectory() ? `[folder] ${e.name}` : `${e.name}  (${fmtSize(fs.statSync(path.join(dir, e.name)).size)})`)).join("\n");
      }
    },
    {
      name: "cari_file",
      description: "Mencari berkas/folder berdasarkan potongan NAMA (tidak peka huruf besar-kecil), sampai 6 tingkat ke dalam. Tanpa folder = semua folder izin.",
      parameters: props({ nama: { type: "string", description: "Potongan nama, mis. 'laporan' atau '.xlsx'" }, folder: { type: "string" } }, ["nama"]),
      run: ({ nama, folder }) => {
        const q = str(nama).toLowerCase().trim();
        if (!q) throw new Error("Kata pencarian kosong.");
        const starts = folder ? [here(folder)] : rootsOf();
        const hits = [];
        for (const s of starts) {
          for (const e of walk(s)) {
            if (path.basename(e.full).toLowerCase().includes(q)) hits.push(`${e.dir ? "[folder] " : ""}${e.full}`);
            if (hits.length >= 50) break;
          }
        }
        return hits.length ? `${hits.length}${hits.length >= 50 ? "+" : ""} hasil:\n${hits.join("\n")}` : "Tidak ada yang cocok.";
      }
    },
    {
      name: "cari_isi",
      description: "Mencari kata di DALAM isi berkas teks (txt, md, csv, json, log, kode). Tanpa folder = semua folder izin.",
      parameters: props({ kata: { type: "string" }, folder: { type: "string" } }, ["kata"]),
      run: ({ kata, folder }) => {
        const q = str(kata).toLowerCase().trim();
        if (q.length < 2) throw new Error("Kata pencarian terlalu pendek.");
        const starts = folder ? [here(folder)] : rootsOf();
        const hits = [];
        for (const s of starts) {
          for (const e of walk(s, { maxDepth: 5, maxEntries: 8000 })) {
            if (e.dir || !TEXT_EXT.has(path.extname(e.full).toLowerCase())) continue;
            let st;
            try {
              st = fs.statSync(e.full);
            } catch {
              continue;
            }
            if (st.size > 2_000_000) continue;
            const lines = fs.readFileSync(e.full, "utf8").split(/\r?\n/);
            for (let i = 0; i < lines.length && hits.length < 40; i++) {
              if (lines[i].toLowerCase().includes(q)) hits.push(`${e.full}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
            }
            if (hits.length >= 40) break;
          }
        }
        return hits.length ? hits.join("\n") : "Tidak ada yang cocok.";
      }
    },
    {
      name: "baca_file",
      description: "Membaca isi berkas: teks, Word (.docx), Excel (.xlsx), PDF. Untuk berkas panjang pakai 'mulai' (nomor huruf awal) untuk membaca bagian berikutnya.",
      parameters: props({ file: { type: "string" }, mulai: { type: "integer", description: "Huruf ke berapa mulai membaca (bawaan 0)" } }, ["file"]),
      run: async ({ file, mulai }) => {
        const p = here(file);
        const start = Math.max(0, Number(mulai) || 0);
        const r = await readFileText(p, { maxChars: start + 6000 });
        const part = r.text.slice(start);
        return `${p} (${r.kind}, ${r.total} huruf)\n---\n${part}${r.truncated ? `\n---\n[masih ada lanjutan; panggil lagi dengan mulai=${start + 6000}]` : ""}`;
      }
    },
    {
      name: "cari_web",
      description: "Mencari di internet (DuckDuckGo). Hasil berupa judul, alamat, dan kutipan. Untuk detail, lanjutkan dengan buka_web.",
      parameters: props({ kata: { type: "string" } }, ["kata"]),
      run: async ({ kata }) => (await web.search(kata)).map((h, i) => `${i + 1}. ${h.title}\n${h.url}\n${h.snippet}`).join("\n\n")
    },
    {
      name: "buka_web",
      description: "Membuka satu halaman web dan mengambil teksnya.",
      parameters: props({ alamat: { type: "string", description: "URL lengkap (https://...)" } }, ["alamat"]),
      run: async ({ alamat }) => {
        const r = await web.fetchPage(alamat);
        return `${r.url}\n---\n${r.text}${r.truncated ? "\n[dipotong]" : ""}`;
      }
    },
    {
      name: "kirim_file",
      description: "Mengirim sebuah berkas dari laptop ke chat Telegram pemilik (maks 45 MB).",
      parameters: props({ file: { type: "string" } }, ["file"]),
      run: async ({ file }) => {
        if (!sendFile) throw new Error("Pengiriman berkas tidak tersedia.");
        const p = here(file);
        const st = fs.statSync(p);
        if (!st.isFile()) throw new Error("Itu bukan berkas.");
        if (st.size > 45 * 1024 * 1024) throw new Error("Berkas lebih dari 45 MB; terlalu besar untuk Telegram.");
        await sendFile(p);
        return `Berkas ${path.basename(p)} (${fmtSize(st.size)}) sudah dikirim ke Telegram.`;
      }
    },
    // ------------------------------------------------------------ perlu persetujuan
    {
      name: "tulis_file",
      approval: true,
      description: "Membuat berkas teks baru, atau menimpa/menambah berkas yang ada. Selalu minta persetujuan pemilik.",
      parameters: props({ file: { type: "string" }, isi: { type: "string" }, tambah: { type: "boolean", description: "true = tambahkan di akhir, bukan menimpa" } }, ["file", "isi"]),
      describe: ({ file, isi, tambah }) => {
        const p = here(file);
        const exists = fs.existsSync(p);
        return `${tambah ? "Menambah ke" : exists ? "MENIMPA" : "Membuat"} berkas:\n${p}\n(${str(isi).length} huruf)\n\nPratinjau:\n${clip(str(isi), 500)}`;
      },
      run: ({ file, isi, tambah }) => {
        const p = here(file);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        if (tambah) fs.appendFileSync(p, str(isi), "utf8");
        else fs.writeFileSync(p, str(isi), "utf8");
        return `Tersimpan: ${p} (${str(isi).length} huruf)`;
      }
    },
    {
      name: "buat_folder",
      approval: true,
      description: "Membuat folder baru.",
      parameters: props({ folder: { type: "string" } }, ["folder"]),
      describe: ({ folder }) => `Membuat folder:\n${here(folder)}`,
      run: ({ folder }) => {
        const p = here(folder);
        fs.mkdirSync(p, { recursive: true });
        return `Folder siap: ${p}`;
      }
    },
    {
      name: "pindah_file",
      approval: true,
      description: "Memindahkan atau mengganti nama berkas/folder. Tidak akan menimpa yang sudah ada.",
      parameters: props({ dari: { type: "string" }, ke: { type: "string" } }, ["dari", "ke"]),
      describe: ({ dari, ke }) => `Memindahkan/mengganti nama:\n${here(dari)}\n→ ${here(ke)}`,
      run: ({ dari, ke }) => {
        const a = here(dari);
        const b = here(ke);
        if (!fs.existsSync(a)) throw new Error("Sumber tidak ditemukan.");
        if (fs.existsSync(b)) throw new Error("Tujuan sudah ada; tidak ditimpa. Pakai nama lain.");
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.renameSync(a, b);
        return `Dipindah ke ${b}`;
      }
    },
    {
      name: "salin_file",
      approval: true,
      description: "Menyalin berkas. Tidak akan menimpa yang sudah ada.",
      parameters: props({ dari: { type: "string" }, ke: { type: "string" } }, ["dari", "ke"]),
      describe: ({ dari, ke }) => `Menyalin:\n${here(dari)}\n→ ${here(ke)}`,
      run: ({ dari, ke }) => {
        const a = here(dari);
        const b = here(ke);
        if (!fs.statSync(a).isFile()) throw new Error("Hanya berkas yang bisa disalin (bukan folder).");
        if (fs.existsSync(b)) throw new Error("Tujuan sudah ada; tidak ditimpa.");
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.copyFileSync(a, b);
        return `Disalin ke ${b}`;
      }
    },
    {
      name: "hapus_file",
      approval: true,
      description: "Membuang berkas/folder dengan memindahkannya ke folder _sampah di folder kerja (TIDAK dihapus permanen, bisa dikembalikan).",
      parameters: props({ file: { type: "string" } }, ["file"]),
      describe: ({ file }) => `Memindahkan ke _sampah (bukan hapus permanen):\n${here(file)}`,
      run: ({ file }) => {
        const p = here(file);
        if (!fs.existsSync(p)) throw new Error("Tidak ditemukan.");
        const trash = path.join(config.workdir || rootsOf()[0], "_sampah");
        if (p === trash || p.startsWith(trash + path.sep)) throw new Error("Itu sudah di _sampah.");
        if (rootsOf().some((r) => path.resolve(r) === p)) throw new Error("Folder induk yang diizinkan tidak boleh dibuang.");
        fs.mkdirSync(trash, { recursive: true });
        const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const dest = path.join(trash, `${stamp}-${path.basename(p)}`);
        fs.renameSync(p, dest);
        return `Dipindah ke ${dest}`;
      }
    },
    {
      name: "jalankan_perintah",
      approval: true,
      description: `Menjalankan satu perintah ${shellName()} di folder kerja. Selalu minta persetujuan pemilik; perintah berbahaya (sudo, hapus massal, matikan mesin, putus SSH, dll) ditolak permanen. Hasil teks dikembalikan. Perintah tidak boleh interaktif.`,
      parameters: props({ perintah: { type: "string", description: process.platform === "win32" ? "Perintah PowerShell, mis. Get-Process | Select -First 5" : "Perintah bash, mis. df -h atau ps aux --sort=-%cpu | head -5" } }, ["perintah"]),
      describe: ({ perintah }) => {
        const bad = commandProblem(perintah);
        if (bad) throw new SafetyError(bad);
        return `Menjalankan di ${shellName()} (folder ${config.workdir || rootsOf()[0]}):\n\n${str(perintah)}`;
      },
      run: async ({ perintah }) => {
        const bad = commandProblem(perintah);
        if (bad) throw new SafetyError(bad);
        const r = await exec(str(perintah), { cwd: config.workdir || rootsOf()[0], timeoutMs: config.commandTimeoutMs });
        const head = r.timedOut ? `Dihentikan: melewati ${Math.round(config.commandTimeoutMs / 1000)} detik.` : `Selesai (kode ${r.code}).`;
        return `${head}\n${clip(r.output.trim() || "(tanpa keluaran)")}`;
      }
    }
  ];
  const byName = new Map(list.map((t) => [t.name, t]));
  return {
    list,
    get: (n) => byName.get(n),
    /** Skema fungsi untuk Ollama. Mode "baca": alat pengubah tidak ditawarkan sama sekali. */
    schemas: () => list.filter((t) => !(config.mode === "baca" && t.approval)).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
  };
}
