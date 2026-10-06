import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertToken,
  boundedStream,
  checkStatus,
  classifyFetchError,
  errorCodeOf,
  fetchOnce,
  normalizeBaseUrl,
  readCapped,
  readJson,
  toSearch,
  withDetail,
  type Fail,
  type HttpErrorCode,
} from "./http";
import { z } from "zod";
import {
  setHostResolver,
  setLenientHostPolicy,
} from "$lib/server/net/host-policy";

class TestError extends Error {
  constructor(
    readonly code: string,
    readonly options?: { status?: number; detail?: string },
  ) {
    super(code);
  }
}
const fail: Fail = (code, options) => new TestError(code, options);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as TestError).code;
  }
  return "none";
}

const chunks = (...sizes: number[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const n of sizes) c.enqueue(new Uint8Array(n).fill(65));
      c.close();
    },
  });

describe("classifyFetchError", () => {
  const code = (err: unknown) =>
    (classifyFetchError(err, fail) as TestError).code;

  it("recognises timeouts, TLS problems and everything else", () => {
    expect(code(new DOMException("t", "TimeoutError"))).toBe("timeout");
    expect(code(new DOMException("a", "AbortError"))).toBe("timeout");
    expect(
      code(
        Object.assign(new Error("x"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
      ),
    ).toBe("tls");
    expect(code(new Error("unable to verify the first certificate"))).toBe(
      "tls",
    );
    expect(code(new Error("self signed certificate"))).toBe("tls");
    expect(code(new Error("connect ECONNREFUSED"))).toBe("network");
    expect(code("weird")).toBe("network");
  });
});

describe("checkStatus", () => {
  const status = (
    s: number,
    override?: (n: number) => HttpErrorCode | undefined,
  ) =>
    codeOf(
      checkStatus(new Response("body", { status: s }), "x", fail, override),
    );

  it("passes 2xx through and classifies the rest", async () => {
    const ok = new Response("{}", { status: 200 });
    expect(await checkStatus(ok, "x", fail)).toBe(ok);
    expect(await status(301)).toBe("redirect");
    expect(await status(401)).toBe("unauthorized");
    expect(await status(403)).toBe("forbidden");
    expect(await status(404)).toBe("not_found");
    expect(await status(400)).toBe("bad_request");
    expect(await status(409)).toBe("bad_request");
    expect(await status(422)).toBe("bad_request");
    expect(await status(408)).toBe("server");
    expect(await status(429)).toBe("server");
    expect(await status(502)).toBe("server");
  });

  it("lets a client override a status first", async () => {
    expect(
      await status(406, (n) => (n === 406 ? "invalid_url" : undefined)),
    ).toBe("invalid_url");
  });
});

describe("bodies", () => {
  it("readCapped honours declared and actual sizes", async () => {
    expect(
      await codeOf(
        readCapped(
          new Response("x".repeat(100), {
            headers: { "content-length": "100" },
          }),
          10,
          "x",
          fail,
        ),
      ),
    ).toBe("too_large");
    expect(
      await codeOf(readCapped(new Response(chunks(5, 5, 5)), 10, "x", fail)),
    ).toBe("too_large");
    expect(
      (await readCapped(new Response(chunks(5, 5)), 10, "x", fail)).byteLength,
    ).toBe(10);
  });

  it("readJson reports the path of a schema problem but not the value", async () => {
    const schema = z.object({ a: z.object({ b: z.number() }) });
    const err = (await readJson(
      new Response(JSON.stringify({ a: { b: "secret-value" } })),
      schema,
      1000,
      "x",
      fail,
    ).catch((e: unknown) => e)) as TestError;
    expect(err.code).toBe("invalid_response");
    expect(err.options?.detail).toBe("unexpected shape at a.b");
    expect(JSON.stringify(err.options)).not.toContain("secret-value");
    expect(
      await codeOf(readJson(new Response("not json"), schema, 1000, "x", fail)),
    ).toBe("invalid_response");
  });

  it("boundedStream passes bytes through, errors past the cap and cancels upstream", async () => {
    const ok = await boundedStream(new Response(chunks(4, 4)), 8, "x", fail);
    expect((await new Response(ok).arrayBuffer()).byteLength).toBe(8);

    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    const capped = await boundedStream(new Response(upstream), 10, "x", fail);
    await expect(new Response(capped).arrayBuffer()).rejects.toMatchObject({
      code: "too_large",
    });
    expect(cancelled).toBe(true);
  });

  it("boundedStream refuses a declared oversize before reading", async () => {
    expect(
      await codeOf(
        boundedStream(
          new Response("x", { headers: { "content-length": "999" } }),
          10,
          "x",
          fail,
        ),
      ),
    ).toBe("too_large");
  });

  it("cancelling the bounded stream cancels the upstream", async () => {
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const s = await boundedStream(new Response(upstream), 1000, "x", fail);
    const reader = s.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
  });
});

describe("small helpers", () => {
  it("normalizes with the supplied error factory", () => {
    expect(normalizeBaseUrl("http://10.0.0.1:80/x/", fail)).toBe(
      "http://10.0.0.1/x",
    );
    expect(() => normalizeBaseUrl("gopher://x", fail)).toThrow(TestError);
  });

  it("checks tokens and builds messages and queries", () => {
    expect(() => assertToken("abc.DEF-123_~", fail)).not.toThrow();
    for (const bad of ["", " ", "a b", "a\nb", "é"]) {
      expect(() => assertToken(bad, fail), JSON.stringify(bad)).toThrow(
        TestError,
      );
    }
    expect(withDetail("Failed.", "why")).toBe("Failed (why).");
    expect(withDetail("Failed.")).toBe("Failed.");
    expect(toSearch({ a: 1, b: true }).toString()).toBe("a=1&b=true");
    expect(toSearch([["a", "1"]]).toString()).toBe("a=1");
    expect(toSearch(undefined).toString()).toBe("");
    expect(errorCodeOf(new TestError("x"))).toBe("x");
    expect(errorCodeOf(new TypeError("y"))).toBe("TypeError");
    expect(errorCodeOf("z")).toBe("unknown");
  });
});

describe("fetchOnce host policy", () => {
  const init = (over = {}) => ({
    method: "GET",
    headers: new Headers(),
    timeoutMs: 2000,
    ...over,
  });
  let server: ReturnType<typeof Bun.serve>;
  let hits = 0;
  beforeEach(() => {
    hits = 0;
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        hits++;
        return new Response("ok");
      },
    });
    setLenientHostPolicy(false);
  });
  afterEach(() => {
    void server.stop(true);
    setHostResolver(null);
    setLenientHostPolicy(true);
    vi.restoreAllMocks();
  });

  it("does not call a loopback address unless the connection may", async () => {
    const url = `http://127.0.0.1:${server.port}/`;
    expect(await codeOf(fetchOnce(url, init(), fail))).toBe("blocked_host");
    expect(
      await codeOf(fetchOnce(url, init({ allowLoopback: false }), fail)),
    ).toBe("blocked_host");
    expect(hits).toBe(0);
    const res = await fetchOnce(url, init({ allowLoopback: true }), fail);
    expect(await res.text()).toBe("ok");
    expect(hits).toBe(1);
  });

  it("never calls link-local or metadata addresses, loopback allowed or not", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://[fe80::1]/",
      "http://100.100.100.200/",
      "http://metadata.google.internal/",
    ]) {
      expect(
        await codeOf(fetchOnce(url, init({ allowLoopback: true }), fail)),
      ).toBe("blocked_host");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves the name before every request and refuses what it now points at", async () => {
    let answer = "93.184.216.34";
    setHostResolver(async () => [answer]);
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("ok"));
    const url = "https://docs.example.org/api";
    expect((await fetchOnce(url, init(), fail)).status).toBe(200);
    answer = "169.254.169.254";
    expect(
      await codeOf(fetchOnce(url, init({ allowLoopback: true }), fail)),
    ).toBe("blocked_host");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
