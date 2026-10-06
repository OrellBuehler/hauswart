import { describe, expect, it } from "vitest";
import { fetchAll } from "./fetch-all";

describe("fetchAll", () => {
  it("follows cursors until the last page", async () => {
    const pages: Record<
      string,
      { items: number[]; nextCursor: string | null }
    > = {
      first: { items: [1, 2], nextCursor: "a" },
      a: { items: [3], nextCursor: "b" },
      b: { items: [4], nextCursor: null },
    };
    const seen: (string | undefined)[] = [];
    const result = await fetchAll(async (cursor) => {
      seen.push(cursor);
      return pages[cursor ?? "first"];
    });
    expect(result).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([undefined, "a", "b"]);
  });

  it("returns an empty list for an empty page", async () => {
    expect(
      await fetchAll(async () => ({ items: [], nextCursor: null })),
    ).toEqual([]);
  });
});
