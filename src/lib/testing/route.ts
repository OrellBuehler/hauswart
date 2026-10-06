import type { RequestEvent } from "@sveltejs/kit";
import { SESSION_COOKIE } from "$lib/api/constants";
import { handle } from "../../hooks.server";
import {
  createTestEvent,
  type FakeCookies,
  type TestEventOptions,
} from "./event";

export interface CallOptions extends Omit<TestEventOptions, "body" | "locals"> {
  /** Session token (from `loginTestUser`), sent as the session cookie. */
  session?: string;
  /** API token plaintext, sent as `Authorization: Bearer`. */
  bearer?: string;
  /** JSON request body; sets `content-type: application/json`. */
  json?: unknown;
  /** Raw body, for malformed-input tests. */
  rawBody?: string;
  /** `Origin` header. Defaults to the app origin on state-changing requests; null sends none. */
  origin?: string | null;
}

export interface RouteResult {
  res: Response;
  /** Parsed JSON, text for other text types, bytes (`Uint8Array`) for files; null when empty. */
  body: unknown;
  cookies: FakeCookies;
  event: ReturnType<typeof createTestEvent>;
}

/**
 * Runs a route handler through the real `handle` hook, the way a request
 * reaches it in production: hook auth, then the handler. Same-origin and JSON
 * headers are filled in unless overridden.
 */
export async function callRoute(
  handler: (event: RequestEvent) => Response | Promise<Response>,
  opts: CallOptions = {},
): Promise<RouteResult> {
  const {
    session,
    bearer,
    json,
    rawBody,
    origin,
    headers = {},
    ...rest
  } = opts;
  const url = rest.url ?? "http://localhost/";
  const method =
    rest.method ??
    (json !== undefined || rawBody !== undefined || rest.form !== undefined
      ? "POST"
      : "GET");
  const merged: Record<string, string> = { ...headers };
  const has = (name: string) =>
    Object.keys(merged).some((k) => k.toLowerCase() === name);
  if (json !== undefined || rawBody !== undefined) {
    if (!has("content-type")) merged["content-type"] = "application/json";
  }
  if (bearer) merged.authorization = `Bearer ${bearer}`;
  if (origin !== null && !has("origin") && method !== "GET") {
    merged.origin = origin ?? new URL(url).origin;
  } else if (origin) {
    merged.origin = origin;
  }
  const event = createTestEvent({
    ...rest,
    url,
    method,
    headers: merged,
    body: rawBody ?? (json === undefined ? undefined : JSON.stringify(json)),
    cookies: {
      ...(session ? { [SESSION_COOKIE]: session } : {}),
      ...rest.cookies,
    },
  });
  const res = await handle({
    event: event as never,
    resolve: ((e: RequestEvent) => handler(e)) as never,
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (bytes.length > 0) {
    if (/^(image|application\/(pdf|octet-stream))/i.test(type)) {
      body = bytes;
    } else {
      const text = new TextDecoder().decode(bytes);
      try {
        body = JSON.parse(text);
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        body = text;
      }
    }
  }
  return { res, body, cookies: event.cookies, event };
}
