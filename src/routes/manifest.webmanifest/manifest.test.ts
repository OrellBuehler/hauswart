import { beforeEach, describe, expect, it } from "vitest";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute } from "$lib/testing/route";
import { GET } from "./+server";

describe("GET /manifest.webmanifest", () => {
  useTestDB();
  beforeEach(async () => {
    // Accounts exist, so every non-public path would send an anonymous caller to the login.
    await createTestUser();
  });

  const fetchManifest = (headers: Record<string, string> = {}) =>
    callRoute(GET as never, {
      url: "http://localhost/manifest.webmanifest",
      headers,
    });

  it("is served without a login, as a manifest, through the hook's security headers", async () => {
    const { res, body } = await fetchManifest();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(body).toMatchObject({
      name: "hauswart",
      short_name: "hauswart",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  it("speaks German by default and follows the language of the browser", async () => {
    const de = (await fetchManifest()).body as Record<string, string>;
    expect(de.lang).toBe("de");
    expect(de.description).toBe("Wohnungsverwaltung für den eigenen Haushalt");

    const en = await fetchManifest({ "accept-language": "en" });
    expect(en.body).toMatchObject({
      lang: "en",
      description: "Apartment management for your own household",
    });
    expect(en.res.headers.get("vary")).toBe("Accept-Language");
  });

  it("only offers the icons it ships", async () => {
    const { body } = await fetchManifest();
    const icons = (body as { icons: { src: string; purpose: string }[] }).icons;
    expect(icons.map((i) => i.purpose).sort()).toEqual([
      "any",
      "any",
      "maskable",
    ]);
    for (const icon of icons) expect(icon.src).toMatch(/^\/icons\//);
  });
});
