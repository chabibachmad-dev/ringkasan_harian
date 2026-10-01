// Ekstrak teks dari file PDF LANGSUNG DI BROWSER (bukan di server) -- dipakai
// fitur "Dokumen Pengetahuan" (lihat main.js) supaya PDF peraturan yang
// diupload bisa dibaca isinya oleh AI tanpa perlu library PDF di sisi Edge
// Function. Pendekatan ini sama semangatnya dengan exportChatToPdf() di
// main.js yang generate PDF client-side pakai jsPDF -- di sini kebalikannya,
// BACA PDF client-side pakai pdfjs-dist (library resmi dari tim Firefox/PDF.js
// Mozilla, dipakai jutaan situs).
//
// CATATAN: ini cuma baca LAPISAN TEKS PDF (PDF hasil ketik/export dari Word
// dkk) -- PDF hasil scan/foto dokumen fisik tanpa OCR tidak akan punya teks
// sama sekali untuk diambil (lihat pengecekan di main.js setelah manggil
// fungsi ini).
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Dibatasi supaya satu dokumen tidak kebablasan ukurannya waktu nanti
// disertakan sebagai konteks ke Gemini tiap kali chat (lihat Edge Function
// `chat`, action "send") -- dipotong rapi per-halaman, bukan di tengah kata.
const MAX_CHARS = 300000;

// file: objek File dari <input type="file"> (lihat form upload di main.js).
// Return: { text, pageCount, truncated }.
export async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let text = "";
  let truncated = false;
  for (let i = 1; i <= pdf.numPages; i++) {
    if (text.length >= MAX_CHARS) {
      truncated = true;
      break;
    }
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
    if (pageText) {
      text += (text ? "\n\n" : "") + `[Halaman ${i}]\n${pageText}`;
    }
  }

  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }
  if (truncated) {
    text += "\n\n[...dipotong, dokumen terlalu panjang...]";
  }

  return { text: text.trim(), pageCount: pdf.numPages, truncated };
}