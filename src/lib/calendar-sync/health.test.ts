import { describe, expect, it } from "vitest";
import { targetDto } from "$lib/testing/calendar-targets";
import { awaitsFirstRun, targetState } from "./health";

describe("targetState", () => {
  it.each([
    ["a healthy target", {}, true, "ok"],
    [
      "a failed one",
      { status: "error" as const, lastError: "tls" },
      true,
      "error",
    ],
    [
      "one nobody has tried yet",
      { status: "unknown" as const, lastCheckedAt: null, lastOkAt: null },
      true,
      "waiting",
    ],
    [
      "one that was tried but has no verdict",
      { status: "unknown" as const },
      true,
      "waiting",
    ],
    ["a switched-off one", { enabled: false }, true, "paused"],
    [
      "a switched-off one whose last run failed",
      { enabled: false, status: "error" as const },
      true,
      "paused",
    ],
    ["one whose connection is not active", {}, false, "offline"],
    [
      "one that failed while its connection is off",
      { status: "error" as const },
      false,
      "offline",
    ],
  ])("%s is %s", (_name, over, usable, expected) => {
    expect(targetState(targetDto(over), usable)).toBe(expected);
  });
});

describe("awaitsFirstRun", () => {
  it("is true for a switched-on target that was never attempted", () => {
    expect(awaitsFirstRun(targetDto({ lastCheckedAt: null }), true)).toBe(true);
  });

  it("is false once a run was attempted, or while nothing can run", () => {
    expect(awaitsFirstRun(targetDto(), true)).toBe(false);
    expect(awaitsFirstRun(targetDto({ lastCheckedAt: null }), false)).toBe(
      false,
    );
    expect(
      awaitsFirstRun(targetDto({ lastCheckedAt: null, enabled: false }), true),
    ).toBe(false);
  });
});
