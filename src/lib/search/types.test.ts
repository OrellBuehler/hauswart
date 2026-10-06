import { describe, expect, it } from "vitest";
import { groupHits, safeHitUrl, type SearchHit } from "./types";

const hit = (type: SearchHit["type"], id: string): SearchHit => ({
  type,
  id,
  title: id,
  snippet: "",
  url: `/x/${id}`,
});

describe("groupHits", () => {
  it("orders groups by type and drops empty ones", () => {
    const groups = groupHits([
      hit("task", "t"),
      hit("page", "p1"),
      hit("page", "p2"),
    ]);
    expect(groups.map((g) => g.type)).toEqual(["page", "task"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["p1", "p2"]);
  });
});

describe("safeHitUrl", () => {
  it("only follows app paths", () => {
    expect(safeHitUrl("/docs/a")).toBe("/docs/a");
    expect(safeHitUrl("//evil.example")).toBeNull();
    expect(safeHitUrl("https://evil.example")).toBeNull();
    expect(safeHitUrl("/\\evil")).toBeNull();
  });
});
