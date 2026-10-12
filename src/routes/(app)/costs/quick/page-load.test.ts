import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "$lib/api/errors";

type Page = { items: unknown[]; nextCursor: string | null };

const state = vi.hoisted(() => ({
  calls: [] as string[],
  failBooks: null as unknown,
}));

const empty: Page = { items: [], nextCursor: null };
const book = { id: "b1", name: "Wohnung", archivedAt: null };
const tag = { id: "t1", name: "Ferien", color: "blue", entryCount: 2 };

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
          if (state.failBooks) throw state.failBooks;
          return { items: [book], nextCursor: null };
        case "costTagsList":
          return { items: [tag] };
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
    state.failBooks = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reads nothing from the address, so switching the mode or the book fetches nothing again", async () => {
    const { event, read } = pageEvent(
      "http://localhost/costs/quick?mode=receipt&book=b1",
    );
    await load(event);
    expect(read).toEqual([]);
  });

  it("hands over what the form needs and does not wait for the recent categories", async () => {
    const { event } = pageEvent("http://localhost/costs/quick");
    const data = (await load(event)) as Record<string, unknown>;
    expect(data.currency).toBe("CHF");
    expect(data.books).toEqual([book]);
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // archived devices are not offered
    expect((data.assets as { id: string }[]).map((a) => a.id)).toEqual(["a1"]);
    // the form fetches the categories itself, once it is on screen
    expect(data).not.toHaveProperty("history");
    expect(state.calls).not.toContain("costsRecentCategories");
    expect(state.calls).not.toContain("costsList");
  });

  it("hands over the tags", async () => {
    const data = (await load(
      pageEvent("http://localhost/costs/quick").event,
    )) as Record<string, unknown>;
    expect(data.tags).toEqual([tag]);
  });

  it("sends a signed-out session to the login page and does not hide any other failure", async () => {
    state.failBooks = new ApiError("unauthenticated", "no", { status: 401 });
    await expect(
      load(pageEvent("http://localhost/costs/quick?mode=receipt").event),
    ).rejects.toMatchObject({
      status: 303,
      location: "/login?redirectTo=%2Fcosts%2Fquick%3Fmode%3Dreceipt",
    });
    state.failBooks = new TypeError("not an API error");
    await expect(
      load(pageEvent("http://localhost/costs/quick").event),
    ).rejects.toThrow("not an API error");
  });
});
