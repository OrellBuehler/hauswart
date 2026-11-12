import { version } from "$app/env";
import { assets, immutable } from "$app/manifest";
import { self } from "$app/service-worker";
import {
  cacheName,
  OFFLINE_PATH,
  planFetch,
  precacheUrls,
  SKIP_WAITING,
  staleCaches,
} from "#lib/pwa/worker.ts";

const CACHE = cacheName(version);
const PRECACHE = precacheUrls(immutable, assets);
const precached = new Set(PRECACHE);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        staleCaches(names, CACHE).map((name) => caches.delete(name)),
      );
      // open pages, also those loaded before any worker existed, so the update prompt can reload them
      await self.clients.claim();
    })(),
  );
});

// A new version waits for the person's consent: only the update prompt activates it.
self.addEventListener("message", (event) => {
  if (event.data?.type === SKIP_WAITING) void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const plan = planFetch(
    request,
    new URL(request.url),
    self.location.origin,
    precached,
  );
  if (plan === "precached") {
    event.respondWith(
      caches
        .open(CACHE)
        .then(async (cache) => (await cache.match(request)) ?? fetch(request)),
    );
  } else if (plan === "navigation") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches
          .open(CACHE)
          .then((cache) => cache.match(OFFLINE_PATH));
        return offline ?? Response.error();
      }),
    );
  }
});
