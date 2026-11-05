// Antarmuka Laboratorium Kimia: tabel periodik pixel + popup + simpan PNG/PDF, laboratorium racik, koleksi.
// Pemakaian: const lab = bukaLabKimia({ tempat: elemen, bahasa: "id", pemain: "nama", onTutup: () => {} });
// Tidak butuh pustaka luar. Warna mengikuti <html data-theme="dark|light"> atau prefers-color-scheme.
import { UNSUR, PER_SIMBOL, KATEGORI } from "./data.js";
import { racik, bahanAcak, buatSprite, BATAS_JUMLAH } from "./core.js";
import { gambarTabel, UKURAN_TABEL, gambarKartuUnsur, UKURAN_KARTU_UNSUR, gambarKartuHasil, ukuranKartuHasil, gambarSprite, WARNA } from "./render.js";
import { buatPdf } from "./pdf.js";

const TEKS = {
  id: {
    judul: "Laboratorium Kimia", tabTabel: "Tabel Periodik", tabLab: "Laboratorium", tabKoleksi: "Koleksi",
    petunjukTabel: "Ketuk unsur untuk melihat detailnya. Geser ke samping bila tabel terpotong.",
    simpanGambar: "Simpan gambar", simpanPdf: "Simpan PDF", simpanTabelGambar: "Simpan tabel (gambar)", simpanTabelPdf: "Simpan tabel (PDF)",
    tutup: "Tutup", pakaiLab: "Pakai di laboratorium", perbesar: "Perbesar tabel", perkecil: "Perkecil tabel",
    cari: "Cari unsur (nama, simbol, atau nomor)...", meja: "Meja racik", mejaKosong: "Pilih unsur dari tabel di atas. Jenis dan jumlah bahan tidak dibatasi.",
    racik: "Racik!", acak: "Acak", kosongkan: "Kosongkan", kurangi: "Kurangi", tambah: "Tambah", hapus: "Hapus", jumlah: "Jumlah atom",
    meraciknya: "Meracik...", hasil: "Hasil racikan", tersimpan: "Tersimpan di Koleksi", koleksiKosong: "Belum ada penemuan. Racik sesuatu di laboratorium!",
    hapusSemua: "Hapus semua koleksi", yakin: "Yakin hapus?", jenisBahan: "jenis", atom: "atom", filterSemua: "Tampilkan semua",
    wujud: "Wujud", warna: "Warna", massaRumus: "Massa rumus (Mr)", proton: "Jumlah proton", kode: "Kode", simbol: "Simbol",
    gagal: "Gagal menyimpan berkas", dibagikan: "Berkas dibagikan", diunduh: "Berkas diunduh", catatanLab: "Senyawa nyata dikenali otomatis; kombinasi lain menjadi zat khayalan (hanya permainan).",
    padat: "padat", cair: "cair", gas: "gas", "tak-diketahui": "belum diketahui",
    tipeNyata: "Senyawa nyata", tipeFiksi: "Zat khayalan", tipeUnsur: "Unsur",
  },
  en: {
    judul: "Chemistry Lab", tabTabel: "Periodic Table", tabLab: "Laboratory", tabKoleksi: "Collection",
    petunjukTabel: "Tap an element to see its details. Scroll sideways if the table is cut off.",
    simpanGambar: "Save image", simpanPdf: "Save PDF", simpanTabelGambar: "Save table (image)", simpanTabelPdf: "Save table (PDF)",
    tutup: "Close", pakaiLab: "Use in the lab", perbesar: "Zoom in", perkecil: "Zoom out",
    cari: "Search element (name, symbol or number)...", meja: "Mixing bench", mejaKosong: "Pick elements from the table above. The number and amount of ingredients is unlimited.",
    racik: "Mix!", acak: "Random", kosongkan: "Clear", kurangi: "Decrease", tambah: "Increase", hapus: "Remove", jumlah: "Atom count",
    meraciknya: "Mixing...", hasil: "Result", tersimpan: "Saved to Collection", koleksiKosong: "No discoveries yet. Mix something in the lab!",
    hapusSemua: "Delete the whole collection", yakin: "Sure?", jenisBahan: "kinds", atom: "atoms", filterSemua: "Show all",
    wujud: "State", warna: "Colour", massaRumus: "Formula mass (Mr)", proton: "Total protons", kode: "Code", simbol: "Symbol",
    gagal: "Could not save the file", dibagikan: "File shared", diunduh: "File downloaded", catatanLab: "Real compounds are recognised automatically; any other combination becomes an imaginary substance (just a game).",
    padat: "solid", cair: "liquid", gas: "gas", "tak-diketahui": "unknown",
    tipeNyata: "Real compound", tipeFiksi: "Imaginary substance", tipeUnsur: "Element",
  },
};

const CSS = `
.lk{--lk-bg:#fff;--lk-fg:#16161d;--lk-mut:#5d6075;--lk-line:#16161d;--lk-card:#f1f2f7;--lk-ink:#1b1b2f;--lk-acc:#3b5bdb;--lk-sel:36px;
  color:var(--lk-fg);background:var(--lk-bg);font-family:inherit;box-sizing:border-box;display:flex;flex-direction:column;min-height:100%;position:relative}
html[data-theme="dark"] .lk{--lk-bg:#111116;--lk-fg:#f2f2f6;--lk-mut:#a7aac2;--lk-line:#f2f2f6;--lk-card:#1d1d27;--lk-acc:#91a7ff}
@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .lk{--lk-bg:#111116;--lk-fg:#f2f2f6;--lk-mut:#a7aac2;--lk-line:#f2f2f6;--lk-card:#1d1d27;--lk-acc:#91a7ff}}
.lk *{box-sizing:border-box}
.lk button{font:inherit;color:inherit;cursor:pointer}
.lk-head{display:flex;align-items:center;gap:10px;padding:10px 16px}
.lk-head h2{margin:0;font-size:17px;flex:1}
.lk-tabs{display:flex;border-bottom:1.5px solid var(--lk-line);margin:0 16px}
.lk-tab{flex:1;background:none;border:0;padding:12px 4px;font-weight:700;font-size:13px;color:var(--lk-mut);border-bottom:3px solid transparent;margin-bottom:-1.5px}
.lk-tab[aria-selected="true"]{color:var(--lk-fg);border-bottom-color:var(--lk-fg)}
.lk-body{padding:12px 16px 28px;flex:1}
.lk-hint{font-size:12px;color:var(--lk-mut);margin:0 0 10px;line-height:1.45}
.lk-bar{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.lk-btn{border:1.5px solid var(--lk-line);background:none;border-radius:12px;min-height:44px;padding:0 14px;font-weight:700;font-size:13px}
.lk-btn.utama{background:var(--lk-fg);color:var(--lk-bg)}
.lk-btn[disabled]{opacity:.4;cursor:default}
.lk-btn.kecil{min-height:36px;padding:0 10px}
.lk-gridwrap{overflow-x:auto;padding:4px 2px 8px;-webkit-overflow-scrolling:touch}
.lk-grid{display:grid;grid-template-columns:repeat(18,var(--lk-sel));grid-template-rows:repeat(7,var(--lk-sel)) 10px repeat(2,var(--lk-sel));gap:3px;width:max-content}
.lk-sel,.lk-ph{position:relative;border:0;padding:0;color:#1b1b2f;line-height:1;
  clip-path:polygon(0 3px,3px 3px,3px 0,calc(100% - 3px) 0,calc(100% - 3px) 3px,100% 3px,100% calc(100% - 3px),calc(100% - 3px) calc(100% - 3px),calc(100% - 3px) 100%,3px 100%,3px calc(100% - 3px),0 calc(100% - 3px));
  box-shadow:inset 2px 2px 0 rgba(255,255,255,.55),inset -2px -2px 0 rgba(0,0,0,.28)}
.lk button.lk-sel{color:#1b1b2f}
.lk-sel:focus-visible{outline:none;box-shadow:inset 0 0 0 3px #1b1b2f,inset 0 0 0 5px #fff}
.lk-sel:active{transform:translateY(1px)}
.lk-sel .lk-no{position:absolute;left:4px;top:3px;font-size:calc(var(--lk-sel)*.22);opacity:.85}
.lk-sel .lk-sym{display:block;font-weight:800;font-size:calc(var(--lk-sel)*.42);padding-top:calc(var(--lk-sel)*.2)}
.lk-ph{display:grid;place-items:center;font-size:calc(var(--lk-sel)*.2);opacity:.75}
.lk-sel.dim{opacity:.18}
.lk-sel[data-n]::after{content:attr(data-n);position:absolute;right:2px;bottom:1px;background:#1b1b2f;color:#fff;font-size:10px;font-weight:700;padding:1px 3px;border-radius:2px}
.lk-sel[data-n]{box-shadow:inset 0 0 0 3px #1b1b2f,inset 0 0 0 5px #fff}
.lk-leg{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.lk-chip{display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--lk-line);background:none;border-radius:999px;padding:4px 10px;font-size:11px;min-height:32px}
.lk-chip i{width:12px;height:12px;display:inline-block;border:1.5px solid #1b1b2f}
.lk-chip[aria-pressed="true"]{background:var(--lk-fg);color:var(--lk-bg)}
.lk-search{width:100%;border:1.5px solid var(--lk-line);border-radius:12px;min-height:44px;padding:0 12px;background:none;color:inherit;font:inherit;margin:4px 0 8px}
.lk h3{margin:14px 0 6px;font-size:14px}
.lk-meja{border:1.5px dashed var(--lk-line);border-radius:14px;padding:10px;min-height:70px}
.lk-vacio,.lk-kosong{color:var(--lk-mut);font-size:13px;margin:8px 4px}
.lk-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--lk-card)}
.lk-row:last-child{border-bottom:0}
.lk-mini{width:34px;height:34px;display:grid;place-items:center;font-weight:800;font-size:14px;color:#1b1b2f;flex:none;
  clip-path:polygon(0 3px,3px 3px,3px 0,calc(100% - 3px) 0,calc(100% - 3px) 3px,100% 3px,100% calc(100% - 3px),calc(100% - 3px) calc(100% - 3px),calc(100% - 3px) 100%,3px 100%,3px calc(100% - 3px),0 calc(100% - 3px))}
.lk-nm{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lk-step{display:flex;align-items:center;gap:4px}
.lk-step button{width:36px;height:36px;border:1.5px solid var(--lk-line);background:none;border-radius:8px;font-weight:800;font-size:16px}
.lk-step input{width:52px;height:36px;text-align:center;border:1.5px solid var(--lk-line);background:none;color:inherit;border-radius:8px;font:inherit;-moz-appearance:textfield}
.lk-step input::-webkit-inner-spin-button{display:none}
.lk-total{font-size:12px;color:var(--lk-mut);margin:6px 2px}
.lk-anim,.lk-spr{image-rendering:pixelated;image-rendering:crisp-edges;display:block;margin:10px auto}
.lk-hasil{background:var(--lk-card);border-radius:16px;padding:14px;margin-top:12px}
.lk-tipe{display:inline-block;font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;border:1.5px solid var(--lk-line);margin:0 auto}
.lk-tipe.nyata{background:#8ce99a;color:#12351a;border-color:#2b8a3e}.lk-tipe.fiksi{background:#ffe066;color:#4a3b00;border-color:#b08900}.lk-tipe.unsur{background:#a5d8ff;color:#0b3556;border-color:#1971c2}
.lk-nama{font-size:20px;font-weight:800;margin:8px 0 2px;text-align:center;word-break:break-word}
.lk-rumus{font-size:18px;text-align:center;color:var(--lk-acc);font-weight:700}
.lk-rumus sub{font-size:.65em;color:#d9a600}
.lk-dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;margin:12px 0}
.lk-dl dt{color:var(--lk-mut)}.lk-dl dd{margin:0;font-weight:700}
.lk-desc{font-size:14px;line-height:1.55;margin:8px 0}
.lk-bahaya{border:1.5px solid #e03131;color:#c92a2a;border-radius:10px;padding:8px 10px;font-size:13px;margin:8px 0}
html[data-theme="dark"] .lk-bahaya{color:#ff8787;border-color:#ff8787}
.lk-foot{font-size:11px;color:var(--lk-mut);text-align:center;margin-top:6px}
.lk-koleksi{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px;margin-top:8px}
.lk-kartu{background:var(--lk-card);border:1.5px solid transparent;border-radius:12px;padding:8px 4px;text-align:center;font-size:11px;min-height:44px}
.lk-kartu:focus-visible,.lk-btn:focus-visible,.lk-chip:focus-visible,.lk-tab:focus-visible{outline:2px solid var(--lk-acc);outline-offset:2px}
.lk-kartu canvas{image-rendering:pixelated;display:block;margin:0 auto 4px}
.lk-overlay{position:fixed;inset:0;background:rgba(10,10,20,.72);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999}
.lk-modal{background:var(--lk-bg);color:var(--lk-fg);border-radius:18px;max-width:420px;width:100%;max-height:calc(100dvh - 32px);overflow:auto;padding:14px}
.lk-modal canvas.lk-kartu-img{width:100%;height:auto;display:block;border-radius:10px}
.lk-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--lk-fg);color:var(--lk-bg);padding:10px 16px;border-radius:999px;font-size:13px;font-weight:700;z-index:10000;max-width:90vw}
@media (prefers-reduced-motion:no-preference){.lk-hasil{animation:lkMuncul .25s ease-out}@keyframes lkMuncul{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}
`;

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return e;
}

const KUNCI_SIMPAN = "lk_koleksi_v1";
function bacaKoleksi(pemain) { try { const v = JSON.parse(localStorage.getItem(KUNCI_SIMPAN + ":" + pemain) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }
function tulisKoleksi(pemain, v) { try { localStorage.setItem(KUNCI_SIMPAN + ":" + pemain, JSON.stringify(v)); return true; } catch { return false; } }

function buatKanvas(ukuran, px = 1) {
  const el = document.createElement("canvas");
  el.width = ukuran.lebar * px; el.height = ukuran.tinggi * px;
  const ctx = el.getContext("2d"); ctx.scale(px, px); ctx.imageSmoothingEnabled = false;
  return { el, ctx };
}
const pxLayar = () => Math.min(3, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
async function blobPng(ukuran, gambar) { const { el, ctx } = buatKanvas(ukuran, 2); gambar(ctx); return new Promise((r) => el.toBlob(r, "image/png")); }
async function blobPdf(ukuran, gambar, judul) {
  const { el, ctx } = buatKanvas(ukuran, 2); gambar(ctx);
  const jpg = await new Promise((r) => el.toBlob(r, "image/jpeg", 0.95)), u8 = new Uint8Array(await jpg.arrayBuffer());
  return new Blob([buatPdf(u8, el.width, el.height, { judul, latar: WARNA.latar })], { type: "application/pdf" });
}
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lab";

export function bukaLabKimia(opsi = {}) {
  const tempat = opsi.tempat || document.body;
  const S = { bahasa: opsi.bahasa === "en" ? "en" : "id", tab: opsi.tab || "tabel", bahan: new Map(), filter: null, zoom: 1, hasil: null, cari: "", pemain: opsi.pemain || "umum", koleksi: null, hapusSiap: false };
  S.koleksi = bacaKoleksi(S.pemain);
  if (!document.getElementById("lk-gaya")) { const st = document.createElement("style"); st.id = "lk-gaya"; st.textContent = CSS; document.head.append(st); }
  const root = h("section", { class: "lk", "aria-label": TEKS[S.bahasa].judul });
  tempat.append(root);
  const t = (k) => TEKS[S.bahasa][k];
  const namaU = (u) => u.nama[S.bahasa] || u.nama.id;
  const simpanBerkas = opsi.simpanBerkas || (async (blob, nama) => {
    const file = typeof File === "function" ? new File([blob], nama, { type: blob.type }) : null;
    if (file && matchMedia("(pointer:coarse)").matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: nama }); return "dibagikan"; } catch (e) { if (e && e.name === "AbortError") return "batal"; }
    }
    const url = URL.createObjectURL(blob), a = h("a", { href: url, download: nama });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "diunduh";
  });

  let toastEl = null, toastT = 0;
  function toast(msg) {
    toastEl?.remove(); toastEl = h("div", { class: "lk-toast", role: "status" }, msg); root.append(toastEl);
    clearTimeout(toastT); toastT = setTimeout(() => toastEl?.remove(), 2200);
  }
  async function simpan(bangun, nama) {
    try { const blob = await bangun(); const r = await simpanBerkas(blob, nama); if (r !== "batal") toast(t(r === "dibagikan" ? "dibagikan" : "diunduh")); }
    catch (e) { toast(t("gagal")); }
  }

  // ---------- modal ----------
  function modal(isi, label) {
    const awal = document.activeElement;
    const kotak = h("div", { class: "lk-modal", role: "dialog", "aria-modal": "true", "aria-label": label || t("judul") }, isi);
    const ov = h("div", { class: "lk-overlay", onclick: (e) => { if (e.target === ov) tutup(); } }, kotak);
    function tutup() { ov.remove(); document.removeEventListener("keydown", tombol, true); awal?.focus?.(); }
    function tombol(e) {
      if (e.key === "Escape") { e.stopPropagation(); tutup(); return; }
      if (e.key !== "Tab") return;
      const f = [...kotak.querySelectorAll("button,[href],input,select,textarea,[tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled);
      if (!f.length) return;
      const a = f[0], b = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); } else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    }
    document.addEventListener("keydown", tombol, true);
    root.append(ov);
    setTimeout(() => (kotak.querySelector("button") || kotak).focus?.(), 0);
    return { tutup };
  }

  // ---------- kartu unsur (popup) ----------
  function popupUnsur(u) {
    const ukuran = UKURAN_KARTU_UNSUR, { el, ctx } = buatKanvas(ukuran, pxLayar());
    gambarKartuUnsur(ctx, u, S.bahasa); el.className = "lk-kartu-img";
    el.setAttribute("role", "img"); el.setAttribute("aria-label", `${u.z} ${u.simbol} ${namaU(u)}, ${u.massa}`);
    let m;
    const isi = h("div", null, el,
      h("div", { class: "lk-bar" },
        h("button", { class: "lk-btn utama", type: "button", onclick: () => simpan(() => blobPng(ukuran, (c) => gambarKartuUnsur(c, u, S.bahasa)), `unsur-${u.z}-${slug(u.nama.id)}.png`) }, t("simpanGambar")),
        h("button", { class: "lk-btn", type: "button", onclick: () => simpan(() => blobPdf(ukuran, (c) => gambarKartuUnsur(c, u, S.bahasa), `${u.simbol} - ${namaU(u)}`), `unsur-${u.z}-${slug(u.nama.id)}.pdf`) }, t("simpanPdf")),
        h("button", { class: "lk-btn", type: "button", onclick: () => { m.tutup(); tambahBahan(u.simbol); pilihTab("lab"); } }, t("pakaiLab")),
        h("button", { class: "lk-btn", type: "button", onclick: () => m.tutup() }, t("tutup"))));
    m = modal(isi, `${u.simbol} ${namaU(u)}`);
  }

  // ---------- grid tabel ----------
  function buatGrid(onKlik) {
    const grid = h("div", { class: "lk-grid", role: "group", "aria-label": t("tabTabel") });
    for (const u of UNSUR) {
      grid.append(h("button", {
        type: "button", class: "lk-sel", "data-z": u.z, "data-kat": u.kategori, "aria-label": `${u.z} ${u.simbol} ${namaU(u)}`, title: `${namaU(u)} (${u.simbol})`,
        style: `grid-column:${u.kolom};grid-row:${u.baris};background:${KATEGORI[u.kategori].warna}`, onclick: () => onKlik(u),
      }, h("span", { class: "lk-no" }, u.z), h("span", { class: "lk-sym" }, u.simbol)));
    }
    for (const [b, tek, kat] of [[6, "57-71", "lantanida"], [7, "89-103", "aktinida"]]) {
      const w = KATEGORI[kat].warna; grid.append(h("div", { class: "lk-ph", "aria-hidden": "true", style: `grid-column:3;grid-row:${b};background:${w};filter:brightness(.75)` }, tek));
    }
    return grid;
  }
  const terapkanZoom = () => root.style.setProperty("--lk-sel", ({ 0: 30, 1: 36, 2: 44 })[S.zoom] + "px");

  // ---------- tab: tabel ----------
  function tampilTabel(isi) {
    const grid = buatGrid(popupUnsur);
    const terapFilter = () => grid.querySelectorAll(".lk-sel").forEach((b) => b.classList.toggle("dim", !!S.filter && b.dataset.kat !== S.filter));
    const leg = h("div", { class: "lk-leg", role: "group" });
    for (const [id, k] of Object.entries(KATEGORI)) {
      leg.append(h("button", { type: "button", class: "lk-chip", "aria-pressed": S.filter === id ? "true" : "false", onclick: (e) => {
        S.filter = S.filter === id ? null : id; leg.querySelectorAll(".lk-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
        if (S.filter) e.currentTarget.setAttribute("aria-pressed", "true"); terapFilter();
      } }, h("i", { style: `background:${k.warna}` }), k.nama[S.bahasa] || k.nama.id));
    }
    isi.append(
      h("p", { class: "lk-hint" }, t("petunjukTabel")),
      h("div", { class: "lk-bar" },
        h("button", { class: "lk-btn kecil", type: "button", "aria-label": t("perkecil"), onclick: () => { S.zoom = Math.max(0, S.zoom - 1); terapkanZoom(); } }, "A-"),
        h("button", { class: "lk-btn kecil", type: "button", "aria-label": t("perbesar"), onclick: () => { S.zoom = Math.min(2, S.zoom + 1); terapkanZoom(); } }, "A+"),
        h("button", { class: "lk-btn", type: "button", onclick: () => simpan(() => blobPng(UKURAN_TABEL, (c) => gambarTabel(c, S.bahasa)), "tabel-periodik.png") }, t("simpanTabelGambar")),
        h("button", { class: "lk-btn", type: "button", onclick: () => simpan(() => blobPdf(UKURAN_TABEL, (c) => gambarTabel(c, S.bahasa), TEKS[S.bahasa].tabTabel), "tabel-periodik.pdf") }, t("simpanTabelPdf"))),
      h("div", { class: "lk-gridwrap" }, grid), leg);
    terapFilter();
  }

  // ---------- tab: laboratorium ----------
  function tambahBahan(sim, n = 1) {
    const baru = Math.min(BATAS_JUMLAH, (S.bahan.get(sim) || 0) + n);
    if (baru <= 0) S.bahan.delete(sim); else S.bahan.set(sim, baru);
    S.hasil = null;
  }
  function tampilLab(isi) {
    const meja = h("div", { class: "lk-meja", "aria-live": "polite" }), total = h("div", { class: "lk-total" }), hasilBox = h("div"), tombolRacik = h("button", { class: "lk-btn utama", type: "button" }, t("racik"));
    const grid = buatGrid((u) => { tambahBahan(u.simbol); segarkan(); });
    const tandai = () => grid.querySelectorAll(".lk-sel").forEach((b) => { const n = S.bahan.get(b.dataset.z && UNSUR[b.dataset.z - 1].simbol); if (n) b.setAttribute("data-n", n); else b.removeAttribute("data-n"); });
    const saring = () => {
      const q = S.cari.trim().toLowerCase();
      grid.querySelectorAll(".lk-sel").forEach((b) => {
        const u = UNSUR[b.dataset.z - 1];
        const cocok = !q || u.simbol.toLowerCase() === q || String(u.z) === q || u.nama.id.toLowerCase().includes(q) || u.nama.en.toLowerCase().includes(q);
        b.classList.toggle("dim", !cocok);
      });
    };
    function segarkanMeja() {
      meja.replaceChildren();
      if (!S.bahan.size) meja.append(h("p", { class: "lk-kosong" }, t("mejaKosong")));
      for (const [sim, n] of S.bahan) {
        const u = PER_SIMBOL.get(sim), w = KATEGORI[u.kategori].warna;
        const inp = h("input", { type: "number", inputmode: "numeric", min: 1, max: BATAS_JUMLAH, value: n, "aria-label": `${t("jumlah")} ${namaU(u)}`, onchange: (e) => {
          const v = Math.max(0, Math.min(BATAS_JUMLAH, Math.floor(Number(e.target.value)) || 0)); if (v) S.bahan.set(sim, v); else S.bahan.delete(sim); S.hasil = null; segarkan();
        } });
        meja.append(h("div", { class: "lk-row" },
          h("span", { class: "lk-mini", style: `background:${w}` }, u.simbol), h("span", { class: "lk-nm" }, `${namaU(u)}`),
          h("span", { class: "lk-step" },
            h("button", { type: "button", "aria-label": `${t("kurangi")} ${namaU(u)}`, onclick: () => { tambahBahan(sim, -1); segarkan(); } }, "−"), inp,
            h("button", { type: "button", "aria-label": `${t("tambah")} ${namaU(u)}`, onclick: () => { tambahBahan(sim, 1); segarkan(); } }, "+")),
          h("button", { class: "lk-btn kecil", type: "button", "aria-label": `${t("hapus")} ${namaU(u)}`, onclick: () => { S.bahan.delete(sim); S.hasil = null; segarkan(); } }, "×")));
      }
      let atom = 0; for (const n of S.bahan.values()) atom += n;
      total.textContent = S.bahan.size ? `${S.bahan.size} ${t("jenisBahan")} · ${atom} ${t("atom")}` : "";
      tombolRacik.disabled = !S.bahan.size; kosongBtn.disabled = !S.bahan.size;
    }
    function segarkan() { segarkanMeja(); tandai(); tampilHasil(); }
    function tampilHasil() { hasilBox.replaceChildren(); if (S.hasil) hasilBox.append(kartuHasilDom(S.hasil)); }

    const cari = h("input", { class: "lk-search", type: "search", placeholder: t("cari"), "aria-label": t("cari"), value: S.cari, oninput: (e) => { S.cari = e.target.value; saring(); },
      onkeydown: (e) => { if (e.key === "Enter") { const b = [...grid.querySelectorAll(".lk-sel")].find((x) => !x.classList.contains("dim")); if (b && S.cari.trim()) { b.click(); } } } });
    const kosongBtn = h("button", { class: "lk-btn", type: "button", onclick: () => { S.bahan.clear(); S.hasil = null; segarkan(); } }, t("kosongkan"));
    const acakBtn = h("button", { class: "lk-btn", type: "button", onclick: () => { S.bahan.clear(); for (const b of bahanAcak()) S.bahan.set(b.simbol, b.jumlah); S.hasil = null; segarkan(); } }, t("acak"));
    tombolRacik.addEventListener("click", () => {
      const daftar = [...S.bahan].map(([simbol, jumlah]) => ({ simbol, jumlah })); if (!daftar.length) return;
      const hasil = racik(daftar), selesai = () => { S.hasil = hasil; simpanKoleksi(hasil, daftar); tampilHasil(); hasilBox.firstChild?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); };
      if (matchMedia("(prefers-reduced-motion:reduce)").matches) return selesai();
      animasi(hasilBox, daftar, t("meraciknya"), selesai);
    });
    isi.append(
      h("p", { class: "lk-hint" }, t("catatanLab")),
      cari, h("div", { class: "lk-gridwrap" }, grid),
      h("h3", null, t("meja")), meja, total,
      h("div", { class: "lk-bar" }, tombolRacik, acakBtn, kosongBtn), hasilBox);
    saring(); segarkan();
  }

  // animasi labu bergelembung (± 1 detik)
  function animasi(kotak, daftar, label, selesai) {
    kotak.replaceChildren();
    const first = daftar.map((d) => KATEGORI[PER_SIMBOL.get(d.simbol).kategori].warna)[0];
    const spr = buatSprite({ kunci: "animasi", warna: first, aksen: "#ffffff", wujud: "cair" });
    const sk = 12, c = h("canvas", { class: "lk-anim", width: 16 * sk, height: 16 * sk, role: "img", "aria-label": label }), x = c.getContext("2d");
    kotak.append(c, h("p", { class: "lk-total", style: "text-align:center" }, label));
    const mulai = performance.now(); let batal = false;
    const lanjut = (n) => {
      if (batal) return; const waktu = n - mulai;
      x.clearRect(0, 0, c.width, c.height); gambarSprite(x, spr, 0, 0, sk);
      for (let i = 0; i < 6; i++) { const yy = 13 - (((waktu / 70) + i * 2.3) % 9), xx = 4 + ((i * 5 + Math.floor(waktu / 300)) % 8); x.fillStyle = "rgba(255,255,255,.9)"; x.fillRect(xx * sk, Math.round(yy) * sk, sk, sk); }
      if (waktu < 1100) requestAnimationFrame(lanjut); else { kotak.replaceChildren(); selesai(); }
    };
    requestAnimationFrame(lanjut);
  }

  // ---------- kartu hasil (DOM) ----------
  function kartuHasilDom(hasil, dalamModal) {
    const sk = 14, c = h("canvas", { class: "lk-spr", width: 16 * sk, height: 16 * sk, role: "img", "aria-label": hasil.nama[S.bahasa] || hasil.nama.id });
    gambarSprite(c.getContext("2d"), hasil.sprite, 0, 0, sk);
    const nama = hasil.nama.id === hasil.nama.en ? hasil.nama.id : (hasil.nama[S.bahasa] || hasil.nama.id);
    const rumus = h("div", { class: "lk-rumus", "aria-label": hasil.rumus }, hasil.pecah.map(([s, n]) => [s, n > 1 ? h("sub", null, n) : null]));
    const dl = h("dl", { class: "lk-dl" },
      h("dt", null, t("wujud")), h("dd", null, t(hasil.wujud)), h("dt", null, t("warna")), h("dd", null, hasil.warnaNama[S.bahasa] || hasil.warnaNama.id),
      h("dt", null, t("massaRumus")), h("dd", null, hasil.mr), h("dt", null, t("proton")), h("dd", null, hasil.proton),
      hasil.tipe === "fiksi" ? [h("dt", null, t("kode")), h("dd", null, hasil.kode), h("dt", null, t("simbol")), h("dd", null, hasil.simbolFiksi)] : null);
    const ukuran = ukuranKartuHasil(hasil, S.bahasa), berkas = slug(nama);
    const T = TEKS_RENDER_LABEL(S.bahasa);
    return h("div", { class: "lk-hasil" },
      h("div", { style: "text-align:center" }, h("span", { class: "lk-tipe " + hasil.tipe }, t(hasil.tipe === "nyata" ? "tipeNyata" : hasil.tipe === "fiksi" ? "tipeFiksi" : "tipeUnsur"))),
      c, h("div", { class: "lk-nama" }, nama), rumus,
      hasil.kelipatan > 1 ? h("div", { class: "lk-foot" }, `${hasil.kelipatan} × ${hasil.rumusDasar}`) : null,
      dl, h("p", { class: "lk-desc" }, hasil.deskripsi[S.bahasa] || hasil.deskripsi.id),
      hasil.bahaya ? h("div", { class: "lk-bahaya", role: "note" }, T.bahaya) : null,
      h("div", { class: "lk-bar" },
        h("button", { class: "lk-btn utama", type: "button", onclick: () => simpan(() => blobPng(ukuran, (cx) => gambarKartuHasil(cx, hasil, S.bahasa)), `${berkas}.png`) }, t("simpanGambar")),
        h("button", { class: "lk-btn", type: "button", onclick: () => simpan(() => blobPdf(ukuran, (cx) => gambarKartuHasil(cx, hasil, S.bahasa), nama), `${berkas}.pdf`) }, t("simpanPdf")),
        dalamModal ? h("button", { class: "lk-btn", type: "button", onclick: dalamModal.tutup }, t("tutup")) : null),
      h("div", { class: "lk-foot" }, hasil.tipe === "fiksi" ? T.footFiksi : hasil.tipe === "nyata" ? T.footNyata : ""));
  }
  const TEKS_RENDER_LABEL = (b) => (b === "en"
    ? { bahaya: "Dangerous in real life. Do not try at home; experts in a laboratory only.", footNyata: "A simulation, not an experiment recipe.", footFiksi: "An imaginary substance from a game, not found in real life." }
    : { bahaya: "Berbahaya di dunia nyata. Jangan dicoba di rumah; hanya ahli di laboratorium.", footNyata: "Hasil simulasi, bukan resep percobaan.", footFiksi: "Zat khayalan dari permainan, tidak ada di dunia nyata." });

  // ---------- koleksi ----------
  function simpanKoleksi(hasil, daftar) {
    if (hasil.tipe === "unsur") return;
    const k = hasil.kunci; if (S.koleksi.some((x) => x.k === k)) return;
    S.koleksi.push({ k, b: daftar.map((d) => [d.simbol, d.jumlah]), t: Date.now() });
    if (S.koleksi.length > 200) S.koleksi = S.koleksi.slice(-200);
    tulisKoleksi(S.pemain, S.koleksi); toast(t("tersimpan"));
  }
  function tampilKoleksi(isi) {
    if (!S.koleksi.length) { isi.append(h("p", { class: "lk-kosong" }, t("koleksiKosong"))); return; }
    const grid = h("div", { class: "lk-koleksi" });
    for (const item of [...S.koleksi].reverse()) {
      const hasil = racik(item.b.map(([simbol, jumlah]) => ({ simbol, jumlah }))); if (!hasil) continue;
      const cv = h("canvas", { width: 64, height: 64 }); gambarSprite(cv.getContext("2d"), hasil.sprite, 0, 0, 4);
      const nama = hasil.nama.id === hasil.nama.en ? hasil.nama.id : (hasil.nama[S.bahasa] || hasil.nama.id);
      grid.append(h("button", { type: "button", class: "lk-kartu", "aria-label": nama, onclick: () => { let m; m = modal(kartuHasilDom(hasil, { tutup: () => m.tutup() }), nama); } }, cv, nama));
    }
    const hapus = h("button", { class: "lk-btn", type: "button", style: "margin-top:14px", onclick: (e) => {
      if (!S.hapusSiap) { S.hapusSiap = true; e.currentTarget.textContent = t("yakin"); setTimeout(() => { S.hapusSiap = false; if (e.currentTarget.isConnected) e.currentTarget.textContent = t("hapusSemua"); }, 3000); return; }
      S.hapusSiap = false; S.koleksi = []; tulisKoleksi(S.pemain, []); tampil();
    } }, t("hapusSemua"));
    isi.append(grid, hapus);
  }

  // ---------- kerangka ----------
  function pilihTab(nama) { S.tab = nama; tampil(); }
  function tampil() {
    root.replaceChildren();
    root.setAttribute("aria-label", t("judul")); terapkanZoom();
    if (!opsi.tanpaHeader) root.append(h("div", { class: "lk-head" }, h("h2", null, t("judul")), opsi.onTutup ? h("button", { class: "lk-btn kecil", type: "button", onclick: () => api.tutup() }, t("tutup")) : null));
    const tabs = h("div", { class: "lk-tabs", role: "tablist" });
    for (const [id, kunci] of [["tabel", "tabTabel"], ["lab", "tabLab"], ["koleksi", "tabKoleksi"]]) {
      tabs.append(h("button", { type: "button", class: "lk-tab", role: "tab", "aria-selected": S.tab === id ? "true" : "false", onclick: () => pilihTab(id) }, t(kunci)));
    }
    const isi = h("div", { class: "lk-body", role: "tabpanel" });
    root.append(tabs, isi);
    if (S.tab === "lab") tampilLab(isi); else if (S.tab === "koleksi") tampilKoleksi(isi); else tampilTabel(isi);
  }
  const api = {
    el: root,
    tutup() { root.remove(); opsi.onTutup?.(); },
    ubahBahasa(b) { S.bahasa = b === "en" ? "en" : "id"; tampil(); },
    pilihTab,
    unsur: (simbol) => { const u = PER_SIMBOL.get(simbol); if (u) popupUnsur(u); },
  };
  tampil();
  return api;
}

export { racik, UNSUR };
