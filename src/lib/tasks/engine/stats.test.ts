import { describe, expect, it } from "vitest";
import {
  computeStats,
  UNASSIGNED_USER,
  UNCATEGORIZED,
  type StatsCompletion,
} from "./stats";

const c = (over: Partial<StatsCompletion> = {}): StatsCompletion => ({
  userId: "a",
  kind: "done",
  category: "kitchen",
  completedDate: "2026-10-06",
  ...over,
});

describe("computeStats", () => {
  it("is empty for no completions", () => {
    expect(computeStats([])).toEqual({
      total: {
        done: 0,
        skipped: 0,
        onTime: 0,
        measurable: 0,
        onTimeShare: null,
      },
      byUser: {},
      byCategory: {},
    });
  });

  it("counts done per user and excludes skipped from the done count", () => {
    const stats = computeStats([
      c({ userId: "a" }),
      c({ userId: "a" }),
      c({ userId: "b" }),
      c({ userId: "b", kind: "skipped" }),
      c({ userId: "a", kind: "skipped" }),
    ]);
    expect(stats.byUser.a.done).toBe(2);
    expect(stats.byUser.b.done).toBe(1);
    expect(stats.byUser.a.skipped).toBe(1);
    expect(stats.byUser.b.skipped).toBe(1);
    expect(stats.total.done).toBe(3);
    expect(stats.total.skipped).toBe(2);
  });

  it.each([
    ["completed before the due date", "2026-10-05", "2026-10-06", 1],
    ["completed on the due date", "2026-10-06", "2026-10-06", 1],
    ["completed one day late", "2026-10-07", "2026-10-06", 0],
    ["late across a month boundary", "2026-11-01", "2026-10-31", 0],
  ])(
    "on time check: %s",
    (_name, completedDate, dueDateAtCompletion, onTime) => {
      const stats = computeStats([c({ completedDate, dueDateAtCompletion })]);
      expect(stats.total.onTime).toBe(onTime);
      expect(stats.total.onTimeShare).toBe(onTime);
    },
  );

  it("the share only considers completions that know their due date", () => {
    const stats = computeStats([
      c({ completedDate: "2026-10-05", dueDateAtCompletion: "2026-10-06" }),
      c({ completedDate: "2026-10-09", dueDateAtCompletion: "2026-10-06" }),
      c({ completedDate: "2026-10-09", dueDateAtCompletion: null }),
      c({ completedDate: "2026-10-09" }),
    ]);
    expect(stats.total).toEqual({
      done: 4,
      skipped: 0,
      onTime: 1,
      measurable: 2,
      onTimeShare: 0.5,
    });
  });

  it("the share is null without any measurable completion", () => {
    expect(computeStats([c()]).total.onTimeShare).toBeNull();
  });

  it("skipped completions never count as on time", () => {
    const stats = computeStats([
      c({
        kind: "skipped",
        completedDate: "2026-10-01",
        dueDateAtCompletion: "2026-10-06",
      }),
    ]);
    expect(stats.total.onTime).toBe(0);
    expect(stats.total.measurable).toBe(0);
    expect(stats.total.done).toBe(0);
  });

  it("groups by category", () => {
    const stats = computeStats([
      c({ category: "kitchen" }),
      c({
        category: "kitchen",
        completedDate: "2026-10-09",
        dueDateAtCompletion: "2026-10-06",
      }),
      c({
        category: "garden",
        completedDate: "2026-10-01",
        dueDateAtCompletion: "2026-10-06",
      }),
      c({ category: null }),
      c({ category: undefined }),
    ]);
    expect(stats.byCategory.kitchen).toMatchObject({
      done: 2,
      onTime: 0,
      measurable: 1,
      onTimeShare: 0,
    });
    expect(stats.byCategory.garden).toMatchObject({ done: 1, onTimeShare: 1 });
    expect(stats.byCategory[UNCATEGORIZED].done).toBe(2);
  });

  it("collects completions without a user", () => {
    const stats = computeStats([
      c({ userId: null }),
      c({ userId: null }),
      c({ userId: "a" }),
    ]);
    expect(stats.byUser[UNASSIGNED_USER].done).toBe(2);
    expect(stats.byUser.a.done).toBe(1);
  });

  it("per user on-time share", () => {
    const stats = computeStats([
      c({
        userId: "a",
        completedDate: "2026-10-05",
        dueDateAtCompletion: "2026-10-06",
      }),
      c({
        userId: "a",
        completedDate: "2026-10-05",
        dueDateAtCompletion: "2026-10-06",
      }),
      c({
        userId: "a",
        completedDate: "2026-10-09",
        dueDateAtCompletion: "2026-10-06",
      }),
      c({
        userId: "b",
        completedDate: "2026-10-09",
        dueDateAtCompletion: "2026-10-06",
      }),
    ]);
    expect(stats.byUser.a.onTimeShare).toBeCloseTo(2 / 3);
    expect(stats.byUser.b.onTimeShare).toBe(0);
  });

  it("is safe with prototype-like keys", () => {
    const stats = computeStats([
      c({ userId: "__proto__", category: "constructor" }),
    ]);
    expect(Object.keys(stats.byUser)).toEqual(["__proto__"]);
    expect(Object.keys(stats.byCategory)).toEqual(["constructor"]);
  });
});
