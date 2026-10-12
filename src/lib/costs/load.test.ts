import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "$lib/api/errors";
import type { ApiClient } from "$lib/api/client";
import { tryLoadPendingReceipts } from "./load";

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
