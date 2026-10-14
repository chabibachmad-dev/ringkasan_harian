// Menerapkan zip patch ke folder proyek dengan aman (dipakai ops.js, lewat Telegram).
//
// Prinsip:
//   - Path di dalam zip harus relatif terhadap akar proyek (mis. "wa-bot/index.js", "src/main.js").
//   - Ditolak SELURUHNYA bila ada path berbahaya (absolut, "..", backslash, simlink) atau file yang dilindungi
//     (.env, auth_session, dokumen/, indeks/kb, .git, node_modules, cadangan).
//   - Sebelum menimpa, file lama disalin ke <proyek>/.ops-backup/<waktu>/files/... dan dicatat di manifest.json,
//     sehingga bisa diurungkan (undoPatch). Penulisan lewat berkas sementara + rename (tidak pernah setengah tertulis).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BACKUP_DIRNAME = ".ops-backup";
const KEEP_BACKUPS = 10;

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** true bila path (relatif, gaya posix) tidak boleh ditimpa/di-commit. */
export function isProtectedPath(rel) {
  const p = String(rel).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const segs = p.split("/");
  const base = segs[segs.length - 1];
  if (segs[0] === ".git" || segs.includes(".git")) return true;
  if (segs.includes("node_modules")) return true;
  if (segs.includes("auth_session")) return true;
  if (segs[0] === "dokumen" || segs[0] === BACKUP_DIRNAME) return true;
  if (p.startsWith("wa-bot/kb/")) return true;
  if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) return true;
  if (base === "ops-audit.log") return true;
  if (/\.(sqlite3?|db|pem|key|p12|pfx)$/.test(base)) return true;
  if (base === "id_rsa" || base === "id_ed25519" || base === "credentials.json") return true;
  return false;
}

/** Periksa satu nama berkas di zip. Mengembalikan { ok, rel } atau { ok:false, reason }. */
export function normalizeEntryName(name) {
  const n = String(name);
  if (n.includes("\0")) return { ok: false, reason: "karakter terlarang" };
  if (n.includes("\\")) return { ok: false, reason: "backslash" };
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return { ok: false, reason: "path absolut" };
  const segs = n.split("/").filter((s) => s !== "");
  if (segs.length === 0) return { ok: false, reason: "kosong" };
  if (segs.some((s) => s === ".." || s === ".")) return { ok: false, reason: "path keluar folder (..)" };
  return { ok: true, rel: segs.join("/") };
}

const JUNK = (rel) => rel.startsWith("__MACOSX/") || rel.endsWith("/.DS_Store") || rel === ".DS_Store" || rel.endsWith("/Thumbs.db");

/**
 * Susun rencana dari isi zip. Tidak menulis apa pun.
 * @returns {{ files: {rel, status, size, entry}[], rejected: {name, reason}[], skipped: number }}
 */
export function planPatch(entries, projectDir) {
  const root = path.resolve(projectDir);
  const files = [];
  const rejected = [];
  let skipped = 0;
  const seen = new Set();
  for (const entry of entries) {
    if (entry.isDir) continue;
    const norm = normalizeEntryName(entry.name);
    if (!norm.ok) {
      rejected.push({ name: entry.name, reason: norm.reason });
      continue;
    }
    const rel = norm.rel;
    if (JUNK(rel)) {
      skipped++;
      continue;
    }
    if (isProtectedPath(rel)) {
      rejected.push({ name: rel, reason: "file dilindungi" });
      continue;
    }
    if (seen.has(rel)) {
      rejected.push({ name: rel, reason: "nama ganda di zip" });
      continue;
    }
    seen.add(rel);
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep)) {
      rejected.push({ name: rel, reason: "keluar dari folder proyek" });
      continue;
    }
    // tidak boleh menulis lewat simlink (baik berkas maupun folder induk di dalam proyek)
    let blocked = false;
    let cur = root;
    for (const seg of rel.split("/")) {
      cur = path.join(cur, seg);
      try {
        if (fs.lstatSync(cur).isSymbolicLink()) {
          blocked = true;
          break;
        }
      } catch {
        break; // belum ada: aman
      }
    }
    if (blocked) {
      rejected.push({ name: rel, reason: "tujuan adalah simlink" });
      continue;
    }
    let status = "new";
    try {
      const st = fs.statSync(target);
      if (!st.isFile()) {
        rejected.push({ name: rel, reason: "tujuan bukan berkas biasa" });
        continue;
      }
      status = "changed";
    } catch {
      status = "new";
    }
    files.push({ rel, status, size: entry.size, entry });
  }
  return { files, rejected, skipped };
}

/** Isi zip dibaca & dibandingkan dengan file yang ada (hash). Mengisi status 'same' dan data. */
export function resolvePlan(plan, projectDir) {
  const root = path.resolve(projectDir);
  for (const f of plan.files) {
    f.data = f.entry.read();
    if (f.status === "changed") {
      const cur = fs.readFileSync(path.join(root, f.rel));
      if (sha256(cur) === sha256(f.data)) f.status = "same";
    }
  }
  return plan;
}

const stamp = (d) => {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
};

function writeAtomic(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.ops-tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

/** Terapkan rencana (hanya 'new' dan 'changed'). Mengembalikan { dir, written, created }. */
export function applyPatch(plan, projectDir, { zipSha = "", now = () => new Date(), name = "" } = {}) {
  const root = path.resolve(projectDir);
  const backupRoot = path.join(root, BACKUP_DIRNAME);
  let dir = path.join(backupRoot, stamp(now()));
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(backupRoot, `${stamp(now())}-${i}`);
  const todo = plan.files.filter((f) => f.status !== "same");
  const manifest = { when: now().toISOString(), zip: name, sha256: zipSha, written: [], created: [], undone: false };
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  const saveManifest = () => fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  saveManifest();
  try {
    for (const f of todo) {
      const target = path.join(root, f.rel);
      if (f.status === "changed") {
        const bak = path.join(dir, "files", f.rel);
        fs.mkdirSync(path.dirname(bak), { recursive: true });
        fs.copyFileSync(target, bak);
        manifest.written.push(f.rel);
      } else {
        manifest.created.push(f.rel);
      }
      saveManifest();
      writeAtomic(target, f.data);
    }
  } catch (e) {
    // gagal di tengah jalan: kembalikan semuanya
    try {
      undoPatch(dir, root);
    } catch {
      /* semoga cadangan cukup; pesan galat tetap dilempar */
    }
    throw e;
  }
  pruneBackups(backupRoot);
  return { dir, written: manifest.written, created: manifest.created };
}

function pruneBackups(backupRoot) {
  try {
    const names = fs.readdirSync(backupRoot).filter((n) => fs.existsSync(path.join(backupRoot, n, "manifest.json"))).sort();
    for (const n of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) fs.rmSync(path.join(backupRoot, n), { recursive: true, force: true });
  } catch {
    /* bukan masalah besar */
  }
}

/** Cadangan patch terakhir yang belum diurungkan, atau null. */
export function latestPatchBackup(projectDir) {
  const backupRoot = path.join(path.resolve(projectDir), BACKUP_DIRNAME);
  let names = [];
  try {
    names = fs.readdirSync(backupRoot).sort().reverse();
  } catch {
    return null;
  }
  for (const n of names) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(backupRoot, n, "manifest.json"), "utf8"));
      if (!manifest.undone) return { dir: path.join(backupRoot, n), name: n, manifest };
    } catch {
      /* lewati */
    }
  }
  return null;
}

/** Kembalikan file lama dari cadangan dan hapus file baru yang dibuat patch. */
export function undoPatch(dir, projectDir) {
  const root = path.resolve(projectDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  let restored = 0;
  let removed = 0;
  for (const rel of manifest.written) {
    const src = path.join(dir, "files", rel);
    if (fs.existsSync(src) && !isProtectedPath(rel)) {
      writeAtomic(path.join(root, rel), fs.readFileSync(src));
      restored++;
    }
  }
  for (const rel of manifest.created) {
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep) || isProtectedPath(rel)) continue;
    try {
      fs.unlinkSync(target);
      removed++;
    } catch {
      /* sudah tidak ada */
    }
  }
  manifest.undone = true;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { restored, removed };
}

/** Saran langkah berikutnya menurut file yang berubah. */
export function suggestNextSteps(rels, functions = []) {
  const steps = [];
  const fnSet = new Set();
  for (const r of rels) {
    const m = /^supabase\/functions\/([^/]+)\//.exec(r);
    if (m && m[1] !== "_shared") fnSet.add(m[1]);
    if (/^supabase\/functions\/_shared\//.test(r)) for (const f of functions) fnSet.add(f);
  }
  const bot = rels.some((r) => r.startsWith("wa-bot/"));
  if (bot) steps.push("/tes — jalankan tes otomatis dulu");
  const migr = rels.filter((r) => /^supabase\/migrations\/.+\.sql$/.test(r));
  if (migr.length) steps.push(`/migrasi — ${migr.length} migrasi baru`);
  for (const f of functions) if (fnSet.has(f)) steps.push(`/deploy ${f}`);
  if (bot) steps.push("/restart — bot memakai kode baru");
  if (rels.some((r) => /^(src\/|public\/|index\.html$|vite\.config\.js$|package\.json$)/.test(r))) steps.push("aplikasi (PWA) ikut ter-update setelah di-push, bila hosting-mu mengambil dari GitHub");
  if (rels.some((r) => r === "wa-bot/package.json" || r === "wa-bot/package-lock.json" || r === "package.json" || r === "package-lock.json")) steps.push("⚠️ package.json berubah: jalankan `npm install` di folder terkait secara manual");
  steps.push("/rilis <pesan> — commit + push ke GitHub");
  return steps;
}
