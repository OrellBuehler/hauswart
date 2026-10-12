import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { CostBook } from "$lib/api/schemas/cost-books";
import { readKeptSettings, type KeptCategory } from "$lib/connections/kept";
import KeptCategoryMap from "./kept-category-map.svelte";

const book = (over: Partial<CostBook>): CostBook => ({
  id: "b1",
  name: "Wohnung",
  slug: "wohnung",
  icon: null,
  defaultSplitMode: "ownership",
  taxRelevant: true,
  archivedAt: null,
  sortOrder: 0,
  isDefault: true,
  entryCount: 0,
  settlementCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const books = [
  book({}),
  book({
    id: "b3",
    name: "Alt",
    isDefault: false,
    archivedAt: "2026-06-01T00:00:00.000Z",
  }),
];
const categories: KeptCategory[] = [
  { id: "cat-1", name: "Housing", parentId: null, kind: "expense" },
];

function html(bookId: string): string {
  return render(KeptCategoryMap as never, {
    props: {
      settings: readKeptSettings({
        categoryMap: { "cat-1": "repair" },
        categoryBookMap: bookId === "" ? {} : { "cat-1": bookId },
      }),
      books,
      categories,
      loading: false,
      error: undefined,
      paused: false,
      onretry: () => {},
    } as never,
  }).body;
}

describe("the category map's books", () => {
  it("warns that a category whose book is archived goes to the default instead", () => {
    const body = html("b3");
    expect(body).toContain("Alt (archiviert)");
    expect(body).toContain("Dieses Buch ist archiviert");
    expect(body).toContain("Standardbuch");
  });

  it("says nothing for a book that takes entries, for no book, or for one that is gone", () => {
    for (const id of ["b1", "", "gone"]) {
      expect(html(id), id).not.toContain("Dieses Buch ist archiviert");
    }
  });
});
