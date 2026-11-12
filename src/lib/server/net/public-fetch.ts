import { FROM_URL_ERROR_CODES } from "$lib/api/schemas/attachments";
import {
  HostPolicyError,
  HostUnresolvedError,
  assertPublicUrl,
} from "./host-policy";

/**
 * Downloads a file from an address a person or an assistant gave, for attaching it somewhere. This is the one place where the
 * server fetches an address nobody vetted when it was saved, so everything is strict:
 *
 * - every request, the first and each redirect, passes `assertPublicUrl` (http and https, no credentials, standard ports,
 *   public addresses only, every address a name resolves to); a redirect to anything else is `blocked_host`
 * - redirects are followed by hand, `maxRedirects` at most (`too_many_redirects` beyond that)
 * - one timeout covers the whole exchange including the body (`unreachable`)
 * - the body is read with a cap and the read stops when it is reached (`too_large`)
 * - the request carries a plain user agent and an `Accept` header and nothing of the household
 *
 * Like the other host checks it cannot pin the address `fetch` connects to, so a name that changes its answer between the
 * check and the connection (DNS rebinding) is not caught.
 */

export type FromUrlErrorCode = (typeof FROM_URL_ERROR_CODES)[number];

export class PublicFetchError extends Error {
  override name = "PublicFetchError";
  constructor(
    readonly code: FromUrlErrorCode,
    message: string,
    readonly options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
  }

  /** The status code of the answer, for `upstream_status`. */
  get status(): number | undefined {
    return this.options.status;
  }
}

export const PUBLIC_FETCH_TIMEOUT_MS = 15_000;
export const PUBLIC_FETCH_MAX_REDIRECTS = 3;

export interface PublicFetchOptions {
  /** The most bytes of the body; a longer one is `too_large`. */
  maxBytes: number;
  userAgent: string;
  /** The `Accept` header. */
  accept: string;
  /** For the whole exchange, body included. Default `PUBLIC_FETCH_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Default `PUBLIC_FETCH_MAX_REDIRECTS`. */
  maxRedirects?: number;
}

export interface PublicFile {
  bytes: Uint8Array;
  /** The address the bytes came from, after redirects. */
  url: URL;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** What the caller reads: the policy's sentence, except for loopback, which is not for anybody here (its sentence names administrators). */
const blockedMessage = (err: HostPolicyError) =>
  `This address is not allowed: ${
    err.reason === "loopback"
      ? "Loopback addresses are not allowed."
      : err.message
  }`;

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch (err) {
    // The connection is dropped either way; say so in the log by name only.
    console.warn(
      JSON.stringify({
        event: "net.public_fetch_discard_failed",
        name: err instanceof Error ? err.name : "NonError",
      }),
    );
  }
}

/** Reads a body, stopping with `too_large` as soon as it is longer than `max`. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await discard(res);
    throw new PublicFetchError("too_large", "The file is too large.");
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new PublicFetchError("too_large", "The file is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Turns whatever a request or a body read threw into the error the caller reports. */
function classify(err: unknown): PublicFetchError {
  if (err instanceof PublicFetchError) return err;
  if (err instanceof HostPolicyError) {
    return new PublicFetchError("blocked_host", blockedMessage(err), {
      cause: err,
    });
  }
  if (err instanceof HostUnresolvedError) {
    return new PublicFetchError(
      "unreachable",
      "The host name does not resolve.",
      {
        cause: err,
      },
    );
  }
  const timedOut =
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError");
  return new PublicFetchError(
    "unreachable",
    timedOut
      ? "The server did not answer in time."
      : "The server could not be reached.",
    { cause: err },
  );
}

export async function fetchPublicFile(
  address: string,
  options: PublicFetchOptions,
): Promise<PublicFile> {
  const signal = AbortSignal.timeout(
    options.timeoutMs ?? PUBLIC_FETCH_TIMEOUT_MS,
  );
  const maxRedirects = options.maxRedirects ?? PUBLIC_FETCH_MAX_REDIRECTS;
  try {
    let current = new URL(address);
    for (let redirects = 0; ; redirects += 1) {
      await assertPublicUrl(current);
      const res = await fetch(current.href, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { accept: options.accept, "user-agent": options.userAgent },
      });
      if (REDIRECTS.has(res.status)) {
        await discard(res);
        const location = res.headers.get("location");
        if (!location || !URL.canParse(location, current)) {
          throw new PublicFetchError(
            "upstream_status",
            `The server answered ${res.status} without a usable address to go to.`,
            { status: res.status },
          );
        }
        if (redirects >= maxRedirects) {
          throw new PublicFetchError(
            "too_many_redirects",
            `The address redirects more than ${maxRedirects} times.`,
          );
        }
        current = new URL(location, current);
        continue;
      }
      if (!res.ok) {
        await discard(res);
        throw new PublicFetchError(
          "upstream_status",
          `The server answered ${res.status}.`,
          { status: res.status },
        );
      }
      return { bytes: await readCapped(res, options.maxBytes), url: current };
    }
  } catch (err) {
    throw classify(err);
  }
}
