import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { lowerThanReading } from "./odometer-error";

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
