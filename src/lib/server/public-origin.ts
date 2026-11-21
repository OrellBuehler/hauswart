/**
 * `ORIGIN`, the public address of the app, for the production server (`scripts/start.ts`). The Bun
 * adapter takes the origin of a request from `PROTOCOL_HEADER` / `HOST_HEADER` (else it assumes
 * `https://<Host>`), and SvelteKit and `bind` compare a request's `Origin` with it. So when `ORIGIN`
 * is set, the start script points those two settings at headers of its own and stamps every request
 * with them, overwriting whatever a client sent under those names.
 */

export const ORIGIN_PROTOCOL_HEADER = "x-hauswart-origin-protocol";
export const ORIGIN_HOST_HEADER = "x-hauswart-origin-host";

/** The configured origin, or null when there is none. A value that is not an http(s) origin is refused. */
export function parsePublicOrigin(raw: string | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ORIGIN is not a URL: ${value}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `ORIGIN must be an origin such as https://hauswart.example.org, not ${value}`,
    );
  }
  return url;
}

/** The adapter settings that make it read the origin from the stamped headers. */
export function originAdapterEnv(): Record<string, string> {
  return {
    PROTOCOL_HEADER: ORIGIN_PROTOCOL_HEADER,
    HOST_HEADER: ORIGIN_HOST_HEADER,
  };
}

export function stampPublicOrigin(headers: Headers, origin: URL): void {
  headers.set(ORIGIN_PROTOCOL_HEADER, origin.protocol.slice(0, -1));
  headers.set(ORIGIN_HOST_HEADER, origin.host);
}
