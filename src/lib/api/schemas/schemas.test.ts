import { describe, expect, it } from "vitest";
import {
  dateSchema,
  errorEnvelopeSchema,
  isoTimestampSchema,
  paginated,
  paginationQuerySchema,
  toIso,
} from "./common";
import {
  loginRequestSchema,
  passwordSchema,
  setupRequestSchema,
  updateMeRequestSchema,
  usernameSchema,
} from "./auth";
import { createTokenRequestSchema } from "./tokens";
import { createUserRequestSchema, updateUserRequestSchema } from "./users";
import { z } from "zod";

describe("common schemas", () => {
  it("accepts calendar dates only", () => {
    expect(dateSchema.safeParse("2024-02-29").success).toBe(true);
    expect(dateSchema.safeParse("2025-02-29").success).toBe(false);
    expect(dateSchema.safeParse("2025-13-01").success).toBe(false);
    expect(dateSchema.safeParse("2025-1-1").success).toBe(false);
    expect(dateSchema.safeParse("2025-01-01T00:00:00Z").success).toBe(false);
  });

  it("accepts UTC ISO timestamps", () => {
    expect(isoTimestampSchema.safeParse(toIso(1_700_000_000_000)).success).toBe(
      true,
    );
    expect(isoTimestampSchema.safeParse("2025-01-01").success).toBe(false);
    expect(isoTimestampSchema.safeParse("yesterday").success).toBe(false);
  });

  it("validates the error envelope", () => {
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: "not_found", message: "x" },
      }).success,
    ).toBe(true);
    expect(
      errorEnvelopeSchema.safeParse({ error: { code: "nope", message: "x" } })
        .success,
    ).toBe(false);
  });

  it("wraps list responses with a nullable cursor", () => {
    const schema = paginated(z.string());
    expect(schema.safeParse({ items: ["a"], nextCursor: null }).success).toBe(
      true,
    );
    expect(schema.safeParse({ items: ["a"] }).success).toBe(false);
  });

  it("coerces and bounds pagination query strings", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(paginationQuerySchema.parse({ limit: "10", cursor: "abc" })).toEqual(
      {
        limit: 10,
        cursor: "abc",
      },
    );
    expect(paginationQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "201" }).success).toBe(
      false,
    );
  });
});

describe("auth schemas", () => {
  it("normalises usernames", () => {
    expect(usernameSchema.parse("  MiXed.Case ")).toBe("mixed.case");
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("has space").success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(33)).success).toBe(false);
  });

  it("bounds passwords", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("a-long-enough-password").success).toBe(
      true,
    );
    expect(passwordSchema.safeParse("x".repeat(257)).success).toBe(false);
  });

  it("login accepts any non-empty username so bad ones are plain credential failures", () => {
    expect(
      loginRequestSchema.parse({ username: " A! ", password: "x" }).username,
    ).toBe("a!");
    expect(
      loginRequestSchema.safeParse({ username: "", password: "x" }).success,
    ).toBe(false);
  });

  it("rejects unknown body fields", () => {
    expect(
      setupRequestSchema.safeParse({
        username: "alice",
        displayName: "Alice",
        password: "a-long-enough-password",
        locale: "en",
        role: "admin",
      }).success,
    ).toBe(false);
  });

  it("requires something to update", () => {
    expect(updateMeRequestSchema.safeParse({}).success).toBe(false);
    expect(updateMeRequestSchema.safeParse({ locale: "en" }).success).toBe(
      true,
    );
    expect(updateMeRequestSchema.safeParse({ locale: "fr" }).success).toBe(
      false,
    );
    expect(updateUserRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateUserRequestSchema.safeParse({ ownershipBps: 10001 }).success,
    ).toBe(false);
  });

  it("defaults new users to member and German", () => {
    const parsed = createUserRequestSchema.parse({
      username: "bob",
      displayName: "Bob",
      password: "a-long-enough-password",
    });
    expect(parsed.role).toBe("member");
    expect(parsed.locale).toBe("de");
  });
});

describe("token schemas", () => {
  it("cannot create mobile tokens and de-duplicates scopes", () => {
    const base = { name: "n", scopes: ["read", "read"] };
    expect(
      createTokenRequestSchema.safeParse({ ...base, kind: "mobile" }).success,
    ).toBe(false);
    expect(
      createTokenRequestSchema.parse({ ...base, kind: "ha" }).scopes,
    ).toEqual(["read"]);
  });

  it("rejects empty and unknown scopes", () => {
    expect(
      createTokenRequestSchema.safeParse({ name: "n", kind: "mcp", scopes: [] })
        .success,
    ).toBe(false);
    expect(
      createTokenRequestSchema.safeParse({
        name: "n",
        kind: "mcp",
        scopes: ["root"],
      }).success,
    ).toBe(false);
  });
});
