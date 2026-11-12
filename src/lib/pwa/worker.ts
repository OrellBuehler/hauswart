/**
 * The whole behaviour of the service worker (`src/service-worker/index.ts` only wires it to the
 * worker's events). It does this and nothing else:
 *
 * - **Precache** the built static client files only: the hashed `_app/immutable` scripts, styles and
 *   fonts, the icons and the favicon, plus the offline page. No other HTML, no JSON. Precached files
 *   are answered from the cache.
 * - **Navigations** to app pages go to the network and are never cached; if the network is down the
 *   precached offline page stands in. It is the only HTML in the cache and holds no user data.
 * - **Everything else** (`/api`, `/g`, files, attachments, the `fetch()` calls of the app) is not
 *   handled at all, so the browser talks to the server directly.
 *
 * The cache is named after the build, so every release precaches anew (the offline page links hashed
 * assets) and drops every other cache, those of the earlier workbox worker included. A new worker
 * waits until the person agrees to reload (`components/app/pwa-update.svelte` posts `SKIP_WAITING`)
 * and then takes over the open pages.
 */

export const OFFLINE_PATH = "/offline";
export const SKIP_WAITING = "SKIP_WAITING";

/**
 * Navigations the worker answers when the network fails: pages of the app. Never `/api`, the guest
 * pages (`/g`), `/login`, `/setup`, the offline page, the worker itself and the manifest, so
 * downloads and everything public or token-based go straight to the network.
 */
export function isAppNavigation(
  request: { mode: RequestMode; method: string },
  url: URL,
): boolean {
  return (
    request.mode === "navigate" &&
    request.method === "GET" &&
    !/^\/(?:api|g|login|setup|offline|sw\.js|manifest\.webmanifest)(?:\/|$)/.test(
      url.pathname,
    )
  );
}

/** The addresses to precache, from the build's file lists (paths relative to `/`). */
export function precacheUrls(
  immutable: ReadonlyArray<{ path: string }>,
  assets: ReadonlyArray<{ path: string }>,
): string[] {
  const built = immutable
    .map(({ path }) => path)
    .filter((path) => /^_app\/immutable\/.+\.(?:js|css|woff2)$/.test(path));
  const statics = assets
    .map(({ path }) => path)
    .filter(
      (path) => /^icons\/[^/]+\.png$/.test(path) || path === "favicon.svg",
    );
  return [...built, ...statics].map((path) => `/${path}`).concat(OFFLINE_PATH);
}

export function cacheName(version: string): string {
  return `hauswart-${version}`;
}

/** Every cache but the current one: older builds and the workbox worker this one replaced. */
export function staleCaches(
  names: readonly string[],
  current: string,
): string[] {
  return names.filter((name) => name !== current);
}

export type FetchPlan = "precached" | "navigation" | "network";

/** What the worker does with a request: answer it from the cache, guard a navigation, or stay out. */
export function planFetch(
  request: { mode: RequestMode; method: string },
  url: URL,
  origin: string,
  precached: ReadonlySet<string>,
): FetchPlan {
  if (url.origin !== origin) return "network";
  if (
    request.method === "GET" &&
    precached.has(url.pathname) &&
    url.pathname !== OFFLINE_PATH
  ) {
    return "precached";
  }
  return isAppNavigation(request, url) ? "navigation" : "network";
}
