// Offline shell for the phone/web app. Only this site's own files are cached
// (the app code, icons and the database engine) so the app opens without a
// signal. The API and photo/report files live on a different origin and are
// never touched here - the app keeps its own data on the device and syncs it.
const CACHE = "pestapp-shell-v1";
const CORE = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/sql-wasm-browser.wasm"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The app's JS bundle has a hashed name that changes every build, so
      // read it from the page itself. Without this the very first visit
      // wouldn't be available offline until the second one.
      const files = new Set(CORE);
      try {
        const html = await (await fetch("/", { cache: "no-store" })).text();
        for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) files.add(m[1]);
      } catch {
        // offline during install: whatever is cacheable later is picked up at runtime
      }
      await Promise.all([...files].map((f) => cache.add(f).catch(() => undefined)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build files never change under the same name: cache first.
  if (url.pathname.startsWith("/_expo/static/") || url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
      )
    );
    return;
  }

  // Everything else (the page itself): fresh from the network when online so
  // a new version shows up immediately, the saved copy when offline. Any
  // page address falls back to the app shell, since routing happens in the app.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, res.clone()));
        return res;
      })
      .catch(async () => (await caches.match(req.mode === "navigate" ? "/" : req)) || (await caches.match("/")) || Response.error())
  );
});
