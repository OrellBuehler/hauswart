import { describe, expect, it } from "vitest";
import type { Settlement } from "$lib/api/schemas/settlements";
import {
  buildSettlementBody,
  buildSettlementUpdate,
  draftFromSettlement,
  draftFromSuggestion,
  emptySettlementDraft,
  parseSettlementAmount,
  parseSettlementFilters,
  settlementFilterQuery,
  settlementFiltersActive,
  settlementsQuery,
  swapParties,
  type SettlementDraft,
} from "./settlements";

const defaults = { today: "2026-10-07", currency: "CHF", bookId: "" };

function draft(over: Partial<SettlementDraft> = {}): SettlementDraft {
  return {
    ...emptySettlementDraft(defaults),
    fromUserId: "u2",
    toUserId: "u1",
    amount: "50",
    ...over,
  };
}

function settlement(over: Partial<Settlement> = {}): Settlement {
  return {
    id: "s1",
    bookId: null,
    bookName: null,
    fromUserId: "u2",
    fromName: "Ben",
    toUserId: "u1",
    toName: "Anna",
    amountMinor: 5000,
    currency: "CHF",
    date: "2026-10-01",
    note: null,
    createdBy: "u1",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}

describe("a suggestion as a settlement draft", () => {
  it("prefills who pays whom, the exact amount, today and the household currency", () => {
    expect(
      draftFromSuggestion(
        { fromUserId: "u2", toUserId: "u1", amountMinor: 1250 },
        defaults,
      ),
    ).toEqual({
      fromUserId: "u2",
      toUserId: "u1",
      amount: "12.50",
      currency: "CHF",
      date: "2026-10-07",
      bookId: "",
      note: "",
    });
  });

  it("settles in the book on screen", () => {
    expect(
      draftFromSuggestion(
        { fromUserId: "u2", toUserId: "u1", amountMinor: 5 },
        { ...defaults, bookId: "b2" },
      ),
    ).toMatchObject({ bookId: "b2", amount: "0.05" });
  });

  it("keeps the precision of a currency without minor units", () => {
    expect(
      draftFromSuggestion(
        { fromUserId: "u2", toUserId: "u1", amountMinor: 1500 },
        { ...defaults, currency: "JPY" },
      ).amount,
    ).toBe("1500");
  });

  it("builds the request the suggestion stands for, untouched", () => {
    const built = buildSettlementBody(
      draftFromSuggestion(
        { fromUserId: "u2", toUserId: "u1", amountMinor: 1250 },
        defaults,
      ),
    );
    expect(built.errors).toEqual({});
    expect(built.body).toEqual({
      bookId: null,
      fromUserId: "u2",
      toUserId: "u1",
      amountMinor: 1250,
      currency: "CHF",
      date: "2026-10-07",
      note: null,
    });
  });
});

describe("settlement amounts", () => {
  it("reads decimals into minor units", () => {
    expect(parseSettlementAmount("12.5", "CHF")).toEqual({
      ok: true,
      amountMinor: 1250,
    });
    expect(parseSettlementAmount("1'200", "CHF")).toEqual({
      ok: true,
      amountMinor: 120000,
    });
  });

  it("refuses empty, zero, negative and too precise amounts", () => {
    for (const text of ["", "0", "0.00", "-5", "1.234", "abc"]) {
      expect(parseSettlementAmount(text, "CHF").ok).toBe(false);
    }
    expect(parseSettlementAmount("5", "chf").ok).toBe(false);
  });
});

describe("buildSettlementBody", () => {
  it("builds the request for a payment across all books", () => {
    const built = buildSettlementBody(
      draft({ note: "  bar übergeben ", amount: "50" }),
    );
    expect(built.body).toEqual({
      bookId: null,
      fromUserId: "u2",
      toUserId: "u1",
      amountMinor: 5000,
      currency: "CHF",
      date: "2026-10-07",
      note: "bar übergeben",
    });
  });

  it("carries the book", () => {
    expect(buildSettlementBody(draft({ bookId: "b2" })).body?.bookId).toBe(
      "b2",
    );
  });

  it("needs two different people", () => {
    const built = buildSettlementBody(draft({ toUserId: "u2" }));
    expect(built.body).toBeUndefined();
    expect(built.errors.toUserId).toContain("verschiedene");
  });

  it("names every missing field", () => {
    const built = buildSettlementBody(
      draft({ fromUserId: "", toUserId: "", amount: "", date: "" }),
    );
    expect(built.body).toBeUndefined();
    expect(Object.keys(built.errors).sort()).toEqual([
      "amountMinor",
      "date",
      "fromUserId",
      "toUserId",
    ]);
  });

  it("refuses an impossible date", () => {
    expect(
      buildSettlementBody(draft({ date: "2026-02-30" })).errors.date,
    ).toBeTruthy();
  });
});

describe("buildSettlementUpdate", () => {
  it("sends nothing when nothing changed", () => {
    const existing = settlement({
      note: "bar",
      bookId: "b2",
      bookName: "Haushalt",
    });
    expect(
      buildSettlementUpdate(draftFromSettlement(existing), existing).body,
    ).toEqual({});
  });

  it("sends only what differs", () => {
    const existing = settlement();
    expect(
      buildSettlementUpdate(
        { ...draftFromSettlement(existing), amount: "40", note: "Rest folgt" },
        existing,
      ).body,
    ).toEqual({ amountMinor: 4000, note: "Rest folgt" });
  });

  it("moves a payment into a book and back across all books", () => {
    const existing = settlement();
    expect(
      buildSettlementUpdate(
        { ...draftFromSettlement(existing), bookId: "b2" },
        existing,
      ).body,
    ).toEqual({ bookId: "b2" });
    const booked = settlement({ bookId: "b2" });
    expect(
      buildSettlementUpdate(
        { ...draftFromSettlement(booked), bookId: "" },
        booked,
      ).body,
    ).toEqual({ bookId: null });
  });

  it("clears a note", () => {
    const existing = settlement({ note: "bar" });
    expect(
      buildSettlementUpdate(
        { ...draftFromSettlement(existing), note: " " },
        existing,
      ).body,
    ).toEqual({ note: null });
  });

  it("refuses the same person on both sides", () => {
    const existing = settlement();
    const built = buildSettlementUpdate(
      { ...draftFromSettlement(existing), toUserId: "u2" },
      existing,
    );
    expect(built.body).toBeUndefined();
    expect(built.errors.toUserId).toBeTruthy();
  });
});

describe("swapParties", () => {
  it("turns the payment around", () => {
    expect(swapParties(draft())).toMatchObject({
      fromUserId: "u1",
      toUserId: "u2",
      amount: "50",
    });
  });
});

describe("settlement filters", () => {
  const parse = (qs: string) => parseSettlementFilters(new URLSearchParams(qs));

  it("defaults to every book, year and person", () => {
    expect(parse("")).toEqual({ bookId: "", year: null, person: "" });
    expect(settlementFiltersActive(parse(""))).toBe(false);
  });

  it("round-trips through the address", () => {
    const filters = parse("book=b2&year=2025&person=me");
    expect(filters).toEqual({ bookId: "b2", year: 2025, person: "me" });
    expect(parse(settlementFilterQuery(filters).slice(1))).toEqual(filters);
    expect(settlementFiltersActive(filters)).toBe(true);
  });

  it("writes every book explicitly", () => {
    expect(settlementFilterQuery(parse(""))).toBe("?book=all");
  });

  it("ignores a year that is not one", () => {
    expect(parse("year=abc").year).toBeNull();
    expect(parse("year=1800").year).toBeNull();
    expect(parse("year=20260").year).toBeNull();
  });

  it("asks the list endpoint only for what is set", () => {
    expect(settlementsQuery(parse(""))).toEqual({ limit: 200 });
    expect(
      settlementsQuery(parse("book=b2&year=2025&person=u1"), "next"),
    ).toEqual({
      limit: 200,
      cursor: "next",
      bookId: "b2",
      year: 2025,
      userId: "u1",
    });
  });
});
