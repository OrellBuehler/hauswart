import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFakeWeb } from "$lib/testing/fake-web";
import { setHostResolver, setLenientHostPolicy } from "./host-policy";
import {
  PublicFetchError,
  fetchPublicFile,
  type PublicFetchOptions,
} from "./public-fetch";

const OPTIONS: PublicFetchOptions = {
  maxBytes: 1024 * 1024,
  userAgent: "hauswart/test",
  accept: "image/png, application/pdf",
  timeoutMs: 2000,
};
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function failure(promise: Promise<unknown>): Promise<PublicFetchError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof PublicFetchError) return err;
    throw err;
  }
  throw new Error("expected the download to fail");
}

describe("fetchPublicFile", () => {
  const web = useFakeWeb();

  it("returns the bytes and the address they came from, sending a plain request", async () => {
    const site = web.serve(() => new Response("hello"));
    const file = await fetchPublicFile(`${site.origin}/a/b.png?x=1`, OPTIONS);
    expect(text(file.bytes)).toBe("hello");
    expect(file.url.href).toBe(`${site.origin}/a/b.png?x=1`);
    expect(site.requests).toHaveLength(1);
    const headers = site.requests[0]!.headers;
    expect(headers.get("user-agent")).toBe("hauswart/test");
    expect(headers.get("accept")).toBe("image/png, application/pdf");
    for (const name of ["cookie", "authorization", "referer", "origin"]) {
      expect(headers.get(name), name).toBeNull();
    }
  });

  it("an empty body is returned as it is (the store refuses it)", async () => {
    const site = web.serve(() => new Response(null, { status: 200 }));
    expect(
      (await fetchPublicFile(`${site.origin}/`, OPTIONS)).bytes,
    ).toHaveLength(0);
  });

  describe("redirects", () => {
    it("follows relative and absolute ones by hand and reports the final address", async () => {
      const site = web.serve((request) => {
        const path = new URL(request.url).pathname;
        if (path === "/a") return Response.redirect("/b", 302);
        if (path === "/b") {
          return Response.redirect(`http://127.0.0.1:${site.port}/c`, 307);
        }
        return new Response("done");
      });
      const file = await fetchPublicFile(`${site.origin}/a`, OPTIONS);
      expect(text(file.bytes)).toBe("done");
      expect(file.url.pathname).toBe("/c");
      expect(site.requests.map((r) => r.path)).toEqual(["/a", "/b", "/c"]);
    });

    it.each([301, 302, 303, 307, 308])("follows a %i", async (status) => {
      const site = web.serve((request) =>
        new URL(request.url).pathname === "/start"
          ? Response.redirect("/end", status)
          : new Response("end"),
      );
      expect(
        text((await fetchPublicFile(`${site.origin}/start`, OPTIONS)).bytes),
      ).toBe("end");
    });

    it("allows three redirects and refuses a fourth", async () => {
      const site = web.serve((request) => {
        const hop = Number(new URL(request.url).pathname.slice(1)) || 0;
        return hop < 3
          ? Response.redirect(`/${hop + 1}`, 302)
          : new Response("arrived");
      });
      expect(
        text((await fetchPublicFile(`${site.origin}/0`, OPTIONS)).bytes),
      ).toBe("arrived");

      const endless = web.serve((request) => {
        const hop = Number(new URL(request.url).pathname.slice(1)) || 0;
        return Response.redirect(`/${hop + 1}`, 302);
      });
      const err = await failure(
        fetchPublicFile(`${endless.origin}/0`, OPTIONS),
      );
      expect(err.code).toBe("too_many_redirects");
      expect(endless.requests).toHaveLength(4);
    });

    it("a loop of redirects ends as too many redirects", async () => {
      const site = web.serve(() => Response.redirect("/", 302));
      expect(
        (await failure(fetchPublicFile(`${site.origin}/`, OPTIONS))).code,
      ).toBe("too_many_redirects");
    });

    it("the limit can be set", async () => {
      const site = web.serve((request) =>
        new URL(request.url).pathname === "/"
          ? Response.redirect("/x", 302)
          : new Response("x"),
      );
      expect(
        (
          await failure(
            fetchPublicFile(`${site.origin}/`, { ...OPTIONS, maxRedirects: 0 }),
          )
        ).code,
      ).toBe("too_many_redirects");
    });

    it.each([
      ["a private address", "http://10.0.0.5/secret"],
      ["the metadata address", "http://169.254.169.254/latest/meta-data/"],
      [
        "the metadata name",
        "http://metadata.google.internal/computeMetadata/v1/",
      ],
      ["an IPv6 unique local address", "http://[fd12::1]/"],
      ["a mapped private address", "http://[::ffff:192.168.1.1]/"],
      ["another scheme", "file:///etc/passwd"],
      ["an address with credentials", "http://user:pw@127.0.0.1/"],
    ])(
      "refuses a redirect to %s without connecting there",
      async (_name, target) => {
        const site = web.serve(
          () =>
            new Response(null, { status: 302, headers: { location: target } }),
        );
        const err = await failure(fetchPublicFile(`${site.origin}/`, OPTIONS));
        expect(err.code).toBe("blocked_host");
        expect(site.requests).toHaveLength(1);
      },
    );

    it("refuses a redirect to a name that resolves to a private address, a loopback one and a non-standard port", async () => {
      setLenientHostPolicy(false);
      setHostResolver(async (host) => {
        if (host === "docs.example.org") return ["93.184.216.34"];
        if (host === "intranet.example.org") return ["192.168.1.20"];
        throw new Error("ENOTFOUND");
      });
      try {
        // The first address is public, but a fetch to it would leave the machine: stub the transport.
        const calls: string[] = [];
        const original = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL) => {
          const url = String(input);
          calls.push(url);
          if (url === "https://docs.example.org/start") {
            return new Response(null, {
              status: 302,
              headers: { location: "https://intranet.example.org/inside" },
            });
          }
          throw new Error("must not be called");
        }) as typeof fetch;
        try {
          const err = await failure(
            fetchPublicFile("https://docs.example.org/start", OPTIONS),
          );
          expect(err.code).toBe("blocked_host");
          expect(calls).toEqual(["https://docs.example.org/start"]);

          calls.length = 0;
          globalThis.fetch = (async (input: RequestInfo | URL) => {
            calls.push(String(input));
            return new Response(null, {
              status: 301,
              headers: { location: "https://docs.example.org:8443/x" },
            });
          }) as typeof fetch;
          expect(
            (
              await failure(
                fetchPublicFile("https://docs.example.org/start", OPTIONS),
              )
            ).code,
          ).toBe("blocked_host");
          expect(calls).toHaveLength(1);
        } finally {
          globalThis.fetch = original;
        }
      } finally {
        setHostResolver(null);
        setLenientHostPolicy(true);
      }
    });

    it("a redirect without a usable address is the server's answer", async () => {
      const none = web.serve(() => new Response(null, { status: 302 }));
      const err = await failure(fetchPublicFile(`${none.origin}/`, OPTIONS));
      expect([err.code, err.status]).toEqual(["upstream_status", 302]);
    });
  });

  describe("status", () => {
    it.each([400, 401, 403, 404, 410, 429, 500, 503])(
      "an answer of %i is upstream_status with that status",
      async (status) => {
        const site = web.serve(() => new Response("no", { status }));
        const err = await failure(fetchPublicFile(`${site.origin}/`, OPTIONS));
        expect([err.code, err.status]).toEqual(["upstream_status", status]);
      },
    );

    it("a 304 or 300 is not a redirect we follow either", async () => {
      const site = web.serve(() => new Response(null, { status: 304 }));
      const err = await failure(fetchPublicFile(`${site.origin}/`, OPTIONS));
      expect([err.code, err.status]).toEqual(["upstream_status", 304]);
    });
  });

  describe("size", () => {
    it("refuses a body that declares more than the cap before reading it", async () => {
      const big = new Uint8Array(OPTIONS.maxBytes + 1);
      const site = web.serve(() => new Response(big));
      expect(
        (await failure(fetchPublicFile(`${site.origin}/`, OPTIONS))).code,
      ).toBe("too_large");
    });

    it("accepts a body of exactly the cap", async () => {
      const exact = new Uint8Array(OPTIONS.maxBytes).fill(7);
      const site = web.serve(() => new Response(exact));
      expect(
        (await fetchPublicFile(`${site.origin}/`, OPTIONS)).bytes,
      ).toHaveLength(OPTIONS.maxBytes);
    });

    it("stops reading a body that is longer than the cap and does not say how long it is", async () => {
      let cancelled = false;
      let sent = 0;
      const site = web.serve(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                sent += 64 * 1024;
                controller.enqueue(new Uint8Array(64 * 1024));
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
      );
      const err = await failure(fetchPublicFile(`${site.origin}/`, OPTIONS));
      expect(err.code).toBe("too_large");
      await vi.waitFor(() => expect(cancelled).toBe(true));
      // It read a little over the cap and stopped: it did not drain an endless stream.
      expect(sent).toBeLessThan(OPTIONS.maxBytes * 8);
    });
  });

  describe("time and connection", () => {
    it("a server that does not answer in time is unreachable", async () => {
      const site = web.serve(async () => {
        await Bun.sleep(1500);
        return new Response("late");
      });
      const started = Date.now();
      const err = await failure(
        fetchPublicFile(`${site.origin}/`, { ...OPTIONS, timeoutMs: 150 }),
      );
      expect(err.code).toBe("unreachable");
      expect(Date.now() - started).toBeLessThan(1200);
    });

    it("the time limit covers the body: a download that stalls half way is unreachable", async () => {
      const site = web.serve(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("first part"));
                // never closed
              },
            }),
          ),
      );
      const err = await failure(
        fetchPublicFile(`${site.origin}/`, { ...OPTIONS, timeoutMs: 200 }),
      );
      expect(err.code).toBe("unreachable");
    });

    it("the time limit covers the redirects together, not each one", async () => {
      const site = web.serve(async (request) => {
        await Bun.sleep(120);
        const hop = Number(new URL(request.url).pathname.slice(1)) || 0;
        return hop < 3
          ? Response.redirect(`/${hop + 1}`, 302)
          : new Response("ok");
      });
      const err = await failure(
        fetchPublicFile(`${site.origin}/0`, { ...OPTIONS, timeoutMs: 300 }),
      );
      expect(err.code).toBe("unreachable");
    });

    it("a refused connection is unreachable", async () => {
      const port = await web.closedPort();
      const err = await failure(
        fetchPublicFile(`http://127.0.0.1:${port}/`, OPTIONS),
      );
      expect(err.code).toBe("unreachable");
    });

    it("a name that does not resolve is unreachable", async () => {
      setLenientHostPolicy(false);
      setHostResolver(async () => {
        throw new Error("ENOTFOUND");
      });
      try {
        expect(
          (
            await failure(
              fetchPublicFile("https://nowhere.example.org/", OPTIONS),
            )
          ).code,
        ).toBe("unreachable");
      } finally {
        setHostResolver(null);
        setLenientHostPolicy(true);
      }
    });
  });

  describe("the first address is checked like every redirect", () => {
    beforeEach(() => setLenientHostPolicy(false));
    afterEach(() => {
      setHostResolver(null);
      setLenientHostPolicy(true);
    });

    it.each([
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://169.254.169.254/",
      "http://[::1]/",
      "http://localhost/",
      "http://192.168.0.10:8080/",
      "https://example.org:8443/",
      "ftp://example.org/a.png",
      "https://user:pw@example.org/",
    ])("%s is refused before any request is made", async (address) => {
      setHostResolver(async (host) =>
        host === "localhost" ? ["127.0.0.1", "::1"] : ["93.184.216.34"],
      );
      const original = globalThis.fetch;
      const spy = vi.fn(async () => new Response("no"));
      globalThis.fetch = spy as unknown as typeof fetch;
      try {
        expect((await failure(fetchPublicFile(address, OPTIONS))).code).toBe(
          "blocked_host",
        );
        expect(spy).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = original;
      }
    });
  });
});
