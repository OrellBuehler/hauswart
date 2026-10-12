import { describe, expect, it } from "vitest";
import type { CostBook } from "$lib/api/schemas/cost-books";
import type { CostEntry } from "$lib/api/schemas/costs";
import {
  buildCreateBody,
  buildUpdateBody,
  chosenParticipants,
  draftFromEntry,
  entryParticipants,
  equalShares,
  newDraft,
  parseDraftAmount,
  parseShares,
  equalPreview,
  sharePreview,
  splitAfterBook,
  taxClassApplies,
  validateShares,
  withBook,
  type CostDraft,
} from "./form";
import { amountsFor, sharesFor } from "$lib/server/costs/split";

const USERS = ["u1", "u2", "u3"];

function draft(over: Partial<CostDraft> = {}): CostDraft {
  return {
    ...newDraft({
      today: "2026-10-07",
      currency: "CHF",
      paidByUserId: "u1",
      userIds: USERS,
    }),
    title: "Dishwasher repair",
    amount: "189.50",
    category: "repair",
    ...over,
  };
}

function entry(over: Partial<CostEntry> = {}): CostEntry {
  return {
    id: "c1",
    bookId: "b1",
    bookName: "Wohnung",
    bookTaxRelevant: true,
    date: "2026-10-01",
    title: "Dishwasher repair",
    amountMinor: 18950,
    currency: "CHF",
    category: "repair",
    assetId: null,
    assetName: null,
    roomId: null,
    roomName: null,
    defectId: null,
    defectNumber: null,
    defectTitle: null,
    serviceLogId: null,
    serviceLogTitle: null,
    payee: null,
    notes: null,
    paidByUserId: "u1",
    paidByName: "Person One",
    splitMode: "ownership",
    shares: [
      {
        userId: "u1",
        userName: "Person One",
        shareBps: 6000,
        amountMinor: 11370,
      },
      {
        userId: "u2",
        userName: "Person Two",
        shareBps: 4000,
        amountMinor: 7580,
      },
    ],
    tags: [],
    countsAsExpense: true,
    deductible: "unknown",
    source: "manual",
    providerUrl: null,
    fuelLogId: null,
    reviewNeeded: false,
    reviewedAt: null,
    reviewedByUserId: null,
    receiptTaskId: null,
    financeLinked: false,
    recurrenceId: null,
    commentCount: 0,
    createdBy: "u1",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}

describe("amounts", () => {
  it("reads an amount into minor units without floats", () => {
    expect(parseDraftAmount("189.50", false, "CHF")).toEqual({
      ok: true,
      amountMinor: 18950,
    });
    expect(parseDraftAmount("1'234.5", false, "CHF")).toEqual({
      ok: true,
      amountMinor: 123450,
    });
    expect(parseDraftAmount("0,1", false, "CHF")).toEqual({
      ok: true,
      amountMinor: 10,
    });
    expect(parseDraftAmount("1500", false, "JPY")).toEqual({
      ok: true,
      amountMinor: 1500,
    });
  });

  it("makes a refund negative, and keeps a typed minus negative", () => {
    expect(parseDraftAmount("12.00", true, "CHF")).toEqual({
      ok: true,
      amountMinor: -1200,
    });
    expect(parseDraftAmount("-12.00", false, "CHF")).toEqual({
      ok: true,
      amountMinor: -1200,
    });
    expect(parseDraftAmount("-12.00", true, "CHF")).toEqual({
      ok: true,
      amountMinor: -1200,
    });
  });

  it("refuses empty, malformed, zero and too precise amounts", () => {
    for (const text of ["", "abc", "0", "0.00", "1.234", "1,2,3"]) {
      expect(parseDraftAmount(text, false, "CHF").ok, text).toBe(false);
    }
    expect(parseDraftAmount("1.5", false, "JPY").ok).toBe(false);
    expect(parseDraftAmount("1e5", false, "CHF").ok).toBe(false);
    expect(parseDraftAmount("10000000000.00", false, "CHF").ok).toBe(false);
  });

  it("needs a currency code first", () => {
    expect(parseDraftAmount("5", false, "ch").ok).toBe(false);
    expect(parseDraftAmount("5", false, "").ok).toBe(false);
  });
});

describe("shares", () => {
  it("splits 100% evenly, the remainder going to the first people", () => {
    expect(equalShares(USERS)).toEqual({
      u1: "33.34",
      u2: "33.33",
      u3: "33.33",
    });
    expect(equalShares(["a", "b"])).toEqual({ a: "50", b: "50" });
    expect(equalShares([])).toEqual({});
    const total = Object.values(equalShares(USERS))
      .map((v) => Math.round(Number(v) * 100))
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(10_000);
  });

  it("maps percent to basis points and skips blank and zero", () => {
    const parsed = parseShares({ u1: "60", u2: "33,33", u3: "0" }, USERS);
    expect(parsed.items).toEqual([
      { userId: "u1", shareBps: 6000 },
      { userId: "u2", shareBps: 3333 },
    ]);
    expect(parsed.totalBps).toBe(9333);
    expect(parsed.invalid).toEqual([]);
    expect(
      parseShares({ u1: "", u2: "0.00 %", u3: "." }, USERS).invalid,
    ).toEqual(["u3"]);
  });

  it("reports unreadable and out-of-range values", () => {
    const parsed = parseShares({ u1: "abc", u2: "101", u3: "12.345" }, USERS);
    expect(parsed.invalid).toEqual(["u1", "u2", "u3"]);
    expect(parsed.items).toEqual([]);
  });

  it("accepts custom shares only when they add up to 100%", () => {
    expect(validateShares({ u1: "70", u2: "30" }, USERS)).toEqual({
      items: [
        { userId: "u1", shareBps: 7000 },
        { userId: "u2", shareBps: 3000 },
      ],
    });
    expect(validateShares({ u1: "70", u2: "20" }, USERS).error).toBeTruthy();
    expect(validateShares({}, USERS).error).toBeTruthy();
    expect(validateShares({ u1: "x" }, USERS).error).toBeTruthy();
    expect(validateShares({ u1: "100" }, USERS).error).toBeUndefined();
  });

  it("previews each person's part like the server divides it", () => {
    const parts = sharePreview(10, [
      { userId: "b", shareBps: 5000 },
      { userId: "a", shareBps: 5000 },
    ]);
    expect([...parts.entries()]).toEqual([
      ["a", 5],
      ["b", 5],
    ]);
    const odd = sharePreview(1001, [
      { userId: "a", shareBps: 3333 },
      { userId: "b", shareBps: 3333 },
      { userId: "c", shareBps: 3334 },
    ]);
    expect([...odd.values()].reduce((a, b) => a + b, 0)).toBe(1001);
    expect([
      ...sharePreview(-1000, [{ userId: "a", shareBps: 10000 }]).values(),
    ]).toEqual([-1000]);
    expect(sharePreview(100, []).size).toBe(0);
  });

  it("previews an equal split in basis points first, so 300.00 among three is 100.02, 99.99 and 99.99", () => {
    expect([...equalPreview(30000, ["u1", "u2", "u3"])]).toEqual([
      ["u1", 10002],
      ["u2", 9999],
      ["u3", 9999],
    ]);
    expect([...equalPreview(30000, ["u3", "u1", "u2"]).keys()]).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
    expect(equalPreview(100, []).size).toBe(0);
  });

  it("previews an equal split to the minor unit as the server books it", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 9, 13, 20]) {
      const ids = Array.from(
        { length: count },
        (_, i) => `u${String(i + 1).padStart(2, "0")}`,
      );
      const people = ids.map((id) => ({ id, ownershipBps: 0 }));
      for (const amount of [1, 7, 100, 1001, 12345, 30000, -1001, -30000]) {
        const booked = amountsFor(amount, sharesFor("equal", people));
        expect([...equalPreview(amount, ids)], `${count} x ${amount}`).toEqual(
          booked.map((part) => [part.userId, part.amountMinor]),
        );
      }
    }
  });
});

describe("creating", () => {
  it("builds a request in minor units with the person as payer", () => {
    const { body, errors } = buildCreateBody(
      draft({ payee: "  Example Service Ltd ", notes: "", assetId: "a1" }),
      USERS,
    );
    expect(errors).toEqual({});
    expect(body).toMatchObject({
      date: "2026-10-07",
      title: "Dishwasher repair",
      amountMinor: 18950,
      currency: "CHF",
      category: "repair",
      assetId: "a1",
      roomId: null,
      defectId: null,
      serviceLogId: null,
      payee: "Example Service Ltd",
      notes: null,
      paidByUserId: "u1",
      splitMode: "ownership",
      countsAsExpense: true,
      deductible: "unknown",
    });
    expect(body).not.toHaveProperty("shares");
  });

  it("sends shares only for a custom split", () => {
    const { body } = buildCreateBody(
      draft({ splitMode: "custom", shares: { u1: "25", u2: "75", u3: "" } }),
      USERS,
    );
    expect(body?.splitMode).toBe("custom");
    expect(body?.shares).toEqual([
      { userId: "u1", shareBps: 2500 },
      { userId: "u2", shareBps: 7500 },
    ]);
    const other = buildCreateBody(
      draft({ splitMode: "equal", shares: { u1: "25", u2: "75" } }),
      USERS,
    );
    expect(other.body).not.toHaveProperty("shares");
  });

  it("books a refund as a negative amount", () => {
    expect(
      buildCreateBody(draft({ refund: true }), USERS).body?.amountMinor,
    ).toBe(-18950);
  });

  it("points at every field that is wrong", () => {
    const { body, errors } = buildCreateBody(
      draft({
        title: "  ",
        amount: "abc",
        currency: "CH",
        date: "2026-02-31",
        splitMode: "custom",
        shares: { u1: "50" },
      }),
      USERS,
    );
    expect(body).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual([
      "currency",
      "date",
      "shares",
      "title",
    ]);
  });

  it("explains an amount that is not a number or zero", () => {
    expect(
      buildCreateBody(draft({ amount: "0" }), USERS).errors.amountMinor,
    ).toBeTruthy();
    expect(
      buildCreateBody(draft({ amount: "" }), USERS).errors.amountMinor,
    ).toBeTruthy();
  });

  it("lets a mortgage repayment stay out of the expenses by default", () => {
    const base = newDraft({
      today: "2026-10-07",
      currency: "CHF",
      paidByUserId: "",
      userIds: USERS,
    });
    expect(base.countsAsExpense).toBe(true);
    expect(base.paidByUserId).toBe("");
    const { body } = buildCreateBody(
      {
        ...base,
        title: "x",
        amount: "1",
        category: "mortgage_principal",
        countsAsExpense: false,
      },
      USERS,
    );
    expect(body?.countsAsExpense).toBe(false);
    expect(body?.paidByUserId).toBeNull();
  });
});

describe("editing", () => {
  it("sends nothing when nothing changed", () => {
    const e = entry();
    const result = buildUpdateBody(draftFromEntry(e, USERS), e, USERS);
    expect(result.errors).toEqual({});
    expect(result.body).toEqual({});
  });

  it("round-trips a refund", () => {
    const e = entry({ amountMinor: -1250 });
    const d = draftFromEntry(e, USERS);
    expect(d.refund).toBe(true);
    expect(d.amount).toBe("12.50");
    expect(buildUpdateBody(d, e, USERS).body).toEqual({});
  });

  it("sends only the changed fields and keeps the frozen split", () => {
    const e = entry();
    const d = draftFromEntry(e, USERS);
    d.amount = "200";
    d.payee = "Example Service Ltd";
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      amountMinor: 20000,
      payee: "Example Service Ltd",
    });
  });

  it("clears a link or text by sending null", () => {
    const e = entry({
      assetId: "a1",
      payee: "Example Service Ltd",
      notes: "n",
    });
    const d = draftFromEntry(e, USERS);
    d.assetId = "";
    d.payee = "";
    d.notes = "  ";
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      assetId: null,
      payee: null,
      notes: null,
    });
  });

  it("splits again only when the mode or the custom shares changed", () => {
    const e = entry();
    const changed = draftFromEntry(e, USERS);
    changed.splitMode = "equal";
    expect(buildUpdateBody(changed, e, USERS).body).toEqual({
      splitMode: "equal",
    });

    const toCustom = draftFromEntry(e, USERS);
    toCustom.splitMode = "custom";
    toCustom.shares = { u1: "50", u2: "50", u3: "" };
    expect(buildUpdateBody(toCustom, e, USERS).body).toEqual({
      splitMode: "custom",
      shares: [
        { userId: "u1", shareBps: 5000 },
        { userId: "u2", shareBps: 5000 },
      ],
    });

    const custom = entry({
      splitMode: "custom",
      shares: [
        { userId: "u1", userName: null, shareBps: 2500, amountMinor: 0 },
        { userId: "u2", userName: null, shareBps: 7500, amountMinor: 0 },
      ],
    });
    const same = draftFromEntry(custom, USERS);
    expect(buildUpdateBody(same, custom, USERS).body).toEqual({});
    same.shares = { u1: "30", u2: "70", u3: "" };
    expect(buildUpdateBody(same, custom, USERS).body).toEqual({
      shares: [
        { userId: "u1", shareBps: 3000 },
        { userId: "u2", shareBps: 7000 },
      ],
    });
  });

  it("starts a custom split from the frozen shares", () => {
    const d = draftFromEntry(entry(), USERS);
    expect(d.shares).toEqual({ u1: "60", u2: "40", u3: "" });
  });

  it("sends the expense flag along with a category change", () => {
    const e = entry();
    const d = draftFromEntry(e, USERS);
    d.category = "mortgage_principal";
    d.countsAsExpense = false;
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      category: "mortgage_principal",
      countsAsExpense: false,
    });
    d.countsAsExpense = true;
    d.countsTouched = true;
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      category: "mortgage_principal",
      countsAsExpense: true,
    });
  });

  it("does not follow a category change when the flag was set by hand", () => {
    const e = entry({ countsAsExpense: false });
    const d = draftFromEntry(e, USERS);
    expect(d.countsTouched).toBe(true);
    d.deductible = "maintenance";
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      deductible: "maintenance",
    });
  });

  describe("an entry a fuel log entry booked", () => {
    const fuel = () =>
      entry({
        category: "fuel",
        fuelLogId: "f1",
        assetId: "a1",
        assetName: "Familienauto",
      });

    it("never sends the amount, the currency, the date or the device: they stay with the fuel log entry", () => {
      const e = fuel();
      const d = draftFromEntry(e, USERS);
      d.amount = "200";
      d.currency = "EUR";
      d.date = "2026-09-01";
      d.assetId = "a2";
      d.refund = true;
      d.payee = "Example Station";
      expect(buildUpdateBody(d, e, USERS).body).toEqual({
        payee: "Example Station",
      });
    });

    it("still sends what stays editable", () => {
      const e = fuel();
      const d = draftFromEntry(e, USERS);
      d.title = "Tanken, Ferien";
      d.notes = "Ferien";
      d.deductible = "maintenance";
      d.splitMode = "equal";
      expect(buildUpdateBody(d, e, USERS).body).toEqual({
        title: "Tanken, Ferien",
        notes: "Ferien",
        deductible: "maintenance",
        splitMode: "equal",
      });
    });

    it("still checks the draft, so a mistyped amount stops the form", () => {
      const e = fuel();
      const d = draftFromEntry(e, USERS);
      d.amount = "x";
      expect(buildUpdateBody(d, e, USERS).body).toBeUndefined();
    });

    it("never sends a cleared device either", () => {
      const e = fuel();
      const d = draftFromEntry(e, USERS);
      d.assetId = "";
      expect(buildUpdateBody(d, e, USERS).body).toEqual({});
    });

    it("sends the amount and the device of any other entry", () => {
      const e = entry({ assetId: "a1", assetName: "Familienauto" });
      const d = draftFromEntry(e, USERS);
      d.amount = "200";
      d.assetId = "a2";
      expect(buildUpdateBody(d, e, USERS).body).toEqual({
        amountMinor: 20000,
        assetId: "a2",
      });
    });
  });

  it("reports a custom split that does not add up", () => {
    const e = entry();
    const d = draftFromEntry(e, USERS);
    d.splitMode = "custom";
    d.shares = { u1: "10", u2: "10", u3: "" };
    const result = buildUpdateBody(d, e, USERS);
    expect(result.body).toBeUndefined();
    expect(result.errors.shares).toBeTruthy();
  });
});

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
    isDefault: true,
    entryCount: 0,
    settlementCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const wohnung = book();
const haushalt = book({
  id: "b2",
  name: "Haushalt",
  slug: "haushalt",
  defaultSplitMode: "equal",
  taxRelevant: false,
  isDefault: false,
});
const ferien = book({
  id: "b3",
  name: "Ferien",
  defaultSplitMode: "none",
  taxRelevant: false,
  isDefault: false,
  archivedAt: "2026-06-01T00:00:00.000Z",
});
const BOOKS = [wohnung, haushalt, ferien];

function newIn(bookId?: string): CostDraft {
  return {
    ...newDraft({
      today: "2026-10-07",
      currency: "CHF",
      paidByUserId: "u1",
      userIds: USERS,
      books: BOOKS,
      bookId,
    }),
    title: "Wocheneinkauf",
    amount: "84.20",
  };
}

describe("books in a new entry", () => {
  it("starts in the default book with its split", () => {
    const d = newIn();
    expect(d.bookId).toBe("b1");
    expect(d.splitMode).toBe("ownership");
    expect(d.splitTouched).toBe(false);
  });

  it("starts in the book on screen and follows its default split", () => {
    const d = newIn("b2");
    expect(d.bookId).toBe("b2");
    expect(d.splitMode).toBe("equal");
  });

  it("does not start in an archived book or one nobody has", () => {
    expect(newIn("b3").bookId).toBe("b1");
    expect(newIn("gone").bookId).toBe("b1");
  });

  it("books nowhere in particular while no book is known", () => {
    const d = newDraft({
      today: "2026-10-07",
      currency: "CHF",
      paidByUserId: "u1",
      userIds: USERS,
    });
    expect(d.bookId).toBe("");
    expect(d.splitMode).toBe("ownership");
    expect(
      buildCreateBody({ ...d, title: "x", amount: "1" }, USERS).body,
    ).not.toHaveProperty("bookId");
  });

  it("everybody is ticked in 'Für wen' to begin with", () => {
    expect(newIn().participants).toEqual(USERS);
  });

  it("takes the split of the next book until the person chose a split", () => {
    const moved = withBook(newIn(), haushalt, true);
    expect(moved).toMatchObject({ bookId: "b2", splitMode: "equal" });
    const chosen = withBook({ ...newIn(), splitTouched: true }, haushalt, true);
    expect(chosen).toMatchObject({ bookId: "b2", splitMode: "ownership" });
  });

  it("tells the split a book brings along", () => {
    const fresh = { splitMode: "ownership" as const, splitTouched: false };
    expect(splitAfterBook(fresh, haushalt, true)).toBe("equal");
    expect(
      splitAfterBook({ ...fresh, splitTouched: true }, haushalt, true),
    ).toBe("ownership");
    expect(splitAfterBook(fresh, haushalt, false)).toBe("ownership");
    expect(splitAfterBook(fresh, undefined, true)).toBe("ownership");
  });

  it("leaves the split of an entry that exists alone", () => {
    expect(withBook(newIn(), haushalt, false)).toMatchObject({
      bookId: "b2",
      splitMode: "ownership",
    });
    expect(withBook(newIn(), undefined, true).bookId).toBe("b1");
  });

  it("sends the book, and the split it brings along", () => {
    const { body, errors } = buildCreateBody(newIn("b2"), USERS, BOOKS);
    expect(errors).toEqual({});
    expect(body).toMatchObject({ bookId: "b2", splitMode: "equal" });
    expect(body).not.toHaveProperty("participantIds");
  });
});

describe("the tax class follows the book", () => {
  it("applies to a tax relevant book, the default one included", () => {
    expect(taxClassApplies({ bookId: "b1" }, BOOKS)).toBe(true);
    expect(taxClassApplies({ bookId: "" }, BOOKS)).toBe(true);
    expect(taxClassApplies({ bookId: "b2" }, BOOKS)).toBe(false);
  });

  it("applies while the book is not known, so the draft decides", () => {
    expect(taxClassApplies({ bookId: "b1" }, [])).toBe(true);
    expect(taxClassApplies({ bookId: "gone" }, BOOKS)).toBe(true);
  });

  it("is sent for a tax relevant book", () => {
    const d = { ...newIn("b1"), deductible: "maintenance" as const };
    expect(buildCreateBody(d, USERS, BOOKS).body?.deductible).toBe(
      "maintenance",
    );
  });

  it("is dropped in a book that is not tax relevant, whatever was set before the book changed", () => {
    const d = { ...newIn("b2"), deductible: "maintenance" as const };
    expect(buildCreateBody(d, USERS, BOOKS).body?.deductible).toBe("unknown");
  });

  it("is not sent on an edit into a book that is not tax relevant", () => {
    const e = entry();
    const d = draftFromEntry(e, USERS);
    d.bookId = "b2";
    d.deductible = "maintenance";
    expect(buildUpdateBody(d, e, USERS, BOOKS).body).toEqual({ bookId: "b2" });
  });

  it("is sent on an edit in a tax relevant book", () => {
    const e = entry();
    const d = draftFromEntry(e, USERS);
    d.deductible = "investment";
    expect(buildUpdateBody(d, e, USERS, BOOKS).body).toEqual({
      deductible: "investment",
    });
  });
});

describe("moving an entry to another book", () => {
  it("sends the book only when it changed", () => {
    const e = entry();
    expect(
      buildUpdateBody(draftFromEntry(e, USERS), e, USERS, BOOKS).body,
    ).toEqual({});
    const d = draftFromEntry(e, USERS);
    d.bookId = "b2";
    expect(buildUpdateBody(d, e, USERS, BOOKS).body).toEqual({ bookId: "b2" });
  });

  it("keeps the split the entry has", () => {
    const e = entry();
    const d = withBook(draftFromEntry(e, USERS), haushalt, false);
    expect(d.splitMode).toBe("ownership");
    expect(buildUpdateBody(d, e, USERS, BOOKS).body).toEqual({ bookId: "b2" });
  });
});

describe("for whom", () => {
  const equal = (over: Partial<CostDraft> = {}) => ({
    ...newIn("b2"),
    splitMode: "equal" as const,
    ...over,
  });

  it("sends nobody in particular when everybody is ticked", () => {
    expect(buildCreateBody(equal(), USERS, BOOKS).body).not.toHaveProperty(
      "participantIds",
    );
  });

  it("sends the people ticked, in the order of the household", () => {
    const { body } = buildCreateBody(
      equal({ participants: ["u3", "u1"] }),
      USERS,
      BOOKS,
    );
    expect(body).toMatchObject({
      splitMode: "equal",
      participantIds: ["u1", "u3"],
    });
  });

  it("sends a single person as such", () => {
    expect(
      buildCreateBody(equal({ participants: ["u2"] }), USERS, BOOKS).body,
    ).toMatchObject({ participantIds: ["u2"] });
  });

  it("needs somebody ticked", () => {
    const { body, errors } = buildCreateBody(
      equal({ participants: [] }),
      USERS,
      BOOKS,
    );
    expect(body).toBeUndefined();
    expect(errors.participantIds).toBeTruthy();
  });

  it("ignores people that are not in the household", () => {
    expect(chosenParticipants({ participants: ["zz", "u2"] }, USERS)).toEqual([
      "u2",
    ]);
    expect(
      buildCreateBody(equal({ participants: ["zz"] }), USERS, BOOKS).errors
        .participantIds,
    ).toBeTruthy();
  });

  it("does not matter for any other split", () => {
    for (const splitMode of ["ownership", "none"] as const) {
      const { body, errors } = buildCreateBody(
        equal({ splitMode, participants: [] }),
        USERS,
        BOOKS,
      );
      expect(errors).toEqual({});
      expect(body).not.toHaveProperty("participantIds");
    }
    const custom = buildCreateBody(
      equal({
        splitMode: "custom",
        participants: ["u1"],
        shares: { u1: "50", u2: "50", u3: "" },
      }),
      USERS,
      BOOKS,
    );
    expect(custom.body).not.toHaveProperty("participantIds");
  });

  describe("on an entry that exists", () => {
    const shared = (ids: string[]) =>
      entry({
        splitMode: "equal",
        shares: ids.map((userId) => ({
          userId,
          userName: userId,
          shareBps: Math.round(10_000 / ids.length),
          amountMinor: 0,
        })),
      });

    it("reads the people from the frozen shares", () => {
      expect(entryParticipants(shared(["u1", "u3"]), USERS)).toEqual([
        "u1",
        "u3",
      ]);
      expect(draftFromEntry(shared(["u2"]), USERS).participants).toEqual([
        "u2",
      ]);
    });

    it("counts everybody for a split that is not equal", () => {
      expect(entryParticipants(entry(), USERS)).toEqual(USERS);
      expect(
        entryParticipants(entry({ splitMode: "none", shares: [] }), USERS),
      ).toEqual(USERS);
    });

    it("sends nothing while the people stay the same", () => {
      const e = shared(["u1", "u3"]);
      expect(
        buildUpdateBody(draftFromEntry(e, USERS), e, USERS, BOOKS).body,
      ).toEqual({});
    });

    it("divides again among a different set of people", () => {
      const e = shared(["u1", "u3"]);
      const d = draftFromEntry(e, USERS);
      d.participants = ["u1", "u2"];
      expect(buildUpdateBody(d, e, USERS, BOOKS).body).toEqual({
        splitMode: "equal",
        participantIds: ["u1", "u2"],
      });
    });

    it("divides among everybody when all are ticked again", () => {
      const e = shared(["u1", "u3"]);
      const d = draftFromEntry(e, USERS);
      d.participants = [...USERS];
      expect(buildUpdateBody(d, e, USERS, BOOKS).body).toEqual({
        splitMode: "equal",
      });
    });

    it("names the people when the split becomes an equal one among some", () => {
      const e = entry();
      const d = draftFromEntry(e, USERS);
      d.splitMode = "equal";
      d.participants = ["u2", "u3"];
      expect(buildUpdateBody(d, e, USERS, BOOKS).body).toEqual({
        splitMode: "equal",
        participantIds: ["u2", "u3"],
      });
    });

    it("needs somebody ticked on an edit too", () => {
      const e = shared(["u1", "u3"]);
      const d = draftFromEntry(e, USERS);
      d.participants = [];
      const result = buildUpdateBody(d, e, USERS, BOOKS);
      expect(result.body).toBeUndefined();
      expect(result.errors.participantIds).toBeTruthy();
    });

    it("leaves the people alone when the split stops being an equal one", () => {
      const e = shared(["u1", "u3"]);
      const d = draftFromEntry(e, USERS);
      d.splitMode = "ownership";
      d.participants = ["u1"];
      expect(buildUpdateBody(d, e, USERS, BOOKS).body).toEqual({
        splitMode: "ownership",
      });
    });
  });
});

describe("tags", () => {
  const ferien = { id: "t1", name: "Ferien", color: "blue" as const };
  const steuern = { id: "t2", name: "Steuern", color: "green" as const };

  it("starts without tags, or with the ones given", () => {
    expect(draft().tagIds).toEqual([]);
    expect(
      newDraft({
        today: "2026-10-07",
        currency: "CHF",
        paidByUserId: "u1",
        userIds: USERS,
        tagIds: ["t1"],
      }).tagIds,
    ).toEqual(["t1"]);
  });

  it("sends the tags of a new entry, and nothing when there are none", () => {
    expect(
      buildCreateBody(draft({ tagIds: ["t1", "t2"] }), USERS).body,
    ).toMatchObject({
      tagIds: ["t1", "t2"],
    });
    expect(buildCreateBody(draft(), USERS).body).not.toHaveProperty("tagIds");
  });

  it("refuses more than ten tags before the server does", () => {
    const many = Array.from({ length: 11 }, (_, i) => `t${i}`);
    const built = buildCreateBody(draft({ tagIds: many }), USERS);
    expect(built.body).toBeUndefined();
    expect(built.errors.tagIds).toBeTruthy();
  });

  it("reads the tags of an entry into the draft", () => {
    expect(
      draftFromEntry(entry({ tags: [ferien, steuern] }), USERS).tagIds,
    ).toEqual(["t1", "t2"]);
  });

  it("sends nothing for tags that did not change, whatever their order", () => {
    const e = entry({ tags: [ferien, steuern] });
    const same = draftFromEntry(e, USERS);
    expect(buildUpdateBody(same, e, USERS).body).toEqual({});
    expect(
      buildUpdateBody({ ...same, tagIds: ["t2", "t1"] }, e, USERS).body,
    ).toEqual({});
  });

  it("replaces the tags as a whole, and an empty list takes them all off", () => {
    const e = entry({ tags: [ferien] });
    const base = draftFromEntry(e, USERS);
    expect(
      buildUpdateBody({ ...base, tagIds: ["t1", "t2"] }, e, USERS).body,
    ).toEqual({ tagIds: ["t1", "t2"] });
    expect(buildUpdateBody({ ...base, tagIds: [] }, e, USERS).body).toEqual({
      tagIds: [],
    });
  });
});
