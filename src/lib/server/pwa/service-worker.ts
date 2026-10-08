import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The adapter serves static files before the hook runs and without a Cache-Control header, so the
 * production build moves the generated service worker out of `build/client` into the server
 * directory (`scripts/move-service-worker.ts`) and this module serves it from there. Source
 * checkouts, `bun dev` and the tests have no such file: the route answers 404 (the plugin is off in
 * development, see `vite.config.ts`).
 */
const CANDIDATES = ["../sw.js", "./sw.js"];

interface ServiceWorker {
  body: string;
  etag: string;
}

let loaded: ServiceWorker | null | undefined;

function readServiceWorker(): ServiceWorker | null {
  const file = CANDIDATES.map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  ).find((path) => existsSync(path));
  if (!file) {
    console.error(
      JSON.stringify({
        event: "pwa.service_worker_missing",
        candidates: CANDIDATES,
      }),
    );
    return null;
  }
  return withEtag(readFileSync(file, "utf8"));
}

function withEtag(body: string): ServiceWorker {
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 32);
  return { body, etag: `"${digest}"` };
}

/** Tests: serve this script (`null` = none built); `undefined` goes back to the build output. */
export function setServiceWorkerSource(
  source: string | null | undefined,
): void {
  loaded =
    source === undefined
      ? undefined
      : source === null
        ? null
        : withEtag(source);
}

/** `If-None-Match` may list several tags, and a proxy may have weakened them (`W/"…"`). */
function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .some(
      (tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag,
    );
}

/**
 * The service worker script. `no-cache` makes every browser check revalidate it (ETag, 304), so a
 * new release reaches installed apps and no cache in between (a CDN) can hold an old one.
 */
export function serviceWorkerResponse(request: Request): Response {
  if (loaded === undefined) loaded = readServiceWorker();
  if (!loaded) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  const headers = {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-cache",
    etag: loaded.etag,
  };
  if (matches(request.headers.get("if-none-match"), loaded.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(loaded.body, { headers });
}
