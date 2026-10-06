import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import {
  requireAdmin,
  requirePrincipal,
  requireScopes,
  resolvePrincipal,
} from "./guards";
import type { SessionUser } from "./types";

const member: SessionUser = {
  id: "m",
  username: "member",
  displayName: null,
  role: "member",
  locale: "de",
};
const admin: SessionUser = {
  ...member,
  id: "a",
  username: "admin",
  role: "admin",
};
const session = { id: "s", expiresAt: new Date(0) };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err.code;
    throw err;
  }
}

describe("resolvePrincipal", () => {
  it("is null without a user", () => {
    expect(resolvePrincipal({})).toBeNull();
    expect(
      resolvePrincipal({ user: null, session: null, token: null }),
    ).toBeNull();
    expect(resolvePrincipal({ session })).toBeNull();
  });

  it("gives a session every scope its role allows", () => {
    const p = resolvePrincipal({ user: member, session });
    expect(p?.auth).toBe("session");
    expect(p?.scopes).not.toContain("admin");
    expect(p?.scopes).toContain("ha:action");
    expect(resolvePrincipal({ user: admin, session })?.scopes).toContain(
      "admin",
    );
  });

  it("limits a token to its scopes and never beyond the owner's role", () => {
    const token = {
      id: "t",
      kind: "mcp" as const,
      scopes: ["read" as const, "admin" as const],
    };
    expect(resolvePrincipal({ user: member, token })?.scopes).toEqual(["read"]);
    expect(resolvePrincipal({ user: admin, token })?.scopes).toEqual([
      "read",
      "admin",
    ]);
    expect(resolvePrincipal({ user: admin, token })?.auth).toBe("token");
  });

  it("prefers the token when both are present", () => {
    const token = {
      id: "t",
      kind: "mobile" as const,
      scopes: ["read" as const],
    };
    expect(resolvePrincipal({ user: member, token, session })?.auth).toBe(
      "token",
    );
  });
});

describe("guards", () => {
  it("requires a principal", () => {
    expect(codeOf(() => requirePrincipal(null))).toBe("unauthenticated");
    const p = resolvePrincipal({ user: member, session })!;
    expect(requirePrincipal(p)).toBe(p);
  });

  it("checks that all required scopes are held", () => {
    const p = resolvePrincipal({ user: member, session })!;
    expect(() => requireScopes(p, ["read", "write"])).not.toThrow();
    expect(codeOf(() => requireScopes(p, ["read", "admin"]))).toBe("forbidden");
    expect(() => requireScopes(p, [])).not.toThrow();
  });

  it("restricts admin to administrators", () => {
    expect(
      codeOf(() => requireAdmin(resolvePrincipal({ user: member, session })!)),
    ).toBe("forbidden");
    expect(() =>
      requireAdmin(resolvePrincipal({ user: admin, session })!),
    ).not.toThrow();
  });
});
