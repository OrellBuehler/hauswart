import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import {
  canDeleteReading,
  lowerThanReading,
  readingOwner,
  refusedReading,
} from "./odometer-error";

const invalid = (fieldErrors: Record<string, string[]>) =>
  new ApiError("invalid_request", "Invalid request", {
    details: { body: { formErrors: [], fieldErrors } },
  });

describe("lowerThanReading", () => {
  it("reads the value and the date out of the server's refusal", () => {
    const err = invalid({
      value: [
        "Lower than the reading of 45200 on 2026-09-12; send force to take it anyway",
      ],
    });
    expect(lowerThanReading(err)).toEqual({ value: 45200, date: "2026-09-12" });
  });

  it("reads a decimal reading", () => {
    const err = invalid({
      value: ["Lower than the reading of 45200.5 on 2026-09-12; send force"],
    });
    expect(lowerThanReading(err)?.value).toBe(45200.5);
  });

  it("recognises the refusal even when the wording changes after the start", () => {
    expect(
      lowerThanReading(
        invalid({ value: ["Lower than the reading (see list)"] }),
      ),
    ).toEqual({ value: null, date: null });
  });

  it("takes the field the request names: counterValue for a completion", () => {
    const err = invalid({
      counterValue: ["Lower than the reading of 100 on 2026-01-02; send force"],
    });
    expect(lowerThanReading(err, "counterValue")).toEqual({
      value: 100,
      date: "2026-01-02",
    });
    expect(lowerThanReading(err)).toBeNull();
  });

  it.each([
    [
      "another problem with the value",
      invalid({ value: ["Must be a number from 0 to 10000000"] }),
    ],
    [
      "a problem with the date",
      invalid({ date: ["Must not be in the future"] }),
    ],
    [
      "no field errors at all",
      new ApiError("invalid_request", "Invalid request"),
    ],
    [
      "a conflict",
      new ApiError("conflict", "Lower than the reading of 1 on 2026-01-01"),
    ],
    [
      "an unknown error",
      new Error("Lower than the reading of 1 on 2026-01-01"),
    ],
    ["nothing", undefined],
  ])("is null for %s: force would not help", (_name, err) => {
    expect(lowerThanReading(err)).toBeNull();
  });
});

describe("refusedReading", () => {
  it("reads a value lower than the reading before", () => {
    const err = invalid({
      odometer: [
        "Lower than the reading of 45200 on 2026-09-12; send force to take it anyway",
      ],
    });
    expect(refusedReading(err, "odometer")).toEqual({
      direction: "lower",
      value: 45200,
      date: "2026-09-12",
    });
  });

  it("reads a value higher than the reading after", () => {
    const err = invalid({
      odometer: [
        "Higher than the later reading of 46000.5 on 2026-10-01; send force to take it anyway",
      ],
    });
    expect(refusedReading(err, "odometer")).toEqual({
      direction: "higher",
      value: 46000.5,
      date: "2026-10-01",
    });
  });

  it("knows the refusal without its numbers", () => {
    expect(
      refusedReading(
        invalid({ odometer: ["Lower than the reading"] }),
        "odometer",
      ),
    ).toEqual({ direction: "lower", value: null, date: null });
  });

  it("looks at the named field only", () => {
    const err = invalid({
      value: ["Lower than the reading of 1 on 2026-01-01"],
    });
    expect(refusedReading(err, "odometer")).toBeNull();
    expect(refusedReading(err, "value")?.value).toBe(1);
  });

  it("ignores other errors", () => {
    expect(refusedReading(new Error("boom"), "odometer")).toBeNull();
    expect(
      refusedReading(invalid({ odometer: ["Required"] }), "odometer"),
    ).toBeNull();
    expect(
      refusedReading(new ApiError("not_found", "nope"), "odometer"),
    ).toBeNull();
  });
});

describe("readingOwner", () => {
  it("names the record that owns the reading", () => {
    const err = new ApiError(
      "conflict",
      "This reading belongs to a fuel log entry",
      {
        details: { source: "fuel_log", sourceId: "fl_1" },
      },
    );
    expect(readingOwner(err)).toEqual({ source: "fuel_log", sourceId: "fl_1" });
  });

  it("is null for other conflicts and other errors", () => {
    expect(readingOwner(new ApiError("conflict", "taken"))).toBeNull();
    expect(readingOwner(new ApiError("not_found", "nope"))).toBeNull();
    expect(readingOwner(new Error("boom"))).toBeNull();
  });
});

describe("canDeleteReading", () => {
  it("allows the readings a person typed in and nothing else", () => {
    expect(canDeleteReading({ source: "manual" })).toBe(true);
    for (const source of [
      "completion",
      "service_log",
      "fuel_log",
      "tire_change",
      "signal",
    ]) {
      expect(canDeleteReading({ source })).toBe(false);
    }
  });
});
