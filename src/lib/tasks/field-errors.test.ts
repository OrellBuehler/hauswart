import { describe, expect, it } from "vitest";
import { createTaskRequestSchema } from "$lib/api/schemas/tasks";
import { errorsUnder, issuesToErrors } from "./field-errors";

function errorsFor(body: unknown) {
  const result = createTaskRequestSchema.safeParse(body);
  if (result.success) return {};
  return issuesToErrors(result.error.issues, body);
}

describe("field errors", () => {
  it("maps trigger issues to localized messages under their path", () => {
    const errors = errorsFor({
      title: "",
      trigger: {
        v: 1,
        type: "interval",
        every: undefined,
        unit: "month",
        anchor: "completion",
        startDate: "",
      },
    });
    expect(errors.title).toBe("Pflichtfeld.");
    const trigger = errorsUnder(errors, "trigger");
    expect(trigger.every).toBe("Pflichtfeld.");
    expect(trigger.startDate).toBe("Pflichtfeld.");
  });

  it("reports out-of-range numbers with the bound", () => {
    const errors = errorsFor({
      title: "x",
      trigger: { v: 1, type: "min_per_period", period: "month", count: 0 },
    });
    expect(errorsUnder(errors, "trigger").count).toBe("Mindestens 1.");
  });
});
