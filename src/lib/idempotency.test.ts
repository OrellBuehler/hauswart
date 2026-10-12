import { describe, expect, it } from "vitest";
import { newIdempotencyKey } from "./idempotency";

describe("newIdempotencyKey", () => {
  it("makes a key the API takes (8 to 128 characters), different every time", () => {
    const keys = Array.from({ length: 50 }, () => newIdempotencyKey());
    expect(new Set(keys).size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});
