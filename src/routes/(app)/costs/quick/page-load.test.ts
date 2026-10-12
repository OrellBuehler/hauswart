import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "$lib/api/errors";

type Page = { items: unknown[]; nextCursor: string | null };

const state = vi.hoisted(() => ({
  calls: [] as string[],
  failCosts: null as unknown,
}));

const empty: Page = { items: [], nextCursor: null };
const book = { id: "b1", name: "Wohnung", archivedAt: null };

vi.mock("$lib/api/client", () => ({
  createApiClient: () => ({
    call: async (endpoint: { id: string }) => {
      state.calls.push(endpoint.id);
      switch (endpoint.id) {
        case "householdGet":
          return {
            timezone: "Europe/Zurich",
            currency: "CHF",
            settings: { dueSoonDays: 3 },
          };
        case "costBooksList":
          return { items: [book], nextCursor: null };
        case "usersDirectory":
          return { items: [{ id: "u1", displayName: "Anna Beispiel" }] };
        case "assetsList":
          return {
            items: [
              { id: "a1", name: "Waschmaschine", archivedAt: null },
              { id: "a2", name: "Alter Ofen", archivedAt: "2026-01-01" },
            ],
            nextCursor: null,
          };
        case "costsList":
          if (state.failCosts) throw state.failCosts;
          return {
            items: [
              { id: "c1", bookId: "b1", category: "repair", title: "Hahn" },
              { id: "c2", bookId: "b1", category: "groceries", title: "Brot" },
            ],
            nextCursor: null,
          };
        default:
          return empty;
      }
    },
  }),
}));

import { load } from "./+page";

/** The address as SvelteKit hands it to `load`: what is touched outside `untrack` counts as read. */
function pageEvent(address: string) {
  const real = new URL(address);
  const read: string[] = [];
  let untracked = false;
  const url = {
    get pathname() {
      if (!untracked) read.push("pathname");
      return real.pathname;
    },
    get search() {
      if (!untracked) read.push("search");
      return real.search;
    },
    searchParams: {
      get: (name: string) => {
        if (!untracked) read.push(`searchParams.get(${name})`);
        return real.searchParams.get(name);
      },
    },
  };
  const event = {
    fetch: (() => {
      throw new Error("the API client is replaced in this test");
    }) as unknown as typeof fetch,
    url,
    untrack: <T>(fn: () => T): T => {
      const before = untracked;
      untracked = true;
      try {
        return fn();
      } finally {
        untracked = before;
      }
    },
  };
  return { event: event as unknown as Parameters<typeof load>[0], read };
}

describe("loading the quick entry", () => {
  beforeEach(() => {
    state.calls = [];
    state.failCosts = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reads nothing from the address, so switching the mode or the book fetches nothing again", async () => {
    const { event, read } = pageEvent(
      "http://localhost/costs/quick?mode=receipt&book=b1",
    );
    await load(event);
    expect(read).toEqual([]);
  });

  it("hands over what the form needs: books, people, today's devices, the household currency and a slim history", async () => {
    const { event } = pageEvent("http://localhost/costs/quick");
    const data = (await load(event)) as Record<string, unknown>;
    expect(data.currency).toBe("CHF");
    expect(data.books).toEqual([book]);
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // archived devices are not offered
    expect((data.assets as { id: string }[]).map((a) => a.id)).toEqual(["a1"]);
    // only what ranks the categories travels to the page
    expect(data.history).toEqual([
      { bookId: "b1", category: "repair" },
      { bookId: "b1", category: "groceries" },
    ]);
  });

  it("still opens when the recent entries cannot be read, with the fixed order of categories", async () => {
    state.failCosts = new ApiError("internal", "boom", { status: 500 });
    const { event } = pageEvent("http://localhost/costs/quick");
    const data = (await load(event)) as { history: unknown[] };
    expect(data.history).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      "recent costs unavailable",
      "internal",
      500,
    );
  });

  it("sends a signed-out session to the login page and does not hide any other failure", async () => {
    state.failCosts = new ApiError("unauthenticated", "no", { status: 401 });
    await expect(
      load(pageEvent("http://localhost/costs/quick?mode=receipt").event),
    ).rejects.toMatchObject({
      status: 303,
      location: "/login?redirectTo=%2Fcosts%2Fquick%3Fmode%3Dreceipt",
    });
    state.failCosts = new TypeError("not an API error");
    await expect(
      load(pageEvent("http://localhost/costs/quick").event),
    ).rejects.toThrow("not an API error");
  });
});
