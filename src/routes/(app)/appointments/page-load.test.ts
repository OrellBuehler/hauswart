import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "$lib/api/errors";

type Query = Record<string, unknown>;

const state = vi.hoisted(() => ({
  queries: [] as Query[],
  failWith: null as unknown,
}));

vi.mock("$lib/api/client", () => ({
  createApiClient: () => ({
    call: async (endpoint: { id: string }, input?: { query?: Query }) => {
      if (state.failWith) throw state.failWith;
      if (endpoint.id === "householdGet") return { timezone: "Europe/Zurich" };
      state.queries.push(input?.query ?? {});
      return { items: [], nextCursor: null };
    },
  }),
}));

import { load } from "./+page";

/**
 * The address of a page as SvelteKit hands it to `load`: the whole address counts as read once
 * `pathname`, `search` or `href` is touched, a search parameter only by its own name, and nothing
 * inside `untrack`.
 */
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
    get href() {
      if (!untracked) read.push("href");
      return real.href;
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

describe("loading the appointment list", () => {
  beforeEach(() => {
    state.queries = [];
    state.failWith = null;
  });

  it("depends on the view alone, so the status chips filter without fetching again", async () => {
    const { event, read } = pageEvent(
      "http://localhost/appointments?view=past&status=done",
    );
    await load(event);
    expect(read).toEqual(["searchParams.get(view)"]);
  });

  it("fetches the range of the view, whatever the status chips say", async () => {
    const upcoming = pageEvent("http://localhost/appointments?status=done");
    await load(upcoming.event);
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]).toMatchObject({ limit: 200 });
    expect(state.queries[0]).toHaveProperty("from");
    expect(state.queries[0]).not.toHaveProperty("to");
    expect(state.queries[0]).not.toHaveProperty("status");

    state.queries = [];
    const past = pageEvent("http://localhost/appointments?view=past");
    await load(past.event);
    expect(state.queries[0]).toHaveProperty("from");
    expect(state.queries[0]).toHaveProperty("to");
  });

  it("sends a person with an expired session back to the whole address", async () => {
    state.failWith = new ApiError("unauthenticated", "Sign in", {
      status: 401,
    });
    const { event } = pageEvent(
      "http://localhost/appointments?view=past&status=done",
    );
    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: `/login?redirectTo=${encodeURIComponent("/appointments?view=past&status=done")}`,
    });
  });
});
