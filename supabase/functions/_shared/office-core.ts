// Logika murni untuk Kantor AI (tanpa impor, supaya bisa dites dengan node dan dipakai Edge Function `office`).

export const WHO = ["ayyubi", "wongsobot", "agen", "video", "gambar", "suara"] as const;
export const KINDS = ["online", "offline", "think", "work", "progress", "say", "wait", "done", "error", "handoff"] as const;
export const ITEMS = ["naskah", "video", "suara", "gambar", "berkas", "pesan"] as const;
export const OFFLINE_AFTER_MS = 90_000;
export const MAX_TEXT = 120;
export const MAX_DETAIL = 200;
export const MAX_PUSH_EVENTS = 40;
export const APPROVAL_LIFETIME_MS = 15 * 60_000;
export const KEEP_DAYS = 3;

export type OfficeEventRow = {
  who: string;
  kind: string;
  text: string;
  progress: number | null;
  to_who: string | null;
  item: string | null;
  approval_id: string | null;
};

const has = (list: readonly string[], v: unknown): v is string => typeof v === "string" && list.includes(v);

/** Hapus data yang tidak pantas tersimpan di awan: nomor telepon/angka panjang, surel, tautan; ringkas spasi; potong. */
export function redact(text: unknown, max = MAX_TEXT): string {
  let s = String(text ?? "");
  s = s.replace(/https?:\/\/\S+/gi, "[tautan]");
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[surel]");
  s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, "[angka]");
  s = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const validApprovalId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(id);

/** Kejadian mentah -> baris tabel, atau null bila tidak sah. */
export function cleanEvent(e: unknown): { row: OfficeEventRow; approval: { id: string; detail: string } | null } | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (!has(WHO, o.who) || !has(KINDS, o.kind)) return null;
  const progress = Number.isFinite(Number(o.progress)) && o.progress !== null && o.progress !== "" ? Math.max(0, Math.min(100, Math.round(Number(o.progress)))) : null;
  const to = has(WHO, o.to) ? o.to : null;
  const item = has(ITEMS, o.item) ? o.item : null;
  let approval: { id: string; detail: string } | null = null;
  const ap = o.approval as Record<string, unknown> | undefined;
  if (o.kind === "wait" && ap && validApprovalId(ap.id)) approval = { id: ap.id, detail: redact(ap.detail, MAX_DETAIL) };
  return {
    row: { who: o.who, kind: o.kind, text: redact(o.text), progress, to_who: o.kind === "handoff" ? to : null, item: o.kind === "handoff" ? item : null, approval_id: approval?.id ?? null },
    approval
  };
}

export type PresenceRow = { who: string; seen_at: string; detail?: string };

/** Siapa yang dianggap hidup menurut denyut. */
export function presenceView(rows: PresenceRow[], nowMs: number): { who: string; online: boolean; ageSec: number; detail: string }[] {
  return rows
    .filter((r) => has(WHO, r.who))
    .map((r) => {
      const age = Math.max(0, nowMs - Date.parse(r.seen_at));
      return { who: r.who, online: Number.isFinite(age) && age <= OFFLINE_AFTER_MS, ageSec: Math.round(age / 1000), detail: String(r.detail ?? "") };
    });
}

/** Izin yang masih berlaku (pending dan belum kedaluwarsa). */
export function livePending<T extends { status: string; created_at: string }>(rows: T[], nowMs: number): T[] {
  return rows.filter((r) => r.status === "pending" && nowMs - Date.parse(r.created_at) <= APPROVAL_LIFETIME_MS);
}

export function cutoffIso(nowMs: number, days = KEEP_DAYS): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}
