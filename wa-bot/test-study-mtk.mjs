// Uji integrasi Latihan Matematika di Study: menu, penyambungan onPoin -> server, dan pembatas di sisi server (aksi mtk_points + migrasi 0046).
// Jalankan: node wa-bot/test-study-mtk.mjs
import fs from "node:fs";
import { PAGE_ICONS, headerMenuRows } from "../src/app-header.js";
let gagal = 0;
const check = (ok, nama) => { if (!ok) gagal++; console.log(`${ok ? "ok" : "GAGAL"}: ${nama}`); };
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const study = read("../src/study.js"), idx = read("../supabase/functions/study/index.ts"), mig = read("../supabase/migrations/0046_study_latihan_mtk.sql"), i18n = read("../src/i18n.js");

// ---- modul tersalin
check(read("../src/latihan-mtk/soal.js") === read("./latihan-mtk/soal.js") && read("../src/latihan-mtk/ui.js") === read("./latihan-mtk/ui.js"), "src/latihan-mtk sama dengan wa-bot/latihan-mtk (soal.js, ui.js)");

// ---- menu
check(/\["mtk", L\("study_mtk_btn"\)\]/.test(study) && PAGE_ICONS.mtk === "calculator", "menu hamburger punya item Latihan Matematika berikon");
check(headerMenuRows({ theme: "light", pageItems: [["mtk", "x"]], labels: {} }).find((r) => r.act === "mtk")?.icon === "calculator", "baris menu mtk memakai ikon calculator");
check(/import\("\.\/latihan-mtk\/ui\.js"\)/.test(study) && !/^import[^\n]*latihan-mtk/m.test(study), "modul dimuat lazy (import dinamis), tidak membebani muat awal");
check(/bukaLatihanMatematika\(\{[\s\S]{0,400}onPoin: \(poin, info\) => reportMtkPoints\(m, poin, info\)[\s\S]{0,200}onTutup/.test(study), "bukaLatihanMatematika({tempat, bahasa, pemain, onPoin, onTutup})");
check(/studyCall\("mtk_points"/.test(study) && /sesiId: String\(info\?\.sesiId/.test(study) && /nomor: Number\.isInteger\(info\?\.nomor\) \? info\.nomor : 0/.test(study), "onPoin dikirim ke mtk_points dengan sesiId + nomor (bonus = 0)");
check(/m\.chain = m\.chain\.then/.test(study), "pengiriman poin berurutan");
check(/if \(S\.view !== "mtk" && S\.mtk\)/.test(study) && /if \(S\.view === "mtk"\) \{/.test(study), "keluar layar melepas modul (tombol Kembali & jalan lain)");

// ---- i18n lengkap ID/EN
const keys = ["study_mtk_btn", "study_mtk_title", "study_mtk_intro", "study_mtk_open", "study_mtk_today", "study_mtk_today_free", "study_mtk_capped", "study_mtk_off", "study_mtk_fail"];
check(keys.every((k) => (i18n.match(new RegExp(`${k}:`, "g")) || []).length === 2), "teks ID/EN lengkap");

// ---- server: aksi
const act = idx.slice(idx.indexOf('if (action === "mtk_points")'), idx.indexOf('if (action === "speak_list")'));
check(/MTK_MAX_POINTS_PER_QUESTION = 6/.test(idx) && /Math\.min\(MTK_MAX_POINTS_PER_QUESTION, Math\.floor\(poin\)\)/.test(act), "server memotong poin per soal ke maksimal 6");
check(/checkPlayerPin\(admin, body\.playerId, body\.pin\)/.test(act) && /study_mtk_award/.test(act), "butuh PIN/token pemain, lalu memanggil study_mtk_award");
check(/nomor < 0 \|\| nomor > 50/.test(act) && /\[A-Za-z0-9_-\]\{4,40\}/.test(act), "sesiId & nomor divalidasi");
check(/mtkUnavailable/.test(act) && /0046_study_latihan_mtk\.sql/.test(act), "pesan jelas bila migrasi belum dijalankan");
check(/mtk_points {10}/.test(idx), "aksi didokumentasikan di kepala index.ts");

// ---- server: migrasi
check(/least\(coalesce\(p_poin, 0\), 6\)/.test(mig), "SQL: poin per soal dipotong 6 juga di database");
check(/create unique index if not exists study_ledger_mtk_uniq[\s\S]{0,200}where kind = 'latihan_mtk'/.test(mig) && /on conflict do nothing/.test(mig), "SQL: (sesiId, nomor) unik per pemain, ulangan diabaikan");
check(/exists \(select 1 from public\.study_ledger l where l\.player_id = p_player and l\.kind = 'latihan_mtk'/.test(mig), "SQL: pemeriksaan duplikat sebelum menghitung jatah");
check(/mtk_daily_cap integer not null default 100/.test(mig) && /study_day_start\(now\(\)\)/.test(mig) && /least\(pts, greatest\(0, cap - today\)\)/.test(mig), "SQL: batas harian (bawaan 100, 0 = tanpa batas) per hari zona belajar");
check(/pg_advisory_xact_lock/.test(mig), "SQL: dikunci per pemain agar permintaan serentak tak menembus batas");
check(/'bonus', 'latihan_mtk'\)/.test(mig) && /kind in \('session', 'competition', 'competition_bonus', 'latihan_mtk'\)/.test(mig), "SQL: jenis baru masuk constraint dan leaderboard");
check(!/study_earned_today/.test(mig.replace(/--[^\n]*/g, "")), "SQL: tidak menyentuh batas harian umum 1000");
check(/revoke all on function public\.study_mtk_award[\s\S]*grant execute on function public\.study_mtk_award[^;]*to service_role/.test(mig), "SQL: hanya service_role");
check(!/\b(drop table|delete from|truncate)\b/i.test(mig), "SQL: tidak menghapus data");

if (gagal) { console.log(`\n${gagal} tes GAGAL`); process.exit(1); }
console.log("\nSemua tes study-mtk lolos");
