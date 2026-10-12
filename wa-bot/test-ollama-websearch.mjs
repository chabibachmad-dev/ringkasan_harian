// Skrip DIAGNOSTIK berdiri sendiri -- jalankan ini SEBELUM pm2 restart
// wa-bot, buat memastikan 2 komponen baru (Ollama + pencarian web) beneran
// nyambung di server ini, SEBELUM dipakai beneran buat auto-reply WA.
//
// Cara pakai:
//   cd wa-bot
//   npm install          # nambah dependency baru "cheerio"
//   node test-ollama-websearch.mjs
//
// Kalau kedua tes di bawah SUKSES, aman lanjut ke:
//   pm2 restart wa-bot
//   pm2 logs wa-bot
import * as cheerio from "cheerio";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";

async function testOllama() {
  console.log(`\n=== TES 1: Ollama (${OLLAMA_BASE_URL}, model ${OLLAMA_MODEL}) ===`);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: "Jawab singkat saja: 2+2 berapa?" }],
        stream: false
      })
    });
    if (!res.ok) {
      console.log(`❌ GAGAL -- status ${res.status}: ${(await res.text()).slice(0, 300)}`);
      console.log(`   Cek: "ollama serve" jalan? "ollama pull ${OLLAMA_MODEL}" sudah dijalankan?`);
      return;
    }
    const data = await res.json();
    console.log(`✅ SUKSES -- balasan model: "${data?.message?.content?.trim()?.slice(0, 200)}"`);
  } catch (err) {
    console.log(`❌ GAGAL -- tidak bisa hubungi Ollama sama sekali: ${err.message}`);
    console.log(`   Cek: apakah "ollama serve" jalan di server ini? Coba "ollama list" dulu di terminal lain.`);
  }
}

async function testWebSearch() {
  console.log(`\n=== TES 2: Pencarian web (Bing) ===`);
  // CATATAN: awalnya dites pakai DuckDuckGo, tapi ketauan (lewat debugging
  // bareng user) provider internet user MEMBLOKIR html.duckduckgo.com di
  // level jaringan (muncul error ERR_TLS_CERT_ALTNAME_INVALID dgn
  // sertifikat milik domain ISP) -- Bing & Google dites bisa diakses
  // normal, jadi dipakai Bing (scraping Google lebih berisiko kena
  // CAPTCHA/block krn lebih agresif deteksi bot drpd Bing).
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent("cuaca Yogyakarta hari ini")}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });
    if (!res.ok) {
      console.log(`❌ GAGAL -- status HTTP ${res.status}. Cek koneksi internet laptop ini.`);
      return;
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    $("li.b_algo").each((_, el) => {
      if (results.length >= 3) return;
      const title = $(el).find("h2").text().trim();
      let snippet = $(el).find(".b_caption p").first().text().trim();
      if (!snippet) snippet = $(el).find("[class^='b_lineclamp']").first().text().trim();
      if (!snippet) snippet = $(el).find("p").first().text().trim();
      if (title || snippet) results.push({ title, snippet });
    });
    if (results.length === 0) {
      console.log("⚠️  Request SUKSES (HTTP 200) tapi 0 hasil ke-parse -- kemungkinan struktur HTML");
      console.log("   Bing berubah, atau halamannya minta verifikasi/captcha. Auto-reply tetap AMAN");
      console.log("   jalan (cuma tanpa hasil web), tapi lihat potongan HTML di bawah buat lapor balik:");
      console.log("   --- 500 karakter pertama HTML yang diterima ---");
      console.log(html.slice(0, 500).replace(/\s+/g, " "));
      console.log("   -----------------------------------------------");
      return;
    }
    console.log(`✅ SUKSES -- dapat ${results.length} hasil, contoh:`);
    for (const r of results) console.log(`   - ${r.title}: ${r.snippet.slice(0, 100)}`);
  } catch (err) {
    console.log(`❌ GAGAL -- ${err.cause?.code || err.message}`);
  }
}

await testOllama();
await testWebSearch();
console.log("\nSelesai.");
