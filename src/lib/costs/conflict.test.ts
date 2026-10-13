import { describe, expect, it } from "vitest";
import { COST_CONFLICT_CODES } from "$lib/api/enums";
import { ApiError } from "$lib/api/errors";
import { costConflictCode } from "./conflict";

const conflict = (details?: unknown) =>
  new ApiError("conflict", "x", { status: 409, details });

describe("costConflictCode", () => {
  it.each(COST_CONFLICT_CODES)("reads %s from a 409", (code) => {
    expect(costConflictCode(conflict({ code }))).toBe(code);
  });

  it("reads the code next to other details", () => {
    expect(
      costConflictCode(
        conflict({ code: "receipt_task_closed", status: "dismissed" }),
      ),
    ).toBe("receipt_task_closed");
  });

  it.each<[string, unknown]>([
    ["a 409 without details", undefined],
    ["details without a code", { fuelLogId: "f1" }],
    ["a code nobody knows", { code: "something_else" }],
    ["a code that is not text", { code: 7 }],
    ["details that are not an object", "idempotency_key_reused"],
    ["null details", null],
  ])("has no code for %s", (_name, details) => {
    expect(costConflictCode(conflict(details))).toBeUndefined();
  });

  it("looks only at a 409", () => {
    const details = { code: "suggestion_decided" };
    expect(
      costConflictCode(new ApiError("invalid_request", "x", { details })),
    ).toBeUndefined();
    expect(
      costConflictCode(new ApiError("not_found", "x", { details })),
    ).toBeUndefined();
    expect(costConflictCode(new TypeError("Failed to fetch"))).toBeUndefined();
    expect(costConflictCode(new Error("boom"))).toBeUndefined();
    expect(costConflictCode(undefined)).toBeUndefined();
  });
});
