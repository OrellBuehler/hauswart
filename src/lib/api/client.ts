import type { z } from "zod";
import { ApiError, type ErrorCode } from "./errors";
import { pathParamNames, type AnyEndpoint } from "./registry";
import { errorEnvelopeSchema } from "./schemas/common";

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;
type In<S> = S extends z.ZodType ? z.input<S> : undefined;

type ParamsInput<E extends AnyEndpoint> = E["params"] extends z.ZodType
  ? { params: In<E["params"]> }
  : unknown;
type QueryInput<E extends AnyEndpoint> = E["query"] extends z.ZodType
  ? object extends In<E["query"]>
    ? { query?: In<E["query"]> }
    : { query: In<E["query"]> }
  : unknown;
type BodyInput<E extends AnyEndpoint> = E["body"] extends z.ZodType
  ? { body: In<E["body"]> }
  : unknown;

/** What `api.call` needs for an endpoint: path params, query and body, as the schemas accept them. */
export type CallInput<E extends AnyEndpoint> = ParamsInput<E> &
  QueryInput<E> &
  BodyInput<E>;

type CallArgs<E extends AnyEndpoint> =
  object extends CallInput<E> ? [input?: CallInput<E>] : [input: CallInput<E>];

/** Parsed response body of an endpoint (`null` for 204 endpoints). */
export type CallResult<E extends AnyEndpoint> = Out<E["response"]>;

/** What the client needs from `fetch`: SvelteKit's `event.fetch`, the global `fetch` or a test double. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ApiClientOptions {
  /** Bearer token (or a function returning it) for non-browser callers such as the MCP server. */
  token?: string | (() => string | undefined);
  headers?: Record<string, string>;
}

export interface ApiClient {
  call<E extends AnyEndpoint>(
    endpoint: E,
    ...args: CallArgs<E>
  ): Promise<CallResult<E>>;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

function buildUrl(
  baseUrl: string,
  endpoint: AnyEndpoint,
  input: { params?: Record<string, unknown>; query?: Record<string, unknown> },
): string {
  let path = endpoint.path;
  for (const name of pathParamNames(endpoint.path)) {
    const value = input.params?.[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`${endpoint.id}: missing path parameter "${name}"`);
    }
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, String(item));
    }
  }
  const qs = search.toString();
  return `${baseUrl.replace(/\/+$/, "")}${path}${qs ? `?${qs}` : ""}`;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return undefined;
  }
}

function errorFrom(res: Response, json: unknown): ApiError {
  const envelope = errorEnvelopeSchema.safeParse(json);
  if (envelope.success) {
    const { code, message, details } = envelope.data.error;
    return new ApiError(code, message, { status: res.status, details });
  }
  return new ApiError(
    STATUS_CODES[res.status] ?? "internal",
    `Request failed with status ${res.status}`,
    { status: res.status },
  );
}

/**
 * Typed client generated from the registry. Pass `event.fetch` inside a
 * SvelteKit `load` (it forwards the session cookie), the global `fetch` in the
 * browser, or an absolute `baseUrl` plus a `token` outside of SvelteKit.
 */
export function createApiClient(
  fetchFn: FetchLike,
  baseUrl = "",
  options: ApiClientOptions = {},
): ApiClient {
  return {
    async call<E extends AnyEndpoint>(
      endpoint: E,
      ...args: CallArgs<E>
    ): Promise<CallResult<E>> {
      const input = (args[0] ?? {}) as {
        params?: Record<string, unknown>;
        query?: Record<string, unknown>;
        body?: unknown;
      };
      const headers: Record<string, string> = {
        accept: "application/json",
        ...options.headers,
      };
      const token =
        typeof options.token === "function" ? options.token() : options.token;
      if (token) headers.authorization = `Bearer ${token}`;

      const init: RequestInit = { method: endpoint.method, headers };
      if (endpoint.body && input.body !== undefined) {
        if (endpoint.bodyType === "multipart") {
          init.body = input.body as FormData;
        } else {
          headers["content-type"] = "application/json";
          init.body = JSON.stringify(input.body);
        }
      }

      const res = await fetchFn(buildUrl(baseUrl, endpoint, input), init);
      const json = await readJson(res);
      if (!res.ok) throw errorFrom(res, json);

      const parsed = endpoint.response.safeParse(json ?? null);
      if (!parsed.success) {
        throw new ApiError(
          "internal",
          "The server response did not match the API contract",
          { status: res.status, details: parsed.error.issues },
        );
      }
      return parsed.data as CallResult<E>;
    },
  };
}
