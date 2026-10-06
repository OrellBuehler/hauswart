import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Which addresses the server may be told to connect to (integration base URLs).
 *
 * Private LAN ranges are allowed on purpose: the connected systems are self-hosted and sit on
 * the same network. What is never allowed, for anybody, is the link-local range and the cloud
 * metadata endpoints (169.254.0.0/16, fe80::/10, 100.100.100.200, fd00:ec2::254,
 * `metadata.google.internal`). Loopback is allowed only for administrators and household-wide
 * connections (`allowLoopback`), because a member's connection must not reach services bound to
 * the server's own interface.
 *
 * The check resolves the host name and looks at every address it answers with. It cannot pin the
 * address the later `fetch` connects to, so a name that changes its answer between this check and
 * the request (DNS rebinding) is not caught by it; the check runs again before every request,
 * which narrows the window, and the response of a connection is only ever read by its owner.
 */

export type HostBlock = "metadata" | "link_local" | "loopback";
export type AddressClass = HostBlock | "ok";

export class HostPolicyError extends Error {
  override name = "HostPolicyError";
  constructor(readonly reason: HostBlock) {
    super(
      reason === "loopback"
        ? "Loopback addresses are only available to administrators."
        : "Link-local and cloud metadata addresses are not allowed.",
    );
  }
}

const METADATA_NAMES = new Set(["metadata.google.internal"]);

function parseV4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/** Eight 16-bit groups of an IPv6 address (zone ids dropped, `::` and a dotted tail expanded). */
function parseV6(input: string): number[] | null {
  let ip = input.split("%")[0] ?? "";
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted) {
    const v4 = parseV4(dotted[1] as string);
    if (!v4) return null;
    const hex = (a: number, b: number) => ((a << 8) | b).toString(16);
    ip = `${ip.slice(0, -dotted[1]!.length)}${hex(v4[0]!, v4[1]!)}:${hex(v4[2]!, v4[3]!)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0] as string);
  const tail = halves.length === 2 ? groups(halves[1] as string) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ];
  const values = all.map((g) =>
    /^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN,
  );
  return values.length === 8 && values.every((v) => v >= 0) ? values : null;
}

function classifyV4(o: readonly number[]): AddressClass {
  const [a, b, c, d] = o as [number, number, number, number];
  if (a === 100 && b === 100 && c === 100 && d === 200) return "metadata";
  if (a === 169 && b === 254) return "link_local";
  if (a === 127 || a === 0) return "loopback";
  return "ok";
}

function classifyV6(g: readonly number[]): AddressClass {
  const embedded = (hi: number, lo: number) =>
    classifyV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  const zeros = (n: number) => g.slice(0, n).every((v) => v === 0);
  if (zeros(7) && (g[7] === 0 || g[7] === 1)) return "loopback";
  if (zeros(5) && g[5] === 0xffff)
    return embedded(g[6] as number, g[7] as number);
  if (zeros(6)) return embedded(g[6] as number, g[7] as number);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((v) => v === 0)) {
    return embedded(g[6] as number, g[7] as number);
  }
  if (
    g[0] === 0xfd00 &&
    g[1] === 0x0ec2 &&
    g.slice(2, 7).every((v) => v === 0) &&
    g[7] === 0x254
  ) {
    return "metadata";
  }
  if (((g[0] as number) & 0xffc0) === 0xfe80) return "link_local";
  return "ok";
}

/** The class of an IP address; anything that is not an address is `ok` (names are resolved first). */
export function classifyAddress(ip: string): AddressClass {
  const bare = ip.replace(/^\[|\]$/g, "");
  const family = isIP(bare.split("%")[0] ?? "");
  if (family === 4) {
    const octets = parseV4(bare);
    return octets ? classifyV4(octets) : "ok";
  }
  if (family === 6) {
    const groups = parseV6(bare);
    return groups ? classifyV6(groups) : "ok";
  }
  return "ok";
}

export type HostResolver = (host: string) => Promise<string[]>;

const systemResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

let resolver: HostResolver | null = null;
let lenient = false;

/** Tests only: answers name lookups with `fn` instead of the system resolver (null restores it). */
export function setHostResolver(fn: HostResolver | null): void {
  resolver = fn;
}

/**
 * Tests only: the test suite talks to fake servers on 127.0.0.1 and example.org names, so it runs
 * lenient (loopback allowed, names not resolved). Link-local and metadata stay blocked. Never
 * enabled outside tests.
 */
export function setLenientHostPolicy(on: boolean): void {
  lenient = on;
}

/**
 * Throws `HostPolicyError` when the URL's host is, or resolves to, an address that may not be
 * connected to. A name that does not resolve passes: the request itself fails then.
 */
export async function assertHostAllowed(
  url: string | URL,
  options: { allowLoopback: boolean },
): Promise<void> {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
  if (METADATA_NAMES.has(host)) throw new HostPolicyError("metadata");
  const bare = host.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(bare) !== 0) {
    addresses = [bare];
  } else {
    const resolve = resolver ?? (lenient ? async () => [] : systemResolver);
    try {
      addresses = await resolve(host);
    } catch {
      return;
    }
  }
  const allowLoopback = options.allowLoopback || lenient;
  for (const address of addresses) {
    const found = classifyAddress(address);
    if (found === "ok") continue;
    if (found === "loopback" && allowLoopback) continue;
    throw new HostPolicyError(found);
  }
}
