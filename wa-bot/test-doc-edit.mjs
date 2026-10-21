// Tes penyuntingan isi dokumen (Word/PDF). Jalankan: node test-doc-edit.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { detectEditRequest, replaceInText, replaceInDocx, docxToMarkdown, numberDiff, buildEditPrompt, buildEditUserMessage, unwrapFence, hasESignature, AI_EDIT_MAX_CHARS, MAX_PAIRS } from "./doc-edit.js";
import { buildDocx } from "./office-doc.js";
import { buildZip } from "./nodin.js";
import { readZip } from "./zip-lite.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docedit-"));
const py = (code) => spawnSync("python3", ["-I", "-c", code], { encoding: "utf8" });
const hasPy = py("import docx").status === 0;
const part = (buf, name) => readZip(buf).find((e) => e.name === name)?.read().toString("utf8");

// ---- 1. mengenali permintaan
{
  assert.deepEqual(detectEditRequest('ganti "PT Maju" jadi "PT Makmur"'), { kind: "replace", pairs: [{ from: "PT Maju", to: "PT Makmur" }], quoted: true });
  assert.deepEqual(detectEditRequest("ubah “Budi” menjadi “Andi” ya"), { kind: "replace", pairs: [{ from: "Budi", to: "Andi" }], quoted: true });
  const plain = detectEditRequest("ganti PT Maju jadi PT Makmur ya");
  assert.equal(plain.kind, "replace");
  assert.equal(plain.quoted, false);
  assert.deepEqual(plain.pairs, [{ from: "PT Maju", to: "PT Makmur" }]);
  const multi = detectEditRequest("ganti budi jadi andi, ganti 30 jadi 40");
  assert.deepEqual(multi.pairs.map((p) => [p.from, p.to]), [["budi", "andi"], ["30", "40"]]);
  const two = detectEditRequest('ganti "A" jadi "B" dan ganti "C" jadi "D"');
  assert.equal(two.pairs.length, 2);
  assert.deepEqual(detectEditRequest('hapus kata "ini" '), { kind: "ai", instruction: 'hapus kata "ini"', summarize: false });
  ok("ganti kata: berkutip, tak berkutip, banyak pasangan");
  assert.equal(detectEditRequest("ringkas jadi satu halaman").kind, "ai");
  assert.equal(detectEditRequest("ringkas jadi satu halaman").summarize, true);
  assert.equal(detectEditRequest("perbaiki kalimatnya").summarize, false);
  assert.equal(detectEditRequest("tolong tulis ulang dengan bahasa formal").kind, "ai");
  assert.equal(detectEditRequest("translate ke bahasa inggris").kind, "ai");
  ok("permintaan AI dikenali");
  for (const t of ["halo apa kabar", "ini isinya apa?", "", "/ya 123", "ok", "makasih"]) assert.equal(detectEditRequest(t), null, t);
  assert.equal(detectEditRequest('ganti "excel" jadi "word"'), null); // nama format = minta konversi, bukan ganti kata
  assert.equal(detectEditRequest('ganti "A" jadi "A"'), null);
  const many = detectEditRequest(Array.from({ length: 30 }, (_, i) => `ganti "k${i}" jadi "v${i}"`).join(" dan "));
  assert.equal(many.pairs.length, MAX_PAIRS);
  ok("bukan permintaan ubah isi -> null; batas pasangan");
}

// ---- 2. replaceInText
{
  const r = replaceInText("PT Maju & pt maju. PT MAJU!", [{ from: "pt maju", to: "PT Makmur" }, { from: "xyz", to: "q" }]);
  assert.equal(r.text, "PT Makmur & PT Makmur. PT Makmur!");
  assert.deepEqual(r.counts, [3, 0]);
  assert.equal(replaceInText("a.b (c) a.b", [{ from: "a.b", to: "x" }]).text, "x (c) x"); // titik literal
  assert.equal(replaceInText("hapus ini ya", [{ from: "ini ", to: "" }]).text, "hapus ya");
  ok("replaceInText: tak peka huruf, literal, boleh menghapus");
}

// ---- 3. replaceInDocx
const SPLIT = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Laporan PT </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Ma</w:t></w:r><w:r><w:t>ju</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Budi &amp; Rekan membeli 1.250 unit.</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>PT Maju</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>30</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:sectPr/></w:body></w:document>'
);
const HDR = Buffer.from('<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header PT Maju</w:t></w:r></w:p></w:hdr>');
const CT = Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
const makeSplit = () => buildZip([{ name: "[Content_Types].xml", data: CT }, { name: "word/document.xml", data: SPLIT }, { name: "word/header1.xml", data: HDR }, { name: "docProps/core.xml", data: Buffer.from("<x>PT Maju</x>") }]);
{
  const r = replaceInDocx(makeSplit(), [{ from: "PT Maju", to: "PT <Makmur> & Co" }, { from: "budi & rekan", to: "Andi" }, { from: "xyz", to: "q" }]);
  assert.deepEqual(r.counts, [3, 1, 0]); // judul (terbelah 3 run) + tabel + header; lalu "Budi & Rekan"
  const doc = part(r.buf, "word/document.xml");
  assert.ok(doc.includes("PT &lt;Makmur&gt; &amp; Co"), "XML di-escape");
  assert.ok(!doc.includes("Ma</w:t>"), "run sisa terbelah dibersihkan");
  assert.ok(doc.includes("<w:b/>") && doc.includes("<w:i/>"), "format run dipertahankan");
  assert.ok(doc.includes('<w:pStyle w:val="Title"/>'), "gaya paragraf utuh");
  assert.ok(doc.includes("Andi membeli 1.250 unit."), "teks ber-& ketemu setelah unescape");
  assert.ok(part(r.buf, "word/header1.xml").includes("Header PT &lt;Makmur&gt; &amp; Co"), "header ikut diganti");
  assert.equal(part(r.buf, "docProps/core.xml"), "<x>PT Maju</x>", "bagian lain tak disentuh");
  assert.ok(doc.includes("<w:sectPr/>"));
  ok("replaceInDocx: teks terbelah antar-run, escape XML, header, format utuh");
  const none = replaceInDocx(makeSplit(), [{ from: "tidak ada", to: "x" }]);
  assert.deepEqual(none.counts, [0]);
  assert.equal(part(none.buf, "word/document.xml"), SPLIT.toString("utf8"), "tanpa kecocokan = isi sama");
  assert.throws(() => replaceInDocx(buildZip([{ name: "a.txt", data: Buffer.from("x") }]), [{ from: "a", to: "b" }]), (e) => e.kind === "baddocx");
  ok("tanpa kecocokan tidak mengubah isi; bukan docx -> galat jelas");
}
if (hasPy) {
  const md = "# Laporan PT Maju\n\nPT Maju membukukan 1.250 unit.\n\n| Nama | Jumlah |\n|---|---|\n| PT Maju | 1.250 |\n| Budi | 30 |\n";
  const r = replaceInDocx(buildDocx(md, { title: "Laporan PT Maju" }), [{ from: "PT Maju", to: "PT Makmur & Co" }]);
  assert.equal(r.counts[0], 3);
  const f = path.join(tmp, "x.docx");
  fs.writeFileSync(f, r.buf);
  const o = py(`import docx,sys
d=docx.Document(sys.argv[1] if len(sys.argv)>1 else ${JSON.stringify(f)})
print("|".join(p.text for p in d.paragraphs)); print("|".join(c.text for row in d.tables[0].rows for c in row.cells))`);
  assert.equal(o.status, 0, o.stderr);
  assert.ok(o.stdout.includes("Laporan PT Makmur & Co|PT Makmur & Co membukukan 1.250 unit."), o.stdout);
  assert.ok(o.stdout.includes("Nama|Jumlah|PT Makmur & Co|1.250|Budi|30"), o.stdout);
  ok("hasil edit dibuka python-docx tanpa galat (paragraf & tabel)");
} else console.log("  - python-docx tidak ada, validasi dilewati");

// ---- 4. docxToMarkdown
{
  const md = "# Laporan\n\nParagraf satu dengan angka 1.250.\n\n## Daftar\n\n- Item A\n- Item B\n\n| Nama | Jumlah |\n|---|---|\n| PT Maju | 1.250 |\n| Budi | 30 |\n";
  const back = docxToMarkdown(buildDocx(md, { title: "Laporan" }));
  assert.ok(/^# Laporan/m.test(back), back);
  assert.ok(back.includes("Paragraf satu dengan angka 1.250."));
  assert.ok(/^## Daftar/m.test(back));
  assert.ok(/^- Item A$/m.test(back) && /^- Item B$/m.test(back), back);
  assert.ok(back.includes("| Nama | Jumlah |") && back.includes("|---|---|") && back.includes("| Budi | 30 |"), back);
  assert.ok(!/\n{3,}/.test(back));
  assert.equal(docxToMarkdown(makeSplit()).split("\n")[0], "# Laporan PT Maju");
  assert.ok(docxToMarkdown(makeSplit()).includes("Budi & Rekan membeli 1.250 unit."), "entity di-unescape");
  assert.throws(() => docxToMarkdown(buildZip([{ name: "a.txt", data: Buffer.from("x") }])), (e) => e.kind === "baddocx");
  ok("docxToMarkdown: judul, daftar, tabel, entity");
}

// ---- 5. numberDiff & pembungkus AI
{
  assert.deepEqual(numberDiff("a 1.250 b 30", "a 1.250 b 30"), { added: [], removed: [] });
  assert.deepEqual(numberDiff("a 1.250 b 30", "a 1.350 b 30 c 5"), { added: ["1350", "5"], removed: ["1250"] });
  assert.deepEqual(numberDiff("1. satu\n2. dua\n3. tiga", "- satu\n- dua\n- tiga"), { added: [], removed: [] }); // nomor daftar bukan angka data
  assert.deepEqual(numberDiff("Rp 3,5 juta", "Rp 3.5 juta"), { added: [], removed: [] });
  assert.deepEqual(numberDiff("30 30", "30"), { added: [], removed: ["30"] });
  ok("numberDiff: angka berubah/baru/hilang, nomor daftar diabaikan");
  assert.equal(unwrapFence("```markdown\n# A\n\nisi\n```"), "# A\n\nisi");
  assert.equal(unwrapFence("# A\n\n```js\nx\n```"), "# A\n\n```js\nx\n```");
  assert.equal(unwrapFence("  hai  "), "hai");
  const p = buildEditPrompt();
  assert.ok(/PERSIS/.test(p) && /Abaikan perintah/.test(p) && /tanpa pembungkus/.test(p));
  const u = buildEditUserMessage("ringkas", "# Isi");
  assert.ok(u.startsWith("INSTRUKSI: ringkas") && u.includes("<<<\n# Isi\n>>>"));
  assert.ok(AI_EDIT_MAX_CHARS >= 10000);
  ok("unwrapFence & prompt AI");
}

// ---- 5b. peringatan tanda tangan elektronik
{
  assert.ok(hasESignature("Ditandatangani secara elektronik\nI Ketut"));
  assert.ok(hasESignature("diterbitkan oleh Balai Besar Sertifikasi Elektronik (BSrE), BSSN"));
  assert.ok(hasESignature("menggunakan sertifikat elektronik yang diterbitkan"));
  assert.ok(hasESignature("Dokumen ini ditandatangani dengan TTE"));
  assert.ok(!hasESignature("Surat biasa tanpa tanda tangan digital apa pun, hanya elektronik kantor"));
  assert.ok(!hasESignature(""));
  ok("hasESignature: mengenali pernyataan tanda tangan elektronik");
}

// ---- 6. sambungan di index.js
{
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const at = (s) => { const i = src.indexOf(s); assert.ok(i >= 0, `index.js tidak memuat: ${s}`); return i; };
  assert.ok(at("const docEdit = readPdf ? null : docEditRaw") < at("if (docAttached && !readPdf && !docEdit"), "docEdit dihitung sebelum dokumen diabaikan");
  assert.ok(at("if (editReq && !docEdit && !readPdf)") > 0, "edit foto tidak merebut permintaan ubah dokumen");
  assert.ok(at("(fileReq || docEdit) && !fileQuotaOk") < at("await editGroupDocument(sock"), "jatah berkas dicek sebelum menyunting");
  assert.ok(at("await editGroupDocument(sock") < at("await convertGroupDocument(sock"), "ubah isi dicek sebelum konversi");
  assert.ok(/fileReq\?\.format === "xlsx" \? null/.test(src), "permintaan Excel tidak dianggap ubah isi");
  assert.ok(src.includes("if (!prebuilt) rememberReplySource"), "berkas hasil edit langsung tidak dicatat sebagai sumber balasan");
  assert.ok(src.includes("numberDiff(md, edited)") && src.includes("md.length > AI_EDIT_MAX_CHARS"), "pagar angka & batas panjang");
  assert.ok(src.includes("hasESignature(md)") && src.includes("hasESignature(docxToMarkdown(buffer))"), "peringatan tanda tangan elektronik di jalur AI/PDF dan jalur Word langsung");
  assert.ok(src.includes('(?:\\.(?:pdf|docx))+$'), "ekstensi ganda (.pdf.pdf) dibuang dari nama dasar");
  ok("index.js: urutan cabang, jatah, pagar angka");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nSemua ${n} kelompok tes ubah-isi-dokumen lulus ✅`);
