import { describe, expect, it } from "vitest";
import {
  createCostBookRequestSchema,
  updateCostBookRequestSchema,
} from "$lib/api/schemas/cost-books";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createSettlementRequestSchema } from "$lib/api/schemas/settlements";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  createCostBook,
  defaultCostBook,
  deleteCostBook,
  getCostBook,
  listCostBooks,
  updateCostBook,
} from "./books";
import { createCost } from "./costs";
import { createSettlement } from "./settlements";

describe("cost books", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  const create = (over: Record<string, unknown> = {}) =>
    createCostBook(
      ctx(),
      createCostBookRequestSchema.parse({ name: "Ferien", ...over }),
    );
  const update = (id: string, patch: Record<string, unknown>) =>
    updateCostBook(ctx(), id, updateCostBookRequestSchema.parse(patch));
  const named = (name: string) => {
    const book = listCostBooks(
      ctx(),
      { includeArchived: true },
      { limit: 50 },
    ).items.find((b) => b.name === name);
    if (!book) throw new Error(`no book ${name}`);
    return book;
  };
  const list = (includeArchived = false) =>
    listCostBooks(ctx(), { includeArchived }, { limit: 50 }).items;

  it("starts with Wohnung, Haushalt and Auto; Wohnung is tax relevant and the default", () => {
    expect(list().map((b) => b.name)).toEqual(["Wohnung", "Haushalt", "Auto"]);
    const [wohnung, haushalt, auto] = list();
    expect(wohnung).toMatchObject({
      slug: "wohnung",
      taxRelevant: true,
      defaultSplitMode: "ownership",
      isDefault: true,
      archivedAt: null,
      entryCount: 0,
      settlementCount: 0,
    });
    expect(haushalt).toMatchObject({
      taxRelevant: false,
      defaultSplitMode: "equal",
      isDefault: false,
    });
    expect(auto).toMatchObject({ taxRelevant: false, isDefault: false });
    expect(defaultCostBook(ctx()).id).toBe(wohnung.id);
  });

  describe("create", () => {
    it("derives the slug, goes to the end and starts as an everyday book", () => {
      const book = create({ name: "Ferien Süden" });
      expect(book).toMatchObject({
        name: "Ferien Süden",
        slug: "ferien-sueden",
        icon: null,
        defaultSplitMode: "ownership",
        taxRelevant: false,
        sortOrder: 3,
        archivedAt: null,
        isDefault: false,
        entryCount: 0,
      });
      expect(
        list()
          .map((b) => b.name)
          .at(-1),
      ).toBe("Ferien Süden");
    });

    it("takes the options it is given", () => {
      expect(
        create({
          icon: "plane",
          defaultSplitMode: "none",
          taxRelevant: true,
          sortOrder: 0,
          slug: "trip",
        }),
      ).toMatchObject({
        icon: "plane",
        defaultSplitMode: "none",
        taxRelevant: true,
        sortOrder: 0,
        slug: "trip",
      });
    });

    it("finds a free slug for another name that reads the same", () => {
      create({ name: "Ferien!" });
      expect(create({ name: "Ferien?" }).slug).toBe("ferien-2");
    });

    it.each(["wohnung", "WOHNUNG", "Wohnung"])(
      "refuses the name %s, which a book has already (case does not matter)",
      (name) => {
        expect(() => create({ name })).toThrowError(
          expect.objectContaining({ code: "conflict" }),
        );
      },
    );

    it("refuses an explicit slug that is taken", () => {
      expect(() => create({ slug: "wohnung" })).toThrowError(
        expect.objectContaining({ code: "conflict" }),
      );
    });

    it("limits the name to 60 characters", () => {
      expect(
        createCostBookRequestSchema.safeParse({ name: "x".repeat(61) }).success,
      ).toBe(false);
      expect(
        createCostBookRequestSchema.safeParse({ name: "x".repeat(60) }).success,
      ).toBe(true);
      expect(
        createCostBookRequestSchema.safeParse({ name: "  " }).success,
      ).toBe(false);
      expect(
        createCostBookRequestSchema.safeParse({
          name: "A",
          defaultSplitMode: "custom",
        }).success,
      ).toBe(false);
    });
  });

  describe("update", () => {
    it("renames without touching the slug, and keeps its own name", () => {
      const ferien = create();
      expect(update(ferien.id, { name: "Sommerferien" })).toMatchObject({
        name: "Sommerferien",
        slug: "ferien",
      });
      expect(update(ferien.id, { name: "SOMMERFERIEN" }).name).toBe(
        "SOMMERFERIEN",
      );
      expect(() => update(ferien.id, { name: "auto" })).toThrowError(
        expect.objectContaining({ code: "conflict" }),
      );
      expect(() => update(ferien.id, { slug: "haushalt" })).toThrowError(
        expect.objectContaining({ code: "conflict" }),
      );
    });

    it("changes the options", () => {
      const ferien = create();
      expect(
        update(ferien.id, {
          icon: "sun",
          defaultSplitMode: "equal",
          taxRelevant: true,
          sortOrder: 9,
        }),
      ).toMatchObject({
        icon: "sun",
        defaultSplitMode: "equal",
        taxRelevant: true,
        sortOrder: 9,
      });
      expect(update(ferien.id, { icon: "" }).icon).toBeNull();
    });

    it("archives and restores, keeping the first archive date", () => {
      const ferien = create();
      const archived = update(ferien.id, { archived: true });
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(update(ferien.id, { archived: true }).archivedAt).toEqual(
        archived.archivedAt,
      );
      expect(list().map((b) => b.name)).not.toContain("Ferien");
      expect(list(true).map((b) => b.name)).toEqual([
        "Wohnung",
        "Haushalt",
        "Auto",
        "Ferien",
      ]);
      expect(update(ferien.id, { archived: false }).archivedAt).toBeNull();
      expect(list().map((b) => b.name)).toContain("Ferien");
    });

    it("lists archived books after the active ones whatever their sort order", () => {
      const first = create({ name: "Zuerst", sortOrder: 0 });
      update(first.id, { archived: true });
      expect(list(true).map((b) => b.name)).toEqual([
        "Wohnung",
        "Haushalt",
        "Auto",
        "Zuerst",
      ]);
    });

    it("404s for an unknown book", () => {
      expect(() => update("missing", { name: "x" })).toThrowError(
        expect.objectContaining({ code: "not_found" }),
      );
    });
  });

  describe("the default book", () => {
    const defaults = () => list(true).filter((b) => b.isDefault);

    it("is Wohnung to begin with, flagged on the book and not worked out from the order", () => {
      expect(defaults().map((b) => b.name)).toEqual(["Wohnung"]);
      expect(defaultCostBook(ctx()).name).toBe("Wohnung");
    });

    it("stays where it is when the books are reordered", () => {
      update(named("Auto").id, { sortOrder: 0 });
      update(named("Wohnung").id, { sortOrder: 9 });
      update(named("Haushalt").id, { sortOrder: 1 });
      expect(list().map((b) => b.name)).toEqual([
        "Auto",
        "Haushalt",
        "Wohnung",
      ]);
      expect(defaults().map((b) => b.name)).toEqual(["Wohnung"]);
      expect(defaultCostBook(ctx()).name).toBe("Wohnung");
    });

    it("moves when another book is made the default, and there is still only one", () => {
      const haushalt = named("Haushalt");
      expect(update(haushalt.id, { isDefault: true }).isDefault).toBe(true);
      expect(defaults().map((b) => b.name)).toEqual(["Haushalt"]);
      expect(defaultCostBook(ctx()).id).toBe(haushalt.id);
      expect(getCostBook(ctx(), named("Wohnung").id).isDefault).toBe(false);
      // asking again changes nothing
      expect(update(haushalt.id, { isDefault: true }).isDefault).toBe(true);
      expect(defaults()).toHaveLength(1);
    });

    it("can be set on a new book", () => {
      const ferien = create({ isDefault: true });
      expect(ferien.isDefault).toBe(true);
      expect(defaults().map((b) => b.name)).toEqual(["Ferien"]);
      expect(create({ name: "Garten" }).isDefault).toBe(false);
      expect(defaults().map((b) => b.name)).toEqual(["Ferien"]);
    });

    it("is where an entry without a book goes", async () => {
      await createTestUser();
      update(named("Auto").id, { isDefault: true });
      const cost = createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Waschen",
          amountMinor: 1000,
          category: "other",
        }),
        null,
      );
      expect(cost.bookName).toBe("Auto");
      expect(cost.splitMode).toBe("equal");
    });

    it("cannot be switched off without naming another one", () => {
      const wohnung = named("Wohnung");
      expect(() => update(wohnung.id, { isDefault: false })).toThrowError(
        expect.objectContaining({ code: "conflict" }),
      );
      expect(defaults().map((b) => b.name)).toEqual(["Wohnung"]);
      // on a book that is not the default it asks for what already is
      expect(update(named("Auto").id, { isDefault: false }).isDefault).toBe(
        false,
      );
      expect(defaults().map((b) => b.name)).toEqual(["Wohnung"]);
    });

    it("goes to the first book that is still open, by sort order, when the default is archived", () => {
      update(named("Auto").id, { sortOrder: 0 });
      update(named("Wohnung").id, { sortOrder: 5 });
      expect(update(named("Wohnung").id, { archived: true })).toMatchObject({
        isDefault: false,
      });
      expect(defaults().map((b) => b.name)).toEqual(["Auto"]);
      expect(defaultCostBook(ctx()).name).toBe("Auto");
    });

    it("goes to the first book that is still open when the default is deleted", () => {
      const ferien = create({ isDefault: true, sortOrder: 7 });
      deleteCostBook(ctx(), ferien.id);
      expect(defaults().map((b) => b.name)).toEqual(["Wohnung"]);
      deleteCostBook(ctx(), named("Wohnung").id);
      expect(defaults().map((b) => b.name)).toEqual(["Haushalt"]);
    });

    it("is not given back to a restored book", () => {
      const wohnung = named("Wohnung");
      update(wohnung.id, { archived: true });
      update(wohnung.id, { archived: false });
      expect(defaults().map((b) => b.name)).toEqual(["Haushalt"]);
    });

    it("cannot be an archived book, but a book can be restored and made the default together", () => {
      const ferien = create();
      update(ferien.id, { archived: true });
      expect(() => update(ferien.id, { isDefault: true })).toThrowError(
        expect.objectContaining({ code: "invalid_request" }),
      );
      expect(() =>
        update(named("Auto").id, { archived: true, isDefault: true }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
      expect(defaults().map((b) => b.name)).toEqual(["Wohnung"]);
      expect(
        update(ferien.id, { archived: false, isDefault: true }),
      ).toMatchObject({ isDefault: true, archivedAt: null });
      expect(defaults().map((b) => b.name)).toEqual(["Ferien"]);
    });

    it("archiving the default and asking for it to stop being the default is fine together", () => {
      update(named("Wohnung").id, { archived: true, isDefault: false });
      expect(defaults().map((b) => b.name)).toEqual(["Haushalt"]);
    });

    it("always exists: the last book that is not archived cannot be archived or deleted", () => {
      for (const name of ["Haushalt", "Auto"]) {
        update(named(name).id, { archived: true });
      }
      const wohnung = named("Wohnung");
      expect(() => update(wohnung.id, { archived: true })).toThrowError(
        expect.objectContaining({ code: "conflict" }),
      );
      expect(() => deleteCostBook(ctx(), wohnung.id)).toThrowError(
        expect.objectContaining({ code: "conflict" }),
      );
      expect(defaultCostBook(ctx()).id).toBe(wohnung.id);
      // another one makes room for it
      create();
      update(wohnung.id, { archived: true });
      expect(defaultCostBook(ctx()).name).toBe("Ferien");
      expect(defaults().map((b) => b.name)).toEqual(["Ferien"]);
    });

    it("falls back to the first book that is open when no book is flagged", () => {
      test.db.$client.exec("update cost_books set is_default = 0");
      expect(defaultCostBook(ctx()).name).toBe("Wohnung");
      expect(list().find((b) => b.isDefault)?.name).toBe("Wohnung");
    });

    it("is refused by the database for a second book", () => {
      expect(() =>
        test.db.$client.exec(
          `update cost_books set is_default = 1 where slug = 'haushalt'`,
        ),
      ).toThrow(/UNIQUE/);
    });
  });

  describe("delete", () => {
    it("deletes an empty book", () => {
      const ferien = create();
      deleteCostBook(ctx(), ferien.id);
      expect(list(true).map((b) => b.name)).toEqual([
        "Wohnung",
        "Haushalt",
        "Auto",
      ]);
      expect(() => getCostBook(ctx(), ferien.id)).toThrowError(
        expect.objectContaining({ code: "not_found" }),
      );
      expect(() => deleteCostBook(ctx(), ferien.id)).toThrowError(
        expect.objectContaining({ code: "not_found" }),
      );
    });

    it("refuses a book with entries and says how many, and counts them", async () => {
      await createTestUser();
      const ferien = create();
      for (const title of ["Zug", "Hotel"]) {
        createCost(
          ctx(),
          createCostRequestSchema.parse({
            title,
            amountMinor: 1000,
            category: "travel",
            bookId: ferien.id,
          }),
          null,
        );
      }
      expect(getCostBook(ctx(), ferien.id)).toMatchObject({
        entryCount: 2,
        settlementCount: 0,
      });
      let error: unknown;
      try {
        deleteCostBook(ctx(), ferien.id);
      } catch (err) {
        error = err;
      }
      expect(error).toMatchObject({
        code: "conflict",
        details: { entryCount: 2, settlementCount: 0 },
      });
      expect(getCostBook(ctx(), ferien.id).entryCount).toBe(2);
    });

    it("refuses a book with payments, even an archived one", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const ben = await createTestUser({ displayName: "Ben" });
      const ferien = create();
      createSettlement(
        ctx(),
        createSettlementRequestSchema.parse({
          bookId: ferien.id,
          fromUserId: ben.id,
          toUserId: anna.id,
          amountMinor: 500,
        }),
        anna.id,
      );
      update(ferien.id, { archived: true });
      expect(getCostBook(ctx(), ferien.id)).toMatchObject({
        entryCount: 0,
        settlementCount: 1,
      });
      expect(() => deleteCostBook(ctx(), ferien.id)).toThrowError(
        expect.objectContaining({
          code: "conflict",
          details: { entryCount: 0, settlementCount: 1 },
        }),
      );
    });
  });

  describe("list", () => {
    it("pages with a cursor", () => {
      const first = listCostBooks(ctx(), {}, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = listCostBooks(
        ctx(),
        {},
        { limit: 2, cursor: first.nextCursor ?? undefined },
      );
      expect(second.items.map((b) => b.name)).toEqual(["Auto"]);
      expect(second.nextCursor).toBeNull();
    });
  });
});
