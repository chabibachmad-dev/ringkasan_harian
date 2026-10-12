// PDF hasil belajar (soal + jawaban + pembahasan + poin), dirender langsung dengan jsPDF seperti export obrolan
// supaya hasilnya sama di semua perangkat. Teks dibersihkan lewat pdfSafeText (font standar PDF hanya Latin-1).

import { jsPDF } from "jspdf";
import { pdfSafeText, studyPdfFileName } from "./study-text.js";

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
    pdfSafeText(`${L("study_pdf_player")}: ${result.player?.name || ""} (${result.player?.grade || ""})  |  ${L("study_material_grade")}: ${s.materialGrade || ""}  |  ${L("study_level")}: ${levelName} (${result.weightPercent}%)`),
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
export async function shareOrSaveStudyPdf(doc, result, shareTitle) {
  const name = studyPdfFileName(result.player?.name, result.session?.subject);
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
