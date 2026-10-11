// Renderer markdown untuk aplikasi:
//  - renderMiniMarkdown: ## heading + paragraf polos (sisa fitur ringkasan berita).
//  - renderChatMarkdown: SANGAT minimal (**tebal**, tautan, baris baru) -- dipakai untuk pesan PENGGUNA supaya
//    teks yang diketik apa adanya (mis. 2*3*4, kode) tidak berubah bentuk.
//  - renderAiMarkdown + typesetMath: untuk balasan AI -- markdown lengkap (judul, daftar, kode, tabel, kutipan)
//    dan rumus matematika LaTeX ($...$, $$...$$, \(...\), \[...\]) lewat KaTeX yang dimuat malas
//    (hanya saat ada rumus).
import MarkdownIt from "markdown-it";

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

// Renderer inline untuk bubble chat (balasan AI) -- mendukung **bold**,
// [label](url), dan baris baru. Teks di-escape dulu supaya aman dari HTML
// injection, baru markdown ringan-nya diproses.
export function renderChatMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);

  // [label](url) -> <a>, hanya untuk http(s) supaya tidak bisa javascript:...
  html = html.replace(/\[([^\[\]]+)\]\((https?:\/\/[^\s()]+)\)/g, (_m, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // baris baru -> <br>
  html = html.replace(/\n/g, "<br>");

  return html;
}


// ---------------------------------------------------------------------------------------------
// Balasan AI: markdown lengkap + rumus
// ---------------------------------------------------------------------------------------------

// html:false = tag HTML mentah di teks di-escape (aman dari injeksi); gambar dimatikan (tak ada pelacak piksel);
// tautan hanya http(s)/mailto. breaks:true = baris baru tunggal jadi <br> (seperti perilaku lama aplikasi ini).
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
md.disable(["image"]);
md.validateLink = (url) => /^(https?:|mailto:)/i.test(String(url).trim());
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const PH_OPEN = "\uE000";
const PH_CLOSE = "\uE001";
const MAX_MATH_ITEMS = 300;

// Cabut rumus dari teks SEBELUM markdown diproses (supaya _ * \ di dalam rumus tidak dirusak), ganti dengan
// penanda. Kode (``` ... ``` dan `...`) tidak disentuh. Aturan $...$ mengikuti pandoc supaya uang ("$5 dan $10")
// tidak terbaca sebagai rumus: pembuka $ tidak boleh diikuti spasi, penutup $ tidak boleh didahului spasi
// maupun diikuti angka.
export function extractMath(input) {
  const items = [];
  const text = String(input || "").replaceAll(PH_OPEN, "").replaceAll(PH_CLOSE, "");
  const put = (tex, display, open, close) => {
    if (items.length >= MAX_MATH_ITEMS) return `${open}${tex}${close}`;
    items.push({ tex: tex.trim(), display, source: `${open}${tex}${close}` });
    const ph = `${PH_OPEN}${items.length - 1}${PH_CLOSE}`;
    return display ? `\n\n${ph}\n\n` : ph;
  };
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  const out = parts.map((seg, i) => {
    if (i % 2 === 1) return seg; // kode
    return seg
      .replace(/\$\$([\s\S]+?)\$\$/g, (_m, t) => put(t, true, "$$", "$$"))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t) => put(t, true, "\\[", "\\]"))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t) => put(t, false, "\\(", "\\)"))
      .replace(/(?<![\\$])\$(?!\s)((?:\\.|[^$\n\\])+?)(?<!\s)\$(?!\d)/g, (_m, t) => put(t, false, "$", "$"));
  });
  return { text: out.join(""), items };
}

// Balasan AI -> HTML aman. Rumus keluar sebagai <span class="math-pending" data-tex=... data-display=...> berisi
// teks LaTeX mentah dulu; typesetMath() menggantinya dengan hasil KaTeX begitu pustakanya siap.
export function renderAiMarkdown(text) {
  if (!text) return "";
  const { text: prepared, items } = extractMath(text);
  let html = md.render(prepared);
  if (items.length > 0) {
    html = html.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, "g"), (_m, n) => {
      const it = items[Number(n)];
      if (!it) return "";
      return `<span class="math-pending" data-display="${it.display ? "1" : "0"}" data-tex="${escapeHtml(it.tex)}">${escapeHtml(it.source)}</span>`;
    });
  }
  return html;
}

let katexPromise = null;
function loadKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => m.default || m);
    // Gagal muat (mis. offline pertama kali): coba lagi pada panggilan berikutnya.
    katexPromise.catch(() => {
      katexPromise = null;
    });
  }
  return katexPromise;
}

// Ubah semua .math-pending di dalam root menjadi rumus tertata. Aman dipanggil berkali-kali; kalau KaTeX gagal
// dimuat, teks LaTeX mentah tetap terlihat (tidak ada yang hilang).
export async function typesetMath(root) {
  if (!root || !root.querySelectorAll) return;
  const nodes = [...root.querySelectorAll(".math-pending")];
  if (nodes.length === 0) return;
  let katex;
  try {
    katex = await loadKatex();
  } catch (_err) {
    return;
  }
  for (const el of nodes) {
    if (!el.isConnected) continue;
    try {
      el.innerHTML = katex.renderToString(el.dataset.tex || "", {
        displayMode: el.dataset.display === "1",
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml"
      });
      el.classList.remove("math-pending");
      el.classList.add("math-done");
      if (el.dataset.display === "1") el.classList.add("math-block");
    } catch (_err) {
      /* biarkan teks LaTeX mentah */
    }
  }
}
