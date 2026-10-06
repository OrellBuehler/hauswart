/**
 * Host names as the household's integration allow-list writes them: a host name or address,
 * optionally with a port (`docs.example.org`, `nas.example.org:8000`, `[fd00::5]:8000`).
 * Client-safe: the settings page uses the same normalisation as the server.
 */

const ENTRY = /^(\[[0-9a-fA-F:.]+\]|[^\s/\\:@?#[\]*]+)(?::(\d{1,5}))?$/;

const DEFAULT_PORTS: Record<string, number> = { "http:": 80, "https:": 443 };

/** The URL parser's host: lower case, IDN as punycode, IP spellings canonical, no trailing dot. */
function canonicalHost(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/** `host` or `host:port` in canonical form, or null when the entry is not a host name or address. */
export function normalizeHostEntry(input: string): string | null {
  const match = ENTRY.exec(input.trim());
  if (!match) return null;
  let host: string;
  try {
    host = canonicalHost(new URL(`http://${match[1]}`).hostname);
  } catch {
    return null;
  }
  if (host === "") return null;
  if (match[2] === undefined) return host;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `${host}:${port}`;
}

/**
 * Whether the address' host is on the list. Hosts match exactly (no wildcards, no sub-domains);
 * an entry without a port allows every port of the host, one with a port only that port (the
 * scheme's default port counts as its number).
 */
export function isHostAllowed(
  baseUrl: string,
  allowlist: readonly string[],
): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return false;
  }
  const host = canonicalHost(url.hostname);
  const port = url.port === "" ? DEFAULT_PORTS[url.protocol] : Number(url.port);
  return allowlist.some((entry) => {
    const normal = normalizeHostEntry(entry);
    if (normal === null) return false;
    const rest = normal.slice(
      normal.startsWith("[") ? normal.indexOf("]") + 1 : 0,
    );
    const at = rest.lastIndexOf(":");
    if (at === -1) return normal === host;
    return (
      normal.slice(0, normal.length - rest.length + at) === host &&
      Number(rest.slice(at + 1)) === port
    );
  });
}
