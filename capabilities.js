// ================================================================
// "Kenali dirimu": daftar kemampuan bot di GRUP yang disusun OTOMATIS dari fitur yang benar-benar aktif, lalu disisipkan ke prompt AI.
//
// Masalah yang dipecahkan: AI percakapan hanya MENULIS teks; yang membacakannya jadi suara adalah sistem (TTS) sesudahnya.
// Tanpa diberi tahu, AI tidak tahu jawabannya akan jadi voice note, lalu menulis "aku tidak bisa menjawab dengan suara"
// -- padahal kalimat itu sendiri dikirim sebagai suara. Di sini AI diberi tahu (1) apa saja yang bisa dilakukan bot ini sekarang,
// (2) bila jawaban kali ini akan dibacakan, dan (3) dilarang menyangkal kemampuan yang ada di daftar.
//
//   buildCapabilityNote(f)   daftar kemampuan (pure, bisa dites)
//   buildVoiceReplyNote(f)   catatan "jawabanmu akan DIBACAKAN" untuk pesan ini
//   denyingCapability(reply, f)  true bila jawaban menyangkal kemampuan yang aktif (dipakai utk log/pemeriksaan)
//
// f = { voice: "on"|"off"|"none", voiceLangs: ["Indonesia",...], voiceMaxChars, hearVoice, image, imageEdit, video, photoVideo,
//       story, pdfRead, pdfConvert, pdfMaxMb, pdfDailyMax }
// ================================================================

const yes = (v) => Boolean(v);

/** Daftar kemampuan bot ini (bagian "fakta tentang dirimu"). Hanya fitur yang AKTIF yang disebut sebagai bisa. */
export function buildCapabilityNote(f = {}) {
  const can = [];
  const cannot = [];

  can.push("menjawab pertanyaan, berdiskusi, dan membantu coding dengan teks");

  if (f.voice === "on") {
    const langs = Array.isArray(f.voiceLangs) && f.voiceLangs.length ? ` Bahasa suara yang tersedia: ${f.voiceLangs.join(", ")} (anggota grup bisa minta, mis. "bot, jawab pakai bahasa Korea").` : "";
    const max = f.voiceMaxChars ? ` Jawaban yang sangat panjang, atau berisi tautan/kode/tabel, otomatis dikirim sebagai teks.` : "";
    can.push(
      `MENJAWAB DENGAN SUARA: saat ini semua jawabanmu di grup dikirim sebagai VOICE NOTE (kamu menulis teksnya, sistem yang membacakannya).${langs}${max} Anggota grup yang ingin jawaban tertulis cukup menulis "bot, ... pakai teks saja" dan jawaban pesan itu dikirim sebagai teks`
    );
  } else if (f.voice === "off") {
    can.push(
      `MENJAWAB DENGAN SUARA: kemampuan ini ADA, tetapi sedang dimatikan, jadi sekarang jawabanmu berupa teks. Hanya pemilik bot yang bisa menyalakannya (perintah /voice wag on di Telegram). Kalau ada yang bertanya, jawab bahwa bot ini bisa menjawab dengan suara dan minta pemilik bot menyalakannya; JANGAN bilang tidak bisa`
    );
  } else {
    cannot.push("menjawab dengan suara (belum diaktifkan oleh pemilik bot)");
  }

  if (yes(f.hearVoice)) can.push('MENDENGAR voice note: anggota grup bisa membalas (reply) pesanmu dengan voice note, lalu kamu menjawabnya (isi suaranya diubah jadi teks lebih dulu oleh sistem)');

  if (yes(f.pdfRead)) {
    const lim = f.pdfMaxMb ? ` (maks ${f.pdfMaxMb} MB)` : "";
    can.push(
      `MEMBACA PDF${lim}: anggota grup bisa mengirim PDF dengan keterangan "bot, ringkas / apa isinya / berapa totalnya ...", atau membalas (reply) PDF siapa pun di grup dengan pertanyaan. Sistem mengambil teks PDF-nya dan menaruhnya di blok "ISI PDF" untukmu. PDF hasil scan (gambar) tidak punya teks sehingga tidak bisa dibaca`
    );
  }
  if (yes(f.pdfConvert)) can.push('mengubah PDF yang dibagikan jadi Excel/Word ("bot, convert ke excel") dan mengubah isinya ("ganti X jadi Y", "perbaiki kalimatnya") menjadi berkas baru');
  can.push('mengirim jawaban sebagai berkas PDF, Word, atau Excel ("bot, ... dalam bentuk PDF/Word/Excel")');
  if (yes(f.image)) can.push('membuat gambar ("bot, buatkan gambar ...")' + (f.imageEdit ? " dan mengedit foto" : ""));
  if (yes(f.video) || yes(f.photoVideo) || yes(f.story)) can.push('membuat video / menghidupkan foto jadi video / animasi kartun ("bot, buatkan video ...")');

  cannot.push("MELIHAT isi foto atau gambar yang dikirim anggota (hanya bisa mengedit/menghidupkannya sesuai perintah)");
  cannot.push("membuka tautan atau berkas selain PDF yang dibagikan di grup, dan mengirim pesan ke orang/grup lain");

  const lines = [];
  lines.push("DAFTAR KEMAMPUANMU (ini fakta tentang dirimu sendiri; JANGAN menyangkalnya, JANGAN bilang \"aku tidak bisa\" untuk hal yang ada di daftar BISA):");
  for (const c of can) lines.push(`- BISA: ${c}.`);
  for (const c of cannot) lines.push(`- TIDAK BISA: ${c}.`);
  lines.push(
    "Kalau di riwayat obrolan ada jawabanmu sebelumnya yang bilang tidak bisa melakukan sesuatu yang ada di daftar BISA, itu keliru: jangan ulangi, dan kalau relevan koreksi dengan singkat. Kalau ditanya \"kamu bisa apa saja?\", jawab ringkas dari daftar ini beserta cara memintanya."
  );
  return `\n\n${lines.join("\n")}`;
}

/** Catatan khusus saat jawaban PESAN INI akan dibacakan jadi voice note. */
export function buildVoiceReplyNote(f = {}) {
  const max = f.voiceMaxChars ? ` Usahakan di bawah sekitar ${f.voiceMaxChars} huruf.` : "";
  return (
    `\n\nJAWABAN INI AKAN DIBACAKAN: jawabanmu untuk pesan ini dikirim sebagai VOICE NOTE (sistem yang membacakan teks yang kamu tulis). Jadi kamu SEDANG menjawab dengan suara -- ` +
    `JANGAN menulis "aku tidak bisa menjawab dengan suara", "aku hanya bisa teks", atau kalimat sejenis. Tulis kalimat pendek yang enak diucapkan, tanpa emoji, tanpa simbol markdown (*, _, #, -), ` +
    `tanpa daftar bernomor (sebut urutan dengan kata: pertama, kedua, ...), dan sebut angka/singkatan sebagaimana diucapkan.${max} ` +
    `Kalau isi jawabannya memang butuh tautan, tabel, atau kode, tulis saja apa adanya -- sistem otomatis mengirimnya sebagai teks.`
  );
}

const NEG = String.raw`(?:tidak|tak|nggak|ngga|ga|gak|enggak|belum|tdk)\s+(?:bisa|dapat|mampu|sanggup|punya\s+kemampuan)`;
// "tidak bisa (melakukan/memberi/menjawab/mengirim ...) (jawaban/balasan) (dengan/pakai) suara"
const DENY_VOICE_RE = new RegExp(String.raw`\b${NEG}\s+(?:\S+\s+){0,3}?(?:suara|voice|vn|audio|bersuara)\b`, "i");
// "tidak bisa membaca / membuka / memahami PDF"
const DENY_PDF_RE = new RegExp(String.raw`\b${NEG}\s+(?:untuk\s+)?(?:membaca|baca|membuka|buka|melihat|lihat|mengerti|memahami|membacakan|mengakses|menganalisis|merangkum|meringkas)\s+(?:\S+\s+){0,2}?pdf\b`, "i");

/** Jawaban menyangkal kemampuan yang sebenarnya aktif? (suara bila voice aktif, baca PDF bila pdfRead aktif). */
export function denyingCapability(reply, f = {}) {
  const t = String(reply ?? "");
  if (f.pdfRead && DENY_PDF_RE.test(t)) return "pdf";
  if ((f.voice === "on" || f.voice === "off") && DENY_VOICE_RE.test(t)) return "suara";
  return null;
}
