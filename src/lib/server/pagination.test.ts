import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "$lib/api/errors";
import {
  decodeCursor,
  encodeCursor,
  pageOf,
  paginateArray,
} from "./pagination";

describe("cursors", () => {
  it("round-trips", () => {
    const schema = z.object({ o: z.number() });
    expect(decodeCursor(encodeCursor({ o: 5 }), schema)).toEqual({ o: 5 });
  });

  it.each(["not-base64-json", encodeCursor("x"), encodeCursor({ o: -1 })])(
    "rejects a forged cursor (%s) as a 400",
    (cursor) => {
      const schema = z.object({ o: z.number().min(0) });
      try {
        decodeCursor(cursor, schema);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe("invalid_request");
      }
    },
  );
});

describe("paginateArray", () => {
  const items = [1, 2, 3, 4, 5];
  it("walks every page exactly once", () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const page = paginateArray(items, cursor, 2);
      seen.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(items);
  });

  it("has no next cursor when everything fits", () => {
    expect(paginateArray(items, undefined, 5)).toEqual({
      items,
      nextCursor: null,
    });
  });
});

describe("pageOf", () => {
  it("cuts the extra row and builds the cursor from the last kept one", () => {
    const page = pageOf([1, 2, 3], 2, (n) => ({ n }));
    expect(page.items).toEqual([1, 2]);
    expect(
      decodeCursor(page.nextCursor as string, z.object({ n: z.number() })),
    ).toEqual({ n: 2 });
  });

  it("returns null when the rows fit", () => {
    expect(pageOf([1, 2], 2, (n) => n).nextCursor).toBeNull();
  });
});
