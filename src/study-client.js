// Klien Edge Function `study` (lihat supabase/functions/study/index.ts). Menu Study tidak memakai kode akses chat;
// yang menjaga data adalah PIN pemain / PIN orang tua yang dikirim per aksi.

// ---- login perangkat: token (bukan PIN) disimpan di peramban sampai pemain menekan Keluar.
const LOGIN_KEY = "study_device_login_v1";
export const isDeviceToken = (v) => typeof v === "string" && /^tk_[A-Za-z0-9_-]{43}$/.test(v);

export function readDeviceLogin() {
  try {
    const v = JSON.parse(localStorage.getItem(LOGIN_KEY) || "null");
    if (v && typeof v.id === "string" && isDeviceToken(v.token)) {
      return { id: v.id, name: String(v.name ?? ""), grade: String(v.grade ?? ""), classLevel: v.classLevel ?? null, token: v.token };
    }
  } catch {
    /* penyimpanan tidak tersedia / rusak: anggap belum masuk */
  }
  return null;
}

// viewer = { id, name, grade, classLevel, pin } dengan pin = token.
export function saveDeviceLogin(viewer) {
  try {
    if (viewer && isDeviceToken(viewer.pin)) {
      localStorage.setItem(LOGIN_KEY, JSON.stringify({ id: viewer.id, name: viewer.name, grade: viewer.grade, classLevel: viewer.classLevel ?? null, token: viewer.pin }));
    }
  } catch {
    /* tanpa penyimpanan: login hanya berlaku selama halaman terbuka */
  }
}

export function clearDeviceLogin() {
  try {
    localStorage.removeItem(LOGIN_KEY);
  } catch {
    /* abaikan */
  }
}

// Dipanggil bila server menolak token (sudah dicabut / PIN direset): study.js melupakan login itu.
export const studyHooks = { onTokenInvalid: null };

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
      if (data.tokenInvalid && studyHooks.onTokenInvalid) studyHooks.onTokenInvalid();
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
