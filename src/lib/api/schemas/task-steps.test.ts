import { describe, expect, it } from "vitest";
import { isHttpUrl } from "./common";
import {
  MAX_TASK_STEPS,
  putTaskStepsRequestSchema,
  stepsSourceInputSchema,
} from "./task-steps";

const step = (title = "Filter tauschen") => ({ title });

describe("PUT /tasks/{id}/steps body", () => {
  it("accepts a list with and without ids, an empty list, and fills in the body", () => {
    expect(
      putTaskStepsRequestSchema.parse({
        steps: [step("A"), { id: "abc", title: " B ", body: " mit Text \n" }],
      }),
    ).toEqual({
      steps: [
        { title: "A", body: "" },
        { id: "abc", title: "B", body: "mit Text" },
      ],
    });
    expect(putTaskStepsRequestSchema.parse({ steps: [] })).toEqual({
      steps: [],
    });
  });

  it.each([
    ["no steps field", {}],
    ["a blank title", { steps: [step("   ")] }],
    ["a title over 200 characters", { steps: [step("x".repeat(201))] }],
    ["a title with a line break", { steps: [step("Eins\nZwei")] }],
    [
      "a body over 2000 characters",
      { steps: [{ title: "A", body: "x".repeat(2001) }] },
    ],
    ["an unknown field on a step", { steps: [{ title: "A", position: 3 }] }],
    ["an unknown field on the body", { steps: [], extra: 1 }],
    [
      `more than ${MAX_TASK_STEPS} steps`,
      { steps: Array.from({ length: MAX_TASK_STEPS + 1 }, () => step()) },
    ],
    [
      "the same id twice",
      {
        steps: [
          { id: "a", title: "A" },
          { id: "a", title: "B" },
        ],
      },
    ],
    ["an empty id", { steps: [{ id: "", title: "A" }] }],
  ])("refuses %s", (_name, body) => {
    expect(putTaskStepsRequestSchema.safeParse(body).success).toBe(false);
  });

  it("accepts exactly the most steps", () => {
    expect(
      putTaskStepsRequestSchema.safeParse({
        steps: Array.from({ length: MAX_TASK_STEPS }, () => step()),
      }).success,
    ).toBe(true);
  });

  it("reports a repeated id on the steps field", () => {
    const result = putTaskStepsRequestSchema.safeParse({
      steps: [
        { id: "a", title: "A" },
        { id: "a", title: "B" },
      ],
    });
    expect(result.error?.issues[0]?.path).toEqual(["steps", 1, "id"]);
  });

  it("keeps source apart: left out, null and an object are three different things", () => {
    expect(putTaskStepsRequestSchema.parse({ steps: [] })).not.toHaveProperty(
      "source",
    );
    expect(
      putTaskStepsRequestSchema.parse({ steps: [], source: null }),
    ).toEqual({ steps: [], source: null });
    expect(
      putTaskStepsRequestSchema.parse({ steps: [], source: { label: "L" } })
        .source,
    ).toEqual({ label: "L" });
  });
});

describe("the source of the steps", () => {
  it.each([
    ["a label alone", { label: "Anleitung" }],
    ["a web address", { url: "https://docs.example.org/a?b=1#c" }],
    [
      "a web address and a label",
      { label: "Seite", url: "http://x.example.org" },
    ],
    ["a file", { attachmentId: "att-1" }],
    ["a file and a page", { attachmentId: "att-1", page: 9999 }],
    [
      "explicit nulls beside what is given",
      { label: "L", url: null, page: null },
    ],
  ])("accepts %s", (_name, source) => {
    expect(stepsSourceInputSchema.safeParse(source).success).toBe(true);
  });

  it.each([
    ["an empty object", {}],
    ["only nulls", { label: null, url: null, attachmentId: null }],
    ["a page alone", { page: 3 }],
    ["a page beside a web address", { url: "https://x.example.org", page: 3 }],
    [
      "an address and a file",
      { url: "https://x.example.org", attachmentId: "a" },
    ],
    ["a page of 0", { attachmentId: "a", page: 0 }],
    ["a page over 9999", { attachmentId: "a", page: 10_000 }],
    ["a fractional page", { attachmentId: "a", page: 1.5 }],
    ["a blank label", { label: "  " }],
    ["a label over 200 characters", { label: "x".repeat(201) }],
    ["an unknown field", { label: "L", note: "x" }],
    ["javascript", { url: "javascript:alert(1)" }],
    ["ftp", { url: "ftp://x.example.org/a" }],
    ["credentials in the address", { url: "https://user:pw@x.example.org/" }],
    ["a relative address", { url: "/docs/a" }],
    [
      "an address over 2000 characters",
      { url: `https://x.example.org/${"a".repeat(2000)}` },
    ],
  ])("refuses %s", (_name, source) => {
    expect(stepsSourceInputSchema.safeParse(source).success).toBe(false);
  });

  it("puts each problem on the field it is about", () => {
    const path = (source: unknown) =>
      stepsSourceInputSchema.safeParse(source).error?.issues.map((i) => i.path);
    expect(path({ url: "https://x.example.org", attachmentId: "a" })).toEqual([
      ["attachmentId"],
    ]);
    expect(path({ label: "L", page: 2 })).toEqual([["page"]]);
    expect(path({})).toEqual([[]]);
  });
});

describe("isHttpUrl", () => {
  it.each([
    ["https://example.org", true],
    ["http://example.org:8080/a", true],
    ["http://192.168.1.1/manual", true],
    ["HTTPS://Example.org/Path", true],
    ["https://user@example.org", false],
    ["https://:pw@example.org", false],
    ["file:///etc/passwd", false],
    ["data:text/plain,hi", false],
    ["mailto:a@example.org", false],
    ["example.org", false],
    ["https://", false],
    ["", false],
  ])("%s -> %s", (value, expected) => {
    expect(isHttpUrl(value)).toBe(expected);
  });
});
