import { describe, expect, it } from "vitest";
import {
  orderNowItems,
  prepState,
  type OrderTask,
  type PrepConfig,
} from "./preparations";
import type { DueResult, Signals } from "./types";

const TODAY = "2026-10-06";

function due(partial: Partial<DueResult> = {}): DueResult {
  return {
    status: "ok",
    dueDate: "2026-10-20",
    dueKind: "exact",
    occurrenceKey: "2026-10-20",
    reasons: [],
    ...partial,
  };
}

function state(
  dueResult: DueResult,
  prep: PrepConfig,
  opts: { today?: string; prepCompletions?: string[]; signals?: Signals } = {},
) {
  return prepState({
    due: dueResult,
    prep,
    prepCompletions: opts.prepCompletions ?? [],
    signals: opts.signals ?? {},
    today: opts.today ?? TODAY,
  });
}

describe("prepState, lead days", () => {
  it.each([
    ["well before the lead window", "2026-10-05", 14, "not_yet"],
    ["one day before the lead window", "2026-10-05", 14, "not_yet"],
    ["first day of the lead window", "2026-10-06", 14, "now"],
    ["inside the lead window", "2026-10-15", 14, "now"],
    ["on the due date", "2026-10-20", 14, "now"],
    ["after the due date", "2026-10-25", 14, "now"],
    ["lead 0 the day before", "2026-10-19", 0, "not_yet"],
    ["lead 0 on the day", "2026-10-20", 0, "now"],
    ["lead 1 the day before", "2026-10-19", 1, "now"],
  ])("%s", (_name, today, leadDays, expected) => {
    expect(state(due(), { kind: "generic", leadDays }, { today })).toBe(
      expected,
    );
  });

  it("without any lead the due date itself is the trigger", () => {
    expect(state(due(), { kind: "generic" }, { today: "2026-10-19" })).toBe(
      "not_yet",
    );
    expect(state(due(), { kind: "generic" }, { today: "2026-10-20" })).toBe(
      "now",
    );
  });

  it("uses the estimate when there is no due date", () => {
    const estimated = due({
      dueDate: null,
      dueKind: "estimated",
      estimate: { date: "2026-10-20", confidence: "low" },
    });
    expect(
      state(
        estimated,
        { kind: "generic", leadDays: 7 },
        { today: "2026-10-12" },
      ),
    ).toBe("not_yet");
    expect(
      state(
        estimated,
        { kind: "generic", leadDays: 7 },
        { today: "2026-10-13" },
      ),
    ).toBe("now");
  });

  it("an estimate that comes before the hard limit is what the lead time counts from", () => {
    const early = due({
      dueDate: "2027-03-01",
      dueKind: "estimated",
      estimate: { date: "2026-10-20", confidence: "medium" },
    });
    expect(
      state(early, { kind: "generic", leadDays: 7 }, { today: "2026-10-12" }),
    ).toBe("not_yet");
    expect(
      state(early, { kind: "generic", leadDays: 7 }, { today: "2026-10-13" }),
    ).toBe("now");
  });

  it("a due date wins over an estimate", () => {
    const both = due({
      dueDate: "2026-10-20",
      estimate: { date: "2026-10-01", confidence: "low" },
    });
    expect(
      state(both, { kind: "generic", leadDays: 0 }, { today: "2026-10-10" }),
    ).toBe("not_yet");
  });

  it("not_yet when there is no date at all", () => {
    const none = due({ dueDate: null, dueKind: "none" });
    expect(state(none, { kind: "generic", leadDays: 100 })).toBe("not_yet");
  });

  it("an active condition task prepares right away", () => {
    const active = due({ status: "due", dueKind: "condition", dueDate: TODAY });
    expect(state(active, { kind: "generic", leadDays: 0 })).toBe("now");
  });

  it("works across month and leap day boundaries", () => {
    const d = due({ dueDate: "2028-03-01" });
    expect(
      state(d, { kind: "generic", leadDays: 1 }, { today: "2028-02-28" }),
    ).toBe("not_yet");
    expect(
      state(d, { kind: "generic", leadDays: 1 }, { today: "2028-02-29" }),
    ).toBe("now");
  });
});

describe("prepState, done and stock", () => {
  it("done when the occurrence key is recorded", () => {
    expect(
      state(
        due(),
        { kind: "generic", leadDays: 14 },
        { prepCompletions: ["2026-10-20"] },
      ),
    ).toBe("done");
  });

  it("a different occurrence's completion does not count", () => {
    expect(
      state(
        due(),
        { kind: "generic", leadDays: 14 },
        { prepCompletions: ["2026-09-20"] },
      ),
    ).toBe("now");
  });

  it("done even if the date has not come", () => {
    expect(
      state(
        due(),
        { kind: "generic", leadDays: 1 },
        { prepCompletions: ["2026-10-20"], today: "2026-09-01" },
      ),
    ).toBe("done");
  });

  it("done wins over in stock", () => {
    expect(
      state(
        due(),
        { kind: "order_part", partStock: 5, qty: 1 },
        { prepCompletions: ["2026-10-20"] },
      ),
    ).toBe("done");
  });

  it.each([
    ["stock covers the quantity", 2, 2, "in_stock_skip"],
    ["stock equals the quantity", 2, 2, "in_stock_skip"],
    ["stock one short", 1, 2, "now"],
    ["no stock", 0, 1, "now"],
    ["default quantity of 1 with stock 1", 1, undefined, "in_stock_skip"],
    ["default quantity of 1 with stock 0", 0, undefined, "now"],
  ])("order_part: %s", (_name, partStock, qty, expected) => {
    expect(
      state(due(), {
        kind: "order_part",
        leadDays: 30,
        partStock,
        ...(qty !== undefined ? { qty } : {}),
      }),
    ).toBe(expected);
  });

  it("in stock skips even before the lead window", () => {
    expect(
      state(
        due(),
        { kind: "order_part", leadDays: 1, partStock: 3 },
        { today: "2026-09-01" },
      ),
    ).toBe("in_stock_skip");
  });

  it("an unknown stock does not skip", () => {
    expect(state(due(), { kind: "order_part", leadDays: 30 })).toBe("now");
  });

  it("generic preps ignore stock", () => {
    expect(state(due(), { kind: "generic", leadDays: 30, partStock: 10 })).toBe(
      "now",
    );
  });
});

describe("prepState, lead value", () => {
  const signals: Signals = {
    "sensor.stock": { numeric: 10, changedAt: 0, seenAt: 0 },
    "sensor.mode": { text: "winter", changedAt: 0, seenAt: 0 },
    "sensor.gone": { text: "unavailable", changedAt: 0, seenAt: 0 },
  };
  const lead = (
    entityId: string,
    op: "lt" | "gt" | "eq",
    value: number | string,
  ) => ({
    entityId,
    op,
    value,
  });

  it("starts the preparation when the signal condition holds", () => {
    expect(
      state(
        due(),
        { kind: "generic", leadValue: lead("sensor.stock", "lt", 20) },
        { signals },
      ),
    ).toBe("now");
  });

  it("stays not_yet when it does not hold and there is no lead time", () => {
    expect(
      state(
        due(),
        { kind: "generic", leadValue: lead("sensor.stock", "gt", 20) },
        { signals },
      ),
    ).toBe("not_yet");
  });

  it("text signals", () => {
    expect(
      state(
        due(),
        { kind: "generic", leadValue: lead("sensor.mode", "eq", "winter") },
        { signals },
      ),
    ).toBe("now");
  });

  it("either lead days or the value can start it", () => {
    const prep: PrepConfig = {
      kind: "generic",
      leadDays: 14,
      leadValue: lead("sensor.stock", "gt", 20),
    };
    expect(state(due(), prep, { signals, today: "2026-10-06" })).toBe("now");
    expect(state(due(), prep, { signals, today: "2026-10-05" })).toBe(
      "not_yet",
    );
  });

  it("a missing or unavailable signal does not start it", () => {
    expect(
      state(
        due(),
        { kind: "generic", leadValue: lead("sensor.nope", "lt", 20) },
        { signals },
      ),
    ).toBe("not_yet");
    expect(
      state(
        due(),
        {
          kind: "generic",
          leadValue: lead("sensor.gone", "eq", "unavailable"),
        },
        { signals },
      ),
    ).toBe("not_yet");
  });

  it("the value trigger works without any date", () => {
    const none = due({ dueDate: null, dueKind: "none" });
    expect(
      state(
        none,
        { kind: "generic", leadValue: lead("sensor.stock", "lt", 20) },
        { signals },
      ),
    ).toBe("now");
  });
});

describe("orderNowItems", () => {
  const task = (over: Partial<OrderTask> = {}): OrderTask => ({
    taskId: "t1",
    due: due({ dueDate: "2026-10-20" }),
    parts: [{ id: "p1", stock: 0, minStock: 0, leadTimeDays: 7 }],
    ...over,
  });

  it.each([
    ["before the order date", "2026-10-12", 0],
    ["on the order date", "2026-10-13", 1],
    ["after the order date", "2026-10-14", 1],
  ])("%s", (_name, today, count) => {
    expect(orderNowItems([task()], today)).toHaveLength(count);
  });

  it("describes the item", () => {
    expect(orderNowItems([task()], "2026-10-13")).toEqual([
      {
        taskId: "t1",
        partId: "p1",
        quantity: 1,
        neededBy: "2026-10-20",
        orderBy: "2026-10-13",
        late: false,
      },
    ]);
    expect(orderNowItems([task()], "2026-10-14")[0].late).toBe(true);
  });

  it.each([
    ["enough stock", { stock: 1, minStock: 0 }, undefined, 0],
    [
      "stock leaves nothing for the minimum",
      { stock: 1, minStock: 1 },
      undefined,
      1,
    ],
    ["empty stock with a minimum", { stock: 0, minStock: 2 }, undefined, 3],
    ["larger quantity per task", { stock: 1, minStock: 0 }, 3, 2],
    ["plenty of stock", { stock: 10, minStock: 2 }, 3, 0],
    ["exactly the quantity plus minimum", { stock: 4, minStock: 1 }, 3, 0],
  ])("quantity: %s", (_name, part, qty, expected) => {
    const items = orderNowItems(
      [
        task({
          parts: [
            { id: "p1", leadTimeDays: 7, ...part, ...(qty ? { qty } : {}) },
          ],
        }),
      ],
      "2026-10-19",
    );
    expect(items[0]?.quantity ?? 0).toBe(expected);
  });

  it("uses the estimate date when there is no due date", () => {
    const items = orderNowItems(
      [
        task({
          due: due({
            dueDate: null,
            dueKind: "estimated",
            estimate: { date: "2026-10-20", confidence: "low" },
          }),
        }),
      ],
      "2026-10-13",
    );
    expect(items).toHaveLength(1);
    expect(items[0].neededBy).toBe("2026-10-20");
  });

  it("orders for the estimate that comes before the hard limit", () => {
    const items = orderNowItems(
      [
        task({
          due: due({
            dueDate: "2027-03-01",
            dueKind: "estimated",
            estimate: { date: "2026-10-20", confidence: "medium" },
          }),
        }),
      ],
      "2026-10-13",
    );
    expect(items).toHaveLength(1);
    expect(items[0].neededBy).toBe("2026-10-20");
  });

  it("skips tasks without a date", () => {
    expect(
      orderNowItems(
        [task({ due: due({ dueDate: null, dueKind: "none" }) })],
        "2027-01-01",
      ),
    ).toEqual([]);
  });

  it("lead time 0 means order on the due date", () => {
    const t = task({
      parts: [{ id: "p1", stock: 0, minStock: 0, leadTimeDays: 0 }],
    });
    expect(orderNowItems([t], "2026-10-19")).toHaveLength(0);
    expect(orderNowItems([t], "2026-10-20")).toHaveLength(1);
  });

  it("crosses month boundaries", () => {
    const t = task({
      due: due({ dueDate: "2026-11-02" }),
      parts: [{ id: "p1", stock: 0, minStock: 0, leadTimeDays: 5 }],
    });
    expect(orderNowItems([t], "2026-10-28")[0].orderBy).toBe("2026-10-28");
    expect(orderNowItems([t], "2026-10-27")).toHaveLength(0);
  });

  it("sorts by order date, then task, then part", () => {
    const items = orderNowItems(
      [
        task({
          taskId: "b",
          parts: [
            { id: "p2", stock: 0, minStock: 0, leadTimeDays: 7 },
            { id: "p1", stock: 0, minStock: 0, leadTimeDays: 7 },
          ],
        }),
        task({ taskId: "a", due: due({ dueDate: "2026-10-18" }) }),
        task({ taskId: "c", due: due({ dueDate: "2026-10-30" }) }),
      ],
      "2026-10-30",
    );
    expect(items.map((i) => `${i.taskId}:${i.partId}`)).toEqual([
      "a:p1",
      "b:p1",
      "b:p2",
      "c:p1",
    ]);
  });
});
