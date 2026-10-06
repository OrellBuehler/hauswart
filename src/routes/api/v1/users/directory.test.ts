import { describe, expect, it } from "vitest";
import { createCaller } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

describe("users directory API", () => {
  useTestDB();

  it("gives every member the id and display name of everyone, nothing else", async () => {
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
    const call = createCaller({ session: loginTestUser(anna).token });
    const r = await call("GET", "/api/v1/users/directory");
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual({
      items: [
        { id: anna.id, displayName: "Anna Muster" },
        { id: ben.id, displayName: "Ben" },
        { id: cleo.id, displayName: "cleo" },
      ],
      nextCursor: null,
    });
  });

  it("works for tokens without scopes", async () => {
    const user = await createTestUser({ displayName: "Zoe" });
    const token = createTestToken(user, {
      scopes: [],
      kind: "integration",
    }).token;
    const r = await createCaller({ bearer: token })(
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
