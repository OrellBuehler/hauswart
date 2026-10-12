import { describe, expect, it, vi } from "vitest";
import { movedBy, saveOrder } from "./reorder";

describe("movedBy", () => {
  it("moves an item up or down by one place", () => {
    expect(movedBy(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(movedBy(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("leaves the list alone and says so when the item cannot move that way", () => {
    expect(movedBy(["a", "b"], 0, -1)).toBeNull();
    expect(movedBy(["a", "b"], 1, 1)).toBeNull();
    expect(movedBy(["a", "b"], 5, -1)).toBeNull();
    expect(movedBy([], 0, 1)).toBeNull();
  });

  it("does not change the list it was given", () => {
    const list = ["a", "b", "c"];
    movedBy(list, 0, 1);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("saveOrder", () => {
  it("runs every request, then refreshes", async () => {
    const calls: string[] = [];
    const errors = await saveOrder(
      [async () => void calls.push("a"), async () => void calls.push("b")],
      async () => void calls.push("refresh"),
    );
    expect(errors).toEqual([]);
    expect(calls).toEqual(["a", "b", "refresh"]);
  });

  it("still refreshes when a request failed, so the order shown is the server's", async () => {
    const refresh = vi.fn(async () => {});
    const boom = new Error("boom");
    const errors = await saveOrder(
      [async () => {}, () => Promise.reject(boom)],
      refresh,
    );
    expect(errors).toEqual([boom]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("waits for the slower requests before it refreshes, even after a failure", async () => {
    const order: string[] = [];
    const slow = new Promise<void>((resolve) =>
      setTimeout(() => {
        order.push("slow done");
        resolve();
      }, 20),
    );
    const errors = await saveOrder(
      [() => slow, () => Promise.reject(new Error("fast failure"))],
      async () => void order.push("refresh"),
    );
    expect(errors).toHaveLength(1);
    expect(order).toEqual(["slow done", "refresh"]);
  });

  it("refreshes once with nothing to save", async () => {
    const refresh = vi.fn(async () => {});
    expect(await saveOrder([], refresh)).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
