import { describe, expect, it } from "vitest";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
} from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type Call = ReturnType<typeof createCaller>;
interface Cost {
  id: string;
  bookId: string;
  bookName: string;
  deductible: string;
}

describe("POST /api/v1/costs/move-to-book", () => {
  useTestDB();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const bookId = async (name: string) =>
      (
        (await call("GET", "/api/v1/cost-books")).body as {
          items: { id: string; name: string }[];
        }
      ).items.find((b) => b.name === name)!.id;
    const book = async (json: object) =>
      (
        await call("POST", "/api/v1/costs", {
          json: {
            title: "Eintrag",
            amountMinor: 9000,
            category: "maintenance",
            ...json,
          },
        })
      ).body as Cost;
    const costs = async (q = "") =>
      (
        (await call("GET", `/api/v1/costs${q}`)).body as {
          items: Cost[];
        }
      ).items;
    return { anna, call, bookId, book, costs };
  }
  const move = (call: Call, json: object) =>
    call("POST", "/api/v1/costs/move-to-book", { json });

  it("moves the named entries and says what it did", async () => {
    const { call, bookId, book, costs } = await setup();
    const a = await book({ deductible: "maintenance" });
    const b = await book({});
    const haushalt = await bookId("Haushalt");
    const moved = await move(call, { bookId: haushalt, ids: [a.id, b.id] });
    expect(moved.res.status).toBe(200);
    expect(moved.body).toEqual({
      bookId: haushalt,
      moved: 2,
      unchanged: 0,
      deductibleReset: 1,
    });
    const after = await costs(`?bookId=${haushalt}`);
    expect(after.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect(after.every((c) => c.deductible === "unknown")).toBe(true);
    expect(await costs(`?bookId=${await bookId("Wohnung")}`)).toEqual([]);
  });

  it("moves every entry of a device", async () => {
    const { call, bookId, book } = await setup();
    const asset = (
      await call("POST", "/api/v1/assets", {
        json: { kind: "device", name: "Heizung" },
      })
    ).body as { id: string };
    await book({ assetId: asset.id });
    await book({ assetId: asset.id });
    await book({});
    const auto = await bookId("Auto");
    const moved = await move(call, { bookId: auto, assetId: asset.id });
    expect(moved.body).toMatchObject({ moved: 2, unchanged: 0 });
  });

  it("answers 400 for a request that is not clear, an unknown id or an archived book, and 404 is not used", async () => {
    const { call, bookId, book } = await setup();
    const a = await book({});
    const haushalt = await bookId("Haushalt");
    for (const json of [
      { bookId: haushalt },
      { bookId: haushalt, ids: [a.id], assetId: "x" },
      { bookId: haushalt, ids: [] },
      { ids: [a.id] },
    ]) {
      const refused = await move(call, json);
      expect(refused.res.status).toBe(400);
      expect(errorCode(refused)).toBe("invalid_request");
    }
    const unknown = await move(call, {
      bookId: haushalt,
      ids: [a.id, "nope"],
    });
    expect(unknown.res.status).toBe(400);
    await call("PATCH", `/api/v1/cost-books/${haushalt}`, {
      json: { archived: true },
    });
    expect(
      (await move(call, { bookId: haushalt, ids: [a.id] })).res.status,
    ).toBe(400);
  });

  it("needs the costs:write scope", async () => {
    const { anna, bookId, book } = await setup();
    const a = await book({});
    const reader = createCaller({
      bearer: createTestToken(anna, { scopes: ["read", "write"] }).token,
    });
    const refused = await move(reader, {
      bookId: await bookId("Haushalt"),
      ids: [a.id],
    });
    expect(refused.res.status).toBe(403);
    const writer = createCaller({
      bearer: createTestToken(anna, { scopes: ["costs:write"] }).token,
    });
    expect(
      (await move(writer, { bookId: await bookId("Haushalt"), ids: [a.id] }))
        .res.status,
    ).toBe(200);
  });

  it("works through the typed client", async () => {
    const user = await createTestUser();
    const client = createApiClient(
      createInProcessFetch({
        bearer: createTestToken(user, { scopes: ["read", "costs:write"] })
          .token,
      }),
    );
    const books = await client.call(endpoints.costBooksList, {
      query: { limit: 50 },
    });
    const target = books.items.find((b) => b.name === "Auto")!;
    const entry = await client.call(endpoints.costsCreate, {
      body: { title: "Tanken", amountMinor: 5000, category: "fuel" },
    });
    const result = await client.call(endpoints.costsMoveToBook, {
      body: { bookId: target.id, ids: [entry.id] },
    });
    expect(result).toEqual({
      bookId: target.id,
      moved: 1,
      unchanged: 0,
      deductibleReset: 0,
    });
    expect(
      (await client.call(endpoints.costsGet, { params: { id: entry.id } }))
        .bookName,
    ).toBe("Auto");
  });
});
