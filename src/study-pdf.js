// PDF hasil belajar (soal + jawaban + pembahasan + poin), dirender langsung dengan jsPDF seperti export obrolan
// supaya hasilnya sama di semua perangkat. Teks dibersihkan lewat pdfSafeText (font standar PDF hanya Latin-1).

import { jsPDF } from "jspdf";
import { pdfSafeText, studyPdfFileName, materialBlocks, materialPdfFileName } from "./study-text.js";
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
  const write = (text, { size = 11, bold = false, gap = 0, indent = 0, gray = false } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
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
    pdfSafeText(L("study_pdf_formula", { base: result.basePoints, correct: result.correct, total: result.total, weight: result.weightPercent })),
    { size: 9, gray: true, gap: 12 }
  );

  for (const it of result.items || []) {
    ensureSpace(60);
    write(pdfSafeText(`${it.idx + 1}. ${it.question}`), { size: 11, bold: true, gap: 2 });
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
