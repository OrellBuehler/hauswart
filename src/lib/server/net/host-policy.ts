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
 *
 * The strict policy (`assertPublicUrl`) is for fetching an address a person or an assistant typed
 * (attaching a picture from the web), where nothing on the local network is a legitimate target: only
 * public addresses, on the standard ports, over http and https, without credentials. It has the same
 * limits as the above (no pinning), so DNS rebinding is not closed there either.
 */

export type HostBlock = "metadata" | "link_local" | "loopback";
export type AddressClass = HostBlock | "ok";

/**
 * What the strict policy (`assertPublicUrl`, below) refuses besides `HostBlock`: the other non-public address ranges, and
 * what is wrong with the URL itself (scheme, credentials, port).
 */
export type PublicBlock =
  | HostBlock
  | "private"
  | "cgnat"
  | "unique_local"
  | "multicast"
  | "unspecified"
  | "reserved"
  | "scheme"
  | "credentials"
  | "port";
export type PublicAddressClass = PublicBlock | "ok";

const PUBLIC_BLOCK_MESSAGES: Record<PublicBlock, string> = {
  metadata: "Link-local and cloud metadata addresses are not allowed.",
  link_local: "Link-local and cloud metadata addresses are not allowed.",
  loopback: "Loopback addresses are only available to administrators.",
  private: "Addresses on a private network are not allowed.",
  cgnat: "Addresses of a carrier-grade NAT network are not allowed.",
  unique_local: "Unique local addresses are not allowed.",
  multicast: "Multicast addresses are not allowed.",
  unspecified: "Unspecified addresses are not allowed.",
  reserved: "Addresses reserved for special use are not allowed.",
  scheme: "Only http and https addresses are allowed.",
  credentials: "An address with a user name or password is not allowed.",
  port: "Only the standard ports (80 and 443) are allowed.",
};

export class HostPolicyError extends Error {
  override name = "HostPolicyError";
  constructor(readonly reason: PublicBlock) {
    super(PUBLIC_BLOCK_MESSAGES[reason]);
  }
}

/** A name the strict policy could not resolve to any address: the request could not have been made either. */
export class HostUnresolvedError extends Error {
  override name = "HostUnresolvedError";
  constructor(cause?: unknown) {
    super("The host name does not resolve.", { cause });
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

const ipv4Number = (o: readonly number[]) =>
  (((o[0] as number) << 24) |
    ((o[1] as number) << 16) |
    ((o[2] as number) << 8) |
    (o[3] as number)) >>>
  0;

/** The ranges of IPv4 that are not public internet addresses; the first that contains an address names it. */
const NON_PUBLIC_V4 = [
  ["100.100.100.200", 32, "metadata"],
  ["169.254.0.0", 16, "link_local"],
  ["127.0.0.0", 8, "loopback"],
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["172.16.0.0", 12, "private"],
  ["192.168.0.0", 16, "private"],
  ["100.64.0.0", 10, "cgnat"],
  ["224.0.0.0", 4, "multicast"],
  ["192.0.0.0", 24, "reserved"],
  ["192.0.2.0", 24, "reserved"],
  ["198.18.0.0", 15, "reserved"],
  ["198.51.100.0", 24, "reserved"],
  ["203.0.113.0", 24, "reserved"],
  ["240.0.0.0", 4, "reserved"],
] as const satisfies readonly (readonly [string, number, PublicBlock])[];

const NON_PUBLIC_V4_RANGES = NON_PUBLIC_V4.map(
  ([base, bits, block]) =>
    [
      ipv4Number(parseV4(base) as number[]),
      (0xffffffff << (32 - bits)) >>> 0,
      block,
    ] as const,
);

function classifyPublicV4(o: readonly number[]): PublicAddressClass {
  const address = ipv4Number(o);
  for (const [base, mask, block] of NON_PUBLIC_V4_RANGES) {
    if (((address ^ base) & mask) >>> 0 === 0) return block;
  }
  return "ok";
}

function classifyPublicV6(g: readonly number[]): PublicAddressClass {
  const first = g[0] as number;
  const embedded = (hi: number, lo: number) =>
    classifyPublicV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  const zeros = (n: number) => g.slice(0, n).every((v) => v === 0);
  if (zeros(7) && g[7] === 0) return "unspecified";
  if (zeros(7) && g[7] === 1) return "loopback";
  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible (::a.b.c.d) forms.
  if (zeros(5) && g[5] === 0xffff)
    return embedded(g[6] as number, g[7] as number);
  if (zeros(6)) return embedded(g[6] as number, g[7] as number);
  // NAT64: the well-known prefix carries an IPv4 address, the local-use prefix is a private network.
  if (first === 0x64 && g[1] === 0xff9b) {
    if (g.slice(2, 6).every((v) => v === 0)) {
      return embedded(g[6] as number, g[7] as number);
    }
    if (g[2] === 1) return "private";
  }
  if (
    first === 0xfd00 &&
    g[1] === 0x0ec2 &&
    g.slice(2, 7).every((v) => v === 0) &&
    g[7] === 0x254
  ) {
    return "metadata";
  }
  if ((first & 0xffc0) === 0xfe80) return "link_local";
  if ((first & 0xffc0) === 0xfec0) return "private";
  if ((first & 0xfe00) === 0xfc00) return "unique_local";
  if ((first & 0xff00) === 0xff00) return "multicast";
  // 6to4 carries an IPv4 address in the next 32 bits.
  if (first === 0x2002) return embedded(g[1] as number, g[2] as number);
  // Only global unicast (2000::/3) is public, and Teredo and the documentation range inside it are not.
  if ((first & 0xe000) !== 0x2000) return "reserved";
  if (first === 0x2001 && g[1] === 0) return "reserved";
  if (first === 0x2001 && g[1] === 0x0db8) return "reserved";
  if (first === 0x3fff && (g[1] as number) < 0x1000) return "reserved";
  return "ok";
}

/**
 * The class of an IP address under the strict policy: `ok` only for a public internet address. IPv4-mapped, IPv4-compatible,
 * NAT64 and 6to4 addresses are judged by the IPv4 address they carry. Anything that is not an address is `ok` (names are
 * resolved first).
 */
export function classifyPublicAddress(ip: string): PublicAddressClass {
  const bare = ip.replace(/^\[|\]$/g, "");
  const family = isIP(bare.split("%")[0] ?? "");
  if (family === 4) {
    const octets = parseV4(bare);
    return octets ? classifyPublicV4(octets) : "ok";
  }
  if (family === 6) {
    const groups = parseV6(bare);
    return groups ? classifyPublicV6(groups) : "ok";
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

/** Whether the test-suite policy is on (loopback and non-standard ports allowed, names not resolved). */
export function isLenientHostPolicy(): boolean {
  return lenient;
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

/**
 * The strict policy for an address somebody typed: throws `HostPolicyError` unless the URL is http or https, has no user name
 * or password, uses the standard port (none given) and its host is, or resolves to, public addresses only. A name is resolved
 * and every address it answers with must be public; one that does not resolve is a `HostUnresolvedError`. The metadata
 * host names are refused without asking the resolver.
 *
 * Tests run lenient: loopback and any port are allowed and names are not resolved (unless a test stubs `setHostResolver`);
 * everything else is checked as usual. See the header of this file for what the check cannot guarantee.
 */
export async function assertPublicUrl(url: string | URL): Promise<void> {
  const parsed = typeof url === "string" ? new URL(url) : url;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HostPolicyError("scheme");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new HostPolicyError("credentials");
  }
  if (parsed.port !== "" && !lenient) throw new HostPolicyError("port");
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
    } catch (cause) {
      throw new HostUnresolvedError(cause);
    }
    if (addresses.length === 0 && !lenient) throw new HostUnresolvedError();
  }
  for (const address of addresses) {
    const found = classifyPublicAddress(address);
    if (found === "ok") continue;
    if (found === "loopback" && lenient) continue;
    throw new HostPolicyError(found);
  }
}
