import { ApiError } from "$lib/api/errors";
import { isApiPath, isVersionedApiPath } from "./routing";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether the request writes (anything but GET, HEAD and OPTIONS) without coming from the app's
 * own origin, to a route `bind` does not guard.
 *
 * Browsers attach cookies to cross-site form posts, so a page's own form action (the guest PIN
 * form, any `+page.server.ts` action) must only accept posts from the app's origin. SvelteKit has
 * a check for this, but it also stops bearer uploads (multipart without `Origin`) before `bind`
 * runs, so it is switched off (`kit.csrf.trustedOrigins` in svelte.config.js) and this takes its
 * place for everything outside `/api/v1`. There `bind` checks cookie-authenticated requests and
 * lets bearer ones through: a token is not sent by the browser on its own.
 *
 * Stricter than SvelteKit's check, which only looked at form content types: no content type
 * makes a cross-site write acceptable, and an unknown method counts as a write.
 *
 * One exception to "the Origin header must be ours": a form posted from a page that is served
 * with `Referrer-Policy: no-referrer` (the guest pages, which carry their token in the address)
 * sends `Origin: null` even to its own server, as the Fetch standard demands. The browser says
 * who started the request in `Sec-Fetch-Site`, a header page scripts cannot set, so `null` is
 * accepted when that says `same-origin` (never `same-site`: a sibling host is not us).
 */
export function isCrossSiteWrite(request: Request, url: URL): boolean {
  if (READ_METHODS.has(request.method)) return false;
  if (isVersionedApiPath(url.pathname)) return false;
  const origin = request.headers.get("origin");
  if (origin === url.origin) return false;
  return !(
    origin === "null" && request.headers.get("sec-fetch-site") === "same-origin"
  );
}

/**
 * Whether the request names an origin other than the app's own. Browsers send `Origin` on every
 * cross-site request (and on every POST); programs such as MCP clients and curl send none, and a
 * request without one is not refused. For endpoints that are only meant for programs (the MCP
 * endpoint, where the spec requires it against DNS rebinding): `bind` and this file's write check
 * leave `/api/v1` requests with a bearer token alone, so the endpoint asks.
 */
export function hasForeignOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== url.origin;
}

/** The 403 for a cross-site write, or null when the request is fine. */
export function crossSiteWriteResponse(
  request: Request,
  url: URL,
): Response | null {
  if (!isCrossSiteWrite(request, url)) return null;
  if (isApiPath(url.pathname)) {
    const error = new ApiError("csrf_failed", "Cross-origin request rejected");
    return new Response(JSON.stringify(error.toBody()), {
      status: error.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }
  return new Response(`Cross-site ${request.method} requests are forbidden`, {
    status: 403,
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}
