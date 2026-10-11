import { describe, expect, it } from "vitest";
import { preferKind } from "./order";

const contacts = [
  { id: "1", kind: "installer" as const },
  { id: "2", kind: "insurance" as const },
  { id: "3", kind: "other" as const },
  { id: "4", kind: "insurance" as const },
];

describe("preferKind", () => {
  it("puts the contacts of the kind first and keeps the order within each group", () => {
    expect(preferKind(contacts, "insurance").map((c) => c.id)).toEqual([
      "2",
      "4",
      "1",
      "3",
    ]);
  });

  it("leaves everything in place without a preferred kind", () => {
    expect(preferKind(contacts, undefined).map((c) => c.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("keeps everybody when no contact has the kind", () => {
    expect(preferKind(contacts, "emergency")).toHaveLength(4);
  });

  it("does not change the list it was given", () => {
    const before = contacts.map((c) => c.id);
    preferKind(contacts, "insurance");
    expect(contacts.map((c) => c.id)).toEqual(before);
  });
});
