// ================================================================
// KANTOR AI -- umpan DATA ASLI untuk halaman Kantor (src/office.js).
//
// Memanggil Edge Function `office` (supabase/functions/office/index.ts) tiap beberapa detik:
//   pertama kali  : { action:"poll" }            -> 40 kejadian terakhir (replay) + denyut + izin yang menunggu
//   berikutnya    : { action:"poll", since: id } -> kejadian baru saja
//   jawab izin    : { action:"decide", id, ok }
// Kode akses = kode obrolan yang sama dengan fitur lain (diambil lewat getCode()).
//
// Modul ini tanpa DOM: hasilnya diserahkan lewat callback (onEvents / onPresence / onApprovals / onStatus) sehingga mudah dites.
// Status: "connecting" | "live" | "needcode" | "error"
// ================================================================

export function createOfficeLive({
  url,
  anonKey = "",
  getCode,
  onEvents = () => {},
  onPresence = () => {},
  onApprovals = () => {},
  onStatus = () => {},
  fetchImpl = (...a) => fetch(...a),
  pollMs = 3000,
  errorPollMs = 10_000,
  now = () => Date.now()
} = {}) {
  let running = false;
  let since = null;
  let timer = null;
  let gen = 0; // naik tiap start/stop supaya hasil panggilan lama diabaikan
  let status = "";
  let failures = 0;

  const setStatus = (s, msg = "") => {
    if (s === status && !msg) return;
    status = s;
    onStatus(s, msg);
  };

  async function call(payload) {
    const res = await fetchImpl(`${url}/functions/v1/office`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(anonKey ? { Authorization: `Bearer ${anonKey}`, apikey: anonKey } : {}) },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok && data.ok !== false, data };
  }

  async function tick(myGen) {
    const code = getCode();
    if (!code) {
      setStatus("needcode");
      running = false;
      return;
    }
    let r;
    try {
      r = await call({ code, action: "poll", ...(since === null ? {} : { since }) });
    } catch (e) {
      if (myGen !== gen) return;
      failures++;
      setStatus("error", e instanceof Error ? e.message : String(e));
      return schedule(myGen, errorPollMs);
    }
    if (myGen !== gen) return;
    if (r.status === 401) {
      setStatus("needcode", "Kode akses salah.");
      running = false;
      return;
    }
    if (!r.ok) {
      failures++;
      const msg = String(r.data?.error || `HTTP ${r.status}`);
      setStatus("error", /relation .* does not exist|office_events/i.test(msg) ? "Tabel Kantor belum ada: jalankan migrasi 0041_office.sql (/migrasi)." : msg);
      return schedule(myGen, errorPollMs);
    }
    failures = 0;
    const d = r.data;
    const events = Array.isArray(d.events) ? d.events : [];
    if (events.length || d.replay) onEvents(events.map((e) => ({ ...e, at: Date.parse(e.at) || now() })), { replay: Boolean(d.replay) });
    if (Array.isArray(d.presence)) onPresence(d.presence);
    if (Array.isArray(d.approvals)) onApprovals(d.approvals.map((a) => ({ ...a, at: Date.parse(a.at) || now() })));
    if (Number.isFinite(Number(d.last))) since = Math.max(Number(d.last), since ?? 0);
    setStatus("live");
    schedule(myGen, pollMs);
  }

  function schedule(myGen, ms) {
    if (myGen !== gen || !running) return;
    timer = setTimeout(() => tick(myGen), ms);
  }

  function start() {
    stop();
    running = true;
    since = null;
    failures = 0;
    status = "";
    const myGen = ++gen;
    if (!getCode()) {
      running = false;
      setStatus("needcode");
      return;
    }
    setStatus("connecting");
    tick(myGen);
  }

  function stop() {
    gen++;
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  /** Jawab permintaan izin. -> "approved" | "denied" | "gone" | "error" */
  async function decide(id, ok) {
    const code = getCode();
    if (!code) return "error";
    try {
      const r = await call({ code, action: "decide", id, ok: Boolean(ok) });
      return r.ok ? r.data.status || "error" : "error";
    } catch {
      return "error";
    }
  }

  return { start, stop, decide, status: () => status, isRunning: () => running };
}
