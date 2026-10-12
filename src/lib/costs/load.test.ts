import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "$lib/api/errors";
import type { ApiClient } from "$lib/api/client";
import {
  tryLoadBudgetAlerts,
  tryLoadFinanceConnected,
  tryLoadPendingReceipts,
} from "./load";

function client(answer: () => unknown) {
  const calls: { id: string; input: unknown }[] = [];
  const api = {
    call: async (endpoint: { id: string }, input: unknown) => {
      calls.push({ id: endpoint.id, input });
      return answer();
    },
  } as unknown as ApiClient;
  return { api, calls };
}

describe("the badge of waiting receipts", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("asks for the count and nothing else, not for the tasks", async () => {
    const { api, calls } = client(() => ({ count: 7 }));
    expect(await tryLoadPendingReceipts(api, "/costs")).toBe(7);
    expect(calls).toEqual([
      { id: "aiTasksCount", input: { query: { status: "pending" } } },
    ]);
  });

  it("is exact however many receipts wait", async () => {
    const { api } = client(() => ({ count: 340 }));
    expect(await tryLoadPendingReceipts(api, "/costs")).toBe(340);
  });

  it("lets the page open without the badge when the count cannot be read", async () => {
    const { api } = client(() => {
      throw new ApiError("internal", "boom", { status: 500 });
    });
    expect(await tryLoadPendingReceipts(api, "/costs")).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "pending receipts unavailable",
      "internal",
      500,
    );
  });

  it("sends a signed-out session to the login page and does not hide any other failure", async () => {
    const { api } = client(() => {
      throw new ApiError("unauthenticated", "no", { status: 401 });
    });
    await expect(
      tryLoadPendingReceipts(api, "/costs?book=b1"),
    ).rejects.toMatchObject({
      status: 303,
      location: "/login?redirectTo=%2Fcosts%3Fbook%3Db1",
    });
    const broken = client(() => {
      throw new TypeError("not an API error");
    });
    await expect(tryLoadPendingReceipts(broken.api, "/costs")).rejects.toThrow(
      "not an API error",
    );
  });
});

describe("whether bank transactions can be looked up", () => {
  const working = {
    available: true,
    configured: true,
    enabled: true,
    capabilities: ["categories"],
  };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("is true for a working finance connection and false for any other", async () => {
    expect(
      await tryLoadFinanceConnected(
        client(() => ({ items: [working] })).api,
        "/costs/new",
      ),
    ).toBe(true);
    expect(
      await tryLoadFinanceConnected(
        client(() => ({ items: [{ ...working, enabled: false }] })).api,
        "/costs/new",
      ),
    ).toBe(false);
    expect(
      await tryLoadFinanceConnected(
        client(() => ({ items: [] })).api,
        "/costs/new",
      ),
    ).toBe(false);
  });

  it("opens the form without the lookup when the connections cannot be read", async () => {
    const { api } = client(() => {
      throw new ApiError("upstream_error", "boom", { status: 502 });
    });
    expect(await tryLoadFinanceConnected(api, "/costs/new")).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      "finance connection unavailable",
      "upstream_error",
      502,
    );
  });

  it("sends a signed-out session to the login page and does not hide any other failure", async () => {
    const { api } = client(() => {
      throw new ApiError("unauthenticated", "no", { status: 401 });
    });
    await expect(
      tryLoadFinanceConnected(api, "/costs/new"),
    ).rejects.toMatchObject({
      status: 303,
      location: "/login?redirectTo=%2Fcosts%2Fnew",
    });
    const broken = client(() => {
      throw new TypeError("not an API error");
    });
    await expect(
      tryLoadFinanceConnected(broken.api, "/costs/new"),
    ).rejects.toThrow("not an API error");
  });
});

describe("the hint for budgets on the dashboard", () => {
  const entry = (state: string) => ({ state });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("asks once, for today's month and year, and counts what needs attention", async () => {
    const { api, calls } = client(() => ({
      items: [
        entry("ok"),
        entry("warning"),
        entry("exceeded"),
        entry("exceeded"),
      ],
    }));
    expect(await tryLoadBudgetAlerts(api, "/")).toEqual({
      exceeded: 2,
      warning: 1,
    });
    expect(calls).toEqual([{ id: "costBudgetsStatus", input: { query: {} } }]);
  });

  it("opens the dashboard without the hint when the status cannot be read", async () => {
    const { api } = client(() => {
      throw new ApiError("internal", "boom", { status: 500 });
    });
    expect(await tryLoadBudgetAlerts(api, "/")).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "budget status unavailable",
      "internal",
      500,
    );
  });

  it("sends a signed-out session to the login page and does not hide any other failure", async () => {
    const { api } = client(() => {
      throw new ApiError("unauthenticated", "no", { status: 401 });
    });
    await expect(tryLoadBudgetAlerts(api, "/")).rejects.toMatchObject({
      status: 303,
      location: "/login?redirectTo=%2F",
    });
    const broken = client(() => {
      throw new TypeError("not an API error");
    });
    await expect(tryLoadBudgetAlerts(broken.api, "/")).rejects.toThrow(
      "not an API error",
    );
  });
});
