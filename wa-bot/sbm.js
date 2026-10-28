// ================================================================
// Kalkulator SBM perjalanan dinas dalam negeri -- DETERMINISTIK (tanpa AI), angka dari tabel PMK 32/2025.
//
// Mengapa kode, bukan AI: model bahasa suka salah mengambil baris tabel dan salah menghitung. Di sini angka
// diambil dari data/sbm-pmk32-2025.json (disalin otomatis dari PDF oleh sbm-build.mjs, lengkap dengan nomor halaman)
// dan dihitung dengan aritmetika biasa. Setiap angka disertai halaman PMK-nya.
//
//   createSbm({ data }).handle(kunciChat, teks) -> string (jawaban siap kirim) | null (bukan urusan SBM -> lanjut ke AI)
//
// Percakapan bertahap: bila data kurang (tujuan, lama, jabatan, kota asal), bot menanyakan SATU hal per pesan dan
// mengingat jawabannya selama beberapa menit. Yang tidak ada di PMK (BBM, taksi, tol, parkir, ...) dijawab apa adanya:
// "tidak ada di PMK" -- tidak pernah ditebak.
// ================================================================
import fs from "node:fs";

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const rupiah = (n) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

// ---------------------------------------------------------------- provinsi & kota
const PROV_ALIASES = {
  ACEH: ["aceh", "nad"],
  SUMATERAUTARA: ["sumatera utara", "sumatra utara", "sumut"],
  RIAU: ["riau"],
  KEPULAUANRIAU: ["kepulauan riau", "kepri"],
  JAMBI: ["jambi"],
  SUMATERABARAT: ["sumatera barat", "sumatra barat", "sumbar"],
  SUMATERASELATAN: ["sumatera selatan", "sumatra selatan", "sumsel"],
  LAMPUNG: ["lampung"],
  BENGKULU: ["bengkulu"],
  BANGKABELITUNG: ["bangka belitung", "kepulauan bangka belitung", "babel"],
  BANTEN: ["banten"],
  JAWABARAT: ["jawa barat", "jabar"],
  DKIJAKARTA: ["dki jakarta", "dki"],
  JAWATENGAH: ["jawa tengah", "jateng"],
  DIYOGYAKARTA: ["di yogyakarta", "diy", "daerah istimewa yogyakarta"],
  JAWATIMUR: ["jawa timur", "jatim"],
  BALI: ["bali"],
  NUSATENGGARABARAT: ["nusa tenggara barat", "ntb"],
  NUSATENGGARATIMUR: ["nusa tenggara timur", "ntt"],
  KALIMANTANBARAT: ["kalimantan barat", "kalbar"],
  KALIMANTANTENGAH: ["kalimantan tengah", "kalteng"],
  KALIMANTANSELATAN: ["kalimantan selatan", "kalsel"],
  KALIMANTANTIMUR: ["kalimantan timur", "kaltim"],
  KALIMANTANUTARA: ["kalimantan utara", "kaltara"],
  SULAWESIUTARA: ["sulawesi utara", "sulut"],
  GORONTALO: ["gorontalo"],
  SULAWESIBARAT: ["sulawesi barat", "sulbar"],
  SULAWESISELATAN: ["sulawesi selatan", "sulsel"],
  SULAWESITENGAH: ["sulawesi tengah", "sulteng"],
  SULAWESITENGGARA: ["sulawesi tenggara", "sultra"],
  MALUKU: ["maluku"],
  MALUKUUTARA: ["maluku utara", "malut"],
  PAPUA: ["papua"],
  PAPUABARAT: ["papua barat"],
  PAPUABARATDAYA: ["papua barat daya"],
  PAPUATENGAH: ["papua tengah"],
  PAPUASELATAN: ["papua selatan"],
  PAPUAPEGUNUNGAN: ["papua pegunungan"]
};

// Kota -> provinsi. Ini PEMETAAN BUATAN (bukan dari PMK), hanya untuk mengenali kota yang disebut pengguna.
// Entri pertama kota bertanda `air` = kunci kota di tabel tiket pesawat PMK (hlm 86-90).
const CITIES = [
  // [nama ternormalisasi, provinsi, kunci tiket (huruf besar) atau null]
  ["ambon", "MALUKU", "AMBON"], ["balikpapan", "KALIMANTANTIMUR", "BALIKPAPAN"], ["banda aceh", "ACEH", "BANDA ACEH"], ["bandar lampung", "LAMPUNG", "BANDAR LAMPUNG"],
  ["bandung", "JAWABARAT", "BANDUNG"], ["banjarmasin", "KALIMANTANSELATAN", "BANJARMASIN"], ["batam", "KEPULAUANRIAU", "BATAM"], ["bengkulu", "BENGKULU", "BENGKULU"],
  ["biak", "PAPUA", "BIAK"], ["denpasar", "BALI", "DENPASAR"], ["jakarta", "DKIJAKARTA", "JAKARTA"], ["jambi", "JAMBI", "JAMBI"], ["jayapura", "PAPUA", "JAYAPURA"],
  ["kendari", "SULAWESITENGGARA", "KENDARI"], ["kupang", "NUSATENGGARATIMUR", "KUPANG"], ["makassar", "SULAWESISELATAN", "MAKASSAR"], ["ujung pandang", "SULAWESISELATAN", "MAKASSAR"],
  ["malang", "JAWATIMUR", "MALANG"], ["mamuju", "SULAWESIBARAT", "MAMUJU"], ["manado", "SULAWESIUTARA", "MANADO"], ["manokwari", "PAPUABARAT", "MANOKWARI"], ["mataram", "NUSATENGGARABARAT", "MATARAM"],
  ["medan", "SUMATERAUTARA", "MEDAN"], ["padang", "SUMATERABARAT", "PADANG"], ["palangkaraya", "KALIMANTANTENGAH", "PALANGKARAYA"], ["palangka raya", "KALIMANTANTENGAH", "PALANGKARAYA"],
  ["palembang", "SUMATERASELATAN", "PALEMBANG"], ["palu", "SULAWESITENGAH", "PALU"], ["pangkal pinang", "BANGKABELITUNG", "PANGKAL PINANG"], ["pangkalpinang", "BANGKABELITUNG", "PANGKAL PINANG"],
  ["pekanbaru", "RIAU", "PEKANBARU"], ["pontianak", "KALIMANTANBARAT", "PONTIANAK"], ["semarang", "JAWATENGAH", "SEMARANG"], ["solo", "JAWATENGAH", "SOLO"], ["surakarta", "JAWATENGAH", "SOLO"],
  ["surabaya", "JAWATIMUR", "SURABAYA"], ["yogyakarta", "DIYOGYAKARTA", "YOGYAKARTA"], ["jogja", "DIYOGYAKARTA", "YOGYAKARTA"], ["jogjakarta", "DIYOGYAKARTA", "YOGYAKARTA"], ["yogya", "DIYOGYAKARTA", "YOGYAKARTA"],
  ["gorontalo", "GORONTALO", "GORONTALO"], ["poso", "SULAWESITENGAH", "POSO"], ["sorong", "PAPUABARATDAYA", "SORONG"], ["tanjung pandan", "BANGKABELITUNG", "TANJUNG PANDAN"],
  ["tanjung selor", "KALIMANTANUTARA", "TANJUNG SELOR"], ["ternate", "MALUKUUTARA", "TERNATE"], ["timika", "PAPUATENGAH", "TIMIKA"], ["toli toli", "SULAWESITENGAH", "TOLI-TOLI"],
  // kota lain (tanpa rute di tabel tiket)
  ["tangerang", "BANTEN", null], ["tangerang selatan", "BANTEN", null], ["serang", "BANTEN", null], ["cilegon", "BANTEN", null], ["bekasi", "JAWABARAT", null], ["bogor", "JAWABARAT", null], ["depok", "JAWABARAT", null],
  ["cirebon", "JAWABARAT", null], ["garut", "JAWABARAT", null], ["tasikmalaya", "JAWABARAT", null], ["sukabumi", "JAWABARAT", null], ["karawang", "JAWABARAT", null], ["cianjur", "JAWABARAT", null], ["purwakarta", "JAWABARAT", null],
  ["magelang", "JAWATENGAH", null], ["salatiga", "JAWATENGAH", null], ["tegal", "JAWATENGAH", null], ["pekalongan", "JAWATENGAH", null], ["purwokerto", "JAWATENGAH", null], ["cilacap", "JAWATENGAH", null], ["kudus", "JAWATENGAH", null],
  ["sleman", "DIYOGYAKARTA", null], ["bantul", "DIYOGYAKARTA", null], ["kediri", "JAWATIMUR", null], ["madiun", "JAWATIMUR", null], ["jember", "JAWATIMUR", null], ["banyuwangi", "JAWATIMUR", null], ["sidoarjo", "JAWATIMUR", null], ["gresik", "JAWATIMUR", null],
  ["mojokerto", "JAWATIMUR", null], ["pasuruan", "JAWATIMUR", null], ["probolinggo", "JAWATIMUR", null], ["singaraja", "BALI", null], ["ubud", "BALI", null], ["kuta", "BALI", null], ["lombok", "NUSATENGGARABARAT", null], ["sumbawa", "NUSATENGGARABARAT", null],
  ["labuan bajo", "NUSATENGGARATIMUR", null], ["maumere", "NUSATENGGARATIMUR", null], ["ende", "NUSATENGGARATIMUR", null], ["singkawang", "KALIMANTANBARAT", null], ["sampit", "KALIMANTANTENGAH", null], ["samarinda", "KALIMANTANTIMUR", null],
  ["bontang", "KALIMANTANTIMUR", null], ["tarakan", "KALIMANTANUTARA", null], ["banjarbaru", "KALIMANTANSELATAN", null], ["bitung", "SULAWESIUTARA", null], ["tomohon", "SULAWESIUTARA", null], ["parepare", "SULAWESISELATAN", null],
  ["palopo", "SULAWESISELATAN", null], ["bau bau", "SULAWESITENGGARA", null], ["kolaka", "SULAWESITENGGARA", null], ["luwuk", "SULAWESITENGAH", null], ["merauke", "PAPUASELATAN", null], ["nabire", "PAPUATENGAH", null], ["wamena", "PAPUAPEGUNUNGAN", null],
  ["fakfak", "PAPUABARAT", null], ["raja ampat", "PAPUABARATDAYA", null], ["lhokseumawe", "ACEH", null], ["sabang", "ACEH", null], ["langsa", "ACEH", null], ["binjai", "SUMATERAUTARA", null], ["pematangsiantar", "SUMATERAUTARA", null],
  ["bukittinggi", "SUMATERABARAT", null], ["dumai", "RIAU", null], ["tanjung pinang", "KEPULAUANRIAU", null], ["lubuklinggau", "SUMATERASELATAN", null], ["metro", "LAMPUNG", null], ["belitung", "BANGKABELITUNG", null], ["bangka", "BANGKABELITUNG", null]
];

// ---------------------------------------------------------------- penanda maksud & isi
const COST_WORDS = /\b(berapa|hitung\w*|total|estimasi|rincian|biaya|tarif|batas|besaran|satuan|anggaran|rab|nominal|jatah|hak)\b/;
const STRONG = /\b(uang harian|uang representasi|sbm|standar biaya masukan|sppd|perjadin|tarif hotel|biaya penginapan|biaya hotel|batas (?:tertinggi )?(?:hotel|penginapan)|tiket pesawat dinas|biaya tiket pesawat|dinas luar kota)\b/;
const TRIP = /\b(perjalanan dinas|dinas luar|perjadin|sppd|tugas luar)\b/;
const FULL = /\b(hitung\w*|total|estimasi|rincian|rab|anggaran|simulasi|biaya perjalanan dinas|keseluruhan|semua komponen)\b/;
// Hal yang tidak punya satuan biaya di PMK 32/2025 (dicari kata-katanya di teks PMK; tidak ada sebagai tarif).
const NOT_IN_PMK = /\b(bbm|bensin|solar|pertamax|pertalite|bahan bakar|tol|e toll|etoll|taksi|taxi|grab|gojek|ojek|ojol|parkir|laundry|binatu)\b/;
const CANCEL = /^(batal|batalkan|cancel|stop|tidak jadi|gak jadi|nggak jadi|ga jadi)\b/;

function parseNumberBefore(t, words) {
  const m = new RegExp(`\\b(\\d{1,3})\\s*(?:${words})\\b`).exec(t);
  return m ? Number(m[1]) : null;
}

export function parseJabatan(text) {
  const t = norm(text);
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, "1": 1, "2": 2, "3": 3, "4": 4 };
  let m = /\beselon\s*(iv|iii|ii|i|[1-4])\b/.exec(t);
  if (m) {
    const n = roman[m[1]];
    return { n, tier: n === 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 4, label: `Pejabat Eselon ${["I", "II", "III", "IV"][n - 1]}`, repr: n === 1 ? "ESELON I" : n === 2 ? "ESELON II" : null };
  }
  m = /\bgol(?:ongan)?\s*(iv|iii|ii|i|[1-4])\s*[a-e]?\b/.exec(t) || /\bgolongan\s*(iv|iii|ii|i|[1-4])\b/.exec(t);
  if (m) {
    const n = roman[m[1]];
    return { n, tier: n === 4 ? 3 : 4, label: `Golongan ${["I", "II", "III", "IV"][n - 1]}`, repr: null };
  }
  if (/\b(wakil menteri|wamen|menteri|setingkat menteri|pejabat negara|ketua lembaga|ketua dpr|anggota dpr)\b/.test(t)) {
    return { n: 0, tier: /pejabat negara lainnya/.test(t) ? 2 : 1, label: /pejabat negara lainnya/.test(t) ? "Pejabat Negara lainnya" : "Pejabat Negara/Wakil Menteri", repr: "NEGARA" };
  }
  if (/\b(staf|staff|pelaksana|fungsional|jft|jfu|cpns|pppk)\b/.test(t)) return { n: -1, tier: 0, label: "staf", repr: null, needsGol: true };
  return null;
}

export function parseLama(text) {
  const t = norm(text);
  const hari = parseNumberBefore(t, "hari");
  const malam = parseNumberBefore(t, "malam|mlm");
  const orang = parseNumberBefore(t, "orang|pegawai|peserta|personel|personil|pejabat|staf|staff|pax");
  return { hari, malam, orang };
}

// ---------------------------------------------------------------- inti
export function loadSbmData(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function createSbm({ data, now = () => Date.now(), ttlMs = 10 * 60_000 } = {}) {
  if (!data?.uangHarian) throw new Error("Data SBM kosong");
  const sumber = data.meta?.sumber || "PMK 32/2025";
  const short = /Nomor\s+(\d+)\s+Tahun\s+(\d+)/i.exec(sumber);
  const pmk = short ? `PMK ${short[1]}/${short[2]}` : "PMK";
  const provName = Object.fromEntries(data.provinsi.map((p) => [p.key, p.nama]));
  const sessions = new Map();

  // daftar nama yang dikenali, terpanjang dulu
  const names = [];
  for (const [key, list] of Object.entries(PROV_ALIASES)) for (const a of list) if (provName[key]) names.push({ name: a, prov: key, isCity: false, air: null });
  for (const [c, prov, air] of CITIES) names.push({ name: c, prov, isCity: true, air });
  names.sort((a, b) => b.name.length - a.name.length);
  const tiketCities = new Set();
  for (const t of data.tiket) {
    tiketCities.add(t.asal);
    tiketCities.add(t.tujuan);
  }
  const airCitiesOf = (prov) => [...new Set(CITIES.filter(([, p, air]) => p === prov && air && tiketCities.has(air)).map(([, , air]) => air))];

  /** Semua tempat yang disebut: [{ start, prov, city|null, air|null, marker }] berurutan. */
  function placesIn(text) {
    const t = ` ${norm(text)} `;
    const taken = [];
    const out = [];
    for (const n of names) {
      const re = new RegExp(`(?<= )${n.name.replace(/ /g, " ")}(?= )`, "g");
      let m;
      while ((m = re.exec(t))) {
        const s = m.index;
        const e = s + n.name.length;
        if (taken.some(([a, b]) => s < b && e > a)) continue;
        taken.push([s, e]);
        const before = t.slice(0, s).trim().split(" ").slice(-2);
        const prev = before[before.length - 1] || "";
        const marker = /^(dari|asal|berangkat)$/.test(prev) ? "asal" : /^(ke|tujuan|menuju|di|kota)$/.test(prev) ? "tujuan" : null;
        out.push({ start: s, prov: n.prov, air: n.air || null, isCity: n.isCity, marker, label: n.name });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  function parseSlots(text, asking) {
    const slots = {};
    const t = norm(text);
    const places = placesIn(text);
    let asal = places.find((p) => p.marker === "asal") || null;
    let tujuan = places.find((p) => p.marker === "tujuan") || null;
    if (asking === "asal" && !asal && places.length > 0) asal = places[0];
    else if (!tujuan) tujuan = places.find((p) => p !== asal && p.marker !== "asal") || null;
    if (asal) slots.asal = asal;
    if (tujuan) slots.tujuan = tujuan;
    const lama = parseLama(text);
    if (lama.hari) slots.hari = lama.hari;
    if (lama.malam != null) slots.malam = lama.malam;
    if (lama.orang) slots.orang = lama.orang;
    if (asking === "hari" && !slots.hari && /^\d{1,3}$/.test(t)) slots.hari = Number(t);
    const jab = parseJabatan(text);
    if (jab) slots.jabatan = jab;
    if (/\bdalam kota\b/.test(t)) slots.jenis = "dalam";
    else if (/\bdiklat|pelatihan klasikal\b/.test(t)) slots.jenis = "diklat";
    else if (/\bluar kota\b/.test(t)) slots.jenis = "luar";
    if (/\b(transpor|transport)\w* (lokal )?riil\b|\briil\b/.test(t)) slots.riil = true;
    if (/\b(pesawat|tiket|terbang|flight|garuda|lion|citilink)\b/.test(t)) slots.pesawat = true;
    return slots;
  }

  function wanted(text) {
    const t = norm(text);
    const w = new Set();
    if (/\buang harian\b/.test(t)) w.add("harian");
    if (/\b(penginapan|hotel|menginap|akomodasi)\b/.test(t)) w.add("penginapan");
    if (/\brepresentasi\b/.test(t)) w.add("representasi");
    if (/\b(tiket|pesawat)\b/.test(t)) w.add("tiket");
    return { set: w, full: FULL.test(t) || (w.size === 0 && TRIP.test(t)) };
  }

  // ------------------------------------------------------------ jawaban
  const pg = (n, lampiran2 = false) => `${pmk} hlm ${n}${lampiran2 ? ", Lampiran II: dapat dilampaui" : ""}`;

  function tiketFor(asal, tujuan) {
    return data.tiket.filter((t) => (t.asal === asal && t.tujuan === tujuan) || (t.asal === tujuan && t.tujuan === asal));
  }

  function compute(slots, want) {
    const lines = [];
    let total = 0;
    const notes = [];
    const orang = slots.orang || 1;
    const dest = slots.tujuan;
    const prov = dest?.prov;
    const pname = prov ? provName[prov] : null;
    const jenis = slots.jenis || "luar";
    const hari = slots.hari || null;
    const malam = slots.malam != null ? slots.malam : hari ? Math.max(0, hari - 1) : null;
    const who = orang > 1 ? ` × ${orang} orang` : "";

    const head = [];
    if (pname) head.push(dest.isCity ? `${dest.label.replace(/\b\w/g, (c) => c.toUpperCase())} (${pname})` : pname);
    const sub = [hari ? `${hari} hari${malam != null ? ` ${malam} malam` : ""}` : null, orang > 1 ? `${orang} orang` : null, slots.jabatan && !slots.jabatan.needsGol ? slots.jabatan.label : null].filter(Boolean);

    if (want.has("harian") && prov) {
      const u = data.uangHarian[prov];
      if (u) {
        let per = jenis === "dalam" ? u.dalamKota8Jam : jenis === "diklat" ? u.diklat : u.luarKota;
        const nm = jenis === "dalam" ? "dalam kota > 8 jam" : jenis === "diklat" ? "diklat" : "luar kota";
        if (slots.riil) {
          per = Math.round(per * 0.6);
          notes.push("Transpor lokal dibayar riil → uang harian 60% dari satuan biaya (" + pg(53) + ").");
        }
        if (hari) {
          const sum = per * hari * orang;
          total += sum;
          lines.push(`• Uang harian ${nm}: ${hari} hari × ${rupiah(per)}${who} = *${rupiah(sum)}* (${pg(u.hlm)})`);
        } else lines.push(`• Uang harian ${nm}: *${rupiah(per)}* per orang per hari (${pg(u.hlm)})`);
      }
    }

    if (want.has("penginapan") && prov && jenis !== "dalam") {
      const p = data.penginapan[prov];
      const jab = slots.jabatan;
      if (p && jab && jab.tier) {
        const per = p[`t${jab.tier}`];
        const tierName = ["Pejabat Negara/Wakil Menteri/Eselon I", "Pejabat Negara lainnya/Eselon II", "Eselon III/Golongan IV", "Eselon IV/Golongan III, II, I"][jab.tier - 1];
        if (malam != null) {
          const sum = per * malam * orang;
          total += sum;
          lines.push(`• Penginapan (batas tertinggi ${tierName}): ${malam} malam × ${rupiah(per)}${who} = *${rupiah(sum)}* (${pg(p.hlm)})`);
        } else lines.push(`• Penginapan (batas tertinggi ${tierName}): *${rupiah(per)}* per malam (${pg(p.hlm)})`);
        notes.push("Penginapan dibayar sesuai bukti pengeluaran yang sah, paling tinggi sebesar batas di atas (" + pmk + " hlm 54).");
      } else if (p && !jab) {
        lines.push(`• Penginapan per malam, menurut jabatan (${pg(p.hlm)}): Eselon I/Pejabat Negara ${rupiah(p.t1)} • Eselon II ${rupiah(p.t2)} • Eselon III/Gol IV ${rupiah(p.t3)} • Eselon IV/Gol III-I ${rupiah(p.t4)}`);
      }
    }

    if (want.has("representasi")) {
      const jab = slots.jabatan;
      const rep = jab?.repr && data.representasi.find((r) => (jab.repr === "NEGARA" ? /NEGARA/.test(r.jabatan) : r.jabatan === `PEJABAT ${jab.repr}`));
      if (rep && (jenis === "luar" || jenis === "dalam")) {
        const per = jenis === "dalam" ? rep.dalamKota8Jam : rep.luarKota;
        if (hari) {
          const sum = per * hari * orang;
          total += sum;
          lines.push(`• Uang representasi (${rep.jabatan.toLowerCase()}): ${hari} hari × ${rupiah(per)}${who} = *${rupiah(sum)}* (${pg(rep.hlm)})`);
        } else lines.push(`• Uang representasi (${rep.jabatan.toLowerCase()}): *${rupiah(per)}* per hari (${pg(rep.hlm)})`);
      } else if (jab && !rep) {
        notes.push("Uang representasi hanya untuk pejabat negara, wakil menteri, Eselon I, dan Eselon II (" + pmk + " hlm 54).");
      }
    }

    if (want.has("tiket")) {
      const a = slots.asal;
      if (a && dest) {
        const aCity = a.air;
        const dCities = dest.air ? [dest.air] : airCitiesOf(prov);
        const rows = [];
        if (aCity) for (const dc of dCities) rows.push(...tiketFor(aCity, dc));
        if (rows.length) {
          const single = rows.length === 1;
          for (const r of rows.slice(0, 3)) {
            const eko = r.ekonomi * orang;
            if (single) total += eko;
            lines.push(`• Tiket pesawat PP ${r.asal.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}–${r.tujuan.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}: ekonomi *${rupiah(r.ekonomi)}*${orang > 1 ? ` × ${orang} = ${rupiah(eko)}` : ""} • bisnis ${rupiah(r.bisnis)} (${pg(r.hlm, true)})`);
          }
          notes.push(single ? "Total memakai tarif ekonomi; kelas yang menjadi hak mengikuti ketentuan perjalanan dinas (di luar PMK ini)." : "Ada lebih dari satu bandara tujuan di provinsi itu; tiket tidak dijumlahkan ke total — pilih kota tujuannya.");
        } else {
          lines.push(`• Tiket pesawat: rute ${a.label} ↔ ${dest.label} *tidak tercantum* di tabel tiket ${pmk} (hlm 86–90), jadi tidak saya hitung.`);
        }
      }
    }

    if (want.has("terminal") && prov) {
      const t = data.terminal[prov];
      if (t) lines.push(`• Transpor dari/ke terminal/bandara di ${pname}: ${rupiah(t.nilai)} per orang per kali (${pg(t.hlm, true)}) — tidak dijumlahkan di total.`);
      else lines.push(`• Transpor dari/ke terminal/bandara untuk ${pname} *tidak tercantum* di ${pmk} hlm 85.`);
    }

    return { lines, total, notes, head: head.join(" "), sub: sub.join(", ") };
  }

  function format(slots, want, withTotal, full = false) {
    const c = compute(slots, want);
    if (c.lines.length === 0) return null;
    const out = [];
    out.push(`*Perhitungan SBM perjalanan dinas dalam negeri${c.head ? ` ke ${c.head}` : ""}*${c.sub ? ` (${c.sub})` : ""}`);
    out.push(...c.lines);
    if (withTotal && c.lines.filter((l) => /\*Rp/.test(l)).length > 1) out.push(`*Jumlah komponen yang terhitung: ${rupiah(c.total)}*`);
    if (slots.jabatan?.needsGol) out.push("Catatan: untuk staf, sebutkan golongannya (mis. gol III) agar tarif penginapan bisa dipilih.");
    for (const n of new Set(c.notes)) out.push(`Catatan: ${n}`);
    if (full && !want.has("tiket")) out.push("Tiket pesawat tidak ikut dihitung; sebut kota asal dan kata \"pesawat\" bila perlu.");
    out.push(`Batas tertinggi menurut ${pmk} (Lampiran I); komponen lain dan syarat pembayaran (mis. hari berangkat/pulang) mengikuti ketentuan perjalanan dinas, tidak dihitung di sini.`);
    return out.join("\n");
  }

  function ask(key, slots, want, full, what) {
    sessions.set(key, { slots, want, full, asking: what, at: now() });
    const q = {
      tujuan: "Tujuannya provinsi/kota mana?",
      hari: "Berapa hari perjalanannya? (boleh tulis juga jumlah malamnya, mis. 3 hari 2 malam)",
      jabatan: "Jabatan/golongan pelaksana perjalanannya apa? (mis. Eselon III, atau Gol III)",
      asal: "Naik pesawat dari kota mana? (mis. dari Jakarta)"
    }[what];
    return q;
  }

  function isIntent(text) {
    const t = norm(text);
    if (STRONG.test(t)) return true;
    return TRIP.test(t) && COST_WORDS.test(t);
  }

  function handle(key, text) {
    const t = norm(text);
    if (!t) return null;
    for (const [k, s] of sessions) if (now() - s.at > ttlMs) sessions.delete(k);
    const sess = sessions.get(key) || null;
    if (sess && CANCEL.test(t)) {
      sessions.delete(key);
      return "Oke, perhitungan SBM dibatalkan.";
    }
    const intent = isIntent(text);
    if (!intent && !sess) return null;

    // Hal yang tidak punya tarif di PMK: jawab jujur, jangan menebak.
    const ni = NOT_IN_PMK.exec(t);
    const niNote = ni
      ? `Untuk *${ni[0]}*, ${pmk} *tidak memuat satuan biaya khusus* — jadi saya tidak menebak angkanya.\n` +
        `Yang ada di ${pmk} terkait transpor perjalanan dinas: transpor dari/ke terminal/bandara per provinsi (hlm 85), transpor kegiatan dalam kab/kota PP ${rupiah(170000)} (hlm 69), dan transpor darat ibukota provinsi → kab/kota (hlm 62–69). ` +
        `Bila transpor lokal dibayar riil (sesuai bukti), uang harian menjadi 60% (hlm 53).`
      : "";
    if (ni && wanted(text).set.size === 0 && !FULL.test(t)) {
      sessions.delete(key);
      return niNote;
    }
    const withNi = (x) => (niNote && x ? `${x}\n\n${niNote}` : x);

    let slots = sess ? { ...sess.slots } : {};
    const fresh = parseSlots(text, sess?.asking);
    const hadNew = Object.keys(fresh).length > 0;
    if (sess && !intent && !hadNew) {
      sessions.delete(key); // pesan lain yang tidak nyambung: lepaskan sesi, biarkan AI menjawab
      return null;
    }
    // Pertanyaan baru yang menyebut tujuan/jabatan sendiri menggantikan isian lama (bukan menambah).
    if (intent && sess && (fresh.tujuan || fresh.jabatan || fresh.hari)) slots = {};
    Object.assign(slots, fresh);

    let w = sess && !intent ? { set: new Set(sess.want), full: sess.full } : wanted(text);
    if (intent && sess) w = wanted(text);
    const want = new Set(w.set);
    let full = w.full;
    if (want.size === 0) full = true;
    if (full) for (const c of ["harian", "penginapan", "representasi"]) want.add(c);
    if (full && slots.pesawat) want.add("tiket");
    if (want.has("tiket") && !slots.pesawat && !slots.asal && !w.set.has("tiket")) want.delete("tiket");

    // luar negeri: belum didukung
    if (/\b(luar negeri|ln)\b/.test(t) || /\b(amerika|jepang|singapura|malaysia|korea|eropa|arab|china|tiongkok|inggris|australia|thailand)\b/.test(t)) {
      sessions.delete(key);
      return `Perjalanan dinas *luar negeri* belum bisa saya hitung otomatis. Tabel uang harian luar negeri ada di ${pmk} hlm 16–18 dan tiket di hlm 91–93; sebutkan negaranya + golongan (A–D) bila mau saya cari lewat dokumen.`;
    }

    // data yang masih kurang (satu pertanyaan per pesan)
    const needTujuan = !slots.tujuan;
    if (needTujuan) return ask(key, slots, want, full, "tujuan");
    if (!slots.tujuan.prov || !data.uangHarian[slots.tujuan.prov]) return `Provinsi "${slots.tujuan.label}" tidak ada di tabel ${pmk}.`;
    if (want.has("tiket") && !slots.asal) return ask(key, slots, want, full, "asal");
    if (full && !slots.hari && slots.malam == null) return ask(key, slots, want, full, "hari");
    if (full && !slots.jabatan && (want.has("penginapan") || want.has("representasi")) && (slots.jenis || "luar") !== "dalam") return ask(key, slots, want, full, "jabatan");
    if (slots.jabatan?.needsGol && (want.has("penginapan"))) {
      // staf tanpa golongan: tampilkan semua tingkat, jangan menebak
      const s2 = { ...slots, jabatan: null };
      const r = format(s2, want, true);
      sessions.set(key, { slots, want, full, asking: "jabatan", at: now() });
      return r ? withNi(`${r}\n\nSebutkan golongan atau eselon pelaksananya agar penginapan bisa dipilih tepat.`) : ask(key, slots, want, full, "jabatan");
    }
    // pertanyaan satu komponen tanpa lama perjalanan: beri angka per hari, lalu tawarkan hitung total
    const out = format(slots, want, true, full);
    if (!out) {
      sessions.delete(key);
      return null;
    }
    if (!slots.hari && slots.malam == null && !full) {
      sessions.set(key, { slots, want, full, asking: "hari", at: now() });
      return withNi(`${out}\n\nMau dihitung untuk berapa hari? Sebut jumlah harinya.`);
    }
    sessions.delete(key);
    return withNi(out);
  }

  return { handle, isIntent, parseSlots, placesIn, compute, sessions, data };
}
