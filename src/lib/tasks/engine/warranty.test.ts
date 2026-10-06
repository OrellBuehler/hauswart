import { describe, expect, it } from "vitest";
import { done, evaluate, trigger } from "./testing";

const w = trigger.warranty;

describe("warranty", () => {
  const t = w({ until: "2026-11-01" });

  it.each([
    ["far away", "2026-06-01", "ok"],
    ["31 days before", "2026-10-01", "ok"],
    ["30 days before: lead window starts", "2026-10-02", "open"],
    ["last day", "2026-11-01", "due"],
    ["day after expiry", "2026-11-02", "overdue"],
  ])("%s", (_name, today, status) => {
    const result = evaluate(t, today);
    expect(result.status).toBe(status);
    expect(result.dueDate).toBe("2026-11-01");
    expect(result.dueKind).toBe("deadline");
    expect(result.occurrenceKey).toBe("w:2026-11-01");
  });

  it.each([
    ["on the last day", "2026-11-01", []],
    ["day after expiry", "2026-11-02", ["warranty_expired"]],
    [
      "30 days after expiry is not archived yet",
      "2026-12-01",
      ["warranty_expired"],
    ],
    [
      "31 days after expiry",
      "2026-12-02",
      ["warranty_expired", "expired_archive"],
    ],
    ["years later", "2030-01-01", ["warranty_expired", "expired_archive"]],
  ])("reasons %s", (_name, today, reasons) => {
    expect(evaluate(t, today).reasons).toEqual(reasons);
  });

  it("extendedUntil wins when later", () => {
    const ext = w({ until: "2026-11-01", extendedUntil: "2027-11-01" });
    const result = evaluate(ext, "2026-11-15");
    expect(result.dueDate).toBe("2027-11-01");
    expect(result.status).toBe("ok");
    expect(result.occurrenceKey).toBe("w:2027-11-01");
    expect(result.reasons).toEqual([]);
  });

  it("extendedUntil is ignored when earlier", () => {
    const ext = w({ until: "2026-11-01", extendedUntil: "2026-06-01" });
    expect(evaluate(ext, "2026-10-20").dueDate).toBe("2026-11-01");
  });

  it("an extension applies the lead window to the new date", () => {
    const ext = w({ until: "2026-11-01", extendedUntil: "2027-11-01" });
    expect(evaluate(ext, "2027-10-01").status).toBe("ok");
    expect(evaluate(ext, "2027-10-02").status).toBe("open");
  });

  it("leadDays overrides the default window", () => {
    const longLead = w({ until: "2026-11-01", leadDays: 90 });
    expect(evaluate(longLead, "2026-08-03").status).toBe("open");
    expect(evaluate(longLead, "2026-08-02").status).toBe("ok");
    const noLead = w({ until: "2026-11-01", leadDays: 0 });
    expect(evaluate(noLead, "2026-10-31").status).toBe("ok");
    expect(evaluate(noLead, "2026-11-01").status).toBe("due");
  });

  it("grace days postpone overdue", () => {
    expect(evaluate(t, "2026-11-03", { graceDays: 2 }).status).toBe("due");
    expect(evaluate(t, "2026-11-04", { graceDays: 2 }).status).toBe("overdue");
  });

  it("a leap day expiry", () => {
    const leap = w({ until: "2028-02-29" });
    expect(evaluate(leap, "2028-02-29").status).toBe("due");
    expect(evaluate(leap, "2028-03-30").reasons).toEqual(["warranty_expired"]);
    expect(evaluate(leap, "2028-03-31").reasons).toEqual([
      "warranty_expired",
      "expired_archive",
    ]);
  });

  it("acknowledging the current deadline ends it", () => {
    const result = evaluate(t, "2026-10-20", {
      completions: [done("2026-10-20", { occurrenceKey: "w:2026-11-01" })],
    });
    expect(result.status).toBe("ok");
    expect(result.reasons).toEqual(["completed"]);
    expect(result.dueDate).toBeNull();
  });

  it("an acknowledgement of an earlier deadline does not carry over after an extension", () => {
    const ext = w({ until: "2026-11-01", extendedUntil: "2027-11-01" });
    const result = evaluate(ext, "2027-10-20", {
      completions: [done("2026-10-20", { occurrenceKey: "w:2026-11-01" })],
    });
    expect(result.status).toBe("open");
  });
});
