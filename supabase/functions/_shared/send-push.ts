// Logika kirim Web Push ke semua subscriber, dipakai bareng oleh
// generate-summary (otomatis, setelah ringkasan baru tersimpan)
// dan send-push (manual/testing).
//
// Pakai jsr:@negrel/webpush — library Web Push (VAPID + RFC 8291)
// yang jalan native di Deno tanpa perlu Node polyfill.
import * as webpush from "jsr:@negrel/webpush@^0.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushResult {
  sent: number;
  removed: number;
  failed: number;
}

let cachedAppServer: webpush.ApplicationServer | null = null;

async function getAppServer(): Promise<webpush.ApplicationServer> {
  if (cachedAppServer) return cachedAppServer;

  const vapidKeysJson = Deno.env.get("VAPID_KEYS_JSON");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

  if (!vapidKeysJson) {
    throw new Error("VAPID_KEYS_JSON belum di-set sebagai Supabase secret (lihat README bagian VAPID keys).");
  }

  let exportedKeys: webpush.ExportedVapidKeys;
  try {
    exportedKeys = JSON.parse(vapidKeysJson);
  } catch (_err) {
    throw new Error("VAPID_KEYS_JSON bukan JSON yang valid.");
  }

  const vapidKeys = await webpush.importVapidKeys(exportedKeys);

  cachedAppServer = await webpush.ApplicationServer.new({
    contactInformation: subject,
    vapidKeys
  });

  return cachedAppServer;
}

export async function sendPushToAllSubscribers(payload: PushPayload): Promise<PushResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: subs, error } = await supabaseAdmin.from("push_subscriptions").select("*");
  if (error) throw new Error(`Gagal ambil daftar subscription: ${error.message}`);
  if (!subs || subs.length === 0) {
    return { sent: 0, removed: 0, failed: 0 };
  }

  const appServer = await getAppServer();
  const message = JSON.stringify(payload);

  let sent = 0;
  let removed = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const subscriber = appServer.subscribe({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        });
        await subscriber.pushTextMessage(message, {});
        sent++;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        // 404/410 = subscription sudah tidak berlaku (device unsubscribe / uninstall PWA)
        if (status === 404 || status === 410) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
          removed++;
        } else {
          console.error(`Gagal kirim push ke subscription ${sub.id}:`, err);
          failed++;
        }
      }
    })
  );

  return { sent, removed, failed };
}
