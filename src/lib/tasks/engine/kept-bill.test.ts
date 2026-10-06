import { describe, expect, it } from "vitest";
import { done, evaluate, skipped, trigger } from "./testing";

const bill = (
  status: "open" | "paid" | "cancelled" | "overdue",
  dueDate = "2026-10-10",
) => trigger.keptBill({ billId: "bill-1", dueDate, status });

describe("kept_bill", () => {
  it.each([
    ["far before", "2026-09-01", "ok"],
    ["a week before", "2026-10-03", "open"],
    ["on the due date", "2026-10-10", "due"],
    ["one day after", "2026-10-11", "overdue"],
  ])("open bill: %s", (_name, today, status) => {
    const result = evaluate(bill("open"), today);
    expect(result.status).toBe(status);
    expect(result.dueDate).toBe("2026-10-10");
    expect(result.dueKind).toBe("deadline");
    expect(result.occurrenceKey).toBe("bill:bill-1");
    expect(result.reasons).toEqual([]);
  });

  it("grace days apply to open bills", () => {
    expect(evaluate(bill("open"), "2026-10-12", { graceDays: 3 }).status).toBe(
      "due",
    );
  });

  it("a paid bill is done", () => {
    const result = evaluate(bill("paid"), "2026-10-10");
    expect(result.status).toBe("ok");
    expect(result.dueDate).toBeNull();
    expect(result.dueKind).toBe("none");
    expect(result.reasons).toEqual(["completed"]);
    expect(result.occurrenceKey).toBe("bill:bill-1");
  });

  it("a paid bill stays ok long after the due date", () => {
    expect(evaluate(bill("paid"), "2027-01-01").status).toBe("ok");
  });

  it("a cancelled bill is done", () => {
    const result = evaluate(bill("cancelled"), "2026-10-20");
    expect(result.status).toBe("ok");
    expect(result.reasons).toEqual(["completed", "bill_cancelled"]);
  });

  it("an overdue bill past its date is overdue even within the grace period", () => {
    const result = evaluate(bill("overdue"), "2026-10-11", { graceDays: 5 });
    expect(result.status).toBe("overdue");
    expect(result.reasons).toEqual(["bill_overdue"]);
  });

  it("an overdue bill is not forced before its date", () => {
    const result = evaluate(bill("overdue"), "2026-10-05");
    expect(result.status).toBe("open");
    expect(result.reasons).toEqual([]);
  });

  it("an overdue bill on its due date is due", () => {
    expect(evaluate(bill("overdue"), "2026-10-10").status).toBe("due");
  });

  it("completing the task acknowledges the bill", () => {
    const result = evaluate(bill("open"), "2026-10-11", {
      completions: [done("2026-10-11", { occurrenceKey: "bill:bill-1" })],
    });
    expect(result.status).toBe("ok");
    expect(result.reasons).toEqual(["completed"]);
    expect(result.dueDate).toBeNull();
  });

  it("skipping acknowledges as well", () => {
    const result = evaluate(bill("open"), "2026-10-11", {
      completions: [skipped("2026-10-11", { occurrenceKey: "bill:bill-1" })],
    });
    expect(result.reasons).toEqual(["skipped"]);
  });

  it("completions for other occurrences do not count", () => {
    const result = evaluate(bill("open"), "2026-10-11", {
      completions: [
        done("2026-10-11", { occurrenceKey: "bill:bill-0" }),
        done("2026-09-01"),
      ],
    });
    expect(result.status).toBe("overdue");
  });

  it("a bill at a month end", () => {
    const result = evaluate(bill("open", "2028-02-29"), "2028-02-28");
    expect(result.status).toBe("open");
  });
});
