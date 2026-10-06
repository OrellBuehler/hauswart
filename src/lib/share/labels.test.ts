import { describe, expect, it } from "vitest";
import { GUEST_PIN_PATTERN } from "$lib/api/schemas/share";
import { generatePin } from "./labels";

describe("generatePin", () => {
  it("returns a numeric PIN the API accepts", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePin()).toMatch(GUEST_PIN_PATTERN);
    }
    expect(generatePin(8)).toHaveLength(8);
  });
});
