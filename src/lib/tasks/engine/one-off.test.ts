import { describe, expect, it } from "vitest";
import { done, evaluate, skipped, trigger } from "./testing";

const t = trigger.oneOff({ date: "2026-10-10" });

describe("one_off", () => {
  it.each([
    ["far in the future", "2026-09-01", "ok"],
    ["eight days before", "2026-10-02", "ok"],
    ["seven days before", "2026-10-03", "open"],
    ["the day before", "2026-10-09", "open"],
    ["on the day", "2026-10-10", "due"],
    ["one day late", "2026-10-11", "overdue"],
    ["long overdue", "2027-03-01", "overdue"],
  ])("%s", (_name, today, status) => {
    const result = evaluate(t, today);
    expect(result.status).toBe(status);
    expect(result.dueDate).toBe("2026-10-10");
    expect(result.dueKind).toBe("exact");
    expect(result.occurrenceKey).toBe("2026-10-10");
    expect(result.reasons).toEqual([]);
  });

  it("grace days postpone overdue", () => {
    expect(evaluate(t, "2026-10-12", { graceDays: 2 }).status).toBe("due");
    expect(evaluate(t, "2026-10-13", { graceDays: 2 }).status).toBe("overdue");
  });

  it.each([
    ["done before the date", "2026-10-02"],
    ["done on the date", "2026-10-10"],
    ["done late", "2026-10-20"],
  ])("a completion %s ends it", (_name, completedOn) => {
    const result = evaluate(t, "2026-10-21", {
      completions: [done(completedOn)],
    });
    expect(result.status).toBe("ok");
    expect(result.dueKind).toBe("none");
    expect(result.dueDate).toBeNull();
    expect(result.reasons).toEqual(["completed"]);
    expect(result.occurrenceKey).toBe("2026-10-10");
  });

  it("a skipped one-off is resolved too", () => {
    const result = evaluate(t, "2026-10-21", {
      completions: [skipped("2026-10-11")],
    });
    expect(result.status).toBe("ok");
    expect(result.reasons).toEqual(["skipped"]);
  });

  it("done wins over skipped", () => {
    const result = evaluate(t, "2026-10-21", {
      completions: [skipped("2026-10-11"), done("2026-10-12")],
    });
    expect(result.reasons).toEqual(["completed"]);
  });
});
