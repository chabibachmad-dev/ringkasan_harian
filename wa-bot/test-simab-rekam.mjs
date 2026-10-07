// Tes perekaman SiMAB lewat WhatsApp (database Supabase palsu di memori).
//   node test-simab-rekam.mjs
import { createSimab } from "./simab.js";
import { parseTanggal, parseJumlah, parseInput, parseSeksi, groupKey } from "./simab-rekam.js";

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };

// ---------- pengurai ----------
const T = { tahun: 2026, today: "2026-10-07" };
check(parseTanggal("5/10/2026", T) === "2026-10-05" && parseTanggal("05-10-2026", T) === "2026-10-05" && parseTanggal("2026-10-05", T) === "2026-10-05", "tanggal: d/m/y, d-m-y, ISO");
check(parseTanggal("5 okt 2026", T) === "2026-10-05" && parseTanggal("5 Oktober 2026", T) === "2026-10-05" && parseTanggal("17 agustus", T) === "2026-08-17", "tanggal: nama bulan, tahun default = tahun anggaran");
check(parseTanggal("5/10", T) === "2026-10-05" && parseTanggal("hari ini", T) === "2026-10-07", "tanggal: tanpa tahun & 'hari ini'");
check(parseTanggal("31/02/2026", T) === null && parseTanggal("32/1/2026", T) === null && parseTanggal("abc", T) === null && parseTanggal("5/13/2026", T) === null, "tanggal: tidak valid ditolak");
check(parseJumlah("1.500.000") === 1500000 && parseJumlah("Rp 1.500.000,-") === 1500000 && parseJumlah("1500000") === 1500000 && parseJumlah("1,500,000") === 1500000, "jumlah: pemisah ribuan");
check(parseJumlah("1,5jt") === 1500000 && parseJumlah("2 juta") === 2000000 && parseJumlah("500rb") === 500000 && parseJumlah("1.5 jt") === 1500000, "jumlah: jt/juta/rb");
check(parseJumlah("0") === null && parseJumlah("-5") === null && parseJumlah("abc") === null && parseJumlah("") === null && parseJumlah("1.2.3") === null, "jumlah: tidak valid ditolak");
{
  const a = parseInput("Pembelian ATK\n5/10/2026\n1.500.000", T);
  check(a.ok && a.uraian === "Pembelian ATK" && a.tgl === "2026-10-05" && a.jumlah === 1500000, "input 3 baris");
  const b = parseInput("Pembelian ATK bulan\nOktober untuk kantor\n5/10/2026\n1,5jt", T);
  check(b.ok && b.uraian === "Pembelian ATK bulan Oktober untuk kantor" && b.jumlah === 1500000, "uraian boleh beberapa baris (2 baris terakhir = tanggal & jumlah)");
  const c = parseInput("Pembelian ATK; 5/10/2026; 750.000", T);
  check(c.ok && c.jumlah === 750000, "alternatif satu baris dipisah titik koma");
  const d = parseInput("hanya satu baris", T);
  check(!d.ok && /kurang/.test(d.error), "data kurang -> pesan format");
  const e = parseInput("ATK\ntanggal salah\nbanyak", T);
  check(!e.ok && /tanggal/.test(e.error) && /jumlah/.test(e.error), "tanggal & jumlah salah disebut keduanya");
}
check(parseSeksi("umum") === "Umum" && parseSeksi("Seksi PKN") === "PKN" && parseSeksi("lelang") === "Lelang" && parseSeksi("xyz") === null && parseSeksi("") === null, "seksi: huruf besar/kecil & awalan 'seksi'");
check(groupKey("4701.EBA.002.051.A.521111.10") === "4701.EBA.002" && groupKey("4701.EBA") === null && groupKey("4701.EBA.002") === "4701.EBA.002", "kelompok = 3 segmen pertama");

// ---------- database palsu ----------
const pad = (n) => String(n).padStart(2, "0");
function makeDb() {
  const tables = {
    pok: [
      // kelompok 4701.EBA.002 (Kerumahtanggaan) -- milik Umum
      { id: "p1", kode: "4701.EBA.002", uraian: "Kerumahtanggaan", pagu: 0, seksi: null, kantor_id: "538065", tahun: 2026 },
      { id: "p2", kode: "4701.EBA.002.051", uraian: "Layanan Perkantoran", pagu: 0, seksi: null, kantor_id: "538065", tahun: 2026 },
      { id: "p3", kode: "4701.EBA.002.051.A.521111.10", uraian: "Keperluan Perkantoran", pagu: 1000000, seksi: "Umum", kantor_id: "538065", tahun: 2026 },
      { id: "p4", kode: "4701.EBA.002.051.A.521111.10", uraian: "Keperluan Perkantoran", pagu: 500000, seksi: "PKN", kantor_id: "538065", tahun: 2026 },
      { id: "p5", kode: "4701.EBA.002.051.A.522111.20", uraian: "Langganan Listrik", pagu: 2000000, seksi: "Umum", kantor_id: "538065", tahun: 2026 },
      // kode berturunan (bukan terpanjang): 524111 punya anak .01
      { id: "p6", kode: "4701.EBA.002.052.A.524111", uraian: "Perjadin (induk)", pagu: 0, seksi: "Umum", kantor_id: "538065", tahun: 2026 },
      { id: "p7", kode: "4701.EBA.002.052.A.524111.01", uraian: "Perjadin Biasa", pagu: 800000, seksi: "Umum", kantor_id: "538065", tahun: 2026 },
      // kelompok lain, milik PKN saja
      { id: "p8", kode: "4701.EBA.994", uraian: "Layanan PKN", pagu: 0, seksi: null, kantor_id: "538065", tahun: 2026 },
      { id: "p9", kode: "4701.EBA.994.002.A.521111.10", uraian: "Sosialisasi", pagu: 300000, seksi: "PKN", kantor_id: "538065", tahun: 2026 },
      // satker lain & tahun lain: tidak boleh ikut
      { id: "x1", kode: "4701.EBA.002.051.A.521111.99", uraian: "SATKER LAIN", pagu: 9, seksi: "Umum", kantor_id: "111111", tahun: 2026 },
      { id: "x2", kode: "4701.EBA.002.051.A.521111.98", uraian: "TAHUN LAIN", pagu: 9, seksi: "Umum", kantor_id: "538065", tahun: 2025 }
    ],
    blokir: [{ id: "4701.EBA.002.051.A.521111.10", nilai: 100000, kantor_id: "538065", tahun: 2026 }],
    kegiatan: [{ id: "ABCDEFGHIJ", mak: "4701.EBA.002.051.A.521111.10", jumlah: 300000, kantor_id: "538065", tahun: 2026, status: "Selesai" }],
    config: []
  };
  const rpcCalls = [];
  let rpcImpl = async (args) => {
    const id = "Z9Y8X7W6V5";
    tables.kegiatan.push({ id, mak: args.p_mak, uraian: args.p_uraian, tgl_st: args.p_tgl_st, jumlah: args.p_jumlah, user: args.p_user, status: "Rekam Data", kantor_id: args.p_kantor_id, tahun: args.p_tahun });
    return { data: id, error: null };
  };
  const from = (name) => {
    const st = { name, f: [], range: null };
    const b = {
      select() { return b; },
      eq(c, v) { st.f.push((r) => String(r[c]) === String(v)); return b; },
      like(c, p) { const re = new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$"); st.f.push((r) => re.test(String(r[c] ?? ""))); return b; },
      ilike(c, p) { const re = new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i"); st.f.push((r) => re.test(String(r[c] ?? ""))); return b; },
      in(c, arr) { st.f.push((r) => arr.includes(r[c])); return b; },
      not() { return b; },
      order() { return b; },
      limit() { return b; },
      range(a, z) { st.range = [a, z]; return b; },
      then(res, rej) {
        let out = (tables[name] ?? []).filter((r) => st.f.every((fn) => fn(r)));
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
        return Promise.resolve({ data: out, error: null }).then(res, rej);
      }
    };
    return b;
  };
  const client = {
    from,
    rpc: (fn, args) => { rpcCalls.push({ fn, args }); return rpcImpl(args); },
    auth: {
      getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
      signInWithPassword: async () => ({ error: null })
    }
  };
  return { tables, client, rpcCalls, setRpc: (f) => { rpcImpl = f; } };
}

function mk(db, over = {}) {
  let clock = 1_800_000_000_000;
  const s = createSimab({
    url: "u", anonKey: "k", email: "e", password: "p", kantorId: "538065", fixedTahun: 2026,
    makeClient: () => db.client, rekamUser: "Tes User", now: () => clock, ...over
  });
  return { s, advance: (ms) => { clock += ms; } };
}
const KEY = "owner@s.whatsapp.net";

// ---------- alur lengkap ----------
{
  const db = makeDb();
  const { s } = mk(db);
  let r = await s.run("simab rekam", { sessionKey: KEY });
  check(/Sebutkan seksinya/.test(r) && /Umum, PKN, PN, HI, KI, Lelang, Penilaian/.test(r) && !s.hasSession(KEY), "tanpa seksi -> daftar seksi, belum ada sesi");
  r = await s.run("simab rekam Bendahara", { sessionKey: KEY });
  check(/Sebutkan seksinya/.test(r), "seksi tidak dikenal ditolak");
  r = await s.run("simab rekam umum", { sessionKey: KEY });
  check(s.hasSession(KEY) && /Seksi Umum/.test(r) && /1\. \*4701\.EBA\.002\* — Kerumahtanggaan/.test(r), "daftar kelompok: 4701.EBA.002 Kerumahtanggaan");
  check(!/994/.test(r), "kelompok milik seksi lain tidak muncul");
  check(!/SATKER LAIN|TAHUN LAIN/.test(r), "satker/tahun lain tidak ikut");
  r = await s.run("9", { sessionKey: KEY });
  check(/Angka di luar daftar/.test(r), "angka di luar daftar ditolak, sesi tetap");
  r = await s.run("halo", { sessionKey: KEY });
  check(/Sesi rekam masih aktif/.test(r), "teks lain mengingatkan sesi masih aktif");
  r = await s.run("1", { sessionKey: KEY });
  check(/4701\.EBA\.002/.test(r) && /521111\.10/.test(r) && /522111\.20/.test(r) && /524111\.01/.test(r), "daftar kode terpanjang muncul");
  check(!/\*4701\.EBA\.002\.052\.A\.524111\*/.test(r) && !/\*4701\.EBA\.002\.051\*/.test(r), "kode yang punya turunan TIDAK bisa dipilih");
  check(!/SATKER LAIN|TAHUN LAIN/.test(r), "daftar kode: satker/tahun lain tidak ikut");
  // urutan: 051.A.521111.10, 051.A.522111.20, 052.A.524111.01
  check(/1\. \*4701\.EBA\.002\.051\.A\.521111\.10\*[\s\S]*pagu Rp 1\.500\.000 • sisa \*Rp 1\.100\.000\*/.test(r), "sisa = pagu semua seksi (1,5jt) - blokir 100rb - realisasi 300rb = 1,1jt");
  r = await s.run("kembali", { sessionKey: KEY });
  check(/Rekam kegiatan — Seksi Umum/.test(r), "kembali ke daftar kelompok");
  await s.run("1", { sessionKey: KEY });
  r = await s.run("1", { sessionKey: KEY });
  check(/Sisa pagu: \*Rp 1\.100\.000\*/.test(r) && /3 baris dalam satu pesan/.test(r), "kode dipilih -> minta uraian, tanggal, jumlah");
  r = await s.run("hanya satu baris", { sessionKey: KEY });
  check(/kurang/.test(r) && s.hasSession(KEY), "input salah -> minta ulang, sesi tetap");
  r = await s.run("Pembelian ATK bulan Oktober\n5/10/2026\n1.500.000", { sessionKey: KEY });
  check(/Konfirmasi rekam kegiatan/.test(r) && /Rp 1\.500\.000/.test(r) && /Status: Rekam Data/.test(r), "ringkasan konfirmasi");
  check(/Melebihi sisa pagu sebesar Rp 400\.000/.test(r), "peringatan melebihi sisa pagu (1,5jt vs sisa 1,1jt)");
  check(db.rpcCalls.length === 0, "belum ada yang disimpan sebelum 'ya'");
  r = await s.run("ubah", { sessionKey: KEY });
  check(/3 baris dalam satu pesan/.test(r), "ubah -> isi ulang");
  r = await s.run("Pembelian ATK bulan Oktober\n5 okt 2026\n1jt", { sessionKey: KEY });
  check(!/Melebihi/.test(r) && /sesudah rekam Rp 100\.000/.test(r), "jumlah muat -> tanpa peringatan");
  r = await s.run("mungkin", { sessionKey: KEY });
  check(/Balas \*ya\*/.test(r) && db.rpcCalls.length === 0, "jawaban selain ya tidak menyimpan");
  r = await s.run("ya", { sessionKey: KEY });
  check(db.rpcCalls.length === 1 && db.rpcCalls[0].fn === "bot_rekam_kegiatan", "ya -> memanggil fungsi database");
  const a = db.rpcCalls[0].args;
  check(a.p_kantor_id === "538065" && a.p_tahun === 2026 && a.p_mak === "4701.EBA.002.051.A.521111.10" && a.p_uraian === "Pembelian ATK bulan Oktober" && a.p_tgl_st === "2026-10-05" && a.p_jumlah === 1000000 && a.p_user === "Tes User", "argumen fungsi benar");
  check(/Tersimpan di SiMAB/.test(r) && /Z9Y8X7W6V5/.test(r) && !s.hasSession(KEY), "sukses: tampil ID, sesi selesai");
  r = await s.run("ya", { sessionKey: KEY });
  check(db.rpcCalls.length === 1, "'ya' kedua tidak menyimpan dobel (sesi sudah selesai)");
}

// ---------- batal, kedaluwarsa, perintah baru ----------
{
  const db = makeDb();
  const { s, advance } = mk(db);
  await s.run("simab rekam PKN", { sessionKey: KEY });
  check(s.hasSession(KEY), "sesi PKN dimulai");
  let r = await s.run("batal", { sessionKey: KEY });
  check(/dibatalkan/.test(r) && !s.hasSession(KEY), "batal menutup sesi");
  await s.run("simab rekam PKN", { sessionKey: KEY });
  advance(11 * 60_000);
  check(!s.hasSession(KEY), "sesi kedaluwarsa setelah 10 menit tanpa balasan");
  await s.run("simab rekam PKN", { sessionKey: KEY });
  advance(6 * 60_000);
  await s.run("lanjut", { sessionKey: KEY });
  advance(6 * 60_000);
  check(s.hasSession(KEY), "setiap balasan memperpanjang sesi");
  r = await s.run("simab pagu 521111", { sessionKey: KEY });
  check(/Pagu & sisa|POK/.test(r) && s.hasSession(KEY), "perintah 'simab ...' lain tetap diproses selagi sesi aktif");
  r = await s.run("simab rekam Umum", { sessionKey: KEY });
  check(/Seksi Umum/.test(r), "perintah rekam baru menggantikan sesi lama");
  const other = "lain@s.whatsapp.net";
  check(!s.hasSession(other), "sesi terpisah per chat");
}

// ---------- seksi tanpa data & pesan galat database ----------
{
  const db = makeDb();
  const { s } = mk(db);
  let r = await s.run("simab rekam Penilaian", { sessionKey: KEY });
  check(/Tidak ada baris POK untuk seksi “Penilaian”/.test(r) && /Isi kolom seksi di POK: PKN, Umum/.test(r) && !s.hasSession(KEY), "seksi tanpa data -> tunjukkan isi kolom seksi yang ada");

  const flow = async (rpc) => {
    const d = makeDb(); d.setRpc(rpc);
    const { s: ss } = mk(d);
    await ss.run("simab rekam PKN", { sessionKey: KEY });
    await ss.run("1", { sessionKey: KEY });
    await ss.run("1", { sessionKey: KEY });
    await ss.run("Sosialisasi\n1/10/2026\n100rb", { sessionKey: KEY });
    return { ss, out: await ss.run("ya", { sessionKey: KEY }), d };
  };
  let x = await flow(async () => ({ data: null, error: { message: "Could not find the function public.bot_rekam_kegiatan in the schema cache" } }));
  check(/simab-bot-rekam\.sql/.test(x.out) && !x.ss.hasSession(KEY), "fungsi belum dipasang -> petunjuk menjalankan SQL");
  x = await flow(async () => ({ data: null, error: { message: "Kode x tidak ada di POK satker 538065 tahun 2026" } }));
  check(/Ditolak database/.test(x.out) && !x.ss.hasSession(KEY), "penolakan database -> sesi ditutup");
  x = await flow(async () => ({ data: null, error: { message: "fetch failed" } }));
  check(/Gagal menyimpan/.test(x.out) && x.ss.hasSession(KEY), "galat jaringan -> sesi dipertahankan untuk coba lagi");
  check(x.d.tables.kegiatan.length === 1, "galat jaringan: tidak ada baris tersimpan");
}

// ---------- pengaman ----------
{
  const db = makeDb();
  const { s } = mk(db);
  let r = await s.run("simab rekam Umum");
  check(/hanya bisa dari chat pemilik/.test(r), "tanpa sessionKey (bukan jalur pemilik) tidak memulai sesi");
  const off = mk(makeDb(), { rekamEnabled: false });
  r = await off.s.run("simab rekam Umum", { sessionKey: KEY });
  check(/dimatikan/.test(r) && !off.s.hasSession(KEY), "SIMAB_REKAM_ENABLED=false mematikan perekaman");
  // kalimat bebas tidak pernah memulai perekaman
  const s2 = mk(makeDb(), { ollamaParse: async () => ({ aksi: "rekam", kueri: "Umum" }) });
  r = await s2.s.run("tolong catat pengeluaran baru untuk seksi umum", { sessionKey: KEY, notify: async () => {} });
  check(!s2.s.hasSession(KEY), "kalimat bebas (model lokal) TIDAK bisa memulai perekaman");
}

console.log(fails ? `\n${fails} GAGAL` : "\nSemua OK");
process.exit(fails ? 1 : 0);
