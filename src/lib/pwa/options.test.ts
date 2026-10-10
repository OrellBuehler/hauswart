import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { isAppNavigation, pwaOptions } from "./options";

type Matcher = typeof isAppNavigation;

const matches = (
  path: string,
  mode: RequestMode = "navigate",
  matcher: Matcher = isAppNavigation,
) =>
  matcher({
    request: { mode } as Request,
    url: new URL(path, "http://localhost"),
  });

describe("which navigations the service worker answers", () => {
  it("takes the pages of the app", () => {
    for (const path of [
      "/",
      "/tasks",
      "/tasks/12?due=today",
      "/docs/waschkueche",
      "/settings/tokens",
      "/costs/3",
      "/gx/abc",
      "/apiary",
    ]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("never touches the API, guest pages, sign-in, files, or its own files", () => {
    for (const path of [
      "/api",
      "/api/v1/attachments/1/content",
      "/api/v1/defects/export.pdf",
      "/api/v1/emergency/export.pdf",
      "/api/public/cal/token.ics",
      "/g/token",
      "/g/token/files/4",
      "/g/token/docs/page",
      "/login",
      "/login?redirectTo=%2Ftasks",
      "/setup",
      "/offline",
      "/sw.js",
      "/manifest.webmanifest",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("only takes navigations, never the fetch() calls of the app", () => {
    for (const mode of ["cors", "same-origin", "no-cors"] as const) {
      expect(matches("/tasks", mode), mode).toBe(false);
    }
  });

  it("is self-contained, because workbox copies its source into the worker", () => {
    // An empty context: no import, constant or helper of this module is reachable from the copy.
    const copy = runInNewContext(`(${isAppNavigation.toString()})`) as Matcher;
    expect(matches("/tasks", "navigate", copy)).toBe(true);
    expect(matches("/api/v1/tasks", "navigate", copy)).toBe(false);
    expect(matches("/tasks", "cors", copy)).toBe(false);
  });
});

describe("service worker configuration", () => {
  const options = pwaOptions("build-1");
  const workbox = options.workbox!;

  it("registers /sw.js with the scope /, whatever page the app is on", () => {
    // A relative base ("./") would otherwise make it "sw.js" next to the current page.
    expect(options.base).toBe("/");
    expect(options.scope).toBe("/");
    expect(options.filename).toBeUndefined();
  });

  it("waits for the person to accept a new version, and is off in development", () => {
    expect(options.registerType).toBe("prompt");
    expect(options.devOptions).toEqual({ enabled: false });
    // Nothing may activate a new version by itself: only the message the update prompt sends.
    expect(workbox.skipWaiting).toBeUndefined();
  });

  it("leaves the manifest and the registration to the app", () => {
    expect(options.manifest).toBe(false);
    expect(options.injectRegister).toBe(false);
  });

  it("precaches built static client files only: assets, fonts, icons", () => {
    expect(workbox.globPatterns).toEqual([
      "client/_app/immutable/**/*.{js,css,woff2}",
      "client/icons/*.png",
      "client/favicon.svg",
    ]);
    for (const pattern of workbox.globPatterns!) {
      expect(pattern).not.toMatch(/html|json|\*\*\/\*\.\*$/);
    }
    expect(workbox.globIgnores).toEqual(
      expect.arrayContaining(["server/**", "prerendered/**"]),
    );
  });

  it("caches no HTML but the offline page, which holds no user data", () => {
    expect(workbox.additionalManifestEntries).toEqual([
      { url: "/offline", revision: "build-1" },
    ]);
    expect(pwaOptions("build-2").workbox!.additionalManifestEntries).toEqual([
      { url: "/offline", revision: "build-2" },
    ]);
  });

  it("registers no navigation fallback: pages never come from the cache", () => {
    // The key must exist: the SvelteKit integration only fills it in when it is absent.
    expect("navigateFallback" in workbox).toBe(true);
    expect(workbox.navigateFallback).toBeUndefined();
    expect(workbox.navigateFallbackAllowlist).toBeUndefined();
  });

  it("sends navigations to the network and falls back to the offline page only on failure", () => {
    expect(workbox.runtimeCaching).toEqual([
      {
        urlPattern: isAppNavigation,
        handler: "NetworkOnly",
        options: { precacheFallback: { fallbackURL: "/offline" } },
      },
    ]);
  });

  it("is a single file that drops the caches of older versions and takes over open pages", () => {
    expect(workbox.inlineWorkboxRuntime).toBe(true);
    expect(workbox.cleanupOutdatedCaches).toBe(true);
    expect(workbox.clientsClaim).toBe(true);
  });
});
