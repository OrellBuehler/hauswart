import { beforeEach, describe, expect, it, vi } from "vitest";

type Query = Record<string, unknown>;

const state = vi.hoisted(() => ({
  queries: [] as Query[],
}));

const task = (id: string, status: string) => ({ id, status });

vi.mock("$lib/api/client", () => ({
  createApiClient: () => ({
    call: async (endpoint: { id: string }, input?: { query?: Query }) => {
      if (endpoint.id === "householdGet") {
        return { timezone: "Europe/Zurich", settings: { dueSoonDays: 3 } };
      }
      const query = input?.query ?? {};
      state.queries.push(query);
      if (query.status === "pending") {
        return {
          items: [task("p1", "pending"), task("p2", "pending")],
          nextCursor: null,
        };
      }
      if (query.status === "done") {
        return { items: [task("d1", "done")], nextCursor: "next" };
      }
      return {
        items: [
          task("d1", "done"),
          task("p2", "pending"),
          task("x1", "dismissed"),
        ],
        nextCursor: "more",
      };
    },
  }),
}));

import { load } from "./+page";

function pageEvent(address: string) {
  const url = new URL(address);
  return {
    fetch: (() => {
      throw new Error("the API client is replaced in this test");
    }) as unknown as typeof fetch,
    url,
  } as unknown as Parameters<typeof load>[0];
}

const ids = (data: unknown) =>
  (data as { tasks: { id: string }[] }).tasks.map((t) => t.id);

describe("loading the receipts page", () => {
  beforeEach(() => {
    state.queries = [];
  });

  it("lists what waits first and then the history, each task once", async () => {
    const data = await load(pageEvent("http://localhost/costs/receipts"));
    expect(ids(data)).toEqual(["p1", "p2", "d1", "x1"]);
    expect(data).toMatchObject({
      view: "all",
      pendingCount: 2,
      nextCursor: "more",
    });
    // everything that waits is read completely, then one page of the history
    expect(state.queries).toEqual([
      { status: "pending", limit: 100 },
      { limit: 30 },
    ]);
  });

  it("asks only for what waits in that view", async () => {
    const data = await load(
      pageEvent("http://localhost/costs/receipts?status=pending"),
    );
    expect(ids(data)).toEqual(["p1", "p2"]);
    expect(data).toMatchObject({ view: "pending", nextCursor: null });
    expect(state.queries).toEqual([{ status: "pending", limit: 100 }]);
  });

  it("asks for one status of the history, and still counts what waits", async () => {
    const data = await load(
      pageEvent("http://localhost/costs/receipts?status=done"),
    );
    expect(ids(data)).toEqual(["d1"]);
    expect(data).toMatchObject({
      view: "done",
      pendingCount: 2,
      nextCursor: "next",
    });
    expect(state.queries).toContainEqual({ limit: 30, status: "done" });
  });

  it("lists everything for a status it does not know", async () => {
    const data = await load(
      pageEvent("http://localhost/costs/receipts?status=nope"),
    );
    expect((data as { view: string }).view).toBe("all");
  });
});
