// Antarmuka Latihan Matematika: lembar bersusun (kotak simpanan putus-putus, angka, tanda, garis, kotak jawaban), tombol angka di layar + papan ketik.
// Pemakaian: const mtk = bukaLatihanMatematika({ tempat: elemen, bahasa: "id", pemain: "nama", kelas: 3,
//   onPoin: (poin, info) => {...}, onSoal: (info) => {...}, onSesi: (info) => {...}, onTutup: () => {} });
// Tidak butuh pustaka luar. Warna mengikuti <html data-theme="dark|light"> atau prefers-color-scheme.
import { KELAS, TINGKAT, TOPIK, topikTersedia, buatSesi, periksa, penjelasan, petunjuk, jawabanLembar, poinSoal, ringkasSesi, BONUS_SESI, namaTempat, OP_NAMA } from "./soal.js";

const TEKS = {
  id: {
    judul: "Latihan Matematika", tutup: "Tutup", kelas: "Kelas", tingkat: "Tingkat", mudah: "Mudah", sedang: "Sedang", sulit: "Sulit",
    pilihTopik: "Pilih latihan", mulaiKelas: "mulai kelas", poinKamu: "Poin latihan", soalBenar: "soal benar", bintang: "bintang",
    tambah: "Penjumlahan", kurang: "Pengurangan", kali: "Perkalian", bagi: "Pembagian", cerita: "Soal cerita", pecahan: "Pecahan", kpkfpb: "KPK, FPB & faktor", tabel: "Tabel perkalian",
    ketTambah: "Susun ke bawah, jumlahkan dari kanan", ketKurang: "Susun ke bawah, pinjam bila perlu", ketKali: "Perkalian bersusun", ketBagi: "Pembagian bersusun (porogapit)", ketCerita: "Pilih operasinya, lalu hitung", ketPecahan: "Jumlah, kurang, kali, bagi, sederhanakan", ketKpk: "Faktor, KPK dan FPB", ketTabel: "Latihan cepat 10 soal",
    soalKe: "Soal", periksa: "Periksa", lanjut: "Lanjut", selesai: "Selesai", hapus: "Hapus", keluar: "Keluar", lihatCara: "Lihat caranya", caraJudul: "Caranya", lihatLagi: "Lihat langkahnya",
    benar: "Benar!", benarLagi: "Benar, tetapi lewat bantuan.", salah: "Belum tepat.", isiDulu: "Isi jawabannya dulu.", sederhanakan: "Nilainya benar, tetapi masih bisa disederhanakan.",
    poinTambah: "poin", sesiSelesai: "Sesi selesai!", benarPertama: "benar di percobaan pertama", bonus: "Bonus sempurna", mainLagi: "Main lagi", beranda: "Beranda", total: "Total poin sesi",
    simpanan: "simpan", pinjam: "pinjam", kotakBantu: "Kotak kecil di atas boleh dipakai untuk menulis simpanan atau pinjaman (tidak dinilai).",
    pilihOperasi: "Operasi apa yang dipakai?", operasiBenar: "Betul, ini soal", operasiSalah: "Belum tepat. Baca ceritanya sekali lagi.", hitungSekarang: "Sekarang hitung jawabannya.",
    pilihFaktor: "Ketuk semua faktor dari", faktorTip: "Faktor adalah bilangan yang membagi tanpa sisa.", bulat: "bulat", sisaLabel: "sisa", jawab: "Jawaban", sisaKata: "sisa",
    pecahanTip: "Tulis hasil dalam bentuk paling sederhana. Kosongkan kotak bulat bila tidak ada.", jawabanSebenarnya: "Jawaban:", poinLokal: "Poin disimpan di perangkat ini",
    aksesibel: "kolom", kosong: "kosong", ulang: "Hapus semua", catatan: "Sisa pembagian ditulis di baris terakhir.",
    kelasLabel: (k) => `Kelas ${k}`,
  },
  en: {
    judul: "Maths Practice", tutup: "Close", kelas: "Grade", tingkat: "Level", mudah: "Easy", sedang: "Medium", sulit: "Hard",
    pilihTopik: "Choose a practice", mulaiKelas: "from grade", poinKamu: "Practice points", soalBenar: "correct", bintang: "stars",
    tambah: "Addition", kurang: "Subtraction", kali: "Multiplication", bagi: "Division", cerita: "Word problems", pecahan: "Fractions", kpkfpb: "LCM, GCF & factors", tabel: "Times tables",
    ketTambah: "Column addition, from the right", ketKurang: "Column subtraction, borrow if needed", ketKali: "Long multiplication", ketBagi: "Long division", ketCerita: "Choose the operation, then calculate", ketPecahan: "Add, subtract, multiply, divide, simplify", ketKpk: "Factors, LCM and GCF", ketTabel: "Quick 10-question drill",
    soalKe: "Question", periksa: "Check", lanjut: "Next", selesai: "Finish", hapus: "Delete", keluar: "Leave", lihatCara: "Show the method", caraJudul: "The method", lihatLagi: "Show the steps",
    benar: "Correct!", benarLagi: "Correct, but with help.", salah: "Not quite.", isiDulu: "Fill in the answer first.", sederhanakan: "Right value, but it can be simplified.",
    poinTambah: "points", sesiSelesai: "Session complete!", benarPertama: "right on the first try", bonus: "Perfect bonus", mainLagi: "Play again", beranda: "Home", total: "Session points",
    simpanan: "carry", pinjam: "borrow", kotakBantu: "The small boxes on top can be used for carrying or borrowing (not graded).",
    pilihOperasi: "Which operation do you use?", operasiBenar: "Right, this is a", operasiSalah: "Not quite. Read the story once more.", hitungSekarang: "Now work out the answer.",
    pilihFaktor: "Tap all the factors of", faktorTip: "A factor divides evenly with no remainder.", bulat: "whole", sisaLabel: "remainder", jawab: "Answer", sisaKata: "remainder",
    pecahanTip: "Write the answer in simplest form. Leave the whole box empty if there is none.", jawabanSebenarnya: "Answer:", poinLokal: "Points are saved on this device",
    aksesibel: "column", kosong: "empty", ulang: "Clear all", catatan: "The remainder goes on the last row.",
    kelasLabel: (k) => `Grade ${k}`,
  },
};
const SIMBOL = { tambah: "+", kurang: "−", kali: "×", bagi: "÷", cerita: "?", pecahan: "½", kpkfpb: "KPK", tabel: "1×" };
const KET = { tambah: "ketTambah", kurang: "ketKurang", kali: "ketKali", bagi: "ketBagi", cerita: "ketCerita", pecahan: "ketPecahan", kpkfpb: "ketKpk", tabel: "ketTabel" };

const CSS = `
.lm{--lm-bg:#fff;--lm-fg:#16161d;--lm-mut:#5d6075;--lm-line:#16161d;--lm-card:#f1f2f7;--lm-acc:#3b5bdb;--lm-ok:#1f7a3d;--lm-okbg:#e3f6e8;--lm-bad:#b42318;--lm-badbg:#fdeaea;--lm-warn:#9a6700;--lm-warnbg:#fff4d6;--lm-c:40px;
  color:var(--lm-fg);background:var(--lm-bg);font-family:inherit;box-sizing:border-box;display:flex;flex-direction:column;min-height:100%;position:relative}
html[data-theme="dark"] .lm{--lm-bg:#111116;--lm-fg:#f2f2f6;--lm-mut:#a7aac2;--lm-line:#f2f2f6;--lm-card:#1d1d27;--lm-acc:#91a7ff;--lm-ok:#8be0a4;--lm-okbg:#143020;--lm-bad:#ff9a92;--lm-badbg:#3a1a1a;--lm-warn:#ffd78a;--lm-warnbg:#3a2c10}
@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .lm{--lm-bg:#111116;--lm-fg:#f2f2f6;--lm-mut:#a7aac2;--lm-line:#f2f2f6;--lm-card:#1d1d27;--lm-acc:#91a7ff;--lm-ok:#8be0a4;--lm-okbg:#143020;--lm-bad:#ff9a92;--lm-badbg:#3a1a1a;--lm-warn:#ffd78a;--lm-warnbg:#3a2c10}}
.lm *{box-sizing:border-box}
.lm button{font:inherit;color:inherit;cursor:pointer}
.lm-head{display:flex;align-items:center;gap:10px;padding:10px 16px}
.lm-head h2{margin:0;font-size:17px;flex:1}
.lm-body{padding:0 16px 24px;flex:1;max-width:560px;width:100%;margin:0 auto}
.lm-btn{border:1.5px solid var(--lm-line);background:none;border-radius:12px;min-height:44px;padding:0 16px;font-weight:700;font-size:14px}
.lm-btn.utama{background:var(--lm-fg);color:var(--lm-bg)}
.lm-btn.kecil{min-height:36px;padding:0 12px;font-size:13px}
.lm-btn[disabled]{opacity:.45;cursor:default}
.lm-btn:focus-visible,.lm-chip:focus-visible,.lm-sel:focus-visible,.lm-key:focus-visible,.lm-kartu:focus-visible{outline:3px solid var(--lm-acc);outline-offset:2px}
.lm-baris-p{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0}
.lm-baris-p>b{font-size:12px;color:var(--lm-mut);margin-right:2px;min-width:52px}
.lm-chip{border:1.5px solid var(--lm-line);background:none;border-radius:999px;min-height:40px;min-width:40px;padding:0 14px;font-weight:700;font-size:13px}
.lm-chip[aria-pressed="true"]{background:var(--lm-acc);color:#fff;border-color:var(--lm-acc)}
html[data-theme="dark"] .lm-chip[aria-pressed="true"]{color:#111116}@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .lm-chip[aria-pressed="true"]{color:#111116}}
.lm-stat{display:flex;gap:14px;flex-wrap:wrap;background:var(--lm-card);border-radius:14px;padding:10px 14px;margin:10px 0;font-size:13px}
.lm-stat b{font-size:17px;display:block}
.lm-judul2{font-size:13px;font-weight:800;margin:16px 0 8px;color:var(--lm-mut);text-transform:uppercase;letter-spacing:.05em}
.lm-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.lm-kartu{display:flex;flex-direction:column;gap:4px;text-align:left;background:var(--lm-card);border:1.5px solid transparent;border-radius:16px;padding:12px;min-height:104px}
.lm-kartu .ik{font-size:26px;font-weight:800;color:var(--lm-acc);line-height:1}
.lm-kartu .nm{font-weight:800;font-size:14px}.lm-kartu .kt{font-size:11px;color:var(--lm-mut);line-height:1.35}
.lm-kartu .bt{font-size:12px;color:#d9a600;letter-spacing:1px;min-height:14px}
.lm-kartu[disabled]{opacity:.5;cursor:default}
.lm-prog{height:8px;border-radius:99px;background:var(--lm-card);overflow:hidden;margin:6px 0 12px}.lm-prog>i{display:block;height:100%;background:var(--lm-acc);transition:width .25s}
.lm-info{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--lm-mut);font-weight:700}
.lm-tanya{font-size:20px;font-weight:800;margin:6px 0 10px;line-height:1.3}
.lm-cerita{font-size:16px;line-height:1.55;background:var(--lm-card);border-radius:14px;padding:12px 14px;margin:6px 0 12px}
.lm-lembar-w{overflow-x:auto;padding:6px 2px 10px;display:flex;justify-content:center}
.lm-lembar{display:flex;flex-direction:column;width:max-content;font-variant-numeric:tabular-nums}
.lm-r{display:grid;height:var(--lm-c);align-items:center}
.lm-r.kecil{height:calc(var(--lm-c)*.62)}
.lm-t{text-align:center;font-weight:800;font-size:calc(var(--lm-c)*.6);color:var(--lm-fg);padding-right:2px;white-space:nowrap}
.lm-t.lab{font-size:calc(var(--lm-c)*.52);text-align:right;padding-right:4px}
.lm-d{text-align:center;font-weight:800;font-size:calc(var(--lm-c)*.72);line-height:var(--lm-c);height:var(--lm-c)}
.lm-d.dim{opacity:.3}.lm-d.atas{border-top:3px solid var(--lm-fg)}.lm-d.atas.pertama{border-left:3px solid var(--lm-fg);border-top-left-radius:10px}
.lm-garis{height:0;border-top:3px solid var(--lm-fg);align-self:center;margin:0 2px}
.lm button.lm-sel{width:calc(var(--lm-c) - 5px);height:calc(var(--lm-c) - 5px);margin:0 auto;border:2px dashed var(--lm-line);background:none;border-radius:8px;font-weight:800;font-size:calc(var(--lm-c)*.66);padding:0;display:grid;place-items:center;color:var(--lm-fg);line-height:1;touch-action:manipulation}
.lm button.lm-sel.bantu{width:calc(var(--lm-c)*.7);height:calc(var(--lm-c)*.52);border-width:1.5px;border-radius:6px;font-size:calc(var(--lm-c)*.38);opacity:.85;color:var(--lm-acc)}
.lm button.lm-sel.fokus{border-style:solid;border-color:var(--lm-acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--lm-acc) 30%,transparent)}
.lm button.lm-sel.ok{border-style:solid;border-color:var(--lm-ok);background:var(--lm-okbg);color:var(--lm-ok)}
.lm button.lm-sel.salah{border-style:solid;border-color:var(--lm-bad);background:var(--lm-badbg);color:var(--lm-bad)}
.lm button.lm-sel.buka{border-style:solid;border-color:var(--lm-warn);background:var(--lm-warnbg);color:var(--lm-warn)}
.lm-catat{font-size:12px;color:var(--lm-mut);text-align:center;margin:2px 0 8px;line-height:1.4}
.lm-pad{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:10px 0}
.lm-key{min-height:48px;border:1.5px solid var(--lm-line);background:none;border-radius:12px;font-weight:800;font-size:19px;touch-action:manipulation}
.lm-key:active{transform:translateY(1px)}
.lm-key.lebar2{grid-column:span 2}.lm-key.lebar3{grid-column:span 3}
.lm .lm-key.utama{background:var(--lm-fg);color:var(--lm-bg)}
.lm-fb{border-radius:14px;padding:10px 14px;margin:10px 0;font-size:14px;line-height:1.5}
.lm-fb.ok{background:var(--lm-okbg);color:var(--lm-ok)}.lm-fb.bad{background:var(--lm-badbg);color:var(--lm-bad)}.lm-fb.info{background:var(--lm-card)}
.lm-fb b{font-size:15px}
.lm-cara{background:var(--lm-card);border-radius:14px;padding:10px 14px 10px 30px;margin:10px 0;font-size:14px;line-height:1.55}
.lm-cara h4{margin:0 0 4px -16px;font-size:12px;color:var(--lm-mut);text-transform:uppercase;letter-spacing:.05em}.lm-cara li{margin:3px 0}
.lm-aksi{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.lm-op{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0}
.lm-op button{min-height:60px;border:1.5px solid var(--lm-line);background:none;border-radius:14px;font-size:28px;font-weight:800}
.lm-op button.salah{border-color:var(--lm-bad);background:var(--lm-badbg);color:var(--lm-bad)}.lm-op button.ok{border-color:var(--lm-ok);background:var(--lm-okbg);color:var(--lm-ok)}
.lm-pec{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;font-size:26px;font-weight:800;margin:8px 0 12px}
.lm-pf{display:inline-flex;flex-direction:column;align-items:center;line-height:1.15;font-size:24px}.lm-pf i{display:block;width:100%;height:3px;background:var(--lm-fg);margin:2px 0;font-style:normal}
.lm-pj{display:flex;align-items:center;justify-content:center;gap:10px;margin:6px 0}
.lm-pj .pec{display:flex;flex-direction:column;align-items:center;gap:4px}.lm-pj .pec i{display:block;width:100%;height:3px;background:var(--lm-fg)}
.lm-pj small{font-size:11px;color:var(--lm-mut);display:block;text-align:center;margin-bottom:2px}
.lm-fak{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.lm-fak button{min-width:48px;min-height:48px;border:1.5px solid var(--lm-line);background:none;border-radius:12px;font-weight:800;font-size:18px}
.lm-fak button[aria-pressed="true"]{background:var(--lm-acc);color:#fff;border-color:var(--lm-acc)}
.lm-fak button.ok{background:var(--lm-okbg);border-color:var(--lm-ok);color:var(--lm-ok)}.lm-fak button.salah{background:var(--lm-badbg);border-color:var(--lm-bad);color:var(--lm-bad)}
.lm-hasil{text-align:center;padding:10px 0}.lm-hasil .bt{font-size:38px;color:#d9a600;letter-spacing:6px}.lm-hasil h3{margin:6px 0;font-size:22px}
.lm-hasil dl{display:grid;grid-template-columns:1fr auto;gap:6px 12px;text-align:left;background:var(--lm-card);border-radius:14px;padding:12px 14px;margin:12px 0;font-size:14px}.lm-hasil dd{margin:0;font-weight:800;text-align:right}.lm-hasil dt{color:var(--lm-mut)}
.lm-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--lm-fg);color:var(--lm-bg);padding:10px 16px;border-radius:999px;font-size:13px;font-weight:700;z-index:10000;max-width:90vw}
.lm-plus{display:inline-block;font-weight:800;color:var(--lm-ok)}
@media (prefers-reduced-motion:no-preference){.lm-fb,.lm-cara{animation:lmMuncul .2s ease-out}@keyframes lmMuncul{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}}
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

const K_PREF = "lm_pref_v1", K_STAT = "lm_stat_v1";
const lsBaca = (k, awal) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? awal; } catch { return awal; } };
const lsTulis = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } };
const statAwal = () => ({ soal: 0, benar: 0, poin: 0, sesi: 0, bintang: {} });
const pecahanEl = (n, d) => h("span", { class: "lm-pf" }, h("span", null, n), h("i"), h("span", null, d));

export function bukaLatihanMatematika(opsi = {}) {
  const tempat = opsi.tempat || document.body;
  const pemain = opsi.pemain || "umum";
  const pref = lsBaca(K_PREF + ":" + pemain, {});
  const S = {
    bahasa: opsi.bahasa === "en" ? "en" : "id", pemain,
    kelas: KELAS.includes(Number(opsi.kelas)) ? Number(opsi.kelas) : KELAS.includes(pref.kelas) ? pref.kelas : 3,
    tingkat: TINGKAT.includes(opsi.tingkat) ? opsi.tingkat : TINGKAT.includes(pref.tingkat) ? pref.tingkat : "mudah",
    stat: { ...statAwal(), ...lsBaca(K_STAT + ":" + pemain, {}) },
    layar: "beranda", topik: null, sesi: [], idx: 0, hasil: [], sesiId: "", poinSesi: 0, hasilAkhir: null,
    // keadaan soal berjalan
    isian: {}, fokus: null, percobaan: 0, bantuan: false, selesaiSoal: false, nilai: null, fb: null, caraTampil: false, mulai: 0, opPilih: null, opSelesai: false, pilihFaktor: new Set(), poinSoalIni: 0,
  };
  if (!document.getElementById("lm-gaya")) { const st = document.createElement("style"); st.id = "lm-gaya"; st.textContent = CSS; document.head.append(st); }
  const root = h("section", { class: "lm", "aria-label": TEKS[S.bahasa].judul });
  tempat.append(root);
  const t = (k, ...a) => { const v = TEKS[S.bahasa][k]; return typeof v === "function" ? v(...a) : v; };
  const simpanPref = () => lsTulis(K_PREF + ":" + S.pemain, { kelas: S.kelas, tingkat: S.tingkat });
  const simpanStat = () => lsTulis(K_STAT + ":" + S.pemain, S.stat);
  let toastEl = null, toastT = 0;
  const toast = (msg) => { toastEl?.remove(); toastEl = h("div", { class: "lm-toast", role: "status" }, msg); root.append(toastEl); clearTimeout(toastT); toastT = setTimeout(() => toastEl?.remove(), 2000); };
  const soal = () => S.sesi[S.idx];
  const kunciBintang = (tp, k = S.kelas, tg = S.tingkat) => `${tp}|${k}|${tg}`;

  // ---------- medan isian (sel yang bisa diisi) ----------
  /** daftar medan fokus untuk soal berjalan: {id, maks, jenis} */
  function medan() {
    const s = soal(); if (!s) return [];
    if (s.jenis === "lembar") { const sel = {}; for (const b of s.lembar.baris) for (const c of b.sel) if (c.t === "isi") sel[c.id] = c; return s.lembar.urutan.filter((id) => sel[id].v !== "").map((id) => ({ id, maks: 1, jenis: "isi" })); }
    if (s.jenis === "angka") return [{ id: "jawab", maks: 7, jenis: "angka" }];
    if (s.jenis === "pecahan") return [{ id: "bulat", maks: 3, jenis: "angka" }, { id: "n", maks: 4, jenis: "angka" }, { id: "d", maks: 4, jenis: "angka" }];
    return [];
  }
  function semuaId() { const s = soal(); if (s?.jenis !== "lembar") return medan().map((m) => m.id); const out = []; for (const b of s.lembar.baris) for (const c of b.sel) if (c.id && (c.t === "isi" || c.t === "bantu")) out.push(c.id); return out; }
  const maksDari = (id) => { const s = soal(); if (s?.jenis === "lembar") return 1; return medan().find((m) => m.id === id)?.maks || 1; };
  function mulaiSoal() {
    S.isian = {}; S.percobaan = 0; S.bantuan = false; S.selesaiSoal = false; S.nilai = null; S.fb = null; S.caraTampil = false; S.mulai = Date.now(); S.opPilih = null; S.pilihFaktor = new Set(); S.poinSoalIni = 0;
    const s = soal(); S.opSelesai = !(s && s.topik === "cerita");
    S.fokus = medan()[0]?.id || null;
  }
  function pindahFokus(arah) {
    const m = medan().map((x) => x.id); if (!m.length) return; const i = m.indexOf(S.fokus);
    S.fokus = m[Math.min(m.length - 1, Math.max(0, (i < 0 ? 0 : i) + arah))];
  }
  function tekanAngka(d) {
    if (S.selesaiSoal || !S.fokus || !S.opSelesai) return;
    const id = S.fokus, maks = maksDari(id), s = soal();
    if (S.nilai && S.nilai.sel) delete S.nilai.sel[id];
    if (maks === 1) {
      S.isian[id] = d; const dalamUrutan = medan().some((m) => m.id === id);
      if (dalamUrutan) pindahFokus(1);
    } else { const lama = S.isian[id] || ""; if (lama.length < maks) S.isian[id] = (lama === "0" ? "" : lama) + d; }
    if (s.jenis === "pecahan" || s.jenis === "angka") S.nilai = null; S.fb = null; tampil();
  }
  function hapusSatu() {
    if (S.selesaiSoal || !S.fokus || !S.opSelesai) return; const id = S.fokus, maks = maksDari(id);
    if (S.nilai && S.nilai.sel) delete S.nilai.sel[id];
    if (maks === 1) { if (S.isian[id]) delete S.isian[id]; else if (medan().some((m) => m.id === id)) { pindahFokus(-1); delete S.isian[S.fokus]; } }
    else S.isian[id] = (S.isian[id] || "").slice(0, -1);
    S.fb = null; tampil();
  }
  function fokusKe(id) { if (S.selesaiSoal) return; S.fokus = id; tampil(); }

  // ---------- poin ----------
  function laporPoin(poin, info) { if (poin > 0) { S.poinSesi += poin; S.stat.poin += poin; try { opsi.onPoin?.(poin, info); } catch (e) { console.error(e); } } }
  function catatSoal(benar, percobaan, bantuan) {
    const s = soal(), poin = benar ? poinSoal(s.topik, s.tingkat, percobaan, bantuan) : 0, durasiMs = Date.now() - S.mulai;
    const info = { jenis: "soal", sesiId: S.sesiId, topik: s.topik, kelas: s.kelas, tingkat: s.tingkat, nomor: S.idx + 1, soal: s.tampil, benar, benarPertama: benar && percobaan === 1 && !bantuan, percobaan, bantuan, poin, durasiMs };
    S.hasil.push({ benar, percobaan, bantuan }); S.stat.soal += 1; if (benar) S.stat.benar += 1;
    laporPoin(poin, info); try { opsi.onSoal?.(info); } catch (e) { console.error(e); }
    S.poinSoalIni = poin; simpanStat(); return poin;
  }

  // ---------- periksa ----------
  function opPilihan(op) {
    const s = soal(); if (S.opSelesai || S.selesaiSoal) return; S.opPilih = op;
    if (op === s.cerita.opBenar) { S.opSelesai = true; S.fb = { jenis: "ok", teks: `${t("operasiBenar")} ${OP_NAMA[op][S.bahasa].toLowerCase()}. ${t("hitungSekarang")}` }; }
    else { S.percobaan += 1; S.fb = { jenis: "bad", teks: t("operasiSalah") + " " + s.cerita.petunjuk[S.bahasa] }; }
    tampil();
  }
  function periksaSekarang() {
    const s = soal(); if (S.selesaiSoal || !S.opSelesai) return;
    let isian = S.isian;
    if (s.jenis === "faktor") isian = { pilih: [...S.pilihFaktor] };
    const r = periksa(s, isian);
    const adaIsi = s.jenis === "lembar" ? medan().some((m) => S.isian[m.id] !== undefined && S.isian[m.id] !== "") : true;
    if (r.status === "kosong" || !adaIsi) { toast(t("isiDulu")); return; }
    S.nilai = r;
    if (r.benar) {
      const percobaan = S.percobaan + 1; S.selesaiSoal = true; const poin = catatSoal(true, percobaan, S.bantuan);
      S.fb = { jenis: "ok", teks: S.bantuan ? t("benarLagi") : t("benar"), poin };
    } else {
      S.percobaan += 1; const ph = petunjuk(s, r, S.bahasa);
      S.fb = { jenis: "bad", teks: r.status === "sederhanakan" ? t("sederhanakan") : `${t("salah")} ${ph}` };
    }
    tampil();
  }
  function lihatCara() {
    const s = soal(); if (!s) return;
    if (!S.selesaiSoal) { S.bantuan = true; S.selesaiSoal = true; if (s.jenis === "lembar") S.isian = { ...jawabanLembar(s) }; catatSoal(false, S.percobaan, true); S.fb = { jenis: "info", teks: t("jawabanSebenarnya") + " " + jawabanTeks(s) }; S.nilai = null; }
    S.caraTampil = true; tampil();
  }
  function jawabanTeks(s) {
    if (s.jenis === "lembar") return s.op === "bagi" && s.sisa ? `${s.jawaban} ${t("sisaKata")} ${s.sisa}` : String(s.jawaban);
    if (s.jenis === "pecahan") { const j = s.jawaban; return j.n >= j.d && j.d > 1 ? `${Math.floor(j.n / j.d)}${j.n % j.d ? " " + (j.n % j.d) + "/" + j.d : ""} (= ${j.n}/${j.d})` : j.d === 1 ? String(j.n) : `${j.n}/${j.d}`; }
    if (s.jenis === "faktor") return s.jawaban.join(", ");
    return String(s.jawaban);
  }
  function lanjut() {
    if (S.idx + 1 >= S.sesi.length) { selesaiSesi(); return; }
    S.idx += 1; mulaiSoal(); tampil();
  }
  function selesaiSesi() {
    const r = ringkasSesi(S.topik, S.tingkat, S.hasil);
    if (r.sempurna) laporPoin(BONUS_SESI, { jenis: "bonus", sesiId: S.sesiId, topik: S.topik, kelas: S.kelas, tingkat: S.tingkat, poin: BONUS_SESI });
    const kb = kunciBintang(S.topik); S.stat.sesi += 1; S.stat.bintang[kb] = Math.max(S.stat.bintang[kb] || 0, r.bintang); simpanStat();
    S.hasilAkhir = { ...r, poinSesi: S.poinSesi }; S.layar = "hasil";
    try { opsi.onSesi?.({ sesiId: S.sesiId, topik: S.topik, kelas: S.kelas, tingkat: S.tingkat, ...r, poinSesi: S.poinSesi }); } catch (e) { console.error(e); }
    tampil();
  }
  function mulaiLatihan(topik) {
    S.topik = topik; S.sesi = buatSesi(topik, S.kelas, S.tingkat); S.idx = 0; S.hasil = []; S.poinSesi = 0; S.hasilAkhir = null; S.layar = "main";
    S.sesiId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7); mulaiSoal(); tampil();
  }

  // ---------- tampilan ----------
  function bintangTeks(n) { return n ? "★".repeat(n) + "☆".repeat(3 - n) : ""; }
  function layarBeranda() {
    const sedia = new Set(topikTersedia(S.kelas));
    const chips = (daftar, nilai, ubah, label) => daftar.map((x) => h("button", { class: "lm-chip", type: "button", "aria-pressed": String(x === nilai), onclick: () => { ubah(x); simpanPref(); tampil(); } }, label(x)));
    return [
      h("div", { class: "lm-stat" }, h("div", null, h("b", null, S.stat.poin), t("poinKamu")), h("div", null, h("b", null, S.stat.benar), t("soalBenar"))),
      h("div", { class: "lm-baris-p", role: "group", "aria-label": t("kelas") }, h("b", null, t("kelas")), chips(KELAS, S.kelas, (k) => (S.kelas = k), (k) => String(k))),
      h("div", { class: "lm-baris-p", role: "group", "aria-label": t("tingkat") }, h("b", null, t("tingkat")), chips(TINGKAT, S.tingkat, (g) => (S.tingkat = g), (g) => t(g))),
      h("div", { class: "lm-judul2" }, t("pilihTopik")),
      h("div", { class: "lm-grid" }, Object.keys(TOPIK).map((tp) => {
        const ada = sedia.has(tp), bt = S.stat.bintang[kunciBintang(tp)] || 0;
        return h("button", { class: "lm-kartu", type: "button", disabled: !ada, onclick: () => mulaiLatihan(tp) },
          h("span", { class: "ik", "aria-hidden": "true" }, SIMBOL[tp]), h("span", { class: "nm" }, t(tp)),
          h("span", { class: "kt" }, ada ? t(KET[tp]) : `${t("mulaiKelas")} ${TOPIK[tp].min}`), h("span", { class: "bt", "aria-label": bt ? `${bt} ${t("bintang")}` : null }, ada ? bintangTeks(bt) : ""));
      })),
      h("p", { class: "lm-catat", style: "margin-top:14px" }, opsi.onPoin ? "" : t("poinLokal")),
    ];
  }
  function selLembar(c, bar) {
    if (c.t === "tetap") return h("div", { class: "lm-d" + (c.dim ? " dim" : "") + (bar.atas ? " atas" : ""), style: `grid-column:${c.k + 2}` }, c.v);
    const val = S.isian[c.id] || "", isBantu = c.t === "bantu", fokus = S.fokus === c.id && !S.selesaiSoal;
    let kelasSel = "lm-sel" + (isBantu ? " bantu" : "") + (fokus ? " fokus" : "");
    if (!isBantu && S.nilai?.sel && c.id in S.nilai.sel && val !== "") kelasSel += S.nilai.sel[c.id] ? " ok" : " salah";
    if (S.bantuan && !isBantu) kelasSel += " buka";
    const nm = (isBantu ? (bar.nama === "pinjam" ? t("pinjam") : t("simpanan")) : t("aksesibel")) + " " + (c.r != null ? namaTempat(c.r, S.bahasa) : "");
    return h("button", { class: kelasSel, type: "button", style: `grid-column:${c.k + 2}`, "aria-label": `${nm}: ${val || t("kosong")}`, onclick: () => fokusKe(c.id) }, val);
  }
  function lembarEl(s) {
    const L = s.lembar, W = L.kolom;
    const lebarLabel = L.baris.some((b) => b.label) ? 2 : 1;
    const kolom = `calc(var(--lm-c)*${lebarLabel * 0.9}) repeat(${W}, var(--lm-c))`;
    const wrap = h("div", { class: "lm-lembar", style: `--lm-c:min(44px,calc((100vw - 32px - 24px - ${lebarLabel * 40}px) / ${W}));` });
    L.baris.forEach((bar) => {
      if (bar.jenis === "garis") { wrap.append(h("div", { class: "lm-r", style: `grid-template-columns:${kolom};height:8px` }, h("div", { class: "lm-garis", style: `grid-column:${bar.dari + 2}/${bar.sampai + 3}` }))); return; }
      const baris = h("div", { class: "lm-r" + (bar.jenis === "bantu" ? " kecil" : ""), style: `grid-template-columns:${kolom}` });
      if (bar.tanda) baris.append(h("div", { class: "lm-t", style: "grid-column:1" }, bar.tanda));
      if (bar.label) baris.append(h("div", { class: "lm-t lab", style: "grid-column:1" }, bar.label));
      bar.sel.forEach((c, i) => { const el = selLembar(c, bar); if (bar.atas && c.t === "tetap") { el.classList.add("atas"); if (i === 0) el.classList.add("pertama"); } baris.append(el); });
      wrap.append(baris);
    });
    return h("div", { class: "lm-lembar-w" }, wrap);
  }
  function kotakAngka(id, aria, lebar) {
    const val = S.isian[id] || "", fokus = S.fokus === id && !S.selesaiSoal; let kls = "lm-sel" + (fokus ? " fokus" : "");
    if (S.nilai && !S.nilai.benar && S.nilai.status !== "kosong" && id === "jawab") kls += " salah"; if (S.nilai?.benar && id === "jawab") kls += " ok"; if (S.bantuan) kls += " buka";
    return h("button", { class: kls, type: "button", "aria-label": `${aria}: ${val || t("kosong")}`, style: `width:${lebar}px;height:52px;font-size:26px;--lm-c:52px`, onclick: () => fokusKe(id) }, val);
  }
  function badanSoal(s) {
    const out = [];
    if (s.jenis === "lembar") {
      if (s.topik === "cerita") {
        out.push(h("div", { class: "lm-cerita" }, s.cerita.teks[S.bahasa]));
        out.push(h("div", { class: "lm-tanya", style: "font-size:15px" }, t("pilihOperasi")));
        out.push(h("div", { class: "lm-op", role: "group" }, s.cerita.opsi.map((op) => h("button", { type: "button", class: S.opPilih === op ? (op === s.cerita.opBenar ? "ok" : "salah") : (S.opSelesai && op === s.cerita.opBenar ? "ok" : ""), "aria-label": OP_NAMA[op][S.bahasa], disabled: S.opSelesai, onclick: () => opPilihan(op) }, { tambah: "+", kurang: "−", kali: "×", bagi: "÷" }[op]))));
      } else out.push(h("div", { class: "lm-tanya" }, s.tampil));
      if (S.opSelesai) { if (s.topik === "cerita") out.push(h("div", { class: "lm-tanya", style: "font-size:15px" }, `${s.a} ${{ tambah: "+", kurang: "−", kali: "×", bagi: "÷" }[s.op]} ${s.b}`)); out.push(lembarEl(s)); out.push(h("div", { class: "lm-catat" }, s.op === "bagi" ? t("catatan") : (s.op === "tambah" || s.op === "kali" ? t("kotakBantu") : t("kotakBantu")))); }
    } else if (s.jenis === "angka") {
      out.push(h("div", { class: "lm-pec" }, h("span", null, s.tampil), "=", kotakAngka("jawab", t("jawab"), 120)));
    } else if (s.jenis === "pecahan") {
      out.push(h("div", { class: "lm-pec" }, s.tipe === "sederhanakan" ? [pecahanEl(s.x.n, s.x.d), "= ?"] : [pecahanEl(s.x.n, s.x.d), s.op, pecahanEl(s.y.n, s.y.d), "= ?"]));
      out.push(h("div", { class: "lm-pj" }, h("div", null, h("small", null, t("bulat")), kotakAngka("bulat", t("bulat"), 56)),
        h("div", { class: "pec" }, kotakAngka("n", "pembilang", 64), h("i"), kotakAngka("d", "penyebut", 64))));
      out.push(h("div", { class: "lm-catat" }, t("pecahanTip")));
    } else if (s.jenis === "faktor") {
      out.push(h("div", { class: "lm-tanya" }, `${t("pilihFaktor")} ${s.n}`)); out.push(h("div", { class: "lm-catat", style: "text-align:left" }, t("faktorTip")));
      out.push(h("div", { class: "lm-fak" }, s.pilihan.map((n) => {
        const on = S.pilihFaktor.has(n); let kls = ""; if (S.selesaiSoal && S.nilai) { const benar = s.jawaban.includes(n); if (benar) kls = "ok"; else if (on) kls = "salah"; }
        if (S.bantuan) kls = s.jawaban.includes(n) ? "ok" : "";
        return h("button", { type: "button", class: kls, "aria-pressed": String(on), disabled: S.selesaiSoal, onclick: () => { if (on) S.pilihFaktor.delete(n); else S.pilihFaktor.add(n); S.nilai = null; S.fb = null; tampil(); } }, n);
      })));
    }
    return out;
  }
  function papanAngka() {
    const s = soal(); if (!s || s.jenis === "faktor" || S.selesaiSoal || !S.opSelesai) return null;
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => h("button", { class: "lm-key", type: "button", onclick: () => tekanAngka(d) }, d));
    return h("div", { class: "lm-pad", role: "group", "aria-label": "angka" }, keys, h("button", { class: "lm-key lebar2", type: "button", "aria-label": t("hapus"), onclick: hapusSatu }, "⌫"), h("button", { class: "lm-key lebar3 utama", type: "button", onclick: periksaSekarang }, t("periksa")));
  }
  function layarMain() {
    const s = soal(), n = S.sesi.length, aksi = [];
    if (s.jenis === "faktor" && !S.selesaiSoal) aksi.push(h("button", { class: "lm-btn utama", type: "button", onclick: periksaSekarang }, t("periksa")));
    if (S.selesaiSoal) aksi.push(h("button", { class: "lm-btn utama", type: "button", onclick: lanjut }, S.idx + 1 >= n ? t("selesai") : t("lanjut")));
    if (!S.selesaiSoal && S.opSelesai && (S.percobaan >= 2 || S.bantuan)) aksi.push(h("button", { class: "lm-btn", type: "button", onclick: lihatCara }, t("lihatCara")));
    if (S.selesaiSoal && !S.caraTampil && !S.bantuan) aksi.push(h("button", { class: "lm-btn", type: "button", onclick: () => { S.caraTampil = true; tampil(); } }, t("lihatLagi")));
    const langkah = S.caraTampil ? penjelasan(s, S.bahasa) : [];
    return [
      h("div", { class: "lm-info" }, h("span", null, `${t("soalKe")} ${S.idx + 1}/${n} · ${t(S.topik)}`), h("span", null, `${t("kelasLabel", s.kelas)} · ${t(s.tingkat)}`)),
      h("div", { class: "lm-prog", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": n, "aria-valuenow": S.idx }, h("i", { style: `width:${(S.idx / n) * 100}%` })),
      ...badanSoal(s),
      S.fb ? h("div", { class: "lm-fb " + S.fb.jenis, role: "status" }, h("b", null, S.fb.teks), S.fb.poin ? [" ", h("span", { class: "lm-plus" }, `+${S.fb.poin} ${t("poinTambah")}`)] : null) : null,
      langkah.length ? h("ol", { class: "lm-cara" }, h("h4", null, t("caraJudul")), langkah.map((l) => h("li", null, l))) : null,
      h("div", { class: "lm-aksi" }, aksi),
      papanAngka(),
    ];
  }
  function layarHasil() {
    const r = S.hasilAkhir;
    return h("div", { class: "lm-hasil" }, h("div", { class: "bt", "aria-label": `${r.bintang} ${t("bintang")}` }, bintangTeks(r.bintang) || "☆☆☆"), h("h3", null, t("sesiSelesai")),
      h("dl", null, h("dt", null, t("soalBenar")), h("dd", null, `${r.benar}/${r.soal}`), h("dt", null, t("benarPertama")), h("dd", null, r.benarPertama),
        r.sempurna ? [h("dt", null, t("bonus")), h("dd", null, `+${BONUS_SESI}`)] : null, h("dt", null, t("total")), h("dd", null, `+${r.poinSesi}`)),
      h("div", { class: "lm-aksi", style: "justify-content:center" }, h("button", { class: "lm-btn utama", type: "button", onclick: () => mulaiLatihan(S.topik) }, t("mainLagi")), h("button", { class: "lm-btn", type: "button", onclick: () => { S.layar = "beranda"; tampil(); } }, t("beranda"))));
  }
  function tampil() {
    const tinggi = root.scrollTop; root.replaceChildren();
    const kembali = S.layar === "main" ? () => { S.layar = "beranda"; tampil(); } : null;
    root.append(h("div", { class: "lm-head" }, h("h2", null, t("judul")),
      kembali ? h("button", { class: "lm-btn kecil", type: "button", onclick: kembali }, t("keluar")) : (opsi.onTutup ? h("button", { class: "lm-btn kecil", type: "button", onclick: () => api.tutup() }, t("tutup")) : null)));
    const body = h("div", { class: "lm-body" }, S.layar === "beranda" ? layarBeranda() : S.layar === "main" ? layarMain() : layarHasil());
    root.append(body); root.scrollTop = tinggi;
  }

  // papan ketik fisik
  function tombol(e) {
    if (S.layar !== "main" || !root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement; if (a && a.tagName === "INPUT") return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); tekanAngka(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); hapusSatu(); }
    else if (e.key === "Enter") { if (a && a.tagName === "BUTTON" && !a.classList.contains("lm-sel")) return; e.preventDefault(); if (S.selesaiSoal) lanjut(); else periksaSekarang(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); pindahFokus(-1); tampil(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); pindahFokus(1); tampil(); }
  }
  document.addEventListener("keydown", tombol);
  const api = {
    el: root,
    tutup() { document.removeEventListener("keydown", tombol); root.remove(); opsi.onTutup?.(); },
    ubahBahasa(b) { S.bahasa = b === "en" ? "en" : "id"; tampil(); },
    statistik: () => ({ ...S.stat }),
  };
  tampil();
  return api;
}
