import type { RequestEvent } from "@sveltejs/kit";
import { SESSION_COOKIE } from "$lib/api/constants";
import type { FetchLike } from "$lib/api/client";
import { handle } from "../../hooks.server";
import { callRoute, type CallOptions, type RouteResult } from "./route";
import { createTestEvent } from "./event";

type Handler = (event: RequestEvent) => Response | Promise<Response>;
type RouteModule = Record<string, Handler | undefined>;

const modules = import.meta.glob<RouteModule>(
  "/src/routes/api/v1/**/+server.ts",
  { eager: true },
);

interface Route {
  pattern: RegExp;
  names: string[];
  module: RouteModule;
  /** Literal segments first, so `/tasks/preview` wins over `/tasks/[id]`. */
  specificity: number;
}

const routes: Route[] = Object.entries(modules).map(([file, module]) => {
  const path = file.replace("/src/routes", "").replace(/\/\+server\.ts$/, "");
  const names: string[] = [];
  const source = path
    .split("/")
    .map((segment) => {
      const param = /^\[(\w+)\]$/.exec(segment);
      if (!param) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(param[1]);
      return "([^/]+)";
    })
    .join("/");
  return {
    pattern: new RegExp(`^${source}$`),
    names,
    module,
    specificity: names.length,
  };
});
routes.sort((a, b) => a.specificity - b.specificity);

export function findRoute(pathname: string) {
  for (const route of routes) {
    const hit = route.pattern.exec(pathname);
    if (hit) {
      return {
        module: route.module,
        params: Object.fromEntries(
          route.names.map((name, i) => [name, decodeURIComponent(hit[i + 1])]),
        ),
      };
    }
  }
  return null;
}

export interface InProcessAuth {
  session?: string;
  bearer?: string;
}

/**
 * A `fetch` that serves `/api/v1` from the route handlers in this process
 * (through the real hook), so the typed client, a script or the seed importer
 * can be tested without a server.
 */
export function createInProcessFetch(auth: InProcessAuth = {}): FetchLike {
  const inProcess: FetchLike = async (input, init = {}) => {
    const url = new URL(input, "http://localhost");
    const found = findRoute(url.pathname);
    if (!found) return new Response("not found", { status: 404 });
    const method = (init.method ?? "GET").toUpperCase();
    const handler = found.module[method];
    if (!handler) return new Response("method not allowed", { status: 405 });
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    if (auth.bearer) headers.authorization = `Bearer ${auth.bearer}`;
    if (method !== "GET" && !headers.origin) headers.origin = url.origin;
    const event = createTestEvent({
      url: url.toString(),
      method,
      params: found.params,
      headers,
      body: typeof init.body === "string" ? init.body : undefined,
      form:
        init.body instanceof FormData
          ? (Object.fromEntries(init.body.entries()) as Record<
              string,
              string | File
            >)
          : undefined,
      cookies: auth.session ? { [SESSION_COOKIE]: auth.session } : {},
      // `event.fetch` calls the app in process here too, as it does in SvelteKit.
      fetch: inProcess as typeof fetch,
    });
    return handle({
      event: event as never,
      resolve: ((e: RequestEvent) => handler(e)) as never,
    });
  };
  return inProcess;
}

/** The `event.fetch` of route tests: handlers that call the app (the MCP endpoint) reach it in process. */
const inProcessEventFetch = createInProcessFetch() as typeof fetch;

type Auth = { session: string } | { bearer: string };

export interface ApiCall {
  (
    method: string,
    path: string,
    opts?: Omit<
      CallOptions,
      "method" | "url" | "session" | "bearer" | "params"
    >,
  ): Promise<RouteResult>;
}

/** `call("POST", "/api/v1/rooms", { json })` through the real route and hook. */
export function createCaller(auth: Auth): ApiCall {
  return (method, path, opts = {}) => {
    const url = new URL(path, "http://localhost");
    const found = findRoute(url.pathname);
    const handler = found?.module[method];
    if (!found || !handler) {
      throw new Error(`No route for ${method} ${url.pathname}`);
    }
    return callRoute(handler, {
      fetch: inProcessEventFetch,
      ...opts,
      url: url.toString(),
      method,
      params: found.params,
      ...auth,
    });
  };
}

export const errorCode = (r: { body: unknown }): string | undefined =>
  (r.body as { error?: { code?: string } } | null)?.error?.code;
