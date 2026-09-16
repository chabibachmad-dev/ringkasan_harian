// Renderer super-minimal untuk subset markdown yang kita hasilkan sendiri
// dari Edge Function (## heading + paragraf polos). Sengaja tidak pakai
// library markdown penuh karena kebutuhannya kecil & sumbernya kita kontrol sendiri.

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMiniMarkdown(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const html = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("## ")) {
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else {
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }

  return html.join("\n");
}
