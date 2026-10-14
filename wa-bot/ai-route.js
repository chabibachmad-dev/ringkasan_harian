// Urutan penyedia AI untuk balasan WhatsApp (chat pribadi + grup), dengan DUA jalur:
//   santai : obrolan biasa (tanpa angka/aturan/dokumen/pencarian web) -> cepat dulu (bawaan: Groq > Gemini > OpenRouter > Ollama)
//   akurat : pertanyaan angka, aturan, dokumen, atau butuh internet    -> Gemini dulu (bawaan: Gemini > Groq > OpenRouter > Ollama)
// Tiap penyedia dihabiskan dulu (rotasi key/model di dalamnya) sebelum pindah ke penyedia berikutnya.
// Ollama (model lokal) SELALU di ujung: lambat, dan hanya dipakai untuk pertanyaan tanpa angka (aturan itu ada di index.js).
// Urutan bisa diubah dari Telegram/WhatsApp (/urutan), disimpan di tabel bot_state -- tidak perlu menyentuh .env.

export const PROVIDER_NAMES = ["groq", "gemini", "openrouter", "ollama"];
export const ROUTE_NAMES = ["santai", "akurat"];
export const DEFAULT_ROUTES = {
  santai: ["groq", "gemini", "openrouter", "ollama"],
  akurat: ["gemini", "groq", "openrouter", "ollama"]
};
export const STATE_KEY = "ai_route";

const ROUTE_ALIASES = {
  santai: "santai",
  casual: "santai",
  biasa: "santai",
  akurat: "akurat",
  accurate: "akurat",
  penting: "akurat",
  semua: "all",
  all: "all",
  keduanya: "all"
};

/** Rapikan daftar: nama dikenal saja, tanpa duplikat, Ollama dipindah ke ujung. Mengembalikan array (bisa kosong). */
export function normalizeOrder(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const name = String(raw ?? "").trim().toLowerCase();
    if (!PROVIDER_NAMES.includes(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  if (out.includes("ollama")) return [...out.filter((n) => n !== "ollama"), "ollama"];
  return out;
}

/** "groq, gemini > openrouter" -> { order, unknown, movedOllama } */
export function parseOrderText(text) {
  const parts = String(text ?? "")
    .toLowerCase()
    .split(/[\s,;>→/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = parts.filter((p) => !PROVIDER_NAMES.includes(p));
  const order = normalizeOrder(parts);
  const known = parts.filter((p) => PROVIDER_NAMES.includes(p));
  const movedOllama = known.includes("ollama") && known.indexOf("ollama") !== known.length - 1 && known.lastIndexOf("ollama") !== known.length - 1;
  return { order, unknown, movedOllama };
}

/** Pesan baru termasuk jalur mana. Angka/aturan/dokumen/internet = "akurat"; sisanya "santai". */
export function classifyRoute({ text = "", pinnedDocs = false, docChunks = 0, webQuery = "", accurateRe = null } = {}) {
  if (pinnedDocs || Number(docChunks) > 0 || String(webQuery || "").trim()) return "akurat";
  // ID mention WhatsApp (@268813530575034) berisi angka tapi bukan "angka penting".
  const clean = String(text ?? "")
    .replace(/@\d{5,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (accurateRe && accurateRe.test(clean)) return "akurat";
  return "santai";
}

/** "/urutan ..." (alias /route) -> { arg } atau null. Boleh diawali "!" seperti perintah lain. */
export function parseRouteCommand(text) {
  const m = String(text ?? "")
    .trim()
    .match(/^[/!](urutan|route|rute)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return m ? { arg: String(m[2] || "").trim() } : null;
}

const label = (order) => order.map((n) => (n === "ollama" ? "Ollama (lokal)" : n[0].toUpperCase() + n.slice(1))).join(" > ");

/**
 * state: { get(key)->string|null, set(key, string) } (bot_state). available(name)->boolean menandai penyedia yang punya key / aktif.
 */
export function createAiRoute({ state = null, available = () => true, log = console } = {}) {
  let routes = { santai: [...DEFAULT_ROUTES.santai], akurat: [...DEFAULT_ROUTES.akurat] };

  const sanitize = (r) => {
    const out = { santai: [...DEFAULT_ROUTES.santai], akurat: [...DEFAULT_ROUTES.akurat] };
    for (const name of ROUTE_NAMES) {
      const o = normalizeOrder(r?.[name]);
      if (o.some((n) => n !== "ollama")) out[name] = o; // minimal satu penyedia internet
    }
    return out;
  };

  async function load() {
    if (!state) return routes;
    try {
      const raw = await state.get(STATE_KEY);
      if (raw) routes = sanitize(JSON.parse(raw));
    } catch (e) {
      log.warn?.(`🔀 [Urutan AI] gagal membaca pengaturan tersimpan, pakai bawaan: ${e instanceof Error ? e.message : e}`);
    }
    return routes;
  }

  async function save() {
    if (state) await state.set(STATE_KEY, JSON.stringify(routes));
  }

  const orderFor = (route) => [...(routes[route === "santai" ? "santai" : "akurat"])];

  function describe() {
    return ROUTE_NAMES.map((r) => `${r}: ${orderFor(r).join(">")}`).join(" | ");
  }

  function render(extra = "") {
    const line = (r) => {
      const o = orderFor(r);
      const miss = o.filter((n) => !available(n));
      return `• *${r}*: ${label(o)}${miss.length ? `\n   ⚠️ belum aktif (dilewati): ${miss.join(", ")}` : ""}`;
    };
    return [
      extra,
      "🔀 *Urutan AI untuk balasan WhatsApp & grup*",
      line("santai"),
      line("akurat"),
      "",
      "_santai_ = obrolan biasa. _akurat_ = pertanyaan angka, aturan, dokumen, atau yang butuh internet. Tiap penyedia dihabiskan dulu (rotasi key) sebelum pindah ke yang berikutnya.",
      "",
      "Ubah: `/urutan santai groq,gemini,openrouter,ollama`",
      "`/urutan akurat gemini,groq,openrouter` (tanpa ollama = tanpa cadangan lokal)",
      "`/urutan semua gemini,groq` (jalur santai dan akurat sekaligus)",
      "`/urutan reset` (kembali ke bawaan)",
      "Penyedia: groq, gemini, openrouter, ollama. Ollama otomatis ditaruh paling akhir."
    ]
      .filter((x) => x !== "")
      .join("\n");
  }

  async function handle(arg = "") {
    const text = String(arg || "").trim();
    if (!text) return render();
    if (/^(reset|bawaan|default)$/i.test(text)) {
      routes = { santai: [...DEFAULT_ROUTES.santai], akurat: [...DEFAULT_ROUTES.akurat] };
      await save();
      return render("✅ Urutan dikembalikan ke bawaan.\n");
    }
    const m = text.match(/^(\S+)\s+([\s\S]+)$/);
    const which = m ? ROUTE_ALIASES[m[1].toLowerCase()] : null;
    if (!which) {
      return `Format: /urutan <santai|akurat|semua> <penyedia,penyedia,...>\nContoh: /urutan santai groq,gemini,openrouter,ollama\n(/urutan saja = lihat urutan sekarang)`;
    }
    const { order, unknown, movedOllama } = parseOrderText(m[2]);
    if (unknown.length) return `Penyedia tidak dikenal: ${unknown.join(", ")}.\nYang ada: ${PROVIDER_NAMES.join(", ")}.`;
    if (!order.some((n) => n !== "ollama")) return "Isi minimal satu penyedia internet (groq, gemini, atau openrouter); Ollama saja tidak cukup.";
    const targets = which === "all" ? ROUTE_NAMES : [which];
    for (const t of targets) routes[t] = [...order];
    await save();
    return render(`✅ Urutan ${which === "all" ? "santai dan akurat" : which} diperbarui.${movedOllama ? " (Ollama dipindah ke paling akhir.)" : ""}\n`);
  }

  return { load, orderFor, describe, handle, render };
}
