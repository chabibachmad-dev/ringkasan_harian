// Tes checklist Komitmen Bersama PPK (komitmen.js): parser, peringkat, privasi (hanya dokumen local:).
//   node test-komitmen.mjs
import { openKbIndex } from "./kb-index.js";
import { parseKomitmen, rankItems, parseKomitmenCommand, createKomitmen } from "./komitmen.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const silent = { log() {}, warn() {}, error() {} };

const P2 = `KOMITMEN BERSAMA PPK KANTOR PUSAT DJKN Tahun 2026

A. Pelaksanaan Perjalanan Dinas
   1. Ketentuan Umum
      a. Surat Tugas perjalanan dinas bagi Pejabat Eselon II ditetapkan oleh Direktur Jenderal.
      b. Penggunaan kendaraan dinas tidak diberikan biaya BBM.
      c. Asuransi perjalanan, biaya ganti tujuan, dan biaya lain yang bersifat opsional tidak
           dapat diganti;

                                   Halaman 2 dari 3`;
const P3 = `B. Pelaksanaan kegiatan rapat
   1. Biaya kudapan dibayarkan maksimal sebesar SBM per orang untuk pejabat eselon II ke bawah.
   2. Pengajuan pembayaran biaya konsumsi rapat wajib melampirkan surat undangan dan daftar hadir.

C. Penyampaian Tagihan
   1. Penyampaian tagihan dilakukan melalui aplikasi SAKTI.
`;
const text = `[Halaman 2]\n${P2}\n\n[Halaman 3]\n${P3}`;

{
  const { sections, items } = parseKomitmen(text);
  check(sections.map((s) => s.key).join("") === "ABC", "bagian A, B, C terbaca");
  check(items.length === 6, `6 butir terbaca (dapat ${items.length})`);
  const bbm = items.find((i) => /BBM/.test(i.text));
  check(bbm && bbm.page === 2 && bbm.section === "A" && bbm.marker === "b." && /Ketentuan Umum/.test(bbm.sub), "butir BBM: halaman 2, bagian A, sub 'Ketentuan Umum'");
  const as = items.find((i) => /Asuransi/.test(i.text));
  check(as && /tidak dapat diganti/.test(as.text), "butir multi-baris disambung");
  check(!items.some((i) => /Halaman 2 dari/.test(i.text) || /KOMITMEN BERSAMA PPK KANTOR/.test(i.text)), "footer/header halaman tidak ikut");
  check(items.some((i) => i.section === "B" && i.page === 3 && /konsumsi/.test(i.text)), "butir bernomor di bagian B terbaca dengan halaman 3");
}
{
  const { items } = parseKomitmen(text);
  const r = rankItems(items, "kendaraan dinas BBM");
  check(r.length > 0 && /BBM/.test(r[0].item.text), "peringkat: BBM paling atas");
  check(rankItems(items, "cuaca besok hujan lebat").length === 0, "uraian tak terkait -> kosong");
  check(/konsumsi/.test(rankItems(items, "konsumsi rapat")[0].item.text), "konsumsi rapat -> butir konsumsi");
}
{
  check(parseKomitmenCommand("/komitmen").list === true, "/komitmen = daftar");
  const c = parseKomitmenCommand("/komitmen cek BBM kendaraan dinas");
  check(c.query === "BBM kendaraan dinas" && !c.list, "/komitmen cek <uraian>");
  check(parseKomitmenCommand("komitmen") === null && parseKomitmenCommand("halo") === null, "bukan perintah -> null");
}
// ---- integrasi dengan indeks: hanya dokumen local:
{
  const idx = await openKbIndex({ file: ":memory:", log: silent });
  const k = createKomitmen({ getIndex: () => idx });
  check(/belum ada/i.test(k.handle({ query: "bbm", list: false })), "tanpa dokumen: pesan petunjuk");
  idx.upsertDoc({ id: "kb:komitmen-bersama", title: "Komitmen Bersama PPK (cloud)", pages: [{ page: 2, text: P2 }] });
  check(/belum ada/i.test(k.handle({ query: "bbm", list: false })), "dokumen NON-lokal bernama mirip tidak dipakai");
  idx.upsertDoc({ id: "local:komitmen-bersama-ppk.md", title: "Komitmen Bersama PPK Kantor Pusat DJKN 2026", pages: [{ page: 2, text: P2 }, { page: 3, text: P3 }] });
  const out = k.handle({ query: "kendaraan dinas BBM", list: false });
  check(/☐ Penggunaan kendaraan dinas tidak diberikan biaya BBM/.test(out) && /hlm 2/.test(out), "checklist berisi butir BBM + halaman");
  check(/tidak ditemukan/i.test(k.handle({ query: "wisata kuliner pantai", list: false })), "tidak cocok -> 'tidak ditemukan'");
  const list = k.handle({ query: "", list: true });
  check(/A\. Pelaksanaan Perjalanan Dinas/.test(list) && /C\. Penyampaian Tagihan/.test(list), "daftar bagian tampil");
  idx.upsertDoc({ id: "local:komitmen-bersama-ppk.md", title: "Komitmen Bersama PPK Kantor Pusat DJKN 2026", pages: [{ page: 2, text: P2.replace("BBM", "bahan bakar") }, { page: 3, text: P3 }] });
  check(!/BBM/.test(k.handle({ query: "kendaraan dinas bahan bakar", list: false })), "dokumen diperbarui -> cache ikut diperbarui");
}
if (fails) { console.log(`\n${fails} GAGAL`); process.exit(1); }
console.log("\nSemua tes Komitmen lulus.");
