// Membuka SAKTI di browser dan masuk (login). Captcha dan kode MFA TIDAK dipecahkan otomatis:
// gambar captcha dikirim ke Telegram, kamu membalas hurufnya; kode MFA juga kamu kirim lewat chat.
import path from "node:path";
import { findBrowser, launchBrowser } from "./browser.js";

const re = (s) => new RegExp(s, "i");
const CAPTCHA_HINT = re("captcha|kode ?keamanan|security ?code|verif|gambar");
const MFA_HINT = re("otp|mfa|token|authenticator|kode ?(verifikasi|otentikasi|autentikasi|6)|one.?time|\\bcode\\b");
const LOGIN_TEXT = re("^(login|log in|masuk|sign in)\\b");
const hay = (i) => `${i.name} ${i.eid} ${i.ph} ${i.label} ${i.cls} ${i.src}`;
const sel = (i) => `[data-agen="${i.id}"]`;

/** Dari hasil pindai halaman -> kolom-kolom formulir masuk (atau null bila tidak ada kolom sandi). */
export function pickLogin(items) {
  const pwIdx = items.findIndex((i) => i.kind === "sandi");
  if (pwIdx < 0) return null;
  const pw = items[pwIdx];
  const kolom = items.filter((i) => i.kind === "kolom");
  const before = kolom.filter((i) => items.indexOf(i) < pwIdx && !CAPTCHA_HINT.test(hay(i)));
  const user = before[before.length - 1] || null;
  const after = kolom.filter((i) => items.indexOf(i) > pwIdx);
  const captchaInput = after.find((i) => CAPTCHA_HINT.test(hay(i))) || after[0] || null;
  const gambar = items.filter((i) => i.kind === "gambar" && i.w >= 40 && i.w <= 450 && i.h >= 15 && i.h <= 200);
  let captchaImg = gambar.find((i) => /captcha/i.test(hay(i))) || null;
  if (!captchaImg && captchaInput) {
    // tidak ada petunjuk nama: ambil gambar yang letaknya paling dekat dengan kolom captcha (bukan menurut urutan di kode halaman)
    const mid = (i) => [i.left + i.w / 2, i.top + i.h / 2];
    const [cx, cy] = mid(captchaInput);
    const dekat = gambar.map((g) => ({ g, d: Math.hypot(mid(g)[0] - cx, mid(g)[1] - cy) })).filter((x) => x.d < 450).sort((a, b) => a.d - b.d);
    captchaImg = dekat[0]?.g || null;
  }
  const tombol = items.filter((i) => i.kind === "tombol" && items.indexOf(i) > pwIdx - 1);
  const submit = tombol.find((i) => i.type === "submit") || tombol.find((i) => LOGIN_TEXT.test(i.text)) || tombol.find((i) => /login|masuk|sign/i.test(i.text)) || null;
  return { user, pw, captchaInput: captchaImg ? captchaInput : captchaInput && CAPTCHA_HINT.test(hay(captchaInput)) ? captchaInput : null, captchaImg, submit };
}

const MFA_TEXT = re("multi.?factor|\\bMFA\\b|kode (otp|verifikasi|otentikasi|autentikasi)|authenticator|two.?factor|dua langkah");

/**
 * Kolom kode MFA + tombol kirimnya. Dua bentuk: halaman tersendiri (tanpa kolom sandi), atau jendela (modal) yang
 * muncul di atas halaman masuk yang masih terlihat di belakangnya (teks halaman memuat "Multifactor"/"MFA").
 */
export function pickMfa(items, text = "") {
  const tombol = items.filter((i) => i.kind === "tombol");
  const kolom = items.filter((i) => i.kind === "kolom");
  if (items.some((i) => i.kind === "sandi")) {
    if (!MFA_TEXT.test(text)) return null;
    const submit = tombol.find((i) => /verifikasi|verify/i.test(i.text)) || null;
    if (!submit) return null;
    // kolom yang paling dekat DI ATAS tombol "Verifikasi" = kolom di dalam jendela MFA (formulir login ada di belakang, lebih tinggi)
    const input = kolom.filter((k) => k.top <= submit.top + 4).sort((a, b) => submit.top - a.top - (submit.top - b.top))[0] || null;
    return input ? { input, submit } : null;
  }
  const adaTeks = MFA_TEXT.test(text);
  const input = kolom.find((i) => MFA_HINT.test(hay(i))) || (adaTeks && kolom.length === 1 ? kolom[0] : null); // satu kolom pencarian di beranda BUKAN kolom MFA
  if (!input) return null;
  const submit = tombol.find((i) => i.type === "submit") || tombol.find((i) => /verif|kirim|submit|lanjut|masuk|login|ok\b/i.test(i.text)) || null;
  return { input, submit };
}

export const ringkasItems = (items) =>
  items
    .map((i) => {
      const bits = [i.kind];
      for (const [k, v] of [["id", i.eid], ["name", i.name], ["type", i.type && i.type !== "text" ? i.type : ""], ["ph", i.ph], ["label", i.label], ["teks", i.text], ["src", i.src], ["class", i.cls]]) if (v) bits.push(`${k}=${JSON.stringify(String(v).slice(0, 60))}`);
      if (i.opts) bits.push(`opsi=${JSON.stringify(i.opts)}`);
      if (i.kosong === false) bits.push("(terisi)");
      return `${i.id}: ${bits.join(" ")}`;
    })
    .join("\n");

export function createSakti({ config, launch = launchBrowser, find = findBrowser, log = console }) {
  const url = config.saktiUrl || "https://sakti.kemenkeu.go.id/";
  let page = null;

  async function ensure() {
    if (page?.alive) return page;
    const exe = find(process.env);
    page = await launch({ exe, userDataDir: path.join(config.workdir, "_browser"), headless: config.saktiHeadless, url: "about:blank", log });
    return page;
  }

  const scan = async () => (await page.scan().catch(() => [])) || [];
  const errorText = async () => {
    const t = await page.visibleText(1500).catch(() => "");
    const m = /[^.!?]{0,80}(?:salah|gagal|tidak valid|tidak sesuai|invalid|incorrect|expired|kadaluarsa|captcha)[^.!?]{0,100}/i.exec(t);
    return m ? m[0].trim() : "";
  };

  const CLOSE_TEXT = re("^(tutup|close|ok|oke|mengerti|saya mengerti|setuju|x|×)$");
  /** Tutup jendela pengumuman/popup yang menutupi halaman (tombol bertuliskan Tutup/Close/OK). */
  async function tutupPopup() {
    for (let i = 0; i < 3; i++) {
      const items = await scan();
      const b = items.find((x) => x.kind === "tombol" && CLOSE_TEXT.test(x.text.trim()));
      if (!b) return i;
      await page.click(sel(b)).catch(() => {});
      await new Promise((r) => setTimeout(r, 700));
    }
    return 3;
  }

  async function diagnosa(io, judul) {
    const items = await scan();
    const info = await page.info().catch(() => ({}));
    const frames = await page.frames().catch(() => []);
    const teks = await page.visibleText(400).catch(() => "");
    await io.say(`${judul}\nAlamat: ${info.url || "?"}\nJudul: ${info.title || "?"}\n\nKolom/tombol yang terlihat:\n${ringkasItems(items) || "(tidak ada)"}\n\nBingkai (iframe): ${frames.length ? frames.map((f) => `${f.bisaDibaca ? "terbaca" : "TERKUNCI"} ${f.src}`).join(" | ") : "tidak ada"}\nTeks halaman: ${teks || "(kosong)"}`);
    await io.photo(await page.screenshot(), "Tampilan halaman saat ini");
  }

  return {
    get terbuka() {
      return !!page?.alive;
    },

    /** Buka halaman, isi nama pengguna & sandi dari .env, kirim captcha ke Telegram, minta kode MFA, lalu lapor hasil. */
    async masuk(io) {
      if (!config.saktiUser || !config.saktiPass) {
        await io.say("SAKTI_USER dan SAKTI_PASS belum diisi di berkas .env komputer ini (isi sendiri di sana; jangan kirim lewat chat). Sesudah itu kirim /ulang, lalu /sakti masuk.");
        return { ok: false };
      }
      await ensure();
      for (let attempt = 1; attempt <= 3; attempt++) {
        await io.say(attempt === 1 ? `🌐 Membuka ${url} …` : `🔁 Percobaan ${attempt} dari 3…`);
        await page.goto(url);
        for (let k = 0; k < 12 && !(await scan()).length; k++) await new Promise((r) => setTimeout(r, 1000)); // portal berbasis skrip: tunggu isinya muncul
        await tutupPopup();
        let items = await scan();
        let login = pickLogin(items);
        if (!login) {
          const entry = items.find((i) => i.kind === "tombol" && LOGIN_TEXT.test(i.text));
          if (entry) {
            await page.click(sel(entry)).catch(() => {});
            await page.settle(20_000);
            items = await scan();
            login = pickLogin(items);
          }
        }
        if (!login) {
          const t = await page.visibleText(800).catch(() => "");
          if (/logout|keluar|beranda|dashboard/i.test(t) && !items.some((i) => i.kind === "sandi")) {
            await io.say("Sepertinya kamu sudah masuk (sesi lama masih aktif).");
            await io.photo(await page.screenshot(), "Halaman setelah masuk");
            return { ok: true };
          }
          await diagnosa(io, "⚠️ Formulir masuk tidak kukenali. Kirim pesan di bawah ini ke pembuat agen supaya penyesuaiannya bisa dibuat.");
          return { ok: false };
        }
        if (!login.user || !login.submit) {
          await diagnosa(io, "⚠️ Kolom nama pengguna atau tombol masuk belum bisa kupastikan. Kirim pesan di bawah ke pembuat agen.");
          return { ok: false };
        }
        await page.fill(sel(login.user), config.saktiUser);
        await page.fill(sel(login.pw), config.saktiPass);
        if (login.captchaImg && login.captchaInput) {
          const c = login.captchaImg;
          await io.photo(await page.shotOf(sel(c)), `Captcha SAKTI (elemen ${c.tag}${c.eid ? ` #${c.eid}` : ""} ${c.w}×${c.h})`);
          await io.photo(await page.screenshot(), "Halaman login saat ini (cadangan: bila potongan di atas keliru, baca captcha dari sini)");
          const ans = await io.ask("Ketik huruf/angka pada gambar captcha. Balas \"ulang\" untuk gambar baru, atau /batal untuk berhenti.");
          if (ans == null) {
            await io.say("Dibatalkan. Peramban dibiarkan terbuka; /sakti tutup untuk menutupnya.");
            return { ok: false };
          }
          if (/^ulang$/i.test(ans.trim())) continue;
          await page.fill(sel(login.captchaInput), ans.trim());
        }
        await page.click(sel(login.submit)).catch(async () => page.press("Enter"));
        await page.settle(25_000);
        // tunggu hasilnya: jendela/halaman MFA muncul, atau halaman masuk hilang (kadang lewat ajax, beberapa detik)
        let mfa = null;
        for (let k = 0; k < 12; k++) {
          await new Promise((r) => setTimeout(r, 1000));
          items = await scan();
          mfa = pickMfa(items, await page.visibleText(2500).catch(() => ""));
          if (mfa || (items.length && !items.some((i) => i.kind === "sandi"))) break;
        }
        if (mfa) {
          await io.photo(await page.screenshot(), "Halaman verifikasi (MFA)");
          const code = await io.ask("Masukkan kode MFA (angka dari aplikasi autentikator/pesan). /batal untuk berhenti.");
          if (code == null) {
            await io.say("Dibatalkan. Peramban dibiarkan terbuka; /sakti tutup untuk menutupnya.");
            return { ok: false };
          }
          await page.fill(sel(mfa.input), code.replace(/\s+/g, ""));
          if (mfa.submit) await page.click(sel(mfa.submit)).catch(() => page.press("Enter"));
          else await page.press("Enter");
          await page.settle(25_000);
          // tunggu sampai jendela MFA dan halaman masuk hilang (berhasil) atau tetap ada (kode ditolak)
          for (let k = 0; k < 12; k++) {
            await new Promise((r) => setTimeout(r, 1000));
            items = await scan();
            if (items.length && !items.some((i) => i.kind === "sandi") && !pickMfa(items, await page.visibleText(2500).catch(() => ""))) break;
          }
        }

        if (items.some((i) => i.kind === "sandi") && pickMfa(items, await page.visibleText(2500).catch(() => ""))) {
          const err = await errorText();
          await io.say(`⚠️ Kode MFA belum diterima${err ? `: "${err}"` : ""}. Kirim /sakti masuk untuk mengulang.`);
          await io.photo(await page.screenshot(), "Halaman saat ini");
          return { ok: false };
        }
        if (items.some((i) => i.kind === "sandi")) {
          const err = await errorText();
          await io.say(`⚠️ Masih di halaman masuk${err ? `: "${err}"` : ""}.`);
          await io.photo(await page.screenshot(), "Halaman saat ini");
          if (/captcha|gambar|kode/i.test(err) && attempt < 3) continue;
          return { ok: false };
        }
        if (pickMfa(items, await page.visibleText(2500).catch(() => ""))) {
          const err = await errorText();
          await io.say(`⚠️ Kode MFA belum diterima${err ? `: "${err}"` : ""}. Kirim /sakti masuk untuk mengulang.`);
          await io.photo(await page.screenshot(), "Halaman saat ini");
          return { ok: false };
        }
        const info = await page.info().catch(() => ({}));
        await io.say(`✅ Sudah masuk SAKTI.\n${info.title || ""}\n${info.url || ""}\n\nSelanjutnya: /sakti halaman untuk melihat isi halaman (dipakai menyiapkan langkah perekaman).`);
        await io.photo(await page.screenshot(), "Halaman setelah masuk");
        return { ok: true };
      }
      await io.say("Gagal masuk setelah 3 percobaan.");
      return { ok: false };
    },

    /** Foto + daftar kolom/tombol halaman yang sedang terbuka. */
    async halaman(io) {
      if (!page?.alive) return void (await io.say("Peramban belum dibuka. Kirim /sakti masuk dulu."));
      await diagnosa(io, "📄 Isi halaman sekarang");
    },

    async foto(io) {
      if (!page?.alive) return void (await io.say("Peramban belum dibuka. Kirim /sakti masuk dulu."));
      await io.photo(await page.screenshot(), "Tampilan sekarang");
    },

    async tutup() {
      const was = !!page?.alive;
      if (page) await page.close().catch(() => {});
      page = null;
      return was;
    }
  };
}
