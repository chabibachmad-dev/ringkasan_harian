// Service worker: (1) bikin PWA bisa di-install & jalan offline-ish (app shell caching),
// (2) menerima & menampilkan Web Push notification, (3) buka app saat notifikasi diklik.

const CACHE_NAME = "ringkasan-harian-v2";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first untuk file same-origin (app shell: HTML/JS/CSS/icons) — supaya
// tiap kali ada update kode/deploy baru, versi terbarunya yang selalu dipakai.
// Cache cuma jadi fallback kalau HP lagi offline (bukan sumber utama).
// Request ke Supabase (origin berbeda) dibiarkan lewat langsung ke network.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Ringkasan Harian", body: "Ada pembaruan baru.", url: "./" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_err) {
    // payload bukan JSON, pakai default di atas
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: { url: data.url || "./" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
