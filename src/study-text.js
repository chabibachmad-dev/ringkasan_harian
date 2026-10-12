// Teks untuk PDF hasil belajar. jsPDF memakai font standar (helvetica) yang hanya mengenal karakter Latin-1:
// simbol matematika (√ ≥ →), huruf Yunani, teks Arab, dan LaTeX akan tampil rusak. Fungsi di sini mengubahnya
// menjadi teks biasa yang terbaca. Murni (tanpa DOM/jsPDF) supaya bisa diuji di Node: wa-bot/test-study-text.mjs

const GREEK = {
  α: "alfa", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", θ: "theta", λ: "lambda", μ: "mu", π: "pi", ρ: "rho",
  σ: "sigma", τ: "tau", φ: "phi", ω: "omega", Δ: "Delta", Σ: "Sigma", Ω: "Omega", Π: "Pi", Φ: "Phi", Θ: "Theta"
};

const SYMBOLS = {
  "√": "akar ", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~=", "→": "->", "←": "<-", "⇒": "=>", "⇔": "<=>", "↔": "<->",
  "∞": "tak hingga", "∑": "jumlah ", "∈": " anggota ", "∩": " irisan ", "∪": " gabungan ", "∅": "himpunan kosong",
  "∴": "jadi ", "∵": "karena ", "≡": "==", "∝": "~", "·": "*", "⋅": "*", "−": "-", "–": "-", "—": "-", "‒": "-",
  "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "•": "-", "✓": "(benar)", "✗": "(salah)", "✔": "(benar)", "✘": "(salah)",
  "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5", "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9", "ⁿ": "^n",
  "₀": "_0", "₁": "_1", "₂": "_2", "₃": "_3", "₄": "_4", "₅": "_5", "₆": "_6", "₇": "_7", "₈": "_8", "₉": "_9"
};

const LATEX_WORDS = {
  times: "x", div: ":", cdot: "*", ge: ">=", geq: ">=", le: "<=", leq: "<=", neq: "!=", ne: "!=", approx: "~=",
  rightarrow: "->", to: "->", leftarrow: "<-", Rightarrow: "=>", leftrightarrow: "<->", pm: "+/-", infty: "tak hingga",
  pi: "pi", alpha: "alfa", beta: "beta", gamma: "gamma", delta: "delta", theta: "theta", lambda: "lambda", mu: "mu",
  sigma: "sigma", omega: "omega", Delta: "Delta", sum: "jumlah", degree: "derajat", circ: "derajat", ldots: "...", dots: "...",
  cup: " gabungan ", cap: " irisan ", in: " anggota ", emptyset: "himpunan kosong", therefore: "jadi", angle: "sudut",
  perp: "tegak lurus", parallel: "sejajar", log: "log", ln: "ln", sin: "sin", cos: "cos", tan: "tan", lim: "lim"
};

function stripLatex(s) {
  let t = s;
  for (let i = 0; i < 4; i++) {
    t = t
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, "akar pangkat $1 dari ($2)")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "akar($1)")
      .replace(/\\(?:text|mathrm|mathbf|textbf|operatorname)\s*\{([^{}]*)\}/g, "$1");
  }
  return t
    .replace(/\\left(?![A-Za-z])|\\right(?![A-Za-z])|\\,|\;|\\!|\\quad|\\qquad/g, "")
    .replace(/\\\\/g, " ")
    .replace(/\^\{([^{}]*)\}/g, "^($1)")
    .replace(/_\{([^{}]*)\}/g, "_($1)")
    .replace(/\\([A-Za-z]+)/g, (_m, w) => (w in LATEX_WORDS ? LATEX_WORDS[w] : w))
    .replace(/\\([{}%&#$_])/g, "$1");
}

function stripMarkdown(md) {
  return md
    .replace(/```([\s\S]*?)```/g, (_m, code) => code.trim())
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/(^|[\s(])\*(?!\s)(.*?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
    .replace(/^[-*]\s+/gm, "- ");
}

const ARABIC = "[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]";

// Teks apa pun -> teks aman untuk font standar PDF.
export function pdfSafeText(input) {
  let t = String(input ?? "");
  t = stripMarkdown(t);
  // tanda dolar pembuka/penutup rumus (bukan uang: "$5" tetap utuh) dibuang setelah LaTeX diurai
  t = stripLatex(t).replace(/\$\$/g, "").replace(/(?<![\d\w])\$(?=\S)([^$\n]+?)(?<=\S)\$(?!\d)/g, "$1");
  // teks Arab -> penanda
  t = t.replace(new RegExp(`${ARABIC}+(?:\\s+${ARABIC}+)*`, "g"), "[teks Arab]");
  t = t.replace(/[^\u0000-ÿ]/gu, (ch) => SYMBOLS[ch] ?? GREEK[ch] ?? "");
  // sisa karakter kontrol / di luar Latin-1 yang masih lolos
  t = t.replace(/[^\n\t -~ -ÿ]/g, "");
  return t.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

// Nama berkas aman, mis. "Hasil_Ali_Matematika_2026-10-12".
export function studyPdfFileName(playerName, subject, date = new Date()) {
  const slug = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  const d = date.toISOString().slice(0, 10);
  return `Hasil_${slug(playerName) || "pemain"}_${slug(subject) || "pelajaran"}_${d}.pdf`;
}

// Nama berkas aman untuk PDF materi, mis. "Materi_Matematika_Teorema_Pythagoras_2026-10-12.pdf".
export function materialPdfFileName(subject, title, date = new Date()) {
  const slug = (s, n) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, n);
  return `Materi_${slug(subject, 24) || "pelajaran"}_${slug(title, 40) || "materi"}_${date.toISOString().slice(0, 10)}.pdf`;
}

// Markdown materi -> daftar blok sederhana untuk digambar jsPDF (font standar, tanpa gaya campuran per baris).
// Tiap blok: { type: "h2"|"h3"|"p"|"li"|"quote"|"code"|"table", text, level?, num? }; text sudah lewat pdfSafeText.
export function materialBlocks(md) {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let code = null;
  const safe = (t) => pdfSafeText(t);
  const flush = () => {
    if (para.length) {
      const text = safe(para.join(" "));
      if (text) out.push({ type: "p", text });
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*```/.test(line)) {
      if (code === null) {
        flush();
        code = [];
      } else {
        const text = code.join("\n").replace(/[^\n\t -~ -ÿ]/g, "?");
        if (text.trim()) out.push({ type: "code", text });
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    let m;
    if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/))) {
      flush();
      const text = safe(m[2]);
      if (text) out.push({ type: m[1].length <= 2 ? "h2" : "h3", text });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
    } else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
      flush();
      const text = safe(m[2]);
      if (text) out.push({ type: "li", text, level: Math.min(3, Math.floor(m[1].length / 2)) });
    } else if ((m = line.match(/^(\s*)(\d{1,3})[.)]\s+(.*)$/))) {
      flush();
      const text = safe(m[3]);
      if (text) out.push({ type: "li", text, level: Math.min(3, Math.floor(m[1].length / 2)), num: m[2] });
    } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
      flush();
      const text = safe(m[1]);
      if (text) out.push({ type: "quote", text });
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // baris pemisah |---|---|
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => safe(c)).filter((c, i, a) => c !== "" || a.length > 1);
      const text = cells.join(" | ");
      if (text.trim()) out.push({ type: "table", text });
    } else {
      para.push(line.trim());
    }
  }
  if (code !== null) {
    const text = code.join("\n").replace(/[^\n\t -~ -ÿ]/g, "?");
    if (text.trim()) out.push({ type: "code", text });
  }
  flush();
  return out;
}

// Rumus poin satu pelajaran untuk layar & PDF. Pelajaran lama (perQuestionPoints kosong) memakai teks rumus lama.
// L(key, vars) = penerjemah teks.
export function pointsFormula(result, L) {
  const r = result || {};
  if (r.perQuestionPoints) {
    const text = L("study_formula_new", { perq: r.perQuestionPoints, correct: r.correct, weight: r.weightPercent });
    return r.bonusPercent > 0 ? `${text} ${L("study_formula_bonus", { b: 100 + r.bonusPercent })}` : text;
  }
  return L("study_pdf_formula", { base: r.basePoints, correct: r.correct, total: r.total, weight: r.weightPercent });
}
