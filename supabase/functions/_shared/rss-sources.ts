// Daftar sumber RSS. Bebas ditambah/dikurangi sesuai selera —
// tinggal edit array di bawah, tidak perlu ubah kode lain.
//
// category: "indonesia" | "dunia" — dipakai untuk mengelompokkan
// ringkasan menjadi 2 bagian di halaman depan.

export interface FeedSource {
  name: string;
  url: string;
  category: "indonesia" | "dunia";
}

export const FEED_SOURCES: FeedSource[] = [
  { name: "ANTARA News - Terkini", url: "https://www.antaranews.com/rss/terkini.xml", category: "indonesia" },
  { name: "ANTARA News - Politik", url: "https://www.antaranews.com/rss/politik.xml", category: "indonesia" },
  { name: "ANTARA News - Ekonomi", url: "https://www.antaranews.com/rss/ekonomi.xml", category: "indonesia" },
  { name: "ANTARA News - Dunia", url: "https://www.antaranews.com/rss/dunia.xml", category: "dunia" },
  { name: "BBC News - World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", category: "dunia" },
  { name: "Al Jazeera - All News", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "dunia" }
];

// Maksimum berita yang diambil per sumber, supaya prompt ke LLM tidak kepanjangan.
export const MAX_ITEMS_PER_FEED = 12;

// Hanya ambil berita yang terbit dalam N jam terakhir (buffer di atas 24 jam
// untuk jaga-jaga kalau feed telat update / cron sedikit meleset).
export const MAX_AGE_HOURS = 30;
