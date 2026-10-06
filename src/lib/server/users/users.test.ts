import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apiTokens, sessions, users } from "$lib/server/db";
import { createTestToken, createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { hashPassword, verifyPassword } from "$lib/server/auth/password";
import { createSession, validateSessionToken } from "$lib/server/auth/sessions";
import { verifyToken } from "$lib/server/auth/tokens";
import { AuthError } from "$lib/server/auth/types";
import {
  countUsers,
  createFirstAdmin,
  createUser,
  listUsers,
  updateProfile,
  updateUser,
} from "./users";

vi.mock("$lib/server/auth/password", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/server/auth/password")>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});

async function codeOf(p: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (err) {
    if (err instanceof AuthError) return err.code;
    throw err;
  }
  return null;
}

describe("users", () => {
  const ctx = useTestDB();

  it("counts users", async () => {
    expect(countUsers()).toBe(0);
    await createTestUser();
    expect(countUsers()).toBe(1);
  });

  it("normalizes usernames and hashes passwords with argon2id", async () => {
    const u = await createUser({
      username: "  MiXed.Case ",
      password: "a-long-enough-password",
      role: "member",
    });
    expect(u.username).toBe("mixed.case");
    const row = ctx.db.select().from(users).get();
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain("a-long-enough-password");
  });

  it("applies defaults and accepts locale and cost share", async () => {
    const a = await createUser({
      username: "aaa",
      password: "a-long-enough-password",
      role: "member",
    });
    expect(a).toMatchObject({
      locale: "de",
      ownershipBps: 5000,
      displayName: null,
    });
    const b = await createUser({
      username: "bbb",
      password: "a-long-enough-password",
      role: "member",
      locale: "en",
      ownershipBps: 2500,
      displayName: "Bea",
    });
    expect(b).toMatchObject({
      locale: "en",
      ownershipBps: 2500,
      displayName: "Bea",
    });
  });

  it("rejects duplicate usernames, case-insensitively", async () => {
    await createTestUser({ username: "alice" });
    expect(
      await codeOf(
        createUser({
          username: "ALICE",
          password: "another-long-password",
          role: "member",
        }),
      ),
    ).toBe("username_taken");
  });

  it("setup race: only one of two concurrent first-admin attempts succeeds", async () => {
    const attempt = (name: string) =>
      createFirstAdmin({ username: name, password: "a-long-enough-password" });
    const results = await Promise.allSettled([attempt("one"), attempt("two")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "setup_closed",
    });
    expect(countUsers()).toBe(1);
    expect(listUsers()[0].role).toBe("admin");
  });

  it("first-admin setup fails once a user exists", async () => {
    await createTestUser();
    expect(
      await codeOf(
        createFirstAdmin({
          username: "late",
          password: "a-long-enough-password",
        }),
      ),
    ).toBe("setup_closed");
    expect(countUsers()).toBe(1);
  });

  it("first-admin setup after completion fails before any password hashing", async () => {
    await createTestUser({ role: "admin" });
    vi.mocked(hashPassword).mockClear();
    expect(
      await codeOf(
        createFirstAdmin({
          username: "bob",
          password: "a-long-enough-password",
        }),
      ),
    ).toBe("setup_closed");
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("lists users by username without credentials", async () => {
    await createTestUser({ username: "zed" });
    await createTestUser({ username: "amy" });
    const list = listUsers();
    expect(list.map((u) => u.username)).toEqual(["amy", "zed"]);
    expect(JSON.stringify(list)).not.toContain("passwordHash");
  });

  it("updates profile fields only for the given user", async () => {
    const a = await createTestUser({ displayName: "A" });
    const b = await createTestUser({ displayName: "B" });
    const updated = updateProfile(a.id, { displayName: "Alpha", locale: "en" });
    expect(updated).toMatchObject({ displayName: "Alpha", locale: "en" });
    expect(listUsers().find((u) => u.id === b.id)).toMatchObject({
      displayName: "B",
      locale: "de",
    });
    expect(() => updateProfile("missing", { locale: "en" })).toThrow(AuthError);
  });
});

describe("updateUser", () => {
  const ctx = useTestDB();

  it("changes role, name and cost share", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    const result = await updateUser(member.id, {
      role: "admin",
      displayName: "Maya",
      ownershipBps: 4000,
    });
    expect(result.user).toMatchObject({
      role: "admin",
      displayName: "Maya",
      ownershipBps: 4000,
    });
    expect(result).toMatchObject({ roleChanged: true, passwordReset: false });
    expect(admin.id).not.toBe(member.id);
  });

  it("reports an unchanged role as not changed and tolerates an empty patch", async () => {
    const member = await createTestUser();
    expect(await updateUser(member.id, { role: "member" })).toMatchObject({
      roleChanged: false,
    });
    expect((await updateUser(member.id, {})).user.id).toBe(member.id);
  });

  it("refuses to demote the last administrator", async () => {
    const admin = await createTestUser({ role: "admin" });
    expect(await codeOf(updateUser(admin.id, { role: "member" }))).toBe(
      "cannot_demote_last_admin",
    );
    expect(
      ctx.db.select().from(users).where(eq(users.id, admin.id)).get()?.role,
    ).toBe("admin");
    const other = await createTestUser({ role: "admin" });
    expect((await updateUser(admin.id, { role: "member" })).user.role).toBe(
      "member",
    );
    expect(await codeOf(updateUser(other.id, { role: "member" }))).toBe(
      "cannot_demote_last_admin",
    );
  });

  it("reports unknown users", async () => {
    expect(await codeOf(updateUser("missing", { displayName: "x" }))).toBe(
      "user_not_found",
    );
  });

  it("resets the password, ending sessions and every live token", async () => {
    const member = await createTestUser();
    const other = await createTestUser();
    const s1 = createSession(member.id);
    const s2 = createSession(member.id);
    const theirs = createSession(other.id);
    const mobile = createTestToken(member, { kind: "mobile" });
    const mcp = createTestToken(member, { kind: "mcp" });
    const otherMobile = createTestToken(other, { kind: "mobile" });

    const result = await updateUser(
      member.id,
      { password: "brand-new-password" },
      s2.session.id,
    );
    expect(result.passwordReset).toBe(true);
    const row = ctx.db
      .select()
      .from(users)
      .where(eq(users.id, member.id))
      .get()!;
    expect(await verifyPassword("brand-new-password", row.passwordHash)).toBe(
      true,
    );
    expect(await verifyPassword(member.password, row.passwordHash)).toBe(false);

    expect(validateSessionToken(s1.token)).toBeNull();
    expect(validateSessionToken(s2.token)).not.toBeNull();
    expect(validateSessionToken(theirs.token)).not.toBeNull();
    expect(verifyToken(mobile.token)).toBeNull();
    expect(verifyToken(mcp.token)).toBeNull();
    expect(verifyToken(otherMobile.token)).not.toBeNull();
    expect(ctx.db.select().from(sessions).all()).toHaveLength(2);
    expect(ctx.db.select().from(apiTokens).all()).toHaveLength(3);
  });

  it("demoting an administrator revokes their admin-scoped tokens and keeps the others", async () => {
    await createTestUser({ role: "admin" });
    const demoted = await createTestUser({ role: "admin" });
    const adminToken = createTestToken(demoted, {
      kind: "mcp",
      scopes: ["read", "write", "admin"],
    });
    const plainToken = createTestToken(demoted, {
      kind: "mcp",
      scopes: ["read"],
    });
    const result = await updateUser(demoted.id, { role: "member" });
    expect(result.roleChanged).toBe(true);
    expect(verifyToken(adminToken.token)).toBeNull();
    expect(verifyToken(plainToken.token)).not.toBeNull();
  });

  it("promoting a member or changing other fields leaves tokens alone", async () => {
    const member = await createTestUser();
    const t = createTestToken(member, { kind: "mcp", scopes: ["read"] });
    await updateUser(member.id, { role: "admin", displayName: "Maya" });
    expect(verifyToken(t.token)).not.toBeNull();
  });
});
