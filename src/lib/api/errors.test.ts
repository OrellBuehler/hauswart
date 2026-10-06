import { describe, expect, it } from "vitest";
import { ApiError, ERROR_CODES, ERROR_STATUS, isApiError } from "./errors";

describe("ApiError", () => {
  it("has a status for every code", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code], code).toBeGreaterThanOrEqual(400);
    }
  });

  it("defaults the status from the code and allows overriding it", () => {
    expect(new ApiError("not_found", "x").status).toBe(404);
    expect(new ApiError("invalid_request", "x", { status: 413 }).status).toBe(
      413,
    );
  });

  it("serialises to the envelope, omitting absent details", () => {
    expect(new ApiError("conflict", "taken").toBody()).toEqual({
      error: { code: "conflict", message: "taken" },
    });
    expect(
      new ApiError("invalid_request", "bad", { details: { a: 1 } }).toBody(),
    ).toEqual({
      error: { code: "invalid_request", message: "bad", details: { a: 1 } },
    });
  });

  it("is recognised by isApiError", () => {
    expect(isApiError(new ApiError("internal", "x"))).toBe(true);
    expect(isApiError(new Error("x"))).toBe(false);
  });
});
