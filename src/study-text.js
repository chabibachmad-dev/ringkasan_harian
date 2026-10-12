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
