import { describe, expect, it } from "vitest";
import {
  isApiPath,
  isBearerPath,
  isPublicPath,
  isScriptlessPath,
  safeRedirectTo,
} from "./routing";

describe("safeRedirectTo", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeRedirectTo("/admin/users")).toBe("/admin/users");
    expect(safeRedirectTo("/a?b=1&c=2#x")).toBe("/a?b=1&c=2#x");
  });

  it("falls back to / for missing values", () => {
    expect(safeRedirectTo(null)).toBe("/");
    expect(safeRedirectTo(undefined)).toBe("/");
    expect(safeRedirectTo("")).toBe("/");
  });

  it("rejects external and tricky targets", () => {
    for (const bad of [
      "//evil.com",
      "//evil.com/path",
      "https://evil.com",
      "http://evil.com/x",
      "javascript:alert(1)",
      "/\\evil.com",
      "\\\\evil.com",
      "evil.com",
      "/a\r\nSet-Cookie: x=1",
      "/\tfoo",
    ]) {
      expect(safeRedirectTo(bad), bad).toBe("/");
    }
  });
});

describe("path classification", () => {
  it("knows the public paths", () => {
    for (const p of [
      "/login",
      "/setup",
      "/api/health",
      "/api/v1/health",
      "/api/v1/openapi.json",
      "/api/v1/setup",
      "/api/v1/auth/login",
      "/api/v1/auth/token",
      "/api/public/hook",
      "/g/abc123",
      "/manifest.webmanifest",
      "/sw.js",
      "/offline",
    ]) {
      expect(isPublicPath(p), p).toBe(true);
    }
    for (const p of [
      "/",
      "/api",
      "/api/publicity",
      "/login/x",
      "/gx/abc",
      "/g",
      "/api/v1/auth/me",
      "/api/v1/auth/logout",
      "/api/v1/tokens",
      "/api/v1/users",
      "/api/v1/setup/extra",
      "/admin/users",
      "/manifest.webmanifest/x",
      "/sw.js/x",
      "/sw.json",
      "/offline/x",
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("knows the pages rendered without JavaScript", () => {
    for (const p of ["/g/abc123", "/g/abc123/docs/page", "/offline"]) {
      expect(isScriptlessPath(p), p).toBe(true);
    }
    for (const p of ["/", "/g", "/gx/abc", "/login", "/offline/x"]) {
      expect(isScriptlessPath(p), p).toBe(false);
    }
  });

  it("detects api paths", () => {
    expect(isApiPath("/api/x")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
  });

  it("honours bearer tokens on the versioned API only", () => {
    expect(isBearerPath("/api/v1/auth/me")).toBe(true);
    expect(isBearerPath("/api/v1")).toBe(false);
    expect(isBearerPath("/api/health")).toBe(false);
    expect(isBearerPath("/api/v2/x")).toBe(false);
    expect(isBearerPath("/")).toBe(false);
  });
});
