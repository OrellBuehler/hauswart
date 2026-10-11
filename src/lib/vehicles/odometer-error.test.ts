import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { readingOwner, refusedMessage, refusedReading } from "./odometer-error";

const refusal = (
  code: string,
  field: string,
  reading: { value: number; date: string } = {
    value: 45200,
    date: "2026-09-12",
  },
) =>
  new ApiError("invalid_request", "Invalid request", {
    details: {
      body: {
        formErrors: [],
        fieldErrors: { [field]: ["English text that is no contract"] },
      },
      code,
      field,
      reading,
    },
  });

describe("refusedReading", () => {
  it("reads a value lower than the reading before", () => {
    expect(
      refusedReading(refusal("lower_than_previous", "odometer"), "odometer"),
    ).toEqual({
      code: "lower_than_previous",
      field: "odometer",
      reading: { value: 45200, date: "2026-09-12" },
    });
  });

  it("reads a value higher than the reading after", () => {
    expect(
      refusedReading(
        refusal("higher_than_next", "value", {
          value: 46000.5,
          date: "2026-10-01",
        }),
        "value",
      ),
    ).toEqual({
      code: "higher_than_next",
      field: "value",
      reading: { value: 46000.5, date: "2026-10-01" },
    });
  });

  it("takes the field the server names when none is asked for", () => {
    expect(
      refusedReading(refusal("lower_than_previous", "counterValue"))?.field,
    ).toBe("counterValue");
  });

  it("looks at the asked field only: a refusal on another field is not this form's", () => {
    const err = refusal("lower_than_previous", "value");
    expect(refusedReading(err, "odometer")).toBeNull();
    expect(refusedReading(err, "value")).not.toBeNull();
  });

  it("does not read the English message: only the structured reason counts", () => {
    const err = new ApiError("invalid_request", "Invalid request", {
      details: {
        body: {
          formErrors: [],
          fieldErrors: {
            value: [
              "Lower than the reading of 45200 on 2026-09-12; send force to take it anyway",
            ],
          },
        },
      },
    });
    expect(refusedReading(err, "value")).toBeNull();
  });

  it.each([
    [
      "another problem with the value, which force would not help",
      new ApiError("invalid_request", "Invalid request", {
        details: {
          body: {
            formErrors: [],
            fieldErrors: { value: ["Must be a number from 0 to 10000000"] },
          },
        },
      }),
    ],
    ["a code nobody knows", refusal("something_else", "value")],
    [
      "a refusal without the reading in the way",
      new ApiError("invalid_request", "Invalid request", {
        details: { code: "lower_than_previous", field: "value" },
      }),
    ],
    [
      "a reading with a date that is none",
      refusal("lower_than_previous", "value", { value: 1, date: "tomorrow" }),
    ],
    [
      "a conflict",
      new ApiError("conflict", "taken", {
        details: {
          code: "lower_than_previous",
          field: "value",
          reading: { value: 1, date: "2026-01-01" },
        },
      }),
    ],
    ["an error without details", new ApiError("invalid_request", "Invalid")],
    ["an unknown error", new Error("boom")],
    ["nothing", undefined],
  ])("is null for %s", (_name, err) => {
    expect(refusedReading(err, "value")).toBeNull();
  });
});

describe("refusedMessage", () => {
  const lower = refusal("lower_than_previous", "odometer");
  const higher = refusal("higher_than_next", "odometer", {
    value: 46000,
    date: "2026-10-01",
  });
  const read = (err: ApiError) => refusedReading(err, "odometer")!;

  it("names the reading in the way, in the unit of the vehicle", () => {
    const text = refusedMessage(read(lower), "km");
    expect(text).toMatch(/45.200 km/);
    expect(text).toContain("12.09.2026");
    expect(refusedMessage(read(lower), "mi")).toMatch(/45.200 mi/);
  });

  it("says lower for the reading before and higher for the one after", () => {
    expect(refusedMessage(read(lower), "km")).toContain("tiefer");
    const text = refusedMessage(read(higher), "km");
    expect(text).toContain("höher");
    expect(text).toMatch(/46.000 km/);
    expect(text).toContain("01.10.2026");
  });

  it("offers saving anyway only where the form can send force", () => {
    expect(refusedMessage(read(lower), "km")).not.toMatch(/trotzdem/i);
    expect(refusedMessage(read(lower), "km", { canForce: true })).toMatch(
      /trotzdem/i,
    );
    expect(refusedMessage(read(higher), "km", { canForce: true })).toMatch(
      /trotzdem/i,
    );
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
