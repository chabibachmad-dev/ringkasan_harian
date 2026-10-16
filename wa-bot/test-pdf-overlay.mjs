// Tes ganti kata langsung di PDF (kotak putih + tulisan baru). Jalankan: node test-pdf-overlay.mjs
// Butuh poppler (pdftotext/pdftohtml/pdfinfo); tanpa itu, bagian yang butuh alat dilewati.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { overlayReplacePdf, parseValue, serialize, Name, Ref, Str, parseBboxLayout, findPhrase } from "./pdf-overlay.js";
import { textWidth, toWinAnsi, fontKeyFor } from "./pdf-metrics.js";
import { buildPdf } from "./pdf-doc.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdfovl-"));
const has = (cmd, arg = "-v") => spawnSync(cmd, [arg], { encoding: "utf8" }).error?.code !== "ENOENT";
const hasPoppler = has("pdftotext") && has("pdftohtml") && has("pdfinfo");
const hasQpdf = has("qpdf", "--version");
const py = (code) => spawnSync("python3", ["-I", "-c", code], { encoding: "utf8" });
const hasRl = py("import reportlab").status === 0;
const text = (buf, layout = true) => {
  const f = path.join(tmp, `t${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  return spawnSync("pdftotext", layout ? ["-layout", f, "-"] : [f, "-"], { encoding: "utf8" }).stdout;
};
const pages = (buf) => {
  const f = path.join(tmp, `p${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  return Number(/Pages:\s+(\d+)/.exec(spawnSync("pdfinfo", [f], { encoding: "utf8" }).stdout)?.[1]);
};
const qcheck = (buf) => {
  if (!hasQpdf) return;
  const f = path.join(tmp, `q${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  const r = spawnSync("qpdf", ["--check", f], { encoding: "utf8" });
  assert.ok(r.status === 0, `qpdf --check: ${r.stdout}${r.stderr}`);
};
const P = (from, to) => ({ from, to });
// Teks lama tetap ada di bawah kotak putih, jadi pdftotext bisa menyelipkannya di antara kata baru: cukup cek tiap kata ada.
const hasWords = (t, phrase) => phrase.split(/\s+/).every((w) => t.includes(w));

// ---- 1. penguraian nilai PDF & huruf standar
{
  const [v] = parseValue("<< /A 1 /B [1 0 R (hi\\)) /N] /C <4142> /D 1.5 >>");
  assert.equal(v.get("A"), 1);
  assert.ok(v.get("B")[0] instanceof Ref);
  assert.equal(v.get("B")[1].v, "hi)");
  assert.equal(v.get("C").v, "AB");
  assert.equal(v.get("D"), 1.5);
  assert.equal(serialize(new Map([["X", new Name("Y")], ["Z", [1, 2.5, new Ref(3, 0)]]])).includes("/X /Y"), true);
  ok("parser/serializer objek PDF");
  assert.ok(Math.abs(textWidth("Hello", "helv.r", 10) - 22.78) < 0.01);
  assert.equal(fontKeyFor("CAAAAA+TimesNewRomanPSMT"), "times.r");
  assert.equal(fontKeyFor("Arial-BoldMT", {}), "helv.b");
  assert.equal(toWinAnsi("Zoë").lossy, false);
  assert.equal(toWinAnsi("日本").lossy, true);
  ok("lebar huruf standar & pemetaan nama huruf");
}

// ---- 2. posisi kata dari pdftotext
if (hasPoppler) {
  const pdf = buildPdf("# Surat\n\nNama: Budi Santoso dan Budi Hartono.\n\nSelesai.", { title: "Surat" });
  const f = path.join(tmp, "a.pdf");
  fs.writeFileSync(f, pdf);
  const html = spawnSync("pdftotext", ["-bbox-layout", f, "-"], { encoding: "utf8" }).stdout;
  const pg = parseBboxLayout(html)[0];
  assert.ok(pg.w > 100 && pg.lines.length >= 2);
  const hits = findPhrase(pg, "budi");
  assert.equal(hits.length, 2);
  assert.ok(hits[0].x1 > hits[0].x0 && hits[0].y1 > hits[0].y0);
  assert.equal(findPhrase(pg, "tidak ada").length, 0);
  ok("posisi kata & pencarian frasa (tanpa pengaruh huruf besar/kecil)");
}

// ---- 3. ganti kata di PDF buatan bot (xref biasa)
if (hasPoppler) {
  const src = buildPdf("# Surat Keterangan\n\nYang bertanda tangan di bawah ini, Budi Santoso, menyatakan bahwa Budi Santoso hadir.\n\nDemikian.", { title: "Surat Keterangan" });
  const r = await overlayReplacePdf(src, [P("Budi Santoso", "Andi Pratama")], { tmpDir: tmp });
  assert.deepEqual(r.counts, [2]);
  assert.equal(r.signed, false);
  assert.ok(Buffer.isBuffer(r.buf));
  // pembaruan inkremental: byte asli tak berubah
  assert.ok(r.buf.subarray(0, src.length).equals(src));
  const t = text(r.buf, false);
  assert.ok(hasWords(t, "Andi Pratama"));
  assert.equal(pages(r.buf), pages(src));
  assert.ok(!/REVISI/.test(t));
  qcheck(r.buf);
  ok("PDF biasa: kata diganti di dua tempat, byte asli utuh, jumlah halaman sama, tanpa cap");
  // di tengah kalimat dan jauh lebih panjang dari ruang yang ada: tidak ditimpa (menutupi kata sebelah)
  const tooLong = await overlayReplacePdf(src, [P("Budi Santoso", "Achmad Chabib Nursalim Wijayakusuma")], { tmpDir: tmp });
  assert.equal(tooLong.buf, null);
  assert.ok(tooLong.notes.some((x) => /terlalu panjang/.test(x)));
  ok("ganti di tengah kalimat dengan teks terlalu panjang: tidak ditimpa, ada catatan");
  // hapus kata (pengganti kosong)
  const del = await overlayReplacePdf(src, [P("Budi Santoso", "")], { tmpDir: tmp });
  assert.deepEqual(del.counts, [2]);
  qcheck(del.buf);
  ok("pengganti kosong = menutup kata");
  // tak ketemu
  const none = await overlayReplacePdf(src, [P("Tidak Ada", "X")], { tmpDir: tmp });
  assert.equal(none.buf, null);
  assert.deepEqual(none.counts, [0]);
  assert.deepEqual(none.multiline, []);
  ok("tak ketemu: buf null (jalur lama yang memutuskan)");
  // sebagian ketemu
  const part = await overlayReplacePdf(src, [P("Budi", "Andi"), P("Zzz", "Y")], { tmpDir: tmp });
  assert.deepEqual(part.counts, [2, 0]);
  assert.ok(hasWords(text(part.buf, false), "Andi"));
  ok("sebagian pasangan ketemu");
}

// ---- 4. PDF bertanda tangan elektronik -> cap merah di SETIAP halaman
if (hasPoppler) {
  const body = "# Surat\n\nNama: Budi Santoso\n\nDitandatangani secara elektronik\n\nBudi Santoso";
  const md = `${body}\n\n${"Paragraf isi halaman berikutnya. ".repeat(40).trim()}\n\n`.repeat(1) + Array.from({ length: 60 }, (_, i) => `Baris ke-${i + 1} dokumen.`).join("\n\n");
  const src = buildPdf(md, { title: "Surat" });
  assert.ok(pages(src) >= 2, "perlu >1 halaman untuk uji cap");
  const r = await overlayReplacePdf(src, [P("Budi Santoso", "Andi")], { tmpDir: tmp });
  assert.equal(r.signed, true);
  const t = text(r.buf, false);
  const stamps = t.split("REVISI - bukan dokumen asli").length - 1;
  assert.equal(stamps, pages(src));
  qcheck(r.buf);
  ok("tanda tangan elektronik: cap merah di semua halaman");
}

// ---- 5. variasi struktur PDF (reportlab + qpdf)
if (hasPoppler && hasRl) {
  const mk = (name, code) => {
    const f = path.join(tmp, name);
    const r = py(`
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
${code}
`.replace("OUT", JSON.stringify(f)));
    assert.equal(r.status, 0, r.stderr);
    return f;
  };
  const base = mk("rl.pdf", `
c = canvas.Canvas(OUT, pagesize=A4)
w, h = A4
c.setFont("Times-Roman", 12)
c.drawString(72, h-100, "Nama : Budi Santoso, jabatan Kepala Bagian")
c.setFont("Helvetica-Bold", 16)
c.drawCentredString(w/2, h-150, "SURAT KETERANGAN")
c.setFont("Helvetica", 11)
c.drawString(72, h-200, "Baris panjang sekali sampai hampir ke tepi kanan halaman ini ya Budi")
c.drawString(72, h-230, "Kota Denpasar dan")
c.drawString(72, h-244, "Kota Surabaya")
c.showPage()
c.setFont("Helvetica", 11)
c.drawString(72, h-100, "Halaman dua: Budi Santoso lagi")
c.save()
`);
  const src = fs.readFileSync(base);

  const r = await overlayReplacePdf(src, [P("Budi Santoso", "Andi Pratama")], { tmpDir: tmp });
  assert.deepEqual(r.counts, [2]);
  const t = text(r.buf, false);
  assert.ok(hasWords(t, "Andi Pratama"));
  assert.equal(pages(r.buf), 2);
  qcheck(r.buf);
  ok("reportlab (Times/Helvetica, 2 halaman): ganti di dua halaman");

  // judul terpusat tetap di tengah
  const c = await overlayReplacePdf(src, [P("SURAT KETERANGAN", "SURAT PERNYATAAN RESMI")], { tmpDir: tmp });
  assert.deepEqual(c.counts, [1]);
  const f = path.join(tmp, "c.pdf");
  fs.writeFileSync(f, c.buf);
  // render: kata lama tertutup kotak putih, jadi piksel gelap di baris judul = teks baru; titik tengahnya harus di tengah halaman
  if (has("pdftoppm", "-v")) {
    const png = spawnSync("pdftoppm", ["-r", "72", "-gray", "-f", "1", "-l", "1", "-x", "0", "-y", "128", "-W", "595", "-H", "30", f], { encoding: "buffer" }).stdout;
    const m = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(png.subarray(0, 30).toString("latin1"));
    assert.ok(m, "keluaran PGM");
    const [w, h] = [Number(m[1]), Number(m[2])];
    const px = png.subarray(png.length - w * h);
    let lo = w, hi = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x] < 128) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    assert.ok(hi > lo + 100, "ada tulisan baru");
    assert.ok(Math.abs((lo + hi) / 2 - w / 2) < 6, `tengah ${(lo + hi) / 2} vs ${w / 2}`);
  }
  ok("teks terpusat tetap di tengah halaman");

  // terlalu panjang -> dikecilkan; ekstrem -> ditolak dengan catatan
  const sh = await overlayReplacePdf(src, [P("ya Budi", "ya Budi Santoso Wijaya Putra Hartono")], { tmpDir: tmp });
  assert.ok(sh.counts[0] >= 1);
  assert.ok(sh.notes.some((x) => /dikecilkan/.test(x)));
  qcheck(sh.buf);
  const huge = await overlayReplacePdf(src, [P("Kota Denpasar", "x".repeat(400))], { tmpDir: tmp });
  assert.equal(huge.buf, null);
  assert.ok(huge.notes.some((x) => /terlalu panjang/.test(x)));
  ok("terlalu panjang: dikecilkan; kelewat panjang: tidak ditimpa + catatan");

  // frasa terbelah dua baris
  const ml = await overlayReplacePdf(src, [P("Kota Denpasar dan Kota Surabaya", "X")], { tmpDir: tmp });
  assert.equal(ml.buf, null);
  assert.deepEqual(ml.multiline, ["Kota Denpasar dan Kota Surabaya"]);
  ok("frasa lintas-baris dikenali (diserahkan ke cara buat-ulang)");

  // karakter di luar huruf standar
  const lossy = await overlayReplacePdf(src, [P("Budi Santoso", "日本 Budi")], { tmpDir: tmp });
  assert.ok(lossy.notes.some((x) => /tidak ada di huruf standar/.test(x)));
  ok("karakter non-Latin: dicatat, tidak membuat PDF rusak");

  if (hasQpdf) {
    const q = (name, args) => {
      const out = path.join(tmp, name);
      const res = spawnSync("qpdf", [...args, base, out], { encoding: "utf8" });
      assert.ok(res.status === 0 || res.status === 3, res.stderr);
      return out;
    };
    // object stream + xref stream
    const os1 = fs.readFileSync(q("objstm.pdf", ["--object-streams=generate", "--compress-streams=y"]));
    assert.ok(/\/ObjStm/.test(os1.toString("latin1")) && /\/XRef/.test(os1.toString("latin1")), "fixture memakai xref/object stream");
    const ro = await overlayReplacePdf(os1, [P("Budi Santoso", "Andi Pratama")], { tmpDir: tmp });
    assert.deepEqual(ro.counts, [2]);
    assert.ok(hasWords(text(ro.buf, false), "Andi Pratama"));
    assert.equal(pages(ro.buf), 2);
    qcheck(ro.buf);
    ok("xref stream + object stream (PDF modern) bisa ditimpa");
    // dilakukan dua kali berturut-turut (rantai /Prev)
    const ro2 = await overlayReplacePdf(ro.buf, [P("Kepala Bagian", "Staf Ahli")], { tmpDir: tmp });
    assert.deepEqual(ro2.counts, [1]);
    assert.ok(hasWords(text(ro2.buf, false), "Staf Ahli") && hasWords(text(ro2.buf, false), "Andi Pratama"));
    qcheck(ro2.buf);
    ok("diedit dua kali berturut-turut tetap sah");
    // linearized
    const lin = fs.readFileSync(q("lin.pdf", ["--linearize"]));
    const rl = await overlayReplacePdf(lin, [P("Budi Santoso", "Andi")], { tmpDir: tmp });
    assert.deepEqual(rl.counts, [2]);
    qcheck(rl.buf);
    ok("PDF linearized bisa ditimpa");
    // terenkripsi
    const enc = fs.readFileSync(q("enc.pdf", ["--encrypt", "", "owner", "256", "--"]));
    await assert.rejects(() => overlayReplacePdf(enc, [P("Budi", "Andi")], { tmpDir: tmp }), (e) => e.kind === "encrypted");
    ok("PDF terenkripsi ditolak dengan jenis galat 'encrypted'");
  }

  // halaman diputar
  const rot = mk("rot.pdf", `
c = canvas.Canvas(OUT, pagesize=A4)
c.setFont("Helvetica", 12)
c.drawString(72, 700, "Budi Santoso")
c.setPageRotation(90)
c.save()
`);
  // halaman diputar tidak pernah ditimpa: ditolak ('unsupported'), atau tak ketemu sama sekali (poppler tak melaporkan kata di halaman putar)
  let rotRes = null;
  try {
    rotRes = await overlayReplacePdf(fs.readFileSync(rot), [P("Budi", "Andi")], { tmpDir: tmp });
  } catch (e) {
    assert.equal(e.kind, "unsupported");
  }
  assert.ok(!rotRes || rotRes.buf === null);
  ok("halaman diputar tidak ditimpa");
}

// ---- 6. masukan tak sah
{
  await assert.rejects(() => overlayReplacePdf(Buffer.from("bukan pdf sama sekali"), [P("a", "b")]), (e) => e.kind === "badpdf");
  await assert.rejects(() => overlayReplacePdf(Buffer.from("%PDF-1.4\nrusak total"), [P("a", "b")]), (e) => e.kind === "badpdf");
  ok("berkas bukan PDF / rusak ditolak ('badpdf')");
}

// ---- 7. penyambungan di index.js
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.ok(/import \{ overlayReplacePdf \} from "\.\/pdf-overlay\.js"/.test(src));
  const iOv = src.indexOf("tryPdfOverlay(buffer, req.pairs, name)");
  const iDocx = src.indexOf("replaceInDocx(buffer, req.pairs)", iOv);
  const iRead = src.indexOf("await pdfBufferToMarkdown(buffer)", iOv);
  assert.ok(iOv > 0 && iOv < iDocx && iDocx < iRead, "timpa PDF dicoba lebih dulu, sebelum jalur buat-ulang");
  assert.ok(/if \(isPdf && kind === "pdf"\) \{/.test(src));
  assert.ok(/if \(r\.signed\) parts\.push\(`\$\{E_SIGN_WARN\}/.test(src), "peringatan tanda tangan elektronik ikut di keterangan");
  ok("index.js: timpa PDF dicoba dulu, peringatan e-sign ada");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} kelompok tes lulus.`);
