import { describe, expect, it } from "vitest";
import {
  crossSiteWriteResponse,
  hasForeignOrigin,
  isCrossSiteWrite,
} from "./origin";

const APP = "https://hauswart.example.org";
const EVIL = "https://evil.example";

function request(method: string, origin: string | null, contentType?: string) {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (contentType) headers.set("content-type", contentType);
  return new Request(`${APP}/x`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: "a=b" }),
  });
}

describe("isCrossSiteWrite", () => {
  const writes = ["POST", "PUT", "PATCH", "DELETE"];
  const reads = ["GET", "HEAD", "OPTIONS"];

  it.each(
    writes.flatMap((method) =>
      [
        ["another origin", "https://evil.example"],
        ["no Origin header", null],
        ["a null origin", "null"],
        ["the same host over http", "http://hauswart.example.org"],
        ["another port", "https://hauswart.example.org:8443"],
        ["a look-alike host", "https://hauswart.example.org.evil.example"],
        ["a sibling host", "https://other.example.org"],
        ["a trailing slash", `${APP}/`],
      ].map(([name, origin]) => [method, name, origin] as const),
    ),
  )("%s from %s is a cross-site write", (method, _name, origin) => {
    expect(
      isCrossSiteWrite(request(method, origin), new URL(`${APP}/g/abc`)),
    ).toBe(true);
  });

  it.each(writes)("%s from the app's own origin is not", (method) => {
    expect(
      isCrossSiteWrite(request(method, APP), new URL(`${APP}/g/abc`)),
    ).toBe(false);
  });

  it.each(reads)("%s never is, whatever the origin", (method) => {
    for (const origin of [null, "https://evil.example", APP]) {
      expect(
        isCrossSiteWrite(request(method, origin), new URL(`${APP}/g/abc`)),
      ).toBe(false);
    }
  });

  describe("Origin: null, which a form on a no-referrer page sends to its own server", () => {
    const guarded = new URL(`${APP}/g/abc`);
    const withSite = (origin: string | null, site: string | null) => {
      const headers = new Headers();
      if (origin !== null) headers.set("origin", origin);
      if (site !== null) headers.set("sec-fetch-site", site);
      return new Request(`${APP}/g/abc`, {
        method: "POST",
        headers,
        body: "a=b",
      });
    };

    it("is accepted when the browser says the request is same-origin", () => {
      expect(isCrossSiteWrite(withSite("null", "same-origin"), guarded)).toBe(
        false,
      );
    });

    it.each(["cross-site", "same-site", "none", "", "bogus"])(
      "is refused for Sec-Fetch-Site %j",
      (site) => {
        expect(isCrossSiteWrite(withSite("null", site), guarded)).toBe(true);
      },
    );

    it("is refused without Sec-Fetch-Site (an older browser, a script)", () => {
      expect(isCrossSiteWrite(withSite("null", null), guarded)).toBe(true);
    });

    it("is the only exception: a real foreign origin or a missing one stays refused", () => {
      expect(
        isCrossSiteWrite(withSite(EVIL, "same-origin"), guarded),
        "foreign origin",
      ).toBe(true);
      expect(
        isCrossSiteWrite(withSite(null, "same-origin"), guarded),
        "no origin",
      ).toBe(true);
      expect(
        isCrossSiteWrite(withSite("NULL", "same-origin"), guarded),
        "other spelling",
      ).toBe(true);
    });

    it("changes nothing for the API, which bind guards", () => {
      expect(
        isCrossSiteWrite(
          withSite("null", "cross-site"),
          new URL(`${APP}/api/v1/tokens`),
        ),
      ).toBe(false);
    });
  });

  it("does not depend on the content type: a form type is not needed to be refused", () => {
    for (const type of [
      undefined,
      "application/json",
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
    ]) {
      expect(
        isCrossSiteWrite(
          request("POST", "https://evil.example", type),
          new URL(`${APP}/g/abc`),
        ),
        String(type),
      ).toBe(true);
    }
  });

  it("treats an unknown or lower-case method as a write (fails closed)", () => {
    expect(
      isCrossSiteWrite(
        request("patch", "https://evil.example"),
        new URL(`${APP}/g/abc`),
      ),
    ).toBe(true);
  });

  it("leaves /api/v1 to bind, which checks cookie requests and lets bearer requests through", () => {
    for (const path of ["/api/v1/attachments", "/api/v1/auth/login"]) {
      expect(
        isCrossSiteWrite(
          request("POST", "https://evil.example", "multipart/form-data"),
          new URL(`${APP}${path}`),
        ),
        path,
      ).toBe(false);
      expect(
        isCrossSiteWrite(request("POST", null), new URL(`${APP}${path}`)),
        path,
      ).toBe(false);
    }
  });

  it.each([
    "/",
    "/login",
    "/settings/account",
    "/g/abc",
    "/g/abc/docs/page",
    "/api",
    "/api/health",
    "/api/v10/x",
    "/api/v1",
    "/api/public/cal/x.ics",
    "/API/v1/tokens",
  ])("guards %s", (path) => {
    expect(
      isCrossSiteWrite(
        request("POST", "https://evil.example"),
        new URL(`${APP}${path}`),
      ),
    ).toBe(true);
  });
});

describe("crossSiteWriteResponse", () => {
  const url = (path: string) => new URL(`${APP}${path}`);

  it("is null for requests that are fine", () => {
    expect(
      crossSiteWriteResponse(request("GET", null), url("/g/a")),
    ).toBeNull();
    expect(
      crossSiteWriteResponse(request("POST", APP), url("/g/a")),
    ).toBeNull();
  });

  it("is a 403 text answer for pages", async () => {
    const res = crossSiteWriteResponse(
      request("POST", "https://evil.example"),
      url("/g/a"),
    )!;
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("Cross-site POST requests are forbidden");
  });

  it("is the csrf_failed error envelope under /api", async () => {
    const res = crossSiteWriteResponse(
      request("DELETE", "https://evil.example"),
      url("/api/health"),
    )!;
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      error: { code: "csrf_failed", message: "Cross-origin request rejected" },
    });
  });
});

describe("hasForeignOrigin", () => {
  const url = new URL(`${APP}/api/v1/mcp`);

  it("is false without an Origin header: programs send none", () => {
    expect(hasForeignOrigin(request("POST", null), url)).toBe(false);
  });

  it("is false for the app's own origin", () => {
    expect(hasForeignOrigin(request("POST", APP), url)).toBe(false);
  });

  it("is true for any other origin, a sibling port and the opaque origin", () => {
    for (const origin of [EVIL, `${APP}:8443`, "null"]) {
      expect(hasForeignOrigin(request("POST", origin), url), origin).toBe(true);
    }
  });
});
