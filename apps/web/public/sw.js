/* Strats360 People service worker.
 * Keeps the app shell (HTML, scripts, styles, icons, fonts) so the app opens with a weak
 * or no connection. API responses are never stored: personal data stays on the server.
 */
const BUILD = "__BUILD_ID__";
const SHELL = `shell-${BUILD}`;
const ASSETS = `assets-${BUILD}`;
const FONTS = "fonts-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, FONTS]);
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

// the page asks a waiting worker to take over when the person taps "Reload"
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: keep a copy so the app looks right offline
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONTS).then(async (c) => {
        const hit = await c.match(req);
        const fresh = fetch(req).then((r) => (r.ok || r.type === "opaque" ? (c.put(req, r.clone()), r) : r)).catch(() => hit);
        return hit ?? fresh;
      }),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // never store API answers (payslips, salaries, personal details) or files
  if (url.pathname.startsWith("/api/")) return;

  // pages: the network first, the saved app shell when offline (the app routes itself)
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const r = await Promise.race([fetch(req), timeout(5000)]);
          if (r.ok) (await caches.open(SHELL)).put("/", r.clone());
          return r;
        } catch {
          return (await caches.match("/")) ?? new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  // built files have a hash in their name and never change: cache first
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      }),
    );
    return;
  }

  // icons and the like: serve what's saved, refresh it in the background
  event.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req);
      const fresh = fetch(req)
        .then((r) => {
          if (r.ok) c.put(req, r.clone());
          return r;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? fresh;
    }),
  );
});
