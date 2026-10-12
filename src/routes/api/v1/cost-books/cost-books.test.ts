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

interface Book {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  defaultSplitMode: string;
  taxRelevant: boolean;
  archivedAt: string | null;
  sortOrder: number;
  isDefault: boolean;
  entryCount: number;
  settlementCount: number;
}
type Page = { items: Book[]; nextCursor: string | null };

describe("cost books API", () => {
  useTestDB();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const callBen = createCaller({ session: loginTestUser(ben).token });
    return { anna, ben, call, callBen };
  }
  const books = async (call: ReturnType<typeof createCaller>, q = "") =>
    ((await call("GET", `/api/v1/cost-books${q}`)).body as Page).items;

  it("lists the default books", async () => {
    const { call } = await setup();
    const list = await call("GET", "/api/v1/cost-books");
    expect(list.res.status).toBe(200);
    const items = (list.body as Page).items;
    expect(items.map((b) => b.name)).toEqual(["Wohnung", "Haushalt", "Auto"]);
    expect(items[0]).toMatchObject({
      slug: "wohnung",
      taxRelevant: true,
      defaultSplitMode: "ownership",
      isDefault: true,
      archivedAt: null,
      entryCount: 0,
      settlementCount: 0,
    });
    expect(items.filter((b) => b.isDefault)).toHaveLength(1);
    expect((list.body as Page).nextCursor).toBeNull();
  });

  it("creates, reads, changes, archives and deletes a book", async () => {
    const { call } = await setup();
    const created = await call("POST", "/api/v1/cost-books", {
      json: {
        name: "Ferien",
        icon: "plane",
        defaultSplitMode: "equal",
        taxRelevant: false,
      },
    });
    expect(created.res.status).toBe(201);
    const book = created.body as Book;
    expect(book).toMatchObject({
      name: "Ferien",
      slug: "ferien",
      icon: "plane",
      defaultSplitMode: "equal",
      sortOrder: 3,
    });
    expect(
      ((await call("GET", `/api/v1/cost-books/${book.id}`)).body as Book).name,
    ).toBe("Ferien");

    const patched = await call("PATCH", `/api/v1/cost-books/${book.id}`, {
      json: { name: "Sommerferien", taxRelevant: true, sortOrder: 7 },
    });
    expect(patched.body).toMatchObject({
      name: "Sommerferien",
      slug: "ferien",
      taxRelevant: true,
      sortOrder: 7,
    });

    const archived = await call("PATCH", `/api/v1/cost-books/${book.id}`, {
      json: { archived: true },
    });
    expect((archived.body as Book).archivedAt).toEqual(expect.any(String));
    expect((await books(call)).map((b) => b.name)).not.toContain(
      "Sommerferien",
    );
    expect(
      (await books(call, "?includeArchived=true")).map((b) => b.name),
    ).toEqual(["Wohnung", "Haushalt", "Auto", "Sommerferien"]);
    const restored = await call("PATCH", `/api/v1/cost-books/${book.id}`, {
      json: { archived: false },
    });
    expect((restored.body as Book).archivedAt).toBeNull();

    expect(
      (await call("DELETE", `/api/v1/cost-books/${book.id}`)).res.status,
    ).toBe(204);
    expect(
      (await call("GET", `/api/v1/cost-books/${book.id}`)).res.status,
    ).toBe(404);
    expect(
      (await call("DELETE", `/api/v1/cost-books/${book.id}`)).res.status,
    ).toBe(404);
  });

  it("validates the body", async () => {
    const { call } = await setup();
    const bad = async (json: object) =>
      (await call("POST", "/api/v1/cost-books", { json })).res.status;
    expect(await bad({})).toBe(400);
    expect(await bad({ name: "  " })).toBe(400);
    expect(await bad({ name: "x".repeat(61) })).toBe(400);
    expect(await bad({ name: "Ok", defaultSplitMode: "custom" })).toBe(400);
    expect(await bad({ name: "Ok", taxRelevant: "yes" })).toBe(400);
    expect(await bad({ name: "Ok", slug: "Not A Slug" })).toBe(400);
    expect(await bad({ name: "Ok", archived: true })).toBe(400);
    expect(await bad({ name: "Ok", unknown: 1 })).toBe(400);
    expect(
      (await call("PATCH", "/api/v1/cost-books/x", { json: {} })).res.status,
    ).toBe(400);
    expect(
      (await call("GET", "/api/v1/cost-books?includeArchived=maybe")).res
        .status,
    ).toBe(400);
  });

  it("answers 404 for an unknown book on every verb", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/v1/cost-books/nope")).res.status).toBe(404);
    expect(
      (await call("PATCH", "/api/v1/cost-books/nope", { json: { name: "x" } }))
        .res.status,
    ).toBe(404);
    expect((await call("DELETE", "/api/v1/cost-books/nope")).res.status).toBe(
      404,
    );
  });

  it("refuses a name that exists, whatever the case", async () => {
    const { call } = await setup();
    for (const name of ["wohnung", "HAUSHALT"]) {
      const r = await call("POST", "/api/v1/cost-books", { json: { name } });
      expect([r.res.status, errorCode(r)]).toEqual([409, "conflict"]);
    }
    const auto = (await books(call)).find((b) => b.name === "Auto")!;
    const r = await call("PATCH", `/api/v1/cost-books/${auto.id}`, {
      json: { name: "wohnung" },
    });
    expect(r.res.status).toBe(409);
  });

  it("will not delete a book with entries, and says how many", async () => {
    const { call } = await setup();
    const haushalt = (await books(call)).find((b) => b.name === "Haushalt")!;
    for (let i = 0; i < 2; i++) {
      const r = await call("POST", "/api/v1/costs", {
        json: {
          title: "Einkauf",
          amountMinor: 1000,
          category: "groceries",
          bookId: haushalt.id,
        },
      });
      expect(r.res.status).toBe(201);
    }
    const refused = await call("DELETE", `/api/v1/cost-books/${haushalt.id}`);
    expect([refused.res.status, errorCode(refused)]).toEqual([409, "conflict"]);
    expect(
      (refused.body as { error: { details: unknown } }).error.details,
    ).toEqual({ entryCount: 2, settlementCount: 0 });
    expect(
      ((await call("GET", `/api/v1/cost-books/${haushalt.id}`)).body as Book)
        .entryCount,
    ).toBe(2);
    // archiving is the way out
    expect(
      (
        await call("PATCH", `/api/v1/cost-books/${haushalt.id}`, {
          json: { archived: true },
        })
      ).res.status,
    ).toBe(200);
  });

  it("keeps one book open: the last one that is not archived cannot be archived or deleted", async () => {
    const { call } = await setup();
    const all = await books(call);
    for (const b of all.slice(1)) {
      await call("PATCH", `/api/v1/cost-books/${b.id}`, {
        json: { archived: true },
      });
    }
    const last = all[0];
    const archive = await call("PATCH", `/api/v1/cost-books/${last.id}`, {
      json: { archived: true },
    });
    expect([archive.res.status, errorCode(archive)]).toEqual([409, "conflict"]);
    const del = await call("DELETE", `/api/v1/cost-books/${last.id}`);
    expect(del.res.status).toBe(409);
  });

  describe("authorisation", () => {
    it("reading needs read, writing needs costs:write", async () => {
      const user = await createTestUser();
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      const writer = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "costs:write"] })
          .token,
      });
      const plainWrite = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "write"] }).token,
      });
      expect((await reader("GET", "/api/v1/cost-books")).res.status).toBe(200);
      expect(
        (await reader("POST", "/api/v1/cost-books", { json: { name: "A" } }))
          .res.status,
      ).toBe(403);
      expect(
        (
          await plainWrite("POST", "/api/v1/cost-books", {
            json: { name: "A" },
          })
        ).res.status,
      ).toBe(403);
      const made = await writer("POST", "/api/v1/cost-books", {
        json: { name: "A" },
      });
      expect(made.res.status).toBe(201);
      const id = (made.body as Book).id;
      expect((await reader("GET", `/api/v1/cost-books/${id}`)).res.status).toBe(
        200,
      );
      for (const [method, json] of [
        ["PATCH", { name: "B" }],
        ["DELETE", undefined],
      ] as const) {
        expect(
          (await reader(method, `/api/v1/cost-books/${id}`, { json })).res
            .status,
        ).toBe(403);
        expect(
          (await plainWrite(method, `/api/v1/cost-books/${id}`, { json })).res
            .status,
        ).toBe(403);
      }
      expect(
        (await writer("DELETE", `/api/v1/cost-books/${id}`)).res.status,
      ).toBe(204);
    });

    it("books are shared: every member sees and changes every book", async () => {
      const { call, callBen } = await setup();
      const created = (
        await call("POST", "/api/v1/cost-books", {
          json: { name: "Gemeinsam" },
        })
      ).body as Book;
      expect((await books(callBen)).map((b) => b.name)).toContain("Gemeinsam");
      expect(
        (
          await callBen("PATCH", `/api/v1/cost-books/${created.id}`, {
            json: { name: "Von Ben" },
          })
        ).res.status,
      ).toBe(200);
    });
  });

  describe("the default book", () => {
    const patch = (
      call: ReturnType<typeof createCaller>,
      id: string,
      json: Record<string, unknown>,
    ) => call("PATCH", `/api/v1/cost-books/${id}`, { json });
    const defaults = async (call: ReturnType<typeof createCaller>) =>
      (await books(call, "?includeArchived=true"))
        .filter((b) => b.isDefault)
        .map((b) => b.name);

    it("moves with isDefault, one at a time, and reordering leaves it alone", async () => {
      const { call } = await setup();
      const [wohnung, haushalt, auto] = await books(call);
      const moved = await patch(call, haushalt.id, { isDefault: true });
      expect(moved.res.status).toBe(200);
      expect((moved.body as Book).isDefault).toBe(true);
      expect(await defaults(call)).toEqual(["Haushalt"]);

      await patch(call, auto.id, { sortOrder: 0 });
      await patch(call, wohnung.id, { sortOrder: 9 });
      expect(await defaults(call)).toEqual(["Haushalt"]);
    });

    it("answers 409 for switching the default off and 400 for an archived book", async () => {
      const { call } = await setup();
      const [wohnung, haushalt] = await books(call);
      const off = await patch(call, wohnung.id, { isDefault: false });
      expect(off.res.status).toBe(409);
      expect(errorCode(off)).toBe("conflict");

      await patch(call, haushalt.id, { archived: true });
      const archived = await patch(call, haushalt.id, { isDefault: true });
      expect(archived.res.status).toBe(400);
      expect(errorCode(archived)).toBe("invalid_request");
      expect(await defaults(call)).toEqual(["Wohnung"]);
    });

    it("is handed on when the default is archived", async () => {
      const { call } = await setup();
      const [wohnung] = await books(call);
      expect(
        (await patch(call, wohnung.id, { archived: true })).res.status,
      ).toBe(200);
      expect(await defaults(call)).toEqual(["Haushalt"]);
    });

    it("can be set when a book is created", async () => {
      const { call } = await setup();
      const created = await call("POST", "/api/v1/cost-books", {
        json: { name: "Ferien", isDefault: true },
      });
      expect(created.res.status).toBe(201);
      expect((created.body as Book).isDefault).toBe(true);
      expect(await defaults(call)).toEqual(["Ferien"]);
    });

    it("needs the costs:write scope like any change", async () => {
      const { anna } = await setup();
      const call = createCaller({
        bearer: createTestToken(anna, { scopes: ["read"] }).token,
      });
      const [haushalt] = (await books(call)).slice(1);
      expect(
        (await patch(call, haushalt.id, { isDefault: true })).res.status,
      ).toBe(403);
    });
  });

  it("works through the typed client", async () => {
    const user = await createTestUser();
    const client = createApiClient(
      createInProcessFetch({
        bearer: createTestToken(user, { scopes: ["read", "costs:write"] })
          .token,
      }),
    );
    const book = await client.call(endpoints.costBooksCreate, {
      body: { name: "Wochenende", defaultSplitMode: "none" },
    });
    expect(book.defaultSplitMode).toBe("none");
    const list = await client.call(endpoints.costBooksList, {
      query: { includeArchived: "true", limit: 50 },
    });
    expect(list.items.map((b) => b.name)).toContain("Wochenende");
    await client.call(endpoints.costBooksDelete, { params: { id: book.id } });
  });
});
