import { describe, expect, it } from "vitest";
import { nextAssignee, type RotationConfig } from "./rotation";

const base = (over: Partial<RotationConfig> = {}): RotationConfig => ({
  mode: "rotate",
  rotationOrder: ["a", "b"],
  strategy: "alternate",
  ...over,
});

let t = 1_000;
const doneBy = (
  userId: string | null,
  over: { kind?: "done" | "skipped"; at?: number } = {},
) => ({
  userId,
  kind: over.kind ?? ("done" as const),
  completedAt: over.at ?? (t += 1_000),
});

describe("nextAssignee, modes", () => {
  it("none has no assignee", () => {
    expect(
      nextAssignee(base({ mode: "none", assigneeUserId: "a" }), []),
    ).toBeNull();
  });

  it.each([
    ["fixed returns the assignee", "a", "a"],
    ["fixed without assignee", undefined, null],
    ["fixed with null assignee", null, null],
  ])("%s", (_name, assigneeUserId, expected) => {
    expect(
      nextAssignee(base({ mode: "fixed", assigneeUserId }), [doneBy("b")]),
    ).toBe(expected);
  });

  it("rotate without members has no assignee", () => {
    expect(nextAssignee(base({ rotationOrder: [] }), [])).toBeNull();
  });
});

describe("nextAssignee, alternate", () => {
  it.each([
    ["no completions: first member", ["a", "b"], [], "a"],
    ["a did it last", ["a", "b"], [doneBy("a")], "b"],
    ["b did it last", ["a", "b"], [doneBy("a"), doneBy("b")], "a"],
    [
      "the other person did it twice in a row",
      ["a", "b"],
      [doneBy("a"), doneBy("b"), doneBy("b")],
      "a",
    ],
    [
      "a did it twice in a row",
      ["a", "b"],
      [doneBy("b"), doneBy("a"), doneBy("a")],
      "b",
    ],
    ["three members wrap around", ["a", "b", "c"], [doneBy("c")], "a"],
    ["three members, middle one last", ["a", "b", "c"], [doneBy("b")], "c"],
    ["single member", ["a"], [doneBy("a")], "a"],
    [
      "duplicates in the order are ignored",
      ["a", "b", "a"],
      [doneBy("b")],
      "a",
    ],
  ])("%s", (_name, order, completions, expected) => {
    expect(nextAssignee(base({ rotationOrder: order }), completions)).toBe(
      expected,
    );
  });

  it("uses completedAt, not array order", () => {
    const completions = [
      doneBy("b", { at: 5_000 }),
      doneBy("a", { at: 9_000 }),
      doneBy("b", { at: 1_000 }),
    ];
    expect(nextAssignee(base(), completions)).toBe("b");
  });

  it("skipped completions do not count", () => {
    expect(
      nextAssignee(base(), [doneBy("a"), doneBy("b", { kind: "skipped" })]),
    ).toBe("b");
  });

  it("completions without a user are ignored", () => {
    expect(nextAssignee(base(), [doneBy("a"), doneBy(null)])).toBe("b");
  });

  it("someone outside the rotation is ignored", () => {
    expect(nextAssignee(base(), [doneBy("a"), doneBy("guest")])).toBe("b");
    expect(nextAssignee(base(), [doneBy("guest")])).toBe("a");
  });

  it("ignores the effort map", () => {
    expect(nextAssignee(base(), [doneBy("a")], { a: 0, b: 100 })).toBe("b");
  });
});

describe("nextAssignee, fair", () => {
  const fair = (order: string[] = ["a", "b"]) =>
    base({ strategy: "fair", rotationOrder: order });

  it.each([
    ["lowest effort wins", ["a", "b"], { a: 5, b: 2 }, [doneBy("b")], "b"],
    [
      "lowest effort wins, other way",
      ["a", "b"],
      { a: 1, b: 2 },
      [doneBy("a")],
      "a",
    ],
    ["missing effort counts as 0", ["a", "b"], { a: 3 }, [], "b"],
    [
      "tie falls back to alternate",
      ["a", "b"],
      { a: 4, b: 4 },
      [doneBy("a")],
      "b",
    ],
    [
      "tie with no completions picks the first",
      ["a", "b"],
      { a: 4, b: 4 },
      [],
      "a",
    ],
    ["no effort data at all alternates", ["a", "b"], {}, [doneBy("b")], "a"],
    [
      "three members, two tied, last was the first",
      ["a", "b", "c"],
      { a: 0, b: 1, c: 1 },
      [doneBy("a")],
      "a",
    ],
    [
      "three members: b and c tie after a did it",
      ["a", "b", "c"],
      { a: 5, b: 1, c: 1 },
      [doneBy("a")],
      "b",
    ],
    [
      "three members: b and c tie after b did it",
      ["a", "b", "c"],
      { a: 5, b: 1, c: 1 },
      [doneBy("b")],
      "c",
    ],
    [
      "three members: b and c tie after c did it",
      ["a", "b", "c"],
      { a: 5, b: 1, c: 1 },
      [doneBy("c")],
      "b",
    ],
    [
      "effort of people outside the rotation is ignored",
      ["a", "b"],
      { a: 3, b: 3, x: 0 },
      [doneBy("a")],
      "b",
    ],
    ["fractional effort", ["a", "b"], { a: 1.5, b: 1.25 }, [], "b"],
  ])("%s", (_name, order, effort, completions, expected) => {
    expect(nextAssignee(fair(order), completions, effort)).toBe(expected);
  });

  it("fair does not penalise the last completer when effort differs", () => {
    expect(nextAssignee(fair(), [doneBy("a")], { a: 0, b: 10 })).toBe("a");
  });
});
