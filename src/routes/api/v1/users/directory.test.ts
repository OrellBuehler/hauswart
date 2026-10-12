import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDB, users } from "$lib/server/db";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

describe("users directory API", () => {
  useTestDB();

  it("gives every member the id, display name and ownership share of everyone, nothing else", async () => {
    const anna = await createTestUser({
      username: "anna",
      displayName: "Anna Muster",
    });
    const ben = await createTestUser({
      username: "ben",
      role: "admin",
      displayName: "Ben",
    });
    const cleo = await createTestUser({ username: "cleo" });
    getDB()
      .update(users)
      .set({ ownershipBps: 7000 })
      .where(eq(users.id, anna.id))
      .run();
    getDB()
      .update(users)
      .set({ ownershipBps: 3000 })
      .where(eq(users.id, ben.id))
      .run();
    getDB()
      .update(users)
      .set({ ownershipBps: 0 })
      .where(eq(users.id, cleo.id))
      .run();
    const call = createCaller({ session: loginTestUser(anna).token });
    const r = await call("GET", "/api/v1/users/directory");
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual({
      items: [
        { id: anna.id, displayName: "Anna Muster", ownershipBps: 7000 },
        { id: ben.id, displayName: "Ben", ownershipBps: 3000 },
        { id: cleo.id, displayName: "cleo", ownershipBps: 0 },
      ],
      nextCursor: null,
    });
  });

  it("needs the read scope: it shows the ownership shares, so a token without scopes is refused", async () => {
    const user = await createTestUser({ displayName: "Zoe" });
    const none = createTestToken(user, { scopes: [], kind: "integration" });
    const refused = await createCaller({ bearer: none.token })(
      "GET",
      "/api/v1/users/directory",
    );
    expect([refused.res.status, errorCode(refused)]).toEqual([
      403,
      "forbidden",
    ]);
    const other = createTestToken(user, {
      scopes: ["write", "costs:write"],
      kind: "integration",
    });
    expect(
      (
        await createCaller({ bearer: other.token })(
          "GET",
          "/api/v1/users/directory",
        )
      ).res.status,
    ).toBe(403);
    const reader = createTestToken(user, {
      scopes: ["read"],
      kind: "integration",
    });
    const r = await createCaller({ bearer: reader.token })(
      "GET",
      "/api/v1/users/directory",
    );
    expect(r.res.status).toBe(200);
    expect((r.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it("does not get confused with the administrator's user list", async () => {
    const member = await createTestUser();
    const call = createCaller({ session: loginTestUser(member).token });
    expect((await call("GET", "/api/v1/users")).res.status).toBe(403);
  });
});
