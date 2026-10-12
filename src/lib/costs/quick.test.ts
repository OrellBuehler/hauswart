import { describe, expect, it, vi } from "vitest";
import { COST_CATEGORIES, type CostCategory } from "$lib/api/enums";
import { ApiError } from "$lib/api/errors";
import type { CostBook } from "$lib/api/schemas/cost-books";
import {
  CATEGORY_ORDERS,
  VISIBLE_CATEGORIES,
  buildQuickCostBody,
  buildReceiptTaskBody,
  chipCategories,
  chooseQuickBook,
  cleanAmount,
  defaultParticipants,
  isKeyConflict,
  loadRecentCategories,
  needsMoreSection,
  newQuickDraft,
  parseQuickMode,
  quickErrorMessage,
  quickSplit,
  quickTitle,
  rankCategories,
  savedCostsQuery,
  splitSummary,
  withNotShared,
  withQuickBook,
  withTicked,
  type QuickContext,
  type QuickDraft,
} from "./quick";

function book(over: Partial<CostBook> = {}): CostBook {
  return {
    id: "b1",
    name: "Wohnung",
    slug: "wohnung",
    icon: "house",
    defaultSplitMode: "ownership",
    taxRelevant: true,
    archivedAt: null,
    sortOrder: 0,
    isDefault: false,
    entryCount: 0,
    settlementCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const flat = book({ id: "b1", isDefault: true });
const home = book({
  id: "b2",
  name: "Haushalt",
  defaultSplitMode: "equal",
  taxRelevant: false,
});
const solo = book({
  id: "b3",
  name: "Privat",
  defaultSplitMode: "none",
  taxRelevant: false,
});
const old = book({
  id: "b4",
  name: "Alt",
  archivedAt: "2026-06-01T00:00:00.000Z",
});
const books = [flat, home, solo, old];
const people = ["u1", "u2", "u3"];

const used = (bookId: string, ...categories: CostCategory[]) =>
  categories.map((category) => ({ bookId, category }));

describe("category ranking", () => {
  it("lists every category exactly once in both fixed orders", () => {
    for (const order of Object.values(CATEGORY_ORDERS)) {
      expect([...order].sort()).toEqual([...COST_CATEGORIES].sort());
    }
  });

  it("offers everyday spending first in a book without history and the apartment's costs first in a tax relevant one", () => {
    expect(rankCategories([]).slice(0, 3)).toEqual([
      "groceries",
      "household",
      "dining",
    ]);
    expect(rankCategories([], { taxRelevant: true }).slice(0, 3)).toEqual([
      "repair",
      "maintenance",
      "utilities",
    ]);
  });

  it("puts the most used first", () => {
    const ranked = rankCategories(
      used("b2", "dining", "dining", "dining", "gifts", "gifts", "health"),
      { bookId: "b2" },
    );
    expect(ranked.slice(0, 3)).toEqual(["dining", "gifts", "health"]);
    // the unused ones keep the fixed order behind them
    expect(ranked.slice(3, 6)).toEqual(["groceries", "household", "transport"]);
  });

  it("counts what was used in the book first, then in all books", () => {
    const history = [
      ...used("b1", "repair", "repair", "repair", "repair"),
      ...used("b2", "groceries", "dining"),
    ];
    expect(rankCategories(history, { bookId: "b2" }).slice(0, 3)).toEqual([
      "groceries",
      "dining",
      "repair",
    ]);
    expect(rankCategories(history, { bookId: "b1" })[0]).toBe("repair");
    // without a book only the total counts
    expect(rankCategories(history)[0]).toBe("repair");
  });

  it("takes the counts of the recent categories the server answers with", () => {
    const counted = [
      { bookId: "b1", category: "repair" as const, count: 4 },
      { bookId: "b2", category: "dining" as const, count: 3 },
      { bookId: "b2", category: "gifts" as const, count: 1 },
    ];
    expect(rankCategories(counted, { bookId: "b2" }).slice(0, 3)).toEqual([
      "dining",
      "gifts",
      "repair",
    ]);
    expect(rankCategories(counted, { bookId: "b1" })[0]).toBe("repair");
    // without a book only the total counts: 4 repairs beat 3 dinners
    expect(rankCategories(counted).slice(0, 2)).toEqual(["repair", "dining"]);
    // an entry without a count is one use, as before
    expect(
      rankCategories(
        [
          ...used("b2", "gifts"),
          { bookId: "b2", category: "dining", count: 2 },
        ],
        { bookId: "b2" },
      ).slice(0, 2),
    ).toEqual(["dining", "gifts"]);
  });

  it("breaks a tie by the total, then by the fixed order", () => {
    const history = [
      ...used("b1", "gifts", "gifts"),
      ...used("b2", "health", "travel"),
    ];
    // in b2 health and travel are tied at 1; gifts has none there but the most overall
    expect(rankCategories(history, { bookId: "b2" }).slice(0, 3)).toEqual([
      "health",
      "travel",
      "gifts",
    ]);
  });

  it("never drops or repeats a category", () => {
    const ranked = rankCategories(
      used("b1", "other", "other", "fuel", "mortgage_principal"),
      { bookId: "b1", taxRelevant: true },
    );
    expect([...ranked].sort()).toEqual([...COST_CATEGORIES].sort());
    expect(new Set(ranked).size).toBe(COST_CATEGORIES.length);
  });
});

describe("category chips", () => {
  const ranked = rankCategories([]);

  it("shows the top few and keeps a pick from the long list in view", () => {
    expect(chipCategories(ranked, { selected: "", expanded: false })).toEqual(
      ranked.slice(0, VISIBLE_CATEGORIES),
    );
    expect(
      chipCategories(ranked, { selected: "groceries", expanded: false }),
    ).toEqual(ranked.slice(0, VISIBLE_CATEGORIES));
    const picked = chipCategories(ranked, {
      selected: "taxes_fees",
      expanded: false,
    });
    expect(picked).toHaveLength(VISIBLE_CATEGORIES + 1);
    expect(picked.at(-1)).toBe("taxes_fees");
  });

  it("shows all of them once expanded", () => {
    expect(
      chipCategories(ranked, { selected: "other", expanded: true }),
    ).toEqual(ranked);
  });

  it("takes the number of chips from the caller", () => {
    expect(
      chipCategories(ranked, { selected: "", expanded: false, visible: 3 }),
    ).toHaveLength(3);
  });
});

describe("the mode of the quick page", () => {
  it("opens on the receipt only when the address says so", () => {
    expect(parseQuickMode("receipt")).toBe("receipt");
    for (const value of [null, undefined, "", "expense", "Receipt", "x"]) {
      expect(parseQuickMode(value)).toBe("expense");
    }
  });
});

describe("the book a quick entry starts in", () => {
  const choose = (input: Parameters<typeof chooseQuickBook>[0]) =>
    chooseQuickBook(input);

  it("prefers the address, then the last quick entry, then the costs page, then the default", () => {
    expect(
      choose({
        requested: "b2",
        lastUsed: "b3",
        remembered: "b1",
        books,
      }),
    ).toBe("b2");
    expect(choose({ lastUsed: "b3", remembered: "b2", books })).toBe("b3");
    expect(choose({ remembered: "b2", books })).toBe("b2");
    expect(choose({ books })).toBe("b1");
  });

  it("skips a book that takes no entries or does not exist", () => {
    expect(choose({ requested: "b4", lastUsed: "b3", books })).toBe("b3");
    expect(choose({ requested: "gone", remembered: "b2", books })).toBe("b2");
    expect(choose({ requested: "b4", books })).toBe("b1");
  });

  it("reads 'every book' (empty) as no choice", () => {
    expect(choose({ remembered: "", books })).toBe("b1");
    expect(choose({ requested: null, lastUsed: null, books })).toBe("b1");
  });

  it("falls back to the first open book without a default, and to nothing without books", () => {
    expect(choose({ books: [book({ id: "x", isDefault: false }), home] })).toBe(
      "x",
    );
    expect(choose({ books: [] })).toBe("");
  });
});

describe("who an entry is for", () => {
  it("is everybody in a book that shares, nobody in one that does not", () => {
    expect(defaultParticipants(flat, people)).toEqual(people);
    expect(defaultParticipants(home, people)).toEqual(people);
    expect(defaultParticipants(solo, people)).toEqual([]);
    expect(defaultParticipants(undefined, people)).toEqual(people);
  });

  const cases: Array<
    [
      string,
      CostBook | undefined,
      string[],
      ReturnType<typeof quickSplit>,
      boolean?,
    ]
  > = [
    ["ownership book, everybody", flat, people, { kind: "book_default" }],
    [
      "ownership book, a subset",
      flat,
      ["u3", "u1"],
      { kind: "equal", participantIds: ["u1", "u3"] },
    ],
    [
      "ownership book, one person",
      flat,
      ["u2"],
      {
        kind: "equal",
        participantIds: ["u2"],
      },
    ],
    ["ownership book, nobody", flat, [], { kind: "unchosen" }],
    ["ownership book, not shared on purpose", flat, [], { kind: "none" }, true],
    ["equal book, nobody", home, [], { kind: "unchosen" }],
    ["equal book, not shared on purpose", home, [], { kind: "none" }, true],
    ["equal book, everybody", home, people, { kind: "book_default" }],
    [
      "equal book, two of three",
      home,
      ["u1", "u2"],
      { kind: "equal", participantIds: ["u1", "u2"] },
    ],
    ["shared-less book, nobody", solo, [], { kind: "book_default" }],
    [
      "shared-less book, everybody asks for an equal split",
      solo,
      people,
      { kind: "equal", participantIds: undefined },
    ],
    [
      "shared-less book, one person",
      solo,
      ["u2"],
      { kind: "equal", participantIds: ["u2"] },
    ],
    [
      "a person who is no longer in the household is ignored",
      flat,
      ["u1", "gone"],
      { kind: "equal", participantIds: ["u1"] },
    ],
    [
      "a person who is no longer in the household does not make nobody a choice",
      flat,
      ["gone"],
      { kind: "unchosen" },
    ],
    [
      "shared-less book, nobody, whatever the explicit choice",
      solo,
      [],
      { kind: "book_default" },
      true,
    ],
    [
      "people ticked win over a stale 'not shared'",
      flat,
      ["u2"],
      { kind: "equal", participantIds: ["u2"] },
      true,
    ],
    ["no book known, nobody", undefined, [], { kind: "unchosen" }],
  ];
  it.each(cases)(
    "%s",
    (_name, bookInput, participants, expected, notShared) => {
      expect(quickSplit(bookInput, participants, people, notShared)).toEqual(
        expected,
      );
    },
  );

  it("says in a sentence what the chips mean", () => {
    const names = ["Anna", "Ben"];
    expect(splitSummary({ kind: "book_default" }, flat, [])).toBe(
      "Nach Eigentumsanteilen",
    );
    expect(splitSummary({ kind: "book_default" }, home, [])).toBe(
      "Gleich unter allen",
    );
    expect(splitSummary({ kind: "book_default" }, solo, [])).toBe(
      "Nicht geteilt",
    );
    expect(
      splitSummary(
        { kind: "equal", participantIds: ["u1", "u2"] },
        flat,
        names,
      ),
    ).toBe("Gleich unter Anna und Ben");
    expect(
      splitSummary({ kind: "equal", participantIds: undefined }, solo, names),
    ).toBe("Gleich unter allen");
    expect(splitSummary({ kind: "none" }, flat, [])).toBe("Nicht geteilt");
    expect(splitSummary({ kind: "unchosen" }, flat, [])).toBe(
      "Niemand ausgewählt. Wähle, für wen der Eintrag ist, oder «Nicht teilen».",
    );
  });
});

describe("the quick draft", () => {
  const start = () =>
    newQuickDraft({
      today: "2026-10-12",
      bookId: "b1",
      paidByUserId: "u2",
      userIds: people,
      books,
    });

  it("starts today, in the chosen book, paid by the person, for the book's default people", () => {
    expect(start()).toEqual({
      amount: "",
      category: "",
      title: "",
      payee: "",
      date: "2026-10-12",
      bookId: "b1",
      paidByUserId: "u2",
      participants: people,
      participantsTouched: false,
      notShared: false,
      assetId: "",
    });
    expect(
      newQuickDraft({
        today: "2026-10-12",
        bookId: "b3",
        paidByUserId: "u2",
        userIds: people,
        books,
      }).participants,
    ).toEqual([]);
  });

  it("takes the people of the next book along until the chips were touched", () => {
    const moved = withQuickBook(start(), "b3", books, people);
    expect(moved.bookId).toBe("b3");
    expect(moved.participants).toEqual([]);
    const touched = {
      ...start(),
      participants: ["u1"],
      participantsTouched: true,
    };
    expect(withQuickBook(touched, "b3", books, people).participants).toEqual([
      "u1",
    ]);
  });

  it("remembers that the person ticked people, or chose not to share, and that one excludes the other", () => {
    const ticked = withTicked(start(), ["u3"]);
    expect(ticked).toMatchObject({
      participants: ["u3"],
      participantsTouched: true,
      notShared: false,
    });
    const none = withNotShared(ticked);
    expect(none).toMatchObject({
      participants: [],
      participantsTouched: true,
      notShared: true,
    });
    // ticking a person again ends 'not shared'
    expect(withTicked(none, ["u1"])).toMatchObject({
      participants: ["u1"],
      notShared: false,
    });
    // clearing the last chip is not a choice
    expect(withTicked(ticked, [])).toMatchObject({
      participants: [],
      notShared: false,
    });
  });

  it("forgets 'not shared' with the book unless the chips were touched", () => {
    const untouched = { ...start(), notShared: true };
    expect(withQuickBook(untouched, "b2", books, people)).toMatchObject({
      participants: people,
      notShared: false,
    });
    const chosen = withNotShared(start());
    expect(withQuickBook(chosen, "b2", books, people)).toMatchObject({
      participants: [],
      notShared: true,
    });
  });
});

describe("amounts and titles", () => {
  it("reads a dangling separator as the whole number", () => {
    expect(cleanAmount(" 12. ")).toBe("12");
    expect(cleanAmount("12,")).toBe("12");
    expect(cleanAmount("12,50")).toBe("12,50");
    expect(cleanAmount("")).toBe("");
  });

  const label = (c: CostCategory) => (c === "groceries" ? "Lebensmittel" : c);

  it("titles an entry by what was typed, else the payee, else the category", () => {
    expect(
      quickTitle(
        {
          title: " Wocheneinkauf ",
          payee: "Beispiel AG",
          category: "groceries",
        },
        label,
      ),
    ).toBe("Wocheneinkauf");
    expect(
      quickTitle(
        { title: "", payee: " Beispiel AG ", category: "groceries" },
        label,
      ),
    ).toBe("Beispiel AG");
    expect(
      quickTitle({ title: "", payee: "", category: "groceries" }, label),
    ).toBe("Lebensmittel");
    expect(quickTitle({ title: "", payee: "", category: "" }, label)).toBe("");
  });

  it("never makes a title longer than the API takes", () => {
    expect(
      quickTitle(
        { title: "x".repeat(300), payee: "", category: "groceries" },
        label,
      ),
    ).toHaveLength(200);
  });
});

describe("the request for a quick entry", () => {
  const context: QuickContext = {
    currency: "CHF",
    userIds: people,
    books,
    categoryLabel: (category) =>
      category === "groceries" ? "Lebensmittel" : category,
  };
  const draft = (over: Partial<QuickDraft> = {}): QuickDraft => ({
    amount: "23.50",
    category: "groceries",
    title: "",
    payee: "",
    date: "2026-10-12",
    bookId: "b1",
    paidByUserId: "u2",
    participants: people,
    participantsTouched: false,
    notShared: false,
    assetId: "",
    ...over,
  });
  const build = (over: Partial<QuickDraft> = {}) =>
    buildQuickCostBody(draft(over), context);

  it("books what was typed in the book's own split", () => {
    const { body, errors } = build();
    expect(errors).toEqual({});
    expect(body).toEqual({
      bookId: "b1",
      date: "2026-10-12",
      title: "Lebensmittel",
      amountMinor: 2350,
      currency: "CHF",
      category: "groceries",
      paidByUserId: "u2",
      deductible: "unknown",
    });
  });

  it("reads Swiss and German decimals and a dangling separator", () => {
    expect(build({ amount: "12,5" }).body?.amountMinor).toBe(1250);
    expect(build({ amount: "12." }).body?.amountMinor).toBe(1200);
    expect(build({ amount: "1'234.50" }).body?.amountMinor).toBe(123450);
  });

  it("asks for an amount, a category and a valid date", () => {
    expect(build({ amount: "" }).errors).toEqual({
      amountMinor: "Pflichtfeld.",
    });
    expect(build({ amount: "0" }).errors.amountMinor).toBe(
      "Der Betrag darf nicht 0 sein.",
    );
    expect(build({ amount: "abc" }).errors.amountMinor).toContain("Betrag");
    expect(build({ category: "" }).errors).toEqual({
      category: "Wähle eine Kategorie.",
    });
    expect(build({ date: "" }).errors.date).toBe("Pflichtfeld.");
    expect(build({ date: "2026-02-30" }).errors.date).toBeDefined();
    expect(build({ amount: "", category: "" }).body).toBeUndefined();
  });

  it("refuses an amount with more decimals than the currency has", () => {
    expect(build({ amount: "1.234" }).body).toBeUndefined();
    expect(build({ amount: "1.234" }).errors.amountMinor).toBeDefined();
  });

  it("sends the title, payee and device when they are given", () => {
    const { body } = build({
      title: " Wocheneinkauf ",
      payee: " Beispiel AG ",
      assetId: "a1",
    });
    expect(body).toMatchObject({
      title: "Wocheneinkauf",
      payee: "Beispiel AG",
      assetId: "a1",
    });
    expect(build({ payee: "Beispiel AG" }).body?.title).toBe("Beispiel AG");
  });

  it("leaves the payer open when nobody paid", () => {
    expect(build({ paidByUserId: "" }).body?.paidByUserId).toBeNull();
  });

  it("narrows an ownership book to an equal split among the people ticked", () => {
    const { body } = build({ participants: ["u3", "u1"] });
    expect(body).toMatchObject({
      splitMode: "equal",
      participantIds: ["u1", "u3"],
    });
  });

  it("does not guess when nobody is ticked in a book that shares: the person has to choose", () => {
    const result = build({ participants: [] });
    expect(result.body).toBeUndefined();
    expect(result.errors.participants).toBe(
      "Niemand ausgewählt. Wähle, für wen der Eintrag ist, oder «Nicht teilen».",
    );
    // the amount and the category are fine, so the split is the only complaint
    expect(Object.keys(result.errors)).toEqual(["participants"]);
  });

  it("does not share an entry when the person chose not to", () => {
    const body = build({ participants: [], notShared: true }).body;
    expect(body).toMatchObject({ splitMode: "none" });
    expect(body).not.toHaveProperty("participantIds");
  });

  it("keeps a book that does not share as it is when nobody is ticked", () => {
    const body = build({ bookId: "b3", participants: [] }).body;
    expect(body).not.toHaveProperty("splitMode");
  });

  it("splits equally among everybody when a book that does not share has all ticked", () => {
    const { body } = build({ bookId: "b3", participants: people });
    expect(body).toMatchObject({ bookId: "b3", splitMode: "equal" });
    expect(body).not.toHaveProperty("participantIds");
  });

  it("sends no split at all when the chips are as the book has them", () => {
    for (const [bookId, participants] of [
      ["b1", people],
      ["b2", people],
      ["b3", []],
    ] as const) {
      const { body } = build({ bookId, participants: [...participants] });
      expect(body).not.toHaveProperty("splitMode");
      expect(body).not.toHaveProperty("participantIds");
    }
  });

  it("sends no book id when none is known, so the server takes its default", () => {
    expect(build({ bookId: "" }).body).not.toHaveProperty("bookId");
  });

  it("carries the key of the draft, so a retry of the same save is not booked twice", () => {
    const key = "draft-of-this-save";
    expect(
      buildQuickCostBody(draft(), { ...context, idempotencyKey: key }).body,
    ).toMatchObject({ idempotencyKey: key });
    expect(build().body).not.toHaveProperty("idempotencyKey");
  });
});

describe("the request for a receipt in the queue", () => {
  const file = new File(["x"], "beleg.jpg", { type: "image/jpeg" });
  const empty = { note: "", bookId: "", assetId: "" };

  it("needs the file and nothing else", () => {
    expect(buildReceiptTaskBody(empty, null)).toEqual({
      body: undefined,
      errors: { file: "Füge ein Foto oder eine PDF-Datei des Belegs an." },
    });
    expect(buildReceiptTaskBody(empty, file).body).toEqual({ file });
  });

  it("sends the note trimmed and the hints that were chosen", () => {
    expect(
      buildReceiptTaskBody(
        { note: "  Reparatur bar bezahlt ", bookId: "b1", assetId: "a1" },
        file,
      ).body,
    ).toEqual({
      file,
      note: "Reparatur bar bezahlt",
      bookId: "b1",
      assetId: "a1",
    });
  });

  it("carries the key of the draft", () => {
    const key = "draft-of-this-save";
    expect(buildReceiptTaskBody(empty, file, key).body).toEqual({
      file,
      idempotencyKey: key,
    });
    expect(buildReceiptTaskBody(empty, file).body).not.toHaveProperty(
      "idempotencyKey",
    );
  });

  it("refuses a note the API would", () => {
    const result = buildReceiptTaskBody(
      { ...empty, note: "x".repeat(1001) },
      file,
    );
    expect(result.body).toBeUndefined();
    expect(result.errors.note).toBe("Höchstens 1000 Zeichen.");
    expect(
      buildReceiptTaskBody({ ...empty, note: "x".repeat(1000) }, file).body,
    ).toBeDefined();
  });
});

describe("the words for a failed save", () => {
  const noAnswer = () => new TypeError("Failed to fetch");

  it("says a save that got no answer can simply be tried again, since the key keeps it from being booked twice", () => {
    const message = quickErrorMessage(noAnswer());
    expect(message).toContain("Verbindung");
    expect(message).toContain("noch einmal");
    expect(message).not.toContain("Liste");
  });

  it("tells a receipt that got no answer that nothing is booked and where to look", () => {
    const message = quickErrorMessage(noAnswer(), "receipt");
    expect(message).toContain("Verbindung");
    expect(message).toContain("nichts gebucht");
    expect(message).toContain("Belege");
  });

  it("words a key that another entry or receipt used, and what to look at", () => {
    const conflict = new ApiError("conflict", "key used", { status: 409 });
    expect(quickErrorMessage(conflict)).toContain("Liste");
    expect(quickErrorMessage(conflict, "receipt")).toContain("Belege");
    expect(quickErrorMessage(conflict)).not.toContain("Verbindung");
  });

  it("words an answer of the API like everywhere else", () => {
    expect(
      quickErrorMessage(
        new ApiError("rate_limited", "slow down", { status: 429 }),
      ),
    ).not.toContain("Verbindung");
    expect(quickErrorMessage(new Error("boom"))).not.toContain("Verbindung");
  });

  it("takes only a 409 for a key that is used up; every other failure keeps the key for the retry", () => {
    expect(isKeyConflict(new ApiError("conflict", "x", { status: 409 }))).toBe(
      true,
    );
    expect(isKeyConflict(new ApiError("not_found", "x", { status: 404 }))).toBe(
      false,
    );
    expect(isKeyConflict(new ApiError("internal", "x", { status: 500 }))).toBe(
      false,
    );
    expect(isKeyConflict(noAnswer())).toBe(false);
    expect(isKeyConflict(new Error("boom"))).toBe(false);
  });
});

describe("where the person lands after saving", () => {
  it("opens the book the entry went to, and the year only when it is another", () => {
    expect(
      savedCostsQuery({ bookId: "b2", date: "2026-10-01" }, "2026-10-12"),
    ).toBe("?book=b2");
    expect(
      savedCostsQuery({ bookId: "b2", date: "2025-12-31" }, "2026-10-12"),
    ).toBe("?book=b2&year=2025");
  });
});

describe("the part of the form that is folded away", () => {
  it.each([
    ["date", true],
    ["title", true],
    ["payee", true],
    ["assetId", true],
    ["amountMinor", false],
    ["category", false],
    ["participants", false],
    ["bookId", false],
  ])("opens for an error on %s: %s", (field, opens) => {
    expect(needsMoreSection({ [field]: "Nicht gut." })).toBe(opens);
  });

  it("opens when any of several errors is behind it, and stays shut without errors", () => {
    expect(needsMoreSection({ amountMinor: "x", payee: "y" })).toBe(true);
    expect(needsMoreSection({ amountMinor: "x", category: "y" })).toBe(false);
    expect(needsMoreSection({})).toBe(false);
  });
});

describe("loading the recent categories for the chips", () => {
  const rows = [
    { bookId: "b1", category: "repair", count: 4 },
    { bookId: "b2", category: "dining", count: 2 },
  ];
  const client = (answer: () => unknown) =>
    ({
      call: async () => answer(),
    }) as never;

  it("hands over the rows of the server", async () => {
    expect(
      await loadRecentCategories(
        client(() => ({ entriesPerBook: 100, items: rows })),
      ),
    ).toEqual(rows);
  });

  it("goes without when they cannot be read, so the chips keep their fixed order", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await loadRecentCategories(
        client(() => {
          throw new ApiError("internal", "boom", { status: 500 });
        }),
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "recent categories unavailable",
      "internal",
    );
    expect(
      await loadRecentCategories(
        client(() => {
          throw new TypeError("Failed to fetch");
        }),
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "recent categories unavailable",
      "TypeError",
    );
    warn.mockRestore();
  });
});
