import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

describe("rooms API", () => {
  useTestDB();
  async function member() {
    const user = await createTestUser();
    return createCaller({ session: loginTestUser(user).token });
  }

  it("creates, reads, updates and deletes a room", async () => {
    const call = await member();
    const created = await call("POST", "/api/v1/rooms", {
      json: { name: "Küche", icon: "cooking-pot", notes: "Nordseite" },
    });
    expect(created.res.status).toBe(201);
    const room = created.body as { id: string; slug: string };
    expect(created.body).toMatchObject({
      name: "Küche",
      slug: "kueche",
      icon: "cooking-pot",
      notes: "Nordseite",
      haAreaId: null,
      sortOrder: 0,
    });

    const got = await call("GET", `/api/v1/rooms/${room.id}`);
    expect(got.res.status).toBe(200);
    expect(got.body).toEqual(created.body);

    const patched = await call("PATCH", `/api/v1/rooms/${room.id}`, {
      json: { name: "Wohnküche", haAreaId: "kitchen", notes: null },
    });
    expect(patched.body).toMatchObject({
      name: "Wohnküche",
      slug: "kueche",
      haAreaId: "kitchen",
      notes: null,
    });

    const removed = await call("DELETE", `/api/v1/rooms/${room.id}`);
    expect(removed.res.status).toBe(204);
    expect(errorCode(await call("GET", `/api/v1/rooms/${room.id}`))).toBe(
      "not_found",
    );
  });

  it("lists with a cursor", async () => {
    const call = await member();
    for (const name of ["A", "B", "C"]) {
      await call("POST", "/api/v1/rooms", { json: { name } });
    }
    const first = await call("GET", "/api/v1/rooms?limit=2");
    const page1 = first.body as {
      items: { name: string }[];
      nextCursor: string;
    };
    expect(page1.items.map((r) => r.name)).toEqual(["A", "B"]);
    const second = await call(
      "GET",
      `/api/v1/rooms?limit=2&cursor=${page1.nextCursor}`,
    );
    expect(second.body).toMatchObject({
      items: [{ name: "C" }],
      nextCursor: null,
    });
  });

  it("validates input", async () => {
    const call = await member();
    for (const json of [
      {},
      { name: "" },
      { name: "x", unknown: 1 },
      { name: "x", slug: "Not A Slug" },
      { name: "x", sortOrder: -1 },
    ]) {
      const r = await call("POST", "/api/v1/rooms", { json });
      expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
    }
    const room = (
      await call("POST", "/api/v1/rooms", { json: { name: "Bad" } })
    ).body as { id: string };
    expect(
      errorCode(await call("PATCH", `/api/v1/rooms/${room.id}`, { json: {} })),
    ).toBe("invalid_request");
    const badCursor = await call("GET", "/api/v1/rooms?cursor=garbage");
    expect([badCursor.res.status, errorCode(badCursor)]).toEqual([
      400,
      "invalid_request",
    ]);
    expect((await call("GET", "/api/v1/rooms?limit=0")).res.status).toBe(400);
  });

  it("answers 404 for unknown rooms and 409 for a taken slug", async () => {
    const call = await member();
    for (const [method, json] of [
      ["GET", undefined],
      ["PATCH", { name: "x" }],
      ["DELETE", undefined],
    ] as const) {
      const r = await call(method, "/api/v1/rooms/nope", { json });
      expect([r.res.status, errorCode(r)]).toEqual([404, "not_found"]);
    }
    await call("POST", "/api/v1/rooms", { json: { name: "Bad", slug: "bad" } });
    const dup = await call("POST", "/api/v1/rooms", {
      json: { name: "Bad 2", slug: "bad" },
    });
    expect([dup.res.status, errorCode(dup)]).toEqual([409, "conflict"]);
  });

  it("needs write access to change rooms, read access to look", async () => {
    const user = await createTestUser();
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"], kind: "integration" })
        .token,
    });
    expect((await reader("GET", "/api/v1/rooms")).res.status).toBe(200);
    const denied = await reader("POST", "/api/v1/rooms", {
      json: { name: "x" },
    });
    expect([denied.res.status, errorCode(denied)]).toEqual([403, "forbidden"]);
    const writer = createCaller({
      bearer: createTestToken(user, { scopes: ["write"], kind: "integration" })
        .token,
    });
    expect(
      (await writer("POST", "/api/v1/rooms", { json: { name: "x" } })).res
        .status,
    ).toBe(201);
    expect((await writer("GET", "/api/v1/rooms")).res.status).toBe(403);
  });
});
