import { describe, expect, it } from "vitest";
import { buildUpcoming, type UpcomingInput } from "./upcoming";
import type { DueResult } from "./types";

const TODAY = "2026-10-06";

function item(
  taskId: string,
  due: Partial<DueResult>,
  extra: Partial<UpcomingInput> = {},
): UpcomingInput {
  return {
    taskId,
    title: `title ${taskId}`,
    due: {
      status: "ok",
      dueDate: null,
      dueKind: "exact",
      occurrenceKey: taskId,
      reasons: [],
      ...due,
    },
    ...extra,
  };
}

const ids = (items: { taskId: string }[]) => items.map((i) => i.taskId);

describe("buildUpcoming, buckets by date", () => {
  it.each([
    ["long overdue", "2026-09-01", "overdue"],
    ["yesterday", "2026-10-05", "overdue"],
    ["today", "2026-10-06", "today"],
    ["tomorrow", "2026-10-07", "thisWeek"],
    ["Sunday ends this week", "2026-10-11", "thisWeek"],
    ["Monday is later", "2026-10-12", "later"],
    ["last day of the horizon", "2026-11-05", "later"],
  ] as const)("%s", (_name, dueDate, bucket) => {
    const result = buildUpcoming([item("x", { dueDate })], TODAY, 30);
    for (const name of ["overdue", "today", "thisWeek", "later"] as const) {
      expect(ids(result[name])).toEqual(name === bucket ? ["x"] : []);
    }
    expect(result.signalBased).toEqual([]);
  });

  it("drops items beyond the horizon", () => {
    const result = buildUpcoming(
      [item("x", { dueDate: "2026-11-06" })],
      TODAY,
      30,
    );
    expect(result).toEqual({
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      signalBased: [],
      preparations: [],
    });
  });

  it("the horizon also cuts the current week", () => {
    const items = [
      item("a", { dueDate: "2026-10-08" }),
      item("b", { dueDate: "2026-10-09" }),
    ];
    const result = buildUpcoming(items, TODAY, 2);
    expect(ids(result.thisWeek)).toEqual(["a"]);
  });

  it("horizon 0 keeps only overdue and today", () => {
    const items = [
      item("o", { dueDate: "2026-10-01" }),
      item("t", { dueDate: TODAY }),
      item("n", { dueDate: "2026-10-07" }),
    ];
    const result = buildUpcoming(items, TODAY, 0);
    expect(ids(result.overdue)).toEqual(["o"]);
    expect(ids(result.today)).toEqual(["t"]);
    expect(result.thisWeek).toEqual([]);
  });

  it("on a Sunday this week is empty", () => {
    const result = buildUpcoming(
      [item("a", { dueDate: "2026-10-12" })],
      "2026-10-11",
      30,
    );
    expect(result.thisWeek).toEqual([]);
    expect(ids(result.later)).toEqual(["a"]);
  });

  it("the week follows ISO weeks across the year boundary", () => {
    const result = buildUpcoming(
      [
        item("a", { dueDate: "2027-01-03" }),
        item("b", { dueDate: "2027-01-04" }),
      ],
      "2026-12-30",
      30,
    );
    expect(ids(result.thisWeek)).toEqual(["a"]);
    expect(ids(result.later)).toEqual(["b"]);
  });

  it("condition based tasks that became due earlier are overdue", () => {
    const result = buildUpcoming(
      [
        item("c", {
          status: "overdue",
          dueKind: "condition",
          dueDate: "2026-10-01",
        }),
      ],
      TODAY,
      30,
    );
    expect(ids(result.overdue)).toEqual(["c"]);
  });

  it("keeps the item and its due result", () => {
    const due = { status: "due" as const, dueDate: TODAY };
    const [entry] = buildUpcoming([item("x", due)], TODAY, 7).today;
    expect(entry).toMatchObject({
      taskId: "x",
      title: "title x",
      date: TODAY,
      estimated: false,
    });
    expect(entry.due.status).toBe("due");
  });
});

describe("buildUpcoming, ordering", () => {
  it("sorts each bucket by date", () => {
    const items = [
      item("c", { dueDate: "2026-10-30" }),
      item("a", { dueDate: "2026-10-14" }),
      item("b", { dueDate: "2026-10-20" }),
    ];
    expect(ids(buildUpcoming(items, TODAY, 60).later)).toEqual(["a", "b", "c"]);
  });

  it("overdue items come oldest first", () => {
    const items = [
      item("b", { dueDate: "2026-10-04" }),
      item("a", { dueDate: "2026-09-20" }),
      item("c", { dueDate: "2026-10-05" }),
    ];
    expect(ids(buildUpcoming(items, TODAY, 7).overdue)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("estimated items follow exact ones on the same day", () => {
    const items = [
      item("est", {
        dueKind: "estimated",
        estimate: { date: "2026-10-08", confidence: "medium" },
      }),
      item("exact-z", { dueDate: "2026-10-08" }),
      item("exact-a", { dueDate: "2026-10-08" }),
      item("earlier-est", {
        dueKind: "estimated",
        estimate: { date: "2026-10-07", confidence: "low" },
      }),
    ];
    const result = buildUpcoming(items, TODAY, 30);
    expect(ids(result.thisWeek)).toEqual([
      "earlier-est",
      "exact-a",
      "exact-z",
      "est",
    ]);
    expect(result.thisWeek.find((i) => i.taskId === "est")?.estimated).toBe(
      true,
    );
  });

  it("ties are broken by title, then id", () => {
    const items: UpcomingInput[] = [
      { ...item("2", { dueDate: "2026-10-08" }), title: "same" },
      { ...item("1", { dueDate: "2026-10-08" }), title: "same" },
      { ...item("3", { dueDate: "2026-10-08" }), title: "alpha" },
    ];
    expect(ids(buildUpcoming(items, TODAY, 30).thisWeek)).toEqual([
      "3",
      "1",
      "2",
    ]);
  });
});

describe("buildUpcoming, estimates, signals and snooze", () => {
  it("an estimate in the past is today, never overdue", () => {
    const result = buildUpcoming(
      [
        item("e", {
          dueKind: "estimated",
          estimate: { date: "2026-10-01", confidence: "low" },
        }),
      ],
      TODAY,
      30,
    );
    expect(ids(result.today)).toEqual(["e"]);
    expect(result.overdue).toEqual([]);
  });

  it("estimates beyond the horizon are dropped", () => {
    const result = buildUpcoming(
      [
        item("e", {
          dueKind: "estimated",
          estimate: { date: "2027-01-01", confidence: "low" },
        }),
      ],
      TODAY,
      30,
    );
    expect(ids(result.later)).toEqual([]);
  });

  it("progress without a date is signal based", () => {
    const result = buildUpcoming(
      [item("p", { dueKind: "none", progress: { current: 3, target: 5 } })],
      TODAY,
      30,
    );
    expect(ids(result.signalBased)).toEqual(["p"]);
  });

  it("unknown status is signal based", () => {
    const result = buildUpcoming(
      [item("u", { status: "unknown", dueKind: "none" })],
      TODAY,
      30,
    );
    expect(ids(result.signalBased)).toEqual(["u"]);
  });

  it("an ok task without a date or progress is not listed", () => {
    const result = buildUpcoming(
      [item("done", { dueKind: "none" })],
      TODAY,
      30,
    );
    expect(result.signalBased).toEqual([]);
    expect(ids(result.later)).toEqual([]);
  });

  it("snoozed tasks are hidden", () => {
    const result = buildUpcoming(
      [item("s", { status: "snoozed", dueDate: TODAY })],
      TODAY,
      30,
    );
    expect(result.today).toEqual([]);
  });

  it("signal based items are sorted by title", () => {
    const items: UpcomingInput[] = [
      {
        ...item("1", { dueKind: "none", progress: { current: 1, target: 2 } }),
        title: "zeta",
      },
      {
        ...item("2", { dueKind: "none", progress: { current: 1, target: 2 } }),
        title: "alpha",
      },
    ];
    expect(ids(buildUpcoming(items, TODAY, 30).signalBased)).toEqual([
      "2",
      "1",
    ]);
  });
});

describe("buildUpcoming, preparations", () => {
  it("lists only preparations that are due now", () => {
    const result = buildUpcoming(
      [
        item(
          "x",
          { dueDate: "2026-10-20" },
          {
            preps: [
              { id: "p1", label: "order", state: "now" },
              { id: "p2", state: "not_yet" },
              { id: "p3", state: "done" },
              { id: "p4", state: "in_stock_skip" },
            ],
          },
        ),
      ],
      TODAY,
      30,
    );
    expect(result.preparations).toEqual([
      {
        taskId: "x",
        title: "title x",
        prepId: "p1",
        label: "order",
        state: "now",
        date: "2026-10-20",
      },
    ]);
  });

  it("omits the label when there is none", () => {
    const result = buildUpcoming(
      [
        item(
          "x",
          { dueDate: "2026-10-20" },
          { preps: [{ id: "p1", state: "now" }] },
        ),
      ],
      TODAY,
      30,
    );
    expect(result.preparations[0]).not.toHaveProperty("label");
  });

  it("sorts by the task date and puts undated last", () => {
    const prep = [{ id: "p", state: "now" as const }];
    const result = buildUpcoming(
      [
        item(
          "none",
          { dueKind: "none", progress: { current: 1, target: 2 } },
          { preps: prep },
        ),
        item("late", { dueDate: "2026-10-30" }, { preps: prep }),
        item("soon", { dueDate: "2026-10-08" }, { preps: prep }),
      ],
      TODAY,
      30,
    );
    expect(result.preparations.map((p) => p.taskId)).toEqual([
      "soon",
      "late",
      "none",
    ]);
  });

  it("a preparation shows even when the task is beyond the horizon or snoozed", () => {
    const prep = [{ id: "p", state: "now" as const }];
    const result = buildUpcoming(
      [
        item("far", { dueDate: "2027-06-01" }, { preps: prep }),
        item(
          "snoozed",
          { status: "snoozed", dueDate: "2026-10-09" },
          { preps: prep },
        ),
      ],
      TODAY,
      30,
    );
    expect(result.preparations.map((p) => p.taskId)).toEqual([
      "snoozed",
      "far",
    ]);
    expect(result.later).toEqual([]);
  });
});

describe("buildUpcoming, empty input", () => {
  it("returns empty buckets", () => {
    expect(buildUpcoming([], TODAY, 30)).toEqual({
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      signalBased: [],
      preparations: [],
    });
  });
});
