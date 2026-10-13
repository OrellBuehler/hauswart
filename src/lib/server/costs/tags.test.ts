import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createCostRequestSchema,
  updateCostRequestSchema,
} from "$lib/api/schemas/costs";
import { MAX_COST_TAGS } from "$lib/api/schemas/cost-tags";
import { costTags } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  createCost,
  deleteCost,
  getCost,
  listCosts,
  updateCost,
} from "./costs";
import { costsSummary } from "./summary";
import { costsCsv } from "./csv";
import {
  createCostTag,
  deleteCostTag,
  getCostTag,
  listCostTags,
  requireTagIds,
  tagsOfEntries,
  updateCostTag,
} from "./tags";

describe("cost tags", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  const tag = (name: string, color?: "red") =>
    createCostTag(ctx(), { name, color });
  const entry = (
    over: Record<string, unknown> = {},
    by: string | null = null,
  ) =>
    createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Einkauf",
        amountMinor: 1000,
        category: "groceries",
        date: "2026-03-10",
        splitMode: "none",
        ...over,
      }),
      by,
    );

  describe("the tags", () => {
    it("creates a tag with a colour that defaults to gray", () => {
      expect(tag("Ferien")).toMatchObject({
        name: "Ferien",
        color: "gray",
        entryCount: 0,
      });
      expect(tag("Steuern", "red").color).toBe("red");
    });

    it("lists the tags by name without regard to case", () => {
      tag("zebra");
      tag("Äpfel");
      tag("Banane");
      tag("apfel");
      expect(listCostTags(ctx()).map((t) => t.name)).toEqual([
        "apfel",
        "Banane",
        "zebra",
        "Äpfel",
      ]);
    });

    it("refuses a second tag whose name differs only in case", () => {
      tag("Ferien");
      expect(() => tag("FERIEN")).toThrowError(/already exists/);
      expect(() => tag("ferien")).toThrowError(/already exists/);
    });

    it.each([
      ["a lower case umlaut", "übernachtung"],
      ["an upper case umlaut", "ÜBERNACHTUNG"],
      ["a decomposed umlaut", "U\u0308bernachtung"],
      ["a decomposed lower case umlaut", "u\u0308bernachtung"],
    ])("refuses a second tag whose name differs only in %s", (_name, other) => {
      tag("Übernachtung");
      expect(() => tag(other)).toThrowError(/already exists/);
      expect(listCostTags(ctx())).toHaveLength(1);
    });

    it("keeps the names of different letters apart", () => {
      tag("Übernachtung");
      expect(tag("Ubernachtung").name).toBe("Ubernachtung");
      expect(tag("Strasse").name).toBe("Strasse");
    });

    it("compares a rename by the same key, and allows a change of case beyond ASCII in its own name", () => {
      const t = tag("übernachtung");
      expect(updateCostTag(ctx(), t.id, { name: "Übernachtung" }).name).toBe(
        "Übernachtung",
      );
      const other = tag("Steuern");
      expect(() =>
        updateCostTag(ctx(), other.id, { name: "übernachtung" }),
      ).toThrow(/already exists/);
      expect(getCostTag(ctx(), other.id).name).toBe("Steuern");
    });

    it("renames and recolours a tag, and allows a change of case in its own name", () => {
      const t = tag("ferien");
      expect(updateCostTag(ctx(), t.id, { name: "Ferien" }).name).toBe(
        "Ferien",
      );
      expect(updateCostTag(ctx(), t.id, { color: "blue" }).color).toBe("blue");
      const other = tag("Steuern");
      expect(() => updateCostTag(ctx(), other.id, { name: "FERIEN" })).toThrow(
        /already exists/,
      );
    });

    it("stops at the most tags a household can have", () => {
      test.db
        .insert(costTags)
        .values(
          Array.from({ length: MAX_COST_TAGS }, (_, i) => ({
            name: `Tag ${i}`,
          })),
        )
        .run();
      expect(() => tag("Eins zu viel")).toThrow(/delete one you do not use/);
    });

    it("answers not found for a tag that is not there", () => {
      expect(() => getCostTag(ctx(), "nope")).toThrow(/not found/);
      expect(() => updateCostTag(ctx(), "nope", { name: "x" })).toThrow(
        /not found/,
      );
      expect(() => deleteCostTag(ctx(), "nope")).toThrow(/not found/);
    });
  });

  describe("requireTagIds", () => {
    it("keeps each id once, in the order given", () => {
      const a = tag("A");
      const b = tag("B");
      expect(requireTagIds(ctx(), [b.id, a.id, b.id])).toEqual([b.id, a.id]);
      expect(requireTagIds(ctx(), [])).toEqual([]);
    });

    it("refuses an id that names no tag, as a 400 on the field", () => {
      const a = tag("A");
      expect(() => requireTagIds(ctx(), [a.id, "nope"])).toThrow(
        "Invalid request",
      );
    });
  });

  describe("on entries", () => {
    it("books an entry with tags and reads them back by name", () => {
      const ferien = tag("ferien");
      const steuern = tag("Steuern");
      const e = entry({ tagIds: [steuern.id, ferien.id, steuern.id] });
      expect(e.tags.map((t) => t.name)).toEqual(["ferien", "Steuern"]);
      expect(getCost(ctx(), e.id).tags).toEqual(e.tags);
      expect(getCostTag(ctx(), ferien.id).entryCount).toBe(1);
      expect(entry().tags).toEqual([]);
    });

    it("refuses an unknown tag and books nothing", () => {
      expect(() => entry({ tagIds: ["nope"] })).toThrow("Invalid request");
      expect(listCosts(ctx(), {}, { limit: 10 }, "me").items).toEqual([]);
    });

    it("replaces the tags on update, clears them with an empty list and leaves them without tagIds", async () => {
      const a = tag("A");
      const b = tag("B");
      const e = entry({ tagIds: [a.id] });
      expect(
        updateCost(
          ctx(),
          e.id,
          updateCostRequestSchema.parse({ tagIds: [b.id] }),
        ).tags.map((t) => t.name),
      ).toEqual(["B"]);
      expect(
        updateCost(ctx(), e.id, updateCostRequestSchema.parse({ title: "Neu" }))
          .tags,
      ).toHaveLength(1);
      expect(
        updateCost(ctx(), e.id, updateCostRequestSchema.parse({ tagIds: [] }))
          .tags,
      ).toEqual([]);
      expect(getCostTag(ctx(), b.id).entryCount).toBe(0);
    });

    it("counts a change of the tags alone as a change of the entry", () => {
      const a = tag("A");
      const e = entry();
      const later = ctxAt(test.db, ctx().now + 60_000);
      const changed = updateCost(
        later,
        e.id,
        updateCostRequestSchema.parse({ tagIds: [a.id] }),
      );
      expect(changed.updatedAt.getTime()).toBe(later.now);
    });

    it("refuses an unknown tag on update and changes nothing", () => {
      const a = tag("A");
      const e = entry({ tagIds: [a.id] });
      expect(() =>
        updateCost(
          ctx(),
          e.id,
          updateCostRequestSchema.parse({ title: "Neu", tagIds: ["nope"] }),
        ),
      ).toThrow("Invalid request");
      expect(getCost(ctx(), e.id)).toMatchObject({ title: "Einkauf" });
      expect(getCost(ctx(), e.id).tags).toHaveLength(1);
    });

    it("lets go of a deleted entry's tags and keeps entries when a tag is deleted", () => {
      const a = tag("A");
      const e1 = entry({ tagIds: [a.id] });
      const e2 = entry({ tagIds: [a.id] });
      expect(getCostTag(ctx(), a.id).entryCount).toBe(2);
      deleteCost(ctx(), e1.id);
      expect(getCostTag(ctx(), a.id).entryCount).toBe(1);
      deleteCostTag(ctx(), a.id);
      expect(getCost(ctx(), e2.id).tags).toEqual([]);
      expect(
        test.db.select().from(costTags).where(eq(costTags.id, a.id)).all(),
      ).toEqual([]);
    });

    it("reads the tags of many entries at once", () => {
      const a = tag("A");
      const e1 = entry({ tagIds: [a.id] });
      const e2 = entry();
      const map = tagsOfEntries(test.db, [e1.id, e2.id, "nope"]);
      expect(map.get(e1.id)).toEqual([{ id: a.id, name: "A", color: "gray" }]);
      expect(map.has(e2.id)).toBe(false);
      expect(tagsOfEntries(test.db, [])).toEqual(new Map());
    });
  });

  describe("filters", () => {
    it("lists only the entries that carry the tag, and answers 404 for a tag that is not there", () => {
      const a = tag("A");
      const b = tag("B");
      const withA = entry({ title: "Mit A", tagIds: [a.id] });
      const both = entry({ title: "Beide", tagIds: [a.id, b.id] });
      entry({ title: "Ohne" });
      const titles = (tagId: string) =>
        listCosts(ctx(), { tagId }, { limit: 10 }, "me")
          .items.map((c) => c.id)
          .sort();
      expect(titles(a.id)).toEqual([withA.id, both.id].sort());
      expect(titles(b.id)).toEqual([both.id]);
      expect(() =>
        listCosts(ctx(), { tagId: "nope" }, { limit: 10 }, "me"),
      ).toThrow(/not found/);
    });

    it("narrows the summary to the tag's entries and answers 404 for an unknown tag", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const a = tag("A");
      entry({ amountMinor: 1000, tagIds: [a.id] }, anna.id);
      entry({ amountMinor: 2500, tagIds: [a.id], category: "repair" }, anna.id);
      entry({ amountMinor: 9999 }, anna.id);
      const all = costsSummary(ctx(), 2026);
      const only = costsSummary(ctx(), 2026, { tagId: a.id });
      expect(all.expenseTotalMinor).toBe(13499);
      expect(only.expenseTotalMinor).toBe(3500);
      expect(only.byCategory.map((c) => c.category).sort()).toEqual([
        "groceries",
        "repair",
      ]);
      expect(() => costsSummary(ctx(), 2026, { tagId: "nope" })).toThrow(
        /not found/,
      );
    });

    it("narrows the summary's settlement to the tag too", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const ben = await createTestUser({ displayName: "Ben" });
      const a = tag("A");
      entry(
        {
          amountMinor: 1000,
          tagIds: [a.id],
          paidByUserId: anna.id,
          splitMode: "equal",
        },
        anna.id,
      );
      entry(
        { amountMinor: 8000, paidByUserId: ben.id, splitMode: "equal" },
        ben.id,
      );
      const only = costsSummary(ctx(), 2026, { tagId: a.id });
      expect(only.settlement).toEqual([
        expect.objectContaining({
          fromUserId: ben.id,
          toUserId: anna.id,
          amountMinor: 500,
        }),
      ]);
    });
  });

  describe("CSV", () => {
    it("has the tags as the last column: names by name, a comma and a space between", () => {
      const ferien = tag("ferien");
      const steuern = tag("Steuern; 2026");
      entry({ title: "Mit", tagIds: [steuern.id, ferien.id] });
      entry({ title: "Ohne" });
      const lines = costsCsv(ctx(), 2026).trim().split("\r\n");
      expect(lines[0].split(";").at(-1)).toBe("tags");
      const mit = lines.find((l) => l.includes(";Mit;")) as string;
      expect(mit.endsWith(';"ferien, Steuern; 2026"')).toBe(true);
      const ohne = lines.find((l) => l.includes(";Ohne;")) as string;
      expect(ohne.endsWith(";")).toBe(true);
    });

    it("keeps the columns before it as they were", () => {
      const header = costsCsv(ctx(), 2026).replace("﻿", "").split("\r\n")[0];
      expect(header.split(";").slice(0, 17)).toEqual([
        "date",
        "title",
        "amount",
        "currency",
        "category",
        "payee",
        "paid_by",
        "split",
        "counts_as_expense",
        "deductible",
        "asset",
        "room",
        "defect",
        "notes",
        "source",
        "id",
        "book",
      ]);
      expect(header.split(";")).toHaveLength(18);
    });

    it("exports only the tag's entries with tagId, and answers 404 for an unknown tag", () => {
      const a = tag("A");
      entry({ title: "Mit", tagIds: [a.id] });
      entry({ title: "Ohne" });
      const lines = costsCsv(ctx(), 2026, { tagId: a.id }).trim().split("\r\n");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(";Mit;");
      expect(() => costsCsv(ctx(), 2026, { tagId: "nope" })).toThrow(
        /not found/,
      );
    });
  });
});
