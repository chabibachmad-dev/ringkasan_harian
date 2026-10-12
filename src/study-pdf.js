// PDF hasil belajar (soal + jawaban + pembahasan + poin), dirender langsung dengan jsPDF seperti export obrolan
// supaya hasilnya sama di semua perangkat. Teks dibersihkan lewat pdfSafeText (font standar PDF hanya Latin-1).

import { jsPDF } from "jspdf";
import { pdfSafeText, studyPdfFileName, roomPdfFileName, materialBlocks, materialPdfFileName, pointsFormula, splitFences } from "./study-text.js";
import { gradeText } from "../supabase/functions/_shared/study-core.ts";

const LETTERS = ["A", "B", "C", "D"];

// result = hasil dari Edge Function study (lihat loadResult). L(key, vars) = penerjemah teks.
export function buildStudyPdf(result, L, locale = "id-ID") {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (h) => {
    if (y + h > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const write = (text, { size = 11, bold = false, gap = 0, indent = 0, gray = false, font = "helvetica" } = {}) => {
    doc.setFont(font, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(gray ? 110 : 0);
    const lh = size * 1.35;
    for (const para of String(text).split("\n")) {
      const lines = para.trim() ? doc.splitTextToSize(para, maxWidth - indent) : [""];
      for (const line of lines) {
        ensureSpace(lh);
        doc.text(line, margin + indent, y);
        y += lh;
      }
    }
    y += gap;
  };

  const s = result.session || {};
  const levelName = L(`study_level_${s.level}`);
  const when = s.submittedAt ? new Date(s.submittedAt) : new Date();
  const dateText = when.toLocaleString(locale, { dateStyle: "long", timeStyle: "short" });

  write(pdfSafeText(`${L("study_pdf_title")}: ${s.subject || ""}`), { size: 16, bold: true, gap: 4 });
  if (s.topic) write(pdfSafeText(`${L("study_topic_label")}: ${s.topic}`), { size: 10, gray: true });
  write(
    pdfSafeText(`${L("study_pdf_player")}: ${result.player?.name || ""} (${gradeText(result.player?.grade || "", result.player?.classLevel)})  |  ${L("study_material_grade")}: ${gradeText(s.materialGrade || "", s.materialClass)}  |  ${L("study_level")}: ${levelName} (${result.weightPercent}%)`),
    { size: 10, gray: true }
  );
  write(dateText, { size: 10, gray: true, gap: 8 });
  write(
    pdfSafeText(
      `${L("study_pdf_score")}: ${result.correct} / ${result.total}   |   ${L("study_pdf_points")}: +${result.points}`
    ),
    { size: 13, bold: true }
  );
  write(
    pdfSafeText(pointsFormula(result, L)),
    { size: 9, gray: true, gap: 12 }
  );

  for (const it of result.items || []) {
    ensureSpace(60);
    // soal berisi kode: teks biasa dan blok kode digambar terpisah (kode: font monospasi, baris & indentasi dipertahankan)
    const segs = splitFences(it.question);
    let first = true;
    for (const seg of segs.length ? segs : [{ type: "text", text: "" }]) {
      if (seg.type === "code") {
        write(seg.text.replace(/[^\n\t -~ -ÿ]/g, "?"), { size: 9.5, font: "courier", indent: 14, gap: 3 });
      } else {
        write(pdfSafeText(`${first ? `${it.idx + 1}. ` : ""}${seg.text}`), { size: 11, bold: true, gap: first ? 2 : 3 });
      }
      first = false;
    }
    it.options.forEach((opt, i) => {
      const marks = [];
      if (i === it.correctIndex) marks.push(L("study_pdf_key"));
      if (i === it.userAnswer) marks.push(L("study_pdf_yours"));
      const suffix = marks.length ? `   <- ${marks.join(", ")}` : "";
      write(pdfSafeText(`${LETTERS[i]}. ${opt}`) + suffix, { size: 10.5, bold: i === it.correctIndex, indent: 14 });
    });
    if (it.userAnswer === null || it.userAnswer === undefined) write(L("study_pdf_unanswered"), { size: 9.5, gray: true, indent: 14 });
    y += 2;
    if (it.explanation) {
      write(pdfSafeText(`${L("study_explanation")}: ${it.explanation}`), { size: 10, indent: 14 });
    }
    if (it.doubtful) write(pdfSafeText(L("study_doubtful")), { size: 9.5, bold: true, indent: 14 });
    y += 10;
  }

  // nomor halaman
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`${p} / ${pages}`, pageWidth - margin, pageHeight - 24, { align: "right" });
  }
  return doc;
}

// Bagikan lewat lembar bagikan perangkat (Web Share API dengan berkas) bila ada; kalau tidak, unduh.
export function shareOrSaveStudyPdf(doc, result, shareTitle) {
  return shareOrSaveFile(doc, studyPdfFileName(result.player?.name, result.session?.subject), shareTitle);
}

export function shareOrSaveMaterialPdf(doc, material, shareTitle) {
  return shareOrSaveFile(doc, materialPdfFileName(material.subject, material.title, material.createdAt ? new Date(material.createdAt) : new Date()), shareTitle);
}

export function shareOrSaveRoomPdf(doc, room, shareTitle) {
  return shareOrSaveFile(doc, roomPdfFileName(room.subject), shareTitle);
}

async function shareOrSaveFile(doc, name, shareTitle) {
  try {
    const blob = doc.output("blob");
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: shareTitle });
      return "shared";
    }
  } catch (err) {
    if (err && err.name === "AbortError") return "cancelled"; // pengguna menutup lembar bagikan
    /* gagal membagikan: jatuh ke unduh di bawah */
  }
  doc.save(name);
  return "saved";
}

// PDF materi pelajaran. material = { title, subject, grade, detail, creatorName, createdAt, content (Markdown) }.
export function buildMaterialPdf(material, L, locale = "id-ID") {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (h) => {
    if (y + h > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const write = (text, { size = 10.5, bold = false, gap = 0, indent = 0, gray = false, font = "helvetica", prefix = "" } = {}) => {
    doc.setFont(font, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(gray ? 110 : 0);
    const lh = size * 1.4;
    let first = true;
    for (const para of String(text).split("\n")) {
      const lines = para.trim() ? doc.splitTextToSize((first ? prefix : "") + para, maxWidth - indent) : [""];
      for (const line of lines) {
        ensureSpace(lh);
        doc.text(line, margin + indent, y);
        y += lh;
      }
      first = false;
    }
    y += gap;
  };

  const when = material.createdAt ? new Date(material.createdAt) : new Date();
  write(pdfSafeText(material.title || ""), { size: 17, bold: true, gap: 4 });
  write(pdfSafeText(`${material.subject || ""}  |  ${L("study_np_grade")}: ${gradeText(material.grade || "", material.classLevel)}`), { size: 10, gray: true });
  write(pdfSafeText(`${L("study_mat_pdf_by")}: ${material.creatorName || "-"}  |  ${when.toLocaleDateString(locale, { dateStyle: "long" })}`), { size: 10, gray: true });
  if (material.detail) write(pdfSafeText(`${L("study_mat_pdf_detail")}: ${material.detail}`), { size: 10, gray: true });
  write(pdfSafeText(L("study_mat_pdf_note")), { size: 9, gray: true, gap: 12 });

  for (const b of materialBlocks(material.content)) {
    if (b.type === "h2") {
      ensureSpace(40);
      y += 6;
      write(b.text, { size: 14, bold: true, gap: 3 });
    } else if (b.type === "h3") {
      ensureSpace(32);
      y += 3;
      write(b.text, { size: 12, bold: true, gap: 2 });
    } else if (b.type === "li") {
      write(b.text, { indent: 12 + (b.level || 0) * 14, prefix: b.num ? `${b.num}. ` : "- ", gap: 1 });
    } else if (b.type === "quote") {
      write(b.text, { indent: 14, gray: true, gap: 3 });
    } else if (b.type === "code") {
      write(b.text, { size: 9.5, font: "courier", indent: 10, gap: 5 });
    } else if (b.type === "table") {
      write(b.text, { size: 9.5, indent: 10, gap: 1 });
    } else {
      write(b.text, { gap: 5 });
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`${p} / ${pages}`, pageWidth - margin, pageHeight - 24, { align: "right" });
  }
  return doc;
}

// PDF hasil kompetisi. room = info ruang (subject, topic, materialGrade, materialClass, level, weightPercent, numQuestions,
// timeLimitSeconds, creatorName, winnerName, winBonus); results = baris peringkat dari Edge Function study.
// minutes = durasi (menit) yang sudah dihitung pemanggil; fmtClock(detik) -> "m:dd".
export function buildRoomPdf(room, results, L, { locale = "id-ID", minutes = 0, fmtClock = (n) => String(n), date = new Date() } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (h) => {
    if (y + h > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const write = (text, { size = 11, bold = false, gap = 0, gray = false } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(gray ? 110 : 0);
    const lh = size * 1.35;
    for (const line of doc.splitTextToSize(String(text), maxWidth)) {
      ensureSpace(lh);
      doc.text(line, margin, y);
      y += lh;
    }
    y += gap;
  };
  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);

  write(pdfSafeText(`${L("study_kind_competition")}: ${room.subject || ""}${room.topic ? ` - ${room.topic}` : ""}`), { size: 16, bold: true, gap: 4 });
  write(
    pdfSafeText(
      `${gradeText(room.materialGrade || "", room.materialClass)}  |  ${L(`study_level_${room.level}`)} (${room.weightPercent}%)  |  ${room.numQuestions} ${L("study_questions_unit")}  |  ${L("study_feed_minutes", { m: minutes })}`
    ),
    { size: 10, gray: true }
  );
  write(pdfSafeText(cap(L("study_room_by", { name: room.creatorName || "-" }))), { size: 10, gray: true });
  write(date.toLocaleString(locale, { dateStyle: "long", timeStyle: "short" }), { size: 10, gray: true, gap: 10 });
  write(pdfSafeText(room.winnerName ? L("study_room_winner", { name: room.winnerName }) : L("study_room_no_winner")), { size: 13, bold: true });
  if (room.winnerName) write(pdfSafeText(L("study_room_bonus_line", { b: room.winBonus })), { size: 10, gray: true });
  y += 10;

  // tabel peringkat: #, nama (+ grade), benar, waktu, poin (poin dasar + bonus pemenang)
  const xRank = margin;
  const xName = margin + 34;
  const xScore = margin + maxWidth * 0.6;
  const xTime = margin + maxWidth * 0.77;
  const xPts = margin + maxWidth;
  const head = () => {
    ensureSpace(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(110);
    doc.text("#", xRank, y);
    doc.text(pdfSafeText(L("study_col_name")), xName, y);
    doc.text(pdfSafeText(L("study_col_score")), xScore, y, { align: "center" });
    doc.text(pdfSafeText(L("study_col_time")), xTime, y, { align: "center" });
    doc.text(pdfSafeText(L("study_col_points")), xPts, y, { align: "right" });
    y += 5;
    doc.setDrawColor(0);
    doc.setLineWidth(1);
    doc.line(margin, y, margin + maxWidth, y);
    y += 15;
  };
  head();
  for (const r of results || []) {
    if (y + 34 > pageHeight - margin) {
      doc.addPage();
      y = margin;
      head();
    }
    const winner = r.bonus > 0;
    if (winner) {
      doc.setFillColor(0);
      doc.rect(margin - 4, y - 14, maxWidth + 8, 34, "F");
    }
    doc.setTextColor(winner ? 255 : 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(String(r.rank), xRank, y);
    doc.text(pdfSafeText(String(r.name || "")).slice(0, 34), xName, y);
    doc.setFont("helvetica", "normal");
    doc.text(`${r.correct}/${r.total}`, xScore, y, { align: "center" });
    doc.text(r.seconds == null ? "-" : fmtClock(r.seconds), xTime, y, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.text(String(r.points + (r.bonus || 0)), xPts, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(winner ? 255 : 110);
    const notes = [gradeText(r.grade || "", r.classLevel)];
    if (r.timedOut) notes.push(L("study_room_timedout"));
    if (r.bonus > 0) notes.push(`+${r.bonus} ${L("study_pts")}`);
    if (r.capped) notes.push(L("study_room_capped_small"));
    doc.text(pdfSafeText(notes.filter(Boolean).join(" | ")), xName, y + 12);
    y += winner ? 30 : 32;
    if (!winner) {
      doc.setDrawColor(200);
      doc.setLineWidth(0.5);
      doc.line(margin, y - 12, margin + maxWidth, y - 12);
    }
  }
  y += 14;
  write(pdfSafeText(L("study_card_footer", { name: L("brand") })), { size: 9, gray: true });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`${p} / ${pages}`, pageWidth - margin, pageHeight - 24, { align: "right" });
  }
  return doc;
}
