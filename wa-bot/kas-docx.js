// Pembuat berkas Word (.docx) untuk "Laporan Saldo Rekening" (halaman 1, A4 mendatar) dan
// "Laporan Register Penutupan Kas" (halaman 2, A4 tegak). Ditulis langsung sebagai WordprocessingML,
// tanpa pustaka tambahan, meniru tata letak PDF contoh dari sistem persuratan.
// QR tanda tangan TIDAK dibuat (sistem persuratan menambahkannya di atas tulisan "Ditandatangani secara elektronik");
// ruang kosong untuk QR tetap disediakan.

import { buildZip } from "./nodin.js";

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// ---------------------------------------------------------------- format angka & tanggal (gaya dokumen: 1,234.00)
export const fmtInt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/^-,/, "-");
export const fmtMoney = (n) => `${fmtInt(n)}.00`;
export const fmtRp = (n) => (Number(n) < 0 ? `-Rp${fmtMoney(-n)}` : `Rp${fmtMoney(n)}`);
export const ddmmyyyy = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || "");
};
export const longDate = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}` : String(iso || "");
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tw = (pt) => Math.round(pt * 20);

// ---------------------------------------------------------------- unsur dasar
const FONT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>';
function run(text, { sz = 20, b = false, i = false, color = "" } = {}) {
  const rpr = `${FONT}${b ? "<w:b/><w:bCs/>" : ""}${i ? "<w:i/><w:iCs/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
  return `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
const TAB = "<w:r><w:tab/></w:r>";

/** line = tinggi baris dalam pt (tepat). tabs = [{ pos (twip), val: left|right|center }]. */
function para(inner, { jc = "", line = 0, tabs = [], indLeft = 0, indRight = 0, border = "", sect = "", sz = 20 } = {}) {
  const tabsXml = tabs.length ? `<w:tabs>${tabs.map((t) => `<w:tab w:val="${t.val}" w:pos="${t.pos}"/>`).join("")}</w:tabs>` : "";
  const spacing = `<w:spacing w:before="0" w:after="0"${line ? ` w:line="${tw(line)}" w:lineRule="exact"` : ""}/>`;
  const ind = indLeft || indRight ? `<w:ind w:left="${indLeft}" w:right="${indRight}"/>` : "";
  const mark = `<w:rPr>${FONT}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return `<w:p><w:pPr>${border}${tabsXml}${spacing}${ind}${jc ? `<w:jc w:val="${jc}"/>` : ""}${mark}${sect}</w:pPr>${inner}</w:p>`;
}

const BORDER = '<w:top w:val="single" w:sz="5" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="5" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="5" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="5" w:space="0" w:color="000000"/>';

// ---------------------------------------------------------------- halaman 1: Laporan Saldo Rekening
// Batas kolom (x, pt) dari PDF contoh.
const X = [50.4, 69.1, 85.4, 103.5, 132.4, 199.4, 349.0, 387.6, 408.1, 461.8, 496.4, 520.3, 621.1, 665.1, 712.1, 773.7, 791.2];
const COLS = X.slice(1).map((x, i) => tw(x - X[i]));
const SZ1 = 14; // 7 pt
const ROW_H = 9.65;

function cell({ span = 1, from = 0, text = "", jc = "center", b = false, i = false, vMerge = "", valign = "center", sz = SZ1, color = "" }) {
  const width = COLS.slice(from, from + span).reduce((a, c) => a + c, 0);
  const tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${vMerge ? (vMerge === "restart" ? '<w:vMerge w:val="restart"/>' : "<w:vMerge/>") : ""}<w:vAlign w:val="${valign}"/>`;
  const lines = Array.isArray(text) ? text : [text];
  const pad = { indLeft: jc === "left" ? 22 : 0, indRight: jc === "right" ? 22 : 0 };
  const ps = lines.map((t) => para(t === "" ? "" : run(t, { sz, b, i, color }), { jc, line: ROW_H, sz, ...pad })).join("");
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${ps}</w:tc>`;
}
const row = (cells, h = ROW_H) => `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${tw(h)}" w:hRule="exact"/></w:trPr>${cells.join("")}</w:tr>`;

function accountRow(n, a) {
  const c = (idx, text, jc = "center") => cell({ from: idx, text, jc });
  return row([
    c(0, String(n)),
    c(1, a.ba),
    c(2, a.es),
    c(3, a.kode),
    c(4, a.nomor, "left"),
    c(5, String(a.nama || "").slice(0, 35), "left"),
    c(6, a.jenis),
    c(7, a.kodeBank),
    c(8, a.bank),
    c(9, a.cabang),
    c(10, a.kodeRek),
    c(11, a.persNomor),
    c(12, ddmmyyyy(a.persTanggal)),
    c(13, ddmmyyyy(a.tgl)),
    c(14, fmtInt(a.saldo), "right"),
    c(15, a.ket || "-")
  ]);
}

function saldoPage(v) {
  const accounts = v.accounts || [];
  const groups = [
    ["Telah Menjadi Hak Negara", accounts.map((a, i) => ({ a, i })).filter((x) => x.a.group === "hak")],
    ["Belum/Tidak Menjadi Hak Negara", accounts.map((a, i) => ({ a, i })).filter((x) => x.a.group !== "hak")]
  ].filter((g) => g[1].length);

  const head1 = row(
    [
      cell({ from: 0, text: "No", vMerge: "restart", valign: "top" }),
      cell({ from: 1, span: 3, text: "Satuan Kerja", valign: "top" }),
      cell({ from: 4, span: 3, text: "Rekening", valign: "top" }),
      cell({ from: 7, span: 3, text: "Bank", valign: "top" }),
      cell({ from: 10, text: ["Kode", "Rek"], vMerge: "restart", valign: "top" }),
      cell({ from: 11, span: 2, text: "Persetujuan Rekening", valign: "top" }),
      cell({ from: 13, text: ["Tanggal", "Transaksi", "Terakhir"], vMerge: "restart", valign: "top" }),
      cell({ from: 14, text: "Saldo Akhir", vMerge: "restart", valign: "top" }),
      cell({ from: 15, text: "Ket.", vMerge: "restart", valign: "top" })
    ],
    9.7
  );
  const sub = (from, text) => cell({ from, text, valign: "top" });
  const head2 = row(
    [
      cell({ from: 0, vMerge: "cont", text: "" }),
      sub(1, "BA"),
      sub(2, "Es. I"),
      sub(3, "Kode"),
      sub(4, "Nomor"),
      sub(5, "Nama"),
      sub(6, "Jenis Kode"),
      sub(7, "Kode"),
      sub(8, "Nama"),
      sub(9, "Cabang"),
      cell({ from: 10, vMerge: "cont", text: "" }),
      sub(11, "Nomor"),
      sub(12, "Tanggal"),
      cell({ from: 13, vMerge: "cont", text: "" }),
      cell({ from: 14, vMerge: "cont", text: "" }),
      cell({ from: 15, vMerge: "cont", text: "" })
    ],
    20.5
  );

  const body = [];
  let n = 0;
  for (const [title, items] of groups) {
    body.push(row([cell({ from: 0, span: 16, text: title, jc: "left", b: true, i: true })]));
    let sum = 0;
    for (const { a } of items) {
      n += 1;
      sum += Number(a.saldo) || 0;
      body.push(accountRow(n, a));
    }
    body.push(row([cell({ from: 0, span: 14, text: "Jumlah", b: true, i: true }), cell({ from: 14, text: fmtInt(sum), jc: "right" }), cell({ from: 15, text: "" })]));
  }

  const total = COLS.reduce((a, c) => a + c, 0);
  const table = `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/><w:tblBorders>${BORDER}<w:insideH w:val="single" w:sz="5" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="5" w:space="0" w:color="000000"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="20" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="20" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${COLS.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>${head1}${head2}${body.join("")}</w:tbl>`;

  const t = (text) => para(run(text, { sz: SZ1 }), { jc: "center", line: ROW_H, sz: SZ1 });
  const sig = (text, o = {}) => para(text ? run(text, { sz: SZ1, ...o }) : "", { line: ROW_H, indLeft: tw(522.4 - 50.4), sz: SZ1 });
  const sigLines = [sig("Kuasa Pengguna Anggaran"), ...Array.from({ length: 8 }, () => sig("")), sig("Ditandatangani secara elektronik", { color: "BFBFBF" }), sig(v.kpa.nama), sig(v.kpa.nip ? `NIP ${v.kpa.nip}` : "")];

  const sect1 = `<w:sectPr><w:pgSz w:w="16858" w:h="11918" w:orient="landscape"/><w:pgMar w:top="${tw(53.3)}" w:right="1034" w:bottom="${tw(54.3)}" w:left="${tw(50.4)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  // paragraf terakhir halaman 1 membawa batas bagian (pindah ke halaman 2)
  const last = sigLines.pop().replace("</w:pPr>", `${sect1}</w:pPr>`);
  return [t("LAPORAN SALDO REKENING"), t(v.satker), t(`PER  ${ddmmyyyy(v.closingDate)}`), para("", { line: 9.2, sz: SZ1 }), table, para("", { line: 10.4, sz: SZ1 }), ...sigLines, last].join("");
}

// ---------------------------------------------------------------- halaman 2: Register Penutupan Kas
const L = 1046; // margin kiri (twip) = 52.3 pt
const T_COLON = tw(226.0 - 52.3);
const T_VAL = tw(248.8 - 52.3);
const T_AMT = tw(362.8 - 52.3);
const T_CNT = tw(388.3 - 52.3);
const T_UNIT = tw(392.9 - 52.3);
const T_RP2 = tw(437.2 - 52.3);
const T_AMT2 = tw(542.5 - 52.3);
const PITCH = 12.7;

function registerPage(v) {
  const S = 20; // 10 pt (isi), S2 = 9 pt (perincian)
  const S2 = 18;
  const p = (inner, o = {}) => para(inner, { line: PITCH, sz: S, ...o });
  const blank = (h = PITCH) => para("", { line: h, sz: S });
  const kv = (label, value, valueRuns = null) => p(`${run(label, { sz: S })}${TAB}${run(":", { sz: S })}${TAB}${valueRuns || run(value, { sz: S })}`, { tabs: [{ pos: T_COLON, val: "left" }, { pos: T_VAL, val: "left" }] });
  const money = (label, amount, { bold = false, colon = true } = {}) =>
    p(`${run(label, { sz: S, b: bold })}${TAB}${colon ? run(":", { sz: S }) : ""}${TAB}${run("Rp.", { sz: S })}${TAB}${run(fmtMoney(amount), { sz: S })}`, { tabs: [{ pos: T_COLON, val: "left" }, { pos: T_VAL, val: "left" }, { pos: T_AMT, val: "right" }] });

  const out = [];
  out.push(p(run("LAPORAN REGISTER PENUTUPAN KAS", { sz: S }), { jc: "center" }));
  out.push(p(run(`BULAN : ${v.periodLabelUpper}`, { sz: S }), { jc: "center" }));
  out.push(blank(PITCH * 2 - 0.4));
  out.push(kv("Tanggal penutupan kas", longDate(v.closingDate)));
  out.push(kv("Nama penutup kas (Pemeriksa Kas)", v.pemeriksa));
  out.push(kv("Tanggal penutupan kas yang lalu", longDate(v.prevClosingDate)));
  out.push(money("Saldo awal", v.awal));
  out.push(money("Jumlah total penerimaan", v.terima));
  // garis di bawah pengeluaran (membatasi jumlah)
  out.push(p(`${run("Jumlah total pengeluaran", { sz: S })}${TAB}${run(":", { sz: S })}${TAB}${run("Rp.", { sz: S })}${TAB}${run(fmtMoney(v.keluar), { sz: S })}`, { tabs: [{ pos: T_COLON, val: "left" }, { pos: T_VAL, val: "left" }, { pos: T_AMT, val: "right" }], line: PITCH - 1.4 }));
  out.push(para("", { line: 0.7, sz: 2, indLeft: tw(246.1 - 52.3), indRight: tw(545.2 - 365.5), border: '<w:pBdr><w:bottom w:val="single" w:sz="5" w:space="0" w:color="000000"/></w:pBdr>' }));
  out.push(money("     Saldo Buku (A)", v.A, { bold: true, colon: false }));
  out.push(blank());
  out.push(money("     Saldo Kas (B)", v.B, { bold: true, colon: false }));
  out.push(blank());
  out.push(p(run("Terdiri dari (Perincian B) :", { sz: S2 })));

  const names = ["1. Lembaran uang kertas", "    Lembaran uang kertas", "    Lembaran uang kertas", "    Lembaran uang kertas", "    Lembaran uang kertas", "    Lembaran uang kertas", "    Lembaran uang kertas", "    Kepingan uang logam", "    Kepingan uang logam", "    Kepingan uang logam"];
  v.denoms.forEach((d, idx) => {
    const unit = d.nominal >= 2000 ? "lembar" : "keping";
    out.push(
      p(
        `${run(names[idx], { sz: S2 })}${TAB}${run("Rp.", { sz: S2 })}${TAB}${run(fmtMoney(d.nominal), { sz: S2 })}${TAB}${run(String(d.count), { sz: S })}${TAB}${run(unit, { sz: S2 })}${TAB}${run("Rp.", { sz: S2 })}${TAB}${run(fmtMoney(d.nominal * d.count), { sz: S2 })}`,
        { tabs: [{ pos: T_COLON, val: "left" }, { pos: T_AMT, val: "right" }, { pos: T_CNT, val: "right" }, { pos: T_UNIT, val: "left" }, { pos: T_RP2, val: "left" }, { pos: T_AMT2, val: "right" }] }
      )
    );
  });
  out.push(p(`${TAB}${run("Sub jumlah", { sz: S2 })}${TAB}${run("Rp.", { sz: S2 })}${TAB}${run(fmtMoney(v.tunai), { sz: S2 })}`, { tabs: [{ pos: tw(367.5 - 52.3), val: "left" }, { pos: T_RP2, val: "left" }, { pos: T_AMT2, val: "right" }] }));
  out.push(blank(PITCH + 1.0));
  out.push(p(`${run("2. Kertas berharga dan bagian kas lainnya", { sz: S })}${TAB}${run("Rp.", { sz: S2 })}${TAB}${run(fmtMoney(v.item2), { sz: S })}`, { tabs: [{ pos: T_RP2, val: "left" }, { pos: T_AMT2, val: "right" }] }));
  out.push(p(run("     (Cek, saldo bank, dan lain sebagainya)", { sz: S })));
  out.push(blank(PITCH + 1.4));
  out.push(p(`${TAB}${run("Jumlah B", { sz: S, b: true })}${TAB}${run("Rp.", { sz: S, b: true })}${TAB}${run(fmtMoney(v.B), { sz: S, b: true })}`, { tabs: [{ pos: T_VAL, val: "left" }, { pos: T_RP2, val: "left" }, { pos: T_AMT2, val: "right" }], line: PITCH - 1.6 }));
  out.push(para("", { line: 1.6, sz: 2, indLeft: tw(434.5 - 52.3), border: '<w:pBdr><w:bottom w:val="double" w:sz="6" w:space="0" w:color="000000"/></w:pBdr>' }));
  out.push(blank(PITCH - 2.4));
  out.push(kv("     Perbedaan/selisih (A-B)", fmtRp(v.selisih)));
  out.push(kv("     Penjelasan", v.penjelasan));
  out.push(blank());

  const two = (l, r, o = {}) => p(`${run(l, { sz: S, ...(o.left || {}) })}${TAB}${run(r, { sz: S, ...(o.right || {}) })}`, { tabs: [{ pos: tw(392.9 - 52.3), val: "left" }] });
  out.push(two("     Mengetahui,", `${v.city}, ${longDate(v.closingDate)}`));
  out.push(two("     Kuasa Pengguna Anggaran", "Bendahara Pengeluaran"));
  for (let i = 0; i < 7; i++) out.push(blank());
  const gray = { color: "BFBFBF" };
  out.push(two("     Ditandatangani secara elektronik", "Ditandatangani secara elektronik", { left: gray, right: gray }));
  out.push(two(`     ${v.kpa.nama}`, v.bendahara.nama));
  const lastLine = two(v.kpa.nip ? `     NIP ${v.kpa.nip}` : "", v.bendahara.nip ? `NIP ${v.bendahara.nip}` : "");
  out.push(lastLine);
  return out.join("");
}

// ---------------------------------------------------------------- paket .docx
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** view -> Buffer .docx (dua halaman: Laporan Saldo Rekening + Register Penutupan Kas). */
export function buildKasDocx(view) {
  const sect2 = `<w:sectPr><w:pgSz w:w="11918" w:h="16858"/><w:pgMar w:top="${tw(54.3)}" w:right="1014" w:bottom="${tw(54.3)}" w:left="${L}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${saldoPage(view)}${registerPage(view)}${sect2}</w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`;
  const b = (s) => Buffer.from(s, "utf8");
  return buildZip([
    { name: "[Content_Types].xml", data: b(contentTypes) },
    { name: "_rels/.rels", data: b(rels) },
    { name: "word/document.xml", data: b(document) },
    { name: "word/styles.xml", data: b(styles) },
    { name: "word/settings.xml", data: b(settings) },
    { name: "word/_rels/document.xml.rels", data: b(docRels) }
  ]);
}
