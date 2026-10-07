import { isActionFailure, isHttpError, isRedirect } from "@sveltejs/kit";

interface CookieRecord {
  value: string;
  opts?: Record<string, unknown>;
}

export class FakeCookies {
  jar = new Map<string, CookieRecord>();
  deleted: string[] = [];

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.jar.set(k, { value: v });
  }
  get(name: string) {
    return this.jar.get(name)?.value;
  }
  getAll() {
    return [...this.jar].map(([name, r]) => ({ name, value: r.value }));
  }
  set(name: string, value: string, opts?: Record<string, unknown>) {
    this.jar.set(name, { value, opts });
  }
  delete(name: string) {
    this.jar.delete(name);
    this.deleted.push(name);
  }
  serialize(name: string, value: string, opts?: Record<string, unknown>) {
    const expires =
      opts?.expires instanceof Date
        ? `; Expires=${opts.expires.toUTCString()}`
        : "";
    return `${name}=${value}${expires}`;
  }
  options(name: string) {
    return this.jar.get(name)?.opts;
  }
}

export interface TestEventOptions {
  /** Becomes `event.locals` (`user`, `session`, `token`; the hook fills them in `callRoute`). */
  locals?: Record<string, unknown>;
  params?: Record<string, string>;
  url?: string;
  method?: string;
  form?: Record<string, string | File>;
  /** Raw request body (e.g. JSON); use with `headers`. */
  body?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  ip?: string;
  /** `event.fetch`: SvelteKit calls the app in process. The global fetch unless a test provides one. */
  fetch?: typeof fetch;
}

/**
 * A minimal stand-in for SvelteKit's RequestEvent. Cast to whatever the route
 * handler expects: `load(createTestEvent({ locals }) as never)`.
 */
export function createTestEvent(opts: TestEventOptions = {}) {
  const url = new URL(opts.url ?? "http://localhost/");
  const method =
    opts.method ?? (opts.form || opts.body !== undefined ? "POST" : "GET");
  let body: FormData | string | undefined = opts.body;
  if (opts.form) {
    body = new FormData();
    for (const [k, v] of Object.entries(opts.form)) body.append(k, v);
  }
  const cookies = new FakeCookies(opts.cookies);
  return {
    locals: { ...opts.locals },
    params: opts.params ?? {},
    url,
    request: new Request(url, { method, body, headers: opts.headers }),
    cookies,
    getClientAddress: () => opts.ip ?? "203.0.113.7",
    setHeaders: () => {},
    route: { id: url.pathname },
    isDataRequest: false,
    isSubRequest: false,
    platform: undefined,
    fetch: opts.fetch ?? globalThis.fetch,
  };
}

export type Outcome =
  | { type: "return"; value: unknown }
  | { type: "redirect"; status: number; location: string }
  | { type: "error"; status: number }
  | { type: "fail"; status: number; data: unknown };

/** Runs a handler and classifies what it did, so tests can assert on it. */
export async function outcome(fn: () => unknown): Promise<Outcome> {
  try {
    const value = await fn();
    if (isActionFailure(value)) {
      return { type: "fail", status: value.status, data: value.data };
    }
    return { type: "return", value };
  } catch (err) {
    if (isRedirect(err)) {
      return { type: "redirect", status: err.status, location: err.location };
    }
    if (isHttpError(err)) return { type: "error", status: err.status };
    throw err;
  }
}
