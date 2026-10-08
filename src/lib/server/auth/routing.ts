const PUBLIC_EXACT = new Set([
  "/login",
  "/setup",
  // The installable app: browsers fetch the manifest without credentials and the service worker
  // before anybody is signed in; the offline page is cached by the worker. None holds user data.
  "/manifest.webmanifest",
  "/sw.js",
  "/offline",
  "/api/health",
  "/api/v1/health",
  "/api/v1/openapi.json",
  "/api/v1/setup",
  "/api/v1/auth/login",
  "/api/v1/auth/token",
]);
const PUBLIC_PREFIXES = ["/api/public/", "/g/"];

/**
 * Paths the hook lets through without a user. `bind` still enforces each
 * endpoint's own auth mode, so a public path may hold endpoints that need one
 * (`DELETE /api/v1/auth/token`).
 */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_EXACT.has(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

/**
 * Pages rendered without JavaScript (`csr = false`): the guest pages and the offline page. With
 * nothing to hydrate SvelteKit adds no script nonce to the CSP, so the inline colour-mode script of
 * `app.html` could only be blocked.
 */
export function isScriptlessPath(pathname: string): boolean {
  return pathname.startsWith("/g/") || pathname === "/offline";
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** The versioned API: every route there is a registry endpoint run through `bind`. */
export function isVersionedApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/v1/");
}

/** Bearer tokens are honoured on the versioned API only. */
export function isBearerPath(pathname: string): boolean {
  return isVersionedApiPath(pathname);
}

/**
 * Only same-origin relative paths are allowed ("/foo?bar=1"). Anything else
 * (absolute URLs, protocol-relative "//host", backslash tricks, control
 * characters) falls back to "/".
 */
export function safeRedirectTo(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "http://hauswart.invalid");
    if (parsed.origin !== "http://hauswart.invalid") return "/";
  } catch {
    return "/";
  }
  return value;
}
