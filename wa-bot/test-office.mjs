// Tes Kantor AI: logika murni (office-core.ts), pemancar bot (office-feed.js), dan keselarasan keduanya. Jalankan: node test-office.mjs
import assert from "node:assert/strict";
import * as core from "../supabase/functions/_shared/office-core.ts";
import { redact, toRow, chatLabel, reasonText, aiReason, ollamaReason, ollamaJobLabel, officeVideoStages, createOfficeFeed, readOfficeConfig, WHO, KINDS, ITEMS } from "./office-feed.js";

let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || n++;
const silent = { log() {}, warn() {}, error() {} };

// --- redact
assert.equal(redact("hubungi +62 812-3456-7890 ya"), "hubungi [angka] ya");
assert.equal(redact("lihat https://contoh.id/a?b=1 dong"), "lihat [tautan] dong");
assert.equal(redact("kirim ke budi@mail.com"), "kirim ke [surel]");
assert.equal(redact("a\n\nb\t c"), "a b c");
assert.equal(redact("x".repeat(300)).length, 120);
assert.ok(redact("x".repeat(300)).endsWith("…"));
assert.equal(redact(null), "");
ok("redact: nomor/tautan/surel/spasi/panjang");

// --- keselarasan dengan versi Edge Function
const samples = ["halo +62 812 3456 7890", "http://a.b/c lalu b@c.de", "  spasi   banyak\n baris ", "y".repeat(500), "Rp 1.500.000 dibayar", "12345678 87654321"];
for (const s of samples) assert.equal(redact(s), core.redact(s), `redact beda untuk: ${s.slice(0, 20)}`);
assert.deepEqual(WHO, [...core.WHO]);
assert.deepEqual(KINDS, [...core.KINDS]);
assert.deepEqual(ITEMS, [...core.ITEMS]);
ok("redact/WHO/KINDS/ITEMS sama dengan office-core.ts");

const evs = [
  { who: "ayyubi", kind: "work", text: "Menyusun", progress: 40.6 },
  { who: "video", kind: "handoff", text: "Video jadi", to: "ayyubi", item: "video" },
  { who: "video", kind: "work", text: "x", to: "ayyubi", item: "video" },
  { who: "gambar", kind: "progress", text: "g", progress: 999 },
  { who: "suara", kind: "done", text: "s", progress: "" }
];
for (const e of evs) {
  const a = toRow(e);
  const b = core.cleanEvent(e).row;
  assert.deepEqual(a, b, JSON.stringify(e));
}
assert.equal(toRow({ who: "video", kind: "work", text: "x", to: "ayyubi", item: "video" }).to_who, null);
assert.equal(toRow({ who: "gambar", kind: "progress", progress: 999 }).progress, 100);
assert.equal(toRow({ who: "hacker", kind: "work" }), null);
assert.equal(toRow({ who: "ayyubi", kind: "meledak" }), null);
assert.equal(toRow(null), null);
ok("toRow sama dengan cleanEvent (progress, handoff hanya untuk kind handoff)");

// --- cleanEvent: izin hanya untuk "wait" dengan id sah
const w = core.cleanEvent({ who: "agen", kind: "wait", text: "Menunggu", approval: { id: "izin-abc123", detail: "Hapus C:\\Temp\\a.txt  \n baru" } });
assert.equal(w.approval.id, "izin-abc123");
assert.equal(w.approval.detail, "Hapus C:\\Temp\\a.txt baru");
assert.equal(w.row.approval_id, "izin-abc123");
assert.equal(core.cleanEvent({ who: "agen", kind: "wait", approval: { id: "x y" } }).approval, null);
assert.equal(core.cleanEvent({ who: "agen", kind: "work", approval: { id: "izin-abc123", detail: "d" } }).approval, null);
ok("cleanEvent: izin hanya untuk kind wait dengan id sah");

// --- presenceView & livePending
const T = Date.parse("2026-10-18T10:00:00Z");
const pv = core.presenceView(
  [
    { who: "ayyubi", seen_at: new Date(T - 20_000).toISOString(), detail: "ok" },
    { who: "agen", seen_at: new Date(T - 200_000).toISOString() },
    { who: "asing", seen_at: new Date(T).toISOString() }
  ],
  T
);
assert.equal(pv.length, 2);
assert.equal(pv.find((p) => p.who === "ayyubi").online, true);
assert.equal(pv.find((p) => p.who === "agen").online, false);
assert.equal(pv.find((p) => p.who === "agen").ageSec, 200);
const lp = core.livePending(
  [
    { id: "a", status: "pending", created_at: new Date(T - 60_000).toISOString() },
    { id: "b", status: "pending", created_at: new Date(T - 16 * 60_000).toISOString() },
    { id: "c", status: "approved", created_at: new Date(T - 1000).toISOString() }
  ],
  T
);
assert.deepEqual(lp.map((x) => x.id), ["a"]);
assert.equal(core.cutoffIso(T, 3), "2026-10-15T10:00:00.000Z");
ok("presenceView (90 dtk) & livePending (15 menit) & cutoffIso");

// --- chatLabel (privasi)
assert.equal(chatLabel("1203@g.us", "Keluarga Besar Pak Haji Slamet Riyadi Karya"), "grup Keluarga Besar Pak Haji Sla…");
assert.equal(chatLabel("1203@g.us", ""), "sebuah grup");
assert.equal(chatLabel("62812345@s.whatsapp.net", "Budi"), "chat pribadi");
ok("chatLabel: grup dipotong, chat pribadi disamarkan");

assert.equal(reasonText("quota"), "Kuota habis");
assert.equal(reasonText("aneh"), "Gagal dikerjakan");
assert.equal(aiReason({ allKeysExhausted: true }), "Kuota AI habis");
assert.equal(aiReason({ status: 503 }), "AI sedang sibuk");
assert.equal(aiReason(new Error("Request timed out")), "AI terlalu lama menjawab");
assert.equal(aiReason(new Error("rahasia: kunci sk-123")), "Gagal menyusun balasan");
ok("alasan galat singkat (tanpa membocorkan pesan galat mentah)");

assert.equal(ollamaReason(new Error("connect ECONNREFUSED 127.0.0.1:11434")), "Ollama tidak aktif");
assert.equal(ollamaReason(new Error("Ollama timeout setelah 90000 ms")), "Model lokal terlalu lama");
assert.equal(ollamaReason(new Error("rahasia /home/budi/x")), "Model lokal gagal");
assert.equal(ollamaJobLabel("wa-reply"), "Menyusun balasan WhatsApp");
assert.equal(ollamaJobLabel("owner-lokal"), "Mengobrol dengan pemilik");
assert.equal(ollamaJobLabel("tak-dikenal"), "Menjawab dengan model lokal");
assert.equal(ollamaJobLabel(undefined), "Menjawab dengan model lokal");
ok("pekerjaan & galat Ollama -> label Agen Lokal (tanpa membocorkan galat mentah)");

// --- feed
function fakeSb(opts = {}) {
  const calls = { events: [], presence: [] };
  return {
    calls,
    from(table) {
      return {
        insert: async (rows) => {
          if (opts.failInsert) return { error: { message: "relation does not exist" } };
          calls.events.push(...rows);
          return { error: null };
        },
        upsert: async (rows, o) => {
          calls.presence.push({ rows, o });
          return { error: opts.failUpsert ? { message: "x" } : null };
        }
      };
    }
  };
}
{
  const sb = fakeSb();
  let t = 1_000_000;
  const feed = createOfficeFeed({ supabase: sb, flushMs: 5, logger: silent, now: () => t });
  const a = feed.task("ayyubi");
  a.think("Pesan masuk di grup Keluarga");
  a.work("Menyusun balasan", 30);
  a.progress("Menyusun balasan", 50); // lolos (progres pertama)
  a.progress("Menyusun balasan", 60); // dijarangkan (<2 dtk)
  t += 2500;
  a.progress("Menyusun balasan", 70); // lolos
  a.handoff("suara", "pesan", "Minta dibacakan");
  a.done("Balasan terkirim");
  a.fail("Kuota habis");
  feed.emit({ who: "orang", kind: "work" }); // tidak sah
  await feed.flush();
  assert.equal(sb.calls.events.length, 7);
  assert.deepEqual(sb.calls.events.map((e) => e.kind), ["think", "work", "progress", "progress", "handoff", "done", "error"]);
  assert.equal(sb.calls.events[4].to_who, "suara");
  assert.equal(sb.calls.events[4].item, "pesan");
  assert.equal(feed.stats.sent, 7);
  ok("feed: antrean → insert berkelompok, progres dijarangkan, kejadian tak sah dibuang");
}
{
  const sb = fakeSb();
  const feed = createOfficeFeed({ supabase: sb, enabled: false, logger: silent });
  assert.equal(feed.emit({ who: "ayyubi", kind: "work", text: "x" }), false);
  await feed.flush();
  await feed.heartbeat();
  assert.equal(sb.calls.events.length, 0);
  assert.equal(sb.calls.presence.length, 0);
  assert.equal(readOfficeConfig({}).enabled, true);
  assert.equal(readOfficeConfig({ OFFICE_FEED: "0" }).enabled, false);
  assert.equal(readOfficeConfig({ OFFICE_FEED: "mati" }).enabled, false);
  ok("feed dimatikan: tidak menulis apa pun (OFFICE_FEED=0)");
}
{
  const sb = fakeSb();
  const feed = createOfficeFeed({ supabase: sb, logger: silent, presence: () => [{ who: "ayyubi", detail: "WA utama" }, { who: "palsu" }, { who: "video" }] });
  await feed.heartbeat();
  assert.equal(sb.calls.presence.length, 1);
  assert.deepEqual(sb.calls.presence[0].rows.map((r) => r.who), ["ayyubi", "video"]);
  assert.equal(sb.calls.presence[0].o.onConflict, "who");
  // presence boleh async (mis. memeriksa Ollama); yang tidak menjawab tidak ditulis
  const sb2 = fakeSb();
  const feed2 = createOfficeFeed({ supabase: sb2, logger: silent, presence: async () => [{ who: "agen", detail: "Ollama (qwen2.5:3b)" }] });
  await feed2.heartbeat();
  assert.deepEqual(sb2.calls.presence[0].rows.map((r) => [r.who, r.detail]), [["agen", "Ollama (qwen2.5:3b)"]]);
  const sb3 = fakeSb();
  await createOfficeFeed({ supabase: sb3, logger: silent, presence: async () => [] }).heartbeat();
  assert.equal(sb3.calls.presence.length, 0);
  ok("heartbeat: upsert denyut hanya untuk karyawan sah");
}
{
  const warns = [];
  const sb = fakeSb({ failInsert: true });
  let t = 5_000_000;
  const feed = createOfficeFeed({ supabase: sb, flushMs: 1, logger: { warn: (m) => warns.push(m) }, now: () => t });
  for (let i = 0; i < 3; i++) {
    feed.emit({ who: "ayyubi", kind: "work", text: `k${i}` });
    await feed.flush();
  }
  assert.equal(warns.length, 1, "peringatan hanya sekali");
  assert.match(warns[0], /0041_office/);
  assert.equal(feed.stats.errors, 3);
  // istirahat 5 menit: kejadian baru tetap bisa diantre tetapi tidak ditulis
  feed.emit({ who: "ayyubi", kind: "work", text: "saat istirahat" });
  await feed.flush();
  assert.equal(feed.stats.errors, 3);
  t += 6 * 60_000;
  feed.emit({ who: "ayyubi", kind: "work", text: "setelah istirahat" });
  await feed.flush();
  assert.equal(feed.stats.errors, 4); // dicoba lagi
  ok("feed gagal menulis: satu peringatan, istirahat 5 menit, tidak melempar galat");
}
{
  const sb = fakeSb();
  const feed = createOfficeFeed({ supabase: sb, flushMs: 1000, logger: silent });
  for (let i = 0; i < 250; i++) feed.emit({ who: "ayyubi", kind: "say", text: `s${i}` });
  assert.ok(feed.stats.dropped >= 50);
  ok("feed: antrean dibatasi 200");
  feed.stop();
}
{
  const sb = fakeSb();
  const feed = createOfficeFeed({ supabase: sb, flushMs: 1000, logger: silent });
  feed.emit({ who: "ayyubi", kind: "say", text: "Hubungi +62 812 3456 7890 atau a@b.co http://x.y/z" });
  await feed.flush();
  assert.equal(sb.calls.events[0].text, "Hubungi [angka] atau [surel] [tautan]");
  feed.stop();
  ok("feed: teks dibersihkan sebelum ditulis");
}

{
  const sb = fakeSb();
  const feed = createOfficeFeed({ supabase: sb, flushMs: 1000, logger: silent });
  const boss = feed.task("wongsobot");
  const ov = officeVideoStages(feed, boss, "grup Keluarga");
  for (const st of ["script", "images", "images", "voice", "render"]) ov.stage(st);
  ov.video.handoff("wongsobot", "video", "Video jadi");
  ov.video.done("Video diserahkan");
  await feed.flush();
  const rows = sb.calls.events.map((e) => `${e.who}:${e.kind}`);
  assert.deepEqual(rows, [
    "wongsobot:think", "wongsobot:handoff",
    "video:work", "video:progress", "gambar:work", "gambar:done", "suara:work", "suara:done", "video:work",
    "video:handoff", "video:done"
  ]);
  assert.equal(sb.calls.events[1].to_who, "video");
  assert.equal(sb.calls.events[1].item, "naskah");
  assert.ok(sb.calls.events.every((e) => !/Keluarga.*Keluarga/.test(e.text)));
  feed.stop();
  ok("tahap video → kejadian Studio Video/Gambar/Suara berurutan");
}
{
  const sb = fakeSb();
  const feed = createOfficeFeed({ supabase: sb, flushMs: 1000, logger: silent });
  const ov = officeVideoStages(feed, feed.task("ayyubi"), "chat pribadi", { photo: true });
  ov.stage("render");
  await feed.flush();
  assert.deepEqual(sb.calls.events.map((e) => `${e.who}:${e.kind}`), ["ayyubi:think", "video:work"]);
  assert.match(sb.calls.events[0].text, /foto hidup/);
  feed.stop();
  ok("foto hidup: tanpa langkah gambar/suara");
}

console.log(`\n${n} blok tes Kantor AI lulus`);
