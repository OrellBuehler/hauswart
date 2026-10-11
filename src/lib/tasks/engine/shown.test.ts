import { describe, expect, it } from "vitest";
import { shownDate, shownDateIsEstimate } from "./shown";
import type { DueKind, Estimate } from "./types";

type Case = [
  string,
  { dueDate: string | null; dueKind: DueKind; estimate?: Estimate | null },
  string | null,
  boolean,
];

const guess: Estimate = { date: "2026-11-03", confidence: "medium" };

describe("the date a task is shown with", () => {
  it.each<Case>([
    [
      "an exact date",
      { dueDate: "2026-12-01", dueKind: "exact" },
      "2026-12-01",
      false,
    ],
    [
      "a condition that holds",
      { dueDate: "2026-10-01", dueKind: "condition" },
      "2026-10-01",
      false,
    ],
    ["nothing", { dueDate: null, dueKind: "none" }, null, false],
    [
      "nothing, with a null estimate",
      { dueDate: null, dueKind: "none", estimate: null },
      null,
      false,
    ],
    [
      "an estimate alone",
      { dueDate: null, dueKind: "estimated", estimate: guess },
      "2026-11-03",
      true,
    ],
    [
      "an estimate that comes before the hard limit is the one shown",
      { dueDate: "2027-01-15", dueKind: "estimated", estimate: guess },
      "2026-11-03",
      true,
    ],
    [
      "an exact date that carries an estimate keeps the exact date",
      { dueDate: "2026-12-01", dueKind: "exact", estimate: guess },
      "2026-12-01",
      false,
    ],
    [
      "an estimate without a due date is a guess whatever the kind says",
      { dueDate: null, dueKind: "none", estimate: guess },
      "2026-11-03",
      true,
    ],
  ])("%s", (_name, due, date, estimated) => {
    expect(shownDate(due)).toBe(date);
    expect(shownDateIsEstimate(due)).toBe(estimated);
  });
});
