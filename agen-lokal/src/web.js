// Pencarian web gratis tanpa kunci (DuckDuckGo HTML) dan pembacaan halaman web. Semua alamat lewat pagar anti-SSRF.
import { checkPublicUrl, SafetyError } from "./safety.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AgenLokal/1.0";
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** HTML halaman -> teks bacaan (tanpa skrip/gaya/menu). */
export function htmlToText(html) {
  return decode(
    String(html)
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Halaman hasil DuckDuckGo HTML -> [{title,url,snippet}] */
export function parseDuckDuckGo(html) {
  const out = [];
  const blocks = String(html).split(/<div class="[^"]*\bresult\b[^"]*"/).slice(1);
  for (const b of blocks) {
    const a = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a) continue;
    let url = decode(a[1]);
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // iklan
    const sn = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    out.push({ title: htmlToText(a[2]).slice(0, 160), url, snippet: sn ? htmlToText(sn[1]).slice(0, 300) : "" });
  }
  return out;
}

export function createWeb({ fetchImpl = fetch, lookup, maxBytes = 1_500_000, timeoutMs = 20_000 } = {}) {
  async function getText(startUrl, { post = null } = {}) {
    let url = startUrl;
    for (let hop = 0; hop < 5; hop++) {
      const u = await checkPublicUrl(url, lookup ? { lookup } : {});
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(u.href, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": UA, accept: "text/html,text/plain;q=0.9,*/*;q=0.5", "accept-language": "id,en;q=0.8" }, ...(post && hop === 0 ? { method: "POST", body: post, headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" } } : {}) });
      } catch (e) {
        throw new Error(e?.name === "AbortError" ? "Situs terlalu lama menjawab." : `Gagal terhubung ke ${u.hostname}.`);
      } finally {
        clearTimeout(timer);
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error("Pengalihan tanpa tujuan.");
        url = new URL(loc, u).href;
        continue;
      }
      if (!res.ok) throw new Error(`Situs menjawab galat ${res.status}.`);
      const type = res.headers.get("content-type") || "";
      if (!/text\/|json|xml/i.test(type)) throw new Error(`Jenis konten ${type || "tak dikenal"} tidak bisa dibaca (hanya teks/HTML).`);
      const buf = Buffer.from(await res.arrayBuffer()).subarray(0, maxBytes);
      return { body: buf.toString("utf8"), type, url: u.href };
    }
    throw new SafetyError("Terlalu banyak pengalihan.");
  }
  return {
    async search(query, { max = 6 } = {}) {
      const q = String(query ?? "").trim().slice(0, 300);
      if (!q) throw new Error("Kata pencarian kosong.");
      const r = await getText("https://html.duckduckgo.com/html/", { post: `q=${encodeURIComponent(q)}&kl=id-id` });
      const hits = parseDuckDuckGo(r.body).slice(0, max);
      if (!hits.length) throw new Error("Tidak ada hasil (atau DuckDuckGo sedang membatasi permintaan; coba lagi nanti).");
      return hits;
    },
    async fetchPage(url, { maxChars = 6000 } = {}) {
      const r = await getText(url);
      const text = /html/i.test(r.type) ? htmlToText(r.body) : r.body;
      return { url: r.url, text: text.slice(0, maxChars), truncated: text.length > maxChars };
    }
  };
}
