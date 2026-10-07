import { json, isRedirect, type RequestEvent } from "@sveltejs/kit";
import { z } from "zod";
import { ApiError } from "$lib/api/errors";
import type { AnyEndpoint } from "$lib/api/registry";
import { todayInHouseholdZone } from "$lib/server/config";
import { getDB } from "$lib/server/db";
import { clientKey } from "$lib/server/auth/login";
import {
  publicRequestLimiter,
  tokenRequestLimiter,
} from "$lib/server/auth/rate-limit";
import {
  requirePrincipal,
  requireScopes,
  resolvePrincipal,
} from "$lib/server/auth/guards";
import type { Principal } from "$lib/server/auth/types";
import type { ContextFor } from "./context";
import { rateLimitedError, toApiError } from "./errors";

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;
type MaybePromise<T> = T | Promise<T>;

/** A non-default status for one response, e.g. `reply(202, body)`. */
export class Reply<T> {
  constructor(
    readonly status: number,
    readonly body: T,
  ) {}
}

export function reply<T>(status: number, body: T): Reply<T> {
  return new Reply(status, body);
}

export interface HandlerArgs<E extends AnyEndpoint> {
  ctx: ContextFor<E["auth"]>;
  params: Out<E["params"]>;
  query: Out<E["query"]>;
  body: Out<E["body"]>;
  /** For cookies and the client address only; never read request data from it. */
  event: RequestEvent;
}

type ResponseInput<E extends AnyEndpoint> = z.input<E["response"]>;

/**
 * JSON endpoints return the response body (or `reply(status, body)`); binary endpoints return a
 * finished `Response` (headers, status and body are theirs, `bind` only passes it through).
 */
export type HandlerResult<E extends AnyEndpoint> =
  E["responseType"] extends "binary"
    ? Response
    : ResponseInput<E> | Reply<ResponseInput<E>>;

export type Handler<E extends AnyEndpoint> = (
  args: HandlerArgs<E>,
) => MaybePromise<HandlerResult<E>>;

export type BoundHandler<E extends AnyEndpoint> = ((
  event: RequestEvent,
) => Promise<Response>) & { endpoint: E };

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;
const MULTIPART_CONTENT_TYPE = /^multipart\/form-data\s*(;|$)/i;
const NO_STORE = { "cache-control": "no-store" };

class ResponseContractError extends Error {
  constructor(endpointId: string) {
    super(`Response of ${endpointId} does not match its schema`);
    this.name = "ResponseContractError";
  }
}

/** Response validation costs little but is only a development aid: off in production. */
function validatesResponses(): boolean {
  // Bun.env, not process.env: the bundler folds `process.env.NODE_ENV` at build time.
  return Bun.env.NODE_ENV !== "production";
}

function authorize(endpoint: AnyEndpoint, principal: Principal | null) {
  if (endpoint.auth === "public") return;
  const caller = requirePrincipal(principal);
  if (endpoint.auth === "session" && caller.auth !== "session") {
    throw new ApiError("forbidden", "This endpoint requires a browser session");
  }
  if (endpoint.auth === "bearer" && caller.auth !== "token") {
    throw new ApiError("forbidden", "This endpoint requires an API token");
  }
  requireScopes(caller, endpoint.scopes);
}

/**
 * Cookies are sent by browsers on cross-site requests, bearer tokens are not,
 * so only cookie-authenticated (or cookie-setting) state changes are checked:
 * the `Origin` header must be the app's own origin, and the body must be a
 * type a cross-site HTML form cannot send.
 */
function checkCsrf(
  endpoint: AnyEndpoint,
  principal: Principal | null,
  event: RequestEvent,
) {
  const { request, url } = event;
  if (SAFE_METHODS.has(request.method)) return;
  if (principal?.auth !== "session" && !endpoint.setsSession) return;

  if (request.headers.get("origin") !== url.origin) {
    throw new ApiError("csrf_failed", "Cross-origin request rejected");
  }
  const contentType = request.headers.get("content-type") ?? "";
  const accepted = endpoint.body
    ? (endpoint.bodyType === "multipart"
        ? MULTIPART_CONTENT_TYPE
        : JSON_CONTENT_TYPE
      ).test(contentType)
    : contentType === "" || JSON_CONTENT_TYPE.test(contentType);
  if (!accepted) {
    throw new ApiError("csrf_failed", "Unsupported content type");
  }
}

function payloadTooLarge(): ApiError {
  return new ApiError("invalid_request", "Request body too large", {
    status: 413,
  });
}

/** Reads the body, counting bytes as they arrive: a chunked body cannot outgrow `max`. */
async function readBytes(request: Request, max: number): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) throw payloadTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw payloadTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readText(request: Request, max: number): Promise<string> {
  return new TextDecoder().decode(await readBytes(request, max));
}

async function readFormData(request: Request, max: number): Promise<FormData> {
  const bytes = await readBytes(request, max);
  try {
    return await new Response(bytes as BodyInit, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    throw new ApiError(
      "invalid_request",
      "Body is not valid multipart/form-data",
    );
  }
}

function multiValueObject(entries: Iterable<[string, unknown]>) {
  const grouped = new Map<string, unknown[]>();
  for (const [key, value] of entries) {
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return Object.fromEntries(
    [...grouped].map(([key, values]) => [
      key,
      values.length === 1 ? values[0] : values,
    ]),
  );
}

async function readBody(
  endpoint: AnyEndpoint,
  request: Request,
): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (endpoint.bodyType === "multipart") {
    if (!MULTIPART_CONTENT_TYPE.test(contentType)) {
      throw new ApiError("invalid_request", "Expected multipart/form-data", {
        status: 415,
      });
    }
    const form = await readFormData(request, endpoint.maxBodyBytes);
    return multiValueObject(form.entries());
  }
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    throw new ApiError("invalid_request", "Expected application/json", {
      status: 415,
    });
  }
  const text = await readText(request, endpoint.maxBodyBytes);
  if (text.trim() === "") {
    throw new ApiError("invalid_request", "Request body is required");
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    throw new ApiError("invalid_request", "Body is not valid JSON");
  }
}

interface Parsed {
  params: unknown;
  query: unknown;
  body: unknown;
}

async function parseInput(
  endpoint: AnyEndpoint,
  event: RequestEvent,
): Promise<Parsed> {
  const issues: Record<string, unknown> = {};
  const parse = (
    source: string,
    schema: z.ZodType | undefined,
    raw: unknown,
  ) => {
    if (!schema) return undefined;
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    issues[source] = flatten(result.error);
    return undefined;
  };

  const params = parse("params", endpoint.params, event.params);
  const query = parse(
    "query",
    endpoint.query,
    multiValueObject(event.url.searchParams.entries()),
  );
  // Body last: a malformed or oversized body is reported even if params were fine.
  const rawBody = endpoint.body
    ? await readBody(endpoint, event.request)
    : undefined;
  const body = parse("body", endpoint.body, rawBody);

  if (Object.keys(issues).length > 0) {
    throw new ApiError("invalid_request", "Invalid request", {
      details: issues,
    });
  }
  return { params, query, body };
}

function flatten(error: z.ZodError) {
  const { formErrors, fieldErrors } = z.flattenError(error);
  return { formErrors, fieldErrors };
}

/**
 * A binary endpoint's handler returns a finished `Response`; `bind` passes it through. Outside
 * production the status and content type are checked against the registry. A handler that sets
 * no `Cache-Control` gets `no-store`.
 */
function respondBinary(endpoint: AnyEndpoint, result: unknown): Response {
  if (!(result instanceof Response))
    throw new ResponseContractError(endpoint.id);
  if (validatesResponses()) {
    const type = (result.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    // 304 and an empty 202 or 204 (the MCP endpoint's answer to a notification) have no content type.
    const bodyless =
      result.status === 304 ||
      ((result.status === 202 || result.status === 204) &&
        result.body === null);
    if (!bodyless && (!result.ok || !endpoint.contentTypes.includes(type))) {
      throw new ResponseContractError(endpoint.id);
    }
  }
  if (result.headers.has("cache-control")) return result;
  const headers = new Headers(result.headers);
  headers.set("cache-control", "no-store");
  return new Response(result.body, { status: result.status, headers });
}

function respond(endpoint: AnyEndpoint, result: unknown): Response {
  if (endpoint.responseType === "binary")
    return respondBinary(endpoint, result);
  const status = result instanceof Reply ? result.status : endpoint.status;
  const body = result instanceof Reply ? result.body : result;
  if (validatesResponses()) {
    const check = endpoint.response.safeParse(body ?? null);
    if (!check.success) throw new ResponseContractError(endpoint.id);
  }
  if (status === 204) {
    return new Response(null, { status, headers: NO_STORE });
  }
  return json(body, { status, headers: NO_STORE });
}

function errorResponse(endpoint: AnyEndpoint, err: unknown): Response {
  const apiError = toApiError(err);
  if (!apiError) {
    // Name and code only: messages and causes can contain user data.
    console.error(
      JSON.stringify({
        event: "api.error",
        endpoint: endpoint.id,
        name: err instanceof Error ? err.name : "NonError",
        code:
          typeof (err as { code?: unknown } | null)?.code === "string"
            ? (err as { code: string }).code
            : undefined,
      }),
    );
    return json(new ApiError("internal", "Internal server error").toBody(), {
      status: 500,
      headers: NO_STORE,
    });
  }
  const headers: Record<string, string> = { ...NO_STORE };
  const details = apiError.details as
    { retryAfterSeconds?: unknown } | undefined;
  if (
    apiError.code === "rate_limited" &&
    typeof details?.retryAfterSeconds === "number"
  ) {
    headers["retry-after"] = String(details.retryAfterSeconds);
  }
  return json(apiError.toBody(), { status: apiError.status, headers });
}

/**
 * Turns a registry entry plus a handler into a SvelteKit request handler:
 * authentication mode and scopes, CSRF, Zod parsing of params, query and
 * body, error mapping and (outside production) response validation. Route
 * files contain nothing but `export const GET = bind(endpoints.x, handler)`.
 */
export function bind<E extends AnyEndpoint>(
  endpoint: E,
  handler: Handler<E>,
): BoundHandler<E> {
  const run = async (event: RequestEvent): Promise<Response> => {
    try {
      const principal = resolvePrincipal(event.locals);

      if (
        endpoint.auth === "public" &&
        !SAFE_METHODS.has(event.request.method)
      ) {
        const hit = publicRequestLimiter.hit(clientKey(event.getClientAddress));
        if (!hit.allowed) throw rateLimitedError(hit.retryAfterMs);
      }
      if (principal?.auth === "token") {
        const hit = tokenRequestLimiter.hit(principal.token.id);
        if (!hit.allowed) throw rateLimitedError(hit.retryAfterMs);
      }

      authorize(endpoint, principal);
      checkCsrf(endpoint, principal, event);
      const { params, query, body } = await parseInput(endpoint, event);

      const ctx = {
        db: getDB(),
        user: principal?.user ?? null,
        principal,
        now: Date.now(),
        today: todayInHouseholdZone(),
      } as ContextFor<E["auth"]>;
      const result = await handler({
        ctx,
        params: params as Out<E["params"]>,
        query: query as Out<E["query"]>,
        body: body as Out<E["body"]>,
        event,
      });
      return respond(endpoint, result);
    } catch (err) {
      if (isRedirect(err)) throw err;
      return errorResponse(endpoint, err);
    }
  };
  return Object.assign(run, { endpoint });
}
