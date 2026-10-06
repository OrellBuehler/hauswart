import { z } from "zod";

/**
 * Transport helpers shared by the integration clients: fetch with timeout and
 * TLS opt-in, status classification, size-capped bodies, Zod-parsed JSON.
 * Nothing here knows an external system; each client supplies a `Fail`
 * factory that builds its own typed error.
 */

export const HTTP_ERROR_CODES = [
  "invalid_url",
  "unauthorized",
  "forbidden",
  "not_found",
  "bad_request",
  "redirect",
  "timeout",
  "network",
  "tls",
  "server",
  "invalid_response",
  "too_large",
] as const;
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];

export interface FailOptions {
  status?: number;
  detail?: string;
  cause?: unknown;
}

/** Builds the client's own error for a transport failure. */
export type Fail = (code: HttpErrorCode, options?: FailOptions) => Error;

/** Message for a transport failure; `service` is the display name, e.g. "Paperless". */
export function httpMessage(service: string, code: HttpErrorCode): string {
  switch (code) {
    case "invalid_url":
      return "Enter a valid http:// or https:// address without credentials.";
    case "unauthorized":
      return `${service} rejected the access token.`;
    case "forbidden":
      return `The ${service} user does not have permission for this request.`;
    case "not_found":
      return `${service} could not find the requested item.`;
    case "bad_request":
      return `${service} rejected the request.`;
    case "redirect":
      return `${service} answered with a redirect. Check that the address uses the right scheme (https) and host.`;
    case "timeout":
      return `${service} did not answer in time.`;
    case "network":
      return `${service} could not be reached.`;
    case "tls":
      return `The TLS certificate of ${service} could not be verified. Fix the certificate or allow insecure TLS for this connection.`;
    case "server":
      return `${service} reported a server error.`;
    case "invalid_response":
      return `${service} sent a response that could not be understood.`;
    case "too_large":
      return `The response from ${service} is too large.`;
  }
}

/** Appends `(detail)` to a message that ends in a full stop. */
export function withDetail(message: string, detail?: string): string {
  return detail ? `${message.replace(/\.$/, "")} (${detail}).` : message;
}

/** Short machine-readable code of any thrown value, for logs. Never includes a message. */
export function errorCodeOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return err instanceof Error ? err.name : "unknown";
}

/**
 * http/https only, no credentials, no query or fragment, no trailing slash.
 * A path prefix (reverse proxy sub-path) is kept.
 *
 * Private, loopback and LAN addresses are allowed on purpose: the external
 * systems are self-hosted and sit on the same network, and the URL is entered
 * by an administrator of this instance, never by an anonymous caller. There is
 * therefore no SSRF host filter. Redirects are never followed and the token is
 * only sent to this base URL.
 */
export function normalizeBaseUrl(input: string, fail: Fail): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch (cause) {
    throw fail("invalid_url", { cause });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fail("invalid_url");
  }
  if (url.username !== "" || url.password !== "") throw fail("invalid_url");
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/**
 * Rejects a token that is empty or contains whitespace or control characters,
 * before it can reach a header (where a runtime error would quote it).
 */
export function assertToken(token: string, fail: Fail): void {
  if (typeof token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
    throw fail("unauthorized", { detail: "the access token is not valid" });
  }
}

export type Query =
  | URLSearchParams
  | Record<string, string | number | boolean>
  | Array<[string, string]>;

export function toSearch(query: Query | undefined): URLSearchParams {
  if (!query) return new URLSearchParams();
  if (query instanceof URLSearchParams) return new URLSearchParams(query);
  if (Array.isArray(query)) return new URLSearchParams(query);
  return new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  );
}

const TLS_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERTIFICATE_VERIFY_FAILED",
  "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
]);

/** Turns whatever fetch (or a body read) threw into the client's typed error. */
export function classifyFetchError(err: unknown, fail: Fail): Error {
  const name = err instanceof Error ? err.name : "";
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  const message = err instanceof Error ? err.message : "";
  if (name === "TimeoutError" || code === "ETIMEDOUT") {
    return fail("timeout", { cause: err });
  }
  if (name === "AbortError") return fail("timeout", { cause: err });
  if (TLS_CODES.has(code)) return fail("tls", { cause: err });
  if (/certificate|self[- ]signed|\bssl\b|\btls\b/i.test(message)) {
    return fail("tls", { cause: err });
  }
  return fail("network", { detail: "the connection failed", cause: err });
}

export interface RequestInitLite {
  method: string;
  headers: Headers;
  body?: BodyInit;
  timeoutMs: number;
  allowInsecureTls?: boolean;
}

/**
 * One fetch. Redirects are never followed (a redirect target could be another
 * host that would receive the token); the caller sees the 3xx and fails.
 * The timeout covers the response body as well.
 */
export async function fetchOnce(
  url: string,
  init: RequestInitLite,
  fail: Fail,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs),
      // Opt-in per connection for self-signed certificates on a private network; off by default.
      ...(init.allowInsecureTls
        ? // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
          { tls: { rejectUnauthorized: false } }
        : {}),
    } as RequestInit);
  } catch (err) {
    throw classifyFetchError(err, fail);
  }
}

export async function discard(res: Response, service: string): Promise<void> {
  try {
    await res.body?.cancel();
  } catch (err) {
    console.warn(
      `${service}: could not discard a response body`,
      errorCodeOf(err),
    );
  }
}

/**
 * Passes 2xx through and throws the classified error for everything else.
 * `override` may map a status to a code first (for example 406 → "version").
 */
export async function checkStatus<C extends string = HttpErrorCode>(
  res: Response,
  service: string,
  fail: (code: C | HttpErrorCode, options?: FailOptions) => Error,
  override?: (status: number) => C | undefined,
): Promise<Response> {
  if (res.ok) return res;
  const status = res.status;
  await discard(res, service);
  const special = override?.(status);
  if (special) throw fail(special, { status });
  if (status >= 300 && status < 400) throw fail("redirect", { status });
  if (status === 401) throw fail("unauthorized", { status });
  if (status === 403) throw fail("forbidden", { status });
  if (status === 404) throw fail("not_found", { status });
  if (status === 408 || status === 429 || status >= 500) {
    throw fail("server", { status });
  }
  if (status >= 400) throw fail("bad_request", { status });
  throw fail("invalid_response", { status, detail: `status ${status}` });
}

function declaredLength(res: Response): number | null {
  const raw = res.headers.get("content-length");
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Reads a response body, failing with `too_large` once it exceeds `max` bytes. */
export async function readCapped(
  res: Response,
  max: number,
  service: string,
  fail: Fail,
): Promise<Uint8Array> {
  const declared = declaredLength(res);
  if (declared !== null && declared > max) {
    await discard(res, service);
    throw fail("too_large");
  }
  if (!res.body) throw fail("invalid_response", { detail: "empty body" });
  const chunks: Uint8Array[] = [];
  let total = 0;
  let exceeded = false;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        exceeded = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch (err) {
    throw classifyFetchError(err, fail);
  }
  if (exceeded) throw fail("too_large");
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Reads a size-capped JSON body and validates it. Error messages never echo the body. */
export async function readJson<S extends z.ZodType>(
  res: Response,
  schema: S,
  max: number,
  service: string,
  fail: Fail,
): Promise<z.output<S>> {
  const body = await readCapped(res, max, service, fail);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(body));
  } catch (cause) {
    throw fail("invalid_response", { detail: "not JSON", cause });
  }
  return parseWith(schema, data, fail);
}

/** Zod parse that reports only the path of the first problem, never values. */
export function parseWith<S extends z.ZodType>(
  schema: S,
  data: unknown,
  fail: Fail,
): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const at = parsed.error.issues[0]?.path.join(".") ?? "";
    throw fail("invalid_response", {
      detail: at ? `unexpected shape at ${at}` : "unexpected shape",
    });
  }
  return parsed.data;
}

/**
 * Wraps a response body so that reading more than `max` bytes errors the
 * stream with `too_large` and cancels the upstream. A declared
 * `Content-Length` above the cap is refused before any byte is read.
 */
export async function boundedStream(
  res: Response,
  max: number,
  service: string,
  fail: Fail,
): Promise<ReadableStream<Uint8Array>> {
  const declared = declaredLength(res);
  if (declared !== null && declared > max) {
    await discard(res, service);
    throw fail("too_large");
  }
  if (!res.body) throw fail("invalid_response", { detail: "empty body" });
  const reader = res.body.getReader();
  let total = 0;
  const cancelUpstream = async (reason?: unknown) => {
    try {
      await reader.cancel(reason);
    } catch (err) {
      console.warn(`${service}: could not cancel a stream`, errorCodeOf(err));
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > max) {
          await cancelUpstream();
          controller.error(fail("too_large"));
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(classifyFetchError(err, fail));
      }
    },
    cancel: (reason) => cancelUpstream(reason),
  });
}
