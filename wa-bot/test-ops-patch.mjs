// Tes penerapan patch zip + git lewat ops.js (zip-lite.js, ops-patch.js). Git sungguhan di folder sementara.
//   node test-ops-patch.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { readZip, ZipError } from "./zip-lite.js";
import { applyPatch, isProtectedPath, latestPatchBackup, normalizeEntryName, planPatch, resolvePlan, suggestNextSteps, undoPatch } from "./ops-patch.js";
import { createOps, readOpsConfig } from "./ops.js";
import { createTelegram } from "./telegram.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-patch-"));

// ---- penulis zip kecil untuk tes
function makeZip(files, { mode = 0o100644, flags = 0, method } = {}) {
  const locals = [];
  const cens = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = Buffer.from(f.data ?? "");
    const useDeflate = (f.method ?? method ?? 8) === 8 && data.length > 0;
    const comp = useDeflate ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800 | (f.flags ?? flags), 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800 | (f.flags ?? flags), 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((f.mode ?? (f.name.endsWith("/") ? 0o040755 : mode)) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    cens.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cen = Buffer.concat(cens);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cen.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cen, end]);
}

// ---- zip-lite
{
  const z = makeZip([{ name: "a/b.txt", data: "halo dunia ".repeat(50) }, { name: "kosong.txt", data: "" }, { name: "simpan.txt", data: "polos", method: 0 }, { name: "folder/" }]);
  const e = readZip(z);
  check(e.length === 4 && e[0].read().toString() === "halo dunia ".repeat(50) && e[1].read().length === 0 && e[2].read().toString() === "polos" && e[3].isDir, "zip: deflate, kosong, simpan, folder terbaca");
  // zip buatan alat `zip` asli (bila terpasang): memastikan pembaca kompatibel dengan zip sungguhan
  try {
    const zd = path.join(tmp, "realzip");
    fs.mkdirSync(path.join(zd, "d"), { recursive: true });
    fs.writeFileSync(path.join(zd, "d", "a.txt"), "isi ".repeat(500));
    fs.writeFileSync(path.join(zd, "b.txt"), "b");
    execFileSync("zip", ["-q", "-r", path.join(tmp, "real.zip"), "d", "b.txt"], { cwd: zd });
    const real = readZip(fs.readFileSync(path.join(tmp, "real.zip")));
    check(real.filter((x) => !x.isDir).length === 2 && real.every((x) => x.isDir || x.read().length === x.size) && real.find((x) => x.name === "d/a.txt").read().toString() === "isi ".repeat(500), "zip: zip buatan `zip` asli terbaca dan isinya cocok");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    console.log("lewati: alat `zip` tidak terpasang");
  }
  const err = (b, o) => { try { readZip(b, o); return null; } catch (x) { return x; } };
  check(err(Buffer.from("bukan zip sama sekali, cuma teks")) instanceof ZipError, "zip: sampah ditolak");
  check(/simlink/.test(err(makeZip([{ name: "l", data: "x", mode: 0o120777 }]))?.message), "zip: simlink ditolak");
  check(/terenkripsi/.test(err(makeZip([{ name: "x", data: "x", flags: 1 }]))?.message), "zip: terenkripsi ditolak");
  check(/terlalu besar/.test(err(makeZip([{ name: "x", data: "x".repeat(100) }]), { maxFileBytes: 10 })?.message), "zip: batas ukuran berkas");
  check(/terlalu banyak/.test(err(makeZip([{ name: "a", data: "1" }, { name: "b", data: "2" }]), { maxEntries: 1 })?.message), "zip: batas jumlah berkas");
  const trunc = makeZip([{ name: "x", data: "isi yang cukup panjang ".repeat(20) }]);
  check(err(trunc.subarray(0, trunc.length - 30)) instanceof ZipError, "zip: terpotong ditolak");
}

// ---- aturan path
{
  const prot = [".env", "wa-bot/.env", "wa-bot/.env.local", "wa-bot/auth_session/creds.json", "dokumen/a.md", "wa-bot/kb/index.sqlite", "node_modules/x/y.js", "wa-bot/node_modules/z", ".git/config", ".ops-backup/1/x", "wa-bot/ops-audit.log", "a/b.sqlite", "kunci.pem", "id_rsa", ".GIT/HEAD", "WA-BOT/.ENV"];
  const okp = ["wa-bot/.env.example", "wa-bot/index.js", "src/main.js", "supabase/migrations/0038.sql", ".gitignore", ".github/workflows/x.yml", "README.md", "wa-bot/test-fixtures/peraturan.pdf"];
  check(prot.every(isProtectedPath), "dilindungi: .env, auth_session, dokumen, kb, .git, node_modules, cadangan, sqlite, kunci");
  check(okp.every((p) => !isProtectedPath(p)), "tidak dilindungi: .env.example, kode, migrasi, .gitignore, .github");
  const bad = ["../x", "a/../../x", "/etc/passwd", "C:\\x", "a\\b", "a/./b", "x\0y", ""];
  check(bad.every((n) => !normalizeEntryName(n).ok) && normalizeEntryName("wa-bot//index.js").rel === "wa-bot/index.js", "nama zip: traversal, absolut, backslash, titik ditolak; // dirapikan");
}

// ---- rencana, terapkan, urungkan
const proj = path.join(tmp, "proj");
const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true }); fs.writeFileSync(path.join(proj, rel), text); };
const r = (rel) => fs.readFileSync(path.join(proj, rel), "utf8");
w("wa-bot/index.js", "lama"); w("wa-bot/sama.js", "tetap"); w("wa-bot/.env", "RAHASIA=1"); w("src/main.js", "m-lama");
fs.mkdirSync(path.join(tmp, "luar")); fs.symlinkSync(path.join(tmp, "luar"), path.join(proj, "tautan"));
{
  const good = makeZip([{ name: "wa-bot/index.js", data: "baru" }, { name: "wa-bot/sama.js", data: "tetap" }, { name: "wa-bot/fitur.js", data: "fitur" }, { name: "src/", data: "" }, { name: "__MACOSX/x", data: "j" }, { name: "supabase/migrations/0099_x.sql", data: "select 1;" }]);
  const plan = resolvePlan(planPatch(readZip(good), proj), proj);
  const st = Object.fromEntries(plan.files.map((f) => [f.rel, f.status]));
  check(plan.rejected.length === 0 && plan.skipped === 1 && st["wa-bot/index.js"] === "changed" && st["wa-bot/sama.js"] === "same" && st["wa-bot/fitur.js"] === "new", "rencana: baru / berubah / sama; sampah macOS dilewati");

  const rej = (entries) => planPatch(readZip(makeZip(entries)), proj).rejected.map((x) => x.reason);
  check(rej([{ name: "../evil.js", data: "x" }])[0]?.includes("keluar"), "rencana: ../ ditolak");
  check(rej([{ name: "wa-bot/.env", data: "x" }])[0] === "file dilindungi", "rencana: .env ditolak");
  check(rej([{ name: "wa-bot/auth_session/creds.json", data: "x" }]).length === 1, "rencana: auth_session ditolak");
  check(rej([{ name: "/tmp/x", data: "x" }]).length === 1 && rej([{ name: "a\\b", data: "x" }]).length === 1, "rencana: absolut/backslash ditolak");
  check(rej([{ name: "tautan/x.js", data: "x" }]).length === 1 || rej([{ name: "tautan", data: "x" }]).length === 1, "rencana: tujuan lewat simlink ditolak");
  check(rej([{ name: "a.js", data: "1" }, { name: "a.js", data: "2" }])[0] === "nama ganda di zip", "rencana: nama ganda ditolak");

  const ap = applyPatch(plan, proj, { zipSha: "abc", name: "patch-x.zip", now: () => new Date(2026, 9, 4, 10, 30, 0) });
  check(r("wa-bot/index.js") === "baru" && r("wa-bot/fitur.js") === "fitur" && r("wa-bot/sama.js") === "tetap" && r("wa-bot/.env") === "RAHASIA=1" && r("src/main.js") === "m-lama", "terapkan: berubah+baru ditulis; sama, .env, lainnya utuh");
  check(path.basename(ap.dir) === "20261004-103000" && fs.readFileSync(path.join(ap.dir, "files/wa-bot/index.js"), "utf8") === "lama", "terapkan: file lama dicadangkan");
  check(ap.written.join() === "wa-bot/index.js" && ap.created.sort().join() === "supabase/migrations/0099_x.sql,wa-bot/fitur.js", "terapkan: manifest benar");
  check(fs.readdirSync(path.join(proj, "wa-bot")).every((n) => !n.includes("ops-tmp")), "terapkan: tidak ada berkas sementara tersisa");
  const last = latestPatchBackup(proj);
  check(last && last.manifest.zip === "patch-x.zip", "cadangan terakhir ditemukan");
  const u = undoPatch(last.dir, proj);
  check(u.restored === 1 && u.removed === 2 && r("wa-bot/index.js") === "lama" && !fs.existsSync(path.join(proj, "wa-bot/fitur.js")), "urungkan: dikembalikan, file baru dihapus");
  check(latestPatchBackup(proj) === null, "urungkan: tidak bisa dua kali");
  const steps = suggestNextSteps(["wa-bot/index.js", "supabase/functions/chat/index.ts", "supabase/migrations/0099_x.sql", "src/main.js", "wa-bot/package.json"], ["chat", "study"]);
  check(steps.some((x) => x.startsWith("/tes")) && steps.includes("/deploy chat") && !steps.includes("/deploy study") && steps.some((x) => x.startsWith("/migrasi")) && steps.some((x) => x.startsWith("/restart")) && steps.some((x) => x.includes("npm install")) && steps.at(-1).startsWith("/rilis"), "saran langkah berikutnya sesuai file yang berubah");
}

// ---- ops: patch lewat handleDocument
const baseEnv = { ...process.env, HOME: tmp, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@x.id", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@x.id", GIT_CONFIG_NOSYSTEM: "1" };
function makeOps(over = {}) {
  const calls = [];
  const sent = [];
  const clock = { t: 1_000_000 };
  const cfg = { ...readOpsConfig({ OPS_ENABLED: "true", ...(over.cfg || {}) }, path.join(over.dir || proj, "wa-bot")), auditFile: path.join(tmp, "audit.log"), projectDir: over.dir || proj };
  const ops = createOps({ config: cfg, deps: over.run ? { run: async (c, a, o) => (calls.push({ c, a, o }), over.run(c, a, o)) } : {}, env: baseEnv, now: () => clock.t, rand: () => 0.5, log: silent });
  const send = async (t) => void sent.push(t);
  return { ops, sent, send, calls, clock, h: (n, a = "", o = {}) => ops.handle(n, a, { chatId: 111, send, ...o }), doc: (name, buf, o = {}) => ops.handleDocument({ chatId: 111, fileName: name, size: buf.length, download: async () => buf, send, ...o }) };
}
{
  const t = makeOps();
  const patch = makeZip([{ name: "wa-bot/index.js", data: "versi-2" }, { name: "wa-bot/ops.js", data: "ops baru" }, { name: "supabase/functions/chat/index.ts", data: "export {}" }, { name: "supabase/migrations/0100_a.sql", data: "select 2;" }]);
  check((await t.doc("catatan.txt", patch)) === undefined, "patch: bukan zip -> bukan urusan ops");
  check(/diawali "patch"/.test(await t.doc("data.zip", patch)), "patch: zip tanpa awalan 'patch' ditolak dengan petunjuk");
  check(/dimatikan/.test(await makeOps({ cfg: { OPS_ENABLED: "false" } }).doc("patch-a.zip", patch)), "patch: OPS mati -> pesan");
  check(/OPS_PATCH_ENABLED=false/.test(await makeOps({ cfg: { OPS_PATCH_ENABLED: "false" } }).doc("patch-a.zip", patch)), "patch: OPS_PATCH_ENABLED=false -> pesan");
  check(/tidak diizinkan/.test(await makeOps({ cfg: { OPS_TELEGRAM_IDS: "222" } }).doc("patch-a.zip", patch)), "patch: id tidak diizinkan");
  check(/ditolak/.test(await t.doc("patch-rusak.zip", Buffer.from("bukan zip betulan di sini ya"))), "patch: zip rusak ditolak");
  const evil = makeZip([{ name: "wa-bot/index.js", data: "x" }, { name: "wa-bot/.env", data: "x" }, { name: "../keluar.js", data: "x" }]);
  const ev = await t.doc("patch-evil.zip", evil);
  check(ev.includes("ditolak seluruhnya") && ev.includes("wa-bot/.env") && r("wa-bot/index.js") === "lama", "patch: satu path berbahaya -> SELURUH zip ditolak, tidak ada yang ditulis");
  check(/Tidak ada perintah/.test(await t.h("ya", "5500")), "patch: penolakan tidak meninggalkan konfirmasi");

  const same = makeZip([{ name: "wa-bot/index.js", data: "lama" }]);
  check(/sudah sama persis/.test(await t.doc("patch-sama.zip", same)), "patch: semua sama -> tidak ada yang diterapkan");

  const ask = await t.doc("patch-ops.zip", patch);
  check(ask.includes("2 baru, 2 berubah") === false && ask.includes("terapkan patch-ops.zip") && ask.includes("+ supabase/migrations/0100_a.sql") && ask.includes("~ wa-bot/index.js") && ask.includes("modul perintah laptop") && ask.includes("/ya 5500") && ask.includes("180 detik"), "patch: ringkasan (+/~), peringatan modul ops, kode, TTL 180 dtk");
  check(r("wa-bot/index.js") === "lama", "patch: belum ada yang ditulis sebelum /ya");
  check(/Kode tidak cocok/.test(await t.h("ya", "0000")) && r("wa-bot/index.js") === "lama", "patch: kode salah -> batal, tidak ada yang ditulis");
  await t.doc("patch-ops.zip", patch);
  t.clock.t += 120_000;
  await t.h("ya", "5500");
  await t.ops.whenIdle();
  const msg = t.send && t.sent.at(-1);
  check(r("wa-bot/index.js") === "versi-2" && r("wa-bot/ops.js") === "ops baru" && r("wa-bot/.env") === "RAHASIA=1", "patch: diterapkan setelah /ya (120 dtk < TTL 180)");
  check(msg.includes("Patch diterapkan") && msg.includes("/tes") && msg.includes("/deploy chat") && msg.includes("/migrasi") && msg.includes("/restart") && msg.includes("/rilis") && msg.includes("/urungkan"), "patch: hasil + saran langkah berikutnya");

  const q = await t.h("urungkan");
  check(q.includes("urungkan patch patch-ops.zip") && q.includes("/ya"), "urungkan: minta konfirmasi");
  await t.h("ya", "5500"); await t.ops.whenIdle();
  check(r("wa-bot/index.js") === "lama" && !fs.existsSync(path.join(proj, "wa-bot/ops.js")) && t.sent.at(-1).includes("/restart"), "urungkan: kembali ke kondisi awal");
  check(/Tidak ada patch/.test(await t.h("urungkan")), "urungkan: tidak ada lagi");
  const log = fs.readFileSync(path.join(tmp, "audit.log"), "utf8");
  check(/PATCH diterima patch-ops.zip/.test(log) && /PATCH diterapkan/.test(log) && /PATCH diurungkan/.test(log) && /PATCH ditolak/.test(log), "audit: patch tercatat");
}

// ---- /tes
{
  const ok = makeOps({ run: async () => ({ code: 0, stdout: "a\nSEMUA TES LULUS\n", stderr: "" }) });
  await ok.h("tes"); await ok.ops.whenIdle();
  check(ok.calls[0].c === "npm" && ok.calls[0].a.join() === "test" && ok.calls[0].o.cwd === path.join(proj, "wa-bot") && ok.sent.at(-1).startsWith("✅ Semua tes lulus"), "tes: npm test di folder wa-bot, lulus");
  const bad = makeOps({ run: async () => ({ code: 1, stdout: "ok: a\nFAIL: sesuatu rusak\n", stderr: "" }) });
  await bad.h("tes"); await bad.ops.whenIdle();
  check(bad.sent.at(-1).startsWith("❌ Tes gagal") && bad.sent.at(-1).includes("FAIL: sesuatu rusak"), "tes: gagal -> baris FAIL ditampilkan");
}

// ---- git sungguhan
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, env: baseEnv, encoding: "utf8" }).trim();
const remote = path.join(tmp, "remote.git");
sh(tmp, "init", "-q", "--bare", "-b", "main", remote);
const repo = path.join(tmp, "repo");
sh(tmp, "clone", "-q", remote, repo);
fs.mkdirSync(path.join(repo, "wa-bot"), { recursive: true });
fs.writeFileSync(path.join(repo, "a.txt"), "1\n");
fs.writeFileSync(path.join(repo, ".gitignore"), ".env\n");
sh(repo, "add", "-A"); sh(repo, "commit", "-q", "-m", "awal"); sh(repo, "push", "-q", "-u", "origin", "main");
{
  const t = makeOps({ dir: repo });
  const g0 = await t.h("git");
  check(g0.includes("cabang main → origin/main") && g0.includes("Tidak ada perubahan") && g0.includes("Semua commit sudah di-push") && g0.includes("awal"), "git: status bersih + commit terakhir");
  check(/Tidak ada perubahan untuk di-commit/.test(await t.h("commit", "x")), "commit: tidak ada perubahan");

  fs.writeFileSync(path.join(repo, "a.txt"), "2\n"); fs.writeFileSync(path.join(repo, "baru.js"), "x\n"); fs.writeFileSync(path.join(repo, ".env"), "RAHASIA\n");
  const g1 = await t.h("git");
  check(g1.includes("2 file berubah") && g1.includes("M a.txt") && g1.includes("? baru.js") && !g1.includes(".env"), "git: perubahan terdaftar, .env (diabaikan git) tidak muncul");
  check(/Pakai: \/commit/.test(await t.h("commit", "")) && /Pakai: \/commit/.test(await t.h("commit", "ab")), "commit: pesan wajib (min. 3 huruf)");

  const q = await t.h("commit", "tambah   fitur\nbaru");
  check(q.includes("commit 2 file «tambah fitur baru»") && q.includes("M a.txt") && q.includes("/ya 5500"), "commit: konfirmasi memuat pesan (dirapikan) dan daftar file");
  check(sh(repo, "log", "--oneline").split("\n").length === 1, "commit: belum ada commit sebelum /ya");
  await t.h("ya", "5500"); await t.ops.whenIdle();
  check(sh(repo, "log", "-1", "--pretty=%s") === "tambah fitur baru" && t.sent.at(-1).startsWith("✅ Commit dibuat (2 file)"), "commit: dibuat setelah /ya");
  check(!sh(repo, "ls-files").includes(".env") && sh(repo, "status", "--porcelain") === "", "commit: .env tidak ikut");

  const ps = await t.h("push");
  check(ps.includes("push 1 commit ke origin/main") && sh(remote, "log", "--oneline", "main").split("\n").length === 1, "push: konfirmasi, remote belum berubah");
  await t.h("ya", "5500"); await t.ops.whenIdle();
  check(t.sent.at(-1).startsWith("✅ Push selesai") && sh(remote, "log", "-1", "--pretty=%s", "main") === "tambah fitur baru", "push: sampai ke remote");
  check(/Tidak ada commit yang perlu di-push/.test(await t.h("push")), "push: tidak ada yang perlu di-push");

  // file sensitif yang TIDAK diabaikan git harus menghentikan commit
  fs.writeFileSync(path.join(repo, ".env.local"), "RAHASIA\n");
  const bad = await t.h("commit", "jangan");
  check(bad.startsWith("❌ Ditolak") && bad.includes(".env.local"), "commit: file sensitif tak-terabaikan -> ditolak sebelum konfirmasi");
  fs.unlinkSync(path.join(repo, ".env.local"));

  // /rilis = commit + push
  fs.writeFileSync(path.join(repo, "rilis.txt"), "r\n");
  const rq = await t.h("rilis", "rilis percobaan");
  check(rq.includes("commit 1 file «rilis percobaan» lalu push ke origin/main"), "rilis: satu konfirmasi untuk commit + push");
  await t.h("ya", "5500"); await t.ops.whenIdle();
  check(sh(remote, "log", "-1", "--pretty=%s", "main") === "rilis percobaan" && /Commit dibuat/.test(t.sent.at(-1)) && /Push selesai/.test(t.sent.at(-1)), "rilis: commit dan push sampai ke remote");
  check(/Pakai: \/rilis/.test((fs.writeFileSync(path.join(repo, "z.txt"), "z"), await t.h("rilis", ""))), "rilis: pesan wajib");
  fs.unlinkSync(path.join(repo, "z.txt"));

  // cabang baru tanpa upstream -> push -u origin HEAD
  sh(repo, "checkout", "-q", "-b", "fitur-x");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const nu = await t.h("rilis", "cabang baru");
  check(nu.includes("push cabang fitur-x ke origin (-u)"), "rilis: cabang tanpa upstream memakai push -u origin");
  await t.h("ya", "5500"); await t.ops.whenIdle();
  check(sh(remote, "branch", "--list", "fitur-x").includes("fitur-x") && sh(repo, "rev-parse", "--abbrev-ref", "@{u}") === "origin/fitur-x", "rilis: cabang baru terbentuk di remote dan upstream terpasang");

  // push ditolak (remote lebih baru) -> dilaporkan, tidak dipaksa
  const other = path.join(tmp, "other");
  sh(tmp, "clone", "-q", "-b", "main", remote, other);
  fs.writeFileSync(path.join(other, "o.txt"), "o\n"); sh(other, "add", "-A"); sh(other, "commit", "-q", "-m", "dari tempat lain"); sh(other, "push", "-q");
  sh(repo, "checkout", "-q", "main");
  fs.writeFileSync(path.join(repo, "l.txt"), "l\n");
  await t.h("rilis", "bentrok"); await t.h("ya", "5500"); await t.ops.whenIdle();
  check(t.sent.at(-1).includes("❌ git push gagal") && t.sent.at(-1).includes("Commit dibuat") && /gabungkan dulu/.test(t.sent.at(-1)) && sh(remote, "log", "-1", "--pretty=%s", "main") === "dari tempat lain", "push ditolak: dilaporkan, remote tidak ditimpa (tanpa --force)");

  check(!!makeOps({ dir: repo, cfg: { OPS_GIT_ENABLED: "false" } }) && /git dimatikan/.test(await makeOps({ dir: repo, cfg: { OPS_GIT_ENABLED: "false" } }).h("rilis", "x")), "git: OPS_GIT_ENABLED=false mematikan perintah git");
}
{
  const nogit = path.join(tmp, "bukanrepo");
  fs.mkdirSync(nogit);
  const t = makeOps({ dir: nogit });
  check(/Git bermasalah/.test(await t.h("git")), "git: folder bukan repositori -> pesan jelas");
}

// ---- integrasi Telegram: dokumen
{
  const sent = [];
  const sentDocs = [];
  const f = async (url, init) => {
    const u = String(url);
    const b = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    const json = (o) => ({ status: 200, ok: true, json: async () => o });
    if (u.endsWith("/getFile")) return json({ ok: true, result: { file_path: "documents/p.zip" } });
    if (u.includes("/file/bot")) return { status: 200, ok: true, arrayBuffer: async () => new Uint8Array(Buffer.from("ISI-ZIP")).buffer };
    if (u.endsWith("/sendMessage")) sent.push(b.text);
    return json({ ok: true, result: { message_id: 1 } });
  };
  const ops = { commands: ["ya"], handleDocument: async (o) => { sentDocs.push({ ...o, body: (await o.download()).toString() }); return o.fileName === "patch-a.zip" ? "balasan patch" : undefined; }, handle: async () => undefined };
  const cfg = { token: "T", enabled: true, ownerIds: ["111"], mirror: true, historyLimit: 4, pollTimeoutSec: 1, speakText: true };
  const tg = createTelegram({ config: cfg, deps: { chat: async () => "ai", ops }, fetchImpl: f, log: silent });
  await tg.handleUpdate({ update_id: 1, message: { chat: { id: 111, type: "private" }, document: { file_id: "F1", file_name: "patch-a.zip", file_size: 7 } } });
  check(sentDocs[0].body === "ISI-ZIP" && sentDocs[0].fileName === "patch-a.zip" && sentDocs[0].chatId === "111" && sent.at(-1) === "balasan patch", "telegram: dokumen diunduh dan diserahkan ke ops, balasan dikirim");
  await tg.handleUpdate({ update_id: 2, message: { chat: { id: 111, type: "private" }, document: { file_id: "F2", file_name: "foto.pdf", file_size: 7 } } });
  check(/patch\*\.zip/.test(sent.at(-1)), "telegram: dokumen lain -> balasan umum yang menyebut patch*.zip");
  await tg.handleUpdate({ update_id: 3, message: { chat: { id: 222, type: "private" }, document: { file_id: "F3", file_name: "patch-a.zip", file_size: 7 } } });
  check(sentDocs.length === 2, "telegram: dokumen dari non-pemilik diabaikan");
  const tg2 = createTelegram({ config: cfg, deps: { chat: async () => "ai" }, fetchImpl: f, log: silent });
  await tg2.handleUpdate({ update_id: 4, message: { chat: { id: 111, type: "private" }, document: { file_id: "F1", file_name: "patch-a.zip", file_size: 7 } } });
  check(sentDocs.length === 2 && /membaca pesan teks/.test(sent.at(-1)), "telegram: tanpa ops terpasang -> balasan umum");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails === 0 ? "\nSEMUA TES LULUS" : `\n${fails} TES GAGAL`);
process.exit(fails === 0 ? 0 : 1);
