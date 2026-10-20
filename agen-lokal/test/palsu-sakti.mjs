import http from "node:http";
// Situs tiruan: login (nama, sandi, captcha gambar) -> halaman MFA -> beranda
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAFAAAAAeCAIAAAB5pMTHAAAAHElEQVR4nGP4TyFgGDVg1IBRA0YNGDVg1IBBAwAAGp7wH5JQqBkAAAAASUVORK5CYII=", "base64");
export function start(port) {
  const state = { loggedIn: false, mfaOk: false, captcha: "AB12", log: [] };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const html = (b) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset=utf-8><title>SAKTI tiruan</title>${b}`); };
    if (u.pathname === "/captcha.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(png); }
    if (u.pathname === "/login" && req.method === "POST") {
      let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
        const p = new URLSearchParams(body); state.log.push(Object.fromEntries(p));
        if (p.get("username") === "199001012020011001" && p.get("password") === "rahasia" && p.get("captcha") === state.captcha) { res.writeHead(302, { location: "/mfa" }); return res.end(); }
        res.writeHead(302, { location: "/?err=1" }); res.end();
      }); return;
    }
    if (u.pathname === "/mfa" && req.method === "POST") {
      let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
        const p = new URLSearchParams(body); state.log.push(Object.fromEntries(p));
        if (p.get("otp") === "123456") { state.mfaOk = true; res.writeHead(302, { location: "/beranda" }); return res.end(); }
        res.writeHead(302, { location: "/mfa?err=1" }); res.end();
      }); return;
    }
    if (u.pathname === "/mfa") return html(`<h2>Verifikasi dua langkah</h2>${u.searchParams.get("err") ? "<p>Kode tidak valid</p>" : ""}<form method=post action=/mfa><input name=otp placeholder="Kode OTP 6 digit"><button type=submit>Verifikasi</button></form>`);
    if (u.pathname === "/beranda") return html(`<h1>Beranda SAKTI</h1><a href=/keluar>Keluar</a>`);
    if (state.mfaOk && u.pathname === "/") return html(`<h1>Beranda SAKTI</h1><a href=/keluar>Keluar</a>`);
    // Mirip portal asli: pengumuman menutupi halaman (tombol "Tutup" berupa <span>), formulir ada di dalam iframe
    const form = `<h2>Selamat datang</h2>${u.searchParams.get("err") ? "<p>Captcha atau sandi salah</p>" : ""}<form method=post action=/login target=_top><label for=u>Nama pengguna</label><input id=u name=username><label for=p>Kata sandi</label><input id=p type=password name=password><img src=/captcha.png alt=captcha id=cap><input name=captcha placeholder="Masukkan captcha"><button type=submit>Login</button></form>`;
    const popup = state.popup === false ? "" : `<div id=pop style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99;display:flex;align-items:center;justify-content:center"><div style="background:#fff;padding:20px"><b>PENGUMUMAN</b><p>Tidak ada gratifikasi</p>${state.popup === "tanpa-tutup" ? "" : `<span style="cursor:pointer;background:#37c;color:#fff;padding:6px 12px" onclick="document.getElementById('pop').remove()">Tutup</span>`}</div></div>`;
    html(`${popup}<iframe style="width:600px;height:400px;border:0" srcdoc='${form.replace(/'/g, "&#39;")}'></iframe>`);
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r({ srv, state })));
}
