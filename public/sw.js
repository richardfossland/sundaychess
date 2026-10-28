/* SundayChess service worker — hand-written, no dependencies.
 *
 * Goals: (1) installable PWA, (2) the physical tournament mode under
 * /arranger/fysisk opens WITHOUT network after one online visit.
 *
 * Rules (do not loosen without thinking about a live tournament):
 *  - /api/* and every cross-origin request (Supabase, realtime) are NEVER
 *    handled here: network only, nothing cached.
 *  - A new worker WAITS. It only takes over when the page posts SKIP_WAITING
 *    (the in-app "Ny versjon – last inn på nytt" button) — never mid-round.
 *  - Bump VERSION to invalidate every cache; old ones are deleted on activate.
 */
"use strict";

const VERSION = "v1";
const PREFIX = "sundaychess-";
const SHELL = PREFIX + "shell-" + VERSION; // HTML documents we serve offline
const STATIC = PREFIX + "static-" + VERSION; // /_next/static/* (immutable, hashed)
const ASSETS = PREFIX + "assets-" + VERSION; // icons, fonts, manifest (SWR)
const CURRENT = [SHELL, STATIC, ASSETS];

// ONE place that lists the routes whose HTML is precached at install. The M1
// physical-mode route(s) go here. A route that does not exist (404) or
// redirects is simply skipped — install must never fail because of it.
const PRECACHE_ROUTES = ["/offline", "/arranger/fysisk"];

// Navigations under this prefix fall back to the cached shell when offline.
const OFFLINE_APP_PREFIX = "/arranger/fysisk";
const OFFLINE_APP_SHELL = "/arranger/fysisk";
const OFFLINE_PAGE = "/offline";

// Navigation network-first budget for the offline app before using the cache
// (a hung hall wifi must not freeze the scoreboard page).
const NAV_TIMEOUT_MS = 4000;

function isOfflineAppPath(p) {
  return p === OFFLINE_APP_PREFIX || p.startsWith(OFFLINE_APP_PREFIX + "/");
}

async function precacheRoute(path) {
  try {
    const res = await fetch(path, { credentials: "same-origin", cache: "reload" });
    if (!res.ok || res.redirected) return;
    const html = await res.clone().text();
    const shell = await caches.open(SHELL);
    await shell.put(path, res);
    // Pull in the hashed chunks this document references so the shell actually
    // boots offline.
    const urls = new Set(html.match(/\/_next\/static\/[^"'\\\s)<>]+/g) || []);
    const st = await caches.open(STATIC);
    await Promise.all(
      [...urls].map(async (u) => {
        try {
          if (await st.match(u)) return;
          const r = await fetch(u, { credentials: "same-origin" });
          if (r.ok) await st.put(u, r);
        } catch (_) {
          /* best effort */
        }
      }),
    );
  } catch (_) {
    /* offline during install / route missing: skip */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all(PRECACHE_ROUTES.map(precacheRoute)));
  // No skipWaiting() here on purpose — see header.
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && !CURRENT.includes(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const net = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) {
    net.catch(() => {});
    return hit;
  }
  const res = await net;
  return res || Response.error();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function handleNavigation(request, url) {
  const offlineApp = isOfflineAppPath(url.pathname);
  try {
    const res = await (offlineApp ? withTimeout(fetch(request), NAV_TIMEOUT_MS) : fetch(request));
    // Only the physical-mode documents are kept for offline use.
    if (offlineApp && res.ok && !res.redirected) {
      const shell = await caches.open(SHELL);
      shell.put(url.pathname, res.clone());
    }
    return res;
  } catch (_) {
    const shell = await caches.open(SHELL);
    if (offlineApp) {
      const hit = (await shell.match(url.pathname)) || (await shell.match(OFFLINE_APP_SHELL));
      if (hit) return hit;
    }
    const page = await shell.match(OFFLINE_PAGE);
    if (page) return page;
    return new Response("Du er frakoblet.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, realtime, CDNs: network
  if (url.pathname.startsWith("/api/")) return; // never cache API responses
  if (url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request, url));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:woff2?|ttf|otf)$/.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request, ASSETS));
  }
  // everything else (RSC payloads, images, ...): default network behaviour
});
