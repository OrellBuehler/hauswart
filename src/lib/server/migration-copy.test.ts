import { describe, expect, it } from "vitest";
import { safetyCopyEnabled } from "./migration-copy";

describe("safetyCopyEnabled", () => {
  it.each([
    [undefined, true],
    ["", true],
    ["  ", true],
    ["true", true],
    ["TRUE", true],
    ["1", true],
    ["on", true],
    ["yes", true],
    ["false", false],
    [" False ", false],
    ["0", false],
    ["off", false],
    ["no", false],
  ])("reads %j as %s", (value, expected) => {
    expect(safetyCopyEnabled({ HAUSWART_MIGRATION_BACKUP: value })).toBe(
      expected,
    );
  });

  it.each(["flase", "2", "disabled"])(
    "does not take %j for off or on",
    (value) => {
      expect(() =>
        safetyCopyEnabled({ HAUSWART_MIGRATION_BACKUP: value }),
      ).toThrow(/HAUSWART_MIGRATION_BACKUP/);
    },
  );
});
