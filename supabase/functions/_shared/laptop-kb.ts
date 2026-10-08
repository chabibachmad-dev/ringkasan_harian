// Meminta bot di laptop mencarikan potongan Dokumen Pengetahuan dari indeks lokalnya
// (lihat migrations/0019_kb_retrievals.sql dan wa-bot/kb-retrieval.js).
//
// Edge Function tidak bisa menjangkau laptop, jadi: taruh baris 'pending' di kb_retrievals, lalu
// tunggu bot menulis hasilnya. Bila laptop mati / tabel belum ada / waktu habis -> { ok: false }
// dan pemanggil memakai pencarian lama di salinan cloud.

export interface LaptopChunk {
  title: string;
  page: number | null;
  text: string;
  score: number;
}

export type LaptopRetrieval =
  | { ok: true; chunks: LaptopChunk[]; ms: number; docs: number }
  | { ok: false; reason: string };

// deno-lint-ignore no-explicit-any
type Db = any;

// Bot dianggap hidup bila denyut agent_worker_status < 60 detik lalu (sama seperti pemeriksaan Ollama).
const BOT_ALIVE_MS = 60_000;

export async function requestLaptopChunks(
  db: Db,
  opts: { chatDate: string; query: string; budgetChars?: number; maxChunks?: number; timeoutMs?: number; pollMs?: number }
): Promise<LaptopRetrieval> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const pollMs = opts.pollMs ?? 700;
  const query = (opts.query || "").trim();
  if (!query) return { ok: false, reason: "kueri kosong" };

  // 1. Bot hidup dan punya dokumen terindeks?
  const { data: st } = await db.from("agent_worker_status").select("last_seen, extra").eq("id", "ollama").maybeSingle();
  const lastSeen = st?.last_seen ? new Date(st.last_seen as string).getTime() : 0;
  if (!lastSeen || Date.now() - lastSeen > BOT_ALIVE_MS) return { ok: false, reason: "bot di laptop tidak aktif" };
  const kbDocs = Number(st?.extra?.kb?.docs);
  if (Number.isFinite(kbDocs) && kbDocs === 0) return { ok: false, reason: "indeks dokumen di laptop kosong" };

  // 2. Taruh permintaan.
  const { data: row, error } = await db
    .from("kb_retrievals")
    .insert({
      chat_date: opts.chatDate,
      question: query.slice(0, 600),
      budget_chars: opts.budgetChars ?? 12000,
      max_chunks: opts.maxChunks ?? 10
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, reason: `gagal membuat permintaan (${error?.message ?? "?"})` };
  const id = row.id as string;

  // 3. Tunggu jawaban bot.
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    const { data, error: e2 } = await db.from("kb_retrievals").select("status, chunks, stats, error").eq("id", id).maybeSingle();
    if (e2) continue;
    if (data?.status === "done") {
      const chunks = Array.isArray(data.chunks) ? (data.chunks as LaptopChunk[]) : [];
      return { ok: true, chunks, ms: Date.now() - t0, docs: Number(data.stats?.docs ?? 0) };
    }
    if (data?.status === "failed") return { ok: false, reason: `bot gagal mencari (${data.error ?? "?"})` };
  }
  // Waktu habis: tandai supaya bot tidak mengerjakannya nanti-nanti.
  await db.from("kb_retrievals").update({ status: "failed", error: "kedaluwarsa (Edge Function berhenti menunggu)" }).eq("id", id).in("status", ["pending", "running"]);
  return { ok: false, reason: "bot tidak menjawab tepat waktu" };
}
