// Tes renderer balasan AI (markdown + penarikan rumus). Bagian DOM/KaTeX diuji terpisah lewat Playwright.
//   node test-markdown.mjs
import { renderAiMarkdown, renderChatMarkdown, extractMath } from "../src/markdown.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const has = (html, s) => html.includes(s);

// --- rumus ditarik, bukan dirusak markdown
{
  const t = "Jika Nilai $\\ge 80$ $\\rightarrow$ Lulus. Kode: $A \\rightarrow B$, $B \\rightarrow C$.";
  const { items } = extractMath(t);
  check(items.length === 4 && items[0].tex === "\\ge 80" && items[1].tex === "\\rightarrow" && items[2].tex === "A \\rightarrow B" && items[3].tex === "B \\rightarrow C", "inline $...$: empat rumus pada contoh layar terbaca utuh");
  const html = renderAiMarkdown(t);
  check((html.match(/math-pending/g) || []).length === 4 && has(html, 'data-tex="\\ge 80"') && has(html, 'data-display="0"'), "HTML berisi penanda rumus (data-tex) yang dapat diubah KaTeX");
  check(!/[]/.test(html), "tidak ada sisa penanda internal di HTML");
}
{
  const t = "Apakah hasil dari $(5 > 3) \\text{ AND } (2 > 4)$? dan $< 70$ juga.";
  const { items } = extractMath(t);
  check(items.length === 2 && items[0].tex === "(5 > 3) \\text{ AND } (2 > 4)" && items[1].tex === "< 70", "rumus yang mengandung < > dan \\text tetap utuh");
  const html = renderAiMarkdown(t);
  check(has(html, "&lt; 70") && !has(html, "<70"), "karakter < di dalam data-tex di-escape (aman)");
}
// --- uang tidak dianggap rumus
{
  for (const t of ["Harganya $5 dan $10 saja", "Dari $5-$10 per hari", "Biaya $ 5 atau $ 10", "Total Rp5.000 atau $20."]) {
    check(extractMath(t).items.length === 0, `uang bukan rumus: "${t}"`);
  }
}
// --- blok & delimiter lain
{
  const t = "Rumus:\n$$\\frac{a}{b} = c$$\nselesai, juga \\[x^2 + y^2\\] dan \\(z_1\\).";
  const { items } = extractMath(t);
  check(items.length === 3 && items[0].display && items[1].display && !items[2].display && items[0].tex === "\\frac{a}{b} = c", "$$..$$, \\[..\\] = blok; \\(..\\) = inline");
  const html = renderAiMarkdown(t);
  check(has(html, 'data-display="1"') && !has(html, "<p><span class=\"math-pending\" data-display=\"1\"") === false, "rumus blok ditaruh di paragrafnya sendiri");
}
// --- garis bawah / bintang di dalam rumus tidak jadi miring/tebal
{
  const html = renderAiMarkdown("Hitung $a_1 * b_2 + c_3 * d_4$ dan $x_i^*$ ya");
  check(!has(html, "<em>") && !has(html, "<strong>") && has(html, 'data-tex="a_1 * b_2 + c_3 * d_4"'), "_ dan * di dalam rumus tidak dirusak markdown");
}
// --- kode tidak disentuh
{
  const html = renderAiMarkdown("Di Bash: `echo $HOME dan $PATH` lalu\n```\nprice=$5; cost=$10\n```\n");
  check(!has(html, "math-pending") && has(html, "<code>echo $HOME dan $PATH</code>") && has(html, "price=$5; cost=$10"), "$ di dalam kode (inline & blok) bukan rumus");
}
// --- $ ber-escape
check(extractMath("Harga \\$5 dan \\$6").items.length === 0, "\\$ ber-escape bukan pembuka rumus");
// --- tak ada penutup
check(extractMath("hanya satu $ di sini dan teks biasa").items.length === 0, "satu $ tanpa pasangan dibiarkan");
// --- markdown lengkap
{
  const t = "## Judul\n\n5. Aturan kelulusan:\n* Satu\n* Dua\n\n1. A\n2. B\n\n**tebal** dan *miring* dan `kode`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> kutipan\n\n---\n";
  const html = renderAiMarkdown(t);
  check(has(html, "<h2>Judul</h2>") && has(html, "<ul>") && has(html, "<li>Satu</li>") && has(html, "<ol>") && has(html, "<strong>tebal</strong>") && has(html, "<em>miring</em>") && has(html, "<code>kode</code>") && has(html, "<table>") && has(html, "<blockquote>") && has(html, "<hr>"), "markdown lengkap: judul, daftar bullet & nomor, tebal, miring, kode, tabel, kutipan, garis");
  const list = renderAiMarkdown("5. Aturan:\n* Jika $\\ge 80$ Lulus\n* Jika $< 70$ Remidi");
  check(has(list, "<ul>") && (list.split("<ul>")[1].match(/<li>/g) || []).length === 2, "bullet langsung setelah baris bernomor tetap menjadi daftar (kasus di layar)");
  check(has(renderAiMarkdown("baris satu\nbaris dua"), "<br>"), "baris baru tunggal tetap menjadi <br> (perilaku lama)");
}
// --- keamanan
{
  const html = renderAiMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> [klik](javascript:alert(1)) ![gbr](https://x.com/a.png) [ok](https://contoh.id/a)');
  check(!has(html, "<script") && !has(html, "<img") && !has(html, 'href="javascript') && !has(html, "<a href=\"javascript") && has(html, 'href="https://contoh.id/a"') && has(html, 'target="_blank"') && has(html, 'rel="noopener noreferrer"'), "aman: HTML mentah di-escape, javascript:/gambar dibuang, tautan https dibuka di tab baru");
  const x = renderAiMarkdown('$"><img src=x onerror=alert(1)>$');
  check(!has(x, "<img") && !has(x, 'onerror="'), 'data-tex berisi tanda kutip/tag tidak bisa keluar dari atribut');
  check(has(renderAiMarkdown("lihat https://contoh.go.id/pmk-99 ya"), '<a href="https://contoh.go.id/pmk-99"'), "URL polos otomatis jadi tautan (sumber dari pencarian web)");
}
// --- batas jumlah rumus
{
  const many = Array.from({ length: 400 }, (_, i) => `$x_${i}$`).join(" ");
  check(extractMath(many).items.length === 300, "jumlah rumus per pesan dibatasi 300");
}
// --- penanda internal dari input dibuang (tak bisa memalsukan rumus)
check(!/math-pending/.test(renderAiMarkdown("palsu 0 teks")), "karakter penanda di input pengguna/AI dibuang");
// --- pesan pengguna tetap minimal
check(renderChatMarkdown("2*3*4 dan _a_ $x$\nbaris dua") === "2*3*4 dan _a_ $x$<br>baris dua", "pesan pengguna: tidak diformat ulang (2*3*4, _a_, $x$ apa adanya)");

console.log(fails ? `\n${fails} FAIL` : "\nsemua ok");
process.exit(fails ? 1 : 0);
