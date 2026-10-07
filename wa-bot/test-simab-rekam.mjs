// Tes perekaman SiMAB lewat WhatsApp (database Supabase palsu di memori).
//   node test-simab-rekam.mjs
import { createSimab } from "./simab.js";
import { parseTanggal, parseJumlah, parseInput, parseSeksi, groupKey, parsePatch, searchTerms, matchesTerms } from "./simab-rekam.js";

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
  const log = [];
  let seq = 0;
  let rpcImpl = async (args) => {
    const id = seq === 0 ? "Z9Y8X7W6V5" : `ID${String(seq).padStart(8, "0")}`;
    seq += 1;
    tables.kegiatan.push({ id, mak: args.p_mak, uraian: args.p_uraian, tgl_st: args.p_tgl_st, jumlah: args.p_jumlah, user: args.p_user, status: "Rekam Data", kantor_id: String(args.p_kantor_id), tahun: args.p_tahun, created_at: "2026-10-07T01:00:00Z" });
    log.push(id);
    return { data: id, error: null };
  };
  // Tiruan fungsi SQL daftar/ubah/hapus (hanya baris buatan bot yang masih 'Rekam Data').
  const handlers = {
    bot_daftar_rekam: async (a) => ({
      data: tables.kegiatan.filter((k) => log.includes(k.id) && k.status === "Rekam Data" && (!a.p_id || k.id === a.p_id)).map((k) => ({ id: k.id, mak: k.mak, uraian: k.uraian, tgl_st: k.tgl_st, jumlah: k.jumlah, status: k.status, created_at: k.created_at })).reverse(),
      error: null
    }),
    bot_ubah_kegiatan: async (a) => {
      const k = tables.kegiatan.find((r) => r.id === a.p_id);
      if (!k || !log.includes(k.id)) return { data: null, error: { message: `Kegiatan ${a.p_id} tidak ditemukan di daftar rekam bot` } };
      if (k.status !== "Rekam Data") return { data: null, error: { message: `Kegiatan ${a.p_id} sudah diproses (status ${k.status}), ubah lewat aplikasi SiMAB` } };
      if (a.p_uraian != null) k.uraian = a.p_uraian;
      if (a.p_tgl_st != null) k.tgl_st = a.p_tgl_st;
      if (a.p_jumlah != null) k.jumlah = a.p_jumlah;
      return { data: { id: k.id, ok: true }, error: null };
    },
    bot_hapus_kegiatan: async (a) => {
      const i = tables.kegiatan.findIndex((r) => r.id === a.p_id);
      if (i < 0 || !log.includes(a.p_id)) return { data: null, error: { message: `Kegiatan ${a.p_id} tidak ditemukan di daftar rekam bot` } };
      if (tables.kegiatan[i].status !== "Rekam Data") return { data: null, error: { message: `Kegiatan ${a.p_id} sudah diproses (status ${tables.kegiatan[i].status}), hapus lewat aplikasi SiMAB` } };
      tables.kegiatan.splice(i, 1);
      log.splice(log.indexOf(a.p_id), 1);
      return { data: { id: a.p_id, ok: true }, error: null };
    }
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
    rpc: (fn, args) => { rpcCalls.push({ fn, args }); return handlers[fn] ? handlers[fn](args) : rpcImpl(args); },
    auth: {
      getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
      signInWithPassword: async () => ({ error: null })
    }
  };
  return { tables, client, rpcCalls, log, handlers, setRpc: (f) => { rpcImpl = f; } };
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
  check(/Bukan nama seksi/.test(r) && /Umum, PKN/.test(r) && !s.hasSession(KEY), "kata yang bukan seksi & tidak cocok uraian MAK manapun -> pesan + daftar seksi");
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


// ---------- pengurai tambahan ----------
{
  const a = parsePatch("jumlah 2jt", T);
  check(a?.ok && a.patch.jumlah === 2000000 && Object.keys(a.patch).length === 1, "patch: satu field (jumlah)");
  const b = parsePatch("uraian Beli kertas\ntanggal 6/10/2026\njumlah: 750.000", T);
  check(b?.ok && b.patch.uraian === "Beli kertas" && b.patch.tgl === "2026-10-06" && b.patch.jumlah === 750000, "patch: tiga field berawalan kata kunci");
  check(parsePatch("Beli ATK\n5/10/2026\n1.500.000", T) === null, "3 baris biasa BUKAN patch (jatuh ke format penuh)");
  const c = parsePatch("tanggal ngawur", T);
  check(c && c.ok === false && /tanggal/.test(c.error), "patch: nilai salah ditolak");
  check(matchesTerms("4701.EBA.002 Langganan Listrik", searchTerms("LISTRIK langganan")) && !matchesTerms("Perkantoran", searchTerms("listrik")), "pencarian: semua kata, huruf besar/kecil bebas");
}

// ---------- pencarian cepat saat memilih kode ----------
{
  const db = makeDb();
  const { s } = mk(db);
  await s.run("simab rekam Umum", { sessionKey: KEY });
  let r = await s.run("cari listrik", { sessionKey: KEY });
  check(/Pencarian kode MAK — Seksi Umum/.test(r) && /filter “listrik”/.test(r) && /1\. \*4701\.EBA\.002\.051\.A\.522111\.20\*/.test(r) && !/521111\.10/.test(r), "dari daftar kelompok: 'cari listrik' langsung menemukan kode MAK");
  check(/pagu Rp 2\.000\.000 • sisa \*Rp 2\.000\.000\*/.test(r), "hasil pencarian menampilkan sisa pagu");
  r = await s.run("1", { sessionKey: KEY });
  check(/\*4701\.EBA\.002\.051\.A\.522111\.20\*/.test(r) && /3 baris dalam satu pesan/.test(r), "angka merujuk daftar HASIL FILTER, bukan daftar penuh");
  await s.run("kembali", { sessionKey: KEY });
  r = await s.run("kembali", { sessionKey: KEY });
  check(/Rekam kegiatan — Seksi Umum/.test(r), "kembali dari pencarian ke daftar kelompok");
  r = await s.run("cari tidak-ada-kata-ini", { sessionKey: KEY });
  check(/Tidak ada kode MAK seksi Umum yang cocok/.test(r) && /Rekam kegiatan — Seksi Umum/.test(r), "tanpa hasil: pesan jelas + kembali ke daftar kelompok");
  r = await s.run("cari 524111 BIASA", { sessionKey: KEY });
  check(/524111\.01/.test(r) && !/522111/.test(r), "pencarian kode & uraian sekaligus, tidak peka huruf besar/kecil");
  r = await s.run("semua", { sessionKey: KEY });
  check(/3 kode MAK/.test(r) && !/filter “/.test(r), "'semua' menghapus filter (seluruh kode MAK seksi)");
  await s.run("kembali", { sessionKey: KEY });
  // filter di dalam satu kelompok
  await s.run("1", { sessionKey: KEY });
  r = await s.run("cari perkantoran", { sessionKey: KEY });
  check(/1 kode MAK/.test(r) && /filter “perkantoran”/.test(r) && /521111\.10/.test(r) && !/522111/.test(r), "'cari' menyaring daftar di dalam kelompok");
  r = await s.run("cari zzz", { sessionKey: KEY });
  check(/Daftar tetap seperti semula/.test(r) && /filter “perkantoran”/.test(r), "filter tanpa hasil: daftar lama dipertahankan");
  r = await s.run("semua", { sessionKey: KEY });
  check(/3 kode MAK/.test(r), "'semua' di dalam kelompok mengembalikan daftar kelompok");
  r = await s.run("cari", { sessionKey: KEY });
  check(/3 kode MAK/.test(r), "'cari' kosong = hapus filter");
  r = await s.run("caring", { sessionKey: KEY });
  check(/Sesi rekam masih aktif/.test(r), "kata berawalan 'cari' (mis. caring) bukan perintah cari");
}

// ---------- ubah & hapus ----------
async function recordOne(s, uraian = "Pembelian ATK", tgl = "5/10/2026", jumlah = "1.000.000") {
  await s.run("simab rekam Umum", { sessionKey: KEY });
  await s.run("1", { sessionKey: KEY });
  await s.run("1", { sessionKey: KEY });
  await s.run(`${uraian}\n${tgl}\n${jumlah}`, { sessionKey: KEY });
  return s.run("ya", { sessionKey: KEY });
}
{
  const db = makeDb();
  const { s } = mk(db);
  let r = await s.run("simab ubah", { sessionKey: KEY });
  check(/Belum ada kegiatan hasil rekam bot/.test(r) && !s.hasSession(KEY), "daftar ubah kosong -> pesan jelas, tanpa sesi");
  r = await recordOne(s);
  check(/Tersimpan/.test(r) && /simab ubah/.test(r), "rekam selesai; tips ubah/hapus muncul");
  const id = /ID kegiatan: \*([A-Z0-9]+)\*/.exec(r)[1];

  r = await s.run("simab ubah", { sessionKey: KEY });
  check(new RegExp(`1\\. \\*${id}\\*`).test(r) && /Pembelian ATK/.test(r) && /Rp 1\.000\.000/.test(r) && /Hanya yang direkam lewat bot/.test(r), "daftar ubah memuat kegiatan hasil rekam bot");
  check(db.rpcCalls.at(-1).fn === "bot_daftar_rekam" && db.rpcCalls.at(-1).args.p_tahun === 2026 && db.rpcCalls.at(-1).args.p_id === null, "memanggil bot_daftar_rekam (tahun aktif, tanpa id)");
  r = await s.run("7", { sessionKey: KEY });
  check(/Angka di luar daftar/.test(r), "angka di luar daftar ditolak");
  r = await s.run("1", { sessionKey: KEY });
  check(/Ubah kegiatan/.test(r) && /Uraian: Pembelian ATK/.test(r) && /\*uraian …\*/.test(r) && /\*hapus\* untuk menghapus/.test(r), "detail + cara mengubah");

  r = await s.run("jumlah 2jt", { sessionKey: KEY });
  check(/Konfirmasi ubah kegiatan/.test(r) && /Jumlah: Rp 1\.000\.000 → \*Rp 2\.000\.000\*/.test(r) && !/Uraian:/.test(r.split("Jumlah:")[0].split("Konfirmasi")[1] ?? ""), "pratinjau: hanya field yang berubah (before → after)");
  check(/Sisa pagu 4701\.EBA\.002\.051\.A\.521111\.10: Rp 100\.000 → sesudah ubah -Rp 900\.000/.test(r) && /Melebihi sisa pagu sebesar Rp 900\.000/.test(r), "pratinjau: sisa 100rb + 1jt lama - 2jt = -900rb -> peringatan lewat pagu");
  check(db.rpcCalls.filter((c) => c.fn === "bot_ubah_kegiatan").length === 0, "belum ada perubahan sebelum 'ya'");
  r = await s.run("ubah", { sessionKey: KEY });
  check(/Ubah kegiatan/.test(r), "'ubah' di konfirmasi kembali ke tahap edit");
  r = await s.run("jumlah 1,1jt\ntanggal 6/10/2026", { sessionKey: KEY });
  check(/Jumlah: Rp 1\.000\.000 → \*Rp 1\.100\.000\*/.test(r) && /Tgl dokumen: 5 Okt 2026 → \*6 Okt 2026\*/.test(r) && !/Melebihi/.test(r), "dua field sekaligus; muat pagu -> tanpa peringatan");
  r = await s.run("ya", { sessionKey: KEY });
  const u = db.rpcCalls.filter((c) => c.fn === "bot_ubah_kegiatan").at(-1)?.args;
  check(u && u.p_id === id && u.p_uraian === null && u.p_tgl_st === "2026-10-06" && u.p_jumlah === 1100000 && u.p_kantor_id === "538065", "RPC ubah: hanya field yang berubah yang dikirim, sisanya null");
  check(/Kegiatan diubah/.test(r) && !s.hasSession(KEY) && db.tables.kegiatan.find((k) => k.id === id).jumlah === 1100000, "ubah tersimpan, sesi selesai");

  // format 3 baris penuh
  await s.run("simab ubah", { sessionKey: KEY });
  await s.run("1", { sessionKey: KEY });
  r = await s.run("Pembelian ATK dan kertas\n6/10/2026\n1.100.000", { sessionKey: KEY });
  check(/Uraian: Pembelian ATK → \*Pembelian ATK dan kertas\*/.test(r) && !/Jumlah:/.test(r.split("Konfirmasi")[1].split("Sisa")[0]), "3 baris penuh: hanya yang berbeda ditampilkan");
  r = await s.run("Pembelian ATK dan kertas\n6/10/2026\n1.100.000", { sessionKey: KEY });
  check(/Balas \*ya\* untuk menyimpan perubahan/.test(r), "di tahap konfirmasi, teks lain hanya mengingatkan ya/ubah/batal");
  await s.run("batal", { sessionKey: KEY });

  // tidak ada perubahan
  await s.run("simab ubah", { sessionKey: KEY });
  await s.run("1", { sessionKey: KEY });
  r = await s.run("jumlah 1.100.000", { sessionKey: KEY });
  check(/Tidak ada perubahan/.test(r) && s.hasSession(KEY), "nilai sama dengan sekarang -> 'tidak ada perubahan'");
  r = await s.run("tanggal ngawur", { sessionKey: KEY });
  check(/tidak terbaca/.test(r), "nilai salah -> pesan jelas");
  r = await s.run("kembali", { sessionKey: KEY });
  check(/Pilih kegiatan/.test(r), "'kembali' ke daftar");
  await s.run("1", { sessionKey: KEY });

  // hapus dari tahap edit
  r = await s.run("hapus", { sessionKey: KEY });
  check(/Konfirmasi hapus kegiatan/.test(r) && /Balas \*ya hapus\*/.test(r), "'hapus' membuka konfirmasi hapus");
  r = await s.run("ya", { sessionKey: KEY });
  check(/persis \*ya hapus\*/.test(r) && db.rpcCalls.filter((c) => c.fn === "bot_hapus_kegiatan").length === 0 && db.tables.kegiatan.some((k) => k.id === id), "'ya' saja TIDAK menghapus");
  r = await s.run("ya hapus", { sessionKey: KEY });
  check(/Kegiatan dihapus/.test(r) && !db.tables.kegiatan.some((k) => k.id === id) && !s.hasSession(KEY), "'ya hapus' menghapus; sesi selesai");
  check(db.rpcCalls.filter((c) => c.fn === "bot_hapus_kegiatan").length === 1 && db.rpcCalls.at(-1).args.p_id === id, "RPC hapus dipanggil sekali dengan id yang benar");
  r = await s.run("ya hapus", { sessionKey: KEY });
  check(db.rpcCalls.filter((c) => c.fn === "bot_hapus_kegiatan").length === 1, "'ya hapus' kedua tidak menghapus lagi (sesi sudah selesai)");
}

// ---------- 'simab hapus' (langsung ke konfirmasi hapus) & lewat id ----------
{
  const db = makeDb();
  const { s } = mk(db);
  const r1 = await recordOne(s, "Kegiatan satu");
  const id1 = /ID kegiatan: \*([A-Z0-9]+)\*/.exec(r1)[1];
  const r2 = await recordOne(s, "Kegiatan dua", "6/10/2026", "100.000");
  const id2 = /ID kegiatan: \*([A-Z0-9]+)\*/.exec(r2)[1];
  let r = await s.run("simab hapus", { sessionKey: KEY });
  check(/Hapus.*kegiatan hasil rekam bot/.test(r) && r.indexOf(id2) < r.indexOf(id1), "daftar hapus: terbaru di atas");
  r = await s.run("2", { sessionKey: KEY });
  check(/Konfirmasi hapus kegiatan/.test(r) && r.includes(id1), "'simab hapus' + pilih angka -> langsung konfirmasi hapus");
  await s.run("batal", { sessionKey: KEY });
  check(db.tables.kegiatan.some((k) => k.id === id1), "batal tidak menghapus");

  r = await s.run(`simab hapus ${id2.toLowerCase()}`, { sessionKey: KEY });
  check(/Konfirmasi hapus kegiatan/.test(r) && r.includes(id2) && db.rpcCalls.filter((c) => c.fn === "bot_daftar_rekam").at(-1).args.p_id === id2, "'simab hapus <id>' langsung ke konfirmasi (id dinormalkan huruf besar)");
  r = await s.run("ya hapus", { sessionKey: KEY });
  check(/Kegiatan dihapus/.test(r) && !db.tables.kegiatan.some((k) => k.id === id2) && db.tables.kegiatan.some((k) => k.id === id1), "hanya id itu yang terhapus");

  r = await s.run("simab ubah ZZZZZZZZZZ", { sessionKey: KEY });
  check(/tidak ditemukan di daftar rekam bot/.test(r) && !s.hasSession(KEY), "id tidak dikenal -> pesan jelas");
  r = await s.run("simab hapus abc", { sessionKey: KEY });
  check(/10 huruf\/angka/.test(r) && !s.hasSession(KEY), "format id salah -> bantuan");
  r = await s.run(`simab ubah ${id1}`, { sessionKey: KEY });
  check(/Ubah kegiatan/.test(r) && r.includes(id1), "'simab ubah <id>' langsung ke tahap edit");
}

// ---------- galat database di ubah/hapus ----------
{
  const db = makeDb();
  const { s } = mk(db);
  const r0 = await recordOne(s);
  const id = /ID kegiatan: \*([A-Z0-9]+)\*/.exec(r0)[1];
  // status berubah di aplikasi sesudah daftar tampil
  await s.run("simab hapus", { sessionKey: KEY });
  await s.run("1", { sessionKey: KEY });
  db.tables.kegiatan.find((k) => k.id === id).status = "Selesai";
  let r = await s.run("ya hapus", { sessionKey: KEY });
  check(/Ditolak database/.test(r) && /sudah diproses/.test(r) && !s.hasSession(KEY) && db.tables.kegiatan.some((k) => k.id === id), "status sudah berubah -> ditolak database, tidak terhapus, sesi ditutup");
  db.tables.kegiatan.find((k) => k.id === id).status = "Rekam Data";
  // fungsi belum dipasang (SQL versi lama)
  db.handlers.bot_daftar_rekam = async () => ({ data: null, error: { message: "Could not find the function public.bot_daftar_rekam(p_id, p_kantor_id, p_limit, p_tahun) in the schema cache" } });
  r = await s.run("simab ubah", { sessionKey: KEY });
  check(/simab-bot-rekam\.sql/.test(r) && !s.hasSession(KEY), "SQL versi lama -> petunjuk memasang versi terbaru");
  // galat jaringan saat simpan ubah: sesi dipertahankan
  db.handlers.bot_daftar_rekam = async () => ({ data: [{ id, mak: "4701.EBA.002.051.A.521111.10", uraian: "Pembelian ATK", tgl_st: "2026-10-05", jumlah: 1000000, status: "Rekam Data", created_at: "2026-10-07T01:00:00Z" }], error: null });
  db.handlers.bot_ubah_kegiatan = async () => ({ data: null, error: { message: "fetch failed" } });
  await s.run("simab ubah", { sessionKey: KEY });
  await s.run("1", { sessionKey: KEY });
  await s.run("jumlah 900rb", { sessionKey: KEY });
  r = await s.run("ya", { sessionKey: KEY });
  check(/Gagal mengubah/.test(r) && s.hasSession(KEY), "galat jaringan saat ubah -> sesi dipertahankan untuk coba lagi");
}

// ---------- pengaman ubah/hapus ----------
{
  const db = makeDb();
  const { s } = mk(db);
  let r = await s.run("simab ubah");
  check(/hanya bisa dari chat pemilik/.test(r), "tanpa sessionKey: ubah ditolak");
  r = await s.run("simab hapus");
  check(/hanya bisa dari chat pemilik/.test(r), "tanpa sessionKey: hapus ditolak");
  const off = mk(makeDb(), { rekamEnabled: false });
  r = await off.s.run("simab hapus", { sessionKey: KEY });
  check(/dimatikan/.test(r), "SIMAB_REKAM_ENABLED=false mematikan ubah/hapus juga");
  const s2 = mk(makeDb(), { ollamaParse: async () => ({ aksi: "hapus", kueri: "semua" }) });
  r = await s2.s.run("tolong hapus semua kegiatan saya", { sessionKey: KEY, notify: async () => {} });
  check(!s2.s.hasSession(KEY) && !/Konfirmasi/.test(r), "kalimat bebas (model lokal) TIDAK bisa memulai hapus/ubah");
}

// ---------- meterai ----------
const MET1 = "4701.EBA.002.051.A.521115.10";
const MET2 = "4701.EBA.994.002.A.521115.20";
function addMeterai(db, both = false) {
  db.tables.pok.push({ id: "m1", kode: MET1, uraian: "Belanja Meterai", pagu: 600000, seksi: "Umum", kantor_id: "538065", tahun: 2026 });
  db.tables.blokir.push({ id: MET1, nilai: 50000, kantor_id: "538065", tahun: 2026 });
  db.tables.kegiatan.push({ id: "METERAI001", mak: MET1, jumlah: 100000, kantor_id: "538065", tahun: 2026, status: "Selesai" });
  if (both) db.tables.pok.push({ id: "m2", kode: MET2, uraian: "Materai PKN", pagu: 200000, seksi: "PKN", kantor_id: "538065", tahun: 2026 });
}
{
  // rekam meterai: satu MAK -> langsung data MAK
  const db = makeDb();
  addMeterai(db);
  const { s } = mk(db);
  let r = await s.run("simab rekam meterai", { sessionKey: KEY });
  check(r.includes(MET1) && /Pagu: Rp 600\.000/.test(r) && /Blokir: Rp 50\.000/.test(r) && /Realisasi: Rp 100\.000/.test(r) && /Sisa: Rp 450\.000/.test(r) && s.hasSession(KEY), "rekam meterai: satu MAK -> langsung tampil pagu/blokir/realisasi/sisa");
  r = await s.run("120.000", { sessionKey: KEY });
  check(/Konfirmasi/i.test(r) && /Pembelian meterai/.test(r) && /Rp 120\.000/.test(r) && /Meterai/.test(r) && /2026-10-0|\d{1,2}[\/ -]/.test(r), "jumlah saja -> konfirmasi dengan uraian & tanggal bawaan");
  r = await s.run("ya", { sessionKey: KEY });
  const call = db.rpcCalls.find((c) => c.fn === "bot_rekam_kegiatan");
  check(call && call.args.p_mak === MET1 && call.args.p_jumlah === 120000 && call.args.p_uraian === "Pembelian meterai" && /^\d{4}-\d{2}-\d{2}$/.test(call.args.p_tgl_st) && !s.hasSession(KEY), "simpan: RPC dengan MAK meterai, jumlah, uraian bawaan");
}
{
  // rekam materai (ejaan lain) + 3 baris
  const db = makeDb();
  addMeterai(db);
  const { s } = mk(db);
  await s.run("simab rekam materai", { sessionKey: KEY });
  let r = await s.run("Meterai rapat Oktober\n5/10/2026\n90rb", { sessionKey: KEY });
  check(/Meterai rapat Oktober/.test(r) && /Rp 90\.000/.test(r) && /Konfirmasi/i.test(r), "meterai: 3 baris uraian/tanggal/jumlah tetap diterima");
  await s.run("ya", { sessionKey: KEY });
  const call = db.rpcCalls.find((c) => c.fn === "bot_rekam_kegiatan");
  check(call.args.p_tgl_st === "2026-10-05" && call.args.p_jumlah === 90000, "meterai 3 baris: tersimpan benar");
}
{
  // pintasan simab meterai <jumlah>
  const db = makeDb();
  addMeterai(db);
  const { s } = mk(db);
  let r = await s.run("simab meterai 120.000", { sessionKey: KEY });
  check(/Konfirmasi/i.test(r) && /Rp 120\.000/.test(r) && /Pembelian meterai/.test(r) && s.hasSession(KEY), "pintasan: simab meterai 120.000 -> konfirmasi langsung");
  r = await s.run("batal", { sessionKey: KEY });
  check(!s.hasSession(KEY), "pintasan: batal mengakhiri sesi");
  r = await s.run("simab meterai 120rb; Meterai Oktober; 5/10/2026", { sessionKey: KEY });
  check(/Meterai Oktober/.test(r) && /Rp 120\.000/.test(r), "pintasan lengkap: jumlah; uraian; tanggal");
  await s.run("ya", { sessionKey: KEY });
  const call = db.rpcCalls.filter((c) => c.fn === "bot_rekam_kegiatan").pop();
  check(call.args.p_tgl_st === "2026-10-05" && call.args.p_uraian === "Meterai Oktober" && call.args.p_jumlah === 120000, "pintasan lengkap: tersimpan benar");
  r = await s.run("simab meterai abc", { sessionKey: KEY });
  check(/tidak terbaca/.test(r) && !s.hasSession(KEY), "pintasan: jumlah tidak valid ditolak");
  r = await s.run("simab meterai 100rb; ATK; 32/13/2026", { sessionKey: KEY });
  check(/Tanggal/.test(r) && /tidak terbaca/.test(r) && !s.hasSession(KEY), "pintasan: tanggal tidak valid ditolak");
  r = await s.run("simab meterai 100rb; ab", { sessionKey: KEY });
  check(/Uraian harus/.test(r) && !s.hasSession(KEY), "pintasan: uraian terlalu pendek ditolak");
}
{
  // beberapa MAK meterai -> daftar, pilih; dengan preset lanjut ke konfirmasi
  const db = makeDb();
  addMeterai(db, true);
  const { s } = mk(db);
  let r = await s.run("simab rekam meterai", { sessionKey: KEY });
  check(/Kode MAK meterai/.test(r) && r.includes(MET1) && r.includes(MET2), "beberapa MAK meterai -> daftar bernomor");
  r = await s.run("kembali", { sessionKey: KEY });
  check(!s.hasSession(KEY), "kembali di daftar meterai membatalkan sesi");
  r = await s.run("simab meterai 75rb", { sessionKey: KEY });
  check(/Kode MAK meterai/.test(r) && s.hasSession(KEY), "pintasan + beberapa MAK -> tetap minta pilih");
  const idx = r.split("\n").find((l) => l.includes(MET2)).match(/^\s*\*?(\d+)/)?.[1] ?? "2";
  r = await s.run(idx, { sessionKey: KEY });
  check(/Konfirmasi/i.test(r) && r.includes(MET2) && /Rp 75\.000/.test(r), "setelah memilih, preset jumlah langsung ke konfirmasi");
}
{
  // tanpa MAK meterai & override env
  const db = makeDb();
  const { s } = mk(db);
  let r = await s.run("simab rekam meterai", { sessionKey: KEY });
  check(/SIMAB_METERAI_MAK/.test(r) && !s.hasSession(KEY), "tidak ada MAK meterai -> petunjuk SIMAB_METERAI_MAK");
  const db2 = makeDb();
  addMeterai(db2, true);
  const o = mk(db2, { meteraiMak: [MET2] });
  r = await o.s.run("simab meterai 50rb", { sessionKey: KEY });
  check(r.includes(MET2) && !r.includes(MET1) && /Konfirmasi/i.test(r), "SIMAB_METERAI_MAK menimpa deteksi otomatis");
  const o2 = mk(db2, { meteraiMak: ["9999.XXX"] });
  r = await o2.s.run("simab meterai 50rb", { sessionKey: KEY });
  check(/tidak ditemukan/.test(r) && !o2.s.hasSession(KEY), "SIMAB_METERAI_MAK salah -> pesan tidak ditemukan");
  const o3 = mk(db2, { meteraiMak: [MET1], meteraiUraian: "Beli meterai kantor" });
  r = await o3.s.run("simab meterai 50rb", { sessionKey: KEY });
  check(/Beli meterai kantor/.test(r), "SIMAB_METERAI_URAIAN mengubah uraian bawaan");
}
{
  // pengaman
  const db = makeDb();
  addMeterai(db);
  const { s } = mk(db);
  let r = await s.run("simab meterai 120rb");
  check(/hanya bisa dari chat pemilik/.test(r), "tanpa sessionKey: meterai ditolak");
  const off = mk(db, { rekamEnabled: false });
  r = await off.s.run("simab meterai 120rb", { sessionKey: KEY });
  check(/dimatikan/.test(r), "SIMAB_REKAM_ENABLED=false mematikan meterai");
  const s2 = mk(db, { ollamaParse: async () => ({ aksi: "meterai", kueri: "120000" }) });
  r = await s2.s.run("tolong catat beli meterai 120 ribu", { sessionKey: KEY, notify: async () => {} });
  check(!s2.s.hasSession(KEY) && !db.rpcCalls.some((c) => c.fn === "bot_rekam_kegiatan"), "kalimat bebas (model lokal) TIDAK bisa memulai meterai");
}

// ---------- pintasan umum: simab rekam <kata uraian MAK> ----------
{
  const db = makeDb();
  const { s } = mk(db);
  // satu hasil: "perjadin" hanya cocok 4701.EBA.002.052.A.524111.01 (kode 524111 punya turunan -> bukan terpanjang)
  let r = await s.run("simab rekam perjadin", { sessionKey: KEY });
  check(r.includes("4701.EBA.002.052.A.524111.01") && /Pagu: Rp 800\.000/.test(r) && /Sisa: Rp 800\.000/.test(r) && s.hasSession(KEY), "rekam <kata>: satu hasil -> langsung tampil data MAK");
  r = await s.run("200rb", { sessionKey: KEY });
  check(/Konfirmasi/i.test(r) && /Uraian: Perjadin Biasa/.test(r) && /Rp 200\.000/.test(r) && /Jenis: Cari/.test(r), "jumlah saja -> uraian bawaan = uraian MAK");
  await s.run("ya", { sessionKey: KEY });
  const call = db.rpcCalls.find((c) => c.fn === "bot_rekam_kegiatan");
  check(call.args.p_mak === "4701.EBA.002.052.A.524111.01" && call.args.p_uraian === "Perjadin Biasa" && call.args.p_jumlah === 200000, "simpan lewat pintasan kata");
  // beberapa hasil lintas seksi: "perkantoran" cocok Umum & PKN (satu kode, pagu gabungan)
  r = await s.run("simab rekam keperluan perkantoran", { sessionKey: KEY });
  check(r.includes("4701.EBA.002.051.A.521111.10") && /Pagu: Rp 1\.500\.000/.test(r), "pencarian lintas seksi: pagu semua seksi digabung");
  await s.run("batal", { sessionKey: KEY });
  // kata cocok beberapa kode -> daftar; pilih -> input
  r = await s.run("simab rekam 4701.EBA", { sessionKey: KEY });
  check(/semua seksi/.test(r) && /\d+ kode MAK/.test(r) && /Langganan Listrik/.test(r) && /Sosialisasi/.test(r), "banyak hasil -> daftar bernomor lintas seksi");
  await s.run("batal", { sessionKey: KEY });
  // pintasan penuh: kata; jumlah; uraian; tanggal
  r = await s.run("simab rekam listrik; 1,2jt; Listrik September; 3/10/2026", { sessionKey: KEY });
  check(/Konfirmasi/i.test(r) && /Listrik September/.test(r) && /Rp 1\.200\.000/.test(r) && r.includes("4701.EBA.002.051.A.522111.20"), "rekam kata; jumlah; uraian; tanggal -> konfirmasi langsung");
  await s.run("ya", { sessionKey: KEY });
  const c2 = db.rpcCalls.filter((c) => c.fn === "bot_rekam_kegiatan").pop();
  check(c2.args.p_tgl_st === "2026-10-03" && c2.args.p_uraian === "Listrik September" && c2.args.p_jumlah === 1200000, "pintasan penuh tersimpan benar");
  r = await s.run("simab rekam listrik; 750rb", { sessionKey: KEY });
  check(/Uraian: Langganan Listrik/.test(r) && /Rp 750\.000/.test(r), "kata; jumlah -> uraian bawaan dari MAK");
  await s.run("batal", { sessionKey: KEY });
  r = await s.run("simab rekam listrik; abc", { sessionKey: KEY });
  check(/tidak terbaca/.test(r) && !s.hasSession(KEY), "pintasan kata: jumlah tidak valid ditolak");
  r = await s.run("simab rekam tidakadakata; 100rb", { sessionKey: KEY });
  check(/tidak ada kode MAK/.test(r) && !s.hasSession(KEY), "pintasan kata: tidak ada yang cocok");
  // seksi tetap bekerja seperti semula
  r = await s.run("simab rekam Umum", { sessionKey: KEY });
  check(/Rekam kegiatan — Seksi Umum/.test(r), "simab rekam <seksi> tetap menampilkan kelompok");
  await s.run("batal", { sessionKey: KEY });
  // kembali di daftar pintasan membatalkan
  await s.run("simab rekam 4701.EBA", { sessionKey: KEY });
  r = await s.run("kembali", { sessionKey: KEY });
  check(!s.hasSession(KEY), "kembali di daftar pintasan membatalkan sesi");
  // tanpa sessionKey / dimatikan / kalimat bebas
  r = await s.run("simab rekam listrik; 1jt");
  check(/hanya bisa dari chat pemilik/.test(r), "pintasan kata tanpa sessionKey ditolak");
  const off = mk(db, { rekamEnabled: false });
  r = await off.s.run("simab rekam listrik; 1jt", { sessionKey: KEY });
  check(/dimatikan/.test(r), "SIMAB_REKAM_ENABLED=false mematikan pintasan kata");
}

console.log(fails ? `\n${fails} GAGAL` : "\nSemua OK");
process.exit(fails ? 1 : 0);
