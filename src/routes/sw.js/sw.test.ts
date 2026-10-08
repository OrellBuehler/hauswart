import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setServiceWorkerSource } from "$lib/server/pwa/service-worker";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute } from "$lib/testing/route";
import { GET } from "./+server";

describe("GET /sw.js", () => {
  useTestDB();
  beforeEach(async () => {
    await createTestUser();
    setServiceWorkerSource("/* service worker */");
  });
  afterEach(() => {
    setServiceWorkerSource(undefined);
    vi.restoreAllMocks();
  });

  const fetchWorker = (headers: Record<string, string> = {}) =>
    callRoute(GET as never, { url: "http://localhost/sw.js", headers });

  it("is served without a login as JavaScript that is revalidated on every check", async () => {
    const { res, body } = await fetchWorker();
    expect(res.status).toBe(200);
    expect(body).toBe("/* service worker */");
    expect(res.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("carries the security headers of the hook", async () => {
    const { res } = await fetchWorker();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("answers 304 when the browser already has this version, and 200 for another", async () => {
    const etag = (await fetchWorker()).res.headers.get("etag")!;
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const { res, body } = await fetchWorker({ "if-none-match": header });
      expect([header, res.status]).toEqual([header, 304]);
      expect(body).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("etag")).toBe(etag);
    }
    const stale = await fetchWorker({ "if-none-match": '"0123"' });
    expect(stale.res.status).toBe(200);
  });

  it("changes its ETag with the script", async () => {
    const before = (await fetchWorker()).res.headers.get("etag");
    setServiceWorkerSource("/* next release */");
    const after = (await fetchWorker()).res.headers.get("etag");
    expect(after).not.toBe(before);
  });

  it("is a 404 that is not cached where no build has produced it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // `undefined` reads the build output next to the server bundle: a source checkout has none.
    setServiceWorkerSource(undefined);
    for (let i = 0; i < 2; i++) {
      const { res } = await fetchWorker();
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string).event).toBe(
      "pwa.service_worker_missing",
    );

    setServiceWorkerSource(null);
    expect((await fetchWorker()).res.status).toBe(404);
  });
});
