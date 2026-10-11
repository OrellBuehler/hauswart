import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages";
import { countsDto } from "$lib/testing/calendar-targets";
import { statLines, statsSummary } from "./stats";

describe("statLines", () => {
  it("has a phrase for every count that is not zero, in the order that matters", () => {
    const lines = statLines(
      countsDto({
        remaining: 7,
        failed: 2,
        created: 3,
        deleted: 1,
        skipped: 4,
        updated: 5,
        replaced: 6,
        adopted: 8,
        forgotten: 9,
        unconfirmed: 10,
      }),
    );
    expect(lines).toEqual([
      m.caltargets_stats_created({ count: 3 }),
      m.caltargets_stats_updated({ count: 5 }),
      m.caltargets_stats_replaced({ count: 6 }),
      m.caltargets_stats_deleted({ count: 1 }),
      m.caltargets_stats_adopted({ count: 8 }),
      m.caltargets_stats_forgotten({ count: 9 }),
      m.caltargets_stats_skipped({ count: 4 }),
      m.caltargets_stats_unconfirmed({ count: 10 }),
      m.caltargets_stats_failed({ count: 2 }),
      m.caltargets_stats_remaining({ count: 7 }),
    ]);
  });

  it("is empty when the run did nothing", () => {
    expect(statLines(countsDto())).toEqual([]);
  });
});

describe("statsSummary", () => {
  it("joins the phrases", () => {
    expect(statsSummary(countsDto({ created: 3, updated: 1 }))).toBe(
      `${m.caltargets_stats_created({ count: 3 })}, ${m.caltargets_stats_updated({ count: 1 })}`,
    );
  });

  it("says that nothing had to be done", () => {
    expect(statsSummary(countsDto())).toBe(m.caltargets_stats_nothing());
  });
});
