// Jalankan sekali untuk membuat pasangan VAPID key (dipakai untuk Web Push).
//
//   deno run --allow-net scripts/generate-vapid-keys.ts
//
// Hasilnya dua blok: satu untuk Supabase secret (rahasia, jangan disebar),
// satu lagi untuk file .env frontend (aman untuk publik).
import { generateVapidKeys, exportVapidKeys, exportApplicationServerKey } from "jsr:@negrel/webpush@^0.5.0";

const keys = await generateVapidKeys({ extractable: true });
const exportedKeys = await exportVapidKeys(keys);
const applicationServerKey = await exportApplicationServerKey(keys);

console.log("============================================================");
console.log("1) Simpan sebagai Supabase secret (RAHASIA — jangan disebar):");
console.log("");
console.log(`   supabase secrets set VAPID_KEYS_JSON='${JSON.stringify(exportedKeys)}'`);
console.log("");
console.log("============================================================");
console.log("2) Simpan sebagai VITE_VAPID_PUBLIC_KEY di file .env (BOLEH publik):");
console.log("");
console.log(`   VITE_VAPID_PUBLIC_KEY=${applicationServerKey}`);
console.log("");
console.log("============================================================");
