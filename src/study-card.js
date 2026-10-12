// Kartu hasil berformat gambar (PNG) untuk dibagikan ke galeri / WhatsApp. Digambar langsung di <canvas>
// (hitam-putih, selaras dengan tampilan aplikasi) sehingga tidak bergantung pada pustaka tangkap-layar.
// Modul ini hanya menggambar teks yang sudah diterjemahkan oleh pemanggil (study.js).

const W = 1080;
const PAD = 72;
const INK = "#000";
const PAPER = "#fff";
const GRAY = "#6b6b6b";
const FAMILY = '"Ubuntu Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const font = (size, bold = false) => `${bold ? "bold " : ""}${size}px ${FAMILY}`;

async function ensureFont() {
  try {
    if (document.fonts?.load) {
      await Promise.all([document.fonts.load(font(40)), document.fonts.load(font(40, true))]);
    }
  } catch {
    /* tanpa font khusus: pakai monospace bawaan */
  }
}

function makeCanvas(height, border = true) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, height);
  if (border) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    ctx.strokeRect(24, 24, W - 48, height - 48);
  }
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
}

// Potong teks dengan "…" agar muat dalam lebar maxW.
function fit(ctx, text, maxW) {
  let s = String(text ?? "");
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// Pecah teks menjadi baris selebar maxW (maksimal maxLines; sisanya diberi "…").
function wrap(ctx, text, maxW, maxLines) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(ctx, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxW);
    return kept;
  }
  return lines.map((l) => fit(ctx, l, maxW));
}

function text(ctx, s, x, y, { size = 36, bold = false, color = INK, align = "left", maxW = 0 } = {}) {
  ctx.font = font(size, bold);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(maxW ? fit(ctx, s, maxW) : String(s ?? ""), x, y);
}

function paragraph(ctx, s, x, y, { size = 36, bold = false, color = INK, maxW = W - PAD * 2, maxLines = 2, gap = 1.3 } = {}) {
  ctx.font = font(size, bold);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  const lines = wrap(ctx, s, maxW, maxLines);
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += Math.round(size * gap);
  }
  return y;
}

function rule(ctx, y, w = 3) {
  ctx.fillStyle = INK;
  ctx.fillRect(PAD, y, W - PAD * 2, w);
}

function header(ctx, brand, right) {
  text(ctx, brand.toUpperCase(), PAD, 108, { size: 40, bold: true });
  if (right) text(ctx, right, W - PAD, 108, { size: 30, color: GRAY, align: "right", maxW: 520 });
  rule(ctx, 132);
}

// ---------------------------------------------------------------- kartu hasil pelajaran
// d = { brand, dateText, title, topic, player, meta, big, scoreLabel, points, ptsUnit, formula, bonus, flags, footer }
// flags: array "c" (benar) | "w" (salah) | "n" (tidak dijawab), satu per soal.
export async function renderLessonCard(d) {
  await ensureFont();
  const H = 1460;
  const { canvas, ctx } = makeCanvas(H);
  header(ctx, d.brand, d.dateText);

  let y = 215;
  y = paragraph(ctx, d.title, PAD, y, { size: 62, bold: true, maxLines: 2, gap: 1.2 });
  if (d.topic) y = paragraph(ctx, d.topic, PAD, y + 4, { size: 36, color: GRAY, maxLines: 2 });
  y += 28;
  text(ctx, d.player, PAD, y, { size: 44, bold: true, maxW: W - PAD * 2 });
  y += 48;
  y = paragraph(ctx, d.meta, PAD, y, { size: 30, color: GRAY, maxLines: 2 });

  // skor besar
  const bigY = Math.max(y + 250, 700);
  text(ctx, d.big, W / 2, bigY, { size: 240, bold: true, align: "center" });
  text(ctx, d.scoreLabel, W / 2, bigY + 66, { size: 40, align: "center", maxW: W - PAD * 2 });

  // deret kotak per soal: terisi = benar, kosong berbingkai = salah, garis putus = tidak dijawab
  const flags = d.flags || [];
  let rowY = bigY + 120;
  if (flags.length) {
    const perRow = Math.min(flags.length, 20);
    const gap = 12;
    const size = Math.min(52, Math.floor((W - PAD * 2 - gap * (perRow - 1)) / perRow));
    flags.forEach((f, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const rowCount = Math.min(perRow, flags.length - row * perRow);
      const startX = (W - (rowCount * size + (rowCount - 1) * gap)) / 2;
      const x = startX + col * (size + gap);
      const yy = rowY + row * (size + gap);
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      if (f === "c") {
        ctx.fillStyle = INK;
        ctx.fillRect(x, yy, size, size);
      } else if (f === "w") {
        ctx.strokeRect(x + 2.5, yy + 2.5, size - 5, size - 5);
        ctx.beginPath();
        ctx.moveTo(x + 10, yy + 10);
        ctx.lineTo(x + size - 10, yy + size - 10);
        ctx.moveTo(x + size - 10, yy + 10);
        ctx.lineTo(x + 10, yy + size - 10);
        ctx.stroke();
      } else {
        ctx.setLineDash([8, 7]);
        ctx.strokeRect(x + 2.5, yy + 2.5, size - 5, size - 5);
        ctx.setLineDash([]);
      }
    });
    rowY += Math.ceil(flags.length / perRow) * (size + gap);
  }

  // kotak poin
  const boxY = Math.max(rowY + 40, 960);
  ctx.fillStyle = INK;
  ctx.fillRect(PAD, boxY, W - PAD * 2, 150);
  text(ctx, `${d.points} ${d.ptsUnit}`, W / 2, boxY + 102, { size: 92, bold: true, color: PAPER, align: "center", maxW: W - PAD * 2 - 40 });

  let fy = boxY + 150 + 50;
  fy = paragraph(ctx, d.formula, PAD, fy, { size: 28, color: GRAY, maxLines: 2 });
  if (d.bonus) fy = paragraph(ctx, d.bonus, PAD, fy + 6, { size: 28, bold: true, maxLines: 1 });

  rule(ctx, H - 140);
  text(ctx, d.footer, PAD, H - 82, { size: 28, color: GRAY, maxW: W - PAD * 2 });
  return canvas;
}

// ---------------------------------------------------------------- kartu hasil kompetisi
// d = { brand, badge, dateText, title, info, creator, winner, winnerSub, cols:{name,score,time,points},
//       rows:[{rank,name,sub,score,time,points,isWinner}], more, footer }
export async function renderRoomCard(d) {
  await ensureFont();
  const rows = d.rows || [];
  const rowH = 92;
  // Gambar di kanvas tinggi tanpa bingkai, lalu dipotong tepat setinggi isinya (tinggi header bisa berbeda-beda).
  const { canvas: tall, ctx } = makeCanvas(640 + rows.length * rowH + 700, false);
  header(ctx, d.brand, d.badge);

  let y = 215;
  y = paragraph(ctx, d.title, PAD, y, { size: 58, bold: true, maxLines: 2, gap: 1.2 });
  y = paragraph(ctx, d.info, PAD, y + 4, { size: 30, color: GRAY, maxLines: 2 });
  if (d.creator) {
    const cr = String(d.creator);
    y = paragraph(ctx, cr.charAt(0).toUpperCase() + cr.slice(1), PAD, y + 2, { size: 28, color: GRAY, maxLines: 1 });
  }

  // kotak pemenang
  const boxY = y + 10;
  ctx.fillStyle = INK;
  ctx.fillRect(PAD, boxY, W - PAD * 2, d.winnerSub ? 170 : 130);
  text(ctx, d.winner, W / 2, boxY + 82, { size: 54, bold: true, color: PAPER, align: "center", maxW: W - PAD * 2 - 40 });
  if (d.winnerSub) text(ctx, d.winnerSub, W / 2, boxY + 132, { size: 32, color: PAPER, align: "center", maxW: W - PAD * 2 - 40 });

  // tabel
  let ty = boxY + (d.winnerSub ? 170 : 130) + 58;
  const xRank = PAD + 8;
  const xName = PAD + 90;
  const xScore = 660;
  const xTime = 790;
  const xPts = W - PAD - 8;
  const c = d.cols || {};
  text(ctx, "#", xRank, ty, { size: 26, bold: true, color: GRAY });
  text(ctx, c.name || "", xName, ty, { size: 26, bold: true, color: GRAY });
  text(ctx, c.score || "", xScore, ty, { size: 26, bold: true, color: GRAY, align: "center" });
  text(ctx, c.time || "", xTime, ty, { size: 26, bold: true, color: GRAY, align: "center" });
  text(ctx, c.points || "", xPts, ty, { size: 26, bold: true, color: GRAY, align: "right" });
  ty += 18;
  rule(ctx, ty, 3);
  ty += 8;

  for (const r of rows) {
    if (r.isWinner) {
      ctx.fillStyle = INK;
      ctx.fillRect(PAD, ty, W - PAD * 2, rowH - 6);
    }
    const color = r.isWinner ? PAPER : INK;
    const sub = r.isWinner ? PAPER : GRAY;
    const base = ty + 44;
    text(ctx, r.rank, xRank, base, { size: 38, bold: true, color });
    text(ctx, r.name, xName, base, { size: 36, bold: true, color, maxW: 400 });
    if (r.sub) text(ctx, r.sub, xName, base + 28, { size: 22, color: sub, maxW: 400 });
    text(ctx, r.score, xScore, base, { size: 34, color, align: "center" });
    text(ctx, r.time, xTime, base, { size: 30, color, align: "center" });
    text(ctx, r.points, xPts, base, { size: 38, bold: true, color, align: "right" });
    ty += rowH;
    if (!r.isWinner) {
      ctx.fillStyle = "#cfcfcf";
      ctx.fillRect(PAD, ty - 6, W - PAD * 2, 2);
    }
  }
  if (d.more) text(ctx, d.more, PAD + 8, ty + 44, { size: 30, color: GRAY, maxW: W - PAD * 2 });

  const bottom = ty + (d.more ? 110 : 30);
  const H = bottom + 140;
  const { canvas, ctx: out } = makeCanvas(H);
  out.drawImage(tall, 0, 0, W, bottom, 0, 0, W, bottom);
  out.strokeStyle = INK;
  out.lineWidth = 8;
  out.strokeRect(24, 24, W - 48, H - 48);
  rule(out, bottom);
  text(out, d.footer, PAD, bottom + 58, { size: 28, color: GRAY, maxW: W - PAD * 2 });
  return canvas;
}

// ---------------------------------------------------------------- bagikan / simpan
function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png");
  });
}

// Lembar bagikan sistem bila tersedia (WhatsApp, Simpan ke Galeri, dll.); jika tidak, berkas PNG diunduh.
export async function shareOrSaveCard(canvas, name, shareTitle) {
  const blob = await toBlob(canvas);
  try {
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: shareTitle });
      return "shared";
    }
  } catch (err) {
    if (err && err.name === "AbortError") return "cancelled";
    /* gagal membagikan: jatuh ke unduh di bawah */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "saved";
}
