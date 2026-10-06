import { describe, expect, it } from "vitest";
import { triggerSchema } from "../../../src/lib/tasks/engine/types";
import { ToolError } from "../errors";
import {
  parseTrigger,
  TRIGGER_DOCS,
  TRIGGER_TYPES,
  triggerHelp,
} from "./trigger-docs";

describe("trigger docs", () => {
  it("document exactly the types the engine knows", () => {
    const engineTypes = triggerSchema.options.map((o) => o.shape.type.value);
    expect([...TRIGGER_TYPES].sort()).toEqual([...engineTypes].sort());
  });

  it.each(TRIGGER_TYPES)("%s: the example is a valid trigger", (type) => {
    const example = TRIGGER_DOCS[type].example;
    expect(example.type).toBe(type);
    expect(parseTrigger(example)).toMatchObject({ v: 1, type });
  });

  it("lists every type with its example in the help text", () => {
    const help = triggerHelp();
    for (const type of TRIGGER_TYPES) {
      expect(help).toContain(`- ${type}: `);
      expect(help).toContain(JSON.stringify(TRIGGER_DOCS[type].example));
    }
  });
});

describe("parseTrigger", () => {
  const fails = (raw: Record<string, unknown>) => {
    try {
      parseTrigger(raw);
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("invalid_request");
      return (err as ToolError).message;
    }
    throw new Error("expected parseTrigger to fail");
  };

  it("fills in the version but keeps an explicit one", () => {
    expect(parseTrigger({ type: "one_off", date: "2026-12-24" }).v).toBe(1);
    expect(fails({ v: 2, type: "one_off", date: "2026-12-24" })).toContain(
      "trigger.v",
    );
  });

  it("names unknown types", () => {
    expect(fails({ type: "daily" })).toMatch(/"daily" is unknown.*interval/);
  });

  it("names each wrong field and gives the example of that type", () => {
    const message = fails({
      type: "min_per_period",
      period: "decade",
      count: 0,
    });
    expect(message).toContain("Invalid min_per_period trigger");
    expect(message).toContain("trigger.period");
    expect(message).toContain("trigger.count");
    expect(message).toContain(
      JSON.stringify(TRIGGER_DOCS.min_per_period.example),
    );
  });

  it("rejects impossible dates", () => {
    expect(fails({ type: "one_off", date: "2026-02-30" })).toContain(
      "trigger.date: Expected a valid YYYY-MM-DD date",
    );
  });
});
