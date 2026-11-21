import { describe, expect, it } from "vitest";
import {
  cacheName,
  isAppNavigation,
  OFFLINE_PATH,
  planFetch,
  precacheUrls,
  staleCaches,
} from "./worker";

const ORIGIN = "http://localhost";

const request = (mode: RequestMode = "navigate", method = "GET") => ({
  mode,
  method,
});
const url = (path: string) => new URL(path, ORIGIN);

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
      expect(isAppNavigation(request(), url(path)), path).toBe(true);
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
      expect(isAppNavigation(request(), url(path)), path).toBe(false);
    }
  });

  it("only takes GET navigations, never the fetch() calls of the app or a form post", () => {
    for (const mode of ["cors", "same-origin", "no-cors"] as const) {
      expect(isAppNavigation(request(mode), url("/tasks")), mode).toBe(false);
    }
    expect(isAppNavigation(request("navigate", "POST"), url("/tasks"))).toBe(
      false,
    );
  });
});

describe("what the service worker precaches", () => {
  const immutable = [
    { path: "_app/immutable/entry/start.abc.js" },
    { path: "_app/immutable/assets/app.def.css" },
    { path: "_app/immutable/assets/roboto.123.woff2" },
    { path: "_app/immutable/assets/photo.456.png" },
    { path: "_app/immutable/nodes/0.json" },
  ];
  const assets = [
    { path: "favicon.svg" },
    { path: "icons/icon-192.png" },
    { path: "icons/apple-touch-icon.png" },
    { path: "robots.txt" },
    { path: "icons/nested/x.png" },
  ];

  it("takes built scripts, styles and fonts, the icons, the favicon and the offline page", () => {
    expect(precacheUrls(immutable, assets)).toEqual([
      "/_app/immutable/entry/start.abc.js",
      "/_app/immutable/assets/app.def.css",
      "/_app/immutable/assets/roboto.123.woff2",
      "/favicon.svg",
      "/icons/icon-192.png",
      "/icons/apple-touch-icon.png",
      OFFLINE_PATH,
    ]);
  });

  it("holds no HTML but the offline page, which holds no user data", () => {
    const urls = precacheUrls(immutable, assets);
    expect(urls.filter((u) => !/\.(?:js|css|woff2|png|svg)$/.test(u))).toEqual([
      "/offline",
    ]);
  });

  it("keeps a cache per build and drops every other one, the old workbox caches included", () => {
    expect(cacheName("1a2b")).toBe("hauswart-1a2b");
    expect(cacheName("1a2b")).not.toBe(cacheName("3c4d"));
    expect(
      staleCaches(
        ["hauswart-1a2b", "hauswart-0000", "workbox-precache-v2-https://x/"],
        "hauswart-1a2b",
      ),
    ).toEqual(["hauswart-0000", "workbox-precache-v2-https://x/"]);
  });
});

describe("what the service worker does with a request", () => {
  const precached = new Set([
    "/_app/immutable/entry/start.abc.js",
    "/favicon.svg",
    OFFLINE_PATH,
  ]);
  const plan = (path: string, mode: RequestMode = "cors", method = "GET") =>
    planFetch(request(mode, method), url(path), ORIGIN, precached);

  it("answers precached files from the cache", () => {
    expect(plan("/_app/immutable/entry/start.abc.js")).toBe("precached");
    expect(plan("/favicon.svg", "no-cors")).toBe("precached");
  });

  it("sends navigations to the network, with the offline page only when that fails", () => {
    expect(plan("/tasks", "navigate")).toBe("navigation");
    // a navigation to /offline itself is the server's, like a reload of that page
    expect(plan("/offline", "navigate")).toBe("network");
  });

  it("stays out of everything else", () => {
    expect(plan("/api/v1/tasks")).toBe("network");
    expect(plan("/api/v1/attachments/1/content", "navigate")).toBe("network");
    expect(plan("/g/token", "navigate")).toBe("network");
    expect(plan("/_app/immutable/entry/other.js")).toBe("network");
    expect(plan("/favicon.svg", "cors", "POST")).toBe("network");
    expect(
      planFetch(
        request("cors"),
        new URL("https://cdn.example.org/favicon.svg"),
        ORIGIN,
        precached,
      ),
    ).toBe("network");
  });
});
