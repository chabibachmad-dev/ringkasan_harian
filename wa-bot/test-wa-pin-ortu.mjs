// Tes pendaftaran nomor WA orang tua + reset darurat pemilik (wa-pin-ortu.js) dengan Supabase palsu di memori.
//   node test-wa-pin-ortu.mjs
import { createWaPinOrtu, resetPinPemilik, findWaCode, hashWaCode, hashResetCode, STUDY_PIN_MSG_RE } from "./wa-pin-ortu.js";
import * as core from "../supabase/functions/_shared/study-core.ts";

let gagal = 0;
const check = (c, n) => { console.log(`${c ? "ok" : "GAGAL"}: ${n}`); if (!c) gagal++; };

// ---- Supabase palsu: tabel = array baris; mendukung select/eq/is/ilike/update/insert + maybeSingle
function fakeDb(tables) {
  const from = (t) => {
    const rows = (tables[t] ||= []);
    const st = { filters: [], op: "select", patch: null, ins: null, sel: false };
    const run = () => {
      const hit = rows.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === "insert") { const row = { id: `id${rows.length + 1}`, ...st.ins }; rows.push(row); return { data: st.sel ? row : null, error: null }; }
      if (st.op === "update") { hit.forEach((r) => Object.assign(r, st.patch)); return { data: st.sel ? hit[0] ?? null : null, error: null }; }
      return { data: hit, error: null };
    };
    const q = {
      select: () => { st.sel = true; return q; },
      eq: (c, v) => { st.filters.push((r) => r[c] === v); return q; },
      is: (c, v) => { st.filters.push((r) => (r[c] ?? null) === v); return q; },
      ilike: (c, v) => { const re = new RegExp(`^${String(v).replace(/\\([%_])/g, "$1")}$`, "i"); st.filters.push((r) => re.test(r[c])); return q; },
      update: (p) => { st.op = "update"; st.patch = p; return q; },
      insert: (r) => { st.op = "insert"; st.ins = r; return q; },
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      single: async () => q.maybeSingle(),
      then: (res, rej) => Promise.resolve(run()).then(res, rej)
    };
    return q;
  };
  return { from };
}
const sockPalsu = () => { const k = []; return { kirim: k, sendMessage: async (jid, c) => { k.push({ jid, text: c.text }); } }; };
const pesan = (jid, fromMe = false) => ({ key: { remoteJid: jid, fromMe, id: "x" } });

// ---- kesamaan dengan study-core.ts (sisi server)
check(findWaCode("halo pin-123456 ya") === "PIN-123456" && core.findWaCode("halo pin-123456 ya") === "PIN-123456", "findWaCode sama di bot dan server");
check(findWaCode("PIN-12345") === null && findWaCode("PIN-1234567") === null && findWaCode("tidak ada") === null, "kode 5/7 digit atau tanpa kode ditolak");
check(hashWaCode("PIN-123456") === (await core.hashWaCode("PIN-123456")), "hashWaCode sama di bot dan server");
check(hashResetCode("123456", "s1") === (await core.hashResetCode("123456", "s1")), "hashResetCode sama di bot dan server");
check(STUDY_PIN_MSG_RE.test(core.resetMessage("123456")) && STUDY_PIN_MSG_RE.test(core.RESET_DONE_MESSAGE) && !STUDY_PIN_MSG_RE.test("halo"), "pesan Study dikenali (tanpa jeda AI)");
const baris = (o) => ({ attempts: 0, expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null, ...o });
check(core.resetCodeState(baris({}), Date.now()) === "ok", "kode reset segar = ok");
check(core.resetCodeState(baris({ expires_at: new Date(Date.now() - 1).toISOString() }), Date.now()) === "expired", "kode kedaluwarsa ditolak");
check(core.resetCodeState(baris({ used_at: new Date().toISOString() }), Date.now()) === "used", "kode terpakai tidak bisa dipakai lagi");
check(core.resetCodeState(baris({ attempts: 5 }), Date.now()) === "burned", "5 percobaan salah = hangus");
check(core.resetCodeState(baris({ attempts: 4 }), Date.now()) === "ok", "4 percobaan salah masih hidup");
check(/^PIN-\d{6}$/.test(core.makeWaCode()) && /^\d{6}$/.test(core.randomDigits(6)), "format kode pendaftaran dan reset");

// ---- pendaftaran nomor
{
  const kode = "PIN-482731";
  const t = { study_parents: [{ id: "p1", name: "Ibu Ani", wa_jid: null }], study_parent_wa_codes: [{ id: "c1", parent_id: "p1", code_hash: hashWaCode(kode), expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null }] };
  const tangani = createWaPinOrtu({ supabase: fakeDb(t), log: { error() {} } });
  const s = sockPalsu();
  check((await tangani(s, pesan("628111@s.whatsapp.net"), { teks: "halo" })) === false, "pesan tanpa kode tidak ditangani");
  check((await tangani(s, pesan("120@g.us"), { teks: kode, grup: "120@g.us" })) === false, "kode di grup diabaikan");
  check((await tangani(s, pesan("628111@s.whatsapp.net", true), { teks: kode })) === false, "pesan dari bot sendiri diabaikan");
  check((await tangani(s, pesan("628111@s.whatsapp.net"), { teks: kode, account: "second" })) === false, "hanya nomor utama");
  check((await tangani(s, pesan("628111@s.whatsapp.net"), { teks: `tolong ${kode.toLowerCase()}` })) === true, "kode benar ditangani");
  check(t.study_parents[0].wa_jid === "628111@s.whatsapp.net", "nomor pengirim tercatat di akun orang tua itu");
  check(t.study_parent_wa_codes[0].used_at !== null, "kode ditandai terpakai");
  check(s.kirim.length === 1 && /Ibu Ani/.test(s.kirim[0].text), "konfirmasi dibalas");
  check((await tangani(s, pesan("628222@s.whatsapp.net"), { teks: kode })) === true && t.study_parents[0].wa_jid === "628111@s.whatsapp.net", "kode yang sudah dipakai tidak bisa dipakai nomor lain");
}
// kedaluwarsa + batas salah
{
  const kode = "PIN-111111";
  const t = { study_parents: [{ id: "p1", name: "Ibu Ani", wa_jid: null }], study_parent_wa_codes: [{ id: "c1", parent_id: "p1", code_hash: hashWaCode(kode), expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null }] };
  const tangani = createWaPinOrtu({ supabase: fakeDb(t), log: { error() {} }, maxSalahPerJam: 3 });
  const s = sockPalsu();
  await tangani(s, pesan("62899@s.whatsapp.net"), { teks: kode });
  check(t.study_parents[0].wa_jid === null && /kedaluwarsa/.test(s.kirim[0].text), "kode kedaluwarsa ditolak");
  for (let i = 0; i < 3; i++) await tangani(s, pesan("62899@s.whatsapp.net"), { teks: "PIN-999999" });
  check(/Terlalu banyak/.test(s.kirim.at(-1).text), "terlalu banyak kode salah dari satu nomor ditahan");
}
// ---- reset darurat pemilik
{
  const t = { study_parents: [{ id: "p1", name: "Ibu Ani" }, { id: "p2", name: "Pak Budi" }], study_parent_reset_codes: [] };
  const db = fakeDb(t);
  check(/Pakai: \/resetpin/.test(await resetPinPemilik({ supabase: db, nama: "" })), "tanpa nama: petunjuk");
  check(/tidak ditemukan/.test(await resetPinPemilik({ supabase: db, nama: "Siti" })), "nama tak dikenal");
  const out = await resetPinPemilik({ supabase: db, nama: "ibu ani" });
  const kode = /: (\d{6})\n/.exec(out)?.[1];
  const row = t.study_parent_reset_codes[0];
  check(!!kode && row?.parent_id === "p1" && row.via === "owner", "kode owner dibuat untuk orang tua yang benar");
  check(row.code_hash === (await core.hashResetCode(kode, row.code_salt)) && !JSON.stringify(row).includes(kode), "kode disimpan sebagai hash (tidak polos), cocok dengan verifikasi server");
  check(Date.parse(row.expires_at) - Date.now() <= 15 * 60 * 1000 && Date.parse(row.expires_at) > Date.now(), "berlaku 15 menit");
}
console.log(gagal ? `\n${gagal} GAGAL` : "\nsemua tes lolos");
process.exit(gagal ? 1 : 0);
