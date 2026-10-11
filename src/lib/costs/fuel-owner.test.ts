import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { fuelLogOfConflict } from "./fuel-owner";

describe("fuelLogOfConflict", () => {
  it("names the fuel log entry that owns the cost entry", () => {
    const err = new ApiError("conflict", "Belongs to a fuel log entry", {
      details: { fuelLogId: "f1" },
    });
    expect(fuelLogOfConflict(err)).toBe("f1");
  });

  it.each([
    ["a conflict without details", new ApiError("conflict", "taken")],
    [
      "another kind of error",
      new ApiError("invalid_request", "bad", { details: { fuelLogId: "f1" } }),
    ],
    [
      "a fuel log id that is no text",
      new ApiError("conflict", "x", { details: { fuelLogId: 3 } }),
    ],
    [
      "an empty fuel log id",
      new ApiError("conflict", "x", { details: { fuelLogId: "" } }),
    ],
    ["an error that is not the API's", new Error("boom")],
    ["nothing", undefined],
  ])("is null for %s", (_name, err) => {
    expect(fuelLogOfConflict(err)).toBeNull();
  });
});
