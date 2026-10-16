// ================================================================
// Pembuat berkas Word (.docx) dan Excel (.xlsx) dari teks markdown -- TANPA pustaka tambahan
// (OOXML ditulis langsung lalu di-zip dengan buildZip dari nodin.js).
//
//   buildDocx(markdown, { title, subtitle })  -> Buffer  judul, paragraf, daftar, TABEL sungguhan, blok kode, garis, tebal/miring
//   buildXlsx(markdown, { title })            -> Buffer  tiap tabel = satu lembar; tanpa tabel = satu lembar "Teks"
//   officeFileName(title, ext)                -> "Judul-Aman.docx"
//
// Beda dengan PDF: Word/Excel mendukung Unicode penuh, jadi huruf Arab/Korea dan emoji tidak hilang.
// Excel: angka murni (1234, 1.234,5, 3,5, 1,234.50) disimpan sebagai ANGKA; yang berawalan nol (0812..., NIK), bertanda Rp/%,
// atau berupa rumus ("=A1") tetap TEKS (semua sel teks disimpan sebagai string, tidak pernah dievaluasi sebagai rumus).
// ================================================================
import { buildZip } from "./nodin.js";
import { parseBlocks, inlineRuns } from "./pdf-doc.js";

const esc = (s) =>
  String(s ?? "")
    // karakter kontrol yang dilarang XML 1.0
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const slug = (s, fallback) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || fallback;

export const officeFileName = (title, ext, fallback = "Jawaban") => `${slug(title, fallback)}.${ext}`;

export const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const plainText = (s) =>
  String(s ?? "")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

// ================================================================ DOCX
const FONT = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>';
const MONO = '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>';

function docRun(text, { b = false, i = false, mono = false, sz = 0, color = "" } = {}) {
  const rpr = `${mono ? MONO : ""}${b ? "<w:b/><w:bCs/>" : ""}${i ? "<w:i/><w:iCs/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}${sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : ""}`;
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** Teks inline markdown -> runs Word. base: { b, sz }. */
function inlineXml(text, base = {}) {
  return inlineRuns(text, base.b ? "B" : "R")
    .map((r) => docRun(r.t, { ...base, b: base.b || r.f === "B", i: r.f === "I", mono: r.f === "C" }))
    .join("");
}

const para = (inner, { style = "", jc = "", ind = "", keepNext = false, border = "", shade = "", spacing = "" } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${keepNext ? "<w:keepNext/>" : ""}${border}${shade}${spacing}${ind}${jc ? `<w:jc w:val="${jc}"/>` : ""}</w:pPr>${inner}</w:p>`;

const CELL_BORDER = '<w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/>';

function tableXml(headers, rows, totalW) {
  const n = headers.length;
  const weight = headers.map((h, c) => {
    const longest = Math.max(plainText(h).length, ...rows.map((r) => plainText(r[c]).length));
    return Math.min(Math.max(longest, 5), 38);
  });
  const sum = weight.reduce((a, b) => a + b, 0);
  const widths = weight.map((w) => Math.max(600, Math.floor((w / sum) * totalW)));
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
  const tc = (text, c, head) =>
    `<w:tc><w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>' : ""}</w:tcPr>${
      String(text ?? "").trim() === "" ? para("", { spacing: '<w:spacing w:before="40" w:after="40"/>' }) : para(inlineXml(String(text), { b: head, sz: 20 }), { spacing: '<w:spacing w:before="40" w:after="40"/>' })
    }</w:tc>`;
  const trH = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${headers.map((h, c) => tc(h, c, true)).join("")}</w:tr>`;
  const body = rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: n }, (_, c) => tc(r[c], c, false)).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${CELL_BORDER.replace(/w:(top|left|bottom|right)/g, "w:$1")}<w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${trH}${body}</w:tbl>`;
}

export function buildDocx(markdown, { title = "", subtitle = "" } = {}) {
  const blocks = parseBlocks(markdown);
  const docTitle = String(title || "").trim();
  if (docTitle && blocks[0]?.type === "heading" && plainText(blocks[0].text) === plainText(docTitle)) blocks.shift();
  const widest = Math.max(0, ...blocks.filter((b) => b.type === "table").map((b) => b.headers.length));
  const landscape = widest >= 6;
  const pageW = landscape ? 16838 : 11906;
  const pageH = landscape ? 11906 : 16838;
  const margin = 1134; // 2 cm
  const textW = pageW - margin * 2;

  const out = [];
  if (docTitle) out.push(para(docRun(docTitle), { style: "Title" }));
  if (subtitle) out.push(para(docRun(subtitle, { sz: 18, color: "6B7280" }), { spacing: '<w:spacing w:after="160"/>' }));
  let prevGap = true;
  let codeBuf = null;
  const flushCode = () => {
    if (!codeBuf) return;
    for (const l of codeBuf) out.push(para(docRun(l === "" ? " " : l, { mono: true, sz: 18 }), { shade: '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>', spacing: '<w:spacing w:before="0" w:after="0"/>' }));
    out.push(para("", { spacing: '<w:spacing w:after="60"/>' }));
    codeBuf = null;
  };
  for (const b of blocks) {
    if (b.type === "gap") {
      prevGap = true;
      continue;
    }
    if (b.type === "heading") out.push(para(inlineXml(b.text, { b: true }), { style: `Heading${Math.min(3, b.level)}`, keepNext: true }));
    else if (b.type === "para") out.push(para(inlineXml(b.text)));
    else if (b.type === "bullet") {
      const left = 360 + b.level * 360;
      out.push(para(docRun("•\t") + inlineXml(b.text), { ind: `<w:ind w:left="${left}" w:hanging="260"/>`, spacing: '<w:spacing w:after="40"/>' }));
    } else if (b.type === "number") {
      const left = 420 + b.level * 360;
      out.push(para(docRun(`${b.n}.\t`) + inlineXml(b.text), { ind: `<w:ind w:left="${left}" w:hanging="320"/>`, spacing: '<w:spacing w:after="40"/>' }));
    } else if (b.type === "table") {
      out.push(tableXml(b.headers, b.rows, textW));
      out.push(para("", { spacing: '<w:spacing w:after="80"/>' }));
    } else if (b.type === "code") {
      codeBuf = b.lines.length ? b.lines : [""];
      flushCode();
    } else if (b.type === "hr") {
      out.push(para("", { border: '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr>' }));
    }
    prevGap = false;
  }
  void prevGap;
  if (!out.length) out.push(para(""));

  const sect = `<w:sectPr><w:pgSz w:w="${pageW}" w:h="${pageH}"${landscape ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${out.join("")}${sect}</w:body></w:document>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
</w:styles>`;

  return buildZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/document.xml", data: documentXml },
    { name: "word/styles.xml", data: styles }
  ]);
}

// ================================================================ XLSX
const colName = (i) => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/**
 * Teks sel -> angka bila AMAN dibaca sebagai angka, selain itu null (tetap teks).
 *   1234 | -12 | 1.234.567 | 1.234,5 | 3,5 | 3.5 | 1,234,567.89 -> angka
 *   "1,234" / "1.234" yang bisa dibaca ganda: "1.234" (titik, 3 digit) = ribuan Indonesia; "1,234" = ambigu -> teks
 *   0812..., 007, Rp 1.000, 12%, 2026-01-05, =A1 -> teks
 */
export function asNumber(raw) {
  const s = String(raw ?? "").replace(/[ \s]/g, "");
  if (!s || s.length > 24) return null;
  let m;
  if ((m = /^(-?)(0|[1-9]\d{0,14})$/.exec(s))) return Number(s);
  if ((m = /^(-?)([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/.exec(s))) return Number(`${m[1]}${m[2].replace(/\./g, "")}${m[3] ? `.${m[3]}` : ""}`);
  if ((m = /^(-?)([1-9]\d{0,2}(?:,\d{3}){2,})(?:\.(\d+))?$/.exec(s)) || (m = /^(-?)([1-9]\d{0,2}(?:,\d{3})+)\.(\d+)$/.exec(s))) return Number(`${m[1]}${m[2].replace(/,/g, "")}${m[3] ? `.${m[3]}` : ""}`);
  if ((m = /^(-?)(0|[1-9]\d{0,14}),(\d+)$/.exec(s)) && m[3].length !== 3) return Number(`${m[1]}${m[2]}.${m[3]}`);
  if ((m = /^(-?)(0|[1-9]\d{0,14})\.(\d+)$/.exec(s)) && m[3].length !== 3) return Number(`${m[1]}${m[2]}.${m[3]}`);
  return null;
}

const SHEET_BAD = /[\[\]:*?/\\]/g;
function sheetName(raw, used, fallback) {
  let base = String(raw ?? "").replace(SHEET_BAD, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "");
  if (!base) base = fallback;
  base = base.slice(0, 28).trim() || fallback;
  let name = base;
  for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base.slice(0, 28 - String(k).length - 1)} ${k}`;
  used.add(name.toLowerCase());
  return name;
}

function cellXml(ref, value, style) {
  const n = style === 3 ? asNumber(value) : null;
  if (n !== null) return `<c r="${ref}" s="3"><v>${n}</v></c>`;
  const t = String(value ?? "");
  if (t === "") return `<c r="${ref}" s="${style === 3 ? 2 : style}"/>`;
  return `<c r="${ref}" s="${style === 3 ? 2 : style}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
}

function sheetXml(rows, { header = true, widths = null, text = false } = {}) {
  const n = Math.max(1, ...rows.map((r) => r.length));
  const cols = widths || Array.from({ length: n }, (_, c) => Math.min(60, Math.max(8, Math.ceil(Math.max(...rows.slice(0, 200).map((r) => [...plainText(r[c] ?? "")].length)) * 1.15) + 2)));
  const colsXml = `<cols>${cols.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const body = rows
    .map((r, ri) => {
      const cells = Array.from({ length: n }, (_, c) => cellXml(`${colName(c)}${ri + 1}`, plainXlsx(r[c]), header && ri === 0 ? 1 : text ? 2 : 3)).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const pane = header && rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${body}</sheetData></worksheet>`;
}

/** Sel Excel: penanda tebal markdown dibuang, spasi dirapikan; baris baru tetap. */
const plainXlsx = (s) =>
  String(s ?? "")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();

/** markdown -> [{ name, rows: string[][], header: bool }]. */
export function sheetsFromMarkdown(markdown) {
  const blocks = parseBlocks(markdown);
  const sheets = [];
  const used = new Set();
  let lastLabel = "";
  let tableNo = 0;
  for (const b of blocks) {
    if (b.type === "heading") {
      lastLabel = plainText(b.text);
    } else if (b.type === "para") {
      const t = plainText(b.text).replace(/[:：]\s*$/, "");
      lastLabel = t.length <= 30 ? t : ""; // kalimat panjang bukan nama lembar
    } else if (b.type === "table") {
      tableNo++;
      sheets.push({ name: sheetName(lastLabel, used, `Tabel ${tableNo}`), rows: [b.headers.map(plainXlsx), ...b.rows.map((r) => r.map(plainXlsx))], header: true });
      lastLabel = "";
    }
  }
  if (!sheets.length) {
    const rows = [];
    for (const b of blocks) {
      if (b.type === "heading") rows.push([plainText(b.text).toUpperCase()]);
      else if (b.type === "para") rows.push([plainText(b.text)]);
      else if (b.type === "bullet") rows.push([`• ${plainText(b.text)}`]);
      else if (b.type === "number") rows.push([`${b.n}. ${plainText(b.text)}`]);
      else if (b.type === "code") {
        for (const l of b.lines) if (l.trim()) rows.push([l.replace(/\s+$/, "")]);
      } else if (b.type === "gap" && rows.length && rows[rows.length - 1][0] !== "") rows.push([""]);
    }
    while (rows.length && rows[rows.length - 1][0] === "") rows.pop();
    sheets.push({ name: sheetName("Teks", used, "Teks"), rows: rows.length ? rows : [[""]], header: false, text: true });
  }
  return sheets;
}

export function buildXlsx(markdown) {
  const sheets = sheetsFromMarkdown(markdown);
  const parts = sheets.map((s, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: sheetXml(s.rows, { header: s.header, widths: s.text ? [110] : null, text: Boolean(s.text) })
  }));
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  // xf: 0 biasa | 1 judul kolom (tebal, abu-biru, garis, bungkus) | 2 teks isi (garis, bungkus, atas) | 3 angka (garis, kanan, atas)
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return buildZip([
    { name: "[Content_Types].xml", data: ct },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: wb },
    { name: "xl/_rels/workbook.xml.rels", data: wbRels },
    { name: "xl/styles.xml", data: styles },
    ...parts
  ]);
}

/** Ringkasan untuk keterangan/log: jumlah tabel & baris data. */
export function describeSheets(markdown) {
  const blocks = parseBlocks(markdown);
  const tables = blocks.filter((b) => b.type === "table");
  return { tables: tables.length, rows: tables.reduce((a, t) => a + t.rows.length, 0) };
}
