// Tes pemilih mesin ikon 3D (Blender vs JS). Blender asli hanya diuji bila modul bpy tersedia; selain itu memakai "Blender palsu" berupa skrip shell.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { modeIkon3d, hexPalet, temukanBlender, render3dPilih, SKRIP_BLENDER } from "./stok-adobe/ikon3d-pilih.mjs";
import { PALET } from "./stok-adobe/ikon3d.mjs";

let fails = 0;
const check = (ok, nama) => { console.log(`${ok ? "ok  " : "GAGAL"} ${nama}`); if (!ok) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3dp-"));
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#000" d="M32 6 L58 58 L6 58 Z"/></svg>`;

check(modeIkon3d({}) === "js" && modeIkon3d({ STOK_3D: "Blender" }) === "blender" && modeIkon3d({ STOK_3D: "auto" }) === "auto" && modeIkon3d({ STOK_3D: "ngawur" }) === "js", "mode: bawaan js, nilai ngawur jatuh ke js");
check(hexPalet("zamrud") === PALET.zamrud[1] && hexPalet(["#111111", "#222222", "#333333"]) === "#222222" && hexPalet("tidak-ada") === PALET.zamrud[1], "hexPalet: warna dasar palet");
check(temukanBlender({ BLENDER_BIN: "/x/blender" }).perintah === "/x/blender" && temukanBlender({ BLENDER_BIN: "/x/blender" }).awalan.includes("--"), "temukanBlender: BLENDER_BIN");
check(temukanBlender({ STOK_BPY_PYTHON: "/x/py" }).jenis === "bpy" && temukanBlender({ STOK_BPY_PYTHON: "/x/py" }).awalan[0] === SKRIP_BLENDER, "temukanBlender: modul bpy");

// mode js
{
  const r = await render3dPilih({ svg: SVG, keluar: path.join(tmp, "a.jpg"), ukuran: 400, palet: "emas", bahan: "clay", env: { STOK_3D: "js" } });
  check(r.mesin === "js" && r.lebar === 400 && fs.existsSync(r.berkas) && !r.catatan, "mode js: render JS tanpa catatan");
}
// blender diminta tetapi tidak ada -> jatuh ke js
{
  const r = await render3dPilih({ svg: SVG, keluar: path.join(tmp, "b.jpg"), ukuran: 400, env: { STOK_3D: "blender", BLENDER_BIN: path.join(tmp, "tidak-ada") } });
  check(r.mesin === "js" && /dipakai render JS/.test(r.catatan || ""), "blender tidak bisa dijalankan -> cadangan JS + catatan");
}
// Blender palsu: menyalin JPEG contoh ke --keluar dan mencatat argumennya
const contoh = path.join(tmp, "contoh.jpg");
await render3dPilih({ svg: SVG, keluar: contoh, ukuran: 500, env: { STOK_3D: "js" } });
const palsu = (nama, isi) => { const f = path.join(tmp, nama); fs.writeFileSync(f, `#!/bin/sh\n${isi}\n`); fs.chmodSync(f, 0o755); return f; };
{
  const catat = path.join(tmp, "args.txt");
  const f = palsu("blender-ok", `echo "$@" > "${catat}"\nwhile [ $# -gt 0 ]; do if [ "$1" = "--keluar" ]; then cp "${contoh}" "$2"; fi; shift; done`);
  const r = await render3dPilih({ svg: SVG, keluar: path.join(tmp, "c", "c.jpg"), ukuran: 500, palet: "langit", bahan: "logam", env: { STOK_3D: "blender", BLENDER_BIN: f, STOK_BLENDER_SAMPEL: "12" } });
  const a = fs.readFileSync(catat, "utf8");
  check(r.mesin === "blender" && r.lebar === 500 && !r.catatan, "Blender palsu: berhasil dan mesin=blender");
  check(/-b -noaudio -P .*ikon3d-blender\.py -- --svg /.test(a) && /--warna #0ea5e9/.test(a) && /--bahan logam/.test(a) && /--sampel 12/.test(a) && /--ukuran 500/.test(a), "Blender palsu: argumen benar (warna palet, bahan, sampel, ukuran)");
  check(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("ikon3d-")).length === 0, "berkas SVG sementara dibersihkan");
}
{
  const f = palsu("blender-gagal", `echo "boom" >&2\nexit 3`);
  const r = await render3dPilih({ svg: SVG, keluar: path.join(tmp, "d.jpg"), ukuran: 400, env: { STOK_3D: "blender", BLENDER_BIN: f } });
  check(r.mesin === "js" && /kode 3/.test(r.catatan || "") && fs.existsSync(r.berkas), "Blender keluar dengan galat -> cadangan JS");
}
{
  const f = palsu("blender-diam", `exit 0`);
  const r = await render3dPilih({ svg: SVG, keluar: path.join(tmp, "e.jpg"), ukuran: 400, env: { STOK_3D: "auto", BLENDER_BIN: f } });
  check(r.mesin === "js" && /tidak ada/.test(r.catatan || ""), "Blender selesai tanpa berkas -> cadangan JS");
}
{
  const f = palsu("blender-rusak", `while [ $# -gt 0 ]; do if [ "$1" = "--keluar" ]; then echo bukan-gambar > "$2"; fi; shift; done`);
  const r = await render3dPilih({ svg: SVG, keluar: path.join(tmp, "g.jpg"), ukuran: 400, env: { STOK_3D: "blender", BLENDER_BIN: f } });
  check(r.mesin === "js" && r.catatan, "hasil Blender bukan gambar -> cadangan JS");
}
{
  const f = palsu("blender-lambat", `sleep 5`);
  const t0 = Date.now();
  const r = await render3dPilih({ svg: SVG, keluar: path.join(tmp, "h.jpg"), ukuran: 400, env: { STOK_3D: "blender", BLENDER_BIN: f, STOK_BLENDER_TIMEOUT_MS: "700" } });
  check(r.mesin === "js" && /batas waktu/.test(r.catatan || "") && Date.now() - t0 < 4500, "Blender melebihi batas waktu -> dihentikan, cadangan JS");
}
// Blender asli (opsional)
{
  const py = process.env.STOK_BPY_PYTHON || "python3";
  const ada = spawnSync(py, ["-c", "import bpy"], { encoding: "utf8", timeout: 60000 }).status === 0;
  if (!ada) console.log("lewati: modul bpy tidak terpasang (tes Blender asli)");
  else {
    const r = await render3dPilih({ svg: SVG, keluar: path.join(tmp, "asli.jpg"), ukuran: 480, env: { STOK_3D: "blender", STOK_BPY_PYTHON: py, STOK_BLENDER_SAMPEL: "8" } });
    check(r.mesin === "blender" && r.lebar === 480 && !r.catatan, "Blender asli (bpy): render berhasil");
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} tes GAGAL` : "\nSemua tes ikon3d-pilih lolos");
process.exit(fails ? 1 : 0);
