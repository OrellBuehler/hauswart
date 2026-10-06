import { describe, expect, it } from "vitest";
import { NOTIFICATION_TITLE_KEYS } from "../../src/lib/api/enums";
import { triggerSchema } from "../../src/lib/tasks/engine/types";
import { compact, describeTrigger, renderNotification } from "./format";
import { TRIGGER_DOCS, TRIGGER_TYPES } from "./tools/trigger-docs";

describe("compact", () => {
  it("drops null and undefined at any depth and keeps false, 0 and empty values", () => {
    expect(
      compact({
        a: null,
        b: undefined,
        c: 0,
        d: false,
        e: "",
        f: [],
        g: [{ h: null, i: 1 }],
        j: { k: null },
      }),
    ).toEqual({ c: 0, d: false, e: "", f: [], g: [{ i: 1 }], j: {} });
  });
});

describe("describeTrigger", () => {
  it.each(TRIGGER_TYPES)("describes the %s example in one line", (type) => {
    const trigger = triggerSchema.parse({
      v: 1,
      ...TRIGGER_DOCS[type].example,
    });
    const text = describeTrigger(trigger);
    expect(text.length).toBeGreaterThan(5);
    expect(text).not.toContain("\n");
  });

  it("reads like a person would say it", () => {
    const t = (o: object) =>
      describeTrigger(triggerSchema.parse({ v: 1, ...o }));
    expect(
      t({ ...TRIGGER_DOCS.interval.example, every: 1, unit: "week" }),
    ).toBe("every week, counted from the last completion");
    expect(t(TRIGGER_DOCS.interval.example)).toBe(
      "every 3 months, counted from the last completion",
    );
    expect(t(TRIGGER_DOCS.calendar.example)).toBe(
      "every month on Sat (occurrence 1)",
    );
    expect(t(TRIGGER_DOCS.min_per_period.example)).toBe("at least 2x per week");
  });
});

describe("renderNotification", () => {
  it("renders every message key", () => {
    for (const titleKey of NOTIFICATION_TITLE_KEYS) {
      const text = renderNotification({
        id: "n",
        kind: "info",
        taskId: null,
        titleKey,
        params: {
          title: "T",
          date: "2026-01-01",
          days: 3,
          prep: "P",
          overdue: 1,
          due: 2,
          soon: 3,
          message: "M",
          author: "A",
        },
        url: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        readAt: null,
      });
      expect(text).not.toContain("undefined");
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
