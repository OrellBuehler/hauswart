import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apiTokens, users } from "$lib/server/db";
import { createTestToken, createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { hashToken } from "./sessions";
import {
  LAST_USED_THROTTLE_MS,
  TOKEN_PATTERN,
  createToken,
  listTokens,
  revokeToken,
  revokeUserTokens,
  verifyToken,
} from "./tokens";

const T0 = 1_800_000_000_000;

describe("tokens", () => {
  const ctx = useTestDB();

  it("creates hw_ tokens with 32 random bytes and stores only the hash", async () => {
    const user = await createTestUser();
    const { token, record } = createToken(user.id, {
      kind: "integration",
      name: "dashboard",
      scopes: ["read"],
    });
    expect(token).toMatch(TOKEN_PATTERN);
    expect(token).toHaveLength(3 + 43);
    const row = ctx.db.select().from(apiTokens).get()!;
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.prefix).toBe(token.slice(0, 8));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(record).toMatchObject({
      kind: "integration",
      name: "dashboard",
      prefix: token.slice(0, 8),
      scopes: ["read"],
      lastUsedAt: null,
      expiresAt: null,
    });
    expect(record).not.toHaveProperty("tokenHash");
  });

  it("generates distinct tokens", async () => {
    const user = await createTestUser();
    const a = createTestToken(user).token;
    const b = createTestToken(user).token;
    expect(a).not.toBe(b);
  });

  it("verifies a token to its owner and scopes", async () => {
    const user = await createTestUser({ displayName: "Alice", locale: "en" });
    const { token, record } = createTestToken(user, {
      kind: "ha",
      scopes: ["read", "ha:action"],
    });
    expect(verifyToken(token, T0)).toEqual({
      user: {
        id: user.id,
        username: user.username,
        displayName: "Alice",
        role: "member",
        locale: "en",
      },
      token: { id: record.id, kind: "ha", scopes: ["read", "ha:action"] },
    });
  });

  it("rejects malformed, unknown and tampered tokens", async () => {
    const user = await createTestUser();
    const { token } = createTestToken(user);
    expect(verifyToken("", T0)).toBeNull();
    expect(verifyToken("hw_short", T0)).toBeNull();
    expect(verifyToken(token.slice(3), T0)).toBeNull();
    expect(verifyToken(`${token}x`, T0)).toBeNull();
    const other = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyToken(other, T0)).toBeNull();
    expect(verifyToken(`xx_${token.slice(3)}`, T0)).toBeNull();
  });

  it("rejects expired tokens at and after the expiry instant", async () => {
    const user = await createTestUser();
    const { token } = createTestToken(user, { expiresAt: new Date(T0 + 1000) });
    expect(verifyToken(token, T0 + 999)).not.toBeNull();
    expect(verifyToken(token, T0 + 1000)).toBeNull();
    expect(verifyToken(token, T0 + 5000)).toBeNull();
  });

  it("never expires a token without expiry", async () => {
    const user = await createTestUser();
    const { token } = createTestToken(user, { expiresAt: null });
    expect(verifyToken(token, T0 + 10 * 365 * 24 * 3600 * 1000)).not.toBeNull();
  });

  it("rejects revoked tokens", async () => {
    const user = await createTestUser();
    const { token, record } = createTestToken(user);
    expect(revokeToken(user.id, record.id, T0)).toBe(true);
    expect(verifyToken(token, T0)).toBeNull();
    expect(revokeToken(user.id, record.id, T0)).toBe(false);
  });

  it("stops working when the owner is deleted", async () => {
    const user = await createTestUser();
    const { token } = createTestToken(user);
    ctx.db.delete(users).where(eq(users.id, user.id)).run();
    expect(verifyToken(token, T0)).toBeNull();
    expect(ctx.db.select().from(apiTokens).all()).toHaveLength(0);
  });

  it("throttles lastUsedAt to one write per minute", async () => {
    const user = await createTestUser();
    const { token, record } = createTestToken(user);
    const lastUsed = () =>
      ctx.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.id, record.id))
        .get()!
        .lastUsedAt?.getTime();
    expect(lastUsed()).toBeUndefined();
    verifyToken(token, T0);
    expect(lastUsed()).toBe(T0);
    verifyToken(token, T0 + 1000);
    verifyToken(token, T0 + LAST_USED_THROTTLE_MS - 1);
    expect(lastUsed()).toBe(T0);
    verifyToken(token, T0 + LAST_USED_THROTTLE_MS);
    expect(lastUsed()).toBe(T0 + LAST_USED_THROTTLE_MS);
  });

  it("lists only the owner's live tokens, newest first, without secrets", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const first = createTestToken(alice, { name: "first" });
    const second = createTestToken(alice, { name: "second" });
    const gone = createTestToken(alice, { name: "gone" });
    createTestToken(bob, { name: "bobs" });
    revokeToken(alice.id, gone.record.id);
    const names = listTokens(alice.id).map((t) => t.name);
    expect(names).toHaveLength(2);
    expect(names).toContain("first");
    expect(names).toContain("second");
    expect(listTokens(bob.id).map((t) => t.name)).toEqual(["bobs"]);
    const json = JSON.stringify(listTokens(alice.id));
    expect(json).not.toContain(first.token);
    expect(json).not.toContain(second.token);
    expect(json).not.toContain("tokenHash");
  });

  it("cannot revoke another user's token", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const { token, record } = createTestToken(bob);
    expect(revokeToken(alice.id, record.id)).toBe(false);
    expect(revokeToken(alice.id, "missing")).toBe(false);
    expect(verifyToken(token, T0)).not.toBeNull();
  });

  it("revokes all of a user's tokens, optionally one kind", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const mobile = createTestToken(alice, { kind: "mobile" });
    const ha = createTestToken(alice, { kind: "ha" });
    const bobs = createTestToken(bob, { kind: "mobile" });
    expect(revokeUserTokens(alice.id, "mobile")).toBe(1);
    expect(verifyToken(mobile.token, T0)).toBeNull();
    expect(verifyToken(ha.token, T0)).not.toBeNull();
    expect(revokeUserTokens(alice.id)).toBe(1);
    expect(verifyToken(ha.token, T0)).toBeNull();
    expect(verifyToken(bobs.token, T0)).not.toBeNull();
  });

  it("ignores scope values it does not know", async () => {
    const user = await createTestUser();
    const { token, record } = createTestToken(user, { scopes: ["read"] });
    ctx.db
      .update(apiTokens)
      .set({ scopes: ["read", "root"] as never })
      .where(eq(apiTokens.id, record.id))
      .run();
    expect(verifyToken(token, T0)?.token.scopes).toEqual(["read"]);
    expect(listTokens(user.id)[0].scopes).toEqual(["read"]);
  });
});
