// Klien Edge Function `study` (lihat supabase/functions/study/index.ts). Menu Study tidak memakai kode akses chat;
// yang menjaga data adalah PIN pemain / PIN orang tua yang dikirim per aksi.

// Satu pintu untuk semua aksi. Mengembalikan { ok: true, ...data } atau
// { ok: false, message, status, pinWrong, locked, seconds, attemptsLeft, insufficient, ... }.
export async function studyCall(action, params = {}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/study`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ action, ...params })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return {
        ...data,
        ok: false,
        status: res.status,
        // 404 tanpa isi JSON = fungsi `study` belum di-deploy.
        notDeployed: res.status === 404 && !data.error,
        message: data.error || `HTTP ${res.status}`
      };
    }
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), network: true };
  }
}
