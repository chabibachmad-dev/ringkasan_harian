// Tes bilah atas baru (src/app-header.js + struktur index.html/study.js).  node test-app-header.mjs
import fs from "node:fs";
import { applyThemeTo, countText, headerMenuRows, menuDot, nextLang, nextTheme, resolveTheme, themeColor } from "../src/app-header.js";
import { ICON_MOON, ICON_SUN, ICON_SETTINGS } from "../src/icons.js";

let gagal = 0;
const check = (c, n) => { console.log(`${c ? "ok" : "GAGAL"}: ${n}`); if (!c) gagal++; };
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const studySrc = fs.readFileSync(new URL("../src/study.js", import.meta.url), "utf8");

// struktur: header Study hanya Kembali / Judul / Bahasa / Hamburger
const hdr = html.slice(html.indexOf('<section id="screen-study"'), html.indexOf('<main class="content" id="study-body"'));
const ids = [...hdr.matchAll(/<(?:button|h1)[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
check(JSON.stringify(ids) === JSON.stringify(["study-back-btn", "study-title", "study-lang-btn", "study-menu-btn"]), `di luar menu hanya Kembali/Judul/Bahasa/Hamburger (${ids.join(",")})`);
check(!/study-notif-btn|study-settings-btn|theme-btn/.test(hdr), "tema/notifikasi/pengaturan tidak ada di luar menu");
check(/aria-expanded="false"/.test(hdr) && /aria-label="Menu"/.test(hdr) && /aria-haspopup="menu"/.test(hdr), "hamburger punya aria-expanded & aria-label");
check(/study-menu-dot/.test(hdr), "titik notifikasi ada di tombol hamburger");

// isi menu
const L = { notif: "Notifikasi", settings: "Setting", themeDark: "Tema gelap", themeLight: "Tema terang" };
const rows = headerMenuRows({ theme: "light", unread: 3, hasNotif: true, hasSettings: true, pageItems: [["new-player", "Pemain baru"], ["rooms", "Kompetisi"]], labels: L });
check(rows.map((r) => r.act).join() === "menu-notif,new-player,rooms,menu-settings,menu-theme", `urutan menu: ${rows.map((r) => r.act).join()}`);
check(rows[0].count === 3, "baris Notifikasi memuat hitungan belum dibaca");
check(rows.at(-1).label === "Tema gelap" && rows.at(-1).icon === "moon", "terang -> tawarkan tema gelap (ikon bulan)");
const rd = headerMenuRows({ theme: "dark", hasNotif: false, hasSettings: false, labels: L });
check(rd.length === 1 && rd[0].label === "Tema terang" && rd[0].icon === "sun", "gelap -> tema terang (ikon matahari); tanpa notif/pengaturan hanya tema");
check(headerMenuRows({ theme: "light", unread: 0, hasNotif: true, labels: L })[0].count === 0, "tanpa belum dibaca, hitungan 0");
check(menuDot(2, true) && !menuDot(0, true) && !menuDot(5, false), "titik hanya bila ada belum dibaca dan notifikasi aktif");
check(countText(120) === "99+" && countText(4) === "4", "hitungan 99+");

// tema & bahasa
check(resolveTheme("dark", false) === "dark" && resolveTheme("light", true) === "light", "pilihan tersimpan menang");
check(resolveTheme(null, true) === "dark" && resolveTheme(null, false) === "light" && resolveTheme("aneh", true) === "dark", "bawaan ikut prefers-color-scheme");
check(nextTheme("dark") === "light" && nextTheme("light") === "dark" && nextLang("id") === "en" && nextLang("en") === "id", "ganti tema & bahasa");
const meta = { v: "", setAttribute(k, v) { this.v = v; } };
const root = { a: {}, setAttribute(k, v) { this.a[k] = v; } };
applyThemeTo({ documentElement: root, getElementById: () => meta }, "dark");
check(root.a["data-theme"] === "dark" && meta.v === "#000000" && themeColor("light") === "#ffffff", "applyThemeTo mengisi data-theme dan theme-color");
check(/localStorage\.getItem\("rh_theme"\)[\s\S]{0,300}data-theme/.test(html.split("</head>")[0]), "tema diterapkan di <head> sebelum render pertama");

// semua ikon header & menu memakai currentColor
const MENU_SVG = studySrc.match(/const MENU_SVG = '([^']+)'/)[1];
const BELL_SVG = studySrc.match(/const BELL_SVG = '([^']+)'/)[1];
const css = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const noHard = (s) => !/(?:fill|stroke)="#|(?:fill|stroke)="(?:black|white)"/.test(s);
check([ICON_MOON, ICON_SUN, ICON_SETTINGS, MENU_SVG, BELL_SVG].every(noHard), "ikon tanpa warna tetap");
check(/\.study-menu-icon \{[^}]*stroke: currentColor/.test(css) && /\.study-bell \{[^}]*stroke: currentColor/.test(css), "ikon hamburger & lonceng pakai stroke: currentColor");
check(/\.detail-topbar-row \.study-menu-btn[\s\S]{0,200}flex: none/.test(css) && /#screen-study \.detail-title \{[^}]*min-width: 0[^}]*text-overflow: ellipsis/.test(css), "tombol flex:none, judul min-width:0 + ellipsis");
check(/@media \(max-width: 640px\)[\s\S]{0,600}\.study-menu \{[\s\S]{0,200}position: fixed/.test(css), "di HP menu jadi panel dari kanan");
if (gagal) { console.log(`\n${gagal} tes GAGAL`); process.exit(1); }
console.log("\nSemua tes app-header lolos");
