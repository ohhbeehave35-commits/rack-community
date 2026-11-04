/**
 * Somnus service worker.
 *
 * Hand-written rather than generated: the app is server-rendered, it holds
 * per-user state, and it talks to server functions — so a blanket precache of
 * every route would serve one visitor's shell to the next one. The rules below
 * are deliberately narrow.
 *
 * Strategy
 *   navigations      network-first  -> cache -> offline.html
 *   hashed assets    cache-first    (immutable by construction)
 *   icons / images   stale-while-revalidate
 *   everything else  straight to the network, never stored
 *
 * Bump CACHE_VERSION on any change here or to PRECACHE.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `somnus-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `somnus-assets-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

/** Small, stable, and safe to hand to anyone — no user data in any of it. */
const PRECACHE = [
  OFFLINE_URL,
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

/** Paths that must never be served from a cache. */
const NEVER_CACHE = [
  "/api/",
  "/_serverFn/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll is atomic — one 404 would reject the whole install and leave the
      // app with no offline page at all, so fetch them individually.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res.ok) await cache.put(url, res);
          } catch {
            /* a missing optional asset must not block activation */
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("somnus-") && !keep.has(n))
          .map((n) => caches.delete(n)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

/** The page asks for the new worker when the user accepts the update. */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

function isHashedAsset(url) {
  // Vite emits /assets/name-<hash>.<ext> — content-addressed, so immutable.
  return /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(url.pathname);
}

function isImageish(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    /\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?)$/i.test(url.pathname)
  );
}

async function networkFirstNavigation(event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const preload = await event.preloadResponse;
    const res = preload || (await fetch(event.request));
    if (res && res.ok && res.type === "basic") {
      cache.put(event.request, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Offline", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Mutations and cross-origin traffic are the network's business, not ours.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((p) => url.pathname.startsWith(p))) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
    return;
  }
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isImageish(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
