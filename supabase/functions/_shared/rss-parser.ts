// Parser RSS 2.0 minimal tanpa dependency eksternal.
// Cukup untuk feed standar seperti BBC, Al Jazeera, ANTARA News.
// Kalau suatu saat butuh dukungan Atom/format lain yang lebih rumit,
// ganti isi fungsi parseRss dengan library XML (mis. "jsr:@libs/xml").

export interface RawItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/<[^>]+>/g, "") // buang tag HTML yang kadang nyelip di <description>
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

export function parseRss(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    // Beberapa feed (Atom-ish) menaruh URL di atribut href, bukan isi tag.
    if (!link) {
      const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
      if (hrefMatch) link = hrefMatch[1];
    }
    const description = extractTag(block, "description") || extractTag(block, "summary");
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "published") || null;

    if (title && link) {
      items.push({ title, link, description, pubDate: pubDate || null });
    }
  }

  return items;
}

export async function fetchFeed(url: string, timeoutMs = 15000): Promise<RawItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Sejumlah situs berita menolak request tanpa User-Agent yang wajar.
        "User-Agent": "Mozilla/5.0 (compatible; RingkasanHarianBot/1.0; +https://github.com/)"
      }
    });
    if (!res.ok) {
      console.error(`Gagal fetch feed ${url}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return parseRss(xml);
  } catch (err) {
    console.error(`Error fetch/parse feed ${url}:`, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
